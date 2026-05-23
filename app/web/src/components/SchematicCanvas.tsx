import { useEffect, useMemo, useRef, useState } from "react";
import {
  CanvasComponent,
  CanvasWire,
  DeviceType,
  GRID,
  LevelJunction,
  WireEndpoint,
  componentBounds,
  computeNetAssignments,
  createDefaultComponent,
  endpointXY,
  getPinCoordinates,
  getPinsForType,
  pinEndpoint,
  pointEndpoint,
  snap,
  wireKey
} from "../lib/schematic";
import { DEFAULT_THEME, drawComponent } from "../lib/symbols";

export type ProbeTarget = { componentId: string; pin: string; netLabel?: string; x: number; y: number };

/** Snapshot for clipboard. */
export type ClipboardData = {
  components: CanvasComponent[];
  wires: CanvasWire[];
};

type Props = {
  components: CanvasComponent[];
  wires: CanvasWire[];
  /** Named junctions for the active level (e.g. port_in, port_out for SUBCKT use). */
  junctions?: LevelJunction[];
  selectedIds: Set<string>;
  /** When non-null the canvas is in drop mode and will place this device type on click. */
  pendingDevice: DeviceType | null;
  /** True to capture a pin click as a dyn-probe target instead of wiring. */
  probeMode: boolean;
  onSetComponents: (updater: (current: CanvasComponent[]) => CanvasComponent[]) => void;
  onSetWires: (updater: (current: CanvasWire[]) => CanvasWire[]) => void;
  onSelect: (ids: Set<string>) => void;
  onPendingResolved: () => void;
  onBeforeEdit: () => void;
  onProbePick: (target: ProbeTarget) => void;
  onCopy: (data: ClipboardData) => void;
  onPaste: () => void;
};

type PanState = { x: number; y: number; scale: number };

type InteractionState =
  | { kind: "idle" }
  | { kind: "panning"; startX: number; startY: number; origin: PanState }
  | {
      kind: "moving";
      ids: string[];
      anchorWX: number;
      anchorWY: number;
      origin: Map<string, { x: number; y: number }>;
    }
  | { kind: "wiring"; from: WireEndpoint; cursorX: number; cursorY: number }
  | { kind: "marquee"; startWX: number; startWY: number; cursorWX: number; cursorWY: number };

const PIN_RADIUS = 5;
const FREE_HIT = 9;

export function SchematicCanvas(props: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pan, setPan] = useState<PanState>({ x: 40, y: 40, scale: 1 });
  const [interaction, setInteraction] = useState<InteractionState>({ kind: "idle" });
  const [hoverPin, setHoverPin] = useState<{ componentId: string; pin: string } | null>(null);
  const [hoverFreePoint, setHoverFreePoint] = useState<{ wireId: string; end: "start" | "end"; x: number; y: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const moveHistorySavedRef = useRef(false);

  const componentsById = useMemo(() => {
    const map = new Map<string, CanvasComponent>();
    props.components.forEach((c) => map.set(c.id, c));
    return map;
  }, [props.components]);

  const netLabelFor = (cid: string, pin: string): string | undefined => {
    const c = componentsById.get(cid);
    if (!c) return undefined;
    return `${c.name}.${pin}`;
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
  }, [
    props.components,
    props.wires,
    pan,
    hoverPin,
    hoverFreePoint,
    interaction,
    mousePos,
    props.selectedIds,
    props.pendingDevice,
    props.probeMode
  ]);

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

  function findPinAt(wx: number, wy: number): { componentId: string; pin: string } | null {
    let best: { ref: { componentId: string; pin: string }; d: number } | null = null;
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

  /** Find a free-floating wire endpoint near (wx,wy). */
  function findFreeEndpointAt(wx: number, wy: number) {
    for (const w of props.wires) {
      for (const which of ["start", "end"] as const) {
        const ep = which === "start" ? w.start : w.end;
        if (ep.kind !== "point") continue;
        const d = Math.hypot(ep.x - wx, ep.y - wy);
        if (d < FREE_HIT) return { wireId: w.id, end: which, x: ep.x, y: ep.y };
      }
    }
    return null;
  }

  function findComponentAt(wx: number, wy: number): CanvasComponent | null {
    for (let i = props.components.length - 1; i >= 0; i--) {
      const c = props.components[i];
      const b = componentBounds(c);
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return c;
    }
    return null;
  }

  /** Locate a wire whose body the cursor lies on (orthogonal segments). */
  function findWireAt(wx: number, wy: number): CanvasWire | null {
    for (const w of props.wires) {
      const a = endpointXY(w.start, componentsById);
      const b = endpointXY(w.end, componentsById);
      if (!a || !b) continue;
      if (
        pointNearSegment(wx, wy, a.x, a.y, b.x, a.y, 4) ||
        pointNearSegment(wx, wy, b.x, a.y, b.x, b.y, 4)
      ) {
        return w;
      }
    }
    return null;
  }

  function setSelection(ids: string[]): void {
    props.onSelect(new Set(ids));
  }

  function toggleSelection(id: string, additive: boolean): void {
    const next = new Set(props.selectedIds);
    if (additive) {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.clear();
      next.add(id);
    }
    props.onSelect(next);
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { wx, wy } = clientToWorld(e.clientX, e.clientY);
    canvasRef.current?.focus();
    if (props.pendingDevice) {
      const nextIndex =
        props.components.filter((c) => c.type === props.pendingDevice).length + 1;
      const nc = createDefaultComponent(props.pendingDevice, nextIndex, wx, wy);
      props.onBeforeEdit();
      props.onSetComponents((cur) => [...cur, nc]);
      props.onPendingResolved();
      return;
    }
    if (e.button === 1 || e.shiftKey) {
      // Shift held: marquee-select unless the user is on something interactive.
      // Middle-click pans regardless.
      if (e.button === 1) {
        setInteraction({
          kind: "panning",
          startX: e.clientX,
          startY: e.clientY,
          origin: { ...pan }
        });
        return;
      }
      // shiftKey: fall through to selection logic, with additive flag.
    }

    // 1) Wiring: handling the SECOND click that completes/extends a wire.
    if (interaction.kind === "wiring") {
      const target = findPinAt(wx, wy);
      if (target) {
        finalizeWire(interaction.from, pinEndpoint(target.componentId, target.pin));
      } else {
        const free = findFreeEndpointAt(wx, wy);
        if (free) {
          finalizeWire(interaction.from, pointEndpoint(free.x, free.y));
        } else {
          // Settle a free endpoint at the click coordinate. Wiring ends here —
          // click the free endpoint later to resume from that point.
          const settle = pointEndpoint(snap(wx), snap(wy));
          finalizeWire(interaction.from, settle);
        }
      }
      setInteraction({ kind: "idle" });
      return;
    }

    // 2) Pin click → start wiring (or probe).
    const pin = findPinAt(wx, wy);
    if (pin) {
      const pinComponent = componentsById.get(pin.componentId);
      if (!props.probeMode && pinComponent?.type === "NODE") {
        selectAndStartMove(pinComponent, wx, wy, e.shiftKey);
        return;
      }
      if (props.probeMode) {
        if (pinComponent) {
          const p = getPinCoordinates(pinComponent, pin.pin);
          props.onProbePick({
            componentId: pin.componentId,
            pin: pin.pin,
            netLabel: netLabelFor(pin.componentId, pin.pin),
            x: p.x,
            y: p.y
          });
        }
        return;
      }
      setInteraction({
        kind: "wiring",
        from: pinEndpoint(pin.componentId, pin.pin),
        cursorX: wx,
        cursorY: wy
      });
      return;
    }

    // 3) Free-endpoint click → resume wiring from that point.
    const free = findFreeEndpointAt(wx, wy);
    if (free) {
      setInteraction({
        kind: "wiring",
        from: pointEndpoint(free.x, free.y),
        cursorX: free.x,
        cursorY: free.y
      });
      return;
    }

    // 4) Component click → select / start move.
    const hit = findComponentAt(wx, wy);
    if (hit) {
      selectAndStartMove(hit, wx, wy, e.shiftKey);
      return;
    }

    // 5) Wire click → toggle that wire's selection.
    const wireHit = findWireAt(wx, wy);
    if (wireHit) {
      toggleSelection(wireHit.id, e.shiftKey);
      return;
    }

    // 6) Empty canvas → start marquee select (or clear selection on shift+empty).
    if (!e.shiftKey) {
      setSelection([]);
    }
    setInteraction({ kind: "marquee", startWX: wx, startWY: wy, cursorWX: wx, cursorWY: wy });
  }

  function selectAndStartMove(hit: CanvasComponent, wx: number, wy: number, additive: boolean): void {
    const alreadySelected = props.selectedIds.has(hit.id);
    let nextSel: Set<string>;
    if (additive) {
      nextSel = new Set(props.selectedIds);
      if (alreadySelected) nextSel.delete(hit.id);
      else nextSel.add(hit.id);
    } else if (alreadySelected) {
      nextSel = new Set(props.selectedIds);
    } else {
      nextSel = new Set([hit.id]);
    }
    props.onSelect(nextSel);
    moveHistorySavedRef.current = false;
    // Build origin map for selected components so we can drag the group.
    const origin = new Map<string, { x: number; y: number }>();
    for (const id of nextSel) {
      const cc = componentsById.get(id);
      if (cc) origin.set(id, { x: cc.x, y: cc.y });
    }
    setInteraction({
      kind: "moving",
      ids: Array.from(nextSel),
      anchorWX: wx,
      anchorWY: wy,
      origin
    });
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
      const dx = wx - interaction.anchorWX;
      const dy = wy - interaction.anchorWY;
      if (!moveHistorySavedRef.current && Math.hypot(dx, dy) > 1) {
        props.onBeforeEdit();
        moveHistorySavedRef.current = true;
      }
      const origin = interaction.origin;
      props.onSetComponents((cur) =>
        cur.map((c) => {
          const o = origin.get(c.id);
          return o ? { ...c, x: snap(o.x + dx), y: snap(o.y + dy) } : c;
        })
      );
      return;
    }
    if (interaction.kind === "wiring") {
      setInteraction({ ...interaction, cursorX: wx, cursorY: wy });
    }
    if (interaction.kind === "marquee") {
      setInteraction({ ...interaction, cursorWX: wx, cursorWY: wy });
    }
    setHoverPin(findPinAt(wx, wy));
    setHoverFreePoint(findFreeEndpointAt(wx, wy));
  }

  function onMouseUp(_e: React.MouseEvent<HTMLCanvasElement>) {
    if (interaction.kind === "marquee") {
      const { startWX, startWY, cursorWX, cursorWY } = interaction;
      // Only treat as a marquee if the box is non-trivial; otherwise leave
      // selection cleared from mousedown.
      if (Math.hypot(cursorWX - startWX, cursorWY - startWY) > 4) {
        const minx = Math.min(startWX, cursorWX);
        const maxx = Math.max(startWX, cursorWX);
        const miny = Math.min(startWY, cursorWY);
        const maxy = Math.max(startWY, cursorWY);
        const picked: string[] = [];
        for (const c of props.components) {
          const b = componentBounds(c);
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          if (cx >= minx && cx <= maxx && cy >= miny && cy <= maxy) picked.push(c.id);
        }
        for (const w of props.wires) {
          const a = endpointXY(w.start, componentsById);
          const b = endpointXY(w.end, componentsById);
          if (!a || !b) continue;
          if (
            a.x >= minx && a.x <= maxx && a.y >= miny && a.y <= maxy &&
            b.x >= minx && b.x <= maxx && b.y >= miny && b.y <= maxy
          ) picked.push(w.id);
        }
        setSelection(picked);
      }
    }
    if (interaction.kind !== "wiring") {
      setInteraction({ kind: "idle" });
    }
  }

  function finalizeWire(from: WireEndpoint, to: WireEndpoint): void {
    if (sameEndpoint(from, to)) return;
    const candidate: CanvasWire = {
      id: `w-${Math.random().toString(36).slice(2, 8)}`,
      start: from,
      end: to
    };
    const existing = new Set(props.wires.map(wireKey));
    if (existing.has(wireKey(candidate))) return;
    props.onBeforeEdit();
    props.onSetWires((cur) => {
      return [...cur, candidate];
    });
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

  function deleteSelection(): void {
    if (props.selectedIds.size === 0) return;
    const sel = props.selectedIds;
    props.onBeforeEdit();
    props.onSetComponents((cur) => cur.filter((c) => !sel.has(c.id)));
    props.onSetWires((cur) =>
      cur.filter((w) => {
        if (sel.has(w.id)) return false;
        if (w.start.kind === "pin" && sel.has(w.start.componentId)) return false;
        if (w.end.kind === "pin" && sel.has(w.end.componentId)) return false;
        return true;
      })
    );
    props.onSelect(new Set());
  }

  function copySelection(): void {
    const sel = props.selectedIds;
    if (sel.size === 0) return;
    const comps = props.components.filter((c) => sel.has(c.id));
    const compSet = new Set(comps.map((c) => c.id));
    // Include wires whose both endpoints are within the selection (or a free
    // point), or wires explicitly selected.
    const wires = props.wires.filter((w) => {
      if (sel.has(w.id)) return true;
      const startOk =
        w.start.kind === "point" ||
        (w.start.kind === "pin" && compSet.has(w.start.componentId));
      const endOk =
        w.end.kind === "point" ||
        (w.end.kind === "pin" && compSet.has(w.end.componentId));
      return startOk && endOk;
    });
    props.onCopy({
      components: comps.map((c) => ({ ...c })),
      wires: wires.map((w) => ({
        ...w,
        start:
          w.start.kind === "pin"
            ? { kind: "pin", componentId: w.start.componentId, pin: w.start.pin }
            : { kind: "point", x: w.start.x, y: w.start.y },
        end:
          w.end.kind === "pin"
            ? { kind: "pin", componentId: w.end.componentId, pin: w.end.pin }
            : { kind: "point", x: w.end.x, y: w.end.y }
      }))
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (props.selectedIds.size > 0) {
        deleteSelection();
        e.preventDefault();
      }
    } else if (e.key === "Escape") {
      if (props.pendingDevice) {
        props.onPendingResolved();
      }
      if (interaction.kind === "wiring" || interaction.kind === "marquee") {
        setInteraction({ kind: "idle" });
      }
      props.onSelect(new Set());
      e.preventDefault();
      e.stopPropagation();
    } else if (!(e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
      // Rotate every selected component 90° clockwise.
      if (props.selectedIds.size > 0) {
        props.onBeforeEdit();
        props.onSetComponents((cur) =>
          cur.map((c) =>
            props.selectedIds.has(c.id)
              ? { ...c, rotation: ((c.rotation + 90) % 360) as CanvasComponent["rotation"] }
              : c
          )
        );
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      copySelection();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      props.onPaste();
      e.preventDefault();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
      const all = new Set<string>();
      props.components.forEach((c) => all.add(c.id));
      props.wires.forEach((w) => all.add(w.id));
      props.onSelect(all);
      e.preventDefault();
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

    // Precompute obstacle bounds per component so the router can avoid crossing bodies.
    const obstacleBounds = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const c of props.components) {
      obstacleBounds.set(c.id, componentBounds(c));
    }

    // Net assignment for label rendering (mirrors backend union-find so the
    // canvas shows the same names the simulator will use). Cheap to recompute
    // on every draw — the union-find scales with pin + wire count.
    const nets = computeNetAssignments(props.components, props.wires);
    // Track which nets we've labeled at which approximate coordinates so we
    // don't repeat the same name on every segment of a long net.
    const labeledNetsAt = new Map<string, { x: number; y: number }>();

    // Wires
    for (const wire of props.wires) {
      const a = endpointXY(wire.start, componentsById);
      const b = endpointXY(wire.end, componentsById);
      if (!a || !b) continue;
      const obstacles: { x: number; y: number; w: number; h: number }[] = [];
      const startOwner = wire.start.kind === "pin" ? wire.start.componentId : null;
      const endOwner = wire.end.kind === "pin" ? wire.end.componentId : null;
      for (const [cid, bounds] of obstacleBounds) {
        if (cid !== startOwner && cid !== endOwner) obstacles.push(bounds);
      }
      ctx.save();
      const isSelected = props.selectedIds.has(wire.id);
      ctx.strokeStyle = isSelected ? "#ffd26d" : DEFAULT_THEME.accent;
      ctx.lineWidth = isSelected ? 2.4 : 1.8;
      drawOrthoWire(ctx, a.x, a.y, b.x, b.y, obstacles);
      ctx.restore();

      // Free endpoint markers
      for (const ep of [wire.start, wire.end]) {
        if (ep.kind !== "point") continue;
        ctx.save();
        ctx.fillStyle = "#0b0f17";
        ctx.strokeStyle = DEFAULT_THEME.accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Net-name label near wire midpoint. Ground rails are left unlabeled to
      // avoid visual clutter (the GND symbol itself carries the meaning).
      const netName = nets.byWire.get(wire.id);
      if (netName && netName !== "0" && netName !== "?") {
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const last = labeledNetsAt.get(netName);
        if (!last || Math.hypot(last.x - mx, last.y - my) > 90) {
          labeledNetsAt.set(netName, { x: mx, y: my });
          drawNetLabel(ctx, mx, my, netName);
        }
      }
    }

    // Named junctions (e.g. SUBCKT port_in / port_out markers). These render
    // as a distinct ringed dot with the junction id, so users can see exactly
    // where a sub-level exposes its external pins.
    for (const j of props.junctions ?? []) {
      ctx.save();
      ctx.fillStyle = "#ffd26d";
      ctx.strokeStyle = "#ffd26d";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(j.x, j.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(j.x, j.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      drawNetLabel(ctx, j.x, j.y, j.id);
    }

    // Components
    for (const c of props.components) {
      drawComponent(ctx, c, DEFAULT_THEME);
      // Name label
      const b = componentBounds(c);
      if (c.type !== "LABEL" && c.type !== "NODE") {
        ctx.fillStyle = DEFAULT_THEME.label;
        ctx.font = "500 11px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(c.name, c.x, b.y + b.h + 4);
        if (c.type !== "GND") {
          ctx.fillStyle = DEFAULT_THEME.muted;
          ctx.fillText(c.value, c.x, b.y + b.h + 18);
        }
      }
      if (props.selectedIds.has(c.id)) {
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
        const isHover = hoverPin?.componentId === c.id && hoverPin.pin === pin;
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
      const fromXY = endpointXY(interaction.from, componentsById);
      if (fromXY) {
        const previewObstacles = Array.from(obstacleBounds.entries())
          .filter(([cid]) => interaction.from.kind === "pin" && cid !== interaction.from.componentId)
          .map(([, b]) => b);
        ctx.save();
        ctx.strokeStyle = DEFAULT_THEME.accent;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1.6;
        drawOrthoWire(
          ctx,
          fromXY.x,
          fromXY.y,
          interaction.cursorX,
          interaction.cursorY,
          previewObstacles
        );
        ctx.restore();
      }
    }

    // Marquee box
    if (interaction.kind === "marquee") {
      const minx = Math.min(interaction.startWX, interaction.cursorWX);
      const maxx = Math.max(interaction.startWX, interaction.cursorWX);
      const miny = Math.min(interaction.startWY, interaction.cursorWY);
      const maxy = Math.max(interaction.startWY, interaction.cursorWY);
      ctx.save();
      ctx.strokeStyle = DEFAULT_THEME.accent;
      ctx.fillStyle = "rgba(110,168,255,0.08)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.fillRect(minx, miny, maxx - minx, maxy - miny);
      ctx.strokeRect(minx, miny, maxx - minx, maxy - miny);
      ctx.restore();
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

    // Free-endpoint hover ring
    if (hoverFreePoint && interaction.kind !== "wiring") {
      ctx.save();
      ctx.strokeStyle = "#ffd26d";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(hoverFreePoint.x, hoverFreePoint.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
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
          mirrored: false,
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
          setHoverFreePoint(null);
          setMousePos(null);
        }}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        style={{
          cursor:
            props.pendingDevice
              ? "copy"
              : props.probeMode
                ? "crosshair"
                : interaction.kind === "wiring"
                  ? "crosshair"
                  : "default"
        }}
      />
      {hoverPin && mousePos ? (
        <div
          className="hoverBadge"
          style={{ left: mousePos.x + 10, top: mousePos.y + 14 }}
        >
          {netLabelFor(hoverPin.componentId, hoverPin.pin)}
        </div>
      ) : null}
      {props.probeMode ? (
        <div className="nodeProbeHint" style={{ right: 16, top: 16 }}>
          Probe mode — click a pin to add a live .dyn tile
        </div>
      ) : null}
      {interaction.kind === "wiring" ? (
        <div className="nodeProbeHint" style={{ right: 16, top: 16 }}>
          Wiring — click a pin to finish, click empty space to drop a free joint, Esc to cancel
        </div>
      ) : null}
      {props.pendingDevice ? (
        <div className="nodeProbeHint" style={{ right: 16, top: interaction.kind === "wiring" ? 54 : 16 }}>
          Placing {props.pendingDevice} — click to place, Esc to cancel
        </div>
      ) : null}
    </div>
  );
}

function sameEndpoint(a: WireEndpoint, b: WireEndpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "pin" && b.kind === "pin") {
    return a.componentId === b.componentId && a.pin === b.pin;
  }
  if (a.kind === "point" && b.kind === "point") {
    return a.x === b.x && a.y === b.y;
  }
  return false;
}

function pointNearSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  tol: number
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay) < tol;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cy = ay + dy * t;
  return Math.hypot(px - cx, py - cy) < tol;
}

function drawNetLabel(ctx: CanvasRenderingContext2D, x: number, y: number, name: string) {
  ctx.save();
  ctx.font = "600 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const padding = 4;
  const metrics = ctx.measureText(name);
  const boxW = metrics.width + padding * 2;
  const boxH = 14;
  // Offset slightly above the wire so the box doesn't sit on top of the line.
  const bx = x + 6;
  const by = y - boxH / 2 - 4;
  ctx.fillStyle = "rgba(11,15,23,0.85)";
  ctx.strokeStyle = "rgba(110,168,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(bx, by, boxW, boxH);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#cfe1ff";
  ctx.fillText(name, bx + padding, by + boxH / 2);
  ctx.restore();
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

type Rect = { x: number; y: number; w: number; h: number };

function segmentCrossesRect(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  rect: Rect,
  pad = 4
): boolean {
  const rx1 = rect.x + pad;
  const ry1 = rect.y + pad;
  const rx2 = rect.x + rect.w - pad;
  const ry2 = rect.y + rect.h - pad;
  if (rx2 <= rx1 || ry2 <= ry1) return false;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (!clip(-dx, ax - rx1)) return false;
  if (!clip(dx, rx2 - ax)) return false;
  if (!clip(-dy, ay - ry1)) return false;
  if (!clip(dy, ry2 - ay)) return false;
  return t1 > t0;
}

function countCrossings(
  obstacles: Rect[],
  segments: [number, number, number, number][]
): number {
  let n = 0;
  for (const [ax, ay, bx, by] of segments) {
    for (const r of obstacles) {
      if (segmentCrossesRect(ax, ay, bx, by, r)) n++;
    }
  }
  return n;
}

function drawOrthoWire(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  obstacles: Rect[] = []
) {
  const hFirst: [number, number, number, number][] = [
    [x1, y1, x2, y1],
    [x2, y1, x2, y2]
  ];
  const vFirst: [number, number, number, number][] = [
    [x1, y1, x1, y2],
    [x1, y2, x2, y2]
  ];
  const hCross = countCrossings(obstacles, hFirst);
  const vCross = countCrossings(obstacles, vFirst);
  const segments = vCross < hCross ? vFirst : hFirst;

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  for (const [, , ex, ey] of segments) {
    ctx.lineTo(ex, ey);
  }
  ctx.stroke();
}
