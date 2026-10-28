import { useSyncExternalStore } from 'react';
import { Minus, Plus } from 'lucide-react';
import { BLACK_KEYS, MAX_OCTAVE, MIN_OCTAVE, WHITE_KEYS, liveKeyboard } from '../lib/keyboard';
import { noteName } from '../lib/music';
import { IconButton, cx } from './ui';

const WHITE_W = 34;

/** Redraws when the live keyboard changes (octave or keys held). */
export function useLiveKeyboard() {
  useSyncExternalStore(
    (fn) => liveKeyboard.subscribe(fn),
    () => liveKeyboard.version,
  );
  return liveKeyboard;
}

/**
 * The computer keyboard's piano layout, drawn as a piano. Shows which letter plays
 * which note, the current octave, and the keys being held. Keys can be clicked too.
 */
export function KeyStrip({ instrumentName, note }: { instrumentName?: string; note?: string }) {
  const kb = useLiveKeyboard();
  const held = kb.heldPitches();
  const low = kb.midiFor(0);
  const high = kb.midiFor(17);

  const press = (midi: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    kb.press(`pointer-${e.pointerId}`, midi);
  };
  const release = (e: React.PointerEvent) => kb.release(`pointer-${e.pointerId}`);

  return (
    <div className="flex items-center gap-4 border-t border-line bg-surface px-4 py-2">
      <div className="relative h-14 shrink-0 select-none" style={{ width: WHITE_KEYS.length * WHITE_W }} aria-label="Computer keyboard layout">
        {WHITE_KEYS.map((k, i) => {
          const midi = kb.midiFor(k.semitone);
          return (
            <button
              key={k.code}
              tabIndex={-1}
              onPointerDown={press(midi)}
              onPointerUp={release}
              onPointerCancel={release}
              className={cx(
                'absolute top-0 flex h-14 flex-col items-center justify-end rounded-b-md border border-line pb-1 font-mono text-[0.6875rem] transition-colors',
                held.has(midi) ? 'bg-accent text-on-accent' : 'bg-bg text-ink hover:bg-raised',
              )}
              style={{ left: i * WHITE_W, width: WHITE_W - 1 }}
              title={noteName(midi)}
            >
              <span className="font-semibold">{k.label}</span>
              {midi % 12 === 0 && <span className="text-[0.5625rem] opacity-70">{noteName(midi)}</span>}
            </button>
          );
        })}
        {BLACK_KEYS.map((k) => {
          const midi = kb.midiFor(k.semitone);
          // A black key sits on the line between the two white keys around it.
          const leftWhite = WHITE_KEYS.findIndex((w) => w.semitone === k.semitone - 1);
          return (
            <button
              key={k.code}
              tabIndex={-1}
              onPointerDown={press(midi)}
              onPointerUp={release}
              onPointerCancel={release}
              className={cx(
                'absolute top-0 z-10 flex h-8 items-end justify-center rounded-b-md pb-0.5 font-mono text-[0.625rem] font-semibold transition-colors',
                held.has(midi) ? 'bg-accent text-on-accent' : 'bg-navy text-on-accent hover:brightness-125',
              )}
              style={{ left: (leftWhite + 1) * WHITE_W - 11, width: 21 }}
              title={noteName(midi)}
            >
              {k.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1">
        <IconButton label="Octave down (Left Shift)" onClick={() => kb.shiftOctave(-1)} disabled={kb.octave <= MIN_OCTAVE}>
          <Minus className="size-4" />
        </IconButton>
        <div className="w-24 text-center">
          <div className="label-caps text-muted">Octave</div>
          <div className="font-mono text-sm">
            {noteName(low)}–{noteName(high)}
          </div>
        </div>
        <IconButton label="Octave up (Right Shift)" onClick={() => kb.shiftOctave(1)} disabled={kb.octave >= MAX_OCTAVE}>
          <Plus className="size-4" />
        </IconButton>
      </div>

      <div className="min-w-0 text-sm leading-snug">
        <div className="truncate">
          {instrumentName ? (
            <>
              Playing <span className="font-semibold">{instrumentName}</span>
            </>
          ) : (
            <span className="text-warn">{note ?? 'No instrument to play.'}</span>
          )}
        </div>
        <div className="truncate text-xs text-muted">Left Shift: octave down · Right Shift: octave up</div>
      </div>
    </div>
  );
}
