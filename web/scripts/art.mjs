#!/usr/bin/env node
// Generates a game's art with Replicate (FLUX.2 Pro) in the house style (art/brand.mjs).
//
//   pnpm art cult            make every piece in art/cult.mjs that isn't in public/art/cult/ yet
//   pnpm art cult win-town   remake one piece (overwrites it)
//
// Needs REPLICATE_API_TOKEN, read from the repo's .env.local (never committed).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FRAME, STYLE, anchor } from "../art/brand.mjs";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const [game, only] = process.argv.slice(2);
if (!game) throw new Error("usage: pnpm art <game> [piece]");
const token = process.env.REPLICATE_API_TOKEN;
if (!token) throw new Error("REPLICATE_API_TOKEN isn't set (put it in the repo's .env.local)");

const pieces = (await import(pathToFileURL(join(web, "art", `${game}.mjs`)).href)).default;
const out = join(web, "public/art", game);
mkdirSync(out, { recursive: true });
const file = (id) => join(out, `${id}.webp`);
const dataUri = (id) => `data:image/webp;base64,${readFileSync(file(id)).toString("base64")}`;

function prompt(p) {
  const refs = p.refs?.length
    ? "Match the printing of the reference images exactly (the same inks, halftone dots, paper grain and line weight), but draw a new subject. "
    : "";
  return `${refs}${p.subject} ${STYLE} ${anchor(p.inks)} ${FRAME[p.frame]}`;
}

async function make(p) {
  const input = {
    prompt: prompt(p),
    aspect_ratio: p.ratio,
    resolution: `${p.mp ?? 1} MP`,
    seed: p.seed,
    output_format: "webp",
    output_quality: 90,
    safety_tolerance: 2,
    ...(p.refs?.length ? { input_images: p.refs.map(dataUri) } : {}),
  };
  for (;;) {
    const res = await fetch("https://api.replicate.com/v1/models/black-forest-labs/flux-2-pro/predictions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "wait=60" },
      body: JSON.stringify({ input }),
    });
    let r = await res.json();
    if (res.status === 429) {
      // new accounts are rate-limited: wait as long as Replicate says
      await new Promise((ok) => setTimeout(ok, ((r.retry_after ?? 10) + 1) * 1000));
      continue;
    }
    while (r.status && !["succeeded", "failed", "canceled"].includes(r.status)) {
      await new Promise((ok) => setTimeout(ok, 2000));
      r = await (await fetch(r.urls.get, { headers: { Authorization: `Bearer ${token}` } })).json();
    }
    if (r.status !== "succeeded") throw new Error(`${r.status ?? res.status} ${r.error ?? r.detail ?? ""}`);
    const url = Array.isArray(r.output) ? r.output[0] : r.output;
    const img = Buffer.from(await (await fetch(url)).arrayBuffer());
    writeFileSync(file(p.id), img);
    return `${Math.round(img.length / 1024)} KB`;
  }
}

for (const p of pieces) {
  if (p.kept || (only ? p.id !== only : existsSync(file(p.id)))) continue;
  process.stdout.write(`${game}/${p.id} … `);
  try {
    console.log(await make(p));
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}
