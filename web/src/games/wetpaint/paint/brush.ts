// The brush sheet and the noise sheet, made in code.
// Adapted from "Oil paint" by @blendi (https://patch.gg/blendi/oil-paint), MIT: see LICENSE-oilpaint.txt.
//
// The brush sheet holds eight marks of a loaded bristle brush. Each cell holds one mark laid along +v:
// r is how thick the paint stands (for the light that rakes across it), g is where there is paint at all,
// b is a slow streak along the bristles (where a second colour was picked up and not mixed in).
import * as THREE from "three";

export const BRUSH_COLS = 4;
export const BRUSH_ROWS = 2;
const CW = 128;
const CH = 256;

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const smooth = (t: number) => t * t * (3 - 2 * t);
const n1 = (x: number, seed: number) => {
  const i = Math.floor(x);
  const f = smooth(x - i);
  return hash(i + seed * 57.3) * (1 - f) + hash(i + 1 + seed * 57.3) * f;
};
const n2 = (x: number, y: number, seed: number) => {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = smooth(x - i);
  const fy = smooth(y - j);
  const h = (a: number, b: number) => hash(a * 1.31 + b * 91.7 + seed * 13.9);
  return (h(i, j) * (1 - fx) + h(i + 1, j) * fx) * (1 - fy) + (h(i, j + 1) * (1 - fx) + h(i + 1, j + 1) * fx) * fy;
};
const sstep = (a: number, b: number, x: number) => smooth(Math.min(1, Math.max(0, (x - a) / (b - a))));

/** One mark: kind 0 a long stroke that runs dry, 1 a short fat dab, 2 a stroke with a curve to it. */
function mark(u: number, v: number, seed: number, kind: number): [number, number, number] {
  const bend = kind === 2 ? (seed % 2 ? 0.34 : -0.34) : (hash(seed * 3.1) - 0.5) * 0.12;
  const ub = u - bend * (4 * (v - 0.5) * (v - 0.5) - 0.5);
  const wob = (n1(v * 5, seed + 3) - 0.5) * 0.1;
  const a = Math.abs(ub + wob);
  if (kind === 1) {
    // a pressed dab: fat in the middle, ragged all round
    const r = Math.hypot(ub / 0.66, (v - 0.5) / 0.44);
    const edge = 1 + (n1(Math.atan2(v - 0.5, ub) * 2.2 + 9, seed) - 0.5) * 0.34;
    const inside = 1 - sstep(edge - 0.16, edge, r);
    const bristle = n1(ub * 11, seed + 11);
    const dry = sstep(0.55, 1.0, r) * 0.9;
    const alpha = inside * (bristle > dry * 0.8 ? 1 : 0.25);
    const ridge = n1(ub * 13 + n1(v * 3, seed) * 1.5, seed + 31);
    const height = alpha * (0.4 + 0.22 * ridge * n1(ub * 9, seed + 5) + 0.3 * sstep(0.45, 0.95, r) + 0.12 * n2(ub * 4, v * 6, seed));
    return [height, alpha, n2(ub * 3.2, v * 1.3, seed + 20)];
  }
  const half = 0.6 * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(1, v * 1.15))) * (1 + (n1(v * 7, seed + 1) - 0.5) * 0.1);
  const start = 0.05 + 0.05 * n1(ub * 5, seed + 2);
  const end = 0.95 - 0.3 * n1(ub * 4.5 + 2, seed + 4) - 0.06 * n1(ub * 19, seed + 6);
  const side = 1 - sstep(half - 0.07, half, a);
  const head = sstep(start, start + 0.035, v);
  const tail = 1 - sstep(end - 0.02, end + 0.015, v);
  // the brush runs dry toward the end: single bristles give out and leave gaps
  const dryness = sstep(end - 0.2, end, v);
  const bristle = n1(ub * 13, seed + 8) * 0.7 + n1(ub * 31, seed + 9) * 0.3;
  const gap = 1 - sstep(dryness * 0.55 - 0.08, dryness * 0.55, bristle) < 0.5 ? 1.0 : 0.0;
  const alpha = side * head * tail * gap;
  const furrow = n1(ub * 12 + n1(v * 2.5, seed + 12) * 1.2, seed + 33) * 0.7 + n1(ub * 29, seed + 34) * 0.3;
  const load = 1 - 0.55 * sstep(0.1, 0.9, v); // thick where the brush touched down, thin where it left
  const squeezed = sstep(half - 0.3, half - 0.06, a); // paint pushed out to the sides of the stroke
  const height =
    alpha *
    (0.3 +
      0.22 * furrow * (0.5 + 0.5 * n1(ub * 11, seed + 13)) +
      0.3 * squeezed +
      0.25 * load * (1 - sstep(start, start + 0.25, v)) +
      0.1 * n2(ub * 3, v * 7, seed + 14));
  return [Math.min(1, height), alpha, n2(ub * 3.4, v * 1.1, seed + 20)];
}

export function createBrushSheet(): THREE.DataTexture {
  const W = CW * BRUSH_COLS;
  const H = CH * BRUSH_ROWS;
  const data = new Uint8Array(W * H * 4);
  const kinds = [0, 0, 0, 2, 1, 1, 0, 2];
  for (let cell = 0; cell < 8; cell++) {
    const cx = cell % BRUSH_COLS;
    const cy = Math.floor(cell / BRUSH_COLS);
    for (let y = 0; y < CH; y++) {
      for (let x = 0; x < CW; x++) {
        // a margin of nothing round each mark, so the small copies of the sheet don't bleed into each other
        const u = ((x + 0.5) / CW) * 2 - 1;
        const v = (y + 0.5) / CH;
        const m = 0.9;
        const [h, a, s] =
          Math.abs(u) > m || v < 0.04 || v > 0.96 ? [0, 0, 0.5] : mark(u / m, (v - 0.04) / 0.92, cell * 7 + 1, kinds[cell]!);
        const i = (cx * CW + x + (cy * CH + y) * W) * 4;
        data[i] = Math.round(h * 255);
        data[i + 1] = Math.round(a * 255);
        data[i + 2] = Math.round(s * 255);
        data[i + 3] = 255;
      }
    }
  }
  const t = new THREE.DataTexture(data, W, H);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** A tiling noise sheet: four unrelated smooth noises in the four channels, with mipmaps. */
export function createNoiseSheet(size = 256, seed = 7): THREE.DataTexture {
  let s = seed >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const field = new Float32Array(size * size);
    // octaves of value noise on lattices that divide the sheet, so it tiles
    for (const [cells, amp] of [[8, 1], [16, 0.5], [32, 0.25], [64, 0.125]] as const) {
      const lat = new Float32Array(cells * cells);
      for (let i = 0; i < lat.length; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells;
          const fy = (y / size) * cells;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          let tx = fx - x0;
          let ty = fy - y0;
          tx = tx * tx * (3 - 2 * tx);
          ty = ty * ty * (3 - 2 * ty);
          const a = lat[(x0 % cells) + (y0 % cells) * cells]!;
          const b = lat[((x0 + 1) % cells) + (y0 % cells) * cells]!;
          const c = lat[(x0 % cells) + ((y0 + 1) % cells) * cells]!;
          const d = lat[((x0 + 1) % cells) + ((y0 + 1) % cells) * cells]!;
          field[x + y * size]! += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        }
      }
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of field) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    for (let i = 0; i < field.length; i++) data[i * 4 + ch] = Math.round(((field[i]! - lo) / (hi - lo)) * 255);
  }
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
