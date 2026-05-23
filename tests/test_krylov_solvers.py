from __future__ import annotations

import numpy as np

from mna_simulation.api.contracts import AnalysisMode, AnalysisRequest
from mna_simulation.api.service import SimulationService
from mna_simulation.backends.python_backend import PythonBackend
from mna_simulation.mna_builder import build_mna_problem
from mna_simulation.netlist import parse_netlist_text
from mna_simulation.solvers import classify_krylov_matrix, krylov_solve_linear, resolve_krylov_rank, solve_linear


def test_general_matrix_uses_arnoldi_gmres() -> None:
    A = np.array(
        [
            [4.0, 1.0, 0.0],
            [2.0, 3.0, 1.0],
            [0.0, 1.0, 2.0],
        ]
    )
    b = np.array([[1.0], [2.0], [3.0]])

    x, info = krylov_solve_linear(A, b, tol=1e-12, max_iter=30, rank=3)

    assert classify_krylov_matrix(A) == "general"
    assert info["method"] == "arnoldi_gmres"
    assert info["resolved_rank"] == 3
    assert info["converged"] is True
    assert np.linalg.norm(A @ x - b) < 1e-10


def test_symmetric_indefinite_matrix_uses_conjugate_residual() -> None:
    A = np.array(
        [
            [4.0, 1.0, 0.0],
            [1.0, -3.0, 1.0],
            [0.0, 1.0, 2.0],
        ]
    )
    b = np.array([[1.0], [2.0], [3.0]])

    x, info = krylov_solve_linear(A, b, tol=1e-12, max_iter=30, rank=3)

    assert classify_krylov_matrix(A) == "symmetric"
    assert info["method"] == "conjugate_residual"
    assert info["resolved_rank"] == 3
    assert info["iteration_budget"] == 3
    assert info["converged"] is True
    assert np.linalg.norm(A @ x - b) < 1e-10


def test_positive_definite_matrix_uses_conjugate_gradient() -> None:
    A = np.array(
        [
            [4.0, 1.0, 0.0],
            [1.0, 3.0, 1.0],
            [0.0, 1.0, 2.0],
        ]
    )
    b = np.array([[1.0], [2.0], [3.0]])

    x, info = krylov_solve_linear(A, b, tol=1e-12, max_iter=30, rank=3)

    assert classify_krylov_matrix(A) == "positive_definite"
    assert info["method"] == "conjugate_gradient"
    assert info["resolved_rank"] == 3
    assert info["iteration_budget"] == 3
    assert info["converged"] is True
    assert np.linalg.norm(A @ x - b) < 1e-10


def test_explicit_arnoldi_can_override_positive_definite_matrix() -> None:
    A = np.array(
        [
            [4.0, 1.0, 0.0],
            [1.0, 3.0, 1.0],
            [0.0, 1.0, 2.0],
        ]
    )
    b = np.array([[1.0], [2.0], [3.0]])

    x, info = krylov_solve_linear(A, b, tol=1e-12, max_iter=30, rank=2, method="arnoldi_gmres")

    assert classify_krylov_matrix(A) == "positive_definite"
    assert info["requested_method"] == "arnoldi_gmres"
    assert info["route"] == "general"
    assert info["method"] == "arnoldi_gmres"
    assert info["effective_restart"] == 2
    assert info["converged"] is True
    assert np.linalg.norm(A @ x - b) < 1e-10


def test_auto_krylov_rank_is_half_matrix_dimension() -> None:
    assert resolve_krylov_rank(1, "auto") == (1, "auto")
    assert resolve_krylov_rank(7, "auto") == (4, "auto")
    assert resolve_krylov_rank(8, "auto") == (4, "auto")


def test_manual_krylov_rank_accepts_arbitrary_integer() -> None:
    assert resolve_krylov_rank(8, 37) == (37, "manual")
    assert resolve_krylov_rank(8, "137") == (137, "manual")
    assert resolve_krylov_rank(8, 251) == (251, "manual")


def test_backend_accepts_auto_and_arbitrary_manual_krylov_rank() -> None:
    backend = PythonBackend()
    circuit = backend.parse_text(
        """
        I1 n1 0 DC 1m
        R1 n1 0 1k
        .op
        .end
        """
    )

    auto_options = backend.build_options(circuit, overrides={"use_krylov": True, "krylov_rank": "auto"})
    assert auto_options.krylov_rank == "auto"

    for rank in (37, 137, 251):
        options = backend.build_options(circuit, overrides={"use_krylov": True, "krylov_rank": rank})
        assert options.krylov_rank == rank

    method_options = backend.build_options(
        circuit,
        overrides={"use_krylov": True, "krylov_rank": "auto", "krylov_method": "arnoldi"},
    )
    assert method_options.krylov_method == "arnoldi_gmres"


def test_solve_linear_krylov_matches_direct_solution() -> None:
    A = np.array([[2.0, -1.0], [4.0, 3.0]])
    b = np.array([[1.0], [7.0]])

    x_krylov = solve_linear(A, b, use_krylov=True, krylov_tol=1e-12, krylov_rank=2)
    x_direct = np.linalg.solve(A, b)

    assert np.allclose(x_krylov, x_direct, atol=1e-10)


def test_service_accepts_krylov_option_and_reports_policy() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            I1 n1 0 DC 1m
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
            options={"use_krylov": True, "krylov_rank": "auto"},
        )
    )

    assert response.status == "ok"
    assert response.metadata["linear_solver"] == "krylov"
    assert "Arnoldi/GMRES" in str(response.metadata["krylov_policy"])
    assert response.metadata["krylov_matrix_dimension"] == 1
    assert response.metadata["krylov_resolved_rank"] == 1
    assert response.metadata["krylov_rank_mode"] == "auto"
    assert response.metadata["krylov_method"] == "conjugate_gradient"
    assert response.metadata["krylov_converged"] is True


def test_service_reports_arbitrary_manual_krylov_rank() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            I1 n1 0 DC 1m
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
            options={"use_krylov": True, "krylov_rank": 137},
        )
    )

    assert response.status == "ok"
    assert response.metadata["krylov_resolved_rank"] == 137
    assert response.metadata["krylov_rank_mode"] == "manual"


def test_service_allows_manual_krylov_method_override() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            I1 n1 0 DC 1m
            R1 n1 0 1k
            .op
            .end
            """,
            mode=AnalysisMode.OP,
            options={"use_krylov": True, "krylov_rank": "auto", "krylov_method": "arnoldi_gmres"},
        )
    )

    assert response.status == "ok"
    assert response.metadata["krylov_matrix_kind"] == "positive_definite"
    assert response.metadata["krylov_requested_method"] == "arnoldi_gmres"
    assert response.metadata["krylov_method"] == "arnoldi_gmres"


def _large_rlc_mesh_netlist(size: int = 8) -> str:
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
    lines.append(".tran 80n 10n")
    lines.append(".end")
    return "\n".join(lines)


def _large_rlc_rect_netlist(rows: int = 23, cols: int = 23) -> str:
    lines = ["IIN n_0_0 0 STEP 1m 20n"]
    for row in range(rows):
        for col in range(cols):
            node = f"n_{row}_{col}"
            lines.append(f"C_{row}_{col} {node} 0 200p")
            lines.append(f"RG_{row}_{col} {node} 0 50Meg")
            if col + 1 < cols:
                lines.append(f"R_H_{row}_{col} {node} n_{row}_{col + 1} 25")
            if row + 1 < rows:
                lines.append(f"L_V_{row}_{col} {node} n_{row + 1}_{col} 20n")
    lines.append(f"RLOAD n_{rows - 1}_{cols - 1} 0 50")
    lines.append(".tran 200n 10n")
    lines.append(".end")
    return "\n".join(lines)


def test_sparse_mna_storage_matches_dense_matrices() -> None:
    problem = build_mna_problem(parse_netlist_text(_large_rlc_mesh_netlist(size=3)))

    assert problem.G_sparse is not None
    assert problem.C_sparse is not None
    assert np.allclose(problem.G_sparse.toarray(), problem.G)
    assert np.allclose(problem.C_sparse.toarray(), problem.C)
    assert problem.metadata["matrix_storage"] == "dense+csr"


def test_large_rlc_sparse_benchmark_has_roughly_1000_unknowns() -> None:
    problem = build_mna_problem(parse_netlist_text(_large_rlc_rect_netlist()))
    operator = problem.G_sparse + problem.C_sparse / 10e-9

    assert problem.G.shape == (1035, 1035)
    assert problem.metadata["num_nodes"] == 529
    assert problem.metadata["num_branches"] == 506
    assert operator.nnz == 4071
    assert operator.nnz / (operator.shape[0] * operator.shape[1]) < 0.01


def _run_rlc_energy(size: int, t_stop: str, t_step: str) -> tuple[np.ndarray, np.ndarray]:
    netlist_lines = _large_rlc_mesh_netlist(size).splitlines()
    netlist_lines[-2] = f".tran {t_stop} {t_step}"
    probes = [f"V(n_{row}_{col})" for row in range(size) for col in range(size)]
    probes += [f"I(L_V_{row}_{col})" for row in range(size - 1) for col in range(size)]
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="\n".join(netlist_lines),
            mode=AnalysisMode.TRAN,
            options={"probe_nodes": probes},
        )
    )

    assert response.status == "ok"
    assert response.waveform is not None
    labels = response.waveform["labels"]
    values = np.asarray(response.waveform["values"])
    times = np.asarray(response.waveform["time"])
    label_to_index = {label: index for index, label in enumerate(labels)}
    energy = np.zeros_like(times, dtype=float)
    for row in range(size):
        for col in range(size):
            voltage = values[label_to_index[f"V(n_{row}_{col})"]]
            energy += 0.5 * 200e-12 * voltage * voltage
    for row in range(size - 1):
        for col in range(size):
            current = values[label_to_index[f"I(L_V_{row}_{col})"]]
            energy += 0.5 * 20e-9 * current * current
    return times, energy


def test_transient_time_grid_ends_at_requested_stop() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text="""
            I1 n1 0 STEP 1m 20n
            R1 n1 0 1k
            .tran 200n 10n
            .end
            """,
            mode=AnalysisMode.TRAN,
            options={"probe_nodes": ["V(n1)"]},
        )
    )

    assert response.status == "ok"
    assert response.waveform is not None
    times = np.asarray(response.waveform["time"])
    assert len(times) == 21
    assert np.isclose(times[-1], 200e-9)


def test_large_rlc_mesh_energy_converges_when_time_step_is_halved() -> None:
    times_10n, energy_10n = _run_rlc_energy(size=6, t_stop="200n", t_step="10n")
    times_5n, energy_5n = _run_rlc_energy(size=6, t_stop="200n", t_step="5n")

    assert len(times_10n) == 21
    assert len(times_5n) == 41
    assert np.isfinite(energy_5n).all()
    assert energy_5n.max() < 1e-10
    assert np.isclose(energy_5n[-1], energy_10n[-1], rtol=5e-2, atol=1e-18)


def test_large_rlc_mesh_routes_to_symmetric_krylov_and_runs() -> None:
    response = SimulationService().run_request(
        AnalysisRequest(
            netlist_text=_large_rlc_rect_netlist(),
            mode=AnalysisMode.TRAN,
            options={"use_krylov": True, "krylov_rank": "auto", "probe_nodes": ["V(n_0_0)", "V(n_11_11)", "I(L_V_10_11)"]},
        )
    )

    assert response.status == "ok"
    assert response.waveform is not None
    assert len(response.waveform["time"]) == 21
    assert response.metadata["krylov_matrix_dimension"] == 1035
    assert response.metadata["krylov_matrix_kind"] == "symmetric"
    assert response.metadata["krylov_method"] == "minres"
    assert response.metadata["krylov_resolved_rank"] == 518
    assert response.metadata["krylov_operator_storage"] == "csr"
    assert response.metadata["matrix_nnz"] == 4071
    assert response.metadata["matrix_density"] < 0.01
    assert response.metadata["krylov_used_direct_fallback"] is False
    assert response.metadata["krylov_solve_count"] > 0
