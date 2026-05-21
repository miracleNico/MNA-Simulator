/**
 * Canvas 2D matplotlib-style line plotter.
 *
 * Designed for low-overhead rendering of transient, harmonic, and realtime
 * waveform tiles. Keeps a consistent flat-design look (axes, gridlines,
 * muted tick labels, colored series, and a legend).
 */

export type PlotSeries = {
  label: string;
  values: number[];
  /** Optional explicit color; if omitted a palette is used. */
  color?: string;
};

export type PlotData = {
  x: number[];
  series: PlotSeries[];
  xLabel?: string;
  yLabel?: string;
  title?: string;
  /** Line for sweeps/waveforms, stem for discrete spectra. */
  kind?: "line" | "stem";
  /** Display x in log scale (AC sweeps). */
  logX?: boolean;
  /** Display y in log scale. */
  logY?: boolean;
};

const PALETTE = [
  "#6ea8ff",
  "#ffa56b",
  "#7ad97a",
  "#ff86c7",
  "#ffd26d",
  "#9bb7ff",
  "#82e0d4",
  "#e08cff"
];

export function drawPlot(ctx: CanvasRenderingContext2D, w: number, h: number, data: PlotData) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f1422";
  ctx.fillRect(0, 0, w, h);

  const padL = 48;
  const padR = 16;
  const padT = data.title ? 24 : 12;
  const padB = 30;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  if (plotW <= 10 || plotH <= 10) return;

  // Axis ranges
  const xs = data.x;
  const allYs = data.series.flatMap((s) => s.values).filter((v) => Number.isFinite(v));
  if (xs.length < 2 || allYs.length === 0) {
    drawEmptyState(ctx, w, h, "no samples yet");
    return;
  }

  const useLogX = !!data.logX && xs.some((v) => v > 0);
  const xFinite = xs.filter((v) => Number.isFinite(v) && (!useLogX || v > 0));
  let xMin = Math.min(...xFinite);
  let xMax = Math.max(...xFinite);
  if (xMin === xMax) xMax = xMin + 1;

  let yMin = data.kind === "stem" ? Math.min(0, ...allYs) : Math.min(...allYs);
  let yMax = Math.max(...allYs);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad;
  yMax += yPad;

  // Gridlines
  ctx.save();
  ctx.strokeStyle = "rgba(110,168,255,0.08)";
  ctx.fillStyle = "#7f8fa6";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.lineWidth = 1;

  const xTicks = useLogX ? logTicks(xMin, xMax) : niceTicks(xMin, xMax, 6);
  const yTicks = niceTicks(yMin, yMax, 5);

  ctx.beginPath();
  for (const tv of xTicks) {
    const px = scaleX(tv, xMin, xMax, plotW, padL, useLogX);
    ctx.moveTo(px, padT);
    ctx.lineTo(px, padT + plotH);
  }
  for (const tv of yTicks) {
    const py = padT + plotH - ((tv - yMin) / (yMax - yMin)) * plotH;
    ctx.moveTo(padL, py);
    ctx.lineTo(padL + plotW, py);
  }
  ctx.stroke();
  ctx.restore();

  // Axes
  ctx.save();
  ctx.strokeStyle = "rgba(230,237,247,0.4)";
  ctx.beginPath();
  ctx.moveTo(padL, padT);
  ctx.lineTo(padL, padT + plotH);
  ctx.lineTo(padL + plotW, padT + plotH);
  ctx.stroke();
  ctx.restore();

  // Tick labels
  ctx.fillStyle = "#9aa7bf";
  ctx.font = "10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const tv of xTicks) {
    const px = scaleX(tv, xMin, xMax, plotW, padL, useLogX);
    ctx.fillText(formatTick(tv), px, padT + plotH + 6);
  }
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const tv of yTicks) {
    const py = padT + plotH - ((tv - yMin) / (yMax - yMin)) * plotH;
    ctx.fillText(formatTick(tv), padL - 6, py);
  }

  // Title
  if (data.title) {
    ctx.fillStyle = "#d6dcea";
    ctx.font = "600 12px Inter, system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(data.title, padL, 6);
  }

  // Axis labels
  if (data.xLabel) {
    ctx.fillStyle = "#7f8fa6";
    ctx.textAlign = "center";
    ctx.fillText(data.xLabel, padL + plotW / 2, h - 14);
  }
  if (data.yLabel) {
    ctx.save();
    ctx.fillStyle = "#7f8fa6";
    ctx.textAlign = "center";
    ctx.translate(12, padT + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(data.yLabel, 0, 0);
    ctx.restore();
  }

  // Series
  data.series.forEach((series, sIdx) => {
    if (series.values.length < 2) return;
    const color = series.color ?? PALETTE[sIdx % PALETTE.length];
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = data.kind === "stem" ? 1.2 : 1.6;
    ctx.lineJoin = "round";
    const n = Math.min(series.values.length, xs.length);
    if (data.kind === "stem") {
      const baseline = padT + plotH - ((0 - yMin) / (yMax - yMin)) * plotH;
      const offset = (sIdx - (data.series.length - 1) / 2) * 5;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(series.values[i])) continue;
        const x = scaleX(xs[i], xMin, xMax, plotW, padL, useLogX) + offset;
        const y = padT + plotH - ((series.values[i] - yMin) / (yMax - yMin)) * plotH;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(x, baseline);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(series.values[i])) continue;
        if (useLogX && xs[i] <= 0) continue;
        const x = scaleX(xs[i], xMin, xMax, plotW, padL, useLogX);
        const y = padT + plotH - ((series.values[i] - yMin) / (yMax - yMin)) * plotH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  });

  // Legend
  const legendX = padL + 8;
  let legendY = padT + 8;
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  data.series.forEach((series, sIdx) => {
    const color = series.color ?? PALETTE[sIdx % PALETTE.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 4, 10, 3);
    ctx.fillStyle = "#d6dcea";
    ctx.fillText(series.label, legendX + 14, legendY - 2);
    legendY += 14;
  });
}

function scaleX(
  value: number,
  min: number,
  max: number,
  width: number,
  offset: number,
  log: boolean
): number {
  if (!log) return offset + ((value - min) / (max - min)) * width;
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  return offset + ((Math.log10(value) - lo) / (hi - lo)) * width;
}

function logTicks(min: number, max: number): number[] {
  const start = Math.floor(Math.log10(min));
  const end = Math.ceil(Math.log10(max));
  const ticks: number[] = [];
  for (let e = start; e <= end; e++) {
    const value = Math.pow(10, e);
    if (value >= min && value <= max) ticks.push(value);
  }
  if (ticks.length < 2) return niceTicks(min, max, 6);
  return ticks;
}

function drawEmptyState(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  ctx.fillStyle = "#7f8fa6";
  ctx.font = "11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, h / 2);
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step = niceStep(span / count);
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + 1e-12; v += step) ticks.push(v);
  return ticks;
}

function niceStep(raw: number): number {
  const exp = Math.floor(Math.log10(raw));
  const f = raw / Math.pow(10, exp);
  let nf = 1;
  if (f >= 5) nf = 5;
  else if (f >= 2) nf = 2;
  return nf * Math.pow(10, exp);
}

function formatTick(v: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-3) {
    return v.toExponential(1);
  }
  if (abs >= 1) return v.toFixed(2).replace(/\.?0+$/, "");
  return v.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
}
