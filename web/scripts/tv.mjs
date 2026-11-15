#!/usr/bin/env node
// Packages the TV page as an LG webOS app and puts it on the TV.
//
//   pnpm tv            build it, install it on the TV and open it
//   pnpm tv --build    only build the .ipk (into web/dist-tv)
//   pnpm tv --inspect  DevTools for the app while it runs on the TV
//   pnpm tv --perf=cascade [--look=reactor --bots=3 --fps=60 …]
//                      open straight into a game with computer players and print its frame rate here
//
// The app holds the TV page only. It still connects to the relay, and phones still open the join page from a
// server. By default both are this computer's `pnpm dev`, at its LAN address. For a deployed build, set
// VITE_RELAY_URL (wss://…) and VITE_JOIN_URL (https://…/join/).
// TV_DEVICE picks the TV, by its name in `pnpm --filter @thumbtide/web exec ares-setup-device -l`. The default is the first real TV.

import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { buildTvPage } from "./lib/tv-build.mjs";
import { capture, device, deviceInfo, fail, lanIp, run, web } from "./lib/webos.mjs";

const out = join(web, "dist-tv");
const appDir = join(out, "app");
const args = new Set(process.argv.slice(2));
/** --key=value arguments (the game for --perf, and launch options such as --look=reactor). */
const opts = Object.fromEntries(
  [...args].filter((a) => /^--[\w-]+=/.test(a)).map((a) => [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]),
);
const appinfo = JSON.parse(readFileSync(join(web, "tv/webos/appinfo.json"), "utf8"));
appinfo.version = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;

const listening = (port) =>
  new Promise((res) => {
    const s = connect(port, "127.0.0.1");
    s.once("connect", () => (s.destroy(), res(true)));
    s.once("error", () => res(false));
  });

// ------------------------------------------------------------------ DevTools
if (args.has("--inspect")) {
  run("ares-inspect", "-d", device().name, "--app", appinfo.id, "--open");
  process.exit(0);
}

// ------------------------------------------------------------------ build
const ip = process.env.VITE_RELAY_URL && process.env.VITE_JOIN_URL ? null : lanIp();
const env = {
  VITE_RELAY_URL: process.env.VITE_RELAY_URL || `ws://${ip}:8787`,
  VITE_JOIN_URL: process.env.VITE_JOIN_URL || `http://${ip}:5173/join/`,
  // --perf needs the frame monitor, which only test builds have
  ...(opts.perf ? { VITE_PERF: "1" } : {}),
};
console.log(`Building the TV app\n  relay  ${env.VITE_RELAY_URL}\n  phones ${env.VITE_JOIN_URL}\n`);
if (!buildTvPage(web, { outDir: "dist-tv/app", env })) fail("Build failed.");

for (const f of ["icon.png", "largeIcon.png"]) cpSync(join(web, "tv/webos", f), join(appDir, f));
writeFileSync(join(appDir, "appinfo.json"), `${JSON.stringify(appinfo, null, 2)}\n`);

if (!run("ares-package", appDir, "-o", out)) fail("Packaging failed.");
const ipk = join(out, `${appinfo.id}_${appinfo.version}_all.ipk`);
console.log(`\nPackage: ${ipk}`);
if (args.has("--build")) process.exit(0);

// ------------------------------------------------------------------ install + open
const tv = device();
const info = deviceInfo(tv);
const sdk = info.sdkVersion;
console.log(`TV: ${info.modelName ?? "LG TV"}, webOS SDK ${sdk ?? "?"}`);
// webOS 6 is SDK 6.x (Chromium 79); older TVs miss parts of the layout
if (sdk && Number(sdk.split(".")[0]) < 6) console.warn("This TV is older than webOS 6, so some screens may look off.");

if (!run("ares-install", "-d", tv.name, ipk)) fail("Install failed.");
if (opts.perf) {
  await perf(tv);
} else if (!run("ares-launch", "-d", tv.name, appinfo.id)) fail("Installed, but it didn't open. Find Thumbtide in the TV's app list.");

if (ip && !((await listening(8787)) && (await listening(5173)))) {
  console.warn(`\nThumbtide is open on the TV, but the dev servers aren't running here. Start them with: pnpm dev`);
} else {
  console.log("\nThumbtide is open on the TV.");
}

// ------------------------------------------------------------------ --perf
/** Opens the app straight into a game with computer players, and prints the frame rate it reports. */
async function perf(tv) {
  const port = 8799;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.end();
      try {
        const { fps, worst, p95, scale, ...rest } = JSON.parse(body);
        const res = typeof scale === "number" ? ` · ${Math.round(scale * 100)}% resolution` : "";
        const extra = Object.entries(rest).map(([k, v]) => `${k} ${v}`).join(" · ");
        console.log(`${new Date().toLocaleTimeString()}  ${fps} fps · 95% of frames under ${p95}ms · slowest ${worst}ms${res} · ${extra}`);
      } catch {
        /* not a report */
      }
    });
  });
  await new Promise((res) => server.listen(port, "0.0.0.0", res));
  const { perf: game, ...rest } = opts;
  const params = { bots: "3", ...rest, game, perf: `http://${lanIp(tv.host)}:${port}/` };
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id); // start fresh, so the launch options apply
  if (!run("ares-launch", "-d", tv.name, appinfo.id, "-p", JSON.stringify(params))) fail("Installed, but it didn't open.");
  console.log(`\nOpened ${game} on the TV. Its frame rate shows here every 2 seconds (Ctrl-C to stop).\n`);
}
