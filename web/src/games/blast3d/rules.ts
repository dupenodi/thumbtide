// Blast Party 3D: the rules. Plain TypeScript (no DOM, no three.js), a fixed 60 Hz step, a seeded random source.
// The rules and numbers are ported from Ballistica's MIT scripts (spaz.py, bomb.py, powerupbox.py, elimination.py,
// the_pad.py); RULES_NOTES.md traces each value to its source line and says which ones are tuned here because they
// live in Ballistica's C++ physics. Fighters are capsules (a character controller); the ragdoll is drawn on top by
// the view and never feeds back into the rules, so a match plays the same in Node as on the TV.

export const STEP = 1 / 60;
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
// [S] = from a Ballistica script, [E] = from Ballistica's engine source, [T] = tuned here. See RULES_NOTES.md.
export const HP = 1000; // [S] spaz.py default_hitpoints
export const PUNCH_COOLDOWN = 0.4; // [S] BASE_PUNCH_COOLDOWN 400 ms
export const PUNCH_COOLDOWN_GLOVES = 0.3; // [S] spazfactory.py punch_cooldown_gloves 300 ms
export const PUNCH_SCALE = 1.2; // [S] BASE_PUNCH_POWER_SCALE
export const PUNCH_SCALE_GLOVES = 1.4; // [S] spazfactory.py punch_power_scale_gloves
export const PUNCH_TIME = 35 / 120; // [E] kPunchDuration 35 steps at 120 Hz
export const PUNCH_HIT_AT = 0.1; // [E] punch_power peaks 100 ms after the press
export const PUNCH_REACH = 1.15; // [T]
export const JUMP_COOLDOWN = 0.25; // [S] _jump_cooldown 250 ms
export const PICKUP_COOLDOWN = 40 / 120; // [E] kPickupCooldown 40 steps
export const INVINCIBLE = 1.0; // [S] spaz.py: invincible for 1.0 s after a spawn
export const DAMAGE_SCALE = 0.22; // [S] spaz.py damage_scale
export const KNOCKOUT_MAX = 26; // [E] behaviour version 2
export const KNOCKOUT_PER_S = 24; // [E] one tick per 5 steps of 120 Hz with footing (half that in the air)
export const SHIELD_HP = 650; // [S] shield_hitpoints_max
export const SHIELD_DECAY = 10 / 0.5; // [S] shield_decay_rate 10 every 0.5 s
export const SHIELD_SPILL = 500; // [S] max_shield_spillover_damage
export const WEAR_OFF = 20; // [S] POWERUP_WEAR_OFF_TIME 20000 ms
export const BLAST_RADIUS = 2.0; // [S] spaz.py blast_radius / bomb.py default
export const IMPACT_RADIUS_K = 0.7; // [S] bomb.py
export const TNT_RADIUS_K = 1.45; // [S] bomb.py
export const TNT_MAG_K = 2.0; // [S] bomb.py Blast: mag 2000, × 2.0 for tnt
export const FUSE = 3.0; // [S] bomb.py fuse_time, normal and sticky
export const IMPACT_FUSE = 20.0; // [S] bomb.py fuse_time, impact
export const ARM_TIME = 0.25; // [S] bomb.py: an impact bomb arms, a sticky bomb may stick to its thrower, 0.25 s on
export const CHAIN_MIN = 0.1; // [S] bomb.py _handle_hit: 0.1 + random × 0.1 s
export const POWERUP_INTERVAL = 8.0; // [S] DEFAULT_POWERUP_INTERVAL
export const POWERUP_STAGGER = 0.4; // [S] _gameactivity.py _standard_drop_powerups
export const POWERUP_LIFE = POWERUP_INTERVAL - 1.0; // [S] powerupbox.py
export const POWERUP_FLASH = POWERUP_INTERVAL - 2.5; // [S] powerupbox.py
export const TNT_RESPAWN = 20.0; // [S] TNTSpawner respawn_time, × random 0.8–1.2
export const RESPAWN = 3.0; // [S] _gameactivity.py respawn_player: 3.0 s when a team is one player
export const END_CHECK = 1.0; // [S] elimination.py: the "who is left" check runs once a second
export const THROW_SOFT = 0.5; // [E] a throw within 500 ms of the pick-up is weaker (0.4 → 1.0)

// [T] the capsule physics (Ballistica's are an ODE rigid-body ragdoll in C++; these are picked to feel alike)
export const GRAVITY = 20;
export const RUN = 5.4;
export const JUMP_V = 6.6;
export const RADIUS = 0.36;
export const HEIGHT = 2.0;
export const BOMB_R = 0.24;
export const TNT_R = 0.45;
export const BOX_R = 0.36;
export const BLAST_HP = 1400; // hit points lost at the centre of a normal blast (falls off in a line to the radius)
export const BLAST_DV = 13; // knock-back at the centre (m/s)
export const PUNCH_DV = 0.009;
export const MOMENTUM_TIME = 0.5; // how fast a run-up builds a punch (s)
export const PUNCH_RECOIL = 0.2; // what is left of it after a punch lands // knock-back per hit point of punch damage (m/s)
export const THROW_H = 8.2; // a full throw: sideways and upward speed (m/s)
export const THROW_V = 6.4;
export const HOLD_MAX = 2.5; // a carried fighter breaks free after this long
export const PICKUP_REACH = 1.25;
export const KILL_Y = -5.5; // the_pad.py map_bounds: about 5.5 m under the floor

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
 */
export const ARENA = {
  hx: 7.5,
  hz: 7.0,
  blocks: [
    { x: -2.5, z: 0.5, w: 1.7, d: 1.7, h: 0.7 },
    { x: 2.7, z: -0.6, w: 1.7, d: 1.7, h: 0.7 },
    { x: 0, z: 4.3, w: 3.2, d: 0.9, h: 0.7 },
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

export interface Fighter extends Body {
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
  yaw: number;
  grounded: boolean;
  /** Stick, -1..1 (z towards the camera). */
  ix: number;
  iz: number;
  /** Knock-out ticks left (Ballistica's `knockout`): no control, can be picked up. */
  knockout: number;
  invincible: number;
  /** Punch swing in seconds since the press, or -1. */
  punchT: number;
  punchSide: number;
  punchCd: number;
  /** Its speed, smoothed: what a punch hurts by (Ballistica's punch_momentum_linear). */
  momentum: number;
  jumpCd: number;
  pickupCd: number;
  /** What it carries: a bomb's id, or a fighter's id. */
  holdBomb: number;
  holdFighter: string | null;
  holdT: number;
  heldBy: string | null;
  heldT: number;
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
  /** Seconds since it left a hand (-1 while it has never been thrown). */
  free: number;
  /** Sticky: the fighter it sticks to, or "ground". */
  stuck: string | null;
  sx: number;
  sy: number;
  sz: number;
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
  | { type: "hit"; id: string; by: string | null; damage: number; kind: "punch" | "blast"; x: number; y: number; z: number; dx: number; dy: number; dz: number }
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
      id, name, bot, slot, wins: 0, inRound: false, lives: 0, alive: false, gone: true, hp: HP, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0,
      grounded: false, ix: 0, iz: 0, knockout: 0, invincible: 0, punchT: -1, punchSide: 0, punchCd: 0, momentum: 0, jumpCd: 0, pickupCd: 0, holdBomb: 0,
      holdFighter: null, holdT: 0, heldBy: null, heldT: 0, tripleT: 0, bombKind: "normal", bombKindT: 0, glovesT: 0, shield: 0, respawnT: 0, deadT: 0,
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
    Object.assign(f, {
      x: sx, y: 0, z: sz, vx: 0, vy: 0, vz: 0, yaw: Math.atan2(-sx, -sz), alive: true, gone: false, hp: HP, grounded: true, knockout: 0,
      invincible: INVINCIBLE, punchT: -1, punchCd: 0, momentum: 0, jumpCd: 0, pickupCd: 0, holdBomb: 0, holdFighter: null, holdT: 0, heldBy: null, heldT: 0,
      tripleT: 0, bombKind: "normal", bombKindT: 0, glovesT: 0, shield: 0, respawnT: 0, deadT: 0,
    } satisfies Partial<Fighter>);
    this.events.push({ type: "spawn", id: f.id });
  }

  private spawnTnt() {
    const [x, z] = ARENA.tnt;
    this.bombs.push({
      id: this.uid++, kind: "tnt", owner: null, fuse: Infinity, radius: BLAST_RADIUS * TNT_RADIUS_K, heldBy: null, free: 9, stuck: null,
      sx: 0, sy: 0, sz: 0, rest: false, x, y: TNT_R + 3, z, vx: 0, vy: 0, vz: 0,
    });
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

  /** Can it act: in play, on its feet. */
  ready(f: Fighter): boolean {
    return this.phase === "play" && f.alive && f.knockout <= 0 && !f.heldBy;
  }
  private canAct(f: Fighter | undefined): f is Fighter {
    return !!f && this.ready(f);
  }
  holding(f: Fighter) {
    return f.holdBomb !== 0 || f.holdFighter !== null;
  }

  jump(id: string) {
    const f = this.seats.get(id);
    if (!this.canAct(f) || !f.grounded || f.jumpCd > 0) return false;
    f.vy = JUMP_V;
    f.grounded = false;
    f.jumpCd = JUMP_COOLDOWN;
    this.events.push({ type: "jump", id, x: f.x, y: f.y, z: f.z });
    return true;
  }

  /** Punch; with something in the hands, throw it (as in Ballistica, every action button throws). */
  punch(id: string) {
    const f = this.seats.get(id);
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f);
    if (f.punchCd > 0) return false;
    f.punchCd = f.glovesT > 0 ? PUNCH_COOLDOWN_GLOVES : PUNCH_COOLDOWN;
    f.punchT = 0;
    f.punchSide = 1 - f.punchSide;
    this.events.push({ type: "punch", id });
    return true;
  }

  /** Bomb: the first press lights one in the hands, the next press throws it (spaz.py on_bomb_press). */
  bomb(id: string) {
    const f = this.seats.get(id);
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f);
    if (this.bombsLeft(f) <= 0) return false;
    const kind = f.bombKind;
    const b: Bomb = {
      id: this.uid++, kind, owner: id, fuse: kind === "impact" ? IMPACT_FUSE : FUSE, radius: BLAST_RADIUS * (kind === "impact" ? IMPACT_RADIUS_K : 1),
      heldBy: id, free: -1, stuck: null, sx: 0, sy: 0, sz: 0, rest: false, x: f.x, y: f.y + HEIGHT + 0.3, z: f.z, vx: 0, vy: 0, vz: 0,
    };
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

  /** Pick up a bomb, the TNT crate or a knocked-out fighter in front; with something in the hands, throw it. */
  grab(id: string) {
    const f = this.seats.get(id);
    if (!this.canAct(f)) return false;
    if (this.holding(f)) return this.throwHeld(f);
    if (f.pickupCd > 0) return false;
    f.pickupCd = PICKUP_COOLDOWN;
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    let best = PICKUP_REACH;
    let bomb: Bomb | null = null;
    let man: Fighter | null = null;
    const near = (o: Body, dy: number) => {
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      const d = Math.hypot(dx, dz);
      return Math.abs(dy) < 1.4 && (d < 0.5 || dx * fx + dz * fz > 0) ? d : 1e9;
    };
    for (const b of this.bombs) {
      if (b.heldBy || b.stuck) continue;
      const d = near(b, b.y - f.y - 0.5) - (b.kind === "tnt" ? 0.25 : 0);
      if (d < best) {
        best = d;
        bomb = b;
        man = null;
      }
    }
    for (const o of this.seats.values()) {
      // the task's rule: only a knocked-out fighter can be lifted (Ballistica lets you lift anyone)
      if (o === f || !o.alive || o.gone || o.heldBy || o.knockout <= 0 || o.invincible > 0 || !o.inRound) continue;
      const d = near(o, o.y - f.y) + 0.15; // a bomb at the same distance wins
      if (d < best) {
        best = d;
        man = o;
        bomb = null;
      }
    }
    if (bomb) {
      bomb.heldBy = id;
      bomb.rest = false;
      f.holdBomb = bomb.id;
    } else if (man) {
      this.letGo(man);
      man.heldBy = id;
      man.heldT = 0;
      f.holdFighter = man.id;
    } else return false;
    f.holdT = 0;
    this.events.push({ type: "grab", id });
    return true;
  }

  /** The throw's velocity for a stick pushed `scale` (0..1) and a thing held for `held` seconds ([E] spaz_node.cc Throw). */
  static throwSpeed(scale: number, held = 1, mass = 1): [number, number] {
    let power = 0.8 * (0.6 + 0.4 * clamp(scale, 0, 1));
    if (held < THROW_SOFT) power *= 0.4 + 0.6 * (held / THROW_SOFT);
    const k = power / 0.8 / mass;
    return [THROW_H * k, THROW_V * k];
  }

  private throwHeld(f: Fighter) {
    const b = f.holdBomb ? this.bombs.find((x) => x.id === f.holdBomb) : undefined;
    const man = f.holdFighter ? this.seats.get(f.holdFighter) : undefined;
    const body: Body | undefined = b ?? man;
    const m = Math.hypot(f.ix, f.iz);
    // the stick's direction when it is pushed, else the way it faces
    const dx = m > 0.1 ? f.ix / m : Math.sin(f.yaw);
    const dz = m > 0.1 ? f.iz / m : Math.cos(f.yaw);
    if (m > 0.1) f.yaw = Math.atan2(dx, dz);
    const [vh, vv] = Game.throwSpeed(m, f.holdT, man ? 1.35 : b?.kind === "tnt" ? 1.3 : 1);
    f.holdBomb = 0;
    f.holdFighter = null;
    if (!body) return false;
    body.vx = dx * vh + f.vx * 0.5;
    body.vz = dz * vh + f.vz * 0.5;
    body.vy = vv;
    if (b) {
      b.heldBy = null;
      b.free = 0;
    } else if (man) {
      man.heldBy = null;
      man.grounded = false;
      man.knockout = Math.max(man.knockout, 10); // [T] still dizzy when it lands
    }
    this.events.push({ type: "throw", id: f.id });
    return true;
  }

  /** Drop whatever it carries, where it stands. */
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
    }
    if (f.holdFighter) {
      const o = this.seats.get(f.holdFighter);
      if (o && o.heldBy === f.id) {
        o.heldBy = null;
        o.vx = f.vx;
        o.vy = 0;
        o.vz = f.vz;
      }
      f.holdFighter = null;
    }
  }
  /** A carried fighter gets loose. */
  private release(f: Fighter) {
    const h = f.heldBy ? this.seats.get(f.heldBy) : undefined;
    if (h && h.holdFighter === f.id) h.holdFighter = null;
    f.heldBy = null;
  }

  // ---------------------------------------------------------------------------------------------- damage
  /** Knock-out ticks for a hit ([E] spaz_node.cc: min(26, max(k, int(raw × 0.02) − 24)), raw = damage / 0.22). */
  static knockoutFor(damage: number) {
    return clamp(Math.floor((damage / DAMAGE_SCALE) * 0.02) - 24, 0, KNOCKOUT_MAX);
  }

  /** A punch's damage from the puncher's run-up (its smoothed speed) ([E]/[T], see RULES_NOTES.md). */
  static punchDamage(speed: number, gloves: boolean) {
    const scale = gloves ? PUNCH_SCALE_GLOVES : PUNCH_SCALE;
    // hp = 0.22 × 5 (one-body hit) × punch_power(1.0 at the peak) × scale × (40 × momentum + the spin's share)
    return Math.round(DAMAGE_SCALE * 5 * scale * (40 * 1.0 * speed + 50));
  }

  /** A blast's damage at a distance ([E] rigid_body.cc: a straight fall-off to the radius). */
  static blastDamage(dist: number, radius: number, kind: BombKind = "normal") {
    if (dist >= radius) return 0;
    return Math.round(BLAST_HP * (kind === "tnt" ? TNT_MAG_K : 1) * (1 - dist / radius));
  }

  /** A hit (spaz.py HitMessage): the shield takes it first; damage, knock-back, knock-out, death. */
  hurt(f: Fighter, damage: number, by: string | null, kind: "punch" | "blast", dvx: number, dvy: number, dvz: number, px = f.x, py = f.y + 1, pz = f.z) {
    if (!f.alive || f.invincible > 0 || damage <= 0) return 0;
    let ratio = 1;
    if (f.shield > 0) {
      f.shield -= damage;
      if (f.shield <= 0) this.events.push({ type: "shieldDown", id: f.id, x: f.x, y: f.y + 0.9, z: f.z });
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
    if (dvy * ratio > 0.5) f.grounded = false;
    if (damage > 0) this.letGo(f);
    f.hp -= damage;
    f.knockout = Math.max(f.knockout, Game.knockoutFor(damage));
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

  /** A blast (bomb.py Blast): fighters, bombs and boxes inside the radius. */
  explode(x: number, y: number, z: number, radius: number, kind: BombKind, by: string | null) {
    this.events.push({ type: "blast", x, y, z, radius, kind });
    const k = kind === "tnt" ? TNT_MAG_K : 1;
    const push = (o: Body, cy: number, mass: number) => {
      const dx = o.x - x;
      const dy = cy - y;
      const dz = o.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d >= radius) return -1;
      const amt = 1 - d / radius;
      const n = d || 1;
      // [E] rigid_body.cc: the upward part of the push is doubled; [T] and it always lifts a little
      const dv = (BLAST_DV * k * amt) / mass;
      return { d, dvx: (dx / n) * dv, dvy: Math.max(0.35, (dy / n) * 2) * dv * 0.6, dvz: (dz / n) * dv };
    };
    for (const f of this.seats.values()) {
      if (f.gone || !f.inRound) continue;
      // the nearest point of the body (its axis from the hips to the head), as the engine sums over the body's parts
      const p = push(f, clamp(y, f.y + 0.5, f.y + HEIGHT - 0.2), 1);
      if (p === -1) continue;
      if (f.alive) this.hurt(f, Game.blastDamage(p.d, radius, kind), by, "blast", p.dvx, p.dvy, p.dvz, x, y, z);
      else {
        f.vx += p.dvx;
        f.vy += p.dvy;
        f.vz += p.dvz;
        f.grounded = false;
      }
    }
    for (const b of this.bombs) {
      const p = push(b, b.y, b.kind === "tnt" ? 2 : 0.8);
      if (p === -1) continue;
      if (!b.heldBy && !b.stuck) {
        b.vx += p.dvx;
        b.vy += p.dvy;
        b.vz += p.dvz;
        b.rest = false;
      }
      // a chain reaction: it goes off 0.1–0.2 s later
      b.fuse = Math.min(b.fuse, CHAIN_MIN + this.rng() * 0.1);
    }
    // powerupbox.py: any hit that is not a punch destroys a box
    this.boxes = this.boxes.filter((b) => Math.hypot(b.x - x, b.y - y, b.z - z) >= radius);
  }

  private give(f: Fighter, kind: PowerKind) {
    if (kind === "triple") f.tripleT = WEAR_OFF;
    else if (kind === "impact" || kind === "sticky") {
      f.bombKind = kind;
      f.bombKindT = WEAR_OFF;
    } else if (kind === "gloves") f.glovesT = WEAR_OFF;
    else if (kind === "shield") f.shield = SHIELD_HP;
    else f.hp = HP;
    this.events.push({ type: "power", id: f.id, kind, x: f.x, y: f.y + 1, z: f.z });
  }

  // ---------------------------------------------------------------------------------------------- step
  step() {
    this.t++;
    if (this.phase === "wait" || this.phase === "match") return;
    if (this.phase === "count") {
      if (this.t >= COUNT_STEPS) this.setPhase("play");
      // the fighters stand; the TNT crate drops in
      this.stepBombs(STEP);
      return;
    }
    if (this.phase === "round") {
      this.physics(STEP);
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
    this.physics(STEP);
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

  private physics(dt: number) {
    const fs = this.list();
    for (const f of fs) if (f.inRound) this.stepFighter(f, dt);
    this.separate(fs);
    this.stepBombs(dt);
    this.stepBoxes(dt);
  }

  private stepFighter(f: Fighter, dt: number) {
    if (!f.alive) {
      f.deadT += dt;
      if (f.respawnT > 0 && (f.respawnT -= dt) <= 0 && this.phase === "play") {
        this.spawn(f);
        return;
      }
      if (f.deadT > RESPAWN) f.gone = true;
      if (f.gone) return;
      if (f.grounded) {
        const k = Math.max(0, 1 - 5 * dt);
        f.vx *= k;
        f.vz *= k;
      }
      this.moveBody(f, dt, RADIUS, true);
      if (f.y < KILL_Y) f.gone = true;
      return;
    }
    f.invincible = Math.max(0, f.invincible - dt);
    f.punchCd = Math.max(0, f.punchCd - dt);
    f.jumpCd = Math.max(0, f.jumpCd - dt);
    f.pickupCd = Math.max(0, f.pickupCd - dt);
    f.holdT += dt;
    if (f.tripleT > 0) f.tripleT = Math.max(0, f.tripleT - dt);
    if (f.glovesT > 0) f.glovesT = Math.max(0, f.glovesT - dt);
    if (f.bombKindT > 0 && (f.bombKindT -= dt) <= 0) {
      f.bombKindT = 0;
      f.bombKind = "normal";
    }
    if (f.shield > 0) f.shield = Math.max(0, f.shield - SHIELD_DECAY * dt);
    if (f.holdFighter && this.seats.get(f.holdFighter)?.heldBy !== f.id) f.holdFighter = null;
    if (f.holdBomb && !this.bombs.some((b) => b.id === f.holdBomb && b.heldBy === f.id)) f.holdBomb = 0;

    if (f.heldBy) {
      const h = this.seats.get(f.heldBy);
      f.heldT += dt;
      if (!h || !h.alive || h.holdFighter !== f.id || f.heldT > HOLD_MAX) {
        this.release(f);
        f.vy = 2;
      } else {
        f.x = h.x;
        f.y = h.y + HEIGHT + 0.05;
        f.z = h.z;
        f.vx = h.vx;
        f.vy = 0;
        f.vz = h.vz;
        f.yaw = h.yaw + Math.PI / 2;
        f.grounded = false;
        f.knockout = Math.max(f.knockout, 6); // [T] it stays helpless while carried
        return;
      }
    }
    if (f.knockout > 0) f.knockout = Math.max(0, f.knockout - (f.grounded ? KNOCKOUT_PER_S : KNOCKOUT_PER_S / 2) * dt);

    // the punch lands 0.1 s after the press
    if (f.punchT >= 0) {
      const was = f.punchT;
      f.punchT += dt;
      if (was < PUNCH_HIT_AT && f.punchT >= PUNCH_HIT_AT && f.knockout <= 0) this.punchHit(f);
      if (f.punchT >= PUNCH_TIME) f.punchT = -1;
    }

    const control = f.knockout <= 0 && this.phase === "play";
    if (control) {
      const m = Math.hypot(f.ix, f.iz);
      if (m > 0.08) {
        // turn towards the stick
        let d = Math.atan2(f.ix, f.iz) - f.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.yaw += clamp(d, -14 * dt, 14 * dt);
      }
      const run = RUN * (f.holdFighter ? 0.75 : 1);
      const k = Math.min(1, (f.grounded ? 12 : 2.5) * dt);
      f.vx += (f.ix * run - f.vx) * k;
      f.vz += (f.iz * run - f.vz) * k;
    } else if (f.grounded) {
      const k = Math.max(0, 1 - 5 * dt);
      f.vx *= k;
      f.vz *= k;
    }
    this.moveBody(f, dt, RADIUS, true);
    f.momentum += (Math.hypot(f.vx, f.vz) - f.momentum) * Math.min(1, dt / MOMENTUM_TIME);
    if (f.y < KILL_Y) this.die(f, true);
  }

  /** Gravity, the deck, the blocks. Returns the speed it hit the ground with (0 when it did not land). */
  private moveBody(o: Body & { grounded?: boolean }, dt: number, r: number, fighter: boolean, bounce = 0): number {
    const feet = fighter ? 0 : r; // a fighter's y is its feet, a ball's its middle
    const wasY = o.y - feet;
    o.vy -= GRAVITY * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    o.z += o.vz * dt;
    let landed = 0;
    let on = false;
    const y = o.y - feet;
    const top = groundAt(o.x, o.z);
    if (top !== null && o.vy <= 0 && y <= top && wasY >= top - 0.3) {
      if (o.vy < -1.5) landed = -o.vy;
      o.y = top + feet;
      o.vy = bounce && landed > 2.5 ? -o.vy * bounce : 0;
      on = true;
    }
    // sides: the blocks, and the deck's rim from below
    const below = o.y - feet;
    for (const b of ARENA.blocks) {
      if (below >= b.h - 0.02) continue;
      const hw = b.w / 2 + r;
      const hd = b.d / 2 + r;
      const dx = o.x - b.x;
      const dz = o.z - b.z;
      if (Math.abs(dx) >= hw || Math.abs(dz) >= hd) continue;
      if (hw - Math.abs(dx) < hd - Math.abs(dz)) {
        o.x = b.x + (dx < 0 ? -hw : hw);
        o.vx = bounce ? -o.vx * bounce : 0;
      } else {
        o.z = b.z + (dz < 0 ? -hd : hd);
        o.vz = bounce ? -o.vz * bounce : 0;
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
    if (fighter) {
      const f = o as Fighter;
      if (on && !f.grounded && landed > 5) this.events.push({ type: "land", id: f.id, x: f.x, y: f.y, z: f.z, speed: landed });
      f.grounded = on;
    }
    return on ? Math.max(landed, 0.001) : 0;
  }

  private punchHit(f: Fighter) {
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    const speed = Math.hypot(f.vx, f.vz);
    const damage = Game.punchDamage(f.momentum, f.glovesT > 0);
    let landed = false;
    const inReach = (o: Body, oy: number, extra: number) => {
      const dx = o.x - f.x;
      const dz = o.z - f.z;
      const d = Math.hypot(dx, dz);
      return d < PUNCH_REACH + extra && Math.abs(oy - f.y) < 1.5 && dx * fx + dz * fz > 0.35 * d;
    };
    for (const o of this.seats.values()) {
      if (o === f || !o.alive || o.gone || !o.inRound || o.heldBy === f.id || !inReach(o, o.y, 0)) continue;
      const dv = damage * PUNCH_DV;
      this.hurt(o, damage, f.id, "punch", fx * dv, dv * 0.3 + 0.8, fz * dv, o.x - fx * 0.3, o.y + 1.1, o.z - fz * 0.3);
      landed = true;
    }
    if (landed) {
      // spaz.py: the first hit of a punch kicks the puncher back; [T] so a flurry hits softer than a run-up
      f.momentum *= PUNCH_RECOIL;
      f.vx *= 0.5;
      f.vz *= 0.5;
    }
    // bomb.py _handle_hit: a punch only knocks a bomb away; an armed impact bomb goes off
    for (const b of this.bombs) {
      if (b.heldBy || b.stuck || !inReach(b, b.y - 0.5, b.kind === "tnt" ? 0.3 : 0)) continue;
      const k = b.kind === "tnt" ? 0.5 : 1;
      b.vx += fx * (5 + speed) * k;
      b.vz += fz * (5 + speed) * k;
      b.vy += 3.5 * k;
      b.rest = false;
      if (b.kind === "impact" && b.free >= ARM_TIME) b.fuse = Math.min(b.fuse, CHAIN_MIN);
    }
  }

  /** Fighters push each other apart (capsule against capsule), and off the TNT crate. */
  private separate(fs: Fighter[]) {
    const min = RADIUS * 2;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i]!;
      if (!a.alive || a.heldBy || !a.inRound) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j]!;
        if (!b.alive || b.heldBy || !b.inRound || Math.abs(a.y - b.y) > HEIGHT) continue;
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

  private stepBombs(dt: number) {
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i]!;
      const r = b.kind === "tnt" ? TNT_R : BOMB_R;
      if (this.phase === "play") b.fuse -= dt;
      if (b.free >= 0) b.free += dt;
      let boom = b.fuse <= 0;
      if (b.heldBy) {
        const h = this.seats.get(b.heldBy);
        if (!h || !h.alive || h.holdBomb !== b.id) {
          b.heldBy = null;
          b.free = 0;
        } else {
          b.x = h.x + Math.sin(h.yaw) * 0.12;
          b.y = h.y + HEIGHT + 0.05 + r;
          b.z = h.z + Math.cos(h.yaw) * 0.12;
          b.vx = h.vx;
          b.vy = 0;
          b.vz = h.vz;
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
        const hit = this.moveBody(b, dt, r, false, b.kind === "tnt" ? 0.15 : 0.4);
        let touched = hit > 0.5;
        if (hit > 0) {
          // rolling on the ground
          const k = (touched ? 0.6 : 1) * Math.max(0, 1 - (b.kind === "tnt" ? 6 : 3.5) * dt);
          b.vx *= k;
          b.vz *= k;
          if (Math.abs(b.vx) + Math.abs(b.vz) + Math.abs(b.vy) < 0.15 && b.kind !== "impact") b.rest = true;
        }
        // against fighters
        let who: Fighter | null = null;
        if (b.kind !== "tnt" && b.free >= 0) {
          for (const f of this.seats.values()) {
            if (!f.alive || f.gone || !f.inRound || (f.id === b.owner && b.free < ARM_TIME)) continue;
            const dx = b.x - f.x;
            const dz = b.z - f.z;
            const d = Math.hypot(dx, dz);
            if (d >= RADIUS + r || b.y < f.y - r || b.y > f.y + HEIGHT + r) continue;
            who = f;
            const n = d || 1;
            const vn = (b.vx * dx + b.vz * dz) / n;
            b.x = f.x + (dx / n) * (RADIUS + r);
            b.z = f.z + (dz / n) * (RADIUS + r);
            if (vn < 0) {
              b.vx -= (dx / n) * vn * 1.3;
              b.vz -= (dz / n) * vn * 1.3;
            }
            break;
          }
        }
        if (b.kind === "impact" && b.free >= ARM_TIME && (touched || (who && who.id !== b.owner))) boom = true; // bomb.py _handle_impact
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
            b.sy = clamp(b.y - who.y, 0.3, HEIGHT);
          } else b.stuck = "ground";
          b.vx = b.vy = b.vz = 0;
          this.events.push({ type: "stick", x: b.x, y: b.y, z: b.z });
        }
        if (b.y < KILL_Y) {
          this.bombs.splice(i, 1);
          if (b.kind === "tnt") this.tntT = TNT_RESPAWN * (0.8 + this.rng() * 0.4);
          continue;
        }
      }
      if (boom) {
        this.bombs.splice(i, 1);
        if (b.heldBy) {
          const h = this.seats.get(b.heldBy);
          if (h) h.holdBomb = 0;
        }
        if (b.kind === "tnt") this.tntT = TNT_RESPAWN * (0.8 + this.rng() * 0.4);
        this.explode(b.x, b.y, b.z, b.radius, b.kind, b.owner);
        i = Math.min(i, this.bombs.length);
      }
    }
  }

  private stepBoxes(dt: number) {
    for (let i = this.boxes.length - 1; i >= 0; i--) {
      const b = this.boxes[i]!;
      b.age += dt;
      if (!b.rest && this.moveBody(b, dt, BOX_R, false, 0.25) > 0 && Math.abs(b.vy) < 0.5) b.rest = true;
      let taken = false;
      if (this.phase === "play") {
        for (const f of this.seats.values()) {
          if (!f.alive || f.gone || !f.inRound || f.heldBy) continue;
          if (Math.hypot(f.x - b.x, f.z - b.z) < RADIUS + BOX_R + 0.1 && b.y > f.y - BOX_R && b.y < f.y + HEIGHT) {
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
