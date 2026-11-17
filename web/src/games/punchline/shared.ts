/** Message shapes for Punchline. Everything a phone shows comes from `shared` and `own` (sticky). */
import type { Phase } from "./rules.ts";

export interface PunchShared {
  phase: Phase;
  /** 0, 1, then 2 (the last laugh). */
  round: number;
  final: boolean;
  /** What is being voted on (vote phase only): the prompt and every answer, in the TV's order. No authors. */
  vote: { key: string; prompt: string; answers: string[] } | null;
  /** Names of the match winners (end only). */
  winners: string[];
}

export interface PunchTask {
  key: string;
  prompt: string;
  sent: boolean;
}

export interface PunchOwn {
  name: string;
  color: string;
  /** seated: playing. next: seated, answers from the next round (may vote now). watch: no free seat yet. */
  state: "seated" | "next" | "watch";
  /** This round's prompts for you, while writing. */
  tasks: PunchTask[];
  /** Your part in the vote on show. */
  vote: { key: string; author: boolean; options: number[]; mine: number | null } | null;
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
