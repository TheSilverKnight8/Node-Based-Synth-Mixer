import type { Timeline } from '../music';
import type { Clip, Instrument, Project, TagId } from '../types';

/** One note to play, with its time worked out in seconds. Clip placements are opened up into their notes. */
export interface NoteEvent {
  key: string;
  trackId: string;
  instId: string;
  pitch: number;
  startTick: number;
  endTick: number;
  start: number;
  end: number;
  tags: TagId[];
}

export interface Library {
  instruments: Record<string, Instrument>;
  clips: Record<string, Clip>;
}

/** Every note in the project that can sound: tracks without an instrument file and missing clips are left out. */
export function buildEvents(project: Project, lib: Library, timeline: Timeline): NoteEvent[] {
  const events: NoteEvent[] = [];
  const add = (key: string, trackId: string, instId: string, pitch: number, startTick: number, length: number, tags: TagId[]) => {
    if (length <= 0 || pitch < 0 || pitch > 127) return;
    const endTick = startTick + length;
    events.push({ key, trackId, instId, pitch, startTick, endTick, start: timeline.tickToSec(startTick), end: timeline.tickToSec(endTick), tags });
  };
  for (const track of project.tracks) {
    const instId = track.instrumentId;
    if (!instId || !lib.instruments[instId]) continue;
    for (const n of track.notes) add(`${track.id}:${n.id}:${n.start}:${n.pitch}`, track.id, instId, n.pitch, n.start, n.length, n.tags);
    for (const p of track.clips) {
      const clip = lib.clips[p.clipId];
      if (!clip) continue;
      clip.notes.forEach((n, i) => add(`${track.id}:${p.id}:${i}:${p.start}:${p.transpose}`, track.id, instId, n.pitch + p.transpose, p.start + n.start, n.length, p.tags));
    }
  }
  events.sort((a, b) => a.start - b.start);
  return events;
}

/** The last tick where anything in the project ends (missing clips count as empty). */
export function projectEndTick(project: Project, clips: Record<string, Clip>) {
  let end = 0;
  for (const t of project.tracks) {
    for (const n of t.notes) end = Math.max(end, n.start + n.length);
    for (const p of t.clips) end = Math.max(end, p.start + clipLength(clips[p.clipId]));
  }
  return end;
}

export function clipLength(clip: Clip | undefined) {
  let end = 0;
  for (const n of clip?.notes ?? []) end = Math.max(end, n.start + n.length);
  return end;
}
