// Punchline: the rules, with no drawing. Plain TypeScript, so Node can test and simulate it.
//
// A match is three rounds:
//   round 0  head-to-heads          each player answers two prompts; each prompt has exactly two authors
//   round 1  head-to-heads, again   points doubled
//   round 2  the last laugh         everyone answers the SAME prompt, then everyone votes for one answer (not their own)
//
// Each round goes intro → write → (vote → reveal) per prompt → scores. The last one goes intro → write → vote →
// reveal → end.
//
// The pairing (fair for any count from 3 to 8, odd or even):
//   The players of a round are put in a ring, a random cycle through all of them. There is one prompt per edge of
//   the ring: prompt k goes to ring[k] and ring[k + 1] (the last one wraps round to ring[0]). So with n players there
//   are n prompts, every player answers exactly two (the edge on each side of them), and every prompt has two
//   different authors. A ring of 3 or more never uses the same pair twice in a round.
//   Round 1 picks a ring that shares as few pairs as possible with round 0 (pairs are remembered by seat id). The
//   minimum is 3 shared pairs with 3 players (there is only one ring), 2 with 4 players (any two rings of four share
//   two edges), and 0 from 5 players up, which the search always finds. Tested in rules.test.ts.
//
// Scoring:
//   head-to-head  each answer gets round(1000 × its share of the votes) × the round's multiplier (1, then 2).
//                 Taking every vote, with at least 2 votes cast and two real answers, is a clean sweep: +250 × mult.
//                 No votes: nobody scores. A stand-in ("[no answer]") never scores.
//   last laugh    500 per vote. Every vote from everyone else (at least 2) on one answer: +750.
// The match winner has the most points; a tie shares the win.
//
// Who votes: everyone seated except the two authors (bots and newcomers waiting for the next round included). In the
// last laugh everyone votes, for any real answer but their own. A vote can change until the vote closes; it closes
// when every voter is in, or on the deadline.
// Writing ends when every author has sent every answer, or on the deadline; then missing answers become stand-ins.
// A pair with two stand-ins is skipped.
//
// The clock is in the rules: the host calls advance(ms), and pausing is just not calling it. Randomness comes from
// an injected source, so a seeded game replays exactly.

import { PROMPTS, type Prompt } from "./prompts.ts";

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

export function shuffle<T>(a: readonly T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [b[i], b[j]] = [b[j]!, b[i]!];
  }
  return b;
}

export const MAX_SEATS = 8;
export const MIN_SEATS = 3;
/** Longest answer, in characters (code points). */
export const MAX_LEN = 60;
export const STAND_IN = "[no answer]";
export const ROUNDS = 3;
export const FINAL_ROUND = 2;
export const TIMES = [60, 90, 120] as const;
/** Milliseconds for the fixed beats. */
export const BEATS = {
  intro: 3800,
  vote: 20000,
  /** Last-laugh vote: more answers to read. */
  finalVote: 30000,
  scores: 7000,
};
export const SWEEP = 250;
export const FINAL_VOTE = 500;
export const FINAL_SWEEP = 750;

/** How long a reveal stays up: the tally marks come in one by one, then the names. */
export const revealMs = (votes: number, final = false) => (final ? 5200 : 3800) + 320 * votes;

export type Phase = "wait" | "intro" | "write" | "vote" | "reveal" | "scores" | "end";

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  /** Played by the computer: a bot, or a player who left (a bot finishes their match). */
  bot: boolean;
  /** Left the room; removed at the next round. */
  left: boolean;
  /** Answering this round (newcomers wait for the next one, but may vote). */
  inRound: boolean;
  score: number;
  /** Points this round. */
  gained: number;
}

export interface Answer {
  text: string;
  /** A stand-in for an answer that never came. */
  missing: boolean;
}

export interface PairResult {
  votes: [number, number];
  points: [number, number];
  /** Which side swept, or -1. */
  sweep: number;
  /** Which side won, -1 for a tie or no votes. */
  winner: number;
}

export interface Pair {
  key: string;
  prompt: Prompt;
  authors: [string, string];
  answers: [Answer | null, Answer | null];
  /** voter id → side 0 / 1, in the order they came in. */
  votes: Map<string, 0 | 1>;
  result: PairResult | null;
}

export interface Entry {
  author: string;
  answer: Answer | null;
}

export interface FinalResult {
  votes: number[];
  points: number[];
  /** Entry index that swept, or -1. */
  sweep: number;
  /** Entry indices with the most votes (empty with no votes). */
  top: number[];
}

export interface Final {
  key: string;
  prompt: Prompt;
  entries: Entry[];
  votes: Map<string, number>;
  result: FinalResult | null;
}

export interface Options {
  /** Answer time, seconds. */
  time: number;
  /** Family-friendly prompts only. */
  family: boolean;
}

export type PunchEvent =
  | { type: "phase"; phase: Phase }
  | { type: "answer"; id: string; key: string }
  | { type: "vote"; id: string; key: string };

// ------------------------------------------------------------------ pure helpers (tested on their own)

/** Trims, collapses spaces, drops control and direction characters, and cuts to MAX_LEN code points. */
export function cleanAnswer(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .slice(0, 400)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(s).slice(0, MAX_LEN).join("").trim();
}

const pairId = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * A ring through all `ids`, as n pairs [ring[k], ring[k+1]], sharing as few pairs with `used` as it can find.
 * Needs at least 3 ids.
 */
export function pairUp(ids: readonly string[], used: ReadonlySet<string>, rng: Rng, tries = 400): [string, string][] {
  const n = ids.length;
  if (n < 3) throw new Error("pairUp needs 3 or more players");
  const ringPairs = (ring: string[]) => ring.map((id, k) => [id, ring[(k + 1) % n]!] as [string, string]);
  const cost = (ring: string[]) => ringPairs(ring).filter(([a, b]) => used.has(pairId(a, b))).length;
  let best = shuffle(ids, rng);
  let bestCost = cost(best);
  for (let t = 0; t < tries && bestCost > 0; t++) {
    const ring = shuffle(ids, rng);
    const c = cost(ring);
    if (c < bestCost) {
      best = ring;
      bestCost = c;
    }
  }
  return ringPairs(best);
}

/** Points for a head-to-head. `real` says which sides are real answers (not stand-ins). */
export function scorePair(votes: [number, number], mult: number, real: [boolean, boolean] = [true, true]): PairResult {
  const total = votes[0] + votes[1];
  const points: [number, number] = [0, 0];
  let sweep = -1;
  if (total > 0) {
    for (const i of [0, 1] as const) if (real[i]) points[i] = Math.round((1000 * votes[i]) / total) * mult;
    for (const i of [0, 1] as const) {
      if (votes[i] === total && total >= 2 && real[0] && real[1]) {
        sweep = i;
        points[i] += SWEEP * mult;
      }
    }
  }
  const winner = total === 0 || votes[0] === votes[1] ? -1 : votes[0] > votes[1] ? 0 : 1;
  return { votes, points, sweep, winner };
}

/**
 * Points for the last laugh. `authorVoted[i]` says whether entry i's author cast a vote (they cannot vote for
 * themselves), so a sweep is every vote from everyone else: at least 2.
 */
export function scoreFinal(votes: number[], authorVoted: boolean[] = []): FinalResult {
  const total = votes.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...votes);
  const points = votes.map((v) => v * FINAL_VOTE);
  let sweep = -1;
  votes.forEach((v, i) => {
    if (sweep < 0 && v >= 2 && v === total - (authorVoted[i] ? 1 : 0)) {
      sweep = i;
      points[i]! += FINAL_SWEEP;
    }
  });
  return { votes, points, sweep, top: max > 0 ? votes.flatMap((v, i) => (v === max ? [i] : [])) : [] };
}

// ------------------------------------------------------------------ the game

export class Punchline {
  opts: Options;
  readonly seats = new Map<string, Seat>();
  phase: Phase = "wait";
  /** 0, 1, then FINAL_ROUND. */
  round = 0;
  /** Milliseconds since the phase began, and how long it lasts. */
  t = 0;
  dur = 0;
  pairs: Pair[] = [];
  /** The pair on show (vote / reveal). */
  idx = 0;
  final: Final | null = null;
  /** Counts matches, so stale plans (bots, phones) can tell. */
  match = 0;
  private usedPairs = new Set<string>();
  private usedPrompts = new Set<number>();
  private events: PunchEvent[] = [];

  constructor(
    opts: Options,
    readonly rng: Rng = Math.random,
    readonly pool: readonly Prompt[] = PROMPTS,
  ) {
    this.opts = { ...opts };
  }

  configure(opts: Options) {
    this.opts = { ...opts };
  }

  drainEvents(): PunchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------- seats

  /** Every seat still in the room or played for someone who left, in colour order. */
  list(): Seat[] {
    return [...this.seats.values()].sort((a, b) => a.slot - b.slot);
  }

  freeSlot(want?: number): number {
    const taken = new Set([...this.seats.values()].map((s) => s.slot));
    if (want !== undefined && want >= 0 && want < MAX_SEATS && !taken.has(want)) return want;
    for (let i = 0; i < MAX_SEATS; i++) if (!taken.has(i)) return i;
    return -1;
  }

  /** Seats someone. They answer from the next round; they can vote at once. False when full. */
  addSeat(id: string, name: string, bot: boolean, slot?: number): boolean {
    if (this.seats.has(id)) return true;
    const s = this.freeSlot(slot);
    if (s < 0) return false;
    this.seats.set(id, { id, name, slot: s, bot, left: false, inRound: false, score: 0, gained: 0 });
    return true;
  }

  /**
   * Someone left. Between rounds (or before any) they go at once; mid-round a bot finishes for them (their answers
   * still play) and they go at the next round.
   */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    const midRound = this.phase === "write" || this.phase === "vote" || this.phase === "reveal";
    if (!s.inRound || !midRound) {
      this.seats.delete(id);
    } else {
      s.left = true;
      s.bot = true;
    }
    this.checkDone();
  }

  /** Out of the wait once there are enough seats. */
  ready(): boolean {
    if (this.phase !== "wait" || this.seats.size < MIN_SEATS) return false;
    this.go("intro");
    return true;
  }

  /** Drops the seats of players who left. */
  prune() {
    for (const s of [...this.seats.values()]) if (s.left) this.seats.delete(s.id);
  }

  // ---------------------------------------------------------------- flow

  startMatch() {
    this.match++;
    this.round = 0;
    this.usedPairs.clear();
    this.pairs = [];
    this.final = null;
    for (const s of this.seats.values()) {
      s.score = 0;
      s.gained = 0;
      s.inRound = false;
    }
    this.prune();
    this.go("intro");
  }

  private go(phase: Phase, dur = 0) {
    this.phase = phase;
    this.t = 0;
    this.dur = dur;
    if (phase === "intro") this.dur = BEATS.intro;
    if (phase === "scores") this.dur = BEATS.scores;
    this.events.push({ type: "phase", phase });
  }

  /** Moves the clock on. */
  advance(ms: number) {
    if (this.phase === "wait" || this.phase === "end") return;
    this.t += ms;
    if (this.t < this.dur) return;
    switch (this.phase) {
      case "intro":
        return this.beginWrite();
      case "write":
        return this.endWrite();
      case "vote":
        return this.closeVote();
      case "reveal":
        return this.next();
      case "scores":
        this.round++;
        return this.go("intro");
    }
  }

  /** The seats answering this round (decided at the start of writing). */
  players(): Seat[] {
    return this.list().filter((s) => s.inRound);
  }

  private draw(count: number): Prompt[] {
    let pool = this.pool.filter((p) => !this.opts.family || p.fam);
    if (!pool.length) pool = [...this.pool];
    let fresh = pool.filter((p) => !this.usedPrompts.has(p.id));
    if (fresh.length < count) {
      this.usedPrompts.clear();
      fresh = pool;
    }
    const out = shuffle(fresh, this.rng).slice(0, count);
    for (const p of out) this.usedPrompts.add(p.id);
    return out;
  }

  private beginWrite() {
    this.prune();
    const seats = this.list();
    if (seats.length < MIN_SEATS) {
      this.go("wait");
      return;
    }
    for (const s of seats) {
      s.inRound = true;
      s.gained = 0;
    }
    const ids = seats.map((s) => s.id);
    if (this.round === FINAL_ROUND) {
      const [prompt] = this.draw(1);
      this.final = {
        key: `${this.match}:${this.round}:f`,
        prompt: prompt!,
        entries: shuffle(ids, this.rng).map((author) => ({ author, answer: null })),
        votes: new Map(),
        result: null,
      };
      this.pairs = [];
    } else {
      const ring = pairUp(ids, this.usedPairs, this.rng);
      const prompts = this.draw(ring.length);
      this.pairs = ring.map((authors, k) => ({
        key: `${this.match}:${this.round}:${k}`,
        prompt: prompts[k]!,
        // which author's card is on the left is random
        authors: this.rng() < 0.5 ? authors : [authors[1], authors[0]],
        answers: [null, null],
        votes: new Map(),
        result: null,
      }));
      for (const [a, b] of ring) this.usedPairs.add(pairId(a, b));
      this.final = null;
    }
    this.idx = 0;
    this.go("write", this.opts.time * 1000);
  }

  /** What one player has to answer this round, in order: [key, prompt, their answer or null]. */
  tasks(id: string): { key: string; prompt: Prompt; answer: Answer | null }[] {
    if (this.round === FINAL_ROUND) {
      const e = this.final?.entries.find((x) => x.author === id);
      return e && this.final ? [{ key: this.final.key, prompt: this.final.prompt, answer: e.answer }] : [];
    }
    return this.pairs.flatMap((p) => {
      const side = p.authors.indexOf(id);
      return side < 0 ? [] : [{ key: p.key, prompt: p.prompt, answer: p.answers[side]! }];
    });
  }

  /** Whether a seat has sent everything it has to this round. */
  doneWriting(id: string): boolean {
    return this.tasks(id).every((t) => t.answer !== null);
  }

  /** A player sends an answer. Returns false if it does not count (wrong phase, stale key, empty, already sent). */
  answer(id: string, key: string, raw: unknown): boolean {
    if (this.phase !== "write") return false;
    const text = cleanAnswer(raw);
    if (!text) return false;
    if (this.final && this.final.key === key) {
      const e = this.final.entries.find((x) => x.author === id);
      if (!e || e.answer) return false;
      e.answer = { text, missing: false };
    } else {
      const p = this.pairs.find((x) => x.key === key);
      const side = p ? p.authors.indexOf(id) : -1;
      if (!p || side < 0 || p.answers[side]) return false;
      p.answers[side] = { text, missing: false };
    }
    this.events.push({ type: "answer", id, key });
    this.checkDone();
    return true;
  }

  private checkDone() {
    if (this.phase === "write" && this.players().every((s) => this.doneWriting(s.id))) this.endWrite();
    else if (this.phase === "vote" && this.allVoted()) this.closeVote();
  }

  private endWrite() {
    const stand = (): Answer => ({ text: STAND_IN, missing: true });
    if (this.final) for (const e of this.final.entries) e.answer ??= stand();
    for (const p of this.pairs) {
      p.answers[0] ??= stand();
      p.answers[1] ??= stand();
    }
    this.idx = -1;
    this.next();
  }

  /** The next pair to vote on, or the scores / end. */
  private next() {
    if (this.round === FINAL_ROUND) {
      if (this.phase === "write" && this.final) return this.go("vote", BEATS.finalVote);
      return this.go("end");
    }
    for (this.idx++; this.idx < this.pairs.length; this.idx++) {
      const p = this.pairs[this.idx]!;
      if (!(p.answers[0]!.missing && p.answers[1]!.missing)) return this.go("vote", BEATS.vote);
    }
    this.go("scores");
  }

  /** The pair on show, if any. */
  current(): Pair | null {
    return (this.phase === "vote" || this.phase === "reveal") && this.round !== FINAL_ROUND ? (this.pairs[this.idx] ?? null) : null;
  }

  /** The key of what is being voted on right now. */
  voteKey(): string | null {
    if (this.phase !== "vote") return null;
    return this.final?.key ?? this.current()?.key ?? null;
  }

  /** Last laugh: the entries a seat may vote for (real answers that are not their own). */
  options(id: string): number[] {
    if (!this.final) return [];
    return this.final.entries.flatMap((e, i) => (e.author !== id && e.answer && !e.answer.missing ? [i] : []));
  }

  /** Whether a seat votes on what is on show. */
  canVote(id: string): boolean {
    if (this.phase !== "vote" || !this.seats.has(id)) return false;
    if (this.final) return this.options(id).length > 0;
    const p = this.current();
    return !!p && !p.authors.includes(id);
  }

  voters(): Seat[] {
    return this.list().filter((s) => this.canVote(s.id));
  }

  hasVoted(id: string): boolean {
    if (this.final) return this.final.votes.has(id);
    return !!this.current()?.votes.has(id);
  }

  allVoted(): boolean {
    return this.voters().every((s) => this.hasVoted(s.id));
  }

  /** A vote: a side (0 / 1) of the pair, or an entry index in the last laugh. It can change until the vote closes. */
  vote(id: string, key: string, pick: unknown): boolean {
    if (this.phase !== "vote" || key !== this.voteKey() || !this.canVote(id)) return false;
    const n = Number(pick);
    if (!Number.isInteger(n)) return false;
    if (this.final) {
      if (!this.options(id).includes(n)) return false;
      this.final.votes.delete(id); // a changed vote goes to the back of the line
      this.final.votes.set(id, n);
    } else {
      if (n !== 0 && n !== 1) return false;
      const p = this.current()!;
      p.votes.delete(id);
      p.votes.set(id, n);
    }
    this.events.push({ type: "vote", id, key });
    this.checkDone();
    return true;
  }

  private closeVote() {
    if (this.phase !== "vote") return;
    if (this.final) {
      const f = this.final;
      // votes for someone who has left still count; votes from seats that are gone do too
      const counts = f.entries.map(() => 0);
      for (const v of f.votes.values()) counts[v]!++;
      f.result = scoreFinal(counts, f.entries.map((e) => f.votes.has(e.author)));
      f.entries.forEach((e, i) => this.award(e.author, f.result!.points[i]!));
      return this.go("reveal", revealMs(f.votes.size, true));
    }
    const p = this.current()!;
    const counts: [number, number] = [0, 0];
    for (const v of p.votes.values()) counts[v]++;
    const mult = this.round + 1;
    p.result = scorePair(counts, mult, [!p.answers[0]!.missing, !p.answers[1]!.missing]);
    p.authors.forEach((a, i) => this.award(a, p.result!.points[i]!));
    this.go("reveal", revealMs(p.votes.size));
  }

  private award(id: string, pts: number) {
    const s = this.seats.get(id);
    if (!s) return;
    s.score += pts;
    s.gained += pts;
  }

  /** Seats with the top score (on the end screen). */
  winners(): Seat[] {
    const seats = this.list();
    const max = Math.max(...seats.map((s) => s.score));
    return seats.filter((s) => s.score === max);
  }

  /** Seats by score, best first (ties by colour order). */
  standings(): Seat[] {
    return this.list().sort((a, b) => b.score - a.score || a.slot - b.slot);
  }

  /** Milliseconds left in the phase. */
  left(): number {
    return Math.max(0, this.dur - this.t);
  }
}
