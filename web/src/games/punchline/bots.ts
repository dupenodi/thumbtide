// Computer players for Punchline. They answer from a hand-written pool (BOT_ANSWERS in prompts.ts), choosing an
// answer of the kind the prompt asks for, never the same one twice in a match. They vote with a mild preference for
// the shorter, punchier answer. They take a human-ish while to do both.
// Plain TypeScript: no DOM, so Node can test and simulate it.
import { BOT_ANSWERS, type BotAnswer, type Prompt } from "./prompts.ts";
import { MAX_LEN, type Punchline, type Rng } from "./rules.ts";

export const BOT_NAMES = ["Mabel", "Otis", "Dot", "Reggie", "Pearl", "Stan", "Vera", "Lenny", "Ida", "Morris", "Fern", "Clive"];

export const isBot = (id: string) => id.startsWith("bot-");

/** An answer that fits the prompt, not used yet this match (falls back to any unused one, then any at all). */
export function pickAnswer(prompt: Prompt, rng: Rng, used: Set<string>, family: boolean, pool: readonly BotAnswer[] = BOT_ANSWERS): string {
  const ok = pool.filter((a) => (!family || a.fam) && !used.has(a.text));
  const fit = ok.filter((a) => a.cat === prompt.cat);
  const from = fit.length ? fit : ok.length ? ok : pool;
  const a = from[Math.floor(rng() * from.length)]!;
  used.add(a.text);
  return a.text;
}

/** How much a bot likes an answer: shorter reads punchier. */
export function appeal(text: string): number {
  const len = Array.from(text).length;
  return Math.exp(-len / (MAX_LEN * 1.2));
}

/** Picks one of `options` (indices into `answers`), weighted by appeal. */
export function pickWeighted(answers: readonly string[], options: readonly number[], rng: Rng): number {
  const w = options.map((i) => appeal(answers[i]!) * (0.75 + rng() * 0.5));
  const sum = w.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let k = 0; k < options.length; k++) {
    r -= w[k]!;
    if (r <= 0) return options[k]!;
  }
  return options[options.length - 1]!;
}

export interface Pace {
  /** When a bot sends its answer, as a share of the answer time [from, to], capped by writeCap ms. */
  write: [number, number];
  writeCap: number;
  /** Milliseconds into a vote. */
  vote: [number, number];
}
export const PACE: Pace = { write: [0.12, 0.6], writeCap: 38000, vote: [2500, 14000] };

/** Plays every seat marked `bot`. Call step() after each advance(). */
export class Bots {
  private plan = new Map<string, number>();
  private used = new Set<string>();
  private match = -1;

  constructor(
    readonly game: Punchline,
    readonly rng: Rng = Math.random,
    readonly pace: Pace = PACE,
  ) {}

  private due(id: string, key: string, make: () => number): boolean {
    const k = `${id}|${key}`;
    let at = this.plan.get(k);
    if (at === undefined) {
      at = make();
      this.plan.set(k, at);
    }
    return this.game.t >= at;
  }

  step() {
    const g = this.game;
    if (g.match !== this.match) {
      this.match = g.match;
      this.plan.clear();
      this.used.clear();
    }
    const r = (a: number, b: number) => a + (b - a) * this.rng();
    for (const s of g.list()) {
      if (!s.bot || s.left) continue;
      if (g.phase === "write") {
        const task = g.task(s.id);
        if (!task || task.text !== null) continue;
        const span = Math.min(g.opts.time * 1000, this.pace.writeCap / this.pace.write[1]);
        if (!this.due(s.id, task.key, () => span * r(this.pace.write[0], this.pace.write[1]))) continue;
        g.answer(s.id, task.key, pickAnswer(task.prompt, this.rng, this.used, g.opts.family));
      } else if (g.phase === "vote" && g.canVote(s.id) && !g.hasVoted(s.id)) {
        const key = g.key();
        if (!this.due(s.id, key, () => r(this.pace.vote[0], this.pace.vote[1]))) continue;
        const texts = g.shown.map((ei) => g.entries[ei]!.text!);
        g.vote(s.id, key, pickWeighted(texts, g.options(s.id), this.rng));
      }
    }
  }
}
