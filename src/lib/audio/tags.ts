import type { Instrument, TagId } from '../types';
import { audibleNodes } from './graph';

export interface TagDef {
  id: TagId;
  label: string;
  effect: string;
  /** Tags in the same group are opposites; a note has at most one from each group. */
  group?: string;
}

/** The built-in set. The amounts are fixed: */
export const TAGS: TagDef[] = [
  { id: 'vibrato', label: 'Vibrato', effect: 'Pitch wobble: ±30 cents, 5.5 times a second.' },
  { id: 'tremolo', label: 'Tremolo', effect: 'Volume wobble: dips to 30%, 6 times a second.' },
  { id: 'swell', label: 'Swell', effect: 'Volume rises from silent to full over the note.', group: 'volume' },
  { id: 'fade', label: 'Fade out', effect: 'Volume falls from full to silent over the note.', group: 'volume' },
  { id: 'bendUp', label: 'Bend up', effect: 'Pitch slides up 2 semitones over the note.', group: 'bend' },
  { id: 'bendDown', label: 'Bend down', effect: 'Pitch slides down 2 semitones over the note.', group: 'bend' },
  { id: 'filterOpen', label: 'Filter open', effect: 'Filter cutoff sweeps up over the note, from 3 octaves below its setting to the setting.', group: 'filter' },
  { id: 'filterClose', label: 'Filter close', effect: 'Filter cutoff sweeps down over the note, from its setting to 3 octaves below.', group: 'filter' },
];

export const TAG_BY_ID = Object.fromEntries(TAGS.map((t) => [t.id, t])) as Record<TagId, TagDef>;

export const TAG_SHORT: Record<TagId, string> = {
  vibrato: 'Vib',
  tremolo: 'Trem',
  swell: 'Swell',
  fade: 'Fade',
  bendUp: 'Bend↑',
  bendDown: 'Bend↓',
  filterOpen: 'Filt↑',
  filterClose: 'Filt↓',
};

/**
 * Whether a tag can act on an instrument. Volume tags act on the note's output, so they always work.
 * Pitch tags move the Note input's Pitch, so they need it to reach an Oscillator you can hear.
 * Filter tags need a Filter you can hear.
 * Returns null if the tag works, or the reason it cannot.
 */
export function tagProblem(tag: TagId, inst: Instrument | undefined): string | null {
  if (!inst) return 'This track has no instrument.';
  if (tag === 'tremolo' || tag === 'swell' || tag === 'fade') return null;
  const audible = audibleNodes(inst);
  if (tag === 'filterOpen' || tag === 'filterClose') {
    return inst.nodes.some((n) => n.type === 'filter' && audible.has(n.id)) ? null : `“${inst.name}” has no Filter in its sound, so there is no cutoff to sweep.`;
  }
  const note = inst.nodes.find((n) => n.type === 'note');
  const pitchUsed = inst.cables.some((c) => c.from.node === note?.id && c.from.port === 'pitch' && audible.has(c.to.node));
  return pitchUsed ? null : `“${inst.name}” does not use the note’s Pitch, so there is no pitch to move.`;
}

/** Adds a tag and takes off its opposite, if any. */
export function addTag(tags: TagId[], tag: TagId): TagId[] {
  const group = TAG_BY_ID[tag].group;
  const kept = tags.filter((t) => t !== tag && (!group || TAG_BY_ID[t].group !== group));
  return [...kept, tag];
}
