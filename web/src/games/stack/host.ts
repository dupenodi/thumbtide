// Stack Attack on the TV: seats, the fixed-step loop, the table and the HUD. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { createHud } from "./hud.ts";
import { INKS } from "./look.ts";
import { COUNT_STEPS, MAX_SEATS, SPEEDS, STEP, Stack, WINS, type Move, type Options, type StackEvent } from "./rules.ts";
import type { StackGame, StackOwn } from "./shared.ts";
import { TableView } from "./view.ts";
import "./stack.css";

const MOVES = new Set<Move>(["left", "right", "rotate", "drop", "softOn", "softOff"]);

const optionsOf = (s: Settings): Options => ({
  wins: (WINS as readonly number[]).includes(Number(s.wins)) ? Number(s.wins) : 3,
  speed: String(s.speed) in SPEEDS ? (String(s.speed) as Options["speed"]) : "normal",
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<StackGame>;
  void loadFonts();

  ctx.root.innerHTML = `<div class="sta"></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const game = new Stack(optionsOf(ctx.settings()));
  const bots = createBots(game);
  const view = new TableView(wrap);
  const hud = createHud(wrap);
  if (import.meta.env.DEV) (window as unknown as { __stack: unknown }).__stack = { game, view, bots };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, wells: game.players().length, round: game.round, level: game.level }));
  let paused = false;

  const layout = (force = false) => {
    view.layout(game.players(), force);
    hud.place(view.band);
  };

  // ------------------------------------------------------------ seats
  const humans = () => game.live().filter((s) => !isBot(s.id)).length;
  const wantedBots = () => Math.max(0, Math.min(MAX_SEATS - humans(), Number(ctx.settings().bots) || 0));
  // during a round bots are only added; extra bots go at the round result
  const fillBots = () => bots.setCount(game.phase === "count" || game.phase === "play" ? Math.max(wantedBots(), bots.count) : wantedBots());
  const join = (p: HostPlayer<StackGame>) => {
    if (game.seats.has(p.id) && !game.seats.get(p.id)!.gone) return;
    if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS) && bots.yieldOne()) game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
  };
  for (const p of host.players.values()) join(p);
  fillBots();

  const sentOwn = new Map<string, string>();
  function publish() {
    host.setShared({
      phase: game.phase,
      round: game.round,
      target: game.opts.wins,
      solo: game.solo,
      winners: game.phase === "match" ? game.winners.map((id) => game.seats.get(id)?.name ?? "") : [],
    });
    for (const p of host.players.values()) {
      const s = game.seats.get(p.id);
      const own: StackOwn = s && !s.gone
        ? {
            name: s.name,
            color: INKS[s.slot]!,
            state: !s.inRound ? "next" : s.alive || game.phase === "count" || game.roundWinner === s.id ? "in" : "out",
            next: s.inRound && s.alive ? s.next : null,
            wins: s.wins,
          }
        : { name: p.name, color: "#8a8578", state: "watch", next: null, wins: 0 };
      const k = JSON.stringify(own);
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
  }

  const tell = (id: string, msg: StackGame["toController"]) => {
    if (host.players.has(id)) host.send(id, msg);
  };

  const offs = [
    host.on("join", (p) => {
      // bots only so far, or a solo run: start afresh with the newcomer
      const running = game.phase === "count" || game.phase === "play" || game.phase === "round";
      const fresh = game.phase !== "match" && (!game.live().some((s) => !isBot(s.id) && s.inRound) || (running && game.solo));
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
    host.on("drop", (p) => game.input(p.id, "softOff")),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      // a seat came free: hand it to someone who was watching, else back to a bot
      for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) join(w);
      fillBots();
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "move" && MOVES.has(d.m)) {
        if (!paused) game.input(p.id, d.m);
      } else if (d.type === "again" && p.id === shell.vip && game.phase === "match") restart();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      fillBots();
      publish();
    }),
  ];

  // ------------------------------------------------------------ events
  function handle(e: StackEvent) {
    switch (e.type) {
      case "phase":
        if (e.phase === "count") {
          layout();
          view.invalidate();
          for (const s of game.players()) tell(s.id, { type: "go" });
        }
        if (e.phase === "play" || e.phase === "count") hud.clear();
        if (e.phase === "match") hud.match(game);
        if (e.phase === "wait") {
          layout();
          hud.wait();
        }
        view.invalidate();
        publish();
        break;
      case "spawn":
        if (!isBot(e.id)) publish();
        break;
      case "lock":
        if (e.drop) tell(e.id, { type: "lock" });
        break;
      case "clear":
        view.tear(e.id, e.rows, e.cells);
        tell(e.id, { type: "clear", n: e.rows.length });
        break;
      case "crack":
        view.tear(e.id, e.rows, e.cells, true);
        break;
      case "attack":
        view.attack(e.from, e.to, e.n);
        tell(e.to, { type: "hit" });
        break;
      case "out":
        tell(e.id, { type: "out" });
        publish();
        break;
      case "round":
        fillBots();
        hud.roundResult(game);
        view.invalidate();
        publish();
        break;
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
        for (const e of game.drainEvents()) handle(e);
      }
      if (game.phase === "count") hud.count(Math.max(1, Math.ceil((COUNT_STEPS - game.t) / 60)), game);
    }
    view.sync(game, now);
    hud.update(game);
  };

  const onResize = () => layout(true);
  window.addEventListener("resize", onResize);

  function restart() {
    for (const p of host.players.values()) join(p);
    bots.setCount(wantedBots());
    game.startMatch();
    hud.clear();
    for (const e of game.drainEvents()) handle(e);
    publish();
  }
  restart();
  raf = requestAnimationFrame(frame);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      offPerf();
      offs.forEach((o) => o());
      hud.dispose();
      view.dispose();
      wrap.remove();
    },
    pause() {
      paused = true;
      for (const s of game.seats.values()) s.soft = false;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart,
  };
};

export default mount;
