// Blast Party 3D on the TV: seats, the fixed-step loop, the 3D view and the scoreboard. The rules live in rules.ts.
// Start options (the URL, or the TV app's launch options), for tests:
//   bots=N         computer fighters (the shell maps it onto the setting)
//   fighters=8     fill the deck up to N with computer fighters (the setting stops at 7)
//   stress=fight   nobody runs out of lives, so the fight goes on (a frame-rate test of a full brawl)
//   stress=heavy   the same, with a blast every third of a second somewhere on the deck
//   res=0.66       the drawing buffer's scale (given: it stays; not given: 0.66, dropping to 0.5 if frames run long)
//   lite=1         half the particles
//   cam=close      a close camera, to look at the models
import type { Host, HostPlayer } from "@thumbtide/sdk";
import { shell } from "../../shell/host-state.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { startParam } from "../../shell/tv.ts";
import { isSys, type HostMount, type Settings } from "../types.ts";
import { createBots, isBot } from "./bots.ts";
import { loadFonts } from "./font.ts";
import { colorOf, createHud } from "./hud.ts";
import { ARENA, BLAST_RADIUS, COUNT_STEPS, HP, MAX_SEATS, STEP, TNT_RADIUS_K, Game, type GameEvent, type Options, type PowerKind } from "./rules.ts";
import type { B3dGame, B3dOwn } from "./shared.ts";
import { View } from "./view.ts";
import "./blast3d.css";

const optionsOf = (s: Settings): Partial<Options> => ({
  lives: Math.max(1, Math.min(5, Number(s.lives) || 3)),
  wins: Math.max(1, Math.min(5, Number(s.wins) || 2)),
  powerups: s.powerups !== false,
});
const num = (name: string) => {
  const v = startParam(name);
  return v !== null && Number.isFinite(Number(v)) ? Number(v) : null;
};

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<B3dGame>;
  const stress = startParam("stress");
  const fixedRes = num("res");

  ctx.root.innerHTML = `<div class="b3d"><header class="b3d-bar"></header><div class="b3d-stage"><div class="b3d-over"></div></div></div>`;
  const wrap = ctx.root.firstElementChild as HTMLElement;
  const stage = wrap.querySelector(".b3d-stage") as HTMLElement;
  const over = wrap.querySelector(".b3d-over") as HTMLElement;
  const game = new Game({ ...optionsOf(ctx.settings()), endless: !!stress });
  const bots = createBots(game);
  const view = new View(stage, { res: Math.max(0.3, Math.min(2, fixedRes ?? 0.66)), lite: !!startParam("lite"), close: startParam("cam") === "close" });
  stage.appendChild(over); // the cards sit over the canvas
  const hud = createHud(wrap.querySelector(".b3d-bar") as HTMLElement, over, isBot);
  void loadFonts();
  if (import.meta.env.DEV) (window as unknown as { __blast3d: unknown }).__blast3d = { game, view, bots };
  let paused = false;

  // ------------------------------------------------------------ seats
  const humans = () => [...game.seats.values()].filter((s) => !s.bot).length;
  const wantedBots = () => Math.min(MAX_SEATS - humans(), Math.max(Number(ctx.settings().bots) || 0, 2 - humans(), (num("fighters") ?? 0) - humans()));
  // during a round bots are only added: taking one away mid-round could end it. Extras go when the next round counts in.
  const fillBots = () => bots.setCount(game.phase === "count" || game.phase === "play" ? Math.max(wantedBots(), bots.count) : wantedBots());
  const join = (p: HostPlayer<B3dGame>) => {
    if (game.seats.has(p.id)) return;
    // a bot steps aside if every seat is taken
    if (!game.addSeat(p.id, p.name, false, p.index % MAX_SEATS) && bots.yieldOne()) game.addSeat(p.id, p.name, false, p.index % MAX_SEATS);
  };
  for (const p of host.players.values()) join(p);
  fillBots();
  game.startMatch();

  const sentOwn = new Map<string, string>();
  const nameOf = (id: string | null) => (id ? game.seats.get(id)?.name ?? null : null);
  function publish() {
    host.setShared({
      phase: game.phase,
      round: game.round,
      target: game.opts.wins,
      roundWinner: game.phase === "round" ? nameOf(game.roundWinner) : null,
      winner: game.phase === "match" ? nameOf(game.winner) : null,
    });
    const quiet = game.phase === "match" || game.phase === "wait" || game.phase === "count";
    for (const p of host.players.values()) {
      const f = game.seats.get(p.id);
      let own: B3dOwn;
      if (!f) own = { name: p.name, color: "#8a90a0", state: "watch", lives: 0, maxLives: 0, hp: 0, wins: 0, power: [], holding: false };
      else {
        const power: PowerKind[] = [];
        if (f.alive && f.tripleT > 0) power.push("triple");
        if (f.alive && f.bombKind !== "normal") power.push(f.bombKind);
        if (f.alive && f.glovesT > 0) power.push("gloves");
        if (f.alive && f.shield > 0) power.push("shield");
        own = {
          name: f.name,
          color: colorOf(f),
          state: !f.inRound && !quiet ? "next" : quiet || f.alive ? "in" : f.lives > 0 ? "down" : "out",
          lives: f.inRound ? f.lives : 0,
          maxLives: game.opts.lives,
          hp: f.alive ? Math.ceil((f.hp / HP) * 10) : 0,
          wins: f.wins,
          power,
          holding: game.holding(f),
        };
      }
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
      const fresh = game.phase !== "match" && ![...game.seats.values()].some((s) => !s.bot && s.inRound);
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
      if (game.phase === "wait") game.startMatch();
      publish();
    }),
    host.on("input", (p, d) => {
      if (d && typeof d === "object") game.setInput(p.id, Number(d.x), Number(d.y));
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      if (d.type === "bomb") game.bomb(p.id);
      else if (d.type === "punch") game.punch(p.id);
      else if (d.type === "jump") game.jump(p.id);
      else if (d.type === "grab") game.grab(p.id);
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
  let dirty = false; // a phone's status changed: publish once after the step
  function handle(e: GameEvent) {
    view.event(e, game);
    switch (e.type) {
      case "phase":
        if (e.phase === "count") {
          // extra bots leave here, not at the round result: the result still needs the winner's seat
          bots.setCount(wantedBots());
          view.clear();
          for (const p of host.players.values()) if (game.seats.get(p.id)?.inRound) tell(p.id, "go");
        }
        if (e.phase === "match") hud.match(game);
        if (e.phase === "wait") hud.wait();
        dirty = true;
        break;
      case "hit":
        if (e.damage > 250) tell(e.id, "hit");
        dirty = true;
        break;
      case "die":
        tell(e.id, "out");
        dirty = true;
        break;
      case "power":
        tell(e.id, "pick");
        dirty = true;
        break;
      case "round":
        hud.roundResult(game, e.winner ? game.seats.get(e.winner) ?? null : null);
        dirty = true;
        break;
      case "spawn":
      case "bomb":
      case "throw":
      case "grab":
      case "shieldDown":
        dirty = true;
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ the frame-rate tests' extra load
  let stressT = 0;
  function stressStep() {
    if (stress !== "heavy" || game.phase !== "play") return;
    if (++stressT % 20 !== 0) return;
    const big = stressT % 100 === 0;
    game.explode((Math.random() * 2 - 1) * (ARENA.hx - 1), 0.3, (Math.random() * 2 - 1) * (ARENA.hz - 1), BLAST_RADIUS * (big ? TNT_RADIUS_K : 1), big ? "tnt" : "normal", null);
  }

  // ------------------------------------------------------------ loop: 60 Hz fixed steps, one draw per frame
  const startedAt = performance.now();
  let acc = { frames: 0, steps: 0, sim: 0, body: 0, fill: 0, render: 0, js: 0, jsMax: 0 };
  const info = view.glInfo();
  const offPerf = setPerfExtras(() => {
    const a = acc;
    acc = { frames: 0, steps: 0, sim: 0, body: 0, fill: 0, render: 0, js: 0, jsMax: 0 };
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const per = (v: number) => (a.frames ? r(v / a.frames) : 0);
    return {
      // "intro" until the shaders are compiled and the fight is on: the perf tools skip these reports
      phase: performance.now() - startedAt < 2500 || game.phase === "count" ? "intro" : game.phase,
      scale: view.res,
      jsMs: per(a.js), // all of a frame's JavaScript
      jsMax: r(a.jsMax),
      simMs: per(a.sim), // bots + rules
      bodyMs: per(a.body), // poses and ragdolls
      fillMs: per(a.fill), // part matrices, tints, instances
      renderMs: per(a.render), // three.js render call (CPU side)
      ...view.stats(),
      fighters: [...game.seats.values()].filter((f) => f.inRound && !f.gone).length,
      bombs: game.bombs.length,
      boxes: game.boxes.length,
      gpuMB: view.gpuMB(),
      ...info,
    };
  });

  let last = 0;
  let pend = 0;
  let raf = 0;
  // frames that ran long, to drop the drawing buffer's scale once (0.66 → 0.5)
  let slow = 0;
  let judged = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t0 = performance.now();
    const dt = last ? Math.min(0.1, (now - last) / 1000) : STEP;
    last = now;
    frameDrawn(now);
    let steps = 0;
    let tBody = 0;
    if (!paused) {
      pend += dt;
      while (pend >= STEP && steps < 4) {
        bots.step();
        stressStep();
        game.step();
        for (const e of game.drainEvents()) handle(e);
        const b0 = performance.now();
        view.step(game);
        tBody += performance.now() - b0;
        pend -= STEP;
        steps++;
      }
      if (steps === 4) pend = 0; // too far behind: drop the rest rather than spiral
      if (dirty) {
        dirty = false;
        publish();
      }
      if (game.phase === "count") hud.count(Math.max(1, Math.ceil((COUNT_STEPS - game.t) / 60)), game);
      else if (game.phase === "play") {
        if (game.t < 50) hud.go(game.round);
        else hud.clear();
      } else if (game.phase === "match" && humans() === 0 && game.t > 60 * 12) restart(); // a demo loop
      // the drawing buffer's scale: after the start, if a tenth of 4 s of frames ran over 24 ms, drop it once
      if (fixedRes === null && view.res > 0.5 && now - startedAt > 6000 && game.phase === "play") {
        judged++;
        if (dt > 0.024) slow++;
        if (judged >= 240) {
          if (slow > 24) {
            view.setScale(0.5);
            view.fx.lite = true;
          }
          judged = slow = 0;
        }
      }
    }
    const t1 = performance.now();
    view.draw(game, paused ? 0 : dt);
    const t2 = performance.now();
    view.render();
    const t3 = performance.now();
    hud.update(game);
    const t4 = performance.now();
    acc.frames++;
    acc.steps += steps;
    acc.sim += t1 - t0 - tBody;
    acc.body += tBody;
    acc.fill += t2 - t1;
    acc.render += t3 - t2;
    acc.js += t4 - t0;
    acc.jsMax = Math.max(acc.jsMax, t4 - t0);
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
      offPerf();
      offs.forEach((o) => o());
      view.dispose();
      wrap.remove();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = 0;
    },
    restart,
  };
};

export default mount;
