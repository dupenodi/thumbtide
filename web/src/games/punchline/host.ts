// Punchline on the TV: seats, the clock, the bots and the screens. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { BOT_NAMES, Bots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { SEAT_COLORS } from "./look.ts";
import { FINAL_ROUND, MAX_SEATS, MIN_SEATS, Punchline, TIMES, type Options, type PunchEvent } from "./rules.ts";
import type { PunchGame, PunchOwn } from "./shared.ts";
import { createView } from "./view.ts";
import "./punchline.css";

const optionsOf = (s: Settings): Options => ({
  time: (TIMES as readonly number[]).includes(Number(s.time)) ? Number(s.time) : 90,
  family: s.family === true || s.family === "true",
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<PunchGame>;
  void loadFonts();

  const game = new Punchline(optionsOf(ctx.settings()));
  const bots = new Bots(game);
  const view = createView(ctx.root);
  if (import.meta.env.DEV) (window as unknown as { __punchline: unknown }).__punchline = { game, bots, view };
  const offPerf = setPerfExtras(() => ({ phase: game.phase, round: game.round, seats: game.seats.size }));
  let paused = false;
  let botSerial = 0;

  // ------------------------------------------------------------ seats
  const humans = () => game.list().filter((s) => !isBot(s.id) && !s.left).length;
  const wantedBots = () => {
    const h = humans();
    return Math.max(0, Math.min(MAX_SEATS - h, Math.max(MIN_SEATS - h, Number(ctx.settings().bots) || 0)));
  };
  const botSeats = () => game.list().filter((s) => isBot(s.id));
  const between = () => game.phase === "intro" || game.phase === "wait" || game.phase === "end";

  function addBot() {
    const taken = new Set(game.list().map((s) => s.name.toLowerCase()));
    const name = BOT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Bot ${botSerial + 1}`;
    return game.addSeat(`bot-${botSerial++}`, name, true);
  }

  /**
   * Seats everyone in the room (when there is room), then brings the bots up or down to the wanted count. Between
   * rounds a bot gives up its seat to a waiting human; mid-round bots are only added (a bot that is answering stays).
   */
  function seatAll() {
    for (const p of host.players.values()) {
      if (game.seats.has(p.id)) continue;
      if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS) && between()) {
        const spare = botSeats().pop();
        if (spare) {
          game.seats.delete(spare.id);
          game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
        }
      }
    }
    const want = wantedBots();
    let have = botSeats().filter((s) => !s.left);
    while (have.length < want && game.seats.size < MAX_SEATS && addBot()) have = botSeats().filter((s) => !s.left);
    if (between()) {
      while (have.length > want) {
        const b = have.pop()!;
        game.seats.delete(b.id);
      }
    }
  }

  // ------------------------------------------------------------ what phones see
  const sentOwn = new Map<string, string>();
  let sentShared = "";

  function ownFor(p: HostPlayer<PunchGame>): PunchOwn {
    const s = game.seats.get(p.id);
    if (!s) return { name: p.name, color: "#9aa3ad", state: "watch", tasks: [], vote: null, place: null };
    const writing = game.phase === "write" && s.inRound;
    const vk = game.voteKey();
    let vote: PunchOwn["vote"] = null;
    if (vk) {
      const pair = game.current();
      const author = game.final ? false : !!pair?.authors.includes(s.id);
      const mine = game.final ? game.final.votes.get(s.id) : pair?.votes.get(s.id);
      vote = { key: vk, author, options: game.final ? game.options(s.id) : author ? [] : [0, 1], mine: mine ?? null };
    }
    return {
      name: s.name,
      color: SEAT_COLORS[s.slot % MAX_SEATS]!,
      state: s.inRound || between() ? "seated" : "next",
      tasks: writing ? game.tasks(s.id).map((t) => ({ key: t.key, prompt: t.prompt.text, sent: !!t.answer })) : [],
      vote,
      place: game.phase === "end" ? game.standings().findIndex((x) => x.id === s.id) + 1 : null,
    };
  }

  function publish() {
    const pair = game.current();
    const vk = game.voteKey();
    const shared = {
      phase: game.phase,
      round: game.round,
      final: game.round === FINAL_ROUND,
      vote: vk
        ? game.final
          ? { key: vk, prompt: game.final.prompt.text, answers: game.final.entries.map((e) => e.answer!.text) }
          : { key: vk, prompt: pair!.prompt.text, answers: pair!.answers.map((a) => a!.text) }
        : null,
      winners: game.phase === "end" ? game.winners().map((s) => s.name) : [],
    };
    const sk = JSON.stringify(shared);
    if (sk !== sentShared) {
      sentShared = sk;
      host.setShared(shared);
    }
    for (const p of host.players.values()) {
      const own = ownFor(p);
      const k = JSON.stringify(own);
      if (sentOwn.get(p.id) === k) continue;
      sentOwn.set(p.id, k);
      host.setOwn(p.id, own);
    }
  }

  const buzzAll = (kind: "write" | "vote" | "win", who: (id: string) => boolean = () => true) => {
    for (const p of host.players.values()) if (who(p.id)) host.send(p.id, { type: "buzz", kind });
  };

  // ------------------------------------------------------------ events from the rules
  function handle(e: PunchEvent) {
    if (e.type === "phase") {
      if (e.phase === "intro") seatAll();
      if (e.phase === "write") buzzAll("write", (id) => !!game.seats.get(id)?.inRound);
      if (e.phase === "vote") buzzAll("vote", (id) => game.canVote(id));
      if (e.phase === "end") buzzAll("win", (id) => game.winners().some((s) => s.id === id));
      view.render(game, performance.now());
    } else {
      view.progress(game);
    }
  }

  function drain() {
    const ev = game.drainEvents();
    if (!ev.length) return;
    for (const e of ev) handle(e);
    publish();
  }

  // ------------------------------------------------------------ the room
  const offs = [
    host.on("join", (p) => {
      // nobody real is playing yet (a bots-only match, or a fresh table): start over with the newcomer
      const fresh = game.phase !== "end" && !game.list().some((s) => !isBot(s.id) && !s.left && s.id !== p.id);
      if (fresh) return restart();
      seatAll();
      if (game.phase === "wait") game.ready();
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
      if (between()) seatAll();
      drain();
      view.render(game, performance.now());
      view.progress(game);
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "answer" && typeof d.key === "string") game.answer(p.id, d.key, d.text);
      else if (d.type === "vote" && typeof d.key === "string") game.vote(p.id, d.key, d.pick);
      else if (d.type === "again" && p.id === shell.vip && game.phase === "end") return restart();
      drain();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      if (between()) seatAll();
      if (game.phase === "wait") game.ready();
      drain();
      publish();
    }),
  ];

  // ------------------------------------------------------------ the clock
  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(250, now - last);
    last = now;
    frameDrawn(now);
    if (paused) return;
    game.advance(dt);
    bots.step();
    drain();
    const timed = game.phase === "write" || game.phase === "vote";
    view.clock(timed ? Math.ceil(game.left() / 1000) : null);
  };

  const onResize = () => view.resize();
  window.addEventListener("resize", onResize);

  function restart() {
    for (const s of botSeats()) game.seats.delete(s.id);
    for (const s of game.list()) if (s.left || !host.players.has(s.id)) game.seats.delete(s.id);
    seatAll();
    game.startMatch();
    drain();
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
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart,
  };
};

export default mount;
