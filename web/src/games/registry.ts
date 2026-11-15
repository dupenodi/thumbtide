import { parsePad } from "./kit/pad.ts";
import type { GameDef } from "./types.ts";
import cascadePad from "./cascade/cascade.pad?raw";
import cultPad from "./cult/cult.pad?raw";
import hammerPad from "./hammer/hammer.pad?raw";
import sandboxPad from "./sandbox/sandbox.pad?raw";
import wetpaintPad from "./wetpaint/wetpaint.pad?raw";

/** Every game on the platform. Modules are lazy-loaded so phones only download what they need. */
export const GAMES: GameDef[] = [
  {
    id: "lobby",
    title: "Lobby",
    tagline: "",
    minPlayers: 0,
    maxPlayers: 16,
    hidden: true,
    host: () => import("./lobby/host.ts"),
    controller: () => import("./lobby/controller.ts"),
  },
  {
    id: "wetpaint",
    title: "Wet Paint",
    tagline: "Cover the canvas in your colour. Splat anyone in the way.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ff5d73", "#ffb84d"],
    cover: `${import.meta.env.BASE_URL}covers/wetpaint.webp`,
    glyph: "splat",
    controls: parsePad(wetpaintPad, "wetpaint.pad"),
    settings: [
      {
        key: "round",
        label: "Round length",
        options: [
          { value: 60, label: "1 min" },
          { value: 90, label: "1½ min" },
          { value: 120, label: "2 min" },
          { value: 180, label: "3 min" },
        ],
        default: 90,
      },
      { key: "powerups", label: "Power-ups", options: [{ value: true, label: "On" }, { value: false, label: "Off" }], default: true, applies: "now" },
      { key: "events", label: "Surprise events", options: [{ value: true, label: "On" }, { value: false, label: "Off" }], default: true, applies: "now" },
      {
        key: "bots",
        label: "Computer brushes",
        options: [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
        applies: "now",
      },
    ],
    host: () => import("./wetpaint/host.ts"),
    controller: () => import("./wetpaint/controller.ts"),
  },
  {
    id: "cult",
    title: "Cult",
    tagline: "Someone here leads a cult. Vote anyway.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ff4466", "#5b2bd6"],
    cover: `${import.meta.env.BASE_URL}art/cult/cover.webp`,
    glyph: "eye",
    controls: parsePad(cultPad, "cult.pad"),
    settings: [
      {
        key: "bots",
        label: "Extra computer players",
        options: [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
      },
    ],
    host: () => import("./cult/host.ts"),
    controller: () => import("./cult/controller.ts"),
  },
  {
    id: "cascade",
    title: "Cascade",
    tagline: "Start a chain reaction. Take the whole board.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#e23c5c", "#2c6cd8"],
    cover: `${import.meta.env.BASE_URL}covers/cascade.webp`,
    glyph: "pulse",
    controls: parsePad(cascadePad, "cascade.pad"),
    settings: [
      {
        key: "look",
        label: "Look",
        options: [
          { value: "culture", label: "Culture" },
          { value: "marbles", label: "Marbles" },
          { value: "reactor", label: "Reactor" },
        ],
        default: "culture",
        applies: "now",
      },
      {
        key: "board",
        label: "Board",
        options: [
          { value: "auto", label: "Auto" },
          { value: "small", label: "7 × 5" },
          { value: "medium", label: "9 × 6" },
          { value: "large", label: "11 × 7" },
          { value: "xl", label: "14 × 8" },
          { value: "huge", label: "18 × 10" },
          { value: "custom", label: "Custom" },
        ],
        default: "auto",
      },
      {
        key: "cols",
        label: "Columns",
        options: [5, 6, 8, 10, 12, 14, 16, 18, 20].map((n) => ({ value: n, label: String(n) })),
        default: 12,
        when: { key: "board", value: "custom" },
      },
      {
        key: "rows",
        label: "Rows",
        options: [4, 5, 6, 7, 8, 9, 10, 12].map((n) => ({ value: n, label: String(n) })),
        default: 8,
        when: { key: "board", value: "custom" },
      },
      {
        key: "timer",
        label: "Turn timer",
        options: [
          { value: 0, label: "Off" },
          { value: 10, label: "10s" },
          { value: 20, label: "20s" },
          { value: 30, label: "30s" },
        ],
        default: 20,
        applies: "now",
      },
      {
        key: "bots",
        label: "Computer players",
        options: [0, 1, 2, 3, 4].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
      },
    ],
    host: () => import("./cascade/host.ts"),
    controller: () => import("./cascade/controller.ts"),
  },
  {
    id: "hammer",
    title: "Rotor Brawl",
    tagline: "Fly a tiny machine. Swing a huge weapon. Last one flying wins.",
    minPlayers: 1,
    maxPlayers: 8,
    colors: ["#ffb547", "#3ec5ff"],
    glyph: "action",
    controls: parsePad(hammerPad, "hammer.pad"),
    settings: [
      {
        key: "mode",
        label: "Mode",
        options: [
          { value: "ffa", label: "Free for all" },
          { value: "teams", label: "Teams (odd vs even)" },
          { value: "pve", label: "Co-op vs CPU" },
          { value: "pvm", label: "Co-op vs monsters" },
        ],
        default: "ffa",
      },
      {
        key: "wins",
        label: "Rounds to win",
        options: [2, 3, 5].map((n) => ({ value: n, label: String(n) })),
        default: 3,
      },
      {
        key: "bots",
        label: "Computer players",
        options: [0, 1, 2, 3].map((n) => ({ value: n, label: n ? String(n) : "None" })),
        default: 0,
        applies: "now",
      },
      { key: "music", label: "Music", options: [{ value: true, label: "On" }, { value: false, label: "Off" }], default: true, applies: "now" },
      { key: "slomo", label: "Slow motion on big hits", options: [{ value: true, label: "On" }, { value: false, label: "Off" }], default: true, applies: "now" },
      { key: "teamCollision", label: "Teammates collide", options: [{ value: true, label: "Yes" }, { value: false, label: "No" }], default: true, applies: "now" },
      { key: "teamDamage", label: "Friendly fire", options: [{ value: false, label: "Off" }, { value: true, label: "On" }], default: false, applies: "now" },
    ],
    host: () => import("./hammer/host.ts"),
    controller: () => import("./hammer/controller.ts"),
  },
  {
    id: "sandbox",
    title: "Sandbox",
    tagline: "Check every phone is connected.",
    minPlayers: 1,
    maxPlayers: 16,
    colors: ["#3ec5ff", "#7c5cff"],
    glyph: "pulse",
    controls: parsePad(sandboxPad, "sandbox.pad"),
    host: () => import("./sandbox/host.ts"),
    controller: () => import("./sandbox/controller.ts"),
  },
];

export const gameById = (id: string) => GAMES.find((g) => g.id === id);
export const pickableGames = () => GAMES.filter((g) => !g.hidden);
