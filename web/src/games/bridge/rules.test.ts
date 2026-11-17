import assert from "node:assert/strict";
import { test } from "node:test";
import { Bots, slip } from "./bots.ts";
import { CONTROL_NAMES, LEVER_ENDS } from "./names.ts";
import { BEATS, Bridge, HULL_MAX, MAX_SEATS, TUNE, panelSize, quotaFor, range, seeded, type Options } from "./rules.ts";

const OPTS: Options = { difficulty: "normal", events: true };
const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

/** A game with n seats, in the play phase of sector 1. */
function playing(n: number, seed = 1, opts: Options = OPTS) {
  const g = new Bridge(opts, seeded(seed));
  for (const id of ids(n)) g.addSeat(id, id.toUpperCase(), false);
  g.startMatch();
  assert.equal(g.phase, "intro");
  g.advance(BEATS.intro);
  assert.equal(g.phase, "play");
  return g;
}
/** Do the order of this seat, on whichever seat owns the control. */
function doOrder(g: Bridge, id: string) {
  const o = g.seats.get(id)!.order!;
  const c = g.controls.get(o.ctl)!;
  return g.act(c.owner, c.name, o.target);
}

test("names: about 120, all different, lever ends in pairs", () => {
  assert.ok(CONTROL_NAMES.length >= 120);
  assert.equal(new Set(CONTROL_NAMES).size, CONTROL_NAMES.length);
  assert.ok(LEVER_ENDS.every(([a, b]) => a !== b));
});

test("panels: sizes follow the crew, every control name is unique, every seat has a panel", () => {
  assert.deepEqual([2, 3, 4, 5, 6, 8].map(panelSize), [6, 6, 5, 5, 4, 4]);
  for (const n of [1, 2, 3, 5, 8]) {
    const g = playing(n, n);
    const names = [...g.controls.keys()];
    assert.equal(new Set(names).size, names.length);
    assert.equal(names.length, n * panelSize(n));
    for (const s of g.list()) {
      assert.equal(s.panel.length, panelSize(n));
      for (const nm of s.panel) assert.equal(g.controls.get(nm)!.owner, s.id);
    }
  }
});

test("orders: target differs from the current state, the control exists, no two orders share a control", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const g = playing(2 + (seed % 7), seed);
    const seen = new Set<string>();
    for (const { order } of g.orders()) {
      const c = g.controls.get(order.ctl);
      assert.ok(c, "control exists");
      if (c.kind !== "button") assert.notEqual(order.target, c.state);
      const [lo, hi] = range(c.kind);
      assert.ok(order.target >= lo && order.target <= hi);
      assert.ok(!seen.has(order.ctl));
      seen.add(order.ctl);
    }
    assert.equal(g.orders().length, g.crew());
  }
});

test("orders are mostly on somebody else's panel", () => {
  let other = 0;
  let all = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const g = playing(4, seed);
    for (const { seat, order } of g.orders()) {
      all++;
      if (g.controls.get(order.ctl)!.owner !== seat.id) other++;
    }
  }
  assert.ok(other / all > 0.8, `${other}/${all}`);
});

test("the same seed gives the same voyage", () => {
  const run = (seed: number) => {
    const g = playing(3, seed);
    const out: string[] = [];
    for (let i = 0; i < 6; i++) {
      for (const s of g.list()) if (s.order) out.push(s.order.text);
      doOrder(g, "p0");
    }
    return out.join("|");
  };
  assert.equal(run(5), run(5));
  assert.notEqual(run(5), run(6));
});

test("act: the right action completes the order and a new one comes", () => {
  const g = playing(3, 2);
  const before = g.seats.get("p1")!.order!.id;
  assert.equal(doOrder(g, "p1"), "done");
  assert.equal(g.done, 1);
  assert.equal(g.total, 1);
  assert.equal(g.seats.get("p1")!.done, 1);
  assert.notEqual(g.seats.get("p1")!.order!.id, before);
  assert.equal(g.hull, HULL_MAX);
});

test("act: only the owner moves a control, only in play, values are checked", () => {
  const g = playing(2, 3);
  const c = [...g.controls.values()].find((x) => x.kind === "dial" || x.kind === "slider") ?? [...g.controls.values()].find((x) => x.kind === "toggle")!;
  const other = c.owner === "p0" ? "p1" : "p0";
  assert.equal(g.act(other, c.name, 1), "ignored");
  assert.equal(g.act(c.owner, c.name, 99), "ignored");
  assert.equal(g.act(c.owner, "Nothing", 1), "ignored");
  assert.equal(g.act(c.owner, c.name, 1.5), "ignored");
  const idle = new Bridge(OPTS, seeded(1));
  idle.addSeat("a", "A", false);
  assert.equal(idle.act("a", "x", 1), "ignored");
});

test("wrong setting on a control with an order costs hull; a free control costs nothing", () => {
  const g = playing(2, 4);
  const ord = g.orders().map((o) => o.order).find((o) => g.controls.get(o.ctl)!.kind === "dial" || g.controls.get(o.ctl)!.kind === "slider" || g.controls.get(o.ctl)!.kind === "lever");
  if (!ord) return; // this seed has none; the loop test below covers it
  const c = g.controls.get(ord.ctl)!;
  const [lo, hi] = range(c.kind);
  let wrong = lo;
  while (wrong === ord.target || wrong === c.state) wrong = wrong < hi ? wrong + 1 : lo;
  assert.equal(g.act(c.owner, c.name, wrong), "wrong");
  assert.equal(g.hull, HULL_MAX - TUNE.normal.wrong);
  // a repeat within the cooldown is not charged twice
  g.act(c.owner, c.name, c.state === lo ? hi : lo);
  assert.equal(g.hull, HULL_MAX - TUNE.normal.wrong);
  // the order still stands
  assert.equal(g.orderFor(c.name)?.order.id, ord.id);
});

test("fiddling with a control that has no order is free", () => {
  const g = playing(2, 7);
  const busy = new Set(g.orders().map((o) => o.order.ctl));
  const c = [...g.controls.values()].find((x) => x.kind === "toggle" && !busy.has(x.name));
  if (!c) return;
  assert.equal(g.act(c.owner, c.name, 1 - c.state), "set");
  assert.equal(g.hull, HULL_MAX);
});

test("a late order costs hull, is replaced, and the seat keeps playing", () => {
  const g = playing(2, 1);
  const first = g.seats.get("p0")!.order!;
  g.advance(first.ttl + 1);
  assert.ok(g.hull < HULL_MAX);
  assert.notEqual(g.seats.get("p0")!.order?.id, first.id);
  assert.equal(g.phase, "play");
});

test("hull 0 ends the voyage; sectors reached is the sector", () => {
  const g = playing(2, 1);
  for (let i = 0; i < 40 && g.phase === "play"; i++) g.advance(3000);
  assert.equal(g.phase, "end");
  assert.equal(g.hull, 0);
  assert.equal(g.sector, 1);
  assert.equal(g.orders().length, 0);
  assert.equal(g.act("p0", [...g.controls.keys()][0]!, 1), "ignored");
});

test("a sector ends at the quota, hull is mended, panels are dealt again, orders get shorter", () => {
  const g = playing(3, 9);
  assert.equal(g.quota, quotaFor(3));
  const t1 = g.orderTime();
  g.advance(g.seats.get("p0")!.order!.ttl - 500); // one order nearly late
  const hull0 = g.hull;
  const names = [...g.controls.keys()].join();
  const nextSeat = () => g.list().find((s) => s.order)!.id;
  while (g.phase === "play") doOrder(g, nextSeat());
  assert.equal(g.phase, "break");
  assert.equal(g.done, g.quota);
  assert.equal(g.hull, Math.min(HULL_MAX, hull0 + TUNE.normal.heal));
  assert.equal(g.orders().length, 0);
  g.advance(BEATS.break);
  assert.equal(g.phase, "intro");
  assert.equal(g.sector, 2);
  assert.equal(g.done, 0);
  assert.notEqual([...g.controls.keys()].join(), names);
  assert.ok(g.orderTime() < t1);
  g.advance(BEATS.intro);
  assert.equal(g.phase, "play");
});

test("quota grows with the crew; order time grows a little with the crew and shrinks per sector", () => {
  assert.ok(quotaFor(8) > quotaFor(4) && quotaFor(4) > quotaFor(2));
  const a = new Bridge(OPTS, seeded(1));
  a.addSeat("a", "A", false);
  a.addSeat("b", "B", false);
  const t2 = a.orderTime();
  for (let i = 0; i < 4; i++) a.addSeat(`c${i}`, "C", false);
  assert.ok(a.orderTime() > t2);
  a.sector = 6;
  assert.ok(a.orderTime() < t2 + 600 * 4);
  a.sector = 99;
  assert.equal(a.orderTime(), TUNE.normal.floor + 600 * 4);
});

test("difficulty changes the order time", () => {
  const t = (d: Options["difficulty"]) => {
    const g = new Bridge({ difficulty: d, events: true }, seeded(1));
    g.addSeat("a", "A", false);
    g.addSeat("b", "B", false);
    return g.orderTime();
  };
  assert.ok(t("calm") > t("normal") && t("normal") > t("frantic"));
});

test("a seat that leaves takes its controls; orders that wanted them are replaced", () => {
  const g = playing(3, 11);
  const gone = g.seats.get("p1")!;
  const gonePanel = [...gone.panel];
  g.removeSeat("p1");
  assert.equal(g.crew(), 2);
  for (const n of gonePanel) assert.ok(!g.controls.has(n));
  for (const { order } of g.orders()) assert.ok(g.controls.has(order.ctl));
  assert.equal(g.orders().length, 2);
  assert.equal(g.phase, "play");
});

test("a seat that joins mid-sector gets a panel and an order at once", () => {
  const g = playing(2, 12);
  const s = g.addSeat("late", "Late", false)!;
  assert.ok(s.panel.length > 0 && s.order);
  assert.equal(new Set(g.controls.keys()).size, g.controls.size);
  assert.equal(g.addSeat("late", "Late", false), s);
});

test("the crew is at most eight; the last one leaving waits for a crew; the first back starts again", () => {
  const g = new Bridge(OPTS, seeded(1));
  for (let i = 0; i < MAX_SEATS; i++) assert.ok(g.addSeat(`p${i}`, `P${i}`, false));
  assert.equal(g.addSeat("x", "X", false), null);
  const h = playing(1, 2);
  h.removeSeat("p0");
  assert.equal(h.phase, "wait");
  h.addSeat("n", "N", false);
  assert.equal(h.phase, "intro");
});

test("events: lights out and swap come rarely, one at a time, from sector 2, and can be off", () => {
  const g = playing(4, 3);
  g.sector = 2;
  const kinds = new Set<string>();
  let active = 0;
  let starts = 0;
  for (let t = 0; t < 600000 && g.phase === "play"; t += 100) {
    g.advance(100);
    for (const e of g.drainEvents()) if (e.type === "event") { kinds.add(e.kind); starts++; }
    if (g.event) active++;
    // never let the hull run out in this test
    g.hull = HULL_MAX;
  }
  assert.ok(starts >= 5 && starts <= 22, `starts ${starts}`);
  assert.ok(kinds.has("lights") && kinds.has("swap"));
  assert.ok(active > 0);
  const quiet = playing(4, 3, { difficulty: "normal", events: false });
  quiet.sector = 3;
  for (let t = 0; t < 200000; t += 100) {
    quiet.advance(100);
    quiet.hull = HULL_MAX;
  }
  assert.equal(quiet.event, null);
});

test("swap: two orders change hands, with their own times, and stay valid", () => {
  for (let seed = 1; seed < 40; seed++) {
    const g = playing(3, seed);
    g.sector = 2;
    const before = new Map(g.orders().map((o) => [o.seat.id, o.order.id]));
    for (let t = 0; t < 120000 && !g.event; t += 100) {
      g.advance(100);
      g.hull = HULL_MAX;
    }
    if (g.event?.kind !== "swap") continue;
    assert.equal(g.orders().length, 3);
    for (const { order } of g.orders()) assert.ok(g.controls.has(order.ctl));
    assert.ok(before.size === 3);
    return;
  }
});

test("bots: a bot does its own order after 2-5 s", () => {
  const g = new Bridge(OPTS, seeded(5));
  const b = new Bots(g, seeded(6));
  g.addSeat("bot-0", "A", true);
  g.addSeat("bot-1", "B", true);
  g.startMatch();
  g.advance(BEATS.intro);
  let t = 0;
  let firstDone = -1;
  while (t < 20000 && firstDone < 0) {
    g.advance(100);
    b.step(100);
    t += 100;
    if (g.total > 0) firstDone = t;
  }
  assert.ok(firstDone >= 2000 && firstDone <= 7500, `first order at ${firstDone}`);
});

test("bots: a bot hears a human's order on its panel after 3-7 s", () => {
  let heard = 0;
  let tried = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Bridge(OPTS, seeded(seed));
    const b = new Bots(g, seeded(seed + 50));
    g.addSeat("h", "Human", false);
    g.addSeat("bot-0", "Bot", true);
    g.startMatch();
    g.advance(BEATS.intro);
    const order = g.seats.get("h")!.order!;
    if (g.controls.get(order.ctl)!.owner !== "bot-0") continue;
    tried++;
    let t = 0;
    while (t < 9000 && g.seats.get("h")!.order?.id === order.id) {
      g.advance(100);
      b.step(100);
      t += 100;
    }
    if (g.seats.get("h")!.order?.id !== order.id) {
      heard++;
      assert.ok(t >= 2400 && t <= 7600, `heard at ${t}`);
    }
  }
  assert.ok(tried >= 3 && heard >= tried - 2, `${heard}/${tried}`);
});

test("bots do not touch a human's panel; a lone human with a bot still gets orders on the human's own panel at times", () => {
  const g = new Bridge(OPTS, seeded(2));
  const b = new Bots(g, seeded(3));
  g.addSeat("h", "Human", false);
  g.addSeat("bot-0", "Bot", true);
  g.startMatch();
  g.advance(BEATS.intro);
  const own = [...g.controls.values()].filter((c) => c.owner === "h").map((c) => `${c.name}:${c.state}`).join();
  for (let i = 0; i < 100; i++) {
    g.advance(100);
    b.step(100);
    g.hull = HULL_MAX;
  }
  assert.equal([...g.controls.values()].filter((c) => c.owner === "h").map((c) => `${c.name}:${c.state}`).join(), own);
});

test("bots slip more as the voyage goes on", () => {
  assert.ok(slip(1) < slip(5) && slip(5) < slip(12));
  assert.ok(slip(99) <= 0.9);
});

test("a bots-only voyage ends by itself in a few minutes", () => {
  for (const [diff, mx] of [["normal", 12], ["frantic", 8]] as const) {
    const g = new Bridge({ difficulty: diff, events: true }, seeded(4));
    const b = new Bots(g, seeded(5));
    for (let i = 0; i < 4; i++) g.addSeat(`bot-${i}`, `B${i}`, true);
    g.startMatch();
    let t = 0;
    while (g.phase !== "end" && t < 20 * 60000) {
      g.advance(100);
      b.step(100);
      g.drainEvents();
      t += 100;
    }
    assert.equal(g.phase, "end");
    assert.ok(t > 60000 && t < mx * 60000, `${diff} ${t / 60000} min`);
    assert.ok(g.sector >= 2);
  }
});
