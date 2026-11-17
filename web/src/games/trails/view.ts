// The arena on the TV: three stacked canvases.
//  - bg: graphite, the faint dot grid and the edge, baked once per size.
//  - trails: persistent. Each frame only the new bits of each trail are appended; it is redrawn in full only when a
//    line crashes (its trail fades to 30 %), on a new round, or on a resize.
//  - fx: cleared every frame; the heads with their glow, the 3-2-1 arrows and the crash bursts.
import { isWebOS } from "../../shell/tv.ts";
import { INKS, LOOK, SANS } from "./look.ts";
import { ARENA_H, ARENA_W, LINE_W, type Seat, type Trails } from "./rules.ts";

const GRID_STEP = 32;
const BURST_MS = 560;
const FADED = 0.3;

interface Burst {
  x: number;
  y: number;
  a: number;
  ink: string;
  t0: number;
}

export class ArenaView {
  readonly el: HTMLElement;
  private bg = document.createElement("canvas");
  private trails = document.createElement("canvas");
  private fx = document.createElement("canvas");
  private tctx: CanvasRenderingContext2D;
  private fctx: CanvasRenderingContext2D;
  /** CSS px per logical px, and backing px per CSS px. */
  scale = 1;
  private res = 1;
  /** How many numbers of each line's path are already on the trails canvas. */
  private drawn = new Map<string, number[]>();
  private bursts: Burst[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "trl-arena";
    for (const c of [this.bg, this.trails, this.fx]) this.el.appendChild(c);
    parent.appendChild(this.el);
    this.tctx = this.trails.getContext("2d")!;
    this.fctx = this.fx.getContext("2d")!;
  }

  /** Fit the arena into a box (CSS px, relative to the parent). */
  layout(left: number, top: number, width: number, height: number, game: Trails) {
    this.scale = Math.min(width / ARENA_W, height / ARENA_H);
    const w = Math.round(ARENA_W * this.scale);
    const h = Math.round(ARENA_H * this.scale);
    Object.assign(this.el.style, {
      left: `${Math.round(left + (width - w) / 2)}px`,
      top: `${Math.round(top + (height - h) / 2)}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    const dpr = window.devicePixelRatio || 1;
    // the TV: never more than a 1920-wide backing store in all
    this.res = isWebOS ? Math.min(dpr, 1920 / Math.max(1, window.innerWidth)) : dpr;
    for (const c of [this.bg, this.trails, this.fx]) {
      c.width = Math.round(w * this.res);
      c.height = Math.round(h * this.res);
    }
    this.bake();
    this.redraw(game);
  }

  private toLogical(ctx: CanvasRenderingContext2D) {
    const k = this.scale * this.res;
    ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  private bake() {
    const ctx = this.bg.getContext("2d")!;
    this.toLogical(ctx);
    ctx.fillStyle = LOOK.graphite;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
    ctx.fillStyle = LOOK.grid;
    const r = 1.6 / this.scale;
    for (let y = GRID_STEP / 2; y < ARENA_H; y += GRID_STEP) {
      for (let x = GRID_STEP / 2; x < ARENA_W; x += GRID_STEP) ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // the edge: a thin white line, a little dimmed
    ctx.strokeStyle = LOOK.white;
    ctx.globalAlpha = 0.26;
    ctx.lineWidth = 2 / this.scale;
    ctx.strokeRect(1 / this.scale, 1 / this.scale, ARENA_W - 2 / this.scale, ARENA_H - 2 / this.scale);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ trails

  /** Append whatever each trail gained since the last call. */
  sync(game: Trails) {
    const ctx = this.tctx;
    this.toLogical(ctx);
    ctx.lineWidth = LINE_W;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = 1;
    for (const s of game.seats.values()) {
      if (!s.inRound) continue;
      const p = s.path;
      let mark = this.drawn.get(s.id);
      if (!mark || mark[1] !== game.round) {
        mark = [0, game.round];
        this.drawn.set(s.id, mark);
      }
      let from = mark[0]!;
      if (p.length <= from) continue;
      ctx.strokeStyle = INKS[s.slot]!;
      ctx.beginPath();
      // start from the last point already drawn, so the new bit joins on
      let pen = false;
      if (from >= 2 && !Number.isNaN(p[from - 2]!)) {
        ctx.moveTo(p[from - 2]!, p[from - 1]!);
        pen = true;
      } else if (from === 0) {
        ctx.moveTo(p[0]!, p[1]!);
        pen = true;
        from = 2;
      }
      for (let i = from; i < p.length; i += 2) {
        const x = p[i]!;
        if (Number.isNaN(x)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x, p[i + 1]!);
        else ctx.moveTo(x, p[i + 1]!);
        pen = true;
      }
      ctx.stroke();
      mark[0] = p.length;
    }
  }

  /** Draw every trail again from scratch: a crashed line's trail at 30 %. */
  redraw(game: Trails) {
    const ctx = this.tctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.trails.width, this.trails.height);
    this.toLogical(ctx);
    ctx.lineWidth = LINE_W;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const stroke = (path: number[], ink: string, alpha: number) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < path.length; i += 2) {
        const x = path[i]!;
        if (Number.isNaN(x)) {
          pen = false;
          continue;
        }
        if (pen) ctx.lineTo(x, path[i + 1]!);
        else ctx.moveTo(x, path[i + 1]!);
        pen = true;
      }
      // a lone point still shows as a dot
      if (path.length === 2) ctx.lineTo(path[0]! + 0.01, path[1]!);
      ctx.stroke();
    };
    for (const g of game.ghosts) stroke(g.path, INKS[g.slot]!, FADED);
    for (const s of game.seats.values()) {
      if (!s.inRound) continue;
      stroke(s.path, INKS[s.slot]!, s.out ? FADED : 1);
      this.drawn.set(s.id, [s.path.length, game.round]);
    }
    ctx.globalAlpha = 1;
  }

  /** A new round: a clean sheet. */
  clear() {
    const ctx = this.tctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.trails.width, this.trails.height);
    this.drawn.clear();
    this.bursts = [];
  }

  burst(x: number, y: number, a: number, slot: number) {
    this.bursts.push({ x, y, a, ink: INKS[slot]!, t0: performance.now() });
  }

  // ------------------------------------------------------------------ every frame

  /** Heads, arrows and bursts. `alpha` is how far we are between the last step and the next (0–1). */
  frame(game: Trails, alpha: number, now: number) {
    const ctx = this.fctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    this.toLogical(ctx);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (game.phase === "count") {
      for (const s of game.players()) this.arrow(ctx, s, game.t);
    } else if (game.phase === "play" || game.phase === "round") {
      for (const s of game.players()) if (s.alive || (game.phase === "round" && !s.out)) this.head(ctx, s, game.phase === "play" ? alpha : 1);
    }
    this.drawBursts(ctx, now);
  }

  /** The head: a short wide low-alpha under-stroke along the last bit of trail, then a bright dot. */
  private head(ctx: CanvasRenderingContext2D, s: Seat, alpha: number) {
    const hx = s.px + (s.x - s.px) * alpha;
    const hy = s.py + (s.y - s.py) * alpha;
    const ink = INKS[s.slot]!;
    const p = s.path;
    ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    let len = 0;
    let lx = hx;
    let ly = hy;
    for (let i = p.length - 2; i >= 0 && len < 46; i -= 2) {
      const x = p[i]!;
      if (Number.isNaN(x)) break;
      len += Math.hypot(x - lx, p[i + 1]! - ly);
      lx = x;
      ly = p[i + 1]!;
      ctx.lineTo(lx, ly);
    }
    ctx.globalAlpha = 0.13;
    ctx.lineWidth = 22;
    ctx.stroke();
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 11;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = LOOK.white;
    ctx.beginPath();
    ctx.arc(hx, hy, 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Before the start: each line as a dot, an arrow for its heading, and its name. */
  private arrow(ctx: CanvasRenderingContext2D, s: Seat, t: number) {
    const ink = INKS[s.slot]!;
    const c = Math.cos(s.a);
    const sn = Math.sin(s.a);
    // the arrow slides out once, at the start of the count
    const out = Math.min(1, t / 24);
    const e = 1 - (1 - out) * (1 - out);
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
    ctx.fill();
    // a dashed lead-in and a chevron
    const d0 = 14;
    const d1 = 16 + 40 * e;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let d = d0; d < d1 - 8; d += 9) {
      ctx.moveTo(s.x + c * d, s.y + sn * d);
      ctx.lineTo(s.x + c * Math.min(d + 4, d1 - 8), s.y + sn * Math.min(d + 4, d1 - 8));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    const tipX = s.x + c * (d1 + 4);
    const tipY = s.y + sn * (d1 + 4);
    const w = 12;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(tipX - c * w - sn * w, tipY - sn * w + c * w);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(tipX - c * w + sn * w, tipY - sn * w - c * w);
    ctx.stroke();
    // the name, on the side away from the arrow
    const px = 28 / this.scale;
    ctx.font = `600 ${px}px ${SANS}`;
    ctx.textAlign = c > 0.3 ? "right" : c < -0.3 ? "left" : "center";
    ctx.textBaseline = sn > 0.3 ? "bottom" : sn < -0.3 ? "top" : "middle";
    const off = 28;
    ctx.fillStyle = ink;
    ctx.fillText(s.name, s.x - c * off, s.y - sn * off);
  }

  private drawBursts(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.bursts.length) return;
    this.bursts = this.bursts.filter((b) => now - b.t0 < BURST_MS);
    ctx.lineWidth = 3;
    for (const b of this.bursts) {
      const k = (now - b.t0) / BURST_MS;
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      const r0 = 7 + 30 * e;
      const r1 = r0 + 16 * (1 - e) + 3;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = b.ink;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = b.a + (i * Math.PI) / 4 + Math.PI / 8;
        ctx.moveTo(b.x + Math.cos(a) * r0, b.y + Math.sin(a) * r0);
        ctx.lineTo(b.x + Math.cos(a) * r1, b.y + Math.sin(a) * r1);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** Logical arena point → CSS px inside the arena element. */
  toScreen(x: number, y: number) {
    return { x: x * this.scale, y: y * this.scale };
  }
}
