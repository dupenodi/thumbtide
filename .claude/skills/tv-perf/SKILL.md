---
name: tv-perf
description: Measure and test Thumbtide game performance against the LG webOS TV (target 60 fps) — the local sandbox (`pnpm perf`), runs on the real TV (`pnpm perf --tv`), one-pass TV captures (`pnpm perf capture`), the hardware probe and calibration. Use when asked about frame rate, TV performance, "does it hold 60fps", slow games on the TV, TV hardware specs, or before/after a performance change.
---

# TV performance tools (tools/perf)

`tools/perf` is a private workspace package (`@thumbtide/perf`). It is **never** part of the TV app:
`web` must not import from it, and the in-page frame monitor (`web/src/shell/perf.ts`) only exists in builds
with `VITE_PERF=1`. A Vite plugin (`web/vite.config.ts`, `noPerfCode`) fails any other build that contains
perf markers. Keep it that way: new test-only code in `web/src` goes behind `PERF_BUILD`.

## Which command

| Need | Command | Time |
|---|---|---|
| Quick before/after check of a change | `pnpm perf [scenario…]` | ~20 s per scenario |
| Proof on the real hardware | `pnpm perf --tv [scenario…]` | ~30 s per scenario + build/install |
| Everything from the TV for offline analysis | `pnpm perf capture [scenario…]` | ~6 min for all |
| TV hardware + benchmark profile | `pnpm perf probe --tv` | ~1 min |
| This computer vs the TV, benchmark by benchmark | `pnpm perf probe --emulate` | ~1 min |
| Re-fit the sandbox's graphics factor | `pnpm perf calibrate` | ~8 min |

Scenarios: `lobby`, `wetpaint`, `cascade-culture`, `cascade-marbles`, `cascade-reactor`, `cult`, `hammer-melka`,
`hammer-classic` (Rotor Brawl, 7 bots). A game id runs all
its scenarios (`cascade`). Options: `--seconds=12 --warmup=4 --target=60 --verbose --json --headed --native
--cpu=N --gpu=N --fps=30`. Any other `--key=value` goes to the game as a start option (`--look=reactor`,
`--board=huge`, `--bots=7`, `--quality=low`). Exit code 1 means a scenario is below target.

## Profiling (why a frame is slow)

| Need | Command |
|---|---|
| Our calls per frame: canvas calls by method, game sections (ms), page changes, long tasks | `pnpm tv --perf=hammer --profile …` (reports print and go to `web/dist-tv/profile-*.jsonl`) |
| The browser's own work on the TV (style, layout, paint, raster, compositing, GPU) and the composited layers | start a `--perf` run, then `node tools/perf/tv-trace.mjs --seconds=8 --label=<arm>` |

- The call profiler (`web/src/shell/profiler.ts`) has its own build switch, `VITE_PROFILE=1`, set only by
  `--profile`. `vite.config.ts` fails any build without the switch that contains its marker (`__thumbtideProfile`),
  like the perf markers. Games mark sections with `profBegin(name)` / `profEnd(name)` (no-ops in other builds).
- `tv-trace.mjs` writes `tools/perf/captures/trace-*/`: `trace.json` (load it in Chrome DevTools → Performance),
  `layers.json` and `summary.md`. `--cdp=http://localhost:9222` traces a local Chrome instead (to test the tool).
  The element names in the layer list are approximate (layers change while it reads them). It takes the TV lock.
  It uses DevTools on the TV app (ares-inspect), which docs/lg-tv.md warns about (the TV froze once): keep traces
  short (≤ 10 s) and one at a time.
- The relay's play-test recorder (`THUMBTIDE_RECORD=<file>`) keeps button changes and the stick at most every
  100 ms per phone: about 40 MB per hour for 8 phones (a phone sends ~30 stick messages a second; unsampled
  that was ~15 MB per hour per phone).
- Every DOM element above the game canvas that the browser can't merge becomes a composited layer, and the TV
  composites each one at 4K every frame: count the layers before you blame a HUD's JavaScript.

## Reading results

- **fps** over the measured window, **95% under** (p95 frame time), **slowest**, **stutters** (% of frames over
  25 ms), **resolution** (lowest auto-resolution scale the game fell to), **heap**.
- PASS = fps ≥ target − 2 and ≤ 2% stutters. CLOSE = ≥ 85% of target.
- Captures go to `tools/perf/captures/<time>/` (git-ignored): `summary.md` first, then `capture.json` (every
  report with timestamps, TV state per scenario for loading and measured phases) and `samples.log` (raw TV
  samples). `tools/perf/baselines/` keeps committed summaries to compare against.
- Scenario marked INTERRUPTED: another app took the screen or the reports stopped. Run it again.

## Accuracy: what to trust

- **Only `--tv` and `capture` prove 60 fps.** The sandbox shows HIGHER fps than the TV. It slows the CPU (≈6×,
  Chrome throttling) and WebGL draws (repeats each draw into a hidden buffer), but it does NOT reproduce memory
  pressure/swap, the TV's 4K compositing, full-screen repaint cost, or PowerVR's tile-based behaviour. Cult (HTML,
  big images) is the worst case: sandbox ~55 fps vs TV 9–23.
- Use the sandbox for relative comparisons (before vs after on the same machine), not absolute verdicts.
- `gpuBias` in `profiles/lg-43sq700s.json` (3.36) came from a rough fit; treat the graphics factor as approximate.
- The host measurement is cached in `tools/perf/.cache` per Chrome version; `pnpm perf probe` refreshes it.

## What the TV is (LG 43SQ700S-WB, measured 2026-11)

2× Cortex-A55 + 2× Cortex-A75 ~1 GHz · PowerVR Rogue BXE-4-32 · 1.5 GB RAM (1255 MB for Linux, 100–180 MB free,
swap always in use; YouTube/Netflix/Amazon stay preloaded) · webOS SDK 7.0, Chrome 87 · page 1920×1080 at
devicePixelRatio 2 → composited at 4K. Per full-screen 4K layer: ~5 ms GPU and ~33 MB; 8 layers → 26 s/frame.
Full-screen repaint ~1 s/frame. Heavy shader maths ~320× slower than an RTX 3050.
Baseline with the 30 fps cap lifted: lobby 59, Wet Paint ~9 (35% res), Cascade 30–46 (min res), Cult 9–23 with
multi-second stalls. See `tools/perf/baselines/`.

## Gotchas

- **The TV is shared.** Other sessions use the same TV and interrupt runs. Prefer ONE `pnpm perf capture` over
  many small TV commands, then analyse offline. `capture` writes a lock (`/tmp/thumbtide-perf.lock` on the TV,
  15 min) and refuses to start if another run holds it; `--force` overrides — only if you know it is stale.
- **TV reachability.** It drops off Wi-Fi when it sleeps; check `ping` / port 9922 first. Developer Mode
  expires after ~50 h (extend in the Developer Mode app). Device setup: see docs/lg-tv.md.
- **30 fps cap.** On webOS, Wet Paint and Cascade cap themselves at 30 fps. Every perf command passes `fps=60`
  (the target) unless you give `--fps=30`. Lifting the cap needs a `VITE_PERF=1` build.
- **Slow start on the TV.** Wet Paint can take 25+ s from launch to steady frames (shader compiles ~60 ms each,
  uploads, swap). Measurement starts only after frames flow and the game leaves its intro; the limit is 90 s.
- **Windows.** The global `pnpm` shim on this machine is broken: use `npx -y pnpm@12.11.2 …`. ares keeps its
  device list in `%APPDATA%\.webos`. `node_modules/.bin` tools are `.cmd` (helpers in
  `web/scripts/lib/webos.mjs` handle shell + quoting). Many files are CRLF: scripted edits must keep line endings.
- **Headless Chrome follows the host display** (120 Hz here); `refresh.js` holds frames to the TV's 60 Hz.
- **Not available on the TV:** screenshots/recording (capture service denied in developer mode), `luna-send`
  for most services. `ares-launch --running` lists user apps only, not the preloaded native ones (use `ps`).
- **Ports:** relay 8797, site 8798, reports 8799 (the TV POSTs to this computer — the firewall must allow Node).
  `pnpm dev` (8787/5173) is not disturbed.
- **`performance.memory` on the TV** reports a constant ~10 MB; use the capture's TV memory samples instead.

## Changing the tools

- New scenario: add it to `SCENARIOS` in `tools/perf/cli.mjs`.
- New game: call `frameDrawn(now)` for each drawn frame if it caps frames, honour `fpsOverride()`, and add
  numbers with `setPerfExtras` (all from `web/src/shell/perf.ts`; they are no-ops in ship builds).
- New TV: `pnpm perf probe --tv` writes `tools/perf/profiles/lg-<model>.json`; pick it with `--profile=`.
