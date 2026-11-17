import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_NAMES, Bots, appeal, pickAnswer, pickWeighted } from "./bots.ts";
import { BOT_ANSWERS, CATS, PROMPTS } from "./prompts.ts";
import {
  BEATS, FINAL_ROUND, FINAL_SWEEP, FINAL_VOTE, MAX_LEN, MAX_SEATS, Punchline, STAND_IN, SWEEP, cleanAnswer, pairUp,
  scoreFinal, scorePair, seeded, type Pair,
} from "./rules.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A game with n seats, in the write phase of round 0. */
function writing(n: number, seed = 1, time = 90) {
  const g = new Punchline({ time, family: false }, seeded(seed));
  for (const id of ids(n)) g.addSeat(id, id.toUpperCase(), false);
  g.startMatch();
  assert.equal(g.phase, "intro");
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
  return g;
}
/** Everyone answers everything with "<id> <key>". */
function answerAll(g: Punchline) {
  for (const s of g.players()) for (const t of g.tasks(s.id)) assert.ok(g.answer(s.id, t.key, `${s.id} says hi`));
}
const pair = (g: Punchline) => g.current() as Pair;

// ------------------------------------------------------------------ pairing

test("pairing: every player answers exactly two prompts, every prompt has two different authors, no pair twice in a round", () => {
  for (let n = 3; n <= MAX_SEATS; n++) {
    for (let seed = 1; seed <= 60; seed++) {
      const pairs = pairUp(ids(n), new Set(), seeded(seed));
      assert.equal(pairs.length, n);
      const count = new Map<string, number>();
      const seen = new Set<string>();
      for (const [a, b] of pairs) {
        assert.notEqual(a, b);
        assert.ok(!seen.has(key(a, b)), `n=${n} pair twice`);
        seen.add(key(a, b));
        count.set(a, (count.get(a) ?? 0) + 1);
        count.set(b, (count.get(b) ?? 0) + 1);
      }
      for (const id of ids(n)) assert.equal(count.get(id), 2, `n=${n} ${id}`);
    }
  }
});

test("pairing: the second round repeats as few pairs as possible (3, 2, then 0 from five players up)", () => {
  const least = [0, 0, 0, 3, 2, 0, 0, 0, 0];
  for (let n = 3; n <= MAX_SEATS; n++) {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = seeded(seed);
      const first = pairUp(ids(n), new Set(), rng);
      const used = new Set(first.map(([a, b]) => key(a, b)));
      const second = pairUp(ids(n), used, rng);
      assert.equal(second.filter(([a, b]) => used.has(key(a, b))).length, least[n], `n=${n} seed=${seed}`);
    }
  }
});

test("pairing in the game: round 1 avoids round 0's pairs by seat id", () => {
  const g = writing(6, 3);
  const r0 = new Set(g.pairs.map((p) => key(...p.authors)));
  answerAll(g);
  while (g.phase !== "scores") {
    if (g.phase === "vote") for (const v of g.voters()) g.vote(v.id, g.voteKey()!, 0);
    g.advance(500);
  }
  g.advance(BEATS.scores);
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
  assert.equal(g.round, 1);
  assert.equal(g.pairs.filter((p) => r0.has(key(...p.authors))).length, 0);
});

// ------------------------------------------------------------------ answers

test("answers are trimmed, spaces collapsed, control characters dropped, cut to 60 code points", () => {
  assert.equal(cleanAnswer("  hello \n\t world  "), "hello world");
  assert.equal(cleanAnswer("a\u0000b‮c"), "a b c");
  assert.equal(cleanAnswer(42), "");
  assert.equal(cleanAnswer("   "), "");
  const long = "x".repeat(200);
  assert.equal(cleanAnswer(long).length, MAX_LEN);
  const emoji = "😀".repeat(70); // two UTF-16 units each
  assert.equal(Array.from(cleanAnswer(emoji)).length, MAX_LEN);
  assert.equal(cleanAnswer("<b>hi</b>"), "<b>hi</b>"); // kept as text; the view escapes it
});

test("an answer only counts once, for your own prompt, with the right key, while writing", () => {
  const g = writing(4);
  const [t0] = g.tasks("p0");
  const other = g.pairs.find((p) => !p.authors.includes("p0"))!;
  assert.equal(g.answer("p0", other.key, "not mine"), false);
  assert.equal(g.answer("p0", "0:0:99", "stale"), false);
  assert.equal(g.answer("p0", t0!.key, "   "), false);
  assert.ok(g.answer("p0", t0!.key, "first"));
  assert.equal(g.answer("p0", t0!.key, "again"), false);
  assert.equal(g.tasks("p0")[0]!.answer!.text, "first");
});

test("writing ends early once every answer is in", () => {
  const g = writing(5);
  answerAll(g);
  assert.equal(g.phase, "vote");
  assert.equal(g.idx, 0);
});

test("on the deadline, missing answers become stand-ins; a pair of two stand-ins is skipped", () => {
  const g = writing(3, 2, 60);
  // p0 answers both, the rest answer nothing
  for (const t of g.tasks("p0")) g.answer("p0", t.key, "real");
  g.advance(60_000);
  assert.equal(g.phase, "vote");
  for (const p of g.pairs) for (const a of p.answers) assert.ok(a);
  const blank = g.pairs.find((p) => !p.authors.includes("p0"))!;
  assert.deepEqual(blank.answers.map((a) => a!.text), [STAND_IN, STAND_IN]);
  // walk the votes: the double stand-in never comes up
  const shown: string[] = [];
  while ((g.phase as string) !== "scores") {
    if (g.phase === "vote" && !shown.includes(pair(g).key)) shown.push(pair(g).key);
    g.advance(1000);
  }
  assert.equal(shown.length, 2);
  assert.ok(!shown.includes(blank.key));
});

// ------------------------------------------------------------------ votes

test("authors cannot vote on their own pair; the vote closes when the last voter is in", () => {
  const g = writing(5);
  answerAll(g);
  const p = pair(g);
  const k = g.voteKey()!;
  assert.equal(g.vote(p.authors[0], k, 1), false);
  const voters = g.voters().map((s) => s.id);
  assert.equal(voters.length, 3);
  assert.ok(!voters.includes(p.authors[0]) && !voters.includes(p.authors[1]));
  assert.equal(g.vote(voters[0]!, "1:1:0", 0), false, "stale key");
  assert.equal(g.vote(voters[0]!, k, 2), false, "no side 2");
  assert.ok(g.vote(voters[0]!, k, 0));
  assert.ok(g.vote(voters[0]!, k, 1), "a vote can change");
  assert.ok(g.vote(voters[1]!, k, 1));
  assert.equal(g.phase, "vote");
  assert.ok(g.vote(voters[2]!, k, 1));
  assert.equal(g.phase, "reveal");
  // all three on side 1: a clean sweep
  assert.deepEqual(p.result!.votes, [0, 3]);
  assert.equal(p.result!.sweep, 1);
  assert.equal(p.result!.points[1], 1000 + SWEEP);
  assert.equal(g.seats.get(p.authors[1])!.score, 1000 + SWEEP);
});

test("three players: one voter per pair, which is never a sweep", () => {
  const g = writing(3);
  answerAll(g);
  const voters = g.voters();
  assert.equal(voters.length, 1);
  g.vote(voters[0]!.id, g.voteKey()!, 0);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(pair(g).result!.points, [1000, 0]);
  assert.equal(pair(g).result!.sweep, -1);
});

test("scoring: shares of 1000, round 2 doubles, ties and no votes", () => {
  assert.deepEqual(scorePair([1, 2], 1).points, [333, 667]);
  assert.deepEqual(scorePair([2, 2], 2), { votes: [2, 2], points: [1000, 1000], sweep: -1, winner: -1 });
  assert.deepEqual(scorePair([0, 0], 1), { votes: [0, 0], points: [0, 0], sweep: -1, winner: -1 });
  assert.deepEqual(scorePair([0, 4], 2).points, [0, 2000 + 2 * SWEEP]);
  // a stand-in never scores, and beating one is no sweep
  assert.deepEqual(scorePair([3, 0], 1, [true, false]).points, [1000, 0]);
  assert.deepEqual(scorePair([1, 1], 1, [false, true]).points, [0, 500]);
  assert.equal(scorePair([3, 0], 1, [true, false]).sweep, -1);
});

test("no votes before the deadline: nobody scores and the game moves on", () => {
  const g = writing(4);
  answerAll(g);
  const p = pair(g);
  g.advance(BEATS.vote);
  assert.equal(g.phase, "reveal");
  assert.deepEqual(p.result!.points, [0, 0]);
  assert.equal(p.result!.winner, -1);
});

// ------------------------------------------------------------------ leaving and joining

test("a player who leaves mid-write is played by a bot; their seat goes at the next round", () => {
  const g = writing(4);
  const b = new Bots(g, seeded(9));
  g.removeSeat("p2");
  const s = g.seats.get("p2")!;
  assert.ok(s.bot && s.left);
  for (const id of ["p0", "p1", "p3"]) for (const t of g.tasks(id)) g.answer(id, t.key, "ok");
  assert.equal(g.phase, "write");
  for (let i = 0; i < 1000 && g.phase === "write"; i++) {
    g.advance(100);
    b.step();
  }
  assert.equal(g.phase, "vote");
  assert.ok(g.tasks("p2").every((t) => t.answer && !t.answer.missing), "the bot answered for them");
  while (g.phase !== "intro") {
    g.advance(500);
    b.step();
  }
  g.advance(BEATS.intro);
  assert.equal(g.seats.has("p2"), false);
  assert.equal(g.players().length, 3);
});

test("a voter who leaves mid-vote no longer holds the vote open", () => {
  const g = writing(4);
  answerAll(g);
  const [v0, v1] = g.voters();
  g.vote(v0!.id, g.voteKey()!, 0);
  g.removeSeat(v1!.id); // left: a bot now, but bots only act on step()
  assert.equal(g.phase, "vote");
  g.seats.delete(v1!.id); // and once really gone, the last vote closes it
  g.vote(v0!.id, g.voteKey()!, 1);
  assert.equal(g.phase, "reveal");
});

test("a newcomer mid-round votes at once and answers from the next round", () => {
  const g = writing(4);
  g.addSeat("late", "Late", false);
  assert.deepEqual(g.tasks("late"), []);
  answerAll(g);
  assert.ok(g.canVote("late"));
  assert.ok(g.voters().some((s) => s.id === "late"));
});

test("fewer than three seats waits, and ready() starts once there are three", () => {
  const g = new Punchline({ time: 60, family: false }, seeded(1));
  g.addSeat("a", "A", false);
  g.addSeat("b", "B", false);
  g.startMatch();
  g.advance(BEATS.intro);
  assert.equal(g.phase, "wait");
  assert.equal(g.ready(), false);
  g.addSeat("c", "C", true);
  assert.ok(g.ready());
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
});

test("eight seats at most", () => {
  const g = new Punchline({ time: 60, family: false }, seeded(1));
  for (let i = 0; i < 8; i++) assert.ok(g.addSeat(`s${i}`, `S${i}`, false));
  assert.equal(g.addSeat("s8", "S8", false), false);
});

// ------------------------------------------------------------------ the last laugh

function toFinal(n: number, seed = 1) {
  const g = writing(n, seed);
  const b = new Bots(g, seeded(seed));
  for (const s of g.list()) s.bot = true;
  let guard = 0;
  while (!(g.round === FINAL_ROUND && g.phase === "write") && guard++ < 100000) {
    g.advance(100);
    b.step();
  }
  return g;
}

test("the last laugh: one prompt for everyone; you vote for any real answer but your own", () => {
  const g = toFinal(4);
  for (const s of g.list()) s.bot = false;
  assert.equal(g.pairs.length, 0);
  const f = g.final!;
  assert.equal(f.entries.length, 4);
  for (const s of g.players()) assert.equal(g.tasks(s.id)[0]!.key, f.key);
  // three answer, one does not
  const [a, b, c, d] = f.entries.map((e) => e.author);
  g.answer(a!, f.key, "A!");
  g.answer(b!, f.key, "B!");
  g.answer(c!, f.key, "C!");
  g.advance(90_000);
  assert.equal(g.phase, "vote");
  const own = f.entries.findIndex((e) => e.author === a);
  const blank = f.entries.findIndex((e) => e.author === d);
  assert.equal(g.vote(a!, f.key, own), false, "not your own");
  assert.equal(g.vote(a!, f.key, blank), false, "not a stand-in");
  assert.ok(!g.options(d!).includes(blank));
  assert.equal(g.options(d!).length, 3, "the one without an answer still votes");
  const top = f.entries.findIndex((e) => e.author === b);
  g.vote(a!, f.key, top);
  g.vote(c!, f.key, top);
  g.vote(d!, f.key, top);
  assert.equal(g.phase, "vote", "b has not voted yet");
  g.vote(b!, f.key, f.entries.findIndex((e) => e.author === c));
  assert.equal(g.phase, "reveal");
  assert.deepEqual(f.result!.top, [top]);
  assert.equal(f.result!.sweep, f.entries.findIndex((e) => e.author === b), "everyone else voted for b: a sweep");
  g.advance(60_000);
  assert.equal(g.phase, "end");
  assert.equal(g.winners().length >= 1, true);
});

test("final scoring: 500 a vote, and every vote on one answer is a sweep", () => {
  assert.deepEqual(scoreFinal([0, 3, 0]).points, [0, 3 * FINAL_VOTE + FINAL_SWEEP, 0]);
  assert.deepEqual(scoreFinal([1, 1, 0]).top, [0, 1]);
  assert.deepEqual(scoreFinal([0, 0]).top, []);
  assert.equal(scoreFinal([1]).sweep, -1, "one vote is no sweep");
  // the top author voted too (for someone else): every other vote on them is still a sweep
  assert.equal(scoreFinal([3, 1, 0], [true, true, true]).sweep, 0);
  assert.equal(scoreFinal([2, 1, 1], [true, true, true]).sweep, -1);
});

test("a full bots-only match ends with a winner, in a sensible time", () => {
  for (const n of [3, 5, 8]) {
    const g = new Punchline({ time: 90, family: true }, seeded(n));
    for (let i = 0; i < n; i++) g.addSeat(`bot-${i}`, BOT_NAMES[i]!, true);
    const b = new Bots(g, seeded(n + 100));
    g.startMatch();
    let t = 0;
    while (g.phase !== "end" && t < 30 * 60_000) {
      g.advance(100);
      b.step();
      t += 100;
    }
    assert.equal(g.phase, "end", `n=${n}`);
    assert.ok(t < 8 * 60_000, `n=${n} took ${t / 1000}s`);
    assert.ok(g.winners()[0]!.score > 0);
    // family mode: only family prompts
    assert.ok(g.final!.prompt.fam);
  }
});

// ------------------------------------------------------------------ prompts and bots

test("prompts: 200+ unique, short enough for the sign; enough of every kind in family mode", () => {
  assert.ok(PROMPTS.length >= 200);
  assert.equal(new Set(PROMPTS.map((p) => p.text.toLowerCase())).size, PROMPTS.length);
  for (const p of PROMPTS) assert.ok(p.text.length <= 110, p.text);
  assert.ok(PROMPTS.filter((p) => p.fam).length >= 150);
  assert.ok(BOT_ANSWERS.length >= 110);
  for (const a of BOT_ANSWERS) assert.equal(cleanAnswer(a.text), a.text, a.text);
  for (const c of CATS) {
    assert.ok(BOT_ANSWERS.filter((a) => a.cat === c && a.fam).length >= 15, c);
    assert.ok(PROMPTS.filter((p) => p.cat === c && p.fam).length >= 15, c);
  }
});

test("bots answer in the prompt's kind, without repeats, and family-safe in family mode", () => {
  const used = new Set<string>();
  const rng = seeded(4);
  const some = CATS.flatMap((c) => PROMPTS.filter((p) => p.cat === c && p.fam).slice(0, 6));
  for (const p of some) {
    const text = pickAnswer(p, rng, used, true);
    const a = BOT_ANSWERS.find((x) => x.text === text)!;
    assert.equal(a.cat, p.cat);
    assert.ok(a.fam);
  }
  assert.equal(used.size, some.length);
});

test("bots lean to the shorter answer and almost never pick a stand-in", () => {
  const rng = seeded(5);
  const short = { text: "Beige Fury", missing: false };
  const long = { text: "a scented candle called The Last Thing My Ex Said To Me", missing: false };
  const stand = { text: STAND_IN, missing: true };
  let s = 0;
  let st = 0;
  for (let i = 0; i < 2000; i++) {
    if (pickWeighted([short, long], [0, 1], rng) === 0) s++;
    if (pickWeighted([stand, long], [0, 1], rng) === 0) st++;
  }
  assert.ok(s > 1100 && s < 1600, `short won ${s}`); // a lean, not a rule
  assert.ok(st < 200, `stand-in won ${st}`);
  assert.ok(appeal(short) > appeal(long));
});
