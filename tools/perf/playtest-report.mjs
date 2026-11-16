// Play-test report from a relay recording (THUMBTIDE_RECORD): node tools/perf/playtest-report.mjs <file.jsonl> <room> [--player=<id or name>]
// Timeline (phases, picks, joins), then per round: weapon, damage dealt and taken, K.O., and stick use (touch %, full tilt %,
// circles per second, direction flips, idle gaps, fire and shield presses). Rotor Brawl only.
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const [file, room] = args.filter((a) => !a.startsWith("--"));
// --player=<id or name>: whose phone to report (default: the first phone that joined)
const who = args.find((a) => a.startsWith("--player="))?.slice(9);
const L = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((x) => x.room === room);
if (!L.length) {
  console.log(`No messages for room ${room} in ${file}.`);
  process.exit(1);
}
const t0 = L[0].ts;
const T = (ts) => `${String(Math.floor((ts - t0) / 60000)).padStart(2, "0")}:${String(Math.floor(((ts - t0) / 1000) % 60)).padStart(2, "0")}`;
const phones = L.filter((x) => x.ev === "phone-open");
const me = (who ? phones.find((x) => x.id === who || x.name === who) : phones[0])?.id;
if (phones.length) console.log(`Phones: ${[...new Map(phones.map((p) => [p.id, p.name])).entries()].map(([id, n]) => `${n} (${id})`).join(", ")}`);

// rounds from the shared state
const rounds = [];
let cur = null;
let phase = null;
let lastOwn = null;
const sys = [];
for (const x of L) {
  if (x.ev === "tv" && x.m.t === "state" && !x.m.to && x.m.d) {
    const d = x.m.d;
    if (d.phase !== phase) {
      if (d.phase === "fight") {
        cur = { round: d.round, start: x.ts, end: null, weapon: lastOwn?.weapon, gun: lastOwn?.sidearm, plate: lastOwn?.plate, hits: 0, dealt: 0, hurts: 0, taken: 0, ko: null, won: null, inputs: [], winner: null };
        rounds.push(cur);
      } else if (cur && !cur.end && (d.phase === "result" || d.phase === "match")) {
        cur.end = x.ts;
        cur.winner = d.winner;
        cur.phaseEnd = d.phase;
      } else if (d.phase === "pick") cur = null;
      sys.push(`${T(x.ts)} phase ${d.phase}${d.round ? ` round ${d.round}` : ""}${d.winner ? ` winner ${d.winner}` : ""}`);
      phase = d.phase;
    }
  }
  if (x.ev === "tv" && x.m.t === "state" && x.m.to === me && x.m.d && "hp" in x.m.d) lastOwn = x.m.d;
  if (x.ev === "tv" && x.m.t === "msg" && x.m.to === me) {
    const d = x.m.d;
    if (cur && !cur.end) {
      if (d.type === "hit" && d.dmg > 0) (cur.hits++, (cur.dealt += d.dmg));
      if (d.type === "hurt" && d.dmg > 0) (cur.hurts++, (cur.taken += d.dmg));
      if (d.type === "ko") cur.ko = x.ts;
    }
    if (d.type === "win") sys.push(`${T(x.ts)} win msg ${JSON.stringify(d).slice(0, 120)}`);
  }
  if (x.ev === "phone" && x.m.t === "msg") sys.push(`${T(x.ts)} phone ${JSON.stringify(x.m.d).slice(0, 120)}`);
  if (x.ev === "phone" && x.m.t === "in" && cur && !cur.end) cur.inputs.push({ ts: x.ts, ...x.m.d });
  if (x.ev === "phone-open" || x.ev === "phone-close" || x.ev === "host-open" || x.ev === "host-close") sys.push(`${T(x.ts)} ${x.ev} ${x.code ?? ""}`);
}

// stick behaviour per round
const stick = (inp, from, to) => {
  const a = inp.filter((i) => i.ts >= from && i.ts <= to);
  if (a.length < 2) return null;
  let touch = 0;
  let full = 0;
  let turn = 0;
  let idleMax = 0;
  let idleSum = 0;
  let lastActive = from;
  let prevAng = null;
  let reversals = 0;
  let prevSign = 0;
  const mags = [];
  for (let i = 1; i < a.length; i++) {
    const dt = (a[i].ts - a[i - 1].ts) / 1000;
    const m = Math.hypot(a[i].x, a[i].y);
    if (m > 0.05) {
      touch += dt;
      mags.push(m);
      if (m > 0.9) full += dt;
      const ang = Math.atan2(a[i].y, a[i].x);
      if (prevAng !== null) {
        let d = ang - prevAng;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        turn += Math.abs(d);
        const s = Math.sign(d);
        if (Math.abs(d) > 0.05 && s && prevSign && s !== prevSign) reversals++;
        if (Math.abs(d) > 0.05 && s) prevSign = s;
      }
      prevAng = ang;
      const gap = (a[i].ts - lastActive) / 1000;
      if (gap > 1) idleSum += gap;
      idleMax = Math.max(idleMax, gap);
      lastActive = a[i].ts;
    } else prevAng = null;
  }
  const span = (to - from) / 1000;
  mags.sort((p, q) => p - q);
  const fires = a.filter((i, k) => k && i.f && !a[k - 1].f).length;
  const shields = a.filter((i, k) => k && i.g && !a[k - 1].g).length;
  return {
    span,
    touchPct: Math.round((touch / span) * 100),
    fullPct: Math.round((full / span) * 100),
    medianTilt: mags.length ? mags[Math.floor(mags.length / 2)].toFixed(2) : "-",
    circlesPerS: (turn / (2 * Math.PI) / Math.max(1, touch)).toFixed(2),
    reversalsPerMin: ((reversals / Math.max(1, touch)) * 60).toFixed(0),
    idleMaxS: idleMax.toFixed(1),
    idleOver1sS: idleSum.toFixed(0),
    fires,
    shields,
  };
};

console.log(`Room ${room}, player ${me}, ${T(L[L.length - 1].ts)} recorded\n`);
console.log("== timeline");
for (const s of sys) console.log(s);
console.log("\n== rounds");
for (const r of rounds) {
  const end = r.ko ?? r.end ?? L[L.length - 1].ts;
  const s = stick(r.inputs, r.start, end);
  console.log(
    `round ${r.round} ${T(r.start)} ${(((r.end ?? end) - r.start) / 1000).toFixed(0)}s · ${r.weapon}${r.gun ? `/${r.gun}` : ""}${r.plate ? `/${r.plate}` : ""} · dealt ${r.dealt} in ${r.hits} hits · took ${r.taken} in ${r.hurts} · ${r.ko ? `KO at ${((r.ko - r.start) / 1000).toFixed(0)}s (watched ${(((r.end ?? r.ko) - r.ko) / 1000).toFixed(0)}s)` : "survived"} · winner ${r.winner ?? "-"}`,
  );
  if (s) console.log(`   stick: touched ${s.touchPct}% · full tilt ${s.fullPct}% · median tilt ${s.medianTilt} · ${s.circlesPerS} circles/s · ${s.reversalsPerMin} direction flips/min · longest idle ${s.idleMaxS}s · idle>1s total ${s.idleOver1sS}s · fire ${s.fires} · shield ${s.shields}`);
}
