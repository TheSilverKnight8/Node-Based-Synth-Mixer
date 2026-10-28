import { useEffect } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Pencil, Plus, SlidersHorizontal, Trash2, Volume2 } from 'lucide-react';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { KeyStrip } from '../components/KeyStrip';
import { Button, IconButton, cx } from '../components/ui';
import { NodeEditor } from '../editor/NodeEditor';
import { liveKeyboard } from '../lib/keyboard';
import { lastInstrument } from '../lib/session';
import { createInstrument, deleteInstrument, getState, projectsUsing, updateInstrument, useApp } from '../lib/store';

export function InstrumentsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const instruments = useApp((s) => s.instruments);
  const list = Object.values(instruments).sort((a, b) => a.name.localeCompare(b.name));
  const inst = id ? instruments[id] : undefined;

  useEffect(() => {
    if (!inst) return;
    lastInstrument.set(inst.id);
    // The computer keyboard plays the instrument on screen, as it is right now.
    liveKeyboard.setInstrument(() => getState().instruments[inst.id]);
    return () => liveKeyboard.setInstrument(() => undefined);
  }, [inst?.id]);

  if (!id || !inst) {
    const remembered = lastInstrument.get();
    const fallback = (remembered && instruments[remembered]) || list[0];
    if (fallback) return <Navigate to={`/instruments/${fallback.id}`} replace />;
  }

  const add = () => navigate(`/instruments/${createInstrument().id}`);

  const rename = async () => {
    if (!inst) return;
    const name = await promptDialog({ title: 'Rename instrument', label: 'Name', value: inst.name });
    if (name) updateInstrument(inst.id, (i) => ({ ...i, name }));
  };

  const remove = async () => {
    if (!inst) return;
    const users = projectsUsing('instrument', inst.id);
    const ok = await confirmDialog({
      title: `Delete “${inst.name}”?`,
      body: users.length ? (
        <>
          It is used in {users.map((p) => `“${p.name}”`).join(', ')}. Tracks that use it will show it as missing and stay silent until you pick another instrument.
        </>
      ) : (
        'No project uses it. The instrument file is removed from your folder.'
      ),
      confirm: 'Delete instrument',
      danger: true,
    });
    if (!ok) return;
    const next = list.find((i) => i.id !== inst.id);
    await deleteInstrument(inst.id);
    navigate(next ? `/instruments/${next.id}` : '/instruments', { replace: true });
  };

  return (
    <div className="flex h-full">
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <h2 className="text-lg">Instruments</h2>
          <IconButton label="New instrument" onClick={add}>
            <Plus className="size-4" />
          </IconButton>
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
          {list.map((i) => (
            <button
              key={i.id}
              onClick={() => navigate(`/instruments/${i.id}`)}
              className={cx('flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition', i.id === inst?.id ? 'bg-accent text-on-accent' : 'hover:bg-raised')}
            >
              <SlidersHorizontal className="size-4 shrink-0" />
              <span className="truncate">{i.name}</span>
            </button>
          ))}
        </div>
      </aside>

      {inst ? (
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line bg-bg px-4 py-3">
            <div className="min-w-0">
              <p className="label-caps text-accent">Node editor</p>
              <h1 className="truncate text-3xl">{inst.name}</h1>
            </div>
            <IconButton label="Rename" onClick={() => void rename()}>
              <Pencil className="size-4" />
            </IconButton>
            <IconButton label="Delete instrument" onClick={() => void remove()}>
              <Trash2 className="size-4" />
            </IconButton>
            <div className="flex-1" />
            <TestNote />
          </div>
          <NodeEditor inst={inst} />
          <KeyStrip instrumentName={inst.name} />
        </section>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center p-10 text-center">
          <SlidersHorizontal className="size-8 text-muted" />
          <h1 className="mt-3 text-3xl">No instruments yet</h1>
          <p className="mt-2 max-w-sm text-muted">A new instrument starts from the starter patch: Note input, Oscillator, Filter, Gain and Output, with an Envelope on the Gain.</p>
          <Button variant="primary" className="mt-6" onClick={add}>
            <Plus className="size-5" />
            New instrument
          </Button>
        </section>
      )}
    </div>
  );
}

/** Hold to hear middle C, for trying a patch without the keyboard. */
function TestNote() {
  return (
    <Button
      variant="navy"
      size="sm"
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        liveKeyboard.press('test-note', 60);
      }}
      onPointerUp={() => liveKeyboard.release('test-note')}
      onPointerCancel={() => liveKeyboard.release('test-note')}
      title="Plays middle C (C4) while held"
    >
      <Volume2 className="size-4" />
      Hold to test
    </Button>
  );
}
