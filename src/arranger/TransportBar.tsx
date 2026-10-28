import { useEffect, useState } from 'react';
import { Circle, Download, Play, SkipBack, Square, ZoomIn, ZoomOut } from 'lucide-react';
import { GRIDS, MAX_BPM, METERS, MIN_BPM } from '../lib/music';
import type { Beats } from '../lib/types';
import { Button, IconButton, Kbd, Segmented, cx } from '../components/ui';

export function BpmInput({ value, onChange, className }: { value: number; onChange: (bpm: number) => void; className?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const n = Math.round(Number(text));
    if (Number.isFinite(n) && n > 0) onChange(Math.min(MAX_BPM, Math.max(MIN_BPM, n)));
    else setText(String(value));
  };
  return (
    <input
      type="number"
      min={MIN_BPM}
      max={MAX_BPM}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      className={cx('h-8 w-16 rounded-lg border border-line bg-raised px-2 text-center font-mono text-sm outline-none focus:border-navy focus:bg-surface', className)}
      aria-label="Tempo in beats per minute"
    />
  );
}

export function TransportBar({
  playing,
  recording,
  position,
  bpm,
  beats,
  changes,
  gridId,
  zoom,
  canRecord,
  exporting,
  onPlay,
  onStop,
  onRecord,
  onRewind,
  onBpm,
  onBeats,
  onGrid,
  onZoom,
  onExport,
}: {
  playing: boolean;
  recording: boolean;
  position: string;
  bpm: number;
  beats: Beats;
  changes: number;
  gridId: string;
  zoom: number;
  canRecord: boolean;
  exporting: boolean;
  onPlay: () => void;
  onStop: () => void;
  onRecord: () => void;
  onRewind: () => void;
  onBpm: (bpm: number) => void;
  onBeats: (b: Beats) => void;
  onGrid: (id: string) => void;
  onZoom: (by: number) => void;
  onExport: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-surface px-4 py-2">
      <div className="flex items-center gap-1">
        <IconButton label="Back to the start" onClick={onRewind}>
          <SkipBack className="size-4" />
        </IconButton>
        {playing ? (
          <Button size="sm" variant="navy" onClick={onStop} title="Stop (Space)">
            <Square className="size-3.5 fill-current" />
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="navy" onClick={onPlay} title="Play (Space)">
            <Play className="size-3.5 fill-current" />
            Play
          </Button>
        )}
        <Button
          size="sm"
          variant={recording ? 'primary' : 'secondary'}
          onClick={recording ? onStop : onRecord}
          disabled={!canRecord && !recording}
          title={canRecord ? 'Record the computer keyboard into the selected track. Notes snap to the grid.' : 'Select a track with an instrument to record into'}
        >
          <Circle className={cx('size-3.5', recording ? 'animate-pulse fill-current' : 'fill-accent text-accent')} />
          {recording ? 'Recording' : 'Record'}
        </Button>
        <span className="ml-2 w-36 font-mono text-sm tabular-nums" aria-live="off">
          {position}
        </span>
        <Kbd className="hidden xl:inline">Space</Kbd>
      </div>

      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        Tempo
        <BpmInput value={bpm} onChange={onBpm} />
        <span>BPM</span>
      </label>

      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        Time
        <Segmented size="sm" value={String(beats)} onChange={(v) => onBeats(Number(v) as Beats)} options={METERS.map((m) => ({ value: String(m), label: `${m}/4` }))} />
      </div>
      {changes > 0 && <span className="text-xs text-muted">+{changes} later {changes === 1 ? 'change' : 'changes'} (bar numbers)</span>}

      <label className="flex items-center gap-2 text-xs font-medium text-muted">
        Grid
        <select value={gridId} onChange={(e) => onGrid(e.target.value)} className="h-8 rounded-lg border border-line bg-raised px-2 text-sm text-ink outline-none focus:border-navy" aria-label="Grid size">
          {GRIDS.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>

      <div className="flex items-center">
        <IconButton label="Zoom out" onClick={() => onZoom(1 / 1.5)} disabled={zoom <= 12}>
          <ZoomOut className="size-4" />
        </IconButton>
        <IconButton label="Zoom in" onClick={() => onZoom(1.5)} disabled={zoom >= 256}>
          <ZoomIn className="size-4" />
        </IconButton>
      </div>

      <div className="flex-1" />
      <Button size="sm" onClick={onExport} loading={exporting} title="Render the whole piece to a WAV file">
        <Download className="size-4" />
        Export WAV
      </Button>
    </div>
  );
}
