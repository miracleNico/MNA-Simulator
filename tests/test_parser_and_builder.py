from __future__ import annotations

import numpy as np

from mna_simulation.api.contracts import AnalysisMode
from mna_simulation.mna_builder import build_mna_problem
from mna_simulation.netlist import parse_netlist_text, select_analysis


def test_parse_op_netlist_and_select_analysis() -> None:
    circuit = parse_netlist_text(
        """
        V1 n1 0 DC 5
        R1 n1 0 1k
        .op
        .end
        """
    )

    directive = select_analysis(circuit)
    assert directive.mode == AnalysisMode.OP
    assert len(circuit.components) == 2


def test_builder_creates_branch_metadata_for_voltage_sources() -> None:
    circuit = parse_netlist_text(
        """
        V1 n1 0 DC 1
        R1 n1 0 1k
        .op
        .end
        """
    )

    problem = build_mna_problem(circuit)
    assert problem.G.shape == (2, 2)
    assert problem.index_map.branch_names == ["V1"]
    assert problem.metadata["labels"] == ["V(n1)", "I(V1)"]


def test_builder_supports_vccs_cccs_and_ccvs() -> None:
    circuit = parse_netlist_text(
        """
        V1 n1 0 DC 1
        V2 n3 n4 DC 0
        G1 n2 0 n1 0 2
        F1 n2 0 V1 3
        H1 n3 0 V1 4
        R1 n2 0 1k
        R2 n4 0 1k
        .op
        .end
        """
    )

    problem = build_mna_problem(circuit)
    assert "V1" in problem.index_map.branch_to_index
    assert "V2" in problem.index_map.branch_to_index
    assert "H1" in problem.index_map.branch_to_index
    assert np.any(problem.G != 0)


def test_builder_populates_ac_rhs_for_small_signal_sources() -> None:
    circuit = parse_netlist_text(
        """
        V1 n1 0 AC 1
        R1 n1 0 1k
        .ac 1 10 5
        .end
        """
    )

    problem = build_mna_problem(circuit)
    assert problem.b_ac.shape == (2, 1)
    assert problem.b_ac[1, 0] == 1
