import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots } from "./bots.ts";
import {
  Course, DIFFICULTIES, HALF_W, LANE_SLOPE, MIN_GAP, ROCKET_W, checkLane, hazardAt, hazardPose, hazardTouches, makeHazard, solidContact, type DifficultyKey,
} from "./course.ts";
import {
  BASE, COUNT_STEPS, HULL, Liftoff, PAD_Y, RESULT_STEPS, THRUST_ALL, G, seeded, thrusterOffsets, type LiftoffEvent,
} from "./rules.ts";

const run = (g: Liftoff, steps: number, each?: () => void) => {
  const ev: LiftoffEvent[] = [];
  for (let i = 0; i < steps; i++) {
    each?.();
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};

/** Steps until the phase is `p` (at most `max` steps). */
const until = (g: Liftoff, p: string, max = 60 * 60, each?: () => void) => {
  const ev: LiftoffEvent[] = [];
  for (let i = 0; i < max && g.phase !== p; i++) {
    each?.();
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};

/** A game with these seats, counted down and flying. */
function flying(ids: string[], seed = 1) {
  const g = new Liftoff({ runs: 3 }, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch(seed);
  run(g, COUNT_STEPS);
  assert.equal(g.phase, "fly");
  return g;
}

/** A course with no obstacles in the way (for physics tests). */
const empty = (g: Liftoff) => {
  g.course.rects.length = 0;
  g.course.hazards.length = 0;
  g.course.rows.length = 0;
  g.course.top = 1e9;
};

const DIFFS: DifficultyKey[] = ["easy", "normal", "hard"];

test("thrusters are spread symmetrically, and one side turns the rocket as hard for any crew size", () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const d = thrusterOffsets(n);
    assert.equal(d.length, n);
    for (let i = 0; i < n; i++) assert.ok(Math.abs(d[i]! + d[n - 1 - i]!) < 1e-9, `n=${n} symmetric`);
    assert.ok(Math.max(...d.map(Math.abs)) <= BASE / 2);
    // turning force of all the left thrusters, with thrust split by n
    const left = d.filter((x) => x < 0).reduce((s, x) => s - x, 0) * ((THRUST_ALL * G) / n);
    const ref = (BASE / 4) * ((THRUST_ALL * G) / 2);
    assert.ok(Math.abs(left - ref) / ref < 0.15, `n=${n} turning ${left.toFixed(2)} vs ${ref.toFixed(2)}`);
  }
});

test("a lone player holds two thrusters: left and right halves", () => {
  const g = flying(["a"]);
  assert.equal(g.thrusters.length, 2);
  assert.deepEqual(g.thrusters.map((t) => t.key), ["l", "r"]);
  assert.deepEqual(g.thrusters.map((t) => t.owner), ["a", "a"]);
  const h = flying(["a", "b", "c"]);
  assert.deepEqual(h.thrusters.map((t) => t.key), ["any", "any", "any"]);
});

test("the left thruster tips the nose right; both together lift the rocket straight up", () => {
  const g = flying(["a"]);
  empty(g);
  run(g, 30, () => g.setInput("a", true, false));
  assert.ok(g.rocket.a > 0.05, `tilt ${g.rocket.a}`);

  const h = flying(["a", "b"]);
  empty(h);
  run(h, 90, () => {
    h.setInput("a", true, true);
    h.setInput("b", true, true);
  });
  assert.ok(h.rocket.y > PAD_Y + 5, `climbs: ${h.rocket.y}`);
  assert.ok(Math.abs(h.rocket.a) < 1e-9 && Math.abs(h.rocket.x) < 1e-9, "no tilt, no drift");
  assert.ok(h.best > 5);
});

test("all thrust gives the same climb for a crew of 2 and a crew of 8", () => {
  const ys = [2, 8].map((n) => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const g = flying(ids);
    empty(g);
    run(g, 60, () => ids.forEach((id) => g.setInput(id, true, false)));
    return g.rocket.y;
  });
  assert.ok(Math.abs(ys[0]! - ys[1]!) < 1e-6);
});

test("no thrust: the rocket sits on the pad until the drop line passes it, then the run ends", () => {
  const g = flying(["a", "b"]);
  empty(g);
  const ev = until(g, "result");
  const crash = ev.find((e) => e.type === "crash");
  assert.ok(crash && crash.type === "crash" && crash.lost, "lost below the drop line");
  assert.equal(g.phase, "result");
  assert.deepEqual(g.heights, [0]);
});

const mash = (g: Liftoff, ids: string[]) => {
  for (const id of ids) g.setInput(id, true, true);
};

test("a slab bumps the rocket: it loses speed, spins a little, and flies on", () => {
  const g = flying(["a", "b"]);
  empty(g);
  g.course.rects.push({ k: "rect", x0: 0.3, x1: 6, y0: 40, y1: 41.4 });
  g.rocket.x = 0; // the nose meets the slab's corner: the hit turns it
  let vBefore = 0;
  const ev: LiftoffEvent[] = [];
  for (let i = 0; i < 60 * 12 && !ev.some((e) => e.type === "bump"); i++) {
    vBefore = g.rocket.vy;
    mash(g, ["a", "b"]);
    g.step();
    ev.push(...g.drainEvents());
  }
  const bump = ev.find((e) => e.type === "bump");
  assert.ok(bump && bump.type === "bump", "a bump event");
  assert.ok(bump.power > 0.2 && Math.abs(bump.ny) > 0.5, "from below");
  assert.ok(g.rocket.vy < vBefore * 0.5, `speed lost: ${vBefore.toFixed(1)} -> ${g.rocket.vy.toFixed(1)}`);
  assert.ok(Math.abs(g.rocket.w) > 0.02 && Math.abs(g.rocket.w) < 2.3, `small spin ${g.rocket.w}`);
  // no crash, and the pilots can still fly: from beside the slab they climb past it
  ev.push(...run(g, 60 * 3, () => mash(g, ["a", "b"])));
  assert.equal(g.phase, "fly");
  assert.ok(g.rocket.alive);
  assert.ok(!ev.some((e) => e.type === "crash"));
  g.rocket.x = -5;
  g.rocket.vx = 0;
  g.rocket.a = 0;
  g.rocket.w = 0;
  run(g, 60 * 4, () => mash(g, ["a", "b"]));
  assert.equal(g.phase, "fly");
  assert.ok(g.rocket.y > 45, `flew on past the slab: ${g.rocket.y}`);
});

test("the walls bump too: the rocket stays in the tunnel and flies on", () => {
  const g = flying(["a", "b"]);
  empty(g);
  g.rocket.x = HALF_W - 1;
  g.rocket.vx = 6;
  const ev = run(g, 60 * 5, () => mash(g, ["a", "b"]));
  assert.equal(g.phase, "fly");
  assert.ok(ev.some((e) => e.type === "bump"));
  assert.ok(!ev.some((e) => e.type === "crash"));
  for (const [hx, hy, hr] of HULL) assert.ok(!solidContact(g.course, g.rocket.x + hx, g.rocket.y + hy, hr - 0.05), "pushed back inside");
  assert.ok(g.rocket.y > PAD_Y + 20, "climbing on");
});

test("a hazard ends the run, scored by its best height; each kind moves as built", () => {
  const g = flying(["a", "b"]);
  empty(g);
  g.course.hazards.push(makeHazard("mine", { x: 0, y: 30, r: 1 }));
  const ev = until(g, "result", 60 * 10, () => mash(g, ["a", "b"]));
  const crash = ev.find((e) => e.type === "crash");
  assert.ok(crash && crash.type === "crash" && !crash.lost && crash.cause === "mine");
  assert.ok(g.heights[0]! > 15 && g.heights[0]! < 30, `height ${g.heights[0]}`);
  assert.equal(g.record, g.heights[0]);
  assert.ok(g.newRecord);

  // a bar turns, a meteor and a laser swing; a mine stays
  const c = new Course(seeded(1), DIFFICULTIES.normal);
  c.hazards.push(makeHazard("bar", { x: 0, y: 10, r: 0.35, len: 3, spin: Math.PI / 2, a0: 0 }));
  assert.ok(hazardAt(c, 2.5, 10, 0.5, 0), "bar is level at t=0");
  assert.ok(!hazardAt(c, 2.5, 10, 0.5, 1), "bar is upright at t=1");
  assert.ok(hazardAt(c, 0, 12.5, 0.5, 1));
  const laser = makeHazard("laser", { x: 0, y: 20, r: 0.22, len: 4, ay: 2, om2: 1, ph2: 0 });
  assert.equal(hazardPose(laser, Math.PI / 2).y, 22);
  assert.ok(hazardTouches(laser, 3, 22, 0.4, Math.PI / 2));
  assert.ok(!hazardTouches(laser, 3, 22, 0.4, 0));
  const meteor = makeHazard("meteor", { x: 0, y: 5, r: 1, ax: 4, om: 1, ph: 0 });
  assert.equal(hazardPose(meteor, Math.PI / 2).x, 4);
});

test("a match runs its runs, then ends on the match screen", () => {
  const g = new Liftoff({ runs: 3 }, seeded(4));
  const bots = createBots(g, seeded(5));
  bots.setCount(3);
  g.startMatch(77);
  g.drainEvents();
  const phases: string[] = [];
  let steps = 0;
  while (g.phase !== "match" && steps < 60 * 60 * 12) {
    bots.step();
    g.step();
    for (const e of g.drainEvents()) if (e.type === "phase") phases.push(e.phase);
    steps++;
  }
  assert.equal(g.phase, "match");
  assert.equal(g.heights.length, 3);
  assert.equal(phases.filter((p) => p === "count").length, 2, "two more counts after the first run");
  assert.equal(g.matchBest, Math.max(...g.heights));
  assert.ok(g.matchRecord, "the first match sets a crew best, whichever run it was");
  assert.equal(g.record, g.matchBest);
  // the next match starts again from run 1
  g.startMatch(78);
  assert.equal(g.run, 1);
  assert.equal(g.matchRecord, false);
  assert.deepEqual(g.heights, []);
});

test("a seeded match replays exactly", () => {
  const go = () => {
    const g = new Liftoff({ runs: 1 }, seeded(3));
    const bots = createBots(g, seeded(8));
    bots.setCount(4);
    g.startMatch(1234);
    for (let i = 0; i < 60 * 200 && g.phase !== "match"; i++) {
      bots.step();
      g.step();
    }
    return { h: g.heights, x: g.rocket.x, y: g.rocket.y };
  };
  assert.deepEqual(go(), go());
});

const flyRun = (n: number, seed: number, diff: DifficultyKey, errors: boolean, maxSteps = 60 * 400) => {
  const g = new Liftoff({ runs: 1, difficulty: diff }, seeded(seed));
  const bots = createBots(g, seeded(seed + 50), errors);
  bots.setCount(n);
  g.startMatch(seed * 31);
  let cause = "";
  for (let i = 0; i < maxSteps && g.phase !== "match"; i++) {
    bots.step();
    g.step();
    for (const e of g.drainEvents()) if (e.type === "crash") cause = e.cause;
  }
  return { h: g.heights[0] ?? Math.floor(g.best), secs: g.flySteps / 60, cause, g };
};
const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return (s[(s.length - 1) >> 1]! + s[s.length >> 1]!) / 2;
};

test("flawless bots fly the lane through 900 m on every difficulty: the course can be flown", () => {
  for (const diff of DIFFS)
    for (const n of [1, 3, 8])
      for (let seed = 1; seed <= 4; seed++) {
        const r = flyRun(n, seed, diff, false, 60 * 420);
        assert.ok(r.h >= 900, `${diff}, crew ${n}, seed ${seed}: ended at ${r.h} m (${r.cause})`);
      }
});

test("careful bots fly well, whatever the crew size; a normal run lasts about 1 to 2 minutes", () => {
  for (const n of [1, 3, 8]) {
    const hs: number[] = [];
    const ts: number[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      const r = flyRun(n, seed, "normal", true);
      hs.push(r.h);
      ts.push(r.secs);
    }
    assert.ok(median(hs) > 150, `crew of ${n}: median ${median(hs)} m`);
    assert.ok(median(ts) >= 55 && median(ts) <= 150, `crew of ${n}: median ${median(ts)} s`);
  }
});

test("a careless crew (random mashing) ends early, on a hazard or the drop line", () => {
  const hs: number[] = [];
  for (let seed = 1; seed <= 8; seed++) {
    const g = flying(["a", "b", "c"], seed);
    const rnd = seeded(seed + 900);
    for (let i = 0; i < 60 * 120 && g.phase === "fly"; i++) {
      if (i % 14 === 0) for (const id of ["a", "b", "c"]) g.setInput(id, rnd() < 0.55, false);
      g.step();
    }
    assert.equal(g.phase, "result", `seed ${seed}: ended within 2 minutes`);
    hs.push(g.heights[0]!);
  }
  assert.ok(median(hs) < 150, `median ${median(hs)} m`);
});

test("a player who leaves mid-run: the thruster falls silent until a bot takes it", () => {
  const g = flying(["a", "b", "c"]);
  const bots = createBots(g, seeded(2));
  g.removeSeat("b");
  assert.equal(g.orphans().length, 1);
  const id = bots.addOne()!;
  assert.equal(g.handOver("", id), 1);
  assert.equal(g.orphans().length, 0);
  assert.equal(g.thrusters[1]!.owner, id);
  assert.equal(g.thrusters[1]!.bot, true);
  assert.equal(g.phase, "fly");
});

test("a player who joins mid-run takes over a bot's thruster", () => {
  const g = new Liftoff({ runs: 3 }, seeded(1));
  const bots = createBots(g, seeded(2));
  bots.setCount(3);
  g.startMatch(5);
  run(g, COUNT_STEPS + 30);
  const bot = bots.yield(true)!;
  g.addSeat("h", "Hana");
  assert.ok(g.handOver(bot, "h") >= 1);
  g.removeSeat(bot);
  assert.ok(g.flying("h"));
  assert.equal(g.thrusters.length, 3);
  assert.equal(g.phase, "fly");
});

test("a lone player shares the rocket with a newcomer at once", () => {
  const g = flying(["a"]);
  g.addSeat("b", "B");
  const second = g.thrusters[1]!;
  g.handOver("a", "b", second);
  assert.deepEqual(g.thrusters.map((t) => `${t.owner}:${t.key}`), ["a:any", "b:any"]);
});

test("a newcomer early in the 3-2-1 is let in and the count restarts", () => {
  const g = new Liftoff({ runs: 3 }, seeded(1));
  g.addSeat("a", "A");
  g.startMatch(9);
  run(g, 30);
  g.addSeat("b", "B");
  assert.ok(g.admitLate());
  assert.equal(g.thrusters.length, 2);
  assert.equal(g.t, 0);
  assert.equal(g.run, 1);
});

test("everyone leaving goes back to waiting; a seat starts the count again", () => {
  const g = flying(["a"]);
  g.removeSeat("a");
  assert.equal(g.phase, "wait");
  g.addSeat("b", "B");
  assert.equal(g.phase, "count");
});

test("the lane rule is built on the real hull width", () => {
  const w = 2 * Math.max(...HULL.map(([x, , r]) => Math.abs(x) + r));
  assert.ok(ROCKET_W >= w - 1e-9, `rocket ${w.toFixed(2)} m wide, rule uses ${ROCKET_W}`);
  assert.ok(Math.abs(MIN_GAP - 1.4 * ROCKET_W) < 1e-9);
});

test("lane guarantee: 200 seeds x 1000 m x every difficulty keep a path of 1.4 x the rocket's width, always reachable", () => {
  for (const diff of DIFFS)
    for (let seed = 1; seed <= 200; seed++) {
      const c = new Course(seeded(seed * 7 + 1), DIFFICULTIES[diff]);
      c.ensure(1000);
      const where = `${diff} seed ${seed}`;
      assert.equal(c.dropped, 0, `${where}: the generator never has to drop an obstacle`);
      // the fattened rocket, swept along the lane, touches no slab and no hazard at any time of their cycles
      assert.deepEqual(checkLane(c, 1000, HULL, 60, 0.3), [], where);
      // the lane never shifts faster than the slope the rocket can follow, and stays inside the tunnel
      for (let y = 0; y < 1000; y += 0.5) {
        const a = c.laneAt(y);
        assert.ok(Math.abs(c.laneAt(y + 0.5) - a) <= LANE_SLOPE * 0.5 + 1e-9, `${where}: lane too steep at ${y}`);
        assert.ok(Math.abs(a) <= HALF_W - MIN_GAP / 2, `${where}: lane near the wall at ${y}`);
      }
    }
});

test("the lane is wide at the start, close to the minimum higher up, and never below it", () => {
  for (const diff of DIFFS) {
    const c = new Course(seeded(21), DIFFICULTIES[diff]);
    c.ensure(1500);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    const low = avg(c.rows.filter((r) => r.y0 < 60).map((r) => r.gw));
    const high = avg(c.rows.filter((r) => r.y0 > 400).map((r) => r.gw));
    assert.ok(c.rows.every((r) => r.gw >= MIN_GAP - 1e-9), `${diff}: never below the minimum`);
    assert.ok(high < low - 1, `${diff}: narrower higher up (${low.toFixed(1)} -> ${high.toFixed(1)})`);
    assert.ok(high <= MIN_GAP * (diff === "easy" ? 1.9 : 1.4), `${diff}: close to the minimum at height (${high.toFixed(2)} vs ${MIN_GAP.toFixed(2)})`);
  }
});

test("the course mixes static and moving hazards, and gets denser, faster and more demanding with height", () => {
  const moving = (h: Course["hazards"][number]) => h.ax > 0 || h.ay > 0 || h.spin !== 0;
  for (const diff of DIFFS) {
    const c = new Course(seeded(33), DIFFICULTIES[diff]);
    c.ensure(1500);
    const kinds = new Set(c.hazards.map((h) => h.k));
    assert.deepEqual([...kinds].sort(), ["bar", "laser", "meteor", "mine"], `${diff}: all four hazards`);
    assert.ok(c.rects.length > 0, `${diff}: slabs too`);
    assert.ok(c.hazards.some((h) => !moving(h)), `${diff}: static hazards`);
    const share = (lo: number, hi: number) => {
      const zs: string[] = [];
      for (let seed = 1; seed <= 20; seed++) {
        const k = new Course(seeded(seed), DIFFICULTIES[diff]);
        k.ensure(hi);
        zs.push(...k.rows.filter((r) => r.y0 >= lo && r.y0 < hi).flatMap((r) => r.fill));
      }
      return zs.filter((f) => f === "meteor" || f === "bar" || f === "laser").length / Math.max(1, zs.length);
    };
    assert.ok(share(0, 100) + 0.2 < share(400, 1500), `${diff}: more zones hold moving hazards higher up (${share(0, 100).toFixed(2)} -> ${share(400, 1500).toFixed(2)})`);
    // rows closer together, and zigzags (a big lane shift) more often
    const pitch = (lo: number, hi: number) => {
      const rs = c.rows.filter((r) => r.y0 >= lo && r.y0 < hi);
      return (rs[rs.length - 1]!.y0 - rs[0]!.y0) / (rs.length - 1);
    };
    assert.ok(pitch(400, 1500) < pitch(0, 200), `${diff}: rows closer higher up`);
    const rs = c.rows.filter((r) => r.y0 >= 400);
    let big = 0;
    for (let i = 1; i < rs.length; i++) if (Math.abs(rs[i]!.c - rs[i - 1]!.c) > 1.8) big++;
    assert.ok(big / (rs.length - 1) >= 0.3, `${diff}: the lane keeps changing sides (${(big / (rs.length - 1)).toFixed(2)})`);
  }
  // harder courses move faster
  const speed = (d: DifficultyKey) => {
    const k = new Course(seeded(33), DIFFICULTIES[d]);
    k.ensure(800);
    const m = k.hazards.filter((h) => h.k === "meteor" && h.y > 300);
    return m.reduce((s, h) => s + h.ax * h.om, 0) / m.length;
  };
  assert.ok(speed("hard") > speed("easy"));
});

test("the same seed builds the same course", () => {
  const a = new Course(seeded(5), DIFFICULTIES.normal);
  const b = new Course(seeded(5), DIFFICULTIES.normal);
  a.ensure(600);
  b.ensure(600);
  assert.deepEqual(a.hazards, b.hazards);
  assert.deepEqual(a.rows, b.rows);
});

test("the result phase lasts its time, then the next run counts down", () => {
  const g = flying(["a", "b"]);
  empty(g);
  until(g, "result");
  assert.equal(g.phase, "result");
  run(g, RESULT_STEPS);
  assert.equal(g.phase, "count");
  assert.equal(g.run, 2);
});
