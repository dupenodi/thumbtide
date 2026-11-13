import assert from "node:assert/strict";
import { test } from "node:test";
import { Body, joint, World } from "./engine.ts";
import { Arena, VIEW_W } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { MACHINE, WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons.ts";

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
    const m = ar.add({ id: 0, name: "a", color: "#f00", weapon, x: 300, y: 100 });
    for (let i = 0; i < 600; i++) ar.step();
    const weight = m.parts.reduce((s, p) => s + p.mass, 0) * DEFAULT_TUNING.gravity;
    const terminal = Math.sqrt(weight / DEFAULT_TUNING.resist);
    assert.ok(Math.abs(m.hull.x - 300) < 3, `${weapon}: drifted sideways`);
    assert.ok(Math.abs(m.hull.vy - terminal) < terminal * 0.2, `${weapon}: vy ${m.hull.vy}, want ${terminal}`);
    assert.ok(m.striker.y > m.hull.y + 20, `${weapon}: weapon not below`);
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
    assert.ok(worst < 3, `${weapon}: a joint stretched ${worst.toFixed(1)} px`);
  }
});

test("tiers: heavier weapons in a class have a heavier striking part, and the same swing hits harder", () => {
  // the part that hits (the silver mace's chain is shorter, so its total is lighter, but its head is heavier)
  const mass = (k: WeaponKind) => {
    const ar = arena();
    const m = ar.add({ id: 0, name: "a", color: "#f00", weapon: k, x: 300, y: 200 });
    return m.striker.mass;
  };
  for (const cls of ["hammer", "axe", "mace", "sword"] as const) {
    const ks = WEAPON_KINDS.filter((k) => WEAPONS[k].cls === cls).sort((a, b) => WEAPONS[a].tier - WEAPONS[b].tier);
    assert.equal(ks.length, 3, cls);
    if (cls !== "sword") assert.ok(mass(ks[0]!) < mass(ks[1]!) && mass(ks[1]!) < mass(ks[2]!), `${cls} masses not in tier order`);
  }
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
