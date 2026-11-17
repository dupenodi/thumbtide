// Boomtown's messages. Everything on the table is public (cash, plots, storeys), so it is all shared; what only you
// need (the storeys you can build, the plots you may offer) goes through setOwn so the phone does not redo the rules.
import type { Phase } from "./rules.ts";

export type { Phase };

/** Pawn colours, by seat. Shape follows the seat too, so two pawns never look alike. */
export const PLAYER_COLORS = ["#2f5fd0", "#1e2a2f", "#f28c1f", "#e0457b", "#7bbf2a", "#8a4fd6"];
export const PAWN_SHAPES = ["circle", "square", "triangle", "diamond", "hexagon", "star"] as const;

export interface PlayerView {
  id: string;
  name: string;
  bot: boolean;
  away: boolean;
  color: number;
  cash: number;
  pos: number;
  out: boolean;
  /** Cash + plots + storeys. */
  worth: number;
  /** Turns still to sit out. */
  skip: number;
}

export interface BoomShared {
  phase: Phase;
  turn: number;
  round: number;
  players: PlayerView[];
  /** Owner seat per space, -1 none. */
  owner: number[];
  storeys: number[];
  dice: [number, number];
  /** ms left on this phase's clock when this was sent (0 = none), and what it started at. */
  left: number;
  leftMax: number;
  /** ms left of the match (0 = the last lap). */
  clock: number;
  final: boolean;
  buying: number;
  offer: { from: number; to: number; plot: number; price: number } | null;
  card: { id: string; title: string; text: string } | null;
  /** The last few things that happened, newest last. */
  notes: string[];
  /** The last few lines across turns, newest last. */
  log: string[];
  winner: number;
  why: "last" | "time" | null;
  watching: string[];
}

export interface BoomOwn {
  seat: number;
  buildable: Array<{ plot: number; cost: number }>;
  tradable: number[];
  /** Offers still allowed this turn. */
  canOffer: boolean;
}

export type BoomToHost =
  | { type: "roll" }
  | { type: "buy" }
  | { type: "pass" }
  | { type: "build"; plot: number }
  | { type: "offer"; plot: number; to: number; price: number }
  | { type: "respond"; accept: boolean }
  | { type: "end" }
  | { type: "again" };

export interface BoomGame {
  toHost: BoomToHost;
  toController: { type: "buzz"; kind: string } | { type: "refused"; text: string };
  input: Record<string, never>;
  shared: BoomShared | null;
  own: BoomOwn;
}
