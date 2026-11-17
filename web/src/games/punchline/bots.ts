// Computer players for Punchline. They answer from a hand-written pool (BOT_ANSWERS in prompts.ts), choosing an
// answer of the kind the prompt asks for, never the same one twice in a match. They vote with a mild preference for
// the shorter, punchier answer and almost never for a stand-in. They take a human-ish while to do both.
// Plain TypeScript: no DOM, so Node can test and simulate it.
import { BOT_ANSWERS, type BotAnswer, type Prompt } from "./prompts.ts";
import { MAX_LEN, type Answer, type Punchline, type Rng } from "./rules.ts";

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

/** How much a bot likes an answer: shorter reads punchier; a stand-in is almost never picked. */
export function appeal(a: Answer | null): number {
  if (!a || a.missing) return 0.04;
  const len = Array.from(a.text).length;
  return Math.exp(-len / (MAX_LEN * 1.2)); // 10 chars ≈ 0.87, 60 chars ≈ 0.43: a mild lean
}

/** Picks one of `options` (indices into `answers`), weighted by appeal. */
export function pickWeighted(answers: readonly (Answer | null)[], options: readonly number[], rng: Rng): number {
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
  /** When a bot sends its first answer, as a share of the answer time [from, to], capped by writeCap ms. */
  write: [number, number];
  writeCap: number;
  /** Milliseconds into a vote. */
  vote: [number, number];
}
export const PACE: Pace = { write: [0.1, 0.45], writeCap: 40000, vote: [1800, 6500] };

/** Plays every seat marked `bot` (bots, and players who left mid-round). Call step() after each advance(). */
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
      if (!s.bot) continue;
      if (g.phase === "write" && s.inRound) {
        const span = Math.min(g.dur, this.pace.writeCap / this.pace.write[1]);
        g.tasks(s.id).forEach((task, n) => {
          if (task.answer) return;
          // the second answer comes a little after the first
          if (!this.due(s.id, task.key, () => span * r(this.pace.write[0], this.pace.write[1]) + n * r(2500, 9000))) return;
          g.answer(s.id, task.key, pickAnswer(task.prompt, this.rng, this.used, g.opts.family));
        });
      } else if (g.phase === "vote" && g.canVote(s.id) && !g.hasVoted(s.id)) {
        const key = g.voteKey()!;
        const extra = g.final ? 3000 : 0;
        if (!this.due(s.id, key, () => r(this.pace.vote[0], this.pace.vote[1]) + extra)) continue;
        if (g.final) {
          g.vote(s.id, key, pickWeighted(g.final.entries.map((e) => e.answer), g.options(s.id), this.rng));
        } else {
          const p = g.current()!;
          g.vote(s.id, key, pickWeighted(p.answers, [0, 1], this.rng));
        }
      }
    }
  }
}
