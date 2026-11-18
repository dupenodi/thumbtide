// Weapon tours, for tests on the TV only (`pnpm tv --perf=hammer --tour=melee|guns`). The host uses them only in
// VITE_PERF builds, so normal builds drop all of it.
//
// melee: computer players fight with every melee weapon in turn (SET_S seconds per set).
// guns: every gun in turn on a rod, a blade and a chain weapon, with every shield plate kind.
// Wrecks come back after a moment, so a set always runs its full time. Every report window (2 s) gives the frame,
// physics and draw numbers plus what happened in the fight: hits, stuns, disarms, clashes, shots, blasts, plates
// knocked off, slow motion, sound calls, the worst joint stretch, the top body speed and any broken (NaN) bodies.

import type { GameAudio } from "./audio.ts";
import type { Body } from "./engine.ts";
import type { Arena, SimEvent } from "./sim.ts";
import { GUN_KINDS, type GunKind, PLATE_KINDS, type PlateKind, WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

export type TourKind = "melee" | "guns";

/** One set: a loadout for each seat. */
export interface TourSet {
  weapons: WeaponKind[];
  sidearms: (GunKind | null)[];
  plates: (PlateKind | null)[];
}

/** Weapons that carry the guns: a rod, a blade and a chain (each takes a sidearm). */
const GUN_CARRIERS: WeaponKind[] = ["hammer", "sword", "chainball", "axe"];

function tourSets(kind: TourKind, seats: number): TourSet[] {
  const sets: TourSet[] = [];
  const none = () => Array<null>(seats).fill(null);
  if (kind === "guns") {
    // each gun on every seat, and the plate kinds go round the seats so all 8 come up
    let p = 0;
    for (const g of GUN_KINDS) {
      const weapons = Array.from({ length: seats }, (_, i) => GUN_CARRIERS[i % GUN_CARRIERS.length]!);
      const plates = Array.from({ length: seats }, () => PLATE_KINDS[p++ % PLATE_KINDS.length]!);
      sets.push({ weapons, sidearms: Array<GunKind>(seats).fill(g), plates });
    }
    // mixed guns
    const mixed = Array.from({ length: seats }, (_, i) => GUN_KINDS[i % GUN_KINDS.length]!);
    sets.push({ weapons: Array.from({ length: seats }, (_, i) => GUN_CARRIERS[i % GUN_CARRIERS.length]!), sidearms: mixed, plates: Array.from({ length: seats }, () => PLATE_KINDS[p++ % PLATE_KINDS.length]!) });
    return sets;
  }
  for (let i = 0; i < WEAPON_KINDS.length; i += seats) {
    const set = WEAPON_KINDS.slice(i, i + seats);
    // the last set is filled up from the start, so every set has a full fight
    while (set.length < seats) set.push(WEAPON_KINDS[set.length]!);
    sets.push({ weapons: set, sidearms: none(), plates: none() });
  }
  return sets;
}

/** "hammer+sword+chainball", with the gun and plate when a seat has them: "hammer/arquebus/iron". */
const setName = (s: TourSet) => s.weapons.map((w, i) => [w, s.sidearms[i], s.plates[i]].filter(Boolean).join("/")).join("+");

const SET_S = 15;
/** Joint stretch is checked every few steps (it allocates; keep the test's own cost down). */
const JOINT_EVERY = 5;

export interface Tour {
  /** Seconds into the fight: returns the loadouts for the next set when it is time to change. */
  tick(real: number): TourSet | null;
  /** Physics step done (and how long it took). */
  stepped(ms: number): void;
  /** A frame done: physics steps in it, the draw time and the whole frame's script time. */
  framed(steps: number, drawMs: number, frameMs: number, parts?: { delay: number; loop: number; mid: number; hud: number }): void;
  /** This step's events, before the host handles them. */
  observe(events: SimEvent[]): void;
  /** The numbers for this report window (then they start again). */
  report(): Record<string, unknown>;
  /** Count calls to the game's sounds. */
  wrapSound(s: GameAudio | null): GameAudio | null;
}

export function makeTour(arena: Arena, seats: number, audioCtx: AudioContext | null, from = 1, kind: TourKind = "melee"): Tour {
  const sets = tourSets(kind, seats);
  let frames = 0;
  let stepsIn = 0;
  let drawMs = 0;
  let drawWorst = 0;
  let frameMs = 0;
  let frameWorst = 0;
  /** Frame parts (ms, summed): rAF callback delay, the step loop (input + physics + events), between loop and draw, the HUD. */
  const part = { delay: 0, loop: 0, mid: 0, hud: 0 };
  // `from` (1-based) starts the tour at a later set, to repeat the end of a run
  let setIdx = Math.max(0, Math.min(sets.length, from) - 1) - 1;
  let setT = SET_S;
  /** False until the first set starts (the warm-up). */
  let started = false;
  let lap = 1;
  let steps = 0;
  let stepMs = 0;
  let stepWorst = 0;
  let jointWorst = 0;
  let jointWho = "";
  let speedWorst = 0;
  let nan = 0;
  /** Steps run in slow motion (time warp under 1). */
  let slowSteps = 0;
  const ev: Record<string, number> = {};
  let dmgMax = 0;
  let impactMax = 0;
  const sounds: Record<string, number> = {};
  let soundErrors = 0;
  /** The real sound engine, for its sample stats. */
  let inner: GameAudio | null = null;

  const label = (b: Body) => {
    for (const m of arena.machines) if (m.hull === b || m.parts.includes(b)) return m.weapon;
    return "?";
  };

  return {
    tick(real) {
      setT += real;
      if (setT < SET_S) return null;
      setT = 0;
      started = true;
      setIdx++;
      if (setIdx >= sets.length) {
        setIdx = 0;
        lap++;
      }
      return sets[setIdx]!;
    },
    stepped(ms) {
      steps++;
      stepMs += ms;
      stepWorst = Math.max(stepWorst, ms);
      if (arena.timewarp < 1) slowSteps++;
      for (const b of arena.world.bodies) {
        if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.a)) nan++;
        const s = Math.hypot(b.vx, b.vy);
        if (s > speedWorst) speedWorst = s;
      }
      if (steps % JOINT_EVERY) return;
      for (const j of arena.world.joints) {
        // the dual sets' spacer (type 0, necess 1) can't be met by design: it only pushes the two parts apart
        if (j.necess <= 1) continue;
        const [ax, ay] = j.a.worldPoint(j.sax, j.say);
        const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
        const len = Math.hypot(bx - ax, by - ay);
        // ropes (3) may go slack; everything else holds its length
        const err = j.type === 3 ? Math.max(0, len - j.radius) : Math.abs(len - j.radius);
        if (err > jointWorst) {
          jointWorst = err;
          jointWho = `${label(j.b)} t${j.type}`;
        }
      }
    },
    framed(n, draw, total, p) {
      if (p) for (const k of Object.keys(part) as (keyof typeof part)[]) part[k] += p[k];
      frames++;
      stepsIn += n;
      drawMs += draw;
      drawWorst = Math.max(drawWorst, draw);
      frameMs += total;
      frameWorst = Math.max(frameWorst, total);
    },
    observe(events) {
      for (const e of events) {
        ev[e.type] = (ev[e.type] ?? 0) + 1;
        if (e.type === "hit") {
          dmgMax = Math.max(dmgMax, e.dmg);
          impactMax = Math.max(impactMax, e.impact);
        }
      }
    },
    report() {
      const r: Record<string, unknown> = {
        set: started ? `${setIdx + 1}/${sets.length} ${setName(sets[setIdx]!)}` : "warm-up",
        lap,
        bodies: arena.world.bodies.length,
        joints: arena.world.joints.length,
        stepMs: steps ? Math.round((stepMs / steps) * 100) / 100 : 0,
        stepWorstMs: Math.round(stepWorst * 10) / 10,
        // script time per frame: physics steps per frame, the draw call, and the whole frame (physics + draw + rest)
        stepsPerFrame: frames ? Math.round((stepsIn / frames) * 100) / 100 : 0,
        drawMs: frames ? Math.round((drawMs / frames) * 100) / 100 : 0,
        drawWorstMs: Math.round(drawWorst * 10) / 10,
        frameMs: frames ? Math.round((frameMs / frames) * 100) / 100 : 0,
        frameWorstMs: Math.round(frameWorst * 10) / 10,
        delayMs: frames ? Math.round((part.delay / frames) * 100) / 100 : 0,
        loopMs: frames ? Math.round((part.loop / frames) * 100) / 100 : 0,
        midMs: frames ? Math.round((part.mid / frames) * 100) / 100 : 0,
        hudMs: frames ? Math.round((part.hud / frames) * 100) / 100 : 0,
        jointPx: Math.round(jointWorst * 10) / 10,
        jointWho,
        topSpeed: Math.round(speedWorst),
        nan,
        slowSteps,
        warp: arena.timewarp.toFixed(2),
        ev: Object.entries(ev).map(([k, v]) => `${k}:${v}`).join(",") || "-",
        dmgMax,
        impactMax: Math.round(impactMax),
        sounds: Object.entries(sounds).map(([k, v]) => `${k}:${v}`).join(",") || "-",
        soundErrors,
        samples: ((s) => (s ? `${s.loaded} ok ${s.failed} failed, music ${s.music}` : "none"))(inner?.samples()),
        audio: audioCtx?.state ?? "none",
      };
      steps = 0;
      stepMs = 0;
      stepWorst = 0;
      frames = 0;
      stepsIn = 0;
      drawMs = 0;
      drawWorst = 0;
      frameMs = 0;
      part.delay = part.loop = part.mid = part.hud = 0;
      frameWorst = 0;
      jointWorst = 0;
      jointWho = "";
      speedWorst = 0;
      nan = 0;
      slowSteps = 0;
      dmgMax = 0;
      impactMax = 0;
      for (const k of Object.keys(ev)) delete ev[k];
      for (const k of Object.keys(sounds)) delete sounds[k];
      return r;
    },
    wrapSound(s) {
      if (!s) return s;
      inner = s;
      const counted = {} as GameAudio;
      for (const k of Object.keys(s) as (keyof GameAudio)[]) {
        const f = s[k] as (...a: unknown[]) => unknown;
        (counted as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
          // the per-frame mixer runs every frame: don't count it
          if (k !== "frame" && k !== "samples") sounds[k] = (sounds[k] ?? 0) + 1;
          try {
            return f(...a);
          } catch {
            soundErrors++;
          }
        };
      }
      return counted;
    },
  };
}
