// Draws the game: camera over the painter's table, the canvas, the brushes, pots, globs and loose paint, then
// the canvas finish. Holds no game state of its own beyond animation smoothing.
import * as THREE from "three";
import { GRID_H, GRID_W, PAINTS, PRIMER, TUNING } from "../shared.ts";
import type { Sim, SimEvent } from "../sim.ts";
import { MAX_BLOBS, MAX_POTS, createBlobs, createBrushes, createPots } from "./actors.ts";
import { PALETTE_SIZE, createCanvas, type PaletteUniforms } from "./canvas.ts";
import { createDecor } from "./decor.ts";
import { createFrame } from "./finish.ts";
import { MAX_CASTERS, createShared, hexVec } from "./glsl.ts";
import { createParticles } from "./particles.ts";

// Colours here are paint: written exactly as chosen, never converted or tone-mapped.
THREE.ColorManagement.enabled = false;

export type Quality = "high" | "low";

const HW = GRID_W / 2;
const HH = GRID_H / 2;
const FOV = 30;
const ELEVATION = THREE.MathUtils.degToRad(64);

function palettes(): PaletteUniforms {
  const list = [PRIMER, ...PAINTS];
  const extra: [string, string, string][] = [
    ["#fbf8f0", "#e6dfcf", "#b5ab98"], // 9 white
    ["#ffe28a", "#e3a93a", "#9a6418"], // 10 gold
    ["#e2dfd8", "#a4a096", "#57544d"], // 11 tin
  ];
  const all: [string, string, string][] = [...list.map((p) => [p.light, p.half, p.shade] as [string, string, string]), ...extra];
  if (all.length !== PALETTE_SIZE) throw new Error("palette size mismatch");
  return {
    uPalL: { value: all.map((p) => hexVec(p[0])) },
    uPalM: { value: all.map((p) => hexVec(p[1])) },
    uPalS: { value: all.map((p) => hexVec(p[2])) },
  };
}

interface BrushAnim {
  lean: number;
  bend: number;
  scale: number;
  spin: number;
  frost: number;
}

export class PaintView {
  readonly canvasEl: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 8, 900);
  private scene = new THREE.Scene();
  private shared = createShared();
  private frame: ReturnType<typeof createFrame>;
  private canvas: ReturnType<typeof createCanvas>;
  private brushes: ReturnType<typeof createBrushes>;
  private pots: ReturnType<typeof createPots>;
  private blobs: ReturnType<typeof createBlobs>;
  private particles: ReturnType<typeof createParticles>;
  private anim = new Map<string, BrushAnim>();
  private camBase = new THREE.Vector3();
  private camTarget = new THREE.Vector3(0, 0, 3);
  private shake = 0;
  private sweepT = -1;
  private cssW = 1;
  private cssH = 1;
  private maxScale: number;
  private minScale: number;
  private renderScale: number;
  /** The frame time the loop aims for (33ms when it's capped at 30fps on a TV). */
  targetMs = 1000 / 60;
  private slowFor = 0;
  private fastFor = 0;
  private frameMs = 1000 / 60;
  private resizeObs: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: Sim,
    quality: Quality = "high",
  ) {
    const high = quality === "high";
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x140e0a, 1);
    this.canvasEl = this.renderer.domElement;
    this.canvasEl.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    container.appendChild(this.canvasEl);

    this.maxScale = high ? Math.min(window.devicePixelRatio || 1, 1.5) : 0.75;
    this.minScale = high ? 0.5 : 0.35;
    this.renderScale = this.maxScale;
    const msaa = high;
    this.frame = createFrame(this.renderer, this.shared, { samples: msaa ? 4 : 0 });

    const pal = palettes();
    this.canvas = createCanvas(this.shared, pal, sim.cells, { perCell: high ? 2 : 1, msaa });
    this.scene.add(this.canvas.group);
    this.scene.add(createDecor());
    this.brushes = createBrushes(this.shared, pal);
    this.pots = createPots(this.shared, pal, { msaa });
    this.blobs = createBlobs(this.shared, pal, { msaa });
    this.particles = createParticles(this.shared, pal, { msaa, scale: high ? 1 : 0.6 });
    this.scene.add(this.brushes.group, this.pots.mesh, this.blobs.mesh, ...this.particles.meshes);

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
  }

  /** Arena coordinates (cells) + height → CSS pixels within the container. */
  project(x: number, y: number, z: number): { x: number; y: number } {
    const v = new THREE.Vector3(x - HW, y, z - HH).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.cssW, y: (-v.y * 0.5 + 0.5) * this.cssH };
  }

  /** Height of the view in CSS pixels. */
  get height() {
    return this.cssH;
  }

  /** Start the varnish sweep across the finished painting. */
  varnish() {
    this.sweepT = 0;
  }

  /** New round: clear loose paint. */
  reset() {
    this.particles.clear();
    this.sweepT = -1;
  }

  onEvents(events: SimEvent[]) {
    for (const e of events) {
      if (e.type === "splat") {
        this.particles.splat(e.x - HW, e.z - HH, e.slot + 1, e.big ? 2 : e.sky ? 0.6 : 1);
        this.shake = Math.max(this.shake, e.big ? 1.8 : e.sky ? 0.35 : 0.9);
      } else if (e.type === "bonk") {
        const t = this.sim.brushes.get(e.target);
        this.particles.bonk(e.x - HW, e.z - HH, (t?.slot ?? 0) + 1);
        this.shake = Math.max(this.shake, 0.35);
      } else if (e.type === "pickup") {
        this.particles.pickup(e.x - HW, e.z - HH, false);
      } else if (e.type === "power") {
        this.particles.pickup(e.x - HW, e.z - HH, e.kind === "mega");
      } else if (e.type === "bounce") {
        this.particles.pickup(e.x - HW, e.z - HH, false);
        this.shake = Math.max(this.shake, 0.25);
      }
    }
  }

  render(dt: number) {
    const sim = this.sim;
    this.adapt(dt);
    this.shared.uTime.value = sim.time;
    if (sim.dirty) {
      this.canvas.upload();
      sim.dirty = false;
    }

    const casters = this.shared.uCasters.value;
    let nc = 0;
    const sun = this.shared.uSunDir.value;
    const cast = (x: number, y: number, z: number, r: number, k: number) => {
      if (nc >= MAX_CASTERS) return;
      // where a point at height y throws its shadow on the canvas
      casters[nc++]!.set(x - (sun.x * y) / sun.y, z - (sun.z * y) / sun.y, r, k);
    };

    // ------------------------------------------------------------ brushes
    const seen = new Set<string>();
    this.brushes.hideAll();
    for (const b of sim.brushes.values()) {
      seen.add(b.id);
      let a = this.anim.get(b.id);
      if (!a) this.anim.set(b.id, (a = { lean: 0.6, bend: 0, scale: 1, spin: 0, frost: 0 }));
      const speed01 = Math.min(1, Math.hypot(b.vx, b.vz) / TUNING.speed);
      const k = 1 - Math.exp(-dt * 10);
      const stunned = b.stunT > 0;
      a.lean += ((stunned ? 1.15 : 0.55 + 0.3 * speed01 + (b.dashT > 0 ? 0.25 : 0)) - a.lean) * k;
      a.bend += ((stunned ? 0 : speed01 * 0.9) - a.bend) * k;
      a.scale += ((b.megaT > 0 ? 1.55 : 1) - a.scale) * (1 - Math.exp(-dt * 6));
      a.frost += ((b.dryT > 0 ? 1 : 0) - a.frost) * (1 - Math.exp(-dt * 5));
      a.spin = stunned ? a.spin + dt * 16 * Math.min(1, b.stunT * 2) : a.spin * Math.exp(-dt * 8);
      const x = b.x - HW;
      const z = b.z - HH;
      const yaw = b.angle + a.spin + (stunned ? Math.sin(sim.time * 30) * 0.15 : 0);
      this.brushes.pose(b.slot, x, z, yaw, a.lean, a.bend, a.scale, b.megaT > 0 ? 0.5 : 0, a.frost);

      // shadows: the bristles on the canvas, and the handle leaning off behind
      const back = { x: -Math.cos(yaw), z: -Math.sin(yaw) };
      const mid = 9 * a.scale;
      cast(x, 0.3, z, 2.6 * a.scale, 0.55);
      cast(x + back.x * Math.sin(a.lean) * mid, Math.cos(a.lean) * mid, z + back.z * Math.sin(a.lean) * mid, 2.4 * a.scale, 0.3);

      if (speed01 > 0.55 && b.load > 0.15 && Math.random() < 0.18 * speed01) {
        this.particles.fleck(x, z, b.vx, b.vz, b.slot + 1);
      }
      if (b.megaT > 0 && Math.random() < 0.5) this.particles.glitter(x, 4, z, 2.5);
      // turbo leaves a trail of sparks in its own colour
      if (b.turboT > 0 && speed01 > 0.3) this.particles.trail(x, z, b.slot + 1);
      if (b.dryT > 0 && Math.random() < 0.3) this.particles.glitter(x, 3, z, 2, 9);
      if (b.bomb && Math.random() < 0.35) this.particles.glitter(x, 9 * a.scale, z, 0.6, 10);
    }
    for (const id of this.anim.keys()) if (!seen.has(id)) this.anim.delete(id);

    // ------------------------------------------------------------ pots
    for (let i = 0; i < MAX_POTS; i++) this.pots.uPot.value[i]!.z = 0;
    sim.pots.forEach((p, i) => {
      if (i >= MAX_POTS || !p.active) return;
      const age = sim.time - p.bornAt;
      // pops up with a little overshoot
      const s = age < 0 ? 0 : 1 + Math.sin(Math.min(age * 7, Math.PI)) * 0.35 * Math.exp(-age * 3) - Math.exp(-age * 14);
      const scale = Math.max(0, s);
      this.pots.uPot.value[i]!.set(p.x - HW, p.z - HH, scale, 0);
      cast(p.x - HW, 0.8, p.z - HH, 4.4 * scale, 0.45);
    });

    // ------------------------------------------------------------ power-ups (drawn as candy over the canvas; their shadows here)
    for (const p of sim.powers) {
      const h = p.dropT > 0 ? 6 + p.dropT * 40 : 6;
      cast(p.x - HW, 0, p.z - HH, 3.2 - Math.min(1.6, p.dropT * 1.5), p.dropT > 0 ? 0.15 : 0.32);
      if (Math.random() < 0.08) this.particles.glitter(p.x - HW, h * 0.5, p.z - HH, 2.6, 9);
    }

    // ------------------------------------------------------------ turpentine
    const w = sim.wipe;
    if (w && w.delay <= 0 && Math.random() < 0.9) {
      const along = w.pos;
      const across = w.center + (Math.random() - 0.5) * w.width;
      const [px, pz] = w.axis === "x" ? [along, across] : [across, along];
      this.particles.splash(px - HW, pz - HH, w.axis === "x" ? 1 : 0, w.axis === "z" ? 1 : 0);
    }

    // ------------------------------------------------------------ globs in flight
    for (let i = 0; i < MAX_BLOBS; i++) this.blobs.uBlob.value[i]!.w = 0;
    let bi = 0;
    for (const bl of sim.blobs) {
      if (bi >= MAX_BLOBS) break;
      if (bl.delay > 0) {
        // paint rain about to fall: its shadow is already gathering
        if (bl.delay < 0.5) cast(bl.x1 - HW, 0, bl.z1 - HH, bl.hitRadius * 0.5, 0.12);
        continue;
      }
      const u = Math.min(1, bl.t / bl.dur);
      const x = bl.x0 + (bl.x1 - bl.x0) * u - HW;
      const z = bl.z0 + (bl.z1 - bl.z0) * u - HH;
      const y = bl.sky ? 46 * (1 - u) * (1 - u) + 0.6 : 4 * (1 - u) + 22 * u * (1 - u) + 0.6;
      const size = bl.big ? 2.6 : bl.sky ? 1.0 : 1.25;
      this.blobs.uBlob.value[bi]!.set(x, y, z, size);
      this.blobs.uBlobSlot.value[bi] = bl.slot + 1;
      bi++;
      cast(x, y, z, 2.4 * size + y * 0.08, 0.25 + 0.35 * u);
      // where it will land: a shadow that gathers as it comes down, so you can get out of the way
      cast(bl.x1 - HW, 0, bl.z1 - HH, bl.hitRadius * (0.6 + 0.4 * u), 0.08 + 0.3 * u * u);
    }
    this.shared.uCasterCount.value = nc;

    this.particles.update(dt);

    // ------------------------------------------------------------ camera
    this.shake *= Math.exp(-dt * 7);
    const s = this.shake;
    this.camera.position.copy(this.camBase);
    this.camera.position.x += (Math.random() - 0.5) * s * 1.6;
    this.camera.position.y += (Math.random() - 0.5) * s * 1.2;
    // a slow breath, so the room feels alive
    this.camera.position.x += Math.sin(performance.now() / 4100) * 0.8;
    this.camera.lookAt(this.camTarget);

    if (this.sweepT >= 0) {
      this.sweepT += dt / 2.2;
      this.frame.uniforms.uSweep.value = this.sweepT;
      if (this.sweepT > 1.3) this.sweepT = -1;
    } else {
      this.frame.uniforms.uSweep.value = -1;
    }

    this.frame.render(this.scene, this.camera);
  }

  private adapt(dt: number) {
    // Keep the frame rate on slower hardware (TV boxes): drop resolution when frames run long.
    this.frameMs += (dt * 1000 - this.frameMs) * 0.05;
    if (this.frameMs > this.targetMs * 1.45) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameMs < this.targetMs * 1.05) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    if (this.slowFor > 1.5 && this.renderScale > this.minScale) {
      this.renderScale = Math.max(this.minScale, this.renderScale - 0.15);
      this.slowFor = 0;
      this.applySize();
    } else if (this.fastFor > 6 && this.renderScale < this.maxScale) {
      this.renderScale = Math.min(this.maxScale, this.renderScale + 0.1);
      this.fastFor = 0;
      this.applySize();
    }
  }

  private resize() {
    // layout size, not the on-screen box: the end-of-round shrink is a CSS transform and mustn't shrink the render
    this.cssW = Math.max(1, this.container.clientWidth);
    this.cssH = Math.max(1, this.container.clientHeight);
    this.camera.aspect = this.cssW / this.cssH;
    this.fitCamera();
    this.applySize();
  }

  private applySize() {
    const w = Math.round(this.cssW * this.renderScale);
    const h = Math.round(this.cssH * this.renderScale);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.frame.setSize(w, h);
    this.shared.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(FOV) / 2)) / h;
  }

  /** Pull the camera back until the canvas (and a little table) fits, leaving room for the HUD at the top. */
  private fitCamera() {
    // the canvas fills the screen, edge to edge, with a strip on top for the clock and scores
    const corners = [
      [-HW - 1, 0, -HH - 1],
      [HW + 1, 0, -HH - 1],
      [-HW - 1, 0, HH + 2.5],
      [HW + 1, 0, HH + 2.5],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.camera.updateProjectionMatrix();
    let lo = 60;
    let hi = 600;
    for (let i = 0; i < 30; i++) {
      const r = (lo + hi) / 2;
      this.placeCamera(r);
      const fits = corners.every((c) => {
        const v = c.clone().project(this.camera);
        return Math.abs(v.x) < 0.985 && v.y < 0.86 && v.y > -0.985;
      });
      if (fits) hi = r;
      else lo = r;
    }
    this.placeCamera(hi);
    this.camBase.copy(this.camera.position);
  }

  private placeCamera(dist: number) {
    this.camera.position.set(0, Math.sin(ELEVATION) * dist, Math.cos(ELEVATION) * dist).add(this.camTarget);
    this.camera.lookAt(this.camTarget);
    this.camera.updateMatrixWorld();
  }

  dispose() {
    this.resizeObs.disconnect();
    this.renderer.dispose();
    this.frame.target.dispose();
    this.canvasEl.remove();
  }
}
