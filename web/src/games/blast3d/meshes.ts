// Every model in Blast Party 3D, built in code once at load: low-poly, vertex colours, no textures.
// The cast and the arena are our own designs (chunky toy brawlers on a floating wooden deck); nothing here is copied
// from BombSquad's models or textures. Plain TypeScript (no three.js): view.ts turns a `Geo` into GPU buffers.
//
// One vertex layout for everything, so one shader draws it all:
//   position, normal, colour, aux = (part, tint)
// `part` picks one of the draw's part matrices (a fighter's 15 rigid parts; one bomb or box per slot of a prop
// sheet; 0 for the arena). `tint` = 1 multiplies the vertex colour by that part's tint colour (a player's colour on
// the outfit, a box's kind, a fuse's glow), 0 leaves the vertex colour as it is.
import { PARTS15, P, boneLength } from "./body.ts";
import { ARENA, BOX_R, type PowerKind } from "./rules.ts";

type RGB = [number, number, number];
export const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
type V = [number, number, number];

export class Geo {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  aux: number[] = [];
  part = 0;
  private tint = 0;
  private c: RGB = [1, 1, 1];
  private m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private o: V = [0, 0, 0];

  get tris() {
    return this.pos.length / 9;
  }

  /** The colour of what follows. */
  color(hex: string) {
    this.c = rgb(hex);
    this.tint = 0;
    return this;
  }
  /** What follows takes the part's tint colour, times this shade. */
  tinted(shade = 1) {
    this.c = [shade, shade, shade];
    this.tint = 1;
    return this;
  }
  /** Where what follows goes: a position, and a turn about x, then y, then z (radians). */
  at(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
    // R = Rz · Ry · Rx (row-major)
    this.m = [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx, sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx, -sy, cy * sx, cy * cx];
    this.o = [x, y, z];
    return this;
  }
  private rot(p: V): V {
    const m = this.m;
    return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2], m[3]! * p[0] + m[4]! * p[1] + m[5]! * p[2], m[6]! * p[0] + m[7]! * p[1] + m[8]! * p[2]];
  }
  private put(p: V, n: V, c: RGB = this.c) {
    const w = this.rot(p);
    const k = this.rot(n);
    this.pos.push(w[0] + this.o[0], w[1] + this.o[1], w[2] + this.o[2]);
    this.nor.push(k[0], k[1], k[2]);
    this.col.push(c[0], c[1], c[2]);
    this.aux.push(this.part, this.tint);
  }
  /** A triangle, counter-clockwise from outside. Without normals it is flat. */
  tri(a: V, b: V, c: V, na?: V, nb?: V, nc?: V, ca?: RGB, cb?: RGB, cc?: RGB) {
    if (!na) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      na = nb = nc = [nx, ny, nz];
    }
    this.put(a, na, ca);
    this.put(b, nb!, cb);
    this.put(c, nc!, cc);
  }
  quad(a: V, b: V, c: V, d: V, ca?: RGB, cb?: RGB, cc?: RGB, cd?: RGB) {
    this.tri(a, b, c, undefined, undefined, undefined, ca, cb, cc);
    this.tri(a, c, d, undefined, undefined, undefined, ca, cc, cd);
  }
  /** A box about the origin, optionally narrower at the top; `skip` leaves faces out ("b" bottom, "t" top). */
  box(w: number, h: number, d: number, tw = w, td = d, skip = "") {
    const x = w / 2, z = d / 2, X = tw / 2, Z = td / 2, y = h / 2;
    this.quad([x, -y, z], [x, -y, -z], [X, y, -Z], [X, y, Z]);
    this.quad([-x, -y, -z], [-x, -y, z], [-X, y, Z], [-X, y, -Z]);
    if (!skip.includes("t")) this.quad([-X, y, Z], [X, y, Z], [X, y, -Z], [-X, y, -Z]);
    if (!skip.includes("b")) this.quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]);
    this.quad([-x, -y, z], [x, -y, z], [X, y, Z], [-X, y, Z]);
    this.quad([x, -y, -z], [-x, -y, -z], [-X, y, -Z], [X, y, -Z]);
    return this;
  }
  /**
   * A shape turned about the y axis: `profile` is [radius, y] from the bottom up (radius 0 closes an end to a point),
   * `sides` around, stretched by sx and sz. Smooth-shaded; open ends with a radius get flat caps.
   */
  lathe(profile: [number, number][], sides: number, sx = 1, sz = 1, caps = true) {
    const n = profile.length;
    // the outward normal of the profile at each point (r, y)
    const pn: [number, number][] = profile.map((_, i) => {
      const a = profile[Math.max(0, i - 1)]!;
      const b = profile[Math.min(n - 1, i + 1)]!;
      const dr = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dr, dy) || 1;
      return [dy / l, -dr / l];
    });
    const point = (i: number, j: number): V => {
      const t = (j / sides) * Math.PI * 2;
      return [profile[i]![0] * Math.cos(t) * sx, profile[i]![1], profile[i]![0] * Math.sin(t) * sz];
    };
    const normal = (i: number, j: number): V => {
      const t = (j / sides) * Math.PI * 2;
      const x = (pn[i]![0] * Math.cos(t)) / sx, y = pn[i]![1], z = (pn[i]![0] * Math.sin(t)) / sz;
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    };
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = point(i, j), b = point(i + 1, j), c = point(i, j + 1), d = point(i + 1, j + 1);
        const na = normal(i, j), nb = normal(i + 1, j), nc = normal(i, j + 1), nd = normal(i + 1, j + 1);
        if (profile[i]![0] > 0) this.tri(a, b, c, na, nb, nc);
        if (profile[i + 1]![0] > 0) this.tri(c, b, d, nc, nb, nd);
      }
    }
    if (caps) {
      for (let j = 0; j < sides; j++) {
        if (profile[0]![0] > 0) this.tri([0, profile[0]![1], 0], point(0, j), point(0, j + 1));
        if (profile[n - 1]![0] > 0) this.tri([0, profile[n - 1]![1], 0], point(n - 1, j + 1), point(n - 1, j));
      }
    }
    return this;
  }
  /** A flat disc facing up (+y), `sides` triangles. */
  disc(r: number, sides: number) {
    for (let j = 0; j < sides; j++) {
      const a = (j / sides) * Math.PI * 2, b = ((j + 1) / sides) * Math.PI * 2;
      this.tri([0, 0, 0], [Math.cos(b) * r, 0, Math.sin(b) * r], [Math.cos(a) * r, 0, Math.sin(a) * r]);
    }
    return this;
  }
  /** A flat plate facing up (+y). */
  plate(w: number, d: number) {
    this.quad([-w / 2, 0, d / 2], [w / 2, 0, d / 2], [w / 2, 0, -d / 2], [-w / 2, 0, -d / 2]);
    return this;
  }
  /** A ball: `rings` bands from pole to pole. */
  ball(r: number, sides: number, rings: number, sx = 1, sy = 1, sz = 1) {
    const prof: [number, number][] = [];
    for (let i = 0; i <= rings; i++) {
      const a = -Math.PI / 2 + (i / rings) * Math.PI;
      prof.push([i === 0 || i === rings ? 0 : Math.cos(a) * r, Math.sin(a) * r * sy]);
    }
    return this.lathe(prof, sides, sx, sz, false);
  }
}

// ------------------------------------------------------------------------------------------------ the cast
export const PALETTE = {
  sky: "#8fd0f2",
  skyDeep: "#4f9fdc",
  cloud: "#f4fbff",
  wood: "#e3b877",
  woodAlt: "#d6a765",
  woodDark: "#9c6b3c",
  rock: "#7d6aa3",
  rockDark: "#5b4c80",
  moss: "#7cc46a",
  stone: "#cfd6e4",
  stoneDark: "#9aa4ba",
  ink: "#22263a",
  fuse: "#ff9d2e",
} as const;

/** Eight player colours that read against the wood and the sky. */
export const PLAYER_COLORS = ["#e8463a", "#3b7de8", "#f2c230", "#3cb371", "#b05ce8", "#f08a2c", "#2cc4c4", "#e85ca8"];

export const POWER_COLORS: Record<PowerKind, string> = { triple: "#f08a2c", impact: "#e5484d", sticky: "#57c247", gloves: "#4a7fe0", shield: "#3fc7d8", health: "#f4f4f4" };

export interface Variant {
  name: string;
  /** Bare arms and legs, and the hands (a part tint: boxing gloves recolour them). */
  skin: string;
  boots: string;
  /** How stocky (the trunk's width). */
  girth: number;
  head(g: Geo): void;
}

function eyes(g: Geo, y: number, z: number, spread: number, s = 1) {
  for (const sx of [-1, 1]) {
    g.color("#ffffff").at(sx * spread, y, z).box(0.1 * s, 0.12 * s, 0.03);
    g.color(PALETTE.ink).at(sx * spread * 0.92, y - 0.01 * s, z + 0.02).box(0.05 * s, 0.07 * s, 0.02);
  }
}

/** Six brawlers on one rig. Each has its own head and build; the outfit takes the player's colour. */
export const VARIANTS: Variant[] = [
  {
    // Mossy: a wide-mouthed frog with eyes on top
    name: "Mossy", skin: "#6dbb4c", boots: "#3d7a36", girth: 1.12,
    head(g) {
      g.color("#6dbb4c").at(0, 0.02, 0).ball(0.28, 8, 5, 1.22, 0.8, 1.05);
      for (const sx of [-1, 1]) {
        g.color("#6dbb4c").at(sx * 0.17, 0.24, 0.06).ball(0.105, 6, 4);
        g.color("#ffffff").at(sx * 0.17, 0.25, 0.15).box(0.1, 0.1, 0.03);
        g.color(PALETTE.ink).at(sx * 0.17, 0.25, 0.17).box(0.05, 0.06, 0.02);
      }
      g.color("#2f5e2a").at(0, -0.06, 0.275).box(0.3, 0.03, 0.03);
      g.color("#a9dd7f").at(0, -0.15, 0.2).box(0.26, 0.08, 0.12);
    },
  },
  {
    // Bubbles: a deep-sea diver in a copper helmet with a round window
    name: "Bubbles", skin: "#f0c9a0", boots: "#6b4a2c", girth: 1.05,
    head(g) {
      g.color("#d18b3d").at(0, 0.03, 0).ball(0.3, 8, 5);
      g.color("#8a5a26").at(0, 0.03, 0.2, Math.PI / 2).lathe([[0.2, 0], [0.2, 0.1]], 8);
      g.color("#a8dcf0").at(0, 0.03, 0.305, Math.PI / 2).lathe([[0.15, 0], [0.15, 0.012]], 8);
      eyes(g, 0.03, 0.325, 0.065, 0.75);
      g.color("#8a5a26").at(0, 0.33, 0).lathe([[0.07, 0], [0.07, 0.08]], 6);
      for (const sx of [-1, 1]) g.color("#8a5a26").at(sx * 0.29, 0.03, 0).box(0.06, 0.12, 0.12);
      g.tinted(0.9).at(0, -0.26, 0).lathe([[0.23, 0], [0.25, 0.05], [0.2, 0.09]], 8);
    },
  },
  {
    // Cap: a mushroom with a big spotted cap in the player's colour
    name: "Cap", skin: "#f3e6cf", boots: "#b89a6a", girth: 0.95,
    head(g) {
      g.color("#f3e6cf").at(0, -0.06, 0).lathe([[0.2, -0.18], [0.23, 0], [0.21, 0.14]], 8);
      g.color("#e2d2b4").at(0, 0.07, 0).lathe([[0.4, 0], [0.4, 0.012]], 8);
      g.tinted(1).at(0, 0.08, 0).lathe([[0.4, 0], [0.37, 0.12], [0.24, 0.24], [0, 0.29]], 8, 1, 1, false);
      for (const [x, y, z] of [[0.2, 0.2, 0.2], [-0.24, 0.19, 0.12], [0.02, 0.3, -0.06], [-0.08, 0.17, 0.3], [0.27, 0.18, -0.14]] as V[]) g.color("#ffffff").at(x, y + 0.08, z, 0.3, 0, x * -1.2).box(0.1, 0.03, 0.1);
      eyes(g, -0.04, 0.225, 0.09);
    },
  },
  {
    // Biscuit: a ginger cat with a scarf
    name: "Biscuit", skin: "#e9a04b", boots: "#f6e7cf", girth: 1,
    head(g) {
      g.color("#e9a04b").at(0, 0.02, 0).ball(0.28, 8, 5, 1.08, 0.95, 1);
      for (const sx of [-1, 1]) {
        g.color("#e9a04b").at(sx * 0.18, 0.2, 0, 0, 0, sx * -0.35).lathe([[0.1, 0], [0, 0.2]], 4);
        g.color("#f5b7b1").at(sx * 0.18, 0.21, 0.045, 0, 0, sx * -0.35).lathe([[0.055, 0], [0, 0.12]], 3);
      }
      g.color("#f6e7cf").at(0, -0.07, 0.25).box(0.2, 0.11, 0.08);
      g.color("#d9627a").at(0, -0.03, 0.3).box(0.06, 0.04, 0.03);
      eyes(g, 0.06, 0.265, 0.115);
      g.tinted(0.75).at(0, -0.27, 0).lathe([[0.22, 0], [0.24, 0.05], [0.19, 0.1]], 8);
    },
  },
  {
    // Coney: a road worker who never takes the cone off
    name: "Coney", skin: "#f0c9a0", boots: "#3a3f52", girth: 0.92,
    head(g) {
      g.color("#f0c9a0").at(0, 0, 0).ball(0.26, 8, 5);
      g.tinted(1).at(0, 0.1, 0).lathe([[0.34, 0], [0.34, 0.035], [0.2, 0.05], [0.06, 0.5], [0, 0.5]], 8, 1, 1, false);
      g.color("#ffffff").at(0, 0.24, 0).lathe([[0.17, 0], [0.132, 0.11]], 8, 1, 1, false);
      eyes(g, 0.0, 0.245, 0.1);
      g.color("#b5654a").at(0, -0.12, 0.24).box(0.12, 0.03, 0.03);
    },
  },
  {
    // Nettle: a cactus with a flower on top
    name: "Nettle", skin: "#4fae6a", boots: "#c9813f", girth: 1,
    head(g) {
      g.color("#4fae6a").at(0, 0, 0).lathe([[0, -0.24], [0.2, -0.2], [0.25, -0.05], [0.25, 0.16], [0.17, 0.3], [0, 0.34]], 8, 1, 1, false);
      for (const sx of [-1, 1]) g.color("#3f9558").at(sx * 0.27, 0.08 + sx * 0.05, 0).ball(0.085, 5, 3, 1, 1.3, 1);
      g.tinted(1).at(0, 0.34, 0).lathe([[0.13, 0], [0.15, 0.03], [0, 0.05]], 6);
      g.color("#ffe36e").at(0, 0.385, 0).box(0.07, 0.04, 0.07);
      eyes(g, 0.05, 0.245, 0.1);
      g.color("#2f6e41").at(0, -0.08, 0.245).box(0.1, 0.03, 0.03);
    },
  },
];

/** One fighter: 15 parts, each in its own part's frame (y along the bone). */
export function fighterGeo(v: Variant): Geo {
  const g = new Geo();
  const len = (p: number) => boneLength(PARTS15[p]!);
  const k = v.girth;
  g.part = P.head;
  v.head(g);
  // trunk: the outfit, in the player's colour
  g.part = P.torso;
  const th = len(P.torso) / 2;
  g.tinted(1).at(0, 0, 0).lathe([[0.2 * k, -th - 0.02], [0.25 * k, -th + 0.14], [0.26 * k, th - 0.12], [0.17 * k, th + 0.04]], 7, 1, 0.8);
  g.part = P.pelvis;
  g.tinted(0.62).at(0, 0, 0).lathe([[0.13 * k, -0.17], [0.21 * k, -0.07], [0.215 * k, 0.07]], 7, 1, 0.82, false);
  g.color(PALETTE.ink).at(0, 0.075, 0).lathe([[0.225 * k, -0.03], [0.225 * k, 0.03]], 7, 1, 0.82, false);
  for (let s = 0; s < 2; s++) {
    g.part = P.lUpperArm + s;
    const ua = len(P.lUpperArm) / 2;
    g.tinted(0.85).at(0, 0, 0).lathe([[0.09, -ua - 0.03], [0.095, 0], [0.08, ua + 0.02]], 5);
    g.part = P.lForearm + s;
    const fa = len(P.lForearm) / 2;
    g.color(v.skin).at(0, 0, 0).lathe([[0.075, -fa - 0.02], [0.08, fa]], 5, 1, 1, false);
    g.part = P.lHand + s;
    g.tinted(1).at(0, 0, 0).ball(0.11, 6, 3);
    g.part = P.lUpperLeg + s;
    const ul = len(P.lUpperLeg) / 2;
    g.tinted(0.62).at(0, 0, 0).lathe([[0.11, -ul - 0.02], [0.1, ul + 0.02]], 5, 1, 1, false);
    g.part = P.lLowerLeg + s;
    const ll = len(P.lLowerLeg) / 2;
    g.color(v.skin).at(0, 0, 0).lathe([[0.085, -ll - 0.02], [0.08, ll]], 5, 1, 1, false);
    g.part = P.lToes + s;
    g.color(v.boots).at(0, -0.02, 0.02).box(0.17, 0.14, 0.32, 0.15, 0.24);
  }
  return g;
}

// ------------------------------------------------------------------------------------------------ props
/** Slots of the bomb sheet (one draw): which slots hold which model. */
export const BOMB_SLOTS = { normal: [0, 14], impact: [14, 5], sticky: [19, 5] } as const;
/** Slots of the box sheet: the TNT crate, then three of each power-up box. */
export const TNT_SLOTS = [0, 2] as const;
export const POWER_ORDER: PowerKind[] = ["triple", "impact", "sticky", "gloves", "shield", "health"];
export const POWER_SLOT0 = 2;
export const POWER_PER_KIND = 3;
export const SLOTS = 24;

function fuse(g: Geo, r: number) {
  g.color("#8d93a6").at(0, r, 0).lathe([[0.075, -0.02], [0.075, 0.06], [0, 0.06]], 5, 1, 1, false);
  g.color("#d9c9a0").at(0.04, r + 0.11, 0, 0, 0, -0.5).box(0.035, 0.14, 0.035);
  g.tinted(1).at(0.09, r + 0.19, 0).box(0.07, 0.07, 0.07); // the lit tip: its tint glows
}

export function bombSheet(): Geo {
  const g = new Geo();
  for (let i = 0; i < SLOTS; i++) {
    g.part = i;
    if (i < BOMB_SLOTS.impact[0]) {
      // the comic bomb: a dark ball, a shine, a cap and a fuse
      g.color("#2b3042").at(0, 0, 0).ball(0.24, 7, 4);
      g.color("#7a84a3").at(-0.1, 0.12, 0.17, -0.5, -0.5, 0).box(0.09, 0.05, 0.02);
      fuse(g, 0.23);
    } else if (i < BOMB_SLOTS.sticky[0]) {
      // the impact bomb: a red ball with studs that blink
      g.color("#8c2b3a").at(0, 0, 0).ball(0.22, 7, 4);
      for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as V[]) g.tinted(1).at(x * 0.2, y * 0.2, z * 0.2).box(0.1, 0.1, 0.1);
    } else {
      // the sticky bomb: a lump of green goo
      g.color("#57c247").at(0, 0, 0).ball(0.22, 7, 4);
      for (const [x, y, z] of [[0.15, 0.08, 0.1], [-0.14, -0.05, 0.12], [-0.1, 0.12, -0.13], [0.16, -0.08, -0.08]] as V[]) g.color("#8be06f").at(x, y, z).ball(0.1, 4, 3);
      fuse(g, 0.2);
    }
  }
  return g;
}

function emblem(g: Geo, kind: PowerKind, face: (x: number, y: number) => [number, number, number, number, number, number]) {
  const put = (x: number, y: number) => g.at(...face(x, y));
  /** A second layer, a little further out along the face's normal (the lid: up; the front: towards the camera). */
  const lift = (f: [number, number, number, number, number, number]): [number, number, number, number, number, number] => (f[3] ? [f[0], f[1], f[2] + 0.012, f[3], f[4], f[5]] : [f[0], f[1] + 0.012, f[2], f[3], f[4], f[5]]);
  const ink = PALETTE.ink;
  if (kind === "triple") {
    for (const [x, y] of [[-0.14, -0.08], [0.14, -0.08], [0, 0.12]]) {
      g.color(ink);
      put(x!, y!).disc(0.085, 6);
    }
  } else if (kind === "impact") {
    g.color("#e5484d");
    put(0, 0).disc(0.2, 4);
    g.color("#ffe36e");
    g.at(...lift(face(0, 0))).disc(0.09, 4);
  } else if (kind === "sticky") {
    g.color("#57c247");
    put(0, 0).disc(0.19, 7);
    g.color("#c9f5b8");
    g.at(...lift(face(-0.06, 0.06))).disc(0.05, 5);
  } else if (kind === "gloves") {
    g.color("#e5484d");
    put(0, 0.03).plate(0.26, 0.22);
    g.color("#ffffff");
    put(0, -0.13).plate(0.2, 0.07);
  } else if (kind === "shield") {
    g.color("#3fc7d8");
    put(0, 0).disc(0.2, 6);
    g.color("#e8fbff");
    g.at(...lift(face(0, 0))).disc(0.1, 6);
  } else {
    g.color("#e5484d");
    put(0, 0).plate(0.34, 0.11);
    g.at(...lift(face(0, 0))).plate(0.11, 0.34);
  }
}

export function boxSheet(): Geo {
  const g = new Geo();
  for (let i = 0; i < SLOTS; i++) {
    g.part = i;
    if (i < TNT_SLOTS[1]) {
      // the TNT crate: red wood, dark corner posts, a pale warning band with studs
      g.color("#c2452f").at(0, 0, 0).box(0.86, 0.86, 0.86);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.color("#6e2318").at(sx * 0.42, 0, sz * 0.42).box(0.1, 0.9, 0.1);
      g.color("#f6e7cf").at(0, 0, 0).box(0.88, 0.26, 0.88, 0.88, 0.88, "tb");
      for (const [x, z] of [[0, 0.45], [0, -0.45], [0.45, 0], [-0.45, 0]]) g.color(PALETTE.ink).at(x, 0, z).box(x ? 0.02 : 0.3, 0.12, x ? 0.3 : 0.02);
      g.tinted(1).at(0, 0.46, 0).box(0.2, 0.06, 0.2); // the cap: it glows when the crate is about to go
    } else if (i < POWER_SLOT0 + POWER_ORDER.length * POWER_PER_KIND) {
      const kind = POWER_ORDER[Math.floor((i - POWER_SLOT0) / POWER_PER_KIND)]!;
      const s = BOX_R * 1.7;
      const h = s / 2;
      g.color(kind === "health" ? "#fbfbfb" : "#f3dca8").at(0, 0, 0).box(s, s, s);
      // the frame takes the kind's colour (the part tint), so the box reads from far away
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.tinted(1).at(sx * (h - 0.02), 0, sz * (h - 0.02)).box(0.09, s + 0.04, 0.09, 0.09, 0.09, "b");
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) g.tinted(0.85).at(0, sy * (h - 0.02), sz * (h - 0.02)).box(s - 0.06, 0.09, 0.09);
      emblem(g, kind, (x, y) => [x, h + 0.012, -y, 0, 0, 0]); // on the lid
      emblem(g, kind, (x, y) => [x, y, h + 0.012, Math.PI / 2, 0, 0]); // on the front
    }
  }
  return g;
}

// ------------------------------------------------------------------------------------------------ the arena
/** The floating deck, the blocks, the rock under it, and the sky far below: all static, one draw. */
export function arenaGeo(): Geo {
  const g = new Geo();
  const { hx, hz } = ARENA;
  // planks across the deck, two tones, a hair apart
  const planks = 14;
  const pw = (hz * 2) / planks;
  for (let i = 0; i < planks; i++) {
    const z = -hz + pw * (i + 0.5);
    g.color(i % 2 ? PALETTE.woodAlt : PALETTE.wood).at(0, -0.15, z).box(hx * 2, 0.3, pw - 0.04, hx * 2, pw - 0.04, "b");
  }
  // a dark frame under the planks, showing in the gaps and at the rim
  g.color(PALETTE.woodDark).at(0, -0.33, 0).box(hx * 2 + 0.3, 0.36, hz * 2 + 0.3, hx * 2 + 0.3, hz * 2 + 0.3, "b");
  // landing pads where the power-ups drop, the TNT's corner
  for (const [x, z] of ARENA.powerups) {
    g.color("#fff3cf").at(x, 0.02, z).disc(0.62, 10);
    g.color(PALETTE.wood).at(x, 0.035, z).disc(0.46, 10);
  }
  g.color("#c2452f").at(ARENA.tnt[0], 0.01, ARENA.tnt[1]).box(1.3, 0.02, 1.3, 1.3, 1.3, "b");
  g.color(PALETTE.wood).at(ARENA.tnt[0], 0.018, ARENA.tnt[1]).box(1.05, 0.036, 1.05, 1.05, 1.05, "b");
  // the blocks: pale stone with a darker foot and a mossy top
  for (const b of ARENA.blocks) {
    g.color(PALETTE.stoneDark).at(b.x, 0.09, b.z).box(b.w, 0.18, b.d, b.w, b.d, "b");
    g.color(PALETTE.stone).at(b.x, b.h / 2 + 0.07, b.z).box(b.w - 0.08, b.h - 0.16, b.d - 0.08, b.w - 0.08, b.d - 0.08, "b");
    g.color(PALETTE.moss).at(b.x, b.h - 0.02, b.z).box(b.w, 0.06, b.d, b.w - 0.1, b.d - 0.1);
  }
  // corner posts with lanterns, outside the play area
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (hx + 0.32), z = sz * (hz + 0.32);
      g.color(PALETTE.woodDark).at(x, 0.1, z).box(0.34, 1.5, 0.34);
      g.color("#ffe9a8").at(x, 1.02, z).box(0.3, 0.3, 0.3);
      g.color(PALETTE.woodDark).at(x, 1.24, z).box(0.42, 0.14, 0.42, 0.14, 0.14);
    }
  }
  // the island under the deck: rock, narrowing downwards
  g.color(PALETTE.rock).at(0, -1.25, 0).box(hx * 1.5, 1.5, hz * 1.5, hx * 2 - 0.2, hz * 2 - 0.2, "t");
  g.color(PALETTE.rockDark).at(0.4, -2.9, -0.2).box(hx * 0.7, 1.8, hz * 0.7, hx * 1.45, hz * 1.45, "t");
  g.color(PALETTE.rockDark).at(0.6, -4.5, 0).box(hx * 0.2, 1.4, hz * 0.2, hx * 0.66, hz * 0.66, "t");
  // the sky below: one big sheet, pale far away and deeper near the camera, with clouds and far islets
  const far = rgb("#c9ecfb"), near = rgb(PALETTE.skyDeep);
  g.at(0, -26, 0).quad([-90, 0, 40], [90, 0, 40], [90, 0, -110], [-90, 0, -110], near, near, far, far);
  const clouds: [number, number, number, number][] = [[-13, -7, -9, 1.5], [14, -9, -5, 1.9], [-16, -12, 6, 2.2], [15, -6, 7, 1.3], [1, -13, -17, 2.6], [-9, -15, -24, 2.4], [10, -8, -15, 1.6]];
  for (const [x, y, z, s] of clouds) {
    g.color(PALETTE.cloud).at(x, y, z).ball(1.5 * s, 7, 4, 1.5, 0.55, 1);
    g.color(PALETTE.cloud).at(x + 1.5 * s, y + 0.1 * s, z + 0.3).ball(1.05 * s, 6, 4, 1.4, 0.6, 1);
    g.color(PALETTE.cloud).at(x - 1.4 * s, y - 0.05 * s, z + 0.2).ball(0.9 * s, 6, 4, 1.4, 0.6, 1);
  }
  for (const [x, y, z, s] of [[-17, -3, -12, 1], [18, -5, -16, 1.4]] as [number, number, number, number][]) {
    g.color(PALETTE.moss).at(x, y, z).box(3 * s, 0.4 * s, 2.4 * s);
    g.color(PALETTE.rock).at(x, y - 1 * s, z).box(1 * s, 1.6 * s, 0.8 * s, 2.8 * s, 2.2 * s, "t");
  }
  return g;
}
