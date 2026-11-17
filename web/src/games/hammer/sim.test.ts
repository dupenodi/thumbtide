import assert from "node:assert/strict";
import { test } from "node:test";
import { Body, joint, World } from "./engine.ts";
import { stickPush } from "./arenas.ts";
import { Arena, cutFactor, edgeAt, edgeOut, faceAt, GUN_HP, STEP, VIEW_H, VIEW_W } from "./sim.ts";
import { DEFAULT_TUNING, type Tuning } from "./tuning.ts";
import { facesOf, GUN_KINDS, MACHINE, WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons.ts";

const arena = () => new Arena({ ...DEFAULT_TUNING });

test("mass is polygon area × density, as in Hammerfight", () => {
  const hull = new Body(MACHINE.mesh, MACHINE.density);
  assert.ok(Math.abs(hull.mass - 24.9962 * 32.995 * 80) < 1);
});

test("Verlet keeps a body moving with no forces, and gravity bends its path", () => {
  const w = new World();
  const b = w.add(new Body([-5, -5, 5, -5, 5, 5, -5, 5], 1).place(0, 0));
  b.spinDamp = 0;
  b.setVelocity(100, 0, 0, 0.02);
  for (let i = 0; i < 50; i++) {
    w.commonForces(100);
    w.step({ dt: 0.02, dtPrev: 0.02, gravity: 100, passes: 1 });
  }
  assert.ok(Math.abs(b.x - 100) < 0.01, `x=${b.x}`);
  assert.ok(Math.abs(b.y - 50) < 2, `y=${b.y}`); // ½·g·t² = 50
});

test("a rod joint holds its length and turns the part to aim at its parent", () => {
  const w = new World();
  const a = w.add(new Body([-5, -5, 5, -5, 5, 5, -5, 5], 1).place(0, 0));
  a.gravity = false;
  const b = w.add(new Body([-5, -5, 5, -5, 5, 5, -5, 5], 1).place(80, 0, 1));
  w.joints.push(joint(a, b, 2, 60));
  for (let i = 0; i < 30; i++) {
    w.commonForces(100);
    w.step({ dt: 0.02, dtPrev: 0.02, gravity: 100, passes: 30 });
  }
  assert.ok(Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - 60) < 0.5);
  // local −x of b points at a
  const dir = Math.atan2(a.y - b.y, a.x - b.x);
  const back = b.a + Math.PI;
  assert.ok(Math.abs(Math.atan2(Math.sin(dir - back), Math.cos(dir - back))) < 0.05);
});

test("with no input the weapon's weight pulls the machine down at sqrt(weight/drag)", () => {
  for (const weapon of WEAPON_KINDS) {
    const ar = arena();
    ar.tuning.limit = 1e5;
    ar.tuning.walls = 0;
    const m = ar.add({ id: 0, name: "a", color: "#f00", weapon, x: 300, y: 100 });
    for (let i = 0; i < 600; i++) ar.step();
    const weight = m.parts.reduce((s, p) => s + p.mass, 0) * DEFAULT_TUNING.gravity;
    const terminal = Math.sqrt(weight / DEFAULT_TUNING.resist);
    assert.ok(Math.abs(m.hull.x - 300) < 3, `${weapon}: drifted sideways`);
    assert.ok(Math.abs(m.hull.vy - terminal) < terminal * 0.2, `${weapon}: vy ${m.hull.vy}, want ${terminal}`);
    assert.ok(m.striker.y > m.hull.y + 20, `${weapon}: weapon not below`);
  }
});

test("the walls keep a live hull inside the frame (top, bottom and sides)", () => {
  const ar = arena();
  const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: "orbmace", x: 300, y: 100 });
  let maxY = 0;
  // the heaviest weapon pulls it down for 12 s with no input
  for (let i = 0; i < 600; i++) {
    ar.step();
    maxY = Math.max(maxY, m.hull.y);
  }
  assert.ok(maxY <= VIEW_H - 18 + 0.01, `bottom: ${maxY}`);
  // thrown upwards hard
  m.hull.setVelocity(0, -2000, 0, 0.02);
  let minY = 1e9;
  for (let i = 0; i < 50; i++) {
    ar.step();
    minY = Math.min(minY, m.hull.y);
  }
  assert.ok(minY >= 30 - 0.01, `top: ${minY}`);
  // and thrown hard to each side
  for (const vx of [-2500, 2500]) {
    m.hull.setVelocity(vx, 0, 0, 0.02);
    let minX = 1e9;
    let maxX = -1e9;
    for (let i = 0; i < 50; i++) {
      ar.step();
      minX = Math.min(minX, m.hull.x);
      maxX = Math.max(maxX, m.hull.x);
    }
    assert.ok(minX >= 16 - 0.01 && maxX <= VIEW_W - 16 + 0.01, `sides: ${minX}…${maxX}`);
  }
});

test("hover assist 1 cancels the weapon's weight", () => {
  const ar = arena();
  ar.tuning.hover = 1;
  const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
  for (let i = 0; i < 150; i++) ar.step();
  assert.ok(Math.abs(m.hull.y - 200) < 3, `y=${m.hull.y}`);
});

test("input is an impulse: speed grows with input movement and stops at the speed clip", () => {
  const ar = arena();
  const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: "sword", x: 100, y: 270 });
  ar.pushRaw(m, 100, 0);
  ar.step();
  const v1 = m.hull.vx;
  assert.ok(v1 > 0);
  for (let i = 0; i < 50; i++) {
    ar.pushRaw(m, 400, 0);
    ar.step();
  }
  assert.ok(m.hull.vx <= DEFAULT_TUNING.speedClip * 1.1, `vx=${m.hull.vx}`);
  assert.ok(m.hull.vx > DEFAULT_TUNING.speedClip * 0.8, `vx=${m.hull.vx}`);
});

test("a hard hammer hit does damage in Hammerfight's range; a light touch does none", () => {
  const run = (speed: number) => {
    const ar = arena();
    ar.tuning.slomo = 0;
    const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
    const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 385, y: 200 });
    for (let i = 0; i < 5; i++) ar.step();
    // throw a's head round to the right, into b's hull
    const h = a.striker;
    h.setVelocity(speed, -speed * 0.2, 0, 0.02);
    let dmg = 0;
    for (let i = 0; i < 30; i++) {
      ar.step();
      for (const e of ar.events) if (e.type === "hit" && e.victim === b) dmg += e.dmg;
      ar.events.length = 0;
    }
    return dmg;
  };
  const hard = run(600);
  assert.ok(hard >= 8 && hard <= 60, `hard hit did ${hard}`);
  assert.equal(run(30), 0);
});

/** a's hammer head thrown into b's hull at `speed`; returns the arena and both machines after `frames`. */
function hammerHit(speed: number, frames: number, setup?: (ar: Arena, b: ReturnType<Arena["add"]>) => void) {
  const ar = arena();
  ar.tuning.slomo = 0;
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 385, y: 200 });
  for (let i = 0; i < 5; i++) ar.step();
  setup?.(ar, b);
  a.striker.setVelocity(speed, -speed * 0.2, 0, 0.02);
  for (let i = 0; i < frames; i++) ar.step();
  return { ar, a, b };
}

test("hit types: a weapon pressed slowly against a machine does no damage; the same weapon swung in does", () => {
  const press = () => {
    const ar = arena();
    ar.tuning.slomo = 0;
    const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
    const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 385, y: 200 });
    for (let i = 0; i < 5; i++) ar.step();
    let dmg = 0;
    // push the head at b's hull at 60 px/s for 2 s (resting, grinding contact)
    for (let i = 0; i < 100; i++) {
      const dx = b.hull.x - a.striker.x;
      const dy = b.hull.y - a.striker.y;
      const l = Math.hypot(dx, dy) || 1;
      a.striker.setVelocity((dx / l) * 60, (dy / l) * 60, 0, 0.02);
      ar.step();
      for (const e of ar.events) if (e.type === "hit" && e.victim === b) dmg += e.dmg;
      ar.events.length = 0;
    }
    return dmg;
  };
  assert.equal(press(), 0);
  const { b } = hammerHit(600, 30);
  assert.ok(b.hp < 100, "a swung hammer did no damage");
});

test("slam: a machine stunned by a hit gets more stun when it then hits the floor", () => {
  const { ar, b } = hammerHit(800, 6);
  assert.ok(b.stun > 0 && b.slamUntil > ar.t, "no stun window after a big hit");
  const before = b.stun;
  // drive it into the floor
  b.hull.place(b.hull.x, 520, 0);
  b.hull.setVelocity(0, 400, 0, 0.02);
  let slammed = false;
  for (let i = 0; i < 5; i++) {
    ar.step();
    if (ar.events.some((e) => e.type === "slam" && e.m === b)) slammed = true;
    ar.events.length = 0;
  }
  assert.ok(slammed, "no slam event");
  assert.ok(b.stun > before - 0.2, `stun ${b.stun} (was ${before})`);
  assert.ok(b.slamUntil === 0, "a slam is once per stunning hit");
});

test("gibs: a wreck bursts into shards that hurt for a moment, then pass through", () => {
  const ar = arena();
  ar.tuning.slomo = 0;
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 600, y: 200 });
  ar.wreck(a);
  const gibs = ar.world.bodies.filter((x) => (x.data as { gibUntil?: number } | null)?.gibUntil !== undefined);
  assert.equal(gibs.length, DEFAULT_TUNING.gibs);
  assert.ok(gibs.every((g) => g.solid && Math.hypot(g.vx, g.vy) > 150), "shards fly out, solid");
  // throw one shard hard at b
  const g = gibs[0]!;
  g.place(b.hull.x - 40, b.hull.y, 0);
  g.setVelocity(700, 0, 0, 0.02);
  let dmg = 0;
  for (let i = 0; i < 10; i++) {
    ar.step();
    for (const e of ar.events) if (e.type === "hit" && e.victim === b) dmg += e.dmg;
    ar.events.length = 0;
  }
  assert.ok(dmg > 0, "a flying shard did no damage");
  for (let i = 0; i < 150; i++) ar.step();
  assert.ok(gibs.every((x) => !x.solid || x.dead), "shards still solid after the harm window");
});

test("arenas: a bigger arena moves the walls; crates break under hard hits, pillars don't", () => {
  const ar = arena();
  ar.tuning.slomo = 0;
  ar.setArena(1440, 810, [
    { kind: "crate", x: 700, y: 400, hw: 22, hh: 22, hp: 30 },
    { kind: "pillar", x: 1000, y: 400, hw: 12, hh: 34 },
  ]);
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 200, y: 700 });
  // the bottom wall is now near 810, not 540
  a.hull.setVelocity(0, 300, 0, 0.02);
  for (let i = 0; i < 100; i++) ar.step();
  assert.ok(a.hull.y > 600, `hull held at ${a.hull.y}: the old bottom wall`);
  let broke = false;
  for (let k = 0; k < 12 && !broke; k++) {
    // the machine and its hammer thrown hard at the crate, again and again (head in front, on its rod)
    a.hull.place(560, 400, 0);
    a.hull.setVelocity(600, 0, 0, 0.02);
    a.striker.place(620, 400, 0);
    a.striker.setVelocity(800, 0, 0, 0.02);
    for (let i = 0; i < 10; i++) {
      ar.step();
      if (ar.events.some((e) => e.type === "break")) broke = true;
      ar.events.length = 0;
    }
  }
  assert.ok(broke, "the crate never broke");
  assert.equal(ar.obstacles.length, 1);
  assert.equal(ar.obstacles[0]!.kind, "pillar");

  // in the warm-up (damage 0) the same blows leave a crate whole
  ar.setArena(1440, 810, [{ kind: "crate", x: 700, y: 400, hw: 22, hh: 22, hp: 30 }]);
  ar.tuning.damage = 0;
  for (let k = 0; k < 12; k++) {
    a.hull.place(560, 400, 0);
    a.hull.setVelocity(600, 0, 0, 0.02);
    a.striker.place(620, 400, 0);
    a.striker.setVelocity(800, 0, 0, 0.02);
    for (let i = 0; i < 10; i++) ar.step();
  }
  assert.equal(ar.obstacles[0]!.hp, 30, "a crate took damage in the warm-up");
});

test("a big hit stuns: the victim's engine stops, then it recovers in about a second", () => {
  const { ar, b } = hammerHit(800, 6);
  assert.ok(b.stun > 0, "no stun after a big hit");
  // While stunned, input does nothing and the machine falls.
  const vy0 = b.hull.vy;
  ar.pushRaw(b, 0, -2000);
  ar.step();
  assert.ok(b.hull.vy > vy0 - 1, "a stunned machine still took thrust");
  for (let i = 0; i < 100 && b.stun > 0; i++) ar.step();
  assert.equal(b.stun, 0, "still stunned after 2 s");
});

test("health_low: a lethal hit leaves 12 health, small hits below 12 do nothing, the next lethal hit kills", () => {
  const first = hammerHit(900, 30, (_, b) => (b.hp = 20));
  assert.equal(first.b.hp, 12);
  assert.ok(first.b.alive);
  const second = hammerHit(900, 30, (_, b) => (b.hp = 12));
  assert.ok(!second.b.alive, `hp ${second.b.hp}`);
  const small = hammerHit(250, 30, (_, b) => (b.hp = 10));
  assert.equal(small.b.hp, 10);
});

test("a full-health weapon holds in a hard clash; at critical health a faster weapon knocks it off", () => {
  const clash = (hp: number) => {
    const ar = arena();
    ar.tuning.slomo = 0;
    const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
    const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 352, y: 160 }); // b's head on a's swing arc
    b.hp = hp;
    for (let i = 0; i < 5; i++) ar.step();
    a.striker.setVelocity(1500, 0, 0, 0.02);
    for (let i = 0; i < 3; i++) ar.step();
    return b.armed;
  };
  assert.ok(clash(100), "disarmed at full health (threshold 145)");
  assert.ok(!clash(12), "kept its weapon at critical health");
});

test("a disarmed machine can fly back onto its weapon and take it", () => {
  const ar = arena();
  ar.tuning.slomo = 0;
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 352, y: 160 });
  b.hp = 12;
  for (let i = 0; i < 5; i++) ar.step();
  a.striker.setVelocity(1500, 0, 0, 0.02); // head to head
  let disarmed = false;
  for (let i = 0; i < 10; i++) {
    ar.step();
    if (ar.events.some((e) => e.type === "disarm" && e.victim === b)) disarmed = true;
    ar.events.length = 0;
  }
  assert.ok(disarmed && !b.armed, "b kept its weapon");
  for (let i = 0; i < 50; i++) ar.step(); // the pickup delay
  assert.ok(!b.armed);
  // Fly b's hull onto its loose hammer.
  b.hull.place(b.striker.x, b.striker.y - 20);
  ar.step();
  assert.ok(b.armed, "b could not take its weapon back");
});

test("the soft limit brings a machine back from outside the frame", () => {
  const ar = arena();
  const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: "sword", x: VIEW_W + 250, y: 200 });
  for (let i = 0; i < 200; i++) ar.step();
  assert.ok(m.hull.x < VIEW_W + DEFAULT_TUNING.limit + 10, `x=${m.hull.x}`);
});

test("the chain mace stays close to its rest length when whipped hard", () => {
  const ar = arena();
  ar.tuning.limit = 1e5;
  const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: "chainball", x: 480, y: 270 });
  let worst = 0;
  for (let i = 0; i < 300; i++) {
    const t = i * 0.02;
    ar.pushRaw(m, Math.cos(t * 9) * 120, Math.sin(t * 9) * 120); // hard circles
    ar.step();
    for (const j of m.joints) {
      const [ax, ay] = j.a.worldPoint(j.sax, j.say);
      const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
      worst = Math.max(worst, Math.hypot(bx - ax, by - ay) - j.radius);
    }
  }
  assert.ok(worst < 3, `a chain joint stretched ${worst.toFixed(1)} px`);
});

test("teams: friendly fire off protects teammates, on hurts them; collision off lets them pass through", () => {
  const run = (o: { teamDamage: number; teamCollision: number; sameTeam: boolean }) => {
    const ar = arena();
    ar.tuning.slomo = 0;
    ar.tuning.teamDamage = o.teamDamage;
    ar.tuning.teamCollision = o.teamCollision;
    ar.tuning.hover = 1; // no sinking, so any speed comes from the hit
    const a = ar.add({ id: 0, team: 0, name: "a", color: "#f00", weapon: "hammer", x: 300, y: 200 });
    const b = ar.add({ id: 1, team: o.sameTeam ? 0 : 1, name: "b", color: "#00f", weapon: "hammer", x: 385, y: 200 });
    for (let i = 0; i < 5; i++) ar.step();
    a.striker.setVelocity(700, -140, 0, 0.02);
    let dmg = 0;
    let touched = false;
    for (let i = 0; i < 30; i++) {
      ar.step();
      for (const e of ar.events) if (e.type === "hit" && e.victim === b) dmg += e.dmg;
      ar.events.length = 0;
      if (Math.abs(b.hull.vx) > 20) touched = true;
    }
    return { dmg, stun: b.stun, touched };
  };
  const off = run({ teamDamage: 0, teamCollision: 1, sameTeam: true });
  assert.equal(off.dmg, 0, "friendly fire off still did damage");
  assert.equal(off.stun, 0, "friendly fire off still stunned");
  assert.ok(off.touched, "the teammate was not even pushed");
  assert.ok(run({ teamDamage: 1, teamCollision: 1, sameTeam: true }).dmg > 0, "friendly fire on did no damage");
  assert.ok(run({ teamDamage: 0, teamCollision: 1, sameTeam: false }).dmg > 0, "an enemy took no damage");
  assert.ok(!run({ teamDamage: 0, teamCollision: 0, sameTeam: true }).touched, "teammates collided with collision off");
});

test("monsters: a worm hunts the nearest machine, holds together, and dies when its health runs out", (t) => {
  // worm size and strength are random: seed it, so the same worms are tested each run
  let seed = 12345;
  t.mock.method(Math, "random", () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648));
  for (const kind of ["worm", "armoredworm"] as const) {
    const ar = arena();
    ar.tuning.hover = 1;
    const m = ar.add({ id: 0, team: 0, name: "a", color: "#f00", weapon: "hammer", x: 700, y: 270 });
    const w = ar.addMonster({ id: 50, team: 9, kind, x: 200, y: 270, dir: 0 });
    let closest = Infinity;
    let worst = 0;
    for (let i = 0; i < 250; i++) {
      ar.step();
      closest = Math.min(closest, Math.hypot(w.hull.x - m.hull.x, w.hull.y - m.hull.y));
      for (const j of w.joints) {
        const [ax, ay] = j.a.worldPoint(j.sax, j.say);
        const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
        worst = Math.max(worst, Math.abs(Math.hypot(bx - ax, by - ay) - j.radius));
      }
    }
    assert.ok(closest < 200, `${kind}: never got closer than ${closest.toFixed(0)} px`);
    // collisions run after the joints, so a bite can push a part a few px off for a frame; falling apart is the failure
    assert.ok(worst < 10, `${kind}: a joint was off by ${worst.toFixed(1)} px`);
    assert.ok(Number.isFinite(w.hull.x));
    // health: hit it until it drops
    w.hp = 1;
    ar.tuning.slomo = 0;
    m.striker.setVelocity(0, 0, 0, 0.02);
    let ko = false;
    for (let i = 0; i < 400 && !ko; i++) {
      // push the hammer into the worm's core
      m.striker.applyForce((w.hull.x - m.striker.x) * m.striker.mass * 40, (w.hull.y - m.striker.y) * m.striker.mass * 40);
      ar.step();
      if (ar.events.some((e) => e.type === "ko" && e.victim === w)) ko = true;
      ar.events.length = 0;
    }
    assert.ok(ko && !w.alive, `${kind}: never knocked out`);
  }
});

test("every weapon builds, hangs below its machine and keeps its joints together when whipped", () => {
  for (const weapon of WEAPON_KINDS) {
    const ar = arena();
    ar.tuning.limit = 1e5;
    const m = ar.add({ id: 0, name: "a", color: "#f00", weapon, x: 480, y: 270 });
    for (let i = 0; i < 40; i++) ar.step();
    assert.ok(m.striker.y > m.hull.y + 10, `${weapon}: weapon not below`);
    let worst = 0;
    for (let i = 0; i < 300; i++) {
      const t = i * 0.02;
      ar.pushRaw(m, Math.cos(t * 9) * 150, Math.sin(t * 9) * 150);
      ar.step();
      for (const j of m.joints) {
        const [ax, ay] = j.a.worldPoint(j.sax, j.say);
        const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
        worst = Math.max(worst, Math.hypot(bx - ax, by - ay) - j.radius);
      }
    }
    assert.ok(Number.isFinite(m.hull.x) && Number.isFinite(m.striker.x), `${weapon}: blew up`);
    // 4 px: the x1.4 thrust (2026-11-15) whips harder; the starmace reached 3.3 px (was under 3)
    assert.ok(worst < 4, `${weapon}: a joint stretched ${worst.toFixed(1)} px`);
  }
});

test("tiers: heavier weapons in a class have a heavier striking part, and the same swing hits harder", () => {
  // the part that hits (the silver mace's chain is shorter, so its total is lighter, but its head is heavier)
  const mass = (k: WeaponKind) => {
    const ar = arena();
    const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: k, x: 300, y: 200 });
    return m.striker.mass;
  };
  // each class's light → heavy trio
  const trios: WeaponKind[][] = [
    ["mallet", "hammer", "maul"],
    ["bagor", "axe", "berdish"],
    ["flail", "chainball", "silvermace"],
  ];
  for (const [a, b, c] of trios) {
    assert.ok(WEAPONS[a!].tier < WEAPONS[b!].tier && WEAPONS[b!].tier < WEAPONS[c!].tier, `${a} ${b} ${c}: tiers`);
    assert.ok(mass(a!) < mass(b!) && mass(b!) < mass(c!), `${a} ${b} ${c}: masses not in tier order`);
  }
  assert.ok(WEAPON_KINDS.every((k) => WEAPONS[k]), "every kind has data");
  // one hammer head thrown at 700 px/s into a hull
  const hit = (k: WeaponKind) => {
    const ar = arena();
    ar.tuning.slomo = 0;
    const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: k, x: 300, y: 200 });
    const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 392, y: 200 });
    for (let i = 0; i < 5; i++) ar.step();
    a.striker.setVelocity(700, -140, 0, 0.02);
    let dmg = 0;
    for (let i = 0; i < 30; i++) {
      ar.step();
      for (const e of ar.events) if (e.type === "hit" && e.victim === b) dmg += e.dmg;
      ar.events.length = 0;
    }
    return dmg;
  };
  const [mallet, hammer, maul] = [hit("mallet"), hit("hammer"), hit("maul")];
  assert.ok(mallet < hammer && hammer < maul, `mallet ${mallet}, hammer ${hammer}, maul ${maul}`);
});

test("slow motion: a very hard hit on a machine slows time, an ordinary one doesn't, and the toggle turns it off", () => {
  const hitAt = (speed: number, slomo: number) => {
    const a = arena();
    a.tuning.slomo = slomo;
    const v = a.add({ id: 1, name: "V", color: "#f00", weapon: "hammer", x: 400, y: 270 });
    const h = a.add({ id: 2, name: "H", color: "#00f", weapon: "krankhammer", x: 400, y: 120 });
    (a as unknown as { destroy(m: typeof v): void }).destroy(v);
    let slowed = false;
    for (let i = 0; i < 30 && !slowed; i++) {
      const dx = v.hull.x - h.striker.x;
      const dy = v.hull.y - h.striker.y;
      const d = Math.hypot(dx, dy) || 1;
      if (i < 3) h.striker.setVelocity((dx / d) * speed, (dy / d) * speed, 0, 0.02);
      a.step();
      if (a.timewarp < 1) slowed = true;
    }
    return slowed;
  };
  assert.equal(hitAt(1400, 1), true, "a 1400 px/s krank hammer hit");
  assert.equal(hitAt(250, 1), false, "a 250 px/s tap");
  assert.equal(hitAt(1400, 0), false, "slow motion off");
});

test("a worm hunting a machine at the top edge stays mostly in view (it steers back from the edges)", () => {
  const ar = arena();
  ar.tuning.hover = 1;
  ar.tuning.damage = 0;
  const m = ar.add({ id: 0, team: 0, name: "a", color: "#f00", weapon: "hammer", x: 200, y: 30 });
  const w = ar.addMonster({ id: 50, team: 9, kind: "worm", x: -40, y: 60, dir: 0 });
  let outside = 0;
  const N = 600;
  for (let i = 0; i < N; i++) {
    // the machine hovers up at the top, under the score cards
    m.hull.setVelocity((200 - m.hull.x) * 3, (30 - m.hull.y) * 3, 0, 0.02);
    ar.step();
    if (i > 150 && (w.hull.x < 0 || w.hull.x > VIEW_W || w.hull.y < 0)) outside++;
  }
  assert.ok(outside < (N - 150) * 0.1, `worm core outside the frame for ${outside} of ${N - 150} steps`);
});

test("a short worm (for a tight body budget) has fewer bodies, holds together and still hunts", () => {
  const ar = arena();
  ar.tuning.hover = 1;
  const m = ar.add({ id: 0, team: 0, name: "a", color: "#f00", weapon: "hammer", x: 700, y: 270 });
  const before = ar.world.bodies.length;
  const w = ar.addMonster({ id: 50, team: 9, kind: "worm", x: 200, y: 270, dir: 0, segments: 3 });
  assert.equal(ar.world.bodies.length - before, 5); // core + jaw + 3 segments
  let closest = Infinity;
  let worst = 0;
  for (let i = 0; i < 250; i++) {
    ar.step();
    closest = Math.min(closest, Math.hypot(w.hull.x - m.hull.x, w.hull.y - m.hull.y));
    for (const j of w.joints) {
      const [ax, ay] = j.a.worldPoint(j.sax, j.say);
      const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
      worst = Math.max(worst, Math.abs(Math.hypot(bx - ax, by - ay) - j.radius));
    }
  }
  assert.ok(closest < 200, `never got closer than ${closest.toFixed(0)} px`);
  assert.ok(worst < 10, `a joint was off by ${worst.toFixed(1)} px`);
});

test("plates: two per machine, the shield spreads them and halves thrust, a fast hard hit knocks one off", () => {
  const a = arena();
  a.tuning.slomo = 0;
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", plate: "woodlight", x: 400, y: 270 });
  assert.equal(m.plates.length, 2);
  for (let i = 0; i < 60; i++) a.step();
  const gap = () => Math.hypot(m.plates[0]!.body.x - m.plates[1]!.body.x, m.plates[0]!.body.y - m.plates[1]!.body.y);
  const before = gap();
  for (let i = 0; i < 30; i++) {
    a.shield(m);
    a.step();
  }
  assert.ok(gap() > before, `plates spread: ${before.toFixed(0)} -> ${gap().toFixed(0)}`);
  // half thrust while shielding
  const speed = (shield: boolean) => {
    const b = arena();
    const x = b.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", plate: "iron", x: 400, y: 270 });
    for (let i = 0; i < 5; i++) {
      if (shield) b.shield(x);
      b.pushRaw(x, 60, 0);
      b.step();
    }
    return x.hull.vx;
  };
  assert.ok(speed(true) < speed(false) * 0.7, `shield ${speed(true)} vs ${speed(false)}`);
  // a heavy, fast weapon knocks a light plate off
  const victim = m;
  const p = victim.plates[0]!.body;
  // (the iron hammer: since the krank hammer's mesh got its drawn conical caps, its head meets the hull first here)
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: p.x + 120, y: p.y });
  let off = 0;
  for (let i = 0; i < 40 && !off; i++) {
    // a hard swing: 1500 px/s straight at the plate
    const dx = p.x - foe.striker.x;
    const dy = p.y - foe.striker.y;
    const d = Math.hypot(dx, dy) || 1;
    foe.striker.setVelocity((dx / d) * 1500, (dy / d) * 1500, 0, 0.02);
    a.step();
    for (const e of a.events) if (e.type === "plateoff") off++;
    a.events.length = 0;
  }
  assert.equal(off, 1);
  assert.equal(victim.plates.length, 1);
});

test("guns: the arquebus fires every 0.1 s while held, bullets hurt, the clip reloads, shots leave the world", () => {
  const a = arena();
  const shooter = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", sidearm: "arquebus", x: 300, y: 300 });
  const target = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 300, y: 120 });
  // the target's hammer would hang in the line of fire: take it away
  (a as unknown as { destroy(m: typeof target): void }).destroy(target);
  // 40-odd bullets would bring it to health_low, where a shot is lethal: keep it alive for the body count
  target.hp = 1e6;
  const bodies = a.world.bodies.length;
  assert.equal(shooter.guns.length, 1);
  const gun = shooter.guns[0]!;
  // the gun hangs above the hull and points up, away from it
  assert.ok(gun.body.y < shooter.hull.y - 20, `gun y=${gun.body.y}`);
  assert.ok(Math.abs(gun.body.a + Math.PI / 2) < 0.2, `gun a=${gun.body.a}`);
  let shots = 0;
  const hits: number[] = [];
  const run = (n: number, fire: boolean) => {
    for (let i = 0; i < n; i++) {
      if (fire) a.fire(shooter);
      a.step();
      for (const e of a.events) {
        if (e.type === "shot") shots++;
        if (e.type === "hit" && e.victim === target && e.attacker === shooter) hits.push(e.dmg);
      }
      a.events.length = 0;
    }
  };
  run(25, true); // 0.5 s
  assert.ok(shots >= 4 && shots <= 6, `shots in 0.5 s: ${shots}`);
  assert.ok(hits.length > 0, "a bullet hit the target");
  assert.ok(Math.max(...hits) <= 15, `bullet damage ${hits.join(",")}`);
  run(400, true); // empties the clip and reloads (5 s) at least once
  assert.ok(shots > 20, `shots after the reload: ${shots}`);
  // the clip refills only once it is empty (as in the exe): empty it, then wait out the reload
  while (gun.ammo > 0) run(1, true);
  run(300, false);
  assert.equal(gun.ammo, gun.spec.clip);
  assert.equal(a.shots.length, 0);
  assert.equal(a.world.bodies.length, bodies);
});

test("guns: with the trigger held, an aim turns the gun that way and it fires only when lined up", () => {
  for (const weapon of ["hammer", "flail"] as const) {
    const a = arena();
    const m = a.add({ id: 1, name: "A", color: "#f00", weapon, sidearm: "arquebus", x: 480, y: 270 });
    const gun = m.guns[0]!;
    const off = () => Math.abs(Math.atan2(Math.sin(gun.body.a), Math.cos(gun.body.a)));
    let shots = 0;
    let offAtShot = 0;
    for (let i = 0; i < 75; i++) {
      // a phone: fire held and the stick to the right (it flies and aims); the gun starts pointing up
      a.fire(m);
      a.aim(m, 1, 0);
      stickPush(a, m, 1, 0);
      a.step();
      for (const e of a.events) {
        if (e.type !== "shot") continue;
        shots++;
        offAtShot = Math.max(offAtShot, off());
      }
      a.events.length = 0;
    }
    assert.ok(off() < 0.3, `${weapon}: gun angle after 1.5 s ${off().toFixed(2)} rad`);
    assert.ok(shots > 3, `${weapon}: shots ${shots}`);
    assert.ok(offAtShot < 0.4, `${weapon}: fired ${offAtShot.toFixed(2)} rad off the aim`);
  }
});

test("guns: the mortar fires 5 balls and kicks the machine back; the tribune's back blade shoots", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "axe", sidearm: "mortar", x: 400, y: 300 });
  for (let i = 0; i < 10; i++) a.step();
  const vy = m.hull.vy;
  a.fire(m);
  a.step();
  assert.equal(a.shots.length, 5);
  for (let i = 0; i < 3; i++) a.step();
  // fired upward, so the kick pushes the machine down
  assert.ok(m.hull.vy - vy > 20, `kick ${m.hull.vy - vy}`);
  const t = a.add({ id: 2, name: "T", color: "#0f0", weapon: "tribune", x: 600, y: 300 });
  assert.equal(t.guns.length, 1);
  assert.equal(t.guns[0]!.spec.clip, 40);
  // the launcher's rocket explodes next to an enemy: damage, a push, and a blast event
  const b2 = arena();
  const l = b2.add({ id: 1, name: "L", color: "#f00", weapon: "hammer", sidearm: "launcher", x: 300, y: 300 });
  const foe = b2.add({ id: 2, name: "F", color: "#00f", weapon: "hammer", x: 300, y: 160 });
  (b2 as unknown as { destroy(m: typeof foe): void }).destroy(foe);
  let blasts = 0;
  for (let i = 0; i < 40; i++) {
    if (i === 0) b2.fire(l);
    b2.step();
    for (const e of b2.events) if (e.type === "blast") blasts++;
    b2.events.length = 0;
  }
  assert.equal(blasts, 1);
  assert.ok(foe.hp < 100, `rocket damage: hp ${foe.hp}`);
  assert.equal(b2.shots.length, 0);
  // dual weapons take no sidearm
  const d = a.add({ id: 3, name: "D", color: "#0ff", weapon: "twin", sidearm: "arquebus", x: 200, y: 300 });
  assert.equal(d.guns.length, 0);
});

test("level arenas: seats start clear of obstacles, cages hang on their ropes, blocks stay in the frame", async () => {
  const { ARENAS, applyArenaKind, spawnPoint } = await import("./arenas.ts");
  for (const kind of Object.keys(ARENAS)) {
    const ar = arena();
    applyArenaKind(ar, kind);
    const ms = Array.from({ length: 8 }, (_, slot) => {
      const [x, y] = spawnPoint(ar, slot);
      // the turned slabs (eye, melka, blocks) were checked with designs.py; here the upright boxes
      for (const o of ar.obstacles) if (o.body.a === 0 && o.body.invMass === 0) assert.ok(!(Math.abs(x - o.body.x) < o.hw + 12 && Math.abs(y - o.body.y) < o.hh + 16), `${kind} seat ${slot} in a ${o.kind}`);
      return ar.add({ id: slot, name: `m${slot}`, color: "#f00", weapon: "hammer", x, y });
    });
    for (let i = 0; i < 300; i++) ar.step();
    for (const o of ar.obstacles) {
      const b = o.body;
      if (b.invMass === 0) continue;
      assert.ok(b.x >= 0 && b.x <= ar.w && b.y >= 0 && b.y <= ar.h, `${kind}: ${o.kind} left the frame at ${b.x | 0},${b.y | 0}`);
      if (o.rope) assert.ok(b.y > o.rope.y, `${kind}: cage above its rope`);
    }
    assert.equal(ms.filter((m) => m.alive).length, 8, `${kind}: a machine died with no fight`);
  }
});

test("saws cut a machine that flies into them (credited to its last attacker), kick it away, and rest between cuts", () => {
  const ar = arena();
  ar.setArena(960, 540, [{ kind: "saw", x: 0, y: 300, hw: 34, hh: 34 }]);
  const a = ar.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", x: 200, y: 300 });
  const b = ar.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 700, y: 300 });
  a.lastHitBy = b;
  let cuts = 0;
  let credit: unknown = null;
  for (let i = 0; i < 60; i++) {
    stickPush(ar, a, -1, 0);
    ar.step();
    for (const e of ar.events) {
      if (e.type === "hazard" && e.victim === a) cuts++;
      if (e.type === "hit" && e.victim === a) credit = e.attacker;
    }
    ar.events.length = 0;
  }
  assert.ok(cuts >= 1 && cuts <= 3, `cuts ${cuts}`);
  assert.ok(a.hp < 100, "no damage");
  assert.equal(credit, b, "the cut goes to the last attacker");
  // warm-up: no cuts
  const w = arena();
  w.tuning.damage = 0;
  w.setArena(960, 540, [{ kind: "saw", x: 0, y: 300, hw: 34, hh: 34 }]);
  const c = w.add({ id: 1, name: "C", color: "#f00", weapon: "hammer", x: 120, y: 300 });
  for (let i = 0; i < 60; i++) {
    stickPush(w, c, -1, 0);
    w.step();
  }
  assert.equal(c.hp, 100);
});

test("walls: a reeling machine slams into one; hard hits break it", () => {
  const ar = arena();
  ar.setArena(960, 540, [{ kind: "wall", x: 400, y: 300, hw: 12, hh: 70, hp: 60 }]);
  const a = ar.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", x: 330, y: 300 });
  a.stun = 1;
  a.slamUntil = ar.t + 0.8;
  a.hull.setVelocity(500, 0, 0, STEP);
  let slam = false;
  for (let i = 0; i < 20; i++) {
    ar.step();
    if (ar.events.some((e) => e.type === "slam" && e.m === a)) slam = true;
    ar.events.length = 0;
  }
  assert.ok(slam, "no slam");
  assert.ok(ar.obstacles[0]!.hp < 60 && ar.obstacles[0]!.hp > 0, `wall hp ${ar.obstacles[0]!.hp}`);
});

test("wave timer: leftovers count toward the worm cap; a lost worm flies in again whole", async () => {
  const { MAX_WORMS, relaunchLost, waveRoom, waveSeconds, waveWorms } = await import("./arenas.ts");
  assert.equal(waveRoom(4, 0, 100), waveWorms(4));
  assert.equal(waveRoom(8, MAX_WORMS - 1, 100), 1, "leftovers count");
  assert.equal(waveRoom(8, 0, 25), 2, "body budget");
  assert.ok(waveSeconds(1) < waveSeconds(4));
  const ar = arena();
  const m = ar.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", x: 200, y: 270 });
  const w = ar.addMonster({ id: 50, team: 9, kind: "worm", x: 900, y: 450, dir: 0 });
  for (let i = 0; i < 5; i++) ar.step();
  const gaps = () => w.parts.map((b, i) => Math.hypot(b.x - (i ? w.parts[i - 1]! : w.hull).x, b.y - (i ? w.parts[i - 1]! : w.hull).y));
  const before = gaps();
  assert.equal(relaunchLost(ar, [w], [m]), 1);
  assert.ok(w.hull.x < 0 || w.hull.x > ar.w, "back at a side");
  gaps().forEach((g, i) => assert.ok(Math.abs(g - before[i]!) < 0.01, "the worm kept its shape"));
  // near a machine: stays
  assert.equal(relaunchLost(ar, [w], [ar.add({ id: 2, name: "B", color: "#0f0", weapon: "hammer", x: w.hull.x + 10, y: w.hull.y })]), 0);
});

test("worms fly in only where the side is open to the fight", async () => {
  const { ARENAS, applyArenaKind, openSideRows } = await import("./arenas.ts");
  for (const kind of Object.keys(ARENAS)) {
    const ar = arena();
    applyArenaKind(ar, kind);
    const [l, r] = openSideRows(ar);
    assert.ok(l.length >= 3 && r.length >= 3, `${kind}: rows ${l.length}/${r.length}`);
  }
  // the eye's mouths: only between the slabs (y 43-64 % of the height)
  const ar = arena();
  applyArenaKind(ar, "eye");
  for (const y of openSideRows(ar)[0]) assert.ok(y > ar.h * 0.43 && y < ar.h * 0.64, `eye row at ${y}`);
});

test("edges: a one-sided axe cuts with its +y face (the edge the sprite draws) and is blunt on its back", () => {
  const axe = WEAPONS.axe.parts.find((p) => p.key === WEAPONS.axe.striker)!;
  const t = { bladeable: axe.bladeable, bladeableU: axe.bladeableU ?? axe.bladeable, sharpness: axe.sharpness, sharpnessU: axe.sharpnessU ?? axe.sharpness };
  for (const a of [0, 1.2, -2.5]) {
    const b = new Body(axe.mesh, axe.density).place(100, 50, a);
    // a contact 8 px out on the part's +y, then on its −y
    edgeAt(t, b, 100 - 8 * Math.sin(a), 50 + 8 * Math.cos(a));
    assert.deepEqual({ ...edgeOut }, { bladeable: axe.bladeable, sharpness: axe.sharpness }, `+y at a=${a}`);
    edgeAt(t, b, 100 + 8 * Math.sin(a), 50 - 8 * Math.cos(a));
    assert.deepEqual({ ...edgeOut }, { bladeable: t.bladeableU, sharpness: t.sharpnessU }, `−y at a=${a}`);
  }
});

test("guns: only a loaded sidearm aims; the tribune's back blade and a reloading gun don't slow the flying", () => {
  const fly = (weapon: "tribune" | "hammer", sidearm: "arquebus" | null, empty: boolean, fire: boolean) => {
    const a = arena();
    const m = a.add({ id: 1, name: "A", color: "#f00", weapon, sidearm, x: 300, y: 270 });
    if (empty) for (const g of m.guns) (g.ammo = 0), (g.timer = 5);
    for (let i = 0; i < 40; i++) {
      if (fire) {
        a.fire(m);
        a.aim(m, 1, 0);
      }
      stickPush(a, m, 1, 0);
      a.step();
    }
    return m.hull.x;
  };
  assert.ok(Math.abs(fly("tribune", null, false, true) - fly("tribune", null, false, false)) < 30, "tribune slowed by aiming");
  assert.ok(Math.abs(fly("hammer", "arquebus", true, true) - fly("hammer", "arquebus", true, false)) < 30, "reloading gun slowed the flying");
  assert.ok(fly("hammer", "arquebus", false, true) < fly("hammer", "arquebus", false, false) - 30, "a loaded gun's aim slows the flying");
});

type Hidden = { destroy(m: unknown): void; gunHurt(m: unknown, g: unknown, impact: number, by: unknown, x: number, y: number): void };

test("guns: mortar balls land with a push, damage and stun on a machine, then they are spent (no bounce)", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "axe", sidearm: "mortar", x: 400, y: 330 });
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 400, y: 100 });
  (a as unknown as Hidden).destroy(foe);
  for (let i = 0; i < 10; i++) a.step();
  // the foe 90 px out along the barrel
  const g = m.guns[0]!.body;
  const ux = Math.cos(g.a);
  const uy = Math.sin(g.a);
  foe.hull.place(g.x + ux * 90, g.y + uy * 90);
  let dmg = 0;
  let hits = 0;
  let pushed = 0;
  let stun = 0;
  a.fire(m);
  for (let i = 0; i < 12; i++) {
    a.step();
    pushed = Math.max(pushed, foe.hull.vx * ux + foe.hull.vy * uy);
    stun = Math.max(stun, foe.stun);
    for (const e of a.events) if (e.type === "hit" && e.victim === foe) (dmg += e.dmg), hits++;
    a.events.length = 0;
  }
  assert.ok(hits >= 2, `balls that hit: ${hits}`);
  assert.ok(dmg >= 8, `damage ${dmg}`);
  // the foe is knocked away along the barrel
  assert.ok(pushed > 100, `push ${pushed.toFixed(0)} px/s`);
  assert.ok(stun > 0.1, `a close blast stuns: ${stun.toFixed(2)}`);
  // the balls that hit are gone (they don't bounce around the foe)
  assert.ok(a.shots.length <= 5 - hits, `shots left ${a.shots.length}`);
});

test("guns: a shot on a weapon pushes it and is spent; it does no damage to the machine", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "axe", sidearm: "heavymortar", x: 400, y: 330 });
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 700, y: 100 });
  for (let i = 0; i < 10; i++) a.step();
  // the foe's hammer head in the line of fire, its hull off to the side
  const g = m.guns[0]!.body;
  const ux = Math.cos(g.a);
  const uy = Math.sin(g.a);
  const head = foe.part.get("head")!;
  const hx = g.x + ux * 100;
  const hy = g.y + uy * 100;
  foe.hull.place(hx - uy * 60, hy + ux * 60);
  head.place(hx, hy, head.a);
  let hits = 0;
  let pings = 0;
  let dv = 0;
  a.fire(m);
  for (let i = 0; i < 10; i++) {
    const v0 = head.vx * ux + head.vy * uy;
    a.step();
    dv = Math.max(dv, head.vx * ux + head.vy * uy - v0);
    for (const e of a.events) {
      if (e.type === "hit" && e.victim === foe) hits++;
      if (e.type === "ping") pings++;
    }
    a.events.length = 0;
  }
  assert.equal(pings, 1);
  assert.equal(hits, 0);
  assert.ok(dv > 100, `the head was knocked: ${dv.toFixed(0)} px/s`);
  assert.equal(a.shots.length, 0);
});

test("guns: firing kicks the shooter back along the barrel (arquebus too)", () => {
  for (const gun of ["arquebus", "mortar", "heavymortar"] as const) {
    const a = arena();
    const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", sidearm: gun, x: 400, y: 300 });
    for (let i = 0; i < 10; i++) a.step();
    const vy = m.hull.vy;
    a.fire(m);
    a.step();
    // the gun points up: the kick pushes the hull down
    assert.ok(m.hull.vy - vy > (gun === "arquebus" ? 5 : 50), `${gun}: kick ${(m.hull.vy - vy).toFixed(0)}`);
  }
});

test("guns: a sidearm's body does no contact damage, takes blows, and breaks off after a few", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", sidearm: "arquebus", x: 300, y: 300 });
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 300, y: 215 });
  (a as unknown as Hidden).destroy(foe);
  for (let i = 0; i < 5; i++) a.step();
  const g = m.guns[0]!;
  // swing the gun hard into the foe's hull
  g.body.setVelocity(0, -900, 0, 0.02);
  let hits = 0;
  for (let i = 0; i < 10; i++) {
    a.step();
    for (const e of a.events) if (e.type === "hit" && e.victim === foe) hits++;
    a.events.length = 0;
  }
  assert.equal(hits, 0, "the gun body hurt the foe");
  assert.equal(foe.hp, 100);
  // one huge blow doesn't break it, a few hard ones do: the machine keeps its hammer and loses the gun's body and joints
  const bodies = m.parts.length;
  let breaks = 0;
  const blow = (impact: number) => {
    // blows in one step: only the first counts (a grind), so each one here is a new clash
    g.hitAt = -1;
    (a as unknown as Hidden).gunHurt(m, g, impact, foe, g.body.x, g.body.y);
    for (const e of a.events) if (e.type === "gunbreak") breaks++;
    a.events.length = 0;
  };
  blow(500);
  assert.equal(breaks, 0);
  assert.equal(m.guns.length, 1);
  // a grind: many contacts in one step count once
  for (let i = 0; i < 6; i++) (a as unknown as Hidden).gunHurt(m, g, 60, foe, g.body.x, g.body.y);
  assert.equal(m.guns.length, 1);
  for (let i = 0; i < 3; i++) blow(60);
  assert.equal(breaks, 1);
  assert.equal(m.guns.length, 0);
  assert.ok(m.armed);
  assert.equal(m.sidearm, null);
  assert.equal(m.parts.length, bodies - 1);
  assert.ok(!m.joints.some((j) => j.a === g.body || j.b === g.body));
  // it falls through everything as debris
  assert.equal(g.body.solid, false);
  // the hammer still hits
  assert.ok(m.part.get("head"));
  // the next round brings it back
  a.respawn(m, 300, 300, "hammer", "arquebus");
  assert.equal(m.guns.length, 1);
  assert.equal(m.guns[0]!.hp, GUN_HP);
});

test("guns: in teams (collision on, friendly fire off) a shot flies through an ally and lands on the foe", () => {
  const a = new Arena({ ...DEFAULT_TUNING, teamCollision: 1, teamDamage: 0 });
  const m = a.add({ id: 1, team: 0, name: "A", color: "#f00", weapon: "axe", sidearm: "arquebus", x: 400, y: 400 });
  const ally = a.add({ id: 2, team: 0, name: "B", color: "#f00", weapon: "hammer", x: 700, y: 100 });
  const foe = a.add({ id: 3, team: 1, name: "C", color: "#00f", weapon: "hammer", x: 100, y: 100 });
  const hidden = a as unknown as Hidden;
  hidden.destroy(ally);
  hidden.destroy(foe);
  for (let i = 0; i < 10; i++) a.step();
  const g = m.guns[0]!.body;
  const ux = Math.cos(g.a);
  const uy = Math.sin(g.a);
  ally.hull.place(g.x + ux * 70, g.y + uy * 70);
  foe.hull.place(g.x + ux * 200, g.y + uy * 200);
  let foeHits = 0;
  let allyHits = 0;
  a.fire(m);
  for (let i = 0; i < 10; i++) {
    a.step();
    for (const e of a.events) {
      if (e.type === "hit" && e.victim === foe) foeHits++;
      if ((e.type === "hit" && e.victim === ally) || (e.type === "ping" && e.m === ally)) allyHits++;
    }
    a.events.length = 0;
  }
  assert.equal(allyHits, 0);
  assert.equal(foeHits, 1);
});

test("guns: every sidearm aims round with its weight (the mortars are heavier now) and fires near the aim", () => {
  for (const gun of GUN_KINDS) {
    const a = arena();
    const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", sidearm: gun, x: 480, y: 270 });
    const g = m.guns[0]!;
    const off = () => Math.abs(Math.atan2(Math.sin(g.body.a), Math.cos(g.body.a)));
    let shots = 0;
    let offAtShot = 0;
    for (let i = 0; i < 75; i++) {
      a.fire(m);
      a.aim(m, 1, 0);
      stickPush(a, m, 1, 0);
      a.step();
      for (const e of a.events) {
        if (e.type !== "shot") continue;
        shots++;
        offAtShot = Math.max(offAtShot, off());
      }
      a.events.length = 0;
    }
    assert.ok(shots >= 1, `${gun}: shots ${shots}`);
    assert.ok(offAtShot < 0.4, `${gun}: fired ${offAtShot.toFixed(2)} rad off the aim`);
  }
});

test("guns: at health_low a shot is the lethal hit (the exe's bullet does about 155); a blast ignores health_low", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "axe", sidearm: "arquebus", x: 400, y: 400 });
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 100, y: 100 });
  (a as unknown as Hidden).destroy(foe);
  for (let i = 0; i < 10; i++) a.step();
  const g = m.guns[0]!.body;
  foe.hull.place(g.x + Math.cos(g.a) * 120, g.y + Math.sin(g.a) * 120);
  foe.hp = MACHINE.healthLow;
  a.fire(m);
  for (let i = 0; i < 10; i++) a.step();
  assert.equal(foe.alive, false);
  // a rocket's blast at 13 health: 13 − blast damage, with no stop at 12
  const b = arena();
  const l = b.add({ id: 1, name: "L", color: "#f00", weapon: "hammer", sidearm: "launcher", x: 300, y: 300 });
  const f2 = b.add({ id: 2, name: "F", color: "#00f", weapon: "hammer", x: 300, y: 160 });
  (b as unknown as Hidden).destroy(f2);
  f2.hp = 13;
  b.fire(l);
  for (let i = 0; i < 40; i++) b.step();
  assert.ok(f2.hp < MACHINE.healthLow, `hp after the blast ${f2.hp}`);
});

test("guns: a rocket bounces off a held weapon (no blast; the exe's rocket takes no damage from it) and flies on", () => {
  const a = arena();
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "axe", sidearm: "launcher", x: 400, y: 330 });
  const foe = a.add({ id: 2, name: "B", color: "#00f", weapon: "hammer", x: 700, y: 100 });
  for (let i = 0; i < 10; i++) a.step();
  const g = m.guns[0]!.body;
  const ux = Math.cos(g.a);
  const uy = Math.sin(g.a);
  const head = foe.part.get("head")!;
  const hx = g.x + ux * 100;
  const hy = g.y + uy * 100;
  foe.hull.place(hx - uy * 60, hy + ux * 60);
  head.place(hx, hy, head.a);
  let pingAt = -1;
  let blastAt = -1;
  let after = 0;
  a.fire(m);
  for (let i = 0; i < 20; i++) {
    a.step();
    for (const e of a.events) {
      if (e.type === "ping" && e.m === foe && pingAt < 0) pingAt = i;
      if (e.type === "blast" && blastAt < 0) blastAt = i;
    }
    a.events.length = 0;
    // two steps after the bounce: still flying, and back up to speed (it may then hit the hull and go off)
    if (pingAt >= 0 && i === pingAt + 2 && a.shots.length) after = Math.hypot(a.shots[0]!.body.vx, a.shots[0]!.body.vy);
  }
  assert.ok(pingAt >= 0, "the rocket met the head");
  assert.ok(blastAt < 0 || blastAt > pingAt + 2, `it went off on the weapon (ping ${pingAt}, blast ${blastAt})`);
  assert.ok(after > 300, `speed after the bounce ${after.toFixed(0)}`);
});

// ---------------------------------------------------------------- weapon faces (WEAPON_SHAPES.md)

test("faces: the part's feature that meets the other body picks the face (spike tips, blunt block, shaft edge, chain ring)", () => {
  // the face a part shows toward a contact normal given in the part's own frame, at body angle `a`
  const at = (k: WeaponKind, key: string, nx: number, ny: number, a: number) => {
    const p = WEAPONS[k].parts.find((q) => q.key === key)!;
    const b = new Body(p.mesh, p.density).place(50, 20, a);
    const c = Math.cos(a);
    const s = Math.sin(a);
    return faceAt(facesOf(p), b, nx * c - ny * s, nx * s + ny * c).kind;
  };
  for (const a of [0, 1, Math.PI / 2, -2.5]) {
    // the klevec's spikes on both striking faces; the block's end is blunt
    assert.equal(at("klevec", "head", 0, 1, a), "spike");
    assert.equal(at("klevec", "head", 0, -1, a), "spike");
    assert.equal(at("klevec", "head", 1, 0, a), "blunt");
    assert.equal(at("pike", "head", 0, 1, a), "spike");
    assert.equal(at("pike", "head", 1, 0, a), "blunt");
    // the berdish's shaft runs along its top; its blade hangs below
    assert.equal(at("berdish", "head", 0, -1, a), "shaft");
    assert.equal(at("berdish", "head", 0, 1, a), "blade");
    // a spiked flail segment: the chain ring behind, the crescent blade in front
    assert.equal(at("spikedflail", "spike3", -1, 0, a), "shaft");
    assert.equal(at("spikedflail", "spike3", 1, 0, a), "blade");
    // one-sided: the axe's edge (+y) and its back; the gold axe's horn spike on its back
    assert.equal(at("axe", "head", 0, 1, a), "blade");
    assert.equal(at("axe", "head", 0, -1, a), "blunt");
    assert.equal(at("goldaxe", "head", 0, -1, a), "spike");
    assert.equal(at("cyclone", "head", 1, 0, a), "saw");
    assert.equal(at("hammer", "head", 0, 1, a), "blunt");
    assert.equal(at("starmace", "hand", 0, 1, a), "shaft");
  }
});

test("faces: meshes redrawn to the art keep each part's mass; every face list ends with a catch-all", () => {
  const mass = (k: WeaponKind, key: string) => {
    const p = WEAPONS[k].parts.find((q) => q.key === key)!;
    return new Body(p.mesh, p.density).mass;
  };
  // the old boxes: klevec 16 × 32 at 60, pike 9 × 45 at 70, gold axe 19 × 35 at 55, krank 17 × 34 at 64
  assert.ok(Math.abs(mass("klevec", "head") - 16 * 32 * 60) < 1);
  assert.ok(Math.abs(mass("pike", "head") - 9 * 45 * 70) < 1);
  assert.ok(Math.abs(mass("goldaxe", "head") - 19 * 35 * 55) < 1);
  assert.ok(Math.abs(mass("krankhammer", "head") - 17 * 34 * 64) < 1);
  for (const k of WEAPON_KINDS) {
    for (const p of WEAPONS[k].parts) {
      // a collider must be convex (the SAT), hold the origin (the mass fan), and fit the collision buffers (16)
      const b = new Body(p.mesh, p.density);
      assert.ok(b.count <= 16, `${k}.${p.key}: ${b.count} vertices`);
      for (let i = 0; i < b.count; i++) {
        const j = (i + 1) % b.count;
        const l = (i + 2) % b.count;
        const turn = (b.lx[j]! - b.lx[i]!) * (b.ly[l]! - b.ly[j]!) - (b.ly[j]! - b.ly[i]!) * (b.lx[l]! - b.lx[j]!);
        assert.ok(turn > 0, `${k}.${p.key}: not convex at vertex ${j}`);
        assert.ok(b.lx[i]! * b.ly[j]! - b.lx[j]! * b.ly[i]! > 0, `${k}.${p.key}: the origin is outside edge ${i}`);
      }
      const f = facesOf(p);
      const last = f[f.length - 1]!;
      assert.ok(last.x0 === undefined && last.x1 === undefined && last.y0 === undefined && last.y1 === undefined, `${k}.${p.key}: no catch-all face`);
      for (const x of f) if (x.kind === "spike") assert.ok((x.spike ?? 0) > 0, `${k}.${p.key}: a spike face with no spike value`);
    }
  }
});

/**
 * a's weapon thrown at `speed` along +x with its −y face leading, into b's hull just beside the hanging head; steps
 * until it lands (the events of that step are kept).
 */
function faceHit(weapon: WeaponKind, speed: number, tune?: (t: Tuning) => void) {
  const ar = arena();
  ar.tuning.slomo = 0;
  tune?.(ar.tuning);
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon, x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 345, y: 260 });
  a.striker.setVelocity(speed, 0, 0, 0.02);
  for (let i = 0; i < 4 && !ar.events.some((e) => e.type === "hit" && e.victim === b); i++) {
    ar.events.length = 0;
    ar.step();
  }
  return { ar, a, b };
}

test("spikes: a point-first hit pierces and hooks in; the hook holds the victim, then tears out with damage", () => {
  const { ar, a, b } = faceHit("klevec", 600);
  // the machines' own joints (the two weapons' rods)
  const joints = a.joints.length + b.joints.length;
  const hit = ar.events.find((e) => e.type === "hit" && e.victim === b);
  assert.ok(hit && hit.type === "hit");
  // a pierce: sharpness 3 × tuning.pierce (a blunt face of the klevec hits at 2)
  assert.equal(hit.dmg, Math.floor(0.1 * 3 * DEFAULT_TUNING.pierce * hit.impact));
  assert.ok(ar.events.some((e) => e.type === "hook" && e.victim === b && e.attacker === a));
  assert.equal(ar.hooked(), 1);
  assert.equal(ar.world.joints.length, joints + 2);
  ar.events.length = 0;
  // it holds: the spike passes through things and b stays on it
  let tear = null as null | Extract<(typeof ar.events)[number], { type: "tear" }>;
  let at = 0;
  for (let i = 1; i < 120 && !tear; i++) {
    if (ar.hooked()) {
      assert.equal(a.striker.solid, false);
      assert.ok(Math.hypot(a.striker.x - b.hull.x, a.striker.y - b.hull.y) < 30, "the victim came off the spike");
    }
    ar.step();
    for (const e of ar.events) {
      if (e.type === "tear") {
        tear = e;
        at = i * STEP;
      }
    }
    ar.events.length = 0;
  }
  assert.ok(tear, "it never let go");
  // the exe's life 0.005 · spike · (|v| + 1) × tuning.hold, from 0.25 s
  assert.ok(at > 0.25 && at < 1.6, `held ${at.toFixed(2)} s`);
  assert.equal(tear.pulled, false);
  assert.ok(tear.dmg > 0, "tearing out did no damage");
  assert.equal(ar.world.joints.length, joints);
  for (let i = 0; i < 10; i++) ar.step();
  assert.equal(a.striker.solid, true, "the spike stayed a ghost");
  assert.equal(ar.hooked(), 0);
});

test("spikes: a hard knock on the hooked victim tears the spike out early; hold 0 turns hooks off", () => {
  const { ar, b } = faceHit("klevec", 600);
  assert.equal(ar.hooked(), 1);
  let pulled = false;
  for (let i = 0; i < 20 && !pulled; i++) {
    if (i === 6) b.hull.setVelocity(b.hull.vx + 500, b.hull.vy, 0, STEP);
    ar.step();
    for (const e of ar.events) if (e.type === "tear") pulled = e.pulled && e.dmg > 0;
    ar.events.length = 0;
  }
  assert.ok(pulled, "the knock did not tear it out");
  const off = faceHit("klevec", 600, (t) => (t.hold = 0));
  assert.equal(off.ar.hooked(), 0);
  assert.ok(off.b.hp < 100, "no hook, but still a pierce");
});

test("spikes: a spike hit side-on (on its flank) neither pierces nor hooks in", () => {
  // hammerHit's swing: the head curls up into b's hull and meets its corner on the spike's flank
  const ar = arena();
  ar.tuning.slomo = 0;
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "klevec", x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 385, y: 200 });
  for (let i = 0; i < 5; i++) ar.step();
  a.striker.setVelocity(600, -120, 0, 0.02);
  let dmg = 0;
  for (let i = 0; i < 30; i++) {
    ar.step();
    for (const e of ar.events) {
      assert.notEqual(e.type, "hook");
      if (e.type === "hit" && e.victim === b) dmg += e.dmg;
    }
    ar.events.length = 0;
  }
  assert.ok(dmg > 0, "the knock did no damage");
});

test("shafts: a shaft edge only pushes (the berdish's top); a blunt face knocks the victim back", () => {
  const { ar, b } = faceHit("berdish", 500);
  let hits = 0;
  for (let i = 0; i < 6; i++) {
    ar.step();
    for (const e of ar.events) if (e.type === "hit" && e.victim === b) hits++;
    ar.events.length = 0;
  }
  assert.equal(hits, 0);
  assert.ok(b.hull.vx > 50, `b was not pushed: vx ${b.hull.vx.toFixed(0)}`);
  // the iron hammer's face: the same blow, with and without the knockback
  const knock = (kick: number) => {
    const h = faceHit("hammer", 600, (t) => (t.kick = kick));
    assert.ok(h.ar.events.some((e) => e.type === "hit" && e.victim === h.b), "the hammer missed");
    return h.b.hull.vx;
  };
  const plain = knock(0);
  const kicked = knock(DEFAULT_TUNING.kick);
  assert.ok(kicked > plain + 30, `knockback ${plain.toFixed(0)} -> ${kicked.toFixed(0)} px/s`);
});

test("blades: an edge cuts more the faster it slides across; head-on or with no edge it doesn't", () => {
  const b = new Body(WEAPONS.axe.parts[0]!.mesh, 65).place(0, 0, 0);
  // the contact normal (0, 1): the +y edge; sliding is motion along x
  const slide = (vx: number, vy: number, blade: number) => {
    b.vx = vx;
    b.vy = vy;
    return cutFactor(b, blade, 0, 1);
  };
  assert.ok(slide(600, 0, 1) > 2.5);
  assert.ok(slide(900, 0, 1) > slide(600, 0, 1));
  assert.equal(slide(0, 600, 1), 1);
  assert.equal(slide(600, 0, 0), 1);
  // and the axe's back face has no edge, its front has (faceAt picks them; see the faces test)
  const f = facesOf(WEAPONS.axe.parts[0]!);
  assert.equal(faceAt(f, b, 0, -1).blade, 0);
  assert.equal(faceAt(f, b, 0, 1).blade, 1);
});

test("saws: the cyclone's disc grinds a machine sliding along it, in small bites, even too slowly for a blow", () => {
  const ar = arena();
  ar.tuning.slomo = 0;
  const a = ar.add({ id: 0, name: "a", color: "#f00", weapon: "cyclone", x: 300, y: 200 });
  const b = ar.add({ id: 1, name: "b", color: "#00f", weapon: "hammer", x: 328, y: 175 });
  const disc = a.part.get("head")!;
  const dx = disc.x;
  const dy = disc.y;
  const bites: number[] = [];
  for (let i = 0; i < 50; i++) {
    // b slides down past the disc, pressing in a little (40 px/s: under bluntMinV); the disc is held in place
    b.hull.setVelocity(-40, 100, 0, STEP);
    a.hull.setVelocity(0, 0, 0, STEP);
    ar.step();
    disc.x = disc.px = dx;
    disc.y = disc.py = dy;
    for (const e of ar.events) if (e.type === "hit" && e.victim === b) bites.push(e.dmg);
    ar.events.length = 0;
  }
  assert.ok(bites.length >= 3, `bites ${bites.join(",")}`);
  assert.ok(bites.every((d) => d === DEFAULT_TUNING.sawDmg), `bites ${bites.join(",")}`);
});
