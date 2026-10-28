// Small things the app remembers on this computer between visits (not part of any file).
// Browser storage can be unavailable, so every read and write is allowed to fail.

function stored(key: string) {
  return {
    get(): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(value: string | null) {
      try {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      } catch {
        // not remembered; nothing else depends on it
      }
    },
  };
}

/** The project last opened, for the Arranger link in the top bar. */
export const lastProject = stored('synth-studio:last-project');
/** The instrument last open in the node editor. */
export const lastInstrument = stored('synth-studio:last-instrument');
