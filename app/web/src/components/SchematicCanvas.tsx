import type { CSSProperties } from "react";

type PaletteItem = {
  id: string;
  label: string;
  symbol: string;
};

type PlacedSymbol = {
  id: string;
  x: number;
  y: number;
  label: string;
  symbol: string;
};

type SchematicCanvasProps = {
  palette: PaletteItem[];
  symbols: PlacedSymbol[];
  onAddSymbol: (item: PaletteItem) => void;
};

export function SchematicCanvas(props: SchematicCanvasProps) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Schematic Editor Prototype</h2>
        <p>Stage 1 scaffold with symbol palette and placement list.</p>
      </div>
      <div className="schematicLayout">
        <aside className="palette">
          <h3>Palette</h3>
          {props.palette.map((item) => (
            <button key={item.id} className="paletteItem" onClick={() => props.onAddSymbol(item)}>
              <strong>{item.symbol}</strong>
              <span>{item.label}</span>
            </button>
          ))}
        </aside>
        <div className="canvas">
          <div className="gridBackground" />
          {props.symbols.map((symbol, index) => {
            const style: CSSProperties = {
              left: symbol.x,
              top: symbol.y
            };
            return (
              <div key={symbol.id} className="symbolNode" style={style}>
                <div className="symbolBody">{symbol.symbol}</div>
                <div className="symbolLabel">{symbol.label}</div>
                <div className="symbolMeta">#{index + 1}</div>
              </div>
            );
          })}
          {props.symbols.length === 0 ? (
            <div className="emptyState">
              Select a symbol from the palette to start a schematic. Wiring and net extraction are planned next.
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
