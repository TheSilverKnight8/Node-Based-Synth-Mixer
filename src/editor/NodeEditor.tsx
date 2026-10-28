import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { notify } from '../components/dialogs';
import { Button, cx } from '../components/ui';
import { engine } from '../lib/audio/engine';
import { canConnect, connect, createNode, hasCableInto, patchWarnings } from '../lib/audio/graph';
import { ADDABLE, MODULES, findPort, paramValue, type PortDef } from '../lib/audio/modules';
import { updateInstrument } from '../lib/store';
import type { Instrument, ModuleNode, ParamValue, PortKind, PortRef } from '../lib/types';
import { ParamControl } from './ParamControl';

// Layout of a module box, in pixels. Ports sit at fixed heights so cables can be drawn without measuring the page.
const W = 200;
const HEADER = 34;
const PAD = 6;
const ROW = 26;

/** Navy carries sound and pitch; red carries control signals. Rings (pitch, gate) say "this is a note signal". */
export const KIND_STYLE: Record<PortKind, { color: string; ring: boolean; dash?: string; label: string }> = {
  audio: { color: 'var(--navy)', ring: false, label: 'Sound' },
  pitch: { color: 'var(--navy)', ring: true, dash: '6 4', label: 'Pitch' },
  gate: { color: 'var(--accent)', ring: true, dash: '6 4', label: 'Gate' },
  mod: { color: 'var(--accent)', ring: false, label: 'Control (mod)' },
};

function portPoint(n: ModuleNode, dir: 'in' | 'out', port: string) {
  const def = MODULES[n.type];
  const list = dir === 'in' ? def.inputs : def.outputs;
  const i = Math.max(0, list.findIndex((p) => p.id === port));
  return { x: n.x + (dir === 'in' ? 0 : W), y: n.y + HEADER + PAD + i * ROW + ROW / 2 };
}

function cablePath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

interface CableDrag {
  /** The end that is already plugged in. */
  fixed: PortRef & { dir: 'in' | 'out' };
  kind: PortKind;
  x: number;
  y: number;
}

export function NodeEditor({ inst }: { inst: Instrument }) {
  const canvas = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<CableDrag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const byId = useMemo(() => new Map(inst.nodes.map((n) => [n.id, n])), [inst.nodes]);
  const warnings = useMemo(() => patchWarnings(inst), [inst]);
  const update = (fn: (i: Instrument) => Instrument) => updateInstrument(inst.id, fn);

  const width = Math.max(...inst.nodes.map((n) => n.x + W + 320), 1600);
  const height = Math.max(...inst.nodes.map((n) => n.y + 520), 900);

  const toCanvas = (clientX: number, clientY: number) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  // Delete a selected cable from the keyboard.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        update((i) => ({ ...i, cables: i.cables.filter((c) => c.id !== selected) }));
        setSelected(null);
      }
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const setParam = (nodeId: string, key: string, value: ParamValue) => {
    update((i) => ({ ...i, nodes: i.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [key]: value } } : n)) }));
    engine.update(inst.id, nodeId, key, value);
  };

  const addModule = (type: (typeof ADDABLE)[number]) => {
    const s = scroller.current!;
    // Near the middle of what is on screen, nudged so new modules do not stack exactly.
    const nudge = (inst.nodes.length % 5) * 24;
    const x = Math.round(s.scrollLeft + s.clientWidth / 2 - W / 2 + nudge);
    const y = Math.round(s.scrollTop + s.clientHeight / 3 + nudge);
    update((i) => ({ ...i, nodes: [...i.nodes, createNode(type, Math.max(0, x), Math.max(0, y))] }));
  };

  const removeModule = (id: string) => {
    update((i) => ({ ...i, nodes: i.nodes.filter((n) => n.id !== id), cables: i.cables.filter((c) => c.from.node !== id && c.to.node !== id) }));
  };

  // ---- moving modules
  const startMove = (e: React.PointerEvent, n: ModuleNode) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const start = { px: e.clientX, py: e.clientY, x: n.x, y: n.y };
    const move = (ev: PointerEvent) => {
      const x = Math.max(0, Math.round((start.x + ev.clientX - start.px) / 8) * 8);
      const y = Math.max(0, Math.round((start.y + ev.clientY - start.py) / 8) * 8);
      update((i) => ({ ...i, nodes: i.nodes.map((m) => (m.id === n.id ? (m.x === x && m.y === y ? m : { ...m, x, y }) : m)) }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- cables
  const startCable = (e: React.PointerEvent, n: ModuleNode, port: PortDef, dir: 'in' | 'out') => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(null);
    let fixed: CableDrag['fixed'] = { node: n.id, port: port.id, dir };
    let kind = port.kind;
    if (dir === 'in') {
      // Grabbing a plugged-in input picks up its cable, to move it somewhere else or drop it to unplug.
      const existing = [...inst.cables].reverse().find((c) => c.to.node === n.id && c.to.port === port.id);
      if (existing) {
        update((i) => ({ ...i, cables: i.cables.filter((c) => c.id !== existing.id) }));
        const src = byId.get(existing.from.node)!;
        fixed = { ...existing.from, dir: 'out' };
        kind = findPort(src.type, 'out', existing.from.port)?.kind ?? kind;
      }
    }
    const p = toCanvas(e.clientX, e.clientY);
    setDrag({ fixed, kind, ...p });

    const move = (ev: PointerEvent) => setDrag((d) => (d ? { ...d, ...toCanvas(ev.clientX, ev.clientY) } : d));
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-port]');
      if (!el) return;
      const target = { node: el.dataset.node!, port: el.dataset.port!, dir: el.dataset.dir as 'in' | 'out' };
      if (target.dir === fixed.dir) {
        if (target.node !== fixed.node || target.port !== fixed.port) notify(fixed.dir === 'out' ? 'Outputs connect to inputs (the left side of a module), not to other outputs.' : 'Inputs connect to outputs (the right side of a module), not to other inputs.', 'warn');
        return;
      }
      const from = fixed.dir === 'out' ? fixed : target;
      const to = fixed.dir === 'out' ? target : fixed;
      updateInstrument(inst.id, (i) => {
        const r = connect(i, { node: from.node, port: from.port }, { node: to.node, port: to.port });
        if (!r.result.ok) notify(r.result.reason, 'warn');
        return r.inst;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** While dragging a cable: can this socket take it? */
  const fits = (n: ModuleNode, port: string, dir: 'in' | 'out') => {
    if (!drag || dir === drag.fixed.dir) return null;
    const from = drag.fixed.dir === 'out' ? drag.fixed : { node: n.id, port };
    const to = drag.fixed.dir === 'out' ? { node: n.id, port } : drag.fixed;
    return canConnect(inst, from, to).ok;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-4 py-2">
        <span className="label-caps mr-1 text-muted">Add</span>
        {ADDABLE.map((t) => (
          <Button key={t} size="xs" onClick={() => addModule(t)} title={MODULES[t].blurb}>
            <Plus className="size-3.5" />
            {MODULES[t].label}
          </Button>
        ))}
        <div className="flex-1" />
        <Legend />
      </div>

      {warnings.length > 0 && (
        <div className="flex flex-col gap-1 border-b border-warn/30 bg-warn/8 px-4 py-2 text-sm text-warn">
          {warnings.map((w) => (
            <div key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      <div ref={scroller} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto bg-bg" onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}>
        <div
          ref={canvas}
          className="relative"
          style={{
            width,
            height,
            backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--navy) 16%, transparent) 1px, transparent 1.2px)',
            backgroundSize: '24px 24px',
          }}
          onPointerDown={(e) => e.target === e.currentTarget && setSelected(null)}
        >
          <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
            {inst.cables.map((c) => {
              const a = byId.get(c.from.node);
              const b = byId.get(c.to.node);
              if (!a || !b) return null;
              const p1 = portPoint(a, 'out', c.from.port);
              const p2 = portPoint(b, 'in', c.to.port);
              const kind = findPort(a.type, 'out', c.from.port)?.kind ?? 'audio';
              const style = KIND_STYLE[kind];
              const d = cablePath(p1.x, p1.y, p2.x, p2.y);
              const on = selected === c.id;
              return (
                <g key={c.id}>
                  <path
                    d={d}
                    stroke="transparent"
                    strokeWidth={14}
                    fill="none"
                    className="pointer-events-auto cursor-pointer"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setSelected(c.id);
                    }}
                  >
                    <title>Click to select, then press Delete to remove</title>
                  </path>
                  <path d={d} stroke={style.color} strokeWidth={on ? 4.5 : 2.5} strokeDasharray={style.dash} strokeLinecap="round" fill="none" opacity={on ? 1 : 0.9} />
                </g>
              );
            })}
            {drag &&
              (() => {
                const n = byId.get(drag.fixed.node);
                if (!n) return null;
                const p = portPoint(n, drag.fixed.dir, drag.fixed.port);
                const style = KIND_STYLE[drag.kind];
                const d = drag.fixed.dir === 'out' ? cablePath(p.x, p.y, drag.x, drag.y) : cablePath(drag.x, drag.y, p.x, p.y);
                return <path d={d} stroke={style.color} strokeWidth={2.5} strokeDasharray={style.dash ?? '2 5'} strokeLinecap="round" fill="none" />;
              })()}
          </svg>

          {selected &&
            (() => {
              const c = inst.cables.find((x) => x.id === selected);
              const a = c && byId.get(c.from.node);
              const b = c && byId.get(c.to.node);
              if (!c || !a || !b) return null;
              const p1 = portPoint(a, 'out', c.from.port);
              const p2 = portPoint(b, 'in', c.to.port);
              return (
                <button
                  className="absolute z-20 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-on-accent shadow-pop"
                  style={{ left: (p1.x + p2.x) / 2, top: (p1.y + p2.y) / 2 }}
                  aria-label="Remove cable"
                  title="Remove cable"
                  onClick={() => {
                    update((i) => ({ ...i, cables: i.cables.filter((x) => x.id !== selected) }));
                    setSelected(null);
                  }}
                >
                  <X className="size-3.5" />
                </button>
              );
            })()}

          {inst.nodes.map((n) => (
            <ModuleBox key={n.id} n={n} inst={inst} onMove={startMove} onCable={startCable} onParam={setParam} onRemove={removeModule} fits={fits} dragging={!!drag} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ModuleBox({
  n,
  inst,
  onMove,
  onCable,
  onParam,
  onRemove,
  fits,
  dragging,
}: {
  n: ModuleNode;
  inst: Instrument;
  onMove: (e: React.PointerEvent, n: ModuleNode) => void;
  onCable: (e: React.PointerEvent, n: ModuleNode, port: PortDef, dir: 'in' | 'out') => void;
  onParam: (nodeId: string, key: string, value: ParamValue) => void;
  onRemove: (id: string) => void;
  fits: (n: ModuleNode, port: string, dir: 'in' | 'out') => boolean | null;
  dragging: boolean;
}) {
  const def = MODULES[n.type];
  const rows = Math.max(def.inputs.length, def.outputs.length);
  const pitched = n.type === 'osc' && hasCableInto(inst, n.id, 'pitch');

  const socket = (p: PortDef, dir: 'in' | 'out', i: number) => {
    const style = KIND_STYLE[p.kind];
    const ok = fits(n, p.id, dir);
    const plugged = dir === 'in' ? hasCableInto(inst, n.id, p.id) : inst.cables.some((c) => c.from.node === n.id && c.from.port === p.id);
    return (
      <div key={p.id} className={cx('absolute flex items-center gap-1.5 text-xs', dir === 'in' ? 'left-0 pl-3' : 'right-0 flex-row-reverse pr-3')} style={{ top: PAD + i * ROW, height: ROW }}>
        <span
          data-port={p.id}
          data-node={n.id}
          data-dir={dir}
          role="button"
          aria-label={`${def.label} ${p.label} ${dir === 'in' ? 'input' : 'output'}`}
          title={`${p.label}: ${style.label}`}
          onPointerDown={(e) => onCable(e, n, p, dir)}
          className={cx(
            'absolute top-1/2 size-3.5 -translate-y-1/2 cursor-crosshair rounded-full border-2 transition',
            dir === 'in' ? '-left-[7px]' : '-right-[7px]',
            ok === true && 'scale-150 ring-4 ring-navy/20',
            ok === false && 'opacity-25',
          )}
          style={{ borderColor: style.color, background: style.ring && !plugged ? 'var(--surface)' : style.color }}
        />
        <span className={cx('whitespace-nowrap', plugged ? 'text-ink' : 'text-muted')}>{p.label}</span>
      </div>
    );
  };

  return (
    <div
      className={cx('absolute rounded-xl border bg-surface shadow-card', def.fixed ? 'border-navy/50' : 'border-line', dragging && 'select-none')}
      style={{ left: n.x, top: n.y, width: W }}
      data-module={n.type}
    >
      <div
        className={cx('flex cursor-grab items-center justify-between rounded-t-xl px-3 active:cursor-grabbing', def.fixed ? 'bg-navy text-on-accent' : 'bg-raised text-ink')}
        style={{ height: HEADER }}
        onPointerDown={(e) => onMove(e, n)}
        title={def.blurb}
      >
        <span className="font-display text-[0.9375rem] uppercase tracking-[0.06em]">{def.label}</span>
        {!def.fixed && (
          <button className="rounded p-0.5 opacity-60 hover:bg-surface hover:opacity-100" aria-label={`Remove ${def.label}`} title="Remove module" onClick={() => onRemove(n.id)}>
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div className="relative" style={{ height: rows * ROW + PAD * 2 }}>
        {def.inputs.map((p, i) => socket(p, 'in', i))}
        {def.outputs.map((p, i) => socket(p, 'out', i))}
      </div>
      {def.params.length > 0 && (
        <div className="space-y-2 border-t border-line px-3 pb-3 pt-2">
          {def.params.map((p) => (
            <ParamControl
              key={p.key}
              def={p}
              value={paramValue(n, p.key)}
              onChange={(v) => onParam(n.id, p.key, v)}
              disabled={p.key === 'freq' && pitched}
              hint={p.key === 'freq' && pitched ? 'The Pitch cable sets the frequency. This is used when nothing is plugged into Pitch.' : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-3 text-[0.6875rem] text-muted">
      {(Object.keys(KIND_STYLE) as PortKind[]).map((k) => {
        const s = KIND_STYLE[k];
        return (
          <span key={k} className="flex items-center gap-1">
            <svg width="22" height="8" aria-hidden>
              <line x1="1" y1="4" x2="21" y2="4" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinecap="round" />
            </svg>
            {s.label}
          </span>
        );
      })}
    </div>
  );
}
