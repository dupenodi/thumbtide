// Rotor Brawl sound, all synthesised with WebAudio (no files: nothing to load in the offline TV app).
//
// Effects: hits by material (iron thud + ring, steel clang, wood knock), clashes, stun, disarm, K.O. explosion, a
// rotor hum that follows the machines' speed and a whoosh that follows the fastest weapon. Stings for the announcer.
// Music: a looped drum-and-bass groove in A minor pentatonic, sparse in the warm-up and full in the fight.
// Slow motion closes a low-pass filter over everything, so big hits sound heavy and muffled.

import type { Material } from "./weapons.ts";

export type Sting = "round" | "count" | "fight" | "ko" | "win" | "champ";
export type MusicMood = "warm" | "fight" | "off";

export interface GameAudio {
  hit(dmg: number, impact: number, cut: number, material: Material): void;
  clash(impact: number): void;
  stun(): void;
  disarm(): void;
  pickup(): void;
  /** A gunshot (bullet) or a mortar blast (ball). */
  shot(ball: boolean): void;
  ko(): void;
  sting(kind: Sting, n?: number): void;
  /** Per frame: average machine speed and fastest weapon speed (0–1 each), and the time warp (1 normal, 0.3 slow). */
  frame(speed: number, swing: number, warp: number): void;
  music(mood: MusicMood): void;
  setMusicOn(on: boolean): void;
  pause(on: boolean): void;
  dispose(): void;
}

const BPM = 112;
const STEP = 60 / BPM / 4; // a 16th note
/** Bar roots in semitones from A (A, F, G, E). */
const ROOTS = [0, -4, -2, -5];
/** Bass pattern over 16 steps: semitone offsets from the root, null = rest. */
const BASS: (number | null)[] = [0, null, 0, 12, null, 0, 7, null, 0, null, 10, null, 7, null, 5, 3];
const hz = (semis: number, base = 55) => base * 2 ** (semis / 12);

/** lite (the TV): no hi-hats and a single partial for metal rings, to save audio-thread time. */
export function createGameAudio(ctx: AudioContext | null, opts: { lite?: boolean } = {}): GameAudio | null {
  if (!ctx) return null;
  const c = ctx;
  const lite = !!opts.lite;

  // master → slow-motion low-pass → compressor → speakers
  const master = c.createGain();
  master.gain.value = 0.9;
  const slowmo = c.createBiquadFilter();
  slowmo.type = "lowpass";
  slowmo.frequency.value = 18000;
  slowmo.Q.value = 0.7;
  const squash = c.createDynamicsCompressor();
  squash.threshold.value = -14;
  squash.knee.value = 8;
  squash.ratio.value = 5;
  squash.attack.value = 0.003;
  squash.release.value = 0.2;
  master.connect(slowmo).connect(squash).connect(c.destination);

  const sfx = c.createGain();
  sfx.gain.value = 0.9;
  sfx.connect(master);
  const mus = c.createGain();
  mus.gain.value = 0.32;
  mus.connect(master);

  // one second of white noise, shared by every noisy sound
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  {
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  const now = () => c.currentTime;
  /** Too many sounds at once cost the TV and just sound like mush: a few voices per 60 ms at most. */
  let budgetAt = 0;
  let budget = 0;
  const allow = (cost = 1) => {
    const t = now();
    if (t - budgetAt > 0.06) {
      budgetAt = t;
      budget = 0;
    }
    budget += cost;
    return budget <= 4;
  };

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };
  const tone = (type: OscillatorType, f0: number, f1: number, t: number, peak: number, decay: number, dest: AudioNode = sfx, attack = 0.003) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + decay);
    const g = c.createGain();
    env(g, t, peak, attack, decay);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + attack + decay + 0.02);
  };
  const burst = (t: number, filter: BiquadFilterType, freq: number, q: number, peak: number, decay: number, dest: AudioNode = sfx, sweepTo?: number) => {
    const s = c.createBufferSource();
    s.buffer = noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = c.createGain();
    env(g, t, peak, 0.002, decay);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.5);
    s.stop(t + decay + 0.05);
  };
  /** A metal ring: a few inharmonic partials with a fast decay. */
  const PARTIALS = lite ? ([[1, 1]] as const) : ([[1, 1], [2.76, 0.5], [5.4, 0.25]] as const);
  const ring = (t: number, base: number, peak: number, decay: number) => {
    for (const [ratio, amp] of PARTIALS) {
      tone("triangle", base * ratio, base * ratio * 0.995, t, peak * amp, decay * (1 - ratio * 0.08));
    }
  };

  // ---- continuous: rotor hum and swing whoosh --------------------------------------------------
  const hum = c.createOscillator();
  hum.type = "sawtooth";
  hum.frequency.value = 52;
  const humFilter = c.createBiquadFilter();
  humFilter.type = "lowpass";
  humFilter.frequency.value = 260;
  const humGain = c.createGain();
  humGain.gain.value = 0;
  hum.connect(humFilter).connect(humGain).connect(sfx);
  hum.start();

  const wind = c.createBufferSource();
  wind.buffer = noise;
  wind.loop = true;
  const windFilter = c.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 500;
  windFilter.Q.value = 1.2;
  const windGain = c.createGain();
  windGain.gain.value = 0;
  wind.connect(windFilter).connect(windGain).connect(sfx);
  wind.start();

  // ---- music: a lookahead scheduler ------------------------------------------------------------
  let mood: MusicMood = "off";
  let musicOn = true;
  let step = 0;
  let nextAt = 0;
  const playStep = (t: number, i: number) => {
    const bar = Math.floor(i / 16) % ROOTS.length;
    const s = i % 16;
    const root = ROOTS[bar]!;
    const full = mood === "fight";
    // kick
    if (s === 0 || s === 8 || (full && (s === 6 || s === 11))) tone("sine", 140, 42, t, 0.9, 0.22, mus);
    // snare
    if (full && (s === 4 || s === 12)) {
      burst(t, "bandpass", 1900, 0.8, 0.45, 0.14, mus);
      tone("triangle", 200, 160, t, 0.18, 0.08, mus);
    }
    // hats
    if (!lite && (full ? s % 2 === 0 : s % 4 === 2)) burst(t, "highpass", 7500, 0.7, full ? 0.12 : 0.07, 0.04, mus);
    // bass
    const b = BASS[s];
    if (b !== null && b !== undefined && (full || s % 4 === 0)) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = hz(root + b);
      const f = c.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(full ? 900 : 500, t);
      f.frequency.exponentialRampToValueAtTime(180, t + STEP * 1.8);
      const g = c.createGain();
      env(g, t, full ? 0.38 : 0.25, 0.005, STEP * 1.8);
      o.connect(f).connect(g).connect(mus);
      o.start(t);
      o.stop(t + STEP * 2);
    }
    // a lead stab on the off-beat of every other bar in the fight
    if (full && bar % 2 === 1 && (s === 3 || s === 10)) tone("square", hz(root + 24 + (s === 3 ? 7 : 12)), hz(root + 24 + (s === 3 ? 7 : 12)), t, 0.06, 0.18, mus);
  };
  const scheduler = window.setInterval(() => {
    if (mood === "off" || !musicOn || c.state !== "running") {
      nextAt = 0;
      return;
    }
    if (nextAt < now()) nextAt = now() + 0.05;
    while (nextAt < now() + 0.15) {
      playStep(nextAt, step++);
      nextAt += STEP;
    }
  }, 30);

  // ---- the interface ---------------------------------------------------------------------------
  let lastFrame = 0;
  let paused = false;
  return {
    hit(dmg, impact, cut, material) {
      if (!allow(dmg > 10 ? 1 : 0.6)) return;
      const t = now();
      const k = Math.min(1, impact / 200);
      if (material === "wood") {
        tone("sine", 320 - k * 120, 140, t, 0.35 + k * 0.4, 0.09);
        burst(t, "bandpass", 1300, 2, 0.25 + k * 0.3, 0.06);
      } else if (cut > 1 || material === "steel") {
        ring(t, 900 + Math.random() * 200, 0.12 + k * 0.25, 0.25 + k * 0.3);
        burst(t, "highpass", 3000, 0.7, 0.2 + k * 0.3, 0.08);
      } else {
        tone("sine", 160, 48, t, 0.5 + k * 0.5, 0.2 + k * 0.15);
        burst(t, "lowpass", 1800, 0.7, 0.3 + k * 0.4, 0.12);
        ring(t, 420 + Math.random() * 80, 0.06 + k * 0.12, 0.3);
      }
    },
    clash(impact) {
      if (!allow(0.5)) return;
      ring(now(), 1300 + Math.random() * 400, 0.06 + Math.min(0.2, impact / 1000), 0.25);
    },
    stun() {
      if (!allow(0.5)) return;
      const t = now();
      tone("sine", 900, 600, t, 0.08, 0.25);
      tone("sine", 1200, 800, t + 0.08, 0.06, 0.25);
    },
    disarm() {
      const t = now();
      ring(t, 700, 0.25, 0.6);
      tone("triangle", 600, 1500, t, 0.1, 0.4);
    },
    pickup() {
      const t = now();
      tone("square", 440, 440, t, 0.05, 0.06);
      tone("square", 660, 660, t + 0.06, 0.05, 0.08);
    },
    shot(ball) {
      // an arquebus fires 10 a second: at most one crack per 60 ms
      if (!allow(0.06)) return;
      const t = now();
      if (ball) {
        burst(t, "lowpass", 900, 0.7, 0.8, 0.45, sfx, 150);
        tone("sine", 110, 40, t, 0.7, 0.35);
      } else {
        burst(t, "bandpass", 2600, 0.9, 0.35, 0.07);
        tone("square", 300, 90, t, 0.06, 0.05);
      }
    },
    ko() {
      const t = now();
      burst(t, "lowpass", 2400, 0.8, 0.9, 0.9, sfx, 120);
      tone("sine", 90, 30, t, 1, 0.6);
      burst(t + 0.05, "bandpass", 600, 1, 0.4, 0.5);
    },
    sting(kind, n = 0) {
      const t = now();
      if (kind === "count") {
        tone("square", n <= 1 ? 880 : 660, n <= 1 ? 880 : 660, t, 0.08, 0.12);
      } else if (kind === "round") {
        for (let i = 0; i < 6; i++) burst(t + i * 0.06, "bandpass", 1200, 1, 0.12 + i * 0.04, 0.06);
        tone("sine", 120, 50, t + 0.36, 0.7, 0.3);
      } else if (kind === "fight") {
        for (const [semis, delay] of [
          [0, 0],
          [7, 0],
          [12, 0.02],
        ] as const) {
          tone("sawtooth", hz(semis, 220), hz(semis, 220), t + delay, 0.09, 0.55, sfx, 0.04);
        }
        tone("sine", 150, 45, t, 0.9, 0.3);
      } else if (kind === "ko") {
        tone("sawtooth", 330, 110, t, 0.1, 0.35, sfx, 0.01);
      } else {
        // win / champion: a rising arpeggio
        const notes = kind === "champ" ? [0, 4, 7, 12, 16, 19, 24] : [0, 4, 7, 12];
        notes.forEach((s, i) => tone("square", hz(s, 330), hz(s, 330), t + i * 0.09, 0.07, 0.22));
      }
    },
    frame(speed, swing, warp) {
      const t = now();
      // about 10 updates a second is plenty for slow-moving levels
      if (t - lastFrame < 0.1) return;
      lastFrame = t;
      humGain.gain.setTargetAtTime(mood === "off" ? 0 : 0.02 + speed * 0.05, t, 0.1);
      hum.frequency.setTargetAtTime(50 + speed * 40, t, 0.1);
      windGain.gain.setTargetAtTime(swing > 0.25 ? (swing - 0.25) * 0.35 : 0, t, 0.05);
      windFilter.frequency.setTargetAtTime(400 + swing * 1800, t, 0.05);
      slowmo.frequency.setTargetAtTime(warp >= 0.99 ? 18000 : 500 + warp * 2500, t, 0.08);
    },
    music(m) {
      mood = m;
    },
    setMusicOn(on) {
      musicOn = on;
      mus.gain.setTargetAtTime(on ? 0.32 : 0, now(), 0.1);
    },
    pause(on) {
      // suspend the whole engine (scheduler, hum, whoosh): nothing runs on the audio thread while paused
      if (on === paused) return;
      paused = on;
      if (on) void c.suspend().catch(() => {});
      else void c.resume().catch(() => {});
    },
    dispose() {
      clearInterval(scheduler);
      // the context is shared with the lobby: leave it running
      if (paused) void c.resume().catch(() => {});
      try {
        hum.stop();
        wind.stop();
      } catch {
        /* already stopped */
      }
      master.disconnect();
    },
  };
}
