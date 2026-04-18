"""Frontend-facing orchestration service."""

from __future__ import annotations

from dataclasses import asdict

import numpy as np

from .contracts import AnalysisRequest, SimulationResponse
from ..backends.python_backend import PythonBackend
from ..errors import CircuitSimulatorError
from ..schematic_pipeline import schematic_to_circuit_ir
from ..utils import ndarray_to_list


class SimulationService:
    """Single orchestration entry point shared by CLI and HTTP API."""

    def __init__(self, backend: PythonBackend | None = None) -> None:
        self.backend = backend or PythonBackend()

    def run_request(self, request: AnalysisRequest) -> SimulationResponse:
        """Run a request and convert the result to a JSON-safe response."""

        generated_netlist: str | None = None
        if request.schematic is not None:
            converted = schematic_to_circuit_ir(
                schematic=request.schematic,
                mode_override=request.mode,
                option_overrides=request.options,
            )
            circuit = converted.circuit
            generated_netlist = converted.netlist_text
        else:
            circuit = self.backend.parse_text(request.netlist_text)
        options = self.backend.build_options(circuit, overrides=request.options, mode=request.mode)
        result = self.backend.run(circuit, options)
        if generated_netlist is not None:
            result.metadata = dict(result.metadata)
            result.metadata["generated_netlist"] = generated_netlist

        waveform = None
        if result.waveform is not None:
            waveform = {
                "time": ndarray_to_list(result.waveform.time),
                "values": ndarray_to_list(result.waveform.values),
                "labels": result.waveform.labels,
            }

        spectrum = None
        if result.spectrum is not None:
            spectrum = {
                "frequencies": ndarray_to_list(result.spectrum.frequencies),
                "magnitudes": ndarray_to_list(result.spectrum.magnitudes),
                "labels": result.spectrum.labels,
            }

        matrices = None
        if result.matrices is not None:
            matrices = {name: ndarray_to_list(value) for name, value in result.matrices.items()}

        dc_solution = None
        if result.dc_solution is not None:
            dc_solution = np.asarray(result.dc_solution).flatten().tolist()

        return SimulationResponse(
            mode=result.mode,
            status=result.status,
            labels=result.labels,
            diagnostics=result.diagnostics,
            metadata=result.metadata,
            dc_solution=dc_solution,
            waveform=waveform,
            spectrum=spectrum,
            matrices=matrices,
        )

    def healthcheck(self) -> dict[str, object]:
        """Return backend information for the UI."""

        return {
            "status": "ok",
            "capabilities": asdict(self.backend.capabilities),
            "models": [model.name for model in self.backend.registry.list_models()],
        }
