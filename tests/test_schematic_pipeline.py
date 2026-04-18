from __future__ import annotations

import pytest

from mna_simulation.api.contracts import AnalysisMode, AnalysisRequest, SchematicDocument
from mna_simulation.api.service import SimulationService
from mna_simulation.errors import NetlistError
from mna_simulation.schematic_pipeline import schematic_to_circuit_ir, schematic_to_netlist


def _simple_op_schematic() -> SchematicDocument:
    return SchematicDocument(
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


def test_schematic_to_netlist_maps_ground_and_analysis() -> None:
    netlist_text, pin_assignment = schematic_to_netlist(_simple_op_schematic())
    assert ".op" in netlist_text
    assert ".end" in netlist_text
    assert "0" in pin_assignment.values()
    assert any(node.startswith("n") for node in pin_assignment.values())


def test_schematic_round_trip_to_circuit_ir() -> None:
    conversion = schematic_to_circuit_ir(_simple_op_schematic())
    assert len(conversion.circuit.components) == 2
    assert conversion.circuit.directives[-1].mode == AnalysisMode.OP
    assert "V1" in conversion.netlist_text
    assert "R1" in conversion.netlist_text


def test_disconnected_pin_raises_error() -> None:
    disconnected = SchematicDocument(
        components=[
            {"id": "gnd1", "type": "GND", "name": "GND1"},
            {"id": "r1", "type": "R", "name": "R1", "value": "1k"},
        ],
        wires=[],
        analysis={"mode": "op", "params": {}},
    )
    with pytest.raises(NetlistError):
        schematic_to_netlist(disconnected)


def test_service_accepts_schematic_without_netlist_text() -> None:
    service = SimulationService()
    response = service.run_request(
        AnalysisRequest(
            netlist_text="",
            mode=AnalysisMode.OP,
            schematic=_simple_op_schematic(),
        )
    )

    assert response.status == "ok"
    assert response.dc_solution is not None
    assert response.metadata.get("generated_netlist")
