// Stack Attack: the rules, with no drawing. Plain TypeScript, so Node can test and simulate it.
//
// Every player has a well, COLS × ROWS, with HIDDEN spare rows above it. Pieces fall, rows that fill up clear, and
// clears attack the others. The last well standing wins the round; the first to `wins` rounds takes the match
// (after `wins` + 3 rounds the leader takes it anyway).
// With one player it is a solo run for score.
//
// Our own piece set (not the classic seven): small pieces of 3–5 cells.
//   I3  a line of 3          L3  a corner of 3       O4  a 2×2 square
//   T4  a T of 4             S4  an S of 4 (no mirror twin: turn it, live with it)
//   X5  a plus of 5          U5  a U of 5
// The bag holds nine: the two small pieces twice, the rest once. Everybody in a round draws from the same seeded
// sequence (each well has its own bag object with the round's seed), so nobody gets luckier pieces.
//
// Attacks are "paper" rows:
//   - a clear of 1 / 2 / 3 rows sends 1 / 2 / 4 paper rows. Your own waiting paper is torn up first (cancelled).
//   - they go to the opponent with the LOWEST stack: the one who is most comfortable gets hit. Ties go to the next
//     player after the sender, by seat order. Out and waiting wells are never targets.
//   - they wait under your well and slide in when you lock a piece that clears nothing (never under a live piece).
//   - a batch shares one hole column. A paper row is full except for that hole.
//   - paper is weak: each paper row cracks and vanishes after its owner clears twice (two lock-clears, any rows).
//     A crack sends nothing. Filling the hole is a normal clear and counts.
// The order at a lock: stamp → clear full rows → (if any) age paper and remove cracked rows, send the attack →
// (if none) let waiting paper in → check the top.
//
// Gravity rises: one level every LEVEL_STEPS (8 s) of play, and one more each time a well goes out ("the table
// gets crowded"); each level is 28 % faster. After about a minute and a half nobody keeps up, so every round ends.
// Everything runs in fixed 60 Hz steps and all timers count steps, so a seeded game replays exactly.

export const COLS = 9;
export const ROWS = 18;
export const HIDDEN = 4;
/** All rows: the spare rows above, then the visible ones. Row 0 is the top. */
export const H = ROWS + HIDDEN;
export const STEP = 1 / 60;
export const MAX_SEATS = 8;
export const COUNT_STEPS = 3 * 60;
export const ROUND_STEPS = 4 * 60;
export const LEVEL_STEPS = 8 * 60;
export const LOCK_STEPS = 30;
export const LOCK_RESETS = 12;
/** Steps before the next piece appears, after a plain lock and after a clear. */
export const SPAWN_STEPS = 6;
export const CLEAR_STEPS = 16;
/** Soft drop: at most this many steps per row. */
export const SOFT_STEPS = 2;
/** Paper rows sent for a clear of 0, 1, 2 or 3 rows. */
export const SEND = [0, 1, 2, 4] as const;
/** A paper row cracks after this many clears by its owner. */
export const PAPER_LIFE = 2;
/** The most paper rows that slide in at one lock (the rest wait). */
export const MAX_IN = 6;
/** Points for a clear of 0–3 rows (solo), times the level + 1. */
export const POINTS = [0, 100, 250, 500] as const;

/** Steps per row at level 0. */
export const SPEEDS = { slow: 54, normal: 40, fast: 28 } as const;
export const WINS = [2, 3, 5] as const;
export type SpeedKey = keyof typeof SPEEDS;

/** Gravity at a level: steps per row (may be below 1: several rows a step). */
export const gravityAt = (speed: SpeedKey, level: number) => Math.max(0.25, SPEEDS[speed] * Math.pow(0.72, level));

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

// ------------------------------------------------------------------------------------------------ pieces

export const KINDS = ["I3", "L3", "O4", "T4", "S4", "X5", "U5"] as const;
export type Kind = (typeof KINDS)[number];
/** Grid values: 0 empty, 1–7 a block (the piece kind + 1), PAPER a paper cell. */
export const PAPER = 9;

/** Each piece in its spawn turn, as rows of a square box ("#" = cell). It turns about the box's centre. */
const SHAPES: Record<Kind, string[]> = {
  I3: ["...", "###", "..."],
  L3: ["#.", "##"],
  O4: ["##", "##"],
  T4: ["...", "###", ".#."],
  S4: ["...", ".##", "##."],
  X5: [".#.", "###", ".#."],
  U5: ["#.#", "###", "..."],
};
const BAG: Kind[] = ["I3", "I3", "L3", "L3", "O4", "T4", "S4", "X5", "U5"];

export type Cells = ReadonlyArray<readonly [number, number]>;

/** The cells of each kind in each of its four turns, [x, y] inside its box. */
export const TURNS: Record<Kind, Cells[]> = Object.fromEntries(
  KINDS.map((k) => {
    const rows = SHAPES[k];
    const n = rows.length;
    let cells: [number, number][] = [];
    rows.forEach((r, y) => [...r].forEach((ch, x) => ch === "#" && cells.push([x, y])));
    const turns: Cells[] = [];
    for (let t = 0; t < 4; t++) {
      turns.push(cells.map(([x, y]) => [x, y] as const));
      cells = cells.map(([x, y]) => [n - 1 - y, x]); // clockwise
    }
    return [k, turns];
  }),
) as Record<Kind, Cells[]>;
export const boxOf = (k: Kind) => SHAPES[k].length;

/** Offsets tried, in order, when a turn is blocked. */
const KICKS: ReadonlyArray<readonly [number, number]> = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0], [-1, -1], [1, -1]];

/** A shuffled bag of pieces from one random stream: the same seed gives the same sequence. */
export class Bag {
  private q: Kind[] = [];
  constructor(private rng: Rng) {}
  take(): Kind {
    if (!this.q.length) {
      const b = BAG.slice();
      for (let i = b.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [b[i], b[j]] = [b[j]!, b[i]!];
      }
      this.q = b;
    }
    return this.q.shift()!;
  }
}

// ------------------------------------------------------------------------------------------------ the board

export interface Piece {
  kind: Kind;
  rot: number;
  x: number;
  y: number;
}

/** True if a piece fits on the grid at this place. */
export function fits(grid: Uint8Array, kind: Kind, rot: number, x: number, y: number): boolean {
  for (const [cx, cy] of TURNS[kind][rot & 3]!) {
    const gx = x + cx;
    const gy = y + cy;
    if (gx < 0 || gx >= COLS || gy >= H) return false;
    if (gy >= 0 && grid[gy * COLS + gx]) return false;
  }
  return true;
}

/** Where a piece lands if dropped straight down from y. */
export function dropY(grid: Uint8Array, kind: Kind, rot: number, x: number, y: number): number {
  while (fits(grid, kind, rot, x, y + 1)) y++;
  return y;
}

/** The spawn place: centred, with its top cell in the first visible row. */
export function spawnOf(kind: Kind): Piece {
  const n = boxOf(kind);
  const top = Math.min(...TURNS[kind][0]!.map(([, y]) => y));
  return { kind, rot: 0, x: Math.floor((COLS - n) / 2), y: HIDDEN - top };
}

export const rowFull = (grid: Uint8Array, y: number) => {
  for (let x = 0; x < COLS; x++) if (!grid[y * COLS + x]) return false;
  return true;
};

/** Rows from the bottom up to the highest filled cell. */
export function stackHeight(grid: Uint8Array): number {
  for (let i = 0; i < grid.length; i++) if (grid[i]) return H - Math.floor(i / COLS);
  return 0;
}

// ------------------------------------------------------------------------------------------------ seats

export type Phase = "wait" | "count" | "play" | "round" | "match";

export interface Options {
  wins: number;
  speed: SpeedKey;
}

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  wins: number;
  /** Plays in the current round (false: joined mid-round, waits). */
  inRound: boolean;
  alive: boolean;
  /** Left during the round: the well stays, out, until the round ends. */
  gone: boolean;
  grid: Uint8Array;
  /** Per row: paper clears left before it cracks, 0 for a normal row. */
  paper: Uint8Array;
  piece: Piece | null;
  next: Kind;
  /** Counts pieces spawned (bots watch it). */
  pieceNo: number;
  bag: Bag;
  holes: Rng;
  /** Paper waiting to slide in, one entry per attack. */
  incoming: number[];
  fall: number;
  lockT: number;
  resets: number;
  /** Steps until the next piece appears. */
  wait: number;
  soft: boolean;
  lines: number;
  score: number;
  /** Paper rows sent this round. */
  sent: number;
  /** Order out this round (1 = first out), 0 while alive. */
  out: number;
  /** Bumped on every change the well's picture shows. */
  ver: number;
}

export const pendingOf = (s: Seat) => s.incoming.reduce((a, b) => a + b, 0);

export type StackEvent =
  | { type: "phase"; phase: Phase }
  | { type: "spawn"; id: string }
  | { type: "lock"; id: string; drop: boolean }
  /** Rows (grid y, before removal, top to bottom) and what was in them. */
  | { type: "clear"; id: string; rows: number[]; cells: number[][] }
  | { type: "crack"; id: string; rows: number[]; cells: number[][] }
  | { type: "attack"; from: string; to: string; n: number }
  | { type: "paper"; id: string; n: number }
  | { type: "out"; id: string }
  | { type: "round"; winner: string | null }
  | { type: "match"; winners: string[] };

export type Move = "left" | "right" | "rotate" | "drop" | "softOn" | "softOff";

export class Stack {
  phase: Phase = "wait";
  round = 0;
  /** Steps since the phase began. */
  t = 0;
  /** Steps of play this round (drives gravity). */
  playSteps = 0;
  readonly seats = new Map<string, Seat>();
  opts: Options;
  private next: Options;
  /** One player this round: a solo run for score. */
  solo = false;
  winners: string[] = [];
  /** The round's winner (null: nobody, or solo). */
  roundWinner: string | null = null;
  private outCount = 0;
  private events: StackEvent[] = [];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { wins: 3, speed: "normal", ...opts };
    this.next = { ...this.opts };
  }

  /** The wins target applies at once; speed from the next round. */
  configure(opts: Partial<Options>) {
    this.next = { ...this.next, ...opts };
    if (opts.wins) this.opts.wins = opts.wins;
  }

  /** Rounds after which the leader takes the match anyway. */
  get cap(): number {
    return this.opts.wins + 3;
  }

  get level(): number {
    return Math.floor(this.playSteps / LEVEL_STEPS) + this.outCount;
  }

  get gravity(): number {
    return gravityAt(this.opts.speed, this.level);
  }

  // ------------------------------------------------------------------ seats

  /** Adds a well. It plays from the next round. Null when all seats are taken. */
  addSeat(id: string, name: string, bot = false, prefer = -1): Seat | null {
    const had = this.seats.get(id);
    if (had) {
      had.gone = false;
      had.name = name;
      return had;
    }
    if (this.live().length >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    let slot = prefer >= 0 && prefer < MAX_SEATS && !used.has(prefer) ? prefer : -1;
    for (let i = 0; slot < 0 && i < MAX_SEATS; i++) if (!used.has(i)) slot = i;
    if (slot < 0) {
      // every slot is held, some by wells that left this round: take one of those now
      const g = [...this.seats.values()].find((s) => s.gone)!;
      this.seats.delete(g.id);
      slot = g.slot;
    }
    const s: Seat = {
      id, name, slot, bot, wins: 0, inRound: false, alive: false, gone: false,
      grid: new Uint8Array(COLS * H), paper: new Uint8Array(H), piece: null, next: "I3", pieceNo: 0,
      bag: new Bag(seeded(1)), holes: seeded(2), incoming: [], fall: 0, lockT: 0, resets: 0, wait: 0, soft: false,
      lines: 0, score: 0, sent: 0, out: 0, ver: 1,
    };
    this.seats.set(id, s);
    return s;
  }

  /** Removes a well. Mid-round it stays on screen, out, until the round ends. */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    const live = this.phase === "count" || this.phase === "play" || this.phase === "round";
    if (live && s.inRound) {
      s.gone = true;
      if (s.alive) {
        s.alive = false;
        s.piece = null;
        s.ver++;
        if (this.phase === "count" || this.phase === "play") {
          s.out = ++this.outCount;
          this.checkEnd();
        }
      }
    } else this.seats.delete(id);
    if (this.phase === "wait" || this.phase === "match") return;
    if (!this.live().length) this.setPhase("wait");
  }

  /** Seats that have not left. */
  live(): Seat[] {
    return [...this.seats.values()].filter((s) => !s.gone);
  }

  /** Wells in this round, alive or not, in seat order. */
  players(): Seat[] {
    return [...this.seats.values()].filter((s) => s.inRound).sort((a, b) => a.slot - b.slot);
  }

  alive(): Seat[] {
    return this.players().filter((s) => s.alive);
  }

  standings(): Seat[] {
    return this.live().sort((a, b) => b.wins - a.wins || b.sent - a.sent || a.slot - b.slot);
  }

  // ------------------------------------------------------------------ match flow

  startMatch() {
    for (const [id, s] of this.seats) if (s.gone) this.seats.delete(id);
    for (const s of this.seats.values()) s.wins = 0;
    this.round = 0;
    this.winners = [];
    this.nextRound();
  }

  /** Lets new wells in at once while the 3-2-1 is still early: the count starts again. */
  admitLate(): boolean {
    if (this.phase !== "count" || this.t > COUNT_STEPS / 2) return false;
    if (!this.live().some((s) => !s.inRound)) return false;
    this.round--;
    this.nextRound();
    return true;
  }

  private nextRound() {
    this.opts = { ...this.next, wins: this.opts.wins };
    for (const [id, s] of this.seats) if (s.gone) this.seats.delete(id);
    this.playSteps = 0;
    this.outCount = 0;
    this.roundWinner = null;
    const list = [...this.seats.values()];
    if (!list.length) {
      this.setPhase("wait");
      return;
    }
    this.round++;
    this.solo = list.length === 1;
    const seed = Math.floor(this.rng() * 2 ** 31);
    for (const s of list) {
      s.inRound = true;
      s.alive = true;
      s.grid.fill(0);
      s.paper.fill(0);
      s.piece = null;
      s.bag = new Bag(seeded(seed));
      s.holes = seeded(seed ^ Math.imul(s.slot + 1, 0x9e3779b1));
      s.next = s.bag.take();
      s.pieceNo = 0;
      s.incoming = [];
      s.fall = 0;
      s.lockT = 0;
      s.resets = 0;
      s.wait = 0;
      s.soft = false;
      s.lines = 0;
      s.score = 0;
      s.sent = 0;
      s.out = 0;
      s.ver++;
    }
    this.setPhase("count");
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  /** The match winners if it is over: `wins` reached, or the leader at the round cap. */
  checkWinner(): string[] | null {
    if (this.solo) return [];
    const ranked = this.live().sort((a, b) => b.wins - a.wins);
    if (!ranked.length) return [];
    const top = ranked[0]!.wins;
    const second = ranked[1]?.wins ?? 0;
    if (top >= this.opts.wins) return [ranked[0]!.id];
    if (this.round >= this.cap) {
      if (top > second) return [ranked[0]!.id];
      if (this.round >= this.cap + 2) return ranked.filter((s) => s.wins === top).map((s) => s.id);
    }
    return null;
  }

  private checkEnd() {
    if (this.phase !== "play" && this.phase !== "count") return;
    const left = this.alive();
    if (this.solo ? left.length > 0 : left.length > 1) return;
    const w = !this.solo && left.length === 1 ? left[0]! : null;
    if (w) {
      w.wins++;
      w.piece = null;
      w.ver++;
    }
    this.roundWinner = w?.id ?? null;
    this.events.push({ type: "round", winner: this.roundWinner });
    this.setPhase("round");
  }

  // ------------------------------------------------------------------ moves

  /** A player's move. Ignored outside play, for wells that are out, and between pieces. */
  input(id: string, m: Move): boolean {
    const s = this.seats.get(id);
    if (!s) return false;
    if (m === "softOff" || this.phase !== "play" || !s.alive) {
      s.soft = false;
      return false;
    }
    if (m === "softOn") {
      s.soft = true;
      return true;
    }
    const p = s.piece;
    if (!p) return false;
    switch (m) {
      case "left":
      case "right": {
        const dx = m === "left" ? -1 : 1;
        if (!fits(s.grid, p.kind, p.rot, p.x + dx, p.y)) return false;
        p.x += dx;
        this.moved(s);
        return true;
      }
      case "rotate": {
        const r = (p.rot + 1) & 3;
        for (const [dx, dy] of KICKS) {
          if (fits(s.grid, p.kind, r, p.x + dx, p.y + dy)) {
            p.rot = r;
            p.x += dx;
            p.y += dy;
            this.moved(s);
            return true;
          }
        }
        return false;
      }
      case "drop": {
        p.y = dropY(s.grid, p.kind, p.rot, p.x, p.y);
        s.soft = false;
        this.lock(s, true);
        return true;
      }
    }
    return false;
  }

  /** A move or turn that worked: a resting piece gets a little more time, a few times. */
  private moved(s: Seat) {
    s.ver++;
    const p = s.piece!;
    if (!fits(s.grid, p.kind, p.rot, p.x, p.y + 1) && s.resets < LOCK_RESETS) {
      s.lockT = 0;
      s.resets++;
    }
  }

  // ------------------------------------------------------------------ the step

  step() {
    this.t++;
    switch (this.phase) {
      case "wait":
        if (this.live().length) this.nextRound();
        break;
      case "count":
        if (this.t >= COUNT_STEPS) {
          this.setPhase("play");
          for (const s of this.alive()) this.spawn(s);
        }
        break;
      case "play":
        this.playSteps++;
        for (const s of this.alive()) this.tick(s);
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

  private tick(s: Seat) {
    if (!s.alive) return;
    if (!s.piece) {
      if (--s.wait <= 0) this.spawn(s);
      return;
    }
    const p = s.piece;
    const per = s.soft ? Math.min(SOFT_STEPS, this.gravity) : this.gravity;
    s.fall += 1 / per;
    while (s.fall >= 1) {
      s.fall -= 1;
      if (fits(s.grid, p.kind, p.rot, p.x, p.y + 1)) {
        p.y++;
        s.ver++;
        if (s.soft) s.score += 1;
      } else {
        s.fall = 0;
        break;
      }
    }
    if (!fits(s.grid, p.kind, p.rot, p.x, p.y + 1)) {
      if (++s.lockT >= LOCK_STEPS) this.lock(s, false);
    } else s.lockT = 0;
  }

  private spawn(s: Seat) {
    const kind = s.next;
    s.next = s.bag.take();
    const p = spawnOf(kind);
    s.pieceNo++;
    s.fall = 0;
    s.lockT = 0;
    s.resets = 0;
    s.ver++;
    if (!fits(s.grid, p.kind, p.rot, p.x, p.y)) {
      // blocked: show it overlapping, and the well is out
      s.piece = p;
      this.topOut(s);
      return;
    }
    s.piece = p;
    this.events.push({ type: "spawn", id: s.id });
  }

  private lock(s: Seat, drop: boolean) {
    const p = s.piece!;
    let above = true;
    for (const [cx, cy] of TURNS[p.kind][p.rot]!) {
      const gy = p.y + cy;
      if (gy >= HIDDEN) above = false;
      if (gy >= 0) s.grid[gy * COLS + p.x + cx] = KINDS.indexOf(p.kind) + 1;
    }
    s.piece = null;
    s.soft = s.soft && !drop;
    s.ver++;
    this.events.push({ type: "lock", id: s.id, drop });

    // full rows clear
    const rows: number[] = [];
    for (let y = 0; y < H; y++) if (rowFull(s.grid, y)) rows.push(y);
    if (rows.length) {
      this.events.push({ type: "clear", id: s.id, rows: rows.slice(), cells: rows.map((y) => Array.from(s.grid.subarray(y * COLS, y * COLS + COLS))) });
      removeRows(s, rows);
      s.lines += rows.length;
      s.score += POINTS[Math.min(3, rows.length)]! * (this.level + 1);
      // paper ages; cracked rows vanish (and send nothing)
      const cracked: number[] = [];
      for (let y = 0; y < H; y++) {
        if (s.paper[y]! > 0 && --s.paper[y]! === 0) cracked.push(y);
      }
      if (cracked.length) {
        this.events.push({ type: "crack", id: s.id, rows: cracked, cells: cracked.map((y) => Array.from(s.grid.subarray(y * COLS, y * COLS + COLS))) });
        removeRows(s, cracked);
      }
      let send: number = SEND[Math.min(3, rows.length)]!;
      // your own waiting paper is torn up first
      while (send > 0 && s.incoming.length) {
        const c = Math.min(send, s.incoming[0]!);
        send -= c;
        s.incoming[0]! -= c;
        if (!s.incoming[0]) s.incoming.shift();
      }
      if (send > 0 && !this.solo) {
        const to = this.targetOf(s);
        if (to) {
          to.incoming.push(send);
          to.ver++;
          s.sent += send;
          this.events.push({ type: "attack", from: s.id, to: to.id, n: send });
        }
      }
      s.wait = CLEAR_STEPS;
    } else {
      s.wait = SPAWN_STEPS;
      if (s.incoming.length && this.takePaper(s)) return;
      if (above) {
        this.topOut(s);
        return;
      }
    }
  }

  /** Waiting paper slides in under the stack. True if that pushed the well out. */
  private takePaper(s: Seat): boolean {
    let room = MAX_IN;
    let n = 0;
    while (room > 0 && s.incoming.length) {
      const k = Math.min(room, s.incoming[0]!);
      const hole = Math.floor(s.holes() * COLS);
      for (let i = 0; i < k; i++) {
        // everything moves up one row; a cell pushed off the top ends the well
        for (let x = 0; x < COLS; x++) if (s.grid[x]) return this.topOut(s, n + i);
        s.grid.copyWithin(0, COLS);
        s.paper.copyWithin(0, 1);
        const y = H - 1;
        for (let x = 0; x < COLS; x++) s.grid[y * COLS + x] = x === hole ? 0 : PAPER;
        s.paper[y] = PAPER_LIFE;
      }
      n += k;
      room -= k;
      s.incoming[0]! -= k;
      if (!s.incoming[0]) s.incoming.shift();
    }
    s.ver++;
    this.events.push({ type: "paper", id: s.id, n });
    return false;
  }

  /** The opponent with the lowest stack; ties go to the next seat after the sender. */
  targetOf(from: Seat): Seat | null {
    let best: Seat | null = null;
    let bestKey = Infinity;
    for (const s of this.alive()) {
      if (s === from) continue;
      const order = (s.slot - from.slot + MAX_SEATS) % MAX_SEATS;
      const key = stackHeight(s.grid) * 16 + order;
      if (key < bestKey) {
        bestKey = key;
        best = s;
      }
    }
    return best;
  }

  private topOut(s: Seat, paperIn = 0): true {
    if (paperIn) this.events.push({ type: "paper", id: s.id, n: paperIn });
    s.alive = false;
    s.soft = false;
    s.incoming = [];
    s.out = ++this.outCount;
    s.ver++;
    this.events.push({ type: "out", id: s.id });
    this.checkEnd();
    return true;
  }

  drainEvents(): StackEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/** Takes rows out of a well; everything above them drops down. */
function removeRows(s: Seat, rows: number[]) {
  const set = new Set(rows);
  let w = H - 1;
  for (let y = H - 1; y >= 0; y--) {
    if (set.has(y)) continue;
    if (w !== y) {
      s.grid.copyWithin(w * COLS, y * COLS, y * COLS + COLS);
      s.paper[w] = s.paper[y]!;
    }
    w--;
  }
  for (; w >= 0; w--) {
    s.grid.fill(0, w * COLS, w * COLS + COLS);
    s.paper[w] = 0;
  }
}
