// The data the app saves. Projects refer to instruments and clips by ID, so a
// change to an instrument or clip shows up in every project that uses it.

/** What a cable carries. Audio is sound; the others control a sound. */
export type PortKind = 'audio' | 'pitch' | 'gate' | 'mod';

export type ModuleType = 'note' | 'osc' | 'noise' | 'filter' | 'gain' | 'env' | 'lfo' | 'output';

export type ParamValue = number | string;

export interface ModuleNode {
  id: string;
  type: ModuleType;
  /** Position on the node editor canvas, in pixels. */
  x: number;
  y: number;
  params: Record<string, ParamValue>;
}

export interface PortRef {
  node: string;
  port: string;
}

/** A cable always runs from an output to an input. */
export interface Cable {
  id: string;
  from: PortRef;
  to: PortRef;
}

export interface Instrument {
  id: string;
  name: string;
  nodes: ModuleNode[];
  cables: Cable[];
}

export type TagId = 'vibrato' | 'tremolo' | 'swell' | 'fade' | 'bendUp' | 'bendDown' | 'filterOpen' | 'filterClose';

/** Times are in ticks: 960 to a quarter note (see PPQ in music.ts). Pitch is a MIDI note number (60 = middle C). */
export interface Note {
  id: string;
  pitch: number;
  start: number;
  length: number;
  tags: TagId[];
}

export interface ClipNote {
  pitch: number;
  /** From the start of the bar the clip was saved from. */
  start: number;
  length: number;
}

/** A saved group of notes. It is note data, not audio, so it plays with the instrument of whatever track it is placed on. */
export interface Clip {
  id: string;
  name: string;
  notes: ClipNote[];
}

/** A clip placed on a track. Its tags act on every note of the clip, one note at a time. */
export interface ClipPlacement {
  id: string;
  clipId: string;
  /** The clip's name when it was placed, for the message if the clip file goes missing. */
  clipName: string;
  start: number;
  /** Semitones up (positive) or down (negative). */
  transpose: number;
  tags: TagId[];
}

export interface Track {
  id: string;
  name: string;
  instrumentId: string | null;
  /** The instrument's name when it was chosen, for the message if the instrument file goes missing. */
  instrumentName: string;
  notes: Note[];
  clips: ClipPlacement[];
}

export type Beats = 3 | 4 | 5;

/** Time signature from this bar on (bars count from 0). All three signatures count quarter notes. */
export interface MeterChange {
  bar: number;
  beats: Beats;
}

/** Tempo from this bar on, in quarter notes per minute. */
export interface TempoChange {
  bar: number;
  bpm: number;
}

export interface Project {
  id: string;
  name: string;
  meters: MeterChange[];
  tempos: TempoChange[];
  tracks: Track[];
}
