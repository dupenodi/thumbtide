// Spin-out check (run on request): wind each weapon up in circles for 3 s, let go of the stick, and see how fast
// the hull and the weapon still turn 2 s and 6 s later. A weapon that keeps the machine spinning shows up here.
//   node --import tsx --test src/games/hammer/spin.bench.ts     (ALL=1 includes the weapons off the pick list)
import { test } from "node:test";
import { stickPush } from "./arenas.ts";
import { Arena, STEP } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons.ts";

test("spin-out after letting go", () => {
  const kinds = (process.env.ALL ? Object.keys(WEAPONS) : WEAPON_KINDS) as WeaponKind[];
  const rows: [string, number][] = [];
  for (const w of kinds) {
    const ar = new Arena({ ...DEFAULT_TUNING, walls: 0 });
    ar.setArena(3000, 2000, []);
    const cx = 1500;
    const cy = 1000;
    const R = 50;
    const V = 300;
    const m = ar.add({ id: 1, name: "s", color: "#fff", weapon: w, x: cx + R, y: cy });
    let th = 0;
    const spin = () => {
      const h = m.hull;
      const s = m.striker;
      const rx = s.x - h.x;
      const ry = s.y - h.y;
      return (rx * (s.vy - h.vy) - ry * (s.vx - h.vx)) / Math.max(1, rx * rx + ry * ry);
    };
    const out: number[] = [];
    for (let i = 0; i < 9 / STEP; i++) {
      const t = i * STEP;
      if (t < 3) {
        th += (V / R) * STEP;
        const vx = -Math.sin(th) * V + (cx + Math.cos(th) * R - m.hull.x) * 4;
        const vy = Math.cos(th) * V + (cy + Math.sin(th) * R - m.hull.y) * 4;
        stickPush(ar, m, vx / ar.tuning.speedClip, vy / ar.tuning.speedClip);
      } else stickPush(ar, m, 0, 0);
      ar.step();
      ar.events.length = 0;
      if (Math.abs(t - 3) < STEP / 2 || Math.abs(t - 5) < STEP / 2 || Math.abs(t - 9 + STEP) < STEP / 2) out.push(Math.abs(spin()), Math.abs(m.hull.w));
    }
    rows.push([`${w.padEnd(12)} weapon spin rad/s  at let-go ${out[0]!.toFixed(1).padStart(5)}  +2 s ${out[2]!.toFixed(1).padStart(5)}  +6 s ${out[4]!.toFixed(1).padStart(5)} | hull w ${out[1]!.toFixed(1)} → ${out[3]!.toFixed(1)} → ${out[5]!.toFixed(1)}`, out[4]!]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log("\n" + rows.map((r) => r[0]).join("\n"));
});
