// Rotor Brawl on the TV: up to 8 machines, last one flying wins the round, first to N rounds wins the match.
// Rounds: warm-up and weapon pick (no damage) → fight → result → (match winner) → next warm-up.
// Physics: sim.ts, which follows Hammerfight's model (HAMMERFIGHT_PHYSICS.md).

import type { Host, HostPlayer } from "@thumbtide/sdk";
import { colorFor } from "../../config.ts";
import { audio } from "../../shell/sound.ts";
import { isWebOS, startParam } from "../../shell/tv.ts";
import { frameDrawn, setPerfExtras } from "../../shell/perf.ts";
import { profBegin, profEnd } from "../../shell/profiler.ts";
import { makeTour } from "./tour.ts";
import { createGameAudio } from "./audio.ts";
import { gameById } from "../registry.ts";
import { isSys, type HostMount } from "../types.ts";
import { applyArenaKind, openSideRows, spawnPoint, wormSpawn, STICK_DEFAULTS, type StickTune, stickPush as stickPushFor } from "./arenas.ts";
import { type Bot, driveBot, makeBot, newRound, PROFILES, type ProfileId, profileLoadout, ROSTER } from "./bots.ts";
import "./hammer.css";
import { loadGameFont } from "./font.ts";
import { Hud, type SeatView } from "./hud.ts";
import { COIN_LOOK, type Pickup } from "./coins.ts";
import { Fx, Renderer } from "./render.ts";
import type { HammerGame, Mode, Phase } from "./shared.ts";
import { Arena, type Machine, STEP, VIEW_H, VIEW_W } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { GUN_KINDS, type GunKind, MACHINE, type Material, PLATE_KINDS, type PlateKind, WEAPON_KINDS, WEAPONS, type WeaponKind } from "./weapons.ts";

const MAX_SEATS = 8;
/** Computer players: colours away from the first human colours, and never white (white is the hit flash). */
const BOT_COLORS = ["#c18cff", "#ff9f43", "#2de2c9", "#a3e048", "#ff7eb6", "#ffd84a", "#7ee0ff", "#b8c0d0"];
/** Team modes: Red is the odd players P1, P3, P5, P7 (the left HUD side), Blue the even ones; each member gets a shade of the team colour. */
const TEAMS = [
  { name: "Red", color: "#ff4d5e", shades: ["#ff5d73", "#ff9f43", "#ff4fae", "#ffc94d"] },
  { name: "Blue", color: "#3ec5ff", shades: ["#3ec5ff", "#7c8cff", "#3ef0d0", "#b18cff"] },
];
const PVE_TEAMS = [
  { name: "Players", color: "#7cf29a" },
  { name: "CPU", color: "#c18cff" },
];
/** Co-op vs monsters: the monsters' team, and how many may be alive at once (TV budget). */
const MONSTER_TEAM = 9;
const MAX_MONSTERS = 4;
const MONSTER_COLOR = "#c8995a";
// The warm-up (weapon pick, no damage). Shorter after the play test: with ~15 s rounds, 4 s of result and 8 s of
// pick were nearly half the session.
const PICK_S = 5;
const FIRST_PICK_S = 10;
/** Between the rounds of a match when the weapon pick is "Each match only": just the 3-2-1. */
const READY_S = 3;
const RESULT_S = 4;
const MATCH_S = 7;
/** Real seconds after the last KO before the round is called (let the wreck fall). */
const CALL_S = 1.2;
/** Seconds of fight before sudden death: the health_low rule stops, so long rounds end. */
const SUDDEN_DEATH_S = 60;
/** Seconds after sudden death before time runs out: the team with the most health left wins (or a draw). */
const TIME_LIMIT_S = SUDDEN_DEATH_S + 30;
/** A player with no input for this long in a fight is flown by a bot until they touch the stick again. */
const IDLE_S = 8;
/** Body budget for monster waves (each worm is 10 bodies): the TV keeps 60 fps up to about 48 bodies. */
const BODY_BUDGET_LITE = 48;
const BODY_BUDGET = 90;

interface Seat {
  /** Real seconds since this player last moved the stick; an autopilot bot flies the machine while they're away. */
  idle: number;
  /** Fought a round of this match (its loadout is fixed with "Weapon pick: each match only"). */
  fought?: boolean;
  auto: Bot | null;
  id: string;
  name: string;
  color: string;
  human: boolean;
  weapon: WeaponKind;
  sidearm: GunKind | null;
  plate: PlateKind | null;
  /** The gun state last sent to the phone, so it is sent only on a change. */
  gunSig: string;
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
  const stickTune: StickTune = { stick: spec.tune.stick ?? STICK_DEFAULTS.stick, steer: spec.tune.steer ?? STICK_DEFAULTS.steer, hold: spec.tune.hold ?? STICK_DEFAULTS.hold };
  const stickPush = (m: Machine, x: number, y: number) => stickPushFor(arena, m, x, y, stickTune);

  const lite = isWebOS || !!startParam("lite");
  // lite (the TV): 15 joint passes instead of 30. Heavy chains cost about a third less per step; the mean chain
  // stretch goes from 0.05 to 0.1 px (measured, 4 orb maces + plates + a worm), which nobody can see.
  // perf A/B (perf builds only): passes=N joint passes, canvasw=W canvas width (min 320), hud=off, draw=off (the canvas keeps one picture)
  const abPasses = import.meta.env.VITE_PERF === "1" ? Number(startParam("passes")) || 0 : 0;
  const abHudOff = import.meta.env.VITE_PERF === "1" && startParam("hud") === "off";
  const abDrawOff = import.meta.env.VITE_PERF === "1" && startParam("draw") === "off";
  // kos=burst (perf builds): every 6 s in a fight, wreck 3 machines at once (the worst moment for shards and coins)
  const abKoBurst = import.meta.env.VITE_PERF === "1" && startParam("kos") === "burst";
  let koBurstAt = 6;
  const tuning = { ...DEFAULT_TUNING, ...(lite ? { passes: 15, gibs: 3 } : {}), ...(abPasses ? { passes: abPasses } : {}), ...(import.meta.env.VITE_PERF === "1" && startParam("gibs") !== null ? { gibs: Number(startParam("gibs")) || 0 } : {}) };
  const arena = new Arena(tuning);
  // the weapon tours (TV tests only): every melee weapon, or every gun and plate, in turn, with physics, draw and
  // fight numbers in each perf report
  const tourKind = startParam("tour");
  const tour =
    import.meta.env.VITE_PERF === "1" && (tourKind === "melee" || tourKind === "guns")
      ? makeTour(arena, Math.max(2, Math.min(MAX_SEATS, Number(startParam("bots")) || 3)), audio(), Number(startParam("tourfrom")) || 1, tourKind)
      : null;
  // perf A/B (perf builds only): audio=synth (no samples, no file music), nomusic (no file music), nosamples
  const coinsOff = import.meta.env.VITE_PERF === "1" && startParam("coins") === "off";
  const audioAB = import.meta.env.VITE_PERF === "1" ? startParam("audio") : null;
  const sound0 = createGameAudio(audio(), { lite: isWebOS || !!startParam("lite"), samples: audioAB !== "synth" && audioAB !== "nosamples", fileMusic: audioAB !== "synth" && audioAB !== "nomusic" });
  const sound = tour ? tour.wrapSound(sound0) : sound0;
  sound?.setMusicOn(ctx.settings().music !== false);
  /** The material of a machine's striking part, for the hit sound. */
  const materialOf = (m: Machine): Material => {
    if (m.monster) return "stone";
    const w = WEAPONS[m.weapon];
    return (w.parts.find((p) => p.key === w.striker) ?? w.parts[0]!).material;
  };
  // the TV strokes each spark separately on a weak CPU: fewer at once
  const fx = new Fx(lite ? 80 : 240, lite ? 48 : 90);
  const coinPickups: Pickup[] = [];

  // ---- DOM ---------------------------------------------------------------------------------------
  const root = document.createElement("div");
  // hm-lite: the TV skips filters, gradient text and endless animations, which it repaints slowly
  root.className = lite ? "hm-root hm-lite" : "hm-root";
  // HUD layer A/B on the TV (perf builds only): hudfix=layer+noskew (see hammer.css)
  if (import.meta.env.VITE_PERF === "1") for (const f of (startParam("hudfix") ?? "").split("+").filter(Boolean)) root.classList.add(`hm-ab-${f}`);
  root.innerHTML = `<canvas class="hm-canvas"></canvas>`;
  ctx.root.appendChild(root);
  const canvas = root.querySelector<HTMLCanvasElement>(".hm-canvas")!;
  const hud = new Hud(root);
  // The TV draws at 1280 x 720 and lets the screen scale it up; its GPU can't afford a 4K canvas.
  // canvasw=<px>: the canvas width (perf A/B; `res` is a fraction in other games, so not that name)
  const resAB = import.meta.env.VITE_PERF === "1" ? Math.max(0, Number(startParam("canvasw")) || 0) : 0;
  if (resAB && resAB < 320) throw new Error(`canvasw=${resAB}: give the canvas width in pixels (320 or more)`);
  const skipAB = import.meta.env.VITE_PERF === "1" && startParam("skip") ? new Set(startParam("skip")!.split("+")) : undefined;
  const renderer = new Renderer(canvas, { maxDpr: isWebOS ? 1 : 2, maxWidth: resAB || (isWebOS ? 1280 : 4096), names: true, skip: skipAB });

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

  /** What the phone shows of a machine's gun and plates: sent again when it changes. */
  const gunSig = (m: Machine | null) => {
    const g = gunOf(m);
    return `${g ? `${g.ammo}/${g.clip}` : ""}|${m?.alive ? m.plates.length : 0}`;
  };
  const gunOf = (m: Machine | null) => {
    if (!m || !m.armed || !m.guns.length) return null;
    const g = m.guns[0]!;
    return { ammo: g.ammo, clip: g.spec.clip, reloading: g.ammo <= 0 };
  };
  const humanSeat = (p: HostPlayer<HammerGame>): Seat => ({
    id: p.id,
    name: p.name,
    color: colorFor(p.index),
    human: true,
    idle: 0,
    auto: null,
    weapon: "hammer",
    sidearm: null,
    plate: null,
    gunSig: "",
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
    return m === "teams" || m === "pve" || m === "pvm" ? m : "ffa";
  };
  /** The mode of the current round (a change in Settings applies from the next warm-up). */
  let mode: Mode = settingMode();
  // co-op vs monsters: every seat (players and computer allies) is team 0
  const teamOf = (s: Seat): number => (mode === "teams" ? s.slot % 2 : mode === "pve" ? (s.human ? 0 : 1) : mode === "pvm" ? 0 : s.slot);
  const teamName = (t: number): string =>
    t === MONSTER_TEAM ? "The worms" : mode === "teams" ? TEAMS[t]!.name : mode === "pve" || mode === "pvm" ? PVE_TEAMS[t]!.name : "";
  const teamColor = (t: number): string => (t === MONSTER_TEAM ? MONSTER_COLOR : mode === "teams" ? TEAMS[t]!.color : PVE_TEAMS[t]!.color);
  // a waiting player (slot −1) has no team yet: their own colour
  const colorOf = (s: Seat): string => (mode === "teams" && s.slot >= 0 ? TEAMS[s.slot % 2]!.shades[Math.floor(s.slot / 2)]! : s.color);
  /** Computer players wanted: the setting, but at least one enemy in co-op. */
  const botsWanted = () => {
    const n = Number(ctx.settings().bots) || 0;
    return mode === "pve" ? Math.max(1, n) : n;
  };
  // ---- monsters (co-op vs monsters) ----------------------------------------------------------------
  let monsters: Machine[] = [];
  let monsterSerial = 1000;
  const clearMonsters = () => {
    for (const w of monsters) {
      fx.trails.delete(w);
      arena.remove(w);
    }
    monsters = [];
  };
  /** Wave n: 1, 2, 2, 3, 4… worms (at most 4 alive); armoured worms from wave 3. They fly in from the sides. */
  const spawnWave = () => {
    // fit the wave in the body budget (each worm is 10 bodies), but always at least one worm. When heavy weapons
    // leave no room for a full worm, the one worm is shorter (core + jaw + at least 3 segments) to fit what is left.
    const free = (lite ? BODY_BUDGET_LITE : BODY_BUDGET) - arena.world.bodies.length;
    const room = Math.floor(free / 10);
    const n = Math.max(1, Math.min(MAX_MONSTERS, 1 + Math.floor(round / 2), room));
    const segments = room < 1 ? free - 2 : undefined;
    // only at heights where the side is open to the fight (not into a sealed corner behind a slab)
    const rows = openSideRows(arena);
    for (let i = 0; i < n; i++) {
      const kind = round >= 3 && i % 2 === 1 ? "armoredworm" : "worm";
      monsters.push(arena.addMonster({ id: ++monsterSerial, team: MONSTER_TEAM, kind, ...wormSpawn(arena, i, rows), segments }));
    }
  };

  const teamsAlive = () => {
    const t = new Set(seated().filter((s) => s.m?.alive).map(teamOf));
    if (monsters.some((w) => w.alive)) t.add(MONSTER_TEAM);
    return t;
  };
  // co-op vs monsters needs only one player: the worms are the other side
  const teamsSeated = () => {
    const t = new Set(seated().map(teamOf));
    if (mode === "pvm" && t.size) t.add(MONSTER_TEAM);
    return t;
  };
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
      // a personality not yet in the room (the roster has 8, so 7 bots are all different)
      const taken = new Set(bots().map((b) => b.bot?.profile.id));
      const free = ROSTER.filter((p) => !taken.has(p));
      const pid: ProfileId = free[Math.floor(Math.random() * free.length)] ?? ROSTER[n % ROSTER.length]!;
      const kit = profileLoadout(pid);
      seats.set(id, {
        id,
        name: PROFILES[pid].name,
        color: BOT_COLORS[n % BOT_COLORS.length]!,
        human: false,
        idle: 0,
        auto: null,
        weapon: kit.weapon,
        sidearm: kit.gun,
        plate: kit.plate,
        gunSig: "",
        wins: 0,
        slot: -1,
        m: null,
        bot: makeBot("fight", VIEW_W / 2, VIEW_H / 2, pid, botSerial),
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
    // the spawn table is for the classic frame: the same shares of a bigger arena
    const [x, y] = spawnPoint(arena, s.slot);
    if (s.m) {
      arena.respawn(s.m, x, y, s.weapon, s.sidearm, s.plate);
    } else {
      s.m = arena.add({ id: ++machineSerial, name: s.name, color: colorOf(s), weapon: s.weapon, sidearm: s.sidearm, plate: s.plate, x, y });
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
      // co-op vs CPU keeps the last seat for an enemy
      if (mode === "pve" && s.human && seated().filter((x) => x.human).length >= MAX_SEATS - 1) continue;
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
  /** A 3-2-1 between rounds with "Each match only": everyone keeps their weapon (no picks, bots keep theirs). */
  let readyOnly = false;
  /** Real seconds in the current phase. */
  let phaseFor = 0;
  let lastWhole = -1;
  /** The last round's winner: a player (free-for-all) or a team. */
  let winner: { label: string; color: string; id: string | null; team: number } | null = null;
  let callAt = -1;
  /** The round ended because time ran out (decided on health). */
  let timeUp = false;
  let paused = false;
  let hudDirty = true;
  const winsToMatch = () => Number(ctx.settings().wins) || 3;

  const pushOwn = (s: Seat) => {
    if (!s.human || !host.players.has(s.id)) return;
    const g = gunOf(s.m);
    s.gunSig = gunSig(s.m);
    host.setOwn(s.id, {
      color: colorOf(s),
      slot: s.slot,
      team: teamOf(s),
      teamName: mode === "ffa" || s.slot < 0 ? "" : teamName(teamOf(s)),
      weapon: s.weapon,
      sidearm: s.sidearm,
      gun: g,
      plate: s.plate,
      plates: s.m?.alive ? s.m.plates.length : 0,
      hp: s.m ? Math.round(s.m.hp) : MACHINE.health,
      alive: !!s.m && s.m.alive,
      wins: s.wins,
      seated: s.slot >= 0,
      fixed: readyOnly && s.fought,
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
  let arenaKind = "";
  /** Size and obstacles from the Arena setting; the coins and spawns follow the size. */
  const applyArena = () => {
    arenaKind = String(ctx.settings().arena ?? "classic");
    const { w, h } = applyArenaKind(arena, arenaKind);
    fx.coins.w = w;
    fx.coins.h = h;
  };
  const startPick = (seconds = PICK_S) => {
    phase = "pick";
    arena.suddenDeath = false;
    clearMonsters();
    const nextMode = settingMode();
    if (nextMode !== mode) {
      // a new mode starts a new match
      mode = nextMode;
      for (const x of seats.values()) x.wins = 0;
      round = 0;
    }
    round++;
    // the arena is rebuilt for each round (fresh crates; a new Arena choice applies from the next round)
    applyArena(); // every round: broken crates come back
    left = seconds;
    pickTotal = seconds;
    phaseFor = 0;
    lastWhole = -1;
    arena.resetTime(); // the last round may have ended in slow motion
    fx.coins.clear();
    winner = null;
    callAt = -1;
    tuning.damage = 0; // warm-up: fly and swing, no damage
    tuning.slomo = 0;
    applyToggles();
    readyOnly = seconds === READY_S && round > 1;
    if (round === 1) for (const s of seats.values()) s.fought = false;
    // bots take their personality's loadout (mostly its first weapon); a new round gives them a new mood
    for (const s of bots()) {
      if (!s.bot) continue;
      newRound(s.bot);
      if (readyOnly) continue;
      const kit = profileLoadout(s.bot.profile.id);
      s.weapon = kit.weapon;
      s.sidearm = kit.gun;
      s.plate = kit.plate;
    }
    syncBots();
    fillSeats();
    for (const s of seated()) spawn(s);
    for (const s of seats.values()) pushOwn(s);
    pushShared();
    hud.clearFeed();
    sound?.music("warm");
    if (teamsSeated().size >= 2) sound?.sting("round");
    if (teamsSeated().size >= 2)
      hud.announce(
        "round",
        mode === "pvm" ? `Wave ${round}` : `Round ${round}`,
        mode === "ffa" ? "Pick your weapon" : mode === "teams" ? "Red vs Blue" : mode === "pve" ? "Players vs CPU" : "Worms incoming",
        "#ffd84d",
        1800,
      );
    else hud.clearAnnounce();
    hudDirty = true;
  };

  const startFight = () => {
    phase = "fight";
    for (const s of seated()) {
      s.fought = true;
      // time spent on the weapon pick is not "away": a fight starts with the player in control and no old stand-in
      s.idle = 0;
      s.auto = null;
    }
    arena.suddenDeath = false;
    if (mode === "pvm") spawnWave();
    phaseFor = 0;
    tuning.damage = DEFAULT_TUNING.damage;
    tuning.slomo = ctx.settings().slomo === false ? 0 : 1;
    applyToggles();
    for (const s of seated()) spawn(s);
    for (const s of seats.values()) pushOwn(s);
    hud.announce("fight", "Fight!", "", "#ffd84d", 1100);
    sound?.sting("fight");
    sound?.music("fight");
    pushShared();
    hudDirty = true;
  };

  const endRound = () => {
    const alive = teamsAlive();
    let team = alive.size === 1 ? [...alive][0]! : null;
    const byTime = timeUp && alive.size > 1;
    if (byTime) {
      // time ran out: the team with the most health left wins; equal health is a draw
      const hp = new Map<number, number>();
      for (const s of seated()) if (s.m?.alive) hp.set(teamOf(s), (hp.get(teamOf(s)) ?? 0) + s.m.hp);
      const ranked = [...hp.entries()].sort((a, b) => b[1] - a[1]);
      team = ranked.length > 1 && ranked[0]![1] === ranked[1]![1] ? null : (ranked[0]?.[0] ?? null);
    }
    timeUp = false;
    const winners = team === null || team === MONSTER_TEAM ? [] : seated().filter((s) => teamOf(s) === team);
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
    // co-op vs monsters: losing a wave ends the run
    phase = winners.some((w) => w.wins >= winsToMatch()) || (mode === "pvm" && team === MONSTER_TEAM) ? "match" : "result";
    phaseFor = 0;
    left = phase === "match" ? MATCH_S : RESULT_S;
    tuning.slomo = 0;
    for (const s of seats.values()) pushOwn(s);
    pushShared();
    sound?.music("off");
    sound?.sting(phase === "match" ? "champ" : "win");
    if (phase === "match" && mode === "pvm") {
      hud.announce("champ", team === MONSTER_TEAM ? "Game over" : "Victory", team === MONSTER_TEAM ? `The worms got you on wave ${round}` : `${round} waves survived`, winner?.color ?? "#fff", 0);
    } else if (phase === "match") hud.announce("champ", winner!.label, mode === "ffa" ? "Champion" : "Champions", winner!.color, 0);
    else if (winner && mode === "pvm") hud.announce("win", "Wave cleared", `Wave ${round} of ${winsToMatch()}`, winner.color, 0);
    else if (winner) hud.announce("win", `${winner.label} ${/Players$/.test(winner.label) ? "win" : "wins"}`, byTime ? "Time up: most health left" : `Round ${round}`, winner.color, 0);
    else hud.announce("win", "Draw", byTime ? "Time up" : "", "#ffffff", 0);
    hudDirty = true;
  };

  const tickPhase = (real: number) => {
    phaseFor += real;
    if (phase === "fight" && tour) {
      // the tour never ends a round: wrecks come back, and the weapons change every set
      const set = tour.tick(real);
      for (const [i, s] of seated().entries()) {
        if (set) {
          const k = i % set.weapons.length;
          s.weapon = set.weapons[k]!;
          s.sidearm = set.sidearms[k] ?? null;
          s.plate = set.plates[k] ?? null;
          spawn(s);
        } else if (s.m && !s.m.alive && arena.t - s.m.diedAt > 1.5) spawn(s);
      }
      if (set) hudDirty = true;
      return;
    }
    if (phase === "fight") {
      // the round ends when one team (or one machine) is left flying
      if (teamsAlive().size <= 1 && callAt < 0) callAt = CALL_S;
      if (mode !== "pvm" && phaseFor >= TIME_LIMIT_S && callAt < 0) {
        timeUp = true;
        endRound();
        return;
      }
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
      if (phase === "pick" && teamsSeated().size >= 2 && lastWhole >= 1 && lastWhole <= 3) {
        hud.announce("count", String(lastWhole), "", "#ffd84d", 900);
        sound?.sting("count", lastWhole);
      }
    }
    if (left > 0) return;
    if (phase === "pick") startFight();
    else if (phase === "result") startPick(ctx.settings().warmup === "match" ? READY_S : PICK_S);
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
      if (!s) return;
      // "Each match only": the loadout is fixed between the rounds of a match
      // (a player who hasn't fought in this match yet, e.g. one who just joined, still picks once)
      if (readyOnly && phase === "pick" && s.fought) return;
      if (d.type === "weapon" && WEAPON_KINDS.includes(d.weapon)) s.weapon = d.weapon;
      else if (d.type === "gun" && (d.gun === null || GUN_KINDS.includes(d.gun))) s.sidearm = d.gun;
      else if (d.type === "plate" && (d.plate === null || PLATE_KINDS.includes(d.plate))) s.plate = d.plate;
      else return;
      // In warm-up the new weapon appears straight away; otherwise from the next round.
      if (phase === "pick" && s.m) arena.respawn(s.m, s.m.hull.x, s.m.hull.y, s.weapon, s.sidearm, s.plate);
      pushOwn(s);
      hudDirty = true;
    }),
    ctx.onSettings(() => {
      // the toggles apply at once; the mode from the next warm-up
      applyToggles();
      sound?.setMusicOn(ctx.settings().music !== false);
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
    const moving = !!inp && (inp.f === 1 || inp.g === 1 || (inp.k === 1 ? Math.abs(inp.x) + Math.abs(inp.y) > 0.05 : inp.x !== s.tx || inp.y !== s.ty));
    s.idle = moving ? 0 : s.idle + STEP;
    // idle (or phone asleep) in a fight: a bot flies for them, so the round doesn't stall. Not while their phone
    // is on another app or locked (p.away): they're coming back, so their machine just hangs idle
    if (phase === "fight" && s.idle > IDLE_S && !p?.away) {
      s.auto ??= makeBot("fight", m.hull.x, m.hull.y, "pilot", m.id);
      driveBot(arena, m, s.auto);
      if (inp && inp.k === 0) {
        s.tx = inp.x;
        s.ty = inp.y;
      }
      return;
    }
    s.auto = null;
    if (!inp) return;
    if (inp.f === 1) arena.fire(m);
    if (inp.g === 1) arena.shield(m);
    if (inp.k === 1) {
      s.k = 1;
      // with fire held, the stick also aims the guns (sim.ts aim)
      if (inp.f === 1) arena.aim(m, inp.x, inp.y);
      stickPush(m, inp.x, inp.y);
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
        sound?.hit(e.dmg, e.impact, e.cut, materialOf(e.attacker));
        hitFx(e.x, e.y, e.dmg, e.cut, e.victim.color);
        const coins = coinsOff ? 0 : fx.coins.spill(e.x, e.y, e.dmg);
        if (coins) sound?.coin(coins);
        const a = byMachine.get(e.attacker);
        const v = byMachine.get(e.victim);
        if (e.dmg > 0) {
          // (a saw cut with nobody to credit names the victim as its own attacker)
          if (a?.human && e.attacker !== e.victim) host.send(a.id, { type: "hit", dmg: e.dmg });
          if (v?.human) host.send(v.id, { type: "hurt", dmg: e.dmg });
        }
        if (v) pushOwn(v);
      } else if (e.type === "disarm") {
        sound?.disarm();
        fx.burst(e.x, e.y, 24, 360, "#cfe3ff", 2);
        fx.text(e.x, e.y - 20, "DISARMED", "#cfe3ff", 20);
        fx.shake = Math.min(12, fx.shake + 6);
        const v = byMachine.get(e.victim);
        const a = byMachine.get(e.by);
        if (v?.human) host.send(v.id, { type: "hurt", dmg: 0 });
        if (a?.human) host.send(a.id, { type: "hit", dmg: 0 });
        hudDirty = true;
      } else if (e.type === "plateoff") {
        sound?.disarm();
        fx.burst(e.x, e.y, 14, 300, "#cfd6e4", 2);
        fx.text(e.x, e.y - 16, "SHIELD BROKEN", "#cfd6e4", 16);
      } else if (e.type === "blast") {
        sound?.shot(true);
        fx.burst(e.x, e.y, lite ? 18 : 36, 380, "#ffb347", 3);
        fx.burst(e.x, e.y, lite ? 8 : 16, 200, "#fff3c4", 2);
        fx.shake = Math.min(12, fx.shake + 7);
      } else if (e.type === "shot") {
        sound?.shot(e.ball);
        if (e.ball) fx.shake = Math.min(12, fx.shake + 3);
      } else if (e.type === "ping") {
        // a shot spent on a weapon, plate or gun: a spark (and a clank for a heavy one); the bullets of a burst
        // share the clash cooldown, so a stream of them stays cheap
        if (clashCd > 0) continue;
        clashCd = 0.06;
        if (e.heavy) sound?.clash(30);
        fx.burst(e.x, e.y, lite ? 3 : 6, 260, "#ffe9a8", 1.5);
      } else if (e.type === "gunbreak") {
        sound?.disarm();
        fx.burst(e.x, e.y, lite ? 10 : 20, 340, "#ffb347", 2);
        fx.text(e.x, e.y - 16, "GUN BROKEN", "#ffcf8a", 16);
        fx.shake = Math.min(12, fx.shake + 4);
        const v = byMachine.get(e.m);
        const a = byMachine.get(e.by);
        if (v?.human) host.send(v.id, { type: "hurt", dmg: 0 });
        if (a?.human) host.send(a.id, { type: "hit", dmg: 0 });
        hudDirty = true;
      } else if (e.type === "pickup") {
        sound?.pickup();
        const s = byMachine.get(e.m);
        if (s?.human) host.send(s.id, { type: "hit", dmg: 0 });
        hudDirty = true;
      } else if (e.type === "clash") {
        sound?.clash(e.impact);
        // a grind reports a clash every step: sparks at most every 60 ms (and fewer on the TV)
        if (clashCd > 0) continue;
        clashCd = 0.06;
        const n = 4 + Math.min(10, Math.round(e.impact / 10));
        fx.burst(e.x, e.y, lite ? Math.ceil(n / 2) : n, 220, "#cfe3ff", 1.5);
      } else if (e.type === "crack") {
        sound?.hit(e.dmg, e.dmg * 4, 1, "wood");
        fx.burst(e.x, e.y, lite ? 3 : 6, 200, "#c89a5e", 2);
      } else if (e.type === "break") {
        // a crate bursts: splinters (sim) and a handful of coins
        sound?.disarm();
        fx.burst(e.x, e.y, lite ? 12 : 24, 320, "#c89a5e", 2.5);
        fx.shake = Math.min(12, fx.shake + 5);
        const n = coinsOff ? 0 : fx.coins.spill(e.x, e.y, 24);
        if (n) sound?.coin(n);
      } else if (e.type === "slam") {
        // a reeling machine smashed into something: more stun
        sound?.clash(e.impact);
        fx.burst(e.x, e.y, lite ? 6 : 12, 260, "#ffe066", 2);
        fx.shake = Math.min(12, fx.shake + 4);
        const s = byMachine.get(e.m);
        if (s?.human) host.send(s.id, { type: "hurt", dmg: 0 });
      } else if (e.type === "hazard") {
        // a saw cut (the damage, numbers and coins come with its "hit"): a spray of steel sparks
        sound?.clash(60);
        fx.burst(e.x, e.y, lite ? 8 : 16, 340, "#e8eef5", 1.5);
      } else {
        fx.burst(e.x, e.y, 40, 420, "#ffb547", 3);
        fx.burst(e.x, e.y, 16, 200, e.victim.color, 4);
        fx.shake = 14;
        const v = byMachine.get(e.victim);
        const by = e.by ? byMachine.get(e.by) : null;
        if (e.victim.monster) hud.feed(by ? { name: by.name, color: colorOf(by) } : null, { name: e.victim.name, color: MONSTER_COLOR });
        if (v) hud.feed(by ? { name: by.name, color: by.color } : null, { name: v.name, color: v.color });
        sound?.ko();
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

  // Perf test builds (`pnpm tv --perf=hammer`): the shared frame monitor sends the frame rate; add the game's numbers.
  const offPerf = setPerfExtras(() => {
    const rect = canvas.getBoundingClientRect();
    return {
      scale: rect.width ? Math.round((canvas.width / (rect.width * (window.devicePixelRatio || 1))) * 100) / 100 : 1,
      canvas: `${canvas.width}x${canvas.height}`,
      phase,
      machines: arena.machines.length,
      ...(tour ? tour.report() : {}),
    };
  });

  // ---- sound per frame -----------------------------------------------------------------------------
  const stunned = new Set<Machine>();
  const soundFrame = () => {
    if (!sound) return;
    let speed = 0;
    let swing = 0;
    let n = 0;
    for (const m of arena.machines) {
      if (!m.alive) continue;
      n++;
      speed += Math.hypot(m.hull.vx, m.hull.vy);
      if (m.armed) swing = Math.max(swing, Math.hypot(m.striker.vx, m.striker.vy));
      if (m.stun > 0 && !stunned.has(m)) {
        stunned.add(m);
        sound.stun();
      } else if (m.stun <= 0) stunned.delete(m);
    }
    sound.frame(n ? Math.min(1, speed / n / tuning.speedClip) : 0, Math.min(1, swing / 1000), arena.timewarp);
  };

  // ---- loop --------------------------------------------------------------------------------------
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let drewOnce = false;
  if (abHudOff) hud.el.style.display = "none";
  let clashCd = 0;
  /** Frame rate cap for the current state: none while anyone can fight; 30 fps once a result is on screen. */
  const capFps = () => ((phase === "result" || phase === "match") && phaseFor > 1.5 ? 30 : 0);
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    // Paused: the canvas keeps its last picture. Drawing on under the pause menu made the TV redraw the
    // canvas and redo the menu's full-screen backdrop blur every frame, for a still screen.
    if (paused) return;
    const f0 = tour ? performance.now() : 0;
    const cap = capFps();
    if (cap && now - last < 1000 / cap - 4) return;
    const real = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += real;
    // Physics steps this frame. A slow frame means more steps next frame, which makes that frame slower too: on
    // the TV a heavy scene spiralled down to ~19 fps. Lite stops at 3 steps (the game slows down instead, down to
    // 20 fps); elsewhere 5. Time it can't catch up on is dropped.
    const maxSteps = lite ? 3 : 5;
    let steps = 0;
    const l0 = tour ? performance.now() : 0;
    profBegin("physics");
    while (acc >= STEP && steps < maxSteps) {
      for (const s of seated()) readInput(s);
      if (tour) {
        const t0 = performance.now();
        arena.step();
        tour.stepped(performance.now() - t0);
        tour.observe(arena.events);
      } else {
        arena.step();
      }
      clashCd -= STEP;
      handleEvents();
      acc -= STEP;
      steps++;
    }
    if (acc >= STEP) acc %= STEP;
    profEnd("physics");
    const l1 = tour ? performance.now() : 0;
    // the phone shows the ammo: send a gun's state when it changes (a shot, the reload, a lost weapon)
    for (const s of seats.values()) {
      if (!s.human || !s.m) continue;
      if (gunSig(s.m) !== s.gunSig) pushOwn(s);
    }
    if (abKoBurst && phase === "fight" && arena.t > koBurstAt) {
      koBurstAt = arena.t + 6;
      for (const m of arena.machines.filter((x) => x.alive && !x.monster).slice(0, 3)) arena.wreck(m);
    }
    tickPhase(real);
    soundFrame();
    fx.update(real);
    fx.coins.update(real * arena.timewarp, arena.machines, coinPickups);
    for (const c of coinPickups) {
      sound?.coin(0);
      fx.burst(c.x, c.y, lite ? 2 : 5, 90, COIN_LOOK[c.metal]!.fill, 1.5);
    }
    coinPickups.length = 0;
    const d0 = tour ? performance.now() : 0;
    profBegin("draw");
    if (!abDrawOff || !drewOnce) renderer.draw(arena, Math.min(1, acc / STEP), fx);
    profEnd("draw");
    drewOnce = true;
    const d1 = tour ? performance.now() : 0;
    frameDrawn(now);
    profBegin("hud");
    if (!abHudOff) maybeDrawHud();
    profEnd("hud");
    if (tour) {
      const end = performance.now();
      tour.framed(steps, end - d0, end - now, { delay: f0 - now, loop: l1 - l0, mid: d0 - l1, hud: end - d1 });
    }
  };

  startPick(FIRST_PICK_S);
  raf = requestAnimationFrame(frame);
  if (import.meta.env.DEV) (window as unknown as { __rotor: unknown }).__rotor = { host, arena, seats, phase: () => phase, sound, fx, audioCtx: audio() };

  return {
    dispose() {
      offPerf();
      sound?.dispose();
      cancelAnimationFrame(raf);
      removeEventListener("resize", fit);
      offs.forEach((o) => o());
      hud.clearAnnounce(); // its timer
      canvas.width = canvas.height = 0; // let the TV have the canvas memory back now, not at the next GC
      root.remove();
    },
    pause() {
      sound?.pause(true);
      paused = true;
    },
    resume() {
      sound?.pause(false);
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
