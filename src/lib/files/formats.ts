import { MODULES } from '../audio/modules';
import { createNode } from '../audio/graph';
import { DEFAULT_BPM } from '../music';
import { TAG_BY_ID } from '../audio/tags';
import type { Beats, Cable, Clip, ClipNote, ClipPlacement, Instrument, MeterChange, ModuleNode, ModuleType, Note, Project, TagId, TempoChange, Track } from '../types';

// Every file starts with what it is and a format version number. When the format
// changes, the version goes up and `upgrade` below learns to bring older files
// forward, so files saved today still open later.

export const FORMAT_VERSION = 1;

export type FileKind = 'project' | 'instrument' | 'clip';

const FORMAT: Record<FileKind, string> = {
  project: 'synth-studio-project',
  instrument: 'synth-studio-instrument',
  clip: 'synth-studio-clip',
};

export function serialize(kind: FileKind, data: Project | Instrument | Clip) {
  return JSON.stringify({ format: FORMAT[kind], version: FORMAT_VERSION, ...data }, null, 2) + '\n';
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; reason: string };

function read(kind: FileKind, text: string): Parsed<Record<string, unknown>> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'It is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'It is empty or not an object.' };
  const obj = raw as Record<string, unknown>;
  if (obj.format !== FORMAT[kind]) return { ok: false, reason: `It is not a Synth Studio ${kind} file.` };
  const version = Number(obj.version);
  if (!Number.isInteger(version) || version < 1) return { ok: false, reason: 'Its format version is missing.' };
  if (version > FORMAT_VERSION) return { ok: false, reason: `It was saved by a newer version of Synth Studio (format ${version}). Update the app to open it.` };
  return { ok: true, data: upgrade(obj, version) };
}

/** Brings an older file up to the current format, one version at a time. Version 1 is the first, so there is nothing to do yet. */
function upgrade(obj: Record<string, unknown>, _from: number) {
  return obj;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const n = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

function tags(v: unknown): TagId[] {
  return [...new Set(arr(v).filter((t): t is TagId => isStr(t) && t in TAG_BY_ID))];
}

export function parseInstrument(text: string): Parsed<Instrument> {
  const r = read('instrument', text);
  if (!r.ok) return r;
  const o = r.data;
  if (!isStr(o.id)) return { ok: false, reason: 'It has no ID.' };
  const nodes: ModuleNode[] = [];
  for (const item of arr(o.nodes)) {
    const x = rec(item);
    if (!isStr(x.id) || !isStr(x.type) || !(x.type in MODULES)) continue;
    const params: ModuleNode['params'] = {};
    for (const [k, v] of Object.entries(rec(x.params))) if (typeof v === 'number' || typeof v === 'string') params[k] = v;
    nodes.push({ id: x.id, type: x.type as ModuleType, x: n(x.x, 0), y: n(x.y, 0), params });
  }
  // Every instrument needs exactly one Note input and one Output.
  for (const type of ['note', 'output'] as const) {
    const found = nodes.filter((m) => m.type === type);
    if (!found.length) nodes.push(createNode(type, type === 'note' ? 24 : 984, 160));
    for (const extra of found.slice(1)) nodes.splice(nodes.indexOf(extra), 1);
  }
  const ids = new Set(nodes.map((m) => m.id));
  const cables: Cable[] = [];
  for (const item of arr(o.cables)) {
    const c = rec(item);
    const from = rec(c.from);
    const to = rec(c.to);
    if (!isStr(c.id) || !isStr(from.node) || !isStr(from.port) || !isStr(to.node) || !isStr(to.port)) continue;
    if (!ids.has(from.node) || !ids.has(to.node)) continue;
    cables.push({ id: c.id, from: { node: from.node, port: from.port }, to: { node: to.node, port: to.port } });
  }
  return { ok: true, data: { id: o.id, name: isStr(o.name) ? o.name : 'Untitled instrument', nodes, cables } };
}

function clipNotes(v: unknown): ClipNote[] {
  return arr(v)
    .map(rec)
    .map((x) => ({ pitch: Math.round(n(x.pitch, 60)), start: Math.max(0, n(x.start, 0)), length: n(x.length, 0) }))
    .filter((x) => x.length > 0);
}

export function parseClip(text: string): Parsed<Clip> {
  const r = read('clip', text);
  if (!r.ok) return r;
  const o = r.data;
  if (!isStr(o.id)) return { ok: false, reason: 'It has no ID.' };
  return { ok: true, data: { id: o.id, name: isStr(o.name) ? o.name : 'Untitled clip', notes: clipNotes(o.notes) } };
}

export function parseProject(text: string): Parsed<Project> {
  const r = read('project', text);
  if (!r.ok) return r;
  const o = r.data;
  if (!isStr(o.id)) return { ok: false, reason: 'It has no ID.' };
  const meters: MeterChange[] = arr(o.meters)
    .map(rec)
    .filter((m) => [3, 4, 5].includes(Number(m.beats)))
    .map((m) => ({ bar: Math.max(0, Math.round(n(m.bar, 0))), beats: Number(m.beats) as Beats }));
  const tempos: TempoChange[] = arr(o.tempos)
    .map(rec)
    .map((t) => ({ bar: Math.max(0, Math.round(n(t.bar, 0))), bpm: n(t.bpm, DEFAULT_BPM) }))
    .filter((t) => t.bpm > 0);
  const tracks: Track[] = arr(o.tracks)
    .map(rec)
    .filter((t) => isStr(t.id))
    .map((t) => ({
      id: t.id as string,
      name: isStr(t.name) ? t.name : 'Track',
      instrumentId: isStr(t.instrumentId) ? t.instrumentId : null,
      instrumentName: isStr(t.instrumentName) ? t.instrumentName : '',
      notes: arr(t.notes)
        .map(rec)
        .filter((x) => isStr(x.id))
        .map((x): Note => ({ id: x.id as string, pitch: Math.round(n(x.pitch, 60)), start: Math.max(0, n(x.start, 0)), length: n(x.length, 0), tags: tags(x.tags) }))
        .filter((x) => x.length > 0),
      clips: arr(t.clips)
        .map(rec)
        .filter((x) => isStr(x.id) && isStr(x.clipId))
        .map(
          (x): ClipPlacement => ({
            id: x.id as string,
            clipId: x.clipId as string,
            clipName: isStr(x.clipName) ? x.clipName : '',
            start: Math.max(0, n(x.start, 0)),
            transpose: Math.round(n(x.transpose, 0)),
            tags: tags(x.tags),
          }),
        ),
    }));
  return { ok: true, data: { id: o.id, name: isStr(o.name) ? o.name : 'Untitled project', meters, tempos, tracks } };
}
