/**
 * Flat-design schematic symbol rendering on Canvas 2D.
 *
 * All symbols are drawn centered at (0,0); the canvas transform is set up by
 * the caller to translate/rotate into component coordinates. Every function
 * should leave the context state as it found it.
 */

import { CanvasComponent, COMPONENT_BOX, DeviceType, GND_BOX } from "./schematic";

export type SymbolTheme = {
  stroke: string;
  accent: string;
  fill: string;
  label: string;
  muted: string;
};

export const DEFAULT_THEME: SymbolTheme = {
  stroke: "#e6edf7",
  accent: "#6ea8ff",
  fill: "#1a2130",
  label: "#c9d4e6",
  muted: "#7f8fa6"
};

function strokePath(ctx: CanvasRenderingContext2D, drawer: () => void, theme: SymbolTheme, width = 1.8): void {
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  drawer();
  ctx.stroke();
  ctx.restore();
}

function drawResistor(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const w = COMPONENT_BOX;
  strokePath(
    ctx,
    () => {
      ctx.moveTo(-w / 2, 0);
      ctx.lineTo(-w / 4, 0);
      for (let i = 0; i < 6; i++) {
        const dx = -w / 4 + (i + 1) * (w / 2 / 6);
        ctx.lineTo(dx, i % 2 === 0 ? -8 : 8);
      }
      ctx.lineTo(w / 4, 0);
      ctx.lineTo(w / 2, 0);
    },
    theme
  );
}

function drawCapacitor(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const w = COMPONENT_BOX;
  strokePath(ctx, () => {
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-6, 0);
    ctx.moveTo(-6, -14);
    ctx.lineTo(-6, 14);
    ctx.moveTo(6, -14);
    ctx.lineTo(6, 14);
    ctx.moveTo(6, 0);
    ctx.lineTo(w / 2, 0);
  }, theme);
}

function drawInductor(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const w = COMPONENT_BOX;
  strokePath(ctx, () => {
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-w / 4, 0);
    for (let i = 0; i < 4; i++) {
      const cx = -w / 4 + 6 + i * 8;
      ctx.moveTo(cx - 4, 0);
      ctx.arc(cx, 0, 4, Math.PI, 0, false);
    }
    ctx.moveTo(w / 4 + 6, 0);
    ctx.lineTo(w / 2, 0);
  }, theme);
}

function drawVoltageSource(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const h = COMPONENT_BOX;
  strokePath(ctx, () => {
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -16);
    ctx.moveTo(0, 16);
    ctx.lineTo(0, h / 2);
  }, theme);
  // circle
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  // +/- labels
  ctx.fillStyle = theme.label;
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("+", 0, -6);
  ctx.fillText("−", 0, 6);
  ctx.restore();
}

function drawCurrentSource(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const h = COMPONENT_BOX;
  strokePath(ctx, () => {
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(0, -16);
    ctx.moveTo(0, 16);
    ctx.lineTo(0, h / 2);
  }, theme);
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.arc(0, 0, 16, 0, Math.PI * 2);
  ctx.stroke();
  // arrow pointing up
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.lineTo(0, -10);
  ctx.moveTo(-4, -5);
  ctx.lineTo(0, -10);
  ctx.lineTo(4, -5);
  ctx.stroke();
  ctx.restore();
}

function drawDiode(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  const w = COMPONENT_BOX;
  strokePath(ctx, () => {
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(-8, 0);
    ctx.moveTo(8, 0);
    ctx.lineTo(w / 2, 0);
  }, theme);
  ctx.save();
  ctx.fillStyle = theme.accent;
  ctx.strokeStyle = theme.accent;
  ctx.beginPath();
  ctx.moveTo(-8, -10);
  ctx.lineTo(8, 0);
  ctx.lineTo(-8, 10);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(8, -10);
  ctx.lineTo(8, 10);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawGround(ctx: CanvasRenderingContext2D, theme: SymbolTheme): void {
  strokePath(ctx, () => {
    ctx.moveTo(0, -GND_BOX / 2);
    ctx.lineTo(0, 0);
    ctx.moveTo(-18, 0);
    ctx.lineTo(18, 0);
    ctx.moveTo(-12, 6);
    ctx.lineTo(12, 6);
    ctx.moveTo(-6, 12);
    ctx.lineTo(6, 12);
  }, theme, 2);
}

function drawControlledSource(
  ctx: CanvasRenderingContext2D,
  theme: SymbolTheme,
  label: string
): void {
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-COMPONENT_BOX / 2 + 12, -COMPONENT_BOX / 4);
  ctx.lineTo(-COMPONENT_BOX / 2, -COMPONENT_BOX / 4);
  ctx.moveTo(-COMPONENT_BOX / 2 + 12, COMPONENT_BOX / 4);
  ctx.lineTo(-COMPONENT_BOX / 2, COMPONENT_BOX / 4);
  ctx.moveTo(COMPONENT_BOX / 2, -COMPONENT_BOX / 4);
  ctx.lineTo(COMPONENT_BOX / 2 - 12, -COMPONENT_BOX / 4);
  ctx.moveTo(COMPONENT_BOX / 2, COMPONENT_BOX / 4);
  ctx.lineTo(COMPONENT_BOX / 2 - 12, COMPONENT_BOX / 4);
  ctx.stroke();
  // diamond
  ctx.beginPath();
  ctx.moveTo(0, -18);
  ctx.lineTo(18, 0);
  ctx.lineTo(0, 18);
  ctx.lineTo(-18, 0);
  ctx.closePath();
  ctx.stroke();
  ctx.fillStyle = theme.label;
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();
}

function drawSubckt(ctx: CanvasRenderingContext2D, theme: SymbolTheme, component: CanvasComponent): void {
  ctx.save();
  ctx.strokeStyle = theme.stroke;
  ctx.fillStyle = theme.fill;
  ctx.lineWidth = 1.8;
  const w = COMPONENT_BOX * 2;
  const h = COMPONENT_BOX * 2;
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.arcTo(w / 2, -h / 2, w / 2, h / 2, r);
  ctx.arcTo(w / 2, h / 2, -w / 2, h / 2, r);
  ctx.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r);
  ctx.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme.label;
  ctx.font = "600 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(component.name || "SUBCKT", 0, 0);
  ctx.restore();
}

export function drawComponent(
  ctx: CanvasRenderingContext2D,
  component: CanvasComponent,
  theme: SymbolTheme = DEFAULT_THEME
): void {
  ctx.save();
  ctx.translate(component.x, component.y);
  if (component.rotation) {
    ctx.rotate((component.rotation * Math.PI) / 180);
  }
  switch (component.type) {
    case "R":
      drawResistor(ctx, theme);
      break;
    case "C":
      drawCapacitor(ctx, theme);
      break;
    case "L":
      drawInductor(ctx, theme);
      break;
    case "V":
      drawVoltageSource(ctx, theme);
      break;
    case "I":
      drawCurrentSource(ctx, theme);
      break;
    case "D":
      drawDiode(ctx, theme);
      break;
    case "GND":
      drawGround(ctx, theme);
      break;
    case "VCVS":
      drawControlledSource(ctx, theme, "E");
      break;
    case "VCCS":
      drawControlledSource(ctx, theme, "G");
      break;
    case "CCCS":
      drawControlledSource(ctx, theme, "F");
      break;
    case "CCVS":
      drawControlledSource(ctx, theme, "H");
      break;
    case "SUBCKT":
      drawSubckt(ctx, theme, component);
      break;
  }
  ctx.restore();
}

/** Draws a small palette preview of a device type, centered at (0,0). */
export function drawPalettePreview(
  ctx: CanvasRenderingContext2D,
  type: DeviceType,
  theme: SymbolTheme = DEFAULT_THEME
): void {
  const fake: CanvasComponent = {
    id: "preview",
    type,
    name: type,
    value: "",
    x: 0,
    y: 0,
    rotation: 0,
    pins: type === "SUBCKT" ? ["a", "b", "c", "d"] : undefined
  };
  drawComponent(ctx, fake, theme);
}
