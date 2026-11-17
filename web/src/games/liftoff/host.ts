// Lift-off on the TV: seats and thrusters, the fixed-step loop, the tunnel and the panels. The rules live in rules.ts.
//
// Seats: players first, then computer pilots up to the "bots" setting (8 seats in all). A run's thrusters are fixed
// when its 3-2-1 starts. Mid-run, a newcomer takes over a bot's thruster at once (or the right engine of a lone
// pilot); a player who leaves hands their thruster to someone waiting, else to a new bot. Extra bots go at the result.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { createHud } from "./hud.ts";
import { CREW } from "./look.ts";
import { BASE, COUNT_STEPS, DIFFICULTIES, Liftoff, MAX_SEATS, RUN_OPTIONS, STEP, type LiftoffEvent, type Options } from "./rules.ts";
import type { LiftoffGame, LiftoffOwn } from "./shared.ts";
import { TunnelView } from "./view.ts";
import "./liftoff.css";

const optionsOf = (s: Settings): Options => ({
  runs: (RUN_OPTIONS as readonly number[]).includes(Number(s.runs)) ? Number(s.runs) : 3,
  difficulty: String(s.difficulty) in DIFFICULTIES ? (String(s.difficulty) as Options["difficulty"]) : "normal",
});

// the crew's best per course difficulty, kept for the session (and in this browser when it can)
const RECORD_KEY = "thumbtide.liftoff.best";
const records: Record<string, number> = (() => {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
})();
const saveRecords = () => {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify(records));
  } catch {
    /* private mode: the session keeps it */
  }
};

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<LiftoffGame>;
  void loadFonts();

  ctx.root.innerHTML = `<div class="lft"></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const game = new Liftoff(optionsOf(ctx.settings()));
  const bots = createBots(game);
  const view = new TunnelView(wrap);
  const hud = createHud(wrap);
  if (import.meta.env.DEV) (window as unknown as { __liftoff: unknown }).__liftoff = { game, view, bots };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, crew: game.thrusters.length, run: game.run, height: Math.floor(game.height) }));
  let paused = false;

  const layout = () => {
    const W = wrap.clientWidth || window.innerWidth;
    const H = wrap.clientHeight || window.innerHeight;
    view.layout(W, H);
    hud.layout(W, H, view.column);
  };
  layout();
  window.addEventListener("resize", layout);

  // ------------------------------------------------------------ seats
  const running = () => game.phase === "count" || game.phase === "fly";
  const humans = () => [...game.seats.values()].filter((s) => !s.bot).length;
  const wantedBots = () => Math.max(0, Math.min(MAX_SEATS - humans(), Number(ctx.settings().bots) || 0));
  /** Bots to the setting, but never mid-run (the thrusters are fixed for the run). */
  const fillBots = () => {
    if (!running()) bots.setCount(wantedBots());
  };
  const waiting = () => [...game.seats.values()].filter((s) => !s.bot && !game.flying(s.id));

  /** Seats a player. Mid-run they take over a bot's thruster, or a lone pilot's right engine, at once. */
  const seat = (p: HostPlayer<LiftoffGame>) => {
    if (game.seats.has(p.id)) return;
    if (running()) {
      const bot = bots.yield(true);
      if (bot) {
        game.removeSeat(bot); // its thrusters wait for the newcomer
        game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
        game.handOver("", p.id);
        return;
      }
      if (game.seats.size >= MAX_SEATS) return;
      game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
      const solo = game.thrusters.find((t) => t.key === "r");
      if (solo) game.handOver(solo.owner, p.id, solo);
      else game.admitLate();
      return;
    }
    // between runs: a bot steps aside if every seat is taken
    if (game.seats.size >= MAX_SEATS) {
      const bot = bots.yield();
      if (bot) game.removeSeat(bot);
    }
    game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
  };

  /** Thrusters left without a holder go to a player who is waiting, else to a new bot. */
  const adopt = () => {
    while (game.orphans().length) {
      const w = waiting()[0];
      const id = w ? w.id : bots.addOne();
      if (!id || !game.handOver("", id, game.orphans()[0])) break;
    }
  };

  for (const p of host.players.values()) seat(p);
  bots.setCount(wantedBots());
  game.record = records[game.opts.difficulty] ?? 0;
  game.startMatch();

  // ------------------------------------------------------------ what the phones show
  const sentOwn = new Map<string, string>();
  let sentShared = "";
  let sharedAt = 0;
  function publish(force = true) {
    const shared = {
      phase: game.phase,
      run: Math.max(1, game.run),
      runs: game.opts.runs,
      height: Math.floor(game.rocket.alive && running() ? game.height : game.phase === "match" ? game.matchBest : game.best),
      best: game.matchBest,
    };
    const sk = JSON.stringify(shared);
    if (sk !== sentShared && (force || performance.now() - sharedAt > 300)) {
      sentShared = sk;
      sharedAt = performance.now();
      host.setShared(shared);
    }
    if (!force) return;
    const spots = game.thrusters.map((t) => t.d / (BASE / 2));
    for (const p of host.players.values()) {
      const s = game.seats.get(p.id);
      const mine = game.thrusters.flatMap((t, i) => (t.owner === p.id ? [i] : []));
      const own: LiftoffOwn = s
        ? {
            name: s.name,
            color: CREW[s.slot % CREW.length]!,
            state: mine.length ? "fly" : "next",
            mode: mine.length === 2 ? "two" : "one",
            spots,
            mine,
          }
        : { name: p.name, color: "#8c97b3", state: "watch", mode: "one", spots, mine: [] };
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
      const fresh = game.phase !== "match" && !humans();
      seat(p);
      if (fresh) restart();
      else fillBots();
      publish();
    }),
    host.on("rejoin", (p) => {
      seat(p);
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", (p) => game.setInput(p.id, false, false)),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      if (running()) adopt();
      else {
        // a seat came free: hand it to someone watching
        for (const w of host.players.values()) if (!game.seats.has(w.id) && w.connected) seat(w);
        fillBots();
      }
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
  const flyingHumans = () => [...host.players.values()].filter((p) => game.flying(p.id));
  function handle(e: LiftoffEvent, now: number) {
    switch (e.type) {
      case "phase":
        if (e.phase === "count") {
          view.clear();
          hud.clear();
          game.record = records[game.opts.difficulty] ?? 0;
        }
        if (e.phase === "fly") {
          hud.clear();
          for (const p of flyingHumans()) host.send(p.id, { type: "go" });
        }
        if (e.phase === "match") hud.match(game);
        if (e.phase === "wait") hud.wait();
        if (e.phase === "result") fillBots();
        publish();
        break;
      case "crash":
        view.crash(game, e, now);
        hud.result(game, e.height, e.best, e.lost);
        for (const p of flyingHumans()) host.send(p.id, { type: "crash" });
        if (e.best) {
          records[game.opts.difficulty] = e.height;
          saveRecords();
        }
        break;
      case "crew":
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
      }
      for (const e of game.drainEvents()) handle(e, now);
      if (game.phase === "count") hud.count(Math.max(1, Math.ceil((COUNT_STEPS - game.t) / 60)), game.run, game.opts.runs);
      if (game.phase === "fly") publish(false);
    }
    view.frame(game, paused ? 1 : acc / STEP, now, paused);
    hud.update(game, waiting().map((s) => s.name));
  };
  raf = requestAnimationFrame(frame);

  function restart() {
    for (const p of host.players.values()) seat(p);
    bots.setCount(0);
    bots.setCount(wantedBots());
    game.record = records[game.opts.difficulty] ?? 0;
    game.startMatch();
    view.clear();
    hud.clear();
    for (const e of game.drainEvents()) handle(e, performance.now());
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

