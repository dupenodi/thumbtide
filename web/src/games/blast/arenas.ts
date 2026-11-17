// Blast Party's three arenas, hand-made: logical px, origin in the middle, y down. An arena is a platform (one polygon)
// over a drop, with holes in it (gaps), crates (static boxes) and eight spawn points in order round the edge.
export type Pt = [number, number];
export type ArenaKey = "shelf" | "blanket" | "tub";

export interface CrateDef {
  x: number;
  y: number;
  w: number;
  h: number;
  /** "soap" is only a different picture. */
  kind: "crate" | "soap";
}

export interface Arena {
  id: ArenaKey;
  name: string;
  poly: Pt[];
  holes: Pt[][];
  crates: CrateDef[];
  /** Eight points in order round the platform (clockwise from the top left). */
  spawns: Pt[];
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const ellipse = (rx: number, ry: number, n = 40): Pt[] =>
  Array.from({ length: n }, (_, i) => [Math.round(Math.cos((i / n) * Math.PI * 2) * rx), Math.round(Math.sin((i / n) * Math.PI * 2) * ry)] as Pt);

const crate = (x: number, y: number, s = 44): CrateDef => ({ x, y, w: s, h: s, kind: "crate" });

/** Eight soap bars in a ring, each turned a little round the tub. */
const soaps = (): CrateDef[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    return { x: Math.round(Math.cos(a) * 190), y: Math.round(Math.sin(a) * 118), w: 54, h: 54, kind: "soap" as const };
  });

const tubSpawns = (): Pt[] =>
  Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8 + Math.PI;
    return [Math.round(Math.cos(a) * 345), Math.round(Math.sin(a) * 215)] as Pt;
  });

export const ARENAS: Record<ArenaKey, Arena> = {
  // A long plank with two gaps, one open at the top and one at the bottom: you can walk round them or hop over.
  shelf: {
    id: "shelf",
    name: "Toy shelf",
    poly: rect(-470, -135, 470, 135),
    holes: [rect(-195, -160, -135, 40), rect(135, -40, 195, 160)],
    crates: [crate(-340, 0), crate(340, 0), crate(0, -70), crate(0, 70)],
    spawns: [[-430, -95], [-250, -95], [250, -95], [430, -95], [430, 95], [250, 95], [-250, 95], [-430, 95]],
  },
  // A square with crates in the middle and at the corners of the inner square.
  blanket: {
    id: "blanket",
    name: "Picnic blanket",
    poly: rect(-290, -290, 290, 290),
    holes: [],
    crates: [crate(-125, -125), crate(125, -125), crate(-125, 125), crate(125, 125), crate(0, 0, 60), crate(-230, 0), crate(230, 0)],
    spawns: [[-240, -240], [-80, -250], [80, -250], [240, -240], [240, 240], [80, 250], [-80, 250], [-240, 240]],
  },
  // An oval tub with a ring of soap bars.
  tub: {
    id: "tub",
    name: "Bathtub",
    poly: ellipse(440, 285),
    holes: [],
    crates: soaps(),
    spawns: tubSpawns(),
  },
};

export const ARENA_ORDER: ArenaKey[] = ["shelf", "blanket", "tub"];

export function inPoly(x: number, y: number, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]!;
    const [xj, yj] = p[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
