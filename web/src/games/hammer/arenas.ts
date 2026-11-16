// Arenas, spawn points and the phone stick's force model: shared by the TV host, the bots and the benches.

import { type Arena, type Machine, type ObstacleSpec, VIEW_H, VIEW_W } from "./sim.ts";

/** Spawn points in the classic 960×540 frame; a bigger arena uses the same shares of its size. */
export const SPAWNS: [number, number][] = [
  [220, 170],
  [740, 170],
  [220, 370],
  [740, 370],
  // seats 5-8: even slots (left HUD side, Red) on the left half, odd on the right
  [110, 270],
  [850, 270],
  [390, 400],
  [570, 400],
];

/** A spawn point for a seat, in the arena's own px. */
export function spawnPoint(arena: Arena, slot: number): [number, number] {
  const [x0, y0] = SPAWNS[slot] ?? [VIEW_W / 2, VIEW_H / 2];
  return [(x0 * arena.w) / VIEW_W, (y0 * arena.h) / VIEW_H];
}

/**
 * Arenas (OURS: Hammerfight's multiplayer arenas are one fixed size with no obstacles; its story ARENA has crates).
 * A bigger arena is the same TV picture zoomed out; positions are shares of the arena size.
 */
export const ARENAS: Record<string, { k: number; obstacles: [ObstacleSpec["kind"], number, number, number, number][] }> = {
  classic: { k: 1, obstacles: [] },
  crates: {
    k: 1,
    obstacles: [
      ["pillar", 0.33, 0.52, 12, 34],
      ["pillar", 0.67, 0.52, 12, 34],
      ["crate", 0.5, 0.36, 22, 22],
      ["crate", 0.5, 0.74, 22, 22],
    ],
  },
  big: {
    k: 1.5,
    obstacles: [
      ["pillar", 0.33, 0.52, 12, 34],
      ["pillar", 0.67, 0.52, 12, 34],
      ["crate", 0.5, 0.36, 22, 22],
      ["crate", 0.5, 0.74, 22, 22],
      ["crate", 0.18, 0.78, 20, 20],
      ["crate", 0.82, 0.78, 20, 20],
    ],
  },
  huge: {
    k: 2,
    obstacles: [
      ["pillar", 0.25, 0.5, 12, 40],
      ["pillar", 0.75, 0.5, 12, 40],
      ["pillar", 0.5, 0.55, 40, 12],
      ["crate", 0.5, 0.3, 22, 22],
      ["crate", 0.38, 0.78, 22, 22],
      ["crate", 0.62, 0.78, 22, 22],
      ["crate", 0.12, 0.3, 20, 20],
      ["crate", 0.88, 0.3, 20, 20],
    ],
  },
};

/** Size the arena and place its obstacles (an unknown kind is the classic arena). Returns the size. */
export function applyArenaKind(arena: Arena, kind: string): { w: number; h: number } {
  const a = ARENAS[kind] ?? ARENAS.classic!;
  const w = VIEW_W * a.k;
  const h = VIEW_H * a.k;
  arena.setArena(w, h, a.obstacles.map(([k, sx, sy, hw, hh]) => ({ kind: k, x: sx * w, y: sy * h, hw, hh })));
  return { w, h };
}

/** The phone stick's force model (the game's `controls.tune`; these are its defaults). */
export interface StickTune {
  /** Most input units per frame at full tilt. */
  stick: number;
  /** How hard the thrust closes the gap to the target speed. */
  steer: number;
  /** Extra push along the target direction, so a held stick keeps up speed against drag. */
  hold: number;
}
export const STICK_DEFAULTS: StickTune = { stick: 150, steer: 8, hold: 0.5 };

/**
 * Stick (not in Hammerfight): the tilt (x, y in −1…1) sets a target speed; the thrust closes the gap. The cap grows
 * with the tilt (full from half tilt), so a thumb that rests near the centre gives a small force, not a full brake,
 * and no step at the dead zone. Phones and bots use this same model, so a bot has no more power than a player.
 */
export function stickPush(arena: Arena, m: Machine, x: number, y: number, t: StickTune = STICK_DEFAULTS): void {
  const l = Math.hypot(x, y);
  if (l < 0.02) return;
  const top = arena.tuning.speedClip * Math.min(1, l);
  const tx = (x / l) * top;
  const ty = (y / l) * top;
  let ix = t.steer * (tx - m.hull.vx) + t.hold * tx;
  let iy = t.steer * (ty - m.hull.vy) + t.hold * ty;
  const cap = t.stick * Math.min(1, l / 0.5);
  const il = Math.hypot(ix, iy);
  if (il > cap) {
    ix *= cap / il;
    iy *= cap / il;
  }
  arena.pushRaw(m, ix, iy);
}
