import assert from "node:assert/strict";
import { test } from "node:test";
import { botMove } from "./bots.ts";
import { Game, capacity, neighbours } from "./rules.ts";

test("capacity is the number of neighbours", () => {
  assert.equal(capacity(9, 6, 0), 2); // corner
  assert.equal(capacity(9, 6, 4), 3); // top edge
  assert.equal(capacity(9, 6, 10), 4); // inside
  assert.deepEqual(neighbours(9, 6, 0), [1, 9]);
});

test("a full corner bursts into both neighbours and takes them", () => {
  const g = new Game(3, 3, 2);
  g.play(0); // P0
  g.play(8); // P1
  g.play(1); // P0
  g.play(7); // P1
  const m = g.play(0)!; // P0: the corner reaches 2 and bursts
  assert.equal(m.waves.length, 1);
  assert.equal(g.board.count[0], 0);
  assert.equal(g.board.owner[0], -1);
  assert.equal(g.board.count[1], 2);
  assert.equal(g.board.owner[3], 0);
});

test("nobody is out before everyone has moved, and only own or empty cells can be played", () => {
  const g = new Game(3, 3, 3);
  g.play(0);
  assert.equal(g.canPlay(0), false); // P1 can't play P0's cell
  g.play(4);
  assert.deepEqual(g.alive, [true, true, true]);
});

test("pieces are never lost, and every game ends with one winner", () => {
  for (let k = 0; k < 20; k++) {
    const g = new Game(7, 5, 2 + (k % 5), k);
    let moves = 0;
    while (g.winner < 0 && moves < 1500) {
      g.play(botMove(g));
      moves++;
      if (g.winner < 0) assert.equal(g.moves, moves);
    }
    assert.ok(g.winner >= 0);
    assert.equal(g.alive.filter(Boolean).length, 1);
  }
});
