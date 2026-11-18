// The DOM around the arena: a scoreboard bar above the canvas (a chip per fighter: colour, name, lives, health and
// round wins) and the cards over it (3-2-1, the round result, the match winner). It is small and still on purpose:
// on the TV every moving DOM layer costs compositing time, so nothing here follows the fighters, the chips are
// rebuilt only when the roster changes, and a chip's lives and health are touched only when their value changes.
import { PLAYER_COLORS } from "./meshes.ts";
import { HP, type Fighter, type Game } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
export const colorOf = (f: { slot: number }) => PLAYER_COLORS[f.slot % PLAYER_COLORS.length]!;

/** Ink on a light colour, paper on a dark one. */
export const onColor = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return l > 150 ? "#22263a" : "#fff8e8";
};

interface Chip {
  el: HTMLElement;
  lives: HTMLElement;
  hp: HTMLElement;
  wins: HTMLElement;
  sig: string;
}

export function createHud(bar: HTMLElement, over: HTMLElement, isBot: (id: string) => boolean) {
  bar.innerHTML = `
    <div class="b3d-logo"><i></i><span>Blast Party</span></div>
    <ol class="b3d-chips"></ol>
    <div class="b3d-info"></div>`;
  const chipsEl = bar.querySelector(".b3d-chips") as HTMLElement;
  const info = bar.querySelector(".b3d-info") as HTMLElement;
  const chips = new Map<string, Chip>();
  let roster = "";
  let infoSig = "";
  let shown = "";

  const stateOf = (game: Game, f: Fighter) => {
    const live = game.phase === "count" || game.phase === "play" || game.phase === "round";
    if (live && !f.inRound) return "next";
    if (live && f.lives <= 0) return "out";
    return "";
  };
  const pips = (n: number, of: number, cls: string) => Array.from({ length: of }, (_, i) => `<i class="${cls}${i < n ? " on" : ""}"></i>`).join("");

  return {
    update(game: Game) {
      const list = game.list();
      const key = `${game.opts.lives};${game.opts.wins};${list.map((f) => `${f.id}|${f.name}|${f.slot}`).join(";")}`;
      if (key !== roster) {
        roster = key;
        chips.clear();
        chipsEl.innerHTML = list
          .map(
            (f) =>
              `<li data-id="${esc(f.id)}" style="--k:${colorOf(f)}"><span class="b3d-top"><i class="b3d-dot"></i><span class="b3d-nm">${esc(f.name)}</span>${isBot(f.id) ? `<em>cpu</em>` : ""}<span class="b3d-wins"></span></span><span class="b3d-row"><span class="b3d-lives"></span><span class="b3d-hp"><b></b></span></span></li>`,
          )
          .join("");
        chipsEl.classList.toggle("dense", list.length > 4);
        for (const li of chipsEl.children) {
          const el = li as HTMLElement;
          chips.set(el.dataset.id!, { el, lives: el.querySelector(".b3d-lives")!, hp: el.querySelector(".b3d-hp b")!, wins: el.querySelector(".b3d-wins")!, sig: "" });
        }
      }
      for (const f of list) {
        const c = chips.get(f.id);
        if (!c) continue;
        const st = stateOf(game, f);
        const lives = f.inRound ? f.lives : 0;
        const hp = f.inRound && f.alive ? Math.ceil((f.hp / HP) * 10) : 0;
        const sig = `${st}|${lives}|${hp}|${f.wins}`;
        if (sig === c.sig) continue;
        const was = c.sig.split("|");
        c.sig = sig;
        c.el.className = st;
        if (was[1] !== String(lives)) c.lives.innerHTML = pips(lives, game.opts.lives, "b3d-life");
        if (was[2] !== String(hp)) {
          c.hp.style.width = `${hp * 10}%`;
          c.hp.className = hp <= 3 ? "low" : "";
        }
        if (was[3] !== String(f.wins)) c.wins.innerHTML = pips(f.wins, game.opts.wins, "b3d-win");
      }
      const is = `${game.round}|${game.opts.wins}`;
      if (is !== infoSig) {
        infoSig = is;
        info.innerHTML = `<span>Round <b>${Math.max(1, game.round)}</b></span><span>First to <b>${game.opts.wins}</b></span>`;
      }
    },

    count(n: number, game: Game) {
      const k = `count${game.round}-${n}`;
      if (k === shown) return;
      shown = k;
      over.innerHTML = `<div class="b3d-count"><span>Round ${game.round}</span><b>${n}</b></div>`;
    },

    go(round: number) {
      const k = `go${round}`;
      if (k === shown) return;
      shown = k;
      over.innerHTML = `<div class="b3d-count go"><b>Brawl!</b></div>`;
    },

    roundResult(game: Game, winner: Fighter | null) {
      shown = `round${game.round}`;
      if (winner) {
        const c = colorOf(winner);
        over.innerHTML = `<div class="b3d-card" style="--k:${c};--on:${onColor(c)}"><span>Round ${game.round}</span><b>${esc(winner.name)}</b><em>last one standing</em></div>`;
      } else over.innerHTML = `<div class="b3d-card plain"><span>Round ${game.round}</span><b>Draw</b><em>nobody is left standing</em></div>`;
    },

    match(game: Game) {
      shown = "match";
      const w = game.winner ? game.seats.get(game.winner) ?? null : null;
      const color = w ? colorOf(w) : "#fff8e8";
      const rows = game
        .standings()
        .slice(0, 8)
        .map(
          (f, i) =>
            `<li style="--k:${colorOf(f)}"><span class="b3d-rk">${i + 1}</span><i class="b3d-dot"></i><span class="b3d-nm">${esc(f.name)}</span><span class="b3d-wins">${pips(f.wins, game.opts.wins, "b3d-win")}</span></li>`,
        )
        .join("");
      over.innerHTML = `
        <div class="b3d-match">
          <span class="b3d-mk">Match · ${game.round} ${game.round === 1 ? "round" : "rounds"}</span>
          <b class="b3d-winner" style="--k:${color};--on:${onColor(color)}">${w ? esc(w.name) : "Nobody"}</b>
          <em>takes the match</em>
          <ol class="b3d-final${game.seats.size > 4 ? " two" : ""}">${rows}</ol>
        </div>`;
    },

    wait() {
      if (shown === "wait") return;
      shown = "wait";
      over.innerHTML = `<div class="b3d-card plain"><span>Blast Party</span><b>Waiting</b><em>for one more fighter</em></div>`;
    },

    clear() {
      if (!shown) return;
      shown = "";
      over.innerHTML = "";
    },
  };
}
