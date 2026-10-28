import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import { BarPopover } from '../arranger/BarPopover';
import { Inspector } from '../arranger/Inspector';
import { Lanes, type PlacementSel } from '../arranger/Lanes';
import { HEAD_W, RULER_H, makeBars, type View } from '../arranger/layout';
import { PianoRoll, type PendingNote } from '../arranger/PianoRoll';
import { TransportBar } from '../arranger/TransportBar';
import { confirmDialog, notify, promptDialog } from '../components/dialogs';
import { KeyStrip } from '../components/KeyStrip';
import { ButtonLink } from '../components/ui';
import { projectEndTick } from '../lib/audio/events';
import { encodeWav, renderProject } from '../lib/audio/render';
import { transport } from '../lib/audio/transport';
import { newId } from '../lib/ids';
import { liveKeyboard } from '../lib/keyboard';
import { GRIDS, MAX_PITCH, MIN_PITCH, PPQ, Timeline } from '../lib/music';
import { lastProject } from '../lib/session';
import { createClip, deleteClip, getState, newTrack, nextName, projectsUsing, renameClip, updateProject, useApp } from '../lib/store';
import type { Beats, Clip, Project, TagId, Track } from '../lib/types';

export function ProjectPage() {
  const { id = '' } = useParams();
  const project = useApp((s) => s.projects[id]);
  if (!project)
    return (
      <div className="p-10">
        <h1 className="text-4xl">Project not found</h1>
        <p className="mt-2 text-muted">It may have been deleted, or its file moved out of the Projects folder.</p>
        <ButtonLink to="/" variant="primary" className="mt-6">
          Back to projects
        </ButtonLink>
      </div>
    );
  return <Arranger key={project.id} project={project} />;
}

function Arranger({ project }: { project: Project }) {
  const instruments = useApp((s) => s.instruments);
  const clips = useApp((s) => s.clips);
  const [trackId, setTrackId] = useState<string | null>(project.tracks[0]?.id ?? null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [placement, setPlacement] = useState<PlacementSel | null>(null);
  const [gridId, setGridId] = useState('1/8');
  const [zoom, setZoom] = useState(48); // pixels per quarter note
  const [cursorTick, setCursorTick] = useState(0);
  const [playTick, setPlayTick] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingNote[]>([]);
  const [barPop, setBarPop] = useState<{ bar: number; x: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const lanesRef = useRef<HTMLDivElement>(null);
  const rollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef(trackId);
  trackRef.current = trackId;

  const track = project.tracks.find((t) => t.id === trackId) ?? null;
  const inst = track?.instrumentId ? instruments[track.instrumentId] : undefined;
  const grid = GRIDS.find((g) => g.id === gridId)!.ticks;
  const timeline = useMemo(() => new Timeline(project), [project.meters, project.tempos]);
  const lib = useMemo(() => ({ instruments, clips }), [instruments, clips]);

  const status = useSyncExternalStore(
    (fn) => transport.subscribe(fn),
    () => (transport.recording ? 'recording' : transport.playing ? 'playing' : 'stopped'),
  );
  const playing = status !== 'stopped';

  const endTick = projectEndTick(project, clips);
  const bars = useMemo(() => makeBars(timeline, Math.max(endTick, cursorTick, playTick ?? 0)), [timeline, endTick, cursorTick, playTick]);
  const ppt = zoom / PPQ;
  const view: View = { timeline, ppt, bars, width: bars[bars.length - 1].end * ppt, grid };

  const update = useCallback((fn: (p: Project) => Project) => updateProject(project.id, fn), [project.id]);
  const updateTrack = useCallback((tid: string, fn: (t: Track) => Track) => update((p) => ({ ...p, tracks: p.tracks.map((t) => (t.id === tid ? fn(t) : t)) })), [update]);

  useEffect(() => {
    lastProject.set(project.id);
    // The computer keyboard plays the selected track's instrument.
    liveKeyboard.setInstrument(() => {
      const t = getState().projects[project.id]?.tracks.find((x) => x.id === trackRef.current);
      return t?.instrumentId ? getState().instruments[t.instrumentId] : undefined;
    });
    return () => {
      liveKeyboard.setInstrument(() => undefined);
      transport.stop();
    };
  }, [project.id]);

  // Edits during playback (notes, instruments, tempo) are heard from the next scheduled note on.
  useEffect(() => transport.update(project, lib), [project, lib]);

  // Playhead: follows the audio clock while playing, and keeps itself on screen. The lines move
  // every frame; the rest of the screen (position, notes being recorded) updates ten times a second.
  useEffect(() => {
    if (!playing) {
      setPlayTick(null);
      return;
    }
    let raf = 0;
    let lastRender = 0;
    const frame = (now: number) => {
      const tick = transport.positionTick();
      const left = `${tick * ppt}px`;
      for (const el of rootRef.current?.querySelectorAll<HTMLElement>('[data-playhead]') ?? []) el.style.left = left;
      if (now - lastRender > 100) {
        lastRender = now;
        setPlayTick(tick);
      }
      for (const el of [lanesRef.current, rollRef.current]) {
        if (!el) continue;
        const x = tick * ppt;
        const visible = el.clientWidth - HEAD_W;
        if (x > el.scrollLeft + visible - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 80);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing, ppt]);

  // ---- recording: computer-keyboard notes go into the selected track, snapped to the grid
  const recordTrack = useRef<string | null>(null);
  const held = useRef(new Map<number, number>()); // pitch -> start tick (not yet snapped)
  const lastTick = useRef(0);
  if (playTick !== null) lastTick.current = playTick;

  const finishNote = useCallback(
    (pitch: number, start: number, end: number) => {
      const tid = recordTrack.current;
      if (!tid) return;
      const s = timeline.snap(start, grid, 'round');
      let e = timeline.snap(end, grid, 'round');
      if (e <= s) e = timeline.nextLine(s, grid);
      if (pitch < MIN_PITCH || pitch > MAX_PITCH) return;
      updateTrack(tid, (t) => ({ ...t, notes: [...t.notes, { id: newId(), pitch, start: s, length: e - s, tags: [] }] }));
    },
    [timeline, grid, updateTrack],
  );

  useEffect(
    () =>
      liveKeyboard.onNote((e) => {
        if (!transport.recording) return;
        const tick = transport.ctxTimeToTick(e.time);
        if (e.type === 'on') held.current.set(e.midi, tick);
        else {
          const start = held.current.get(e.midi);
          held.current.delete(e.midi);
          if (start !== undefined) finishNote(e.midi, start, tick);
        }
        setPending([...held.current].map(([pitch, start]) => ({ pitch, start })));
      }),
    [finishNote],
  );

  // Keys still held when recording stops end where it stopped.
  useEffect(() => {
    if (status === 'recording' || !held.current.size) return;
    for (const [pitch, start] of held.current) finishNote(pitch, start, lastTick.current);
    held.current.clear();
    setPending([]);
  }, [status, finishNote]);

  const play = (record = false) => {
    if (playing) transport.stop();
    recordTrack.current = record ? trackId : null;
    held.current.clear();
    setPending([]);
    transport.play(project, lib, cursorTick, record);
  };
  const stop = () => {
    lastTick.current = transport.positionTick();
    transport.stop();
  };

  // ---- selection helpers
  const selectTrack = (tid: string) => {
    if (tid !== trackId) {
      setSelection(new Set());
      setPlacement(null);
    }
    setTrackId(tid);
  };
  const selectedNotes = track ? track.notes.filter((n) => selection.has(n.id)) : [];
  const selectedPlacement = placement ? (project.tracks.find((t) => t.id === placement.trackId)?.clips.find((c) => c.id === placement.id) ?? null) : null;

  const setNoteTags = (fn: (tags: TagId[]) => TagId[]) => track && updateTrack(track.id, (t) => ({ ...t, notes: t.notes.map((n) => (selection.has(n.id) ? { ...n, tags: fn(n.tags) } : n)) }));
  const updatePlacement = (fn: (c: Track['clips'][number]) => Track['clips'][number]) =>
    placement && updateTrack(placement.trackId, (t) => ({ ...t, clips: t.clips.map((c) => (c.id === placement.id ? fn(c) : c)) }));

  const deleteSelected = () => {
    if (placement) {
      updateTrack(placement.trackId, (t) => ({ ...t, clips: t.clips.filter((c) => c.id !== placement.id) }));
      setPlacement(null);
    } else if (track && selection.size) {
      updateTrack(track.id, (t) => ({ ...t, notes: t.notes.filter((n) => !selection.has(n.id)) }));
      setSelection(new Set());
    }
  };

  const nudge = (dTicks: number, dPitch: number) => {
    if (placement) {
      updatePlacement((c) => ({ ...c, start: Math.max(0, dTicks ? timeline.snap(c.start + dTicks, grid, 'round') : c.start), transpose: c.transpose + dPitch }));
      return;
    }
    if (!track || !selection.size) return;
    const sel = track.notes.filter((n) => selection.has(n.id));
    const lo = Math.min(...sel.map((n) => n.pitch));
    const hi = Math.max(...sel.map((n) => n.pitch));
    if (lo + dPitch < MIN_PITCH || hi + dPitch > MAX_PITCH) return;
    if (Math.min(...sel.map((n) => n.start)) + dTicks < 0) return;
    updateTrack(track.id, (t) => ({
      ...t,
      notes: t.notes.map((n) => (selection.has(n.id) ? { ...n, pitch: n.pitch + dPitch, start: dTicks ? timeline.snap(n.start + dTicks, grid, 'round') : n.start } : n)),
    }));
  };

  // ---- keyboard shortcuts (letter keys are the live keyboard, so these use Space, arrows and Delete)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    const t = e.target as HTMLElement;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t.isContentEditable) return;
    if (document.querySelector('[role="dialog"]')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (playing) stop();
      else play();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      nudge(0, (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      nudge(e.key === 'ArrowRight' ? grid : -grid, 0);
    } else if (e.key === 'Escape') {
      setSelection(new Set());
      setPlacement(null);
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && track) {
      e.preventDefault();
      setPlacement(null);
      setSelection(new Set(track.notes.map((n) => n.id)));
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- tracks
  const addTrack = () => {
    const firstInst = Object.values(instruments).sort((a, b) => a.name.localeCompare(b.name))[0];
    const t = newTrack(nextName('Track', project.tracks.map((x) => x.name)), inst ?? firstInst);
    update((p) => ({ ...p, tracks: [...p.tracks, t] }));
    selectTrack(t.id);
  };
  const removeTrack = async (t: Track) => {
    if (t.notes.length || t.clips.length) {
      const ok = await confirmDialog({ title: `Delete “${t.name}”?`, body: 'Its notes and clip placements are removed from this project. Clips stay in your clip list.', confirm: 'Delete track', danger: true });
      if (!ok) return;
    }
    update((p) => ({ ...p, tracks: p.tracks.filter((x) => x.id !== t.id) }));
    if (trackId === t.id) selectTrack(project.tracks.find((x) => x.id !== t.id)?.id ?? '');
  };
  const renameTrack = async (t: Track) => {
    const name = await promptDialog({ title: 'Rename track', label: 'Name', value: t.name });
    if (name) updateTrack(t.id, (x) => ({ ...x, name }));
  };

  // ---- clips
  const saveClip = async () => {
    if (!selectedNotes.length) return;
    const name = await promptDialog({ title: 'Save as clip', label: 'Clip name', value: nextName('Clip', Object.values(clips).map((c) => c.name)), confirm: 'Save clip' });
    if (!name) return;
    // Clip notes count from the bar line before the first note, so placing the clip on a bar line keeps the rhythm.
    const base = timeline.barStart(timeline.barAt(Math.min(...selectedNotes.map((n) => n.start))));
    createClip(name, selectedNotes.map((n) => ({ pitch: n.pitch, start: n.start - base, length: n.length })));
    notify(`Saved clip “${name}”. Place it on any track from the Clips list.`);
  };
  const placeClip = (clip: Clip) => {
    if (!track) return;
    const pl = { id: newId(), clipId: clip.id, clipName: clip.name, start: timeline.snap(cursorTick, grid, 'floor'), transpose: 0, tags: [] };
    updateTrack(track.id, (t) => ({ ...t, clips: [...t.clips, pl] }));
    setSelection(new Set());
    setPlacement({ trackId: track.id, id: pl.id });
  };
  const renameClipAsk = async (clip: Clip) => {
    const name = await promptDialog({ title: 'Rename clip', label: 'Name', value: clip.name });
    if (name) renameClip(clip.id, name);
  };
  const deleteClipAsk = async (clip: Clip) => {
    const users = projectsUsing('clip', clip.id);
    const ok = await confirmDialog({
      title: `Delete clip “${clip.name}”?`,
      body: users.length
        ? `It is placed in ${users.map((p) => `“${p.name}”`).join(', ')}. Those placements will show it as missing and play nothing.`
        : 'It is not placed anywhere. The clip file is removed from your folder.',
      confirm: 'Delete clip',
      danger: true,
    });
    if (ok) await deleteClip(clip.id);
  };

  // ---- export
  const exportWav = async () => {
    setExporting(true);
    try {
      const buffer = await renderProject(project, lib);
      if (!buffer) {
        notify('There is nothing to export yet: no track has notes and an instrument.', 'warn');
        return;
      }
      const blob = encodeWav(buffer);
      const suggestedName = `${project.name}.wav`;
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({ suggestedName, types: [{ description: 'WAV audio', accept: { 'audio/wav': ['.wav'] } }] });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = suggestedName;
        a.click();
        URL.revokeObjectURL(a.href);
      }
      notify(`Exported “${suggestedName}” (${buffer.duration.toFixed(1)} seconds).`);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') notify(`Export failed: ${(e as Error).message}`, 'warn');
    } finally {
      setExporting(false);
    }
  };

  const closeBarPop = useCallback(() => setBarPop(null), []);

  // ---- missing files
  const missingInst = project.tracks.filter((t) => t.instrumentId && !instruments[t.instrumentId]);
  const missingClips = project.tracks.flatMap((t) => t.clips.filter((c) => !clips[c.clipId]).map((c) => ({ track: t, clip: c })));

  const syncScroll = (from: 'lanes' | 'roll') => () => {
    const a = from === 'lanes' ? lanesRef.current : rollRef.current;
    const b = from === 'lanes' ? rollRef.current : lanesRef.current;
    if (a && b && b.scrollLeft !== a.scrollLeft) b.scrollLeft = a.scrollLeft;
  };

  const firstBeats = timeline.beatsInBar(0);
  const changes = timeline.meters.length - 1 + timeline.tempos.length - 1;

  return (
    <div ref={rootRef} className="flex h-full flex-col">
      <TransportBar
        playing={playing}
        recording={status === 'recording'}
        position={timeline.label(playTick ?? cursorTick)}
        bpm={timeline.bpmAtBar(0)}
        beats={firstBeats}
        changes={changes}
        gridId={gridId}
        zoom={zoom}
        canRecord={!!inst}
        exporting={exporting}
        onPlay={() => play()}
        onStop={stop}
        onRecord={() => play(true)}
        onRewind={() => {
          setCursorTick(0);
          for (const el of [lanesRef.current, rollRef.current]) if (el) el.scrollLeft = 0;
        }}
        onBpm={(bpm) => update((p) => ({ ...p, tempos: [...p.tempos.filter((t) => t.bar !== 0), { bar: 0, bpm }].sort((a, b) => a.bar - b.bar) }))}
        onBeats={(beats: Beats) => update((p) => ({ ...p, meters: [...p.meters.filter((m) => m.bar !== 0), { bar: 0, beats }].sort((a, b) => a.bar - b.bar) }))}
        onGrid={setGridId}
        onZoom={(by) => setZoom((z) => Math.min(256, Math.max(12, Math.round(z * by))))}
        onExport={() => void exportWav()}
      />

      {(missingInst.length > 0 || missingClips.length > 0) && (
        <div className="flex items-start gap-2 border-b border-warn/30 bg-warn/8 px-4 py-2 text-sm text-warn" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <span className="font-semibold">Some files this project uses are missing from your folder. </span>
            {missingInst.map((t) => (
              <span key={t.id}>
                Instrument “{t.instrumentName || 'unnamed'}” (track “{t.name}”).{' '}
              </span>
            ))}
            {[...new Map(missingClips.map((m) => [m.clip.clipId, m])).values()].map((m) => (
              <span key={m.clip.clipId}>Clip “{m.clip.clipName || 'unnamed'}”. </span>
            ))}
            Those parts stay silent until the file is back or you choose a replacement.
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Lanes
            view={view}
            project={project}
            instruments={instruments}
            clips={clips}
            selectedTrack={trackId}
            selectTrack={selectTrack}
            placement={placement}
            selectPlacement={(p) => {
              setPlacement(p);
              if (p) setSelection(new Set());
            }}
            updateTrack={updateTrack}
            addTrack={addTrack}
            removeTrack={(t) => void removeTrack(t)}
            renameTrack={(t) => void renameTrack(t)}
            cursorTick={cursorTick}
            playTick={playTick}
            onSeek={(tick) => {
              if (playing) stop();
              setCursorTick(tick);
            }}
            onBar={(bar, x) => setBarPop({ bar, x })}
            scrollRef={lanesRef}
            onScroll={syncScroll('lanes')}
          />
          {track ? (
            <PianoRoll
              view={view}
              track={track}
              inst={inst}
              clips={clips}
              selection={selection}
              setSelection={(s) => {
                setSelection(s);
                if (s.size) setPlacement(null);
              }}
              updateTrack={(fn) => updateTrack(track.id, fn)}
              cursorTick={cursorTick}
              playTick={playTick}
              pending={status === 'recording' && recordTrack.current === track.id ? pending : []}
              scrollRef={rollRef}
              onScroll={syncScroll('roll')}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-muted">Add a track to start placing notes.</div>
          )}
        </div>
        <Inspector
          inst={placement ? (() => {
            const t = project.tracks.find((x) => x.id === placement.trackId);
            return t?.instrumentId ? instruments[t.instrumentId] : undefined;
          })() : inst}
          notes={selectedNotes}
          placement={selectedPlacement}
          clips={clips}
          timeline={timeline}
          canPlace={!!track}
          onNotesTags={setNoteTags}
          onPlacementTags={(fn) => updatePlacement((c) => ({ ...c, tags: fn(c.tags) }))}
          onTranspose={(by) => updatePlacement((c) => ({ ...c, transpose: Math.max(-48, Math.min(48, c.transpose + by)) }))}
          onRemovePlacement={deleteSelected}
          onDeleteNotes={deleteSelected}
          onSaveClip={() => void saveClip()}
          onPlaceClip={placeClip}
          onRenameClip={(c) => void renameClipAsk(c)}
          onDeleteClip={(c) => void deleteClipAsk(c)}
        />
      </div>

      <KeyStrip
        instrumentName={inst?.name}
        note={!track ? 'Select a track to play its instrument.' : track.instrumentId ? `The instrument “${track.instrumentName}” is missing.` : 'This track has no instrument. Choose one in the track list.'}
      />

      {barPop && (
        <BarPopover
          bar={barPop.bar}
          x={barPop.x}
          top={(lanesRef.current?.getBoundingClientRect().top ?? 120) + RULER_H + 4}
          timeline={timeline}
          update={update}
          onClose={closeBarPop}
        />
      )}
    </div>
  );
}
