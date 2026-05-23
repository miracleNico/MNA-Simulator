from __future__ import annotations

import numpy as np
import pytest

from mna_simulation.api.contracts import (
    AnalysisMode,
    AnalysisOptions,
    ComponentRecord,
    SchematicAnalysis,
    SchematicComponent,
    SchematicDocument,
    SchematicEndpoint,
    SchematicWire,
)
from mna_simulation.core_basic import build_and_run_basic
from mna_simulation.device_models import source_expression
from mna_simulation.mna_builder import build_mna_problem
from mna_simulation.netlist import parse_netlist_text
from mna_simulation.schematic_pipeline import schematic_to_netlist
from mna_simulation.solvers import compile_nl_functions


def _pin(component_id: str, pin: str) -> SchematicEndpoint:
    return SchematicEndpoint(kind="component_pin", component_id=component_id, pin=pin)


def test_func_source_accepts_whitespace_expression_and_schematic_roundtrip() -> None:
    expression = "Piecewise((0, t < 1e-3), (sin(t) + cos(t) + Max(t, 0), True))"
    circuit = parse_netlist_text(
        f"""
        V1 n 0 FUNC 0 {expression}
        R1 n 0 1k
        .tran 2m 1m
        .end
        """
    )
    assert circuit.components[0].value2 == expression

    schematic = SchematicDocument(
        components=[
            SchematicComponent(id="v1", type="V", name="V1", value="0", subtype="FUNC", value2=expression),
            SchematicComponent(id="r1", type="R", name="R1", value="1k"),
            SchematicComponent(id="g0", type="GND", name="GND0", value="0"),
        ],
        wires=[
            SchematicWire(id="w1", start=_pin("v1", "p"), end=_pin("r1", "p")),
            SchematicWire(id="w2", start=_pin("r1", "n"), end=_pin("g0", "g")),
            SchematicWire(id="w3", start=_pin("v1", "n"), end=_pin("g0", "g")),
        ],
        analysis=SchematicAnalysis(mode=AnalysisMode.TRAN, params={"t_stop": "2m", "t_step": "1m"}),
    )
    netlist, _ = schematic_to_netlist(schematic)
    assert expression in netlist
    assert parse_netlist_text(netlist).components[0].value2 == expression


def test_vpch_precharge_func_expression_is_preserved_exactly() -> None:
    expression = "Piecewise((0, t < 1e-9), (1.2, t < 3.5e-9), (0, t < 4.5e-9), (1.2, True))"
    netlist = f"""
        VPCH pch gnd FUNC 0 {expression}
        Rload pch gnd 1Meg
        GND gnd
        .tran 6n 1n
        .end
        """
    circuit = parse_netlist_text(netlist)
    assert circuit.components[0].name == "VPCH"
    assert circuit.components[0].value2 == expression

    schematic = SchematicDocument(
        components=[
            SchematicComponent(id="vpch", type="V", name="VPCH", value="0", subtype="FUNC", value2=expression),
            SchematicComponent(id="rload", type="R", name="Rload", value="1Meg"),
            SchematicComponent(id="gnd", type="GND", name="GND0", value="0"),
        ],
        wires=[
            SchematicWire(id="w1", start=_pin("vpch", "p"), end=_pin("rload", "p")),
            SchematicWire(id="w2", start=_pin("rload", "n"), end=_pin("gnd", "g")),
            SchematicWire(id="w3", start=_pin("vpch", "n"), end=_pin("gnd", "g")),
        ],
        analysis=SchematicAnalysis(mode=AnalysisMode.TRAN, params={"t_stop": "6n", "t_step": "1n"}),
    )
    generated, _ = schematic_to_netlist(schematic)
    assert f"VPCH n1 0 FUNC 0 {expression}" in generated
    assert parse_netlist_text(generated).components[0].value2 == expression


def test_periodic_func_only_rewrites_standalone_time_symbol() -> None:
    component = ComponentRecord(
        name="VFUNC",
        type="V",
        node1="n",
        node2="0",
        value="1",
        subtype="FUNC",
        value2="t + theta + sqrt(t)",
    )
    expression = source_expression(component)
    assert "theta" in expression
    assert "np.mod(theta" not in expression
    assert expression.count("np.mod(t, 1.0)") == 2


def _level1_current(
    mos_type: str,
    vd: float,
    vg: float,
    vs: float,
    beta: str = "1m",
) -> float:
    circuit = parse_netlist_text(
        f"""
        M1 d g s {mos_type} LEVEL1 {beta} 0.4 0.02 2f 1f
        Vd d 0 DC 0
        Vg g 0 DC 0
        Vs s 0 DC 0
        .op
        .end
        """
    )
    problem = build_mna_problem(circuit)
    f_func, _ = compile_nl_functions(
        problem.solver_f_str if problem.solver_f_str is not None else problem.f_str,
        problem.G.shape[0],
        level1_mos_devices=problem.level1_mos_devices,
    )
    x = np.zeros((problem.G.shape[0], 1))
    labels = problem.metadata["labels"]
    x[labels.index("V(d)"), 0] = vd
    x[labels.index("V(g)"), 0] = vg
    x[labels.index("V(s)"), 0] = vs
    return float(np.asarray(f_func(*x.flatten())).reshape(problem.G.shape[0], 1)[labels.index("V(d)"), 0])


def test_level1_mos_currents_cover_off_triode_saturation_and_pmos_polarity() -> None:
    assert _level1_current("NMOS", vd=1.2, vg=0.2, vs=0.0) == pytest.approx(0.0, abs=1e-15)
    assert _level1_current("NMOS", vd=0.1, vg=1.2, vs=0.0) == pytest.approx(7.515e-5, rel=1e-3)
    assert _level1_current("NMOS", vd=1.2, vg=1.2, vs=0.0) == pytest.approx(3.2768e-4, rel=1e-3)
    assert _level1_current("PMOS", vd=0.2, vg=0.0, vs=1.2) < 0.0


def test_level1_inverter_transient_converges() -> None:
    circuit = parse_netlist_text(
        """
        VDD vdd 0 DC 1.2
        VIN in 0 FUNC 0 Piecewise((0, t < 1e-9), (1.2, True))
        MP out in vdd PMOS LEVEL1 0.7m 0.4 0.02 2f 1f
        MN out in 0 NMOS LEVEL1 1.8m 0.4 0.02 2f 1f
        Cout out 0 5f
        .tran 2n 0.5n
        .end
        """
    )
    result = build_and_run_basic(
        circuit,
        AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=2e-9, tran_step=0.5e-9),
    )
    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    assert values[labels.index("V(out)"), 0] > 1.0
    assert values[labels.index("V(out)"), -1] < 0.05


def _sram_netlist(
    rows: int = 10,
    cols: int = 10,
    step: str = "0.25n",
    selected_row: int = 3,
    selected_col: int = 4,
) -> str:
    v_high = "1.2"
    lines = [
        "GND gnd",
        f"VDD vdd gnd DC {v_high}",
        f"VPCH pch gnd FUNC 0 Piecewise((0, t < 1e-9), ({v_high}, t < 3.5e-9), (0, t < 4.5e-9), ({v_high}, True))",
        f"VWR wr gnd FUNC 0 Piecewise((0, t < 1e-9), ({v_high}, t < 2.5e-9), (0, True))",
        f"VWRB wr_b gnd FUNC 0 Piecewise(({v_high}, t < 1e-9), (0, t < 2.5e-9), ({v_high}, True))",
    ]
    for row in range(rows):
        if row == selected_row:
            lines.append(
                f"VWL{row} wl_{row} gnd FUNC 0 Piecewise((0, t < 1e-9), ({v_high}, t < 2.5e-9), "
                f"(0, t < 4.5e-9), ({v_high}, t < 6e-9), (0, True))"
            )
        else:
            lines.append(f"VWL{row} wl_{row} gnd DC 0")

    for col in range(cols):
        lines.extend(
            [
                f"MPCHBL{col} bl_{col} pch vdd PMOS LEVEL1 3m 0.4 0.02 2f 1f",
                f"MPCHBLB{col} blb_{col} pch vdd PMOS LEVEL1 3m 0.4 0.02 2f 1f",
                f"CBL{col} bl_{col} gnd 20f",
                f"CBLB{col} blb_{col} gnd 20f",
            ]
        )

    lines.extend(
        [
            f"MWRBL bl_{selected_col} wr_b vdd PMOS LEVEL1 8m 0.4 0.02 2f 1f",
            f"MWRBLB blb_{selected_col} wr gnd NMOS LEVEL1 8m 0.4 0.02 2f 1f",
        ]
    )

    for row in range(rows):
        for col in range(cols):
            q = f"q_{row}_{col}"
            qb = f"qb_{row}_{col}"
            q_starts_high = False if (row == selected_row and col == selected_col) else (row + col) % 2 == 0
            lines.extend(
                [
                    f"MPQ{row}_{col} {q} {qb} vdd PMOS LEVEL1 0.7m 0.4 0.02 2f 1f",
                    f"MPQB{row}_{col} {qb} {q} vdd PMOS LEVEL1 0.7m 0.4 0.02 2f 1f",
                    f"MNQ{row}_{col} {q} {qb} gnd NMOS LEVEL1 1.8m 0.4 0.02 2f 1f",
                    f"MNQB{row}_{col} {qb} {q} gnd NMOS LEVEL1 1.8m 0.4 0.02 2f 1f",
                    f"MAXQ{row}_{col} {q} wl_{row} bl_{col} NMOS LEVEL1 2.5m 0.4 0.02 2f 1f",
                    f"MAXQB{row}_{col} {qb} wl_{row} blb_{col} NMOS LEVEL1 2.5m 0.4 0.02 2f 1f",
                    f"CQ{row}_{col} {q} gnd 4f",
                    f"CQB{row}_{col} {qb} gnd 4f",
                    f"RINITQ{row}_{col} {q} {'vdd' if q_starts_high else 'gnd'} 200Meg",
                    f"RINITQB{row}_{col} {qb} {'gnd' if q_starts_high else 'vdd'} 200Meg",
                ]
            )

    lines.extend([f".tran 6n {step}", ".end"])
    return "\n".join(lines)


def test_single_6t_cell_writes_holds_and_reads_differential_bitlines() -> None:
    result = build_and_run_basic(
        parse_netlist_text(_sram_netlist(rows=1, cols=1, step="0.5n", selected_row=0, selected_col=0)),
        AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=6e-9, tran_step=0.5e-9, max_iter=200),
    )
    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    q = values[labels.index("V(q_0_0)"), :]
    qb = values[labels.index("V(qb_0_0)"), :]
    bl = values[labels.index("V(bl_0)"), :]
    blb = values[labels.index("V(blb_0)"), :]
    assert q[-1] > 0.8
    assert qb[-1] < 0.4
    assert bl[-3] - blb[-3] > 0.5


def test_full_10x10_sram_transient_runs_selected_cell() -> None:
    result = build_and_run_basic(
        parse_netlist_text(_sram_netlist(rows=10, cols=10, step="1n")),
        AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=6e-9, tran_step=1e-9, max_iter=200),
    )
    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    assert len(labels) >= 200
    assert values[labels.index("V(q_3_4)"), -1] > 0.8
    assert values[labels.index("V(qb_3_4)"), -1] < 0.4
    assert values[labels.index("V(bl_4)"), -2] - values[labels.index("V(blb_4)"), -2] > 0.5
