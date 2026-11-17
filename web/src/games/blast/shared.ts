/** Message shapes for Blast Party. */
import type { PowerKind } from "./rules.ts";

export type BlastPhase = "wait" | "count" | "play" | "round" | "match";

export interface BlastShared {
  phase: BlastPhase;
  round: number;
  /** Round wins that take the match. */
  target: number;
  mode: "ffa" | "team";
  /** Last round's winner (a name, or a team's name in a team match), and the match winner. */
  roundWinner: string | null;
  winner: string | null;
  /** The winning team of the last round and of the match (team matches). */
  roundTeam: number | null;
  winTeam: number | null;
}

export interface BlastOwn {
  name: string;
  color: string;
  /** in: on the platform this round; out: knocked off, waits; next: joined mid-round; watch: no free seat. */
  state: "in" | "out" | "next" | "watch";
  wins: number;
  /** 0 or 1 in a team match, -1 otherwise. */
  team: number;
  /** Power-ups it holds now. */
  power: PowerKind[];
}

export interface BlastGame {
  toHost: { type: "again" } | { type: "bomb" } | { type: "punch" } | { type: "jump" };
  /** The stick, -1..1 each way (y down). */
  input: { x: number; y: number };
  toController: { type: "go" } | { type: "out" } | { type: "hit" } | { type: "pick" };
  shared: BlastShared | null;
  own: BlastOwn;
}
