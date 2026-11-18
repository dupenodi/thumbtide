// Lift-off: the rules, with no drawing. The whole crew flies one rocket up a tunnel. Each player holds one thruster
// on the rocket's base (a lone player gets two: left and right). A thruster pushes along the rocket's axis, so one
// off the middle also turns it. Walls and slabs only bump the rocket (it loses speed and spins a little). Touch a
// hazard (mine, meteor, spiked bar, laser beam), or drop below the climbing drop line, and the run ends. A match is a few runs; the crew's score is its best height.
//
// Fairness: the total thrust is the same for any crew size (each thruster gets 1/N of it), and the thrusters are
// spread evenly over the same base width, so the turning force of one side is the same too.
// Everything runs in fixed 60 Hz steps and all timers count steps, so a seeded run replays exactly.

import { Course, DIFFICULTIES, FIRST_AT, HALF_W, hazardAt, levelAt, solidContact, type DifficultyKey, type HazardKind, type Rng } from "./course.ts";

export { HALF_W, DIFFICULTIES, type DifficultyKey, type Rng };

export const STEP = 1 / 60;
export const MAX_SEATS = 8;
export const COUNT_STEPS = 3 * 60;
export const RESULT_STEPS = Math.round(5.5 * 60);
export const RUN_OPTIONS = [1, 3, 5] as const;

// ------------------------------------------------------------------ the rocket (metres, y up, origin at its centre)
export const G = 6;
/** All thrusters on: this many g. */
export const THRUST_ALL = 2.1;
/** Thrusters spread over this base width: offsets run from -BASE/2 to BASE/2. */
export const BASE = 2.2;
/** Rotational inertia (m²). */
export const INERTIA = 1.7;
/** Spin damping and drag (per second). */
export const SPIN_DAMP = 4;
export const DRAG_X = 0.55;
export const DRAG_Y = 0.42;
/** The rocket's centre height while it stands on the pad. */
export const PAD_Y = 2.6;
/** The drop line never trails the best height by more than this. */
export const DROP = 22;
/** A bump: how much of the speed into the surface comes back, how much sliding speed is lost, how much spin it adds. */
export const BUMP_BOUNCE = 0.3;
export const BUMP_SCRAPE = 0.15;
export const BUMP_SPIN = 0.5;
/** Steps between two bump events (for the clunk on screen). */
export const BUMP_GAP = 20;
/** The drop line starts climbing once the rocket is this high, or this long after lift-off is possible. */
export const CREEP_FROM = 8;
export const CREEP_DELAY = 8 * 60;

/** Collision circles: x, y, r in the rocket's frame. */
export const HULL: [number, number, number][] = [
  [0, 1.9, 0.6],
  [0, 0.7, 0.85],
  [0, -0.6, 0.9],
  [0, -1.9, 0.7],
  [-0.95, -1.75, 0.42],
  [0.95, -1.75, 0.42],
];

/** Thruster offsets across the base, left to right, for a rocket with n thrusters. */
export const thrusterOffsets = (n: number) => Array.from({ length: n }, (_, i) => (BASE / 2) * ((2 * i + 1) / n - 1));

export type Phase = "wait" | "count" | "fly" | "result" | "match";

export interface Options {
  runs: number;
  difficulty: DifficultyKey;
}

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  /** Held inputs (left and right half; one button sets both). */
  l: boolean;
  r: boolean;
  /** Steps spent firing this match. */
  burn: number;
}

export interface Thruster {
  /** Seat that holds it ("" for nobody, briefly, after a leave). */
  owner: string;
  /** Which input fires it: either one, or the left / right half of a lone player's phone. */
  key: "any" | "l" | "r";
  /** Colour slot and name of its holder, for drawing. */
  slot: number;
  name: string;
  bot: boolean;
  /** Offset across the base (m), negative = left. */
  d: number;
  on: boolean;
}

export interface Rocket {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tilt (rad), positive = nose to the right. */
  a: number;
  w: number;
  /** Previous step, for drawing between steps. */
  px: number;
  py: number;
  pa: number;
  alive: boolean;
}

export type LiftoffEvent =
  | { type: "phase"; phase: Phase }
  | { type: "crash"; x: number; y: number; a: number; vx: number; vy: number; w: number; height: number; best: boolean; lost: boolean; cause: HazardKind | "drop" }
  | { type: "bump"; x: number; y: number; nx: number; ny: number; power: number }
  | { type: "mark"; height: number }
  | { type: "crew" };

export class Liftoff {
  phase: Phase = "wait";
  /** Runs started this match (1-based while one is on). */
  run = 0;
  /** Steps since the phase began. */
  t = 0;
  /** Steps of flight this run (moving blocks and the drop line run on it). */
  flySteps = 0;
  readonly seats = new Map<string, Seat>();
  thrusters: Thruster[] = [];
  rocket: Rocket = { x: 0, y: PAD_Y, vx: 0, vy: 0, a: 0, w: 0, px: 0, py: PAD_Y, pa: 0, alive: true };
  course: Course;
  /** Highest height this run (m above the pad). */
  best = 0;
  /** The drop line (world y). */
  floor = -DROP;
  /** Heights of the runs flown this match. */
  heights: number[] = [];
  /** The crew's best ever (kept by the host across matches, per difficulty). */
  record = 0;
  newRecord = false;
  /** Some run of this match set a new crew best. */
  matchRecord = false;
  opts: Options;
  private next: Options;
  private seed = 1;
  /** First slab and first hazard still worth testing. */
  private lo = 0;
  private loH = 0;
  private bumpCool = 0;
  /** Bumps this run. */
  bumps = 0;
  private lastMark = 0;
  private events: LiftoffEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { runs: 3, difficulty: "normal", ...opts };
    this.next = { ...this.opts };
    this.course = new Course(seeded(1), DIFFICULTIES[this.opts.difficulty]);
  }

  /** Runs apply at once; the difficulty from the next run. */
  configure(opts: Partial<Options>) {
    this.next = { ...this.next, ...opts };
    if (opts.runs) this.opts.runs = opts.runs;
  }

  // ------------------------------------------------------------------ seats

  addSeat(id: string, name: string, bot = false, prefer = -1): Seat | null {
    const had = this.seats.get(id);
    if (had) return had;
    if (this.seats.size >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    let slot = prefer >= 0 && prefer < MAX_SEATS && !used.has(prefer) ? prefer : -1;
    for (let i = 0; slot < 0 && i < MAX_SEATS; i++) if (!used.has(i)) slot = i;
    const s: Seat = { id, name, slot, bot, l: false, r: false, burn: 0 };
    this.seats.set(id, s);
    if (this.phase === "wait") this.nextRun();
    return s;
  }

  /** Removes a seat. Its thrusters fall silent until `handOver` gives them to someone (the host brings in a bot). */
  removeSeat(id: string) {
    if (!this.seats.delete(id)) return;
    for (const th of this.thrusters) if (th.owner === id) th.owner = "";
    if (this.seats.size === 0 && this.phase !== "match") {
      this.thrusters = [];
      this.setPhase("wait");
    }
  }

  /** Thrusters that lost their holder. */
  orphans(): Thruster[] {
    return this.thrusters.filter((t) => !t.owner);
  }

  /** Gives `from`'s thrusters (or the orphans, with from = "") to seat `to`. Returns how many moved. */
  handOver(from: string, to: string, only?: Thruster): number {
    const s = this.seats.get(to);
    if (!s) return 0;
    let n = 0;
    for (const th of this.thrusters) {
      if (th.owner !== from || (only && th !== only)) continue;
      th.owner = to;
      th.slot = s.slot;
      th.name = s.name;
      th.bot = s.bot;
      n++;
    }
    this.fixKeys();
    if (n) this.events.push({ type: "crew" });
    return n;
  }

  /** A seat with one thruster fires it with either input; a seat with two fires left with l and right with r. */
  private fixKeys() {
    const count = new Map<string, number>();
    for (const th of this.thrusters) count.set(th.owner, (count.get(th.owner) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const th of this.thrusters) {
      if ((count.get(th.owner) ?? 0) < 2) th.key = "any";
      else {
        const k = seen.get(th.owner) ?? 0;
        th.key = k === 0 ? "l" : "r";
        seen.set(th.owner, k + 1);
      }
    }
  }

  thrustersOf(id: string): Thruster[] {
    return this.thrusters.filter((t) => t.owner === id);
  }

  /** In the current run (holds a thruster). */
  flying(id: string): boolean {
    return this.thrusters.some((t) => t.owner === id);
  }

  setInput(id: string, l: boolean, r: boolean) {
    const s = this.seats.get(id);
    if (!s) return;
    s.l = l;
    s.r = r;
  }

  // ------------------------------------------------------------------ match flow

  startMatch(seed = Math.floor(this.rng() * 1e9)) {
    this.seed = seed;
    this.run = 0;
    this.heights = [];
    this.newRecord = false;
    this.matchRecord = false;
    for (const s of this.seats.values()) s.burn = 0;
    this.nextRun();
  }

  /** Lets newcomers in while the 3-2-1 is early: the crew is rebuilt and the count restarts. */
  admitLate(): boolean {
    if (this.phase !== "count" || this.t > COUNT_STEPS / 2) return false;
    if ([...this.seats.keys()].every((id) => this.flying(id))) return false;
    this.run--;
    this.nextRun();
    return true;
  }

  get matchBest(): number {
    return this.heights.length ? Math.max(...this.heights) : 0;
  }

  /** Height (m above the pad) of the rocket now. */
  get height(): number {
    return Math.max(0, this.rocket.y - PAD_Y);
  }

  get level(): number {
    return levelAt(this.best);
  }

  private nextRun() {
    this.opts = { ...this.next, runs: this.opts.runs };
    const list = [...this.seats.values()].sort((a, b) => a.slot - b.slot);
    if (!list.length) {
      this.thrusters = [];
      this.setPhase("wait");
      return;
    }
    this.run++;
    // every run of a match flies the same course: the crew can learn it
    this.course = new Course(seeded(this.seed), DIFFICULTIES[this.opts.difficulty]);
    this.course.ensure(0);
    this.lo = 0;
    this.loH = 0;
    this.bumps = 0;
    this.bumpCool = 0;
    const holders = list.length === 1 ? [list[0]!, list[0]!] : list;
    const ds = thrusterOffsets(holders.length);
    this.thrusters = holders.map((s, i) => ({ owner: s.id, key: "any", slot: s.slot, name: s.name, bot: s.bot, d: ds[i]!, on: false }));
    this.fixKeys();
    this.rocket = { x: 0, y: PAD_Y, vx: 0, vy: 0, a: 0, w: 0, px: 0, py: PAD_Y, pa: 0, alive: true };
    this.best = 0;
    this.floor = -DROP;
    this.flySteps = 0;
    this.lastMark = 0;
    this.newRecord = false;
    this.setPhase("count");
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  // ------------------------------------------------------------------ the step

  step() {
    this.t++;
    const r = this.rocket;
    r.px = r.x;
    r.py = r.y;
    r.pa = r.a;
    for (const th of this.thrusters) {
      const s = this.seats.get(th.owner);
      th.on = !!s && (this.phase === "fly" || this.phase === "count") && (th.key === "any" ? s.l || s.r : th.key === "l" ? s.l : s.r);
      if (th.on && this.phase === "fly" && s) s.burn++;
    }
    switch (this.phase) {
      case "count":
        if (this.t >= COUNT_STEPS) this.setPhase("fly");
        break;
      case "fly":
        this.fly();
        break;
      case "result":
        if (this.t >= RESULT_STEPS) {
          if (this.run >= this.opts.runs) this.setPhase("match");
          else this.nextRun();
        }
        break;
      default:
        break;
    }
  }

  private fly() {
    const r = this.rocket;
    const n = this.thrusters.length || 1;
    const per = (THRUST_ALL * G) / n;
    let lift = 0;
    let torque = 0;
    for (const th of this.thrusters) {
      if (!th.on) continue;
      lift += per;
      torque -= th.d * per;
    }
    const diff = this.course.diff;
    const sin = Math.sin(r.a);
    const cos = Math.cos(r.a);
    r.vx += (lift * sin - DRAG_X * r.vx) * STEP;
    r.vy += (lift * cos - G - DRAG_Y * r.vy) * STEP;
    r.w += (torque / INERTIA - SPIN_DAMP * r.w - diff.right * Math.sin(r.a)) * STEP;
    r.x += r.vx * STEP;
    r.y += r.vy * STEP;
    r.a += r.w * STEP;
    // the pad holds the rocket until the drop line passes it
    if (r.y < PAD_Y && this.floor < 0) {
      r.y = PAD_Y;
      if (r.vy < 0) r.vy = 0;
      r.vx *= 0.8;
      r.a *= 0.85;
      r.w *= 0.5;
    }
    this.flySteps++;
    const h = this.height;
    if (h > this.best) this.best = h;
    const mark = Math.floor(this.best / 100) * 100;
    if (mark > this.lastMark) {
      this.lastMark = mark;
      this.events.push({ type: "mark", height: mark });
    }
    if (this.best > CREEP_FROM || this.flySteps > CREEP_DELAY) {
      const creep = diff.creep[0] + (diff.creep[1] - diff.creep[0]) * this.level;
      this.floor += creep * STEP;
    }
    this.floor = Math.max(this.floor, this.best + PAD_Y - DROP);
    this.course.ensure(r.y);
    const t = this.time;
    const rs = this.course.rects;
    while (this.lo < rs.length && rs[this.lo]!.y1 < this.floor - 30) this.lo++;
    const hs = this.course.hazards;
    while (this.loH < hs.length && hs[this.loH]!.box[3] < this.floor - 30) this.loH++;
    this.bump();
    const lost = r.y - 2.2 < this.floor;
    const hit = this.hits(t);
    if (lost || hit) this.crash(lost, lost ? "drop" : hit!.k);
  }

  /** Pushes the rocket out of the walls and slabs, bounces it a little, slows it and gives it a small spin. */
  private bump() {
    const r = this.rocket;
    if (this.bumpCool > 0) this.bumpCool--;
    for (let pass = 0; pass < 3; pass++) {
      const c = Math.cos(r.a);
      const s = Math.sin(r.a);
      let best: { nx: number; ny: number; depth: number; ox: number; oy: number; hr: number } | null = null;
      for (const [hx, hy, hr] of HULL) {
        const ox = hx * c + hy * s;
        const oy = -hx * s + hy * c;
        const ct = solidContact(this.course, r.x + ox, r.y + oy, hr, this.lo);
        if (ct && (!best || ct.depth > best.depth)) best = { ...ct, ox, oy, hr };
      }
      if (!best) return;
      r.x += best.nx * best.depth;
      r.y += best.ny * best.depth;
      const vn = r.vx * best.nx + r.vy * best.ny;
      if (vn >= 0) continue;
      const J = -(1 + BUMP_BOUNCE) * vn;
      r.vx += J * best.nx;
      r.vy += J * best.ny;
      // scrape: part of the sliding speed goes too
      const tx = -best.ny;
      const ty = best.nx;
      const vt = r.vx * tx + r.vy * ty;
      r.vx -= vt * tx * BUMP_SCRAPE;
      r.vy -= vt * ty * BUMP_SCRAPE;
      // a hit off the middle turns the rocket (a is clockwise, the lever below counter-clockwise)
      const lever = best.ox * best.ny - best.oy * best.nx;
      r.w = Math.max(-2.2, Math.min(2.2, r.w - (lever * J * BUMP_SPIN) / INERTIA));
      if (-vn > 1 && this.bumpCool === 0) {
        this.bumpCool = BUMP_GAP;
        this.bumps++;
        this.events.push({
          type: "bump", x: r.x + best.ox - best.nx * best.hr, y: r.y + best.oy - best.ny * best.hr, nx: best.nx, ny: best.ny,
          power: Math.min(1, -vn / 8),
        });
      }
    }
  }

  /** Flight time in seconds (moving blocks run on it). */
  get time(): number {
    return this.flySteps * STEP;
  }

  /** The hazard the rocket touches now, if any. */
  hits(t = this.time) {
    const r = this.rocket;
    const c = Math.cos(r.a);
    const s = Math.sin(r.a);
    for (const [hx, hy, hr] of HULL) {
      // rotate by -a (positive a leans the nose right, clockwise)
      const x = r.x + hx * c + hy * s;
      const y = r.y - hx * s + hy * c;
      const h = hazardAt(this.course, x, y, hr, t, this.loH);
      if (h) return h;
    }
    return null;
  }

  private crash(lost: boolean, cause: HazardKind | "drop") {
    const r = this.rocket;
    r.alive = false;
    const height = Math.floor(this.best);
    this.heights.push(height);
    const best = height > this.record;
    if (best) {
      this.record = height;
      this.newRecord = true;
      this.matchRecord = true;
    }
    for (const th of this.thrusters) th.on = false;
    this.events.push({ type: "crash", x: r.x, y: r.y, a: r.a, vx: r.vx, vy: r.vy, w: r.w, height, best, lost, cause });
    this.setPhase("result");
  }

  drainEvents(): LiftoffEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** A small seeded random source (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { FIRST_AT };
