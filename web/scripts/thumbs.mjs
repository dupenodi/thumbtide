// Make the lobby thumbnails from a folder of source images.
//
//   node scripts/thumbs.mjs <source folder> [--only=trails,cult] [--dry]
//
// A source image is named after its game (trails.png, cult.jpg, boomtown.webp: png, jpg, jpeg or webp), any size, ideally 16:9.
// Each one becomes, in src/games/<id>/thumb/:
//   card.webp  480x270, quality 78: the card in the lobby (TV and phone)
//   bg.webp    160x90,  quality 70: the lobby background. The TV scales it up to full screen; the bilinear
//                                   upscaling is the blur, so no CSS blur is needed (it costs too much memory on the LG).
// Both are cropped to 16:9 from the centre. Needs `sharp` (not a dependency of this repo yet: `pnpm add -D sharp` in web/).
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--"));
const only = (args.find((a) => a.startsWith("--only="))?.slice(7) ?? "").split(",").filter(Boolean);
const dry = args.includes("--dry");
if (!src) {
  console.error("usage: node scripts/thumbs.mjs <source folder> [--only=id,id] [--dry]");
  process.exit(2);
}

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  console.error("This script needs `sharp`. Install it with: pnpm add -D sharp (in web/), then run it again.");
  process.exit(1);
}

const games = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "games");
const dir = resolve(src);
if (!existsSync(dir) || !statSync(dir).isDirectory()) {
  console.error(`not a folder: ${dir}`);
  process.exit(2);
}

const SIZES = [
  { name: "card.webp", w: 480, h: 270, quality: 78 },
  { name: "bg.webp", w: 160, h: 90, quality: 70 },
];

let made = 0;
for (const file of readdirSync(dir).sort()) {
  const ext = extname(file).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) continue;
  const id = file.slice(0, -ext.length).toLowerCase();
  if (only.length && !only.includes(id)) continue;
  if (!existsSync(join(games, id))) {
    console.warn(`skip ${file}: no game folder src/games/${id}`);
    continue;
  }
  const out = join(games, id, "thumb");
  if (!dry) mkdirSync(out, { recursive: true });
  for (const s of SIZES) {
    if (!dry) await sharp(join(dir, file)).resize(s.w, s.h, { fit: "cover", position: "centre" }).webp({ quality: s.quality }).toFile(join(out, s.name));
    console.log(`${dry ? "would make" : "made"} ${id}/thumb/${s.name} (${s.w}x${s.h})`);
    made++;
  }
}
if (!made) console.warn("no images matched: name them <game id>.png (or .jpg / .webp)");
