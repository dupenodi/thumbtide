// Speed and rhythm bench (run on request, not in `npm test`): how fast each driver flies, how hard it holds the stick
// and how it moves against its nearest enemy (closing, opening, hanging back), in every mode.
//   node --import tsx --test src/games/hammer/speed.bench.ts     (ROUNDS=4 ARENAS=classic,crates MODES=ffa,mix,pvm)
// Modes: ffa, teams, pve, pvm as host.ts; mix = free for all of two bots against the two human-like pilots (chaser,
// spinner), the speed reference. Counts only frames where the machine is alive and not stunned (a stunned hull is
// thrown, not flown).
import { test } from "node:test";
import { ARENAS } from "./arenas.ts";
import { type Entrant, modeTeams, type RoundResult, runRound, withSeed } from "./botmatch.ts";
import { BENCH_PROFILES, PHASE_DIST, PHASE_FRAMES, ROSTER } from "./bots.ts";
import { WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const ROUNDS = Number(process.env.ROUNDS) || 4;
const ARENA_LIST = (process.env.ARENAS ?? "classic,crates,big,eye").split(",").filter((a) => a in ARENAS);
const MODES = (process.env.MODES ?? "ffa,mix,teams,pve,pvm").split(",") as ("ffa" | "mix" | "teams" | "pve" | "pvm")[];

function entrant(name: string, seed: number, team: number): Entrant {
  const p = BENCH_PROFILES[name]!;
  const weapon: WeaponKind = p.weapon(seed) ?? WEAPON_KINDS[seed % WEAPON_KINDS.length]!;
  return { name, weapon, sidearm: p.sidearm?.(seed) ?? null, plate: p.plate?.(seed) ?? null, driver: p.driver, team };
}

interface Acc {
  hist: number[];
  dist: number[];
  input: number;
  sat: number;
  turn: number;
  closing: number;
  opening: number;
  frames: number;
  rounds: number;
  wins: number;
  dealt: number;
}
const per = new Map<string, Acc>();
function note(r: RoundResult, winners: Set<number>) {
  r.stats.forEach((s, i) => {
    const a = per.get(s.name) ?? { hist: new Array(25).fill(0), dist: new Array(13).fill(0), input: 0, sat: 0, turn: 0, closing: 0, opening: 0, frames: 0, rounds: 0, wins: 0, dealt: 0 };
    for (let k = 0; k < 25; k++) a.hist[k]! += s.speedHist[k]!;
    for (let k = 0; k < 13; k++) a.dist[k]! += s.distHist[k]!;
    a.input += s.inputSum;
    a.sat += s.saturated;
    a.turn += s.turnSum;
    a.closing += s.closing;
    a.opening += s.opening;
    a.frames += s.frames;
    a.rounds++;
    a.dealt += s.dealt;
    if (winners.has(i)) a.wins++;
    per.set(s.name, a);
  });
}
const quant = (h: number[], q: number, bin: number) => {
  const n = h.reduce((x, y) => x + y, 0) || 1;
  let c = 0;
  for (let k = 0; k < h.length; k++) {
    c += h[k]!;
    if (c >= q * n) return (k + 0.5) * bin;
  }
  return h.length * bin;
};
const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const mean = (rs: RoundResult[], f: (r: RoundResult) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length);

test("speed and rhythm", () => {
  const out: string[] = [];
  for (const mode of MODES) {
    const rs: RoundResult[] = [];
    for (const arena of ARENA_LIST) {
      for (let r = 0; r < ROUNDS; r++) {
        const seed = 9100 + 131 * r + arena.length * 7 + mode.length;
        const humans = mode === "pve" || mode === "pvm" ? 2 : 0;
        const teams = mode === "mix" ? [0, 1, 2, 3] : modeTeams(mode, 4, humans);
        const pick = (i: number) => (mode === "mix" && i % 2 === 1 ? (i === 1 ? "chaser" : "spinner") : i < humans ? "pilot" : ROSTER[(i + r * 3 + arena.length) % ROSTER.length]!);
        const es = teams.map((team, i) => entrant(pick(i), seed + i, team));
        const worms = mode === "pvm" ? Math.min(4, 1 + Math.floor((r + 2) / 2)) : 0;
        const res = withSeed(seed, () => runRound({ arena, entrants: es, monsters: worms, armored: r >= 1, wave: mode === "pvm" ? r + 2 : 0, limit: mode === "pvm" ? 120 : 90 }));
        rs.push(res);
        const win = new Set<number>();
        if (res.winner >= 0 && mode !== "pvm") es.forEach((e, i) => e.team === es[res.winner]!.team && win.add(i));
        note(res, win);
      }
    }
    out.push(
      `${mode.padEnd(6)} ${String(rs.length).padStart(3)} rnd · ${mean(rs, (r) => r.seconds).toFixed(1).padStart(5)} s · time up ${pct(mean(rs, (r) => (r.timeUp ? 1 : 0)))} · hits/min ${mean(rs, (r) => r.hitsPerMin).toFixed(0).padStart(3)}` +
        ` · quiet ${pct(mean(rs, (r) => r.quiet))} · pile ${pct(mean(rs, (r) => r.pile))} · stuck ${mean(rs, (r) => r.stuck).toFixed(1)} s` +
        (mode === "pvm" ? ` · worms ${mean(rs, (r) => r.monsterKos).toFixed(1)}/${mean(rs, (r) => r.monsters).toFixed(1)} · lost ${pct(mean(rs, (r) => (r.monstersWon ? 1 : 0)))}` : ""),
    );
  }
  console.log(`\nMODES (${ARENA_LIST.join(",")})\n${out.join("\n")}`);
  console.log(
    "\nPER DRIVER (alive, not stunned; clip 550 px/s) · fast = over 440 px/s · stick = mean input share of the 420 cap, sat = at the cap" +
      "\n· turn = mean turn rate of the input (rad/s) · near = nearest enemy under 150 px, d50 = its median distance · in/out = closing/opening over 60 px/s",
  );
  for (const [name, a] of [...per].sort((x, y) => x[0].localeCompare(y[0]))) {
    const n = a.frames || 1;
    let sum = 0;
    for (let k = 0; k < 25; k++) sum += a.hist[k]! * (k + 0.5) * 25;
    let fast = 0;
    for (let k = 18; k < 25; k++) fast += a.hist[k]!;
    const dn = a.dist.reduce((x, y) => x + y, 0) || 1;
    console.log(
      `${name.padEnd(9)} ${String(a.rounds).padStart(3)} rnd · mean ${(sum / n).toFixed(0).padStart(3)} · p50 ${quant(a.hist, 0.5, 25).toFixed(0).padStart(3)} · p90 ${quant(a.hist, 0.9, 25).toFixed(0).padStart(3)}` +
        ` · fast ${pct(fast / n)} · stick ${pct(a.input / n)} sat ${pct(a.sat / n)} · turn ${(a.turn / n).toFixed(1).padStart(4)}` +
        ` · near ${pct((a.dist[0]! + a.dist[1]! + a.dist[2]!) / dn)} d50 ${quant(a.dist, 0.5, 50).toFixed(0).padStart(3)} · in ${pct(a.closing / n)} out ${pct(a.opening / n)}` +
        ` · dmg/rnd ${(a.dealt / a.rounds).toFixed(0).padStart(3)} · wins ${a.wins}`,
    );
  }
  console.log("\nPHASES (share of armed frames with a target)");
  for (const [id, f] of PHASE_FRAMES) {
    const n = f.engage + f.back + f.charge + f.whirl || 1;
    const g = PHASE_DIST.get(id)!;
    const d = (k: keyof typeof f) => (f[k] ? (g[k] / f[k]).toFixed(0) : "-").padStart(4);
    console.log(
      `${id.padEnd(9)} engage ${pct(f.engage / n)} at ${d("engage")} px · back ${pct(f.back / n)} at ${d("back")} · charge ${pct(f.charge / n)} at ${d("charge")} · whirl ${pct(f.whirl / n)} at ${d("whirl")}`,
    );
  }
});
