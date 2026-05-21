# Project Structure and File Functions

This document describes the project-authored source, config, docs, and tests. It intentionally ignores dependency trees such as `app/web/node_modules`.

## End-to-End Flow

1. A request enters from CLI (`mna_simulation/cli.py`), HTTP (`app/server/main.py`), or the React schematic editor.
2. `SimulationService` (`mna_simulation/api/service.py`) normalizes request handling.
3. Raw netlists go directly to the parser. Schematic JSON goes through `mna_simulation/schematic_pipeline.py`.
4. The schematic pipeline validates hierarchy, flattens `SUBCKT` instances, forms nets, emits canonical netlist text, and parses it back into `CircuitIR`.
5. `mna_simulation/backends/python_backend.py` builds `AnalysisOptions`.
6. `mna_simulation/netlist.py` and `mna_simulation/mna_builder.py` produce the MNA problem.
7. `mna_simulation/solvers.py` executes `.op`, `.tran`, `.ac`, or `.hb`.
8. Results return through the API service and are plotted by the frontend.

## Root Files

### `README.md`
- Project-level usage guide.
- Covers setup, CLI/API usage, hierarchy behavior, supported devices/modes, tests, and frontend startup.

### `STRUCT.md`
- This file-by-file architecture reference.

### `pyproject.toml`
- Python package metadata.
- Declares runtime dependencies (`numpy`, `sympy`, `fastapi`, `uvicorn`, etc.).
- Declares dev dependencies (`pytest`, `httpx`).
- Registers CLI entrypoint: `mna-sim = mna_simulation.cli:main`.

## Python Package: `mna_simulation/`

### `mna_simulation/__init__.py`
- Package exports for top-level use.

### `mna_simulation/errors.py`
- Central exception hierarchy.
- `error_handler(message)` maps coded failures such as `NETLIST_FATAL` into typed exceptions.

### `mna_simulation/utils.py`
- Numeric and serialization helpers.
- Includes suffix parsing (`k`, `u`, `meg`, etc.) and JSON-safe ndarray conversion.

### `mna_simulation/device_models.py`
- Symbolic source and nonlinear device expression builders.
- Builds time-domain source expressions and diode current expressions.

### `mna_simulation/netlist.py`
- Text netlist tokenizer, parser, and validator.
- Parses directives (`.op`, `.tran`, `.ac`, `.hb`) and supported device lines.
- Supports extended BJT/MOS small-signal parameter forms.
- Emits backend-neutral `CircuitIR`.

### `mna_simulation/mna_builder.py`
- Converts `CircuitIR` to `MnaProblem`.
- Builds conductance/capacitance matrices, RHS vectors, nonlinear vectors, labels, and branch maps.
- Stamps passive devices, sources, controlled sources, diodes, BJTs, and MOSFETs.

### `mna_simulation/solvers.py`
- Numerical solver library.
- Implements Newton-Raphson DC, Backward-Euler transient, linear AC sweep, harmonic balance, and time reconstruction helpers.

### `mna_simulation/core_basic.py`
- Facade for `.op`, `.tran`, `.ac`, and matrix inspection.

### `mna_simulation/core_advanced.py`
- Facade for `.hb`.
- Infers base frequency from sinusoidal sources and optionally reconstructs time-domain waveforms from harmonic-balance coefficients.

### `mna_simulation/schematic_pipeline.py`
- Backend-owned schematic graph to netlist conversion.
- Validates component pins, disconnected pins, ground presence, and hierarchy ports.
- Flattens `SUBCKT` instances using logical paths such as `DiffAmp.in`.
- Requires child schematics to expose matching local `port_<pin>` junctions.
- Keeps top-level net names stable while naming hierarchy-internal nets separately.

### `mna_simulation/cli.py`
- Command-line interface.
- Commands: `run <path>` and `run-text <netlist_text>`.
- Supports optional mode overrides and JSON output.

## API Layer: `mna_simulation/api/`

### `mna_simulation/api/contracts.py`
- Shared contracts for parser, builder, solver, service, and UI.
- Contains analysis enums, IR dataclasses, result dataclasses, API Pydantic models, and schematic graph models.
- `SchematicComponent` includes hierarchy metadata, arbitrary device metadata, and transistor defaults.

### `mna_simulation/api/service.py`
- Orchestration entrypoint used by CLI and FastAPI.
- Routes schematic payloads through `schematic_pipeline`.
- Adds generated canonical netlist text to response metadata.

## Backends: `mna_simulation/backends/`

### `mna_simulation/backends/python_backend.py`
- Active backend adapter.
- Parses netlists, builds options from directives, runs analysis, and exposes capability flags.

### `mna_simulation/backends/cpp_backend.py`
- Placeholder adapter for a future C++ core.

## Model Library: `mna_simulation/library/`

### `mna_simulation/library/registry.py`
- Registry abstraction for built-in and user-defined models.
- Loads optional JSON model cards.

### `mna_simulation/library/models/behavioral_resistor.json`
- Example registry model-card metadata.

## Server App: `app/server/`

### `app/server/main.py`
- FastAPI entrypoint.
- Exposes:
  - `GET /health`
  - `POST /api/simulate`
  - websocket dynamic simulation route used by frontend display/probe flows
- Translates simulator errors into HTTP 400 payloads.

## Web App: `app/web/`

### `app/web/README.md`
- Frontend startup and usage notes.

### `app/web/package.json`
- Frontend scripts and dependencies.
- Main scripts: `dev`, `build`, `preview`.

### `app/web/vite.config.ts`
- Vite + React config.
- Proxies `/api`, `/health`, and websocket traffic to the backend.

### `app/web/src/main.tsx`
- React bootstrap.

### `app/web/src/styles.css`
- Global styling for shell, controls, canvas, hierarchy tree, plot tiles, and dialogs.

### `app/web/src/lib/schematic.ts`
- Frontend schematic model and payload conversion.
- Defines device types, component/wire/level types, pin layouts, geometry helpers, net-label computation, and `buildSchematicPayload()`.
- Expands frontend `NODE` markers into backend `port_<name>` junctions.
- Repairs stale `SUBCKT` wire endpoint names before sending payloads.

### `app/web/src/lib/demoPresets.ts`
- Hidden demo schematics.
- Includes CE amplifier and BJT 3-stage amplifier.
- 3-stage amplifier uses real `SUBCKT` child levels and editable `NODE` ports rather than hardcoded fixed port junctions.

### `app/web/src/lib/plot.ts`
- Canvas plotting helpers for line, stem, and bar visualizations.
- Used by `.op`, `.tran`, `.ac`, `.hb`, and dynamic plots.

### `app/web/src/lib/symbols.ts`
- Canvas symbol drawing for schematic components.
- Includes passives, sources, controlled sources, transistor symbols, labels, nodes, and subcircuits.

### `app/web/src/components/Toolbar.tsx`
- Component toolbar.
- Exposes primitives, controlled sources, transistors, `SUBCKT`, `LABEL`, `NODE`, probe, and run controls.

### `app/web/src/components/LeftPane.tsx`
- Simulation controls, hierarchy tree, library list, and property editor.
- Supports `SUBCKT` displayed/entity name, node count, editable pin names, transistor small-signal fields, and display-node controls.

### `app/web/src/components/SchematicCanvas.tsx`
- Schematic graph editor.
- Handles hit-testing, selection, dragging, wiring, marquee selection, copy/paste, deletion, rotation, hover badges, and drawing.
- Allows `NODE` markers to be selected and edited while still acting as wire endpoints.

### `app/web/src/components/PlotTile.tsx`
- Movable/resizable plot tile wrapper.
- Supports static and dynamic streaming plots.

### `app/web/src/pages/App.tsx`
- Main frontend orchestration component.
- Owns hierarchy levels, active level, analysis settings, selection, tiles, generated netlist preview, and API calls.
- Synchronizes child `NODE` port renames to only the matching `SUBCKT` instances.
- Rewrites stale `SUBCKT` wire endpoints when pins are renamed.

### `app/web/src/components/AnalysisPanel.tsx`
- Older/legacy panel component retained in the tree.
- The current UI path is driven primarily through `LeftPane.tsx` and `App.tsx`.

## Tests: `tests/`

### `tests/test_parser_and_builder.py`
- Parser and MNA builder regression tests.

### `tests/test_netlist_extensions.py`
- Extended netlist/device tests.
- Covers BJT/MOS parsing and small-signal stamping.

### `tests/test_harmonic_balance.py`
- Harmonic balance regression tests, including frequency handling and reconstruction behavior.

### `tests/test_schematic_pipeline.py`
- Schematic conversion and hierarchy tests.
- Covers top-level net naming, 3-level hierarchy flattening, logical port names, and port mismatch failures.

### `tests/test_service.py`
- Service-level API response tests.

## Benchmarks: `benchmarks/`

### `benchmarks/benchmark_basic.py`
- Lightweight benchmark for the basic solver path.

## Legacy: `legacy/`

- Historical simulator snapshots.
- Useful for comparisons, but not part of the active runtime path.

## Practical Reading Order

1. `mna_simulation/api/contracts.py`
2. `mna_simulation/netlist.py`
3. `mna_simulation/mna_builder.py`
4. `mna_simulation/solvers.py`
5. `mna_simulation/schematic_pipeline.py`
6. `mna_simulation/api/service.py`
7. `app/server/main.py`
8. `app/web/src/lib/schematic.ts`
9. `app/web/src/pages/App.tsx`
10. `app/web/src/components/SchematicCanvas.tsx`
