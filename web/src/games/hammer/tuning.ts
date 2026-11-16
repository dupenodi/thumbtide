// Every number that shapes the feel, so the lab can expose it as a slider.
// Defaults are Hammerfight's own values (Config.ini and the code; see HAMMERFIGHT_PHYSICS.md).

export interface Tuning {
  /** Input units per mouse pixel / finger pixel (CORE_MOUSE_SPEEDn after calibration; Hammerfight PC mouse: 2.12). */
  mouseSpeed: number;
  /** PH_THRUST_PC. Force per frame = input · thrust · 0.6. */
  thrust: number;
  /** PH_RESIST_PC. Quadratic drag on the machine: F = −resist · |v|² · v̂. */
  resist: number;
  /** GAME_SPEEDCLIP_MOUSE. Hard top speed of the machine, px/s. */
  speedClip: number;
  /** PH_G. Gravity on weapons and wrecks, px/s². Live machines hover. */
  gravity: number;
  /** PH_JOINT_ITTERATIONS. Joint passes per step (each joint stops after pass 5, its m_necess). */
  passes: number;
  /** m_fCoR, all bodies. */
  cor: number;
  /** m_fCoF, all bodies. */
  cof: number;
  /** Damage = factor · sharpness · cut · impulse · 1e-5. Hammerfight: 0.1. */
  damage: number;
  /** GAME_SLOMO: big hits slow time to 0.3 and ease back over about 1.3 s. 1 = on. */
  slomo: number;
  /** Weapon clashes can knock the slower weapon off its machine (0x420ca0). 1 = on. */
  disarm: number;
  /** Teams: machines of the same team collide (1) or pass through each other (0). */
  teamCollision: number;
  /** Teams: hits on teammates hurt and stun (1) or do nothing (0). */
  teamDamage: number;
  /** Not in Hammerfight: lift that cancels this share of the weapon's weight (0 = original: the weapon drags the machine down). */
  hover: number;
  /** Not in Hammerfight: freeze on a hit, ms per 10 damage. */
  hitstop: number;
  /** Not in Hammerfight: how far past the frame edge the soft limit starts, px. */
  limit: number;
  /** Stiffness of the soft limit, Hz. */
  limitHz: number;
  /** Not in Hammerfight: 1 = hard walls on all four edges keep a live hull inside the frame (0 = off). */
  walls: number;
  // ---- hit types (not in Hammerfight, after the play test: "damage from inertia, not from resting contact";
  // "blades slice, blunt weapons bash"; "stun by hit type, damage and what the machine hits next")
  /** A blunt hit needs this approach speed (px/s, along the contact normal) to hurt or stun: resting contact doesn't. */
  bluntMinV: number;
  /** A blade cut needs this relative speed (px/s); a slower slide is a blunt touch. */
  cutMinV: number;
  /** A blade's edge that hits head-on (no slice) does this share of its sharpness. */
  bladeRam: number;
  /** Stun from a blunt hit, × the original shock (0.01·M per hit with M > 30). */
  stunScale: number;
  /** Share of that stun a cut gives (blades cut, they don't knock out). */
  stunCut: number;
  /** Most stun a machine can hold (Hammerfight 1, about 0.5 s at full health). */
  stunMax: number;
  /** Slam: in the 0.8 s after a stunning hit, hitting a wall, a machine or debris adds this × the slam impact as stun. */
  slam: number;
  /** Pieces a machine bursts into when it's wrecked; they hurt for 2.5 s. 0 = none. */
  gibs: number;
}

export const DEFAULT_TUNING: Tuning = {
  mouseSpeed: 2.12,
  thrust: 504000, // Hammerfight 300000; +20 % by request, then x1.4 (2026-11-15: "it looks like slow motion")
  resist: 300,
  speedClip: 550, // Hammerfight 350; +20 % by request, then 550 (+31 %) with the thrust
  gravity: 100,
  passes: 30,
  cor: 0.3,
  cof: 0.2,
  damage: 0.1,
  slomo: 1,
  disarm: 1,
  teamCollision: 1,
  teamDamage: 0,
  hover: 0,
  hitstop: 0,
  limit: 70,
  limitHz: 7,
  walls: 1,
  bluntMinV: 90,
  cutMinV: 100,
  bladeRam: 0.8,
  stunScale: 1.6,
  stunCut: 0.35,
  stunMax: 1.5,
  slam: 0.004,
  gibs: 5,
};

export interface TuningField {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const TUNING_FIELDS: TuningField[] = [
  { key: "mouseSpeed", label: "Mouse speed", min: 0.2, max: 10, step: 0.02 },
  { key: "thrust", label: "Thrust (PH_THRUST_PC)", min: 20000, max: 2000000, step: 10000 },
  { key: "resist", label: "Drag (PH_RESIST_PC)", min: 0, max: 2000, step: 10 },
  { key: "speedClip", label: "Top speed (px/s)", min: 100, max: 1500, step: 10 },
  { key: "gravity", label: "Gravity (px/s²)", min: 0, max: 600, step: 5 },
  { key: "passes", label: "Joint passes", min: 1, max: 50, step: 1 },
  { key: "cor", label: "Bounce (CoR)", min: 0, max: 1, step: 0.05 },
  { key: "cof", label: "Friction (CoF)", min: 0, max: 1, step: 0.05 },
  { key: "damage", label: "Damage factor", min: 0, max: 0.5, step: 0.005 },
  { key: "slomo", label: "Slow motion (0/1)", min: 0, max: 1, step: 1 },
  { key: "disarm", label: "Disarm on clash (0/1)", min: 0, max: 1, step: 1 },
  { key: "teamCollision", label: "Teammates collide (0/1)", min: 0, max: 1, step: 1 },
  { key: "teamDamage", label: "Friendly fire (0/1)", min: 0, max: 1, step: 1 },
  { key: "hover", label: "Hover assist (0 = original)", min: 0, max: 1, step: 0.05 },
  { key: "hitstop", label: "Hit-stop (ms/10hp)", min: 0, max: 80, step: 1 },
  { key: "limit", label: "Limit past frame (px)", min: 0, max: 200, step: 5 },
  { key: "limitHz", label: "Limit stiffness (Hz)", min: 1, max: 20, step: 0.5 },
];
