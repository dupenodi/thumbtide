import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots } from "./bots.ts";
import { Course, DIFFICULTIES, HALF_W, circleHits, gateOpenings } from "./course.ts";
import {
  BASE, COUNT_STEPS, Liftoff, PAD_Y, RESULT_STEPS, THRUST_ALL, G, seeded, thrusterOffsets, type LiftoffEvent,
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
  g.course.obstacles.length = 0;
  g.course.gates.length = 0;
  g.course.top = 1e9;
};

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

test("flying straight up into a slab crashes; the run is scored by its best height", () => {
  const g = flying(["a", "b"]);
  // the first slab is a gap slab; park the rocket under its solid part
  const gate = g.course.gates[0]!;
  const cx = gate.opens[0]!.cx;
  g.rocket.x = cx > 0 ? cx - 5 : cx + 5;
  const ev = until(g, "result", 60 * 10, () => {
    g.setInput("a", true, true);
    g.setInput("b", true, true);
  });
  const crash = ev.find((e) => e.type === "crash");
  assert.ok(crash && crash.type === "crash" && !crash.lost);
  assert.ok(g.heights[0]! > 8 && g.heights[0]! < gate.y0, `height ${g.heights[0]}`);
  assert.equal(g.record, g.heights[0]);
  assert.ok(g.newRecord);
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

test("careful bots fly well, whatever the crew size", () => {
  for (const n of [1, 2, 5, 8]) {
    const hs: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const g = new Liftoff({ runs: 1 }, seeded(seed));
      const bots = createBots(g, seeded(seed + 50));
      bots.setCount(n);
      g.startMatch(seed * 31);
      for (let i = 0; i < 60 * 400 && g.phase !== "match"; i++) {
        bots.step();
        g.step();
      }
      hs.push(g.heights[0]!);
    }
    hs.sort((a, b) => a - b);
    const med = (hs[3]! + hs[4]!) / 2;
    assert.ok(med > 120, `crew of ${n}: median ${med} m`);
  }
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

test("the course: gaps fit the rocket, stay inside the tunnel, and get narrower with height", () => {
  for (const key of ["easy", "normal", "hard"] as const) {
    const c = new Course(seeded(11), DIFFICULTIES[key]);
    c.ensure(1200);
    const fixed = c.gates.filter((g) => g.kind === "gap");
    for (const g of c.gates) {
      for (let t = 0; t < 20; t += 0.5) {
        for (const o of gateOpenings(g, t)) {
          assert.ok(o.half * 2 >= 3.2, `${key}: opening ${o.half * 2} wide`);
          assert.ok(Math.abs(o.cx) + o.half <= HALF_W + 1e-6, `${key}: opening inside`);
          if (g.kind === "gap" || g.kind === "slide" || g.kind === "chimney")
            assert.ok(!circleHits(c, o.cx, (g.y0 + g.y1) / 2, 1.3, t), `${key}: the middle of a ${g.kind} opening is clear`);
        }
      }
    }
    const low = fixed.filter((g) => g.y0 < 150).map((g) => g.opens[0]!.half);
    const high = fixed.filter((g) => g.y0 > 800).map((g) => g.opens[0]!.half);
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    if (low.length && high.length) assert.ok(avg(high) < avg(low), `${key}: narrower higher up`);
    assert.ok(new Set(c.chunks.map((k) => k.kind)).size >= 4, `${key}: a mix of chunks`);
  }
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
