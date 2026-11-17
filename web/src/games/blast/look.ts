// Blast Party's palette and type in one place: a toy-box diorama, painted wood blocks on a felt floor.
export const LOOK = {
  felt: "#3d7a4f",
  feltDark: "#356b45",
  feltLight: "#4a8a5c",
  wood: "#e2b77a",
  woodSide: "#b98a52",
  woodDeep: "#8f6537",
  ink: "#1d1a17",
  fuse: "#ff8a1f",
  paper: "#f6efe2",
  void: "#1b1714",
  voidLine: "#25201b",
} as const;

/** Eight fighter colours that read on felt and on wood. */
export const INKS = ["#e5523d", "#4a97e0", "#f1b72f", "#d8579f", "#8264d0", "#2db5ae", "#efe6d2", "#b6d94c"];

/** Team colours: a warm team and a cool team, four shades each. */
export const TEAM_INKS = [
  ["#e5523d", "#f58a2a", "#d8579f", "#f1b72f"],
  ["#4a97e0", "#2db5ae", "#8264d0", "#7fb2e8"],
];
export const TEAM_NAMES = ["Tomato", "Sky"];
export const TEAM_COLORS = ["#e5523d", "#4a97e0"];

export const inkOf = (s: { slot: number; team: number; tix: number }) => (s.team >= 0 ? TEAM_INKS[s.team]![s.tix] ?? TEAM_INKS[s.team]![0]! : INKS[s.slot]!);

export const DISPLAY = `"Blast Display", "Lilita One", Impact, sans-serif`;
export const SANS = `"Blast Sans", Inter, system-ui, sans-serif`;
