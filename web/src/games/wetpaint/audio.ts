// Sound for the TV, made with WebAudio (no files): the hiss of bristles while paint goes down, wet splats,
// pickups, bonks and the clock. Plays through the TV page's shared audio engine (shell/sound.ts).

export function createAudio(ctx: AudioContext | null) {
  if (!ctx) return null;
  const master = ctx.createGain();
  master.gain.value = 0.55;
  master.connect(ctx.destination);

  // a second of white noise, reused
  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

  const noiseSrc = (loop = false) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = loop;
    return s;
  };

  // the brush: looping noise through a band filter; its level follows how much paint is going down
  const brushSrc = noiseSrc(true);
  const brushFilter = ctx.createBiquadFilter();
  brushFilter.type = "bandpass";
  brushFilter.frequency.value = 2600;
  brushFilter.Q.value = 0.7;
  const brushGain = ctx.createGain();
  brushGain.gain.value = 0;
  brushSrc.connect(brushFilter).connect(brushGain).connect(master);
  brushSrc.start();

  const env = (g: GainNode, t: number, peak: number, attack: number, decay: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  };

  const tone = (freq: number, at: number, dur: number, type: OscillatorType = "sine", peak = 0.3, to?: number) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    env(g, at, peak, 0.008, dur);
    o.connect(g).connect(master);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  const burst = (at: number, dur: number, from: number, to: number, peak: number, type: BiquadFilterType = "lowpass") => {
    const s = noiseSrc();
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(from, at);
    f.frequency.exponentialRampToValueAtTime(to, at + dur);
    const g = ctx.createGain();
    env(g, at, peak, 0.005, dur);
    s.connect(f).connect(g).connect(master);
    s.start(at, Math.random() * 0.5);
    s.stop(at + dur + 0.05);
  };

  let level = 0;

  return {
    /** Stop everything this game started (the engine itself carries on for the next game). */
    dispose() {
      try {
        brushSrc.stop();
      } catch {
        /* already stopped */
      }
      master.disconnect();
    },
    /** Cells painted this frame → bristle hiss. */
    painting(cells: number, dt: number) {
      const want = Math.min(1, cells / 18);
      level += (want - level) * Math.min(1, dt * 12);
      brushGain.gain.setTargetAtTime(level * 0.22, ctx.currentTime, 0.04);
      brushFilter.frequency.setTargetAtTime(1800 + level * 2200, ctx.currentTime, 0.08);
    },
    threw() {
      burst(ctx.currentTime, 0.22, 900, 3200, 0.12, "bandpass");
    },
    splat() {
      const t = ctx.currentTime;
      burst(t, 0.35, 2400, 180, 0.6);
      tone(110, t, 0.28, "sine", 0.5, 45);
      burst(t + 0.05, 0.25, 5000, 1200, 0.12, "highpass");
    },
    pickup(gold: boolean) {
      const t = ctx.currentTime;
      const notes = gold ? [523, 659, 784, 1047, 1319] : [660, 990];
      notes.forEach((f, i) => tone(f, t + i * 0.06, 0.18, "triangle", 0.18));
    },
    bonk() {
      const t = ctx.currentTime;
      tone(220, t, 0.14, "square", 0.12, 90);
      burst(t, 0.1, 3000, 600, 0.2, "bandpass");
    },
    /** A power-up grabbed: a bright candy arpeggio, different per power. */
    power(kind: string) {
      const t = ctx.currentTime;
      const scales: Record<string, number[]> = {
        turbo: [523, 784, 1047, 1568],
        mega: [392, 523, 659, 784, 1047],
        bomb: [220, 330, 440, 660],
        shield: [440, 554, 659, 880],
        rain: [784, 659, 523, 659, 784, 1047],
        dry: [1568, 1319, 1047, 880],
      };
      (scales[kind] ?? scales.turbo!).forEach((f, i) => tone(f, t + i * 0.055, 0.2, "triangle", 0.17));
      burst(t, 0.12, 6000, 2500, 0.06, "highpass");
    },
    /** A candy appears. */
    spawn() {
      const t = ctx.currentTime;
      tone(880, t, 0.08, "sine", 0.08, 1320);
    },
    /** Event fanfare. */
    fanfare() {
      const t = ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.35, "square", 0.06));
      [523, 659, 784, 1047].forEach((f, i) => tone(f, t + i * 0.09, 0.35, "triangle", 0.12));
    },
    /** Something's coming: a two-tone warning. */
    alarm() {
      const t = ctx.currentTime;
      for (let i = 0; i < 3; i++) {
        tone(740, t + i * 0.32, 0.14, "square", 0.07);
        tone(523, t + i * 0.32 + 0.16, 0.14, "square", 0.07);
      }
    },
    /** The rag dragged across the canvas. */
    wipe() {
      burst(ctx.currentTime, 2.4, 900, 2800, 0.16, "bandpass");
    },
    /** A cheer for a streak (pitch rises with the level). */
    cheer(level: number) {
      const t = ctx.currentTime;
      const base = 523 * Math.pow(1.26, level - 1);
      [1, 1.25, 1.5].forEach((m, i) => tone(base * m, t + i * 0.05, 0.22, "triangle", 0.12));
    },
    tick(hurry = false) {
      tone(hurry ? 1320 : 880, ctx.currentTime, 0.07, "sine", hurry ? 0.2 : 0.15);
    },
    go() {
      const t = ctx.currentTime;
      [523, 659, 784].forEach((f) => tone(f, t, 0.5, "triangle", 0.16));
    },
    end() {
      const t = ctx.currentTime;
      [196, 247, 294, 392].forEach((f, i) => tone(f, t + i * 0.09, 1.6, "sine", 0.18));
    },
  };
}

export type Sfx = NonNullable<ReturnType<typeof createAudio>>;
