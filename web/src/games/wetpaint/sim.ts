/**
 * Wet Paint simulation: the canvas grid, brushes, paint pots, power-ups, splats, events and scoring.
 * No rendering or networking here, so it runs (and is tested) anywhere.
 *
 * Coordinates are in canvas cells: x in [0, GRID_W), z in [0, GRID_H), z pointing toward the viewer.
 */
import {
  FIRST_INTRO_SECONDS, GRID_H, GRID_W, INTRO_SECONDS, MAX_BRUSHES, POWERS, POWER_KINDS, ROUND_SECONDS, TUNING as T,
  type EventKind, type Phase, type PowerKind,
} from "./shared.ts";

export interface Brush {
  id: string;
  name: string;
  slot: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing, radians (atan2 of travel). */
  angle: number;
  load: number;
  input: { x: number; y: number };
  dashT: number;
  dashCd: number;
  stunT: number;
  splatCd: number;
  // power-ups in effect (seconds left)
  megaT: number;
  turboT: number;
  shieldT: number;
  dryT: number;
  bomb: boolean;
  lastX: number;
  lastZ: number;
  strokeSeed: number;
  connected: boolean;
  /** Cells painted in the current unbroken run, for streak cheers. */
  run: number;
  runIdle: number;
  runLevel: number;
}

export interface Pot {
  id: number;
  x: number;
  z: number;
  active: boolean;
  respawnT: number;
  /** Sim time it appeared (for the pop-in animation). */
  bornAt: number;
}

export interface PowerUp {
  id: number;
  kind: PowerKind;
  x: number;
  z: number;
  bornAt: number;
  /** > 0 while still falling from the sky (can't be grabbed yet). */
  dropT: number;
  life: number;
}

export interface Blob {
  slot: number;
  ownerId: string;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t: number;
  dur: number;
  /** Seconds before it appears (paint rain drops are staggered). */
  delay: number;
  /** Falls straight down instead of being lobbed. */
  sky: boolean;
  radius: number;
  hitRadius: number;
  stun: number;
  /** A paint bomb. */
  big: boolean;
}

/** Turpentine wiping a band of the canvas back to primer. */
export interface Wipe {
  /** The rag travels along this axis; the band spans the other. */
  axis: "x" | "z";
  /** Middle of the band, on the other axis. */
  center: number;
  width: number;
  /** Leading edge along `axis`, in cells. */
  pos: number;
  speed: number;
  /** Seconds until it starts (it's announced first). */
  delay: number;
  seed: number;
}

export type SimEvent =
  | { type: "phase"; phase: Phase }
  | { type: "thrown"; id: string; slot: number; x: number; z: number; big: boolean }
  | { type: "splat"; id: string; slot: number; x: number; z: number; hits: string[]; blocked: string[]; big: boolean; sky: boolean }
  | { type: "pickup"; id: string; x: number; z: number }
  | { type: "power"; id: string; pid: number; kind: PowerKind; x: number; z: number; victims: string[] }
  | { type: "power-spawn"; pid: number; kind: PowerKind; x: number; z: number; dropped: boolean }
  | { type: "power-gone"; pid: number; x: number; z: number }
  | { type: "bonk"; by: string; target: string; x: number; z: number }
  | { type: "bounce"; by: string; target: string; x: number; z: number }
  | { type: "dash"; id: string }
  | { type: "event"; kind: EventKind | "wipe-warn" }
  | { type: "streak"; id: string; level: number }
  | { type: "lead"; id: string };

export interface SimOptions {
  seed?: number;
  roundLength?: number;
  powerups?: boolean;
  events?: boolean;
}

/** Where each colour slot starts, spread so the first few players are far apart. */
const SPAWNS: [number, number][] = [
  [17, 15],
  [GRID_W - 17, GRID_H - 15],
  [GRID_W - 17, 15],
  [17, GRID_H - 15],
  [GRID_W / 2, 12],
  [GRID_W / 2, GRID_H - 12],
  [38, GRID_H / 2],
  [GRID_W - 38, GRID_H / 2],
];

const CELLS = GRID_W * GRID_H;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable hash of a cell (+ seed) to [0, 1). */
function hash2(i: number, j: number, seed: number): number {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Sim {
  /** Per cell: owner (slot + 1, 0 = primer), stroke angle, time painted, thickness. Uploaded as a texture. */
  readonly cells = new Float32Array(CELLS * 4);
  /** Cells owned per owner value; [0] is unpainted primer. */
  readonly counts = new Int32Array(MAX_BRUSHES + 1);
  readonly brushes = new Map<string, Brush>();
  pots: Pot[] = [];
  powers: PowerUp[] = [];
  blobs: Blob[] = [];
  wipe: Wipe | null = null;
  events: SimEvent[] = [];

  phase: Phase = "intro";
  /** Seconds since the round began (intro included). Stamped onto cells; drives animation. */
  time = 0;
  /** Seconds left in the current phase. */
  phaseLeft = 0;
  round = 1;
  /** Last 15 seconds: endless paint, a little faster. */
  frenzy = false;
  /** Cells newly painted during the last step (drives the brushing sound). */
  paintedThisStep = 0;
  /** True when `cells` changed since the renderer last looked. */
  dirty = true;

  roundLength: number;
  powerupsOn: boolean;
  eventsOn: boolean;
  private nextRoundLength: number;

  private rand: () => number;
  private ids = 0;
  private strokeSeeds = 1;
  private powerT = 0;
  private fired = new Set<string>();
  private leader: string | null = null;
  private leadT = 0;

  constructor(o: SimOptions = {}) {
    this.rand = mulberry32(o.seed ?? Date.now());
    this.roundLength = this.nextRoundLength = o.roundLength ?? ROUND_SECONDS;
    this.powerupsOn = o.powerups ?? true;
    this.eventsOn = o.events ?? true;
    this.reset();
  }

  /** Change settings. Round length applies from the next round; the rest straight away. */
  configure(o: Omit<SimOptions, "seed">) {
    if (o.roundLength) this.nextRoundLength = o.roundLength;
    if (o.powerups !== undefined) {
      this.powerupsOn = o.powerups;
      if (!o.powerups) this.powers = [];
    }
    if (o.events !== undefined) this.eventsOn = o.events;
  }

  // ------------------------------------------------------------ setup

  /** Fresh canvas; existing brushes go back to their corners. */
  reset() {
    this.cells.fill(0);
    this.counts.fill(0);
    this.counts[0] = CELLS;
    this.blobs = [];
    this.events = [];
    this.pots = [];
    this.powers = [];
    this.wipe = null;
    this.frenzy = false;
    this.fired.clear();
    this.leader = null;
    this.time = 0;
    this.roundLength = this.nextRoundLength;
    this.phase = "intro";
    this.phaseLeft = this.round === 1 ? FIRST_INTRO_SECONDS : INTRO_SECONDS;
    this.powerT = T.powerEvery * 0.6;
    this.dirty = true;
    for (const b of this.brushes.values()) this.spawn(b);
    this.syncPotCount();
  }

  nextRound() {
    this.round++;
    this.reset();
  }

  /** Add a player's brush. Returns null if all colours are taken. */
  addBrush(id: string, name: string): Brush | null {
    const existing = this.brushes.get(id);
    if (existing) {
      existing.connected = true;
      return existing;
    }
    const used = new Set([...this.brushes.values()].map((b) => b.slot));
    // Prefer a colour with no paint on the canvas, so nobody inherits someone else's work.
    let slot = -1;
    for (let s = 0; s < MAX_BRUSHES; s++) if (!used.has(s) && this.counts[s + 1] === 0) { slot = s; break; }
    if (slot < 0) for (let s = 0; s < MAX_BRUSHES; s++) if (!used.has(s)) { slot = s; break; }
    if (slot < 0) return null;

    const b: Brush = {
      id, name, slot, x: 0, z: 0, vx: 0, vz: 0, angle: 0, load: 1, input: { x: 0, y: 0 },
      dashT: 0, dashCd: 0, stunT: 0, splatCd: 0, megaT: 0, turboT: 0, shieldT: 0, dryT: 0, bomb: false,
      lastX: 0, lastZ: 0, strokeSeed: 0, connected: true, run: 0, runIdle: 0, runLevel: 0,
    };
    this.brushes.set(id, b);
    this.spawn(b);
    this.syncPotCount();
    return b;
  }

  removeBrush(id: string) {
    this.brushes.delete(id);
  }

  setConnected(id: string, connected: boolean) {
    const b = this.brushes.get(id);
    if (!b) return;
    b.connected = connected;
    if (!connected) b.input = { x: 0, y: 0 };
  }

  setInput(id: string, x: number, y: number) {
    const b = this.brushes.get(id);
    if (!b || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const m = Math.hypot(x, y);
    b.input = m > 1 ? { x: x / m, y: y / m } : { x, y };
  }

  private spawn(b: Brush) {
    const [sx, sz] = SPAWNS[b.slot]!;
    b.x = b.lastX = sx;
    b.z = b.lastZ = sz;
    b.vx = b.vz = 0;
    // Face the middle of the canvas.
    b.angle = Math.atan2(GRID_H / 2 - sz, GRID_W / 2 - sx);
    b.load = 1;
    b.dashT = b.dashCd = b.stunT = b.splatCd = 0;
    b.megaT = b.turboT = b.shieldT = b.dryT = 0;
    b.bomb = false;
    b.run = b.runIdle = b.runLevel = 0;
    b.strokeSeed = this.strokeSeeds++;
    // A little home patch, so everyone can see where they are. Lands just after the intro starts.
    this.stamp(sx, sz, 5.4, b.slot, b.angle, 1, 1, b.strokeSeed, this.time + 0.35 + b.slot * 0.12, false);
    this.movePotsFromUnderBrushes();
  }

  // ---------------------------------------------------------- actions

  splat(id: string): boolean {
    const b = this.brushes.get(id);
    if (!b || this.phase !== "play" || b.stunT > 0 || b.splatCd > 0) return false;
    const big = b.bomb;
    if (!big && b.load < T.splatCost) return false;
    if (big) b.bomb = false;
    else b.load -= T.splatCost;
    b.splatCd = T.splatCooldown;
    const range = T.splatRange * (big ? 1.1 : 1);
    const x1 = clamp(b.x + Math.cos(b.angle) * range, 2, GRID_W - 2);
    const z1 = clamp(b.z + Math.sin(b.angle) * range, 2, GRID_H - 2);
    this.blobs.push({
      slot: b.slot, ownerId: b.id, x0: b.x, z0: b.z, x1, z1, t: 0, dur: T.splatFlight * (big ? 1.25 : 1), delay: 0, sky: false,
      radius: T.splatRadius * (big ? T.bombMul : 1), hitRadius: T.splatHitRadius * (big ? 1.8 : 1), stun: T.splatStun * (big ? 1.3 : 1), big,
    });
    this.events.push({ type: "thrown", id: b.id, slot: b.slot, x: b.x, z: b.z, big });
    return true;
  }

  dash(id: string): boolean {
    const b = this.brushes.get(id);
    if (!b || this.phase === "end" || b.stunT > 0 || b.dashCd > 0) return false;
    // Dash toward the stick if it's held, otherwise the way we face.
    const m = Math.hypot(b.input.x, b.input.y);
    const a = m > 0.2 ? Math.atan2(b.input.y, b.input.x) : b.angle;
    b.angle = a;
    b.vx = Math.cos(a) * T.dashSpeed;
    b.vz = Math.sin(a) * T.dashSpeed;
    b.dashT = T.dashSeconds;
    b.dashCd = T.dashCooldown;
    this.events.push({ type: "dash", id: b.id });
    return true;
  }

  // ------------------------------------------------------------- step

  step(dt: number) {
    this.time += dt;
    this.paintedThisStep = 0;
    this.phaseLeft -= dt;

    if (this.phase === "intro") {
      // Warm-up: everyone can drive (and dash) around during the count-in. No paint lands until GO.
      for (const b of this.brushes.values()) this.moveBrush(b, dt);
      this.collide(false);
      if (this.phaseLeft <= 0) this.go();
      return;
    }
    if (this.phase === "end") return;
    if (this.phaseLeft <= 0) {
      this.phaseLeft = 0;
      this.frenzy = false;
      this.wipe = null;
      // brushes down: clear the table so the painting can be admired
      this.powers = [];
      this.blobs = [];
      for (const pot of this.pots) pot.active = false;
      this.setPhase("end", 0);
      return;
    }

    this.stepEvents();
    for (const b of this.brushes.values()) this.stepBrush(b, dt);
    this.collide();
    this.stepPots(dt);
    this.stepPowers(dt);
    this.stepBlobs(dt);
    this.stepWipe(dt);
    this.stepLeader(dt);
  }

  /** GO: paint starts flowing from wherever each brush ended up, and everyone starts level. */
  private go() {
    for (const b of this.brushes.values()) {
      b.lastX = b.x;
      b.lastZ = b.z;
      b.strokeSeed = this.strokeSeeds++;
      b.load = 1;
      b.dashCd = b.dashT = b.stunT = 0;
    }
    this.movePotsFromUnderBrushes();
    this.setPhase("play", this.roundLength);
  }

  /** A pot under a full brush would be wasted the moment play starts: put it somewhere open instead. */
  private movePotsFromUnderBrushes() {
    for (const pot of this.pots) {
      if (!pot.active) continue;
      for (const b of this.brushes.values()) {
        if (Math.hypot(b.x - pot.x, b.z - pot.z) > T.potRadius + 6) continue;
        this.placePot(pot);
        break;
      }
    }
  }

  private setPhase(phase: Phase, seconds: number) {
    this.phase = phase;
    this.phaseLeft = seconds;
    this.events.push({ type: "phase", phase });
  }

  private once(key: string): boolean {
    if (this.fired.has(key)) return false;
    this.fired.add(key);
    return true;
  }

  private stepEvents() {
    if (!this.eventsOn) return;
    const L = this.roundLength;
    const elapsed = L - this.phaseLeft;
    if (this.powerupsOn && elapsed >= L * 0.27 && this.once("shower")) {
      this.events.push({ type: "event", kind: "shower" });
      for (let i = 0; i < T.showerCount; i++) this.spawnPower(undefined, 0.9 + i * 0.18);
    }
    if (elapsed >= L * 0.55 && this.once("wipe")) this.startWipe();
    if (L >= 45 && this.phaseLeft <= T.frenzySeconds && this.once("frenzy")) {
      this.frenzy = true;
      this.events.push({ type: "event", kind: "frenzy" });
    }
  }

  /** Timers, steering and walls: everything but the paint. */
  private moveBrush(b: Brush, dt: number) {
    b.dashCd = Math.max(0, b.dashCd - dt);
    b.splatCd = Math.max(0, b.splatCd - dt);
    b.stunT = Math.max(0, b.stunT - dt);
    b.dashT = Math.max(0, b.dashT - dt);
    b.megaT = Math.max(0, b.megaT - dt);
    b.turboT = Math.max(0, b.turboT - dt);
    b.shieldT = Math.max(0, b.shieldT - dt);
    b.dryT = Math.max(0, b.dryT - dt);

    if (b.stunT > 0) {
      const k = Math.exp(-5 * dt);
      b.vx *= k;
      b.vz *= k;
    } else if (b.dashT <= 0) {
      const speed = T.speed * (b.turboT > 0 ? T.turboMul : 1) * (this.frenzy ? T.frenzySpeed : 1);
      const k = Math.min(1, T.accel * dt);
      b.vx += (b.input.x * speed - b.vx) * k;
      b.vz += (b.input.y * speed - b.vz) * k;
    }

    b.x += b.vx * dt;
    b.z += b.vz * dt;
    if (b.x < 1 || b.x > GRID_W - 1) {
      b.x = clamp(b.x, 1, GRID_W - 1);
      b.vx = 0;
    }
    if (b.z < 1 || b.z > GRID_H - 1) {
      b.z = clamp(b.z, 1, GRID_H - 1);
      b.vz = 0;
    }

    const speed = Math.hypot(b.vx, b.vz);
    if (speed > 1.5 && b.stunT <= 0) b.angle = lerpAngle(b.angle, Math.atan2(b.vz, b.vx), Math.min(1, dt * T.turn));
  }

  private stepBrush(b: Brush, dt: number) {
    this.moveBrush(b, dt);
    if (this.frenzy) b.load = 1;
    else if (b.dryT <= 0) {
      const under = this.ownerAt(b.x, b.z);
      b.load = Math.min(1, b.load + (under === b.slot + 1 ? T.regenOwn : T.regenAnywhere) * dt);
    }

    const n = this.paintPath(b);
    // streaks: an unbroken run of fresh canvas earns a cheer
    if (n > 0) {
      b.run += n;
      b.runIdle = 0;
      const lvl = T.streaks.filter((s) => b.run >= s).length;
      if (lvl > b.runLevel) {
        b.runLevel = lvl;
        this.events.push({ type: "streak", id: b.id, level: lvl });
      }
    } else {
      b.runIdle += dt;
      if (b.runIdle > 1.1 || b.stunT > 0) b.run = b.runLevel = 0;
    }
  }

  /** Lay paint from the last painted point to where the brush is now. Returns cells newly painted. */
  private paintPath(b: Brush): number {
    const dx = b.x - b.lastX;
    const dz = b.z - b.lastZ;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.35) return 0;
    if (b.load <= 0 || b.dryT > 0) {
      b.lastX = b.x;
      b.lastZ = b.z;
      b.strokeSeed = this.strokeSeeds++;
      return 0;
    }
    const angle = Math.atan2(dz, dx);
    const mega = b.megaT > 0;
    const r = mega ? T.megaRadius : T.brushRadius;
    const cost = this.frenzy ? 0 : (mega ? 0.5 : 1) / T.loadCells;
    const steps = Math.ceil(dist / 0.6);
    let total = 0;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const keep = b.load < T.dryBelow ? b.load / T.dryBelow : 1;
      const thick = 0.3 + 0.7 * Math.min(1, b.load / 0.5);
      const n = this.stamp(b.lastX + dx * t, b.lastZ + dz * t, r, b.slot, angle, thick, keep, b.strokeSeed, this.time, false);
      total += n;
      b.load -= n * cost;
      if (b.load <= 0) {
        b.load = 0;
        break;
      }
    }
    b.lastX = b.x;
    b.lastZ = b.z;
    return total;
  }

  /**
   * Paint a ragged disc. Returns how many cells changed hands.
   * `keep` < 1 skips cells at random (a brush running dry). `radial` lays strokes outward from the centre (splats).
   */
  stamp(
    cx: number, cz: number, r: number, slot: number, angle: number,
    thick: number, keep: number, seed: number, time: number, radial: boolean,
  ): number {
    const owner = slot + 1;
    const i0 = Math.max(0, Math.floor(cx - r - 1));
    const i1 = Math.min(GRID_W - 1, Math.floor(cx + r + 1));
    const j0 = Math.max(0, Math.floor(cz - r - 1));
    const j1 = Math.min(GRID_H - 1, Math.floor(cz + r + 1));
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - cx;
        const dz = j + 0.5 - cz;
        const edge = r * (0.8 + 0.32 * hash2(i, j, seed));
        if (dx * dx + dz * dz > edge * edge) continue;
        if (keep < 1 && hash2(i * 3 + 1, j * 7 + 2, seed + 17) > keep * 0.85) continue;
        const k = (j * GRID_W + i) * 4;
        const prev = this.cells[k]!;
        if (prev === owner) continue;
        this.counts[prev]!--;
        this.counts[owner]!++;
        this.cells[k] = owner;
        this.cells[k + 1] = (radial ? Math.atan2(dz, dx) : angle) + (hash2(i, j, seed + 5) - 0.5) * 0.35;
        this.cells[k + 2] = time;
        this.cells[k + 3] = thick;
        n++;
      }
    }
    if (n) {
      this.dirty = true;
      this.paintedThisStep += n;
    }
    return n;
  }

  ownerAt(x: number, z: number): number {
    const i = Math.floor(x);
    const j = Math.floor(z);
    if (i < 0 || j < 0 || i >= GRID_W || j >= GRID_H) return 0;
    return this.cells[(j * GRID_W + i) * 4]!;
  }

  /** Brushes push each other apart; with `rams` on, a dash knocks the other over and steals paint. */
  private collide(rams = true) {
    const list = [...this.brushes.values()];
    const min = T.bodyRadius * 2;
    for (let a = 0; a < list.length; a++) {
      for (let c = a + 1; c < list.length; c++) {
        const p = list[a]!;
        const q = list[c]!;
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d >= min || d < 1e-4) continue;
        const nx = dx / d;
        const nz = dz / d;
        const push = (min - d) / 2;
        p.x -= nx * push;
        p.z -= nz * push;
        q.x += nx * push;
        q.z += nz * push;
        if (!rams) continue;
        const pDash = p.dashT > 0;
        const qDash = q.dashT > 0;
        if (pDash && !qDash && q.stunT <= 0) this.bonk(p, q, nx, nz);
        else if (qDash && !pDash && p.stunT <= 0) this.bonk(q, p, -nx, -nz);
        else if (pDash && qDash) {
          p.dashT = q.dashT = 0;
          p.vx = -nx * 30;
          p.vz = -nz * 30;
          q.vx = nx * 30;
          q.vz = nz * 30;
        }
      }
    }
  }

  private bonk(by: Brush, target: Brush, nx: number, nz: number) {
    by.dashT = 0;
    if (target.shieldT > 0) {
      // the shield bounces them back
      by.stunT = 0.5;
      by.vx = -nx * 50;
      by.vz = -nz * 50;
      this.events.push({ type: "bounce", by: by.id, target: target.id, x: target.x, z: target.z });
      return;
    }
    target.stunT = T.bonkStun;
    target.vx = nx * 45;
    target.vz = nz * 45;
    const stolen = Math.min(target.load, T.bonkSteal);
    target.load -= stolen;
    by.load = Math.min(1, by.load + stolen);
    by.vx *= 0.3;
    by.vz *= 0.3;
    this.events.push({ type: "bonk", by: by.id, target: target.id, x: target.x, z: target.z });
  }

  // ------------------------------------------------------------- pots

  private syncPotCount() {
    const want = clamp(this.brushes.size + 1, 3, 8);
    while (this.pots.length < want) {
      const pot: Pot = { id: this.ids++, x: 0, z: 0, active: false, respawnT: 0, bornAt: 0 };
      this.placePot(pot);
      this.pots.push(pot);
    }
  }

  /** A spot away from brushes, pots and power-ups. */
  private openSpot(margin = 8): [number, number] {
    let best: [number, number] = [GRID_W / 2, GRID_H / 2];
    let bestScore = -1;
    for (let tries = 0; tries < 30; tries++) {
      const x = margin + this.rand() * (GRID_W - margin * 2);
      const z = margin + this.rand() * (GRID_H - margin * 2);
      let score = 60;
      for (const b of this.brushes.values()) score = Math.min(score, Math.hypot(b.x - x, b.z - z));
      for (const p of this.pots) if (p.active) score = Math.min(score, Math.hypot(p.x - x, p.z - z) * 1.3);
      for (const p of this.powers) score = Math.min(score, Math.hypot(p.x - x, p.z - z) * 1.3);
      if (score > bestScore) {
        bestScore = score;
        best = [x, z];
      }
    }
    return best;
  }

  private placePot(pot: Pot) {
    [pot.x, pot.z] = this.openSpot();
    pot.active = true;
    pot.bornAt = this.time;
  }

  private stepPots(dt: number) {
    for (const pot of this.pots) {
      if (!pot.active) {
        pot.respawnT -= dt;
        if (pot.respawnT <= 0) this.placePot(pot);
        continue;
      }
      for (const b of this.brushes.values()) {
        if (Math.hypot(b.x - pot.x, b.z - pot.z) > T.potRadius + 0.8) continue;
        pot.active = false;
        pot.respawnT = T.potRespawn;
        b.load = 1;
        b.dryT = 0;
        this.events.push({ type: "pickup", id: b.id, x: pot.x, z: pot.z });
        break;
      }
    }
    this.syncPotCount();
  }

  // ------------------------------------------------------------- power-ups

  /** Put a power-up on the canvas (random kind unless given). `drop` > 0: it falls from the sky first. */
  spawnPower(kind?: PowerKind, drop = 0): PowerUp {
    if (!kind) {
      const total = POWER_KINDS.reduce((s, k) => s + POWERS[k].weight, 0);
      let r = this.rand() * total;
      kind = POWER_KINDS.find((k) => (r -= POWERS[k].weight) < 0) ?? "turbo";
    }
    const [x, z] = this.openSpot(9);
    const p: PowerUp = { id: this.ids++, kind, x, z, bornAt: this.time, dropT: drop, life: T.powerLife + drop };
    this.powers.push(p);
    this.events.push({ type: "power-spawn", pid: p.id, kind, x, z, dropped: drop > 0 });
    return p;
  }

  private stepPowers(dt: number) {
    if (this.powerupsOn) {
      this.powerT -= dt;
      const cap = 2 + Math.floor(this.brushes.size / 3);
      if (this.powerT <= 0) {
        this.powerT = T.powerEvery * (0.7 + this.rand() * 0.6);
        if (this.powers.length < cap) this.spawnPower();
      }
    }
    const keep: PowerUp[] = [];
    for (const p of this.powers) {
      p.dropT = Math.max(0, p.dropT - dt);
      p.life -= dt;
      if (p.life <= 0) {
        this.events.push({ type: "power-gone", pid: p.id, x: p.x, z: p.z });
        continue;
      }
      let taken = false;
      if (p.dropT <= 0) {
        for (const b of this.brushes.values()) {
          if (Math.hypot(b.x - p.x, b.z - p.z) > T.powerRadius + 0.8) continue;
          this.apply(b, p);
          taken = true;
          break;
        }
      }
      if (!taken) keep.push(p);
    }
    this.powers = keep;
  }

  private apply(b: Brush, p: PowerUp) {
    const victims: string[] = [];
    switch (p.kind) {
      case "turbo":
        b.turboT = POWERS.turbo.seconds;
        break;
      case "mega":
        b.megaT = POWERS.mega.seconds;
        b.load = Math.max(b.load, 0.6);
        break;
      case "bomb":
        b.bomb = true;
        break;
      case "shield":
        b.shieldT = POWERS.shield.seconds;
        break;
      case "dry":
        for (const o of this.brushes.values()) {
          if (o === b || o.shieldT > 0) continue;
          o.dryT = POWERS.dry.seconds;
          o.load *= T.dryLoad;
          victims.push(o.id);
        }
        break;
      case "rain":
        this.rain(b);
        break;
    }
    this.events.push({ type: "power", id: b.id, pid: p.id, kind: p.kind, x: p.x, z: p.z, victims });
  }

  /** Drops of your colour fall on other people's paint (or bare canvas), spread out. */
  private rain(b: Brush) {
    const own = b.slot + 1;
    const candidates: { x: number; z: number; score: number }[] = [];
    for (let k = 0; k < 80; k++) {
      const x = 4 + this.rand() * (GRID_W - 8);
      const z = 4 + this.rand() * (GRID_H - 8);
      const o = this.ownerAt(x, z);
      if (o === own) continue;
      candidates.push({ x, z, score: (o === 0 ? 1 : 2) + this.rand() });
    }
    candidates.sort((a, c) => c.score - a.score);
    const picked: { x: number; z: number }[] = [];
    for (const c of candidates) {
      if (picked.length >= T.rainDrops) break;
      if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 12)) picked.push(c);
    }
    picked.forEach((p, i) =>
      this.blobs.push({
        slot: b.slot, ownerId: b.id, x0: p.x, z0: p.z, x1: p.x, z1: p.z, t: 0, dur: 0.7, delay: 0.25 + i * 0.22, sky: true,
        radius: T.rainRadius, hitRadius: T.rainRadius * 0.7, stun: 0.6, big: false,
      }),
    );
  }

  // ------------------------------------------------------------ splats

  private stepBlobs(dt: number) {
    for (const blob of this.blobs) {
      if (blob.delay > 0) {
        blob.delay -= dt;
        continue;
      }
      blob.t += dt;
      if (blob.t >= blob.dur) this.land(blob);
    }
    this.blobs = this.blobs.filter((b) => b.delay > 0 || b.t < b.dur);
  }

  private land(blob: Blob) {
    const seed = this.strokeSeeds++;
    this.stamp(blob.x1, blob.z1, blob.radius, blob.slot, 0, 1, 1, seed, this.time, true);
    // Droplets flung past the edge of the splat. They land a beat later (time in the future = grow in later).
    const drops = blob.big ? 12 : blob.sky ? 4 : 7;
    for (let k = 0; k < drops; k++) {
      const a = this.rand() * Math.PI * 2;
      const d = blob.radius + 1.5 + this.rand() * blob.radius * 0.6;
      const r = 1.1 + this.rand() * 1.2;
      this.stamp(blob.x1 + Math.cos(a) * d, blob.z1 + Math.sin(a) * d, r, blob.slot, a, 0.9, 1, seed + k + 1, this.time + 0.12, true);
    }
    const hits: string[] = [];
    const blocked: string[] = [];
    for (const b of this.brushes.values()) {
      if (b.id === blob.ownerId) continue;
      const dx = b.x - blob.x1;
      const dz = b.z - blob.z1;
      const d = Math.hypot(dx, dz);
      if (d > blob.hitRadius) continue;
      if (b.shieldT > 0) {
        blocked.push(b.id);
        continue;
      }
      b.stunT = Math.max(b.stunT, blob.stun);
      b.load = Math.max(0, b.load - (blob.sky ? 0.1 : T.splatDrain));
      const k = d > 0.01 ? 22 / d : 0;
      b.vx = dx * k;
      b.vz = dz * k;
      hits.push(b.id);
    }
    this.events.push({ type: "splat", id: blob.ownerId, slot: blob.slot, x: blob.x1, z: blob.z1, hits, blocked, big: blob.big, sky: blob.sky });
  }

  // ------------------------------------------------------------ turpentine

  private startWipe() {
    // it goes for whoever's ahead: the band where the leader has the most paint
    const lead = this.standings()[0];
    const axis: "x" | "z" = this.rand() < 0.5 ? "x" : "z";
    const span = axis === "x" ? GRID_H : GRID_W;
    const length = axis === "x" ? GRID_W : GRID_H;
    const width = T.wipeWidth;
    let center = width / 2 + this.rand() * (span - width);
    if (lead && this.counts[lead.slot + 1]! > 0) {
      let best = -1;
      for (let c = width / 2; c <= span - width / 2; c += 3) {
        let n = 0;
        for (let k = 0; k < 120; k++) {
          const along = this.rand() * length;
          const across = c + (this.rand() - 0.5) * width;
          const owner = axis === "x" ? this.ownerAt(along, across) : this.ownerAt(across, along);
          if (owner === lead.slot + 1) n++;
        }
        if (n > best) {
          best = n;
          center = c;
        }
      }
    }
    this.wipe = { axis, center, width, pos: -4, speed: (length + 8) / T.wipeSeconds, delay: 1.6, seed: this.strokeSeeds++ };
    this.events.push({ type: "event", kind: "wipe-warn" });
  }

  private stepWipe(dt: number) {
    const w = this.wipe;
    if (!w) return;
    if (w.delay > 0) {
      w.delay -= dt;
      if (w.delay <= 0) this.events.push({ type: "event", kind: "wipe" });
      return;
    }
    const from = w.pos;
    w.pos += w.speed * dt;
    const length = w.axis === "x" ? GRID_W : GRID_H;
    const a0 = Math.max(0, Math.floor(from));
    const a1 = Math.min(length - 1, Math.floor(w.pos));
    for (let a = a0; a <= a1; a++) {
      for (let c = Math.floor(w.center - w.width / 2 - 2); c <= w.center + w.width / 2 + 2; c++) {
        const i = w.axis === "x" ? a : c;
        const j = w.axis === "x" ? c : a;
        if (i < 0 || j < 0 || i >= GRID_W || j >= GRID_H) continue;
        // ragged edges, and the odd streak the rag misses
        const edge = w.width / 2 + (hash2(a, 3, w.seed) - 0.5) * 3;
        if (Math.abs(c + 0.5 - w.center) > edge || hash2(i, j, w.seed) > 0.93) continue;
        const k = (j * GRID_W + i) * 4;
        const prev = this.cells[k]!;
        if (prev === 0) continue;
        this.counts[prev]!--;
        this.counts[0]!++;
        this.cells[k] = 0;
        this.cells[k + 2] = this.time;
        this.dirty = true;
      }
    }
    if (w.pos > length + 4) this.wipe = null;
  }

  // ----------------------------------------------------------- scoring

  private stepLeader(dt: number) {
    this.leadT -= dt;
    if (this.leadT > 0) return;
    this.leadT = 0.5;
    const [first, second] = this.standings();
    if (!first || this.pct(first.slot) < 3) return;
    if (second && this.counts[first.slot + 1]! - this.counts[second.slot + 1]! < 20) return; // no flip-flopping
    if (first.id !== this.leader) {
      const had = this.leader !== null;
      this.leader = first.id;
      if (had) this.events.push({ type: "lead", id: first.id });
    }
  }

  pct(slot: number): number {
    return (this.counts[slot + 1]! / CELLS) * 100;
  }

  /** Brushes, best first. */
  standings(): Brush[] {
    return [...this.brushes.values()].sort((a, b) => this.counts[b.slot + 1]! - this.counts[a.slot + 1]!);
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
