// The TV: a mid-century illustrated city map. A 1920x1080 stage scaled to the screen: the board on the left (a flat
// square loop of 28 spaces, baked once as DOM), the players with their cash and plot chips on the right. The middle of
// the board holds the turn, the dice, and the card or deed of the moment. Only pawns, ownership marks and the middle
// change; the dice tumble for half a second and a purchase stamps SOLD once.
import { BOARD, DISTRICTS, SIZE } from "./rules.ts";
import { CELL, GRID, clockText, dieFace, esc, iconSvg, innerSide, money, pawnSvg, ringXY } from "./look.ts";
import { PLAYER_COLORS, type BoomShared } from "./shared.ts";

const W = 1920;
const H = 1080;
const BX = 40;
const BY = 40;

const WHAT: Record<string, string> = {
  roll: "to roll",
  move: "on the move",
  buy: "buying or passing",
  act: "building and trading",
  trade: "waiting for an answer",
  card: "reading a rumour",
  skip: "sits this turn out",
};


export function createView(root: HTMLElement) {
  const el = document.createElement("div");
  el.className = "bt";
  el.innerHTML = `
    <div class="bt-stage">
      <section class="bt-board" style="left:${BX}px;top:${BY}px;width:${CELL * GRID}px;height:${CELL * GRID}px">
        <div class="bt-cells"></div>
        <div class="bt-centre">
          <div class="bt-turn"></div>
          <div class="bt-dice"><i class="bt-die"></i><i class="bt-die"></i></div>
          <div class="bt-event"></div>
          <div class="bt-notes"></div>
          <div class="bt-bar"><i></i></div>
        </div>
        <div class="bt-pawns"></div>
      </section>
      <aside class="bt-side">
        <header class="bt-head"><h1>Boomtown</h1><div class="bt-clock"><small>Time left</small><b></b></div></header>
        <div class="bt-rows"></div>
        <div class="bt-log"></div>
      </aside>
      <div class="bt-win" hidden></div>
    </div>`;
  root.appendChild(el);
  const stage = el.querySelector(".bt-stage") as HTMLElement;
  const $ = (sel: string) => el.querySelector(sel) as HTMLElement;
  const cellsEl = $(".bt-cells");
  const pawnsEl = $(".bt-pawns");
  const turnEl = $(".bt-turn");
  const diceEl = $(".bt-dice");
  const dice = [...diceEl.children] as HTMLElement[];
  const eventEl = $(".bt-event");
  const notesEl = $(".bt-notes");
  const barEl = $(".bt-bar i");
  const rowsEl = $(".bt-rows");
  const logEl = $(".bt-log");
  const clockEl = $(".bt-clock b");
  const clockBox = $(".bt-clock");
  const winEl = $(".bt-win");

  const fit = () => {
    const k = Math.min(window.innerWidth / W, window.innerHeight / H);
    stage.style.transform = `translate(${(window.innerWidth - W * k) / 2}px, ${(window.innerHeight - H * k) / 2}px) scale(${k})`;
  };
  fit();
  window.addEventListener("resize", fit);

  // ------------------------------------------------------------------ the board, baked once
  const cells: HTMLElement[] = [];
  const marks: { own: HTMLElement; st: HTMLElement; key: string }[] = [];
  BOARD.forEach((sp, i) => {
    const [c, r] = ringXY(i);
    const d = document.createElement("div");
    d.className = "bt-cell " + (sp.kind === "plot" ? "plot" : "special");
    d.style.left = c * CELL + "px";
    d.style.top = r * CELL + "px";
    d.dataset.band = innerSide(i);
    if (sp.kind === "plot") {
      const dist = DISTRICTS[sp.district]!;
      d.style.setProperty("--d", dist.color);
      d.innerHTML = `<em class="bt-band"></em><div class="bt-in"><b class="bt-name">${esc(sp.name)}</b><span class="bt-price">${money(sp.price)}</span><span class="bt-st"></span></div><u class="bt-own"></u><s class="bt-stamp">Sold</s>`;
    } else {
      d.dataset.kind = sp.kind;
      d.innerHTML = `<div class="bt-in">${iconSvg(sp.kind, 40)}<b class="bt-name">${esc(sp.name)}</b></div>`;
    }
    cellsEl.appendChild(d);
    cells.push(d);
    marks.push({ own: d.querySelector(".bt-own") as HTMLElement, st: d.querySelector(".bt-st") as HTMLElement, key: "" });
  });

  // ------------------------------------------------------------------ pawns
  interface PawnEl {
    root: HTMLElement;
    color: number;
    key: string;
  }
  const pawns = new Map<string, PawnEl>();
  const shown = new Map<string, number>();
  const animating = new Set<string>();
  let timers: number[] = [];
  let last: BoomShared | null = null;

  const slot = (pos: number, k: number, n: number): [number, number] => {
    const [c, r] = ringXY(pos);
    const side = innerSide(pos);
    if (pos % 7 === 0) {
      // a corner: the pawns gather in the harbour at its inner corner
      const dx = c === 0 ? 1 : -1;
      const dy = r === 0 ? 1 : -1;
      const bx = c * CELL + (dx > 0 ? CELL : 0);
      const by = r * CELL + (dy > 0 ? CELL : 0);
      return [bx + dx * (24 + (k % 3) * 38), by + dy * (24 + Math.floor(k / 3) * 38)];
    }
    // the middle of the colour band, spread along it, a second row nearer the middle of the board
    const cx = c * CELL + CELL / 2;
    const cy = r * CELL + CELL / 2;
    const row = k < 3 ? 0 : 1;
    const inRow = row === 0 ? Math.min(3, n) : n - 3;
    const idx = row === 0 ? k : k - 3;
    const along = (idx - (inRow - 1) / 2) * 38;
    const across = 0.5 * CELL + row * 30 + (BOARD[pos]!.kind === "plot" ? 0 : 20); // from the cell centre towards the inner edge, then into the middle
    switch (side) {
      case "t":
        return [cx + along, cy - across];
      case "b":
        return [cx + along, cy + across];
      case "l":
        return [cx - across, cy + along];
      default:
        return [cx + across, cy + along];
    }
  };

  function placePawns(glide = false) {
    if (!last) return;
    const groups = new Map<number, number[]>();
    last.players.forEach((p, i) => {
      if (p.out) return;
      const pos = shown.get(p.id) ?? p.pos;
      if (!groups.has(pos)) groups.set(pos, []);
      groups.get(pos)!.push(i);
    });
    for (const [pos, list] of groups) {
      list.forEach((pi, k) => {
        const pe = pawns.get(last!.players[pi]!.id);
        if (!pe) return;
        const [x, y] = slot(pos, k, list.length);
        pe.root.style.transitionDuration = glide ? "520ms" : "";
        pe.root.style.transform = `translate(${Math.round(x - 18)}px, ${Math.round(y - 18)}px)`;
      });
    }
  }

  function syncPawns(s: BoomShared) {
    const ids = new Set(s.players.filter((p) => !p.out).map((p) => p.id));
    for (const [id, pe] of pawns) {
      if (!ids.has(id)) {
        pe.root.remove();
        pawns.delete(id);
        shown.delete(id);
      }
    }
    s.players.forEach((p) => {
      if (p.out) return;
      let pe = pawns.get(p.id);
      if (!pe || pe.color !== p.color) {
        pe?.root.remove();
        const root = document.createElement("div");
        root.className = "bt-pawn";
        root.innerHTML = pawnSvg(p.color, 36);
        pawnsEl.appendChild(root);
        pe = { root, color: p.color, key: "" };
        pawns.set(p.id, pe);
        shown.set(p.id, p.pos);
      }
      if (!animating.has(p.id)) shown.set(p.id, p.pos);
      pe.root.classList.toggle("now", s.phase !== "over" && s.players[s.turn]?.id === p.id);
    });
    placePawns();
  }

  const later = (fn: () => void, ms: number) => {
    timers.push(window.setTimeout(fn, ms));
  };

  // ------------------------------------------------------------------ the dice
  let tumbling = 0;
  const showDice = (a: number, b: number) => {
    dice[0]!.innerHTML = dieFace(a);
    dice[1]!.innerHTML = dieFace(b);
  };
  showDice(1, 1);

  // ------------------------------------------------------------------ the middle of the board
  let turnKey = "";
  let eventKey = "";
  let notesKey = "";
  function drawCentre(s: BoomShared) {
    const p = s.players[s.turn];
    const over = s.phase === "over";
    const tk = over ? "over" : `${s.turn}:${s.phase}:${p?.name}:${p?.color}`;
    if (tk !== turnKey) {
      turnKey = tk;
      turnEl.innerHTML = over || !p
        ? `<div class="bt-who"><b>Match over</b></div>`
        : `<span class="bt-tp">${pawnSvg(p.color, 76)}</span><div class="bt-who"><b>${esc(p.name)}</b><small>${WHAT[s.phase] ?? ""}</small></div>`;
    }
    diceEl.classList.toggle("idle", s.phase === "roll" || over);
    if (!tumbling && s.phase !== "move") showDice(s.dice[0], s.dice[1]);

    let html = "";
    let ek: string = s.phase;
    const pl = (i: number) => s.players[i];
    if (s.phase === "card" && s.card) {
      ek = "card:" + s.card.id;
      html = `<div class="bt-ticket rumour"><small>Rumour</small><h2>${esc(s.card.title)}</h2><p>${esc(s.card.text)}</p></div>`;
    } else if (s.phase === "buy" && s.buying >= 0) {
      const sp = BOARD[s.buying]!;
      if (sp.kind === "plot") {
        const d = DISTRICTS[sp.district]!;
        ek = "buy:" + s.buying;
        html = `<div class="bt-ticket deed" style="--d:${d.color}"><em></em><small>${esc(d.name)}</small><h2>${esc(sp.name)}</h2><p class="bt-big">${money(sp.price)}</p></div>`;
      }
    } else if (s.phase === "trade" && s.offer) {
      const o = s.offer;
      const sp = BOARD[o.plot]!;
      const d = sp.kind === "plot" ? DISTRICTS[sp.district]! : null;
      ek = `trade:${o.plot}:${o.price}`;
      html = `<div class="bt-ticket deed" style="--d:${d?.color ?? "#999"}"><em></em><small>${esc(pl(o.from)?.name ?? "")} offers ${esc(pl(o.to)?.name ?? "")}</small><h2>${esc(sp.name)}</h2><p class="bt-big">${money(o.price)}</p></div>`;
    } else if (s.phase === "skip" && p) {
      ek = "skip:" + s.turn;
      html = `<div class="bt-ticket plain"><small>Dock Strike</small><h2>${esc(p.name)} sits this turn out</h2></div>`;
    }
    if (ek !== eventKey) {
      eventKey = ek;
      eventEl.innerHTML = html;
      eventEl.classList.toggle("on", !!html);
    }

    const nk = s.notes.join("|") + "|" + (s.final ? 1 : 0);
    if (nk !== notesKey) {
      notesKey = nk;
      const lines = s.notes.slice(-2);
      notesEl.innerHTML = lines.map((t, i) => `<p class="${i === lines.length - 1 ? "new" : ""}">${esc(t)}</p>`).join("");
    }
  }

  // ------------------------------------------------------------------ the board marks
  function drawMarks(s: BoomShared) {
    for (let i = 0; i < SIZE; i++) {
      if (BOARD[i]!.kind !== "plot") continue;
      const o = s.owner[i]!;
      const st = s.storeys[i]!;
      const pl = o >= 0 ? s.players[o] : undefined;
      const key = pl ? `${pl.color}:${st}` : "";
      const m = marks[i]!;
      if (key === m.key) continue;
      m.key = key;
      const cell = cells[i]!;
      cell.classList.toggle("owned", !!pl);
      if (pl) {
        cell.style.setProperty("--o", PLAYER_COLORS[pl.color]!);
        m.own.innerHTML = pawnSvg(pl.color, 20);
      } else {
        m.own.innerHTML = "";
      }
      m.st.innerHTML = "<i></i>".repeat(st);
    }
  }

  // ------------------------------------------------------------------ the players
  let rowsKey = "";
  function drawRows(s: BoomShared) {
    const over = s.phase === "over";
    const key = JSON.stringify([s.players.map((p) => [p.name, p.cash, p.out, p.skip, p.bot, p.away, p.color]), s.turn, over, s.owner, s.storeys, over ? s.winner : 0]);
    if (key === rowsKey) return;
    rowsKey = key;
    const order = over ? s.players.map((_, i) => i).sort((a, b) => (s.players[b]!.out ? -1 : s.players[b]!.worth) - (s.players[a]!.out ? -1 : s.players[a]!.worth)) : s.players.map((_, i) => i);
    rowsEl.innerHTML = order
      .map((i) => {
        const p = s.players[i]!;
        const plots: string[] = [];
        for (let q = 0; q < SIZE; q++) {
          if (s.owner[q] !== i) continue;
          const sp = BOARD[q]!;
          if (sp.kind !== "plot") continue;
          plots.push(`<i style="background:${DISTRICTS[sp.district]!.color}">${s.storeys[q]! > 0 ? `<b>${s.storeys[q]}</b>` : ""}</i>`);
        }
        const tag = p.out ? "Out" : p.skip ? "Sits out" : p.away ? "Away" : p.bot ? "Computer" : "";
        const cls = ["bt-row", i === s.turn && !over ? "turn" : "", p.out ? "out" : "", over ? "over" : "", over && i === s.winner ? "won" : ""].join(" ");
        return `<div class="${cls}">
          <span class="bt-rp">${pawnSvg(p.color, 56)}</span>
          <b class="bt-rn">${esc(p.name)}</b>${tag ? `<small class="bt-tag">${tag}</small>` : ""}
          <span class="bt-cash">${p.out ? "&nbsp;" : money(p.cash)}</span>
          <span class="bt-chips">${plots.join("")}</span>
          ${over && !p.out ? `<small class="bt-worth">Worth ${money(p.worth)}</small>` : ""}
        </div>`;
      })
      .join("");
  }

  let logKey = "";
  function drawLog(s: BoomShared) {
    const lines = Math.max(0, Math.floor((1000 - 128 - s.players.length * 143 - 20) / 35));
    const log = s.log.slice(-lines);
    const k = log.join("|");
    if (k === logKey) return;
    logKey = k;
    logEl.innerHTML = log.map((t, i) => `<p class="${i === log.length - 1 ? "new" : ""}">${esc(t)}</p>`).join("");
  }

  let winKey = "";
  function drawWin(s: BoomShared, vip?: string) {
    const over = s.phase === "over" && s.winner >= 0;
    winEl.hidden = !over;
    if (!over) {
      winKey = "";
      return;
    }
    const w = s.players[s.winner]!;
    const k = `${s.winner}:${w.name}:${s.why}:${vip}`;
    if (k === winKey) return;
    winKey = k;
    winEl.style.setProperty("--w", PLAYER_COLORS[w.color]!);
    winEl.innerHTML = `<div class="bt-winbox"><small>${s.why === "last" ? "Last one standing" : "Richest at the final bell"}</small><div class="bt-wp">${pawnSvg(w.color, 110)}</div><h2>${esc(w.name)}</h2><p>${money(w.worth)} in cash and property</p><span>${vip ? `${esc(vip)} can start a new match from their phone` : "Start a new match from the host phone"}</span></div>`;
  }

  // ------------------------------------------------------------------ the clocks
  let clockKey = "";
  let barKey = -1;
  function clock(timer: number, max: number, matchLeft: number, final: boolean) {
    const t = final ? "Last lap" : clockText(matchLeft);
    if (t !== clockKey) {
      clockKey = t;
      clockEl.textContent = t;
      clockBox.classList.toggle("final", final);
    }
    const f = max > 0 && timer > 0 && last && ["roll", "buy", "act", "trade"].includes(last.phase) && !last.players[last.turn]?.bot ? Math.round((timer / max) * 100) : 0;
    if (f !== barKey) {
      barKey = f;
      barEl.style.width = f + "%";
      barEl.parentElement!.classList.toggle("low", f > 0 && f < 25);
    }
  }

  return {
    render(s: BoomShared, vip?: string) {
      last = s;
      el.dataset.phase = s.phase;
      syncPawns(s);
      drawMarks(s);
      drawCentre(s);
      drawRows(s);
      drawLog(s);
      drawWin(s, vip);
      clock(s.left, s.leftMax, s.final ? 0 : s.clock, s.final);
    },
    clock,
    /** The dice tumble for half a second, then the pawn hops space by space. */
    roll(player: number, d: [number, number], from: number, steps: number) {
      const id = last?.players[player]?.id;
      window.clearInterval(tumbling);
      tumbling = window.setInterval(() => showDice(1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)), 75);
      diceEl.classList.remove("tumble");
      void diceEl.offsetWidth;
      diceEl.classList.add("tumble");
      later(() => {
        window.clearInterval(tumbling);
        tumbling = 0;
        showDice(d[0], d[1]);
      }, 560);
      if (!id) return;
      animating.add(id);
      for (let k = 1; k <= steps; k++) {
        later(() => {
          shown.set(id, (from + k) % SIZE);
          placePawns();
          if (k === steps) animating.delete(id);
        }, 620 + k * 130);
      }
    },
    /** A ferry or a card moves a pawn straight to its space. */
    jump(player: number, _from: number, to: number) {
      const id = last?.players[player]?.id;
      if (!id) return;
      animating.delete(id);
      shown.set(id, to);
      placePawns(true);
    },
    /** SOLD, stamped once. */
    sold(plot: number) {
      const c = cells[plot];
      if (!c) return;
      c.classList.remove("sold");
      void c.offsetWidth;
      c.classList.add("sold");
      later(() => c.classList.remove("sold"), 1800);
    },
    reset() {
      timers.forEach((t) => window.clearTimeout(t));
      timers = [];
      window.clearInterval(tumbling);
      tumbling = 0;
      animating.clear();
      shown.clear();
      for (const pe of pawns.values()) pe.root.remove();
      pawns.clear();
      marks.forEach((m) => (m.key = ""));
      cells.forEach((c) => c.classList.remove("sold"));
      turnKey = eventKey = notesKey = rowsKey = winKey = logKey = "";
      showDice(1, 1);
    },
    dispose() {
      timers.forEach((t) => window.clearTimeout(t));
      window.clearInterval(tumbling);
      window.removeEventListener("resize", fit);
      el.remove();
    },
  };
}
