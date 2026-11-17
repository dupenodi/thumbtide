// Shove: the rules, with no drawing. Heavy round wrestlers on a round ring; push the others out. The last one inside
// takes the round, and the first to `wins` rounds takes the match.
//
// Physics is plain circle-circle in fixed 60 Hz steps (no library): every wrestler has the same mass, a stick that
// accelerates it against drag, and a Dash (a short burst with a cooldown). Bumps are soft (low restitution); a dash
// that lands is a hard hit that hands over most of the dasher's momentum. A wrestler whose centre passes the rope is
// out. Holding still near the rope braces: heavier in collisions and slower to slide. After SHRINK_AFTER of play the
// ring is pulled in a step at a time, so rounds stay short. All timers count steps, and the only random source is
// injected, so a seeded game replays exactly.

export const STEP = 1 / 60;
export const MAX_SEATS = 8;
/** Wrestler radius, logical px. */
export const BODY_R = 46;
/** Ring radius per size setting, logical px (the view fits RING_VIEW in its box). */
export const RINGS = { small: 310, normal: 370, large: 430 } as const;
export const RING_VIEW = 430;
/** Wins to take the match. */
export const WINS = [3, 5, 7] as const;

/** Stick acceleration (px/s²) and drag (1/s): top speed is ACCEL / DRAG. */
export const ACCEL = 800;
export const DRAG = 2.0;
/** Dash: speed added along the dash, how long it lasts (low drag, no steering), and the cooldown. */
export const DASH_V = 720;
export const DASH_STEPS = 14;
/** The dash's speed is added over this many steps. */
export const DASH_RAMP = 4;
export const DASH_DRAG = 0.9;
export const DASH_COOL = 90;
/** A dash pressed this many steps before the cooldown ends still happens (phone and TV clocks differ a little). */
export const DASH_EARLY = 8;
export const MAX_SPEED = 950;
/** Restitution of a plain bump and of a dash that lands. */
export const E_BUMP = 0.3;
export const E_DASH = 0.95;
/** A wrestler hit by a dash steers weakly for this long. */
export const STUN_STEPS = 30;
/** Bracing: near the rope (centre within BRACE_BAND of it) with the stick released: heavier, and digs in its heels. */
export const BRACE_BAND = BODY_R * 2.4;
export const BRACE_MASS = 1.7;
export const BRACE_DRAG = 3;

export const COUNT_STEPS = 3 * 60;
export const ROUND_STEPS = Math.round(3.6 * 60);
/** The ring starts to shrink after this much play, then one rope pull every SHRINK_EVERY. */
export const SHRINK_AFTER = 20 * 60;
export const SHRINK_EVERY = Math.round(2.5 * 60);
/** Each pull takes the ring in by this fraction of its starting radius, down to SHRINK_MIN of it. */
export const SHRINK_BY = 0.09;
export const SHRINK_MIN = 0.08;
/** A rope pull lasts this many steps. */
export const PULL_STEPS = 24;
/** A round that still runs after this long is decided: the one nearest the middle takes it. */
export const ROUND_CAP = 90 * 60;

export type RingKey = keyof typeof RINGS;
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
  wins: number;
  ring: RingKey;
}

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  /** Rounds won this match. */
  wins: number;
  /** Plays in the current round (false: joined mid-round, waits). */
  inRound: boolean;
  /** Still on the sand. */
  alive: boolean;
  x: number;
  y: number;
  /** Position at the previous step, for drawing between steps. */
  px: number;
  py: number;
  vx: number;
  vy: number;
  /** Where the face looks, radians. */
  face: number;
  /** The stick, clamped to the unit disc. */
  ix: number;
  iy: number;
  /** Dash asked for (taken at the next step if ready). */
  wantDash: boolean;
  /** Steps left of the current dash, and of the cooldown. */
  dashT: number;
  cool: number;
  /** Direction of the current dash. */
  dashA: number;
  stun: number;
  braced: boolean;
  /** Who touched this wrestler last, and how many steps ago (for "pushed out by"). */
  lastBy: string | null;
  lastByT: number;
  /** Order out this round (1 = first out), 0 while in. Steps since going out. */
  out: number;
  outT: number;
}

export type ShoveEvent =
  | { type: "phase"; phase: Phase }
  | { type: "dash"; id: string; slot: number; x: number; y: number; a: number }
  | { type: "hit"; a: string; b: string; x: number; y: number; power: number; dash: boolean }
  | { type: "out"; id: string; slot: number; x: number; y: number; by: string | null }
  | { type: "shrink"; from: number; to: number }
  | { type: "round"; winner: string | null }
  | { type: "match"; winner: string };

const clampWins = (n: number) => (WINS as readonly number[]).includes(n) ? n : 3;

export class Shove {
  phase: Phase = "wait";
  round = 0;
  /** Steps since the phase began. */
  t = 0;
  stepNo = 0;
  readonly seats = new Map<string, Seat>();
  opts: Options;
  /** The ring size waits for the next round. */
  private nextRing: RingKey;
  /** Ring radius now; the radius at the start of the round; the pull in progress (from → to over PULL_STEPS). */
  ringR: number = RINGS.normal;
  baseR: number = RINGS.normal;
  pullFrom = 0;
  pullTo = 0;
  pullT = PULL_STEPS;
  /** Winner of the last round, and of the match. */
  roundWinner: string | null = null;
  winner: string | null = null;
  private outCount = 0;
  private events: ShoveEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { wins: 3, ring: "normal", ...opts };
    this.opts.wins = clampWins(this.opts.wins);
    this.nextRing = this.opts.ring;
    this.ringR = this.baseR = RINGS[this.opts.ring];
  }

  configure(opts: Partial<Options>) {
    if (opts.wins !== undefined) this.opts.wins = clampWins(opts.wins);
    if (opts.ring) {
      this.nextRing = opts.ring;
      if (this.phase === "wait" || this.phase === "match") this.applyRing();
    }
  }

  private applyRing() {
    this.opts.ring = this.nextRing;
    this.ringR = this.baseR = RINGS[this.opts.ring];
    this.pullT = PULL_STEPS;
  }

  // ------------------------------------------------------------------ seats

  /** Adds a wrestler. It plays from the next round. Null when all seats are taken. */
  addSeat(id: string, name: string, bot = false, prefer = -1): Seat | null {
    const had = this.seats.get(id);
    if (had) return had;
    if (this.seats.size >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    let slot = prefer >= 0 && prefer < MAX_SEATS && !used.has(prefer) ? prefer : -1;
    for (let i = 0; slot < 0 && i < MAX_SEATS; i++) if (!used.has(i)) slot = i;
    const s: Seat = {
      id, name, slot, bot, wins: 0, inRound: false, alive: false,
      x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, face: 0, ix: 0, iy: 0, wantDash: false,
      dashT: 0, cool: 0, dashA: 0, stun: 0, braced: false, lastBy: null, lastByT: 0, out: 0, outT: 0,
    };
    this.seats.set(id, s);
    return s;
  }

  /** Removes a wrestler. Leaving is not a ring-out: if it leaves fewer than two on the sand, the round is void. */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    this.seats.delete(id);
    if (this.phase === "play" || this.phase === "count") {
      if (this.inside().length < 2) this.endRound(null);
    } else if (this.phase !== "match" && this.seats.size < 2) this.setPhase("wait");
  }

  /** The stick: any vector, clamped to length 1. Anything not finite counts as released. */
  setInput(id: string, x: number, y: number) {
    const s = this.seats.get(id);
    if (!s) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) x = y = 0;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    s.ix = x;
    s.iy = y;
  }

  /** Ask for a dash; it happens as soon as the cooldown is over (a press up to DASH_EARLY steps early is kept). */
  dash(id: string) {
    const s = this.seats.get(id);
    if (s && this.phase === "play" && s.alive && s.cool <= DASH_EARLY) s.wantDash = true;
  }

  /** Wrestlers in this round, in or out. */
  players(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound);
  }

  /** Wrestlers still on the sand. */
  inside(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound && s.alive);
  }

  standings(): Seat[] {
    return [...this.seats.values()].sort((a, b) => b.wins - a.wins || a.slot - b.slot);
  }

  // ------------------------------------------------------------------ match flow

  startMatch() {
    for (const s of this.seats.values()) s.wins = 0;
    this.round = 0;
    this.winner = null;
    this.nextRound();
  }

  /** Lets newcomers in at once while the 3-2-1 is still early: everyone is placed again and the count restarts. */
  admitLate(): boolean {
    if (this.phase !== "count" || this.t > COUNT_STEPS / 2) return false;
    if (![...this.seats.values()].some((s) => !s.inRound)) return false;
    this.round--;
    this.nextRound();
    return true;
  }

  private nextRound() {
    this.applyRing();
    this.outCount = 0;
    this.roundWinner = null;
    const list = [...this.seats.values()];
    for (const s of list) {
      s.inRound = false;
      s.alive = false;
      s.out = 0;
    }
    if (list.length < 2) {
      this.setPhase("wait");
      return;
    }
    this.round++;
    this.spawn(list);
    this.setPhase("count");
  }

  /** Evenly round a circle inside the ring, each facing the middle; the circle turns a random amount each round. */
  private spawn(list: Seat[]) {
    const n = list.length;
    const r = this.baseR * (n <= 2 ? 0.42 : 0.56);
    const turn = this.rng() * Math.PI * 2;
    // shuffle the order so nobody always starts next to the same rival
    const order = list.slice();
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    order.forEach((s, i) => {
      const a = turn + (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      Object.assign(s, {
        inRound: true, alive: true, x, y, px: x, py: y, vx: 0, vy: 0, face: a + Math.PI, ix: 0, iy: 0,
        wantDash: false, dashT: 0, cool: 0, dashA: 0, stun: 0, braced: false, lastBy: null, lastByT: 0, out: 0, outT: 0,
      });
    });
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  private endRound(winner: string | null) {
    if (this.phase !== "play" && this.phase !== "count") return;
    this.roundWinner = winner;
    const w = winner ? this.seats.get(winner) : null;
    if (w) w.wins++;
    for (const s of this.seats.values()) {
      s.ix = s.iy = 0;
      s.wantDash = false;
    }
    this.events.push({ type: "round", winner });
    this.setPhase("round");
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
        this.ring();
        this.move();
        break;
      case "round":
        this.coast();
        if (this.t >= ROUND_STEPS) {
          const top = this.standings()[0];
          if (top && top.wins >= this.opts.wins) {
            this.winner = top.id;
            this.events.push({ type: "match", winner: top.id });
            this.setPhase("match");
          } else this.nextRound();
        }
        break;
      case "match":
        break;
    }
  }

  /** The shrink: after SHRINK_AFTER, a short rope pull every SHRINK_EVERY until SHRINK_MIN. */
  private ring() {
    if (this.pullT < PULL_STEPS) {
      this.pullT++;
      const k = this.pullT / PULL_STEPS;
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      this.ringR = this.pullFrom + (this.pullTo - this.pullFrom) * e;
    }
    const t = this.t - SHRINK_AFTER;
    if (t < 0 || t % SHRINK_EVERY !== 0) return;
    const min = this.baseR * SHRINK_MIN;
    const from = this.pullT < PULL_STEPS ? this.pullTo : this.ringR;
    if (from <= min + 0.5) return;
    this.pullFrom = this.ringR;
    this.pullTo = Math.max(min, from - this.baseR * SHRINK_BY);
    this.pullT = 0;
    this.events.push({ type: "shrink", from: this.pullFrom, to: this.pullTo });
  }

  /** The round result: anyone still sliding slows to a stop; those out drift on. */
  private coast() {
    for (const s of this.players()) {
      s.px = s.x;
      s.py = s.y;
      const k = Math.exp(-DRAG * 1.4 * STEP);
      s.vx *= k;
      s.vy *= k;
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      if (!s.alive) s.outT++;
    }
  }

  private move() {
    const all = this.players();
    const live = all.filter((s) => s.alive);
    const R = this.ringR;
    for (const s of all) {
      s.px = s.x;
      s.py = s.y;
      if (!s.alive) {
        // going over: keeps its slide, slows on the water
        s.outT++;
        const k = Math.exp(-DRAG * 1.6 * STEP);
        s.vx *= k;
        s.vy *= k;
        s.x += s.vx * STEP;
        s.y += s.vy * STEP;
        continue;
      }
      if (s.cool > 0) s.cool--;
      if (s.stun > 0) s.stun--;
      if (s.lastBy && ++s.lastByT > 150) s.lastBy = null;
      const im = Math.hypot(s.ix, s.iy);
      const sp = Math.hypot(s.vx, s.vy);
      // dash: along the stick, or the way it's moving, or the way it faces
      if (s.wantDash && s.cool === 0) {
        s.wantDash = false;
        const a = im > 0.25 ? Math.atan2(s.iy, s.ix) : sp > 40 ? Math.atan2(s.vy, s.vx) : s.face;
        s.dashA = a;
        s.dashT = DASH_STEPS;
        s.cool = DASH_COOL;
        s.face = a;
        s.braced = false;
        this.events.push({ type: "dash", id: s.id, slot: s.slot, x: s.x, y: s.y, a });
      }
      const d = Math.hypot(s.x, s.y);
      // holding still: it starts nearly at rest and holds while it's shoved slowly (a fast slide can't brake this way)
      s.braced = s.dashT === 0 && s.stun === 0 && im < 0.2 && d > R - BRACE_BAND && sp < (s.braced ? 220 : 80);
      let drag = DRAG;
      if (s.dashT > 0) {
        // the burst builds over its first few steps: a dash needs a little run-up to hit hard
        if (s.dashT > DASH_STEPS - DASH_RAMP) {
          s.vx += (Math.cos(s.dashA) * DASH_V) / DASH_RAMP;
          s.vy += (Math.sin(s.dashA) * DASH_V) / DASH_RAMP;
        }
        s.dashT--;
        drag = DASH_DRAG;
      } else {
        const grip = s.stun > 0 ? 0.1 : 1;
        s.vx += s.ix * ACCEL * grip * STEP;
        s.vy += s.iy * ACCEL * grip * STEP;
        if (s.braced) drag = BRACE_DRAG * DRAG;
      }
      const k = Math.exp(-drag * STEP);
      s.vx *= k;
      s.vy *= k;
      const v = Math.hypot(s.vx, s.vy);
      if (v > MAX_SPEED) {
        s.vx *= MAX_SPEED / v;
        s.vy *= MAX_SPEED / v;
      }
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      // the face turns toward the stick, or the way it's going
      const want = s.dashT > 0 ? s.dashA : im > 0.2 ? Math.atan2(s.iy, s.ix) : v > 60 ? Math.atan2(s.vy, s.vx) : s.face;
      let da = want - s.face;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      s.face += da * Math.min(1, 9 * STEP);
    }
    // collisions: two passes settle piles; order alternates so nobody always goes first
    const order = this.stepNo & 1 ? live.slice().reverse() : live;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < order.length; i++) for (let j = i + 1; j < order.length; j++) this.collide(order[i]!, order[j]!, pass === 0);
    }
    // the edge: a centre past the rope is out; everyone out this step goes together. If that would be everyone
    // left, the one nearest the middle stays in: there is always a last one inside.
    const gone = live.filter((s) => Math.hypot(s.x, s.y) > R);
    if (gone.length && gone.length === live.length) {
      const near = gone.reduce((a, b) => (Math.hypot(b.x, b.y) < Math.hypot(a.x, a.y) ? b : a));
      gone.splice(gone.indexOf(near), 1);
    }
    if (gone.length) {
      this.outCount++;
      for (const s of gone) {
        s.alive = false;
        s.out = this.outCount;
        s.outT = 0;
        s.dashT = 0;
        s.braced = false;
        this.events.push({ type: "out", id: s.id, slot: s.slot, x: s.x, y: s.y, by: s.lastBy });
      }
    }
    const left = this.inside();
    if (left.length <= 1 && live.length >= 1) {
      this.endRound(left.length === 1 ? left[0]!.id : null);
      return;
    }
    if (this.t >= ROUND_CAP) {
      // overtime: the one nearest the middle takes it
      const best = left.slice().sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))[0]!;
      this.endRound(best.id);
    }
  }

  private collide(a: Seat, b: Seat, first: boolean) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    const min = BODY_R * 2;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001;
    const nx = d2 ? dx / d : 1;
    const ny = d2 ? dy / d : 0;
    const ma = a.braced ? BRACE_MASS : 1;
    const mb = b.braced ? BRACE_MASS : 1;
    const ia = 1 / ma;
    const ib = 1 / mb;
    // push apart by inverse mass
    const over = min - d;
    a.x -= nx * over * (ia / (ia + ib));
    a.y -= ny * over * (ia / (ia + ib));
    b.x += nx * over * (ib / (ia + ib));
    b.y += ny * over * (ib / (ia + ib));
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // closing speed along a→b
    if (vn <= 0) return;
    // a dash that lands: who is dashing into whom
    const aDash = a.dashT > 0 && Math.cos(a.dashA) * nx + Math.sin(a.dashA) * ny > 0.3;
    const bDash = b.dashT > 0 && -(Math.cos(b.dashA) * nx + Math.sin(b.dashA) * ny) > 0.3;
    const dash = aDash || bDash;
    const e = dash ? E_DASH : E_BUMP;
    const j = ((1 + e) * vn) / (ia + ib);
    a.vx -= j * ia * nx;
    a.vy -= j * ia * ny;
    b.vx += j * ib * nx;
    b.vy += j * ib * ny;
    a.lastBy = b.id;
    a.lastByT = 0;
    b.lastBy = a.id;
    b.lastByT = 0;
    if (dash) {
      if (aDash) {
        a.dashT = 0;
        b.stun = STUN_STEPS;
      }
      if (bDash) {
        b.dashT = 0;
        a.stun = STUN_STEPS;
      }
    }
    if (first && (dash || vn > 140)) {
      this.events.push({ type: "hit", a: a.id, b: b.id, x: a.x + nx * BODY_R, y: a.y + ny * BODY_R, power: vn, dash });
    }
  }

  drainEvents(): ShoveEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
