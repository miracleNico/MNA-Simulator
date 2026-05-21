/**
 * Frontend data model for the schematic editor.
 *
 * Kept in lock-step with backend `SchematicDocument` in
 * `mna_simulation/api/contracts.py`. Only the fields exchanged with the API
 * must match exactly; UI-only fields (position, rotation, etc.) are local.
 */

export type DeviceType =
  | "R"
  | "C"
  | "L"
  | "V"
  | "I"
  | "D"
  | "GND"
  | "VCVS"
  | "VCCS"
  | "CCCS"
  | "CCVS"
  | "QNPN"
  | "QPNP"
  | "NMOS"
  | "PMOS"
  | "SUBCKT";

export type BasicAnalysisMode = "op" | "tran" | "ac" | "hb" | "dyn";

export type Rotation = 0 | 90 | 180 | 270;

export type CanvasComponent = {
  id: string;
  type: DeviceType;
  name: string;
  value: string;
  subtype?: string;
  value2?: string;
  value3?: string;
  ctrlNode1?: string;
  ctrlNode2?: string;
  ctrlSource?: string;
  subcircuitId?: string;
  pins?: string[];
  x: number;
  y: number;
  rotation: Rotation;
};

/** Wire endpoint may be anchored to a component pin or float as a free point. */
export type WireEndpoint =
  | { kind: "pin"; componentId: string; pin: string }
  | { kind: "point"; x: number; y: number };

export type CanvasWire = {
  id: string;
  start: WireEndpoint;
  end: WireEndpoint;
};

export type AnalysisState = {
  mode: BasicAnalysisMode;
  tStop: string;
  tStep: string;
  fStart: string;
  fStop: string;
  points: number;
  harmonics: number;
  /** Optional .hb time-domain reconstruction window, e.g. "200m"; empty = spectrum. */
  hbTimeWindow: string;
  /** For .dyn: simulation-seconds per wall-second. */
  dynSpeed: string;
  /** Rolling sim-time window for live .dyn scope (e.g. "5m" = 5 ms). */
  dynWindow: string;
  /** Selected nodes for .tran result display (empty = all). */
  probeNodes: string[];
  /** If true, probe-triggered streams loop indefinitely (infinite duration). */
  continuous: boolean;
};

/**
 * Named junction inside a hierarchy level. When a level is instantiated as
 * a SUBCKT on a parent canvas, junctions whose id matches ``port_<pinname>``
 * become the electrical bridge between outer pins and inner wires — see
 * ``_flatten_subcircuits`` in the Python pipeline.
 */
export type LevelJunction = {
  id: string;
  x: number;
  y: number;
};

export type SchematicLevel = {
  id: string;
  title: string;
  components: CanvasComponent[];
  wires: CanvasWire[];
  /** Declared external pin names for this level (used when instanced as SUBCKT). */
  pins: string[];
  /** Optional named junctions; usually ``port_<pin>`` markers for SUBCKT use. */
  junctions?: LevelJunction[];
  /** Parent level id for the hierarchy tree (null = root). */
  parentId: string | null;
};

export type SchematicPreset = {
  id: string;
  title: string;
  description: string;
  components: CanvasComponent[];
  wires: CanvasWire[];
  analysis: AnalysisState;
  /** Additional hierarchy levels beyond the root, e.g. for a multi-stage amp demo. */
  extraLevels?: Array<Omit<SchematicLevel, "parentId"> & { parentId: string | null }>;
};

/* --- Geometry / symbol layout --- */

export const GRID = 10;
export const COMPONENT_BOX = 72; // square hit-area for most two-terminal parts
export const GND_BOX = 48;

export type PinOffset = { dx: number; dy: number };

export const DEVICE_PIN_OFFSETS: Record<DeviceType, Record<string, PinOffset>> = {
  R: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  C: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  L: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  V: { p: { dx: 0, dy: -COMPONENT_BOX / 2 }, n: { dx: 0, dy: COMPONENT_BOX / 2 } },
  I: { p: { dx: 0, dy: -COMPONENT_BOX / 2 }, n: { dx: 0, dy: COMPONENT_BOX / 2 } },
  D: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  GND: { g: { dx: 0, dy: -GND_BOX / 2 } },
  VCVS: {
    p: { dx: COMPONENT_BOX / 2, dy: -COMPONENT_BOX / 4 },
    n: { dx: COMPONENT_BOX / 2, dy: COMPONENT_BOX / 4 },
    cp: { dx: -COMPONENT_BOX / 2, dy: -COMPONENT_BOX / 4 },
    cn: { dx: -COMPONENT_BOX / 2, dy: COMPONENT_BOX / 4 }
  },
  VCCS: {
    p: { dx: COMPONENT_BOX / 2, dy: -COMPONENT_BOX / 4 },
    n: { dx: COMPONENT_BOX / 2, dy: COMPONENT_BOX / 4 },
    cp: { dx: -COMPONENT_BOX / 2, dy: -COMPONENT_BOX / 4 },
    cn: { dx: -COMPONENT_BOX / 2, dy: COMPONENT_BOX / 4 }
  },
  CCCS: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  CCVS: { p: { dx: -COMPONENT_BOX / 2, dy: 0 }, n: { dx: COMPONENT_BOX / 2, dy: 0 } },
  QNPN: {
    c: { dx: 0, dy: -COMPONENT_BOX / 2 },
    b: { dx: -COMPONENT_BOX / 2, dy: 0 },
    e: { dx: 0, dy: COMPONENT_BOX / 2 }
  },
  QPNP: {
    c: { dx: 0, dy: COMPONENT_BOX / 2 },
    b: { dx: -COMPONENT_BOX / 2, dy: 0 },
    e: { dx: 0, dy: -COMPONENT_BOX / 2 }
  },
  NMOS: {
    d: { dx: 0, dy: -COMPONENT_BOX / 2 },
    g: { dx: -COMPONENT_BOX / 2, dy: 0 },
    s: { dx: 0, dy: COMPONENT_BOX / 2 }
  },
  PMOS: {
    d: { dx: 0, dy: COMPONENT_BOX / 2 },
    g: { dx: -COMPONENT_BOX / 2, dy: 0 },
    s: { dx: 0, dy: -COMPONENT_BOX / 2 }
  },
  SUBCKT: {}
};

const DEFAULT_VALUES: Record<DeviceType, string> = {
  R: "1k",
  C: "1u",
  L: "1m",
  V: "5",
  I: "1m",
  D: "1e-15",
  GND: "0",
  VCVS: "1",
  VCCS: "1",
  CCCS: "1",
  CCVS: "1",
  QNPN: "40m", // gm (S)
  QPNP: "40m",
  NMOS: "5m",
  PMOS: "5m",
  SUBCKT: "1"
};

export const DEVICE_LABELS: Record<DeviceType, string> = {
  R: "Resistor",
  C: "Capacitor",
  L: "Inductor",
  V: "V Source",
  I: "I Source",
  D: "Diode",
  GND: "Ground",
  VCVS: "VCVS (E)",
  VCCS: "VCCS (G)",
  CCCS: "CCCS (F)",
  CCVS: "CCVS (H)",
  QNPN: "BJT (NPN)",
  QPNP: "BJT (PNP)",
  NMOS: "NMOS",
  PMOS: "PMOS",
  SUBCKT: "Subckt"
};

export function snap(value: number, grid = GRID): number {
  return Math.round(value / grid) * grid;
}

export function getPinsForType(type: DeviceType, component?: CanvasComponent): string[] {
  if (type === "SUBCKT") {
    return component?.pins ?? [];
  }
  return Object.keys(DEVICE_PIN_OFFSETS[type] ?? {});
}

export function rotatePinOffset(offset: PinOffset, rotation: Rotation): PinOffset {
  switch (rotation) {
    case 90:
      return { dx: -offset.dy, dy: offset.dx };
    case 180:
      return { dx: -offset.dx, dy: -offset.dy };
    case 270:
      return { dx: offset.dy, dy: -offset.dx };
    default:
      return offset;
  }
}

export function getPinCoordinates(component: CanvasComponent, pin: string): { x: number; y: number } {
  if (component.type === "SUBCKT") {
    // Distribute pins around a rounded rectangle.
    const pins = component.pins ?? [];
    const index = Math.max(0, pins.indexOf(pin));
    const n = Math.max(1, pins.length);
    const side = Math.ceil(n / 4);
    const halfW = COMPONENT_BOX;
    const halfH = COMPONENT_BOX;
    const slot = index % side;
    const spacing = (COMPONENT_BOX * 2) / (side + 1);
    const ringIndex = Math.floor(index / side);
    let off: PinOffset;
    if (ringIndex === 0) {
      off = { dx: -halfW, dy: -halfH + spacing * (slot + 1) };
    } else if (ringIndex === 1) {
      off = { dx: halfW, dy: -halfH + spacing * (slot + 1) };
    } else if (ringIndex === 2) {
      off = { dx: -halfW + spacing * (slot + 1), dy: -halfH };
    } else {
      off = { dx: -halfW + spacing * (slot + 1), dy: halfH };
    }
    const rotated = rotatePinOffset(off, component.rotation);
    return { x: component.x + rotated.dx, y: component.y + rotated.dy };
  }
  const raw = DEVICE_PIN_OFFSETS[component.type]?.[pin];
  if (!raw) {
    return { x: component.x, y: component.y };
  }
  const rotated = rotatePinOffset(raw, component.rotation);
  return { x: component.x + rotated.dx, y: component.y + rotated.dy };
}

export function componentBounds(component: CanvasComponent): { x: number; y: number; w: number; h: number } {
  if (component.type === "GND") {
    return { x: component.x - GND_BOX / 2, y: component.y - GND_BOX / 2, w: GND_BOX, h: GND_BOX };
  }
  if (component.type === "SUBCKT") {
    return {
      x: component.x - COMPONENT_BOX,
      y: component.y - COMPONENT_BOX,
      w: COMPONENT_BOX * 2,
      h: COMPONENT_BOX * 2
    };
  }
  return { x: component.x - COMPONENT_BOX / 2, y: component.y - COMPONENT_BOX / 2, w: COMPONENT_BOX, h: COMPONENT_BOX };
}

export function createDefaultComponent(
  type: DeviceType,
  index: number,
  x: number,
  y: number
): CanvasComponent {
  const namePrefix =
    type === "GND" ? "GND" :
    type === "QNPN" || type === "QPNP" ? "Q" :
    type === "NMOS" || type === "PMOS" ? "M" :
    type;
  return {
    id: `${type.toLowerCase()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    name: `${namePrefix}${index}`,
    value: DEFAULT_VALUES[type],
    subtype: type === "V" || type === "I" ? "DC" : undefined,
    x: snap(x),
    y: snap(y),
    rotation: 0
  };
}

export function pinEndpoint(componentId: string, pin: string): WireEndpoint {
  return { kind: "pin", componentId, pin };
}
export function pointEndpoint(x: number, y: number): WireEndpoint {
  return { kind: "point", x: snap(x), y: snap(y) };
}

function endpointKey(ep: WireEndpoint): string {
  return ep.kind === "pin"
    ? `pin:${ep.componentId}:${ep.pin}`
    : `pt:${Math.round(ep.x)}:${Math.round(ep.y)}`;
}

export function wireKey(wire: CanvasWire): string {
  const ordered = [endpointKey(wire.start), endpointKey(wire.end)].sort();
  return `${ordered[0]}|${ordered[1]}`;
}

export function endpointXY(
  ep: WireEndpoint,
  componentsById: Map<string, CanvasComponent>
): { x: number; y: number } | null {
  if (ep.kind === "point") return { x: ep.x, y: ep.y };
  const c = componentsById.get(ep.componentId);
  if (!c) return null;
  return getPinCoordinates(c, ep.pin);
}

/** Endpoint key used for de-duplicating free wire points into shared junctions. */
function pointKey(x: number, y: number): string {
  return `${Math.round(x)}:${Math.round(y)}`;
}

/* ---- Frontend net-name computation ----------------------------------- */

class UnionFind {
  private parent = new Map<string, string>();
  add(k: string): void {
    if (!this.parent.has(k)) this.parent.set(k, k);
  }
  find(k: string): string {
    let p = this.parent.get(k) ?? k;
    if (p !== k) {
      p = this.find(p);
      this.parent.set(k, p);
    }
    return p;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/**
 * Assign a net name to every pin/free-point endpoint on the canvas.
 *
 * Mirrors the backend's union-find net formation so the user can see the same
 * net labels the simulator will compute. GND component pins anchor a special
 * "0" net. The result maps every wire-endpoint key (pin or coordinate) to its
 * net name, plus a per-wire net map for fast canvas drawing.
 */
export type NetAssignment = {
  /** ``cp:<componentId>:<pin>`` or ``pt:x:y`` → net name */
  byKey: Map<string, string>;
  /** wire id → net name (or "?" when an endpoint is unresolved) */
  byWire: Map<string, string>;
};

export function computeNetAssignments(
  components: CanvasComponent[],
  wires: CanvasWire[]
): NetAssignment {
  const uf = new UnionFind();
  const allKeys: string[] = [];

  function pinKey(componentId: string, pin: string): string {
    return `cp:${componentId}:${pin}`;
  }
  function ptKey(x: number, y: number): string {
    return `pt:${Math.round(x)}:${Math.round(y)}`;
  }
  function epKey(ep: WireEndpoint): string {
    return ep.kind === "pin" ? pinKey(ep.componentId, ep.pin) : ptKey(ep.x, ep.y);
  }

  // Seed every component pin.
  for (const c of components) {
    for (const pin of getPinsForType(c.type, c)) {
      const k = pinKey(c.id, pin);
      uf.add(k);
      allKeys.push(k);
    }
  }
  // Seed wire endpoints (free points get their own keys) and union the pair.
  for (const w of wires) {
    const a = epKey(w.start);
    const b = epKey(w.end);
    uf.add(a);
    uf.add(b);
    if (!allKeys.includes(a)) allKeys.push(a);
    if (!allKeys.includes(b)) allKeys.push(b);
    uf.union(a, b);
  }

  // Identify ground roots.
  const groundRoots = new Set<string>();
  for (const c of components) {
    if (c.type === "GND") {
      const gk = pinKey(c.id, "g");
      uf.add(gk);
      groundRoots.add(uf.find(gk));
    }
  }

  const rootToNet = new Map<string, string>();
  let counter = 1;
  for (const k of allKeys) {
    const r = uf.find(k);
    if (rootToNet.has(r)) continue;
    if (groundRoots.has(r)) rootToNet.set(r, "0");
    else rootToNet.set(r, `n${counter++}`);
  }

  const byKey = new Map<string, string>();
  for (const k of allKeys) {
    byKey.set(k, rootToNet.get(uf.find(k)) ?? "?");
  }
  const byWire = new Map<string, string>();
  for (const w of wires) {
    const k = epKey(w.start);
    byWire.set(w.id, byKey.get(k) ?? "?");
  }
  return { byKey, byWire };
}

/* ---- Transistor small-signal expansion -------------------------------- */

type ExpandedComponent = {
  id: string;
  type: Exclude<DeviceType, "NMOS" | "PMOS">;
  name: string;
  value: string | null;
  subtype: string | null;
  value2: string | null;
  value3: string | null;
  ctrl_node1: string | null;
  ctrl_node2: string | null;
  ctrl_source: string | null;
  subcircuit_id: string | null;
  pins: string[] | null;
  position: { x: number; y: number };
};

type ExpandedWire = {
  id: string;
  start:
    | { kind: "component_pin"; component_id: string; pin: string }
    | { kind: "junction"; junction_id: string };
  end:
    | { kind: "component_pin"; component_id: string; pin: string }
    | { kind: "junction"; junction_id: string };
};

type ExpandedJunction = { id: string; position?: { x: number; y: number } };

function expandSchematic(
  components: CanvasComponent[],
  wires: CanvasWire[],
  namedJunctions: LevelJunction[] = []
): {
  components: ExpandedComponent[];
  wires: ExpandedWire[];
  junctions: ExpandedJunction[];
} {
  const outComponents: ExpandedComponent[] = [];
  const outWires: ExpandedWire[] = [];
  const junctionMap = new Map<string, ExpandedJunction>();
  // Map from original {componentId, pin} -> rewritten endpoint (junction or pin).
  const pinRewrite = new Map<string, ExpandedWire["start"]>();
  const componentsById = new Map(components.map((c) => [c.id, c]));

  function ensureJunction(id: string, x: number, y: number): void {
    if (!junctionMap.has(id)) junctionMap.set(id, { id, position: { x, y } });
  }

  // Pre-register named junctions (e.g. ``port_in``) so any wire whose point
  // endpoint sits on top of one resolves to that explicit name rather than an
  // auto-generated ``jp_x_y``. This is what makes the SUBCKT pipeline work —
  // the backend's flatten step looks for inner junctions named ``port_<pin>``.
  const namedByCoord = new Map<string, string>();
  for (const j of namedJunctions) {
    const sx = snap(j.x);
    const sy = snap(j.y);
    namedByCoord.set(`${sx}:${sy}`, j.id);
    ensureJunction(j.id, sx, sy);
  }

  function pinSlotKey(componentId: string, pin: string): string {
    return `${componentId}:${pin}`;
  }

  // 1. Pass through ordinary components verbatim. BJTs are now backend-owned
  // devices, so only MOSFET placeholders are expanded on the client.
  for (const c of components) {
    if (c.type === "NMOS" || c.type === "PMOS") {
      continue;
    }
    outComponents.push(serializeBasicComponent(c));
  }

  // 2. Replace each MOSFET with its small-signal equivalent.
  for (const c of components) {
    if (c.type !== "NMOS" && c.type !== "PMOS") continue;
    const pinNames = ["d", "g", "s"];
    // For each transistor pin create a junction.
    const pinJ: Record<string, string> = {};
    for (const pin of pinNames) {
      const pos = getPinCoordinates(c, pin);
      const jid = `j_${c.id}_${pin}`;
      ensureJunction(jid, pos.x, pos.y);
      pinJ[pin] = jid;
      pinRewrite.set(pinSlotKey(c.id, pin), { kind: "junction", junction_id: jid });
    }

    // MOSFET small-signal: VCCS only (gate has no DC current path)
    const dJ = pinJ.d;
    const gJ = pinJ.g;
    const sJ = pinJ.s;
    const gm = c.value || "5m";
    const vccsId = `_${c.id}_gm`;
    outComponents.push({
      id: vccsId,
      type: "VCCS",
      name: `G${c.name}`,
      value: gm,
      subtype: null,
      value2: null,
      value3: null,
      ctrl_node1: null,
      ctrl_node2: null,
      ctrl_source: null,
      subcircuit_id: null,
      pins: null,
      position: { x: c.x, y: c.y }
    });
    outWires.push({
      id: `_${c.id}_w_p`,
      start: { kind: "component_pin", component_id: vccsId, pin: "p" },
      end: { kind: "junction", junction_id: dJ }
    });
    outWires.push({
      id: `_${c.id}_w_n`,
      start: { kind: "component_pin", component_id: vccsId, pin: "n" },
      end: { kind: "junction", junction_id: sJ }
    });
    outWires.push({
      id: `_${c.id}_w_cp`,
      start: { kind: "component_pin", component_id: vccsId, pin: "cp" },
      end: { kind: "junction", junction_id: gJ }
    });
    outWires.push({
      id: `_${c.id}_w_cn`,
      start: { kind: "component_pin", component_id: vccsId, pin: "cn" },
      end: { kind: "junction", junction_id: sJ }
    });
  }

  // 3. Translate user wires; rewrite transistor-pin endpoints into the synthetic junctions, and free
  //    point endpoints into shared coordinate-keyed junctions.
  const pointJunctionByKey = new Map<string, string>();
  function pointJunctionId(x: number, y: number): string {
    const sx = snap(x);
    const sy = snap(y);
    const namedId = namedByCoord.get(`${sx}:${sy}`);
    if (namedId) return namedId;
    const key = pointKey(x, y);
    let id = pointJunctionByKey.get(key);
    if (!id) {
      id = `jp_${key.replace(/[^0-9a-z_]/gi, "_")}`;
      pointJunctionByKey.set(key, id);
      ensureJunction(id, x, y);
    }
    return id;
  }

  function translateEndpoint(ep: WireEndpoint): ExpandedWire["start"] | null {
    if (ep.kind === "point") {
      return { kind: "junction", junction_id: pointJunctionId(ep.x, ep.y) };
    }
    const rewrite = pinRewrite.get(`${ep.componentId}:${ep.pin}`);
    if (rewrite) return rewrite;
    if (!componentsById.has(ep.componentId)) return null;
    return { kind: "component_pin", component_id: ep.componentId, pin: ep.pin };
  }

  for (const w of wires) {
    const s = translateEndpoint(w.start);
    const e = translateEndpoint(w.end);
    if (!s || !e) continue;
    outWires.push({ id: w.id, start: s, end: e });
  }

  return {
    components: outComponents,
    wires: outWires,
    junctions: Array.from(junctionMap.values())
  };
}

function serializeBasicComponent(c: CanvasComponent): ExpandedComponent {
  return {
    id: c.id,
    type: c.type as ExpandedComponent["type"],
    name: c.name,
    value: c.type === "GND" ? null : c.value,
    subtype: c.type === "V" || c.type === "I" ? c.subtype ?? "DC" : null,
    value2: c.value2 ?? null,
    value3: c.value3 ?? null,
    ctrl_node1: c.ctrlNode1 ?? null,
    ctrl_node2: c.ctrlNode2 ?? null,
    ctrl_source: c.ctrlSource ?? null,
    subcircuit_id: c.subcircuitId ?? null,
    pins: c.pins ?? null,
    position: { x: c.x, y: c.y }
  };
}

export function buildSchematicPayload(
  components: CanvasComponent[],
  wires: CanvasWire[],
  analysis: AnalysisState,
  levels: SchematicLevel[] = []
): Record<string, unknown> {
  const analysisParams: Record<string, unknown> = {};
  if (analysis.mode === "tran" || analysis.mode === "dyn") {
    analysisParams.t_stop = analysis.tStop;
    analysisParams.t_step = analysis.tStep;
  } else if (analysis.mode === "ac") {
    analysisParams.f_start = analysis.fStart;
    analysisParams.f_stop = analysis.fStop;
    analysisParams.points = analysis.points;
  } else if (analysis.mode === "hb") {
    analysisParams.harmonics = analysis.harmonics;
    if (analysis.hbTimeWindow.trim()) {
      analysisParams.time_window = analysis.hbTimeWindow.trim();
    }
  }
  if (analysis.probeNodes.length > 0) {
    analysisParams.probe_nodes = analysis.probeNodes;
  }

  // Pass the active level's own named junctions (if any) so SUBCKT instances
  // at the root level can also use port-style junction names if desired.
  const rootLevel = levels.find((l) => l.parentId === null);
  const expanded = expandSchematic(components, wires, rootLevel?.junctions ?? []);

  const subcircuits: Record<string, unknown> = {};
  for (const level of levels) {
    if (level.parentId === null) continue;
    const sub = expandSchematic(level.components, level.wires, level.junctions ?? []);
    subcircuits[level.id] = {
      components: sub.components,
      wires: sub.wires,
      junctions: sub.junctions
    };
  }

  return {
    title: "Schematic",
    components: expanded.components,
    wires: expanded.wires,
    junctions: expanded.junctions,
    analysis: {
      mode: analysis.mode === "dyn" ? "dyn" : analysis.mode,
      params: analysisParams
    },
    subcircuits
  };
}
