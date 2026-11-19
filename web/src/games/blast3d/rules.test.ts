import assert from "node:assert/strict";
import { test } from "node:test";
import { createBots, throwRange } from "./bots.ts";
import * as E from "./engine.ts";
import {
  ARENA, ARM_TIME, BLAST_RADIUS, BOMB_R, COUNT_STEPS, FUSE, HP, INVINCIBLE, KILL_Y, KNOCKOUT_MAX, PICKUP_DELAY, POWERUP_LIFE, PUNCH_COOLDOWN, RESPAWN,
  ROUND_STEPS, RUN, SHIELD_HP, SHIELD_SPILL, STEP, WALK, WEAR_OFF, Game, groundAt, seeded, type Fighter, type GameEvent, type Options,
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
/** Stand a fighter here, at rest (its engine state reset). */
const place = (f: Fighter, x: number, z: number, yaw = 0) => {
  const keep = { ix: f.ix, iz: f.iz, run: f.run };
  E.stand(f, x, groundAt(x, z) ?? 0, z, yaw);
  Object.assign(f, keep);
  return f;
};
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
const speed = (f: Fighter) => Math.hypot(f.vx, f.vz);
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

test("the engine's numbers: masses, the stand, top speeds", () => {
  assert.ok(Math.abs(E.M_CORE - 1.392) < 0.02, `core ${E.M_CORE}`); // spaz_physics_tuning.h says 1.392
  assert.ok(Math.abs(WALK - 2.304) < 1e-6);
  assert.ok(Math.abs(RUN - 6.452) < 0.01);
  assert.ok(E.HEAD_TOP > 1.1 && E.HEAD_TOP < 1.25);
  // a per-step filter converted to our step keeps its time constant
  assert.ok(Math.abs(Math.log(E.per(0.985)) / E.H - Math.log(0.985) / E.SRC_H) < 1e-9);
});

test("the stick walks; a held button runs, and the run builds up over seconds", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -7, -6.5);
  g.setInput("a", 0.6, 0.8);
  run(g, secs(1));
  assert.ok(Math.abs(speed(a) - WALK) < 0.05, `walk ${speed(a)}`);
  assert.ok(Math.abs(a.yaw - Math.atan2(0.6, 0.8)) < 0.05, "it faces the way it goes");
  // a button held: the gas comes on, and the gear builds up to the run speed
  place(a, -7, -6.5);
  g.setInput("a", 1, 0);
  g.punch("a");
  assert.equal(a.run, 1);
  run(g, secs(0.5));
  const early = speed(a);
  run(g, secs(1.5));
  assert.ok(early > WALK && early < 0.75 * RUN, `0.5 s in: ${early}`);
  assert.ok(speed(a) > 0.78 * RUN && speed(a) <= RUN + 0.01, `2 s in: ${speed(a)}`);
  // letting go of the button: back to walking
  g.buttonUp("a", "punch");
  assert.equal(a.run, 0);
  run(g, secs(0.6));
  assert.ok(speed(a) < WALK + 0.3, `${speed(a)}`);
  g.setInput("a", 5, 5); // clamped to the unit circle
  assert.ok(Math.abs(Math.hypot(a.ix, a.iz) - 1) < 1e-9);
});

test("no steering in the air; carrying, it only walks", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -6, -6);
  g.setInput("a", 1, 0);
  run(g, secs(0.5));
  g.jump("a");
  run(g, 5);
  assert.equal(a.grounded, false);
  const vx = a.vx;
  g.setInput("a", -1, 0);
  run(g, 10);
  assert.ok(!a.grounded && Math.abs(a.vx - vx) < 1e-9, "the stick does nothing in the air");
  place(a, -6, -6);
  g.setInput("a", 1, 0);
  g.setRun("a", 1);
  g.bomb("a");
  run(g, secs(2));
  assert.ok(speed(a) < WALK + 0.01, "holding a bomb: no run");
});

test("a jump leaves the ground, lands again, and has a cooldown", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), 0, 2);
  assert.equal(g.jump("a"), true);
  assert.equal(g.jump("a"), false);
  let top = 0;
  let air = 0;
  let down = false;
  run(g, secs(1), () => {
    top = Math.max(top, a.y);
    if (!a.grounded && !down) air++;
    if (air > 0 && a.grounded) down = true;
  });
  assert.ok(top > 0.45 && top < 0.65, `apex ${top}`);
  assert.ok(air * STEP > 0.35 && air * STEP < 0.5, `airtime ${air * STEP}`);
  run(g, secs(0.5)); // (the legs' spring bounces it a little after it lands)
  assert.ok(a.grounded && a.y === 0);
});

test("with a run-up a fighter hops onto a block and stands on it; a standing hop does not", () => {
  const g = playing(["a", "b"]);
  open(g);
  const blk = ARENA.blocks[0]!;
  const a = place(seat(g, "a"), blk.x - blk.w / 2 - 0.4, blk.z, Math.PI / 2);
  g.setInput("a", 1, 0);
  run(g, secs(0.4));
  assert.ok(a.x < blk.x - blk.w / 2, "the block's side stops it");
  const x = a.x;
  g.jump("a");
  run(g, secs(1.2));
  assert.ok(a.y === 0 && Math.abs(a.x - x) < 0.1, "no run-up: it lands where it was");
  place(a, blk.x - blk.w / 2 - 3, blk.z, Math.PI / 2);
  g.setRun("a", 1);
  for (let i = 0; i < secs(2) && a.y === 0; i++) {
    if (a.x > blk.x - blk.w / 2 - 0.9 && a.grounded) g.jump("a");
    run(g, 1);
  }
  g.setInput("a", 0, 0);
  g.setRun("a", 0);
  run(g, secs(1));
  assert.equal(a.y, blk.h);
  assert.equal(groundAt(a.x, a.z), blk.h);
});

test("a standing punch barely hurts; a running punch hurts, knocks back, knocks out and kicks the puncher back", () => {
  // the engine's punch: power × 1.2 × (spin × 110 + speed momentum × 40); damage 0.22 × 5 × that
  assert.equal(Game.punchDamage(0, false), 0);
  assert.ok(Game.punchDamage(WALK, false) > 60 && Game.punchDamage(WALK, false) < 120);
  assert.ok(Game.punchDamage(RUN, false) > 550 && Game.punchDamage(RUN, false) < 700);
  assert.ok(Game.punchDamage(RUN, true) > Game.punchDamage(RUN, false));
  assert.ok(Game.punchDamage(0, false, 10) > 150, "a spinning punch");
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -6.5, 2.5, Math.PI / 2);
  const b = place(seat(g, "b"), 2, 2.5);
  // standing: next to it, no run-up
  place(a, 1.15, 2.5, Math.PI / 2);
  g.punch("a");
  let ev = run(g, secs(0.4));
  assert.ok(of(ev, "hit").every((e) => e.damage < 20), "a standing punch does next to nothing");
  // the run-up
  place(a, -6.5, 2.5, Math.PI / 2);
  b.hp = HP;
  g.setInput("a", 1, 0);
  g.setRun("a", 1);
  ev = [];
  let before = 0;
  for (let i = 0; i < 300 && !of(ev, "hit").length; i++) {
    if (b.x - a.x < 1.0 && a.punchT < 0) {
      g.punch("a");
      before = a.vx;
    }
    ev = ev.concat(run(g, 1));
  }
  const hit = of(ev, "hit")[0]!;
  assert.equal(hit.id, "b");
  assert.equal(hit.kind, "punch");
  assert.ok(hit.damage > 300, `damage ${hit.damage}`);
  assert.equal(b.hp, HP - hit.damage);
  assert.ok(b.vx > 2.5 && b.knockout > 10, `knock-back ${b.vx}, knock-out ${b.knockout}`);
  assert.ok(a.vx < before - 1, "the puncher is kicked back");
  // knocked out: no actions until it wears off
  assert.equal(g.punch("b"), false);
  g.setInput("a", 0, 0);
  g.setRun("a", 0);
  run(g, secs(2));
  assert.equal(b.knockout, 0);
  assert.equal(g.punch("b"), true);
});

test("the fist reaches out from 80 ms; the punch has a cooldown; one hit per target", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.85);
  a.pmLin = 5; // as if it had been moving
  assert.equal(g.punch("a"), true);
  assert.equal(g.punch("a"), false);
  run(g, secs(0.08));
  assert.equal(b.hp, HP);
  const ev = run(g, secs(0.2));
  assert.equal(of(ev, "hit").length, 1);
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

test("Bomb lights one in the hands; the next press throws it; it lands, rolls on and goes off after the fuse", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -6, -2.4, Math.PI / 2);
  const b = place(seat(g, "b"), 6, 5);
  assert.equal(g.bomb("a"), true);
  const bomb = g.bombs[0]!;
  assert.equal(bomb.heldBy, "a");
  assert.equal(g.bombsLeft(a), 0);
  run(g, secs(0.6));
  assert.ok(Math.abs(bomb.x - a.x) < 0.1 && bomb.y > 1.3, `carried over the head (${bomb.y})`);
  g.setInput("a", 1, 0);
  assert.equal(g.bomb("a"), true);
  g.setInput("a", 0, 0);
  assert.equal(bomb.heldBy, null);
  assert.equal(g.bomb("a"), false, "one bomb at a time");
  let landed = NaN;
  const ev = run(g, secs(FUSE), () => {
    if (Number.isNaN(landed) && bomb.free > 0.2 && bomb.y <= BOMB_R + 1e-6) landed = bomb.x + 6;
  });
  const blast = of(ev, "blast")[0]!;
  assert.ok(blast, "it went off");
  const [range] = throwRange(1);
  assert.ok(Math.abs(landed - range) < 0.5, `landed ${landed} m away, ${range} expected`);
  assert.ok(blast.x + 6 > landed + 1.5, `rolled on to ${blast.x + 6}`);
  assert.equal(blast.radius, BLAST_RADIUS);
  assert.equal(b.hp, HP, "far away: unhurt");
  assert.equal(g.bombsLeft(a), 1, "the bomb comes back");
});

test("a blast hurts by distance, throws fighters up, and a held bomb goes off in the hands", () => {
  assert.equal(Game.blastDamage(BLAST_RADIUS), 0);
  assert.ok(Game.blastDamage(0) > 950);
  assert.ok(Game.blastDamage(1) > 500 && Game.blastDamage(1) < 650);
  assert.ok(Game.blastDamage(1.5) < 300);
  assert.equal(Game.blastDamage(1, BLAST_RADIUS, "tnt"), 2 * Game.blastDamage(1));
  const near = Game.blastOn(0.5);
  assert.ok(near.dvy > 2 * near.dvx, "a blast throws more up than sideways");
  const g = playing(["a", "b", "c"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0);
  const b = place(seat(g, "b"), 1.0, 0);
  const c = place(seat(g, "c"), 5, 0);
  a.hp = 500;
  g.explode(0, 0.2, 0, BLAST_RADIUS, "normal", null);
  assert.equal(a.alive, false, "on top of it");
  assert.ok(b.alive && b.hp < HP && b.vx > 2 && b.vy > 3 && b.knockout > 0);
  assert.equal(c.hp, HP);
  // cooked too long
  const d = playing(["a", "b"]);
  open(d);
  place(seat(d, "a"), 0, 0);
  place(seat(d, "b"), 6, 0);
  seat(d, "a").hp = 800;
  d.bomb("a");
  const ev = run(d, secs(FUSE) + 2);
  assert.equal(of(ev, "blast").length, 1);
  assert.equal(of(ev, "die")[0]!.id, "a");
});

test("a hard landing after a blast hurts (the engine's head-jolt damage), but never quite kills", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0);
  place(seat(g, "b"), 6, 6);
  g.explode(0.6, 0.2, 0, BLAST_RADIUS, "normal", null);
  const hp = a.hp;
  const ev = run(g, secs(2));
  const imp = of(ev, "hit").filter((e) => e.kind === "impact");
  assert.equal(imp.length, 1);
  assert.ok(imp[0]!.damage > 0 && a.hp === hp - imp[0]!.damage);
  a.hp = 30;
  assert.equal(g.hurt(a, 150, null, "impact", 0, 0, 0, 0, 0, 0, false), 20, "it leaves 10 hp");
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
  assert.ok(blast && blast.x > -1, `on landing (${blast?.x})`);
  assert.ok(Math.abs(blast.radius - BLAST_RADIUS * 0.7) < 1e-9);
  assert.ok(ARM_TIME > 0 && a.alive);
});

test("a sticky bomb sticks to the fighter it hits and rides along", () => {
  const g = playing(["a", "b"]);
  open(g);
  const a = place(seat(g, "a"), -2, 3, Math.PI / 2);
  const b = place(seat(g, "b"), 1.0, 3);
  a.bombKind = "sticky";
  a.bombKindT = WEAR_OFF;
  g.bomb("a");
  run(g, secs(0.6));
  g.setInput("a", 1, 0);
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
  assert.ok(of(ev, "die").some((e) => e.id === "b") || b.hp < HP / 2);
});

test("pick up and throw: a fighter on its feet, the TNT crate; the pick-up comes 64 ms after the press", () => {
  const g = playing(["a", "b"]);
  const a = place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.7, Math.PI);
  assert.equal(g.grab("a"), true);
  assert.equal(a.holdFighter, null, "not yet");
  run(g, Math.ceil(PICKUP_DELAY / STEP) + 1);
  assert.equal(a.holdFighter, "b", "anyone can be lifted (spaz.py: all but the invincible)");
  run(g, secs(0.6));
  assert.ok(b.y > 0.7 && b.heldBy === "a", "carried");
  g.setInput("a", 0, 1);
  assert.equal(g.grab("a"), true, "the second press throws");
  assert.ok(b.heldBy === null && b.vz > 1 && b.vy > 2, `thrown ${b.vz}, ${b.vy}`);
  // right at the edge: thrown over it
  g.setInput("a", 0, 0);
  run(g, secs(1));
  place(a, 0, ARENA.hz - 0.7, 0);
  place(b, 0, ARENA.hz - 0.05, Math.PI);
  b.knockout = 26;
  run(g, secs(0.4));
  b.knockout = 26;
  g.grab("a");
  run(g, secs(0.7));
  assert.equal(b.heldBy, "a");
  g.setInput("a", 0, 1);
  g.punch("a"); // any action button throws
  g.setInput("a", 0, 0);
  const ev = run(g, secs(3));
  const die = of(ev, "die")[0]!;
  assert.ok(die && die.id === "b" && die.fell);
  assert.equal(b.lives, 2);
  // the crate
  const tnt = g.bombs.find((x) => x.kind === "tnt")!;
  place(a, tnt.x, tnt.z - 0.9, 0);
  run(g, secs(0.4));
  assert.equal(g.grab("a"), true);
  run(g, 6);
  assert.equal(tnt.heldBy, "a");
  run(g, secs(0.6));
  g.setInput("a", 0, 1);
  g.grab("a");
  assert.ok(tnt.heldBy === null && tnt.vz > 1.5, `${tnt.vz}`);
});

test("a hit makes a fighter drop what it carries; nobody breaks free on a timer", () => {
  const g = playing(["a", "b", "c"]);
  open(g);
  const a = place(seat(g, "a"), 0, 0, 0);
  const b = place(seat(g, "b"), 0, 0.7, Math.PI);
  place(seat(g, "c"), 6, 6);
  g.grab("a");
  run(g, 6);
  assert.equal(b.heldBy, "a");
  g.hurt(a, 100, "c", "punch", 0, 0, 0);
  assert.equal(a.holdFighter, null);
  assert.equal(b.heldBy, null);
  run(g, secs(1));
  place(a, 0, 0, 0);
  place(b, 0, 0.7, Math.PI);
  g.grab("a");
  run(g, 6);
  assert.equal(b.heldBy, "a");
  run(g, secs(4));
  assert.equal(b.heldBy, "a", "still carried");
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
