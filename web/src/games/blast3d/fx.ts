// The effects, as bursts into the one particle system (particles.ts): what each looks like, and how many particles.
import { rgb } from "./meshes.ts";
import type { Particles, Spark } from "./particles.ts";

const R = Math.random;
const base: Spark = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, r: 1, g: 1, b: 1, add: 1, size0: 0.2, size1: 0.1, gravity: 0, drag: 0 };
const p: Spark = { ...base };
/** A random direction; `up` > 0 keeps it in the upper half. */
function dir(speed: number, up = 0) {
  const a = R() * Math.PI * 2;
  const h = up > 0 ? R() * 0.9 + 0.1 : R() * 2 - 1;
  const s = Math.sqrt(1 - h * h);
  p.vx = Math.cos(a) * s * speed;
  p.vy = h * speed;
  p.vz = Math.sin(a) * s * speed;
}
function tone(c: [number, number, number], k = 1) {
  p.r = c[0] * k;
  p.g = c[1] * k;
  p.b = c[2] * k;
}
const FIRE = rgb("#ff8a1f"), HOT = rgb("#fff1b0"), SMOKE = rgb("#8f8a9c"), SPARK = rgb("#ffd45e"), CHUNK = rgb("#4a3626"), DUST = rgb("#e8d9b8"), CLOUD = rgb("#f4fbff"), GOO = rgb("#8be06f");

/** A blast: a flash, fire, smoke puffs, sparks and debris. 47 particles for a normal bomb (24 in lite mode). */
export function explosion(fx: Particles, x: number, y: number, z: number, radius: number, big: boolean) {
  const s = radius / 2;
  Object.assign(p, base, { x, y: y + 0.2, z });
  // the flash: one big soft sprite
  tone(HOT, 0.9);
  Object.assign(p, { vx: 0, vy: 0, vz: 0, life: 0.16, add: 1, size0: radius * 1.6, size1: radius * 2.4, gravity: 0, drag: 0 });
  fx.spawn(p);
  // fire balls
  for (let i = fx.count(big ? 18 : 12); i > 0; i--) {
    dir((1.5 + R() * 3.5) * s, 1);
    tone(R() < 0.4 ? HOT : FIRE, 0.85);
    Object.assign(p, { life: 0.35 + R() * 0.3, add: 0.9, size0: (1.0 + R() * 0.7) * s, size1: 0.25 * s, gravity: 2, drag: 3 });
    fx.spawn(p);
  }
  // smoke that rises and swells
  for (let i = fx.count(big ? 12 : 8); i > 0; i--) {
    dir((0.8 + R() * 1.8) * s, 1);
    tone(SMOKE, 0.75 + R() * 0.3);
    Object.assign(p, { life: 0.7 + R() * 0.5, add: 0.45, size0: 0.7 * s, size1: (1.5 + R() * 0.7) * s, gravity: 1.6, drag: 1.5 });
    fx.spawn(p);
  }
  // sparks that arc and fall
  for (let i = fx.count(big ? 24 : 16); i > 0; i--) {
    dir((5 + R() * 7) * s, 1);
    tone(SPARK);
    Object.assign(p, { life: 0.45 + R() * 0.5, add: 1, size0: 0.2, size1: 0.04, gravity: -16, drag: 0.6 });
    fx.spawn(p);
  }
  // debris
  for (let i = fx.count(big ? 14 : 10); i > 0; i--) {
    dir((3.5 + R() * 4.5) * s, 1);
    p.vy += 3;
    tone(CHUNK, 0.8 + R() * 0.5);
    Object.assign(p, { life: 0.7 + R() * 0.5, add: 0, size0: 0.22 + R() * 0.1, size1: 0.16, gravity: -20, drag: 0 });
    fx.spawn(p);
  }
}

/** A fuse's spark (one at a time, from the lit tip). */
export function fuseSpark(fx: Particles, x: number, y: number, z: number) {
  Object.assign(p, base, { x, y, z });
  dir(0.8 + R() * 1.2, 1);
  tone(R() < 0.5 ? HOT : SPARK);
  Object.assign(p, { life: 0.18 + R() * 0.2, add: 1, size0: 0.2, size1: 0.03, gravity: -6, drag: 0 });
  fx.spawn(p);
}

/** A punch landing: a flash and a few sparks along the blow. 8 particles. */
export function punchHit(fx: Particles, x: number, y: number, z: number, dx: number, dy: number, dz: number, power: number) {
  Object.assign(p, base, { x, y, z });
  tone(HOT);
  Object.assign(p, { vx: 0, vy: 0, vz: 0, life: 0.1, add: 1, size0: 0.5 + power * 0.5, size1: 0.9 + power * 0.7, gravity: 0, drag: 0 });
  fx.spawn(p);
  for (let i = fx.count(3 + Math.round(power * 5)); i > 0; i--) {
    dir(2 + R() * 2);
    p.vx += dx * 5;
    p.vy += dy * 5 + 1.5;
    p.vz += dz * 5;
    tone(i % 2 ? CLOUD : SPARK);
    Object.assign(p, { life: 0.25 + R() * 0.2, add: 1, size0: 0.24, size1: 0.05, gravity: -9, drag: 1 });
    fx.spawn(p);
  }
}

/** Dust rolling out from a landing, a jump or a spawn. 6 particles. */
export function dust(fx: Particles, x: number, y: number, z: number, strength = 1) {
  Object.assign(p, base);
  for (let i = fx.count(Math.round(6 * strength)); i > 0; i--) {
    const a = R() * Math.PI * 2;
    const sp = (1.2 + R() * 1.4) * strength;
    Object.assign(p, { x, y: y + 0.08, z, vx: Math.cos(a) * sp, vy: 0.4 + R() * 0.5, vz: Math.sin(a) * sp, life: 0.4 + R() * 0.3, add: 0, size0: 0.3, size1: 0.8 * strength, gravity: 0.5, drag: 3 });
    tone(DUST, 0.55);
    fx.spawn(p);
  }
}

/** A power-up taken: sparkles in its colour rising round the fighter. 12 particles. */
export function sparkle(fx: Particles, x: number, y: number, z: number, hex: string, n = 12) {
  const c = rgb(hex);
  Object.assign(p, base);
  for (let i = fx.count(n); i > 0; i--) {
    const a = R() * Math.PI * 2;
    Object.assign(p, { x: x + Math.cos(a) * 0.45, y: y - 0.6 + R() * 0.8, z: z + Math.sin(a) * 0.45, vx: Math.cos(a) * 0.6, vy: 1.6 + R() * 1.8, vz: Math.sin(a) * 0.6, life: 0.5 + R() * 0.4, add: 1, size0: 0.28, size1: 0.04, gravity: 0, drag: 1 });
    tone(i % 3 ? c : HOT);
    fx.spawn(p);
  }
}

/** Someone dropped out of the sky's bottom: a poof of cloud where they went. 14 particles. */
export function poof(fx: Particles, x: number, y: number, z: number) {
  Object.assign(p, base);
  for (let i = fx.count(14); i > 0; i--) {
    Object.assign(p, { x, y, z });
    dir(1.5 + R() * 2.5, 1);
    p.vy += 2.5;
    tone(CLOUD, 0.85);
    Object.assign(p, { life: 0.7 + R() * 0.5, add: 0.15, size0: 0.7, size1: 1.8 + R() * 0.6, gravity: 1, drag: 2 });
    fx.spawn(p);
  }
}

/** A sticky bomb landing: a few drops of goo. */
export function splat(fx: Particles, x: number, y: number, z: number) {
  Object.assign(p, base, { x, y, z });
  for (let i = fx.count(5); i > 0; i--) {
    dir(1.5 + R() * 1.5, 1);
    tone(GOO, 0.9);
    Object.assign(p, { life: 0.35 + R() * 0.2, add: 0, size0: 0.22, size1: 0.1, gravity: -12, drag: 0 });
    fx.spawn(p);
  }
}
