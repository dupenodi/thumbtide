// Boomtown on the TV: seats people and computer players, steps the rules and the bots, tells each phone what it may
// do (setShared for the table, setOwn for your own options) and draws the map. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { setPerfExtras } from "../../shell/perf.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { BOARD, Boomtown, CARDS, type BoomEvent, type CashLevel, type Options } from "./rules.ts";
import type { BoomGame, BoomOwn, BoomShared } from "./shared.ts";
import { createView } from "./view.ts";
import "./boomtown.css";

const TICK = 100;
const money = (n: number) => `$${n}`;

const optionsOf = (s: Settings): Partial<Options> => ({
  minutes: [20, 30, 45].includes(Number(s.minutes)) ? Number(s.minutes) : 30,
  cash: (["low", "normal", "high"].includes(String(s.cash)) ? String(s.cash) : "normal") as CashLevel,
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<BoomGame>;
  void loadFonts();
  const tune = gameById("boomtown")?.controls?.tune ?? {};

  const game = new Boomtown(optionsOf(ctx.settings()));
  const bots = createBots(game, Math.random, { think: tune["bot-think"] ?? 1500 });
  const view = createView(ctx.root);
  let paused = false;
  let notes: string[] = [];
  let log: string[] = [];

  const wantedBots = () => Math.max(0, Math.min(5, Number(ctx.settings().bots) || 0));
  game.wantBots = wantedBots();

  const name = (i: number) => game.players[i]?.name ?? "Someone";
  const plotName = (i: number) => BOARD[i]?.name ?? "";
  const note = (t: string) => {
    notes = [...notes.slice(-1), t];
    log = [...log.slice(-9), t];
  };
  const tell = (i: number, kind: string) => {
    const p = game.players[i];
    if (p && !p.bot && host.players.has(p.id)) host.send(p.id, { type: "buzz", kind });
  };

  // ------------------------------------------------------------------ what everyone sees, and what only you see
  function shared(): BoomShared {
    const card = game.card;
    return {
      phase: game.phase,
      turn: game.turn,
      round: game.round,
      players: game.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        bot: p.bot,
        away: !p.bot && host.players.get(p.id)?.connected === false,
        color: p.color,
        cash: p.cash,
        pos: p.pos,
        out: p.out,
        worth: game.worth(i),
        skip: p.skip,
      })),
      owner: game.owner.slice(),
      storeys: game.storeys.slice(),
      dice: [...game.dice] as [number, number],
      left: game.timer > 0 ? Math.round(game.timer) : 0,
      leftMax: game.timerMax,
      clock: game.final ? 0 : Math.ceil(game.leftMs() / 10000) * 10000,
      final: game.final,
      buying: game.buying,
      offer: game.offer ? { ...game.offer } : null,
      card: card ? { id: card.id, title: card.title, text: card.text } : null,
      notes: notes.slice(),
      log: log.slice(),
      winner: game.winner,
      why: game.why,
      watching: [...host.players.keys()].filter((id) => game.seat(id) < 0),
    };
  }

  function own(id: string): BoomOwn {
    const seat = game.seat(id);
    const mine = seat >= 0 && seat === game.turn && game.phase === "act";
    return {
      seat,
      buildable: mine ? game.buildable(seat) : [],
      tradable: mine && !game.tradeUsed ? game.tradable(seat) : [],
      canOffer: mine && !game.tradeUsed,
    };
  }

  let sentShared = "";
  const sentOwn = new Map<string, string>();
  function publish() {
    const s = shared();
    // the countdown alone does not need a resend: phones count down from the last value
    const k = JSON.stringify({ ...s, left: s.left > 0 });
    if (k !== sentShared) {
      sentShared = k;
      host.setShared(s);
    }
    for (const p of host.players.values()) {
      const o = own(p.id);
      const ok = JSON.stringify(o);
      if (sentOwn.get(p.id) === ok) continue;
      sentOwn.set(p.id, ok);
      host.setOwn(p.id, o);
    }
    view.render(s, vipName());
  }
  const vipName = () => (shell.vip ? host.players.get(shell.vip)?.name : undefined);

  function handle(e: BoomEvent) {
    switch (e.type) {
      case "turn":
        notes = [];
        tell(e.player, "turn");
        break;
      case "roll":
        view.roll(e.player, e.dice, e.from, e.steps);
        break;
      case "move":
        view.jump(e.player, e.from, e.to);
        note(`${name(e.player)} ${e.via === "ferry" ? "took the ferry" : "moved on"} to ${plotName(e.to)}`);
        break;
      case "payday":
        note(`${name(e.player)} passed the Harbour Gate: +${money(e.n)}`);
        break;
      case "buy":
        note(`${name(e.player)} bought ${plotName(e.plot)} for ${money(e.price)}`);
        view.sold(e.plot);
        break;
      case "pass":
        note(`${name(e.player)} passed on ${plotName(e.plot)}`);
        break;
      case "rent":
        note(`${name(e.from)} paid ${name(e.to)} ${money(e.n)} rent`);
        tell(e.from, "rent");
        tell(e.to, "paid");
        break;
      case "tax":
        note(`${name(e.player)} paid ${money(e.n)} at the Tax Office`);
        break;
      case "festival":
        note(`${name(e.player)} collected ${money(e.n)} at the festival`);
        break;
      case "strike":
        note(`${name(e.player)} will sit out the next turn`);
        break;
      case "card":
        note(`${name(e.player)} drew a rumour: ${CARDS.find((c) => c.id === e.card)?.title ?? ""}`);
        break;
      case "build":
        note(`${name(e.player)} built on ${plotName(e.plot)}`);
        break;
      case "sold-storeys":
        note(`${name(e.player)} sold ${e.n} ${e.n === 1 ? "storey" : "storeys"} to pay`);
        break;
      case "offer":
        note(`${name(e.offer.from)} offers ${plotName(e.offer.plot)} to ${name(e.offer.to)} for ${money(e.offer.price)}`);
        tell(e.offer.to, "offer");
        break;
      case "trade":
        note(e.accepted ? `${name(e.offer.to)} bought ${plotName(e.offer.plot)} from ${name(e.offer.from)}` : `${name(e.offer.to)} said no`);
        if (e.accepted) view.sold(e.offer.plot);
        break;
      case "bankrupt":
        note(`${name(e.player)} is out of the game`);
        tell(e.player, "out");
        break;
      case "final":
        note("Last lap: the match ends when this round is done");
        break;
      case "over":
        tell(e.winner, "win");
        break;
      default:
        break;
    }
  }

  function tick() {
    if (paused) return;
    bots.step(TICK);
    game.step(TICK);
    const ev = game.drainEvents();
    for (const e of ev) handle(e);
    if (ev.length) publish();
    else view.clock(game.timer, game.timerMax, game.leftMs(), game.final);
  }

  const seatPerson = (p: HostPlayer<BoomGame>) => game.join(p.id, p.name);

  function restart() {
    game.configure(optionsOf(ctx.settings()));
    game.wantBots = wantedBots();
    for (const p of host.players.values()) if (p.connected) seatPerson(p);
    notes = [];
    log = [];
    game.startMatch();
    view.reset();
    for (const e of game.drainEvents()) handle(e);
    publish();
  }

  // ------------------------------------------------------------------ the room
  const offs = [
    host.on("join", (p) => {
      // a match of computers only, or one only just begun: start afresh with the newcomer
      const fresh = game.humans().length === 0 || (game.turnNo <= 1 && game.elapsed < 15000);
      if (fresh) restart();
      else {
        seatPerson(p);
        for (const e of game.drainEvents()) handle(e);
        publish();
      }
    }),
    host.on("rejoin", (p) => {
      if (game.seat(p.id) < 0) seatPerson(p);
      game.setAway(p.id, false);
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", (p) => {
      game.setAway(p.id, true);
      publish();
    }),
    host.on("leave", (p) => {
      game.leave(p.id);
      sentOwn.delete(p.id);
      for (const w of host.players.values()) if (game.seat(w.id) < 0 && w.connected) seatPerson(w);
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      let err: string | null = null;
      if (paused) {
        if (d.type !== "again") host.send(p.id, { type: "refused", text: "The game is paused" });
        return;
      }
      switch (d.type) {
        case "roll":
          err = game.roll(p.id);
          break;
        case "buy":
          err = game.buy(p.id);
          break;
        case "pass":
          err = game.pass(p.id);
          break;
        case "build":
          err = game.build(p.id, Number(d.plot));
          break;
        case "offer":
          err = game.offerTrade(p.id, Number(d.plot), Number(d.to), Number(d.price));
          break;
        case "respond":
          err = game.respond(p.id, !!d.accept);
          break;
        case "end":
          err = game.endTurn(p.id);
          break;
        case "again":
          if (p.id === shell.vip && game.phase === "over") return restart();
          return;
        default:
          return;
      }
      if (err) host.send(p.id, { type: "refused", text: err });
      for (const e of game.drainEvents()) handle(e);
      publish();
    }),
    ctx.onSettings((s) => {
      game.configure(optionsOf(s));
      game.wantBots = wantedBots();
      publish();
    }),
    shell.onChange(() => view.render(shared(), vipName())),
  ];

  const offPerf = setPerfExtras(() => ({ phase: game.phase, round: game.round, seats: game.players.length }));
  if (import.meta.env.DEV) (window as unknown as { __boomtown: unknown }).__boomtown = { game, bots, view, restart, publish };

  restart();
  const timer = setInterval(tick, TICK);

  return {
    dispose() {
      clearInterval(timer);
      offPerf();
      offs.forEach((o) => o());
      view.dispose();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    restart,
  };
};

export default mount;
