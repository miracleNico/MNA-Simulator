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
  krylov: false,
  krylovRankMode: "auto",
  krylovRank: 80,
  krylovMethod: "auto"
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

const largeSramCircuit: SchematicPreset = (() => {
  const rows = 10;
  const cols = 10;
  const selectedRow = 3;
  const selectedCol = 4;
  const components: CanvasComponent[] = [];
  const wires: CanvasWire[] = [];
  let nodeIndex = 0;
  let wireIndex = 0;
  const vHigh = "1.2";
  const mosCap = { cgs: "2f", cgd: "1f" };
  const wlSelectedExpr = `Piecewise((0, t < 1e-9), (${vHigh}, t < 2.5e-9), (0, t < 4.5e-9), (${vHigh}, t < 6e-9), (0, True))`;
  const writeExpr = `Piecewise((0, t < 1e-9), (${vHigh}, t < 2.5e-9), (0, True))`;
  const writeBarExpr = `Piecewise((${vHigh}, t < 1e-9), (0, t < 2.5e-9), (${vHigh}, True))`;
  const prechargeExpr = `Piecewise((0, t < 1e-9), (${vHigh}, t < 3.5e-9), (0, t < 4.5e-9), (${vHigh}, True))`;

  const addComponent = (
    partial: Omit<CanvasComponent, "rotation"> & Partial<Pick<CanvasComponent, "rotation">>
  ) => {
    const component = mk(partial);
    components.push(component);
    return component.id;
  };
  const addNode = (name: string, x: number, y: number) =>
    addComponent({
      id: `node-${name.replace(/[^a-z0-9_]/gi, "_")}-${nodeIndex++}`,
      type: "NODE",
      name,
      value: "node",
      x,
      y
    });
  const connect = (componentId: string, pin: string, nodeId: string) => {
    wires.push(pinWire(`sram-w-${wireIndex++}`, componentId, pin, nodeId, "n"));
  };
  const addSource = (id: string, name: string, node: string, subtype: string, value: string, expr: string | undefined, x: number, y: number) => {
    const src = addComponent({ id, type: "V", name, value, subtype, value2: expr, x, y });
    const p = addNode(node, x, y - 36);
    const n = addNode("gnd", x, y + 36);
    connect(src, "p", p);
    connect(src, "n", n);
    return p;
  };
  const addLevel1Mos = (
    id: string,
    type: "NMOS" | "PMOS",
    name: string,
    beta: string,
    x: number,
    y: number,
    rotation: 0 | 90 | 180 | 270 = 0,
    caps: Record<string, string> = mosCap
  ) =>
    addComponent({
      id,
      type,
      name,
      value: beta,
      value2: "0.4",
      value3: "0.02",
      metadata: { model: "level1", ...caps },
      x,
      y,
      rotation
    });
  const addTwoTerminal = (
    id: string,
    type: "R" | "C",
    name: string,
    value: string,
    pNode: string,
    nNode: string,
    x: number,
    y: number,
    rotation: 0 | 90 | 180 | 270 = 0
  ) => {
    const c = addComponent({ id, type, name, value, x, y, rotation });
    connect(c, "p", pNode);
    connect(c, "n", nNode);
    return c;
  };

  const vddSource = addComponent({
    id: "sram-vdd-src",
    type: "V",
    name: "VDD",
    value: vHigh,
    subtype: "DC",
    x: 100,
    y: 150
  });
  const vddNode = addNode("vdd", 100, 114);
  const globalGndNode = addNode("gnd", 100, 186);
  const globalGnd = addComponent({ id: "sram-gnd", type: "GND", name: "GND0", value: "0", x: 100, y: 246 });
  connect(vddSource, "p", vddNode);
  connect(vddSource, "n", globalGndNode);
  wires.push(pinWire(`sram-w-${wireIndex++}`, globalGndNode, "n", globalGnd, "g"));

  const originX = 260;
  const originY = 250;
  const cellW = 170;
  const cellH = 125;

  addSource("sram-vpch", "VPCH", "pch", "FUNC", "0", prechargeExpr, 100, 330);
  addSource("sram-vwr", "VWR", "wr", "FUNC", "0", writeExpr, 100, 430);
  addSource("sram-vwrb", "VWRB", "wr_b", "FUNC", "0", writeBarExpr, 100, 530);

  for (let col = 0; col < cols; col++) {
    const qX = originX + col * cellW;
    const qbX = qX + 80;
    const bl = addNode(`bl_${col}`, qX - 72, 118);
    const blb = addNode(`blb_${col}`, qbX + 72, 118);
    const vddBl = addNode("vdd", qX - 72, 46);
    const vddBlb = addNode("vdd", qbX + 72, 46);
    const pch = addNode("pch", qX, 58);
    const pchb = addNode("pch", qbX, 58);
    const gndBl = addNode("gnd", qX - 32, 154);
    const gndBlb = addNode("gnd", qbX + 32, 154);
    const preBl = addLevel1Mos(`sram-mpch-bl-${col}`, "PMOS", `MPCHBL${col}`, "3m", qX - 72, 82);
    const preBlb = addLevel1Mos(`sram-mpch-blb-${col}`, "PMOS", `MPCHBLB${col}`, "3m", qbX + 72, 82);
    connect(preBl, "s", vddBl);
    connect(preBl, "d", bl);
    connect(preBl, "g", pch);
    connect(preBlb, "s", vddBlb);
    connect(preBlb, "d", blb);
    connect(preBlb, "g", pchb);
    addTwoTerminal(`sram-cbl-${col}`, "C", `CBL${col}`, "20f", bl, gndBl, qX - 32, 136, 90);
    addTwoTerminal(`sram-cblb-${col}`, "C", `CBLB${col}`, "20f", blb, gndBlb, qbX + 32, 136, 90);
  }

  for (let row = 0; row < rows; row++) {
    const y = originY + row * cellH;
    if (row === selectedRow) {
      addSource(`sram-vwl-${row}`, `VWL${row}`, `wl_${row}`, "FUNC", "0", wlSelectedExpr, 100, y);
    } else {
      addSource(`sram-vwl-${row}`, `VWL${row}`, `wl_${row}`, "DC", "0", undefined, 100, y);
    }
  }

  const selectedBl = addNode(`bl_${selectedCol}`, originX + selectedCol * cellW - 72, 176);
  const selectedBlb = addNode(`blb_${selectedCol}`, originX + selectedCol * cellW + 152, 176);
  const writeHighVdd = addNode("vdd", originX + selectedCol * cellW - 112, 176);
  const writeLowGnd = addNode("gnd", originX + selectedCol * cellW + 192, 176);
  const wr = addNode("wr", originX + selectedCol * cellW + 152, 226);
  const wrb = addNode("wr_b", originX + selectedCol * cellW - 72, 226);
  const writeHigh = addLevel1Mos("sram-mwrite-bl", "PMOS", "MWRBL", "8m", originX + selectedCol * cellW - 72, 210);
  const writeLow = addLevel1Mos("sram-mwrite-blb", "NMOS", "MWRBLB", "8m", originX + selectedCol * cellW + 152, 210);
  connect(writeHigh, "s", writeHighVdd);
  connect(writeHigh, "d", selectedBl);
  connect(writeHigh, "g", wrb);
  connect(writeLow, "d", selectedBlb);
  connect(writeLow, "s", writeLowGnd);
  connect(writeLow, "g", wr);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = originX + col * cellW;
      const y = originY + row * cellH;
      const qX = x;
      const qbX = x + 80;
      const cell = `${row}_${col}`;

      const q = addNode(`q_${cell}`, qX, y);
      const qb = addNode(`qb_${cell}`, qbX, y);
      const vddLeft = addNode("vdd", qX, y - 72);
      const vddRight = addNode("vdd", qbX, y - 72);
      const gndLeft = addNode("gnd", qX, y + 72);
      const gndRight = addNode("gnd", qbX, y + 72);
      const bl = addNode(`bl_${col}`, qX - 72, y);
      const blb = addNode(`blb_${col}`, qbX + 72, y);
      const wlLeft = addNode(`wl_${row}`, qX - 36, y - 36);
      const wlRight = addNode(`wl_${row}`, qbX + 36, y + 36);

      const pLeft = addLevel1Mos(`sram-mp-q-${cell}`, "PMOS", `MPQ${row}_${col}`, "0.7m", qX, y - 36);
      const pRight = addLevel1Mos(`sram-mp-qb-${cell}`, "PMOS", `MPQB${row}_${col}`, "0.7m", qbX, y - 36);
      const nLeft = addLevel1Mos(`sram-mn-q-${cell}`, "NMOS", `MNQ${row}_${col}`, "1.8m", qX, y + 36);
      const nRight = addLevel1Mos(`sram-mn-qb-${cell}`, "NMOS", `MNQB${row}_${col}`, "1.8m", qbX, y + 36);
      const accessLeft = addLevel1Mos(`sram-max-q-${cell}`, "NMOS", `MAXQ${row}_${col}`, "2.5m", qX - 36, y, 90);
      const accessRight = addLevel1Mos(`sram-max-qb-${cell}`, "NMOS", `MAXQB${row}_${col}`, "2.5m", qbX + 36, y, 270);

      connect(pLeft, "s", vddLeft);
      connect(pLeft, "d", q);
      connect(pLeft, "g", qb);
      connect(nLeft, "d", q);
      connect(nLeft, "s", gndLeft);
      connect(nLeft, "g", qb);

      connect(pRight, "s", vddRight);
      connect(pRight, "d", qb);
      connect(pRight, "g", q);
      connect(nRight, "d", qb);
      connect(nRight, "s", gndRight);
      connect(nRight, "g", q);

      connect(accessLeft, "d", q);
      connect(accessLeft, "s", bl);
      connect(accessLeft, "g", wlLeft);
      connect(accessRight, "d", qb);
      connect(accessRight, "s", blb);
      connect(accessRight, "g", wlRight);

      const gndCapQ = addNode("gnd", qX - 16, y + 16);
      const gndCapQb = addNode("gnd", qbX + 16, y + 16);
      addTwoTerminal(`sram-cq-${cell}`, "C", `CQ${row}_${col}`, "4f", q, gndCapQ, qX - 16, y + 18, 90);
      addTwoTerminal(`sram-cqb-${cell}`, "C", `CQB${row}_${col}`, "4f", qb, gndCapQb, qbX + 16, y + 18, 90);

      const qStartsHigh = row === selectedRow && col === selectedCol ? false : (row + col) % 2 === 0;
      const qBiasNode = addNode(qStartsHigh ? "vdd" : "gnd", qX - 18, y - 18);
      const qbBiasNode = addNode(qStartsHigh ? "gnd" : "vdd", qbX + 18, y - 18);
      addTwoTerminal(`sram-rinit-q-${cell}`, "R", `RINITQ${row}_${col}`, "200Meg", q, qBiasNode, qX - 18, y - 18, 90);
      addTwoTerminal(`sram-rinit-qb-${cell}`, "R", `RINITQB${row}_${col}`, "200Meg", qb, qbBiasNode, qbX + 18, y - 18, 90);
    }
  }

  return {
    id: "large-sram-circuit",
    title: "Large SRAM Circuit",
    description: "Editable 10x10 6T Level-1 MOS SRAM transient demo that writes, holds, precharges, and reads row 3 column 4.",
    analysis: cloneAnalysis({
      mode: "tran",
      tStop: "6n",
      tStep: "0.25n",
      probeNodes: ["V(q_3_4)", "V(qb_3_4)", "V(bl_4)", "V(blb_4)", "V(wl_3)"],
      krylov: false,
      krylovRankMode: "auto"
    }),
    components,
    wires
  };
})();

const largeRlcMesh: SchematicPreset = (() => {
  const size = 23;
  const components: CanvasComponent[] = [];
  const wires: CanvasWire[] = [];
  let nodeIndex = 0;
  let wireIndex = 0;

  const addComponent = (
    partial: Omit<CanvasComponent, "rotation"> & Partial<Pick<CanvasComponent, "rotation">>
  ) => {
    const component = mk(partial);
    components.push(component);
    return component.id;
  };
  const addNode = (name: string, x: number, y: number) =>
    addComponent({
      id: `rlc-node-${name.replace(/[^a-z0-9_]/gi, "_")}-${nodeIndex++}`,
      type: "NODE",
      name,
      value: "node",
      x,
      y
    });
  const connect = (componentId: string, pin: string, nodeId: string) => {
    wires.push(pinWire(`rlc-w-${wireIndex++}`, componentId, pin, nodeId, "n"));
  };
  const addTwoTerminal = (
    id: string,
    type: "R" | "C" | "L",
    name: string,
    value: string,
    pNode: string,
    nNode: string,
    x: number,
    y: number,
    rotation: 0 | 90 | 180 | 270 = 0
  ) => {
    const componentId = addComponent({ id, type, name, value, x, y, rotation });
    connect(componentId, "p", pNode);
    connect(componentId, "n", nNode);
    return componentId;
  };

  const originX = 260;
  const originY = 170;
  const dx = 70;
  const dy = 54;
  const nodeIds: string[][] = [];

  const gndNode = addNode("gnd", 110, 210);
  const gnd = addComponent({ id: "rlc-gnd", type: "GND", name: "GND0", value: "0", x: 110, y: 250 });
  wires.push(pinWire(`rlc-w-${wireIndex++}`, gndNode, "n", gnd, "g"));

  for (let row = 0; row < size; row++) {
    nodeIds[row] = [];
    for (let col = 0; col < size; col++) {
      nodeIds[row][col] = addNode(`n_${row}_${col}`, originX + col * dx, originY + row * dy);
    }
  }

  const src = addComponent({
    id: "rlc-iin",
    type: "I",
    name: "IIN",
    value: "1m",
    subtype: "STEP",
    value2: "20n",
    x: 170,
    y: 170
  });
  connect(src, "p", nodeIds[0][0]);
  connect(src, "n", gndNode);

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const node = nodeIds[row][col];
      const x = originX + col * dx;
      const y = originY + row * dy;
      addTwoTerminal(`rlc-c-${row}-${col}`, "C", `C_${row}_${col}`, "200p", node, gndNode, x + 18, y + 18, 90);
      addTwoTerminal(`rlc-rg-${row}-${col}`, "R", `RG_${row}_${col}`, "50Meg", node, gndNode, x - 18, y + 18, 90);
      if (col + 1 < size) {
        addTwoTerminal(
          `rlc-rh-${row}-${col}`,
          "R",
          `R_H_${row}_${col}`,
          "25",
          node,
          nodeIds[row][col + 1],
          x + dx / 2,
          y,
          0
        );
      }
      if (row + 1 < size) {
        addTwoTerminal(
          `rlc-lv-${row}-${col}`,
          "L",
          `L_V_${row}_${col}`,
          "20n",
          node,
          nodeIds[row + 1][col],
          x,
          y + dy / 2,
          90
        );
      }
    }
  }

  addTwoTerminal(
    "rlc-rload",
    "R",
    "RLOAD",
    "50",
    nodeIds[size - 1][size - 1],
    gndNode,
    originX + (size - 1) * dx + 54,
    originY + (size - 1) * dy,
    90
  );

  return {
    id: "large-rlc-mesh",
    title: "Large RLC Mesh",
    description:
      "Editable 23x23 distributed RLC mesh with 1035 MNA unknowns and a sparse Backward Euler operator for Krylov/MINRES benchmarking.",
    analysis: cloneAnalysis({
      mode: "tran",
      tStop: "200n",
      tStep: "10n",
      probeNodes: ["V(n_0_0)", "V(n_11_11)", "V(n_22_22)", "I(L_V_10_11)"],
      krylov: true,
      krylovRankMode: "auto",
      krylovRank: 518
    }),
    components,
    wires
  };
})();

export const HIDDEN_DEMO_PRESETS: SchematicPreset[] = [ceAmplifier, threeStageOpamp, largeSramCircuit, largeRlcMesh];

export const DEMO_MENU_GROUPS: { title: string; presets: SchematicPreset[] }[] = [
  { title: "Amplifier Demos", presets: [ceAmplifier, threeStageOpamp] },
  { title: "Large Scale Circuits", presets: [largeSramCircuit, largeRlcMesh] }
];
