// The TV: a dossier table. A 1920×1080 stage scaled to the screen: the clue big and central at the top, the 5×5 board
// of typed index cards, and a folder for each team at the sides (cards to find, round wins, handler and agents).
// Plain DOM; the only motion is a card that flips once with a stamp, and the cards being dealt at a round start.
import type { Owner, SpyShared, Team } from "./shared.ts";
import { TEAM_NAME } from "./shared.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const W = 1920;
const H = 1080;
/** Text width inside a card, px. */
const CARD_TEXT = 214;

const STAMP: Record<Owner, string> = { cobalt: "Cobalt", saffron: "Saffron", neutral: "Bystander", burn: "Burned" };

/** The biggest size (34–46 px) at which a word fits the card in IBM Plex Mono (0.6 em a letter). */
export const wordSize = (w: string) => Math.max(34, Math.min(46, Math.floor(CARD_TEXT / (w.length * 0.6))));

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const initial = (n: string) => esc((n.trim()[0] ?? "?").toUpperCase());

/** A faint paper-and-slate grain, made once. */
function grain(): string {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 160;
    const x = c.getContext("2d")!;
    const img = x.createImageData(160, 160);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() < 0.5 ? 255 : 0;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = Math.random() * 10;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL();
  } catch {
    return "";
  }
}

export function createView(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "spy";
  el.innerHTML = `
    <div class="spy-stage">
      <div class="spy-grain"></div>
      <header class="spy-top">
        <div class="spy-logo"><b>Spyline</b><small></small></div>
        <div class="spy-clue"></div>
      </header>
      <aside class="spy-file" data-team="cobalt"></aside>
      <aside class="spy-file" data-team="saffron"></aside>
      <main class="spy-grid"></main>
      <div class="spy-slip" hidden></div>
    </div>`;
  root.appendChild(el);
  const stage = el.querySelector(".spy-stage") as HTMLElement;
  const g = grain();
  if (g) (el.querySelector(".spy-grain") as HTMLElement).style.backgroundImage = `url(${g})`;
  const $ = (sel: string) => el.querySelector(sel) as HTMLElement;
  const grid = $(".spy-grid");
  const clue = $(".spy-clue");
  const slip = $(".spy-slip");
  const files: Record<Team, HTMLElement> = { cobalt: $('.spy-file[data-team="cobalt"]'), saffron: $('.spy-file[data-team="saffron"]') };

  const fit = () => {
    const k = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(${(window.innerWidth - W * k) / 2}px, ${(window.innerHeight - H * k) / 2}px) scale(${k})`;
  };
  fit();
  window.addEventListener("resize", fit);

  // ------------------------------------------------------------------ the cards
  interface CardEl {
    root: HTMLElement;
    word: string;
    picks: HTMLElement;
    back: HTMLElement;
    shown: string;
    pickKey: string;
  }
  let cards: CardEl[] = [];
  let boardKey = "";
  let dealing = false;
  const flips = new Set<number>();

  function build(s: SpyShared) {
    grid.innerHTML = "";
    cards = s.cards.map((c, i) => {
      const root = document.createElement("div");
      root.className = "spy-card";
      root.style.setProperty("--i", String(i));
      root.innerHTML = `<div class="spy-in">
          <div class="spy-face spy-front"><i class="spy-no">${String(i + 1).padStart(2, "0")}</i><b style="font-size:${wordSize(c.word)}px">${esc(c.word)}</b><span class="spy-picks"></span><em class="spy-band"></em></div>
          <div class="spy-face spy-back"></div>
        </div>`;
      grid.appendChild(root);
      return { root, word: c.word, picks: root.querySelector(".spy-picks") as HTMLElement, back: root.querySelector(".spy-back") as HTMLElement, shown: "", pickKey: "" };
    });
    if (dealing) {
      grid.classList.remove("deal");
      void grid.offsetWidth;
      grid.classList.add("deal");
      dealing = false;
    }
  }

  function drawCards(s: SpyShared) {
    const key = s.round + ":" + s.cards.map((c) => c.word).join();
    if (key !== boardKey) {
      boardKey = key;
      build(s);
    }
    const keyed = s.phase === "round" || s.phase === "match";
    s.cards.forEach((c, i) => {
      const ce = cards[i]!;
      const shown = `${c.revealed ? "r" : ""}:${c.owner ?? ""}:${keyed}`;
      if (shown !== ce.shown) {
        ce.shown = shown;
        const r = ce.root;
        r.classList.toggle("open", c.revealed);
        r.classList.toggle("keyed", keyed && !c.revealed);
        r.dataset.owner = c.owner ?? "";
        if (c.revealed && c.owner) {
          ce.back.innerHTML = `<b>${esc(c.word)}</b><span class="spy-stamp">${STAMP[c.owner]}</span>`;
          r.classList.toggle("now", flips.has(i));
          flips.delete(i);
        }
      }
      // proposals: a dot per agent, in their team's colour, with their initial
      const pk = c.revealed ? "" : c.picks.join();
      if (pk !== ce.pickKey) {
        ce.pickKey = pk;
        ce.picks.innerHTML = c.revealed ? "" : c.picks.map((p) => `<i>${initial(s.seats[p]?.name ?? "?")}</i>`).join("");
        ce.root.classList.toggle("hot", !c.revealed && c.picks.length > 0);
        ce.root.dataset.turn = s.turn;
      }
    });
  }

  // ------------------------------------------------------------------ the team folders
  let fileKey: Record<Team, string> = { cobalt: "", saffron: "" };
  function drawFile(s: SpyShared, t: Team) {
    const team = s.seats.map((x, i) => ({ ...x, i })).filter((x) => x.team === t);
    const handler = team.find((x) => x.role === "handler");
    const agents = team.filter((x) => x.role === "agent");
    const on = (s.phase === "clue" || s.phase === "guess" || s.phase === "reveal") && s.turn === t;
    const clues = s.history.filter((c) => c.team === t).slice(-4);
    const pips = Array.from({ length: s.target }, (_, k) => `<i class="${k < s.wins[t] ? "on" : ""}"></i>`).join("");
    const person = (x: (typeof team)[number]) =>
      `<li class="${x.away ? "away" : ""}"><span>${esc(x.name)}</span>${x.bot ? "<em>bot</em>" : ""}</li>`;
    const html = `
      <div class="spy-tab">${TEAM_NAME[t]}</div>
      <div class="spy-file-in">
        <div class="spy-left"><b>${s.cardsLeft[t]}</b><span>to find</span></div>
        <div class="spy-pips">${pips}</div>
        <h4>Handler</h4>
        <ul class="spy-roster handler">${handler ? person(handler) : ""}</ul>
        <h4>Agents</h4>
        <ul class="spy-roster">${agents.map(person).join("")}</ul>
        ${clues.length ? `<h4>Clues</h4><ol class="spy-log">${clues.map((c) => `<li><span>${esc(c.word)}</span><b>${c.n}</b></li>`).join("")}</ol>` : ""}
      </div>`;
    const k = html + on;
    if (k === fileKey[t]) return;
    fileKey[t] = k;
    files[t].innerHTML = html;
    files[t].classList.toggle("on", on);
  }

  // ------------------------------------------------------------------ the clue at the top
  let clueKey = "";
  let clockEl: HTMLElement | null = null;
  let clockShown = "";
  function drawClue(s: SpyShared, vip?: string) {
    const T = (t: Team) => `<span class="t-${t}">${TEAM_NAME[t]}</span>`;
    let html = "";
    const timed = s.left > 0 && (s.phase === "clue" || s.phase === "guess");
    const handlerName = esc(s.seats.find((x) => x.team === s.turn && x.role === "handler")?.name ?? "");
    const endLine = s.ended
      ? { wrong: "missed", stop: "stopped", done: "used every guess", time: "ran out of time", "no-clue": "gave no clue in time" }[s.ended.why]
      : "";
    switch (s.phase) {
      case "brief":
        html = `<p class="spy-kicker">Round ${s.round}${s.rounds > 1 ? ` of ${s.rounds}` : ""}</p><h1 class="spy-big">Handlers, check your phones</h1>`;
        break;
      case "clue":
        html = `<p class="spy-kicker">${T(s.turn)} · handler ${handlerName}${s.ended ? ` <span class="spy-was">· ${TEAM_NAME[s.ended.team]} ${endLine}</span>` : ""}</p>
          <h1 class="spy-big quiet">Waiting for a clue<span class="spy-dots"><i></i><i></i><i></i></span></h1>`;
        break;
      case "guess":
      case "reveal": {
        const c = s.clue;
        if (!c) break;
        const left = Math.max(0, s.maxGuesses - s.guesses);
        const stop = s.stop.length ? ` · <span class="spy-stop">stop ${s.stop.length}/${s.need}</span>` : "";
        html = `<p class="spy-kicker">${T(c.team)} · ${left} ${left === 1 ? "guess" : "guesses"} left${stop}</p>
          <h1 class="spy-big clue t-${c.team}-line">${esc(c.word)}<span class="spy-n">${c.n}</span></h1>`;
        break;
      }
      case "round": {
        const w = s.winner!;
        const loser = w === "cobalt" ? "saffron" : "cobalt";
        html = `<p class="spy-kicker">Round ${s.round} · Cobalt ${s.wins.cobalt}–${s.wins.saffron} Saffron</p>
          <h1 class="spy-big">${T(w)} takes the round</h1>
          <p class="spy-strip">${s.why === "burn" ? `${TEAM_NAME[loser]} touched the burn card` : `${TEAM_NAME[w]} found every card`}</p>`;
        break;
      }
      case "match":
        html = `<p class="spy-kicker">Match over</p><h1 class="spy-big">${T(s.matchWinner!)} wins</h1>`;
        break;
    }
    const k = html + timed;
    if (k !== clueKey) {
      clueKey = k;
      clue.innerHTML = html + (timed ? `<span class="spy-clock"></span>` : "");
      clue.dataset.phase = s.phase;
      clockEl = clue.querySelector(".spy-clock");
      clockShown = "";
    }
    if (clockEl) setClock(s.left);
    // the match result slip over the board
    if (s.phase === "match" && s.matchWinner) {
      const w = s.matchWinner;
      const names = (t: Team) =>
        s.seats.filter((x) => x.team === t).map((x) => esc(x.name)).join(" · ");
      const html2 = `<div class="spy-slip-in t-${w}-slip">
          <p class="spy-file-no">Case closed · ${s.rounds > 1 ? `best of ${s.rounds}` : "one round"}</p>
          <h2>${TEAM_NAME[w]} wins the match</h2>
          <div class="spy-score"><span class="t-cobalt">Cobalt</span><b>${s.wins.cobalt}</b><i>–</i><b>${s.wins.saffron}</b><span class="t-saffron">Saffron</span></div>
          <p class="spy-names">${names(w)}</p>
          <p class="spy-next">${vip ? `${esc(vip)} can start a new match from their phone` : "Start a new match from the host phone"}</p>
          <span class="spy-stamp big">${TEAM_NAME[w]}</span>
        </div>`;
      if (slip.dataset.k !== html2) {
        slip.dataset.k = html2;
        slip.innerHTML = html2;
      }
      slip.hidden = false;
    } else if (!slip.hidden) {
      slip.hidden = true;
      slip.dataset.k = "";
    }
  }

  function setClock(ms: number) {
    if (!clockEl) return;
    const t = clock(ms);
    if (t === clockShown) return;
    clockShown = t;
    clockEl.textContent = t;
    clockEl.classList.toggle("low", ms <= 10000);
  }

  let last: SpyShared | null = null;
  return {
    render(s: SpyShared, vip?: string) {
      last = s;
      $(".spy-logo small").innerHTML = s.rounds > 1 ? `Round ${s.round}<br>Best of ${s.rounds}` : `Round ${s.round}`;
      drawCards(s);
      drawFile(s, "cobalt");
      drawFile(s, "saffron");
      drawClue(s, vip);
      el.dataset.phase = s.phase;
      el.dataset.turn = s.turn;
    },
    /** Live clock between state changes. */
    clock(ms: number, phase: string) {
      if (!last || (phase !== "clue" && phase !== "guess")) return;
      setClock(ms);
    },
    /** The next board is dealt with a little motion. */
    deal() {
      dealing = true;
      boardKey = "";
      fileKey = { cobalt: "", saffron: "" };
    },
    /** This card was just revealed: it flips over with a stamp (once). */
    flip(i: number) {
      flips.add(i);
    },
    dispose() {
      window.removeEventListener("resize", fit);
      el.remove();
    },
  };
}
