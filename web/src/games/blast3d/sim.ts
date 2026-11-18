// Fight simulation for the Blast 3D performance spike (not a game: computer fighters only, seeded, fixed 60 Hz step).
// Two physics models, picked by `physics`:
//   capsule: one capsule per fighter (character controller: gravity, ground, boxes, push, knock-back, pick-up and
//            throw as a carried body); the body is animated on top (run cycle, punch).
//   ragdoll: the same controller moves the fighter, and the body is a ragdoll of 15 particles + distance
//            constraints (position-based dynamics, a tiny custom solver), pulled towards the animated pose by
//            "muscles" that go limp when the fighter is stunned. Body parts collide with the ground, the boxes and
//            other fighters' parts.
// Sizes follow Ballistica (MIT): The Pad's play area (~16.6 × 18.5 m area of interest), blast radius 2.0, 1000 hp
// fighters (not modelled), bombs on a fuse.
import { J, NJ, pose, REST, v3, type Poser, type V3 } from "./body.ts";

export const DT = 1 / 60;
const G = 22;
/** Half the platform's width (m). */
export const HALF = 7;
export const BOXES = [
  { x: -3.6, z: -3.4, w: 1.2, h: 1.2 },
  { x: 3.6, z: -3.4, w: 1.2, h: 1.2 },
  { x: -3.6, z: 3.4, w: 1.2, h: 1.2 },
  { x: 3.6, z: 3.4, w: 1.2, h: 1.2 },
];
const BLAST_R = 2;
const PUSH_R = 3; // knock-back reach of a blast
const RADIUS = 0.35;
const RUN = 5.2;

export interface SimOpts {
  chars: number;
  bombs: number;
  ragdoll: boolean;
  iters: number;
  seed: number;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Fighter implements Poser {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  yaw = 0;
  phase = 0;
  speed = 0;
  punch = -1;
  punchSide = 0;
  held = false;
  carry = false;
  t = 0;
  grounded = false;
  stun = 0;
  punchCd = 0;
  bombCd = 0;
  heldBy = -1;
  holding = -1;
  holdT = 0;
  wander: number;
  /** The joints drawn this frame (the animated pose, or the ragdoll's particles). */
  joints: V3[] = REST.map(() => v3());
  /** Ragdoll: particles (now and previous step) and the pose the muscles pull towards. */
  p: V3[] = [];
  q: V3[] = [];
  target: V3[] = [];
  constructor(readonly i: number, r: () => number) {
    this.wander = r() * Math.PI * 2;
    this.bombCd = 1 + r() * 3;
  }
}

export interface Bomb {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  fuse: number;
}
export interface Blast {
  x: number;
  y: number;
  z: number;
  t: number;
}
export interface Debris {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  spin: number;
}
export const MAX_BLASTS = 6;
export const DEBRIS_PER_BLAST = 14;

/** Ragdoll constraints: bones plus braces that keep the trunk rigid. */
const LINKS: [number, number][] = [
  [J.head, J.neck], [J.neck, J.pelvis], [J.neck, J.lSh], [J.neck, J.rSh], [J.lSh, J.rSh],
  [J.lSh, J.lEl], [J.lEl, J.lHa], [J.rSh, J.rEl], [J.rEl, J.rHa],
  [J.pelvis, J.lHip], [J.pelvis, J.rHip], [J.lHip, J.rHip],
  [J.lHip, J.lKn], [J.lKn, J.lFt], [J.rHip, J.rKn], [J.rKn, J.rFt],
  [J.lSh, J.pelvis], [J.rSh, J.pelvis], [J.lSh, J.lHip], [J.rSh, J.rHip], [J.lSh, J.rHip], [J.rSh, J.lHip],
  [J.head, J.lSh], [J.head, J.rSh],
];
const REST_LEN = LINKS.map(([a, b]) => Math.hypot(REST[a]!.x - REST[b]!.x, REST[a]!.y - REST[b]!.y, REST[a]!.z - REST[b]!.z));
const PR = 0.11; // particle radius

export class Sim {
  readonly f: Fighter[] = [];
  readonly bombs: Bomb[] = [];
  readonly blasts: Blast[] = [];
  readonly debris: Debris[] = [];
  t = 0;
  steps = 0;
  private r: () => number;

  constructor(readonly o: SimOpts) {
    this.r = rng(o.seed);
    for (let i = 0; i < o.chars; i++) {
      const c = new Fighter(i, this.r);
      this.spawn(c, (i / o.chars) * Math.PI * 2);
      this.f.push(c);
    }
  }

  private spawn(c: Fighter, angle = this.r() * Math.PI * 2) {
    c.x = Math.cos(angle) * 4;
    c.z = Math.sin(angle) * 4;
    c.y = 2;
    c.vx = c.vy = c.vz = 0;
    c.stun = 0;
    c.heldBy = -1;
    c.yaw = angle + Math.PI;
    pose(c, c.joints);
    if (this.o.ragdoll) {
      c.p = c.joints.map((j) => ({ ...j }));
      c.q = c.joints.map((j) => ({ ...j }));
      c.target = c.joints.map((j) => ({ ...j }));
    }
  }

  step() {
    const dt = DT;
    this.t += dt;
    this.steps++;
    const fs = this.f;
    for (const c of fs) this.think(c, dt);
    for (const c of fs) this.move(c, dt);
    this.separate();
    this.bombStep(dt);
    if (this.o.ragdoll) for (const c of fs) this.ragdoll(c, dt);
    if (this.o.ragdoll) this.bodyContacts();
  }

  /** The computer fighter: run at the nearest rival, punch, throw bombs, pick up the stunned and throw them. */
  private think(c: Fighter, dt: number) {
    c.t += dt;
    c.punchCd -= dt;
    c.bombCd -= dt;
    if (c.stun > 0) c.stun -= dt;
    if (c.punch >= 0) {
      const was = c.punch;
      c.punch += dt / 0.3;
      if (was < 0.5 && c.punch >= 0.5) this.hit(c);
      if (c.punch >= 1) c.punch = -1;
    }
    if (c.heldBy >= 0 || c.stun > 0) return;
    if (c.holding >= 0) {
      c.holdT += dt;
      const h = this.f[c.holding]!;
      if (c.holdT > 0.9 || h.heldBy !== c.i) {
        // throw
        if (h.heldBy === c.i) {
          h.heldBy = -1;
          h.held = false;
          h.vx = Math.sin(c.yaw) * 7;
          h.vz = Math.cos(c.yaw) * 7;
          h.vy = 6;
          h.stun = 0.8;
        }
        c.holding = -1;
        c.carry = false;
      }
    }
    // nearest rival on its feet
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const o of this.f) {
      if (o === c || o.heldBy >= 0) continue;
      const d = (o.x - c.x) ** 2 + (o.z - c.z) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    let wx = 0, wz = 0;
    if (best) {
      const d = Math.sqrt(bd);
      const ax = (best.x - c.x) / (d || 1);
      const az = (best.z - c.z) / (d || 1);
      c.yaw = Math.atan2(ax, az);
      // circle a little rather than walk straight in
      const sw = Math.sin(c.t * 0.7 + c.wander) * 0.6;
      if (d > 1.0) {
        wx = ax * Math.cos(sw) - az * Math.sin(sw);
        wz = az * Math.cos(sw) + ax * Math.sin(sw);
      } else if (c.punchCd <= 0 && c.holding < 0) {
        c.punch = 0;
        c.punchSide = (c.punchSide + 1) % 2;
        c.punchCd = 0.55;
      }
      if (c.holding < 0 && best.stun > 0 && d < 1.1 && this.r() < 0.04) {
        best.heldBy = c.i;
        best.held = true;
        c.holding = best.i;
        c.holdT = 0;
        c.carry = true;
      }
      if (this.bombs.length < this.o.bombs && c.bombCd <= 0) this.throwBomb(c, best);
    }
    // stay on the platform
    const edge = HALF - 1.2;
    if (Math.abs(c.x) > edge) wx -= Math.sign(c.x) * 0.8;
    if (Math.abs(c.z) > edge) wz -= Math.sign(c.z) * 0.8;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) {
      wx /= wl;
      wz /= wl;
    }
    if (c.grounded) {
      const k = Math.min(1, 10 * dt);
      c.vx += (wx * RUN - c.vx) * k;
      c.vz += (wz * RUN - c.vz) * k;
    }
  }

  private hit(c: Fighter) {
    const fx = Math.sin(c.yaw);
    const fz = Math.cos(c.yaw);
    for (const o of this.f) {
      if (o === c || o.heldBy >= 0) continue;
      const dx = o.x - c.x;
      const dz = o.z - c.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.3 || dx * fx + dz * fz < 0.3 * d) continue;
      o.vx += fx * 5;
      o.vz += fz * 5;
      o.vy += 2.5;
      o.stun = Math.max(o.stun, 0.5);
      if (this.o.ragdoll) this.kickBody(o, fx * 5, 2.5, fz * 5);
    }
  }

  private throwBomb(c: Fighter, at: Fighter) {
    const T = 0.9;
    const sx = c.x, sy = c.y + 1.5, sz = c.z;
    // a rival too close for a lob: throw past them instead
    let tx = at.x, tz = at.z;
    if (Math.hypot(tx - sx, tz - sz) < 2.5) {
      tx = sx + Math.sin(c.yaw) * 4;
      tz = sz + Math.cos(c.yaw) * 4;
    }
    this.bombs.push({ x: sx, y: sy, z: sz, vx: (tx - sx) / T, vy: (at.y + 0.2 - sy + 0.5 * G * T * T) / T, vz: (tz - sz) / T, fuse: 1.6 + this.r() * 0.6 });
    c.bombCd = 1 + this.r() * 1.5;
  }

  private onPlatform(x: number, z: number) {
    return Math.abs(x) < HALF && Math.abs(z) < HALF;
  }

  /** The capsule: a carried fighter rides above its carrier's head; the rest fall, land, and slide off boxes. */
  private move(c: Fighter, dt: number) {
    if (c.heldBy >= 0) {
      const h = this.f[c.heldBy]!;
      c.x = h.x + Math.sin(h.yaw) * 0.2;
      c.y = h.y + 1.35;
      c.z = h.z + Math.cos(h.yaw) * 0.2;
      c.vx = h.vx;
      c.vy = 0;
      c.vz = h.vz;
      c.speed = 0;
      return;
    }
    c.vy -= G * dt;
    if (c.stun > 0 && c.grounded) {
      const k = Math.max(0, 1 - 5 * dt);
      c.vx *= k;
      c.vz *= k;
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.grounded = false;
    // The Pad's bumper rail keeps fighters on the platform (and the load steady for the measurement)
    const rail = HALF - RADIUS;
    if (Math.abs(c.x) > rail) {
      c.x = Math.sign(c.x) * rail;
      c.vx *= -0.3;
    }
    if (Math.abs(c.z) > rail) {
      c.z = Math.sign(c.z) * rail;
      c.vz *= -0.3;
    }
    if (this.onPlatform(c.x, c.z) && c.y < 0 && c.y > -0.8) {
      c.y = 0;
      c.vy = 0;
      c.grounded = true;
    }
    for (const b of BOXES) {
      if (c.y > b.h) continue;
      const hw = b.w / 2 + RADIUS;
      const dx = c.x - b.x;
      const dz = c.z - b.z;
      if (Math.abs(dx) < hw && Math.abs(dz) < hw) {
        if (hw - Math.abs(dx) < hw - Math.abs(dz)) {
          c.x = b.x + Math.sign(dx) * hw;
          c.vx = 0;
        } else {
          c.z = b.z + Math.sign(dz) * hw;
          c.vz = 0;
        }
      }
    }
    if (c.y < -10) this.spawn(c);
    const hs = Math.hypot(c.vx, c.vz);
    c.speed = c.grounded && c.stun <= 0 ? Math.min(1, hs / RUN) : 0;
    c.phase += hs * dt * 2.1;
  }

  /** Fighters push each other apart (capsule against capsule). */
  private separate() {
    const fs = this.f;
    const min = RADIUS * 2;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]!;
      if (a.heldBy >= 0) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]!;
        if (b.heldBy >= 0 || Math.abs(a.y - b.y) > 1.6) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
      }
    }
  }

  private bombStep(dt: number) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]!;
      b.vy -= G * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.15 && b.y > -0.5 && this.onPlatform(b.x, b.z)) {
        b.y = 0.15;
        b.vy = Math.abs(b.vy) * 0.4;
        b.vx *= 0.7;
        b.vz *= 0.7;
      }
      b.fuse -= dt;
      if (b.fuse <= 0 || b.y < -6) {
        this.bombs.splice(i, 1);
        if (b.y > -6) this.explode(b.x, b.y, b.z);
      }
    }
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i]!;
      b.t += dt;
      if (b.t > 0.6) this.blasts.splice(i, 1);
    }
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i]!;
      d.vy -= G * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < 0.05 && this.onPlatform(d.x, d.z)) {
        d.y = 0.05;
        d.vy *= -0.3;
        d.vx *= 0.6;
        d.vz *= 0.6;
      }
      d.life -= dt;
      if (d.life <= 0) this.debris.splice(i, 1);
    }
  }

  private explode(x: number, y: number, z: number) {
    if (this.blasts.length >= MAX_BLASTS) this.blasts.shift();
    this.blasts.push({ x, y, z, t: 0 });
    while (this.debris.length > (MAX_BLASTS - 1) * DEBRIS_PER_BLAST) this.debris.shift();
    for (let k = 0; k < DEBRIS_PER_BLAST; k++) {
      const a = this.r() * Math.PI * 2;
      const s = 3 + this.r() * 5;
      this.debris.push({ x, y: y + 0.2, z, vx: Math.cos(a) * s, vy: 4 + this.r() * 6, vz: Math.sin(a) * s, life: 0.8 + this.r() * 0.5, spin: this.r() * 10 });
    }
    for (const c of this.f) {
      if (c.heldBy >= 0) continue;
      const dx = c.x - x;
      const dy = c.y + 0.8 - y;
      const dz = c.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > PUSH_R) continue;
      const k = 1 - d / PUSH_R;
      const n = d || 1;
      const ix = (dx / n) * 12 * k;
      const iz = (dz / n) * 12 * k;
      const iy = 4 + 5 * k;
      c.vx += ix;
      c.vz += iz;
      c.vy += iy;
      c.grounded = false;
      c.stun = Math.max(c.stun, d < BLAST_R ? 1.2 : 0.6);
      if (this.o.ragdoll) this.kickBody(c, ix, iy, iz);
    }
  }

  /** Add a velocity to every ragdoll particle (moves the previous position back). */
  private kickBody(c: Fighter, vx: number, vy: number, vz: number) {
    for (let j = 0; j < NJ; j++) {
      const q = c.q[j]!;
      const s = 0.6 + 0.4 * ((j * 7) % 5) / 4; // not all parts alike, so the body tumbles
      q.x -= vx * DT * s;
      q.y -= vy * DT * s;
      q.z -= vz * DT * s;
    }
  }

  /** One ragdoll step: Verlet particles, muscles towards the animated pose, constraints, contacts. */
  private ragdoll(c: Fighter, dt: number) {
    pose(c, c.target);
    const P = c.p;
    const Q = c.q;
    const T = c.target;
    const k = c.heldBy >= 0 ? 0.35 : c.stun > 0 ? 0.02 : 0.3;
    const g = G * dt * dt;
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
      p.y += vy - g;
      p.z += vz;
      const t = T[j]!;
      p.x += (t.x - p.x) * k;
      p.y += (t.y - p.y) * k;
      p.z += (t.z - p.z) * k;
    }
    for (let it = 0; it < this.o.iters; it++) {
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
      for (let j = 0; j < NJ; j++) this.collideParticle(P[j]!, Q[j]!);
    }
  }

  private collideParticle(p: V3, q: V3) {
    if (p.y < PR && p.y > -0.6 && this.onPlatform(p.x, p.z)) {
      p.y = PR;
      // friction: lose most of the sideways motion on the ground
      q.x = p.x - (p.x - q.x) * 0.5;
      q.z = p.z - (p.z - q.z) * 0.5;
    }
    for (const b of BOXES) {
      if (p.y > b.h + PR) continue;
      const hw = b.w / 2 + PR;
      const dx = p.x - b.x;
      const dz = p.z - b.z;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hw) continue;
      const top = b.h + PR - p.y;
      const sx = hw - Math.abs(dx);
      const sz = hw - Math.abs(dz);
      if (top < sx && top < sz) p.y = b.h + PR;
      else if (sx < sz) p.x = b.x + Math.sign(dx) * hw;
      else p.z = b.z + Math.sign(dz) * hw;
    }
  }

  /** Body parts of fighters that are close push each other apart (every part against every part). */
  private bodyContacts() {
    const fs = this.f;
    const min = PR * 2;
    for (let i = 0; i < fs.length; i++) {
      const A = fs[i]!;
      const pa = A.p[J.pelvis]!;
      for (let j = i + 1; j < fs.length; j++) {
        const B = fs[j]!;
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
  bodies() {
    for (const c of this.f) {
      if (this.o.ragdoll) {
        for (let j = 0; j < NJ; j++) {
          const p = c.p[j]!;
          const o = c.joints[j]!;
          o.x = p.x;
          o.y = p.y;
          o.z = p.z;
        }
      } else pose(c, c.joints);
    }
  }
}
