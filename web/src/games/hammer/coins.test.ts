import assert from "node:assert/strict";
import { test } from "node:test";
import { Coins, type Pickup } from "./coins.ts";
import { Arena } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";

test("coins: only heavy hits (over 12 damage) spill, in proportion to the damage, at most 30, and they fly up", () => {
  const c = new Coins(960, 540);
  assert.equal(c.spill(400, 300, 12), 0);
  assert.equal(c.spill(400, 300, 13), 5);
  assert.equal(c.spill(400, 300, 40), 16);
  assert.equal(c.spill(400, 300, 200), 30);
  for (const k of c.list) assert.ok(k.vy < 0);
});

test("coins: the cap drops the oldest, they fall out of the frame, and a machine picks them up", () => {
  const c = new Coins(960, 540, 10);
  c.spill(100, 300, 200);
  assert.equal(c.list.length, 10);
  const out: Pickup[] = [];
  for (let i = 0; i < 400; i++) c.update(0.02, [], out);
  assert.equal(c.list.length, 0);
  const a = new Arena({ ...DEFAULT_TUNING });
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", x: 500, y: 200 });
  c.clear();
  c.spill(500, 200, 25);
  c.update(0.02, [m], out);
  assert.equal(out.length, 0, "no pickup in the first 0.3 s");
  for (const k of c.list) {
    k.x = m.hull.x;
    k.y = m.hull.y;
    k.vx = k.vy = 0;
    k.age = 1;
  }
  c.update(0.001, [m], out);
  assert.equal(out.length, 10);
  assert.equal(c.list.length, 0);
});

test("coins: the held weapon picks coins up too", () => {
  const c = new Coins(960, 540);
  const a = new Arena({ ...DEFAULT_TUNING });
  const m = a.add({ id: 1, name: "A", color: "#f00", weapon: "hammer", x: 300, y: 200 });
  const head = m.parts[m.parts.length - 1]!;
  assert.ok(Math.hypot(head.x - m.hull.x, head.y - m.hull.y) > 40, "the head is well away from the hull");
  c.spill(head.x, head.y, 25);
  for (const k of c.list) {
    k.x = head.x;
    k.y = head.y;
    k.vx = k.vy = 0;
    k.age = 1;
  }
  const out: Pickup[] = [];
  c.update(0.001, [m], out);
  assert.equal(out.length, 10);
});
