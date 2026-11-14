// Canvas 2D drawing for the fight: simple vector shapes drawn from the real collision meshes,
// interpolated between 50 Hz physics steps.

import type { Body } from "./engine.ts";
import { type Arena, lerpBody, type Machine, type Tag, VIEW_H, VIEW_W } from "./sim.ts";
import { MONSTER_LOOK } from "./monsters.ts";
import { MACHINE, type Material, PLATES, WEAPONS } from "./weapons.ts";

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

    // monsters first (behind the machines), then the machines' trails, weapons and hulls
    for (const m of arena.machines) if (m.monster && (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m)))) this.creature(arena, m, alpha);
    for (const m of arena.machines) if (!m.monster) this.trail(m, alpha, fx);
    for (const m of arena.machines) if (!m.monster) this.weapon(m, alpha);
    // a wreck that has faded out (or left play) draws nothing: skip its paths entirely
    for (const m of arena.machines) if (!m.monster && (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m)))) this.machine(arena, m, alpha);
    if (arena.shots.length) this.shots(arena, alpha);
    this.plates(arena, alpha);

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
    const spec = m.spec;

    // Ropes and chains: a line between the anchors of every rope joint (the hull one only while armed). One path per
    // colour, so a whole chain is a single stroke. Type 0 joints (the dual sets' spacers) are not drawn.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2.5;
    for (const color of ROPE_COLORS) {
      let any = false;
      for (const j of spec.joints) {
        if (j.type === 2 || j.type === 0) continue;
        if (j.a === "hull" && !m.armed) continue;
        const a = j.a === "hull" ? m.hull : m.part.get(j.a);
        const b = m.part.get(j.b);
        if (!a || !b || ropeColor((b.data as Tag).spec?.material ?? "iron") !== color) continue;
        if (!any) {
          ctx.beginPath();
          any = true;
        }
        worldAt(a, j.sax ?? 0, j.say ?? 0, alpha);
        ctx.moveTo(scratch[0], scratch[1]);
        worldAt(b, j.sbx ?? 0, j.sby ?? 0, alpha);
        ctx.lineTo(scratch[0], scratch[1]);
      }
      if (any) {
        ctx.strokeStyle = color;
        ctx.stroke();
      }
    }

    // Chain links: one path for all the links of a chain, with the corners worked out here. A save, transform, stroke
    // and restore per link made the chain weapons the slowest sets on the TV (up to 10 links a weapon).
    let linkFill: string | null = null;
    for (const b of m.parts) {
      const part = (b.data as Tag).spec!;
      if (part.look !== "link") continue;
      const fill = PALETTE[part.material].fill;
      if (linkFill === null) {
        linkFill = fill;
        ctx.beginPath();
      } else if (fill !== linkFill) continue; // another colour: drawn on its own below
      const [x, y, a] = lerpBody(b, alpha);
      const c = Math.cos(a);
      const s = Math.sin(a);
      // the 10 × 6 link outline, corner by corner
      ctx.moveTo(x - 5 * c + 3 * s, y - 5 * s - 3 * c);
      ctx.lineTo(x + 5 * c + 3 * s, y + 5 * s - 3 * c);
      ctx.lineTo(x + 5 * c - 3 * s, y + 5 * s + 3 * c);
      ctx.lineTo(x - 5 * c - 3 * s, y - 5 * s + 3 * c);
      ctx.closePath();
    }
    if (linkFill !== null) {
      ctx.strokeStyle = linkFill;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const b of m.parts) {
      const part = (b.data as Tag).spec!;
      if (part.look === "link" && PALETTE[part.material].fill === linkFill && !(m.armed && part.rod)) continue;
      const [bx, by, ba] = lerpBody(b, alpha);
      const { minX, maxX, maxY } = bounds(b);
      if (m.armed && part.rod) {
        // the shaft from the machine to the part's back end
        ctx.strokeStyle = part.material === "silver" ? "#b9c0cc" : "#8a6a4a";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(bx + Math.cos(ba) * minX, by + Math.sin(ba) * minX);
        ctx.stroke();
      }
      const pal = PALETTE[part.material];
      this.enter(b, alpha);
      if (part.look === "hammer") {
        // spikes on both striking faces and the top, sized to the head
        ctx.fillStyle = "#c9ced8";
        const step = Math.max(4, maxX * 0.6);
        // all 7 spikes in one fill
        ctx.beginPath();
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          for (let off = -step; off <= step + 0.01; off += step) {
            ctx.moveTo(off - 3, sgn * maxY);
            ctx.lineTo(off, sgn * (maxY + 7));
            ctx.lineTo(off + 3, sgn * maxY);
            ctx.closePath();
          }
        }
        ctx.moveTo(maxX, -4);
        ctx.lineTo(maxX + 8, 0);
        ctx.lineTo(maxX, 4);
        ctx.fill();
        this.solid(b, pal);
      } else if (part.look === "mallet") {
        this.solid(b, pal);
        // two dark bands round the wooden head
        ctx.fillStyle = pal.stroke;
        ctx.fillRect(minX, -maxY * 0.62, maxX - minX, 2.5);
        ctx.fillRect(minX, maxY * 0.62 - 2.5, maxX - minX, 2.5);
      } else if (part.look === "axe") {
        this.solid(b, pal);
        // the cutting edge (the mesh edges on the local y < 0 side) shines; a stroke, no clipping
        ctx.strokeStyle = "#eef3fb";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < b.count; i++) {
          const k = (i + 1) % b.count;
          if (b.ly[i]! > 0.5 || b.ly[k]! > 0.5) continue;
          ctx.moveTo(b.lx[i]!, b.ly[i]!);
          ctx.lineTo(b.lx[k]!, b.ly[k]!);
        }
        ctx.stroke();
      } else if (part.look === "blade") {
        this.solid(b, pal, 1.5);
        ctx.strokeStyle = "rgba(90,100,120,0.55)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(minX + 3, 0);
        ctx.lineTo(maxX - 6, 0);
        ctx.stroke();
        ctx.fillStyle = "#b8893e";
        ctx.fillRect(minX - 3, -maxY - 3, 4, maxY * 2 + 6);
      } else if (part.look === "spike") {
        // a bladed chain link: an iron block with a spike on each side
        ctx.fillStyle = "#c9ced8";
        ctx.beginPath();
        ctx.moveTo(-3, -maxY);
        ctx.lineTo(0, -maxY - 6);
        ctx.lineTo(3, -maxY);
        ctx.moveTo(-3, maxY);
        ctx.lineTo(0, maxY + 6);
        ctx.lineTo(3, maxY);
        ctx.fill();
        this.solid(b, pal, 1.5);
      } else if (part.look === "link") {
        if (pal.fill === linkFill) {
          // in the batched chain path already (only reached for a link on a rod)
          ctx.restore();
          continue;
        }
        ctx.strokeStyle = pal.fill;
        ctx.lineWidth = 2;
        ctx.strokeRect(-5, -3, 10, 6);
      } else if (part.look === "handle") {
        ctx.fillStyle = pal.fill;
        this.mesh(b);
        ctx.fill();
      } else if (part.look === "gun") {
        this.solid(b, pal, 1.5);
        // the barrel, out along local +x (where it shoots), with a dark muzzle
        ctx.fillStyle = "#4a505c";
        ctx.fillRect(0, -3, maxX + 7, 6);
        ctx.fillStyle = "#15171c";
        ctx.fillRect(maxX + 4, -2, 3, 4);
      } else {
        const r = Math.max(maxX, maxY);
        if (part.material !== "wood") {
          ctx.fillStyle = part.material === "silver" ? "#eef2fa" : "#c9ced8";
          // the 8 spikes in one fill
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
            ctx.moveTo(Math.cos(t - 0.25) * r * 0.92, Math.sin(t - 0.25) * r * 0.92);
            ctx.lineTo(Math.cos(t) * (r + 6), Math.sin(t) * (r + 6));
            ctx.lineTo(Math.cos(t + 0.25) * r * 0.92, Math.sin(t + 0.25) * r * 0.92);
            ctx.closePath();
          }
          ctx.fill();
        }
        if (part.material === "stone") {
          if (!this.ballGrad) {
            this.ballGrad = ctx.createRadialGradient(-4, -4, 2, 0, 0, 13);
            this.ballGrad.addColorStop(0, "#7d8494");
            this.ballGrad.addColorStop(1, "#2f333d");
          }
          ctx.fillStyle = this.ballGrad;
          this.mesh(b);
          ctx.fill();
        } else {
          this.solid(b, pal);
          if (part.material === "wood") {
            ctx.strokeStyle = pal.stroke;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }

  /** Shield plates: on a short rod while attached, then falling debris. */
  private plates(arena: Arena, alpha: number): void {
    const ctx = this.ctx;
    for (const b of arena.world.bodies) {
      const t = b.data as Tag | null;
      if (!t?.plate) continue;
      const pal = PALETTE[PLATES[t.plate].material];
      if (!t.loose && t.m.alive) {
        const [hx, hy] = lerpBody(t.m.hull, alpha);
        const [bx, by] = lerpBody(b, alpha);
        ctx.strokeStyle = "#8a6a4a";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      this.enter(b, alpha);
      this.solid(b, pal, 1.5);
      // rivets
      const { maxX, maxY } = bounds(b);
      ctx.fillStyle = pal.stroke;
      for (const sy of [-1, 1]) ctx.fillRect(-1.5, sy * (maxY - 5) - 1.5, 3, 3);
      ctx.fillRect(maxX - 4, -1.5, 3, 3);
      ctx.restore();
    }
  }

  /** Bullets as short tracers along their path (one stroke for all), mortar balls as dark balls. */
  private shots(arena: Arena, alpha: number): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#ffe9a8";
    ctx.lineWidth = 3;
    ctx.beginPath();
    let lines = false;
    for (const sh of arena.shots) {
      if (sh.look !== "bullet") continue;
      const [x, y] = lerpBody(sh.body, alpha);
      const b = sh.body;
      // a tail half a step long, against the direction of flight
      ctx.moveTo(x, y);
      ctx.lineTo(x - b.vx * 0.012, y - b.vy * 0.012);
      lines = true;
    }
    if (lines) ctx.stroke();
    ctx.fillStyle = "#2b2f38";
    ctx.strokeStyle = "#ffb347";
    ctx.lineWidth = 1.5;
    // rockets: a body with a flame behind
    for (const sh of arena.shots) {
      if (sh.look !== "rocket") continue;
      const [x, y] = lerpBody(sh.body, alpha);
      const a = Math.atan2(sh.body.vy, sh.body.vx);
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.strokeStyle = "#ff8a2a";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - c * 6, y - s * 6);
      ctx.lineTo(x - c * (14 + Math.random() * 8), y - s * (14 + Math.random() * 8));
      ctx.stroke();
      ctx.strokeStyle = "#c9ced8";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(x - c * 7, y - s * 7);
      ctx.lineTo(x + c * 7, y + s * 7);
      ctx.stroke();
    }
    ctx.fillStyle = "#2b2f38";
    ctx.strokeStyle = "#ffb347";
    ctx.lineWidth = 1.5;
    for (const sh of arena.shots) {
      if (sh.look !== "ball") continue;
      const [x, y] = lerpBody(sh.body, alpha);
      ctx.beginPath();
      ctx.arc(x, y, sh.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** A monster (worm): segments tail to head as rounded capsules, a toothed jaw, a health bar. */
  private creature(arena: Arena, m: Machine, alpha: number): void {
    const ctx = this.ctx;
    const st = m.monster!;
    const look = MONSTER_LOOK[st.kind];
    const flash = m.flash > 0;
    ctx.globalAlpha = m.alive ? 1 : Math.max(0, 1 - (arena.t - m.diedAt) / 2.5);
    // tail first, so the head is on top
    for (let i = st.layout.parts.length - 1; i >= 0; i--) {
      const cp = st.layout.parts[i]!;
      if (cp.look !== "segment") continue;
      const b = st.part.get(cp.key);
      if (!b) continue;
      const { maxX, maxY } = bounds(b);
      this.enter(b, alpha);
      ctx.fillStyle = flash ? "#ffffff" : look.fill;
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, maxX * 1.15, maxY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // ridge, or armour plates
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = st.layout.armored ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(-maxX * 0.4, -maxY * 0.85);
      ctx.lineTo(-maxX * 0.4, maxY * 0.85);
      if (st.layout.armored) {
        ctx.moveTo(maxX * 0.4, -maxY * 0.85);
        ctx.lineTo(maxX * 0.4, maxY * 0.85);
      }
      ctx.stroke();
      ctx.restore();
    }
    // the jaw: a wedge with teeth pointing forward (+x), and an eye
    const jaw = st.part.get("jaw");
    if (jaw) {
      const { maxX, maxY } = bounds(jaw);
      this.enter(jaw, alpha);
      ctx.fillStyle = flash ? "#ffffff" : look.jaw;
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-maxX, -maxY);
      ctx.lineTo(maxX * 0.7, -maxY * 0.7);
      ctx.lineTo(maxX, 0);
      ctx.lineTo(maxX * 0.7, maxY * 0.7);
      ctx.lineTo(-maxX, maxY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#f4efe2";
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          const x = maxX * (0.15 + k * 0.25);
          ctx.moveTo(x - 3, sgn * maxY * 0.55);
          ctx.lineTo(x, sgn * maxY * 0.15);
          ctx.lineTo(x + 3, sgn * maxY * 0.55);
        }
      }
      ctx.fill();
      ctx.fillStyle = "#ffdf5d";
      ctx.beginPath();
      ctx.arc(-maxX * 0.35, -maxY * 0.45, Math.max(2, maxY * 0.18), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!m.alive) return;
    // health bar over the head
    const head = jaw ?? m.hull;
    const [x, y] = lerpBody(head, alpha);
    const w = 44;
    const frac = Math.max(0, m.hp / st.layout.hp);
    ctx.fillStyle = "rgba(10,12,20,0.6)";
    ctx.fillRect(x - w / 2 - 1, y - 34, w + 2, 6);
    ctx.fillStyle = "#ff8a3d";
    ctx.fillRect(x - w / 2, y - 33, w * frac, 4);
    if (m.stun > 0) {
      ctx.fillStyle = "#ffe066";
      for (let i = 0; i < 3; i++) {
        const t = arena.t * 7 + (i * Math.PI * 2) / 3;
        star(ctx, x + Math.cos(t) * 18, y - 42 + Math.sin(t) * 5, 4.5);
      }
    }
  }

  /** Fill and outline a body's mesh in a material. */
  private solid(b: Body, pal: { fill: string; stroke: string }, width = 2): void {
    const ctx = this.ctx;
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = pal.stroke;
    ctx.lineWidth = width;
    this.mesh(b);
    ctx.fill();
    ctx.stroke();
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

const PALETTE: Record<Material, { fill: string; stroke: string }> = {
  wood: { fill: "#9b6b3d", stroke: "#5e3d22" },
  iron: { fill: "#5b616e", stroke: "#3a3f4b" },
  stone: { fill: "#6c7280", stroke: "#3a3f4b" },
  silver: { fill: "#d6dce8", stroke: "#8d95a6" },
  steel: { fill: "#e6eaf2", stroke: "#7d8494" },
  gold: { fill: "#e3b341", stroke: "#8a6414" },
};

/** Output of worldAt (read it before the next call). */
const scratch: [number, number] = [0, 0];

/** A point in a body's local frame, in world px, blended between steps; written to `scratch`. */
function worldAt(b: Body, lx: number, ly: number, alpha: number): void {
  const [x, y, a] = lerpBody(b, alpha);
  const c = Math.cos(a);
  const s = Math.sin(a);
  scratch[0] = x + lx * c - ly * s;
  scratch[1] = y + lx * s + ly * c;
}

const ROPE_COLORS = ["#a07a50", "#cfd6e4", "#9aa1ae"];
const ropeColor = (m: Material) => (m === "wood" ? ROPE_COLORS[0]! : m === "silver" ? ROPE_COLORS[1]! : ROPE_COLORS[2]!);

/** A body's local mesh bounds; they never change, so they are worked out once. */
const boundsCache = new WeakMap<Body, { minX: number; maxX: number; maxY: number }>();
function bounds(b: Body): { minX: number; maxX: number; maxY: number } {
  let r = boundsCache.get(b);
  if (!r) {
    r = { minX: 0, maxX: 0, maxY: 0 };
    for (let i = 0; i < b.count; i++) {
      r.minX = Math.min(r.minX, b.lx[i]!);
      r.maxX = Math.max(r.maxX, b.lx[i]!);
      r.maxY = Math.max(r.maxY, Math.abs(b.ly[i]!));
    }
    boundsCache.set(b, r);
  }
  return r;
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
