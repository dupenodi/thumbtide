// Punchline: the rules, with no drawing. Plain TypeScript, so Node can test and simulate it.
//
// A match is 5, 8 or 10 rounds. Every round has ONE prompt, the same for everybody:
//   intro   a short title card ("Round 3 of 8")
//   write   the prompt is on the TV and on every phone; everyone types an answer at the same time. An answer can be
//           changed until writing ends. Writing ends on the deadline, or a few seconds after the last answer is in.
//   vote    the TV shows every real answer, anonymous and shuffled; each voter picks a favourite, never their own.
//           The vote closes when every voter is in, or on the deadline. A vote can change until it closes.
//   reveal  the votes as tallies, the authors, the points
//   scores  the standings (not after the last round)
// After the last reveal the match ends: standings and winner.
//
// Scoring: 100 per vote. An answer that takes every vote cast (at least 2 votes) is a clean sweep: +200.
// An answer that never came (a stand-in) is not shown and never scores. With fewer than 2 real answers there is
// nothing to vote on and the round is skipped. The match winner has the most points; a tie shares the win.
//
// Who votes: every seat still in the room that has an answer to vote for other than its own (newcomers waiting for
// the next round included). A player who leaves keeps their answer in the vote, but does not vote.
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
export const MAX_LEN = 80;
export const ROUND_CHOICES = [5, 8, 10] as const;
export const TIMES = [45, 60, 90] as const;
/** Milliseconds for the fixed beats. */
export const BEATS = {
  intro: 2800,
  vote: 30000,
  scores: 6000,
  /** Once everyone has answered, writing ends after this long (a last chance to edit). */
  grace: 4000,
};
export const VOTE_POINTS = 100;
export const SWEEP = 200;

/** How long a reveal stays up: the tally marks come in one by one, then the names. */
export const revealMs = (votes: number) => 5200 + 320 * votes;

export type Phase = "wait" | "intro" | "write" | "vote" | "reveal" | "scores" | "end";

export interface Seat {
  id: string;
  name: string;
  /** Colour slot 0–7. */
  slot: number;
  bot: boolean;
  /** Left the room; removed at the next round. Their answer stays in the vote. */
  left: boolean;
  /** Answering this round (newcomers wait for the next one, but may vote). */
  inRound: boolean;
  score: number;
  /** Points this round. */
  gained: number;
}

export interface Entry {
  author: string;
  /** The answer, or null when it never came. */
  text: string | null;
}

export interface RoundResult {
  /** Votes per entry (same order as `Punchline.shown`). */
  votes: number[];
  points: number[];
  /** Index (into shown) that swept, or -1. */
  sweep: number;
  /** Indices with the most votes (empty with no votes). */
  top: number[];
}

export interface Options {
  /** Rounds in a match. */
  rounds: number;
  /** Answer time, seconds. */
  time: number;
  /** Family-friendly prompts only. */
  family: boolean;
}

export type PunchEvent =
  | { type: "phase"; phase: Phase }
  | { type: "answer"; id: string }
  | { type: "vote"; id: string };

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

/** Points for a round. `votes[i]` is the vote count of shown answer i. */
export function scoreRound(votes: number[]): RoundResult {
  const total = votes.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...votes);
  const points = votes.map((v) => v * VOTE_POINTS);
  let sweep = -1;
  votes.forEach((v, i) => {
    if (sweep < 0 && total >= 2 && v === total) {
      sweep = i;
      points[i]! += SWEEP;
    }
  });
  return { votes, points, sweep, top: max > 0 ? votes.flatMap((v, i) => (v === max ? [i] : [])) : [] };
}

// ------------------------------------------------------------------ the game

export class Punchline {
  opts: Options;
  readonly seats = new Map<string, Seat>();
  phase: Phase = "wait";
  /** 0-based number of the round in play. */
  round = 0;
  /** Milliseconds since the phase began, and how long it lasts. */
  t = 0;
  dur = 0;
  prompt: Prompt | null = null;
  /** One entry per answering seat, in seat order. */
  entries: Entry[] = [];
  /** Indices into `entries` of the real answers, in the (shuffled) order they are shown. */
  shown: number[] = [];
  /** voter id → index into `shown`, in the order the votes came in. */
  votes = new Map<string, number>();
  result: RoundResult | null = null;
  /** Counts matches, so stale plans (bots, phones) can tell. */
  match = 0;
  private graceSet = false;
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

  /** Key of what is on show: changes every round and every match, so stale phone messages are ignored. */
  key(): string {
    return `${this.match}:${this.round}`;
  }

  // ---------------------------------------------------------------- seats

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
   * Someone left. Between rounds (or before any) they go at once. Mid-round they stay as a seat that no longer
   * plays: their answer (if any) stays in the vote, and they go at the next round.
   */
  removeSeat(id: string) {
    const s = this.seats.get(id);
    if (!s) return;
    const midRound = this.phase === "write" || this.phase === "vote" || this.phase === "reveal";
    if (!s.inRound || !midRound) this.seats.delete(id);
    else {
      s.left = true;
      s.bot = false;
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
    this.prompt = null;
    this.entries = [];
    this.shown = [];
    this.votes.clear();
    this.result = null;
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
        return this.afterReveal();
      case "scores":
        this.round++;
        return this.go("intro");
    }
  }

  /** The seats answering this round (decided at the start of writing). */
  players(): Seat[] {
    return this.list().filter((s) => s.inRound);
  }

  private draw(): Prompt {
    let pool = this.pool.filter((p) => !this.opts.family || p.fam);
    if (!pool.length) pool = [...this.pool];
    let fresh = pool.filter((p) => !this.usedPrompts.has(p.id));
    if (!fresh.length) {
      this.usedPrompts.clear();
      fresh = pool;
    }
    const p = fresh[Math.floor(this.rng() * fresh.length)]!;
    this.usedPrompts.add(p.id);
    return p;
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
    this.prompt = this.draw();
    this.entries = seats.map((s) => ({ author: s.id, text: null }));
    this.shown = [];
    this.votes.clear();
    this.result = null;
    this.graceSet = false;
    this.go("write", this.opts.time * 1000);
  }

  private entryOf(id: string): Entry | undefined {
    return this.entries.find((e) => e.author === id);
  }

  /** What one player has to answer (null when they are not in this round, or it is not the writing phase). */
  task(id: string): { key: string; prompt: Prompt; text: string | null } | null {
    if (this.phase !== "write" || !this.prompt) return null;
    const e = this.entryOf(id);
    return e && this.seats.get(id)?.inRound ? { key: this.key(), prompt: this.prompt, text: e.text } : null;
  }

  /** Whether a seat has sent its answer (a seat that left counts as done). */
  doneWriting(id: string): boolean {
    const e = this.entryOf(id);
    return !e || e.text !== null || !!this.seats.get(id)?.left;
  }

  /**
   * A player sends an answer, or changes the one they sent (until writing ends). Returns false if it does not
   * count (wrong phase, stale key, empty, not in this round).
   */
  answer(id: string, key: string, raw: unknown): boolean {
    if (this.phase !== "write" || key !== this.key()) return false;
    const s = this.seats.get(id);
    const e = this.entryOf(id);
    if (!s || !e || !s.inRound || s.left) return false;
    const text = cleanAnswer(raw);
    if (!text) return false;
    e.text = text;
    this.events.push({ type: "answer", id });
    this.checkDone();
    return true;
  }

  private checkDone() {
    if (this.phase === "write") {
      // everyone is in: a few seconds of grace to change an answer, then on to the vote
      if (!this.graceSet && this.players().every((s) => this.doneWriting(s.id))) {
        this.graceSet = true;
        const left = this.dur - this.t;
        if (left > BEATS.grace) this.dur = this.t + BEATS.grace;
      }
    } else if (this.phase === "vote" && this.allVoted()) this.closeVote();
  }

  private endWrite() {
    this.shown = shuffle(
      this.entries.flatMap((e, i) => (e.text ? [i] : [])),
      this.rng,
    );
    this.votes.clear();
    if (this.shown.length < 2) {
      this.result = scoreRound(this.shown.map(() => 0));
      return this.afterReveal();
    }
    this.go("vote", BEATS.vote);
  }

  /** The shown answers a seat may vote for (not their own). */
  options(id: string): number[] {
    return this.shown.flatMap((ei, k) => (this.entries[ei]!.author !== id ? [k] : []));
  }

  /** Whether a seat votes now. */
  canVote(id: string): boolean {
    const s = this.seats.get(id);
    return this.phase === "vote" && !!s && !s.left && this.options(id).length > 0;
  }

  voters(): Seat[] {
    return this.list().filter((s) => this.canVote(s.id));
  }

  hasVoted(id: string): boolean {
    return this.votes.has(id);
  }

  allVoted(): boolean {
    return this.voters().every((s) => this.hasVoted(s.id));
  }

  /** A vote for shown answer `pick`. It can change until the vote closes. */
  vote(id: string, key: string, pick: unknown): boolean {
    if (this.phase !== "vote" || key !== this.key() || !this.canVote(id)) return false;
    const n = Number(pick);
    if (!Number.isInteger(n) || !this.options(id).includes(n)) return false;
    this.votes.delete(id); // a changed vote goes to the back of the line
    this.votes.set(id, n);
    this.events.push({ type: "vote", id });
    this.checkDone();
    return true;
  }

  private closeVote() {
    if (this.phase !== "vote") return;
    // votes from seats that left in the meantime still count
    const counts = this.shown.map(() => 0);
    for (const v of this.votes.values()) counts[v]!++;
    this.result = scoreRound(counts);
    this.shown.forEach((ei, k) => this.award(this.entries[ei]!.author, this.result!.points[k]!));
    this.go("reveal", revealMs(this.votes.size));
  }

  private award(id: string, pts: number) {
    const s = this.seats.get(id);
    if (!s) return;
    s.score += pts;
    s.gained += pts;
  }

  private afterReveal() {
    this.go(this.round + 1 >= this.opts.rounds ? "end" : "scores");
  }

  /** The author of shown answer k. */
  authorOf(k: number): string {
    return this.entries[this.shown[k]!]!.author;
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
