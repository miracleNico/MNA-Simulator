"""End-to-end tests for the extended netlist parser and MNA builder.

Covers the features added in the recent refactor:

* Decoupled component names (``Rload`` / ``feedback:R`` syntax)
* ``GND <node>`` ground-aliasing statements
* Arbitrary alphanumeric node identifiers (``vcc``, ``out_node``)
* Hybrid-pi small-signal stamping with input capacitor (CE-amp shape)
* Robustness against zero-diagonal G matrices (V-source feeding only a
  capacitor and dependent sources)
"""

from __future__ import annotations

import numpy as np
import pytest

from mna_simulation.api.contracts import AnalysisMode, AnalysisOptions
from mna_simulation.core_basic import build_and_run_basic
from mna_simulation.errors import NetlistError
from mna_simulation.mna_builder import build_mna_problem
from mna_simulation.netlist import parse_netlist_text


# ---------------------------------------------------------------------------
# Simple resistor / DC OP --- the canonical regression test
# ---------------------------------------------------------------------------


def _solve_op(text: str) -> dict[str, float]:
    """Run an .op simulation and return a label-keyed dict of node voltages."""

    circuit = parse_netlist_text(text)
    options = AnalysisOptions(mode=AnalysisMode.OP)
    result = build_and_run_basic(circuit, options)
    assert result.dc_solution is not None
    labels = result.labels
    flat = np.asarray(result.dc_solution).flatten()
    assert len(labels) == len(flat)
    return dict(zip(labels, flat))


def test_simple_resistor_op_gives_expected_voltage_and_current() -> None:
    solution = _solve_op(
        """
        V1 n1 0 DC 5
        R1 n1 0 1k
        .op
        .end
        """
    )
    assert solution["V(n1)"] == pytest.approx(5.0, rel=1e-9)
    assert solution["I(V1)"] == pytest.approx(-5e-3, rel=1e-9)


def test_resistor_divider_op_matches_hand_calculation() -> None:
    solution = _solve_op(
        """
        V1 n1 0 DC 12
        R1 n1 mid 1k
        R2 mid 0 2k
        .op
        .end
        """
    )
    # Divider: V(mid) = 12 * R2 / (R1 + R2) = 12 * 2/3 = 8 V.
    assert solution["V(mid)"] == pytest.approx(8.0, rel=1e-9)
    assert solution["V(n1)"] == pytest.approx(12.0, rel=1e-9)


def test_arbitrary_node_names_resolve_correctly() -> None:
    """``vcc``, ``out_node`` etc. are accepted as plain identifiers."""

    solution = _solve_op(
        """
        V1 vcc 0 DC 9
        R1 vcc out_node 1k
        R2 out_node 0 1k
        .op
        .end
        """
    )
    assert solution["V(vcc)"] == pytest.approx(9.0, rel=1e-9)
    assert solution["V(out_node)"] == pytest.approx(4.5, rel=1e-9)


# ---------------------------------------------------------------------------
# Decoupled name:TYPE syntax
# ---------------------------------------------------------------------------


def test_decoupled_name_type_resistor() -> None:
    solution = _solve_op(
        """
        supply:V n1 0 DC 5
        load:R n1 0 1k
        .op
        .end
        """
    )
    assert solution["V(n1)"] == pytest.approx(5.0, rel=1e-9)
    # Branch label uses the decoupled name, not the prefix.
    assert "I(supply)" in solution
    assert solution["I(supply)"] == pytest.approx(-5e-3, rel=1e-9)


def test_decoupled_name_handles_underscores_and_long_identifiers() -> None:
    solution = _solve_op(
        """
        bias_supply:V vcc 0 DC 12
        feedback_resistor:R vcc out 4.7k
        load_resistor:R out 0 470
        .op
        .end
        """
    )
    expected = 12.0 * 470.0 / (4700.0 + 470.0)
    assert solution["V(out)"] == pytest.approx(expected, rel=1e-9)


def test_invalid_explicit_type_is_rejected() -> None:
    with pytest.raises(NetlistError):
        parse_netlist_text(
            """
            mything:NOPE n1 0 5
            .op
            .end
            """
        )


# ---------------------------------------------------------------------------
# GND statement / ground aliasing
# ---------------------------------------------------------------------------


def test_gnd_statement_aliases_node_to_zero() -> None:
    # ``vss`` is declared as the ground rail via a GND line.
    solution = _solve_op(
        """
        GND vss
        V1 in vss DC 5
        R1 in vss 1k
        .op
        .end
        """
    )
    # After aliasing, internal naming uses "0" for the ground; only "in" is
    # retained as a free node.
    assert solution["V(in)"] == pytest.approx(5.0, rel=1e-9)
    assert solution["I(V1)"] == pytest.approx(-5e-3, rel=1e-9)


def test_named_ground_via_explicit_gnd_component() -> None:
    """``GND1 ground_rail`` form (component name + node) also works."""

    circuit = parse_netlist_text(
        """
        GND1 ground_rail
        V1 vcc ground_rail DC 9
        R1 vcc ground_rail 1k
        .op
        .end
        """
    )
    problem = build_mna_problem(circuit)
    # GND symbol must have been stripped from the post-normalize component list.
    assert all(c.type != "GND" for c in problem.components)
    # And only "vcc" survives as a free node.
    assert problem.index_map.node_names == ["vcc"]


def test_redundant_gnd_zero_is_a_noop() -> None:
    solution = _solve_op(
        """
        GND 0
        V1 n1 0 DC 1
        R1 n1 0 100
        .op
        .end
        """
    )
    assert solution["V(n1)"] == pytest.approx(1.0, rel=1e-9)


def test_gnd_aliasing_catches_v_source_shorted_to_ground() -> None:
    """Two terminals on the (aliased) ground must raise a clear error."""

    with pytest.raises(NetlistError):
        parse_netlist_text(
            """
            GND vss
            V1 vss 0 DC 5
            R1 vss 0 1k
            .op
            .end
            """
        )


# ---------------------------------------------------------------------------
# Capacitor + V-source: zero-diagonal G regression
# ---------------------------------------------------------------------------


def test_solver_handles_zero_diagonal_for_capacitor_input() -> None:
    """Catches the singular-G regression on the CE amp.

    Node ``in`` here has only a V-source and a capacitor connected to it. At
    DC the capacitor stamps zero into G, so ``G[in, in] == 0``. A pivoting
    linear solver must still produce ``V(in) = 0`` (the V-source shorts to
    ground at DC since this source has no DC component).
    """

    # Use AC analysis to ensure the same G matrix gets factorised. .op with
    # a SIN source at t=0 also exercises the same path.
    solution = _solve_op(
        """
        V1 in 0 DC 0
        C1 in mid 1u
        R1 mid 0 1k
        .op
        .end
        """
    )
    # No DC excitation, so steady-state DC voltages are all zero.
    assert solution["V(in)"] == pytest.approx(0.0, abs=1e-9)
    assert solution["V(mid)"] == pytest.approx(0.0, abs=1e-9)


def test_capacitor_input_transient_runs_without_singular_g() -> None:
    """High-pass topology where ``in`` has zero G diagonal at DC.

    V1 → in → C1 → mid → R1 → 0. With ``DC 0`` and a sin source, the OP step
    must succeed (this is the regression case), and the transient values must
    be finite. We don't assert on specific V(mid) trajectory because the
    sinusoidal response depends on the chosen step size.
    """

    circuit = parse_netlist_text(
        """
        V1 in 0 SIN 1 100
        C1 in mid 1u
        R1 mid 0 1k
        .tran 20m 100u
        .end
        """
    )
    options = AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=20e-3, tran_step=100e-6)
    result = build_and_run_basic(circuit, options)
    assert result.waveform is not None
    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    in_idx = labels.index("V(in)")
    mid_idx = labels.index("V(mid)")
    assert np.isfinite(values).all()
    # ``in`` is driven by a sin of amplitude 1 at 100 Hz — bounded by [-2, 2].
    assert values[in_idx, :].max() <= 2.0
    assert values[in_idx, :].min() >= -2.0
    # The capacitor passes AC, so V(mid) shows non-trivial swing (not stuck at 0).
    assert values[mid_idx, :].max() - values[mid_idx, :].min() > 0.1


# ---------------------------------------------------------------------------
# Hybrid-pi small-signal CE-amp shape (reduced)
# ---------------------------------------------------------------------------


def test_hybrid_pi_small_signal_amp_runs_without_singular_g() -> None:
    """Mimics the front-end's BJT expansion for the CE-amp demo.

    Inputs:
      * Vin (sin, 0 V DC offset) drives ``in`` through Cin (10 µF) into base.
      * Rpi between base and emitter, Re from emitter to ground.
      * VCCS gm=40 mS from collector to emitter, controlled by V_be.
      * Rc from collector to vcc; Vcc DC = 12 V.
    The DC initial condition has G[in, in] == 0 (only Cin + Vin touch it),
    so this exercises the pivoting linear-solver fix.
    """

    circuit = parse_netlist_text(
        """
        V1 in 0 SIN 0.05 1k
        Vcc vcc 0 DC 12
        Cin in base 10u
        Rpi base emitter 2.5k
        Re emitter 0 470
        Rc vcc collector 4.7k
        G1 collector emitter base emitter 0.04
        .tran 5m 50u
        .end
        """
    )
    options = AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=5e-3, tran_step=50e-6)
    result = build_and_run_basic(circuit, options)
    assert result.waveform is not None
    labels = result.waveform.labels
    values = np.asarray(result.waveform.values)
    assert "V(collector)" in labels
    coll = values[labels.index("V(collector)"), :]
    # vcc rail is 12 V; DC operating point of the linearised model has
    # V(collector) = V(vcc) = 12 V (no current through Rc when V_be = 0). The
    # AC swing is bounded by gm * Vin_amp * Rc = 0.04 * 0.05 * 4700 ≈ 9.4 V.
    assert np.isfinite(coll).all()
    assert coll.max() < 22.0
    assert coll.min() > 2.0
    # And we should see AC variation (not stuck at DC). With unbypassed Re of
    # 470 Ω the effective gain is gm/(1+gm·Re)·Rc ≈ 9.5 V/V, so a 50 mV input
    # produces ≈ 470 mV peak-to-peak at the collector.
    assert coll.max() - coll.min() > 0.2


def test_qnpn_small_signal_device_matches_hybrid_pi_shape() -> None:
    """A QNPN line is stamped as a backend-owned hybrid-pi device.

    This keeps schematic-generated BJT netlists readable instead of expanding
    them into VCCS/Rpi components before they reach the backend.
    """

    expanded = parse_netlist_text(
        """
        V1 in 0 SIN 0.05 1k
        Rpi base emitter 2.5k
        Re emitter 0 470
        Rc collector 0 4.7k
        G1 collector emitter base emitter 40m
        Cin in base 10u
        .tran 5m 50u
        .end
        """
    )
    compact = parse_netlist_text(
        """
        V1 in 0 SIN 0.05 1k
        Re emitter 0 470
        Rc collector 0 4.7k
        Q1 collector base emitter QNPN 40m 2.5k
        Cin in base 10u
        .tran 5m 50u
        .end
        """
    )

    options = AnalysisOptions(mode=AnalysisMode.TRAN, tran_stop=5e-3, tran_step=50e-6)
    expanded_result = build_and_run_basic(expanded, options)
    compact_result = build_and_run_basic(compact, options)
    assert expanded_result.waveform is not None
    assert compact_result.waveform is not None
    assert expanded_result.waveform.labels == compact_result.waveform.labels
    np.testing.assert_allclose(compact_result.waveform.values, expanded_result.waveform.values, rtol=1e-9, atol=1e-12)


# ---------------------------------------------------------------------------
# Index-map robustness
# ---------------------------------------------------------------------------


def test_duplicate_branch_name_raises() -> None:
    with pytest.raises(NetlistError):
        circuit = parse_netlist_text(
            """
            V1 n1 0 DC 5
            V1 n2 0 DC 3
            R1 n1 n2 1k
            .op
            .end
            """
        )
        build_mna_problem(circuit)


def test_branch_indices_assigned_after_node_indices() -> None:
    circuit = parse_netlist_text(
        """
        V1 n1 0 DC 5
        R1 n1 0 1k
        .op
        .end
        """
    )
    problem = build_mna_problem(circuit)
    n_nodes = len(problem.index_map.node_names)
    # Branch indices must come strictly after node indices.
    for branch_name, idx in problem.index_map.branch_to_index.items():
        assert idx >= n_nodes, f"branch '{branch_name}' index {idx} clashes with node index range"
