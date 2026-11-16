// Personality tuner (run on request): pushes one personality's numbers to its strongest values against a fixed pool
// (the old bot at full stick power, two human-like pilots, the plain skill core, and the other personalities).
// Coordinate search with fixed seeds; prints the best values as a line to paste into PROFILES.
//   node --import tsx src/games/hammer/bots.tune.ts dervish      (SEEDS=6 PASSES=2 ARENAS=classic,crates)
import { type Entrant, runRound, withSeed } from "./botmatch.ts";
import { BENCH_PROFILES, PROFILES, type ProfileId, TUNABLE } from "./bots.ts";
import { WEAPON_KINDS, type WeaponKind } from "./weapons.ts";

const id = process.argv[2] as ProfileId;
if (!PROFILES[id]) throw new Error(`unknown profile ${id}`);
const SEEDS = Number(process.env.SEEDS) || 6;
const PASSES = process.env.PASSES === undefined ? 2 : Number(process.env.PASSES);
const ARENAS = (process.env.ARENAS ?? "classic,crates").split(",");
const pool = (process.env.POOL ?? "classic600,chaser,spinner,pilot,dervish,thump,razor,krank,lance,bulwark,flak,jackal").split(",").filter((n) => n !== id);
const SEED0 = Number(process.env.SEED0) || 0;

function entrant(name: string, seed: number): Entrant {
  const p = BENCH_PROFILES[name]!;
  const weapon: WeaponKind = p.weapon(seed) ?? WEAPON_KINDS[seed % WEAPON_KINDS.length]!;
  return { name, weapon, sidearm: p.sidearm?.(seed) ?? null, plate: p.plate?.(seed) ?? null, driver: p.driver };
}

/** Win rate against the pool, plus a quarter of the mean health margin (fewer ties between close settings). */
function score(): { s: number; win: number; per: Record<string, number> } {
  let wins = 0;
  let n = 0;
  let margin = 0;
  const per: Record<string, number> = {};
  for (const opp of pool) {
    let w = 0;
    let k = 0;
    for (const arena of ARENAS) {
      for (let r = 0; r < SEEDS; r++) {
        const seed = SEED0 + 7000 + 131 * r + arena.length * 17 + opp.length;
        const me = entrant(id, seed);
        // SELF=<weapon>: this personality with that weapon (pick its best loadout)
        if (process.env.SELF) me.weapon = process.env.SELF as WeaponKind;
        const them = entrant(opp, seed + 1);
        const swap = r % 2 === 1;
        const res = withSeed(seed, () => runRound({ arena, entrants: swap ? [them, me] : [me, them] }));
        const mi = swap ? 1 : 0;
        if (res.winner === mi) w++;
        margin += (res.stats[mi]!.hpEnd - res.stats[1 - mi]!.hpEnd) / 100;
        k++;
      }
    }
    per[opp] = w / k;
    wins += w;
    n += k;
  }
  return { s: wins / n + (0.25 * margin) / n, win: wins / n, per };
}

const BOUNDS: Record<string, [number, number]> = {
  standoff: [0.6, 1.6],
  gap: [0, 160],
  gate: [0.2, 1.1],
  pumpMove: [0, 1],
  dodge: [0, 0.6],
  commit: [0.2, 4],
  wStunned: [0, 5],
  wWeak: [0, 4],
  lead: [0, 0.4],
  window: [0, 0.3],
  pull: [1 / 300, 1 / 20],
  stepV: [150, 700],
};

const prof = PROFILES[id] as unknown as Record<string, number>;
let best = score();
console.log(`${id} start: score ${best.s.toFixed(3)} win ${(best.win * 100).toFixed(0)}% ${JSON.stringify(Object.fromEntries(Object.entries(best.per).map(([k, v]) => [k, Math.round(v * 100)])))}`);
for (let pass = 0; pass < PASSES; pass++) {
  const f = pass === 0 ? 0.35 : 0.18;
  for (const key of TUNABLE) {
    const [lo, hi] = BOUNDS[key]!;
    const v0 = prof[key]!;
    for (const mul of [1 - f, 1 + f, ...(v0 === 0 ? [NaN] : [])]) {
      // a zero value: try a small step up instead of a multiple
      const v = Number.isNaN(mul) ? lo + (hi - lo) * 0.15 : Math.max(lo, Math.min(hi, v0 * mul));
      if (Math.abs(v - prof[key]!) < 1e-9) continue;
      const keep = prof[key]!;
      prof[key] = v;
      const r = score();
      if (r.s > best.s + 0.005) {
        best = r;
        console.log(`  ${key} ${keep.toFixed(3)} → ${v.toFixed(3)}: score ${r.s.toFixed(3)} win ${(r.win * 100).toFixed(0)}%`);
      } else prof[key] = keep;
    }
  }
}
console.log(`${id} end: score ${best.s.toFixed(3)} win ${(best.win * 100).toFixed(0)}% ${JSON.stringify(Object.fromEntries(Object.entries(best.per).map(([k, v]) => [k, Math.round(v * 100)])))}`);
console.log(`TUNED ${id} ${JSON.stringify(Object.fromEntries(TUNABLE.map((k) => [k, Math.round(prof[k]! * 1000) / 1000])))}`);
