// The DOM around and over the arena: the scoreboard down the right, the 3-2-1, the round result and the match winner.
// The scoreboard is rebuilt only when something on it changes.
import { INKS } from "./look.ts";
import type { Seat, Trails } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement, arena: HTMLElement, isBot: (id: string) => boolean) {
  const board = document.createElement("aside");
  board.className = "trl-board";
  board.innerHTML = `
    <div class="trl-logo">TRAILS</div>
    <ol class="trl-rows"></ol>
    <footer class="trl-meta">
      <div><span>Round</span><b class="trl-round">1</b></div>
      <div><span>Target</span><b class="trl-target">0</b></div>
    </footer>`;
  root.appendChild(board);
  const rows = board.querySelector(".trl-rows") as HTMLElement;
  const roundEl = board.querySelector(".trl-round") as HTMLElement;
  const targetEl = board.querySelector(".trl-target") as HTMLElement;

  const layer = document.createElement("div");
  layer.className = "trl-over";
  arena.appendChild(layer);

  let sig = "";
  let shown = "";

  const leaderOf = (game: Trails): string | null => {
    const r = game.standings();
    if (!r.length || r[0]!.score === 0) return null;
    return r[1] && r[1].score === r[0]!.score ? null : r[0]!.id;
  };

  const state = (game: Trails, s: Seat) => {
    const live = game.phase === "count" || game.phase === "play" || game.phase === "round";
    if (live && !s.inRound) return "next";
    if ((game.phase === "play" || game.phase === "round") && s.out) return "out";
    return "";
  };

  return {
    el: board,

    update(game: Trails) {
      const lead = leaderOf(game);
      const list = game.standings();
      const showGain = game.phase === "round";
      const key = [
        game.round, game.target, game.phase === "round" ? 1 : 0, lead,
        ...list.map((s) => `${s.id}|${s.name}|${s.slot}|${s.score}|${showGain ? s.gain : ""}|${state(game, s)}`),
      ].join(";");
      if (key === sig) return;
      sig = key;
      roundEl.textContent = String(Math.max(1, game.round));
      targetEl.textContent = String(game.target);
      rows.innerHTML = list
        .map((s) => {
          const st = state(game, s);
          const cls = [s.id === lead ? "lead" : "", st].filter(Boolean).join(" ");
          const tag = s.id === lead ? `<em class="trl-tag">Lead</em>` : st === "next" ? `<em class="trl-tag soft">Next</em>` : isBot(s.id) ? `<em class="trl-tag soft">cpu</em>` : "";
          const gain = showGain && s.gain ? `<i class="trl-gain">+${s.gain}</i>` : "";
          return `<li class="${cls}" style="--k:${INKS[s.slot]}"><span class="trl-bar"></span><span class="trl-nm">${esc(s.name)}</span>${tag}${gain}<b class="trl-pts">${s.score}</b></li>`;
        })
        .join("");
    },

    /** The 3-2-1, with the round above it. */
    count(n: number, round: number) {
      const k = `count${round}-${n}`;
      if (k === shown) return;
      shown = k;
      layer.innerHTML = `<div class="trl-count"><span>Round ${round}</span><b>${n}</b></div>`;
    },

    roundResult(game: Trails, survivor: Seat | null) {
      shown = `round${game.round}`;
      layer.innerHTML = survivor
        ? `<div class="trl-card"><span>Round ${game.round}</span><b style="color:${INKS[survivor.slot]}">${esc(survivor.name)}</b><em>survives</em></div>`
        : `<div class="trl-card"><span>Round ${game.round}</span><b>Nobody</b><em>survives</em></div>`;
    },

    match(game: Trails) {
      shown = "match";
      const win = game.winners.map((id) => game.seats.get(id)).filter((s): s is Seat => !!s);
      const names = win.map((s) => `<b style="color:${INKS[s.slot]}">${esc(s.name)}</b>`).join(`<i>&amp;</i>`);
      const list = game.standings().slice(0, 8);
      layer.innerHTML = `
        <div class="trl-match">
          <span class="trl-mk">Match · ${game.round} rounds</span>
          <div class="trl-win">${names || "<b>Nobody</b>"}</div>
          <em class="trl-wins">${win.length > 1 ? "share the match" : "wins the match"}</em>
          <ol class="trl-final">${list
            .map(
              (s, i) =>
                `<li style="--k:${INKS[s.slot]}"><span class="trl-rk">${i + 1}</span><span class="trl-bar"></span><span class="trl-nm">${esc(s.name)}</span><b>${s.score}</b></li>`,
            )
            .join("")}</ol>
        </div>`;
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      layer.innerHTML = `<div class="trl-card"><span>Trails</span><b>Waiting</b><em>for one more line</em></div>`;
    },

    clear() {
      if (!shown) return;
      shown = "";
      layer.innerHTML = "";
    },

    dispose() {
      board.remove();
      layer.remove();
    },
  };
}
