// The game library's building blocks, shared by the TV and the phones: cover art and a game's one-line facts.
import { CONTROL_ICONS } from "../kit/icons.ts";
import type { GameDef } from "../types.ts";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const playersText = (g: GameDef) =>
  g.minPlayers === g.maxPlayers ? `${g.minPlayers} players` : `${g.minPlayers}–${g.maxPlayers} players`;

const gameVars = (g: GameDef) => {
  const [a, b] = g.colors ?? ["#7c5cff", "#2de2c9"];
  return `--ga:${a};--gb:${b}`;
};

/** Cover art: the game's own image, or one drawn from its colours and glyph. Title sits on the art. */
export function coverHtml(g: GameDef, o: { title?: boolean } = {}): string {
  const glyph = g.glyph ? CONTROL_ICONS[g.glyph] : "";
  const art = g.cover
    ? `<img src="${esc(g.cover)}" alt="" decoding="async" draggable="false">`
    : `<i class="cv-glyph" style="-webkit-mask-image:${maskUrl(glyph)};mask-image:${maskUrl(glyph)}"></i>`;
  return `<div class="cv ${g.cover ? "" : "cv-drawn"}" style="${gameVars(g)}">${art}${
    o.title === false ? "" : `<div class="cv-cap"><b>${esc(g.title)}</b><small>${playersText(g)}</small></div>`
  }</div>`;
}

// single quotes: this ends up inside a style="…" attribute
const maskUrl = (svg: string) =>
  svg ? `url('data:image/svg+xml,${encodeURIComponent(svg.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '))}')` : "none";
