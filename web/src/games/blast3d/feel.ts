// The feel test (not part of the game; nothing imports it). Run in web/:  node --import tsx src/games/blast3d/feel.ts
//
// Two columns per measure:
//  - "source": Ballistica's own numbers and per-step formulas, stepped at its 8 ms (125 Hz) with the raw per-step
//    factors (written out again below, independently of engine.ts). It is a reduced model of the engine (the core on
//    its ball spring, the ball's motor and friction, the stand spring), NOT ODE: contact softness, the limbs' rig and
//    the solver's iterations are left out. Where a measure is a formula (punch, throw, blast), it is that formula.
//  - "ours": the game (rules.ts + engine.ts) stepped as the TV steps it (60 Hz, two 1/120 s physics steps).
import * as E from "./engine.ts";
import { ARENA, BOMB_R, Game, HP, RUN, STEP, WALK, seeded, type Fighter } from "./rules.ts";

const h = 0.008;
const G = 20;

// ------------------------------------------------------------------------------------------------ the 125 Hz model
interface S {
  x: number; y: number; vx: number; vy: number; sep: number; grounded: boolean; yaw: number; yawV: number; headYaw: number; headV: number;
  pelvisYaw: number; pelvisV: number; ix: number; iz: number; run: number; dx: number; dz: number; gas: number; speedSm: number; balance: number;
  z: number; vz: number; jump: number; pen: number; vr: number;
}
const s0 = (): S => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, sep: 0.2 - (E.M_CORE * G) / 1500, grounded: true, yaw: 0, yawV: 0, headYaw: 0, headV: 0, pelvisYaw: 0, pelvisV: 0, ix: 0, iz: 0, run: 0, dx: 0, dz: 0, gas: 0, speedSm: 0, balance: 255, jump: 0, pen: E.PEN_EQ, vr: 0 });
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** One 8 ms step with the engine's raw numbers (spaz_node.cc Step, spaz_physics_tuning.h bg limbs). */
function srcStep(s: S) {
  const footing = s.grounded;
  // stick → run gas → steering (spaz_node.cc:2069–2172)
  let tx = s.ix, tz = s.iz;
  const l = Math.hypot(tx, tz);
  if (l > 1) { tx /= l; tz /= l; }
  const running = s.run > 0 && (tx !== 0 || tz !== 0);
  if (running) {
    let target = Math.sqrt(s.run);
    if (l * l < 0.3) target *= (l * l) / 0.3;
    const k = target > s.gas ? 0.95 : 0.5;
    s.gas = k * s.gas + (1 - k) * target;
  } else s.gas = Math.max(0, s.gas - 0.02);
  if (!footing) s.gas = Math.max(0, s.gas - 0.05);
  if (s.run > 0.05) {
    const dot = tx * s.dx + tz * s.dz;
    if (dot < 0) { tx -= s.gas * s.dx * dot; tz -= s.gas * s.dz * dot; if (tx === 0) tx = -0.001; if (tz === 0) tz = -0.001; }
    const orig = Math.hypot(tx, tz);
    const tl = s.gas + (1 - s.gas) * orig;
    const m = orig === 0 ? 1 : tl / orig;
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    let k = 0.975 * (0.9 + 0.1 * s.gas);
    if (speed < 2) k *= speed / 2;
    s.dx = k * s.dx + (1 - k) * tx * m;
    s.dz = k * s.dz + (1 - k) * tz * m;
    const nl = Math.hypot(s.dx, s.dz);
    const m2 = nl === 0 ? 1 : tl / nl;
    s.dx *= m2; s.dz *= m2;
  } else { s.dx = tx; s.dz = tz; }
  // gear (3214–3248)
  const sp = Math.hypot(s.vx, footing ? 0 : s.vy, s.vz);
  const ks = sp > s.speedSm ? 0.985 : 0.94;
  s.speedSm = ks * s.speedSm + (1 - ks) * sp;
  const vMax = (7.68 + Math.min(1, s.speedSm / 7) * s.gas * 15) * 0.3;
  // vertical: the core on the ball's spring (implicit, as ODE's erp/cfm), the jump's 7 steps
  let normal = 0;
  if (s.grounded) {
    const push = s.jump > 0;
    const L = 0.2 + (push ? 0.3 : 0), k1 = push ? 600 : 1500, c1 = push ? 1.2 : 6, k2 = 7000, c2 = 10;
    const mc = E.M_CORE, mr = E.M_ROLLER, a1 = k1 * h + c1;
    const sol = (a2: number) => {
      const m11 = mc / h + a1, m22 = mr / h + a1 + a2;
      const b1 = (mc * s.vy) / h + k1 * (L - s.sep) - mc * G, b2 = (mr * s.vr) / h - k1 * (L - s.sep) + (a2 ? k2 * s.pen : 0) - mr * G;
      const det = m11 * m22 - a1 * a1;
      return [(b1 * m22 + a1 * b2) / det, (m11 * b2 + a1 * b1) / det];
    };
    let [vc, vr] = sol(k2 * h + c2);
    let f2 = k2 * (s.pen - h * vr!) - c2 * vr!;
    if (f2 < 0) { [vc, vr] = sol(0); f2 = 0; }
    s.sep += h * (vc! - vr!); s.pen -= h * vr!; s.vy = vc!; s.vr = vr!; normal = f2;
    if (s.pen < 0 && vr! > 0) { s.grounded = false; s.y -= s.pen; s.pen = 0; s.vy = (mc * vc! + mr * vr!) / (mc + mr); }
  } else {
    s.vy -= G * h; s.y += s.vy * h;
    const ds = (0.2 - s.sep) * (1 - Math.exp(-h / 0.02)); s.sep += ds; s.y -= ds;
    if (s.y <= 0 && s.vy <= 0) { s.pen = -s.y; s.y = 0; s.grounded = true; s.vr = s.vy; s.sep = Math.min(s.sep, 0.2); }
  }
  if (s.jump > 0) s.jump--;
  // the ball's motor and friction, per axis
  if (s.grounded) {
    const f = Math.min((15 * Math.min(1, s.balance / 100)) / 0.3, 1.2 * normal);
    const dv = (f * h) / E.M_SPAZ;
    s.vx += Math.max(-dv, Math.min(dv, s.dx * vMax - s.vx));
    s.vz += Math.max(-dv, Math.min(dv, s.dz * vMax - s.vz));
  }
  s.x += s.vx * h; s.z += s.vz * h;
  if (footing) s.balance = Math.min(255, s.balance + (s.balance < 235 ? 20 : 1));
  else s.balance = Math.max(0, s.balance - (s.balance > 100 ? 20 : s.balance > 10 ? 5 : 1));
  // the turn: stand spring 270/3.5 × balance × 0.6, neck 13/0.8, pelvis 1.5/0.06 (implicit)
  const moving = s.ix !== 0 || s.iz !== 0;
  const target = moving ? Math.atan2(s.dx, s.dz) : s.yaw;
  let bal = s.balance / 255; bal = 1 - (1 - bal) ** 4;
  const m = Math.min(1, Math.hypot(s.dx, s.dz));
  const K = 270 * bal * 0.6 * (0.6 + 0.4 * m), C = 3.5 * bal * 0.6 * (0.3 + 0.7 * m);
  const It = 0.4 * E.M_TORSO * 0.04, Ih = 0.4 * E.M_HEAD * 0.0784, Ip = (E.M_PELVIS * (0.0625 + 0.0256)) / 12;
  const dh = Ih / h + 13 * h + 0.8, ah = (Ih / h * s.headV - 13 * wrap(s.headYaw - s.yaw)) / dh, bh = (13 * h + 0.8) / dh;
  const dp = Ip / h + 1.5 * h + 0.06, ap = (Ip / h * s.pelvisV - 1.5 * wrap(s.pelvisYaw - s.yaw)) / dp, bp = (1.5 * h + 0.06) / dp;
  const err = 2 * Math.sin(wrap(target - s.yaw) / 2);
  const num = (It / h) * s.yawV + K * err + 13 * wrap(s.headYaw - s.yaw) + (13 * h + 0.8) * ah + 1.5 * wrap(s.pelvisYaw - s.yaw) + (1.5 * h + 0.06) * ap;
  const den = It / h + K * h + C + (13 * h + 0.8) * (1 - bh) + (1.5 * h + 0.06) * (1 - bp);
  s.yawV = num / den; s.headV = ah + bh * s.yawV; s.pelvisV = ap + bp * s.yawV;
  s.yaw = wrap(s.yaw + h * s.yawV); s.headYaw = wrap(s.headYaw + h * s.headV); s.pelvisYaw = wrap(s.pelvisYaw + h * s.pelvisV);
}

// ------------------------------------------------------------------------------------------------ our game
ARENA.hx = 200;
ARENA.hz = 200;
ARENA.blocks.length = 0;
function game(n = 2) {
  const g = new Game({ powerups: false, endless: true }, seeded(3));
  for (let i = 0; i < n; i++) g.addSeat("p" + i, "P" + i);
  g.startMatch();
  for (let i = 0; i < 400; i++) g.step();
  g.bombs = [];
  for (const f of g.seats.values()) place(f, 0, 0, 0);
  return g;
}
function place(f: Fighter, x: number, z: number, yaw: number) {
  E.stand(f, x, 0, z, yaw);
  f.invincible = 0;
  f.hp = HP;
}
const sp = (f: { vx: number; vz: number }) => Math.hypot(f.vx, f.vz);
const fmt = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const rows: [string, string, string][] = [];
const row = (name: string, src: number | string, ours: number | string, d = 2) => rows.push([name, typeof src === "number" ? fmt(src, d) : src, typeof ours === "number" ? fmt(ours, d) : ours]);

// ---- run and walk
{
  const a = s0(); a.iz = 1;
  for (let i = 0; i < 1000; i++) srcStep(a);
  const b = s0(); b.iz = 1; b.run = 1;
  let t90 = 0;
  const top = RUN;
  for (let i = 0; i < 2000; i++) { srcStep(b); if (!t90 && Math.hypot(b.vx, b.vz) >= 0.9 * top) t90 = (i + 1) * h; }
  const g = game();
  const f = g.seats.get("p0")!;
  g.setInput("p0", 0, 1);
  for (let i = 0; i < 600; i++) g.step();
  const walk = sp(f);
  place(f, 0, -150, 0);
  g.setInput("p0", 0, 1);
  g.setRun("p0", 1);
  let o90 = 0;
  for (let i = 0; i < 1200; i++) { g.step(); if (!o90 && sp(f) >= 0.9 * top) o90 = (i + 1) * STEP; }
  row("walk top speed (m/s)", Math.hypot(a.vx, a.vz), walk);
  row("run top speed (m/s)", Math.hypot(b.vx, b.vz), sp(f));
  row("time to 90% of run speed (s)", t90, o90);
  // acceleration to walk speed
  const c = s0(); c.iz = 1; let tw = 0;
  for (let i = 0; i < 200 && !tw; i++) { srcStep(c); if (Math.hypot(c.vx, c.vz) >= 0.9 * WALK) tw = (i + 1) * h; }
  place(f, 0, 0, 0); g.setRun("p0", 0); g.setInput("p0", 0, 1); let ow = 0;
  for (let i = 0; i < 200 && !ow; i++) { g.step(); if (sp(f) >= 0.9 * WALK) ow = (i + 1) * STEP; }
  row("time to 90% of walk speed (s)", tw, ow, 3);
}

// ---- turning
{
  const a = s0(); a.iz = 1;
  for (let i = 0; i < 100; i++) srcStep(a);
  a.iz = -1; let t = 0;
  for (let i = 0; i < 300 && !t; i++) { srcStep(a); if (Math.abs(wrap(Math.PI - a.yaw)) < 0.17) t = (i + 1) * h; }
  const g = game();
  const f = g.seats.get("p0")!;
  g.setInput("p0", 0, 1);
  for (let i = 0; i < 50; i++) g.step();
  g.setInput("p0", 0, -1); let o = 0;
  for (let i = 0; i < 200 && !o; i++) { g.step(); if (Math.abs(wrap(Math.PI - f.yaw)) < 0.17) o = (i + 1) * STEP; }
  row("walk: turn 180° (s, facing within 10°)", t, o, 3);
  // running: hard reverse of the stick at top speed; time until it moves the other way
  const b = s0(); b.iz = 1; b.run = 1;
  for (let i = 0; i < 1500; i++) srcStep(b);
  b.iz = -0.999; let rt = 0, r90 = 0;
  for (let i = 0; i < 1000 && !rt; i++) { srcStep(b); if (!r90 && Math.abs(Math.atan2(b.vx, b.vz)) > Math.PI / 2) r90 = (i + 1) * h; if (b.vz < -2) rt = (i + 1) * h; }
  place(f, 0, -150, 0); g.setInput("p0", 0, 1); g.setRun("p0", 1);
  for (let i = 0; i < 720; i++) g.step();
  g.setInput("p0", 0, -0.999); let ot = 0, o90 = 0; // (analog: an exact 0/±1 stick is smoothed as a d-pad)
  for (let i = 0; i < 600 && !ot; i++) { g.step(); if (!o90 && Math.abs(Math.atan2(f.vx, f.vz)) > Math.PI / 2) o90 = (i + 1) * STEP; if (f.vz < -2) ot = (i + 1) * STEP; }
  row("run: stick reversed, heading past 90° (s)", r90, o90);
  row("run: stick reversed, going back at 2 m/s (s)", rt, ot);
}

// ---- jump
{
  const a = s0();
  for (let i = 0; i < 100; i++) srcStep(a);
  a.jump = 7; let top = 0, t = 0, off = -1, land = 0;
  for (let i = 0; i < 300 && !land; i++) { srcStep(a); t = (i + 1) * h; if (!a.grounded && off < 0) off = t; if (off >= 0 && a.grounded) land = t; top = Math.max(top, a.y); }
  // the bounce after it lands: the leg spring rebounds the body into a little hop
  let hop = 0;
  for (let i = 0; i < 100; i++) { srcStep(a); hop = Math.max(hop, a.y); }
  const g = game();
  const f = g.seats.get("p0")!;
  for (let i = 0; i < 30; i++) g.step();
  g.jump("p0");
  let otop = 0, ooff = -1, oland = 0;
  for (let i = 0; i < 200 && !oland; i++) { g.step(); const tt = (i + 1) * STEP; if (!f.grounded && ooff < 0) ooff = tt; if (ooff >= 0 && f.grounded) oland = tt; otop = Math.max(otop, f.y); }
  let ohop = 0;
  for (let i = 0; i < 50; i++) { g.step(); ohop = Math.max(ohop, f.y); }
  row("jump: feet apex (m)", top, otop);
  row("jump: airtime (s)", land - off, oland - ooff);
  row("jump: rebound hop after landing (m)", hop, ohop);
  // carrying a bomb
  const c = s0();
  for (let i = 0; i < 100; i++) srcStep(c);
}

// ---- punch on a still target
function punchTest(running: boolean) {
  const g = game();
  const a = g.seats.get("p0")!;
  const b = g.seats.get("p1")!;
  place(a, 0, running ? -60 : 0, 0);
  place(b, 0, running ? 0 : 0.85, Math.PI);
  if (running) { g.setInput("p0", 0, 1); g.setRun("p0", 1); }
  let hitAt = -1, dmg = 0;
  for (let i = 0; i < 1500; i++) {
    if (running && hitAt < 0 && b.z - a.z < 1.05 && a.punchT < 0 && a.punchCd <= 0) g.punch("p0");
    if (!running && i === 5) g.punch("p0");
    g.step();
    for (const e of g.drainEvents()) if (e.type === "hit" && e.id === "p1" && hitAt < 0) { hitAt = b.z; dmg = e.damage; g.setInput("p0", 0, 0); g.setRun("p0", 0); }
    if (hitAt >= 0 && sp(b) < 0.01 && b.grounded) break;
  }
  return { dmg, dist: b.z - (running ? hitAt : 0.85), ko: b.knockout };
}
{
  // source: the punch formula with the filters' steady states, power 1 (the hit lands about 100–130 ms in)
  const totalStill = Game.punchTotal(0, 0, 1, false);
  const pmLin = (0.96 * 0.076 * RUN) / (1 - 0.96);
  const totalRun = Game.punchTotal(pmLin, 0, 0.95, false);
  // the fist's way when it lands (about 13 steps in): the runner's speed plus the swing, forward and up
  const fs = E.FIST[13]!;
  const [, vy, vz] = E.pointImpulse(totalRun, 0, fs.vu, RUN + fs.vf, E.M_SPAZ);
  const slide = vz * ((2 * vy) / G) + (vz * vz) / (2 * E.MU_DOWN * G);
  const st = punchTest(false);
  const rn = punchTest(true);
  row("punch, standing: damage (hp)", 0.22 * 5 * totalStill, st.dmg, 0);
  row("punch, standing: target pushed (m)", 0, st.dist);
  row("punch, at run speed: damage (hp)", 0.22 * 5 * totalRun, rn.dmg, 0);
  row("punch, at run speed: target flies and slides (m)", slide, rn.dist);
}

// ---- throws
function throwTest(what: "bomb" | "man", running: boolean) {
  const g = game();
  const a = g.seats.get("p0")!;
  const b = g.seats.get("p1")!;
  place(a, 0, running ? -100 : 0, 0);
  place(b, 30, 30, 0);
  if (running) { g.setInput("p0", 0, 1); g.setRun("p0", 1); for (let i = 0; i < 400; i++) g.step(); }
  else g.setInput("p0", 0, 0.001);
  let obj: { x: number; y: number; z: number; vx: number; vz: number };
  if (what === "bomb") {
    g.bomb("p0");
    obj = g.bombs.find((x) => x.heldBy === "p0")!;
  } else {
    place(b, a.x, a.z + 0.6, Math.PI);
    b.knockout = 26;
    g.grab("p0");
    for (let i = 0; i < 6; i++) g.step();
    obj = b;
  }
  // hold it for 0.6 s (a full-power throw), then throw with the stick full ahead
  for (let i = 0; i < 36; i++) { if (what === "man") b.knockout = 26; g.step(); }
  g.setInput("p0", 0, 1);
  const x0 = a.z;
  if (what === "bomb") g.bomb("p0"); else g.grab("p0");
  g.setInput("p0", 0, 0);
  g.setRun("p0", 0);
  let land = NaN;
  let air = false;
  for (let i = 0; i < 300; i++) {
    g.step();
    if (obj.y > (what === "bomb" ? BOMB_R + 0.05 : 0.05)) air = true;
    if (air && Number.isNaN(land) && obj.y <= (what === "bomb" ? BOMB_R + 0.001 : 0.001)) land = obj.z - x0;
    if (what === "man" && !Number.isNaN(land)) break;
  }
  return { land, rest: obj.z - x0 };
}
function srcThrow(mass: number, carrierV: number, startY: number) {
  // the held body: 1.08 over the torso (0.48 over the feet), sagging m·g/180; the throw's Δv; then a ballistic flight
  const t = E.throwImpulse(1, 1, mass);
  const y0 = startY;
  const vy = t.dvv;
  const tf = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
  return { dist: (t.dvh + carrierV) * tf, t: tf, vh: t.dvh + carrierV };
}
{
  const by = E.TORSO_Y + E.HOLD_UP - (E.BOMB_M * G) / E.HOLD_K - BOMB_R; // the bomb's bottom
  const my = E.TORSO_Y + E.HOLD_UP - (E.M_SPAZ * G) / E.HOLD_K - E.TORSO_Y; // the carried one's feet
  const s1 = srcThrow(E.BOMB_M, 0, by);
  const s2 = srcThrow(E.BOMB_M, WALK, by);
  const s3 = srcThrow(E.M_SPAZ, 0, my);
  const s4 = srcThrow(E.M_SPAZ, WALK, my);
  const o1 = throwTest("bomb", false);
  const o2 = throwTest("bomb", true);
  const o3 = throwTest("man", false);
  const o4 = throwTest("man", true);
  row("throw bomb, standing: lands at (m)", s1.dist, o1.land);
  row("throw bomb, moving (carrier at walk speed): lands at (m)", s2.dist, o2.land);
  row("throw stunned fighter, standing: lands at (m)", s3.dist, o3.land);
  row("throw stunned fighter, moving: lands at (m)", s4.dist, o4.land);
  // the bomb rolls on after it lands: rolling model at 8 ms (friction 1.2·√0.3 turns slide into roll; spin damping 0.02)
  const roll = (vh: number, spin: number, time: number) => {
    let v = vh, w = -spin; // w: spin about the roll axis, + = rolling forward
    const R = BOMB_R, m = E.BOMB_M, I = 0.4 * m * R * R;
    let x = 0;
    for (let t = 0; t < time; t += h) {
      w *= Math.exp((-0.02 * m * h) / I);
      const cv = v - w * R;
      const j = Math.min(Math.abs(cv) * m / 3.5, 0.657 * m * G * h) * Math.sign(cv);
      v -= j / m; w += (R * j) / I;
      x += v * h;
    }
    return x;
  };
  const t1 = E.throwImpulse(1, 1, E.BOMB_M);
  const spin = (0.1 * t1.jh) / (0.4 * E.BOMB_M * BOMB_R * BOMB_R) * Math.exp((-0.02 / (0.4 * BOMB_R * BOMB_R)) * s1.t);
  const fuseLeft = 3 - 0.6 - s1.t;
  row("bomb rolls on after landing, standing throw (m, until it goes off)", roll(s1.vh, spin, fuseLeft), o1.rest - o1.land);
}

// ---- blasts: a fighter standing d m from a bomb lying on the deck
{
  for (const d of [0.5, 1, 1.5, 2]) {
    // source: the formula on the three bodies, as the engine places them (rigid_body.cc ApplyImpulse with radius)
    const r = Game.blastOn(d);
    const g = game();
    const f = g.seats.get("p0")!;
    place(f, d, 0, 0);
    place(g.seats.get("p1")!, 50, 50, 0);
    g.explode(0, BOMB_R - 0.1, 0, 2, "normal", null);
    const ev = g.drainEvents().find((e) => e.type === "hit");
    row(`blast at ${d} m: launch (sideways / up, m/s), damage`, `${fmt(r.dvx)} / ${fmt(r.dvy)}, ${r.damage}`, `${fmt(f.vx)} / ${fmt(f.vy)}, ${ev && ev.type === "hit" ? ev.damage : 0}`);
  }
}

// ---- the table
const w0 = Math.max(...rows.map((r) => r[0].length));
console.log(`| measure${" ".repeat(w0 - 7)} | source (125 Hz model) | ours (60 Hz game) |`);
console.log(`|${"-".repeat(w0 + 2)}|---|---|`);
for (const [a, b, c] of rows) console.log(`| ${a}${" ".repeat(w0 - a.length)} | ${b} | ${c} |`);
