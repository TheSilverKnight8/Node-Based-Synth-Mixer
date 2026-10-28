import { engine } from './audio/engine';
import type { Voice } from './audio/voice';
import type { Instrument } from './types';

// Piano layout on the computer keyboard, by key position (KeyboardEvent.code), so it
// works the same on any keyboard language. The home row plays the white keys from C;
// the row above plays the black keys, in the gaps where a piano has them (no key
// between E and F, or between B and C).
export const WHITE_KEYS: { code: string; label: string; semitone: number }[] = [
  { code: 'KeyA', label: 'A', semitone: 0 },
  { code: 'KeyS', label: 'S', semitone: 2 },
  { code: 'KeyD', label: 'D', semitone: 4 },
  { code: 'KeyF', label: 'F', semitone: 5 },
  { code: 'KeyG', label: 'G', semitone: 7 },
  { code: 'KeyH', label: 'H', semitone: 9 },
  { code: 'KeyJ', label: 'J', semitone: 11 },
  { code: 'KeyK', label: 'K', semitone: 12 },
  { code: 'KeyL', label: 'L', semitone: 14 },
  { code: 'Semicolon', label: ';', semitone: 16 },
  { code: 'Quote', label: '’', semitone: 17 },
];

export const BLACK_KEYS: { code: string; label: string; semitone: number }[] = [
  { code: 'KeyW', label: 'W', semitone: 1 },
  { code: 'KeyE', label: 'E', semitone: 3 },
  { code: 'KeyT', label: 'T', semitone: 6 },
  { code: 'KeyY', label: 'Y', semitone: 8 },
  { code: 'KeyU', label: 'U', semitone: 10 },
  { code: 'KeyO', label: 'O', semitone: 13 },
  { code: 'KeyP', label: 'P', semitone: 15 },
];

const SEMITONE = new Map([...WHITE_KEYS, ...BLACK_KEYS].map((k) => [k.code, k.semitone]));

export const MIN_OCTAVE = 0; // the A key plays C0
export const MAX_OCTAVE = 7; // the A key plays C7

export interface LiveNoteEvent {
  type: 'on' | 'off';
  midi: number;
  /** Audio clock time of the key press or release. */
  time: number;
}

type Listener = () => void;

/**
 * Plays the current instrument from the computer keyboard. The page sets which
 * instrument that is (the one open in the node editor, or the selected track's).
 */
class LiveKeyboard {
  /** The octave the A key plays: 4 means middle C. */
  octave = 4;
  /** Goes up on every change, so the screen knows to redraw. */
  version = 0;
  private held = new Map<string, { midi: number; voice: Voice | null }>();
  private getInstrument: () => Instrument | undefined = () => undefined;
  private listeners = new Set<Listener>();
  private noteListeners = new Set<(e: LiveNoteEvent) => void>();
  private attached = false;

  setInstrument(get: () => Instrument | undefined) {
    this.getInstrument = get;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** For recording: hear about every note played. */
  onNote(fn: (e: LiveNoteEvent) => void) {
    this.noteListeners.add(fn);
    return () => {
      this.noteListeners.delete(fn);
    };
  }

  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  heldPitches() {
    return new Set([...this.held.values()].map((h) => h.midi));
  }

  shiftOctave(by: number) {
    const next = Math.min(MAX_OCTAVE, Math.max(MIN_OCTAVE, this.octave + by));
    if (next === this.octave) return;
    // Notes already sounding keep their pitch: held keys remember the note they started.
    this.octave = next;
    this.emit();
  }

  /** The note a semitone offset plays right now. */
  midiFor(semitone: number) {
    return (this.octave + 1) * 12 + semitone;
  }

  /** Starts a note. `id` is the key (or pointer) holding it, so the same press releases it. */
  press(id: string, midi: number) {
    if (this.held.has(id)) return;
    const inst = this.getInstrument();
    const time = engine.context().currentTime;
    const voice = inst ? engine.play(inst, midi) : null;
    this.held.set(id, { midi, voice });
    for (const fn of this.noteListeners) fn({ type: 'on', midi, time });
    this.emit();
  }

  release(id: string) {
    const h = this.held.get(id);
    if (!h) return;
    this.held.delete(id);
    const time = engine.context().currentTime;
    h.voice?.release(time);
    for (const fn of this.noteListeners) fn({ type: 'off', midi: h.midi, time });
    this.emit();
  }

  releaseAll() {
    for (const id of [...this.held.keys()]) this.release(id);
  }

  attach() {
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (!e.repeat) this.shiftOctave(e.code === 'ShiftLeft' ? -1 : 1);
      return;
    }
    const semitone = SEMITONE.get(e.code);
    if (semitone === undefined) return;
    e.preventDefault();
    if (e.repeat) return;
    this.press(e.code, this.midiFor(semitone));
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (SEMITONE.has(e.code)) this.release(e.code);
  };
}

/** Keys typed into a text box are words, not notes. */
function typing(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button'].includes(target.type);
  return false;
}

export const liveKeyboard = new LiveKeyboard();
