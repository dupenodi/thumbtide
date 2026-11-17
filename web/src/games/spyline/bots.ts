// Computer players. They read the deck's clue words (deck.ts) as their word sense.
//
// A bot handler looks at every clue word its own cards list, counts how many of its cards each one links to, and
// steers clear of words that link to the burn card or the other team's cards. Some noise keeps it human.
// A bot agent sees only what a person sees (the words, what's been revealed, the clue and the team's picks). It
// scores each card against the clue the other way round, proposes the best one after a moment, follows a person's
// pick most of the time, and joins the team's most popular pick when the team can't agree. It stops when the clue
// seems used up.
import { DECK } from "./deck.ts";
import { STOP, checkClue, fold, other, type Card, type Clue, type Rng, type Spyline, type Team } from "./rules.ts";

// ------------------------------------------------------------------ the word sense
/** clue word (folded) → deck words that list it */
const REV = new Map<string, Set<string>>();
for (const [w, clues] of DECK) {
  for (const c of clues) {
    const k = fold(c);
    if (!REV.has(k)) REV.set(k, new Set());
    REV.get(k)!.add(w);
  }
}
const assoc = (w: string) => DECK.get(w) ?? [];

/** Words that sit near a clue: its own clue words (if it's a deck word) and the deck words that list it. */
function near(clue: string): Set<string> {
  const k = fold(clue);
  const out = new Set<string>();
  for (const a of assoc(clue)) out.add(fold(a));
  for (const w of REV.get(k) ?? []) {
    out.add(w);
    for (const a of assoc(w)) out.add(fold(a));
  }
  out.delete(k);
  return out;
}

/** How strongly a clue points at a card word: 1 for a direct link, less for a shared neighbourhood, 0 for none. */
export function link(clue: string, word: string, around = near(clue)): number {
  const k = fold(clue.toLowerCase());
  if (assoc(word).some((a) => fold(a) === k)) return 1;
  if (assoc(k).includes(word) || assoc(clue).includes(word)) return 1;
  let shared = 0;
  for (const a of assoc(word)) if (around.has(fold(a))) shared++;
  if (around.has(word)) shared++;
  let s = Math.min(0.7, shared * 0.18);
  // a clue that starts like the word ("sailor" for SAIL is taken out by the clue check, but "sailing" style links remain)
  let p = 0;
  while (p < k.length && p < word.length && k[p] === word[p]) p++;
  if (p >= 4) s = Math.max(s, 0.45);
  return s;
}

// ------------------------------------------------------------------ the handler
export interface ClueIdea {
  word: string;
  n: number;
  /** The cards it means. */
  targets: number[];
  score: number;
}

/** The best clue a handler can find for its team's cards on this board. */
export function chooseClue(cards: readonly Card[], team: Team, rng: Rng, noise = 0.35, used: readonly string[] = []): ClueIdea {
  const words = cards.map((c) => c.word);
  const old = new Set(used.map(fold));
  const mine = cards.flatMap((c, i) => (c.owner === team && !c.revealed ? [i] : []));
  const seen = new Set<string>();
  let best: ClueIdea | null = null;
  for (const i of mine) {
    for (const cand of assoc(cards[i]!.word)) {
      if (seen.has(cand) || old.has(fold(cand))) continue;
      seen.add(cand);
      if (checkClue(cand, words)) continue;
      const around = near(cand);
      const targets: number[] = [];
      const weak: number[] = [];
      let risk = 0;
      let deadly = false;
      cards.forEach((c, j) => {
        if (c.revealed) return;
        const l = link(cand, c.word, around);
        if (c.owner === team) {
          if (l >= 0.9) targets.push(j);
          else if (l >= 0.5) weak.push(j);
        } else if (c.owner === "burn") {
          if (l >= 0.3) deadly = true;
        } else if (c.owner === other(team)) risk += l >= 0.9 ? 1.6 : l >= 0.3 ? 0.5 : 0;
        else risk += l >= 0.9 ? 0.7 : l >= 0.3 ? 0.2 : 0;
      });
      if (deadly || !targets.length) continue;
      // a looser link counts too, for a braver clue, but less
      const all = [...targets, ...weak].slice(0, 3);
      const score = targets.length * 1.1 + (all.length - Math.min(3, targets.length)) * 0.8 - risk + (rng() - 0.5) * noise * 2;
      if (!best || score > best.score) best = { word: cand, n: all.length, targets: all, score };
    }
  }
  if (best) return best;
  // nothing clean: any fair word for one of the cards, or a plain fallback
  for (const i of mine) {
    for (const cand of assoc(cards[i]!.word)) if (!checkClue(cand, words)) return { word: cand, n: 1, targets: [i], score: 0 };
  }
  const plain = ["object", "thing", "item", "matter", "stuff"].find((w) => !checkClue(w, words)) ?? "zed";
  return { word: plain, n: 1, targets: [], score: -1 };
}

// ------------------------------------------------------------------ an agent
export interface TeamPick {
  id: string;
  pick: number;
  human: boolean;
}

/**
 * What an agent proposes now, from public information only. `patience` grows with each look, so a bot that has
 * looked a few times joins the team's most popular pick rather than holding out.
 */
export function choosePick(
  board: readonly { word: string; revealed: boolean }[],
  clue: Clue,
  guesses: number,
  team: readonly TeamPick[],
  me: string,
  rng: Rng,
  opts: { noise: number; looks: number; history?: readonly Clue[] },
): number {
  const others = team.filter((t) => t.id !== me);
  // follow a person most of the time: they're the ones playing
  const human = popular(others.filter((t) => t.human));
  if (human !== null && (human !== STOP || guesses > 0) && rng() < 0.85) return human;

  const around = near(clue.word);
  const scored = board
    .map((c, i) => ({ i, s: c.revealed ? -9 : link(clue.word, c.word, around) + (rng() - 0.5) * opts.noise * 2 }))
    .sort((a, b) => b.s - a.s);
  const top = scored[0]!;
  let mine: number;
  if (guesses < clue.n) mine = top.s >= 0.3 || guesses === 0 ? top.i : STOP;
  else mine = top.s >= 0.85 && rng() < 0.3 ? top.i : STOP; // the bonus guess: only for a sure thing, now and then
  // an older clue of ours may still have a card out there
  if (mine === STOP && guesses < clue.n + 1 && opts.history?.length) {
    for (const old of opts.history) {
      if (old === clue || old.team !== clue.team) continue;
      const hit = board.findIndex((c) => !c.revealed && link(old.word, c.word) >= 1);
      if (hit >= 0 && rng() < 0.5) {
        mine = hit;
        break;
      }
    }
  }

  // the team's leading pick: join it when it's close to ours, or when we've waited long enough
  const lead = popular(others);
  if (lead !== null && lead !== mine && (lead !== STOP || guesses > 0)) {
    const leadScore = lead === STOP ? 0.3 : (scored.find((x) => x.i === lead)?.s ?? 0);
    const mineScore = mine === STOP ? 0.3 : (scored.find((x) => x.i === mine)?.s ?? 0);
    if (leadScore >= mineScore - 0.3 || opts.looks >= 2) return lead;
  }
  return mine;
}

/** The pick most of them back (ties: the earliest). */
function popular(list: readonly TeamPick[]): number | null {
  const m = new Map<number, number>();
  for (const t of list) m.set(t.pick, (m.get(t.pick) ?? 0) + 1);
  let best: number | null = null;
  let n = 0;
  for (const [p, c] of m) if (c > n) [best, n] = [p, c];
  return best;
}

// ------------------------------------------------------------------ running them
interface Mind {
  wait: number;
  /** The settling pick it already held back once. */
  held: string;
  /** What the bot last reacted to. */
  seen: string;
  looks: number;
  noise: number;
  pace: number;
}

export interface BotTiming {
  /** ms a handler takes for a clue (plus up to half again). */
  think: number;
  /** ms an agent takes to look at the board (plus up to the same again). */
  look: number;
}

/** Plays every computer seat; call step(ms) along with the game's own step. */
export function createBots(g: Spyline, rng: Rng = g.rng, timing: BotTiming = { think: 2600, look: 1000 }) {
  const minds = new Map<string, Mind>();
  const mind = (id: string): Mind => {
    let m = minds.get(id);
    if (!m) {
      m = { wait: 0, held: "", seen: "", looks: 0, noise: 0.22 + rng() * 0.25, pace: 0.8 + rng() * 0.5 };
      minds.set(id, m);
    }
    return m;
  };

  function step(ms: number) {
    if (g.phase !== "clue" && g.phase !== "guess") return;
    for (const s of g.bots()) {
      const m = mind(s.id);
      const handler = g.handler[s.team] === s.id;
      if (s.team !== g.turn) continue;
      if (g.phase === "clue" && handler) {
        const key = `clue:${g.round}:${g.turn}:${g.history.length}`;
        if (m.seen !== key) {
          m.seen = key;
          m.wait = timing.think * m.pace * (1 + rng() * 0.5);
        }
        m.wait -= ms;
        if (m.wait > 0) continue;
        const idea = chooseClue(g.cards, s.team, rng, 0.35, g.history.map((c) => c.word));
        if (g.giveClue(s.id, idea.word, idea.n)) g.giveClue(s.id, "object", 1);
        m.seen = "";
      } else if (g.phase === "guess" && !handler) {
        const picks = [...g.picks].map(([id, pick]) => ({ id, pick, human: !g.seat(id)?.bot }));
        const key = `guess:${g.round}:${g.history.length}:${g.guesses}`;
        if (m.seen !== key) {
          m.seen = key;
          m.looks = 0;
          m.wait = timing.look * m.pace * (1 + rng());
        }
        m.wait -= ms;
        if (m.wait > 0) continue;
        const pick = choosePick(g.cards, g.clue!, g.guesses, picks, s.id, rng, { noise: m.noise, looks: m.looks, history: g.history });
        m.looks++;
        m.wait = timing.look * 0.7 * m.pace * (1 + rng());
        if (g.picks.get(s.id) === pick) continue;
        // the pick that would settle it waits a beat, so the room sees the team's dots before the card turns
        const backers = picks.filter((p) => p.pick === pick && p.id !== s.id).length;
        if (backers + 1 >= g.need(s.team) && backers > 0 && m.held !== `${key}:${pick}`) {
          m.held = `${key}:${pick}`;
          m.wait = 700 + rng() * 900;
          continue;
        }
        g.propose(s.id, pick);
        if (g.phase !== "guess") return;
      }
    }
  }

  return { step, forget: (id: string) => minds.delete(id) };
}
