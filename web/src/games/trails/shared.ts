/** Message shapes for Trails. */
export type TrailsPhase = "wait" | "count" | "play" | "round" | "match";

export interface TrailsShared {
  phase: TrailsPhase;
  round: number;
  /** Names of the match winners (on the match screen). */
  winners: string[];
}

export interface TrailsOwn {
  name: string;
  color: string;
  /** in: racing this round; out: crashed, waits; next: joined mid-round; watch: no free seat. */
  state: "in" | "out" | "next" | "watch";
}

export interface TrailsGame {
  toHost: { type: "again" };
  /** Held buttons: 1 = held. */
  input: { l: number; r: number };
  toController: { type: "crash" } | { type: "go" };
  shared: TrailsShared | null;
  own: TrailsOwn;
}
