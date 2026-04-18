import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LeftPane } from "../components/LeftPane";
import { PlotTile } from "../components/PlotTile";
import { ProbeTarget, SchematicCanvas } from "../components/SchematicCanvas";
import { Toolbar } from "../components/Toolbar";
import { SCHEMATIC_PRESETS } from "../lib/demoPresets";
import { PlotData } from "../lib/plot";
import {
  AnalysisState,
  CanvasComponent,
  CanvasWire,
  DeviceType,
  SchematicLevel,
  buildSchematicPayload,
  createDefaultComponent
} from "../lib/schematic";

const defaultAnalysis: AnalysisState = {
  mode: "op",
  tStop: "10m",
  tStep: "0.1m",
  fStart: "1",
  fStop: "10000",
  points: 100,
  harmonics: 8,
  dynSpeed: "1m",
  probeNodes: []
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
};

const LIBRARY_ITEMS: DeviceType[] = ["R", "C", "L", "V", "I", "D", "GND", "VCVS", "VCCS", "CCCS", "CCVS", "SUBCKT"];

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function App() {
  /* -------------- Hierarchy levels -------------- */
  const [levels, setLevels] = useState<SchematicLevel[]>(() => {
    const preset = SCHEMATIC_PRESETS[0];
    return [
      {
        id: "root",
        title: "Top level",
        components: preset.components.map((c) => ({ ...c })),
        wires: preset.wires.map((w) => ({ ...w, start: { ...w.start }, end: { ...w.end } })),
        pins: [],
        parentId: null
      }
    ];
  });
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDevice, setPendingDevice] = useState<DeviceType | null>(null);
  const [probeMode, setProbeMode] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<"idle" | "ok" | "error" | "running">("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [generatedNetlist, setGeneratedNetlist] = useState<string>("");
  const [responsePreview, setResponsePreview] = useState<string>("");
  const [tiles, setTiles] = useState<TileRecord[]>([]);
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
            : analysis.mode === "hb"
              ? `.hb ${analysis.harmonics}`
              : `.dyn ${analysis.dynSpeed}`;
    const lines = activeLevel.components
      .filter((c) => c.type !== "GND")
      .map((c) => `${c.name} <${c.type}> ${c.value}${c.subtype ? ` [${c.subtype}]` : ""}`);
    return [...lines, modeLine, ".end"].join("\n");
  }, [activeLevel.components, analysis]);

  const availableNodes = useMemo(() => {
    // After a backend run we have access to result labels through generatedNetlist parse,
    // but an always-available fallback is the visible component names with .p/.n pins.
    const netSet = new Set<string>();
    const lines = generatedNetlist.split(/\r?\n/);
    for (const raw of lines) {
      const tok = raw.trim().split(/\s+/);
      if (tok.length < 3) continue;
      if (raw.startsWith(".") || raw.startsWith("*")) continue;
      // First two tokens after device name are nodes (for passive), 4th and 5th for VCVS/VCCS, etc.
      const n1 = tok[1];
      const n2 = tok[2];
      if (n1 && n1 !== "0") netSet.add(n1);
      if (n2 && n2 !== "0") netSet.add(n2);
    }
    return Array.from(netSet).sort();
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
    if (analysis.mode === "dyn") {
      setStatusMsg("Click a pin in probe mode to open a live tile.");
      setProbeMode(true);
      setStatus("idle");
      return;
    }
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
          const data = toSpectrumPlot(body.spectrum);
          addTile({ title: `.ac sweep`, mode: "static", data });
        } else if (analysis.mode === "hb" && body.spectrum) {
          const data = toSpectrumPlot(body.spectrum);
          addTile({ title: `.hb harmonics`, mode: "static", data });
        } else if (analysis.mode === "hb" && body.waveform) {
          const data = toPlotData(body.waveform, "time (s)", "V");
          addTile({ title: `.hb waveform`, mode: "static", data });
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
      // Resolve node label through backend-generated netlist; fallback to name.p/.n.
      const payload = buildSchematicPayload(
        activeLevel.components,
        activeLevel.wires,
        { ...analysis, mode: "dyn" },
        levels
      );
      const speed = parseValue(analysis.dynSpeed);
      const tileId = genId("tile");
      const nodeLabel = target.netLabel ?? `${target.componentId}.${target.pin}`;

      // Temporarily no node filter — we'll filter client-side on push.
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/dyn`);
      const tileRecord: TileRecord = {
        id: tileId,
        title: `.dyn ${nodeLabel} @ ${analysis.dynSpeed}s/s`,
        x: Math.max(40, target.x + 60),
        y: Math.max(40, target.y - 80),
        w: 360,
        h: 220,
        mode: "dyn",
        socket: ws,
        probe: target
      };
      setTiles((cur) => [...cur, tileRecord]);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            schematic: payload,
            speed,
            t_stop: analysis.tStop,
            t_step: analysis.tStep
          })
        );
      };
      let labels: string[] = [];
      let wantedIdx = -1;
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "meta") {
          labels = msg.labels ?? [];
          // Match probe to a specific net label.
          wantedIdx = labels.findIndex(
            (l) => l === nodeLabel || l.endsWith(`.${target.pin}`) || l.includes(target.componentId)
          );
          if (wantedIdx < 0) wantedIdx = 0;
        } else if (msg.type === "frame") {
          const rec = tilesRef.current.get(tileId);
          if (rec?.push && labels.length > 0) {
            const displayLabel = labels[wantedIdx] ?? labels[0];
            rec.push(Number(msg.t), [Number(msg.values[wantedIdx] ?? 0)], [displayLabel]);
          }
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

  /* -------------- Presets -------------- */

  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = SCHEMATIC_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setLevels([
        {
          id: "root",
          title: preset.title,
          components: preset.components.map((c) => ({ ...c })),
          wires: preset.wires.map((w) => ({ ...w, start: { ...w.start }, end: { ...w.end } })),
          pins: [],
          parentId: null
        }
      ]);
      setActiveLevelId("root");
      setAnalysis({ ...defaultAnalysis, ...preset.analysis });
      setSelectedId(null);
      setGeneratedNetlist("");
      setResponsePreview("");
      setStatus("idle");
      setStatusMsg(`Preset "${preset.title}" loaded.`);
    },
    []
  );

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
    setLevels((cur) => cur.filter((l) => l.id !== id && l.parentId !== id));
    if (activeLevelId === id) setActiveLevelId("root");
  }

  /* -------------- Render -------------- */

  const selectedComponent = activeLevel.components.find((c) => c.id === selectedId) ?? null;

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
          selectedId={selectedId}
          pendingDevice={pendingDevice}
          probeMode={probeMode}
          onSetComponents={setActiveComponents}
          onSetWires={setActiveWires}
          onSelect={setSelectedId}
          onPendingResolved={() => setPendingDevice(null)}
          onProbePick={onProbePick}
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
        </span>
        <span style={{ flex: 1 }} />
        <span className="statusbar__slot">Shift+drag: pan · wheel: zoom · R: rotate · Del: delete</span>
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
  // values may come as [row][col] or [col][row] depending on ndarray. The backend
  // uses utils.ndarray_to_list which gives [row, col] for 2D arrays.
  // We want per-series arrays.
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
}): PlotData {
  const freq = spectrum.frequencies ?? [];
  const mag = spectrum.magnitudes ?? [];
  const labels = spectrum.labels ?? [];
  const isMatrix = Array.isArray(mag[0]);
  const series = isMatrix
    ? labels.map((lbl, j) => ({ label: lbl, values: (mag as number[][]).map((r) => Number(r[j] ?? 0)) }))
    : [{ label: labels[0] ?? "|H|", values: (mag as number[]).map((v) => Number(v)) }];
  return { x: freq, series, xLabel: "f (Hz)", yLabel: "|H|", logX: true };
}

function opResultPlotData(labels: string[], values: number[]): PlotData {
  // Render .op as a bar-chart-ish line sampling.
  const x = labels.map((_, i) => i);
  return {
    x,
    series: [{ label: "V (.op)", values }],
    xLabel: "node index",
    yLabel: "V",
    title: labels.join("  ·  ")
  };
}
