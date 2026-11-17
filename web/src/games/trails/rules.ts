// Trails: the rules, with no drawing. Lines never stop; each leaves a solid trail. Touch any trail (yours too) or
// the edge and you are out for the round. Every crash gives each line still moving one point.
//
// Collision uses an occupancy grid of CELL-sized cells over the arena: each cell keeps the owner's slot and how far
// that owner had travelled when it was written, so a line can ignore the cells it has only just left.
// Everything runs in fixed 60 Hz steps and all timers count steps, so a seeded game replays exactly.

export const ARENA_W = 1280;
export const ARENA_H = 880;
export const CELL = 2;
export const GW = ARENA_W / CELL;
export const GH = ARENA_H / CELL;
/** Half the trail's width (collision and drawing). */
export const HALF = 2;
export const LINE_W = HALF * 2;
export const STEP = 1 / 60;
export const MAX_SEATS = 8;
/** Own cells written within this distance behind the head don't count. */
export const SELF_IGNORE = 12;
/** Length of a break in a trail, px. */
export const GAP_LEN = 30;
export const COUNT_STEPS = 3 * 60;
export const ROUND_STEPS = Math.round(3.6 * 60);

export const SPEEDS = { calm: 120, normal: 150, fast: 185 } as const;
/** Points to reach, per opponent. */
export const TARGETS = { short: 4, normal: 6, long: 9 } as const;
/** The most rounds a match runs before the leader takes it. */
export const CAPS = { short: 10, normal: 15, long: 22 } as const;
export type SpeedKey = keyof typeof SPEEDS;
export type TargetKey = keyof typeof TARGETS;

/** Turn rate (rad/s) at a speed: a little quicker when faster, so the turning circle grows only slowly. */
export const turnRate = (v: number) => 2.4 + v * 0.006;
/** Speed rises a little in long rounds: from 15 s in, +1.2 % a second, up to +40 %. */
export const rampAt = (playSteps: number) => 1 + Math.min(0.4, Math.max(0, playSteps * STEP - 15) * 0.012);

export type Rng = () => number;
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

export type Phase = "wait" | "count" | "play" | "round" | "match";

export interface Options {
  target: TargetKey;
  speed: SpeedKey;
  gaps: boolean;
}

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  score: number;
  /** Points won this round. */
  gain: number;
  /** Plays in the current round (false: joined mid-round, waits). */
  inRound: boolean;
  alive: boolean;
  x: number;
  y: number;
  /** Position at the previous step, for drawing between steps. */
  px: number;
  py: number;
  /** Heading, radians (0 = right, y grows downward, so + turns clockwise on screen). */
  a: number;
  /** -1 left, 0 straight, 1 right. */
  turn: number;
  /** Distance travelled this round. */
  dist: number;
  /** Distance to the next gap, and what is left of the current one. */
  gapIn: number;
  gapLeft: number;
  /** The trail as points [x, y, …]; NaN, NaN marks a break. */
  path: number[];
  /** Order out this round (1 = first out), 0 while alive. */
  out: number;
}

export type TrailsEvent =
  | { type: "phase"; phase: Phase }
  | { type: "crash"; id: string; slot: number; x: number; y: number; a: number; by: number }
  | { type: "points"; ids: string[]; n: number }
  | { type: "round"; survivor: string | null }
  | { type: "match"; winners: string[] };

export class Trails {
  phase: Phase = "wait";
  round = 0;
  /** Steps since the phase began. */
  t = 0;
  /** Steps of play this round (drives the speed ramp). */
  playSteps = 0;
  stepNo = 0;
  readonly seats = new Map<string, Seat>();
  /** Trails of lines that left mid-round: still obstacles, still drawn. */
  ghosts: { slot: number; path: number[] }[] = [];
  readonly owner = new Uint8Array(GW * GH);
  readonly cellDist = new Float32Array(GW * GH);
  opts: Options;
  /** Options for the next round (speed and gaps change between rounds). */
  private next: Options;
  target = 0;
  cap: number = CAPS.normal;
  winners: string[] = [];
  private outCount = 0;
  private events: TrailsEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { target: "normal", speed: "normal", gaps: true, ...opts };
    this.next = { ...this.opts };
  }

  configure(opts: Partial<Options>) {
    this.next = { ...this.next, ...opts };
    // the target can change straight away; the rest waits for the next round
    if (opts.target && opts.target !== this.opts.target) {
      this.opts.target = opts.target;
      this.updateTarget();
    }
  }

  // ------------------------------------------------------------------ seats

  /** Adds a line. It plays from the next round (or at once, if nothing is running). Null when all seats are taken. */
  addSeat(id: string, name: string, bot = false, prefer = -1): Seat | null {
    const had = this.seats.get(id);
    if (had) return had;
    if (this.seats.size >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    for (const g of this.ghosts) used.add(g.slot);
    let slot = prefer >= 0 && prefer < MAX_SEATS && !used.has(prefer) ? prefer : -1;
    for (let i = 0; slot < 0 && i < MAX_SEATS; i++) if (!used.has(i)) slot = i;
    if (slot < 0) slot = [...Array(MAX_SEATS).keys()].find((i) => ![...this.seats.values()].some((s) => s.slot === i))!;
    const s: Seat = {
      id, name, slot, bot, score: 0, gain: 0, inRound: false, alive: false,
      x: 0, y: 0, px: 0, py: 0, a: 0, turn: 0, dist: 0, gapIn: 0, gapLeft: 0, path: [], out: 0,
    };
    this.seats.set(id, s);
    return s;
  }

  /** Removes a line. Its trail stays until the round ends. Leaving is not a crash: nobody scores. */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    this.seats.delete(id);
    if (s.inRound && s.path.length) this.ghosts.push({ slot: s.slot, path: s.path });
    if (this.phase === "play" || this.phase === "count") {
      if (this.racing().length < 2) this.endRound();
    } else if (this.phase !== "match" && this.seats.size < 2) this.setPhase("wait");
    this.updateTarget();
  }

  setInput(id: string, left: boolean, right: boolean) {
    const s = this.seats.get(id);
    if (s) s.turn = (right ? 1 : 0) - (left ? 1 : 0);
  }

  /** Lines in this round, alive or not. */
  players(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound);
  }

  /** Lines still moving. */
  racing(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound && s.alive);
  }

  standings(): Seat[] {
    return [...this.seats.values()].sort((a, b) => b.score - a.score || a.slot - b.slot);
  }

  get speed(): number {
    return SPEEDS[this.opts.speed] * rampAt(this.playSteps);
  }

  // ------------------------------------------------------------------ match flow

  startMatch() {
    for (const s of this.seats.values()) {
      s.score = 0;
      s.gain = 0;
    }
    this.round = 0;
    this.winners = [];
    this.nextRound();
  }

  /** Lets new lines in at once while the 3-2-1 is still early: everyone is placed again and the count restarts. */
  admitLate(): boolean {
    if (this.phase !== "count" || this.t > COUNT_STEPS / 2) return false;
    if (![...this.seats.values()].some((s) => !s.inRound)) return false;
    this.round--;
    this.nextRound();
    return true;
  }

  private updateTarget() {
    const n = Math.max(2, this.phase === "wait" || this.phase === "match" ? this.seats.size : this.players().length || this.seats.size);
    this.target = TARGETS[this.opts.target] * (n - 1);
    this.cap = CAPS[this.opts.target];
  }

  private nextRound() {
    this.opts = { ...this.next };
    this.owner.fill(0);
    this.cellDist.fill(0);
    this.ghosts = [];
    this.playSteps = 0;
    this.outCount = 0;
    const list = [...this.seats.values()];
    for (const s of list) {
      s.inRound = false;
      s.alive = false;
      s.gain = 0;
      s.path = [];
      s.out = 0;
    }
    if (list.length < 2) {
      this.updateTarget();
      this.setPhase("wait");
      return;
    }
    this.round++;
    this.spawn(list);
    this.updateTarget();
    this.setPhase("count");
  }

  private spawn(list: Seat[]) {
    const rng = this.rng;
    const m = 150;
    let minD = 330;
    const pts: { x: number; y: number }[] = [];
    for (let tries = 1; pts.length < list.length; tries++) {
      if (tries % 150 === 0) minD *= 0.88;
      const x = m + rng() * (ARENA_W - 2 * m);
      const y = m + rng() * (ARENA_H - 2 * m);
      if (pts.every((p) => Math.hypot(p.x - x, p.y - y) >= minD)) pts.push({ x, y });
    }
    list.forEach((s, i) => {
      const p = pts[i]!;
      const toCentre = Math.atan2(ARENA_H / 2 - p.y, ARENA_W / 2 - p.x);
      let a = toCentre + (rng() - 0.5) * 1.8;
      if (!clearAhead(p.x, p.y, a, 260)) a = toCentre;
      Object.assign(s, {
        inRound: true, alive: true, x: p.x, y: p.y, px: p.x, py: p.y, a, turn: 0, dist: 0,
        gapIn: this.gapGap() + 60, gapLeft: 0, path: [p.x, p.y],
      });
    });
  }

  /** Distance until the next gap: every 2–4.5 s at the base speed. */
  private gapGap() {
    return SPEEDS[this.opts.speed] * (2 + this.rng() * 2.5);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  private endRound() {
    if (this.phase !== "play" && this.phase !== "count") return;
    const left = this.racing();
    for (const s of left) s.alive = false;
    this.events.push({ type: "round", survivor: left.length === 1 ? left[0]!.id : null });
    this.setPhase("round");
  }

  /** The winners if the match is over: the target reached with a lead of 2, or the round cap. */
  checkWinner(): string[] | null {
    const ranked = this.standings();
    if (ranked.length === 0) return null;
    const top = ranked[0]!.score;
    const second = ranked[1]?.score ?? 0;
    if (top >= this.target && top - second >= 2) return [ranked[0]!.id];
    if (this.round >= this.cap) {
      if (top > second) return [ranked[0]!.id];
      // tied at the cap: play on a little, then share it
      if (this.round >= this.cap + 3) return ranked.filter((s) => s.score === top).map((s) => s.id);
    }
    return null;
  }

  // ------------------------------------------------------------------ the step

  step() {
    this.stepNo++;
    this.t++;
    switch (this.phase) {
      case "wait":
        if (this.seats.size >= 2) this.nextRound();
        break;
      case "count":
        if (this.t >= COUNT_STEPS) this.setPhase("play");
        break;
      case "play":
        this.playSteps++;
        this.move();
        break;
      case "round":
        if (this.t >= ROUND_STEPS) {
          const w = this.checkWinner();
          if (w) {
            this.winners = w;
            this.events.push({ type: "match", winners: w });
            this.setPhase("match");
          } else this.nextRound();
        }
        break;
      case "match":
        break;
    }
  }

  private move() {
    const v = this.speed;
    const d = v * STEP;
    const n = Math.max(1, Math.ceil(d / 1));
    const sd = d / n;
    const dt = STEP / n;
    const w = turnRate(v);
    const order = this.racing();
    if (this.stepNo & 1) order.reverse(); // nobody always moves first
    for (const s of order) {
      s.px = s.x;
      s.py = s.y;
    }
    const crashed = new Map<Seat, number>();
    for (let k = 0; k < n; k++) {
      for (const s of order) {
        if (crashed.has(s)) continue;
        s.a += s.turn * w * dt;
        s.x += Math.cos(s.a) * sd;
        s.y += Math.sin(s.a) * sd;
        s.dist += sd;
        const by = this.probe(s);
        if (by !== null) {
          crashed.set(s, by);
          continue;
        }
        if (s.gapLeft > 0) {
          s.gapLeft -= sd;
          if (s.gapLeft <= 0) s.gapIn = this.gapGap();
        } else {
          this.stamp(s);
          s.gapIn -= sd;
          if (s.gapIn <= 0 && this.opts.gaps) s.gapLeft = GAP_LEN;
        }
      }
    }
    for (const s of order) {
      const p = s.path;
      const inGap = s.gapLeft > 0 && !crashed.has(s);
      if (inGap) {
        if (!Number.isNaN(p[p.length - 1]!)) p.push(NaN, NaN);
      } else if (crashed.has(s)) {
        // a crashed line is drawn right up to what it touched
        const reach = crashed.get(s)! === -1 ? 0 : HALF + 1;
        p.push(s.x + Math.cos(s.a) * reach, s.y + Math.sin(s.a) * reach);
      } else p.push(s.x, s.y);
    }
    if (!crashed.size) return;
    // everyone out this step goes together, then the rest score
    this.outCount++;
    for (const [s, by] of crashed) {
      s.alive = false;
      s.out = this.outCount;
      this.events.push({ type: "crash", id: s.id, slot: s.slot, x: s.x, y: s.y, a: s.a, by });
    }
    const still = this.racing();
    for (const s of still) {
      s.score += crashed.size;
      s.gain += crashed.size;
    }
    if (still.length) this.events.push({ type: "points", ids: still.map((s) => s.id), n: crashed.size });
    if (still.length < 2) this.endRound();
  }

  /** What the head is about to touch: a slot, -1 for the edge, or null. */
  probe(s: Seat): number | null {
    const c = Math.cos(s.a);
    const sn = Math.sin(s.a);
    const tx = s.x + c * (HALF + 1);
    const ty = s.y + sn * (HALF + 1);
    if (tx < 0 || ty < 0 || tx >= ARENA_W || ty >= ARENA_H) return -1;
    const side = HALF * 0.8;
    for (const k of [0, 1, -1]) {
      const hit = this.cellAt(tx - sn * side * k, ty + c * side * k, s.slot, s.dist);
      if (hit !== null) return hit;
    }
    return null;
  }

  /** The slot owning the cell at (x, y), unless empty or the line's own fresh trail. */
  cellAt(x: number, y: number, slot: number, dist: number): number | null {
    if (x < 0 || y < 0 || x >= ARENA_W || y >= ARENA_H) return null;
    const i = Math.floor(y / CELL) * GW + Math.floor(x / CELL);
    const o = this.owner[i]!;
    if (!o) return null;
    if (o - 1 === slot && dist - this.cellDist[i]! < SELF_IGNORE) return null;
    return o - 1;
  }

  private stamp(s: Seat) {
    const x0 = Math.max(0, Math.floor((s.x - HALF) / CELL));
    const x1 = Math.min(GW - 1, Math.floor((s.x + HALF) / CELL));
    const y0 = Math.max(0, Math.floor((s.y - HALF) / CELL));
    const y1 = Math.min(GH - 1, Math.floor((s.y + HALF) / CELL));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * GW + i;
        if (this.owner[k]) continue;
        this.owner[k] = s.slot + 1;
        this.cellDist[k] = s.dist;
      }
    }
  }

  drainEvents(): TrailsEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** True if a straight run of `len` from (x, y) at angle a stays well inside the arena. */
export function clearAhead(x: number, y: number, a: number, len: number, margin = 50): boolean {
  for (let d = 0; d <= len; d += 20) {
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d;
    if (px < margin || py < margin || px > ARENA_W - margin || py > ARENA_H - margin) return false;
  }
  return true;
}
