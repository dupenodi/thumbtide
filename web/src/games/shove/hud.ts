// The DOM beside and over the ring: the banzuke-like board on the right (each name with its round-win seals), the
// 3-2-1, the round result (a seal stamped once) and the match winner. The board is rebuilt only when it changes.
import { INKS } from "./look.ts";
import type { Seat, Shove } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const seals = (won: number, of: number, fresh = -1) =>
  Array.from({ length: of }, (_, i) => `<i class="shv-seal${i < won ? " on" : ""}${i === fresh ? " new" : ""}"></i>`).join("");

export function createHud(stage: HTMLElement, box: HTMLElement, isBot: (id: string) => boolean) {
  const board = document.createElement("aside");
  board.className = "shv-board";
  board.innerHTML = `
    <header class="shv-head"><div class="shv-logo">Shove</div><i class="shv-hanko"></i></header>
    <ol class="shv-rows"></ol>
    <footer class="shv-meta">
      <div><span>Round</span><b class="shv-round">1</b></div>
      <div><span>First to</span><b class="shv-target">3</b></div>
    </footer>`;
  stage.appendChild(board);
  const rows = board.querySelector(".shv-rows") as HTMLElement;
  const roundEl = board.querySelector(".shv-round") as HTMLElement;
  const targetEl = board.querySelector(".shv-target") as HTMLElement;

  const layer = document.createElement("div");
  layer.className = "shv-over";
  box.appendChild(layer);

  let sig = "";
  let shown = "";

  const state = (game: Shove, s: Seat) => {
    const live = game.phase === "count" || game.phase === "play" || game.phase === "round";
    if (live && !s.inRound) return "next";
    if ((game.phase === "play" || game.phase === "round") && !s.alive) return "out";
    return "";
  };

  return {
    el: board,

    update(game: Shove) {
      const list = game.standings();
      const fresh = game.phase === "round" ? game.roundWinner : null;
      const key = [
        game.round, game.opts.wins, fresh,
        ...list.map((s) => `${s.id}|${s.name}|${s.slot}|${s.wins}|${state(game, s)}`),
      ].join(";");
      if (key === sig) return;
      sig = key;
      roundEl.textContent = String(Math.max(1, game.round));
      targetEl.textContent = String(game.opts.wins);
      board.style.setProperty("--n", String(Math.max(4, list.length)));
      rows.innerHTML = list
        .map((s) => {
          const st = state(game, s);
          const tag = st === "next" ? `<em class="shv-tag">next</em>` : st === "out" ? `<em class="shv-tag">out</em>` : isBot(s.id) ? `<em class="shv-tag">cpu</em>` : "";
          return `<li class="${st}" style="--k:${INKS[s.slot]}"><span class="shv-dot"></span><span class="shv-nm">${esc(s.name)}</span>${tag}<span class="shv-seals">${seals(Math.min(s.wins, game.opts.wins), game.opts.wins, s.id === fresh ? s.wins - 1 : -1)}</span></li>`;
        })
        .join("");
    },

    /** The 3-2-1, with the round above it. */
    count(n: number, round: number) {
      const k = `count${round}-${n}`;
      if (k === shown) return;
      shown = k;
      layer.innerHTML = `<div class="shv-count"><span>Round ${round}</span><b>${n}</b></div>`;
    },

    go(round: number) {
      const k = `go${round}`;
      if (k === shown) return;
      shown = k;
      layer.innerHTML = `<div class="shv-count go"><b>Shove!</b></div>`;
    },

    roundResult(game: Shove, winner: Seat | null) {
      shown = `round${game.round}`;
      layer.innerHTML = winner
        ? `<div class="shv-card res" style="--k:${INKS[winner.slot]}"><span>Round ${game.round}</span><b>${esc(winner.name)}</b><em>stays in</em><i class="shv-stamp"></i></div>`
        : `<div class="shv-card res"><span>Round ${game.round}</span><b>No contest</b><em>a wrestler left</em></div>`;
    },

    match(game: Shove) {
      shown = "match";
      const w = game.winner ? game.seats.get(game.winner) : null;
      const list = game.standings().slice(0, 8);
      layer.innerHTML = `
        <div class="shv-match">
          <span class="shv-mk">Match · ${game.round} rounds</span>
          <b class="shv-win" style="--k:${w ? INKS[w.slot] : "#f4f1e8"}">${w ? esc(w.name) : "Nobody"}</b>
          <em class="shv-wins">takes the match</em>
          <ol class="shv-final">${list
            .map(
              (s, i) =>
                `<li style="--k:${INKS[s.slot]}"><span class="shv-rk">${i + 1}</span><span class="shv-dot"></span><span class="shv-nm">${esc(s.name)}</span><span class="shv-seals">${seals(Math.min(s.wins, game.opts.wins), game.opts.wins)}</span></li>`,
            )
            .join("")}</ol>
        </div>`;
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      layer.innerHTML = `<div class="shv-card"><span>Shove</span><b>Waiting</b><em>for one more wrestler</em></div>`;
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
