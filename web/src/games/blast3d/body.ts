// The fighters' rig for Blast Party 3D: 15 joints and 15 rigid parts (head, torso, pelvis, and per side upper arm,
// forearm, hand, upper leg, lower leg, toes), the animated pose (run cycle, punch, carry, knocked down) and each
// part's matrix from the joints. The part count follows Ballistica's spaz (spazappearance.py lists the same nine
// meshes, mirrored); the proportions, the pose code and the models (meshes.ts) are ours. No three.js here.

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

/**
 * How the rig's own measures are drawn. Ballistica's character stands about 1.2 m from its feet to the top of its head
 * (characterrig.py: the ball's bottom to the head's top, 0.3 + 0.18 + 0.45 + 0.23), on a deck the size of The Pad, so
 * ours are drawn about that size (1.26 m) with a bigger head (HEAD_GROW), chunky and readable from a sofa.
 */
export const SCALE = 0.73;
/** The head drawn this much bigger than the rig's (Ballistica's head is a 0.23 ball on a 1.2 m body). */
export const HEAD_GROW = 1.35;

/** Joints (also the ragdoll's particles). Local frame: +y up, +z forward, feet on y = 0. */
export const J = { head: 0, neck: 1, pelvis: 2, lSh: 3, rSh: 4, lEl: 5, rEl: 6, lHa: 7, rHa: 8, lHip: 9, rHip: 10, lKn: 11, rKn: 12, lFt: 13, rFt: 14 } as const;
export const NJ = 15;
export const REST: V3[] = [
  v3(0, 1.52, 0), // head
  v3(0, 1.28, 0), // neck
  v3(0, 0.86, 0), // pelvis
  v3(0.24, 1.24, 0), // shoulders
  v3(-0.24, 1.24, 0),
  v3(0.27, 0.98, 0), // elbows
  v3(-0.27, 0.98, 0),
  v3(0.28, 0.74, 0.04), // hands
  v3(-0.28, 0.74, 0.04),
  v3(0.11, 0.8, 0), // hips
  v3(-0.11, 0.8, 0),
  v3(0.12, 0.45, 0.02), // knees
  v3(-0.12, 0.45, 0.02),
  v3(0.12, 0.09, 0), // feet
  v3(-0.12, 0.09, 0),
];

export type Shape = "sphere" | "box" | "capsule";
export interface PartDef {
  /** Drawn this much bigger about its place (the head). */
  grow?: number;
  /** Geometry kind: mirrored parts share one (one InstancedMesh per kind). */
  kind: string;
  shape: Shape;
  /** sphere: [r]; capsule: [r, length]; box: [w, h, d] (h along the part's axis). */
  size: number[];
  /** The part's axis runs from joint a to joint b (-1: straight up). */
  a: number;
  b: number;
  /** Where it sits: a joint, or -1 for the middle of a..b. */
  at: number;
  /** Pushed forward from `at` (m), along the body's facing. */
  fwd?: number;
}

const dist = (a: number, b: number) => Math.hypot(REST[a]!.x - REST[b]!.x, REST[a]!.y - REST[b]!.y, REST[a]!.z - REST[b]!.z);
const seg = (kind: string, r: number, a: number, b: number): PartDef => ({ kind, shape: "capsule", size: [r, Math.max(0.01, dist(a, b) - r)], a, b, at: -1 });

/** BombSquad's part count: 15 rigid parts. */
export const PARTS15: PartDef[] = [
  { kind: "head", shape: "sphere", size: [0.2], a: J.neck, b: J.head, at: J.head, grow: HEAD_GROW },
  { kind: "torso", shape: "box", size: [0.42, dist(J.pelvis, J.neck), 0.26], a: J.pelvis, b: J.neck, at: -1 },
  { kind: "pelvis", shape: "box", size: [0.34, 0.2, 0.24], a: J.pelvis, b: J.neck, at: J.pelvis },
  seg("upperArm", 0.075, J.lSh, J.lEl),
  seg("upperArm", 0.075, J.rSh, J.rEl),
  seg("forearm", 0.065, J.lEl, J.lHa),
  seg("forearm", 0.065, J.rEl, J.rHa),
  { kind: "hand", shape: "sphere", size: [0.085], a: J.lEl, b: J.lHa, at: J.lHa },
  { kind: "hand", shape: "sphere", size: [0.085], a: J.rEl, b: J.rHa, at: J.rHa },
  seg("upperLeg", 0.09, J.lHip, J.lKn),
  seg("upperLeg", 0.09, J.rHip, J.rKn),
  seg("lowerLeg", 0.075, J.lKn, J.lFt),
  seg("lowerLeg", 0.075, J.rKn, J.rFt),
  { kind: "toes", shape: "box", size: [0.13, 0.08, 0.24], a: -1, b: -1, at: J.lFt, fwd: 0.06 },
  { kind: "toes", shape: "box", size: [0.13, 0.08, 0.24], a: -1, b: -1, at: J.rFt, fwd: 0.06 },
];

export const P = { head: 0, torso: 1, pelvis: 2, lUpperArm: 3, rUpperArm: 4, lForearm: 5, rForearm: 6, lHand: 7, rHand: 8, lUpperLeg: 9, rUpperLeg: 10, lLowerLeg: 11, rLowerLeg: 12, lToes: 13, rToes: 14 } as const;
/** The length of a part along its bone. */
export const boneLength = (d: PartDef) => (d.a >= 0 && d.b >= 0 ? dist(d.a, d.b) : 0);

/** What the pose needs from a character. */
export interface Poser {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Run cycle (radians) and how fast (0..1). */
  phase: number;
  speed: number;
  /** Punch swing 0..1, or < 0 when not punching. */
  punch: number;
  punchSide: number;
  /** "held": carried by someone; "carry": holding someone over the head. */
  held: boolean;
  carry: boolean;
  t: number;
  /** 0 standing … 1 flat on its back (knocked out, carried, dead). */
  down: number;
  /** In the air on its own feet: legs tucked. */
  air: boolean;
}

/** The animated pose (run cycle + punch swing), in world space, into `out` (15 joints). */
export function pose(c: Poser, out: V3[]) {
  const s = c.held ? 0 : c.speed;
  const ph = c.phase;
  const bob = Math.abs(Math.sin(ph)) * 0.06 * s;
  const lean = 0.2 * s;
  const L = out; // write local first, then move to world
  set(L[J.pelvis]!, 0, 0.86 + bob, 0);
  set(L[J.neck]!, 0, 1.28 + bob, lean * 0.42);
  set(L[J.head]!, 0, 1.52 + bob, lean * 0.62);
  for (let side = 0; side < 2; side++) {
    const sx = side ? -1 : 1;
    const p = ph + side * Math.PI;
    // legs
    const swing = c.held ? Math.sin(c.t * 9 + side) * 0.5 : c.air ? 0.5 - side * 0.9 : Math.sin(p) * 0.75 * s;
    const bend = c.held ? 0.4 : c.air ? 0.9 : (0.2 + 0.9 * Math.max(0, Math.cos(p))) * s;
    const hip = L[J.lHip + side]!;
    set(hip, 0.11 * sx, 0.8 + bob, 0);
    const knee = L[J.lKn + side]!;
    set(knee, 0.12 * sx, hip.y - Math.cos(swing) * 0.35, Math.sin(swing) * 0.35);
    const foot = L[J.lFt + side]!;
    set(foot, 0.12 * sx, knee.y - Math.cos(swing - bend) * 0.36, knee.z + Math.sin(swing - bend) * 0.36);
    // arms
    const sh = L[J.lSh + side]!;
    set(sh, 0.24 * sx, 1.24 + bob, lean * 0.4);
    const el = L[J.lEl + side]!;
    const ha = L[J.lHa + side]!;
    if (c.carry) {
      set(el, 0.26 * sx, sh.y + 0.24, sh.z + 0.08);
      set(ha, 0.2 * sx, sh.y + 0.46, sh.z + 0.12);
    } else if (c.punch >= 0 && c.punchSide === side) {
      const k = Math.sin(Math.PI * Math.min(1, c.punch)); // out and back
      set(ha, 0.2 * sx, sh.y + 0.02 * k - 0.48 * (1 - k), sh.z + 0.56 * k + 0.04 * (1 - k));
      set(el, 0.3 * sx, (sh.y + ha.y) / 2 - 0.04, (sh.z + ha.z) / 2);
    } else {
      const a = c.held ? Math.sin(c.t * 8 + side) * 0.8 + 1.2 : -Math.sin(p) * 0.7 * s;
      const eb = 0.4 + 0.5 * s;
      set(el, 0.27 * sx, sh.y - Math.cos(a) * 0.26, sh.z + Math.sin(a) * 0.26);
      set(ha, 0.28 * sx, el.y - Math.cos(a + eb) * 0.24, el.z + Math.sin(a + eb) * 0.24);
    }
  }
  // local → world: tip over backwards when down, turn by yaw, then move to the character's feet
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  const tip = c.down * (Math.PI / 2);
  const ct = Math.cos(tip);
  const st = Math.sin(tip);
  for (let j = 0; j < NJ; j++) {
    const p = L[j]!;
    p.x *= SCALE;
    p.y *= SCALE;
    p.z *= SCALE;
    if (tip > 0) {
      const y = p.y * ct + p.z * st + 0.136 * SCALE * c.down;
      p.z = -p.y * st + p.z * ct + 0.68 * SCALE * c.down;
      p.y = y;
    }
    const x = p.x * cs + p.z * sn;
    const z = -p.x * sn + p.z * cs;
    p.x = c.x + x;
    p.y = c.y + p.y;
    p.z = c.z + z;
  }
}

function set(p: V3, x: number, y: number, z: number) {
  p.x = x;
  p.y = y;
  p.z = z;
}

/**
 * Each part's world matrix (column-major, three.js order) from the joints, into `out` at `base` (16 per part).
 * The part's y axis runs along its bone; its x axis stays close to the body's side (the line through the shoulders,
 * so a tumbling ragdoll turns its parts with it). The bottom row is left alone: the view keeps each part's tint there.
 */
export function partMatrices(joints: V3[], yaw: number, parts: PartDef[], out: Float32Array, base: number) {
  const ls = joints[J.lSh]!;
  const rs = joints[J.rSh]!;
  const nk = joints[J.neck]!;
  const pv = joints[J.pelvis]!;
  let rx = ls.x - rs.x, ry = ls.y - rs.y, rz = ls.z - rs.z;
  const rl = Math.hypot(rx, ry, rz);
  if (rl > 1e-3) {
    rx /= rl;
    ry /= rl;
    rz /= rl;
  } else {
    rx = Math.cos(yaw);
    ry = 0;
    rz = -Math.sin(yaw);
  }
  // forward = side × spine
  let ux = nk.x - pv.x, uy = nk.y - pv.y, uz = nk.z - pv.z;
  const ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  let fx = ry * uz - rz * uy, fy = rz * ux - rx * uz, fz = rx * uy - ry * ux;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  for (let i = 0; i < parts.length; i++) {
    const d = parts[i]!;
    let yx = 0, yy = 1, yz = 0;
    if (d.a < 0) {
      // toes: upright along the spine
      yx = ux;
      yy = uy;
      yz = uz;
    } else {
      const a = joints[d.a]!;
      const b = joints[d.b]!;
      yx = b.x - a.x;
      yy = b.y - a.y;
      yz = b.z - a.z;
      const l = Math.hypot(yx, yy, yz) || 1;
      yx /= l;
      yy /= l;
      yz /= l;
    }
    // x: the body's side, without its part along y
    const dot = rx * yx + ry * yy + rz * yz;
    let xx = rx - dot * yx, xy = ry - dot * yy, xz = rz - dot * yz;
    let xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-3) {
      const d2 = fx * yx + fy * yy + fz * yz;
      xx = fx - d2 * yx;
      xy = fy - d2 * yy;
      xz = fz - d2 * yz;
      xl = Math.hypot(xx, xy, xz) || 1;
    }
    xx /= xl;
    xy /= xl;
    xz /= xl;
    // z = x × y
    const zx = xy * yz - xz * yy;
    const zy = xz * yx - xx * yz;
    const zz = xx * yy - xy * yx;
    let px: number, py: number, pz: number;
    if (d.at >= 0) {
      const p = joints[d.at]!;
      const fw = (d.fwd ?? 0) * SCALE;
      px = p.x + fx * fw;
      py = p.y + fy * fw;
      pz = p.z + fz * fw;
    } else {
      const a = joints[d.a]!;
      const b = joints[d.b]!;
      px = (a.x + b.x) / 2;
      py = (a.y + b.y) / 2;
      pz = (a.z + b.z) / 2;
    }
    const o = base + i * 16;
    const k = SCALE * (d.grow ?? 1);
    out[o] = xx * k;
    out[o + 1] = xy * k;
    out[o + 2] = xz * k;
    out[o + 4] = yx * k;
    out[o + 5] = yy * k;
    out[o + 6] = yz * k;
    out[o + 8] = zx * k;
    out[o + 9] = zy * k;
    out[o + 10] = zz * k;
    out[o + 12] = px;
    out[o + 13] = py;
    out[o + 14] = pz;
    out[o + 15] = 1;
  }
}
