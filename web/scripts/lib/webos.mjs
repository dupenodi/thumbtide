// Helpers shared by the scripts that talk to an LG webOS TV (scripts/tv.mjs, scripts/perf.mjs).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const web = join(dirname(fileURLToPath(import.meta.url)), "../..");

// node_modules/.bin tools are .cmd files on Windows, which only run through a shell (and then need quoting)
const shell = process.platform === "win32";
const quote = (a) => (shell && /[\s"{}&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const bin = (name) => join(web, "node_modules/.bin", name);

const spawnTool = (name, a, o) =>
  shell ? spawnSync([bin(name), ...a].map(quote).join(" "), { ...o, shell }) : spawnSync(bin(name), a, o);

/** Runs a webOS CLI tool (ares-*) with its output on this terminal. True when it succeeded. */
export const run = (name, ...a) => spawnTool(name, a, { cwd: web, stdio: "inherit" }).status === 0;

/** Runs a webOS CLI tool and returns its output. */
export function capture(name, ...a) {
  const r = spawnTool(name, a, { cwd: web, encoding: "utf8", maxBuffer: 16 << 20 });
  return { ok: r.status === 0, text: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

/** The TV to use: TV_DEVICE, or the first one set up with ares-setup-device that isn't an emulator. */
export function device() {
  let list = [];
  // the webOS CLI keeps its list in %APPDATA% on Windows, and in the home folder elsewhere
  for (const base of [process.env.APPDATA, homedir()].filter(Boolean)) {
    try {
      list = JSON.parse(readFileSync(join(base, ".webos/tv/novacom-devices.json"), "utf8"));
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

/** The TV's model, firmware and webOS SDK version (ares-device -i), or fails with what to check. */
export function deviceInfo(tv) {
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
  const info = {};
  for (const m of sys.text.matchAll(/^\s*(\w+)\s*:\s*(.+?)\s*$/gm)) info[m[1]] = m[2];
  return info;
}

/** First LAN IPv4 address of this computer: what the TV connects back to. */
export function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
    }
  }
  fail("This computer isn't on a network the TV can reach.");
}
