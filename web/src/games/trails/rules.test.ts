import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots, freeRun } from "./bots.ts";
import {
  ARENA_H, ARENA_W, CAPS, COUNT_STEPS, ROUND_STEPS, TARGETS, Trails, clearAhead, seeded,
  type Seat, type TrailsEvent,
} from "./rules.ts";

/** A game with these lines, already playing; `place` puts them where a test wants them. */
function playing(ids: string[], seed = 1, gaps = false) {
  const g = new Trails({ gaps }, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
  g.drainEvents();
  return g;
}
const place = (s: Seat, x: number, y: number, a: number) => Object.assign(s, { x, y, px: x, py: y, a, path: [x, y], dist: 0, gapIn: 1e9, gapLeft: 0 });
const run = (g: Trails, steps: number) => {
  const ev: TrailsEvent[] = [];
  for (let i = 0; i < steps; i++) {
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};
const crashes = (ev: TrailsEvent[]) => ev.filter((e) => e.type === "crash") as Extract<TrailsEvent, { type: "crash" }>[];

test("a line that runs straight into the edge is out, hit by the edge", () => {
  const g = playing(["a", "b"]);
  place(g.seats.get("a")!, 1200, 440, 0);
  place(g.seats.get("b")!, 200, 200, Math.PI / 2);
  const ev = run(g, 60);
  const c = crashes(ev);
  assert.equal(c.length, 1);
  assert.equal(c[0]!.id, "a");
  assert.equal(c[0]!.by, -1);
  assert.ok(g.seats.get("a")!.x > 1270);
});

test("crossing another trail ends your run; the trail's owner scores", () => {
  const g = playing(["a", "b", "c"]);
  const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
  place(a!, 300, 400, 0); // east along y = 400
  place(b!, 520, 700, -Math.PI / 2); // north, crosses a's line at x = 520
  place(c!, 100, 800, 0);
  const ev = run(g, 150);
  const hit = crashes(ev).find((e) => e.id === "b");
  assert.ok(hit, "b crashed");
  assert.equal(hit!.by, a!.slot);
  assert.ok(Math.abs(hit!.y - 400) < 7, `crashed at the line, y=${hit!.y}`);
  assert.equal(a!.score, 1);
  assert.equal(c!.score, 1);
  assert.equal(b!.score, 0);
});

test("a diagonal line can't slip between the cells of another diagonal", () => {
  for (const off of [0, 0.5, 1, 1.5]) {
    const g = playing(["a", "b", "c"]);
    const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
    place(a!, 300 + off, 300, Math.PI / 4);
    place(b!, 700, 300 + off, (3 * Math.PI) / 4);
    place(c!, 100, 850, 0);
    const ev = run(g, 240);
    assert.ok(crashes(ev).some((e) => e.id === "a" || e.id === "b"), `offset ${off}: someone crashed`);
  }
});

test("a line turning hard comes round and hits its own trail", () => {
  const g = playing(["a", "b"]);
  const a = g.seats.get("a")!;
  place(a, 640, 440, 0);
  place(g.seats.get("b")!, 100, 100, 0);
  g.seats.get("b")!.turn = 0;
  a.turn = 1;
  const ev = run(g, 200);
  const own = crashes(ev).find((e) => e.id === "a");
  assert.ok(own, "a crashed");
  assert.equal(own!.by, a.slot);
  // about one turning circle, not at once
  assert.ok(a.dist > 200 && a.dist < 320, `travelled ${a.dist}`);
});

test("a head-on crash takes both lines out, and neither scores off the other", () => {
  const g = playing(["a", "b", "c"]);
  const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
  place(a!, 500, 400, 0);
  place(b!, 700, 400, Math.PI);
  place(c!, 100, 850, 0);
  const ev = run(g, 60);
  const out = crashes(ev).map((e) => e.id).sort();
  assert.deepEqual(out, ["a", "b"]);
  assert.equal(a!.score, 0);
  assert.equal(b!.score, 0);
  assert.equal(c!.score, 2);
  assert.ok(ev.some((e) => e.type === "round" && e.survivor === "c"));
});

test("the round ends when one line is left; the next one counts in after the result", () => {
  const g = playing(["a", "b"]);
  place(g.seats.get("a")!, 1260, 440, 0);
  place(g.seats.get("b")!, 300, 440, 0);
  const ev = run(g, 30);
  assert.ok(ev.some((e) => e.type === "round" && e.survivor === "b"));
  assert.equal(g.phase, "round");
  assert.equal(g.seats.get("b")!.score, 1);
  run(g, ROUND_STEPS);
  assert.equal(g.phase, "count");
  assert.equal(g.round, 2);
  assert.ok(g.seats.get("a")!.alive && g.seats.get("b")!.alive);
  assert.equal(g.owner.reduce((n, v) => n + (v ? 1 : 0), 0), 0, "the grid is clear");
});

test("gaps open in a trail now and then, and another line can pass through one", () => {
  const g = playing(["a", "b", "c"], 3, true);
  const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
  place(a!, 200, 400, 0);
  a!.gapIn = 300; // a gap opens at x ≈ 500
  place(b!, 100, 850, 0);
  place(c!, 100, 100, 0);
  run(g, 150);
  assert.ok(a!.path.some(Number.isNaN), "the path has a break");
  // the cells under the gap are empty
  const row = Math.floor(400 / 2) * (ARENA_W / 2);
  const empty = (x: number) => !g.owner[row + Math.floor(x / 2)];
  assert.ok(empty(515) && !empty(450), "gap at 500–530, line before it");
  // now b goes north through the middle of the gap
  place(b!, 515, 600, -Math.PI / 2);
  b!.dist = 0;
  const ev = run(g, 100);
  assert.ok(!crashes(ev).some((e) => e.id === "b"), "b slipped through");
  assert.ok(b!.y < 400);
});

test("with gaps off, trails are solid", () => {
  const g = playing(["a", "b"], 4, false);
  place(g.seats.get("a")!, 100, 300, 0);
  place(g.seats.get("b")!, 100, 600, 0);
  run(g, 300);
  assert.ok(!g.seats.get("a")!.path.some(Number.isNaN));
});

test("the target scales with the lines, and a win needs a lead of two", () => {
  const g = playing(["a", "b", "c", "d"]);
  assert.equal(g.target, TARGETS.normal * 3);
  const [a, b] = [g.seats.get("a")!, g.seats.get("b")!];
  a.score = g.target;
  b.score = g.target - 1;
  assert.equal(g.checkWinner(), null, "lead of one is not enough");
  b.score = g.target - 2;
  assert.deepEqual(g.checkWinner(), ["a"]);
  // a line leaves between rounds: the target follows
  g.removeSeat("d");
  run(g, 1);
  g.configure({ target: "short" });
  assert.equal(g.target, TARGETS.short * 2);
});

test("at the round cap the leader wins; a tie plays on, then is shared", () => {
  const g = playing(["a", "b"]);
  const [a, b] = [g.seats.get("a")!, g.seats.get("b")!];
  g.round = CAPS.normal;
  a.score = 3;
  b.score = 2;
  assert.deepEqual(g.checkWinner(), ["a"]);
  b.score = 3;
  assert.equal(g.checkWinner(), null);
  g.round = CAPS.normal + 3;
  assert.deepEqual(g.checkWinner()!.sort(), ["a", "b"]);
});

test("a full match ends on the winner screen", () => {
  const g = new Trails({ target: "short" }, seeded(9));
  const bots = createBots(g, seeded(10));
  bots.setCount(3);
  g.startMatch();
  let steps = 0;
  while (g.phase !== "match" && steps < 60 * 60 * 30) {
    bots.step();
    g.step();
    steps++;
  }
  assert.equal(g.phase, "match");
  assert.ok(g.winners.length >= 1);
  const top = g.standings()[0]!;
  assert.ok(g.winners.includes(top.id));
});

test("leaving mid-round gives nobody points; one line left ends the round", () => {
  const g = playing(["a", "b", "c"]);
  g.removeSeat("c");
  run(g, 1);
  assert.equal(g.seats.get("a")!.score, 0);
  assert.equal(g.phase, "play");
  assert.equal(g.ghosts.length, 1, "c's trail stays");
  g.removeSeat("b");
  assert.equal(g.phase, "round");
  run(g, ROUND_STEPS);
  assert.equal(g.phase, "wait", "one line can't play alone");
});

test("a newcomer mid-round waits for the next round", () => {
  const g = playing(["a", "b"]);
  const n = g.addSeat("n", "N")!;
  assert.equal(n.inRound, false);
  run(g, 5);
  assert.equal(n.alive, false);
  assert.ok(n.slot !== g.seats.get("a")!.slot && n.slot !== g.seats.get("b")!.slot);
});

test("eight spawns are spread out and none faces a wall", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Trails({}, seeded(seed));
    for (let i = 0; i < 8; i++) g.addSeat(`p${i}`, `P${i}`);
    g.startMatch();
    const s = [...g.seats.values()];
    for (const p of s) {
      assert.ok(clearAhead(p.x, p.y, p.a, 200, 30), `seed ${seed}: ${p.id} faces a wall`);
      for (const q of s) if (p !== q) assert.ok(Math.hypot(p.x - q.x, p.y - q.y) > 150, `seed ${seed}: too close`);
    }
  }
});

test("the speed rises a little in long rounds", () => {
  const g = playing(["a", "b"]);
  const v0 = g.speed;
  g.playSteps = 60 * 30;
  assert.ok(g.speed > v0 * 1.1 && g.speed < v0 * 1.45);
});

test("a bot pointed at a wall turns away", () => {
  const g = playing(["x", "y"], 5);
  place(g.seats.get("x")!, 100, 100, Math.PI / 2);
  place(g.seats.get("y")!, 200, 100, Math.PI / 2);
  const bots = createBots(g, seeded(6));
  bots.setCount(1);
  // the bot only plays from the next round: put it in this one by hand
  const b = g.seats.get("bot-0")!;
  Object.assign(b, { inRound: true, alive: true });
  place(b, 1100, 440, 0);
  for (let i = 0; i < 120; i++) {
    bots.step();
    g.step();
  }
  assert.ok(b.alive, "the bot is still going");
  assert.ok(b.x < 1270);
});

test("bots alone last a good while and the rounds end", () => {
  let total = 0;
  const rounds = 6;
  for (let seed = 1; seed <= rounds; seed++) {
    const g = new Trails({}, seeded(seed));
    const bots = createBots(g, seeded(seed + 100));
    bots.setCount(2);
    g.startMatch();
    let steps = 0;
    while (g.phase !== "round" && steps < 60 * 300) {
      bots.step();
      g.step();
      steps++;
    }
    assert.equal(g.phase, "round", `seed ${seed}: the round ended`);
    total += g.playSteps;
  }
  assert.ok(total / rounds > 60 * 12, `average round ${(total / rounds / 60).toFixed(1)} s`);
});

test("freeRun sees the edge ahead", () => {
  const g = playing(["a", "b"]);
  const a = g.seats.get("a")!;
  place(a, 1180, 440, 0);
  const d = freeRun(g, a, 0, 0, 300);
  assert.ok(d > 85 && d < 100, `free ${d}`);
  assert.ok(freeRun(g, a, -1, 99, 300) > d);
  assert.equal(ARENA_H, 880);
});

test("a line that joins early in the 3-2-1 is let in at once", () => {
  const g = new Trails({}, seeded(2));
  g.addSeat("a", "A");
  g.addSeat("b", "B");
  g.startMatch();
  run(g, 30);
  const c = g.addSeat("c", "C")!;
  assert.ok(g.admitLate());
  assert.equal(g.round, 1);
  assert.equal(g.phase, "count");
  assert.ok(c.inRound && c.alive);
  run(g, 120);
  assert.equal(g.addSeat("d", "D")!.inRound, false);
  assert.equal(g.admitLate(), false, "too late in the count");
});
