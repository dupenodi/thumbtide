// Power-ups as glossy candies: a round gumdrop in the power's colours, a white icon, a shine.
// Plain SVG, so they stay crisp on a 4K TV and look the same on phones.
import type { PowerKind } from "./shared.ts";

export const CANDY_COLORS: Record<PowerKind, [string, string, string]> = {
  turbo: ["#eaffff", "#44c8ff", "#1557c9"],
  mega: ["#fffbd0", "#ffcf2e", "#d96f00"],
  bomb: ["#ffe1c4", "#ff6a2b", "#b3170f"],
  shield: ["#f3e6ff", "#b072ff", "#5a1fc4"],
  rain: ["#ffe3f1", "#ff5fae", "#c8106b"],
  dry: ["#ffffff", "#9fe6ff", "#3b8fd6"],
};

const ICONS: Record<PowerKind, string> = {
  turbo: `<path d="M57 17 L31 56 H48 L41 85 L71 43 H53 Z"/>`,
  mega: `<g transform="rotate(-38 50 50)"><rect x="44.5" y="10" width="11" height="40" rx="5.5"/><rect x="42" y="49" width="16" height="11" rx="2"/><path d="M42 60 Q50 94 58 60 Z"/></g>`,
  bomb: `<circle cx="46" cy="58" r="21"/><path d="M58 40 Q64 26 75 28" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/><path d="M78 16 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3z" fill="#ffe35a"/>`,
  shield: `<path d="M50 16 L77 27 V49 C77 68 65 80 50 87 C35 80 23 68 23 49 V27 Z"/>`,
  rain: `<path d="M28 52 a13 13 0 0 1 7-23 a18 18 0 0 1 33 3 a12 12 0 0 1 4 20 Z"/><path d="M36 63 q-4 8 0 11 q4-3 0-11z M52 63 q-4 8 0 11 q4-3 0-11z M68 63 q-4 8 0 11 q4-3 0-11z"/>`,
  dry: `<g fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"><path d="M50 18 V84 M22 34 L78 68 M22 68 L78 34"/><path d="M42 24 L50 32 58 24 M42 78 L50 70 58 78" stroke-width="5"/></g>`,
};

/** A candy power-up as an SVG string. */
export function candySvg(kind: PowerKind): string {
  const [l, m, d] = CANDY_COLORS[kind];
  const id = `cg-${kind}`;
  return `<svg class="candy" viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <radialGradient id="${id}" cx="36%" cy="30%" r="78%">
        <stop offset="0" stop-color="${l}"/><stop offset=".38" stop-color="${m}"/><stop offset="1" stop-color="${d}"/>
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="44" fill="url(#${id})" stroke="${d}" stroke-width="4"/>
    <path d="M14 58 A37 37 0 0 0 86 58 A40 30 0 0 1 14 58 Z" fill="rgba(0,0,0,.14)"/>
    <g fill="#fff" stroke="rgba(0,0,0,.28)" stroke-width="4" paint-order="stroke" stroke-linejoin="round" transform="translate(50 52) scale(.62) translate(-50 -50)">${ICONS[kind]}</g>
    <ellipse cx="36" cy="25" rx="20" ry="11" fill="rgba(255,255,255,.75)" transform="rotate(-22 36 25)"/>
    <circle cx="70" cy="22" r="4" fill="rgba(255,255,255,.85)"/>
  </svg>`;
}
