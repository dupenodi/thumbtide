// Boomtown's two fonts, bundled (the TV may have no internet): DM Serif Display (headings, numbers) and Inter (a
// variable font, 500–800), latin subsets. Loaded from TS rather than an @font-face url in the CSS, as hammer/font.ts
// explains.
import serifUrl from "./fonts/DMSerifDisplay-latin.woff2?url";
import interUrl from "./fonts/Inter-latin.woff2?url";

let started: Promise<unknown> | null = null;

export function loadFonts(): Promise<unknown> {
  if (started) return started;
  if (typeof FontFace === "undefined") return Promise.resolve();
  const faces: Array<[string, string, string]> = [
    ["Boom Serif", serifUrl, "400"],
    ["Boom Inter", interUrl, "400 800"],
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
