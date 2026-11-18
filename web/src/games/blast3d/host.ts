// Blast 3D: a PERFORMANCE SPIKE, not the game. Eight computer fighters (proxy bodies) brawl on one arena with bombs,
// so we can measure on the LG TV which rendering and physics choices fit a 3D BombSquad-style brawler.
// Arms come from start options (the URL, or the TV app's launch options), e.g.
//   ?game=blast3d&mesh=merged&parts=15&physics=ragdoll&res=0.5&chars=8&bombs=3&shadow=blob
// See tools/perf (scenarios blast3d-*) and the numbers it prints (physMs, poseMs, renderMs, draws, gpuMB, gl…).
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { startParam } from "../../shell/tv.ts";
import type { HostMount } from "../types.ts";
import { PARTS15, PARTS6, partMatrices } from "./body.ts";
import { DT, Sim } from "./sim.ts";
import { View, type MeshMode } from "./view.ts";

function num(name: string, def: number, lo: number, hi: number) {
  const v = Number(startParam(name));
  return startParam(name) !== null && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}

export function readOpts() {
  const mesh = (["separate", "merged", "instanced"] as MeshMode[]).find((m) => m === startParam("mesh")) ?? "instanced";
  const parts = num("parts", 15, 1, 15) <= 6 ? PARTS6 : PARTS15;
  const ragdoll = startParam("physics") === "ragdoll";
  return {
    mesh,
    parts,
    ragdoll,
    res: num("res", 0.66, 0.2, 2),
    chars: Math.round(num("chars", 8, 1, 16)),
    bombs: Math.round(num("bombs", 3, 0, 8)),
    shadow: startParam("shadow") !== "none",
    iters: Math.round(num("iters", 4, 1, 12)),
    seed: Math.round(num("seed", 7, 0, 1e9)),
  };
}

const mount: HostMount = (ctx) => {
  const o = readOpts();
  const wrap = document.createElement("div");
  wrap.style.cssText = "position:absolute;inset:0;overflow:hidden;background:#8ec9f0";
  ctx.root.appendChild(wrap);

  let sim = new Sim(o);
  const view = new View(wrap, { mesh: o.mesh, res: o.res, shadow: o.shadow, parts: o.parts }, sim);
  const arm = `${o.mesh}/p${o.parts.length}/${o.ragdoll ? `ragdoll${o.iters}` : "capsule"}/r${o.res}/c${o.chars}/b${o.bombs}${o.shadow ? "" : "/noshadow"}`;
  const gl = view.glInfo();
  const startedAt = performance.now();

  // timings over each 2-second report
  let acc = { frames: 0, steps: 0, phys: 0, pose: 0, render: 0, js: 0, jsMax: 0 };
  const offPerf = setPerfExtras(() => {
    const a = acc;
    acc = { frames: 0, steps: 0, phys: 0, pose: 0, render: 0, js: 0, jsMax: 0 };
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const info = view.renderer.info.render;
    return {
      // "intro" until the shaders are compiled and the fight is under way: the sandbox skips these reports
      phase: performance.now() - startedAt < 2500 ? "intro" : "fight",
      arm,
      scale: o.res,
      physMs: a.steps ? r(a.phys / a.steps) : 0, // one 60 Hz physics step
      physFrameMs: a.frames ? r(a.phys / a.frames) : 0,
      poseMs: a.frames ? r(a.pose / a.frames) : 0, // pose + part matrices + copying them into the scene
      renderMs: a.frames ? r(a.render / a.frames) : 0, // three.js render call (CPU side: culling, uniforms, GL calls)
      jsMs: a.frames ? r(a.js / a.frames) : 0, // all of the frame's JavaScript
      jsMax: r(a.jsMax),
      draws: info.calls,
      tris: info.triangles,
      bombs: sim.bombs.length,
      gpuMB: view.gpuMB(),
      ...gl,
    };
  });
  if (import.meta.env.DEV) (window as unknown as { __blast3d: unknown }).__blast3d = { sim: () => sim, view, o };

  let raf = 0;
  let last = 0;
  let pend = 0;
  let paused = false;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : DT;
    last = now;
    if (!paused) pend += dt;
    let steps = 0;
    while (pend >= DT && steps < 4) {
      sim.step();
      pend -= DT;
      steps++;
    }
    if (steps === 4) pend = 0; // too far behind: drop the rest rather than spiral
    const t1 = performance.now();
    sim.bodies();
    const np = o.parts.length;
    for (let c = 0; c < sim.f.length; c++) partMatrices(sim.f[c]!.joints, sim.f[c]!.yaw, o.parts, view.mats, c * np * 16);
    view.update(sim);
    const t2 = performance.now();
    view.render();
    const t3 = performance.now();
    acc.frames++;
    acc.steps += steps;
    acc.phys += t1 - t0;
    acc.pose += t2 - t1;
    acc.render += t3 - t2;
    acc.js += t3 - t0;
    acc.jsMax = Math.max(acc.jsMax, t3 - t0);
    frameDrawn(now);
  };
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      offPerf();
      view.dispose();
      wrap.remove();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    restart() {
      sim = new Sim(o);
    },
  };
};
export default mount;
