import { midiToHz } from '../music';
import type { Instrument, ModuleNode, ParamValue, TagId } from '../types';
import { hasCableInto } from './graph';
import { num, str } from './modules';

export interface VoiceSpec {
  ctx: BaseAudioContext;
  inst: Instrument;
  midi: number;
  /** Context time the note starts. */
  when: number;
  /** Length in seconds, when it is known ahead (arranger notes). Live notes end when the key is let go. */
  duration?: number;
  tags?: TagId[];
  destination: AudioNode;
  noise: AudioBuffer;
}

type Input = AudioNode | AudioParam;

interface Runtime {
  outputs: Record<string, AudioNode>;
  inputs: Record<string, Input>;
  update?: (key: string, value: ParamValue, at: number) => void;
}

interface EnvState {
  src: ConstantSourceNode;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  gated: boolean;
}

const SMOOTH = 0.012; // seconds; settings glide to new values instead of jumping (no clicks)

/** Biquad Q is in decibels for low-pass and high-pass, and a plain quality factor for band-pass. */
function biquadQ(mode: string, resonance: number) {
  return mode === 'bandpass' ? resonance : 20 * Math.log10(Math.max(resonance, 0.0001));
}

/**
 * One sounding note: its own copy of the instrument's modules, wired the way the
 * cables say. Each held note gets one, so several notes can sound at once.
 */
export class Voice {
  readonly inst: Instrument;
  readonly when: number;
  released = false;
  ended = false;
  endAt = Infinity;
  onEnded?: () => void;

  private ctx: BaseAudioContext;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private runtimes = new Map<string, Runtime>();
  private envs: EnvState[] = [];
  private gate?: ConstantSourceNode;
  private click: GainNode;

  constructor(spec: VoiceSpec) {
    const { ctx, inst, midi, when } = spec;
    this.ctx = ctx;
    this.inst = inst;
    this.when = when;
    const hz = midiToHz(midi);

    for (const n of inst.nodes) this.runtimes.set(n.id, this.build(n, hz, spec));

    for (const c of inst.cables) {
      const a = this.runtimes.get(c.from.node);
      const b = this.runtimes.get(c.to.node);
      const out = a?.outputs[c.from.port];
      const inp = b?.inputs[c.to.port];
      // Gate into an Envelope is a trigger, handled when the envelope is built, not a signal.
      if (!out || !inp) continue;
      if (inp instanceof AudioParam) out.connect(inp);
      else out.connect(inp);
    }

    // Output → tag volume → tag shape → click guard → destination.
    const sum = this.runtimes.get(inst.nodes.find((n) => n.type === 'output')?.id ?? '')?.inputs.in as GainNode | undefined;
    const tagGain = this.gainNode(1);
    const shape = this.gainNode(1);
    this.click = this.gainNode(1);
    sum?.connect(tagGain);
    tagGain.connect(shape).connect(this.click).connect(spec.destination);

    this.applyTags(spec, hz, tagGain, shape);

    // A damaged file could leave a patch with nothing that plays; keep one source so the voice still ends and cleans up.
    if (!this.sources.length) this.constant(0);
    for (const s of this.sources) {
      if (s instanceof AudioBufferSourceNode && s.buffer) s.start(when, Math.random() * s.buffer.duration);
      else s.start(when);
    }
    // All sources stop together, so the first one ending means the voice is done.
    this.sources[0].onended = () => this.cleanup();

    if (spec.duration !== undefined) this.release(when + spec.duration);
  }

  private gainNode(gain: number) {
    const g = new GainNode(this.ctx, { gain });
    this.nodes.push(g);
    return g;
  }

  private constant(offset: number) {
    const c = new ConstantSourceNode(this.ctx, { offset });
    this.nodes.push(c);
    this.sources.push(c);
    return c;
  }

  private build(n: ModuleNode, hz: number, spec: VoiceSpec): Runtime {
    const ctx = this.ctx;
    const t = spec.when;
    switch (n.type) {
      case 'note': {
        const pitch = this.constant(hz);
        const gate = this.constant(0);
        gate.offset.setValueAtTime(0, t);
        gate.offset.setTargetAtTime(1, t, 0.002);
        this.gate = gate;
        return { outputs: { pitch, gate }, inputs: {} };
      }
      case 'osc': {
        const pitched = hasCableInto(this.inst, n.id, 'pitch');
        const wave = str(n, 'wave') as OscillatorType;
        const osc = new OscillatorNode(ctx, {
          type: wave,
          frequency: pitched ? 0 : num(n, 'freq'),
          detune: num(n, 'tune') * 100 + num(n, 'fine'),
        });
        this.nodes.push(osc);
        this.sources.push(osc);
        const pm = this.gainNode(num(n, 'pmodAmt') * 100);
        pm.connect(osc.detune);
        let tune = num(n, 'tune');
        let fine = num(n, 'fine');
        return {
          outputs: { out: osc },
          inputs: { pitch: osc.frequency, pmod: pm },
          update: (key, v, at) => {
            if (key === 'wave') osc.type = String(v) as OscillatorType;
            if (key === 'tune' || key === 'fine') {
              if (key === 'tune') tune = Number(v);
              else fine = Number(v);
              osc.detune.setTargetAtTime(tune * 100 + fine, at, SMOOTH);
            }
            if (key === 'freq' && !pitched) osc.frequency.setTargetAtTime(Number(v), at, SMOOTH);
            if (key === 'pmodAmt') pm.gain.setTargetAtTime(Number(v) * 100, at, SMOOTH);
          },
        };
      }
      case 'noise': {
        const src = new AudioBufferSourceNode(ctx, { buffer: spec.noise, loop: true });
        this.nodes.push(src);
        this.sources.push(src);
        return { outputs: { out: src }, inputs: {} };
      }
      case 'filter': {
        let mode = str(n, 'mode') as BiquadFilterType;
        let q = num(n, 'q');
        const f = new BiquadFilterNode(ctx, { type: mode, frequency: num(n, 'cutoff'), Q: biquadQ(mode, q) });
        this.nodes.push(f);
        const cm = this.gainNode(num(n, 'cmodAmt') * 1200);
        cm.connect(f.detune);
        return {
          outputs: { out: f },
          inputs: { in: f, cmod: cm },
          update: (key, v, at) => {
            if (key === 'mode') {
              mode = String(v) as BiquadFilterType;
              f.type = mode;
              f.Q.setTargetAtTime(biquadQ(mode, q), at, SMOOTH);
            }
            if (key === 'cutoff') f.frequency.setTargetAtTime(Number(v), at, SMOOTH);
            if (key === 'q') {
              q = Number(v);
              f.Q.setTargetAtTime(biquadQ(mode, q), at, SMOOTH);
            }
            if (key === 'cmodAmt') cm.gain.setTargetAtTime(Number(v) * 1200, at, SMOOTH);
          },
        };
      }
      case 'gain': {
        const level = this.gainNode(num(n, 'level'));
        // With a cable in Level mod, the volume follows that signal; without one, it is just Level.
        const vca = this.gainNode(hasCableInto(this.inst, n.id, 'lmod') ? 0 : 1);
        const lm = this.gainNode(num(n, 'lmodAmt'));
        level.connect(vca);
        lm.connect(vca.gain);
        return {
          outputs: { out: vca },
          inputs: { in: level, lmod: lm },
          update: (key, v, at) => {
            if (key === 'level') level.gain.setTargetAtTime(Number(v), at, SMOOTH);
            if (key === 'lmodAmt') lm.gain.setTargetAtTime(Number(v), at, SMOOTH);
          },
        };
      }
      case 'env': {
        // The browser has no envelope, so it is a constant signal whose value is scheduled to move.
        const src = this.constant(0);
        const env: EnvState = {
          src,
          attack: Math.max(0.001, num(n, 'attack')),
          decay: Math.max(0.001, num(n, 'decay')),
          sustain: num(n, 'sustain'),
          release: Math.max(0.005, num(n, 'release')),
          gated: hasCableInto(this.inst, n.id, 'gate'),
        };
        this.envs.push(env);
        if (env.gated) {
          src.offset.setValueAtTime(0, t);
          src.offset.linearRampToValueAtTime(1, t + env.attack);
          src.offset.setTargetAtTime(env.sustain, t + env.attack, env.decay / 4);
        }
        return {
          outputs: { out: src },
          // Listed so the cable counts as plugged in; the trigger is scheduled above.
          inputs: {},
          update: (key, v, at) => {
            const value = Number(v);
            if (key === 'attack') env.attack = Math.max(0.001, value);
            if (key === 'decay') env.decay = Math.max(0.001, value);
            if (key === 'release') env.release = Math.max(0.005, value);
            if (key === 'sustain') {
              env.sustain = value;
              // A held note already past its attack moves to the new sustain level.
              if (env.gated && !this.released && at > t + env.attack) {
                src.offset.cancelAndHoldAtTime(at);
                src.offset.setTargetAtTime(value, at, SMOOTH);
              }
            }
          },
        };
      }
      case 'lfo': {
        const osc = new OscillatorNode(ctx, { type: str(n, 'wave') as OscillatorType, frequency: num(n, 'rate') });
        this.nodes.push(osc);
        this.sources.push(osc);
        const depth = this.gainNode(num(n, 'depth'));
        osc.connect(depth);
        return {
          outputs: { out: depth },
          inputs: {},
          update: (key, v, at) => {
            if (key === 'wave') osc.type = String(v) as OscillatorType;
            if (key === 'rate') osc.frequency.setTargetAtTime(Number(v), at, SMOOTH);
            if (key === 'depth') depth.gain.setTargetAtTime(Number(v), at, SMOOTH);
          },
        };
      }
      case 'output': {
        const sum = this.gainNode(1);
        return { outputs: {}, inputs: { in: sum } };
      }
    }
  }

  private applyTags(spec: VoiceSpec, hz: number, tagGain: GainNode, shape: GainNode) {
    const tags = spec.tags ?? [];
    const dur = spec.duration;
    if (!tags.length || dur === undefined) return;
    const t = spec.when;
    const end = t + Math.max(dur, 0.01);
    const note = this.inst.nodes.find((n) => n.type === 'note');
    const pitch = note ? (this.runtimes.get(note.id)?.outputs.pitch as ConstantSourceNode | undefined) : undefined;

    const lfo = (rate: number, depth: number, target: AudioParam) => {
      const osc = new OscillatorNode(this.ctx, { frequency: rate });
      const g = this.gainNode(depth);
      this.nodes.push(osc);
      this.sources.push(osc);
      osc.connect(g).connect(target);
    };

    for (const tag of tags) {
      switch (tag) {
        case 'vibrato':
          if (pitch) lfo(5.5, hz * (2 ** (30 / 1200) - 1), pitch.offset);
          break;
        case 'tremolo':
          tagGain.gain.value = 0.65;
          lfo(6, 0.35, tagGain.gain);
          break;
        case 'swell':
          shape.gain.setValueAtTime(0, t);
          shape.gain.linearRampToValueAtTime(1, end);
          break;
        case 'fade':
          shape.gain.setValueAtTime(1, t);
          shape.gain.linearRampToValueAtTime(0, end);
          break;
        case 'bendUp':
        case 'bendDown':
          if (pitch) {
            pitch.offset.setValueAtTime(hz, t);
            pitch.offset.exponentialRampToValueAtTime(hz * 2 ** ((tag === 'bendUp' ? 2 : -2) / 12), end);
          }
          break;
        case 'filterOpen':
        case 'filterClose':
          for (const n of this.inst.nodes) {
            if (n.type !== 'filter') continue;
            const f = this.runtimes.get(n.id)?.outputs.out as BiquadFilterNode | undefined;
            if (!f) continue;
            const from = tag === 'filterOpen' ? -3600 : 0;
            f.detune.setValueAtTime(from, t);
            f.detune.linearRampToValueAtTime(-3600 - from, end);
          }
          break;
      }
    }
  }

  /** How long the sound goes on after release: the longest release of any triggered envelope. */
  private tail() {
    let tail = 0;
    for (const e of this.envs) if (e.gated) tail = Math.max(tail, e.release);
    return tail;
  }

  /** Lets go of the note. Envelopes run their release; then the voice stops. */
  release(at: number) {
    if (this.released) return;
    this.released = true;
    at = Math.max(at, this.when);
    this.gate?.offset.setTargetAtTime(0, at, 0.003);
    for (const e of this.envs) {
      if (!e.gated) continue;
      e.src.offset.cancelAndHoldAtTime(at);
      e.src.offset.setTargetAtTime(0, at, e.release / 5);
    }
    this.finish(at + this.tail());
  }

  /** Stops the voice quickly, even in the middle of a note (Stop button, too many voices). */
  kill(at: number) {
    if (this.ended || this.endAt <= at) return;
    this.released = true;
    if (at < this.when) {
      // Not started yet: never let it be heard.
      this.click.gain.cancelScheduledValues(0);
      this.click.gain.setValueAtTime(0, 0);
      for (const s of this.sources) s.stop(this.when);
      this.endAt = this.when;
      return;
    }
    this.finish(at);
  }

  private fadeAt = Infinity;

  /** A 15 ms fade to silence at `at`, then stop. The fade's start value is set outright: with nothing scheduled before it, Chrome would otherwise start the ramp at time zero and quieten the whole note. */
  private finish(at: number) {
    const g = this.click.gain;
    const from = at <= this.fadeAt ? 1 : Math.max(0, 1 - (at - this.fadeAt) / 0.015);
    g.cancelScheduledValues(at);
    g.setValueAtTime(from, at);
    g.linearRampToValueAtTime(0, at + 0.015);
    this.fadeAt = Math.min(this.fadeAt, at);
    for (const s of this.sources) s.stop(at + 0.03);
    this.endAt = at + 0.03;
  }

  /** A setting changed while the note plays. */
  update(nodeId: string, key: string, value: ParamValue, at: number) {
    this.runtimes.get(nodeId)?.update?.(key, value, Math.max(at, this.when));
  }

  private cleanup() {
    if (this.ended) return;
    this.ended = true;
    for (const n of this.nodes) n.disconnect();
    this.onEnded?.();
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Two seconds of white noise, shared by every Noise module in a context. */
export function noiseBuffer(ctx: BaseAudioContext) {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = new AudioBuffer({ length: ctx.sampleRate * 2, sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

let safetyCurve: Float32Array<ArrayBuffer> | null = null;

/**
 * A safety ceiling. Below 0.7 the sound passes unchanged; above it, peaks bend smoothly
 * toward 0.98 and never past it, even when many loud notes stack up. (The browser's
 * compressor was not used because it adds its own make-up gain, which flattens swells and tremolo.)
 */
function ceilingCurve() {
  if (safetyCurve) return safetyCurve;
  const n = 4096;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2; // the shaper's input runs -1..1 for a signal of -2..2
    const a = Math.abs(u);
    curve[i] = Math.sign(u) * (a <= 0.7 ? a : 0.7 + 0.28 * Math.tanh((a - 0.7) / 0.28));
  }
  return (safetyCurve = curve);
}

/** The end of every signal path: some headroom, then the safety ceiling. */
export function createMaster(ctx: BaseAudioContext) {
  const input = new GainNode(ctx, { gain: 0.5 });
  const toShaper = new GainNode(ctx, { gain: 0.5 });
  const ceiling = new WaveShaperNode(ctx, { curve: ceilingCurve() });
  input.connect(toShaper).connect(ceiling).connect(ctx.destination);
  return input;
}
