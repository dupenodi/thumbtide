import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots, throwRange } from "./bots.ts";
import {
  ARENA, ARM_TIME, BLAST_RADIUS, COUNT_STEPS, FUSE, HP, INVINCIBLE, KILL_Y, KNOCKOUT_MAX, POWERUP_LIFE, PUNCH_COOLDOWN, PUNCH_HIT_AT, RESPAWN,
  ROUND_STEPS, RUN, SHIELD_HP, SHIELD_SPILL, STEP, WEAR_OFF, Game, groundAt, seeded, type Fighter, type GameEvent, type Options,
} from "./rules.ts";

/** A game with these fighters, already playing, no power-up boxes unless asked for. */
function playing(ids: string[], opts: Partial<Options> = {}, seed = 1) {
  const g = new Game({ powerups: false, ...opts }, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  for (let i = 0; i < COUNT_STEPS; i++) g.step();
  assert.equal(g.phase, "play");
  for (let i = 0; i < Math.ceil(INVINCIBLE / STEP) + 1; i++) g.step(); // the spawn's invincible second
  g.drainEvents();
  return g;
}
const seat = (g: Game, id: string) => g.seats.get(id)!;
const place = (f: Fighter, x: number, z: number, yaw = 0) => Object.assign(f, { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, grounded: true, momentum: 0 });
const run = (g: Game, steps: number, each?: (i: number) => void) => {
  const ev: GameEvent[] = [];
  for (let i = 0; i < steps; i++) {
    each?.(i);
    g.step();
    ev.push(...g.drainEvents());
  }
  return ev;
};
const of = <T extends GameEvent["type"]>(ev: GameEvent[], type: T) => ev.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
const secs = (s: number) => Math.round(s / STEP);
/** Take the TNT crate away so a test has open ground. */
const open = (g: Game) => {
  g.bombs = g.bombs.filter((b) => b.kind !== "tnt");
};

test("a match needs two fighters; the count leads to play", () => {
  const g = new Game({}, seeded(1));
  g.addSeat("a", "A");
  assert.equal(g.phase, "wait");
  g.addSeat("b", "B");
  assert.equal(g.phase, "count");
  assert.equal(seat(g, "a").lives, 3);
  g.punch("a"); // nothing happens before the start
  run(g, COUNT_STEPS);
  assert.equal(g.phase, "play");
  assert.equal(seat(g, "a").punchT, -1);
});

test("the stick moves a fighter at the run speed and turns it", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), 0, 2.5);
  g.setInput("a", 1, 0);
  run(g, secs(1));
  assert.ok(Math.abs(Math.hypot(a.vx, a.vz) - RUN) < 0.05);
  assert.ok(a.x > 3.5 && Math.abs(a.yaw - Math.PI / 2) < 0.05);
  g.setInput("a", 5, 5); // clamped to the unit circle
  assert.ok(Math.abs(Math.hypot(a.ix, a.iz) - 1) < 1e-9);
});

test("a jump leaves the ground, lands again, and has a cooldown", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), 0, 2);
  assert.equal(g.jump("a"), true);
  assert.equal(g.jump("a"), false);
  let top = 0;
  run(g, secs(1), () => (top = Math.max(top, a.y)));
  assert.ok(top > 0.9 && top < 1.3, `apex ${top}`);
  assert.ok(a.grounded && a.y === 0);
});

test("a fighter can hop onto a block and stand on it", () => {
  const g = playing(["a", "b"]);
  const blk = ARENA.blocks[0]!;
  const a = place(seat(g, "a"), blk.x - blk.w / 2 - 0.6, blk.z);
  g.setInput("a", 1, 0);
  run(g, secs(0.4));
  assert.ok(a.x < blk.x - blk.w / 2, "the block's side stops it");
  g.jump("a");
  run(g, secs(0.7));
  g.setInput("a", 0, 0);
  run(g, secs(0.3));
  assert.equal(a.y, blk.h);
  assert.equal(groundAt(a.x, a.z), blk.h);
});

test("a standing punch is weak; a run-up punch hurts, knocks back and stuns", () => {
  assert.ok(Game.punchDamage(0, false) < 100);
  assert.ok(Game.punchDamage(RUN, false) > 300 && Game.punchDamage(RUN, false) < 450);
  assert.ok(Game.punchDamage(RUN, true) > Game.punchDamage(RUN, false));
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -6, 2.5, Math.PI / 2);
  const b = place(seat(g, "b"), 0, 2.5);
  g.setInput("a", 1, 0);
  let ev: GameEvent[] = [];
  for (let i = 0; i < 300 && !of(ev, "hit").length; i++) {
    if (b.x - a.x < 1.0) g.punch("a");
    ev = ev.concat(run(g, 1));
  }
  const hit = of(ev, "hit")[0]!;
  assert.equal(hit.id, "b");
  assert.equal(hit.kind, "punch");
  assert.ok(hit.damage > 280, `damage ${hit.damage}`);
  assert.equal(b.hp, HP - hit.damage);
  assert.ok(b.vx > 2 && b.knockout > 0);
  assert.ok(a.momentum < 2, "the puncher's run-up is spent");
  // knocked out: no actions until it wears off
  assert.equal(g.punch("b"), false);
  g.setInput("a", 0, 0);
  run(g, secs(1.5));
  assert.equal(b.knockout, 0);
  assert.equal(g.punch("b"), true);
});

test("the punch has a cooldown and lands 0.1 s after the press", () => {
  const g = playing(["a", "b"]);
  open(g);
  place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.9);
  assert.equal(g.punch("a"), true);
  assert.equal(g.punch("a"), false);
  run(g, secs(PUNCH_HIT_AT) - 1);
  assert.equal(b.hp, HP);
  run(g, 3);
  assert.ok(b.hp < HP);
  run(g, secs(PUNCH_COOLDOWN));
  assert.equal(g.punch("a"), true);
});

test("knock-out follows the engine's formula", () => {
  assert.equal(Game.knockoutFor(270), 0);
  assert.equal(Game.knockoutFor(300), 3);
  assert.equal(Game.knockoutFor(550), KNOCKOUT_MAX);
  assert.equal(Game.knockoutFor(5000), KNOCKOUT_MAX);
});

test("Bomb lights one in the hands; the next press throws it; it goes off after the fuse", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -5, -2.4, Math.PI / 2);
  const b = place(seat(g, "b"), 6, 5);
  assert.equal(g.bomb("a"), true);
  const bomb = g.bombs[0]!;
  assert.equal(bomb.heldBy, "a");
  assert.equal(g.bombsLeft(a), 0);
  run(g, secs(0.6));
  assert.ok(Math.abs(bomb.x - a.x) < 0.3 && bomb.y > 1.5, "carried over the head");
  g.setInput("a", 1, 0);
  assert.equal(g.bomb("a"), true);
  g.setInput("a", 0, 0);
  assert.equal(bomb.heldBy, null);
  assert.equal(g.bomb("a"), false, "one bomb at a time");
  const ev = run(g, secs(FUSE));
  const blast = of(ev, "blast")[0]!;
  assert.ok(blast, "it went off");
  const [range] = throwRange(1);
  assert.ok(blast.x + 5 > range * 0.8 && blast.x + 5 < range + 3.5, `landed ${blast.x + 5} m away`);
  assert.equal(blast.radius, BLAST_RADIUS);
  assert.equal(b.hp, HP, "far away: unhurt");
  assert.equal(g.bombsLeft(a), 1, "the bomb comes back");
});

test("a blast hurts by distance, throws fighters, and a held bomb goes off in the hands", () => {
  assert.equal(Game.blastDamage(BLAST_RADIUS, BLAST_RADIUS), 0);
  assert.ok(Game.blastDamage(0.5, BLAST_RADIUS) > HP);
  assert.ok(Game.blastDamage(1.5, BLAST_RADIUS) < 400);
  assert.equal(Game.blastDamage(1, BLAST_RADIUS, "tnt"), 2 * Game.blastDamage(1, BLAST_RADIUS));
  const g = playing(["a", "b", "c"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0);
  const b = place(seat(g, "b"), 1.3, 0);
  const c = place(seat(g, "c"), 5, 0);
  g.explode(0, 0.24, 0, BLAST_RADIUS, "normal", null);
  assert.equal(a.alive, false, "on top of it");
  assert.ok(b.alive && b.hp < HP && b.vx > 2 && b.vy > 0 && b.knockout > 0);
  assert.equal(c.hp, HP);
  // cooked too long
  const d = playing(["a", "b"]);
  open(d);
  place(seat(d, "a"), 0, 0);
  place(seat(d, "b"), 6, 0);
  d.bomb("a");
  const ev = run(d, secs(FUSE) + 2);
  assert.equal(of(ev, "blast").length, 1);
  assert.equal(of(ev, "die")[0]!.id, "a");
});

test("blasts set each other off, and the TNT crate too, a little later", () => {
  const g = playing(["a", "b"]);
  place(seat(g, "a"), -6, 5);
  place(seat(g, "b"), 6, 5);
  const tnt = g.bombs.find((b) => b.kind === "tnt")!;
  run(g, secs(1));
  assert.ok(tnt.y < 0.6);
  g.explode(tnt.x + 1.2, 0.3, tnt.z, BLAST_RADIUS, "normal", "a");
  assert.ok(tnt.fuse <= 0.2 && tnt.fuse >= 0.1);
  const ev = run(g, secs(0.3));
  const boom = of(ev, "blast").find((e) => e.kind === "tnt")!;
  assert.ok(boom, "the crate went off");
  assert.ok(boom.radius > BLAST_RADIUS * 1.4);
  assert.equal(g.bombs.length, 0);
});

test("an impact bomb goes off when it lands, not in the thrower's hands", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -3, 3, Math.PI / 2);
  place(seat(g, "b"), 6, -5);
  a.bombKind = "impact";
  a.bombKindT = WEAR_OFF;
  g.bomb("a");
  run(g, secs(1));
  assert.equal(g.bombs.length, 1, "it waits while held");
  g.setInput("a", 1, 0);
  g.bomb("a");
  g.setInput("a", 0, 0);
  const ev = run(g, secs(1.5));
  const blast = of(ev, "blast")[0]!;
  assert.ok(blast && blast.x > 1, "on landing");
  assert.ok(Math.abs(blast.radius - BLAST_RADIUS * 0.7) < 1e-9);
  assert.ok(ARM_TIME > 0 && a.alive);
});

test("a sticky bomb sticks to the fighter it hits and rides along", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -2, 3, Math.PI / 2);
  const b = place(seat(g, "b"), 1.2, 3);
  a.bombKind = "sticky";
  a.bombKindT = WEAR_OFF;
  g.bomb("a");
  run(g, secs(0.6));
  g.setInput("a", 0.2, 0);
  g.bomb("a");
  g.setInput("a", 0, 0);
  const bomb = g.bombs[0]!;
  let ev = run(g, secs(0.8));
  assert.equal(of(ev, "stick").length, 1);
  assert.equal(bomb.stuck, "b");
  g.setInput("b", 0, -1);
  run(g, secs(0.5));
  assert.ok(Math.hypot(bomb.x - b.x, bomb.z - b.z) < 0.8, "it rides along");
  ev = run(g, secs(FUSE));
  assert.equal(of(ev, "die")[0]!.id, "b");
});

test("pick up and throw: a bomb, the TNT crate, and a knocked-out fighter (not one on its feet)", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.9);
  assert.equal(g.grab("a"), false, "b is on its feet");
  run(g, secs(0.4));
  b.knockout = 20;
  assert.equal(g.grab("a"), true);
  assert.equal(a.holdFighter, "b");
  run(g, secs(0.6));
  assert.ok(b.y > 1.5 && b.heldBy === "a" && b.knockout > 0, "carried, helpless");
  assert.equal(g.punch("b"), false);
  g.setInput("a", 0, 1);
  assert.equal(g.grab("a"), true, "the second press throws");
  assert.ok(b.heldBy === null && b.vz > 4 && b.vy > 3);
  // right at the edge: the throw carries them off the deck
  g.setInput("a", 0, 0);
  place(a, 0, ARENA.hz - 1, 0);
  place(b, 0, ARENA.hz - 0.3);
  b.knockout = 26;
  run(g, secs(0.4));
  b.knockout = 26;
  assert.equal(g.grab("a"), true);
  run(g, secs(0.6));
  g.setInput("a", 0, 1);
  g.punch("a"); // any action button throws
  g.setInput("a", 0, 0);
  const ev = run(g, secs(3));
  const die = of(ev, "die")[0]!;
  assert.ok(die.id === "b" && die.fell);
  assert.equal(b.lives, 2);
  // the crate
  const tnt = g.bombs.find((x) => x.kind === "tnt")!;
  place(a, tnt.x, tnt.z - 1, 0);
  run(g, secs(0.4));
  assert.equal(g.grab("a"), true);
  assert.equal(tnt.heldBy, "a");
  run(g, secs(0.6));
  g.grab("a");
  assert.ok(tnt.heldBy === null && tnt.vz > 3);
});

test("a hit makes a fighter drop what it carries; a carried fighter breaks free in the end", () => {
  const g = playing(["a", "b", "c"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.9);
  place(seat(g, "c"), 6, 6);
  b.knockout = 26;
  g.grab("a");
  g.hurt(a, 100, "c", "punch", 0, 0, 0);
  assert.equal(a.holdFighter, null);
  assert.equal(b.heldBy, null);
  place(a, 0, 0, 0);
  place(b, 0, 0.9);
  b.knockout = 26;
  run(g, secs(0.4));
  b.knockout = 26;
  g.grab("a");
  assert.equal(b.heldBy, "a");
  run(g, secs(3));
  assert.equal(b.heldBy, null);
});

test("falling off the deck costs a life; the fighter comes back after 3 s, invincible for a second", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), ARENA.hx - 0.5, 0);
  g.setInput("a", 1, 0);
  let ev = run(g, secs(2.5));
  g.setInput("a", 0, 0);
  const die = of(ev, "die")[0]!;
  assert.ok(die.fell && a.y < KILL_Y + 1);
  assert.equal(a.lives, 2);
  assert.equal(a.alive, false);
  ev = [];
  for (let i = 0; i < secs(RESPAWN) + 2 && !of(ev, "spawn").length; i++) ev = run(g, 1);
  assert.equal(of(ev, "spawn")[0]!.id, "a");
  assert.ok(a.alive && a.hp === HP && groundAt(a.x, a.z) === 0);
  assert.equal(g.hurt(a, 500, "b", "blast", 0, 0, 0), 0, "invincible");
  run(g, secs(INVINCIBLE) + 1);
  assert.equal(g.hurt(a, 500, "b", "blast", 0, 0, 0), 500);
});

test("the last fighter with lives takes the round; round wins take the match", () => {
  const g = playing(["a", "b", "c"], { lives: 1, wins: 2 });
  const out = (id: string) => g.hurt(seat(g, id), 5000, null, "blast", 0, 0, 0);
  out("b");
  run(g, secs(0.5));
  assert.equal(g.phase, "play", "two are left");
  out("c");
  let ev = run(g, secs(1.2));
  assert.equal(of(ev, "round")[0]!.winner, "a");
  assert.equal(g.phase, "round");
  assert.equal(seat(g, "a").wins, 1);
  run(g, ROUND_STEPS);
  assert.equal(g.phase, "count");
  assert.equal(g.round, 2);
  assert.ok(seat(g, "b").alive && seat(g, "b").lives === 1);
  run(g, COUNT_STEPS + secs(INVINCIBLE) + 2);
  out("b");
  out("c");
  ev = run(g, secs(1.2) + ROUND_STEPS);
  assert.equal(g.phase, "match");
  assert.equal(g.winner, "a");
  assert.equal(g.standings()[0]!.id, "a");
  g.startMatch();
  assert.equal(seat(g, "a").wins, 0);
  assert.equal(g.round, 1);
});

test("everyone out at once is a draw", () => {
  const g = playing(["a", "b"], { lives: 1 });
  g.hurt(seat(g, "a"), 5000, null, "blast", 0, 0, 0);
  g.hurt(seat(g, "b"), 5000, null, "blast", 0, 0, 0);
  const ev = run(g, secs(1.2));
  assert.equal(of(ev, "round")[0]!.winner, null);
  assert.equal(seat(g, "a").wins + seat(g, "b").wins, 0);
});

test("power-up boxes drop at the four points every 8 s, and go away unclaimed", () => {
  const g = playing(["a", "b"], { powerups: true });
  place(seat(g, "a"), 0, 6);
  place(seat(g, "b"), 1, 6);
  // (the helper already ran the first second of play)
  assert.ok(g.boxes.length >= 2);
  run(g, secs(1.5));
  assert.equal(g.boxes.length, 4);
  assert.deepEqual(g.boxes.map((b) => [b.x, b.z]).sort(), ARENA.powerups.map((p) => [...p]).sort());
  run(g, secs(2));
  assert.ok(g.boxes.every((b) => b.rest && Math.abs(b.y - 0.36) < 0.01), "landed");
  run(g, secs(POWERUP_LIFE - 3.6)); // 7.9 s into the round: the first three are 7 s old
  assert.ok(g.boxes.length <= 1, `${g.boxes.length} boxes left`);
  run(g, secs(1.6));
  assert.equal(g.boxes.length, 4, "the next drop");
});

test("power-ups: triple bombs, gloves, shield, health, bomb kinds; they wear off after 20 s", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0);
  place(seat(g, "b"), 6, 6);
  const give = (kind: "triple" | "impact" | "sticky" | "gloves" | "shield" | "health") => {
    g.boxes.push({ id: 900 + g.boxes.length, kind, age: 0, rest: true, x: a.x, y: 0.36, z: a.z, vx: 0, vy: 0, vz: 0 });
    return of(run(g, 1), "power")[0];
  };
  assert.equal(give("triple")!.kind, "triple");
  assert.equal(g.bombsLeft(a), 3);
  give("gloves");
  assert.ok(a.glovesT > 19);
  a.hp = 300;
  give("health");
  assert.equal(a.hp, HP);
  give("sticky");
  assert.equal(a.bombKind, "sticky");
  give("impact");
  assert.equal(a.bombKind, "impact");
  // the shield takes a hit whole; a massive one spills over
  give("shield");
  assert.ok(a.shield > SHIELD_HP - 5);
  assert.equal(g.hurt(a, 300, "b", "punch", 5, 0, 0), 0);
  assert.ok(a.hp === HP && a.vx === 0 && a.shield > 300);
  const before = a.shield;
  const spilled = g.hurt(a, before + SHIELD_SPILL + 200, "b", "blast", 0, 0, 0);
  assert.ok(Math.abs(spilled - 200) <= 1 && a.shield === 0, `spilled ${spilled}`);
  run(g, secs(WEAR_OFF) + 2);
  assert.equal(g.bombsLeft(a), 1);
  assert.equal(a.glovesT, 0);
  assert.equal(a.bombKind, "normal");
});

test("a blast destroys a power-up box", () => {
  const g = playing(["a", "b"]);
  g.boxes.push({ id: 1, kind: "health", age: 0, rest: true, x: 3, y: 0.36, z: 3, vx: 0, vy: 0, vz: 0 });
  g.explode(3.5, 0.3, 3, BLAST_RADIUS, "normal", null);
  assert.equal(g.boxes.length, 0);
});

test("a late joiner waits for the next round; a leaver's things are let go", () => {
  const g = playing(["a", "b"]);
  g.addSeat("c", "C");
  assert.equal(seat(g, "c").inRound, false);
  assert.equal(g.contenders().length, 2);
  g.bomb("a");
  g.removeSeat("a");
  assert.equal(g.bombs.find((b) => b.kind !== "tnt")!.heldBy, null);
  // b is alone among those in the round: it takes it, and c is in the next one
  run(g, secs(1.2) + ROUND_STEPS + 1);
  assert.equal(g.phase, "count");
  assert.ok(seat(g, "c").inRound && seat(g, "c").alive);
  g.removeSeat("c");
  assert.equal(g.phase, "wait");
});

test("bots stay on the deck when nobody pushes them, and they attack", () => {
  const r = seeded(4);
  const g = new Game({ powerups: false }, r);
  const bots = createBots(g, r);
  bots.setCount(1);
  g.addSeat("idle", "Idle"); // a person who does nothing
  g.startMatch();
  let fell = 0;
  for (let i = 0; i < 60 * 25 && g.phase !== "round"; i++) {
    bots.step();
    g.step();
    for (const e of g.drainEvents()) if (e.type === "die" && e.fell && e.id !== "idle") fell++;
  }
  assert.equal(fell, 0);
  assert.ok(seat(g, "idle").hp < HP || seat(g, "idle").lives < 3, "and it attacks");
});

test("bots finish matches (2, 4 and 8 of them), with bombs, punches and power-ups in use", () => {
  for (const [n, seed] of [[2, 11], [4, 12], [8, 13]] as const) {
    const r = seeded(seed);
    const g = new Game({}, r);
    const bots = createBots(g, r);
    bots.setCount(n);
    assert.equal(bots.count, n);
    g.startMatch();
    const seen = new Set<string>();
    let steps = 0;
    while (g.phase !== "match" && steps < 60 * 60 * 15) {
      bots.step();
      g.step();
      steps++;
      for (const e of g.drainEvents()) seen.add(e.type === "hit" ? `hit-${e.kind}` : e.type);
    }
    assert.equal(g.phase, "match", `${n} bots: no winner after ${steps} steps`);
    assert.ok(g.winner && g.seats.get(g.winner)!.wins === g.opts.wins);
    assert.ok(steps > 60 * 40, `${n} bots: a match of ${Math.round(steps / 60)} s is too short`);
    for (const k of ["blast", "hit-punch", "hit-blast", "power", "throw", "die"]) assert.ok(seen.has(k), `${n} bots: no "${k}"`);
  }
});

test("the same seed plays the same match", () => {
  const play = () => {
    const r = seeded(21);
    const g = new Game({}, r);
    const bots = createBots(g, r);
    bots.setCount(4);
    g.startMatch();
    for (let i = 0; i < 60 * 30; i++) {
      bots.step();
      g.step();
    }
    return JSON.stringify([...g.seats.values()].map((f) => [f.x, f.z, f.hp, f.lives]));
  };
  assert.equal(play(), play());
});
