# MNA Simulation

Layered circuit-simulation workbench built around Modified Nodal Analysis (MNA).

The project includes:

- Python simulation core for `.op`, `.tran`, `.ac`, and `.hb`.
- FastAPI service for schematic and netlist simulation.
- React + TypeScript schematic editor.
- Backend-owned schematic-to-netlist pipeline with hierarchy validation.
- Small-signal BJT/MOSFET models, plus nonlinear Level-1 MOSFET transient support.
- Sparse Krylov-capable solver path for large linear transient circuits.

## Highlights

- **Single validation path:** schematic JSON is flattened to canonical netlist text, then parsed by the same parser used for raw netlists.
- **Hierarchy-aware schematics:** `SUBCKT` instances connect to child ports through editable `NODE` markers. A child node named `in` exports as `port_in` and flattens as logical instance names such as `DiffAmp.in`.
- **Scoped child ports:** each child entity owns its own port names. Renaming ports in one child syncs only instances of that entity and repairs connected wire endpoints.
- **Non-ideal transistor defaults:** `QNPN`, `QPNP`, `NMOS`, and `PMOS` use regular small-signal parameters by default, while extra parasitic-only parameters can still be set to zero.
- **Harmonic balance workflow:** `.hb <harmonics> [time_window]` supports harmonic-domain results and optional reconstructed time-domain waveforms.
- **Krylov controls:** API/UI requests can use automatic method selection or explicitly choose Arnoldi/GMRES, MINRES/CR, or Conjugate Gradient. Auto Krylov rank resolves after MNA assembly as `ceil(0.5 * matrix_dimension)`.
- **Sparse large-circuit path:** linear transient Krylov runs can use cached SciPy CSR Backward-Euler operators instead of dense conversion on every step.
- **Functional MOS SRAM demo:** the Large Scale Circuits menu includes a 10x10 Level-1 MOS 6T SRAM demo with FUNC-driven write/hold/read timing.
- **Large RLC benchmark demo:** the 23x23 distributed RLC mesh produces a 1035-unknown sparse MNA system for Krylov/MINRES benchmarking.
- **Editable netlist mode:** the web app can switch from schematic mode to raw netlist editing after a confirmation that clears the schematic hierarchy.
- **Interactive visualization:** `.op`, `.tran`, `.ac`, `.hb`, and `.dyn` results render in movable plot tiles, with selectable display nodes.

## Repository Layout

- `mna_simulation/`: Python parser, MNA builder, solvers, schematic pipeline, API service, and backend adapters.
- `app/server/`: FastAPI app exposing `/health`, `/api/simulate`, and dynamic simulation websocket routes.
- `app/web/`: React + TypeScript schematic editor and demo UI.
- `tests/`: parser, builder, service, harmonic-balance, transistor, and hierarchy regression tests.
- `benchmarks/`: lightweight benchmark entry points.
- `legacy/`: older simulator snapshots kept for comparison.
- `STRUCT.md`: file-by-file architecture reference.

## Quick Start

Install the Python package with dev dependencies:

```bash
python -m pip install -e ".[dev]"
```

Start the backend API:

```bash
python -m uvicorn app.server.main:app --host 127.0.0.1 --port 8010
```

Start the frontend:

```bash
cd app/web
npm install
npm run dev
```

The frontend proxies `/api`, `/health`, and websocket simulation traffic to `http://127.0.0.1:8010` by default. Set `VITE_API_PORT` before starting Vite to use a different backend port.

## CLI Usage

Run a netlist file:

```bash
python -m mna_simulation.cli run path/to/circuit.cir
```

Run inline netlist text:

```bash
python -m mna_simulation.cli run-text "V1 n1 0 DC 5\nR1 n1 0 1k\n.op\n.end"
```

Return JSON:

```bash
python -m mna_simulation.cli run path/to/circuit.cir --json
```

## API

- `GET /health`: service health, backend capabilities, and model registry metadata.
- `POST /api/simulate`: accepts either `netlist_text` or structured `schematic` JSON.
- `WS /ws/dyn`: dynamic transient stream used by the frontend display/probe tools.

Schematic runs return the generated canonical netlist in response metadata. Simulation options include:

- `use_krylov`: enable the iterative solver path.
- `krylov_rank`: `"auto"` or any positive integer.
- `krylov_method`: `"auto"`, `"arnoldi_gmres"`, `"conjugate_residual"`, or `"conjugate_gradient"`.
- `probe_nodes`: optional labels such as `V(n1)` or `I(L1)` for result filtering.
- `output_max_points`: optional waveform decimation limit for API responses.

## Supported Devices

- Passive: `R`, `C`, `L`.
- Sources: `V`, `I` with `DC`, `AC`, `SIN`, `COS`, `STEP`, and `FUNC`.
- Nonlinear/behavioral: `D`, behavioral source path.
- Controlled sources: `VCVS`, `VCCS`, `CCCS`, `CCVS`.
- Transistors: `QNPN`, `QPNP`, `NMOS`, `PMOS` small-signal models.
- Physical MOS mode: `M1 d g s NMOS LEVEL1 beta vth lambda cgs cgd` and PMOS equivalent for nonlinear transient runs.
- Schematic-only frontend helpers: `SUBCKT`, `NODE`, `LABEL`, `GND`.

## Supported Analysis Modes

- `.op` / `.dc`
- `.tran <t_stop> [t_step]`
- `.ac <f_start> <f_stop> <points>`
- `.hb [harmonics] [time_window]`
- `.dyn` frontend websocket stream, executed by the backend as transient analysis.

## Schematic Demo Notes

The frontend supports:

- Component placement, selection, copy/paste, rotation, and deletion.
- Pin-to-pin and point-based wiring with orthogonal routing.
- Multi-level hierarchy with editable `SUBCKT` pin names.
- Editable `NODE` markers that connect by matching name within the same level.
- Editable child ports: a `NODE` named `in` in a child entity exports as `port_in`.
- Top-menu demos, including a BJT 3-stage amplifier built from real subcircuits and Large Scale Circuits presets.
- Raw netlist editing in the Visualization panel. Starting an edit asks for confirmation and then clears schematic hierarchy so the request is sent as `netlist_text`.
- Krylov controls with method override, auto/manual rank, and method-specific wording for restart versus iteration budget.
- `.op`, `.tran`, `.ac`, `.hb`, and dynamic display/probe visualization.

## Testing

Run all Python tests:

```bash
python -m pytest
```

Build the frontend:

```bash
cd app/web
npm run build
```

## Benchmark

```bash
python benchmarks/benchmark_basic.py
```

## Legacy Entry Points

Older simulator snapshots are under `legacy/`. They are retained for comparison and regression work, not as the primary runtime path.
