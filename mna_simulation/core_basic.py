"""Basic analysis core for .op, .tran, and .ac."""

from __future__ import annotations

from .api.contracts import AnalysisMode, AnalysisOptions, MnaProblem, SimulationResult
from .mna_builder import build_mna_problem
from .solvers import solve_ac, solve_dc_nr, solve_transient


def run_basic_analysis(problem: MnaProblem, options: AnalysisOptions) -> SimulationResult:
    """Run one of the basic analyses on a prebuilt MNA problem."""

    labels = problem.metadata.get("labels", [])

    if options.mode == AnalysisMode.SHOW_MATRIX:
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
            metadata=problem.metadata,
        )

    if options.mode == AnalysisMode.OP:
        init_cond = options.init_condition if options.init_condition is not None else "DEFAULT"
        solution = solve_dc_nr(
            problem.G,
            problem.f_str,
            problem.b_dc,
            max_iter=options.max_iter,
            v_tol=options.v_tol,
            f_tol=options.f_tol,
            init_cond=init_cond,
        )
        return SimulationResult(
            mode=options.mode,
            status="ok",
            dc_solution=solution,
            labels=labels,
            metadata=problem.metadata,
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
        )
        return SimulationResult(
            mode=options.mode,
            status="ok",
            waveform=waveform,
            labels=waveform.labels,
            metadata=problem.metadata,
        )

    if options.mode == AnalysisMode.AC:
        spectrum = solve_ac(
            problem,
            f_start=options.ac_start or 1.0,
            f_stop=options.ac_stop or 1e6,
            points=options.ac_points or 100,
        )
        return SimulationResult(
            mode=options.mode,
            status="ok",
            spectrum=spectrum,
            labels=spectrum.labels,
            metadata=problem.metadata,
        )

    raise ValueError(f"Unsupported basic analysis mode: {options.mode}")


def build_and_run_basic(circuit, options: AnalysisOptions, gmin: float = 0.0) -> SimulationResult:
    """Construct the MNA problem and execute a basic analysis."""

    problem = build_mna_problem(circuit, gmin=gmin)
    return run_basic_analysis(problem, options)
