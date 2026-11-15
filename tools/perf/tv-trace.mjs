#!/usr/bin/env node
// Browser trace of the TV app while it runs: what the TV's Chromium does outside our JavaScript (style, layout,
// paint, raster, compositing, GPU) and which page layers it composites. Only for tests; never part of the TV app.
//
//   node tools/perf/tv-trace.mjs [--seconds=8] [--app=com.thumbtide.tv] [--label=8-full]
//
// Start the game first (pnpm tv --perf=hammer --tour=melee --bots=8 --fps=60 …), wait until it fights, then run
// this. It opens the app's DevTools connection (ares-inspect), records a trace, and writes to
// tools/perf/captures/trace-<time>-<label>/:
//   trace.json   open it in Chrome DevTools (Performance → Load profile) to see every frame
//   layers.json  the composited layers: size, what they draw, why they are layers
//   summary.md   time per second by kind of work and thread, and the layer list
// The trace slows the TV a little: compare traces with traces, not with fps from untraced runs.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { device, fail, web } from "../../web/scripts/lib/webos.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const opts = Object.fromEntries(
  process.argv.slice(2).filter((a) => /^--[\w-]+=/.test(a)).map((a) => [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]),
);
const seconds = Number(opts.seconds) || 8;
const app = opts.app || "com.thumbtide.tv";
const label = (opts.label || "").replace(/[^\w.-]/g, "");
const out = join(here, "captures", `trace-${new Date().toISOString().replace(/[:.]/g, "-")}${label ? `-${label}` : ""}`);

// ---------------------------------------------------------------- DevTools connection through ares-inspect
// (--cdp=http://localhost:9222 traces a local Chrome instead: to test this tool without the TV)
const shell = process.platform === "win32";
const inspector = opts.cdp ? null : spawn(shell ? `"${join(web, "node_modules/.bin/ares-inspect")}" -d ${device().name} --app ${app}` : join(web, "node_modules/.bin/ares-inspect"), shell ? [] : ["-d", device().name, "--app", app], { cwd: web, shell });
const base = opts.cdp ?? await new Promise((res, rej) => {
  let text = "";
  const t = setTimeout(() => rej(new Error(`ares-inspect gave no address in 30 s:\n${text}`)), 30000);
  const look = (d) => {
    text += d;
    const m = /(https?:\/\/[\w.:-]+)/.exec(text);
    if (m) {
      clearTimeout(t);
      res(m[1]);
    }
  };
  inspector.stdout.on("data", look);
  inspector.stderr.on("data", look);
  inspector.on("exit", () => rej(new Error(`ares-inspect stopped:\n${text}`)));
}).catch((e) => fail(String(e.message)));
const stop = () => {
  try {
    inspector?.kill();
  } catch {
    /* gone */
  }
};
process.on("exit", stop);

const targets = await (await fetch(`${base}/json/list`)).json().catch(() => []);
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? targets.find((t) => t.webSocketDebuggerUrl);
if (!page) fail(`No page to trace at ${base}/json/list. Is ${app} open?`);
// ares-inspect forwards a local port: the target's own address may name the TV's port, so keep the forwarded host
const wsUrl = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, base.replace(/^http/, "ws"));
console.log(`Tracing ${page.title || page.url} for ${seconds} s …`);

// ---------------------------------------------------------------- CDP
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = () => rej(new Error("DevTools socket failed"));
}).catch((e) => fail(String(e.message)));
let nextId = 1;
const waiting = new Map();
const events = [];
let layers = [];
let traceDone = null;
ws.onmessage = (m) => {
  const msg = JSON.parse(typeof m.data === "string" ? m.data : m.data.toString());
  if (msg.id && waiting.has(msg.id)) {
    waiting.get(msg.id)(msg);
    waiting.delete(msg.id);
  } else if (msg.method === "Tracing.dataCollected") events.push(...msg.params.value);
  else if (msg.method === "Tracing.tracingComplete") traceDone?.();
  else if (msg.method === "LayerTree.layerTreeDidChange" && msg.params.layers) layers = msg.params.layers;
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = nextId++;
    waiting.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("LayerTree.enable");
const categories = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink",
  "cc",
  "gpu",
  "viz",
  "toplevel",
  "v8.execute",
].join(",");
const started = await send("Tracing.start", { categories, options: "", bufferUsageReportingInterval: 1000, transferMode: "ReportEvents" });
if (started.error) fail(`Tracing.start failed: ${started.error.message}`);
await new Promise((r) => setTimeout(r, seconds * 1000));
await new Promise((res) => {
  traceDone = res;
  void send("Tracing.end");
});
// the layer list as it is now, with the reason for each layer
const reasons = {};
const owners = {};
await send("DOM.getDocument", { depth: 0 });
for (const l of layers) {
  const r = await send("LayerTree.compositingReasons", { layerId: l.layerId });
  reasons[l.layerId] = r.result?.compositingReasons ?? r.result?.compositingReasonIds ?? [];
  if (l.backendNodeId) {
    // the element that owns the layer: tag.class
    const d = await send("DOM.describeNode", { backendNodeId: l.backendNodeId });
    const n = d.result?.node;
    if (n) {
      const a = n.attributes ?? [];
      const cls = a[a.indexOf("class") + 1];
      owners[l.layerId] = `${(n.localName || n.nodeName || "").toLowerCase()}${a.includes("class") && cls ? `.${cls.trim().split(/\s+/).join(".")}` : ""}`;
    }
  }
}
ws.close();
stop();

// ---------------------------------------------------------------- summary
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "trace.json"), JSON.stringify({ traceEvents: events }));
const layerRows = layers.map((l) => ({ id: l.layerId, w: Math.round(l.width), h: Math.round(l.height), draws: l.drawsContent, paints: l.paintCount, owner: owners[l.layerId] ?? "", reasons: reasons[l.layerId] }));
writeFileSync(join(out, "layers.json"), JSON.stringify(layerRows, null, 1));

const threads = new Map();
for (const e of events) if (e.ph === "M" && e.name === "thread_name") threads.set(`${e.pid}:${e.tid}`, e.args.name);
let t0 = Infinity;
let t1 = -Infinity;
for (const e of events) {
  if (!e.ts) continue;
  if (e.ts < t0) t0 = e.ts;
  if (e.ts > t1) t1 = e.ts;
}
const spanS = t1 > t0 ? (t1 - t0) / 1e6 : seconds;
// complete events (X), and B/E pairs, summed per thread and name (self time is not split out: nested work counts
// in its parent too, so read the rows per kind, not as a sum)
const totals = new Map();
const add = (key, us) => totals.set(key, (totals.get(key) ?? 0) + us);
const openB = new Map();
for (const e of events) {
  const th = threads.get(`${e.pid}:${e.tid}`) ?? `${e.pid}:${e.tid}`;
  if (e.ph === "X" && e.dur) add(`${th} | ${e.name}`, e.dur);
  else if (e.ph === "B") openB.set(`${e.pid}:${e.tid}:${e.name}`, e.ts);
  else if (e.ph === "E") {
    const k = `${e.pid}:${e.tid}:${e.name}`;
    if (openB.has(k)) {
      add(`${th} | ${e.name}`, e.ts - openB.get(k));
      openB.delete(k);
    }
  }
}
const frames = events.filter((e) => e.name === "ProxyMain::BeginMainFrame" && (e.ph === "X" || e.ph === "B")).length;
// the work a page causes outside its own script: per thread, the classic DevTools timeline kinds
const KEY = ["FunctionCall", "FireAnimationFrame", "UpdateLayoutTree", "Layout", "PrePaint", "Paint", "UpdateLayerTree", "Layerize", "CompositeLayers", "Commit", "RasterTask", "ImageDecodeTask", "DecodeImage", "GPUTask", "DrawFrame", "Display::DrawAndSwap", "SkiaOutputSurfaceImplOnGpu::SwapBuffers", "Scheduler::RunTask"];
const keyRows = [...totals].filter(([k]) => KEY.includes(k.split(" | ")[1])).sort((a, b) => b[1] - a[1]);
const rows = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 40);
const md = [
  `# TV trace${label ? ` (${label})` : ""}`,
  "",
  `${events.length} events over ${spanS.toFixed(1)} s · main frames: ${frames} (${(frames / spanS).toFixed(1)}/s)`,
  "",
  "## Key work (ms per second; 1000 ms/s on one thread = that thread is always busy)",
  "",
  "| thread | event | ms/s | per main frame (ms) |",
  "|---|---|---|---|",
  ...keyRows.map(([k, us]) => {
    const [th, name] = k.split(" | ");
    return `| ${th} | ${name} | ${(us / 1000 / spanS).toFixed(1)} | ${frames ? (us / 1000 / frames).toFixed(2) : ""} |`;
  }),
  "",
  "## All work, top 40 (ms/s; nested work also counts in its parent)",
  "",
  "| thread | event | ms/s |",
  "|---|---|---|",
  ...rows.map(([k, us]) => {
    const [th, name] = k.split(" | ");
    return `| ${th} | ${name} | ${(us / 1000 / spanS).toFixed(1)} |`;
  }),
  "",
  `## Composited layers (${layerRows.length}; ${layerRows.filter((l) => l.draws).length} draw content)`,
  "",
  "| element | w × h | draws | paints | reasons |",
  "|---|---|---|---|---|",
  ...layerRows.sort((a, b) => b.w * b.h - a.w * a.h).map((l) => `| ${l.owner} | ${l.w} × ${l.h} | ${l.draws ? "yes" : ""} | ${l.paints ?? ""} | ${[].concat(l.reasons).join(", ")} |`),
  "",
];
writeFileSync(join(out, "summary.md"), md.join("\n"));
console.log(md.slice(0, 30).join("\n"));
console.log(`\nWritten to ${out}`);
process.exit(0);
