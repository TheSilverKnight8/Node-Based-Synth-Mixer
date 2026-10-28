import { Timeline } from '../music';
import type { Project } from '../types';
import { buildEvents, type Library } from './events';
import { Voice, createMaster, noiseBuffer } from './voice';

const SAMPLE_RATE = 48000;

/**
 * Renders the whole piece offline, faster than real time, with the same voices the
 * arranger plays. Returns null if nothing in the project can sound.
 */
export async function renderProject(project: Project, lib: Library): Promise<AudioBuffer | null> {
  const timeline = new Timeline(project);
  const events = buildEvents(project, lib, timeline);
  if (!events.length) return null;

  // Leave room after the last note for the longest envelope release.
  let tail = 0.1;
  for (const inst of Object.values(lib.instruments))
    for (const n of inst.nodes) if (n.type === 'env') tail = Math.max(tail, Number(n.params.release ?? 0) + 0.1);
  const seconds = events.reduce((m, e) => Math.max(m, e.end), 0) + tail;

  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * SAMPLE_RATE), sampleRate: SAMPLE_RATE });
  const master = createMaster(ctx);
  const noise = noiseBuffer(ctx);
  for (const ev of events) {
    const inst = lib.instruments[ev.instId];
    if (!inst) continue;
    new Voice({ ctx, inst, midi: ev.pitch, when: ev.start, duration: ev.end - ev.start, tags: ev.tags, destination: master, noise });
  }
  return ctx.startRendering();
}

/** 16-bit PCM WAV. */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const view = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}
