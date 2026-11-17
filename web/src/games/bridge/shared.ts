/** Message shapes for Bridge Panic. Everything a phone shows comes from `shared` and `own` (sticky). */
import type { EventKind, Kind, Phase } from "./rules.ts";

export interface BridgeShared {
  phase: Phase;
  sector: number;
  quota: number;
  done: number;
  hull: number;
  /** The twist now on: "lights" dims the phones; "swap" just happened. */
  event: EventKind | null;
  /** Crew best (sectors reached this session) and what this voyage reached (end only). */
  best: number;
  reached: number;
  total: number;
}

export interface BridgeControl {
  name: string;
  kind: Kind;
  state: number;
  /** Lever only: the names of position 0 and 1. */
  opts?: [string, string];
}

export interface BridgeOrderView {
  id: number;
  text: string;
  /** Whole order time and what is left when this was sent (ms). The phone animates the bar from here. */
  ttl: number;
  left: number;
}

export interface BridgeOwn {
  name: string;
  color: string;
  /** seated: playing. watch: the crew is full. */
  state: "seated" | "watch";
  /** Which dealing of panels this is (changes every sector), and the panel. */
  deal: number;
  panel: BridgeControl[];
  order: BridgeOrderView | null;
  /** Orders you finished this voyage (end screen). */
  done: number;
}

export type BuzzKind = "done" | "miss" | "wrong" | "swap" | "sector" | "over";

export interface BridgeGame {
  toHost: { type: "act"; ctl: string; value: number } | { type: "again" };
  input: Record<string, never>;
  toController: { type: "buzz"; kind: BuzzKind };
  shared: BridgeShared | null;
  own: BridgeOwn;
}
