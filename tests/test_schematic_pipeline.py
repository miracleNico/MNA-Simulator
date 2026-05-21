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


def test_schematic_bjt_is_preserved_in_generated_netlist() -> None:
    schematic = SchematicDocument(
        components=[
            {"id": "gnd1", "type": "GND", "name": "GND1"},
            {"id": "q1", "type": "QNPN", "name": "Q1", "value": "40m", "value2": "2.5k"},
            {"id": "rc", "type": "R", "name": "Rc", "value": "4.7k"},
            {"id": "re", "type": "R", "name": "Re", "value": "470"},
            {"id": "rb", "type": "R", "name": "Rb", "value": "10k"},
        ],
        wires=[
            {
                "id": "w-c",
                "start": {"kind": "component_pin", "component_id": "q1", "pin": "c"},
                "end": {"kind": "component_pin", "component_id": "rc", "pin": "p"},
            },
            {
                "id": "w-rc-g",
                "start": {"kind": "component_pin", "component_id": "rc", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
            {
                "id": "w-b",
                "start": {"kind": "component_pin", "component_id": "q1", "pin": "b"},
                "end": {"kind": "component_pin", "component_id": "rb", "pin": "p"},
            },
            {
                "id": "w-rb-g",
                "start": {"kind": "component_pin", "component_id": "rb", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
            {
                "id": "w-e",
                "start": {"kind": "component_pin", "component_id": "q1", "pin": "e"},
                "end": {"kind": "component_pin", "component_id": "re", "pin": "p"},
            },
            {
                "id": "w-re-g",
                "start": {"kind": "component_pin", "component_id": "re", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
        ],
        analysis={"mode": "op", "params": {}},
    )
    netlist_text, _ = schematic_to_netlist(schematic)

    assert "Q1 " in netlist_text
    assert " QNPN 40m 2.5k" in netlist_text
    assert "VCCS" not in netlist_text


def test_hierarchy_keeps_top_level_net_names_and_marks_internal_nets() -> None:
    schematic = SchematicDocument(
        components=[
            {"id": "gnd1", "type": "GND", "name": "GND1"},
            {"id": "v1", "type": "V", "name": "V1", "subtype": "DC", "value": "1"},
            {"id": "xamp", "type": "SUBCKT", "name": "Xamp", "subcircuit_id": "amp", "pins": ["in", "out"]},
            {"id": "rload", "type": "R", "name": "Rload", "value": "10k"},
        ],
        wires=[
            {
                "id": "w-v-g",
                "start": {"kind": "component_pin", "component_id": "v1", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
            {
                "id": "w-in",
                "start": {"kind": "component_pin", "component_id": "v1", "pin": "p"},
                "end": {"kind": "component_pin", "component_id": "xamp", "pin": "in"},
            },
            {
                "id": "w-out",
                "start": {"kind": "component_pin", "component_id": "xamp", "pin": "out"},
                "end": {"kind": "component_pin", "component_id": "rload", "pin": "p"},
            },
            {
                "id": "w-r-g",
                "start": {"kind": "component_pin", "component_id": "rload", "pin": "n"},
                "end": {"kind": "component_pin", "component_id": "gnd1", "pin": "g"},
            },
        ],
        subcircuits={
            "amp": {
                "components": [
                    {"id": "rin", "type": "R", "name": "Rin", "value": "1k"},
                    {"id": "rout", "type": "R", "name": "Rout", "value": "2k"},
                ],
                "junctions": [
                    {"id": "port_in"},
                    {"id": "mid"},
                    {"id": "port_out"},
                ],
                "wires": [
                    {
                        "id": "w-rin-p",
                        "start": {"kind": "junction", "junction_id": "port_in"},
                        "end": {"kind": "component_pin", "component_id": "rin", "pin": "p"},
                    },
                    {
                        "id": "w-rin-n",
                        "start": {"kind": "component_pin", "component_id": "rin", "pin": "n"},
                        "end": {"kind": "junction", "junction_id": "mid"},
                    },
                    {
                        "id": "w-rout-p",
                        "start": {"kind": "junction", "junction_id": "mid"},
                        "end": {"kind": "component_pin", "component_id": "rout", "pin": "p"},
                    },
                    {
                        "id": "w-rout-n",
                        "start": {"kind": "component_pin", "component_id": "rout", "pin": "n"},
                        "end": {"kind": "junction", "junction_id": "port_out"},
                    },
                ],
            }
        },
        analysis={"mode": "op", "params": {}},
    )

    netlist_text, _ = schematic_to_netlist(schematic)

    assert "V1 n1 0 DC 1" in netlist_text
    assert "Rload n2 0 10k" in netlist_text
    assert "R1 n1 x1 1k" in netlist_text
    assert "R2 x1 n2 2k" in netlist_text
    assert " n3 " not in netlist_text


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
