import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LeftPane } from "../components/LeftPane";
import { PlotTile } from "../components/PlotTile";
import { ClipboardData, ProbeTarget, SchematicCanvas } from "../components/SchematicCanvas";
import { Toolbar } from "../components/Toolbar";
import { HIDDEN_DEMO_PRESETS, SCHEMATIC_PRESETS } from "../lib/demoPresets";
import { PlotData } from "../lib/plot";
import {
  AnalysisState,
  CanvasComponent,
  CanvasWire,
  DeviceType,
  SchematicLevel,
  SchematicPreset,
  buildSchematicPayload
} from "../lib/schematic";

const defaultAnalysis: AnalysisState = {
  mode: "op",
  tStop: "10m",
  tStep: "0.1m",
  fStart: "1",
  fStop: "10000",
  points: 100,
  harmonics: 8,
  hbTimeWindow: "",
  dynSpeed: "1m",
  dynWindow: "5m",
  probeNodes: [],
  continuous: false
};

type TileRecord = {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: "static" | "dyn";
  data?: PlotData;
  /** For dyn tiles: push function installed by the child. */
  push?: (t: number, values: number[], labels: string[]) => void;
  finalize?: () => void;
  /** Probe target for dyn tiles. */
  probe?: ProbeTarget;
  socket?: WebSocket;
  /** Rolling display window in sim seconds (dyn tiles only). */
  windowSeconds?: number;
};

const LIBRARY_ITEMS: DeviceType[] = [
  "R", "C", "L", "V", "I", "D", "GND",
  "QNPN", "QPNP", "NMOS", "PMOS",
  "VCVS", "VCCS", "CCCS", "CCVS", "SUBCKT"
];

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function App() {
  /* -------------- Hierarchy levels -------------- */
  const [levels, setLevels] = useState<SchematicLevel[]>(() => [
    {
      id: "root",
      title: "Top level",
      components: [],
      wires: [],
      pins: [],
      parentId: null
    }
  ]);
  const [activeLevelId, setActiveLevelId] = useState<string>("root");

  const activeLevel = levels.find((l) => l.id === activeLevelId)!;

  const updateLevel = useCallback(
    (levelId: string, patch: Partial<SchematicLevel>) => {
      setLevels((cur) =>
        cur.map((l) => (l.id === levelId ? { ...l, ...patch } : l))
      );
    },
    []
  );

  const setActiveComponents = useCallback(
    (updater: (current: CanvasComponent[]) => CanvasComponent[]) => {
      setLevels((cur) =>
        cur.map((l) => (l.id === activeLevelId ? { ...l, components: updater(l.components) } : l))
      );
    },
    [activeLevelId]
  );
  const setActiveWires = useCallback(
    (updater: (current: CanvasWire[]) => CanvasWire[]) => {
      setLevels((cur) =>
        cur.map((l) => (l.id === activeLevelId ? { ...l, wires: updater(l.wires) } : l))
      );
    },
    [activeLevelId]
  );

  /* -------------- Analysis & UI state -------------- */
  const [analysis, setAnalysis] = useState<AnalysisState>({ ...defaultAnalysis });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDevice, setPendingDevice] = useState<DeviceType | null>(null);
  const [probeMode, setProbeMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error" | "running">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [generatedNetlist, setGeneratedNetlist] = useState<string>("");
  const [responsePreview, setResponsePreview] = useState<string>("");
  const [tiles, setTiles] = useState<TileRecord[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const tileCounterRef = useRef(1);

  /* -------------- Derived helpers -------------- */

  const netlistPreview = useMemo(() => {
    const modeLine =
      analysis.mode === "op"
        ? ".op"
        : analysis.mode === "tran"
          ? `.tran ${analysis.tStop} ${analysis.tStep}`
          : analysis.mode === "ac"
            ? `.ac ${analysis.fStart} ${analysis.fStop} ${analysis.points}`
            : analysis.hbTimeWindow.trim()
              ? `.hb ${analysis.harmonics} ${analysis.hbTimeWindow.trim()}`
              : `.hb ${analysis.harmonics}`;
    const lines = activeLevel.components
      .filter((c) => c.type !== "GND")
      .map((c) => `${c.name} <${c.type}> ${c.value}${c.subtype ? ` [${c.subtype}]` : ""}`);
    return [...lines, modeLine, ".end"].join("\n");
  }, [activeLevel.components, analysis]);

  /**
   * The probe-node picker lists labels exactly as they appear in the plot
   * (``V(<net>)`` and ``I(<branch>)``). Storing the full label in
   * ``analysis.probeNodes`` lets the waveform filter do a direct string match
   * — otherwise "n1" picks would never line up with "V(n1)" series.
   */
  const availableNodes = useMemo(() => {
    const nodeSet = new Set<string>();
    const branchSet = new Set<string>();
    const lines = generatedNetlist.split(/\r?\n/);
    for (const raw of lines) {
      const tok = raw.trim().split(/\s+/);
      if (tok.length < 3) continue;
      if (raw.startsWith(".") || raw.startsWith("*")) continue;
      // device name → branch label for V/L/E/H lines (they generate a branch row).
      const dev = tok[0].toUpperCase();
      if (dev.startsWith("V") || dev.startsWith("L") || dev.startsWith("E") || dev.startsWith("H")) {
        branchSet.add(tok[0]);
      }
      // First two tokens after the name are nodes (passive form), 4th/5th for VCVS/VCCS, etc.
      const n1 = tok[1];
      const n2 = tok[2];
      if (n1 && n1 !== "0") nodeSet.add(n1);
      if (n2 && n2 !== "0") nodeSet.add(n2);
    }
    const nodes = Array.from(nodeSet).sort().map((n) => `V(${n})`);
    const branches = Array.from(branchSet).sort().map((b) => `I(${b})`);
    return [...nodes, ...branches];
  }, [generatedNetlist]);

  /* -------------- Toolbar / library -------------- */

  const startDragType = useCallback((type: DeviceType) => {
    setPendingDevice(type);
    setProbeMode(false);
  }, []);

  /* -------------- Property update -------------- */

  const updateComponent = useCallback(
    (id: string, patch: Partial<CanvasComponent>) => {
      setActiveComponents((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [setActiveComponents]
  );

  /* -------------- Run simulation -------------- */

  const runSimulation = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setStatus("running");
    setStatusMsg("");
    const payload = buildSchematicPayload(
      activeLevel.components,
      activeLevel.wires,
      analysis,
      levels
    );
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          netlist_text: "",
          mode: analysis.mode,
          options: {},
          schematic: payload
        })
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus("error");
        setStatusMsg(body?.detail?.message ?? "Simulation failed.");
        setResponsePreview(JSON.stringify(body, null, 2));
      } else {
        setStatus("ok");
        setStatusMsg(`${analysis.mode.toUpperCase()} complete (${body.status}).`);
        if (body?.metadata?.generated_netlist) {
          setGeneratedNetlist(String(body.metadata.generated_netlist));
        }
        setResponsePreview(JSON.stringify(body, null, 2));

        // Materialize a plot tile.
        if (analysis.mode === "tran" && body.waveform) {
          const data = toPlotData(body.waveform, "time (s)", "V", analysis.probeNodes);
          addTile({
            title: `.tran — ${analysis.tStop}`,
            mode: "static",
            data
          });
        } else if (analysis.mode === "ac" && body.spectrum) {
          const data = toSpectrumPlot(body.spectrum, "line");
          addTile({ title: `.ac sweep`, mode: "static", data });
        } else if (analysis.mode === "hb" && body.spectrum) {
          const f0 = Number(body?.metadata?.base_frequency_hz ?? 0);
          const data = toSpectrumPlot(body.spectrum, "stem");
          addTile({
            title: f0 > 0 ? `.hb spectrum · f0 ${formatCompact(f0)}Hz` : `.hb spectrum`,
            mode: "static",
            data,
            w: 520,
            h: 300
          });
        } else if (analysis.mode === "hb" && body.waveform) {
          const data = toPlotData(body.waveform, "time (s)", "V", analysis.probeNodes);
          addTile({
            title: `.hb reconstruct — ${analysis.hbTimeWindow || "window"}`,
            mode: "static",
            data,
            w: 520,
            h: 300
          });
        } else if (analysis.mode === "op" && body.dc_solution) {
          addTile({
            title: `.op — DC solution`,
            mode: "static",
            data: opResultPlotData(body.labels, body.dc_solution)
          });
        }
      }
    } catch (err) {
      setStatus("error");
      setStatusMsg(String(err));
    } finally {
      setRunning(false);
    }
  }, [analysis, activeLevel, levels, running]);

  /* -------------- Probe click → open .dyn tile -------------- */

  const onProbePick = useCallback(
    (target: ProbeTarget) => {
      const payload = buildSchematicPayload(
        activeLevel.components,
        activeLevel.wires,
        analysis,
        levels
      );
      const speed = parseValue(analysis.dynSpeed);
      const tStopSim = parseValue(analysis.tStop);
      const wallDuration = speed > 0 ? tStopSim / speed : 0;
      const windowSim = parseValue(analysis.dynWindow);
      const tileId = genId("tile");
      const nodeLabel = target.netLabel ?? `${target.componentId}.${target.pin}`;

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/dyn`);
      const titleSuffix = analysis.continuous
        ? "∞"
        : `${wallDuration.toFixed(wallDuration >= 10 ? 0 : 1)}s`;
      const tileRecord: TileRecord = {
        id: tileId,
        title: `.dyn ${nodeLabel} @ ${analysis.dynSpeed}s/s · ${titleSuffix}`,
        x: Math.max(40, target.x + 60),
        y: Math.max(40, target.y - 80),
        w: 380,
        h: 240,
        mode: "dyn",
        socket: ws,
        probe: target,
        windowSeconds: windowSim
      };
      setTiles((cur) => [...cur, tileRecord]);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            schematic: payload,
            speed,
            t_stop: analysis.tStop,
            t_step: analysis.tStep,
            window: analysis.dynWindow,
            pin_refs: [{ component_id: target.componentId, pin: target.pin }],
            continuous: analysis.continuous
          })
        );
      };

      let streamLabels: string[] = [];
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "meta") {
          streamLabels = msg.labels ?? [];
        } else if (msg.type === "frame") {
          const rec = tilesRef.current.get(tileId);
          if (rec?.push && streamLabels.length > 0) {
            const vals = (msg.values as number[]).map((v) => Number(v) || 0);
            rec.push(Number(msg.t), vals, streamLabels);
          }
        } else if (msg.type === "loop") {
          // continuous boundary — no-op
        } else if (msg.type === "done") {
          const rec = tilesRef.current.get(tileId);
          rec?.finalize?.();
        } else if (msg.type === "error") {
          setStatus("error");
          setStatusMsg(String(msg.message));
        }
      };
      ws.onerror = () => {
        setStatus("error");
        setStatusMsg("Realtime stream failed.");
      };
    },
    [activeLevel, analysis, levels]
  );

  /* Track tile-id → push/finalize handles without re-renders. */
  const tilesRef = useRef<Map<string, TileRecord>>(new Map());
  useEffect(() => {
    tilesRef.current = new Map(tiles.map((t) => [t.id, t]));
  }, [tiles]);

  /* -------------- Tile layout -------------- */

  function addTile(partial: Omit<TileRecord, "id" | "x" | "y" | "w" | "h"> & Partial<Pick<TileRecord, "x" | "y" | "w" | "h">>) {
    const idx = tileCounterRef.current++;
    const offset = (idx % 6) * 26;
    const tile: TileRecord = {
      id: genId("tile"),
      x: 60 + offset,
      y: 60 + offset,
      w: 420,
      h: 260,
      ...partial
    };
    setTiles((cur) => [...cur, tile]);
  }

  function moveTile(id: string, x: number, y: number) {
    setTiles((cur) => cur.map((t) => (t.id === id ? { ...t, x, y } : t)));
  }
  function resizeTile(id: string, w: number, h: number) {
    setTiles((cur) => cur.map((t) => (t.id === id ? { ...t, w, h } : t)));
  }
  function closeTile(id: string) {
    setTiles((cur) => {
      cur.find((t) => t.id === id)?.socket?.close();
      return cur.filter((t) => t.id !== id);
    });
  }

  /* -------------- Probe node list for .tran picker -------------- */

  const addProbeNode = useCallback(
    (label: string) => {
      setAnalysis((cur) =>
        cur.probeNodes.includes(label) ? cur : { ...cur, probeNodes: [...cur.probeNodes, label] }
      );
    },
    []
  );
  const removeProbeNode = useCallback(
    (label: string) => setAnalysis((cur) => ({ ...cur, probeNodes: cur.probeNodes.filter((n) => n !== label) })),
    []
  );

  /* -------------- Presets / demos -------------- */

  function applyPreset(preset: SchematicPreset) {
    const rootLevel: SchematicLevel = {
      id: "root",
      title: preset.title,
      components: preset.components.map((c) => ({ ...c })),
      wires: preset.wires.map((w) => ({
        ...w,
        start: { ...w.start } as CanvasWire["start"],
        end: { ...w.end } as CanvasWire["end"]
      })),
      pins: [],
      parentId: null
    };
    const extras: SchematicLevel[] = (preset.extraLevels ?? []).map((lv) => ({
      ...lv,
      components: lv.components.map((c) => ({ ...c })),
      wires: lv.wires.map((w) => ({
        ...w,
        start: { ...w.start } as CanvasWire["start"],
        end: { ...w.end } as CanvasWire["end"]
      })),
      pins: [...lv.pins]
    }));
    setLevels([rootLevel, ...extras]);
    setActiveLevelId("root");
    setAnalysis({ ...defaultAnalysis, ...preset.analysis });
    setSelectedIds(new Set());
    setGeneratedNetlist("");
    setResponsePreview("");
    setStatus("idle");
    setStatusMsg(`Preset "${preset.title}" loaded.`);
  }

  const loadPreset = useCallback((presetId: string) => {
    const preset =
      SCHEMATIC_PRESETS.find((p) => p.id === presetId) ??
      HIDDEN_DEMO_PRESETS.find((p) => p.id === presetId);
    if (preset) applyPreset(preset);
  }, []);

  /* -------------- Hierarchy handlers -------------- */

  function addLevel(parentId: string | null) {
    const id = genId("level");
    const title = parentId === null ? `Level ${levels.length}` : `Subckt ${levels.filter((l) => l.parentId).length + 1}`;
    setLevels((cur) => [
      ...cur,
      { id, title, components: [], wires: [], pins: ["a", "b"], parentId }
    ]);
    setActiveLevelId(id);
  }
  function renameLevel(id: string, title: string) {
    updateLevel(id, { title });
  }
  function deleteLevel(id: string) {
    if (id === "root") return;
    // Collect ``id`` plus every descendant via BFS so an entire subtree is
    // dropped in one operation. Without this, deleting a parent would orphan
    // its children, leaving stale entries in the hierarchy tree.
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const l of levels) {
        if (!doomed.has(l.id) && l.parentId && doomed.has(l.parentId)) {
          doomed.add(l.id);
          grew = true;
        }
      }
    }
    setLevels((cur) => cur.filter((l) => !doomed.has(l.id)));
    if (doomed.has(activeLevelId)) setActiveLevelId("root");
  }

  /* -------------- Copy / paste -------------- */

  const onCopy = useCallback((data: ClipboardData) => {
    setClipboard(data);
    setStatusMsg(`Copied ${data.components.length} component${data.components.length === 1 ? "" : "s"}.`);
  }, []);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.components.length === 0) return;
    const idRemap = new Map<string, string>();
    const dx = 40;
    const dy = 40;
    const newComponents: CanvasComponent[] = clipboard.components.map((c) => {
      const newId = genId(c.type.toLowerCase());
      idRemap.set(c.id, newId);
      // Bump trailing-number in name if present so we don't duplicate names.
      const m = c.name.match(/^([A-Za-z_]+)(\d+)$/);
      const newName = m ? `${m[1]}${Number(m[2]) + 1000}` : `${c.name}_copy`;
      return { ...c, id: newId, name: newName, x: c.x + dx, y: c.y + dy };
    });
    const newWires: CanvasWire[] = clipboard.wires.map((w) => {
      const start =
        w.start.kind === "pin"
          ? {
              kind: "pin" as const,
              componentId: idRemap.get(w.start.componentId) ?? w.start.componentId,
              pin: w.start.pin
            }
          : { kind: "point" as const, x: w.start.x + dx, y: w.start.y + dy };
      const end =
        w.end.kind === "pin"
          ? {
              kind: "pin" as const,
              componentId: idRemap.get(w.end.componentId) ?? w.end.componentId,
              pin: w.end.pin
            }
          : { kind: "point" as const, x: w.end.x + dx, y: w.end.y + dy };
      return {
        id: `w-${Math.random().toString(36).slice(2, 8)}`,
        start,
        end
      };
    });
    setActiveComponents((cur) => [...cur, ...newComponents]);
    setActiveWires((cur) => [...cur, ...newWires]);
    // Select the freshly pasted items so a follow-up drag affects only them.
    const sel = new Set<string>();
    newComponents.forEach((c) => sel.add(c.id));
    newWires.forEach((w) => sel.add(w.id));
    setSelectedIds(sel);
  }, [clipboard, setActiveComponents, setActiveWires]);

  /* -------------- Render -------------- */

  const selectedComponent =
    selectedIds.size === 1
      ? activeLevel.components.find((c) => selectedIds.has(c.id)) ?? null
      : null;

  return (
    <div className="app">
      <div className="menubar">
        <div className="menubar__brand">
          <span className="dot" /> MNA Simulator
        </div>
        <div className="menubar__menu">
          <button className="menubar__item">File</button>
          <button className="menubar__item">Edit</button>
          <button className="menubar__item">View</button>
          <button className="menubar__item">Simulate</button>
          <div className="menubar__dropdown">
            <button
              className={`menubar__item ${demoOpen ? "open" : ""}`}
              onClick={() => setDemoOpen((v) => !v)}
              onBlur={() => setTimeout(() => setDemoOpen(false), 120)}
            >
              Demo
            </button>
            {demoOpen ? (
              <div className="menubar__dropdownPanel">
                {HIDDEN_DEMO_PRESETS.map((d) => (
                  <button
                    key={d.id}
                    className="menubar__dropdownItem"
                    onMouseDown={() => {
                      applyPreset(d);
                      setDemoOpen(false);
                    }}
                  >
                    <strong>{d.title}</strong>
                    <span className="menubar__dropdownDesc">{d.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className="menubar__item">Help</button>
        </div>
        <div className="menubar__spacer" />
        <div className="menubar__status">
          <span className={`statusDot ${status}`} />
          <span>{statusMsg || (status === "idle" ? "Ready" : status)}</span>
        </div>
      </div>

      <Toolbar
        pendingDevice={pendingDevice}
        onPickDevice={setPendingDevice}
        onToggleProbe={() => setProbeMode((v) => !v)}
        probeMode={probeMode}
        onRun={runSimulation}
        running={running}
      />

      <LeftPane
        analysis={analysis}
        onAnalysisChange={(patch) => setAnalysis((cur) => ({ ...cur, ...patch }))}
        presets={SCHEMATIC_PRESETS}
        onLoadPreset={loadPreset}
        onRun={runSimulation}
        running={running}
        availableNodes={availableNodes}
        onAddProbeNode={addProbeNode}
        onRemoveProbeNode={removeProbeNode}
        levels={levels}
        activeLevelId={activeLevelId}
        onSelectLevel={setActiveLevelId}
        onAddLevel={addLevel}
        onRenameLevel={renameLevel}
        onDeleteLevel={deleteLevel}
        libraryComponents={LIBRARY_ITEMS}
        onStartDrag={startDragType}
        selectedComponent={selectedComponent}
        onUpdateComponent={updateComponent}
        netlistPreview={netlistPreview}
        generatedNetlist={generatedNetlist}
      />

      <div className="canvasArea" style={{ position: "relative" }}>
        <SchematicCanvas
          components={activeLevel.components}
          wires={activeLevel.wires}
          junctions={activeLevel.junctions}
          selectedIds={selectedIds}
          pendingDevice={pendingDevice}
          probeMode={probeMode}
          onSetComponents={setActiveComponents}
          onSetWires={setActiveWires}
          onSelect={setSelectedIds}
          onPendingResolved={() => setPendingDevice(null)}
          onProbePick={onProbePick}
          onCopy={onCopy}
          onPaste={onPaste}
        />
        <div className="tileLayer">
          {tiles.map((tile) => (
            <PlotTile
              key={tile.id}
              id={tile.id}
              title={tile.title}
              x={tile.x}
              y={tile.y}
              w={tile.w}
              h={tile.h}
              mode={tile.mode}
              data={tile.data}
              windowSeconds={tile.windowSeconds}
              onMount={
                tile.mode === "dyn"
                  ? (push, finalize) => {
                      setTiles((cur) =>
                        cur.map((t) => (t.id === tile.id ? { ...t, push, finalize } : t))
                      );
                    }
                  : undefined
              }
              onMove={moveTile}
              onResize={resizeTile}
              onClose={closeTile}
            />
          ))}
        </div>
      </div>

      <div className="statusbar">
        <span className="statusbar__slot">Level: {activeLevel.title}</span>
        <span className="statusbar__slot">
          {activeLevel.components.length} comp · {activeLevel.wires.length} wires
          {selectedIds.size > 0 ? ` · ${selectedIds.size} selected` : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span className="statusbar__slot">
          Shift+click: multi-select · drag: marquee · Ctrl+C/V: copy/paste · R: rotate · Del: delete
        </span>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function parseValue(raw: string): number {
  if (!raw) return 1;
  const m = raw.match(/^\s*([-+]?[0-9]*\.?[0-9]+)([a-zA-Zµ]*)\s*$/);
  if (!m) return Number(raw) || 1;
  const base = Number(m[1]);
  const suf = (m[2] || "").toLowerCase();
  const table: Record<string, number> = {
    "": 1,
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9
  };
  if (suf in table) return base * table[suf];
  return base;
}

function toPlotData(
  waveform: { time: number[]; values: number[][]; labels: string[] },
  xLabel: string,
  yLabel: string,
  filterLabels: string[] = []
): PlotData {
  const t = waveform.time ?? [];
  const vs = waveform.values ?? [];
  const labels = waveform.labels ?? [];
  const rows = vs.length;
  const cols = rows > 0 ? (Array.isArray(vs[0]) ? vs[0].length : 0) : 0;
  const isRowMajor = rows === t.length && cols === labels.length;
  let series: { label: string; values: number[] }[];
  if (isRowMajor) {
    series = labels.map((lbl, j) => ({
      label: lbl,
      values: vs.map((row) => Number((row as number[])[j] ?? 0))
    }));
  } else {
    series = labels.map((lbl, j) => ({
      label: lbl,
      values: (vs[j] as number[] | undefined)?.map((v) => Number(v)) ?? []
    }));
  }
  if (filterLabels.length > 0) {
    const wanted = new Set(filterLabels);
    series = series.filter((s) => wanted.has(s.label));
  }
  return { x: t, series, xLabel, yLabel };
}

function toSpectrumPlot(spectrum: {
  frequencies: number[];
  magnitudes: number[][] | number[];
  labels: string[];
}, kind: PlotData["kind"] = "line"): PlotData {
  const freq = spectrum.frequencies ?? [];
  const mag = spectrum.magnitudes ?? [];
  const labels = spectrum.labels ?? [];
  const isMatrix = Array.isArray(mag[0]);
  let series: { label: string; values: number[] }[];
  if (isMatrix) {
    const matrix = mag as number[][];
    const rows = matrix.length;
    const cols = rows > 0 && Array.isArray(matrix[0]) ? matrix[0].length : 0;
    const labelRows = rows === labels.length && cols === freq.length;
    const pointRows = rows === freq.length && cols === labels.length;
    if (labelRows) {
      series = labels.map((lbl, j) => ({
        label: lbl,
        values: (matrix[j] ?? []).map((v) => Number(v))
      }));
    } else if (pointRows) {
      series = labels.map((lbl, j) => ({
        label: lbl,
        values: matrix.map((row) => Number(row[j] ?? 0))
      }));
    } else {
      series = labels.map((lbl, j) => ({
        label: lbl,
        values: (matrix[j] ?? []).map((v) => Number(v))
      }));
    }
  } else {
    series = [{ label: labels[0] ?? "|H|", values: (mag as number[]).map((v) => Number(v)) }];
  }
  return {
    x: freq,
    series,
    xLabel: "frequency (Hz)",
    yLabel: "magnitude",
    kind,
    logX: kind === "line",
    title: kind === "stem" ? "Harmonic magnitudes" : undefined
  };
}

function opResultPlotData(labels: string[], values: number[]): PlotData {
  const x = labels.map((_, i) => i);
  return {
    x,
    series: [{ label: "V (.op)", values }],
    xLabel: "node index",
    yLabel: "V",
    title: labels.join("  ·  ")
  };
}

function formatCompact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2).replace(/\.?0+$/, "")}k`;
  return value.toFixed(2).replace(/\.?0+$/, "");
}
