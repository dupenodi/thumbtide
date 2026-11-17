// Mode bench (run on request, not in `npm test`): the other modes than free-for-all, headless, with gun loadouts.
//   node --import tsx --test src/games/hammer/modes.bench.ts     (ROUNDS=8 ARENAS=classic,crates GUNS=0 drops all guns)
// teams: 2 v 2 (host.ts "teams": team collision on, friendly fire off); pve: two chasers (phone-like players) against
// two CPU personalities; pvm: three bots against worms (host.ts "pvm").
import { test } from "node:test";
import { type Entrant, type RoundResult, runRound, withSeed } from "./botmatch.ts";
import { BENCH_PROFILES } from "./bots.ts";
import type { GunKind, WeaponKind } from "./weapons.ts";

const ROUNDS = Number(process.env.ROUNDS) || 8;
const ARENAS = (process.env.ARENAS ?? "classic,crates,big").split(",");
const GUNS = process.env.GUNS !== "0";

function ent(name: string, team: number, seed: number, weapon?: WeaponKind, gun?: GunKind | null): Entrant {
  const p = BENCH_PROFILES[name]!;
  const sidearm = gun !== undefined ? gun : (p.sidearm?.(seed) ?? null);
  return { name, team, weapon: weapon ?? p.weapon(seed) ?? "hammer", sidearm: GUNS ? sidearm : null, plate: p.plate?.(seed) ?? null, driver: p.driver };
}

interface Row {
  label: string;
  rounds: RoundResult[];
  side: (r: RoundResult) => string;
}

function report(row: Row, ents: (seed: number) => Entrant[]) {
  const wins = new Map<string, number>();
  for (const r of row.rounds) {
    const k = row.side(r);
    wins.set(k, (wins.get(k) ?? 0) + 1);
  }
  const n = row.rounds.length;
  const mean = (f: (r: RoundResult) => number) => row.rounds.reduce((s, r) => s + f(r), 0) / Math.max(1, n);
  const names = ents(1).map((e) => `${e.name}${e.sidearm ? `+${e.sidearm}` : ""}(t${e.team})`);
  // damage split per entrant slot: total and by shots
  const dealt = names.map((_, i) => mean((r) => r.stats[i]?.dealt ?? 0));
  const shot = names.map((_, i) => mean((r) => r.stats[i]?.shotDealt ?? 0));
  console.log(
    `\n${row.label}: ${n} rounds · ${mean((r) => r.seconds).toFixed(1)} s · ${[...wins].map(([k, v]) => `${k} ${Math.round((v * 100) / n)}%`).join(" · ")} · guns broken ${mean((r) => r.gunBreaks).toFixed(2)}/round` +
      `\n  ${names.map((nm, i) => `${nm} dmg ${dealt[i]!.toFixed(0)} (shots ${shot[i]!.toFixed(0)})`).join(" · ")}`,
  );
}

function play(label: string, ents: (seed: number) => Entrant[], side: (r: RoundResult, e: Entrant[]) => string, monsters = 0, tuning = {}) {
  const rounds: RoundResult[] = [];
  const sides: string[] = [];
  for (const arena of ARENAS) {
    for (let r = 0; r < ROUNDS; r++) {
      const seed = 7000 + 131 * r + arena.length;
      const es = ents(seed);
      const res = withSeed(seed, () => runRound({ arena, entrants: es, monsters, tuning: { teamCollision: 1, teamDamage: 0, ...tuning } }));
      rounds.push(res);
      sides.push(side(res, es));
    }
  }
  let i = 0;
  report({ label, rounds, side: () => sides[i++]! }, ents);
}

/** The team still standing (or with the most total health at the time limit). */
const teamSide = (r: RoundResult, es: Entrant[]): string => {
  const hp = new Map<number, number>();
  r.stats.forEach((s, i) => hp.set(es[i]!.team!, (hp.get(es[i]!.team!) ?? 0) + (s.alive ? s.hpEnd : 0)));
  const ranked = [...hp].sort((a, b) => b[1] - a[1]);
  return ranked[0]![1] === ranked[1]?.[1] ? "draw" : `team ${ranked[0]![0]}`;
};

test("modes with guns", () => {
  play("TEAMS guns v melee: lance+jackal v thump+krank", (s) => [ent("lance", 0, s), ent("thump", 1, s + 1), ent("jackal", 0, s + 2), ent("krank", 1, s + 3)], teamSide);
  play("TEAMS guns v guns: flak+jackal v lance+razor(mortar)", (s) => [ent("flak", 0, s), ent("lance", 1, s + 1), ent("jackal", 0, s + 2), ent("razor", 1, s + 3, undefined, "mortar")], teamSide);
  play("TEAMS heavy mortar: bulwark(heavymortar)+thump v krank+dervish", (s) => [ent("bulwark", 0, s, undefined, "heavymortar"), ent("krank", 1, s + 1), ent("thump", 0, s + 2), ent("dervish", 1, s + 3)], teamSide);
  play("PVE players(chaser+arquebus, chaser+mortar) v CPU(lance, jackal)", (s) => [ent("chaser", 0, s, "hammer", "arquebus"), ent("lance", 1, s + 1), ent("chaser", 0, s + 2, "axe", "mortar"), ent("jackal", 1, s + 3)], teamSide);
  play("PVM gun bots (lance, jackal, flak) v 3 worms", (s) => [ent("lance", 0, s), ent("jackal", 0, s + 1), ent("flak", 0, s + 2)], (r) => (r.monstersWon ? "worms" : "bots"), 3);
  play("PVM melee bots (thump, krank, razor) v 3 worms", (s) => [ent("thump", 0, s), ent("krank", 0, s + 1), ent("razor", 0, s + 2)], (r) => (r.monstersWon ? "worms" : "bots"), 3);
});
