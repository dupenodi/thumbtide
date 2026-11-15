// Weapon icons and card stats, shared by the TV HUD and the phone. Stats are computed from weapons.ts, so the cards
// always match the physics.

import { type Material, WEAPON_KINDS, WEAPONS, type WeaponClass, type WeaponKind } from "./weapons.ts";

const CLASS_ICON: Record<WeaponClass, string> = {
  hammer: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 45V21" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><rect x="9" y="7" width="30" height="15" rx="3" fill="currentColor"/><path d="M9 10l-6 4.5 6 4.5zM39 10l6 4.5-6 4.5zM20 7l4-5 4 5z" fill="currentColor"/></svg>`,
  axe: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M17 45L31 9" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M27 6c9 0 16 5 17 14-6-1-11 0-16 3z" fill="currentColor"/></svg>`,
  mace: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="7" cy="6" r="3" fill="currentColor"/><path d="M9 9l4 4M15 15l4 4M21 21l3 3" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="31" cy="31" r="9.5" fill="currentColor"/><path d="M31 17v5M31 40v5M17 31h5M40 31h5M21 21l3.5 3.5M41 41l-3.5-3.5M41 21l-3.5 3.5M21 41l3.5-3.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  sword: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 35L39 6l4 0 0 4-29 26z" fill="currentColor"/><path d="M8 29l11 11" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M5 43l7-7" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>`,
  dual: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="5" fill="currentColor"/><path d="M27 21L43 5M21 27L5 43" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><path d="M36 6l6 0 0 6-7 3zM12 42l-6 0 0-6 7-3z" fill="currentColor"/></svg>`,
};

export const WEAPON_ICON = Object.fromEntries(WEAPON_KINDS.map((k) => [k, CLASS_ICON[WEAPONS[k].cls]])) as Record<WeaponKind, string>;

/** Icon colour by material. */
export const MATERIAL_TINT: Record<Material, string> = {
  wood: "#c08a55",
  iron: "#aeb6c6",
  stone: "#9a9ea8",
  silver: "#e9eef8",
  steel: "#dfe8f4",
  gold: "#f2c14e",
};

export const WEAPON_TINT = Object.fromEntries(
  WEAPON_KINDS.map((k) => {
    const w = WEAPONS[k];
    const main = w.parts.find((p) => p.key === w.striker) ?? w.parts[0]!;
    return [k, MATERIAL_TINT[main.material]];
  }),
) as Record<WeaponKind, string>;

function area(mesh: number[]): number {
  let s = 0;
  const n = mesh.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += mesh[2 * i]! * mesh[2 * j + 1]! - mesh[2 * j]! * mesh[2 * i + 1]!;
  }
  return Math.abs(s) / 2;
}

/** Raw numbers per weapon: total mass, furthest reach from the machine centre (px), best cutting power. */
const raw = WEAPON_KINDS.map((k) => {
  const w = WEAPONS[k];
  let mass = 0;
  let reach = 0;
  let cut = 0;
  for (const p of w.parts) {
    mass += area(p.mesh) * p.density;
    // parts hang straight down; with the default angle local +x points away, otherwise local +y does
    let far = 0;
    for (let i = 0; i < p.mesh.length; i += 2) far = Math.max(far, p.angle === 0 ? p.mesh[i + 1]! : p.mesh[i]!);
    reach = Math.max(reach, Math.abs(p.hang) + far);
    cut = Math.max(cut, p.sharpness * (1 + 1.5 * p.bladeable));
  }
  return { k, mass, reach, cut };
});

const scale = (vals: number[], v: number) => {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return hi > lo ? Math.round(1 + (4 * (v - lo)) / (hi - lo)) : 3;
};

/** 1–5 bars for the weapon cards. */
export const WEAPON_STATS = Object.fromEntries(
  raw.map((r) => [
    r.k,
    {
      weight: scale(raw.map((x) => x.mass), r.mass),
      reach: scale(raw.map((x) => x.reach), r.reach),
      cut: scale(raw.map((x) => x.cut), r.cut),
      blurb: WEAPONS[r.k].blurb,
    },
  ]),
) as Record<WeaponKind, { weight: number; reach: number; cut: number; blurb: string }>;
