// The fight: machines, their weapons, the controls, damage, stun, disarming, wrecks, slow motion and the arena limit.
// Follows Hammerfight's model (HAMMERFIGHT_PHYSICS.md). No drawing and no DOM, so it runs in tests and on the TV.
//
// One step = one Hammerfight frame: 50 Hz real time, dt = 0.02 × time warp.

import { Body, type ContactReport, joint, type Joint, JointType, World, wrapPi } from "./engine.ts";
import type { Tuning } from "./tuning.ts";
import { type CreatureLayout, type MonsterKind, wormLayout } from "./monsters.ts";
import { armedSpec, type GunKind, type GunSpec, MACHINE, type PartSpec, PLATE_COUNT, type PlateKind, PLATES, type WeaponKind, type WeaponSpec } from "./weapons.ts";

/** The fixed camera frame, px. 16:9. */
export const VIEW_W = 960;
export const VIEW_H = 540;
/**
 * Which weapon parts collide. Hammerfight's item factory gives chain links, mace hands and handles m_layer 0, and the
 * broadphase (0x402719) only pairs bodies whose layers share a bit: they touch nothing, so a chain can't wrap and
 * grind an enemy; only the head hits (RE_WEAPONS.md 3.3). Exceptions: the morning star's hand (layer 8, which the
 * machine layer 11 shares), the spiked flail's bladed segments and the claw's jaw (default layer 3).
 */
export const solidPart = (kind: WeaponKind, key: string): boolean => !(/^(link\d+|hand|handle)$/.test(key) && !(kind === "starmace" && key === "hand"));

/** A live hull's centre stays this far inside the top edge (hull half height 16.5 + the rotor) and the bottom. */
const WALL_TOP = 30;
const WALL_BOTTOM = 18;
/** A live hull's centre stays this far inside the left and right edges (hull half width 12.5 + a little). */
const WALL_SIDE = 16;
/**
 * Where AI fliers (bots, monsters) keep to: EDGE_M px inside the left, right and bottom edges, and below EDGE_TOP
 * (the score cards cover the top ~75 px of the frame).
 */
export const EDGE_M = 60;
export const EDGE_TOP = 110;
/** px below the frame after which a falling wreck or weapon leaves play (the soft limit no longer holds it). */
const OUT_OF_PLAY = 300;
/** Gun aim (OURS, aim()): spring 1/s² and damping 1/s on the gun toward its aim point (Hammerfight's turret pull is 1500), and how far off it may still fire (11°). */
const GUN_AIM_K = 1500;
const GUN_AIM_D = 55;
const GUN_AIM_TOL = (11 * Math.PI) / 180;
/** The thrust left while a gun aims: full stick speeds the hull up faster than the pull turns the gun. */
const AIM_THRUST = 0.3;
/** Output of edgeAt (read it before the next call). */
export const edgeOut = { bladeable: 0, sharpness: 0 };
/**
 * Two-sided weapons (0x512ff0…): which side of the part a contact at (x, y) is on decides its sharpness and blade (an
 * axe's back is blunt, the katar's back edge cuts at 0.6). The full (_d) values belong to the part's +y face:
 * Hammerfight's sprites draw every one-sided blade's edge there (and the axes' spikes, which carry _u values, on −y).
 * The exe's side test reads the contact normal; its sign was not traced, so the side here follows the art (before
 * 2026-11-17 it was the other way round: the spines cut).
 */
export function edgeAt(t: Pick<Tag, "bladeable" | "bladeableU" | "sharpness" | "sharpnessU">, b: Body, x: number, y: number): void {
  edgeOut.bladeable = t.bladeable;
  edgeOut.sharpness = t.sharpness;
  if (t.bladeableU === t.bladeable && t.sharpnessU === t.sharpness) return;
  const ly = -(x - b.x) * Math.sin(b.a) + (y - b.y) * Math.cos(b.a);
  if (ly < 0) {
    edgeOut.bladeable = t.bladeableU;
    edgeOut.sharpness = t.sharpnessU;
  }
}

/** A gun that aims: a sidearm (part key "gun", not a dual set's back blade) with a round in the clip. */
export const aimable = (g: GunState) => g.ammo >= 1 && (g.body.data as Tag | null)?.spec?.key === "gun";
/** Real seconds per step. Hammerfight runs physics once per frame at GFX_FRAMERATE = 50. */
export const STEP = 0.02;

/** PC values from the object files: m_shock_value, m_level, m_collision_effect, m_extra_shock. */
const SHOCK_VALUE = 0.02;
const LEVEL = 4;
const COLLISION_EFFECT = 0.1;
const EXTRA_SHOCK = 1;
/** Seconds after a stunning hit in which hitting something is a slam (OURS). */
const SLAM_S = 0.8;
/** A wreck's pieces hurt for this long, then fall through everything (OURS). */
const GIB_HARM_S = 2.5;
/** A stunned machine must hit the floor or ceiling at least this fast (px/s) for a slam (not a slow fall). */
const WALL_SLAM_V = 150;
/** Not in Hammerfight: how close a weaponless hull must fly to a loose weapon's grip to take it, px. */
const PICKUP_RANGE = 34;
/** Not in Hammerfight: seconds after losing a weapon before a machine can take one. */
const PICKUP_DELAY = 1;
/** Bullets go after this many contacts (the exe: 2), mortar balls after 5; and after SHOT_LIFE seconds. */
const SHOT_CONTACTS = 2;
const BALL_CONTACTS = 5;
const SHOT_LIFE = 1.5;
/** At most this many shots in the air (each is a body: they count in the TV's body budget). The oldest goes first. */
export const MAX_SHOTS = 24;
/**
 * Slow-motion limits. The exe uses v > 27 (cut > 4); ours are lower so that about the hardest 1 % of hits on a
 * machine (impact ≳ 90) slow time. Measured: impacts p99 83, p99.9 117, max 167 in a soak of every melee weapon.
 */
export const SLOMO_V = 10;
export const SLOMO_CUT = 3;
/** A bullet does 3x damage against monster flesh (the exe tags it 0x6c). */
const MONSTER_SHOT_BONUS = 3;

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
  /** A gun pulled round by its aim this step (OURS): it pushes but does no damage, so the pull can't make a club of it. */
  aiming?: boolean;
  /** m_jaws: a bite adds 0.3–3 × jaws damage (monster jaws). */
  jaws?: number;
  /** A bullet or mortar ball (its owner is `m`). */
  shot?: Shot;
  /** A shield plate (attached while its joint is in `m.plates`). */
  plate?: PlateKind;
  /** A knocked-off plate: it no longer counts as its machine's. */
  loose?: boolean;
  /** A piece of a wrecked machine: it hurts like an owned weapon until this arena time (OURS). */
  gibUntil?: number;
  /** Whose hit it is when this body hurts someone (a wreck shard: whoever wrecked it). */
  credit?: Machine | null;
  /** A crate's splinter (drawn as wood). */
  wood?: boolean;
  spec: PartSpec | null;
}

/** A monster's state (Hammerfight's Polypod creatures; see monsters.ts). */
export interface MonsterState {
  kind: MonsterKind;
  layout: CreatureLayout;
  /** Seconds offset for its lunge and wiggle rhythm, so a pack doesn't move in step. */
  phase: number;
  /** Part bodies by key, for drawing ("jaw", "seg0"…). */
  part: Map<string, Body>;
}

/** A gun on one of the machine's weapon bodies. */
export interface GunState {
  spec: GunSpec;
  body: Body;
  /** Rounds left in the clip. */
  ammo: number;
  /** Seconds until it can fire again (between shots, or the reload). */
  timer: number;
}

export interface Shot {
  body: Body;
  look: GunSpec["look"];
  r: number;
  born: number;
  contacts: number;
  maxContacts: number;
  /** Rockets: the blast when it goes. */
  blast?: GunSpec["blast"];
}

export interface Machine {
  id: number;
  /** Team number: machines with the same team are allies (free-for-all gives each machine its own). */
  team: number;
  name: string;
  color: string;
  weapon: WeaponKind;
  /** The gun taken with the weapon, if any. */
  sidearm: GunKind | null;
  /** The weapon as built (with the sidearm's parts and joints). */
  spec: WeaponSpec;
  /** The guns on the weapon (a sidearm, the tribune's back blade). */
  guns: GunState[];
  /** The trigger is held this frame. */
  trigger: boolean;
  /** This frame's gun aim direction (0, 0 = none: the guns shoot along their axis). */
  aimX: number;
  aimY: number;
  /** Shield plates still on the machine, and the kind taken. */
  plateKind: PlateKind | null;
  plates: { body: Body; joint: Joint }[];
  /** The shield is held this frame: plates spread apart, thrust halves. */
  shielding: boolean;
  hull: Body;
  /** The weapon's bodies (attached, or loose next to a weaponless machine). */
  parts: Body[];
  /** Part by key ("head", "blade", "ball", "link0"…). */
  part: Map<string, Body>;
  striker: Body;
  /** Joints inside the weapon (chain links), plus the hull joint while armed. */
  joints: Joint[];
  /** The first joint from the hull to the weapon; null when disarmed or wrecked. */
  grip: Joint | null;
  /** All hull joints of the weapon (a dual set or a sidearm has two). */
  grips: Joint[];
  armed: boolean;
  /** Sim time the weapon came off. */
  droppedAt: number;
  /** Input movement this frame, in Hammerfight input units (mouse counts × mouse speed). */
  inx: number;
  iny: number;
  hp: number;
  alive: boolean;
  /** Shock (0 to tuning.stunMax). While above 0 the engine is off: no thrust, the machine falls and tumbles. */
  stun: number;
  /** Until this arena time, hitting something adds stun (a slam after a stunning hit; OURS). */
  slamUntil: number;
  diedAt: number;
  lastHitBy: Machine | null;
  /** Seconds of white flash left after a hit. */
  flash: number;
  /** Set for monsters; null for machines. */
  monster: MonsterState | null;
}

export type SimEvent =
  | { type: "hit"; attacker: Machine; victim: Machine; dmg: number; impact: number; cut: number; x: number; y: number }
  | { type: "clash"; a: Machine; b: Machine; impact: number; x: number; y: number }
  | { type: "disarm"; victim: Machine; by: Machine; x: number; y: number }
  | { type: "pickup"; m: Machine; weapon: WeaponKind }
  | { type: "shot"; m: Machine; ball: boolean; x: number; y: number }
  | { type: "blast"; m: Machine; radius: number; x: number; y: number }
  | { type: "plateoff"; m: Machine; by: Machine; x: number; y: number }
  | { type: "slam"; m: Machine; impact: number; x: number; y: number }
  | { type: "crack"; by: Machine; obstacle: Obstacle; dmg: number; x: number; y: number }
  | { type: "break"; by: Machine; obstacle: Obstacle; x: number; y: number }
  | { type: "ko"; victim: Machine; by: Machine | null; x: number; y: number };

/**
 * Static: pillar (a stone box, may be turned), ledge (a plank), floor, crate (breaks). Dynamic (gravity on): cage (hangs
 * on a rope, breaks) and block (a heavy octagon that weapons and machines push; never breaks).
 */
export type ObstacleKind = "crate" | "pillar" | "ledge" | "floor" | "cage" | "block";
export const breakable = (k: ObstacleKind) => k === "crate" || k === "cage";
export interface Obstacle {
  kind: ObstacleKind;
  body: Body;
  hw: number;
  hh: number;
  hp: number;
  max: number;
  /** A cage's rope anchor (world px), drawn as a line to the cage's top. */
  rope?: { x: number; y: number };
}

/** Where an obstacle goes, in the arena's own px. */
export interface ObstacleSpec {
  kind: ObstacleKind;
  x: number;
  y: number;
  hw: number;
  hh: number;
  /** Angle, rad. */
  a?: number;
  hp?: number;
  /** Density of a dynamic kind (cage 50, block 40 as in Hammerfight). */
  d?: number;
  /** A cage's rope: the anchor (world px) and the length. */
  rope?: { x: number; y: number; len: number };
}

interface Loose {
  /** Whose parts arrays hold the bodies. */
  holder: Machine;
  kind: WeaponKind;
  sidearm: GunKind | null;
  spec: WeaponSpec;
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
  /** The arena in world px (the TV shows all of it: a bigger arena is a zoomed-out view). */
  w = VIEW_W;
  h = VIEW_H;
  /** Obstacles (see arenas.ts for which come from Hammerfight's levels). */
  obstacles: Obstacle[] = [];
  /** Which arena layout (arenas.ts ARENAS key), its colour theme, and decoration chains (no bodies). */
  kind = "classic";
  theme = "dusk";
  chains: { x: number; y: number; len: number }[] = [];
  /** Counts setArena calls: the renderer repaints its cached backdrop (with the static obstacles) when it changes. */
  layout = 0;
  private obstacleOf = new Map<Body, Obstacle>();
  /** Crates broken during this step's collisions, removed after it. */
  private brokenBodies: Body[] = [];
  private slomoTimer = 0;
  /** Wrecks that fell far below the frame: out of the physics until they respawn (they can't come back). */
  readonly parked = new Set<Machine>();
  private dtPrev = STEP;
  private loose: Loose[] = [];
  private lastDisarm = -10;
  /** Not in Hammerfight: the game turns this on late in a round; the health_low rule stops and hits simply subtract. */
  suddenDeath = false;
  /** Bullets and mortar balls in the air. */
  readonly shots: Shot[] = [];
  /** Knocked-off plates, removed a few seconds later. */
  private debris: { body: Body; at: number }[] = [];

  constructor(public tuning: Tuning) {}

  add(o: { id: number; team?: number; name: string; color: string; weapon: WeaponKind; sidearm?: GunKind | null; plate?: PlateKind | null; x: number; y: number }): Machine {
    const m = {
      ...o,
      team: o.team ?? o.id,
      sidearm: o.sidearm ?? null,
      plateKind: o.plate ?? null,
      plates: [],
      shielding: false,
      guns: [],
      trigger: false,
      aimX: 0,
      aimY: 0,
      grips: [],
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
      slamUntil: 0,
      diedAt: 0,
      lastHitBy: null,
      flash: 0,
      monster: null,
    } as unknown as Machine;
    this.buildHull(m, o.x, o.y);
    this.buildWeapon(m, o.weapon, m.sidearm);
    this.buildPlates(m, m.plateKind);
    this.machines.push(m);
    return m;
  }

  remove(m: Machine): void {
    this.destroy(m);
    this.removePlates(m);
    this.world.remove(m.hull);
    this.parked.delete(m);
    const i = this.machines.indexOf(m);
    if (i >= 0) this.machines.splice(i, 1);
  }

  /** Back to full health at (x, y) with a fresh weapon. */
  respawn(m: Machine, x: number, y: number, weapon: WeaponKind = m.weapon, sidearm: GunKind | null = m.sidearm, plate: PlateKind | null = m.plateKind): void {
    this.destroy(m);
    this.removePlates(m);
    this.world.remove(m.hull);
    this.parked.delete(m);
    m.hp = MACHINE.health;
    m.alive = true;
    m.stun = 0;
    m.lastHitBy = null;
    m.flash = 0;
    this.buildHull(m, x, y);
    this.buildWeapon(m, weapon, sidearm);
    this.buildPlates(m, plate);
  }

  /**
   * A monster at (x, y), its head pointing along `dir` (radians). It joins the machines list (it is hit, stunned and
   * knocked out like one) but flies by its own AI and has no weapon.
   */
  addMonster(o: { id: number; team: number; kind: MonsterKind; x: number; y: number; dir: number; size?: number; segments?: number }): Machine {
    const size = o.size ?? 0.55 + Math.random() * 0.15;
    const layout = wormLayout(o.kind, size, 0.35 + Math.random() * 0.65, o.segments);
    const c = Math.cos(o.dir);
    const sn = Math.sin(o.dir);
    const m = {
      id: o.id,
      team: o.team,
      name: layout.name,
      color: o.kind === "armoredworm" ? "#7c8496" : "#c8995a",
      weapon: "hammer",
      sidearm: null,
      guns: [],
      trigger: false,
      aimX: 0,
      aimY: 0,
      plateKind: null,
      plates: [],
      shielding: false,
      grips: [],
      parts: [],
      part: new Map(),
      joints: [],
      grip: null,
      armed: false,
      droppedAt: -10,
      inx: 0,
      iny: 0,
      hp: layout.hp,
      alive: true,
      stun: 0,
      slamUntil: 0,
      diedAt: 0,
      lastHitBy: null,
      flash: 0,
      monster: { kind: o.kind, layout, phase: Math.random() * 10, part: new Map() },
    } as unknown as Machine;
    const make = (cp: (typeof layout.parts)[number]) => {
      const b = new Body(cp.mesh, cp.density).place(o.x + cp.x * c, o.y + cp.x * sn, o.dir + cp.angle);
      b.gravity = false;
      b.group = m.id;
      b.data = { m, hull: true, striker: false, sharpness: cp.sharpness, bladeable: 0, bladeableU: 0, sharpnessU: cp.sharpness, jaws: cp.jaws, spec: null } satisfies Tag;
      this.world.add(b);
      return b;
    };
    m.hull = make(layout.core);
    m.hull.spinDamp = 300000;
    const byKey = new Map<string, Body>([["core", m.hull]]);
    for (const cp of layout.parts) {
      const b = make(cp);
      byKey.set(cp.key, b);
      m.parts.push(b);
      m.monster!.part.set(cp.key, b);
    }
    m.striker = byKey.get("jaw")!;
    m.spec = { kind: "hammer", cls: "hammer", tier: 1, label: layout.name, blurb: "", parts: [], joints: [], striker: "jaw" };
    m.joints = layout.joints.map((j) => this.makeJoint(byKey.get(j.a)!, byKey.get(j.b)!, j));
    this.machines.push(m);
    return m;
  }

  /** Normal speed now (a new round must not start in the last round's slow motion). Also clears shots in the air. */
  resetTime(): void {
    this.timewarp = 1;
    this.slomoTimer = 0;
    for (const sh of this.shots) sh.body.dead = true;
    this.sweepShots();
  }

  /** The grips of the loose weapons that a machine can pick up (the bots fly there when disarmed). */
  looseGrips(): Body[] {
    const out: Body[] = [];
    for (const l of this.loose) {
      const grip = l.holder.part.get(l.spec.joints.find((j) => j.a === "hull")!.b);
      if (grip) out.push(grip);
    }
    return out;
  }

  /** Hold the trigger this frame. */
  fire(m: Machine): void {
    m.trigger = true;
  }

  /**
   * Aim the guns this frame (OURS, the phone's closest match to Hammerfight's mouse): a direction, e.g. the stick.
   * While the trigger is held with an aim, each gun is pulled round the hull to point that way and fires only when it
   * does (within GUN_AIM_TOL). Hammerfight's own guns shoot along their axis with no aim; only its NPC turrets turn
   * toward a target (command 0x400, 0x41d800), and that is the method used here.
   */
  aim(m: Machine, x: number, y: number): void {
    m.aimX = x;
    m.aimY = y;
  }

  /** Hold the shield this frame. */
  shield(m: Machine): void {
    m.shielding = true;
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
        // aiming a loaded sidearm (trigger + a direction) slows the flying, so the gun can come round
        if (m.trigger && m.guns.length && m.armed && m.stun <= 0 && tn.damage > 0 && Math.hypot(m.aimX, m.aimY) > 0.3 && m.guns.some(aimable)) {
          m.inx *= AIM_THRUST;
          m.iny *= AIM_THRUST;
        }
        if (m.monster) this.creatureDrive(m, dt);
        else this.drive(m, dt, K);
        // Shock wears off (base tick 0x411af0): stun −= (R + 1) · dt · 0.5.
        if (m.stun > 0) m.stun = Math.max(0, m.stun - (recovery(m) + 1) * dt * 0.5);
        if (!m.armed && !m.monster) this.tryPickup(m);
      }
      if (m.guns.length) this.guns(m, dt);
      if (m.plates.length > 1 && m.shielding && m.alive && m.stun <= 0) this.spreadPlates(m);
      m.trigger = false;
      m.aimX = m.aimY = 0;
      m.shielding = false;
      m.inx = m.iny = 0;
      this.limit(m);
      // a wreck far below the frame can't come back: stop simulating it (and its hull's joints and contacts)
      if (!m.alive && !this.parked.has(m) && m.hull.y > this.h + OUT_OF_PLAY) {
        this.world.remove(m.hull);
        this.parked.add(m);
      }
    }
    // the same for a loose weapon that fell far below the frame: nobody can reach it again
    if (this.loose.length) for (const l of [...this.loose]) {
      if (l.holder.parts.length && l.holder.parts.every((b) => b.y > this.h + OUT_OF_PLAY)) this.destroy(l.holder);
    }

    this.world.commonForces(tn.gravity);
    this.world.step({ dt, dtPrev: this.dtPrev, gravity: tn.gravity, passes: tn.passes, onContact: this.onContact });
    if (this.brokenBodies.length) {
      for (const b of this.brokenBodies) this.world.remove(b);
      this.brokenBodies.length = 0;
    }
    if (tn.walls) for (const m of this.machines) if (m.alive && !m.monster) this.frameWalls(m, dt);
    if (this.obstacles.length) this.obstacleWalls();
    this.dtPrev = dt;
    this.t += dt;
    if (this.shots.length) this.ageShots();
    // a wreck's pieces stop hurting, then stop colliding
    for (const d of this.debris) {
      const g = (d.body.data as Tag | null)?.gibUntil;
      if (g !== undefined && this.t > g) d.body.solid = false;
    }
    if (this.debris.length && this.t - this.debris[0]!.at > 4) {
      for (const d of this.debris) if (this.t - d.at > 4) this.world.remove(d.body);
      this.debris = this.debris.filter((d) => this.t - d.at <= 4);
    }
    this.slowMotion();
  }

  /** Shield-hold: the plates push each other apart (8e7 in the exe; the fall-off with distance is OURS). */
  private spreadPlates(m: Machine): void {
    const ps = m.plates;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const a = ps[i]!.body;
        const b = ps[j]!.body;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d < 1) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const f = 8e7 * Math.max(0, 1 - d / 160);
        a.applyForce((-dx / d) * f, (-dy / d) * f);
        b.applyForce((dx / d) * f, (dy / d) * f);
      }
    }
  }

  /** Plates: one on each side of the hull, on its rod (type 2), apart from the weapon (they stay on when disarmed). */
  private buildPlates(m: Machine, kind: PlateKind | null): void {
    m.plateKind = kind;
    m.plates = [];
    if (!kind) return;
    const ps = PLATES[kind];
    for (let i = 0; i < PLATE_COUNT; i++) {
      const a = (i / PLATE_COUNT) * Math.PI * 2;
      const b = new Body(ps.mesh, ps.density).place(m.hull.x + Math.cos(a) * ps.rod, m.hull.y + Math.sin(a) * ps.rod, a);
      b.group = m.id;
      b.data = { m, hull: false, striker: false, sharpness: 0.5, bladeable: 0, bladeableU: 0, sharpnessU: 0.5, spec: null, plate: kind } satisfies Tag;
      this.world.add(b);
      const jt = joint(m.hull, b, 2, ps.rod, { necess: 5 });
      this.world.joints.push(jt);
      m.plates.push({ body: b, joint: jt });
    }
  }

  /** A plate comes off (0x5123c0's list): it falls as debris and goes after a few seconds. */
  private knockPlate(m: Machine, body: Body): void {
    const i = m.plates.findIndex((p) => p.body === body);
    if (i < 0) return;
    const [p] = m.plates.splice(i, 1);
    this.world.removeJoint(p!.joint);
    (body.data as Tag).loose = true;
    body.group = -1;
    this.debris.push({ body, at: this.t });
  }

  private removePlates(m: Machine): void {
    for (const p of m.plates) {
      this.world.removeJoint(p.joint);
      this.world.remove(p.body);
    }
    m.plates = [];
  }

  /** Reload timers, the aim pull, and a shot from every ready gun while the trigger is held (0x4184xx). */
  private guns(m: Machine, dt: number): void {
    const canFire = m.trigger && m.alive && m.armed && m.stun <= 0 && this.tuning.damage > 0;
    const al = Math.hypot(m.aimX, m.aimY);
    const aiming = canFire && al > 0.3;
    for (const g of m.guns) {
      if (g.timer > 0) {
        g.timer -= dt;
        if (g.timer <= 0) {
          g.timer = 0;
          if (g.ammo <= 0) g.ammo = g.spec.clip;
        }
      }
      const b = g.body;
      // only a loaded sidearm aims (a reloading gun or the tribune's back blade keeps its place)
      const aimThis = aiming && aimable(g);
      // the tie that holds a gun across from its weapon gives way while it aims
      for (const j of m.joints) if (j.type === 0 && (j.a === b || j.b === b)) j.strength = aimThis ? 0 : 1;
      (b.data as Tag).aiming = aimThis;
      let aligned = true;
      if (aimThis) {
        const ux = m.aimX / al;
        const uy = m.aimY / al;
        // the turret pull: a damped spring toward the point on the gun's rod circle that faces the aim
        const rod = m.grips.find((j) => j.b === b)?.radius ?? 20;
        const h = m.hull;
        const ex = h.x + ux * rod - b.x;
        const ey = h.y + uy * rod - b.y;
        b.applyForce(b.mass * (GUN_AIM_K * ex - GUN_AIM_D * (b.vx - h.vx)), b.mass * (GUN_AIM_K * ey - GUN_AIM_D * (b.vy - h.vy)));
        aligned = Math.cos(b.a) * ux + Math.sin(b.a) * uy > Math.cos(GUN_AIM_TOL);
      }
      if (!canFire || !aligned || g.timer > 0 || g.ammo < 1) continue;
      g.ammo--;
      g.timer = g.ammo > 0 ? g.spec.interval : g.spec.reload;
      this.shoot(m, g, dt);
    }
  }

  private shoot(m: Machine, g: GunState, dt: number): void {
    const gs = g.spec;
    const b = g.body;
    let px = 0;
    let py = 0;
    for (let i = 0; i < gs.pellets; i++) {
      const a = b.a + (Math.random() * 2 - 1) * gs.spread;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      // spawn at the muzzle (the gun's edge along its aim) and one step on, so it starts clear of the gun
      const d = b.radius + gs.shotR + 1 + (i % 2) * gs.shotR * 2;
      const x = b.x + dx * d;
      const y = b.y + dy * d;
      const shot = new Body(octagon(gs.shotR), gs.shotDensity).place(x, y, a);
      // the muzzle speed plus the gun's own motion
      shot.setVelocity(b.vx + dx * gs.speed, b.vy + dy * gs.speed, 0, dt);
      shot.group = m.id;
      shot.team = this.tuning.teamCollision >= 1 ? -1 : m.team;
      shot.spinDamp = 0;
      // a rocket flies straight under its own thrust and goes off on the first touch
      if (gs.blast) shot.gravity = false;
      const sh: Shot = {
        body: shot,
        look: gs.look,
        r: gs.shotR,
        born: this.t,
        contacts: 0,
        maxContacts: gs.blast ? 1 : gs.look === "ball" ? BALL_CONTACTS : SHOT_CONTACTS,
        blast: gs.blast,
      };
      shot.data = { m, hull: false, striker: false, sharpness: gs.shotSharpness, bladeable: 0, bladeableU: 0, sharpnessU: gs.shotSharpness, spec: null, shot: sh } satisfies Tag;
      this.world.add(shot);
      this.shots.push(sh);
      px += shot.mass * dx * gs.speed;
      py += shot.mass * dy * gs.speed;
    }
    // the mortar kicks back (the exe: an impulse equal to the balls' momentum)
    if (gs.recoil > 0) b.setVelocity(b.vx - (px * gs.recoil) / b.mass, b.vy - (py * gs.recoil) / b.mass, b.w, dt);
    if (this.shots.length > MAX_SHOTS) for (let i = 0; i < this.shots.length - MAX_SHOTS; i++) this.shots[i]!.body.dead = true;
    this.events.push({ type: "shot", m, ball: gs.look === "ball", x: b.x, y: b.y });
  }

  /** Shots that hit their limit, grew old or left the frame go, all at once. */
  private ageShots(): void {
    let any = false;
    for (const sh of this.shots) {
      const b = sh.body;
      if (sh.contacts >= sh.maxContacts || this.t - sh.born > SHOT_LIFE || b.x < -80 || b.x > this.w + 80 || b.y < -80 || b.y > this.h + 80) b.dead = true;
      if (b.dead) {
        any = true;
        if (sh.blast) this.blast(sh);
      }
    }
    if (any) this.sweepShots();
  }

  /** A rocket goes off: everything near is pushed away, and machines take damage (less at the edge). */
  private blast(sh: Shot): void {
    const bl = sh.blast!;
    const { x, y } = sh.body;
    const owner = (sh.body.data as Tag).m;
    sh.blast = undefined;
    const dt = STEP * this.timewarp;
    for (const b of this.world.bodies) {
      if (b === sh.body || b.dead) continue;
      const dx = b.x - x;
      const dy = b.y - y;
      const d = Math.hypot(dx, dy);
      if (d > bl.radius) continue;
      const k = 1 - d / bl.radius;
      const nx = d > 0 ? dx / d : 0;
      const ny = d > 0 ? dy / d : -1;
      b.setVelocity(b.vx + nx * bl.push * k, b.vy + ny * bl.push * k, b.w, dt);
    }
    if (this.tuning.damage > 0) {
      for (const m of this.machines) {
        if (!m.alive || (m !== owner && m.team === owner.team && this.tuning.teamDamage < 1)) continue;
        const d = Math.hypot(m.hull.x - x, m.hull.y - y);
        if (d > bl.radius) continue;
        const k = 1 - d / bl.radius;
        m.stun = Math.min(1, m.stun + 0.5 * k);
        this.damage(m, Math.round(bl.damage * k * (this.tuning.damage / 0.1)), owner, true, bl.push * k, 1, m.hull.x, m.hull.y);
      }
    }
    this.events.push({ type: "blast", m: owner, radius: bl.radius, x, y });
  }

  private sweepShots(): void {
    // one pass over the body list instead of a splice per shot
    this.world.bodies = this.world.bodies.filter((b) => !b.dead);
    let k = 0;
    for (const sh of this.shots) if (!sh.body.dead) this.shots[k++] = sh;
    this.shots.length = k;
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
      const shield = m.shielding && m.plates.length ? 0.5 : 1;
      let fx = m.inx * tn.thrust * 0.6 * K * shield;
      let fy = m.iny * tn.thrust * 0.6 * K * shield;
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

  /**
   * Polypod movement (0x433cd0): runs only while not stunned. Toward the nearest enemy machine: push from far, lunge in
   * pulses × 2(1 + sin 3t) inside 150 px, back off inside 70 px. A side-to-side wiggle (ours) makes it slither; every
   * part feels a drag like m_spasm_dump, and the core's speed is capped.
   */
  private creatureDrive(m: Machine, dt: number): void {
    const st = m.monster!;
    const core = m.hull;
    const all = [core, ...m.parts];
    for (const b of all) b.applyForce(-1.5 * b.mass * b.vx, -1.5 * b.mass * b.vy);
    if (m.stun > 0) return;
    let target: Machine | null = null;
    let best = Infinity;
    for (const o of this.machines) {
      if (o === m || !o.alive || o.team === m.team || o.monster) continue;
      const d = Math.hypot(o.hull.x - core.x, o.hull.y - core.y);
      if (d < best) {
        best = d;
        target = o;
      }
    }
    const t = this.t + st.phase;
    let hx: number;
    let hy: number;
    let k: number;
    if (target) {
      hx = (target.hull.x - core.x) / (best || 1);
      hy = (target.hull.y - core.y) / (best || 1);
      k = best > 150 ? 1 : best > 70 ? 2 * (1 + Math.sin(3 * t)) * 0.5 : -0.8;
    } else {
      // nobody to hunt: drift round the middle of the arena
      const cx = this.w / 2 + Math.cos(t * 0.4) * 250 - core.x;
      const cy = this.h / 2 + Math.sin(t * 0.6) * 120 - core.y;
      const d = Math.hypot(cx, cy) || 1;
      hx = cx / d;
      hy = cy / d;
      k = 0.5;
    }
    const wig = Math.sin(t * 5) * 0.6;
    // Not in Hammerfight (its arenas have walls): near an edge, steer back inside the frame so the fight stays in
    // view. The top margin is bigger: the score cards cover the top of the screen.
    const edge = (v: number, lo: number, hi: number) => (v < lo ? (lo - v) / EDGE_M : v > hi ? -(v - hi) / EDGE_M : 0);
    const ex = 2 * Math.max(-1.5, Math.min(1.5, edge(core.x, EDGE_M, this.w - EDGE_M)));
    const ey = 2 * Math.max(-1.5, Math.min(1.5, edge(core.y, EDGE_TOP, this.h - EDGE_M)));
    const ax = (hx * k - hy * wig + ex) * 750 * st.layout.force;
    const ay = (hy * k + hx * wig + ey) * 750 * st.layout.force;
    // pull at the head end: the core and the jaw share the push for the whole body
    let mass = 0;
    for (const b of all) mass += b.mass;
    const jaw = m.striker;
    const share = jaw.mass / (jaw.mass + core.mass);
    jaw.applyForce(ax * mass * share, ay * mass * share);
    core.applyForce(ax * mass * (1 - share), ay * mass * (1 - share));
    // top speed for the core
    const sp = Math.hypot(core.vx, core.vy);
    const cap = 300;
    if (sp > cap) {
      core.px = core.x - (core.vx / sp) * cap * dt;
      core.py = core.y - (core.vy / sp) * cap * dt;
    }
  }

  /**
   * Hard walls on all four frame edges for a live hull, so a machine (with its rotor) never leaves the picture
   * (play tests: machines went out of view at the top and bottom, then at the sides). Hammerfight's arena clamp
   * (RE_ARENAS.md §1) is also hard; ours bounces off with the game's restitution (0.3) instead of a dead stop.
   */
  private frameWalls(m: Machine, dt: number): void {
    const h = m.hull;
    const wall = (pos: number, prev: number, lo: number, hi: number): [number, number, number, boolean, number] | null => {
      if (pos >= lo && pos <= hi) return null;
      const v = (pos - prev) / dt;
      const at = pos < lo ? lo : hi;
      const out = at === lo ? v < 0 : v > 0;
      // the speed into the wall turns round at 0.3; a speed already away from it is kept
      const nv = out ? -0.3 * v : v;
      return [at, at - nv * dt, nv, out, Math.abs(v)];
    };
    const y = wall(h.y, h.py, WALL_TOP, this.h - WALL_BOTTOM);
    if (y) [h.y, h.py, h.vy] = y;
    const x = wall(h.x, h.px, WALL_SIDE, this.w - WALL_SIDE);
    if (x) [h.x, h.px, h.vx] = x;
    // a stunned machine knocked into a wall: a slam (the impact as a hull-on-wall collision would give)
    const hit = Math.max(y?.[3] ? y[4] : 0, x?.[3] ? x[4] : 0);
    if (hit > WALL_SLAM_V) this.slam(m, (h.mass * 1.3 * hit) * 1e-5, h.x, h.y);
  }

  /** Not in Hammerfight: a stiff spring a little outside the fixed camera frame at the sides (with the walls off). */
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
    const ax = axis(h.x, h.vx, -tn.limit, this.w + tn.limit);
    if (ax) h.applyForce(ax * h.mass, 0);
  }

  /** A new arena size and obstacle layout (between rounds). */
  setArena(w: number, h: number, obstacles: ObstacleSpec[]): void {
    this.w = w;
    this.h = h;
    this.layout++;
    for (const b of this.ropeAnchors) this.world.remove(b);
    this.ropeAnchors = [];
    for (const o of this.obstacles) this.world.remove(o.body);
    this.obstacles = [];
    this.obstacleOf.clear();
    for (const s of obstacles) {
      const dynamic = s.kind === "cage" || s.kind === "block";
      const mesh = s.kind === "block" ? octagon(s.hw) : [-s.hw, -s.hh, s.hw, -s.hh, s.hw, s.hh, -s.hw, s.hh];
      // density 0: static (it never moves; the solver gives it no share of a correction)
      const body = new Body(mesh, dynamic ? (s.d ?? 40) : 0).place(s.x, s.y, s.a ?? 0);
      body.gravity = dynamic;
      const hp = breakable(s.kind) ? (s.hp ?? 30) : Infinity;
      const o: Obstacle = { kind: s.kind, body, hw: s.hw, hh: s.hh, hp, max: hp };
      this.world.add(body);
      if (s.kind === "cage" && s.rope) {
        // Hammerfight hangs its cages on ropes (joint type 5) from a beam: a static, non-solid anchor here
        const anchor = new Body([-1, -1, 1, -1, 1, 1, -1, 1], 0).place(s.rope.x, s.rope.y, 0);
        anchor.gravity = false;
        anchor.solid = false;
        this.world.add(anchor);
        this.world.joints.push(joint(anchor, body, JointType.Rope, s.rope.len, { sby: -s.hh }));
        o.rope = { x: s.rope.x, y: s.rope.y };
        this.ropeAnchors.push(anchor);
      }
      this.obstacles.push(o);
      this.obstacleOf.set(body, o);
    }
  }
  /** The static bodies that hold the cage ropes (removed with the layout). */
  private ropeAnchors: Body[] = [];

  /** Loose obstacles (blocks, a cage off its rope) stay inside the frame: the same walls as the hulls, no slam. */
  private obstacleWalls(): void {
    for (const o of this.obstacles) {
      if (o.body.invMass === 0) continue;
      const b = o.body;
      const r = b.radius;
      if (b.x < r) b.x = b.px = r;
      else if (b.x > this.w - r) b.x = b.px = this.w - r;
      if (b.y > this.h - r) b.y = b.py = this.h - r;
    }
  }

  /** A weapon, shot or machine hits a crate: the game's damage formula (blunt rule included) takes its health. */
  private hitObstacle(o: Obstacle, by: Tag, byBody: Body, c: ContactReport): void {
    // no damage in the warm-up (damage 0): the crates are there for the fight
    if (!breakable(o.kind) || o.hp <= 0 || by.aiming || !this.owned(by) || this.tuning.damage <= 0) return;
    const impact = c.impulse * 1e-5;
    if (!by.shot && c.approach < this.tuning.bluntMinV) return;
    const dmg = Math.floor(this.tuning.damage * Math.max(1, by.sharpness) * impact);
    if (dmg <= 0) return;
    o.hp -= dmg;
    this.events.push({ type: "crack", by: by.m, obstacle: o, dmg, x: c.x, y: c.y });
    if (o.hp > 0) return;
    // this runs inside the collision loop: switch the body off now and take it out of the world after the step
    o.body.solid = false;
    this.brokenBodies.push(o.body);
    this.obstacles = this.obstacles.filter((x) => x !== o);
    this.obstacleOf.delete(o.body);
    // splinters fly from the crate and hurt the others for a moment (they are the breaker's: not the breaker)
    this.shards(by.m, o.body.x, o.body.y, Math.min(o.hw, o.hh), 4, byBody.vx * 0.3, byBody.vy * 0.3, true, by.credit ?? by.m);
    this.events.push({ type: "break", by: by.m, obstacle: o, x: o.body.x, y: o.body.y });
  }

  private onContact = (c: ContactReport): void => {
    const oa = this.obstacleOf.get(c.a);
    const ob = this.obstacleOf.get(c.b);
    if (oa || ob) {
      const t = (oa ? c.b.data : c.a.data) as Tag | null;
      if (!t) return;
      // a reeling machine smashed into a crate or a pillar
      if (t.hull) this.slam(t.m, c.impulse * 1e-5, c.x, c.y);
      this.hitObstacle((oa ?? ob)!, t, oa ? c.b : c.a, c);
      return;
    }
    const ta = c.a.data as Tag | null;
    const tb = c.b.data as Tag | null;
    if (!ta || !tb || ta.m === tb.m) return;
    if (ta.shot) ta.shot.contacts++;
    if (tb.shot) tb.shot.contacts++;
    const impact = c.impulse * 1e-5;
    if (impact <= 0) return;

    // A slam: a machine still reeling from a stunning hit runs into another machine or into debris (not into a
    // weapon: that is a hit of its own). OURS.
    if (ta.hull && (tb.hull || !this.owned(tb))) this.slam(ta.m, impact, c.x, c.y);
    if (tb.hull && (ta.hull || !this.owned(ta))) this.slam(tb.m, impact, c.x, c.y);

    if (!ta.hull && !tb.hull) {
      if (impact > 15) this.events.push({ type: "clash", a: ta.m, b: tb.m, impact, x: c.x, y: c.y });
      if (ta.plate && !tb.plate) this.plateHit(c.a, ta, c.b, tb, impact, c);
      else if (tb.plate && !ta.plate) this.plateHit(c.b, tb, c.a, ta, impact, c);
      if (ta.striker && tb.striker) this.clash(c.a, ta, c.b, tb, impact, c);
      return;
    }
    // Each collision hurts both sides (onHit on both bodies).
    if (tb.hull) this.hurt(tb.m, c.b, ta, c.a, impact, c);
    if (ta.hull) this.hurt(ta.m, c.a, tb, c.b, impact, c);
  };

  /** Stun from a slam (see onContact and the walls); once per stunning hit. */
  private slam(m: Machine, impact: number, x: number, y: number): void {
    if (!m.alive || this.t >= m.slamUntil || impact < 20 || this.tuning.damage <= 0) return;
    m.slamUntil = 0;
    m.stun = Math.min(this.tuning.stunMax, m.stun + this.tuning.slam * impact);
    this.events.push({ type: "slam", m, impact, x, y });
  }

  /** Is this body still held by a live machine? Loose weapons and wrecks are "unowned". */
  private owned(t: Tag): boolean {
    // a wreck's flying pieces hurt like a weapon for a moment
    if (t.gibUntil !== undefined) return this.t < t.gibUntil;
    // a shot stays its shooter's, even after the shooter is wrecked
    return !!t.shot || (t.m.alive && (t.hull || (t.plate ? !t.loose : t.m.armed)));
  }

  /** Damage (0x410340) and shock. */
  private hurt(victim: Machine, vBody: Body, by: Tag, byBody: Body, impact: number, c: ContactReport): void {
    if (!victim.alive) return;
    // Damage off (the warm-up): no damage and no stun either. An aiming gun only pushes.
    if (this.tuning.damage <= 0 || by.aiming) return;
    // Friendly fire off: teammates' hits only push.
    if (by.m !== victim && by.m.team === victim.team && this.tuning.teamDamage < 1) return;
    const tn = this.tuning;
    const owned = this.owned(by);
    // Unowned blunt things (a wreck, a loose chain) count for 10 % against a machine.
    const effect = !owned && by.sharpness <= 1 ? COLLISION_EFFECT : 1;

    // which edge touched (edgeAt); then blades cut harder the faster they slide across
    edgeAt(by, byBody, c.x, c.y);
    let { bladeable, sharpness } = edgeOut;
    // armoured monsters: blades get no cut bonus (the game's tips: swords are weak against heavy armour)
    let cut = victim.monster?.layout.armored ? 1 : cutFactor(byBody, bladeable, c.nx, c.ny);

    // Hit types (OURS, see tuning): the hit counts by how the two bodies meet, not just by the impulse.
    // A slow slide is no slice; a blunt touch needs real approach speed (a mace head resting on a machine, or
    // pressed against it, no longer grinds health away); a blade's edge rammed in head-on does less.
    // (speeds at the contact point, before the impulse: collide.ts)
    if (cut > 1 && c.rel < tn.cutMinV) cut = 1;
    const blunt = cut <= 1;
    if (blunt && !by.shot && !by.jaws && c.approach < tn.bluntMinV) return; // (a monster bite is not a blow)
    if (blunt && bladeable > 0) sharpness *= tn.bladeRam;

    // Shock: big hits switch the victim's engine off for a moment (only M > 30, +0.01·M; m_extra_shock on the
    // weapon, the wooden hammer's 4, makes its stuns longer). OURS: blunt hits stun stunScale ×, cuts stunCut of
    // that, up to stunMax; and for 0.8 s after, hitting something adds more (a slam, see onContact).
    if (impact > 30) {
      const kind = blunt ? 1 : tn.stunCut;
      victim.stun = Math.min(tn.stunMax, victim.stun + SHOCK_VALUE * EXTRA_SHOCK * (by.spec?.extraShock ?? 1) * impact * 0.5 * effect * tn.stunScale * kind);
      victim.slamUntil = this.t + SLAM_S;
    }

    const bonus = by.shot && victim.monster && by.shot.look === "bullet" ? MONSTER_SHOT_BONUS : 1;
    let dmg = Math.floor(this.tuning.damage * sharpness * cut * impact * effect * bonus);
    // a bite (0x410340): m_jaws adds rand(0.3, 3) × jaws
    if (by.jaws && dmg > 0) dmg += Math.round((0.3 + Math.random() * 2.7) * by.jaws);
    if (dmg <= 0) return;
    this.damage(victim, dmg, by.credit ?? by.m, owned, impact, cut, c.x, c.y);

    // GAME_SLOMO (0x483b94): v = 0.15 · M · (40000/(victimMass + 15001) + 0.25); v > 27, or a fast blade (cut > 4),
    // slows time. OURS: the limits are SLOMO_V and SLOMO_CUT. With the exe's 27, a hit on a machine needs an impact
    // of about 243, and in a 30-minute soak of every melee weapon the hardest hit was 167: slow motion never showed.
    const v = 0.15 * impact * (40000 / (vBody.mass + 15001) + 0.25);
    if ((v > SLOMO_V || cut > SLOMO_CUT) && this.tuning.slomo >= 1 && this.timewarp === 1) {
      this.timewarp = 0.3;
      this.slomoTimer = 2;
    }
  }

  /** Take `dmg` off a machine (the health_low rule), report it, and wreck it at 0. */
  private damage(victim: Machine, dmg: number, attacker: Machine, owned: boolean, impact: number, cut: number, x: number, y: number): void {
    if (!victim.alive || dmg <= 0) return;
    // health_low rule: below 12 only a lethal hit counts; the first lethal hit leaves 12, the next one kills.
    // In sudden death (ours, to end long rounds) every hit simply subtracts.
    const before = victim.hp;
    const low = MACHINE.healthLow;
    if (this.suddenDeath || victim.monster) {
      // monsters have no health_low rule either
      victim.hp = Math.max(0, victim.hp - dmg);
    } else if (victim.hp - dmg > 0) {
      if (victim.hp > low) victim.hp -= dmg;
    } else if (victim.hp !== low) {
      victim.hp = low;
    } else {
      victim.hp = 0;
    }
    if (owned) victim.lastHitBy = attacker;
    victim.flash = 0.12;
    this.events.push({ type: "hit", attacker, victim, dmg: before - victim.hp, impact, cut, x, y });
    if (victim.hp <= 0) this.wreck(victim);
  }

  /** A weapon much faster than the plate, hitting hard enough, knocks it off (m_overkill). */
  private plateHit(pBody: Body, pt: Tag, wBody: Body, wt: Tag, impact: number, c: ContactReport): void {
    const m = pt.m;
    if (!m.alive || this.tuning.damage <= 0 || !m.plates.some((p) => p.body === pBody)) return;
    if (wt.m.team === m.team && this.tuning.teamDamage < 1) return;
    const sp = Math.hypot(pBody.vx, pBody.vy);
    const sw = Math.hypot(wBody.vx, wBody.vy);
    const need = PLATES[pt.plate!].overkill * 100 * (m.hp <= MACHINE.healthLow ? 0.25 : 1);
    if ((sw + 1) / (sp + 1) <= 1.5 || impact <= need) return;
    this.knockPlate(m, pBody);
    this.events.push({ type: "plateoff", m, by: wt.m, x: c.x, y: c.y });
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
    for (const g of m.grips) this.world.removeJoint(g);
    if (m.grips.length) m.joints = m.joints.filter((j) => !m.grips.includes(j));
    m.grips = [];
    m.grip = null;
    m.armed = false;
    m.droppedAt = this.t;
    if (m.parts.length) this.loose.push({ holder: m, kind: m.weapon, sidearm: m.sidearm, spec: m.spec });
  }

  /** Not in Hammerfight's code as we read it: a weaponless machine takes a loose weapon by flying into its grip. */
  private tryPickup(m: Machine): void {
    if (this.t - m.droppedAt < PICKUP_DELAY) return;
    for (let i = 0; i < this.loose.length; i++) {
      const l = this.loose[i]!;
      const grip = l.holder.part.get(l.spec.joints.find((j) => j.a === "hull")!.b);
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
      const guns = from.guns;
      if (from !== m) from.guns = [];
      m.parts = parts;
      m.part = part;
      m.joints = joints;
      m.weapon = l.kind;
      m.sidearm = l.sidearm;
      m.spec = l.spec;
      m.guns = guns;
      m.striker = part.get(l.spec.striker)!;
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

  /** A machine is destroyed (health 0): it drops its weapon and plates, falls, and bursts into shards. */
  wreck(m: Machine): void {
    m.alive = false;
    m.diedAt = this.t;
    m.stun = 0;
    this.drop(m);
    for (const p of [...m.plates]) this.knockPlate(m, p.body);
    m.hull.gravity = true;
    m.hull.spinDamp = 300000;
    if (m.monster) for (const b of m.parts) b.gravity = true;
    m.hull.setVelocity(m.hull.vx, m.hull.vy, (Math.random() - 0.5) * 12, STEP * this.timewarp);
    if (!m.monster) this.gibs(m);
    this.events.push({ type: "ko", victim: m, by: m.lastHitBy, x: m.hull.x, y: m.hull.y });
  }

  /**
   * OURS (Hammerfight's detached parts are harmless layer-0 debris): the wreck bursts into a few heavy shards that
   * fly out and hurt like a weapon (sharpness 3, owned by the wreck) for GIB_HARM_S, then fall through everything
   * and go with the other debris after 4 s.
   */
  private gibs(m: Machine): void {
    this.shards(m, m.hull.x, m.hull.y, 10, Math.max(0, Math.round(this.tuning.gibs)), m.hull.vx, m.hull.vy, false, m.lastHitBy);
  }

  /** `n` flying shards from (x, y), owned by `owner` (they don't hit it), harmful for GIB_HARM_S. */
  private shards(owner: Machine, x: number, y: number, r: number, n: number, vx: number, vy: number, wood = false, credit: Machine | null = owner): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const w = 4 + Math.random() * 3;
      const t = 2.5 + Math.random() * 2;
      // a jagged quad, a little different each time
      const mesh = [-w, -t, w * (0.6 + Math.random() * 0.5), -t * 0.6, w, t, -w * (0.5 + Math.random() * 0.5), t * 0.8];
      const b = new Body(mesh, 80).place(x + Math.cos(a) * r, y + Math.sin(a) * r, a);
      const s = 280 + Math.random() * 220;
      b.setVelocity(vx + Math.cos(a) * s, vy + Math.sin(a) * s - 120, (Math.random() - 0.5) * 30, STEP * this.timewarp);
      b.group = owner.id; // they start inside the wreck: not against it, nor each other
      b.data = { m: owner, hull: false, striker: false, sharpness: 3, bladeable: 0, bladeableU: 0, sharpnessU: 3, spec: null, gibUntil: this.t + GIB_HARM_S, credit, ...(wood ? { wood: true } : {}) } satisfies Tag;
      this.world.add(b);
      this.debris.push({ body: b, at: this.t });
    }
  }

  /** Remove the machine's weapon bodies and joints (the hull stays). */
  private destroy(m: Machine): void {
    for (const j of m.joints) this.world.removeJoint(j);
    for (const b of m.parts) this.world.remove(b);
    this.loose = this.loose.filter((l) => l.holder !== m);
    m.joints = [];
    m.parts = [];
    m.part = new Map();
    m.guns = [];
    m.grip = null;
    m.grips = [];
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
  private buildWeapon(m: Machine, kind: WeaponKind, sidearm: GunKind | null): void {
    const spec = armedSpec(kind, sidearm);
    const { x, y } = m.hull;
    m.weapon = kind;
    m.sidearm = sidearm;
    m.spec = spec;
    m.parts = [];
    m.part = new Map();
    m.guns = [];
    for (const p of spec.parts) {
      // Hanging straight down: local +x (away from the machine) points along world +y.
      const b = new Body(p.mesh, p.density).place(x, y + p.hang, p.angle ?? Math.PI / 2);
      b.group = m.id;
      b.solid = solidPart(kind, p.key);
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
      if (p.gun) m.guns.push({ spec: p.gun, body: b, ammo: p.gun.clip, timer: 0 });
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

  /** Join the weapon to the hull (every hull joint: a dual set or a sidearm has two). */
  private attach(m: Machine): void {
    m.grips = [];
    for (const j of m.spec.joints) {
      if (j.a !== "hull") continue;
      const g = this.makeJoint(m.hull, m.part.get(j.b)!, j);
      m.grips.push(g);
      m.joints.push(g);
    }
    m.grip = m.grips[0] ?? null;
    m.armed = true;
  }

  private makeJoint(a: Body, b: Body, j: WeaponSpec["joints"][number]): Joint {
    const jt = joint(a, b, j.type, j.radius, { sax: j.sax ?? 0, say: j.say ?? 0, sbx: j.sbx ?? 0, sby: j.sby ?? 0, necess: j.necess });
    this.world.joints.push(jt);
    return jt;
  }
}

const octagons = new Map<number, number[]>();
/** A round shot's mesh (shared per radius). */
function octagon(r: number): number[] {
  let v = octagons.get(r);
  if (!v) {
    v = [];
    for (let i = 0; i < 8; i++) v.push(Math.cos((i / 8) * Math.PI * 2) * r, Math.sin((i / 8) * Math.PI * 2) * r);
    octagons.set(r, v);
  }
  return v;
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
