import { useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasComponent,
  CanvasWire,
  DeviceType,
  GRID,
  PinReference,
  componentBounds,
  createDefaultComponent,
  getPinCoordinates,
  getPinsForType,
  snap,
  wireKey
} from "../lib/schematic";
import { DEFAULT_THEME, drawComponent } from "../lib/symbols";

export type ProbeTarget = { componentId: string; pin: string; netLabel?: string; x: number; y: number };

type Props = {
  components: CanvasComponent[];
  wires: CanvasWire[];
  selectedId: string | null;
  /** When non-null the canvas is in drop mode and will place this device type on click. */
  pendingDevice: DeviceType | null;
  /** True to capture a pin click as a dyn-probe target instead of wiring. */
  probeMode: boolean;
  onSetComponents: (updater: (current: CanvasComponent[]) => CanvasComponent[]) => void;
  onSetWires: (updater: (current: CanvasWire[]) => CanvasWire[]) => void;
  onSelect: (id: string | null) => void;
  onPendingResolved: () => void;
  onProbePick: (target: ProbeTarget) => void;
};

type PanState = { x: number; y: number; scale: number };

type InteractionState =
  | { kind: "idle" }
  | { kind: "panning"; startX: number; startY: number; origin: PanState }
  | { kind: "moving"; id: string; offsetX: number; offsetY: number }
  | { kind: "wiring"; from: PinReference; cursorX: number; cursorY: number };

const PIN_RADIUS = 5;

export function SchematicCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pan, setPan] = useState<PanState>({ x: 40, y: 40, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ kind: "idle" });
  const [hoverPin, setHoverPin] = useState<PinReference | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);

  const componentsById = useMemo(() => {
    const map = new Map<string, CanvasComponent>();
    props.components.forEach((c) => map.set(c.id, c));
    return map;
  }, [props.components]);

  // Nameable nets aren't computed client-side — we just show pin refs.
  const netLabelFor = (ref: PinReference): string | undefined => {
    const c = componentsById.get(ref.componentId);
    if (!c) return undefined;
    return `${c.name}.${ref.pin}`;
  };

  // High-DPI canvas sizing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement as HTMLDivElement;
    const obs = new ResizeObserver(() => draw());
    obs.observe(parent);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.components, props.wires, pan, hoverPin, interaction, mousePos, props.selectedId, props.pendingDevice, props.probeMode]);

  function clientToWorld(clientX: number, clientY: number) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    return {
      sx,
      sy,
      wx: (sx - pan.x) / pan.scale,
      wy: (sy - pan.y) / pan.scale
    };
  }

  function findPinAt(wx: number, wy: number): PinReference | null {
    let best: { ref: PinReference; d: number } | null = null;
    for (const c of props.components) {
      const pins = getPinsForType(c.type, c);
      for (const pin of pins) {
        const p = getPinCoordinates(c, pin);
        const d = Math.hypot(p.x - wx, p.y - wy);
        if (d < PIN_RADIUS * 2.5 + 4) {
          if (!best || d < best.d) best = { ref: { componentId: c.id, pin }, d };
        }
      }
    }
    return best?.ref ?? null;
  }

  function findComponentAt(wx: number, wy: number): CanvasComponent | null {
    for (let i = props.components.length - 1; i >= 0; i--) {
      const c = props.components[i];
      const b = componentBounds(c);
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return c;
    }
    return null;
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { wx, wy } = clientToWorld(e.clientX, e.clientY);
    if (props.pendingDevice) {
      const nextIndex =
        props.components.filter((c) => c.type === props.pendingDevice).length + 1;
      const nc = createDefaultComponent(props.pendingDevice, nextIndex, wx, wy);
      props.onSetComponents((cur) => [...cur, nc]);
      props.onPendingResolved();
      return;
    }
    if (e.button === 1 || e.shiftKey) {
      setInteraction({
        kind: "panning",
        startX: e.clientX,
        startY: e.clientY,
        origin: { ...pan }
      });
      return;
    }

    const pin = findPinAt(wx, wy);
    if (pin) {
      if (props.probeMode) {
        const c = componentsById.get(pin.componentId);
        if (c) {
          const p = getPinCoordinates(c, pin.pin);
          props.onProbePick({
            componentId: pin.componentId,
            pin: pin.pin,
            netLabel: netLabelFor(pin),
            x: p.x,
            y: p.y
          });
        }
        return;
      }
      setInteraction({ kind: "wiring", from: pin, cursorX: wx, cursorY: wy });
      return;
    }

    const hit = findComponentAt(wx, wy);
    if (hit) {
      props.onSelect(hit.id);
      setInteraction({ kind: "moving", id: hit.id, offsetX: wx - hit.x, offsetY: wy - hit.y });
    } else {
      props.onSelect(null);
    }
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const { sx, sy, wx, wy } = clientToWorld(e.clientX, e.clientY);
    setMousePos({ x: sx, y: sy, wx, wy });

    if (interaction.kind === "panning") {
      const dx = e.clientX - interaction.startX;
      const dy = e.clientY - interaction.startY;
      setPan({
        x: interaction.origin.x + dx,
        y: interaction.origin.y + dy,
        scale: interaction.origin.scale
      });
      return;
    }
    if (interaction.kind === "moving") {
      const id = interaction.id;
      const ox = interaction.offsetX;
      const oy = interaction.offsetY;
      props.onSetComponents((cur) =>
        cur.map((c) => (c.id === id ? { ...c, x: snap(wx - ox), y: snap(wy - oy) } : c))
      );
      return;
    }
    if (interaction.kind === "wiring") {
      setInteraction({ ...interaction, cursorX: wx, cursorY: wy });
    }
    setHoverPin(findPinAt(wx, wy));
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    const { wx, wy } = clientToWorld(e.clientX, e.clientY);
    if (interaction.kind === "wiring") {
      const target = findPinAt(wx, wy);
      if (target && !(target.componentId === interaction.from.componentId && target.pin === interaction.from.pin)) {
        const candidate: CanvasWire = {
          id: `w-${Math.random().toString(36).slice(2, 8)}`,
          start: interaction.from,
          end: target
        };
        props.onSetWires((cur) => {
          const existing = new Set(cur.map(wireKey));
          if (existing.has(wireKey(candidate))) return cur;
          return [...cur, candidate];
        });
      }
    }
    setInteraction({ kind: "idle" });
  }

  function onWheel(e: React.WheelEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const scaleFactor = Math.exp(-e.deltaY * 0.001);
    const newScale = Math.min(4, Math.max(0.25, pan.scale * scaleFactor));
    const wx = (sx - pan.x) / pan.scale;
    const wy = (sy - pan.y) / pan.scale;
    const nx = sx - wx * newScale;
    const ny = sy - wy * newScale;
    setPan({ x: nx, y: ny, scale: newScale });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!props.selectedId) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      const id = props.selectedId;
      props.onSetComponents((cur) => cur.filter((c) => c.id !== id));
      props.onSetWires((cur) =>
        cur.filter((w) => w.start.componentId !== id && w.end.componentId !== id)
      );
      props.onSelect(null);
      e.preventDefault();
    } else if (e.key.toLowerCase() === "r") {
      props.onSetComponents((cur) =>
        cur.map((c) => (c.id === props.selectedId ? { ...c, rotation: ((c.rotation + 90) % 360) as CanvasComponent["rotation"] } : c))
      );
    }
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement as HTMLDivElement;
    const ratio = window.devicePixelRatio || 1;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (canvas.width !== w * ratio || canvas.height !== h * ratio) {
      canvas.width = w * ratio;
      canvas.height = h * ratio;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Grid
    drawGrid(ctx, w, h, pan);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(pan.scale, pan.scale);

    // Wires
    ctx.strokeStyle = DEFAULT_THEME.accent;
    ctx.lineWidth = 1.8;
    for (const wire of props.wires) {
      const a = componentsById.get(wire.start.componentId);
      const b = componentsById.get(wire.end.componentId);
      if (!a || !b) continue;
      const p1 = getPinCoordinates(a, wire.start.pin);
      const p2 = getPinCoordinates(b, wire.end.pin);
      drawOrthoWire(ctx, p1.x, p1.y, p2.x, p2.y);
    }

    // Components
    for (const c of props.components) {
      drawComponent(ctx, c, DEFAULT_THEME);
      // Name label
      const b = componentBounds(c);
      ctx.fillStyle = DEFAULT_THEME.label;
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(c.name, c.x, b.y + b.h + 4);
      if (c.type !== "GND") {
        ctx.fillStyle = DEFAULT_THEME.muted;
        ctx.fillText(c.value, c.x, b.y + b.h + 18);
      }
      if (props.selectedId === c.id) {
        ctx.save();
        ctx.strokeStyle = DEFAULT_THEME.accent;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
        ctx.restore();
      }
      // Pins
      const pins = getPinsForType(c.type, c);
      for (const pin of pins) {
        const p = getPinCoordinates(c, pin);
        const isHover =
          hoverPin?.componentId === c.id && hoverPin.pin === pin;
        ctx.beginPath();
        ctx.fillStyle = isHover ? DEFAULT_THEME.accent : "#25304a";
        ctx.strokeStyle = DEFAULT_THEME.accent;
        ctx.lineWidth = 1.2;
        ctx.arc(p.x, p.y, PIN_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    // In-flight wire
    if (interaction.kind === "wiring") {
      const a = componentsById.get(interaction.from.componentId);
      if (a) {
        const p = getPinCoordinates(a, interaction.from.pin);
        ctx.save();
        ctx.strokeStyle = DEFAULT_THEME.accent;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.6;
        drawOrthoWire(ctx, p.x, p.y, interaction.cursorX, interaction.cursorY);
        ctx.restore();
      }
    }

    // Probe-mode crosshair
    if (props.probeMode && hoverPin) {
      const c = componentsById.get(hoverPin.componentId);
      if (c) {
        const p = getPinCoordinates(c, hoverPin.pin);
        ctx.save();
        ctx.strokeStyle = "#ffd26d";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    ctx.restore();

    // Pending device ghost
    if (props.pendingDevice && mousePos) {
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(pan.scale, pan.scale);
      ctx.globalAlpha = 0.6;
      drawComponent(
        ctx,
        {
          id: "ghost",
          type: props.pendingDevice,
          name: props.pendingDevice,
          value: "",
          x: snap(mousePos.wx),
          y: snap(mousePos.wy),
          rotation: 0,
          pins: props.pendingDevice === "SUBCKT" ? ["a", "b", "c", "d"] : undefined
        },
        DEFAULT_THEME
      );
      ctx.restore();
    }
  }

  return (
    <div className="canvasArea" style={{ position: "relative" }}>
      <canvas
        ref={canvasRef}
        className="schematicCanvas"
        tabIndex={0}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={() => {
          setHoverPin(null);
          setMousePos(null);
        }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        style={{
          cursor: props.pendingDevice ? "copy" : props.probeMode ? "crosshair" : "default"
        }}
      />
      {hoverPin && mousePos ? (
        <div
          className="hoverBadge"
          style={{ left: mousePos.x + 10, top: mousePos.y + 14 }}
        >
          {netLabelFor(hoverPin)}
        </div>
      ) : null}
      {props.probeMode ? (
        <div className="nodeProbeHint" style={{ right: 16, top: 16 }}>
          Probe mode — click a pin to add a live .dyn tile
        </div>
      ) : null}
    </div>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, pan: PanState) {
  ctx.save();
  ctx.fillStyle = "#0b0f17";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(110,168,255,0.06)";
  ctx.lineWidth = 1;

  const step = GRID * pan.scale;
  const ox = pan.x % step;
  const oy = pan.y % step;
  ctx.beginPath();
  for (let x = ox; x < w; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = oy; y < h; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Major lines every 4 grid units.
  ctx.strokeStyle = "rgba(110,168,255,0.12)";
  ctx.beginPath();
  const bigStep = step * 4;
  const bx = pan.x % bigStep;
  const by = pan.y % bigStep;
  for (let x = bx; x < w; x += bigStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = by; y < h; y += bigStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawOrthoWire(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  // L-shaped: horizontal first then vertical.
  const mx = x2;
  const my = y1;
  ctx.lineTo(mx, my);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
