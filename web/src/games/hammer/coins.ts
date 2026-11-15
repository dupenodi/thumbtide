// Coins that burst out of a machine on a hard hit, after Hammerfight (exe 0x410b41, spill 0x4b9a50, factory 0x495a20):
// a hit with more than 5 damage spills coins (at most 30), 200 px/s up within ±36°, speed ±50 %.
// They fall at the game's gravity (100 px/s²) and are picked up by touching a machine (not in the first 0.3 s,
// not while stunned). Hammerfight: gold 20 / 10, silver 4 / 2, copper 1, coins worth damage / 2.
//
// OURS: coins are draw-only particles, not physics bodies (the TV's body budget); one coin per 2 damage; they
// bounce off the frame sides (CoR 0.3), fall out of the bottom (no floor) and blink out after 8 s; no score.

import type { Machine } from "./sim.ts";

export type Metal = 0 | 1 | 2; // gold, silver, copper

export interface Coin {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since the spill. */
  age: number;
  metal: Metal;
  big: boolean;
  /** Spin phase (the coin turns, so it draws as a flipping ellipse). */
  spin: number;
  spinRate: number;
}

const DENOMS: readonly { metal: Metal; big: boolean; value: number }[] = [
  { metal: 0, big: true, value: 20 },
  { metal: 0, big: false, value: 10 },
  { metal: 1, big: true, value: 4 },
  { metal: 1, big: false, value: 2 },
  { metal: 2, big: true, value: 1 },
];

export const COIN_GRAVITY = 100;
const COR = 0.3;
const PICKUP_AFTER = 0.3;
const LIFE = 8;
const HULL_R = 16.5;

export interface Pickup {
  x: number;
  y: number;
  metal: Metal;
  value: number;
  by: Machine;
}

export class Coins {
  list: Coin[] = [];
  constructor(
    readonly w: number,
    readonly h: number,
    /** At most this many coins at once (the oldest go first). */
    readonly max = 90,
    /** At most this many coins per spill (Hammerfight: 30). */
    readonly perSpill = 30,
  ) {}

  /** A hit for `dmg` at (x, y): coins burst out. Returns how many came out. */
  spill(x: number, y: number, dmg: number): number {
    if (dmg <= 5) return 0;
    // OURS: one coin per 2 damage (Hammerfight: coins WORTH dmg / 2, often a single gold piece), so a hard hit
    // reads as a shower; harder hits throw more gold.
    const n = Math.min(this.perSpill, Math.max(3, Math.round(dmg / 2)));
    const gold = Math.min(0.6, dmg / 80);
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const metal: Metal = r < gold ? 0 : r < gold + 0.35 ? 1 : 2;
      const a = -Math.PI / 2 + (Math.random() * 2 - 1) * (36 * Math.PI) / 180;
      const sp = 200 * (0.5 + Math.random());
      if (this.list.length >= this.max) this.dropOldest();
      this.list.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0, metal, big: Math.random() < 0.4, spin: Math.random() * Math.PI * 2, spinRate: 6 + Math.random() * 8 });
    }
    return n;
  }

  /** Move the coins; machines that touch one pick it up. */
  update(dt: number, machines: readonly Machine[], out: Pickup[]): void {
    const cs = this.list;
    for (let i = cs.length - 1; i >= 0; i--) {
      const c = cs[i]!;
      c.age += dt;
      c.vy += COIN_GRAVITY * dt;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.spin += c.spinRate * dt;
      const r = c.big ? 6 : 4.5;
      // the arena has no floor: a coin that falls out of the frame is gone, like a wreck
      let gone = c.age > LIFE || c.y > this.h + 20;
      if ((c.x < r && c.vx < 0) || (c.x > this.w - r && c.vx > 0)) c.vx = -c.vx * COR;
      if (!gone && c.age > PICKUP_AFTER) {
        for (const m of machines) {
          if (!m.alive || m.monster || m.stun > 0) continue;
          const dx = m.hull.x - c.x;
          const dy = m.hull.y - c.y;
          if (dx * dx + dy * dy < (HULL_R + r) ** 2) {
            out.push({ x: c.x, y: c.y, metal: c.metal, value: valueOf(c), by: m });
            gone = true;
            break;
          }
        }
      }
      if (gone) {
        cs[i] = cs[cs.length - 1]!;
        cs.pop();
      }
    }
  }

  /** The list is not in age order (swap-remove), so find the oldest. */
  private dropOldest(): void {
    const cs = this.list;
    let o = 0;
    for (let j = 1; j < cs.length; j++) if (cs[j]!.age > cs[o]!.age) o = j;
    cs[o] = cs[cs.length - 1]!;
    cs.pop();
  }

  clear(): void {
    this.list.length = 0;
  }
}

export const valueOf = (c: { metal: Metal; big: boolean }): number => DENOMS.find((d) => d.metal === c.metal && d.big === c.big)?.value ?? 1;

/** Fill and rim colours per metal. */
export const COIN_LOOK: { fill: string; rim: string }[] = [
  { fill: "#ffd84a", rim: "#a8741c" },
  { fill: "#e4e9f0", rim: "#7d8794" },
  { fill: "#e0915a", rim: "#8a4a22" },
];
export const COIN_FADE = LIFE;
