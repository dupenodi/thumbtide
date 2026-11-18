// Spyline's rules: plain TypeScript, no drawing. Two teams, Cobalt and Saffron, share a 5×5 board of word cards.
// A secret key gives each card to a team (9 to the team that starts, 8 to the other), to the bystanders (7) or to
// the burn (1). Each turn a team's handler gives a one-word clue and a number; the team's agents propose cards, and
// a card is revealed when more than half of them pick it. They may reveal up to number + 1 cards; a card that isn't
// theirs ends the turn; the burn card loses the round at once. Reveal all your cards first to take the round.
//
// Time lives in here (step(ms)), so pausing is just not stepping, and the random source is injected for tests.
import { WORDS } from "./deck.ts";

export type Team = "cobalt" | "saffron";
export const TEAMS: readonly Team[] = ["cobalt", "saffron"];
export const other = (t: Team): Team => (t === "cobalt" ? "saffron" : "cobalt");
export type Owner = Team | "neutral" | "burn";
export type Phase = "brief" | "clue" | "guess" | "reveal" | "round" | "match";
export type Role = "handler" | "agent";
export type Rng = () => number;

/** A proposal to end the turn instead of revealing a card. */
export const STOP = -1;
export const SIZE = 25;
export const MIN_SEATS = 4;
export const MAX_SEATS = 12;
export const ROUNDS = [1, 3, 5] as const;

/** How long the untimed beats last, in ms. */
export const BEATS = { brief: 4500, reveal: 1700, round: 9000 };

export const BOT_NAMES = ["Fennel", "Vesper", "Quill", "Ashby", "Juniper", "Corvid", "Lark", "Hollis", "Marlow", "Tamsin", "Drift", "Sorrel"];
export const isBot = (id: string) => id.startsWith("bot-");

export interface Options {
  /** Best of this many rounds. */
  rounds: number;
  /** Seconds a handler has for a clue (0 = no limit). */
  clueTime: number;
  /** Seconds the agents have for their guesses (0 = no limit). */
  guessTime: number;
}

export interface Seat {
  id: string;
  name: string;
  bot: boolean;
  team: Team;
  /** When they sat down: handler rotation goes in this order. */
  order: number;
}

export interface Card {
  word: string;
  owner: Owner;
  revealed: boolean;
}

export interface Clue {
  word: string;
  n: number;
  team: Team;
}

export type TurnEnd = "wrong" | "stop" | "done" | "time" | "no-clue";

export type SpyEvent =
  | { type: "phase"; phase: Phase }
  /** Someone changed their proposal. */
  | { type: "pick"; id: string; pick: number | null }
  | { type: "clue"; team: Team; word: string; n: number }
  | { type: "reveal"; idx: number; owner: Owner; team: Team }
  | { type: "turn"; from: Team; why: TurnEnd }
  | { type: "round"; winner: Team; why: "cards" | "burn" }
  | { type: "match"; winner: Team }
  | { type: "handler"; team: Team; id: string };

/** Small fast seeded random source (mulberry32), for tests and simulations. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Folds a simple plural so "ships" and "ship" compare equal. */
export const fold = (w: string) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

/**
 * Is this a fair clue for this board? One word of letters, not a word on the board and not a part of one (or one
 * with a board word inside it, like FIREPLACE for FIRE). Returns what's wrong, or null when it's fine.
 */
export function checkClue(raw: string, board: readonly string[]): string | null {
  const c = String(raw ?? "").trim().toLowerCase();
  if (!c) return "Type a clue first";
  if (/\s/.test(c)) return "One word only";
  if (!/^[a-z]+$/.test(c)) return "Letters only, please";
  if (c.length < 2) return "That's too short";
  if (c.length > 18) return "That's too long";
  for (const raw of board) {
    const b = raw.toLowerCase();
    if (c === b || fold(c) === fold(b)) return `${b.toUpperCase()} is on the board`;
    // a part of a board word (PLACE for FIREPLACE), or a board word inside the clue (FIREPLACE for FIRE; short board
    // words like NET only count as themselves, so PLANET stays fair)
    const near = (c.length >= 3 && (b.startsWith(c) || b.endsWith(c))) || (b.length >= 4 && (c.startsWith(b) || c.endsWith(b)));
    if (near) return `Too close to ${b.toUpperCase()}`;
  }
  return null;
}

export class Spyline {
  opts: Options;
  readonly rng: Rng;
  seats: Seat[] = [];
  phase: Phase = "brief";
  /** ms left in the current timed beat (0 = waits for a move). */
  left = 0;
  round = 0;
  wins: Record<Team, number> = { cobalt: 0, saffron: 0 };
  starter: Team = "cobalt";
  turn: Team = "cobalt";
  cards: Card[] = [];
  handler: Record<Team, string | null> = { cobalt: null, saffron: null };
  clue: Clue | null = null;
  /** Cards revealed in this turn. */
  guesses = 0;
  /** Each agent's proposal this moment: a card index, or STOP. */
  picks = new Map<string, number>();
  last: { idx: number; owner: Owner; team: Team } | null = null;
  roundWinner: Team | null = null;
  roundWhy: "cards" | "burn" | null = null;
  matchWinner: Team | null = null;
  /** Every clue given this round, newest last. */
  history: Clue[] = [];
  /** Computer seats wanted (the bots setting); applied at each round start. Null leaves the seats alone. */
  wantBots: number | null = null;
  private rot: Record<Team, number> = { cobalt: 0, saffron: 0 };
  private used = new Set<string>();
  private afterReveal: "guess" | "clue" | "round" = "guess";
  /** Guess time left, held while a reveal plays. */
  private guessLeft = 0;
  private seq = 0;
  private botSeq = 0;
  private events: SpyEvent[] = [];

  constructor(opts: Partial<Options> = {}, rng: Rng = Math.random) {
    this.opts = { rounds: 3, clueTime: 0, guessTime: 0, ...opts };
    this.rng = rng;
  }

  configure(o: Partial<Options>) {
    this.opts = { ...this.opts, ...o };
  }

  drainEvents(): SpyEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  // ------------------------------------------------------------------ who's who
  seat = (id: string) => this.seats.find((s) => s.id === id);
  team = (t: Team) => this.seats.filter((s) => s.team === t).sort((a, b) => a.order - b.order);
  agents = (t: Team) => this.team(t).filter((s) => s.id !== this.handler[t]);
  roleOf(id: string): Role | null {
    const s = this.seat(id);
    if (!s) return null;
    return this.handler[s.team] === id ? "handler" : "agent";
  }
  /** Picks a card needs before it is revealed: more than half of the team's agents. */
  need = (t: Team) => Math.floor(this.agents(t).length / 2) + 1;
  cardsLeft = (t: Team) => this.cards.filter((c) => c.owner === t && !c.revealed).length;
  /** Wins that take the match. */
  get target() {
    return Math.floor(Math.max(1, this.opts.rounds) / 2) + 1;
  }
  /** Most guesses the current clue allows. */
  get maxGuesses() {
    return this.clue ? this.clue.n + 1 : 0;
  }
  humans = () => this.seats.filter((s) => !s.bot);
  bots = () => this.seats.filter((s) => s.bot);
  /** People whose phones have been off a while: a computer plays their seat until they are back (they keep the role). */
  readonly away = new Set<string>();
  setAway(id: string, away: boolean) {
    if (!away) this.away.delete(id);
    else if (this.seat(id) && !this.seat(id)!.bot) this.away.add(id);
  }
  /** Seats a computer plays now: the computer seats and the people who are away. */
  botPlayed = () => this.seats.filter((s) => s.bot || this.away.has(s.id));

  private smaller(): Team {
    const a = this.team("cobalt").length;
    const b = this.team("saffron").length;
    if (a !== b) return a < b ? "cobalt" : "saffron";
    return other(this.turn);
  }

  // ------------------------------------------------------------------ seats
  /** Seats someone. Mid-round they join the smaller team as an agent. Returns null when every seat is taken. */
  addSeat(id: string, name: string, bot = false, team?: Team): Seat | null {
    const had = this.seat(id);
    if (had) return had;
    if (this.seats.length >= MAX_SEATS) {
      // a person takes a computer's seat
      const spare = bot ? undefined : this.spareBot();
      if (!spare) return null;
      this.dropSeat(spare.id);
    }
    const s: Seat = { id, name, bot, team: team ?? this.smaller(), order: this.seq++ };
    this.seats.push(s);
    if (!this.handler[s.team] && this.cards.length) this.setHandler(s.team, id);
    return s;
  }

  addBot(team?: Team): Seat | null {
    const taken = new Set(this.seats.map((s) => s.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Agent ${this.botSeq + 1}`;
    return this.addSeat(`bot-${this.botSeq++}`, name, true, team);
  }

  /** A computer agent that can leave without breaking a team (from the bigger team first). */
  private spareBot(): Seat | undefined {
    const sizes = (t: Team) => this.team(t).length;
    return this.bots()
      .filter((b) => this.handler[b.team] !== b.id && sizes(b.team) > 2)
      .sort((a, b) => sizes(b.team) - sizes(a.team) || b.order - a.order)[0];
  }

  /** Someone leaves. A handler hands over to the next person on the team; a team never drops below two seats. */
  removeSeat(id: string) {
    const s = this.seat(id);
    if (!s) return;
    this.dropSeat(id);
    // the next person on the team takes over first, so a computer that steps in joins as an agent
    if (this.handler[s.team] === null) this.promote(s.team);
    while (this.team(s.team).length < 2) this.addBot(s.team);
    this.settle();
  }

  private dropSeat(id: string) {
    const s = this.seat(id);
    if (!s) return;
    this.seats = this.seats.filter((x) => x.id !== id);
    this.picks.delete(id);
    this.away.delete(id);
    if (this.handler[s.team] === id) this.handler[s.team] = null;
  }

  private promote(t: Team) {
    const team = this.team(t);
    if (!team.length) return;
    const next = team.find((x) => !x.bot) ?? team[0]!;
    this.setHandler(t, next.id);
  }

  private setHandler(t: Team, id: string) {
    this.handler[t] = id;
    this.picks.delete(id);
    this.events.push({ type: "handler", team: t, id });
  }

  /** Brings the computer seats to `wanted` (never below four seats, two a team). Between rounds only. */
  fitBots(wanted: number) {
    const want = Math.max(0, Math.min(wanted, MAX_SEATS - this.humans().length), MIN_SEATS - this.humans().length);
    while (this.bots().length > want) {
      const big = this.team("cobalt").length >= this.team("saffron").length ? "cobalt" : "saffron";
      const b = this.bots().filter((x) => x.team === big).pop() ?? this.bots().pop()!;
      this.dropSeat(b.id);
    }
    while (this.bots().length < want && this.seats.length < MAX_SEATS) this.addBot();
    // even the teams out with computer players (people stay where they are)
    for (;;) {
      const a = this.team("cobalt");
      const b = this.team("saffron");
      if (Math.abs(a.length - b.length) <= 1) break;
      const [big, small] = a.length > b.length ? ([a, "saffron"] as const) : ([b, "cobalt"] as const);
      const mover = big.filter((x) => x.bot).pop();
      if (!mover) break;
      mover.team = small;
    }
    for (const t of TEAMS) while (this.team(t).length < 2) this.addBot(t);
  }

  /** Deals everyone into two teams: people first, alternating, then the computer players. */
  balance() {
    const people = shuffle(this.humans(), this.rng);
    const bots = this.bots();
    const first: Team = this.rng() < 0.5 ? "cobalt" : "saffron";
    const count: Record<Team, number> = { cobalt: 0, saffron: 0 };
    for (const s of [...people, ...bots]) {
      const t = count.cobalt === count.saffron ? (count.cobalt % 2 === 0 ? first : other(first)) : count.cobalt < count.saffron ? "cobalt" : "saffron";
      s.team = t;
      count[t]++;
    }
  }

  // ------------------------------------------------------------------ a match, a round
  startMatch() {
    this.wins = { cobalt: 0, saffron: 0 };
    this.round = 0;
    this.used.clear();
    this.matchWinner = null;
    this.rot = { cobalt: 0, saffron: 0 };
    if (this.wantBots !== null) this.fitBots(this.wantBots);
    this.balance();
    this.startRound();
  }

  startRound() {
    this.round++;
    if (this.wantBots !== null) this.fitBots(this.wantBots);
    const a = this.team("cobalt").length;
    const b = this.team("saffron").length;
    // the smaller team starts (the bigger one goes second); even teams take turns starting
    this.starter = a !== b ? (a < b ? "cobalt" : "saffron") : this.round === 1 ? (this.rng() < 0.5 ? "cobalt" : "saffron") : other(this.starter);
    this.turn = this.starter;
    let pool = WORDS.filter((w) => !this.used.has(w));
    if (pool.length < SIZE) {
      this.used.clear();
      pool = [...WORDS];
    }
    const words = shuffle([...pool], this.rng).slice(0, SIZE);
    for (const w of words) this.used.add(w);
    const owners: Owner[] = [
      ...Array<Owner>(9).fill(this.starter),
      ...Array<Owner>(8).fill(other(this.starter)),
      ...Array<Owner>(7).fill("neutral"),
      "burn",
    ];
    shuffle(owners, this.rng);
    this.cards = words.map((word, i) => ({ word, owner: owners[i]!, revealed: false }));
    // handlers rotate through the team, people first
    for (const t of TEAMS) {
      const team = this.team(t).sort((a, b) => Number(a.bot) - Number(b.bot) || a.order - b.order);
      this.handler[t] = team.length ? team[this.rot[t]++ % team.length]!.id : null;
    }
    this.clue = null;
    this.history = [];
    this.guesses = 0;
    this.picks.clear();
    this.last = null;
    this.roundWinner = null;
    this.roundWhy = null;
    this.setPhase("brief", BEATS.brief);
  }

  private setPhase(p: Phase, ms = 0) {
    this.phase = p;
    this.left = ms;
    this.events.push({ type: "phase", phase: p });
  }

  private toClue() {
    this.clue = null;
    this.guesses = 0;
    this.picks.clear();
    this.setPhase("clue", this.opts.clueTime * 1000);
  }

  private endTurn(why: TurnEnd) {
    this.events.push({ type: "turn", from: this.turn, why });
    this.turn = other(this.turn);
    this.toClue();
  }

  // ------------------------------------------------------------------ time
  step(ms: number) {
    if (this.left <= 0) return;
    this.left -= ms;
    if (this.left > 0) return;
    this.left = 0;
    switch (this.phase) {
      case "brief":
        this.toClue();
        break;
      case "clue":
        this.endTurn("no-clue");
        break;
      case "guess":
        this.endTurn("time");
        break;
      case "reveal":
        this.continueAfterReveal();
        break;
      case "round":
        if (this.wins.cobalt >= this.target || this.wins.saffron >= this.target) {
          this.matchWinner = this.wins.cobalt > this.wins.saffron ? "cobalt" : "saffron";
          this.setPhase("match");
          this.events.push({ type: "match", winner: this.matchWinner });
        } else this.startRound();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ moves
  /** The handler on turn gives a clue. Returns what's wrong with it, or null when it's taken. */
  giveClue(id: string, word: string, n: number): string | null {
    if (this.phase !== "clue") return "It isn't time for a clue";
    if (this.handler[this.turn] !== id) return "It isn't your turn";
    const err = checkClue(word, this.cards.map((c) => c.word));
    if (err) return err;
    const num = Math.round(Number(n));
    if (!(num >= 1 && num <= 9)) return "Pick a number from 1 to 9";
    this.clue = { word: String(word).trim().toLowerCase(), n: num, team: this.turn };
    this.history.push(this.clue);
    this.guesses = 0;
    this.picks.clear();
    this.events.push({ type: "clue", team: this.turn, word: this.clue.word, n: num });
    this.setPhase("guess", this.opts.guessTime * 1000);
    return null;
  }

  /** An agent on turn proposes a card (or STOP, or null to take their pick back). */
  propose(id: string, pick: number | null): boolean {
    if (this.phase !== "guess") return false;
    const s = this.seat(id);
    if (!s || s.team !== this.turn || this.handler[s.team] === id) return false;
    if (pick === null) {
      if (this.picks.delete(id)) this.events.push({ type: "pick", id, pick });
      return true;
    }
    if (pick === STOP) {
      if (this.guesses < 1) return false;
    } else if (!Number.isInteger(pick) || pick < 0 || pick >= this.cards.length || this.cards[pick]!.revealed) return false;
    if (this.picks.get(id) !== pick) this.events.push({ type: "pick", id, pick });
    this.picks.set(id, pick);
    this.settle();
    return true;
  }

  /** How many agents back each pick right now. */
  tally(): Map<number, number> {
    const m = new Map<number, number>();
    for (const [id, p] of this.picks) {
      const s = this.seat(id);
      if (!s || s.team !== this.turn || this.handler[this.turn] === id) continue;
      m.set(p, (m.get(p) ?? 0) + 1);
    }
    return m;
  }

  /** Reveals a card (or ends the turn) once a majority of the team's agents back it. */
  private settle() {
    if (this.phase !== "guess") return;
    const need = this.need(this.turn);
    for (const [p, n] of this.tally()) {
      if (n < need) continue;
      if (p === STOP) return this.endTurn("stop");
      return this.reveal(p);
    }
  }

  private reveal(idx: number) {
    const card = this.cards[idx]!;
    const team = this.turn;
    card.revealed = true;
    this.guesses++;
    this.picks.clear();
    this.last = { idx, owner: card.owner, team };
    this.events.push({ type: "reveal", idx, owner: card.owner, team });
    this.guessLeft = this.left;
    if (card.owner === "burn") this.finishRound(other(team), "burn");
    else if (this.cardsLeft("cobalt") === 0) this.finishRound("cobalt", "cards");
    else if (this.cardsLeft("saffron") === 0) this.finishRound("saffron", "cards");
    else if (card.owner !== team) this.afterReveal = "clue";
    else if (this.guesses >= this.maxGuesses) this.afterReveal = "clue";
    else this.afterReveal = "guess";
    this.setPhase("reveal", BEATS.reveal);
  }

  private finishRound(winner: Team, why: "cards" | "burn") {
    this.roundWinner = winner;
    this.roundWhy = why;
    this.afterReveal = "round";
  }

  private continueAfterReveal() {
    if (this.afterReveal === "round") {
      const w = this.roundWinner!;
      this.wins[w]++;
      this.events.push({ type: "round", winner: w, why: this.roundWhy! });
      this.setPhase("round", BEATS.round);
    } else if (this.afterReveal === "clue") {
      const card = this.last ? this.cards[this.last.idx]! : null;
      this.endTurn(card && card.owner !== this.turn ? "wrong" : "done");
    } else {
      this.setPhase("guess", this.opts.guessTime ? Math.max(1000, this.guessLeft) : 0);
    }
  }
}
