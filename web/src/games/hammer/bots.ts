// Computer players. They give input like a gamepad (at most 100 units per frame, Hammerfight's GAME_SENSITY_PAD),
// so they obey the same physics and limits as a person.

import { type Arena, type Machine, STEP, VIEW_H, VIEW_W } from "./sim.ts";

export type BotMode = "idle" | "wander" | "fight";

export interface Bot {
  mode: BotMode;
  theta: number;
  spin: number;
  homeX: number;
  homeY: number;
  nextFlip: number;
}

const PAD_MAX = 100;

export function makeBot(mode: BotMode, x: number, y: number): Bot {
  return { mode, theta: Math.random() * Math.PI * 2, spin: Math.random() < 0.5 ? -1 : 1, homeX: x, homeY: y, nextFlip: 2 + Math.random() * 3 };
}

/** Steer toward (x, y) at up to `speed` px/s, by giving the input that would change the velocity that much. */
function seek(arena: Arena, m: Machine, x: number, y: number, speed: number): void {
  const h = m.hull;
  let dx = x - h.x;
  let dy = y - h.y;
  const d = Math.hypot(dx, dy);
  const want = Math.min(speed, d * 4);
  if (d > 0) {
    dx = (dx / d) * want;
    dy = (dy / d) * want;
  }
  // Δv = F/m·dt with F = input · thrust · 0.6 → input = Δv · m / (thrust · 0.6 · dt)
  const k = h.mass / (arena.tuning.thrust * 0.6 * STEP);
  let ix = (dx - h.vx) * k;
  let iy = (dy - h.vy) * k;
  const il = Math.hypot(ix, iy);
  if (il > PAD_MAX) {
    ix *= PAD_MAX / il;
    iy *= PAD_MAX / il;
  }
  arena.pushRaw(m, ix, iy);
}

export function driveBot(arena: Arena, m: Machine, bot: Bot): void {
  if (!m.alive) return;
  const dt = STEP;

  if (bot.mode === "idle") {
    seek(arena, m, bot.homeX, bot.homeY + Math.sin(arena.t * 1.3 + m.id) * 6, 120);
    return;
  }
  if (bot.mode === "wander") {
    bot.theta += dt * 0.6 * bot.spin;
    seek(arena, m, bot.homeX + Math.cos(bot.theta) * 140, bot.homeY + Math.sin(bot.theta * 1.7) * 70, 250);
    return;
  }

  // fight: circle the nearest enemy so the weapon whips round into it
  let enemy: Machine | null = null;
  let best = Infinity;
  for (const o of arena.machines) {
    if (o === m || !o.alive) continue;
    const d = Math.hypot(o.hull.x - m.hull.x, o.hull.y - m.hull.y);
    if (d < best) {
      best = d;
      enemy = o;
    }
  }
  if (!enemy) {
    seek(arena, m, bot.homeX, bot.homeY, 200);
    return;
  }
  bot.nextFlip -= dt;
  if (bot.nextFlip <= 0) {
    bot.spin = -bot.spin;
    bot.nextFlip = 2 + Math.random() * 4;
  }
  bot.theta += dt * 3.2 * bot.spin;
  const r = 90;
  const x = Math.min(VIEW_W - 30, Math.max(30, enemy.hull.x + Math.cos(bot.theta) * r));
  const y = Math.min(VIEW_H - 30, Math.max(30, enemy.hull.y + Math.sin(bot.theta) * r));
  seek(arena, m, x, y, 350);
}
