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

export type PinReference = {
  componentId: string;
  pin: string;
};

export type CanvasWire = {
  id: string;
  start: PinReference;
  end: PinReference;
  /** Optional waypoint for orthogonal routing (local-only). */
  midX?: number;
  midY?: number;
};

export type AnalysisState = {
  mode: BasicAnalysisMode;
  tStop: string;
  tStep: string;
  fStart: string;
  fStop: string;
  points: number;
  harmonics: number;
  /** For .dyn: simulation-seconds per wall-second. */
  dynSpeed: string;
  /** Selected nodes for .tran result display (empty = all). */
  probeNodes: string[];
};

export type SchematicLevel = {
  id: string;
  title: string;
  components: CanvasComponent[];
  wires: CanvasWire[];
  /** Declared external pin names for this level (used when instanced as SUBCKT). */
  pins: string[];
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
  return {
    id: `${type.toLowerCase()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    name: type === "GND" ? `GND${index}` : `${type}${index}`,
    value: DEFAULT_VALUES[type],
    subtype: type === "V" || type === "I" ? "DC" : undefined,
    x: snap(x),
    y: snap(y),
    rotation: 0
  };
}

export function wireKey(wire: CanvasWire): string {
  const ordered = [
    `${wire.start.componentId}:${wire.start.pin}`,
    `${wire.end.componentId}:${wire.end.pin}`
  ].sort();
  return `${ordered[0]}|${ordered[1]}`;
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
  }
  if (analysis.probeNodes.length > 0) {
    analysisParams.probe_nodes = analysis.probeNodes;
  }

  const subcircuits: Record<string, unknown> = {};
  for (const level of levels) {
    if (level.parentId === null) continue;
    subcircuits[level.id] = {
      components: level.components.map(serializeComponent),
      wires: level.wires.map(serializeWire),
      junctions: []
    };
  }

  return {
    title: "Schematic",
    components: components.map(serializeComponent),
    wires: wires.map(serializeWire),
    junctions: [],
    analysis: {
      mode: analysis.mode === "dyn" ? "dyn" : analysis.mode,
      params: analysisParams
    },
    subcircuits
  };
}

function serializeComponent(component: CanvasComponent) {
  return {
    id: component.id,
    type: component.type,
    name: component.name,
    value: component.type === "GND" ? null : component.value,
    subtype: component.type === "V" || component.type === "I" ? component.subtype ?? "DC" : null,
    value2: component.value2 ?? null,
    value3: component.value3 ?? null,
    ctrl_node1: component.ctrlNode1 ?? null,
    ctrl_node2: component.ctrlNode2 ?? null,
    ctrl_source: component.ctrlSource ?? null,
    subcircuit_id: component.subcircuitId ?? null,
    pins: component.pins ?? null,
    position: { x: component.x, y: component.y }
  };
}

function serializeWire(wire: CanvasWire) {
  return {
    id: wire.id,
    start: { kind: "component_pin", component_id: wire.start.componentId, pin: wire.start.pin },
    end: { kind: "component_pin", component_id: wire.end.componentId, pin: wire.end.pin }
  };
}
