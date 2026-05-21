import { ReactNode, useEffect, useRef, useState } from "react";
import {
  AnalysisState,
  BasicAnalysisMode,
  CanvasComponent,
  DeviceType,
  SchematicLevel,
  SchematicPreset,
  DEVICE_LABELS
} from "../lib/schematic";
import { drawPalettePreview } from "../lib/symbols";

type Props = {
  analysis: AnalysisState;
  onAnalysisChange: (patch: Partial<AnalysisState>) => void;
  presets: SchematicPreset[];
  onLoadPreset: (id: string) => void;
  onRun: () => void;
  running: boolean;
  availableNodes: string[];
  onAddProbeNode: (label: string) => void;
  onRemoveProbeNode: (label: string) => void;

  levels: SchematicLevel[];
  activeLevelId: string;
  onSelectLevel: (id: string) => void;
  onAddLevel: (parentId: string | null) => void;
  onRenameLevel: (id: string, newTitle: string) => void;
  onDeleteLevel: (id: string) => void;

  libraryComponents: DeviceType[];
  onStartDrag: (type: DeviceType) => void;

  selectedComponent: CanvasComponent | null;
  onUpdateComponent: (id: string, patch: Partial<CanvasComponent>) => void;

  netlistPreview: string;
  generatedNetlist: string;
};

export function LeftPane(props: Props) {
  return (
    <aside className="leftPane">
      <CollapsibleSection title="Simulation" defaultOpen>
        <SimulationControls
          analysis={props.analysis}
          onAnalysisChange={props.onAnalysisChange}
          availableNodes={props.availableNodes}
          onAddProbeNode={props.onAddProbeNode}
          onRemoveProbeNode={props.onRemoveProbeNode}
          onRun={props.onRun}
          running={props.running}
        />
        <div className="formRow" style={{ marginTop: 8 }}>
          <label>Preset</label>
          <select
            className="select"
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) props.onLoadPreset(e.target.value);
              e.currentTarget.value = "";
            }}
          >
            <option value="" disabled>
              Load preset…
            </option>
            {props.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Hierarchy" defaultOpen>
        <HierarchyTree
          levels={props.levels}
          activeLevelId={props.activeLevelId}
          onSelect={props.onSelectLevel}
          onAdd={props.onAddLevel}
          onRename={props.onRenameLevel}
          onDelete={props.onDeleteLevel}
        />
      </CollapsibleSection>

      <CollapsibleSection title="Visualization">
        <div className="hintText">
          Each simulation opens a plot tile you can drag and resize. Probe mode
          lets you hover a pin and click it to stream a live scope tile (.dyn mode).
        </div>
        <div className="formRow" style={{ marginTop: 10 }}>
          <label>Net preview</label>
        </div>
        <pre className="miniPreview">{props.generatedNetlist || props.netlistPreview}</pre>
      </CollapsibleSection>

      <CollapsibleSection title="Library">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {props.libraryComponents.map((t) => (
            <LibItem key={t} type={t} onClick={() => props.onStartDrag(t)} />
          ))}
          <div className="hintText">
            Click a library item then click in the canvas to place it.
          </div>
        </div>
      </CollapsibleSection>

      {props.selectedComponent ? (
        <CollapsibleSection title={`Properties — ${props.selectedComponent.name}`} defaultOpen>
          <PropertyEditor
            component={props.selectedComponent}
            levels={props.levels}
            onUpdate={(patch) => props.onUpdateComponent(props.selectedComponent!.id, patch)}
          />
        </CollapsibleSection>
      ) : null}
    </aside>
  );
}

function parseMetric(raw: string): number {
  if (!raw) return NaN;
  const m = raw.trim().match(/^([-+]?[0-9]*\.?[0-9]+)([a-zA-Zµ]*)$/);
  if (!m) return Number(raw);
  const base = Number(m[1]);
  const suf = (m[2] || "").toLowerCase();
  const table: Record<string, number> = {
    "": 1,
    f: 1e-15,
    p: 1e-12,
    n: 1e-9,
    u: 1e-6,
    µ: 1e-6,
    m: 1e-3,
    k: 1e3,
    meg: 1e6,
    g: 1e9
  };
  return suf in table ? base * table[suf] : base;
}

function estimateWallDuration(tStop: string, dynSpeed: string): string {
  const t = parseMetric(tStop);
  const s = parseMetric(dynSpeed);
  if (!isFinite(t) || !isFinite(s) || s <= 0) return "–";
  const wall = t / s;
  if (wall >= 60) return `${wall.toFixed(0)}`;
  if (wall >= 1) return `${wall.toFixed(1)}`;
  return `${wall.toFixed(2)}`;
}

function CollapsibleSection({
  title,
  defaultOpen,
  children
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className={`section ${open ? "" : "collapsed"}`}>
      <div className="section__header" onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="chev">▾</span>
      </div>
      <div className="section__body">{children}</div>
    </div>
  );
}

function SimulationControls({
  analysis,
  onAnalysisChange,
  availableNodes,
  onAddProbeNode,
  onRemoveProbeNode,
  onRun,
  running
}: {
  analysis: AnalysisState;
  onAnalysisChange: (patch: Partial<AnalysisState>) => void;
  availableNodes: string[];
  onAddProbeNode: (label: string) => void;
  onRemoveProbeNode: (label: string) => void;
  onRun: () => void;
  running: boolean;
}) {
  const modeOptions: { value: BasicAnalysisMode; label: string }[] = [
    { value: "op", label: ".op" },
    { value: "tran", label: ".tran" },
    { value: "ac", label: ".ac" },
    { value: "hb", label: ".hb" }
  ];
  return (
    <>
      <div className="formRow">
        <label>Mode</label>
        <select
          className="select"
          value={analysis.mode}
          onChange={(e) => onAnalysisChange({ mode: e.target.value as BasicAnalysisMode })}
        >
          {modeOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {analysis.mode === "tran" && (
        <>
          <div className="formRow">
            <label>t_stop</label>
            <input
              className="input"
              value={analysis.tStop}
              onChange={(e) => onAnalysisChange({ tStop: e.target.value })}
            />
          </div>
          <div className="formRow">
            <label>t_step</label>
            <input
              className="input"
              value={analysis.tStep}
              onChange={(e) => onAnalysisChange({ tStep: e.target.value })}
            />
          </div>
        </>
      )}

      {analysis.mode === "ac" && (
        <>
          <div className="formRow">
            <label>f_start</label>
            <input
              className="input"
              value={analysis.fStart}
              onChange={(e) => onAnalysisChange({ fStart: e.target.value })}
            />
          </div>
          <div className="formRow">
            <label>f_stop</label>
            <input
              className="input"
              value={analysis.fStop}
              onChange={(e) => onAnalysisChange({ fStop: e.target.value })}
            />
          </div>
          <div className="formRow">
            <label>points</label>
            <input
              className="input"
              type="number"
              value={analysis.points}
              onChange={(e) => onAnalysisChange({ points: Number(e.target.value) })}
            />
          </div>
        </>
      )}

      {analysis.mode === "hb" && (
        <>
          <div className="formRow">
            <label>harmonics</label>
            <input
              className="input"
              type="number"
              min={1}
              value={analysis.harmonics}
              onChange={(e) => onAnalysisChange({ harmonics: Number(e.target.value) })}
            />
          </div>
          <div className="formRow">
            <label>window</label>
            <input
              className="input"
              value={analysis.hbTimeWindow}
              onChange={(e) => onAnalysisChange({ hbTimeWindow: e.target.value })}
              placeholder="spectrum"
            />
          </div>
        </>
      )}

      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: "1px solid var(--border-subtle, rgba(255,255,255,0.08))"
        }}
      >
        <div className="hintText" style={{ marginBottom: 6 }}>
          Dynamic probe — click the probe icon, then click a pin.
        </div>
        <div className="formRow">
          <label title="Simulation seconds per real-time second. e.g. 1m = 1ms of sim per 1 s of wall time.">
            speed (s/s)
          </label>
          <input
            className="input"
            value={analysis.dynSpeed}
            onChange={(e) => onAnalysisChange({ dynSpeed: e.target.value })}
          />
        </div>
        <div className="formRow">
          <label title="Sliding window of sim-time kept on screen. e.g. 5m = newest 5 ms of samples, older points are discarded so the plot doesn't accumulate.">
            window
          </label>
          <input
            className="input"
            value={analysis.dynWindow}
            onChange={(e) => onAnalysisChange({ dynWindow: e.target.value })}
            placeholder="5m"
          />
        </div>
        <div className="formRow">
          <label title="When checked, the probe stream loops forever. When unchecked, it runs for tran duration ÷ speed wall-seconds.">
            continuous
          </label>
          <input
            type="checkbox"
            checked={analysis.continuous}
            onChange={(e) => onAnalysisChange({ continuous: e.target.checked })}
          />
        </div>
        <div className="hintText" style={{ marginTop: 4 }}>
          {analysis.continuous
            ? `Infinite stream — only the most recent ${analysis.dynWindow}s of sim time is shown.`
            : `Finite stream: t_stop ÷ speed ≈ ${estimateWallDuration(analysis.tStop, analysis.dynSpeed)} s wall.`}
        </div>
      </div>

      <div className="formRow" style={{ flexDirection: "column", alignItems: "stretch" }}>
        <label style={{ marginBottom: 6 }}>Display nodes</label>
        <div style={{ display: "flex", flexWrap: "wrap" }}>
          {analysis.probeNodes.length === 0 ? (
            <span className="hintText" style={{ marginLeft: 0 }}>
              Empty = show all.
            </span>
          ) : (
            analysis.probeNodes.map((n) => (
              <span key={n} className="tag">
                {n}
                <button onClick={() => onRemoveProbeNode(n)} aria-label="Remove">
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <select
          className="select"
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAddProbeNode(e.target.value);
            e.currentTarget.value = "";
          }}
          style={{ marginTop: 6 }}
        >
          <option value="" disabled>
            Add node…
          </option>
          {availableNodes
            .filter((n) => !analysis.probeNodes.includes(n))
            .map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
        </select>
      </div>

      <button className="runBtn" disabled={running} onClick={onRun} style={{ marginTop: 6 }}>
        {running ? "Running…" : `Run ${analysis.mode}`}
      </button>
    </>
  );
}

function HierarchyTree({
  levels,
  activeLevelId,
  onSelect,
  onAdd,
  onRename,
  onDelete
}: {
  levels: SchematicLevel[];
  activeLevelId: string;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
}) {
  const roots = levels.filter((l) => l.parentId === null);
  return (
    <div className="tree">
      {roots.map((root) => (
        <LevelBranch
          key={root.id}
          level={root}
          depth={0}
          levels={levels}
          activeId={activeLevelId}
          onSelect={onSelect}
          onAdd={onAdd}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
      <button className="ghostBtn" style={{ marginTop: 8 }} onClick={() => onAdd(null)}>
        + New top-level
      </button>
    </div>
  );
}

function LevelBranch({
  level,
  depth,
  levels,
  activeId,
  onSelect,
  onAdd,
  onRename,
  onDelete
}: {
  level: SchematicLevel;
  depth: number;
  levels: SchematicLevel[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onRename: (id: string, newTitle: string) => void;
  onDelete: (id: string) => void;
}) {
  const children = levels.filter((l) => l.parentId === level.id);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(level.title);
  return (
    <>
      <div
        className={`treeItem ${activeId === level.id ? "active" : ""}`}
        onClick={() => onSelect(level.id)}
        onDoubleClick={() => setRenaming(true)}
      >
        <span className="treeItem__depth" style={{ width: 8 + depth * 12 }} />
        <span className="treeItem__chev">{children.length ? "▾" : "•"}</span>
        {renaming ? (
          <input
            className="input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(level.id, draft || level.title);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                onRename(level.id, draft || level.title);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span>{level.title}</span>
        )}
        <span
          className="treeItem__add"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(level.id);
          }}
        >
          +sub
        </span>
        <span
          className="treeItem__add"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(level.id);
          }}
          title="Delete this level (children are also removed)"
        >
          ×
        </span>
      </div>
      {children.map((c) => (
        <LevelBranch
          key={c.id}
          level={c}
          depth={depth + 1}
          levels={levels}
          activeId={activeId}
          onSelect={onSelect}
          onAdd={onAdd}
          onRename={onRename}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function LibItem({ type, onClick }: { type: DeviceType; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const size = 30;
    c.width = size * ratio;
    c.height = size * ratio;
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.scale(0.3, 0.3);
    drawPalettePreview(ctx, type);
  }, [type]);
  return (
    <div className="libItem" onClick={onClick}>
      <canvas ref={ref} />
      <span>{DEVICE_LABELS[type]}</span>
    </div>
  );
}

function PropertyEditor({
  component,
  levels,
  onUpdate
}: {
  component: CanvasComponent;
  levels: SchematicLevel[];
  onUpdate: (patch: Partial<CanvasComponent>) => void;
}) {
  const isSource = component.type === "V" || component.type === "I";
  const isControlled = component.type === "VCVS" || component.type === "VCCS";
  const isCurrentControlled = component.type === "CCCS" || component.type === "CCVS";
  const isBjt = component.type === "QNPN" || component.type === "QPNP";
  const isMos = component.type === "NMOS" || component.type === "PMOS";
  const isSubckt = component.type === "SUBCKT";
  const isLabel = component.type === "LABEL";
  const isNode = component.type === "NODE";
  const updateMetadata = (key: string, value: string) =>
    onUpdate({ metadata: { ...(component.metadata ?? {}), [key]: value } });
  const updatePinCount = (count: number) => {
    const safeCount = Math.max(1, Math.min(24, count || 1));
    const current = component.pins ?? [];
    const pins = Array.from({ length: safeCount }, (_, i) => current[i] ?? `node_${i + 1}`);
    onUpdate({ pins });
  };
  const updatePinName = (index: number, value: string) => {
    const pins = [...(component.pins ?? [])];
    pins[index] = value.trim() || `node_${index + 1}`;
    onUpdate({ pins });
  };
  return (
    <>
      <div className="formRow">
        <label>{isSubckt ? "displayed_name" : isLabel ? "text" : isNode ? "node" : "Name"}</label>
        <input
          className="input"
          value={component.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
        />
      </div>
      {isSubckt ? (
        <>
          <div className="formRow">
            <label>entity_name</label>
            <select
              className="select"
              value={component.subcircuitId ?? ""}
              onChange={(e) => {
                const entity = levels.find((level) => level.id === e.target.value);
                onUpdate({
                  subcircuitId: e.target.value,
                  pins: entity?.pins?.length ? [...entity.pins] : component.pins
                });
              }}
            >
              <option value="">Unlinked</option>
              {levels
                .filter((level) => level.parentId !== null)
                .map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.title}
                  </option>
                ))}
            </select>
          </div>
          <div className="formRow">
            <label>nodes</label>
            <input
              className="input"
              type="number"
              min={1}
              max={24}
              value={(component.pins ?? []).length}
              onChange={(e) => updatePinCount(Number(e.target.value))}
            />
          </div>
          {(component.pins ?? []).map((pin, index) => (
            <div className="formRow" key={`${component.id}-pin-${index}`}>
              <label>{`node ${index + 1}`}</label>
              <input
                className="input"
                value={pin}
                onChange={(e) => updatePinName(index, e.target.value)}
              />
            </div>
          ))}
        </>
      ) : null}
      {isNode ? (
        <div className="hintText">
          Same-named Node markers are electrically connected. In a sub-entity, a node named in_1 exposes port_in_1 to matching SUBCKT pins.
        </div>
      ) : null}
      {component.type !== "GND" && !isBjt && !isMos && !isSubckt && !isNode && !isLabel ? (
        <div className="formRow">
          <label>Value</label>
          <input
            className="input"
            value={component.value}
            onChange={(e) => onUpdate({ value: e.target.value })}
          />
        </div>
      ) : null}
      {isBjt ? (
        <>
          <div className="formRow">
            <label>gm</label>
            <input className="input" value={component.value} onChange={(e) => onUpdate({ value: e.target.value })} />
          </div>
          <div className="formRow">
            <label>rπ</label>
            <input className="input" value={component.value2 ?? ""} onChange={(e) => onUpdate({ value2: e.target.value })} />
          </div>
          <div className="formRow">
            <label>ro</label>
            <input className="input" value={component.value3 ?? ""} onChange={(e) => onUpdate({ value3: e.target.value })} />
          </div>
          <div className="formRow">
            <label>Cπ</label>
            <input className="input" value={component.metadata?.cpi ?? ""} onChange={(e) => updateMetadata("cpi", e.target.value)} />
          </div>
          <div className="formRow">
            <label>Cμ</label>
            <input className="input" value={component.metadata?.cmu ?? ""} onChange={(e) => updateMetadata("cmu", e.target.value)} />
          </div>
          <div className="formRow">
            <label>Ccs</label>
            <input className="input" value={component.metadata?.ccs ?? "0"} onChange={(e) => updateMetadata("ccs", e.target.value)} />
          </div>
        </>
      ) : null}
      {isMos ? (
        <>
          <div className="formRow">
            <label>gm</label>
            <input className="input" value={component.value} onChange={(e) => onUpdate({ value: e.target.value })} />
          </div>
          <div className="formRow">
            <label>ro</label>
            <input className="input" value={component.value2 ?? ""} onChange={(e) => onUpdate({ value2: e.target.value })} />
          </div>
          <div className="formRow">
            <label>Cgs</label>
            <input className="input" value={component.value3 ?? ""} onChange={(e) => onUpdate({ value3: e.target.value })} />
          </div>
          <div className="formRow">
            <label>Cgd</label>
            <input className="input" value={component.metadata?.cgd ?? ""} onChange={(e) => updateMetadata("cgd", e.target.value)} />
          </div>
          <div className="formRow">
            <label>gmb</label>
            <input className="input" value={component.metadata?.gmb ?? "0"} onChange={(e) => updateMetadata("gmb", e.target.value)} />
          </div>
          <div className="formRow">
            <label>Cbs</label>
            <input className="input" value={component.metadata?.cbs ?? "0"} onChange={(e) => updateMetadata("cbs", e.target.value)} />
          </div>
          <div className="formRow">
            <label>Cbd</label>
            <input className="input" value={component.metadata?.cbd ?? "0"} onChange={(e) => updateMetadata("cbd", e.target.value)} />
          </div>
        </>
      ) : null}
      {isSource ? (
        <>
          <div className="formRow">
            <label>Subtype</label>
            <select
              className="select"
              value={component.subtype ?? "DC"}
              onChange={(e) => onUpdate({ subtype: e.target.value })}
            >
              <option value="DC">DC</option>
              <option value="AC">AC</option>
              <option value="SIN">SIN</option>
              <option value="COS">COS</option>
              <option value="STEP">STEP</option>
              <option value="FUNC">FUNC</option>
            </select>
          </div>
          {(component.subtype === "SIN" ||
            component.subtype === "COS" ||
            component.subtype === "STEP" ||
            component.subtype === "FUNC") && (
            <div className="formRow">
              <label>
                {component.subtype === "FUNC" ? "expr" : component.subtype === "STEP" ? "t_on" : "freq"}
              </label>
              <input
                className="input"
                value={component.value2 ?? ""}
                onChange={(e) => onUpdate({ value2: e.target.value })}
              />
            </div>
          )}
        </>
      ) : null}
      {isControlled ? (
        <>
          <div className="formRow">
            <label>ctrl n+</label>
            <input
              className="input"
              value={component.ctrlNode1 ?? ""}
              onChange={(e) => onUpdate({ ctrlNode1: e.target.value })}
            />
          </div>
          <div className="formRow">
            <label>ctrl n-</label>
            <input
              className="input"
              value={component.ctrlNode2 ?? ""}
              onChange={(e) => onUpdate({ ctrlNode2: e.target.value })}
            />
          </div>
        </>
      ) : null}
      {isCurrentControlled ? (
        <div className="formRow">
          <label>ctrl src</label>
          <input
            className="input"
            value={component.ctrlSource ?? ""}
            placeholder="V1"
            onChange={(e) => onUpdate({ ctrlSource: e.target.value })}
          />
        </div>
      ) : null}
      <div className="formRow">
        <label>Rotation</label>
        <select
          className="select"
          value={component.rotation}
          onChange={(e) => onUpdate({ rotation: Number(e.target.value) as CanvasComponent["rotation"] })}
        >
          <option value={0}>0°</option>
          <option value={90}>90°</option>
          <option value={180}>180°</option>
          <option value={270}>270°</option>
        </select>
      </div>
    </>
  );
}
