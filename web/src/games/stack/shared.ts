/** Message shapes for Stack Attack. */
import type { Kind, Move, Phase } from "./rules.ts";

export interface StackShared {
  phase: Phase;
  round: number;
  /** Round wins that take the match. */
  target: number;
  solo: boolean;
  /** Names of the match winners (on the match screen). */
  winners: string[];
}

export interface StackOwn {
  name: string;
  color: string;
  /** in: playing this round; out: topped out, waits; next: joined mid-round; watch: no free seat. */
  state: "in" | "out" | "next" | "watch";
  /** The next piece, while playing. */
  next: Kind | null;
  wins: number;
}

export interface StackGame {
  toHost: { type: "move"; m: Move } | { type: "again" };
  input: Record<string, never>;
  toController: { type: "lock" } | { type: "clear"; n: number } | { type: "hit" } | { type: "out" } | { type: "go" };
  shared: StackShared | null;
  own: StackOwn;
}
