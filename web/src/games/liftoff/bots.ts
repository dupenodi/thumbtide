// Computer pilots: careful ones. Every few steps each bot reads the rocket and the next gate above it and works out
// what the crew needs: a tilt that carries the rocket over the next opening, and a climb rate (slow down below a
// gap it is not lined up with, hurry when the drop line comes close). It then fires its own thruster if that helps:
// lift for everyone, plus turning for the side the rocket must tip towards. A bot holds when the rocket tilts away
// from its side and when the rocket sinks below the wanted climb. Each bot has its own reaction time and threshold,
// so a crew of bots fires a few thrusters at a time, and can be out-flown.
import { gateOpenings } from "./course.ts";
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
}

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
export function crewPlan(game: Liftoff): CrewPlan {
  const r = game.rocket;
  const t = game.time;
  const gates = game.course.gates;
  let gate = gates.find((g) => g.y1 > r.y - 1.6);
  let tx = 0;
  let half = 4;
  let dy = 99;
  if (gate) {
    dy = gate.y0 - (r.y + NOSE);
    const arrive = Math.max(0, Math.min(2.2, dy / Math.max(1.5, r.vy)));
    const xs = r.x + r.vx * Math.min(arrive, 1);
    const opens = gateOpenings(gate, t + arrive);
    let best = opens[0]!;
    for (const o of opens) if (Math.abs(o.cx - xs) < Math.abs(best.cx - xs)) best = o;
    tx = best.cx;
    half = best.half;
  } else gate = undefined;
  const ex = tx - r.x;
  // the tilt that carries the rocket over the opening, and the turning that brings it there
  const aim = Math.max(-0.38, Math.min(0.38, 0.16 * ex - 0.24 * r.vx));
  const torque = 6 * (aim - r.a) - 1.6 * r.w;
  // climb: cruise; ease off below a gap it is not lined up with; hurry when the drop line is close
  const lvl = game.level;
  let climb = 5.2 + 2.2 * lvl;
  const lined = Math.abs(ex) < half - HALF_HULL - 0.15 && Math.abs(r.vx) < 2.5;
  if (!lined && dy < 9) climb = Math.min(climb, Math.max(-1.5, (dy - 2.5) * 0.7));
  if (gate?.kind === "chimney" && r.y + NOSE > gate.y0) climb = Math.min(climb, 4);
  const room = r.y - PAD_Y + 0.4 - game.floor;
  if (room < 6) climb = Math.max(climb, 6 - room + 2);
  const lift = 0.48 / Math.max(0.6, Math.cos(r.a)) + 0.09 * (climb - r.vy);
  return { torque, lift };
}

export function createBots(game: Liftoff, rng: Rng = Math.random) {
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
      });
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
      let plan: CrewPlan | null = null;
      for (const [id, m] of minds) {
        if (--m.wait > 0) continue;
        m.wait = m.react + Math.floor(rng() * 3);
        plan ??= crewPlan(game);
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
