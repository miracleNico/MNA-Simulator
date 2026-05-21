import {
  AnalysisState,
  CanvasComponent,
  CanvasWire,
  SchematicLevel,
  SchematicPreset,
  pinEndpoint,
  pointEndpoint,
  snap
} from "./schematic";

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

function cloneAnalysis(overrides: Partial<AnalysisState>): AnalysisState {
  return { ...defaultAnalysis, ...overrides };
}

function mk(
  partial: Omit<CanvasComponent, "rotation"> & Partial<Pick<CanvasComponent, "rotation">>
): CanvasComponent {
  return { rotation: 0, ...partial, x: snap(partial.x), y: snap(partial.y) };
}

function pinWire(
  id: string,
  startCid: string,
  startPin: string,
  endCid: string,
  endPin: string
): CanvasWire {
  return {
    id,
    start: pinEndpoint(startCid, startPin),
    end: pinEndpoint(endCid, endPin)
  };
}

/** Visible-in-the-Preset-dropdown demo schematics. Cleared per user request. */
export const SCHEMATIC_PRESETS: SchematicPreset[] = [];

/* ----------------------------------------------------------------------- */
/* Hidden demos accessible only via the Demo top-menu dropdown.            */
/* ----------------------------------------------------------------------- */

/** CE amp: AC-coupled output so the waveform plots around 0 V, not 12 V. */
const ceAmplifier: SchematicPreset = (() => {
  const components: CanvasComponent[] = [
    mk({ id: "v-in", type: "V", name: "Vin", value: "0.05", subtype: "SIN", value2: "1k", x: 160, y: 296 }),
    mk({ id: "c-in", type: "C", name: "Cin", value: "10u", x: 300, y: 260 }),
    mk({ id: "q-1", type: "QNPN", name: "Q1", value: "40m", value2: "2.5k", x: 460, y: 260 }),
    mk({ id: "r-c", type: "R", name: "Rc", value: "4.7k", x: 460, y: 140, rotation: 90 }),
    mk({ id: "r-e", type: "R", name: "Re", value: "470", x: 460, y: 360, rotation: 90 }),
    mk({ id: "c-out", type: "C", name: "Cout", value: "10u", x: 580, y: 224 }),
    mk({ id: "r-load", type: "R", name: "Rload", value: "10k", x: 700, y: 260, rotation: 90 }),
    mk({ id: "gnd-1", type: "GND", name: "GND1", value: "0", x: 160, y: 356 }),
    mk({ id: "gnd-2", type: "GND", name: "GND2", value: "0", x: 460, y: 420 }),
    mk({ id: "gnd-3", type: "GND", name: "GND3", value: "0", x: 700, y: 320 }),
    mk({ id: "gnd-4", type: "GND", name: "GND4", value: "0", x: 460, y: 80 })
  ];
  const wires: CanvasWire[] = [
    pinWire("ce-w1", "v-in", "n", "gnd-1", "g"),
    pinWire("ce-w2", "v-in", "p", "c-in", "p"),
    pinWire("ce-w3", "c-in", "n", "q-1", "b"),
    pinWire("ce-w4", "q-1", "c", "r-c", "n"),
    pinWire("ce-w5", "r-c", "p", "gnd-4", "g"),
    pinWire("ce-w7", "q-1", "e", "r-e", "p"),
    pinWire("ce-w8", "r-e", "n", "gnd-2", "g"),
    pinWire("ce-w9", "q-1", "c", "c-out", "p"),
    pinWire("ce-w10", "c-out", "n", "r-load", "p"),
    pinWire("ce-w11", "r-load", "n", "gnd-3", "g")
  ];
  return {
    id: "ce-amplifier",
    title: "CE Amplifier",
    description:
      "Common-emitter NPN small-signal amplifier with AC-grounded collector load and AC-coupled output.",
    analysis: cloneAnalysis({ mode: "tran", tStop: "5m", tStep: "5u", probeNodes: [] }),
    components,
    wires
  };
})();

/* ----------------------------------------------------------------------- */
/* 3-stage op-amp using the SUBCKT mechanism.                              */
/*                                                                          */
/* Top level shows three SUBCKT rectangles (DiffAmp, MidStage, OutStage)   */
/* wired in cascade. Each sub-level holds editable NODE markers whose      */
/* names become ``port_<pin>`` junctions for the backend flattener.        */
/* ----------------------------------------------------------------------- */

const threeStageOpamp: SchematicPreset = (() => {
  /*
   * BJT-only three-stage small-signal demo:
   *
   * 1. Differential input pair: two QNPNs share a tail resistor, each collector
   *    has an AC-grounded load, and the right collector is the single-ended out.
   * 2. Common-emitter voltage gain block: QNPN collector output with Rc to AC
   *    ground and emitter at small-signal ground.
   * 3. Follower output buffer: QNPN emitter follower, the BJT equivalent of the
   *    requested source-follower behavior.
   *
   * The backend keeps these as QNPN components through subcircuit flattening,
   * then stamps each BJT as a hybrid-pi small-signal model during MNA assembly.
   * Local GND components collapse to global small-signal ground.
   */
  function buildDifferentialStage(): SchematicLevel {
    const prefix = "diff";
    return {
      id: "lvl-diff",
      title: "Differential amp",
      parentId: "root",
      pins: ["in_p", "out", "in_n"],
      components: [
        mk({ id: `${prefix}-port-inp`, type: "NODE", name: "in_p", value: "node", x: 80, y: 240 }),
        mk({ id: `${prefix}-port-inn`, type: "NODE", name: "in_n", value: "node", x: 80, y: 320 }),
        mk({ id: `${prefix}-port-out`, type: "NODE", name: "out", value: "node", x: 620, y: 180 }),
        mk({ id: `${prefix}-q1`, type: "QNPN", name: "Q1", value: "2m", value2: "20k", x: 280, y: 240 }),
        mk({ id: `${prefix}-q2`, type: "QNPN", name: "Q2", value: "2m", value2: "20k", x: 440, y: 240 }),
        mk({ id: `${prefix}-rc1`, type: "R", name: "Rc1", value: "6.2k", x: 280, y: 100, rotation: 90 }),
        mk({ id: `${prefix}-rc2`, type: "R", name: "Rc2", value: "6.2k", x: 440, y: 100, rotation: 90 }),
        mk({ id: `${prefix}-tail`, type: "R", name: "Rtail", value: "3.3k", x: 360, y: 312, rotation: 90 }),
        mk({ id: `${prefix}-gnd-c1`, type: "GND", name: "GNDc1", value: "0", x: 280, y: 20 }),
        mk({ id: `${prefix}-gnd-c2`, type: "GND", name: "GNDc2", value: "0", x: 440, y: 20 }),
        mk({ id: `${prefix}-gnd-tail`, type: "GND", name: "GNDt", value: "0", x: 360, y: 372 })
      ],
      wires: [
        pinWire(`${prefix}-w-inp`, `${prefix}-q1`, "b", `${prefix}-port-inp`, "n"),
        pinWire(`${prefix}-w-inn`, `${prefix}-q2`, "b", `${prefix}-port-inn`, "n"),
        pinWire(`${prefix}-w-c1`, `${prefix}-q1`, "c", `${prefix}-rc1`, "n"),
        pinWire(`${prefix}-w-c2`, `${prefix}-q2`, "c", `${prefix}-rc2`, "n"),
        pinWire(`${prefix}-w-rc1-g`, `${prefix}-rc1`, "p", `${prefix}-gnd-c1`, "g"),
        pinWire(`${prefix}-w-rc2-g`, `${prefix}-rc2`, "p", `${prefix}-gnd-c2`, "g"),
        { id: `${prefix}-w-e1`, start: pinEndpoint(`${prefix}-q1`, "e"), end: pointEndpoint(360, 276) },
        { id: `${prefix}-w-e2`, start: pinEndpoint(`${prefix}-q2`, "e"), end: pointEndpoint(360, 276) },
        { id: `${prefix}-w-tail`, start: pinEndpoint(`${prefix}-tail`, "p"), end: pointEndpoint(360, 276) },
        pinWire(`${prefix}-w-tail-g`, `${prefix}-tail`, "n", `${prefix}-gnd-tail`, "g"),
        pinWire(`${prefix}-w-out`, `${prefix}-q2`, "c", `${prefix}-port-out`, "n")
      ]
    };
  }

  function buildCommonEmitterStage(): SchematicLevel {
    const prefix = "mid";
    return {
      id: "lvl-mid",
      title: "CE gain stage",
      parentId: "root",
      pins: ["in", "out"],
      components: [
        mk({ id: `${prefix}-port-in`, type: "NODE", name: "in", value: "node", x: 80, y: 240 }),
        mk({ id: `${prefix}-port-out`, type: "NODE", name: "out", value: "node", x: 560, y: 180 }),
        mk({ id: `${prefix}-q1`, type: "QNPN", name: "Q1", value: "3m", value2: "12k", x: 300, y: 240 }),
        mk({ id: `${prefix}-rc`, type: "R", name: "Rc", value: "5.6k", x: 300, y: 100, rotation: 90 }),
        mk({ id: `${prefix}-gnd-c`, type: "GND", name: "GNDc", value: "0", x: 300, y: 20 }),
        mk({ id: `${prefix}-gnd-e`, type: "GND", name: "GNDe", value: "0", x: 300, y: 360 })
      ],
      wires: [
        pinWire(`${prefix}-w-in`, `${prefix}-q1`, "b", `${prefix}-port-in`, "n"),
        pinWire(`${prefix}-w-c`, `${prefix}-q1`, "c", `${prefix}-rc`, "n"),
        pinWire(`${prefix}-w-rc-g`, `${prefix}-rc`, "p", `${prefix}-gnd-c`, "g"),
        pinWire(`${prefix}-w-e-g`, `${prefix}-q1`, "e", `${prefix}-gnd-e`, "g"),
        pinWire(`${prefix}-w-out`, `${prefix}-q1`, "c", `${prefix}-port-out`, "n")
      ]
    };
  }

  function buildFollowerStage(): SchematicLevel {
    const prefix = "out";
    return {
      id: "lvl-out",
      title: "Emitter follower",
      parentId: "root",
      pins: ["in", "out"],
      components: [
        mk({ id: `${prefix}-port-in`, type: "NODE", name: "in", value: "node", x: 80, y: 220 }),
        mk({ id: `${prefix}-port-out`, type: "NODE", name: "out", value: "node", x: 560, y: 300 }),
        mk({ id: `${prefix}-q1`, type: "QNPN", name: "Q1", value: "8m", value2: "6k", x: 300, y: 220 }),
        mk({ id: `${prefix}-re`, type: "R", name: "Re", value: "1k", x: 300, y: 400, rotation: 90 }),
        mk({ id: `${prefix}-gnd-c`, type: "GND", name: "GNDc", value: "0", x: 300, y: 100 }),
        mk({ id: `${prefix}-gnd-e`, type: "GND", name: "GNDe", value: "0", x: 300, y: 500 })
      ],
      wires: [
        pinWire(`${prefix}-w-in`, `${prefix}-q1`, "b", `${prefix}-port-in`, "n"),
        pinWire(`${prefix}-w-c-g`, `${prefix}-q1`, "c", `${prefix}-gnd-c`, "g"),
        pinWire(`${prefix}-w-e`, `${prefix}-q1`, "e", `${prefix}-re`, "p"),
        pinWire(`${prefix}-w-re-g`, `${prefix}-re`, "n", `${prefix}-gnd-e`, "g"),
        pinWire(`${prefix}-w-out`, `${prefix}-q1`, "e", `${prefix}-port-out`, "n")
      ]
    };
  }

  const lvlDiff = buildDifferentialStage();
  const lvlMid = buildCommonEmitterStage();
  const lvlOut = buildFollowerStage();

  /* ------------------- Top level: SUBCKT cascade ----------------------- */
  // SUBCKT pin ordering follows getPinCoordinates. The differential block uses
  // three pins so in_p sits left, out sits right, and in_n sits on top where the
  // top level ties it to the local small-signal reference.
  const topComponents: CanvasComponent[] = [
    mk({ id: "v-in", type: "V", name: "Vin", value: "0.001", subtype: "SIN", value2: "1k", x: 120, y: 276 }),
    mk({
      id: "sub-diff",
      type: "SUBCKT",
      name: "DiffAmp",
      value: "",
      subcircuitId: "lvl-diff",
      pins: ["in_p", "out", "in_n"],
      x: 360,
      y: 240
    }),
    mk({
      id: "sub-mid",
      type: "SUBCKT",
      name: "MidStage",
      value: "",
      subcircuitId: "lvl-mid",
      pins: ["in", "out"],
      x: 620,
      y: 240
    }),
    mk({
      id: "sub-out",
      type: "SUBCKT",
      name: "OutStage",
      value: "",
      subcircuitId: "lvl-out",
      pins: ["in", "out"],
      x: 880,
      y: 240
    }),
    mk({ id: "r-load", type: "R", name: "Rload", value: "10k", x: 1080, y: 276, rotation: 90 }),
    mk({ id: "gnd-in", type: "GND", name: "GNDi", value: "0", x: 120, y: 360 }),
    mk({ id: "gnd-ref", type: "GND", name: "GNDref", value: "0", x: 360, y: 100 }),
    mk({ id: "gnd-load", type: "GND", name: "GNDl", value: "0", x: 1080, y: 336 })
  ];

  // The cascade carries the single-ended output forward. Inter-stage links run
  // through explicit points so the SUBCKT flattener can stitch both block pins
  // onto the same top-level net.
  const topWires: CanvasWire[] = [
    pinWire("op-w1", "v-in", "n", "gnd-in", "g"),
    pinWire("op-w2", "v-in", "p", "sub-diff", "in_p"),
    pinWire("op-w3", "sub-diff", "in_n", "gnd-ref", "g"),
    { id: "op-w4a", start: pinEndpoint("sub-diff", "out"), end: pointEndpoint(500, 240) },
    { id: "op-w4b", start: pointEndpoint(500, 240), end: pinEndpoint("sub-mid", "in") },
    { id: "op-w5a", start: pinEndpoint("sub-mid", "out"), end: pointEndpoint(760, 240) },
    { id: "op-w5b", start: pointEndpoint(760, 240), end: pinEndpoint("sub-out", "in") },
    pinWire("op-w6", "sub-out", "out", "r-load", "p"),
    pinWire("op-w7", "r-load", "n", "gnd-load", "g")
  ];

  return {
    id: "three-stage-opamp",
    title: "3-Stage Op-Amp (SUBCKT)",
    description:
      "Top level shows three BJT SUBCKT blocks: a differential pair, common-emitter gain stage, and emitter-follower buffer tuned to about 50 V/V.",
    analysis: cloneAnalysis({ mode: "tran", tStop: "5m", tStep: "5u", probeNodes: [] }),
    components: topComponents,
    wires: topWires,
    extraLevels: [lvlDiff, lvlMid, lvlOut]
  };
})();

export const HIDDEN_DEMO_PRESETS: SchematicPreset[] = [ceAmplifier, threeStageOpamp];
