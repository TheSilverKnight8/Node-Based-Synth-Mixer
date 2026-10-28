import { AlertTriangle, Copy, Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { TAGS, addTag, tagProblem } from '../lib/audio/tags';
import type { Timeline } from '../lib/music';
import type { Clip, ClipPlacement, Instrument, Note, TagId } from '../lib/types';
import { Button, IconButton, cx } from '../components/ui';

/** Tag switches for whatever is selected. A tag that cannot act on the track's instrument is shown as unavailable, with the reason. */
function TagToggles({ items, inst, onChange }: { items: { tags: TagId[] }[]; inst: Instrument | undefined; onChange: (fn: (tags: TagId[]) => TagId[]) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {TAGS.map((t) => {
        const count = items.filter((i) => i.tags.includes(t.id)).length;
        const state = count === 0 ? 'off' : count === items.length ? 'on' : 'mixed';
        const problem = tagProblem(t.id, inst);
        // An unavailable tag that is already attached can still be taken off.
        const disabled = !!problem && state === 'off';
        return (
          <button
            key={t.id}
            disabled={disabled}
            aria-pressed={state === 'on'}
            title={problem ?? t.effect}
            onClick={() => onChange((tags) => (state === 'on' ? tags.filter((x) => x !== t.id) : addTag(tags, t.id)))}
            className={cx(
              'flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition',
              problem
                ? state === 'off'
                  ? 'cursor-not-allowed border-dashed border-line text-muted/60 line-through decoration-muted/40'
                  : 'border-dashed border-warn bg-warn/10 text-warn'
                : state === 'on'
                  ? 'border-accent bg-accent text-on-accent'
                  : state === 'mixed'
                    ? 'border-accent/60 bg-accent/12 text-ink'
                    : 'border-line bg-surface text-ink hover:bg-raised',
            )}
          >
            <span className="truncate">{t.label}</span>
            {problem && state !== 'off' && <AlertTriangle className="size-3 shrink-0" />}
            {!problem && state === 'mixed' && <span className="text-[0.625rem] text-muted">some</span>}
          </button>
        );
      })}
    </div>
  );
}

function TagNotes({ inst }: { inst: Instrument | undefined }) {
  const problems = [...new Set(TAGS.map((t) => tagProblem(t.id, inst)).filter(Boolean))] as string[];
  if (!problems.length) return null;
  return (
    <ul className="mt-2 space-y-1 text-[0.6875rem] leading-snug text-muted">
      {problems.map((p) => (
        <li key={p} className="flex gap-1.5">
          <AlertTriangle className="mt-px size-3 shrink-0 text-warn" />
          {p}
        </li>
      ))}
    </ul>
  );
}

export function Inspector({
  inst,
  notes,
  placement,
  clips,
  timeline,
  canPlace,
  onNotesTags,
  onPlacementTags,
  onTranspose,
  onRemovePlacement,
  onDeleteNotes,
  onSaveClip,
  onPlaceClip,
  onRenameClip,
  onDeleteClip,
}: {
  inst: Instrument | undefined;
  notes: Note[];
  placement: ClipPlacement | null;
  clips: Record<string, Clip>;
  timeline: Timeline;
  canPlace: boolean;
  onNotesTags: (fn: (tags: TagId[]) => TagId[]) => void;
  onPlacementTags: (fn: (tags: TagId[]) => TagId[]) => void;
  onTranspose: (by: number) => void;
  onRemovePlacement: () => void;
  onDeleteNotes: () => void;
  onSaveClip: () => void;
  onPlaceClip: (clip: Clip) => void;
  onRenameClip: (clip: Clip) => void;
  onDeleteClip: (clip: Clip) => void;
}) {
  const clipList = Object.values(clips).sort((a, b) => a.name.localeCompare(b.name));
  const placedClip = placement ? clips[placement.clipId] : undefined;

  return (
    <aside className="scrollbar-thin flex w-72 shrink-0 flex-col overflow-y-auto border-l border-line bg-surface">
      <section className="border-b border-line p-4">
        <p className="label-caps text-accent">Selection</p>
        {placement ? (
          <>
            <h2 className="mt-1 truncate text-xl">{placedClip ? placedClip.name : `Missing: ${placement.clipName}`}</h2>
            <p className="text-xs text-muted">Clip, {timeline.label(placement.start)}</p>
            <div className="mt-3 flex items-center gap-2">
              <span className="text-xs font-medium text-muted">Pitch</span>
              <IconButton label="Down a semitone" onClick={() => onTranspose(-1)}>
                <Minus className="size-4" />
              </IconButton>
              <span className="w-16 text-center font-mono text-sm">{placement.transpose > 0 ? `+${placement.transpose}` : placement.transpose} st</span>
              <IconButton label="Up a semitone" onClick={() => onTranspose(1)}>
                <Plus className="size-4" />
              </IconButton>
            </div>
            <p className="mb-2 mt-4 text-xs font-medium text-muted">Tags (act on each note of the clip)</p>
            <TagToggles items={[placement]} inst={inst} onChange={onPlacementTags} />
            <TagNotes inst={inst} />
            <Button size="xs" variant="danger" className="mt-4" onClick={onRemovePlacement}>
              <Trash2 className="size-3.5" />
              Remove from track
            </Button>
          </>
        ) : notes.length ? (
          <>
            <h2 className="mt-1 text-xl">
              {notes.length} {notes.length === 1 ? 'note' : 'notes'}
            </h2>
            <p className="text-xs text-muted">Arrow keys move them (Shift: by an octave). Delete removes them.</p>
            <p className="mb-2 mt-4 text-xs font-medium text-muted">Tags</p>
            <TagToggles items={notes} inst={inst} onChange={onNotesTags} />
            <TagNotes inst={inst} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="xs" onClick={onSaveClip}>
                <Copy className="size-3.5" />
                Save as clip
              </Button>
              <Button size="xs" variant="danger" onClick={onDeleteNotes}>
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-2 space-y-1.5 text-sm text-muted">
            <p>Click the grid to add a note. Drag a note to move it, or its right end to change its length. Right-click a note to delete it.</p>
            <p>Shift-drag to select several notes. Select notes to add tags or save them as a clip.</p>
          </div>
        )}
      </section>

      <section className="p-4">
        <p className="label-caps text-accent">Clips</p>
        <p className="mt-1 text-xs text-muted">Saved groups of notes. They play with the instrument of the track they are placed on.</p>
        <div className="mt-3 space-y-1">
          {clipList.length === 0 && <p className="text-sm text-muted">No clips yet. Select notes and choose Save as clip.</p>}
          {clipList.map((c) => (
            <div key={c.id} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-[0.6875rem] text-muted">
                  {c.notes.length} {c.notes.length === 1 ? 'note' : 'notes'}
                </div>
              </div>
              <Button size="xs" variant="navy" disabled={!canPlace} onClick={() => onPlaceClip(c)} title="Place at the playhead on the selected track">
                Place
              </Button>
              <IconButton label={`Rename ${c.name}`} className="size-7" onClick={() => onRenameClip(c)}>
                <Pencil className="size-3.5" />
              </IconButton>
              <IconButton label={`Delete ${c.name}`} className="size-7" onClick={() => onDeleteClip(c)}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
