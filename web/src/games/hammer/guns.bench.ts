// Gun bench (run on request, not in `npm test`; GUNS_REVIEW.md).
// 1. Range: every gun against a target that holds its place at a few ranges. Both machines hold their spot through the
//    phone-stick model; the shooter holds fire and aims at the target (with a lead), as a phone does. Per gun and range,
//    over SECONDS: volleys, where each projectile went (landed: a hull hit or a blast that reached the target; blocked:
//    stopped by its weapon or plate and never landed; lost), damage, the time to the first hit and to 50 damage, the
//    push and stun a hit gives, the recoil on the shooter, how far off the aim the shots left (all, and the first one,
//    fired after the gun swings round from its rest), and how far the shooter drifted.
// 2. Duels: a gun personality with each gun (and the tribune) against melee personalities (FIGHT=0 skips).
//   node --import tsx --test src/games/hammer/guns.bench.ts     (GUNS=mortar,launcher RANGES=150,300 SECONDS=12 RUNS=6)
import { test } from "node:test";
import { stickPush } from "./arenas.ts";
import { runRound, withSeed } from "./botmatch.ts";
import { BENCH_PROFILES } from "./bots.ts";
import { Arena, type Machine, STEP } from "./sim.ts";
import { DEFAULT_TUNING } from "./tuning.ts";
import { GUN_KINDS, type GunKind, type WeaponKind } from "./weapons.ts";

const GUNS = (process.env.GUNS ?? GUN_KINDS.join(",")).split(",") as GunKind[];
const RANGES = (process.env.RANGES ?? "150,300,450").split(",").map(Number);
const SECONDS = Number(process.env.SECONDS) || 12;
const RUNS = Number(process.env.RUNS) || 6;
/** The target's weapon (it hangs below it and can catch shots). */
const TARGET = (process.env.TARGET ?? "hammer") as WeaponKind;

/** Hold a point: a stick toward it, eased by the hull's own speed. */
function hold(a: Arena, m: Machine, x: number, y: number): void {
  const sx = (x - m.hull.x) / 60 - m.hull.vx / 250;
  const sy = (y - m.hull.y) / 60 - m.hull.vy / 250;
  const l = Math.hypot(sx, sy);
  if (l > 0.02) stickPush(a, m, sx / Math.max(1, l), sy / Math.max(1, l));
}

// ---------------------------------------------------------------- projectile fates
/** Per projectile of the watched shooter: 1 blocked by an enemy's weapon or plate, 2 landed on an enemy. */
let fate = new Map<object, number>();
let owner: Machine | null = null;
// biome-ignore lint/suspicious/noExplicitAny: wrapping private methods (bench only)
const ArenaP = Arena.prototype as unknown as Record<string, (...a: any[]) => unknown>;
interface ShotTag {
  m: Machine;
  shot: { contacts: number; maxContacts: number };
}
interface OtherTag {
  m: Machine;
  hull: boolean;
  loose?: boolean;
}

/** Watch where the shooter's projectiles go: wraps the arena's shot contact and blast (bench only). */
function watch(): () => void {
  const shotHit = ArenaP.shotHit!;
  const blast = ArenaP.blast!;
  ArenaP.shotHit = function (this: Arena, sBody: unknown, st: ShotTag, oBody: unknown, ot: OtherTag, c: unknown) {
    const sh = st.shot;
    if (owner && st.m === owner && ot.m !== owner && ot.m.team !== owner.team && ot.m.alive && sh.contacts < sh.maxContacts && !ot.loose) {
      fate.set(sh, Math.max(fate.get(sh) ?? 0, ot.hull ? 2 : 1));
    }
    return shotHit.call(this, sBody, st, oBody, ot, c);
  };
  ArenaP.blast = function (this: Arena, sh: { body: { x: number; y: number; data: ShotTag }; blast: { radius: number } }) {
    if (owner && sh.body.data.m === owner) {
      for (const m of this.machines) {
        if (m !== owner && m.alive && m.team !== owner.team && Math.hypot(m.hull.x - sh.body.x, m.hull.y - sh.body.y) < sh.blast.radius) fate.set(sh, 2);
      }
    }
    return blast.call(this, sh);
  };
  return () => {
    ArenaP.shotHit = shotHit;
    ArenaP.blast = blast;
  };
}
function fates(): [number, number] {
  let landed = 0;
  let blocked = 0;
  for (const v of fate.values()) {
    if (v === 2) landed++;
    else if (v === 1) blocked++;
  }
  fate = new Map();
  return [landed, blocked];
}

// ---------------------------------------------------------------- 1. range
interface Row {
  volleys: number;
  pellets: number;
  landed: number;
  blocked: number;
  dmg: number;
  first: number;
  to50: number;
  push: number;
  pushN: number;
  stun: number;
  recoil: number;
  recoilN: number;
  aimErr: number;
  firstErr: number;
  drift: number;
}

function run(gun: GunKind, D: number, seed: number): Row {
  const a = new Arena({ ...DEFAULT_TUNING });
  a.setArena(1600, 900, []);
  // the target off to one side and a little above or below
  const ang = ((seed % 5) - 2) * 0.25;
  const sx0 = 800 - (Math.cos(ang) * D) / 2;
  const sy0 = 450 - (Math.sin(ang) * D) / 2;
  const tx0 = 800 + (Math.cos(ang) * D) / 2;
  const ty0 = 450 + (Math.sin(ang) * D) / 2;
  const s = a.add({ id: 1, name: "S", color: "#f00", weapon: "hammer", sidearm: gun, x: sx0, y: sy0 });
  const t = a.add({ id: 2, name: "T", color: "#00f", weapon: TARGET, x: tx0, y: ty0 });
  t.hp = 1e6;
  owner = s;
  fate = new Map();
  const r: Row = { volleys: 0, pellets: 0, landed: 0, blocked: 0, dmg: 0, first: -1, to50: -1, push: 0, pushN: 0, stun: 0, recoil: 0, recoilN: 0, aimErr: 0, firstErr: -1, drift: 0 };
  const pellets = s.guns[0]!.spec.pellets;
  for (let i = 0; i < 1 / STEP; i++) {
    hold(a, s, sx0, sy0);
    hold(a, t, tx0, ty0);
    a.step();
    a.events.length = 0;
  }
  for (let i = 0; i < SECONDS / STEP; i++) {
    const g = s.guns[0];
    if (!g) break;
    const tFly = Math.hypot(t.hull.x - g.body.x, t.hull.y - g.body.y) / Math.max(300, g.spec.speed);
    const dx = t.hull.x + t.hull.vx * tFly - g.body.x;
    const dy = t.hull.y + t.hull.vy * tFly - g.body.y;
    const d = Math.hypot(dx, dy) || 1;
    a.fire(s);
    a.aim(s, dx / d, dy / d);
    hold(a, s, sx0, sy0);
    hold(a, t, tx0, ty0);
    const hvx = s.hull.vx;
    const hvy = s.hull.vy;
    const tvx = t.hull.vx;
    const tvy = t.hull.vy;
    a.step();
    let shot = false;
    let hit = false;
    for (const e of a.events) {
      if (e.type === "shot" && e.m === s) {
        shot = true;
        r.volleys++;
        r.pellets += pellets;
        const off = Math.atan2(dy, dx) - g.body.a;
        const err = Math.abs(Math.atan2(Math.sin(off), Math.cos(off)));
        r.aimErr += err;
        if (r.firstErr < 0) r.firstErr = err;
      }
      if (e.type === "hit" && e.victim === t && e.attacker === s) {
        r.dmg += e.dmg;
        hit = true;
        if (r.first < 0) r.first = (i + 1) * STEP;
        if (r.to50 < 0 && r.dmg >= 50) r.to50 = (i + 1) * STEP;
      }
    }
    if (shot) {
      const ux = Math.cos(g.body.a);
      const uy = Math.sin(g.body.a);
      r.recoil += -((s.hull.vx - hvx) * ux + (s.hull.vy - hvy) * uy);
      r.recoilN++;
    }
    if (hit) {
      r.push += Math.hypot(t.hull.vx - tvx, t.hull.vy - tvy);
      r.pushN++;
    }
    r.stun = Math.max(r.stun, t.stun);
    r.drift = Math.max(r.drift, Math.hypot(s.hull.x - sx0, s.hull.y - sy0));
    a.events.length = 0;
  }
  [r.landed, r.blocked] = fates();
  owner = null;
  return r;
}

test("gun range", () => {
  const out: string[] = [];
  out.push(`${SECONDS} s of held fire, ${RUNS} runs a cell (heavy mortar, launcher: ×4); target: ${TARGET}, holding its place (hp unlimited)`);
  out.push("gun          range  volleys  proj  land%  block%  lost%   dmg   dps  1st hit  to 50       push/hit  stun  recoil/shot  aim err  1st err  drift");
  const unwatch = watch();
  try {
    for (const gun of GUNS) {
      for (const D of RANGES) {
        // few projectiles a run: more runs
        const n = RUNS * (gun === "heavymortar" || gun === "launcher" ? 4 : 1);
        const rs = Array.from({ length: n }, (_, k) => withSeed(4100 + 17 * k + D, () => run(gun, D, k)));
        const sum = (f: (r: Row) => number) => rs.reduce((s, r) => s + f(r), 0);
        const P = sum((r) => r.pellets) || 1;
        const firsts = rs.filter((r) => r.first >= 0).map((r) => r.first);
        const to50 = rs.filter((r) => r.to50 >= 0).map((r) => r.to50);
        const avg = (xs: number[]) => (xs.length ? (xs.reduce((s, x) => s + x, 0) / xs.length).toFixed(2) : "  -  ");
        const deg = (x: number) => `${((x / Math.PI) * 180).toFixed(1).padStart(5)}°`;
        out.push(
          `${gun.padEnd(12)} ${String(D).padStart(5)}  ${(sum((r) => r.volleys) / n).toFixed(1).padStart(7)}  ${(P / n).toFixed(0).padStart(4)}` +
            `  ${((100 * sum((r) => r.landed)) / P).toFixed(0).padStart(4)}%  ${((100 * sum((r) => r.blocked)) / P).toFixed(0).padStart(5)}%` +
            `  ${((100 * (P - sum((r) => r.landed) - sum((r) => r.blocked))) / P).toFixed(0).padStart(4)}%` +
            `  ${(sum((r) => r.dmg) / n).toFixed(0).padStart(4)}  ${(sum((r) => r.dmg) / n / SECONDS).toFixed(1).padStart(4)}` +
            `  ${avg(firsts).padStart(7)}  ${avg(to50).padStart(5)} (${String(to50.length).padStart(2)}/${n})` +
            `  ${(sum((r) => r.push) / Math.max(1, sum((r) => r.pushN))).toFixed(0).padStart(6)}  ${(sum((r) => r.stun) / n).toFixed(2).padStart(5)}` +
            `  ${(sum((r) => r.recoil) / Math.max(1, sum((r) => r.recoilN))).toFixed(0).padStart(8)}  ${deg(sum((r) => r.aimErr) / Math.max(1, sum((r) => r.volleys)))}` +
            `  ${deg(sum((r) => Math.max(0, r.firstErr)) / n)}  ${(sum((r) => r.drift) / n).toFixed(0).padStart(5)}`,
        );
      }
    }
  } finally {
    unwatch();
  }
  console.log(`\n${out.join("\n")}`);
});

// ---------------------------------------------------------------- 2. duels
const FIGHT = process.env.FIGHT !== "0";
const FIGHT_ROUNDS = Number(process.env.FIGHT_ROUNDS) || 12;
const SHOOTER = process.env.SHOOTER ?? "lance";
const FOES = (process.env.FOES ?? "thump,razor,krank,dervish").split(",");

test("guns in bot duels", { skip: !FIGHT }, () => {
  const stepOf = Arena.prototype.step;
  let tally = { proj: 0, dmg: 0, volleys: 0, self: 0 };
  let shooterId = 1;
  Arena.prototype.step = function (this: Arena) {
    if (!owner || owner.id !== shooterId || !this.machines.includes(owner)) owner = this.machines.find((m) => m.id === shooterId) ?? null;
    stepOf.call(this);
    for (const e of this.events) {
      if (e.type === "shot" && e.m.id === shooterId) {
        tally.volleys++;
        tally.proj += e.m.guns[0]?.spec.pellets ?? 1;
      }
      if (e.type === "hit" && e.shot && e.attacker.id === shooterId && e.victim.id !== shooterId) tally.dmg += e.dmg;
      if (e.type === "hit" && e.shot && e.attacker.id === shooterId && e.victim.id === shooterId) tally.self += e.dmg;
    }
  };
  const unwatch = watch();
  const out: string[] = [`${SHOOTER} with each gun v ${FOES.join(", ")}: ${FIGHT_ROUNDS} rounds each, classic arena`];
  out.push("gun            win%  secs  volleys/rnd  proj/rnd  land%  block%  shot dmg/rnd  dmg/proj  all dmg/rnd  self dmg/rnd");
  const loadouts: [string, WeaponKind, GunKind | null][] = [...GUNS.map((g) => [g, "hammer", g] as [string, WeaponKind, GunKind]), ["tribune", "tribune", null]];
  try {
    for (const [label, weapon, gun] of loadouts) {
      tally = { proj: 0, dmg: 0, volleys: 0, self: 0 };
      fate = new Map();
      let landed = 0;
      let blocked = 0;
      let wins = 0;
      let secs = 0;
      let dealt = 0;
      let n = 0;
      for (const foe of FOES) {
        for (let r = 0; r < FIGHT_ROUNDS; r++) {
          const seed = 9100 + 37 * r + foe.length;
          const p = BENCH_PROFILES[SHOOTER]!;
          const q = BENCH_PROFILES[foe]!;
          // swap the seats every other round
          const first = r % 2 === 0;
          shooterId = first ? 1 : 2;
          owner = null;
          const me = { name: SHOOTER, weapon, sidearm: gun, plate: null, driver: p.driver };
          const them = { name: foe, weapon: q.weapon(seed) ?? ("hammer" as WeaponKind), sidearm: null, plate: q.plate?.(seed) ?? null, driver: q.driver };
          const res = withSeed(seed, () => runRound({ arena: "classic", entrants: first ? [me, them] : [them, me] }));
          const [l, b] = fates();
          landed += l;
          blocked += b;
          const i = shooterId - 1;
          if (res.winner === i) wins++;
          secs += res.seconds;
          dealt += res.stats[i]!.dealt;
          n++;
        }
      }
      const P = tally.proj || 1;
      out.push(
        `${label.padEnd(13)} ${((100 * wins) / n).toFixed(0).padStart(4)}%  ${(secs / n).toFixed(1).padStart(4)}  ${(tally.volleys / n).toFixed(1).padStart(11)}  ${(tally.proj / n).toFixed(1).padStart(8)}` +
          `  ${((100 * landed) / P).toFixed(0).padStart(4)}%  ${((100 * blocked) / P).toFixed(0).padStart(5)}%  ${(tally.dmg / n).toFixed(1).padStart(12)}  ${(tally.dmg / P).toFixed(2).padStart(8)}  ${(dealt / n).toFixed(0).padStart(11)}  ${(tally.self / n).toFixed(1).padStart(12)}`,
      );
    }
  } finally {
    Arena.prototype.step = stepOf;
    unwatch();
    owner = null;
  }
  console.log(`\n${out.join("\n")}`);
});
