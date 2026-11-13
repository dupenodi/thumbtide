// The canvas the game is played on: a primed ground of broad diagonal strokes, and above it the players' paint,
// read every frame from the game's grid (owner, stroke direction, when it was laid, how loaded the brush was).
import * as THREE from "three";
import { GRID_H, GRID_W } from "../shared.ts";
import { dabGeometry, dabMaterial, dabMesh, type Shared } from "./glsl.ts";

export const PALETTE_SIZE = 12; // 0 primer, 1..8 the brushes' paints, 9 white, 10 gold, 11 tin

export interface PaletteUniforms {
  uPalL: { value: THREE.Vector3[] };
  uPalM: { value: THREE.Vector3[] };
  uPalS: { value: THREE.Vector3[] };
}

export const PALETTE_GLSL = /* glsl */ `
uniform vec3 uPalL[${PALETTE_SIZE}];
uniform vec3 uPalM[${PALETTE_SIZE}];
uniform vec3 uPalS[${PALETTE_SIZE}];
vec3 palette(int k, float lit, float r) { return paint3(uPalL[k], uPalM[k], uPalS[k], lit, r); }
`;

const GRID_GLSL = /* glsl */ `
uniform vec2 uGrid;
in vec2 aCell;
in vec4 aRand;
// the room's light falls from a window at the upper left, broken up a little
// A stretched canvas has a clean edge: strokes near it run along it and stay inside.
void keepInside(inout Dab d) {
  vec2 h = uGrid * 0.5;
  float ex = min(d.pos.x + h.x, h.x - d.pos.x);
  float ez = min(d.pos.z + h.y, h.y - d.pos.z);
  float e = min(ex, ez);
  if (e > 4.0) return;
  d.dir = ex < ez ? vec3(0.0, 0.0, sign(d.dir.z + 1e-4)) : vec3(sign(d.dir.x + 1e-4), 0.0, 0.0);
  d.size.x = min(d.size.x, max(0.6, 2.0 * e - 0.3));
  d.size.y = min(d.size.y, max(1.2, 2.0 * min(ex < ez ? ez : ex, 5.0)));
}
float roomLight(vec2 xz) {
  return 0.66 - 0.16 * (xz.x / uGrid.x) - 0.14 * (xz.y / uGrid.y) + (texture(tNoise, xz / 37.0 + 0.3).g - 0.5) * 0.42;
}
`;

function gridAttributes(perCell: number) {
  const n = GRID_W * GRID_H * perCell;
  const aCell = new Float32Array(n * 2);
  const aRand = new Float32Array(n * 4);
  let s = 12345;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  let k = 0;
  for (let j = 0; j < GRID_H; j++) {
    for (let i = 0; i < GRID_W; i++) {
      for (let p = 0; p < perCell; p++, k++) {
        aCell[k * 2] = i;
        aCell[k * 2 + 1] = j;
        for (let c = 0; c < 4; c++) aRand[k * 4 + c] = rnd();
      }
    }
  }
  return { n, aCell, aRand };
}

export function createCanvas(shared: Shared, pal: PaletteUniforms, cells: Float32Array, o: { perCell: number; msaa: boolean }) {
  const tCells = new THREE.DataTexture(cells, GRID_W, GRID_H, THREE.RGBAFormat, THREE.FloatType);
  tCells.minFilter = tCells.magFilter = THREE.NearestFilter;
  tCells.generateMipmaps = false;
  tCells.needsUpdate = true;
  const uGrid = { value: new THREE.Vector2(GRID_W, GRID_H) };
  const group = new THREE.Group();

  // Underpainting: a flat ground so nothing ever shows through between strokes.
  const base = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_W, GRID_H).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(pal.uPalM.value[0]!.x, pal.uPalM.value[0]!.y, pal.uPalM.value[0]!.z) }),
  );
  base.position.y = -0.03;
  group.add(base);

  // The primer: broad, thin strokes laid on the diagonal, wandering a little.
  const primerAttr = gridAttributes(1);
  const primer = dabMesh(
    dabGeometry(primerAttr.n, { aCell: [primerAttr.aCell, 2], aRand: [primerAttr.aRand, 4] }),
    dabMaterial(shared, {
      msaa: o.msaa,
      uniforms: { ...pal, uGrid },
      head: PALETTE_GLSL + GRID_GLSL,
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 r = aRand;
          vec2 xz = aCell + 0.5 + (r.xy - 0.5) * 0.8 - uGrid * 0.5;
          float n = texture(tNoise, xz / 70.0).r;
          float ang = 0.7 + (n - 0.5) * 2.0 + (r.z - 0.5) * 0.35;
          d.pos = vec3(xz.x, 0.0, xz.y);
          d.dir = vec3(cos(ang), 0.0, sin(ang));
          d.lie = 1.0;
          d.size = vec2(3.2, 5.8) * (0.8 + 0.4 * r.yx);
          d.height = r.x * 0.02;
          keepInside(d);
          vec3 c = palette(0, roomLight(xz), r.w);
          d.c1 = jitter(c, r.yzw, 0.28);
          d.c2 = jitter(c * 1.04, r.wxy, 0.3);
          d.glaze = shadowAt(d.pos);
          d.seed = float(gl_InstanceID);
        }`,
      cells: [0, 4],
    }),
    0,
  );
  (primer.material as THREE.ShaderMaterial).uniforms.uImpasto = { value: 0.45 };
  group.add(primer);

  // The paint: `perCell` strokes per cell of the game's grid.
  const paintAttr = gridAttributes(o.perCell);
  const sizeK = o.perCell >= 2 ? 1 : 1.3;
  const paint = dabMesh(
    dabGeometry(paintAttr.n, { aCell: [paintAttr.aCell, 2], aRand: [paintAttr.aRand, 4] }),
    dabMaterial(shared, {
      msaa: o.msaa,
      uniforms: { ...pal, uGrid, tCells: { value: tCells } },
      head: PALETTE_GLSL + GRID_GLSL + "uniform highp sampler2D tCells;\n",
      body: /* glsl */ `
        void makeDab(inout Dab d) {
          vec4 c = texelFetch(tCells, ivec2(aCell), 0);
          int owner = int(c.x + 0.5);
          if (owner == 0) { d.alive = 0.0; return; }
          vec4 r = aRand;
          float age = uTime - c.z;
          vec2 xz = aCell + 0.5 + (r.xy - 0.5) * 0.9 - uGrid * 0.5;
          float ang = c.y + (r.z - 0.5) * 0.3;
          float thick = c.w;
          d.pos = vec3(xz.x, 0.0, xz.y);
          d.dir = vec3(cos(ang), 0.0, sin(ang));
          d.lie = 1.0;
          d.base = 1.0;
          d.size = vec2(2.4, 4.0) * ${sizeK.toFixed(2)} * (0.85 + 0.3 * r.yx) * mix(0.8, 1.12, thick);
          // later paint lies on top of earlier paint, from every side
          d.height = 0.06 + max(c.z, 0.0) * 0.003 + r.x * 0.02;
          keepInside(d);
          d.alive = smoothstep(0.0, 0.22, age - r.y * 0.06);
          float wet = 1.0 - smoothstep(0.6, 4.5, age);
          vec3 col = palette(owner, roomLight(xz) + (thick - 0.5) * 0.12, r.w);
          col = jitter(col, r.yzw, 0.5) * (1.0 - 0.08 * wet);
          d.c1 = col;
          d.c2 = jitter(col * 1.14, r.wxy, 0.55);
          d.wet = wet;
          d.dry = 1.0 - smoothstep(0.35, 0.62, thick);
          d.glaze = shadowAt(d.pos);
          d.seed = float(gl_InstanceID);
        }`,
    }),
    1,
  );
  group.add(paint);

  return {
    group,
    /** Call after the game's grid changed. */
    upload() {
      tCells.needsUpdate = true;
    },
  };
}
