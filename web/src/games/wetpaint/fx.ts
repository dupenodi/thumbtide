// The juice over the painting: candy power-ups bobbing on the canvas, callouts that pop over the action
// ("DOUBLE SPLAT!", "TURBO!"), confetti bursts, shield bubbles, and the turpentine rag with its hazard stripe.
// DOM over the WebGL canvas, positioned each frame from the 3D view.
import { juicy, type JuicyTheme } from "../kit/juicy.ts";
import { candySvg, CANDY_COLORS } from "./candy.ts";
import type { PaintView } from "./paint/view.ts";
import { GRID_H, GRID_W, PAINTS, type PowerKind } from "./shared.ts";
import type { Sim } from "./sim.ts";

const CONFETTI_SHAPES = ["dot", "star", "bar", "drop"];

export function createFx(root: HTMLElement, view: PaintView) {
  const el = document.createElement("div");
  el.className = "fx";
  el.innerHTML = `<svg class="fx-band" style="display:none"><polygon/></svg><div class="fx-rag" hidden></div>`;
  root.appendChild(el);
  const band = el.querySelector(".fx-band") as SVGSVGElement;
  const poly = band.querySelector("polygon") as SVGPolygonElement;
  const rag = el.querySelector(".fx-rag") as HTMLElement;
  rag.innerHTML = RAG_SVG;

  const tokens = new Map<number, HTMLElement>();
  /** Recent callouts, so new ones stack above instead of on top of each other. */
  let recent: { x: number; y: number; at: number; h: number }[] = [];
  let alive: number[] = [];
  const bubbles = new Map<string, HTMLElement>();
  const vh = () => view.height / 100;

  function at(x: number, y: number, z: number) {
    return view.project(x, y, z);
  }

  function spawnEl(cls: string, html: string, x: number, y: number) {
    const e = document.createElement("div");
    e.className = cls;
    e.innerHTML = html;
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    el.appendChild(e);
    return e;
  }

  const api = {
    /** A callout over a spot on the canvas. */
    pop(x: number, z: number, text: string, theme: JuicyTheme, size: "s" | "m" | "l" | "xl" = "m", lift = 6) {
      const p = at(x, lift, z);
      const now = performance.now();
      // never a pile-up: with two callouts already up, only the big moments get through
      alive = alive.filter((t) => now - t < 1300);
      if (alive.length >= 2 && (size === "s" || size === "m")) return;
      alive.push(now);
      recent = recent.filter((r) => now - r.at < 700);
      const h = { s: 3.4, m: 5, l: 7, xl: 10 }[size] * vh();
      let y = p.y;
      for (let tries = 0; tries < 6; tries++) {
        const hit = recent.find((r) => Math.abs(r.x - p.x) < 22 * vh() && Math.abs(r.y - y) < (r.h + h) / 2);
        if (!hit) break;
        y = hit.y - (hit.h + h) / 2 - 0.5 * vh();
      }
      recent.push({ x: p.x, y, at: now, h });
      const e = spawnEl(`fx-pop ${size}`, juicy(text, theme), p.x, y);
      e.style.setProperty("--tilt", `${(Math.random() - 0.5) * 10}deg`);
      setTimeout(() => e.remove(), 1500);
    },

    /** Candy confetti flying out from a spot. */
    burst(x: number, z: number, colors: string[], n = 22, power = 1) {
      const p = at(x, 1, z);
      const ring = spawnEl("fx-ring", "", p.x, p.y);
      ring.style.setProperty("--c", colors[0] ?? "#fff");
      ring.style.setProperty("--s", String(power));
      setTimeout(() => ring.remove(), 700);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = (6 + Math.random() * 12) * vh() * power;
        const piece = spawnEl(`fx-bit ${CONFETTI_SHAPES[i % CONFETTI_SHAPES.length]}`, "", p.x, p.y);
        piece.style.setProperty("--dx", `${Math.cos(a) * d}px`);
        piece.style.setProperty("--dy", `${Math.sin(a) * d * 0.75 - 3 * vh()}px`);
        piece.style.setProperty("--r", `${(Math.random() - 0.5) * 720}deg`);
        piece.style.setProperty("--c", colors[i % colors.length]!);
        piece.style.animationDuration = `${600 + Math.random() * 500}ms`;
        setTimeout(() => piece.remove(), 1200);
      }
    },

    /** A power-up was grabbed: the candy pops. */
    took(pid: number, kind: PowerKind) {
      const t = tokens.get(pid);
      if (t) {
        t.classList.add("taken");
        tokens.delete(pid);
        setTimeout(() => t.remove(), 450);
      }
      return CANDY_COLORS[kind];
    },

    /** Left too long: it fizzles away. */
    gone(pid: number) {
      const t = tokens.get(pid);
      if (!t) return;
      t.classList.add("gone");
      tokens.delete(pid);
      setTimeout(() => t.remove(), 500);
    },

    update(sim: Sim, now: number) {
      // candies
      const live = new Set<number>();
      for (const p of sim.powers) {
        live.add(p.id);
        let t = tokens.get(p.id);
        if (!t) {
          t = document.createElement("div");
          t.className = "fx-token";
          t.innerHTML = `<div class="fx-sparkles"><i></i><i></i><i></i><i></i></div><div class="fx-candy">${candySvg(p.kind)}</div>`;
          el.appendChild(t);
          tokens.set(p.id, t);
        }
        const h = 5 + p.dropT * 45;
        const s = at(p.x, h, p.z);
        t.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        t.classList.toggle("falling", p.dropT > 0);
        t.classList.toggle("expiring", p.life < 3);
      }
      for (const [id, t] of tokens) {
        if (!live.has(id)) {
          t.remove();
          tokens.delete(id);
        }
      }

      // shield bubbles
      const shielded = new Set<string>();
      for (const b of sim.brushes.values()) {
        if (b.shieldT <= 0) continue;
        shielded.add(b.id);
        let bub = bubbles.get(b.id);
        if (!bub) {
          bub = document.createElement("div");
          bub.className = "fx-bubble";
          el.appendChild(bub);
          bubbles.set(b.id, bub);
        }
        const s = at(b.x, 5, b.z);
        bub.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        bub.style.setProperty("--c", PAINTS[b.slot]!.light);
        bub.classList.toggle("ending", b.shieldT < 1.5);
      }
      for (const [id, bub] of bubbles) {
        if (!shielded.has(id)) {
          bub.classList.add("pop");
          bubbles.delete(id);
          setTimeout(() => bub.remove(), 300);
        }
      }

      // turpentine: a hazard stripe where it's going, then the rag
      const w = sim.wipe;
      band.style.display = w ? "" : "none";
      rag.hidden = !w;
      if (w) {
        const half = w.width / 2;
        const lo = w.center - half;
        const hi = w.center + half;
        const len = w.axis === "x" ? GRID_W : GRID_H;
        const corner = (along: number, across: number) => (w.axis === "x" ? at(along, 0, across) : at(across, 0, along));
        const start = w.delay > 0 ? 0 : Math.max(0, Math.min(len, w.pos));
        const pts = [corner(start, lo), corner(len, lo), corner(len, hi), corner(start, hi)];
        poly.setAttribute("points", pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "));
        band.classList.toggle("warn", w.delay > 0);
        const edge = w.delay > 0 ? -2 + Math.sin(now / 60) * 0.6 : w.pos;
        const a = corner(edge, lo - 2);
        const b = corner(edge, hi + 2);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
        rag.style.width = `${length}px`;
        rag.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%) rotate(${ang}deg)`;
      }
    },

    clear() {
      for (const t of tokens.values()) t.remove();
      tokens.clear();
      for (const b of bubbles.values()) b.remove();
      bubbles.clear();
      for (const e of el.querySelectorAll(".fx-pop, .fx-bit, .fx-ring")) e.remove();
    },

    dispose() {
      el.remove();
    },
  };
  return api;
}

export type Fx = ReturnType<typeof createFx>;

// A linen rag, wet with turpentine, smeared with old colour, its frayed ends trailing.
const RAG_SVG = `<svg viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
  <defs>
    <linearGradient id="rag-g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fffaf0"/><stop offset=".45" stop-color="#efe5d0"/><stop offset="1" stop-color="#c4b596"/>
    </linearGradient>
    <linearGradient id="rag-wet" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="rgba(140,200,255,0)"/><stop offset="1" stop-color="rgba(140,200,255,.45)"/>
    </linearGradient>
  </defs>
  <path d="M10 18 C60 8 120 14 200 10 S340 8 390 16 L392 84 C340 94 260 88 200 92 S70 94 8 84 Z" fill="url(#rag-g)" stroke="#9c8c6c" stroke-width="3"/>
  <path d="M8 60 C70 66 140 58 200 64 S330 58 392 62 L392 84 C340 94 260 88 200 92 S70 94 8 84 Z" fill="url(#rag-wet)"/>
  <g fill="none" stroke="rgba(130,110,80,.35)" stroke-width="5" stroke-linecap="round">
    <path d="M60 16 C70 40 54 64 66 88"/><path d="M150 12 C162 40 144 66 156 90"/><path d="M250 11 C262 40 244 64 256 90"/><path d="M340 12 C350 38 334 62 346 86"/>
  </g>
  <ellipse cx="110" cy="46" rx="34" ry="12" fill="rgba(216,64,43,.55)"/>
  <ellipse cx="220" cy="54" rx="26" ry="10" fill="rgba(50,99,196,.5)"/>
  <ellipse cx="300" cy="40" rx="20" ry="8" fill="rgba(240,180,37,.65)"/>
  <ellipse cx="172" cy="34" rx="12" ry="6" fill="rgba(124,80,192,.5)"/>
  <path d="M14 26 C120 18 260 22 386 24" fill="none" stroke="rgba(255,255,255,.75)" stroke-width="5" stroke-linecap="round"/>
  <g stroke="#c4b596" stroke-width="3" stroke-linecap="round"><path d="M8 30 l-6 4 M8 46 l-7 2 M8 62 l-6 -2 M392 32 l6 4 M392 50 l7 1 M392 68 l6 -3"/></g>
</svg>`;
