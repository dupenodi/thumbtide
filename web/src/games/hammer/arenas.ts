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
  /**
   * The k the px sizes (half widths and heights, rope and chain lengths) were laid out for: they grow by k / base, so
   * the room keeps its shape when the arena is zoomed out (default: k).
   */
  base?: number;
  obstacles: ObstacleRow[];
  /** Seat spawn points as shares of the arena (even seats left, odd right); else SPAWNS. */
  spawns?: [number, number][];
  /** Decoration only (never collide, as Hammerfight's layer-0 chains): [x share, y share of the top, length px]. */
  chains?: [number, number, number][];
  theme?: ArenaTheme;
}

/** Destructible walls (OURS): sturdy plank walls toward the sides, slam surfaces that break after a beating. */
const WALL_HP = 60;

/**
 * Arenas. classic…huge are OURS. stands…pit are simplified from Hammerfight's fight levels (ARIA_multy, ARIA2_multy,
 * HAMMERBALL_multy, the Melka ARENA, KADISH_small, MELKA_pit2): the rooms squeezed into the 16:9 frame, with the
 * original's cages on ropes (density 50, hp 10-30) and heavy freeza blocks (74 px, density 40; movable is ours).
 * A bigger arena is the same TV picture zoomed out; positions are shares of the arena size.
 *
 * 2026-11-17 (play test: "the machines are a bit big for the arenas, piling in the middle"): every arena is zoomed out
 * (k up by 1.2-1.5, so a machine is 30-47 px tall on a 1080p TV instead of 33-66), the middle is open, and the
 * destructible walls (`wall`) stand toward the sides as slam surfaces. Two arenas (big, huge) have a saw on each side
 * wall. The level rooms keep their shapes (`base`); the clutter in their middles is gone (pit's stalagmite and floor
 * crates, melka's middle cage, blocks' middle block).
 */
export const ARENAS: Record<string, ArenaDef> = {
  classic: { k: 1.5, obstacles: [] },
  crates: {
    k: 1.5,
    obstacles: [
      ["wall", 0.1, 0.5, 12, 80, { hp: WALL_HP }],
      ["wall", 0.9, 0.5, 12, 80, { hp: WALL_HP }],
      ["crate", 0.05, 0.973, 22, 22],
      ["crate", 0.95, 0.973, 22, 22],
    ],
    spawns: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7], [0.2, 0.5], [0.8, 0.5], [0.42, 0.55], [0.58, 0.55]],
  },
  big: {
    k: 1.8,
    obstacles: [
      ["wall", 0.12, 0.42, 12, 70, { hp: WALL_HP }],
      ["wall", 0.88, 0.42, 12, 70, { hp: WALL_HP }],
      ["wall", 0.27, 0.943, 12, 55, { hp: WALL_HP }],
      ["wall", 0.73, 0.943, 12, 55, { hp: WALL_HP }],
      // a saw on each side wall, below the side walls: a shove into it cuts
      ["saw", 0, 0.75, 44, 44],
      ["saw", 1, 0.75, 44, 44],
    ],
    spawns: [[0.3, 0.3], [0.7, 0.3], [0.33, 0.66], [0.67, 0.66], [0.22, 0.5], [0.78, 0.5], [0.42, 0.5], [0.58, 0.5]],
  },
  huge: {
    k: 2.2,
    obstacles: [
      ["wall", 0.1, 0.3, 12, 80, { hp: WALL_HP }],
      ["wall", 0.1, 0.7, 12, 80, { hp: WALL_HP }],
      ["wall", 0.9, 0.3, 12, 80, { hp: WALL_HP }],
      ["wall", 0.9, 0.7, 12, 80, { hp: WALL_HP }],
      ["crate", 0.3, 0.981, 22, 22],
      ["crate", 0.7, 0.981, 22, 22],
      ["saw", 0, 0.5, 52, 52],
      ["saw", 1, 0.5, 52, 52],
    ],
    spawns: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.68], [0.7, 0.68], [0.2, 0.5], [0.8, 0.5], [0.42, 0.45], [0.58, 0.45]],
  },
  // ARIA_multy: a bowl between two spectator stands; a wooden post (it breaks) screens a nook under each stand
  stands: {
    k: 1.6,
    base: 1.25,
    theme: "aria",
    obstacles: [
      ["pillar", 0.09, 0.205, 108, 30], ["pillar", 0.065, 0.39, 78, 94], ["wall", 0.175, 0.778, 10, 82, { hp: WALL_HP }], ["pillar", 0.161, 0.95, 193, 34],
      ["pillar", 0.91, 0.205, 108, 30], ["pillar", 0.935, 0.39, 78, 94], ["wall", 0.825, 0.778, 10, 82, { hp: WALL_HP }], ["pillar", 0.839, 0.95, 193, 34],
    ],
    spawns: [[0.43, 0.8], [0.57, 0.8], [0.42, 0.12], [0.58, 0.12], [0.25, 0.6], [0.75, 0.6], [0.33, 0.35], [0.67, 0.35]],
  },
  // ARIA2_multy: an open field with a tower near each side (a crate on each tower top and the low walls are ours)
  towers: {
    k: 1.8,
    base: 1.5,
    theme: "sunrise",
    obstacles: [
      ["ledge", 0.13, 0.469, 100, 25], ["pillar", 0.155, 0.604, 36, 84], ["pillar", 0.13, 0.854, 100, 118], ["crate", 0.13, 0.416, 18, 18, { hp: 30 }],
      ["ledge", 0.87, 0.469, 100, 25], ["pillar", 0.845, 0.604, 36, 84], ["pillar", 0.87, 0.854, 100, 118], ["crate", 0.87, 0.416, 18, 18, { hp: 30 }],
      ["wall", 0.27, 0.938, 10, 50, { hp: WALL_HP }], ["wall", 0.73, 0.938, 10, 50, { hp: WALL_HP }],
    ],
    spawns: [[0.42, 0.85], [0.58, 0.85], [0.45, 0.12], [0.55, 0.12], [0.25, 0.3], [0.75, 0.3], [0.3, 0.55], [0.7, 0.55]],
  },
  // HAMMERBALL_multy: a closed stone lens with a mouth at each side; the heavy ball in the bowl and the walls by the mouths are ours
  eye: {
    k: 1.8,
    base: 1.5,
    theme: "hammerball",
    obstacles: [
      ["pillar", 0.5, 0.078, 175, 33],
      ["pillar", 0.1864, 0.2564, 330, 18, { a: -0.434 }], ["pillar", 0.8136, 0.2564, 330, 18, { a: 0.434 }],
      ["pillar", 0.1624, 0.7836, 285, 18, { a: 0.38 }], ["pillar", 0.8376, 0.7836, 285, 18, { a: -0.38 }],
      ["pillar", 0.5, 0.93, 240, 39],
      ["block", 0.5, 0.835, 30, 30, { d: 40 }],
      ["wall", 0.2, 0.53, 10, 40, { hp: WALL_HP }], ["wall", 0.8, 0.53, 10, 40, { hp: WALL_HP }],
    ],
    spawns: [[0.4, 0.62], [0.6, 0.62], [0.42, 0.3], [0.58, 0.3], [0.08, 0.53], [0.92, 0.53], [0.29, 0.45], [0.71, 0.45]],
  },
  // the Melka ARENA: a pit below, two balconies above (a breakable parapet at each balcony's end), two cages hanging from the dome
  melka: {
    k: 1.6,
    base: 1.25,
    theme: "arena-night",
    obstacles: [
      ["pillar", 0.09, 0.789, 108, 143], ["ledge", 0.179, 0.56, 215, 12],
      ["pillar", 0.91, 0.789, 108, 143], ["ledge", 0.821, 0.56, 215, 12],
      ["pillar", 0.131, 0.205, 223, 14, { a: -0.588 }], ["pillar", 0.869, 0.205, 223, 14, { a: 0.588 }],
      ["cage", 0.36, 0, 15, 24, { hp: 30, d: 50, rope: [0.36, 0.06, 150] }],
      ["cage", 0.64, 0, 15, 24, { hp: 28, d: 50, rope: [0.64, 0.06, 150] }],
      ["wall", 0.33, 0.492, 10, 34, { hp: WALL_HP }], ["wall", 0.67, 0.492, 10, 34, { hp: WALL_HP }],
    ],
    spawns: [[0.42, 0.85], [0.58, 0.85], [0.3, 0.3], [0.7, 0.3], [0.3, 0.72], [0.7, 0.72], [0.44, 0.6], [0.56, 0.6]],
  },
  // KADISH_small: a hall with a sloped roof and heavy freeza blocks on the floor (movable is ours), walls under the roof ends
  blocks: {
    k: 1.6,
    base: 1.25,
    theme: "kadish-dusk",
    obstacles: [
      ["pillar", 0.0916, 0.192, 185, 16, { a: -0.685 }], ["pillar", 0.9084, 0.192, 185, 16, { a: 0.685 }],
      ["floor", 0.5, 1.0148, 600, 10],
      ["block", 0.142, 0.9407, 40, 40, { d: 40 }], ["block", 0.318, 0.9407, 40, 40, { d: 40 }],
      ["block", 0.682, 0.9407, 40, 40, { d: 40 }], ["block", 0.858, 0.9407, 40, 40, { d: 40 }],
      ["wall", 0.17, 0.6, 12, 55, { hp: WALL_HP }], ["wall", 0.83, 0.6, 12, 55, { hp: WALL_HP }],
    ],
    spawns: [[0.41, 0.66], [0.59, 0.66], [0.4, 0.15], [0.6, 0.15], [0.07, 0.62], [0.93, 0.62], [0.29, 0.4], [0.71, 0.4]],
  },
  // MELKA_pit2: a low cave with overhangs, stalactites and benches; a breakable wall on each bench's edge
  pit: {
    k: 1.4,
    base: 1,
    theme: "pit-night",
    obstacles: [
      // the overhangs and stalactites reach up into the ceiling: zoomed out, their old tops left a slot under the
      // ceiling where a hull jammed
      ["pillar", 0.084, 0.14, 81, 76], ["pillar", 0.24, 0.07, 69, 38], ["pillar", 0.92, 0.14, 77, 76], ["pillar", 0.803, 0.088, 35, 47],
      ["pillar", 0.084, 0.92, 81, 43], ["pillar", 0.91, 0.92, 86, 43],
      ["wall", 0.15, 0.767, 10, 40, { hp: WALL_HP }], ["wall", 0.85, 0.767, 10, 40, { hp: WALL_HP }],
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
  // px sizes grow with the zoom-out, so a level room keeps its shape
  const g = a.k / (a.base ?? a.k);
  arena.kind = id;
  arena.theme = a.theme ?? "dusk";
  arena.chains = (a.chains ?? []).map(([sx, sy, len]) => ({ x: sx * w, y: sy * h, len: len * g }));
  arena.setArena(
    w,
    h,
    a.obstacles.map(([k, sx, sy, hw0, hh0, o]) => {
      const hw = hw0 * g;
      const hh = hh0 * g;
      const rope = o?.rope ? { x: o.rope[0] * w, y: o.rope[1] * h, len: o.rope[2] * g } : undefined;
      // a cage hangs straight below its rope end (the rope ends at the cage's top centre)
      const [x, y] = rope ? [rope.x, rope.y + rope.len + hh] : [sx * w, sy * h];
      return { kind: k, x, y, hw, hh, a: o?.a, hp: o?.hp, d: o?.d, rope };
    }),
  );
  return { w, h };
}

/** Grid cell (px) of the reach map below. */
const CELL = 20;
/**
 * A test "is (x, y) within `pad` px of an obstacle?" (turned boxes in their own frame; blocks and saws as circles),
 * with each obstacle's position and cos/sin read once: the reach map below calls it for every grid cell (on the TV
 * the whole map took ~20× the PC's 1.3–4.6 ms, a long frame at every wave of Co-op vs monsters).
 */
function blockTest(arena: Arena): (x: number, y: number, pad: number) => boolean {
  const n = arena.obstacles.length;
  const round = new Uint8Array(n);
  const ox = new Float64Array(n);
  const oy = new Float64Array(n);
  const oc = new Float64Array(n);
  const os = new Float64Array(n);
  const hw = new Float64Array(n);
  const hh = new Float64Array(n);
  arena.obstacles.forEach((o, i) => {
    const b = o.body;
    round[i] = o.kind === "block" || o.kind === "saw" ? 1 : 0;
    ox[i] = b.x;
    oy[i] = b.y;
    oc[i] = Math.cos(b.a);
    os[i] = Math.sin(b.a);
    hw[i] = o.hw;
    hh[i] = o.hh;
  });
  return (x, y, pad) => {
    for (let i = 0; i < n; i++) {
      if (round[i]) {
        if (Math.hypot(x - ox[i]!, y - oy[i]!) < hw[i]! + pad) return true;
        continue;
      }
      const c = oc[i]!;
      const s = os[i]!;
      const lx = (x - ox[i]!) * c + (y - oy[i]!) * s;
      const ly = -(x - ox[i]!) * s + (y - oy[i]!) * c;
      if (Math.abs(lx) < hw[i]! + pad && Math.abs(ly) < hh[i]! + pad) return true;
    }
    return false;
  };
}

/**
 * Heights (px) at which a worm can fly in from the left (side 0) or right (1) edge and reach the fight: rows whose
 * two edge cells join the play space (a flood fill from seat 1's spawn round the obstacles). The sealed corners
 * behind the eye's slabs and under the roofs of the hall and the melka dome are left out: worms that spawned there
 * never got out (play test 2026-11-17: 2 of 3 monster waves in the eye timed out).
 */
export function openSideRows(arena: Arena): [number[], number[]] {
  const nx = Math.ceil(arena.w / CELL);
  const ny = Math.ceil(arena.h / CELL);
  const seen = new Uint8Array(nx * ny);
  const blocked = blockTest(arena);
  const [sx, sy] = spawnPoint(arena, 0);
  // a stack of cell indices (each cell goes in at most once)
  const q = new Int32Array(nx * ny);
  let top = 0;
  q[top++] = Math.floor(sx / CELL) + Math.floor(sy / CELL) * nx;
  seen[q[0]!] = 1;
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= nx || y >= ny) return;
    const j = x + y * nx;
    if (seen[j] || blocked((x + 0.5) * CELL, (y + 0.5) * CELL, 18)) return;
    seen[j] = 1;
    q[top++] = j;
  };
  while (top) {
    const i = q[--top]!;
    const cx = i % nx;
    const cy = (i - cx) / nx;
    visit(cx + 1, cy);
    visit(cx - 1, cy);
    visit(cx, cy + 1);
    visit(cx, cy - 1);
  }
  const rows: [number[], number[]] = [[], []];
  for (let y = 0; y < ny; y++) {
    const py = (y + 0.5) * CELL;
    if (py < 100 || py > arena.h - 100) continue;
    // a straight way in over the first 12 % of the width (not into the lane behind a tower), with a margin: a worm's
    // body is wider than one cell
    const reach = Math.ceil((arena.w * 0.12) / CELL);
    let left = true;
    let right = true;
    for (let x = 0; x <= reach && (left || right); x++) {
      if (left && (!seen[x + y * nx] || blocked((x + 0.5) * CELL, py, 30))) left = false;
      if (right && (!seen[nx - 1 - x + y * nx] || blocked(arena.w - (x + 0.5) * CELL, py, 30))) right = false;
    }
    if (left && !blocked(-20, py, 30)) rows[0].push(py);
    if (right && !blocked(arena.w + 20, py, 30)) rows[1].push(py);
  }
  return rows;
}

/** Co-op vs monsters: worms alive at once at most (the TV's body budget: each worm is 10 bodies). */
export const MAX_WORMS = 4;
/** Worms in wave n (1, 2, 2, 3, 3, 4…; the host also caps them at MAX_WORMS and the body budget). */
export const waveWorms = (wave: number) => 1 + Math.floor(wave / 2);
/**
 * Seconds before the next wave comes anyway, with `worms` worms alive (OURS, 2026-11-17: a worm that hid behind an
 * obstacle held a wave open for ever). 15 + 5 per worm: 20 s for 1, 35 s for 4. Bench (playtest wave clear times,
 * 10 arenas x 8 rounds): 2 players + 2 bots clear 1-4 worms in 4.5 / 7.3 / 9.6 / 11.7 s (p90 7 / 10 / 12 / 15 s);
 * 2 players alone in 7.8 / 13 / 19 / 22 s (p90 13 / 19 / 26 / 31 s). So the timer fires for a slow or stuck wave,
 * not for a normal one.
 */
export const waveSeconds = (worms: number) => 15 + 5 * worms;
/** On the wave timer, a leftover worm farther than this (px) from every machine flies in again from a side. */
export const WORM_LOST_R = 450;

/** Move a worm (all its bodies, joints intact) so its core is at (x, y), at rest: a lost worm re-enters the fight. */
export function moveWorm(w: Machine, x: number, y: number): void {
  const dx = x - w.hull.x;
  const dy = y - w.hull.y;
  for (const b of [w.hull, ...w.parts]) {
    b.x += dx;
    b.y += dy;
    b.px = b.rx = b.x;
    b.py = b.ry = b.y;
  }
}

/** The wave timer ran out: every live worm far from all live machines (hidden, or stuck behind something) flies in again from a side. Returns how many. */
export function relaunchLost(arena: Arena, worms: Machine[], fighters: Machine[], rows: [number[], number[]] = openSideRows(arena)): number {
  let n = 0;
  for (const w of worms) {
    if (!w.alive) continue;
    if (fighters.some((m) => m.alive && Math.hypot(m.hull.x - w.hull.x, m.hull.y - w.hull.y) < WORM_LOST_R)) continue;
    const s = wormSpawn(arena, n++, rows);
    moveWorm(w, s.x, s.y);
  }
  return n;
}

/** How many worms the next wave adds: its size, but leftovers count toward MAX_WORMS, and each worm needs 10 free bodies. */
export const waveRoom = (wave: number, alive: number, freeBodies: number) => Math.max(0, Math.min(waveWorms(wave), MAX_WORMS - alive, Math.floor(freeBodies / 10)));

/** Where wave worm `i` flies in (host.ts and the benches): alternate sides, a random open row. */
export function wormSpawn(arena: Arena, i: number, rows: [number[], number[]] = openSideRows(arena)): { x: number; y: number; dir: number } {
  // the other side when this one is closed
  const own = i % 2 === 0 ? rows[0] : rows[1];
  const other = i % 2 === 0 ? rows[1] : rows[0];
  const left = own.length || !other.length ? i % 2 === 0 : i % 2 !== 0;
  const side = rows[left ? 0 : 1];
  const y = side.length ? side[Math.floor(Math.random() * side.length)]! : 120 + Math.random() * (arena.h - 240);
  return { x: left ? -40 : arena.w + 40, y, dir: left ? 0 : Math.PI };
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
