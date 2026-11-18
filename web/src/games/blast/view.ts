// The diorama on the TV, in layers:
//  - void: the drop under the platform, the whole screen, drawn once per size;
//  - ghost + floor: the platform (wood rim, felt, holes, side wall), baked again only when it crumbles (the old one
//    fades away under the new one);
//  - fx: cleared every frame, the size of the arena box only: shadows, crates, power-ups, bombs, fighters, name tags,
//    blasts and debris.
// Fighters, bombs, crates and power-ups are pre-baked sprites (fixed light), and the shadow is one pre-baked soft oval,
// so a frame is a few dozen drawImage calls. No blur, no per-frame gradients.
import { isWebOS } from "../../shell/tv.ts";
import type { Pt } from "./arenas.ts";
import { LOOK, SANS, inkOf } from "./look.ts";
import { BR, JUMP_STEPS, PR, type BlastEvent, type Bomb, type Blast, type BombKind, type PowerKind, type Seat } from "./rules.ts";

/** The arena box is the platform plus this much room all round (logical px), and never scales past MAX_SCALE. */
const MARGIN = 56;
const MAX_SCALE = 1.9;
const WALL = 26;
const BLAST_MS = 420;
const DEBRIS_MS = 700;
const KICK_MS = 150;
const GHOST_MS = 520;

interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  rot: number;
  vr: number;
  color: string;
}
interface Fx {
  type: "blast" | "ring" | "debris";
  t0: number;
  x: number;
  y: number;
  r: number;
  big?: boolean;
  color?: string;
  bits?: Debris[];
}
interface Item {
  y: number;
  kind: 0 | 1 | 2 | 3;
  ref: Seat | Bomb | { x: number; y: number; w: number; h: number; kind: "crate" | "soap" } | { x: number; y: number; kind: PowerKind; age: number };
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

/** A tiny deterministic random source for the baked textures. */
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
};

export class ArenaView {
  readonly el: HTMLElement;
  private bg = document.createElement("canvas");
  private ghost = document.createElement("canvas");
  private floor = document.createElement("canvas");
  private fx = document.createElement("canvas");
  private fctx: CanvasRenderingContext2D;
  /** CSS px per logical px, and backing px per CSS px. */
  scale = 1;
  private res = 1;
  /** Logical half-size of the arena box (fits the arena on show), and the room the box may fill (CSS px). */
  private hw = 520;
  private hh = 350;
  private avail = { cx: 0, cy: 0, w: 1, h: 1 };
  private arenaId = "";
  private boxW = 1;
  private boxH = 1;
  private floorKey = "";
  private ghostAt = -1e9;
  private bodies = new Map<string, HTMLCanvasElement>();
  private sprites: Record<string, HTMLCanvasElement> = {};
  private labels = new Map<string, { key: string; c: HTMLCanvasElement }>();
  private fxs: Fx[] = [];
  private kickAt = -1e9;
  private items: Item[] = [];

  constructor(stage: HTMLElement) {
    this.bg.className = "blt-void";
    stage.appendChild(this.bg);
    this.el = document.createElement("div");
    this.el.className = "blt-box";
    this.ghost.className = "blt-ghost";
    this.el.append(this.ghost, this.floor, this.fx);
    stage.appendChild(this.el);
    this.fctx = this.fx.getContext("2d")!;
  }

  /** The void fills the stage; the arena box fits (w × h) CSS px, centred on (cx, cy). */
  layout(stageW: number, stageH: number, cx: number, cy: number, w: number, h: number) {
    const dpr = window.devicePixelRatio || 1;
    this.res = isWebOS ? Math.min(dpr, 1920 / Math.max(1, stageW)) : dpr;
    this.avail = { cx, cy, w, h };
    this.bg.width = Math.round(stageW * this.res);
    this.bg.height = Math.round(stageH * this.res);
    this.bakeVoid(stageW, stageH);
    this.refit();
  }

  /** Fit the box to the arena on show: the biggest scale that keeps the whole platform in the room. */
  private refit(poly: Pt[] = this.polyShown) {
    this.polyShown = poly;
    let mx = 0;
    let my = 0;
    for (const [x, y] of poly) {
      mx = Math.max(mx, Math.abs(x));
      my = Math.max(my, Math.abs(y));
    }
    this.hw = mx + MARGIN;
    this.hh = my + MARGIN;
    const { cx, cy, w, h } = this.avail;
    this.scale = Math.min(w / (this.hw * 2), h / (this.hh * 2), MAX_SCALE);
    this.boxW = Math.round(this.hw * 2 * this.scale);
    this.boxH = Math.round(this.hh * 2 * this.scale);
    Object.assign(this.el.style, {
      left: `${Math.round(cx - this.boxW / 2)}px`,
      top: `${Math.round(cy - this.boxH / 2)}px`,
      width: `${this.boxW}px`,
      height: `${this.boxH}px`,
    });
    for (const c of [this.ghost, this.floor, this.fx]) {
      c.width = Math.round(this.boxW * this.res);
      c.height = Math.round(this.boxH * this.res);
    }
    this.bakeSprites();
    this.labels.clear();
    this.floorKey = "";
    this.ghost.style.opacity = "0";
  }
  private polyShown: Pt[] = [[-470, -135], [470, 135]];

  /** Fonts arrived: name tags are baked again with the right face. */
  fontsReady() {
    this.labels.clear();
  }

  /** Logical → backing px, origin at the arena's middle. */
  private toLogical(ctx: CanvasRenderingContext2D) {
    const k = this.scale * this.res;
    ctx.setTransform(k, 0, 0, k, this.hw * k, this.hh * k);
  }

  clear() {
    this.fxs.length = 0;
    this.ghost.style.opacity = "0";
    this.ghostAt = -1e9;
    this.floorKey = "";
  }

  // ------------------------------------------------------------------ baked art

  private bakeVoid(w: number, h: number) {
    const ctx = this.bg.getContext("2d")!;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.fillStyle = LOOK.void;
    ctx.fillRect(0, 0, w, h);
    // a faint diagonal weave, like the paper lining of a toy box
    ctx.strokeStyle = LOOK.voidLine;
    ctx.lineWidth = Math.max(2, h * 0.012);
    ctx.beginPath();
    const step = Math.max(34, h * 0.05);
    for (let x = -h; x < w + h; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
    }
    ctx.stroke();
  }

  private bakeSprites() {
    const k = this.scale * this.res;
    this.bodies.clear();
    const mk = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const c = canvas(w * k, h * k);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(k, 0, 0, k, 0, 0);
      draw(ctx);
      return c;
    };
    // the soft oval shadow (one radial gradient, baked)
    this.sprites.shadow = mk(64, 32, (c) => {
      c.translate(32, 16);
      c.scale(1, 0.4);
      const g = c.createRadialGradient(0, 0, 2, 0, 0, 30);
      g.addColorStop(0, "rgba(10,20,12,0.5)");
      g.addColorStop(0.65, "rgba(10,20,12,0.32)");
      g.addColorStop(1, "rgba(10,20,12,0)");
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, 30, 0, Math.PI * 2);
      c.fill();
    });
    // bombs: a black sphere with a fuse stub, a hot one for the last moments, and the variants
    const bomb = (kind: BombKind, hot: boolean) =>
      mk(48, 56, (c) => {
        c.translate(24, 32);
        const r = BR + 1.5;
        const body = hot ? "#c8441a" : "#2a2623";
        c.lineWidth = 3;
        c.strokeStyle = LOOK.ink;
        c.fillStyle = body;
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.fill();
        c.save();
        c.clip();
        c.fillStyle = hot ? "#e0642a" : "#3b3733";
        c.beginPath();
        c.arc(-2.5, -3, r * 0.78, 0, Math.PI * 2);
        c.fill();
        if (kind === "sticky") {
          c.fillStyle = "#8fd14f";
          c.beginPath();
          c.moveTo(-r, -2);
          for (let i = 0; i <= 6; i++) c.lineTo(-r + (i * 2 * r) / 6, i % 2 ? 4 : -1 - (i % 3));
          c.lineTo(r, -r);
          c.lineTo(-r, -r);
          c.fill();
        }
        if (kind === "big") {
          c.fillStyle = LOOK.fuse;
          c.fillRect(-r, -1.5, r * 2, 3.5);
        }
        c.restore();
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = "rgba(246,239,226,0.55)";
        c.beginPath();
        c.ellipse(-4.5, -5, 3.2, 2.2, -0.7, 0, Math.PI * 2);
        c.fill();
        // the fuse stub
        c.strokeStyle = LOOK.ink;
        c.lineWidth = 3;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(3, -r + 1);
        c.quadraticCurveTo(7, -r - 5, 11, -r - 6);
        c.stroke();
      });
    for (const kind of ["normal", "big", "sticky"] as const) {
      this.sprites[`bomb-${kind}`] = bomb(kind, false);
      this.sprites[`bomb-${kind}-hot`] = bomb(kind, true);
    }
    // crates and soap bars: a top face and a front wall, seen from a slight tilt
    const box = (w: number, h: number, top: string, front: string, plank: boolean, soap: boolean) =>
      mk(w + 12, h + 28, (c) => {
        c.translate(6, 6);
        c.lineJoin = "round";
        c.lineWidth = 3;
        c.strokeStyle = LOOK.ink;
        const rr = soap ? 12 : 5;
        const path = (y: number, hh: number) => {
          c.beginPath();
          c.roundRect(0, y, w, hh, rr);
        };
        path(10, h + 4);
        c.fillStyle = front;
        c.fill();
        c.stroke();
        path(0, h);
        c.fillStyle = top;
        c.fill();
        c.stroke();
        if (plank) {
          c.save();
          c.clip();
          c.strokeStyle = shade(LOOK.woodSide, 0.9);
          c.lineWidth = 3;
          c.beginPath();
          c.moveTo(5, 5);
          c.lineTo(w - 5, h - 5);
          c.moveTo(w - 5, 5);
          c.lineTo(5, h - 5);
          c.stroke();
          c.restore();
          c.lineWidth = 3;
          c.strokeStyle = LOOK.ink;
          path(0, h);
          c.stroke();
        }
        if (soap) {
          c.fillStyle = "rgba(255,255,255,0.7)";
          c.beginPath();
          c.ellipse(w * 0.3, h * 0.28, w * 0.14, h * 0.07, -0.4, 0, Math.PI * 2);
          c.fill();
          c.fillStyle = "rgba(255,255,255,0.55)";
          for (const [bx, by, br] of [[0.7, 0.62, 4], [0.58, 0.74, 2.6]] as const) {
            c.beginPath();
            c.arc(w * bx, h * by, br, 0, Math.PI * 2);
            c.fill();
          }
        }
      });
    this.sprites.crate = box(44, 44, "#e9c389", "#c89a5c", true, false);
    this.sprites.crate60 = box(60, 60, "#e9c389", "#c89a5c", true, false);
    this.sprites.soap = box(54, 54, "#f6c0d0", "#e196ae", false, true);
    // power-up tokens: a paper disc with a small picture in the power-up's colour
    const token = (kind: PowerKind) =>
      mk(40, 44, (c) => {
        c.translate(20, 22);
        c.lineWidth = 3;
        c.strokeStyle = LOOK.ink;
        c.fillStyle = LOOK.paper;
        c.beginPath();
        c.arc(0, 0, 15, 0, Math.PI * 2);
        c.fill();
        c.stroke();
        c.lineWidth = 2.5;
        const dot = (x: number, y: number, r: number, fill: string = LOOK.ink) => {
          c.fillStyle = fill;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
        };
        if (kind === "big") dot(0, 1, 9.5);
        else if (kind === "triple") for (const [x, y] of [[-6, 4], [6, 4], [0, -5]] as const) dot(x, y, 5);
        else if (kind === "sticky") {
          dot(0, 1, 8.5);
          dot(0, -4, 5.5, "#7fc23f");
          dot(4.5, 5, 2.5, "#7fc23f");
        } else if (kind === "speed") {
          c.fillStyle = "#2f7fd8";
          c.beginPath();
          c.moveTo(3, -10);
          c.lineTo(-7, 2);
          c.lineTo(-1, 2);
          c.lineTo(-3, 11);
          c.lineTo(7, -2);
          c.lineTo(1, -2);
          c.closePath();
          c.fill();
        } else {
          c.fillStyle = "#2db5ae";
          c.beginPath();
          c.moveTo(0, -10);
          c.lineTo(9, -6);
          c.quadraticCurveTo(9, 5, 0, 11);
          c.quadraticCurveTo(-9, 5, -9, -6);
          c.closePath();
          c.fill();
          c.strokeStyle = LOOK.ink;
          c.lineWidth = 2;
          c.stroke();
        }
      });
    for (const p of ["big", "triple", "sticky", "speed", "shield"] as const) this.sprites[`pw-${p}`] = token(p);
  }

  private body(color: string): HTMLCanvasElement {
    let c = this.bodies.get(color);
    if (c) return c;
    const k = this.scale * this.res;
    c = canvas(64 * k, 72 * k);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.translate(32, 38);
    const rx = PR + 1;
    const ry = PR + 5;
    // little feet
    ctx.fillStyle = LOOK.ink;
    for (const fx of [-9, 9]) {
      ctx.beginPath();
      ctx.ellipse(fx, ry - 2, 7, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = LOOK.ink;
    ctx.fillStyle = shade(color, 0.72);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    // the cel shade: the body again, shifted up and left, leaves one crescent on the lower right
    ctx.save();
    ctx.clip();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(-5, -4, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.beginPath();
    ctx.ellipse(-9, -15, 5, 3, -0.6, 0, Math.PI * 2);
    ctx.fill();
    this.bodies.set(color, c);
    return c;
  }

  private label(name: string, color: string): HTMLCanvasElement {
    const key = `${name}|${color}`;
    const had = this.labels.get(name);
    if (had && had.key === key) return had.c;
    const px = 24;
    const r = this.res;
    const m = canvas(10, 10).getContext("2d")!;
    m.font = `700 ${px}px ${SANS}`;
    const w = Math.ceil(Math.min(210, m.measureText(name).width) + px * 1.5);
    const h = Math.ceil(px * 1.5);
    const c = canvas(w * r, h * r);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    ctx.fillStyle = "rgba(29,26,23,0.78)";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(h * 0.5, h / 2, px * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 ${px}px ${SANS}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = LOOK.paper;
    let text = name;
    while (text.length > 1 && ctx.measureText(text).width > 210) text = text.slice(0, -1);
    ctx.fillText(text === name ? text : `${text}…`, h * 0.9, h / 2 + 1);
    this.labels.set(name, { key, c });
    return c;
  }

  /** The platform, at its current size (the arena's shape scaled round the middle). */
  private bakeFloor(game: Blast) {
    const a = game.arena;
    const fs = game.floorScale;
    const ctx = this.floor.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.floor.width, this.floor.height);
    if (fs < 0.01) return;
    this.toLogical(ctx);
    const path = (poly: Pt[], dy = 0) => {
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * fs, y * fs + dy) : ctx.moveTo(x * fs, y * fs + dy)));
      ctx.closePath();
    };
    // the side wall: the shape stacked downward
    ctx.lineJoin = "round";
    ctx.fillStyle = LOOK.woodSide;
    for (let dy = WALL; dy >= 2; dy -= 2) {
      path(a.poly, dy);
      ctx.fill();
    }
    path(a.poly, WALL);
    ctx.lineWidth = 3;
    ctx.strokeStyle = LOOK.ink;
    ctx.stroke();
    // the bottom edge of the wall, a darker band
    ctx.fillStyle = LOOK.woodDeep;
    path(a.poly, WALL);
    ctx.save();
    ctx.clip();
    ctx.fillRect(-this.hw, WALL - 5, this.hw * 2, this.hh);
    ctx.restore();
    // the top: wood rim, felt inside
    path(a.poly);
    ctx.fillStyle = LOOK.wood;
    ctx.fill();
    ctx.save();
    path(a.poly);
    ctx.clip();
    ctx.fillStyle = LOOK.felt;
    ctx.fill();
    // felt grain: seeded specks
    const rnd = lcg(a.id.length * 7919 + 13);
    for (let i = 0; i < 420; i++) {
      const x = (rnd() * 2 - 1) * (this.hw - MARGIN) * fs;
      const y = (rnd() * 2 - 1) * (this.hh - MARGIN) * fs;
      ctx.fillStyle = rnd() < 0.5 ? LOOK.feltLight : LOOK.feltDark;
      ctx.fillRect(x, y, 3 + rnd() * 4, 2 + rnd() * 3);
    }
    this.decorate(ctx, a.id, fs, rnd);
    ctx.lineWidth = 22;
    ctx.strokeStyle = LOOK.wood;
    path(a.poly);
    ctx.stroke();
    ctx.restore();
    // the holes: a dark drop with the far wall showing
    ctx.save();
    path(a.poly);
    ctx.clip();
    for (const hole of a.holes) {
      path(hole);
      ctx.fillStyle = LOOK.woodDeep;
      ctx.fill();
      ctx.save();
      path(hole);
      ctx.clip();
      path(hole, 18);
      ctx.fillStyle = LOOK.void;
      ctx.fill();
      ctx.restore();
      path(hole);
      ctx.lineWidth = 7;
      ctx.strokeStyle = LOOK.wood;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = LOOK.ink;
      ctx.stroke();
    }
    ctx.restore();
    path(a.poly);
    ctx.lineWidth = 3;
    ctx.strokeStyle = LOOK.ink;
    ctx.stroke();
  }

  /** Each arena's own pattern on the felt, drawn clipped inside the platform. */
  private decorate(ctx: CanvasRenderingContext2D, id: string, fs: number, rnd: () => number) {
    ctx.save();
    ctx.scale(fs, fs);
    if (id === "blanket") {
      ctx.fillStyle = "rgba(246,239,226,0.1)";
      for (let i = -300; i < 300; i += 80) {
        ctx.fillRect(i, -300, 40, 600);
        ctx.fillRect(-300, i, 600, 40);
      }
    } else if (id === "shelf") {
      ctx.strokeStyle = "rgba(246,239,226,0.16)";
      ctx.lineWidth = 3;
      ctx.setLineDash([22, 18]);
      ctx.beginPath();
      ctx.moveTo(-470, 0);
      ctx.lineTo(470, 0);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      ctx.strokeStyle = "rgba(246,239,226,0.2)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 14; i++) {
        ctx.beginPath();
        ctx.arc((rnd() * 2 - 1) * 400, (rnd() * 2 - 1) * 240, 5 + rnd() * 12, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ events

  /** A game event worth a picture. */
  event(e: BlastEvent, now: number) {
    switch (e.type) {
      case "blast": {
        const bits: Debris[] = [];
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.random() * 0.8;
          const sp = 140 + Math.random() * 160;
          bits.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.8 - 40, s: 7 + Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 12, color: i % 3 === 0 ? LOOK.fuse : i % 3 === 1 ? LOOK.ink : LOOK.paper });
        }
        this.fxs.push({ type: "blast", t0: now, x: e.x, y: e.y, r: e.r, big: e.big, bits });
        this.kickAt = now;
        break;
      }
      case "crate": {
        const bits: Debris[] = [];
        for (let i = 0; i < 5; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = 60 + Math.random() * 120;
          bits.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30, s: 6 + Math.random() * 5, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 10, color: e.kind === "soap" ? "#f6c0d0" : i % 2 ? LOOK.wood : LOOK.woodSide });
        }
        this.fxs.push({ type: "debris", t0: now, x: e.x, y: e.y, r: 0, bits });
        break;
      }
      case "shield":
        this.fxs.push({ type: "ring", t0: now, x: e.x, y: e.y, r: 60, color: "#7fe3ee" });
        break;
      case "pickup":
        this.fxs.push({ type: "ring", t0: now, x: e.x, y: e.y, r: 44, color: LOOK.paper });
        break;
      case "land":
        this.fxs.push({ type: "ring", t0: now, x: e.x, y: e.y + 10, r: 30, color: LOOK.paper });
        break;
      case "crumble":
        // the baked floor changes at the next frame; the old one fades out
        this.ghostAt = now;
        this.ghostFrom = true;
        break;
      default:
        break;
    }
  }
  private ghostFrom = false;

  // ------------------------------------------------------------------ the frame

  frame(game: Blast, alpha: number, now: number) {
    if (game.arena.id !== this.arenaId) {
      this.arenaId = game.arena.id;
      this.refit(game.arena.poly);
    }
    // the platform: baked again when it changes size or the arena changes
    const key = `${game.arena.id}:${game.floorScale.toFixed(3)}`;
    if (key !== this.floorKey) {
      const crumbled = this.ghostFrom && this.floorKey.startsWith(`${game.arena.id}:`);
      if (crumbled) {
        const g = this.ghost.getContext("2d")!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, this.ghost.width, this.ghost.height);
        g.drawImage(this.floor, 0, 0);
      } else {
        this.ghostAt = -1e9;
      }
      this.ghostFrom = false;
      this.floorKey = key;
      this.bakeFloor(game);
    }
    const gt = (now - this.ghostAt) / GHOST_MS;
    if (gt >= 0 && gt < 1) {
      this.ghost.style.opacity = String(1 - gt);
      this.ghost.style.transform = `translateY(${Math.round(gt * gt * 40 * this.scale)}px)`;
    } else if (this.ghost.style.opacity !== "0") this.ghost.style.opacity = "0";

    // the 4 px kick of a blast
    const kt = (now - this.kickAt) / KICK_MS;
    if (kt >= 0 && kt < 1) {
      const m = (1 - kt) * 4;
      this.el.style.transform = `translate(${Math.round(Math.sin(now * 0.12) * m)}px, ${Math.round(Math.cos(now * 0.15) * m)}px)`;
    } else if (this.el.style.transform) this.el.style.transform = "";

    const ctx = this.fctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    this.toLogical(ctx);
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // the next crumble: its edge, blinking orange
    if (game.phase === "play" && game.crumbleIn() < 90 && game.nextScale() > 0 && Math.floor(now / 160) % 2 === 0) {
      const ns = game.nextScale();
      ctx.strokeStyle = LOOK.fuse;
      ctx.lineWidth = 5;
      ctx.setLineDash([16, 12]);
      ctx.beginPath();
      game.arena.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x * ns, y * ns) : ctx.moveTo(x * ns, y * ns)));
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // shadows
    const sh = this.sprites.shadow!;
    for (const s of game.seats.values()) {
      if (!s.inRound) continue;
      if (!s.alive && s.outT > 40) continue;
      const lift = s.alive ? Math.sin(Math.min(1, (JUMP_STEPS - s.jumpT) / JUMP_STEPS) * Math.PI) * (s.jumpT > 0 ? 1 : 0) : 0;
      const sc = (1 - lift * 0.25) * (s.alive ? 1 : Math.max(0, 1 - s.outT / 40));
      ctx.globalAlpha = s.alive ? 1 - lift * 0.4 : sc;
      ctx.drawImage(sh, lerp(s.px, s.x) - 32 * sc, lerp(s.py, s.y) + 8 - 16 * sc, 64 * sc, 32 * sc);
    }
    for (const b of game.bombs) {
      if (b.stuck || b.falling) continue;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(sh, lerp(b.px, b.x) - 16, lerp(b.py, b.y) + 5 - 8, 32, 16);
    }
    for (const c of game.crates) {
      ctx.globalAlpha = 1;
      ctx.drawImage(sh, c.x - c.w * 0.7, c.y + c.h * 0.5 - 14, c.w * 1.4, c.w * 0.7);
    }
    ctx.globalAlpha = 1;

    // everything standing, back to front
    const items = this.items;
    items.length = 0;
    for (const c of game.crates) items.push({ y: c.y + c.h / 2, kind: 0, ref: c });
    for (const p of game.pickups) items.push({ y: p.y, kind: 1, ref: p });
    for (const b of game.bombs) items.push({ y: b.stuck ? 1e5 : lerp(b.py, b.y), kind: 2, ref: b });
    for (const s of game.seats.values()) if (s.inRound && (s.alive || s.outT < 46)) items.push({ y: lerp(s.py, s.y), kind: 3, ref: s });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) {
      if (it.kind === 0) {
        const c = it.ref as { x: number; y: number; w: number; h: number; kind: "crate" | "soap" };
        const spr = c.kind === "soap" ? this.sprites.soap! : c.w > 50 ? this.sprites.crate60! : this.sprites.crate!;
        ctx.drawImage(spr, c.x - c.w / 2 - 6, c.y - c.h / 2 - 12, c.w + 12, c.h + 28);
      } else if (it.kind === 1) {
        const p = it.ref as { x: number; y: number; kind: PowerKind; age: number };
        const bob = Math.sin(now / 260 + p.x) * 3;
        if (p.age > 8 * 60 && Math.floor(now / 140) % 2 === 0) continue; // about to vanish: blinks
        ctx.drawImage(this.sprites[`pw-${p.kind}`]!, p.x - 20, p.y - 30 + bob, 40, 44);
      } else if (it.kind === 2) {
        this.drawBomb(ctx, it.ref as Bomb, lerp, now, game);
      } else {
        this.drawFighter(ctx, it.ref as Seat, lerp, now);
      }
    }

    // blasts and debris
    let w = 0;
    for (let i = 0; i < this.fxs.length; i++) {
      const f = this.fxs[i]!;
      const t = now - f.t0;
      const life = f.type === "blast" ? DEBRIS_MS : f.type === "debris" ? DEBRIS_MS : 380;
      if (t > life) continue;
      this.fxs[w++] = f;
      if (f.type === "blast") {
        const k = Math.min(1, t / BLAST_MS);
        if (k < 1) {
          const e = 1 - (1 - k) * (1 - k);
          if (k < 0.25) {
            ctx.globalAlpha = 0.7 * (1 - k / 0.25);
            ctx.fillStyle = LOOK.paper;
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r * (0.3 + 0.5 * e), 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.globalAlpha = 1 - k * k;
          ctx.lineWidth = 14 * (1 - k) + 3;
          ctx.strokeStyle = k < 0.5 ? LOOK.fuse : LOOK.paper;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r * (0.25 + 0.8 * e), 0, Math.PI * 2);
          ctx.stroke();
        }
        this.drawBits(ctx, f, t);
      } else if (f.type === "debris") {
        this.drawBits(ctx, f, t);
      } else {
        const k = t / 380;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.strokeStyle = f.color ?? LOOK.paper;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * k), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    this.fxs.length = w;
    ctx.globalAlpha = 1;

    // name tags, in screen px (they stay the same size whatever the arena)
    const r = this.res;
    ctx.setTransform(r, 0, 0, r, 0, 0);
    const sc = this.scale;
    for (const s of game.seats.values()) {
      if (!s.inRound || !s.alive) continue;
      const lab = this.label(s.name, inkOf(s));
      const lift = s.jumpT > 0 ? Math.sin(Math.min(1, (JUMP_STEPS - s.jumpT) / JUMP_STEPS) * Math.PI) * 30 : 0;
      const sx = (lerp(s.px, s.x) + this.hw) * sc;
      const sy = (lerp(s.py, s.y) - PR - 30 - lift + this.hh) * sc;
      const lw = lab.width / r;
      const lh = lab.height / r;
      ctx.drawImage(lab, Math.round(sx - lw / 2), Math.round(sy - lh), lw, lh);
    }
  }

  private drawBits(ctx: CanvasRenderingContext2D, f: Fx, t: number) {
    const k = t / DEBRIS_MS;
    const sec = t / 1000;
    ctx.globalAlpha = Math.max(0, 1 - k * k);
    for (const d of f.bits ?? []) {
      const x = d.x + d.vx * sec * (1 - k * 0.4);
      const y = d.y + d.vy * sec + 260 * sec * sec;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(d.rot + d.vr * sec);
      ctx.fillStyle = d.color;
      ctx.strokeStyle = LOOK.ink;
      ctx.lineWidth = 2;
      ctx.fillRect(-d.s / 2, -d.s / 2, d.s, d.s);
      ctx.strokeRect(-d.s / 2, -d.s / 2, d.s, d.s);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  private drawBomb(ctx: CanvasRenderingContext2D, b: Bomb, lerp: (a: number, c: number) => number, now: number, game: Blast) {
    let x = lerp(b.px, b.x);
    let y = lerp(b.py, b.y);
    let sc = b.kind === "big" ? 1.5 : 1;
    if (b.falling) sc *= Math.max(0, 1 - b.falling / 26);
    if (sc <= 0.02) return;
    let lift = 6;
    if (b.stuck) {
      const h = game.seats.get(b.stuck);
      if (h) {
        x = lerp(h.px, h.x) + 14;
        y = lerp(h.py, h.y) - 16;
        lift = 0;
      }
    }
    const left = Math.max(0, b.fuse);
    // the last 40 steps: the body flashes hot, faster and faster
    const hot = left < 42 && Math.floor(left / Math.max(2.5, left / 5)) % 2 === 0;
    const spr = this.sprites[`bomb-${b.kind}${hot ? "-hot" : ""}`]!;
    ctx.drawImage(spr, x - 24 * sc, y - 32 * sc - lift, 48 * sc, 56 * sc);
    if (b.falling) return;
    // the fuse spark: it flickers faster as the fuse burns down
    const rate = 0.012 + (1 - left / 120) * 0.05;
    const flick = 0.5 + 0.5 * Math.sin(now * rate * 6);
    const tipx = x + 11 * sc;
    const tipy = y - (BR + 7.5) * sc - lift;
    ctx.fillStyle = LOOK.fuse;
    ctx.beginPath();
    ctx.arc(tipx, tipy, (3.2 + flick * 2.6) * sc, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LOOK.paper;
    ctx.beginPath();
    ctx.arc(tipx, tipy, (1.2 + flick * 1.2) * sc, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawFighter(ctx: CanvasRenderingContext2D, s: Seat, lerp: (a: number, c: number) => number, now: number) {
    const color = inkOf(s);
    const x = lerp(s.px, s.x);
    let y = lerp(s.py, s.y);
    let sc = 1;
    let fade = 1;
    let lift = 0;
    if (!s.alive) {
      sc = Math.max(0, 1 - s.outT / 44);
      fade = sc;
      y += s.outT * 0.5;
      if (sc <= 0.02) return;
    } else if (s.jumpT > 0) {
      lift = Math.sin(((JUMP_STEPS - s.jumpT) / JUMP_STEPS) * Math.PI) * 30;
    }
    // a small squash as it lands, a stretch as it leaves the ground
    const cy = y - 6 - lift;
    ctx.globalAlpha = fade;
    const f = s.face;
    const cs = Math.cos(f);
    const sn = Math.sin(f);
    const punching = s.punchT < 10;
    const reach = punching ? 18 + Math.sin((s.punchT / 10) * Math.PI) * 18 : 19;
    const fist = () => {
      const fx = x + cs * reach * sc;
      const fy = cy + sn * reach * 0.8 * sc + 2;
      ctx.fillStyle = color;
      ctx.strokeStyle = LOOK.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(fx, fy, (punching ? 8.5 : 7) * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };
    if (sn < -0.35) fist();
    ctx.drawImage(this.body(color), x - 32 * sc, cy - 38 * sc, 64 * sc, 72 * sc);
    if (s.shield && s.alive) {
      ctx.globalAlpha = 0.7 + 0.2 * Math.sin(now / 120);
      ctx.strokeStyle = "#7fe3ee";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(x, cy, PR + 8, PR + 12, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = fade;
    }
    if (sn >= -0.6) {
      // eyes, looking the way it faces
      for (const side of [-1, 1]) {
        const ex = x + cs * 8 - sn * 6.5 * side;
        const ey = cy - 4 + sn * 5 + cs * 5.5 * side;
        ctx.fillStyle = LOOK.paper;
        ctx.strokeStyle = LOOK.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(ex, ey, 5, 6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = LOOK.ink;
        ctx.beginPath();
        ctx.arc(ex + cs * 2, ey + sn * 2.2, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (sn >= -0.35) fist();
    ctx.globalAlpha = 1;
  }
}
