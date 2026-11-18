// Blast Party: the rules, with no drawing. Round bean fighters on a platform over a drop. Throw bombs, punch, hop;
// a blast knocks you back by how close you stood, and you are out when you are knocked off the edge. There is no
// health. The last one standing (or the last team) takes the round; the first to `wins` takes the match.
//
// Physics is plain circles and boxes in fixed 60 Hz steps (no library): players, bombs that roll with friction,
// crates (static boxes that break), knock-back impulses, and a fall test against the platform. After CRUMBLE_AFTER
// the platform is cut down a step at a time so rounds end. All timers count steps, and the only random source is
// injected, so a seeded game replays exactly.
import { ARENAS, ARENA_ORDER, inPoly, type Arena, type ArenaKey, type CrateDef } from "./arenas.ts";

export const STEP = 1 / 60;
export const MAX_SEATS = 8;
/** Fighter and bomb radius, logical px. */
export const PR = 22;
export const BR = 12;
export const WINS = [3, 5] as const;
export const MODES = ["ffa", "team"] as const;
export type Mode = (typeof MODES)[number];

/** Stick acceleration (px/s²) and drag (1/s): top speed is ACCEL / DRAG (270 px/s). */
export const ACCEL = 2160;
export const DRAG = 8;
export const SPEED_BOOST = 1.45;
/** Knocked back: drag while sliding, and how long at most (steers weakly meanwhile). */
export const SLIDE_DRAG = 3.2;
export const KNOCK_STEPS = 50;
export const KNOCK_GRIP = 0.3;
export const MAX_SPEED = 1000;

export const BOMB_FUSE = 120;
export const BOMB_COOL = 72;
export const BOMB_MAX = 2;
export const BOMB_V = 400;
export const BOMB_DRAG = 1.7;
/** A rolling bomb faster than this goes off when it hits a fighter. */
export const BOMB_HIT_V = 130;
/** A fighter's own bomb ignores it this long after the throw. */
export const OWN_GRACE = 25;
export const BLAST_R = 120;
export const BLAST_BIG = 185;
export const KB_MIN = 140;
export const KB_MAX = 520;

export const PUNCH_COOL = 38;
export const PUNCH_REACH = 66;
export const PUNCH_KB = 430;
export const PUNCH_BOMB_V = 520;
export const JUMP_STEPS = 32;
/** After landing, a short wait before the next hop. */
export const JUMP_REST = 12;
/** While the hop has more steps than this left, the fighter is off the ground (no ground shock, no fall). */
export const AIR_AT = 3;

export const POWER_STEPS = 10 * 60;
export const SHIELD_STEPS = 12 * 60;
export const PICKUP_LIFE = 12 * 60;
export const DROP_CHANCE = 0.4;
export const MAX_PICKUPS = 4;

export const COUNT_STEPS = 3 * 60;
export const ROUND_STEPS = Math.round(3.6 * 60);
/** The platform is cut down every CRUMBLE_EVERY after CRUMBLE_AFTER, to CRUMBLE_MIN of its size. */
export const CRUMBLE_AFTER = 45 * 60;
export const CRUMBLE_EVERY = Math.round(3.5 * 60);
export const CRUMBLE_BY = 0.1;
export const CRUMBLE_MIN = 0.18;
export const CRUMBLE_WARN = 90;
export const ROUND_CAP = 100 * 60;

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
export type BombKind = "normal" | "big" | "sticky";
export type PowerKind = "big" | "triple" | "sticky" | "speed" | "shield";
export const POWERS: PowerKind[] = ["big", "triple", "sticky", "speed", "shield"];
export type ArenaSetting = "rotate" | ArenaKey;

export interface Options {
  mode: Mode;
  wins: number;
  arena: ArenaSetting;
}

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  /** Rounds won this match (in a team match: unused). */
  wins: number;
  /** 0 or 1 in a team match, -1 otherwise. Set at each round start. */
  team: number;
  /** Place within its team (0–3), for the team colour. */
  tix: number;
  inRound: boolean;
  alive: boolean;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  face: number;
  ix: number;
  iy: number;
  /** Steps left of the hop, of the hop's rest, of the punch and bomb cooldowns, of the slide after a knock. */
  jumpT: number;
  jumpRest: number;
  punchCool: number;
  bombCool: number;
  /** Steps since the last punch (for the swing), large when none. */
  punchT: number;
  knock: number;
  shield: boolean;
  shieldT: number;
  speedT: number;
  pw: "big" | "triple" | "sticky" | null;
  pwT: number;
  /** Steps since going over the edge, 0 while in. Order out this round (1 = first). */
  outT: number;
  out: number;
  lastBy: string | null;
  lastByT: number;
}

export interface Bomb {
  id: number;
  group: number;
  owner: string;
  kind: BombKind;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  fuse: number;
  age: number;
  /** Id of the fighter it sticks to. */
  stuck: string | null;
  /** Steps since it rolled off the platform, 0 while on it. */
  falling: number;
}

export interface Crate extends CrateDef {
  id: number;
}

export interface Pickup {
  id: number;
  kind: PowerKind;
  x: number;
  y: number;
  age: number;
}

export type BlastEvent =
  | { type: "phase"; phase: Phase }
  | { type: "throw"; id: string; x: number; y: number; a: number; kind: BombKind }
  | { type: "blast"; x: number; y: number; r: number; big: boolean }
  | { type: "hit"; id: string; x: number; y: number; power: number }
  | { type: "dodge"; id: string; x: number; y: number }
  | { type: "shield"; id: string; x: number; y: number }
  | { type: "crate"; x: number; y: number; w: number; h: number; kind: "crate" | "soap"; crumble: boolean }
  | { type: "drop"; x: number; y: number; kind: PowerKind }
  | { type: "pickup"; id: string; kind: PowerKind; x: number; y: number }
  | { type: "powerEnd"; id: string }
  | { type: "punch"; id: string; x: number; y: number; a: number; hit: boolean }
  | { type: "jump"; id: string; x: number; y: number }
  | { type: "land"; id: string; x: number; y: number }
  | { type: "stick"; id: string; x: number; y: number }
  | { type: "fall"; id: string; slot: number; x: number; y: number }
  | { type: "bombFall"; x: number; y: number }
  | { type: "warn" }
  | { type: "crumble"; scale: number }
  | { type: "round"; winner: string | null; team: number | null }
  | { type: "match"; winner: string | null; team: number | null };

const clampWins = (n: number) => ((WINS as readonly number[]).includes(n) ? n : 3);
const clampMode = (m: unknown): Mode => (m === "team" ? "team" : "ffa");
const clampArena = (a: unknown): ArenaSetting => (typeof a === "string" && a in ARENAS ? (a as ArenaKey) : "rotate");

const hypot = Math.hypot;

export class Blast {
  phase: Phase = "wait";
  round = 0;
  /** Steps since the phase began. */
  t = 0;
  stepNo = 0;
  readonly seats = new Map<string, Seat>();
  opts: Options;
  arena: Arena = ARENAS.shelf;
  /** Index of the first arena of the match when rotating. */
  private arenaStart = 0;
  /** The platform's size now (1 = whole), the stage it is at, and the next size. */
  floorScale = 1;
  stage = 0;
  bombs: Bomb[] = [];
  crates: Crate[] = [];
  pickups: Pickup[] = [];
  roundWinner: string | null = null;
  roundTeam: number | null = null;
  winner: string | null = null;
  winTeam: number | null = null;
  teamWins: [number, number] = [0, 0];
  private outCount = 0;
  private nextId = 1;
  private events: BlastEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { mode: "ffa", wins: 3, arena: "rotate", ...opts };
    this.opts.mode = clampMode(this.opts.mode);
    this.opts.wins = clampWins(this.opts.wins);
    this.opts.arena = clampArena(this.opts.arena);
    this.arena = ARENAS[this.opts.arena === "rotate" ? ARENA_ORDER[0]! : this.opts.arena];
    this.teamMode = this.opts.mode === "team";
  }

  configure(opts: Partial<Options>) {
    if (opts.wins !== undefined) this.opts.wins = clampWins(opts.wins);
    if (opts.mode !== undefined) this.opts.mode = clampMode(opts.mode);
    if (opts.arena !== undefined) this.opts.arena = clampArena(opts.arena);
    if (this.phase === "wait") this.teamMode = this.opts.mode === "team";
  }

  /** Teams or not for the round in progress. A mode change in the menu applies from the next round. */
  private teamMode = false;

  get team() {
    return this.teamMode;
  }

  // ------------------------------------------------------------------ ground

  /** Is there platform under this point? (The platform's size is `scale` of the arena's.) */
  groundAt(x: number, y: number, scale = this.floorScale): boolean {
    const a = this.arena;
    const gx = x / scale;
    const gy = y / scale;
    if (!inPoly(gx, gy, a.poly)) return false;
    for (const h of a.holes) if (inPoly(gx, gy, h)) return false;
    return true;
  }

  /** Where the platform's size goes at the next crumble, or 0 when it has reached its smallest. */
  nextScale(): number {
    const n = this.floorScale - CRUMBLE_BY;
    return this.floorScale <= CRUMBLE_MIN + 0.001 ? 0 : Math.max(CRUMBLE_MIN, n);
  }

  /** Steps until the next crumble (for the warning), counted from the start of play. */
  crumbleIn(): number {
    return CRUMBLE_AFTER + this.stage * CRUMBLE_EVERY - this.t;
  }

  // ------------------------------------------------------------------ seats

  /** Adds a fighter. It plays from the next round. Null when all seats are taken. */
  addSeat(id: string, name: string, bot = false, prefer = -1): Seat | null {
    const had = this.seats.get(id);
    if (had) return had;
    if (this.seats.size >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    let slot = prefer >= 0 && prefer < MAX_SEATS && !used.has(prefer) ? prefer : -1;
    for (let i = 0; slot < 0 && i < MAX_SEATS; i++) if (!used.has(i)) slot = i;
    const s: Seat = {
      id, name, slot, bot, wins: 0, team: -1, tix: 0, inRound: false, alive: false,
      x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, face: 0, ix: 0, iy: 0,
      jumpT: 0, jumpRest: 0, punchCool: 0, bombCool: 0, punchT: 999, knock: 0,
      shield: false, shieldT: 0, speedT: 0, pw: null, pwT: 0, outT: 0, out: 0, lastBy: null, lastByT: 0,
    };
    this.seats.set(id, s);
    return s;
  }

  /** Removes a fighter. Leaving is not a fall: if fewer than two are left in the round, the round is void. */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    this.seats.delete(id);
    for (const b of this.bombs) if (b.stuck === id) b.stuck = null;
    if (this.phase === "play" || this.phase === "count") {
      if (this.players().length < 2 || (this.team && !this.bothTeams())) this.endRound(null, null);
    } else if (this.phase !== "match" && this.seats.size < 2) this.setPhase("wait");
  }

  private bothTeams(): boolean {
    const t = this.players().map((s) => s.team);
    return t.includes(0) && t.includes(1);
  }

  /** The stick: any vector, clamped to length 1. Anything not finite counts as released. */
  setInput(id: string, x: number, y: number) {
    const s = this.seats.get(id);
    if (!s) return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) x = y = 0;
    const m = hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    s.ix = x;
    s.iy = y;
  }

  private canAct(s: Seat | undefined): s is Seat {
    return !!s && this.phase === "play" && s.alive && s.inRound;
  }

  private angleOf(s: Seat, a?: number) {
    return a !== undefined && Number.isFinite(a) ? a : s.face;
  }

  /** Throw a bomb the way the fighter faces (bots may pass an angle). */
  throwBomb(id: string, angle?: number): boolean {
    const s = this.seats.get(id);
    if (!this.canAct(s) || s.bombCool > 0) return false;
    const live = new Set(this.bombs.filter((b) => b.owner === id).map((b) => b.group));
    if (live.size >= BOMB_MAX) return false;
    const a = this.angleOf(s, angle);
    s.face = a;
    s.bombCool = BOMB_COOL;
    const group = this.nextId++;
    const kind: BombKind = s.pw === "big" ? "big" : s.pw === "sticky" ? "sticky" : "normal";
    const spread = s.pw === "triple" ? [-0.3, 0, 0.3] : [0];
    for (const d of spread) {
      const aa = a + d;
      const dx = Math.cos(aa);
      const dy = Math.sin(aa);
      const x = s.x + dx * (PR + BR + 4);
      const y = s.y + dy * (PR + BR + 4);
      const b: Bomb = {
        id: this.nextId++, group, owner: id, kind, x, y, px: x, py: y,
        vx: dx * BOMB_V + s.vx * 0.5, vy: dy * BOMB_V + s.vy * 0.5, fuse: BOMB_FUSE, age: 0, stuck: null, falling: 0,
      };
      this.bombs.push(b);
    }
    this.events.push({ type: "throw", id, x: s.x, y: s.y, a, kind });
    return true;
  }

  /** A short hop: no ground shock, no fall, for JUMP_STEPS. */
  jump(id: string) {
    const s = this.seats.get(id);
    if (!this.canAct(s) || s.jumpT > 0 || s.jumpRest > 0) return;
    s.jumpT = JUMP_STEPS;
    this.events.push({ type: "jump", id, x: s.x, y: s.y });
  }

  /** A short punch in front: knocks back whoever is there, and bats a bomb away. */
  punch(id: string, angle?: number) {
    const s = this.seats.get(id);
    if (!this.canAct(s) || s.punchCool > 0) return;
    const a = this.angleOf(s, angle);
    s.face = a;
    s.punchCool = PUNCH_COOL;
    s.punchT = 0;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let hit = false;
    for (const o of this.seats.values()) {
      if (o === s || !o.alive || !o.inRound) continue;
      const rx = o.x - s.x;
      const ry = o.y - s.y;
      const d = hypot(rx, ry);
      if (d > PUNCH_REACH + PR * 0.5 || (rx * dx + ry * dy) / (d || 1) < 0.35) continue;
      hit = true;
      if (o.shield) {
        this.popShield(o);
        continue;
      }
      this.knockBack(o, rx / (d || 1), ry / (d || 1), PUNCH_KB, s.id);
      this.events.push({ type: "hit", id: o.id, x: o.x, y: o.y, power: PUNCH_KB });
    }
    for (const b of this.bombs) {
      if (b.stuck || b.falling) continue;
      const rx = b.x - s.x;
      const ry = b.y - s.y;
      const d = hypot(rx, ry);
      if (d > PUNCH_REACH + BR || (rx * dx + ry * dy) / (d || 1) < 0.2) continue;
      b.vx = dx * PUNCH_BOMB_V;
      b.vy = dy * PUNCH_BOMB_V;
      b.age = 0;
      b.owner = s.id;
      hit = true;
    }
    this.events.push({ type: "punch", id, x: s.x, y: s.y, a, hit });
  }

  /** Fighters in this round, in or out. */
  players(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound);
  }

  /** Fighters still on the platform. */
  inside(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound && s.alive);
  }

  airborne(s: Seat) {
    return s.jumpT > AIR_AT;
  }

  standings(): Seat[] {
    if (this.team) return [...this.seats.values()].sort((a, b) => a.team - b.team || a.slot - b.slot);
    return [...this.seats.values()].sort((a, b) => b.wins - a.wins || a.slot - b.slot);
  }

  // ------------------------------------------------------------------ match flow

  startMatch() {
    for (const s of this.seats.values()) s.wins = 0;
    this.teamWins = [0, 0];
    this.round = 0;
    this.winner = null;
    this.winTeam = null;
    this.arenaStart = Math.floor(this.rng() * ARENA_ORDER.length);
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
    this.outCount = 0;
    this.roundWinner = null;
    this.roundTeam = null;
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
    // a mode change from the menu takes hold here: the match score starts again in the new mode
    const wantTeam = this.opts.mode === "team";
    if (wantTeam !== this.teamMode) {
      this.teamMode = wantTeam;
      for (const s of list) s.wins = 0;
      this.teamWins = [0, 0];
      this.round = 0;
      this.winner = null;
      this.winTeam = null;
    }
    this.round++;
    const key: ArenaKey = this.opts.arena === "rotate" ? ARENA_ORDER[(this.arenaStart + this.round - 1) % ARENA_ORDER.length]! : this.opts.arena;
    this.arena = ARENAS[key];
    this.floorScale = 1;
    this.stage = 0;
    this.bombs = [];
    this.pickups = [];
    this.crates = this.arena.crates.map((c) => ({ ...c, id: this.nextId++ }));
    if (!this.team) for (const s of list) s.team = -1;
    this.spawn(list);
    this.setPhase("count");
  }

  /** Teams: alternate by colour slot. A fighter keeps the same team while the roster does not change. */
  private assignTeams(list: Seat[]) {
    const byslot = list.slice().sort((a, b) => a.slot - b.slot);
    byslot.forEach((s, i) => {
      s.team = i % 2;
      s.tix = i >> 1;
    });
  }

  private spawn(list: Seat[]) {
    const sp = this.arena.spawns;
    const n = list.length;
    let at: Array<[number, number]>;
    if (this.team) {
      this.assignTeams(list);
      // team 0 takes the left half, team 1 the right half, each spread over its four points
      const sorted = sp.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const halves = [sorted.slice(0, 4), sorted.slice(4)];
      const used = [0, 0];
      const count = [list.filter((s) => s.team === 0).length, list.filter((s) => s.team === 1).length];
      at = list.map((s) => {
        const half = halves[s.team]!.slice().sort((a, b) => a[1] - b[1]);
        const k = Math.min(half.length - 1, Math.floor((used[s.team]!++ * half.length) / count[s.team]!));
        return half[k]!;
      });
    } else {
      // spread evenly over the eight points, the whole ring turned a random amount, shuffled
      const turn = Math.floor(this.rng() * 8);
      const order = list.slice();
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      const map = new Map<string, [number, number]>();
      order.forEach((s, i) => map.set(s.id, sp[(turn + Math.floor((i * 8) / n)) % 8]!));
      at = list.map((s) => map.get(s.id)!);
    }
    list.forEach((s, i) => {
      const [x, y] = at[i]!;
      Object.assign(s, {
        inRound: true, alive: true, x, y, px: x, py: y, vx: 0, vy: 0, face: Math.atan2(-y, -x), ix: 0, iy: 0,
        jumpT: 0, jumpRest: 0, punchCool: 0, bombCool: 0, punchT: 999, knock: 0, shield: false, shieldT: 0, speedT: 0,
        pw: null, pwT: 0, outT: 0, out: 0, lastBy: null, lastByT: 0,
      });
    });
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  private endRound(winner: string | null, team: number | null) {
    if (this.phase !== "play" && this.phase !== "count") return;
    this.roundWinner = winner;
    this.roundTeam = team;
    if (team !== null) this.teamWins[team]!++;
    else {
      const w = winner ? this.seats.get(winner) : null;
      if (w) w.wins++;
    }
    for (const s of this.seats.values()) {
      s.ix = s.iy = 0;
    }
    this.events.push({ type: "round", winner, team });
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
        this.play();
        break;
      case "round":
        this.coast();
        if (this.t >= ROUND_STEPS) {
          if (this.team) {
            const top = this.teamWins[0] >= this.teamWins[1] ? 0 : 1;
            if (this.teamWins[top]! >= this.opts.wins) {
              this.winTeam = top;
              this.events.push({ type: "match", winner: null, team: top });
              this.setPhase("match");
              break;
            }
          } else {
            const top = this.standings()[0];
            if (top && top.wins >= this.opts.wins) {
              this.winner = top.id;
              this.events.push({ type: "match", winner: top.id, team: null });
              this.setPhase("match");
              break;
            }
          }
          this.nextRound();
        }
        break;
      case "match":
        break;
    }
  }

  /** The round result: bombs still fall and roll, fighters slide to a stop, nobody falls any more. */
  private coast() {
    for (const s of this.players()) {
      s.px = s.x;
      s.py = s.y;
      const k = Math.exp(-4 * STEP);
      s.vx *= k;
      s.vy *= k;
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      if (!s.alive) s.outT++;
      if (s.jumpT > 0) s.jumpT--;
      if (s.punchT < 999) s.punchT++;
    }
    for (const b of this.bombs) {
      b.px = b.x;
      b.py = b.y;
    }
  }

  private play() {
    const all = this.players();
    for (const s of all) {
      s.px = s.x;
      s.py = s.y;
      if (s.punchT < 999) s.punchT++;
      if (!s.alive) {
        s.outT++;
        const k = Math.exp(-3 * STEP);
        s.vx *= k;
        s.vy *= k;
        s.x += s.vx * STEP;
        s.y += s.vy * STEP;
        continue;
      }
      if (s.bombCool > 0) s.bombCool--;
      if (s.punchCool > 0) s.punchCool--;
      if (s.jumpRest > 0) s.jumpRest--;
      if (s.lastBy && ++s.lastByT > 240) s.lastBy = null;
      if (s.jumpT > 0 && --s.jumpT === 0) {
        s.jumpRest = JUMP_REST;
        this.events.push({ type: "land", id: s.id, x: s.x, y: s.y });
      }
      if (s.speedT > 0 && --s.speedT === 0) this.events.push({ type: "powerEnd", id: s.id });
      if (s.shieldT > 0 && --s.shieldT === 0) {
        s.shield = false;
        this.events.push({ type: "powerEnd", id: s.id });
      }
      if (s.pwT > 0 && --s.pwT === 0) {
        s.pw = null;
        this.events.push({ type: "powerEnd", id: s.id });
      }
      // movement
      const im = hypot(s.ix, s.iy);
      let drag = DRAG;
      let grip = 1;
      if (s.knock > 0) {
        s.knock--;
        grip = KNOCK_GRIP;
        drag = SLIDE_DRAG;
        if (im < 0.1 && hypot(s.vx, s.vy) < 90) s.knock = 0;
      }
      const acc = ACCEL * (s.speedT > 0 ? SPEED_BOOST : 1) * grip;
      s.vx += s.ix * acc * STEP;
      s.vy += s.iy * acc * STEP;
      const k = Math.exp(-drag * STEP);
      s.vx *= k;
      s.vy *= k;
      const v = hypot(s.vx, s.vy);
      if (v > MAX_SPEED) {
        s.vx *= MAX_SPEED / v;
        s.vy *= MAX_SPEED / v;
      }
      s.x += s.vx * STEP;
      s.y += s.vy * STEP;
      if (im > 0.2) {
        let da = Math.atan2(s.iy, s.ix) - s.face;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        s.face += da * Math.min(1, 16 * STEP);
      }
    }
    this.moveBombs();
    this.collisions();
    this.pickUp();
    this.fuses();
    this.fall();
    this.crumble();
    this.judge();
  }

  private moveBombs() {
    for (const b of this.bombs) {
      b.px = b.x;
      b.py = b.y;
      b.age++;
      if (b.falling) {
        b.falling++;
        b.x += b.vx * STEP;
        b.y += b.vy * STEP;
        continue;
      }
      b.fuse--;
      if (b.stuck) {
        const h = this.seats.get(b.stuck);
        if (h) {
          b.x = h.x;
          b.y = h.y;
        } else b.stuck = null;
        continue;
      }
      const k = Math.exp(-BOMB_DRAG * STEP);
      b.vx *= k;
      b.vy *= k;
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
    }
  }

  /** A circle against the crates: push out, bounce a little. Returns true when it touched one. */
  private crateBump(o: { x: number; y: number; vx: number; vy: number }, r: number, e: number): boolean {
    let touched = false;
    for (const c of this.crates) {
      const hx = c.w / 2;
      const hy = c.h / 2;
      const nx = Math.max(c.x - hx, Math.min(o.x, c.x + hx));
      const ny = Math.max(c.y - hy, Math.min(o.y, c.y + hy));
      let dx = o.x - nx;
      let dy = o.y - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      touched = true;
      let d = Math.sqrt(d2);
      if (d < 0.001) {
        // centre inside the box: leave by the nearest side
        const ex = hx - Math.abs(o.x - c.x);
        const ey = hy - Math.abs(o.y - c.y);
        if (ex < ey) {
          dx = o.x >= c.x ? 1 : -1;
          dy = 0;
          d = -ex;
        } else {
          dx = 0;
          dy = o.y >= c.y ? 1 : -1;
          d = -ey;
        }
      } else {
        dx /= d;
        dy /= d;
      }
      const over = r - d;
      o.x += dx * over;
      o.y += dy * over;
      const vn = o.vx * dx + o.vy * dy;
      if (vn < 0) {
        o.vx -= (1 + e) * vn * dx;
        o.vy -= (1 + e) * vn * dy;
      }
    }
    return touched;
  }

  private collisions() {
    const live = this.inside();
    // fighters against each other
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) this.bump(live[i]!, live[j]!);
      }
    }
    for (const s of live) {
      if (this.crateBump(s, PR, 0.3)) {
        s.knock = Math.max(0, s.knock - 4);
      }
    }
    for (const b of this.bombs) {
      if (b.falling || b.stuck) continue;
      this.crateBump(b, BR, 0.55);
    }
    // bombs against fighters
    for (const b of this.bombs) {
      if (b.falling || b.stuck || b.fuse <= 0) continue;
      for (const s of live) {
        if (!s.alive || this.airborne(s)) continue;
        const dx = s.x - b.x;
        const dy = s.y - b.y;
        const d = hypot(dx, dy);
        if (d >= PR + BR) continue;
        if (b.owner === s.id && b.age < OWN_GRACE) continue;
        if (b.kind === "sticky") {
          b.stuck = s.id;
          b.vx = b.vy = 0;
          this.events.push({ type: "stick", id: s.id, x: s.x, y: s.y });
          break;
        }
        const speed = hypot(b.vx, b.vy);
        if (speed > BOMB_HIT_V) {
          b.fuse = 0;
          break;
        }
        // a slow bomb is shoved aside
        const nx = d ? -dx / d : 1;
        const ny = d ? -dy / d : 0;
        b.x = s.x + nx * (PR + BR);
        b.y = s.y + ny * (PR + BR);
        const push = Math.max(0, s.vx * nx + s.vy * ny);
        b.vx = b.vx * 0.4 + nx * push * 1.1;
        b.vy = b.vy * 0.4 + ny * push * 1.1;
      }
    }
  }

  private bump(a: Seat, b: Seat) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    const min = PR * 2;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.001;
    const nx = d2 ? dx / d : 1;
    const ny = d2 ? dy / d : 0;
    const over = (min - d) / 2;
    a.x -= nx * over;
    a.y -= ny * over;
    b.x += nx * over;
    b.y += ny * over;
    const vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
    if (vn <= 0) return;
    const j = ((1 + 0.4) * vn) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    b.vx += j * nx;
    b.vy += j * ny;
  }

  private pickUp() {
    for (const p of this.pickups) p.age++;
    this.pickups = this.pickups.filter((p) => p.age < PICKUP_LIFE);
    for (const s of this.inside()) {
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const p = this.pickups[i]!;
        if (hypot(p.x - s.x, p.y - s.y) > PR + 14 || this.airborne(s)) continue;
        this.pickups.splice(i, 1);
        this.give(s, p.kind);
        this.events.push({ type: "pickup", id: s.id, kind: p.kind, x: p.x, y: p.y });
      }
    }
  }

  private give(s: Seat, kind: PowerKind) {
    if (kind === "speed") s.speedT = POWER_STEPS;
    else if (kind === "shield") {
      s.shield = true;
      s.shieldT = SHIELD_STEPS;
    } else {
      s.pw = kind;
      s.pwT = POWER_STEPS;
    }
  }

  private popShield(s: Seat) {
    s.shield = false;
    s.shieldT = 0;
    this.events.push({ type: "shield", id: s.id, x: s.x, y: s.y });
    this.events.push({ type: "powerEnd", id: s.id });
  }

  /** Knock a fighter back along (nx, ny): the push is added to what it already has. */
  private knockBack(s: Seat, nx: number, ny: number, power: number, by: string | null) {
    s.vx += nx * power;
    s.vy += ny * power;
    s.knock = KNOCK_STEPS;
    if (by && by !== s.id) {
      s.lastBy = by;
      s.lastByT = 0;
    }
  }

  private fuses() {
    for (let guard = 0; guard < 12; guard++) {
      const due = this.bombs.filter((b) => b.fuse <= 0 && !b.falling);
      if (!due.length) break;
      this.bombs = this.bombs.filter((b) => !due.includes(b));
      for (const b of due) this.explode(b);
    }
    this.bombs = this.bombs.filter((b) => b.falling < 26);
  }

  /** Does the straight line from (x0, y0) to (x1, y1) pass through a crate? */
  blocked(x0: number, y0: number, x1: number, y1: number): boolean {
    for (const c of this.crates) {
      let t0 = 0;
      let t1 = 1;
      const d = [x1 - x0, y1 - y0];
      const lo = [c.x - c.w / 2, c.y - c.h / 2];
      const hi = [c.x + c.w / 2, c.y + c.h / 2];
      const o = [x0, y0];
      let hit = true;
      for (let i = 0; i < 2; i++) {
        if (Math.abs(d[i]!) < 1e-9) {
          if (o[i]! < lo[i]! || o[i]! > hi[i]!) hit = false;
        } else {
          let a = (lo[i]! - o[i]!) / d[i]!;
          let b = (hi[i]! - o[i]!) / d[i]!;
          if (a > b) [a, b] = [b, a];
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) hit = false;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  private explode(b: Bomb) {
    const big = b.kind === "big";
    const R = big ? BLAST_BIG : BLAST_R;
    const kb = big ? 1.2 : 1;
    this.events.push({ type: "blast", x: b.x, y: b.y, r: R, big });
    // who is shielded from it by a crate (looked up before any crate breaks)
    const covered = (x: number, y: number) => this.blocked(b.x, b.y, x, y);
    for (const s of this.inside()) {
      const rx = s.x - b.x;
      const ry = s.y - b.y;
      const d = hypot(rx, ry);
      if (d > R + PR * 0.4 || covered(s.x, s.y)) continue;
      if (this.airborne(s)) {
        this.events.push({ type: "dodge", id: s.id, x: s.x, y: s.y });
        continue;
      }
      if (s.shield) {
        this.popShield(s);
        continue;
      }
      const f = Math.max(0, 1 - d / R);
      const power = (KB_MIN + (KB_MAX - KB_MIN) * f) * kb;
      const nx = d > 0.5 ? rx / d : Math.cos(this.rng() * Math.PI * 2);
      const ny = d > 0.5 ? ry / d : Math.sin(this.rng() * Math.PI * 2);
      this.knockBack(s, nx, ny, power, b.owner);
      this.events.push({ type: "hit", id: s.id, x: s.x, y: s.y, power });
    }
    for (const o of this.bombs) {
      if (o.falling) continue;
      const rx = o.x - b.x;
      const ry = o.y - b.y;
      const d = hypot(rx, ry);
      if (d > R || covered(o.x, o.y)) continue;
      o.fuse = Math.min(o.fuse, 6);
      if (!o.stuck && d > 0.5) {
        o.vx += (rx / d) * 300;
        o.vy += (ry / d) * 300;
      }
    }
    this.pickups = this.pickups.filter((p) => hypot(p.x - b.x, p.y - b.y) > R * 0.75 || covered(p.x, p.y));
    // crates the blast reaches break, and may leave a power-up
    const broken = this.crates.filter((c) => {
      const nx = Math.max(c.x - c.w / 2, Math.min(b.x, c.x + c.w / 2));
      const ny = Math.max(c.y - c.h / 2, Math.min(b.y, c.y + c.h / 2));
      return hypot(nx - b.x, ny - b.y) < R * 0.85;
    });
    if (broken.length) {
      this.crates = this.crates.filter((c) => !broken.includes(c));
      for (const c of broken) {
        this.events.push({ type: "crate", x: c.x, y: c.y, w: c.w, h: c.h, kind: c.kind, crumble: false });
        if (this.pickups.length < MAX_PICKUPS && this.rng() < DROP_CHANCE) {
          const kind = POWERS[Math.floor(this.rng() * POWERS.length)]!;
          this.pickups.push({ id: this.nextId++, kind, x: c.x, y: c.y, age: 0 });
          this.events.push({ type: "drop", x: c.x, y: c.y, kind });
        }
      }
    }
  }

  /** A fighter whose centre is over the drop (and not hopping) goes out. */
  private fall() {
    for (const b of this.bombs) {
      if (b.falling || b.stuck) continue;
      if (!this.groundAt(b.x, b.y)) {
        b.falling = 1;
        this.events.push({ type: "bombFall", x: b.x, y: b.y });
      }
    }
    const gone = this.inside().filter((s) => !this.airborne(s) && !this.groundAt(s.x, s.y));
    if (!gone.length) return;
    this.outCount++;
    for (const s of gone) {
      s.alive = false;
      s.out = this.outCount;
      s.outT = 0;
      s.knock = 0;
      this.events.push({ type: "fall", id: s.id, slot: s.slot, x: s.x, y: s.y });
    }
  }

  private crumble() {
    if (this.t < CRUMBLE_AFTER + this.stage * CRUMBLE_EVERY) {
      if (this.crumbleIn() === CRUMBLE_WARN && this.nextScale() > 0) this.events.push({ type: "warn" });
      return;
    }
    this.stage++;
    const to = this.nextScale();
    if (to === 0) {
      // the last stage: nothing is left, so all who are still in go out together (a draw)
      this.floorScale = 0.0001;
    } else this.floorScale = to;
    this.events.push({ type: "crumble", scale: this.floorScale });
    this.crates = this.crates.filter((c) => {
      if (this.groundAt(c.x, c.y)) return true;
      this.events.push({ type: "crate", x: c.x, y: c.y, w: c.w, h: c.h, kind: c.kind, crumble: true });
      return false;
    });
    this.pickups = this.pickups.filter((p) => this.groundAt(p.x, p.y));
  }

  /** Is the round decided? */
  private judge() {
    const left = this.inside();
    if (this.team) {
      const teams = new Set(left.map((s) => s.team));
      if (teams.size <= 1 && this.players().length >= 2) {
        const t = teams.size ? [...teams][0]! : null;
        this.endRound(t === null ? null : (left.slice().sort((a, b) => a.slot - b.slot)[0]!.id), t);
        return;
      }
    } else if (left.length <= 1 && this.players().length >= 2) {
      this.endRound(left.length === 1 ? left[0]!.id : null, null);
      return;
    }
    if (this.t >= ROUND_CAP) this.endRound(null, null);
  }

  drainEvents(): BlastEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}
