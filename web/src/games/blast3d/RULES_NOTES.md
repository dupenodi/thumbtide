# Blast Party 3D: where the rules and the physics come from

The rules (`rules.ts`) and the character and prop physics (`engine.ts`) are ported from Ballistica, the
open-source engine of BombSquad, which is MIT licensed. Only its **rules, numbers and formulas** are used.
BombSquad's characters, models, textures, sounds and maps are not open source. None are used or recreated
here (see "Art" at the end).

Source: `https://github.com/efroemling/ballistica`, commit `d6049a667286ff906406ccc7d635f3d315256df3`
(read on 2026-11-18/19). Line numbers below are for that commit. Paths:

| short name | path |
|---|---|
| spaz.py | `src/assets/ba_data/python/bascenev1lib/actor/spaz.py` |
| spazfactory.py | `src/assets/ba_data/python/bascenev1lib/actor/spazfactory.py` |
| spazbot.py | `src/assets/ba_data/python/bascenev1lib/actor/spazbot.py` |
| bomb.py | `src/assets/ba_data/python/bascenev1lib/actor/bomb.py` |
| powerupbox.py | `src/assets/ba_data/python/bascenev1lib/actor/powerupbox.py` |
| _powerup.py | `src/assets/ba_data/python/bascenev1/_powerup.py` |
| _gameactivity.py | `src/assets/ba_data/python/bascenev1/_gameactivity.py` |
| elimination.py | `src/assets/ba_data/python/bascenev1lib/game/elimination.py` |
| the_pad.py | `src/assets/ba_data/python/bascenev1lib/mapdata/the_pad.py` |
| characterrig.py | `tools/bacommon/characterrig.py` (the rig's sizes; generates `spaz_rig.h`) |
| scene_v1.h | `src/ballistica/scene_v1/scene_v1.h` |
| scene.cc | `src/ballistica/scene_v1/support/scene.cc` |
| spaz_node.cc / .h | `src/ballistica/scene_v1/node/spaz_node.cc` / `spaz_node.h` |
| tuning.h | `src/ballistica/scene_v1/node/spaz_physics_tuning.h` |
| spaz_pose.cc | `src/ballistica/scene_v1/node/spaz_pose.cc` |
| prop_node.cc / .h | `src/ballistica/scene_v1/node/prop_node.cc` / `prop_node.h` |
| rigid_body.cc | `src/ballistica/scene_v1/dynamics/rigid_body.cc` |
| dynamics.cc | `src/ballistica/scene_v1/dynamics/dynamics.cc` |
| material_context.cc | `src/ballistica/scene_v1/dynamics/material/material_context.cc` |
| touch_input.cc | `src/ballistica/base/input/device/touch_input.cc` |
| game_camera.cc / .h | `src/ballistica/base/graphics/support/game_camera.cc` / `.h` |

Marks:
- **[S]** a value from a script, used as it is.
- **[E]** a value or formula from the engine's C++, used as it is.
- **[C]** converted from the engine (its 8 ms steps into times or into our step, or ODE into this model). The
  conversion is said.
- **[A]** approximated: the engine gets it from a part of ODE this game does not run. How is said.
- **[T]** tuned here, with no source value.

## How the engine's physics is run here

- **The step.** Ballistica steps its scene and ODE every **8 ms** (125 Hz): `scene_v1.h:558`
  `kGameStepMilliseconds = 8`. (Its "120hz" comments are stale. The first slice of this game read them and was wrong
  by 4 %.) Gravity is **20** (`dynamics.cc:1204`).
- **Ours.** The rules step at 60 Hz, with **two physics steps of 1/120 s** in each (`SUBSTEPS`, `engine.ts` `H`).
  - [C] A per-step factor `c` of the engine (a decay or a smoothing) becomes `c^(H/0.008)` (`per()`): the same time
    constant.
  - [C] A filter `y = a(y + b·x)` also gets its input gain changed so its steady state `a·b/(1−a)` stays the same
    (`perGain()`).
  - [C] A per-step increment `d` becomes `d·H/0.008` (`inc()`).
  - [C] A step count becomes a time (×0.008 s).
  - The feel test (`feel.ts`) runs an independent copy of the formulas at the engine's own 8 ms with the raw factors,
    to show that the conversion keeps the results (table below).
- **The model.** The engine's current physics (the "bg limbs" tuning, `tuning.h:258–331`) is three core bodies (head,
  torso, pelvis) on an invisible roller ball that stands in for the legs. The arms and legs are display only. This
  port keeps those pieces, cut down to what moves the character:
  - the ball's drive and its friction;
  - the torso on the ball's spring (vertical);
  - the ball's soft floor contact;
  - the stand spring and the neck and pelvis springs (the turn).

  All springs are integrated implicitly. ODE's soft joints and contacts (erp/cfm from stiffness and damping,
  `dynamics.cc:1131–1133`) are implicit Euler springs.
- **Not modelled [A].** The three bodies' tumbling and their collisions with each other, the ODE solver's iterations,
  and the friction pyramid (the per-axis caps are kept, as the engine's AMotor has them). The drawn ragdoll
  (`ragdoll.ts`) is view-only and never feeds back into the rules.

## The character (engine.ts)

| value | here | source |
|---|---|---|
| Masses: head 0.460, torso 0.612, pelvis 0.330, ball 0.071 kg (core 1.401, all 1.472) | `M_*` | [E] density ×5 (`rigid_body.cc:747`) × each body's mass shape (`spaz_node.cc:750–760, 1473–1482`) × the bg-limbs densities (`tuning.h:264–268`). The header's comment says the core is 1.392; the shapes give 1.401 (0.6 %). |
| Ball radius 0.3, head 0.23, torso collision 0.15 | `ROLLER_R`, `HEAD_R`, `TORSO_R` | [E] characterrig.py:37–44, spaz_node.h:811 |
| Stand heights: torso 0.2 over the ball, head +0.45, pelvis −0.14. So the torso stands 0.48 over the feet and the head's top 1.16. | `SEP_REST`, `HEAD_UP`, `PELVIS_UP`, `TORSO_Y`, `HEAD_TOP` | [E] characterrig.py:75–84 (2.25 / 1.8 / 1.66 / 1.6) |
| Ball spring 1500 / 6 | `SPRING_K/C` | [E] tuning.h:270–271 |
| Ball floor contact 7000 / 10 (only pushes). While knocked out: 1600 / 8. | `FLOOR_CONTACT_*`, `DOWN_CONTACT_*` | [E] tuning.h:311–312, 326–327 |
| **Jump**: the spring's rest point pushed down 0.3 for 7 steps, at ×0.4 stiffness and ×0.2 damping. It lifts only while the ball is on the ground. | `JUMP_PUSH`, `JUMP_TIME` 56 ms | [E] tuning.h:272–275, spaz_node.cc:1202–1230, 3117–3122. [C] 7 steps → 0.056 s. |
| Jump cooldown 250 ms | `JUMP_COOLDOWN` | [S] spaz.py:206 |
| Walk: the ball's target spin 7.68 rad/s → **2.30 m/s** | `WALK_SPEED`, `WALK` | [E] tuning.h:299, spaz_node.cc:3247 |
| Run: + gear × gas × 15 rad/s; gear = smoothed speed / 7; fixed point **6.45 m/s** | `RUN_SPEED_ADD`, `GEAR_UP_SPEED`, `RUN` | [E] tuning.h:300–303, spaz_node.cc:3229–3248 |
| Gear smoothing 0.985 up / 0.94 down per step | `SPEED_UP/DOWN` | [E] tuning.h:302–303. [C] per() |
| Run gas: smoothing 0.95 up, 0.5 down. −0.02 per step when not running. −0.05 when carrying or off the ground. No running while carrying or for 200 ms after a throw. | `steer()` | [E] spaz_node.cc:2091–2110. [C] per(), inc() |
| Steering: opposite parts stripped by the gas, the length pushed toward 1, blended 0.975·(0.9 + 0.1·gas) per step (× speed/2 under 2 m/s) | `steer()` | [E] spaz_node.cc:2116–2172. [C] per() |
| Digital stick (all of −127, 0, 127) smoothed 0.5 per step | `steer()` | [E] spaz_node.cc:2052–2071 |
| Motor 15 N·m on the ball, per axis, × min(1, balance/100); friction 1.2·√(1·1) on the ball, per axis | `MOTOR_FORCE`, `MU_ROLLER` | [E] tuning.h:296–298, spaz_node.cc:3214–3264, dynamics.cc:1117, material_context.cc:14 |
| No horizontal force in the air (the motor turns only the ball) | `stepSpaz()` | [E] spaz_node.cc:3140–3264 (the AMotor acts on the ball against the world) |
| Wall kick 100 N off steep surfaces | `WALL_KICK`, `Game.walls()` | [E] tuning.h:315, spaz_node.cc:5848–5860 |
| Speed cap \|v\|² ≤ 300 | `MAX_SPEED` | [E] spaz_node.cc:2372 |
| Balance: +20 per step on the ground up to 235, then +1; in the air −20 / −5 / −1; 0 when knocked out or carried | `stepSpaz()` | [E] spaz_node.cc:2766–2787, 1671–1675. [C] inc() |
| **Turn**: a stand spring 270 / 3.5 × balance × 0.6 (0.9 carrying), softer with a small stick; neck 13 / 0.8 (KO 5 / 0.3); pelvis 1.5 / 0.06 | `turn()` | [E] tuning.h:279–293, spaz_node.cc:3055–3088. [A] yaw only, 3 bodies, error 2·sin(Δ/2); a lying body's spin damped by friction (rate 10/s, [A]) |
| Dizzy: \|smoothed spin\| > 10 for 120 steps → knock-out 40 | `stepSpaz()` | [E] spaz_node.cc:2750–2764. [C] inc() |
| Knock-out ticks: one per 5 steps on the ground, 10 in the air (25 / 12.5 per s) | `KNOCKOUT_PER_S` | [E] spaz_node.cc:2792. [C] (was 24 at "120 Hz" before) |
| Knock-out for a hit: min(26, max(k, int(raw × 0.02) − 24)) | `Game.knockoutFor()` | [E] spaz_node.cc:1846–1849 |
| Getting up: the ball's contacts frictionless for 25 steps | `WAKE_SLIDE` 0.2 s | [E] tuning.h:330, spaz_node.cc:2797. [C] |
| A knocked-out or dead body slides: core bodies μ 1.2 × 0.1, locked down ball μ 1.2 | `MU_DOWN` 0.66 | [E] tuning.h:316, 328. [A] half the weight on each |
| A limp body lands dead (core contacts 6000 / 0.01: erp ≈ 1) | `stepSpaz()` | [E] tuning.h:309–310. [A] |

## Punch (spaz.py, spaz_node.cc, spaz_pose.cc)

| value | here | source |
|---|---|---|
| Cooldown 400 ms (gloves 300); scale 1.2 (gloves 1.4) | `PUNCH_COOLDOWN*`, `PUNCH_SCALE*` | [S] spaz.py:24–25, spazfactory.py:249–256 |
| A punch lasts 35 steps | `PUNCH_TIME` 0.28 s | [E] spaz_node.cc:369. [C] |
| The fist's hit sphere (r 0.25, 0.1 lowered) exists from 80 ms to the end; one hit per body per punch | `punchStep()`, `FIST_R` | [E] spaz_node.cc:3305–3334, spaz.py:1227 |
| The fist's path: the synthetic fist (spring 0.16, damping 0.3 per step; pulled back to 88 ms, then out to the shoulder + 0.53 along the punch, lifted 0.09) | `FIST` | [E] spaz_pose.cc:150–236. Kept as a table at 8 ms. [A] in the punch's frame, not the torso's. |
| Left or right hand by the spin (random under 0.3) | `punch()` | [E] spaz_node.cc:1175–1181 |
| Punch power: 0.7–1.0 up to 200 ms after the press, then 0 | `punchPower()` | [E] spaz_node.cc:2229–2241 |
| total = power × scale × (angular momentum × 110 + linear momentum × 40) | `Game.punchTotal()` | [S] spaz.py:1228–1258, [E] rigid_body.cc:862 |
| Momentum filters: linear d += v·0.004, ×0.95; m += d, ×0.96 (×(0.9+0.02v) under 5 m/s) → 1.82 × speed. Angular: d += ω·0.0004, ×0.965; m += d, ×0.92 → 0.127 × spin. | `stepSpaz()` | [E] spaz_node.cc:2196–2228. [C] perGain() |
| Damage 0.22 × 5 × total (a one-body hit counts 5×) | `punchStep()` | [S] spaz.py:893, [E] spaz_node.cc:1818–1835 |
| Knock-back: force 1.8 × total along the fist's velocity, its up part ×2, for one step | `pointImpulse()` | [E] rigid_body.cc:836–883. Δv = force × 0.008 / 1.472 |
| The puncher's kick-back: −400 for one step, on its first hit | `kickBack()` | [S] spaz.py:1272–1290, [E] spaz_node.cc:1874–1885 |
| No punch on a fighter 0–70 ms after a pick-up press or within 360 ms of a let-go | `PUNCH_GRAB_GAP`, `PUNCH_DROP_GAP` | [S] spaz.py:1212–1224 |
| A punch knocks a bomb (Δv = 1.8 × total × 0.008 / mass); it sets off only an armed impact bomb | `punchStep()` | [S] bomb.py:1100–1107 |

So a punch from a stand-still with no spin does almost nothing. A walking punch does about 90 hp. A punch at full
run does about 600 hp and knocks out for about 1 s. That is the engine's own result: the bg-limbs arms do not move
the torso. The first slice's tuned "+50" and `PUNCH_RECOIL` are gone.

## Pick-up, carry, throw

| value | here | source |
|---|---|---|
| The pick-up sphere (r 0.7, between head and torso, 0.3 forward) exists for one step, 8 steps after the press; another press after 44 steps | `PICKUP_DELAY`, `PICKUP_COOLDOWN`, `PICKUP_R` | [E] spaz_node.cc:370–371, 1079–1097, 3514–3537. [C]. [A] the nearest thing in it is taken. |
| What can be lifted: bombs, the crate, **any fighter that is not invincible**; never power-up boxes | `pickup()` | [S] spaz.py:1291–1330, powerupbox.py:128–131 |
| Carried: 1.08 over the torso, 0.05 forward, on a 180 spring (sags m·g/180); its mass is added to the carrier | `HOLD_UP`, `HOLD_FWD`, `HOLD_K` | [E] spaz_node.cc:7921–7975. [A] rigid at the sagged point; `hold_forward −0.05` is read as 0.05 forward |
| A carried fighter loses its balance at once; there is no timed release | `stepFighter()` | [E] spaz_node.cc:1671–1675. Damage makes the carrier drop it ([S] spaz.py:1126–1129). Death too ([E] 7024). |
| Bomb press: a bomb is made and picked up at once (lit in the hands); the next press of Bomb, Punch or Pick-up throws | `bomb()` | [S] spaz.py:457–475, 1340–1388, [E] spaz_node.cc:1143–1200 |
| Throw power 0.8·(0.6 + 0.4·stick), less within 500 ms of the pick-up | `throwImpulse()` | [E] spaz_node.cc:1630–1646 |
| Throw force (50·dir, 80 up)·(power − 0.1)·1.15, or (0, 60, 60) in the torso's frame with no stick, for 7 steps | `throwImpulse()`, `THROW_STEPS` | [E] spaz_node.cc:3432–3505, scene.cc:370–397 (time advances after the step, so 0…48 ms is 7 steps). [C] as one impulse |
| The thrower gets −0.25 of it; the push lands 0.1 under a bomb's centre (backspin) | `throwHeld()` | [E] spaz_node.cc:3487–3505 |
| "Pro trick": Punch or Pick-up while Bomb is still held lobs it backwards, ×−0.2 | `throwHeld()` | [E] spaz_node.cc:3489–3498 |
| The run trigger: on while any button is held | `setButtons()`, controller.ts | [E] touch_input.cc:1026–1028, 1071–1072 |

## Bombs and blasts (bomb.py, prop_node.cc, rigid_body.cc)

| value | here | source |
|---|---|---|
| Bomb: sphere r 0.3, mass 0.566. Crate: 0.7 box, mass 1.20. | `BOMB_R`, `BOMB_M`, `TNT_HALF`, `TNT_M` | [E] prop_node.cc:316–324, rigid_body.cc:747 |
| Friction on the deck 1.2·√0.3 = 0.66 | `MU_BOMB` | [S] bomb.py:214, [E] dynamics.cc:1117 |
| Bounce 0; only the soft contact (8000 / 81) gives a little back | `PROP_BOUNCE` 0.05 | [E] dynamics.cc:1118–1125. [A] |
| Spin damping −0.02·m·ω; max speed 20 | `PROP_SPIN_DAMP`, `PROP_MAX_SPEED` | [E] prop_node.cc:571–588, prop_node.h:112 |
| A ball slides until it rolls (Coulomb friction at the contact point), then rolls far: its only loss is the spin damping (time constant 6.3 s) | `Game.roll()` | [E] the sum of the above. [A] solved per step |
| ODE puts it to sleep under 0.1 m/s and 0.1 rad/s | `stepBombs()` | [E] dynamics.cc:1206–1210 |
| Fuse 3.0 s (normal, sticky), impact 20 s | `FUSE`, `IMPACT_FUSE` | [S] bomb.py:850, 876 |
| Impact bomb: armed 0.2 s after it is made; goes off on any touch, not its owner's | `ARM_TIME` | [S] bomb.py:868, 961–972, 1085 |
| Sticky bomb: may stick to its thrower 0.25 s after the throw | `STICK_OWNER` | [S] bomb.py:986–992 |
| Blast radius 2.0; impact ×0.7; TNT ×1.45 | `BLAST_RADIUS`, `*_RADIUS_K` | [S] spaz.py:200, bomb.py:756–764 |
| Blast magnitude 2000; TNT ×2 | `BLAST_MAG`, `TNT_MAG_K` | [S] bomb.py:677–683 |
| The blast sits 0.1 under the bomb | `BLAST_DROP` | [S] bomb.py:367 |
| **Per body**: amt = 1 − d/radius; force = mag·amt·mass from the blast, sideways ×0.5, upward ×2, for one step. So Δv = 16·amt (mass cancels). | `areaImpulse()` | [E] rigid_body.cc:886–946 |
| On a fighter: summed over head, torso and pelvis where they stand (or lie). Damage = 0.22 × mag × Σ amt·mass, the head ×5. The ball takes none. | `blastParts()` | [E] spaz_node.cc:1753–1800, [S] spaz.py:893. [A] the random point of application (a tumble) is left out. |
| Chain reaction 0.1–0.2 s later | `CHAIN_MIN` | [S] bomb.py:1100–1126 |
| Crate back 20 s × (0.8–1.2) | `TNT_RESPAWN` | [S] bomb.py:1186–1190 |

The first slice's tuned `BLAST_HP` 1400 and `BLAST_DV` 13 are gone. The engine's sum gives about 1000 hp at the
bomb, 586 hp at 1 m and 267 at 1.5 m. A blast throws much more **up** than sideways (10.7 up vs 4.1 sideways at
0.5 m).

## Impact damage (spaz_node.cc, spaz.py)

- The engine: a head jolt over 3 m/s per step (the head touching something, no outside push in the last 300 ms, 500 ms
  since the last one) → 50 × (jolt − 3) flat damage, plus a knock-out of 50 × (jolt − 3) × 0.07 ticks
  (`spaz_node.cc:2430–2462, 1709–1719`, `spaz.py:1472–1485`).
- It never quite kills: damage ≥ hp becomes max(damage − 200, hp − 10) (`spaz.py:1118–1123`).
- [A] Here the head is not simulated. A fighter that is "tumbling" (blasted, punched over 1.5 m/s, knocked out,
  dropped or thrown) and lands faster than 3 m/s takes it with jolt = landing speed. The 300 ms and 500 ms gaps are
  kept.

## Fighters (rules, spaz.py)

| rule | here | source |
|---|---|---|
| Hit points 1000 | `HP` | [S] spaz.py:67 |
| Invincible 1.0 s after a spawn | `INVINCIBLE` | [S] spaz.py:173–180 |
| No action while knocked out (a carried fighter can still punch and light a bomb) | `Game.ready()` | [S] spaz.py:345, 372, 417, 466 |
| One bomb at a time; it comes back when it is gone | `bombsLeft()` | [S] spaz.py:63, 1164, 1373 |

## Power-ups, the mode, the arena

- **Power-ups** (powerupbox.py, _powerup.py, _gameactivity.py), unchanged from the first slice:
  - a box every 8 s at each point, 0.4 s apart; it blinks from 5.5 s and is gone at 7 s;
  - weights triple 3, gloves 3, impact 3, sticky 3, shield 2, health 1;
  - wear-off 20 s; shield 650 points, −10 every 0.5 s, spill-over past 500;
  - any hit but a punch destroys a box.

  [T] The box drops from 9 m up (the task's own idea; in Ballistica a box pops in at its point). `BOX_R` 0.36.
- **Elimination** (elimination.py):
  - lives, a respawn after 3.0 s, the "who is left" check once a second;
  - [T] default 3 lives, first to 2 round wins (settings);
  - `KILL_Y` from the_pad.py `map_bounds`.
- **The arena.**
  - From the_pad.py: its size, the four `ffa_spawn` and four `powerup_spawn` points and the `tnt1` point, moved so
    the deck's middle is the origin. Four more spawn points are mirrored to the front for eight fighters.
  - [T] The three blocks are ours. They are now 0.4 high (were 0.7), under the engine's jump (the feet rise about
    0.5). They need a run-up: with no air control, a standing hop lands where it took off.

## The camera (game_camera.cc)

- [E] The camera sits at (pan, 20.5, 22) in The Pad's frame (`game_camera.cc:225`), which is about 16.3 m over our deck
  and 24.9 m in front of its middle.
- [E] It pans in x after the fighters (clamped ±9, `kPanMax`) and aims at the middle of a **5 m sphere round each
  fighter** (`spaz_node.h:544`), clamped to The Pad's area-of-interest box (the_pad.py).
- [E] It zooms to fit them. The aim is a spring (0.000012 / 0.006 per ms). The zoom eases out at 0.0025 and in at
  0.001 per ms (`game_camera.cc:602–700`).
- [A] The zoom is fitted to the box's span, not to sampled sphere corners. It is clamped to 12–40°.

## Computer fighters (spazbot.py)

- `bots.ts` is written for this game. Bots hold the run trigger while they charge, flee or fetch a box, but not next
  to the edge (spazbot.py:243–249, 358–390 "runners").
- Their throw ranges come from the engine's throw. They aim short by 1.4 m because the bomb rolls on.
- They go round blocks (no air control) and hop on only with a run-up.
- They throw a carried rival from 0.75 m off the edge, because a thrown body goes only about 0.7–1.8 m.

## Changes from the first slice (mechanics)

1. **Run is a held button** (as on Ballistica's touch screens), and it **builds up over about 3 s** from 2.3 to
   6.45 m/s. It used to be a flat 5.4 m/s.
2. **No air control.** It used to be 2.5/s of steering in the air.
3. **Turning** comes from the stand spring: a walk turns around in about 0.06 s. A run turns in a wide arc: a
   reversed stick takes 0.5 s to swing the heading past 90°.
4. **The jump** is the ball's spring: the feet rise 0.51 m, 0.42 s in the air, with a small rebound hop. It used to
   be a 1.1 m apex. Carried weight lowers it.
5. **Punch**:
   - the hit sphere is live from 80 ms to 280 ms, and only 0–200 ms hits hurt;
   - the damage uses the engine's momentum filters plus spin;
   - the knock-back uses the engine's impulse;
   - the puncher gets the engine's −400 kick-back;
   - the reach comes from the fist's path (about 0.98 m centre to centre).
6. **Pick-up** reaches 64 ms after the press. **Anyone not invincible** can be lifted (it was knocked-out fighters
   only). **No timed release** (`HOLD_MAX` 2.5 s is gone): the carrier drops what it holds when hurt or dead.
7. **Carrying**: walk speed only. A carried fighter can punch and light a bomb.
8. **Throws** use the engine's force and duration. A bomb lands 3.2 m away from a standing throw; the old throw was
   about twice as strong. A thrown fighter goes only 0.7–1.8 m. The carrier's full velocity is added (it was half).
   There is no tuned knock-out for a thrown fighter. The throw is weaker within 500 ms of the pick-up (unchanged).
   The "pro trick" backward lob is ported.
9. **Bombs** are 0.3 m (were 0.24), almost do not bounce, and **roll far** (about 3 m after landing). They used to
   stop in about 0.3 s.
10. **Blasts** use the engine's per-body impulse: mostly upward, with damage from the summed bodies.
11. **Impact damage** on hard landings ([A], above). It was not ported before.
12. **Impact bombs** arm 0.2 s after they are made (was 0.25 s after the throw).
13. **Sizes**: the fighter's ball is 0.3 (was a 0.36 capsule) and its height is 1.16 (was 2.0). It is drawn about
    1.26 m tall with a bigger head (`body.ts` `SCALE`, `HEAD_GROW`). The crate is 0.7.
14. The follow camera, above.

## The feel test

Run in `web/`: `node --import tsx src/games/blast3d/feel.ts`.

- "Source" is an independent copy of the engine's per-step formulas at its own 8 ms, with the raw factors, or the
  engine's formula itself. It is a reduced model, not ODE.
- "Ours" is the game as the TV steps it.

| measure | source (125 Hz model) | ours (60 Hz game) |
|---|---|---|
| walk top speed (m/s) | 2.30 | 2.30 |
| run top speed (m/s) | 6.45 | 6.45 |
| time to 90% of run speed (s) | 2.85 | 2.85 |
| time to 90% of walk speed (s) | 0.088 | 0.100 |
| walk: turn 180° (s, facing within 10°) | 0.056 | 0.067 |
| run: stick reversed, heading past 90° (s) | 0.50 | 0.50 |
| run: stick reversed, going back at 2 m/s (s) | 0.59 | 0.60 |
| jump: feet apex (m) | 0.54 | 0.51 |
| jump: airtime (s) | 0.43 | 0.42 |
| jump: rebound hop after landing (m) | 0.14 | 0.13 |
| punch, standing: damage (hp) | 0 | 0 |
| punch, at run speed: damage (hp) | 590 | 618 |
| punch, at run speed: target flies and slides (m) | 1.86 | 1.82 |
| throw bomb, standing: lands at (m) | 3.15 | 3.17 |
| throw bomb, carrier at walk speed: lands at (m) | 4.97 | 4.98 |
| throw stunned fighter, standing: lands at (m) | 0.69 | 0.76 |
| throw stunned fighter, moving: lands at (m) | 1.72 | 1.77 |
| bomb rolls on after landing, standing throw (m, until it goes off) | 3.36 | 3.20 |
| blast at 0.5 m: launch sideways / up (m/s), damage | 4.13 / 10.69, 863 | 4.13 / 10.69, 863 |
| blast at 1 m | 3.18 / 4.47, 586 | 3.18 / 4.47, 586 |
| blast at 1.5 m | 1.59 / 1.47, 267 | 1.59 / 1.47, 267 |
| blast at 2 m | 0, 0 | 0, 0 |

## Art

- All models are built in code in `meshes.ts` and are our own designs: six brawlers (a frog, a diver, a mushroom, a
  cat, a cone-head road worker, a cactus) on one 15-part rig, a wooden deck on a floating rock, comic bombs and
  crates.
- Only the fighters' overall size and head size follow Ballistica's numbers (above). No shape, texture or character
  of BombSquad's is copied.
