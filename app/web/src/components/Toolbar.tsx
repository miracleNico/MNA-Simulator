import { useEffect, useRef } from "react";
import { DeviceType, DEVICE_LABELS } from "../lib/schematic";
import { drawPalettePreview } from "../lib/symbols";

type Props = {
  pendingDevice: DeviceType | null;
  onPickDevice: (type: DeviceType | null) => void;
  onToggleProbe: () => void;
  probeMode: boolean;
  onStartDisplay: () => void;
  running: boolean;
};

const REGULAR: DeviceType[] = ["R", "C", "L", "V", "I", "D", "GND"];
const TRANSISTORS: DeviceType[] = ["QNPN", "QPNP", "NMOS", "PMOS"];
const CONTROLLED: DeviceType[] = ["VCVS", "VCCS", "CCCS", "CCVS"];
const ANNOTATION: DeviceType[] = ["LABEL", "NODE"];

export function Toolbar(props: Props) {
  return (
    <div className="toolbar">
      <div className="toolGroup">
        <span className="toolGroup__label">Components</span>
        {REGULAR.map((t) => (
          <DeviceButton
            key={t}
            type={t}
            active={props.pendingDevice === t}
            onClick={() => props.onPickDevice(props.pendingDevice === t ? null : t)}
          />
        ))}
      </div>
      <div className="toolGroup">
        <span className="toolGroup__label">Transistors</span>
        {TRANSISTORS.map((t) => (
          <DeviceButton
            key={t}
            type={t}
            active={props.pendingDevice === t}
            onClick={() => props.onPickDevice(props.pendingDevice === t ? null : t)}
          />
        ))}
      </div>
      <div className="toolGroup">
        <span className="toolGroup__label">Controlled sources</span>
        {CONTROLLED.map((t) => (
          <DeviceButton
            key={t}
            type={t}
            active={props.pendingDevice === t}
            onClick={() => props.onPickDevice(props.pendingDevice === t ? null : t)}
          />
        ))}
      </div>
      <div className="toolGroup">
        <span className="toolGroup__label">Library</span>
        <DeviceButton
          type={"SUBCKT"}
          active={props.pendingDevice === "SUBCKT"}
          onClick={() => props.onPickDevice(props.pendingDevice === "SUBCKT" ? null : "SUBCKT")}
        />
      </div>
      <div className="toolGroup">
        <span className="toolGroup__label">Nodes</span>
        {ANNOTATION.map((t) => (
          <DeviceButton
            key={t}
            type={t}
            active={props.pendingDevice === t}
            onClick={() => props.onPickDevice(props.pendingDevice === t ? null : t)}
          />
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <div className="toolGroup">
        <button
          className={`toolBtn ${props.probeMode ? "active" : ""}`}
          onClick={props.onToggleProbe}
          title="Probe mode: click a pin to open a live .dyn tile"
        >
          <ProbeIcon />
          <span className="toolBtn__tip">Probe (.dyn)</span>
        </button>
        <button
          className="toolBtn"
          onClick={props.onStartDisplay}
          title="Start dynamic display for selected display nodes"
          disabled={props.running}
        >
          <RunIcon running={props.running} />
          <span className="toolBtn__tip">Display</span>
        </button>
      </div>
    </div>
  );
}

function DeviceButton({
  type,
  active,
  onClick
}: {
  type: DeviceType;
  active: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const size = 34;
    c.width = size * ratio;
    c.height = size * ratio;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    // Scale tiny device preview to fit.
    ctx.scale(0.35, 0.35);
    drawPalettePreview(ctx, type);
  }, [type]);

  return (
    <button
      className={`toolBtn ${active ? "active" : ""}`}
      onClick={onClick}
      title={DEVICE_LABELS[type]}
    >
      <canvas ref={ref} />
      <span className="toolBtn__tip">{DEVICE_LABELS[type]}</span>
    </button>
  );
}

function ProbeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 17l5-5" />
      <path d="M8 12l4-4 3 3-4 4z" />
      <path d="M12 8l3-3" />
      <circle cx="16" cy="4" r="1.5" />
    </svg>
  );
}

function RunIcon({ running }: { running: boolean }) {
  if (running) {
    return (
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
        <rect x="5" y="4" width="3" height="12" rx="1" />
        <rect x="12" y="4" width="3" height="12" rx="1" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6 4l10 6-10 6V4z" />
    </svg>
  );
}
