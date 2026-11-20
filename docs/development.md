# Development notes

Performance testing, art generation and deploying. For setup and everyday commands, see the [README](../README.md).

## Performance

The aim is a steady 60 fps on an entry-level LG TV. `tools/perf` holds the tools; they are never part of the TV app
(the in-page frame monitor exists only in builds with `VITE_PERF=1`, and other builds fail if it leaks in).

```sh
pnpm perf                  # every game in a sandbox: Chrome here, slowed down to the TV's measured speed
pnpm perf cascade --look=reactor
pnpm perf --tv             # the same scenarios on the real TV (needs the TV set up: see [lg-tv.md](lg-tv.md))
pnpm perf capture          # everything from the TV in one pass, into tools/perf/captures/<time>/
pnpm perf probe --tv       # measure a TV's hardware and save its profile
```

The sandbox is for quick before/after comparisons: it shows higher frame rates than the TV, because it can't
reproduce the TV's memory pressure, 4K compositing or graphics chip. Only `--tv` and `capture` prove 60 fps.
`.claude/skills/tv-perf/SKILL.md` has the details, the TV's measured hardware and the gotchas.

## Art

Cult's art (and the house style for future games) is a two-colour screen-printed gig poster, generated with
Replicate's FLUX.2 Pro model:

- `web/art/brand.mjs` is the shared style; `web/art/<game>.mjs` lists a game's pieces.
- `pnpm --filter @thumbtide/web art <game>` creates any missing images in `web/public/art/<game>/`; add a piece name
  to remake one. It costs a few cents an image.
- It needs a Replicate API token in a `.env.local` file at the repo root: `REPLICATE_API_TOKEN=r8_…`. That file is in
  `.gitignore`. Never commit it.
- `web/art/explore/` keeps the first style exploration.

## Deploy

Nothing is deployed yet. When it is:

- **Site:** any static host (Vercel, Netlify, Cloudflare Pages). Root directory `web`, build command `pnpm build`,
  output `dist`. Set `VITE_RELAY_URL=wss://<your relay host>` at build time.
- **Relay:** a host that keeps WebSocket connections open (Fly.io, Railway, Render; not serverless functions):
  `pnpm --filter @thumbtide/server start`, with `PORT` and, optionally, `ALLOWED_ORIGINS=https://<your site>`.
  The room logic (`server/src/rooms.ts`) doesn't depend on the socket library, so it can move to Cloudflare Durable
  Objects later.
- For the TV app against a deployed setup, set `VITE_RELAY_URL` and `VITE_JOIN_URL` (`https://<your site>/join/`)
  before `pnpm tv` or `pnpm tv:android`. The TV apps connect from a `file://` page, so `ALLOWED_ORIGINS` must allow that too.
