// Trails on the TV: seats, the fixed-step loop, the arena and the scoreboard. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { createHud } from "./hud.ts";
import { INKS } from "./look.ts";
import { COUNT_STEPS, MAX_SEATS, SPEEDS, STEP, TARGETS, Trails, type Options, type TrailsEvent } from "./rules.ts";
import type { TrailsGame, TrailsOwn } from "./shared.ts";
import { ArenaView } from "./view.ts";
import "./trails.css";

const optionsOf = (s: Settings): Options => ({
  target: String(s.target) in TARGETS ? (String(s.target) as Options["target"]) : "normal",
  speed: String(s.speed) in SPEEDS ? (String(s.speed) as Options["speed"]) : "normal",
  gaps: s.gaps !== false,
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<TrailsGame>;
  void loadFonts();

  ctx.root.innerHTML = `<div class="trl"><div class="trl-stage"></div></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const stage = wrap.querySelector(".trl-stage") as HTMLElement;
  const game = new Trails(optionsOf(ctx.settings()));
  const bots = createBots(game);
  const view = new ArenaView(stage);
  const hud = createHud(wrap, view.el, isBot);
  if (import.meta.env.DEV) (window as unknown as { __trails: unknown }).__trails = { game, view, bots };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, lines: game.seats.size, round: game.round }));
  let paused = false;

  // ------------------------------------------------------------ layout: arena on the left, scoreboard on the right
  const layout = () => {
    const W = wrap.clientWidth || window.innerWidth;
    const H = wrap.clientHeight || window.innerHeight;
    const pad = Math.round(Math.min(W, H) * 0.045);
    const boardW = Math.round(W * 0.215);
    view.layout(pad, pad, W - boardW - pad * 3, H - pad * 2, game);
    // the scoreboard lines up with the arena
    const top = parseFloat(view.el.style.top);
    hud.el.style.width = `${boardW}px`;
    hud.el.style.top = `${top}px`;
    hud.el.style.right = `${pad}px`;
    hud.el.style.bottom = `${top}px`;
  };
  layout();
  window.addEventListener("resize", layout);

  // ------------------------------------------------------------ seats
  const humans = () => [...game.seats.values()].filter((s) => !isBot(s.id)).length;
  const wantedBots = () => Math.min(MAX_SEATS - humans(), Math.max(Number(ctx.settings().bots) || 0, 2 - humans()));
  // during a round bots are only added: taking a line away mid-round could end it. Extra bots go at the round result.
  const fillBots = () => bots.setCount(game.phase === "count" || game.phase === "play" ? Math.max(wantedBots(), bots.count) : wantedBots());
  const join = (p: HostPlayer<TrailsGame>) => {
    if (game.seats.has(p.id)) return;
    // a bot steps aside if every seat is taken
    if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS) && bots.yieldOne()) game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
  };
  for (const p of host.players.values()) join(p);
  fillBots();
  game.startMatch();

  const sentOwn = new Map<string, string>();
  function publish() {
    host.setShared({
      phase: game.phase,
      round: game.round,
      winners: game.phase === "match" ? game.winners.map((id) => game.seats.get(id)?.name ?? "") : [],
    });
    for (const p of host.players.values()) {
      const s = game.seats.get(p.id);
      const own: TrailsOwn = s
        ? {
            name: s.name,
            color: INKS[s.slot]!,
            state: !s.inRound ? "next" : s.alive || game.phase === "count" || (game.phase === "round" && !s.out) ? "in" : "out",
          }
        : { name: p.name, color: "#8a90a0", state: "watch" };
      const k = JSON.stringify(own);
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
  }
  publish();

  const offs = [
    host.on("join", (p) => {
      // bots only so far (the TV opened straight into the game): start afresh with the newcomer
      const fresh = game.phase !== "match" && ![...game.seats.values()].some((s) => !isBot(s.id) && s.inRound);
      join(p);
      fillBots();
      if (fresh) restart();
      else game.admitLate();
      publish();
    }),
    host.on("rejoin", (p) => {
      join(p);
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", (p) => game.setInput(p.id, false, false)),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      // a seat came free: hand it to someone who was watching, else back to a bot
      for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) join(w);
      fillBots();
      publish();
    }),
    host.on("input", (p, d) => {
      if (d && typeof d === "object") game.setInput(p.id, !!d.l, !!d.r);
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "again" && p.id === shell.vip && game.phase === "match") restart();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      fillBots();
      publish();
    }),
  ];

  // ------------------------------------------------------------ events
  let redraw = false;
  function handle(e: TrailsEvent) {
    switch (e.type) {
      case "phase":
        if (e.phase === "count") {
          view.clear();
          for (const p of host.players.values()) if (game.seats.get(p.id)?.inRound) host.send(p.id, { type: "go" });
        }
        if (e.phase === "play" || e.phase === "count") hud.clear();
        if (e.phase === "match") hud.match(game);
        if (e.phase === "wait") hud.wait();
        publish();
        break;
      case "crash":
        view.burst(e.x, e.y, e.a, e.slot);
        redraw = true;
        if (host.players.has(e.id)) host.send(e.id, { type: "crash" });
        publish();
        break;
      case "round": {
        fillBots();
        const s = e.survivor ? game.seats.get(e.survivor) ?? null : null;
        hud.roundResult(game, s);
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ loop: 60 Hz fixed steps, drawn in between
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frameDrawn(now);
    if (!paused) {
      acc += dt;
      while (acc >= STEP) {
        bots.step();
        game.step();
        acc -= STEP;
      }
      view.sync(game);
      for (const e of game.drainEvents()) handle(e);
      if (redraw) {
        redraw = false;
        view.redraw(game);
      }
      if (game.phase === "count") hud.count(Math.max(1, Math.ceil((COUNT_STEPS - game.t) / 60)), game.round);
    }
    view.frame(game, paused ? 1 : acc / STEP, now);
    hud.update(game);
  };
  raf = requestAnimationFrame(frame);

  function restart() {
    for (const p of host.players.values()) join(p);
    bots.setCount(wantedBots());
    game.startMatch();
    view.clear();
    hud.clear();
    for (const e of game.drainEvents()) handle(e);
    publish();
  }

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", layout);
      offPerf();
      offs.forEach((o) => o());
      hud.dispose();
      wrap.remove();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart,
  };
};

export default mount;
