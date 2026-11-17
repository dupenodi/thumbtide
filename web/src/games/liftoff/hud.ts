// The DOM round the tunnel: the mission panel on the left (altitude, run, crew best), the crew on the right in
// thruster order (lit while firing), and the 3-2-1, the run result and the mission report over the tunnel.
// Each part is rebuilt only when what it shows changes.
import { CREW, tierOf } from "./look.ts";
import type { Liftoff } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DIFF_LABEL: Record<string, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };

export function createHud(root: HTMLElement) {
  const left = document.createElement("aside");
  left.className = "lft-left";
  left.innerHTML = `
    <header class="lft-logo"><b>LIFT-OFF</b><span class="lft-diff"></span></header>
    <div class="lft-alt"><span>Altitude</span><div><b class="lft-h">0</b><i>m</i></div></div>
    <div class="lft-stats">
      <div><span>Run</span><b class="lft-run">1</b></div>
      <div><span>Crew best</span><b class="lft-rec">0 m</b></div>
    </div>
    <ol class="lft-runs"></ol>`;
  const right = document.createElement("aside");
  right.className = "lft-right";
  right.innerHTML = `
    <header class="lft-head"><b>Crew</b><span>left to right</span></header>
    <ol class="lft-crew"></ol>
    <p class="lft-next"></p>`;
  const over = document.createElement("div");
  over.className = "lft-over";
  root.append(left, right, over);
  const $ = (el: HTMLElement, s: string) => el.querySelector(s) as HTMLElement;
  const hEl = $(left, ".lft-h");
  const runEl = $(left, ".lft-run");
  const recEl = $(left, ".lft-rec");
  const diffEl = $(left, ".lft-diff");
  const runsEl = $(left, ".lft-runs");
  const crewEl = $(right, ".lft-crew");
  const nextEl = $(right, ".lft-next");

  let crewSig = "";
  let rowEls: HTMLElement[] = [];
  let statSig = "";
  let shown = "";
  let lastH = -1;

  return {
    /** Puts the panels either side of the tunnel column (CSS px). */
    layout(W: number, H: number, col: { left: number; outerRight: number; mid: number; inner: number }) {
      const u = H / 1080;
      const gap = 40 * u;
      const edge = 72 * u;
      Object.assign(left.style, { left: `${edge}px`, width: `${Math.max(100, col.left - edge - gap)}px`, top: `${edge}px`, bottom: `${edge}px` });
      Object.assign(right.style, { left: `${col.outerRight + gap}px`, width: `${Math.max(100, W - col.outerRight - gap - edge)}px`, top: `${edge}px`, bottom: `${edge}px` });
      Object.assign(over.style, { left: `${col.mid - col.inner / 2}px`, width: `${col.inner}px` });
    },

    update(game: Liftoff, waiting: string[]) {
      const flying = game.phase === "fly" || game.phase === "count";
      const h = Math.floor(flying || game.phase === "result" ? (game.rocket.alive ? game.height : game.best) : game.matchBest);
      if (h !== lastH) {
        lastH = h;
        hEl.textContent = String(h);
        hEl.classList.toggle("long", h >= 1000);
      }
      const rec = Math.max(game.record, flying && game.rocket.alive ? Math.floor(game.best) : 0);
      const sig = [game.run, game.opts.runs, rec, game.opts.difficulty, game.heights.join(","), game.phase === "match"].join("|");
      if (sig !== statSig) {
        statSig = sig;
        runEl.innerHTML = `${Math.max(1, game.run)}<small> / ${game.opts.runs}</small>`;
        recEl.textContent = `${rec} m`;
        diffEl.textContent = `${DIFF_LABEL[game.opts.difficulty] ?? ""} course`;
        const top = Math.max(1, ...game.heights);
        runsEl.innerHTML = game.heights
          .map((x, i) => `<li><span>Run ${i + 1}</span><i style="width:${Math.round((x / top) * 100)}%"></i><b>${x} m</b></li>`)
          .join("");
      }
      // the crew, in thruster order; rebuilt when it changes, lit per frame
      const ths = game.thrusters;
      const csig = ths.map((t) => `${t.owner}|${t.name}|${t.slot}|${t.key}|${t.bot}`).join(";") + `#${waiting.join(",")}`;
      if (csig !== crewSig) {
        crewSig = csig;
        crewEl.innerHTML = ths
          .map((t) => {
            const side = t.key === "l" ? `<em>left</em>` : t.key === "r" ? `<em>right</em>` : t.bot ? `<em>cpu</em>` : "";
            return `<li style="--k:${CREW[t.slot % CREW.length]}"><i class="lft-chip"></i><span>${esc(t.name || "—")}</span>${side}<s class="lft-burn"></s></li>`;
          })
          .join("");
        crewEl.className = `lft-crew${ths.length > 6 ? " tight" : ""}`;
        rowEls = [...crewEl.children] as HTMLElement[];
        nextEl.textContent = waiting.length ? `Next run: ${waiting.join(", ")}` : "";
      }
      ths.forEach((t, i) => {
        const el = rowEls[i];
        if (el && el.classList.contains("on") !== t.on) el.classList.toggle("on", t.on);
      });
    },

    count(n: number, run: number, runs: number) {
      const k = `count${run}-${n}`;
      if (k === shown) return;
      shown = k;
      over.classList.remove("high");
      over.innerHTML = `<div class="lft-count"><span>Run ${run} of ${runs}</span><b>${n}</b></div>`;
    },

    result(game: Liftoff, height: number, best: boolean, lost: boolean) {
      shown = `result${game.run}`;
      over.classList.add("high");
      const tag = best
        ? `<em class="lft-best">New crew best</em>`
        : `<em>Crew best <b>${game.record} m</b></em>`;
      over.innerHTML = `
        <div class="lft-card">
          <span>Run ${game.run} of ${game.opts.runs} · ${lost ? "dropped" : "crashed"}</span>
          <b>${height}<i> m</i></b>
          ${tag}
        </div>`;
    },

    match(game: Liftoff) {
      shown = "match";
      const best = game.matchBest;
      const top = Math.max(1, ...game.heights);
      const bestRun = game.heights.indexOf(best);
      const crew = [...game.seats.values()].sort((a, b) => a.slot - b.slot);
      root.querySelector(".lft-report")?.remove();
      const el = document.createElement("div");
      el.className = "lft-report";
      el.innerHTML = `
        <div class="lft-rep-in">
          <span class="lft-mk">Mission report · ${DIFF_LABEL[game.opts.difficulty] ?? ""} course</span>
          <b class="lft-rep-h">${best}<i> m</i></b>
          <em class="lft-tier">${tierOf(best)}${game.newRecord ? `<small>New crew best</small>` : ""}</em>
          <ol class="lft-rep-runs">${game.heights
            .map(
              (x, i) =>
                `<li class="${i === bestRun ? "top" : ""}"><span>Run ${i + 1}</span><i><s style="width:${Math.round((x / top) * 100)}%"></s></i><b>${x} m</b></li>`,
            )
            .join("")}</ol>
          <ul class="lft-rep-crew">${crew
            .map((s) => `<li style="--k:${CREW[s.slot % CREW.length]}"><i class="lft-chip"></i>${esc(s.name)}</li>`)
            .join("")}</ul>
        </div>`;
      root.appendChild(el);
      over.innerHTML = "";
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      over.classList.remove("high");
      over.innerHTML = `<div class="lft-card"><span>Lift-off</span><b class="lft-wait">Waiting</b><em>for a crew</em></div>`;
    },

    clear() {
      if (!shown) return;
      if (shown === "match") root.querySelector(".lft-report")?.remove();
      shown = "";
      over.innerHTML = "";
    },

    dispose() {
      left.remove();
      right.remove();
      over.remove();
      root.querySelector(".lft-report")?.remove();
    },
  };
}
