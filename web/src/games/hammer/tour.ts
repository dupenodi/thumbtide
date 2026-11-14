// Melee tour, for tests on the TV only (`pnpm tv --perf=hammer --tour=melee`). The host uses it only when
// PERF_BUILD is on, so normal builds drop all of it.
//
// Computer players fight with every melee weapon in turn (SET_S seconds per set). Wrecks come back after a moment,
// so a set always runs its full time. Every report window (2 s) gives the frame and physics numbers plus what
// happened in the fight: hits, stuns, disarms, clashes, slow motion, sound calls, the worst joint stretch, the top
// body speed and any broken (NaN) bodies.

import type { GameAudio } from "./audio.ts";
import type { Body } from "./engine.ts";
import type { Arena, SimEvent } from "./sim.ts";
import { WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const SET_S = 15;
/** Joint stretch is checked every few steps (it allocates; keep the test's own cost down). */
const JOINT_EVERY = 5;

export interface Tour {
  /** Seconds into the fight: returns the weapons for the next set when it is time to change. */
  tick(real: number): WeaponKind[] | null;
  /** Physics step done (and how long it took). */
  stepped(ms: number): void;
  /** This step's events, before the host handles them. */
  observe(events: SimEvent[]): void;
  /** The numbers for this report window (then they start again). */
  report(): Record<string, unknown>;
  /** Count calls to the game's sounds. */
  wrapSound(s: GameAudio | null): GameAudio | null;
}

export function makeTour(arena: Arena, seats: number, audioCtx: AudioContext | null): Tour {
  const sets: WeaponKind[][] = [];
  for (let i = 0; i < WEAPON_KINDS.length; i += seats) {
    const set = WEAPON_KINDS.slice(i, i + seats);
    // the last set is filled up from the start, so every set has a full fight
    while (set.length < seats) set.push(WEAPON_KINDS[set.length]!);
    sets.push(set);
  }
  let setIdx = -1;
  let setT = SET_S;
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

  const label = (b: Body) => {
    for (const m of arena.machines) if (m.hull === b || m.parts.includes(b)) return m.weapon;
    return "?";
  };

  return {
    tick(real) {
      setT += real;
      if (setT < SET_S) return null;
      setT = 0;
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
        set: setIdx >= 0 ? `${setIdx + 1}/${sets.length} ${sets[setIdx]!.join("+")}` : "warm-up",
        lap,
        bodies: arena.world.bodies.length,
        joints: arena.world.joints.length,
        stepMs: steps ? Math.round((stepMs / steps) * 100) / 100 : 0,
        stepWorstMs: Math.round(stepWorst * 10) / 10,
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
        audio: audioCtx?.state ?? "none",
      };
      steps = 0;
      stepMs = 0;
      stepWorst = 0;
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
      const counted = {} as GameAudio;
      for (const k of Object.keys(s) as (keyof GameAudio)[]) {
        const f = s[k] as (...a: unknown[]) => void;
        (counted as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
          // the per-frame mixer runs every frame: don't count it
          if (k !== "frame") sounds[k] = (sounds[k] ?? 0) + 1;
          try {
            f(...a);
          } catch {
            soundErrors++;
          }
        };
      }
      return counted;
    },
  };
}
