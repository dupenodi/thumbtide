// Stack Attack's palette and type in one place: risograph paper cut-outs on a kraft table.
export const LOOK = {
  kraft: "#b7936a",
  kraftDark: "#8f6f4c",
  paper: "#f3efe6",
  pink: "#ff48b0",
  blue: "#0078bf",
  yellow: "#ffe800",
  ink: "#1b1b1b",
} as const;

/** Eight riso-like inks that read on paper, and the second ink each is misregistered with. */
export const INKS = ["#ff48b0", "#0078bf", "#00a95c", "#ff6c2f", "#765ba7", "#00838a", "#f15060", "#ffb511"];
export const SECOND = ["#0078bf", "#ff48b0", "#0078bf", "#ff48b0", "#ff48b0", "#ffe800", "#0078bf", "#ff48b0"];

export const MONO = `"Stack Mono", "Rubik Mono One", ui-monospace, monospace`;
export const SANS = `"Stack Sans", Inter, system-ui, sans-serif`;
