# Blast Party 3D: where the rules come from

The rules in `rules.ts` are ported from Ballistica (the open-source engine of BombSquad), which is MIT licensed.
Only its **rules and numbers** are used. BombSquad's characters, models, textures, sounds and maps are not open
source: none are used or recreated here (see "Art" at the end).

Source: `https://github.com/efroemling/ballistica`, commit `d6049a667286ff906406ccc7d635f3d315256df3`
(read on 2026-11-18). Line numbers below are for that commit. Paths:

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
| spaz_node.cc | `src/ballistica/scene_v1/node/spaz_node.cc` (the engine, C++) |
| rigid_body.cc | `src/ballistica/scene_v1/dynamics/rigid_body.cc` (the engine, C++) |

Marks: **[S]** a value from a script, used as it is. **[E]** a value or formula from the engine's C++ source.
**[T]** tuned here: Ballistica gets the result from its rigid-body physics (ODE, a 120 Hz ragdoll of bodies and
joints), which this game does not have. Fighters here are capsules with a 60 Hz character controller; the ragdoll
you see is drawn on top and does not feed back into the rules.

## Fighters (spaz.py)

| rule | here (`rules.ts`) | source |
|---|---|---|
| Hit points 1000 | `HP` | [S] spaz.py:67 `default_hitpoints = 1000` |
| Invincible for 1.0 s after a spawn | `INVINCIBLE` | [S] spaz.py:173–180 |
| Punch cooldown 400 ms | `PUNCH_COOLDOWN` | [S] spaz.py:25, spazfactory.py:249 |
| Punch power scale 1.2 | `PUNCH_SCALE` | [S] spaz.py:24, spazfactory.py:253 |
| Gloves: scale 1.4, cooldown 300 ms | `PUNCH_SCALE_GLOVES`, `PUNCH_COOLDOWN_GLOVES` | [S] spazfactory.py:250–256 (spaz.py:606–611) |
| Jump cooldown 250 ms | `JUMP_COOLDOWN` | [S] spaz.py:206 |
| No action while knocked out | `Game.ready()` | [S] spaz.py:344, 371, 416, 465 (`knockout > 0.0`) |
| One hit per target per punch | `punchHit()` runs once per punch | [S] spaz.py:1227 `_punched_nodes` |
| Punch lasts 35 steps of 120 Hz (0.29 s) | `PUNCH_TIME` | [E] spaz_node.cc:369 `kPunchDuration` |
| A punch is strongest 100 ms after the press | `PUNCH_HIT_AT` (the hit lands then, at full power) | [E] spaz_node.cc:2228–2240 `punch_power_` |
| Pick-up cooldown 40 steps (0.33 s) | `PICKUP_COOLDOWN` | [E] spaz_node.cc:370 `kPickupCooldown` |
| Damage = 0.22 × the impulse's magnitude | `DAMAGE_SCALE` | [S] spaz.py:893 |
| Knock-out ticks = min(26, max(k, int(raw × 0.02) − 24)), raw = damage ÷ 0.22 | `Game.knockoutFor()` | [E] spaz_node.cc:1846–1849. So a hit under ~275 hp does not stun, and ~550 hp gives the longest stun |
| A knock-out tick lasts 5 steps of 120 Hz on the ground, 10 in the air | `KNOCKOUT_PER_S` = 24 per second, half in the air | [E] spaz_node.cc:2792–2794 |
| Damage makes a fighter drop what it carries | `hurt()` → `letGo()` | [S] spaz.py:1126–1129 |
| The puncher is kicked back on the first hit | the puncher loses half its speed and most of its run-up | [S] spaz.py:1277–1290 (`mag = -400`); the amounts are [T] |
| Bomb button: lights a bomb **in the hands**; it is thrown by the next press of Bomb, Punch or Pick-up | `bomb()`, `punch()`, `grab()` → `throwHeld()` | [S] spaz.py:471–474 `on_bomb_press`, 1340–1378 `drop_bomb` + `_pick_up`; [E] spaz_node.cc:1144–1176 |
| One bomb at a time; it comes back when the bomb is gone | `bombsLeft()` | [S] spaz.py:63, 1164, 1373 |
| Throw power 0.8 × (0.6 + 0.4 × stick); weaker (0.4 → 1.0) in the first 500 ms after a pick-up | `Game.throwSpeed()`, `THROW_SOFT` | [E] spaz_node.cc:1638–1645 |
| The throw goes the way the stick points, else the way the fighter faces | `throwHeld()` | [E] spaz_node.cc:3439–3480 |

**Tuned [T]** (the engine's physics gives these): run speed `RUN` 5.4 m/s, gravity `GRAVITY` 20, jump speed
`JUMP_V` 6.6 (about 1.1 m high), the capsule `RADIUS` 0.36 and `HEIGHT` 2.0, punch reach `PUNCH_REACH` 1.15 m,
pick-up reach `PICKUP_REACH` 1.25 m, throw speeds `THROW_H` 8.2 and `THROW_V` 6.4 m/s (a full throw lands about
7 m away; a fighter or the crate is heavier and goes less far), punch knock-back `PUNCH_DV`.

**Punch damage.** In the engine a punch is a `HitMessage` with `magnitude = punch_power × punch_momentum_angular ×
110` and `velocity_magnitude = punch_power × 40` (spaz.py:1252–1270), turned into damage by
`RigidBody::ApplyImpulse` (rigid_body.cc:835–862: `total = mag + |velocity| × v_mag`), times 5 for a one-body hit
(spaz_node.cc:1810–1826), times 0.22. `punch_momentum_linear` is the puncher's speed, smoothed (spaz_node.cc:
2222–2227). So a punch hurts by how fast the puncher runs. Here: `Game.punchDamage(momentum)` =
`0.22 × 5 × scale × (40 × momentum + 50)`, where `momentum` is the fighter's speed smoothed over `MOMENTUM_TIME`
0.5 s and cut to `PUNCH_RECOIL` 0.2 after a punch lands. The smoothing time, the recoil and the `+ 50` (the spin's
share, which we do not model) are [T]. Result: a standing punch ≈ 66 hp, a full run-up ≈ 350 hp (410 with
gloves), a flurry ≈ 250 hp each.

**Not ported:** the frozen state and ice bombs, the curse, land mines, impact damage from hitting the ground or a
thrown body, being dizzy from spinning, shattering.

**The task's own rule:** only a knocked-out fighter can be picked up (in Ballistica anyone can be). A carried
fighter stays helpless, and breaks free after `HOLD_MAX` 2.5 s [T].

## Bombs (bomb.py)

| rule | here | source |
|---|---|---|
| Fuse 3.0 s (normal, sticky) | `FUSE` | [S] bomb.py:876 |
| Impact bomb: 20 s fuse; arms 0.25 s after it is let go; goes off on any touch, but not against its thrower | `IMPACT_FUSE`, `ARM_TIME` | [S] bomb.py:850, 961–972, 1085–1090 |
| Sticky bomb: sticks to what it touches | `Bomb.stuck` | [S] bomb.py:986–992 (the 0.25 s delay there is used here as the time before it may stick to its thrower) |
| Blast radius 2.0; impact × 0.7; TNT × 1.45 | `BLAST_RADIUS`, `IMPACT_RADIUS_K`, `TNT_RADIUS_K` | [S] spaz.py:200, bomb.py:339, 756–764 |
| Blast magnitude 2000; TNT × 2.0 | `TNT_MAG_K` (the 2000 becomes `BLAST_HP`, below) | [S] bomb.py:677–683 |
| A blast's force and damage fall off in a straight line to the radius | `Game.blastDamage()` | [E] rigid_body.cc:889–897 (`amt = 1 − len / radius`) |
| A blast pushes up twice as hard as sideways | `explode()` | [E] rigid_body.cc:915–919 |
| A blast sets off other bombs 0.1–0.2 s later (also the TNT crate) | `CHAIN_MIN` + random × 0.1 | [S] bomb.py:1099–1126 |
| A punch does not set off a normal bomb or TNT (it knocks it away); it sets off an armed impact bomb | `punchHit()` | [S] bomb.py:1103–1107 |
| TNT crate comes back 20 s × random(0.8–1.2) after it is gone | `TNT_RESPAWN` | [S] bomb.py:1186–1190, _gameactivity.py:1243–1251 |

**Tuned [T]:** `BLAST_HP` 1400 (hit points lost at the very centre of a normal blast; with the straight fall-off
a bomb at your feet kills, one 1 m away takes 700, one 1.5 m away 350), `BLAST_DV` 13 m/s of knock-back at the
centre, the distance being measured to the nearest point of the body's axis (the engine sums the push over the
body's parts), the bombs' bounce and roll, `BOMB_R`, `TNT_R`.

## Power-ups (powerupbox.py, _powerup.py, _gameactivity.py)

| rule | here | source |
|---|---|---|
| A box at every power-up point at the start, then every 8 s, 0.4 s apart | `POWERUP_INTERVAL`, `POWERUP_STAGGER` | [S] powerupbox.py:17, _gameactivity.py:1213–1241 |
| A box blinks from 5.5 s and is gone at 7 s | `POWERUP_FLASH`, `POWERUP_LIFE` | [S] powerupbox.py:270–275 |
| Any hit but a punch destroys a box | `explode()` | [S] powerupbox.py:319 |
| Weights: triple 3, gloves 3, impact 3, sticky 3, shield 2, health 1 | `POWER_WEIGHTS` | [S] _powerup.py:43–55 (ice 3, land mines 2 and curse 1 are left out) |
| Triple bombs, bomb kinds and gloves wear off after 20 s | `WEAR_OFF` | [S] spaz.py:21, 705–782 |
| Shield: 650 points, loses 10 every 0.5 s | `SHIELD_HP`, `SHIELD_DECAY` | [S] spaz.py:630–637, spazfactory.py:248 |
| A hit on a shield does nothing else, unless it goes more than 500 past it: then the rest spills over | `SHIELD_SPILL`, `hurt()` | [S] spaz.py:895–990, spazfactory.py:257 |
| Health: back to full | `give()` | [S] spaz.py:831 |

**Tuned [T]:** the box falls from 9 m up (the task asks for boxes from the sky; in Ballistica a box pops in at
its point), `BOX_R`.

## The mode: Elimination (elimination.py)

| rule | here | source |
|---|---|---|
| Each player has lives; a death costs one; with lives left it respawns | `die()`, `Fighter.lives` | [S] elimination.py:566–594 |
| Respawn after 3.0 s (a team of one) | `RESPAWN` | [S] _gameactivity.py:1085–1102 |
| "Who is left" is checked once a second; the last one with lives wins | `END_CHECK`, `contenders()` | [S] elimination.py:387 (`bs.timer(1.0, self._update, repeat=True)`) |

**Different on purpose:** Elimination's default is 1 life (elimination.py:227–228); the task asks for a few, so
the default here is 3 (a setting: 1, 2, 3, 5). "Best of N rounds" is not in elimination.py (Ballistica's session
counts series points across games); here a match is "first to N round wins" (a setting, default 2).
Falling off the map kills at the map's lower bound: the_pad.py `map_bounds` reaches about 5.5 m under the floor
(`KILL_Y`).

## The arena (the_pad.py)

`the_pad.py` holds only points and boxes (the map's model is an asset, not open source). Used: the play area's
size (`area_of_interest_bounds` 16.6 × 18.5 m, which gives a deck of about 15 × 14 m), the four `ffa_spawn`
points, the four `powerup_spawn` points and the `tnt1` point, moved so the deck's middle is the origin
(`ARENA` in rules.ts). Ours: four more spawn points (mirrored to the front, for eight fighters), the three
blocks, and the whole look.

## Computer fighters (spazbot.py)

`bots.ts` is written for this game. It borrows the default bot's habits: throw from 5–9 m away
(spazbot.py:94–95 `throw_dist_min/max`; here from 3.6 m), charge and punch when close (spazbot.py:89–93), and
the keenness values `punchiness` 0.5 and `throwiness` 0.7 (spazbot.py:84–85) as the middle of each bot's own.

## Art

All models are built in code in `meshes.ts` and are our own designs: six brawlers (a frog, a diver, a
mushroom, a cat, a cone-head road worker, a cactus) on one 15-part rig, a wooden deck on a floating rock, comic
bombs, crates. The rig has 15 rigid parts because a body needs them (head, torso, pelvis, two-part arms and
legs, hands, feet); Ballistica's `spazappearance.py` lists the same parts, but no shape, texture or character
of BombSquad's is copied.
