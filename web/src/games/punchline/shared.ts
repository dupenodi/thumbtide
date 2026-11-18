/** Message shapes for Punchline. Everything a phone shows comes from `shared` and `own` (sticky). */
import type { Phase } from "./rules.ts";

export interface PunchShared {
  phase: Phase;
  /** 0-based round, and the rounds in the match. */
  round: number;
  rounds: number;
  /** Names the round and the match: changes every round, so a phone can tell a new round from the old one. */
  key: string;
  /** The round's one prompt (write, vote, reveal). */
  prompt: string;
  /** The answers to vote on, in the TV's order. No authors. */
  answers: string[];
  /** Names of the match winners (end only). */
  winners: string[];
}

export interface PunchOwn {
  name: string;
  color: string;
  /** seated: playing. next: seated, answers from the next round (may vote now). watch: no free seat yet. */
  state: "seated" | "next" | "watch";
  /** Your answer slot while writing: what you have sent (null if nothing yet). Null when you are not writing. */
  task: { key: string; text: string | null } | null;
  /** Your part in the vote on show: the answer indices you may pick, and your pick. */
  vote: { key: string; options: number[]; mine: number | null } | null;
  /** Your points this round and in all (reveal / scores / end). */
  gained: number;
  score: number;
  /** Your place at the end (1 = first). */
  place: number | null;
}

export interface PunchGame {
  toHost: { type: "answer"; key: string; text: string } | { type: "vote"; key: string; pick: number } | { type: "again" };
  input: Record<string, never>;
  toController: { type: "buzz"; kind: "write" | "vote" | "win" };
  shared: PunchShared | null;
  own: PunchOwn;
}
