// Lift-off's course: a wide vertical tunnel with a row of obstacles every few metres, built upward from a seeded
// random. No drawing here. All units are metres; y grows upward, x = 0 is the middle of the tunnel.
//
// Two kinds of things are in the way:
//  - solids (`rects`): slabs of the tunnel. The rocket bumps off them and flies on.
//  - hazards: mines, meteors, spiked bars and laser beams. A touch ends the run. Their position is a pure function
//    of the flight time t (seconds), so a seeded run replays exactly.
//
// The lane guarantee: every row has a "lane centre" c. The generator keeps every solid and every hazard (over its
// whole swept path, so over its full motion cycle) at least SAFE_R from the lane, so a disc of diameter MIN_GAP
// (1.4 x the rocket's width: 20 % clearance on each side) fits through the row at ANY time. The lane is straight
// while the rocket can touch a row (LANE_PAD above and below it) and moves between rows by at most LANE_SLOPE metres
// sideways per metre of height, which the rocket's tilt can follow. `checkLane` proves this by sampling.

export const HALF_W = 13.5;
export const SLAB = 1.4;
/** The first row's height above the pad. */
export const FIRST_AT = 18;
/** Height reserved for one row of obstacles (m). */
export const BAND = 7;

/** The rocket's widest part (fins), m. */
export const ROCKET_W = 2.8;
/** Free space wanted on each side of the rocket, as a share of its width. */
export const CLEARANCE = 0.2;
/** The narrowest free gap the course ever leaves: the rocket plus 20 % each side. */
export const MIN_GAP = ROCKET_W * (1 + 2 * CLEARANCE);
export const SAFE_R = MIN_GAP / 2;
/** The lane shifts at most this many metres sideways per metre of height. */
export const LANE_SLOPE = 0.45;
/** The lane is straight this far above and below a row (more than the rocket's half length). */
export const LANE_PAD = 3.2;

export type Rng = () => number;

export interface Rect {
  k: "rect";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export type HazardKind = "mine" | "meteor" | "bar" | "laser";

export interface Hazard {
  k: HazardKind;
  /** The middle of its motion. */
  x: number;
  y: number;
  /** Body radius (mine, meteor) or half thickness (bar, laser). */
  r: number;
  /** Half length of a bar or a laser beam. */
  len: number;
  /** Sideways swing: amplitude (m), speed (rad/s), phase. */
  ax: number;
  om: number;
  ph: number;
  /** Up-and-down swing. */
  ay: number;
  om2: number;
  ph2: number;
  /** A bar turns at this rate (rad/s) from the angle `a0`. */
  spin: number;
  a0: number;
  /** Everything it can ever touch: x0, y0, x1, y1. */
  box: [number, number, number, number];
  /** A number for its looks (the shape of a meteor). */
  seed: number;
}

export type Obstacle = Rect;
export type Fill = "none" | "mines" | "slab" | "meteor" | "bar" | "laser";

/** One row of the course: a band of obstacles with the safe lane through it. */
export interface Row {
  y0: number;
  y1: number;
  /** Lane centre and the free width the generator left there (>= MIN_GAP). */
  c: number;
  gw: number;
  fill: [Fill, Fill];
}

export interface Difficulty {
  /** Lane width beyond MIN_GAP at the start and at the top of the ramp (m). */
  slack: [number, number];
  /** Space between rows (m). */
  space: [number, number];
  /** Speed of moving hazards. */
  move: number;
  /** How fast the drop line climbs at the start and at the top of the ramp (m/s). */
  creep: [number, number];
  /** Self-righting of the rocket (fins). */
  right: number;
}

export const DIFFICULTIES: Record<"easy" | "normal" | "hard", Difficulty> = {
  easy: { slack: [8, 2.8], space: [24, 18], move: 0.65, creep: [0.7, 1.8], right: 4.2 },
  normal: { slack: [6.5, 1.5], space: [22, 15], move: 0.85, creep: [0.9, 2.4], right: 3.2 },
  hard: { slack: [5, 0.8], space: [20, 13.5], move: 1.1, creep: [1.2, 3.2], right: 2.2 },
};
export type DifficultyKey = keyof typeof DIFFICULTIES;

/** The difficulty ramp: 0 at the pad, 1 from this height on. */
export const RAMP_TOP = 350;
export const levelAt = (h: number) => Math.max(0, Math.min(1, h / RAMP_TOP));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ------------------------------------------------------------------ hazards in motion

export interface Pose {
  x: number;
  y: number;
  /** Angle of a bar. */
  a: number;
}

export function hazardPose(h: Hazard, t: number): Pose {
  return {
    x: h.ax ? h.x + h.ax * Math.sin(h.om * t + h.ph) : h.x,
    y: h.ay ? h.y + h.ay * Math.sin(h.om2 * t + h.ph2) : h.y,
    a: h.k === "bar" ? h.a0 + h.spin * t : 0,
  };
}

/** Distance from a point to the segment (x0,y0)-(x1,y1). */
function segDist(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l2 = dx * dx + dy * dy;
  const k = l2 ? clamp(((px - x0) * dx + (py - y0) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (x0 + k * dx), py - (y0 + k * dy));
}

/** Does a circle touch this hazard at time t? */
export function hazardTouches(h: Hazard, cx: number, cy: number, cr: number, t: number): boolean {
  const b = h.box;
  if (cx + cr < b[0] || cx - cr > b[2] || cy + cr < b[1] || cy - cr > b[3]) return false;
  const p = hazardPose(h, t);
  if (h.k === "mine" || h.k === "meteor") return (p.x - cx) ** 2 + (p.y - cy) ** 2 < (h.r + cr) ** 2;
  const ux = Math.cos(p.a) * h.len;
  const uy = Math.sin(p.a) * h.len;
  return segDist(cx, cy, p.x - ux, p.y - uy, p.x + ux, p.y + uy) < h.r + cr;
}

export function makeHazard(k: HazardKind, o: Partial<Hazard> & { x: number; y: number; r: number }): Hazard {
  const h: Hazard = { k, len: 0, ax: 0, om: 0, ph: 0, ay: 0, om2: 0, ph2: 0, spin: 0, a0: 0, seed: 0, box: [0, 0, 0, 0], ...o };
  if (k === "bar") {
    const rad = h.len + h.r;
    h.box = [h.x - rad, h.y - rad, h.x + rad, h.y + rad];
  } else {
    const hx = k === "laser" ? h.len : 0;
    h.box = [h.x - h.ax - hx - h.r, h.y - h.ay - h.r, h.x + h.ax + hx + h.r, h.y + h.ay + h.r];
  }
  return h;
}

// ------------------------------------------------------------------ the course

/** A solid or a wall touching a circle: the push-out direction and how deep. */
export interface Contact {
  nx: number;
  ny: number;
  depth: number;
}

export class Course {
  readonly rects: Rect[] = [];
  readonly hazards: Hazard[] = [];
  readonly rows: Row[] = [];
  /** Built up to this height. */
  top = FIRST_AT;
  /** Hazards the generator dropped because they crowded the lane (should stay 0). */
  dropped = 0;

  constructor(readonly rng: Rng, readonly diff: Difficulty) {}

  /** Builds rows until the course reaches `y` (plus some room above). */
  ensure(y: number) {
    while (this.top < y + 60) this.addRow();
  }

  /** The lane centre at height y. */
  laneAt(y: number): number {
    const rows = this.rows;
    if (!rows.length) return 0;
    let lo = 0;
    let hi = rows.length - 1;
    // the last row whose straight part starts at or below y
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (rows[mid]!.y0 - LANE_PAD <= y) lo = mid;
      else hi = mid - 1;
    }
    const a = rows[lo]!;
    if (y <= a.y1 + LANE_PAD || lo === rows.length - 1) return a.c;
    const b = rows[lo + 1]!;
    const s = a.y1 + LANE_PAD;
    return lerp(a.c, b.c, (y - s) / (b.y0 - LANE_PAD - s));
  }

  /** The row a rocket centred at y still has to get through (its tail may be in it), or undefined. */
  rowAhead(y: number): Row | undefined {
    return this.rows.find((r) => r.y1 + 2.8 > y);
  }

  private addRow() {
    const rng = this.rng;
    const d = this.diff;
    const y = this.top;
    const lvl = levelAt(y);
    const first = this.rows.length === 0;
    const space = first ? 0 : lerp(d.space[0], d.space[1], lvl) + (rng() - 0.5) * 2;
    const gw = MIN_GAP + Math.max(0, lerp(d.slack[0], d.slack[1], lvl ** 0.6) + (rng() - 0.5) * 0.8) + (first ? 3 : 0);
    // the lane: a bounded shift from the row below, sometimes the biggest the rocket can follow (a zigzag)
    const prev = this.rows[this.rows.length - 1];
    const lim = HALF_W - gw / 2 - 1;
    let c = 0;
    if (prev) {
      const shift = Math.max(0, LANE_SLOPE * (y - prev.y1 - 2 * LANE_PAD) - 0.3);
      const lo = Math.min(Math.max(-lim, prev.c - shift), lim);
      const hi = Math.max(Math.min(lim, prev.c + shift), -lim);
      if (rng() < 0.15 + 0.5 * lvl) {
        const dir = prev.c > 0 ? -1 : 1;
        c = clamp(prev.c + dir * shift * (0.85 + 0.15 * rng()), lo, hi);
      } else c = lo + rng() * Math.max(0, hi - lo);
    } else c = (rng() - 0.5) * 2;

    const fill: [Fill, Fill] = first ? ["mines", "mines"] : [this.pickFill(lvl, c - gw / 2 + HALF_W), this.pickFill(lvl, HALF_W - (c + gw / 2))];
    const row: Row = { y0: y, y1: y + BAND, c, gw, fill };
    this.rows.push(row);
    // left zone: the wall to the lane's left edge; right zone: the lane's right edge to the wall
    this.fillZone(row, -1, c - gw / 2, lvl);
    this.fillZone(row, 1, c + gw / 2, lvl);
    this.top = y + BAND + (first ? 14 : space);
  }

  private pickFill(lvl: number, zw: number): Fill {
    if (zw < 1.8) return "none";
    if (zw < 4.6) return this.rng() < 0.6 ? "mines" : "slab";
    const w: [Fill, number][] = [
      ["mines", 1],
      ["slab", 0.9 * (1 - 0.6 * lvl)],
      ["meteor", lvl > 0.03 ? 0.15 + 1.0 * lvl : 0.1],
      ["bar", lvl > 0.1 ? 0.1 + 0.9 * lvl : 0],
      ["laser", lvl > 0.15 ? 0.1 + 0.8 * lvl : 0],
      ["none", 0.45 * (1 - lvl) ** 2],
    ];
    let r = this.rng() * w.reduce((s, [, x]) => s + x, 0);
    for (const [k, x] of w) if ((r -= x) < 0) return k;
    return "mines";
  }

  /** Puts a row's obstacles into one side's zone: from `edge` (the lane's edge) out to the wall. */
  private fillZone(row: Row, side: -1 | 1, edge: number, lvl: number) {
    const rng = this.rng;
    const d = this.diff;
    const kind = row.fill[side < 0 ? 0 : 1];
    const za = side < 0 ? -HALF_W : edge;
    const zb = side < 0 ? edge : HALF_W;
    const zw = zb - za;
    const mid = row.y0 + BAND / 2;
    if (kind === "none") return;
    const speed = d.move * (0.85 + rng() * 0.3);
    switch (kind) {
      case "slab":
        this.add(null, { k: "rect", x0: side < 0 ? -HALF_W - 2 : edge, x1: side < 0 ? edge : HALF_W + 2, y0: mid - SLAB / 2, y1: mid + SLAB / 2 }, row);
        return;
      case "meteor": {
        const n = zw > 7 && rng() < lvl * 1.2 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const r = 0.9 + rng() * 0.3;
          this.add(makeHazard("meteor", {
            x: (za + zb) / 2, y: mid + (n === 1 ? 0 : i ? 1.3 : -1.3), r, seed: Math.floor(rng() * 1e6),
            ax: Math.max(0, zw / 2 - r - 0.05), om: lerp(0.5, 1.1, lvl) * speed, ph: rng() * Math.PI * 2,
            ay: n === 1 ? 1.1 : 0.6, om2: lerp(0.5, 1.1, lvl) * speed * 0.7, ph2: rng() * Math.PI * 2,
          }), null, row);
        }
        return;
      }
      case "bar": {
        const r = 0.35;
        const len = Math.min(3.05, zw / 2 - r - 0.15);
        if (len < 1.5) break;
        const rad = len + r;
        const lo = za + rad + 0.1;
        const hi = zb - rad - 0.1;
        this.add(makeHazard("bar", {
          x: hi > lo ? lo + rng() * (hi - lo) : (za + zb) / 2, y: mid, r, len, seed: Math.floor(rng() * 1e6),
          spin: (rng() < 0.5 ? -1 : 1) * lerp(0.55, 1.05, lvl) * speed, a0: rng() * Math.PI,
        }), null, row);
        return;
      }
      case "laser": {
        const r = 0.22;
        const len = zw / 2 - r;
        this.add(makeHazard("laser", {
          x: (za + zb) / 2, y: mid, r, len, seed: side,
          ay: 2.1 + rng() * 0.8, om2: lerp(0.8, 1.5, lvl) * speed * (0.85 + rng() * 0.3), ph2: (side < 0 ? 0 : Math.PI) + rng() * 0.5,
        }), null, row);
        return;
      }
      default:
        break;
    }
    // a line of mines from the lane's edge to the wall, close enough that none fits between two
    const r = 1;
    const step = lerp(3.4, 3.0, lvl);
    for (let k = 0; ; k++) {
      const x = edge + side * (r + k * step);
      const outer = side < 0 ? x - r : x + r;
      const atWall = side < 0 ? outer <= -HALF_W + 0.15 : outer >= HALF_W - 0.15;
      const px = atWall ? side * (HALF_W - r - 0.1) : x;
      this.add(makeHazard("mine", { x: px, y: mid + (k % 2 ? 0.8 : -0.8), r, seed: k }), null, row);
      if (atWall) break;
    }
  }

  /** The generator check: an obstacle goes in only if its whole swept box stays SAFE_R from the lane. */
  private add(h: Hazard | null, rect: Rect | null, row: Row) {
    const b: [number, number, number, number] = h ? h.box : [rect!.x0, rect!.y0, rect!.x1, rect!.y1];
    for (let y = b[1] - SAFE_R; y <= b[3] + SAFE_R + 1e-9; y += 0.25) {
      const dx = Math.max(b[0] - row.c, 0, row.c - b[2]);
      const dy = Math.max(b[1] - y, 0, y - b[3]);
      if (Math.hypot(dx, dy) < SAFE_R - 1e-9) {
        this.dropped++;
        return;
      }
    }
    if (h) this.hazards.push(h);
    else this.rects.push(rect!);
  }
}

// ------------------------------------------------------------------ touching things

/** The deepest touch of a circle with the tunnel walls or a slab, or null. `from`: first slab worth looking at. */
export function solidContact(course: Course, x: number, y: number, r: number, from = 0): Contact | null {
  let best: Contact | null = null;
  const take = (nx: number, ny: number, depth: number) => {
    if (!best || depth > best.depth) best = { nx, ny, depth };
  };
  if (x - r < -HALF_W) take(1, 0, -HALF_W - (x - r));
  if (x + r > HALF_W) take(-1, 0, x + r - HALF_W);
  const rs = course.rects;
  for (let i = from; i < rs.length; i++) {
    const o = rs[i]!;
    if (o.y0 > y + r + 30) break;
    if (y + r < o.y0 || y - r > o.y1 || x + r < o.x0 || x - r > o.x1) continue;
    const nx = clamp(x, o.x0, o.x1);
    const ny = clamp(y, o.y0, o.y1);
    const d2 = (nx - x) ** 2 + (ny - y) ** 2;
    if (d2 >= r * r) continue;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      take((x - nx) / d, (y - ny) / d, r - d);
    } else {
      // the centre is inside: leave by the nearest side
      const out: [number, number, number][] = [
        [-1, 0, x - o.x0], [1, 0, o.x1 - x], [0, -1, y - o.y0], [0, 1, o.y1 - y],
      ];
      out.sort((p, q) => p[2] - q[2]);
      take(out[0]![0], out[0]![1], out[0]![2] + r);
    }
  }
  return best;
}

/** The hazard a circle touches at time t, if any. `from`: first hazard worth looking at. */
export function hazardAt(course: Course, x: number, y: number, r: number, t: number, from = 0): Hazard | null {
  const hs = course.hazards;
  for (let i = from; i < hs.length; i++) {
    const h = hs[i]!;
    if (h.box[1] > y + r + 30) break;
    if (hazardTouches(h, x, y, r, t)) return h;
  }
  return null;
}

/**
 * Proves the lane guarantee for the course up to height `yTo` by sampling. Returns the problems found (none: fine).
 * `hull` is the rocket's collision circles (x, y, r); each is fattened by the 20 % clearance and swept along the
 * lane. Hazards are sampled over `seconds` of flight every `dt` seconds.
 */
export function checkLane(course: Course, yTo: number, hull: [number, number, number][], seconds = 60, dt = 0.25): string[] {
  const bad: string[] = [];
  const pad = CLEARANCE * ROCKET_W;
  const rows = course.rows.filter((r) => r.y0 < yTo);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.gw < MIN_GAP - 1e-9) bad.push(`row ${i}: gap ${r.gw.toFixed(2)} < ${MIN_GAP}`);
    if (Math.abs(r.c) + r.gw / 2 > HALF_W + 1e-9) bad.push(`row ${i}: lane outside the tunnel`);
    const p = rows[i - 1];
    if (p) {
      const run = r.y0 - LANE_PAD - (p.y1 + LANE_PAD);
      if (Math.abs(r.c - p.c) > LANE_SLOPE * run + 1e-9) bad.push(`row ${i}: lane moves ${Math.abs(r.c - p.c).toFixed(2)} m in ${run.toFixed(1)} m`);
    }
  }
  // time-free part: the slabs
  for (const o of course.rects) {
    if (o.y0 > yTo) break;
    for (let y = o.y0 - 4; y <= o.y1 + 4; y += 0.5) {
      const c = course.laneAt(y);
      for (const [hx, hy, hr] of hull) if (solidContact(course, c + hx, y + hy, hr + pad) ) bad.push(`slab at ${o.y0.toFixed(1)} crowds the lane at y=${y}`);
      if (bad.length > 5) return bad;
    }
  }
  for (const h of course.hazards) {
    if (h.box[1] > yTo) break;
    const moving = h.ax || h.ay || h.spin;
    const times = moving ? Math.ceil(seconds / dt) : 1;
    // the lane over the band the hazard lives in (plus the rocket's length)
    for (let y = h.box[1] - 4; y <= h.box[3] + 4; y += 0.5) {
      const c = course.laneAt(y);
      for (const [hx, hy, hr] of hull)
        for (let k = 0; k < times; k++)
          if (hazardTouches(h, c + hx, y + hy, hr + pad, k * dt)) {
            bad.push(`${h.k} at (${h.x.toFixed(1)}, ${h.y.toFixed(1)}) touches the fattened rocket on the lane at y=${y} t=${(k * dt).toFixed(2)}`);
            k = times;
          }
    }
    if (bad.length > 5) return bad;
  }
  return bad;
}
