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
    assert response.matrices is not None
    assert {"G", "C", "f_str", "b_dc"}.issubset(response.matrices)


def test_service_reports_transistor_operating_points() -> None:
    bjt_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            VCC c 0 DC 5
            R1 c out 1k
            Q1 out b 0 QNPN 40m 2.5k 100k 8p 3p 0 0 0
            VB b 0 DC 0.01
            .op
            .end
            """,
            mode=AnalysisMode.OP,
        )
    )
    bjt_points = bjt_response.metadata.get("device_operating_points")
    assert isinstance(bjt_points, list)
    assert bjt_points[0]["name"] == "Q1"
    assert bjt_points[0]["model"] == "small_signal_hybrid_pi"
    assert "vbe" in bjt_points[0]
    assert "ic" in bjt_points[0]

    mos_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            VDD vdd 0 DC 1.2
            MP out in vdd PMOS LEVEL1 0.7m 0.4 0.02 2f 1f
            MN out in 0 NMOS LEVEL1 1.8m 0.4 0.02 2f 1f
            VIN in 0 DC 0
            .op
            .end
            """,
            mode=AnalysisMode.OP,
        )
    )

    assert mos_response.status == "ok"
    device_points = mos_response.metadata.get("device_operating_points")
    assert isinstance(device_points, list)
    assert {entry["name"] for entry in device_points} == {"MP", "MN"}
    assert all(entry["model"] == "level1" for entry in device_points)
    assert any(entry["region"] in {"triode", "saturation", "off"} for entry in device_points)
    assert all("ids" in entry for entry in device_points)


def test_service_uses_level1_bjt_op_for_ac_and_tran_metadata() -> None:
    netlist = """
        VCC vcc 0 DC 15
        Vin in 0 SIN 0.005 1k
        Cin in base 1u
        RbTop vcc base 150k
        RbBot base 0 20k
        Rc vcc collector 5.6k
        Re emitter 0 680
        Q1 collector base emitter QNPN LEVEL1 1e-15 150 3 100 25 4p 2p 50 0.5 5
        Cout collector out 4.7u
        Rload out 0 10k
        .ac 1 10000 5
        .end
    """
    ac_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text=netlist,
            mode=AnalysisMode.AC,
        )
    )
    assert ac_response.status == "ok"
    assert ac_response.metadata["op_used"] is True
    assert ac_response.metadata["linearized_device_count"] == 1
    assert ac_response.metadata["operating_point"]["labels"]
    ac_points = ac_response.metadata["device_operating_points"]
    assert ac_points[0]["model"] == "level1"
    assert ac_points[0]["region"] == "forward_active"
    assert ac_points[0]["gm"] > 0.0

    tran_response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text=netlist.replace(".ac 1 10000 5", ".tran 20u 5u"),
            mode=AnalysisMode.TRAN,
        )
    )
    assert tran_response.status == "ok"
    assert tran_response.metadata["op_used"] is True
    assert tran_response.waveform is not None


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
