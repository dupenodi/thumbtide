// Cult's art. `pnpm art cult` makes whatever is missing in web/public/art/cult/ (delete a file to remake it).
// `refs` are earlier pieces passed in as style references, so new pieces come off the same press.
import { INKS } from "./brand.mjs";

const refs = ["cult-law", "prophet"];

export default [
  // picked from the style exploration (kept as they are)
  { id: "cover", kept: true },
  { id: "town-law", kept: true },
  { id: "cult-law", kept: true },
  { id: "prophet", kept: true },

  {
    id: "backdrop", frame: "backdrop", ratio: "16:9", mp: 2, seed: 21, inks: INKS.cult, refs,
    subject: "A sleepy small American town at night seen from a hill: rows of little houses with a few lit windows, a church steeple, and a water tower with a single eye painted on it, under a huge pale moon.",
  },
  {
    id: "role-town", frame: "character", ratio: "2:3", seed: 23, inks: INKS.town, refs,
    subject: "A wary small-town citizen in a flat cap and work jacket, holding a lantern up and squinting into the dark, a pitchfork over one shoulder.",
  },
  {
    id: "role-cult", frame: "character", ratio: "2:3", seed: 29, inks: INKS.cult, refs,
    subject: "A hooded acolyte cradling a single lit candle against its chest; under the hood only a sly, knowing grin shows.",
  },
  {
    id: "card-back", frame: "card", ratio: "2:3", seed: 31, inks: INKS.cult, refs,
    subject: "The back of a playing card: a symmetrical repeating pattern of tiny all-seeing eyes and little houses in a halftone grid, around one central keyhole emblem.",
  },
  { id: "power-investigate", frame: "icon", ratio: "1:1", seed: 37, inks: INKS.cult, refs: ["prophet"], subject: "A brass-rimmed magnifying glass with a long wooden handle, held at an angle; through its round glass lens a single human eye stares back, enlarged." },
  { id: "power-peek", frame: "icon", ratio: "1:1", seed: 41, inks: INKS.cult, refs, subject: "Three playing cards fanned out, face down, the top one lifted at a corner with red light spilling from underneath." },
  { id: "power-pick", frame: "icon", ratio: "1:1", seed: 43, inks: INKS.cult, refs, subject: "A gloved hand presenting a mayor's tall top hat, offering it to someone." },
  { id: "power-burn", frame: "icon", ratio: "1:1", seed: 47, inks: INKS.cult, refs, subject: "A single wooden match mid-strike, its flame curling upward into the shape of a beckoning hand." },
  { id: "badge-mayor", frame: "icon", ratio: "1:1", seed: 53, inks: INKS.office, refs, subject: "A mayor's tall black top hat with a striped ribbon, seen from the front." },
  { id: "badge-sheriff", frame: "icon", ratio: "1:1", seed: 59, inks: INKS.office, refs, subject: "A six-pointed tin sheriff's star badge, front view, a little dented and scratched." },
  {
    id: "win-town", frame: "scene", ratio: "16:9", mp: 2, seed: 61, inks: INKS.town, refs,
    subject: "Dawn breaks over the small town: townsfolk silhouettes on a hill raise lanterns and pitchforks, and an abandoned cult robe burns in the foreground.",
  },
  {
    id: "win-cult", frame: "scene", ratio: "16:9", mp: 2, seed: 67, inks: INKS.cult, refs,
    subject: "The small town under a blood-red sky: a colossal all-seeing eye rises behind the water tower like a moon, and hooded figures stand in a circle with candles in the empty street below. Every shop sign and window is blank: no lettering anywhere.",
  },
];
