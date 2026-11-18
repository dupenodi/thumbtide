// Computer pilots: careful ones. Every few steps each bot reads the rocket and the next row of hazards above it and
// works out what the crew needs: a tilt that carries the rocket along the row's safe lane (the generator keeps it
// free of every hazard at all times), and a climb rate (slow down below a lane it is not lined up with, hurry when
// the drop line comes close). It then fires its own thruster if that helps:
// lift for everyone, plus turning for the side the rocket must tip towards. A bot holds when the rocket tilts away
// from its side and when the rocket sinks below the wanted climb. Each bot has its own reaction time and threshold,
// so a crew of bots fires a few thrusters at a time, and can be out-flown.
import { BASE, MAX_SEATS, PAD_Y, type Liftoff, type Rng, type Thruster } from "./rules.ts";

export const BOT_NAMES = ["Gemini", "Vostok", "Mercury", "Soyuz", "Apollo", "Ariane", "Atlas", "Juno"];
export const isBot = (id: string) => id.startsWith("bot-");

interface Mind {
  /** Steps until it looks again, and its usual reaction (steps). */
  wait: number;
  react: number;
  /** Fires when its need is above this. */
  thr: number;
  /** How hard it weighs turning against lift. */
  turn: number;
  /** Last decision per thruster key. */
  fire: { l: boolean; r: boolean };
  /** Lapses of attention: steps left in the current one (it keeps its last input) and steps until the next. */
  lapse: number;
  next: number;
  /** Where this bot misjudges the lane by (m): a slow random walk, wider higher up. */
  bias: number;
  /** Mean time between lapses (steps). */
  every: number;
}

/** Bots lose the thread now and then, so a long run is never certain; the crew is careful, not perfect. */
export const LAPSE_EVERY = 26 * 60;
/** The most a bot misjudges the lane by (m), and how fast that drifts. */
export const BIAS_MAX = 2.3;
export const BIAS_STEP = 1.45;

/** Top of the hull above its centre, m. */
const NOSE = 2.5;
const HALF_HULL = 1.4;

export interface CrewPlan {
  /** Positive: the crew should tip the nose to the right (left thrusters fire). */
  torque: number;
  /** 0–1: the share of thrusters the crew should fire for the wanted climb. */
  lift: number;
}

/** What the crew should do now. Shared by every bot (each reads it at its own moments). */
export function crewPlan(game: Liftoff, bias = 0): CrewPlan {
  const r = game.rocket;
  // the lane of the row the rocket still has to get through (its tail may be in it)
  const row = game.course.rowAhead(r.y);
  const tx = row ? row.c : game.course.laneAt(r.y);
  const half = row ? row.gw / 2 : 4;
  const dy = row ? row.y0 - (r.y + NOSE) : 99;
  const ex = tx + bias - r.x;
  // the tilt that carries the rocket over the opening, and the turning that brings it there
  const aim = Math.max(-0.38, Math.min(0.38, 0.2 * ex - 0.3 * r.vx));
  const torque = 6 * (aim - r.a) - 1.6 * r.w;
  // climb: cruise; ease off below a gap it is not lined up with; hurry when the drop line is close
  const lvl = game.level;
  let climb = 6.2 + 2 * lvl;
  // lined up: well inside the lane's free width (the generator leaves at least 20 % of the rocket's width each side)
  const lined = Math.abs(ex) < Math.max(0.3, (half - HALF_HULL) * 0.55) && Math.abs(r.vx) < 1.6;
  if (dy < -0.5) climb = Math.max(climb, 4); // nose already in the row: keep going, a moving hazard punishes hovering
  else if (!lined && dy < 11) climb = Math.min(climb, Math.max(-1, (dy - 3.5) * 0.7));
  const room = r.y - PAD_Y + 0.4 - game.floor;
  if (room < 6) climb = Math.max(climb, 6 - room + 2);
  const lift = 0.48 / Math.max(0.6, Math.cos(r.a)) + 0.09 * (climb - r.vy);
  return { torque, lift };
}

/** With `errors` off the bots are flawless pilots of the lane (used to prove the course can be flown). */
export function createBots(game: Liftoff, rng: Rng = Math.random, errors = true) {
  const minds = new Map<string, Mind>();

  const want = (m: Mind, plan: CrewPlan, th: Thruster): boolean => {
    // -d: a thruster left of the middle tips the nose right
    const side = -th.d / (BASE / 2);
    const need = plan.lift + plan.torque * side * m.turn;
    return need > m.thr;
  };

  return {
    /** Add or remove bots to reach `n`. Bots only take free seats. */
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
        if (!this.add(id, i)) break;
      }
    },

    /** Seats one bot (the first free bot id). Returns its id, or null when the rocket is full. */
    addOne(): string | null {
      for (let i = 0; i < MAX_SEATS; i++) {
        const id = `bot-${i}`;
        if (minds.has(id)) continue;
        return this.add(id, i) ? id : null;
      }
      return null;
    },

    add(id: string, i: number): boolean {
      if (!game.addSeat(id, BOT_NAMES[i]!, true)) return false;
      const skill = rng();
      minds.set(id, {
        wait: 0,
        react: 7 - Math.round(skill * 3),
        thr: 0.5 + (rng() - 0.5) * 0.24,
        turn: 0.55 + skill * 0.2,
        fire: { l: false, r: false },
        lapse: 0,
        next: 0,
        bias: 0,
        every: LAPSE_EVERY * (0.7 + skill * 0.6),
      });
      const m = minds.get(id)!;
      m.next = Math.ceil(-Math.log(1 - rng()) * m.every);
      return true;
    },

    /** A bot steps aside for a player. With `flying`, only a bot that holds a thruster (the player takes it over). */
    yield(flying = false): string | null {
      const ids = [...minds.keys()].reverse();
      const id = flying ? ids.find((b) => game.flying(b)) : ids[0];
      if (!id) return null;
      minds.delete(id);
      return id;
    },

    remove(id: string) {
      minds.delete(id);
      game.removeSeat(id);
    },

    has: (id: string) => minds.has(id),

    get count() {
      return minds.size;
    },

    step() {
      if (game.phase !== "fly") {
        for (const id of minds.keys()) game.setInput(id, false, false);
        return;
      }
      for (const [id, m] of minds) {
        if (!errors) m.bias = 0;
        if (errors && m.lapse > 0) {
          m.lapse--;
          continue;
        }
        if (errors && --m.next <= 0) {
          m.lapse = 18 + Math.floor(rng() * 40);
          m.next = Math.ceil(-Math.log(1 - rng()) * m.every);
          continue;
        }
        if (--m.wait > 0) continue;
        m.wait = m.react + Math.floor(rng() * 3);
        // the errors of several bots average out, so each of a big crew errs more
        const sc = Math.max(1, 0.95 * Math.sqrt(minds.size));
        if (errors) m.bias = Math.max(-BIAS_MAX * sc, Math.min(BIAS_MAX * sc, m.bias * 0.97 + (rng() - 0.5) * BIAS_STEP * sc * (0.8 + game.level)));
        const plan = crewPlan(game, m.bias);
        m.fire.l = m.fire.r = false;
        for (const th of game.thrustersOf(id)) {
          const on = want(m, plan, th);
          if (th.key === "r") m.fire.r = on;
          else if (th.key === "l") m.fire.l = on;
          else m.fire.l = m.fire.r = on;
        }
        game.setInput(id, m.fire.l, m.fire.r);
      }
    },
  };
}
