// Blast Party on the TV: seats, the fixed-step loop, the arena and the scoreboard. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { ARENAS } from "./arenas.ts";
import { createBots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { createHud } from "./hud.ts";
import { TEAM_NAMES, inkOf } from "./look.ts";
import { COUNT_STEPS, MAX_SEATS, STEP, Blast, type BlastEvent, type Options, type PowerKind } from "./rules.ts";
import type { BlastGame, BlastOwn } from "./shared.ts";
import { ArenaView } from "./view.ts";
import "./blast.css";

const optionsOf = (s: Settings): Options => ({
  mode: s.mode === "team" ? "team" : "ffa",
  wins: Number(s.wins) || 3,
  arena: String(s.arena) in ARENAS ? (String(s.arena) as Options["arena"]) : "rotate",
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<BlastGame>;

  ctx.root.innerHTML = `<div class="blt"><div class="blt-stage"></div></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const stage = wrap.querySelector(".blt-stage") as HTMLElement;
  const game = new Blast(optionsOf(ctx.settings()));
  const bots = createBots(game);
  const view = new ArenaView(stage);
  const hud = createHud(stage, view.el, isBot);
  let disposed = false;
  void loadFonts().then(() => {
    if (!disposed) view.fontsReady();
  });
  if (import.meta.env.DEV) (window as unknown as { __blast: unknown }).__blast = { game, view, bots };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, fighters: game.seats.size, round: game.round, bombs: game.bombs.length }));
  let paused = false;

  // ------------------------------------------------------------ layout: the scoreboard on top, the arena under it
  const layout = () => {
    const W = wrap.clientWidth || window.innerWidth;
    const H = wrap.clientHeight || window.innerHeight;
    const pad = Math.round(H * 0.022);
    const barH = Math.round(H * 0.135);
    hud.el.style.height = `${barH}px`;
    const top = barH + pad;
    view.layout(W, H, W / 2, top + (H - top - pad) / 2, W - pad * 2, H - top - pad);
  };
  layout();
  window.addEventListener("resize", layout);

  // ------------------------------------------------------------ seats
  const humans = () => [...game.seats.values()].filter((s) => !isBot(s.id)).length;
  const wantedBots = () => Math.min(MAX_SEATS - humans(), Math.max(Number(ctx.settings().bots) || 0, 2 - humans()));
  // during a round bots are only added: taking one away mid-round could end it. Extras go at the round result.
  const fillBots = () => bots.setCount(game.phase === "count" || game.phase === "play" ? Math.max(wantedBots(), bots.count) : wantedBots());
  const join = (p: HostPlayer<BlastGame>) => {
    if (game.seats.has(p.id)) return;
    // a bot steps aside if every seat is taken
    if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS) && bots.yieldOne()) game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
  };
  for (const p of host.players.values()) join(p);
  fillBots();
  game.startMatch();

  const sentOwn = new Map<string, string>();
  const teamWho = (t: number | null) => (t === null ? null : `${TEAM_NAMES[t]} team`);
  const nameOf = (id: string | null) => (id ? game.seats.get(id)?.name ?? null : null);
  const powersOf = (id: string): PowerKind[] => {
    const s = game.seats.get(id);
    if (!s || !s.alive) return [];
    const out: PowerKind[] = [];
    if (s.pw && s.pwT > 0) out.push(s.pw);
    if (s.speedT > 0) out.push("speed");
    if (s.shield) out.push("shield");
    return out;
  };
  function publish() {
    const round = game.phase === "round";
    const match = game.phase === "match";
    host.setShared({
      phase: game.phase,
      round: game.round,
      target: game.opts.wins,
      mode: game.opts.mode,
      roundWinner: round ? (game.roundTeam !== null ? teamWho(game.roundTeam) : nameOf(game.roundWinner)) : null,
      winner: match ? (game.winTeam !== null ? teamWho(game.winTeam) : nameOf(game.winner)) : null,
      roundTeam: round ? game.roundTeam : null,
      winTeam: match ? game.winTeam : null,
    });
    for (const p of host.players.values()) {
      const s = game.seats.get(p.id);
      const quiet = game.phase === "match" || game.phase === "wait" || game.phase === "count";
      const own: BlastOwn = s
        ? {
            name: s.name,
            color: inkOf(s),
            state: !s.inRound && !quiet ? "next" : s.alive || quiet ? "in" : "out",
            wins: game.team ? game.teamWins[s.team] ?? 0 : s.wins,
            team: game.team ? s.team : -1,
            power: powersOf(p.id),
          }
        : { name: p.name, color: "#8a90a0", state: "watch", wins: 0, team: -1, power: [] };
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
    host.on("drop", (p) => game.setInput(p.id, 0, 0)),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      // a seat came free: hand it to someone who was watching, else back to a bot
      for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) join(w);
      fillBots();
      publish();
    }),
    host.on("input", (p, d) => {
      if (d && typeof d === "object") game.setInput(p.id, Number(d.x), Number(d.y));
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "bomb") game.throwBomb(p.id);
      else if (d.type === "punch") game.punch(p.id);
      else if (d.type === "jump") game.jump(p.id);
      else if (d.type === "again" && p.id === shell.vip && game.phase === "match") restart();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      fillBots();
      publish();
    }),
  ];

  // ------------------------------------------------------------ events
  const tell = (id: string, type: "go" | "out" | "hit" | "pick") => {
    if (host.players.has(id)) host.send(id, { type });
  };
  function handle(e: BlastEvent, now: number) {
    view.event(e, now);
    switch (e.type) {
      case "phase":
        if (e.phase === "count") {
          view.clear();
          for (const p of host.players.values()) if (game.seats.get(p.id)?.inRound) tell(p.id, "go");
        }
        if (e.phase === "match") hud.match(game);
        if (e.phase === "wait") hud.wait();
        publish();
        break;
      case "hit":
        if (e.power > 300) tell(e.id, "hit");
        break;
      case "fall":
        tell(e.id, "out");
        publish();
        break;
      case "pickup":
        tell(e.id, "pick");
        publish();
        break;
      case "powerEnd":
      case "stick":
      case "shield":
        publish();
        break;
      case "round": {
        fillBots();
        hud.roundResult(game, e.winner ? game.seats.get(e.winner) ?? null : null, e.team);
        publish();
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
      for (const e of game.drainEvents()) handle(e, now);
      if (game.phase === "count") hud.count(Math.max(1, Math.ceil((COUNT_STEPS - game.t) / 60)), game);
      else if (game.phase === "play") {
        if (game.t < 45) hud.go(game.round);
        else hud.clear();
      }
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
    for (const e of game.drainEvents()) handle(e, performance.now());
    publish();
  }

  return {
    dispose() {
      disposed = true;
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
