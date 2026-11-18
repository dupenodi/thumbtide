#!/usr/bin/env node
// Start everything Thumbtide needs, in one terminal: the relay (server/) and the web dev server (web/).
//
//   node scripts/start.mjs                      relay on 8787, web on 5173
//   node scripts/start.mjs --relay=8788 --web=5174
//   npm start  /  pnpm start                    the same, from the repo root
//
// It prints where to open the TV page and the phone page, on this computer and on the local network.
// Laptop-only testing: open the TV page in one browser tab and the phone page in other tabs (each tab is its own
// player). Ctrl+C stops both servers.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const RELAY = Number(arg.relay ?? process.env.PORT ?? 8787);
const WEB = Number(arg.web ?? 5173);

// the same choice as web/vite.config.ts (so the printed address matches the TV page's QR code): skip virtual adapters
function lanIp() {
  if (process.env.LAN_IP) return process.env.LAN_IP;
  const virtual = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Docker|vboxnet|Loopback/i;
  let fallback = null;
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const n of list ?? []) {
      if (n.family !== "IPv4" || n.internal || n.address.startsWith("169.254.")) continue;
      if (!virtual.test(name)) return n.address;
      fallback ??= n.address;
    }
  }
  return fallback;
}

const kids = [];
function run(name, args, cwd, env) {
  const p = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  const tag = `[${name}] `;
  const pipe = (s, out) =>
    s.on("data", (d) => {
      for (const line of String(d).split(/\r?\n/)) if (line.trim()) out.write(tag + line + "\n");
    });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code) => {
    console.log(`${tag}stopped (code ${code}).`);
    stop(code ?? 1);
  });
  kids.push(p);
}

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const k of kids) {
    try {
      // the relay runs under "tsx watch", which has a child of its own: on Windows only a tree kill ends both
      if (process.platform === "win32") spawn("taskkill", ["/pid", String(k.pid), "/T", "/F"], { stdio: "ignore" });
      else k.kill();
    } catch {}
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const req = createRequire(join(root, "server", "package.json"));
const tsxCli = req.resolve("tsx/cli");
const viteCli = join(dirname(createRequire(join(root, "web", "package.json")).resolve("vite/package.json")), "bin", "vite.js");

run("relay", [tsxCli, "watch", "src/index.ts"], join(root, "server"), { PORT: String(RELAY) });
run("web", [viteCli, "--host", "--port", String(WEB), "--strictPort"], join(root, "web"), { VITE_RELAY_PORT: String(RELAY) });

const ip = lanIp();
setTimeout(() => {
  console.log("");
  console.log("Thumbtide is starting:");
  console.log(`  TV page (this computer):   http://localhost:${WEB}/`);
  console.log(`  Phone page (this computer): http://localhost:${WEB}/join/   (open several tabs for several players)`);
  if (ip) {
    console.log(`  TV page (network):         http://${ip}:${WEB}/`);
    console.log(`  Phones on the Wi-Fi:       http://${ip}:${WEB}/join/   (or scan the QR code on the TV page)`);
  }
  console.log(`  Relay:                     ws://${ip ?? "localhost"}:${RELAY}`);
  console.log(`  Straight into a game:      http://localhost:${WEB}/?game=trails&bots=3`);
  console.log("Ctrl+C stops both.");
  console.log("");
}, 2500);
