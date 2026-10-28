// Remembers the app's folder between visits. Chrome lets a site keep a folder
// handle in IndexedDB; on the next visit the app asks for permission again, and
// "Allow on every visit" makes that automatic (Chrome 122 and newer).

const DB_NAME = 'synth-studio';
const STORE = 'handles';
const KEY = 'app-folder';

/** The folder the app makes inside the location the user picks. */
export const APP_FOLDER = 'Synth Studio';
export const SUBFOLDERS = { projects: 'Projects', instruments: 'Instruments', clips: 'Clips' } as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function savedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return ((await idb('readonly', (s) => s.get(KEY))) as FileSystemDirectoryHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function rememberFolder(handle: FileSystemDirectoryHandle) {
  await idb('readwrite', (s) => s.put(handle, KEY));
}

export async function forgetFolder() {
  await idb('readwrite', (s) => s.delete(KEY));
}

export function fileAccessSupported() {
  return typeof window.showDirectoryPicker === 'function';
}

export async function hasPermission(handle: FileSystemDirectoryHandle, ask: boolean) {
  const opts = { mode: 'readwrite' as const };
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  if (!ask) return false;
  return (await handle.requestPermission(opts)) === 'granted';
}

/**
 * Asks the user for a location and makes the app's folder there. If they pick the
 * app's folder itself (for example after moving it), it is used as it is.
 */
export async function pickLocation(): Promise<FileSystemDirectoryHandle> {
  const picked = await window.showDirectoryPicker!({ id: 'synth-studio', mode: 'readwrite', startIn: 'documents' });
  const folder = picked.name === APP_FOLDER || (await looksLikeAppFolder(picked)) ? picked : await picked.getDirectoryHandle(APP_FOLDER, { create: true });
  await rememberFolder(folder);
  return folder;
}

async function looksLikeAppFolder(dir: FileSystemDirectoryHandle) {
  try {
    await dir.getDirectoryHandle(SUBFOLDERS.projects);
    await dir.getDirectoryHandle(SUBFOLDERS.instruments);
    return true;
  } catch {
    return false;
  }
}
