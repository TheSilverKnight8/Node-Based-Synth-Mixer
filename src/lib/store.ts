import { useSyncExternalStore } from 'react';
import { starterInstrument } from './audio/graph';
import { AppFolder, type FileProblem } from './files/folder';
import type { FileKind } from './files/formats';
import { fileAccessSupported, forgetFolder, hasPermission, pickLocation, savedFolder } from './files/handles';
import { newId } from './ids';
import { DEFAULT_BPM } from './music';
import type { Clip, ClipNote, Instrument, Project, Track } from './types';

export type FolderStatus =
  | { kind: 'checking' }
  | { kind: 'unsupported' }
  | { kind: 'none' }
  | { kind: 'permission'; name: string }
  | { kind: 'loading'; name: string }
  | { kind: 'ready'; name: string }
  | { kind: 'error'; message: string };

export interface SaveStatus {
  state: 'saved' | 'saving' | 'error';
  message?: string;
}

export interface AppState {
  folder: FolderStatus;
  instruments: Record<string, Instrument>;
  clips: Record<string, Clip>;
  projects: Record<string, Project>;
  /** Files in the folder that could not be opened, and why. */
  problems: FileProblem[];
  save: SaveStatus;
}

let state: AppState = {
  folder: { kind: 'checking' },
  instruments: {},
  clips: {},
  projects: {},
  problems: [],
  save: { state: 'saved' },
};

const listeners = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getState() {
  return state;
}

/** Reads part of the app state and re-renders when it changes. The selector must return something already in the state (not a new object). */
export function useApp<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// ---------------------------------------------------------------- folder

let folder: AppFolder | null = null;
let pendingHandle: FileSystemDirectoryHandle | null = null;
/** The current file name of each saved thing, so a rename can remove the old file. */
const fileNames = new Map<string, string>();

export async function initFolder() {
  // Development only: ?opfs uses the browser's private storage instead of a real folder, for automated tests.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('opfs')) {
    const root = await navigator.storage.getDirectory();
    return load(await root.getDirectoryHandle('Synth Studio', { create: true }));
  }
  if (!fileAccessSupported()) return set({ folder: { kind: 'unsupported' } });
  const handle = await savedFolder();
  if (!handle) return set({ folder: { kind: 'none' } });
  try {
    if (await hasPermission(handle, false)) return load(handle);
  } catch {
    // The folder was moved or deleted since last time.
    return set({ folder: { kind: 'none' } });
  }
  pendingHandle = handle;
  set({ folder: { kind: 'permission', name: handle.name } });
}

/** The saved folder needs a click before Chrome lets the app use it again. */
export async function allowFolder() {
  if (!pendingHandle) return;
  try {
    if (await hasPermission(pendingHandle, true)) return load(pendingHandle);
  } catch (e) {
    return set({ folder: { kind: 'error', message: (e as Error).message } });
  }
}

export async function chooseFolder() {
  try {
    const handle = await pickLocation();
    await load(handle);
  } catch (e) {
    if ((e as DOMException).name === 'AbortError') return; // closed the picker
    set({ folder: { kind: 'error', message: (e as Error).message } });
  }
}

export async function changeFolder() {
  await flushSaves();
  await forgetFolder();
  folder = null;
  fileNames.clear();
  set({ folder: { kind: 'none' }, instruments: {}, clips: {}, projects: {}, problems: [] });
}

async function load(handle: FileSystemDirectoryHandle) {
  set({ folder: { kind: 'loading', name: handle.name } });
  try {
    const f = new AppFolder(handle);
    await f.open();
    const result = await f.loadAll();
    folder = f;
    fileNames.clear();
    const pick = <T>(kind: FileKind, items: Record<string, { data: T; file: string }>) => {
      const out: Record<string, T> = {};
      for (const [id, item] of Object.entries(items)) {
        out[id] = item.data;
        fileNames.set(`${kind}:${id}`, item.file);
      }
      return out;
    };
    set({
      folder: { kind: 'ready', name: handle.name },
      instruments: pick('instrument', result.instruments),
      clips: pick('clip', result.clips),
      projects: pick('project', result.projects),
      problems: result.problems,
    });
  } catch (e) {
    set({ folder: { kind: 'error', message: (e as Error).message } });
  }
}

// ---------------------------------------------------------------- saving

// Changes save by themselves half a second after the last edit.
const dirty = new Set<string>();
let timer: number | undefined;
let flushing: Promise<void> | null = null;

function markDirty(kind: FileKind, id: string) {
  dirty.add(`${kind}:${id}`);
  set({ save: { state: 'saving' } });
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushSaves(), 500);
}

export function flushSaves(): Promise<void> {
  window.clearTimeout(timer);
  if (flushing) return flushing.then(() => (dirty.size ? flushSaves() : undefined));
  if (!dirty.size || !folder) return Promise.resolve();
  const f = folder;
  flushing = (async () => {
    const keys = [...dirty];
    dirty.clear();
    try {
      for (const key of keys) {
        const [kind, id] = key.split(':') as [FileKind, string];
        const data = kind === 'project' ? withCurrentNames(state.projects[id]) : kind === 'instrument' ? state.instruments[id] : state.clips[id];
        if (!data) continue; // deleted since
        const name = await f.write(kind, data, fileNames.get(key));
        fileNames.set(key, name);
      }
      set({ save: { state: dirty.size ? 'saving' : 'saved' } });
    } catch (e) {
      for (const k of keys) dirty.add(k);
      set({ save: { state: 'error', message: (e as Error).message } });
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

export function hasUnsavedChanges() {
  return dirty.size > 0 || flushing !== null;
}

/** Keeps the names stored beside instrument and clip IDs current, for the message shown if a file later goes missing. */
function withCurrentNames(p: Project | undefined): Project | undefined {
  if (!p) return p;
  return {
    ...p,
    tracks: p.tracks.map((t) => ({
      ...t,
      instrumentName: (t.instrumentId && state.instruments[t.instrumentId]?.name) || t.instrumentName,
      clips: t.clips.map((c) => ({ ...c, clipName: state.clips[c.clipId]?.name ?? c.clipName })),
    })),
  };
}

async function removeFile(kind: FileKind, id: string) {
  const key = `${kind}:${id}`;
  dirty.delete(key);
  const file = fileNames.get(key);
  fileNames.delete(key);
  if (file && folder) await folder.remove(kind, file);
}

// ---------------------------------------------------------------- instruments

export function createInstrument(name = nextName('Instrument', Object.values(state.instruments).map((i) => i.name))) {
  const inst = starterInstrument(name);
  set({ instruments: { ...state.instruments, [inst.id]: inst } });
  markDirty('instrument', inst.id);
  return inst;
}

export function updateInstrument(id: string, fn: (inst: Instrument) => Instrument) {
  const inst = state.instruments[id];
  if (!inst) return;
  const next = fn(inst);
  if (next === inst) return;
  set({ instruments: { ...state.instruments, [id]: next } });
  markDirty('instrument', id);
}

export async function deleteInstrument(id: string) {
  set({ instruments: omit(state.instruments, id) });
  await removeFile('instrument', id);
}

// ---------------------------------------------------------------- clips

export function createClip(name: string, notes: ClipNote[]) {
  const clip: Clip = { id: newId(), name, notes };
  set({ clips: { ...state.clips, [clip.id]: clip } });
  markDirty('clip', clip.id);
  return clip;
}

export function renameClip(id: string, name: string) {
  const clip = state.clips[id];
  if (!clip) return;
  set({ clips: { ...state.clips, [id]: { ...clip, name } } });
  markDirty('clip', id);
}

export async function deleteClip(id: string) {
  set({ clips: omit(state.clips, id) });
  await removeFile('clip', id);
}

// ---------------------------------------------------------------- projects

export function newTrack(name: string, inst: Instrument | undefined): Track {
  return { id: newId(), name, instrumentId: inst?.id ?? null, instrumentName: inst?.name ?? '', notes: [], clips: [] };
}

export function createProject(name = nextName('Project', Object.values(state.projects).map((p) => p.name))) {
  // A new project starts with one track, so there is somewhere to put notes. It uses the first instrument, or a new one from the starter patch.
  const inst = Object.values(state.instruments).sort((a, b) => a.name.localeCompare(b.name))[0] ?? createInstrument();
  const project: Project = {
    id: newId(),
    name,
    meters: [{ bar: 0, beats: 4 }],
    tempos: [{ bar: 0, bpm: DEFAULT_BPM }],
    tracks: [newTrack('Track 1', inst)],
  };
  set({ projects: { ...state.projects, [project.id]: project } });
  markDirty('project', project.id);
  return project;
}

export function updateProject(id: string, fn: (p: Project) => Project) {
  const p = state.projects[id];
  if (!p) return;
  const next = fn(p);
  if (next === p) return;
  set({ projects: { ...state.projects, [id]: next } });
  markDirty('project', id);
}

export async function deleteProject(id: string) {
  set({ projects: omit(state.projects, id) });
  await removeFile('project', id);
}

/** Projects that use an instrument or a clip, for the warning before deleting it. */
export function projectsUsing(kind: 'instrument' | 'clip', id: string) {
  return Object.values(state.projects).filter((p) =>
    p.tracks.some((t) => (kind === 'instrument' ? t.instrumentId === id : t.clips.some((c) => c.clipId === id))),
  );
}

export function nextName(base: string, taken: string[]) {
  const used = new Set(taken);
  for (let i = 1; ; i++) if (!used.has(`${base} ${i}`)) return `${base} ${i}`;
}

function omit<T>(items: Record<string, T>, id: string) {
  const out = { ...items };
  delete out[id];
  return out;
}
