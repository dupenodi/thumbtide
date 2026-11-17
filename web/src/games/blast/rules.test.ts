import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots } from "./bots.ts";
import {
  BOMB_COOL, BOMB_FUSE, COUNT_STEPS, CRUMBLE_AFTER, CRUMBLE_EVERY, JUMP_STEPS, MAX_SEATS, PR, PUNCH_COOL,
  ROUND_STEPS, Blast, seeded, type Bomb, type BlastEvent, type Seat,
} from "./rules.ts";

/** A game with these fighters, already playing, on one arena. */
function playing(ids: string[], seed = 1, opts: Partial<ConstructorParameters<typeof Blast>[0]> = { arena: "blanket" }) {
  const g = new Blast(opts, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
  g.drainEvents();
  return g;
}
const place = (s: Seat, x: number, y: number) => Object.assign(s, { x, y, px: x, py: y, vx: 0, vy: 0 });
const run = (g: Blast, steps: number, each?: () => void) => {
  const ev: BlastEvent[] = [];
  for (let i = 0; i < steps; i++) {
    each?.();
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};
const of = <T extends BlastEvent["type"]>(ev: BlastEvent[], type: T) => ev.filter((e) => e.type === type) as Extract<BlastEvent, { type: T }>[];
/** Clear the crates so a test has open ground. */
const open = (g: Blast) => {
  g.crates = [];
};
const bomb = (owner: string, x: number, y: number, fuse: number, kind: Bomb["kind"] = "normal"): Bomb => ({
  id: Math.floor(Math.random() * 1e9), group: Math.floor(Math.random() * 1e9), owner, kind, x, y, px: x, py: y, vx: 0, vy: 0, fuse, age: 99, stuck: null, falling: 0,
});

test("a match needs two fighters; the count leads to play", () => {
  const g = new Blast({}, seeded(1));
  g.addSeat("a", "A");
  g.startMatch();
  assert.equal(g.phase, "wait");
  g.addSeat("b", "B");
  g.step();
  assert.equal(g.phase, "count");
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
});

test("at most eight seats", () => {
  const g = new Blast({}, seeded(1));
  for (let i = 0; i < 10; i++) g.addSeat(`p${i}`, `P${i}`);
  assert.equal(g.seats.size, MAX_SEATS);
  assert.equal(g.addSeat("late", "Late"), null);
});

test("every arena: spawns and crates stand on the platform, and spawn points differ", () => {
  for (const arena of ["shelf", "blanket", "tub"] as const) {
    const g = playing(["a", "b", "c", "d", "e", "f", "g", "h"], 4, { arena });
    for (const s of g.seats.values()) assert.ok(g.groundAt(s.x, s.y), `${arena}: ${s.id} spawns on the ground`);
    for (const c of g.crates) assert.ok(g.groundAt(c.x, c.y), `${arena}: crate on the ground`);
    const spots = new Set([...g.seats.values()].map((s) => `${s.x},${s.y}`));
    assert.equal(spots.size, 8, "all spawn points differ");
  }
});

test("the stick moves a fighter up to its top speed", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  place(a, 0, 0);
  place(g.seats.get("b")!, 200, 200);
  run(g, 30, () => g.setInput("a", 1, 0));
  const v = Math.hypot(a.vx, a.vy);
  assert.ok(v > 240 && v < 290, `speed ${v}`);
  assert.ok(a.x > 40);
});

test("a blast knocks a near fighter back more than a far one, away from the bomb", () => {
  const speedAfter = (bombX: number) => {
    const g = playing(["a", "b"]);
    open(g);
    place(g.seats.get("a")!, -200, 0);
    place(g.seats.get("b")!, 200, 200);
    g.bombs.push(bomb("b", bombX, 0, 3));
    run(g, 5);
    const a = g.seats.get("a")!;
    return { v: Math.hypot(a.vx, a.vy), vx: a.vx };
  };
  const near = speedAfter(-170);
  const far = speedAfter(-100);
  assert.ok(near.v > far.v && far.v > 60, `${near.v} vs ${far.v}`);
  assert.ok(near.vx < 0 && far.vx < 0);
  assert.equal(speedAfter(-20).v, 0, "outside the blast: nothing");
});

test("throwing: the bomb leaves the way the fighter faces, with a cooldown and at most two live", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  place(a, 0, 0);
  place(g.seats.get("b")!, 250, 250);
  a.face = 0;
  assert.ok(g.throwBomb("a"));
  assert.equal(g.bombs.length, 1);
  assert.ok(g.bombs[0]!.vx > 300 && Math.abs(g.bombs[0]!.vy) < 1);
  assert.equal(g.throwBomb("a"), false, "cooldown");
  run(g, BOMB_COOL);
  assert.ok(g.throwBomb("a", Math.PI / 2));
  g.seats.get("a")!.bombCool = 0;
  assert.equal(g.throwBomb("a"), false, "two bombs already live");
  assert.equal(g.bombs.filter((b) => b.owner === "a").length, 2);
});

test("a bomb goes off after its fuse", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(g.seats.get("a")!, -250, 250);
  place(g.seats.get("b")!, 250, -250);
  g.throwBomb("a", -Math.PI / 4);
  const ev = run(g, BOMB_FUSE + 2);
  assert.equal(of(ev, "blast").length, 1);
  assert.equal(g.bombs.length, 0);
});

test("a fast bomb that hits a fighter goes off at once", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(g.seats.get("a")!, -100, 0);
  place(g.seats.get("b")!, 60, 0);
  g.seats.get("a")!.face = 0;
  g.throwBomb("a");
  const ev = run(g, 40);
  const blast = of(ev, "blast");
  assert.equal(blast.length, 1);
  assert.ok(g.t < 60, "it went off long before the fuse");
  assert.ok(blast[0]!.x > -20, "near the target");
});

test("a crate blocks a blast, breaks, and sometimes drops a power-up", () => {
  const g = playing(["a", "b"]);
  g.crates = [{ id: 77, x: 0, y: 0, w: 44, h: 44, kind: "crate" }];
  place(g.seats.get("a")!, 80, 0);
  place(g.seats.get("b")!, 250, 250);
  g.bombs.push(bomb("b", -60, 0, 2));
  const ev = run(g, 4);
  assert.equal(of(ev, "hit").length, 0, "shielded by the crate");
  assert.equal(g.crates.length, 0, "the crate broke");
  assert.equal(of(ev, "crate").length, 1);
  // with a random source that always drops, a power-up appears
  const h = new Blast({ arena: "blanket" }, () => 0.01);
  h.addSeat("a", "A");
  h.addSeat("b", "B");
  h.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) h.step();
  h.crates = [{ id: 77, x: 0, y: 0, w: 44, h: 44, kind: "crate" }];
  place(h.seats.get("a")!, 250, 250);
  place(h.seats.get("b")!, 250, -250);
  h.bombs.push(bomb("a", -60, 0, 1));
  run(h, 3);
  assert.equal(h.pickups.length, 1);
});

test("a hop dodges the ground shock; a shield takes one hit", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  place(a, 0, 0);
  place(g.seats.get("b")!, 250, 250);
  g.jump("a");
  run(g, 6);
  assert.ok(g.airborne(a));
  g.bombs.push(bomb("b", 30, 0, 1));
  const ev = run(g, 2);
  assert.equal(of(ev, "dodge").length, 1);
  assert.ok(Math.hypot(a.vx, a.vy) < 50);
  run(g, JUMP_STEPS);
  assert.ok(!g.airborne(a));
  g.pickups.push({ id: 5, kind: "shield", x: a.x, y: a.y, age: 0 });
  run(g, 2);
  assert.ok(a.shield);
  g.bombs.push(bomb("b", a.x + 30, a.y, 1));
  const ev2 = run(g, 2);
  assert.equal(of(ev2, "shield").length, 1);
  assert.ok(!a.shield);
  assert.ok(Math.hypot(a.vx, a.vy) < 50, "no knock-back");
});

test("a punch knocks back the fighter in front, and not one behind", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  const b = g.seats.get("b")!;
  place(a, 0, 0);
  place(b, PR * 2 + 6, 0);
  a.face = 0;
  g.punch("a");
  assert.ok(b.vx > 300);
  const before = b.vx;
  g.punch("a");
  assert.equal(b.vx, before, "cooldown");
  run(g, PUNCH_COOL + 1);
  place(b, -(PR * 2 + 6), 0);
  g.punch("a");
  assert.equal(b.vx, 0);
});

test("a punch bats a rolling bomb away", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(g.seats.get("a")!, 0, 0);
  place(g.seats.get("b")!, 250, 250);
  g.seats.get("a")!.face = 0;
  const b = bomb("b", 40, 0, 60);
  g.bombs.push(b);
  g.punch("a");
  assert.ok(b.vx > 400);
  assert.equal(b.owner, "a");
});

test("a fighter knocked off the edge is out, and the last one standing takes the round", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(g.seats.get("a")!, 0, 0);
  const b = g.seats.get("b")!;
  place(b, 280, 0);
  b.vx = 400;
  const ev = run(g, 40);
  assert.equal(of(ev, "fall").length, 1);
  assert.equal(g.phase, "round");
  assert.equal(g.roundWinner, "a");
  assert.equal(g.seats.get("a")!.wins, 1);
});

test("a fighter in the air over the drop does not fall until it lands", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  place(a, 275, 0);
  place(g.seats.get("b")!, -250, 250);
  g.jump("a");
  a.vx = 400;
  run(g, 10);
  assert.ok(a.alive && !g.groundAt(a.x, a.y), "still up over the drop");
  run(g, JUMP_STEPS);
  assert.ok(!a.alive, "fell on landing");
});

test("the shelf's gap can be hopped", () => {
  const g = playing(["a", "b"], 1, { arena: "shelf" });
  open(g);
  const a = g.seats.get("a")!;
  place(g.seats.get("b")!, 400, 90);
  place(a, -230, -60);
  assert.ok(g.groundAt(-230, -60) && !g.groundAt(-165, -60) && g.groundAt(-100, -60));
  a.vx = 270;
  g.jump("a");
  run(g, 34, () => g.setInput("a", 1, 0));
  assert.ok(a.alive, "crossed the gap and landed");
  assert.ok(a.x > -135);
});

test("power-ups last about ten seconds; a triple bomb is one throw of three", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = g.seats.get("a")!;
  place(a, 0, 0);
  place(g.seats.get("b")!, 250, 250);
  g.pickups.push({ id: 5, kind: "big", x: 0, y: 0, age: 0 });
  run(g, 2);
  assert.equal(a.pw, "big");
  g.throwBomb("a", Math.PI);
  assert.equal(g.bombs[0]!.kind, "big");
  const ev = run(g, 10 * 60 + 2, () => place(a, 0, 0));
  assert.equal(a.pw, null);
  assert.ok(of(ev, "powerEnd").length >= 1);
  g.pickups.push({ id: 6, kind: "triple", x: 0, y: 0, age: 0 });
  run(g, 2);
  g.bombs = [];
  a.bombCool = 0;
  g.throwBomb("a");
  assert.equal(g.bombs.length, 3);
  assert.equal(new Set(g.bombs.map((b) => b.group)).size, 1);
});

test("a sticky bomb sticks to a fighter and goes with them", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(g.seats.get("a")!, -150, 0);
  const b = g.seats.get("b")!;
  place(b, 100, 0);
  g.pickups.push({ id: 5, kind: "sticky", x: -150, y: 0, age: 0 });
  run(g, 2);
  g.seats.get("a")!.face = 0;
  g.throwBomb("a");
  run(g, 60);
  const sticky = g.bombs[0];
  assert.ok(sticky && sticky.stuck === "b");
  assert.ok(Math.hypot(sticky.x - b.x, sticky.y - b.y) < 1);
});

test("the platform crumbles after 45 s and the round ends when nothing is left", () => {
  const g = playing(["a", "b"], 1, { arena: "shelf" });
  const ev: BlastEvent[] = [];
  const keep = () => {
    for (const s of g.seats.values()) if (s.alive) place(s, s.id === "a" ? -20 : 20, 0);
  };
  ev.push(...run(g, CRUMBLE_AFTER - 80, keep));
  assert.equal(g.floorScale, 1);
  ev.push(...run(g, 80, keep));
  assert.equal(of(ev, "warn").length, 1);
  assert.ok(g.floorScale < 1);
  assert.ok(g.crates.every((c) => g.groundAt(c.x, c.y)));
  ev.push(...run(g, CRUMBLE_EVERY * 9 + 60, keep));
  assert.equal(g.phase, "round");
  assert.equal(g.roundWinner, null, "a draw");
});

test("a team brawl: the round goes to the last team, wins count for the team", () => {
  const g = playing(["a", "b", "c", "d"], 3, { mode: "team", arena: "blanket" });
  open(g);
  const seats = [...g.seats.values()];
  assert.deepEqual(seats.map((s) => s.team).sort(), [0, 0, 1, 1]);
  const t0 = seats.filter((s) => s.team === 0);
  const t1 = seats.filter((s) => s.team === 1);
  t0.forEach((s, i) => place(s, -100 + i * 60, 0));
  t1.forEach((s, i) => {
    place(s, 275, 100 + i * 60);
    s.vx = 500;
  });
  run(g, 50);
  assert.equal(g.phase, "round");
  assert.equal(g.roundTeam, 0);
  assert.deepEqual(g.teamWins, [1, 0]);
});

test("a match ends when someone has the wins, and restarts", () => {
  const g = playing(["a", "b"], 2, { wins: 3, arena: "blanket" });
  for (let r = 0; r < 3; r++) {
    open(g);
    place(g.seats.get("a")!, 0, 0);
    const b = g.seats.get("b")!;
    place(b, 285, 0);
    b.vx = 500;
    run(g, 40);
    assert.equal(g.phase, "round");
    run(g, ROUND_STEPS + 1);
    if (r < 2) {
      assert.equal(g.phase, "count");
      for (let i = 0; i < COUNT_STEPS; i++) g.step();
    }
  }
  assert.equal(g.phase, "match");
  assert.equal(g.winner, "a");
  g.startMatch();
  assert.equal(g.phase, "count");
  assert.equal(g.seats.get("a")!.wins, 0);
});

test("a fighter who leaves mid-round voids a two-fighter round", () => {
  const g = playing(["a", "b"]);
  g.removeSeat("b");
  assert.equal(g.phase, "round");
  assert.equal(g.roundWinner, null);
});

test("the same seed plays the same game", () => {
  const trace = (seed: number) => {
    const g = new Blast({}, seeded(seed));
    const bots = createBots(g, seeded(seed + 1));
    bots.setCount(4);
    g.startMatch();
    let h = 0;
    for (let i = 0; i < 3600; i++) {
      bots.step();
      g.step();
      g.drainEvents();
      for (const s of g.seats.values()) h = (h * 31 + Math.round(s.x * 10) + Math.round(s.y * 7)) | 0;
    }
    return h;
  };
  assert.equal(trace(5), trace(5));
  assert.notEqual(trace(5), trace(6));
});

test("bots play a whole match to a winner in a sensible time, in every mode", () => {
  for (const [mode, n] of [["ffa", 4], ["ffa", 2], ["team", 4], ["ffa", 8]] as const) {
    const g = new Blast({ mode, wins: 3 }, seeded(7));
    const bots = createBots(g, seeded(8));
    bots.setCount(n);
    g.startMatch();
    let steps = 0;
    let blasts = 0;
    while (g.phase !== "match" && steps < 60 * 60 * 15) {
      bots.step();
      g.step();
      steps++;
      for (const e of g.drainEvents()) if (e.type === "blast") blasts++;
    }
    assert.equal(g.phase, "match", `${mode}/${n}: finished`);
    assert.ok(steps / 3600 > 0.6 && steps / 3600 < 12, `${mode}/${n}: ${(steps / 3600).toFixed(1)} min`);
    assert.ok(blasts >= 6, "bots do throw bombs");
  }
});
