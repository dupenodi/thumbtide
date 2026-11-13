import { test } from "node:test";
import assert from "node:assert/strict";
import { Sim } from "./sim.ts";
import { GRID_H, GRID_W, POWERS, ROUND_SECONDS, TUNING } from "./shared.ts";

const DT = 1 / 60;
const run = (sim: Sim, seconds: number) => {
  for (let t = 0; t < seconds; t += DT) sim.step(DT);
};
/** A sim with n brushes, past the intro. Power-ups and events off unless asked for, so tests are predictable. */
const started = (n = 2, o: { powerups?: boolean; events?: boolean; roundLength?: number } = {}) => {
  const sim = new Sim({ seed: 42, powerups: false, events: false, ...o });
  for (let i = 0; i < n; i++) sim.addBrush(`p${i}`, `P${i}`);
  while (sim.phase === "intro") sim.step(DT);
  return sim;
};
const total = (sim: Sim) => sim.counts.reduce((a, b) => a + b, 0);
const place = (sim: Sim, id: string, x: number, z: number) => {
  const b = sim.brushes.get(id)!;
  b.x = b.lastX = x;
  b.z = b.lastZ = z;
  return b;
};

test("brushes get distinct colours and a home patch", () => {
  const sim = new Sim({ seed: 1 });
  const a = sim.addBrush("a", "A")!;
  const b = sim.addBrush("b", "B")!;
  assert.notEqual(a.slot, b.slot);
  assert.ok(sim.counts[a.slot + 1]! > 40);
  assert.equal(total(sim), GRID_W * GRID_H);
});

test("the first round's intro is longer than later ones", () => {
  const sim = new Sim({ seed: 1 });
  const first = sim.phaseLeft;
  sim.nextRound();
  assert.ok(first > sim.phaseLeft);
});

test("brushes can drive during the count-in, but paint only lands from GO", () => {
  const sim = new Sim({ seed: 1 });
  const a = sim.addBrush("a", "A")!;
  const x = a.x;
  run(sim, 0.6); // let the home patch land
  const home = sim.counts[a.slot + 1]!;
  sim.setInput("a", 1, 0);
  run(sim, 2);
  assert.equal(sim.phase, "intro");
  assert.ok(a.x > x + 10, "should have moved");
  assert.equal(sim.counts[a.slot + 1], home, "no paint before GO");
  assert.ok(sim.dash("a"), "dash works in the warm-up");

  while (sim.phase === "intro") sim.step(DT);
  assert.equal(a.load, 1);
  assert.equal(a.dashCd, 0, "everyone starts level");
  const startX = a.x;
  sim.setInput("a", -1, 0);
  run(sim, 0.3);
  assert.ok(sim.counts[a.slot + 1]! > home, "paints once it's GO");
  // the first stroke starts where the brush was at GO, not back at the spawn
  const spawnCell = sim.ownerAt(x + 6, a.z);
  assert.ok(startX > x + 6 && spawnCell !== a.slot + 1);
});

test("no rams during the count-in", () => {
  const sim = new Sim({ seed: 1 });
  const a = sim.addBrush("a", "A")!;
  const b = sim.addBrush("b", "B")!;
  b.x = a.x + 3;
  b.z = a.z;
  a.angle = 0;
  sim.dash("a");
  run(sim, 0.5);
  assert.equal(b.stunT, 0);
  assert.equal(b.load, 1);
});

test("moving paints canvas and spends paint; counts stay consistent", () => {
  const sim = started(1);
  const b = sim.brushes.get("p0")!;
  const before = sim.counts[b.slot + 1]!;
  sim.setInput("p0", 1, 0);
  run(sim, 1);
  assert.ok(sim.counts[b.slot + 1]! > before + 60, "should have painted new cells");
  assert.ok(b.load < 1);
  assert.equal(total(sim), GRID_W * GRID_H);
});

test("an empty brush stops painting until refilled", () => {
  const sim = started(1);
  const b = place(sim, "p0", 70, 40);
  b.load = 0;
  const before = sim.counts[b.slot + 1]!;
  sim.setInput("p0", 0, 1);
  run(sim, 0.5);
  assert.ok(sim.counts[b.slot + 1]! - before < 15);
});

test("painting over your own colour is free", () => {
  const sim = started(1);
  const b = sim.brushes.get("p0")!;
  sim.setInput("p0", 1, 0);
  run(sim, 0.8);
  sim.setInput("p0", -1, 0);
  run(sim, 0.3);
  const load = b.load;
  run(sim, 0.4);
  assert.ok(b.load >= load - 0.02, `load dropped from ${load} to ${b.load}`);
});

test("splat costs paint, lands later, paints a big patch and stuns rivals", () => {
  const sim = started(2);
  const a = place(sim, "p0", 30, 40);
  a.angle = 0;
  const v = place(sim, "p1", 30 + TUNING.splatRange, 40);
  const load = a.load;
  assert.ok(sim.splat("p0"));
  assert.ok(Math.abs(a.load - (load - TUNING.splatCost)) < 1e-9);
  assert.equal(sim.splat("p0"), false, "cooldown");
  const before = sim.counts[a.slot + 1]!;
  run(sim, TUNING.splatFlight + 0.05);
  const ev = sim.drainEvents().find((e) => e.type === "splat");
  assert.ok(ev && ev.type === "splat");
  assert.deepEqual(ev.hits, ["p1"]);
  assert.ok(v.stunT > 0);
  assert.ok(sim.counts[a.slot + 1]! - before > 120);
});

test("can't splat without enough paint", () => {
  const sim = started(1);
  sim.brushes.get("p0")!.load = TUNING.splatCost - 0.01;
  assert.equal(sim.splat("p0"), false);
});

test("dashing into a rival bonks them and steals paint", () => {
  const sim = started(2);
  const a = place(sim, "p0", 40, 40);
  const v = place(sim, "p1", 47, 40);
  a.load = 0.5;
  v.load = 0.5;
  sim.setInput("p0", 1, 0);
  assert.ok(sim.dash("p0"));
  run(sim, 0.2);
  assert.ok(sim.drainEvents().some((e) => e.type === "bonk"));
  assert.ok(v.stunT > 0);
  assert.ok(v.load < 0.5);
});

test("paint pots refill", () => {
  const sim = started(1);
  const b = sim.brushes.get("p0")!;
  b.load = 0.1;
  const pot = sim.pots.find((p) => p.active)!;
  place(sim, "p0", pot.x, pot.z);
  run(sim, DT * 2);
  assert.ok(b.load > 0.95);
  assert.equal(pot.active, false);
});

// ------------------------------------------------------------------ power-ups

const grab = (sim: Sim, id: string, kind: keyof typeof POWERS) => {
  const p = sim.spawnPower(kind);
  place(sim, id, p.x, p.z);
  run(sim, DT * 2);
  return sim.drainEvents().find((e) => e.type === "power");
};

test("power-ups appear on their own when enabled", () => {
  const sim = started(2, { powerups: true });
  run(sim, TUNING.powerEvery * 2);
  assert.ok(sim.powers.length > 0);
});

test("turbo makes you faster", () => {
  const sim = started(2);
  const fast = sim.brushes.get("p0")!;
  const slow = sim.brushes.get("p1")!;
  assert.ok(grab(sim, "p0", "turbo"));
  place(sim, "p0", 10, 20);
  place(sim, "p1", 10, 60);
  sim.setInput("p0", 1, 0);
  sim.setInput("p1", 1, 0);
  run(sim, 1);
  assert.ok(fast.x - 10 > (slow.x - 10) * 1.4, `turbo ${fast.x} vs ${slow.x}`);
});

test("mega brush paints a wider stroke", () => {
  const sim = started(2);
  grab(sim, "p0", "mega");
  place(sim, "p0", 10, 20);
  place(sim, "p1", 10, 60);
  const a0 = sim.counts[sim.brushes.get("p0")!.slot + 1]!;
  const b0 = sim.counts[sim.brushes.get("p1")!.slot + 1]!;
  sim.setInput("p0", 1, 0);
  sim.setInput("p1", 1, 0);
  run(sim, 0.8);
  const a = sim.counts[sim.brushes.get("p0")!.slot + 1]! - a0;
  const b = sim.counts[sim.brushes.get("p1")!.slot + 1]! - b0;
  assert.ok(a > b * 1.5, `mega ${a} vs normal ${b}`);
});

test("a paint bomb's splat is free and huge", () => {
  const sim = started(2);
  const a = sim.brushes.get("p0")!;
  grab(sim, "p0", "bomb");
  assert.equal(a.bomb, true);
  place(sim, "p0", 30, 40);
  a.angle = 0;
  a.load = 0; // a bomb doesn't need paint
  assert.ok(sim.splat("p0"));
  assert.equal(a.bomb, false);
  const before = sim.counts[a.slot + 1]!;
  run(sim, 1);
  assert.ok(sim.counts[a.slot + 1]! - before > 450);
});

test("a shield blocks splats and bounces bonks", () => {
  const sim = started(2);
  const a = place(sim, "p0", 30, 40);
  a.angle = 0;
  const v = sim.brushes.get("p1")!;
  grab(sim, "p1", "shield");
  place(sim, "p1", 30 + TUNING.splatRange, 40);
  sim.splat("p0");
  run(sim, 1);
  const ev = sim.drainEvents().find((e) => e.type === "splat");
  assert.ok(ev && ev.type === "splat");
  assert.deepEqual(ev.blocked, ["p1"]);
  assert.equal(v.stunT, 0);

  place(sim, "p0", 60, 40);
  place(sim, "p1", 67, 40);
  sim.setInput("p0", 1, 0);
  sim.dash("p0");
  run(sim, 0.2);
  assert.ok(sim.drainEvents().some((e) => e.type === "bounce"));
  assert.ok(a.stunT > 0 && v.stunT === 0);
});

test("dry spell dries everyone else's brush", () => {
  const sim = started(3);
  const ev = grab(sim, "p0", "dry");
  assert.ok(ev && ev.type === "power");
  assert.deepEqual(ev.victims.sort(), ["p1", "p2"]);
  const v = place(sim, "p1", 70, 40);
  // keep paint pots out of the way (a pot cures a dry spell)
  for (const pot of sim.pots) Object.assign(pot, { active: false, respawnT: 999 });
  assert.ok(v.dryT > 0 && v.load <= TUNING.dryLoad + 0.01);
  const before = sim.counts[v.slot + 1]!;
  sim.setInput("p1", 1, 0);
  run(sim, 1);
  assert.equal(sim.counts[v.slot + 1], before, "a dried brush paints nothing");
});

test("paint rain drops your colour across the canvas", () => {
  const sim = started(2);
  const a = sim.brushes.get("p0")!;
  grab(sim, "p0", "rain");
  const drops = sim.blobs.filter((b) => b.sky).length;
  assert.equal(drops, TUNING.rainDrops);
  const before = sim.counts[a.slot + 1]!;
  run(sim, 3);
  assert.ok(sim.counts[a.slot + 1]! - before > 300);
});

test("untouched power-ups fizzle", () => {
  const sim = started(1);
  sim.spawnPower("turbo");
  place(sim, "p0", 2, 2);
  run(sim, TUNING.powerLife + 0.5);
  assert.equal(sim.powers.length, 0);
});

// ------------------------------------------------------------------ events

test("events: power-up shower, turpentine wipe, final frenzy", () => {
  const sim = started(2, { powerups: true, events: true, roundLength: 60 });
  const seen = new Set<string>();
  // paint a lot so the wipe has something to clear
  sim.setInput("p0", 1, 0.4);
  sim.setInput("p1", -1, -0.4);
  let paintedBeforeWipe = 0;
  let wipeStarted = false;
  for (let t = 0; t < 60; t += DT) {
    sim.step(DT);
    for (const e of sim.drainEvents()) if (e.type === "event") seen.add(e.kind);
    if (!wipeStarted && seen.has("wipe")) {
      wipeStarted = true;
      paintedBeforeWipe = GRID_W * GRID_H - sim.counts[0]!;
    }
    if (sim.frenzy) {
      assert.equal(sim.brushes.get("p0")!.load, 1, "frenzy: endless paint");
    }
  }
  assert.deepEqual([...seen].sort(), ["frenzy", "shower", "wipe", "wipe-warn"]);
  assert.ok(paintedBeforeWipe > 0);
});

test("the turpentine wipe clears paint back to primer", () => {
  const sim = started(1, { events: true, roundLength: 40 });
  // cover the whole canvas in p0's colour
  const b = sim.brushes.get("p0")!;
  for (let j = 0; j < GRID_H; j += 3) for (let i = 0; i < GRID_W; i += 3) sim.stamp(i, j, 3, b.slot, 0, 1, 1, 1, 0, false);
  const before = sim.counts[0]!;
  run(sim, 40 * 0.55 + 5);
  // a band 15 cells wide across the canvas (either way), minus the odd streak the rag misses
  assert.ok(sim.counts[0]! - before > Math.min(GRID_W, GRID_H) * 12, `wiped only ${sim.counts[0]! - before}`);
  assert.equal(total(sim), GRID_W * GRID_H);
});

test("a long unbroken stroke earns streak cheers", () => {
  const sim = started(1);
  place(sim, "p0", 3, 20);
  sim.setInput("p0", 1, 0);
  run(sim, 4);
  const levels = sim.drainEvents().filter((e) => e.type === "streak");
  assert.ok(levels.length >= 1);
});

// ------------------------------------------------------------------ rounds

test("the round ends and standings rank by coverage", () => {
  const sim = started(2);
  sim.setInput("p0", 1, 0.3);
  run(sim, ROUND_SECONDS + 0.1);
  assert.equal(sim.phase, "end");
  const [first] = sim.standings();
  assert.equal(first!.id, "p0");
});

test("settings: round length applies next round", () => {
  const sim = started(1);
  sim.configure({ roundLength: 120 });
  assert.equal(sim.roundLength, ROUND_SECONDS);
  sim.nextRound();
  assert.equal(sim.roundLength, 120);
});

test("next round wipes the canvas but keeps players", () => {
  const sim = started(2);
  sim.setInput("p0", 1, 0);
  run(sim, 1);
  sim.nextRound();
  assert.equal(sim.round, 2);
  assert.equal(sim.phase, "intro");
  assert.equal(sim.brushes.size, 2);
  assert.ok(GRID_W * GRID_H - sim.counts[0]! < 400, "only home patches");
});

test("a 9th player is turned away", () => {
  const sim = new Sim({ seed: 3 });
  for (let i = 0; i < 8; i++) assert.ok(sim.addBrush(`p${i}`, "x"));
  assert.equal(sim.addBrush("p9", "x"), null);
});

test("stays within the canvas", () => {
  const sim = started(1);
  sim.setInput("p0", -1, -1);
  run(sim, 5);
  const b = sim.brushes.get("p0")!;
  assert.ok(b.x >= 1 && b.z >= 1 && b.x < GRID_W && b.z < GRID_H);
});

test("no pot is left under a brush when play starts", () => {
  for (let seed = 1; seed < 30; seed++) {
    const sim = new Sim({ seed });
    for (let i = 0; i < 8; i++) sim.addBrush(`p${i}`, `P${i}`);
    while (sim.phase === "intro") sim.step(DT);
    sim.drainEvents();
    sim.step(DT);
    assert.ok(!sim.drainEvents().some((e) => e.type === "pickup"), `seed ${seed}: a pot was picked up at GO`);
  }
});
