// Lift-off's course: a vertical tunnel of slabs and gaps, built upward from hand-made chunks picked by a seeded
// random. No drawing here. All units are metres; y grows upward, x = 0 is the middle of the tunnel.
//
// Obstacles are pure functions of the flight time t (seconds), so a seeded run replays exactly:
//  - rect: an axis-aligned block, optionally sliding sideways (x offset = ax · sin(om · t + ph))
//  - pend: a heavy round block on a rope, swinging from a pivot (angle = amp · sin(om · t + ph))
// Each chunk also leaves "gates" for the computer pilots: a height band and where its openings are at time t.

export const HALF_W = 9;
export const SLAB = 1.4;
/** The first obstacle's height above the pad. */
export const FIRST_AT = 16;

export type Rng = () => number;

export interface Rect {
  k: "rect";
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Sideways slide: amplitude (m), speed (rad/s), phase. ax = 0 for a block that stays put. */
  ax: number;
  om: number;
  ph: number;
}

export interface Pend {
  k: "pend";
  px: number;
  py: number;
  len: number;
  /** Swing amplitude (rad). */
  amp: number;
  om: number;
  ph: number;
  /** Radius of the round block. */
  r: number;
}

export type Obstacle = Rect | Pend;

export type GateKind = "gap" | "slide" | "chimney" | "pend" | "twin";

export interface Gate {
  kind: GateKind;
  y0: number;
  y1: number;
  /** Fixed openings: centre and half width. */
  opens: { cx: number; half: number }[];
  /** A sliding gap: openings move by ax · sin(om · t + ph). */
  ax: number;
  om: number;
  ph: number;
  /** A pendulum gate: the obstacle the opening dodges. */
  pend?: Pend;
}

export interface Difficulty {
  /** Gap width at the start and at the top of the ramp (m). */
  gap: [number, number];
  /** Space between chunks (m). */
  space: [number, number];
  /** Speed of moving blocks. */
  move: number;
  /** How fast the drop line climbs at the start and at the top of the ramp (m/s). */
  creep: [number, number];
  /** Self-righting of the rocket (fins). */
  right: number;
}

export const DIFFICULTIES: Record<"easy" | "normal" | "hard", Difficulty> = {
  easy: { gap: [10, 8], space: [21, 16], move: 0.6, creep: [1.0, 3.0], right: 4.2 },
  normal: { gap: [9, 6.8], space: [19, 14], move: 0.8, creep: [1.3, 3.8], right: 3.2 },
  hard: { gap: [7.6, 5.4], space: [17, 12.5], move: 1.05, creep: [1.8, 5], right: 2.2 },
};
export type DifficultyKey = keyof typeof DIFFICULTIES;

/** The difficulty ramp: 0 at the pad, 1 from this height on. */
export const RAMP_TOP = 800;
export const levelAt = (h: number) => Math.max(0, Math.min(1, h / RAMP_TOP));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const rectX = (o: Rect, t: number) => (o.ax ? o.ax * Math.sin(o.om * t + o.ph) : 0);
export function pendBob(o: Pend, t: number): { x: number; y: number } {
  const th = o.amp * Math.sin(o.om * t + o.ph);
  return { x: o.px + o.len * Math.sin(th), y: o.py - o.len * Math.cos(th) };
}

/** Where a gate's openings are at time t. */
export function gateOpenings(g: Gate, t: number): { cx: number; half: number }[] {
  if (g.pend) {
    const b = pendBob(g.pend, t);
    const side = b.x > 0 ? -1 : 1;
    return [{ cx: side * (HALF_W - 3.4), half: 3 }];
  }
  if (!g.ax) return g.opens;
  const dx = g.ax * Math.sin(g.om * t + g.ph);
  return g.opens.map((o) => ({ cx: o.cx + dx, half: o.half }));
}

export class Course {
  readonly obstacles: Obstacle[] = [];
  readonly gates: Gate[] = [];
  /** Built up to this height. */
  top = FIRST_AT;
  /** Height of each chunk's start, for the chunk count in tests. */
  readonly chunks: { kind: GateKind; y: number }[] = [];
  private lastCx = 0;

  constructor(readonly rng: Rng, readonly diff: Difficulty) {}

  /** Builds chunks until the course reaches `y` (plus some room above). */
  ensure(y: number) {
    while (this.top < y + 60) this.addChunk();
  }

  private addChunk() {
    const rng = this.rng;
    const y = this.top;
    const lvl = levelAt(y);
    const d = this.diff;
    const gw = lerp(d.gap[0], d.gap[1], lvl) + (rng() - 0.5) * 0.6;
    const space = lerp(d.space[0], d.space[1], lvl) + (rng() - 0.5) * 2;
    const first = this.chunks.length === 0;
    const weights: [GateKind, number][] = first
      ? [["gap", 1]]
      : [
          ["gap", 1.1 - 0.7 * lvl],
          ["slide", lvl > 0.04 ? 0.35 + 0.5 * lvl : 0],
          ["twin", lvl > 0.1 ? 0.4 : 0],
          ["chimney", lvl > 0.18 ? 0.45 : 0],
          ["pend", lvl > 0.28 ? 0.4 : 0],
        ];
    let r = rng() * weights.reduce((s, [, w]) => s + w, 0);
    let kind: GateKind = "gap";
    for (const [k, w] of weights) {
      if ((r -= w) < 0) {
        kind = k;
        break;
      }
    }
    this.chunks.push({ kind, y });
    let used = SLAB;
    switch (kind) {
      case "gap": {
        const cx = first ? (rng() - 0.5) * 4 : this.pickCx(gw, 0);
        this.slab(y, cx, gw, 0, 0, 0);
        break;
      }
      case "slide": {
        const ax = Math.min(lerp(2.2, 3.6, lvl) + rng() * 0.6, HALF_W - gw / 2 - 1);
        const om = (0.55 + 0.4 * lvl + rng() * 0.15) * d.move;
        const cx = this.pickCx(gw, ax);
        this.slab(y, cx, gw, ax, om, rng() * Math.PI * 2);
        break;
      }
      case "twin": {
        // two slabs with their gaps at opposite walls: a zigzag
        const side = rng() < 0.5 ? -1 : 1;
        const edge = HALF_W - gw / 2 - 0.5;
        const apart = lerp(11.5, 9.5, lvl);
        this.slab(y, side * edge, gw, 0, 0, 0);
        this.slab(y + apart, -side * edge, gw, 0, 0, 0);
        this.lastCx = -side * edge;
        used = apart + SLAB;
        break;
      }
      case "chimney": {
        // a long narrow channel
        const len = lerp(8, 14, lvl) + rng() * 2;
        const cw = gw + 0.7;
        const cx = this.pickCx(cw, 0);
        this.block(-HALF_W - 2, cx - cw / 2, y, y + len);
        this.block(cx + cw / 2, HALF_W + 2, y, y + len);
        this.gates.push({ kind, y0: y, y1: y + len, opens: [{ cx, half: cw / 2 }], ax: 0, om: 0, ph: 0 });
        used = len;
        break;
      }
      case "pend": {
        // a heavy block swinging under a slab with two gaps, one each side of the pivot
        const len = 6.2;
        const pr = 1.25;
        const py = y + len + pr + 0.6;
        const pend: Pend = {
          k: "pend", px: 0, py, len, amp: lerp(0.7, 0.95, lvl), om: (1.25 + 0.35 * lvl) * d.move, ph: rng() * Math.PI * 2, r: pr,
        };
        this.obstacles.push(pend);
        const bobY = py - len;
        this.gates.push({ kind, y0: bobY - pr, y1: bobY + pr, opens: [], ax: 0, om: 0, ph: 0, pend });
        const hub = 1.3;
        const w = Math.min(gw, HALF_W - hub - 1.2);
        this.block(-HALF_W - 2, -hub - w, py, py + SLAB);
        this.block(-hub, hub, py, py + SLAB);
        this.block(hub + w, HALF_W + 2, py, py + SLAB);
        this.gates.push({
          kind, y0: py, y1: py + SLAB, opens: [{ cx: -hub - w / 2, half: w / 2 }, { cx: hub + w / 2, half: w / 2 }], ax: 0, om: 0, ph: 0,
        });
        this.lastCx = 0;
        used = py + SLAB - y;
        break;
      }
    }
    this.top = y + used + space;
  }

  /** A gap centre that a crew can reach from the last one, kept clear of the walls even when it slides. */
  private pickCx(w: number, ax: number) {
    const lim = Math.max(0, HALF_W - w / 2 - 0.6 - ax);
    const lo = Math.max(-lim, this.lastCx - 8);
    const hi = Math.min(lim, this.lastCx + 8);
    const cx = lo + this.rng() * Math.max(0, hi - lo);
    this.lastCx = cx;
    return cx;
  }

  private block(x0: number, x1: number, y0: number, y1: number, ax = 0, om = 0, ph = 0) {
    this.obstacles.push({ k: "rect", x0, x1, y0, y1, ax, om, ph });
  }

  /** A slab across the tunnel with one gap. A sliding slab reaches past the walls so no hole opens at the edge. */
  private slab(y: number, cx: number, w: number, ax: number, om: number, ph: number) {
    const over = ax + 2;
    this.block(-HALF_W - over, cx - w / 2, y, y + SLAB, ax, om, ph);
    this.block(cx + w / 2, HALF_W + over, y, y + SLAB, ax, om, ph);
    this.gates.push({ kind: ax ? "slide" : "gap", y0: y, y1: y + SLAB, opens: [{ cx, half: w / 2 }], ax, om, ph });
  }
}

/** Does a circle touch any obstacle (or a wall) at time t? */
export function circleHits(course: Course, x: number, y: number, r: number, t: number, from = 0): boolean {
  if (x - r < -HALF_W || x + r > HALF_W) return true;
  const obs = course.obstacles;
  for (let i = from; i < obs.length; i++) {
    const o = obs[i]!;
    if (o.k === "rect") {
      if (o.y0 > y + r + 30) break; // obstacles are added bottom to top; nothing further up can touch
      if (y + r < o.y0 || y - r > o.y1) continue;
      const dx = rectX(o, t);
      const nx = Math.max(o.x0 + dx, Math.min(x, o.x1 + dx));
      const ny = Math.max(o.y0, Math.min(y, o.y1));
      if ((nx - x) ** 2 + (ny - y) ** 2 < r * r) return true;
    } else {
      const b = pendBob(o, t);
      if ((b.x - x) ** 2 + (b.y - y) ** 2 < (r + o.r) ** 2) return true;
    }
  }
  return false;
}
