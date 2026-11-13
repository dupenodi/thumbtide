// The things that move: the players' brushes, the paint pots, and globs of paint in flight.
// Each is one model of dabs, drawn once per copy; where each copy is comes from a small uniform array.
import * as THREE from "three";
import { MAX_BRUSHES } from "../shared.ts";
import { PALETTE_GLSL, type PaletteUniforms } from "./canvas.ts";
import { COMMON, dabGeometry, dabMaterial, dabMesh, glslVec3, hexVec, type Shared } from "./glsl.ts";

export const MAX_POTS = 10;
export const MAX_BLOBS = 16;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------------- brushes
// Clean, solid models (not painted like the canvas): smooth turned shapes with soft light and a glossy handle.

/** Brush model, standing upright with its tip at the origin. Units are canvas cells. */
const K = 1.75; // overall size of a brush, in canvas cells
const BRISTLE_LEN = 3.4 * K;
const FERRULE_LEN = 1.9 * K;
const HANDLE_LEN = 9.5 * K;
const BAND_FROM = 0.7; // the coloured end of the handle starts here
export const BRUSH_HEIGHT = BRISTLE_LEN + FERRULE_LEN + HANDLE_LEN;

// The shape, as radius along each part (t: 0 at the part's lower end, 1 at its upper end).
const bristleR = (t: number) => 1.15 * K * Math.sin(Math.min(1, t * 1.3) * Math.PI * 0.5) * (1 - 0.1 * t);
const ferruleR = (t: number) => (1.18 - t * 0.1) * K;
const handleR = (t: number) => ((t < 0.2 ? 0.9 + t * 0.5 : 1.0 - (t - 0.2) * 0.62) * (t > 0.95 ? Math.sqrt(Math.max(0, (1 - t) / 0.05)) : 1) + 0.04) * K;

const LACQUER: [string, string, string] = ["#5b5b66", "#2b2b33", "#111116"];

/** Smooth, softly lit plastic-and-metal look: a light-to-shade ramp, a highlight and a rim of sky light. */
function solidMaterial(shared: Shared) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...shared,
      uL: { value: new THREE.Vector3() },
      uM: { value: new THREE.Vector3() },
      uS: { value: new THREE.Vector3() },
      uGloss: { value: 0 },
      uFrost: { value: 0 },
    },
    vertexShader: /* glsl */ `
      out vec3 vN;
      out vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uL; uniform vec3 uM; uniform vec3 uS; uniform float uGloss; uniform float uFrost;
      in vec3 vN; in vec3 vW;
      layout(location = 0) out vec4 outC;
      void main() {
        vec3 n = normalize(vN);
        vec3 v = normalize(cameraPosition - vW);
        float l = clamp(dot(n, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = l < 0.5 ? mix(uS, uM, smoothstep(0.0, 0.5, l)) : mix(uM, uL, smoothstep(0.5, 1.0, l));
        c = mix(c, vec3(0.86, 0.95, 1.0) * (0.7 + 0.35 * l), uFrost * 0.7);
        float spec = pow(max(dot(reflect(-uSunDir, n), v), 0.0), 24.0);
        c += vec3(1.0, 0.98, 0.94) * spec * uGloss;
        float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        c += vec3(0.75, 0.85, 1.0) * rim * 0.18;
        outC = vec4(c, 1.0);
      }`,
  });
}

export function createBrushes(shared: Shared, pal: PaletteUniforms) {
  const lacquer = LACQUER.map(hexVec);
  const lathe = (r: (t: number) => number, y0: number, len: number) => {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      pts.push(new THREE.Vector2(Math.max(0.001, r(t)), y0 + t * len));
    }
    return new THREE.LatheGeometry(pts, 32);
  };
  const bandStart = BRISTLE_LEN + FERRULE_LEN + BAND_FROM * HANDLE_LEN;
  const geos = {
    bristle: lathe(bristleR, -BRISTLE_LEN, BRISTLE_LEN), // hangs from a pivot at the ferrule
    ferrule: lathe(ferruleR, BRISTLE_LEN, FERRULE_LEN),
    handle: lathe((t) => handleR(t * BAND_FROM), BRISTLE_LEN + FERRULE_LEN, BAND_FROM * HANDLE_LEN),
    band: lathe((t) => handleR(BAND_FROM + t * (1 - BAND_FROM)), bandStart, (1 - BAND_FROM) * HANDLE_LEN),
  };
  const group = new THREE.Group();
  const models = Array.from({ length: MAX_BRUSHES }, (_, b) => {
    const root = new THREE.Group();
    root.rotation.order = "YXZ";
    const mats = { bristle: solidMaterial(shared), ferrule: solidMaterial(shared), handle: solidMaterial(shared), band: solidMaterial(shared) };
    const k = b + 1;
    const set = (m: THREE.ShaderMaterial, l: THREE.Vector3, mm: THREE.Vector3, s: THREE.Vector3, gloss: number) => {
      m.uniforms.uL!.value.copy(l);
      m.uniforms.uM!.value.copy(mm);
      m.uniforms.uS!.value.copy(s);
      m.uniforms.uGloss!.value = gloss;
    };
    set(mats.bristle, pal.uPalL.value[k]!, pal.uPalM.value[k]!, pal.uPalS.value[k]!, 0.25);
    set(mats.ferrule, pal.uPalL.value[11]!, pal.uPalM.value[11]!, pal.uPalS.value[11]!, 0.9);
    set(mats.handle, lacquer[0]!, lacquer[1]!, lacquer[2]!, 0.7);
    set(mats.band, pal.uPalL.value[k]!, pal.uPalM.value[k]!, pal.uPalS.value[k]!, 0.55);
    const pivot = new THREE.Group();
    pivot.position.y = BRISTLE_LEN;
    pivot.add(new THREE.Mesh(geos.bristle, mats.bristle));
    root.add(pivot, new THREE.Mesh(geos.ferrule, mats.ferrule), new THREE.Mesh(geos.handle, mats.handle), new THREE.Mesh(geos.band, mats.band));
    root.visible = false;
    root.renderOrder = 4;
    group.add(root);
    return { root, pivot, mats };
  });

  return {
    group,
    /** Pose brush `slot`: arena-world x/z, facing (radians), lean, bristle bend, scale, glint, frost. */
    pose(slot: number, x: number, z: number, yaw: number, leanA: number, bend: number, scale: number, glint: number, frost = 0) {
      const u = models[slot]!;
      u.root.visible = true;
      u.root.position.set(x, 0.05, z);
      u.root.rotation.set(leanA, Math.atan2(-Math.cos(yaw), -Math.sin(yaw)), 0);
      u.root.scale.setScalar(scale);
      u.pivot.rotation.x = -Math.atan2(2.4 * bend, BRISTLE_LEN);
      u.mats.handle.uniforms.uGloss!.value = 0.7 + glint;
      for (const m of Object.values(u.mats)) m.uniforms.uFrost!.value = frost;
    },
    hideAll() {
      for (const m of models) m.root.visible = false;
    },
  };
}

// ---------------------------------------------------------------------------------------------------- pots

function potModel() {
  const rand = lcg(99);
  const R = 3.0;
  const H = 2.8;
  const pts: { p: number[]; n: number[]; d: number[]; size: [number, number]; part: number; u: number }[] = [];
  // the tin's side, with a paper label round its middle
  for (let i = 0; i < 70; i++) {
    const y = rand() * H;
    const a = rand() * Math.PI * 2;
    pts.push({ p: [Math.cos(a) * R, y, Math.sin(a) * R], n: [Math.cos(a), 0, Math.sin(a)], d: [-Math.sin(a), 0, Math.cos(a)], size: [1.1, 1.9], part: y > H * 0.25 && y < H * 0.75 ? 1 : 0, u: a / (Math.PI * 2) });
  }
  // the rim
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    pts.push({ p: [Math.cos(a) * R, H + 0.1, Math.sin(a) * R], n: [Math.cos(a), 0.7, Math.sin(a)], d: [-Math.sin(a), 0, Math.cos(a)], size: [0.8, 1.6], part: 0, u: 0 });
  }
  // the paint inside, swirled
  for (let i = 0; i < 50; i++) {
    const rr = Math.sqrt(rand()) * (R - 0.2);
    const a = rand() * Math.PI * 2;
    const swirl = a + rr * 1.6;
    pts.push({ p: [Math.cos(a) * rr, H, Math.sin(a) * rr], n: [0, 1, 0], d: [-Math.sin(swirl), 0, Math.cos(swirl)], size: [1.2, 2.3], part: 2, u: (swirl / (Math.PI * 2) + 10) % 1 });
  }
  return pts;
}

export function createPots(shared: Shared, pal: PaletteUniforms, o: { msaa: boolean }) {
  const model = potModel();
  const per = model.length;
  const n = per * MAX_POTS;
  const aLocal = new Float32Array(n * 3);
  const aNrm = new Float32Array(n * 3);
  const aDir = new Float32Array(n * 3);
  const aInfo = new Float32Array(n * 3);
  const aSize = new Float32Array(n * 2);
  for (let b = 0; b < MAX_POTS; b++) {
    model.forEach((m, i) => {
      const k = b * per + i;
      aLocal.set(m.p, k * 3);
      aNrm.set(m.n, k * 3);
      aDir.set(m.d, k * 3);
      aInfo.set([m.part, m.u, b], k * 3);
      aSize.set(m.size, k * 2);
    });
  }
  // per pot: x, z, scale, gold
  const uPot = { value: Array.from({ length: MAX_POTS }, () => new THREE.Vector4()) };
  const mesh = dabMesh(
    dabGeometry(n, { aLocal: [aLocal, 3], aNrm: [aNrm, 3], aDir: [aDir, 3], aInfo: [aInfo, 3], aSize: [aSize, 2] }),
    dabMaterial(shared, {
      msaa: o.msaa,
      uniforms: { ...pal, uPot },
      head: PALETTE_GLSL + /* glsl */ `
        in vec3 aLocal; in vec3 aNrm; in vec3 aDir; in vec3 aInfo; in vec2 aSize;
        uniform vec4 uPot[${MAX_POTS}];`,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 P = uPot[int(aInfo.z + 0.5)];
          if (P.z < 0.01) { d.alive = 0.0; return; }
          int part = int(aInfo.x + 0.5);
          bool gold = P.w > 0.5;
          float wob = sin(uTime * 2.2 + aInfo.z) * 0.12;
          vec3 p = aLocal * P.z;
          float c0 = cos(wob), s0 = sin(wob);
          p = vec3(p.x * c0 - p.z * s0, p.y, p.x * s0 + p.z * c0);
          vec3 world = vec3(P.x, 0.0, P.y) + p;
          vec3 n = aNrm;
          vec4 r = hash4(float(gl_InstanceID) * 0.53 + 7.0);
          if (part != 2 && dot(normalize(n), normalize(cameraPosition - world)) < -0.05) { d.alive = 0.0; return; }
          float lit = litFace(normalize(n));
          vec3 c;
          if (part == 2) {
            // the paint: a swirl of every colour, or gold
            int k = gold ? 10 : 1 + int(floor(aInfo.y * 8.0)) % 8;
            c = palette(k, 0.7 + (r.x - 0.5) * 0.3, r.y);
            d.lie = 1.0;
            d.nrm = vec3(0.0, 1.0, 0.0);
            d.height = r.x * 0.03;
            d.wet = 1.0;
          } else if (part == 1 && !gold) {
            c = palette(9, lit, r.x);
          } else {
            c = palette(gold ? 10 : 11, lit, r.x);
            d.wet = gold ? 0.9 : 0.3;
          }
          d.pos = world;
          d.dir = aDir;
          d.size = aSize * P.z;
          d.c1 = jitter(c, r.yzw, 0.3);
          d.c2 = jitter(c * 1.15, r.wxy, 0.35);
          d.lift = 0.25;
          d.cell = part == 2 ? 4.0 + floor(r.z * 2.0) : -1.0;
          d.seed = float(gl_InstanceID);
        }`,
      minPx: [2.5, 4],
      maxPx: [120, 200],
    }),
    4,
  );
  return { mesh, uPot };
}

// ---------------------------------------------------------------------------------------------------- blobs in flight

export function createBlobs(shared: Shared, pal: PaletteUniforms, o: { msaa: boolean }) {
  const per = 44;
  const n = per * MAX_BLOBS;
  const rand = lcg(31337);
  const aLocal = new Float32Array(n * 3);
  const aInfo = new Float32Array(n * 2);
  for (let b = 0; b < MAX_BLOBS; b++) {
    for (let i = 0; i < per; i++) {
      const k = b * per + i;
      // points in a lumpy ball
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      const rr = 1.0 + rand() * 0.6;
      aLocal.set([Math.cos(a) * s * rr, u * rr, Math.sin(a) * s * rr], k * 3);
      aInfo.set([b, rand()], k * 2);
    }
  }
  // per blob: x, y, z, scale; and its colour slot
  const uBlob = { value: Array.from({ length: MAX_BLOBS }, () => new THREE.Vector4()) };
  const uBlobSlot = { value: Array.from({ length: MAX_BLOBS }, () => 1) };
  const mesh = dabMesh(
    dabGeometry(n, { aLocal: [aLocal, 3], aInfo: [aInfo, 2] }),
    dabMaterial(shared, {
      msaa: o.msaa,
      uniforms: { ...pal, uBlob, uBlobSlot },
      head: PALETTE_GLSL + /* glsl */ `
        in vec3 aLocal; in vec2 aInfo;
        uniform vec4 uBlob[${MAX_BLOBS}];
        uniform float uBlobSlot[${MAX_BLOBS}];`,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          int b = int(aInfo.x + 0.5);
          vec4 B = uBlob[b];
          if (B.w < 0.01) { d.alive = 0.0; return; }
          // it wobbles as it flies
          float t = uTime * 9.0 + aInfo.y * 6.0;
          vec3 p = aLocal * (1.0 + 0.18 * sin(t + aLocal.y * 3.0));
          vec3 world = B.xyz + p * B.w;
          vec3 n = normalize(aLocal);
          vec4 r = hash4(float(gl_InstanceID) * 0.71 + 2.0);
          int k = int(uBlobSlot[b] + 0.5);
          vec3 c = palette(k, litFace(n) + 0.1, r.x);
          d.pos = world;
          d.dir = normalize(vec3(n.z, 0.6, -n.x));
          d.size = vec2(1.2, 1.6) * B.w;
          d.c1 = jitter(c, r.yzw, 0.3);
          d.c2 = jitter(c * 1.2, r.wxy, 0.35);
          d.wet = 1.0;
          d.cell = 4.0 + floor(r.z * 2.0);
          d.seed = float(gl_InstanceID);
        }`,
      minPx: [3, 3],
    }),
    6,
  );
  return { mesh, uBlob, uBlobSlot };
}
