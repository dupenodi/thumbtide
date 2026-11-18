// The DOM around the arena: the scoreboard bar on top (a chip per fighter with round-win pips, the round and the
// target, or the two team scores), the 3-2-1, the round result and the match winner. The bar is rebuilt only when
// something it shows changes.
import { ARENAS } from "./arenas.ts";
import { TEAM_COLORS, TEAM_NAMES, inkOf } from "./look.ts";
import type { Blast, Seat } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ink on a light colour, paper on a dark one. */
export const onColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 150 ? "#1d1a17" : "#f6efe2";
};

/** A team colour, with a fallback so a stale team index never breaks the screen. */
const teamColor = (t: number | null | undefined) => TEAM_COLORS[t ?? -1] ?? "#f6efe2";
const teamName = (t: number | null | undefined) => TEAM_NAMES[t ?? -1] ?? "";

const pips = (won: number, of: number, fresh = -1) =>
  Array.from({ length: of }, (_, i) => `<i class="blt-pip${i < won ? " on" : ""}${i === fresh ? " new" : ""}"></i>`).join("");

export function createHud(stage: HTMLElement, box: HTMLElement, isBot: (id: string) => boolean) {
  const bar = document.createElement("header");
  bar.className = "blt-bar";
  bar.innerHTML = `
    <div class="blt-logo"><i></i><span>Blast Party</span></div>
    <ol class="blt-chips"></ol>
    <div class="blt-info"></div>`;
  stage.appendChild(bar);
  const chips = bar.querySelector(".blt-chips") as HTMLElement;
  const info = bar.querySelector(".blt-info") as HTMLElement;

  const layer = document.createElement("div");
  layer.className = "blt-over";
  box.appendChild(layer);

  let sig = "";
  let shown = "";

  const state = (game: Blast, s: Seat) => {
    const live = game.phase === "count" || game.phase === "play" || game.phase === "round";
    if (live && !s.inRound) return "next";
    if ((game.phase === "play" || game.phase === "round") && !s.alive) return "out";
    return "";
  };

  const teamLine = (game: Blast, t: number) => {
    const list = game.standings().filter((s) => s.team === t);
    return list.map((s) => esc(s.name)).join(", ");
  };

  return {
    el: bar,

    update(game: Blast) {
      const list = game.standings();
      const fresh = game.phase === "round" ? game.roundWinner : null;
      const team = game.team;
      const key = [
        game.round, game.opts.wins, game.opts.mode, fresh, game.teamWins.join(","), game.arena.id,
        ...list.map((s) => `${s.id}|${s.name}|${s.slot}|${s.team}|${s.tix}|${s.wins}|${state(game, s)}`),
      ].join(";");
      if (key === sig) return;
      sig = key;
      bar.classList.toggle("team", team);
      // team match: one team's chips, then the other's
      const ordered = team ? list.slice().sort((a, b) => a.team - b.team || a.slot - b.slot) : list;
      chips.innerHTML = ordered
        .map((s) => {
          const st = state(game, s);
          const tag = st === "next" ? `<em class="blt-tag">next</em>` : st === "out" ? `<em class="blt-tag">out</em>` : isBot(s.id) ? `<em class="blt-tag">cpu</em>` : "";
          const wins = team ? "" : `<span class="blt-pips">${pips(Math.min(s.wins, game.opts.wins), game.opts.wins, s.id === fresh ? s.wins - 1 : -1)}</span>`;
          const edge = team && s.team >= 0 ? ` style="--k:${inkOf(s)};--t:${TEAM_COLORS[s.team]}"` : ` style="--k:${inkOf(s)}"`;
          return `<li class="${st}"${edge}><span class="blt-dot"></span><span class="blt-nm">${esc(s.name)}</span>${tag}${wins}</li>`;
        })
        .join("");
      chips.classList.toggle("dense", ordered.length > 4);
      chips.style.setProperty("--n", String(Math.max(1, ordered.length)));
      info.innerHTML = team
        ? [0, 1]
            .map(
              (t) =>
                `<div class="blt-team${game.phase === "round" && game.roundTeam === t ? " won" : ""}" style="--t:${TEAM_COLORS[t]}"><b>${game.teamWins[t]}</b><span>${TEAM_NAMES[t]}</span></div>`,
            )
            .join("") + `<div class="blt-meta"><span>Round ${Math.max(1, game.round)}</span><span>First to ${game.opts.wins}</span></div>`
        : `<div class="blt-meta big"><span>Round <b>${Math.max(1, game.round)}</b></span><span>First to <b>${game.opts.wins}</b></span></div>`;
    },

    /** The 3-2-1, with the round and the arena's name. */
    count(n: number, game: Blast) {
      const k = `count${game.round}-${n}`;
      if (k === shown) return;
      shown = k;
      layer.innerHTML = `<div class="blt-count"><span>Round ${game.round} · ${esc(ARENAS[game.arena.id].name)}</span><b>${n}</b></div>`;
    },

    go(round: number) {
      const k = `go${round}`;
      if (k === shown) return;
      shown = k;
      layer.innerHTML = `<div class="blt-count go"><b>Blast!</b></div>`;
    },

    roundResult(game: Blast, winner: Seat | null, team: number | null) {
      shown = `round${game.round}`;
      if (team !== null) {
        layer.innerHTML = `<div class="blt-card res" style="--k:${teamColor(team)};--on:${onColor(teamColor(team))}"><span>Round ${game.round}</span><b>${teamName(team)} team</b><em>${teamLine(game, team)}</em></div>`;
      } else if (winner) {
        const c = inkOf(winner);
        layer.innerHTML = `<div class="blt-card res" style="--k:${c};--on:${onColor(c)}"><span>Round ${game.round}</span><b>${esc(winner.name)}</b><em>last one standing</em></div>`;
      } else {
        layer.innerHTML = `<div class="blt-card res plain"><span>Round ${game.round}</span><b>Draw</b><em>nobody takes it</em></div>`;
      }
    },

    match(game: Blast) {
      shown = "match";
      const team = game.team;
      const w = game.winner ? game.seats.get(game.winner) ?? null : null;
      const color = team ? teamColor(game.winTeam ?? 0) : w ? inkOf(w) : "#f6efe2";
      const title = team ? `${teamName(game.winTeam ?? 0)} team` : w ? esc(w.name) : "Nobody";
      const sub = team ? teamLine(game, game.winTeam ?? 0) : "takes the match";
      const rows = team
        ? [0, 1]
            .map((t) => `<li style="--k:${TEAM_COLORS[t]}"><span class="blt-dot"></span><span class="blt-nm">${TEAM_NAMES[t]} · ${teamLine(game, t)}</span><span class="blt-pips">${pips(game.teamWins[t]!, game.opts.wins)}</span></li>`)
            .join("")
        : game
            .standings()
            .slice(0, 8)
            .map(
              (s, i) =>
                `<li style="--k:${inkOf(s)}"><span class="blt-rk">${i + 1}</span><span class="blt-dot"></span><span class="blt-nm">${esc(s.name)}</span><span class="blt-pips">${pips(Math.min(s.wins, game.opts.wins), game.opts.wins)}</span></li>`,
            )
            .join("");
      layer.innerHTML = `
        <div class="blt-match">
          <span class="blt-mk">Match · ${game.round} ${game.round === 1 ? "round" : "rounds"}</span>
          <b class="blt-win" style="--k:${color};--on:${onColor(color)}">${title}</b>
          <em class="blt-wins">${sub}</em>
          <ol class="blt-final">${rows}</ol>
        </div>`;
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      layer.innerHTML = `<div class="blt-card plain"><span>Blast Party</span><b>Waiting</b><em>for one more fighter</em></div>`;
    },

    clear() {
      if (!shown) return;
      shown = "";
      layer.innerHTML = "";
    },

    dispose() {
      bar.remove();
      layer.remove();
    },
  };
}
