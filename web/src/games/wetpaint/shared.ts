/**
 * Wet Paint: tiny brushes fight over one canvas. Cover the most of it before time runs out.
 * Types and tuning shared by the TV (host) and phone (controller) sides.
 */

export const GRID_W = 144; // canvas cells across
export const GRID_H = 81; // canvas cells deep (16:9 like the TV)
export const ROUND_SECONDS = 90;
/** Shorter rounds for testing (?round=20 on the TV page). */
export const roundOverride = (): number | null => {
  const v = Number(typeof location === "undefined" ? NaN : new URLSearchParams(location.search).get("round"));
  return Number.isFinite(v) && v >= 10 && v <= 600 ? v : null;
};
export const INTRO_SECONDS = 3.5;
/** The first round's count-in is a little longer: time to find your brush and have a drive around. */
export const FIRST_INTRO_SECONDS = 5;
export const MAX_BRUSHES = 8;

export const TUNING = {
  // Movement feel. These defaults match wetpaint.pad, which is where to tune them (the game applies its tune block).
  speed: 29, // cells per second at full stick
  accel: 20, // how quickly the brush reaches the stick's speed (per second)
  turn: 18, // how quickly it turns to face where it's going (per second)
  brushRadius: 2.8, // paint footprint, cells
  megaRadius: 5.2,
  /** Cells a full load paints (when covering canvas that isn't already yours). */
  loadCells: 760,
  regenOwn: 0.07, // load per second while standing on your own colour
  regenAnywhere: 0.015,
  dryBelow: 0.22, // under this load, strokes break up ("dry brush")
  bodyRadius: 2.4,
  dashSpeed: 74,
  dashSeconds: 0.22,
  dashCooldown: 2.4,
  bonkStun: 0.8,
  bonkSteal: 0.18,
  splatCost: 0.3,
  splatCooldown: 0.9,
  splatRange: 22,
  splatFlight: 0.6,
  splatRadius: 7.8,
  splatHitRadius: 6.8,
  splatStun: 1.4,
  splatDrain: 0.25,
  potRadius: 3.4,
  potRespawn: 2.5,
  // power-ups
  powerEvery: 6.5, // seconds between spawns (roughly)
  powerLife: 14, // seconds before an untouched one fizzles
  powerRadius: 3.6,
  turboMul: 1.65,
  bombMul: 2.1, // a paint bomb's splat is this much bigger
  rainDrops: 7,
  rainRadius: 4.8,
  dryLoad: 0.25, // a dry spell leaves rivals with this much of their paint
  // events
  showerCount: 4,
  wipeWidth: 20,
  wipeSeconds: 2.6,
  frenzySeconds: 15,
  frenzySpeed: 1.2,
  /** Cells painted in one go before the TV cheers. */
  streaks: [150, 320, 540, 820],
} as const;

/** One oil colour per brush: three mixes (light, half-tone, shade), painter-style. */
export interface PaintColor {
  name: string;
  light: string;
  half: string;
  shade: string;
}

export const PAINTS: PaintColor[] = [
  { name: "Vermilion", light: "#f2643f", half: "#d8402b", shade: "#952420" },
  { name: "Ultramarine", light: "#5a92e6", half: "#3263c4", shade: "#1f3a82" },
  { name: "Cadmium Yellow", light: "#ffd84d", half: "#f0b425", shade: "#bd7a16" },
  { name: "Viridian", light: "#43c28d", half: "#22966b", shade: "#135a46" },
  { name: "Dioxazine Violet", light: "#aa7fe3", half: "#7c50c0", shade: "#4a2b80" },
  { name: "Cadmium Orange", light: "#ffa24f", half: "#ec7a25", shade: "#ae4f18" },
  { name: "Quinacridone Rose", light: "#f36dab", half: "#cf3f87", shade: "#88215a" },
  { name: "Payne's Grey", light: "#717a8e", half: "#4a5063", shade: "#262a36" },
];

/** The primed canvas everyone starts on. */
export const PRIMER: PaintColor = { name: "Primer", light: "#f1e8d4", half: "#ddd0b3", shade: "#b6a586" };

// --------------------------------------------------------------------------------------------- power-ups

export type PowerKind = "turbo" | "mega" | "bomb" | "shield" | "rain" | "dry";
export type CandyTheme = "gold" | "candy" | "mint" | "sky" | "grape" | "fire" | "ice";

export interface PowerInfo {
  /** What the TV shouts when you grab it. */
  shout: string;
  /** Short name for the phone. */
  name: string;
  what: string;
  theme: CandyTheme;
  /** How long it lasts (0: one-off or until used). */
  seconds: number;
  weight: number;
}

export const POWERS: Record<PowerKind, PowerInfo> = {
  turbo: { shout: "TURBO!", name: "Turbo", what: "Zoom for a few seconds", theme: "sky", seconds: 6, weight: 22 },
  mega: { shout: "MEGA BRUSH!", name: "Mega", what: "A giant brush for a few seconds", theme: "gold", seconds: 7, weight: 18 },
  bomb: { shout: "PAINT BOMB!", name: "Bomb", what: "Your next SPLAT is huge, and free", theme: "fire", seconds: 0, weight: 16 },
  shield: { shout: "SHIELD!", name: "Shield", what: "Splats and bonks bounce off you", theme: "grape", seconds: 8, weight: 15 },
  rain: { shout: "PAINT RAIN!", name: "Rain", what: "Your colour rains on everyone else's", theme: "candy", seconds: 0, weight: 14 },
  dry: { shout: "DRY SPELL!", name: "Dry spell", what: "Everyone else's brush dries up", theme: "ice", seconds: 4, weight: 13 },
};
export const POWER_KINDS = Object.keys(POWERS) as PowerKind[];

export type EventKind = "shower" | "wipe" | "frenzy";

// --------------------------------------------------------------------------------------------- messages

export type Phase = "intro" | "play" | "end";

export interface ResultRow {
  id: string;
  name: string;
  slot: number;
  pct: number;
  wins: number;
}

export interface WetPaintShared {
  phase: Phase;
  round: number;
  /** End results (phase "end"). */
  results?: ResultRow[];
  title?: string;
  /** Players who didn't get a brush (all eight taken). */
  watching?: string[];
  frenzy?: boolean;
}

export interface WetPaintOwn {
  slot: number;
  paint: string; // colour name
  color: string; // half-tone hex
  light: string;
}

/**
 * Per-player HUD numbers, sent ~8 times a second:
 * [load 0..1, dash cooldown 0..1, stunned 0/1, % of canvas, mega s, turbo s, shield s, dried s, bomb ready 0/1, rank (1 = leading)]
 */
export type HudRow = [number, number, number, number, number, number, number, number, number, number];

export interface WetPaintGame {
  toHost: { type: "splat" } | { type: "dash" } | { type: "again" };
  toController:
    | { type: "hud"; t: number; p: Record<string, HudRow> }
    | { type: "buzz"; kind: "hit" | "bonked" | "pickup" | "dried" | "blocked" }
    | { type: "power"; kind: PowerKind }
  input: { x: number; y: number };
  shared: WetPaintShared;
  own: WetPaintOwn;
}
