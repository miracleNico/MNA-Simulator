import { useMemo, useState } from "react";

import { AnalysisPanel } from "../components/AnalysisPanel";
import { SchematicCanvas } from "../components/SchematicCanvas";

const defaultNetlist = `V1 n1 0 DC 5
R1 n1 n2 1k
R2 n2 0 2k
.op
.end`;

const palette = [
  { id: "resistor", label: "Resistor", symbol: "R" },
  { id: "capacitor", label: "Capacitor", symbol: "C" },
  { id: "inductor", label: "Inductor", symbol: "L" },
  { id: "voltageSource", label: "Voltage Source", symbol: "V" },
  { id: "diode", label: "Diode", symbol: "D" }
];

type SymbolInstance = {
  id: string;
  x: number;
  y: number;
  label: string;
  symbol: string;
};

export function App() {
  const [netlistText, setNetlistText] = useState(defaultNetlist);
  const [lastStatus, setLastStatus] = useState("idle");
  const [symbols, setSymbols] = useState<SymbolInstance[]>([]);
  const [responsePreview, setResponsePreview] = useState<string>("No simulation run yet.");

  const nextPosition = useMemo(() => {
    return {
      x: 40 + (symbols.length % 4) * 120,
      y: 40 + Math.floor(symbols.length / 4) * 120
    };
  }, [symbols.length]);

  async function runSimulation() {
    setLastStatus("running");
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          netlist_text: netlistText,
          mode: "show_matrix",
          options: {}
        })
      });
      const payload = await response.json();
      setLastStatus(response.ok ? "ok" : "error");
      setResponsePreview(JSON.stringify(payload, null, 2));
    } catch (error) {
      setLastStatus("error");
      setResponsePreview(String(error));
    }
  }

  return (
    <main className="appShell">
      <header className="hero">
        <div>
          <h1>Circuit Simulator Rebuild</h1>
          <p>FastAPI + React/TypeScript workbench with a staged schematic editor.</p>
        </div>
      </header>

      <div className="contentGrid">
        <AnalysisPanel netlistText={netlistText} onNetlistChange={setNetlistText} onRun={runSimulation} lastStatus={lastStatus} />
        <SchematicCanvas
          palette={palette}
          symbols={symbols}
          onAddSymbol={(item) =>
            setSymbols((current) => [
              ...current,
              {
                id: `${item.id}-${current.length + 1}`,
                x: nextPosition.x,
                y: nextPosition.y,
                label: `${item.symbol}${current.length + 1}`,
                symbol: item.symbol
              }
            ])
          }
        />
      </div>

      <section className="panel">
        <div className="panelHeader">
          <h2>API Preview</h2>
          <p>Shows the service response used by future plots and result overlays.</p>
        </div>
        <pre className="responsePreview">{responsePreview}</pre>
      </section>
    </main>
  );
}
