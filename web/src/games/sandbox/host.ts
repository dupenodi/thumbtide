import type { Host } from "@thumbtide/sdk";
import { colorFor } from "../../config.ts";
import { isSys, type HostMount } from "../types.ts";
import type { SandboxGame } from "./shared.ts";

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  trail: { x: number; y: number }[];
}
interface Ring {
  x: number;
  y: number;
  r: number;
  color: string;
}

const SPEED = 0.9; // fraction of screen height per second at full stick
const TRAIL = 18;

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<SandboxGame>;
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
  ctx.root.appendChild(canvas);
  const g = canvas.getContext("2d")!;

  const dots = new Map<string, Dot>();
  const rings: Ring[] = [];
  const spawn = (): Dot => ({ x: 0.2 + Math.random() * 0.6, y: 0.2 + Math.random() * 0.6, vx: 0, vy: 0, trail: [] });

  const assignColors = () => {
    for (const p of host.players.values()) host.setOwn(p.id, { color: colorFor(p.index) });
  };
  assignColors();

  const offs = [
    host.on("join", assignColors),
    host.on("leave", (p) => dots.delete(p.id)),
    host.on("message", (p, d) => {
      if (isSys(d) || d?.type !== "pulse") return;
      const dot = dots.get(p.id);
      if (!dot) return;
      rings.push({ x: dot.x, y: dot.y, r: 0, color: colorFor(p.index) });
      host.send(p.id, { type: "buzz" });
    }),
  ];

  let w = 0;
  let h = 0;
  const resize = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener("resize", resize);

  let last = performance.now();
  let raf = 0;
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const aspect = w / h;

    // Simulate: input is a latest-wins snapshot we read every frame.
    for (const p of host.players.values()) {
      let d = dots.get(p.id);
      if (!d) dots.set(p.id, (d = spawn()));
      const inp = p.input ?? { x: 0, y: 0 };
      d.vx += (inp.x * SPEED - d.vx) * Math.min(1, dt * 10);
      d.vy += (inp.y * SPEED - d.vy) * Math.min(1, dt * 10);
      d.x = Math.max(0.02, Math.min(0.98, d.x + (d.vx * dt) / aspect));
      d.y = Math.max(0.03, Math.min(0.97, d.y + d.vy * dt));
      d.trail.push({ x: d.x, y: d.y });
      if (d.trail.length > TRAIL) d.trail.shift();
    }

    // Draw
    g.fillStyle = "#0b0b12";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffffff0d";
    g.lineWidth = 1;
    const step = h / 12;
    for (let x = (w % step) / 2; x < w; x += step) g.strokeRect(x, -1, 0, h + 2);
    for (let y = (h % step) / 2; y < h; y += step) g.strokeRect(-1, y, w + 2, 0);

    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]!;
      r.r += dt * h * 0.6;
      const alpha = 1 - r.r / (h * 0.35);
      if (alpha <= 0) {
        rings.splice(i, 1);
        continue;
      }
      g.globalAlpha = alpha;
      g.strokeStyle = r.color;
      g.lineWidth = 6;
      g.beginPath();
      g.arc(r.x * w, r.y * h, r.r, 0, Math.PI * 2);
      g.stroke();
    }
    g.globalAlpha = 1;

    const radius = h * 0.028;
    for (const p of host.players.values()) {
      const d = dots.get(p.id)!;
      const color = colorFor(p.index);
      d.trail.forEach((t, i) => {
        g.globalAlpha = (i / d.trail.length) * 0.35 * (p.connected ? 1 : 0.3);
        g.fillStyle = color;
        g.beginPath();
        g.arc(t.x * w, t.y * h, radius * (i / d.trail.length), 0, Math.PI * 2);
        g.fill();
      });
      g.globalAlpha = p.connected ? 1 : 0.3;
      g.fillStyle = color;
      g.beginPath();
      g.arc(d.x * w, d.y * h, radius, 0, Math.PI * 2);
      g.fill();
      g.font = `600 ${Math.round(h * 0.024)}px Inter, system-ui`;
      g.textAlign = "center";
      g.fillStyle = "#f4f3ff";
      g.fillText(p.connected ? p.name : `${p.name} (away)`, d.x * w, d.y * h - radius - 10);
      g.globalAlpha = 1;
    }

    g.font = `500 ${Math.round(h * 0.02)}px Inter, system-ui`;
    g.textAlign = "left";
    g.fillStyle = "#8d8ba7";
    g.fillText(
      `Sandbox · room ${host.code} · ${host.players.size} players · server ping ${Math.round(host.rtt)}ms · Esc for lobby`,
      h * 0.03,
      h * 0.05,
    );
  };
  raf = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(raf);
    removeEventListener("resize", resize);
    offs.forEach((o) => o());
  };
};

export default mount;
