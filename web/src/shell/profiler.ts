// Call profiler for draw and HUD work. It exists only in profiler builds (VITE_PROFILE=1, made by
// `pnpm tv --perf=<game> --profile`): in every other build PROFILE_BUILD is false, the bundler drops all of it,
// and vite.config.ts fails the build if its marker turns up. In a profiler build it is off unless the page
// starts with `profile=<http address>` (or `profile=1`: reports stay in the page, for the sandbox).
//
// Every 2 s it reports, per drawn frame:
//   · canvas calls by method and state changes by property, on the game's canvas (on screen) and on
//     off-screen canvases (sprite painting) apart
//   · the time of each section a game marks with profBegin/profEnd (physics, draw, HUD …)
//   · page changes (MutationObserver): attribute, style, text and child changes, and the elements that change most
//   · long tasks (over 50 ms) and the gap between animation frames
import { startParam } from "./tv.ts";

/** True only in profiler builds (VITE_PROFILE=1). */
export const PROFILE_BUILD = import.meta.env.VITE_PROFILE === "1";
const target = PROFILE_BUILD ? startParam("profile") : null;
const on = PROFILE_BUILD && !!target;

const sectionMs = new Map<string, number>();
const sectionN = new Map<string, number>();
const open = new Map<string, number>();

/** Start timing a section (no-op unless the profiler runs). */
export function profBegin(name: string): void {
  if (!on) return;
  open.set(name, performance.now());
}

/** Stop timing a section started with profBegin. */
export function profEnd(name: string): void {
  if (!on) return;
  const t0 = open.get(name);
  if (t0 === undefined) return;
  open.delete(name);
  sectionMs.set(name, (sectionMs.get(name) ?? 0) + performance.now() - t0);
  sectionN.set(name, (sectionN.get(name) ?? 0) + 1);
}

if (on) {
  const METHODS = [
    "fill", "stroke", "fillRect", "strokeRect", "clearRect", "drawImage", "fillText", "strokeText", "measureText",
    "save", "restore", "setTransform", "transform", "translate", "rotate", "scale", "beginPath", "closePath",
    "moveTo", "lineTo", "arc", "ellipse", "rect", "quadraticCurveTo", "bezierCurveTo", "clip",
    "createLinearGradient", "createRadialGradient", "createPattern", "getImageData", "putImageData",
  ] as const;
  const PROPS = ["fillStyle", "strokeStyle", "globalAlpha", "lineWidth", "font", "globalCompositeOperation", "filter", "shadowBlur"] as const;
  const screen = new Map<string, number>();
  const offscreen = new Map<string, number>();
  const bump = (ctx: CanvasRenderingContext2D, key: string) => {
    const m = ctx.canvas.isConnected ? screen : offscreen;
    m.set(key, (m.get(key) ?? 0) + 1);
  };
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  for (const name of METHODS) {
    const orig = proto[name] as ((...a: unknown[]) => unknown) | undefined;
    if (typeof orig !== "function") continue;
    proto[name] = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      bump(this, name);
      return orig.apply(this, a);
    };
  }
  for (const name of PROPS) {
    const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, name);
    if (!d?.set || !d.get) continue;
    const set = d.set;
    Object.defineProperty(CanvasRenderingContext2D.prototype, name, {
      ...d,
      set(this: CanvasRenderingContext2D, v: unknown) {
        bump(this, `=${name}`);
        set.call(this, v);
      },
    });
  }

  // page changes: count by kind and by the element that changed (its first class, or its tag)
  const mutations = new Map<string, number>();
  const byEl = new Map<string, number>();
  const label = (n: Node) => {
    const el = n.nodeType === 1 ? (n as Element) : n.parentElement;
    if (!el) return "?";
    const cls = typeof el.className === "string" ? el.className.split(" ")[0] : "";
    return cls ? `.${cls}` : el.tagName.toLowerCase();
  };
  new MutationObserver((list) => {
    for (const r of list) {
      const kind = r.type === "attributes" ? (r.attributeName === "style" ? "style" : r.attributeName === "class" ? "class" : "attr") : r.type === "characterData" ? "text" : "children";
      mutations.set(kind, (mutations.get(kind) ?? 0) + 1);
      const k = `${label(r.target)} ${kind}`;
      byEl.set(k, (byEl.get(k) ?? 0) + 1);
    }
  }).observe(document.documentElement, { subtree: true, attributes: true, childList: true, characterData: true });

  let longTasks = 0;
  let longMs = 0;
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        longTasks++;
        longMs += e.duration;
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* no long-task timing in this browser */
  }

  let frames = 0;
  let worstGap = 0;
  let lastT = 0;
  const tick = (t: number) => {
    frames++;
    if (lastT) worstGap = Math.max(worstGap, t - lastT);
    lastT = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  const reports: unknown[] = ((window as unknown as { __thumbtideProfile: unknown[] }).__thumbtideProfile = []);
  const perFrame = (m: Map<string, number>, n: number) => {
    const o: Record<string, number> = {};
    for (const [k, v] of [...m].sort((a, b) => b[1] - a[1])) o[k] = Math.round((v / n) * 10) / 10;
    return o;
  };
  setInterval(() => {
    const n = Math.max(1, frames);
    const sections: Record<string, number> = {};
    for (const [k, v] of sectionMs) sections[k] = Math.round((v / n) * 100) / 100;
    const top = [...byEl].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round((v / n) * 10) / 10}`);
    const report = {
      kind: "profile",
      t: Math.round(performance.now()),
      frames,
      fps: Math.round((frames / 2) * 10) / 10,
      worstGapMs: Math.round(worstGap),
      sectionsMsPerFrame: sections,
      canvasPerFrame: perFrame(screen, n),
      spritePaintPerFrame: perFrame(offscreen, n),
      domPerFrame: perFrame(mutations, n),
      domTop: top,
      longTasks,
      longMs: Math.round(longMs),
    };
    reports.push(report);
    if (reports.length > 300) reports.shift();
    if (/^https?:/.test(target!)) void fetch(target!, { method: "POST", mode: "no-cors", body: JSON.stringify(report) }).catch(() => {});
    frames = 0;
    worstGap = 0;
    longTasks = 0;
    longMs = 0;
    for (const m of [screen, offscreen, mutations, byEl, sectionMs, sectionN]) m.clear();
  }, 2000);
}
