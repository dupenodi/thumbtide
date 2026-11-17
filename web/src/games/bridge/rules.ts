// Bridge Panic: the rules, with no DOM. A crew runs a ship's bridge. Every player has a panel of silly controls and
// ONE active order ("Set Flux Damper to 3"), but the control is usually on somebody else's panel, so people shout.
// Doing the right action on any panel completes the order. A wrong or late order costs hull; hull 0 ends the voyage.
// A sector needs a number of completed orders, then the panels are dealt again and the orders get faster.
// The random source is injected, so the tests are stable.
import { CONTROL_NAMES, LEVER_ENDS } from "./names.ts";

export type Kind = "button" | "toggle" | "dial" | "slider" | "lever";
export type Phase = "wait" | "intro" | "play" | "break" | "end";
export type Difficulty = "calm" | "normal" | "frantic";
export type EventKind = "lights" | "swap";

export const MAX_SEATS = 8;
export const MIN_SEATS = 2;
export const HULL_MAX = 100;
export const BEATS = { intro: 3200, break: 4800 } as const;
export const DIFFICULTIES: readonly Difficulty[] = ["calm", "normal", "frantic"];
export const LIGHTS_MS = 9000;
export const SWAP_MS = 2600;
const WRONG_COOLDOWN = 500;

interface Tune {
  /** Order time in sector 1 (ms) and the shortest it gets. */
  base: number;
  floor: number;
  /** Hull lost for a late order and for a wrong setting; hull mended between sectors. */
  miss: number;
  wrong: number;
  heal: number;
}
export const TUNE: Record<Difficulty, Tune> = {
  calm: { base: 18000, floor: 8000, miss: 8, wrong: 3, heal: 20 },
  normal: { base: 14000, floor: 6500, miss: 10, wrong: 4, heal: 15 },
  frantic: { base: 11000, floor: 5200, miss: 14, wrong: 6, heal: 10 },
};

export interface Options {
  difficulty: Difficulty;
  events: boolean;
}

export interface Control {
  name: string;
  kind: Kind;
  owner: string;
  state: number;
  /** Lever only: the names of position 0 and 1. */
  opts?: readonly [string, string];
  wrongAt: number;
}

export interface Order {
  id: number;
  ctl: string;
  target: number;
  text: string;
  ttl: number;
  left: number;
}

export interface Seat {
  id: string;
  name: string;
  bot: boolean;
  slot: number;
  panel: string[];
  order: Order | null;
  done: number;
}

export type BridgeEvent =
  | { type: "phase"; phase: Phase }
  | { type: "done"; seat: string; ctl: string }
  | { type: "miss"; seat: string }
  | { type: "wrong"; seat: string; ctl: string }
  | { type: "ctl"; seat: string; ctl: string }
  | { type: "event"; kind: EventKind }
  | { type: "orders" };

/** A small seeded random source (mulberry32) for the tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const panelSize = (crew: number) => (crew <= 3 ? 6 : crew <= 5 ? 5 : 4);
export const quotaFor = (crew: number) => 3 + 3 * Math.max(1, crew);
const WIDE: readonly Kind[] = ["dial", "slider"];
const KIND_WEIGHTS: ReadonlyArray<[Kind, number]> = [
  ["button", 30], ["toggle", 25], ["dial", 15], ["slider", 15], ["lever", 15],
];

/** Highest value of a control (dial 1–5, slider 0–4, others 0–1). */
export const range = (kind: Kind): [number, number] =>
  kind === "dial" ? [1, 5] : kind === "slider" ? [0, 4] : [0, 1];

export function orderText(c: Pick<Control, "name" | "kind" | "opts">, target: number): string {
  switch (c.kind) {
    case "button":
      return `Push ${c.name}`;
    case "toggle":
      return `Switch ${c.name} ${target ? "on" : "off"}`;
    case "dial":
      return `Set ${c.name} to ${target}`;
    case "slider":
      return `Slide ${c.name} to ${target}`;
    case "lever":
      return `Throw ${c.name} to ${c.opts![target]}`;
  }
}

export class Bridge {
  phase: Phase = "wait";
  sector = 1;
  quota = 0;
  done = 0;
  /** Orders completed in the whole voyage. */
  total = 0;
  hull = HULL_MAX;
  event: { kind: EventKind; left: number } | null = null;
  readonly seats = new Map<string, Seat>();
  readonly controls = new Map<string, Control>();
  private opts: Options;
  private events: BridgeEvent[] = [];
  private timer = 0;
  private evTimer = 0;
  private clock = 0;
  private serial = 0;
  private uses = new Map<string, number>();
  /** The sector the panels were last dealt for (a seat that joins later is dealt into it). */
  dealt = 0;

  constructor(opts: Options, private rand: () => number = Math.random) {
    this.opts = { ...opts };
  }

  configure(o: Options) {
    this.opts = { ...o };
  }
  get options(): Options {
    return this.opts;
  }
  get tune(): Tune {
    return TUNE[this.opts.difficulty];
  }

  // ------------------------------------------------------------ seats
  list(): Seat[] {
    return [...this.seats.values()].sort((a, b) => a.slot - b.slot);
  }
  crew() {
    return this.seats.size;
  }

  addSeat(id: string, name: string, bot: boolean, slot?: number): Seat | null {
    const have = this.seats.get(id);
    if (have) return have;
    if (this.seats.size >= MAX_SEATS) return null;
    const used = new Set([...this.seats.values()].map((s) => s.slot));
    let sl = slot !== undefined && slot >= 0 && slot < MAX_SEATS && !used.has(slot) ? slot : -1;
    for (let i = 0; sl < 0 && i < MAX_SEATS; i++) if (!used.has(i)) sl = i;
    const seat: Seat = { id, name, bot, slot: sl, panel: [], order: null, done: 0 };
    this.seats.set(id, seat);
    if (this.phase === "play" || this.phase === "intro") {
      this.dealSeat(seat, this.shuffledNames());
      if (this.phase === "play") {
        this.issue(seat);
        this.events.push({ type: "orders" });
      }
    }
    if (this.phase === "wait") this.ready();
    return seat;
  }

  removeSeat(id: string) {
    const seat = this.seats.get(id);
    if (!seat) return;
    this.seats.delete(id);
    for (const n of seat.panel) this.controls.delete(n);
    if (this.seats.size === 0) {
      if (this.phase !== "end") this.setPhase("wait");
      return;
    }
    if (this.phase === "play") {
      for (const s of this.seats.values()) if (s.order && !this.controls.has(s.order.ctl)) this.issue(s);
      this.events.push({ type: "orders" });
    }
  }

  /** The seat starts the voyage when it waited for a crew. */
  ready() {
    if (this.phase === "wait" && this.seats.size > 0) this.startMatch();
  }

  // ------------------------------------------------------------ the voyage
  startMatch() {
    this.sector = 1;
    this.done = 0;
    this.total = 0;
    this.hull = HULL_MAX;
    this.event = null;
    this.uses.clear();
    for (const s of this.seats.values()) {
      s.done = 0;
      s.order = null;
    }
    if (this.seats.size === 0) return this.setPhase("wait");
    this.beginSector();
  }

  private beginSector() {
    this.deal();
    this.done = 0;
    this.event = null;
    this.timer = BEATS.intro;
    this.setPhase("intro");
  }

  /** Every panel is dealt anew: new controls, new names, new states. */
  private deal() {
    this.controls.clear();
    this.uses.clear();
    const pool = this.shuffledNames();
    for (const s of this.seats.values()) {
      s.panel = [];
      s.order = null;
      this.dealSeat(s, pool);
    }
    this.quota = quotaFor(this.seats.size);
    this.dealt = this.sector;
  }

  private shuffledNames(): string[] {
    const free = CONTROL_NAMES.filter((n) => !this.controls.has(n));
    for (let i = free.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [free[i], free[j]] = [free[j]!, free[i]!];
    }
    return free;
  }

  private pickKind(allowWide: boolean): Kind {
    const list = KIND_WEIGHTS.filter(([k]) => allowWide || !WIDE.includes(k));
    let r = this.rand() * list.reduce((a, [, w]) => a + w, 0);
    for (const [k, w] of list) if ((r -= w) < 0) return k;
    return "button";
  }

  private dealSeat(seat: Seat, pool: string[]) {
    seat.panel = [];
    let wide = 0;
    for (let i = 0; i < panelSize(this.seats.size); i++) {
      const name = pool.pop();
      if (!name) break;
      const kind = this.pickKind(wide < 2);
      if (WIDE.includes(kind)) wide++;
      const [lo, hi] = range(kind);
      const c: Control = {
        name,
        kind,
        owner: seat.id,
        state: kind === "button" ? 0 : lo + Math.floor(this.rand() * (hi - lo + 1)),
        wrongAt: -1e9,
      };
      if (kind === "lever") c.opts = LEVER_ENDS[Math.floor(this.rand() * LEVER_ENDS.length)]!;
      this.controls.set(name, c);
      seat.panel.push(name);
    }
  }

  // ------------------------------------------------------------ orders
  /** Order time for the current sector (ms). */
  orderTime(): number {
    const t = this.tune;
    return Math.max(t.floor, t.base * 0.93 ** (this.sector - 1)) + 600 * Math.max(0, this.seats.size - 2);
  }

  /** Gives the seat a new order: a control that exists, a state it is not in, and no other order on it. */
  private issue(seat: Seat, first = false) {
    seat.order = null;
    const busy = new Set<string>();
    for (const s of this.seats.values()) if (s.order) busy.add(s.order.ctl);
    const cands: Array<{ c: Control; w: number }> = [];
    const others = this.seats.size > 1;
    for (const c of this.controls.values()) {
      if (busy.has(c.name)) continue;
      // mostly somebody else's control: that is the game
      const own = c.owner === seat.id;
      if (own && others && this.rand() < 0.8) continue;
      cands.push({ c, w: 1 / (1 + (this.uses.get(c.name) ?? 0) * 1.5) });
    }
    if (!cands.length) return;
    let r = this.rand() * cands.reduce((a, x) => a + x.w, 0);
    let pick = cands[cands.length - 1]!.c;
    for (const x of cands) if ((r -= x.w) < 0) {
      pick = x.c;
      break;
    }
    const [lo, hi] = range(pick.kind);
    let target = 1;
    if (pick.kind !== "button") {
      const options: number[] = [];
      for (let v = lo; v <= hi; v++) if (v !== pick.state) options.push(v);
      target = options[Math.floor(this.rand() * options.length)]!;
    }
    const ttl = Math.round(this.orderTime() * (first ? 1 + 0.5 * this.rand() : 0.9 + 0.2 * this.rand()));
    seat.order = { id: ++this.serial, ctl: pick.name, target, text: orderText(pick, target), ttl, left: ttl };
    this.uses.set(pick.name, (this.uses.get(pick.name) ?? 0) + 1);
  }

  /** The order that wants this control, with the seat that holds it. */
  orderFor(ctl: string): { seat: Seat; order: Order } | null {
    for (const s of this.seats.values()) if (s.order?.ctl === ctl) return { seat: s, order: s.order };
    return null;
  }

  /**
   * A player moves one of their own controls. A button is pressed (value 1); a toggle or lever goes to 0 or 1; a dial
   * to 1–5; a slider to 0–4. "done": it completed an order. "wrong": the control has an order for another state.
   */
  act(id: string, name: string, value: number): "done" | "set" | "wrong" | "ignored" {
    if (this.phase !== "play") return "ignored";
    const seat = this.seats.get(id);
    const c = this.controls.get(name);
    if (!seat || !c || c.owner !== id || !Number.isInteger(value)) return "ignored";
    if (c.kind === "button") {
      if (value !== 1) return "ignored";
    } else {
      const [lo, hi] = range(c.kind);
      if (value < lo || value > hi || value === c.state) return "ignored";
      c.state = value;
    }
    this.events.push({ type: "ctl", seat: id, ctl: name });
    const hit = this.orderFor(name);
    if (!hit) return "set";
    if (c.kind === "button" || value === hit.order.target) {
      this.complete(hit.seat);
      return "done";
    }
    if (this.clock - c.wrongAt >= WRONG_COOLDOWN) {
      c.wrongAt = this.clock;
      this.events.push({ type: "wrong", seat: hit.seat.id, ctl: name });
      this.hurt(this.tune.wrong);
    }
    return "wrong";
  }

  private complete(seat: Seat) {
    const o = seat.order!;
    this.events.push({ type: "done", seat: seat.id, ctl: o.ctl });
    seat.order = null;
    seat.done++;
    this.total++;
    this.done++;
    if (this.done >= this.quota) return this.endSector();
    this.issue(seat);
    this.events.push({ type: "orders" });
  }

  private hurt(n: number) {
    this.hull = Math.max(0, this.hull - n);
    if (this.hull <= 0 && this.phase === "play") {
      for (const s of this.seats.values()) s.order = null;
      this.event = null;
      this.setPhase("end");
    }
  }

  private endSector() {
    for (const s of this.seats.values()) s.order = null;
    this.event = null;
    this.hull = Math.min(HULL_MAX, this.hull + this.tune.heal);
    this.timer = BEATS.break;
    this.setPhase("break");
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.events.push({ type: "phase", phase: p });
  }

  // ------------------------------------------------------------ time
  advance(dt: number) {
    this.clock += dt;
    if (this.phase === "intro") {
      this.timer -= dt;
      if (this.timer <= 0) this.startPlay();
    } else if (this.phase === "break") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.sector++;
        this.beginSector();
      }
    } else if (this.phase === "play") {
      this.tick(dt);
    }
  }

  private startPlay() {
    this.setPhase("play");
    this.evTimer = 22000 + this.rand() * 18000;
    for (const s of this.list()) this.issue(s, true);
    this.events.push({ type: "orders" });
  }

  private tick(dt: number) {
    for (const s of this.list()) {
      const o = s.order;
      if (!o) {
        if (this.controls.size) this.issue(s);
        continue;
      }
      o.left -= dt;
      if (o.left > 0) continue;
      this.events.push({ type: "miss", seat: s.id });
      this.hurt(this.tune.miss);
      if (this.phase !== "play") return;
      this.issue(s);
      this.events.push({ type: "orders" });
    }
    if (this.event) {
      this.event.left -= dt;
      if (this.event.left <= 0) {
        this.event = null;
        this.evTimer = 28000 + this.rand() * 22000;
        this.events.push({ type: "orders" });
      }
    } else if (this.opts.events && this.sector >= 2 && this.seats.size >= 2) {
      this.evTimer -= dt;
      if (this.evTimer <= 0) this.startEvent();
    }
  }

  private startEvent() {
    const live = this.list().filter((s) => s.order);
    if (live.length >= 2 && this.rand() < 0.45) {
      const a = live[Math.floor(this.rand() * live.length)]!;
      const rest = live.filter((s) => s !== a);
      const b = rest[Math.floor(this.rand() * rest.length)]!;
      [a.order, b.order] = [b.order, a.order];
      this.event = { kind: "swap", left: SWAP_MS };
    } else {
      this.event = { kind: "lights", left: LIGHTS_MS };
    }
    this.events.push({ type: "event", kind: this.event.kind }, { type: "orders" });
  }

  drainEvents(): BridgeEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Seats with an order, in seat order. */
  orders(): Array<{ seat: Seat; order: Order }> {
    return this.list().flatMap((seat) => (seat.order ? [{ seat, order: seat.order }] : []));
  }

  /** Orders done per seat, best first. */
  standings(): Seat[] {
    return this.list().sort((a, b) => b.done - a.done || a.slot - b.slot);
  }
}
