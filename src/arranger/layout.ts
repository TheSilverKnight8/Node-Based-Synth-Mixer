import { PPQ, Timeline } from '../lib/music';
import type { Beats } from '../lib/types';

export const HEAD_W = 184; // track headers and piano keys
export const LANE_H = 52;
export const RULER_H = 30;
export const ROW_H = 14; // one pitch in the piano roll

export interface BarInfo {
  bar: number;
  start: number;
  end: number;
  beats: Beats;
}

/** Everything the arranger's panes need to agree on to line up. */
export interface View {
  timeline: Timeline;
  /** Pixels per tick. */
  ppt: number;
  bars: BarInfo[];
  /** Width of the timeline in pixels. */
  width: number;
  /** Grid size in ticks. */
  grid: number;
}

/** Enough bars to hold the music plus room to keep going. */
export function makeBars(timeline: Timeline, endTick: number): BarInfo[] {
  const bars: BarInfo[] = [];
  const minBars = 32;
  for (let bar = 0; ; bar++) {
    const start = timeline.barStart(bar);
    if (bar >= minBars && start > endTick + 8 * 4 * PPQ) break;
    bars.push({ bar, start, end: timeline.barStart(bar + 1), beats: timeline.beatsInBar(bar) });
  }
  return bars;
}

/** The grid drawn inside one bar: thin lines at the grid size, stronger lines on each beat. It starts again at every bar line. */
export function barBackground(gridPx: number, beatPx: number) {
  const lines = [`repeating-linear-gradient(to right, var(--grid-strong) 0 1px, transparent 1px ${beatPx}px)`];
  if (gridPx >= 4 && Math.abs(gridPx - beatPx) > 0.5) lines.push(`repeating-linear-gradient(to right, var(--grid) 0 1px, transparent 1px ${gridPx}px)`);
  return lines.join(', ');
}
