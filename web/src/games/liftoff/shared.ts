/** Message shapes for Lift-off. */
export type LiftoffPhase = "wait" | "count" | "fly" | "result" | "match";

export interface LiftoffShared {
  phase: LiftoffPhase;
  run: number;
  runs: number;
  /** Height of the rocket now, whole metres (sent at most a few times a second). */
  height: number;
  /** The best height of this match. */
  best: number;
}

export interface LiftoffOwn {
  name: string;
  color: string;
  /** fly: holds a thruster this run; next: joins at the next run; watch: the rocket is full. */
  state: "fly" | "next" | "watch";
  /** "two": a lone pilot with the left and right thrusters (two buttons); "one": a single Thrust button. */
  mode: "one" | "two";
  /** Thruster positions across the base, -1 (left) to 1 (right), and which of them are this player's. */
  spots: number[];
  mine: number[];
}

export interface LiftoffGame {
  toHost: { type: "again" };
  /** Held buttons: 1 = held. A single Thrust button sends both. */
  input: { l: number; r: number };
  toController: { type: "go" } | { type: "crash" };
  shared: LiftoffShared | null;
  own: LiftoffOwn;
}
