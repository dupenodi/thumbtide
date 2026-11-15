// The game font (Russo One). Loaded from TS rather than an @font-face url in the CSS: in the TV build the CSS is
// injected by the single script, and a CSS-relative url there resolves against the page instead of assets/.

import fontUrl from "./fonts/RussoOne-latin.woff2?url";

let started = false;

export function loadGameFont(): void {
  if (started || typeof FontFace === "undefined") return;
  started = true;
  try {
    const face = new FontFace("Russo One", `url(${fontUrl}) format("woff2")`, { display: "block" });
    document.fonts.add(face);
    void face.load().catch(() => {
      /* offline or blocked: the fallback font is used */
    });
  } catch {
    /* very old browser: fallback font */
  }
}
