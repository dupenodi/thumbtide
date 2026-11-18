// Machine and weapon data. Most of it is taken from Hammerfight's object files
// (D:\Steam\steamapps\common\Hammerfight\Demo\*.seria and Objects\Weapons\*.seria): the collision meshes in px with
// local +x pointing away from the machine, m_fDensity (so mass ratios match the original), m_sharpness, the two-sided
// m_sharpness_u/_d and m_bladeable_u/_d, and the joints. Joint types: 2 = rod that aims the part at its parent,
// 3 = rope that aims, 5 = short rope between offset anchors with a soft turn (see HAMMERFIGHT_PHYSICS.md → Joints).
//
// The rest comes from the exe's item factory (0x486ff0, read from the DRM-free v1.004 exe): the weapons it builds in
// code. Two weapons are ours (the great maul and the wooden flail), made from the original shapes with other densities
// and sharpness, and are marked OURS below. For the blades whose files hold the blade only, the factory sets the rod
// and the side values (see RE_WEAPONS.md §1).
// Not here: bow1 (only story scripts fire it), the flags (ids 100-198, not weapons).

export type WeaponClass = "hammer" | "axe" | "mace" | "sword" | "dual";
export type Material = "wood" | "iron" | "stone" | "silver" | "steel" | "gold";

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
  | "hisaian"
  | "claw"
  | "severn"
  | "innata"
  | "broadblade"
  | "saian"
  | "silverblade"
  | "palash"
  | "twin"
  | "tribune"
  | "krankhammer"
  | "goldhammer"
  | "goldaxe"
  | "goldblade"
  | "spikedflail"
  | "krankmace"
  | "kolotun"
  | "klevec"
  | "warhammer"
  | "axis"
  | "eclipse"
  | "mamba"
  | "pike"
  | "imperia"
  | "liberia"
  | "sunblade"
  | "cyclone"
  | "bladeflail"
  | "orbmace"
  | "starmace"
  | "stixmace"
  | "shuriken"
  | "clawmace";

/**
 * In card order: grouped by class, light → heavy. Only these can be picked, given to bots or dropped.
 * 2026-11-18 (user): the dual weapons (twin, tribune: they set the machine spinning endlessly), the cyclone and the
 * spiked flail are out of the game; their specs stay below for the physics tests only.
 */
export const WEAPON_KINDS: WeaponKind[] = [
  "mallet", "kolotun", "hammer", "klevec", "warhammer", "maul", "krankhammer", "goldhammer",
  "bagor", "axis", "mamba", "eclipse", "axe", "pike", "berdish", "goldaxe",
  "flail", "chainball", "orbmace", "starmace", "stixmace", "shuriken", "silvermace", "bladeflail", "clawmace", "krankmace",
  "kathib", "claw", "sword", "imperia", "severn", "innata", "liberia", "broadblade", "saian", "silverblade", "palash", "hisaian", "sunblade", "goldblade",
];

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
  look: "hammer" | "mallet" | "axe" | "blade" | "link" | "spike" | "handle" | "ball" | "gun";
  material: Material;
  /** Draw a shaft from the machine to this part (parts on a rod joint). */
  rod?: boolean;
  /** This part shoots (class Weapon with m_ammoclip_size): along its local +x, away from the machine. */
  gun?: GunSpec;
  /** m_extra_shock: its hits stun this many times longer (the wooden hammer: 4). */
  extraShock?: number;
  /**
   * What each region of the part does when it touches a machine (WEAPON_SHAPES.md), in the order they are tested.
   * Left out: two faces from the side values, by the side the contact normal points to (local y ≥ 0: sharpness /
   * bladeable; below: sharpnessU / bladeableU).
   */
  faces?: Face[];
}

/**
 * What a region of a part is, by its art (WEAPON_SHAPES.md): a spike pierces and can hook in, a blade cuts when it
 * slides, a blunt face knocks back, a saw grinds, a shaft (a rod, a hinge, a chain ring) only pushes.
 */
export type FaceKind = "blunt" | "blade" | "spike" | "saw" | "shaft";

/**
 * One region of a part. The region test uses the part's feature that touched (the mesh vertex, or the middle of the
 * mesh edge, that sticks out furthest toward the other body), in the part's local px; a bound left out is open. The
 * first face that holds the point wins, so put a catch-all face last.
 */
export interface Face {
  kind: FaceKind;
  x0?: number;
  x1?: number;
  y0?: number;
  y1?: number;
  /**
   * Only on this side: 1 when the contact normal (from the part out) has local y ≥ 0, −1 when it is below. The exe's
   * side test reads the normal (0x512ff0), so the two default faces use it: a curved edge stays one side all along.
   */
  side?: 1 | -1;
  /**
   * Only when the contact normal (from the part out) points along the part's local +x at least this much (its local
   * x component): a point that meets the other body tip-first, along the blade (a sword's stab). A blow across the
   * blade that happens to touch with the tip corner first is not one.
   */
  nx0?: number;
  /** m_sharpness of this face (× the side value). */
  sharp: number;
  /** m_bladeable of this edge (blade; also a spike's edge when it hits side-on). */
  blade?: number;
  /** m_spikeable of this point (spike): the pierce power; the original's impale test is spike · (|v| + 1) > 300. */
  spike?: number;
  /** The point can hook into a machine (a short-lived joint, sim.ts `hook`). */
  hook?: boolean;
}

const facesCache = new WeakMap<PartSpec, readonly Face[]>();
/** The faces of a part (its own, or the two side faces from its side values). One array per part spec. */
export function facesOf(p: PartSpec): readonly Face[] {
  let f = facesCache.get(p);
  if (!f) {
    const bd = p.bladeable;
    const bu = p.bladeableU ?? bd;
    f = p.faces ?? [
      { kind: bd > 0 ? "blade" : "blunt", side: 1, sharp: p.sharpness, blade: bd },
      { kind: bu > 0 ? "blade" : "blunt", sharp: p.sharpnessU ?? p.sharpness, blade: bu },
    ];
    facesCache.set(p, f);
  }
  return f;
}

/** The area Body uses for mass (a triangle fan from the origin; the polygon's area when the origin is inside). */
function fanArea(v: number[]): number {
  let s = 0;
  const n = v.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    s += Math.abs(v[2 * i]! * v[2 * j + 1]! - v[2 * j]! * v[2 * i + 1]!);
  }
  return s / 2;
}
/** The density that gives `mesh` the mass `old` had at `density`: a mesh redrawn to the art keeps the part's weight. */
const sameMass = (mesh: number[], old: number[], density: number) => (density * fanArea(old)) / fanArea(mesh);

/**
 * A gun (Weapon::fire, 0x4184xx; mortar 0x41adxx). Fire needs the timer at 0 and a round in the clip; each shot sets
 * the timer to 0.1 s, the last one to m_recoil_time, and the clip refills when that runs out.
 */
export interface GunSpec {
  /** m_ammoclip_size. */
  clip: number;
  /** m_recoil_time: seconds to reload an empty clip. */
  reload: number;
  /** Seconds between shots while the trigger is held (the exe sets 0.1). */
  interval: number;
  /** Projectiles per shot and their spread, +- radians (mortar: 5, 0.2). */
  pellets: number;
  spread: number;
  /** Muzzle speed px/s (bullets: 2000). */
  speed: number;
  /** Projectile radius px and density. */
  shotR: number;
  shotDensity: number;
  /** Projectile sharpness (bullets: 7). Only crates read it now: hits on machines use `hit`. */
  shotSharpness: number;
  /**
   * What one projectile does to a live machine at muzzle speed (all OURS, RE_GUNS.md §9): damage (at damage factor
   * 0.1), push (the speed it gives a bare hull, px/s; the impulse is push × 66 000, the hull mass) and stun (s). It
   * scales with the shot's speed when it lands (0.3–1.2 ×). The shot is then spent: it bounces only off walls and
   * crates. The exe's bullet is far stronger: a 9 800-mass body at 2000 px/s gives a hull about 300 px/s, about 155
   * damage and a full stun (RE_GUNS.md §2). The recoil is derived from `hit.push` (sim.ts RECOIL_SHARE).
   */
  hit: { dmg: number; push: number; stun: number };
  /** "ball" shots are drawn as mortar balls, "bullet" as tracers, "rocket" as a rocket with a flame. */
  look: "bullet" | "ball" | "rocket";
  /** Rockets: no gravity, and a blast on the first contact or at the end of their life. */
  blast?: { radius: number; damage: number; push: number };
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

// ---------------------------------------------------------------- guns
// Bullets are 7 px balls of sharpness 7 at 2000 px/s. Their density (200 in the exe) is OURS: with this port's
// damage formula a 200-density bullet does about 100 damage, so the body is light (8) and the hit (damage, push,
// stun) is set per gun in `hit` instead (RE_GUNS.md).
const BULLET = { interval: 0.1, pellets: 1, spread: 0.01, speed: 2000, shotR: 3.5, shotDensity: 8, shotSharpness: 4, hit: { dmg: 3, push: 40, stun: 0 }, look: "bullet" } as const;

export type GunKind = "arquebus" | "mortar" | "heavymortar" | "launcher";
export const GUN_KINDS: GunKind[] = ["arquebus", "mortar", "heavymortar", "launcher"];

/** A gun you take with a melee weapon: it rides on its own rod on the far side, tied to the weapon (type 0). */
export interface SidearmSpec {
  kind: GunKind;
  label: string;
  blurb: string;
  part: Omit<PartSpec, "key" | "hang" | "rod" | "angle">;
  rod: number;
}

export const SIDEARMS: Record<GunKind, SidearmSpec> = {
  // gun_blade.seria: density 40.8, sharpness 5 (it has a bayonet); the item code sets a clip of 20 and a 5 s reload.
  arquebus: {
    kind: "arquebus",
    label: "Arquebus",
    blurb: "20 quick shots, then a reload.",
    rod: 34,
    part: {
      mesh: [-16.347, -9.848, -16.494, 4.143, 16.494, 12.124, 9.118, -12.124],
      density: 40.8006,
      sharpness: 5,
      // the bayonet cuts on one side (blade d 1 / u 0; sharpness_u 0.3, here 1.5)
      bladeable: 1,
      bladeableU: 0,
      sharpnessU: 1.5,
      look: "gun",
      material: "iron",
      // m_recoil_time: the exe sets 5 s for the arquebus (the file says 2)
      gun: { ...BULLET, clip: 20, reload: 5 },
    },
  },
  // mortar (id 240): box 22 × 10, density 25, rod 18, clip 3, m_recoil_time 5; 5 balls a shot with +-0.2 spread,
  // recoil = the balls' momentum. The ball speed, the time between blasts, the hit and the weight are OURS.
  // Density 68 (the exe: 25, a 5 500 mass) makes it about 15 000, so the gun weighs on the machine (RE_GUNS.md §5, §9).
  // GUNS_REVIEW.md (2026-11-18): balls 1100 → 1600 px/s (the exe: 2000 ± 400; they land 58 % in duels, were 48 %;
  // a tighter spread made it stronger than the arquebus); a blast's balls that land together are one hit (sim.ts damage).
  mortar: {
    kind: "mortar",
    label: "Mortar",
    blurb: "3 blasts of 5 balls. Big kick.",
    rod: 18,
    part: {
      mesh: box(11, 5),
      density: 68,
      sharpness: 1,
      bladeable: 0,
      look: "gun",
      material: "iron",
      gun: { clip: 3, reload: 5, interval: 0.6, pellets: 5, spread: 0.2, speed: 1600, shotR: 5, shotDensity: 10, shotSharpness: 7, hit: { dmg: 5, push: 60, stun: 0.07 }, look: "ball" },
    },
  },
  // mortar_heavy (id 244): box 22 × 14, density 25, rod 19, clip 1, m_recoil_time 5; one mortar_ball (6-gon 13 × 13,
  // sharpness 2). Ball density (200 in the exe) is OURS, as for bullets; so are the hit and weight.
  // GUNS_REVIEW.md (2026-11-18): 1500 px/s as the exe (was 1000: the ball dropped into the target's weapon at range),
  // a 4 s reload (the exe: 5) and damage 16 (was 20): it lands about twice as often and fires a little more.
  heavymortar: {
    kind: "heavymortar",
    label: "Heavy mortar",
    blurb: "One huge ball. Slow reload.",
    rod: 19,
    part: {
      mesh: box(11, 7),
      density: 72,
      sharpness: 1,
      bladeable: 0,
      look: "gun",
      material: "iron",
      gun: { clip: 1, reload: 4, interval: 0.1, pellets: 1, spread: 0.02, speed: 1500, shotR: 6.5, shotDensity: 60, shotSharpness: 2, hit: { dmg: 16, push: 320, stun: 0.6 }, look: "ball" },
    },
  },
  // launcher (id 243): box 44 × 13, density 25, rod 17, clip 3, m_recoil_time 5. The rocket (box 15 × 7, m_explosive
  // 1700) flies under its own thrust and explodes. Its speed and the blast size and damage are OURS (not found in the exe).
  launcher: {
    kind: "launcher",
    label: "Launcher",
    blurb: "3 rockets that explode.",
    rod: 17,
    part: {
      mesh: box(22, 6.5),
      density: 32,
      sharpness: 1,
      bladeable: 0,
      look: "gun",
      material: "iron",
      gun: {
        clip: 3,
        reload: 5,
        interval: 0.5,
        pellets: 1,
        spread: 0.02,
        speed: 800,
        shotR: 4,
        shotDensity: 8,
        shotSharpness: 1,
        // the rocket's blast does its harm (a hit on a machine sets it off)
        hit: { dmg: 0, push: 0, stun: 0 },
        look: "rocket",
        blast: { radius: 80, damage: 22, push: 450 },
      },
    },
  },
};

// ---------------------------------------------------------------- plates (shields)
// Item factory ids 184-198: a box (thickness along local +x, away from the machine), density, m_overkill and the rod
// (m_jrad_x), all with sharpness 0.5. A plate is knocked off when a weapon at more than 1.5x its speed hits it with an
// impact above overkill x 100 (x 0.25 at critical health). Holding the shield pushes the plates apart and halves thrust.
export type PlateKind = "woodlight" | "woodheavy" | "rusty" | "iron" | "silver" | "imperia" | "armor" | "heavyplate";
export interface PlateSpec {
  kind: PlateKind;
  label: string;
  mesh: number[];
  density: number;
  overkill: number;
  rod: number;
  material: Material;
}
const plate = (kind: PlateKind, label: string, w: number, h: number, density: number, overkill: number, rod: number, material: Material): PlateSpec => ({
  kind,
  label,
  mesh: box(w / 2, h / 2),
  density,
  overkill,
  rod,
  material,
});
export const PLATES: Record<PlateKind, PlateSpec> = {
  woodlight: plate("woodlight", "Light wood", 12, 28, 15, 0.3, 21, "wood"), // plate_wood_light (184)
  woodheavy: plate("woodheavy", "Heavy wood", 15, 27, 20, 0.4, 23, "wood"), // plate_wood_heavy (186)
  rusty: plate("rusty", "Rusty", 13, 31, 30, 0.6, 21, "stone"), // plate_rusty (189)
  iron: plate("iron", "Iron", 16, 31, 30, 0.6, 21, "iron"), // plate_iron (190)
  silver: plate("silver", "Silver", 15, 27, 30, 0.7, 23, "silver"), // plate_silver (194)
  imperia: plate("imperia", "Imperia", 15, 31, 35, 0.7, 19, "gold"), // plate_imperia (195)
  armor: plate("armor", "Armour", 16, 33, 40, 0.7, 36, "steel"), // plate_armor (198)
  heavyplate: plate("heavyplate", "Heavy", 15, 38, 30, 0.8, 25, "iron"), // plate_heavy (193)
};
export const PLATE_KINDS = Object.keys(PLATES) as PlateKind[];
/** Plates a machine carries (the game allows up to 6; two keep the body count down on the TV). */
export const PLATE_COUNT = 2;

/** Dual weapons already fill the far side (the tribune's back blade is its own gun). */
export const takesSidearm = (k: WeaponKind) => WEAPONS[k].cls !== "dual";

const combined = new Map<string, WeaponSpec>();
/** The weapon with a sidearm added: the gun hangs opposite the weapon on its own rod, held apart by a type 0 joint. */
export function armedSpec(kind: WeaponKind, gun: GunKind | null): WeaponSpec {
  const w = WEAPONS[kind];
  if (!gun || !takesSidearm(kind)) return w;
  const key = `${kind}+${gun}`;
  let c = combined.get(key);
  if (!c) {
    const g = SIDEARMS[gun];
    const first = w.joints.find((j) => j.a === "hull")!;
    const rigid = first.type === 2;
    c = {
      ...w,
      parts: [...w.parts, { key: "gun", hang: -g.rod, angle: -Math.PI / 2, rod: true, ...g.part }],
      joints: [
        ...w.joints,
        { a: "hull", b: "gun", type: 2, radius: g.rod, necess: 5 },
        // a rod weapon holds the gun straight across (like the dual sets); a chain can't, so the gun swings free
        // longer than the two rods (×1.17, as the Demo pishal tie): it always pushes the gun round to the far side;
        // a tie of exactly their sum did almost nothing near 180°, so the gun flailed
        ...(rigid ? [{ a: first.b, b: "gun", type: 0, radius: (first.radius + g.rod) * 1.17, necess: 1 }] : []),
      ],
    };
    combined.set(key, c);
  }
  return c;
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

/** chain_large: box 12 × 6.6, density 20 (links joined by type 3, radius 9). */
const bigLink = (i: number, hang: number): PartSpec => ({ key: `link${i}`, mesh: box(6, 3.3), density: 20, sharpness: 1, bladeable: 0, hang, look: "link", material: "iron" });
/**
 * n links from `from` to `to` (each joined to the one before with a rope of `r`). `firstDensity`: a heavy first link
 * (stix2 60, claw 57; RE_WEAPONS.md §5.4).
 */
function chain(n: number, first: number, step: number, big: boolean, firstDensity = 20): { parts: PartSpec[]; joints: JointSpec[] } {
  const parts: PartSpec[] = [];
  const joints: JointSpec[] = [];
  for (let i = 0; i < n; i++) {
    // only the first link is a full chain_large: a whole chain of them folds up in this engine (the krank mace and the
    // spiked flail do the same), so the rest use the small link mesh at the large spacing
    parts.push(big && i === 0 ? bigLink(i, first + i * step) : linkPart(i, first + i * step, i === 0 ? firstDensity : 20, "iron"));
    if (i > 0) joints.push({ a: `link${i - 1}`, b: `link${i}`, type: 3, radius: big ? 9 : 7, necess: 999 });
  }
  return { parts, joints };
}
/** mace_orb_hand: box 31 × 9, density 30, between the last link and the head. */
const orbHand = (hang: number): PartSpec => ({ key: "handle", mesh: box(15.5, 4.5), density: 30, sharpness: 1, bladeable: 0, hang, look: "handle", material: "wood" });
/** mace_hand: box 30 × 8, density 20, on a rod of 13; the first link hangs from its far end by a type 5 and a type 3. */
const maceHand = (hang: number, w = 30): PartSpec => ({ key: "hand", mesh: box(w / 2, 4), density: 20, sharpness: 1, bladeable: 0, hang, look: "handle", material: "iron", rod: true });

/** An n-gon inscribed in a w × h ellipse, like the exe's mesh helper (0x402390, mode n). */
function ngon(n: number, w: number, h: number): number[] {
  const v: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((i + 0.5) / n) * Math.PI * 2;
    v.push(Math.cos(a) * w * 0.5, Math.sin(a) * h * 0.5);
  }
  return v;
}

const OCTAGON = [4.97488, 12.0104, -4.97489, 12.0104, -12.0104, 4.97488, -12.0104, -4.97489, -4.97488, -12.0104, 4.97489, -12.0104, 12.0104, -4.97488, 12.0104, 4.97488];

// ---------------------------------------------------------------- shapes redrawn to the art (WEAPON_SHAPES.md)
// Each is the convex hull of the drawn sprite (weapons-atlas.png, hotspot = origin, 1 sprite px = 1 px), without the
// drawn rod, rings and guards (they never hurt). The part keeps its old mass (sameMass), so only its outline changes.
/** hammer_klevec: a block with a long spike on each striking face (the box was 16 × 32; the spikes reach ±20.5). */
const KLEVEC = [-9, -7.5, -0.5, -21, 11, -2, 11, 2, -0.5, 21, -9, 7.5];
/** hammer_krank: a barrel with short conical caps on both faces. */
const KRANK = [-9, -12, -0.5, -21, 8, -13, 12, -3.5, 12, 3, 8, 12, -0.5, 20, -9, 11, -10, 2.5];
/** axe_pike: a pick, two points curving back (±22.5) and a short knob on the outer end. */
const PIKE = [-5.5, -2, -4.5, -23, 9, -2.5, 9, 2.5, -4.5, 23, -5.5, 2];
/** axe_bagor (y-mirrored as the Demo file): the axe flare on top, the hook down to its point at (−13.5, 22.5). */
const BAGOR = [-15, 0.5, -11, -13, 5.5, -15, 13, -14, 14, 3.5, 6, 16, -1.5, 22, -13.5, 23, -15, 22];
/** axe_axis: the crescent round the +x/+y side and the short spike on top. */
const AXIS = [-13, -2.5, 0.5, -12, 16, -3.5, 15, 3.5, 13, 8, 8.5, 12, 4.5, 14, -7.5, 13, -14, 2.5];
/** axe_mamba: the C-shaped blade (its hollow is filled: a collider must be convex). */
const MAMBA = [-16, -10.5, -6.5, -17, 2.5, -18, 14, -11.5, 18, -3.5, 17, 6.5, 15, 10.5, 9.5, 16, -3.5, 21, -16, 12.5];
/** axe_eclips: the ring blade. */
const ECLIPSE = [-12, -15, -4.5, -18, 3.5, -18, 12, -12.5, 17, -3.5, 15.5, 7, 8.5, 15, -6.5, 17, -12, 13.5, -14, 1.5];
/** axe_gold: the horn spike on top (−y), the broad crescent below (+y). */
const GOLDAXE = [-13, -2.5, -6.5, -17, -1.5, -15, 8, -3.5, 13, 16.5, 7.5, 19, -8.5, 19, -13, 16.5];
/** axe_posolski (tribune head, y-mirrored as the Demo file): the long spike on top, the fan blade below. */
const POSOLSKI = [-7, -1.5, -0.5, -20, 8, -1.5, 9, 16.5, 6.5, 19, -4.5, 20, -7, 18.5];
/** tribun (the tribune's back gun): the barrel and the blade hanging below its muzzle end. */
const TRIBUN = [-25, -3.5, -15.5, -7, 12, -4, 27, 4.5, 26, 11.5, 24, 15.5, 19.5, 20, 15.5, 22, -23.5, 19, -25, 17.5];
/** liberia_blade: the box and its point (to x 30.5). */
const LIBERIA = [-25.5, -7.5, 24.5, -7.5, 30.5, 0, 24.5, 7.5, -25.5, 7.5];
/** mace_star: eight spikes; the hull of their points. */
const STAR = [-16, -0.5, -13, -15, -0.5, -18, 7.5, -17, 17, -6.5, 12, 14, -0.5, 18, -7.5, 17];
/** mace_stix2: the bar with three spiked rings (points at ±9.5); the hanging ring at −x is left out. */
const STIX = [-18, -4.5, -9.5, -9, 13.5, -10, 17, -4.5, 17, 5.5, 13.5, 11, -9.5, 10, -18, 5.5];
/** mace_blade: the crescent (the ring the chain holds is left out). */
const BLADE_HEAD = [-23, -6.5, -8.5, -11, 8.5, -11, 23, -5.5, 17, 5.5, 13.5, 9, 3.5, 13, -12.5, 10, -21, 0.5, -23, -3.5];
/** mace_sharp: the disc and its short spikes. */
const SHARP_BALL = [-17, -3.5, -9.5, -14, 3.5, -16, 14, -9.5, 17, 3.5, 9.5, 14, -3.5, 17, -14, 9.5];
/** mace_sharp_chain_1: the ring and the crescent blade, its points at ±15.5. */
const SHARP_SEG1 = [-10.5, -1.5, 3.5, -16, 7.5, -11, 11, -1.5, 11, 3.5, 6.5, 13, 3.5, 16, -10.5, 2.5];
/** mace_claw_02: the body and its two curved claws (points at −21.5 and +19.5); the hinge ring at −x is left out. */
const CLAW_HEAD = [-12, -3.5, -5.5, -22, -0.5, -17, 8, -2.5, 8, 1.5, -4.5, 20, -5.5, 20, -12, 2.5];
/** mace_claw_01: one curved claw (points at ±17); the ring at −x is left out. */
const CLAW_JAW = [-7.5, 0.5, -4.5, -18, -1.5, -16, 5, -3.5, 5, 4.5, 1.5, 11, -4.5, 17, -7.5, 1];
/** mace_sharp_chain_1…3: the −x half is the chain ring (it only pushes), the +x half the crescent blade. */
const SEGMENT_FACES: Face[] = [
  { kind: "shaft", x1: -1, sharp: 1 },
  { kind: "blade", sharp: 3, blade: 1 },
];
/** A grip or hand that collides (the morning star's hand, layer 8 in the exe): it only pushes. */
const GRIP_FACES: Face[] = [{ kind: "shaft", sharp: 1 }];

/** A sword's stab face reaches this far in from its point (px), and the contact must be within about 37° of the blade's axis. */
const STAB_REACH = 6;
const STAB_ON = 0.8;
/**
 * A sword's faces (OURS; the user, 2026-11-18: "swords can stab or slice, slicing should work better from edged side
 * and 'spine' does blunt damage instead"). In order:
 * - the point, met along the blade (STAB_ON): a stab, a spike with no hook (pierce: sharpness × tuning.pierce, no cut);
 *   met at a glance it still cuts;
 * - the edge, on +y (where Hammerfight's sprites draw it, see edgeAt): a slice, the cut grows with the slide;
 * - the back: a one-edged blade's spine is blunt (`spine`: its sharpness; it knocks back and doesn't cut), a
 *   two-edged blade cuts there too (`edge`: the exe's bladeable_u, at `sharp`).
 * The exe's side values stay on the part (sharpness, bladeable, *_u); these faces are what the hit uses.
 */
function swordFaces(mesh: number[], sharp: number, back: { spine: number } | { edge: number; sharp?: number }): Face[] {
  let tip = -Infinity;
  for (let i = 0; i < mesh.length; i += 2) tip = Math.max(tip, mesh[i]!);
  return [
    { kind: "spike", x0: tip - STAB_REACH, nx0: STAB_ON, sharp, blade: 1 },
    { kind: "blade", side: 1, sharp, blade: 1 },
    "spine" in back ? { kind: "blunt", sharp: back.spine } : { kind: "blade", sharp: back.sharp ?? sharp, blade: back.edge },
  ];
}
/** A sword's part with its faces (swordFaces at the part's own sharpness). */
const sword = <P extends { mesh: number[]; sharpness: number }>(p: P, back: { spine: number } | { edge: number; sharp?: number }): P & { faces: Face[] } => ({
  ...p,
  faces: swordFaces(p.mesh, p.sharpness, back),
});
// Sword meshes used twice (the twin set has a palash and a claw).
const PALASH = hull([-25.08, 12.54, -5.13, 11.97, 13.11, 6.27, 26.22, -5.13, 18.24, -12.54, -26.22, 2.85]);
const CLAW = hull([-18.564, 2.757, 18.564, -7.772, 10.964, 2.551, -17.685, 7.772]);
/** palash: one edge; the exe's back is sharpness × 0.5 (1.5). */
const PALASH_FACES = swordFaces(PALASH, 3, { spine: 1.5 });
/** claw: one edge (+y, the outer curve); the exe's back still cuts at 0.6, here a spine of sharpness × 0.5. */
const CLAW_FACES = swordFaces(CLAW, 6, { spine: 3 });
/** cyclon_arm: the wide braced frame with a point at +x (the box was 50 × 10). */
const CYCLONE_ARM = [-27, -7.5, -19.5, -12, 8.5, -12, 25, -2.5, 25, 2.5, 8.5, 12, -19.5, 12, -27, 7.5];

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
  // hammer_wood (id 200): box 22 × 28, density 35, sharpness 2, m_extra_shock 4, rod 56
  rodWeapon("mallet", "hammer", {
    tier: 1,
    label: "Wooden hammer",
    blurb: "Light, weak hits, but long stuns.",
    rod: 56,
    part: { mesh: box(11, 14), density: 35, sharpness: 2, bladeable: 0, extraShock: 4, look: "mallet", material: "wood" },
  }),
  // hammer_iron.seria: rod 60, 17 × 29, density 60, sharpness 2
  rodWeapon("hammer", "hammer", {
    tier: 2,
    label: "Iron hammer",
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
    // the file mesh missed the hook (it stopped at y 15.6, the hook's point is at 22.5): BAGOR, same mass. The hook's
    // point hooks in (OURS, a bagor is a boat hook; the exe has no m_spikeable), its curve cuts, the flare on top is blunt
    part: {
      mesh: BAGOR,
      density: sameMass(BAGOR, hull([-14.415, 12.79, -4.319, 15.632, 6.077, 8.302, 11.424, -0.449, 14.415, -15.632, -8.507, -15.033]), 42),
      sharpness: 3,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "iron",
      faces: [
        { kind: "spike", x1: -6, y0: 14, sharp: 3, spike: 0.6, hook: true, blade: 1 },
        { kind: "blade", y0: 0, sharp: 3, blade: 1 },
        { kind: "blunt", sharp: 3 },
      ],
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
  // axe_berdish.seria (blade only): 31 × 19, density 60. The factory (id 223, 0x48808c) sets sharpness 3 (back 0.5),
  // bladeable_u 0, rod 60, m_jrad_y −5 (RE_WEAPONS.md §1).
  rodWeapon("berdish", "axe", {
    tier: 3,
    label: "Berdish",
    blurb: "Long pole-axe. Slow, deep cuts.",
    rod: 60,
    sby: -5,
    // the sprite's shaft runs along the top of the blade (y −12 … −8, past it to x +17): that edge only pushes
    part: {
      mesh: hull([-7.481, -11.216, -16.159, 2.702, -5.535, 8.194, 8.234, 7.963, 14.591, 0.565, 10.351, -10.706]),
      density: 60,
      sharpness: 3,
      sharpnessU: 1.5,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "iron",
      faces: [
        { kind: "shaft", y1: -7, sharp: 1 },
        { kind: "blade", y0: 0, sharp: 3, blade: 1 },
        { kind: "blunt", sharp: 1.5 },
      ],
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
  // blade_kathib.seria (blade only): density 40. The factory (id 227) sets sharpness 3.4, bladeable_u 0.6, rod 47,
  // m_jrad_y 2 (RE_WEAPONS.md §1).
  rodWeapon("kathib", "sword", {
    tier: 1,
    label: "Kathib",
    blurb: "Light bodyguard's sword. Quick.",
    rod: 47,
    sby: 2,
    // one edge (+y); the clipped point sits on the back. The exe's back cuts at 0.6: here a spine (sharpness × 0.5)
    part: sword({ mesh: hull([-20.1, 7.8, 5.1, 7.2, 18.9, 1.8, 20.7, -7.8, -20.7, -1.8]), density: 40, sharpness: 3.4, bladeable: 1, bladeableU: 0.6, look: "blade", material: "steel" }, { spine: 1.7 }),
  }),
  // katar.seria: rod 38 (shiftB_y 1), density 40, sharpness 3.4, bladeable_u 0.6
  rodWeapon("sword", "sword", {
    tier: 2,
    label: "Katar",
    blurb: "Fast. Slashes cut deep.",
    rod: 38,
    sby: 1,
    // a katar is two-edged: the back edge cuts at the exe's 0.6
    part: sword(
      {
        mesh: [23.8303, 2.22223, 4.53768, 7.79758, -19.1727, 9.89369, -18.8112, -3.08128, 13.3968, -10.4543],
        density: 40,
        sharpness: 3.4,
        bladeable: 1,
        bladeableU: 0.6,
        look: "blade",
        material: "steel",
      },
      { edge: 0.6 },
    ),
  }),
  // hisayan.seria: rod 69 (shiftB_y 4, necess 3), density 45, sharpness 3.2 (back 0.5), bladeable_u 0.5
  rodWeapon("hisaian", "sword", {
    tier: 3,
    label: "Hisaian",
    blurb: "Long curved blade. Huge reach.",
    rod: 69,
    sby: 4,
    necess: 3,
    // one edge, on the outer (+y) curve; the back is a spine at the exe's back sharpness
    part: sword(
      {
        mesh: hull([-20.7, 12.3, -0.9, 10.5, 12.9, 4.5, 20.7, -5.1, 11.7, -12.3, -19.5, 4.5]),
        density: 45,
        sharpness: 3.2,
        sharpnessU: 1.6,
        bladeable: 1,
        bladeableU: 0.5,
        look: "blade",
        material: "steel",
      },
      { spine: 1.6 },
    ),
  }),
  // ---- more swords from Objects/Weapons (blade only: the item factory sets their rods and side values,
  // RE_WEAPONS.md §1)
  // blade_claw.seria: density 35, sharpness 6 (the sharpest edge in the game), bladeable_u 0.6; factory (id 226) rod 42,
  // m_jrad_y 3
  rodWeapon("claw", "sword", {
    tier: 1,
    label: "Claw",
    blurb: "Tiny hooked blade. Sharpest edge.",
    rod: 42,
    sby: 3,
    part: { mesh: CLAW, density: 35, sharpness: 6, bladeable: 1, bladeableU: 0.6, look: "blade", material: "steel", faces: CLAW_FACES },
  }),
  // blade_severn.seria: 55 × 13, density 30; factory (id 232) sharpness 3.5 (back 0.3), bladeable_u 0, rod 42
  rodWeapon("severn", "sword", {
    tier: 2,
    label: "Severn",
    blurb: "Long, thin and light.",
    rod: 42,
    // one edge; the engraved back is a spine (the exe: back sharpness × 0.3, no edge)
    part: sword({ mesh: hull([-27.429, 6.658, -26.361, -6.658, 27.429, -6.488, 15.865, 5.002]), density: 30, sharpness: 3.5, sharpnessU: 1.05, bladeable: 1, bladeableU: 0, look: "blade", material: "steel" }, { spine: 1.05 }),
  }),
  // blade_innata.seria: 60 × 13, density 30; factory (id 237) sharpness 4.5, bladeable_u 0.7, rod 46
  rodWeapon("innata", "sword", {
    tier: 2,
    label: "Innata",
    blurb: "The longest blade. Very sharp.",
    rod: 46,
    // one edge; the engraved back is a spine (the exe's back cuts at 0.7; here sharpness × 0.5)
    part: sword({ mesh: hull([-29.841, 6.314, 5.79, 5.547, 22.692, 0.322, 29.841, -6.314, -29.154, 0.628]), density: 30, sharpness: 4.5, bladeable: 1, bladeableU: 0.7, look: "blade", material: "steel" }, { spine: 2.25 }),
  }),
  // broad_blade (id 229): 44 × 17, density 42, sharpness 2.7, rod 49 (RE_WEAPONS.md §1; pishal.seria has 43.2)
  rodWeapon("broadblade", "sword", {
    tier: 2,
    label: "Broad blade",
    blurb: "Straight and heavy. Cuts both ways.",
    rod: 49,
    // two-edged, round point (it still stabs)
    part: sword({ mesh: box(21.997, 8.499), density: 42, sharpness: 2.7, bladeable: 1, look: "blade", material: "steel" }, { edge: 1 }),
  }),
  // blade_saian.seria: m_fDensity 0 with m_fDensity2 40 (we use 40); factory (id 230) sharpness 5 (back 0.5),
  // bladeable_u 0.5, rod 43, m_jrad_y 2
  rodWeapon("saian", "sword", {
    tier: 2,
    label: "Saian",
    blurb: "Curved and keen.",
    rod: 43,
    sby: 2,
    // one edge, on the outer (+y) curve; the back is a spine
    part: sword({ mesh: hull([-21.997, 8.483, -6.36, 7.952, 7.488, 2.186, 23.323, -7.424, 11.263, -12.723, -21.534, 1.791]), density: 40, sharpness: 5, sharpnessU: 2.5, bladeable: 1, bladeableU: 0.5, look: "blade", material: "steel" }, { spine: 2.5 }),
  }),
  // blade_silver.seria: 57 × 21, density 45; factory (id 234) sharpness 3.5 (back 0.5), bladeable_u 0.5, rod 48,
  // m_jrad_y 3
  rodWeapon("silverblade", "sword", {
    tier: 3,
    label: "Silver blade",
    blurb: "A noble's sword. Long and heavy.",
    rod: 48,
    sby: 3,
    // one edge, on the outer (+y) curve; the back is a spine
    part: sword({ mesh: hull([-26.878, -0.3, -26.975, 8.339, -6.806, 7.605, 15.369, -0.788, 29.887, -11.186, 9.739, -12.372]), density: 45, sharpness: 3.5, sharpnessU: 1.75, bladeable: 1, bladeableU: 0.5, look: "blade", material: "silver" }, { spine: 1.75 }),
  }),
  // blade_palash.seria (mesh ×0.95, as the factory scales it; area ≈ 713): density 45, sharpness 3 (back 0.5),
  // bladeable_u 0.5; factory (id 233) rod 40, m_jrad_y 3
  rodWeapon("palash", "sword", {
    tier: 3,
    label: "Palash",
    blurb: "Broad sabre. Shatters shields.",
    rod: 40,
    sby: 3,
    part: {
      mesh: PALASH,
      density: 45,
      sharpness: 3,
      sharpnessU: 1.5,
      bladeable: 1,
      bladeableU: 0.5,
      look: "blade",
      material: "steel",
      faces: PALASH_FACES,
    },
  }),

  // ---- dual sets: two weapons on rods, and a long rigid joint between them that pushes them to opposite sides
  // double_01.seria: PC → palash (rod 35, shiftB_y 3), PC → claw (rod 36.95, shiftB_y 3, density 15.38 here),
  // palash ↔ claw type 0, radius 101.08, necess 1
  {
    kind: "twin",
    cls: "dual",
    tier: 2,
    label: "Twin blades",
    blurb: "A sabre and a claw on opposite sides.",
    striker: "head",
    parts: [
      {
        key: "head",
        mesh: PALASH,
        density: 45,
        sharpness: 3,
        sharpnessU: 1.5,
        bladeable: 1,
        bladeableU: 0.5,
        hang: 35,
        look: "blade",
        material: "steel",
        rod: true,
        faces: PALASH_FACES,
      },
      { key: "back", mesh: CLAW, density: 15.3818, sharpness: 6, bladeable: 1, bladeableU: 0.6, hang: -36.953, angle: -Math.PI / 2, look: "blade", material: "steel", rod: true, faces: CLAW_FACES },
    ],
    joints: [
      { a: "hull", b: "head", type: 2, radius: 35, sby: 3, necess: 5 },
      { a: "hull", b: "back", type: 2, radius: 36.953, sby: 3, necess: 5 },
      { a: "head", b: "back", type: 0, radius: 101.084, say: 3, sby: 3, necess: 1 },
    ],
  },
  // tribun.seria: PC → axe_posolski (rod 58.8; density 70, sharpness 3.1, blade 0.5 with the u-side 0, spikeable),
  // PC → tribun blade (rod 25; density 5.1, sharpness 5, back 0.3, bladeable_u 0), axe ↔ blade type 0, radius 117.35
  {
    kind: "tribune",
    cls: "dual",
    tier: 3,
    label: "Tribune",
    blurb: "Envoy's axe with a blade behind.",
    striker: "head",
    parts: [
      // the sprite: a long spike on top (Demo m_spikeable u 1 / d 0.3), the fan blade below; the mesh follows them
      // (POSOLSKI, same mass)
      {
        key: "head",
        mesh: POSOLSKI,
        density: sameMass(POSOLSKI, box(5.999, 19.997), 70),
        sharpness: 3.1,
        bladeable: 0.5,
        bladeableU: 0,
        hang: 58.8221,
        look: "axe",
        material: "iron",
        rod: true,
        faces: [
          { kind: "spike", y1: -8, sharp: 3.1, spike: 1, hook: true },
          { kind: "blade", y0: 4, sharp: 3.1, blade: 0.5 },
          { kind: "blunt", sharp: 3.1 },
        ],
      },
      // the file mesh sat 6 px above the drawn barrel and left out the blade under the muzzle (to y 22; the exe has
      // the same gap): TRIBUN, same mass. Only the blade cuts; the barrel is blunt
      {
        key: "back",
        mesh: TRIBUN,
        density: sameMass(TRIBUN, hull([-24.167, -10.214, -22.925, 8.868, 24.136, 10.214, 24.167, -8.866]), 5.10288),
        sharpness: 5,
        sharpnessU: 1.5,
        bladeable: 1,
        bladeableU: 0,
        hang: -25,
        angle: -Math.PI / 2,
        look: "blade",
        material: "steel",
        rod: true,
        // tribun.seria: m_ammoclip_size 40, m_recoil_time 5
        gun: { ...BULLET, clip: 40, reload: 5 },
        faces: [
          { kind: "blade", x0: 11, y0: 0, sharp: 5, blade: 1 },
          { kind: "blunt", sharp: 1.5 },
        ],
      },
    ],
    joints: [
      { a: "hull", b: "head", type: 2, radius: 58.8221, necess: 5 },
      { a: "hull", b: "back", type: 2, radius: 25, necess: 5 },
      { a: "head", b: "back", type: 0, radius: 117.351, necess: 1 },
    ],
  },
  // ---- weapons the exe builds in code (item factory 0x486ff0; values read from the asm) ----
  // hammer_krank (id 205): box 17 × 34, density 64, sharpness 3, rod 60
  rodWeapon("krankhammer", "hammer", {
    tier: 3,
    label: "Krank hammer",
    blurb: "A long-headed brute.",
    rod: 60,
    // the drawn barrel has conical caps (to ±20.5, the box was ±17): KRANK, same mass. The cones are short and blunt
    // (no hook): the whole head knocks back
    part: { mesh: KRANK, density: sameMass(KRANK, box(8.5, 17), 64), sharpness: 3, bladeable: 0, look: "hammer", material: "iron" },
  }),
  // hammer_gold (id 206), "Dayram's hammer": box 19 × 31, density 60, sharpness 3, rod 60
  rodWeapon("goldhammer", "hammer", {
    tier: 3,
    label: "Dayram's hammer",
    blurb: "A champion's gold hammer.",
    rod: 60,
    part: { mesh: box(9.5, 15.5), density: 60, sharpness: 3, bladeable: 0, look: "hammer", material: "gold" },
  }),
  // axe_gold (id 225), "axe of Avire-Aseed": box 19 × 35, density 55, sharpness 3, bladeable 1 (u-side 0), m_spikeable
  // 1 (u-side 1, d-side 0), rod 58, m_jrad_y −1. The sprite: a horn spike on top (the u side), the crescent below; the
  // mesh follows both (GOLDAXE, same mass)
  rodWeapon("goldaxe", "axe", {
    tier: 3,
    label: "Avire-Aseed axe",
    blurb: "A champion's gold axe.",
    rod: 58,
    sby: -1,
    part: {
      mesh: GOLDAXE,
      density: sameMass(GOLDAXE, box(9.5, 17.5), 55),
      sharpness: 3,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "gold",
      faces: [
        { kind: "spike", y1: -9, sharp: 3, spike: 1, hook: true },
        { kind: "blade", y0: 6, sharp: 3, blade: 1 },
        { kind: "blunt", sharp: 3 },
      ],
    },
  }),
  // gold_blade (id 238), "Arjuna sword": box 44 × 14, density 35, sharpness 3.5, bladeable 1 both edges, rod 49
  rodWeapon("goldblade", "sword", {
    tier: 3,
    label: "Arjuna sword",
    blurb: "A champion's gold sword.",
    rod: 49,
    // two-edged, pointed
    part: sword({ mesh: box(22, 7), density: 35, sharpness: 3.5, bladeable: 1, look: "blade", material: "gold" }, { edge: 1 }),
  }),
  // mace_sharp (id 216): 4 chain_large links (the first 12 × 6.6), 3 spiked links (15 × 20, 16 × 21, 17 × 22,
  // sharpness 3 = Body default 1 + 2, bladeable 1; RE_WEAPONS.md §1), handle 31 × 9, ball an octagon 30 × 30,
  // density 30, sharpness 3.5, bladeable 1
  {
    kind: "spikedflail",
    cls: "mace",
    tier: 3,
    label: "Spiked flail",
    blurb: "Bladed links and a spiked ball.",
    striker: "ball",
    parts: [
      { key: "link0", mesh: box(6, 3.3), density: 20, sharpness: 1, bladeable: 0, hang: 10, look: "link", material: "iron" },
      linkPart(1, 19, 20, "iron"),
      linkPart(2, 28, 20, "iron"),
      linkPart(3, 37, 20, "iron"),
      // each segment is a chain ring (−x half: it only pushes) with a crescent blade on its +x side
      { key: "spike3", mesh: box(7.5, 10), density: 20, sharpness: 3, bladeable: 1, hang: 47, look: "spike", material: "iron", faces: SEGMENT_FACES },
      { key: "spike2", mesh: box(8, 10.5), density: 20, sharpness: 3, bladeable: 1, hang: 59, look: "spike", material: "iron", faces: SEGMENT_FACES },
      // the biggest blade's points reach ±15.5 (SHARP_SEG1, same mass)
      { key: "spike1", mesh: SHARP_SEG1, density: sameMass(SHARP_SEG1, box(8.5, 11), 20), sharpness: 3, bladeable: 1, hang: 73, look: "spike", material: "iron", faces: SEGMENT_FACES },
      { key: "handle", mesh: box(15.5, 4.5), density: 30, sharpness: 1, bladeable: 0, hang: 90, look: "handle", material: "wood" },
      // a disc ringed with short spikes (SHARP_BALL, same mass): they pierce head-on (OURS: the exe has m_bladeable 1
      // and no m_spikeable) and cut when they rake past
      {
        key: "ball",
        mesh: SHARP_BALL,
        density: sameMass(SHARP_BALL, ngon(8, 30, 30), 30),
        sharpness: 3.5,
        bladeable: 1,
        hang: 101,
        look: "ball",
        material: "iron",
        faces: [{ kind: "spike", sharp: 3.5, spike: 0.5, hook: true, blade: 1 }],
      },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      { a: "link0", b: "link1", type: 3, radius: 9, necess: 999 },
      { a: "link1", b: "link2", type: 3, radius: 9, necess: 999 },
      { a: "link2", b: "link3", type: 3, radius: 9, necess: 999 },
      { a: "link3", b: "spike3", type: 5, radius: 5, sbx: -5, necess: 999 },
      { a: "spike3", b: "spike2", type: 5, radius: 1, sax: 5, sbx: -6, necess: 999 },
      { a: "spike2", b: "spike1", type: 5, radius: 1, sax: 6, sbx: -7, necess: 999 },
      { a: "spike1", b: "handle", type: 5, radius: 2, sax: 7, sbx: -8, necess: 999 },
      { a: "handle", b: "ball", type: 5, radius: 3, sax: 8, necess: 999 },
    ],
  },
  // mace_krank (id 215): 6 chain_large links (the first 14 × 8.4), grip mace_krank_hold 38 × 10, ball an octagon
  // 34 × 34, density 70, sharpness 2
  {
    kind: "krankmace",
    cls: "mace",
    tier: 3,
    label: "Krank mace",
    blurb: "A wrecking ball on a long grip.",
    striker: "ball",
    parts: [
      { key: "link0", mesh: box(7, 4.2), density: 20, sharpness: 1, bladeable: 0, hang: 10, look: "link", material: "iron" },
      linkPart(1, 19, 20, "iron"),
      linkPart(2, 28, 20, "iron"),
      linkPart(3, 37, 20, "iron"),
      linkPart(4, 46, 20, "iron"),
      linkPart(5, 55, 20, "iron"),
      { key: "handle", mesh: box(19, 5), density: 30, sharpness: 1, bladeable: 0, hang: 74, look: "handle", material: "iron" },
      { key: "ball", mesh: ngon(8, 34, 34), density: 70, sharpness: 2, bladeable: 0, hang: 89, look: "ball", material: "stone" },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      { a: "link0", b: "link1", type: 3, radius: 9, necess: 999 },
      { a: "link1", b: "link2", type: 3, radius: 9, necess: 999 },
      { a: "link2", b: "link3", type: 3, radius: 9, necess: 999 },
      { a: "link3", b: "link4", type: 3, radius: 9, necess: 999 },
      { a: "link4", b: "link5", type: 3, radius: 9, necess: 999 },
      { a: "link5", b: "handle", type: 5, radius: 2, sbx: -17, necess: 999 },
      { a: "handle", b: "ball", type: 5, radius: 5, sax: 10, necess: 999 },
    ],
  },
  // ---- more of the item factory (ids from 0x486ff0) ----
  // hammer_kolotun (201): box 17 × 35, density 35, sharpness 2, rod 60
  rodWeapon("kolotun", "hammer", {
    tier: 1,
    label: "Kolotun",
    blurb: "A long, light thumper.",
    rod: 60,
    part: { mesh: box(8.5, 17.5), density: 35, sharpness: 2, bladeable: 0, look: "hammer", material: "iron" },
  }),
  // hammer_klevec (203): box 16 × 32, density 60, sharpness 3, rod 60. The sprite has a long spike on each striking
  // face: the mesh follows them (KLEVEC, same mass), the points pierce and hook in (OURS: the exe gives it no
  // m_spikeable), and the block between them hits like the iron hammer (sharpness 2).
  rodWeapon("klevec", "hammer", {
    tier: 2,
    label: "Klevec",
    blurb: "Spikes on both faces. They dig in.",
    rod: 60,
    part: {
      mesh: KLEVEC,
      density: sameMass(KLEVEC, box(8, 16), 60),
      sharpness: 3,
      bladeable: 0,
      look: "hammer",
      material: "steel",
      faces: [
        { kind: "spike", y1: -12, sharp: 3, spike: 1, hook: true },
        { kind: "spike", y0: 12, sharp: 3, spike: 1, hook: true },
        { kind: "blunt", sharp: 2 },
      ],
    },
  }),
  // hammer_war (204): box 16 × 40, density 60, sharpness 2, rod 60
  rodWeapon("warhammer", "hammer", {
    tier: 3,
    label: "War hammer",
    blurb: "A tall, heavy head.",
    rod: 60,
    part: { mesh: box(8, 20), density: 60, sharpness: 2, bladeable: 0, look: "hammer", material: "iron" },
  }),
  // axe_axis (218): 5-gon 27 × 27, density 50, sharpness 3.5 (×0.75 on the blade side), bladeable 1 (u-side 0),
  // m_spikeable 0.3 (u-side 1, d-side 0), rod 52. The sprite: the crescent round the +x/+y side, a short spike on top
  // (the u side); the mesh follows them (AXIS, same mass)
  rodWeapon("axis", "axe", {
    tier: 2,
    label: "Axis",
    blurb: "A five-sided cleaver.",
    rod: 52,
    part: {
      mesh: AXIS,
      density: sameMass(AXIS, ngon(5, 27, 27), 50),
      sharpness: 2.625,
      sharpnessU: 3.5,
      bladeable: 1,
      bladeableU: 0,
      look: "axe",
      material: "iron",
      faces: [
        { kind: "spike", y1: -8, x1: 6, sharp: 3.5, spike: 0.3, hook: true },
        { kind: "blade", y0: 0, sharp: 2.625, blade: 1 },
        { kind: "blade", x0: 12, sharp: 2.625, blade: 1 },
        { kind: "blunt", sharp: 3.5 },
      ],
    },
  }),
  // axe_eclips (220): 8-gon 30 × 32, density 35, sharpness 3.2, bladeable 1, rod 51. The ring blade is wider than the
  // octagon (ECLIPSE, same mass); it cuts on every side
  rodWeapon("eclipse", "axe", {
    tier: 2,
    label: "Eclipse",
    blurb: "A round blade. Cuts on every side.",
    rod: 51,
    part: { mesh: ECLIPSE, density: sameMass(ECLIPSE, ngon(8, 30, 32), 35), sharpness: 3.2, bladeable: 1, look: "axe", material: "steel" },
  }),
  // axe_mamba (224): 6-gon 32 × 32, density 35, sharpness 4, bladeable 1, rod 52. The C-blade reaches past the hexagon
  // (MAMBA, same mass; its hollow is filled); it cuts on every side
  rodWeapon("mamba", "axe", {
    tier: 2,
    label: "Mamba",
    blurb: "Light, wide and very sharp.",
    rod: 52,
    part: { mesh: MAMBA, density: sameMass(MAMBA, ngon(6, 32, 32), 35), sharpness: 4, bladeable: 1, look: "axe", material: "steel" },
  }),
  // axe_pike (219): box 9 × 45, density 70, sharpness 3.5, no blade, m_spikeable 1 × 0.9 on both sides (0x48b61f),
  // rod 58. The sprite is a pick: a point on each face, curving back. The mesh follows it (PIKE, same mass); the
  // middle (the socket) hits blunt.
  rodWeapon("pike", "axe", {
    tier: 3,
    label: "Pike",
    blurb: "A heavy pick. Its points hook in.",
    rod: 58,
    part: {
      mesh: PIKE,
      density: sameMass(PIKE, box(4.5, 22.5), 70),
      sharpness: 3.5,
      bladeable: 0,
      look: "blade",
      material: "iron",
      faces: [
        { kind: "spike", y1: -12, sharp: 3.5, spike: 0.9, hook: true },
        { kind: "spike", y0: 12, sharp: 3.5, spike: 0.9, hook: true },
        { kind: "blunt", sharp: 2.5 },
      ],
    },
  }),
  // imperia_blade (236): box 57 × 10, density 35, sharpness 4.2 (back 0.3×), bladeable 1 (back 0), rod 47
  rodWeapon("imperia", "sword", {
    tier: 2,
    label: "Imperia blade",
    blurb: "Long and thin. One keen edge.",
    rod: 47,
    // one edge; the engraved back is a spine
    part: sword({ mesh: box(28.5, 5), density: 35, sharpness: 4.2, sharpnessU: 1.26, bladeable: 1, bladeableU: 0, look: "blade", material: "steel" }, { spine: 1.26 }),
  }),
  // liberia_blade (235): box 51 × 15, density 30, sharpness 3.5, bladeable 1, rod 43
  rodWeapon("liberia", "sword", {
    tier: 2,
    label: "Liberia blade",
    blurb: "A broad, even sword.",
    rod: 43,
    // the drawn point reaches x 30.5 (LIBERIA, same mass)
    // two-edged, pointed
    part: sword({ mesh: LIBERIA, density: sameMass(LIBERIA, box(25.5, 7.5), 30), sharpness: 3.5, bladeable: 1, look: "blade", material: "steel" }, { edge: 1 }),
  }),
  // sun_blade (239): box 48 × 20, density 30, sharpness 3.5, bladeable 1, rod 51
  rodWeapon("sunblade", "sword", {
    tier: 3,
    label: "Sun blade",
    blurb: "A wide blade on a long rod.",
    rod: 51,
    // two-edged, round point (it still stabs)
    part: sword({ mesh: box(24, 10), density: 30, sharpness: 3.5, bladeable: 1, look: "blade", material: "gold" }, { edge: 1 }),
  }),
  // cyclon_blade (245): a 10-gon disc 29 × 29 (density 20, sharpness 3) on a short rod (12), and cyclon_arm (box
  // 50 × 10, density 20, sharpness 1: a Body-class part keeps the default; RE_WEAPONS.md §1) hung from the disc by a
  // type 0 joint (radius 5, shiftA_x 22, necess 30): it whirls round.
  {
    kind: "cyclone",
    cls: "sword",
    tier: 2,
    label: "Cyclone",
    blurb: "A spinning disc and a flail arm.",
    striker: "arm",
    parts: [
      // the disc is drawn as a toothed saw (the exe: Body default m_bladeable 0, m_effect_type 7): it grinds
      {
        key: "head",
        mesh: ngon(10, 29, 29),
        density: 20,
        sharpness: 3,
        bladeable: 1,
        hang: 12,
        look: "ball",
        material: "steel",
        rod: true,
        faces: [{ kind: "saw", sharp: 3 }],
      },
      // the arm is a wide braced frame (CYCLONE_ARM, same mass; the box was 50 × 10), blunt
      { key: "arm", mesh: CYCLONE_ARM, density: sameMass(CYCLONE_ARM, box(25, 5), 20), sharpness: 1, bladeable: 0, hang: 39, angle: -Math.PI / 2, look: "handle", material: "iron" },
    ],
    joints: [
      { a: "hull", b: "head", type: 2, radius: 12, necess: 5 },
      { a: "arm", b: "head", type: 0, radius: 5, sax: 22, necess: 30 },
    ],
  },
  // mace_blade (210): 8 chain_large links, an axe-like head (6-gon 39 × 20, density 50, sharpness 2, bladeable 1 on
  // one side, 0.9 on the other) on a type 5 (radius 7, shiftB_y -16)
  {
    kind: "bladeflail",
    cls: "mace",
    tier: 3,
    label: "Blade flail",
    blurb: "An axe head on a long chain.",
    striker: "ball",
    parts: [
      ...chain(8, 10, 9, true).parts,
      // the crescent is wider and deeper than the hexagon (BLADE_HEAD, same mass): its curve and horns cut, the flat
      // top under the chain ring is blunt
      {
        key: "ball",
        mesh: BLADE_HEAD,
        density: sameMass(BLADE_HEAD, ngon(6, 39, 20), 50),
        sharpness: 2,
        bladeable: 0.9,
        bladeableU: 0,
        hang: 96,
        angle: 0,
        look: "axe",
        material: "iron",
        faces: [
          { kind: "blade", y0: -2, sharp: 2, blade: 0.9 },
          { kind: "blade", x1: -15, sharp: 2, blade: 0.9 },
          { kind: "blade", x0: 15, sharp: 2, blade: 0.9 },
          { kind: "blunt", sharp: 2 },
        ],
      },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      ...chain(8, 10, 9, true).joints,
      // shiftB_y −16 (0x48bdfd): the head hangs by its ring, the crescent down
      { a: "link7", b: "ball", type: 5, radius: 7, sby: -16, necess: 999 },
    ],
  },
  // mace_orb (207): 10 chain_small links, mace_orb_hand, an 8-gon ball 25 × 25, density 70, sharpness 2
  {
    kind: "orbmace",
    cls: "mace",
    tier: 2,
    label: "Orb mace",
    blurb: "A small, dense ball. Longest chain.",
    striker: "ball",
    parts: [
      ...chain(10, 10, 7, false).parts,
      orbHand(87),
      { key: "ball", mesh: ngon(8, 25, 25), density: 70, sharpness: 2, bladeable: 0, hang: 98, look: "ball", material: "stone" },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      ...chain(10, 10, 7, false).joints,
      { a: "link9", b: "handle", type: 5, radius: 2, sbx: -12, necess: 999 },
      { a: "handle", b: "ball", type: 5, radius: 3, sax: 8, necess: 999 },
    ],
  },
  // mace_star (212): mace_hand on a rod (13), 6 chain_small links, an 8-gon ball 25 × 25, density 70, sharpness 3.9
  // (spiked) on a type 5 (radius 10). The mount joint keeps the constructor's necess 999 (RE_WEAPONS.md §1).
  {
    kind: "starmace",
    cls: "mace",
    tier: 2,
    label: "Morning star",
    blurb: "A spiked ball on a short chain.",
    striker: "ball",
    // the hand collides (layer 8) but is a grip: it only pushes. The ball's eight spikes reach r 17, past the
    // 25 × 25 octagon: the mesh is the hull of their points (STAR, same mass); they pierce and hook in (m_spikeable 1)
    parts: [
      { ...maceHand(13), faces: GRIP_FACES },
      ...chain(6, 30, 7, false).parts,
      {
        key: "ball",
        mesh: STAR,
        density: sameMass(STAR, ngon(8, 25, 25), 70),
        sharpness: 3.9,
        bladeable: 0,
        hang: 75,
        look: "ball",
        material: "iron",
        faces: [{ kind: "spike", sharp: 3.9, spike: 1, hook: true }],
      },
    ],
    joints: [
      { a: "hull", b: "hand", type: 2, radius: 13, necess: 999 },
      { a: "hand", b: "link0", type: 5, radius: 5, sax: 12, necess: 999 },
      { a: "hand", b: "link0", type: 3, radius: 5, sax: 12, necess: 999 },
      ...chain(6, 30, 7, false).joints,
      { a: "link5", b: "ball", type: 5, radius: 10, necess: 999 },
    ],
  },
  // mace_stix2 (209): mace_hand on a rod (13), 5 chain_small links, a bar 35 × 9, density 70, sharpness 3 on a type 5
  // (radius 1, shiftB_x -26). The first link has density 60; the mount joint keeps necess 999 (RE_WEAPONS.md §1).
  {
    kind: "stixmace",
    cls: "mace",
    tier: 2,
    label: "Stix",
    blurb: "A heavy bar on a short chain.",
    striker: "ball",
    // the bar carries three spiked rings (points at ±9.5, the box was ±4.5): STIX, same mass. The points pierce
    // (OURS: the exe has no m_spikeable here) but are too short to hook in; the bar's ends are blunt
    parts: [
      maceHand(13),
      ...chain(5, 30, 7, false, 60).parts,
      {
        key: "ball",
        mesh: STIX,
        density: sameMass(STIX, box(17.5, 4.5), 70),
        sharpness: 3,
        bladeable: 0,
        hang: 85,
        look: "handle",
        material: "iron",
        faces: [
          { kind: "spike", y1: -6, sharp: 3, spike: 0.5 },
          { kind: "spike", y0: 6, sharp: 3, spike: 0.5 },
          { kind: "blunt", sharp: 2 },
        ],
      },
    ],
    joints: [
      { a: "hull", b: "hand", type: 2, radius: 13, necess: 999 },
      { a: "hand", b: "link0", type: 5, radius: 5, sax: 12, necess: 999 },
      { a: "hand", b: "link0", type: 3, radius: 5, sax: 12, necess: 999 },
      ...chain(5, 30, 7, false, 60).joints,
      { a: "link4", b: "ball", type: 5, radius: 1, sbx: -26, necess: 999 },
    ],
  },
  // suriken_large (208): a flail, not a throwing star: 6 chain_large links, mace_orb_hand, an 8-gon star 26 × 26,
  // density 20, sharpness 3.5, bladeable 0.65
  {
    kind: "shuriken",
    cls: "mace",
    tier: 2,
    label: "Shuriken flail",
    blurb: "A light bladed star. Cuts.",
    striker: "ball",
    parts: [
      ...chain(6, 10, 9, true).parts,
      orbHand(69),
      { key: "ball", mesh: ngon(8, 26, 26), density: 20, sharpness: 3.5, bladeable: 0.65, hang: 80, look: "ball", material: "steel" },
    ],
    joints: [
      { a: "hull", b: "link0", type: 3, radius: 10, necess: 999 },
      ...chain(6, 10, 9, true).joints,
      { a: "link5", b: "handle", type: 5, radius: 2, sbx: -12, necess: 999 },
      { a: "handle", b: "ball", type: 5, radius: 3, sax: 8, necess: 999 },
    ],
  },
  // mace_claw (211): mace_claw_hand (box 48 × 8) on a rod (20), 3 chain_small links, then two jaws on a hinge:
  // claw_01 (box 10 × 30, density 57, sharpness 0.5 = Body default 1 − 0.5) and claw_02 (box 20 × 30, density 60,
  // sharpness 1.5), type 2, r 15. The first link has density 57; the mount joint keeps necess 999 (RE_WEAPONS.md §1).
  {
    kind: "clawmace",
    cls: "mace",
    tier: 3,
    label: "Claw mace",
    blurb: "Two iron jaws on a chain.",
    striker: "ball",
    parts: [
      maceHand(20, 48),
      ...chain(3, 46, 7, false, 57).parts,
      // two curved claws: their points pierce and hook in (the head: m_spikeable 1 × 0.6 both sides; the jaw: OURS),
      // the hinge side (−x) only pushes, the rest is blunt. The meshes follow the claws (CLAW_JAW, CLAW_HEAD, same mass)
      {
        key: "jaw",
        mesh: CLAW_JAW,
        density: sameMass(CLAW_JAW, box(5, 15), 57),
        sharpness: 0.5,
        bladeable: 0,
        hang: 81,
        look: "spike",
        material: "iron",
        faces: [
          { kind: "spike", y1: -11, sharp: 1.5, spike: 0.6, hook: true },
          { kind: "spike", y0: 11, sharp: 1.5, spike: 0.6, hook: true },
          { kind: "shaft", x1: -6, sharp: 0.5 },
          { kind: "blunt", sharp: 0.5 },
        ],
      },
      {
        key: "ball",
        mesh: CLAW_HEAD,
        density: sameMass(CLAW_HEAD, box(10, 15), 60),
        sharpness: 1.5,
        bladeable: 0,
        hang: 96,
        look: "spike",
        material: "iron",
        faces: [
          { kind: "spike", y1: -12, sharp: 1.5, spike: 0.6, hook: true },
          { kind: "spike", y0: 12, sharp: 1.5, spike: 0.6, hook: true },
          { kind: "shaft", x1: -10, sharp: 1.5 },
          { kind: "blunt", sharp: 1.5 },
        ],
      },
    ],
    joints: [
      { a: "hull", b: "hand", type: 2, radius: 20, necess: 999 },
      { a: "hand", b: "link0", type: 5, radius: 5, sax: 21, necess: 999 },
      { a: "hand", b: "link0", type: 3, radius: 5, sax: 21, necess: 999 },
      ...chain(3, 46, 7, false, 57).joints,
      { a: "link2", b: "jaw", type: 5, radius: 1, sbx: -20, necess: 999 },
      { a: "jaw", b: "ball", type: 2, radius: 15, necess: 999 },
    ],
  },
];

export const WEAPONS = Object.fromEntries(list.map((w) => [w.kind, w])) as Record<WeaponKind, WeaponSpec>;
export const WEAPON_LABEL = Object.fromEntries(list.map((w) => [w.kind, w.label])) as Record<WeaponKind, string>;
