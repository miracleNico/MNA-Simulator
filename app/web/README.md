# Schematic Demo Startup

This frontend now runs a backend-owned schematic pipeline:

1. The browser sends schematic JSON (`components`, `wires`, `analysis`) to `/api/simulate`.
2. The server converts wires/pins to formed nets.
3. The server generates canonical netlist text and parses it into `CircuitIR`.
4. Existing solver core runs unchanged.

## Run the demo

From repository root:

1. Start backend API:

   `python -m uvicorn app.server.main:app --host 127.0.0.1 --port 8010`

2. In another terminal, start frontend:

   `cd app/web && npm run dev`

   Optional override: set `VITE_API_PORT` before starting Vite to target a different backend port.

3. Open the Vite URL (typically `http://127.0.0.1:5173`).

## Using the demo

- Load a preset from the controls panel.
- Place additional devices from the palette.
- Click two pins to create a wire.
- Adjust values and analysis mode (`.op`, `.tran`, `.ac`).
- Click **Run Schematic Demo**.
- Inspect:
  - **Client Netlist Preview** (UI-side rough view),
  - **Backend Generated Netlist** (server canonical text),
  - **API Preview** JSON result.

## Supported first-pass devices

- `GND`
- `R`, `C`, `L`
- `V`, `I` (DC/AC/SIN/COS in UI editor)
- `D`
