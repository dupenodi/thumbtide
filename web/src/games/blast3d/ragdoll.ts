// The fighters' bodies as drawn: the animated pose while a fighter is on its feet, and a ragdoll (15 particles and
// distance constraints, position-based dynamics: the solver measured on the TV in the spike) while it is knocked
// out, carried, thrown or dead. The ragdoll is only a picture: the rules move the fighter (a capsule), the body
// follows it loosely and flops. Nothing here feeds back into the rules. Plain TypeScript, no three.js.
import { J, NJ, pose, REST, SCALE, v3, type Poser, type V3 } from "./body.ts";
import { ARENA, GRAVITY, STEP } from "./rules.ts";

/** Bones, plus braces that keep the trunk rigid. */
const LINKS: [number, number][] = [
  [J.head, J.neck], [J.neck, J.pelvis], [J.neck, J.lSh], [J.neck, J.rSh], [J.lSh, J.rSh],
  [J.lSh, J.lEl], [J.lEl, J.lHa], [J.rSh, J.rEl], [J.rEl, J.rHa],
  [J.pelvis, J.lHip], [J.pelvis, J.rHip], [J.lHip, J.rHip],
  [J.lHip, J.lKn], [J.lKn, J.lFt], [J.rHip, J.rKn], [J.rKn, J.rFt],
  [J.lSh, J.pelvis], [J.rSh, J.pelvis], [J.lSh, J.lHip], [J.rSh, J.rHip], [J.lSh, J.rHip], [J.rSh, J.lHip],
  [J.head, J.lSh], [J.head, J.rSh],
];
const REST_LEN = LINKS.map(([a, b]) => Math.hypot(REST[a]!.x - REST[b]!.x, REST[a]!.y - REST[b]!.y, REST[a]!.z - REST[b]!.z) * SCALE);
const PR = 0.11 * SCALE; // particle radius
const ITERS = 4;
/** How hard each joint is pulled to the pose while limp: the trunk follows the capsule, the limbs hang. */
const TRUNK = new Set<number>([J.pelvis, J.neck, J.lSh, J.rSh, J.lHip, J.rHip]);

export class Body implements Poser {
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  phase = 0;
  speed = 0;
  punch = -1;
  punchSide = 0;
  held = false;
  carry = false;
  t = 0;
  down = 0;
  air = false;
  /** Shown at all this frame. */
  on = false;
  /** The ragdoll runs (limp, or just back on its feet). */
  rag = false;
  /** 0 limp … 1 its muscles hold the pose. */
  muscle = 1;
  /** Seconds since it was last limp. */
  calm = 9;
  /** The joints to draw. */
  readonly joints: V3[] = REST.map(() => v3());
  readonly p: V3[] = REST.map(() => v3());
  readonly q: V3[] = REST.map(() => v3());
  readonly target: V3[] = REST.map(() => v3());

  /** Put the particles on the pose (a spawn, or the ragdoll taking over), keeping the body's velocity. */
  snap(vx = 0, vy = 0, vz = 0) {
    pose(this, this.target);
    for (let j = 0; j < NJ; j++) {
      const t = this.target[j]!;
      const p = this.p[j]!;
      const q = this.q[j]!;
      p.x = t.x;
      p.y = t.y;
      p.z = t.z;
      q.x = t.x - vx * STEP;
      q.y = t.y - vy * STEP;
      q.z = t.z - vz * STEP;
    }
  }

  /** A hit: add a velocity to the particles, not all alike, so the body tumbles. */
  kick(vx: number, vy: number, vz: number) {
    for (let j = 0; j < NJ; j++) {
      const q = this.q[j]!;
      const s = 0.6 + (0.4 * ((j * 7) % 5)) / 4;
      q.x -= vx * STEP * s;
      q.y -= vy * STEP * s;
      q.z -= vz * STEP * s;
    }
  }
}

function collide(p: V3, q: V3) {
  if (p.y < PR && p.y > -0.6 && Math.abs(p.x) < ARENA.hx && Math.abs(p.z) < ARENA.hz) {
    p.y = PR;
    // friction: lose most of the sideways motion on the ground
    q.x = p.x - (p.x - q.x) * 0.5;
    q.z = p.z - (p.z - q.z) * 0.5;
  }
  for (const b of ARENA.blocks) {
    if (p.y > b.h + PR) continue;
    const hw = b.w / 2 + PR;
    const hd = b.d / 2 + PR;
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
    const top = b.h + PR - p.y;
    const sx = hw - Math.abs(dx);
    const sz = hd - Math.abs(dz);
    if (top < sx && top < sz) p.y = b.h + PR;
    else if (sx < sz) p.x = b.x + Math.sign(dx) * hw;
    else p.z = b.z + Math.sign(dz) * hd;
  }
}

/** One 60 Hz step of every body that is a ragdoll now. */
export function stepBodies(bodies: Body[]) {
  const g = GRAVITY * STEP * STEP;
  for (const c of bodies) {
    if (!c.on || !c.rag) continue;
    pose(c, c.target);
    const P = c.p;
    const Q = c.q;
    const T = c.target;
    const m = c.muscle;
    for (let j = 0; j < NJ; j++) {
      const p = P[j]!;
      const q = Q[j]!;
      const vx = (p.x - q.x) * 0.985;
      const vy = (p.y - q.y) * 0.985;
      const vz = (p.z - q.z) * 0.985;
      q.x = p.x;
      q.y = p.y;
      q.z = p.z;
      p.x += vx;
      p.y += vy - g * (1 - m);
      p.z += vz;
      const k = m * 0.4 + (1 - m) * (c.held ? 0.3 : TRUNK.has(j) ? 0.07 : 0.015);
      const t = T[j]!;
      p.x += (t.x - p.x) * k;
      p.y += (t.y - p.y) * k;
      p.z += (t.z - p.z) * k;
    }
    for (let it = 0; it < ITERS; it++) {
      for (let l = 0; l < LINKS.length; l++) {
        const link = LINKS[l]!;
        const a = P[link[0]]!;
        const b = P[link[1]]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const s = ((d - REST_LEN[l]!) / d) * 0.5;
        a.x += dx * s;
        a.y += dy * s;
        a.z += dz * s;
        b.x -= dx * s;
        b.y -= dy * s;
        b.z -= dz * s;
      }
      if (!c.held) for (let j = 0; j < NJ; j++) collide(P[j]!, Q[j]!);
    }
  }
  contacts(bodies);
}

/** Parts of two ragdolls that are close push each other apart. */
function contacts(bodies: Body[]) {
  const min = PR * 2;
  for (let i = 0; i < bodies.length; i++) {
    const A = bodies[i]!;
    if (!A.on || !A.rag) continue;
    const pa = A.p[J.pelvis]!;
    for (let j = i + 1; j < bodies.length; j++) {
      const B = bodies[j]!;
      if (!B.on || !B.rag) continue;
      const pb = B.p[J.pelvis]!;
      if ((pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2 + (pa.z - pb.z) ** 2 > 2.25) continue;
      for (let u = 0; u < NJ; u++) {
        const a = A.p[u]!;
        for (let v = 0; v < NJ; v++) {
          const b = B.p[v]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 1e-4;
          const s = ((min - d) / d) * 0.5;
          a.x -= dx * s;
          a.y -= dy * s;
          a.z -= dz * s;
          b.x += dx * s;
          b.y += dy * s;
          b.z += dz * s;
        }
      }
    }
  }
}

/** The joints to draw: the ragdoll's particles, or the animated pose. */
export function settle(c: Body) {
  if (c.rag) {
    for (let j = 0; j < NJ; j++) {
      const p = c.p[j]!;
      const o = c.joints[j]!;
      o.x = p.x;
      o.y = p.y;
      o.z = p.z;
    }
  } else pose(c, c.joints);
}
