export type UserGuideSection = {
  title: string;
  items: string[];
};

export const USER_GUIDE_SECTIONS: UserGuideSection[] = [
  {
    title: "Start From A Demo",
    items: [
      "Open Demo and choose an amplifier, frequency-domain circuit, SRAM array, or large RLC benchmark.",
      "Demos are editable schematics. You can move parts, retune values, rename nodes, inspect generated netlists, and rerun analyses.",
      "The amplifier demos default to transient analysis with V(vin) and V(out) selected so the first plot compares input and output directly."
    ]
  },
  {
    title: "Build And Edit Schematics",
    items: [
      "Use the toolbar to place passives, sources, BJTs, MOSFETs, controlled sources, labels, named nodes, and subcircuits.",
      "Click pins to wire them. Esc cancels placement or an unfinished wire. Del removes selected schematic entities.",
      "Ctrl+R rotates the selection, Ctrl+E mirrors it, Ctrl+Z rolls back the last edit, and Ctrl+C/Ctrl+V copies and pastes selected items.",
      "NODE markers with the same name are connected within the same schematic level. LABEL components annotate a net without adding a new physical part."
    ]
  },
  {
    title: "Use Hierarchy",
    items: [
      "Create child levels from the hierarchy panel, then place SUBCKT instances on the parent level.",
      "A child port is an editable NODE marker inside the child entity. The parent instance uses the child entity's pin list, so port names stay scoped to that entity.",
      "Renaming a child port updates only instances of that child entity and repairs matching connected wires."
    ]
  },
  {
    title: "Run Analyses",
    items: [
      ".op solves the DC operating point and shows MNA matrices, operating-point values, and device states as lists and tables.",
      ".tran runs nonlinear transient simulation with Backward Euler; physical BJTs/MOSFETs continue using their I-V equations at each timestep.",
      ".ac first solves .op, then linearizes nonlinear devices around that bias and sweeps frequency.",
      ".hb solves steady-state harmonic balance and can reconstruct a time-domain waveform when a time window is supplied."
    ]
  },
  {
    title: "Display Results",
    items: [
      "Use Display nodes to choose labels such as V(out), V(vin), or I(L1). Empty display selection means all available waveform labels are shown.",
      "Static runs open draggable result tiles. Dynamic display uses the toolbar play button and streams selected nodes into live tiles.",
      "Probe mode lets you click a pin to open a live dynamic tile for that net."
    ]
  },
  {
    title: "Krylov Subspace Solver",
    items: [
      "Enable the Krylov subspace solver for iterative linear solves on the full MNA system. Auto method selection chooses GMRES/Arnoldi for general systems, MINRES/CR for symmetric systems, and CG for positive-definite systems.",
      "Manual method selection can override the matrix classifier, including choosing Arnoldi for SPD matrices.",
      "Auto rank resolves after MNA assembly as ceil(0.5 * matrix dimension). Manual rank accepts any positive integer.",
      "For GMRES/Arnoldi the value is the restart or subspace size; for MINRES/CR/CG it is the iteration budget."
    ]
  },
  {
    title: "Model-Order Reduction",
    items: [
      "Enable MOR when only a few output labels matter in a larger analog circuit.",
      "MOR outputs are separate from Display nodes. The reduced model returns only MOR outputs; Display nodes must be empty or chosen from that MOR output set.",
      "Auto method uses output-aware Linear Krylov MOR for .ac and linear .tran, and TPWL/POD for nonlinear .tran.",
      "Auto order uses min(n, max(10, min(120, 4 * (inputs + outputs)))) after MNA assembly.",
      "Metadata reports mor_order/mor_resolved_order as the reduction budget and mor_basis_size as the actual independent basis size after pruning.",
      "TPWL/POD is nonlinear transient MOR; purely linear circuits route to Linear Krylov MOR and report that route in metadata.",
      ".op and .hb are not reduced in this v1; metadata explains that MOR was intentionally bypassed."
    ]
  },
  {
    title: "Raw Netlist Mode",
    items: [
      "The netlist panel shows the generated netlist for schematic mode.",
      "Editing the netlist asks for confirmation, clears the schematic hierarchy, and switches the next run to raw netlist_text.",
      "Use raw netlist mode for quick parser checks, FUNC source expressions, or circuits that are easier to type than draw."
    ]
  },
  {
    title: "Important Model Notes",
    items: [
      "Level-1 BJTs and MOSFETs are physical nonlinear defaults. .op finds their bias, .ac uses the small-signal linearization, and .tran remains nonlinear.",
      "The SRAM demo uses Level-1 MOS devices and FUNC-driven write, hold, precharge, and read timing.",
      "The close-tone HB demo is tuned for steady-state beat behavior at GHz carriers where direct transient can be expensive."
    ]
  }
];
