// Computer fighters. A few times a second each bot looks at the deck and picks what to do, in this order:
//  - a bomb about to go off near it: run away from it (a sticky bomb on its own back: run at a rival instead);
//  - a rival it carries: walk to the nearest edge and throw them off;
//  - a lit bomb in its hands: keep a throwing distance, let the fuse burn down, throw it ahead of the rival's run;
//  - a knocked-out rival next to it: pick them up;
//  - a power-up box nearer than any trouble: fetch it;
//  - else: light a bomb when the rival is at throwing range (Ballistica's spazbot.py: 5–9 m), or charge and punch
//    (a punch hurts by how fast the puncher runs, so bots charge in).
// The stick never points over the drop. Each bot has its own reaction time and aim, so they can be beaten.
import { ARENA, GRAVITY, HEIGHT, MAX_SEATS, PUNCH_REACH, RUN, Game, groundAt, type Bomb, type Fighter, type Rng } from "./rules.ts";

export const BOT_NAMES = ["Pickle", "Wobble", "Turnip", "Fizz", "Noodle", "Gizmo", "Sprout", "Tater"];
export const isBot = (id: string) => id.startsWith("bot-");

interface Mind {
  /** Steps between looks, and steps until the next one. */
  react: number;
  wait: number;
  sx: number;
  sz: number;
  /** Aim error (m), keenness to throw (spazbot.py throwiness 0.7) and to punch (punchiness 0.5). */
  aim: number;
  throwy: number;
  punchy: number;
  orbit: number;
  /** Steps it has pushed the stick without moving (a block in the way: hop it). */
  stuck: number;
  /** Fuse left at which it lets a bomb go (so it bursts soon after it lands). */
  cook: number;
  /** Its chance to notice a bomb in time, and the bombs it already made up its mind about (id → runs from it). */
  dodge: number;
  seen: Map<number, boolean>;
  /** Its chance to go for a pick-up when a rival is down. */
  grabby: number;
  lift: boolean;
  /** Looks left of backing off. */
  back: number;
}

/** How far a throw with the stick at `scale` lands, and how long it flies. */
export function throwRange(scale: number): [number, number] {
  const [vh, vv] = Game.throwSpeed(scale);
  const t = (vv + Math.sqrt(vv * vv + 2 * GRAVITY * (HEIGHT + 0.3))) / GRAVITY;
  return [vh * t, t];
}
const [RANGE_MIN] = throwRange(0.12);
const [RANGE_MAX] = throwRange(1);

export function createBots(game: Game, rng: Rng = Math.random) {
  const minds = new Map<string, Mind>();
  const mind = (id: string) => {
    let m = minds.get(id);
    if (!m) {
      m = { react: 7 + Math.floor(rng() * 8), wait: Math.floor(rng() * 10), sx: 0, sz: 0, aim: 0.3 + rng() * 0.9, throwy: 0.5 + rng() * 0.4, punchy: 0.3 + rng() * 0.4, orbit: rng() < 0.5 ? -1 : 1, stuck: 0, cook: 1.2, lift: false, back: 0, dodge: 0.25 + rng() * 0.35, grabby: 0.25 + rng() * 0.4, seen: new Map() };
      minds.set(id, m);
    }
    return m;
  };
  const bots = () => [...game.seats.values()].filter((s) => s.bot);

  const onDeck = (x: number, z: number, margin = 0.35) => Math.abs(x) < ARENA.hx - margin && Math.abs(z) < ARENA.hz - margin;

  /** Turn a wish into a stick that keeps it on the deck: the nearest direction whose way ahead is solid. */
  const safe = (f: Fighter, wx: number, wz: number): [number, number] => {
    const m = Math.hypot(wx, wz);
    if (m < 0.05) {
      // standing near the rim: step in
      return onDeck(f.x, f.z, 0.9) ? [0, 0] : norm(-f.x, -f.z);
    }
    if (groundAt(f.x, f.z) === null) return norm(clampTo(f.x, ARENA.hx - 1) - f.x, clampTo(f.z, ARENA.hz - 1) - f.z);
    const a0 = Math.atan2(wx, wz);
    const look = 0.9 + Math.hypot(f.vx, f.vz) * 0.22;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.4, -2.4, Math.PI]) {
      const dx = Math.sin(a0 + da);
      const dz = Math.cos(a0 + da);
      if (onDeck(f.x + dx * look, f.z + dz * look) && onDeck(f.x + dx * look * 0.5, f.z + dz * look * 0.5)) return [dx * Math.min(1, m), dz * Math.min(1, m)];
    }
    return norm(-f.x, -f.z);
  };

  const rivals = (f: Fighter) => [...game.seats.values()].filter((o) => o !== f && o.inRound && o.alive && !o.gone);
  const nearest = (f: Fighter, list: Fighter[]) => {
    let best: Fighter | null = null;
    let bd = 1e9;
    for (const o of list) {
      const d = Math.hypot(o.x - f.x, o.z - f.z) - (o.knockout > 0 ? 1.5 : 0) + (o.heldBy ? 6 : 0);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };

  /** The bomb to run from, if any. */
  const threat = (f: Fighter, m: Mind): Bomb | null => {
    if (m.seen.size > 40) m.seen.clear();
    let worst: Bomb | null = null;
    let wd = 1e9;
    for (const b of game.bombs) {
      if (b.heldBy === f.id) continue;
      if (b.kind === "tnt" && b.fuse > 1) continue;
      if (b.kind === "impact" ? b.heldBy !== null : b.fuse > 0.9) continue;
      const d = Math.hypot(b.x - f.x, b.z - f.z);
      if (d >= b.radius + 0.7) continue;
      // it notices this bomb, or it does not: decided once
      let runs = m.seen.get(b.id);
      if (runs === undefined) m.seen.set(b.id, (runs = b.owner === f.id || b.stuck === f.id || rng() < m.dodge));
      if (runs && d < wd) {
        wd = d;
        worst = b;
      }
    }
    return worst;
  };

  function think(f: Fighter, m: Mind) {
    if (!game.ready(f)) {
      // in the air after a knock: steer back over the deck
      [m.sx, m.sz] = f.alive && !f.heldBy ? safe(f, -f.x * 0.2, -f.z * 0.2) : [0, 0];
      return;
    }
    const all = rivals(f);
    const foe = nearest(f, all);
    const go = (wx: number, wz: number) => {
      [m.sx, m.sz] = safe(f, wx, wz);
    };
    const held = f.holdBomb ? game.bombs.find((b) => b.id === f.holdBomb) ?? null : null;

    // ---- a bomb about to go off
    const danger = threat(f, m);
    if (danger) {
      const mine = danger.stuck === f.id;
      if (mine && foe) go(foe.x - f.x, foe.z - f.z);
      else {
        let ax = f.x - danger.x;
        let az = f.z - danger.z;
        if (Math.hypot(ax, az) < 0.2) [ax, az] = [Math.sin(f.yaw + 2), Math.cos(f.yaw + 2)];
        go(...norm(ax, az));
      }
      if (held && held.fuse < 1.3 && foe) throwAt(f, m, foe, held);
      return;
    }

    // ---- carrying a rival: to the nearest edge, and over it
    if (f.holdFighter) {
      const ex = ARENA.hx - Math.abs(f.x);
      const ez = ARENA.hz - Math.abs(f.z);
      const ox = ex < ez ? Math.sign(f.x) || 1 : 0;
      const oz = ex < ez ? 0 : Math.sign(f.z) || 1;
      if (Math.min(ex, ez) < 1.8 || f.holdT > 1.6) {
        game.setInput(f.id, ox, oz);
        game.grab(f.id);
        m.sx = m.sz = 0;
      } else {
        m.sx = ox;
        m.sz = oz;
      }
      return;
    }

    // ---- a lit bomb in the hands
    if (held) {
      if (!foe) {
        if (held.fuse < 1.6 || held.kind === "tnt") throwAway(f);
        return;
      }
      const d = Math.hypot(foe.x - f.x, foe.z - f.z);
      const [, t] = throwRange(clamp01((d - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)));
      const ready = held.kind === "normal" ? held.fuse <= t + m.cook || d < 2.6 : f.holdT > 0.35;
      if ((ready && d < RANGE_MAX + 1.5) || held.fuse < 1.25) {
        throwAt(f, m, foe, held);
        return;
      }
      // keep a throwing distance, sidestepping
      const [tx, tz] = norm(foe.x - f.x, foe.z - f.z);
      const want = d > 6.5 ? 1 : d < 3.8 ? -1 : 0;
      go(tx * want - tz * m.orbit * 0.6, tz * want + tx * m.orbit * 0.6);
      return;
    }

    if (!foe) {
      go(0, 0);
      return;
    }
    const dx = foe.x - f.x;
    const dz = foe.z - f.z;
    const d = Math.hypot(dx, dz);

    // ---- a knocked-out rival next to it: lift them
    if (foe.knockout <= 0) m.lift = rng() < m.grabby; // made up before the rival goes down
    if (m.lift && foe.knockout > 3 && !foe.heldBy && foe.invincible <= 0 && d < 3 && Math.abs(foe.y - f.y) < 1) {
      go(dx / d, dz / d);
      if (d < 1.05) game.grab(f.id);
      return;
    }

    // ---- a power-up box
    let box = null as null | { x: number; z: number };
    let bd = Math.min(7, d + 2.5);
    for (const b of game.boxes) {
      const dd = Math.hypot(b.x - f.x, b.z - f.z);
      if (dd < bd && onDeck(b.x, b.z, 0.2)) {
        bd = dd;
        box = b;
      }
    }
    if (box && d > 2.2) {
      go(box.x - f.x, box.z - f.z);
      hop(f, m);
      return;
    }

    // ---- fight: a bomb from a distance, fists up close
    if (d > 3.6 && d < 10 && game.bombsLeft(f) > 0 && rng() < m.throwy * 0.35) {
      game.bomb(f.id);
      m.cook = 0.3 + rng() * 0.9; // the fuse left when the bomb lands
      return;
    }
    // a punch needs a run-up: after one lands it backs off a few steps, then charges again
    if (m.back > 0) {
      m.back--;
      go(-dx / d - (dz / d) * m.orbit * 0.7, -dz / d + (dx / d) * m.orbit * 0.7);
      return;
    }
    // run at where they will be
    const lead = Math.min(0.4, d / (RUN * 2));
    go(dx + foe.vx * lead, dz + foe.vz * lead);
    if (d < PUNCH_REACH + 0.25 && Math.abs(foe.y - f.y) < 1.2) {
      let da = Math.atan2(dx, dz) - f.yaw;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) < 0.6 && rng() < m.punchy) {
        game.punch(f.id);
        if (f.momentum < 3 || rng() < 0.5) m.back = 2 + Math.floor(rng() * 4);
        if (rng() < 0.3) m.orbit = -m.orbit;
      }
    }
    hop(f, m);
  }

  /** Pushing the stick but not moving: a block is in the way, so hop onto it. */
  function hop(f: Fighter, m: Mind) {
    if (Math.hypot(m.sx, m.sz) > 0.5 && Math.hypot(f.vx, f.vz) < 1.2 && f.grounded) {
      if (++m.stuck >= 2) {
        game.jump(f.id);
        m.stuck = 0;
      }
    } else m.stuck = 0;
  }

  /** Throw the bomb to land where the rival will be. */
  function throwAt(f: Fighter, m: Mind, foe: Fighter, b: Bomb) {
    let scale = 0.5;
    let ax = foe.x;
    let az = foe.z;
    // two rounds: the flight time depends on the distance, the lead on the flight time
    for (let k = 0; k < 2; k++) {
      const d = Math.hypot(ax - f.x, az - f.z);
      scale = clamp01((d - 1.3 - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)); // it rolls on a little
      const [, t] = throwRange(scale);
      const lead = foe.knockout > 0 || !foe.grounded ? 0 : Math.min(t + (b.kind === "normal" ? m.cook * 0.5 : 0), 1.1);
      ax = clampTo(foe.x + foe.vx * lead, ARENA.hx - 0.5) + (rng() - 0.5) * m.aim * 2;
      az = clampTo(foe.z + foe.vz * lead, ARENA.hz - 0.5) + (rng() - 0.5) * m.aim * 2;
    }
    const [dx, dz] = norm(ax - f.x, az - f.z);
    const s = Math.max(0.12, scale);
    game.setInput(f.id, dx * s, dz * s);
    game.bomb(f.id);
    // then get clear of its own bomb
    [m.sx, m.sz] = safe(f, -dx, -dz);
  }

  function throwAway(f: Fighter) {
    const [dx, dz] = norm(-f.x || 1, -f.z);
    game.setInput(f.id, -dx, -dz);
    game.bomb(f.id);
  }

  return {
    get count() {
      return bots().length;
    },
    setCount(n: number) {
      n = Math.max(0, Math.min(MAX_SEATS, n));
      let list = bots();
      // extras leave: the ones not in the round first
      while (list.length > n) {
        const out = list.find((b) => !b.inRound) ?? list[list.length - 1]!;
        game.removeSeat(out.id);
        minds.delete(out.id);
        list = bots();
      }
      for (let i = 1; list.length < n && i <= MAX_SEATS; i++) {
        const id = `bot-${i}`;
        if (game.seats.has(id)) continue;
        const used = new Set([...game.seats.values()].map((s) => s.name));
        const name = BOT_NAMES.find((x) => !used.has(x)) ?? `Bot ${i}`;
        if (!game.addSeat(id, name, true)) break;
        list = bots();
      }
    },
    /** A bot gives its seat to a person. */
    yieldOne() {
      const list = bots();
      const out = list.find((b) => !b.inRound) ?? list[list.length - 1];
      if (!out) return false;
      game.removeSeat(out.id);
      minds.delete(out.id);
      return true;
    },
    step() {
      for (const f of game.seats.values()) {
        if (!f.bot) continue;
        const m = mind(f.id);
        if (--m.wait <= 0) {
          m.wait = m.react;
          think(f, m);
        }
        if (game.phase !== "play") m.sx = m.sz = 0;
        game.setInput(f.id, m.sx, m.sz);
      }
    },
  };
}

const norm = (x: number, z: number): [number, number] => {
  const m = Math.hypot(x, z);
  return m > 1e-6 ? [x / m, z / m] : [0, 0];
};
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clampTo = (v: number, lim: number) => (v < -lim ? -lim : v > lim ? lim : v);

