import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { engine } from '../lib/audio/engine';
import { TAGS, TAG_SHORT, tagProblem } from '../lib/audio/tags';
import type { Voice } from '../lib/audio/voice';
import { newId } from '../lib/ids';
import { MAX_PITCH, MIN_PITCH, PPQ, isBlackKey, noteName } from '../lib/music';
import type { Clip, Instrument, Note, TagId, Track } from '../lib/types';
import { cx } from '../components/ui';
import { HEAD_W, ROW_H, barBackground, type View } from './layout';

const ROWS = MAX_PITCH - MIN_PITCH + 1;
const EDGE = 6; // pixels at a note's right end that resize instead of move

type Drag =
  | { mode: 'move' | 'resize'; x0: number; y0: number; orig: Map<string, Note>; anchor: Note }
  | { mode: 'band'; x0: number; y0: number; x1: number; y1: number; base: Set<string> };

export interface PendingNote {
  pitch: number;
  start: number;
}

export function PianoRoll({
  view,
  track,
  inst,
  clips,
  selection,
  setSelection,
  updateTrack,
  cursorTick,
  playTick,
  pending,
  scrollRef,
  onScroll,
}: {
  view: View;
  track: Track;
  inst: Instrument | undefined;
  clips: Record<string, Clip>;
  selection: Set<string>;
  setSelection: (s: Set<string>) => void;
  updateTrack: (fn: (t: Track) => Track) => void;
  cursorTick: number;
  playTick: number | null;
  pending: PendingNote[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [lastLength, setLastLength] = useState(PPQ);
  const preview = useRef<Voice | null>(null);
  const lastHeard = useRef<number | null>(null);
  const { timeline, ppt } = view;

  const problemTags = useMemo(() => new Set(TAGS.filter((t) => tagProblem(t.id, inst)).map((t) => t.id)), [inst]);

  // Open near the track's notes, or around middle C.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pitches = track.notes.map((n) => n.pitch);
    const center = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : 66;
    el.scrollTop = (MAX_PITCH - center) * ROW_H - el.clientHeight / 2;
    // Only when switching tracks, not on every edit.
  }, [track.id]);

  const at = (clientX: number, clientY: number) => {
    const r = grid.current!.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    return { x, y, tick: Math.max(0, x / ppt), pitch: MAX_PITCH - Math.floor(y / ROW_H) };
  };

  const hear = (pitch: number) => {
    preview.current?.release(engine.now);
    preview.current = inst ? engine.play(inst, pitch) : null;
  };
  const stopHearing = () => {
    preview.current?.release(engine.now);
    preview.current = null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = at(e.clientX, e.clientY);
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note]');
    const hit = noteEl ? track.notes.find((n) => n.id === noteEl.dataset.note) : undefined;

    if (!hit) {
      if (e.shiftKey) {
        setDrag({ mode: 'band', x0: p.x, y0: p.y, x1: p.x, y1: p.y, base: new Set(selection) });
        return;
      }
      if (p.pitch < MIN_PITCH || p.pitch > MAX_PITCH) return;
      // A click on empty grid adds a note there, as long as the last one made; dragging sets its length.
      const start = timeline.snap(p.tick, view.grid, 'floor');
      const note: Note = { id: newId(), pitch: p.pitch, start, length: lastLength, tags: [] };
      updateTrack((t) => ({ ...t, notes: [...t.notes, note] }));
      setSelection(new Set([note.id]));
      hear(note.pitch);
      setDrag({ mode: 'resize', x0: p.x, y0: p.y, orig: new Map([[note.id, note]]), anchor: note });
      return;
    }

    let sel = selection;
    if (e.shiftKey) {
      sel = new Set(selection);
      if (sel.has(hit.id)) sel.delete(hit.id);
      else sel.add(hit.id);
      setSelection(sel);
      if (!sel.has(hit.id)) return;
    } else if (!selection.has(hit.id)) {
      sel = new Set([hit.id]);
      setSelection(sel);
    }
    const rect = noteEl!.getBoundingClientRect();
    const mode = e.clientX > rect.right - EDGE ? 'resize' : 'move';
    const orig = new Map(track.notes.filter((n) => sel.has(n.id)).map((n) => [n.id, n]));
    hear(hit.pitch);
    setDrag({ mode, x0: p.x, y0: p.y, orig, anchor: hit });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = at(e.clientX, e.clientY);
    if (drag.mode === 'band') {
      setDrag({ ...drag, x1: p.x, y1: p.y });
      const [xa, xb] = [Math.min(drag.x0, p.x) / ppt, Math.max(drag.x0, p.x) / ppt];
      const [pa, pb] = [MAX_PITCH - Math.floor(Math.max(drag.y0, p.y) / ROW_H), MAX_PITCH - Math.floor(Math.min(drag.y0, p.y) / ROW_H)];
      const next = new Set(drag.base);
      for (const n of track.notes) if (n.start < xb && n.start + n.length > xa && n.pitch >= pa && n.pitch <= pb) next.add(n.id);
      setSelection(next);
      return;
    }
    const dt = (p.x - drag.x0) / ppt;
    if (drag.mode === 'move') {
      const a = drag.anchor;
      const newStart = timeline.snap(Math.max(0, a.start + dt), view.grid, 'round');
      let delta = newStart - a.start;
      let dp = Math.round((drag.y0 - p.y) / ROW_H);
      const origs = [...drag.orig.values()];
      // Keep every moved note on the grid's range of pitches and after the start.
      const minStart = Math.min(...origs.map((n) => n.start));
      if (minStart + delta < 0) delta = -minStart;
      dp = Math.min(dp, MAX_PITCH - Math.max(...origs.map((n) => n.pitch)));
      dp = Math.max(dp, MIN_PITCH - Math.min(...origs.map((n) => n.pitch)));
      if (preview.current && a.pitch + dp !== lastHeard.current) {
        lastHeard.current = a.pitch + dp;
        hear(a.pitch + dp);
      }
      updateTrack((t) => ({
        ...t,
        notes: t.notes.map((n) => {
          const o = drag.orig.get(n.id);
          return o ? { ...n, start: o.start + delta, pitch: o.pitch + dp } : n;
        }),
      }));
    } else {
      let newLen = lastLength;
      updateTrack((t) => ({
        ...t,
        notes: t.notes.map((n) => {
          const o = drag.orig.get(n.id);
          if (!o) return n;
          let end = timeline.snap(o.start + o.length + dt, view.grid, 'round');
          if (end <= o.start) end = timeline.nextLine(o.start, view.grid);
          if (o.id === drag.anchor.id) newLen = end - o.start;
          return { ...n, length: end - o.start };
        }),
      }));
      setLastLength(newLen);
    }
  };

  const onPointerUp = () => {
    if (drag && drag.mode !== 'band') {
      const n = track.notes.find((x) => x.id === drag.anchor.id);
      if (n) setLastLength(n.length);
    }
    lastHeard.current = null;
    stopHearing();
    setDrag(null);
  };

  const removeNote = (e: React.MouseEvent) => {
    const noteEl = (e.target as HTMLElement).closest<HTMLElement>('[data-note]');
    e.preventDefault();
    if (!noteEl) return;
    const id = noteEl.dataset.note!;
    updateTrack((t) => ({ ...t, notes: t.notes.filter((n) => n.id !== id) }));
    const next = new Set(selection);
    next.delete(id);
    setSelection(next);
  };

  const height = ROWS * ROW_H;
  const shownTick = playTick ?? cursorTick;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto bg-surface">
      <div className="relative" style={{ width: HEAD_W + view.width, height }}>
        {/* Piano keys */}
        <div className="sticky left-0 z-20 float-left border-r border-line bg-surface" style={{ width: HEAD_W, height }}>
          {Array.from({ length: ROWS }, (_, i) => {
            const pitch = MAX_PITCH - i;
            const black = isBlackKey(pitch);
            return (
              <button
                key={pitch}
                tabIndex={-1}
                className={cx(
                  'absolute left-0 flex items-center justify-end pr-1.5 font-mono text-[0.625rem] leading-none',
                  // Black keys are shorter and start at the edge, like a piano turned on its side.
                  black ? 'right-[40%] z-10 rounded-r-sm bg-navy text-on-accent' : 'right-0 border-b border-line/60 bg-bg text-muted',
                  pitch % 12 === 0 && 'border-line text-ink',
                )}
                style={{ top: i * ROW_H, height: ROW_H - (black ? 1 : 0) }}
                onPointerDown={() => hear(pitch)}
                onPointerUp={stopHearing}
                onPointerLeave={stopHearing}
                title={noteName(pitch)}
              >
                {pitch % 12 === 0 ? noteName(pitch) : ''}
              </button>
            );
          })}
        </div>

        <div
          ref={grid}
          className={cx('absolute top-0', drag?.mode === 'move' ? 'cursor-grabbing' : 'cursor-cell')}
          style={{ left: HEAD_W, width: view.width, height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={removeNote}
          data-testid="piano-grid"
        >
          {/* Pitch rows: black-key rows a little darker, a line at each C. */}
          {Array.from({ length: ROWS }, (_, i) => {
            const pitch = MAX_PITCH - i;
            return (
              <div
                key={pitch}
                className={cx('pointer-events-none absolute inset-x-0', isBlackKey(pitch) ? 'bg-lane' : 'bg-surface', pitch % 12 === 0 && 'border-b border-grid-strong')}
                style={{ top: i * ROW_H, height: ROW_H }}
              />
            );
          })}
          {/* Bars, beats and grid lines */}
          {view.bars.map((b) => (
            <div
              key={b.bar}
              className="pointer-events-none absolute top-0"
              style={{
                left: b.start * ppt,
                width: (b.end - b.start) * ppt,
                height,
                borderLeft: '1px solid color-mix(in srgb, var(--navy) 38%, transparent)',
                backgroundImage: barBackground(view.grid * ppt, PPQ * ppt),
              }}
            />
          ))}

          {/* Clip placements on this track, drawn faintly: their notes live in the clip file. */}
          {track.clips.map((pl) =>
            (clips[pl.clipId]?.notes ?? []).map((n, i) => {
              const pitch = n.pitch + pl.transpose;
              if (pitch < MIN_PITCH || pitch > MAX_PITCH) return null;
              return (
                <div
                  key={`${pl.id}-${i}`}
                  className="pointer-events-none absolute rounded-[3px] border border-dashed border-navy/50 bg-navy/12"
                  style={{ left: (pl.start + n.start) * ppt, top: (MAX_PITCH - pitch) * ROW_H, width: Math.max(3, n.length * ppt - 1), height: ROW_H - 1 }}
                  title={`Clip “${clips[pl.clipId]?.name}” (edit its placement in the track lane)`}
                />
              );
            }),
          )}

          {track.notes.map((n) => {
            if (n.pitch < MIN_PITCH || n.pitch > MAX_PITCH) return null;
            const on = selection.has(n.id);
            const bad = n.tags.filter((t) => problemTags.has(t));
            const w = Math.max(3, n.length * ppt - 1);
            return (
              <div
                key={n.id}
                data-note={n.id}
                className={cx(
                  'absolute flex items-center overflow-hidden rounded-[3px] px-1 text-[0.5625rem] font-medium leading-none text-on-accent',
                  on ? 'z-10 bg-accent' : 'bg-navy',
                  bad.length > 0 && 'outline-2 outline-offset-1 outline-dashed outline-warn',
                  drag?.mode === 'move' ? 'cursor-grabbing' : 'cursor-grab',
                )}
                style={{ left: n.start * ppt, top: (MAX_PITCH - n.pitch) * ROW_H, width: w, height: ROW_H - 1 }}
                title={noteTitle(n, bad)}
              >
                {w > 30 && <span className="truncate">{noteName(n.pitch)}</span>}
                {n.tags.length > 0 && <span className="ml-auto pl-1 opacity-90">{n.tags.length > 1 ? `${n.tags.length} tags` : TAG_SHORT[n.tags[0]]}</span>}
                <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
              </div>
            );
          })}

          {/* Notes being recorded right now */}
          {playTick !== null &&
            pending.map((p) => (
              <div
                key={`rec-${p.pitch}`}
                className="pointer-events-none absolute rounded-[3px] bg-accent/60"
                style={{ left: p.start * ppt, top: (MAX_PITCH - p.pitch) * ROW_H, width: Math.max(3, (playTick - p.start) * ppt), height: ROW_H - 1 }}
              />
            ))}

          {drag?.mode === 'band' && (
            <div
              className="pointer-events-none absolute z-20 border border-accent bg-accent/10"
              style={{ left: Math.min(drag.x0, drag.x1), top: Math.min(drag.y0, drag.y1), width: Math.abs(drag.x1 - drag.x0), height: Math.abs(drag.y1 - drag.y0) }}
            />
          )}

          <div data-playhead className={cx('pointer-events-none absolute top-0 z-30 w-0.5', playTick !== null ? 'bg-accent' : 'bg-navy/60')} style={{ left: shownTick * ppt, height }} />
        </div>
      </div>
    </div>
  );
}

function noteTitle(n: Note, bad: TagId[]) {
  const parts = [noteName(n.pitch)];
  if (n.tags.length) parts.push(`Tags: ${n.tags.map((t) => TAGS.find((x) => x.id === t)?.label).join(', ')}`);
  if (bad.length) parts.push(`Cannot act on this instrument: ${bad.map((t) => TAGS.find((x) => x.id === t)?.label).join(', ')}`);
  return parts.join('\n');
}
