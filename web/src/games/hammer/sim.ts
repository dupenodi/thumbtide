// The fight: machines, their weapons, the controls, damage, stun, disarming, wrecks, slow motion and the arena limit.
// Follows Hammerfight's model (HAMMERFIGHT_PHYSICS.md). No drawing and no DOM, so it runs in tests and on the TV.
//
// One step = one Hammerfight frame: 50 Hz real time, dt = 0.02 × time warp.

import { Body, type ContactReport, joint, type Joint, World, wrapPi } from "./engine.ts";
import type { Tuning } from "./tuning.ts";
import { MACHINE, type PartSpec, WEAPONS, type WeaponKind } from "./weapons.ts";

/** The fixed camera frame, px. 16:9. */
export const VIEW_W = 960;
export const VIEW_H = 540;
/** px below the frame after which a falling wreck or weapon leaves play (the soft limit no longer holds it). */
const OUT_OF_PLAY = 300;
/** Real seconds per step. Hammerfight runs physics once per frame at GFX_FRAMERATE = 50. */
export const STEP = 0.02;

/** PC values from the object files: m_shock_value, m_level, m_collision_effect, m_extra_shock. */
const SHOCK_VALUE = 0.02;
const LEVEL = 4;
const COLLISION_EFFECT = 0.1;
const EXTRA_SHOCK = 1;
/** Not in Hammerfight: how close a weaponless hull must fly to a loose weapon's grip to take it, px. */
const PICKUP_RANGE = 34;
/** Not in Hammerfight: seconds after losing a weapon before a machine can take one. */
const PICKUP_DELAY = 1;

export interface Tag {
  /** The machine this body belongs to now (a picked-up weapon changes owner). */
  m: Machine;
  hull: boolean;
  /** The weapon's main body (Hammerfight class Weapon): head, blade, ball. */
  striker: boolean;
  sharpness: number;
  /** m_bladeable_d, and m_bladeable_u for the other edge (katar: 0.6). */
  bladeable: number;
  bladeableU: number;
  /** m_sharpness_u side (equal to sharpness when the weapon is the same on both sides). */
  sharpnessU: number;
  spec: PartSpec | null;
}

export interface Machine {
  id: number;
  /** Team number: machines with the same team are allies (free-for-all gives each machine its own). */
  team: number;
  name: string;
  color: string;
  weapon: WeaponKind;
  hull: Body;
  /** The weapon's bodies (attached, or loose next to a weaponless machine). */
  parts: Body[];
  /** Part by key ("head", "blade", "ball", "link0"…). */
  part: Map<string, Body>;
  striker: Body;
  /** Joints inside the weapon (chain links), plus the hull joint while armed. */
  joints: Joint[];
  /** The joint from the hull to the weapon; null when disarmed or wrecked. */
  grip: Joint | null;
  armed: boolean;
  /** Sim time the weapon came off. */
  droppedAt: number;
  /** Input movement this frame, in Hammerfight input units (mouse counts × mouse speed). */
  inx: number;
  iny: number;
  hp: number;
  alive: boolean;
  /** Shock (0–1). While above 0 the engine is off: no thrust, the machine falls and tumbles. */
  stun: number;
  diedAt: number;
  lastHitBy: Machine | null;
  /** Seconds of white flash left after a hit. */
  flash: number;
}

export type SimEvent =
  | { type: "hit"; attacker: Machine; victim: Machine; dmg: number; impact: number; cut: number; x: number; y: number }
  | { type: "clash"; a: Machine; b: Machine; impact: number; x: number; y: number }
  | { type: "disarm"; victim: Machine; by: Machine; x: number; y: number }
  | { type: "pickup"; m: Machine; weapon: WeaponKind }
  | { type: "ko"; victim: Machine; by: Machine | null; x: number; y: number };

interface Loose {
  /** Whose parts arrays hold the bodies. */
  holder: Machine;
  kind: WeaponKind;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Recovery rate R (vfunc 0x432490): clamp(0.7·level, 1, 4) · clamp(2·health/max, 0.1, 1). */
const recovery = (m: Machine) => clamp(0.7 * LEVEL, 1, 4) * clamp((2 * m.hp) / MACHINE.health, 0.1, 1);

export class Arena {
  readonly world = new World();
  readonly machines: Machine[] = [];
  readonly events: SimEvent[] = [];
  /** Simulated seconds (slows down in slow motion). */
  t = 0;
  /** CORE_TIMEWRAP: 1 = normal, 0.3 at the start of slow motion. */
  timewarp = 1;
  private slomoTimer = 0;
  /** Wrecks that fell far below the frame: out of the physics until they respawn (they can't come back). */
  readonly parked = new Set<Machine>();
  private dtPrev = STEP;
  private loose: Loose[] = [];
  private lastDisarm = -10;
  /** Not in Hammerfight: the game turns this on late in a round; the health_low rule stops and hits simply subtract. */
  suddenDeath = false;

  constructor(public tuning: Tuning) {}

  add(o: { id: number; team?: number; name: string; color: string; weapon: WeaponKind; x: number; y: number }): Machine {
    const m = {
      ...o,
      team: o.team ?? o.id,
      parts: [],
      part: new Map(),
      joints: [],
      grip: null,
      armed: true,
      droppedAt: -10,
      inx: 0,
      iny: 0,
      hp: MACHINE.health,
      alive: true,
      stun: 0,
      diedAt: 0,
      lastHitBy: null,
      flash: 0,
    } as unknown as Machine;
    this.buildHull(m, o.x, o.y);
    this.buildWeapon(m, o.weapon);
    this.machines.push(m);
    return m;
  }

  remove(m: Machine): void {
    this.destroy(m);
    this.world.remove(m.hull);
    this.parked.delete(m);
    const i = this.machines.indexOf(m);
    if (i >= 0) this.machines.splice(i, 1);
  }

  /** Back to full health at (x, y) with a fresh weapon. */
  respawn(m: Machine, x: number, y: number, weapon: WeaponKind = m.weapon): void {
    this.destroy(m);
    this.world.remove(m.hull);
    this.parked.delete(m);
    m.hp = MACHINE.health;
    m.alive = true;
    m.stun = 0;
    m.lastHitBy = null;
    m.flash = 0;
    this.buildHull(m, x, y);
    this.buildWeapon(m, weapon);
  }

  /** Normal speed now (a new round must not start in the last round's slow motion). */
  resetTime(): void {
    this.timewarp = 1;
    this.slomoTimer = 0;
  }

  /** Mouse or finger movement in screen px; scaled by the mouse speed (Hammerfight's calibration). */
  push(m: Machine, dx: number, dy: number): void {
    m.inx += dx * this.tuning.mouseSpeed;
    m.iny += dy * this.tuning.mouseSpeed;
  }

  /** Raw input units for this frame (gamepad: 100 · stick³ per frame; bots). */
  pushRaw(m: Machine, dx: number, dy: number): void {
    m.inx += dx;
    m.iny += dy;
  }

  /** One 50 Hz frame. */
  step(): void {
    const tn = this.tuning;
    const tw = this.timewarp;
    const dt = STEP * tw;
    const K = clamp(1 / tw, 1, 4);

    for (const b of this.world.bodies) {
      b.cor = tn.cor;
      b.cof = tn.cof;
    }
    for (const m of this.machines) {
      m.flash = Math.max(0, m.flash - STEP);
      // Teammates pass through each other unless team collision is on.
      const t = tn.teamCollision >= 1 ? -1 : m.team;
      m.hull.team = t;
      for (const b of m.parts) b.team = t;
      if (m.alive) {
        this.drive(m, dt, K);
        // Shock wears off (base tick 0x411af0): stun −= (R + 1) · dt · 0.5.
        if (m.stun > 0) m.stun = Math.max(0, m.stun - (recovery(m) + 1) * dt * 0.5);
        if (!m.armed) this.tryPickup(m);
      }
      m.inx = m.iny = 0;
      this.limit(m);
      // a wreck far below the frame can't come back: stop simulating it (and its hull's joints and contacts)
      if (!m.alive && !this.parked.has(m) && m.hull.y > VIEW_H + OUT_OF_PLAY) {
        this.world.remove(m.hull);
        this.parked.add(m);
      }
    }
    // the same for a loose weapon that fell far below the frame: nobody can reach it again
    if (this.loose.length) for (const l of [...this.loose]) {
      if (l.holder.parts.length && l.holder.parts.every((b) => b.y > VIEW_H + OUT_OF_PLAY)) this.destroy(l.holder);
    }

    this.world.commonForces(tn.gravity);
    this.world.step({ dt, dtPrev: this.dtPrev, gravity: tn.gravity, passes: tn.passes, onContact: this.onContact });
    this.dtPrev = dt;
    this.t += dt;
    this.slowMotion();
  }

  /** Hammerfight's PC control (0x4b03d0) and Human forces (0x44c930). */
  private drive(m: Machine, dt: number, K: number): void {
    const tn = this.tuning;
    const h = m.hull;
    const stunned = m.stun > 0;
    // Stunned: the engine is off, so gravity takes over and the hull stops righting itself.
    h.gravity = stunned;

    if (!stunned) {
      // Thrust: an impulse from this frame's input movement, capped.
      let fx = m.inx * tn.thrust * 0.6 * K;
      let fy = m.iny * tn.thrust * 0.6 * K;
      const fl = Math.hypot(fx, fy);
      const cap = (8e6 * K) / dt;
      if (fl > cap) {
        fx *= cap / fl;
        fy *= cap / fl;
      }
      h.applyForce(fx, fy);

      // Not in Hammerfight: optional lift against the weapon's weight.
      if (tn.hover > 0 && m.armed) {
        let w = 0;
        for (const p of m.parts) w += p.mass;
        h.applyForce(0, -tn.hover * tn.gravity * w);
      }

      // Tilt toward the thrust (sideways only), then 5 % back to upright. Moves angle and prev angle together.
      if (fl > 0) {
        const amt = clamp(Math.min(fl, cap) * dt * 3e-8, 0, 1);
        const target = Math.asin(clamp(fx / Math.hypot(fx, fy), -1, 1));
        const d = amt * wrapPi(target - h.a);
        h.a += d;
        h.pa += d;
      }
      const up = -0.05 * wrapPi(h.a);
      h.a += up;
      h.pa += up;

      // Quadratic drag (skipped while stunned, as in the original).
      const speed = Math.hypot(h.vx, h.vy);
      h.applyForce(-tn.resist * speed * h.vx, -tn.resist * speed * h.vy);
    }

    // Hard top speed: move the previous position so the Verlet speed equals the clip.
    const speed = Math.hypot(h.vx, h.vy);
    const clip = tn.speedClip * K;
    if (speed > clip) {
      h.px = h.x - (h.vx / speed) * clip * dt;
      h.py = h.y - (h.vy / speed) * clip * dt;
    }
  }

  /** Not in Hammerfight: a stiff spring a little outside the fixed camera frame. */
  private limit(m: Machine): void {
    if (!m.alive) return;
    const tn = this.tuning;
    const h = m.hull;
    const w = 2 * Math.PI * tn.limitHz;
    const k = w * w;
    const c = 2 * w;
    const axis = (pos: number, vel: number, lo: number, hi: number): number => {
      if (pos < lo) return k * (lo - pos) - (vel < 0 ? c * vel : 0);
      if (pos > hi) return k * (hi - pos) - (vel > 0 ? c * vel : 0);
      return 0;
    };
    const ax = axis(h.x, h.vx, -tn.limit, VIEW_W + tn.limit);
    const ay = axis(h.y, h.vy, -tn.limit, VIEW_H + tn.limit);
    if (ax || ay) h.applyForce(ax * h.mass, ay * h.mass);
  }

  private onContact = (c: ContactReport): void => {
    const ta = c.a.data as Tag | null;
    const tb = c.b.data as Tag | null;
    if (!ta || !tb || ta.m === tb.m) return;
    const impact = c.impulse * 1e-5;
    if (impact <= 0) return;

    if (!ta.hull && !tb.hull) {
      if (impact > 15) this.events.push({ type: "clash", a: ta.m, b: tb.m, impact, x: c.x, y: c.y });
      if (ta.striker && tb.striker) this.clash(c.a, ta, c.b, tb, impact, c);
      return;
    }
    // Each collision hurts both sides (onHit on both bodies).
    if (tb.hull) this.hurt(tb.m, c.b, ta, c.a, impact, c);
    if (ta.hull) this.hurt(ta.m, c.a, tb, c.b, impact, c);
  };

  /** Is this body still held by a live machine? Loose weapons and wrecks are "unowned". */
  private owned(t: Tag): boolean {
    return t.m.alive && (t.hull || t.m.armed);
  }

  /** Damage (0x410340) and shock. */
  private hurt(victim: Machine, vBody: Body, by: Tag, byBody: Body, impact: number, c: ContactReport): void {
    if (!victim.alive) return;
    // Damage off (the warm-up): no damage and no stun either.
    if (this.tuning.damage <= 0) return;
    // Friendly fire off: teammates' hits only push.
    if (by.m !== victim && by.m.team === victim.team && this.tuning.teamDamage < 1) return;
    const owned = this.owned(by);
    // Unowned blunt things (a wreck, a loose chain) count for 10 % against a machine.
    const effect = !owned && by.sharpness <= 1 ? COLLISION_EFFECT : 1;

    // Shock: big hits switch the victim's engine off for a moment.
    if (impact > 30) victim.stun = Math.min(1, victim.stun + SHOCK_VALUE * EXTRA_SHOCK * impact * 0.5 * effect);

    // Two-sided weapons (0x512ff0…): which side touched decides the sharpness and the blade (an axe's back is blunt,
    // the katar's back edge cuts at 0.6). Then blades cut harder the faster they slide across.
    let bladeable = by.bladeable;
    let sharpness = by.sharpness;
    if (by.bladeableU !== by.bladeable || by.sharpnessU !== by.sharpness) {
      const s = Math.sin(byBody.a);
      const co = Math.cos(byBody.a);
      const ly = -(c.x - byBody.x) * s + (c.y - byBody.y) * co;
      if (ly > 0) {
        bladeable = by.bladeableU;
        sharpness = by.sharpnessU;
      }
    }
    const cut = cutFactor(byBody, bladeable, c.nx, c.ny);
    const dmg = Math.floor(this.tuning.damage * sharpness * cut * impact * effect);
    if (dmg <= 0) return;

    // health_low rule: below 12 only a lethal hit counts; the first lethal hit leaves 12, the next one kills.
    // In sudden death (ours, to end long rounds) every hit simply subtracts.
    const before = victim.hp;
    const low = MACHINE.healthLow;
    if (this.suddenDeath) {
      victim.hp = Math.max(0, victim.hp - dmg);
    } else if (victim.hp - dmg > 0) {
      if (victim.hp > low) victim.hp -= dmg;
    } else if (victim.hp !== low) {
      victim.hp = low;
    } else {
      victim.hp = 0;
    }
    if (owned) victim.lastHitBy = by.m;
    victim.flash = 0.12;
    this.events.push({ type: "hit", attacker: by.m, victim, dmg: before - victim.hp, impact, cut, x: c.x, y: c.y });

    // GAME_SLOMO (0x483b94): v = 0.15 · M · (40000/(victimMass + 15001) + 0.25); v > 27, or a fast blade, slows time.
    const v = 0.15 * impact * (40000 / (vBody.mass + 15001) + 0.25);
    if ((v > 27 || cut > 4) && this.tuning.slomo >= 1 && this.timewarp === 1) {
      this.timewarp = 0.3;
      this.slomoTimer = 2;
    }
    if (victim.hp <= 0) this.wreck(victim);
  }

  /** Weapon against weapon (0x420ca0): the much faster one can knock the other off its machine. */
  private clash(aBody: Body, ta: Tag, bBody: Body, tb: Tag, impact: number, c: ContactReport): void {
    if (this.tuning.disarm < 1 || this.t - this.lastDisarm < 1) return;
    if (!this.owned(ta) || !this.owned(tb)) return;
    if (ta.m.team === tb.m.team && this.tuning.teamDamage < 1) return;
    const sa = Math.hypot(aBody.vx, aBody.vy);
    const sb = Math.hypot(bBody.vx, bBody.vy);
    const threshold = (m: Machine) => (25 * recovery(m) + 75) * (m.hp <= MACHINE.healthLow ? 0.25 : 1);
    let victim: Machine | null = null;
    let by: Machine | null = null;
    if ((sa + 1) / (sb + 1) > 1.5 && impact > threshold(tb.m)) {
      victim = tb.m;
      by = ta.m;
    } else if ((sb + 1) / (sa + 1) > 1.5 && impact > threshold(ta.m)) {
      victim = ta.m;
      by = tb.m;
    }
    if (!victim || !by) return;
    this.lastDisarm = this.t;
    this.drop(victim);
    this.events.push({ type: "disarm", victim, by, x: c.x, y: c.y });
  }

  /** The weapon comes off the hull but stays in one piece (a chain stays a chain). */
  private drop(m: Machine): void {
    if (!m.armed) return;
    if (m.grip) {
      this.world.removeJoint(m.grip);
      m.joints = m.joints.filter((j) => j !== m.grip);
      m.grip = null;
    }
    m.armed = false;
    m.droppedAt = this.t;
    if (m.parts.length) this.loose.push({ holder: m, kind: m.weapon });
  }

  /** Not in Hammerfight's code as we read it: a weaponless machine takes a loose weapon by flying into its grip. */
  private tryPickup(m: Machine): void {
    if (this.t - m.droppedAt < PICKUP_DELAY) return;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i]!;
      const grip = l.holder.part.get(WEAPONS[l.kind].joints.find((j) => j.a === "hull")!.b);
      if (!grip) continue;
      if (Math.hypot(grip.x - m.hull.x, grip.y - m.hull.y) > PICKUP_RANGE) continue;
      this.loose.splice(i, 1);
      const from = l.holder;
      // Hand the bodies and inner joints over.
      const parts = from.parts;
      const part = from.part;
      const joints = from.joints;
      if (from !== m) {
        from.parts = [];
        from.part = new Map();
        from.joints = [];
        // The taker's own dropped weapon (if any) disappears.
        for (const j of m.joints) this.world.removeJoint(j);
        for (const b of m.parts) this.world.remove(b);
        this.loose = this.loose.filter((x) => x.holder !== m);
      }
      m.parts = parts;
      m.part = part;
      m.joints = joints;
      m.weapon = l.kind;
      m.striker = part.get(WEAPONS[l.kind].striker)!;
      for (const b of parts) {
        b.group = m.id;
        (b.data as Tag).m = m;
      }
      this.attach(m);
      this.events.push({ type: "pickup", m, weapon: l.kind });
      return;
    }
  }

  /** Slow-motion ease (0x453d78): timer from 2 to 0, time warp = (2 − 0.7·timer)/2. */
  private slowMotion(): void {
    if (this.slomoTimer <= 0) return;
    this.slomoTimer -= STEP / this.timewarp;
    if (this.slomoTimer <= 0) {
      this.slomoTimer = 0;
      this.timewarp = 1;
    } else {
      this.timewarp = (2 - 0.7 * this.slomoTimer) / 2;
    }
  }

  private wreck(m: Machine): void {
    m.alive = false;
    m.diedAt = this.t;
    m.stun = 0;
    this.drop(m);
    m.hull.gravity = true;
    m.hull.spinDamp = 300000;
    m.hull.setVelocity(m.hull.vx, m.hull.vy, (Math.random() - 0.5) * 12, STEP * this.timewarp);
    this.events.push({ type: "ko", victim: m, by: m.lastHitBy, x: m.hull.x, y: m.hull.y });
  }

  /** Remove the machine's weapon bodies and joints (the hull stays). */
  private destroy(m: Machine): void {
    for (const j of m.joints) this.world.removeJoint(j);
    for (const b of m.parts) this.world.remove(b);
    this.loose = this.loose.filter((l) => l.holder !== m);
    m.joints = [];
    m.parts = [];
    m.part = new Map();
    m.grip = null;
    m.armed = false;
  }

  private buildHull(m: Machine, x: number, y: number): void {
    const hull = new Body(MACHINE.mesh, MACHINE.density).place(x, y, 0);
    hull.gravity = false;
    hull.spinDamp = MACHINE.spinDamp;
    hull.group = m.id;
    hull.data = { m, hull: true, striker: false, sharpness: 1, bladeable: 0, bladeableU: 0, sharpnessU: 1, spec: null } satisfies Tag;
    this.world.add(hull);
    m.hull = hull;
  }

  /** A new weapon hanging straight below the hull. */
  private buildWeapon(m: Machine, kind: WeaponKind): void {
    const spec = WEAPONS[kind];
    const { x, y } = m.hull;
    m.weapon = kind;
    m.parts = [];
    m.part = new Map();
    for (const p of spec.parts) {
      // Hanging straight down: local +x (away from the machine) points along world +y.
      const b = new Body(p.mesh, p.density).place(x, y + p.hang, p.angle ?? Math.PI / 2);
      b.group = m.id;
      b.data = {
        m,
        hull: false,
        striker: p.key === spec.striker,
        sharpness: p.sharpness,
        bladeable: p.bladeable,
        bladeableU: p.bladeableU ?? p.bladeable,
        sharpnessU: p.sharpnessU ?? p.sharpness,
        spec: p,
      } satisfies Tag;
      this.world.add(b);
      m.part.set(p.key, b);
      m.parts.push(b);
    }
    m.striker = m.part.get(spec.striker)!;
    m.joints = [];
    for (const j of spec.joints) {
      if (j.a === "hull") continue;
      const jt = this.makeJoint(m.part.get(j.a)!, m.part.get(j.b)!, j);
      m.joints.push(jt);
    }
    this.attach(m);
  }

  /** Join the weapon to the hull. */
  private attach(m: Machine): void {
    const j = WEAPONS[m.weapon].joints.find((x) => x.a === "hull")!;
    m.grip = this.makeJoint(m.hull, m.part.get(j.b)!, j);
    m.joints.push(m.grip);
    m.armed = true;
  }

  private makeJoint(a: Body, b: Body, j: (typeof WEAPONS)[WeaponKind]["joints"][number]): Joint {
    const jt = joint(a, b, j.type, j.radius, { sax: j.sax ?? 0, say: j.say ?? 0, sbx: j.sbx ?? 0, sby: j.sby ?? 0, necess: j.necess });
    this.world.joints.push(jt);
    return jt;
  }
}

/** Blades cut harder when they slide across the surface fast (0x403c00). */
function cutFactor(b: Body, bladeable: number, nx: number, ny: number): number {
  if (!bladeable) return 1;
  const s = Math.hypot(b.vx, b.vy);
  const cross = (b.vx / (s + 1)) * ny - (b.vy / (s + 1)) * nx;
  if (Math.abs(cross) <= 0.7) return 1;
  return clamp((s + 1) * bladeable * 0.005, 1, 10);
}

/** Where a body is, blended between the start and end of the last step. */
export function lerpBody(b: Body, alpha: number): [number, number, number] {
  const da = wrapPi(b.a - b.ra);
  return [b.rx + (b.x - b.rx) * alpha, b.ry + (b.y - b.ry) * alpha, b.ra + da * alpha];
}
