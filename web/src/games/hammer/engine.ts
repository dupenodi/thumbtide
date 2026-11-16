// A small 2D rigid-body engine that behaves like Hammerfight's (see HAMMERFIGHT_PHYSICS.md):
// time-corrected Verlet integration, joints solved by moving positions only (so every correction becomes velocity),
// and convex-polygon collisions with an impulse response (collide.ts).
//
// Units: px, s. Mass = polygon area × density. Rotation: world = R(a)·local + pos, R(a) = [cos −sin; sin cos].

import { collideAll } from "./collide.ts";

export class Body {
  /** Local convex polygon, counter-clockwise (positive signed area), as x,y pairs. */
  readonly lx: Float64Array;
  readonly ly: Float64Array;
  readonly count: number;
  /** Farthest vertex from the origin, and nearest edge to it: for broadphase and sweep sizing. */
  readonly radius: number;
  readonly inner: number;
  readonly mass: number;
  readonly invMass: number;
  readonly invI: number;

  x = 0;
  y = 0;
  a = 0;
  /** Previous position and angle (Verlet). */
  px = 0;
  py = 0;
  pa = 0;
  /** Velocity, derived from the Verlet state after joints. */
  vx = 0;
  vy = 0;
  w = 0;
  fx = 0;
  fy = 0;
  torque = 0;

  cor = 0.3;
  cof = 0.2;
  gravity = true;
  /** Spin damping coefficient: torque −= spinDamp · ω. */
  spinDamp = 300000;
  /** Bodies with the same group never collide. */
  group = -1;
  /** False: the body collides with nothing (Hammerfight m_layer 0: chain links, mace hands and handles). */
  solid = true;
  /** Bodies with the same team (>= 0) never collide either; the game sets it only when teammates should pass through. */
  team = -1;
  dead = false;
  data: unknown = null;

  /** Pose at the start of the last step, for render interpolation and the sweep test. */
  rx = 0;
  ry = 0;
  ra = 0;

  /** Per-pass joint angle accumulation. */
  angSum = 0;
  angCnt = 0;
  /** Marks a body already listed for this step's joint passes (World.step). */
  inPass = false;

  constructor(verts: number[], density: number) {
    let n = verts.length / 2;
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(verts[2 * i]!);
      ys.push(verts[2 * i + 1]!);
    }
    let signed = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      signed += xs[i]! * ys[j]! - xs[j]! * ys[i]!;
    }
    if (signed < 0) {
      xs.reverse();
      ys.reverse();
    }
    this.lx = Float64Array.from(xs);
    this.ly = Float64Array.from(ys);
    this.count = n;

    // Mass and inertia about the body origin, as Hammerfight computes them (triangle fan from the origin).
    let sumC = 0;
    let sumI = 0;
    let r = 0;
    let inner = Infinity;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = xs[i]!;
      const ay = ys[i]!;
      const bx = xs[j]!;
      const by = ys[j]!;
      const c = Math.abs(ax * by - bx * ay);
      sumC += c;
      sumI += c * (ax * ax + ay * ay + ax * bx + ay * by + bx * bx + by * by);
      r = Math.max(r, Math.hypot(ax, ay));
      const el = Math.hypot(bx - ax, by - ay) || 1;
      inner = Math.min(inner, c / el);
    }
    n = 0;
    this.mass = 0.5 * sumC * density;
    this.invMass = this.mass > 1e-4 ? 1 / this.mass : 0;
    const inertia = sumC > 0 ? (this.mass / 6) * (sumI / sumC) : 0;
    this.invI = inertia > 0 ? 1 / inertia : 0;
    this.radius = r;
    this.inner = inner;
  }

  place(x: number, y: number, a = 0): this {
    this.x = this.px = this.rx = x;
    this.y = this.py = this.ry = y;
    this.a = this.pa = this.ra = a;
    this.vx = this.vy = this.w = 0;
    return this;
  }

  /** Set the velocity by moving the previous pose (Verlet). */
  setVelocity(vx: number, vy: number, w: number, dt: number): void {
    this.vx = vx;
    this.vy = vy;
    this.w = w;
    this.px = this.x - vx * dt;
    this.py = this.y - vy * dt;
    this.pa = this.a - w * dt;
  }

  worldPoint(lx: number, ly: number): [number, number] {
    const c = Math.cos(this.a);
    const s = Math.sin(this.a);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }

  applyForce(fx: number, fy: number): void {
    this.fx += fx;
    this.fy += fy;
  }
}

export const enum JointType {
  Rope = 1,
  /** B turns so that its local (−radius, shiftB.y) points at A. */
  Aim = 2,
  /** Each side turns its shift direction gently toward the other anchor. */
  SoftAlign = 4,
}

export interface Joint {
  a: Body;
  b: Body;
  type: number;
  radius: number;
  sax: number;
  say: number;
  sbx: number;
  sby: number;
  strength: number;
  /** Last pass index in which this joint is solved (Hammerfight's m_necess). */
  necess: number;
}

export function joint(a: Body, b: Body, type: number, radius: number, o: Partial<Joint> = {}): Joint {
  return { a, b, type, radius, sax: 0, say: 0, sbx: 0, sby: 0, strength: 1, necess: 5, ...o };
}

export interface StepOptions {
  dt: number;
  dtPrev: number;
  gravity: number;
  passes: number;
  /** Called after integration and joints, with velocities up to date, before collisions. */
  onContact?: (c: ContactReport) => void;
}

export interface ContactReport {
  a: Body;
  b: Body;
  /** Total impulse applied, mass·px/s. */
  impulse: number;
  /** Closing speed along the normal at the contact, before the impulse (px/s). */
  approach: number;
  /** Relative speed at that contact point, before the impulse (px/s). */
  rel: number;
  nx: number;
  ny: number;
  x: number;
  y: number;
}

const wrapPi = (v: number) => {
  v = (v + Math.PI) % (2 * Math.PI);
  if (v < 0) v += 2 * Math.PI;
  return v - Math.PI;
};
export { wrapPi };

export class World {
  bodies: Body[] = [];
  joints: Joint[] = [];
  /** The bodies on a joint, gathered each step (reused, so no allocation). */
  private readonly jointed: Body[] = [];

  add(b: Body): Body {
    this.bodies.push(b);
    return b;
  }

  remove(b: Body): void {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    this.joints = this.joints.filter((j) => j.a !== b && j.b !== b);
  }

  removeJoint(j: Joint): void {
    const i = this.joints.indexOf(j);
    if (i >= 0) this.joints.splice(i, 1);
  }

  /** Common forces for every body: gravity and spin damping. Game forces are added before step(). */
  commonForces(gravity: number): void {
    for (const b of this.bodies) {
      if (b.gravity) b.fy += gravity * b.mass;
      b.torque -= b.spinDamp * b.w;
    }
  }

  step(o: StepOptions): void {
    const { dt } = o;
    const r = o.dtPrev > 0 ? dt / o.dtPrev : 1;
    const dt2 = dt * dt;

    // 2. Integrate (time-corrected Verlet).
    for (const b of this.bodies) {
      b.rx = b.x;
      b.ry = b.y;
      b.ra = b.a;
      if (b.invMass === 0) continue;
      const nx = b.x + (b.x - b.px) * r + b.fx * b.invMass * dt2;
      const ny = b.y + (b.y - b.py) * r + b.fy * b.invMass * dt2;
      b.px = b.x;
      b.py = b.y;
      b.x = nx;
      b.y = ny;
      const da = wrapPi(b.a - b.pa);
      const alpha = Math.max(-10, Math.min(10, b.torque * b.invI));
      b.pa = b.a;
      b.a = b.a + da * r + alpha * dt2;
      b.fx = b.fy = b.torque = 0;
    }

    // 3. Joints: positions only; angles averaged per body after each pass.
    // Only bodies on a joint collect angle corrections, so only they are visited after each pass.
    const jointed = this.jointed;
    jointed.length = 0;
    for (const j of this.joints) {
      if (!j.a.inPass) {
        j.a.inPass = true;
        jointed.push(j.a);
      }
      if (!j.b.inPass) {
        j.b.inPass = true;
        jointed.push(j.b);
      }
    }
    for (let pass = 0; pass < o.passes; pass++) {
      let any = false;
      for (const j of this.joints) {
        if (pass > j.necess) continue;
        any = true;
        solveJoint(j);
      }
      if (!any) break;
      for (const b of jointed) {
        if (b.angCnt > 0) {
          b.a += b.angSum / b.angCnt;
          b.angSum = 0;
          b.angCnt = 0;
        }
      }
    }
    for (const b of jointed) b.inPass = false;

    // 4. Velocities from the Verlet state.
    for (const b of this.bodies) {
      b.vx = (b.x - b.px) / dt;
      b.vy = (b.y - b.py) / dt;
      b.w = wrapPi(b.a - b.pa) / dt;
    }

    // 5. Collisions.
    collideAll(this.bodies, dt, o.onContact);
  }
}

function signedAngle(ux: number, uy: number, tx: number, ty: number): number {
  return Math.atan2(ux * ty - uy * tx, ux * tx + uy * ty);
}

function solveJoint(j: Joint): void {
  const A = j.a;
  const B = j.b;
  if (A.invMass === 0 && B.invMass === 0) return;
  let wA: number;
  let wB: number;
  if (A.invMass === 0) {
    wA = 0;
    wB = 1;
  } else if (B.invMass === 0) {
    wA = 1;
    wB = 0;
  } else {
    wA = B.mass / (A.mass + B.mass);
    wB = A.mass / (A.mass + B.mass);
  }

  // the anchors in world space, inline (worldPoint returns a new array; this runs up to 30 times a step per joint),
  // and each body's cos/sin once for the anchors and the angle terms below (the angles don't change in here)
  const cA = Math.cos(A.a);
  const sA = Math.sin(A.a);
  const cB = Math.cos(B.a);
  const sB = Math.sin(B.a);
  const ax = A.x + j.sax * cA - j.say * sA;
  const ay = A.y + j.sax * sA + j.say * cA;
  const bx = B.x + j.sbx * cB - j.sby * sB;
  const by = B.y + j.sbx * sB + j.sby * cB;
  const dx = bx - ax;
  const dy = by - ay;
  let len = Math.hypot(dx, dy);
  if (len === 0) len = 0.01;
  const nx = dx / len;
  const ny = dy / len;

  const rope = (j.type & JointType.Rope) !== 0;
  let f = 1;
  if (rope) {
    f = Math.max(0, Math.min(1, len - j.radius + 1));
    if (f === 0) return;
  }

  let dA = 0;
  let dB = 0;
  if (j.type & JointType.Aim) {
    // B's local (−radius, sby) must point from B toward A, i.e. along −n.
    const c = cB;
    const s = sB;
    const lx = -j.radius;
    const ly = j.sby;
    dB = wrapPi(signedAngle(lx * c - ly * s, lx * s + ly * c, -nx, -ny));
  } else if (j.type & JointType.SoftAlign) {
    if (A.invMass > 0 && (j.sax || j.say)) {
      const c = cA;
      const s = sA;
      const t = wrapPi(signedAngle(j.sax * c - j.say * s, j.sax * s + j.say * c, nx, ny));
      dA = Math.max(-0.02, Math.min(0.02, 0.3 * f * wA * t));
    }
    if (B.invMass > 0 && (j.sbx || j.sby)) {
      const c = cB;
      const s = sB;
      const t = wrapPi(signedAngle(j.sbx * c - j.sby * s, j.sbx * s + j.sby * c, -nx, -ny));
      dB = Math.max(-0.02, Math.min(0.02, 0.3 * f * wB * t));
    }
  }

  if (!rope || len > j.radius) {
    const k = (1 - j.radius / len) * j.strength * f;
    A.x += dx * k * wA;
    A.y += dy * k * wA;
    B.x -= dx * k * wB;
    B.y -= dy * k * wB;
  }

  A.angSum += dA;
  A.angCnt++;
  B.angSum += dB;
  B.angCnt++;
}
