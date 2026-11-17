import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseClue, choosePick, createBots, link } from "./bots.ts";
import { DECK, WORDS } from "./deck.ts";
import { BEATS, MAX_SEATS, STOP, Spyline, checkClue, other, seeded, type SpyEvent, type Team } from "./rules.ts";
import { wordSize } from "./view.ts";

/** A game with these people (and no bots), dealt and past the briefing, waiting for the first clue. */
function dealt(ids: string[], seed = 1, opts = {}) {
  const g = new Spyline(opts, seeded(seed));
  for (const id of ids) g.addSeat(id, id.toUpperCase());
  g.startMatch();
  g.step(BEATS.brief);
  assert.equal(g.phase, "clue");
  return g;
}
const handlerOf = (g: Spyline, t: Team = g.turn) => g.handler[t]!;
const agentsOf = (g: Spyline, t: Team = g.turn) => g.agents(t).map((s) => s.id);
/** A fair clue for this board. */
const fair = (g: Spyline) => ["zebra", "quasar", "tundra", "voltage", "harmonic"].find((w) => !checkClue(w, g.cards.map((c) => c.word)))!;
const cardOf = (g: Spyline, owner: string, skip = 0) => g.cards.map((c, i) => ({ c, i })).filter(({ c }) => c.owner === owner && !c.revealed)[skip]!.i;
const of = <T extends SpyEvent["type"]>(ev: SpyEvent[], t: T) => ev.filter((e) => e.type === t) as Extract<SpyEvent, { type: T }>[];

test("the deck: at least 400 single lowercase words, short enough for a TV card, each with at least 4 clue words", () => {
  assert.ok(WORDS.length >= 400, `only ${WORDS.length}`);
  assert.equal(new Set(WORDS).size, WORDS.length);
  for (const w of WORDS) {
    assert.match(w, /^[a-z]+$/, w);
    assert.ok(w.length <= 10, `${w} is too long for a card`);
    assert.ok(wordSize(w) * w.length * 0.6 <= 214, `${w} doesn't fit at ${wordSize(w)}px`);
    assert.ok(wordSize(w) >= 34);
    assert.ok(DECK.get(w)!.length >= 4, `${w} needs more clue words`);
    for (const c of DECK.get(w)!) assert.match(c, /^[a-z]+$/, `${w}: ${c}`);
  }
});

test("a round deals 25 cards: 9 for the team that starts, 8 for the other, 7 bystanders, 1 burn", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const n = (o: string) => g.cards.filter((c) => c.owner === o).length;
  assert.equal(g.cards.length, 25);
  assert.equal(new Set(g.cards.map((c) => c.word)).size, 25);
  assert.equal(n(g.starter), 9);
  assert.equal(n(other(g.starter)), 8);
  assert.equal(n("neutral"), 7);
  assert.equal(n("burn"), 1);
  assert.equal(g.turn, g.starter);
});

test("the same seed deals the same board", () => {
  const a = dealt(["a", "b", "c", "d"], 9);
  const b = dealt(["a", "b", "c", "d"], 9);
  assert.deepEqual(a.cards, b.cards);
});

test("teams are balanced; with odd numbers the bigger team starts second", () => {
  for (let seed = 1; seed < 20; seed++) {
    const g = dealt(["a", "b", "c", "d", "e"], seed);
    const c = g.team("cobalt").length;
    const s = g.team("saffron").length;
    assert.equal(Math.abs(c - s), 1);
    assert.equal(g.starter, c < s ? "cobalt" : "saffron");
  }
  // even teams take turns starting
  const g = dealt(["a", "b", "c", "d"], 3, { rounds: 5 });
  const first = g.starter;
  g.wins[first] = 0;
  const r = g as unknown as { startRound(): void };
  r.startRound();
  assert.equal(g.starter, other(first));
});

test("people are dealt first and spread over both teams", () => {
  const g = new Spyline({}, seeded(4));
  g.addSeat("ana", "Ana");
  g.addSeat("ben", "Ben");
  g.wantBots = 2;
  g.startMatch();
  assert.notEqual(g.seat("ana")!.team, g.seat("ben")!.team);
  assert.equal(g.seats.length, 4);
});

test("clue check: one word of letters, not on the board and not part of a board word", () => {
  const board = ["fireplace", "anchor", "ship"];
  assert.equal(checkClue("ocean", board), null);
  assert.ok(checkClue("", board));
  assert.ok(checkClue("two words", board));
  assert.ok(checkClue("r2d2", board));
  assert.ok(checkClue("x", board));
  assert.match(checkClue("Anchor", board)!, /on the board/);
  assert.match(checkClue("ships", board)!, /on the board/);
  assert.match(checkClue("fire", board)!, /Too close/);
  assert.match(checkClue("place", board)!, /Too close/);
  assert.match(checkClue("shipwreck", board)!, /Too close/);
  assert.equal(checkClue("tea", ["steak"]), null);
  assert.equal(checkClue("planet", ["net"]), null);
  assert.match(checkClue("netting", ["nett"]) ?? "", /Too close/);
});

test("only the handler on turn can give a clue, and a bad clue is refused", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const agent = agentsOf(g)[0]!;
  assert.ok(g.giveClue(agent, "zebra", 2));
  assert.ok(g.giveClue(handlerOf(g, other(g.turn)), "zebra", 2));
  assert.ok(g.giveClue(handlerOf(g), g.cards[0]!.word, 2));
  assert.ok(g.giveClue(handlerOf(g), "zebra", 0));
  assert.equal(g.phase, "clue");
  assert.equal(g.giveClue(handlerOf(g), fair(g), 2), null);
  assert.equal(g.phase, "guess");
  assert.equal(g.maxGuesses, 3);
});

test("a card needs more than half of the team's agents", () => {
  const sizes: Array<[number, number]> = [[1, 1], [2, 2], [3, 2], [4, 3], [5, 3]];
  for (const [agents, need] of sizes) {
    const ids = Array.from({ length: (agents + 1) * 2 }, (_, i) => `p${i}`);
    const g = dealt(ids, 2);
    // even teams: the starting team has agents+1 seats
    assert.equal(g.agents(g.turn).length, agents);
    assert.equal(g.need(g.turn), need, `${agents} agents`);
    g.giveClue(handlerOf(g), fair(g), 1);
    const target = cardOf(g, g.turn);
    const team = agentsOf(g);
    for (let k = 0; k < need - 1; k++) g.propose(team[k]!, target);
    assert.equal(g.cards[target]!.revealed, false);
    g.propose(team[need - 1]!, target);
    assert.equal(g.cards[target]!.revealed, true, `${agents} agents, ${need} picks`);
  }
});

test("with one agent a tap reveals at once; handlers and the other team can't pick", () => {
  const g = dealt(["a", "b", "c", "d"]);
  g.giveClue(handlerOf(g), fair(g), 2);
  const t = cardOf(g, g.turn);
  assert.equal(g.propose(handlerOf(g), t), false);
  assert.equal(g.propose(agentsOf(g, other(g.turn))[0]!, t), false);
  assert.equal(g.propose(agentsOf(g)[0]!, t), true);
  assert.equal(g.phase, "reveal");
  assert.equal(g.cards[t]!.revealed, true);
});

test("guesses: up to number + 1, then the turn passes", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const team = g.turn;
  g.giveClue(handlerOf(g), fair(g), 1);
  const ag = agentsOf(g)[0]!;
  g.propose(ag, cardOf(g, team));
  g.step(BEATS.reveal);
  assert.equal(g.phase, "guess");
  g.propose(ag, cardOf(g, team));
  g.step(BEATS.reveal);
  assert.equal(g.phase, "clue");
  assert.equal(g.turn, other(team));
  const ev = of(g.drainEvents(), "turn");
  assert.equal(ev.at(-1)!.why, "done");
});

test("a wrong card ends the turn; a bystander too", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const team = g.turn;
  g.giveClue(handlerOf(g), fair(g), 3);
  g.propose(agentsOf(g)[0]!, cardOf(g, "neutral"));
  g.step(BEATS.reveal);
  assert.equal(g.turn, other(team));
  assert.equal(of(g.drainEvents(), "turn").at(-1)!.why, "wrong");
  g.giveClue(handlerOf(g), fair(g), 3);
  g.propose(agentsOf(g)[0]!, cardOf(g, team));
  g.step(BEATS.reveal);
  assert.equal(g.turn, team);
});

test("stop: only after one card, and it needs a majority too", () => {
  const g = dealt(["a", "b", "c", "d", "e", "f"]);
  const team = g.turn;
  g.giveClue(handlerOf(g), fair(g), 2);
  const [x, y] = agentsOf(g);
  assert.equal(g.propose(x!, STOP), false);
  const t = cardOf(g, team);
  g.propose(x!, t);
  g.propose(y!, t);
  g.step(BEATS.reveal);
  assert.equal(g.propose(x!, STOP), true);
  assert.equal(g.phase, "guess");
  g.propose(y!, STOP);
  assert.equal(g.phase, "clue");
  assert.equal(g.turn, other(team));
});

test("a pick can be taken back", () => {
  const g = dealt(["a", "b", "c", "d", "e", "f"]);
  g.giveClue(handlerOf(g), fair(g), 2);
  const [x, y] = agentsOf(g);
  const t = cardOf(g, g.turn);
  g.propose(x!, t);
  g.propose(x!, null);
  g.propose(y!, t);
  assert.equal(g.cards[t]!.revealed, false);
});

test("the burn card loses the round at once", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const team = g.turn;
  g.giveClue(handlerOf(g), fair(g), 2);
  g.propose(agentsOf(g)[0]!, cardOf(g, "burn"));
  g.step(BEATS.reveal);
  assert.equal(g.phase, "round");
  assert.equal(g.roundWinner, other(team));
  assert.equal(g.roundWhy, "burn");
  assert.equal(g.wins[other(team)], 1);
});

test("revealing the other team's last card wins the round for them", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const team = g.turn;
  const opp = other(team);
  g.cards.forEach((c) => {
    if (c.owner === opp) c.revealed = true;
  });
  const last = g.cards.findIndex((c) => c.owner === opp);
  g.cards[last]!.revealed = false;
  g.giveClue(handlerOf(g), fair(g), 2);
  g.propose(agentsOf(g)[0]!, last);
  g.step(BEATS.reveal);
  assert.equal(g.phase, "round");
  assert.equal(g.roundWinner, opp);
  assert.equal(g.roundWhy, "cards");
});

test("best of 3: two round wins take the match, then it can start again", () => {
  const g = dealt(["a", "b", "c", "d"], 5, { rounds: 3 });
  const win = (t: Team) => {
    if (g.phase !== "clue") g.step(BEATS.brief);
    g.cards.forEach((c) => {
      if (c.owner === t) c.revealed = true;
    });
    const last = g.cards.findIndex((c) => c.owner === t);
    g.cards[last]!.revealed = false;
    g.giveClue(handlerOf(g), fair(g), 1);
    g.propose(agentsOf(g)[0]!, last);
    g.step(BEATS.reveal);
    assert.equal(g.phase, "round");
    g.step(BEATS.round);
  };
  win("cobalt");
  assert.equal(g.phase, "brief");
  assert.equal(g.round, 2);
  win("cobalt");
  assert.equal(g.phase, "match");
  assert.equal(g.matchWinner, "cobalt");
  g.startMatch();
  assert.equal(g.round, 1);
  assert.deepEqual(g.wins, { cobalt: 0, saffron: 0 });
});

test("handlers rotate each round", () => {
  const g = dealt(["a", "b", "c", "d", "e", "f"], 7, { rounds: 5 });
  const first = { ...g.handler };
  (g as unknown as { startRound(): void }).startRound();
  assert.notEqual(g.handler.cobalt, first.cobalt);
  assert.notEqual(g.handler.saffron, first.saffron);
});

test("a handler who leaves hands over to the next person on the team", () => {
  const g = dealt(["a", "b", "c", "d", "e", "f"]);
  const t = g.turn;
  const h = handlerOf(g);
  const team = g.team(t).map((s) => s.id).filter((id) => id !== h);
  g.removeSeat(h);
  assert.ok(team.includes(g.handler[t]!));
  assert.equal(g.phase, "clue");
  assert.equal(g.giveClue(g.handler[t]!, fair(g), 1), null);
  assert.ok(of(g.drainEvents(), "handler").some((e) => e.team === t));
});

test("in two-a-side, a handler who leaves hands over to their teammate; a computer joins as an agent", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const t = g.turn;
  const h = handlerOf(g);
  const mate = g.team(t).find((x) => x.id !== h)!.id;
  g.removeSeat(h);
  assert.equal(g.handler[t], mate);
  assert.equal(g.team(t).length, 2);
  assert.ok(g.agents(t).every((x) => x.bot));
});

test("a team never drops below two seats: a computer player steps in", () => {
  const g = dealt(["a", "b", "c", "d"]);
  const t = g.turn;
  const agent = agentsOf(g)[0]!;
  g.removeSeat(agent);
  assert.equal(g.team(t).length, 2);
  assert.ok(g.agents(t).every((s) => s.bot));
});

test("a leaver who blocked a majority unblocks it", () => {
  const g = dealt(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]);
  g.giveClue(handlerOf(g), fair(g), 2);
  const [x, y, , w] = agentsOf(g);
  const t = cardOf(g, g.turn);
  g.propose(x!, t);
  g.propose(y!, t);
  assert.equal(g.cards[t]!.revealed, false); // 2 of 4 isn't enough
  g.removeSeat(w!);
  assert.equal(g.cards[t]!.revealed, true); // 2 of 3 is
});

test("a newcomer mid-round joins the smaller team as an agent; a full table gives up a computer seat", () => {
  const g = dealt(["a", "b", "c", "d", "e"]);
  const small = g.team("cobalt").length < g.team("saffron").length ? "cobalt" : "saffron";
  const s = g.addSeat("z", "Z")!;
  assert.equal(s.team, small);
  assert.equal(g.roleOf("z"), "agent");
  const full = new Spyline({}, seeded(1));
  full.addSeat("p", "P");
  full.wantBots = 11;
  full.startMatch();
  assert.equal(full.seats.length, MAX_SEATS);
  assert.ok(full.addSeat("q", "Q"));
  assert.equal(full.seats.length, MAX_SEATS);
  for (let i = 0; i < 11; i++) full.addSeat(`h${i}`, `H${i}`);
  assert.equal(full.addSeat("late", "Late"), null);
});

test("time limits: no clue in time passes the turn; guessing time out ends it", () => {
  const g = dealt(["a", "b", "c", "d"], 1, { clueTime: 90, guessTime: 60 });
  const team = g.turn;
  g.step(90_000);
  assert.equal(g.turn, other(team));
  assert.equal(of(g.drainEvents(), "turn").at(-1)!.why, "no-clue");
  g.giveClue(handlerOf(g), fair(g), 2);
  g.step(60_000);
  assert.equal(g.turn, team);
  assert.equal(of(g.drainEvents(), "turn").at(-1)!.why, "time");
});

test("bots: a handler's clue is fair and points at its own cards, never the burn", () => {
  for (let seed = 1; seed < 60; seed++) {
    const g = dealt(["a", "b", "c", "d"], seed);
    const idea = chooseClue(g.cards, g.turn, seeded(seed));
    assert.equal(checkClue(idea.word, g.cards.map((c) => c.word)), null);
    const burn = g.cards.find((c) => c.owner === "burn")!;
    assert.ok(link(idea.word, burn.word) < 0.3, `${idea.word} → ${burn.word}`);
    for (const i of idea.targets) assert.equal(g.cards[i]!.owner, g.turn);
  }
});

test("bots: an agent finds a card its clue word lists, and follows a person's pick", () => {
  const board = ["anchor", "violin", "cactus", "pizza", "owl"].map((word) => ({ word, revealed: false }));
  const clue = { word: "harbor", n: 1, team: "cobalt" as Team };
  assert.equal(choosePick(board, clue, 0, [], "me", seeded(1), { noise: 0.1, looks: 0 }), 0);
  const person = [{ id: "ana", pick: 3, human: true }];
  let followed = 0;
  for (let s = 1; s <= 40; s++) if (choosePick(board, clue, 0, person, "me", seeded(s), { noise: 0.1, looks: 0 }) === 3) followed++;
  assert.ok(followed > 25, `followed ${followed}/40`);
});

test("bots only: every match ends with a winner", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const g = new Spyline({ rounds: 3 }, seeded(seed));
    const bots = createBots(g, seeded(seed + 100));
    for (let i = 0; i < 4 + (seed % 9); i++) g.addBot();
    g.startMatch();
    let t = 0;
    while (g.phase !== "match" && t < 40 * 60_000) {
      bots.step(100);
      g.step(100);
      t += 100;
    }
    assert.equal(g.phase, "match", `seed ${seed} stalled in ${g.phase}`);
    assert.ok(g.matchWinner);
  }
});
