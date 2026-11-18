// Computer players. They steer through the phone's own stick model (arenas.ts stickPush, the hammer.pad tune), so
// they have exactly a player's power: their strength is skill, not force.
//
// Three layers (design: Fable's advice, 2026-11-16; measured with bots.bench.ts and swing.bench.ts):
//  1. Skill core, the same for every bot: read the weapon head (spin, speed, phase), pump it up (thrust at a right
//     angle to the rod, against the head's motion), put the head's path through the target, time the step in,
//     see the enemy heads coming and leave their band, re-hit in the stun, wait for a killing blow at 12 health.
//  2. Personalities (PROFILES): one readable strategy each, pushed to the limit, with weapons that suit it.
//  3. Drama: tie-breakers only (grudges, third-party dives on stunned machines, an engagement clock against long
//     orbits, a pull to the middle of the stage). They choose between moves of near-equal value.

import { STICK_DEFAULTS, type StickTune, stickPush } from "./arenas.ts";
import type { Body } from "./engine.ts";
import { aimable, type Arena, EDGE_M, edgeTop, type Machine, STEP } from "./sim.ts";
import { type Face, type GunKind, type PlateKind, WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

export type BotMode = "idle" | "wander" | "fight";

/** How a personality fights. The skill core is the same; the style picks the strike shape and the special move. */
type Style = "ring" | "lance" | "graze" | "stun" | "heavy" | "counter" | "flak" | "jackal";

export interface Profile {
  id: ProfileId;
  /** The name on the TV. */
  name: string;
  /** One line for the menus and the bench. */
  blurb: string;
  style: Style;
  /** Weapons in order of preference (the first most often). */
  weapons: WeaponKind[];
  gun: GunKind | null;
  plate: PlateKind | null;
  /** Hull distance from the target, as a share of the own head radius (1 = the head's path through the target's centre). */
  standoff: number;
  /** Extra distance while the head is not in phase (0 = always in; the lunge closes it). */
  gap: number;
  /** Strike only with a head at least this share of the weapon's top swing speed. */
  gate: number;
  /** Share of the thrust that keeps pumping the swing while the head is fast enough. */
  pumpMove: number;
  /** Leave an enemy head's band when it sweeps over the hull within this many seconds. */
  dodge: number;
  /** Go inside an enemy's ring (links and rods do not hit) instead of out of its band. */
  inside: boolean;
  /** Target choice: extra score per rule. */
  wStunned: number;
  wWeak: number;
  wGrudge: number;
  wLeader: number;
  wNear: number;
  /** Seconds a target is kept before a better one may take it. */
  commit: number;
  /** Shield up against a sweep (needs plates). */
  shield: boolean;
  /** Seconds to lead the target's motion. */
  lead: number;
  /** Slack (s) on the head's timing for the step in. */
  window: number;
  /** Pull to the strike spot per px (against the pump's unit thrust). */
  pull: number;
  /** Assumed speed of the step in (px/s): the step starts gap/stepV before the head arrives. */
  stepV: number;
}
/** The numbers bots.tune.ts may change (all of them fields of Profile). */
export const TUNABLE = ["standoff", "gap", "gate", "pumpMove", "dodge", "commit", "wStunned", "wWeak", "lead", "window", "pull", "stepV"] as const;

export type ProfileId = "dervish" | "lance" | "razor" | "thump" | "krank" | "bulwark" | "flak" | "jackal" | "pilot";

type Tunable = "wNear" | "wLeader" | "wGrudge" | "lead" | "window" | "pull" | "stepV";
const P = (p: Omit<Profile, Tunable> & Partial<Pick<Profile, Tunable>>): Profile => ({ wNear: 1, wLeader: 0.3, wGrudge: 0.6, lead: 0.15, window: 0.1, pull: 1 / 90, stepV: 380, ...p });

/** The personalities. Each pushes one strategy to the limit; all share the skill core. */
export const PROFILES: Record<ProfileId, Profile> = {
  dervish: P({ id: "dervish", name: "Dervish", blurb: "A ring of chain that never stops; walks the ring onto you", style: "ring", weapons: ["spikedflail", "stixmace", "starmace"], gun: null, plate: null, standoff: 0.617, gap: 15.6, gate: 0.7, pumpMove: 0.708, dodge: 0.27, inside: false, wStunned: 0.5, wWeak: 0.3, commit: 2, shield: false, lead: 0.123, window: 0.118, pull: 0.013, stepV: 380 }),
  lance: P({ id: "lance", name: "Lance", blurb: "Charges through at top speed; the head whips in at the pass", style: "lance", weapons: ["pike", "klevec", "goldhammer"], gun: "arquebus", plate: "woodlight", standoff: 0.6, gap: 38.35, gate: 0.39, pumpMove: 0.15, dodge: 0.25, inside: false, wStunned: 0.4, wWeak: 0.2, commit: 1.2, shield: false, wNear: 0.3, lead: 0.177, window: 0.1, pull: 0.011, stepV: 380 }),
  razor: P({ id: "razor", name: "Razor", blurb: "Slices in fly-pasts; never meets you head-on", style: "graze", weapons: ["innata", "claw", "saian", "kathib"], gun: null, plate: null, standoff: 0.6, gap: 47.2, gate: 0.52, pumpMove: 0.306, dodge: 0.413, inside: false, wStunned: 0.6, wWeak: 1, commit: 1, shield: false, lead: 0.15, window: 0.1, pull: 0.009, stepV: 291.46 }),
  thump: P({ id: "thump", name: "Thump", blurb: "Stun-lock: heavy blunt hits, and it never lets go", style: "stun", weapons: ["krankhammer", "warhammer", "kolotun"], gun: null, plate: "rusty", standoff: 0.9, gap: 30, gate: 0.233, pumpMove: 0.35, dodge: 0.348, inside: true, wStunned: 3, wWeak: 0.2, commit: 0.8, shield: false, lead: 0.15, window: 0.1, pull: 0.011, stepV: 380 }),
  krank: P({ id: "krank", name: "Krank", blurb: "One huge blow: breaks shields, knocks weapons away", style: "heavy", weapons: ["maul", "silvermace", "palash"], gun: null, plate: "heavyplate", standoff: 0.65, gap: 81, gate: 0.9, pumpMove: 0.7, dodge: 0.203, inside: false, wStunned: 1, wWeak: 0.2, commit: 1.5, shield: true, lead: 0.123, window: 0.1, pull: 0.011, stepV: 247 }),
  bulwark: P({ id: "bulwark", name: "Bulwark", blurb: "Holds its ground behind armour, then hits back at once", style: "counter", weapons: ["goldaxe", "mamba", "axe"], gun: null, plate: "armor", standoff: 0.65, gap: 60.75, gate: 0.81, pumpMove: 0.405, dodge: 0.3, inside: true, wStunned: 1.5, wWeak: 0.2, commit: 0.5, shield: true, lead: 0.15, window: 0.082, pull: 0.011, stepV: 247 }),
  flak: P({ id: "flak", name: "Flak", blurb: "Shoots from below, then dives on whoever reels", style: "flak", weapons: ["severn", "hammer", "kolotun"], gun: "launcher", plate: "silver", standoff: 1, gap: 25.35, gate: 0.39, pumpMove: 0.203, dodge: 0.35, inside: false, wStunned: 2, wWeak: 0.5, commit: 2, shield: true, wLeader: 0.8, lead: 0.15, window: 0.1, pull: 0.011, stepV: 380 }),
  jackal: P({ id: "jackal", name: "Jackal", blurb: "Waits outside every fight and steals the knockout", style: "jackal", weapons: ["klevec", "goldhammer", "berdish"], gun: "mortar", plate: null, standoff: 0.6, gap: 58.5, gate: 0.7, pumpMove: 0.405, dodge: 0.328, inside: false, wStunned: 3, wWeak: 2, commit: 0.3, shield: false, lead: 0.15, window: 0.1, pull: 0.011, stepV: 380 }),
  /** The away-player autopilot: plain skill with the player's own weapon, no show. */
  pilot: P({ id: "pilot", name: "Pilot", blurb: "Autopilot", style: "ring", weapons: [], gun: null, plate: null, standoff: 1, gap: 30, gate: 0.6, pumpMove: 0.35, dodge: 0.3, inside: false, wStunned: 1, wWeak: 0.3, commit: 1, shield: true, wGrudge: 0 }),
};
/** The personalities that seat as computer players, in seating order. */
export const ROSTER: ProfileId[] = ["dervish", "thump", "razor", "krank", "lance", "bulwark", "flak", "jackal"];

/** A weapon's numbers for the bot, read from the bodies (any weapon, also one picked up). */
interface Card {
  striker: Body;
  /** Hull to head distance when taut (running max, slowly decays). */
  L: number;
  /** The fastest head speed seen while pumping (starts from a typical value). */
  vSwing: number;
  /** Closing speed for a 12-damage blunt hit (a kill at 12 health). */
  vFinish: number;
  blade: boolean;
}

export interface Bot {
  mode: BotMode;
  profile: Profile;
  theta: number;
  spin: number;
  homeX: number;
  homeY: number;
  card: Card | null;
  target: Machine | null;
  targetSince: number;
  /** Own random numbers, so the sim's Math.random stream does not shift. */
  rng: number;
  /** Seconds since this bot last hit, was hit or clashed: the engagement clock. */
  quiet: number;
  /** Grudges by machine id (decay over time). */
  grudge: Map<number, number>;
  /** This round's mood: ±10 % on standoff and gap. */
  mood: number;
  /** The intent for the TV and the bench. */
  intent: string;
  /** Lance: the pass in progress (−1: none) and its direction. */
  passUntil: number;
  passX: number;
  passY: number;
  tick: number;
  /** Strike counts (the bench reads them). */
  pumpSteps: number;
  steps: number;
  /** After landing a hit: stand off a little until this arena time (wind up again instead of grinding in). */
  backUntil: number;
  /** Seconds held off the strike spot, and a detour toward the middle (x) until this arena time. */
  held: number;
  detourUntil: number;
  detourX: number;
}

const rand = (b: Bot) => {
  b.rng = (Math.imul(b.rng, 1664525) + 1013904223) >>> 0;
  return b.rng / 4294967296;
};

export function makeBot(mode: BotMode, x: number, y: number, profile: ProfileId = "pilot", seed = 1): Bot {
  const b: Bot = {
    mode,
    profile: PROFILES[profile],
    theta: 0,
    spin: 1,
    homeX: x,
    homeY: y,
    card: null,
    target: null,
    targetSince: 0,
    rng: (seed * 2654435761) >>> 0 || 1,
    quiet: 0,
    grudge: new Map(),
    mood: 1,
    intent: "",
    passUntil: -1,
    passX: 0,
    passY: 0,
    tick: seed % 5,
    pumpSteps: 0,
    steps: 0,
    backUntil: -1,
    held: 0,
    detourUntil: -1,
    detourX: 0,
  };
  b.theta = rand(b) * Math.PI * 2;
  b.spin = rand(b) < 0.5 ? -1 : 1;
  b.mood = 0.9 + rand(b) * 0.2;
  return b;
}

/** A new round: keep the grudges (they make stories across rounds), draw a new mood. */
export function newRound(b: Bot): void {
  b.card = null;
  b.target = null;
  b.quiet = 0;
  b.passUntil = -1;
  b.backUntil = -1;
  b.held = 0;
  b.detourUntil = -1;
  b.mood = 0.9 + rand(b) * 0.2;
  for (const [k, v] of b.grudge) b.grudge.set(k, v * 0.5);
}

/** A loadout for a personality: its first weapon most often, sometimes its second or third. */
export function profileLoadout(id: ProfileId, r: number = Math.random()): { weapon: WeaponKind; gun: GunKind | null; plate: PlateKind | null } {
  const p = PROFILES[id];
  const ws = p.weapons.length ? p.weapons : WEAPON_KINDS;
  const i = r < 0.7 ? 0 : r < 0.9 ? 1 : 2;
  return { weapon: ws[Math.min(i, ws.length - 1)]!, gun: p.gun, plate: p.plate };
}

// ---- the skill core ------------------------------------------------------------------------------

const MACHINE_MASS = 66000;

function card(m: Machine, old: Card | null): Card {
  const s = m.striker;
  if (old && old.striker === s) {
    const r = Math.hypot(s.x - m.hull.x, s.y - m.hull.y);
    old.L = Math.max(old.L * 0.9995, r);
    const v = Math.hypot(s.vx, s.vy);
    if (v > old.vSwing) old.vSwing = old.vSwing * 0.98 + v * 0.02;
    return old;
  }
  const tag = s.data as { sharpness?: number; bladeable?: number } | null;
  const sharp = Math.max(1, tag?.sharpness ?? 1);
  const mu = (s.mass * MACHINE_MASS) / (s.mass + MACHINE_MASS);
  // dmg = floor(0.1 · sharp · impact), impact ≈ 1.3 · mu · v · 1e-5 (cor 0.3)
  const vFinish = (12 / (0.1 * sharp)) * (1e5 / (1.3 * mu));
  return { striker: s, L: Math.max(30, Math.hypot(s.x - m.hull.x, s.y - m.hull.y)), vSwing: 450, vFinish, blade: (tag?.bladeable ?? 0) > 0 };
}

/** The stick that makes the (full) thrust point along (dx, dy): the inverse of stickPush at full tilt. */
function thrustStick(arena: Arena, m: Machine, dx: number, dy: number, t: StickTune): [number, number] {
  const top = arena.tuning.speedClip;
  const k = (t.steer + t.hold) * top;
  const bx = t.steer * m.hull.vx;
  const by = t.steer * m.hull.vy;
  const l = Math.hypot(dx, dy) || 1;
  dx /= l;
  dy /= l;
  const bd = bx * dx + by * dy;
  const lam = -bd + Math.sqrt(Math.max(0, bd * bd - (bx * bx + by * by) + k * k));
  return [(lam * dx + bx) / k, (lam * dy + by) / k];
}

/** Spin of a weapon head about its hull (rad/s, signed) and the head's phase angle. */
function headSpin(m: Machine): { w: number; phase: number; r: number } {
  const h = m.hull;
  const s = m.striker;
  const rx = s.x - h.x;
  const ry = s.y - h.y;
  const r2 = rx * rx + ry * ry || 1;
  return { w: (rx * (s.vy - h.vy) - ry * (s.vx - h.vx)) / r2, phase: Math.atan2(ry, rx), r: Math.sqrt(r2) };
}

/**
 * A striker with one cutting edge and a blunt back (the axes, the one-edged swords, WEAPON_SHAPES.md): 1, the spin
 * that leads with the edge (its +y face: a part on its rod turning the positive way moves along its local +y);
 * otherwise 0 (either way will do).
 */
function edgeSpin(m: Machine): number {
  const f = (m.striker.data as { faces?: readonly Face[] } | null)?.faces;
  if (!f || f[f.length - 1]!.kind !== "blunt") return 0;
  for (const x of f) if (x.kind === "blade" && x.side === 1) return 1;
  return 0;
}

/** Angle from a to b going in the direction of `sign` (0…2π). */
function angTo(a: number, b: number, sign: number): number {
  let d = (b - a) * sign;
  d %= Math.PI * 2;
  return d < 0 ? d + Math.PI * 2 : d;
}

/** Seconds until an enemy head sweeps over the point (x, y) (Infinity when it can't: slow, slack or out of its band). */
function sweepTime(e: Machine, x: number, y: number, me: Machine): number {
  if (!e.alive || !e.armed) return Infinity;
  const s = e.striker;
  const { w, phase, r } = headSpin(e);
  // a head slower than the blunt limit relative to my hull does nothing at all
  if (Math.hypot(s.vx - me.hull.vx, s.vy - me.hull.vy) < 90) return Infinity;
  const d = Math.hypot(x - e.hull.x, y - e.hull.y);
  if (Math.abs(d - r) > s.radius + 26) return Infinity;
  if (Math.abs(w) < 0.8) {
    // not spinning: only a threat if the head itself is flying at me
    const dx = x - s.x;
    const dy = y - s.y;
    const dist = Math.hypot(dx, dy) || 1;
    const closing = (s.vx * dx + s.vy * dy) / dist;
    return closing > 90 ? dist / closing : Infinity;
  }
  return angTo(phase, Math.atan2(y - e.hull.y, x - e.hull.x), Math.sign(w)) / Math.abs(w);
}

const stunTime = (m: Machine) => m.stun / (0.5 * (2.8 * Math.min(1, Math.max(0.1, m.hp / 50)) + 1));

function enemies(arena: Arena, m: Machine): Machine[] {
  const out: Machine[] = [];
  for (const o of arena.machines) if (o !== m && o.alive && o.team !== m.team) out.push(o);
  return out;
}

/** Who each bot is after, per arena: the original's crowd rule (RE_AI.md 4) reads it. */
const claims = new WeakMap<Arena, Map<Machine, Machine>>();
function attackersOn(arena: Arena, o: Machine, me: Machine): number {
  let n = 0;
  const c = claims.get(arena);
  if (c) for (const [a, t] of c) if (t === o && a !== me && a.alive) n++;
  return n;
}

function chooseTarget(arena: Arena, m: Machine, b: Bot, foes: Machine[]): Machine | null {
  const t = pickTarget(arena, m, b, foes);
  let c = claims.get(arena);
  if (!c) claims.set(arena, (c = new Map()));
  if (t) c.set(m, t);
  else c.delete(m);
  return t;
}

function pickTarget(arena: Arena, m: Machine, b: Bot, foes: Machine[]): Machine | null {
  const p = b.profile;
  if (b.target && b.target.alive && b.target.team !== m.team && arena.t - b.targetSince < p.commit) return b.target;
  const lead = foes.reduce((x, o) => Math.max(x, o.hp), 0);
  let best: Machine | null = null;
  let bestS = -Infinity;
  for (const o of foes) {
    const d = Math.hypot(o.hull.x - m.hull.x, o.hull.y - m.hull.y);
    let s = -p.wNear * (d / 300);
    if (o.stun > 0.2) s += p.wStunned;
    s += p.wWeak * (1 - o.hp / 100);
    if (o.hp >= lead && foes.length > 1) s += p.wLeader;
    s += p.wGrudge * (b.grudge.get(o.id) ?? 0);
    if (!o.armed) s += 0.5 * p.wWeak;
    // Jackal: stay off the fights it can't win yet
    if (p.style === "jackal" && o.stun <= 0.2 && o.hp > 25) s -= 1;
    // Flak: the highest machine is the easiest rocket
    if (p.style === "flak") s += ((m.hull.y - o.hull.y) / 300) * 0.5;
    // the original's crowd rule: a second attacker is less keen, a third stays away (fights spread out). A stunned or
    // 12-health machine draws a second attacker (the third-party dive is the drama), but not a third: before
    // 2026-11-17 it drew everyone, and every stun turned into a pile of 3-5 machines (pile anatomy, modes.bench).
    const crowd = attackersOn(arena, o, m);
    const open = o.stun > 0.2 || o.hp <= 12;
    s -= crowd === 0 ? 0 : crowd === 1 ? (open ? 0 : 0.5) : open ? 3 : 2.5;
    // kingslayer: the untouched leader draws everyone (no one sits out a free-for-all)
    if (foes.length > 1) s += (o.hp / 100) * 0.6;
    if (o === b.target) s += 0.25;
    if (s > bestS) {
      bestS = s;
      best = o;
    }
  }
  if (best !== b.target) b.targetSince = arena.t;
  return best;
}

/** Keep off the soft side edges and out from under the score cards; slide round obstacles. */
function stagePush(arena: Arena, m: Machine, out: [number, number]): void {
  const h = m.hull;
  const k = 1 / 80;
  if (h.x < EDGE_M + 40) out[0] += (EDGE_M + 40 - h.x) * k;
  if (h.x > arena.w - EDGE_M - 40) out[0] -= (h.x - (arena.w - EDGE_M - 40)) * k;
  if (h.y < edgeTop(arena) + 20) out[1] += (edgeTop(arena) + 20 - h.y) * k;
  if (h.y > arena.h - EDGE_M - 20) out[1] -= (h.y - (arena.h - EDGE_M - 20)) * k;
  // the next 0.2 s of the hull's path against each obstacle box
  const fx = h.x + h.vx * 0.2;
  const fy = h.y + h.vy * 0.2;
  for (const o of arena.obstacles) {
    if (o.hp <= 0) continue;
    const ox = o.body.x;
    const oy = o.body.y;
    if (o.kind === "saw") {
      // a saw: a wide berth (it cuts); slide round it
      const dx = fx - ox;
      const dy = fy - oy;
      const dc = Math.hypot(dx, dy) || 1;
      const d = dc - o.hw;
      if (d < SAW_BERTH) {
        const f = ((SAW_BERTH - d) / SAW_BERTH) * 2.5;
        out[0] += (dx / dc) * f;
        out[1] += (dy / dc) * f;
      }
      continue;
    }
    const nx = Math.max(ox - o.hw, Math.min(ox + o.hw, fx));
    const ny = Math.max(oy - o.hh, Math.min(oy + o.hh, fy));
    const dx = fx - nx;
    const dy = fy - ny;
    const d = Math.hypot(dx, dy);
    if (d < 45) {
      const f = (45 - d) / 45;
      out[0] += (d > 0 ? dx / d : fx < ox ? -1 : 1) * f * 1.5;
      out[1] += (d > 0 ? dy / d : fy < oy ? -1 : 1) * f * 1.5;
    }
  }
}

/** After landing a hit, a bot stands off this long (s) and this much farther (px): it winds up again instead of grinding in. */
const BACK_S = 0.45;
const BACK_PX = 45;
/** Bots keep this far (px) from machines they are not fighting, allies most of all. */
const SPACE_R = 170;
/** Bots keep this far (px) from a saw's teeth. */
const SAW_BERTH = 90;
/** Strength of the spacing push (1 = the pump's thrust) from others and from allies. */
const SPACE_K = 4;
const SPACE_ALLY = 3;
/** A wall or saw this close (px) to the target is worth hitting it into. */
const SHOVE_R = 260;

/**
 * Spacing (2026-11-17, the play test: "the bots pile on top of each other"): a push away from every machine that is
 * not my target, stronger from allies. With the crowd rule it keeps fights to pairs and threes. O(machines).
 */
function spacing(arena: Arena, m: Machine, T: Machine | null, out: [number, number]): void {
  const h = m.hull;
  for (const o of arena.machines) {
    if (o === m || o === T || !o.alive || o.monster) continue;
    const dx = h.x - o.hull.x;
    const dy = h.y - o.hull.y;
    const d = Math.hypot(dx, dy);
    if (d >= SPACE_R || d < 1) continue;
    const f = ((SPACE_R - d) / SPACE_R) * (o.team === m.team ? SPACE_ALLY : SPACE_K);
    out[0] += (dx / d) * f;
    out[1] += (dy / d) * f;
  }
}

/**
 * The side to strike T from (a unit vector from T toward my spot): turned away from the other attackers on T (flank:
 * no two on one side), and toward the far side of T from a nearby wall or saw, so the hit drives T into it.
 */
function strikeSide(arena: Arena, m: Machine, T: Machine, ux: number, uy: number): [number, number] {
  const c = claims.get(arena);
  if (c) {
    for (const [a, t] of c) {
      if (t !== T || a === m || !a.alive) continue;
      const vx = a.hull.x - T.hull.x;
      const vy = a.hull.y - T.hull.y;
      const vl = Math.hypot(vx, vy) || 1;
      // within ~70° of my side: move off it
      if ((ux * vx + uy * vy) / vl > 0.35) {
        ux += ux - vx / vl;
        uy += uy - vy / vl;
      }
    }
  }
  let best = SHOVE_R;
  let sx = 0;
  let sy = 0;
  for (const o of arena.obstacles) {
    if (o.kind !== "wall" && o.kind !== "saw") continue;
    const dx = T.hull.x - o.body.x;
    const dy = T.hull.y - o.body.y;
    const d = Math.hypot(dx, dy) - Math.max(o.hw, o.hh) * 0.5;
    if (d < best && d > 0) {
      best = d;
      const l = Math.hypot(dx, dy) || 1;
      sx = dx / l;
      sy = dy / l;
    }
  }
  if (best < SHOVE_R) {
    const k = 1.2 * (1 - best / SHOVE_R);
    ux += sx * k;
    uy += sy * k;
  }
  const l = Math.hypot(ux, uy) || 1;
  return [ux / l, uy / l];
}

const onStage = (arena: Arena, x: number, y: number) => x > EDGE_M + 30 && x < arena.w - EDGE_M - 30 && y > edgeTop(arena) + 10 && y < arena.h - EDGE_M - 10;

/** Steer toward (x, y) at up to `speed` px/s with a soft stick (arrive without overshoot). */
function seek(arena: Arena, m: Machine, x: number, y: number, speed: number, t: StickTune): void {
  const h = m.hull;
  let dx = x - h.x;
  let dy = y - h.y;
  const d = Math.hypot(dx, dy);
  const want = Math.min(speed, d * 4);
  if (d > 0) {
    dx = (dx / d) * want;
    dy = (dy / d) * want;
  }
  const top = arena.tuning.speedClip;
  let sx = dx / top;
  let sy = dy / top;
  const l = Math.hypot(sx, sy);
  if (l > 1) {
    sx /= l;
    sy /= l;
  }
  stickPush(arena, m, sx, sy, t);
}

function guns(arena: Arena, m: Machine, enemy: Machine): void {
  for (const g of m.guns) {
    // a reloading gun: don't hold fire (aiming would only slow the flying)
    if (g.ammo < 1) continue;
    const b = g.body;
    const d0 = Math.hypot(enemy.hull.x - b.x, enemy.hull.y - b.y);
    if (d0 > (g.spec.pellets > 1 ? 280 : 650)) continue;
    // lead the target by the shot's flight time
    const tFly = d0 / Math.max(300, g.spec.speed);
    const dx = enemy.hull.x + enemy.hull.vx * tFly - b.x;
    const dy = enemy.hull.y + enemy.hull.vy * tFly - b.y;
    // A sidearm aims as a phone does: hold fire and point at the lead point (sim.ts aim; it fires when lined up).
    // Aiming slows the flying, so only once the gun is roughly that way already. A gun that can't aim (the tribune's
    // back blade) fires along its axis: hold fire only when it points at the target.
    const d = Math.hypot(dx, dy) || 1;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - b.a), Math.cos(Math.atan2(dy, dx) - b.a)));
    if (off < (aimable(g) ? 1.05 : Math.max(0.12, 30 / d))) {
      arena.fire(m);
      arena.aim(m, dx / d, dy / d);
      break;
    }
  }
}

/** Read this frame's events: the engagement clock, grudges, pick-ups. */
function readEvents(arena: Arena, m: Machine, b: Bot): void {
  for (const e of arena.events) {
    if (e.type === "hit") {
      if (e.attacker === m || e.victim === m) b.quiet = 0;
      if (e.attacker === m && e.victim !== m && e.dmg > 0) b.backUntil = arena.t + BACK_S;
      if (e.victim === m && e.attacker !== m) b.grudge.set(e.attacker.id, Math.min(3, (b.grudge.get(e.attacker.id) ?? 0) + e.dmg / 20));
    } else if (e.type === "clash" && (e.a === m || e.b === m)) b.quiet = 0;
    else if (e.type === "ko" && e.victim !== m && e.by && e.by !== m && b.target === e.victim) {
      // a stolen kill
      b.grudge.set(e.by.id, Math.min(3, (b.grudge.get(e.by.id) ?? 0) + 1.5));
    } else if (e.type === "pickup" && e.m === m) b.card = null;
  }
}

export function driveBot(arena: Arena, m: Machine, bot: Bot, tune: StickTune = STICK_DEFAULTS): void {
  if (!m.alive) return;
  const dt = STEP * arena.timewarp;

  if (bot.mode === "idle") {
    seek(arena, m, bot.homeX, bot.homeY + Math.sin(arena.t * 1.3 + m.id) * 6, 120, tune);
    return;
  }
  if (bot.mode === "wander") {
    bot.theta += dt * 0.6 * bot.spin;
    seek(arena, m, bot.homeX + Math.cos(bot.theta) * 140, bot.homeY + Math.sin(bot.theta * 1.7) * 70, 250, tune);
    return;
  }

  readEvents(arena, m, bot);
  bot.quiet += dt;
  for (const [k, v] of bot.grudge) if (v > 0.01) bot.grudge.set(k, v * (1 - dt / 12));
  bot.steps++;
  const p = bot.profile;
  const foes = enemies(arena, m);
  const h = m.hull;

  // disarmed: fly to the nearest loose grip (the pick-up is automatic when the hull is near it)
  if (!m.armed) {
    let g: Body | null = null;
    let gd = Infinity;
    for (const x of arena.looseGrips()) {
      const d = Math.hypot(x.x - h.x, x.y - h.y);
      // only a grip a hull can reach (the pick-up range is 34 px; a hull stays 16 px inside the side walls and 18 px
      // above the floor): one past a side wall or under the floor held disarmed bots against the wall for the round
      if (x.x > -14 && x.x < arena.w + 14 && x.y < arena.h + 12 && d < gd) {
        gd = d;
        g = x;
      }
    }
    bot.intent = "retrieve";
    if (g) seek(arena, m, g.x, g.y + 6, 550, tune);
    else if (foes[0]) {
      // nothing to pick up: keep away from the enemy, but on the stage and on the move (fleeing straight away pinned
      // the machine to a side wall for the rest of the round)
      const x = Math.max(EDGE_M + 60, Math.min(arena.w - EDGE_M - 60, h.x + (h.x - foes[0].hull.x)));
      const y = arena.h * (0.5 + 0.25 * Math.sin(arena.t * 0.8 + m.id));
      seek(arena, m, x, y, 400, tune);
    }
    return;
  }

  bot.card = card(m, bot.card);
  const c = bot.card;
  if (bot.tick++ % 5 === 0 || !bot.target?.alive) bot.target = chooseTarget(arena, m, bot, foes);
  const T = bot.target;
  if (!T) {
    seek(arena, m, bot.homeX, bot.homeY, 300, tune);
    return;
  }

  const head = headSpin(m);
  const s = c.striker;
  const vh = Math.hypot(s.vx, s.vy);
  // keep the spin's sign unless the head is nearly still; from rest, a one-edged weapon winds up edge first (its
  // back is blunt)
  if (Math.abs(head.w) > 1.5) bot.spin = Math.sign(head.w);
  else if (edgeSpin(m)) bot.spin = edgeSpin(m);

  // ---- threat: the soonest enemy sweep over my hull
  let threat: Machine | null = null;
  let tThreat = Infinity;
  for (const e of foes) {
    const tS = sweepTime(e, h.x + h.vx * 0.1, h.y + h.vy * 0.1, m);
    if (tS < tThreat) {
      tThreat = tS;
      threat = e;
    }
  }
  const sudden = arena.suddenDeath;
  // at 12 health only a killing blow (12 or more) hurts: ignore the slow ones (a bold last stand is correct play)
  const lastStand = m.hp <= 12 && !sudden;
  const dodgeLead = p.dodge * (lastStand ? 0.6 : 1);

  const dir: [number, number] = [0, 0];
  const pumpDir = (sign: number): [number, number] => {
    const rx = (s.x - h.x) / (head.r || 1);
    const ry = (s.y - h.y) / (head.r || 1);
    // thrust at a right angle to the rod, against the head's motion about the hull
    return [-sign * -ry, -sign * rx];
  };
  // thrust against the head's motion about the hull: it speeds the head up the way it already turns
  const pump = pumpDir(bot.spin);

  if (threat && tThreat < dodgeLead) {
    // ---- evade: out of the band (or inside the ring, where links and rods do not hit)
    bot.intent = "evade";
    const ex = h.x - threat.hull.x;
    const ey = h.y - threat.hull.y;
    const d = Math.hypot(ex, ey) || 1;
    const rE = headSpin(threat).r;
    const goIn = p.inside && d < rE;
    const sgn = goIn ? -1 : 1;
    dir[0] = (ex / d) * sgn + pump[0] * 0.3;
    dir[1] = (ey / d) * sgn + pump[1] * 0.3;
    if (p.shield && m.plates.length > 1) arena.shield(m);
  } else {
    // ---- strike: the head's path through the target (or grazing its face for a slice)
    const tc = p.lead;
    const tx = T.hull.x + T.hull.vx * tc;
    const ty = T.hull.y + T.hull.vy * tc + (T.stun > 0 ? 0.5 * arena.tuning.gravity * tc * tc : 0);
    let ux = h.x - tx;
    let uy = h.y - ty;
    const du = Math.hypot(ux, uy) || 1;
    ux /= du;
    uy /= du;
    [ux, uy] = strikeSide(arena, m, T, ux, uy);
    const ready = vh >= p.gate * c.vSwing;
    const finishing = T.hp <= 12 && !sudden;
    const strong = !finishing || vh >= c.vFinish * (c.blade ? 0.8 : 1);
    const stunned = T.stun > 0.15 && stunTime(T) > 0.25;
    // engagement clock: from 2 s without action the gap shrinks
    const urge = Math.max(0, Math.min(1, (bot.quiet - 2) / 3));
    // showdown: the last two machines drop their caution (no third party is left to profit)
    const showdown = foes.length === 1 && arena.machines.filter((x) => x.alive).length === 2;
    let gap = p.gap * bot.mood * (1 - urge) * (showdown ? 0.5 : 1);
    // the head's time to the target's bearing, and the time to step in: lunge when they match
    const bearing = Math.atan2(ty - h.y, tx - h.x);
    const tHead = Math.abs(head.w) > 1 ? angTo(head.phase, bearing, Math.sign(head.w)) / Math.abs(head.w) : 9;
    const tStep = gap / p.stepV;
    const inPhase = tHead < tStep + p.window || stunned;
    if (inPhase && ready && strong) gap = 0;
    if (!strong) gap = Math.max(gap, s.radius + 50); // wait outside until a killing blow is wound up
    let want = c.L * p.standoff * bot.mood + (c.blade && p.style === "graze" ? s.radius + 10 : 0) + gap;
    if (arena.t < bot.backUntil && !finishing) want += BACK_PX;
    // Flak keeps its rocket range and Jackal waits outside, but not in a showdown or after a quiet spell
    if (p.style === "flak" && !showdown && !stunned) want = Math.max(want, 220 * (1 - urge));
    if (p.style === "jackal" && !showdown && !stunned && T.hp > 25) want = Math.max(want, c.L * 2.2 * (1 - urge));
    // the spot round the target nearest to my bearing that is on the stage (off the side edges, below the score
    // cards, above the floor band): the fight stays in view, and the target gets hit toward the edges, not me
    let px = tx + ux * want;
    let py = ty + uy * want;
    if (p.style === "flak" && !showdown && !stunned) {
      // sit below the fight (Flak), but on the stage
      py = Math.max(py, ty + 140 * (1 - urge));
    }
    if (!onStage(arena, px, py)) {
      const a0 = Math.atan2(uy, ux);
      for (let k = 1; k <= 6; k++) {
        const a1 = a0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
        const qx = tx + Math.cos(a1) * want;
        const qy = ty + Math.sin(a1) * want;
        if (onStage(arena, qx, qy)) {
          px = qx;
          py = qy;
          break;
        }
      }
      px = Math.max(EDGE_M + 30, Math.min(arena.w - EDGE_M - 30, px));
      py = Math.max(edgeTop(arena) + 10, Math.min(arena.h - EDGE_M - 10, py));
    }
    bot.intent = stunned ? "combo" : finishing ? "finish" : inPhase && ready ? "strike" : "windup";

    // Lance: a straight pass through the target at top speed, the head whipping round at contact
    if (p.style === "lance") {
      if (arena.t < bot.passUntil) {
        px = bot.passX;
        py = bot.passY;
        bot.intent = "charge";
      } else if (du > c.L * 3 && ready) {
        bot.passX = tx - ux * (c.L * 2.5);
        bot.passY = ty - uy * (c.L * 2.5);
        bot.passUntil = arena.t + (du + c.L * 2.5) / 500;
        px = bot.passX;
        py = bot.passY;
      } else if (du < c.L * 3) {
        // back off to the far end for the next run
        px = tx + ux * c.L * 4;
        py = ty + uy * c.L * 4;
      }
    }

    // held off the spot (by a ledge or a wall between, or by the spacing) for over a second: go round, toward the
    // open middle, for a moment (play test 2026-11-17: Flak sat on a balcony over its target under it)
    if (Math.hypot(h.vx, h.vy) < 40 && Math.hypot(px - h.x, py - h.y) > 60) bot.held += dt;
    else bot.held = 0;
    if (bot.held > 1.2) {
      bot.held = 0;
      bot.detourUntil = arena.t + 1;
      bot.detourX = h.x < arena.w / 2 ? Math.min(arena.w / 2, h.x + 320) : Math.max(arena.w / 2, h.x - 320);
    }
    if (arena.t < bot.detourUntil) {
      px = bot.detourX;
      py = h.y;
      bot.intent = "detour";
    }
    const ex = px - h.x;
    const ey = py - h.y;
    const ed = Math.hypot(ex, ey);
    const kPos = p.style === "lance" && bot.intent === "charge" ? 1 / 30 : p.pull;
    const pw = !ready ? 1 : p.pumpMove;
    dir[0] = pump[0] * pw + ex * kPos;
    dir[1] = pump[1] * pw + ey * kPos;
    // close to the spot and slow: hold softer so the swing, not the hull, does the work
    if (ed < 12 && pw === 0) {
      seek(arena, m, px, py, 300, tune);
      return;
    }
    if (bot.intent !== "evade" && p.shield && m.plates.length > 1 && threat && tThreat < 0.25) arena.shield(m);
  }
  if (!ready_(vh, c, p)) bot.pumpSteps++;
  stagePush(arena, m, dir);
  spacing(arena, m, T, dir);
  const [sx, sy] = thrustStick(arena, m, dir[0], dir[1], tune);
  stickPush(arena, m, sx, sy, tune);
  if (m.guns.length) guns(arena, m, T);
}

const ready_ = (vh: number, c: Card, p: Profile) => vh >= p.gate * c.vSwing;

// ---- the bench -----------------------------------------------------------------------------------

/** The bot before the personalities: orbit the nearest enemy at 90 px with raw pad input (100 units a frame). */
function classicDrive(arena: Arena, m: Machine, bot: { theta: number; spin: number; nextFlip: number }, viaStick: boolean): void {
  if (!m.alive) return;
  let enemy: Machine | null = null;
  let best = Infinity;
  for (const o of arena.machines) {
    if (o === m || !o.alive || o.team === m.team) continue;
    const d = Math.hypot(o.hull.x - m.hull.x, o.hull.y - m.hull.y);
    if (d < best) {
      best = d;
      enemy = o;
    }
  }
  if (!enemy) return;
  bot.nextFlip -= STEP;
  if (bot.nextFlip <= 0) {
    bot.spin = -bot.spin;
    bot.nextFlip = 2 + Math.random() * 4;
  }
  bot.theta += STEP * 3.2 * bot.spin;
  const x = Math.min(arena.w - EDGE_M, Math.max(EDGE_M, enemy.hull.x + Math.cos(bot.theta) * 90));
  const y = Math.min(arena.h - EDGE_M, Math.max(edgeTop(arena), enemy.hull.y + Math.sin(bot.theta) * 90));
  if (viaStick) {
    seek(arena, m, x, y, 350, STICK_DEFAULTS);
  } else {
    const h = m.hull;
    let dx = x - h.x;
    let dy = y - h.y;
    const d = Math.hypot(dx, dy);
    const want = Math.min(350, d * 4);
    if (d > 0) {
      dx = (dx / d) * want;
      dy = (dy / d) * want;
    }
    const k = h.mass / (arena.tuning.thrust * 0.6 * STEP);
    let ix = (dx - h.vx) * k;
    let iy = (dy - h.vy) * k;
    const il = Math.hypot(ix, iy);
    if (il > 100) {
      ix *= 100 / il;
      iy *= 100 / il;
    }
    arena.pushRaw(m, ix, iy);
  }
  if (m.plates.length > 1 && best < 110) arena.shield(m);
  guns(arena, m, enemy);
}

/** Profiles for bots.bench.ts: a driver per machine and its loadout choice (null = the bench's rotation). */
export interface BenchProfile {
  driver: (arena: Arena, m: Machine) => (arena: Arena, m: Machine) => void;
  weapon: (seed: number) => WeaponKind | null;
  sidearm?: (seed: number) => GunKind | null;
  plate?: (seed: number) => PlateKind | null;
}

const classic = (viaStick: boolean): BenchProfile => ({
  driver: () => {
    const b = { theta: Math.random() * Math.PI * 2, spin: Math.random() < 0.5 ? -1 : 1, nextFlip: 2 + Math.random() * 3 };
    return (a, mm) => classicDrive(a, mm, b, viaStick);
  },
  weapon: () => null,
});

const personality = (id: ProfileId, ownLoadout: boolean): BenchProfile => ({
  driver: (_a, m) => {
    const b = makeBot("fight", m.hull.x, m.hull.y, id, m.id * 7919);
    return (a, mm) => driveBot(a, mm, b);
  },
  weapon: (seed) => (ownLoadout ? profileLoadout(id, (seed % 97) / 97).weapon : null),
  sidearm: () => (ownLoadout ? PROFILES[id].gun : null),
  plate: () => (ownLoadout ? PROFILES[id].plate : null),
});

/**
 * Human-like pilots (bench only). "chaser": the play test's style — full stick at the nearest enemy 85–100 % of the
 * time, with a sideways swerve and a human reaction delay. "spinner": a player who learned to whirl the weapon (the
 * pump law) and drifts it onto the nearest enemy, with no tactics.
 */
function human(kind: "chaser" | "spinner"): BenchProfile {
  return {
    driver: () => {
      let seen = { x: 0, y: 0 };
      let swerve = Math.random() < 0.5 ? -1 : 1;
      let nextSwerve = 1 + Math.random() * 2;
      let delayAt = 0;
      return (a, m) => {
        const foes = enemies(a, m);
        let e: Machine | null = null;
        let best = Infinity;
        for (const o of foes) {
          const d = Math.hypot(o.hull.x - m.hull.x, o.hull.y - m.hull.y);
          if (d < best) {
            best = d;
            e = o;
          }
        }
        if (!e) return;
        // a person reacts about 0.2 s late: refresh the seen position 5 times a second
        if (a.t >= delayAt) {
          seen = { x: e.hull.x, y: e.hull.y };
          delayAt = a.t + 0.2;
        }
        nextSwerve -= STEP;
        if (nextSwerve <= 0) {
          swerve = -swerve;
          nextSwerve = 0.8 + Math.random() * 2;
        }
        const dx = seen.x - m.hull.x;
        const dy = seen.y - m.hull.y;
        const d = Math.hypot(dx, dy) || 1;
        if (kind === "chaser") {
          const side = d < 120 ? 0.8 : 0.3;
          stickPush(a, m, dx / d - (dy / d) * side * swerve, dy / d + (dx / d) * side * swerve, STICK_DEFAULTS);
        } else {
          const { w } = headSpin(m);
          const sign = Math.abs(w) > 1.5 ? Math.sign(w) : swerve;
          const s = m.striker;
          const r = Math.hypot(s.x - m.hull.x, s.y - m.hull.y) || 1;
          const px = (sign * (s.y - m.hull.y)) / r + dx * 0.006;
          const py = (-sign * (s.x - m.hull.x)) / r + dy * 0.006;
          const [sx, sy] = thrustStick(a, m, px, py, STICK_DEFAULTS);
          stickPush(a, m, sx, sy, STICK_DEFAULTS);
        }
        if (m.guns.length && Math.random() < 0.05) a.fire(m);
      };
    },
    weapon: () => null,
  };
}

export const BENCH_PROFILES: Record<string, BenchProfile> = {
  classic: classic(false),
  classic600: classic(true),
  chaser: human("chaser"),
  spinner: human("spinner"),
  pilot: personality("pilot", false),
  ...Object.fromEntries(ROSTER.map((id) => [id, personality(id, true)])),
};
