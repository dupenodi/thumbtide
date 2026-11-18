import assert from "node:assert/strict";
import { test } from "node:test";
import { BOT_NAMES, Bots, appeal, pickAnswer, pickWeighted } from "./bots.ts";
import { BOT_ANSWERS, CATS, PROMPTS } from "./prompts.ts";
import { BEATS, MAX_LEN, MAX_SEATS, Punchline, SWEEP, VOTE_POINTS, cleanAnswer, scoreRound, seeded, type Options } from "./rules.ts";
import { answerSize } from "./view.ts";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
const opts = (o: Partial<Options> = {}): Options => ({ rounds: 5, time: 60, family: false, ...o });

/** A game with n seats, in the write phase of round 0. */
function writing(n: number, seed = 1, o: Partial<Options> = {}) {
  const g = new Punchline(opts(o), seeded(seed));
  for (const id of ids(n)) g.addSeat(id, id.toUpperCase(), false);
  g.startMatch();
  assert.equal(g.phase, "intro");
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
  return g;
}
/** Everyone answers "<id> says hi". */
function answerAll(g: Punchline) {
  for (const s of g.players()) assert.ok(g.answer(s.id, g.key(), `${s.id} says hi`));
}
/** Everyone answers, and the grace runs out: the vote opens. */
function toVote(g: Punchline) {
  answerAll(g);
  g.advance(BEATS.grace);
  assert.equal(g.phase, "vote");
}
/** Index (into shown) of the answer written by `id`. */
const shownOf = (g: Punchline, id: string) => g.shown.findIndex((ei) => g.entries[ei]!.author === id);

// ------------------------------------------------------------------ one prompt for everybody

test("every player gets the same single prompt, and the prompt differs from round to round", () => {
  const g = writing(5, 3, { rounds: 5 });
  const first = g.prompt!;
  for (const id of ids(5)) {
    const t = g.task(id)!;
    assert.equal(t.prompt.id, first.id);
    assert.equal(t.key, g.key());
  }
  const seen = new Set([first.id]);
  for (let r = 1; r < 5; r++) {
    toVote(g);
    g.advance(BEATS.vote); // the vote times out
    g.advance(10 ** 6); // the reveal runs out
    assert.equal(g.phase, "scores");
    g.advance(BEATS.scores);
    g.advance(BEATS.intro);
    assert.equal(g.phase, "write");
    assert.equal(g.round, r);
    assert.ok(!seen.has(g.prompt!.id), "no repeat within a match");
    seen.add(g.prompt!.id);
  }
});

test("the family filter only draws family prompts", () => {
  for (let seed = 1; seed <= 8; seed++) {
    const g = writing(3, seed, { family: true, rounds: 10 });
    for (let r = 0; r < 10; r++) {
      assert.ok(g.prompt!.fam, g.prompt!.text);
      if (r === 9) break;
      toVote(g);
      g.advance(10 ** 6);
      g.advance(10 ** 6);
      g.advance(BEATS.scores);
      g.advance(BEATS.intro);
    }
  }
});

// ------------------------------------------------------------------ answers

test("answers are trimmed, spaces collapsed, control characters dropped, cut to the limit", () => {
  assert.equal(cleanAnswer("  hello \n\t world  "), "hello world");
  assert.equal(cleanAnswer("a\u0000b‮c"), "a b c");
  assert.equal(cleanAnswer(42), "");
  assert.equal(cleanAnswer("   "), "");
  assert.equal(cleanAnswer("x".repeat(200)).length, MAX_LEN);
  assert.equal(Array.from(cleanAnswer("😀".repeat(200))).length, MAX_LEN);
  assert.equal(cleanAnswer("<b>hi</b>"), "<b>hi</b>"); // kept as text; the view escapes it
});

test("an answer counts only while writing, with the right key, and can be changed until writing ends", () => {
  const g = writing(4);
  assert.equal(g.answer("p0", "0:9", "stale key"), false);
  assert.equal(g.answer("p0", g.key(), "   "), false);
  assert.equal(g.answer("nobody", g.key(), "hi"), false);
  assert.ok(g.answer("p0", g.key(), "first"));
  assert.equal(g.task("p0")!.text, "first");
  assert.ok(g.answer("p0", g.key(), "second"));
  assert.equal(g.task("p0")!.text, "second");
  g.advance(60_000);
  assert.equal(g.answer("p0", g.key(), "too late"), false);
});

test("writing ends a few seconds after the last answer, not at once, so answers can still be edited", () => {
  const g = writing(4);
  for (const id of ids(3)) g.answer(id, g.key(), `${id} here`);
  g.advance(20_000);
  assert.equal(g.phase, "write");
  g.answer("p3", g.key(), "last one");
  assert.equal(g.phase, "write");
  assert.ok(g.answer("p3", g.key(), "last one, changed"));
  g.advance(BEATS.grace - 100);
  assert.equal(g.phase, "write");
  g.advance(100);
  assert.equal(g.phase, "vote");
  assert.equal(g.entries.find((e) => e.author === "p3")!.text, "last one, changed");
});

test("grace never extends the deadline", () => {
  const g = writing(3, 1, { time: 45 });
  g.advance(44_000);
  answerAll(g);
  g.advance(1000);
  assert.equal(g.phase, "vote");
});

test("on the deadline, an answer that never came is left out of the vote", () => {
  const g = writing(4, 2);
  g.answer("p0", g.key(), "one");
  g.answer("p1", g.key(), "two");
  g.answer("p2", g.key(), "three");
  g.advance(60_000);
  assert.equal(g.phase, "vote");
  assert.equal(g.shown.length, 3);
  assert.ok(g.shown.every((ei) => g.entries[ei]!.author !== "p3"));
  // p3 may vote on all three
  assert.deepEqual(g.options("p3"), [0, 1, 2]);
});

test("fewer than two real answers: no vote, the round is skipped", () => {
  const g = writing(3);
  g.answer("p0", g.key(), "only me");
  g.advance(60_000);
  assert.equal(g.phase, "scores");
  assert.ok(g.standings().every((s) => s.score === 0));
  g.advance(BEATS.scores);
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
  assert.equal(g.round, 1);
});

// ------------------------------------------------------------------ votes

test("the TV order is shuffled and anonymous, and nobody can vote for their own answer", () => {
  const g = writing(6, 5);
  toVote(g);
  assert.equal(g.shown.length, 6);
  assert.deepEqual([...g.shown].sort(), [0, 1, 2, 3, 4, 5]);
  for (const id of ids(6)) {
    const mine = shownOf(g, id);
    assert.equal(g.vote(id, g.key(), mine), false, "self vote refused");
    assert.ok(!g.options(id).includes(mine));
    assert.equal(g.options(id).length, 5);
  }
  assert.equal(g.votes.size, 0);
});

test("shuffles differ between seeds (the order is not the seat order)", () => {
  const orders = new Set<string>();
  for (let seed = 1; seed <= 12; seed++) {
    const g = writing(6, seed);
    toVote(g);
    orders.add(g.shown.join());
  }
  assert.ok(orders.size > 3);
});

test("vote rules: bad picks and stale keys are refused, a vote can change, the vote closes when the last voter is in", () => {
  const g = writing(4);
  toVote(g);
  const k = g.key();
  const a = g.options("p0");
  assert.equal(g.vote("p0", k, 99), false);
  assert.equal(g.vote("p0", k, "x"), false);
  assert.equal(g.vote("p0", "0:7", a[0]), false);
  assert.ok(g.vote("p0", k, a[0]));
  assert.ok(g.vote("p0", k, a[1]));
  assert.equal(g.votes.get("p0"), a[1]);
  assert.equal(g.votes.size, 1);
  for (const id of ["p1", "p2"]) assert.ok(g.vote(id, k, g.options(id)[0]));
  assert.equal(g.phase, "vote");
  assert.ok(g.vote("p3", k, g.options("p3")[0]));
  assert.equal(g.phase, "reveal");
  assert.equal(g.vote("p3", k, g.options("p3")[1]), false, "no voting after the vote closes");
});

test("the vote closes on the deadline with whoever voted", () => {
  const g = writing(5);
  toVote(g);
  g.vote("p0", g.key(), g.options("p0")[0]);
  g.advance(BEATS.vote);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.votes.reduce((a, b) => a + b, 0), 1);
});

// ------------------------------------------------------------------ scoring

test("scoring: 100 per vote, +200 for taking every vote", () => {
  assert.deepEqual(scoreRound([2, 1, 0]).points, [200, 100, 0]);
  const sweep = scoreRound([3, 0, 0]);
  assert.equal(sweep.sweep, 0);
  assert.deepEqual(sweep.points, [3 * VOTE_POINTS + SWEEP, 0, 0]);
  assert.equal(scoreRound([1, 0, 0]).sweep, -1, "a single vote is not a sweep");
  assert.deepEqual(scoreRound([0, 0, 0]).points, [0, 0, 0]);
  assert.deepEqual(scoreRound([0, 0, 0]).top, []);
  assert.deepEqual(scoreRound([2, 2, 0]).top, [0, 1]);
  assert.equal(scoreRound([2, 2, 0]).sweep, -1);
});

test("a round awards the points to the authors and keeps a running score", () => {
  const g = writing(4);
  toVote(g);
  const star = "p1";
  for (const id of ids(4)) {
    if (id === star) g.vote(id, g.key(), g.options(id)[0]);
    else g.vote(id, g.key(), shownOf(g, star));
  }
  assert.equal(g.phase, "reveal");
  const s = g.seats.get(star)!;
  // everyone else voted for p1 except p1 himself, who voted for someone else: 3 of 4 votes, not a sweep
  assert.equal(g.result!.votes[shownOf(g, star)], 3);
  assert.equal(s.gained, 300);
  assert.equal(s.score, 300);
  assert.equal(g.result!.sweep, -1);
});

test("a clean sweep: every vote cast goes to one answer", () => {
  const g = writing(3);
  toVote(g);
  // p0 and p1 both vote for p2; p2 votes for p0 would break the sweep, so p2 does not vote
  g.vote("p0", g.key(), shownOf(g, "p2"));
  g.vote("p1", g.key(), shownOf(g, "p2"));
  g.advance(BEATS.vote);
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.sweep, shownOf(g, "p2"));
  assert.equal(g.seats.get("p2")!.score, 2 * VOTE_POINTS + SWEEP);
});

test("round flow: reveal, then standings, then the next round; the last reveal ends the match", () => {
  const g = writing(3, 1, { rounds: 5 });
  for (let r = 0; r < 5; r++) {
    assert.equal(g.round, r);
    toVote(g);
    g.advance(BEATS.vote);
    assert.equal(g.phase, "reveal");
    g.advance(10 ** 6);
    if (r < 4) {
      assert.equal(g.phase, "scores");
      g.advance(BEATS.scores);
      assert.equal(g.phase, "intro");
      g.advance(BEATS.intro);
    }
  }
  assert.equal(g.phase, "end");
  assert.ok(g.winners().length >= 1);
  assert.equal(g.standings()[0]!.score, g.winners()[0]!.score);
});

test("the rounds setting decides the match length (5, 8, 10)", () => {
  for (const rounds of [5, 8, 10]) {
    const g = writing(3, 4, { rounds });
    const played = new Set<number>();
    while (g.phase !== "end") {
      if (g.phase === "write") {
        played.add(g.round);
        answerAll(g);
      }
      if (g.phase === "vote") for (const v of g.voters()) g.vote(v.id, g.key(), g.options(v.id)[0]);
      g.advance(1000);
    }
    assert.equal(played.size, rounds);
  }
});

test("a tie shares the win", () => {
  const g = writing(3);
  toVote(g);
  g.advance(BEATS.vote); // nobody voted
  assert.equal(g.winners().length, 3);
});

// ------------------------------------------------------------------ seats

test("a newcomer joins at the next round: may vote now, answers next round", () => {
  const g = writing(3);
  assert.ok(g.addSeat("late", "Late", false));
  assert.equal(g.task("late"), null);
  assert.equal(g.answer("late", g.key(), "hello"), false);
  toVote(g);
  assert.equal(g.options("late").length, 3);
  assert.ok(g.vote("late", g.key(), g.options("late")[0]));
  g.advance(BEATS.vote);
  g.advance(10 ** 6);
  g.advance(BEATS.scores);
  g.advance(BEATS.intro);
  assert.equal(g.phase, "write");
  assert.equal(g.players().length, 4);
  assert.ok(g.task("late"));
});

test("a leaver's answer stays in the vote; they cannot vote; writing does not wait for them", () => {
  const g = writing(4);
  g.answer("p3", g.key(), "my parting shot");
  g.removeSeat("p3");
  assert.ok(g.seats.get("p3")!.left);
  assert.equal(g.canVote("p3"), false);
  g.answer("p0", g.key(), "a");
  g.answer("p1", g.key(), "b");
  g.answer("p2", g.key(), "c");
  g.advance(BEATS.grace);
  assert.equal(g.phase, "vote");
  assert.equal(g.shown.length, 4);
  assert.ok(g.shown.some((ei) => g.entries[ei]!.text === "my parting shot"));
  assert.equal(g.voters().length, 3);
  // the vote closes without the leaver
  for (const id of ["p0", "p1", "p2"]) g.vote(id, g.key(), shownOf(g, "p3"));
  assert.equal(g.phase, "reveal");
  assert.equal(g.result!.sweep, shownOf(g, "p3"));
  g.advance(10 ** 6);
  g.advance(BEATS.scores);
  g.advance(BEATS.intro);
  assert.ok(!g.seats.has("p3"), "the leaver's seat goes at the next round");
});

test("a leaver without an answer does not hold up writing", () => {
  const g = writing(4);
  g.answer("p0", g.key(), "a");
  g.answer("p1", g.key(), "b");
  g.answer("p2", g.key(), "c");
  g.removeSeat("p3");
  g.advance(BEATS.grace);
  assert.equal(g.phase, "vote");
  assert.equal(g.shown.length, 3);
});

test("someone leaving mid-vote lets the vote close when the rest are in", () => {
  const g = writing(4);
  toVote(g);
  for (const id of ["p0", "p1"]) g.vote(id, g.key(), g.options(id)[0]);
  g.vote("p2", g.key(), g.options("p2")[0]);
  assert.equal(g.phase, "vote");
  g.removeSeat("p3");
  assert.equal(g.phase, "reveal");
});

test("with fewer than 3 seats at the next round the game waits; ready() starts it again", () => {
  const g = writing(3);
  toVote(g);
  g.advance(BEATS.vote);
  g.advance(10 ** 6);
  g.removeSeat("p2"); // between rounds: gone at once
  g.advance(BEATS.scores);
  g.advance(BEATS.intro);
  assert.equal(g.phase, "wait");
  g.addSeat("n", "N", false);
  assert.ok(g.ready());
  assert.equal(g.phase, "intro");
});

test("eight seats work; a ninth is refused", () => {
  const g = new Punchline(opts(), seeded(2));
  for (const id of ids(MAX_SEATS)) assert.ok(g.addSeat(id, id, false));
  assert.equal(g.addSeat("extra", "Extra", false), false);
  g.startMatch();
  g.advance(BEATS.intro);
  toVote(g);
  assert.equal(g.shown.length, 8);
});

test("a restart starts over with zero scores", () => {
  const g = writing(3);
  toVote(g);
  g.vote("p0", g.key(), g.options("p0")[0]);
  g.advance(BEATS.vote);
  assert.ok([...g.seats.values()].some((s) => s.score > 0));
  g.startMatch();
  assert.equal(g.round, 0);
  assert.ok([...g.seats.values()].every((s) => s.score === 0));
  assert.equal(g.phase, "intro");
});

test("the same seed replays the same match", () => {
  const run = () => {
    const g = writing(5, 9);
    toVote(g);
    return `${g.prompt!.id}:${g.shown.join()}`;
  };
  assert.equal(run(), run());
});

// ------------------------------------------------------------------ the writing

test("at least 150 prompts, 40 of them family-friendly, all original-looking and short enough for the sign", () => {
  assert.ok(PROMPTS.length >= 150, `${PROMPTS.length} prompts`);
  assert.ok(PROMPTS.filter((p) => p.fam).length >= 40);
  assert.equal(new Set(PROMPTS.map((p) => p.text)).size, PROMPTS.length, "no duplicates");
  for (const p of PROMPTS) {
    assert.ok(p.text.length <= 110, p.text);
    assert.ok(p.text.includes("_____"), `blank: ${p.text}`);
    assert.ok(CATS.includes(p.cat));
  }
  for (const cat of CATS) assert.ok(PROMPTS.some((p) => p.cat === cat && p.fam), `family ${cat}`);
});

test("at least 120 bot answers, covering every kind, short enough to fit a card", () => {
  assert.ok(BOT_ANSWERS.length >= 120, `${BOT_ANSWERS.length} answers`);
  assert.equal(new Set(BOT_ANSWERS.map((a) => a.text)).size, BOT_ANSWERS.length, "no duplicates");
  for (const a of BOT_ANSWERS) assert.ok(Array.from(a.text).length <= MAX_LEN, a.text);
  for (const cat of CATS) {
    assert.ok(BOT_ANSWERS.some((a) => a.cat === cat && a.fam), `family answers for ${cat}`);
  }
  assert.ok(BOT_ANSWERS.filter((a) => a.fam).length >= 40);
});

test("bot answers: the right kind for the prompt, no repeats in a match, family mode stays tame", () => {
  const rng = seeded(4);
  const used = new Set<string>();
  const prompt = PROMPTS.find((p) => p.cat === "line")!;
  for (let i = 0; i < 12; i++) {
    const t = pickAnswer(prompt, rng, used, false);
    assert.equal(BOT_ANSWERS.find((a) => a.text === t)!.cat, "line");
  }
  assert.equal(used.size, 12);
  for (const p of PROMPTS) {
    const t = pickAnswer(p, rng, new Set<string>(), true);
    assert.ok(BOT_ANSWERS.find((a) => a.text === t)!.fam, t);
  }
});

test("bots vote with a mild lean towards shorter answers", () => {
  assert.ok(appeal("short") > appeal("x".repeat(70)));
  assert.ok(appeal("x".repeat(70)) > 0.3, "only a mild lean");
  const rng = seeded(8);
  const texts = ["tiny", "x".repeat(70)];
  const hits = [0, 0];
  for (let i = 0; i < 2000; i++) hits[pickWeighted(texts, [0, 1], rng)]!++;
  assert.ok(hits[0]! > hits[1]!);
  assert.ok(hits[1]! > 500);
});

test("bots alone play whole matches to the end, never vote for themselves, and never leave a round stuck", () => {
  for (const [n, rounds] of [[3, 5], [5, 8], [8, 10]] as const) {
    const rng = seeded(n);
    const g = new Punchline(opts({ rounds, time: 45 }), rng);
    for (let i = 0; i < n; i++) g.addSeat(`bot-${i}`, BOT_NAMES[i]!, true);
    const bots = new Bots(g, rng);
    g.startMatch();
    let ms = 0;
    let answered = 0;
    while (g.phase !== "end" && ms < 40 * 60_000) {
      g.advance(100);
      bots.step();
      ms += 100;
      if (g.phase === "vote") {
        for (const [id, k] of g.votes) assert.ok(!g.options(id).every((o) => o !== k), "voted for an offered answer");
        for (const [id, k] of g.votes) assert.notEqual(g.entries[g.shown[k]!]!.author, id);
      }
      if (g.phase === "write") answered = Math.max(answered, g.entries.filter((e) => e.text).length);
    }
    assert.equal(g.phase, "end", `${n} bots, ${rounds} rounds, ${(ms / 60000).toFixed(1)} min`);
    assert.ok(answered >= 2);
    assert.ok(ms / 60000 < rounds * 1.5 + 1, `match length ${(ms / 60000).toFixed(1)} min`);
    assert.ok(g.standings().some((s) => s.score > 0));
  }
});

test("a bot that was a leaver stays out: left seats do not answer or vote", () => {
  const rng = seeded(2);
  const g = new Punchline(opts(), rng);
  for (let i = 0; i < 4; i++) g.addSeat(`p${i}`, `P${i}`, false);
  const bots = new Bots(g, rng);
  g.startMatch();
  g.advance(BEATS.intro);
  g.removeSeat("p0");
  for (let i = 0; i < 400; i++) {
    g.advance(100);
    bots.step();
  }
  assert.equal(g.entries.find((e) => e.author === "p0")!.text, null);
});

// ------------------------------------------------------------------ the TV vote screen

test("vote screen text is never under 36 px, and shrinks as answers get longer", () => {
  for (let n = 2; n <= 8; n++) {
    for (let len = 1; len <= MAX_LEN; len++) assert.ok(answerSize(len, n) >= 36);
  }
  assert.ok(answerSize(10, 8) > answerSize(MAX_LEN, 8));
  assert.ok(answerSize(10, 3) > answerSize(10, 8));
});
