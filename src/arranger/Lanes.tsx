import { useRef, useState, type RefObject } from 'react';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { clipLength } from '../lib/audio/events';
import { TAG_SHORT, tagProblem } from '../lib/audio/tags';
import type { Clip, ClipPlacement, Instrument, Project, Track } from '../lib/types';
import { IconButton, cx } from '../components/ui';
import { HEAD_W, LANE_H, RULER_H, type View } from './layout';

export interface PlacementSel {
  trackId: string;
  id: string;
}

export function Lanes({
  view,
  project,
  instruments,
  clips,
  selectedTrack,
  selectTrack,
  placement,
  selectPlacement,
  updateTrack,
  addTrack,
  removeTrack,
  renameTrack,
  cursorTick,
  playTick,
  onSeek,
  onBar,
  scrollRef,
  onScroll,
}: {
  view: View;
  project: Project;
  instruments: Record<string, Instrument>;
  clips: Record<string, Clip>;
  selectedTrack: string | null;
  selectTrack: (id: string) => void;
  placement: PlacementSel | null;
  selectPlacement: (p: PlacementSel | null) => void;
  updateTrack: (id: string, fn: (t: Track) => Track) => void;
  addTrack: () => void;
  removeTrack: (t: Track) => void;
  renameTrack: (t: Track) => void;
  cursorTick: number;
  playTick: number | null;
  onSeek: (tick: number) => void;
  onBar: (bar: number, x: number) => void;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const { timeline, ppt } = view;
  const ruler = useRef<HTMLDivElement>(null);
  const [moving, setMoving] = useState<{ trackId: string; id: string; x0: number; start: number } | null>(null);
  const instList = Object.values(instruments).sort((a, b) => a.name.localeCompare(b.name));
  const shownTick = playTick ?? cursorTick;
  const height = RULER_H + project.tracks.length * LANE_H;

  const seek = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-bar-label]')) return;
    const r = ruler.current!.getBoundingClientRect();
    onSeek(timeline.snap(Math.max(0, (e.clientX - r.left) / ppt), view.grid, 'round'));
  };

  const startMove = (e: React.PointerEvent, track: Track, pl: ClipPlacement) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    selectTrack(track.id);
    selectPlacement({ trackId: track.id, id: pl.id });
    setMoving({ trackId: track.id, id: pl.id, x0: e.clientX, start: pl.start });
  };
  const move = (e: React.PointerEvent) => {
    if (!moving) return;
    const start = timeline.snap(Math.max(0, moving.start + (e.clientX - moving.x0) / ppt), view.grid, 'round');
    updateTrack(moving.trackId, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === moving.id && c.start !== start ? { ...c, start } : c)) }));
  };

  return (
    <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin relative max-h-[38%] shrink-0 overflow-auto border-b border-line bg-surface">
      <div className="relative" style={{ width: HEAD_W + view.width, minHeight: height + LANE_H }}>
        {/* Ruler */}
        <div className="sticky top-0 z-20 flex" style={{ height: RULER_H }}>
          <div className="sticky left-0 z-10 flex shrink-0 items-center border-b border-r border-line bg-raised px-3" style={{ width: HEAD_W }}>
            <span className="label-caps text-muted">Tracks</span>
          </div>
          <div ref={ruler} className="relative cursor-pointer border-b border-line bg-raised" style={{ width: view.width }} onPointerDown={seek} title="Click to move the playhead">
            {view.bars.map((b) => {
              const meter = timeline.meters.find((m) => m.bar === b.bar);
              const tempo = timeline.tempos.find((t) => t.bar === b.bar);
              return (
                <div key={b.bar} className="absolute inset-y-0 border-l border-navy/30" style={{ left: b.start * ppt, width: (b.end - b.start) * ppt }}>
                  <button
                    data-bar-label
                    className="ml-0.5 mt-0.5 rounded px-1 font-mono text-[0.6875rem] text-ink hover:bg-surface"
                    onClick={(e) => onBar(b.bar, (e.currentTarget as HTMLElement).getBoundingClientRect().left)}
                    title={`Bar ${b.bar + 1}: set time signature or tempo from here`}
                  >
                    {b.bar + 1}
                  </button>
                  {(meter || tempo) && (
                    <span className="pointer-events-none absolute bottom-0.5 left-1 flex gap-1 font-mono text-[0.5625rem] leading-none text-accent">
                      {meter && <span>{meter.beats}/4</span>}
                      {tempo && <span>♩{tempo.bpm}</span>}
                    </span>
                  )}
                </div>
              );
            })}
            <div data-playhead className={cx('pointer-events-none absolute inset-y-0 w-0.5', playTick !== null ? 'bg-accent' : 'bg-navy/60')} style={{ left: shownTick * ppt }} />
          </div>
        </div>

        {project.tracks.map((t) => {
          const inst = t.instrumentId ? instruments[t.instrumentId] : undefined;
          const missing = !!t.instrumentId && !inst;
          const on = t.id === selectedTrack;
          const pitches = t.notes.map((n) => n.pitch);
          const lo = Math.min(...pitches, 127);
          const hi = Math.max(...pitches, 0);
          const span = Math.max(12, hi - lo);
          const y = (p: number) => 6 + ((hi - p) / span) * (LANE_H - 16);
          return (
            <div key={t.id} className="flex" style={{ height: LANE_H }} data-track={t.id}>
              <div
                className={cx('sticky left-0 z-10 flex shrink-0 flex-col justify-center gap-1 border-b border-r border-line px-2', on ? 'bg-raised shadow-[inset_3px_0_0_var(--accent)]' : 'bg-surface')}
                style={{ width: HEAD_W }}
                onPointerDown={() => selectTrack(t.id)}
              >
                <div className="flex items-center gap-1">
                  <button className="min-w-0 flex-1 truncate text-left text-sm font-semibold" onDoubleClick={() => renameTrack(t)} title="Double-click to rename">
                    {t.name}
                  </button>
                  <IconButton label={`Delete ${t.name}`} className="size-6" onClick={() => removeTrack(t)}>
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </div>
                <select
                  aria-label={`Instrument for ${t.name}`}
                  className={cx('h-6 w-full rounded-md border bg-surface px-1 text-xs outline-none focus:border-navy', missing ? 'border-warn/50 text-warn' : 'border-line')}
                  value={inst ? inst.id : missing ? 'missing' : ''}
                  onChange={(e) => {
                    const next = instruments[e.target.value];
                    if (next) updateTrack(t.id, (x) => ({ ...x, instrumentId: next.id, instrumentName: next.name }));
                  }}
                >
                  {missing && <option value="missing">Missing: {t.instrumentName || 'instrument'}</option>}
                  {!t.instrumentId && <option value="">Choose an instrument</option>}
                  {instList.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </div>
              <div
                className={cx('relative border-b border-line', on ? 'bg-lane' : 'bg-surface')}
                style={{ width: view.width }}
                onPointerDown={() => {
                  selectTrack(t.id);
                  selectPlacement(null);
                }}
              >
                {view.bars.map((b) => (
                  <div key={b.bar} className="pointer-events-none absolute inset-y-0 border-l border-grid-strong" style={{ left: b.start * ppt }} />
                ))}
                {t.notes.map((n) => (
                  <div key={n.id} className="pointer-events-none absolute h-[3px] rounded-full bg-navy" style={{ left: n.start * ppt, width: Math.max(2, n.length * ppt - 1), top: y(n.pitch) }} />
                ))}
                {t.clips.map((pl) => {
                  const clip = clips[pl.clipId];
                  const len = clip ? clipLength(clip) : 0;
                  const sel = placement?.id === pl.id;
                  const bad = pl.tags.some((tag) => tagProblem(tag, inst));
                  return (
                    <div
                      key={pl.id}
                      className={cx(
                        'absolute inset-y-1.5 flex cursor-grab items-start gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[0.6875rem] leading-tight active:cursor-grabbing',
                        !clip ? 'border-dashed border-warn bg-warn/10 text-warn' : sel ? 'border-accent bg-accent text-on-accent' : 'border-navy/40 bg-raised text-ink',
                        bad && 'outline-2 outline-dashed outline-warn',
                      )}
                      style={{ left: pl.start * ppt, width: Math.max(clip ? len * ppt : 120, 24) }}
                      onPointerDown={(e) => startMove(e, t, pl)}
                      onPointerMove={move}
                      onPointerUp={() => setMoving(null)}
                      onPointerCancel={() => setMoving(null)}
                      data-placement={pl.id}
                      title={clip ? `Clip “${clip.name}”. Drag to move; select to change tags or pitch.` : `The clip file “${pl.clipName}” is missing, so this plays nothing.`}
                    >
                      {!clip && <AlertTriangle className="size-3 shrink-0" />}
                      <span className="truncate font-semibold">{clip ? clip.name : `Missing: ${pl.clipName || 'clip'}`}</span>
                      {pl.transpose !== 0 && <span className="shrink-0 opacity-80">{pl.transpose > 0 ? `+${pl.transpose}` : pl.transpose}</span>}
                      {pl.tags.length > 0 && <span className="shrink-0 opacity-80">{pl.tags.map((x) => TAG_SHORT[x]).join(' ')}</span>}
                    </div>
                  );
                })}
                <div data-playhead className={cx('pointer-events-none absolute inset-y-0 z-10 w-0.5', playTick !== null ? 'bg-accent' : 'bg-navy/50')} style={{ left: shownTick * ppt }} />
              </div>
            </div>
          );
        })}

        <div className="sticky left-0 flex items-center px-2" style={{ width: HEAD_W, height: LANE_H }}>
          <button onClick={addTrack} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 font-display text-sm uppercase tracking-[0.06em] text-ink hover:bg-raised">
            <Plus className="size-4" />
            Add track
          </button>
        </div>
      </div>
    </div>
  );
}
