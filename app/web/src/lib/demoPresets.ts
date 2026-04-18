import { AnalysisState, CanvasComponent, CanvasWire, SchematicPreset, snap } from "./schematic";

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

function cloneAnalysis(overrides: Partial<AnalysisState>): AnalysisState {
  return { ...defaultAnalysis, ...overrides };
}

function mk(
  partial: Omit<CanvasComponent, "rotation"> & Partial<Pick<CanvasComponent, "rotation">>
): CanvasComponent {
  return { rotation: 0, ...partial, x: snap(partial.x), y: snap(partial.y) };
}

export const SCHEMATIC_PRESETS: SchematicPreset[] = [
  {
    id: "resistor-divider-op",
    title: "Resistor Divider (.op)",
    description: "A DC source feeding a resistor divider to ground.",
    analysis: cloneAnalysis({ mode: "op" }),
    components: [
      mk({ id: "v-1", type: "V", name: "V1", value: "10", subtype: "DC", x: 200, y: 200 }),
      mk({ id: "r-1", type: "R", name: "R1", value: "1k", x: 360, y: 160 }),
      mk({ id: "r-2", type: "R", name: "R2", value: "2k", x: 500, y: 160 }),
      mk({ id: "gnd-1", type: "GND", name: "GND1", value: "0", x: 200, y: 320 })
    ],
    wires: [
      { id: "w1", start: { componentId: "v-1", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } },
      { id: "w2", start: { componentId: "v-1", pin: "p" }, end: { componentId: "r-1", pin: "p" } },
      { id: "w3", start: { componentId: "r-1", pin: "n" }, end: { componentId: "r-2", pin: "p" } },
      { id: "w4", start: { componentId: "r-2", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } }
    ]
  },
  {
    id: "rc-step-tran",
    title: "RC Step (.tran)",
    description: "A first-order RC response to a DC step source.",
    analysis: cloneAnalysis({ mode: "tran", tStop: "20m", tStep: "0.2m" }),
    components: [
      mk({ id: "v-1", type: "V", name: "V1", value: "5", subtype: "DC", x: 200, y: 200 }),
      mk({ id: "r-1", type: "R", name: "R1", value: "1k", x: 360, y: 160 }),
      mk({ id: "c-1", type: "C", name: "C1", value: "10u", x: 500, y: 200 }),
      mk({ id: "gnd-1", type: "GND", name: "GND1", value: "0", x: 200, y: 320 })
    ],
    wires: [
      { id: "w1", start: { componentId: "v-1", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } },
      { id: "w2", start: { componentId: "v-1", pin: "p" }, end: { componentId: "r-1", pin: "p" } },
      { id: "w3", start: { componentId: "r-1", pin: "n" }, end: { componentId: "c-1", pin: "p" } },
      { id: "w4", start: { componentId: "c-1", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } }
    ]
  },
  {
    id: "diode-clipper-tran",
    title: "Diode Clipper (.tran)",
    description: "A sine source through resistor into a diode clamp.",
    analysis: cloneAnalysis({ mode: "tran", tStop: "5m", tStep: "20u" }),
    components: [
      mk({ id: "v-1", type: "V", name: "V1", value: "5", subtype: "SIN", value2: "1000", x: 200, y: 200 }),
      mk({ id: "r-1", type: "R", name: "R1", value: "1k", x: 360, y: 160 }),
      mk({ id: "d-1", type: "D", name: "D1", value: "1e-15", x: 500, y: 200 }),
      mk({ id: "gnd-1", type: "GND", name: "GND1", value: "0", x: 200, y: 320 })
    ],
    wires: [
      { id: "w1", start: { componentId: "v-1", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } },
      { id: "w2", start: { componentId: "v-1", pin: "p" }, end: { componentId: "r-1", pin: "p" } },
      { id: "w3", start: { componentId: "r-1", pin: "n" }, end: { componentId: "d-1", pin: "p" } },
      { id: "w4", start: { componentId: "d-1", pin: "n" }, end: { componentId: "gnd-1", pin: "g" } }
    ]
  }
];
