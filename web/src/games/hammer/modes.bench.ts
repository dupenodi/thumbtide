// Play test of every mode with computer players (run on request, not in `npm test`): free for all, teams, co-op vs
// CPU and co-op vs monsters, in every arena. The "players" are the away-player autopilot (the pilot profile).
//   node --import tsx --test src/games/hammer/modes.bench.ts     (ROUNDS=3 ARENAS=classic,eye MODES=ffa,pvm BOTS=4 MIX=1)
import { test } from "node:test";
import { type Entrant, modeTeams, type RoundResult, runRound, withSeed } from "./botmatch.ts";
import { ARENAS } from "./arenas.ts";
import { BENCH_PROFILES, ROSTER } from "./bots.ts";
import { WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const ROUNDS = Number(process.env.ROUNDS) || 3;
const ARENA_LIST = (process.env.ARENAS ?? Object.keys(ARENAS).join(",")).split(",");
const MODES = (process.env.MODES ?? "ffa,teams,pve,pvm").split(",") as ("ffa" | "teams" | "pve" | "pvm")[];
/** Machines per round (the TV target is 4 bots; 8 seats at most). */
const N = Number(process.env.BOTS) || 4;
const MIX = process.env.MIX === "1";

function entrant(name: string, seed: number, team: number): Entrant {
  const p = BENCH_PROFILES[name]!;
  const weapon: WeaponKind = p.weapon(seed) ?? WEAPON_KINDS[seed % WEAPON_KINDS.length]!;
  return { name, weapon, sidearm: p.sidearm?.(seed) ?? null, plate: p.plate?.(seed) ?? null, driver: p.driver, team };
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const mean = (rs: RoundResult[], f: (r: RoundResult) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length);

function line(label: string, rs: RoundResult[]): string {
  return (
    `${label.padEnd(16)} ${String(rs.length).padStart(3)} rnd · ${mean(rs, (r) => r.seconds).toFixed(1).padStart(5)} s · time up ${pct(mean(rs, (r) => (r.timeUp ? 1 : 0)))}` +
    ` · hits/min ${mean(rs, (r) => r.hitsPerMin).toFixed(0).padStart(3)} · spread ${pct(mean(rs, (r) => r.spreadShare))} diag · pile ${pct(mean(rs, (r) => r.pile))}` +
    ` · stuck ${mean(rs, (r) => r.stuck).toFixed(1).padStart(4)} s · slams ${mean(rs, (r) => r.slams).toFixed(1).padStart(4)}` +
    ` · hazard hits ${mean(rs, (r) => r.hazardHits).toFixed(1)} KOs ${mean(rs, (r) => r.hazardKos).toFixed(2)}` +
    (rs[0]?.breakables ? ` · broken ${mean(rs, (r) => r.breaks).toFixed(1)}/${rs[0].breakables}` : "") +
    (rs[0]?.monsters ? ` · worms killed ${mean(rs, (r) => r.monsterKos).toFixed(1)}/${mean(rs, (r) => r.monsters).toFixed(1)}` : "")
  );
}

test("every mode in every arena", () => {
  const byMode = new Map<string, RoundResult[]>();
  for (const mode of MODES) {
    const rows: string[] = [];
    for (const arena of ARENA_LIST) {
      const rs: RoundResult[] = [];
      for (let r = 0; r < ROUNDS; r++) {
        const seed = 7000 + 131 * r + arena.length * 7 + mode.length;
        // co-op: two "players" (the autopilot) with the bots against them (pve) or beside them (pvm)
        const humans = mode === "pve" || mode === "pvm" ? 2 : 0;
        const teams = modeTeams(mode, N, humans);
        // MIX=1: every other machine is a human-like pilot (chaser, spinner), which follows no crowd rule
        const pick = (i: number) => (i < humans ? "pilot" : MIX && i % 2 === 1 ? (["chaser", "spinner"] as const)[(i >> 1) % 2]! : ROSTER[(i + r) % ROSTER.length]!);
        const es = teams.map((team, i) => entrant(pick(i), seed + i, team));
        const worms = mode === "pvm" ? Math.min(4, 1 + Math.floor((r + 2) / 2)) : 0;
        rs.push(withSeed(seed, () => runRound({ arena, entrants: es, worms, armored: r >= 1 })));
      }
      rows.push(line(arena, rs));
      byMode.set(mode, [...(byMode.get(mode) ?? []), ...rs]);
    }
    console.log(`\n${mode.toUpperCase()} (${N} machines)\n${rows.join("\n")}`);
  }
  console.log("\nALL ARENAS");
  for (const [m, rs] of byMode) console.log(line(m, rs));
});
