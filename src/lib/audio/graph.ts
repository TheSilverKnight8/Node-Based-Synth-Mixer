import { newId } from '../ids';
import type { Cable, Instrument, ModuleNode, ModuleType, PortRef } from '../types';
import { MODULES, defaultParams, findPort } from './modules';

export type ConnectResult = { ok: true; replaces?: string } | { ok: false; reason: string };

function node(inst: Instrument, id: string) {
  return inst.nodes.find((n) => n.id === id);
}

/**
 * Says whether a cable from an output to an input makes sense, and why not if it doesn't.
 * The rules:
 * - Audio goes into audio inputs or mod inputs (audio into a mod input wobbles that setting very fast).
 * - Envelope and LFO outputs (mod) go into mod inputs only. Into an audio input they would be a silent push, not a sound.
 * - Gate goes into an Envelope's Gate, or into a mod input (on while held, off after).
 * - Pitch goes into an Oscillator's Pitch input only.
 * - No loops: a signal may never come back to where it started. In Chrome a loop keeps feeding itself and can get very loud.
 */
export function canConnect(inst: Instrument, from: PortRef, to: PortRef): ConnectResult {
  const a = node(inst, from.node);
  const b = node(inst, to.node);
  if (!a || !b) return { ok: false, reason: 'That module no longer exists.' };
  const out = findPort(a.type, 'out', from.port);
  const inp = findPort(b.type, 'in', to.port);
  if (!out || !inp) return { ok: false, reason: 'Connect an output (right side of a module) to an input (left side).' };
  if (a.id === b.id) return { ok: false, reason: 'A module cannot feed itself. That would make a loop.' };

  const fromKind = out.kind;
  const toKind = inp.kind;
  if (toKind === 'audio' && fromKind !== 'audio') {
    if (fromKind === 'pitch') return { ok: false, reason: 'Pitch says which note to play; it is not a sound. Connect it to an Oscillator’s Pitch input.' };
    if (fromKind === 'gate') return { ok: false, reason: 'Gate only says when a key is held; it is not a sound. Connect it to an Envelope’s Gate input.' };
    return { ok: false, reason: `${MODULES[a.type].label} output moves settings; it is not a sound. Connect it to a mod input (red socket).` };
  }
  if (toKind === 'pitch' && fromKind !== 'pitch') return { ok: false, reason: 'The Pitch input only takes the Note input’s Pitch.' };
  if (toKind === 'gate' && fromKind !== 'gate') return { ok: false, reason: 'The Gate input only takes the Note input’s Gate.' };
  if (toKind === 'mod' && fromKind === 'pitch') return { ok: false, reason: 'Pitch goes into an Oscillator’s Pitch input.' };

  if (inst.cables.some((c) => same(c.from, from) && same(c.to, to))) return { ok: false, reason: 'These are already connected.' };
  if (reaches(inst, b.id, a.id)) return { ok: false, reason: 'This cable would make a loop: the signal would feed back into itself, which can get very loud. Loops are not allowed.' };

  const replaces = inp.single ? inst.cables.find((c) => same(c.to, to))?.id : undefined;
  return { ok: true, replaces };
}

function same(a: PortRef, b: PortRef) {
  return a.node === b.node && a.port === b.port;
}

/** True if a signal leaving `start` can arrive at `target` by following cables. */
export function reaches(inst: Instrument, start: string, target: string) {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const c of inst.cables) if (c.from.node === id) stack.push(c.to.node);
  }
  return false;
}

export function connect(inst: Instrument, from: PortRef, to: PortRef): { inst: Instrument; result: ConnectResult } {
  const result = canConnect(inst, from, to);
  if (!result.ok) return { inst, result };
  const cables = inst.cables.filter((c) => c.id !== result.replaces);
  cables.push({ id: newId(8), from, to });
  return { inst: { ...inst, cables }, result };
}

/** Modules whose signal can reach the Output, so changes to them can be heard. */
export function audibleNodes(inst: Instrument) {
  const out = inst.nodes.find((n) => n.type === 'output');
  const set = new Set<string>();
  if (!out) return set;
  const stack = [out.id];
  while (stack.length) {
    const id = stack.pop()!;
    if (set.has(id)) continue;
    set.add(id);
    for (const c of inst.cables) if (c.to.node === id) stack.push(c.from.node);
  }
  return set;
}

export function hasCableInto(inst: Instrument, nodeId: string, port: string) {
  return inst.cables.some((c) => c.to.node === nodeId && c.to.port === port);
}

/** Plain-language notes about a patch that will not do what it looks like. They do not block anything. */
export function patchWarnings(inst: Instrument): string[] {
  const warnings: string[] = [];
  const audible = audibleNodes(inst);
  const output = inst.nodes.find((n) => n.type === 'output');
  if (output && !hasCableInto(inst, output.id, 'in')) warnings.push('Nothing is connected to Output, so this instrument makes no sound.');
  const note = inst.nodes.find((n) => n.type === 'note');
  if (note && !inst.cables.some((c) => c.from.node === note.id && c.from.port === 'pitch' && audible.has(c.to.node)))
    warnings.push('The Note input’s Pitch is not connected to an Oscillator you can hear, so every key plays the same pitch.');
  for (const n of inst.nodes) {
    if (n.type === 'env' && !hasCableInto(inst, n.id, 'gate')) warnings.push('An Envelope has no Gate cable, so it never starts and stays at zero.');
  }
  return [...new Set(warnings)];
}

export function createNode(type: ModuleType, x: number, y: number): ModuleNode {
  return { id: newId(8), type, x, y, params: defaultParams(type) };
}

/** Note input → Oscillator → Filter → Gain → Output, with an Envelope on the Gain. */
export function starterInstrument(name: string): Instrument {
  // Laid out left to right so it fits a laptop screen; the Envelope sits under the Filter, next to the Gain it shapes.
  const note = createNode('note', 24, 160);
  const osc = createNode('osc', 264, 40);
  const filter = createNode('filter', 504, 40);
  const env = createNode('env', 504, 400);
  const gain = createNode('gain', 744, 40);
  const output = createNode('output', 984, 40);
  const cable = (from: [ModuleNode, string], to: [ModuleNode, string]): Cable => ({
    id: newId(8),
    from: { node: from[0].id, port: from[1] },
    to: { node: to[0].id, port: to[1] },
  });
  return {
    id: newId(),
    name,
    nodes: [note, osc, env, filter, gain, output],
    cables: [
      cable([note, 'pitch'], [osc, 'pitch']),
      cable([note, 'gate'], [env, 'gate']),
      cable([osc, 'out'], [filter, 'in']),
      cable([filter, 'out'], [gain, 'in']),
      cable([env, 'out'], [gain, 'lmod']),
      cable([gain, 'out'], [output, 'in']),
    ],
  };
}
