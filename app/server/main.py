"""FastAPI application for the simulator service."""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from mna_simulation.api.contracts import (
    AnalysisMode,
    AnalysisRequest,
    SchematicDocument,
    SimulationResponse,
)
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


@app.websocket("/ws/dyn")
async def dyn_stream(ws: WebSocket) -> None:
    """Realtime ``.dyn`` streaming endpoint.

    Protocol (JSON messages):
        client -> {
            "schematic": SchematicDocument,
            "speed": <s_per_s>,          # simulation seconds per wall-clock second
            "t_stop": "10m",
            "t_step": "0.1m",
            "nodes": ["n1", "n2"]        # optional subset filter
        }
        server -> {"type": "meta", "labels": [...], "t_stop": <float>}
        server -> {"type": "frame", "t": <float>, "values": [...] }   (many)
        server -> {"type": "done"}
    """

    await ws.accept()
    try:
        raw = await ws.receive_text()
        payload = json.loads(raw)
        schematic_dict = payload.get("schematic") or {}
        if not schematic_dict:
            await ws.send_text(json.dumps({"type": "error", "message": "missing schematic"}))
            await ws.close()
            return
        schematic = SchematicDocument(**schematic_dict)
        speed = float(payload.get("speed", 1e-3))
        t_stop = payload.get("t_stop", "10m")
        t_step = payload.get("t_step", "0.1m")
        node_filter = payload.get("nodes") or None

        request = AnalysisRequest(
            netlist_text="",
            mode=AnalysisMode.TRAN,
            options={"t_stop": t_stop, "t_step": t_step},
            schematic=schematic,
        )
        loop = asyncio.get_event_loop()
        try:
            response = await loop.run_in_executor(None, service.run_request, request)
        except CircuitSimulatorError as exc:
            await ws.send_text(json.dumps({"type": "error", "message": exc.message}))
            await ws.close()
            return

        waveform = response.waveform
        if waveform is None:
            await ws.send_text(json.dumps({"type": "error", "message": "no waveform produced"}))
            await ws.close()
            return

        times = waveform["time"]
        values = waveform["values"]
        labels = waveform["labels"]

        idxs: list[int]
        if node_filter:
            idxs = [i for i, lbl in enumerate(labels) if lbl in node_filter]
        else:
            idxs = list(range(len(labels)))

        kept_labels = [labels[i] for i in idxs]

        await ws.send_text(
            json.dumps(
                {
                    "type": "meta",
                    "labels": kept_labels,
                    "t_stop": float(times[-1]) if times else 0.0,
                    "speed": speed,
                }
            )
        )

        t0_wall = time.monotonic()
        t0_sim = float(times[0]) if times else 0.0
        effective_speed = speed if speed > 0 else 1e-3

        for step_idx, t_sim in enumerate(times):
            target_wall = t0_wall + (float(t_sim) - t0_sim) / effective_speed
            now = time.monotonic()
            if target_wall > now:
                await asyncio.sleep(target_wall - now)
            row = values[step_idx] if step_idx < len(values) else []
            filtered = [row[i] if i < len(row) else 0.0 for i in idxs]
            try:
                await ws.send_text(
                    json.dumps({"type": "frame", "t": float(t_sim), "values": filtered})
                )
            except WebSocketDisconnect:
                return

        await ws.send_text(json.dumps({"type": "done"}))
    except WebSocketDisconnect:
        return
    except Exception as exc:  # noqa: BLE001
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(exc)}))
        except Exception:  # noqa: BLE001
            pass
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
