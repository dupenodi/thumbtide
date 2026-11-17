import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots, placements } from "./bots.ts";
import {
  Bag, COLS, COUNT_STEPS, H, HIDDEN, KINDS, PAPER, PAPER_LIFE, ROUND_STEPS, Stack, TURNS, fits, seeded, spawnOf,
  stackHeight, type Seat, type StackEvent,
} from "./rules.ts";

/** A game with these wells, already playing (the first pieces are out). */
function playing(ids: string[], seed = 1, wins = 3) {
  const g = new Stack({ wins }, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
  g.drainEvents();
  return g;
}
const seat = (g: Stack, id: string) => g.seats.get(id)!;
/** Fills grid row y (0 = top of the spare rows) except the listed columns. */
const fillRow = (s: Seat, y: number, gaps: number[] = [], v = 1) => {
  for (let x = 0; x < COLS; x++) s.grid[y * COLS + x] = gaps.includes(x) ? 0 : v;
};
const setPiece = (s: Seat, kind: (typeof KINDS)[number], rot: number, x: number, y: number) => {
  s.piece = { kind, rot, x, y };
};
const of = <T extends StackEvent["type"]>(ev: StackEvent[], t: T) => ev.filter((e) => e.type === t) as Extract<StackEvent, { type: T }>[];

test("every piece has 3 to 5 cells, four turns of the same size, and none is a classic four-cell line", () => {
  for (const k of KINDS) {
    const n = TURNS[k][0]!.length;
    assert.ok(n >= 3 && n <= 5, k);
    for (const t of TURNS[k]) assert.equal(t.length, n);
  }
  assert.ok(!KINDS.some((k) => TURNS[k][0]!.length === 4 && new Set(TURNS[k][0]!.map(([, y]) => y)).size === 1));
});

test("the same seed gives the same pieces; a bag of nine holds each kind", () => {
  const a = new Bag(seeded(7));
  const b = new Bag(seeded(7));
  const sa = Array.from({ length: 27 }, () => a.take());
  const sb = Array.from({ length: 27 }, () => b.take());
  assert.deepEqual(sa, sb);
  for (const k of KINDS) assert.ok(sa.slice(0, 9).includes(k));
});

test("every well in a round gets the same piece sequence", () => {
  const g = playing(["a", "b", "c"], 4);
  const ks = ["a", "b", "c"].map((id) => [seat(g, id).piece!.kind, seat(g, id).next]);
  assert.deepEqual(ks[0], ks[1]);
  assert.deepEqual(ks[1], ks[2]);
});

test("pieces spawn at the top of the visible rows, centred, and fall with gravity", () => {
  const g = playing(["a"]);
  const s = seat(g, "a");
  const p = s.piece!;
  const top = Math.min(...TURNS[p.kind][p.rot]!.map(([, y]) => p.y + y));
  assert.equal(top, HIDDEN);
  const y0 = p.y;
  for (let i = 0; i < 60; i++) g.step();
  assert.ok(s.piece!.y > y0);
});

test("left, right and rotate move the piece; walls block, and a blocked turn kicks", () => {
  const g = playing(["a"]);
  const s = seat(g, "a");
  setPiece(s, "I3", 1, 0, 8); // upright line in column 1
  assert.ok(g.input("a", "left"));
  assert.equal(s.piece!.x, -1);
  assert.equal(g.input("a", "left"), false);
  // turning flat against the left wall kicks it right
  assert.ok(g.input("a", "rotate"));
  assert.ok(TURNS.I3[s.piece!.rot]!.every(([x]) => s.piece!.x + x >= 0));
});

test("moves are ignored outside play and for wells that are out", () => {
  const g = new Stack({}, seeded(1));
  g.addSeat("a", "A");
  g.startMatch();
  assert.equal(g.phase, "count");
  assert.equal(g.input("a", "left"), false);
  const p = playing(["a", "b"]);
  seat(p, "b").alive = false;
  assert.equal(p.input("b", "drop"), false);
});

test("a hard drop locks at once; a full row clears and everything above drops one row", () => {
  const g = playing(["a"]);
  const s = seat(g, "a");
  fillRow(s, H - 1, [0, 1, 2]);
  s.grid[(H - 2) * COLS + 5] = 1;
  setPiece(s, "I3", 0, 0, 5); // flat line over columns 0–2
  g.input("a", "drop");
  const ev = g.drainEvents();
  const c = of(ev, "clear");
  assert.equal(c.length, 1);
  assert.deepEqual(c[0]!.rows, [H - 1]);
  assert.equal(c[0]!.cells[0]!.length, COLS);
  assert.ok(s.grid[(H - 1) * COLS + 5]); // the block above fell into the bottom row
  assert.equal(s.lines, 1);
  assert.equal(s.piece, null);
});

test("a resting piece locks after the lock delay", () => {
  const g = playing(["a"]);
  const s = seat(g, "a");
  setPiece(s, "O4", 0, 3, H - 2);
  let locked = false;
  for (let i = 0; i < 40 && !locked; i++) {
    g.step();
    locked = of(g.drainEvents(), "lock").length > 0;
  }
  assert.ok(locked);
});

test("a clear sends paper to the opponent with the lowest stack", () => {
  const g = playing(["a", "b", "c"]);
  const a = seat(g, "a");
  // b is tall, c is low: c is hit
  for (let y = H - 8; y < H; y++) fillRow(seat(g, "b"), y, [4]);
  fillRow(seat(g, "c"), H - 1, [4]);
  fillRow(a, H - 1, [0, 1, 2]);
  fillRow(a, H - 2, [0, 1, 2]);
  setPiece(a, "O4", 0, 0, 5);
  // a 2×2 fills two of the three gaps: no clear yet, then a line finishes both rows
  for (let y = H - 2; y < H; y++) a.grid[y * COLS + 2] = 1;
  g.input("a", "drop");
  const ev = g.drainEvents();
  const at = of(ev, "attack");
  assert.equal(at.length, 1);
  assert.equal(at[0]!.to, "c");
  assert.equal(at[0]!.n, 2);
  assert.deepEqual(seat(g, "c").incoming, [2]);
});

test("ties go to the next seat after the sender", () => {
  const g = playing(["a", "b", "c"]);
  assert.equal(g.targetOf(seat(g, "b"))!.id, "c");
  assert.equal(g.targetOf(seat(g, "c"))!.id, "a");
  seat(g, "a").alive = false;
  assert.equal(g.targetOf(seat(g, "c"))!.id, "b");
});

test("waiting paper slides in on a lock that clears nothing, with one shared hole, and never under a live piece", () => {
  const g = playing(["a", "b"]);
  const b = seat(g, "b");
  b.incoming = [3];
  for (let i = 0; i < 5; i++) g.step();
  assert.equal(stackHeight(b.grid), 0); // nothing yet: the piece is still falling
  setPiece(b, "O4", 0, 0, 5);
  g.input("b", "drop");
  const ev = g.drainEvents();
  assert.equal(of(ev, "paper")[0]!.n, 3);
  assert.deepEqual(b.incoming, []);
  const holes = new Set<number>();
  for (let y = H - 3; y < H; y++) {
    assert.equal(b.paper[y], PAPER_LIFE);
    let empty = 0;
    for (let x = 0; x < COLS; x++) {
      const v = b.grid[y * COLS + x]!;
      if (!v) {
        empty++;
        holes.add(x);
      } else assert.equal(v, PAPER);
    }
    assert.equal(empty, 1);
  }
  assert.equal(holes.size, 1);
  // the piece sits on top of the paper
  assert.ok(b.grid[(H - 4) * COLS] || b.grid[(H - 5) * COLS]);
});

test("your own clears tear up waiting paper first", () => {
  const g = playing(["a", "b"]);
  const a = seat(g, "a");
  a.incoming = [2];
  fillRow(a, H - 1, [0, 1, 2]);
  setPiece(a, "I3", 0, 0, 5);
  g.input("a", "drop");
  const ev = g.drainEvents();
  assert.equal(of(ev, "attack").length, 0);
  assert.deepEqual(a.incoming, [1]);
});

test("paper cracks after its owner clears twice, and the crack sends nothing", () => {
  const g = playing(["a", "b"]);
  const a = seat(g, "a");
  fillRow(a, H - 1, [4], PAPER);
  a.paper[H - 1] = PAPER_LIFE;
  // two separate clears higher up (rows held up by a column so they don't fall into the paper's hole)
  for (let k = 0; k < 2; k++) {
    fillRow(a, H - 2, [0, 1, 2]);
    setPiece(a, "I3", 0, 0, 3);
    g.input("a", "drop");
    const ev = g.drainEvents();
    assert.equal(of(ev, "clear").length, 1);
    if (k === 0) assert.equal(a.paper[H - 1], 1);
    else {
      assert.deepEqual(of(ev, "crack")[0]!.rows, [H - 1]);
      assert.equal(stackHeight(a.grid), 0);
      // one row cleared sends 1; the crack adds nothing
      assert.equal(of(ev, "attack")[0]!.n, 1);
    }
  }
});

test("filling a paper row's hole is a normal clear", () => {
  const g = playing(["a", "b"]);
  const a = seat(g, "a");
  fillRow(a, H - 1, [4], PAPER);
  a.paper[H - 1] = PAPER_LIFE;
  setPiece(a, "I3", 1, 3, 5); // upright line into column 4
  g.input("a", "drop");
  const ev = g.drainEvents();
  assert.deepEqual(of(ev, "clear")[0]!.rows, [H - 1]);
  assert.equal(a.paper[H - 1], 0);
});

test("the last well standing wins the round; first to the target takes the match", () => {
  const g = playing(["a", "b"], 3, 2);
  for (let r = 0; r < 2; r++) {
    const b = seat(g, "b");
    for (let y = HIDDEN; y < H; y++) fillRow(b, y, [y % COLS]);
    setPiece(b, "O4", 0, 3, 0);
    g.input("b", "drop");
    const ev = g.drainEvents();
    assert.equal(of(ev, "out")[0]!.id, "b");
    assert.equal(of(ev, "round")[0]!.winner, "a");
    assert.equal(seat(g, "a").wins, r + 1);
    for (let i = 0; i < ROUND_STEPS; i++) g.step();
    if (r === 0) {
      assert.equal(g.phase, "count");
      for (let i = 0; i < COUNT_STEPS; i++) g.step();
      g.drainEvents();
    }
  }
  assert.equal(g.phase, "match");
  assert.deepEqual(g.winners, ["a"]);
});

test("solo: one well plays for score until it tops out", () => {
  const g = playing(["a"]);
  assert.equal(g.solo, true);
  const a = seat(g, "a");
  fillRow(a, H - 1, [0, 1, 2]);
  setPiece(a, "I3", 0, 0, 5);
  g.input("a", "drop");
  assert.ok(a.score > 0);
  assert.equal(of(g.drainEvents(), "attack").length, 0);
  for (let y = HIDDEN; y < H; y++) fillRow(a, y, [y % COLS]);
  for (let i = 0; i < 200 && g.phase === "play"; i++) {
    g.input("a", "drop");
    g.step();
  }
  assert.equal(g.phase, "round");
  for (let i = 0; i < ROUND_STEPS; i++) g.step();
  assert.equal(g.phase, "match");
  assert.deepEqual(g.winners, []);
});

test("a well that leaves mid-round stays on screen, out, and the round can end", () => {
  const g = playing(["a", "b"]);
  g.removeSeat("b");
  assert.ok(g.seats.has("b"));
  assert.equal(seat(g, "b").gone, true);
  assert.equal(g.phase, "round");
  for (let i = 0; i < ROUND_STEPS + COUNT_STEPS; i++) g.step();
  assert.ok(!g.seats.has("b"));
});

test("a newcomer waits for the next round", () => {
  const g = playing(["a", "b"]);
  g.addSeat("c", "C");
  assert.equal(seat(g, "c").inRound, false);
  assert.equal(g.alive().length, 2);
});

test("gravity rises over time and when a well goes out", () => {
  const g = playing(["a", "b", "c"]);
  const g0 = g.gravity;
  g.playSteps = 60 * 30;
  assert.ok(g.gravity < g0);
  const before = g.level;
  g.removeSeat("c");
  assert.equal(g.level, before + 1);
});

test("spawn is blocked: the well is out", () => {
  const g = playing(["a", "b"]);
  const a = seat(g, "a");
  setPiece(a, "O4", 0, 0, 10);
  const sp = spawnOf(a.next);
  for (const [cx, cy] of TURNS[sp.kind][0]!) a.grid[(sp.y + cy) * COLS + sp.x + cx] = 1;
  g.input("a", "drop");
  for (let i = 0; i < 10; i++) g.step();
  assert.equal(a.alive, false);
});

test("bots score placements sensibly: they take the clear", () => {
  const grid = new Uint8Array(COLS * H);
  for (let x = 3; x < COLS; x++) grid[(H - 1) * COLS + x] = 1;
  const best = placements(grid, "I3", 2).sort((a, b) => b.score - a.score)[0]!;
  assert.equal(best.rot % 2, 0);
  assert.equal(best.x, 0);
  assert.ok(fits(grid, "I3", best.rot, best.x, 2));
});

test("bots-only matches end with a winner in a sensible time, the same way every time", () => {
  const run = (seed: number) => {
    const g = new Stack({ wins: 2 }, seeded(seed));
    const b = createBots(g, seeded(seed + 1));
    b.setCount(4);
    g.startMatch();
    let steps = 0;
    while (g.phase !== "match" && steps < 60 * 60 * 20) {
      b.step();
      g.step();
      g.drainEvents();
      steps++;
    }
    return { steps, winners: g.winners.join(), rounds: g.round };
  };
  const r = run(11);
  assert.equal(r.winners.split(",").length, 1);
  assert.ok(r.steps < 60 * 60 * 12, `match ran ${r.steps / 3600} min`);
  assert.deepEqual(run(11), r);
});
