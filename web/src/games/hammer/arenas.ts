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

/** A spawn point for a seat, in the arena's own px (the arena's own spawn list, else the classic table scaled). */
export function spawnPoint(arena: Arena, slot: number): [number, number] {
  const own = ARENAS[arena.kind]?.spawns?.[slot];
  if (own) return [own[0] * arena.w, own[1] * arena.h];
  const [x0, y0] = SPAWNS[slot] ?? [VIEW_W / 2, VIEW_H / 2];
  return [(x0 * arena.w) / VIEW_W, (y0 * arena.h) / VIEW_H];
}

/** Extra values of one obstacle: angle (rad), health, density, and for a cage the rope [anchor x share, y share, length px]. */
type ObstacleOpts = { a?: number; hp?: number; d?: number; rope?: [number, number, number] };
/** [kind, x share, y share, half width px, half height px, options]. */
type ObstacleRow = [ObstacleSpec["kind"], number, number, number, number, ObstacleOpts?];
export type ArenaTheme = "dusk" | "aria" | "sunrise" | "hammerball" | "arena-night" | "kadish-dusk" | "pit-night";
export interface ArenaDef {
  /** Size: k × the 960×540 frame (the TV shows all of it, zoomed out). */
  k: number;
  obstacles: ObstacleRow[];
  /** Seat spawn points as shares of the arena (even seats left, odd right); else SPAWNS. */
  spawns?: [number, number][];
  /** Decoration only (never collide, as Hammerfight's layer-0 chains): [x share, y share of the top, length px]. */
  chains?: [number, number, number][];
  theme?: ArenaTheme;
}

/**
 * Arenas. classic…huge are OURS. stands…pit are simplified from Hammerfight's fight levels (ARIA_multy, ARIA2_multy,
 * HAMMERBALL_multy, the Melka ARENA, KADISH_small, MELKA_pit2): the rooms squeezed into the 16:9 frame, with the
 * original's cages on ropes (density 50, hp 10-30) and heavy freeza blocks (74 px, density 40; movable is ours).
 * A bigger arena is the same TV picture zoomed out; positions are shares of the arena size.
 */
export const ARENAS: Record<string, ArenaDef> = {
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
  // ARIA_multy: a bowl between two spectator stands; a post screens a nook under each stand
  stands: {
    k: 1.25,
    theme: "aria",
    obstacles: [
      ["pillar", 0.09, 0.205, 108, 30], ["pillar", 0.065, 0.39, 78, 94], ["pillar", 0.175, 0.778, 8, 82], ["pillar", 0.161, 0.95, 193, 34],
      ["pillar", 0.91, 0.205, 108, 30], ["pillar", 0.935, 0.39, 78, 94], ["pillar", 0.825, 0.778, 8, 82], ["pillar", 0.839, 0.95, 193, 34],
    ],
    spawns: [[0.43, 0.8], [0.57, 0.8], [0.42, 0.12], [0.58, 0.12], [0.25, 0.6], [0.75, 0.6], [0.33, 0.35], [0.67, 0.35]],
  },
  // ARIA2_multy: an open field with a tower near each side (a crate on each tower top is ours)
  towers: {
    k: 1.5,
    theme: "sunrise",
    obstacles: [
      ["ledge", 0.13, 0.469, 100, 25], ["pillar", 0.155, 0.604, 36, 84], ["pillar", 0.13, 0.854, 100, 118], ["crate", 0.13, 0.416, 18, 18, { hp: 30 }],
      ["ledge", 0.87, 0.469, 100, 25], ["pillar", 0.845, 0.604, 36, 84], ["pillar", 0.87, 0.854, 100, 118], ["crate", 0.87, 0.416, 18, 18, { hp: 30 }],
    ],
    spawns: [[0.42, 0.85], [0.58, 0.85], [0.45, 0.12], [0.55, 0.12], [0.25, 0.3], [0.75, 0.3], [0.3, 0.55], [0.7, 0.55]],
  },
  // HAMMERBALL_multy: a closed stone lens with a mouth at each side; the heavy ball in the bowl is ours
  eye: {
    k: 1.5,
    theme: "hammerball",
    obstacles: [
      ["pillar", 0.5, 0.078, 175, 33],
      ["pillar", 0.1864, 0.2564, 330, 18, { a: -0.434 }], ["pillar", 0.8136, 0.2564, 330, 18, { a: 0.434 }],
      ["pillar", 0.1624, 0.7836, 285, 18, { a: 0.38 }], ["pillar", 0.8376, 0.7836, 285, 18, { a: -0.38 }],
      ["pillar", 0.5, 0.93, 240, 39],
      ["block", 0.5, 0.835, 30, 30, { d: 40 }],
    ],
    spawns: [[0.4, 0.62], [0.6, 0.62], [0.42, 0.3], [0.58, 0.3], [0.08, 0.53], [0.92, 0.53], [0.27, 0.47], [0.73, 0.47]],
  },
  // the Melka ARENA: a pit below, two balconies above, three cages hanging from the dome
  melka: {
    k: 1.25,
    theme: "arena-night",
    obstacles: [
      ["pillar", 0.09, 0.789, 108, 143], ["ledge", 0.179, 0.56, 215, 12],
      ["pillar", 0.91, 0.789, 108, 143], ["ledge", 0.821, 0.56, 215, 12],
      ["pillar", 0.131, 0.205, 223, 14, { a: -0.588 }], ["pillar", 0.869, 0.205, 223, 14, { a: 0.588 }],
      ["cage", 0.36, 0, 15, 24, { hp: 30, d: 50, rope: [0.36, 0.06, 150] }],
      ["cage", 0.5, 0, 13, 13, { hp: 10, d: 50, rope: [0.5, 0.06, 110] }],
      ["cage", 0.64, 0, 15, 24, { hp: 28, d: 50, rope: [0.64, 0.06, 150] }],
      ["crate", 0.25, 0.516, 23, 18, { hp: 10 }], ["crate", 0.75, 0.516, 23, 18, { hp: 10 }],
    ],
    spawns: [[0.42, 0.85], [0.58, 0.85], [0.3, 0.3], [0.7, 0.3], [0.3, 0.72], [0.7, 0.72], [0.44, 0.6], [0.56, 0.6]],
  },
  // KADISH_small: a hall with a sloped roof and heavy freeza blocks on the floor (movable is ours)
  blocks: {
    k: 1.25,
    theme: "kadish-dusk",
    obstacles: [
      ["pillar", 0.0916, 0.192, 185, 16, { a: -0.685 }], ["pillar", 0.9084, 0.192, 185, 16, { a: 0.685 }],
      ["floor", 0.5, 1.0148, 600, 10],
      ["block", 0.142, 0.9407, 40, 40, { d: 40 }], ["block", 0.318, 0.9407, 40, 40, { d: 40 }], ["block", 0.5, 0.9407, 40, 40, { d: 40 }],
      ["block", 0.682, 0.9407, 40, 40, { d: 40 }], ["block", 0.858, 0.9407, 40, 40, { d: 40 }],
    ],
    spawns: [[0.41, 0.66], [0.59, 0.66], [0.4, 0.15], [0.6, 0.15], [0.07, 0.62], [0.93, 0.62], [0.27, 0.4], [0.73, 0.4]],
  },
  // MELKA_pit2: a low cave with overhangs, stalactites, benches and barrels
  pit: {
    k: 1,
    theme: "pit-night",
    obstacles: [
      ["pillar", 0.084, 0.16, 81, 62], ["pillar", 0.24, 0.098, 69, 23], ["pillar", 0.92, 0.16, 77, 62], ["pillar", 0.803, 0.115, 35, 32],
      ["pillar", 0.084, 0.92, 81, 43], ["pillar", 0.91, 0.92, 86, 43], ["pillar", 0.576, 0.92, 10, 43],
      ["crate", 0.13, 0.822, 10, 10, { hp: 10 }], ["crate", 0.9, 0.807, 22, 18, { hp: 20 }],
      ["crate", 0.35, 0.935, 23, 17, { hp: 10 }], ["crate", 0.7, 0.948, 8, 10, { hp: 10 }],
    ],
    chains: [[0.53, 0.41, 175]],
    spawns: [[0.44, 0.7], [0.64, 0.7], [0.4, 0.35], [0.6, 0.35], [0.1, 0.55], [0.82, 0.55], [0.27, 0.55], [0.7, 0.45]],
  },
};

/** Size the arena and place its obstacles (an unknown kind is the classic arena). Returns the size. */
export function applyArenaKind(arena: Arena, kind: string): { w: number; h: number } {
  const id = ARENAS[kind] ? kind : "classic";
  const a = ARENAS[id]!;
  const w = VIEW_W * a.k;
  const h = VIEW_H * a.k;
  arena.kind = id;
  arena.theme = a.theme ?? "dusk";
  arena.chains = (a.chains ?? []).map(([sx, sy, len]) => ({ x: sx * w, y: sy * h, len }));
  arena.setArena(
    w,
    h,
    a.obstacles.map(([k, sx, sy, hw, hh, o]) => {
      const rope = o?.rope ? { x: o.rope[0] * w, y: o.rope[1] * h, len: o.rope[2] } : undefined;
      // a cage hangs straight below its rope end (the rope ends at the cage's top centre)
      const [x, y] = rope ? [rope.x, rope.y + rope.len + hh] : [sx * w, sy * h];
      return { kind: k, x, y, hw, hh, a: o?.a, hp: o?.hp, d: o?.d, rope };
    }),
  );
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
/** The values of `tune` in hammer.pad (the phone's stick); keep them equal. */
export const STICK_DEFAULTS: StickTune = { stick: 420, steer: 5.6, hold: 0.5 };

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
