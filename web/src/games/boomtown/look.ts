// Boomtown's look: the palette, the geometry of the ring, the pawn and special-space drawings (inline SVG, shared by
// the TV and the phones).
import { PAWN_SHAPES, PLAYER_COLORS } from "./shared.ts";
import type { SpecialKind } from "./rules.ts";

export const INK = "#1e2a2f";
export const PAPER = "#f7f5ef";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// ------------------------------------------------------------------ the ring: 28 spaces round an 8x8 grid
export const GRID = 8;
export const CELL = 125;

/** Column and row of space `i`: from the bottom-left corner up the left side, along the top, down the right, back along the bottom. */
export function ringXY(i: number): [number, number] {
  const n = GRID - 1;
  if (i <= n) return [0, n - i];
  if (i <= 2 * n) return [i - n, 0];
  if (i <= 3 * n) return [n, i - 2 * n];
  return [n - (i - 3 * n), n];
}

/** Which edge of the cell faces the middle of the board (where the colour band goes). */
export function innerSide(i: number): "t" | "r" | "b" | "l" {
  const [c, r] = ringXY(i);
  if (r === GRID - 1 && c !== GRID - 1) return "t"; // bottom row (and the corner 0)
  if (r === 0) return "b"; // top row, and its corners
  if (c === 0) return "r"; // left column
  if (c === GRID - 1) return "l";
  return "t";
}

// ------------------------------------------------------------------ pawns
const star = (() => {
  const pts: string[] = [];
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const r = k % 2 ? 7.5 : 16;
    pts.push(`${(20 + Math.cos(a) * r).toFixed(1)},${(20 + Math.sin(a) * r + 1).toFixed(1)}`);
  }
  return pts.join(" ");
})();

const SHAPE_SVG: Record<(typeof PAWN_SHAPES)[number], string> = {
  circle: `<circle cx="20" cy="20" r="14.5"/>`,
  square: `<rect x="6.5" y="6.5" width="27" height="27" rx="3"/>`,
  triangle: `<polygon points="20,5 35.5,33.5 4.5,33.5" stroke-linejoin="round"/>`,
  diamond: `<polygon points="20,3.5 36.5,20 20,36.5 3.5,20" stroke-linejoin="round"/>`,
  hexagon: `<polygon points="20,4 33.5,12 33.5,28 20,36 6.5,28 6.5,12" stroke-linejoin="round"/>`,
  star: `<polygon points="${star}" stroke-linejoin="round"/>`,
};

/** A pawn of seat `color` (0–5), `size` px. */
export function pawnSvg(color: number, size = 40): string {
  const c = color % PLAYER_COLORS.length;
  const fill = PLAYER_COLORS[c]!;
  const stroke = fill === INK ? PAPER : INK;
  return `<svg class="bt-pawn-svg" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true"><g fill="${fill}" stroke="${stroke}" stroke-width="3">${SHAPE_SVG[PAWN_SHAPES[c]!]}</g></svg>`;
}

// ------------------------------------------------------------------ special spaces
const ICONS: Record<SpecialKind, string> = {
  start: `<path d="M6 24h30M26 13l11 11-11 11"/><path d="M6 12v24"/>`,
  market: `<path d="M17 11h14M24 4v7"/><path d="M18 11c-9 7-9 24 0 31h12c9-7 9-24 0-31"/><path d="M17 25h14"/>`,
  ferry: `<path d="M5 29h38l-6 10H11z"/><path d="M13 29V17h22v12M24 8v9"/>`,
  tax: `<circle cx="24" cy="24" r="16"/><path d="M24 13v22M18 19c0-5 12-5 12 0s-12 4-12 9 12 5 12 0"/>`,
  strike: `<rect x="8" y="6" width="32" height="20" rx="2"/><path d="M24 26v16M15 16h18"/>`,
  festival: `<path d="M5 12h38"/><path d="M7 12l7 18 7-18M21 12l7 18 7-18M35 12l6 14"/>`,
};

export function iconSvg(kind: SpecialKind, size = 44): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[kind]}</svg>`;
}

// ------------------------------------------------------------------ dice
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
export const dieFace = (n: number) => {
  const on = new Set(PIPS[n] ?? []);
  return Array.from({ length: 9 }, (_, i) => `<b${on.has(i) ? ' class="on"' : ""}></b>`).join("");
};

export const money = (n: number) => `$${n.toLocaleString("en-US")}`;
export const clockText = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
