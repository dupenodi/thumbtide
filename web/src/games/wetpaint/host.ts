import type { Host, HostPlayer } from "@thumbtide/sdk";
import type { JuicyTheme } from "../kit/juicy.ts";
import { shell } from "../../shell/host-state.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { audio } from "../../shell/sound.ts";
import { createAudio, type Sfx } from "./audio.ts";
import { createBots, isBot } from "./bots.ts";
import { createFx } from "./fx.ts";
import { createHud } from "./hud.ts";
import { PaintView, type Quality } from "./paint/view.ts";
import { fpsOverride, frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isWebOS } from "../../shell/tv.ts";
import { gameById } from "../registry.ts";
import {
  PAINTS, POWERS, ROUND_SECONDS, TUNING, roundOverride,
  type HudRow, type ResultRow, type WetPaintGame, type WetPaintOwn,
} from "./shared.ts";
import { Sim, type SimEvent } from "./sim.ts";
import "./wetpaint.css";

const STEP = 1 / 60;
const FORMS = ["Arrangement", "Symphony", "Harmony", "Nocturne", "Study", "Quarrel", "Composition", "Variations"];
const STREAKS: [string, JuicyTheme, "s" | "m" | "l"][] = [
  ["Nice strokes!", "mint", "s"],
  ["Bold!", "sky", "m"],
  ["Brilliant!", "grape", "m"],
  ["MASTERPIECE!", "gold", "m"],
];

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The numbers a .pad file's tune block may set. Anything else there is a typo, so say so. */
const TUNABLE = ["speed", "accel", "turn"] as const;
function applyTune(tune: Record<string, number>) {
  for (const [k, v] of Object.entries(tune)) {
    if ((TUNABLE as readonly string[]).includes(k)) (TUNING as unknown as Record<string, number>)[k] = v;
    else console.warn(`wetpaint.pad: tune "${k}" isn't used (tunable: ${TUNABLE.join(", ")})`);
  }
}
const swatch = (slot: number) => `<i class="sw" style="--c:${PAINTS[slot]!.half}"></i>`;

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<WetPaintGame>;
  const params = new URLSearchParams(location.search);
  // TVs have phone-class graphics chips that also draw the TV's own menus: go easy on them
  const quality: Quality = params.get("quality") === "low" || (isWebOS && params.get("quality") !== "high") ? "low" : "high";
  const fps = fpsOverride() ?? (isWebOS ? 30 : 60); // 30fps on a TV; fps=60 lifts the cap, for tests at the target
  const minFrameMs = fps < 60 ? 1000 / fps - 4 : 0;
  const simOptions = (s: Settings) => ({
    roundLength: roundOverride() ?? (Number(s.round) || ROUND_SECONDS),
    powerups: s.powerups !== false,
    events: s.events !== false,
  });

  // movement feel comes from wetpaint.pad's tune block
  applyTune(gameById("wetpaint")?.controls?.tune ?? {});

  ctx.root.innerHTML = `<div class="wp"><div class="wp-stage"></div></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const sim = new Sim(simOptions(ctx.settings()));
  const view = new PaintView(wrap.querySelector(".wp-stage") as HTMLElement, sim, quality);
  if (fps < 60) view.targetMs = 1000 / fps;
  const offPerf = setPerfExtras(() => ({ quality, scale: view.resolution, phase: sim.phase, brushes: sim.brushes.size }));
  const fx = createFx(wrap, view);
  const hud = createHud(wrap, sim, view);
  const bots = createBots(sim);
  // dev only: poke at the game from the browser console
  if (import.meta.env.DEV) (window as unknown as { __wetpaint: unknown }).__wetpaint = { sim, view, bots };
  // sound: the TV page's shared engine, already on if anyone has pressed a key or clicked on the TV
  const sfx: Sfx | null = createAudio(audio());
  const wins = new Map<string, number>();
  const lastStreak = new Map<string, number>();
  let lastResults: ResultRow[] | undefined;
  let lastTitle: string | undefined;
  let paused = false;

  // ------------------------------------------------------------ players
  const ownFor = (slot: number): WetPaintOwn => ({
    slot,
    paint: PAINTS[slot]!.name,
    color: PAINTS[slot]!.half,
    light: PAINTS[slot]!.light,
  });
  const join = (p: HostPlayer<WetPaintGame>) => {
    // a bot steps aside if the brushes are all taken
    const b = sim.addBrush(p.id, p.name) ?? (bots.yieldOne() ? sim.addBrush(p.id, p.name) : null);
    if (b) host.setOwn(p.id, ownFor(b.slot));
    publish();
  };
  for (const p of host.players.values()) join(p);
  bots.setCount(Number(ctx.settings().bots) || 0);
  publish();

  function publish(results = lastResults, title = lastTitle) {
    lastResults = results;
    lastTitle = title;
    const watching = [...host.players.keys()].filter((id) => !sim.brushes.has(id));
    host.setShared({
      phase: sim.phase,
      round: sim.round,
      results: sim.phase === "end" ? results : undefined,
      title,
      watching,
      frenzy: sim.frenzy,
    });
  }

  const offs = [
    host.on("join", (p) => {
      join(p);
      const b = sim.brushes.get(p.id);
      if (b) hud.toast(`${swatch(b.slot)} <b>${esc(p.name)}</b> picked up a brush`);
    }),
    host.on("rejoin", (p) => {
      if (sim.brushes.has(p.id)) sim.setConnected(p.id, !p.away);
      else join(p);
    }),
    host.on("drop", (p) => sim.setConnected(p.id, false)),
    // phone on another app or locked: the brush stands still and keeps its place (no bot takes it)
    host.on("away", (p) => sim.setConnected(p.id, p.connected && !p.away)),
    host.on("leave", (p) => {
      sim.removeBrush(p.id);
      // a brush came free: hand it to someone who was watching, else back to a bot
      for (const w of host.players.values()) if (!sim.brushes.has(w.id) && w.connected) join(w);
      bots.setCount(Number(ctx.settings().bots) || 0);
      publish();
    }),
    host.on("input", (p, d) => {
      if (d && typeof d === "object") sim.setInput(p.id, Number(d.x), Number(d.y));
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object" || paused) return;
      if (d.type === "splat") sim.splat(p.id);
      else if (d.type === "dash") sim.dash(p.id);
      else if (d.type === "again" && p.id === shell.vip && sim.phase === "end") again();
    }),
    ctx.onSettings((s) => {
      sim.configure(simOptions(s));
      bots.setCount(Number(s.bots) || 0);
      publish();
    }),
  ];

  function freshCanvas() {
    view.reset();
    fx.clear();
    hud.gallery("", 0, null);
    lastResults = undefined;
    lastTitle = undefined;
  }

  function again() {
    for (const p of host.players.values()) if (!sim.brushes.has(p.id) && p.connected) join(p);
    sim.nextRound();
    freshCanvas();
    publish();
  }

  function finish() {
    const ranked = sim.standings();
    const winner = ranked[0];
    if (winner && sim.pct(winner.slot) > 0) wins.set(winner.id, (wins.get(winner.id) ?? 0) + 1);
    const rows: ResultRow[] = ranked.map((b) => ({ id: b.id, name: b.name, slot: b.slot, pct: sim.pct(b.slot), wins: wins.get(b.id) ?? 0 }));
    const form = FORMS[(sim.round - 1 + Math.floor(Math.random() * FORMS.length)) % FORMS.length]!;
    const colours = rows.slice(0, 2).map((r) => PAINTS[r.slot]!.name);
    const title = colours.length ? `${form} in ${colours.join(" and ")}, No. ${sim.round}` : `Untitled, No. ${sim.round}`;
    publish(rows, title);
    hud.banner("Brushes down!", 1600, "ink", "big");
    view.varnish();
    fx.clear();
    sfx?.end();
    const decider = shell.vip ? host.players.get(shell.vip)?.name : undefined;
    setTimeout(() => sim.phase === "end" && hud.gallery(title, sim.round, rows, decider), 1700);
  }

  // ------------------------------------------------------------ events → screen, sound, phones
  const brushOf = (id: string) => sim.brushes.get(id);
  const nameOf = (id: string) => esc(brushOf(id)?.name ?? "Someone");
  const slotOf = (id: string) => brushOf(id)?.slot ?? 0;
  const isPlayer = (id: string) => host.players.has(id);
  const tell = (id: string, msg: WetPaintGame["toController"]) => {
    if (isPlayer(id)) host.send(id, msg);
  };
  const cheer = (id: string, text: string, theme: JuicyTheme, size: "s" | "m" | "l" | "xl" = "m") => {
    const b = brushOf(id);
    if (b) fx.pop(b.x, b.z, text, theme, size, 9);
  };
  const paintColors = (slot: number) => [PAINTS[slot]!.light, PAINTS[slot]!.half, "#ffffff", PAINTS[slot]!.shade];

  function handle(e: SimEvent) {
    switch (e.type) {
      case "phase":
        if (e.phase === "play") {
          hud.banner("Paint!", 900, "gold", "go");
          sfx?.go();
          publish();
        } else if (e.phase === "end") finish();
        break;
      case "thrown":
        sfx?.threw();
        if (e.big) cheer(e.id, "BOMBS AWAY!", "fire", "m");
        break;
      case "splat": {
        sfx?.splat();
        fx.burst(e.x, e.z, paintColors(e.slot), e.big ? 40 : e.sky ? 10 : 22, e.big ? 1.8 : e.sky ? 0.6 : 1);
        for (const id of e.hits) tell(id, { type: "buzz", kind: "hit" });
        for (const id of e.blocked) {
          tell(id, { type: "buzz", kind: "blocked" });
          const b = brushOf(id);
          if (b) fx.pop(b.x, b.z, "BLOCKED!", "grape", "s", 9);
        }
        const n = e.hits.length;
        const [text, theme, size]: [string, JuicyTheme, "s" | "m" | "l" | "xl"] = e.big
          ? ["KABOOM!", "fire", "xl"]
          : n >= 4 ? ["PAINTSTORM!", "gold", "xl"]
          : n === 3 ? ["TRIPLE SPLAT!", "candy", "l"]
          : n === 2 ? ["DOUBLE SPLAT!", "candy", "l"]
          : n === 1 && !e.sky ? ["SPLAT!", "fire", "m"]
          : n === 1 ? ["SPLASH!", "candy", "s"]
          : ["", "gold", "s"];
        if (text) fx.pop(e.x, e.z, text, theme, size, 3);
        if (n) hud.toast(`${swatch(e.slot)} <b>${nameOf(e.id)}</b> splatted ${e.hits.map((h) => `${swatch(slotOf(h))} <b>${nameOf(h)}</b>`).join(", ")}`);
        break;
      }
      case "pickup": {
        sfx?.pickup(false);
        tell(e.id, { type: "buzz", kind: "pickup" });
        break;
      }
      case "power": {
        const info = POWERS[e.kind];
        sfx?.power(e.kind);
        fx.burst(e.x, e.z, [...fx.took(e.pid, e.kind), "#ffffff"], 30, 1.3);
        cheer(e.id, info.shout, info.theme, "l");
        tell(e.id, { type: "power", kind: e.kind });
        for (const v of e.victims) tell(v, { type: "buzz", kind: "dried" });
        hud.toast(`${swatch(slotOf(e.id))} <b>${nameOf(e.id)}</b> grabbed <b class="pw pw-${e.kind}">${info.name}</b>`);
        break;
      }
      case "power-spawn":
        if (!e.dropped) sfx?.spawn();
        break;
      case "power-gone":
        fx.gone(e.pid);
        break;
      case "bonk": {
        sfx?.bonk();
        const b = brushOf(e.target);
        if (b) fx.pop(b.x, b.z, "BONK!", "fire", "m", 9);
        tell(e.target, { type: "buzz", kind: "bonked" });
        hud.toast(`${swatch(slotOf(e.by))} <b>${nameOf(e.by)}</b> knocked over ${swatch(slotOf(e.target))} <b>${nameOf(e.target)}</b>`);
        break;
      }
      case "bounce": {
        sfx?.bonk();
        const b = brushOf(e.by);
        if (b) fx.pop(b.x, b.z, "BOING!", "grape", "m", 9);
        tell(e.by, { type: "buzz", kind: "bonked" });
        break;
      }
      case "event":
        if (e.kind === "shower") {
          hud.banner("POWER-UP SHOWER!", 1800, "candy", "event", "Candy incoming. Grab it!");
          sfx?.fanfare();
        } else if (e.kind === "wipe-warn") {
          hud.banner("TURPENTINE!", 1800, "ice", "event", "A rag's about to wipe a stripe clean");
          sfx?.alarm();
        } else if (e.kind === "wipe") {
          sfx?.wipe();
        } else if (e.kind === "frenzy") {
          hud.banner("FINAL FRENZY!", 2000, "fire", "event", "Endless paint, and everyone's faster");
          sfx?.fanfare();
          publish();
        }
        break;
      case "streak": {
        const now = performance.now();
        if (e.level < 2 || now - (lastStreak.get(e.id) ?? -1e9) < 7000) break;
        lastStreak.set(e.id, now);
        const [text, theme, size] = STREAKS[Math.min(STREAKS.length, e.level) - 1]!;
        cheer(e.id, text, theme, size);
        sfx?.cheer(e.level);
        break;
      }
      case "lead":
        cheer(e.id, "TAKES THE LEAD!", "gold", "m");
        hud.toast(`${swatch(slotOf(e.id))} <b>${nameOf(e.id)}</b> takes the lead`);
        break;
    }
  }

  // ------------------------------------------------------------ loop
  let last = performance.now();
  let acc = 0;
  let hudAcc = 0;
  let lastWhole = -1;
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (now - last < minFrameMs) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frameDrawn(now);
    let painted = 0;
    if (!paused) {
      acc += dt;
      while (acc >= STEP) {
        bots.step(STEP);
        sim.step(STEP);
        painted += sim.paintedThisStep;
        acc -= STEP;
      }
      const events = sim.drainEvents();
      view.onEvents(events);
      for (const e of events) handle(e);
    }
    sfx?.painting(painted, dt);

    // the count-in, then the last ten seconds
    const whole = Math.ceil(sim.phaseLeft);
    if (!paused && whole !== lastWhole) {
      lastWhole = whole;
      if (sim.phase === "intro") {
        if (whole <= 3 && whole >= 1) {
          hud.banner(String(whole), 800, "candy", "count");
          sfx?.tick();
        } else if (sim.round > 1 && sim.time < 0.3) {
          hud.banner(`Round ${sim.round}`, 1200, "gold", "title");
        }
      } else if (sim.phase === "play" && whole <= 10 && whole >= 1) {
        if (whole === 10) hud.banner("10 seconds!", 900, "fire", "hurry");
        sfx?.tick(true);
      }
    }

    view.render(paused ? 0 : dt);
    fx.update(sim, now);
    wrap.classList.toggle("frenzy", sim.frenzy && sim.phase === "play");
    hud.update();

    // phones get their numbers ~8 times a second, in one message for everyone
    hudAcc += dt;
    if (hudAcc >= 0.125) {
      hudAcc = 0;
      const p: Record<string, HudRow> = {};
      const r1 = (v: number) => Math.round(v * 10) / 10;
      const rank = new Map(sim.standings().map((b, i) => [b.id, i + 1]));
      for (const b of sim.brushes.values()) {
        if (isBot(b.id) || !isPlayer(b.id)) continue;
        p[b.id] = [
          Math.round(b.load * 100) / 100,
          Math.round((b.dashCd / 2.4) * 100) / 100,
          b.stunT > 0 ? 1 : 0,
          r1(sim.pct(b.slot)),
          r1(b.megaT),
          r1(b.turboT),
          r1(b.shieldT),
          r1(b.dryT),
          b.bomb ? 1 : 0,
          rank.get(b.id) ?? 0,
        ];
      }
      host.broadcast({ type: "hud", t: Math.max(0, Math.ceil(sim.phaseLeft)), p });
    }
  };
  raf = requestAnimationFrame(frame);


  return {
    dispose() {
      cancelAnimationFrame(raf);
      offPerf();
      sfx?.dispose();
      offs.forEach((o) => o());
      fx.dispose();
      hud.dispose();
      view.dispose();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart() {
      if (sim.phase === "end") return again();
      sim.reset();
      freshCanvas();
      publish();
    },
  };
};

export default mount;
