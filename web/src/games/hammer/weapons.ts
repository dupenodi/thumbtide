// Machine and weapon data. Most of it is taken from Hammerfight's object files
// (D:\Steam\steamapps\common\Hammerfight\Demo\*.seria and Objects\Weapons\*.seria): the collision meshes in px with
// local +x pointing away from the machine, m_fDensity (so mass ratios match the original), m_sharpness, the two-sided
// m_sharpness_u/_d and m_bladeable_u/_d, and the joints. Joint types: 2 = rod that aims the part at its parent,
// 3 = rope that aims, 5 = short rope between offset anchors with a soft turn (see HAMMERFIGHT_PHYSICS.md → Joints).
//
// Hammerfight has no wooden weapons and no "great maul" in its files; those three (mallet, maul, flail) are ours,
// made from the original shapes with other densities and sharpness, and are marked OURS below. So are the rod lengths
// of the berdish and the kathib (their files hold the blade only).

export type WeaponClass = "hammer" | "axe" | "mace" | "sword";
export type Material = "wood" | "iron" | "stone" | "silver" | "steel";

export type WeaponKind =
  | "mallet"
  | "hammer"
  | "maul"
  | "bagor"
  | "axe"
  | "berdish"
  | "flail"
  | "chainball"
  | "silvermace"
  | "kathib"
  | "sword"
  | "hisaian";

/** In card order: one row per class, light → heavy. */
export const WEAPON_KINDS: WeaponKind[] = ["mallet", "hammer", "maul", "bagor", "axe", "berdish", "flail", "chainball", "silvermace", "kathib", "sword", "hisaian"];

/** The convex hull of a polygon (x,y pairs). Collisions need convex shapes; one original axe head is hook-shaped. */
function hull(v: number[]): number[] {
  const pts: [number, number][] = [];
  for (let i = 0; i < v.length; i += 2) pts.push([v[i]!, v[i + 1]!]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat();
}

const box = (hx: number, hy: number) => [-hx, -hy, hx, -hy, hx, hy, -hx, hy];

/** class PC: mesh 24.996 × 32.995, m_fDensity 80, health 100, health_low 12. */
export const MACHINE = {
  mesh: box(12.4981, 16.4975),
  density: 80,
  health: 100,
  healthLow: 12,
  /** Human spin damping (0x44c930): torque −= 2e6 · ω. */
  spinDamp: 2e6,
};

export interface PartSpec {
  key: string;
  mesh: number[];
  density: number;
  /** m_sharpness, and the other side's value when it differs (blunt back of an axe or sabre: m_sharpness_u). */
  sharpness: number;
  sharpnessU?: number;
  /** m_bladeable_d, and m_bladeable_u for the other edge when it differs (0 = that edge doesn't cut). */
  bladeable: number;
  bladeableU?: number;
  /** Where the part's origin sits below the machine centre at spawn (the weapon hangs straight down). */
  hang: number;
  /** Spawn angle; default π/2 (local +x pointing down, away from the machine). */
  angle?: number;
  /** Drawing hint. */
  look: "hammer" | "mallet" | "axe" | "blade" | "link" | "handle" | "ball";
  material: Material;
  /** Draw a shaft from the machine to this part (parts on a rod joint). */
  rod?: boolean;
}

export interface JointSpec {
  /** "hull" or a part key. */
  a: string;
  b: string;
  type: number;
  radius: number;
  sax?: number;
  say?: number;
  sbx?: number;
  sby?: number;
  /** m_necess: last joint pass this joint takes part in. Rods use 5; chains use 999 (all passes). */
  necess: number;
}

export interface WeaponSpec {
  kind: WeaponKind;
  cls: WeaponClass;
  /** 1 light … 3 heavy. */
  tier: 1 | 2 | 3;
  label: string;
  blurb: string;
  /** True when the weapon is made by us rather than taken from Hammerfight's files. */
  ours?: boolean;
  parts: PartSpec[];
  joints: JointSpec[];
  /** The part that does most of the hitting (for trails and clashes). */
  striker: string;
}

// ---------------------------------------------------------------- building blocks
const HAMMER_HEAD = box(8.49872, 14.4978); // hammer_iron 17 × 29

const linkPart = (i: number, hang: number, density: number, material: Material): PartSpec => ({
  key: `link${i}`,
  mesh: box(4.99925, 2.99955), // chain_small: 10 × 6
  density,
  sharpness: 1,
  bladeable: 0,
  hang,
  look: "link",
  material,
});

const OCTAGON = [4.97488, 12.0104, -4.97489, 12.0104, -12.0104, 4.97488, -12.0104, -4.97489, -4.97488, -12.0104, 4.97489, -12.0104, 12.0104, -4.97488, 12.0104, 4.97488];

/** mace_stone's layout: 6 links, a handle on a short rope, a ball on the handle. */
function chainMace(
  kind: WeaponKind,
  o: { tier: 1 | 2 | 3; label: string; blurb: string; ours?: boolean; link: number; handle: number; ball: number; sharpness: number; material: Material },
): WeaponSpec {
  const linkMat: Material = o.material === "wood" ? "wood" : "iron";
  return {
    kind,
    cls: "mace",
    tier: o.tier,
    label: o.label,
    blurb: o.blurb,
    ours: o.ours,
    striker: "ball",
    parts: [
      linkPart(0, 10, o.link, linkMat),
      linkPart(1, 17, o.link, linkMat),
      linkPart(2, 24, o.link, linkMat),
      linkPart(3, 31, o.link, linkMat),
      linkPart(4, 38, o.link, linkMat),
      linkPart(5, 45, o.link, linkMat),
      { key: "handle", mesh: box(15.4977, 4.49932), density: o.handle, sharpness: 1, bladeable: 0, hang: 59, look: "handle", material: "wood" },
      { key: "ball", mesh: OCTAGON, density: o.ball, sharpness: o.sharpness, bladeable: 0, hang: 70, look: "ball", material: o.material },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      { a: "link0", b: "link1", type: 3, radius: 7, necess: 999 },
      { a: "link1", b: "link2", type: 3, radius: 7, necess: 999 },
      { a: "link2", b: "link3", type: 3, radius: 7, necess: 999 },
      { a: "link3", b: "link4", type: 3, radius: 7, necess: 999 },
      { a: "link4", b: "link5", type: 3, radius: 7, necess: 999 },
      { a: "link5", b: "handle", type: 5, radius: 2, sbx: -12, necess: 999 },
      { a: "handle", b: "ball", type: 5, radius: 3, sax: 8, necess: 999 },
    ],
  };
}

/** One rigid head on a rod (hammers, axes, swords). */
function rodWeapon(
  kind: WeaponKind,
  cls: WeaponClass,
  o: { tier: 1 | 2 | 3; label: string; blurb: string; ours?: boolean; rod: number; sby?: number; necess?: number; part: Omit<PartSpec, "key" | "hang" | "rod"> },
): WeaponSpec {
  return {
    kind,
    cls,
    tier: o.tier,
    label: o.label,
    blurb: o.blurb,
    ours: o.ours,
    striker: "head",
    parts: [{ key: "head", hang: o.rod, rod: true, ...o.part }],
    joints: [{ a: "hull", b: "head", type: 2, radius: o.rod, sby: o.sby ?? 0, necess: o.necess ?? 5 }],
  };
}

// ---------------------------------------------------------------- the roster
const list: WeaponSpec[] = [
  // Hammers: "the easiest to handle; smashes armor with its weight".
  rodWeapon("mallet", "hammer", {
    tier: 1,
    label: "Wooden mallet",
    blurb: "Light and easy. Weak hits.",
    ours: true, // OURS: hammer_iron's head in wood
    rod: 54,
    part: { mesh: HAMMER_HEAD, density: 28, sharpness: 1.5, bladeable: 0, look: "mallet", material: "wood" },
  }),
  // hammer_iron.seria: rod 60, 17 × 29, density 60, sharpness 2
  rodWeapon("hammer", "hammer", {
    tier: 2,
    label: "Spiked hammer",
    blurb: "Heavy rod. Big stuns.",
    rod: 60,
    part: { mesh: HAMMER_HEAD, density: 60, sharpness: 2, bladeable: 0, look: "hammer", material: "iron" },
  }),
  rodWeapon("maul", "hammer", {
    tier: 3,
    label: "Great maul",
    blurb: "Huge and slow. Drags you round.",
    ours: true, // OURS: hammer_iron scaled ×1.25 on a longer rod, denser
    rod: 70,
    part: { mesh: box(10.6, 18.1), density: 70, sharpness: 2.4, bladeable: 0, look: "hammer", material: "iron" },
  }),

  // Axes: "as heavy as a hammer and sharp as a sword, yet its shaft is short"; one edge cuts.
  // bagor.seria: rod 48 (shiftB_y 1.5), density 42, sharpness 3, bladeable_u 0
  rodWeapon("bagor", "axe", {
    tier: 1,
    label: "Bagor",
    blurb: "Light hook-axe. One sharp edge.",
    rod: 48,
    sby: 1.5,
    part: {
      mesh: hull([-14.415, 12.79, -4.319, 15.632, 6.077, 8.302, 11.424, -0.449, 14.415, -15.632, -8.507, -15.033]),
      density: 42,
      sharpness: 3,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "iron",
    },
  }),
  // axe_iron.seria: rod 55 (shiftB_y −3), 18 × 23, density 65, sharpness 3 (back 0.5), bladeable_u 0
  rodWeapon("axe", "axe", {
    tier: 2,
    label: "Iron axe",
    blurb: "Short and brutal. One edge cuts.",
    rod: 55,
    sby: -3,
    part: { mesh: box(8.999, 11.498), density: 65, sharpness: 3, sharpnessU: 1.5, bladeable: 1, bladeableU: 0, look: "axe", material: "iron" },
  }),
  // axe_berdish.seria (blade only): 31 × 19, density 60, sharpness 3. Rod 70 is OURS ("long-handled axes are slower");
  // the one-edge blade values follow the other axes.
  rodWeapon("berdish", "axe", {
    tier: 3,
    label: "Berdish",
    blurb: "Long pole-axe. Slow, deep cuts.",
    rod: 70,
    part: {
      mesh: hull([-7.481, -11.216, -16.159, 2.702, -5.535, 8.194, 8.234, 7.963, 14.591, 0.565, 10.351, -10.706]),
      density: 60,
      sharpness: 3,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "iron",
    },
  }),

  // Maces: "hits with more force than a hammer, yet a hammer is faster"; the long chain keeps short weapons away.
  chainMace("flail", { tier: 1, label: "Wooden flail", blurb: "A log on a rope. Long, light, weak.", ours: true, link: 12, handle: 20, ball: 22, sharpness: 1.5, material: "wood" }),
  // mace_stone.seria
  chainMace("chainball", { tier: 2, label: "Chain ball", blurb: "Long whip. Hard to aim.", link: 20, handle: 30, ball: 50, sharpness: 2, material: "stone" }),
  // mace_silver.seria: handle on a 16 px rod → 4 links → mace_bich, density 80, sharpness 3
  {
    kind: "silvermace",
    cls: "mace",
    tier: 3,
    label: "Silver mace",
    blurb: "The heaviest blow in the game.",
    striker: "ball",
    parts: [
      { key: "handle", mesh: box(10.998, 4.499), density: 20, sharpness: 1, bladeable: 0, hang: 16, look: "handle", material: "silver", rod: true },
      linkPart(0, 35, 20, "silver"),
      linkPart(1, 42, 20, "silver"),
      linkPart(2, 49, 20, "silver"),
      linkPart(3, 56, 20, "silver"),
      // the head's chain anchor is at local (0, −15), so it spawns with local −y pointing up
      { key: "ball", mesh: [0, 13, -9.526, 6.5, -9.526, -6.5, 0, -13, 9.526, -6.5, 9.526, 6.5], density: 80, sharpness: 3, bladeable: 0, hang: 78, angle: 0, look: "ball", material: "silver" },
    ],
    joints: [
      { a: "hull", b: "handle", type: 2, radius: 16, necess: 999 },
      { a: "handle", b: "link0", type: 5, radius: 5, sax: 14, necess: 999 },
      { a: "handle", b: "link0", type: 3, radius: 5, sax: 14, necess: 999 },
      { a: "link0", b: "link1", type: 3, radius: 7, necess: 999 },
      { a: "link1", b: "link2", type: 3, radius: 7, necess: 999 },
      { a: "link2", b: "link3", type: 3, radius: 7, necess: 999 },
      { a: "link3", b: "ball", type: 5, radius: 7, sby: -15, necess: 999 },
    ],
  },

  // Swords: "light as a feather, sharp as the sophit's jaws"; deadly sliding cuts, weak against armour.
  // blade_kathib.seria (blade only): density 40, sharpness 3.1. Rod 36 is OURS (like the katar's 38).
  rodWeapon("kathib", "sword", {
    tier: 1,
    label: "Kathib",
    blurb: "Light bodyguard's sword. Quick.",
    rod: 36,
    part: { mesh: hull([-20.1, 7.8, 5.1, 7.2, 18.9, 1.8, 20.7, -7.8, -20.7, -1.8]), density: 40, sharpness: 3.1, bladeable: 1, look: "blade", material: "steel" },
  }),
  // katar.seria: rod 38 (shiftB_y 1), density 40, sharpness 3.4, bladeable_u 0.6
  rodWeapon("sword", "sword", {
    tier: 2,
    label: "Katar",
    blurb: "Fast. Slashes cut deep.",
    rod: 38,
    sby: 1,
    part: {
      mesh: [23.8303, 2.22223, 4.53768, 7.79758, -19.1727, 9.89369, -18.8112, -3.08128, 13.3968, -10.4543],
      density: 40,
      sharpness: 3.4,
      bladeable: 1,
      bladeableU: 0.6,
      look: "blade",
      material: "steel",
    },
  }),
  // hisayan.seria: rod 69 (shiftB_y 4, necess 3), density 45, sharpness 3.2 (back 0.5), bladeable_u 0.5
  rodWeapon("hisaian", "sword", {
    tier: 3,
    label: "Hisaian",
    blurb: "Long curved blade. Huge reach.",
    rod: 69,
    sby: 4,
    necess: 3,
    part: {
      mesh: hull([-20.7, 12.3, -0.9, 10.5, 12.9, 4.5, 20.7, -5.1, 11.7, -12.3, -19.5, 4.5]),
      density: 45,
      sharpness: 3.2,
      sharpnessU: 1.6,
      bladeable: 1,
      bladeableU: 0.5,
      look: "blade",
      material: "steel",
    },
  }),
];

export const WEAPONS = Object.fromEntries(list.map((w) => [w.kind, w])) as Record<WeaponKind, WeaponSpec>;
export const WEAPON_LABEL = Object.fromEntries(list.map((w) => [w.kind, w.label])) as Record<WeaponKind, string>;
