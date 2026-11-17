// Computer lines. About ten times a second each bot traces a few candidate paths on the occupancy grid (hold left,
// right or straight for a moment, then straight; or keep turning) and takes the one that runs longest before it
// touches anything. Each bot has its own look-ahead, reaction time and a little noise, so they can be beaten.
import { ARENA_H, ARENA_W, HALF, MAX_SEATS, turnRate, type Rng, type Seat, type Trails } from "./rules.ts";

export const BOT_NAMES = ["Vector", "Sine", "Tangent", "Radian", "Chord", "Delta", "Arc", "Vertex"];
export const isBot = (id: string) => id.startsWith("bot-");

/** Candidate paths: turn this way (-1 left, 1 right) for `hold` seconds, then straight. */
const PLANS: { turn: number; hold: number }[] = [
  { turn: 0, hold: 0 },
  { turn: -1, hold: 0.25 },
  { turn: 1, hold: 0.25 },
  { turn: -1, hold: 0.6 },
  { turn: 1, hold: 0.6 },
  { turn: -1, hold: 99 },
  { turn: 1, hold: 99 },
];

interface Mind {
  plan: number;
  /** Steps until it thinks again. */
  wait: number;
  look: number;
  noise: number;
  react: number;
  /** Steps left of a gentle wander while the way is clear. */
  wander: number;
  wanderTurn: number;
}

/** How far a line could go along a plan before it touches a trail or the edge (capped at `max`). */
export function freeRun(game: Trails, s: Seat, turn: number, hold: number, max: number): number {
  const v = game.speed;
  const w = turnRate(v);
  const ds = 2;
  const da = (w * ds) / v;
  const holdLen = hold * v;
  // a line that keeps turning comes round to its own trail; this check can't see that, so stop short of it
  const limit = turn && hold >= 99 ? Math.min(max, ((2 * Math.PI * v) / w) * 0.75) : max;
  let x = s.x;
  let y = s.y;
  let a = s.a;
  const side = HALF * 0.8;
  for (let d = ds; d <= limit; d += ds) {
    if (turn && d <= holdLen) a += turn * da;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    x += c * ds;
    y += sn * ds;
    const tx = x + c * (HALF + 1);
    const ty = y + sn * (HALF + 1);
    if (tx < 2 || ty < 2 || tx >= ARENA_W - 2 || ty >= ARENA_H - 2) return d;
    for (let k = -1; k <= 1; k++) {
      if (game.cellAt(tx - sn * side * k, ty + c * side * k, s.slot, s.dist + d) !== null) return d;
    }
  }
  return limit;
}

export function createBots(game: Trails, rng: Rng = Math.random) {
  const minds = new Map<string, Mind>();

  const think = (s: Seat, m: Mind) => {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < PLANS.length; i++) {
      const p = PLANS[i]!;
      let score = freeRun(game, s, p.turn, p.hold, m.look);
      score += (rng() - 0.5) * 2 * m.noise;
      if (i === m.plan) score += 8; // don't flip-flop
      if (p.turn === 0) score += 4;
      if (m.wander > 0 && p.turn === m.wanderTurn && p.hold < 1) score += 14;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    m.plan = best;
  };

  return {
    /** Add or remove bots to reach `n` (players come first: bots only take free seats). */
    setCount(n: number) {
      n = Math.max(0, Math.min(MAX_SEATS, Math.floor(n)));
      while (minds.size > n) {
        const id = [...minds.keys()].pop()!;
        minds.delete(id);
        game.removeSeat(id);
      }
      for (let i = 0; minds.size < n && i < MAX_SEATS; i++) {
        const id = `bot-${i}`;
        if (minds.has(id)) continue;
        if (!game.addSeat(id, BOT_NAMES[i]!, true)) break;
        const skill = rng();
        minds.set(id, {
          plan: 0,
          wait: 0,
          look: 190 + skill * 200,
          noise: 26 - skill * 18,
          react: 9 - Math.round(skill * 4),
          wander: 0,
          wanderTurn: 1,
        });
      }
    },

    /** Free a seat for a player who needs one. True if a bot stepped aside. */
    yieldOne(): boolean {
      const id = [...minds.keys()].pop();
      if (!id) return false;
      minds.delete(id);
      game.removeSeat(id);
      return true;
    },

    get count() {
      return minds.size;
    },

    step() {
      if (game.phase !== "play") {
        for (const id of minds.keys()) game.setInput(id, false, false);
        return;
      }
      for (const [id, m] of minds) {
        const s = game.seats.get(id);
        if (!s || !s.alive) continue;
        if (m.wander > 0) m.wander--;
        else if (rng() < 0.004) {
          m.wander = 20 + Math.floor(rng() * 40);
          m.wanderTurn = rng() < 0.5 ? -1 : 1;
        }
        if (--m.wait <= 0) {
          m.wait = m.react + Math.floor(rng() * 3);
          think(s, m);
        }
        const p = PLANS[m.plan]!;
        game.setInput(id, p.turn < 0, p.turn > 0);
        // a hold plan turns for its time, then the bot thinks again from straight
        if (p.turn && p.hold < 1 && m.wait > p.hold * 60) m.wait = Math.max(1, Math.round(p.hold * 60));
      }
    },
  };
}
