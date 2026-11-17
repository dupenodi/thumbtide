import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptsOffer, chooseBuild, createBots, reserve, wantsToBuy } from "./bots.ts";
import { BOARD, Boomtown, CARDS, DISTRICTS, FERRIES, MAX_SEATS, SIZE, TUNE, seeded, type BoomEvent } from "./rules.ts";

/** Dice that come out as given (pairs), then random. */
const rigged = (...dice: number[]) => {
  const fallback = seeded(9);
  const q = dice.slice();
  return () => (q.length ? (q.shift()! - 1) / 6 + 0.01 : fallback());
};
function table(n = 3, opts = {}) {
  const g = new Boomtown({ minutes: 30, ...opts }, seeded(3));
  for (let i = 0; i < n; i++) g.join("p" + i, "P" + i);
  g.startMatch();
  return g;
}
const cur = (g: Boomtown) => g.players[g.turn]!;
const idOf = (g: Boomtown, i: number) => g.players[i]!.id;
const run = (g: Boomtown, ms: number) => {
  for (let t = 0; t < ms; t += 50) g.step(50);
};
const kinds = (ev: BoomEvent[]) => ev.map((e) => e.type);
/** Gives the player on the move this roll and plays through the move. */
function rollTo(g: Boomtown, a: number, b: number) {
  g.rng = rigged(a, b);
  assert.equal(g.roll(cur(g).id), null);
  run(g, 4000);
}

test("the board: 28 spaces, 7 districts of 3 plots and 7 specials, two ferries, 20+ cards", () => {
  assert.equal(BOARD.length, SIZE);
  assert.equal(DISTRICTS.length, 7);
  assert.ok(DISTRICTS.every((d) => d.plots.length === 3));
  assert.equal(BOARD.filter((s) => s.kind === "plot").length, 21);
  assert.equal(BOARD.filter((s) => s.kind !== "plot").length, 7);
  assert.equal(BOARD[0]!.kind, "start");
  assert.equal(FERRIES.length, 2);
  assert.equal(new Set(BOARD.map((s) => s.name)).size, SIZE);
  assert.equal(new Set(DISTRICTS.map((d) => d.color)).size, 7);
  assert.ok(CARDS.length >= 20);
  assert.ok(CARDS.every((c) => c.fx.t !== "goto" || c.fx.pos >= 0));
});

test("seats: bots fill a table of one, the cap is six, colours follow the seat", () => {
  const g = new Boomtown({}, seeded(1));
  g.wantBots = 0;
  g.join("a", "Ann");
  g.startMatch();
  assert.equal(g.players.length, 2);
  assert.equal(g.players.filter((p) => p.bot).length, 1);
  const h = new Boomtown({}, seeded(1));
  h.wantBots = 5;
  for (const id of ["a", "b", "c"]) h.join(id, id);
  h.startMatch();
  assert.equal(h.players.length, MAX_SEATS);
  assert.deepEqual(h.players.map((p) => p.color), [0, 1, 2, 3, 4, 5]);
});

test("a roll moves two dice worth, then the turn waits on the space", () => {
  const g = table();
  const p = cur(g);
  g.rng = rigged(2, 3);
  assert.equal(g.roll("nobody"), "Not your roll");
  assert.equal(g.roll(p.id), null);
  assert.equal(g.phase, "move");
  assert.deepEqual(g.dice, [2, 3]);
  run(g, 4000);
  assert.equal(p.pos, 5);
  assert.equal(g.phase, "buy"); // Old Pier's first plot, unowned
  assert.equal(g.buying, 5);
});

test("buy takes the price and gives the plot; the turn ends; rent is due on the next lander", () => {
  const g = table();
  const p = cur(g);
  rollTo(g, 2, 3);
  const price = (BOARD[5] as { price: number }).price;
  assert.equal(g.buy(p.id), null);
  assert.equal(g.owner[5], g.turn);
  assert.equal(p.cash, g.startCash - price);
  assert.equal(g.phase, "act");
  const before = g.turn;
  assert.equal(g.endTurn(p.id), null);
  assert.notEqual(g.turn, before);
  assert.equal(g.phase, "roll");
  rollTo(g, 2, 3);
  assert.equal(g.phase, "act"); // rent is due, not a buy
  assert.equal(cur(g).cash, g.startCash - g.rent(5));
});

test("pass leaves the plot with the bank", () => {
  const g = table();
  const p = cur(g);
  rollTo(g, 2, 3);
  assert.equal(g.pass(p.id), null);
  assert.equal(g.owner[5], -1);
  assert.equal(g.phase, "act");
});

test("rent: single plot, the whole district doubles it, storeys raise it", () => {
  const g = table();
  const owner = g.turn;
  const plots = DISTRICTS[1]!.plots;
  g.owner[plots[0]!] = owner;
  const base = g.rent(plots[0]!);
  assert.ok(base > 0);
  g.owner[plots[1]!] = owner;
  assert.equal(g.rent(plots[0]!), base);
  g.owner[plots[2]!] = owner;
  assert.equal(g.rent(plots[0]!), base * TUNE.mult[0]!);
  g.storeys[plots[0]!] = 2;
  assert.equal(g.rent(plots[0]!), base * TUNE.mult[2]!);
});

test("landing on an owned plot pays the owner", () => {
  const g = table();
  const payer = g.turn;
  const owner = (g.turn + 1) % 3;
  g.owner[5] = owner;
  const c0 = g.players[owner]!.cash;
  const p0 = g.players[payer]!.cash;
  const rent = g.rent(5);
  rollTo(g, 2, 3);
  assert.equal(g.players[payer]!.cash, p0 - rent);
  assert.equal(g.players[owner]!.cash, c0 + rent);
});

test("passing the Harbour Gate pays the payday", () => {
  const g = table();
  const p = cur(g);
  p.pos = 24;
  const cash = p.cash;
  rollTo(g, 3, 3); // 24 + 6 = 30 -> 2, Retort Row
  assert.equal(p.pos, 2);
  assert.equal(p.cash, cash + TUNE.payday);
  assert.equal(g.phase, "buy");
});

test("build: only on a whole district, evenly, up to three, and it costs", () => {
  const g = table();
  const me = g.turn;
  const d = DISTRICTS[0]!;
  g.owner[d.plots[0]!] = me;
  g.owner[d.plots[1]!] = me;
  g.phase = "act";
  assert.deepEqual(g.buildable(me), []);
  g.owner[d.plots[2]!] = me;
  assert.equal(g.buildable(me).length, 3);
  const id = idOf(g, me);
  const cash = g.players[me]!.cash;
  assert.equal(g.build(id, d.plots[0]!), null);
  assert.equal(g.players[me]!.cash, cash - d.build);
  assert.equal(g.build(id, d.plots[0]!), "You can't build there"); // uneven
  assert.equal(g.build(id, d.plots[1]!), null);
  assert.equal(g.build(id, d.plots[2]!), null);
  for (let r = 0; r < 2; r++) for (const p of d.plots) assert.equal(g.build(id, p), null);
  assert.deepEqual(g.storeys.slice(d.plots[0]!, d.plots[0]! + 3), [3, 3, 3]);
  assert.deepEqual(g.buildable(me), []);
  assert.equal(g.build(id, d.plots[0]!), "You can't build there");
});

test("trade: one offer a turn; accepted moves plot and cash; declined changes nothing; silence declines", () => {
  const g = table();
  const a = g.turn;
  const b = (a + 1) % 3;
  g.owner[5] = a;
  g.phase = "act";
  const ida = idOf(g, a);
  const idb = idOf(g, b);
  assert.equal(g.offerTrade(ida, 6, b, 100), "You can't offer that plot");
  assert.equal(g.offerTrade(ida, 5, a, 100), "Pick another player");
  assert.equal(g.offerTrade(ida, 5, b, 99999), "Pick a fair price");
  assert.equal(g.offerTrade(ida, 5, b, 100), null);
  assert.equal(g.phase, "trade");
  assert.equal(g.respond(ida, true), "No offer for you");
  const ca = g.players[a]!.cash;
  const cb = g.players[b]!.cash;
  assert.equal(g.respond(idb, true), null);
  assert.equal(g.owner[5], b);
  assert.equal(g.players[a]!.cash, ca + 100);
  assert.equal(g.players[b]!.cash, cb - 100);
  assert.equal(g.phase, "act");
  g.owner[7] = a;
  assert.equal(g.offerTrade(ida, 7, b, 100), "One offer a turn");
  // declined, and silence
  const h = table();
  const x = h.turn;
  const y = (x + 1) % 3;
  h.owner[5] = x;
  h.phase = "act";
  assert.equal(h.offerTrade(idOf(h, x), 5, y, 80), null);
  assert.equal(h.respond(idOf(h, y), false), null);
  assert.equal(h.owner[5], x);
  const k = table();
  const u = k.turn;
  k.owner[5] = u;
  k.phase = "act";
  assert.equal(k.offerTrade(idOf(k, u), 5, (u + 1) % 3, 80), null);
  run(k, 20500);
  assert.equal(k.owner[5], u);
  assert.equal(k.phase, "act");
});

test("a plot in a district with storeys can't be offered", () => {
  const g = table();
  const a = g.turn;
  const d = DISTRICTS[2]!;
  d.plots.forEach((p) => (g.owner[p] = a));
  g.storeys[d.plots[0]!] = 1;
  assert.deepEqual(g.tradable(a), []);
});

test("timers: a roll, a buy and an end of turn happen by themselves; away players hurry", () => {
  const g = table(3);
  const first = g.turn;
  run(g, 20500); // auto-roll
  assert.equal(g.phase, "move");
  run(g, 4000);
  assert.ok(["buy", "act", "card"].includes(g.phase as string));
  for (let i = 0; i < 6 && g.turn === first; i++) run(g, 21000);
  assert.notEqual(g.turn, first);
  assert.equal(g.phase, "roll");
  g.setAway(cur(g).id, true);
  run(g, 1600);
  assert.equal(g.phase, "move");
});

test("strike: the next turn is lost", () => {
  const g = table();
  const p = cur(g);
  const seat = g.turn;
  p.pos = 14;
  rollTo(g, 1, 1); // 16 = Dock Strike
  assert.equal(p.pos, 16);
  assert.equal(p.skip, 1);
  g.endTurn(p.id);
  // the first player to move after the striker has to roll first; let both of the others pass quickly
  for (let i = 0; i < 6 && g.turn !== seat; i++) {
    g.rng = rigged(1, 2);
    if (g.phase === "roll") g.roll(cur(g).id);
    run(g, 4000);
    if (g.phase === "buy") g.pass(cur(g).id);
    if (g.phase === "act") g.endTurn(cur(g).id);
  }
  assert.equal(g.turn, seat);
  assert.equal(g.phase, "skip");
  run(g, 2000);
  assert.notEqual(g.turn, seat);
  assert.equal(g.phase, "roll");
  assert.equal(p.skip, 0);
});

test("the festival: every other player pays the lander", () => {
  const g = table(3);
  const p = cur(g);
  p.pos = 22;
  const cash = p.cash;
  rollTo(g, 1, 1); // 24
  assert.equal(p.cash, cash + 2 * TUNE.festival);
});

test("the ferries ride to the next ferry; the second wraps and pays", () => {
  const g = table();
  const p = cur(g);
  p.pos = 5;
  rollTo(g, 2, 1); // 8 North Ferry
  assert.equal(p.pos, FERRIES[1]);
  g.endTurn(p.id);
  g.endTurn(p.id);
  const q = cur(g);
  q.pos = 17;
  const cash = q.cash;
  rollTo(g, 2, 1); // 20 South Ferry -> 8, passing the gate
  assert.equal(q.pos, FERRIES[0]);
  assert.equal(q.cash, cash + TUNE.payday);
});

test("every rumour card plays out and leaves the game in a sane phase", () => {
  for (const card of CARDS) {
    const g = table(3);
    const p = cur(g);
    g.owner[11] = (g.turn + 1) % 3;
    (g as unknown as { deck: unknown[] }).deck = [card];
    p.pos = 0;
    g.rng = rigged(2, 2); // 4, the Copper Market
    g.roll(p.id);
    run(g, 3500);
    assert.equal(g.phase, "card", card.id);
    assert.equal(g.card?.id, card.id);
    run(g, 4500);
    assert.ok(["act", "buy", "skip", "roll"].includes(g.phase), `${card.id}: ${g.phase}`);
    assert.ok(g.players.every((q) => q.cash >= 0), card.id);
  }
});

test("bankruptcy: the player is out, the plots go back to the bank, the creditor gets the cash", () => {
  const g = table(3);
  const a = g.turn;
  const b = (a + 1) % 3;
  DISTRICTS[6]!.plots.forEach((p) => (g.owner[p] = b));
  g.storeys[DISTRICTS[6]!.plots[0]!] = 3;
  g.players[a]!.cash = 5;
  g.owner[2] = a;
  g.players[a]!.pos = 21;
  const cb = g.players[b]!.cash;
  g.rng = rigged(2, 2); // 25, Beacon Road
  g.roll(g.players[a]!.id);
  run(g, 3500);
  const ev = g.drainEvents();
  assert.ok(kinds(ev).includes("rent"));
  assert.ok(kinds(ev).includes("bankrupt"));
  assert.equal(g.players[a]!.out, true);
  assert.equal(g.owner[2], -1);
  assert.equal(g.players[b]!.cash, cb + 5);
  assert.notEqual(g.turn, a);
});

test("storeys are sold back at half price before anyone goes out", () => {
  const g = table(3);
  const a = g.turn;
  const b = (a + 1) % 3;
  DISTRICTS[6]!.plots.forEach((p) => (g.owner[p] = b));
  g.storeys[DISTRICTS[6]!.plots[0]!] = 3;
  const d = DISTRICTS[0]!;
  d.plots.forEach((p) => (g.owner[p] = a));
  d.plots.forEach((p) => (g.storeys[p] = 3));
  g.players[a]!.cash = 100;
  g.players[a]!.pos = 21;
  g.rng = rigged(2, 2); // rent: 25 * 11 is far beyond 100 cash
  g.roll(g.players[a]!.id);
  run(g, 3500);
  const ev = g.drainEvents();
  assert.ok(kinds(ev).includes("sold-storeys"));
  assert.ok(g.storeys.slice(d.plots[0]!, d.plots[0]! + 3).some((s) => s < 3) || g.players[a]!.out);
});

test("last solvent player wins", () => {
  const g = table(2);
  const loser = g.turn;
  const win = 1 - loser;
  g.players[loser]!.cash = 0;
  DISTRICTS[6]!.plots.forEach((p) => (g.owner[p] = win));
  g.players[loser]!.pos = 22;
  g.rng = rigged(1, 2); // 25
  g.roll(g.players[loser]!.id);
  run(g, 3500);
  assert.equal(g.phase, "over");
  assert.equal(g.winner, win);
  assert.equal(g.why, "last");
});

test("time limit: the round in progress is played out, then the richest wins", () => {
  const g = table(3, { minutes: 20 });
  g.players.forEach((p, i) => (p.cash = 1000 + i * 100));
  g.step(20 * 60000 + 100);
  assert.equal(g.final, true);
  assert.notEqual(g.phase, "over");
  for (let i = 0; i < 400 && g.phase !== "over"; i++) run(g, 5000);
  assert.equal(g.phase, "over");
  assert.equal(g.why, "time");
  const worth = g.players.map((_, i) => g.worth(i));
  assert.equal(worth[g.winner], Math.max(...worth));
});

test("joining mid-match: the poorest computer's seat, with its cash and plots; leaving hands it back", () => {
  const g = new Boomtown({}, seeded(5));
  g.wantBots = 5;
  g.join("a", "Ann");
  g.startMatch();
  assert.equal(g.players.length, 6);
  const poor = g.players.findIndex((p) => p.bot);
  g.players.forEach((p, i) => (p.cash = i === poor ? 100 : 900));
  g.owner[5] = poor;
  const seat = g.join("b", "Bea");
  assert.equal(seat, poor);
  assert.equal(g.players[seat]!.bot, false);
  assert.equal(g.players[seat]!.cash, 100);
  assert.equal(g.owner[5], seat);
  g.leave("b");
  assert.equal(g.players[seat]!.bot, true);
  assert.equal(g.humans().length, 1);
  // a free seat is used first
  const h = table(2);
  assert.equal(h.join("z", "Zed"), 2);
});

test("bots: matches of computers reach a winner and never stall", () => {
  for (const seed of [1, 2, 3]) {
    const rng = seeded(seed);
    const g = new Boomtown({ minutes: 20 }, rng);
    g.wantBots = 4;
    g.startMatch();
    const bots = createBots(g, rng, { think: 800 });
    for (let t = 0; t < 60 * 60000 && g.phase !== "over"; t += 100) {
      bots.step(100);
      g.step(100);
    }
    assert.equal(g.phase, "over", `seed ${seed}`);
    assert.ok(g.winner >= 0);
  }
});

test("bot choices: complete a district, block, keep a reserve, build, accept a fair offer", () => {
  const g = table(3);
  const me = g.turn;
  const other = (me + 1) % 3;
  const d = DISTRICTS[3]!;
  g.owner[d.plots[0]!] = me;
  g.owner[d.plots[1]!] = me;
  assert.equal(wantsToBuy(g, me, d.plots[2]!), true);
  const l = DISTRICTS[5]!;
  g.owner[l.plots[0]!] = other;
  g.owner[l.plots[1]!] = other;
  g.players[me]!.cash = 600;
  assert.equal(wantsToBuy(g, me, l.plots[2]!), true); // blocks the other's district
  g.players[me]!.cash = 320;
  assert.equal(wantsToBuy(g, me, l.plots[2]!), false);
  g.players[me]!.cash = 330;
  assert.ok(reserve(g, me) >= 90);
  assert.equal(wantsToBuy(g, me, DISTRICTS[6]!.plots[0]!), false);
  g.owner[d.plots[2]!] = me;
  g.players[me]!.cash = 900;
  assert.ok(chooseBuild(g, me) >= 0);
  g.players[me]!.cash = 60;
  assert.equal(chooseBuild(g, me), -1);
  // an offer: a plot next to one of mine for a fair price is taken; a dear one for a dull plot is not
  const o = DISTRICTS[1]!;
  g.owner[o.plots[0]!] = me;
  g.owner[o.plots[1]!] = other;
  g.players[me]!.cash = 700;
  g.phase = "act";
  g.turn = other;
  assert.equal(g.offerTrade(g.players[other]!.id, o.plots[1]!, me, 130), null);
  assert.equal(acceptsOffer(g, me), true);
  g.phase = "act";
  g.offer = null;
  g.tradeUsed = false;
  g.owner[DISTRICTS[6]!.plots[1]!] = other;
  assert.equal(g.offerTrade(g.players[other]!.id, DISTRICTS[6]!.plots[1]!, me, 600), null);
  assert.equal(acceptsOffer(g, me), false);
});
