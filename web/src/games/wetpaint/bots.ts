// Computer brushes: wander toward canvas that isn't theirs, go for a pot when running dry, grab candy,
// splat and dash at whoever is close. The host sets how many (Settings → Computer brushes, or ?bots=3).
import { GRID_H, GRID_W, MAX_BRUSHES, TUNING } from "./shared.ts";
import type { Sim } from "./sim.ts";

const NAMES = ["Smudge", "Blot", "Dabble", "Streak", "Drip", "Swatch", "Squiggle", "Glob"];

interface BotState {
  tx: number;
  tz: number;
  retarget: number;
  wobble: number;
}

export const isBot = (id: string) => id.startsWith("bot-");

export function createBots(sim: Sim) {
  const bots = new Map<string, BotState>();

  return {
    /** Add or remove bots to reach `n` (players always come first: bots only take free brushes). */
    setCount(n: number) {
      n = Math.max(0, Math.min(MAX_BRUSHES, Math.floor(n)));
      while (bots.size > n) {
        const id = [...bots.keys()].pop()!;
        bots.delete(id);
        sim.removeBrush(id);
      }
      for (let i = 0; bots.size < n && i < MAX_BRUSHES; i++) {
        const id = `bot-${i}`;
        if (bots.has(id)) continue;
        if (!sim.addBrush(id, NAMES[i % NAMES.length]!)) break;
        bots.set(id, { tx: GRID_W / 2, tz: GRID_H / 2, retarget: 0, wobble: Math.random() * 10 });
      }
    },

    /** Give a brush back to a player who needs one. Returns true if a bot stepped aside. */
    yieldOne(): boolean {
      const id = [...bots.keys()].pop();
      if (!id) return false;
      bots.delete(id);
      sim.removeBrush(id);
      return true;
    },

    get count() {
      return bots.size;
    },

    step(dt: number) {
      if (sim.phase === "intro") {
        // warm-up: little loops on the spot, like everyone else waiting for GO
        for (const [id, s] of bots) {
          s.wobble += dt * 2.4;
          sim.setInput(id, Math.cos(s.wobble) * 0.45, Math.sin(s.wobble) * 0.45);
        }
        return;
      }
      if (sim.phase !== "play") return;
      for (const [id, s] of bots) {
        const b = sim.brushes.get(id);
        if (!b) continue;
        s.retarget -= dt;
        const reached = Math.hypot(s.tx - b.x, s.tz - b.z) < 3;
        // candy nearby? go get it
        const candy = sim.powers.find((p) => p.dropT <= 0 && Math.hypot(p.x - b.x, p.z - b.z) < 28);
        if (candy) {
          s.tx = candy.x;
          s.tz = candy.z;
        } else if (b.load < 0.3 && !sim.frenzy) {
          // thirsty: nearest pot
          let best = Infinity;
          for (const p of sim.pots) {
            if (!p.active) continue;
            const d = Math.hypot(p.x - b.x, p.z - b.z);
            if (d < best) {
              best = d;
              s.tx = p.x;
              s.tz = p.z;
            }
          }
        } else if (reached || s.retarget <= 0) {
          // somewhere nearby that isn't ours yet
          s.retarget = 1.5 + Math.random() * 2;
          let best = -Infinity;
          for (let k = 0; k < 10; k++) {
            const x = 4 + Math.random() * (GRID_W - 8);
            const z = 4 + Math.random() * (GRID_H - 8);
            const owner = sim.ownerAt(x, z);
            const score = (owner === b.slot + 1 ? -40 : owner === 0 ? 10 : 25) - Math.hypot(x - b.x, z - b.z) * 0.6;
            if (score > best) {
              best = score;
              s.tx = x;
              s.tz = z;
            }
          }
        }
        s.wobble += dt * 1.7;
        const a = Math.atan2(s.tz - b.z, s.tx - b.x) + Math.sin(s.wobble) * 0.35;
        sim.setInput(id, Math.cos(a), Math.sin(a));

        // pick a fight now and then
        for (const o of sim.brushes.values()) {
          if (o.id === id || o.stunT > 0) continue;
          const dx = o.x - b.x;
          const dz = o.z - b.z;
          const d = Math.hypot(dx, dz);
          const facing = Math.abs(Math.atan2(Math.sin(Math.atan2(dz, dx) - b.angle), Math.cos(Math.atan2(dz, dx) - b.angle)));
          const ready = b.bomb || b.load > 0.55;
          if (d > TUNING.splatRange - 6 && d < TUNING.splatRange + 4 && facing < 0.35 && ready && Math.random() < dt * 1.2) sim.splat(id);
          if (d < 9 && facing < 0.5 && Math.random() < dt * 2) sim.dash(id);
        }
      }
    },
  };
}
