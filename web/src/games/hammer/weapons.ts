// Machine and weapon data, taken from Hammerfight's object files (D:\Steam\steamapps\common\Hammerfight\Demo\*.seria).
// Meshes are the files' collision polygons in px, local +x pointing away from the machine. Densities are m_fDensity,
// so mass ratios match the original. Joint types: 2 = rod that aims the part at its parent, 3 = rope that aims,
// 5 = short rope between offset anchors with a soft turn (see HAMMERFIGHT_PHYSICS.md → Joints).

export type WeaponKind = "hammer" | "chainball" | "sword";
export const WEAPON_KINDS: WeaponKind[] = ["hammer", "chainball", "sword"];

export const WEAPON_LABEL: Record<WeaponKind, string> = {
  hammer: "Spiked hammer",
  chainball: "Chain ball",
  sword: "Sword",
};

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
  sharpness: number;
  bladeable: number;
  /** m_bladeable_u: the other edge, when it differs (the katar's back edge: 0.6). */
  bladeableU?: number;
  /** Where the part's origin sits below the machine centre at spawn (the weapon hangs straight down). */
  hang: number;
  /** Drawing hint. */
  look: "hammer" | "blade" | "link" | "handle" | "ball";
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
  /** m_necess: last joint pass this joint takes part in. Rods use 5; the chain uses 999 (all passes). */
  necess: number;
}

export interface WeaponSpec {
  kind: WeaponKind;
  parts: PartSpec[];
  joints: JointSpec[];
  /** The part that does most of the hitting (for trails). */
  striker: string;
}

const link = (i: number, hang: number): PartSpec => ({
  key: `link${i}`,
  mesh: box(4.99925, 2.99955), // chain_small: 10 × 6, density 20
  density: 20,
  sharpness: 1,
  bladeable: 0,
  hang,
  look: "link",
});

export const WEAPONS: Record<WeaponKind, WeaponSpec> = {
  // hammer_iron.seria: Joint m_type 2, m_radius 60, PC → Weapon "hammer_iron" 17 × 29, density 60, sharpness 2
  hammer: {
    kind: "hammer",
    striker: "head",
    parts: [{ key: "head", mesh: box(8.49872, 14.4978), density: 60, sharpness: 2, bladeable: 0, hang: 60, look: "hammer" }],
    joints: [{ a: "hull", b: "head", type: 2, radius: 60, necess: 5 }],
  },

  // katar.seria: Joint m_type 2, m_radius 38, shiftB_y 1, PC → Weapon "katar_blade", density 40, sharpness 3.4, bladeable 1
  sword: {
    kind: "sword",
    striker: "blade",
    parts: [
      {
        key: "blade",
        mesh: [23.8303, 2.22223, 4.53768, 7.79758, -19.1727, 9.89369, -18.8112, -3.08128, 13.3968, -10.4543],
        density: 40,
        sharpness: 3.4,
        bladeable: 1,
        bladeableU: 0.6,
        hang: 38,
        look: "blade",
      },
    ],
    joints: [{ a: "hull", b: "blade", type: 2, radius: 38, sby: 1, necess: 5 }],
  },

  // mace_stone.seria: PC →(type 3, r 10) 6 links →(type 3, r 7 each) → handle "mace_orb_hand" 31 × 9 density 30
  // (type 5, r 2, shiftB_x −12) → ball "mace_stone" octagon, density 50, sharpness 2 (type 5, r 3, shiftA_x 8).
  chainball: {
    kind: "chainball",
    striker: "ball",
    parts: [
      link(0, 10),
      link(1, 17),
      link(2, 24),
      link(3, 31),
      link(4, 38),
      link(5, 45),
      { key: "handle", mesh: box(15.4977, 4.49932), density: 30, sharpness: 1, bladeable: 0, hang: 59, look: "handle" },
      {
        key: "ball",
        mesh: [4.97488, 12.0104, -4.97489, 12.0104, -12.0104, 4.97488, -12.0104, -4.97489, -4.97488, -12.0104, 4.97489, -12.0104, 12.0104, -4.97488, 12.0104, 4.97488],
        density: 50,
        sharpness: 2,
        bladeable: 0,
        hang: 70,
        look: "ball",
      },
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
  },
};
