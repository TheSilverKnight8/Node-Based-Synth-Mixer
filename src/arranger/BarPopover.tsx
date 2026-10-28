import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { METERS, type Timeline } from '../lib/music';
import type { Beats, Project } from '../lib/types';
import { IconButton, Segmented } from '../components/ui';
import { BpmInput } from './TransportBar';

/** Set the time signature or tempo from a bar on. Changes always start on a bar line. */
export function BarPopover({
  bar,
  x,
  top,
  timeline,
  update,
  onClose,
}: {
  bar: number;
  x: number;
  top: number;
  timeline: Timeline;
  update: (fn: (p: Project) => Project) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const meterHere = timeline.meters.find((m) => m.bar === bar);
  const tempoHere = timeline.tempos.find((t) => t.bar === bar);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const setBeats = (beats: Beats) =>
    update((p) => {
      const others = p.meters.filter((m) => m.bar !== bar);
      // Choosing what the bar before already has removes the change instead of repeating it.
      const before = beatsBefore(others, bar);
      return { ...p, meters: bar > 0 && before === beats ? others : [...others, { bar, beats }].sort((a, b) => a.bar - b.bar) };
    });
  const setBpm = (bpm: number) => update((p) => ({ ...p, tempos: [...p.tempos.filter((t) => t.bar !== bar), { bar, bpm }].sort((a, b) => a.bar - b.bar) }));
  const clearMeter = () => update((p) => ({ ...p, meters: p.meters.filter((m) => m.bar !== bar) }));
  const clearTempo = () => update((p) => ({ ...p, tempos: p.tempos.filter((t) => t.bar !== bar) }));

  return (
    <div ref={box} className="fixed z-40 w-72 animate-rise rounded-2xl border border-line bg-surface p-4 shadow-pop" style={{ left: Math.min(x, window.innerWidth - 300), top }}>
      <div className="flex items-center justify-between">
        <h3 className="text-xl">From bar {bar + 1}</h3>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>
      <p className="mt-3 text-xs font-medium text-muted">Time signature</p>
      <div className="mt-1 flex items-center gap-2">
        <Segmented size="sm" value={String(timeline.beatsInBar(bar))} onChange={(v) => setBeats(Number(v) as Beats)} options={METERS.map((m) => ({ value: String(m), label: `${m}/4` }))} />
        {meterHere && bar > 0 && (
          <button className="text-xs text-accent underline-offset-2 hover:underline" onClick={clearMeter}>
            Remove change
          </button>
        )}
      </div>
      <p className="mt-4 text-xs font-medium text-muted">Tempo</p>
      <div className="mt-1 flex items-center gap-2">
        <BpmInput value={timeline.bpmAtBar(bar)} onChange={setBpm} />
        <span className="text-xs text-muted">BPM</span>
        {tempoHere && bar > 0 && (
          <button className="text-xs text-accent underline-offset-2 hover:underline" onClick={clearTempo}>
            Remove change
          </button>
        )}
      </div>
      <p className="mt-3 text-[0.6875rem] leading-snug text-muted">Notes keep their place in time when a time signature changes, so bar lines after the change move.</p>
    </div>
  );
}

/** The time signature in force just before a bar, from a list of changes. */
function beatsBefore(meters: { bar: number; beats: Beats }[], bar: number): Beats {
  let beats: Beats = 4;
  for (const m of [...meters].sort((a, b) => a.bar - b.bar)) if (m.bar < bar) beats = m.beats;
  return beats;
}
