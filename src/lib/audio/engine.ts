import type { Instrument, ParamValue, TagId } from '../types';
import { Voice, createMaster, noiseBuffer } from './voice';

/** More voices than this at once and the oldest are stopped, so the computer keeps up. */
const MAX_VOICES = 96;

/** The live audio: keyboard notes, test notes, and arranger playback all go through here. */
class Engine {
  private ctx?: AudioContext;
  private master?: AudioNode;
  private voices = new Set<Voice>();

  /** The audio context, created on first use. Browsers only allow sound after a click or key press, which is when this is first called. */
  context() {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = createMaster(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  get now() {
    return this.context().currentTime;
  }

  play(inst: Instrument, midi: number, opts: { when?: number; duration?: number; tags?: TagId[] } = {}) {
    const ctx = this.context();
    const voice = new Voice({
      ctx,
      inst,
      midi,
      when: Math.max(opts.when ?? ctx.currentTime, ctx.currentTime),
      duration: opts.duration,
      tags: opts.tags,
      destination: this.master!,
      noise: noiseBuffer(ctx),
    });
    voice.onEnded = () => this.voices.delete(voice);
    this.voices.add(voice);
    if (this.voices.size > MAX_VOICES) {
      const oldest = [...this.voices].filter((v) => !v.ended).sort((a, b) => a.when - b.when)[0];
      oldest?.kill(ctx.currentTime);
    }
    return voice;
  }

  /** A setting changed in the node editor: every sounding note of that instrument follows. */
  update(instId: string, nodeId: string, key: string, value: ParamValue) {
    if (!this.ctx) return;
    const at = this.ctx.currentTime;
    for (const v of this.voices) if (v.inst.id === instId && !v.ended) v.update(nodeId, key, value, at);
  }

  activeVoices() {
    return [...this.voices].filter((v) => !v.ended).length;
  }
}

export const engine = new Engine();
