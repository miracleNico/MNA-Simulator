import { useEffect, useRef, useState } from "react";
import { drawPlot, PlotData } from "../lib/plot";

export type TileMode = "static" | "dyn";

export type PlotTileProps = {
  id: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  mode: TileMode;
  /** Static plot data for .tran/.hb. */
  data?: PlotData;
  /** Subscribe callback invoked when the component mounts; the handler receives a pushFrame fn. */
  onMount?: (push: (t: number, values: number[], labels: string[]) => void, finalize: () => void) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, w: number, h: number) => void;
  onClose: (id: string) => void;
};

const DYN_WINDOW_SECONDS = 2.0; // rolling window for live scope

export function PlotTile(props: PlotTileProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dynBuffersRef = useRef<{ t: number[]; values: number[][]; labels: string[] }>({
    t: [],
    values: [],
    labels: []
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    if (props.mode === "dyn" && props.onMount) {
      const push = (t: number, values: number[], labels: string[]) => {
        const buf = dynBuffersRef.current;
        if (buf.labels.length === 0) {
          buf.labels = labels;
          buf.values = labels.map(() => []);
        }
        buf.t.push(t);
        values.forEach((v, i) => {
          if (!buf.values[i]) buf.values[i] = [];
          buf.values[i].push(v);
        });
        // Trim
        const maxT = buf.t[buf.t.length - 1];
        while (buf.t.length > 0 && maxT - buf.t[0] > DYN_WINDOW_SECONDS) {
          buf.t.shift();
          buf.values.forEach((arr) => arr.shift());
        }
        setTick((x) => x + 1);
      };
      const finalize = () => setTick((x) => x + 1);
      props.onMount(push, finalize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ratio = window.devicePixelRatio || 1;
    const bodyEl = canvas.parentElement as HTMLDivElement;
    const w = bodyEl.clientWidth;
    const h = bodyEl.clientHeight;
    canvas.width = Math.max(1, w * ratio);
    canvas.height = Math.max(1, h * ratio);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    let data: PlotData | undefined = props.data;
    if (props.mode === "dyn") {
      const buf = dynBuffersRef.current;
      data = {
        x: buf.t.slice(),
        series: buf.values.map((values, i) => ({ label: buf.labels[i] ?? `n${i}`, values: values.slice() })),
        xLabel: "time (s)",
        yLabel: "V"
      };
    }
    if (data) drawPlot(ctx, w, h, data);
  });

  /* Dragging / resizing */
  const dragRef = useRef<{
    kind: "move" | "resize" | null;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  }>({ kind: null, startX: 0, startY: 0, origX: 0, origY: 0, origW: 0, origH: 0 });

  function onMouseDownHeader(e: React.MouseEvent) {
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

  function onMouseDownResize(e: React.MouseEvent) {
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
      props.onResize(props.id, Math.max(220, d.origW + dx), Math.max(160, d.origH + dy));
    }
  }

  function onMouseUp() {
    dragRef.current.kind = null;
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  return (
    <div
      className="tile"
      ref={containerRef}
      style={{ left: props.x, top: props.y, width: props.w, height: props.h }}
    >
      <div className="tile__header" onMouseDown={onMouseDownHeader}>
        <span className="tile__title">{props.title}</span>
        <button className="tile__close" onClick={() => props.onClose(props.id)} aria-label="Close tile">
          ×
        </button>
      </div>
      <div className="tile__body">
        <canvas ref={canvasRef} />
      </div>
      <div className="tile__resize" onMouseDown={onMouseDownResize} />
    </div>
  );
}
