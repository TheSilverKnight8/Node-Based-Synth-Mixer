import type { ModuleNode, ModuleType, ParamValue, PortKind } from '../types';

export interface NumberParam {
  key: string;
  label: string;
  type: 'number';
  min: number;
  max: number;
  default: number;
  /** "log" for frequencies and times, so the slider spends its length where the ear hears the change. */
  scale: 'lin' | 'log';
  step?: number;
  unit: string;
  digits?: number;
}

export interface ChoiceParam {
  key: string;
  label: string;
  type: 'choice';
  options: { value: string; label: string }[];
  default: string;
}

export type ParamDef = NumberParam | ChoiceParam;

export interface PortDef {
  id: string;
  label: string;
  kind: PortKind;
  /** Only one cable may plug in (a second cable replaces the first). */
  single?: boolean;
  /** For mod inputs: the setting that says how strongly the incoming signal moves the target. */
  amount?: string;
}

export interface ModuleDef {
  type: ModuleType;
  label: string;
  blurb: string;
  inputs: PortDef[];
  outputs: PortDef[];
  params: ParamDef[];
  /** Every instrument has exactly one; it cannot be added again or removed. */
  fixed?: boolean;
}

const WAVES = [
  { value: 'sine', label: 'Sine' },
  { value: 'square', label: 'Square' },
  { value: 'sawtooth', label: 'Saw' },
  { value: 'triangle', label: 'Tri' },
];

export const MODULES: Record<ModuleType, ModuleDef> = {
  note: {
    type: 'note',
    label: 'Note input',
    blurb: 'The note from the keyboard or the arranger. Pitch is which note; Gate is on while the note is held.',
    inputs: [],
    outputs: [
      { id: 'pitch', label: 'Pitch', kind: 'pitch' },
      { id: 'gate', label: 'Gate', kind: 'gate' },
    ],
    params: [],
    fixed: true,
  },
  osc: {
    type: 'osc',
    label: 'Oscillator',
    blurb: 'The raw tone.',
    inputs: [
      { id: 'pitch', label: 'Pitch', kind: 'pitch', single: true },
      { id: 'pmod', label: 'Pitch mod', kind: 'mod', amount: 'pmodAmt' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { key: 'wave', label: 'Wave', type: 'choice', options: WAVES, default: 'sawtooth' },
      { key: 'tune', label: 'Tune', type: 'number', min: -24, max: 24, default: 0, scale: 'lin', step: 1, unit: 'st' },
      { key: 'fine', label: 'Fine', type: 'number', min: -100, max: 100, default: 0, scale: 'lin', step: 1, unit: 'ct' },
      { key: 'freq', label: 'Frequency', type: 'number', min: 20, max: 8000, default: 220, scale: 'log', unit: 'Hz' },
      { key: 'pmodAmt', label: 'Pitch mod amount', type: 'number', min: -24, max: 24, default: 2, scale: 'lin', step: 0.1, unit: 'st', digits: 1 },
    ],
  },
  noise: {
    type: 'noise',
    label: 'Noise',
    blurb: 'Hiss, for percussion and breathy sounds.',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [],
  },
  filter: {
    type: 'filter',
    label: 'Filter',
    blurb: 'Removes part of the sound above or below the cutoff.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'cmod', label: 'Cutoff mod', kind: 'mod', amount: 'cmodAmt' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      {
        key: 'mode',
        label: 'Type',
        type: 'choice',
        options: [
          { value: 'lowpass', label: 'Low-pass' },
          { value: 'highpass', label: 'High-pass' },
          { value: 'bandpass', label: 'Band-pass' },
        ],
        default: 'lowpass',
      },
      { key: 'cutoff', label: 'Cutoff', type: 'number', min: 20, max: 20000, default: 1800, scale: 'log', unit: 'Hz' },
      // A quality factor: 0.71 is flat, higher values ring at the cutoff. voice.ts converts it for each filter type.
      { key: 'q', label: 'Resonance', type: 'number', min: 0.1, max: 20, default: 0.707, scale: 'log', unit: '', digits: 2 },
      { key: 'cmodAmt', label: 'Cutoff mod amount', type: 'number', min: -6, max: 6, default: 2, scale: 'lin', step: 0.1, unit: 'oct', digits: 1 },
    ],
  },
  gain: {
    type: 'gain',
    label: 'Gain',
    blurb: 'Volume. Cables plugged into In add together, so it is also a mixer.',
    inputs: [
      { id: 'in', label: 'In', kind: 'audio' },
      { id: 'lmod', label: 'Level mod', kind: 'mod', amount: 'lmodAmt' },
    ],
    outputs: [{ id: 'out', label: 'Out', kind: 'audio' }],
    params: [
      { key: 'level', label: 'Level', type: 'number', min: 0, max: 1, default: 0.8, scale: 'lin', step: 0.01, unit: '', digits: 2 },
      { key: 'lmodAmt', label: 'Level mod amount', type: 'number', min: 0, max: 1, default: 1, scale: 'lin', step: 0.01, unit: '', digits: 2 },
    ],
  },
  env: {
    type: 'env',
    label: 'Envelope',
    blurb: 'Shapes a setting from key press to release: attack, decay, sustain, release.',
    inputs: [{ id: 'gate', label: 'Gate', kind: 'gate', single: true }],
    outputs: [{ id: 'out', label: 'Out', kind: 'mod' }],
    params: [
      { key: 'attack', label: 'Attack', type: 'number', min: 0.001, max: 5, default: 0.01, scale: 'log', unit: 's', digits: 3 },
      { key: 'decay', label: 'Decay', type: 'number', min: 0.001, max: 5, default: 0.25, scale: 'log', unit: 's', digits: 3 },
      { key: 'sustain', label: 'Sustain', type: 'number', min: 0, max: 1, default: 0.6, scale: 'lin', step: 0.01, unit: '', digits: 2 },
      { key: 'release', label: 'Release', type: 'number', min: 0.005, max: 8, default: 0.35, scale: 'log', unit: 's', digits: 3 },
    ],
  },
  lfo: {
    type: 'lfo',
    label: 'LFO',
    blurb: 'A slow oscillator that wobbles a setting.',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', kind: 'mod' }],
    params: [
      { key: 'wave', label: 'Wave', type: 'choice', options: WAVES, default: 'sine' },
      { key: 'rate', label: 'Rate', type: 'number', min: 0.05, max: 20, default: 5, scale: 'log', unit: 'Hz', digits: 2 },
      { key: 'depth', label: 'Depth', type: 'number', min: 0, max: 1, default: 0.5, scale: 'lin', step: 0.01, unit: '', digits: 2 },
    ],
  },
  output: {
    type: 'output',
    label: 'Output',
    blurb: 'The end of the chain. What reaches it is what you hear.',
    inputs: [{ id: 'in', label: 'In', kind: 'audio' }],
    outputs: [],
    params: [],
    fixed: true,
  },
};

/** Modules the user can add (Note input and Output come with every instrument). */
export const ADDABLE: ModuleType[] = ['osc', 'noise', 'filter', 'gain', 'env', 'lfo'];

export function defaultParams(type: ModuleType): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const p of MODULES[type].params) params[p.key] = p.default;
  return params;
}

export function paramValue(node: ModuleNode, key: string): ParamValue {
  const v = node.params[key];
  if (v !== undefined) return v;
  const def = MODULES[node.type].params.find((p) => p.key === key);
  return def ? def.default : 0;
}

export function num(node: ModuleNode, key: string): number {
  const v = paramValue(node, key);
  return typeof v === 'number' ? v : Number(v) || 0;
}

export function str(node: ModuleNode, key: string): string {
  return String(paramValue(node, key));
}

export function findPort(type: ModuleType, dir: 'in' | 'out', id: string) {
  const def = MODULES[type];
  return (dir === 'in' ? def.inputs : def.outputs).find((p) => p.id === id);
}
