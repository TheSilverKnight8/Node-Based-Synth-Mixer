import type { ParamDef } from '../lib/audio/modules';
import type { ParamValue } from '../lib/types';
import { Segmented, cx } from '../components/ui';

const STEPS = 1000;

function toSlider(def: Extract<ParamDef, { type: 'number' }>, v: number) {
  const t = def.scale === 'log' ? Math.log(v / def.min) / Math.log(def.max / def.min) : (v - def.min) / (def.max - def.min);
  return Math.round(Math.min(1, Math.max(0, t)) * STEPS);
}

function fromSlider(def: Extract<ParamDef, { type: 'number' }>, s: number) {
  const t = s / STEPS;
  let v = def.scale === 'log' ? def.min * (def.max / def.min) ** t : def.min + t * (def.max - def.min);
  if (def.step) v = Math.round(v / def.step) * def.step;
  // Round log values to a sensible number of figures so files stay readable.
  else v = Number(v.toPrecision(4));
  return Math.min(def.max, Math.max(def.min, v));
}

export function formatValue(def: Extract<ParamDef, { type: 'number' }>, v: number) {
  if (def.unit === 'Hz' && v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz`;
  if (def.unit === 's' && v < 1) return `${Math.round(v * 1000)} ms`;
  const digits = def.digits ?? (def.unit === 'Hz' ? (v < 100 ? 1 : 0) : 0);
  const text = v.toFixed(digits);
  const signed = (def.unit === 'st' || def.unit === 'ct' || def.unit === 'oct') && v > 0 ? `+${text}` : text;
  return def.unit ? `${signed} ${def.unit}` : signed;
}

export function ParamControl({ def, value, onChange, disabled, hint }: { def: ParamDef; value: ParamValue; onChange: (v: ParamValue) => void; disabled?: boolean; hint?: string }) {
  if (def.type === 'choice') {
    return (
      <div className={cx('space-y-1', disabled && 'opacity-50')}>
        <div className="text-[0.6875rem] font-medium text-muted">{def.label}</div>
        <Segmented size="xs" className="flex w-full" value={String(value)} onChange={(v) => onChange(v)} options={def.options} />
      </div>
    );
  }
  const v = typeof value === 'number' ? value : Number(value);
  const pos = toSlider(def, v);
  return (
    <label className={cx('block', disabled && 'opacity-45')} title={hint ?? 'Double-click to reset'}>
      <div className="flex items-baseline justify-between gap-2 text-[0.6875rem]">
        <span className="font-medium text-muted">{def.label}</span>
        <span className="font-mono text-ink">{formatValue(def, v)}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={0}
        max={STEPS}
        value={pos}
        disabled={disabled}
        style={{ '--fill': `${(pos / STEPS) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(fromSlider(def, Number(e.target.value)))}
        onDoubleClick={() => onChange(def.default)}
        aria-label={def.label}
        aria-valuetext={formatValue(def, v)}
      />
      {hint && disabled && <div className="text-[0.625rem] leading-tight text-muted">{hint}</div>}
    </label>
  );
}
