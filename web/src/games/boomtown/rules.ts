// Boomtown's rules: a property-trading loop through our own harbour city. Plain TypeScript (no DOM, no canvas).
//
// 28 spaces: 7 districts of 3 plots, and 7 special spaces. A turn is: roll two dice, move, then buy the plot you land
// on (or pass) or pay its rent, then (optionally) build storeys or offer one plot for cash to one player, then end the
// turn. Owning a whole district doubles the rent and lets you build up to 3 storeys on each plot, evenly. Someone who
// cannot pay is out and their plots go back to the bank. The match ends at the time limit (the round in progress is
// played out, then the richest wins) or when one player is left.
//
// Everything random goes through an injected `rng`, and time only moves through `step(dt)`, so tests are exact.
export type Rng = () => number;
export const seeded = (seed: number): Rng => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const shuffle = <T>(a: T[], rng: Rng): T[] => {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
};

// ------------------------------------------------------------------ the numbers (the sim in sim.mjs tunes these)
export const TUNE = {
  /** Paid for passing or landing on the Harbour Gate. */
  payday: 150,
  /** Rent as a fraction of the plot's price. */
  rentRate: 0.14,
  tax: 120,
  /** What each other player pays whoever lands on Festival Green. */
  festival: 30,
  /** Rent multiplier by storeys, when the owner holds the whole district. Without it rent is 1x. */
  mult: [2, 4, 7, 11] as number[],
};
export const START_CASH = { low: 1000, normal: 1500, high: 2200 } as const;
export type CashLevel = keyof typeof START_CASH;

export const TURN_MS = { roll: 20000, buy: 20000, act: 45000, trade: 20000, card: 4200, skip: 1700, away: 1500 };
export const MAX_SEATS = 6;
export const MIN_SEATS = 2;
export const SIZE = 28;
export const MAX_STOREYS = 3;

// ------------------------------------------------------------------ the board
export interface District {
  name: string;
  color: string;
  /** Cost of one storey. */
  build: number;
  plots: number[];
}
export type SpecialKind = "start" | "market" | "ferry" | "tax" | "strike" | "festival";
export type Space =
  | { kind: "plot"; name: string; district: number; price: number; rent: number }
  | { kind: SpecialKind; name: string };

const D_DEFS: Array<{ name: string; color: string; build: number; plots: Array<[string, number]> }> = [
  { name: "Gasworks", color: "#7b5e57", build: 50, plots: [["Coke Yard", 60], ["Retort Row", 60], ["Lamp Lane", 80]] },
  { name: "Old Pier", color: "#4aa3d6", build: 50, plots: [["Net Loft", 100], ["Tarry Steps", 100], ["Bollard Way", 120]] },
  { name: "Tram Yard", color: "#a0478f", build: 100, plots: [["Depot Road", 140], ["Points Lane", 140], ["Cable Court", 160]] },
  { name: "Mill Row", color: "#e9a93a", build: 100, plots: [["Sluice Gate", 180], ["Weir Walk", 180], ["Race Street", 200]] },
  { name: "Glasshouse Hill", color: "#4f9d4a", build: 150, plots: [["Fern Terrace", 220], ["Pane Place", 220], ["Vine Steps", 240]] },
  { name: "Lantern Quarter", color: "#e25b45", build: 150, plots: [["Wick Street", 260], ["Paper Alley", 260], ["Moon Gate", 300]] },
  { name: "Signal Point", color: "#14716f", build: 200, plots: [["Beacon Road", 320], ["Foghorn Quay", 340], ["Lookout Rise", 380]] },
];
const SPECIALS: Array<[SpecialKind, string]> = [
  ["start", "Harbour Gate"],
  ["market", "Copper Market"],
  ["ferry", "North Ferry"],
  ["tax", "Tax Office"],
  ["strike", "Dock Strike"],
  ["ferry", "South Ferry"],
  ["festival", "Festival Green"],
];
export const DISTRICTS: District[] = D_DEFS.map((d) => ({ name: d.name, color: d.color, build: d.build, plots: [] }));
export const BOARD: Space[] = [];
export const rentFor = (price: number) => Math.max(4, Math.round((price * TUNE.rentRate) / 2) * 2);
for (let i = 0; i < 7; i++) {
  const [kind, name] = SPECIALS[i]!;
  BOARD.push({ kind, name });
  for (const [n, price] of D_DEFS[i]!.plots) {
    DISTRICTS[i]!.plots.push(BOARD.length);
    BOARD.push({ kind: "plot", name: n, district: i, price, rent: rentFor(price) });
  }
}
export const FERRIES = BOARD.map((s, i) => (s.kind === "ferry" ? i : -1)).filter((i) => i >= 0);
export const isPlot = (i: number) => BOARD[i]?.kind === "plot";
const plotOf = (i: number) => BOARD[i] as Extract<Space, { kind: "plot" }>;

// ------------------------------------------------------------------ rumour cards
export type Fx =
  | { t: "cash"; n: number }
  | { t: "each"; n: number }
  | { t: "goto"; pos: number }
  | { t: "back"; n: number }
  | { t: "ferry" }
  | { t: "skip" }
  | { t: "repairs"; per: number };
export interface Card {
  id: string;
  title: string;
  text: string;
  fx: Fx;
}
const at = (name: string) => BOARD.findIndex((s) => s.name === name);
export const CARDS: Card[] = [
  { id: "dividend", title: "Harbour dividend", text: "A forgotten share pays out. Collect 80.", fx: { t: "cash", n: 80 } },
  { id: "roof", title: "Leaky roof", text: "The rain finds your ledger. Pay 60 for repairs.", fx: { t: "cash", n: -60 } },
  { id: "ribbon", title: "Blue ribbon", text: "Your pie wins at the fair. Every rival pays you 25.", fx: { t: "each", n: 25 } },
  { id: "round", title: "A round at the Anchor", text: "You are buying. Pay every player 20.", fx: { t: "each", n: -20 } },
  { id: "ferry", title: "Last ferry", text: "A deckhand waves you aboard. Ride to the next ferry.", fx: { t: "ferry" } },
  { id: "lamplighter", title: "Lamplighter's tip", text: "Follow the lamps to the Harbour Gate and collect your payday.", fx: { t: "goto", pos: 0 } },
  { id: "fog", title: "Fog on the quay", text: "You lose your way. Go back three spaces.", fx: { t: "back", n: 3 } },
  { id: "inspect", title: "Council inspection", text: "Pay 25 for every storey you have built.", fx: { t: "repairs", per: 25 } },
  { id: "wallet", title: "Lost wallet", text: "It was there a minute ago. Pay 90.", fx: { t: "cash", n: -90 } },
  { id: "aunt", title: "Aunt Marlow's letter", text: "A surprise inheritance. Collect 150.", fx: { t: "cash", n: 150 } },
  { id: "signal", title: "Walk to Signal Point", text: "The view is worth it. Advance to Beacon Road.", fx: { t: "goto", pos: at("Beacon Road") } },
  { id: "pier", title: "Pier tour", text: "A guide is waiting. Advance to Net Loft.", fx: { t: "goto", pos: at("Net Loft") } },
  { id: "union", title: "Union meeting", text: "Everyone is in the hall. Sit out your next turn.", fx: { t: "skip" } },
  { id: "stall", title: "Stall sells out", text: "Every last bun is gone. Collect 40.", fx: { t: "cash", n: 40 } },
  { id: "barge", title: "Barge fine", text: "You moored in the wrong place. Pay 40.", fx: { t: "cash", n: -40 } },
  { id: "parade", title: "Lantern parade", text: "You carry the biggest lantern. Every rival pays you 20.", fx: { t: "each", n: 20 } },
  { id: "toll", title: "Toll refunded", text: "The bridge toll was a mistake. Collect 60.", fx: { t: "cash", n: 60 } },
  { id: "late", title: "Late tax bill", text: "It found you at last. Pay 120.", fx: { t: "cash", n: -120 } },
  { id: "glass", title: "Glasshouse shortcut", text: "Mind the panes. Advance to Fern Terrace.", fx: { t: "goto", pos: at("Fern Terrace") } },
  { id: "rebate", title: "Shipping rebate", text: "The clerk adds a nought. Collect 100.", fx: { t: "cash", n: 100 } },
  { id: "print", title: "Print shop error", text: "Your posters say the wrong day. Pay 70.", fx: { t: "cash", n: -70 } },
  { id: "chimney", title: "Tallest chimney", text: "A small prize, a big smoke. Collect 45.", fx: { t: "cash", n: 45 } },
];

// ------------------------------------------------------------------ state
export type Phase = "roll" | "move" | "buy" | "act" | "trade" | "card" | "skip" | "over";

export interface Player {
  id: string;
  name: string;
  bot: boolean;
  /** A person who left: a computer plays their seat to the end of the match. */
  left: boolean;
  /** Their phone dropped: their turns play out quickly with the safe default. */
  away: boolean;
  /** 0–5: the colour and the pawn shape. */
  color: number;
  cash: number;
  pos: number;
  out: boolean;
  /** Turns to sit out. */
  skip: number;
}

export interface Offer {
  from: number;
  to: number;
  plot: number;
  price: number;
}

export interface Options {
  /** Match time limit, minutes. */
  minutes: number;
  cash: CashLevel;
}

export type BoomEvent =
  | { type: "phase"; phase: Phase }
  | { type: "turn"; player: number }
  | { type: "roll"; player: number; dice: [number, number]; from: number; to: number; steps: number }
  | { type: "move"; player: number; from: number; to: number; via: "ferry" | "card" }
  | { type: "payday"; player: number; n: number }
  | { type: "buy"; player: number; plot: number; price: number }
  | { type: "pass"; player: number; plot: number }
  | { type: "rent"; from: number; to: number; plot: number; n: number }
  | { type: "tax"; player: number; n: number }
  | { type: "festival"; player: number; n: number }
  | { type: "card"; player: number; card: string }
  | { type: "build"; player: number; plot: number; storeys: number; cost: number }
  | { type: "offer"; offer: Offer }
  | { type: "trade"; offer: Offer; accepted: boolean }
  | { type: "strike"; player: number }
  | { type: "sold-storeys"; player: number; n: number }
  | { type: "bankrupt"; player: number; to: number }
  | { type: "final" }
  | { type: "over"; winner: number; why: "last" | "time" };

const NAMES = ["Marlow", "Pim", "Odette", "Bram", "Juniper", "Cass", "Rook", "Tilly", "Hobb", "Wren", "Dov", "Ines"];

export class Boomtown {
  opts: Options;
  rng: Rng;
  players: Player[] = [];
  owner: number[] = new Array(SIZE).fill(-1);
  storeys: number[] = new Array(SIZE).fill(0);
  phase: Phase = "roll";
  turn = 0;
  turnNo = 0;
  round = 1;
  dice: [number, number] = [1, 1];
  /** ms left on the clock of the phase (0 = none). */
  timer = 0;
  /** ms played (the match clock). */
  elapsed = 0;
  /** The time limit has passed: the round in progress is played out. */
  final = false;
  offer: Offer | null = null;
  tradeUsed = false;
  /** The card being shown, and whether the move it asks for is still to be made. */
  card: Card | null = null;
  winner = -1;
  why: "last" | "time" | null = null;
  /** The plot waiting for a buy/pass, or -1. */
  buying = -1;
  wantBots: number | null = null;
  private pendingTo = -1;
  private pendingMove: { to: number; pay: boolean } | null = null;
  private deck: Card[] = [];
  private botSeq = 1;
  private events: BoomEvent[] = [];

  constructor(opts: Partial<Options> = {}, rng: Rng = Math.random) {
    this.opts = { minutes: 30, cash: "normal", ...opts };
    this.rng = rng;
  }

  configure(o: Partial<Options>) {
    this.opts = { ...this.opts, ...o };
  }

  drainEvents(): BoomEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
  private emit(e: BoomEvent) {
    this.events.push(e);
  }

  // ------------------------------------------------------------------ seats
  seat(id: string): number {
    return this.players.findIndex((p) => p.id === id);
  }
  humans() {
    return this.players.filter((p) => !p.bot);
  }
  get startCash() {
    return START_CASH[this.opts.cash] ?? START_CASH.normal;
  }
  private freeColor(): number {
    const used = new Set(this.players.map((p) => p.color));
    for (let c = 0; c < MAX_SEATS; c++) if (!used.has(c)) return c;
    return 0;
  }
  private fresh(id: string, name: string, bot: boolean, color: number): Player {
    return { id, name, bot, left: false, away: false, color, cash: this.startCash, pos: 0, out: false, skip: 0 };
  }
  private botName() {
    const used = new Set(this.players.map((p) => p.name));
    return NAMES.find((n) => !used.has(n)) ?? `Bot ${this.botSeq}`;
  }

  /**
   * A person sits down. Mid-match they take a free seat, a bankrupt seat, or the poorest computer player's whole seat
   * (cash and plots included). Returns the seat index, or -1 when the table is full of people.
   */
  join(id: string, name: string): number {
    const have = this.seat(id);
    if (have >= 0) {
      const p = this.players[have]!;
      p.name = name;
      p.left = false;
      p.away = false;
      p.bot = false;
      return have;
    }
    const nm = name.slice(0, 14) || "Player";
    const outSeat = this.players.findIndex((p) => p.out);
    if (outSeat >= 0) {
      const old = this.players[outSeat]!;
      this.players[outSeat] = this.fresh(id, nm, false, old.color);
      return outSeat;
    }
    if (this.players.length < MAX_SEATS) {
      this.players.push(this.fresh(id, nm, false, this.freeColor()));
      return this.players.length - 1;
    }
    let best = -1;
    let bestWorth = Infinity;
    this.players.forEach((p, i) => {
      if (!p.bot || p.out) return;
      const w = this.worth(i);
      if (w < bestWorth) {
        bestWorth = w;
        best = i;
      }
    });
    if (best < 0) return -1;
    const p = this.players[best]!;
    p.id = id;
    p.name = nm;
    p.bot = false;
    p.left = false;
    p.away = false;
    this.setTimer(this.phase, this.timerMax);
    return best;
  }

  /** A person left: a computer takes over the seat for the rest of the match. */
  leave(id: string) {
    const i = this.seat(id);
    if (i < 0) return;
    const p = this.players[i]!;
    p.bot = true;
    p.left = true;
    p.away = false;
  }

  setAway(id: string, away: boolean) {
    const p = this.players[this.seat(id)];
    if (!p || p.bot || p.away === away) return;
    p.away = away;
    if (away && this.timer > TURN_MS.away && this.actor() === this.seat(id)) this.timer = TURN_MS.away;
  }

  private fitBots() {
    const people = this.players.filter((p) => !p.bot && !p.left);
    const want = Math.max(0, Math.min(this.wantBots ?? 0, MAX_SEATS - people.length), MIN_SEATS - people.length);
    this.players = people.slice();
    // the colours of people stay; bots take the free ones
    for (let i = 0; i < want; i++) {
      const color = this.freeColor();
      this.players.push(this.fresh(`bot-${this.botSeq++}`, this.botName(), true, color));
    }
  }

  // ------------------------------------------------------------------ the match
  startMatch() {
    this.fitBots();
    const order = shuffle(this.players, this.rng);
    // colours follow the table order, so the first seat is always the first colour
    this.players = order;
    this.players.forEach((p, i) => {
      p.color = i;
      p.cash = this.startCash;
      p.pos = 0;
      p.out = false;
      p.skip = 0;
      p.left = false;
    });
    this.owner.fill(-1);
    this.storeys.fill(0);
    this.turn = 0;
    this.turnNo = 0;
    this.round = 1;
    this.elapsed = 0;
    this.final = false;
    this.offer = null;
    this.card = null;
    this.winner = -1;
    this.why = null;
    this.buying = -1;
    this.pendingMove = null;
    this.deck = shuffle(CARDS, this.rng);
    this.beginTurn();
  }

  private limitMs() {
    return this.opts.minutes * 60000;
  }

  /** Who the game waits for in this phase, or -1. */
  actor(): number {
    switch (this.phase) {
      case "roll":
      case "buy":
      case "act":
        return this.turn;
      case "trade":
        return this.offer?.to ?? -1;
      default:
        return -1;
    }
  }

  timerMax = 0;
  private setTimer(phase: Phase, ms: number) {
    this.phase = phase;
    this.timerMax = ms;
    const a = this.actor();
    const away = a >= 0 && !!this.players[a]?.away;
    const bot = a >= 0 && !!this.players[a]?.bot;
    this.timer = ms === 0 ? 0 : away || bot ? Math.min(ms, bot ? ms : TURN_MS.away) : ms;
  }
  private go(phase: Phase, ms: number) {
    this.setTimer(phase, ms);
    this.emit({ type: "phase", phase });
  }

  private beginTurn() {
    const p = this.players[this.turn]!;
    this.turnNo++;
    this.tradeUsed = false;
    this.offer = null;
    this.card = null;
    this.buying = -1;
    this.emit({ type: "turn", player: this.turn });
    if (p.skip > 0) {
      p.skip--;
      this.go("skip", TURN_MS.skip);
      return;
    }
    this.go("roll", TURN_MS.roll);
  }

  step(dt: number) {
    if (this.phase === "over") return;
    this.elapsed += dt;
    if (!this.final && this.elapsed >= this.limitMs()) {
      this.final = true;
      this.emit({ type: "final" });
    }
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.timer = 0;
        this.timeout();
      }
    }
  }

  private timeout() {
    const a = this.actor();
    const id = a >= 0 ? this.players[a]!.id : "";
    switch (this.phase) {
      case "roll":
        this.roll(id);
        break;
      case "move":
        this.land();
        break;
      case "buy":
        this.pass(id);
        break;
      case "act":
        this.endTurn(id);
        break;
      case "trade":
        this.respond(id, false);
        break;
      case "card":
        this.afterCard();
        break;
      case "skip":
        this.nextTurn();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ money
  /** Cash + plots at price + storeys at what they cost. */
  worth(i: number): number {
    const p = this.players[i]!;
    if (p.out) return 0;
    let w = p.cash;
    for (let s = 0; s < SIZE; s++) {
      if (this.owner[s] !== i) continue;
      w += plotOf(s).price + this.storeys[s]! * DISTRICTS[plotOf(s).district]!.build;
    }
    return w;
  }
  plotsOf(i: number): number[] {
    const out: number[] = [];
    for (let s = 0; s < SIZE; s++) if (this.owner[s] === i) out.push(s);
    return out;
  }
  /** Does this player own every plot of the district? */
  holds(i: number, d: number): boolean {
    return DISTRICTS[d]!.plots.every((s) => this.owner[s] === i);
  }
  rent(plot: number): number {
    const sp = plotOf(plot);
    const o = this.owner[plot]!;
    if (o < 0) return 0;
    const base = rentFor(sp.price);
    if (!this.holds(o, sp.district)) return base;
    return base * (TUNE.mult[Math.min(this.storeys[plot]!, MAX_STOREYS)] ?? 1);
  }
  tally(i: number, d: number) {
    return DISTRICTS[d]!.plots.filter((s) => this.owner[s] === i).length;
  }
  solvent(): number[] {
    return this.players.map((p, i) => (p.out ? -1 : i)).filter((i) => i >= 0);
  }

  /**
   * Take `n` from a player for `to` (a player index, or -1 for the bank). Storeys are sold back at half price if they
   * are short; if that is not enough they are out. Returns false when they went bankrupt.
   */
  private charge(i: number, n: number, to: number): boolean {
    const p = this.players[i]!;
    if (p.cash < n) this.liquidate(i, n);
    if (p.cash >= n) {
      p.cash -= n;
      if (to >= 0) this.players[to]!.cash += n;
      return true;
    }
    const rest = p.cash;
    p.cash = 0;
    if (to >= 0) this.players[to]!.cash += rest;
    this.bust(i, to);
    return false;
  }
  private liquidate(i: number, need: number) {
    const p = this.players[i]!;
    let sold = 0;
    while (p.cash < need) {
      // the tallest storey first
      let best = -1;
      for (let s = 0; s < SIZE; s++) if (this.owner[s] === i && this.storeys[s]! > 0 && (best < 0 || this.storeys[s]! > this.storeys[best]!)) best = s;
      if (best < 0) break;
      this.storeys[best]!--;
      p.cash += Math.floor(DISTRICTS[plotOf(best).district]!.build / 2);
      sold++;
    }
    if (sold) this.emit({ type: "sold-storeys", player: i, n: sold });
  }
  private bust(i: number, to: number) {
    const p = this.players[i]!;
    p.out = true;
    for (let s = 0; s < SIZE; s++) {
      if (this.owner[s] === i) {
        this.owner[s] = -1;
        this.storeys[s] = 0;
      }
    }
    this.emit({ type: "bankrupt", player: i, to });
  }

  // ------------------------------------------------------------------ moves
  private mine(id: string, phase: Phase): number {
    return this.phase === phase && this.players[this.turn]?.id === id && !this.players[this.turn]!.out ? this.turn : -1;
  }

  roll(id: string): string | null {
    if (this.mine(id, "roll") < 0) return "Not your roll";
    const p = this.players[this.turn]!;
    const a = 1 + Math.floor(this.rng() * 6);
    const b = 1 + Math.floor(this.rng() * 6);
    this.dice = [a, b];
    const steps = a + b;
    const to = (p.pos + steps) % SIZE;
    this.pendingMove = { to, pay: p.pos + steps >= SIZE };
    this.emit({ type: "roll", player: this.turn, dice: [a, b], from: p.pos, to, steps });
    this.go("move", 750 + steps * 130);
    return null;
  }

  /** The pawn has arrived. */
  private land() {
    const m = this.pendingMove;
    this.pendingMove = null;
    const p = this.players[this.turn]!;
    if (m) {
      p.pos = m.to;
      if (m.pay) this.payday(this.turn);
    }
    this.resolve();
  }

  private payday(i: number) {
    this.players[i]!.cash += TUNE.payday;
    this.emit({ type: "payday", player: i, n: TUNE.payday });
  }

  /** What the space under the current player does. */
  private resolve() {
    const i = this.turn;
    const p = this.players[i]!;
    const sp = BOARD[p.pos]!;
    switch (sp.kind) {
      case "plot": {
        const o = this.owner[p.pos]!;
        if (o < 0) {
          if (p.cash >= sp.price) {
            this.buying = p.pos;
            this.go("buy", TURN_MS.buy);
            return;
          }
          return this.toAct();
        }
        if (o !== i) {
          const n = this.rent(p.pos);
          const ok = this.charge(i, n, o);
          this.emit({ type: "rent", from: i, to: o, plot: p.pos, n });
          if (!ok) return this.afterBust();
        }
        return this.toAct();
      }
      case "tax": {
        const ok = this.charge(i, TUNE.tax, -1);
        this.emit({ type: "tax", player: i, n: TUNE.tax });
        if (!ok) return this.afterBust();
        return this.toAct();
      }
      case "festival": {
        let got = 0;
        for (const j of this.solvent()) {
          if (j === i) continue;
          const pay = Math.min(TUNE.festival, this.players[j]!.cash);
          this.players[j]!.cash -= pay;
          got += pay;
        }
        p.cash += got;
        this.emit({ type: "festival", player: i, n: got });
        return this.toAct();
      }
      case "strike":
        p.skip = 1;
        this.emit({ type: "strike", player: i });
        return this.toAct();
      case "ferry":
        return this.ride(i, "ferry");
      case "market":
        return this.draw();
      default:
        return this.toAct();
    }
  }

  private ride(i: number, via: "ferry" | "card") {
    const p = this.players[i]!;
    const next = FERRIES.find((f) => f > p.pos) ?? FERRIES[0]!;
    const from = p.pos;
    p.pos = next;
    if (next < from) this.payday(i);
    this.emit({ type: "move", player: i, from, to: next, via });
    this.toAct();
  }

  private draw() {
    if (!this.deck.length) this.deck = shuffle(CARDS, this.rng);
    const c = this.deck.pop()!;
    this.card = c;
    const i = this.turn;
    const p = this.players[i]!;
    this.pendingMove = null;
    let bankrupt = false;
    this.emit({ type: "card", player: i, card: c.id });
    const fx = c.fx;
    switch (fx.t) {
      case "cash":
        if (fx.n >= 0) p.cash += fx.n;
        else bankrupt = !this.charge(i, -fx.n, -1);
        break;
      case "each":
        for (const j of this.solvent()) {
          if (j === i) continue;
          if (fx.n > 0) {
            const pay = Math.min(fx.n, this.players[j]!.cash);
            this.players[j]!.cash -= pay;
            p.cash += pay;
          } else if (!this.charge(i, -fx.n, j)) {
            bankrupt = true;
            break;
          }
        }
        break;
      case "repairs": {
        const n = this.plotsOf(i).reduce((a, s) => a + this.storeys[s]!, 0) * fx.per;
        if (n > 0) bankrupt = !this.charge(i, n, -1);
        break;
      }
      case "skip":
        p.skip = 1;
        break;
      case "goto":
        this.pendingMove = { to: fx.pos, pay: fx.pos <= p.pos };
        break;
      case "back":
        this.pendingMove = { to: (p.pos - fx.n + SIZE) % SIZE, pay: false };
        break;
      case "ferry":
        this.pendingMove = { to: FERRIES.find((f) => f > p.pos) ?? FERRIES[0]!, pay: false };
        this.pendingMove.pay = this.pendingMove.to < p.pos;
        break;
    }
    if (bankrupt) this.pendingMove = null;
    this.bankruptAfterCard = bankrupt;
    this.go("card", TURN_MS.card);
  }
  private bankruptAfterCard = false;

  private afterCard() {
    const m = this.pendingMove;
    this.pendingMove = null;
    this.card = null;
    if (this.bankruptAfterCard) {
      this.bankruptAfterCard = false;
      return this.afterBust();
    }
    if (!m) return this.toAct();
    const p = this.players[this.turn]!;
    const from = p.pos;
    p.pos = m.to;
    this.emit({ type: "move", player: this.turn, from, to: m.to, via: "card" });
    if (m.pay) this.payday(this.turn);
    // landing on a card's destination is an ordinary landing (no second card: no card sends you to the market)
    this.resolve();
  }

  private toAct() {
    this.buying = -1;
    this.go("act", TURN_MS.act);
  }

  /** The current player went out: the turn is over. */
  private afterBust() {
    this.buying = -1;
    this.card = null;
    this.endOrNext();
  }

  buy(id: string): string | null {
    if (this.mine(id, "buy") < 0) return "Not your choice";
    const p = this.players[this.turn]!;
    const sp = plotOf(this.buying);
    if (p.cash < sp.price) return "Not enough cash";
    p.cash -= sp.price;
    this.owner[this.buying] = this.turn;
    this.emit({ type: "buy", player: this.turn, plot: this.buying, price: sp.price });
    this.toAct();
    return null;
  }

  pass(id: string): string | null {
    if (this.mine(id, "buy") < 0) return "Not your choice";
    this.emit({ type: "pass", player: this.turn, plot: this.buying });
    this.toAct();
    return null;
  }

  /** Plots the player could put a storey on right now (whole district, evenly, up to 3, and they can pay). */
  buildable(i: number): Array<{ plot: number; cost: number }> {
    const p = this.players[i];
    if (!p || p.out) return [];
    const out: Array<{ plot: number; cost: number }> = [];
    DISTRICTS.forEach((d, di) => {
      if (!this.holds(i, di)) return;
      const low = Math.min(...d.plots.map((s) => this.storeys[s]!));
      if (low >= MAX_STOREYS) return;
      for (const s of d.plots) if (this.storeys[s] === low && p.cash >= d.build) out.push({ plot: s, cost: d.build });
    });
    return out;
  }

  build(id: string, plot: number): string | null {
    if (this.mine(id, "act") < 0) return "Not your turn";
    const opt = this.buildable(this.turn).find((b) => b.plot === plot);
    if (!opt) return "You can't build there";
    this.players[this.turn]!.cash -= opt.cost;
    this.storeys[plot]!++;
    this.emit({ type: "build", player: this.turn, plot, storeys: this.storeys[plot]!, cost: opt.cost });
    this.timer = Math.max(this.timer, 15000);
    return null;
  }

  /** Plots a player may offer: theirs, with no storeys anywhere in the district. */
  tradable(i: number): number[] {
    return this.plotsOf(i).filter((s) => DISTRICTS[plotOf(s).district]!.plots.every((q) => this.storeys[q] === 0));
  }

  offerTrade(id: string, plot: number, to: number, price: number): string | null {
    const i = this.mine(id, "act");
    if (i < 0) return "Not your turn";
    if (this.tradeUsed) return "One offer a turn";
    const buyer = this.players[to];
    if (!buyer || buyer.out || to === i) return "Pick another player";
    if (!this.tradable(i).includes(plot)) return "You can't offer that plot";
    price = Math.round(price);
    if (!(price >= 10 && price <= 9990)) return "Pick a fair price";
    if (buyer.cash < price) return "They can't pay that";
    this.tradeUsed = true;
    this.offer = { from: i, to, plot, price };
    this.emit({ type: "offer", offer: this.offer });
    this.go("trade", TURN_MS.trade);
    return null;
  }

  respond(id: string, accept: boolean): string | null {
    const o = this.offer;
    if (this.phase !== "trade" || !o || this.players[o.to]?.id !== id) return "No offer for you";
    this.offer = null;
    const seller = this.players[o.from]!;
    const buyer = this.players[o.to]!;
    const valid = this.owner[o.plot] === o.from && buyer.cash >= o.price && !buyer.out && !seller.out;
    const ok = accept && valid;
    if (ok) {
      buyer.cash -= o.price;
      seller.cash += o.price;
      this.owner[o.plot] = o.to;
    }
    this.emit({ type: "trade", offer: o, accepted: ok });
    this.go("act", TURN_MS.act);
    return null;
  }

  endTurn(id: string): string | null {
    if (this.mine(id, "act") < 0) return "Not your turn";
    this.endOrNext();
    return null;
  }

  private endOrNext() {
    this.nextTurn();
  }

  private nextTurn() {
    const alive = this.solvent();
    if (alive.length <= 1) return this.finish(alive[0] ?? this.turn, "last");
    let next = this.turn;
    do next = (next + 1) % this.players.length;
    while (this.players[next]!.out);
    const wrapped = next <= this.turn;
    if (wrapped) {
      if (this.final) return this.finish(this.richest(), "time");
      this.round++;
    }
    this.turn = next;
    this.beginTurn();
  }

  private richest(): number {
    let best = -1;
    for (const i of this.solvent()) {
      if (best < 0 || this.worth(i) > this.worth(best) || (this.worth(i) === this.worth(best) && this.players[i]!.cash > this.players[best]!.cash)) best = i;
    }
    return best;
  }

  private finish(winner: number, why: "last" | "time") {
    this.winner = winner;
    this.why = why;
    this.timer = 0;
    this.phase = "over";
    this.offer = null;
    this.card = null;
    this.emit({ type: "over", winner, why });
    this.emit({ type: "phase", phase: "over" });
  }

  /** Minutes left (0 once the limit has passed). */
  leftMs(): number {
    return Math.max(0, this.limitMs() - this.elapsed);
  }
}
