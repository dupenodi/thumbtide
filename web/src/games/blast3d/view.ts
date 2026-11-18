// The three.js view of Blast Party 3D, built for the LG TV's small GPU (PowerVR BXE-4-32: about 3.4 µs per draw
// call, and fragment work is what costs). The architecture is the one measured on the TV in the spike: one merged
// draw per fighter (15 rigid parts moved by a uniform array of part matrices), vertex lighting, blob shadows, a
// drawing buffer at 0.66 of 1920×1080.
//
// THE FRAME'S DRAW ORDER (at most 13 draw calls, 3 shader programs, 0 textures):
//
//   opaque: ONE program (LIT) for all of it, so there is no program switch between these draws
//    1–8   fighters, one draw each, NEAREST FIRST (renderOrder 0–7 from the depth along the camera's view).
//          They stand in front of everything else, so drawing them first lets the depth test throw away the deck's
//          fragments behind them.
//    9     the bomb sheet: every bomb in one draw (24 slots; a slot is a "part" with its own matrix and tint).
//    10    the box sheet: the TNT crate and every power-up box in one draw (24 slots).
//    11    the arena: the deck, blocks, posts, the rock and the sky sheet with its clouds, one merged static mesh,
//          LAST of the opaque draws because it is behind everything and covers the whole screen (the sky sheet is
//          in this mesh too, so the "background" costs only the pixels nothing else covered).
//   blended: after all opaque draws, depth-tested but writing no depth
//    12    marks on the ground: blob shadows, player rings, shield rings and scorch marks, one instanced draw
//          (premultiplied alpha; the shapes are worked out in the fragment shader, no texture).
//    13    particles: one instanced draw for every effect (particles.ts; premultiplied, so glowing and covering
//          particles share it and need no sorting).
//   Nothing else: no post-processing, no shadow maps, no tone mapping, no antialiasing. The HUD is DOM above the
//   canvas.
//
// State kept cheap on purpose: `sortObjects` stays on but every object has an explicit renderOrder, so three.js's
// sort is 13 integers; the scene never updates matrices (every matrix is identity: positions go through the part
// matrices or instance attributes); frustum culling is on with hand-set bounding spheres (a fighter's follows it);
// one clear per frame (colour + depth); the context is made with antialias, alpha, stencil and
// preserveDrawingBuffer off and the default power preference.
import * as THREE from "three";
import { J, PARTS15, P, partMatrices } from "./body.ts";
import * as FX from "./fx.ts";
import {
  BOMB_SLOTS, PLAYER_COLORS, POWER_COLORS, POWER_ORDER, POWER_PER_KIND, POWER_SLOT0, SLOTS, TNT_SLOTS, VARIANTS, arenaGeo, bombSheet, boxSheet,
  fighterGeo, rgb, PALETTE, type Geo,
} from "./meshes.ts";
import { Particles } from "./particles.ts";
import { Body, settle, stepBodies } from "./ragdoll.ts";
import { ARM_TIME, BOMB_R, FUSE, MAX_SEATS, POWERUP_FLASH, PUNCH_TIME, RUN, STEP, TNT_R, groundAt, type Fighter, type Game, type GameEvent } from "./rules.ts";

THREE.ColorManagement.enabled = false;

const LIT_VERT = /* glsl */ `
attribute vec3 aCol;
attribute vec2 aux; // part, tint
uniform mat4 parts[${SLOTS}]; // each part's matrix; its bottom row carries the part's tint colour
uniform vec4 flash;
varying vec3 vCol;
void main() {
  mat4 m = parts[int(aux.x + 0.5)];
  vec3 tint = vec3(m[0][3], m[1][3], m[2][3]);
  vec3 wp = m[0].xyz * position.x + m[1].xyz * position.y + m[2].xyz * position.z + m[3].xyz;
  vec3 n = normalize(m[0].xyz * normal.x + m[1].xyz * normal.y + m[2].xyz * normal.z);
  vec3 base = aCol * mix(vec3(1.0), tint, aux.y);
  float sun = max(dot(n, vec3(0.38, 0.82, 0.43)), 0.0);
  vCol = mix(base * (0.38 + 0.2 * (0.5 + 0.5 * n.y) + 0.52 * sun), flash.rgb, flash.a);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const LIT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`;

const MARK_VERT = /* glsl */ `
attribute vec4 iA; // x, y, z, size (negative: a ring)
attribute vec4 iB; // colour, alpha
varying vec2 vUv;
varying vec4 vCol;
varying float vRing;
void main() {
  float s = abs(iA.w);
  vRing = iA.w < 0.0 ? 1.0 : 0.0;
  vUv = position.xz * 2.0;
  vCol = vec4(iB.rgb * iB.a, iB.a);
  gl_Position = projectionMatrix * viewMatrix * vec4(iA.x + position.x * s, iA.y, iA.z + position.z * s, 1.0);
}`;
const MARK_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vCol;
varying float vRing;
void main() {
  float d = dot(vUv, vUv);
  float blob = clamp(1.0 - d, 0.0, 1.0);
  float ring = clamp((1.0 - d) * 9.0, 0.0, 1.0) * clamp((d - 0.5) * 9.0, 0.0, 1.0);
  gl_FragColor = vCol * mix(blob * blob, ring, vRing);
}`;

const MARKS = 96;
const GLOVE = rgb("#e5484d");

function toGeometry(g: Geo) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(g.pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.nor, 3));
  geo.setAttribute("aCol", new THREE.Float32BufferAttribute(g.col, 3));
  geo.setAttribute("aux", new THREE.Float32BufferAttribute(g.aux, 2));
  return geo;
}
function bytesOf(g: THREE.BufferGeometry) {
  let b = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) b += ((a as THREE.BufferAttribute).array as Float32Array | undefined)?.byteLength ?? 0;
  return b;
}

/** One opaque draw: a mesh with its 24 part matrices. */
interface Sheet {
  mesh: THREE.Mesh;
  mats: Float32Array;
  flash: THREE.Vector4;
  sphere: THREE.Sphere;
}

export interface ViewOpts {
  /** Drawn pixels per CSS pixel of the 1920×1080 page. */
  res: number;
  lite: boolean;
  /** A close camera on the middle of the deck, to look at the models (start option cam=close). */
  close?: boolean;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(31, 16 / 9, 6, 240);
  readonly fx: Particles;
  /** The drawn bodies, by seat slot. */
  readonly bodies: Body[] = Array.from({ length: MAX_SEATS }, () => new Body());
  /** Triangles of each model (for the report). */
  readonly budget: Record<string, number> = {};
  res: number;
  private fighters: Sheet[] = [];
  private bombs: Sheet;
  private boxes: Sheet;
  private marks: THREE.Mesh;
  private markData = new Float32Array(MARKS * 8);
  private markBuf: THREE.InstancedInterleavedBuffer;
  private scorch: { x: number; y: number; z: number; r: number; t: number }[] = [];
  private hitAt = new Float32Array(MAX_SEATS).fill(-9);
  private lastV = new Float32Array(MAX_SEATS * 3);
  private depth: { d: number }[] = Array.from({ length: MAX_SEATS }, () => ({ d: 0 }));
  private tints: [number, number, number][] = PLAYER_COLORS.map(rgb);
  private skins: [number, number, number][] = VARIANTS.map((v) => rgb(v.skin));
  private time = 0;
  private frameNo = 0;
  private observer: ResizeObserver;
  private gpuBytes = 0;
  private fwd = new THREE.Vector3();

  constructor(private readonly host: HTMLElement, o: ViewOpts) {
    this.res = o.res;
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, stencil: false, depth: true, preserveDrawingBuffer: false, powerPreference: "default" }));
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = false;
    r.sortObjects = true; // by renderOrder only: every object has one (see the draw order above)
    r.autoClear = true;
    r.setPixelRatio(o.res);
    r.setClearColor(PALETTE.sky, 1);
    r.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(r.domElement);
    this.scene.matrixAutoUpdate = false;
    this.scene.matrixWorldAutoUpdate = false; // nothing in the scene moves by its own matrix

    const variants = VARIANTS.map((v) => {
      const g = fighterGeo(v);
      this.budget[v.name] = g.tris;
      const geo = toGeometry(g);
      this.gpuBytes += bytesOf(geo);
      return geo;
    });
    for (let i = 0; i < MAX_SEATS; i++) {
      // its own geometry object (for its own bounding sphere) over the variant's shared GPU buffers
      const base = variants[i % variants.length]!;
      const geo = new THREE.BufferGeometry();
      for (const name of Object.keys(base.attributes)) geo.setAttribute(name, base.getAttribute(name));
      const s = this.lit(geo, 1.7, i);
      s.mesh.visible = false;
      this.fighters.push(s);
    }
    const bombs = bombSheet();
    const boxes = boxSheet();
    const arena = arenaGeo();
    Object.assign(this.budget, { bombSheet: bombs.tris, boxSheet: boxes.tris, arena: arena.tris });
    this.bombs = this.lit(toGeometry(bombs), 60, 10);
    this.boxes = this.lit(toGeometry(boxes), 60, 11);
    const ground = this.lit(toGeometry(arena), 400, 20);
    ground.mats.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    this.gpuBytes += bytesOf(this.bombs.mesh.geometry) + bytesOf(this.boxes.mesh.geometry) + bytesOf(ground.mesh.geometry);

    // marks on the ground: an instanced quad lying flat
    const mg = new THREE.InstancedBufferGeometry();
    mg.setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5], 3));
    mg.setIndex([0, 1, 2, 0, 2, 3]);
    this.markBuf = new THREE.InstancedInterleavedBuffer(this.markData, 8);
    this.markBuf.setUsage(THREE.DynamicDrawUsage);
    mg.setAttribute("iA", new THREE.InterleavedBufferAttribute(this.markBuf, 4, 0));
    mg.setAttribute("iB", new THREE.InterleavedBufferAttribute(this.markBuf, 4, 4));
    mg.instanceCount = 0;
    this.marks = new THREE.Mesh(
      mg,
      new THREE.ShaderMaterial({
        vertexShader: MARK_VERT, fragmentShader: MARK_FRAG, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      }),
    );
    this.marks.matrixAutoUpdate = false;
    this.marks.renderOrder = 40;
    (this.marks as unknown as { boundingSphere: THREE.Sphere }).boundingSphere = new THREE.Sphere(new THREE.Vector3(), 60);
    this.scene.add(this.marks);

    this.fx = new Particles(o.lite);
    this.fx.mesh.renderOrder = 50;
    this.scene.add(this.fx.mesh);
    this.gpuBytes += MARKS * 32 + this.fx.cap * 64;

    if (o.close) {
      this.camera.position.set(0, 6.5, 12.5);
      this.camera.lookAt(0, 0.9, 1.5);
    } else {
      this.camera.position.set(0, 15, 17.4);
      this.camera.lookAt(0, 0.3, 1.05);
    }
    this.camera.updateMatrixWorld(true);
    this.camera.matrixAutoUpdate = false;
    this.camera.matrixWorldAutoUpdate = false;
    this.camera.getWorldDirection(this.fwd);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    r.compile(this.scene, this.camera);
  }

  /** A mesh drawn by the one opaque program, with its own part matrices. */
  private lit(geo: THREE.BufferGeometry, radius: number, order: number): Sheet {
    const mats = new Float32Array(SLOTS * 16);
    const flash = new THREE.Vector4(0, 0, 0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: LIT_VERT, fragmentShader: LIT_FRAG, uniforms: { parts: { value: mats }, flash: { value: flash } } }));
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = order;
    const sphere = new THREE.Sphere(new THREE.Vector3(), radius);
    (mesh as unknown as { boundingSphere: THREE.Sphere }).boundingSphere = sphere;
    this.scene.add(mesh);
    return { mesh, mats, flash, sphere };
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Change the drawing buffer's scale (the host drops it when frames run long). */
  setScale(res: number) {
    this.res = res;
    this.renderer.setPixelRatio(res);
    this.resize();
  }

  /** A new round or match: nothing left over. */
  clear() {
    this.scorch.length = 0;
    for (const b of this.bodies) {
      b.on = false;
      b.rag = false;
      b.down = 0;
    }
  }

  // ---------------------------------------------------------------------------------------------- per 60 Hz step
  /** After each rules step: move the drawn bodies along with their fighters, and run the ragdolls. */
  step(game: Game) {
    for (const b of this.bodies) b.on = false;
    for (const f of game.seats.values()) {
      const b = this.bodies[f.slot];
      if (b) this.follow(game, f, b, f.slot);
    }
    stepBodies(this.bodies);
  }

  private follow(game: Game, f: Fighter, b: Body, i: number) {
    b.on = f.inRound && !f.gone;
    if (!b.on) {
      b.rag = false;
      return;
    }
    const limp = !f.alive || f.knockout > 0 || !!f.heldBy;
    const hs = Math.hypot(f.vx, f.vz);
    b.x = f.x;
    b.y = f.y;
    b.z = f.z;
    b.yaw = f.yaw;
    b.speed = f.grounded && !limp ? Math.min(1, hs / RUN) : 0;
    b.phase += hs * STEP * 2.1;
    b.punch = f.punchT >= 0 ? f.punchT / PUNCH_TIME : -1;
    b.punchSide = f.punchSide;
    b.carry = game.holding(f);
    b.held = !!f.heldBy;
    b.air = !f.grounded && !limp;
    b.t += STEP;
    b.down += ((limp ? 1 : 0) - b.down) * (limp ? 0.3 : 0.2);
    const lv = this.lastV;
    if (limp) {
      if (!b.rag) {
        b.rag = true;
        b.snap(f.vx, f.vy, f.vz);
      } else {
        // a knock (a hit, a blast, a throw) shows as a jump in the capsule's velocity: pass it on to the ragdoll
        const dx = f.vx - lv[i * 3]!, dy = f.vy - lv[i * 3 + 1]!, dz = f.vz - lv[i * 3 + 2]!;
        if (dx * dx + dy * dy + dz * dz > 4) b.kick(dx, dy, dz);
      }
      b.muscle = 0;
      b.calm = 0;
    } else if (b.rag) {
      b.calm += STEP;
      b.muscle = Math.min(1, b.calm / 0.3);
      if (b.calm > 0.4) b.rag = false;
    }
    lv[i * 3] = f.vx;
    lv[i * 3 + 1] = f.vy;
    lv[i * 3 + 2] = f.vz;
  }

  /** Something happened in the rules: show it. */
  event(e: GameEvent, game: Game) {
    const fx = this.fx;
    switch (e.type) {
      case "blast": {
        FX.explosion(fx, e.x, e.y, e.z, e.radius, e.kind === "tnt");
        const top = groundAt(e.x, e.z);
        if (top !== null && e.y - top < 1.2 && e.y > top - 0.1) {
          if (this.scorch.length >= 10) this.scorch.shift();
          this.scorch.push({ x: e.x, y: top, z: e.z, r: e.radius, t: this.time });
        }
        break;
      }
      case "hit": {
        const f = game.seats.get(e.id);
        if (f) this.hitAt[f.slot] = this.time;
        if (e.kind === "punch") FX.punchHit(fx, e.x, e.y, e.z, e.dx, e.dy, e.dz, Math.min(1, e.damage / 450));
        break;
      }
      case "land":
        FX.dust(fx, e.x, e.y, e.z, Math.min(1.6, e.speed / 7));
        break;
      case "jump":
        FX.dust(fx, e.x, e.y, e.z, 0.6);
        break;
      case "power":
        FX.sparkle(fx, e.x, e.y, e.z, POWER_COLORS[e.kind]);
        break;
      case "shieldDown":
        FX.sparkle(fx, e.x, e.y, e.z, POWER_COLORS.shield, 18);
        break;
      case "spawn": {
        const f = game.seats.get(e.id);
        if (!f) break;
        const b = this.bodies[f.slot]!;
        b.rag = false;
        b.down = 0;
        if (game.phase === "play") FX.sparkle(fx, f.x, f.y + 1, f.z, PLAYER_COLORS[f.slot % PLAYER_COLORS.length]!, 10);
        break;
      }
      case "die":
        if (e.fell) FX.poof(fx, e.x, Math.max(e.y, -4.5), e.z);
        break;
      case "stick":
        FX.splat(fx, e.x, e.y, e.z);
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------------------------------------- per frame
  /** Fill this frame's part matrices, tints and instances from the game. `dt` is 0 while paused. */
  draw(game: Game, dt: number) {
    this.time += dt;
    this.frameNo++;
    const t = this.time;
    const md = this.markData;
    let mk = 0;
    const mark = (x: number, y: number, z: number, size: number, c: [number, number, number], a: number) => {
      if (mk >= MARKS) return;
      const o = mk++ * 8;
      md[o] = x; md[o + 1] = y + 0.05; md[o + 2] = z; md[o + 3] = size;
      md[o + 4] = c[0]; md[o + 5] = c[1]; md[o + 6] = c[2]; md[o + 7] = a;
    };
    const BLACK: [number, number, number] = [0, 0, 0.04];
    /** A blob shadow under something at height y (none over the drop). */
    const shadow = (x: number, y: number, z: number, size: number, a: number) => {
      const top = groundAt(x, z);
      if (top === null || y < top - 0.3) return;
      const h = Math.max(0, y - top);
      mark(x, top, z, size * Math.max(0.45, 1 - h * 0.1), BLACK, a * Math.max(0.25, 1 - h * 0.12));
    };
    for (let i = this.scorch.length - 1; i >= 0; i--) {
      const s = this.scorch[i]!;
      const age = t - s.t;
      if (age > 8) this.scorch.splice(i, 1);
      else mark(s.x, s.y, s.z, s.r * 1.35, BLACK, 0.5 * (1 - age / 8));
    }

    // ---- fighters
    for (const s of this.fighters) s.mesh.visible = false;
    for (const f of game.seats.values()) {
      const s = this.fighters[f.slot];
      const b = this.bodies[f.slot];
      if (!s || !b || !b.on) continue;
      s.mesh.visible = true;
      settle(b);
      const m = s.mats;
      partMatrices(b.joints, b.yaw, PARTS15, m, 0);
      const tint = this.tints[f.slot % this.tints.length]!;
      const gloves = f.glovesT > 0 && (f.glovesT > 2 || Math.floor(t * 8) % 2 === 0);
      for (let p = 0; p < PARTS15.length; p++) {
        const hand = p === P.lHand || p === P.rHand;
        const c = hand ? (gloves ? GLOVE : this.skins[f.slot % this.skins.length]!) : tint;
        const o = p * 16;
        m[o + 3] = c[0];
        m[o + 7] = c[1];
        m[o + 11] = c[2];
        if (hand && gloves) for (let k = 0; k < 11; k++) if (k % 4 !== 3) m[o + k]! *= 1.55;
      }
      // flashes: a hit (white), the spawn's invincible second (blinking), a shield (cyan), a body (dimmed)
      const hit = 0.75 * Math.max(0, 1 - (t - this.hitAt[f.slot]!) / 0.14);
      if (hit > 0) s.flash.set(1, 1, 1, hit);
      else if (!f.alive) s.flash.set(0.2, 0.2, 0.28, 0.4);
      else if (f.invincible > 0 && game.phase === "play") s.flash.set(1, 1, 1, Math.floor(t * 10) % 2 ? 0.45 : 0);
      else if (f.shield > 0) s.flash.set(0.4, 0.9, 1, 0.2 + 0.1 * Math.sin(t * 7));
      else s.flash.set(0, 0, 0, 0);
      const pv = b.joints[J.pelvis]!;
      s.sphere.center.set(pv.x, pv.y, pv.z);
      const d = this.depth[f.slot]!;
      d.d = (pv.x - this.camera.position.x) * this.fwd.x + (pv.y - this.camera.position.y) * this.fwd.y + (pv.z - this.camera.position.z) * this.fwd.z;
      if (f.alive) {
        const top = groundAt(pv.x, pv.z);
        if (top !== null && pv.y > top - 0.3) {
          mark(pv.x, top, pv.z, -1.3, tint, 0.9);
          if (f.shield > 0) mark(pv.x, top, pv.z, -(1.8 + 0.08 * Math.sin(t * 7)), rgb(POWER_COLORS.shield), 0.6 + 0.4 * Math.min(1, f.shield / 200));
        }
      }
      shadow(pv.x, f.y, pv.z, 1.25, 0.34);
    }
    // nearest first
    const order = this.depth;
    const idx = ORDER;
    idx.sort((a, b) => order[a]!.d - order[b]!.d);
    for (let k = 0; k < MAX_SEATS; k++) this.fighters[idx[k]!]!.mesh.renderOrder = k;

    // ---- bombs and the TNT crate
    const bm = this.bombs.mats;
    const xm = this.boxes.mats;
    bm.fill(0);
    xm.fill(0);
    const used = { normal: 0, impact: 0, sticky: 0, tnt: 0 };
    for (const b of game.bombs) {
      const lit = b.fuse < 1e6;
      const swell = b.fuse < 0.15 ? 1 + (0.15 - b.fuse) * 2.5 : 1;
      if (b.kind === "tnt") {
        if (used.tnt >= TNT_SLOTS[1]) continue;
        const o = (TNT_SLOTS[0] + used.tnt++) * 16;
        const blink = lit && Math.floor(t * 20) % 2 === 0;
        putYaw(xm, o, b.x, b.y, b.z, 0, swell, blink ? 1 : 0.24, blink ? 0.9 : 0.1, blink ? 0.5 : 0.07);
        if (!b.heldBy) shadow(b.x, b.y - TNT_R, b.z, 1.5, 0.32);
        continue;
      }
      const [first, n] = BOMB_SLOTS[b.kind];
      if (used[b.kind] >= n) continue;
      const o = (first + used[b.kind]++) * 16;
      const loose = !b.heldBy && !b.stuck;
      let r = 0, g = 0, bl = 0;
      if (b.kind === "impact") {
        const on = b.free >= ARM_TIME && Math.floor(t * 9) % 2 === 0;
        r = on ? 1 : 0.35;
        g = on ? 0.85 : 0.08;
        bl = on ? 0.4 : 0.1;
      } else {
        // the fuse's tip glows, faster as it burns down
        const pulse = 0.5 + 0.5 * Math.sin(t * (10 + (FUSE - b.fuse) * 9));
        r = 1;
        g = 0.55 + 0.4 * pulse;
        bl = 0.15 + 0.6 * pulse;
      }
      putRoll(bm, o, b.x, b.y + 0.06, b.z, loose ? b.z / BOMB_R : 0, loose ? -b.x / BOMB_R : 0, swell * 1.3, r, g, bl);
      if (b.kind !== "impact" && dt > 0 && (this.frameNo + b.id) % 3 === 0) {
        // a spark from the tip of the fuse: the tip's place in the bomb's frame, moved by its matrix
        const tx = 0.09, ty = 0.42; // (the matrix carries the bomb's scale)
        FX.fuseSpark(this.fx, bm[o + 12]! + bm[o]! * tx + bm[o + 4]! * ty, bm[o + 13]! + bm[o + 1]! * tx + bm[o + 5]! * ty, bm[o + 14]! + bm[o + 2]! * tx + bm[o + 6]! * ty);
      }
      if (loose) shadow(b.x, b.y - BOMB_R, b.z, 0.75, 0.3);
    }
    // ---- power-up boxes
    const kinds = KIND_USED.fill(0);
    for (const b of game.boxes) {
      const k = POWER_ORDER.indexOf(b.kind);
      shadow(b.x, b.y - 0.36, b.z, 1.05, 0.3);
      if (kinds[k]! >= POWER_PER_KIND) continue;
      if (b.age > POWERUP_FLASH && Math.floor(t * 9) % 2 === 0) continue; // it blinks before it goes
      const o = (POWER_SLOT0 + k * POWER_PER_KIND + kinds[k]!++) * 16;
      const c = rgb(POWER_COLORS[b.kind]);
      putYaw(xm, o, b.x, b.y + (b.rest ? 0.07 + 0.05 * Math.sin(t * 3 + b.id) : 0), b.z, b.rest ? 0.25 * Math.sin(t * 1.3 + b.id) : b.id + b.y * 0.6, 1, c[0], c[1], c[2]);
    }

    (this.marks.geometry as THREE.InstancedBufferGeometry).instanceCount = mk;
    this.marks.visible = mk > 0;
    if (mk > 0) {
      this.markBuf.clearUpdateRanges();
      this.markBuf.addUpdateRange(0, mk * 8);
      this.markBuf.needsUpdate = true;
    }
    this.fx.update(t);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** This frame's numbers for the perf report. */
  stats() {
    const i = this.renderer.info;
    return { draws: i.render.calls, tris: i.render.triangles, programs: i.programs?.length ?? 0, textures: i.memory.textures, particles: this.fx.alive() };
  }

  /** Graphics memory estimate (MB): geometry and the drawing buffer (colour + depth). There are no textures. */
  gpuMB() {
    const c = this.renderer.domElement;
    return Math.round(((this.gpuBytes + c.width * c.height * 8) / 1048576) * 10) / 10;
  }

  glInfo() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      gl: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1",
      gpu: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : "?",
    };
  }

  dispose() {
    this.observer.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    });
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

const ORDER = Array.from({ length: MAX_SEATS }, (_, i) => i);
const KIND_USED = new Uint8Array(POWER_ORDER.length);

/** A part matrix: a turn about x then z (a rolling ball), a scale, a place, and the tint in the bottom row. */
function putRoll(m: Float32Array, o: number, x: number, y: number, z: number, rx: number, rz: number, s: number, r: number, g: number, b: number) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cz = Math.cos(rz), sz = Math.sin(rz);
  m[o] = cz * s; m[o + 1] = sz * s; m[o + 2] = 0; m[o + 3] = r;
  m[o + 4] = -sz * cx * s; m[o + 5] = cz * cx * s; m[o + 6] = sx * s; m[o + 7] = g;
  m[o + 8] = sz * sx * s; m[o + 9] = -cz * sx * s; m[o + 10] = cx * s; m[o + 11] = b;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}
/** A part matrix: a turn about y, a scale, a place, a tint. */
function putYaw(m: Float32Array, o: number, x: number, y: number, z: number, a: number, s: number, r: number, g: number, b: number) {
  const c = Math.cos(a) * s, n = Math.sin(a) * s;
  m[o] = c; m[o + 1] = 0; m[o + 2] = -n; m[o + 3] = r;
  m[o + 4] = 0; m[o + 5] = s; m[o + 6] = 0; m[o + 7] = g;
  m[o + 8] = n; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = b;
  m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}
