import { MouseEvent as ReactMouseEvent, useRef } from "react";

export type OpResultData = {
  labels: string[];
  values: number[];
  matrices?: Record<string, unknown>;
  deviceOperatingPoints?: Record<string, unknown>[];
  filterLabels?: string[];
};

type ResultTileProps = {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  opData: OpResultData;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onClose: (id: string) => void;
};

type CellValue = number | string | boolean | null | Record<string, unknown>;

const DENSE_ROW_LIMIT = 24;
const DENSE_COL_LIMIT = 12;
const NONZERO_LIMIT = 500;
const MATRIX_ORDER = ["G", "C", "b_dc", "f_str", "b_time_str", "b_ac"];

export function ResultTile(props: ResultTileProps) {
  const dragRef = useRef<{
    kind: "move" | "resize" | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>({ kind: null, startX: 0, startY: 0, origX: 0, origY: 0, origW: 0, origH: 0 });

  function onMouseDownHeader(e: ReactMouseEvent) {
    if ((e.target as HTMLElement).closest(".tile__close")) return;
    dragRef.current = {
      kind: "move",
      startX: e.clientX,
      startY: e.clientY,
      origX: props.x,
      origY: props.y,
      origW: props.w,
      origH: props.h
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function onMouseDownResize(e: ReactMouseEvent) {
    e.stopPropagation();
    dragRef.current = {
      kind: "resize",
      startX: e.clientX,
      startY: e.clientY,
      origX: props.x,
      origY: props.y,
      origW: props.w,
      origH: props.h
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    const d = dragRef.current;
    if (!d.kind) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.kind === "move") {
      props.onMove(props.id, d.origX + dx, d.origY + dy);
    } else {
      props.onResize(props.id, Math.max(360, d.origW + dx), Math.max(240, d.origH + dy));
    }
  }

  function onMouseUp() {
    dragRef.current.kind = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  const matrixEntries = orderedMatrixEntries(props.opData.matrices ?? {});

  return (
    <div
      className="tile"
      style={{ left: props.x, top: props.y, width: props.w, height: props.h }}
    >
      <div className="tile__header" onMouseDown={onMouseDownHeader}>
        <span className="tile__title">{props.title}</span>
        <button className="tile__close" onClick={() => props.onClose(props.id)} aria-label="Close tile">
          x
        </button>
      </div>
      <div className="tile__body resultTileBody">
        <section className="resultSection">
          <div className="resultSection__header">
            <span>Operating Point</span>
            <span>{props.opData.labels.length} unknowns</span>
          </div>
          <OperatingPointTable data={props.opData} />
        </section>

        {props.opData.deviceOperatingPoints?.length ? (
          <section className="resultSection">
            <div className="resultSection__header">
              <span>Device Operating Points</span>
              <span>{props.opData.deviceOperatingPoints.length} devices</span>
            </div>
            <DeviceOperatingPointTable rows={props.opData.deviceOperatingPoints} />
          </section>
        ) : null}

        <section className="resultSection">
          <div className="resultSection__header">
            <span>MNA Matrices</span>
            <span>{matrixEntries.length} objects</span>
          </div>
          {matrixEntries.length === 0 ? (
            <div className="resultEmpty">No matrix payload returned.</div>
          ) : (
            matrixEntries.map(([name, matrix]) => (
              <MatrixBlock key={name} name={name} value={matrix} labels={props.opData.labels} />
            ))
          )}
        </section>
      </div>
      <div className="tile__resize" onMouseDown={onMouseDownResize} />
    </div>
  );
}

function DeviceOperatingPointTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = deviceOpColumns(rows);
  return (
    <div className="resultTableWrap deviceOpTableWrap">
      <table className="resultTable">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${String(row.name ?? "device")}-${rowIndex}`}>
              {columns.map((column) => (
                <td key={column}>{formatCell(toCell(row[column]))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OperatingPointTable({ data }: { data: OpResultData }) {
  const wanted = data.filterLabels && data.filterLabels.length > 0 ? new Set(data.filterLabels) : null;
  const rows = data.labels
    .map((label, index) => ({ label, value: data.values[index] ?? 0 }))
    .filter((row) => !wanted || wanted.has(row.label));
  return (
    <div className="resultTableWrap opTableWrap">
      <table className="resultTable">
        <thead>
          <tr>
            <th>unknown</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th>{row.label}</th>
              <td>{formatCell(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function deviceOpColumns(rows: Record<string, unknown>[]): string[] {
  const preferred = [
    "name",
    "type",
    "model",
    "region",
    "vc",
    "vb",
    "ve",
    "vbe",
    "vce",
    "ic",
    "ib",
    "ie",
    "vd",
    "vg",
    "vs",
    "vgs",
    "vds",
    "ids",
    "gm",
    "gds",
    "rpi",
    "ro",
    "gmb",
    "beta",
    "vth",
    "lambda",
    "note"
  ];
  const present = new Set<string>();
  for (const row of rows) {
    Object.keys(row).forEach((key) => present.add(key));
  }
  const ordered = preferred.filter((key) => present.has(key));
  for (const key of Array.from(present).sort()) {
    if (!ordered.includes(key)) ordered.push(key);
  }
  return ordered;
}

function MatrixBlock({ name, value, labels }: { name: string; value: unknown; labels: string[] }) {
  const matrix = normalizeMatrix(value);
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;
  const isDenseReadable = rowCount <= DENSE_ROW_LIMIT && colCount <= DENSE_COL_LIMIT;
  const title = `${name} ${rowCount}x${colCount}`;

  return (
    <div className="matrixBlock">
      <div className="matrixBlock__title">{title}</div>
      {isDenseReadable ? (
        <DenseMatrixTable matrix={matrix} labels={labels} />
      ) : (
        <SparseEntryTable matrix={matrix} labels={labels} />
      )}
    </div>
  );
}

function DenseMatrixTable({ matrix, labels }: { matrix: CellValue[][]; labels: string[] }) {
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;
  const useLabels = rowCount === labels.length;
  const useColumnLabels = colCount === labels.length;
  return (
    <div className="resultTableWrap matrixTableWrap">
      <table className="resultTable matrixTable">
        <thead>
          <tr>
            <th />
            {Array.from({ length: colCount }, (_, col) => (
              <th key={col}>{useColumnLabels ? labels[col] : col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th>{useLabels ? labels[rowIndex] : rowIndex}</th>
              {row.map((cell, colIndex) => (
                <td key={colIndex}>{formatCell(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SparseEntryTable({ matrix, labels }: { matrix: CellValue[][]; labels: string[] }) {
  const rowCount = matrix.length;
  const colCount = matrix[0]?.length ?? 0;
  const useLabels = rowCount === labels.length;
  const useColumnLabels = colCount === labels.length;
  const entries: Array<{ row: number; col: number; value: CellValue }> = [];
  let nonzeroCount = 0;
  for (let row = 0; row < rowCount; row++) {
    for (let col = 0; col < colCount; col++) {
      const value = matrix[row]?.[col] ?? 0;
      if (!isDisplayZero(value)) {
        nonzeroCount += 1;
        if (entries.length < NONZERO_LIMIT) {
          entries.push({ row, col, value });
        }
      }
    }
  }
  return (
    <>
      <div className="resultNote">
        Large matrix shown as nonzero entries: {entries.length} of {nonzeroCount}
        {nonzeroCount > entries.length ? " listed" : ""}.
      </div>
      <div className="resultTableWrap matrixTableWrap">
        <table className="resultTable matrixTable">
          <thead>
            <tr>
              <th>row</th>
              <th>col</th>
              <th>value</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={`${entry.row}-${entry.col}`}>
                <th>{useLabels ? labels[entry.row] : entry.row}</th>
                <th>{useColumnLabels ? labels[entry.col] : entry.col}</th>
                <td>{formatCell(entry.value)}</td>
              </tr>
            ))}
            {entries.length === 0 ? (
              <tr>
                <td colSpan={3}>all entries are zero</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}

function orderedMatrixEntries(matrices: Record<string, unknown>): Array<[string, unknown]> {
  const seen = new Set<string>();
  const ordered: Array<[string, unknown]> = [];
  for (const name of MATRIX_ORDER) {
    if (name in matrices) {
      seen.add(name);
      ordered.push([name, matrices[name]]);
    }
  }
  for (const entry of Object.entries(matrices)) {
    if (!seen.has(entry[0])) ordered.push(entry);
  }
  return ordered;
}

function normalizeMatrix(value: unknown): CellValue[][] {
  if (!Array.isArray(value)) return [[toCell(value)]];
  if (value.length === 0) return [];
  if (Array.isArray(value[0])) {
    return (value as unknown[][]).map((row) => row.map(toCell));
  }
  return (value as unknown[]).map((entry) => [toCell(entry)]);
}

function toCell(value: unknown): CellValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "object") return value as Record<string, unknown>;
  return String(value);
}

function isDisplayZero(value: CellValue): boolean {
  if (value === null) return true;
  if (typeof value === "number") return Math.abs(value) < 1e-18;
  if (typeof value === "boolean") return !value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.abs(numeric) < 1e-18 : false;
  }
  return false;
}

function formatCell(value: CellValue): string {
  if (value === null) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  if ("real" in value || "imag" in value) {
    const real = Number(value.real ?? 0);
    const imag = Number(value.imag ?? 0);
    return `${formatNumber(real)} ${imag < 0 ? "-" : "+"} ${formatNumber(Math.abs(imag))}j`;
  }
  return JSON.stringify(value);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Math.abs(value) < 1e-18) return "0";
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) return value.toExponential(4);
  return Number(value.toPrecision(7)).toString();
}
