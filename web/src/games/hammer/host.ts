// Rotor Brawl on the TV: up to 4 machines, last one flying wins the round, first to N rounds wins the match.
// Rounds: warm-up and weapon pick (no damage) → fight → result → (match winner) → next warm-up.
// Physics: sim.ts, which follows Hammerfight's model (HAMMERFIGHT_PHYSICS.md).

import type { Host, HostPlayer } from "@thumbtide/sdk";
import { colorFor } from "../../config.ts";
import { isWebOS, startParam } from "../../shell/tv.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount } from "../types.ts";
import { type Bot, driveBot, makeBot } from "./bots.ts";
import "./hammer.css";
import { loadGameFont } from "./font.ts";
import { Hud, type SeatView } from "./hud.ts";
import { Fx, Renderer } from "./render.ts";
import type { HammerGame, Mode, Phase } from "./shared.ts";
import { Arena, type Machine, STEP, VIEW_H, VIEW_W } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { MACHINE, WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const MAX_SEATS = 4;
const SPAWNS: [number, number][] = [
  [220, 170],
  [740, 170],
  [220, 370],
  [740, 370],
];
/** Computer players: colours away from the first human colours, and never white (white is the hit flash). */
const BOT_COLORS = ["#c18cff", "#ff9f43", "#2de2c9", "#a3e048"];
/** Team modes: Red is P1 + P3 (the left HUD side), Blue is P2 + P4; each member gets a shade of the team colour. */
const TEAMS = [
  { name: "Red", color: "#ff4d5e", shades: ["#ff5d73", "#ff9f43"] },
  { name: "Blue", color: "#3ec5ff", shades: ["#3ec5ff", "#7c8cff"] },
];
const PVE_TEAMS = [
  { name: "Players", color: "#7cf29a" },
  { name: "CPU", color: "#c18cff" },
];
const PICK_S = 8;
const FIRST_PICK_S = 12;
const RESULT_S = 4;
const MATCH_S = 7;
/** Real seconds after the last KO before the round is called (let the wreck fall). */
const CALL_S = 1.2;
/** Seconds of fight before sudden death: the health_low rule stops, so long rounds end. */
const SUDDEN_DEATH_S = 60;

interface Seat {
  id: string;
  name: string;
  color: string;
  human: boolean;
  weapon: WeaponKind;
  wins: number;
  /** Seat index in the current round, or −1 when waiting. */
  slot: number;
  m: Machine | null;
  bot: Bot | null;
  /** Touchpad baseline: input session, kind, and last totals. */
  s: number;
  k: number;
  tx: number;
  ty: number;
}

const mount: HostMount = (ctx) => {
  loadGameFont();
  const host = ctx.host as Host<HammerGame>;
  const spec = gameById("hammer")!.controls!;
  const gain = spec.tune.gain ?? 6;
  const stickGain = spec.tune.stick ?? 150;

  const lite = isWebOS || !!startParam("lite");
  const tuning = { ...DEFAULT_TUNING };
  const arena = new Arena(tuning);
  // the TV strokes each spark separately on a weak CPU: fewer at once
  const fx = new Fx(lite ? 80 : 240);

  // ---- DOM ---------------------------------------------------------------------------------------
  const root = document.createElement("div");
  // hm-lite: the TV skips filters, gradient text and endless animations, which it repaints slowly
  root.className = lite ? "hm-root hm-lite" : "hm-root";
  root.innerHTML = `<canvas class="hm-canvas"></canvas>`;
  ctx.root.appendChild(root);
  const canvas = root.querySelector<HTMLCanvasElement>(".hm-canvas")!;
  const hud = new Hud(root);
  // The TV draws at 1280 x 720 and lets the screen scale it up; its GPU can't afford a 4K canvas.
  const renderer = new Renderer(canvas, { maxDpr: isWebOS ? 1 : 2, maxWidth: isWebOS ? 1280 : 4096, names: true });

  const fit = () => {
    const W = root.clientWidth;
    const H = root.clientHeight;
    const w = Math.min(W, (H * 16) / 9);
    const h = (w * 9) / 16;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.left = `${(W - w) / 2}px`;
    canvas.style.top = `${(H - h) / 2}px`;
    renderer.resize();
  };
  addEventListener("resize", fit);
  fit();

  // ---- seats -------------------------------------------------------------------------------------
  const seats = new Map<string, Seat>();
  const byMachine = new Map<Machine, Seat>();
  let botSerial = 0;
  let machineSerial = 0;

  const randomWeapon = (): WeaponKind => WEAPON_KINDS[Math.floor(Math.random() * WEAPON_KINDS.length)]!;
  const humanSeat = (p: HostPlayer<HammerGame>): Seat => ({
    id: p.id,
    name: p.name,
    color: colorFor(p.index),
    human: true,
    weapon: "hammer",
    wins: 0,
    slot: -1,
    m: null,
    bot: null,
    s: -1,
    k: -1,
    tx: 0,
    ty: 0,
  });

  const humans = () => [...seats.values()].filter((s) => s.human);
  const bots = () => [...seats.values()].filter((s) => !s.human);
  const seated = () => [...seats.values()].filter((s) => s.slot >= 0).sort((a, b) => a.slot - b.slot);

  // ---- modes and teams ---------------------------------------------------------------------------
  const settingMode = (): Mode => {
    const m = String(ctx.settings().mode);
    return m === "teams" || m === "pve" ? m : "ffa";
  };
  /** The mode of the current round (a change in Settings applies from the next warm-up). */
  let mode: Mode = settingMode();
  const teamOf = (s: Seat): number => (mode === "teams" ? s.slot % 2 : mode === "pve" ? (s.human ? 0 : 1) : s.slot);
  const teamName = (t: number): string => (mode === "teams" ? TEAMS[t]!.name : mode === "pve" ? PVE_TEAMS[t]!.name : "");
  const teamColor = (t: number): string => (mode === "teams" ? TEAMS[t]!.color : PVE_TEAMS[t]!.color);
  const colorOf = (s: Seat): string => (mode === "teams" ? TEAMS[s.slot % 2]!.shades[s.slot >= 2 ? 1 : 0]! : s.color);
  /** Computer players wanted: the setting, but at least one enemy in co-op. */
  const botsWanted = () => {
    const n = Number(ctx.settings().bots) || 0;
    return mode === "pve" ? Math.max(1, n) : n;
  };
  const teamsAlive = () => new Set(seated().filter((s) => s.m?.alive).map(teamOf));
  const teamsSeated = () => new Set(seated().map(teamOf));
  const applyToggles = () => {
    const st = ctx.settings();
    tuning.teamCollision = st.teamCollision === false ? 0 : 1;
    tuning.teamDamage = st.teamDamage === true ? 1 : 0;
  };

  const syncBots = () => {
    // co-op keeps a seat for at least one enemy
    const room = MAX_SEATS - Math.min(mode === "pve" ? MAX_SEATS - 1 : MAX_SEATS, humans().length);
    const want = Math.max(0, Math.min(botsWanted(), room));
    const have = bots();
    for (let i = have.length; i < want; i++) {
      const id = `bot:${++botSerial}`;
      const n = bots().length;
      seats.set(id, {
        id,
        name: `CPU ${n + 1}`,
        color: BOT_COLORS[n % BOT_COLORS.length]!,
        human: false,
        weapon: randomWeapon(),
        wins: 0,
        slot: -1,
        m: null,
        bot: makeBot("fight", VIEW_W / 2, VIEW_H / 2),
        s: -1,
        k: -1,
        tx: 0,
        ty: 0,
      });
    }
    // Extra bots leave, but never in the middle of a fight.
    for (const b of have.slice(want).reverse()) if (phase !== "fight" || b.slot < 0) dropSeat(b);
  };

  const dropSeat = (s: Seat) => {
    if (s.m) {
      fx.trails.delete(s.m);
      byMachine.delete(s.m);
      arena.remove(s.m);
    }
    seats.delete(s.id);
    hudDirty = true;
  };

  const spawn = (s: Seat) => {
    const [x, y] = SPAWNS[s.slot] ?? [VIEW_W / 2, VIEW_H / 2];
    if (s.m) {
      arena.respawn(s.m, x, y, s.weapon);
    } else {
      s.m = arena.add({ id: ++machineSerial, name: s.name, color: colorOf(s), weapon: s.weapon, x, y });
      byMachine.set(s.m, s);
    }
    s.m.team = teamOf(s);
    s.m.color = colorOf(s);
    fx.trails.delete(s.m);
    if (s.bot) {
      s.bot.homeX = x;
      s.bot.homeY = y;
    }
  };

  /** Give free seats to waiting humans first, then bots. Only between rounds (or in warm-up). */
  const fillSeats = () => {
    const taken = new Set(seated().map((s) => s.slot));
    const waiting = [...humans().filter((s) => s.slot < 0), ...bots().filter((s) => s.slot < 0)];
    for (const s of waiting) {
      let slot = 0;
      while (taken.has(slot)) slot++;
      if (slot >= MAX_SEATS) break;
      // a bot gives its seat up to a human
      s.slot = slot;
      taken.add(slot);
      spawn(s);
      pushOwn(s);
    }
    // humans waiting while bots are seated: swap the last bot out (co-op keeps its last enemy)
    for (const h of humans().filter((s) => s.slot < 0)) {
      const seatedBots = seated().filter((s) => !s.human);
      if (mode === "pve" && seatedBots.length <= 1) break;
      const b = seatedBots.pop();
      if (!b) break;
      h.slot = b.slot;
      unseat(b);
      spawn(h);
      pushOwn(h);
    }
    hudDirty = true;
  };

  const unseat = (s: Seat) => {
    if (s.m) {
      fx.trails.delete(s.m);
      byMachine.delete(s.m);
      arena.remove(s.m);
      s.m = null;
    }
    s.slot = -1;
  };

  // ---- state to phones ---------------------------------------------------------------------------
  let phase: Phase = "pick";
  let round = 0;
  let left = FIRST_PICK_S;
  /** This warm-up's full length (the first one is longer), for the countdown bar and while waiting for players. */
  let pickTotal = FIRST_PICK_S;
  /** Real seconds in the current phase. */
  let phaseFor = 0;
  let lastWhole = -1;
  /** The last round's winner: a player (free-for-all) or a team. */
  let winner: { label: string; color: string; id: string | null; team: number } | null = null;
  let callAt = -1;
  let paused = false;
  let hudDirty = true;
  const winsToMatch = () => Number(ctx.settings().wins) || 3;

  const pushOwn = (s: Seat) => {
    if (!s.human || !host.players.has(s.id)) return;
    host.setOwn(s.id, {
      color: colorOf(s),
      slot: s.slot,
      team: teamOf(s),
      teamName: mode === "ffa" ? "" : teamName(teamOf(s)),
      weapon: s.weapon,
      hp: s.m ? Math.round(s.m.hp) : MACHINE.health,
      alive: !!s.m && s.m.alive,
      wins: s.wins,
      seated: s.slot >= 0,
    });
  };
  const pushShared = () => {
    host.setShared({
      phase,
      round,
      left: Math.max(0, Math.ceil(left)),
      mode,
      winner: winner?.label ?? null,
      winnerId: winner?.id ?? null,
      winnerTeam: winner?.team ?? null,
      winnerColor: winner?.color ?? null,
      winsToMatch: winsToMatch(),
    });
  };

  // ---- phases ------------------------------------------------------------------------------------
  const startPick = (seconds = PICK_S) => {
    phase = "pick";
    arena.suddenDeath = false;
    const nextMode = settingMode();
    if (nextMode !== mode) {
      // a new mode starts a new match
      mode = nextMode;
      for (const x of seats.values()) x.wins = 0;
      round = 0;
    }
    round++;
    left = seconds;
    pickTotal = seconds;
    phaseFor = 0;
    lastWhole = -1;
    arena.resetTime(); // the last round may have ended in slow motion
    winner = null;
    callAt = -1;
    tuning.damage = 0; // warm-up: fly and swing, no damage
    tuning.slomo = 0;
    applyToggles();
    for (const s of bots()) s.weapon = randomWeapon();
    syncBots();
    fillSeats();
    for (const s of seated()) spawn(s);
    for (const s of seats.values()) pushOwn(s);
    pushShared();
    hud.clearFeed();
    if (teamsSeated().size >= 2) hud.announce("round", `Round ${round}`, mode === "ffa" ? "Pick your weapon" : mode === "teams" ? "Red vs Blue" : "Players vs CPU", "#ffd84d", 1800);
    else hud.clearAnnounce();
    hudDirty = true;
  };

  const startFight = () => {
    phase = "fight";
    arena.suddenDeath = false;
    phaseFor = 0;
    tuning.damage = DEFAULT_TUNING.damage;
    tuning.slomo = ctx.settings().slomo === false ? 0 : 1;
    applyToggles();
    for (const s of seated()) spawn(s);
    for (const s of seats.values()) pushOwn(s);
    hud.announce("fight", "Fight!", "", "#ffd84d", 1100);
    pushShared();
    hudDirty = true;
  };

  const endRound = () => {
    const alive = teamsAlive();
    const team = alive.size === 1 ? [...alive][0]! : null;
    const winners = team === null ? [] : seated().filter((s) => teamOf(s) === team);
    for (const w of winners) {
      w.wins++;
      if (w.human) host.send(w.id, { type: "win" });
    }
    const solo = mode === "ffa" ? winners[0] : undefined;
    winner =
      team === null
        ? null
        : solo
          ? { label: solo.name, color: colorOf(solo), id: solo.id, team }
          : { label: mode === "teams" ? `${teamName(team)} team` : teamName(team), color: teamColor(team), id: null, team };
    phase = winners.some((w) => w.wins >= winsToMatch()) ? "match" : "result";
    phaseFor = 0;
    left = phase === "match" ? MATCH_S : RESULT_S;
    tuning.slomo = 0;
    for (const s of seats.values()) pushOwn(s);
    pushShared();
    if (phase === "match") hud.announce("champ", winner!.label, mode === "ffa" ? "Champion" : "Champions", winner!.color, 0);
    else if (winner) hud.announce("win", `${winner.label} wins`, `Round ${round}`, winner.color, 0);
    else hud.announce("win", "Draw", "", "#ffffff", 0);
    hudDirty = true;
  };

  const tickPhase = (real: number) => {
    phaseFor += real;
    if (phase === "fight") {
      // the round ends when one team (or one machine) is left flying
      if (teamsAlive().size <= 1 && callAt < 0) callAt = CALL_S;
      if (!arena.suddenDeath && phaseFor >= SUDDEN_DEATH_S && callAt < 0) {
        arena.suddenDeath = true;
        hud.announce("ko", "Sudden death", "Every hit counts", "#ff3d55", 1800);
      }
      if (callAt >= 0) {
        callAt -= real;
        if (callAt <= 0) endRound();
      }
      return;
    }
    // Practice until there are two machines to fight.
    if (phase === "pick" && teamsSeated().size < 2) {
      left = pickTotal;
    } else {
      left -= real;
    }
    if (Math.ceil(left) !== lastWhole) {
      lastWhole = Math.ceil(left);
      pushShared();
      if (phase === "pick" && teamsSeated().size >= 2 && lastWhole >= 1 && lastWhole <= 3) hud.announce("count", String(lastWhole), "", "#ffd84d", 900);
    }
    if (left > 0) return;
    if (phase === "pick") startFight();
    else if (phase === "result") startPick();
    else {
      for (const s of seats.values()) s.wins = 0;
      round = 0;
      startPick();
    }
  };

  // ---- events ------------------------------------------------------------------------------------
  const offs = [
    host.on("join", (p) => {
      if (!seats.has(p.id)) seats.set(p.id, humanSeat(p));
      syncBots();
      if (phase === "pick") fillSeats();
      pushOwn(seats.get(p.id)!);
      pushShared();
      hudDirty = true;
    }),
    host.on("leave", (p) => {
      const s = seats.get(p.id);
      if (s) dropSeat(s);
      syncBots();
      if (phase === "pick") fillSeats();
    }),
    host.on("message", (p, d) => {
      if (isSys(d) || !d || typeof d !== "object") return;
      const s = seats.get(p.id);
      if (!s || d.type !== "weapon" || !WEAPON_KINDS.includes(d.weapon)) return;
      s.weapon = d.weapon;
      // In warm-up the new weapon appears straight away; otherwise from the next round.
      if (phase === "pick" && s.m) arena.respawn(s.m, s.m.hull.x, s.m.hull.y, s.weapon);
      pushOwn(s);
      hudDirty = true;
    }),
    ctx.onSettings(() => {
      // the toggles apply at once; the mode from the next warm-up
      applyToggles();
      if (phase === "fight") tuning.slomo = ctx.settings().slomo === false ? 0 : 1;
      syncBots();
      if (phase === "pick") fillSeats();
      pushShared();
      hudDirty = true;
    }),
  ];
  for (const p of host.players.values()) seats.set(p.id, humanSeat(p));

  // ---- input and simulation ----------------------------------------------------------------------
  const readInput = (s: Seat) => {
    const m = s.m;
    if (!m || !m.alive) return;
    if (s.bot) {
      driveBot(arena, m, s.bot);
      return;
    }
    const p = host.players.get(s.id);
    const inp = p?.connected ? p.input : null;
    if (!inp) return;
    if (inp.k === 1) {
      s.k = 1;
      arena.pushRaw(m, stickGain * inp.x ** 3, stickGain * inp.y ** 3);
      return;
    }
    if (inp.s !== s.s || s.k !== 0) {
      s.s = inp.s;
      s.k = 0;
      s.tx = inp.x;
      s.ty = inp.y;
      return;
    }
    const dx = inp.x - s.tx;
    const dy = inp.y - s.ty;
    s.tx = inp.x;
    s.ty = inp.y;
    if (dx || dy) arena.push(m, dx * gain, dy * gain);
  };

  const handleEvents = () => {
    const hitFx = (x: number, y: number, dmg: number, cut: number, color: string) => {
      fx.shake = Math.min(12, fx.shake + dmg * 0.35);
      fx.burst(x, y, 4 + Math.round(dmg), 220 + dmg * 18, cut > 1 ? "#ffffff" : "#ffe08a", cut > 1 ? 1.5 : 2.5);
      fx.burst(x, y, 3, 120, color, 3);
      if (dmg > 0) fx.text(x, y - 12, cut > 2 ? `${dmg}!` : String(dmg), cut > 2 ? "#e6f3ff" : "#fff", 14 + Math.min(16, dmg * 0.6));
    };
    for (const e of arena.events) {
      if (e.type === "hit") {
        hitFx(e.x, e.y, e.dmg, e.cut, e.victim.color);
        const a = byMachine.get(e.attacker);
        const v = byMachine.get(e.victim);
        if (e.dmg > 0) {
          if (a?.human) host.send(a.id, { type: "hit", dmg: e.dmg });
          if (v?.human) host.send(v.id, { type: "hurt", dmg: e.dmg });
        }
        if (v) pushOwn(v);
      } else if (e.type === "disarm") {
        fx.burst(e.x, e.y, 24, 360, "#cfe3ff", 2);
        fx.text(e.x, e.y - 20, "DISARMED", "#cfe3ff", 20);
        fx.shake = Math.min(12, fx.shake + 6);
        const v = byMachine.get(e.victim);
        const a = byMachine.get(e.by);
        if (v?.human) host.send(v.id, { type: "hurt", dmg: 0 });
        if (a?.human) host.send(a.id, { type: "hit", dmg: 0 });
        hudDirty = true;
      } else if (e.type === "pickup") {
        const s = byMachine.get(e.m);
        if (s?.human) host.send(s.id, { type: "hit", dmg: 0 });
        hudDirty = true;
      } else if (e.type === "clash") {
        // a grind reports a clash every step: sparks at most every 60 ms (and fewer on the TV)
        if (clashCd > 0) continue;
        clashCd = 0.06;
        const n = 4 + Math.min(10, Math.round(e.impact / 10));
        fx.burst(e.x, e.y, lite ? Math.ceil(n / 2) : n, 220, "#cfe3ff", 1.5);
      } else {
        fx.burst(e.x, e.y, 40, 420, "#ffb547", 3);
        fx.burst(e.x, e.y, 16, 200, e.victim.color, 4);
        fx.shake = 14;
        const v = byMachine.get(e.victim);
        const by = e.by ? byMachine.get(e.by) : null;
        if (v) hud.feed(by ? { name: by.name, color: by.color } : null, { name: v.name, color: v.color });
        if (seated().filter((x) => x.m?.alive).length > 1) hud.announce("ko", "K.O.!", "", "#ff3d55", 900);
        if (v?.human) host.send(v.id, { type: "ko" });
        if (v) pushOwn(v);
        hudDirty = true;
      }
    }
    arena.events.length = 0;
  };

  // ---- HUD ---------------------------------------------------------------------------------------
  /** A number that changes when anything a player card shows changes (no allocations: it runs every frame). */
  const cardSig = () => {
    let h = 0;
    for (const s of seats.values()) {
      if (s.slot < 0 || !s.m) continue;
      const m = s.m;
      h = (h * 31 + Math.round(m.hp)) | 0;
      h = (h * 8 + (m.alive ? 1 : 0) + (m.stun > 0 ? 2 : 0) + (m.armed ? 4 : 0)) | 0;
    }
    return h;
  };
  let lastSig = NaN;
  let lastWarm = NaN;
  /** The HUD only when something on it changed (it used to rebuild its view of every card every frame). */
  const maybeDrawHud = () => {
    const sig = cardSig();
    const warm = phase === "pick" ? Math.round(left * 10) : -1;
    if (!hudDirty && sig === lastSig && warm === lastWarm) return;
    lastSig = sig;
    lastWarm = warm;
    drawHud();
  };
  const drawHud = () => {
    hudDirty = false;
    const views: SeatView[] = seated().map((s) => ({
      id: s.id,
      name: s.name,
      color: colorOf(s),
      slot: s.slot,
      weapon: s.m?.weapon ?? s.weapon,
      hp: s.m ? s.m.hp : MACHINE.health,
      wins: s.wins,
      alive: !s.m || s.m.alive,
      stunned: !!s.m && s.m.stun > 0,
      armed: !s.m || s.m.armed,
      human: s.human,
    }));
    hud.update(views, winsToMatch());
    if (phase === "pick") {
      const waiting = teamsSeated().size < 2;
      hud.warmup(
        waiting ? "Warm-up · waiting for a second player (or add computer players in Settings)" : "Warm-up · pick your weapon on your phone",
        waiting ? null : left / pickTotal,
      );
    } else {
      hud.warmup(null, null);
    }
  };

  // perf=<url> (pnpm tv --perf=hammer): every 2 s, tell the computer that installed the app how smoothly it runs.
  const perfTo = startParam("perf");
  let perfFrames = 0;
  let perfWorst = 0;
  let perfSince = performance.now();
  const perfTick = (now: number, frameMs: number) => {
    if (!perfTo) return;
    perfFrames++;
    perfWorst = Math.max(perfWorst, frameMs);
    if (now - perfSince < 2000) return;
    const rect = canvas.getBoundingClientRect();
    const body = JSON.stringify({
      fps: Math.round((perfFrames * 1000) / (now - perfSince)),
      worst: Math.round(perfWorst),
      scale: rect.width ? canvas.width / (rect.width * (window.devicePixelRatio || 1)) : 1,
      canvas: `${canvas.width}x${canvas.height}`,
      phase,
      machines: arena.machines.length,
    });
    void fetch(perfTo, { method: "POST", mode: "no-cors", body }).catch(() => {});
    perfFrames = 0;
    perfWorst = 0;
    perfSince = now;
  };

  // ---- loop --------------------------------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let clashCd = 0;
  /** Frame rate cap for the current state: none while anyone can fight; 30 fps once a result is on screen. */
  const capFps = () => ((phase === "result" || phase === "match") && phaseFor > 1.5 ? 30 : 0);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Paused: the canvas keeps its last picture. Drawing on under the pause menu made the TV redraw the
    // canvas and redo the menu's full-screen backdrop blur every frame, for a still screen.
    if (paused) return;
    const cap = capFps();
    if (cap && now - last < 1000 / cap - 4) return;
    perfTick(now, now - last);
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += real;
    let steps = 0;
    while (acc >= STEP && steps < 6) {
      for (const s of seated()) readInput(s);
      arena.step();
      clashCd -= STEP;
      handleEvents();
      acc -= STEP;
      steps++;
    }
    if (steps === 6) acc = 0;
    tickPhase(real);
    fx.update(real);
    renderer.draw(arena, Math.min(1, acc / STEP), fx);
    maybeDrawHud();
  };

  startPick(FIRST_PICK_S);
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) (window as unknown as { __rotor: unknown }).__rotor = { host, arena, seats, phase: () => phase };

  return {
    dispose() {
      cancelAnimationFrame(raf);
      removeEventListener("resize", fit);
      offs.forEach((o) => o());
      hud.clearAnnounce(); // its timer
      canvas.width = canvas.height = 0; // let the TV have the canvas memory back now, not at the next GC
      root.remove();
    },
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      last = performance.now();
    },
    restart() {
      for (const s of seats.values()) s.wins = 0;
      round = 0;
      startPick(FIRST_PICK_S);
    },
  };
};

export default mount;
