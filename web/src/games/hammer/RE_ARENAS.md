# Hammerfight arenas, bounds, camera, obstacles, coins and round flow (RE)

Read from the DRM-free dev copy of Hammerfight v1.004 (`Hammerfight.exe`, x86, image base 0x400000) with objdump, and
from the level files `Data/Levels/*.seria`. Addresses are virtual addresses. This file describes behaviour only; it
contains no game code. Physics is in `HAMMERFIGHT_PHYSICS.md` and is not repeated here. Items marked **INFERRED** are
reasoned from the code structure or the data, not read line by line.

Units: px, s. Screen y points down, so "top" is the smaller y.

## 0. The level file format (`.seria`)

- Plain text. `{` opens an object, `}` closes it. `key=value` lines set fields. Lines with only a number are the
  payload of `phState` (9 floats: x, y, x_prev, y_prev, angle, angle_prev, …) and `Mesh` (`m_size` then x/y pairs).
- `m_classname` gives the class (`SG` = scene header, `Node`, `Frame`, `Body`, `Human`, `Joint`, `SLink`, `Replayer`).
  Every object has `m_iId` and `m_master_id` (its parent). Scripts find marker objects by `m_iId` (0x509500).
- `Frame` = a compound body (a prefab of several sprite pieces). Its children are in Frame-local coordinates and the
  Frame's own `m_state` (stored after the children) places it. Frames placed under the scene `Node` are in the level;
  the same prefabs also appear in the file as a library.
- Static geometry = `m_fDensity=0`, `health=1e+008`. Destructible = `health` < 1e7.
- **`m_layer` is a collision bit mask** (body +0x36c; broadphase test `layerA & layerB` at 0x402719). Layer 0 = pure
  decoration, never collides. Weapons use layer 3 or 11 (`Objects/Weapons`), coins and gems use layer 1.
  Values seen in arenas: 1, 2, 3, 19 (0x13, the floor strips), 256 (0x100), 257, 258, 259 (0x100 | 1..3),
  275 (0x113). Sprite-less, density-0 bodies with layer ≥ 256 are the invisible walls and ledges. Bodies with only
  0x100 (layer 256) do not touch layer-3 machines (INFERRED: they hold the crowd in place).

### Scene header keys (SG load 0x509f00…0x50a8e4)

| Key | Global | Use |
|---|---|---|
| `SIM_WIDTH`, `SIM_HEIGHT` | 0x55be04, 0x55be00 | Sim window (bodies inside ±W/2, ±H/2 of the sim centre are simulated, 0x404160). Only applied when `USE_RECT=true`; otherwise every body is simulated (0x4aaf00). |
| `USE_RECT` | 0x56dd27 | See above. Only ARIA3 uses it. |
| `ROUND_WORLD`, `WORLD_RADIUS` | 0x56dd25, 0x55be28 | x wraps around (cylindrical world). Only ARIA3 (radius 1900). |
| `hight_x`, `hight_y`, `low_x`, `low_y` | 0x56dd54…60, copied to 0x55f758…64 | **The arena rectangle**: max x, max y (bottom), min x, min y (top). A value of exactly 0 switches that side off. Used by the camera clamp, the fighter clamp and the sim centre. |
| `WIND_FORCE`, `CLOUDS_WIND` | 0x55be0c | Read only in the sky, cloud and flag code (0x509c14, 0x50fcfa…0x5105ff). No force on machines found. 15000 in every level. |
| `CRITICAL_SHOCK` | 0x55be34 | Knock-out threshold, see §2 (end). |
| `FAME_EFFECT`, `CROWD_REACT`, `CROWD_*` | | Crowd and score feel. |
| `DAY_TIME`, `RENDER_SKY`, `AMBIENT_LIGHT`, `STD_BACKGROUND` | | Lighting and background. |

## 1. Screen, camera and bounds

### Screen

`GFX_SCREEN_WIDTH`×`GFX_SCREEN_HEIGHT` = **800×600** (Config.ini). The world view is the same size: 1 world px =
1 screen px, **no zoom** (the camera code adds ±400/±300, globals 0x55b60c/0x55b610 = 800/600).

### Camera (0x50f030, every frame)

1. Targets: 10 slots at 0x5600a8 (stride 0x18). Helpers: 0x4699f0 puts a body in the first free slot, 0x469aa0
   clears all slots, a direct assign on 0x5600a8 sets slot 0 only.
   - ARIA_multy and ARIA2_multy assign each spawned machine to **slot 0** (0x4d3e8b, 0x4d3668), so the last spawned
     machine overwrites the others: the camera follows **one** machine (INFERRED: the last player spawned), and
     at the end the winner (0x4d4080).
   - ARIA3_multy uses the free-slot helper (0x4d2e23): the camera follows **all** players.
   - Hammerball multi clears the slots and assigns slot 0 (0x4cac17/0x4cac21; INFERRED: the ball).
2. The camera centre moves **5 % per frame toward the mean position of the filled slots** (×0.05 at 50 Hz, so a
   time constant of about 0.4 s).
3. Clamp: for every side of the arena rectangle that is non-zero, the 800×600 view must stay inside it
   (`cam.x + 400 ≤ hight_x`, `cam.x − 400 ≥ low_x`, `cam.y + 300 ≤ hight_y`, `cam.y − 300 ≥ low_y`).
4. Rounded to whole px. Screen shake (0x56e600) is added after this (see the physics file).

So: the camera **scrolls** (no zoom) to follow its target(s), but cannot show anything outside the rectangle. If the
rectangle is less than 800 px wide (or 600 px high), the view is effectively fixed on that axis.
At round start the script puts the camera on a marker object (ARIA multi: 0x4d3c1c).

A second camera routine (0x45e650) moves the camera when a mouse cursor body reaches the screen edge (edge scroll,
3 %/frame smoothing for one cursor). It acts only on cursor bodies (sprite `cursor_editor…`) — menus and the editor,
not on fighters.

### Fighter clamp — the hard arena limit (0x469570, via 0x490a80 / 0x490ec0)

The arena scripts call it **every frame** for every fighter (ARIA_multy 0x4d3fef, ARIA2_multy 0x4d36fb,
ARIA3_multy 0x4d2fa1, Hammerball multi 0x4ca088; args: clamp on, out-of-bounds kill off). Other calls exist
(0x4c7dfd, 0x4cd28b, 0x4cdbd2, many story scripts); their owners were not pinned down.

- The limit is the arena rectangle. For player-type machines (class mask 0x2bf, **INFERRED** = player machine) the
  rectangle is **expanded by 100 px on every side** (0x53e1d8).
- The clamp is **hard and position-based**: if x > hight_x then x = x_prev = hight_x (same for the other three sides).
  Setting both position and previous position zeroes the velocity across that edge (a dead stop, no bounce, no spring).
- A fighter is clamped **only after it has once been inside** the rectangle (flag +0x568, 0x4695a4). A machine that
  spawns or is flung from outside can fly in freely.
- Sides with value 0 are not clamped. Example: Hammerball has `low_y=0` → **no ceiling**; ARIA3 has
  `hight_x=low_x=0` → no left/right limit (the world wraps instead).
- Alternative circle mode (flag 0x560610): distance from a centre point clamped to **280 px**. Set by some story
  scripts (0x483a7b), not by the multiplayer arenas.
- Optional "kill outside" mode of 0x490a80 (third arg): a fighter outside the un-expanded rectangle is killed and
  removed. The multiplayer arenas pass 0 (off). Fighter type 7 (`+0x860`) is always killed outside the expanded rect.

So there is **no soft force and no kill zone** in multiplayer: the walls/floor in the level are physical colliders,
and on the open sides the machine stops dead 100 px past the rectangle edge. Because the rectangle is larger than the
800×600 view in most arenas and the camera follows one target (ARIA/ARIA2 multi), a fighter can be off screen.

### Per arena (all `SIM_WIDTH/HEIGHT=1000`, `USE_RECT=false` unless noted)

Rect = [low_x … hight_x] × [low_y (top) … hight_y (bottom)]. "Camera range" = where the view centre can go.
"Player clamp" = rect + 100. Colliders are invisible walls/ledges (bbox x, y, layer). Static sprite colliders
(layer ≠ 0) also form floors and walls.

| Level (script) | Rect x / y | Size | Camera range x / y | Physical bounds from the level |
|---|---|---|---|---|
| **ARIA_multy** (hot-seat duel 1, ID 171) | −436…434 / −363…614 | 870×977 | −36…34 / −63…314 | Two layer-259 ledges at y 640–674 (x −456…−178 and 171…449); crowd walls (layer 256) in the middle; static scenery x −574…578, y −304…639. Bottom 614 (+100 → 714); top and sides open (clamped at ±535, −463). |
| **ARIA2_multy** (ID 173) | −600…600 / −530…593 | 1200×1123 | −200…200 / −230…293 | Layer-257 ledges at y 152–203 just outside the sides (x −968…−649, 639…958). Scenery x −759…807, y −123…678. Sunrise (DAY_TIME 6). |
| **ARIA3_multy** (ID 175) | none / −320…610 | wrap ×1900 | free / −20…310 | `ROUND_WORLD=true`, `WORLD_RADIUS=1900`, `USE_RECT=true`, SIM 4000×10000. Seven layer-259 floating platforms (100×50) at y ≈ 577–627, x −2277…2089. Endless horizontal sky arena; only top and bottom are clamped. |
| **HAMMERBALL_multy** (ID 53) | −619…554 / *(none)*…412 | 1173 wide | −219…154 / …112 | No ceiling. Six layer-259 blocks at x −833…−663 and 617…799, y −158…105 (the goal frames, INFERRED). 52 `lamp` links (density 5) and 23 `chain_small` links (density 30) hang as loose physical chains. |
| **ARENA** (ID 113, Melka arena, story) | −195…639 / 990…2020 | 834×1030 | 205…239 / 1290…1720 | Pit: floor strips (layer 19) at y ≈ 1710–1798; invisible walls (layer 258/259) at x ≈ −224…−177 and 585…635. Interior ≈ 760 px wide. Open top. No fighter-clamp call found in this script; the walls do the work. |
| **MELKA_pit** (ID 218) | −180…638 / −203…458 | 818×661 | 220…238 / 97…158 | Scenery x −298…715, y −204…467. One marker. View nearly fixed. |
| **MELKA_pit2** (ID 220) | −195…639 / 1385…2066 | 834×681 | 205…239 / 1685…1766 | Eight layer-275 ledges (283×58) stepping down from y 1260 to 1904. Floor strips at y ≈ 1818–1921. |
| **MELKA_pit3** (ID 221) | −195…639 / 990…2020 | as ARENA | as ARENA | Same rect as ARENA, night (DAY_TIME 23.5), 3 cages only (§2). No invisible walls found; static sprite colliders x −355…766. |
| **KADISH_large** (ID 250) | −434…406 / −441…827 | 840×1268 | −34…6 / −141…527 | Ten layer-259 balcony ledges (236×50) at x −581…−343 and 331…569, y −387…566. Floor strips y ≈ 641–708. `CRITICAL_SHOCK=60`. |
| **KADISH_small** (ID 240) | −266…569 / −882…−272 | 835×610 | 134…169 / −582…−572 | Collider bars on layers 2/3 at y −1015…−208. View fixed. `CRITICAL_SHOCK=30`. |

Spawn markers: sprite-less 18×19 boxes that scripts look up by `m_iId` (0x509500). **ARIA_multy spawns**
(list 0x56d860, index = counter + 3, counter 0→1→2→0 per spawn, 0x4d3e46…0x4d3f31): the three markers are
- 1st player: **(−88, 623)** (id 1996417451, bottom left),
- 2nd player: **(79, 621)** (id 1299715241, bottom right),
- 3rd player: **(−1, −341)** (id −131497253, top centre), then it repeats.
The bottom two are 167 px apart, just below the rect bottom (614): they start outside the rect, so the clamp does not
hold them until they fly in. The camera anchor is the marker at (3, 84) (id 131392548). A second list 0x56d850
(markers at (−121, 123), (125, 125) and two more) feeds the per-frame helper 0x4b9030 (INFERRED: AI way points).

## 2. Obstacles and destructibles

- **Multiplayer arenas (ARIA*_multy, HAMMERBALL_multy): no destructible objects at all.** Everything static is
  indestructible (`health=1e+008`, density 0).
- Hanging chains (Joints, rope length in brackets). All chain links are `m_layer=0`, so by the layer rule they never
  touch machines: decoration that swings under gravity.
  - HAMMERBALL_multy: 46 `lamp`–`lamp` joints (15 px, density 5) strung between `offside_01` posts and `rock_4`
    (lamp garlands), and two `chain_small` chains (7 px links, density 30) from a Frame.
  - MELKA_pit: one `chain_large` chain (20 links, 13 px, density 5) from `large_benedicti_01`.
  - MELKA_pit2 / MELKA_pit3: one `chain_small` chain each (24 / 20 links) from a ring (`kolco_s` / `kolco_l`).
- **ARENA** (Melka arena): destructible crates on the walls with the crowd inside them:
  - `cage_01/02/03/04`: health 10 (some 6 or 8), static (density 0) until broken, layer 3 (collides with machines).
  - `cage_05/06/07/08` and one `cage_02`: health 28–30 (10), density 50, **hung on ropes** (6 Joints, 39–186 px)
    from the wall Frames and posts, so they swing when hit.
  - `box_01`, `box_03`: health 20. `barrel_01/02`: health 10.
  - They hold 1–3 spectator `Human`s each (health 5, `m_ai=true`).
  - All are `m_sharpness=1`, `m_explosive=0`. INFERRED: their pieces count as unowned bodies when they hit a machine
    (damage and stun ×0.1, physics file); the break and the debris were not decoded.
  - `m_meta` 0x2002 / 0x2004 on these (INFERRED: "breakable" flags).
- **MELKA_pit**: 2 `barrel_01` (health 10, layer 2).
- **MELKA_pit2**: `barrel_01` ×4 and `barrel_02` (health 10), `box_01`/`box_03` (health 20, `m_meta` 0x42002),
  `cage_02/03` ×3 (health 10), all on the floor (y ≈ 1733–1896).
- **MELKA_pit3**: `cage_03` ×2 (health 8, layer 2) and `cage_04` (health 10), plus one loose `lamp` (density 30, layer 3).
- **KADISH_large**: no destructibles.
- **KADISH_small**: no destructibles; 5 loose heavy `freeza` blocks (74×74, density 40, layer 1, indestructible) in a
  row at y −308…−234, just above the rect bottom (−272): movable obstacles on the floor.
- The break effect (what a cage turns into, whether the pieces stay) was searched for only through the level fields;
  the code path was not found in this pass.
- **Knock-out by shock (0x404700):** a fighter whose shock value reaches
  `CRITICAL_SHOCK × (0.3 + 0.6 · inside_rect)` is eliminated by the arena loop (0x490a80). Player machines clamp
  their shock to 1 every frame (0x4b048e), so this only knocks out AI/NPC fighters (INFERRED). At shock
  > 0.35 × CRITICAL_SHOCK with more than 2 hits, the fighter loses/throws something (vfunc +0xe0, 0x4107b3).

## 3. Money / coins

The spill itself was decoded before (see the header of `coins.ts`: exe 0x410b41, spill 0x4b9a50, factory 0x495a20 —
hits over 5 damage, ≤ 30 coins, worth damage/2, gold 20/10, silver 4/2, copper 1). New here:

- Coins are real physics bodies (class Item 0x4236c0, size 0x728). Gold big: value 20 (+0x328), mesh about 10×10,
  **`m_layer` = 1**, so they collide with the floors, ledges and walls (layers 1, 3, 19, 257, 259, 275) and **land
  on the arena floor**. They also collide with weapons (layer 3/11).
- Item type 1 (`+0x6b8 & 0x3ffff`) = money. Pickup (Item collision 0x420d30 → Human::take 0x44fd50 → money
  0x44f990):
  - The collector is the **owner of the body that touched the coin**: the hull itself (class 0xbf) **or a held
    weapon part** (class 0x281f, not dropped). So in Hammerfight a swinging hammer collects coins for its machine.
  - Not while the collector is stunned (`+0x484 ≠ 0`).
  - Speed limit only for **AI** machines: if the owner's flag +0x86c is set (= AI-driven: the same flag blocks mouse
    input at 0x4b2c97 and selects the AI steering branch at 0x4b053a), the coin must move at **≤ 500 px/s**
    (per-type table 0x420e60: money 500, type 2: 10, type 16: 0, type 32: 100, else 100000). **Human players
    take coins at any speed.**
  - INFERRED: the item must be unowned, or 1 s past a timestamp (`+0x70 − +0x74 ≥ 1.0`); +0x70/+0x74 are not
    identified, and `coins.ts` (from the earlier pass) says 0.3 s.
  - On pickup: the value is added to the purse, a random `gold_01`/`gold_02` sound plays (volume 50), and the coin is
    deleted. Pickup radius = touching (collision), no magnet.
- One magnet exists (0x459fd3…0x45a223): a fixed object pulls listed items toward a point with force
  300000/distance and swallows them within 30 px with a gold sound. Owner not identified (INFERRED: a script
  collector, e.g. the Hammerball goal or the shop).
- Coin lifetime: not found. Searched: the coin factory entries (0x4966f6…0x496c86: fields +0x320, +0x36c, +0x6b8,
  +0x6bc, +0x328, +0x600), the pickup path and the spill function. The factory also sets +0x378/+0x37c on some
  items (unidentified; possibly a life or blink timer).

## 4. Round flow in multiplayer

### Modes and levels

`GAME_MODE` (0x55f6a4, Config.ini) chooses the main-menu mode (switch 0x4bde2b, table 0x4bdfa0): 0 story
(MELKA_bazaar), 1 HALL (training), 2 **Duel** ("-ARENA-", hot seat, needs as many mice as players), 3 GRIM (hunt),
4 **Hammerball** (HAMMERBALL_MULTY.seria).
Duel picks a random level (0x47de60): random 0…2 → `ARIA`, `ARIA2`, `ARIA3`, and adds **`_multy`** when more than one
human player is registered (list 0x56d080), then `.seria`. Hot seat = one mouse per player (dialog: "Borrow another
mouse from your neighbor").

Script dispatch (giant script function 0x4c0ec0, switch on script ID +0x38; state in +0x5c):
53 HAMMERBALL_MULTI 0x4c99f2, 113 ARENA 0x4ceb1b, 170/171 ARIA single/multi 0x4cf500/0x4d38ca, 172/173 ARIA2
0x4d077a/0x4d31a1, 174/175 ARIA3 0x4d1948/0x4d2969, 218/220/221 MELKA pits 0x4e75b6/0x4e8646/0x4e9421.

### ARIA multi (duel) state machine (0x4d38ca, states via table 0x508c38)

- **Init (once):** looks up the marker objects, puts the camera on the centre marker, builds the crowd/banners.
- **Every frame:** NPC/arena helper 0x4b9030 (fighters, markers, 5.0, 2) and timers.
- **State 0 – intro:** title text (dialog #71, "THE ARENA…") over a 3 s fade from black; crown banner
  `korona_back_06` slides in.
- **State 1 – spawn:** waits for the intro, then for each human player spawns their machine at the next spawn
  marker and sets **health = max health = 200** (0x404690(200) on +0x4d8/+0x4dc; INFERRED that this field is the
  arena health; DBG_HEALTH is 100). Adds it to the fighter list, the player list and the camera list.
- **States 2–3 – ready:** waits for the banner/announcement events (0x468690 ids 0x95/0x96), then until every
  player's machine has finished its entry (+0x988 clear). No numeric countdown found.
- **State 4 – fight:** each frame 0x490a80(fighters, clamp on, kill off). It removes fighters that are dead
  (+0x4d8 = 0), deleted, or knocked out (§2) and scores them (0x483b40 with the victim's value). **The round ends
  when one fighter (or none) is left.**
- **State 5 – result:** the winner gets the victory treatment (0x495810), banners, crowd.
- **States 6–7 – end:** waits for the announcement events, shows dialog #33 for **4.5 s**, then on the next
  input/time-out (0x46a680) fades to black in **3 s** and **loads `MENUE.seria`**.

So a hot-seat duel is **one round per level load**; there is no "rounds to win" counter in the script, and nothing
in Config.ini sets it. (Rematch = pick Duel again; a new random ARIA level.)

### Other timings seen

- Fade to black before leaving: 3 s (0x50882c). Announcement texts: 3–4.5 s.
- `GAME_HAMMER_SCORE=3200` (Config.ini, 0x55b5b0): Hammerball target/score constant (not followed further).
- Hammerball multi (0x4c99f2) uses the same clamp each frame (0x490ec0 at 0x4ca088). Its goal and scoring logic
  was not decoded (open item).

## 5. Other level-design facts

- **Wind:** `WIND_FORCE=15000` everywhere, read only by the sky/cloud/flag code. No wind force on machines found.
- **Water / hazards:** none in the multiplayer arenas (no explosive, spike or `m_jaws` bodies; all `m_explosive=0`).
- **Lighting:** `DAY_TIME` sets the sky/light (ARIA_multy 14.9 day, ARIA2 6.1 sunrise, ARIA3 noon, Hammerball 15.4,
  ARENA 21.6 night). Lamps (`lamp`, `m_effect_type=4`, value 1.6) are light sources.
- **Crowd:** hundreds of `Human` spectators (health 5, AI) on layer-256 stands; `CROWD_SOUND`/`CROWD_MUSIC` and
  `FAME_EFFECT` drive cheers.
- **Simulation window:** with `USE_RECT=false` (all multiplayer arenas but ARIA3) every body is simulated. With the
  rectangle set, the sim centre is the rectangle centre; otherwise it follows the camera snapped to
  `CORE_SIM_TRASHHOLD` = 200 px (0x4b23b0).

## Gaps vs our port

Our port: fixed 960×540 frame (`sim.ts` VIEW_W/VIEW_H), a stiff spring 70 px outside the frame at 7 Hz
(`tuning.limit/limitHz`, `Arena.limit`), AI steering away from the edges, no floor or walls, cosmetic coins that fall
out of the bottom (`coins.ts`), first-to-N rounds with warm-up (`host.ts`).

1. **Hard clamp instead of the spring (sim.ts `limit`).** Hammerfight stops a machine dead at the arena rect + 100 px:
   when the hull passes an edge, set its position *and previous position* (or velocity component) to the edge. Only
   after the machine has been inside once (spawn from outside is free). Keep the 0-means-open rule per side.
   Suggest: rect = the frame, margin = 100 px scaled to our frame (≈ 100 × 960/800 = 120 px on x, 90 px on y), or
   keep a smaller margin so machines stay visible on the TV (our camera does not scroll).
2. **Physical floor (sim.ts).** The enclosed arenas (ARENA, pits, KADISH) have a floor and walls; ARIA_multy has
   bottom ledges with a gap in the middle, ARIA3 only floating platforms (INFERRED from the collider layout). Add a static floor
   body (or a position clamp at the floor line with restitution 0.3 / friction 0.2, the default `m_fCoR`/`m_fCoF`)
   near the bottom of the frame, so stunned and dead machines, loose weapons and coins land instead of falling out.
   Wrecks then stay in play until removed by time; revisit `OUT_OF_PLAY`.
3. **Open top (sim.ts).** Original arenas have no ceiling collider; the clamp alone stops machines at the top. Our
   top limit should be the same hard clamp, not a wall.
4. **Camera (render.ts / host.ts).** Original: 800×600 view, no zoom, follows its target slot(s) at 5 % per frame
   (ARIA/ARIA2 multi: one machine; ARIA3: all players), clamped to the rect. Our fixed frame is better for a TV
   party game with up to 8 players, but then the arena rect must equal the frame (no off-screen play). If we add a
   scrolling camera later: lerp 0.05/step to the mean of all machines, clamp so the view stays inside the rect.
5. **Coins (coins.ts).**
   - Let coins land on the floor (collide with the floor line, CoR 0.3) instead of falling out of the bottom.
   - Pickup: allow the held weapon's parts to collect too (Hammerfight: the owner of any touching hull *or weapon
     part*), not only the hull radius.
   - Human players collect coins at any speed; only bots need the coin at ≤ 500 px/s (bots.ts / coins.ts).
   - Keep "not while stunned". Keep our 0.3 s delay (the exe age rule is not confirmed).
6. **Round flow (host.ts).** Hammerfight's duel is a single round, end when ≤ 1 fighter is left, 4.5 s result text,
   3 s fade. Our first-to-N match is our own design (keep it; `wins` setting). Optional: give arena fighters
   **200 health** like the duel script (INFERRED), or keep 100.
7. **Spawns (host.ts `SPAWNS`).** The original duel uses three spawn markers in turn: bottom left (−88, 623), bottom
   right (79, 621) — only 167 px apart, close to the floor, just outside the rect — and top centre (−1, −341).
   Players 1 and 2 thus start low, near each other, facing off. Ours starts them far apart (520 px) at mid height;
   optional change: put P1/P2 lower and closer (for example 300–400 px apart near the floor line).
8. **No destructibles needed for multiplayer parity.** The multiplayer arenas have none. If we want flavour, the
   ARENA cages (health 10–30, unowned debris ×0.1 damage) are the reference.
