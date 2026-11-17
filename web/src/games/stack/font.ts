// Stack Attack's two fonts, bundled (the TV may have no internet): Rubik Mono One and Inter (variable), latin subsets.
// Loaded from TS rather than an @font-face url in the CSS, as hammer/font.ts explains (the TV build inlines the CSS).
import interUrl from "./fonts/Inter-latin.woff2?url";
import monoUrl from "./fonts/RubikMonoOne-latin.woff2?url";

let started = false;

export function loadFonts(): Promise<unknown> {
  if (started || typeof FontFace === "undefined") return Promise.resolve();
  started = true;
  const faces: Array<[string, string, string]> = [
    ["Stack Mono", monoUrl, "400"],
    ["Stack Sans", interUrl, "100 900"],
  ];
  return Promise.all(
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
}
