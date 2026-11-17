// Spyline's two fonts, bundled (the TV may have no internet): Bebas Neue (headings) and IBM Plex Mono (the words),
// latin subsets. Loaded from TS rather than an @font-face url in the CSS, as hammer/font.ts explains.
import bebasUrl from "./fonts/BebasNeue-latin.woff2?url";
import mono500Url from "./fonts/IBMPlexMono-500-latin.woff2?url";
import mono600Url from "./fonts/IBMPlexMono-600-latin.woff2?url";

let started: Promise<unknown> | null = null;

export function loadFonts(): Promise<unknown> {
  if (started) return started;
  if (typeof FontFace === "undefined") return Promise.resolve();
  const faces: Array<[string, string, string]> = [
    ["Spy Bebas", bebasUrl, "400"],
    ["Spy Mono", mono500Url, "500"],
    ["Spy Mono", mono600Url, "600"],
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
