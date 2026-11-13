// Frame-rate monitor for performance tests (tools/perf). It exists only in test builds (VITE_PERF=1): in a normal
// build, PERF_BUILD is false and the bundler drops all of it, so the shipped app has no test mode.
// In a test build it is off unless the page starts with `perf=<value>`:
//   · `pnpm perf` (the sandbox) reads the reports from `window.__thumbtidePerf`
//   · `pnpm tv --perf` passes an http:// address; each report is also POSTed there
// Games that skip animation frames (a frame cap) call `frameDrawn()` for each frame they draw, so the monitor
// counts drawn frames. Other screens (HTML only) are measured by their animation frames.
import { startParam } from "./tv.ts";

export interface FrameStats {
  /** Frames drawn per second, over the report window. */
  fps: number;
  /** Median and 95th-percentile time between drawn frames (ms). */
  p50: number;
  p95: number;
  /** The longest gap between two frames (ms). */
  worst: number;
  /** Frames that took longer than 1.5 × 1/60 s (25 ms): a visible stutter at 60fps. */
  long: number;
  frames: number;
}

export interface PerfReport extends FrameStats {
  /** Used JS heap (MB), where the browser reports it. */
  heapMB: number | null;
  /** The game's own numbers (resolution scale, draw calls, …). */
  [extra: string]: unknown;
}

/** True only in builds made for performance tests (`pnpm perf`, `pnpm tv --perf`). */
export const PERF_BUILD = import.meta.env.VITE_PERF === "1";
const target = PERF_BUILD ? startParam("perf") : null;
const INTERVAL = 2000;
let extras: () => Record<string, unknown> = () => ({});
let lastError = "";
let drawn: number[] | null = null; // drawn-frame times, once a game reports them
const ticks: number[] = [];

/** The game's own numbers to add to each report. Returns a function that removes them. */
export function setPerfExtras(fn: () => Record<string, unknown>): () => void {
  if (!PERF_BUILD) return () => {};
  extras = fn;
  return () => {
    if (extras === fn) extras = () => ({});
  };
}

/** A game drew a frame (call it only for frames that a frame cap doesn't skip). */
export function frameDrawn(now = performance.now()) {
  if (!PERF_BUILD || !target) return;
  (drawn ??= []).push(now);
}

/**
 * A game drew a frame at a lower rate on purpose (nothing moving, an end screen): the frame rate isn't judged
 * there, so this frame and the gap before the next counted frame are left out.
 */
export function frameIdle() {
  if (!PERF_BUILD || !target || !drawn) return;
  if (!Number.isNaN(drawn[drawn.length - 1])) drawn.push(NaN);
}

/** The frame rate a game should aim for: `fps=60` lifts a TV's 30fps cap (for tests at the 60fps target). */
export function fpsOverride(): number | null {
  if (!PERF_BUILD) return null;
  const v = Number(startParam("fps"));
  return v > 0 ? v : null;
}

function summarise(times: number[]): FrameStats {
  const gaps: number[] = [];
  // NaN marks a stretch the game slowed down on purpose (frameIdle): gaps that touch it don't count
  for (let i = 1; i < times.length; i++) if (!Number.isNaN(times[i]!) && !Number.isNaN(times[i - 1]!)) gaps.push(times[i]! - times[i - 1]!);
  gaps.sort((a, b) => a - b);
  const pick = (q: number) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))]! : 0);
  const span = gaps.reduce((a, g) => a + g, 0);
  return {
    fps: span ? Math.round((gaps.length * 10000) / span) / 10 : 0,
    p50: Math.round(pick(0.5) * 10) / 10,
    p95: Math.round(pick(0.95) * 10) / 10,
    worst: Math.round(pick(1) * 10) / 10,
    long: gaps.filter((g) => g > 25).length,
    frames: gaps.length,
  };
}

if (PERF_BUILD && target) {
  const reports: PerfReport[] = ((window as unknown as { __thumbtidePerf: PerfReport[] }).__thumbtidePerf = []);
  window.addEventListener("error", (e) => (lastError = String(e.message).slice(0, 160)));
  const tick = (t: number) => {
    ticks.push(t);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => {
    const times = (drawn ?? ticks).slice();
    // the next window starts at this window's last frame, so the gap between windows is counted once
    for (const a of [drawn, ticks]) if (a) a.splice(0, a.length - 1);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    let extra: Record<string, unknown> = {};
    try {
      extra = extras();
    } catch {
      /* the game is tearing down */
    }
    // the game's extras first, so the monitor's own numbers win a name clash
    const report: PerfReport = Object.assign({}, extra, summarise(times), {
      t: Math.round(performance.now()), // page time (ms), to line reports up with what else happened
      hidden: document.hidden, // another app took the screen
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      ...(lastError ? { error: lastError } : {}),
    });
    reports.push(report);
    if (/^https?:/.test(target)) void fetch(target, { method: "POST", mode: "no-cors", body: JSON.stringify(report) }).catch(() => {});
  }, INTERVAL);
}
