import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots } from "./bots.ts";
import {
  BODY_R, COUNT_STEPS, DASH_COOL, MAX_SEATS, PULL_STEPS, RINGS, ROUND_STEPS, SHRINK_AFTER, SHRINK_EVERY, SHRINK_MIN,
  Shove, seeded, type Seat, type ShoveEvent,
} from "./rules.ts";

/** A game with these wrestlers, already playing. */
function playing(ids: string[], seed = 1, opts: Partial<ConstructorParameters<typeof Shove>[0]> = {}) {
  const g = new Shove(opts, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
  g.drainEvents();
  return g;
}
const place = (s: Seat, x: number, y: number) => Object.assign(s, { x, y, px: x, py: y, vx: 0, vy: 0 });
const run = (g: Shove, steps: number, each?: () => void) => {
  const ev: ShoveEvent[] = [];
  for (let i = 0; i < steps; i++) {
    each?.();
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};
const of = <T extends ShoveEvent["type"]>(ev: ShoveEvent[], type: T) => ev.filter((e) => e.type === type) as Extract<ShoveEvent, { type: T }>[];

test("the stick accelerates a wrestler with momentum, and drag stops it", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, -100, 0);
  place(b!, 0, 250);
  g.setInput("a", 1, 0);
  run(g, 6);
  const early = a!.vx;
  run(g, 30);
  assert.ok(a!.vx > early * 3, "keeps speeding up");
  g.setInput("a", 0, 0);
  const v0 = a!.vx;
  run(g, 10);
  assert.ok(a!.vx > 0 && a!.vx < v0, "slides on and slows down");
  run(g, 120);
  assert.ok(Math.abs(a!.vx) < 10, "comes to rest");
});

test("the stick is clamped to length 1, and junk input counts as released", () => {
  const g = playing(["a", "b"]);
  g.setInput("a", 5, 5);
  const a = g.seats.get("a")!;
  assert.ok(Math.abs(Math.hypot(a.ix, a.iy) - 1) < 1e-9);
  g.setInput("a", NaN, 1);
  assert.equal(a.ix, 0);
  assert.equal(a.iy, 0);
});

test("a dash that lands hands over most of the momentum: the target leaves faster than the dasher", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, -150, 0);
  place(b!, 0, 0);
  g.setInput("a", 1, 0);
  g.dash("a");
  const ev = run(g, 12);
  const hit = of(ev, "hit").find((h) => h.dash);
  assert.ok(hit, "the dash landed");
  assert.ok(b!.vx > 300, `target flies off (${b!.vx.toFixed(0)})`);
  assert.ok(b!.vx > a!.vx * 4, `dasher keeps little (${a!.vx.toFixed(0)} vs ${b!.vx.toFixed(0)})`);
  assert.ok(b!.stun > 0, "the target is knocked off balance");
  assert.equal(a!.dashT, 0, "the dash ends on contact");
});

test("a plain bump is soft: the pushed one barely bounces", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, -BODY_R * 2 - 1, 0);
  place(b!, 0, 0);
  a!.vx = 200;
  run(g, 3);
  assert.ok(b!.vx > 0 && b!.vx < 200);
  assert.ok(a!.vx > 0, "the bumper keeps going forward a little");
});

test("dash has a cooldown of 1.5 s, enforced by the rules", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, -200, -200);
  place(b!, 200, 200);
  g.setInput("a", 1, 0);
  g.dash("a");
  let ev = run(g, 2);
  g.setInput("a", 0, 0);
  assert.equal(of(ev, "dash").length, 1);
  assert.ok(DASH_COOL === 90);
  g.dash("a");
  ev = run(g, 30);
  assert.equal(of(ev, "dash").length, 0, "no second dash while cooling down");
  run(g, DASH_COOL);
  g.dash("a");
  ev = run(g, 2);
  assert.equal(of(ev, "dash").length, 1);
});

test("a missed dash near the rope carries the dasher out", () => {
  const g = playing(["a", "b", "c"]);
  const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
  place(a!, RINGS.normal - 150, 0);
  place(b!, -200, 0);
  place(c!, 0, -200);
  g.setInput("a", 1, 0);
  g.dash("a");
  g.setInput("a", 0, 0);
  const ev = run(g, 60);
  const out = of(ev, "out");
  assert.equal(out.length, 1);
  assert.equal(out[0]!.id, "a");
  assert.equal(a!.alive, false);
});

test("ring-out: a centre past the rope is out, and the last one inside takes the round", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, RINGS.normal - 5, 0);
  a!.vx = 300;
  place(b!, 0, 0);
  const ev = run(g, 10);
  assert.equal(of(ev, "out")[0]?.id, "a");
  const r = of(ev, "round");
  assert.equal(r.length, 1);
  assert.equal(r[0]!.winner, "b");
  assert.equal(b!.wins, 1);
  assert.equal(g.phase, "round");
});

test("the one who did the pushing is named on the ring-out", () => {
  const g = playing(["a", "b", "c"]);
  const [a, b, c] = ["a", "b", "c"].map((id) => g.seats.get(id)!);
  place(a!, 150, 0);
  place(b!, 300, 0);
  place(c!, -300, 0);
  g.setInput("a", 1, 0);
  g.dash("a");
  const ev = run(g, 90);
  const out = of(ev, "out").find((o) => o.id === "b");
  assert.ok(out, "b went out");
  assert.equal(out!.by, "a");
});

test("bracing at the rope: holding still makes you harder to move", () => {
  const push = (brace: boolean) => {
    const g = playing(["a", "b"]);
    const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
    place(b!, RINGS.normal - BODY_R * 1.5, 0);
    place(a!, b!.x - BODY_R * 2 - 40, 0);
    // b holds still (brace) or leans a little sideways (no brace)
    g.setInput("b", 0, brace ? 0 : 0.3);
    run(g, 2);
    assert.equal(b!.braced, brace);
    a!.vx = 300;
    run(g, 30);
    return b!.x;
  };
  const braced = push(true);
  const loose = push(false);
  assert.ok(braced < loose - 5, `braced slid less (${braced.toFixed(0)} vs ${loose.toFixed(0)})`);
});

test("the ring shrinks after 20 s of play, one short rope pull at a time, down to its minimum", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  const keep = () => {
    place(a!, -10, 0);
    place(b!, 70, 0);
  };
  let ev = run(g, SHRINK_AFTER - 1, keep);
  assert.equal(of(ev, "shrink").length, 0);
  assert.equal(g.ringR, RINGS.normal);
  ev = run(g, 1, keep);
  const s = of(ev, "shrink");
  assert.equal(s.length, 1);
  assert.ok(s[0]!.to < s[0]!.from);
  run(g, PULL_STEPS, keep);
  assert.ok(Math.abs(g.ringR - s[0]!.to) < 1e-6, "the pull is over");
  let min: number = g.ringR;
  ev = [];
  while (g.phase === "play") {
    ev.push(...run(g, 1, () => {
      place(a!, -5, 0);
      place(b!, 5, 0);
    }));
    min = Math.min(min, g.ringR);
  }
  assert.ok(of(ev, "shrink").length >= 5, "pulled several times");
  assert.ok(min >= RINGS.normal * SHRINK_MIN - 1e-6, "never below the minimum");
  assert.equal(of(ev, "round").length, 1, "two can't both stay in the smallest ring");
});

test("when everyone left goes out together, the one nearest the middle stays in and wins", () => {
  const g = playing(["a", "b"]);
  const [a, b] = ["a", "b"].map((id) => g.seats.get(id)!);
  place(a!, RINGS.normal + 4, 0);
  place(b!, -RINGS.normal - 8, 0);
  const ev = run(g, 1);
  assert.equal(of(ev, "round")[0]?.winner, "a");
  assert.equal(a!.alive, true);
});

test("first to the wins setting takes the match, then a restart begins again", () => {
  const g = playing(["a", "b"], 3, { wins: 3 });
  for (let r = 0; r < 3; r++) {
    if (g.phase !== "play") {
      run(g, ROUND_STEPS + COUNT_STEPS + 2);
    }
    assert.equal(g.phase, "play");
    const b = g.seats.get("b")!;
    place(b, RINGS.normal + 10, 0);
    run(g, 2);
  }
  run(g, ROUND_STEPS + 2);
  assert.equal(g.phase, "match");
  assert.equal(g.winner, "a");
  assert.equal(g.seats.get("a")!.wins, 3);
  g.startMatch();
  assert.equal(g.phase, "count");
  assert.equal(g.seats.get("a")!.wins, 0);
});

test("a newcomer waits for the next round; one who joins early in the count is placed at once", () => {
  const g = new Shove({}, seeded(2));
  g.addSeat("a", "A");
  g.addSeat("b", "B");
  g.startMatch();
  run(g, 10);
  g.addSeat("c", "C");
  assert.equal(g.admitLate(), true);
  assert.equal(g.seats.get("c")!.inRound, true);
  run(g, COUNT_STEPS + 5);
  g.addSeat("d", "D");
  assert.equal(g.admitLate(), false);
  assert.equal(g.seats.get("d")!.inRound, false);
  assert.equal(g.phase, "play");
});

test("leaving mid-round never crashes the round; two left on the sand play on, one left voids it", () => {
  const g = playing(["a", "b", "c"]);
  g.removeSeat("c");
  assert.equal(g.phase, "play");
  const ev = run(g, 1);
  g.removeSeat("b");
  const all = [...ev, ...g.drainEvents()];
  const r = of(all, "round");
  assert.equal(r.length, 1);
  assert.equal(r[0]!.winner, null, "nobody wins by default");
  assert.equal(g.seats.get("a")!.wins, 0);
});

test("eight seats at most", () => {
  const g = new Shove();
  for (let i = 0; i < MAX_SEATS; i++) assert.ok(g.addSeat(`p${i}`, `P${i}`));
  assert.equal(g.addSeat("x", "X"), null);
});

test("the same seed replays the same match", () => {
  const log = (seed: number) => {
    const g = new Shove({}, seeded(seed));
    const bots = createBots(g, seeded(seed + 100));
    bots.setCount(5);
    g.startMatch();
    const out: string[] = [];
    for (let i = 0; i < 60 * 90; i++) {
      bots.step();
      g.step();
      for (const e of g.drainEvents()) if (e.type === "out" || e.type === "round") out.push(JSON.stringify(e));
    }
    return out.join("\n");
  };
  const a = log(7);
  assert.ok(a.length > 0);
  assert.equal(a, log(7));
  assert.notEqual(a, log(8));
});

test("bots-only matches always finish, with rounds of a sensible length", () => {
  for (const n of [2, 4, 8]) {
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Shove({ wins: 3 }, seeded(seed));
      const bots = createBots(g, seeded(seed * 13));
      bots.setCount(n);
      g.startMatch();
      let steps = 0;
      let longest = 0;
      let playT = 0;
      while (g.phase !== "match" && steps < 60 * 60 * 15) {
        bots.step();
        g.step();
        steps++;
        if (g.phase === "play") playT = g.t;
        for (const e of g.drainEvents()) if (e.type === "round") longest = Math.max(longest, playT);
      }
      assert.equal(g.phase, "match", `${n} bots, seed ${seed}`);
      assert.ok(longest < 60 * 60, `rounds stay under a minute (${(longest / 60).toFixed(0)} s)`);
      assert.equal(g.standings()[0]!.wins, 3);
    }
  }
});

test("bots don't just stand there: they dash, land hits and push others out", () => {
  const g = new Shove({}, seeded(4));
  const bots = createBots(g, seeded(5));
  bots.setCount(4);
  g.startMatch();
  const ev = run(g, 60 * 40, () => bots.step());
  assert.ok(of(ev, "dash").length > 10);
  assert.ok(of(ev, "hit").filter((h) => h.dash).length > 5);
  assert.ok(of(ev, "out").some((o) => o.by), "someone was pushed out");
});
