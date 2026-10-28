import type { Beats, MeterChange, Project, TempoChange } from './types';

/** Ticks per quarter note. 960 divides evenly into halves, quarters, eighths, sixteenths, thirty-seconds and their triplets. */
export const PPQ = 960;

export const MIN_PITCH = 12; // C0
export const MAX_PITCH = 108; // C8

export function midiToHz(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

/** "C4" is middle C (MIDI 60). */
export function noteName(midi: number) {
  return NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

export function isBlackKey(midi: number) {
  return [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
}

export interface GridOption {
  id: string;
  label: string;
  ticks: number;
}

/** Grid sizes. Triplets fit three notes in the space of two. */
export const GRIDS: GridOption[] = [
  { id: '1/2', label: '1/2', ticks: PPQ * 2 },
  { id: '1/4', label: '1/4', ticks: PPQ },
  { id: '1/8', label: '1/8', ticks: PPQ / 2 },
  { id: '1/16', label: '1/16', ticks: PPQ / 4 },
  { id: '1/32', label: '1/32', ticks: PPQ / 8 },
  { id: '1/4t', label: '1/4 triplet', ticks: (PPQ * 2) / 3 },
  { id: '1/8t', label: '1/8 triplet', ticks: PPQ / 3 },
  { id: '1/16t', label: '1/16 triplet', ticks: PPQ / 6 },
  { id: '1/32t', label: '1/32 triplet', ticks: PPQ / 12 },
];

export const METERS: Beats[] = [3, 4, 5];

export const DEFAULT_BPM = 120;
export const MIN_BPM = 20;
export const MAX_BPM = 400;

export type SnapMode = 'round' | 'floor' | 'ceil';

/**
 * Converts between ticks, bars and seconds for one project. Time signatures and
 * tempos change only at the start of a bar. The grid restarts at every bar line,
 * so triplet grids stay lined up with bars of 3, 4 or 5 beats.
 */
export class Timeline {
  readonly meters: MeterChange[];
  readonly tempos: TempoChange[];
  private tempoSegs: { tick: number; sec: number; secPerTick: number }[];

  constructor(project: Pick<Project, 'meters' | 'tempos'>) {
    this.meters = normalizeMeters(project.meters);
    this.tempos = normalizeTempos(project.tempos);
    this.tempoSegs = [];
    let sec = 0;
    let prev: { tick: number; secPerTick: number } | null = null;
    for (const t of this.tempos) {
      const tick = this.barStart(t.bar);
      if (prev) sec += (tick - prev.tick) * prev.secPerTick;
      const seg = { tick, sec, secPerTick: 60 / (t.bpm * PPQ) };
      this.tempoSegs.push(seg);
      prev = seg;
    }
  }

  /** The tick where a bar starts. */
  barStart(bar: number) {
    let tick = 0;
    for (let i = 0; i < this.meters.length; i++) {
      const m = this.meters[i];
      const nextBar = this.meters[i + 1]?.bar ?? Infinity;
      if (bar <= nextBar) return tick + (bar - m.bar) * m.beats * PPQ;
      tick += (nextBar - m.bar) * m.beats * PPQ;
    }
    return tick;
  }

  /** The bar that contains a tick. */
  barAt(tick: number) {
    let start = 0;
    for (let i = 0; i < this.meters.length; i++) {
      const m = this.meters[i];
      const nextBar = this.meters[i + 1]?.bar ?? Infinity;
      const len = m.beats * PPQ;
      const segTicks = (nextBar - m.bar) * len;
      if (tick < start + segTicks) return m.bar + Math.floor(Math.max(0, tick - start) / len);
      start += segTicks;
    }
    return 0;
  }

  beatsInBar(bar: number): Beats {
    let beats: Beats = this.meters[0].beats;
    for (const m of this.meters) if (m.bar <= bar) beats = m.beats;
    return beats;
  }

  bpmAtBar(bar: number) {
    let bpm = this.tempos[0].bpm;
    for (const t of this.tempos) if (t.bar <= bar) bpm = t.bpm;
    return bpm;
  }

  /** Bar and beat, counting from 1 the way musicians do. */
  label(tick: number) {
    const bar = this.barAt(tick);
    const beat = Math.floor((tick - this.barStart(bar)) / PPQ);
    return `Bar ${bar + 1} · Beat ${beat + 1}`;
  }

  tickToSec(tick: number) {
    let seg = this.tempoSegs[0];
    for (const s of this.tempoSegs) if (s.tick <= tick) seg = s;
    return seg.sec + (tick - seg.tick) * seg.secPerTick;
  }

  secToTick(sec: number) {
    let seg = this.tempoSegs[0];
    for (const s of this.tempoSegs) if (s.sec <= sec) seg = s;
    return seg.tick + (sec - seg.sec) / seg.secPerTick;
  }

  /** Moves a tick to a grid line. The grid starts again at each bar line, and the bar line itself always counts. */
  snap(tick: number, grid: number, mode: SnapMode = 'round') {
    if (tick <= 0) return 0;
    const bar = this.barAt(tick);
    const start = this.barStart(bar);
    const end = this.barStart(bar + 1);
    const rel = (tick - start) / grid;
    const below = start + Math.floor(rel + 1e-9) * grid;
    const above = Math.min(start + Math.ceil(rel - 1e-9) * grid, end);
    if (mode === 'floor') return below;
    if (mode === 'ceil') return above;
    return tick - below <= above - tick ? below : above;
  }

  /** The first grid line after a tick. */
  nextLine(tick: number, grid: number) {
    return this.snap(Math.floor(tick) + 1, grid, 'ceil');
  }
}

function normalizeMeters(meters: MeterChange[]): MeterChange[] {
  const sorted = [...meters].filter((m) => m.bar >= 0).sort((a, b) => a.bar - b.bar);
  const out: MeterChange[] = [];
  for (const m of sorted) {
    if (out.length && out[out.length - 1].bar === m.bar) out[out.length - 1] = m;
    else out.push(m);
  }
  if (!out.length || out[0].bar !== 0) out.unshift({ bar: 0, beats: 4 });
  return out;
}

function normalizeTempos(tempos: TempoChange[]): TempoChange[] {
  const sorted = [...tempos].filter((t) => t.bar >= 0).sort((a, b) => a.bar - b.bar);
  const out: TempoChange[] = [];
  for (const t of sorted) {
    if (out.length && out[out.length - 1].bar === t.bar) out[out.length - 1] = t;
    else out.push(t);
  }
  if (!out.length || out[0].bar !== 0) out.unshift({ bar: 0, bpm: DEFAULT_BPM });
  return out;
}
