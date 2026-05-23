import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LeftPane } from "../components/LeftPane";
import { PlotTile } from "../components/PlotTile";
import { OpResultData, ResultTile } from "../components/ResultTile";
import { ClipboardData, ProbeTarget, SchematicCanvas } from "../components/SchematicCanvas";
import { Toolbar } from "../components/Toolbar";
import { DEMO_MENU_GROUPS, HIDDEN_DEMO_PRESETS, SCHEMATIC_PRESETS } from "../lib/demoPresets";
import { PlotData } from "../lib/plot";
import {
  AnalysisState,
  CanvasComponent,
  CanvasWire,
  DeviceType,
  SchematicLevel,
  SchematicPreset,
  buildSchematicPayload,
  normalizeNodeName
} from "../lib/schematic";
import { USER_GUIDE_SECTIONS } from "../lib/userGuide";

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
  krylov: false,
  krylovRankMode: "auto",
  krylovRank: 80,
  krylovMethod: "auto",
  mor: false,
  morMethod: "auto",
  morOrderMode: "auto",
  morOrder: 40,
  morOutputNodes: []
};

type TileRecord = {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: "static" | "dyn";
  view: "plot" | "op";
  data?: PlotData;
  opData?: OpResultData;
  /** For dyn tiles: push function installed by the child. */
  push?: (t: number, values: number[], labels: string[]) => void;
  finalize?: () => void;
  /** Probe target for dyn tiles. */
  probe?: ProbeTarget;
  socket?: WebSocket;
  /** Rolling display window in sim seconds (dyn tiles only). */
  windowSeconds?: number;
};

type EditorSnapshot = {
  levels: SchematicLevel[];
  activeLevelId: string;
  netlistMode: "schematic" | "netlist";
  netlistText: string;
  generatedNetlist: string;
};

const LIBRARY_ITEMS: DeviceType[] = [
  "R", "C", "L", "V", "I", "D", "GND",
  "QNPN", "QPNP", "NMOS", "PMOS",
  "VCVS", "VCCS", "CCCS", "CCVS", "SUBCKT", "LABEL", "NODE"
];
const MAX_STATIC_PLOT_POINTS = 6000;
const MAX_RESPONSE_PREVIEW_VALUES = 20000;

function genId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneWireEndpoint(endpoint: CanvasWire["start"]): CanvasWire["start"] {
  return endpoint.kind === "pin"
    ? { kind: "pin", componentId: endpoint.componentId, pin: endpoint.pin }
    : { kind: "point", x: endpoint.x, y: endpoint.y };
}

function cloneLevel(level: SchematicLevel): SchematicLevel {
  return {
    ...level,
    components: level.components.map((component) => ({
      ...component,
      pins: component.pins ? [...component.pins] : undefined,
      metadata: component.metadata ? { ...component.metadata } : undefined
    })),
    wires: level.wires.map((wire) => ({
      ...wire,
      start: cloneWireEndpoint(wire.start),
      end: cloneWireEndpoint(wire.end)
    })),
    pins: [...level.pins],
    junctions: level.junctions?.map((junction) => ({ ...junction }))
  };
}

function cloneLevels(levels: SchematicLevel[]): SchematicLevel[] {
  return levels.map(cloneLevel);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function simulationRequestOptions(analysis: AnalysisState): Record<string, unknown> {
  const options: Record<string, unknown> = {
    use_krylov: analysis.krylov,
    probe_nodes: analysis.probeNodes
  };
  if (analysis.krylov) {
    options.krylov_rank =
      analysis.krylovRankMode === "auto"
        ? "auto"
        : Math.max(1, Math.floor(Number(analysis.krylovRank) || 1));
    options.krylov_method = analysis.krylovMethod;
  }
  if (analysis.mor) {
    options.use_mor = true;
    options.mor_method = analysis.morMethod;
    options.mor_order =
      analysis.morOrderMode === "auto"
        ? "auto"
        : Math.max(1, Math.floor(Number(analysis.morOrder) || 1));
    options.mor_output_nodes = analysis.morOutputNodes;
    options.mor_validate = true;
  }
  return options;
}

function samePins(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((pin, index) => pin === right[index]);
}

function uniquePins(pins: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const pin of pins) {
    if (seen.has(pin)) continue;
    seen.add(pin);
    out.push(pin);
  }
  return out;
}

function inferredLevelPins(level: SchematicLevel): string[] {
  const pins: string[] = [];
  const seen = new Set<string>();
  for (const component of level.components) {
    if (component.type !== "NODE") continue;
    const pin = normalizeNodeName(component.name || component.value || component.id);
    if (!seen.has(pin)) {
      seen.add(pin);
      pins.push(pin);
    }
  }
  return pins.length > 0 ? pins : level.pins;
}

function rewriteSubcktPinEndpoints(
  wires: CanvasWire[],
  componentId: string,
  oldPins: string[],
  newPins: string[]
): CanvasWire[] {
  const validPins = new Set(newPins);
  const renamedPins = new Map<string, string>();
  for (let i = 0; i < Math.min(oldPins.length, newPins.length); i++) {
    if (oldPins[i] && newPins[i] && oldPins[i] !== newPins[i]) {
      renamedPins.set(oldPins[i], newPins[i]);
    }
  }

  const resolvePin = (pin: string): string => {
    const renamed = renamedPins.get(pin);
    if (renamed) return renamed;
    if (validPins.has(pin)) return pin;

    const cleaned = normalizeNodeName(pin);
    const exactNormalized = newPins.find((candidate) => normalizeNodeName(candidate) === cleaned);
    if (exactNormalized) return exactNormalized;

    const trimmed = cleaned.replace(/_+$/, "");
    if (trimmed) {
      const prefixMatch = newPins.find((candidate) => {
        const normalized = normalizeNodeName(candidate);
        return normalized === trimmed || normalized.startsWith(trimmed) || cleaned.startsWith(normalized);
      });
      if (prefixMatch) return prefixMatch;
    }

    const oldIndex = oldPins.indexOf(pin);
    if (oldIndex >= 0 && oldIndex < newPins.length) return newPins[oldIndex];
    return pin;
  };

  const rewriteEndpoint = (endpoint: CanvasWire["start"]): CanvasWire["start"] => {
    if (endpoint.kind !== "pin" || endpoint.componentId !== componentId) return endpoint;
    const nextPin = resolvePin(endpoint.pin);
    return nextPin !== endpoint.pin ? { ...endpoint, pin: nextPin } : endpoint;
  };
  return wires.map((wire) => ({
    ...wire,
    start: rewriteEndpoint(wire.start),
    end: rewriteEndpoint(wire.end)
  }));
}

function syncInstancesForEntity(
  level: SchematicLevel,
  entityId: string,
  oldPins: string[],
  newPins: string[]
): SchematicLevel {
  let wires = level.wires;
  let changed = false;
  const components = level.components.map((component) => {
    if (component.type !== "SUBCKT" || component.subcircuitId !== entityId) return component;
    const existingPins = component.pins ?? oldPins;
    wires = rewriteSubcktPinEndpoints(wires, component.id, existingPins, newPins);
    changed = true;
    return { ...component, pins: [...newPins] };
  });
  return changed ? { ...level, components, wires } : level;
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
  const [netlistMode, setNetlistMode] = useState<"schematic" | "netlist">("schematic");
  const [netlistText, setNetlistText] = useState<string>("");
  const [responsePreview, setResponsePreview] = useState<string>("");
  const [tiles, setTiles] = useState<TileRecord[]>([]);
  const [clipboard, setClipboard] = useState<ClipboardData | null>(null);
  const [demoOpen, setDemoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [statusElapsedMs, setStatusElapsedMs] = useState(0);
  const [statusIterations, setStatusIterations] = useState(0);
  const tileCounterRef = useRef(1);
  const statusStartRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const statusIterationsRef = useRef(0);
  const statusIterationPaintRef = useRef(0);
  const activeDynamicTilesRef = useRef<Set<string>>(new Set());
  const levelsRef = useRef<SchematicLevel[]>(levels);
  const activeLevelIdRef = useRef(activeLevelId);
  const netlistModeRef = useRef(netlistMode);
  const netlistTextRef = useRef(netlistText);
  const generatedNetlistRef = useRef(generatedNetlist);
  const historyRef = useRef<EditorSnapshot[]>([]);

  useEffect(() => {
    levelsRef.current = levels;
    activeLevelIdRef.current = activeLevelId;
    netlistModeRef.current = netlistMode;
    netlistTextRef.current = netlistText;
    generatedNetlistRef.current = generatedNetlist;
  }, [levels, activeLevelId, netlistMode, netlistText, generatedNetlist]);

  const pushEditorHistory = useCallback(() => {
    historyRef.current.push({
      levels: cloneLevels(levelsRef.current),
      activeLevelId: activeLevelIdRef.current,
      netlistMode: netlistModeRef.current,
      netlistText: netlistTextRef.current,
      generatedNetlist: generatedNetlistRef.current
    });
    if (historyRef.current.length > 100) {
      historyRef.current.shift();
    }
  }, []);

  const undoEditor = useCallback(() => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) {
      setStatusMsg("Nothing to roll back.");
      return;
    }
    setLevels(cloneLevels(snapshot.levels));
    setActiveLevelId(snapshot.activeLevelId);
    setNetlistMode(snapshot.netlistMode);
    setNetlistText(snapshot.netlistText);
    setGeneratedNetlist(snapshot.generatedNetlist);
    setSelectedIds(new Set());
    setPendingDevice(null);
    setProbeMode(false);
    setStatus("idle");
    setStatusMsg("Rolled back last schematic edit.");
  }, []);

  const stopStatusTimer = useCallback(() => {
    if (statusStartRef.current !== null) {
      setStatusElapsedMs(performance.now() - statusStartRef.current);
    }
    if (statusTimerRef.current !== null) {
      window.clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    statusStartRef.current = null;
  }, []);

  const startStatusTimer = useCallback(() => {
    stopStatusTimer();
    statusStartRef.current = performance.now();
    statusIterationsRef.current = 0;
    statusIterationPaintRef.current = 0;
    setStatusElapsedMs(0);
    setStatusIterations(0);
    statusTimerRef.current = window.setInterval(() => {
      if (statusStartRef.current !== null) {
        setStatusElapsedMs(performance.now() - statusStartRef.current);
      }
    }, 250);
  }, [stopStatusTimer]);

  const setStatusIterationCount = useCallback((count: number) => {
    statusIterationsRef.current = Math.max(0, Math.floor(count));
    setStatusIterations(statusIterationsRef.current);
  }, []);

  const bumpStatusIteration = useCallback(() => {
    statusIterationsRef.current += 1;
    const now = performance.now();
    if (now - statusIterationPaintRef.current > 250) {
      statusIterationPaintRef.current = now;
      setStatusIterations(statusIterationsRef.current);
    }
  }, []);

  const beginDynamicMetrics = useCallback((tileId: string) => {
    activeDynamicTilesRef.current.add(tileId);
    startStatusTimer();
  }, [startStatusTimer]);

  const endDynamicMetrics = useCallback((tileId: string) => {
    activeDynamicTilesRef.current.delete(tileId);
    setStatusIterationCount(statusIterationsRef.current);
    if (activeDynamicTilesRef.current.size === 0) {
      stopStatusTimer();
    }
  }, [setStatusIterationCount, stopStatusTimer]);

  useEffect(() => () => stopStatusTimer(), [stopStatusTimer]);

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

  const handleNetlistTextChange = useCallback(
    (nextText: string): boolean => {
      if (netlistMode !== "netlist") {
        const ok = window.confirm(
          "Editing the netlist will clear the current schematic hierarchy and switch this workspace to raw netlist mode. Continue?"
        );
        if (!ok) return false;
        pushEditorHistory();
        setLevels([
          {
            id: "root",
            title: "Netlist",
            components: [],
            wires: [],
            pins: [],
            parentId: null
          }
        ]);
        setActiveLevelId("root");
        setSelectedIds(new Set());
        setPendingDevice(null);
        setProbeMode(false);
        setGeneratedNetlist("");
        setResponsePreview("");
        setNetlistMode("netlist");
        setStatus("idle");
        setStatusMsg("Schematic cleared; netlist editor is active.");
      }
      setNetlistText(nextText);
      return true;
    },
    [netlistMode, pushEditorHistory]
  );

  /**
   * The probe-node picker lists labels exactly as they appear in the plot
   * (``V(<net>)`` and ``I(<branch>)``). Storing the full label in
   * ``analysis.probeNodes`` lets the waveform filter do a direct string match
   * — otherwise "n1" picks would never line up with "V(n1)" series.
   */
  const availableNodes = useMemo(() => {
    const nodeSet = new Set<string>();
    const branchSet = new Set<string>();
    const lines = (netlistMode === "netlist" ? netlistText : generatedNetlist).split(/\r?\n/);
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
  }, [generatedNetlist, netlistMode, netlistText]);

  /* -------------- Toolbar / library -------------- */

  const startDragType = useCallback((type: DeviceType) => {
    setPendingDevice(type);
    setProbeMode(false);
  }, []);

  const rotateSelection = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushEditorHistory();
    setActiveComponents((cur) =>
      cur.map((component) =>
        selectedIds.has(component.id)
          ? { ...component, rotation: ((component.rotation + 90) % 360) as CanvasComponent["rotation"] }
          : component
      )
    );
    setStatusMsg("Rotated selection.");
  }, [pushEditorHistory, selectedIds, setActiveComponents]);

  const mirrorSelection = useCallback(() => {
    if (selectedIds.size === 0) return;
    pushEditorHistory();
    setActiveComponents((cur) =>
      cur.map((component) =>
        selectedIds.has(component.id) ? { ...component, mirrored: !component.mirrored } : component
      )
    );
    setStatusMsg("Mirrored selection.");
  }, [pushEditorHistory, selectedIds, setActiveComponents]);

  const openHelp = useCallback(() => {
    setDemoOpen(false);
    setHelpOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (event.key === "Escape" && helpOpen) {
        setHelpOpen(false);
        event.preventDefault();
        return;
      }
      if (event.key === "Escape" && pendingDevice) {
        setPendingDevice(null);
        setStatusMsg("Component placement canceled.");
        event.preventDefault();
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      if (key === "z") {
        undoEditor();
        event.preventDefault();
      } else if (key === "r") {
        rotateSelection();
        event.preventDefault();
      } else if (key === "e") {
        mirrorSelection();
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [helpOpen, mirrorSelection, pendingDevice, rotateSelection, undoEditor]);

  /* -------------- Property update -------------- */

  const updateComponent = useCallback(
    (id: string, patch: Partial<CanvasComponent>) => {
      pushEditorHistory();
      setLevels((cur) => {
        const activeBefore = cur.find((level) => level.id === activeLevelId);
        const oldEntityPins = activeBefore
          ? activeBefore.pins.length > 0 ? activeBefore.pins : inferredLevelPins(activeBefore)
          : [];
        let newEntityPins = oldEntityPins;
        let entityPinsChanged = false;

        const nextLevels = cur.map((level) => {
          if (level.id !== activeLevelId) return level;
          const previous = level.components.find((component) => component.id === id);
          if (!previous) return level;

          const nextComponents = level.components.map((component) =>
            component.id === id ? { ...component, ...patch } : component
          );

          let nextWires = level.wires;
          if (previous.type === "SUBCKT" && patch.pins) {
            nextWires = rewriteSubcktPinEndpoints(
              nextWires,
              id,
              previous.pins ?? [],
              patch.pins
            );
          }

          let nextLevel: SchematicLevel = { ...level, components: nextComponents, wires: nextWires };
          if (level.parentId !== null && previous.type === "NODE") {
            const oldNodePin = normalizeNodeName(previous.name || previous.value || previous.id);
            const updatedNode = nextComponents.find((component) => component.id === id);
            const newNodePin = normalizeNodeName(updatedNode?.name || updatedNode?.value || updatedNode?.id || oldNodePin);
            newEntityPins = oldEntityPins.includes(oldNodePin)
              ? uniquePins(oldEntityPins.map((pin) => (pin === oldNodePin ? newNodePin : pin)))
              : inferredLevelPins(nextLevel);
            if (!samePins(oldEntityPins, newEntityPins)) {
              entityPinsChanged = true;
              nextLevel = { ...nextLevel, pins: [...newEntityPins] };
            }
          }
          return nextLevel;
        });

        if (!entityPinsChanged) return nextLevels;
        return nextLevels.map((level) =>
          level.id === activeLevelId
            ? level
            : syncInstancesForEntity(level, activeLevelId, oldEntityPins, newEntityPins)
        );
      });
    },
    [activeLevelId, pushEditorHistory]
  );

  /* -------------- Run simulation -------------- */

  const runSimulation = useCallback(async () => {
    if (running) return;
    activeDynamicTilesRef.current.clear();
    startStatusTimer();
    setRunning(true);
    setStatus("running");
    setStatusMsg("");
    const schematicPayload =
      netlistMode === "netlist"
        ? null
        : buildSchematicPayload(
            activeLevel.components,
            activeLevel.wires,
            analysis,
            levels,
            activeLevel.junctions ?? []
          );
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          netlist_text: netlistMode === "netlist" ? netlistText : "",
          mode: analysis.mode,
          options: { ...simulationRequestOptions(analysis), output_max_points: MAX_STATIC_PLOT_POINTS },
          schematic: schematicPayload ?? undefined
        })
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus("error");
        setStatusMsg(body?.detail?.message ?? "Simulation failed.");
        setResponsePreview(formatResponsePreview(body));
      } else {
        setStatus("ok");
        setStatusMsg(`${analysis.mode.toUpperCase()} complete (${body.status}).`);
        setStatusIterationCount(responseIterationCount(body, analysis.mode));
        if (body?.metadata?.generated_netlist) {
          setGeneratedNetlist(String(body.metadata.generated_netlist));
        } else if (netlistMode === "netlist") {
          setGeneratedNetlist(netlistText);
        }
        setResponsePreview(formatResponsePreview(body));

        // Materialize a result tile.
        if (analysis.mode === "tran" && body.waveform) {
          const data = toPlotData(body.waveform, "time (s)", "V", analysis.probeNodes);
          addTile({
            title: `.tran — ${analysis.tStop}`,
            mode: "static",
            view: "plot",
            data
          });
        } else if (analysis.mode === "ac" && body.spectrum) {
          const data = toSpectrumPlot(body.spectrum, { kind: "line", db: true, filterLabels: analysis.probeNodes });
          addTile({ title: `.ac sweep`, mode: "static", view: "plot", data });
        } else if (analysis.mode === "hb" && body.spectrum) {
          const f0 = Number(body?.metadata?.base_frequency_hz ?? 0);
          const data = toSpectrumPlot(body.spectrum, { kind: "stem", filterLabels: analysis.probeNodes });
          addTile({
            title: f0 > 0 ? `.hb spectrum · f0 ${formatCompact(f0)}Hz` : `.hb spectrum`,
            mode: "static",
            view: "plot",
            data,
            w: 520,
            h: 300
          });
        } else if (analysis.mode === "hb" && body.waveform) {
          const data = toPlotData(body.waveform, "time (s)", "V", analysis.probeNodes);
          addTile({
            title: `.hb reconstruct — ${analysis.hbTimeWindow || "window"}`,
            mode: "static",
            view: "plot",
            data,
            w: 520,
            h: 300
          });
        } else if (analysis.mode === "op" && body.dc_solution) {
          addTile({
            title: `.op — matrices and operating point`,
            mode: "static",
            view: "op",
            opData: {
              labels: body.labels ?? [],
              values: body.dc_solution ?? [],
              matrices: body.matrices ?? {},
              deviceOperatingPoints: body.metadata?.device_operating_points ?? [],
              filterLabels: analysis.probeNodes
            },
            w: 760,
            h: 520
          });
        }
      }
    } catch (err) {
      setStatus("error");
      setStatusMsg(String(err));
    } finally {
      setRunning(false);
      stopStatusTimer();
    }
  }, [analysis, activeLevel, levels, netlistMode, netlistText, running, setStatusIterationCount, startStatusTimer, stopStatusTimer]);

  /* -------------- Probe click → open .dyn tile -------------- */

  const onProbePick = useCallback(
    (target: ProbeTarget) => {
      if (netlistMode === "netlist") {
        setStatus("error");
        setStatusMsg("Dynamic probe needs a schematic. Run the edited netlist with Run.");
        return;
      }
      const payload = buildSchematicPayload(
        activeLevel.components,
        activeLevel.wires,
        analysis,
        levels,
        activeLevel.junctions ?? []
      );
      const speed = parseValue(analysis.dynSpeed);
      const windowSim = parseValue(analysis.dynWindow);
      const tileId = genId("tile");
      const nodeLabel = target.netLabel ?? `${target.componentId}.${target.pin}`;

      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws/dyn`);
      const titleSuffix = "∞";
      const tileRecord: TileRecord = {
        id: tileId,
        title: `.dyn ${nodeLabel} @ ${analysis.dynSpeed}s/s · ${titleSuffix}`,
        x: Math.max(40, target.x + 60),
        y: Math.max(40, target.y - 80),
        w: 380,
        h: 240,
        mode: "dyn",
        view: "plot",
        socket: ws,
        probe: target,
        windowSeconds: windowSim
      };
      setTiles((cur) => [...cur, tileRecord]);
      beginDynamicMetrics(tileId);
      setStatus("running");
      setStatusMsg(`Dynamic probe: ${nodeLabel}.`);

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            schematic: payload,
            speed,
            t_stop: analysis.tStop,
            t_step: analysis.tStep,
            window: analysis.dynWindow,
            pin_refs: [{ component_id: target.componentId, pin: target.pin }],
            continuous: true,
            ...simulationRequestOptions(analysis)
          })
        );
      };

      let streamLabels: string[] = [];
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "meta") {
          streamLabels = msg.labels ?? [];
          setStatusMsg(`Dynamic probe: ${streamLabels.length} series.`);
        } else if (msg.type === "frame") {
          const rec = tilesRef.current.get(tileId);
          if (rec?.push && streamLabels.length > 0) {
            const vals = (msg.values as number[]).map((v) => Number(v) || 0);
            rec.push(Number(msg.t), vals, streamLabels);
            bumpStatusIteration();
          }
        } else if (msg.type === "loop") {
          // Loop boundaries are accepted for compatibility with older clients.
        } else if (msg.type === "done") {
          const rec = tilesRef.current.get(tileId);
          rec?.finalize?.();
          endDynamicMetrics(tileId);
        } else if (msg.type === "error") {
          setStatus("error");
          setStatusMsg(String(msg.message));
          endDynamicMetrics(tileId);
        }
      };
      ws.onerror = () => {
        setStatus("error");
        setStatusMsg("Realtime stream failed.");
        endDynamicMetrics(tileId);
      };
    },
    [activeLevel, analysis, beginDynamicMetrics, bumpStatusIteration, endDynamicMetrics, levels, netlistMode]
  );

  const startCaredNodeDisplay = useCallback(() => {
    if (netlistMode === "netlist") {
      setStatus("error");
      setStatusMsg("Dynamic display needs a schematic. Run the edited netlist with Run.");
      return;
    }
    const payload = buildSchematicPayload(
      activeLevel.components,
      activeLevel.wires,
      analysis,
      levels,
      activeLevel.junctions ?? []
    );
    const speed = parseValue(analysis.dynSpeed);
    const windowSim = parseValue(analysis.dynWindow);
    const tileId = genId("tile");
    const canvas = document.querySelector(".canvasArea") as HTMLElement | null;
    const tileW = 520;
    const tileH = 280;

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws/dyn`);
    const titleSuffix = "∞";
    const labelsTitle =
      analysis.probeNodes.length === 0
        ? "all nodes"
        : analysis.probeNodes.length === 1
          ? analysis.probeNodes[0]
          : `${analysis.probeNodes.length} nodes`;
    const tileRecord: TileRecord = {
      id: tileId,
      title: `.dyn ${labelsTitle} @ ${analysis.dynSpeed}s/s · ${titleSuffix}`,
      x: Math.max(40, (canvas?.clientWidth ?? 620) - tileW - 24),
      y: 56,
      w: tileW,
      h: tileH,
      mode: "dyn",
      view: "plot",
      socket: ws,
      windowSeconds: windowSim
    };
    setTiles((cur) => [...cur, tileRecord]);
    beginDynamicMetrics(tileId);
    setStatus("running");
    setStatusMsg(`Dynamic display: ${labelsTitle}.`);

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          schematic: payload,
          speed,
          t_stop: analysis.tStop,
          t_step: analysis.tStep,
          window: analysis.dynWindow,
          nodes: analysis.probeNodes,
          continuous: true,
          ...simulationRequestOptions(analysis)
        })
      );
    };

    let streamLabels: string[] = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "meta") {
        streamLabels = msg.labels ?? [];
        setStatusMsg(`Dynamic display: ${streamLabels.length} series.`);
      } else if (msg.type === "frame") {
        const rec = tilesRef.current.get(tileId);
        if (rec?.push && streamLabels.length > 0) {
          const vals = (msg.values as number[]).map((v) => Number(v) || 0);
          rec.push(Number(msg.t), vals, streamLabels);
          bumpStatusIteration();
        }
      } else if (msg.type === "done") {
        const rec = tilesRef.current.get(tileId);
        rec?.finalize?.();
        endDynamicMetrics(tileId);
      } else if (msg.type === "loop") {
        // Continuous display loop boundary.
      } else if (msg.type === "error") {
        setStatus("error");
        setStatusMsg(String(msg.message));
        endDynamicMetrics(tileId);
      }
    };
    ws.onerror = () => {
      setStatus("error");
      setStatusMsg("Realtime display failed.");
      endDynamicMetrics(tileId);
    };
  }, [activeLevel, analysis, beginDynamicMetrics, bumpStatusIteration, endDynamicMetrics, levels, netlistMode]);

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
      view: "plot",
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
    endDynamicMetrics(id);
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
  const clearProbeNodes = useCallback(() => {
    setAnalysis((cur) => ({ ...cur, probeNodes: [] }));
  }, []);
  const addMorOutputNode = useCallback(
    (label: string) => {
      setAnalysis((cur) =>
        cur.morOutputNodes.includes(label) ? cur : { ...cur, morOutputNodes: [...cur.morOutputNodes, label] }
      );
    },
    []
  );
  const removeMorOutputNode = useCallback(
    (label: string) => setAnalysis((cur) => ({ ...cur, morOutputNodes: cur.morOutputNodes.filter((n) => n !== label) })),
    []
  );
  const clearMorOutputNodes = useCallback(() => {
    setAnalysis((cur) => ({ ...cur, morOutputNodes: [] }));
  }, []);
  const resetAnalysisControls = useCallback(() => {
    setAnalysis({ ...defaultAnalysis });
    setStatus("idle");
    setStatusMsg("Simulation controls reset.");
  }, []);

  /* -------------- Presets / demos -------------- */

  function applyPreset(preset: SchematicPreset) {
    pushEditorHistory();
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
    setNetlistMode("schematic");
    setNetlistText("");
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
    pushEditorHistory();
    const id = genId("level");
    const title = parentId === null ? `Level ${levels.length}` : `Subckt ${levels.filter((l) => l.parentId).length + 1}`;
    setLevels((cur) => [
      ...cur,
      { id, title, components: [], wires: [], pins: ["a", "b"], parentId }
    ]);
    setActiveLevelId(id);
  }
  function renameLevel(id: string, title: string) {
    pushEditorHistory();
    updateLevel(id, { title });
  }
  function deleteLevel(id: string) {
    pushEditorHistory();
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
    setLevels((cur) => {
      const survivors = cur.filter((l) => !doomed.has(l.id));
      if (survivors.length > 0) {
        return survivors;
      }
      return [
        {
          id: "root",
          title: "Top level",
          components: [],
          wires: [],
          pins: [],
          parentId: null
        }
      ];
    });
    if (doomed.has(activeLevelId)) {
      const survivors = levels.filter((l) => !doomed.has(l.id));
      setActiveLevelId(survivors.find((l) => l.parentId === null)?.id ?? survivors[0]?.id ?? "root");
    }
  }

  /* -------------- Copy / paste -------------- */

  const onCopy = useCallback((data: ClipboardData) => {
    setClipboard(data);
    setStatusMsg(`Copied ${data.components.length} component${data.components.length === 1 ? "" : "s"}.`);
  }, []);

  const onPaste = useCallback(() => {
    if (!clipboard || clipboard.components.length === 0) return;
    pushEditorHistory();
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
  }, [clipboard, pushEditorHistory, setActiveComponents, setActiveWires]);

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
                {DEMO_MENU_GROUPS.map((group) => (
                  <div key={group.title} className="menubar__dropdownGroup">
                    <div className="menubar__dropdownHeading">{group.title}</div>
                    {group.presets.map((d) => (
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
                ))}
              </div>
            ) : null}
          </div>
          <button className="menubar__item" onClick={openHelp}>Help</button>
        </div>
        <div className="menubar__spacer" />
        <div className="menubar__status">
          <span className={`statusDot ${status}`} />
          <span>{statusMsg || (status === "idle" ? "Ready" : status)}</span>
          <span className="menubar__metric">t {formatElapsed(statusElapsedMs)}</span>
          <span className="menubar__metric">iter {formatCount(statusIterations)}</span>
        </div>
      </div>

      <Toolbar
        pendingDevice={pendingDevice}
        onPickDevice={setPendingDevice}
        onToggleProbe={() => setProbeMode((v) => !v)}
        probeMode={probeMode}
        onStartDisplay={startCaredNodeDisplay}
        onOpenHelp={openHelp}
        running={running}
      />

      {helpOpen ? (
        <div className="modalBackdrop" onMouseDown={() => setHelpOpen(false)}>
          <section
            className="modal helpDialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="helpDialog__header">
              <div>
                <h2 id="help-dialog-title">MNA Simulation User Guide</h2>
                <p>
                  A practical map for drawing circuits, running analyses, reading results, and using the larger demos.
                </p>
              </div>
              <button className="helpDialog__close" onClick={() => setHelpOpen(false)} aria-label="Close help">
                ×
              </button>
            </div>
            <div className="helpDialog__body">
              {USER_GUIDE_SECTIONS.map((section) => (
                <section key={section.title} className="helpSection">
                  <h3>{section.title}</h3>
                  <ul>
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="modalActions">
              <button className="ghostBtn" onClick={() => setHelpOpen(false)}>Close</button>
            </div>
          </section>
        </div>
      ) : null}

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
        onClearProbeNodes={clearProbeNodes}
        onAddMorOutputNode={addMorOutputNode}
        onRemoveMorOutputNode={removeMorOutputNode}
        onClearMorOutputNodes={clearMorOutputNodes}
        onResetAnalysis={resetAnalysisControls}
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
        netlistMode={netlistMode}
        netlistText={netlistText}
        onNetlistTextChange={handleNetlistTextChange}
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
          onBeforeEdit={pushEditorHistory}
          onProbePick={onProbePick}
          onCopy={onCopy}
          onPaste={onPaste}
        />
        <div className="tileLayer">
          {tiles.map((tile) => (
            tile.view === "op" && tile.opData ? (
              <ResultTile
                key={tile.id}
                id={tile.id}
                title={tile.title}
                x={tile.x}
                y={tile.y}
                w={tile.w}
                h={tile.h}
                opData={tile.opData}
                onMove={moveTile}
                onResize={resizeTile}
                onClose={closeTile}
              />
            ) : (
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
            )
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
          Shift+click: multi-select · drag: marquee · Ctrl+C/V: copy/paste · Ctrl+R: rotate · Ctrl+E: mirror · Ctrl+Z: rollback · Del: delete
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

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, ms / 1000);
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

function sampledIndexes(length: number, maxPoints: number): number[] | null {
  if (length <= maxPoints) return null;
  const stride = Math.max(1, Math.ceil(length / maxPoints));
  const indexes: number[] = [];
  for (let i = 0; i < length; i += stride) indexes.push(i);
  if (indexes[indexes.length - 1] !== length - 1) indexes.push(length - 1);
  return indexes;
}

function responseIterationCount(body: Record<string, any>, mode: string): number {
  const krylovIterations = Number(body?.metadata?.krylov_iterations);
  if (Number.isFinite(krylovIterations) && krylovIterations > 0) {
    return krylovIterations;
  }
  const decimation = body?.metadata?.output_decimation;
  if (mode === "tran" && body?.waveform?.time) {
    return Number(decimation?.original_points ?? body.waveform.time.length ?? 0);
  }
  if (body?.waveform?.time) return Number(body.waveform.time.length ?? 0);
  if (body?.spectrum?.frequencies) return Number(body.spectrum.frequencies.length ?? 0);
  if (body?.dc_solution) return Number(body.dc_solution.length ?? 0);
  return 0;
}

function nestedValueCount(values: unknown): number {
  if (!Array.isArray(values)) return 0;
  if (values.length === 0) return 0;
  if (Array.isArray(values[0])) {
    return (values as unknown[][]).reduce((sum, row) => sum + row.length, 0);
  }
  return values.length;
}

function compactSeriesPayload(payload: unknown, axisKey: "time" | "frequencies"): unknown {
  if (!payload || typeof payload !== "object") return payload;
  const record = payload as Record<string, unknown>;
  const axis = Array.isArray(record[axisKey]) ? (record[axisKey] as unknown[]) : [];
  const valueKey = record.values !== undefined ? "values" : "magnitudes";
  const values = record[valueKey];
  const totalValues = nestedValueCount(values);
  if (axis.length + totalValues <= MAX_RESPONSE_PREVIEW_VALUES) return payload;
  const valueRows = Array.isArray(values) ? values.length : 0;
  const valueCols = valueRows > 0 && Array.isArray((values as unknown[])[0]) ? ((values as unknown[][])[0]?.length ?? 0) : valueRows;
  return {
    [axisKey]: {
      count: axis.length,
      first: axis[0],
      last: axis[axis.length - 1]
    },
    [valueKey]: {
      shape: [valueRows, valueCols],
      omitted: totalValues
    },
    labels: record.labels
  };
}

function formatResponsePreview(body: unknown): string {
  if (!body || typeof body !== "object") {
    return JSON.stringify(body, null, 2);
  }
  const record = body as Record<string, unknown>;
  const preview = {
    ...record,
    waveform: compactSeriesPayload(record.waveform, "time"),
    spectrum: compactSeriesPayload(record.spectrum, "frequencies")
  };
  return JSON.stringify(preview, null, 2);
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
  const wanted = filterLabels.length > 0 ? new Set(filterLabels) : null;
  const labelIndexes = labels
    .map((label, index) => ({ label, index }))
    .filter((entry) => !wanted || wanted.has(entry.label));
  const sample = sampledIndexes(t.length, MAX_STATIC_PLOT_POINTS);
  const x = sample ? sample.map((i) => Number(t[i] ?? 0)) : t;
  const rows = vs.length;
  const cols = rows > 0 ? (Array.isArray(vs[0]) ? vs[0].length : 0) : 0;
  const isRowMajor = rows === t.length && cols === labels.length;
  let series: { label: string; values: number[] }[];
  if (isRowMajor) {
    series = labelIndexes.map(({ label, index }) => ({
      label,
      values: sample
        ? sample.map((i) => Number((vs[i] as number[] | undefined)?.[index] ?? 0))
        : vs.map((row) => Number((row as number[])[index] ?? 0))
    }));
  } else {
    series = labelIndexes.map(({ label, index }) => ({
      label,
      values: sample
        ? sample.map((i) => Number((vs[index] as number[] | undefined)?.[i] ?? 0))
        : (vs[index] as number[] | undefined)?.map((v) => Number(v)) ?? []
    }));
  }
  return { x, series, xLabel, yLabel };
}

function toSpectrumPlot(spectrum: {
  frequencies: number[];
  magnitudes: number[][] | number[];
  labels: string[];
}, options: { kind?: PlotData["kind"]; db?: boolean; filterLabels?: string[] } = {}): PlotData {
  const kind = options.kind ?? "line";
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
  if (options.filterLabels && options.filterLabels.length > 0) {
    const wanted = new Set(options.filterLabels);
    series = series.filter((s) => wanted.has(s.label));
  }
  if (options.db) {
    series = series.map((s) => ({
      ...s,
      values: s.values.map((v) => 20 * Math.log10(Math.max(Math.abs(v), 1e-15)))
    }));
  }
  return {
    x: freq,
    series,
    xLabel: "frequency (Hz)",
    yLabel: options.db ? "magnitude (dB)" : "magnitude",
    kind,
    logX: kind === "line",
    title: kind === "stem" ? "Harmonic magnitudes" : options.db ? "AC magnitude" : undefined
  };
}

function opResultPlotData(labels: string[], values: number[], filterLabels: string[] = []): PlotData {
  const wanted = new Set(filterLabels);
  const pairs = labels
    .map((label, i) => ({ label, value: Number(values[i] ?? 0) }))
    .filter((entry) => filterLabels.length === 0 || wanted.has(entry.label));
  const x = pairs.map((_, i) => i);
  return {
    x,
    series: [{ label: "DC", values: pairs.map((entry) => entry.value) }],
    xLabel: "",
    yLabel: "value",
    kind: "bar",
    xTickLabels: pairs.map((entry) => entry.label),
    title: "DC operating point"
  };
}

function formatCompact(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2).replace(/\.?0+$/, "")}k`;
  return value.toFixed(2).replace(/\.?0+$/, "");
}
