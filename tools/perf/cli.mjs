#!/usr/bin/env node
// Performance sandbox: plays each game in Chrome on this computer, slowed down to match a real TV, and checks
// that it holds the frame-rate target (60fps by default).
//
//   pnpm perf                          every scenario, against the default TV profile
//   pnpm perf cascade wetpaint         only these (a game id runs all its scenarios, e.g. every Cascade look)
//   pnpm perf cascade --look=reactor --board=huge     options go to the game, as on the TV page's address
//   pnpm perf --seconds=20 --target=60 --headed --json
//   pnpm perf --native                 no slowdown: this computer's own speed
//   pnpm perf --cpu=6 --gpu=120        set the slowdown by hand
//   pnpm perf --fps=30                 test with the game's TV frame cap (the default lifts it: fps=60)
//   pnpm perf --tv                     the same scenarios on the real TV, over Wi-Fi (developer mode)
//   pnpm perf --verbose                also print every 2-second report
//
//   pnpm perf probe                    measure this computer (cached; the slowdown is TV ÷ this computer)
//   pnpm perf probe --emulate          the probe again, slowed down: compare it with the TV's numbers
//   pnpm perf probe --tv               measure the TV over Wi-Fi and save its profile in tools/perf/profiles
//   pnpm perf calibrate [scenarios]    play the same scenarios on the TV and here, and tune the profile to match
//   pnpm perf capture [scenarios]      everything from the TV in one pass: hardware, probe, each game's frames from
//                                      launch on, and the TV's memory, swap, load and CPU every second, into
//                                      tools/perf/captures/<time>/ (capture.json, samples.log, summary.md)
//
// How the slowdown works:
//   · CPU: Chrome's CPU throttling (DevTools protocol) slows the page's main thread by a fixed factor
//   · graphics: tools/perf/gpu-slowdown.js repeats each WebGL draw into a hidden buffer, so the graphics chip does K×
//     the work of every draw, with the game's own shaders and pixels
//   · screen: the TV's viewport, pixel ratio and browser name (so the game takes its TV paths), and its JS heap limit
// Both factors come from tools/perf/probe: the same benchmarks run on the TV and here. `calibrate` corrects the
// graphics factor with real games, measured on the TV.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// the TV build and the webOS helpers belong to the web package; this package only uses them
import { buildTvPage } from "../../web/scripts/lib/tv-build.mjs";
import { capture, device, deviceInfo, fail, lanIp, run, web } from "../../web/scripts/lib/webos.mjs";

const root = join(web, "..");
const perfDir = dirname(fileURLToPath(import.meta.url));
const cacheDir = join(perfDir, ".cache");
const RELAY_PORT = 8797;
const SITE_PORT = 8798;
const REPORT_PORT = 8799;

// ------------------------------------------------------------------ arguments
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => /^--[\w-]+$/.test(a)));
const opts = Object.fromEntries(argv.filter((a) => /^--[\w-]+=/.test(a)).map((a) => [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]));
const words = argv.filter((a) => !a.startsWith("--"));
const command = ["probe", "calibrate", "capture"].includes(words[0]) ? words.shift() : "run";
const OWN = new Set(["seconds", "warmup", "target", "profile", "cpu", "gpu", "browser", "fps"]);
const gameParams = Object.fromEntries(Object.entries(opts).filter(([k]) => !OWN.has(k)));
const seconds = Number(opts.seconds ?? 12);
const warmup = Number(opts.warmup ?? 4);
const target = Number(opts.target ?? 60);
const json = flags.has("--json");
const say = json ? () => {} : (...a) => console.log(...a);

// ------------------------------------------------------------------ scenarios
/** What each test plays. Computer players keep every game busy without phones. */
const SCENARIOS = {
  lobby: { game: null, params: {}, note: "room code, QR code, player list" },
  wetpaint: { game: "wetpaint", params: { bots: 7 }, note: "8 brushes" },
  "cascade-culture": { game: "cascade", params: { look: "culture", bots: 3 }, note: "4 players" },
  "cascade-marbles": { game: "cascade", params: { look: "marbles", bots: 3 }, note: "4 players" },
  "cascade-reactor": { game: "cascade", params: { look: "reactor", bots: 3 }, note: "4 players" },
  cult: { game: "cult", params: {}, note: "5 computers play by themselves" },
  "hammer-melka": { game: "hammer", params: { bots: 7, arena: "melka" }, note: "Rotor Brawl, 7 bots" },
  "hammer-classic": { game: "hammer", params: { bots: 7, arena: "classic" }, note: "Rotor Brawl, 7 bots" },
};
function pickScenarios(names) {
  if (!names.length) return Object.keys(SCENARIOS).filter((k) => !SCENARIOS[k].spike);
  const out = [];
  for (const n of names) {
    const hits = Object.keys(SCENARIOS).filter((k) => k === n || SCENARIOS[k].game === n || k.startsWith(`${n}-`));
    if (!hits.length) fail(`No scenario "${n}". There are: ${Object.keys(SCENARIOS).join(", ")}`);
    out.push(...hits.filter((h) => !out.includes(h)));
  }
  return out;
}

// ------------------------------------------------------------------ profiles
function loadProfile() {
  const dir = join(perfDir, "profiles");
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const name = opts.profile ?? process.env.PERF_PROFILE ?? "lg-43sq700s";
  const file = files.find((f) => f === `${name}.json`) ?? (opts.profile ? null : files[0]);
  if (!file) fail(`No profile "${name}" in tools/perf/profiles. Measure a TV with: pnpm perf probe --tv`);
  return { file: join(dir, file), ...JSON.parse(readFileSync(join(dir, file), "utf8")) };
}

const geomean = (xs) => Math.exp(xs.reduce((a, x) => a + Math.log(x), 0) / xs.length);
const CPU_TESTS = ["math", "objects", "typed", "json", "dom"];
const GPU_TESTS = ["fill", "alu", "texture"];

/** The slowdown: TV ÷ this computer, per benchmark, combined. */
function factors(profile, host) {
  const tv = profile.probe;
  const cpuEach = Object.fromEntries(CPU_TESTS.map((k) => [k, tv.cpu[k] / host.cpu[k]]));
  const gpuEach = Object.fromEntries(GPU_TESTS.map((k) => [k, tv.gpu[k].msPerLayer / host.gpu[k].msPerLayer]));
  const w = profile.gpuWeights ?? { fill: 1, alu: 1, texture: 1 };
  const wsum = GPU_TESTS.reduce((a, k) => a + (w[k] ?? 0), 0);
  const gpuMix = Math.exp(GPU_TESTS.reduce((a, k) => a + ((w[k] ?? 0) / wsum) * Math.log(gpuEach[k]), 0));
  return {
    cpu: Math.max(1, geomean(Object.values(cpuEach))),
    gpu: Math.max(1, gpuMix * (profile.gpuBias ?? 1)),
    cpuEach,
    gpuEach,
  };
}

// ------------------------------------------------------------------ servers
const listening = (port) =>
  new Promise((res) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });

async function waitFor(port, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await listening(port)) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  fail(`Nothing started on port ${port}.`);
}

const children = [];
process.on("exit", () => children.forEach((c) => c.kill()));
process.on("SIGINT", () => process.exit(130));

/** The relay, on its own port so a running `pnpm dev` isn't disturbed. */
async function startRelay() {
  if (await listening(RELAY_PORT)) fail(`Port ${RELAY_PORT} is in use. Is another \`pnpm perf\` running?`);
  const c = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: join(root, "server"),
    env: { ...process.env, PORT: String(RELAY_PORT), ALLOWED_ORIGINS: "" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  children.push(c);
  await waitFor(RELAY_PORT);
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
function serve(dir, port) {
  const s = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(dir, path);
    if (!relative(dir, file).startsWith("..") && existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (relative(dir, file).startsWith("..") || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(readFileSync(file));
  });
  return new Promise((r) => s.listen(port, "127.0.0.1", () => r(s)));
}

// ------------------------------------------------------------------ build (cached)
function newestMtime(dir) {
  let t = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith("dist") || e.name === ".cache") continue;
    const p = join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return t;
}

/** The TV build of the site (the code the TV runs), rebuilt only when a source file changed. */
function buildSite() {
  const out = join(web, "dist-perf");
  const stamp = join(out, ".built");
  const src = Math.max(newestMtime(join(web, "src")), newestMtime(join(web, "public")), newestMtime(join(root, "packages")), statSync(join(web, "index.html")).mtimeMs);
  const want = `${src} perf-build-2`; // the second part changes when the build's settings change
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === want && !flags.has("--rebuild")) return out;
  say("Building the TV page…");
  const env = { VITE_PERF: "1", VITE_RELAY_URL: `ws://127.0.0.1:${RELAY_PORT}`, VITE_JOIN_URL: `http://127.0.0.1:${SITE_PORT}/join/` };
  if (!buildTvPage(web, { outDir: "dist-perf", env, quiet: true })) fail("Build failed.");
  writeFileSync(stamp, want);
  return out;
}

// ------------------------------------------------------------------ browser
async function launch(profile) {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    fail("playwright-core is missing. Run: pnpm install");
  }
  const heap = profile.probe.env.jsHeapLimitMB;
  const args = [
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    ...(heap && !flags.has("--native") ? [`--js-flags=--max-old-space-size=${heap}`] : []),
  ];
  const headless = !flags.has("--headed");
  const exe = opts.browser ?? process.env.CHROME_PATH;
  for (const how of exe ? [{ executablePath: exe }] : [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      return await chromium.launch({ ...how, headless, args });
    } catch (e) {
      if (exe) fail(`Couldn't start ${exe}: ${e.message}`);
    }
  }
  fail("No Chrome found. Install Google Chrome, or point CHROME_PATH (or --browser=) at a Chromium-based browser.");
}

/** A page set up like the TV: its screen, its browser name, and (unless `slow` is false) its speed. */
async function tvPage(browser, profile, f, { slow = true } = {}) {
  const env = profile.probe.env;
  const ctx = await browser.newContext({
    viewport: env.viewport,
    deviceScaleFactor: env.devicePixelRatio,
    userAgent: env.userAgent,
  });
  const page = await ctx.newPage();
  // the TV's panel runs at 60Hz; this computer's display may be faster
  await page.addInitScript(`window.__refreshHz = ${profile.refreshHz ?? 60};`);
  await page.addInitScript({ path: join(perfDir, "refresh.js") });
  if (slow && f.gpu > 1) {
    await page.addInitScript(`window.__gpuSlowdown = ${f.gpu};`);
    await page.addInitScript({ path: join(perfDir, "gpu-slowdown.js") });
  }
  const cdp = await ctx.newCDPSession(page);
  if (slow && f.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: f.cpu });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  return { page, ctx, errors };
}

// ------------------------------------------------------------------ probe
async function runProbe(browser, profile, f, slow) {
  const site = await serve(join(perfDir, "probe"), SITE_PORT + 10);
  const { page, ctx } = await tvPage(browser, profile, f, { slow });
  await page.goto(`http://127.0.0.1:${SITE_PORT + 10}/index.html`);
  await page.waitForFunction(() => window.__probe, null, { timeout: 600000 });
  const r = await page.evaluate(() => window.__probe);
  await ctx.close();
  site.close();
  if (r.error) fail(`The probe failed: ${r.error}`);
  return r;
}

/** This computer's probe results, cached by browser and graphics chip. */
async function hostProbe(browser, profile, { fresh = false } = {}) {
  mkdirSync(cacheDir, { recursive: true });
  const key = createHash("sha1").update(`${browser.version()}|${JSON.stringify(profile.probe.env)}`).digest("hex").slice(0, 10);
  const file = join(cacheDir, `host-${key}.json`);
  if (!fresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  say("Measuring this computer (once; cached in tools/perf/.cache)…");
  const r = await runProbe(browser, profile, { cpu: 1, gpu: 1 }, false);
  writeFileSync(file, JSON.stringify(r, null, 2));
  return r;
}

function probeTable(rows) {
  const keys = [
    ["CPU · maths", (p) => p.cpu.math, "ms"],
    ["CPU · objects", (p) => p.cpu.objects, "ms"],
    ["CPU · typed arrays", (p) => p.cpu.typed, "ms"],
    ["CPU · JSON", (p) => p.cpu.json, "ms"],
    ["CPU · DOM + layout", (p) => p.cpu.dom, "ms"],
    ["GPU · fill (1080p layer)", (p) => p.gpu.fill.msPerLayer, "ms"],
    ["GPU · shader maths (layer)", (p) => p.gpu.alu.msPerLayer, "ms"],
    ["GPU · textures (layer)", (p) => p.gpu.texture.msPerLayer, "ms"],
    ["GPU · draw call", (p) => p.gpu.drawCalls.usPerCall, "µs"],
    ["GPU · 1024² upload", (p) => p.gpu.upload.ms1024, "ms"],
    ["GPU · shader compile", (p) => p.gpu.compile.msPerProgram, "ms"],
    ["Canvas 2D frame", (p) => p.canvas2d.msPerFrame, "ms"],
  ];
  const head = ["", ...rows.map((r) => r[0])];
  const lines = keys.map(([label, get, unit]) => [label, ...rows.map(([, p]) => (p ? `${get(p)} ${unit}` : "-"))]);
  printTable(head, lines);
}

function printTable(head, lines) {
  const w = head.map((h, i) => Math.max(String(h).length, ...lines.map((l) => String(l[i]).length)));
  const fmt = (l) => l.map((c, i) => (i === 0 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join("  ");
  console.log(fmt(head));
  console.log(w.map((n) => "─".repeat(n)).join("  "));
  lines.forEach((l) => console.log(fmt(l)));
}

/** Runs the probe on the TV over Wi-Fi and saves the profile: its hardware and its benchmark results. */
async function probeTv({ save = true } = {}) {
  const tv = device();
  const info = deviceInfo(tv);
  say(`TV: ${info.modelName} (webOS SDK ${info.sdkVersion}, firmware ${info.firmwareVersion}) at ${tv.host}`);

  // the hardware, from the TV's own shell (developer mode)
  const sh = (cmd) => capture("ares-novacom", "-d", tv.name, "-r", cmd).text.replace(/^\[Info\].*\n/gm, "");
  const cpuinfo = sh("cat /proc/cpuinfo");
  const parts = { "0xd03": "Cortex-A53", "0xd04": "Cortex-A35", "0xd05": "Cortex-A55", "0xd07": "Cortex-A57", "0xd08": "Cortex-A72", "0xd09": "Cortex-A73", "0xd0a": "Cortex-A75", "0xd0b": "Cortex-A76", "0xd0d": "Cortex-A77", "0xd41": "Cortex-A78" };
  const cores = [...cpuinfo.matchAll(/CPU part\s*:\s*(0x[0-9a-f]+)/g)].map((m) => parts[m[1]] ?? m[1]);
  const freqs = sh("cat /sys/devices/system/cpu/cpu*/cpufreq/cpuinfo_max_freq").trim().split(/\s+/).map(Number).filter(Boolean);
  const mem = Object.fromEntries([...sh("cat /proc/meminfo").matchAll(/^(\w+):\s+(\d+) kB/gm)].map((m) => [m[1], Math.round(Number(m[2]) / 1024)]));
  const devInfo = (() => {
    try {
      return JSON.parse(sh("cat /var/run/nyx/device_info.json"));
    } catch {
      return {};
    }
  })();
  const libs = sh("ls /usr/lib");
  const hardware = {
    model: info.modelName,
    board: info.boardType,
    webOS: { sdk: info.sdkVersion, firmware: info.firmwareVersion },
    kernel: sh("uname -r").trim(),
    cpu: {
      cores: cores.length,
      types: Object.entries(cores.reduce((a, c) => ((a[c] = (a[c] ?? 0) + 1), a), {})).map(([t, n]) => `${n}× ${t}`).join(" + "),
      maxMHz: freqs.length ? Math.max(...freqs) / 1000 : null,
    },
    memory: { totalMB: mem.MemTotal, availableMB: mem.MemAvailable, swapMB: mem.SwapTotal, ramSpec: devInfo.ram_size ?? null },
    storage: devInfo.storage_size ?? null,
    gpuDriver: /pvr/i.test(libs) ? "PowerVR (IMG)" : /mali/i.test(libs) ? "Arm Mali" : null,
  };

  // the probe app: package, install, open, and wait for its report
  const stage = join(cacheDir, "probe-app");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(join(stage, "app"), { recursive: true });
  cpSync(join(perfDir, "probe"), join(stage, "app"), { recursive: true });
  for (const f of ["icon.png", "largeIcon.png"]) cpSync(join(web, "tv/webos", f), join(stage, "app", f));
  if (!run("ares-package", join(stage, "app"), "-o", stage)) fail("Packaging the probe failed.");
  const appinfo = JSON.parse(readFileSync(join(perfDir, "probe/appinfo.json"), "utf8"));
  if (!run("ares-install", "-d", tv.name, join(stage, `${appinfo.id}_${appinfo.version}_all.ipk`))) fail("Installing the probe failed.");
  let probe = null;
  const report = receive((r) => ((probe = r), true), 300000);
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
  if (!run("ares-launch", "-d", tv.name, appinfo.id, "-p", JSON.stringify({ report: `http://${lanIp(tv.host)}:${REPORT_PORT}/` }))) fail("The probe didn't open.");
  say("The probe runs on the TV (about a minute)…");
  await report.catch((e) => fail(e.message));
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
  delete probe.sink;

  if (!save) return { hardware, probe, info };
  const name = (info.modelName ?? "tv").toLowerCase().replace(/-[a-z]+$/, "").replace(/[^a-z0-9]+/g, "-");
  const file = join(perfDir, "profiles", `lg-${name}.json`);
  const old = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const profile = {
    name: `LG ${info.modelName}`,
    measured: probe.when,
    hardware: { ...hardware, gpu: probe.gpu.info.unmaskedRenderer, browser: probe.env.userAgent.match(/Chrome\/[\d.]+/)?.[0] },
    gpuWeights: old.gpuWeights ?? { fill: 1, alu: 1, texture: 1 },
    gpuBias: old.gpuBias ?? 1,
    calibration: old.calibration ?? null,
    probe,
  };
  writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);
  say(`\nSaved ${relative(root, file)}`);
  say(JSON.stringify(profile.hardware, null, 2));
}

/** Feeds JSON reports POSTed to this computer by the TV to `take` until it returns true, or the time runs out. */
function receive(take, timeoutMs) {
  return new Promise((resolve, reject) => {
    let any = false;
    const s = createServer((req, res) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => {
        res.end();
        let r;
        try {
          r = JSON.parse(b);
        } catch {
          return; // not a report
        }
        // a game's own reporter may post here too, in another format: keep frame-monitor reports and probe results
        if (typeof r.frames !== "number" && !(r.cpu && r.gpu)) return;
        any = true;
        if (take(r)) {
          s.close();
          resolve(true);
        }
      });
    });
    s.listen(REPORT_PORT, "0.0.0.0");
    setTimeout(() => {
      s.close();
      any ? resolve(false) : reject(new Error("The TV sent nothing. Is this computer's firewall letting Node accept connections?"));
    }, timeoutMs);
  });
}

// ------------------------------------------------------------------ scenarios: measure + judge
/**
 * Which reports count: none until the warm-up has passed, frames are flowing and the game is past its intro
 * (a TV can take many seconds to compile shaders and upload textures), then `seconds` worth.
 */
function measurement() {
  const start = Date.now();
  const kept = [];
  let started = false;
  return {
    kept,
    get started() {
      return started;
    },
    /** True once there are enough. */
    take(r) {
      if (!started) {
        // the report that shows frames flowing still holds the slow start, so the next one is the first kept
        started = (Date.now() - start) / 1000 >= warmup && r.frames >= 3 && r.phase !== "intro";
        return false;
      }
      kept.push(r);
      return kept.length >= Math.ceil(seconds / 2);
    },
  };
}
/** Longest wait for a scenario to get going, on top of warmup + seconds. */
const START_LIMIT_MS = 90000;
function summarise(reports) {
  if (!reports.length) return null;
  let frames = 0;
  let ms = 0;
  for (const r of reports) {
    frames += r.frames;
    ms += r.fps ? (r.frames * 1000) / r.fps : 0;
  }
  const sorted = (k) => reports.map((r) => r[k]).filter((v) => typeof v === "number").sort((a, b) => a - b);
  const scales = sorted("scale");
  const heap = sorted("heapMB");
  return {
    fps: ms ? Math.round((frames * 10000) / ms) / 10 : 0,
    p95: sorted("p95")[Math.floor(reports.length / 2)] ?? 0,
    worst: Math.max(...reports.map((r) => r.worst)),
    longPct: frames ? Math.round((reports.reduce((a, r) => a + r.long, 0) * 1000) / frames) / 10 : 0,
    minScale: scales.length ? scales[0] : null,
    heapMB: heap.length ? heap[heap.length - 1] : null,
    error: reports.find((r) => r.error)?.error ?? null,
    extras: extrasOf(reports),
  };
}

/** The game's own numbers (setPerfExtras): the mean of each numeric one, the last value of the others. */
const MONITOR_KEYS = new Set(["fps", "p50", "p95", "worst", "long", "frames", "t", "hidden", "heapMB", "error", "phase"]);
function extrasOf(reports) {
  const out = {};
  for (const k of new Set(reports.flatMap((r) => Object.keys(r)))) {
    if (MONITOR_KEYS.has(k)) continue;
    const vals = reports.map((r) => r[k]).filter((v) => v !== undefined && v !== null);
    if (!vals.length) continue;
    out[k] = vals.every((v) => typeof v === "number") ? Math.round((vals.reduce((a, v) => a + v, 0) / vals.length) * 1000) / 1000 : vals[vals.length - 1];
  }
  return Object.keys(out).length ? out : null;
}
function printExtras(results) {
  const rows = results.filter((r) => r?.extras);
  if (!rows.length) return;
  console.log("\nThe games' own numbers (mean over the measured reports):");
  for (const r of rows) console.log(`  ${r.name}: ${Object.entries(r.extras).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}

function judge(s) {
  if (!s) return "FAIL";
  if (s.error) return "FAIL";
  if (s.fps >= target - 2 && s.longPct <= 2) return "PASS";
  if (s.fps >= target * 0.85) return "CLOSE";
  return "FAIL";
}

function pageUrl(name, extra = {}) {
  const sc = SCENARIOS[name];
  const q = new URLSearchParams({ ...sc.params, ...(sc.game ? { game: sc.game } : {}), ...gameParams, perf: "1", fps: opts.fps ?? String(target), ...extra });
  return `http://127.0.0.1:${SITE_PORT}/?${q}`;
}

async function playScenario(browser, profile, f, name, slow) {
  const { page, ctx, errors } = await tvPage(browser, profile, f, { slow });
  await page.goto(pageUrl(name));
  const m = measurement();
  const until = Date.now() + (warmup + seconds) * 1000 + START_LIMIT_MS;
  let seen = 0;
  let done = false;
  while (!done && Date.now() < until) {
    await page.waitForTimeout(500);
    const fresh = await page.evaluate((n) => (window.__thumbtidePerf ?? []).slice(n), seen);
    seen += fresh.length;
    for (const r of fresh) if (!done) done = m.take(r);
  }
  const gpuStats = await page.evaluate(() => window.__gpuSlowdownStats ?? null);
  await ctx.close();
  const s = summarise(m.kept);
  if (s && !s.error && errors.length) s.error = errors[0];
  if (s && !m.started) s.error = "it never got going (no steady frames)";
  return { name, ...s, reports: m.kept, gpuStats, verdict: judge(s) };
}

function resultTable(results, tvRows) {
  const head = ["scenario", "fps", "95% under", "slowest", "stutters", "resolution", "heap", ""];
  if (tvRows) head.splice(2, 0, "TV fps");
  const lines = results.map((r) => {
    const row = [
      r.name,
      r.fps ?? "-",
      r.p95 != null ? `${r.p95}ms` : "-",
      r.worst != null ? `${Math.round(r.worst)}ms` : "-",
      r.longPct != null ? `${r.longPct}%` : "-",
      r.minScale != null ? `${Math.round(r.minScale * 100)}%` : "-",
      r.heapMB != null ? `${r.heapMB}MB` : "-",
      r.verdict + (r.error ? `  ${r.error}` : ""),
    ];
    if (tvRows) row.splice(2, 0, tvRows[r.name]?.fps ?? "-");
    return row;
  });
  printTable(head, lines);
}

// ------------------------------------------------------------------ calibrate
/** Plays scenarios on the TV (the real app), each for warmup + seconds, and returns their summaries. */
async function playOnTv(names) {
  const tv = device();
  const info = deviceInfo(tv);
  say(`TV: ${info.modelName} at ${tv.host}`);
  const ip = lanIp(tv.host);
  const appinfo = installTvApp(tv);

  const rows = {};
  for (const name of names) {
    const sc = SCENARIOS[name];
    const params = { ...sc.params, ...(sc.game ? { game: sc.game } : {}), ...gameParams, fps: opts.fps ?? String(target), perf: `http://${ip}:${REPORT_PORT}/` };
    capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
    const m = measurement();
    const got = receive((r) => m.take(r), (warmup + seconds) * 1000 + START_LIMIT_MS);
    if (!run("ares-launch", "-d", tv.name, appinfo.id, "-p", JSON.stringify(params))) fail("The app didn't open on the TV.");
    say(`  TV · ${name}…`);
    await got.catch((e) => fail(e.message));
    const reports = m.kept;
    const sum = summarise(reports);
    if (sum && !m.started) sum.error = "it never got going (no steady frames)";
    rows[name] = { name, ...sum, reports, verdict: judge(sum) };
    say(`  TV · ${name}: ${sum?.fps} fps${sum?.minScale != null ? `, resolution ${Math.round(sum.minScale * 100)}%` : ""}`);
    if (flags.has("--verbose")) reports.forEach((r) => say(`      ${JSON.stringify(r)}`));
  }
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
  return rows;
}

/**
 * The graphics factor from games: for each scenario the TV can't run at the target, find the factor at which the
 * sandbox shows the same frame rate (frame time grows about in proportion to it once the graphics chip is the
 * limit), then save the geometric mean as gpuBias in the profile.
 */
async function calibrate(browser, profile, host, names) {
  const tvRows = await playOnTv(names);
  const base = factors({ ...profile, gpuBias: 1 }, host);
  let bias = profile.gpuBias ?? 1;
  const fits = {};
  for (let pass = 0; pass < 2; pass++) {
    const f = { ...base, gpu: base.gpu * bias };
    say(`\nSandbox pass ${pass + 1}: CPU ÷${f.cpu.toFixed(1)}, graphics ÷${f.gpu.toFixed(0)}`);
    const est = [];
    for (const name of names) {
      const tv = tvRows[name];
      const r = await playScenario(browser, profile, f, name, true);
      say(`  sandbox · ${name}: ${r.fps} fps (TV ${tv?.fps ?? "-"})`);
      // only frames slower than the target say anything about the graphics factor
      if (tv && r.fps && tv.fps < target - 3 && r.fps < target + 1) {
        const k = bias * (r.fps / tv.fps);
        est.push(k);
        fits[name] = { tv: tv.fps, sandbox: r.fps, bias: Math.round(k * 100) / 100 };
      }
    }
    if (!est.length) {
      say("\nEvery scenario held the target on the TV, so the games don't say how slow its graphics chip is. The probe's factor stays.");
      return;
    }
    bias = geomean(est);
  }
  const data = JSON.parse(readFileSync(profile.file, "utf8"));
  data.gpuBias = Math.round(bias * 1000) / 1000;
  const tvSummary = Object.fromEntries(Object.entries(tvRows).map(([k, { reports, verdict, name, ...v }]) => [k, v]));
  data.calibration = { when: new Date().toISOString(), host: host.gpu.info.unmaskedRenderer, scenarios: fits, tv: tvSummary };
  writeFileSync(profile.file, `${JSON.stringify(data, null, 2)}\n`);
  say(`\nSaved gpuBias ${data.gpuBias} in ${relative(root, profile.file)} (graphics factor ${(base.gpu * bias).toFixed(0)}×).`);
}

// ------------------------------------------------------------------ capture: the whole story from the TV
/** Builds the TV app against this computer's sandbox relay and installs it. Returns its appinfo. */
function installTvApp(tv) {
  const ip = lanIp(tv.host);
  const out = join(cacheDir, "calibrate-app");
  rmSync(out, { recursive: true, force: true });
  say("Building the TV app (it connects to this computer's sandbox relay)…");
  const env = { VITE_PERF: "1", VITE_RELAY_URL: `ws://${ip}:${RELAY_PORT}`, VITE_JOIN_URL: `http://${ip}:${SITE_PORT}/join/` };
  if (!buildTvPage(web, { outDir: relative(web, join(out, "app")), env, quiet: true })) fail("Build failed.");
  const appinfo = JSON.parse(readFileSync(join(web, "tv/webos/appinfo.json"), "utf8"));
  appinfo.version = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;
  for (const f of ["icon.png", "largeIcon.png"]) cpSync(join(web, "tv/webos", f), join(out, "app", f));
  writeFileSync(join(out, "app/appinfo.json"), JSON.stringify(appinfo));
  if (!run("ares-package", join(out, "app"), "-o", out)) fail("Packaging failed.");
  if (!run("ares-install", "-d", tv.name, join(out, `${appinfo.id}_${appinfo.version}_all.ipk`))) fail("Install failed.");
  return appinfo;
}

/** The apps running on the TV (ares-launch --running). */
const runningApps = (tv) =>
  capture("ares-launch", "-d", tv.name, "--running")
    .text.split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("["));

// A lock on the TV, so two `pnpm perf` runs (or two sessions) don't measure over each other.
const LOCK = "/tmp/thumbtide-perf.lock";
function takeLock(tv) {
  const sh = (cmd) => capture("ares-novacom", "-d", tv.name, "-r", cmd).text.replace(/^\[Info\].*\n/gm, "").trim();
  const held = sh(`cat ${LOCK} 2>/dev/null; echo; cat /proc/uptime`);
  const [owner, up] = held.split("\n").filter(Boolean).length > 1 ? held.split("\n").filter(Boolean) : ["", held];
  if (owner) {
    const [who, since] = owner.split(" ");
    const age = Number(up.split(" ")[0]) - Number(since);
    if (age >= 0 && age < 900 && !flags.has("--force")) {
      fail(`The TV is busy: another performance run (${who}) took it ${Math.round(age)}s ago.\nWait for it, or add --force to take it anyway.`);
    }
  }
  const me = `${process.pid}@${createHash("sha1").update(lanIp(tv.host)).digest("hex").slice(0, 6)}`;
  sh(`echo "${me} $(cut -d' ' -f1 /proc/uptime)" > ${LOCK}`);
  process.on("exit", () => capture("ares-novacom", "-d", tv.name, "-r", `rm -f ${LOCK} /tmp/thumbtide-stop`));
}

/**
 * The TV's own state every second, from one shell session for the whole capture: memory, swap, pressure (PSI),
 * load, total CPU, and CPU + memory of each browser process. Lines arrive here as they happen.
 */
function startSampler(tv, onLine) {
  const loop = [
    "rm -f /tmp/thumbtide-stop; i=0",
    "while [ $i -lt 3600 ] && [ ! -f /tmp/thumbtide-stop ]; do",
    'echo "@@ $(cut -d" " -f1 /proc/uptime)"',
    "grep -E '^(MemAvailable|MemFree|SwapFree|Cached):' /proc/meminfo",
    "grep -E '^(pswpin|pswpout|pgmajfault) ' /proc/vmstat",
    'echo "psi_mem $(head -1 /proc/pressure/memory)"',
    'echo "psi_cpu $(head -1 /proc/pressure/cpu)"',
    'echo "psi_io $(head -1 /proc/pressure/io)"',
    'echo "load $(cat /proc/loadavg)"',
    'echo "cpu $(head -1 /proc/stat)"',
    'for p in $(pidof WebAppMgr); do echo "proc $p $(cut -d" " -f14,15,24 /proc/$p/stat) $(tr "\\0" " " < /proc/$p/cmdline | grep -o "type=[a-z-]*" | head -1)"; done',
    "sleep 1; i=$((i+1)); done",
  ].join("\n");
  const shell = process.platform === "win32";
  const bin = join(web, "node_modules/.bin", "ares-novacom");
  // base64, so the loop's quotes survive this computer's shell and the TV's
  const cmd = `echo ${Buffer.from(loop).toString("base64")} | base64 -d | sh`;
  const c = spawn(shell ? `"${bin}" -d ${tv.name} -r "${cmd}"` : bin, shell ? [] : ["-d", tv.name, "-r", cmd], { cwd: web, shell });
  let buf = "";
  c.stdout.on("data", (d) => {
    buf += d;
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const l of lines) if (l.trim() && !l.startsWith("[Info]")) onLine(l.trim(), Date.now());
  });
  children.push(c);
  return () => {
    capture("ares-novacom", "-d", tv.name, "-r", "touch /tmp/thumbtide-stop");
    setTimeout(() => c.kill(), 3000);
  };
}

/** Sampler lines → one record per second, with rates (swap pages/s, CPU %) worked out between samples. */
function parseSamples(lines) {
  const out = [];
  let cur = null;
  for (const { line, at } of lines) {
    if (line.startsWith("@@ ")) {
      if (cur) out.push(cur);
      cur = { at, uptime: Number(line.slice(3)), procs: {} };
      continue;
    }
    if (!cur) continue;
    let m;
    if ((m = line.match(/^(MemAvailable|MemFree|SwapFree|Cached):\s+(\d+)/))) cur[m[1]] = Math.round(Number(m[2]) / 1024);
    else if ((m = line.match(/^(pswpin|pswpout|pgmajfault) (\d+)/))) cur[m[1]] = Number(m[2]);
    else if ((m = line.match(/^psi_(\w+) some avg10=([\d.]+)/))) cur[`psi_${m[1]}`] = Number(m[2]);
    else if ((m = line.match(/^load ([\d.]+)/))) cur.load = Number(m[1]);
    else if ((m = line.match(/^cpu\s+(.+)/))) {
      const v = m[1].split(/\s+/).map(Number).filter((n) => !Number.isNaN(n)); // the line repeats "cpu"
      cur.cpuTotal = v.reduce((a, b) => a + b, 0);
      cur.cpuIdle = v[3] + (v[4] ?? 0);
    } else if ((m = line.match(/^proc (\d+) (\d+) (\d+) (\d+)\s*(.*)$/))) {
      cur.procs[m[1]] = { ticks: Number(m[2]) + Number(m[3]), rssMB: Math.round((Number(m[4]) * 4) / 1024), type: m[5].replace("type=", "") || "browser" };
    }
  }
  if (cur) out.push(cur);
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    const dt = b.uptime - a.uptime || 1;
    b.swapInPerSec = Math.round((b.pswpin - a.pswpin) / dt);
    b.swapOutPerSec = Math.round((b.pswpout - a.pswpout) / dt);
    b.majorFaultsPerSec = Math.round((b.pgmajfault - a.pgmajfault) / dt);
    const tot = b.cpuTotal - a.cpuTotal;
    b.cpuBusyPct = tot ? Math.round((100 * (tot - (b.cpuIdle - a.cpuIdle))) / tot) : null;
    // per process: % of one core (100 ticks per second)
    b.browser = Object.entries(b.procs)
      .filter(([pid]) => a.procs[pid])
      .map(([pid, p]) => ({ pid: Number(pid), type: p.type, cpuPct: Math.round((p.ticks - a.procs[pid].ticks) / dt), rssMB: p.rssMB }))
      .filter((p) => p.cpuPct > 0 || p.type === "renderer" || p.type === "gpu-process")
      .sort((x, y) => y.cpuPct - x.cpuPct);
  }
  return out.slice(1).map(({ procs, cpuTotal, cpuIdle, pswpin, pswpout, pgmajfault, ...r }) => r);
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const minOf = (xs) => (xs.length ? Math.min(...xs) : null);
const maxOf = (xs) => (xs.length ? Math.max(...xs) : null);

/** What the TV's state was while a scenario was measured. */
function tvStateDuring(samples, from, to) {
  const s = samples.filter((x) => x.at >= from && x.at <= to);
  const pick = (k) => s.map((x) => x[k]).filter((v) => typeof v === "number");
  const renderer = s.map((x) => x.browser?.find((p) => p.type === "renderer")?.cpuPct).filter((v) => v != null);
  const gpuProc = s.map((x) => x.browser?.find((p) => p.type === "gpu-process")?.cpuPct).filter((v) => v != null);
  const browser = s.map((x) => x.browser?.find((p) => p.type === "browser")?.cpuPct).filter((v) => v != null);
  return {
    samples: s.length,
    memAvailableMB: { min: minOf(pick("MemAvailable")), avg: avg(pick("MemAvailable")) },
    swapFreeMB: { min: minOf(pick("SwapFree")) },
    swapInPerSec: { avg: avg(pick("swapInPerSec")), max: maxOf(pick("swapInPerSec")) },
    majorFaultsPerSec: { avg: avg(pick("majorFaultsPerSec")), max: maxOf(pick("majorFaultsPerSec")) },
    psiMemory: avg(pick("psi_mem")),
    psiCpu: avg(pick("psi_cpu")),
    psiIo: avg(pick("psi_io")),
    load: avg(pick("load")),
    cpuBusyPct: avg(pick("cpuBusyPct")),
    rendererCpuPct: { avg: avg(renderer), max: maxOf(renderer) },
    gpuProcessCpuPct: { avg: avg(gpuProc), max: maxOf(gpuProc) },
    browserCpuPct: { avg: avg(browser), max: maxOf(browser) },
  };
}

/** Everything from the TV in one pass, saved to tools/perf/captures/<time>/. */
async function captureTv(names) {
  const tv = device();
  const info = deviceInfo(tv);
  takeLock(tv);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = join(perfDir, "captures", stamp);
  mkdirSync(dir, { recursive: true });
  say(`TV: ${info.modelName} at ${tv.host} · capture into ${relative(root, dir)}`);

  const lines = [];
  const stopSampler = startSampler(tv, (line, at) => lines.push({ line, at }));
  const events = [];
  const note = (what, extra = {}) => {
    events.push({ at: Date.now(), what, ...extra });
    say(`  ${new Date().toLocaleTimeString()}  ${what}`);
  };

  note("background apps", { apps: runningApps(tv) });
  note("hardware + probe");
  const { hardware, probe } = await probeTv({ save: false });
  note("probe done", { fill: probe.gpu?.fill?.msPerLayer, composite: probe.compositing?.msPerLayer });

  await startRelay();
  const appinfo = installTvApp(tv);
  const ip = lanIp(tv.host);
  const scenarios = {};
  for (const name of names) {
    const sc = SCENARIOS[name];
    const params = { ...sc.params, ...(sc.game ? { game: sc.game } : {}), ...gameParams, fps: opts.fps ?? String(target), perf: `http://${ip}:${REPORT_PORT}/` };
    capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
    const appsBefore = runningApps(tv);
    const m = measurement();
    const all = [];
    let firstReportAt = null;
    let steadyAt = null;
    const got = receive((r) => {
      const at = Date.now();
      all.push({ at, ...r });
      firstReportAt ??= at;
      const done = m.take(r);
      if (m.started && steadyAt == null) steadyAt = at;
      return done;
    }, (warmup + seconds) * 1000 + START_LIMIT_MS);
    const launchedAt = Date.now();
    if (!run("ares-launch", "-d", tv.name, appinfo.id, "-p", JSON.stringify(params))) fail("The app didn't open on the TV.");
    note(`${name}: launched`, { params });
    const complete = await got.catch(() => false);
    const endedAt = Date.now();
    const appsAfter = runningApps(tv);
    const sum = summarise(m.kept);
    const hidden = all.some((r) => r.hidden);
    const strangers = appsAfter.filter((a) => a !== appinfo.id && !appsBefore.includes(a));
    const interrupted = hidden || strangers.length > 0 || !complete;
    const measuredFrom = m.kept.length ? all[all.length - m.kept.length].at - 2000 : steadyAt ?? launchedAt;
    scenarios[name] = {
      params,
      ...sum,
      verdict: interrupted ? "INTERRUPTED" : judge(sum),
      startupSec: steadyAt ? Math.round((steadyAt - launchedAt) / 100) / 10 : null,
      interrupted: interrupted ? { hidden, newApps: strangers, complete } : false,
      tvState: { loading: null, measured: null },
      times: { launchedAt, firstReportAt, steadyAt, measuredFrom, endedAt },
      appsBefore,
      appsAfter,
      reports: all,
    };
    note(`${name}: ${sum?.fps ?? "-"} fps${sum?.minScale != null ? ` at ${Math.round(sum.minScale * 100)}% resolution` : ""}${interrupted ? " · INTERRUPTED" : ""}`);
  }
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id);
  note("background apps", { apps: runningApps(tv) });
  stopSampler();
  await new Promise((r) => setTimeout(r, 1500));

  const samples = parseSamples(lines);
  for (const s of Object.values(scenarios)) {
    s.tvState.loading = tvStateDuring(samples, s.times.launchedAt, s.times.steadyAt ?? s.times.measuredFrom);
    s.tvState.measured = tvStateDuring(samples, s.times.measuredFrom, s.times.endedAt);
  }
  const result = { when: new Date().toISOString(), tv: { ...info, host: tv.host }, hardware, probe, target, seconds, warmup, events, scenarios, samples };
  writeFileSync(join(dir, "capture.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(dir, "samples.log"), lines.map((l) => `${new Date(l.at).toISOString()}  ${l.line}`).join("\n"));
  writeFileSync(join(dir, "summary.md"), captureSummary(result));
  say(`\n${captureSummary(result)}`);
  say(`Saved ${relative(root, dir)}/ (capture.json, samples.log, summary.md)`);
}

function captureSummary(c) {
  const h = c.hardware;
  const L = [];
  L.push(`# TV capture · ${c.tv.modelName} · ${c.when}`, "");
  L.push(`## Hardware`, "");
  L.push(`- ${h.cpu.types} (${h.cpu.cores} cores, ${h.cpu.maxMHz ?? "?"} MHz as reported)`);
  L.push(`- ${c.probe.gpu?.info?.unmaskedRenderer ?? "?"} · WebGL2 ${c.probe.gpu?.info?.webgl2 ? "yes" : "no"} · max texture ${c.probe.gpu?.info?.maxTextureSize}`);
  L.push(`- RAM ${h.memory.ramSpec} (${h.memory.totalMB} MB for Linux), ${h.memory.availableMB} MB free at the start, swap ${h.memory.swapMB} MB`);
  L.push(`- webOS SDK ${h.webOS.sdk}, firmware ${h.webOS.firmware}, ${c.probe.env.userAgent.match(/Chrome\/[\d.]+/)?.[0]}`);
  L.push(`- page ${c.probe.env.viewport.width}×${c.probe.env.viewport.height} CSS px at devicePixelRatio ${c.probe.env.devicePixelRatio}, JS heap limit ${c.probe.env.jsHeapLimitMB} MB`);
  const bg = c.events.find((e) => e.what === "background apps")?.apps ?? [];
  L.push(`- running apps at the start: ${bg.join(", ") || "none"}`, "");
  const p = c.probe;
  L.push(`## Probe`, "");
  L.push(`- GPU: ${p.gpu.fill.msPerLayer} ms per 1080p blended layer · ${p.gpu.alu.msPerLayer} ms per heavy-shader layer · ${p.gpu.texture.msPerLayer} ms per 8-tap texture layer`);
  L.push(`- draw call ${p.gpu.drawCalls.usPerCall} µs · shader compile ${p.gpu.compile.msPerProgram} ms · 1024² upload ${p.gpu.upload.ms1024} ms`);
  if (p.compositing) L.push(`- compositing: ${p.compositing.msPerLayer} ms per extra full-screen CSS layer (${JSON.stringify(p.compositing.layersMs)}), full-screen repaint ${p.compositing.repaintMs} ms/frame`);
  L.push(`- CPU (ms): ${Object.entries(p.cpu).map(([k, v]) => `${k} ${v}`).join(" · ")}`, "");
  L.push(`## Scenarios (target ${c.target} fps)`, "");
  L.push(`| scenario | fps | 95% under | slowest | stutters | resolution | start-up | free RAM (min) | swap-in/s | mem pressure | renderer CPU | verdict |`);
  L.push(`|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const [name, s] of Object.entries(c.scenarios)) {
    const t = s.tvState.measured;
    L.push(
      `| ${name} | ${s.fps ?? "-"} | ${s.p95 ?? "-"} ms | ${s.worst != null ? Math.round(s.worst) : "-"} ms | ${s.longPct ?? "-"}% | ${s.minScale != null ? `${Math.round(s.minScale * 100)}%` : "-"} | ${s.startupSec ?? "-"} s | ${t.memAvailableMB.min ?? "-"} MB | ${t.swapInPerSec.avg ?? "-"} | ${t.psiMemory ?? "-"}% | ${t.rendererCpuPct.avg ?? "-"}% | ${s.verdict} |`,
    );
  }
  L.push("");
  L.push(`Columns: *stutters* = frames over 25 ms; *start-up* = launch to steady frames; *swap-in/s* = pages (4 KB) read back from swap; *mem pressure* = PSI "some" avg10; *renderer CPU* = % of one core.`, "");
  L.push(`## Loading (launch → steady frames)`, "");
  for (const [name, s] of Object.entries(c.scenarios)) {
    const t = s.tvState.loading;
    L.push(`- **${name}**: ${s.startupSec ?? "never"} s · free RAM min ${t.memAvailableMB.min ?? "-"} MB · swap-in ${t.swapInPerSec.avg ?? "-"}/s (max ${t.swapInPerSec.max ?? "-"}) · major faults ${t.majorFaultsPerSec.avg ?? "-"}/s · renderer CPU max ${t.rendererCpuPct.max ?? "-"}%${s.interrupted ? ` · INTERRUPTED ${JSON.stringify(s.interrupted)}` : ""}`);
  }
  L.push("");
  return L.join("\n");
}

// ------------------------------------------------------------------ main
const profile = (command === "probe" && flags.has("--tv")) || command === "capture" ? null : loadProfile();
if (command === "capture") {
  mkdirSync(cacheDir, { recursive: true });
  await captureTv(pickScenarios(words));
  process.exit(0);
}
if (command === "probe" && flags.has("--tv")) {
  mkdirSync(cacheDir, { recursive: true });
  await probeTv();
  process.exit(0);
}

const browser = await launch(profile);
const host = await hostProbe(browser, profile, { fresh: command === "probe" && !flags.has("--emulate") });
const auto = factors(profile, host);
const f = {
  ...auto,
  cpu: opts.cpu ? Number(opts.cpu) : auto.cpu,
  gpu: opts.gpu ? Number(opts.gpu) : auto.gpu,
};
const slow = !flags.has("--native");

if (command === "probe") {
  if (flags.has("--emulate")) {
    say(`Probe in the sandbox (CPU ÷${f.cpu.toFixed(1)}, graphics ÷${f.gpu.toFixed(0)}) next to the TV…\n`);
    const emu = await runProbe(browser, profile, f, true);
    probeTable([[profile.name, profile.probe], ["sandbox", emu], ["this computer", host]]);
  } else {
    probeTable([[profile.name, profile.probe], ["this computer", host]]);
  }
  say(`\nCPU factor ${auto.cpu.toFixed(2)} (${CPU_TESTS.map((k) => `${k} ${auto.cpuEach[k].toFixed(1)}`).join(", ")})`);
  say(`Graphics factor ${auto.gpu.toFixed(1)} (${GPU_TESTS.map((k) => `${k} ${auto.gpuEach[k].toFixed(0)}`).join(", ")}; calibration ×${profile.gpuBias ?? 1})`);
  await browser.close();
  process.exit(0);
}

await startRelay();
const site = await serve(buildSite(), SITE_PORT);
const names = pickScenarios(words);

if (command === "run" && flags.has("--tv")) {
  await browser.close();
  say(`On the TV · target ${target}fps · ${warmup}s warm-up + ${seconds}s each\n`);
  const rows = await playOnTv(names);
  const results = names.map((n) => rows[n]);
  if (json) console.log(JSON.stringify({ profile: "tv", target, results: results.map(({ reports, ...r }) => r) }, null, 2));
  else {
    console.log("");
    resultTable(results);
    printExtras(results);
  }
  site.close();
  process.exit(results.every((r) => r.verdict === "PASS") ? 0 : 1);
}

if (command === "calibrate") {
  await calibrate(browser, profile, host, names);
  await browser.close();
  site.close();
  process.exit(0);
}

say(
  slow
    ? `${profile.name} · CPU ÷${f.cpu.toFixed(1)} · graphics ÷${f.gpu.toFixed(0)} · ${profile.probe.env.viewport.width}×${profile.probe.env.viewport.height} @${profile.probe.env.devicePixelRatio}x · target ${target}fps · ${warmup}s warm-up + ${seconds}s each\n`
    : `This computer, no slowdown · target ${target}fps\n`,
);
const results = [];
for (const name of names) {
  if (!json) process.stdout.write(`  ${name}…`);
  const r = await playScenario(browser, profile, f, name, slow);
  results.push(r);
  if (!json) process.stdout.write(` ${r.fps} fps · ${r.verdict}\n`);
  if (flags.has("--verbose")) r.reports.forEach((x) => say(`      ${JSON.stringify(x)}`));
}
await browser.close();
site.close();

if (json) {
  console.log(JSON.stringify({ profile: profile.name, target, factors: { cpu: f.cpu, gpu: f.gpu }, results: results.map(({ reports, ...r }) => r) }, null, 2));
} else {
  console.log("");
  resultTable(results, profile.calibration?.tv);
  printExtras(results);
  const failed = results.filter((r) => r.verdict !== "PASS");
  console.log(failed.length ? `\n${failed.length} of ${results.length} below a steady ${target}fps.` : `\nAll ${results.length} hold ${target}fps.`);
}
process.exit(results.every((r) => r.verdict === "PASS") ? 0 : 1);
