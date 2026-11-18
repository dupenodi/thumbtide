// three.js view for the Blast 3D spike. Three ways to draw the fighters (`mesh`):
//   separate:  one Mesh per body part (15 × 8 = 120 draws)
//   merged:    one Mesh per fighter: all its parts in one geometry, each vertex tagged with its part, moved by a
//              uniform array of part matrices in the vertex shader (rigid skinning; 8 draws)
//   instanced: one InstancedMesh per part kind across all fighters (9 draws for 15 parts)
// Shading is one cheap material for everything: lambert lighting worked out per vertex, so the fragment shader
// only writes a colour (the TV's graphics chip is weak at shader maths). No shadows (an optional blob under each
// fighter), no post-processing, no antialiasing. The canvas is drawn at `res` × 1920×1080 and stretched to fill.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { PartDef } from "./body.ts";
import { BOXES, DEBRIS_PER_BLAST, HALF, MAX_BLASTS, type Sim } from "./sim.ts";

THREE.ColorManagement.enabled = false;

export type MeshMode = "separate" | "merged" | "instanced";
export interface ViewOpts {
  mesh: MeshMode;
  res: number;
  shadow: boolean;
  parts: PartDef[];
}

const COLORS = ["#e8463a", "#3b7de8", "#f2c230", "#3cb371", "#b05ce8", "#f08a2c", "#2cc4c4", "#e85ca8", "#8a8a8a", "#6b4a2c", "#a0d040", "#4040a0", "#d0d0d0", "#305030", "#c06060", "#6060c0"];

const VERT = /* glsl */ `
#ifdef MERGED
attribute float part;
uniform mat4 parts[NPARTS];
#endif
uniform vec3 color;
varying vec3 vCol;
void main() {
  mat4 m = modelMatrix;
#ifdef MERGED
  m = m * parts[int(part + 0.5)];
#endif
#ifdef USE_INSTANCING
  m = m * instanceMatrix;
#endif
  vec3 n = normalize(mat3(m) * normal);
  vec3 base = color;
#ifdef USE_INSTANCING_COLOR
  base *= instanceColor;
#endif
  float sun = max(dot(n, vec3(0.42, 0.82, 0.39)), 0.0);
  vCol = base * (0.38 + 0.22 * (0.5 + 0.5 * n.y) + 0.62 * sun);
  gl_Position = projectionMatrix * viewMatrix * m * vec4(position, 1.0);
}`;
const FRAG = /* glsl */ `
varying vec3 vCol;
void main() { gl_FragColor = vec4(vCol, 1.0); }`;

function litMaterial(color: THREE.ColorRepresentation, merged?: { n: number; mats: Float32Array }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    defines: merged ? { MERGED: 1, NPARTS: merged.n } : {},
    uniforms: { color: { value: new THREE.Color(color) }, ...(merged ? { parts: { value: merged.mats } } : {}) },
  });
}

function partGeometry(d: PartDef): THREE.BufferGeometry {
  let g: THREE.BufferGeometry;
  if (d.shape === "sphere") g = new THREE.SphereGeometry(d.size[0]!, 12, 8);
  else if (d.shape === "capsule") g = new THREE.CapsuleGeometry(d.size[0]!, d.size[1]!, 3, 8);
  else g = new THREE.BoxGeometry(d.size[0]!, d.size[1]!, d.size[2]!);
  g.deleteAttribute("uv");
  return g;
}

export class View {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.5, 120);
  /** Part matrices of every fighter, 16 floats per part (filled by the caller). */
  readonly mats: Float32Array;
  private readonly np: number;
  private separate: THREE.Mesh[] = [];
  private merged: { mesh: THREE.Mesh; mats: Float32Array }[] = [];
  private inst: { mesh: THREE.InstancedMesh; slots: [number, number][] }[] = []; // (fighter, part) per instance
  private bombs: THREE.InstancedMesh;
  private shadows: THREE.InstancedMesh | null = null;
  private blasts: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private debris: THREE.InstancedMesh;
  private tmp = new THREE.Matrix4();
  private observer: ResizeObserver;
  /** Bytes on the graphics chip: geometry + textures (the drawing buffer is added in gpuMB()). */
  private gpuBytes = 0;

  constructor(private readonly host: HTMLElement, readonly o: ViewOpts, sim: Sim) {
    const n = sim.f.length;
    this.np = o.parts.length;
    this.mats = new Float32Array(n * this.np * 16);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, stencil: false, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setPixelRatio(o.res); // rendered pixels per CSS pixel (1920×1080 CSS), whatever the screen's DPR
    this.renderer.setClearColor("#8ec9f0", 1);
    this.renderer.domElement.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    host.appendChild(this.renderer.domElement);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.camera.position.set(0, 14.5, 15);
    this.camera.lookAt(0, 0, 0.9);

    this.arena();
    const geos = new Map<string, THREE.BufferGeometry>();
    const geo = (d: PartDef) => {
      let g = geos.get(d.kind);
      if (!g) geos.set(d.kind, (g = partGeometry(d)));
      return g;
    };
    if (o.mesh === "separate") {
      for (let c = 0; c < n; c++) {
        const mat = litMaterial(COLORS[c % COLORS.length]!);
        for (const d of o.parts) {
          const m = new THREE.Mesh(geo(d), mat);
          m.matrixAutoUpdate = false;
          m.matrixWorldAutoUpdate = false;
          m.frustumCulled = false;
          this.scene.add(m);
          this.separate.push(m);
        }
      }
      for (const g of geos.values()) this.gpuBytes += geoBytes(g);
    } else if (o.mesh === "merged") {
      // one geometry for the whole body, each vertex tagged with its part
      const pieces = o.parts.map((d, i) => {
        const g = partGeometry(d);
        g.setAttribute("part", new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count).fill(i), 1));
        return g;
      });
      const body = mergeGeometries(pieces)!;
      pieces.forEach((g) => g.dispose());
      this.gpuBytes += geoBytes(body);
      for (let c = 0; c < n; c++) {
        const mats = new Float32Array(this.np * 16);
        const m = new THREE.Mesh(body, litMaterial(COLORS[c % COLORS.length]!, { n: this.np, mats }));
        m.frustumCulled = false;
        this.scene.add(m);
        this.merged.push({ mesh: m, mats });
      }
    } else {
      const mat = litMaterial("#ffffff");
      const kinds = [...new Set(o.parts.map((d) => d.kind))];
      const col = new THREE.Color();
      for (const kind of kinds) {
        const slots: [number, number][] = [];
        for (let c = 0; c < n; c++) o.parts.forEach((d, p) => d.kind === kind && slots.push([c, p]));
        const mesh = new THREE.InstancedMesh(geo(o.parts.find((d) => d.kind === kind)!), mat, slots.length);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        slots.forEach(([c], k) => mesh.setColorAt(k, col.set(COLORS[c % COLORS.length]!)));
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        this.inst.push({ mesh, slots });
        this.gpuBytes += slots.length * (64 + 12);
      }
      for (const g of geos.values()) this.gpuBytes += geoBytes(g);
    }

    // bombs, blasts (an expanding sphere each) and debris, all pooled
    const bombGeo = new THREE.SphereGeometry(0.22, 12, 8);
    this.bombs = new THREE.InstancedMesh(bombGeo, litMaterial("#2a2a30"), 8);
    this.bombs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bombs.frustumCulled = false;
    this.scene.add(this.bombs);
    const blastGeo = new THREE.SphereGeometry(1, 16, 12);
    for (let i = 0; i < MAX_BLASTS; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: "#ffd27a", transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(blastGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.blasts.push({ mesh, mat });
    }
    this.debris = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), litMaterial("#f08a2c"), MAX_BLASTS * DEBRIS_PER_BLAST);
    this.debris.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.debris.frustumCulled = false;
    this.scene.add(this.debris);
    this.gpuBytes += geoBytes(bombGeo) + geoBytes(blastGeo) + geoBytes(this.debris.geometry) + (8 + MAX_BLASTS * DEBRIS_PER_BLAST) * 64;

    if (o.shadow) {
      // a soft dark disc under each fighter and bomb (no shadow maps)
      const c = document.createElement("canvas");
      c.width = c.height = 64;
      const g = c.getContext("2d")!;
      const grd = g.createRadialGradient(32, 32, 4, 32, 32, 31);
      grd.addColorStop(0, "rgba(0,0,0,0.45)");
      grd.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      const tex = new THREE.CanvasTexture(c);
      const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      this.shadows = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), n + 8);
      this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.shadows.frustumCulled = false;
      this.scene.add(this.shadows);
      this.gpuBytes += 64 * 64 * 4 + geoBytes(plane) + (n + 8) * 64;
    }
    this.resize();
    this.renderer.compile(this.scene, this.camera);
  }

  private arena() {
    // The Pad, roughly: a square platform inside its 16.6 × 18.5 m area of interest, four crates, and the sky colour
    const add = (g: THREE.BufferGeometry, color: string, x: number, y: number, z: number) => {
      g.deleteAttribute("uv");
      const m = new THREE.Mesh(g, litMaterial(color));
      m.position.set(x, y, z);
      this.scene.add(m);
      this.gpuBytes += geoBytes(g);
    };
    add(new THREE.BoxGeometry(HALF * 2, 0.8, HALF * 2), "#d8c79a", 0, -0.4, 0);
    add(new THREE.BoxGeometry(HALF * 2 + 0.6, 0.3, HALF * 2 + 0.6), "#9a8a66", 0, -0.75, 0);
    for (const b of BOXES) add(new THREE.BoxGeometry(b.w, b.h, b.w), "#a8713e", b.x, b.h / 2, b.z);
  }

  resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Copy this frame's part matrices and effects into the scene. */
  update(sim: Sim) {
    const np = this.np;
    const all = this.mats;
    if (this.o.mesh === "separate") {
      for (let i = 0; i < this.separate.length; i++) this.separate[i]!.matrixWorld.fromArray(all, i * 16);
    } else if (this.o.mesh === "merged") {
      for (let c = 0; c < this.merged.length; c++) this.merged[c]!.mats.set(all.subarray(c * np * 16, (c + 1) * np * 16));
    } else {
      for (const { mesh, slots } of this.inst) {
        const arr = mesh.instanceMatrix.array as Float32Array;
        for (let k = 0; k < slots.length; k++) {
          const s = slots[k]!;
          const from = (s[0] * np + s[1]) * 16;
          arr.set(all.subarray(from, from + 16), k * 16);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
    const m = this.tmp;
    this.bombs.count = Math.min(8, sim.bombs.length);
    for (let i = 0; i < this.bombs.count; i++) {
      const b = sim.bombs[i]!;
      this.bombs.setMatrixAt(i, m.makeTranslation(b.x, b.y, b.z));
    }
    this.bombs.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.blasts.length; i++) {
      const { mesh, mat } = this.blasts[i]!;
      const b = sim.blasts[i];
      mesh.visible = !!b;
      if (!b) continue;
      const r = 2 * Math.min(1, b.t / 0.22) ** 0.5;
      mesh.position.set(b.x, b.y, b.z);
      mesh.scale.setScalar(Math.max(0.05, r));
      mat.opacity = Math.max(0, 0.85 * (1 - b.t / 0.6));
    }
    this.debris.count = sim.debris.length;
    const { q, e, p, one } = SCRATCH;
    for (let i = 0; i < sim.debris.length; i++) {
      const d = sim.debris[i]!;
      e.set(d.spin * d.life, d.spin * 0.7 * d.life, 0);
      this.debris.setMatrixAt(i, m.compose(p.set(d.x, d.y, d.z), q.setFromEuler(e), one));
    }
    this.debris.instanceMatrix.needsUpdate = true;
    if (this.shadows) {
      let k = 0;
      const put = (x: number, y: number, z: number, size: number) => {
        if (Math.abs(x) > HALF || Math.abs(z) > HALF || y < -0.5) return;
        const s = size * Math.max(0.3, 1 - y * 0.15);
        m.makeScale(s, 1, s).setPosition(x, 0.02, z);
        this.shadows!.setMatrixAt(k++, m);
      };
      for (const c of sim.f) put(c.x, c.y, c.z, 1.1);
      for (const b of sim.bombs) if (k < this.shadows.instanceMatrix.count) put(b.x, b.y, b.z, 0.6);
      this.shadows.count = k;
      this.shadows.instanceMatrix.needsUpdate = true;
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Graphics memory estimate (MB): geometry, textures and the drawing buffer (colour + depth). */
  gpuMB() {
    const c = this.renderer.domElement;
    return Math.round(((this.gpuBytes + c.width * c.height * 8) / 1048576) * 10) / 10;
  }

  /** WebGL version, max texture size and the compressed texture formats on offer. */
  glInfo() {
    const gl = this.renderer.getContext();
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const exts = (gl.getSupportedExtensions() ?? []).filter((e) => /compress/i.test(e));
    return {
      gl: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1",
      gpu: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)).slice(0, 80) : "?",
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      ctex: exts.map((e) => e.replace(/^(WEBGL_compressed_texture_|EXT_texture_compression_)/, "")).join(",") || "none",
    };
  }

  dispose() {
    this.observer.disconnect();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const SCRATCH = { q: new THREE.Quaternion(), e: new THREE.Euler(), p: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1) };

function geoBytes(g: THREE.BufferGeometry) {
  let b = g.index ? g.index.array.byteLength : 0;
  for (const a of Object.values(g.attributes)) b += (a as THREE.BufferAttribute).array.byteLength;
  return b;
}
