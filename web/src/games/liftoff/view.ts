// The tunnel on the TV. Two canvases:
//  - sky: the whole screen behind everything, baked once per size (night navy, a few stars, the poster frame).
//  - tunnel: the column in the middle, redrawn each frame from baked parts: a star tile (slow parallax), the walls
//    with their seams, the height ruler on the left, the slabs, the drop line, and the rocket (a baked sprite, rebaked
//    only when the crew changes) with a two-frame flame under each firing thruster. A crash breaks the rocket into
//    five baked parts once.
import { isWebOS } from "../../shell/tv.ts";
import { HALF_W, hazardPose, type Hazard, type Rect } from "./course.ts";
import { CREW, DISPLAY, LOOK } from "./look.ts";
import { PAD_Y, STEP, type Liftoff, type Thruster } from "./rules.ts";

/** Metres of tunnel visible top to bottom. */
const VIEW_M = 37;
const WALL = 1.1;
const RULER = 3.9;
/** Canvas left edge to the tunnel's middle, m. */
const OX = HALF_W + WALL + RULER;
const RIGHT = HALF_W + WALL + 0.2;
/** The rocket sits this far above the bottom of the view. */
const ROCKET_AT = 13.2;
/** Sprite box around the rocket's centre, m. */
const SX0 = -1.7;
const SX1 = 1.7;
const SY0 = -2.75;
const SY1 = 3.15;
const PART_MS = 2600;

type PartName = "nose" | "upper" | "lower" | "finL" | "finR";
const PART_CENTRE: Record<PartName, [number, number]> = {
  nose: [0, 2.05],
  upper: [0, 0.75],
  lower: [0, -1.0],
  finL: [-1.15, -1.45],
  finR: [1.15, -1.45],
};

interface Part {
  img: HTMLCanvasElement;
  cx: number;
  cy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  a: number;
  w: number;
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export class TunnelView {
  readonly el: HTMLElement;
  private sky = document.createElement("canvas");
  private cv = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private W = 1920;
  private H = 1080;
  /** CSS px per metre, backing px per CSS px. */
  ppm = 40;
  private res = 1;
  private left = 0;
  private cw = 0;
  /** World y at the bottom of the view. */
  camB = -2.2;
  private stars = document.createElement("canvas");
  private hazard: CanvasPattern | null = null;
  private rocket = document.createElement("canvas");
  private parts: Record<PartName, HTMLCanvasElement> | null = null;
  private flames: HTMLCanvasElement[] = [];
  private crewKey = "";
  private nozzleW = 0.3;
  private flying: Part[] = [];
  private crashAt = 0;
  private flashAt = 0;
  private flashX = 0;
  private flashY = 0;
  private lastNow = 0;
  /** Recent bumps (a spark burst each) and the last one's shake. */
  private bumps: { x: number; y: number; nx: number; ny: number; power: number; at: number }[] = [];
  private bumpAt = 0;
  private bumpPower = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "lft-view";
    this.sky.className = "lft-sky";
    this.cv.className = "lft-tunnel";
    this.el.append(this.sky, this.cv);
    parent.appendChild(this.el);
    this.ctx = this.cv.getContext("2d")!;
  }

  /** The tunnel column in CSS px: its left edge, the tunnel's middle and the inner width. */
  get column() {
    return {
      left: this.left,
      width: this.cw,
      mid: this.left + OX * this.ppm,
      inner: HALF_W * 2 * this.ppm,
      outerRight: this.left + (OX + RIGHT) * this.ppm,
    };
  }

  layout(W: number, H: number) {
    this.W = W;
    this.H = H;
    this.ppm = H / VIEW_M;
    const dpr = window.devicePixelRatio || 1;
    this.res = isWebOS ? Math.min(dpr, 1920 / Math.max(1, W)) : dpr;
    this.cw = Math.round((OX + RIGHT) * this.ppm);
    this.left = Math.round(W / 2 - OX * this.ppm);
    Object.assign(this.cv.style, { left: `${this.left}px`, top: "0px", width: `${this.cw}px`, height: `${H}px` });
    this.cv.width = Math.round(this.cw * this.res);
    this.cv.height = Math.round(H * this.res);
    Object.assign(this.sky.style, { left: "0px", top: "0px", width: `${W}px`, height: `${H}px` });
    this.sky.width = Math.round(W * this.res);
    this.sky.height = Math.round(H * this.res);
    this.bakeSky();
    this.bakeStars();
    this.bakeHazard();
    this.crewKey = "";
  }

  // ------------------------------------------------------------------ baking

  private bakeSky() {
    const ctx = this.sky.getContext("2d")!;
    const { W, H } = this;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.fillStyle = LOOK.navy;
    ctx.fillRect(0, 0, W, H);
    // a low planet rim behind the panels, and a few stars
    const u = H / 1080;
    ctx.fillStyle = LOOK.deep;
    ctx.beginPath();
    ctx.arc(W / 2, H + W * 1.05, W * 1.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(41, 179, 168, 0.35)";
    ctx.lineWidth = 2 * u;
    ctx.beginPath();
    ctx.arc(W / 2, H + W * 1.05, W * 1.18, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    // not behind the panels' text
    const col = this.left;
    const right = this.left + this.cw;
    this.starField(ctx, W, H, 90, 9, u, [
      [40 * u, 40 * u, col, 820 * u],
      [right, 40 * u, W - 40 * u, 900 * u],
    ]);
    // the poster frame
    ctx.strokeStyle = "rgba(238, 242, 247, 0.16)";
    ctx.lineWidth = 2 * u;
    const m = 22 * u;
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
  }

  private starField(ctx: CanvasRenderingContext2D, w: number, h: number, n: number, seed: number, u: number, keep: number[][] = []) {
    for (let i = 0; i < n; i++) {
      const x = hash(seed * 1000 + i) * w;
      const y = hash(seed * 1000 + i + 500) * h;
      if (keep.some(([x0, y0, x1, y1]) => x > x0! && x < x1! && y > y0! && y < y1!)) continue;
      const big = hash(seed * 1000 + i + 900) > 0.9;
      ctx.fillStyle = big ? LOOK.chalk : `rgba(238, 242, 247, ${0.25 + hash(i + seed) * 0.45})`;
      if (big) {
        // a four-point star
        const r = 7 * u;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.22, y - r * 0.22);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x + r * 0.22, y + r * 0.22);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.22, y + r * 0.22);
        ctx.lineTo(x - r, y);
        ctx.lineTo(x - r * 0.22, y - r * 0.22);
        ctx.closePath();
        ctx.fill();
      } else {
        const r = (1 + hash(i * 3 + seed) * 1.4) * u;
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
  }

  /** The tunnel's own star tile: one screen tall, repeated as the camera climbs. */
  private bakeStars() {
    const w = Math.round(HALF_W * 2 * this.ppm);
    this.stars.width = Math.round(w * this.res);
    this.stars.height = Math.round(this.H * this.res);
    const ctx = this.stars.getContext("2d")!;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.fillStyle = LOOK.navy;
    ctx.fillRect(0, 0, w, this.H);
    this.starField(ctx, w, this.H, 34, 3, this.H / 1080);
  }

  private bakeHazard() {
    const s = Math.round(26 * (this.H / 1080) * this.res);
    const c = document.createElement("canvas");
    c.width = c.height = s;
    const x = c.getContext("2d")!;
    x.fillStyle = "rgba(255, 106, 43, 0.16)";
    x.fillRect(0, 0, s, s);
    x.fillStyle = "rgba(255, 106, 43, 0.3)";
    x.beginPath();
    x.moveTo(0, 0);
    x.lineTo(s / 2, 0);
    x.lineTo(0, s / 2);
    x.closePath();
    x.moveTo(s, 0);
    x.lineTo(s, s / 2);
    x.lineTo(s / 2, s);
    x.lineTo(0, s);
    x.closePath();
    x.fill();
    this.hazard = this.ctx.createPattern(c, "repeat");
  }

  /** Rebakes the rocket when its thrusters (count, colours) change. */
  private bakeRocket(ths: Thruster[]) {
    const key = ths.map((t) => `${t.slot}`).join(",") + `@${this.ppm}`;
    if (key === this.crewKey) return;
    this.crewKey = key;
    const n = Math.max(1, ths.length);
    this.nozzleW = Math.min(0.42, 1.8 / n);
    const k = this.ppm * this.res;
    const make = () => {
      const c = document.createElement("canvas");
      c.width = Math.ceil((SX1 - SX0) * k);
      c.height = Math.ceil((SY1 - SY0) * k);
      const ctx = c.getContext("2d")!;
      // local metres, y up, origin at the rocket's centre
      ctx.setTransform(k, 0, 0, -k, -SX0 * k, SY1 * k);
      return { c, ctx };
    };
    const names: PartName[] = ["nose", "upper", "lower", "finL", "finR"];
    const parts = {} as Record<PartName, HTMLCanvasElement>;
    const whole = make();
    for (const p of names) {
      const one = make();
      drawPart(one.ctx, p, ths, this.nozzleW);
      drawPart(whole.ctx, p, ths, this.nozzleW);
      parts[p] = one.c;
    }
    this.rocket = whole.c;
    this.parts = parts;
    // the flames: two frames, shaped for this nozzle width
    this.flames = [0, 1].map((f) => {
      const fw = this.nozzleW * 1.15;
      const len = f ? 1.05 : 1.35;
      const c = document.createElement("canvas");
      c.width = Math.ceil(fw * k) + 2;
      c.height = Math.ceil(len * k) + 2;
      const x = c.getContext("2d")!;
      x.setTransform(k, 0, 0, k, (fw / 2) * k + 1, 1);
      const flame = (w: number, l: number, col: string) => {
        x.fillStyle = col;
        x.beginPath();
        x.moveTo(-w / 2, 0);
        x.quadraticCurveTo(-w * (f ? 0.42 : 0.5), l * 0.55, 0, l);
        x.quadraticCurveTo(w * (f ? 0.5 : 0.4), l * 0.55, w / 2, 0);
        x.closePath();
        x.fill();
      };
      flame(fw, len, LOOK.orange);
      flame(fw * 0.5, len * 0.58, "#ffd9a8");
      return c;
    });
  }

  // ------------------------------------------------------------------ events

  clear() {
    this.flying = [];
    this.crashAt = 0;
    this.bumps = [];
    this.bumpAt = 0;
  }

  /** The rocket bumped a wall or a slab: a burst of sparks at the contact and a small knock. */
  bump(e: { x: number; y: number; nx: number; ny: number; power: number }, now: number) {
    this.bumps.push({ ...e, at: now });
    if (this.bumps.length > 4) this.bumps.shift();
    this.bumpAt = now;
    this.bumpPower = e.power;
  }

  crash(game: Liftoff, e: { x: number; y: number; a: number; vx: number; vy: number; w: number }, now: number) {
    this.bakeRocket(game.thrusters);
    if (!this.parts) return;
    const c = Math.cos(e.a);
    const s = Math.sin(e.a);
    this.flying = (Object.keys(PART_CENTRE) as PartName[]).map((p, i) => {
      const [lx, ly] = PART_CENTRE[p];
      const wx = e.x + lx * c + ly * s;
      const wy = e.y - lx * s + ly * c;
      // pushed outward from the centre, plus a little spin
      const ox = wx - e.x;
      const oy = wy - e.y;
      const d = Math.hypot(ox, oy) || 1;
      return {
        img: this.parts![p], cx: lx, cy: ly, x: wx, y: wy,
        vx: e.vx * 0.4 + (ox / d) * 5 + (hash(i + now) - 0.5) * 2,
        vy: Math.max(-2, e.vy * 0.3) + (oy / d) * 5 + 3,
        a: e.a, w: (hash(i * 7 + now) - 0.5) * 7,
      };
    });
    this.crashAt = now;
    this.flashAt = now;
    this.flashX = e.x;
    this.flashY = e.y;
  }

  // ------------------------------------------------------------------ the frame

  /** Draws a frame. `frozen` (paused): nothing moves. */
  frame(game: Liftoff, alpha: number, now: number, frozen = false) {
    const first = !this.lastNow;
    const dt = !first && !frozen ? Math.min(0.1, (now - this.lastNow) / 1000) : 0;
    this.lastNow = now;
    const r = game.rocket;
    const live = r.alive && (game.phase === "fly" || game.phase === "count");
    const rx = live ? r.px + (r.x - r.px) * alpha : r.x;
    const ry = live ? r.py + (r.y - r.py) * alpha : r.y;
    const ra = live ? r.pa + (r.a - r.pa) * alpha : r.a;
    const t = game.time + (game.phase === "fly" ? alpha * STEP : 0);
    const P = this.ppm;
    const H = this.H;

    // the camera follows the rocket smoothly; it never shows below the ground or far below the drop line
    let follow = ry;
    if (!r.alive && this.flying.length) follow = Math.max(this.flying[1]!.y, this.flying[0]!.y) * 0.3 + r.y * 0.7;
    const target = Math.max(follow - ROCKET_AT, game.floor - 3, -2.2);
    if (game.phase === "count" || first) this.camB = target;
    else this.camB += (target - this.camB) * (1 - Math.exp(-dt * 4.5));
    const cam = this.camB;
    const sx = (x: number) => (x + OX) * P;
    const sy = (y: number) => H - (y - cam) * P;

    const ctx = this.ctx;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    // one small shake on a crash
    const since = now - this.crashAt;
    if (this.crashAt && since < 260) {
      const k = (1 - since / 260) * 5 * (H / 1080);
      ctx.translate(Math.sin(since * 0.09) * k, Math.cos(since * 0.11) * k * 0.6);
    } else if (this.bumpAt && now - this.bumpAt < 170) {
      // a bump: a short, small knock
      const b = now - this.bumpAt;
      const k = (1 - b / 170) * (1.5 + 3 * this.bumpPower) * (H / 1080);
      ctx.translate(Math.sin(b * 0.12) * k, Math.cos(b * 0.15) * k * 0.7);
    }
    ctx.clearRect(-20, -20, this.cw + 40, H + 40);

    // sky inside the tunnel: the star tile, scrolling slowly
    const x0 = sx(-HALF_W);
    const inner = HALF_W * 2 * P;
    const off = (((cam * P * 0.22) % H) + H) % H;
    ctx.drawImage(this.stars, x0, off - H, inner, H);
    ctx.drawImage(this.stars, x0, off, inner, H);

    this.drawGround(ctx, sx, sy);
    this.drawMarks(ctx, sx, sy, cam);
    // obstacles in view
    const top = cam + VIEW_M + 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, inner, H);
    ctx.clip();
    for (const o of game.course.rects) {
      if (o.y1 < cam - 1 || o.y0 > top) continue;
      this.drawRect(ctx, o, sx, sy);
    }
    for (const h of game.course.hazards) {
      if (h.box[3] < cam - 1 || h.box[1] > top) continue;
      this.drawHazard(ctx, h, t, sx, sy);
    }
    // the drop line
    const fy = sy(game.floor);
    if (fy < H + 4 && this.hazard) {
      ctx.fillStyle = this.hazard;
      ctx.fillRect(x0, fy, inner, H - fy + 10);
      ctx.fillStyle = LOOK.orange;
      ctx.fillRect(x0, fy - 2 * (H / 1080), inner, 4 * (H / 1080));
    }
    ctx.restore();
    this.drawWalls(ctx, sx, sy, cam, ry, game);
    this.drawBumps(ctx, sx, sy, now);

    // the rocket, or its parts
    this.bakeRocket(game.thrusters);
    if (r.alive) this.drawRocket(ctx, game, sx(rx), sy(ry), ra, now);
    else this.drawParts(ctx, dt, now, sx, sy);
  }

  private drawGround(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number) {
    const gy = sy(0);
    if (gy > this.H + 10) return;
    const P = this.ppm;
    ctx.fillStyle = LOOK.slate;
    ctx.fillRect(sx(-HALF_W), gy, HALF_W * 2 * P, this.H - gy + 10);
    ctx.fillStyle = LOOK.slateHi;
    ctx.fillRect(sx(-HALF_W), gy, HALF_W * 2 * P, 3 * (this.H / 1080));
    // the launch pad: a striped plate and two light masts
    const pw = 4.2;
    ctx.fillStyle = LOOK.chalk;
    ctx.fillRect(sx(-pw / 2), gy - 0.3 * P, pw * P, 0.3 * P);
    ctx.fillStyle = LOOK.orange;
    for (let i = 0; i < 7; i++) if (i % 2 === 0) ctx.fillRect(sx(-pw / 2 + (i * pw) / 7), gy - 0.3 * P, (pw / 7) * P, 0.3 * P);
    for (const side of [-1, 1]) {
      ctx.fillStyle = LOOK.slateHi;
      ctx.fillRect(sx(side * 3.4) - 0.09 * P, sy(4.2), 0.18 * P, 4.2 * P);
      ctx.fillStyle = LOOK.teal;
      ctx.fillRect(sx(side * 3.4) - 0.2 * P, sy(4.4), 0.4 * P, 0.22 * P);
    }
  }

  /** The checkpoint lines every 100 m. */
  private drawMarks(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, cam: number) {
    const u = this.H / 1080;
    ctx.fillStyle = "rgba(238, 242, 247, 0.28)";
    for (let m = Math.ceil(cam / 100) * 100; m < cam + VIEW_M; m += 100) {
      if (m <= 0) continue;
      const y = sy(m + PAD_Y);
      for (let x = -HALF_W; x < HALF_W; x += 0.8) ctx.fillRect(sx(x), y - u, 0.45 * this.ppm, 2 * u);
    }
  }

  /** A slab: slate with a lit top edge (the rocket bumps off it). */
  private drawRect(ctx: CanvasRenderingContext2D, o: Rect, sx: (x: number) => number, sy: (y: number) => number) {
    const P = this.ppm;
    const u = this.H / 1080;
    const x = sx(o.x0);
    const y = sy(o.y1);
    const w = (o.x1 - o.x0) * P;
    const h = (o.y1 - o.y0) * P;
    ctx.fillStyle = LOOK.slate;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = LOOK.slateHi;
    ctx.fillRect(x, y, w, 4 * u);
    ctx.fillStyle = "rgba(7, 14, 34, 0.55)";
    ctx.fillRect(x, y + h - 3 * u, w, 3 * u);
  }

  /** Hazards share one language: dark body, chalk spikes or beam, signal orange. */
  private drawHazard(ctx: CanvasRenderingContext2D, h: Hazard, t: number, sx: (x: number) => number, sy: (y: number) => number) {
    const P = this.ppm;
    const u = this.H / 1080;
    const p = hazardPose(h, t);
    const X = sx(p.x);
    const Y = sy(p.y);
    switch (h.k) {
      case "mine": {
        const R = h.r * P;
        ctx.fillStyle = LOOK.chalk;
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4 + Math.PI / 8;
          const c = Math.cos(a);
          const s = Math.sin(a);
          ctx.beginPath();
          ctx.moveTo(X + (c * R * 0.78 - s * R * 0.2), Y + (s * R * 0.78 + c * R * 0.2));
          ctx.lineTo(X + c * R * 1.38, Y + s * R * 1.38);
          ctx.lineTo(X + (c * R * 0.78 + s * R * 0.2), Y + (s * R * 0.78 - c * R * 0.2));
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = "#1b2540";
        ctx.beginPath();
        ctx.arc(X, Y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = LOOK.orange;
        ctx.lineWidth = 3 * u;
        ctx.stroke();
        // the blinking light
        const on = Math.sin(t * 6.5 + h.seed * 1.7) > 0;
        if (on) {
          ctx.fillStyle = "rgba(255, 106, 43, 0.3)";
          ctx.beginPath();
          ctx.arc(X, Y, R * 0.66, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = on ? "#ffb08a" : "#7a3a22";
        ctx.beginPath();
        ctx.arc(X, Y, R * 0.3, 0, Math.PI * 2);
        ctx.fill();
        return;
      }
      case "meteor": {
        const R = h.r * P;
        // a streak behind it, along its sideways motion
        const vx = h.ax * h.om * Math.cos(h.om * t + h.ph);
        if (Math.abs(vx) > 0.4) {
          const dir = vx > 0 ? -1 : 1;
          const g = ctx.createLinearGradient(X, Y, X + dir * R * 3.4, Y);
          g.addColorStop(0, "rgba(255, 106, 43, 0.42)");
          g.addColorStop(1, "rgba(255, 106, 43, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(X, Y - R * 0.85);
          ctx.lineTo(X + dir * R * 3.4, Y);
          ctx.lineTo(X, Y + R * 0.85);
          ctx.closePath();
          ctx.fill();
        }
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(t * 0.8 * (h.seed % 2 ? 1 : -1) + h.seed);
        ctx.fillStyle = LOOK.slate;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) {
          const a = (i * Math.PI * 2) / 9;
          const rr = R * (0.8 + 0.22 * hash(h.seed + i * 3.1));
          const px = Math.cos(a) * rr;
          const py = Math.sin(a) * rr;
          if (i) ctx.lineTo(px, py);
          else ctx.moveTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = LOOK.orange;
        ctx.lineWidth = 3 * u;
        ctx.stroke();
        ctx.fillStyle = LOOK.slateHi;
        ctx.beginPath();
        ctx.arc(-R * 0.28, -R * 0.2, R * 0.26, 0, Math.PI * 2);
        ctx.arc(R * 0.3, R * 0.28, R * 0.17, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      case "bar": {
        const L = h.len * P;
        const w = h.r * P;
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(-p.a);
        // spikes along both edges
        ctx.fillStyle = LOOK.chalk;
        for (let m = -h.len + 0.5; m < h.len - 0.2; m += 0.9) {
          const x = m * P;
          for (const s of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(x - 0.22 * P, s * w);
            ctx.lineTo(x, s * (w + 0.62 * P));
            ctx.lineTo(x + 0.22 * P, s * w);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.fillStyle = "#1b2540";
        ctx.fillRect(-L, -w, L * 2, w * 2);
        ctx.fillStyle = LOOK.orange;
        for (let m = -h.len; m < h.len - 0.5; m += 1.2) ctx.fillRect(m * P, -w * 0.45, 0.6 * P, w * 0.9);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(s * L, 0, w * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = LOOK.slate;
        ctx.beginPath();
        ctx.arc(0, 0, w * 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = LOOK.chalk;
        ctx.beginPath();
        ctx.arc(0, 0, w * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      case "laser": {
        const x0 = sx(h.x - h.len - h.r);
        const x1 = sx(h.x + h.len + h.r);
        // the rails the beam rides on
        ctx.strokeStyle = "rgba(77, 91, 128, 0.7)";
        ctx.lineWidth = 2 * u;
        for (const x of [x0, x1]) {
          ctx.beginPath();
          ctx.moveTo(x, sy(h.y - h.ay) + 10 * u);
          ctx.lineTo(x, sy(h.y + h.ay) - 10 * u);
          ctx.stroke();
        }
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255, 106, 43, 0.28)";
        ctx.lineWidth = 15 * u;
        ctx.beginPath();
        ctx.moveTo(x0, Y);
        ctx.lineTo(x1, Y);
        ctx.stroke();
        ctx.strokeStyle = LOOK.orange;
        ctx.lineWidth = 6 * u;
        ctx.stroke();
        ctx.strokeStyle = "#fff1e6";
        ctx.lineWidth = 2 * u;
        ctx.stroke();
        ctx.lineCap = "butt";
        // the two emitters
        for (const x of [x0, x1]) {
          ctx.fillStyle = LOOK.slateHi;
          ctx.fillRect(x - 7 * u, Y - 14 * u, 14 * u, 28 * u);
          ctx.fillStyle = LOOK.orange;
          ctx.beginPath();
          ctx.arc(x, Y, 7 * u, 0, Math.PI * 2);
          ctx.fill();
        }
        return;
      }
    }
  }

  /** The sparks of a bump: a ring and a few lines thrown off the surface. */
  private drawBumps(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, now: number) {
    const u = this.H / 1080;
    const P = this.ppm;
    this.bumps = this.bumps.filter((b) => now - b.at < 300);
    for (const b of this.bumps) {
      const p = (now - b.at) / 300;
      const X = sx(b.x);
      const Y = sy(b.y);
      ctx.strokeStyle = `rgba(238, 242, 247, ${0.9 * (1 - p)})`;
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.arc(X, Y, (0.25 + p * 0.9) * P, 0, Math.PI * 2);
      ctx.stroke();
      // sparks fan out along the surface's normal (screen y is flipped)
      const base = Math.atan2(-b.ny, b.nx);
      ctx.strokeStyle = `rgba(255, 183, 130, ${1 - p})`;
      for (let i = -2; i <= 2; i++) {
        const a = base + i * 0.5;
        const len = (0.8 + p * 1.7) * (0.6 + b.power * 0.4);
        ctx.beginPath();
        ctx.moveTo(X + Math.cos(a) * (0.4 + p) * P, Y + Math.sin(a) * (0.4 + p) * P);
        ctx.lineTo(X + Math.cos(a) * len * P, Y + Math.sin(a) * len * P);
        ctx.stroke();
      }
    }
  }

  private drawWalls(ctx: CanvasRenderingContext2D, sx: (x: number) => number, sy: (y: number) => number, cam: number, ry: number, game: Liftoff) {
    const P = this.ppm;
    const H = this.H;
    const u = H / 1080;
    const wl = sx(-HALF_W - WALL);
    const wr = sx(HALF_W);
    ctx.fillStyle = LOOK.slate;
    ctx.fillRect(wl, 0, WALL * P, H);
    ctx.fillRect(wr, 0, WALL * P, H);
    ctx.fillStyle = LOOK.teal;
    ctx.fillRect(sx(-HALF_W) - 3 * u, 0, 3 * u, H);
    ctx.fillRect(wr, 0, 3 * u, H);
    // seams every 5 m: they show the climb
    ctx.fillStyle = "rgba(7, 14, 34, 0.5)";
    for (let m = Math.floor(cam / 5) * 5; m < cam + VIEW_M + 5; m += 5) {
      const y = sy(m);
      ctx.fillRect(wl, y, WALL * P - 3 * u, 3 * u);
      ctx.fillRect(wr + 3 * u, y, WALL * P - 3 * u, 3 * u);
    }
    // the ruler, left of the left wall: heights above the pad
    const rx = wl - 8 * u;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let hr = Math.max(0, Math.floor(cam - 6)); hr < cam + VIEW_M + 3; hr++) {
      const y = sy(hr + PAD_Y);
      const ten = hr % 10 === 0;
      const hundred = hr % 100 === 0 && hr > 0;
      const len = (ten ? 26 : hr % 5 === 0 ? 15 : 8) * u;
      ctx.fillStyle = ten ? LOOK.chalk : LOOK.slateHi;
      ctx.fillRect(rx - len, y - u, len, (ten ? 3 : 2) * u);
      if (ten) {
        ctx.fillStyle = hundred ? LOOK.orange : "rgba(238, 242, 247, 0.8)";
        ctx.font = `${hundred ? 700 : 600} ${Math.round((hundred ? 34 : 28) * u)}px ${DISPLAY}`;
        ctx.fillText(String(hr), rx - 36 * u, y);
      }
    }
    // the ruler's caret at the rocket's height
    if (game.phase === "fly" || game.phase === "count") {
      const y = sy(ry);
      ctx.fillStyle = LOOK.orange;
      ctx.beginPath();
      ctx.moveTo(rx + 4 * u, y);
      ctx.lineTo(rx - 14 * u, y - 10 * u);
      ctx.lineTo(rx - 14 * u, y + 10 * u);
      ctx.closePath();
      ctx.fill();
    }
  }

  private drawRocket(ctx: CanvasRenderingContext2D, game: Liftoff, x: number, y: number, a: number, now: number) {
    const k = this.ppm;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    // flames first, under the nozzles
    const tick = Math.floor(now / 70);
    game.thrusters.forEach((th, i) => {
      if (!th.on) return;
      const f = this.flames[(tick + i) & 1]!;
      const w = f.width / this.res;
      ctx.drawImage(f, th.d * k - w / 2, 2.5 * k, w, f.height / this.res);
    });
    ctx.drawImage(this.rocket, SX0 * k, -SY1 * k, (SX1 - SX0) * k, (SY1 - SY0) * k);
    ctx.restore();
  }

  private drawParts(ctx: CanvasRenderingContext2D, dt: number, now: number, sx: (x: number) => number, sy: (y: number) => number) {
    const since = now - this.crashAt;
    const k = this.ppm;
    const u = this.H / 1080;
    if (since < 320) {
      // the flash: one ring, once
      const p = since / 320;
      ctx.strokeStyle = `rgba(255, 106, 43, ${1 - p})`;
      ctx.lineWidth = 6 * u * (1 - p) + 1;
      ctx.beginPath();
      ctx.arc(sx(this.flashX), sy(this.flashY), (1 + p * 4) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (since > PART_MS) return;
    ctx.globalAlpha = since > PART_MS - 700 ? (PART_MS - since) / 700 : 1;
    for (const p of this.flying) {
      p.vy -= 9 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.a += p.w * dt;
      ctx.save();
      ctx.translate(sx(p.x), sy(p.y));
      ctx.rotate(p.a);
      // the part's own centre sits at the pivot
      ctx.drawImage(p.img, (SX0 - p.cx) * k, -(SY1 - p.cy) * k, (SX1 - SX0) * k, (SY1 - SY0) * k);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

/** One part of the rocket, in local metres (y up). Simple flat geometry. */
function drawPart(ctx: CanvasRenderingContext2D, p: PartName, ths: Thruster[], nozzleW: number) {
  const poly = (pts: number[], col: string) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
    ctx.closePath();
    ctx.fill();
  };
  switch (p) {
    case "nose":
      ctx.fillStyle = LOOK.orange;
      ctx.beginPath();
      ctx.moveTo(-0.85, 1.3);
      ctx.quadraticCurveTo(-0.8, 2.45, 0, 3.05);
      ctx.quadraticCurveTo(0.8, 2.45, 0.85, 1.3);
      ctx.closePath();
      ctx.fill();
      // a chalk tip
      ctx.fillStyle = LOOK.chalk;
      ctx.beginPath();
      ctx.moveTo(-0.25, 2.78);
      ctx.quadraticCurveTo(-0.15, 2.92, 0, 3.05);
      ctx.quadraticCurveTo(0.15, 2.92, 0.25, 2.78);
      ctx.closePath();
      ctx.fill();
      break;
    case "upper":
      poly([-0.85, 0.15, 0.85, 0.15, 0.85, 1.3, -0.85, 1.3], LOOK.chalk);
      // the porthole
      ctx.fillStyle = LOOK.teal;
      ctx.beginPath();
      ctx.arc(0, 0.74, 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = LOOK.navy;
      ctx.beginPath();
      ctx.arc(0, 0.74, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(238, 242, 247, 0.85)";
      ctx.beginPath();
      ctx.arc(-0.08, 0.82, 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "lower": {
      poly([-0.85, -1.6, 0.85, -1.6, 0.85, 0.15, -0.85, 0.15], LOOK.chalk);
      // a slate band and a thin orange stripe
      poly([-0.85, -0.2, 0.85, -0.2, 0.85, 0.05, -0.85, 0.05], LOOK.slate);
      poly([-0.85, -0.42, 0.85, -0.42, 0.85, -0.32, -0.85, -0.32], LOOK.orange);
      // the engine skirt
      poly([-0.85, -1.6, 0.85, -1.6, 1.0, -2.1, -1.0, -2.1], LOOK.slate);
      // one nozzle per thruster, each with its holder's colour chip
      for (const th of ths) {
        const w = nozzleW;
        poly([th.d - w * 0.32, -2.1, th.d + w * 0.32, -2.1, th.d + w * 0.5, -2.5, th.d - w * 0.5, -2.5], "#27314d");
        ctx.fillStyle = CREW[th.slot % CREW.length]!;
        const cs = Math.min(0.34, w * 0.78);
        ctx.fillRect(th.d - cs / 2, -1.85 - cs / 2, cs, cs);
      }
      break;
    }
    case "finL":
      poly([-0.85, -0.35, -1.5, -1.55, -1.5, -2.3, -0.85, -1.75], LOOK.orange);
      break;
    case "finR":
      poly([0.85, -0.35, 1.5, -1.55, 1.5, -2.3, 0.85, -1.75], LOOK.orange);
      break;
  }
}
