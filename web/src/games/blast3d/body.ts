// Proxy body for the Blast 3D performance spike: plain capsules, boxes and spheres in the layout of a BombSquad
// "spaz" (Ballistica's spazappearance.py lists 9 meshes: head, torso, pelvis, upper arm, forearm, hand, upper leg,
// lower leg, toes; arms and legs are mirrored, so a full body is 15 parts). No BombSquad art is drawn here.
// Plain TypeScript (no three.js): the simulation uses it too.

export interface V3 {
  x: number;
  y: number;
  z: number;
}
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });

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
  { kind: "head", shape: "sphere", size: [0.2], a: J.neck, b: J.head, at: J.head },
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

/** A reduced body (the fallback arm): head, torso, one piece per arm and leg. */
export const PARTS6: PartDef[] = [
  PARTS15[0]!,
  PARTS15[1]!,
  seg("arm", 0.075, J.lSh, J.lHa),
  seg("arm", 0.075, J.rSh, J.rHa),
  seg("leg", 0.09, J.lHip, J.lFt),
  seg("leg", 0.09, J.rHip, J.rFt),
];

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
    const swing = c.held ? Math.sin(c.t * 9 + side) * 0.5 : Math.sin(p) * 0.75 * s;
    const bend = c.held ? 0.4 : (0.2 + 0.9 * Math.max(0, Math.cos(p))) * s;
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
  // local → world: turn by yaw, then move to the character's feet
  const cs = Math.cos(c.yaw);
  const sn = Math.sin(c.yaw);
  for (let j = 0; j < NJ; j++) {
    const p = L[j]!;
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
 * The part's y axis runs along its bone; its x axis stays close to the body's side.
 */
export function partMatrices(joints: V3[], yaw: number, parts: PartDef[], out: Float32Array, base: number) {
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  for (let i = 0; i < parts.length; i++) {
    const d = parts[i]!;
    let yx = 0, yy = 1, yz = 0;
    if (d.a >= 0) {
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
    const dot = rx * yx + rz * yz;
    let xx = rx - dot * yx, xy = -dot * yy, xz = rz - dot * yz;
    let xl = Math.hypot(xx, xy, xz);
    if (xl < 1e-4) {
      const d2 = fx * yx + fz * yz;
      xx = fx - d2 * yx;
      xy = -d2 * yy;
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
      px = p.x + fx * (d.fwd ?? 0);
      py = p.y;
      pz = p.z + fz * (d.fwd ?? 0);
    } else {
      const a = joints[d.a]!;
      const b = joints[d.b]!;
      px = (a.x + b.x) / 2;
      py = (a.y + b.y) / 2;
      pz = (a.z + b.z) / 2;
    }
    const o = base + i * 16;
    out[o] = xx;
    out[o + 1] = xy;
    out[o + 2] = xz;
    out[o + 3] = 0;
    out[o + 4] = yx;
    out[o + 5] = yy;
    out[o + 6] = yz;
    out[o + 7] = 0;
    out[o + 8] = zx;
    out[o + 9] = zy;
    out[o + 10] = zz;
    out[o + 11] = 0;
    out[o + 12] = px;
    out[o + 13] = py;
    out[o + 14] = pz;
    out[o + 15] = 1;
  }
}
