from __future__ import annotations

import numpy as np
import pytest

from mna_simulation.api.contracts import AnalysisMode, AnalysisRequest
from mna_simulation.api.service import SimulationService
from mna_simulation.backends.python_backend import PythonBackend
from mna_simulation.errors import NetlistError
from mna_simulation.mor.metadata import resolve_mor_order
from mna_simulation.mor.selectors import build_output_selector, validate_probe_subset


def test_mor_output_selector_maps_voltage_and_current_labels() -> None:
    labels = ["V(in)", "V(out)", "I(L1)"]
    selector, outputs = build_output_selector(labels, ["out", "I(L1)"])

    assert outputs == ["V(out)", "I(L1)"]
    assert selector.shape == (2, 3)
    np.testing.assert_allclose(selector @ np.array([[1.0], [2.0], [3.0]]), [[2.0], [3.0]])

    with pytest.raises(NetlistError):
        validate_probe_subset(labels, ["V(in)"], outputs)


def test_auto_mor_order_is_deterministic_and_manual_is_clipped_to_dimension() -> None:
    assert resolve_mor_order(1000, 2, 3, "auto") == (20, "auto")
    assert resolve_mor_order(5, 2, 3, "auto") == (5, "auto")
    assert resolve_mor_order(10, 1, 1, 37) == (10, "manual")


def test_backend_accepts_mor_options() -> None:
    backend = PythonBackend()
    circuit = backend.parse_text(
        """
        I1 out 0 DC 1m
        R1 out 0 1k
        .op
        .end
        """
    )

    options = backend.build_options(
        circuit,
        overrides={
            "use_mor": True,
            "mor_method": "linear",
            "mor_order": 37,
            "mor_output_nodes": ["V(out)"],
            "probe_nodes": ["V(out)"],
        },
    )

    assert options.use_mor is True
    assert options.mor_method == "linear_krylov"
    assert options.mor_order == 37
    assert options.mor_output_nodes == ["V(out)"]
    assert options.probe_nodes == ["V(out)"]


def test_linear_ac_mor_matches_full_selected_output() -> None:
    netlist = """
        V1 in 0 AC 1
        R1 in n1 100
        C1 n1 0 1n
        R2 n1 out 200
        C2 out 0 2n
        .ac 1 1000000 8
        .end
    """
    service = SimulationService()
    full = service.run_request(AnalysisRequest(netlist_text=netlist, mode=AnalysisMode.AC))
    reduced = service.run_request(
        AnalysisRequest(
            netlist_text=netlist,
            mode=AnalysisMode.AC,
            options={"use_mor": True, "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(out)"]},
        )
    )

    assert reduced.status == "ok"
    assert reduced.spectrum is not None
    assert reduced.spectrum["labels"] == ["V(out)"]
    assert reduced.metadata["mor_used"] is True
    out_index = full.spectrum["labels"].index("V(out)")  # type: ignore[index]
    full_out = np.asarray(full.spectrum["magnitudes"])[out_index]
    reduced_out = np.asarray(reduced.spectrum["magnitudes"])[0]
    np.testing.assert_allclose(reduced_out, full_out, rtol=5e-2, atol=1e-6)


def test_linear_transient_mor_matches_full_selected_output() -> None:
    netlist = """
        I1 in 0 STEP 1m 1u
        R1 in out 100
        C1 out 0 1n
        R2 out 0 1k
        .tran 5u 0.5u
        .end
    """
    service = SimulationService()
    full = service.run_request(AnalysisRequest(netlist_text=netlist, mode=AnalysisMode.TRAN))
    reduced = service.run_request(
        AnalysisRequest(
            netlist_text=netlist,
            mode=AnalysisMode.TRAN,
            options={"use_mor": True, "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(out)"]},
        )
    )

    assert reduced.waveform is not None
    assert reduced.waveform["labels"] == ["V(out)"]
    assert reduced.metadata["mor_method"] == "linear_krylov"
    assert reduced.metadata["mor_order"] >= reduced.metadata["mor_basis_size"]
    out_index = full.waveform["labels"].index("V(out)")  # type: ignore[index]
    full_out = np.asarray(full.waveform["values"])[out_index]
    reduced_out = np.asarray(reduced.waveform["values"])[0]
    np.testing.assert_allclose(reduced_out, full_out, rtol=5e-2, atol=1e-5)


def test_linear_transient_requested_tpwl_routes_to_linear_krylov_mor() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            I1 in 0 STEP 1m 1u
            R1 in out 100
            C1 out 0 1n
            R2 out 0 1k
            .tran 5u 0.5u
            .end
            """,
            mode=AnalysisMode.TRAN,
            options={
                "use_mor": True,
                "mor_method": "tpwl",
                "mor_order": 4,
                "mor_output_nodes": ["V(out)"],
                "probe_nodes": ["V(out)"],
            },
        )
    )

    assert response.waveform is not None
    assert response.metadata["mor_requested_method"] == "tpwl"
    assert response.metadata["mor_method"] == "linear_krylov"
    assert "linear circuits route to Linear Krylov MOR" in response.metadata["mor_fallback_reason"]
    assert response.metadata["mor_order"] == 2
    assert response.metadata["mor_basis_size"] <= 4


def _rlc_mesh_netlist(size: int = 8) -> str:
    lines = ["IIN n_0_0 0 STEP 1m 20n"]
    for row in range(size):
        for col in range(size):
            node = f"n_{row}_{col}"
            lines.append(f"C_{row}_{col} {node} 0 200p")
            lines.append(f"RG_{row}_{col} {node} 0 50Meg")
            if col + 1 < size:
                lines.append(f"R_H_{row}_{col} {node} n_{row}_{col + 1} 25")
            if row + 1 < size:
                lines.append(f"L_V_{row}_{col} {node} n_{row + 1}_{col} 20n")
    lines.append(f"RLOAD n_{size - 1}_{size - 1} 0 50")
    lines.append(".tran 500n 1n")
    lines.append(".end")
    return "\n".join(lines)


def test_linear_mor_auto_validates_large_sparse_rlc_outputs() -> None:
    probes = ["V(n_0_0)", "V(n_4_4)"]
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text=_rlc_mesh_netlist(),
            mode=AnalysisMode.TRAN,
            options={
                "use_mor": True,
                "mor_method": "auto",
                "mor_order": "auto",
                "mor_output_nodes": probes,
                "probe_nodes": probes,
            },
        )
    )

    assert response.waveform is not None
    values = np.asarray(response.waveform["values"], dtype=float)
    assert np.isfinite(values).all()
    assert response.metadata["mor_attempted_method"] == "linear_krylov"
    assert response.metadata["mor_method"] == "sparse_full_order_krylov"
    assert response.metadata["mor_validation"]["enabled"] is True
    assert "validation failed" in response.metadata["mor_fallback_reason"]


def test_ac_mor_uses_level1_transistor_operating_point_linearization() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            VCC vcc 0 DC 15
            Vin in 0 AC 0.01
            Cin in base 1u
            RbTop vcc base 220k
            RbBot base 0 15k
            Rc vcc collector 12k
            Re emitter 0 330
            Q1 collector base emitter QNPN LEVEL1 1e-15 150 3 100 25 4p 2p 50 0.5 5
            Cout collector out 4.7u
            Rload out 0 10k
            .ac 1 10000 5
            .end
            """,
            mode=AnalysisMode.AC,
            options={"use_mor": True, "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(out)"]},
        )
    )

    assert response.status == "ok"
    assert response.metadata["mor_used"] is True
    assert response.metadata["op_used"] is True
    assert response.metadata["linearized_device_count"] == 1
    assert response.metadata["device_operating_points"][0]["region"] == "forward_active"


def test_nonlinear_transient_tpwl_trains_and_reuses_cache() -> None:
    netlist = """
        I1 in 0 STEP 1m 1u
        R1 in out 100
        D1 out 0 1e-12
        C1 out 0 1n
        .tran 5u 0.5u
        .end
    """
    service = SimulationService()
    full = service.run_request(AnalysisRequest(netlist_text=netlist, mode=AnalysisMode.TRAN))
    first = service.run_request(
        AnalysisRequest(
            netlist_text=netlist,
            mode=AnalysisMode.TRAN,
            options={"use_mor": True, "mor_method": "tpwl", "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(out)"]},
        )
    )
    second = service.run_request(
        AnalysisRequest(
            netlist_text=netlist,
            mode=AnalysisMode.TRAN,
            options={"use_mor": True, "mor_method": "tpwl", "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(out)"]},
        )
    )

    assert first.waveform is not None
    assert first.metadata["mor_method"] == "tpwl"
    assert first.metadata["mor_cache_hit"] is False
    assert second.metadata["mor_cache_hit"] is True
    out_index = full.waveform["labels"].index("V(out)")  # type: ignore[index]
    full_out = np.asarray(full.waveform["values"])[out_index]
    tpwl_out = np.asarray(first.waveform["values"])[0]
    np.testing.assert_allclose(tpwl_out, full_out, atol=0.2, rtol=0.2)


def test_service_rejects_display_nodes_outside_mor_outputs() -> None:
    with pytest.raises(NetlistError, match="Display nodes must be a subset"):
        SimulationService().run_request(
            AnalysisRequest(
                netlist_text="""
                V1 in 0 AC 1
                R1 in out 1k
                R2 out 0 1k
                .ac 1 1000 3
                .end
                """,
                mode=AnalysisMode.AC,
                options={"use_mor": True, "mor_output_nodes": ["V(out)"], "probe_nodes": ["V(in)"]},
            )
        )


def test_op_and_hb_report_mor_not_used() -> None:
    op_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            V1 out 0 DC 1
            R1 out 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
            options={"use_mor": True, "mor_output_nodes": ["V(out)"]},
        )
    )
    assert op_response.metadata["mor_used"] is False

    hb_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            V1 out 0 SIN 1 1000
            R1 out 0 1k
            .hb 3
            .end
            """,
            mode=AnalysisMode.HB,
            options={"use_mor": True, "mor_output_nodes": ["V(out)"]},
        )
    )
    assert hb_response.metadata["mor_used"] is False
    assert ".hb" in hb_response.metadata["mor_fallback_reason"]
