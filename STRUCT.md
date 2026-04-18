# Project Structure and File Functions

This document explains:

1. What each project file is responsible for.
2. The key code blocks and functions in the most important files.

Scope note: this covers project-authored source/config/docs/tests, not dependency trees like `app/web/node_modules`.

## End-to-End Flow

1. Input enters from CLI (`mna_simulation/cli.py`) or API (`app/server/main.py`).
2. `SimulationService` (`mna_simulation/api/service.py`) normalizes request handling.
3. If request is schematic JSON, `mna_simulation/schematic_pipeline.py` converts it to canonical netlist text and `CircuitIR`.
4. Backend adapter (`mna_simulation/backends/python_backend.py`) builds `AnalysisOptions`.
5. Netlist parser (`mna_simulation/netlist.py`) and MNA builder (`mna_simulation/mna_builder.py`) produce matrix problem.
6. Solver core (`mna_simulation/solvers.py`) executes `.op`, `.tran`, `.ac`, or `.hb`.
7. Response is converted into JSON-safe API payload and sent back.

---

## Root Files

### `README.md`
- Project-level usage guide.
- Covers setup, CLI/API usage, supported devices/modes, testing, benchmark, and demo startup.

### `STRUCT.md`
- This structure/function reference document.

### `pyproject.toml`
- Python project metadata and packaging.
- Declares runtime dependencies (`numpy`, `sympy`, `fastapi`, etc.).
- Declares dev dependencies (`pytest`, `httpx`).
- Registers CLI entrypoint: `mna-sim = mna_simulation.cli:main`.

### `mna_simulation_0_53.py`
- Legacy compatibility shim.
- Delegates old entrypoint behavior to new CLI `main()`.

---

## Python Package: `mna_simulation/`

### `mna_simulation/__init__.py`
- Package exports for top-level use.
- Re-exports `run_basic_analysis` and `run_advanced_analysis`.

### `mna_simulation/errors.py`
- Central exception hierarchy:
  - `CircuitSimulatorError`
  - `NetlistError`
  - `SolverConvergenceError`
- `error_handler(message)` parses coded messages (`NETLIST_FATAL`, `AC_ERROR`, etc.) and raises typed exceptions.

### `mna_simulation/utils.py`
- Generic helpers:
  - `parse_value()` for metric suffix parsing (`k`, `u`, `meg`, `%`, etc.).
  - `load_text_file()`.
  - `ensure_iterable_array()`.
  - `format_voltage_labels()`.
  - `ndarray_to_list()` for JSON-safe conversion (includes complex support).
- Defines `DEFAULT_GMIN_STEPS`.

### `mna_simulation/device_models.py`
- Source-expression and nonlinear-device expression builders.
- `source_expression(component)`: builds symbolic time-domain expressions for `SIN/COS/STEP/FUNC`.
- `diode_current_expression(...)`: returns Shockley-style diode current expression string.

### `mna_simulation/netlist.py`
- Text netlist tokenizer/parser/validator.
- Defines:
  - `Component` dataclass (line-level parsed component)
  - `Netlist` dataclass (whole-netlist constraints)
- Converts validated netlist to backend-neutral `CircuitIR`.

### `mna_simulation/mna_builder.py`
- Converts `CircuitIR` to full MNA problem (`MnaProblem`).
- Builds matrices/vectors:
  - `G`, `C`
  - nonlinear symbolic vector `f_str`
  - RHS vectors `b_dc`, `b_ac`, `b_time_str`
- Handles stamping for passive, independent, dependent, diode, and behavioral devices.

### `mna_simulation/solvers.py`
- Numerical solver library:
  - LU decomposition + triangular solves
  - Newton-Raphson DC
  - Backward-Euler transient
  - linearized AC sweep
  - Harmonic Balance (HB)
  - Fourier reconstruction helpers

### `mna_simulation/core_basic.py`
- Facade for `.op`, `.tran`, `.ac`, and matrix inspection.
- `run_basic_analysis(problem, options)` dispatches to correct solver and wraps output in `SimulationResult`.
- `build_and_run_basic(...)` convenience wrapper: build MNA + solve.

### `mna_simulation/core_advanced.py`
- Facade for `.hb`.
- Infers base frequency from source definitions, runs HB solve, and returns either spectrum or reconstructed waveform.
- `build_and_run_advanced(...)` convenience wrapper.

### `mna_simulation/schematic_pipeline.py`
- Backend-owned schematic graph to netlist conversion.
- Performs net formation via union-find over wire connectivity.
- Validates disconnected pins and ground requirements.
- Emits canonical netlist text and parsed `CircuitIR`.

### `mna_simulation/cli.py`
- Command-line interface.
- Commands:
  - `run <path>`
  - `run-text <netlist_text>`
- Supports optional `--mode` override and `--json`.

---

## API Layer: `mna_simulation/api/`

### `mna_simulation/api/__init__.py`
- Package marker for API layer.

### `mna_simulation/api/contracts.py`
- Shared contracts across parser/builder/solver/service/UI.
- Contains:
  - analysis enums
  - IR dataclasses (`CircuitIR`, `ComponentRecord`, `MnaProblem`, `SimulationResult`)
  - API models (`AnalysisRequest`, `SimulationResponse`)
  - schematic graph models and validators

### `mna_simulation/api/service.py`
- Orchestration entrypoint used by both CLI and FastAPI.
- Converts request -> backend run -> JSON-safe response.
- Injects generated backend netlist into metadata for schematic runs.

---

## Backends: `mna_simulation/backends/`

### `mna_simulation/backends/__init__.py`
- Package marker for backend adapters.

### `mna_simulation/backends/python_backend.py`
- Active execution backend.
- Responsibilities:
  - parse text/file netlists
  - build options from directives + overrides
  - run analysis with Gmin stepping retries
  - expose capabilities flags

### `mna_simulation/backends/cpp_backend.py`
- Placeholder API-compatible adapter for future pybind11/C++ core.
- Currently raises `NotImplementedError`.

---

## Model Library: `mna_simulation/library/`

### `mna_simulation/library/__init__.py`
- Package marker for model registry layer.

### `mna_simulation/library/registry.py`
- Registry abstraction for built-in and user-defined models.
- Defines:
  - `ModelDefinition`
  - `DeviceRegistry`
  - `create_default_registry()`
- Loads optional JSON model cards from directory.

### `mna_simulation/library/models/behavioral_resistor.json`
- Example model-card file for registry loading.
- Prototype metadata for a behavioral resistor concept.

---

## Server App: `app/server/`

### `app/server/main.py`
- FastAPI entrypoint.
- Exposes:
  - `GET /health`
  - `POST /api/simulate`
- Translates `CircuitSimulatorError` into HTTP 400 payloads.

---

## Web App: `app/web/`

### `app/web/README.md`
- Frontend demo startup and usage notes.
- Describes backend-owned schematic pipeline behavior.

### `app/web/index.html`
- Vite HTML shell with `#root` mount point.

### `app/web/package.json`
- Frontend dependency and script manifest (`dev`, `build`, `preview`).

### `app/web/package-lock.json`
- npm lockfile for deterministic installs.

### `app/web/tsconfig.json`
- TypeScript compiler configuration (`strict`, JSX, module behavior).

### `app/web/vite.config.ts`
- Vite config with React plugin.
- Dev proxy routes `/api` and `/health` to backend (default port `8010`).

### `app/web/src/main.tsx`
- React bootstrap and root render.

### `app/web/src/styles.css`
- Global styling for app shell, controls, schematic canvas, pin/wire visuals, previews.

### `app/web/src/lib/schematic.ts`
- Frontend data model and helpers:
  - component/wire/analysis/preset types
  - pin layout and geometry helpers
  - default component factory
  - payload builder for backend schematic API

### `app/web/src/lib/demoPresets.ts`
- Runnable schematic presets for demo flow:
  - resistor divider (`.op`)
  - RC step (`.tran`)
  - diode clipper (`.tran`)

### `app/web/src/components/SchematicCanvas.tsx`
- Schematic graph editor view:
  - palette
  - component symbols
  - pin click handling hooks
  - wire rendering layer

### `app/web/src/components/AnalysisPanel.tsx`
- Simulation control panel:
  - preset load
  - analysis mode fields
  - component value editing
  - run action
  - preview panes (client preview vs backend-generated netlist)

### `app/web/src/pages/App.tsx`
- Main frontend orchestration component:
  - state ownership (components, wires, analysis, selected pin, API response)
  - wire-creation logic and dedup
  - preset load/reset
  - API request send + response display

---

## Tests: `tests/`

### `tests/test_parser_and_builder.py`
- Validates parser and MNA builder behavior:
  - directive selection
  - voltage branch indexing
  - controlled source stamping path
  - AC RHS population

### `tests/test_service.py`
- Validates service-level API responses:
  - matrix response mode
  - DC solution path
  - schematic-generated netlist metadata injection

### `tests/test_schematic_pipeline.py`
- Focused schematic conversion tests:
  - ground mapping
  - round-trip to `CircuitIR`
  - disconnected pin failure
  - service handling of schematic-only requests

---

## Benchmarks: `benchmarks/`

### `benchmarks/benchmark_basic.py`
- Lightweight runtime benchmark for basic solver path (`.tran` example).

---

## Most Important Files: Key Code Block Functions

## 1) `mna_simulation/api/contracts.py`

### Block: `AnalysisMode` enum
- Canonical mode list used consistently by parser, service, and API boundaries.

### Block: IR dataclasses (`ComponentRecord`, `CircuitIR`, `DirectiveRecord`, `AnalysisOptions`, `IndexMap`, `MnaProblem`)
- Define backend-neutral data shapes.
- Keep parser/build/solver decoupled from transport layer.

### Block: result dataclasses (`WaveformResult`, `SpectrumResult`, `SimulationResult`, `BackendCapabilities`)
- Standard output and capability envelope for all backend adapters.

### Block: Pydantic transport models (`AnalysisRequest`, `SimulationResponse`)
- Public API schema and validation.

### Block: schematic models (`SchematicComponent`, `SchematicEndpoint`, `SchematicDocument`, etc.)
- Enforces graph schema correctness.
- Validators enforce unique IDs and endpoint integrity.
- `SchematicComponent.set_defaults()` fills default values/subtypes for convenience.

## 2) `mna_simulation/netlist.py`

### Block: `Component.from_parts()`
- Main parse dispatcher for one component line.
- Routes by normalized type into dedicated parser branches.

### Block: `_parse_passive`, `_parse_source`, `_parse_dependent`, `_parse_diode`, `_parse_behavioral`
- Per-device grammar and token count handling.
- Stores subtype and optional extra fields (`value2`, `value3`, control nodes/source).

### Block: `Component.validate()`
- Checks node naming, parameter formats, source subtypes, dependent-source controller references.

### Block: `Netlist.validate()`
- Netlist-level topology checks:
  - parallel voltage source conflicts
  - problematic pure series current source junctions

### Block: `parse_directive()`
- Parses `.op/.dc/.tran/.ac/.hb` and option values into `DirectiveRecord`.

### Block: `parse_netlist_text()` + `parse_netlist_file()`
- Full netlist ingestion path to validated `CircuitIR`.

### Block: `select_analysis()`
- Chooses final directive or fallback mode when none present.

## 3) `mna_simulation/mna_builder.py`

### Block: `_build_index_map()`
- Builds deterministic index mapping:
  - non-ground nodes
  - extra branch-current unknowns (`V`, `L`, `VCVS`, `CCVS`)

### Block: Local stamp helpers inside `build_mna_problem()`
- `get_index`, `get_branch_index`: safe index lookup.
- `stamp`: generic nodal matrix stamp for two-terminal conductance-like terms.
- `stamp_symbolic_rhs`: symbolic source assembly.
- `stamp_numeric_rhs`: numeric complex RHS assembly for AC.
- `stamp_voltage_source`: augment matrix for branch current unknown with KCL/KVL terms.

### Block: Per-component stamping loop
- Implements all supported device matrix/RHS contributions.
- Handles source subtype distinctions and nonlinear symbolic buildup.

### Block: Metadata pack and return
- Adds labels, branch map, dimensions into `problem.metadata`.

## 4) `mna_simulation/solvers.py`

### Block: linear algebra primitives (`lu_decomposition`, `forward_substitution`, `backward_substitution`)
- Custom fallback linear solver path for matrix solves.

### Block: symbolic compilation (`compile_nl_functions`, `compile_time_source_func`)
- Converts symbolic strings (`f_str`, `b_time_str`) into callable numerical functions.

### Block: `solve_dc_nr()`
- DC operating point solver.
- Uses direct linear solve for linear circuits.
- Uses Newton-Raphson + Jacobian for nonlinear circuits.
- Includes attenuation strategy when residual norm worsens.

### Block: `solve_transient()`
- Backward-Euler time stepping.
- Per-step NR inner loop for nonlinear circuits.
- Returns `WaveformResult`.

### Block: `solve_ac()`
- Small-signal frequency sweep.
- Linearizes nonlinear devices around DC solution when needed.

### Block: Fourier/HB helpers (`create_fourier_matrices`, `reconstruct_time_domain`, `solve_harmonic_balance`)
- Build harmonic-domain transforms.
- Solve HB nonlinear algebraic system.
- Reconstruct time-domain waveform from harmonic coefficients.

## 5) `mna_simulation/schematic_pipeline.py`

### Block: schematic constants + `_UnionFind`
- Defines pin layouts by device type.
- Union-find handles net formation from wires/junctions.

### Block: endpoint validation (`_ensure_endpoint_valid`)
- Ensures wire references valid component IDs, junction IDs, and pin names.

### Block: `_build_analysis_line()`
- Converts schematic analysis object + overrides into canonical netlist directive line.

### Block: `_auto_name()` + `_build_component_line()`
- Produces deterministic valid device names and netlist lines.

### Block: `schematic_to_netlist()`
- Main graph-to-netlist conversion:
  - collect pin/junction keys
  - union connected endpoints
  - identify ground roots
  - assign net names
  - validate all required pins connected
  - emit netlist text + pin-to-net map

### Block: `schematic_to_circuit_ir()`
- Passes generated text back through parser for a single authoritative validation path.

## 6) `mna_simulation/api/service.py`

### Block: `run_request()`
- Request router:
  - schematic payload -> conversion pipeline
  - raw netlist -> parser path
- Runs backend and serializes outputs into `SimulationResponse`.
- Adds `generated_netlist` metadata for schematic requests.

### Block: `healthcheck()`
- Exposes status, capabilities, and model list for UI diagnostics.

## 7) `mna_simulation/backends/python_backend.py`

### Block: constructor
- Loads default device registry and declares backend capability flags.

### Block: `build_options()`
- Merges directive parameters with optional request overrides into `AnalysisOptions`.

### Block: `run()`
- Executes analysis with Gmin stepping retry loop.
- Routes mode to basic or advanced core.

## 8) `app/web/src/pages/App.tsx`

### Block: state setup
- Owns canonical UI state for components, wires, analysis settings, run status, previews.

### Block: computed helpers (`nextPosition`, `nextIndexByType`, `netlistPreview`)
- Auto placement and naming counters.
- Lightweight client-side preview text.

### Block: editing handlers (`addComponent`, `onPinClick`, `updateComponent`, `loadPreset`)
- Mutates schematic graph state.
- Builds wire dedup logic via `wireKey()`.

### Block: `runSimulation()`
- Builds backend payload and sends POST `/api/simulate`.
- Captures server response, status, and generated canonical netlist metadata.

## 9) `app/web/src/lib/schematic.ts`

### Block: type definitions
- Shared TypeScript schema for editor model and payload conversion.

### Block: geometry/layout helpers
- Pin layout map and pixel coordinate helpers for drawing.

### Block: `createDefaultComponent()`
- Centralized default component initialization.

### Block: `buildSchematicPayload()`
- Converts frontend graph state to backend `SchematicDocument` JSON shape.

## 10) `app/server/main.py`

### Block: app + middleware setup
- FastAPI app config and CORS policy.

### Block: route handlers
- `health()` returns service capability metadata.
- `simulate()` executes `SimulationService.run_request()` and maps domain errors to HTTP responses.

---

## Practical Reading Order (for new contributors)

1. `mna_simulation/api/contracts.py`
2. `mna_simulation/netlist.py`
3. `mna_simulation/mna_builder.py`
4. `mna_simulation/solvers.py`
5. `mna_simulation/api/service.py`
6. `mna_simulation/schematic_pipeline.py`
7. `app/server/main.py`
8. `app/web/src/lib/schematic.ts`
9. `app/web/src/pages/App.tsx`

