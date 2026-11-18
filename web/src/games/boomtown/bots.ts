// Computer players for Boomtown. They play the same moves a phone does, after a short think.
//
// Buying: a plot that completes a district is always worth it; one that stops an opponent completing theirs is worth a
// bit less; plots next to one they own come next; the rest only while a cash reserve stays in the bank (the reserve
// follows the rents on the board). They build whenever they own a district and the reserve allows. Offers are rare: a
// plot that is no use to them, sold for more than it cost (most to someone who would complete a district with it).
// They accept an offer that completes their district, or that pays more than the plot is worth to them.
import { BOARD, DISTRICTS, SIZE, type Boomtown, type Rng } from "./rules.ts";

export interface BotTune {
  /** ms a bot thinks before each move (plus up to half again). */
  think: number;
}

type PlotSpace = Extract<(typeof BOARD)[number], { kind: "plot" }>;
const sp = (i: number) => BOARD[i] as PlotSpace;

/** Cash a bot wants to keep: the worst rent it could face soon. */
export function reserve(g: Boomtown, me: number): number {
  let worst = 0;
  for (let s = 0; s < SIZE; s++) {
    const o = g.owner[s]!;
    if (o >= 0 && o !== me) worst = Math.max(worst, g.rent(s));
  }
  return Math.max(90, Math.min(450, Math.round(worst * 1.1)));
}

export function wantsToBuy(g: Boomtown, me: number, plot: number): boolean {
  const p = g.players[me]!;
  const s = sp(plot);
  const left = p.cash - s.price;
  if (left < 0) return false;
  const mine = g.tally(me, s.district);
  const others = DISTRICTS[s.district]!.plots.filter((q) => q !== plot);
  const blocks = others.every((q) => g.owner[q]! >= 0 && g.owner[q] !== me && g.owner[q] === g.owner[others[0]!]);
  const res = reserve(g, me);
  if (mine === 2) return left >= 20;
  if (blocks) return left >= res * 0.4;
  if (mine === 1) return left >= res * 0.5;
  // early on, spread out
  if (left >= g.startCash * 0.5) return true;
  return left >= res;
}

/** The best storey to build now, or -1. */
export function chooseBuild(g: Boomtown, me: number): number {
  const res = reserve(g, me) * 0.5;
  const p = g.players[me]!;
  const opts = g.buildable(me).filter((b) => p.cash - b.cost >= res);
  if (!opts.length) return -1;
  // the dearest district first: that is where the rent is
  opts.sort((a, b) => sp(b.plot).district - sp(a.plot).district || a.plot - b.plot);
  return opts[0]!.plot;
}

export interface OfferIdea {
  plot: number;
  to: number;
  price: number;
}

export function chooseOffer(g: Boomtown, me: number, rng: Rng): OfferIdea | null {
  const p = g.players[me]!;
  const poor = p.cash < 130;
  if (!poor && rng() > 0.14) return null;
  const spare = g.tradable(me).filter((q) => g.tally(me, sp(q).district) < 2);
  if (!spare.length) return null;
  let best: (OfferIdea & { score: number }) | null = null;
  for (const plot of spare) {
    const s = sp(plot);
    const others = DISTRICTS[s.district]!.plots.filter((q) => q !== plot);
    for (let to = 0; to < g.players.length; to++) {
      const b = g.players[to]!;
      if (to === me || b.out) continue;
      const completes = others.every((q) => g.owner[q] === to);
      const mult = completes ? 2.2 : 1.3;
      const price = Math.min(Math.round((s.price * mult) / 10) * 10, Math.floor(b.cash * 0.7 / 10) * 10);
      if (price < Math.max(10, s.price * 1.05)) continue;
      const score = price - s.price + (completes ? 50 : 0);
      if (!best || score > best.score) best = { plot, to, price, score };
    }
  }
  return best ? { plot: best.plot, to: best.to, price: best.price } : null;
}

export function acceptsOffer(g: Boomtown, me: number): boolean {
  const o = g.offer;
  if (!o) return false;
  const p = g.players[me]!;
  const s = sp(o.plot);
  const mine = g.tally(me, s.district);
  const value = s.price * (mine === 2 ? 3 : mine === 1 ? 1.4 : 1.05);
  return o.price <= value && p.cash - o.price >= 80;
}

export function createBots(g: Boomtown, rng: Rng, tune: BotTune) {
  let key = "";
  let due = 0;
  /** Offers decided once a turn, not once a tick. */
  let offerFor = -1;
  let offerIdea: OfferIdea | null = null;

  const think = () => tune.think * (0.55 + rng() * 0.65);

  return {
    step(dt: number) {
      const a = g.actor();
      if (a < 0) return;
      const p = g.players[a]!;
      if (!p.bot) return;
      const storeys = g.storeys.reduce((x, y) => x + y, 0);
      const k = `${g.turnNo}:${g.phase}:${storeys}:${g.tradeUsed}`;
      if (k !== key) {
        key = k;
        due = think();
      }
      due -= dt;
      if (due > 0) return;
      due = think();
      switch (g.phase) {
        case "roll":
          g.roll(p.id);
          break;
        case "buy":
          if (wantsToBuy(g, a, g.buying)) g.buy(p.id);
          else g.pass(p.id);
          break;
        case "trade":
          g.respond(p.id, acceptsOffer(g, a));
          break;
        case "act": {
          const b = chooseBuild(g, a);
          if (b >= 0) {
            g.build(p.id, b);
            break;
          }
          if (!g.tradeUsed) {
            if (offerFor !== g.turnNo) {
              offerFor = g.turnNo;
              offerIdea = chooseOffer(g, a, rng);
            }
            if (offerIdea) {
              const o = offerIdea;
              offerIdea = null;
              if (!g.offerTrade(p.id, o.plot, o.to, o.price)) break;
            }
          }
          g.endTurn(p.id);
          break;
        }
        default:
          break;
      }
    },
    forget() {
      key = "";
    },
  };
}
