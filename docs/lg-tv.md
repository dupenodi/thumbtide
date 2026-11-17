# The LG TV app

Thumbtide's TV page can be installed on an LG TV as an app, so the TV runs the game itself instead of a laptop
plugged into it. This page collects what we know about it: the TV we test on, setup, how the app is built, what
changes on a TV, performance, and what to do when something goes wrong.

The code is in `web/scripts/tv.mjs` (build, install, launch), `web/tv/webos/` (manifest and icons) and
`web/src/shell/tv.ts` (remote keys, launch options, screen saver).

## The TV we test on

| | |
|---|---|
| Model | LG 43SQ700S-WB: 43 inch, 2022, entry-level |
| webOS | webOS TV 22 (SDK 7.0.0) |
| Firmware | 03.07.00 |
| Board | K8LP_DVB_AJ |
| Browser engine | Chromium 87 (`Chrome/87.0.4280.88`) |
| Name in the ares tools | `lgtv` |

Its graphics chip is weak, about as fast as a cheap phone's, and it also draws the TV's own menus. A game that
overloads it can make the whole TV stop responding, Home and Power included (see [Freezes](#freezes-and-other-problems)).
A game that runs smoothly on a laptop can still be far too heavy for the TV.

## Which TVs work

The app is built for **webOS TV 6 (2021) and newer**. `pnpm tv` warns when a TV is older than that. Each webOS
version ships a fixed Chromium, and that decides which web features you can use:

| webOS TV | Year | Chromium | What it adds that matters here |
|---|---|---|---|
| 6 | 2021 | 79 | The oldest we build for (`target: "chrome79"` in `web/vite.config.ts`). No `Element.replaceChildren` (`shell/tv.ts` fills it in) |
| 22 | 2022 | 87 | **Our TV.** Still no CSS `aspect-ratio`, `:has()` or `color-mix()` |
| 23 | 2023 | 94 | CSS `aspect-ratio` |
| 24 | 2024 | 108 | CSS `:has()` |
| 25 | 2025 | 120 | CSS `color-mix()` |

What this means when you write code:

- **CSS:** avoid `aspect-ratio`, `:has()` and `color-mix()`, or give a fallback that works without them. The first
  install showed the lobby's game covers squashed into a thin bar because of `aspect-ratio`. The CSS files that
  already carry fallbacks are `lobby.css`, `kit.css`, `wetpaint.css`, `cult.css` and `cascade.css`.
- **JavaScript:** Vite rewrites new *syntax* (`?.`, `??` and so on) for Chromium 79, but it doesn't add missing
  *functions*. Check newer ones before using them: `Array.prototype.at` and `Object.hasOwn` need Chromium 92–93,
  `structuredClone` needs 98, `findLast` and `toSorted` need 97–110. None of these are used today.
- **WebGL 2** works on our TV, and three.js needs it.
- Test layout changes on the TV, or at least in an old Chromium. A modern desktop browser won't show these problems.

## First-time setup

1. **On the TV:** install the *Developer Mode* app from the LG Content Store. Sign in with an LG developer account
   (free at [webostv.developer.lge.com](https://webostv.developer.lge.com)). Turn on *Dev Mode Status*; the TV
   restarts. Open the app again and turn on *Key Server*. The app shows the TV's IP address and a passphrase.
2. **On the computer**, from the repo root (pick any name for the TV; ours is `lgtv`):
   ```sh
   pnpm --filter @thumbtide/web exec ares-setup-device -a lgtv -i "host=<TV IP>" -i "port=9922" -i "username=prisoner"
   pnpm --filter @thumbtide/web exec ares-novacom -d lgtv --getkey    # type the passphrase the TV shows
   ```
   The `ares-*` tools come from `@webos-tools/cli`, a dev dependency of `web`, so `pnpm install` has already
   installed them. Their device list is stored in `~/.webos/tv/novacom-devices.json`.
3. **Run it:** `pnpm dev` in one terminal, then `pnpm tv` in another.

Tip: give the TV a fixed address in your router's settings (a "DHCP reservation"). Ours changed address once.
When it does, update it with
`pnpm --filter @thumbtide/web exec ares-setup-device -m lgtv -i "host=<new IP>"`.

Developer Mode switches itself off after about 50 hours. Open the Developer Mode app and extend it before then.

## Commands

From the repo root:

| Command | What it does |
|---|---|
| `pnpm tv` | Build, install and open the app |
| `pnpm tv --build` | Only build the package (`web/dist-tv/com.thumbtide.tv_<version>_all.ipk`) |
| `pnpm tv --perf=cascade` | Open straight into a game with 3 computer players and print the frame rate every 2 seconds. Add settings: `--look=marbles --bots=4 --board=xl --timer=0` |
| `TV_DEVICE=lgtv pnpm tv` | Pick a TV when several are set up (the default is the first real TV in the list) |
| `pnpm tv --inspect` | Chrome DevTools for the app on the TV. Avoid it: see [Freezes](#freezes-and-other-problems) |

The `ares` tools directly (run from `web/`, as `npx ares-…` or `./node_modules/.bin/ares-…`):

| Command | What it does |
|---|---|
| `ares-setup-device -l` | List the TVs set up on this computer |
| `ares-device -i -d lgtv` | Model, webOS SDK version and firmware. Also a quick "can I reach the TV?" check |
| `ares-launch -d lgtv com.thumbtide.tv` | Open the app |
| `ares-launch -d lgtv --close com.thumbtide.tv` | Close it (the first thing to try when it's stuck) |
| `ares-launch -d lgtv -r` | List the apps that are running |
| `ares-launch -d lgtv com.thumbtide.tv -p '{"game":"cascade","bots":"3","look":"reactor"}'` | Open with launch options (see below) |
| `ares-install -d lgtv -l` | List installed apps |
| `ares-install -d lgtv -r com.thumbtide.tv` | Uninstall |

## How the app is built

`pnpm tv` runs `web/scripts/tv.mjs`, which:

1. Runs `vite build --mode tv` into `web/dist-tv/app`. This build has only the TV page (no phone page), uses
   relative paths, targets Chromium 79, and puts all the code in **one plain script** with every game included.
   Apps open from a `file://` address, and webOS can refuse JavaScript modules and cross-origin requests from
   there, so `tv.mjs` swaps the module script tag for `<script defer>` and stops if one is left.
2. **Sets the relay and phone addresses at build time.** By default they're this computer's LAN address:
   `ws://<computer IP>:8787` for the relay and `http://<computer IP>:5173/join/` for the QR code. So **rebuild
   (`pnpm tv`) whenever your computer's IP changes**, for example on another Wi-Fi network, or phones won't be able
   to join. For a deployed setup, set `VITE_RELAY_URL` and `VITE_JOIN_URL` before `pnpm tv`.
3. Copies the icons, writes `appinfo.json` with the version from `web/package.json`, and packages it all with
   `ares-package`.
4. Checks that the TV answers (`ares-device -i`), prints its model and webOS version, installs with `ares-install`
   and opens it with `ares-launch`. It warns if `pnpm dev` isn't running on this computer.

What's in `web/tv/webos/appinfo.json`:

- `id`: `com.thumbtide.tv`
- `resolution`: `1920x1080`, so the page is laid out at 1080p
- `disableBackHistoryAPI: true` lets the app handle the remote's Back button itself, instead of webOS closing the app

Other things about the packaged app:

- **Images** in `web/public/` are copied into the app and load from there.
- **Sound files:** Cascade's are built into the script as data. Rotor Brawl's `.ogg` files are copied into the app's
  `assets/` folder and loaded with XHR (`audio.ts`), because `fetch()` refuses `file://`; an XHR from `file://`
  answers with status 0, which counts as success.
- **Fonts** come from Google Fonts, so the TV needs internet access. Without it, text falls back to the TV's own fonts.
  Rotor Brawl's Russo One is bundled in the app (`hammer/fonts/`, loaded by `font.ts`).

## What changes when the page runs on a TV

`web/src/shell/tv.ts` detects webOS (`isWebOS`: the `PalmSystem` object or "webOS" in the user agent) and handles:

- **The remote.** Arrows and OK move around the lobby. Back is key code 461. In the lobby it closes the app; in a
  game it opens the pause menu (Resume, Restart round, Back to lobby).
- **The screen saver.** Nobody touches the remote during a game, so the app subscribes to the TV's screen saver
  request (`luna://com.webos.service.tvpower/power/registerScreenSaverRequest`) and answers "not now" each time.
- **Launch options.** `startParam(name)` reads `?name=` from the address in a browser, or the app's launch options
  on a TV. `game` opens a game directly, `bots` sets computer players, and any game setting works with a value from
  its option list (`look=reactor`, `board=xl`, `timer=0`). Also:
  - `res=0.55` sets Cascade's starting resolution
  - `perf=<url>` sends frame-rate reports to that address, only in builds with `VITE_PERF=1` (`pnpm tv --perf` and
    `pnpm perf --tv` set this up). Wet Paint, Cascade and Rotor Brawl report; Cult and the lobby don't yet
  - `fps=60` lifts the 30fps cap of Wet Paint and Cascade, to test at the target
  - `lite=1` turns on Rotor Brawl's TV mode in a desktop browser
- **Sound.** The app tries to start sound straight away. Any press on the remote switches it on too.

Each game also has a **lighter mode** on webOS:

- **Wet Paint:** low quality (fewer strokes, lower resolution) and a 30fps cap. It lowers its resolution further if
  frames run slow.
- **Cascade** (`look/stage.ts`, the `lite` flag in each look):
  - 30fps cap, no antialiasing, and fewer polygons on the pieces
  - renders at 75% resolution, while the HUD text stays sharp
  - if frames run long for over a second, it drops resolution in 10% steps, down to 45%
  - after 8 seconds of fast frames it tries 5% higher, and stays below any step that didn't hold
  - it ignores the first 2 seconds after a board appears, while shaders compile and textures upload
- **Rotor Brawl** (`lite` in `hammer/host.ts`): 15 physics joint passes instead of 30, fewer particles, simpler synth
  sounds (no hi-hats, one partial per metal ring), and the `hm-lite` class, which drops CSS filters, gradient text and endless animations. In
  Co-op vs monsters, waves stop growing once the arena holds 48 bodies.

To preview the lighter mode of Wet Paint and Cascade on a laptop, open the TV page with `?quality=low`.
`?quality=high` turns it off in a TV's web browser. Both work only in the page address, not as launch options, so the
app always uses the lighter mode. Rotor Brawl uses `?lite=1` instead.

## Performance on our TV

Measure with `pnpm perf --tv` or `pnpm perf capture` (see [Performance](../README.md#performance) and
`.claude/skills/tv-perf/SKILL.md`). The first full capture is in
`tools/perf/baselines/2026-11-13-lg-43sq700s.md`. With the 30fps caps lifted, no game held 60 fps then: the lobby
ran at 29, Cascade at 30–46, and Wet Paint and Cult at about 9.

- The main costs are **memory pressure** (the TV has about 100–180 MB free and swaps all the time), **4K
  compositing** (the page is drawn at devicePixelRatio 2, about 5 ms per full-screen layer) and full-screen repaints.
  Fewer layers and smaller repaints help more than faster JavaScript.
- Rotor Brawl is the exception: its physics runs on the CPU, so the number of bodies sets the frame rate. Chains drawn
  as one path brought heavy chain sets to 53–58 fps. On 2026-11-17 (perf build, auto resolution at 33%) all ten
  arenas averaged 55–58 fps with 3 computer players; with 7, the average was 50–55 and the slowest windows 28–31 fps.
  The profiler showed physics 3–7 ms, drawing 8–15 ms and about 280 `lineTo` calls per frame in the slow windows.
- Cascade's bigger boards (14 × 8 up to 20 × 12) haven't been tried on the TV.
- What made Cascade faster:
  - static detail (agar, walnut grain, table) baked once into textures (`look/bake.ts`) instead of computed every frame
  - Culture's colonies drawn as one instanced mesh instead of one per cell, and only the used part of instance buffers uploaded
  - every shader compiled when the board is set up, so the first chain reaction doesn't stutter
  - the 30fps cap and the automatic resolution

## Freezes and other problems

**The whole TV froze (2026-11-11).** On the very first install, the TV stopped responding right after Wet Paint
started: no Back, Home or Power, and the ares tools couldn't connect, although it still answered pings.
**Fix: unplug the TV from the wall for 30 seconds.** The likely cause was Wet Paint's full-quality 3D, too heavy for
the chip, while a DevTools session (`--inspect`) was attached. Since then the games use their lighter TV modes,
and we keep DevTools off the TV.

**The app got stuck once (2026-11-13).** Closing and reopening it fixed it
(`ares-launch -d lgtv --close com.thumbtide.tv`, then open it again). The cause is unknown. If it happens again,
note what was on screen and what you'd just done.

**The ares tools can't reach the TV.** Check that:

- the TV is on and on the same network as the computer
- the Developer Mode app shows *Dev Mode Status: ON*, and the session hasn't run out (extend it there)
- the TV's IP hasn't changed (the Developer Mode app shows it; update it with `ares-setup-device -m`)

**Don't flood the TV's SSH port (9922) with repeated connection checks**, for example a loop of `nc` probes.
Half-open connections pile up and the ares tools stop working. `ares-device -i` once is enough.

**Phones can't join, but the TV shows a QR code.** Check that `pnpm dev` is running on the computer and that the
computer's IP hasn't changed since the last `pnpm tv`. If it has, run `pnpm tv` again: the address is fixed at
build time.

**No sound.** Press any button on the remote.

**Something looks broken only on the TV.** It's almost always a newer CSS feature (see [Which TVs work](#which-tvs-work)).

## Not done yet

- **Running without the computer.** The app still needs `pnpm dev` on a computer for the relay and the phone page.
  The plan: put the relay on Cloudflare Workers with Durable Objects (`server/src/rooms.ts` is written to move
  there) and the site on Cloudflare Pages, then build the app with `VITE_RELAY_URL` and `VITE_JOIN_URL`.
- Frame-rate reports for Cult and the lobby, and measurements for the big Cascade boards.
- 60 fps on our TV: no game holds it yet (see [Performance on our TV](#performance-on-our-tv)).
- Other TV platforms (Samsung Tizen, Android/Google TV) haven't been tried as apps. The TV page itself runs in any
  TV browser that can reach `pnpm dev`.
