// Spyline on the TV: seats people and computer players, steps the rules and the bots, tells each phone what it may
// see (the key only to the handlers) and draws the dossier table. The rules live in rules.ts.
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { setPerfExtras } from "../../shell/perf.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { ROUNDS, STOP, Spyline, TEAMS, type Options, type SpyEvent, type Team, type TurnEnd } from "./rules.ts";
import type { SpyGame, SpyOwn, SpyShared } from "./shared.ts";
import { createView } from "./view.ts";
import "./spyline.css";

const TICK = 100;

const optionsOf = (s: Settings): Options => ({
  rounds: (ROUNDS as readonly number[]).includes(Number(s.rounds)) ? Number(s.rounds) : 3,
  clueTime: [0, 90, 120].includes(Number(s.clueTime)) ? Number(s.clueTime) : 0,
  guessTime: [0, 60, 90].includes(Number(s.guessTime)) ? Number(s.guessTime) : 0,
});

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<SpyGame>;
  void loadFonts();
  const tune = gameById("spyline")?.controls?.tune ?? {};

  const game = new Spyline(optionsOf(ctx.settings()));
  const bots = createBots(game, Math.random, { think: tune["bot-think"] ?? 2600, look: tune["bot-look"] ?? 1000 });
  const view = createView(ctx.root);
  let paused = false;
  let ended: { team: Team; why: TurnEnd } | null = null;
  /** Clue errors per player, so a phone that reconnects still sees why its clue came back. */
  const errors = new Map<string, { text: string; n: number }>();

  const wantedBots = () => Math.max(0, Math.min(7, Number(ctx.settings().bots) || 0));
  game.wantBots = wantedBots();

  const seated = () => game.humans().length > 0;
  const seatPerson = (p: HostPlayer<SpyGame>) => {
    if (game.seat(p.id)) return true;
    return !!game.addSeat(p.id, p.name);
  };

  // ------------------------------------------------------------------ what everyone sees, and what only you see
  function shared(): SpyShared {
    const seats = game.seats;
    const index = new Map(seats.map((s, i) => [s.id, i]));
    const showKey = game.phase === "round" || game.phase === "match";
    const picks = new Map<number, number[]>();
    for (const [id, p] of game.picks) {
      const i = index.get(id);
      if (i === undefined) continue;
      if (!picks.has(p)) picks.set(p, []);
      picks.get(p)!.push(i);
    }
    return {
      phase: game.phase,
      round: game.round,
      rounds: game.opts.rounds,
      target: game.target,
      wins: { ...game.wins },
      turn: game.turn,
      seats: seats.map((s) => ({
        id: s.id,
        name: s.name,
        team: s.team,
        role: game.handler[s.team] === s.id ? "handler" : "agent",
        bot: s.bot,
        away: !s.bot && host.players.get(s.id)?.connected === false,
      })),
      cards: game.cards.map((c, i) => ({
        word: c.word,
        owner: c.revealed || showKey ? c.owner : null,
        revealed: c.revealed,
        picks: picks.get(i) ?? [],
      })),
      clue: game.clue ? { ...game.clue } : null,
      history: game.history.map((c) => ({ ...c })),
      guesses: game.guesses,
      maxGuesses: game.maxGuesses,
      stop: picks.get(STOP) ?? [],
      need: game.need(game.turn),
      left: Math.max(0, Math.round(game.left)),
      cardsLeft: { cobalt: game.cardsLeft("cobalt"), saffron: game.cardsLeft("saffron") },
      last: game.last ? { ...game.last } : null,
      ended,
      winner: game.roundWinner,
      why: game.roundWhy,
      matchWinner: game.matchWinner,
      watching: [...host.players.keys()].filter((id) => !game.seat(id)),
    };
  }

  function own(id: string): SpyOwn {
    const s = game.seat(id);
    const err = errors.get(id);
    if (!s) return { team: null, role: "watch", key: null, error: null, errorNo: 0 };
    const handler = game.handler[s.team] === id;
    return {
      team: s.team,
      role: handler ? "handler" : "agent",
      key: handler ? game.cards.map((c) => c.owner) : null,
      error: err?.text ?? null,
      errorNo: err?.n ?? 0,
    };
  }

  let sentShared = "";
  const sentOwn = new Map<string, string>();
  function publish() {
    const s = shared();
    // the clock alone doesn't need a resend: phones count down from the last value
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

  const tell = (id: string, kind: string) => {
    if (host.players.has(id) && !game.seat(id)?.bot) host.send(id, { type: "buzz", kind });
  };
  const tellTeam = (t: Team, kind: string, role?: "handler" | "agent") => {
    for (const s of game.team(t)) if (!role || game.roleOf(s.id) === role) tell(s.id, kind);
  };

  function handle(e: SpyEvent) {
    switch (e.type) {
      case "phase":
        if (e.phase === "clue") {
          const h = game.handler[game.turn];
          if (h) tell(h, "turn");
        }
        if (e.phase === "brief") {
          ended = null;
          errors.clear();
          view.deal();
        }
        break;
      case "clue":
        ended = null;
        errors.clear();
        tellTeam(e.team, "clue", "agent");
        break;
      case "reveal":
        view.flip(e.idx);
        tellTeam(e.team, e.owner === e.team ? "good" : e.owner === "burn" ? "burn" : "bad");
        break;
      case "turn":
        ended = { team: e.from, why: e.why };
        break;
      case "round":
        for (const t of TEAMS) tellTeam(t, t === e.winner ? "win" : "lose");
        break;
      case "handler":
        tell(e.id, "turn");
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
    else view.clock(game.left, game.phase);
  }

  function restart() {
    game.configure(optionsOf(ctx.settings()));
    game.wantBots = wantedBots();
    for (const p of host.players.values()) if (p.connected) seatPerson(p);
    game.startMatch();
    ended = null;
    errors.clear();
    for (const e of game.drainEvents()) handle(e);
    publish();
  }

  // ------------------------------------------------------------------ the room
  const offs = [
    host.on("join", (p) => {
      // a match of computers only, or one that has only just been dealt: start afresh with the newcomer
      const fresh = !seated() || (game.round === 1 && game.phase === "brief");
      if (fresh) restart();
      else {
        seatPerson(p);
        for (const e of game.drainEvents()) handle(e);
        publish();
      }
    }),
    host.on("rejoin", (p) => {
      if (!game.seat(p.id)) seatPerson(p);
      sentOwn.delete(p.id);
      publish();
    }),
    host.on("drop", () => publish()),
    host.on("leave", (p) => {
      bots.forget(p.id);
      game.removeSeat(p.id);
      errors.delete(p.id);
      sentOwn.delete(p.id);
      // a seat came free: hand it to someone who was watching
      for (const w of host.players.values()) if (!game.seat(w.id) && w.connected) seatPerson(w);
      for (const e of game.drainEvents()) handle(e);
      publish();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (paused && d.type !== "clue") return;
      if (d.type === "clue") {
        // answered even while paused, so the phone never sits on "Sending…"
        const err = paused ? "The game is paused" : game.giveClue(p.id, String(d.word ?? "").slice(0, 40), Number(d.n));
        if (err) errors.set(p.id, { text: err, n: (errors.get(p.id)?.n ?? 0) + 1 });
      } else if (d.type === "pick") {
        const i = d.i === null ? null : Number(d.i);
        game.propose(p.id, i);
      } else if (d.type === "again") {
        if (p.id === shell.vip && game.phase === "match") return restart();
        return;
      } else return;
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

  const offPerf = setPerfExtras(() => ({ phase: game.phase, round: game.round, seats: game.seats.length }));
  if (import.meta.env.DEV) (window as unknown as { __spyline: unknown }).__spyline = { game, bots, view, restart, publish };

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
