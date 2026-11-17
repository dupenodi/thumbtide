// Lift-off's palette and type in one place: a space-age mission poster.
export const LOOK = {
  navy: "#0b1530",
  deep: "#070e22",
  orange: "#ff6a2b",
  chalk: "#eef2f7",
  teal: "#29b3a8",
  slate: "#3a4766",
  slateHi: "#4d5b80",
  dim: "#8c97b3",
} as const;

/** Eight crew colours that read on navy and on the slate engine skirt, kept clear of the rocket's orange. */
export const CREW = ["#ffd23f", "#4fc3ff", "#ff5c8a", "#7ee081", "#b48cff", "#ff9f43", "#36d6c4", "#c6f04d"];

export const DISPLAY = `"Liftoff Display", "Chakra Petch", system-ui, sans-serif`;
export const SANS = `"Liftoff Sans", Inter, system-ui, sans-serif`;

/** A name for how high the crew got. */
export function tierOf(h: number): string {
  if (h < 50) return "Pad hop";
  if (h < 150) return "Low ceiling";
  if (h < 300) return "Cloud line";
  if (h < 500) return "High altitude";
  if (h < 800) return "Edge of space";
  return "Orbit";
}
