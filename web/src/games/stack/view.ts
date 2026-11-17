// The table on the TV, light by design:
//  - bg: the kraft table and every well's paper card, baked once per layout (fibres, shadows, tape: all here).
//  - one small canvas per well (a gutter for waiting paper, then the board). It is redrawn only when that well's
//    `ver` changes, from tile sprites baked per colour at the cell size (fill + a 2 px misregistered second ink).
//  - fx: one canvas over everything for the paper strips that tear off on a clear and the slips that fly on an
//    attack. Cleared and drawn only while one of them is moving.
//  - names, wins, the next piece and the OUT stamps are DOM on each card (so text needs no re-bake for fonts).
import { isWebOS } from "../../shell/tv.ts";
import { INKS, LOOK, SECOND } from "./look.ts";
import { COLS, H, HIDDEN, PAPER, ROWS, TURNS, dropY, pendingOf, type Kind, type Seat, type Stack } from "./rules.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const TEAR_MS = 700;
const SLIP_MS = 650;

/** A small seeded random source for baked texture (the same look every bake). */
function rnd(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

interface Card {
  slot: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface WellView {
  id: string;
  card: Card;
  el: HTMLElement;
  board: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  mini: HTMLCanvasElement;
  name: HTMLElement;
  pips: HTMLElement;
  lines: HTMLElement;
  stamp: HTMLElement;
  ver: number;
  key: string;
  next: string;
}

interface Tear {
  img: HTMLCanvasElement;
  x: number;
  y: number;
  dir: number;
  t0: number;
}
interface Slip {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  n: number;
  t0: number;
}

export class TableView {
  readonly el: HTMLElement;
  private bg = document.createElement("canvas");
  private fx = document.createElement("canvas");
  private fctx: CanvasRenderingContext2D;
  private cardsEl = document.createElement("div");
  private wells = new Map<string, WellView>();
  /** CSS px per cell, backing px per CSS px, and 1080p px per CSS px. */
  cell = 30;
  private res = 1;
  private u = 1;
  private gutter = 12;
  private tiles: HTMLCanvasElement[] = [];
  private ghosts: HTMLCanvasElement[] = [];
  private paper: HTMLCanvasElement[] = [];
  private boardBg: HTMLCanvasElement | null = null;
  private slipSprite: HTMLCanvasElement | null = null;
  private tears: Tear[] = [];
  private slips: Slip[] = [];
  private fxDirty = false;
  private layoutKey = "";
  /** The top band's height, for the HUD. */
  band = 96;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "sta-table";
    this.cardsEl.className = "sta-cards";
    this.el.append(this.bg, this.cardsEl, this.fx);
    this.bg.className = "sta-bg";
    this.fx.className = "sta-fx";
    parent.appendChild(this.el);
    this.fctx = this.fx.getContext("2d")!;
  }

  // ------------------------------------------------------------------ layout

  /** Places a card for each well (in seat order). Kept until the set of wells or the size changes. */
  layout(list: Seat[], force = false) {
    const W = this.el.clientWidth || window.innerWidth;
    const Ht = this.el.clientHeight || window.innerHeight;
    const key = `${W}x${Ht}|${list.map((s) => `${s.id}:${s.slot}`).join(",")}`;
    if (key === this.layoutKey && !force) return;
    this.layoutKey = key;
    const u = Ht / 1080;
    this.u = u;
    const dpr = window.devicePixelRatio || 1;
    this.res = isWebOS ? Math.min(dpr, 1920 / Math.max(1, W)) : dpr;
    this.band = Math.round(104 * u);
    const M = 40 * u;
    const G = 26 * u;
    const pad = Math.round(14 * u);
    const head = Math.round(78 * u);
    const foot = Math.round(58 * u);
    const n = Math.max(1, list.length);

    let best = { cell: 0, rows: 1 };
    for (const rows of n >= 5 ? [1, 2] : [1]) {
      const per = Math.ceil(n / rows);
      const cw = (W - 2 * M - (per - 1) * G) / per;
      const cellW = (cw - 2 * pad) / (COLS + 0.45);
      const ch = (Ht - this.band - M - (rows - 1) * G) / rows;
      const cellH = (ch - head - foot) / ROWS;
      const cell = Math.floor(Math.min(cellW, cellH, 50 * u));
      if (cell > best.cell) best = { cell, rows };
    }
    const cell = Math.max(8, best.cell);
    this.cell = cell;
    this.gutter = Math.round(cell * 0.45);
    const cw = pad * 2 + this.gutter + COLS * cell;
    const ch = head + ROWS * cell + foot;
    const per = Math.ceil(n / best.rows);
    const cards: Card[] = [];
    const totalH = best.rows * ch + (best.rows - 1) * G;
    const y0 = this.band + Math.max(0, (Ht - this.band - M - totalH) / 2);
    for (let r = 0; r < best.rows; r++) {
      const inRow = list.slice(r * per, r * per + per);
      const rowW = inRow.length * cw + (inRow.length - 1) * G;
      const x0 = (W - rowW) / 2;
      inRow.forEach((s, i) => cards.push({ slot: s.slot, x: Math.round(x0 + i * (cw + G)), y: Math.round(y0 + r * (ch + G)), w: cw, h: ch }));
    }

    // canvases
    for (const c of [this.bg, this.fx]) {
      c.width = Math.round(W * this.res);
      c.height = Math.round(Ht * this.res);
    }
    this.bakeSprites();
    this.bakeTable(W, Ht, cards);

    // cards
    for (const w of this.wells.values()) w.el.remove();
    this.wells.clear();
    list.forEach((s, i) => {
      const card = cards[i]!;
      const el = document.createElement("div");
      el.className = "sta-card";
      Object.assign(el.style, { left: `${card.x}px`, top: `${card.y}px`, width: `${card.w}px`, height: `${card.h}px` });
      el.style.setProperty("--k", INKS[s.slot]!);
      el.innerHTML = `
        <header style="height:${head}px;padding:0 ${pad}px"><span class="sta-nm"></span><span class="sta-pips"></span></header>
        <footer style="top:${head + ROWS * cell}px;height:${foot}px;padding:0 ${pad}px"><span class="sta-ln"></span></footer>
        <b class="sta-stamp" hidden></b>`;
      const board = canvas((this.gutter + COLS * cell) * this.res, ROWS * cell * this.res);
      board.className = "sta-board";
      Object.assign(board.style, { left: `${pad}px`, top: `${head}px`, width: `${this.gutter + COLS * cell}px`, height: `${ROWS * cell}px` });
      const mcell = Math.round(cell * 0.42);
      const mini = canvas(3 * mcell * this.res, 3 * mcell * this.res);
      mini.className = "sta-mini-tv";
      Object.assign(mini.style, { width: `${3 * mcell}px`, height: `${3 * mcell}px` });
      el.querySelector("footer")!.prepend(mini);
      el.appendChild(board);
      this.cardsEl.appendChild(el);
      const stamp = el.querySelector(".sta-stamp") as HTMLElement;
      Object.assign(stamp.style, { top: `${head + (ROWS * cell) / 2}px` });
      this.wells.set(s.id, {
        id: s.id, card, el, board, ctx: board.getContext("2d")!, mini,
        name: el.querySelector(".sta-nm") as HTMLElement, pips: el.querySelector(".sta-pips") as HTMLElement,
        lines: el.querySelector(".sta-ln") as HTMLElement, stamp, ver: -1, key: "", next: "",
      });
    });
    this.tears = [];
    this.slips = [];
    this.fxDirty = true;
  }

  // ------------------------------------------------------------------ baking

  private bakeSprites() {
    const s = Math.round(this.cell * this.res);
    const off = Math.max(1, Math.round(2 * this.u * this.res));
    const inset = Math.max(1, Math.round(s * 0.045));
    this.tiles = INKS.map((ink, i) => {
      const c = canvas(s, s);
      const x = c.getContext("2d")!;
      const r = rnd(31 + i);
      const q = s - inset * 2 - off;
      // two passes through the press, 2 px off register: the second ink peeks out bottom-right
      x.fillStyle = SECOND[i]!;
      x.fillRect(inset + off, inset + off, q, q);
      x.fillStyle = ink;
      x.fillRect(inset, inset, q, q);
      // riso grain: paper showing through in specks
      x.globalCompositeOperation = "destination-out";
      x.fillStyle = "rgba(0,0,0,0.4)";
      const d = Math.max(1, Math.round(this.res));
      for (let k = 0; k < s * 1.1; k++) x.fillRect(Math.floor(r() * s), Math.floor(r() * s), d, d);
      // a cut edge catching the light along the top and left
      x.globalCompositeOperation = "source-over";
      x.fillStyle = "rgba(255,255,255,0.32)";
      x.fillRect(inset, inset, q, Math.max(1, Math.round(s * 0.08)));
      x.fillRect(inset, inset, Math.max(1, Math.round(s * 0.08)), q);
      return c;
    });
    this.ghosts = INKS.map((ink) => {
      const c = canvas(s, s);
      const x = c.getContext("2d")!;
      x.strokeStyle = ink;
      x.globalAlpha = 0.75;
      x.lineWidth = Math.max(1.5, s * 0.07);
      x.setLineDash([Math.max(2, s * 0.16), Math.max(2, s * 0.1)]);
      const m = inset + x.lineWidth / 2 + 1;
      x.strokeRect(m, m, s - m * 2, s - m * 2);
      return c;
    });
    // paper rows: grey newsprint with ink hatching; the second one has cracked once
    this.paper = [0, 1].map((cracked) => {
      const c = canvas(s, s);
      const x = c.getContext("2d")!;
      x.fillStyle = "#d6cfbf";
      x.fillRect(inset, inset, s - inset * 2, s - inset * 2);
      x.save();
      x.beginPath();
      x.rect(inset, inset, s - inset * 2, s - inset * 2);
      x.clip();
      x.strokeStyle = "rgba(27,27,27,0.32)";
      x.lineWidth = Math.max(1, s * 0.045);
      for (let k = -s; k < s * 2; k += s / 4) {
        x.beginPath();
        x.moveTo(k, s);
        x.lineTo(k + s, 0);
        x.stroke();
      }
      x.restore();
      x.strokeStyle = LOOK.ink;
      x.globalAlpha = 0.55;
      x.lineWidth = Math.max(1, s * 0.05);
      x.strokeRect(inset + x.lineWidth / 2, inset + x.lineWidth / 2, s - inset * 2 - x.lineWidth, s - inset * 2 - x.lineWidth);
      if (cracked) {
        // one crack runs across the row, tile to tile
        x.globalAlpha = 1;
        x.strokeStyle = LOOK.ink;
        x.lineWidth = Math.max(1.5, s * 0.08);
        x.lineJoin = "miter";
        x.beginPath();
        x.moveTo(0, s * 0.5);
        x.lineTo(s * 0.3, s * 0.36);
        x.lineTo(s * 0.55, s * 0.62);
        x.lineTo(s * 0.8, s * 0.4);
        x.lineTo(s, s * 0.5);
        x.stroke();
      }
      return c;
    });
    // the board: card paper, faint column rules, and the gutter for waiting paper
    const g = Math.round(this.gutter * this.res);
    const bw = g + COLS * s;
    const bh = ROWS * s;
    const b = canvas(bw, bh);
    const x = b.getContext("2d")!;
    x.fillStyle = "#ebe5d8";
    x.fillRect(g, 0, COLS * s, bh);
    x.fillStyle = "rgba(27,27,27,0.06)";
    for (let i = 1; i < COLS; i++) x.fillRect(g + i * s - Math.round(this.res / 2), 0, Math.max(1, Math.round(this.res)), bh);
    x.fillStyle = "rgba(27,27,27,0.5)";
    x.fillRect(g, bh - Math.max(2, Math.round(3 * this.u * this.res)), COLS * s, Math.max(2, Math.round(3 * this.u * this.res)));
    x.fillStyle = LOOK.paper;
    x.fillRect(0, 0, g, bh);
    x.fillStyle = "rgba(27,27,27,0.1)";
    x.fillRect(Math.round(g * 0.3), 0, Math.max(1, Math.round(g * 0.4)), bh);
    this.boardBg = b;
    // the attack slip: a little torn strip of pink paper
    const sw = Math.round(this.cell * 2.4 * this.res);
    const sh = Math.round(this.cell * 0.8 * this.res);
    const sl = canvas(sw + off, sh + off);
    const y = sl.getContext("2d")!;
    y.fillStyle = LOOK.blue;
    y.fillRect(off, off, sw, sh);
    y.globalCompositeOperation = "multiply";
    y.fillStyle = LOOK.pink;
    y.fillRect(0, 0, sw, sh);
    this.slipSprite = sl;
  }

  private bakeTable(W: number, Ht: number, cards: Card[]) {
    const x = this.bg.getContext("2d")!;
    x.setTransform(this.res, 0, 0, this.res, 0, 0);
    x.fillStyle = LOOK.kraft;
    x.fillRect(0, 0, W, Ht);
    // kraft fibres
    const r = rnd(7);
    for (let i = 0; i < (W * Ht) / 900; i++) {
      x.fillStyle = r() < 0.5 ? "rgba(255,240,215,0.10)" : "rgba(70,45,20,0.10)";
      const len = 3 + r() * 14;
      const a = (r() - 0.5) * 0.6;
      x.save();
      x.translate(r() * W, r() * Ht);
      x.rotate(a);
      x.fillRect(0, 0, len, 1.2);
      x.restore();
    }
    // cards: a soft shadow, then paper, each turned a hair, with a strip of the player's ink on top and tape
    const u = this.u;
    for (const c of cards) {
      const turn = ((((c.slot * 37) % 7) - 3) / 3) * 0.006;
      x.save();
      x.translate(c.x + c.w / 2, c.y + c.h / 2);
      x.rotate(turn);
      x.shadowColor = "rgba(50,30,10,0.35)";
      x.shadowBlur = 18 * u;
      x.shadowOffsetY = 6 * u;
      x.fillStyle = LOOK.paper;
      x.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      x.shadowColor = "transparent";
      // ink band along the top, misregistered
      const bh = Math.round(9 * u);
      x.fillStyle = SECOND[c.slot]!;
      x.globalAlpha = 0.9;
      x.fillRect(-c.w / 2 + 2 * u, -c.h / 2 + 2 * u, c.w, bh);
      x.globalAlpha = 1;
      x.globalCompositeOperation = "multiply";
      x.fillStyle = INKS[c.slot]!;
      x.fillRect(-c.w / 2, -c.h / 2, c.w, bh);
      x.globalCompositeOperation = "source-over";
      // paper grain
      const g = rnd(100 + c.slot);
      x.fillStyle = "rgba(120,100,70,0.07)";
      for (let i = 0; i < (c.w * c.h) / 260; i++) x.fillRect(-c.w / 2 + g() * c.w, -c.h / 2 + g() * c.h, 1.5, 1.5);
      x.restore();
      // tape on the top corners
      for (const side of [-1, 1]) {
        x.save();
        x.translate(c.x + c.w / 2 + side * (c.w / 2 - 6 * u), c.y + 4 * u);
        x.rotate(side * -0.6);
        x.fillStyle = "rgba(255,248,215,0.55)";
        x.fillRect(-26 * u, -9 * u, 52 * u, 18 * u);
        x.restore();
      }
    }
  }

  // ------------------------------------------------------------------ per frame

  /** Redraws the wells that changed, and the DOM on their cards. */
  sync(game: Stack, now: number) {
    const live = game.phase === "play" || game.phase === "round" || game.phase === "count";
    for (const w of this.wells.values()) {
      const s = game.seats.get(w.id);
      if (!s) continue;
      if (s.ver !== w.ver) {
        w.ver = s.ver;
        this.drawWell(w, s, game);
      }
      const out = live && s.inRound && !s.alive && !(game.phase === "round" && game.roundWinner === s.id) && game.phase !== "count";
      const won = game.phase === "round" && game.roundWinner === s.id;
      const key = `${s.name}|${s.wins}|${game.opts.wins}|${s.lines}|${out}|${won}|${s.gone}|${game.solo}`;
      if (key !== w.key) {
        w.key = key;
        w.name.textContent = s.name;
        w.pips.innerHTML = game.solo ? "" : Array.from({ length: game.opts.wins }, (_, i) => `<i class="${i < s.wins ? "on" : ""}"></i>`).join("");
        w.lines.textContent = `${s.lines} ${s.lines === 1 ? "line" : "lines"}`;
        w.stamp.hidden = !out && !won;
        w.stamp.textContent = won ? "Wins" : s.gone ? "Left" : "Out";
        w.stamp.className = `sta-stamp${won ? " won" : ""}`;
        w.el.classList.toggle("out", out);
      }
      const next = s.inRound && s.alive && game.phase !== "match" ? s.next : "";
      if (next !== w.next) {
        w.next = next;
        this.drawMini(w, s.slot, next || null);
      }
    }
    this.frameFx(now);
  }

  private drawWell(w: WellView, s: Seat, game: Stack) {
    const x = w.ctx;
    const cs = Math.round(this.cell * this.res);
    const g = Math.round(this.gutter * this.res);
    x.globalAlpha = 1;
    x.drawImage(this.boardBg!, 0, 0);
    const tile = this.tiles[s.slot]!;
    for (let y = HIDDEN; y < H; y++) {
      for (let cx = 0; cx < COLS; cx++) {
        const v = s.grid[y * COLS + cx]!;
        if (!v) continue;
        const img = v === PAPER ? this.paper[s.paper[y] === 1 ? 1 : 0]! : tile;
        x.drawImage(img, g + cx * cs, (y - HIDDEN) * cs);
      }
    }
    const p = s.piece;
    if (p && s.alive && game.phase === "play") {
      const gy = dropY(s.grid, p.kind, p.rot, p.x, p.y);
      const cells = TURNS[p.kind][p.rot]!;
      if (gy !== p.y) {
        for (const [cx, cy] of cells) if (gy + cy >= HIDDEN) x.drawImage(this.ghosts[s.slot]!, g + (p.x + cx) * cs, (gy + cy - HIDDEN) * cs);
      }
      for (const [cx, cy] of cells) if (p.y + cy >= HIDDEN) x.drawImage(tile, g + (p.x + cx) * cs, (p.y + cy - HIDDEN) * cs);
    } else if (p) {
      for (const [cx, cy] of TURNS[p.kind][p.rot]!) if (p.y + cy >= HIDDEN) x.drawImage(tile, g + (p.x + cx) * cs, (p.y + cy - HIDDEN) * cs);
    }
    // waiting paper, stacked up the gutter from the bottom
    const n = Math.min(ROWS, pendingOf(s));
    if (n) {
      x.fillStyle = LOOK.pink;
      const m = Math.max(1, Math.round(cs * 0.08));
      for (let i = 0; i < n; i++) x.fillRect(Math.round(g * 0.15), (ROWS - 1 - i) * cs + m, Math.round(g * 0.7), cs - m * 2);
    }
    const out = s.inRound && !s.alive && game.phase !== "count" && !(game.phase === "round" && game.roundWinner === s.id);
    if (out) {
      x.fillStyle = "rgba(243,239,230,0.62)";
      x.fillRect(g, 0, COLS * cs, ROWS * cs);
    }
  }

  private drawMini(w: WellView, slot: number, kind: Kind | null) {
    const x = w.mini.getContext("2d")!;
    x.clearRect(0, 0, w.mini.width, w.mini.height);
    if (!kind) return;
    const cells = TURNS[kind][0]!;
    const xs = cells.map(([a]) => a);
    const ys = cells.map(([, b]) => b);
    const cw = Math.max(...xs) - Math.min(...xs) + 1;
    const chh = Math.max(...ys) - Math.min(...ys) + 1;
    const s = Math.floor(w.mini.width / 3);
    const ox = Math.round((w.mini.width - cw * s) / 2) - Math.min(...xs) * s;
    const oy = Math.round((w.mini.height - chh * s) / 2) - Math.min(...ys) * s;
    for (const [cx, cy] of cells) x.drawImage(this.tiles[slot]!, ox + cx * s, oy + cy * s, s, s);
  }

  // ------------------------------------------------------------------ effects

  /** Rows tear off a well like a strip of paper (drawn from sprites: the board may already show them gone). */
  tear(id: string, rows: number[], cells: number[][], cracked = false) {
    const w = this.wells.get(id);
    if (!w) return;
    const cs = Math.round(this.cell * this.res);
    const g = Math.round(this.gutter * this.res);
    const slot = w.card.slot;
    rows.forEach((row, i) => {
      if (row < HIDDEN) return;
      const img = canvas(COLS * cs, cs);
      const x = img.getContext("2d")!;
      cells[i]!.forEach((v, cx) => {
        if (v) x.drawImage(v === PAPER ? this.paper[cracked ? 1 : 0]! : this.tiles[slot]!, cx * cs, 0);
      });
      // ragged torn edges
      x.globalCompositeOperation = "destination-out";
      const r = rnd(row * 13 + rows.length);
      for (const edge of [0, cs]) {
        x.beginPath();
        x.moveTo(0, edge);
        for (let px = 0; px <= COLS * cs; px += cs * 0.22) x.lineTo(px, edge + (edge ? -1 : 1) * r() * cs * 0.16);
        x.lineTo(COLS * cs, edge);
        x.closePath();
        x.fill();
      }
      const boardLeft = (w.card.x + parseFloat(w.board.style.left)) * this.res + g;
      const boardTop = (w.card.y + parseFloat(w.board.style.top)) * this.res;
      this.tears.push({ img, x: boardLeft, y: boardTop + (row - HIDDEN) * cs, dir: i % 2 ? -1 : 1, t0: performance.now() });
    });
  }

  /** A slip of paper flies from one card to another. */
  attack(from: string, to: string, n: number) {
    const a = this.wells.get(from);
    const b = this.wells.get(to);
    if (!a || !b) return;
    const k = this.res;
    this.slips.push({
      x0: (a.card.x + a.card.w / 2) * k, y0: (a.card.y + a.card.h * 0.35) * k,
      x1: (b.card.x + this.gutter) * k, y1: (b.card.y + b.card.h * 0.75) * k, n, t0: performance.now(),
    });
  }

  private frameFx(now: number) {
    if (!this.tears.length && !this.slips.length) {
      if (this.fxDirty) {
        this.fctx.setTransform(1, 0, 0, 1, 0, 0);
        this.fctx.clearRect(0, 0, this.fx.width, this.fx.height);
        this.fxDirty = false;
      }
      return;
    }
    const x = this.fctx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.clearRect(0, 0, this.fx.width, this.fx.height);
    this.fxDirty = true;
    const cs = this.cell * this.res;
    this.tears = this.tears.filter((t) => {
      const k = (now - t.t0) / TEAR_MS;
      if (k >= 1) return false;
      const e = k * k;
      x.save();
      x.globalAlpha = 1 - e;
      x.translate(t.x + t.img.width / 2 + t.dir * k * cs * 1.6, t.y + t.img.height / 2 - (k * 0.9 + e * 1.8) * cs);
      x.rotate(t.dir * (k * 0.14 + e * 0.12));
      x.drawImage(t.img, -t.img.width / 2, -t.img.height / 2);
      x.restore();
      return true;
    });
    const sp = this.slipSprite!;
    this.slips = this.slips.filter((s) => {
      const k = (now - s.t0) / SLIP_MS;
      if (k >= 1) return false;
      const e = 1 - (1 - k) * (1 - k);
      const px = s.x0 + (s.x1 - s.x0) * e;
      const py = s.y0 + (s.y1 - s.y0) * e - Math.sin(Math.PI * e) * cs * 4;
      x.save();
      x.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
      x.translate(px, py);
      x.rotate((s.x1 > s.x0 ? 1 : -1) * (0.3 + e * 1.2));
      const sc = 0.8 + Math.min(4, s.n) * 0.15;
      x.drawImage(sp, (-sp.width * sc) / 2, (-sp.height * sc) / 2, sp.width * sc, sp.height * sc);
      x.restore();
      return true;
    });
  }

  /** Forces every well to redraw (a new round, a phase change the boards show). */
  invalidate() {
    for (const w of this.wells.values()) {
      w.ver = -1;
      w.key = "";
      w.next = "-";
    }
  }

  /** Card rectangles, for the HUD (in CSS px). */
  cards(): { id: string; x: number; y: number; w: number; h: number }[] {
    return [...this.wells.values()].map((w) => ({ id: w.id, x: w.card.x, y: w.card.y, w: w.card.w, h: w.card.h }));
  }

  dispose() {
    this.el.remove();
  }
}

export { esc };
