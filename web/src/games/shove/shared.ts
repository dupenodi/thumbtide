/** Message shapes for Shove. */
export type ShovePhase = "wait" | "count" | "play" | "round" | "match";

export interface ShoveShared {
  phase: ShovePhase;
  round: number;
  /** Round wins that take the match. */
  target: number;
  /** Name of the last round's winner (on the round screen), and of the match winner. */
  roundWinner: string | null;
  winner: string | null;
}

export interface ShoveOwn {
  name: string;
  color: string;
  /** in: on the sand this round; out: pushed out, waits; next: joined mid-round; watch: no free seat. */
  state: "in" | "out" | "next" | "watch";
  wins: number;
}

export interface ShoveGame {
  toHost: { type: "again" } | { type: "dash" };
  /** The stick, -1..1 each way (y down). */
  input: { x: number; y: number };
  toController: { type: "go" } | { type: "out" } | { type: "hit" };
  shared: ShoveShared | null;
  own: ShoveOwn;
}
