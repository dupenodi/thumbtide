// Headless rounds between computer players (no DOM): the bot benches use this to measure strength and spectacle.
// The round rules follow host.ts: damage from the start, sudden death at 60 s, time up at 90 s (most health wins).

import { applyArenaKind, openSideRows, relaunchLost, spawnPoint, waveRoom, waveSeconds, wormSpawn } from "./arenas.ts";
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
  /** Of `dealt`, the damage done by shots and rocket blasts. */
  shotDealt: number;
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
  /** Mean distance between two live machines (px, monsters left out): how spread out the fight is. */
  spread: number;
  /** spread as a share of the arena diagonal (the arenas differ in size). */
  spreadShare: number;
  /** Share of the time with a pile: some machine has 2 or more others within PILE_R px (monsters left out). */
  pile: number;
  /** Seconds a live machine sat still (under 25 px/s for 3 s or more), summed over the machines: stuck bots. */
  stuck: number;
  /** Hits by arena hazards (blades), and the machines they wrecked. */
  hazardHits: number;
  hazardKos: number;
  /** Monster rounds: worms spawned and worms killed. */
  monsters: number;
  monsterKos: number;
  /** Breakable obstacles (crates, cages, walls) broken, and how many the arena had. */
  breaks: number;
  breakables: number;
  /** Co-op vs monsters: the worms were the last side standing (or still alive at the time limit). */
  monstersWon: boolean;
  /** Co-op vs monsters with the wave timer: times it ran out (the next wave came with worms left), and waves fought. */
  waveTimerFired: number;
  waves: number;
}

/** Hull to hull distance under which machines count as one pile (two hulls with weapons overlapping). */
export const PILE_R = 110;

export interface RoundOptions {
  arena?: string;
  entrants: Entrant[];
  tuning?: Partial<Tuning>;
  /** Fight length cap in s (90, as on the TV). */
  limit?: number;
  suddenDeathAt?: number;
  /** Co-op vs monsters (host.ts "pvm"): this many worms fly in from the sides as one more side, at the host's spawn rows (wormSpawn). */
  monsters?: number;
  /** Every other worm armoured (default; host.ts: from wave 3). */
  armored?: boolean;
  /** Co-op vs monsters: the wave timer (host.ts) from this wave number on (0 or unset: off). */
  wave?: number;
}

/** Team numbers per mode, as host.ts teamOf gives them (seat i; `human` seats are the players' side in co-op). */
export function modeTeams(mode: "ffa" | "teams" | "pve" | "pvm", n: number, humans = 1): number[] {
  return Array.from({ length: n }, (_, i) => (mode === "teams" ? i % 2 : mode === "pve" ? (i < humans ? 0 : 1) : mode === "pvm" ? 0 : i));
}
const MONSTER_TEAM = 99;
/** The TV body budget for worms (host.ts BODY_BUDGET_LITE). */
const BENCH_BODY_BUDGET = 48;

export function runRound(o: RoundOptions): RoundResult {
  const ar = new Arena({ ...DEFAULT_TUNING, passes: 15, gibs: 3, ...o.tuning });
  const kind = o.arena ?? "classic";
  applyArenaKind(ar, kind);
  const ms = o.entrants.map((e, i) => {
    const [x, y] = spawnPoint(ar, i);
    return ar.add({ id: i + 1, team: e.team ?? i, name: e.name, color: "#fff", weapon: e.weapon, sidearm: e.sidearm ?? null, plate: e.plate ?? null, x, y });
  });
  const worms: Machine[] = [];
  const rows = o.monsters ? openSideRows(ar) : null;
  for (let i = 0; i < (o.monsters ?? 0); i++) {
    worms.push(ar.addMonster({ id: 1000 + i, team: MONSTER_TEAM, kind: (o.armored ?? true) && i % 2 === 1 ? "armoredworm" : "worm", ...wormSpawn(ar, i, rows!) }));
  }
  let wave = o.monsters ? (o.wave ?? 0) : 0;
  let waves = o.monsters ? 1 : 0;
  let waveTimerFired = 0;
  let waveLeft = wave > 0 ? waveSeconds(worms.length) : 0;
  const drivers = o.entrants.map((e, i) => e.driver(ar, ms[i]!));
  const st: EntrantStats[] = o.entrants.map((e) => ({ name: e.name, weapon: e.weapon, dealt: 0, hits: 0, bigHit: 0, kos: 0, slammed: 0, stunned: 0, minHp: 100, hpEnd: 0, alive: true, edge: 0, shotDealt: 0 }));
  const idx = new Map(ms.map((m, i) => [m, i]));
  let spreadSum = 0;
  let spreadN = 0;
  let pileT = 0;
  let stuck = 0;
  let hazardHits = 0;
  let hazardKos = 0;
  let monsterKos = 0;
  let breaks = 0;
  const breakables = ar.obstacles.filter((x) => x.hp < Infinity).length;
  const still = ms.map(() => 0);
  const bladed = new Map<Machine, number>();
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
  const teams = () => new Set([...ms, ...worms].filter((m) => m.alive).map((m) => m.team));
  while (t < limit) {
    for (let i = 0; i < ms.length; i++) if (ms[i]!.alive) drivers[i]!(ar, ms[i]!);
    ar.step();
    if (wave > 0 && callAt < 0) {
      waveLeft -= STEP;
      if (waveLeft <= 0) {
        // as host.ts nextWave: lost leftovers fly in again, the next wave joins them (leftovers count toward the cap)
        waveTimerFired++;
        relaunchLost(ar, worms, ms, rows!);
        wave++;
        waves++;
        const alive = worms.filter((w) => w.alive).length;
        const n = waveRoom(wave, alive, BENCH_BODY_BUDGET - ar.world.bodies.length);
        for (let i = 0; i < n; i++) worms.push(ar.addMonster({ id: 1000 + worms.length, team: MONSTER_TEAM, kind: wave >= 3 && i % 2 === 1 ? "armoredworm" : "worm", ...wormSpawn(ar, alive + i, rows!) }));
        waveLeft = waveSeconds(Math.max(1, alive + n));
      }
    }
    t += STEP;
    if (!ar.suddenDeath && t >= sdAt) ar.suddenDeath = true;
    for (const e of ar.events) {
      if (e.type === "hit" && e.attacker !== e.victim) {
        const a = idx.get(e.attacker);
        if (a !== undefined) {
          st[a]!.dealt += e.dmg;
          if (e.shot) st[a]!.shotDealt += e.dmg;
          st[a]!.hits++;
          st[a]!.bigHit = Math.max(st[a]!.bigHit, e.dmg);
        }
        hits++;
        windowHits++;
      } else if (e.type === "ko") {
        if (e.victim.monster) monsterKos++;
        if (bladed.has(e.victim) && t - bladed.get(e.victim)! < 0.3) hazardKos++;
        const a = e.by ? idx.get(e.by) : undefined;
        if (a !== undefined && e.by !== e.victim) st[a]!.kos++;
      } else if (e.type === "break") {
        breaks++;
      } else if (e.type === "hazard") {
        hazardHits++;
        bladed.set(e.victim, t);
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
      // stuck: no real motion for 3 s (a hull jammed in a corner or on an obstacle)
      if (Math.hypot(m.hull.vx, m.hull.vy) < 25 && m.stun <= 0) {
        still[i]! += STEP;
        if (still[i]! >= 3) stuck += STEP;
      } else still[i] = 0;
    }
    // spread and piles (machines only)
    let pile = false;
    for (let i = 0; i < ms.length; i++) {
      const a = ms[i]!;
      if (!a.alive) continue;
      let near = 0;
      for (let j = 0; j < ms.length; j++) {
        const b = ms[j]!;
        if (j === i || !b.alive) continue;
        const d = Math.hypot(a.hull.x - b.hull.x, a.hull.y - b.hull.y);
        if (j > i) {
          spreadSum += d;
          spreadN++;
        }
        if (d < PILE_R) near++;
      }
      if (near >= 2) pile = true;
    }
    if (pile) pileT += STEP;
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
    spread: spreadN ? spreadSum / spreadN : 0,
    spreadShare: spreadN ? spreadSum / spreadN / Math.hypot(ar.w, ar.h) : 0,
    pile: pileT / t,
    stuck,
    hazardHits,
    hazardKos,
    monsters: worms.length,
    monsterKos,
    breaks,
    breakables,
    waveTimerFired,
    waves,
    monstersWon: worms.some((w) => w.alive) && (alive.length === 0 || timeUp),
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
