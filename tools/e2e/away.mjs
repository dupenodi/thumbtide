#!/usr/bin/env node
/**
 * End-to-end emulation of phones going "away" (another app, screen locked) vs. dropping, with no real phones.
 *
 * It starts its OWN relay (from server/src, with short grace times) and its OWN Vite dev server (pointed at that
 * relay through VITE_RELAY_URL), opens one TV page and three phone pages in headless Chrome (iPhone and Android
 * emulation: viewport, user agent, touch), and plays the lobby, Cascade and Rotor Brawl through the real UI.
 *
 *   node tools/e2e/away.mjs                  # from the repo root, after `pnpm install`
 *   node tools/e2e/away.mjs --headed         # watch it
 *   node tools/e2e/away.mjs --only=lobby,cascade,hammer,expiry
 *   node tools/e2e/away.mjs --real-grace     # relay's real limits (60 s drop grace, 10 min away): one extra 65 s wait
 *   node tools/e2e/away.mjs --relay-port=8897 --web-port=5190
 *
 * Short graces by default (drop 12 s, away 40 s, set through startServer options in this script, not in the
 * product), so "an away seat outlives the drop grace" takes seconds. A full run takes about 3 minutes. The relay's record hook is the wire-level
 * truth: every {t:"away"} a phone sends, every socket open and close.
 *
 * How a phone goes away: document.visibilityState is overridden (headless pages are always "visible") and
 * visibilitychange is dispatched, as a phone browser does on an app switch; optionally the page is then frozen
 * with CDP Page.setWebLifecycleState (JS stops, like iOS suspending a tab). A drop is CDP offline plus closing the
 * page's sockets (offline alone does not close an open WebSocket in Chrome). It cannot prove the screen stays on:
 * it only checks that the wake lock is asked for and that the volume-0 video fallback is made and plays.
 *
 * Exit code 0 when every check passes. Never imported by `web`; uses playwright-core from tools/perf.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(ROOT, "tools/perf/package.json"));
const { chromium, devices } = require("playwright-core");

// ------------------------------------------------------------------------------------------- options
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d;
const RELAY_PORT = Number(opt("relay-port", 8897));
const WEB_PORT = Number(opt("web-port", 5190));
const REAL = flag("real-grace");
// the drop grace must outlast Rotor Brawl's 8 s idle limit, so a dropped pilot gets the autopilot before its seat goes
const PLAYER_GRACE = REAL ? 60_000 : 12_000;
const AWAY_GRACE = REAL ? 600_000 : 40_000;
const ONLY = new Set(opt("only", "lobby,cascade,hammer,expiry").split(","));
const HEADED = flag("headed");
const FORBIDDEN = [8787, 5173, 5180, 8796, 8799];
if (FORBIDDEN.includes(RELAY_PORT) || FORBIDDEN.includes(WEB_PORT)) throw new Error("that port belongs to another server");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

// ------------------------------------------------------------------------------------------- results
const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass: !!pass, detail });
  log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  return !!pass;
}
async function until(fn, ms = 10_000, every = 200) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    try {
      v = await fn();
      if (v) return v;
    } catch {
      /* page busy */
    }
    await sleep(every);
  }
  return v;
}

// ------------------------------------------------------------------------------------------- relay (child)
// startServer with short graces; record lines on stdout ("REC {...}"); a tiny stdin RPC to read seats.
const RELAY_BOOT = `
import { startServer } from "./src/index.ts";
const s = startServer({ port: ${RELAY_PORT}, playerGraceMs: ${PLAYER_GRACE}, awayGraceMs: ${AWAY_GRACE},
  record: (l) => process.stdout.write("REC " + JSON.stringify(l) + "\\n") });
s.ready.then((p) => console.log("READY " + p));
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\\n")) >= 0) {
    const c = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    const room = s.rooms.get(c.room);
    const seats = room ? [...room.players.values()].map((p) => ({ ...p.info, socket: !!p.conn, awayTimer: !!p.awayTimer, graceTimer: !!p.graceTimer })) : null;
    process.stdout.write("RES " + JSON.stringify({ id: c.id, seats, vip: null }) + "\\n");
  }
});
process.on("SIGTERM", () => s.close().then(() => process.exit(0)));
`;

const children = [];
const records = [];
const waiters = new Map();
let rpcId = 0;
let relay;

function startRelay() {
  relay = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", RELAY_BOOT], { cwd: join(ROOT, "server"), stdio: ["pipe", "pipe", "inherit"] });
  children.push(relay);
  let out = "";
  return new Promise((ok, fail) => {
    relay.on("exit", (c) => fail(new Error(`relay exited ${c}`)));
    relay.stdout.on("data", (d) => {
      out += d;
      let i;
      while ((i = out.indexOf("\n")) >= 0) {
        const line = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (line.startsWith("READY")) ok();
        else if (line.startsWith("REC ")) records.push(JSON.parse(line.slice(4)));
        else if (line.startsWith("RES ")) {
          const r = JSON.parse(line.slice(4));
          waiters.get(r.id)?.(r.seats);
          waiters.delete(r.id);
        } else if (line) log("relay:", line);
      }
    });
  });
}
/** The relay's own view of the room's seats. */
function seats(room) {
  const id = ++rpcId;
  return new Promise((ok) => {
    waiters.set(id, ok);
    relay.stdin.write(`${JSON.stringify({ id, room })}\n`);
  });
}
const awayMsgs = (id) => records.filter((r) => r.ev === "phone" && r.id === id && r.m?.t === "away").map((r) => r.m.away);

// ------------------------------------------------------------------------------------------- vite (child)
function startVite() {
  const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: join(ROOT, "web"),
    env: { ...process.env, VITE_RELAY_URL: `ws://localhost:${RELAY_PORT}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(vite);
  return new Promise((ok, fail) => {
    vite.on("exit", (c) => fail(new Error(`vite exited ${c}`)));
    const on = (d) => {
      if (/ready in|Local:/.test(String(d))) ok();
    };
    vite.stdout.on("data", on);
    vite.stderr.on("data", (d) => process.stderr.write(d));
  });
}

// ------------------------------------------------------------------------------------------- pages
const WEB = `http://localhost:${WEB_PORT}`;

/** Runs in every phone page before its scripts: visibility we can drive, socket list, wake lock variants. */
function phoneInit({ wake }) {
  const st = { vis: "visible" };
  window.__emu = st;
  Object.defineProperty(Document.prototype, "visibilityState", { configurable: true, get: () => st.vis });
  Object.defineProperty(Document.prototype, "hidden", { configurable: true, get: () => st.vis !== "visible" });
  window.__events = [];
  for (const e of ["visibilitychange", "freeze", "resume"]) document.addEventListener(e, () => window.__events.push(`${e}:${st.vis}`), true);
  for (const e of ["pagehide", "pageshow"]) window.addEventListener(e, () => window.__events.push(e), true);
  const WS = window.WebSocket;
  window.__sockets = [];
  window.WebSocket = class extends WS {
    constructor(...a) {
      super(...a);
      window.__sockets.push(this);
    }
  };
  window.__wake = [];
  if (wake === "none") delete Navigator.prototype.wakeLock; // plain http: no Wake Lock API
  else if (window.WakeLock) {
    const orig = WakeLock.prototype.request;
    WakeLock.prototype.request = function (type) {
      window.__wake.push("request");
      if (wake === "refuse") return Promise.reject(new DOMException("denied", "NotAllowedError")).catch((e) => (window.__wake.push("refused"), Promise.reject(e)));
      return orig.call(this, type).then(
        (l) => (window.__wake.push("granted"), (window.__locks ??= []).push(l), l),
        (e) => (window.__wake.push(`rejected:${e?.name}`), Promise.reject(e)),
      );
    };
  }
  try {
    localStorage.setItem("thumbtide:coached-fullscreen", "1"); // skip the iPhone full-screen coach sheet
  } catch {}
}

const PHONES = [
  { name: "Ivy", device: "iPhone 13", wake: "none" }, // iPhone on plain http: video fallback
  { name: "Ali", device: "Pixel 7", wake: "api" }, // Android: Wake Lock API
  { name: "Max", device: "Galaxy S9+", wake: "refuse" }, // Android, lock refused (battery saver): video takes over
];

let browser;
let tv;
let room;
const phones = [];

async function openPhone(spec) {
  const d = devices[spec.device];
  const ctx = await browser.newContext({ viewport: d.viewport, userAgent: d.userAgent, deviceScaleFactor: d.deviceScaleFactor, isMobile: d.isMobile, hasTouch: true });
  await ctx.addInitScript(phoneInit, { wake: spec.wake });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => log(`${spec.name} page error:`, e.message));
  const cdp = await ctx.newCDPSession(page);
  const ph = { ...spec, ctx, page, cdp, id: null };
  await joinRoom(ph);
  return ph;
}
async function joinRoom(ph) {
  await ph.page.goto(`${WEB}/join/?r=${room}`);
  await ph.page.fill("#name", ph.name);
  await ph.page.tap("#join-form button[type=submit]");
  const me = await until(() => tvEval((n) => shellMod().then((m) => m.shell.host.list.find((p) => p.name === n && p.connected)?.id), ph.name));
  ph.id = me;
  return me;
}

async function tvEval(fn, arg) {
  return tv.evaluate(`(async () => { const shellMod = () => import("/src/shell/host-state.ts"); return (${fn})(${JSON.stringify(arg)}); })()`);
}
const tvPlayer = (id) => tvEval((i) => shellMod().then((m) => { const p = m.shell.host.players.get(i); return p && { connected: p.connected, away: p.away, input: p.input }; }), id);
const tvVip = () => tvEval(() => shellMod().then((m) => m.shell.vip));
const tvShellPlayers = () => tvEval(() => shellMod().then((m) => m.shell.state.players));

/** App switch: the page goes to the background (visibilitychange), optionally pagehide, optionally frozen. */
async function hide(ph, { pagehide = false, freeze = false } = {}) {
  await ph.page.evaluate((ph) => {
    window.__emu.vis = "hidden";
    // a real browser lets go of the screen wake lock when the page is hidden; ours stays visible, so do it here
    for (const l of window.__locks ?? []) if (!l.released) void l.release();
    document.dispatchEvent(new Event("visibilitychange"));
    if (ph) window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  }, pagehide);
  if (freeze) await ph.cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  ph.frozen = freeze;
}
async function show(ph, { pageshow = false } = {}) {
  if (ph.frozen) await ph.cdp.send("Page.setWebLifecycleState", { state: "active" });
  ph.frozen = false;
  await ph.page.evaluate((ps) => {
    window.__emu.vis = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    if (ps) window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
  }, pageshow);
}
/** The network goes (Wi-Fi lost): CDP offline, and the open sockets close (offline alone keeps them open). */
async function goOffline(ph) {
  if (ph.frozen) await ph.cdp.send("Page.setWebLifecycleState", { state: "active" });
  await ph.cdp.send("Network.enable");
  await ph.cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  // only the relay's sockets: closing Vite's HMR socket makes Vite reload the page once the network is back
  await ph.page.evaluate((port) => window.__sockets.forEach((s) => s.url.includes(`:${port}/`) && s.readyState <= 1 && s.close()), RELAY_PORT);
  if (ph.frozen) await ph.cdp.send("Page.setWebLifecycleState", { state: "frozen" });
}
async function goOnline(ph) {
  await ph.cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ph.page.evaluate(() => window.dispatchEvent(new Event("online")));
}
const seatOf = async (ph) => (await seats(room))?.find((s) => s.id === ph.id);
const phoneVip = (ph) => ph.page.evaluate(() => !document.querySelector(".sb-host")?.hidden);

// ------------------------------------------------------------------------------------------- scenarios
async function probeEmulation() {
  // Does headless Chrome ever make a page hidden by itself? Freeze and focus without our override.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${WEB}/join/`);
  const cdp = await ctx.newCDPSession(page);
  await page.evaluate(() => {
    window.__ev = [];
    for (const e of ["visibilitychange", "freeze", "resume"]) document.addEventListener(e, () => window.__ev.push(`${e}:${document.visibilityState}`));
  });
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await sleep(300);
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  const ev = await page.evaluate(() => [document.visibilityState, ...window.__ev]);
  check("emulation: CDP freeze alone fires freeze/resume but no visibilitychange (so we override visibilityState)", ev[0] === "visible" && !ev.some((e) => e.startsWith("visibilitychange")), ev.join(" "));
  await ctx.close();
}

async function lobbyScenario() {
  const [ivy, ali, max] = phones;
  // keep-awake: each phone tapped Join, which is the gesture keepAwake needs
  await sleep(1500);
  const ivyVid = await ivy.page.evaluate(() => {
    const v = document.querySelector("video");
    return v && { volume: v.volume, muted: v.muted, loop: v.loop, paused: v.paused, playsinline: v.hasAttribute("playsinline"), t: v.currentTime };
  });
  check("keep-awake (no Wake Lock API, iPhone/http): silent video made, volume 0, not muted, no loop, playing", ivyVid && ivyVid.volume === 0 && !ivyVid.muted && !ivyVid.loop && !ivyVid.paused && ivyVid.playsinline, JSON.stringify(ivyVid));
  const aliWake = await ali.page.evaluate(() => ({ wake: window.__wake, video: !!document.querySelector("video"), secure: isSecureContext }));
  check("keep-awake (Wake Lock API, Android): navigator.wakeLock.request('screen') is attempted", aliWake.wake.includes("request"), JSON.stringify(aliWake));
  const maxWake = await max.page.evaluate(() => ({ wake: window.__wake, v: (() => { const v = document.querySelector("video"); return v && { volume: v.volume, paused: v.paused }; })() }));
  check("keep-awake (lock refused): the volume-0 video takes over", maxWake.wake.includes("refused") && maxWake.v && maxWake.v.volume === 0 && !maxWake.v.paused, JSON.stringify(maxWake));

  check("VIP is the first phone (Ivy)", (await tvVip()) === ivy.id && (await phoneVip(ivy)));

  // ---- Ivy goes to another app
  await hide(ivy);
  await until(async () => (await tvPlayer(ivy.id))?.away === true, 5000);
  check("away: the phone sends {t:'away',away:true} on visibilitychange hidden", awayMsgs(ivy.id).at(-1) === true, JSON.stringify(awayMsgs(ivy.id)));
  check("away: host SDK sets p.away, keeps p.connected", JSON.stringify(await tvPlayer(ivy.id)) === JSON.stringify({ connected: true, away: true, input: null }));
  const vidHidden = await ivy.page.evaluate(() => document.querySelector("video")?.paused);
  check("keep-awake: the video pauses while the page is hidden", vidHidden === true);
  check("VIP moves off the away phone (to Ali)", (await until(async () => (await tvVip()) === ali.id, 3000)) && (await until(() => phoneVip(ali), 3000)));
  const seatClass = await tv.evaluate((n) => [...document.querySelectorAll(".seat")].find((e) => e.textContent.includes(n))?.className, ivy.name);
  check("TV lobby marks the away seat (.seat.away)", /\baway\b/.test(seatClass ?? ""), seatClass);
  check("shell state carries away:true to phones", (await tvShellPlayers()).find((p) => p.id === ivy.id)?.away === true);
  // host sheet on the new VIP shows "(away)"
  await ali.page.tap(".sb-host");
  const sheetTxt = await until(() => ali.page.evaluate(() => document.querySelector(".sh-players")?.innerText), 3000);
  check("VIP phone's host sheet shows 'Ivy (away)'", /Ivy\s*\(away\)/.test(sheetTxt ?? ""), JSON.stringify(sheetTxt));
  await ali.page.tap(".sh-x").catch(() => {});

  // ---- Ivy comes back
  await show(ivy);
  await until(async () => (await tvPlayer(ivy.id))?.away === false, 5000);
  check("back: the phone sends away:false on visible; host clears p.away", awayMsgs(ivy.id).at(-1) === false && (await tvPlayer(ivy.id))?.away === false);
  check("back: VIP returns to the first phone", (await until(async () => (await tvVip()) === ivy.id, 3000)) === true);
  const vidBack = await until(() => ivy.page.evaluate(() => document.querySelector("video")?.paused === false), 3000);
  check("keep-awake: the video plays again when the page is visible", vidBack);
  const aliRe = await ali.page.evaluate(() => window.__wake.length);
  await hide(ali);
  await show(ali);
  check("keep-awake: the wake lock is asked for again after coming back", (await until(() => ali.page.evaluate((n) => window.__wake.filter((w) => w === "request").length > 0 && window.__wake.length > n, aliRe), 3000)) === true);

  // ---- pagehide alone (bfcache / closing tab) also says away
  await ivy.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  check("pagehide alone sends away:true", await until(async () => (await tvPlayer(ivy.id))?.away === true, 3000));
  await ivy.page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false })));
  check("pageshow (visible) sends back", await until(async () => (await tvPlayer(ivy.id))?.away === false, 3000));

  // ---- away + frozen (iOS suspends the tab) + the socket dies: the seat outlives the drop grace
  await hide(ivy, { freeze: true });
  await until(async () => (await tvPlayer(ivy.id))?.away === true, 3000);
  await goOffline(ivy);
  await until(async () => (await tvPlayer(ivy.id))?.connected === false, 5000);
  const s1 = await seatOf(ivy);
  check("away then dropped: relay holds the seat on the away timer, no drop grace timer", s1 && s1.away && !s1.socket && s1.awayTimer && !s1.graceTimer, JSON.stringify(s1));
  // ---- control: Max drops without going away (plain Wi-Fi loss)
  await goOffline(max);
  await until(async () => (await tvPlayer(max.id))?.connected === false, 5000);
  check("plain drop: the drop grace timer runs (old path)", (await seatOf(max))?.graceTimer === true);
  log(`waiting ${PLAYER_GRACE + 3000} ms (drop grace + 3 s)…`);
  await sleep(PLAYER_GRACE + 3000);
  check(`away seat kept beyond the drop grace (${PLAYER_GRACE / 1000} s)`, !!(await seatOf(ivy)), JSON.stringify(await seatOf(ivy)));
  check("plain-dropped seat is removed after the drop grace", !(await seatOf(max)));
  // a newcomer in a full room never gets an away seat: tested in server/test (room size 8 is too many pages here)

  // ---- Ivy is back: online, visible, same seat
  await goOnline(ivy);
  await show(ivy);
  const back = await until(async () => {
    const p = await tvPlayer(ivy.id);
    return p?.connected && !p.away && p;
  }, 10_000);
  check("back after the drop: same seat reconnects, away cleared, VIP back", !!back && (await until(async () => (await tvVip()) === ivy.id, 3000)), JSON.stringify(back));
  // Max's seat was freed: his phone reconnects with a token the relay no longer knows, so it joins as a new seat
  const oldMax = max.id;
  await goOnline(max);
  const newMax = await until(() => tvEval((n) => shellMod().then((m) => m.shell.host.list.find((p) => p.name === n && p.connected)?.id), max.name), 15_000);
  check("plain-dropped player whose seat went comes back as a new seat (old path)", !!newMax && newMax !== oldMax, `${oldMax} -> ${newMax}`);
  max.id = newMax;
}

async function startFromVip(game) {
  const vipId = await tvVip();
  const vip = phones.find((p) => p.id === vipId);
  await vip.page.tap(`.lp-tile[data-id="${game}"]`);
  await vip.page.waitForSelector(".lp-start", { timeout: 5000 });
  await vip.page.tap(".lp-start");
  return until(() => tvEval(() => shellMod().then((m) => m.shell.host.config.game)).then((g) => g === game), 8000);
}
async function exitToLobby() {
  const vipId = await tvVip();
  const vip = phones.find((p) => p.id === vipId);
  await vip.page.tap(".sb-host");
  await vip.page.waitForSelector('[data-cmd="exit"]', { timeout: 3000 });
  await vip.page.tap('[data-cmd="exit"]');
  return until(() => tvEval(() => shellMod().then((m) => m.shell.host.config.game)).then((g) => g === "lobby"), 8000);
}

const cascadeShared = () => tv.evaluate(() => window.__shared);
const turnBanner = () => tv.evaluate(() => (document.querySelector(".cz-turn.show")?.textContent ?? "").trim());
const notes = () => tv.evaluate(() => window.__notes ?? []);

async function cascadeScenario() {
  // record what the TV sends phones and the notes it shows
  await tv.evaluate(async () => {
    const { shell } = await import("/src/shell/host-state.ts");
    const h = shell.host;
    if (!h.__patched) {
      const orig = h.setShared.bind(h);
      h.setShared = (d) => ((window.__shared = JSON.parse(JSON.stringify(d))), orig(d));
      h.__patched = true;
    }
    window.__notes = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains("cz-note")) window.__notes.push(n.textContent);
    }).observe(document.body, { subtree: true, childList: true });
  });
  check("Cascade starts from the VIP phone", await startFromVip("cascade"));
  const sh = await until(async () => {
    const s = await cascadeShared();
    return s?.seats?.length === 3 && s.turn >= 0 && s;
  }, 10_000);
  if (!check("Cascade dealt 3 human seats, no bots", sh && sh.seats.every((s) => !s.bot), JSON.stringify(sh?.seats?.map((s) => s.name)))) return;
  const nameAt = (i) => sh.seats[i].name;
  const phoneOf = (i) => phones.find((p) => p.name === nameAt(i));

  // --- the player whose turn it is goes away
  const s0 = sh.turn;
  const awayPh = phoneOf(s0);
  log(`Cascade: ${awayPh.name}'s turn; they switch apps`);
  const piecesBefore = sh.seats[s0].pieces;
  await hide(awayPh, { freeze: true });
  const banner = await until(async () => {
    const b = await turnBanner();
    return /Waiting for/.test(b) && b;
  }, 4000);
  check("Cascade: TV turn banner says 'Waiting for <name>'", banner && banner.includes(awayPh.name), banner);
  const seatAway = (await cascadeShared()).seats[s0];
  check("Cascade: the seat shows away (phones see it)", seatAway.away === true);
  // the timer is 10 s; a computer must never move for them; after it, the turn passes on (2 others present)
  const passed = await until(async () => {
    const s = await cascadeShared();
    return s && s.turn !== s0 && s.turn >= 0 && s;
  }, 14_000, 250);
  const notesNow = await notes();
  check("Cascade: away player's turn passes on after the timer (3 seats, 2 present)", !!passed && notesNow.some((n) => n.includes(`${awayPh.name}`) && n.includes("turn passed on")), JSON.stringify(notesNow));
  check("Cascade: no move was played for the away player (pieces unchanged)", passed && passed.seats[s0].pieces === piecesBefore, `${piecesBefore} -> ${passed?.seats[s0].pieces}`);
  // the two present players run out their timers (the timeout plays at their cursor: not a computer for an away seat)
  log("Cascade: waiting a full lap of the other two players' timers…");
  const lap = await until(async () => {
    const s = await cascadeShared();
    return s && s.turn === s0 && s;
  }, 30_000, 250);
  // back at the away seat: still nobody plays for them
  if (lap) {
    await sleep(1500);
    const s = await cascadeShared();
    check("Cascade: on the away player's next turn, still no move for them", s.seats[s0].pieces === piecesBefore && /Waiting for/.test(await turnBanner()), `pieces ${s.seats[s0].pieces}`);
  }
  // --- back: the turn is theirs (fresh timer) and they can play
  await show(awayPh);
  await until(async () => (await tvPlayer(awayPh.id))?.away === false, 4000);
  const myTurn = await until(async () => {
    const s = await cascadeShared();
    return s.turn === s0 && s;
  }, 40_000, 250);
  if (myTurn) {
    await sleep(400);
    const b2 = await turnBanner();
    check("Cascade back: banner shows '<name>'s turn' again", b2.includes(awayPh.name) && !/Waiting/.test(b2), b2);
    const before = (await cascadeShared()).seats[s0].pieces;
    // the cursor starts on the middle cell, which a timed-out player may own by now: step it with the stick
    // (one push = one cell) until the TV takes the piece
    const nRec = records.length;
    let after = null;
    const tried = [];
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [-1, 0], [0, -1], [0, -1]]) {
      if (dx || dy) await stickPush(awayPh, dx, dy);
      tried.push(`${dx},${dy}`);
      await placeFromPhone(awayPh);
      // a placed piece plays out first (turn -1), and the counts update when it is done
      after = await until(async () => {
        const s = await cascadeShared();
        return (s.turn === -1 || s.seats[s0].pieces > before) && s;
      }, 1200);
      if (after) {
        after = await until(async () => {
          const s = await cascadeShared();
          return s.seats[s0].pieces > before && s;
        }, 5000);
        break;
      }
    }
    const sent = records.slice(nRec).filter((r) => r.ev === "phone" && r.id === awayPh.id && r.m?.t === "msg").map((r) => r.m.d.type);
    check("Cascade back: the player's own phone places a piece on its turn (control restored)", after && after.seats[s0].pieces > before, `pushes ${tried.join(" ")}; sent ${sent.join(",")}; pieces ${before} -> ${after?.seats[s0].pieces}`);
  } else check("Cascade back: their turn came round", false);

  // --- control: a plain drop on their turn -> the computer plays for them after ~3 s (old path)
  const prevTurn = (await cascadeShared()).turn;
  const t = await until(async () => {
    const s = await cascadeShared();
    return s && s.turn >= 0 && s.turn !== prevTurn && s.phase === "play" && s; // a fresh turn: the full 10 s ahead
  }, 15_000, 100);
  if (t) {
    const ph = phoneOf(t.turn);
    const before = t.seats[t.turn].pieces;
    log(`Cascade: ${ph.name} drops (no away) on their turn`);
    const ti = t.turn;
    const at = Date.now();
    await goOffline(ph);
    const moved = await until(async () => {
      const s = await cascadeShared();
      return s.seats[ti].pieces > before && s;
    }, 9000, 200);
    // the turn timer is 10 s, so a move well inside that is the computer (away-wait 3 s + its cursor walk)
    check("Cascade plain drop: the computer plays for the dropped player (old path)", !!moved && Date.now() - at < 8000, `${((Date.now() - at) / 1000).toFixed(1)} s after the drop`);
    await goOnline(ph);
    await until(async () => (await tvPlayer(ph.id))?.connected, 10_000);
  }

  // --- 2 present seats needed: with 2 of 3 away the turn waits, it never passes
  const u = await until(async () => {
    const s = await cascadeShared();
    return s && s.turn >= 0 && s.phase === "play" && s;
  }, 15_000);
  if (u && u.phase === "play") {
    const a = phoneOf(u.turn);
    const other = phones.find((p) => p !== a && sh.seats.some((x) => x.name === p.name) && u.seats.find((x) => x.name === p.name)?.alive);
    await hide(other);
    await hide(a);
    log(`Cascade: ${a.name} (turn) and ${other.name} both away: only one present`);
    await sleep(13_000);
    const s = await cascadeShared();
    check("Cascade: with only one other present, the away player's turn is held (no skip, no computer)", s.turn === u.turn && s.seats[u.turn].pieces === u.seats[u.turn].pieces, `turn ${u.turn}->${s.turn}`);
    await show(a);
    await show(other);
  }
}

/** One short push of the controller's stick (CDP touch drag), released before it starts repeating. */
async function stickPush(ph, dx, dy) {
  const r = await ph.page.evaluate(() => {
    const r = document.querySelector(".gp-stick")?.getBoundingClientRect();
    return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!r) return false;
  await ph.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y, id: 5 }] });
  for (let i = 1; i <= 4; i++) {
    await ph.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r.x + dx * i * 15, y: r.y + dy * i * 15, id: 5 }] });
    await sleep(20);
  }
  await sleep(60);
  await ph.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(150);
  return true;
}

/** A real touch (CDP) on the controller's Place button. */
async function placeFromPhone(ph) {
  const r = await ph.page.evaluate(() => {
    const b = document.querySelector('.gp-btn[data-id="place"]');
    const r = b?.getBoundingClientRect();
    return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  if (!r) return false;
  await ph.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y, id: 7 }] });
  await sleep(80);
  await ph.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return true;
}

async function hammerScenario() {
  check("Rotor Brawl starts from the VIP phone", await startFromVip("hammer"));
  const rotor = () => tv.evaluate(() => {
    const r = window.__rotor;
    if (!r) return null;
    return { phase: r.phase(), seats: [...r.seats.values()].filter((s) => s.human).map((s) => ({ id: s.id, name: s.name, idle: s.idle, auto: !!s.auto, alive: !!s.m?.alive })) };
  });
  const [ivy, ali, max] = phones;
  // Ivy away (app switch, frozen), Ali stays but idle, Max drops (no away)
  await until(async () => (await rotor())?.phase === "pick", 10_000);
  await hide(ivy, { freeze: true });
  const fight = await until(async () => (await rotor())?.phase === "fight", 20_000, 100);
  if (!check("Rotor Brawl reaches the fight", fight)) return;
  await goOffline(max); // at the start of the fight, so his seat (drop grace) outlasts the 8 s idle limit
  log("Rotor Brawl: fight; waiting past the 8 s idle limit");
  let seen = { ivyAuto: false, aliAuto: false, maxAuto: false, ivyIdle: 0 };
  const end = Date.now() + 12_000;
  while (Date.now() < end) {
    const r = await rotor();
    if (r?.phase !== "fight") break;
    for (const s of r.seats) {
      if (s.id === ivy.id) (seen.ivyAuto ||= s.auto), (seen.ivyIdle = Math.max(seen.ivyIdle, s.idle));
      if (s.id === ali.id) seen.aliAuto ||= s.auto;
      if (s.id === max.id) seen.maxAuto ||= s.auto;
    }
    await sleep(250);
  }
  check("Rotor Brawl: no autopilot for the away player, even idle > 8 s", !seen.ivyAuto && seen.ivyIdle > 8, `idle ${seen.ivyIdle.toFixed(1)} s`);
  check("Rotor Brawl control: an idle player who is not away gets the autopilot", seen.aliAuto);
  check("Rotor Brawl control: a dropped (not away) player gets the autopilot", seen.maxAuto);
  // back: Ivy comes back and moves the stick -> autopilot stays off, input flows
  await show(ivy);
  await until(async () => (await tvPlayer(ivy.id))?.away === false, 4000);
  const box = await ivy.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  await ivy.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.w * 0.25, y: box.h * 0.6, id: 1 }] });
  for (let i = 1; i <= 8; i++) {
    await ivy.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: box.w * 0.25 + i * 8, y: box.h * 0.6 - i * 5, id: 1 }] });
    await sleep(60);
  }
  const inp = await until(async () => (await tvPlayer(ivy.id))?.input, 3000);
  await ivy.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  check("Rotor Brawl back: the phone's stick input reaches the TV again", !!inp, JSON.stringify(inp));
  await goOnline(max);
  // his seat may have gone with the drop grace: then he is back as a new seat
  max.id = await until(() => tvEval((n) => shellMod().then((m) => m.shell.host.list.find((p) => p.name === n && p.connected)?.id), max.name), 15_000);
}

async function expiryScenario() {
  if (REAL) return log("expiry: skipped with --real-grace (10 min)");
  const [ivy, ali] = phones;
  log(`expiry: ${ali.name} away (socket open) and ${ivy.name} away + offline, both longer than awayGraceMs (${AWAY_GRACE / 1000} s)`);
  await hide(ali);
  await hide(ivy, { freeze: true });
  await until(async () => (await tvPlayer(ivy.id))?.away === true, 3000);
  await goOffline(ivy);
  await until(async () => (await tvPlayer(ali.id))?.away === true, 3000);
  const oldIvy = ivy.id;
  await sleep(AWAY_GRACE + 2000);
  check("away limit: the seat goes after awayGraceMs even with the socket open", !(await seatOf(ali)));
  check("away limit: the seat of an away + dropped phone goes after awayGraceMs", !(await seatOf(ivy)));
  // the dropped phone comes back: its token is dead, so it joins again as a new seat (no message)
  await goOnline(ivy);
  await show(ivy);
  const newIvy = await until(() => tvEval((n) => shellMod().then((m) => m.shell.host.list.find((p) => p.name === n && p.connected)?.id), ivy.name), 10_000);
  const ivyForm = await ivy.page.evaluate(() => document.getElementById("join-form")?.hidden === false && document.getElementById("join-error")?.textContent);
  log(`expiry: ${ivy.name} (dropped while away) on coming back: ${newIvy ? `joined again as a new seat ${oldIvy} -> ${newIvy}` : `join form: ${JSON.stringify(ivyForm)}`}`);
  check("away limit, dropped phone back: it gets into the room again (a new seat; it is not told its old seat went)", !!newIvy && newIvy !== oldIvy);
  if (newIvy) ivy.id = newIvy;
  await show(ali);
  await sleep(1500);
  const txt = await ali.page.evaluate(() => (document.getElementById("join-form")?.hidden === false ? document.getElementById("join-error")?.textContent : null));
  log(`expiry: what ${ali.name} sees on coming back:`, JSON.stringify(txt));
  check("away limit: the phone is back on the join form, told its seat went (not 'You left')", !!txt && !/You left/.test(txt), JSON.stringify(txt));
}

async function realGraceScenario() {
  const ivy = phones[0];
  await hide(ivy);
  await goOffline(ivy);
  log("real grace: waiting 65 s with the phone away and dropped…");
  await sleep(65_000);
  check("real limits: away + dropped seat is still there after 65 s (> 60 s drop grace)", !!(await seatOf(ivy)));
  await goOnline(ivy);
  await show(ivy);
  check("real limits: the phone gets its seat back", await until(async () => (await tvPlayer(ivy.id))?.connected, 10_000));
}

// ------------------------------------------------------------------------------------------- main
async function main() {
  log(`relay :${RELAY_PORT} (drop grace ${PLAYER_GRACE} ms, away limit ${AWAY_GRACE} ms), vite :${WEB_PORT}`);
  await Promise.all([startRelay(), startVite()]);
  for (const how of [{ channel: "chrome" }, { channel: "msedge" }, {}]) {
    try {
      browser = await chromium.launch({ ...how, headless: !HEADED, args: ["--autoplay-policy=user-gesture-required"] });
      break;
    } catch {}
  }
  if (!browser) throw new Error("no Chrome/Edge found");
  await probeEmulation();

  const tvCtx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  tv = await tvCtx.newPage();
  tv.on("pageerror", (e) => log("TV page error:", e.message));
  await tv.goto(`${WEB}/?timer=10&bots=0`);
  room = await until(() => tvEval(() => shellMod().then((m) => m.shell.host.code || null)), 20_000);
  check("TV page made a room on OUR relay", !!room && records.some((r) => r.room === room && r.ev === "host-open"), room);

  for (const spec of PHONES) phones.push(await openPhone(spec));
  check("3 phones joined", phones.every((p) => p.id), phones.map((p) => `${p.name}=${p.id}`).join(" "));

  if (ONLY.has("lobby")) await lobbyScenario();
  if (ONLY.has("cascade")) {
    await cascadeScenario();
    check("back to the lobby from the VIP's host sheet", await exitToLobby());
  }
  if (ONLY.has("hammer")) {
    await hammerScenario();
    // back in the lobby with a phone away: its seat must still read as away
    const max = phones[2];
    await hide(max);
    await until(async () => (await tvPlayer(max.id))?.away === true, 3000);
    await exitToLobby();
    await sleep(500);
    const cls = await tv.evaluate((n) => [...document.querySelectorAll(".seat")].find((e) => e.textContent.includes(n))?.className, max.name);
    check("TV lobby, freshly mounted with a phone away: the seat has the away class", /(^|\s)away(\s|$)/.test(cls ?? ""), JSON.stringify(cls));
    await show(max);
  }
  if (REAL) await realGraceScenario();
  if (ONLY.has("expiry")) await expiryScenario();
}

let code = 0;
try {
  await main();
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  await browser?.close().catch(() => {});
  for (const c of children) c.kill();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  for (const r of failed) console.log(`  FAIL ${r.name} ${r.detail}`);
  process.exit(code || (failed.length ? 1 : 0));
}
