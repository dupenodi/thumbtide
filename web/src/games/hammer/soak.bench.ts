// Soak (run on request, not in `npm test`): every melee weapon fights two bots for 40 s; prints physics and fight numbers.
//   node --import tsx --test src/games/hammer/soak.bench.ts      (ONLY=chainball,twin  PASSES=30)
import { test } from "node:test";
import { driveBot, makeBot } from "./bots.ts";
import { Arena, STEP } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { WEAPON_KINDS } from "./weapons.ts";

test("soak", () => {
  let seed = 7;
  const real = Math.random;
  Math.random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rows: string[] = [];
  const impacts: number[] = [];
  const spikes: string[] = [];
  for (const w of WEAPON_KINDS.filter((k) => !process.env.ONLY || process.env.ONLY.split(",").includes(k))) {
    const ar = new Arena({ ...DEFAULT_TUNING, passes: Number(process.env.PASSES) || 15 });
    const me = ar.add({ id: 1, name: "me", color: "#f00", weapon: w, x: 300, y: 250 });
    const foes = [ar.add({ id: 2, name: "a", color: "#0f0", weapon: "hammer", x: 650, y: 200 }), ar.add({ id: 3, name: "b", color: "#00f", weapon: "chainball", x: 650, y: 350 })];
    const bots = new Map([me, ...foes].map((m) => [m, makeBot("fight", m.hull.x, m.hull.y)]));
    let stretch = 0;
    let stretchSum = 0;
    let stretchN = 0;
    let speed = 0;
    let spin = 0;
    let nan = 0;
    let dealt = 0;
    let hits = 0;
    let bigHit = 0;
    let stuns = 0;
    let disarms = 0;
    let kos = 0;
    let slomo = 0;
    let outside = 0;
    let stepMs = 0;
    const N = Math.round(40 / STEP);
    for (let i = 0; i < N; i++) {
      for (const [m, b] of bots) {
        if (!m.alive) ar.respawn(m, m === me ? 300 : 650, 250);
        driveBot(ar, m, b);
      }
      const t0 = performance.now();
      ar.step();
      stepMs += performance.now() - t0;
      if (ar.timewarp < 1) slomo++;
      for (const e of ar.events) {
        if (e.type === "hit" && e.attacker !== e.victim) impacts.push(e.impact);
        if (e.type === "hit" && e.attacker === me && e.victim !== me) {
          dealt += e.dmg;
          hits++;
          bigHit = Math.max(bigHit, e.dmg);
        }
        if (e.type === "disarm" && e.by === me) disarms++;
        if (e.type === "ko" && e.by === me) kos++;
      }
      ar.events.length = 0;
      if (me.stun > 0.5) stuns++;
      if (me.hull.x < -40 || me.hull.x > 1000 || me.hull.y < -40 || me.hull.y > 580) outside++;
      for (const b of ar.world.bodies) {
        if (!Number.isFinite(b.x + b.y + b.a)) nan++;
        const v = Math.hypot(b.vx, b.vy);
        if (v > 1200) {
          const owner = [me, ...foes].find((m) => m.hull === b || m.parts.includes(b));
          spikes.push(`${w}: ${owner?.weapon ?? "?"} ${owner?.hull === b ? "hull" : "part"} ${Math.round(v)} px/s, step ${i}, mass ${Math.round(b.mass)}`);
        }
        speed = Math.max(speed, v);
        if (me.parts.includes(b)) spin = Math.max(spin, Math.abs(b.w));
      }
      for (const j of me.joints) {
        // the dual sets' spacer (type 0, necess 1) can't be met by design: it only pushes the two parts apart
        if (j.necess <= 1) continue;
        const [ax, ay] = j.a.worldPoint(j.sax, j.say);
        const [bx, by] = j.b.worldPoint(j.sbx, j.sby);
        const len = Math.hypot(bx - ax, by - ay);
        const err = j.type === 3 ? Math.max(0, len - j.radius) : Math.abs(len - j.radius);
        stretch = Math.max(stretch, err);
        stretchSum += err;
        stretchN++;
      }
    }
    const mass = Math.round(me.parts.reduce((s, b) => s + b.mass, 0) / 1000);
    rows.push(
      [w.padEnd(12), `mass ${String(mass).padStart(4)}k`, `bodies ${String(me.parts.length).padStart(2)}`, `stretch max ${stretch.toFixed(1).padStart(5)} mean ${(stretchSum / Math.max(1, stretchN)).toFixed(2)}`, `vmax ${String(Math.round(speed)).padStart(5)}`, `spin ${spin.toFixed(0).padStart(3)}`, `dealt ${String(dealt).padStart(4)} in ${String(hits).padStart(4)} hits (max ${String(bigHit).padStart(2)})`, `ko ${kos}`, `disarm ${disarms}`, `stun% ${((stuns * 100) / N).toFixed(0).padStart(2)}`, `slomo% ${((slomo * 100) / N).toFixed(0).padStart(2)}`, `out ${outside}`, `nan ${nan}`, `${((stepMs / N) * 1000).toFixed(0)}us/step`].join(" | "),
    );
  }
  Math.random = real;
  console.log("\n" + rows.join("\n"));
  impacts.sort((a, b) => a - b);
  const q = (p: number) => impacts[Math.floor(impacts.length * p)]!.toFixed(0);
  console.log(`\nIMPACTS on machines (${impacts.length} hits): p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} p99.9 ${q(0.999)} max ${impacts[impacts.length - 1]!.toFixed(0)}`);
  console.log(`SPIKES over 1200 px/s: ${spikes.length}\n` + spikes.slice(0, 25).join("\n"));
});
