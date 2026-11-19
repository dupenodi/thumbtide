// Blast Party 3D: the character and prop physics of Ballistica's engine (C++, MIT), ported to a light model for the
// TV. Plain TypeScript, no DOM. RULES_NOTES.md traces every number to its source line (commit d6049a66).
//
// What Ballistica simulates (scene_v1/node/spaz_node.cc, spaz_physics_tuning.h, the bg-limbs tuning that current
// builds use): three core bodies (head, torso, pelvis) riding on an invisible "roller ball" that stands in for the
// legs. A motor spins the ball to walk and run, a spring holds the ball under the torso (the legs; a jump is that
// spring shoved down for 7 steps), an angular spring turns the torso to the stick. The limbs are display only. ODE
// steps that at 8 ms (125 Hz), gravity 20.
//
// What runs here, for 8 fighters at 60 fps on the TV: the same pieces, cut down to what moves the character.
//  - The ground drive: the ball's motor and its friction, per axis, toward the target speed the engine computes
//    (its gear, run gas and steering filters are ported line by line).
//  - The vertical: the core on the ball's spring (implicit, as ODE's soft joints are), the ball on the ground; in the
//    air the two fly as one. That gives the jump, the landing bob and the weight of what is carried.
//  - The turn: torso, head and pelvis about the vertical axis, on the stand spring and the neck and pelvis springs
//    (implicit, 3 bodies), so the turn rate and the spin that powers a punch come from the engine's numbers.
//  - The fist: the engine's synthetic fist (spaz_pose.cc), a table of its path at 8 ms.
// Our step is 1/120 s, two per 60 Hz frame. Per-step factors written for the engine's 8 ms step are converted with
// `per()` / `perGain()` (same time constant and the same steady state); step counts become times.

/** The engine's step (scene_v1.h:558, kGameStepMilliseconds = 8). */
export const SRC_H = 0.008;
/** Ours: two physics steps per 60 Hz frame. */
export const H = 1 / 120;
const R = H / SRC_H;
/** A per-step factor of the engine (a decay or a smoothing) for our step: same time constant. */
export const per = (c: number) => Math.pow(c, R);
/** A per-step increment of the engine for our step. */
export const inc = (d: number) => d * R;
/** The input gain of a filter y = a(y + b·x) for our step, so its steady state a·b/(1−a) stays the same. */
export const perGain = (a: number, b: number) => {
  const a2 = per(a);
  return ((a * b) / (1 - a)) * ((1 - a2) / a2);
};

export const G = 20; // dynamics.cc:1204 dWorldSetGravity(0, -20, 0)

// ---------------------------------------------------------------------------------------------- the body
// rigid_body.cc:747: density = 5 × the given multiplier; masses from each body's "mass shape" (spaz_node.cc:744–806,
// 1473–1482) and the bg-limbs densities (spaz_physics_tuning.h:264–268).
const ball = (r: number) => (4 / 3) * Math.PI * r * r * r;
export const M_HEAD = 5 * 1.0 * ball(0.28); // 0.460
export const M_TORSO = 5 * 3.65 * ball(0.2); // 0.612
export const M_PELVIS = 5 * 6.25 * 0.25 * 0.264 * 0.16; // 0.330
export const M_ROLLER = 5 * 0.125 * ball(0.3); // 0.071
export const M_CORE = M_HEAD + M_TORSO + M_PELVIS; // 1.401 (the header says 1.392)
export const M_SPAZ = M_CORE + M_ROLLER; // 1.472
/** Moments of inertia about the vertical axis (solid sphere 2/5·m·r², box m(w²+d²)/12). */
const I_TORSO = 0.4 * M_TORSO * 0.2 * 0.2;
const I_HEAD = 0.4 * M_HEAD * 0.28 * 0.28;
const I_PELVIS = (M_PELVIS * (0.25 * 0.25 + 0.16 * 0.16)) / 12;

// characterrig.py:37–84: the rig's sizes and where the bodies stand (heights above a common base).
export const ROLLER_R = 0.3;
export const HEAD_R = 0.23;
export const TORSO_R = 0.15; // spaz_node.h:811 torso_radius_ (collision; the mass shape is 0.2)
/** The torso's centre above the ball's centre at rest (1.8 − 1.6); the spring's rest length. */
export const SEP_REST = 0.2;
export const HEAD_UP = 2.25 - 1.8; // head above torso
export const PELVIS_UP = 1.66 - 1.8; // pelvis above torso (below it)
/** The suspension (spaz_physics_tuning.h:270–275): roller joint spring, jump push for 7 steps. */
export const SPRING_K = 1500;
export const SPRING_C = 6;
export const JUMP_PUSH = 0.3;
export const JUMP_TIME = 7 * SRC_H; // 56 ms
export const JUMP_K = SPRING_K * 0.4;
export const JUMP_C = SPRING_C * 0.2;
/** The ball's floor contact (spaz_physics_tuning.h:311–312; the down ball's while knocked out, 326–327). */
export const FLOOR_CONTACT_K = 7000;
export const FLOOR_CONTACT_C = 10;
export const DOWN_CONTACT_K = 1600;
export const DOWN_CONTACT_C = 8;
/** Where the torso sits at rest: the spring sags under the core's weight, the ball into the floor under both. */
export const SEP_EQ = SEP_REST - (M_CORE * G) / SPRING_K;
export const PEN_EQ = (M_CORE + M_ROLLER) * G / FLOOR_CONTACT_K;
/** The torso's centre above the feet when standing (0.48), and the head's top (1.16). */
export const TORSO_Y = ROLLER_R + SEP_EQ;
export const HEAD_TOP = TORSO_Y + HEAD_UP + HEAD_R;

// The drive (spaz_physics_tuning.h:296–307, spaz_node.cc:3200–3265).
export const WALK_SPEED = 7.68; // the ball's target spin (rad/s) for a full stick
export const RUN_SPEED_ADD = 15;
export const GEAR_UP_SPEED = 7;
export const MOTOR_FORCE = 15; // N·m on the ball, per axis
/** dynamics.cc:1117 friction = 1.2·√(f1·f2), every material's friction 1 by default (material_context.cc:14). */
export const MU_ROLLER = 1.2;
/** A body on the ground (not the ball): body_friction_scale 0.1 (spaz_physics_tuning.h:316). */
export const MU_BODY = 1.2 * 0.1;
/** A knocked-out body slides on its core bodies (μ 0.12) and its locked "down ball" (μ 1.2): about half each. */
export const MU_DOWN = 0.5 * MU_ROLLER + 0.5 * MU_BODY;
/** roller_wall_kick_force: the ball is pushed off walls it touches (spaz_physics_tuning.h:315). */
export const WALL_KICK = 100;
/** Bodies' speed cap: |v|² ≤ 300 (spaz_node.cc:2372). */
export const MAX_SPEED = Math.sqrt(300);

// The turn (spaz_physics_tuning.h:279–293).
const STAND_K = 270;
const STAND_C = 3.5;
const NECK_K = 13;
const NECK_C = 0.8;
const NECK_KO_K = 5;
const NECK_KO_C = 0.3;
const PELVIS_K = 1.5;
const PELVIS_C = 0.06;

// ---------------------------------------------------------------------------------------------- the state
/** What the engine keeps per character that this port needs. */
export interface Spaz {
  x: number;
  y: number; // the feet (the ball's bottom)
  z: number;
  vx: number;
  vy: number; // on the ground: the torso's vertical speed; in the air: the whole body's
  vz: number;
  /** The torso above the ball's centre, and whether the ball is on the ground; on it: how far the ball sinks into
   * its soft floor contact and its own vertical speed. */
  sep: number;
  grounded: boolean;
  pen: number;
  vr: number;
  /** Torso, head and pelvis turn (rad, world yaw: facing (sin, cos) in x/z) and their spin (rad/s). */
  yaw: number;
  yawV: number;
  headYaw: number;
  headV: number;
  pelvisYaw: number;
  pelvisV: number;
  /** The stick, -1..1, and the run trigger (0..1: a held button, as on the engine's touch screens). */
  ix: number;
  iz: number;
  run: number;
  /** The engine's smoothed stick (lr_smooth_/ud_smooth_), steering vector (lr_norm_/ud_norm_), run gas, gear speed. */
  sx: number;
  sz: number;
  dx: number;
  dz: number;
  gas: number;
  speedSm: number;
  /** 0..255: how firmly it stands (0 when knocked out, falls off in the air). */
  balance: number;
  aVelSm: number;
  aVelSmMore: number;
  dizzy: number;
  /** Punch momentum (spaz_node.cc:2196–2228): angular and linear, each a two-stage filter. */
  pmAngD: number;
  pmAng: number;
  pmLinD: number;
  pmLin: number;
  /** The punch's direction (smoothed toward the stick). */
  pdx: number;
  pdz: number;
  /** Seconds of jump push left; seconds of "wake slide" (a frictionless ball just after getting up). */
  jumpT: number;
  wake: number;
  knockout: number;
}

export const newSpaz = (): Spaz => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sep: SEP_EQ, grounded: true, pen: PEN_EQ, vr: 0, yaw: 0, yawV: 0, headYaw: 0, headV: 0, pelvisYaw: 0, pelvisV: 0,
  ix: 0, iz: 0, run: 0, sx: 0, sz: 0, dx: 0, dz: 0, gas: 0, speedSm: 0, balance: 255, aVelSm: 0, aVelSmMore: 0, dizzy: 0, pmAngD: 0, pmAng: 0,
  pmLinD: 0, pmLin: 0, pdx: 0, pdz: 1, jumpT: 0, wake: 0, knockout: 0,
});

/** Put a character down standing (spaz_node.cc:5913 Stand). */
export function stand(s: Spaz, x: number, y: number, z: number, yaw: number) {
  Object.assign(s, newSpaz(), { x, y, z, yaw, headYaw: yaw, pelvisYaw: yaw, pdx: Math.sin(yaw), pdz: Math.cos(yaw) });
}

/** What the rest of the rules tell the step. */
export interface DriveCtx {
  /** Mass it carries (hangs on the torso's pick-up spring; counted as rigid here). */
  carry: number;
  holding: boolean;
  /** Seconds since it last threw (running is off for 200 ms after). */
  sinceThrow: number;
  /** Knocked out, dead, or carried: no drive, no stand. */
  limp: boolean;
  dead: boolean;
  /** Ground height under it (null over the drop). */
  ground: number | null;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const q127 = (v: number) => Math.max(-127, Math.min(127, Math.trunc(127 * v)));

// per-step factors, converted (spaz_node.cc line numbers)
const DIGITAL_SMOOTH = per(0.5); // 2063
const GAS_UP = per(0.95); // 2102
const GAS_DOWN = per(0.5);
const GAS_DECAY = inc(0.02); // 2105
const GAS_HOLD = inc(0.05); // 2108
const GAS_AIR = inc(0.05); // 2110
const SPEED_UP = per(0.985); // spaz_physics_tuning.h:302
const SPEED_DOWN = per(0.94);
const AVEL_SM = per(0.7); // 2194
const AVEL_SM_MORE = per(0.92);
const PMA_D = per(0.965); // 2209
const PMA_G = perGain(0.965, 0.0004);
const PMA_M = per(0.92); // 2213
const PMA_MG = perGain(0.92, 1);
const PML_D = per(0.95); // 2223
const PML_G = perGain(0.95, 0.004);
const PML_M = per(0.96); // 2225
const PML_MG = perGain(0.96, 1);
const PUNCH_DIR_BLEND = per(0.5); // 3047
const BAL_UP = inc(20); // 2771–2777
const BAL_DOWN_FAST = inc(20);
const BAL_DOWN_SLOW = inc(5);
const BAL_DOWN_TAIL = inc(1);
const BAL_TOP = inc(1);
const DIZZY_UP = inc(1); // 2754–2764
const DIZZY_DOWN = inc(2);

/**
 * The stick, the run gas and the steering vector (spaz_node.cc:2040–2185). Runs first in a step; returns whether it
 * is running.
 */
export function steer(s: Spaz, c: DriveCtx, footing: boolean) {
  const lr = q127(s.ix);
  const ud = q127(s.iz);
  // smoothed stick: only for digital input (all values -127, 0 or 127), as the engine does for d-pads
  const digital = (lr === -127 || lr === 0 || lr === 127) && (ud === -127 || ud === 0 || ud === 127);
  const sm = digital ? DIGITAL_SMOOTH : 0;
  s.sx = sm * s.sx + (1 - sm) * (lr / 127);
  s.sz = sm * s.sz + (1 - sm) * (ud / 127);

  let tx = lr / 127;
  let tz = ud / 127;
  const l2 = tx * tx + tz * tz;
  if (l2 > 1) {
    const l = Math.sqrt(l2);
    tx /= l;
    tz /= l;
  }
  const running = s.run > 0 && !c.holding && (lr !== 0 || ud !== 0) && c.sinceThrow > 0.2;
  if (running) {
    let target = Math.sqrt(s.run);
    const mag = s.sx * s.sx + s.sz * s.sz;
    if (mag < 0.3) target *= mag / 0.3;
    const k = target > s.gas ? GAS_UP : GAS_DOWN;
    s.gas = k * s.gas + (1 - k) * target;
  } else s.gas = Math.max(0, s.gas - GAS_DECAY);
  if (c.holding) s.gas = Math.max(0, s.gas - GAS_HOLD);
  if (!footing) s.gas = Math.max(0, s.gas - GAS_AIR);

  if (s.run > 0.05) {
    // strip what points more than 90° away from the way it goes, then push toward length 1 with the gas
    const dot = tx * s.dx + tz * s.dz;
    if (dot < 0) {
      tx -= s.gas * s.dx * dot;
      tz -= s.gas * s.dz * dot;
      if (tx === 0) tx = -0.001;
      if (tz === 0) tz = -0.001;
    }
    const orig = Math.hypot(tx, tz);
    const targetLen = s.gas + (1 - s.gas) * orig;
    const mult = orig === 0 ? 1 : targetLen / orig;
    const nx = tx * mult;
    const nz = tz * mult;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    let k = 0.975 * (0.9 + 0.1 * s.gas);
    if (speed < 2) k *= speed / 2;
    k = per(k);
    s.dx = k * s.dx + (1 - k) * nx;
    s.dz = k * s.dz + (1 - k) * nz;
    const nl = Math.hypot(s.dx, s.dz);
    const m2 = nl === 0 ? 1 : targetLen / nl;
    s.dx *= m2;
    s.dz *= m2;
  } else {
    s.dx = tx;
    s.dz = tz;
  }
  return running;
}

/** The target ground speed (m/s) for the steering vector (spaz_node.cc:3214–3248), and the gear filter. */
export function gear(s: Spaz, footing: boolean) {
  // the ball's velocity: on the ground its vertical part does not count (flat deck), in the air it does
  const vy = footing ? 0 : s.vy;
  const speed = Math.hypot(s.vx, vy, s.vz);
  const k = speed > s.speedSm ? SPEED_UP : SPEED_DOWN;
  s.speedSm = k * s.speedSm + (1 - k) * speed;
  const high = Math.min(1, s.speedSm / GEAR_UP_SPEED);
  return (WALK_SPEED + high * s.gas * RUN_SPEED_ADD) * ROLLER_R;
}

/**
 * One step of the body: drive, suspension, turn, filters. `c` comes from the rules. Moves x/z, the vertical, the
 * yaw, and keeps `grounded`. Returns the landing speed when it lands this step (else 0).
 */
export function stepSpaz(s: Spaz, c: DriveCtx, h = H): number {
  const footing = s.grounded;
  steer(s, c, footing);
  const vMax = gear(s, footing);
  const mass = M_SPAZ + c.carry;
  const coreMass = M_CORE + c.carry;

  // ---- vertical: the core on its spring over the ball, or the whole body in the air
  let landed = 0;
  let normal = 0;
  if (s.grounded && c.limp) {
    // knocked out or dead: it lies on the deck, its core bodies on the floor (hard contacts: erp ≈ 1, no bounce)
    s.vy = 0;
    s.vr = 0;
    s.pen = 0;
    s.sep = SEP_EQ;
    normal = (coreMass + M_ROLLER) * G;
  } else if (s.grounded) {
    const push = s.jumpT > 0 && !c.limp ? Math.min(1, s.jumpT / h) : 0;
    const L = SEP_REST + JUMP_PUSH * push;
    const k1 = push > 0 ? JUMP_K : SPRING_K;
    const c1 = push > 0 ? JUMP_C : SPRING_C;
    // the ball's floor contact: a soft spring that only pushes (the down ball's softer one while knocked out)
    const k2 = c.limp ? DOWN_CONTACT_K : FLOOR_CONTACT_K;
    const c2 = c.limp ? DOWN_CONTACT_C : FLOOR_CONTACT_C;
    // implicit Euler on core and ball (as ODE's erp/cfm soft joints and contacts integrate):
    //   (mc/h + a1)·vc' − a1·vr'            = mc·vc/h + k1(L − sep) − mc·g
    //   −a1·vc' + (mr/h + a1 + a2)·vr'      = mr·vr/h − k1(L − sep) + k2·pen − mr·g
    const a1 = k1 * h + c1;
    let a2 = k2 * h + c2;
    const b1 = (coreMass * s.vy) / h + k1 * (L - s.sep) - coreMass * G;
    const solve = () => {
      const m11 = coreMass / h + a1;
      const m22 = M_ROLLER / h + a1 + a2;
      const b2 = (M_ROLLER * s.vr) / h - k1 * (L - s.sep) + (a2 > 0 ? k2 * s.pen : 0) - M_ROLLER * G;
      const det = m11 * m22 - a1 * a1;
      return [(b1 * m22 + a1 * b2) / det, (m11 * b2 + a1 * b1) / det] as const;
    };
    let [vc, vr] = solve();
    let f2 = k2 * (s.pen - h * vr) - c2 * vr;
    if (f2 < 0) {
      // the floor would have to pull: it lets go of the ball
      a2 = 0;
      [vc, vr] = solve();
      f2 = 0;
    }
    s.sep += h * (vc - vr);
    s.pen -= h * vr;
    s.vy = vc;
    s.vr = vr;
    normal = f2;
    if (s.pen < 0 && vr > 0) {
      // the ball is off the floor: core and ball fly as one (momentum kept)
      s.grounded = false;
      s.y -= s.pen;
      s.pen = 0;
      s.vy = (coreMass * vc + M_ROLLER * vr) / (coreMass + M_ROLLER);
    }
  } else {
    s.vy -= G * h;
    s.y += s.vy * h;
    // the ball springs back under the torso (fast: its spring is stiff and it is light); the feet move, the core not
    const ds = (SEP_REST - s.sep) * (1 - Math.exp(-h / 0.02));
    s.sep += ds;
    s.y -= ds;
  }
  s.jumpT = Math.max(0, s.jumpT - h);

  // ---- horizontal
  if (s.grounded && !c.limp && s.wake <= 0) {
    // the ball's motor turns it toward the target speed; its torque and the ground's friction cap the push, per axis
    const mult = Math.min(1, s.balance / 100);
    const f = Math.min((MOTOR_FORCE * mult) / ROLLER_R, MU_ROLLER * normal);
    const dvMax = (f * h) / mass;
    const tvx = s.dx * vMax;
    const tvz = s.dz * vMax;
    s.vx += clamp(tvx - s.vx, -dvMax, dvMax);
    s.vz += clamp(tvz - s.vz, -dvMax, dvMax);
  } else if (s.grounded && c.limp && s.wake <= 0) {
    // knocked out or dead on the ground: it slides on its bodies and its locked ball
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0) {
      const k = Math.max(0, sp - MU_DOWN * G * h) / sp;
      s.vx *= k;
      s.vz *= k;
    }
  }
  // (in the air, and in the wake slide: no horizontal force at all)
  const sp3 = Math.hypot(s.vx, s.vy, s.vz);
  if (sp3 > MAX_SPEED) {
    const k = MAX_SPEED / sp3;
    s.vx *= k;
    s.vy *= k;
    s.vz *= k;
  }
  s.x += s.vx * h;
  s.z += s.vz * h;

  // ---- the ground under it
  const gnd = c.ground;
  if (s.grounded) {
    if (gnd === null || gnd < s.y - 0.05) {
      // walked off an edge
      s.grounded = false;
    } else s.y = gnd;
  } else if (gnd !== null && s.vy <= 0 && s.y <= gnd && s.y > gnd - 0.4) {
    landed = -s.vy;
    s.pen = gnd - s.y;
    s.y = gnd;
    s.grounded = true;
    // ball and core land moving; the floor contact and the leg spring take it from here
    s.vr = s.vy;
    s.sep = Math.min(s.sep, SEP_REST);
    if (c.limp) s.vy = s.vr = 0; // a limp body lands on its core bodies: the hard contacts stop it dead
  }

  // ---- balance, knock-out, wake slide (spaz_node.cc:2766–2803)
  if (c.limp) s.balance = 0;
  else if (footing) s.balance = Math.min(255, s.balance + (s.balance < 235 ? BAL_UP : BAL_TOP));
  else s.balance = Math.max(0, s.balance - (s.balance > 100 ? BAL_DOWN_FAST : s.balance > 10 ? BAL_DOWN_SLOW : BAL_DOWN_TAIL));
  if (s.wake > 0) s.wake -= h;

  // ---- the turn: torso, head, pelvis about the vertical (implicit springs)
  turn(s, c, h);

  // ---- filters that read the torso's motion
  const av = s.yawV;
  s.aVelSm = AVEL_SM * s.aVelSm + (1 - AVEL_SM) * av;
  s.aVelSmMore = AVEL_SM_MORE * s.aVelSmMore + (1 - AVEL_SM_MORE) * av;
  const a = Math.min(25, Math.abs(av));
  s.pmAngD = PMA_D * (s.pmAngD + PMA_G * a);
  s.pmAng = PMA_M * (s.pmAng + PMA_MG * s.pmAngD);
  if (a < 5) s.pmAng *= per(0.8 + 0.2 * (a / 5));
  const vl = Math.hypot(s.vx, s.vy, s.vz);
  s.pmLinD = PML_D * (s.pmLinD + PML_G * vl);
  s.pmLin = PML_M * (s.pmLin + PML_MG * s.pmLinD);
  if (vl < 5) s.pmLin *= per(0.9 + 0.1 * (vl / 5));
  // dizzy: spinning fast for 120 steps knocks it out for 40 ticks
  if (Math.abs(s.aVelSmMore) > 10) {
    s.dizzy += DIZZY_UP;
    if (s.dizzy > 120) {
      s.dizzy = 0;
      s.knockout = Math.max(s.knockout, 40);
    }
  } else s.dizzy = Math.max(0, s.dizzy - DIZZY_DOWN);

  // ---- the punch's direction: the stick's way, else the way it faces (spaz_node.cc:3005–3053)
  let px = Math.sin(s.yaw);
  let pz = Math.cos(s.yaw);
  if (q127(s.ix) !== 0 || q127(s.iz) !== 0) {
    px = s.dx;
    pz = s.dz;
  }
  s.pdx = (1 - PUNCH_DIR_BLEND) * px + PUNCH_DIR_BLEND * s.pdx;
  s.pdz = (1 - PUNCH_DIR_BLEND) * pz + PUNCH_DIR_BLEND * s.pdz;
  const pl = Math.hypot(s.pdx, s.pdz) || 1;
  s.pdx /= pl;
  s.pdz /= pl;
  return landed;
}

/** Torso, head and pelvis yaw: the stand spring pulls the torso to the steering direction (spaz_node.cc:2995–3090). */
function turn(s: Spaz, c: DriveCtx, h: number) {
  const moving = q127(s.ix) !== 0 || q127(s.iz) !== 0;
  // the stand body faces the steering vector while the stick is pushed; else the way the torso already faces
  const standTarget = moving ? Math.atan2(s.dx, s.dz) : s.yaw;
  let bal = s.balance / 255;
  bal = 1 - (1 - bal) ** 4;
  let k = STAND_K * bal * (c.holding ? 0.9 : 0.6);
  let d = STAND_C * bal * (c.holding ? 0.9 : 0.6);
  const m = Math.min(1, Math.hypot(s.dx, s.dz));
  d *= 0.3 + 0.7 * m;
  k *= 0.6 + 0.4 * m;
  const nk = c.limp ? NECK_KO_K : NECK_K;
  const nc = c.limp ? NECK_KO_C : NECK_C;
  // a fixed joint's angular error is 2·sin(Δ/2) (the quaternion's vector part), so a turn-around saturates
  const err = 2 * Math.sin(wrap(standTarget - s.yaw) / 2);
  // head and pelvis: ω' = A + B·ωt'
  const dh = I_HEAD / h + nk * h + nc;
  const ah = (I_HEAD / h * s.headV - nk * wrap(s.headYaw - s.yaw)) / dh;
  const bh = (nk * h + nc) / dh;
  const dp = I_PELVIS / h + PELVIS_K * h + PELVIS_C;
  const ap = (I_PELVIS / h * s.pelvisV - PELVIS_K * wrap(s.pelvisYaw - s.yaw)) / dp;
  const bp = (PELVIS_K * h + PELVIS_C) / dp;
  // torso: I/h(ω' − ω) = k(err − hω') − dω' + Σ[ki(θi − θt) + (ki·h + ci)(ωi' − ω')]
  const num = (I_TORSO / h) * s.yawV + k * err + nk * wrap(s.headYaw - s.yaw) + (nk * h + nc) * ah + PELVIS_K * wrap(s.pelvisYaw - s.yaw) + (PELVIS_K * h + PELVIS_C) * ap;
  const den = I_TORSO / h + k * h + d + (nk * h + nc) * (1 - bh) + (PELVIS_K * h + PELVIS_C) * (1 - bp);
  let wt = num / den;
  // a body lying on the ground does not keep spinning: its friction stops it
  if (c.limp && s.grounded) wt *= Math.exp(-10 * h);
  s.yawV = wt;
  s.headV = ah + bh * wt;
  s.pelvisV = ap + bp * wt;
  s.yaw = wrap(s.yaw + h * wt);
  s.headYaw = wrap(s.headYaw + h * s.headV);
  s.pelvisYaw = wrap(s.pelvisYaw + h * s.pelvisV);
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ---------------------------------------------------------------------------------------------- the punch
/** spaz_node.cc:369 kPunchDuration 35 steps; the fist's hit sphere exists after 80 ms (3308) with radius 0.25 (3313). */
export const PUNCH_STEPS = 35;
export const PUNCH_TIME = PUNCH_STEPS * SRC_H;
export const FIST_FROM = 80 / 1000;
export const FIST_R = 0.25;

/** punch_power_ for a hit `t` s after the press (spaz_node.cc:2229–2241): 0.7–1.0 up to 200 ms, then 0. */
export function punchPower(t: number) {
  const ms = Math.floor(t * 1000);
  if (ms >= 200) return 0;
  const p = 0.5 + 0.5 * Math.sin((ms / 200) * (2 * 3.1415) - 3.14159 * 0.5);
  return 0.7 + 0.3 * p;
}

/**
 * The synthetic fist (spaz_pose.cc:150–236) in the punch's frame, per 8 ms step from the press: forward of the torso's
 * centre (along the punch), up, and the swing's velocity (m/s). Spring 0.16 and damping 0.3 per step; hanging, then
 * pulled back beside the hip until 88 ms, then out to the shoulder plus 0.53 along the punch, lifted 0.09.
 */
export const FIST: { f: number; u: number; s: number; vf: number; vu: number }[] = (() => {
  const rest = { f: 0.12, u: -0.12, s: 0.2 };
  const back = { f: -0.04, u: 0.06, s: 0.32 };
  // shoulder (characterrig.py:99: 0.15 out, 0.14 up), plus 0.05 forward (spaz_pose.cc:190), then 0.53 forward,
  // 0.025 inward, 0.09 lift
  const out = { f: 0.05 + 0.53, u: 0.14 + 0.09, s: 0.15 - 0.025 };
  const p = { ...rest };
  const v = { f: 0, u: 0, s: 0 };
  const list = [];
  for (let n = 0; n <= PUNCH_STEPS; n++) {
    const ms = n * 8;
    const t = ms < 88 ? back : out;
    for (const k of ["f", "u", "s"] as const) {
      v[k] += (t[k] - p[k]) * 0.16;
      v[k] *= 1 - 0.3;
      p[k] += v[k];
    }
    list.push({ f: p.f, u: p.u, s: p.s, vf: v.f / SRC_H, vu: v.u / SRC_H });
  }
  return list;
})();
export const fistAt = (t: number) => FIST[Math.min(PUNCH_STEPS, Math.max(0, Math.floor(t / SRC_H)))]!;

// ---------------------------------------------------------------------------------------------- impulses
/**
 * A single-point hit (a punch): RigidBody::ApplyImpulse (rigid_body.cc:836–883) turns `total` into a force along the
 * direction, ×1.8, its upward part ×2 more, for one 8 ms step. On a character the force lands on its head or torso
 * and the whole body takes it. Returns the velocity change.
 */
export function pointImpulse(total: number, dx: number, dy: number, dz: number, mass: number): [number, number, number] {
  const l = Math.hypot(dx, dy, dz) || 1;
  const k = (total * 1.8 * SRC_H) / mass;
  return [(dx / l) * k, (dy / l) * k * 2, (dz / l) * k];
}

/** A character's core bodies for a blast: their height above the feet and mass (standing, or lying down). */
export const CORE_PARTS = [
  { m: M_HEAD, up: TORSO_Y + HEAD_UP, lying: 0.2, fwd: -0.45, head: true },
  { m: M_TORSO, up: TORSO_Y, lying: 0.17, fwd: 0, head: false },
  { m: M_PELVIS, up: TORSO_Y + PELVIS_UP, lying: 0.12, fwd: 0.14, head: false },
];

/**
 * An area hit (a blast) on one body: amt = 1 − d/radius, force = mag·amt·mass toward it from the blast, sideways ×0.5,
 * upward ×2 (downward left alone), one step (rigid_body.cc:886–946). Mass cancels: Δv = mag·amt·0.008 shaped so.
 * Writes the velocity change into `out` and returns mag·amt·mass (what damage is made of), or 0 out of reach.
 */
export function areaImpulse(bx: number, by: number, bz: number, mag: number, radius: number, px: number, py: number, pz: number, mass: number, out: number[]) {
  let dx = px - bx;
  let dy = py - by;
  let dz = pz - bz;
  let len = Math.hypot(dx, dy, dz);
  if (len === 0) {
    dy = 0.001;
    len = 0.001;
  }
  if (len >= radius) return 0;
  const amt = 1 - len / radius;
  const k = mag * amt * SRC_H;
  out[0] = (dx / len) * k * 0.5;
  out[1] = (dy / len) * k * (dy > 0 ? 2 : 1);
  out[2] = (dz / len) * k * 0.5;
  return mag * amt * mass;
}

// ---------------------------------------------------------------------------------------------- props
/** prop_node.cc:322–324: a bomb is a sphere of radius 0.3·scale, density 1 (rigid_body.cc:747: ×5). */
export const BOMB_R = 0.3;
export const BOMB_M = 5 * ball(BOMB_R);
/** prop_node.cc:319–321: the TNT crate is a 0.7 box, density 0.7. */
export const TNT_HALF = 0.35;
export const TNT_M = 5 * 0.7 * 0.7 * 0.7 * 0.7;
/** bomb.py:214: a bomb's material friction 0.3 → against the deck 1.2·√0.3. */
export const MU_BOMB = 1.2 * Math.sqrt(0.3);
/** prop_node.cc:571–588: angular damping torque −0.02·m·ω on every axis. */
export const PROP_SPIN_DAMP = 0.02;
/** prop_node.h:112: max_speed 20. */
export const PROP_MAX_SPEED = 20;
/**
 * A prop's bounce on the deck: the materials' bounce is 0 (dynamics.cc:1118), so only the soft contact spring gives
 * some back: stiffness 8000, damping 81 (dynamics.cc:1123–1125) on a 0.57 kg bomb, as ODE's erp/cfm integrates it at
 * 8 ms (worked out in feel.ts: about 0.05).
 */
export const PROP_BOUNCE = 0.05;

/** The hold (spaz_node.cc:7921–7975): the held body's handle sits 1.08 above the torso, 0.05 forward, on a 180 spring. */
export const HOLD_UP = 1.08;
export const HOLD_FWD = 0.05;
export const HOLD_K = 180;

/**
 * A throw's velocity change for the held body (spaz_node.cc:1610–1656, 3432–3505): power 0.8·(0.6 + 0.4·stick),
 * less within 500 ms of the pick-up; a force (50·dir, 80 up)·(power − 0.1)·1.15 (or (0, 60, 60) in the torso's frame
 * without a stick) for the steps inside 50 ms: 7 steps of 8 ms. The thrower gets −0.25 of it.
 * Returns [sideways, up] Δv for a body of `mass`, and the impulse's size [sideways, up] (N·s).
 */
export function throwImpulse(stick: number, held: number, mass: number) {
  let power = 0.8 * (0.6 + 0.4 * clamp(stick, 0, 1));
  if (held < 0.5) power *= 0.4 + 0.6 * (held / 0.5);
  let p = power < 0.1 ? -0.2 - (0.1 - power) : power - 0.1;
  p *= 1.15;
  const steps = THROW_STEPS;
  const side = stick > 0 ? 50 : 60;
  const up = stick > 0 ? 80 : 60;
  const jh = Math.abs(p * side) * steps * SRC_H;
  const jv = Math.abs(p * up) * steps * SRC_H;
  return { dvh: jh / mass, dvv: jv / mass, jh, jv };
}
/** Scene steps whose time is inside 50 ms of the throw: 0, 8, … 48 ms (scene.cc:396 adds the step after the nodes). */
export const THROW_STEPS = 7;
