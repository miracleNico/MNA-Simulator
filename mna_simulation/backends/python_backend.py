"""Python backend adapter for solver execution."""

from __future__ import annotations

from pathlib import Path

from ..api.contracts import AnalysisMode, AnalysisOptions, BackendCapabilities, CircuitIR, DirectiveRecord, SimulationResult
from ..core_advanced import build_and_run_advanced
from ..core_basic import build_and_run_basic
from ..library.registry import DeviceRegistry, create_default_registry
from ..netlist import parse_netlist_file, parse_netlist_text, select_analysis
from ..utils import DEFAULT_GMIN_STEPS


class PythonBackend:
    """Default backend using the extracted Python numerical stack."""

    def __init__(self, registry: DeviceRegistry | None = None) -> None:
        self.registry = registry or create_default_registry(Path(__file__).resolve().parent.parent / "library" / "models")
        self.capabilities = BackendCapabilities(
            supports_behavioral_sources=True,
            supports_harmonic_balance=True,
            supports_sparse_linear_solver=False,
            supports_cpp_acceleration=False,
        )

    def parse_text(self, netlist_text: str) -> CircuitIR:
        return parse_netlist_text(netlist_text)

    def parse_file(self, path: str | Path) -> CircuitIR:
        return parse_netlist_file(path)

    def build_options(self, circuit: CircuitIR, overrides: dict | None = None, mode: AnalysisMode | None = None) -> AnalysisOptions:
        # ``.dyn`` is a UI-only mode that is executed as a ``.tran`` on the backend;
        # the realtime streaming pace is controlled by the ``/ws/dyn`` endpoint.
        effective_mode = mode
        if effective_mode == AnalysisMode.DYN:
            effective_mode = AnalysisMode.TRAN
        directive: DirectiveRecord = select_analysis(circuit, fallback=effective_mode or AnalysisMode.SHOW_MATRIX)
        option_values = dict(directive.params)
        if overrides:
            option_values.update(overrides)

        return AnalysisOptions(
            mode=effective_mode or directive.mode,
            gmin_steps=option_values.get("gmin_steps", DEFAULT_GMIN_STEPS),
            max_iter=int(option_values.get("max_iter", 10000)),
            v_tol=float(option_values.get("v_tol", 1e-9)),
            f_tol=float(option_values.get("f_tol", 1e-9)),
            tran_stop=option_values.get("t_stop"),
            tran_step=option_values.get("t_step"),
            ac_start=option_values.get("f_start"),
            ac_stop=option_values.get("f_stop"),
            ac_points=option_values.get("points"),
            hb_harmonics=option_values.get("harmonics"),
            hb_time_window=option_values.get("time_window"),
            init_condition=option_values.get("init_condition"),
        )

    def run(self, circuit: CircuitIR, options: AnalysisOptions) -> SimulationResult:
        """Execute a simulation with Gmin stepping."""

        last_error: Exception | None = None
        for gmin in options.gmin_steps:
            try:
                if options.mode == AnalysisMode.HB:
                    result = build_and_run_advanced(circuit, options, gmin=gmin)
                else:
                    result = build_and_run_basic(circuit, options, gmin=gmin)
                result.metadata = dict(result.metadata)
                result.metadata["gmin"] = gmin
                return result
            except Exception as exc:  # noqa: BLE001
                last_error = exc
        if last_error is not None:
            raise last_error
        raise RuntimeError("Simulation failed without producing a result.")
