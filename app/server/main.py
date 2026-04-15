"""FastAPI application for the simulator service."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from mna_simulation.api.contracts import AnalysisRequest, SimulationResponse
from mna_simulation.api.service import SimulationService
from mna_simulation.errors import CircuitSimulatorError

app = FastAPI(title="MNA Simulation Service", version="0.60.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

service = SimulationService()


@app.get("/health")
def health() -> dict[str, object]:
    """Return service health and backend capabilities."""

    return service.healthcheck()


@app.post("/api/simulate", response_model=SimulationResponse)
def simulate(request: AnalysisRequest) -> SimulationResponse:
    """Run a simulation request."""

    try:
        return service.run_request(request)
    except CircuitSimulatorError as exc:
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc
