// Canvas 2D drawing for the fight: simple vector shapes drawn from the real collision meshes,
// interpolated between 50 Hz physics steps.

import type { Body } from "./engine.ts";
import { type Arena, lerpBody, type Machine, type Tag, VIEW_H, VIEW_W } from "./sim.ts";
import { MACHINE } from "./weapons.ts";

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  w: number;
}

interface Float {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
  size: number;
}

const HULL_R = 16.5;

export class Fx {
  sparks: Spark[] = [];
  floats: Float[] = [];
  shake = 0;
  /** At most this many sparks live at once (each is a separate stroke; a long grind could add hundreds). */
  constructor(readonly maxSparks = 240) {}
  /** Recent striker tip positions per machine, for the swing trail. */
  trails = new Map<Machine, { x: number; y: number }[]>();

  burst(x: number, y: number, n: number, speed: number, color: string, w = 2): void {
    n = Math.min(n, this.maxSparks - this.sparks.length);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.18 + Math.random() * 0.35;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, w });
    }
  }

  text(x: number, y: number, text: string, color: string, size: number): void {
    if (this.floats.length >= 12) this.floats.shift();
    this.floats.push({ x, y, text, life: 0.9, color, size: Math.round(size) });
  }

  update(dt: number): void {
    this.shake *= Math.exp(-dt * 14);
    if (this.shake < 0.05) this.shake = 0; // still, exactly
    // in place, swap-remove: no new arrays every frame
    const sp = this.sparks;
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        sp[i] = sp[sp.length - 1]!;
        sp.pop();
        continue;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vx *= 1 - dt * 4;
      s.vy = s.vy * (1 - dt * 4) + 300 * dt;
    }
    const fl = this.floats;
    for (let i = fl.length - 1; i >= 0; i--) {
      const f = fl[i]!;
      f.life -= dt;
      f.y -= 40 * dt;
      if (f.life <= 0) fl.splice(i, 1); // few, and their order is their stacking
    }
  }
}

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private scale = 1;

  /** The arena backdrop, painted once per size (the TV can't afford to paint it every frame). */
  private bg: HTMLCanvasElement | null = null;
  /** The mace ball's shading, made once (it's in the ball's local frame, so it fits every ball). */
  private ballGrad: CanvasGradient | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private opts: { maxDpr?: number; maxWidth?: number; names?: boolean } = {},
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr ?? 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.min(Math.round(r.width * dpr), this.opts.maxWidth ?? 4096);
    this.canvas.width = w;
    this.canvas.height = Math.round((w * VIEW_H) / VIEW_W);
    this.scale = this.canvas.width / VIEW_W;
    this.bg = paintBackdrop(this.canvas.width, this.canvas.height, this.scale);
  }

  draw(arena: Arena, alpha: number, fx: Fx): void {
    const ctx = this.ctx;
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.sky();
    const sh = fx.shake;
    ctx.setTransform(s, 0, 0, s, (Math.random() - 0.5) * sh * s, (Math.random() - 0.5) * sh * s);

    for (const m of arena.machines) this.trail(m, alpha, fx);
    for (const m of arena.machines) this.weapon(m, alpha);
    // a wreck that has faded out (or left play) draws nothing: skip its paths entirely
    for (const m of arena.machines) if (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m))) this.machine(arena, m, alpha);

    ctx.lineCap = "round";
    for (const p of fx.sparks) {
      const k = p.life / p.max;
      ctx.strokeStyle = p.color;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.lineWidth = p.w * k + 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    let font = "";
    for (const f of fx.floats) {
      ctx.globalAlpha = Math.min(1, f.life * 2);
      const want = `${f.size}px "Russo One", system-ui, sans-serif`;
      if (want !== font) ctx.font = font = want; // setting a font parses it
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10,12,20,0.85)";
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
    for (const m of arena.machines) this.offscreen(m, alpha);
  }

  private sky(): void {
    if (this.bg) this.ctx.drawImage(this.bg, 0, 0);
  }

  /** Transform the context into a body's local frame. */
  private enter(b: Body, alpha: number): void {
    const [x, y, a] = lerpBody(b, alpha);
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(a);
  }

  private mesh(b: Body): void {
    const ctx = this.ctx;
    ctx.beginPath();
    for (let i = 0; i < b.count; i++) {
      if (i === 0) ctx.moveTo(b.lx[i]!, b.ly[i]!);
      else ctx.lineTo(b.lx[i]!, b.ly[i]!);
    }
    ctx.closePath();
  }

  private trail(m: Machine, alpha: number, fx: Fx): void {
    // no weapon, no trail (after a pickup, `striker` still points at the weapon the taker now holds)
    if (!m.alive || !m.armed) {
      fx.trails.delete(m);
      return;
    }
    const b = m.striker;
    const [x, y, a] = lerpBody(b, alpha);
    let maxX = 0;
    for (let i = 0; i < b.count; i++) maxX = Math.max(maxX, b.lx[i]!);
    const tip = { x: x + Math.cos(a) * maxX, y: y + Math.sin(a) * maxX };
    let pts = fx.trails.get(m);
    if (!pts) fx.trails.set(m, (pts = []));
    pts.push(tip);
    if (pts.length > 9) pts.shift();
    if (!m.alive || pts.length < 2) return;
    const speed = Math.hypot(b.vx, b.vy);
    const k0 = Math.min(1, Math.max(0, (speed - 200) / 500));
    if (k0 <= 0) return;
    const ctx = this.ctx;
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1]!;
      const p1 = pts[i]!;
      const k = i / pts.length;
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * k0 * k})`;
      ctx.lineWidth = 10 * k;
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
  }

  private weapon(m: Machine, alpha: number): void {
    const ctx = this.ctx;
    const [hx, hy] = lerpBody(m.hull, alpha);

    // chain line: hull → links → handle back end
    if (m.weapon === "chainball" && m.parts.length) {
      ctx.strokeStyle = "#9aa1ae";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let first = true;
      if (m.armed) {
        ctx.moveTo(hx, hy);
        first = false;
      }
      for (const b of m.parts) {
        const spec = (b.data as Tag).spec!;
        if (spec.look !== "link") continue;
        const [x, y] = lerpBody(b, alpha);
        if (first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        first = false;
      }
      const handle = m.part.get("handle");
      if (handle) {
        const [x, y, a] = lerpBody(handle, alpha);
        ctx.lineTo(x - Math.cos(a) * 12, y - Math.sin(a) * 12);
      }
      ctx.stroke();
    }

    for (const b of m.parts) {
      const spec = (b.data as Tag).spec!;
      const [bx, by, ba] = lerpBody(b, alpha);
      if (m.armed && (spec.look === "hammer" || spec.look === "blade")) {
        // the rod from the machine to the weapon's back end
        let minX = 0;
        for (let i = 0; i < b.count; i++) minX = Math.min(minX, b.lx[i]!);
        ctx.strokeStyle = "#8a6a4a";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(bx + Math.cos(ba) * minX, by + Math.sin(ba) * minX);
        ctx.stroke();
      }
      this.enter(b, alpha);
      if (spec.look === "hammer") {
        const ha = 8.5;
        const hc = 14.5;
        ctx.fillStyle = "#c9ced8";
        for (const sgn of [-1, 1]) {
          for (const off of [-5, 0, 5]) {
            ctx.beginPath();
            ctx.moveTo(off - 3, sgn * hc);
            ctx.lineTo(off, sgn * (hc + 7));
            ctx.lineTo(off + 3, sgn * hc);
            ctx.fill();
          }
        }
        ctx.beginPath();
        ctx.moveTo(ha, -4);
        ctx.lineTo(ha + 8, 0);
        ctx.lineTo(ha, 4);
        ctx.fill();
        ctx.fillStyle = "#5b616e";
        ctx.strokeStyle = "#3a3f4b";
        ctx.lineWidth = 2;
        this.mesh(b);
        ctx.fill();
        ctx.stroke();
      } else if (spec.look === "blade") {
        ctx.fillStyle = "#e6eaf2";
        ctx.strokeStyle = "#7d8494";
        ctx.lineWidth = 1.5;
        this.mesh(b);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#b8893e";
        ctx.fillRect(-21, -12, 4, 24);
      } else if (spec.look === "link") {
        ctx.strokeStyle = "#6c7280";
        ctx.lineWidth = 2;
        ctx.strokeRect(-5, -3, 10, 6);
      } else if (spec.look === "handle") {
        ctx.fillStyle = "#8a6a4a";
        this.mesh(b);
        ctx.fill();
      } else {
        ctx.fillStyle = "#c9ced8";
        for (let i = 0; i < 8; i++) {
          const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
          ctx.beginPath();
          ctx.moveTo(Math.cos(t - 0.25) * 12, Math.sin(t - 0.25) * 12);
          ctx.lineTo(Math.cos(t) * 19, Math.sin(t) * 19);
          ctx.lineTo(Math.cos(t + 0.25) * 12, Math.sin(t + 0.25) * 12);
          ctx.fill();
        }
        if (!this.ballGrad) {
          this.ballGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, 13);
          this.ballGrad.addColorStop(0, "#7d8494");
          this.ballGrad.addColorStop(1, "#2f333d");
        }
        ctx.fillStyle = this.ballGrad;
        this.mesh(b);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private machine(arena: Arena, m: Machine, alpha: number): void {
    const ctx = this.ctx;
    const [x, y] = lerpBody(m.hull, alpha);
    this.enter(m.hull, alpha);
    if (!m.alive) ctx.globalAlpha = Math.max(0, 1 - (arena.t - m.diedAt) / 2.5);

    if (m.alive) {
      const spin = Math.abs(Math.sin(arena.t * 38 + m.id));
      ctx.strokeStyle = "rgba(220,225,240,0.7)";
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-24 * spin, -HULL_R - 7);
      ctx.lineTo(24 * spin, -HULL_R - 7);
      ctx.stroke();
      ctx.fillStyle = "rgba(220,225,240,0.10)";
      ctx.beginPath();
      ctx.ellipse(0, -HULL_R - 7, 24, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3a3f4b";
      ctx.fillRect(-1.5, -HULL_R - 7, 3, 7);
    }

    ctx.fillStyle = m.flash > 0 ? "#ffffff" : m.alive ? m.color : "#3b3b44";
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 2.5;
    roundRect(ctx, -12.5, -16.5, 25, 33, 9);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(ctx, -12.5, 4, 25, 12.5, 6);
    ctx.fill();
    ctx.fillStyle = "rgba(225,240,255,0.9)";
    ctx.beginPath();
    ctx.ellipse(m.hull.vx >= 0 ? 4 : -4, -6, 5.5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    if (!m.alive) return;

    // Shock: stars circling over a machine whose engine is out.
    if (m.stun > 0) {
      const n = 3;
      ctx.fillStyle = "#ffe066";
      for (let i = 0; i < n; i++) {
        const t = arena.t * 7 + (i * Math.PI * 2) / n;
        const sx = x + Math.cos(t) * 18;
        const sy = y - HULL_R - 2 + Math.sin(t) * 5;
        ctx.globalAlpha = Math.min(1, m.stun * 3);
        star(ctx, sx, sy, 4.5);
      }
      ctx.globalAlpha = 1;
    }

    const w = 40;
    const frac = m.hp / MACHINE.health;
    const by = y - HULL_R - 22;
    ctx.fillStyle = "rgba(10,12,20,0.6)";
    roundRect(ctx, x - w / 2 - 1, by, w + 2, 6, 3);
    ctx.fill();
    ctx.fillStyle = frac > 0.5 ? "#7dffa3" : frac > 0.2 ? "#ffd166" : "#ff5d73";
    roundRect(ctx, x - w / 2, by + 1, w * frac, 4, 2);
    ctx.fill();
    if (this.opts.names) {
      ctx.font = `11px "Russo One", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(10,12,20,0.8)";
      ctx.strokeText(m.name, x, by - 4);
      ctx.fillStyle = m.color;
      ctx.fillText(m.name, x, by - 4);
    }
  }

  private offscreen(m: Machine, alpha: number): void {
    if (!m.alive) return;
    const [x, y] = lerpBody(m.hull, alpha);
    const pad = 14;
    if (x > -HULL_R && x < VIEW_W + HULL_R && y > -HULL_R && y < VIEW_H + HULL_R) return;
    const cx = Math.max(pad, Math.min(VIEW_W - pad, x));
    const cy = Math.max(pad, Math.min(VIEW_H - pad, y));
    const ang = Math.atan2(y - cy, x - cx);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = m.color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-8, -9);
    ctx.lineTo(-8, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Dusk over a mountain range: gradient sky, a low sun, two ridges, haze and a faint dot grid for speed cues. */
function paintBackdrop(w: number, h: number, s: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#10142c");
  sky.addColorStop(0.45, "#2a2552");
  sky.addColorStop(0.78, "#7a3a62");
  sky.addColorStop(1, "#d0674f");
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // sun
  const sx = w * 0.7;
  const sy = h * 0.8;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
  glow.addColorStop(0, "rgba(255,190,120,0.55)");
  glow.addColorStop(0.25, "rgba(255,140,100,0.18)");
  glow.addColorStop(1, "rgba(255,120,100,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  g.fillStyle = "#ffd29a";
  g.beginPath();
  g.arc(sx, sy, h * 0.07, 0, Math.PI * 2);
  g.fill();

  // stars in the upper sky (fixed pattern)
  g.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 70; i++) {
    const x = ((i * 7919) % 997) / 997;
    const y = ((i * 104729) % 991) / 991;
    const r = (0.6 + ((i * 31) % 10) / 10) * s;
    g.globalAlpha = 0.25 + ((i * 17) % 10) / 20;
    g.fillRect(x * w, y * h * 0.45, r, r);
  }
  g.globalAlpha = 1;

  // ridges
  const ridge = (base: number, amp: number, color: string, seed: number) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4 * s) {
      const t = x / w;
      const y =
        base -
        amp *
          (0.55 * Math.abs(Math.sin(t * 5.1 + seed)) + 0.3 * Math.abs(Math.sin(t * 13.7 + seed * 2)) + 0.15 * Math.sin(t * 31 + seed * 3));
      g.lineTo(x, y * h);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
  };
  ridge(0.86, 0.2, "#3a2550", 1.3);
  ridge(0.94, 0.16, "#21173a", 4.1);
  const haze = g.createLinearGradient(0, h * 0.75, 0, h);
  haze.addColorStop(0, "rgba(16,12,30,0)");
  haze.addColorStop(1, "rgba(16,12,30,0.75)");
  g.fillStyle = haze;
  g.fillRect(0, h * 0.75, w, h * 0.25);

  // faint dot grid, so speed reads with a fixed camera
  g.fillStyle = "rgba(255,255,255,0.05)";
  const step = 48 * s;
  const r = Math.max(1, s * 1.2);
  for (let y = step / 2; y < h; y += step) for (let x = step / 2; x < w; x += step) g.fillRect(x - r / 2, y - r / 2, r, r);

  // vignette
  const v = g.createRadialGradient(w / 2, h / 2, h * 0.35, w / 2, h / 2, h * 0.95);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.45)");
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  return c;
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    if (i === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
