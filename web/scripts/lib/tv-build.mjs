// Builds the TV page the way the LG webOS app ships it: `vite build --mode tv` (one plain script, Chromium 79
// syntax), with module scripts turned into plain ones because webOS can refuse modules from file://.
// Used by scripts/tv.mjs (the app for the TV) and scripts/perf.mjs (the same code in the sandbox).
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Returns true when it built. `outDir` is relative to `web`; `env` adds VITE_RELAY_URL / VITE_JOIN_URL. */
export function buildTvPage(web, { outDir, env = {}, quiet = false }) {
  // vite's CLI is a .cmd file on Windows, so run its script with this Node instead
  const vite = join(web, "node_modules/vite/bin/vite.js");
  const r = spawnSync(process.execPath, [vite, "build", "--mode", "tv", "--outDir", outDir, ...(quiet ? ["--logLevel", "warn"] : [])], {
    cwd: web,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  if (r.status !== 0) return false;
  const htmlPath = join(web, outDir, "index.html");
  const html = readFileSync(htmlPath, "utf8")
    .replace(/<script type="module" crossorigin src="(\.\/[^"]+)"><\/script>/g, '<script defer src="$1"></script>')
    .replace(/ crossorigin( href="\.\/)/g, "$1");
  if (html.includes('type="module"')) throw new Error(`The TV build still has a module script; see ${htmlPath}.`);
  writeFileSync(htmlPath, html);
  return true;
}
