// The DOM over the table: the top band (logo, round, speed, who plays next round), the 3-2-1, the round result and
// the match result. Each part is rebuilt only when what it shows changes.
import { INKS } from "./look.ts";
import type { Seat, Stack } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function createHud(root: HTMLElement) {
  const band = document.createElement("div");
  band.className = "sta-band";
  band.innerHTML = `<div class="sta-logo"><span>Stack</span><span>Attack</span></div><div class="sta-meta"></div>`;
  root.appendChild(band);
  const meta = band.querySelector(".sta-meta") as HTMLElement;

  const layer = document.createElement("div");
  layer.className = "sta-over";
  root.appendChild(layer);

  let metaKey = "";
  let shown = "";

  return {
    /** The band sits in the table's top strip. */
    place(height: number) {
      band.style.height = `${height}px`;
      layer.style.paddingTop = `${height}px`;
    },

    update(game: Stack) {
      const waiting = game.live().filter((s) => !s.inRound && game.phase !== "match" && game.phase !== "wait");
      const solo = game.solo ? game.players()[0] : undefined;
      const k = [game.phase, game.round, game.opts.wins, game.level, game.solo, solo?.score, waiting.map((s) => s.name).join(",")].join("|");
      if (k === metaKey) return;
      metaKey = k;
      const parts: string[] = [];
      if (waiting.length) parts.push(`<span class="sta-wait">Next round: ${waiting.map((s) => esc(s.name)).join(", ")}</span>`);
      if (solo) parts.push(`<span><em>Score</em><b>${solo.score.toLocaleString("en")}</b></span>`);
      else if (game.round) parts.push(`<span><em>Round</em><b>${game.round}</b></span><span><em>First to</em><b>${game.opts.wins}</b></span>`);
      if (game.phase === "play" || game.phase === "round") parts.push(`<span><em>Speed</em><b>${game.level + 1}</b></span>`);
      meta.innerHTML = parts.join("");
    },

    /** The 3-2-1, with the round above it. */
    count(n: number, game: Stack) {
      const k = `count${game.round}-${n}`;
      if (k === shown) return;
      shown = k;
      const label = game.solo ? "Solo run" : `Round ${game.round}`;
      layer.innerHTML = `<div class="sta-count"><span>${label}</span><b>${n}</b></div>`;
    },

    roundResult(game: Stack) {
      shown = `round${game.round}`;
      if (game.solo) {
        const s = game.players()[0];
        layer.innerHTML = s
          ? `<div class="sta-slip"><span>Run over</span><b>${s.score.toLocaleString("en")}</b><em>${s.lines} lines · speed ${game.level + 1}</em></div>`
          : "";
        return;
      }
      const w = game.roundWinner ? game.seats.get(game.roundWinner) : null;
      layer.innerHTML = w
        ? `<div class="sta-slip" style="--k:${INKS[w.slot]}"><span>Round ${game.round}</span><b class="ink">${esc(w.name)}</b><em>takes the round</em></div>`
        : `<div class="sta-slip"><span>Round ${game.round}</span><b>Nobody</b><em>stands</em></div>`;
    },

    match(game: Stack) {
      shown = "match";
      if (game.solo) {
        const s = game.players()[0];
        layer.innerHTML = `<div class="sta-match"><div class="sta-sheet">
          <span class="sta-mk">Solo run</span>
          <div class="sta-win"><b>${(s?.score ?? 0).toLocaleString("en")}</b></div>
          <em class="sta-wins">${s?.lines ?? 0} lines · speed ${game.level + 1}</em></div></div>`;
        return;
      }
      const win = game.winners.map((id) => game.seats.get(id)).filter((s): s is Seat => !!s);
      const names = win.map((s) => `<b style="--k:${INKS[s.slot]}">${esc(s.name)}</b>`).join(`<i>&amp;</i>`);
      const list = game.standings().slice(0, 8);
      layer.innerHTML = `
        <div class="sta-match"><div class="sta-sheet">
          <span class="sta-mk">Match · ${game.round} rounds</span>
          <div class="sta-win">${names || "<b>Nobody</b>"}</div>
          <em class="sta-wins">${win.length > 1 ? "share the match" : "wins the match"}</em>
          <ol class="sta-final">${list
            .map(
              (s, i) =>
                `<li style="--k:${INKS[s.slot]}"><span class="sta-rk">${i + 1}</span><i class="sta-chip"></i><span class="sta-fn">${esc(s.name)}</span><span class="sta-fp">${Array.from({ length: game.opts.wins }, (_, j) => `<i class="${j < s.wins ? "on" : ""}"></i>`).join("")}</span></li>`,
            )
            .join("")}</ol>
        </div></div>`;
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      layer.innerHTML = `<div class="sta-slip"><span>Stack Attack</span><b>Waiting</b><em>for players</em></div>`;
    },

    clear() {
      if (!shown) return;
      shown = "";
      layer.innerHTML = "";
    },

    dispose() {
      band.remove();
      layer.remove();
    },
  };
}
