// Lift-off's fonts, bundled (the TV may have no internet): Chakra Petch 600 and 700 and Inter, latin subsets.
// Loaded from TS rather than an @font-face url in the CSS, as hammer/font.ts explains (the TV build inlines the CSS).
import petch600 from "./fonts/ChakraPetch-600-latin.woff2?url";
import petch700 from "./fonts/ChakraPetch-700-latin.woff2?url";
import interUrl from "./fonts/Inter-latin.woff2?url";

let started: Promise<unknown> | null = null;

export function loadFonts(): Promise<unknown> {
  if (started) return started;
  if (typeof FontFace === "undefined") return Promise.resolve();
  const faces: Array<[string, string, string]> = [
    ["Liftoff Display", petch600, "600"],
    ["Liftoff Display", petch700, "700"],
    ["Liftoff Sans", interUrl, "100 900"],
  ];
  started = Promise.all(
    faces.map(([family, url, weight]) => {
      try {
        const face = new FontFace(family, `url(${url}) format("woff2")`, { display: "block", weight });
        document.fonts.add(face);
        return face.load().catch(() => undefined); // offline or blocked: the fallback font is used
      } catch {
        return undefined;
      }
    }),
  );
  return started;
}
