// Convex polygon collisions, after Hammerfight's model (HAMMERFIGHT_PHYSICS.md → Collisions):
// SAT contact with up to 2 points, a swept test for fast bodies, push-apart of half the overlap (moving pos and prev
// so no velocity is added), then an impulse with restitution and friction written back into the Verlet state.

import type { Body, ContactReport } from "./engine.ts";

interface Poly {
  xs: Float64Array;
  ys: Float64Array;
  n: number;
}

const MAXV = 16;
const polyA: Poly = { xs: new Float64Array(MAXV), ys: new Float64Array(MAXV), n: 0 };
const polyB: Poly = { xs: new Float64Array(MAXV), ys: new Float64Array(MAXV), n: 0 };

function pose(b: Body, x: number, y: number, a: number, out: Poly): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  for (let i = 0; i < b.count; i++) {
    const lx = b.lx[i]!;
    const ly = b.ly[i]!;
    out.xs[i] = x + lx * c - ly * s;
    out.ys[i] = y + lx * s + ly * c;
  }
  out.n = b.count;
}

interface Sep {
  sep: number;
  edge: number;
}

/** Largest separation of B from any edge of A (positive = a gap). */
function maxSeparation(A: Poly, B: Poly): Sep {
  let best = -Infinity;
  let edge = 0;
  for (let i = 0; i < A.n; i++) {
    const j = (i + 1) % A.n;
    const ex = A.xs[j]! - A.xs[i]!;
    const ey = A.ys[j]! - A.ys[i]!;
    const el = Math.hypot(ex, ey) || 1;
    const nx = ey / el;
    const ny = -ex / el;
    let min = Infinity;
    for (let k = 0; k < B.n; k++) {
      const d = (B.xs[k]! - A.xs[i]!) * nx + (B.ys[k]! - A.ys[i]!) * ny;
      if (d < min) min = d;
    }
    if (min > best) {
      best = min;
      edge = i;
    }
  }
  return { sep: best, edge };
}

interface Manifold {
  /** Normal from A to B. */
  nx: number;
  ny: number;
  count: number;
  px: [number, number];
  py: [number, number];
  depth: [number, number];
}

const manifold: Manifold = { nx: 0, ny: 0, count: 0, px: [0, 0], py: [0, 0], depth: [0, 0] };

function sat(A: Poly, B: Poly): Manifold | null {
  const sa = maxSeparation(A, B);
  if (sa.sep > 0) return null;
  const sb = maxSeparation(B, A);
  if (sb.sep > 0) return null;
  const flip = sb.sep > sa.sep + 0.05;
  const ref = flip ? B : A;
  const inc = flip ? A : B;
  const ri = flip ? sb.edge : sa.edge;
  const rj = (ri + 1) % ref.n;
  const v1x = ref.xs[ri]!;
  const v1y = ref.ys[ri]!;
  const v2x = ref.xs[rj]!;
  const v2y = ref.ys[rj]!;
  const tl = Math.hypot(v2x - v1x, v2y - v1y) || 1;
  const tx = (v2x - v1x) / tl;
  const ty = (v2y - v1y) / tl;
  const nx = ty;
  const ny = -tx;

  // Incident edge: the one whose normal faces most against the reference normal.
  let ie = 0;
  let minDot = Infinity;
  for (let i = 0; i < inc.n; i++) {
    const j = (i + 1) % inc.n;
    const ex = inc.xs[j]! - inc.xs[i]!;
    const ey = inc.ys[j]! - inc.ys[i]!;
    const el = Math.hypot(ex, ey) || 1;
    const d = (ey / el) * nx + (-ex / el) * ny;
    if (d < minDot) {
      minDot = d;
      ie = i;
    }
  }
  const je = (ie + 1) % inc.n;
  let p0x = inc.xs[ie]!;
  let p0y = inc.ys[ie]!;
  let p1x = inc.xs[je]!;
  let p1y = inc.ys[je]!;

  // Clip the incident edge to the reference edge's side planes.
  const clip = (ox: number, oy: number, dirx: number, diry: number): boolean => {
    const d0 = (p0x - ox) * dirx + (p0y - oy) * diry;
    const d1 = (p1x - ox) * dirx + (p1y - oy) * diry;
    if (d0 < 0 && d1 < 0) return false;
    if (d0 < 0) {
      const t = d0 / (d0 - d1);
      p0x += (p1x - p0x) * t;
      p0y += (p1y - p0y) * t;
    } else if (d1 < 0) {
      const t = d1 / (d1 - d0);
      p1x += (p0x - p1x) * t;
      p1y += (p0y - p1y) * t;
    }
    return true;
  };
  if (!clip(v1x, v1y, tx, ty)) return null;
  if (!clip(v2x, v2y, -tx, -ty)) return null;

  let count = 0;
  for (const [x, y] of [
    [p0x, p0y],
    [p1x, p1y],
  ] as const) {
    const s = (x - v1x) * nx + (y - v1y) * ny;
    if (s <= 0.25) {
      manifold.px[count] = x;
      manifold.py[count] = y;
      manifold.depth[count] = Math.max(0, -s);
      count++;
    }
  }
  if (!count) return null;
  manifold.count = count;
  manifold.nx = flip ? -nx : nx;
  manifold.ny = flip ? -ny : ny;
  return manifold;
}

const lerpAngle = (a0: number, a1: number, t: number) => {
  let d = a1 - a0;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a0 + d * t;
};

export function collideAll(bodies: Body[], dt: number, onContact?: (c: ContactReport) => void): void {
  const n = bodies.length;
  for (let i = 0; i < n; i++) {
    const A = bodies[i]!;
    for (let j = i + 1; j < n; j++) {
      const B = bodies[j]!;
      if (A.group >= 0 && A.group === B.group) continue;
      if (A.team >= 0 && A.team === B.team) continue;
      if (A.invMass === 0 && B.invMass === 0) continue;

      // Relative sweep this step.
      const mx = A.x - A.rx - (B.x - B.rx);
      const my = A.y - A.ry - (B.y - B.ry);
      const sweep = Math.hypot(mx, my) + Math.abs(A.a - A.ra) * A.radius + Math.abs(B.a - B.ra) * B.radius;
      const reach = A.radius + B.radius + sweep;
      const dEnd = Math.hypot(A.x - B.x, A.y - B.y);
      if (dEnd > reach) continue;

      const size = Math.max(2, Math.min(A.inner, B.inner));
      const steps = Math.min(8, Math.max(1, Math.ceil(sweep / size)));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const ax = A.rx + (A.x - A.rx) * t;
        const ay = A.ry + (A.y - A.ry) * t;
        const aa = lerpAngle(A.ra, A.a, t);
        const bx = B.rx + (B.x - B.rx) * t;
        const by = B.ry + (B.y - B.ry) * t;
        const ba = lerpAngle(B.ra, B.a, t);
        pose(A, ax, ay, aa, polyA);
        pose(B, bx, by, ba, polyB);
        const m = sat(polyA, polyB);
        if (!m) continue;
        if (t < 1) {
          // Tunnelling: put both bodies back where they first touched, keeping their velocities.
          rewind(A, ax, ay, aa, dt);
          rewind(B, bx, by, ba, dt);
        }
        resolve(A, B, m, dt, onContact);
        break;
      }
    }
  }
}

function rewind(b: Body, x: number, y: number, a: number, dt: number): void {
  if (b.invMass === 0) return;
  b.x = x;
  b.y = y;
  b.a = a;
  b.px = x - b.vx * dt;
  b.py = y - b.vy * dt;
  b.pa = a - b.w * dt;
}

function resolve(A: Body, B: Body, m: Manifold, dt: number, onContact?: (c: ContactReport) => void): void {
  const { nx, ny } = m;
  const imA = A.invMass;
  const imB = B.invMass;
  const iiA = A.invI;
  const iiB = B.invI;
  const imSum = imA + imB;

  // Push apart by half the overlap, moving prev too, so no velocity is added.
  let depth = 0;
  for (let k = 0; k < m.count; k++) depth = Math.max(depth, m.depth[k]!);
  if (depth > 0 && imSum > 0) {
    const c = depth * 0.5;
    const ka = (c * imA) / imSum;
    const kb = (c * imB) / imSum;
    A.x -= nx * ka;
    A.y -= ny * ka;
    A.px -= nx * ka;
    A.py -= ny * ka;
    B.x += nx * kb;
    B.y += ny * kb;
    B.px += nx * kb;
    B.py += ny * kb;
  }

  const e = (A.cor + B.cor) / 2;
  const mu = (A.cof + B.cof) / 2;
  let total = 0;
  for (let k = 0; k < m.count; k++) {
    const cx = m.px[k]!;
    const cy = m.py[k]!;
    const rax = cx - A.x;
    const ray = cy - A.y;
    const rbx = cx - B.x;
    const rby = cy - B.y;
    const vax = A.vx - A.w * ray;
    const vay = A.vy + A.w * rax;
    const vbx = B.vx - B.w * rby;
    const vby = B.vy + B.w * rbx;
    const rvx = vbx - vax;
    const rvy = vby - vay;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) continue;
    const ran = rax * ny - ray * nx;
    const rbn = rbx * ny - rby * nx;
    const kn = imSum + iiA * ran * ran + iiB * rbn * rbn;
    if (kn <= 0) continue;
    const jn = (-(1 + e) * vn) / kn;

    // Friction: up to μ·jn against the sliding direction, but never more than stops the sliding.
    let tx = rvx - nx * vn;
    let ty = rvy - ny * vn;
    const vt = Math.hypot(tx, ty);
    let jt = 0;
    if (vt > 1e-6) {
      tx /= vt;
      ty /= vt;
      const rat = rax * ty - ray * tx;
      const rbt = rbx * ty - rby * tx;
      const kt = imSum + iiA * rat * rat + iiB * rbt * rbt;
      jt = -Math.min(mu * jn, vt / kt);
    } else {
      tx = ty = 0;
    }

    const Px = nx * jn + tx * jt;
    const Py = ny * jn + ty * jt;
    A.vx -= Px * imA;
    A.vy -= Py * imA;
    A.w -= (rax * Py - ray * Px) * iiA;
    B.vx += Px * imB;
    B.vy += Py * imB;
    B.w += (rbx * Py - rby * Px) * iiB;
    total += Math.hypot(Px, Py);
  }

  for (const b of [A, B]) {
    if (b.invMass === 0) continue;
    b.px = b.x - b.vx * dt;
    b.py = b.y - b.vy * dt;
    b.pa = b.a - b.w * dt;
  }

  if (onContact) onContact({ a: A, b: B, impulse: total, nx, ny, x: m.px[0]!, y: m.py[0]! });
}
