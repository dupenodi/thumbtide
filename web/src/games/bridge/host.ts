// Bridge Panic on the TV: seats, the clock, the bots and the screens. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { BOT_NAMES, Bots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { SEAT_COLORS } from "./look.ts";
import { Bridge, DIFFICULTIES, MAX_SEATS, MIN_SEATS, type BridgeEvent, type Difficulty, type Options } from "./rules.ts";
import type { BridgeGame, BridgeOwn, BridgeShared, BuzzKind } from "./shared.ts";
import { createView } from "./view.ts";
import "./bridge.css";

/** The crew's best (sectors reached), kept for as long as this page lives. */
let crewBest = 0;

const optionsOf = (s: Settings): Options => ({
  difficulty: (DIFFICULTIES as readonly string[]).includes(String(s.difficulty)) ? (s.difficulty as Difficulty) : "normal",
  events: !(s.events === false || s.events === "false"),
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<BridgeGame>;
  void loadFonts();

  const game = new Bridge(optionsOf(ctx.settings()));
  const bots = new Bots(game);
  const view = createView(ctx.root);
  if (import.meta.env.DEV) (window as unknown as { __bridge: unknown }).__bridge = { game, bots, view };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, sector: game.sector, seats: game.seats.size }));
  let paused = false;
  let botSerial = 0;
  /** How long each human's phone has been off (ms). After AWAY_AFTER a computer player plays the seat. */
  const AWAY_AFTER = 8000;
  const offFor = new Map<string, number>();
  function watchPhones(dt: number) {
    for (const s of game.list()) {
      if (s.bot) continue;
      if (host.players.get(s.id)?.connected === false) {
        const t = (offFor.get(s.id) ?? 0) + dt;
        offFor.set(s.id, t);
        game.setAway(s.id, t >= AWAY_AFTER);
      } else if (offFor.delete(s.id) || s.away) game.setAway(s.id, false);
    }
  }

  // ------------------------------------------------------------ seats
  const humans = () => game.list().filter((s) => !isBot(s.id)).length;
  const wantedBots = () => {
    const h = humans();
    return Math.max(0, Math.min(MAX_SEATS - h, Math.max(MIN_SEATS - h, Number(ctx.settings().bots) || 0)));
  };
  const botSeats = () => game.list().filter((s) => isBot(s.id));
  const between = () => game.phase === "wait" || game.phase === "break" || game.phase === "end";

  function addBot() {
    const taken = new Set(game.list().map((s) => s.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Bot ${botSerial + 1}`;
    return game.addSeat(`bot-${botSerial++}`, name, true);
  }

  /** Seats everyone in the room, then brings the bots to the wanted count. Bots leave only between sectors. */
  function seatAll(trim = between()) {
    for (const p of host.players.values()) {
      if (game.seats.has(p.id)) continue;
      if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS)) {
        const spare = botSeats().pop();
        if (spare) {
          game.removeSeat(spare.id);
          game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
        }
      }
    }
    const want = wantedBots();
    let have = botSeats();
    while (have.length < want && game.seats.size < MAX_SEATS && addBot()) have = botSeats();
    if (trim) while (have.length > want) game.removeSeat(have.pop()!.id);
  }

  // ------------------------------------------------------------ what phones see
  const sentOwn = new Map<string, string>();
  let sentShared = "";

  function ownFor(p: HostPlayer<BridgeGame>): BridgeOwn {
    const s = game.seats.get(p.id);
    if (!s) return { name: p.name, color: "#9aa3ad", state: "watch", deal: 0, panel: [], order: null, done: 0 };
    return {
      name: s.name,
      color: SEAT_COLORS[s.slot % MAX_SEATS]!,
      state: "seated",
      deal: game.dealt,
      panel: s.panel.map((n) => {
        const c = game.controls.get(n)!;
        return { name: c.name, kind: c.kind, state: c.state, ...(c.opts ? { opts: [...c.opts] as [string, string] } : {}) };
      }),
      order: s.order ? { id: s.order.id, text: s.order.text, ttl: s.order.ttl, left: Math.max(0, Math.round(s.order.left)) } : null,
      done: s.done,
    };
  }

  function publish() {
    const shared: BridgeShared = {
      phase: game.phase,
      sector: game.sector,
      quota: game.quota,
      done: game.done,
      hull: Math.ceil(game.hull),
      event: game.phase === "play" && game.event ? game.event.kind : null,
      best: crewBest,
      reached: game.phase === "end" ? game.sector : 0,
      total: game.total,
    };
    const sk = JSON.stringify(shared);
    if (sk !== sentShared) {
      sentShared = sk;
      host.setShared(shared);
    }
    for (const p of host.players.values()) {
      const own = ownFor(p);
      // the bar runs on the phone: `left` changes every frame, so it is not part of the "did it change" key
      const k = JSON.stringify({ ...own, order: own.order && { ...own.order, left: 0 } });
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
  }

  const buzz = (id: string, kind: BuzzKind) => {
    if (host.players.has(id)) host.send(id, { type: "buzz", kind });
  };
  const buzzAll = (kind: BuzzKind) => {
    for (const p of host.players.values()) host.send(p.id, { type: "buzz", kind });
  };

  // ------------------------------------------------------------ events from the rules
  function handle(e: BridgeEvent) {
    if (e.type === "phase") {
      if (e.phase === "intro") seatAll();
      if (e.phase === "break") buzzAll("sector");
      if (e.phase === "end") {
        crewBest = Math.max(crewBest, game.sector);
        buzzAll("over");
      }
    } else if (e.type === "done") buzz(e.seat, "done");
    else if (e.type === "miss") {
      buzz(e.seat, "miss");
      view.shake();
    } else if (e.type === "wrong") view.shake();
    else if (e.type === "event" && e.kind === "swap") buzzAll("swap");
  }

  function drain() {
    const ev = game.drainEvents();
    if (!ev.length) return;
    for (const e of ev) handle(e);
    view.render(game, crewBest);
    publish();
  }

  // ------------------------------------------------------------ the room
  const offs = [
    host.on("join", (p) => {
      // nobody real is playing yet (a bots-only match, or a fresh table): start over with the newcomer
      const fresh = !game.list().some((s) => !isBot(s.id) && s.id !== p.id);
      if (fresh) return restart();
      seatAll();
      drain();
      publish();
    }),
    host.on("rejoin", (p) => {
      sentOwn.delete(p.id);
      seatAll();
      publish();
    }),
    host.on("leave", (p) => {
      game.removeSeat(p.id);
      sentOwn.delete(p.id);
      seatAll(); // a bot can take the place at once
      drain();
      view.render(game, crewBest);
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "act" && typeof d.ctl === "string" && typeof d.value === "number") {
        if (game.act(p.id, d.ctl, d.value) === "wrong") buzz(p.id, "wrong");
      } else if (d.type === "again" && p.id === shell.vip && game.phase === "end") return restart();
      drain();
      // a moved control is not an order event: publish the new panel state
      publish();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      seatAll(true); // the computer crew changes at once; extra bots leave, missing ones sit down
      drain();
      publish();
    }),
  ];

  // ------------------------------------------------------------ the clock
  let last = performance.now();
  let raf = 0;
  let sinceTick = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(250, now - last);
    last = now;
    frameDrawn(now);
    if (paused) return;
    watchPhones(dt);
    game.advance(dt);
    bots.step(dt);
    drain();
    sinceTick += dt;
    if (sinceTick >= 250) {
      sinceTick = 0;
      view.tick(game);
    }
  };

  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);

  function restart() {
    for (const s of botSeats()) game.removeSeat(s.id);
    for (const s of game.list()) if (!host.players.has(s.id)) game.removeSeat(s.id);
    seatAll();
    game.startMatch();
    sentOwn.clear();
    drain();
    view.render(game, crewBest);
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
      view.dispose();
    },
    pause() {
      paused = true;
      view.setPaused(true);
    },
    resume() {
      paused = false;
      last = performance.now();
      view.setPaused(false);
    },
    restart,
  };
};

export default mount;
