# Thumbtide

Party games on a big screen, played with phones as controllers. The TV (or any computer screen) shows the game
and a QR code. Everyone scans it with their phone, and their phone becomes the controller. No app to install.

Games so far:

| Game | Players | What it is |
|---|---|---|
| **Wet Paint** | 1–8 | Tiny brushes race to cover an oil-paint canvas in their colour |
| **Cult** | 5–8 (computers fill empty seats) | Hidden roles: the town votes in leaders while a secret cult tries to take over |
| **Cascade** | 1–8 | Turn-based chain reactions on a grid, in three looks: Culture, Marbles, Reactor |
| **Rotor Brawl** | 1–4 (computer players optional) | Flying machines swing heavy weapons on rods and chains. Last one flying wins |
| **Sandbox** | any | A connection test: steer a dot, tap to pulse |

This guide gets the project running on your computer, then shows how to build a game of your own. Two more docs:

- [docs/lg-tv.md](docs/lg-tv.md): the LG TV app. The TV we test on, setup, how the app is built, performance, and fixes for freezes.
- [docs/notes.md](docs/notes.md): design rules, known issues and planned games. Read it before you design a game.

---

## 1. Set up

### What you need

- **A Mac, Windows or Linux computer.** It runs the games and plays the part of the TV.
- **Node.js 22 or newer.** Check with `node -v`. Install it from [nodejs.org](https://nodejs.org) or, on a Mac, with `brew install node`.
- **pnpm 10 or newer**, the package manager this repo uses: `npm install -g pnpm`.
- **Git**, and access to this repo. It's private, so ask the owner to add you under *Settings → Collaborators*.
- **A phone on the same Wi-Fi as the computer.** It's optional: a second browser window can stand in for a phone.

### Install and run

```sh
git clone https://github.com/dupenodi/thumbtide.git   # or: gh repo clone dupenodi/thumbtide
cd thumbtide
pnpm install
pnpm dev
```

`pnpm dev` starts two things and keeps running until you press Ctrl+C:

- the **site** on port 5173: the TV page, the phone page and all the games
- the **relay** on port 8787: a small server that passes messages between the TV and the phones

### Play

1. On the computer, open **http://localhost:5173**. This is the "TV": it shows a room code and a QR code.
2. Scan the QR code with your phone's camera, type a name and tap Join.
3. The first person to join is the **host**. Their phone shows the game library: pick a game, change its settings
   and tap Play. Everyone else's phone turns into that game's controller.
4. In a game, the host's phone has a **Host** button (pause, restart, settings, back to the lobby). On the computer,
   **Esc** opens a pause menu.

No phone? Open **http://localhost:5173/join/** in a second browser window, turn on your browser's phone view (in Chrome:
DevTools → the phone-and-tablet icon) and enter the room code from the TV page. You can open several of these for
several players.

Sound on the TV page starts after your first click or key press there. Browsers block sound until you do.

### If a phone can't connect

- **Same network.** The phone must be on the same Wi-Fi as the computer, not mobile data and not a guest network
  (guest networks often stop devices from seeing each other).
- **Firewall.** The first time, macOS may ask whether Node can accept incoming connections: click Allow. If you
  missed it, open *System Settings → Network → Firewall* and allow Node, or turn the firewall off while testing.
  On Windows, allow Node through Windows Defender Firewall on private networks.
- **VPN.** The QR code points at your computer's local network address (for example `http://192.168.1.20:5173/join/`).
  A VPN can make it pick the wrong one. Turn the VPN off and restart `pnpm dev`.
- **Ports in use.** If something else is on 5173 or 8787, `pnpm dev` will complain. Close it and try again.
- **"Can't reach the room"** after restarting `pnpm dev`: rooms live in the relay's memory, so a restart ends them.
  Reload the TV page to get a new room.

A few phone features need HTTPS, which the local setup doesn't have, such as tilt sensors and the screen wake lock.
Vibration works on Android. Everything else works the same as on a deployed site.

### Commands

Run these from the repo root.

| Command | What it does |
|---|---|
| `npm start` (or `node scripts/start.mjs`) | Starts everything in one terminal (relay + site, on the network) and prints the TV and phone addresses. `--relay=8788 --web=5174` picks other ports. To test on a laptop alone, open the TV page in one tab and the phone page in other tabs: each tab is its own player |
| `pnpm dev` | Site + relay with live reload. Save a file and the TV page and phones update |
| `pnpm test` | Relay tests, SDK tests and each game's rule tests |
| `pnpm typecheck` | TypeScript check across the whole repo |
| `pnpm build` | Production build of the site into `web/dist` |
| `pnpm tv` | Builds the TV page as an LG TV app and installs it (see [LG TV app](#lg-tv-app-optional)) |
| `pnpm perf` | Frame-rate tests against the LG TV, in a sandbox or on the TV (see [Performance](#performance)) |
| `pnpm --filter @thumbtide/web art <game>` | Generates poster art with Replicate (see [Art](#art)) |

### Shortcuts for testing on the TV page

Add these to the TV page's address to skip steps:

- `/?game=cascade` opens a game straight away, without the lobby
- `&bots=3` adds computer players (Wet Paint, Cascade). `/?game=cult` with nobody joined plays itself with five computers
- any setting of the game works the same way, for example `&look=reactor`, `&timer=0` or `&round=20` (Wet Paint seconds)
- `&quality=low` for weak hardware (Wet Paint)
- `/lab/cascade/?look=marbles` is a workbench for Cascade's looks, played with the mouse (only while `pnpm dev` runs)

The TV page remembers its room for the browser tab. Open a new tab or private window for a fresh lobby.

---

## 2. How it works

```
 phone ──┐                          ┌── TV page (the "host")
 phone ──┼── WebSocket ── relay ────┤   runs all game logic
 phone ──┘                          └── draws the game
```

- The **relay** (`server/`) is deliberately simple. It creates rooms with 4-letter codes, passes messages along and
  tracks who's connected. It knows nothing about games.
- The **TV page** owns the game. It reads players' input, runs the rules and draws everything.
- **Phones** are controllers. They show what the TV tells them to and send input back.

### Where things are

```
packages/protocol    The messages the relay, TV and phones exchange (types, limits, close codes)
packages/sdk         Browser library: Host (TV side), Controller (phone side), touch buttons, haptics, QR codes
server               The relay (Node + ws)
web                  The site
  index.html           the TV page
  join/                the phone page
  src/shell/           what every game gets for free: lobby frame, host menu, pause menu, settings, sound, TV app support
  src/games/           one folder per game, plus:
    registry.ts          the list of games, their settings and controllers
    types.ts             what a game must export
    kit/                 shared parts for games: the .pad language, the phone gamepad, lettering, icons
  public/              images served as-is (covers, art, icons)
  art/                 prompts for generated art
  scripts/             tv.mjs (LG TV app), art.mjs (art generation)
  tv/webos/            the LG TV app's manifest and icons
```

### Sending messages between the TV and phones

The SDK gives every game four ways to talk:

| Call | Direction | Use it for | Delivery |
|---|---|---|---|
| `ctl.send()` → `host.on("message")` | phone → TV | button presses, votes, picks | reliable, in order |
| `ctl.input()` → `player.input` | phone → TV | sticks, tilt: anything continuous | latest value wins, about 40 times a second |
| `host.send()` / `host.broadcast()` | TV → phone | one-off events: buzz, "you got hit" | reliable, in order |
| `host.setShared()` / `host.setOwn()` | TV → phone | what a phone should show right now | **sticky**: a phone that reconnects gets it again |

`setShared` goes to every phone. `setOwn` goes to one player, for things only they should see (their colour, a secret
role, their hand of cards).

### What the platform already handles

You don't need to build any of this into a game:

- **Dropped phones.** A phone that loses Wi-Fi or reloads keeps its place for 60 seconds and rejoins as the
  same player. A TV page reload keeps the same room and everyone stays in.
- **Phones on another app.** A phone that switches app or locks tells the TV it's *away* first. Its player is
  paused, not dropped: the seat waits up to 10 minutes and no computer takes it over.
- **The host menu.** Pause, resume, restart, end the game, change settings, lock the room and remove players, all
  from the host's phone. The TV never needs a keyboard. A game switches on pause and restart by returning those functions.
- **Phone-as-controller problems.** Fullscreen on Android (and an Add to Home Screen prompt on iPhone, which can't go
  fullscreen in the browser), the back gesture asks before leaving, the screen stays awake, controls let go when a
  notification pops up, no zooming or text selection, safe areas around notches, a left-handed switch, a connection
  dot, and haptics (Android, and iPhones on iOS 18 or newer).
- **A help sheet.** Each game's **?** button lists its controls, built from its `.pad` file.
- **TV remote support.** Arrow keys and OK in the lobby, Back for the pause menu.

### The phone controller: `.pad` files

Each game describes its phone controller in a `<game>.pad` file, a small language made for this project: which
controls the phone shows, how the stick and buttons feel, the vibration patterns and any numbers the game wants to
tune. Save the file and phones pick up the change straight away.

```
controller
  orientation  landscape     # landscape | portrait | any
  send-rate    40hz          # stick updates per second

stick move
  label        "Steer"       # shown faintly until the first touch
  travel       40px          # thumb travel from centre to rim
  full-at      80%           # full speed this far out
  deadzone     7%
  curve        0.85          # 1 = linear; lower = livelier with a small push
  directions   any           # any | 8 | 4 (4 for grid games)

button splat
  label        "SPLAT!"
  style        primary       # primary | secondary
  shape        rounded       # rounded | round (one big arcade button)
  haptic       22ms
  fires        press         # press | release | repeat 150ms

choices answer               # a list the game fills in when it needs a pick (answers, votes)
  layout       auto          # auto | list | grid | row

buzz                         # named vibration patterns: ms on, off, on…
  hit          60 40 120

tune                         # numbers the game reads (speeds, delays…)
  accel        20
```

Mistakes are reported with the file and line, for example `wetpaint.pad:14: stick "travel" must be 16–120px`.
Every setting and its limits are documented at the top of `web/src/games/kit/pad.ts`.

---

## 3. Build your own game

The quickest start is to copy **Sandbox**, the smallest game: one stick, one button, about 200 lines in all.

### Step 1: copy Sandbox

```sh
cp -r web/src/games/sandbox web/src/games/mygame
cd web/src/games/mygame
mv sandbox.pad mygame.pad
mv sandbox.css mygame.css
```

Then, inside the copied files, change `"sandbox"` to `"mygame"`, `SandboxGame` to `MyGame`, the `./sandbox.css`
import to `./mygame.css`, and the `sbx-` class names to a prefix of your own.

A game is these files:

| File | Runs on | What goes in it |
|---|---|---|
| `shared.ts` | both | The message types: what phones send, what the TV sends back |
| `mygame.pad` | phone | The controller: stick, buttons, choices, vibrations, tune numbers |
| `host.ts` | TV | The game: rules, drawing, sound |
| `controller.ts` | phone | The controller screen (usually just the gamepad built from the `.pad` file) |

Bigger games also keep their rules in a separate `rules.ts` with no drawing code, so they can be tested (see Step 6).

### Step 2: describe the messages (`shared.ts`)

```ts
export interface MyGame {
  toHost: { type: "jump" };                 // phone → TV, with ctl.send()
  input: { x: number; y: number };          // phone → TV, continuous, with ctl.input()
  toController: { type: "hit" };            // TV → phone, with host.send() / host.broadcast()
  shared: { phase: "play" | "end" } | null; // TV → every phone, with host.setShared()
  own: { color: string };                   // TV → one phone, with host.setOwn()
}
```

TypeScript then checks every message on both sides.

### Step 3: the controller (`mygame.pad` and `controller.ts`)

Describe the controls in `mygame.pad` (see the format above). `controller.ts` builds the gamepad from it and wires
up what happens:

```ts
import type { Controller } from "@thumbtide/sdk";
import { gamepad } from "../kit/gamepad.ts";
import { gameById } from "../registry.ts";
import type { ControllerMount } from "../types.ts";
import type { MyGame } from "./shared.ts";
import "./mygame.css";

const mount: ControllerMount = (ctx) => {
  const ctl = ctx.ctl as Controller<MyGame>;
  const pad = gamepad(ctx.root, gameById("mygame")!.controls!, {
    ctl,
    onStick: ({ x, y }) => ctl.input({ x, y }),
    onPress: (id) => id === "jump" && ctl.send({ type: "jump" }),
  });

  const offs = [
    // ctl.shared or ctl.own changed: update the phone, e.g. tint it in the player's colour
    ctl.on("state", () => pad.el.style.setProperty("--c", ctl.own?.color ?? "#7c5cff")),
    // a one-off event from the TV: play a vibration pattern from the .pad file
    ctl.on("message", (msg) => msg.type === "hit" && pad.buzz("hit")),
  ];

  return () => {
    pad.destroy();
    offs.forEach((off) => off());
  };
};

export default mount;
```

For a pick from a list (a quiz answer, a vote), add a `choices` block to the `.pad` file, call
`pad.showChoices("answer", ["Paris", "Rome", "Oslo"])` and handle `onChoose: (id, index) => …`.
A phone can also draw its own screen into `ctx.root` instead of using the gamepad. Cult does this for its role card.

### Step 4: the game itself (`host.ts`)

The TV side gets a `root` element to draw into (a canvas, a three.js scene or plain HTML) and the `host` object for
players and messages:

```ts
import type { Host } from "@thumbtide/sdk";
import { colorFor } from "../../config.ts";
import { isSys, type HostMount } from "../types.ts";
import type { MyGame } from "./shared.ts";

const mount: HostMount = (ctx) => {
  const host = ctx.host as Host<MyGame>;
  const canvas = document.createElement("canvas");
  ctx.root.appendChild(canvas);

  // Players already in the room are in host.players when the game starts; "join" fires for newcomers.
  const welcome = () => {
    for (const p of host.players.values()) host.setOwn(p.id, { color: colorFor(p.index) });
  };
  welcome();

  const offs = [
    host.on("join", welcome),
    host.on("leave", (p) => { /* remove their piece */ }),
    host.on("message", (p, msg) => {
      if (isSys(msg)) return; // platform messages (pause, settings…) are handled for you
      if (msg.type === "jump") { /* make p jump, and maybe host.send(p.id, { type: "hit" }) */ }
    }),
  ];

  let raf = requestAnimationFrame(function frame() {
    raf = requestAnimationFrame(frame);
    for (const p of host.players.values()) {
      const stick = p.input ?? { x: 0, y: 0 }; // the latest stick position
      // move p, then draw
    }
  });

  // Return a cleanup function, or { dispose, pause, resume, restart } to switch on those host-menu items.
  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((off) => off());
  };
};

export default mount;
```

Each player has `id`, `name`, `index` (their join order, used for colours), `connected`, `away` and `input`. Other events:
`drop` (their phone disconnected, they may come back), `rejoin`, and `away` (`p.away` changed: their phone is on
another app or locked; keep their seat, let their piece idle and don't hand it to a computer).
Settings are read with `ctx.settings()`. `ctx.onSettings(fn)` tells you when the host changes one mid-game.
`ctx.exit()` returns to the lobby.

### Step 5: add it to the library (`web/src/games/registry.ts`)

```ts
import mygamePad from "./mygame/mygame.pad?raw";

// add to the GAMES list:
{
  id: "mygame",
  title: "My Game",
  tagline: "One line for the library.",
  minPlayers: 1,
  maxPlayers: 8,
  colors: ["#ff5d73", "#3ec5ff"],        // a drawn cover in these colours…
  glyph: "action",                       // …with this icon. Or set `cover` to an image in web/public/covers/
  controls: parsePad(mygamePad, "mygame.pad"),
  settings: [
    {
      key: "rounds",
      label: "Rounds",
      options: [3, 5, 7].map((n) => ({ value: n, label: String(n) })),
      default: 5,
      // applies: "now",                 // apply mid-game rather than from the next round
      // when: { key: "mode", value: "custom" },  // only show while another setting has this value
    },
  ],
  host: () => import("./mygame/host.ts"),
  controller: () => import("./mygame/controller.ts"),
},
```

With `pnpm dev` running, open **http://localhost:5173/?game=mygame** and join from a phone, or pick it from the
library.

### Step 6: test it

- Put the rules in `rules.ts`, as plain TypeScript with no drawing, and test them in `rules.test.ts` next to it.
  `pnpm test` runs every `web/src/games/*/*.test.ts` with Node's built-in test runner. `cascade/rules.test.ts` is a
  short example.
- `pnpm typecheck` before you share your work.
- Try it on a real phone. A desktop browser doesn't show how a stick feels under a thumb.

### Tips from the games so far

- **Keep the phone a controller.** The TV does the showing. A phone shows controls, a label or two and secrets
  (a hidden role, a hand of cards).
- **Give each game its own look.** Each game has its own fonts, colours and art, and doesn't reuse another game's style.
- **Don't explain the rules on screen.** Controls are labelled, and the help sheet comes from the `.pad` file.
- **Computer players** (`bots.ts` in Wet Paint, Cult and Cascade) make it playable alone and fill seats when someone leaves.
- **TVs are slow.** If the game is for the LG TV app: it runs an old Chrome (79 to 87), so avoid CSS `color-mix()`,
  `:has()` and `aspect-ratio`. Check `isWebOS` from `shell/tv.ts` to switch on a lighter mode (30fps, lower
  resolution), as `cascade/look/stage.ts` and Wet Paint's low quality do. Details in [docs/lg-tv.md](docs/lg-tv.md).
- The full list of design rules is in [docs/notes.md](docs/notes.md).
- **Sound.** `shell/sound.ts` is the TV's shared sound engine. Cascade plays short recordings
  (`cascade/audio.ts`, files in `cascade/sounds/`) bundled into the code, so they also work in the TV app.

---

## 4. The games in this repo

### Wet Paint (`web/src/games/wetpaint/`)
Tiny brushes, one canvas: cover the most of it before time runs out. Steer with the stick; your brush lays thick
oil-paint strokes until it runs dry, then you refill at the paint pots. **SPLAT** lobs a glob that knocks over anyone
under it. **DASH** rams a rival and steals some of their paint. Power-up candies (Turbo, Mega Brush, Paint Bomb,
Shield, Paint Rain, Dry Spell) and surprise events (Power-up Shower, Turpentine, Final Frenzy) keep rounds changing.

Settings: round length, power-ups, events, computer brushes (0–4).

`sim.ts` holds the rules (unit-tested), `paint/` the three.js painter, `fx.ts` the candy and callouts, `hud.ts`,
`host.ts` and `controller.ts`. The brush marks, dab shader and canvas finish are adapted from
[Oil paint](https://patch.gg/blendi/oil-paint) by @blendi (MIT; see `paint/LICENSE-oilpaint.txt`).

### Cult (`web/src/games/cult/`)
A hidden-role game for 5–8. Most of the table is the town; a few are the cult, led by the Prophet. Each round the
Mayor nominates a Sheriff and everyone votes on their phone. An elected pair turns three law cards into one. The town
wins with five town laws or by burning the Prophet; the cult wins with six cult laws, or by getting the Prophet
elected Sheriff late in the game. Cult laws give the Mayor powers (investigate, peek, pick the next Mayor, burn).
The phone holds your secret: hold the card to see your role.

Settings: extra computer players (0–3). The pace is in `cult.pad`'s `tune` block.

`rules.ts` (unit-tested), `bots.ts`, `host.ts`, `view.ts`, `controller.ts`.

### Cascade (`web/src/games/cascade/`)
Take turns dropping pieces on a grid. A cell bursts when it holds as many pieces as it has neighbours, throws one into
each and takes them over, which can set off a chain across the board. Last colour standing wins. The phone's stick
walks a cursor across the TV's board, and the round **Place** button drops a piece there.

Three looks, switchable mid-game: **Culture** (a petri dish, the default), **Marbles** (walnut and glass) and
**Reactor** (neon cores).

Settings: look, board size (automatic, five sizes, or a custom size up to 20 × 12), turn timer, computer players (0–4).

`rules.ts` (unit-tested), `bots.ts`, `host.ts`, `hud.ts`, `audio.ts` + `sounds/`, and `look/` for the three.js scene:
`stage.ts` (renderer and TV lite mode), `director.ts` (times the chain animation), `bake.ts` (pre-baked textures) and
one file per look.

### Rotor Brawl (`web/src/games/hammer/`)
Up to eight little flying machines, each with a heavy weapon on a rod or chain. The phone is a joystick, held upright
or sideways: the machine flies where you push, so flying in circles whips the weapon round. Damage comes from how hard
a hit lands, big hits stun, and blades cut harder when they slide across fast. Last machine flying wins the round.

44 weapons in five classes: 8 hammers, 8 axes, 11 maces and flails, 15 swords and blades, and two dual sets with a
weapon on each side (twin blades, tribune). They come from Hammerfight's object files and from its item factory in the
exe; only the great maul and the wooden flail are ours (see `weapons.ts`). Heavier weapons hit harder but drag the
machine round.

With a weapon you can take a gun (arquebus, mortar, heavy mortar, rocket launcher; hold Fire on the phone) and a
shield: two plates on short rods, from light wood to armour. A fast, hard hit knocks a plate off; holding Shield
spreads the plates and halves thrust. The tribune's back blade is a gun of its own. Hold Fire and push the stick to aim
the arquebus (our addition: Hammerfight's guns don't aim): it swings toward the stick, fires once it points within
11°. A gun's body never hurts anyone, but it is heavy and fragile: a few hard blows break it off (our addition).
A shot that lands knocks the target back and is spent (a mortar's balls also stun); shots bounce only off walls and
crates; a gun kicks the shooter back along the barrel (not the launcher: its rockets push themselves; see `web/src/games/hammer/RE_GUNS.md`). Blades cut on the side Hammerfight draws as the edge; the back of a one-sided axe
only bludgeons. Weapons, guns and plates are drawn with Hammerfight's own sprites.

The stick tune lives in `hammer.pad` (`stick 420`, `steer 5.6`; 30% softer than before after a play test).

Arenas (setting **Arena**): Classic, Walls and crates, Big and Huge with a saw on each side wall (it cuts and stuns a
machine shoved into it), and six after Hammerfight's levels (see
`arenas.ts` and `RE_ARENAS.md`): **The Stands**, **Sunrise Towers**, **The Eye**, **Melka Arena** (cages swing on
ropes), **Block Hall** (loose blocks to knock around) and **The Pit** (a hanging chain). The middle of every arena is
open; plank walls toward the sides are slam surfaces (a reeling machine knocked into one gets more stun) and break
after a beating. Machines can't leave the screen at any edge.

Each round starts with a warm-up: fly and swing with no damage, and pick a weapon, a gun and a shield on the phone.

Modes: **Free for all**, **Teams** (Red P1, P3, P5, P7 against Blue P2, P4, P6, P8; computer players fill free seats) and **Co-op vs CPU**
(all players against 1–7 computer machines), and **Co-op vs monsters**: waves of flying worms (armoured ones from wave 3,
after Hammerfight's Polypod creatures; see `monsters.ts`); "rounds to win" is the number of waves to survive, and
computer players fight on your side. Settings: mode, rounds to win (2, 3 or 5), computer players (0–7), music, slow
motion on big hits, teammates collide, friendly fire. After 60 s of fight a round goes to sudden death: every hit counts.

The physics is a small engine of its own (`engine.ts`, `collide.ts`, `sim.ts`) that follows Hammerfight's model:
Verlet at 50 Hz, joints corrected by position only (which gives the weapons their whip), impulse controls, quadratic
drag and a speed limit. `HAMMERFIGHT_PHYSICS.md` records that model; `weapons.ts` has the weapon shapes and masses.
`/lab/hammer/?bots=3` is a workbench with mouse control, `[` `]` to change weapon, and live sliders (only while `pnpm dev`
runs). `sim.test.ts` covers the engine and the rules.

---

## 5. Optional extras

### LG TV app (optional)

The TV page can be installed on an LG TV (webOS 6 / 2021 or newer) as an app, so you don't need a laptop plugged
into the TV. **Everything about it is in [docs/lg-tv.md](docs/lg-tv.md)**: first-time setup, commands, the TV's
older browser, performance and troubleshooting.

```sh
pnpm tv                    # build it, install it on the TV and open it
pnpm tv --build            # only build the .ipk into web/dist-tv
pnpm tv --perf=cascade     # open straight into a game with computer players and print the TV's frame rate
                           # (add --fps=60 to lift the TV's 30fps cap)
```

- **It still needs your computer.** The app is only the TV page. The relay and the phone page come from your
  computer's `pnpm dev`, so keep that running on the same Wi-Fi. The computer's address is fixed when the app is
  built, so run `pnpm tv` again if it changes.
- Our test TV is an entry-level LG 43SQ700S (webOS 22, Chromium 87). If a game is smooth there, it'll be smooth on most LG TVs.

### Performance

The aim is a steady 60 fps on an entry-level LG TV. `tools/perf` holds the tools; they are never part of the TV app
(the in-page frame monitor exists only in builds with `VITE_PERF=1`, and other builds fail if it leaks in).

```sh
pnpm perf                  # every game in a sandbox: Chrome here, slowed down to the TV's measured speed
pnpm perf cascade --look=reactor
pnpm perf --tv             # the same scenarios on the real TV (needs the TV set up as above)
pnpm perf capture          # everything from the TV in one pass, into tools/perf/captures/<time>/
pnpm perf probe --tv       # measure a TV's hardware and save its profile
```

The sandbox is for quick before/after comparisons: it shows higher frame rates than the TV, because it can't
reproduce the TV's memory pressure, 4K compositing or graphics chip. Only `--tv` and `capture` prove 60 fps.
`.claude/skills/tv-perf/SKILL.md` has the details, the TV's measured hardware and the gotchas.

### Art

Cult's art (and the house style for future games) is a two-colour screen-printed gig poster, generated with
Replicate's FLUX.2 Pro model:

- `web/art/brand.mjs` is the shared style; `web/art/<game>.mjs` lists a game's pieces.
- `pnpm --filter @thumbtide/web art <game>` creates any missing images in `web/public/art/<game>/`; add a piece name
  to remake one. It costs a few cents an image.
- It needs a Replicate API token in a `.env.local` file at the repo root: `REPLICATE_API_TOKEN=r8_…`. That file is in
  `.gitignore`. Never commit it.
- `web/art/explore/` keeps the first style exploration.

### Deploy

Nothing is deployed yet. When it is:

- **Site:** any static host (Vercel, Netlify, Cloudflare Pages). Root directory `web`, build command `pnpm build`,
  output `dist`. Set `VITE_RELAY_URL=wss://<your relay host>` at build time.
- **Relay:** a host that keeps WebSocket connections open (Fly.io, Railway, Render; not serverless functions):
  `pnpm --filter @thumbtide/server start`, with `PORT` and, optionally, `ALLOWED_ORIGINS=https://<your site>`.
  The room logic (`server/src/rooms.ts`) doesn't depend on the socket library, so it can move to Cloudflare Durable
  Objects later.
- For the TV app against a deployed setup, set `VITE_RELAY_URL` and `VITE_JOIN_URL` (`https://<your site>/join/`)
  before `pnpm tv`. The TV app connects from a `file://` page, so `ALLOWED_ORIGINS` must allow that too.

---

## Credits

- Oil-paint brush rendering adapted from [Oil paint](https://patch.gg/blendi/oil-paint) by @blendi (MIT).
- Cascade's sound effects are from [Kenney](https://kenney.nl)'s Interface, Impact and Sci-fi sound packs (CC0).
- Cult's art generated with FLUX.2 Pro via Replicate.
