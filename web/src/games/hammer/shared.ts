import type { WeaponKind } from "./weapons.ts";

export type Phase = "pick" | "fight" | "result" | "match";

/** ffa: everyone for themselves. teams: Red (P1, P3) against Blue (P2, P4). pve: all players against the CPU. */
export type Mode = "ffa" | "teams" | "pve";

/**
 * Phone input. Touchpad (k 0): running totals of finger movement in CSS px since the controller started, so no
 * movement is lost when updates merge or drop; the TV turns the change between totals into thrust.
 * Stick (k 1): the stick position, −1…1.
 * `s` identifies one controller session; a new value means "start counting again".
 */
export interface HammerInput {
  s: number;
  k: 0 | 1;
  x: number;
  y: number;
}

export interface HammerGame {
  toHost: { type: "weapon"; weapon: WeaponKind };
  input: HammerInput;
  toController: { type: "hit"; dmg: number } | { type: "hurt"; dmg: number } | { type: "ko" } | { type: "win" };
  shared: {
    phase: Phase;
    round: number;
    /** Whole seconds left in this phase (pick, result, match). */
    left: number;
    mode: Mode;
    /** Round or match winner's name ("Red team", "CPU"…) and, in free-for-all, player id; null for a draw. */
    winner: string | null;
    winnerId: string | null;
    /** The winning team number, or null for a draw. */
    winnerTeam: number | null;
    winnerColor: string | null;
    winsToMatch: number;
  };
  own: {
    color: string;
    /** Seat number shown as P1–P4, or −1 while waiting. */
    slot: number;
    /** Team number, and its name in team modes ("Red", "Blue", "Players"), or "" in free-for-all. */
    team: number;
    teamName: string;
    weapon: WeaponKind;
    hp: number;
    alive: boolean;
    wins: number;
    /** False while waiting for the next round (joined mid-fight, or more than 4 players). */
    seated: boolean;
  };
}
