// Canvas 2D drawing for the fight: simple vector shapes drawn from the real collision meshes,
// interpolated between 50 Hz physics steps.

import { type Body, wrapPi } from "./engine.ts";
import { type Arena, lerpBody, type Machine, type Tag, VIEW_H, VIEW_W } from "./sim.ts";
import { COIN_FADE, COIN_LOOK, Coins } from "./coins.ts";

/** The hull picture's box (world units): the 25×33 body plus its outline. */
const HULL_SW = 30;
const HULL_SH = 38;
/** Name label box: height and the text baseline from its top (world units). */
const NAME_H = 16;
const NAME_ASC = 12;
/** The health bar's width, and the name label's height with the bar's back (6) under the name (world units). */
const BAR_W = 40;
const LABEL_H = NAME_H + 6;

/** Spin widths in the coin atlas. */
const COIN_FRAMES = 6;
import { MONSTER_LOOK } from "./monsters.ts";
import { GUN_KINDS, MACHINE, type Material, type PartSpec, type PlateKind, PLATES, SIDEARMS, type WeaponKind, WEAPONS } from "./weapons.ts";

// ------------------------------------------------------------------ Hammerfight's weapon sprites
// One 320×440 atlas cut from weapons.dds, weapons2.dds, characters.dds and level.dds (media.script rects), with a map
// per weapon kind and part key: the atlas rect, the hotspot (= the body origin), the scale (1 sprite px = 1 mesh px;
// the big chains' first link 0.66), `shaft` when the sprite holds its own rod, and `cutL` to crop the shaft end
// under the hull. Until it has loaded (or for a part with no entry), parts are drawn from their meshes as before.
interface AtlasEntry { sx: number; sy: number; sw: number; sh: number; ox: number; oy: number; scale: number; shaft?: boolean; cutL?: number }
type AtlasMap = Record<string, Record<string, AtlasEntry>>;
const ATLAS_URL = Object.values(import.meta.glob("./sprites/weapons-atlas.png", { query: "?url", import: "default", eager: true }))[0] as string;
const ATLAS_MAP = Object.values(import.meta.glob("./sprites/weapons-atlas.json", { import: "default", eager: true }))[0] as AtlasMap;
let ATLAS_IMG: HTMLImageElement | null = null;
if (typeof Image !== "undefined" && ATLAS_URL) {
  const img = new Image();
  img.onload = () => (ATLAS_IMG = img);
  img.src = ATLAS_URL;
}
const atlasReady = () => ATLAS_IMG !== null;
/** The sidearm's gun kind from its GunSpec (the part is spread from SIDEARMS[kind].part). */
const gunOf = new Map(GUN_KINDS.map((k) => [SIDEARMS[k].part.gun!, k]));
function atlasEntry(kind: WeaponKind, part: PartSpec): AtlasEntry | undefined {
  if (part.key === "gun" && part.gun) {
    const g = gunOf.get(part.gun);
    if (g) return (ATLAS_MAP._guns as unknown as AtlasMap | undefined)?.[g]?.gun;
  }
  return ATLAS_MAP[kind]?.[part.key];
}
const plateEntry = (k: PlateKind): AtlasEntry | undefined => (ATLAS_MAP._plates as unknown as AtlasMap | undefined)?.[k]?.plate;

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  w: number;
  /** The colour and width as one key (render groups sparks by it). */
  group: string;
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
/** The rotor: spin frames, and the box it covers in the hull's frame (blade ±24 plus its round cap, top at ROTOR_Y). */
const ROTOR_FRAMES = 8;
const ROTOR_W = 54;
const ROTOR_Y = -HULL_R - 12;
/** Picture boxes in the hull's frame (x, y, w, h): the hull alone, and the hull with its rotor. */
const HULL_BOX = [-HULL_SW / 2, -HULL_SH / 2, HULL_SW, HULL_SH] as const;
const MACHINE_BOX = [-ROTOR_W / 2, ROTOR_Y, ROTOR_W, HULL_SH / 2 - ROTOR_Y] as const;
/** Sparks fade in this many steps (each step of each colour is one stroke). */
const SPARK_LEVELS = 3;
/** The stun star's picture box (world units): the 4.5 radius star with a margin for its smoothed edge. */
const STAR_BOX = 11;
const BAR_COLORS = ["#7dffa3", "#ffd166", "#ff5d73"] as const;
const barColor = (frac: number) => (frac > 0.5 ? BAR_COLORS[0] : frac > 0.2 ? BAR_COLORS[1] : BAR_COLORS[2]);

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
    const group = `${color}|${w}`;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const life = 0.18 + Math.random() * 0.35;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, color, w, group });
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
  /** Labels (names, health bars, damage numbers) grow with a zoomed-out arena, so they keep a readable size on the TV. */
  private lz = 1;

  /** The arena backdrop, painted once per size (the TV can't afford to paint it every frame). */
  private bg: HTMLCanvasElement | null = null;
  /** The mace ball's shading, made once (it's in the ball's local frame, so it fits every ball). */
  private ballGrad: CanvasGradient | null = null;
  /** The arena shown (world px); a bigger arena is a smaller scale, the same canvas. */
  private worldW = VIEW_W;
  private worldH = VIEW_H;
  /** The world-to-canvas offset of this frame (the screen shake); the scale is `scale`. */
  private baseX = 0;
  private baseY = 0;
  /** Where solid() and mesh() paint: a sprite's canvas while one is painted, else the game canvas. */
  private pen: CanvasRenderingContext2D | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    /** skip: perf A/B only (the host passes it in perf builds): layers not to draw (sky, trails, weapons = ropes + parts, machines = hulls + labels, plates, obstacles, coins, sparks, floats). sky also hides the static obstacles (they are painted into the cached backdrop, which also does not shake). */
    private opts: { maxDpr?: number; maxWidth?: number; names?: boolean; skip?: Set<string> } = {},
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxDpr ?? 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.min(Math.round(r.width * dpr), this.opts.maxWidth ?? 4096);
    this.canvas.width = w;
    this.canvas.height = Math.round((w * this.worldH) / this.worldW);
    this.scale = this.canvas.width / this.worldW;
    this.lz = Math.max(1, (this.worldW / VIEW_W) * 0.75);
    this.bgFor = -1; // repainted on the next draw, with the arena's theme and static obstacles
  }

  /** The arena layout (Arena.layout) the backdrop was painted for. */
  private bgFor = -1;

  draw(arena: Arena, alpha: number, fx: Fx): void {
    // a new arena size (between rounds): a new scale; the sprite caches follow the scale
    if (arena.w !== this.worldW || arena.h !== this.worldH) {
      this.worldW = arena.w;
      this.worldH = arena.h;
      this.resize();
    }
    // a new layout (between rounds): the themed sky with the pillars, ledges and floors painted in once
    if (this.bgFor !== arena.layout) {
      this.bgFor = arena.layout;
      const th = THEMES[arena.theme] ?? THEMES.dusk!;
      this.bg = paintBackdrop(this.canvas.width, this.canvas.height, this.scale, th);
      paintStatics(this.bg, arena, this.scale, th);
    }
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
    if (!skip?.has("trails")) {
      for (const m of arena.machines) if (!m.monster) this.trail(m, alpha, fx);
      this.trails();
    }
    if (!skip?.has("weapons")) for (const m of arena.machines) if (!m.monster) this.weapon(m, alpha);
    // a wreck that has faded out (or left play) draws nothing: skip its paths entirely
    if (!skip?.has("machines")) {
      if (!skip?.has("hulls")) {
        for (const m of arena.machines) if (!m.monster && (m.alive || (arena.t - m.diedAt < 2.5 && !arena.parked.has(m)))) this.machine(arena, m, alpha);
        this.leave();
      }
      if (!skip?.has("labels")) this.labels(arena, alpha);
    }
    if (arena.shots.length) this.shots(arena, alpha);
    if (!skip?.has("plates")) this.plates(arena, alpha);
    if (arena.obstacles.length && !skip?.has("obstacles")) this.obstacles(arena, alpha);
    if (fx.coins.list.length && !skip?.has("coins")) this.coins(fx.coins);

    ctx.lineCap = "round";
    if (!skip?.has("sparks")) this.sparks(fx);
    if (!skip?.has("floats")) {
      // damage numbers: a cached picture each (outlined text cost the TV two text draws per number per frame)
      for (const f of fx.floats) {
        const t = this.textSprite(f.text, f.color, f.size);
        const z = this.lz;
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.drawImage(t.c, f.x - (t.w * z) / 2, f.y - t.asc * z, t.w * z, t.h * z);
      }
    }
    ctx.globalAlpha = 1;
    for (const m of arena.machines) this.offscreen(m, alpha);
  }

  /**
   * Sparks in a few strokes, not one each: grouped by colour and by one of SPARK_LEVELS brightness (and width)
   * steps of their remaining life. With 8 machines there were up to ~55 separate strokes a frame.
   */
  /** Spark groups: per colour and width (Spark.group), one list of segments per brightness level. */
  private sparkPaths = new Map<string, { color: string; w: number; levels: number[][] }>();
  private sparks(fx: Fx): void {
    const ctx = this.ctx;
    const groups = this.sparkPaths;
    if (groups.size > 64) groups.clear(); // colours come and go with players
    for (const g of groups.values()) for (const l of g.levels) l.length = 0;
    for (const p of fx.sparks) {
      const k = p.life / p.max;
      const level = Math.min(SPARK_LEVELS - 1, Math.floor(k * SPARK_LEVELS));
      let g = groups.get(p.group);
      if (!g) groups.set(p.group, (g = { color: p.color, w: p.w, levels: Array.from({ length: SPARK_LEVELS }, () => []) }));
      g.levels[level]!.push(p.x, p.y, p.x - p.vx * 0.03, p.y - p.vy * 0.03);
    }
    for (const g of groups.values()) {
      for (let lv = 0; lv < SPARK_LEVELS; lv++) {
        const seg = g.levels[lv]!;
        if (!seg.length) continue;
        const k = (lv + 0.5) / SPARK_LEVELS;
        ctx.strokeStyle = g.color;
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.lineWidth = g.w * k + 0.5;
        ctx.beginPath();
        for (let i = 0; i < seg.length; i += 4) {
          ctx.moveTo(seg[i]!, seg[i + 1]!);
          ctx.lineTo(seg[i + 2]!, seg[i + 3]!);
        }
        ctx.stroke();
      }
    }
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
    const s = this.scale * this.lz;
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

  /**
   * Transform the context into a body's local frame; leave() goes back to the world frame. One setTransform each way,
   * not save, translate, rotate and restore (the TV pays for every recorded canvas call twice: in our JavaScript and
   * again when the browser plays the frame back). Nothing between enter() and leave() may count on restore().
   */
  private enter(b: Body, alpha: number): void {
    lerp(b, alpha);
    const s = this.scale;
    const c = Math.cos(L[2]) * s;
    const sn = Math.sin(L[2]) * s;
    this.ctx.setTransform(c, sn, -sn, c, L[0] * s + this.baseX, L[1] * s + this.baseY);
  }
  private leave(): void {
    this.ctx.setTransform(this.scale, 0, 0, this.scale, this.baseX, this.baseY);
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

  /** Moves a machine's swing trail on by one point, and draws it (or lists it for trails() at full brightness). */
  private trail(m: Machine, alpha: number, fx: Fx): void {
    // no weapon, no trail (after a pickup, `striker` still points at the weapon the taker now holds)
    if (!m.alive || !m.armed) {
      fx.trails.delete(m);
      return;
    }
    const b = m.striker;
    lerp(b, alpha);
    const { maxX } = bounds(b);
    let pts = fx.trails.get(m);
    if (!pts) fx.trails.set(m, (pts = []));
    // 9 points: the oldest one is reused for the newest
    const tip = pts.length >= 9 ? pts.shift()! : { x: 0, y: 0 };
    tip.x = L[0] + Math.cos(L[2]) * maxX;
    tip.y = L[1] + Math.sin(L[2]) * maxX;
    pts.push(tip);
    if (pts.length < 2) return;
    const speed = Math.hypot(b.vx, b.vy);
    const k0 = Math.min(1, Math.max(0, (speed - 200) / 500));
    if (k0 <= 0) return;
    if (k0 >= 1) this.fullTrails.push(pts);
    else {
      this.oneTrail[0] = pts;
      this.strokeTrails(this.oneTrail, k0);
    }
  }
  /** The trails at full brightness this frame (a fast swing; most trails in a melee), drawn together by trails(). */
  private fullTrails: { x: number; y: number }[][] = [];
  private oneTrail: { x: number; y: number }[][] = [];

  /** The full-brightness trails, all in one pair of strokes (fainter ones are drawn one by one, at their own alpha). */
  private trails(): void {
    if (this.fullTrails.length) this.strokeTrails(this.fullTrails, 1);
    this.fullTrails.length = 0;
  }

  /** Trails in two strokes: a faint thin tail and a brighter, wider head. */
  private strokeTrails(list: { x: number; y: number }[][], k0: number): void {
    const ctx = this.ctx;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#ffffff";
    {
      ctx.globalAlpha = 0.14 * k0;
      ctx.lineWidth = 4;
      ctx.beginPath();
      for (const pts of list) {
        const half = pts.length >> 1;
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i <= half; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.3 * k0;
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (const pts of list) {
        const half = pts.length >> 1;
        ctx.moveTo(pts[half]!.x, pts[half]!.y);
        for (let i = half + 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private weapon(m: Machine, alpha: number): void {
    const ctx = this.ctx;
    const spec = m.spec;

    // Ropes and chains: a line between the anchors of every rope joint (the hull one only while armed). One path per
    // colour, so a whole chain is a single stroke. Type 0 joints (the dual sets' spacers) are not drawn. (One path per
    // colour for all the machines was tried on the TV: no faster, and it put every rope under every weapon.)
    if (!this.opts.skip?.has("ropes")) {
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
    }
    if (this.opts.skip?.has("parts")) return;

    lerp(m.hull, alpha);
    const hx = L[0];
    const hy = L[1];

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
    /** The context is still in the last part's frame (set back only when a path comes, or at the end). */
    let local = false;
    const world = () => {
      if (local) ctx.setTransform(this.scale, 0, 0, this.scale, this.baseX, this.baseY);
      local = false;
    };
    const strokeLinks = () => {
      linksDrawn = true;
      world();
      ctx.beginPath();
      for (const b of m.parts) {
        const part = (b.data as Tag).spec!;
        if (part.look !== "link" || PALETTE[part.material].fill !== linkFill) continue; // another colour: drawn on its own
        lerp(b, alpha);
        const x = L[0];
        const y = L[1];
        const c = Math.cos(L[2]);
        const s = Math.sin(L[2]);
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
      lerp(b, alpha);
      const bx = L[0];
      const by = L[1];
      const ba = L[2];
      const { minX } = bounds(b);
      // an original sprite of a rod part holds its own shaft: no drawn line then
      if (m.armed && part.rod && !(atlasReady() && atlasEntry(spec.kind, part)?.shaft)) {
        // the shaft from the machine to the part's back end
        world();
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
      const sp = this.partSprite(b, part, spec.kind);
      const c = Math.cos(ba) * this.scale;
      const sn = Math.sin(ba) * this.scale;
      ctx.setTransform(c, sn, -sn, c, bx * this.scale + this.baseX, by * this.scale + this.baseY);
      ctx.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
      local = true;
    }
    world();
  }

  private parts = new WeakMap<Body, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
  private partScale = 0;
  /** Whether the part cache was made with the original sprites (it is remade once the atlas has loaded). */
  private partAtlas = false;
  /** A weapon part's picture in its own frame (origin at the body, +x along it), at the canvas's pixel scale. */
  private partSprite(b: Body, part: NonNullable<Tag["spec"]>, kind: WeaponKind): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
    if (this.partScale !== this.scale || this.partAtlas !== atlasReady()) {
      this.parts = new WeakMap();
      this.partShapes.clear();
      this.partScale = this.scale;
      this.partAtlas = atlasReady();
    }
    let sp = this.parts.get(b);
    if (sp) return sp;
    // the same part of the same set on a new body (every round respawns the weapons) reuses its picture: painting ~20
    // new canvases at each round start was a run of long frames on the TV (short Co-op vs monsters rounds most of all)
    const shape = `${kind}|${part.key}|${part.gun ? (gunOf.get(part.gun) ?? "?") : ""}|${part.look}|${part.material}|${Array.from(b.lx).join()}|${Array.from(b.ly).join()}`;
    sp = this.partShapes.get(shape);
    if (sp) {
      this.parts.set(b, sp);
      return sp;
    }
    sp = this.paintPartSprite(b, part, kind);
    if (this.partShapes.size > 160) this.partShapes.clear();
    this.partShapes.set(shape, sp);
    this.parts.set(b, sp);
    return sp;
  }
  /** Part pictures by weapon kind, part and mesh (see partSprite); cleared with the scale and the atlas. */
  private partShapes = new Map<string, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();

  private paintPartSprite(b: Body, part: NonNullable<Tag["spec"]>, kind: WeaponKind): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
    // Hammerfight's own picture of the part, from the atlas: hotspot = body origin, 1 sprite px = 1 mesh px
    const e = atlasEntry(kind, part);
    if (e && ATLAS_IMG) {
      const k = e.cutL ?? 0;
      const x = (k - e.ox) * e.scale;
      const y = -e.oy * e.scale;
      const w = (e.sw - k) * e.scale;
      const h = e.sh * e.scale;
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.ceil(w * this.scale));
      c.height = Math.max(1, Math.ceil(h * this.scale));
      c.getContext("2d")!.drawImage(ATLAS_IMG, e.sx + k, e.sy, e.sw - k, e.sh, 0, 0, c.width, c.height);
      return { c, x, y, w, h };
    }
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
    return { c, x, y, w, h };
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

  /**
   * The obstacles that change: crates (planks; cracks as they lose health), cages on their ropes and heavy blocks.
   * Pillars, ledges and floors never move or break: they are in the cached backdrop (staticObstacles).
   */
  private obstacles(arena: Arena, alpha: number): void {
    const ctx = this.ctx;
    const th = THEMES[arena.theme] ?? THEMES.dusk!;
    for (const o of arena.obstacles) {
      if (o.kind === "pillar" || o.kind === "ledge" || o.kind === "floor") continue;
      const { hw, hh } = o;
      if (o.kind === "block") {
        this.enter(o.body, alpha);
        this.solid(o.body, { fill: th.block, stroke: "rgba(0,0,0,0.5)" }, 2);
        this.leave();
        continue;
      }
      if (o.kind === "cage") {
        const b = o.body;
        if (o.rope) {
          worldAt(b, 0, -hh, alpha);
          ctx.strokeStyle = th.rope;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(o.rope.x, o.rope.y);
          ctx.lineTo(scratch[0], scratch[1]);
          ctx.stroke();
        }
        this.enter(b, alpha);
        ctx.fillStyle = "#2a1d10";
        ctx.fillRect(-hw, -hh, 2 * hw, 2 * hh);
        // bars, and fewer of them once it is half broken
        ctx.strokeStyle = o.hp < o.max * 0.5 ? "#6b4a26" : "#9a6b3a";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let k = 0; k <= 4; k++) {
          const px = -hw + (2 * hw * k) / 4;
          ctx.moveTo(px, -hh);
          ctx.lineTo(px, hh);
        }
        ctx.moveTo(-hw, -hh);
        ctx.lineTo(hw, -hh);
        ctx.moveTo(-hw, hh);
        ctx.lineTo(hw, hh);
        ctx.stroke();
        this.leave();
        continue;
      }
      const { x, y } = o.body;
      if (o.kind === "saw") {
        // one cached picture, turned: the spin is only drawn (the collider is a still octagon)
        const sp = this.sawSprite(hw);
        const a = arena.t * 9;
        const c = Math.cos(a) * this.scale;
        const sn = Math.sin(a) * this.scale;
        ctx.setTransform(c, sn, -sn, c, x * this.scale + this.baseX, y * this.scale + this.baseY);
        ctx.drawImage(sp, -hw - 2, -hw - 2, 2 * hw + 4, 2 * hw + 4);
        ctx.setTransform(this.scale, 0, 0, this.scale, this.baseX, this.baseY);
        continue;
      }
      ctx.fillStyle = "#3a2a18";
      ctx.fillRect(x - hw, y - hh, 2 * hw, 2 * hh);
      ctx.fillStyle = o.kind === "wall" ? "#8a6a42" : "#9a6b3a";
      ctx.fillRect(x - hw + 3, y - hh + 3, 2 * hw - 6, 2 * hh - 6);
      ctx.strokeStyle = "#5a3e20";
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (o.kind === "wall") {
        // a plank wall: iron bands across, cracks once it is half broken (one path, as a crate)
        for (let k = 1; k < 4; k++) {
          const py = y - hh + (2 * hh * k) / 4;
          ctx.moveTo(x - hw, py);
          ctx.lineTo(x + hw, py);
        }
        if (o.hp < o.max * 0.5) {
          ctx.moveTo(x - hw * 0.6, y - hh * 0.5);
          ctx.lineTo(x + hw * 0.4, y - hh * 0.1);
          ctx.lineTo(x - hw * 0.2, y + hh * 0.35);
        }
        ctx.stroke();
        continue;
      }
      // planks and the cross brace
      for (let k = 1; k < 3; k++) {
        const py = y - hh + (2 * hh * k) / 3;
        ctx.moveTo(x - hw + 3, py);
        ctx.lineTo(x + hw - 3, py);
      }
      ctx.moveTo(x - hw + 3, y - hh + 3);
      ctx.lineTo(x + hw - 3, y + hh - 3);
      // cracks once it is half broken
      if (o.hp < o.max * 0.5) {
        ctx.moveTo(x - hw * 0.2, y - hh);
        ctx.lineTo(x + hw * 0.1, y - hh * 0.2);
        ctx.lineTo(x - hw * 0.3, y + hh * 0.4);
      }
      ctx.stroke();
    }
  }

  private saws = new Map<number, HTMLCanvasElement>();
  private sawScale = 0;
  /** A saw disc of radius r (teeth, rim, hub), painted once per radius and scale at the canvas's pixel scale. */
  private sawSprite(r: number): HTMLCanvasElement {
    if (this.sawScale !== this.scale) {
      this.saws.clear();
      this.sawScale = this.scale;
    }
    let c = this.saws.get(r);
    if (c) return c;
    const R = r + 2;
    const k = this.scale;
    c = document.createElement("canvas");
    c.width = c.height = Math.ceil(2 * R * k);
    const g = c.getContext("2d")!;
    g.scale(k, k);
    g.translate(R, R);
    const n = 14;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = a0 + (0.8 / n) * Math.PI * 2;
      g.lineTo(Math.cos(a0) * r * 0.8, Math.sin(a0) * r * 0.8);
      g.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
    }
    g.closePath();
    g.fillStyle = "#c9d2dc";
    g.fill();
    g.strokeStyle = "#5a6470";
    g.lineWidth = 1.5;
    g.stroke();
    g.beginPath();
    g.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    g.fillStyle = "#8e98a4";
    g.fill();
    g.beginPath();
    g.arc(0, 0, r * 0.22, 0, Math.PI * 2);
    g.fillStyle = "#2b3038";
    g.fill();
    // a red warning band, so it reads as a hazard at a glance
    g.beginPath();
    g.arc(0, 0, r * 0.45, 0, Math.PI * 2);
    g.strokeStyle = "#d6452f";
    g.lineWidth = r * 0.12;
    g.stroke();
    this.saws.set(r, c);
    return c;
  }

  /** Shield plates: on a short rod while attached, then falling debris. */
  private plates(arena: Arena, alpha: number): void {
    const ctx = this.ctx;
    for (const b of arena.world.bodies) {
      const t = b.data as Tag | null;
      if (t?.gibUntil !== undefined) {
        // a wreck's shard: its colour while it can still hurt, then scorched grey
        this.enter(b, alpha);
        this.solid(b, { fill: t.wood ? "#9a6b3a" : arena.t < t.gibUntil ? t.m.color : "#4a4d57", stroke: "rgba(0,0,0,0.55)" }, 1.5);
        this.leave();
        continue;
      }
      if (!t?.plate) continue;
      // Hammerfight's plate picture (it holds its own struts): one drawImage from the atlas
      const e = ATLAS_IMG ? plateEntry(t.plate) : undefined;
      if (e) {
        this.enter(b, alpha);
        ctx.drawImage(ATLAS_IMG!, e.sx, e.sy, e.sw, e.sh, -e.ox * e.scale, -e.oy * e.scale, e.sw * e.scale, e.sh * e.scale);
        this.leave();
        continue;
      }
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
      this.leave();
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
    const flash = m.flash > 0;
    ctx.globalAlpha = m.alive ? 1 : Math.max(0, 1 - (arena.t - m.diedAt) / 2.5);
    // tail first, so the head is on top; each segment and the jaw is a cached picture (one drawImage, where the paths
    // were 3 to 4 fills and strokes each: a worm of 10 segments was ~35 path draws a frame on the TV)
    for (let i = st.layout.parts.length - 1; i >= 0; i--) {
      const cp = st.layout.parts[i]!;
      if (cp.look !== "segment") continue;
      const b = st.part.get(cp.key);
      if (!b) continue;
      const sp = this.creatureSprite(b, st.kind, st.layout.armored, flash, false);
      this.enter(b, alpha);
      ctx.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
    }
    const jaw = st.part.get("jaw");
    if (jaw) {
      const sp = this.creatureSprite(jaw, st.kind, st.layout.armored, flash, true);
      this.enter(jaw, alpha);
      ctx.drawImage(sp.c, sp.x, sp.y, sp.w, sp.h);
    }
    this.leave();
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
      const st = this.starSprite();
      const r = STAR_BOX / 2;
      for (let i = 0; i < 3; i++) {
        const t = arena.t * 7 + (i * Math.PI * 2) / 3;
        ctx.drawImage(st, x + Math.cos(t) * 18 - r, y - 42 + Math.sin(t) * 5 - r, 2 * r, 2 * r);
      }
    }
  }

  private creatures = new Map<string, { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }>();
  private creatureScale = 0;
  /**
   * A worm segment (a ridged or armoured ellipse) or its jaw (a toothed wedge with an eye) in the body's own frame, at
   * the canvas's pixel scale: made once per kind, size, armour and flash.
   */
  private creatureSprite(b: Body, kind: keyof typeof MONSTER_LOOK, armored: boolean, flash: boolean, jaw: boolean): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
    if (this.creatureScale !== this.scale) {
      this.creatures.clear();
      this.creatureScale = this.scale;
    }
    // worms come in random sizes: the picture is made for the size rounded to 1 px and stretched to the exact size when
    // drawn (outlines off by under 0.1 px), so a new worm mostly reuses pictures instead of making ~10 new canvases
    const b0 = bounds(b);
    const maxX = Math.max(1, Math.round(b0.maxX));
    const maxY = Math.max(1, Math.round(b0.maxY));
    const fx = b0.maxX / maxX;
    const fy = b0.maxY / maxY;
    const key = `${kind}|${jaw ? 1 : 0}|${armored ? 1 : 0}|${flash ? 1 : 0}|${maxX}|${maxY}`;
    let sp = this.creatures.get(key);
    if (sp) return this.stretch(sp, fx, fy);
    const look = MONSTER_LOOK[kind];
    // the shape's half sizes plus room for the outline (2) and its smoothed edge
    const hx = (jaw ? maxX : maxX * 1.15) + 3;
    const hy = maxY + 3;
    const s = this.scale;
    const c = document.createElement("canvas");
    c.width = Math.ceil(2 * hx * s);
    c.height = Math.ceil(2 * hy * s);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(c.width / (2 * hx), 0, 0, c.height / (2 * hy), c.width / 2, c.height / 2);
    if (!jaw) {
      ctx.fillStyle = flash ? "#ffffff" : look.fill;
      ctx.strokeStyle = look.stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, 0, maxX * 1.15, maxY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // ridge, or armour plates
      ctx.lineWidth = armored ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(-maxX * 0.4, -maxY * 0.85);
      ctx.lineTo(-maxX * 0.4, maxY * 0.85);
      if (armored) {
        ctx.moveTo(maxX * 0.4, -maxY * 0.85);
        ctx.lineTo(maxX * 0.4, maxY * 0.85);
      }
      ctx.stroke();
    } else {
      // the jaw: a wedge with teeth pointing forward (+x), and an eye
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
    }
    sp = { c, x: -hx, y: -hy, w: 2 * hx, h: 2 * hy };
    if (this.creatures.size > 128) this.creatures.clear();
    this.creatures.set(key, sp);
    return this.stretch(sp, fx, fy);
  }
  /** A cached creature picture's box stretched by (fx, fy), in a reused object (read it before the next call). */
  private stretched = { c: null as unknown as HTMLCanvasElement, x: 0, y: 0, w: 0, h: 0 };
  private stretch(sp: { c: HTMLCanvasElement; x: number; y: number; w: number; h: number }, fx: number, fy: number) {
    const o = this.stretched;
    o.c = sp.c;
    o.x = sp.x * fx;
    o.y = sp.y * fy;
    o.w = sp.w * fx;
    o.h = sp.h * fy;
    return o;
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
    this.enter(m.hull, alpha);
    if (!m.alive) ctx.globalAlpha = Math.max(0, 1 - (arena.t - m.diedAt) / 2.5);

    if (m.alive) {
      // hull and rotor in one picture: the rotor frame follows the spin (blade width), made once per colour, facing
      // and frame (a drawImage per machine less than a rotor strip and a hull)
      const spin = Math.abs(Math.sin(arena.t * 38 + m.id));
      const f = Math.min(ROTOR_FRAMES - 1, Math.floor(spin * ROTOR_FRAMES));
      const [x0, y0, bw, bh] = MACHINE_BOX;
      ctx.drawImage(this.hullSprite(m.flash > 0 ? "#ffffff" : m.color, m.hull.vx >= 0, f), x0, y0, bw, bh);
    } else {
      // the wreck: the hull alone, greyed (body, shade, window), made once per facing
      ctx.drawImage(this.hullSprite("#3b3b44", m.hull.vx >= 0), -HULL_SW / 2, -HULL_SH / 2, HULL_SW, HULL_SH);
    }
    // no leave(): the next machine sets its own frame; draw() leaves once after the last one
    ctx.globalAlpha = 1;
  }

  /**
   * Over the live machines: the stun stars, the health bars and the names. Each kind in one run with one fill colour
   * where it can (the bars' backs, then the bars by colour), not a colour change per machine, and the stars are a
   * cached picture (each was a 10-point path).
   */
  private labels(arena: Arena, alpha: number): void {
    const ctx = this.ctx;
    const live = this.live;
    live.length = 0;
    for (const m of arena.machines) if (m.alive && !m.monster) live.push(m);
    if (!live.length) return;
    const w = BAR_W;
    // Shock: stars circling over a machine whose engine is out.
    for (const m of live) {
      if (m.stun <= 0) continue;
      lerp(m.hull, alpha);
      const st = this.starSprite();
      const r = STAR_BOX / 2;
      ctx.globalAlpha = Math.min(1, m.stun * 3);
      for (let i = 0; i < 3; i++) {
        const t = arena.t * 7 + (i * Math.PI * 2) / 3;
        ctx.drawImage(st, L[0] + Math.cos(t) * 18 - r, L[1] - HULL_R - 2 + Math.sin(t) * 5 - r, 2 * r, 2 * r);
      }
      ctx.globalAlpha = 1;
    }
    // the names, with the health bars' backs under them: cached pictures (text is slow on the TV); all of the
    // labels grow with the arena's zoom-out (lz), so they keep their size on the screen
    const z = this.lz;
    const bw = w * z;
    if (this.opts.names) {
      for (const m of live) {
        lerp(m.hull, alpha);
        const label = this.nameSprite(m.name, m.color);
        ctx.drawImage(label.c, L[0] - (label.w * z) / 2, L[1] - HULL_R - (22 + NAME_H) * z, label.w * z, LABEL_H * z);
      }
    } else {
      ctx.fillStyle = "rgba(10,12,20,0.6)";
      for (const m of live) {
        lerp(m.hull, alpha);
        ctx.fillRect(L[0] - bw / 2 - z, L[1] - HULL_R - 22 * z, bw + 2 * z, 6 * z);
      }
    }
    // the health in the bars (rectangles, no paths), by colour
    for (const color of BAR_COLORS) {
      let set = false;
      for (const m of live) {
        const frac = Math.max(0, m.hp / MACHINE.health);
        if (barColor(frac) !== color) continue;
        if (!set) ctx.fillStyle = color;
        set = true;
        lerp(m.hull, alpha);
        ctx.fillRect(L[0] - bw / 2, L[1] - HULL_R - 21 * z, bw * frac, 4 * z);
      }
    }
  }
  private live: Machine[] = [];

  private stars: HTMLCanvasElement | null = null;
  private starScale = 0;
  /** The stun star (radius 4.5 in a STAR_BOX square) at the canvas's pixel scale. */
  private starSprite(): HTMLCanvasElement {
    if (this.stars && this.starScale === this.scale) return this.stars;
    const c = document.createElement("canvas");
    c.width = c.height = Math.ceil(STAR_BOX * this.scale);
    const g = c.getContext("2d")!;
    g.setTransform(c.width / STAR_BOX, 0, 0, c.height / STAR_BOX, c.width / 2, c.height / 2);
    g.fillStyle = "#ffe066";
    star(g, 0, 0, 4.5);
    this.stars = c;
    this.starScale = this.scale;
    return c;
  }

  private hulls = new Map<string, HTMLCanvasElement>();
  private hullScale = 0;
  /**
   * The hull (body, shade and window) for one colour and facing, at the canvas's pixel scale; with `rotor` (a frame of
   * the rotor strip) the rotor is painted in above it, in the MACHINE_BOX, so a live machine is one drawImage.
   */
  private hullSprite(fill: string, right: boolean, rotor = -1): HTMLCanvasElement {
    if (this.hullScale !== this.scale) {
      this.hulls.clear();
      this.names.clear();
      this.hullScale = this.scale;
    }
    const key = `${fill}|${right ? 1 : 0}|${rotor}`;
    let c = this.hulls.get(key);
    if (c) return c;
    const s = this.scale;
    const [x0, y0, bw, bh] = rotor >= 0 ? MACHINE_BOX : HULL_BOX;
    c = document.createElement("canvas");
    c.width = Math.ceil(bw * s);
    c.height = Math.ceil(bh * s);
    const g = c.getContext("2d")!;
    g.setTransform(c.width / bw, 0, 0, c.height / bh, (-x0 * c.width) / bw, (-y0 * c.height) / bh);
    if (rotor >= 0) {
      // the disc, the blade at the middle of this frame's spins ([f, f+1) / ROTOR_FRAMES) and the mast
      const spin = (rotor + 0.5) / ROTOR_FRAMES;
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
    if (this.hulls.size > 300) this.hulls.clear(); // colours come and go with players (18 pictures per colour)
    this.hulls.set(key, c);
    return c;
  }

  private names = new Map<string, { c: HTMLCanvasElement; w: number }>();
  /** A machine's name label (outlined text) over its health bar's back, drawn once per name, colour and scale. */
  private nameSprite(name: string, color: string): { c: HTMLCanvasElement; w: number } {
    if (this.hullScale !== this.scale) {
      this.hulls.clear();
      this.names.clear();
      this.hullScale = this.scale;
    }
    const key = `${name}|${color}`;
    let l = this.names.get(key);
    if (l) return l;
    const s = this.scale * this.lz;
    const font = `11px "Russo One", system-ui, sans-serif`;
    const probe = this.ctx;
    probe.font = font;
    // as wide as the name or the health bar's back, which is painted in under the name (one drawImage, not a fillRect more)
    const w = Math.max(Math.ceil(probe.measureText(name).width) + 6, BAR_W + 2);
    const c = document.createElement("canvas");
    c.width = Math.ceil(w * s);
    c.height = Math.ceil(LABEL_H * s);
    const g = c.getContext("2d")!;
    g.scale(c.width / w, c.height / LABEL_H);
    g.fillStyle = "rgba(10,12,20,0.6)";
    g.fillRect(w / 2 - BAR_W / 2 - 1, NAME_H, BAR_W + 2, 6);
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
    if (x > -HULL_R && x < this.worldW + HULL_R && y > -HULL_R && y < this.worldH + HULL_R) return;
    const cx = Math.max(pad, Math.min(this.worldW - pad, x));
    const cy = Math.max(pad, Math.min(this.worldH - pad, y));
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

/**
 * Arena colour themes (arenas.ts). dusk is ours; the others follow the day time and materials of the Hammerfight level
 * each arena comes from (LEVELS notes): sky stops top → bottom, the sun's glow, the two ridges, stone, its lit top,
 * wood (ledges), the heavy blocks and the cage ropes.
 */
interface Theme { sky: [string, string, string, string]; glow: string; sun: string | null; stars: boolean; ridges: [string, string]; stone: string; lit: string; wood: string; block: string; rope: string }
const THEMES: Record<string, Theme> = {
  dusk: { sky: ["#10142c", "#2a2552", "#7a3a62", "#d0674f"], glow: "255,190,120", sun: "#ffd29a", stars: true, ridges: ["#3a2550", "#21173a"], stone: "#4d5361", lit: "#666d7d", wood: "#7a5530", block: "#6b6e60", rope: "#8a8f99" },
  aria: { sky: ["#5f86c0", "#86a3c8", "#c9c09a", "#e3c98f"], glow: "255,240,200", sun: "#fff4d6", stars: false, ridges: ["#7d6a52", "#5e452a"], stone: "#5e452a", lit: "#c8b89a", wood: "#7a5530", block: "#6b6e60", rope: "#8a8f99" },
  sunrise: { sky: ["#2b2f5e", "#6a4a78", "#e6866a", "#f4c27a"], glow: "255,200,140", sun: "#ffe3a8", stars: true, ridges: ["#4a3a4a", "#2e2436"], stone: "#62553c", lit: "#a48a5e", wood: "#7a5530", block: "#6b6e60", rope: "#8a8f99" },
  hammerball: { sky: ["#3a0000", "#7a0a0a", "#ff7a00", "#ffd060"], glow: "255,200,90", sun: null, stars: false, ridges: ["#5a1a08", "#3a0c04"], stone: "#62553c", lit: "#8f7d58", wood: "#7a5530", block: "#55524a", rope: "#8a8f99" },
  "arena-night": { sky: ["#0b0b10", "#14121c", "#2a1e1a", "#4a3020"], glow: "255,176,96", sun: null, stars: true, ridges: ["#1e1814", "#120e0c"], stone: "#62553c", lit: "#9a8158", wood: "#6a4a26", block: "#55524a", rope: "#a08a6a" },
  "kadish-dusk": { sky: ["#3b2a4a", "#6a4058", "#a85a4e", "#c0704a"], glow: "255,170,110", sun: "#ffcf9a", stars: true, ridges: ["#4a3040", "#2e1e2a"], stone: "#5e452a", lit: "#8a6a44", wood: "#5e452a", block: "#6b6e60", rope: "#8a8f99" },
  "pit-night": { sky: ["#07070c", "#0e0d14", "#1a1512", "#2a1e14"], glow: "255,154,64", sun: null, stars: false, ridges: ["#1a1612", "#100d0b"], stone: "#4a4032", lit: "#6e5e46", wood: "#5a3e20", block: "#4a4a42", rope: "#8a8f99" },
};

/** The static obstacles (pillars, ledges, floors) and the decoration chains, painted once into the backdrop. */
function paintStatics(c: HTMLCanvasElement, arena: Arena, s: number, th: Theme): void {
  const g = c.getContext("2d")!;
  g.setTransform(s, 0, 0, s, 0, 0);
  for (const o of arena.obstacles) {
    if (o.kind !== "pillar" && o.kind !== "ledge" && o.kind !== "floor") continue;
    const { hw, hh } = o;
    g.save();
    g.translate(o.body.x, o.body.y);
    g.rotate(o.body.a);
    if (o.kind === "ledge") {
      // planks with a dark edge
      g.fillStyle = "#2a1d10";
      g.fillRect(-hw, -hh, 2 * hw, 2 * hh);
      g.fillStyle = th.wood;
      g.fillRect(-hw + 2, -hh + 2, 2 * hw - 4, 2 * hh - 4);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let x = -hw + 40; x < hw - 10; x += 40) g.fillRect(x, -hh + 2, 2, 2 * hh - 4);
    } else {
      g.fillStyle = th.stone;
      g.fillRect(-hw, -hh, 2 * hw, 2 * hh);
      g.fillStyle = th.lit;
      g.fillRect(-hw, -hh, 2 * hw, Math.min(5, hh));
      g.fillStyle = "rgba(0,0,0,0.25)";
      g.fillRect(-hw, hh - Math.min(5, hh), 2 * hw, Math.min(5, hh));
    }
    g.restore();
  }
  // hanging chains: links straight down (decoration; Hammerfight's chains never touch anything)
  g.strokeStyle = th.rope;
  g.lineWidth = 2;
  for (const ch of arena.chains) {
    g.beginPath();
    for (let y = 0; y < ch.len; y += 8) {
      g.moveTo(ch.x, ch.y + y);
      g.lineTo(ch.x, ch.y + y + 5);
    }
    g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

/** A themed sky (default: dusk over a mountain range): gradient, a low sun, two ridges, haze and a faint dot grid. */
function paintBackdrop(w: number, h: number, s: number, th: Theme = THEMES.dusk!): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, th.sky[0]);
  sky.addColorStop(0.45, th.sky[1]);
  sky.addColorStop(0.78, th.sky[2]);
  sky.addColorStop(1, th.sky[3]);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  // sun (or a glow without one)
  const sx = w * 0.7;
  const sy = h * 0.8;
  const glow = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
  glow.addColorStop(0, `rgba(${th.glow},0.55)`);
  glow.addColorStop(0.25, `rgba(${th.glow},0.18)`);
  glow.addColorStop(1, `rgba(${th.glow},0)`);
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);
  if (th.sun) {
    g.fillStyle = th.sun;
    g.beginPath();
    g.arc(sx, sy, h * 0.07, 0, Math.PI * 2);
    g.fill();
  }

  // stars in the upper sky (fixed pattern)
  g.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; th.stars && i < 70; i++) {
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
  ridge(0.86, 0.2, th.ridges[0], 1.3);
  ridge(0.94, 0.16, th.ridges[1], 4.1);
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
  lerp(b, alpha);
  const c = Math.cos(L[2]);
  const s = Math.sin(L[2]);
  scratch[0] = L[0] + lx * c - ly * s;
  scratch[1] = L[1] + lx * s + ly * c;
}

/** Output of lerp (read it before the next call). */
const L: [number, number, number] = [0, 0, 0];
/** lerpBody without a new array per call (it runs a few hundred times a frame): x, y and angle into `L`. */
function lerp(b: Body, alpha: number): void {
  L[0] = b.rx + (b.x - b.rx) * alpha;
  L[1] = b.ry + (b.y - b.ry) * alpha;
  L[2] = b.ra + wrapPi(b.a - b.ra) * alpha;
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
