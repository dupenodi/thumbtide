// Computer wrestlers. A few times a second each bot looks at the ring and picks what to do:
//  - near the rope and drifting out: steer back to the middle (a strong bot dashes back in when it's close);
//  - a dash coming at it: sometimes sidestep it, the side toward the middle (or brace if it's at the rope);
//  - otherwise pick a rival (near, and near the rope counts double), get round to the middle side of it and push it
//    outward, and dash into it when it stands between the bot and the rope.
// Each bot has its own skill (reaction time, aim, caution), so they can be beaten.
import { BODY_R, BRACE_BAND, DASH_V, MAX_SEATS, PULL_STEPS, SHRINK_AFTER, SHRINK_BY, type Rng, type Seat, type Shove } from "./rules.ts";

export const BOT_NAMES = ["Boulder", "Anvil", "Mochi", "Tide", "Granite", "Kettle", "Bramble", "Sumo"];
export const isBot = (id: string) => id.startsWith("bot-");

/** How far a dash carries on open sand, roughly (logical px). */
const DASH_REACH = 300;

interface Mind {
  skill: number;
  /** Steps between looks. */
  react: number;
  wait: number;
  /** The stick it holds between looks. */
  sx: number;
  sy: number;
  target: string | null;
  /** Steps left of a sidestep. */
  dodge: number;
  /** When it last judged each rival's dash (dodge or not), so one dash is judged once. */
  seen: Map<string, number>;
  /** How keen it is to dash (0–1) and how far from the rope it keeps (px). */
  keen: number;
  margin: number;
}

const norm = (x: number, y: number): [number, number] => {
  const m = Math.hypot(x, y);
  return m > 1e-6 ? [x / m, y / m] : [0, 0];
};

export function createBots(game: Shove, rng: Rng = Math.random) {
  const minds = new Map<string, Mind>();

  /** The ring radius to plan with: where a pull is going, and a little less just before the next one. */
  const planR = () => {
    let R = game.pullT < PULL_STEPS ? Math.min(game.ringR, game.pullTo) : game.ringR;
    if (game.t > SHRINK_AFTER - 90) R -= game.baseR * SHRINK_BY * 0.5;
    return R;
  };

  const think = (s: Seat, m: Mind) => {
    const R = planR();
    const d = Math.hypot(s.x, s.y);
    const [ux, uy] = d > 1 ? [s.x / d, s.y / d] : [1, 0];
    // where it will be in about a third of a second if nothing changes
    const fx = s.x + s.vx * 0.3;
    const fy = s.y + s.vy * 0.3;
    const fd = Math.hypot(fx, fy);
    const outward = s.vx * ux + s.vy * uy;
    const rivals = game.inside().filter((o) => o.id !== s.id);

    // 1. the rope
    if (fd > R - m.margin || d > R - BODY_R * 0.9) {
      const [cx, cy] = norm(-fx, -fy);
      m.sx = cx;
      m.sy = cy;
      if (s.cool === 0 && d > R - BODY_R * 1.3 && outward > 120 && rng() < 0.25 + m.skill * 0.6) {
        game.setInput(s.id, cx, cy);
        game.dash(s.id);
      }
      return;
    }

    // 2. a dash coming at it
    for (const o of rivals) {
      if (o.dashT <= 0) continue;
      if (game.stepNo - (m.seen.get(o.id) ?? -1e9) < 30) continue;
      const rx = s.x - o.x;
      const ry = s.y - o.y;
      const wx = o.vx - s.vx;
      const wy = o.vy - s.vy;
      const w2 = wx * wx + wy * wy;
      if (w2 < 1) continue;
      const tc = (rx * wx + ry * wy) / w2;
      if (tc < 0 || tc > 0.45) continue;
      const miss = Math.hypot(rx - wx * tc, ry - wy * tc);
      if (miss > BODY_R * 2.3) continue;
      m.seen.set(o.id, game.stepNo);
      if (rng() < 0.2 + m.skill * 0.45) {
        // step aside, to the side nearer the middle
        let [px, py] = norm(-wy, wx);
        if (px * ux + py * uy > 0) [px, py] = [-px, -py];
        m.sx = px;
        m.sy = py;
        m.dodge = 14;
        return;
      }
      if (d > R - BRACE_BAND && m.skill > 0.4) {
        // can't get away: dig in
        m.sx = m.sy = 0;
        m.dodge = 12;
        return;
      }
    }

    if (!rivals.length) {
      m.sx = m.sy = 0;
      return;
    }

    // 3. pick a rival: near, and near the rope
    let best: Seat | null = null;
    let bestScore = Infinity;
    for (const o of rivals) {
      const od = Math.hypot(o.x, o.y);
      let score = Math.hypot(o.x - s.x, o.y - s.y) / R - (od / R) * 0.9;
      if (o.id === m.target) score -= 0.25;
      if (o.dashT > 0) score += 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = o;
      }
    }
    const o = best!;
    m.target = o.id;
    const od = Math.hypot(o.x, o.y);
    const tx = o.x - s.x;
    const ty = o.y - s.y;
    const dist = Math.hypot(tx, ty);
    // the rival's way out: from the middle through it (or away from the bot, if the rival is at the middle)
    const [ox, oy] = od > 30 ? [o.x / od, o.y / od] : norm(tx, ty);
    const [dx, dy] = norm(tx, ty);
    const lined = dx * ox + dy * oy;

    // 4. dash into it when it stands between the bot and the rope
    if (s.cool === 0 && dist > BODY_R * 2.5 && dist < 270 && rng() < m.keen) {
      const lead = dist / DASH_V;
      const [ax0, ay0] = norm(o.x + o.vx * lead - s.x, o.y + o.vy * lead - s.y);
      const wob = (rng() - 0.5) * 0.5 * (1 - m.skill);
      const ax = ax0 * Math.cos(wob) - ay0 * Math.sin(wob);
      const ay = ax0 * Math.sin(wob) + ay0 * Math.cos(wob);
      const good = lined > 0.55 || (od > R * 0.72 && lined > 0.15);
      // a miss would carry it this far: careful bots don't dash themselves out
      const mx = s.x + ax * DASH_REACH;
      const my = s.y + ay * DASH_REACH;
      const safe = Math.hypot(mx, my) < R * 0.98 || (lined > 0.85 && dist < 170) || rng() > 0.35 + m.skill * 0.6;
      if (good && safe) {
        game.setInput(s.id, ax, ay);
        game.dash(s.id);
        m.sx = ax;
        m.sy = ay;
        return;
      }
    }

    // 5. too close for a good dash: step back toward the middle for a run-up
    if (s.cool === 0 && dist < BODY_R * 2.6 && lined > 0.35 && rng() < m.keen) {
      const [bx, by] = norm(-dx - ux * 0.7, -dy - uy * 0.7);
      m.sx = bx;
      m.sy = by;
      m.dodge = 8 + Math.round(m.skill * 6);
      return;
    }
    // 6. get round to its middle side, then lean on it
    if (dist < BODY_R * 2.4 && lined > 0.35) {
      const [px, py] = norm(dx + ox * 0.6, dy + oy * 0.6);
      m.sx = px;
      m.sy = py;
      return;
    }
    const gap = BODY_R * 2 + 26;
    let ax = o.x - ox * gap;
    let ay = o.y - oy * gap;
    // going round the rival rather than through it: when it's in the way, aim to one side of it
    if (lined < 0.2) {
      const [sx, sy] = norm(-ty, tx);
      const side = sx * -ux + sy * -uy > 0 ? 1 : -1;
      ax += sx * side * BODY_R * 2.2;
      ay += sy * side * BODY_R * 2.2;
    }
    // don't plan a spot outside the ring
    const ad = Math.hypot(ax, ay);
    const lim = R - m.margin;
    if (ad > lim) {
      ax *= lim / ad;
      ay *= lim / ad;
    }
    const [sx, sy] = norm((ax - s.x) * 3 - s.vx * 0.9, (ay - s.y) * 3 - s.vy * 0.9);
    m.sx = sx;
    m.sy = sy;
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
        if (minds.has(id) || game.seats.has(id)) continue;
        if (!game.addSeat(id, BOT_NAMES[i]!, true)) break;
        const skill = 0.25 + rng() * 0.75;
        minds.set(id, {
          skill,
          react: 11 - Math.round(skill * 6),
          wait: 0,
          sx: 0,
          sy: 0,
          target: null,
          dodge: 0,
          seen: new Map(),
          keen: 0.35 + rng() * 0.4,
          margin: BODY_R * (0.8 + skill * 1.4),
        });
      }
    },

    /** Free a seat for a player who needs one, preferring a bot that is out or not playing. True if one stepped aside. */
    yieldOne(): boolean {
      const ids = [...minds.keys()];
      const id = ids.find((k) => !game.seats.get(k)?.alive) ?? ids.pop();
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
        for (const [id, m] of minds) {
          game.setInput(id, 0, 0);
          m.wait = Math.floor(rng() * 12);
          m.dodge = 0;
        }
        return;
      }
      for (const [id, m] of minds) {
        const s = game.seats.get(id);
        if (!s || !s.alive) continue;
        if (m.dodge > 0) m.dodge--;
        else if (--m.wait <= 0) {
          m.wait = m.react + Math.floor(rng() * 4);
          think(s, m);
        }
        game.setInput(id, m.sx, m.sy);
      }
    },
  };
}
