"""Basic analysis core for .op, .tran, and .ac."""

from __future__ import annotations

from .api.contracts import AnalysisMode, AnalysisOptions, MnaProblem, SimulationResult
from .mna_builder import build_mna_problem
from .solvers import describe_krylov_choice, solve_ac, solve_dc_nr, solve_transient


def _linear_solver_kwargs(options: AnalysisOptions, stats: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {
        "use_krylov": options.use_krylov,
        "krylov_tol": options.krylov_tol,
        "krylov_max_iter": options.krylov_max_iter,
        "krylov_restart": options.krylov_restart,
        "krylov_rank": options.krylov_rank,
        "krylov_method": options.krylov_method,
        "krylov_stats": stats,
    }


def _result_metadata(
    problem: MnaProblem,
    options: AnalysisOptions,
    stats: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    metadata = dict(problem.metadata)
    if options.use_krylov:
        choice = describe_krylov_choice(
            problem.G,
            rank=options.krylov_rank,
            fallback_restart=options.krylov_restart,
            max_iter=options.krylov_max_iter,
            method=options.krylov_method,
        )
        last = stats[-1] if stats else choice
        methods = sorted({str(entry.get("method", "")) for entry in (stats or [choice]) if entry.get("method")})
        metadata.update(
            {
                "linear_solver": "krylov",
                "krylov_matrix_kind": last.get("matrix_kind", choice["matrix_kind"]),
                "krylov_policy": "manual override allowed; auto: positive-definite=CG, symmetric=MINRES/CR, general=Arnoldi/GMRES",
                "krylov_requested_method": last.get("requested_method", options.krylov_method),
                "krylov_method": last.get("method"),
                "krylov_engine": last.get("engine", "python"),
                "krylov_methods": methods,
                "krylov_matrix_dimension": last.get("matrix_dimension", choice["matrix_dimension"]),
                "matrix_nnz": last.get("matrix_nnz"),
                "matrix_density": last.get("matrix_density"),
                "krylov_operator_storage": last.get("operator_storage"),
                "krylov_rank_mode": last.get("rank_mode", choice["rank_mode"]),
                "krylov_resolved_rank": last.get("resolved_rank", choice["resolved_rank"]),
                "krylov_iteration_budget": last.get("iteration_budget", choice["iteration_budget"]),
                "krylov_iterations": sum(int(entry.get("iterations", 0) or 0) for entry in (stats or [])),
                "krylov_solve_count": len(stats or []),
                "krylov_converged": all(bool(entry.get("converged")) for entry in (stats or [])) if stats else None,
                "krylov_used_direct_fallback": any(bool(entry.get("used_direct_fallback")) for entry in (stats or [])),
            }
        )
    return metadata


def run_basic_analysis(problem: MnaProblem, options: AnalysisOptions) -> SimulationResult:
    """Run one of the basic analyses on a prebuilt MNA problem."""

    labels = problem.metadata.get("labels", [])
    krylov_stats: list[dict[str, object]] | None = [] if options.use_krylov else None
    linear_kwargs = _linear_solver_kwargs(options, krylov_stats)

    if options.mode == AnalysisMode.SHOW_MATRIX:
        metadata = _result_metadata(problem, options, krylov_stats)
        return SimulationResult(
            mode=options.mode,
            status="ok",
            matrices={
                "G": problem.G,
                "C": problem.C,
                "f_str": problem.f_str,
                "b_dc": problem.b_dc,
                "b_ac": problem.b_ac,
                "b_time_str": problem.b_time_str,
            },
            labels=labels,
            metadata=metadata,
        )

    if options.mode == AnalysisMode.OP:
        init_cond = options.init_condition if options.init_condition is not None else "DEFAULT"
        solver_f_str = problem.solver_f_str if problem.solver_f_str is not None else problem.f_str
        solution = solve_dc_nr(
            problem.G,
            solver_f_str,
            problem.b_dc,
            max_iter=options.max_iter,
            v_tol=options.v_tol,
            f_tol=options.f_tol,
            init_cond=init_cond,
            level1_mos_devices=problem.level1_mos_devices,
            **linear_kwargs,
        )
        metadata = _result_metadata(problem, options, krylov_stats)
        return SimulationResult(
            mode=options.mode,
            status="ok",
            dc_solution=solution,
            labels=labels,
            metadata=metadata,
        )

    if options.mode == AnalysisMode.TRAN:
        waveform = solve_transient(
            problem,
            t_stop=options.tran_stop or 0.1,
            t_step=options.tran_step or 1e-5,
            max_iter=options.max_iter,
            v_tol=options.v_tol,
            f_tol=options.f_tol,
            init_cond=options.init_condition if not isinstance(options.init_condition, str) else None,
            **linear_kwargs,
        )
        metadata = _result_metadata(problem, options, krylov_stats)
        return SimulationResult(
            mode=options.mode,
            status="ok",
            waveform=waveform,
            labels=waveform.labels,
            metadata=metadata,
        )

    if options.mode == AnalysisMode.AC:
        spectrum = solve_ac(
            problem,
            f_start=options.ac_start or 1.0,
            f_stop=options.ac_stop or 1e6,
            points=options.ac_points or 100,
            **linear_kwargs,
        )
        metadata = _result_metadata(problem, options, krylov_stats)
        return SimulationResult(
            mode=options.mode,
            status="ok",
            spectrum=spectrum,
            labels=spectrum.labels,
            metadata=metadata,
        )

    raise ValueError(f"Unsupported basic analysis mode: {options.mode}")


def build_and_run_basic(circuit, options: AnalysisOptions, gmin: float = 0.0) -> SimulationResult:
    """Construct the MNA problem and execute a basic analysis."""

    problem = build_mna_problem(circuit, gmin=gmin)
    return run_basic_analysis(problem, options)
