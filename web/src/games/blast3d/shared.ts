/** Message shapes for Blast Party 3D. */
import type { Phase, PowerKind } from "./rules.ts";

export interface B3dShared {
  phase: Phase;
  round: number;
  /** Round wins that take the match. */
  target: number;
  /** Last round's winner and the match winner (names). */
  roundWinner: string | null;
  winner: string | null;
}

export interface B3dOwn {
  name: string;
  color: string;
  /** in: fighting; down: knocked out of the sky, back in a moment; out: no lives left; next: joined mid-round; watch: no free seat. */
  state: "in" | "down" | "out" | "next" | "watch";
  lives: number;
  /** Lives a fighter starts a round with. */
  maxLives: number;
  /** Hit points, in tenths (0–10). */
  hp: number;
  wins: number;
  /** Power-ups it holds now. */
  power: PowerKind[];
  /** It has something in its hands: every button throws. */
  holding: boolean;
}

export interface B3dGame {
  toHost: { type: "again" } | { type: "bomb" } | { type: "punch" } | { type: "jump" } | { type: "grab" };
  /** The stick, -1..1 each way (y down the phone = towards the camera). */
  input: { x: number; y: number };
  toController: { type: "go" } | { type: "out" } | { type: "hit" } | { type: "pick" };
  shared: B3dShared | null;
  own: B3dOwn;
}
