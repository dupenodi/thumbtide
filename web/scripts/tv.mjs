#!/usr/bin/env node
// Packages the TV page as an LG webOS app and puts it on the TV.
//
//   pnpm tv            build it, install it on the TV and open it
//   pnpm tv --build    only build the .ipk (into web/dist-tv)
//   pnpm tv --inspect  DevTools for the app while it runs on the TV
//   pnpm tv --perf=cascade [--look=reactor --bots=3 …]
//                      open straight into a game with computer players and print its frame rate here
//
// The app holds the TV page only. It still connects to the relay, and phones still open the join page from a
// server. By default both are this computer's `pnpm dev`, at its LAN address. For a deployed build, set
// VITE_RELAY_URL (wss://…) and VITE_JOIN_URL (https://…/join/).
// TV_DEVICE picks the TV, by its name in `pnpm --filter @thumbtide/web exec ares-setup-device -l`. The default is the first real TV.

import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect } from "node:net";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(web, "dist-tv");
const appDir = join(out, "app");
const args = new Set(process.argv.slice(2));
/** --key=value arguments (the game for --perf, and launch options such as --look=reactor). */
const opts = Object.fromEntries(
  [...args].filter((a) => /^--[\w-]+=/.test(a)).map((a) => [a.slice(2, a.indexOf("=")), a.slice(a.indexOf("=") + 1)]),
);
const appinfo = JSON.parse(readFileSync(join(web, "tv/webos/appinfo.json"), "utf8"));
appinfo.version = JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version;

// On Windows the tools in .bin are .cmd files: they have to run through the shell, with their arguments quoted.
const win = process.platform === "win32";
const bin = (name) => join(web, "node_modules/.bin", win ? `${name}.cmd` : name);
const quote = (a) => (win ? `"${String(a).replace(/"/g, '\\"')}"` : a);
const spawnBin = (name, a, o) => spawnSync(win ? quote(bin(name)) : bin(name), a.map(quote), { cwd: web, shell: win, ...o });
const run = (name, ...a) => spawnBin(name, a, { stdio: "inherit" }).status === 0;
const capture = (name, ...a) => {
  const r = spawnBin(name, a, { encoding: "utf8" });
  return { ok: r.status === 0, text: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const fail = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

/** The TV to use: TV_DEVICE, or the first one set up with ares-setup-device that isn't an emulator. */
function device() {
  let list = [];
  // ares keeps its device list in ~/.webos, or in %APPDATA%\.webos on Windows
  for (const dir of [homedir(), process.env.APPDATA].filter(Boolean)) {
    try {
      list = JSON.parse(readFileSync(join(dir, ".webos/tv/novacom-devices.json"), "utf8"));
      break;
    } catch {
      /* not here */
    }
  }
  const name = process.env.TV_DEVICE;
  const d = name ? list.find((x) => x.name === name) : list.find((x) => x.host !== "127.0.0.1" && x.profile === "tv");
  if (!d) {
    fail(
      `No TV set up yet. On the TV, open the Developer Mode app and turn on Key Server, then:\n` +
        `  pnpm --filter @thumbtide/web exec ares-setup-device -a tv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"\n` +
        `  pnpm --filter @thumbtide/web exec ares-novacom -d tv --getkey      (type the passphrase the TV shows)`,
    );
  }
  return d;
}

function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
    }
  }
  fail("This computer isn't on a network the TV can reach.");
}

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
  ...process.env,
  VITE_RELAY_URL: process.env.VITE_RELAY_URL || `ws://${ip}:8787`,
  VITE_JOIN_URL: process.env.VITE_JOIN_URL || `http://${ip}:5173/join/`,
};
console.log(`Building the TV app\n  relay  ${env.VITE_RELAY_URL}\n  phones ${env.VITE_JOIN_URL}\n`);
if (spawnBin("vite", ["build", "--mode", "tv"], { env, stdio: "inherit" }).status !== 0) fail("Build failed.");

// one plain script instead of a module: webOS can refuse modules (and crossorigin fetches) from file://
const htmlPath = join(appDir, "index.html");
const html = readFileSync(htmlPath, "utf8")
  .replace(/<script type="module" crossorigin src="(\.\/[^"]+)"><\/script>/g, '<script defer src="$1"></script>')
  .replace(/ crossorigin( href="\.\/)/g, "$1");
if (html.includes('type="module"')) fail("The TV build still has a module script; see web/dist-tv/app/index.html.");
writeFileSync(htmlPath, html);

for (const f of ["icon.png", "largeIcon.png"]) cpSync(join(web, "tv/webos", f), join(appDir, f));
writeFileSync(join(appDir, "appinfo.json"), `${JSON.stringify(appinfo, null, 2)}\n`);

if (!run("ares-package", appDir, "-o", out)) fail("Packaging failed.");
const ipk = join(out, `${appinfo.id}_${appinfo.version}_all.ipk`);
console.log(`\nPackage: ${ipk}`);
if (args.has("--build")) process.exit(0);

// ------------------------------------------------------------------ install + open
const tv = device();
const sys = capture("ares-device", "-i", "-d", tv.name);
if (!sys.ok) {
  fail(
    `Can't reach the TV "${tv.name}" at ${tv.host}.\n` +
      `  · Is it on, on the same Wi-Fi as this computer, with the Developer Mode app showing Dev Mode Status ON?\n` +
      `  · If the TV's IP changed (the Developer Mode app shows it):\n` +
      `      pnpm --filter @thumbtide/web exec ares-setup-device -m ${tv.name} -i "host=<new IP>"\n` +
      `  · If the dev session ran out, extend it in the Developer Mode app.\n\n${sys.text.trim()}`,
  );
}
const field = (k) => sys.text.match(new RegExp(`${k}\\s*:\\s*(\\S+)`))?.[1];
const sdk = field("sdkVersion");
console.log(`TV: ${field("modelName") ?? "LG TV"}, webOS SDK ${sdk ?? "?"}`);
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
        const { fps, worst, scale, ...rest } = JSON.parse(body);
        const extra = Object.entries(rest).map(([k, v]) => `${k} ${v}`).join(" · ");
        console.log(`${new Date().toLocaleTimeString()}  ${fps} fps · slowest frame ${worst}ms · ${Math.round(scale * 100)}% resolution · ${extra}`);
      } catch {
        /* not a report */
      }
    });
  });
  await new Promise((res) => server.listen(port, "0.0.0.0", res));
  const { perf: game, ...rest } = opts;
  const params = { bots: "3", ...rest, game, perf: `http://${lanIp()}:${port}/` };
  capture("ares-launch", "-d", tv.name, "--close", appinfo.id); // start fresh, so the launch options apply
  if (!run("ares-launch", "-d", tv.name, appinfo.id, "-p", JSON.stringify(params))) fail("Installed, but it didn't open.");
  console.log(`\nOpened ${game} on the TV. Its frame rate shows here every 2 seconds (Ctrl-C to stop).\n`);
}
