// Thumbtide's art direction: a two-colour screen-printed gig poster. Every generated image goes through this, so a
// new game's art looks like it came off the same press. Change a word here and regenerate to restyle everything.

/** How it's printed. */
export const STYLE =
  "Made as a two-colour screen-printed gig poster: flat bold shapes, chunky halftone-dot gradients, slight ink misregistration, " +
  "rough paper grain, fluorescent inks on black stock, graphic and punchy like a 1970s rock poster.";

/** The world it lives in. `inks` are the two bright colours for this piece. */
export const anchor = ([a, b]) =>
  `A deep ink-black world (#0b0b12) with only two bright accent colours, ${a} and ${b}. Tactile, a little dangerous. ` +
  "Mood: cheeky, late-night, mischievous, grown-up, never childish or cute. A bold, simple silhouette that reads from across a living room. " +
  "No text, no letters, no numbers, no logos, no watermark.";

/** Ink pairs. */
export const INKS = {
  cult: ["crimson (#ff4466)", "violet (#5b2bd6)"],
  town: ["sky blue (#3ec5ff)", "warm brass (#e0b062)"],
  office: ["warm brass (#e0b062)", "bone white (#f1e6d0)"],
};

/** Framing by kind of asset. */
export const FRAME = {
  cover: "A wide cinematic game cover: the hero object right of centre on a strong diagonal, lots of dark empty space on the left.",
  backdrop: "A wide TV backdrop: everything kept low and dim along the bottom edge; the upper two-thirds is mostly dark, empty night sky, so text and cards can sit on top.",
  scene: "A wide cinematic scene with one clear focal point and a dark band across the top for a title.",
  card: "A portrait playing-card face: one centred, symmetrical emblem inside a thin ornamental border, generous margins.",
  character: "A portrait character card: centred and symmetrical, the figure from the knees up, inside a thin ornamental border.",
  icon: "A single object, centred, isolated on plain black paper with nothing else around it, filling about 70% of the square.",
};
