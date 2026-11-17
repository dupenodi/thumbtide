// Computer fighters. A few times a second each bot looks at the platform and picks what to do, in this order:
//  - a live bomb near it: hop it at the right moment (a hop dodges the ground shock) or run to a safe spot away from it;
//  - the edge: when it, or where it slides to, is near the drop, steer back (hop a gap it is knocked over);
//  - a gap in the way to its target: hop it;
//  - a rival (the nearest, near the edge counts double): keep a throwing distance, throw a bomb ahead of it, and punch
//    it when it stands close and the punch sends it toward the drop;
//  - nobody near: pick up a power-up, or blow a crate open.
// Each bot has its own skill (reaction time, aim, dodge chance), so they can be beaten.
import { BLAST_BIG, BLAST_R, BOMB_DRAG, BOMB_V, MAX_SEATS, PR, PUNCH_REACH, SLIDE_DRAG, type Rng, type Seat, type Blast } from "./rules.ts";

export const BOT_NAMES = ["Pip", "Waffle", "Bumble", "Nugget", "Pebble", "Doodle", "Mochi", "Biscuit"];
export const isBot = (id: string) => id.startsWith("bot-");

interface Mind {
  skill: number;
  /** Steps between looks. */
  react: number;
  wait: number;
  /** The stick it holds between looks. */
  sx: number;
  sy: number;
  /** Steps the stick is kept as it is (during a hop). */
  hold: number;
  /** How far from the drop it keeps (px), how keen it is to throw (0–1), and its chance to dodge a blast. */
  margin: number;
  keen: number;
  dodgeP: number;
  /** Sidestep direction when it keeps its distance. */
  orbit: number;
  /** Bombs it already decided about (a hop or a run), by id. */
  seen: Set<number>;
}

const norm = (x: number, y: number): [number, number] => {
  const m = Math.hypot(x, y);
  return m > 1e-6 ? [x / m, y / m] : [0, 0];
};
const DIRS = Array.from({ length: 12 }, (_, i) => [Math.cos((i / 12) * Math.PI * 2), Math.sin((i / 12) * Math.PI * 2)] as const);

export function createBots(game: Blast, rng: Rng = Math.random) {
  const minds = new Map<string, Mind>();

  /** The platform's size to plan with: the next one when a crumble is about to happen. */
  const planScale = () => {
    const n = game.nextScale();
    return n > 0 && game.crumbleIn() < 150 ? n : game.floorScale;
  };
  const safeAt = (x: number, y: number) => game.groundAt(x, y, planScale());

  /** A push away from the drop (zero when the ground all round is safe). */
  const edgePush = (x: number, y: number, margin: number): [number, number, number] => {
    let ex = 0;
    let ey = 0;
    let n = 0;
    for (const [dx, dy] of DIRS) {
      if (!safeAt(x + dx * margin, y + dy * margin)) {
        ex -= dx;
        ey -= dy;
        n++;
      }
    }
    const [ux, uy] = norm(ex, ey);
    return [ux, uy, n / DIRS.length];
  };

  const foes = (s: Seat) => game.inside().filter((o) => o.id !== s.id && (!game.team || o.team !== s.team));

  const think = (s: Seat, m: Mind) => {
    const canHop = s.jumpT === 0 && s.jumpRest === 0;
    const sp = Math.hypot(s.vx, s.vy);

    // 1. a bomb that will go off near it
    let flee: [number, number] | null = null;
    for (const b of game.bombs) {
      if (b.falling) continue;
      const R = (b.kind === "big" ? BLAST_BIG : BLAST_R) + 34;
      const d = Math.hypot(b.x - s.x, b.y - s.y);
      if (d > R + 40 || game.blocked(b.x, b.y, s.x, s.y)) continue;
      const left = b.fuse;
      if (d < R && left <= 26 && left >= 5 && canHop && !m.seen.has(b.id)) {
        m.seen.add(b.id);
        if (rng() < m.dodgeP) {
          game.jump(s.id);
          m.hold = 30;
          const [fx, fy] = flee ?? norm(s.x - b.x, s.y - b.y);
          m.sx = fx;
          m.sy = fy;
          return;
        }
      }
      if (left > 0 && (d < R || (d < R + 40 && left < 40))) {
        // run to the safest of twelve spots: far from the bomb, on solid ground
        let best = -1e9;
        for (const [dx, dy] of DIRS) {
          const tx = s.x + dx * 100;
          const ty = s.y + dy * 100;
          let sc = Math.hypot(tx - b.x, ty - b.y);
          if (!safeAt(tx, ty) || !safeAt(s.x + dx * 50, s.y + dy * 50)) sc -= 1000;
          else if (!safeAt(s.x + dx * (m.margin + 30), s.y + dy * (m.margin + 30))) sc -= 40;
          if (game.crates.some((c) => Math.abs(c.x - (s.x + dx * 40)) < c.w / 2 + PR && Math.abs(c.y - (s.y + dy * 40)) < c.h / 2 + PR)) sc -= 60;
          if (sc > best) {
            best = sc;
            flee = [dx, dy];
          }
        }
      }
    }
    if (flee) {
      m.sx = flee[0];
      m.sy = flee[1];
      return;
    }

    // 2. sliding toward the drop after a knock: hop a gap, or steer back
    if (s.knock > 0 && sp > 160) {
      const [ux, uy] = norm(s.vx, s.vy);
      const reach = (sp / SLIDE_DRAG) * 0.8;
      if (!safeAt(s.x + ux * reach, s.y + uy * reach)) {
        const air = sp * 0.5;
        if (canHop && safeAt(s.x + ux * Math.min(air * 0.9, reach + 40), s.y + uy * Math.min(air * 0.9, reach + 40)) && rng() < 0.4 + m.skill * 0.6) {
          game.jump(s.id);
          m.hold = 30;
          m.sx = ux;
          m.sy = uy;
          return;
        }
        const [cx, cy] = norm(-s.x, -s.y);
        m.sx = cx;
        m.sy = cy;
        return;
      }
    }
    const [ex, ey, edge] = edgePush(s.x, s.y, m.margin);
    const [fx, fy] = edgePush(s.x + s.vx * 0.35, s.y + s.vy * 0.35, m.margin * 0.8);
    const danger = Math.max(edge, fx || fy ? 0.5 : 0);

    // 3. pick what to go for
    const rivals = foes(s);
    let target: Seat | null = null;
    let best = 1e9;
    for (const o of rivals) {
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      const [, , e] = edgePush(o.x, o.y, 75);
      const sc = d - e * 220;
      if (sc < best) {
        best = sc;
        target = o;
      }
    }
    let dx = 0;
    let dy = 0;
    let lootGo = false;
    if (!target || Math.hypot(target.x - s.x, target.y - s.y) > 340) {
      // power-ups first, then crates
      const loot = game.pickups.slice().sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
      if (loot && Math.hypot(loot.x - s.x, loot.y - s.y) < 460 && safeAt(loot.x, loot.y)) {
        [dx, dy] = norm(loot.x - s.x, loot.y - s.y);
        lootGo = true;
      }
    }
    if (target && !lootGo) {
      const tx = target.x - s.x;
      const ty = target.y - s.y;
      const dist = Math.hypot(tx, ty);
      const lead = Math.min(0.6, dist / BOMB_V) * 0.55;
      const ax = target.x + target.vx * lead;
      const ay = target.y + target.vy * lead;
      const err = (1 - m.skill) * 0.3;
      const ang = Math.atan2(ay - s.y, ax - s.x) + (rng() - 0.5) * err * 2;
      const clear = !game.blocked(s.x, s.y, ax, ay);
      const roll = (BOMB_V - 140) / BOMB_DRAG;

      // punch: close, and it would fly toward the drop (or just now and then)
      if (dist < PUNCH_REACH + 4 && s.punchCool === 0) {
        const [nx, ny] = norm(tx, ty);
        const out = !safeAt(target.x + nx * 130, target.y + ny * 130);
        if (out || rng() < 0.18 * m.skill) {
          game.punch(s.id, Math.atan2(ty, tx));
          return;
        }
      }
      // throw: from a distance that doesn't catch itself, with a clear line (or at a crate in the way, now and then)
      if (s.bombCool === 0 && dist > 100 && dist < roll + 60 && rng() < m.keen) {
        if (clear || rng() < 0.15) {
          if (game.throwBomb(s.id, ang)) {
            // step aside after the throw
            m.orbit = rng() < 0.5 ? -1 : 1;
          }
        }
      }
      // where to stand: a throwing distance away, sidestepping; close in to punch a rival near the drop
      const want = s.bombCool === 0 ? 190 : 150;
      let k = 0;
      if (dist > want + 40) k = 1;
      else if (dist < 105) k = -1;
      const [nx, ny] = norm(tx, ty);
      const [ox, oy] = [-ny * m.orbit, nx * m.orbit];
      [dx, dy] = norm(nx * k + ox * 0.55, ny * k + oy * 0.55);
      const [, , te] = edgePush(target.x, target.y, 75);
      if (te > 0.2 && s.punchCool === 0 && dist < 240) [dx, dy] = norm(nx + ox * 0.2, ny + oy * 0.2);
      // a gap between us: hop it
      if (k > 0 && canHop && safeAt(s.x, s.y) && !safeAt(s.x + dx * 48, s.y + dy * 48) && safeAt(s.x + dx * 118, s.y + dy * 118) && rng() < 0.4 + m.skill * 0.5) {
        game.jump(s.id);
        m.hold = 30;
        m.sx = dx;
        m.sy = dy;
        return;
      }
    } else if (!lootGo) {
      // nobody left, or only a crate: hold the middle, and open the nearest crate now and then
      [dx, dy] = norm(-s.x * 0.01, -s.y * 0.01);
      const c = game.crates.slice().sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y))[0];
      if (c && !rivals.length && s.bombCool === 0 && Math.hypot(c.x - s.x, c.y - s.y) > 130 && Math.hypot(c.x - s.x, c.y - s.y) < 300 && rng() < 0.3) {
        game.throwBomb(s.id, Math.atan2(c.y - s.y, c.x - s.x));
      }
    }

    // 4. the edge wins over wanting: blend the push away from the drop in strongly
    if (danger > 0) {
      const w = 1.2 + danger * 2.4;
      const [mx, my] = norm(-s.x, -s.y);
      [dx, dy] = norm(dx + ex * w + fx * w + mx * 0.3, dy + ey * w + fy * w + my * 0.3);
    }
    // late in the round the platform is small: keep to the middle
    if (game.stage > 0) {
      const [mx, my] = norm(-s.x, -s.y);
      const d = Math.hypot(s.x, s.y);
      if (d > 150 * game.floorScale + 60) [dx, dy] = norm(dx + mx * 1.5, dy + my * 1.5);
    }
    m.sx = dx;
    m.sy = dy;
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
        const skill = 0.3 + rng() * 0.7;
        minds.set(id, {
          skill,
          react: 9 - Math.round(skill * 4),
          wait: 0,
          sx: 0,
          sy: 0,
          hold: 0,
          margin: PR * (1.5 + skill * 1.2),
          keen: 0.25 + skill * 0.4,
          dodgeP: 0.3 + skill * 0.6,
          orbit: rng() < 0.5 ? -1 : 1,
          seen: new Set(),
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
          m.hold = 0;
          m.seen.clear();
        }
        return;
      }
      for (const [id, m] of minds) {
        const s = game.seats.get(id);
        if (!s || !s.alive) continue;
        if (m.hold > 0) m.hold--;
        else if (--m.wait <= 0) {
          m.wait = m.react + Math.floor(rng() * 4);
          think(s, m);
        }
        game.setInput(id, m.sx, m.sy);
      }
    },
  };
}
