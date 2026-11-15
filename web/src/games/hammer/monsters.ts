// Monsters, after Hammerfight's Polypod creatures (worm builder 0x475160, armoured worm 0x4755f0, movement 0x433cd0).
//
// A worm is a small heavy core with a jaw in front and 8 box segments behind, joined by rods (type 2) whose radius is
// half the segment length, anchored on the previous part at 0.7 of its half-length. Its size s is random (0.55–0.7).
// It flies toward its target: from far it pushes, inside 150 px it lunges in pulses, inside 70 px it backs off; a
// stunned worm does not move. The armoured worm has the same body with armour plates: blades get no cut bonus on it
// (the game's tips: swords are weak against heavy armour).
//
// OURS (not read in the code): one health pool for the whole worm (the sum of its parts' health in the original), the
// jaw's sharpness 2, the force scale and the side-to-side wiggle.

import type { JointSpec } from "./weapons.ts";

export type MonsterKind = "worm" | "armoredworm";

export interface CreaturePart {
  key: string;
  /** Local box mesh. */
  mesh: number[];
  density: number;
  sharpness: number;
  /** m_jaws: a bite adds 0.3–3 × jaws damage. */
  jaws?: number;
  /** Position along the body axis at spawn, px (the head points to +x). */
  x: number;
  /** Spawn angle relative to the body axis (segments face backwards: π). */
  angle: number;
  look: "core" | "jaw" | "segment";
}

export interface CreatureLayout {
  kind: MonsterKind;
  name: string;
  /** "core" is the hull; the rest are parts. */
  core: CreaturePart;
  parts: CreaturePart[];
  joints: JointSpec[];
  hp: number;
  armored: boolean;
  /** Push strength factor, 0.35–1 (the code's F). */
  force: number;
}

const box = (hx: number, hy: number) => [-hx, -hy, hx, -hy, hx, hy, -hx, hy];
/** Segment scale from head to tail (thin tail). */
const SEGMENTS = [1.0, 1.1, 1.1, 1.02, 0.86, 0.62, 0.5, 0.5];

/**
 * `segments` (3-8, default 8): a shorter worm for a tight body budget (the TV). It keeps the tapered tail: the first
 * segments from the front, then the last two.
 */
export function wormLayout(kind: MonsterKind, s: number, force: number, segments = SEGMENTS.length): CreatureLayout {
  const n = Math.max(3, Math.min(SEGMENTS.length, Math.round(segments)));
  const segs = n >= SEGMENTS.length ? SEGMENTS : [...SEGMENTS.slice(0, n - 2), ...SEGMENTS.slice(-2)];
  const k = Math.max(0.1, Math.min(1, 1.4 * s));
  const coreHalf = 5 * k;
  const core: CreaturePart = { key: "core", mesh: box(coreHalf, coreHalf), density: 70, sharpness: 1, x: 0, angle: 0, look: "core" };
  const parts: CreaturePart[] = [];
  const joints: JointSpec[] = [];
  // jaw ahead of the core on a 10 px rod; its local −x points back at the core
  const jaw: CreaturePart = { key: "jaw", mesh: box(25 * s, 21 * s), density: 20, sharpness: 2, jaws: 1, x: 10, angle: 0, look: "jaw" };
  parts.push(jaw);
  joints.push({ a: "core", b: "jaw", type: 2, radius: 10, necess: 999 });
  let hp = 75 * s;
  // segments trail behind; each faces backwards so its local −x points at the part in front
  let prevKey = "core";
  let prevHalf = coreHalf;
  let prevX = 0;
  segs.forEach((v, i) => {
    const half = 17 * v * s;
    const anchorX = prevX - 0.7 * prevHalf;
    const x = anchorX - half;
    const key = `seg${i}`;
    parts.push({ key, mesh: box(half, 23.5 * v * s), density: 40, sharpness: 1, x, angle: Math.PI, look: "segment" });
    // A's anchor sits at 0.7 of its half-length toward the tail (local −x for the core, +x for a reversed segment)
    joints.push({ a: prevKey, b: key, type: 2, radius: half, sax: prevKey === "core" ? -0.7 * prevHalf : 0.7 * prevHalf, necess: 999 });
    hp += 50 * (v * s) ** 2;
    prevKey = key;
    prevHalf = half;
    prevX = x;
  });
  return {
    kind,
    name: kind === "armoredworm" ? "Armoured worm" : "Worm",
    core,
    parts,
    joints,
    hp: Math.round(hp),
    armored: kind === "armoredworm",
    force,
  };
}

/** Colours for drawing: body fill and stroke. */
export const MONSTER_LOOK: Record<MonsterKind, { fill: string; stroke: string; jaw: string }> = {
  worm: { fill: "#c8995a", stroke: "#7a5426", jaw: "#8e5a2b" },
  armoredworm: { fill: "#7c8496", stroke: "#3b4150", jaw: "#4d5466" },
};
