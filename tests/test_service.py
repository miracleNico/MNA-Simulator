from __future__ import annotations

from mna_simulation.api.contracts import AnalysisMode, AnalysisRequest
from mna_simulation.api.service import SimulationService
from mna_simulation.api.contracts import SchematicDocument


def test_service_returns_matrix_payload() -> None:
    service = SimulationService()
    response = service.run_request(
        AnalysisRequest(
            netlist_text="""
            V1 n1 0 DC 5
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.SHOW_MATRIX,
        )
    )

    assert response.status == "ok"
    assert response.matrices is not None
    assert "G" in response.matrices


def test_service_returns_dc_solution() -> None:
    service = SimulationService()
    response = service.run_request(
        AnalysisRequest(
            netlist_text="""
            V1 n1 0 DC 5
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
        )
    )

    assert response.status == "ok"
    assert response.dc_solution is not None
    assert len(response.dc_solution) == 2


def test_service_generated_netlist_metadata_for_schematic() -> None:
    service = SimulationService()
    schematic = SchematicDocument(
        components=[
            {"id": "gnd1", "type": "GND", "name": "GND1"},
            {"id": "v1", "type": "V", "name": "V1", "subtype": "DC", "value": "5"},
            {"id": "r1", "type": "R", "name": "R1", "value": "1k"},
        ],
        wires=[
            {
                "id": "w1",
                "start": {"kind": "component_pin", "component_id": "v1", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
            {
                "id": "w2",
                "start": {"kind": "component_pin", "component_id": "v1", "pin": "p"},
                "end": {"kind": "component_pin", "component_id": "r1", "pin": "p"},
            },
            {
                "id": "w3",
                "start": {"kind": "component_pin", "component_id": "r1", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
        ],
        analysis={"mode": "op", "params": {}},
    )

    response = service.run_request(AnalysisRequest(netlist_text="", schematic=schematic))
    assert response.status == "ok"
    assert "generated_netlist" in response.metadata
    assert ".op" in str(response.metadata["generated_netlist"])


def test_service_decimates_large_waveform_output_when_requested() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            V1 n1 0 SIN 1 1k
            R1 n1 0 1k
            .tran 1m 1u
            .end
            """,
            mode=AnalysisMode.TRAN,
            options={"output_max_points": 100},
        )
    )

    assert response.status == "ok"
    assert response.waveform is not None
    assert len(response.waveform["time"]) <= 101
    assert response.metadata["output_decimation"]["original_points"] > response.metadata["output_decimation"]["returned_points"]
