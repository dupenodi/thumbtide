// Spyline's messages. The board and everything public is shared; the key (who owns which card) goes only to the
// two handlers, through setOwn, until the round is over.
import type { Owner, Phase, Role, Team, TurnEnd } from "./rules.ts";

export type { Owner, Phase, Role, Team, TurnEnd };

export const TEAM_NAME: Record<Team, string> = { cobalt: "Cobalt", saffron: "Saffron" };
export const TEAM_COLOR: Record<Team, string> = { cobalt: "#2b59c3", saffron: "#f2a516" };

export interface SeatView {
  id: string;
  name: string;
  team: Team;
  role: Role;
  bot: boolean;
  /** Their phone dropped; they may come back. */
  away: boolean;
}

export interface CardView {
  word: string;
  /** Known once revealed, and for every card at the round result. */
  owner: Owner | null;
  revealed: boolean;
  /** Seats (indexes into `seats`) proposing this card right now. */
  picks: number[];
}

export interface SpyShared {
  phase: Phase;
  round: number;
  rounds: number;
  /** Round wins that take the match. */
  target: number;
  wins: Record<Team, number>;
  turn: Team;
  seats: SeatView[];
  cards: CardView[];
  clue: { word: string; n: number; team: Team } | null;
  /** Every clue of this round, oldest first. */
  history: { word: string; n: number; team: Team }[];
  guesses: number;
  maxGuesses: number;
  /** Seats proposing to stop. */
  stop: number[];
  /** Picks a card needs. */
  need: number;
  /** ms left on the clock when this was sent (0 = no clock). */
  left: number;
  cardsLeft: Record<Team, number>;
  last: { idx: number; owner: Owner; team: Team } | null;
  /** How the last turn ended (for the strip). */
  ended: { team: Team; why: TurnEnd } | null;
  winner: Team | null;
  why: "cards" | "burn" | null;
  matchWinner: Team | null;
  /** People with no seat (all twelve are taken). */
  watching: string[];
}

export interface SpyOwn {
  team: Team | null;
  role: Role | "watch";
  /** Handlers only: the owner of every card. */
  key: Owner[] | null;
  /** What's wrong with the clue you just sent (null when fine), and a count so the same message twice still shows. */
  error: string | null;
  errorNo: number;
}

export type SpyToHost = { type: "clue"; word: string; n: number } | { type: "pick"; i: number | null } | { type: "again" };

export interface SpyGame {
  toHost: SpyToHost;
  toController: { type: "buzz"; kind: string };
  input: Record<string, never>;
  shared: SpyShared | null;
  own: SpyOwn;
}
