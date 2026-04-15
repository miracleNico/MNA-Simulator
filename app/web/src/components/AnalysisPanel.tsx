type AnalysisPanelProps = {
  netlistText: string;
  onNetlistChange: (value: string) => void;
  onRun: () => void;
  lastStatus: string;
};

export function AnalysisPanel(props: AnalysisPanelProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Netlist Workbench</h2>
        <p>Use the shared backend parser for file import, hand edits, or future schematic-to-netlist export.</p>
      </div>
      <textarea
        className="netlistEditor"
        value={props.netlistText}
        onChange={(event) => props.onNetlistChange(event.target.value)}
      />
      <div className="actions">
        <button className="primaryButton" onClick={props.onRun}>
          Run Basic Simulation
        </button>
        <span className="statusBadge">Status: {props.lastStatus}</span>
      </div>
    </section>
  );
}
