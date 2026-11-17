// Bridge Panic bots. A bot owns a panel and has orders like anybody. It does an order on its OWN panel after 2-5 s;
// when an order (a human's or another bot's) names one of its controls it "hears" it after 3-7 s and does it. The
// older the voyage, the more it slips: now and then it never hears an order, or sets a wrong value first and fixes
// it a moment later. Time runs on the game's own clock (step(dt)), so the tests are stable.
import { range, type Bridge } from "./rules.ts";

export const BOT_NAMES = ["Rivet", "Bolt", "Sprocket", "Gasket", "Cog", "Valve", "Piston"];
export const isBot = (id: string) => id.startsWith("bot-");
const SLIP_MULT = { calm: 1.2, normal: 1.5, frantic: 1.9 } as const;

interface Plan {
  at: number;
  actor: string;
  ctl: string;
  value: number;
  fix: boolean;
}

/** Chance a bot slips on one order in this sector. */
export const slip = (sector: number, mult = 1) => Math.min(0.8, (0.03 + 0.03 * (sector - 1)) * mult);

export class Bots {
  private t = 0;
  private plans = new Map<number, Plan>();
  /** Orders already weighed (a bot that never hears one must not roll again every frame). */
  private seen = new Set<number>();

  constructor(private game: Bridge, private rand: () => number = Math.random) {}

  /** Call every frame, after game.advance(dt). */
  step(dt: number) {
    const g = this.game;
    this.t += dt;
    if (g.phase !== "play") {
      this.plans.clear();
      this.seen.clear();
      return;
    }
    const live = new Set<number>();
    for (const { seat, order } of g.orders()) {
      live.add(order.id);
      if (this.seen.has(order.id)) continue;
      this.seen.add(order.id);
      const c = g.controls.get(order.ctl);
      const owner = c && g.seats.get(c.owner);
      if (!c || !owner?.bot) continue; // a human's panel: the humans must hear it
      const mine = owner.id === seat.id;
      let delay = (mine ? 2000 + this.rand() * 3000 : 3000 + this.rand() * 4000) * (g.options.difficulty === "frantic" ? 0.85 : 1);
      delay = Math.min(delay, order.ttl * 0.8);
      if (this.rand() < slip(g.sector, SLIP_MULT[g.options.difficulty])) {
        if (c.kind === "button" || c.kind === "toggle" || this.rand() < 0.5) continue; // never heard it
        const [lo, hi] = range(c.kind);
        const wrongs: number[] = [];
        for (let v = lo; v <= hi; v++) if (v !== order.target && v !== c.state) wrongs.push(v);
        const w = wrongs[Math.floor(this.rand() * wrongs.length)];
        if (w === undefined) continue;
        this.plans.set(order.id, { at: this.t + delay * 0.8, actor: owner.id, ctl: c.name, value: w, fix: true });
        continue;
      }
      this.plans.set(order.id, { at: this.t + delay, actor: owner.id, ctl: c.name, value: order.target, fix: false });
    }
    for (const [id, p] of [...this.plans]) {
      if (!live.has(id)) {
        this.plans.delete(id);
        continue;
      }
      if (this.t < p.at) continue;
      const order = g.controls.get(p.ctl) && g.orderFor(p.ctl)?.order;
      if (!order || order.id !== id) {
        this.plans.delete(id);
        continue;
      }
      g.act(p.actor, p.ctl, p.value);
      if (p.fix && g.orderFor(p.ctl)?.order.id === id) {
        // the fix: do it right a moment later
        this.plans.set(id, { ...p, at: this.t + 2200 + this.rand() * 1500, value: order.target, fix: false });
      } else {
        this.plans.delete(id);
      }
    }
  }
}
