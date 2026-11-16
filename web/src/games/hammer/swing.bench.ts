// Swing map (run on request): for each weapon, fly the hull in circles of radius R at tangential speed V through the
// phone-stick model and measure the striker's speed. Tells the bots how to wind each weapon up.
//   node --import tsx --test src/games/hammer/swing.bench.ts     (ONLY=hammer,chainball)
import { test } from "node:test";
import { stickPush } from "./arenas.ts";
import { Arena, STEP } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { WEAPON_KINDS } from "./weapons.ts";

test("swing map", () => {
  const rows: string[] = [];
  const Rs = [30, 50, 80, 120, 170];
  const Ws = [2, 3, 4, 5, 6.5, 8];
  for (const w of WEAPON_KINDS.filter((k) => !process.env.ONLY || process.env.ONLY.split(",").includes(k))) {
    let best = { r: 0, v: 0, p50: 0, max: 0, reach: 0 };
    const cells: string[] = [];
    for (const R of Rs) {
      for (const W of Ws) {
        const V = Math.min(550, W * R);
        const ar = new Arena({ ...DEFAULT_TUNING, passes: 15, walls: 0 });
        ar.setArena(2000, 1200, []);
        const cx = 1000;
        const cy = 600;
        const m = ar.add({ id: 1, name: "s", color: "#fff", weapon: w, x: cx + R, y: cy });
        let th = 0;
        const speeds: number[] = [];
        let reach = 0;
        for (let i = 0; i < 6 / STEP; i++) {
          // aim at a point ahead on the circle: the stick is the wanted velocity over the top speed
          th += (V / Math.max(R, 1)) * STEP;
          const tx = cx + Math.cos(th) * R;
          const ty = cy + Math.sin(th) * R;
          const vx = -Math.sin(th) * V + (tx - m.hull.x) * 4;
          const vy = Math.cos(th) * V + (ty - m.hull.y) * 4;
          stickPush(ar, m, vx / ar.tuning.speedClip, vy / ar.tuning.speedClip);
          ar.step();
          ar.events.length = 0;
          if (i * STEP > 2) {
            const s = m.striker;
            speeds.push(Math.hypot(s.vx, s.vy));
            reach = Math.max(reach, Math.hypot(s.x - m.hull.x, s.y - m.hull.y));
          }
        }
        speeds.sort((a, b) => a - b);
        const p50 = speeds[Math.floor(speeds.length / 2)]!;
        const max = speeds[speeds.length - 1]!;
        cells.push(`${R}/${W}:${Math.round(p50)}`);
        if (p50 > best.p50) best = { r: R, v: W, p50, max, reach };
      }
    }
    rows.push(`${w.padEnd(12)} best R ${String(best.r).padStart(3)} w ${best.v} → head p50 ${String(Math.round(best.p50)).padStart(4)} max ${String(Math.round(best.max)).padStart(4)} reach ${Math.round(best.reach)} | ${cells.join(" ")}`);
  }
  console.log("\n" + rows.join("\n"));
});
