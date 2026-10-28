import { Timeline } from '../music';
import type { Project } from '../types';
import { engine } from './engine';
import { buildEvents, type Library, type NoteEvent } from './events';
import type { Voice } from './voice';

const TICK_MS = 25; // how often the scheduler wakes up
const LOOKAHEAD = 0.12; // seconds of notes handed to the audio clock ahead of time

type Listener = () => void;

/**
 * Arranger playback. A timer wakes every 25 ms and hands the notes of the next 120 ms
 * to the Web Audio clock with exact start times, so timing does not depend on the timer.
 * All tracks are scheduled against the same clock, so they stay in sync.
 */
class Transport {
  playing = false;
  recording = false;

  private lib?: Library;
  private timeline = new Timeline({ meters: [], tempos: [] });
  private events: NoteEvent[] = [];
  private scheduled = new Set<string>();
  private voices = new Set<Voice>();
  private timer?: number;
  private ctxStart = 0;
  private secStart = 0;
  private lastEnd = 0;
  private listeners = new Set<Listener>();

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  play(project: Project, lib: Library, fromTick: number, record = false) {
    this.stop();
    const ctx = engine.context();
    this.setSource(project, lib);
    this.playing = true;
    this.recording = record;
    this.secStart = this.timeline.tickToSec(fromTick);
    // A short gap so the first notes are scheduled before they are due.
    this.ctxStart = ctx.currentTime + 0.06;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), TICK_MS);
    this.emit();
  }

  /** The project changed during playback (a note was added, an instrument edited): later notes use the new version. */
  update(project: Project, lib: Library) {
    if (!this.playing) return;
    this.setSource(project, lib);
  }

  private setSource(project: Project, lib: Library) {
    this.lib = lib;
    const tl = new Timeline(project);
    // A tempo change during playback keeps the playhead where it is.
    if (this.playing) {
      const tick = this.positionTick();
      this.timeline = tl;
      this.secStart = tl.tickToSec(tick);
      this.ctxStart = engine.context().currentTime;
    } else this.timeline = tl;
    this.events = buildEvents(project, lib, this.timeline);
    this.lastEnd = this.events.reduce((m, e) => Math.max(m, e.end), 0);
  }

  stop() {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    const wasPlaying = this.playing;
    this.playing = false;
    this.recording = false;
    const now = engine.context().currentTime;
    for (const v of this.voices) v.kill(now);
    this.voices.clear();
    this.scheduled.clear();
    if (wasPlaying) this.emit();
  }

  private pump() {
    if (!this.playing || !this.lib) return;
    const ctx = engine.context();
    const horizon = this.secStart + (ctx.currentTime + LOOKAHEAD - this.ctxStart);
    for (const ev of this.events) {
      if (ev.start >= horizon) break;
      if (ev.start < this.secStart - 1e-6 || this.scheduled.has(ev.key)) continue;
      const inst = this.lib.instruments[ev.instId];
      if (!inst) continue;
      this.scheduled.add(ev.key);
      const when = this.ctxStart + (ev.start - this.secStart);
      const voice = engine.play(inst, ev.pitch, { when, duration: ev.end - ev.start, tags: ev.tags });
      this.voices.add(voice);
      const prev = voice.onEnded;
      voice.onEnded = () => {
        prev?.();
        this.voices.delete(voice);
      };
    }
    // Play to the end, then stop by itself. While recording it keeps going until Stop.
    const nowSec = this.secStart + (ctx.currentTime - this.ctxStart);
    if (!this.recording && nowSec > Math.max(this.lastEnd, this.secStart) + 0.05) {
      if (this.timer !== undefined) window.clearInterval(this.timer);
      this.timer = undefined;
      this.playing = false;
      this.scheduled.clear();
      this.voices.clear();
      this.emit();
    }
  }

  /** Where the playhead is, in ticks. */
  positionTick() {
    if (!this.playing) return 0;
    return this.ctxTimeToTick(engine.context().currentTime);
  }

  ctxTimeToTick(t: number) {
    return Math.max(0, this.timeline.secToTick(this.secStart + (t - this.ctxStart)));
  }
}

export const transport = new Transport();
