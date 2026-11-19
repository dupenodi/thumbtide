// Blast Party 3D: the rules. Plain TypeScript (no DOM, no three.js), a fixed 60 Hz step (two physics steps of
// 1/120 s inside it), a seeded random source.
// The rules and numbers are ported from Ballistica (MIT): the scripts (spaz.py, bomb.py, powerupbox.py,
// elimination.py, the_pad.py) and the engine's C++ (spaz_node.cc, rigid_body.cc, prop_node.cc, dynamics.cc), whose
// character physics lives in engine.ts. RULES_NOTES.md traces each value to its source line and says which are
// converted, approximated or tuned. The ragdoll the view draws never feeds back into the rules, so a match plays the
// same in Node as on the TV.
import * as E from "./engine.ts";

export const STEP = 1 / 60;
export const SUBSTEPS = 2;
export const MAX_SEATS = 8;
export type Rng = () => number;

export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------------------------ numbers
// [S] = from a Ballistica script, [E] = from Ballistica's engine source, [C] = converted from it (8 ms steps → time,
// ODE → this model), [A] = approximated, [T] = tuned here. See RULES_NOTES.md.
export const HP = 1000; // [S] spaz.py default_hitpoints
export const PUNCH_COOLDOWN = 0.4; // [S] BASE_PUNCH_COOLDOWN 400 ms
export const PUNCH_COOLDOWN_GLOVES = 0.3; // [S] spazfactory.py punch_cooldown_gloves 300 ms
export const PUNCH_SCALE = 1.2; // [S] BASE_PUNCH_POWER_SCALE
export const PUNCH_SCALE_GLOVES = 1.4; // [S] spazfactory.py punch_power_scale_gloves
export const PUNCH_TIME = E.PUNCH_TIME; // [C] kPunchDuration 35 steps of 8 ms
export const JUMP_COOLDOWN = 0.25; // [S] _jump_cooldown 250 ms
export const PICKUP_DELAY = 8 * E.SRC_H; // [C] the pick-up sphere exists 8 steps after the press (44 → 36)
export const PICKUP_COOLDOWN = 44 * E.SRC_H; // [C] kPickupCooldown + kPickupHitboxDelay steps before another press
export const PICKUP_R = 0.7; // [E] the pick-up sphere's radius
export const INVINCIBLE = 1.0; // [S] spaz.py: invincible for 1.0 s after a spawn
export const DAMAGE_SCALE = 0.22; // [S] spaz.py damage_scale
export const KNOCKOUT_MAX = 26; // [E] behaviour version 2
export const KNOCKOUT_PER_S = 1 / (5 * E.SRC_H); // [C] one tick per 5 steps of 8 ms with footing (half that in the air)
export const WAKE_SLIDE = 25 * E.SRC_H; // [C] wake_slide_steps: the ball has no friction for 0.2 s after getting up
export const SHIELD_HP = 650; // [S] shield_hitpoints_max
export const SHIELD_DECAY = 10 / 0.5; // [S] shield_decay_rate 10 every 0.5 s
export const SHIELD_SPILL = 500; // [S] max_shield_spillover_damage
export const WEAR_OFF = 20; // [S] POWERUP_WEAR_OFF_TIME 20000 ms
export const BLAST_RADIUS = 2.0; // [S] spaz.py blast_radius / bomb.py default
export const BLAST_MAG = 2000; // [S] bomb.py ExplodeHitMessage: magnitude 2000
export const IMPACT_RADIUS_K = 0.7; // [S] bomb.py
export const TNT_RADIUS_K = 1.45; // [S] bomb.py
export const TNT_MAG_K = 2.0; // [S] bomb.py Blast: mag 2000, × 2.0 for tnt
export const BLAST_DROP = 0.1; // [S] bomb.py Blast: the blast sits 0.1 below the bomb "so we throw more things upward"
export const FUSE = 3.0; // [S] bomb.py fuse_time, normal and sticky
export const IMPACT_FUSE = 20.0; // [S] bomb.py fuse_time, impact
export const ARM_TIME = 0.2; // [S] bomb.py: an impact bomb arms 0.2 s after it is made (and is "older than 200 ms")
export const STICK_OWNER = 0.25; // [S] bomb.py _handle_dropped: a sticky bomb may stick to its thrower 0.25 s after
export const CHAIN_MIN = 0.1; // [S] bomb.py _handle_hit: 0.1 + random × 0.1 s
export const POWERUP_INTERVAL = 8.0; // [S] DEFAULT_POWERUP_INTERVAL
export const POWERUP_STAGGER = 0.4; // [S] _gameactivity.py _standard_drop_powerups
export const POWERUP_LIFE = POWERUP_INTERVAL - 1.0; // [S] powerupbox.py
export const POWERUP_FLASH = POWERUP_INTERVAL - 2.5; // [S] powerupbox.py
export const TNT_RESPAWN = 20.0; // [S] TNTSpawner respawn_time, × random 0.8–1.2
export const RESPAWN = 3.0; // [S] _gameactivity.py respawn_player: 3.0 s when a team is one player
export const END_CHECK = 1.0; // [S] elimination.py: the "who is left" check runs once a second
export const KICK_BACK = 400; // [S] spaz.py PunchHitMessage: the puncher gets −400 on its first hit
export const PUNCH_GRAB_GAP = 0.07; // [S] spaz.py: no punch on a fighter 0–70 ms after a pick-up press…
export const PUNCH_DROP_GAP = 0.36; // [S] … or within 360 ms of letting go of something
export const IMPACT_K = 50; // [S] spaz.py _hit_self: 50 × intensity damage, and a knock-out of 50 × intensity × 0.07
export const IMPACT_MIN = 3; // [E] a head jolt over 3 m/s counts (spaz_node.cc:2451)

// The bodies (engine.ts has the sources)
export const GRAVITY = E.G; // [E]
export const RADIUS = E.ROLLER_R; // [E] the roller ball: what fighters bump with
export const HEIGHT = E.HEAD_TOP; // [E] 1.16: the top of the head above the feet
export const BOMB_R = E.BOMB_R; // [E] 0.3
export const TNT_R = E.TNT_HALF; // [E] 0.35 (a 0.7 crate)
export const BOX_R = 0.36; // [T] the power-up box (its drop from the sky is ours)
/** [C] top speeds: the walk (7.68 rad/s on a 0.3 ball) and the run (the gear's fixed point with full gas). */
export const WALK = E.WALK_SPEED * E.ROLLER_R;
export const RUN = WALK / (1 - (E.RUN_SPEED_ADD * E.ROLLER_R) / E.GEAR_UP_SPEED);
/** [C] how far a punch reaches, centre to centre (the fist out at 0.58 + its 0.25 sphere + a torso's 0.15). */
export const PUNCH_REACH = 0.58 + E.FIST_R + E.TORSO_R;
export const KILL_Y = -5.5; // [S] the_pad.py map_bounds: about 5.5 m under the floor

export const COUNT_STEPS = 180;
export const ROUND_STEPS = 270;

export type PowerKind = "triple" | "impact" | "sticky" | "gloves" | "shield" | "health";
/** [S] _powerup.py get_default_powerup_distribution (ice, land mines and the curse are left out of this slice). */
export const POWER_WEIGHTS: [PowerKind, number][] = [["triple", 3], ["gloves", 3], ["impact", 3], ["sticky", 3], ["shield", 2], ["health", 1]];

export interface Block {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}
/**
 * The arena: a floating deck sized from The Pad's points in the_pad.py (its spawn points, power-up points and TNT
 * point, moved so the deck's middle is the origin). The Pad's own model is not open source: the shape here is ours.
 * The blocks are ours too; their height (0.4) is under the engine's jump (the feet rise about 0.5).
 */
export const ARENA = {
  hx: 7.5,
  hz: 7.0,
  blocks: [
    { x: -2.5, z: 0.5, w: 1.7, d: 1.7, h: 0.4 },
    { x: 2.7, z: -0.6, w: 1.7, d: 1.7, h: 0.4 },
    { x: 0, z: 4.3, w: 3.2, d: 0.9, h: 0.4 },
  ] as Block[],
  // the first four are The Pad's ffa_spawn1–4; the other four mirror them to the front (it has four; we seat eight)
  spawns: [[-4.2, -6.1], [4.1, -6.1], [6.6, -4.5], [-6.7, -4.5], [-6.3, 2.4], [6.3, 2.4], [-3.6, 5.8], [3.6, 5.8]] as [number, number][],
  powerups: [[-4.5, -3.5], [4.1, -3.4], [-4.55, 3.3], [4.4, 3.25]] as [number, number][],
  tnt: [0.1, -3.7] as [number, number],
};

/** The top of the solid ground under (x, z), or null over the drop. */
export function groundAt(x: number, z: number): number | null {
  let top: number | null = Math.abs(x) <= ARENA.hx && Math.abs(z) <= ARENA.hz ? 0 : null;
  for (const b of ARENA.blocks) if (Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) top = b.h;
  return top;
}

// ------------------------------------------------------------------------------------------------ state
export type Phase = "wait" | "count" | "play" | "round" | "match";
export type BombKind = "normal" | "impact" | "sticky" | "tnt";

interface Body {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Buttons held down (the engine runs while any is held, as its touch screens do). */
export const BTN = { bomb: 1, punch: 2, jump: 4, grab: 8 } as const;
export type Button = keyof typeof BTN;

export interface Fighter extends E.Spaz {
  id: string;
  name: string;
  bot: boolean;
  slot: number;
  /** Round wins in this match. */
  wins: number;
  /** In this round (a late joiner waits for the next). */
  inRound: boolean;
  lives: number;
  alive: boolean;
  /** Not on the deck at all: fell out of the world, or its body was cleared before the respawn. */
  gone: boolean;
  hp: number;
  invincible: number;
  /** Punch: seconds since the press (or -1), the hand, the cooldown, who it already hit, and its kick-back. */
  punchT: number;
  punchSide: number;
  punchCd: number;
  punched: (string | number)[];
  /** Seconds since the last pick-up press (-1 when the press is spent), and the cooldown. */
  pickupT: number;
  pickupCd: number;
  sincePickupPress: number;
  jumpCd: number;
  /** What it carries: a bomb's id, or a fighter's id. */
  holdBomb: number;
  holdFighter: string | null;
  holdT: number;
  heldBy: string | null;
  heldT: number;
  /** Seconds since it threw, and since it let go of anything (thrown or dropped). */
  sinceThrow: number;
  sinceDrop: number;
  /** Buttons held. */
  btn: number;
  /** Knocked about (by a blast, a hit, a throw): a hard landing hurts (the engine's head-jolt damage). */
  tumble: boolean;
  sinceImpulse: number;
  /** Seconds since its last impact damage (the engine waits 500 ms between two). */
  sinceJolt: number;
  /** Power-ups: seconds left (0 = off). */
  tripleT: number;
  bombKind: "normal" | "impact" | "sticky";
  bombKindT: number;
  glovesT: number;
  shield: number;
  respawnT: number;
  /** Seconds since it died (for the view). */
  deadT: number;
}

export interface Bomb extends Body {
  id: number;
  kind: BombKind;
  owner: string | null;
  fuse: number;
  radius: number;
  heldBy: string | null;
  /** Seconds since it was made, and since it left a hand (-1 while it has never been let go). */
  age: number;
  free: number;
  /** Sticky: the fighter it sticks to, or "ground". */
  stuck: string | null;
  sx: number;
  sy: number;
  sz: number;
  /** Spin about x and z (rad/s): a ball rolls. */
  wx: number;
  wz: number;
  rest: boolean;
}

export interface PowerBox extends Body {
  id: number;
  kind: PowerKind;
  age: number;
  rest: boolean;
}

export type GameEvent =
  | { type: "phase"; phase: Phase }
  | { type: "round"; winner: string | null }
  | { type: "spawn"; id: string }
  | { type: "punch"; id: string }
  | { type: "hit"; id: string; by: string | null; damage: number; kind: "punch" | "blast" | "impact"; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { type: "die"; id: string; fell: boolean; x: number; y: number; z: number }
  | { type: "blast"; x: number; y: number; z: number; radius: number; kind: BombKind }
  | { type: "bomb"; id: string }
  | { type: "throw"; id: string }
  | { type: "grab"; id: string }
  | { type: "jump"; id: string; x: number; y: number; z: number }
  | { type: "land"; id: string; x: number; y: number; z: number; speed: number }
  | { type: "box"; x: number; z: number }
  | { type: "power"; id: string; kind: PowerKind; x: number; y: number; z: number }
  | { type: "shieldDown"; id: string; x: number; y: number; z: number }
  | { type: "stick"; x: number; y: number; z: number };

export interface Options {
  /** Lives each fighter has in a round. */
  lives: number;
  /** Round wins that take the match. */
  wins: number;
  powerups: boolean;
  /** Tests of the frame rate: nobody runs out of lives, so the fight never ends. */
  endless: boolean;
}
export const DEFAULTS: Options = { lives: 3, wins: 2, powerups: true, endless: false };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const H = E.H;

export class Game {
  opts: Options;
  phase: Phase = "wait";
  /** Steps in this phase. */
  t = 0;
  round = 0;
  time = 0;
  readonly seats = new Map<string, Fighter>();
  bombs: Bomb[] = [];
  boxes: PowerBox[] = [];
  roundWinner: string | null = null;
  winner: string | null = null;
  private uid = 1;
  private events: GameEvent[] = [];
  private dropT = 0;
  private dropQueue: { at: number; i: number }[] = [];
  private tntT = -1;
  private endT = -1;
  private ctx: E.DriveCtx = { carry: 0, holding: false, sinceThrow: 9, limp: false, dead: false, ground: 0 };
  private dv = [0, 0, 0];

  constructor(opts: Partial<Options> = {}, readonly rng: Rng = Math.random) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  configure(opts: Partial<Options>) {
    this.opts = { ...this.opts, ...opts };
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ---------------------------------------------------------------------------------------------- seats
  addSeat(id: string, name: string, bot = false, slot = -1): boolean {
    if (this.seats.has(id)) return true;
    if (this.seats.size >= MAX_SEATS) return false;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    if (slot < 0 || used.has(slot)) for (slot = 0; used.has(slot); slot++);
    const f: Fighter = {
      ...E.newSpaz(), id, name, bot, slot, wins: 0, inRound: false, lives: 0, alive: false, gone: true, hp: HP, invincible: 0,
      punchT: -1, punchSide: 0, punchCd: 0, punched: [], pickupT: -1, pickupCd: 0, sincePickupPress: 9, jumpCd: 0, holdBomb: 0, holdFighter: null,
      holdT: 0, heldBy: null, heldT: 0, sinceThrow: 9, sinceDrop: 9, btn: 0, tumble: false, sinceImpulse: 9, sinceJolt: 9, tripleT: 0, bombKind: "normal",
      bombKindT: 0, glovesT: 0, shield: 0, respawnT: 0, deadT: 0,
    };
    this.seats.set(id, f);
    if (this.phase === "wait" && this.seats.size >= 2) this.startMatch();
    else if (this.phase === "count") this.enter(f);
    return true;
  }

  removeSeat(id: string) {
    const f = this.seats.get(id);
    if (!f) return;
    this.letGo(f);
    if (f.heldBy) this.release(f);
    for (const b of this.bombs) {
      if (b.stuck === id) b.stuck = null;
      if (b.owner === id) b.owner = null;
    }
    this.seats.delete(id);
    if (this.seats.size < 2 && this.phase !== "match") this.setPhase("wait");
  }

  /** Fighters in seat order. */
  list() {
    return [...this.seats.values()].sort((a, b) => a.slot - b.slot);
  }
  standings() {
    return this.list().sort((a, b) => b.wins - a.wins || Number(b.inRound) * b.lives - Number(a.inRound) * a.lives || a.slot - b.slot);
  }
  /** Still in the round: on the deck, or waiting to come back. */
  contenders() {
    return this.list().filter((f) => f.inRound && f.lives > 0);
  }

  // ---------------------------------------------------------------------------------------------- flow
  private setPhase(p: Phase) {
    this.phase = p;
    this.t = 0;
    this.events.push({ type: "phase", phase: p });
  }

  startMatch() {
    for (const f of this.seats.values()) f.wins = 0;
    this.round = 0;
    this.winner = null;
    if (this.seats.size < 2) {
      this.setPhase("wait");
      return;
    }
    this.startRound();
  }

  private startRound() {
    this.round++;
    this.roundWinner = null;
    this.bombs = [];
    this.boxes = [];
    this.dropQueue = [];
    this.dropT = 0;
    this.tntT = -1;
    this.endT = -1;
    this.time = 0;
    for (const f of this.seats.values()) this.enter(f);
    this.spawnTnt();
    this.setPhase("count");
  }

  private enter(f: Fighter) {
    f.inRound = true;
    f.lives = this.opts.lives;
    this.spawn(f, (f.slot + this.round) % ARENA.spawns.length);
  }

  private spawn(f: Fighter, point = -1) {
    if (point < 0) {
      // the spawn point farthest from the others
      let best = -1;
      let far = -1;
      for (let i = 0; i < ARENA.spawns.length; i++) {
        const [sx, sz] = ARENA.spawns[i]!;
        let near = 1e9;
        for (const o of this.seats.values()) if (o !== f && o.inRound && o.alive) near = Math.min(near, Math.hypot(o.x - sx, o.z - sz));
        near += this.rng() * 1.5;
        if (near > far) {
          far = near;
          best = i;
        }
      }
      point = best;
    }
    const [sx, sz] = ARENA.spawns[point]!;
    const ix = f.ix;
    const iz = f.iz;
    const btn = f.btn;
    const run = f.run;
    E.stand(f, sx, 0, sz, Math.atan2(-sx, -sz));
    Object.assign(f, {
      ix, iz, btn, run, alive: true, gone: false, hp: HP, invincible: INVINCIBLE, punchT: -1, punchCd: 0, punched: [], pickupT: -1, pickupCd: 0,
      sincePickupPress: 9, jumpCd: 0, holdBomb: 0, holdFighter: null, holdT: 0, heldBy: null, heldT: 0, sinceThrow: 9, sinceDrop: 9, tumble: false,
      sinceImpulse: 9, sinceJolt: 9, tripleT: 0, bombKind: "normal", bombKindT: 0, glovesT: 0, shield: 0, respawnT: 0, deadT: 0,
    } satisfies Partial<Fighter>);
    this.events.push({ type: "spawn", id: f.id });
  }

  private newBomb(kind: BombKind, owner: string | null, x: number, y: number, z: number): Bomb {
    return {
      id: this.uid++, kind, owner, fuse: kind === "tnt" ? Infinity : kind === "impact" ? IMPACT_FUSE : FUSE,
      radius: BLAST_RADIUS * (kind === "tnt" ? TNT_RADIUS_K : kind === "impact" ? IMPACT_RADIUS_K : 1), heldBy: null, age: 0, free: kind === "tnt" ? 9 : -1,
      stuck: null, sx: 0, sy: 0, sz: 0, wx: 0, wz: 0, rest: false, x, y, z, vx: 0, vy: 0, vz: 0,
    };
  }

  private spawnTnt() {
    const [x, z] = ARENA.tnt;
    this.bombs.push(this.newBomb("tnt", null, x, TNT_R + 3, z));
    this.tntT = -1;
  }

  /** A newcomer steps in while the round is still counting down; otherwise it waits for the next round. */
  admitLate() {
    if (this.phase === "count") for (const f of this.seats.values()) if (!f.inRound) this.enter(f);
  }

  // ---------------------------------------------------------------------------------------------- input
  setInput(id: string, x: number, z: number) {
    const f = this.seats.get(id);
    if (!f) return;
    x = Number.isFinite(x) ? x : 0;
    z = Number.isFinite(z) ? z : 0;
    const m = Math.hypot(x, z);
    if (m > 1) {
      x /= m;
      z /= m;
    }
    f.ix = x;
    f.iz = z;
  }

  /** The run trigger (0..1). Phones run while a button is held (`buttonUp` ends it); bots set it themselves. */
  setRun(id: string, v: number) {
    const f = this.seats.get(id);
    if (f) f.run = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  }
  /** The buttons a phone holds down (a mask of BTN): it runs while any is held. */
  setButtons(id: string, mask: number) {
    const f = this.seats.get(id);
    if (!f) return;
    f.btn = mask & 15;
    f.run = f.btn ? 1 : 0;
  }
  private press(f: Fighter, b: Button) {
    f.btn |= BTN[b];
    f.run = 1;
  }
  /** A button let go of: the run ends when no button is held (base/input/device/touch_input.cc). */
  buttonUp(id: string, b: Button) {
    const f = this.seats.get(id);
    if (!f) return;
    f.btn &= ~BTN[b];
    if (!f.btn) f.run = 0;
  }

  /** Can it act: in play, alive, not knocked out ([S] spaz.py: every press checks knockout > 0). */
  ready(f: Fighter): boolean {
    return this.phase === "play" && f.alive && f.knockout <= 0;
  }
  private canAct(f: Fighter | undefined): f is Fighter {
    return !!f && this.ready(f);
  }
  holding(f: Fighter) {
    return f.holdBomb !== 0 || f.holdFighter !== null;
  }

  /** Jump: the ball's spring is pushed down for 7 steps; it only lifts when the ball is on the ground. */
  jump(id: string) {
    const f = this.seats.get(id);
    if (f && this.phase === "play") this.press(f, "jump");
    if (!this.canAct(f) || f.jumpCd > 0) return false;
    f.jumpCd = JUMP_COOLDOWN;
    f.jumpT = E.JUMP_TIME;
    if (f.grounded && !f.heldBy) this.events.push({ type: "jump", id: f.id, x: f.x, y: f.y, z: f.z });
    return true;
  }

  /** Punch; with something in the hands, throw it (as in Ballistica, every action button throws). */
  punch(id: string) {
    const f = this.seats.get(id);
    if (f && this.phase === "play") this.press(f, "punch");
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f, false);
    if (f.punchCd > 0) return false;
    f.punchCd = f.glovesT > 0 ? PUNCH_COOLDOWN_GLOVES : PUNCH_COOLDOWN;
    f.punchT = 0;
    f.punched = [];
    // [E] left or right by its spin; random when it barely turns
    f.punchSide = Math.abs(f.aVelSm) < 0.3 ? (this.rng() > 0.5 ? 1 : 0) : f.aVelSm > 0 ? 1 : 0;
    this.events.push({ type: "punch", id: f.id });
    return true;
  }

  /** Bomb: lights one in the hands (spaz.py drop_bomb: made and picked up); the next press throws it. */
  bomb(id: string) {
    const f = this.seats.get(id);
    if (f && this.phase === "play") this.press(f, "bomb");
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f, true);
    if (this.bombsLeft(f) <= 0) return false;
    const b = this.newBomb(f.bombKind, id, f.x, f.y + E.TORSO_Y + E.HOLD_UP, f.z);
    b.heldBy = id;
    this.bombs.push(b);
    f.holdBomb = b.id;
    f.holdT = 0;
    this.events.push({ type: "bomb", id });
    return true;
  }

  /** How many more bombs it may light (spaz.py bomb_count: one, three with triple bombs; a bomb comes back when it is gone). */
  bombsLeft(f: Fighter) {
    let out = 0;
    for (const b of this.bombs) if (b.owner === f.id && b.kind !== "tnt") out++;
    return (f.tripleT > 0 ? 3 : 1) - out;
  }

  /** Pick-up: a sphere in front of the head 64 ms later takes a bomb, the crate or a fighter; with something in the hands, throw. */
  grab(id: string) {
    const f = this.seats.get(id);
    if (f && this.phase === "play") this.press(f, "grab");
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f, false);
    if (f.pickupCd > 0 || f.heldBy) return false;
    f.pickupCd = PICKUP_COOLDOWN;
    f.pickupT = 0;
    f.sincePickupPress = 0;
    return true;
  }

  /** The pick-up sphere's moment: take the nearest thing it touches. */
  private pickup(f: Fighter) {
    const ty = f.y + E.ROLLER_R + f.sep;
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    // [E] between head and torso, 0.3 along the head's forward
    const cx = f.x + fx * 0.3;
    const cy = ty + E.HEAD_UP / 2;
    const cz = f.z + fz * 0.3;
    let best = 1e9;
    let bomb: Bomb | null = null;
    let man: Fighter | null = null;
    for (const b of this.bombs) {
      if (b.heldBy || (b.stuck && b.stuck !== "ground")) continue;
      const r = b.kind === "tnt" ? TNT_R : BOMB_R;
      const d = Math.hypot(b.x - cx, b.y - cy, b.z - cz) - r;
      if (d < PICKUP_R && d < best) {
        best = d;
        bomb = b;
        man = null;
      }
    }
    for (const o of this.seats.values()) {
      // [S] anyone not invincible (spaz.py PickupMessage); a carried one or one carrying it is out of the question
      if (o === f || !o.alive || o.gone || o.heldBy || o.invincible > 0 || !o.inRound || o.holdFighter === f.id) continue;
      const oy = o.y + E.ROLLER_R + o.sep;
      let d = 1e9;
      for (const p of E.CORE_PARTS) {
        const py = this.partY(o, p, oy);
        d = Math.min(d, Math.hypot(o.x - cx, py - cy, o.z - cz) - (p.head ? E.HEAD_R : E.TORSO_R));
      }
      if (d < PICKUP_R && d < best) {
        best = d;
        man = o;
        bomb = null;
      }
    }
    if (bomb) {
      bomb.heldBy = f.id;
      bomb.rest = false;
      bomb.stuck = null;
      f.holdBomb = bomb.id;
    } else if (man) {
      this.letGo(man);
      man.heldBy = f.id;
      man.heldT = 0;
      man.balance = 0; // [E] kPickedUp: it loses its balance at once
      f.holdFighter = man.id;
    } else return;
    f.holdT = 0;
    this.events.push({ type: "grab", id: f.id });
  }

  /** The mass it carries (hanging on its pick-up spring). */
  private carried(f: Fighter) {
    if (f.holdFighter) return E.M_SPAZ;
    if (f.holdBomb) {
      const b = this.bombs.find((x) => x.id === f.holdBomb);
      return b?.kind === "tnt" ? E.TNT_M : E.BOMB_M;
    }
    return 0;
  }

  /** The throw's velocity change for a stick pushed `scale` (0..1), a thing held `held` s, of `mass` ([E] spaz_node.cc Throw). */
  static throwSpeed(scale: number, held = 1, mass = E.BOMB_M): [number, number] {
    const t = E.throwImpulse(scale, held, mass);
    return [t.dvh, t.dvv];
  }

  private throwHeld(f: Fighter, withBomb: boolean) {
    const b = f.holdBomb ? this.bombs.find((x) => x.id === f.holdBomb) : undefined;
    const man = f.holdFighter ? this.seats.get(f.holdFighter) : undefined;
    const body: Body | undefined = b ?? man;
    // [E] the stick (the engine's smoothed stick is the raw one for analog input), clamped to the circle: its length is
    // the throw's strength, its way the throw's way
    let sx = f.ix;
    let sz = f.iz;
    const m = Math.hypot(sx, sz);
    if (m > 1) {
      sx /= m;
      sz /= m;
    }
    const scale = Math.min(1, m);
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    const dx = scale > 0.1 ? sx / m : fx;
    const dz = scale > 0.1 ? sz / m : fz;
    const mass = man ? E.M_SPAZ : b?.kind === "tnt" ? E.TNT_M : E.BOMB_M;
    const t = E.throwImpulse(scale > 0.1 ? scale : 0, f.holdT, mass);
    f.holdBomb = 0;
    f.holdFighter = null;
    f.sinceThrow = 0;
    f.sinceDrop = 0;
    if (!body) return false;
    // [E] "pro trick": throwing with Punch or Pick-up while Bomb is still held lobs it lightly backwards
    const back = !withBomb && (f.btn & BTN.bomb) !== 0;
    const k = back ? -0.2 : 1;
    body.vx = f.vx + dx * t.dvh * k;
    body.vz = f.vz + dz * t.dvh * k;
    body.vy = (f.grounded ? 0 : f.vy) + t.dvv * Math.abs(k);
    // the thrower takes −0.25 of the push (or +0.2 for the backward lob), its vertical part always downward
    const mf = E.M_SPAZ + 0;
    const kb = back ? 0.2 : -0.25;
    f.vx += (dx * t.jh * kb) / mf;
    f.vz += (dz * t.jh * kb) / mf;
    if (!f.grounded) f.vy -= (t.jv * Math.abs(kb)) / mf;
    if (b) {
      b.heldBy = null;
      b.free = 0;
      b.rest = false;
      // [E] the push lands 0.1 under the bomb's centre: it spins backwards
      const spin = (0.1 * t.jh * k) / (0.4 * E.BOMB_M * BOMB_R * BOMB_R);
      b.wx = -dz * spin;
      b.wz = dx * spin;
    } else if (man) {
      man.heldBy = null;
      man.grounded = false;
      man.tumble = true;
    }
    this.events.push({ type: "throw", id: f.id });
    return true;
  }

  /** Drop whatever it carries, where it is. */
  private letGo(f: Fighter) {
    if (f.holdBomb) {
      const b = this.bombs.find((x) => x.id === f.holdBomb);
      if (b) {
        b.heldBy = null;
        b.free = 0;
        b.vx = f.vx;
        b.vy = 0;
        b.vz = f.vz;
      }
      f.holdBomb = 0;
      f.sinceDrop = 0;
    }
    if (f.holdFighter) {
      const o = this.seats.get(f.holdFighter);
      if (o && o.heldBy === f.id) {
        o.heldBy = null;
        o.vx = f.vx;
        o.vy = 0;
        o.vz = f.vz;
        o.grounded = false;
        o.tumble = true;
      }
      f.holdFighter = null;
      f.sinceDrop = 0;
    }
  }
  /** A carried fighter gets loose. */
  private release(f: Fighter) {
    const h = f.heldBy ? this.seats.get(f.heldBy) : undefined;
    if (h && h.holdFighter === f.id) {
      h.holdFighter = null;
      h.sinceDrop = 0;
    }
    f.heldBy = null;
  }

  // ---------------------------------------------------------------------------------------------- damage
  /** Knock-out ticks for a hit ([E] spaz_node.cc: min(26, max(k, int(raw × 0.02) − 24)), raw = damage / 0.22). */
  static knockoutFor(damage: number) {
    return clamp(Math.floor((damage / DAMAGE_SCALE) * 0.02) - 24, 0, KNOCKOUT_MAX);
  }

  /**
   * A punch's "total" ([E] spaz.py PunchHitMessage + rigid_body.cc:862): power × scale × (angular momentum × 110 +
   * linear momentum × 40). Damage is 0.22 × 5 × that (a one-body hit counts five times).
   */
  static punchTotal(pmLin: number, pmAng: number, power: number, gloves: boolean) {
    const scale = gloves ? PUNCH_SCALE_GLOVES : PUNCH_SCALE;
    return power * scale * pmAng * 110 + pmLin * power * scale * 40;
  }
  /** A punch's damage at full power for a puncher whose filters settled at a steady `speed` and spin ([E]). */
  static punchDamage(speed: number, gloves: boolean, spin = 0) {
    // the engine's filters' steady states: linear 1.824 × speed (0.9 + 0.02·v extra decay under 5 m/s), angular 0.127 × spin
    const fl = speed < 5 ? 0.9 + 0.02 * speed : 1;
    const lin = (0.96 * fl * 0.076 * speed) / (1 - 0.96 * fl);
    const a = Math.min(25, Math.abs(spin));
    const fa = a < 5 ? 0.8 + 0.04 * a : 1;
    const ang = (0.92 * fa * 0.01103 * a) / (1 - 0.92 * fa);
    return Math.round(DAMAGE_SCALE * 5 * Game.punchTotal(lin, ang, 1, gloves));
  }

  /** The damage and velocity change of a blast on a fighter standing `dist` m (sideways) from a bomb on the deck. */
  static blastOn(dist: number, radius = BLAST_RADIUS, kind: BombKind = "normal") {
    const g = new Game({}, () => 0.5);
    const f = { ...E.newSpaz(), alive: true, knockout: 0, heldBy: null } as unknown as Fighter;
    f.x = dist;
    const r = g.blastParts(f, 0, BOMB_R - BLAST_DROP, 0, BLAST_MAG * (kind === "tnt" ? TNT_MAG_K : 1), radius);
    return { damage: Math.round(r.raw * DAMAGE_SCALE), dvx: r.dvx, dvy: r.dvy };
  }
  /** A blast's damage on a fighter standing `dist` m from a bomb resting on the deck ([E]). */
  static blastDamage(dist: number, radius = BLAST_RADIUS, kind: BombKind = "normal") {
    return Game.blastOn(dist, radius, kind).damage;
  }

  /** Where a core body is: standing, or lying when knocked out on the ground. */
  private partY(o: Fighter, p: (typeof E.CORE_PARTS)[number], torsoY: number) {
    const lying = (!o.alive || o.knockout > 0) && o.grounded && !o.heldBy;
    if (lying) return o.y + p.lying;
    return torsoY + (p.up - E.TORSO_Y);
  }

  /** Sum a blast over a fighter's three core bodies (the head's share of damage counts five times). */
  private blastParts(f: Fighter, bx: number, by: number, bz: number, mag: number, radius: number) {
    const ty = f.y + E.ROLLER_R + f.sep;
    const lying = (!f.alive || f.knockout > 0) && f.grounded && !f.heldBy;
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    let raw = 0;
    let px = 0;
    let py = 0;
    let pz = 0;
    for (const p of E.CORE_PARTS) {
      const x = f.x + (lying ? fx * p.fwd : 0);
      const z = f.z + (lying ? fz * p.fwd : 0);
      const y = lying ? f.y + p.lying : ty + (p.up - E.TORSO_Y);
      const m = E.areaImpulse(bx, by, bz, mag, radius, x, y, z, p.m, this.dv);
      if (m <= 0) continue;
      raw += m * (p.head ? 5 : 1);
      px += this.dv[0]! * p.m;
      py += this.dv[1]! * p.m;
      pz += this.dv[2]! * p.m;
    }
    // the core's push moves the whole body (its ball too)
    return { raw, dvx: px / E.M_SPAZ, dvy: py / E.M_SPAZ, dvz: pz / E.M_SPAZ };
  }

  /**
   * A hit (spaz.py HitMessage): the shield takes it first; damage, knock-back, knock-out, death. `ko` false: a flat
   * hit (an impact) whose knock-out the caller sets.
   */
  hurt(f: Fighter, damage: number, by: string | null, kind: "punch" | "blast" | "impact", dvx: number, dvy: number, dvz: number, px = f.x, py = f.y + 1, pz = f.z, ko = true) {
    if (!f.alive || f.invincible > 0) return 0;
    if (damage <= 0 && Math.hypot(dvx, dvy, dvz) < 1e-6) return 0;
    let ratio = 1;
    if (f.shield > 0 && damage > 0) {
      f.shield -= damage;
      if (f.shield <= 0) this.events.push({ type: "shieldDown", id: f.id, x: f.x, y: f.y + 0.6, z: f.z });
      // a hit that only breaks the shield does nothing else; a massive one spills over
      if (f.shield > -SHIELD_SPILL) {
        f.shield = Math.max(0, f.shield);
        return 0;
      }
      ratio = (-SHIELD_SPILL - f.shield) / damage;
      f.shield = 0;
    }
    damage = Math.round(damage * ratio);
    f.vx += dvx * ratio;
    f.vy += dvy * ratio;
    f.vz += dvz * ratio;
    if (dvy * ratio > 0.5 && f.grounded) f.grounded = false;
    if (kind !== "impact") {
      f.sinceImpulse = 0;
      if (Math.hypot(dvx, dvy, dvz) * ratio > 1.5) f.tumble = true;
    }
    if (damage > 0) this.letGo(f);
    // [S] impact damage never quite kills: it leaves 10 hp, unless it is 200 more than what is left
    if (kind === "impact" && damage >= f.hp) damage = Math.max(damage - 200, f.hp - 10);
    f.hp -= damage;
    if (ko) f.knockout = Math.max(f.knockout, Game.knockoutFor(damage));
    if (f.knockout > 0) f.tumble = true;
    const l = Math.hypot(dvx, dvy, dvz) || 1;
    this.events.push({ type: "hit", id: f.id, by, damage, kind, x: px, y: py, z: pz, dx: dvx / l, dy: dvy / l, dz: dvz / l });
    if (f.hp <= 0) this.die(f, false);
    return damage;
  }

  private die(f: Fighter, fell: boolean) {
    if (!f.alive) return;
    f.alive = false;
    f.hp = 0;
    f.deadT = 0;
    f.gone = fell;
    f.shield = 0;
    this.letGo(f);
    if (f.heldBy) this.release(f);
    if (!this.opts.endless) f.lives = Math.max(0, f.lives - 1);
    f.respawnT = f.lives > 0 ? RESPAWN : 0;
    for (const b of this.bombs) if (b.stuck === f.id && fell) b.stuck = null;
    this.events.push({ type: "die", id: f.id, fell, x: f.x, y: f.y, z: f.z });
  }

  /** A blast (bomb.py Blast) at (x, y, z), the region's centre: fighters, bombs and boxes inside the radius. */
  explode(x: number, y: number, z: number, radius: number, kind: BombKind, by: string | null) {
    this.events.push({ type: "blast", x, y, z, radius, kind });
    const mag = BLAST_MAG * (kind === "tnt" ? TNT_MAG_K : 1);
    for (const f of this.seats.values()) {
      if (f.gone || !f.inRound) continue;
      const r = this.blastParts(f, x, y, z, mag, radius);
      if (r.raw <= 0) continue;
      if (f.alive) this.hurt(f, Math.round(r.raw * DAMAGE_SCALE), by, "blast", r.dvx, r.dvy, r.dvz, x, y, z);
      else {
        f.vx += r.dvx;
        f.vy += r.dvy;
        f.vz += r.dvz;
        if (r.dvy > 0.5) f.grounded = false;
      }
    }
    for (const b of this.bombs) {
      const m = E.areaImpulse(x, y, z, mag, radius, b.x, b.y, b.z, 1, this.dv);
      if (m <= 0) continue;
      if (!b.heldBy && !b.stuck) {
        b.vx += this.dv[0]!;
        b.vy += this.dv[1]!;
        b.vz += this.dv[2]!;
        b.rest = false;
      }
      // a chain reaction: it goes off 0.1–0.2 s later
      b.fuse = Math.min(b.fuse, CHAIN_MIN + this.rng() * 0.1);
    }
    // powerupbox.py: any hit that is not a punch destroys a box
    this.boxes = this.boxes.filter((b) => Math.hypot(b.x - x, b.y - y, b.z - z) >= radius + BOX_R);
  }

  private give(f: Fighter, kind: PowerKind) {
    if (kind === "triple") f.tripleT = WEAR_OFF;
    else if (kind === "impact" || kind === "sticky") {
      f.bombKind = kind;
      f.bombKindT = WEAR_OFF;
    } else if (kind === "gloves") f.glovesT = WEAR_OFF;
    else if (kind === "shield") f.shield = SHIELD_HP;
    else f.hp = HP;
    this.events.push({ type: "power", id: f.id, kind, x: f.x, y: f.y + 0.7, z: f.z });
  }

  // ---------------------------------------------------------------------------------------------- step
  step() {
    this.t++;
    if (this.phase === "wait" || this.phase === "match") return;
    if (this.phase === "count") {
      if (this.t >= COUNT_STEPS) this.setPhase("play");
      // the fighters stand; the TNT crate drops in
      for (let i = 0; i < SUBSTEPS; i++) this.stepBombs(H);
      return;
    }
    if (this.phase === "round") {
      this.physics();
      if (this.t >= ROUND_STEPS) {
        const top = this.standings()[0];
        if (top && top.wins >= this.opts.wins) {
          this.winner = top.id;
          this.setPhase("match");
        } else this.startRound();
      }
      return;
    }
    this.time += STEP;
    if (this.opts.powerups) this.drops(STEP);
    this.physics();
    // elimination.py: once a second, see who is left
    if (this.endT < 0) {
      if (this.contenders().length <= 1 && !this.opts.endless) this.endT = END_CHECK;
    } else if ((this.endT -= STEP) <= 0) {
      const left = this.contenders();
      const w = left.length === 1 ? left[0]! : null;
      if (w) w.wins++;
      this.roundWinner = w ? w.id : null;
      for (const f of this.seats.values()) {
        f.ix = f.iz = 0;
        f.run = 0;
        f.btn = 0;
      }
      this.events.push({ type: "round", winner: this.roundWinner });
      this.setPhase("round");
    }
  }

  private drops(dt: number) {
    // _gameactivity.py: one box at every power-up point straight away and then every 8 s, 0.4 s apart
    if ((this.dropT -= dt) <= 0) {
      this.dropT += POWERUP_INTERVAL;
      ARENA.powerups.forEach((_, i) => this.dropQueue.push({ at: this.time + i * POWERUP_STAGGER, i }));
    }
    while (this.dropQueue.length && this.dropQueue[0]!.at <= this.time) {
      const { i } = this.dropQueue.shift()!;
      const [x, z] = ARENA.powerups[i]!;
      let r = this.rng() * POWER_WEIGHTS.reduce((a, w) => a + w[1], 0);
      let kind: PowerKind = "triple";
      for (const [k, w] of POWER_WEIGHTS) {
        if ((r -= w) < 0) {
          kind = k;
          break;
        }
      }
      this.boxes.push({ id: this.uid++, kind, age: 0, rest: false, x, y: 9, z, vx: 0, vy: 0, vz: 0 }); // [T] it drops from the sky
      this.events.push({ type: "box", x, z });
    }
    if (this.tntT > 0 && (this.tntT -= dt) <= 0) this.spawnTnt();
  }

  private physics() {
    const fs = this.list();
    for (let i = 0; i < SUBSTEPS; i++) {
      for (const f of fs) if (f.inRound) this.stepFighter(f, H);
      this.separate(fs);
      this.stepBombs(H);
    }
    this.stepBoxes(STEP);
  }

  private stepFighter(f: Fighter, h: number) {
    const ctx = this.ctx;
    ctx.ground = groundAt(f.x, f.z);
    if (!f.alive) {
      f.deadT += h;
      if (f.respawnT > 0 && (f.respawnT -= h) <= 0 && this.phase === "play") {
        this.spawn(f);
        return;
      }
      if (f.deadT > RESPAWN) f.gone = true;
      if (f.gone) return;
      ctx.carry = 0;
      ctx.holding = false;
      ctx.limp = true;
      ctx.dead = true;
      ctx.sinceThrow = 9;
      f.ix = f.iz = 0;
      f.knockout = Math.max(f.knockout, 1);
      if (!f.heldBy) {
        E.stepSpaz(f, ctx, h);
        this.walls(f, false);
      }
      if (f.y < KILL_Y) f.gone = true;
      return;
    }
    f.invincible = Math.max(0, f.invincible - h);
    f.punchCd = Math.max(0, f.punchCd - h);
    f.jumpCd = Math.max(0, f.jumpCd - h);
    f.pickupCd = Math.max(0, f.pickupCd - h);
    f.holdT += h;
    f.sinceThrow += h;
    f.sinceDrop += h;
    f.sinceImpulse += h;
    f.sinceJolt += h;
    f.sincePickupPress += h;
    if (f.tripleT > 0) f.tripleT = Math.max(0, f.tripleT - h);
    if (f.glovesT > 0) f.glovesT = Math.max(0, f.glovesT - h);
    if (f.bombKindT > 0 && (f.bombKindT -= h) <= 0) {
      f.bombKindT = 0;
      f.bombKind = "normal";
    }
    if (f.shield > 0) f.shield = Math.max(0, f.shield - SHIELD_DECAY * h);
    if (f.holdFighter && this.seats.get(f.holdFighter)?.heldBy !== f.id) f.holdFighter = null;
    if (f.holdBomb && !this.bombs.some((b) => b.id === f.holdBomb && b.heldBy === f.id)) f.holdBomb = 0;

    // knock-out wears off (slower in the air); getting up, the ball slides for a moment
    if (f.knockout > 0) {
      f.knockout = Math.max(0, f.knockout - (f.grounded ? KNOCKOUT_PER_S : KNOCKOUT_PER_S / 2) * h);
      if (f.knockout === 0) f.wake = WAKE_SLIDE;
    }

    if (f.heldBy) {
      const o = this.seats.get(f.heldBy);
      f.heldT += h;
      if (!o || !o.alive || o.holdFighter !== f.id) this.release(f);
      else {
        // [E] its torso hangs 1.08 over the carrier's torso, 0.05 forward, sagging on the 180 spring
        const sag = (E.M_SPAZ * GRAVITY) / E.HOLD_K;
        f.x = o.x + Math.sin(o.yaw) * E.HOLD_FWD;
        f.z = o.z + Math.cos(o.yaw) * E.HOLD_FWD;
        f.y = o.y + E.ROLLER_R + o.sep + E.HOLD_UP - sag - E.TORSO_Y;
        f.vx = o.vx;
        f.vy = o.grounded ? 0 : o.vy;
        f.vz = o.vz;
        f.sep = E.SEP_REST;
        f.grounded = false;
        f.balance = 0;
        f.tumble = true;
        this.punchStep(f, h);
        return;
      }
    }

    ctx.carry = this.carried(f);
    ctx.holding = ctx.carry > 0;
    ctx.limp = f.knockout > 0;
    ctx.dead = false;
    ctx.sinceThrow = f.sinceThrow;
    if (this.phase !== "play") {
      f.ix = f.iz = 0;
      f.run = 0;
    }
    const wasAir = !f.grounded;
    const landed = E.stepSpaz(f, ctx, h);
    this.walls(f, !ctx.limp);
    if (landed > 0) {
      if (wasAir && landed > 5) this.events.push({ type: "land", id: f.id, x: f.x, y: f.y, z: f.z, speed: landed });
      // [A] the engine's head-jolt damage: a body knocked about lands hard (its head hits first)
      if (f.tumble && landed > IMPACT_MIN && f.sinceImpulse >= 0.3 && f.sinceJolt > 0.5) {
        const intensity = landed - IMPACT_MIN;
        f.sinceJolt = 0;
        this.hurt(f, Math.round(IMPACT_K * intensity), null, "impact", 0, 0, 0, f.x, f.y + 0.3, f.z, false);
        f.knockout = Math.max(f.knockout, Math.min(40, IMPACT_K * intensity * 0.07));
      }
      if (f.knockout <= 0) f.tumble = false;
    }
    if (!f.alive) return;
    if (f.pickupT >= 0) {
      f.pickupT += h;
      if (f.pickupT >= PICKUP_DELAY) {
        f.pickupT = -1;
        if (f.knockout <= 0 && !this.holding(f) && this.phase === "play") this.pickup(f);
      }
    }
    this.punchStep(f, h);
    if (f.y < KILL_Y) this.die(f, true);
  }

  /** The blocks' sides and the deck's rim from below; the ball is kicked off walls it touches ([E] wall kick). */
  private walls(o: Fighter, kick: boolean) {
    const r = RADIUS;
    const k = kick ? (E.WALL_KICK * H) / E.M_SPAZ : 0;
    for (const b of ARENA.blocks) {
      if (o.y >= b.h - 0.02) continue;
      const hw = b.w / 2 + r;
      const hd = b.d / 2 + r;
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
      if (hw - Math.abs(dx) < hd - Math.abs(dz)) {
        o.x = b.x + (dx < 0 ? -hw : hw);
        o.vx = (dx < 0 ? Math.min(0, o.vx) : Math.max(0, o.vx)) + (dx < 0 ? -k : k);
      } else {
        o.z = b.z + (dz < 0 ? -hd : hd);
        o.vz = (dz < 0 ? Math.min(0, o.vz) : Math.max(0, o.vz)) + (dz < 0 ? -k : k);
      }
    }
    if (o.y < -0.3 && o.y > -1.6) {
      const hw = ARENA.hx + r;
      const hd = ARENA.hz + r;
      if (Math.abs(o.x) < hw && Math.abs(o.z) < hd) {
        if (hw - Math.abs(o.x) < hd - Math.abs(o.z)) {
          o.x = o.x < 0 ? -hw : hw;
          o.vx = 0;
        } else {
          o.z = o.z < 0 ? -hd : hd;
          o.vz = 0;
        }
      }
    }
  }

  /** A punch in progress: the fist's sphere hits each body once, from 80 ms until the punch ends ([E]). */
  private punchStep(f: Fighter, h: number) {
    if (f.punchT < 0) return;
    f.punchT += h;
    if (f.punchT >= PUNCH_TIME || f.knockout > 0) {
      f.punchT = -1;
      return;
    }
    if (f.punchT <= E.FIST_FROM) return;
    const fist = E.fistAt(f.punchT);
    const pdx = f.pdx;
    const pdz = f.pdz;
    const side = f.punchSide ? 1 : -1;
    // the punch's frame: forward along the punch, side to its right
    const rx = pdz * side;
    const rz = -pdx * side;
    const ty = f.y + E.ROLLER_R + f.sep;
    const cx = f.x + pdx * fist.f + rx * fist.s;
    const cy = ty + fist.u - 0.1; // [E] moved down 0.1: punching dudes on the ground
    const cz = f.z + pdz * fist.f + rz * fist.s;
    // the fist's velocity: the torso's plus the swing
    const fvx = f.vx + pdx * fist.vf;
    const fvy = (f.grounded ? 0 : f.vy) + fist.vu;
    const fvz = f.vz + pdz * fist.vf;
    const power = E.punchPower(f.punchT);
    const gloves = f.glovesT > 0;
    let first = f.punched.length === 0;
    for (const o of this.seats.values()) {
      if (o === f || !o.alive || o.gone || !o.inRound || f.punched.includes(o.id) || o.holdFighter === f.id) continue;
      const oy = o.y + E.ROLLER_R + o.sep;
      let touch = false;
      for (const p of E.CORE_PARTS) {
        const lying = (o.knockout > 0 || !o.alive) && o.grounded && !o.heldBy;
        const px = o.x + (lying ? Math.sin(o.yaw) * p.fwd : 0);
        const pz = o.z + (lying ? Math.cos(o.yaw) * p.fwd : 0);
        const py = this.partY(o, p, oy);
        const pr = p.head ? E.HEAD_R : p.m === E.M_PELVIS ? 0.12 : E.TORSO_R;
        if (Math.hypot(px - cx, py - cy, pz - cz) < E.FIST_R + pr) touch = true;
      }
      if (!touch) continue;
      // [S] no punches on fighters right after a pick-up press or a let-go
      if (f.sincePickupPress - f.punchT <= PUNCH_GRAB_GAP && f.sincePickupPress >= f.punchT) continue;
      if (f.sinceDrop <= PUNCH_DROP_GAP) continue;
      f.punched.push(o.id);
      const total = Game.punchTotal(f.pmLin, f.pmAng, power, gloves);
      const [dvx, dvy, dvz] = E.pointImpulse(total, fvx, fvy, fvz, E.M_SPAZ + this.carried(o));
      this.hurt(o, Math.round(DAMAGE_SCALE * 5 * total), f.id, "punch", dvx, dvy, dvz, cx, cy, cz);
      if (first) this.kickBack(f, fvx, fvy, fvz);
      first = false;
    }
    // bomb.py _handle_hit: a punch only knocks a bomb away; an armed impact bomb goes off
    for (const b of this.bombs) {
      if (b.heldBy || b.stuck || f.punched.includes(b.id)) continue;
      const r = b.kind === "tnt" ? TNT_R : BOMB_R;
      if (Math.hypot(b.x - cx, b.y - cy, b.z - cz) >= E.FIST_R + r) continue;
      f.punched.push(b.id);
      const total = Game.punchTotal(f.pmLin, f.pmAng, power, gloves);
      const [dvx, dvy, dvz] = E.pointImpulse(total, fvx, fvy, fvz, b.kind === "tnt" ? E.TNT_M : E.BOMB_M);
      b.vx += dvx;
      b.vy += dvy;
      b.vz += dvz;
      b.rest = false;
      if (b.kind === "impact" && b.age >= ARM_TIME) b.fuse = Math.min(b.fuse, CHAIN_MIN + this.rng() * 0.1);
      if (first) this.kickBack(f, fvx, fvy, fvz);
      first = false;
    }
  }

  /** [S]/[E] the puncher's first hit pushes it back: −400 along the fist's way for one step. */
  private kickBack(f: Fighter, dx: number, dy: number, dz: number) {
    const l = Math.hypot(dx, dy, dz) || 1;
    const k = (KICK_BACK * E.SRC_H) / (E.M_SPAZ + this.carried(f));
    f.vx -= (dx / l) * k;
    f.vz -= (dz / l) * k;
    if (!f.grounded) f.vy -= (dy / l) * k;
  }

  /** Fighters push each other apart (ball against ball, when the balls are level), and off the TNT crate. */
  private separate(fs: Fighter[]) {
    const min = RADIUS * 2;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]!;
      if (!a.alive || a.heldBy || !a.inRound) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]!;
        if (!b.alive || b.heldBy || !b.inRound || Math.abs(a.y - b.y) > 2 * RADIUS) continue;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-3;
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
      for (const t of this.bombs) {
        if (t.kind !== "tnt" || t.heldBy || a.y > t.y + TNT_R - 0.1 || a.y + HEIGHT < t.y - TNT_R) continue;
        const dx = a.x - t.x;
        const dz = a.z - t.z;
        const d = Math.hypot(dx, dz) || 1e-3;
        const m = RADIUS + TNT_R;
        if (d >= m) continue;
        a.x += (dx / d) * (m - d);
        a.z += (dz / d) * (m - d);
      }
    }
  }

  /** Gravity, the deck, the blocks for a prop. Returns the speed it hit the ground with (0 when not on the ground). */
  private moveProp(o: Body, h: number, r: number): number {
    const wasY = o.y - r;
    o.vy -= GRAVITY * h;
    o.x += o.vx * h;
    o.y += o.vy * h;
    o.z += o.vz * h;
    let landed = 0;
    const y = o.y - r;
    const top = groundAt(o.x, o.z);
    if (top !== null && o.vy <= 0 && y <= top && wasY >= top - 0.3) {
      landed = Math.max(-o.vy, 0.001);
      o.y = top + r;
      // [E] bounce 0: only the soft contact gives a little back
      o.vy = landed > 1 ? landed * E.PROP_BOUNCE : 0;
    }
    const below = o.y - r;
    for (const b of ARENA.blocks) {
      if (below >= b.h - 0.02) continue;
      const hw = b.w / 2 + r;
      const hd = b.d / 2 + r;
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
      if (hw - Math.abs(dx) < hd - Math.abs(dz)) {
        o.x = b.x + (dx < 0 ? -hw : hw);
        o.vx = -o.vx * E.PROP_BOUNCE;
      } else {
        o.z = b.z + (dz < 0 ? -hd : hd);
        o.vz = -o.vz * E.PROP_BOUNCE;
      }
    }
    if (below < -0.3 && below > -1.6) {
      const hw = ARENA.hx + r;
      const hd = ARENA.hz + r;
      if (Math.abs(o.x) < hw && Math.abs(o.z) < hd) {
        if (hw - Math.abs(o.x) < hd - Math.abs(o.z)) {
          o.x = o.x < 0 ? -hw : hw;
          o.vx = 0;
        } else {
          o.z = o.z < 0 ? -hd : hd;
          o.vz = 0;
        }
      }
    }
    return landed;
  }

  /** A bomb on the deck: Coulomb friction at its contact point turns sliding into rolling; spin damps slowly ([E]). */
  private roll(b: Bomb, landed: number, h: number) {
    const R = BOMB_R;
    const m = E.BOMB_M;
    const I = 0.4 * m * R * R;
    // the contact point's velocity (the ball's plus its spin's, at (0, −R, 0))
    const cvx = b.vx + b.wz * R;
    const cvz = b.vz - b.wx * R;
    const cv = Math.hypot(cvx, cvz);
    if (cv > 1e-6) {
      // the impulse that makes it roll, capped by μ × the normal impulse (its weight this step, plus the landing)
      const need = (cv * m) / 3.5;
      const cap = E.MU_BOMB * m * landed;
      const j = Math.min(need, cap);
      const jx = (-cvx / cv) * j;
      const jz = (-cvz / cv) * j;
      b.vx += jx / m;
      b.vz += jz / m;
      b.wx += (-R * jz) / I;
      b.wz += (R * jx) / I;
    }
  }

  private stepBombs(h: number) {
    const spinDamp = Math.exp((-E.PROP_SPIN_DAMP * E.BOMB_M * h) / (0.4 * E.BOMB_M * BOMB_R * BOMB_R));
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]!;
      const tnt = b.kind === "tnt";
      const r = tnt ? TNT_R : BOMB_R;
      if (this.phase === "play") b.fuse -= h;
      b.age += h;
      if (b.free >= 0) b.free += h;
      let boom = b.fuse <= 0;
      if (b.heldBy) {
        const o = this.seats.get(b.heldBy);
        if (!o || !o.alive || o.holdBomb !== b.id) {
          b.heldBy = null;
          b.free = 0;
        } else {
          // [E] 1.08 over the torso, 0.05 forward, sagging on the 180 spring
          const sag = ((tnt ? E.TNT_M : E.BOMB_M) * GRAVITY) / E.HOLD_K;
          b.x = o.x + Math.sin(o.yaw) * E.HOLD_FWD;
          b.y = o.y + E.ROLLER_R + o.sep + E.HOLD_UP - sag;
          b.z = o.z + Math.cos(o.yaw) * E.HOLD_FWD;
          b.vx = o.vx;
          b.vy = o.grounded ? 0 : o.vy;
          b.vz = o.vz;
          b.wx = b.wz = 0;
        }
      } else if (b.stuck) {
        const s = b.stuck === "ground" ? null : this.seats.get(b.stuck);
        if (s && !s.gone) {
          const c = Math.cos(s.yaw);
          const n = Math.sin(s.yaw);
          b.x = s.x + b.sx * c + b.sz * n;
          b.y = s.y + b.sy;
          b.z = s.z - b.sx * n + b.sz * c;
        } else if (b.stuck !== "ground") b.stuck = null;
      } else if (!b.rest) {
        b.wx *= spinDamp;
        b.wz *= spinDamp;
        const sp = Math.hypot(b.vx, b.vy, b.vz);
        if (sp > E.PROP_MAX_SPEED) {
          const k = E.PROP_MAX_SPEED / sp;
          b.vx *= k;
          b.vy *= k;
          b.vz *= k;
        }
        const hit = this.moveProp(b, h, r);
        if (hit > 0) {
          if (tnt) {
            // a crate slides: friction μ·g
            const v = Math.hypot(b.vx, b.vz);
            const k = v > 0 ? Math.max(0, v - E.MU_BOMB * hit) / v : 0;
            b.vx *= k;
            b.vz *= k;
          } else this.roll(b, hit, h);
          // [E] ODE puts a body to sleep when it barely moves
          if (Math.hypot(b.vx, b.vz) + Math.abs(b.vy) < 0.1 && Math.hypot(b.wx, b.wz) < 0.1 && b.kind !== "impact") {
            b.rest = true;
            b.vx = b.vy = b.vz = b.wx = b.wz = 0;
          }
        }
        // against fighters
        let who: Fighter | null = null;
        if (!tnt && b.free >= 0) {
          for (const f of this.seats.values()) {
            if (!f.alive || f.gone || !f.inRound || (f.id === b.owner && b.free < STICK_OWNER && b.kind === "sticky")) continue;
            const dx = b.x - f.x;
            const dz = b.z - f.z;
            const d = Math.hypot(dx, dz);
            if (d >= RADIUS + r || b.y < f.y - r || b.y > f.y + HEIGHT + r) continue;
            who = f;
            const n = d || 1;
            const vn = (b.vx * dx + b.vz * dz) / n - (f.vx * dx + f.vz * dz) / n;
            b.x = f.x + (dx / n) * (RADIUS + r);
            b.z = f.z + (dz / n) * (RADIUS + r);
            if (vn < 0) {
              b.vx -= (dx / n) * vn;
              b.vz -= (dz / n) * vn;
            }
            break;
          }
        }
        // bomb.py _handle_impact: an impact bomb older than 200 ms goes off on any touch, but not against its owner
        if (b.kind === "impact" && b.age >= ARM_TIME && b.free >= 0 && (hit > 0 || (who && who.id !== b.owner))) boom = true;
        if (b.kind === "sticky" && b.free >= 0 && (hit > 0 || who)) {
          // bomb.py: it sticks to what it touches (to its thrower only after 0.25 s)
          if (who) {
            b.stuck = who.id;
            const c = Math.cos(who.yaw);
            const n = Math.sin(who.yaw);
            const dx = b.x - who.x;
            const dz = b.z - who.z;
            b.sx = dx * c - dz * n;
            b.sz = dx * n + dz * c;
            b.sy = clamp(b.y - who.y, 0.2, HEIGHT);
          } else b.stuck = "ground";
          b.vx = b.vy = b.vz = b.wx = b.wz = 0;
          this.events.push({ type: "stick", x: b.x, y: b.y, z: b.z });
        }
        if (b.y < KILL_Y) {
          this.bombs.splice(i, 1);
          if (tnt) this.tntT = TNT_RESPAWN * (0.8 + this.rng() * 0.4);
          continue;
        }
      }
      if (boom) {
        this.bombs.splice(i, 1);
        if (b.heldBy) {
          const o = this.seats.get(b.heldBy);
          if (o) o.holdBomb = 0;
        }
        if (tnt) this.tntT = TNT_RESPAWN * (0.8 + this.rng() * 0.4);
        this.explode(b.x, b.y - BLAST_DROP, b.z, b.radius, b.kind, b.owner);
        i = Math.min(i, this.bombs.length);
      }
    }
  }

  private stepBoxes(dt: number) {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i]!;
      b.age += dt;
      if (!b.rest) {
        for (let k = 0; k < SUBSTEPS; k++) if (this.moveProp(b, dt / SUBSTEPS, BOX_R) > 0 && Math.abs(b.vy) < 0.5) b.rest = true;
        if (b.rest) b.vx = b.vz = 0;
      }
      let taken = false;
      if (this.phase === "play") {
        for (const f of this.seats.values()) {
          if (!f.alive || f.gone || !f.inRound || f.heldBy) continue;
          if (Math.hypot(f.x - b.x, f.z - b.z) < RADIUS + BOX_R + 0.1 && b.y > f.y - BOX_R && b.y < f.y + HEIGHT + BOX_R) {
            this.give(f, b.kind);
            taken = true;
            break;
          }
        }
      }
      if (taken || b.age >= POWERUP_LIFE || b.y < KILL_Y) this.boxes.splice(i, 1);
    }
  }
}
