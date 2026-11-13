// Dabs: everything on screen is a touch of a loaded brush, pinned to a point of the world, turned to lie along a
// direction (the way a stroke was pulled, the grain of a handle), in one mixed colour.
// Adapted from "Oil paint" by @blendi (https://patch.gg/blendi/oil-paint), MIT: see LICENSE-oilpaint.txt.
// Changes for Wet Paint: no shadow maps or mist; soft shadows come from a short list of round casters; dabs can
// be wet (glossy), dry (bristles give out), grow in along their stroke, or glow (added light).
import * as THREE from "three";
import { BRUSH_COLS, BRUSH_ROWS, createBrushSheet, createNoiseSheet } from "./brush.ts";

export const MAX_CASTERS = 44;

/** Uniforms every dab material shares (same objects, so one update reaches all). */
export function createShared() {
  return {
    uTime: { value: 0 },
    uPixel: { value: 0.001 },
    uSunDir: { value: new THREE.Vector3(-0.45, 0.8, -0.42).normalize() },
    tBrush: { value: createBrushSheet() },
    tNoise: { value: createNoiseSheet() },
    uImpasto: { value: 1 },
    uCasters: { value: Array.from({ length: MAX_CASTERS }, () => new THREE.Vector4()) },
    uCasterCount: { value: 0 },
    // a shadow is a glaze over the paint: the paint times the first, plus the second
    uGlazeMul: { value: new THREE.Vector3(0.58, 0.47, 0.56) },
    uGlazeAdd: { value: new THREE.Vector3(0.03, 0.02, 0.06) },
  };
}
export type Shared = ReturnType<typeof createShared>;

export const COMMON = /* glsl */ `
precision highp float;
precision highp int;
#define TAU 6.28318530718
#define MAX_CASTERS ${MAX_CASTERS}
uniform float uTime;
uniform float uPixel;
uniform vec3 uSunDir;
uniform sampler2D tBrush;
uniform sampler2D tNoise;
uniform float uImpasto;
uniform vec4 uCasters[MAX_CASTERS];
uniform int uCasterCount;
uniform vec3 uGlazeMul;
uniform vec3 uGlazeAdd;

vec4 hash4(float n) {
  vec4 q = fract(vec4(n) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}

// The painter's three mixes. x is how lit the spot is; r moves the edges about so that one zone breaks into
// the next dab by dab.
vec3 paint3(vec3 cl, vec3 cm, vec3 cs, float x, float r) {
  x += (r - 0.5) * 0.2;
  vec3 c = mix(cs, cm, smoothstep(0.24, 0.36, x));
  return mix(c, cl, smoothstep(0.56, 0.7, x));
}

// Broken colour: every dab is mixed a little differently on the palette (value, hue, strength).
vec3 jitter(vec3 c, vec3 r, float amount) {
  float a = (r.y - 0.5) * 0.9 * amount;
  vec3 k = vec3(0.57735);
  c = c * cos(a) + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - cos(a));
  float g = dot(c, vec3(0.3, 0.59, 0.11));
  c = mix(vec3(g), c, 1.0 + (r.z - 0.5) * 0.7 * amount);
  return max(c * (1.0 + (r.x - 0.5) * 0.5 * amount), 0.0);
}

// How much of a spot on the canvas lies in the shadow of something moving over it (brushes, pots, flying paint).
// Casters are round and soft: xy = where on the ground, z = radius, w = how dark.
float shadowAt(vec3 p) {
  float s = 0.0;
  for (int i = 0; i < MAX_CASTERS; i++) {
    if (i >= uCasterCount) break;
    vec4 c = uCasters[i];
    float d = length(p.xz - c.xy);
    s = max(s, c.w * (1.0 - smoothstep(c.z * 0.35, c.z, d)));
  }
  return s;
}

// Light on a thing that has a face: the room's light from the upper left, never quite black.
float litFace(vec3 n) {
  return clamp(dot(n, uSunDir) * 0.85 + 0.42, 0.0, 1.0);
}
`;

const VERT = (head: string, body: string) => /* glsl */ `
${COMMON}
uniform vec2 uMinPx;
uniform vec2 uMaxPx;
uniform vec2 uCells; // first cell of the brush sheet and how many to choose from
out vec2 vUv;
out vec3 vC1;
out vec3 vC2;
out vec4 vAxis;
out vec3 vFx; // wet, dry, glaze
struct Dab {
  vec3 pos;    // where it is pinned
  vec3 dir;    // the way the stroke runs, in the world
  vec2 size;   // across and along, world units
  vec3 c1;     // its colour
  vec3 c2;     // the colour streaked into it
  float seed;
  float alive; // 0 gone .. 1 whole (it grows in along its stroke)
  float lift;  // how far it stands off its surface toward the eye, in its own sizes
  float base;  // 1: pinned by its foot instead of its middle
  float spin;  // a turn on the canvas, radians
  float turnabout; // 1: laid with either end first
  float cell;  // which mark of the brush sheet, or -1 to let it choose
  float lie;   // 1: lies flat on its surface (nrm) instead of facing the eye
  vec3 nrm;    // the surface it lies on
  float height; // how far above the surface it is laid: higher is on top
  float wet;   // 0..1 fresh, glossy paint
  float dry;   // 0..1 the brush ran dry: bristles give out
  float glaze; // 0..1 in shadow
};
${head}
void makeDab(inout Dab d);
${body}
void main() {
  Dab d;
  d.pos = vec3(0.0); d.dir = vec3(0.0, 1.0, 0.0); d.size = vec2(0.1, 0.2);
  d.c1 = vec3(0.5); d.c2 = vec3(0.5); d.seed = float(gl_InstanceID); d.alive = 1.0; d.lift = 0.6; d.base = 0.0;
  d.spin = 0.0; d.turnabout = 0.0; d.cell = -1.0; d.lie = 0.0; d.nrm = vec3(0.0, 1.0, 0.0); d.height = 0.0;
  d.wet = 0.0; d.dry = 0.0; d.glaze = 0.0;
  makeDab(d);
  vec4 r = hash4(d.seed * 1.37 + 5.1);
  vec2 across, along;
  vec4 vc;
  if (d.alive < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (d.lie > 0.5) {
    vec3 Nn = normalize(d.nrm);
    vec3 A = d.dir - Nn * dot(d.dir, Nn);
    A = dot(A, A) > 1e-8 ? normalize(A) : normalize(cross(Nn, vec3(1.0, 0.0, 0.0)));
    vec3 B = cross(Nn, A);
    vec2 half_ = d.size * 0.5;
    // growing in: the tail stays where the brush touched down, the head runs on along the stroke
    vec3 P = d.pos + Nn * d.height - A * half_.y * (1.0 - d.alive) * d.base;
    half_.y *= d.alive;
    half_.x *= mix(0.55, 1.0, d.alive);
    vc = viewMatrix * vec4(P, 1.0);
    float dist = -vc.z;
    if (dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 a = mat3(viewMatrix) * A * half_.y;
    vec3 b = mat3(viewMatrix) * B * half_.x;
    // on the canvas the patch is a slanted box; if its thin way is under the least size, stand it up to that
    float la = length(a.xy), lb = length(b.xy);
    float thin = abs(a.x * b.y - a.y * b.x) / max(max(la, lb), 1e-6);
    float need = uMinPx.x * 0.5 * dist * uPixel;
    if (thin < need) {
      if (la > lb) {
        vec2 perp = vec2(-a.y, a.x) / max(la, 1e-6);
        b.xy += perp * (dot(b.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      } else {
        vec2 perp = vec2(-b.y, b.x) / max(lb, 1e-6);
        a.xy += perp * (dot(a.xy, perp) < 0.0 ? -1.0 : 1.0) * (need - thin);
      }
    }
    vc.xyz += a * position.y + b * position.x;
    along = normalize(a.xy + 1e-6);
    across = normalize(b.xy + 1e-6);
  } else {
    vc = viewMatrix * vec4(d.pos, 1.0);
    float dist = -vc.z;
    if (dist < 0.1) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vec3 vd = mat3(viewMatrix) * normalize(d.dir);
    float flatness = length(vd.xy);
    float a0 = r.x * TAU;
    along = flatness > 1e-4 ? vd.xy / flatness : vec2(0.0, 1.0);
    // a stroke that points at the eye has no direction on the canvas: give it its own
    along = normalize(mix(vec2(cos(a0), sin(a0)), along, smoothstep(0.08, 0.4, flatness)));
    float cs = cos(d.spin), sn = sin(d.spin);
    along = vec2(along.x * cs - along.y * sn, along.x * sn + along.y * cs);
    across = vec2(along.y, -along.x);
    float px = dist * uPixel;
    vec2 half_ = clamp(d.size, uMinPx * px, uMaxPx * px) * 0.5 * d.alive;
    float lift = d.lift * max(half_.x, half_.y) * (0.6 + 0.8 * r.y);
    vc.xyz *= 1.0 - min(lift / dist, 0.3);
    float t = mix(position.y, position.y + 1.0, d.base);
    vc.xy += across * position.x * half_.x + along * t * half_.y;
  }
  gl_Position = projectionMatrix * vc;
  float cell = d.cell >= 0.0 ? d.cell : uCells.x + floor(r.z * uCells.y * 0.999);
  float flip = r.w > 0.5 ? -1.0 : 1.0;
  float end_ = d.turnabout > 0.5 && fract(r.x * 7.13) > 0.5 ? -1.0 : 1.0;
  vec2 q = vec2(position.x * flip, position.y * end_) * 0.5 + 0.5;
  vUv = (vec2(mod(cell, ${BRUSH_COLS}.0), floor(cell / ${BRUSH_COLS}.0)) + q) / vec2(${BRUSH_COLS}.0, ${BRUSH_ROWS}.0);
  vC1 = d.c1;
  vC2 = d.c2;
  vAxis = vec4(across * flip, along * end_);
  vFx = vec3(d.wet, d.dry, d.glaze);
}
`;

const FRAG = /* glsl */ `
${COMMON}
in vec2 vUv;
in vec3 vC1;
in vec3 vC2;
in vec4 vAxis;
in vec3 vFx;
layout(location = 0) out vec4 outC;
void main() {
  vec4 t = texture(tBrush, vUv);
  if (t.g < 0.3) discard;
  // a brush running dry: the bristles give out along their streaks
  if (vFx.y > 0.0 && t.b < vFx.y * 0.7) discard;
  vec2 e = vec2(1.5 / 512.0, 0.0);
  float hu = texture(tBrush, vUv + e.xy).r - texture(tBrush, vUv - e.xy).r;
  float hv = texture(tBrush, vUv + e.yx).r - texture(tBrush, vUv - e.yx).r;
  // the paint stands up off the canvas and the room's light, from the upper left, rakes across it
  vec2 g = vAxis.xy * hu + vAxis.zw * hv;
  float rake = 0.5 * g.x - 0.7 * g.y;
  vec3 col = mix(vC1, vC2, smoothstep(0.52, 0.78, t.b));
  col = mix(col, col * uGlazeMul + uGlazeAdd, vFx.z);
  float impasto = uImpasto * (1.0 - vFx.y * 0.6);
  col *= mix(0.95, 1.04, t.r);
  col *= 1.0 + rake * 1.25 * impasto;
  // wet paint shines on its ridges
  col += vec3(1.0, 0.97, 0.9) * pow(max(rake, 0.0), 2.0) * (1.2 + vFx.x * 3.5) * impasto;
  col += vec3(1.0, 0.98, 0.94) * vFx.x * 0.22 * smoothstep(0.7, 0.95, t.r) * (1.0 - vFx.z);
  outC = vec4(col, smoothstep(0.3, 0.62, t.g));
}
`;

// Added light (a gold pot's glow, sparkles): the marks add up instead of covering.
const FRAG_GLOW = /* glsl */ `
${COMMON}
in vec2 vUv;
in vec3 vC1;
in vec3 vC2;
in vec4 vAxis;
in vec3 vFx;
layout(location = 0) out vec4 outC;
void main() {
  vec4 t = texture(tBrush, vUv);
  float a = smoothstep(0.2, 0.6, t.g) * (0.55 + 0.45 * t.r);
  if (a < 0.01) discard;
  outC = vec4(mix(vC1, vC2, t.b) * a, 1.0);
}
`;

export interface DabMaterialOptions {
  head?: string;
  body: string;
  uniforms?: Record<string, THREE.IUniform>;
  minPx?: [number, number];
  maxPx?: [number, number];
  cells?: [number, number];
  glow?: boolean;
  msaa?: boolean;
}

export function dabMaterial(shared: Shared, o: DabMaterialOptions): THREE.ShaderMaterial {
  const glow = o.glow ?? false;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VERT(o.head ?? "", o.body),
    fragmentShader: glow ? FRAG_GLOW : FRAG,
    uniforms: {
      ...shared,
      uMinPx: { value: new THREE.Vector2(...(o.minPx ?? [4, 7])) },
      uMaxPx: { value: new THREE.Vector2(...(o.maxPx ?? [400, 700])) },
      uCells: { value: new THREE.Vector2(...(o.cells ?? [0, 8])) },
      ...o.uniforms,
    },
    side: THREE.DoubleSide,
    alphaToCoverage: !glow && (o.msaa ?? true),
    transparent: glow,
    blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthTest: true,
    depthWrite: !glow,
  });
}

/** The card every dab is drawn with, `count` times; `attributes` are per dab: { name: [array, itemSize] }. */
export function dabGeometry(
  count: number,
  attributes: Record<string, [Float32Array, number]> = {},
  dynamic = false,
): THREE.InstancedBufferGeometry {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, [array, size]] of Object.entries(attributes)) {
    const a = new THREE.InstancedBufferAttribute(array, size);
    if (dynamic) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = count;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function dabMesh(geometry: THREE.BufferGeometry, material: THREE.Material, order = 0): THREE.Mesh {
  const m = new THREE.Mesh(geometry, material);
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.renderOrder = order;
  return m;
}

/** "#rrggbb" → vec3 of paint values (written as-is: colours here are paint, not light). */
export function hexVec(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const glslVec3 = (v: THREE.Vector3) => `vec3(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})`;
