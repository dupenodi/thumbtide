# Project notes

Decisions, design rules, known issues and plans that aren't obvious from the code. Read this before building a game
or changing how things look.

## Design rules

These come from playtesting and the owner's feedback. Follow them unless you've agreed otherwise.

**Games**
- Games are for adults: party games for a room of friends, not kids' games.
- Every game is original: its own name, theme and art. Borrowing a mechanic is fine; copying an existing game's name,
  characters, art or look is not. Cult is an original hidden-role game; Cascade is an original take on chain-reaction
  board games.
- Each game has its **own visual identity**. Don't reuse another game's style, or the lobby's, inside a game.
- Don't explain the rules on screen. Label the controls; the **?** help sheet comes from the `.pad` file.
- Motion is understated: something animates once, when it happens (a card slams down with a thud, a stamp, a dealt
  fan of cards). Don't overdo it.
- Colourful and lively inside a game, but never cluttered.

**The phone**
- The phone is a controller. The TV does the showing: no scores, power-up displays or game boards on the phone.
- Phone screens are conventional, not creative. An early Cult phone UI was too inventive and players got lost. What
  works:
  - sentence-case headings in Inter, with no decorative effects on text or buttons people need to read or tap
  - a panel at the bottom with the status and the action buttons
  - choices: tap to select, then confirm with one clear primary button
  - a secret (like a role) is a big face-down card in the middle: hold it to see it
- "Absolutely perfect" controls are the goal. Tune the feel in the `.pad` file and try it on a real phone.

**Lobby and menus**
- Minimal and clean: Space Grotesk and Inter.

**Brand and art**
- Thumbtide's house style for art is a **two-colour screen-printed gig poster**: black stock, paper grain, two bright
  inks, halftone dots. Cult uses it. The lobby and Wet Paint still have an older candy look.
- The interface around the art stays plain: Inter for anything people read, Playfair Display 800 (`inked()` in
  `kit/inked.ts`) for a few big words, and the off-register second ink only on logos.
- Fonts tried and rejected: Shrikhand (too close to the old candy font) and Archivo Extended.
- Art is generated with Replicate (FLUX.2 Pro). The account is rate-limited to about 6 images a minute, so make
  them one at a time.

## Known issues

- **Needs a computer running.** The relay and phone page are served by `pnpm dev`. Nothing is deployed yet; see
  [Deploy](../README.md#deploy) and the Cloudflare plan in [lg-tv.md](lg-tv.md#not-done-yet).
- **The LG TV app got stuck once**, cause unknown. See [lg-tv.md](lg-tv.md#freezes-and-other-problems).
- **Cascade's sound levels** haven't been tuned by ear yet (the clips are in `cascade/sounds/`, volumes in `cascade/audio.ts`).
- **TV performance** of Cascade's Marbles look and its big boards (14 × 8 and up) hasn't been measured.
- **Local network limits:** without HTTPS, phones can't use tilt sensors or the screen wake lock.

## Plans

- **Buzzkill**, a buzzer quiz, is next in line. It was started, then paused while the TV app came first.
  - Done: the `.pad` language has round buttons (`shape round`) and `choices` lists, and the gamepad draws them
    (`showChoices` / `hideChoices`, `onChoose`).
  - Planned:
    - The question appears word by word on the TV and is worth less the longer it runs.
    - The first to buzz picks from four options on their phone.
    - A wrong answer costs half the current value and locks that player out of the question.
    - The last question is worth double, and each player gets their own buzzer sound.
    - Settings: number of questions, drinking rules, computer players.
    - Questions live in an editable `.deck` text file.
- A strategy game for 4–8 players (a working idea is called *Skim*).
- Run without the computer: relay on Cloudflare Workers with Durable Objects, site on Cloudflare Pages.

## Handy to know

- The TV page keeps its room in the browser tab's session storage, so a reload rejoins the same room. Open a new
  tab for a fresh lobby.
- The phone page asks before it unloads (so a stray back swipe doesn't drop a player). When automating phones with
  Playwright, close them with `page.close({ runBeforeUnload: false })`.
- In dev, `window.__wetpaint` in the TV page's console exposes Wet Paint's state.
- Cascade's chain speed is set in `cascade/look/director.ts` (`FIRST_FLIGHT` 0.62s, `MIN_FLIGHT` 0.2s). It was
  slowed down on purpose so a chain is easy to follow.
- Test lightly: rules in unit tests, then a real phone and the TV. Keep TV test runs short.
