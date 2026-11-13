// Weapon icons and card stats, shared by the TV HUD and the phone.

import type { WeaponKind } from "./weapons.ts";

export const WEAPON_ICON: Record<WeaponKind, string> = {
  hammer: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 45V21" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><rect x="9" y="7" width="30" height="15" rx="3" fill="currentColor"/><path d="M9 10l-6 4.5 6 4.5zM39 10l6 4.5-6 4.5zM20 7l4-5 4 5z" fill="currentColor"/></svg>`,
  chainball: `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="7" cy="6" r="3" fill="currentColor"/><path d="M9 9l4 4M15 15l4 4M21 21l3 3" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/><circle cx="31" cy="31" r="9.5" fill="currentColor"/><path d="M31 17v5M31 40v5M17 31h5M40 31h5M21 21l3.5 3.5M41 41l-3.5-3.5M41 21l-3.5 3.5M21 41l3.5-3.5" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  sword: `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M13 35L39 6l4 0 0 4-29 26z" fill="currentColor"/><path d="M8 29l11 11" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/><path d="M5 43l7-7" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>`,
};

/**
 * 1–5 bars for the weapon cards, from weapons.ts:
 * weight from total mass (hammer ≈ 29 600, chain ≈ 39 000 spread out, katar ≈ 20 000),
 * reach from the furthest point (hammer 68 px, chain ≈ 83 px, katar 62 px), cut from sharpness × blade.
 */
export const WEAPON_STATS: Record<WeaponKind, { weight: number; reach: number; cut: number; blurb: string }> = {
  hammer: { weight: 4, reach: 3, cut: 2, blurb: "Heavy rod. Big stuns." },
  chainball: { weight: 4, reach: 5, cut: 2, blurb: "Long whip. Hard to aim." },
  sword: { weight: 2, reach: 2, cut: 5, blurb: "Fast. Slashes cut deep." },
};
