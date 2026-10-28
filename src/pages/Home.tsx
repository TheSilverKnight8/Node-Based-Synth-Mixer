import { useNavigate } from 'react-router';
import { AlertTriangle, FileWarning, FolderOpen, Music, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import { confirmDialog, promptDialog } from '../components/dialogs';
import { Button, ButtonLink, Card, IconButton, Spinner } from '../components/ui';
import { APP_NAME } from '../config';
import { APP_FOLDER } from '../lib/files/handles';
import { lastProject } from '../lib/session';
import { allowFolder, changeFolder, chooseFolder, createProject, deleteProject, updateProject, useApp } from '../lib/store';

/** Shown until the app has a folder to keep its files in. */
export function FolderSetup() {
  const folder = useApp((s) => s.folder);

  if (folder.kind === 'checking' || folder.kind === 'loading')
    return (
      <div className="flex items-center gap-3 py-20 text-muted">
        <Spinner />
        {folder.kind === 'loading' ? `Opening “${folder.name}”` : 'Starting'}
      </div>
    );

  return (
    <div className="max-w-2xl animate-rise">
      <p className="label-caps text-accent">Before you start</p>
      <h1 className="mt-2 text-5xl lg:text-6xl">Where should your music live?</h1>
      {folder.kind === 'unsupported' ? (
        <Card className="mt-8 p-6">
          <h2 className="text-xl">This browser cannot save files here</h2>
          <p className="mt-2 text-muted">
            {APP_NAME} keeps your projects as files in a folder you choose. That needs the File System Access API, which Chrome on a computer has. Open
            this page in Chrome to use the app.
          </p>
        </Card>
      ) : folder.kind === 'permission' ? (
        <>
          <p className="mt-4 text-lg text-muted">
            Your files are in the folder “{folder.name}”. Chrome asks for permission again when the app opens. Choose <strong className="text-ink">Allow on every visit</strong> so it
            stops asking.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="primary" size="lg" onClick={() => void allowFolder()}>
              <FolderOpen className="size-5" />
              Open “{folder.name}”
            </Button>
            <Button size="lg" onClick={() => void chooseFolder()}>
              Choose a different location
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-4 text-lg text-muted">
            Pick a place on your computer once. The app makes a folder called “{APP_FOLDER}” there and keeps your projects, instruments and clips in it as
            files.
          </p>
          {folder.kind === 'error' && (
            <p className="mt-4 flex items-start gap-2 rounded-xl border border-warn/35 bg-warn/10 p-3 text-sm text-warn">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              The folder could not be opened: {folder.message}
            </p>
          )}
          <Button variant="primary" size="lg" className="mt-8" onClick={() => void chooseFolder()}>
            <FolderOpen className="size-5" />
            Choose a location
          </Button>
        </>
      )}
    </div>
  );
}

export function Home() {
  const navigate = useNavigate();
  const projects = useApp((s) => s.projects);
  const instruments = useApp((s) => s.instruments);
  const clips = useApp((s) => s.clips);
  const problems = useApp((s) => s.problems);
  const folder = useApp((s) => s.folder);
  const list = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));

  const rename = async (id: string, name: string) => {
    const next = await promptDialog({ title: 'Rename project', label: 'Name', value: name });
    if (next) updateProject(id, (p) => ({ ...p, name: next }));
  };
  const remove = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `Delete “${name}”?`,
      body: 'The project file is removed from your folder. Its instruments and clips stay, because other projects can use them.',
      confirm: 'Delete project',
      danger: true,
    });
    if (!ok) return;
    if (lastProject.get() === id) lastProject.set(null);
    await deleteProject(id);
  };

  return (
    <div className="animate-rise">
      <p className="label-caps text-accent">Projects</p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-5xl lg:text-6xl">Your projects</h1>
        <Button variant="primary" onClick={() => navigate(`/project/${createProject().id}`)}>
          <Plus className="size-5" />
          New project
        </Button>
      </div>
      <p className="mt-3 text-muted">Open a project to arrange it. Build sounds under Instruments; every project can use them.</p>

      <div className="mt-8 grid gap-3">
        {list.length === 0 && (
          <Card className="flex flex-col items-center px-6 py-12 text-center">
            <Music className="size-8 text-muted" />
            <h2 className="mt-3 text-xl">No projects yet</h2>
            <p className="mt-1 max-w-sm text-sm text-muted">A new project starts with one track and an instrument from the starter patch.</p>
          </Card>
        )}
        {list.map((p) => {
          const missing = p.tracks.filter((t) => t.instrumentId && !instruments[t.instrumentId]).length + p.tracks.reduce((m, t) => m + t.clips.filter((c) => !clips[c.clipId]).length, 0);
          return (
            <Card key={p.id} className="flex items-center gap-4 p-4 transition hover:border-navy/40">
              <button className="flex min-w-0 flex-1 items-center gap-4 text-left" onClick={() => navigate(`/project/${p.id}`)}>
                <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-raised text-ink">
                  <Music className="size-6" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-display text-xl uppercase tracking-wide">{p.name}</span>
                  <span className="block text-sm text-muted">
                    {p.tracks.length} {p.tracks.length === 1 ? 'track' : 'tracks'}
                    {missing > 0 && <span className="text-warn"> · {missing} missing {missing === 1 ? 'file' : 'files'}</span>}
                  </span>
                </span>
              </button>
              <IconButton label="Rename" onClick={() => void rename(p.id, p.name)}>
                <Pencil className="size-4" />
              </IconButton>
              <IconButton label="Delete" onClick={() => void remove(p.id, p.name)}>
                <Trash2 className="size-4" />
              </IconButton>
            </Card>
          );
        })}
      </div>

      {problems.length > 0 && (
        <Card className="mt-8 border-warn/35 p-5">
          <h2 className="flex items-center gap-2 text-lg text-warn">
            <FileWarning className="size-5" />
            Some files could not be opened
          </h2>
          <ul className="mt-2 space-y-1 text-sm">
            {problems.map((x) => (
              <li key={x.folder + x.file}>
                <span className="font-medium">
                  {x.folder}/{x.file}
                </span>
                <span className="text-muted">: {x.reason}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Card className="p-5">
          <p className="label-caps text-muted">Instruments</p>
          <p className="mt-1 text-sm text-muted">
            {Object.keys(instruments).length} saved. Change one and it changes in every project that uses it.
          </p>
          <ButtonLink to="/instruments" size="sm" className="mt-4">
            <SlidersHorizontal className="size-4" />
            Open instruments
          </ButtonLink>
        </Card>
        <Card className="p-5">
          <p className="label-caps text-muted">Files</p>
          <p className="mt-1 text-sm text-muted">
            Saved in the folder “{folder.kind === 'ready' ? folder.name : APP_FOLDER}”, in Projects, Instruments and Clips. Changes save by themselves.
          </p>
          <Button size="sm" className="mt-4" onClick={() => void changeFolder()}>
            <FolderOpen className="size-4" />
            Use a different location
          </Button>
        </Card>
      </div>
    </div>
  );
}
