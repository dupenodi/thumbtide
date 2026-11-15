// Canvas 2D drawing for the fight: simple vector shapes drawn from the real collision meshes,
// interpolated between 50 Hz physics steps.

import type { Body } from "./engine.ts";
import { type Arena, lerpBody, type Machine, type Tag, VIEW_H, VIEW_W } from "./sim.ts";
import { COIN_FADE, COIN_LOOK, Coins } from "./coins.ts";

/** The hull picture's box (world units): the 25×33 body plus its outline. */
const HULL_SW = 30;
const HULL_SH = 38;
/** Name label box: height and the text baseline from its top (world units). */
const NAME_H = 16;
const NAME_ASC = 12;

/** Spin widths in the coin atlas. */
const COIN_FRAMES = 6;
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
/** The rotor strip: frames, and the box one frame covers in the hull's frame (blade ±24 plus its round cap). */
const ROTOR_FRAMES = 8;
const ROTOR_W = 54;
const ROTOR_Y = -HULL_R - 12;
const ROTOR_H = 13;
/** Sparks fade in this many steps (each step of each colour is one stroke). */
const SPARK_LEVELS = 3;

export class Fx {
  sparks: Spark[] = [];
  floats: Float[] = [];
  shake = 0;
  /** At most this many sparks live at once (each is a separate stroke; a long grind could add hundreds). */
  /** Coins from hard hits (draw-only). */
  readonly coins: Coins;
  constructor(readonly maxSparks = 240, maxCoins = 90) {
    this.coins = new Coins(VIEW_W, VIEW_H, maxCoins, Math.min(30, maxCoins));
  }
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
  /** The world-to-canvas offset of this frame (the screen shake); the scale is `scale`. */
  private baseX = 0;
  private baseY = 0;
  /** Where solid() and mesh() paint: a sprite's canvas while one is painted, else the game canvas. */
  private pen: CanvasRenderingContext2D | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** skip: perf A/B only (the host passes it in perf builds): layers not to draw (sky, trails, weapons, machines, sparks, floats). */
    private opts: { maxDpr?: number; maxWidth?: number; names?: boolean; skip?: Set<string> } = {},
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
    const skip = this.opts.skip;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!skip?.has("sky")) this.sky();
    else {
      ctx.fillStyle = "#1a1f33";
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    const sh = fx.shake;
    this.baseX = (Math.random() - 0.5) * sh * s;
    this.baseY = (Math.random() - 0.5) * sh * s;
    ctx.setTransform(s, 0, 0, s, this.baseX, this.baseY);

    // monsters first (behind the machines), then the machines' trails, weapons and hulls
    for (const m of arena.machines) if (m.monster && (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m)))) this.creature(arena, m, alpha);
    if (!skip?.has("trails")) for (const m of arena.machines) if (!m.monster) this.trail(m, alpha, fx);
    if (!skip?.has("weapons")) for (const m of arena.machines) if (!m.monster) this.weapon(m, alpha);
    // a wreck that has faded out (or left play) draws nothing: skip its paths entirely
    if (!skip?.has("machines")) for (const m of arena.machines) if (!m.monster && (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m)))) this.machine(arena, m, alpha);
    if (arena.shots.length) this.shots(arena, alpha);
    this.plates(arena, alpha);
    if (fx.coins.list.length) this.coins(fx.coins);

    ctx.lineCap = "round";
    if (!skip?.has("sparks")) this.sparks(fx);
    if (!skip?.has("floats")) {
      // damage numbers: a cached picture each (outlined text cost the TV two text draws per number per frame)
      for (const f of fx.floats) {
        const t = this.textSprite(f.text, f.color, f.size);
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.drawImage(t.c, f.x - t.w / 2, f.y - t.asc, t.w, t.h);
      }
    }
    ctx.globalAlpha = 1;
    for (const m of arena.machines) this.offscreen(m, alpha);
  }

  /**
   * Sparks in a few strokes, not one each: grouped by colour and by one of SPARK_LEVELS brightness (and width)
   * steps of their remaining life. With 8 machines there were up to ~55 separate strokes a frame.
   */
  private sparkPaths = new Map<string, number[]>();
  private sparks(fx: Fx): void {
    const ctx = this.ctx;
    const groups = this.sparkPaths;
    for (const g of groups.values()) g.length = 0;
    for (const p of fx.sparks) {
      const k = p.life / p.max;
      const level = Math.min(SPARK_LEVELS - 1, Math.floor(k * SPARK_LEVELS));
      const key = `${p.color}|${p.w}|${level}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = []));
      g.push(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    }
    for (const [key, g] of groups) {
      if (!g.length) continue;
      const [color, w, lv] = key.split("|");
      const k = (Number(lv) + 0.5) / SPARK_LEVELS;
      ctx.strokeStyle = color!;
      ctx.globalAlpha = Math.min(1, k * 1.5);
      ctx.lineWidth = Number(w) * k + 0.5;
      ctx.beginPath();
      for (let i = 0; i < g.length; i += 4) {
        ctx.moveTo(g[i]!, g[i + 1]!);
        ctx.lineTo(g[i + 2]!, g[i + 3]!);
      }
      ctx.stroke();
    }
    if (groups.size > 64) groups.clear(); // colours come and go with players
  }

  private texts = new Map<string, { c: HTMLCanvasElement; w: number; h: number; asc: number }>();
  /** An outlined damage number (or word), drawn once per text, colour, size and scale. */
  private textSprite(text: string, color: string, size: number): { c: HTMLCanvasElement; w: number; h: number; asc: number } {
    if (this.textScale !== this.scale) {
      this.texts.clear();
      this.textScale = this.scale;
    }
    const key = `${text}|${color}|${size}`;
    let t = this.texts.get(key);
    if (t) return t;
    const s = this.scale;
    const font = `${size}px "Russo One", system-ui, sans-serif`;
    this.ctx.font = font;
    const w = Math.ceil(this.ctx.measureText(text).width) + 8;
    const h = Math.ceil(size * 1.3) + 6;
    const asc = Math.ceil(size * 0.95) + 3;
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * s);
    c.height = Math.ceil(h * s);
    const g = c.getContext("2d")!;
    g.scale(c.width / w, c.height / h);
    g.font = font;
    g.textAlign = "center";
    g.lineJoin = "round";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(10,12,20,0.85)";
    g.strokeText(text, w / 2, asc);
    g.fillStyle = color;
    g.fillText(text, w / 2, asc);
    t = { c, w, h, asc };
    // keep it once the font is in (else the fallback font would stick); if the font never loads, keep the
    // fallback after 120 misses rather than paint a new canvas for every number in every frame
    if ((document.fonts?.check?.(font) ?? true) || ++this.fontMisses > 120) {
      if (this.texts.size > 96) this.texts.clear();
      this.texts.set(key, t);
    }
    return t;
  }
  private textScale = 0;
  private fontMisses = 0;

  /** Coin pictures: 3 metals × COIN_FRAMES spin widths, painted once per scale (paths per coin cost the TV). */
  private coinAtlas: HTMLCanvasElement | null = null;
  private coinAtlasScale = 0;
  private coinCell = 0;

  /** Every coin is one drawImage from the atlas; the frame follows its spin (a flipping ellipse). */
  private coins(coins: Coins): void {
    const ctx = this.ctx;
    if (!this.coinAtlas || this.coinAtlasScale !== this.scale) this.paintCoins();
    const atlas = this.coinAtlas!;
    const cell = this.coinCell;
    for (const c of coins.list) {
      if (c.age > COIN_FADE - 1 && Math.floor(c.age * 8) % 2) continue; // blink out in the last second
      const r = c.big ? 6 : 4.5;
      const f = Math.min(COIN_FRAMES - 1, Math.floor(Math.abs(Math.cos(c.spin)) * COIN_FRAMES));
      ctx.drawImage(atlas, f * cell, c.metal * cell, cell, cell, c.x - r - 1, c.y - r - 1, 2 * r + 2, 2 * r + 2);
    }
  }

  private paintCoins(): void {
    const s = this.scale;
    // a cell holds a big coin (r 6) plus a 1 px margin, at the canvas's pixel scale
    const cell = Math.ceil(14 * s);
    const c = document.createElement("canvas");
    c.width = cell * COIN_FRAMES;
    c.height = cell * 3;
    const g = c.getContext("2d")!;
    const k = cell / 14;
    g.lineWidth = 1.2 * k;
    for (let metal = 0; metal < 3; metal++) {
      for (let f = 0; f < COIN_FRAMES; f++) {
        const rx = Math.max(0.8, 6 * ((f + 0.5) / COIN_FRAMES)) * k;
        g.beginPath();
        g.ellipse(f * cell + cell / 2, metal * cell + cell / 2, rx, 6 * k, 0, 0, Math.PI * 2);
        g.fillStyle = COIN_LOOK[metal]!.fill;
        g.fill();
        g.strokeStyle = COIN_LOOK[metal]!.rim;
        g.stroke();
      }
    }
    this.coinAtlas = c;
    this.coinAtlasScale = s;
    this.coinCell = cell;
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
    const ctx = this.pen ?? this.ctx;
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
    // two strokes, not one per segment (each stroke costs the TV): a faint thin tail and a brighter, wider head
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const half = pts.length >> 1;
    ctx.globalAlpha = 0.14 * k0;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i <= half; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
    ctx.globalAlpha = 0.3 * k0;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(pts[half]!.x, pts[half]!.y);
    for (let i = half + 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
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

    // Chain links: one path for all the links of a chain (the colour of the first link), with the corners worked out
    // here. A save, transform, stroke and restore per link made the chain weapons the slowest sets on the TV (up to
    // 10 links a weapon). The batch draws where the first link comes in the parts order, so the links stay above
    // the parts before them (a mace's handle) and below the parts after them.
    let linkFill: string | null = null;
    for (const b of m.parts) {
      const part = (b.data as Tag).spec!;
      if (part.look === "link") {
        linkFill = PALETTE[part.material].fill;
        break;
      }
    }
    let linksDrawn = false;
    const strokeLinks = () => {
      linksDrawn = true;
      ctx.beginPath();
      for (const b of m.parts) {
        const part = (b.data as Tag).spec!;
        if (part.look !== "link" || PALETTE[part.material].fill !== linkFill) continue; // another colour: drawn on its own
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
      ctx.strokeStyle = linkFill!;
      ctx.lineWidth = 2;
      ctx.stroke();
    };

    for (const b of m.parts) {
      const part = (b.data as Tag).spec!;
      if (part.look === "link" && PALETTE[part.material].fill === linkFill && !(m.armed && part.rod)) {
        if (!linksDrawn) strokeLinks();
        continue;
      }
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
      if (part.look === "link" && PALETTE[part.material].fill === linkFill) {
        // a link on a rod (none today): its shaft is drawn, the link itself goes in the batched chain path
        if (!linksDrawn) strokeLinks();
        continue;
      }
      // the part is one picture, painted once (paths cost the TV per frame; 8 machines of them took ~9 fps)
      const sp = this.partSprite(b, part);
      const c = Math.cos(ba) * this.scale;
      const sn = Math.sin(ba) * this.scale;
      ctx.setTransform(c, sn, -sn, c, bx * this.scale + this.baseX, by * this.scale + this.baseY);
      ctx.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
      ctx.setTransform(this.scale, 0, 0, this.scale, this.baseX, this.baseY);
    }
  }

  private parts = new WeakMap<Body, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
  private partScale = 0;
  /** A weapon part's picture in its own frame (origin at the body, +x along it), at the canvas's pixel scale. */
  private partSprite(b: Body, part: NonNullable<Tag["spec"]>): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
    if (this.partScale !== this.scale) {
      this.parts = new WeakMap();
      this.partScale = this.scale;
    }
    let sp = this.parts.get(b);
    if (sp) return sp;
    const { minX, maxX, maxY } = bounds(b);
    // room for the spikes, the tip, the guard and the barrel round the mesh (all within 8 px) plus the stroke
    const r = part.look === "hammer" || part.look === "mallet" || part.look === "axe" || part.look === "blade" || part.look === "spike" || part.look === "link" || part.look === "handle" || part.look === "gun" ? maxY : Math.max(maxX, maxY);
    const x = Math.min(minX, -r) - 10;
    const y = -r - 10;
    const w = Math.max(maxX, r) + 10 - x;
    const h = 2 * (r + 10);
    const s = this.scale;
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * s);
    c.height = Math.ceil(h * s);
    const g = c.getContext("2d")!;
    g.setTransform(c.width / w, 0, 0, c.height / h, (-x * c.width) / w, (-y * c.height) / h);
    g.lineJoin = "round";
    g.lineCap = "round";
    this.pen = g;
    try {
      this.paintPart(g, b, part);
    } finally {
      this.pen = null;
    }
    sp = { c, x, y, w, h };
    this.parts.set(b, sp);
    return sp;
  }

  /** Paints one weapon part in its own frame (the body's origin, +x along the part). */
  private paintPart(ctx: CanvasRenderingContext2D, b: Body, part: NonNullable<Tag["spec"]>): void {
    {
      const { minX, maxX, maxY } = bounds(b);
      const pal = PALETTE[part.material];
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
    const ctx = this.pen ?? this.ctx;
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
      // the rotor: one frame of a cached strip (blade width follows the spin)
      const spin = Math.abs(Math.sin(arena.t * 38 + m.id));
      const atlas = this.rotorAtlas();
      const f = Math.min(ROTOR_FRAMES - 1, Math.floor(spin * ROTOR_FRAMES));
      const cw = atlas.width / ROTOR_FRAMES;
      ctx.drawImage(atlas, f * cw, 0, cw, atlas.height, -ROTOR_W / 2, ROTOR_Y, ROTOR_W, ROTOR_H);
    }

    // the hull is one picture (body, shade, window), made once per colour and facing
    ctx.drawImage(this.hullSprite(m.flash > 0 ? "#ffffff" : m.alive ? m.color : "#3b3b44", m.hull.vx >= 0), -HULL_SW / 2, -HULL_SH / 2, HULL_SW, HULL_SH);
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

    // health bar: two rectangles (no paths); the name is a cached picture (text is slow on the TV)
    const w = 40;
    const frac = Math.max(0, m.hp / MACHINE.health);
    const by = y - HULL_R - 22;
    ctx.fillStyle = "rgba(10,12,20,0.6)";
    ctx.fillRect(x - w / 2 - 1, by, w + 2, 6);
    ctx.fillStyle = frac > 0.5 ? "#7dffa3" : frac > 0.2 ? "#ffd166" : "#ff5d73";
    ctx.fillRect(x - w / 2, by + 1, w * frac, 4);
    if (this.opts.names) {
      const label = this.nameSprite(m.name, m.color);
      ctx.drawImage(label.c, x - label.w / 2, by - 4 - NAME_ASC, label.w, NAME_H);
    }
  }

  private rotors: HTMLCanvasElement | null = null;
  private rotorScale = 0;
  /** The rotor in ROTOR_FRAMES spin widths side by side (disc, blade and mast), at the canvas's pixel scale. */
  private rotorAtlas(): HTMLCanvasElement {
    if (this.rotors && this.rotorScale === this.scale) return this.rotors;
    const cw = Math.ceil(ROTOR_W * this.scale);
    const ch = Math.ceil(ROTOR_H * this.scale);
    const c = document.createElement("canvas");
    c.width = cw * ROTOR_FRAMES;
    c.height = ch;
    const g = c.getContext("2d")!;
    for (let f = 0; f < ROTOR_FRAMES; f++) {
      // frame f stands for spins in [f, f+1) / ROTOR_FRAMES: draw its middle
      const spin = (f + 0.5) / ROTOR_FRAMES;
      g.setTransform(cw / ROTOR_W, 0, 0, ch / ROTOR_H, f * cw + cw / 2, (-ROTOR_Y * ch) / ROTOR_H);
      g.fillStyle = "rgba(220,225,240,0.10)";
      g.beginPath();
      g.ellipse(0, -HULL_R - 7, 24, 3, 0, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(220,225,240,0.7)";
      g.lineWidth = 3;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(-24 * spin, -HULL_R - 7);
      g.lineTo(24 * spin, -HULL_R - 7);
      g.stroke();
      g.fillStyle = "#3a3f4b";
      g.fillRect(-1.5, -HULL_R - 7, 3, 7);
    }
    this.rotors = c;
    this.rotorScale = this.scale;
    return c;
  }

  private hulls = new Map<string, HTMLCanvasElement>();
  private hullScale = 0;
  /** The hull (body, shade and window) for one colour and facing, at the canvas's pixel scale. */
  private hullSprite(fill: string, right: boolean): HTMLCanvasElement {
    if (this.hullScale !== this.scale) {
      this.hulls.clear();
      this.names.clear();
      this.hullScale = this.scale;
    }
    const key = `${fill}|${right ? 1 : 0}`;
    let c = this.hulls.get(key);
    if (c) return c;
    const s = this.scale;
    c = document.createElement("canvas");
    c.width = Math.ceil(HULL_SW * s);
    c.height = Math.ceil(HULL_SH * s);
    const g = c.getContext("2d")!;
    g.setTransform((c.width / HULL_SW), 0, 0, c.height / HULL_SH, (c.width / HULL_SW) * (HULL_SW / 2), (c.height / HULL_SH) * (HULL_SH / 2));
    g.fillStyle = fill;
    g.strokeStyle = "rgba(0,0,0,0.45)";
    g.lineWidth = 2.5;
    roundRect(g, -12.5, -16.5, 25, 33, 9);
    g.fill();
    g.stroke();
    g.fillStyle = "rgba(0,0,0,0.18)";
    roundRect(g, -12.5, 4, 25, 12.5, 6);
    g.fill();
    g.fillStyle = "rgba(225,240,255,0.9)";
    g.beginPath();
    g.ellipse(right ? 4 : -4, -6, 5.5, 4, 0, 0, Math.PI * 2);
    g.fill();
    if (this.hulls.size > 64) this.hulls.clear(); // colours come and go with players
    this.hulls.set(key, c);
    return c;
  }

  private names = new Map<string, { c: HTMLCanvasElement; w: number }>();
  /** A machine's name label (outlined text), drawn once per name, colour and scale. */
  private nameSprite(name: string, color: string): { c: HTMLCanvasElement; w: number } {
    if (this.hullScale !== this.scale) {
      this.hulls.clear();
      this.names.clear();
      this.hullScale = this.scale;
    }
    const key = `${name}|${color}`;
    let l = this.names.get(key);
    if (l) return l;
    const s = this.scale;
    const font = `11px "Russo One", system-ui, sans-serif`;
    const probe = this.ctx;
    probe.font = font;
    const w = Math.ceil(probe.measureText(name).width) + 6;
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * s);
    c.height = Math.ceil(NAME_H * s);
    const g = c.getContext("2d")!;
    g.scale(c.width / w, c.height / NAME_H);
    g.font = font;
    g.textAlign = "center";
    g.lineWidth = 3;
    g.strokeStyle = "rgba(10,12,20,0.8)";
    g.strokeText(name, w / 2, NAME_ASC);
    g.fillStyle = color;
    g.fillText(name, w / 2, NAME_ASC);
    l = { c, w };
    // keep it only once the font is in (else the fallback font would stick)
    if (document.fonts?.check?.(font) ?? true) {
      if (this.names.size > 64) this.names.clear();
      this.names.set(key, l);
    }
    return l;
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
