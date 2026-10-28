import type { Clip, Instrument, Project } from '../types';
import { SUBFOLDERS } from './handles';
import { parseClip, parseInstrument, parseProject, serialize, type FileKind, type Parsed } from './formats';

export interface Loaded<T> {
  data: T;
  file: string;
}

export interface FileProblem {
  folder: string;
  file: string;
  reason: string;
}

export interface LoadResult {
  instruments: Record<string, Loaded<Instrument>>;
  clips: Record<string, Loaded<Clip>>;
  projects: Record<string, Loaded<Project>>;
  problems: FileProblem[];
}

const DIR_FOR: Record<FileKind, keyof typeof SUBFOLDERS> = { project: 'projects', instrument: 'instruments', clip: 'clips' };

/** A file name people can read, with the ID on the end so two things with the same name never share a file. */
export function fileNameFor(name: string, id: string) {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return `${safe || 'Untitled'} (${id}).json`;
}

/** The app's folder on disk: Projects, Instruments and Clips, each a folder of JSON files. */
export class AppFolder {
  readonly root: FileSystemDirectoryHandle;
  private dirs = {} as Record<keyof typeof SUBFOLDERS, FileSystemDirectoryHandle>;
  private queue = new Map<string, Promise<unknown>>();

  constructor(root: FileSystemDirectoryHandle) {
    this.root = root;
  }

  async open() {
    for (const [key, name] of Object.entries(SUBFOLDERS) as [keyof typeof SUBFOLDERS, string][]) {
      this.dirs[key] = await this.root.getDirectoryHandle(name, { create: true });
    }
  }

  async loadAll(): Promise<LoadResult> {
    const problems: FileProblem[] = [];
    const instruments = await this.readDir('instruments', parseInstrument, problems);
    const clips = await this.readDir('clips', parseClip, problems);
    const projects = await this.readDir('projects', parseProject, problems);
    return { instruments, clips, projects, problems };
  }

  private async readDir<T extends { id: string }>(key: keyof typeof SUBFOLDERS, parse: (text: string) => Parsed<T>, problems: FileProblem[]) {
    const out: Record<string, Loaded<T> & { modified: number }> = {};
    for await (const [name, handle] of this.dirs[key].entries()) {
      if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.json')) continue;
      try {
        const file = await (handle as FileSystemFileHandle).getFile();
        const result = parse(await file.text());
        if (!result.ok) {
          problems.push({ folder: SUBFOLDERS[key], file: name, reason: result.reason });
          continue;
        }
        const prev = out[result.data.id];
        if (prev) {
          // Two files with the same ID (a copied file): keep the newer one.
          const keepNew = file.lastModified > prev.modified;
          problems.push({ folder: SUBFOLDERS[key], file: keepNew ? prev.file : name, reason: `It has the same ID as “${keepNew ? name : prev.file}”, so it was skipped.` });
          if (!keepNew) continue;
        }
        out[result.data.id] = { data: result.data, file: name, modified: file.lastModified };
      } catch (e) {
        problems.push({ folder: SUBFOLDERS[key], file: name, reason: `It could not be read (${(e as Error).message}).` });
      }
    }
    return out as Record<string, Loaded<T>>;
  }

  /** Writes a file and returns its name. If the name changed (renamed), the old file is removed after the new one is safely written. */
  write(kind: FileKind, data: Project | Instrument | Clip, previousFile?: string): Promise<string> {
    const key = `${kind}:${data.id}`;
    const run = async () => {
      const dir = this.dirs[DIR_FOR[kind]];
      const name = fileNameFor(data.name, data.id);
      const handle = await dir.getFileHandle(name, { create: true });
      const w = await handle.createWritable();
      await w.write(serialize(kind, data));
      await w.close();
      if (previousFile && previousFile !== name) await this.removeQuietly(dir, previousFile);
      return name;
    };
    // Writes to the same file wait their turn, so an older version never lands last.
    const next = (this.queue.get(key) ?? Promise.resolve()).catch(() => {}).then(run);
    this.queue.set(key, next);
    return next;
  }

  async remove(kind: FileKind, file: string) {
    await this.removeQuietly(this.dirs[DIR_FOR[kind]], file);
  }

  private async removeQuietly(dir: FileSystemDirectoryHandle, file: string) {
    try {
      await dir.removeEntry(file);
    } catch (e) {
      if ((e as DOMException).name !== 'NotFoundError') throw e;
    }
  }
}
