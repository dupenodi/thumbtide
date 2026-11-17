// Headless rounds between computer players (no DOM): the bot benches use this to measure strength and spectacle.
// The round rules follow host.ts: damage from the start, sudden death at 60 s, time up at 90 s (most health wins).

import { applyArenaKind, spawnPoint } from "./arenas.ts";
import { Arena, type Machine, STEP } from "./sim.ts";
import { DEFAULT_TUNING, type Tuning } from "./tuning.ts";
import type { GunKind, PlateKind, WeaponKind } from "./weapons.ts";

/** Called once per 50 Hz frame, before the physics step, to give a machine its input. */
export type Driver = (arena: Arena, m: Machine) => void;

export interface Entrant {
  name: string;
  weapon: WeaponKind;
  sidearm?: GunKind | null;
  plate?: PlateKind | null;
  /** Made once per round, after the machines exist (so a driver can keep state). */
  driver: (arena: Arena, m: Machine) => Driver;
  team?: number;
}

export interface EntrantStats {
  name: string;
  weapon: WeaponKind;
  dealt: number;
  hits: number;
  bigHit: number;
  kos: number;
  /** Times this machine was slammed (into a wall, obstacle or machine) after a hit. */
  slammed: number;
  /** Seconds stunned. */
  stunned: number;
  minHp: number;
  hpEnd: number;
  alive: boolean;
  /** Seconds this machine was in the frame's outer band (60 px from a side): cornered or camping. */
  edge: number;
}

export interface RoundResult {
  arena: string;
  /** Index of the winning entrant, or −1 for a draw. */
  winner: number;
  seconds: number;
  timeUp: boolean;
  stats: EntrantStats[];
  /** Duel only: how often the lead (by health, 10 or more apart) changed sides. */
  leadChanges: number;
  /** The winner was at 35 health or less while an enemy had 20 more. */
  comeback: boolean;
  /** Share of 3 s windows with no hit at all (boring stretches). */
  quiet: number;
  slams: number;
  /** Sidearms broken off. */
  gunBreaks: number;
  hitsPerMin: number;
}

export interface RoundOptions {
  arena?: string;
  entrants: Entrant[];
  tuning?: Partial<Tuning>;
  /** Fight length cap in s (90, as on the TV). */
  limit?: number;
  suddenDeathAt?: number;
}

export function runRound(o: RoundOptions): RoundResult {
  const ar = new Arena({ ...DEFAULT_TUNING, passes: 15, gibs: 3, ...o.tuning });
  const kind = o.arena ?? "classic";
  applyArenaKind(ar, kind);
  const ms = o.entrants.map((e, i) => {
    const [x, y] = spawnPoint(ar, i);
    return ar.add({ id: i + 1, team: e.team ?? i, name: e.name, color: "#fff", weapon: e.weapon, sidearm: e.sidearm ?? null, plate: e.plate ?? null, x, y });
  });
  const drivers = o.entrants.map((e, i) => e.driver(ar, ms[i]!));
  const st: EntrantStats[] = o.entrants.map((e) => ({ name: e.name, weapon: e.weapon, dealt: 0, hits: 0, bigHit: 0, kos: 0, slammed: 0, stunned: 0, minHp: 100, hpEnd: 0, alive: true, edge: 0 }));
  const idx = new Map(ms.map((m, i) => [m, i]));
  const limit = o.limit ?? 90;
  const sdAt = o.suddenDeathAt ?? 60;
  let t = 0;
  let callAt = -1;
  let lead = 0;
  let leadChanges = 0;
  let windowHits = 0;
  let windows = 0;
  let quietWindows = 0;
  let nextWindow = 3;
  let slams = 0;
  let gunBreaks = 0;
  let hits = 0;
  let comebackRisk = new Set<number>();
  const teams = () => new Set(ms.filter((m) => m.alive).map((m) => m.team));
  while (t < limit) {
    for (let i = 0; i < ms.length; i++) if (ms[i]!.alive) drivers[i]!(ar, ms[i]!);
    ar.step();
    t += STEP;
    if (!ar.suddenDeath && t >= sdAt) ar.suddenDeath = true;
    for (const e of ar.events) {
      if (e.type === "hit" && e.attacker !== e.victim) {
        const a = idx.get(e.attacker);
        if (a !== undefined) {
          st[a]!.dealt += e.dmg;
          st[a]!.hits++;
          st[a]!.bigHit = Math.max(st[a]!.bigHit, e.dmg);
        }
        hits++;
        windowHits++;
      } else if (e.type === "ko" && e.by) {
        const a = idx.get(e.by);
        if (a !== undefined && e.by !== e.victim) st[a]!.kos++;
      } else if (e.type === "slam") {
        const v = idx.get(e.m);
        if (v !== undefined) st[v]!.slammed++;
        slams++;
      } else if (e.type === "gunbreak") {
        gunBreaks++;
      }
    }
    ar.events.length = 0;
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]!;
      const s = st[i]!;
      if (!m.alive) continue;
      s.minHp = Math.min(s.minHp, m.hp);
      if (m.stun > 0) s.stunned += STEP;
      if (m.hull.x < 60 || m.hull.x > ar.w - 60 || m.hull.y < 60 || m.hull.y > ar.h - 60) s.edge += STEP;
      for (let j = 0; j < ms.length; j++) if (j !== i && ms[j]!.alive && m.hp <= 35 && ms[j]!.hp >= m.hp + 20) comebackRisk.add(i);
    }
    if (ms.length === 2 && ms[0]!.alive && ms[1]!.alive) {
      const d = ms[0]!.hp - ms[1]!.hp;
      const now = d >= 10 ? 1 : d <= -10 ? -1 : lead;
      if (lead !== 0 && now !== lead) leadChanges++;
      lead = now;
    }
    if (t >= nextWindow) {
      windows++;
      if (windowHits === 0) quietWindows++;
      windowHits = 0;
      nextWindow += 3;
    }
    if (callAt < 0 && teams().size <= 1) callAt = t + 1.2;
    if (callAt >= 0 && t >= callAt) break;
  }
  const timeUp = teams().size > 1;
  let winner = -1;
  const alive = ms.filter((m) => m.alive);
  if (alive.length === 1) winner = idx.get(alive[0]!)!;
  else if (alive.length > 1) {
    const ranked = [...alive].sort((a, b) => b.hp - a.hp);
    if (ranked[0]!.hp !== ranked[1]!.hp) winner = idx.get(ranked[0]!)!;
  }
  for (let i = 0; i < ms.length; i++) {
    st[i]!.hpEnd = Math.max(0, ms[i]!.hp);
    st[i]!.alive = ms[i]!.alive;
  }
  return {
    arena: kind,
    winner,
    seconds: t,
    timeUp,
    stats: st,
    leadChanges,
    comeback: winner >= 0 && comebackRisk.has(winner),
    quiet: windows ? quietWindows / windows : 0,
    slams,
    gunBreaks,
    hitsPerMin: (hits * 60) / t,
  };
}

/** A seeded Math.random for repeatable benches (restores the real one when `fn` ends). */
export function withSeed<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  let s = seed >>> 0 || 1;
  Math.random = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}
