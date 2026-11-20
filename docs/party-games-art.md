# Party games: art directions

> **Status (2026-11-20):** of these ten, only **Inkling** is still in the app. Blast Party and Punchline were cut in
> the lineup review; the other seven were paused on 2026-11-18 (see docs/notes.md). Kept as a record.

Ten new games (picked 2026-11-17). Each has its **own** visual identity (docs/notes.md: never reuse another game's
or the lobby's style). All of them must look good on a 4K TV and still run on the LG TV (Chrome 79–87, 1.5 GB).
Research behind this: flat vector party art (bright primaries, clean shapes, two-tone cel shading, soft oval ground
shadows), and Jackbox's practice of a shared structure with art that sets each game apart.

## Light by design (every game)

- **Canvas 2D or plain DOM.** No WebGL, no shaders. Text-heavy screens (Spyline, Punchline, Boomtown's cards) can be
  DOM; anything that moves every frame is one canvas.
- **Bake what doesn't move.** Backgrounds, textures, board art and sprite shapes are drawn once into offscreen
  canvases (per layout or size change) and blitted. Never rebuild gradients or paths for static art every frame.
- **No per-frame blur.** No `ctx.filter`, no `shadowBlur` in the frame loop, no CSS `filter`/`backdrop-filter` on
  anything that animates. A "glow" is a pre-rendered sprite, or a wide low-alpha stroke under a thin one.
- **Old Chrome.** No `color-mix()`, `:has()`, `aspect-ratio`, CSS nesting, `structuredClone`, top-level await.
- **Resolution.** Canvas backing size at most 1920 px wide on the TV (`isWebOS` from `shell/tv.ts`); full DPR elsewhere.
  A lite path (`isWebOS || startParam("lite")`) may drop to 30 fps and fewer particles.
- **Fonts.** At most two per game, bundled as a latin-subset `.woff2` in the game folder and loaded with `FontFace`
  (see `hammer/font.ts`; Google Fonts needs internet on the TV). Phones use Inter (already on the phone page).
- **Palette.** 4–6 named colours per game, in one place (`look.ts` or the CSS). Player colours: 8 that read on
  the game's background (remap `PLAYER_COLORS` if the game's palette needs it).
- **Motion is understated.** Something animates once, when it happens. One screen shake at most, small.
- **Phones are conventional** (notes.md): Inter, sentence case, a bottom panel with the status and buttons, tap to
  select then one primary button to confirm. The phone may carry the game's accent colour, not its art.
  Exception: Bridge Panic and Inkling, whose phone screens are the game, still use Inter labels and plain shapes.

## The games

### Blast Party (action, 2–8)
- **Look:** a toy-box diorama seen from above at a slight tilt. Flat painted wooden blocks, a felt floor.
- **Shapes:** round bean characters with a 3 px dark outline, one darker crescent of cel shade and a soft oval
  shadow sprite. Bombs are black spheres with a lit fuse.
- **Palette:** felt green `#3d7a4f`, wood `#e2b77a`, ink `#1d1a17`, fuse orange `#ff8a1f`, paper `#f6efe2`.
- **Type:** Lilita One (big words), Inter.
- **Motion:** the fuse spark speeds up before the blast. A blast is one expanding ring, 6 chunky debris bits and a
  4 px kick.

### Shove (action, 2–8)
- **Look:** a woodblock-print sumo ring seen from above. Sand inside a straw rope ring, on a deep indigo sea with a
  baked wave pattern.
- **Shapes:** players are round, heavy, daruma-like discs with one face mark in their colour.
- **Palette:** indigo `#1f2a44`, sand `#e8d6a8`, rope `#b98b4e`, vermilion `#d8432f`, foam `#f4f1e8`.
- **Type:** Dela Gothic One, Inter.
- **Motion:** a dash leaves three speed lines. A ring-out is one splash ripple. The ring shrinks with a short rope
  pull between rounds.

### Lift-off (co-op one-tap, 1–8)
- **Look:** space-age mission poster. Crisp flat vector rocket in a wide tunnel, night sky with a few stars. Walls
  and slabs only bump the rocket; the dangers are hazards (spiked mines with a blinking light, drifting meteors,
  slowly rotating spiked bars, sweeping laser gates), drawn from baked sprites.
- **Shapes:** the rocket is built from simple geometry; each thruster carries its player's colour chip and name.
- **Palette:** night navy `#0b1530`, signal orange `#ff6a2b`, chalk `#eef2f7`, teal `#29b3a8`, slate `#3a4766`.
- **Type:** Chakra Petch, Inter.
- **Motion:** a two-frame flame flicker per thruster. A crash breaks the rocket into five parts once.

### Trails (one-tap, 2–8)
- **Look:** vector arcade on graphite. Trails drawn incrementally onto a persistent canvas (never a full redraw).
- **Shapes:** a thin bright line with a wide low-alpha under-stroke on the head only; a faint baked dot grid.
- **Palette:** graphite `#0e0f13`, grid `#1c1f27`, white `#f2f4f8`, and 8 saturated player inks.
- **Type:** JetBrains Mono, Inter.
- **Motion:** a crash is 8 short lines bursting once, and that trail fades to 30 %.

### Stack Attack (falling blocks, 1–8)
- **Look:** risograph paper cut-out. Each player's well is a paper card on a kraft table.
- **Shapes:** block tiles are flat paper squares with a 2 px misregistered second ink baked into the tile sprite.
- **Palette:** kraft `#b7936a`, paper `#f3efe6`, riso pink `#ff48b0`, riso blue `#0078bf`, yellow `#ffe800`,
  ink `#1b1b1b`.
- **Type:** Rubik Mono One, Inter.
- **Originality:** our own piece set and attack rule, not a copy of the classic seven pieces.
- **Motion:** a cleared line tears off like a paper strip once.

### Bridge Panic (co-op, 2–8)
- **Look:** an analogue ship's bridge. On the TV, a big flat instrument panel: hull gauge, order ticker, alarm lamp.
- **Shapes:** phone controls look like chunky hardware (toggles, rotary dials, sliders, push buttons), flat with
  one highlight edge, Inter labels.
- **Palette:** olive `#4c5a3a`, panel grey `#2c3033`, amber lamp `#ffb000`, alert red `#e53935`, label white `#eceae4`.
- **Type:** Saira Condensed, Inter.
- **Motion:** a missed order shakes the panel once. The alarm lamp blinks in danger.

### Boomtown (property board, 2–8)
- **Look:** a mid-century illustrated city map. Our own city and district names, our own cards.
- **Shapes:** a flat board with districts as colour bands, geometric pawns, deeds and chance cards as flat tickets.
- **Palette:** teal `#14716f`, mustard `#e9a93a`, tomato `#e25b45`, ink `#1e2a2f`, map paper `#f7f5ef`.
- **Type:** DM Serif Display, Inter.
- **Motion:** the dice tumble for half a second. A purchase stamps "SOLD" once.

### Spyline (team word game, 4–8+)
- **Look:** a dossier table. Word cards as typed index cards on dark slate.
- **Teams:** Cobalt and Saffron. Our own word deck.
- **Palette:** slate `#22262b`, card `#f2efe8`, cobalt `#2b59c3`, saffron `#f2a516`, assassin black `#0d0d0d`.
- **Type:** Bebas Neue (headings), IBM Plex Mono (the words).
- **Motion:** a card flips once to its team colour with a stamp.

### Punchline (comedy answers, 3–8)
- **Look:** a late-night comedy club. A baked brick wall, a pre-rendered spotlight, answers on cue cards.
- **Shapes:** votes are chalk tally marks.
- **Palette:** curtain maroon `#5a0f1f`, brick `#8e3b2c`, spotlight `#ffe7a3`, chalk `#f5f2ea`, mic grey `#9aa3ad`.
- **Type:** Abril Fatface (titles), Inter (answers must be easy to read).
- **Content:** our own prompts.
- **Motion:** the winning card bounces once.

### Inkling (draw and guess, 2–8)
- **Look:** a sketchbook on a drafting table. A big paper sheet with a faint blue grid. Strokes render live.
- **Shapes:** guesses appear as small sticky notes. Player colours are marker tips.
- **Palette:** desk `#2f3a3f`, paper `#fbfaf6`, grid `#cfe0ee`, sticky `#ffe46b`, marker black `#1a1a1a`.
- **Type:** Caveat Brush (guesses, headings), Inter.
- **Content:** our own word list.
- **Motion:** a correct guess slaps a sticky note on with a small tilt.
