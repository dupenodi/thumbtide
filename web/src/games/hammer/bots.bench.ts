// Bot bench (run on request, not in `npm test`): duels between bot profiles in every arena, plus free-for-alls.
//   node --import tsx --test src/games/hammer/bots.bench.ts     (ROUNDS=6 ARENAS=classic,huge ONLY=a,b VS=chaser,spinner FFA=0)
import { test } from "node:test";
import { type Entrant, type RoundResult, runRound, withSeed } from "./botmatch.ts";
import { BENCH_PROFILES } from "./bots.ts";
import { WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const ROUNDS = Number(process.env.ROUNDS) || 6;
const ARENA_LIST = (process.env.ARENAS ?? "classic,crates,big,huge").split(",");
const only = process.env.ONLY?.split(",");
const names = Object.keys(BENCH_PROFILES).filter((n) => !only || only.includes(n));
/** VS=a,b: only the pairs with one of these (every profile against the given opponents). */
const vs = process.env.VS?.split(",");
/** Per profile, over every round it played: totals for the identity table. */
const per = new Map<string, { n: number; dealt: number; hits: number; big: number; stunned: number; edge: number; secs: number }>();
function note(r: RoundResult) {
  for (const s of r.stats) {
    const x = per.get(s.name) ?? { n: 0, dealt: 0, hits: 0, big: 0, stunned: 0, edge: 0, secs: 0 };
    x.n++;
    x.dealt += s.dealt;
    x.hits += s.hits;
    x.big = Math.max(x.big, s.bigHit);
    x.stunned += s.stunned;
    x.edge += s.edge;
    x.secs += r.seconds;
    per.set(s.name, x);
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);

function entrant(name: string, seed: number): Entrant {
  const p = BENCH_PROFILES[name]!;
  // WEAPON=<kind>: everyone gets this weapon (tells a style's strength from its weapon's)
  const weapon: WeaponKind = (process.env.WEAPON as WeaponKind | undefined) ?? p.weapon(seed) ?? WEAPON_KINDS[seed % WEAPON_KINDS.length]!;
  return { name, weapon, sidearm: p.sidearm?.(seed) ?? null, plate: p.plate?.(seed) ?? null, driver: p.driver };
}

test("bot duels", () => {
  const all: RoundResult[] = [];
  const wins = new Map<string, number>();
  const games = new Map<string, number>();
  const rows: string[] = [];
  for (let a = 0; a < names.length; a++) {
    for (let b = a + 1; b < names.length; b++) {
      if (vs && !vs.includes(names[a]!) && !vs.includes(names[b]!)) continue;
      let wa = 0;
      let wb = 0;
      let n = 0;
      for (const arena of ARENA_LIST) {
        for (let r = 0; r < ROUNDS; r++) {
          // each pair plays both sides of the spawn, with the same weapon draw
          const seed = 1000 * r + 17 * a + 31 * b + arena.length;
          const swap = r % 2 === 1;
          const ea = entrant(names[a]!, seed);
          const eb = entrant(names[b]!, seed + 1);
          const res = withSeed(seed, () => runRound({ arena, entrants: swap ? [eb, ea] : [ea, eb] }));
          all.push(res);
          note(res);
          const wName = res.winner < 0 ? null : res.stats[res.winner]!.name;
          if (wName === names[a]) wa++;
          if (wName === names[b]) wb++;
          n++;
        }
      }
      wins.set(names[a]!, (wins.get(names[a]!) ?? 0) + wa);
      wins.set(names[b]!, (wins.get(names[b]!) ?? 0) + wb);
      games.set(names[a]!, (games.get(names[a]!) ?? 0) + n);
      games.set(names[b]!, (games.get(names[b]!) ?? 0) + n);
      rows.push(`${names[a]!.padEnd(12)} vs ${names[b]!.padEnd(12)} ${String(wa).padStart(3)} : ${String(wb).padEnd(3)} (draws ${n - wa - wb})`);
    }
  }
  console.log("\nDUELS (both spawn sides, every arena)\n" + rows.join("\n"));
  console.log("\nWIN RATE\n" + names.map((n) => `${n.padEnd(12)} ${pct((wins.get(n) ?? 0) / Math.max(1, games.get(n) ?? 1))}`).join("\n"));
  summary("duels", all);
  console.log("\nPER PROFILE (duels): damage/min · hits/min · damage per hit · biggest · stunned % · edge %");
  for (const n of names) {
    const x = per.get(n);
    if (!x) continue;
    const min = x.secs / 60;
    console.log(`${n.padEnd(12)} ${(x.dealt / min).toFixed(0).padStart(4)} ${(x.hits / min).toFixed(0).padStart(4)} ${(x.dealt / Math.max(1, x.hits)).toFixed(1).padStart(5)} ${String(x.big).padStart(4)} ${((x.stunned * 100) / x.secs).toFixed(0).padStart(4)}% ${((x.edge * 100) / x.secs).toFixed(0).padStart(4)}%`);
  }
});

test("bot free-for-all", () => {
  if (process.env.FFA === "0" || names.length < 3) return;
  const all: RoundResult[] = [];
  const wins = new Map<string, number>();
  for (const arena of ARENA_LIST) {
    for (let r = 0; r < ROUNDS; r++) {
      const seed = 5000 + 97 * r + arena.length;
      // up to 7 machines: the roster in a rotating order (spawn points matter)
      const roster = names.map((_, i) => names[(i + r) % names.length]!).slice(0, 7);
      const res = withSeed(seed, () => runRound({ arena, entrants: roster.map((n, i) => entrant(n, seed + i)) }));
      all.push(res);
      if (res.winner >= 0) wins.set(res.stats[res.winner]!.name, (wins.get(res.stats[res.winner]!.name) ?? 0) + 1);
    }
  }
  console.log(`\nFREE-FOR-ALL wins (${all.length} rounds)\n` + names.map((n) => `${n.padEnd(12)} ${wins.get(n) ?? 0}`).join("\n"));
  summary("free-for-all", all);
});

function summary(label: string, rs: RoundResult[]) {
  const mean = (f: (r: RoundResult) => number) => rs.reduce((s, r) => s + f(r), 0) / Math.max(1, rs.length);
  console.log(
    `\n${label.toUpperCase()}: ${rs.length} rounds Â· ${mean((r) => r.seconds).toFixed(1)} s mean Â· time up ${pct(mean((r) => (r.timeUp ? 1 : 0)))} Â· hits/min ${mean((r) => r.hitsPerMin).toFixed(0)} Â· quiet ${pct(mean((r) => r.quiet))} Â· lead changes ${mean((r) => r.leadChanges).toFixed(2)} Â· comebacks ${pct(mean((r) => (r.comeback ? 1 : 0)))} Â· slams ${mean((r) => r.slams).toFixed(1)} Â· stunned ${mean((r) => r.stats.reduce((s, x) => s + x.stunned, 0) / r.stats.length).toFixed(1)} s Â· edge ${mean((r) => r.stats.reduce((s, x) => s + x.edge, 0) / r.stats.length / r.seconds).toFixed(2)}`,
  );
}
