// The ring on the TV, in three layers:
//  - sea: the indigo sea with its baked wave pattern, the whole screen, drawn once per size;
//  - ring: sand, straw rope and the start lines, drawn again only when the ring's radius changes (a rope pull);
//  - fx: cleared every frame, the size of the ring box only: shadows, wrestlers, names, speed lines, splashes.
// Every wrestler is a pre-baked body sprite (fixed light), a pre-baked face sprite (turned to where it looks) and a
// pre-baked soft shadow, so a frame is a few dozen drawImage calls.
import { isWebOS } from "../../shell/tv.ts";
import { INKS, LOOK, SANS } from "./look.ts";
import { BODY_R, RING_VIEW, type Seat, type Shove } from "./rules.ts";

/** Logical half-size of the ring box: the largest ring plus room for the rope and a splash. */
export const VIEW = RING_VIEW + 54;
const ROPE_W = 24;
const LINES_MS = 340;
const SPLASH_MS = 950;
const SINK_STEPS = 34;

interface Lines {
  id: string;
  a: number;
  t0: number;
}
interface Splash {
  x: number;
  y: number;
  t0: number;
}

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

export class RingView {
  readonly el: HTMLElement;
  private sea = document.createElement("canvas");
  private ring = document.createElement("canvas");
  private fx = document.createElement("canvas");
  private fctx: CanvasRenderingContext2D;
  /** CSS px per logical px, and backing px per CSS px. */
  scale = 1;
  private res = 1;
  private drawnR = -1;
  private sandTex: HTMLCanvasElement | null = null;
  private bodies: HTMLCanvasElement[] = [];
  private faces: HTMLCanvasElement[] = [];
  private shadow: HTMLCanvasElement | null = null;
  private labels = new Map<string, { key: string; c: HTMLCanvasElement }>();
  private lines: Lines[] = [];
  private splashes: Splash[] = [];
  /** Wrestlers whose splash has been made this round. */
  private splashed = new Set<string>();

  constructor(stage: HTMLElement) {
    this.sea.className = "shv-sea";
    stage.appendChild(this.sea);
    this.el = document.createElement("div");
    this.el.className = "shv-box";
    this.el.appendChild(this.ring);
    this.el.appendChild(this.fx);
    stage.appendChild(this.el);
    this.fctx = this.fx.getContext("2d")!;
  }

  /** The sea fills the stage; the ring box is `size` CSS px square, centred on (cx, cy). */
  layout(stageW: number, stageH: number, cx: number, cy: number, size: number) {
    const dpr = window.devicePixelRatio || 1;
    // the TV: never more than a 1920-wide backing store
    this.res = isWebOS ? Math.min(dpr, 1920 / Math.max(1, stageW)) : dpr;
    this.scale = size / (VIEW * 2);
    const left = Math.round(cx - size / 2);
    const top = Math.round(cy - size / 2);
    Object.assign(this.el.style, { left: `${left}px`, top: `${top}px`, width: `${Math.round(size)}px`, height: `${Math.round(size)}px` });
    this.sea.width = Math.round(stageW * this.res);
    this.sea.height = Math.round(stageH * this.res);
    for (const c of [this.ring, this.fx]) {
      c.width = Math.round(size * this.res);
      c.height = Math.round(size * this.res);
    }
    this.bakeSea(stageW, stageH, left + size / 2, top + size / 2);
    this.bakeSprites();
    this.labels.clear();
    this.drawnR = -1;
  }

  /** Fonts arrived: names are baked again with the right face. */
  fontsReady() {
    this.labels.clear();
  }

  /** Logical → backing px, origin at the ring centre. */
  private toLogical(ctx: CanvasRenderingContext2D) {
    const k = this.scale * this.res;
    const h = VIEW * k;
    ctx.setTransform(k, 0, 0, k, h, h);
  }

  // ------------------------------------------------------------------ baked art

  /** Seigaiha-like waves: rows of fans of concentric arcs, each row overlapping the one above. */
  private bakeSea(w: number, h: number, cx: number, cy: number) {
    const ctx = this.sea.getContext("2d")!;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.fillStyle = LOOK.indigo;
    ctx.fillRect(0, 0, w, h);
    const r = Math.max(30, Math.round(h * 0.042));
    ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.strokeStyle = LOOK.wave;
    for (let row = 0, y = -r; y < h + r * 2; row++, y += r * 0.5) {
      const off = row % 2 ? r : 0;
      for (let x = -2 * r + off; x < w + 2 * r; x += r * 2) {
        ctx.fillStyle = LOOK.indigo;
        ctx.beginPath();
        ctx.arc(x, y, r, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        for (const k of [1, 0.76, 0.52, 0.28]) {
          ctx.moveTo(x - r * k, y);
          ctx.arc(x, y, r * k, Math.PI, Math.PI * 2);
        }
        ctx.stroke();
      }
    }
    // a calm pool under the ring and a darker rim to the screen, so the waves stay behind the play
    const g = ctx.createRadialGradient(cx, cy, h * 0.32, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, "rgba(31, 42, 68, 0.55)");
    g.addColorStop(0.45, "rgba(31, 42, 68, 0)");
    g.addColorStop(1, "rgba(14, 19, 33, 0.55)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private bakeSprites() {
    const k = this.scale * this.res;
    // sand: flat colour with a light scatter of darker and lighter grains, as a repeating tile
    const T = 160;
    const sand = canvas(T, T);
    const sc = sand.getContext("2d")!;
    sc.fillStyle = LOOK.sand;
    sc.fillRect(0, 0, T, T);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 260; i++) {
      sc.fillStyle = rnd() < 0.7 ? "rgba(150, 120, 70, 0.22)" : "rgba(255, 250, 235, 0.45)";
      const s = 1 + rnd() * 1.6;
      sc.fillRect(rnd() * T, rnd() * T, s, s);
    }
    this.sandTex = sand;

    const S = Math.ceil((BODY_R + 6) * 2 * k);
    const mk = (draw: (c: CanvasRenderingContext2D) => void) => {
      const c = canvas(S, S);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(k, 0, 0, k, S / 2, S / 2);
      draw(ctx);
      return c;
    };
    // soft oval shadow: a radial gradient baked once
    this.shadow = mk((ctx) => {
      ctx.scale(1, 0.78);
      const g = ctx.createRadialGradient(0, 0, BODY_R * 0.5, 0, 0, BODY_R * 1.12);
      g.addColorStop(0, "rgba(20, 26, 44, 0.42)");
      g.addColorStop(1, "rgba(20, 26, 44, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, BODY_R * 1.12, 0, Math.PI * 2);
      ctx.fill();
    });
    // the body: flat colour, one darker crescent of shade (light from the top left), a dark outline
    this.bodies = INKS.map((ink) =>
      mk((ctx) => {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.arc(0, 0, BODY_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.clip();
        ctx.fillStyle = "rgba(10, 14, 30, 0.26)";
        ctx.beginPath();
        ctx.arc(0, 0, BODY_R, 0, Math.PI * 2);
        ctx.arc(-BODY_R * 0.2, -BODY_R * 0.24, BODY_R * 0.98, 0, Math.PI * 2, true);
        ctx.fill();
        // a woodblock highlight: one short pale stroke
        ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
        ctx.lineWidth = 4;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, BODY_R * 0.72, Math.PI * 1.08, Math.PI * 1.42);
        ctx.stroke();
        ctx.restore();
        ctx.strokeStyle = LOOK.ink;
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        ctx.arc(0, 0, BODY_R - 1, 0, Math.PI * 2);
        ctx.stroke();
      }),
    );
    // the face, looking along +x (its brow toward the middle of the body): a pale daruma face patch, two heavy
    // brows set in a scowl, two eyes
    this.faces = INKS.map(() =>
      mk((ctx) => {
        const R = BODY_R;
        const fx = R * 0.36;
        ctx.fillStyle = LOOK.foam;
        ctx.beginPath();
        ctx.ellipse(fx, 0, R * 0.46, R * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = LOOK.ink;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = LOOK.ink;
        ctx.strokeStyle = LOOK.ink;
        ctx.lineCap = "round";
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(fx + R * 0.1, side * R * 0.21, R * 0.095, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = R * 0.13;
          ctx.beginPath();
          ctx.moveTo(fx - R * 0.08, side * R * 0.07);
          ctx.lineTo(fx - R * 0.22, side * R * 0.36);
          ctx.stroke();
        }
        // a short mouth line toward the front edge
        ctx.lineWidth = R * 0.07;
        ctx.beginPath();
        ctx.moveTo(fx + R * 0.32, -R * 0.12);
        ctx.lineTo(fx + R * 0.32, R * 0.12);
        ctx.stroke();
      }),
    );
  }

  /** A name tag, baked once per name: foam letters on an indigo slip. */
  private label(s: Seat) {
    const key = `${s.name}|${s.slot}|${this.scale}`;
    const had = this.labels.get(s.id);
    if (had && had.key === key) return had.c;
    const px = 24 * this.res; // CSS px on a 1080p screen, at least
    const probe = canvas(1, 1).getContext("2d")!;
    const font = `700 ${px}px ${SANS}`;
    probe.font = font;
    const name = s.name.length > 14 ? `${s.name.slice(0, 13)}…` : s.name;
    const tw = Math.ceil(probe.measureText(name).width);
    const padX = Math.round(px * 0.5);
    const w = tw + padX * 2;
    const h = Math.round(px * 1.5);
    const c = canvas(w, h);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "rgba(20, 26, 44, 0.86)";
    const r = h / 2;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = LOOK.foam;
    ctx.textBaseline = "middle";
    ctx.fillText(name, padX, h * 0.54);
    this.labels.set(s.id, { key, c });
    return c;
  }

  private drawRing(R: number) {
    const ctx = this.ring.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.ring.width, this.ring.height);
    this.toLogical(ctx);
    // the surf line round the ring
    ctx.strokeStyle = LOOK.foam;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, R + ROPE_W / 2 + 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // sand, a little darker where it's trodden near the rope
    ctx.fillStyle = ctx.createPattern(this.sandTex!, "repeat")!;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = LOOK.sandDark;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(0, 0, R - ROPE_W / 2 - 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // the start lines
    ctx.fillStyle = LOOK.foam;
    const lineX = BODY_R + 84;
    if (R > lineX + ROPE_W * 1.5) for (const side of [-1, 1]) ctx.fillRect(side * lineX - 4, -30, 8, 60);
    // the straw rope: a fat band, its twists, and an inked edge either side
    ctx.strokeStyle = LOOK.rope;
    ctx.lineWidth = ROPE_W;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = LOOK.ropeDark;
    ctx.globalAlpha = 0.55;
    const twists = Math.max(24, Math.round((Math.PI * 2 * R) / 16));
    const len = (Math.PI * 2 * R) / twists;
    ctx.setLineDash([len * 0.28, len * 0.72]);
    ctx.lineWidth = ROPE_W - 6;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = LOOK.ink;
    ctx.lineWidth = 2.5;
    for (const e of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(0, 0, R + (e * ROPE_W) / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    this.drawnR = R;
  }

  // ------------------------------------------------------------------ events

  dash(id: string, a: number) {
    this.lines = this.lines.filter((l) => l.id !== id);
    this.lines.push({ id, a, t0: performance.now() });
  }

  clear() {
    this.lines = [];
    this.splashes = [];
    this.splashed.clear();
  }

  // ------------------------------------------------------------------ every frame

  /** `alpha` is how far we are between the last step and the next (0–1). */
  frame(game: Shove, alpha: number, now: number) {
    if (Math.abs(game.ringR - this.drawnR) > 0.25) this.drawRing(game.ringR);
    const ctx = this.fctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.fx.width, this.fx.height);
    if (game.phase === "wait") return;
    this.toLogical(ctx);
    const k = this.scale * this.res;
    const S = this.bodies[0]?.width ?? 1;
    const half = S / 2 / k;
    const size = S / k;
    const list = game.players();
    const pos = new Map<string, { x: number; y: number; a: number; s: number }>();
    for (const s of list) {
      // the splash comes as it clears the rope and meets the water
      if (!s.alive && s.outT >= 8 && !this.splashed.has(s.id)) {
        this.splashed.add(s.id);
        this.splashes.push({ x: s.x, y: s.y, t0: now });
      }
      const t = s.alive ? 0 : Math.min(1, s.outT / SINK_STEPS);
      if (t >= 1) continue;
      const x = s.px + (s.x - s.px) * alpha;
      const y = s.py + (s.y - s.py) * alpha;
      pos.set(s.id, { x, y, a: 1 - t, s: 1 - t * 0.35 });
    }
    // splashes sit on the water, under everything
    this.drawSplashes(ctx, now);
    for (const s of list) {
      const p = pos.get(s.id);
      if (!p || !this.shadow) continue;
      ctx.globalAlpha = p.a * (s.alive ? 1 : 0.5);
      ctx.drawImage(this.shadow, p.x + 5 - half * 1.04, p.y + 9 - half * 0.96, size * 1.04, size);
    }
    this.drawLines(ctx, game, pos, now);
    for (const s of list) {
      const p = pos.get(s.id);
      if (!p) continue;
      ctx.globalAlpha = p.a;
      const h = half * p.s;
      ctx.drawImage(this.bodies[s.slot]!, p.x - h, p.y - h, size * p.s, size * p.s);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(s.face);
      ctx.drawImage(this.faces[s.slot]!, -h, -h, size * p.s, size * p.s);
      ctx.restore();
    }
    // names above, on top of everyone; in a scrum (touching someone, once play is under way) a name steps back
    const scrum = game.phase === "play" && game.t > 90;
    for (const s of list) {
      const p = pos.get(s.id);
      if (!p || !s.alive) continue;
      let touching = false;
      if (scrum) {
        for (const o of list) {
          if (o === s || !o.alive) continue;
          const q = pos.get(o.id);
          if (q && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < (BODY_R * 2 + 8) ** 2) touching = true;
        }
      }
      ctx.globalAlpha = touching ? 0.35 : 1;
      const c = this.label(s);
      const w = c.width / k;
      const h = c.height / k;
      ctx.drawImage(c, p.x - w / 2, p.y - BODY_R - 10 - h, w, h);
    }
    ctx.globalAlpha = 1;
  }

  /** A dash leaves three speed lines behind, for a moment. */
  private drawLines(ctx: CanvasRenderingContext2D, game: Shove, pos: Map<string, { x: number; y: number }>, now: number) {
    if (!this.lines.length) return;
    this.lines = this.lines.filter((l) => now - l.t0 < LINES_MS);
    ctx.strokeStyle = LOOK.ink;
    ctx.lineCap = "round";
    ctx.lineWidth = 4;
    for (const l of this.lines) {
      const p = pos.get(l.id);
      const s = game.seats.get(l.id);
      if (!p || !s) continue;
      const k = (now - l.t0) / LINES_MS;
      ctx.globalAlpha = 0.6 * (1 - k);
      const c = Math.cos(l.a);
      const sn = Math.sin(l.a);
      ctx.beginPath();
      for (const [off, len] of [[-17, 34], [0, 52], [17, 34]] as const) {
        const L = len * (1 - 0.4 * k);
        const bx = p.x - c * (BODY_R + 10) - sn * off;
        const by = p.y - sn * (BODY_R + 10) + c * off;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx - c * L, by - sn * L);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A ring-out: one foam ripple spreading on the sea. */
  private drawSplashes(ctx: CanvasRenderingContext2D, now: number) {
    if (!this.splashes.length) return;
    this.splashes = this.splashes.filter((s) => now - s.t0 < SPLASH_MS);
    if (!this.splashes.length) return;
    // only on the water: clip the ring (and its rope) out
    ctx.save();
    ctx.beginPath();
    ctx.rect(-VIEW, -VIEW, VIEW * 2, VIEW * 2);
    ctx.arc(0, 0, this.drawnR + ROPE_W / 2, 0, Math.PI * 2, true);
    ctx.clip();
    ctx.strokeStyle = LOOK.foam;
    for (const s of this.splashes) {
      const k = (now - s.t0) / SPLASH_MS;
      const e = 1 - (1 - k) * (1 - k) * (1 - k);
      ctx.globalAlpha = 0.85 * (1 - k);
      ctx.lineWidth = 7 * (1 - k) + 1.5;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, 26 + 96 * e, (26 + 96 * e) * 0.82, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }
}
