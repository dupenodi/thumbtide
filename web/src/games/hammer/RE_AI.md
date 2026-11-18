# Hammerfight computer opponents (AI), as read from the game's code

Companion to `HAMMERFIGHT_PHYSICS.md`, `RE_WEAPONS.md` and `RE_ARENAS.md`. Source: DRM-free Hammerfight v1.004
(`Hammerfight.exe`, x86, image base 0x400000), `Config.ini`, `Saves/default_profile.seria`, `Data/Levels/*.seria`.
Addresses are virtual addresses. This file describes behaviour only; it contains no game code. "INFERRED" marks a
statement that is not read directly from code or data. Times assume the fixed step dt = 0.02 s (`[0x55b670]`).
Config values are the `Config.ini` values (the exe defaults differ: `PH_THRUST_NPC` is 5e6 in the exe, 3.6e6 in the file).

## 0. Summary

- There is **one shared "brain"** for every creature (fighting machines, walking people, monsters): the Creature think
  function **0x4361c0** (vtable slot +0xf4). It runs every update and does a **utility vote** over a list of
  candidate tasks, picks the heaviest one and runs a per-class handler for its task type.
- The task handler for "attack" is per class. Two machine handlers exist:
  - **Story NPC machine** (class size 0xa30, ctor 0x4ae1f0, vtable 0x5489b0; built from a `Character` record by
    0x4a2a3b…0x4a4cf0): control 0x4ac8e0, attack 0x4ae940 → 0x4ada00, keep-distance 0x4ad780, swing 0x4ace70.
    INFERRED: these are the enemy fighters of the story, the pits and the tournaments (the class is built from the
    `Character` records; the per-level spawn calls were not mapped).
  - **Player machine autopilot** (class size 0xa68, ctor 0x4b10d0, vtable 0x548b70; "Create_player" 0x4be320):
    control 0x4b03d0, attack 0x4b0ee0 → 0x4b0070, swing 0x4afd10. It is active while the owner flag
    **`m_ai` (+0x86c)** is set: during the fly-in to the start markers (0x4b9030 → 0x4b8760), and when
    0x4b8db0 hands all registered players to the computer (INFERRED: attract/demo or end of match). 0x4b8ca0 gives
    control back (clears `m_ai`, layer 3).
  - The hot-seat Duel has **no CPU opponent** (only human players, see RE_ARENAS §4).
- The AI **does not predict** the weapon head and has **no aim model**. It spins its weapon by steering at 90° to the
  hull→weapon line (always in the weapon's current spin direction) and adds a pull toward the target. The hits come
  from the physics.
- The "personality" of a story fighter is **data, not tuning knobs**: `m_level` 1–4, the weapon, the armour plates,
  the hull sprite, the faction. There are **no aggression / courage / accuracy fields** in any file.
  The `AI_ESCAPE_RADIUS`, `AI_ATTACK_RADIUS`, `AI_AVOID_START`, `AI_AVOID_END` keys of `Config.ini` are loaded
  (0x46bbe9…0x46bcaf → 0x55b644/48/4c/50) and **never read**. `DBG_ENEMY_NUM` (0x55b620) is also never read.
- Drama comes from: random mode picks (charge / whirl / back-off), voice lines (`_engage_01`, `_attack_01`,
  `_ah_01`), a **rage mode** that the player triggers by taunting, a weapon **throw**, panic when burning, and
  speech when beaten.

## 1. The control loop (all creatures)

### 1.1 Cadence
- Think 0x4361c0 runs once per update (all timers in it use dt = 0.02 s, INFERRED from that: every frame).
- There is no reaction delay. Hesitation comes only from the vote decay (1.4) and from the random timers of the
  attack state machines (2.3, 3.3).

### 1.2 Order of one think (0x4361c0)
1. Clear the steering vector **+0x808/+0x80c** to (0, 0). The control function turns it into force (2.1, 3.1).
2. **No world** (+0x60 = 0): steer (0, 1) (fall) and stop.
3. **Stun gate:** if `stun (+0x484) > mass (+0x698) · 8e-5`, do nothing more (steering stays 0, the machine drifts).
   If at the same time health (+0x4d8) ≤ +0x4e0 (INFERRED: `health_low`) and the class flags match 0x2bf, call
   0x4ad3a0: the beaten creature says a line (2.6).
4. If the creature is outside the arena rectangle (0x469370), count up +0x770 (time outside); else reset it.
   No reader of +0x770 was traced (open item).
5. Feed the **global order list 0x56d050** (scripts put orders there) into the vote (0x436040).
6. **Sense** (0x4338d0, only while +0x344/+0x348 are not 0): for every other creature in the global list
   0x56d040 within **600 px** (`[0x55b610]` = 600), call "perceive" (vfunc +0x12c = 0x436cf0). See 4.
7. **Pick**: start from the default task (type 6, weight 0). Walk the candidate list (+0x774, 0x38-byte records).
   The first candidate with a strictly larger weight wins. The winner is copied to the current slot +0x7c0.
8. If the task changed (type, target id or point differ from the previous slot +0x788): remember the hull position in
   +0x810 (last known point), clear timers, set the attack state +0x860 to 0. A new "attack" task adds 1 to the
   target's **attacker count (+0x2c0)**; the old one subtracts 1.
9. Run the handler for the task type (switch table 0x436ca8). If the handler returns false, the candidate is deleted
   (0x434d40).
10. **Decay** every candidate: `w ← w − w·0.5·dt − 10·dt`, and delete it when `w < 0.5`. A target that is posted
    every frame with ≈ 9 (4) settles near w ≈ 880; when it is no longer posted it fades in ≈ 7–8 s
    (`2·ln(900/20.5)`). A new target must out-score that stored weight, so the AI keeps its target for seconds.

### 1.3 Task record (0x34 bytes, ctor 0x431ca0 / 0x431d20)
+0 type, +4 weight, +8 vote category, +0xc int, +0x10 target reference, +0x28 point, +0x30 flag.
Vote (0x436040): `added weight = weight × clamp((relation[self faction][category] + 30) · 0.01, 0, 1)`; the same
task (type, target, point) adds to the existing weight. Relations: see 5.2.

### 1.4 Task types
| type | handler | meaning |
|---|---|---|
| 0 | 0x436801 → vfunc +0xf8 | **Attack** the target. Keeps the last seen point (+0x810). Line of sight test 0x432080. If the target is not seen for **7 s** (+0x87c), the task is dropped. Sets the per-frame "blackboard" globals: 0x55d720 = vector to the last seen target point, 0x55d708 = its length, 0x55d714 = target, 0x55d718 = the target's main weapon (last entry of its held list +0x8e0), 0x55d710 = that weapon's speed, 0x55d738 / 0x55d70c = vector / distance to that weapon. |
| 1 | 0x4366ad → vfunc +0xfc | Go to / follow the global object 0x56d820 (set by story scripts, INFERRED: the hero). NPC: 0x4ae790. |
| 3 | 0x436ae9 → 0x4344e0 | **Go to an object** (used for the fly-in to spawn markers, weight 5, category 2). When reached, the weight is set to 0. Machines get ×1.5 thrust (autopilot) or ×2 thrust (NPC) on this task. |
| 4 | vfunc +0x108 (0x4321f0) | Not decoded (Creature). |
| 5 | vfunc +0x10c | Machines: go to the level object with id 100 (0x56dd78, looked up at level load 0x509d4d). INFERRED: the retreat / exit point. |
| 6 | vfunc +0x114 (0x434d10) | Default "nothing" task. |
| 10 | vfunc +0x104 (0x434c10) | Go to the remembered point +0x810 (INFERRED: investigate). |
| 11–14 | +0x118 / +0x120 / +0x11c / +0x110 | Stubs or not decoded. |
| 2, 7, 8, 9 | – | No handler. |

## 2. Story NPC machine (class 0x5489b0) — the real enemies

### 2.1 How it moves (control 0x4ac8e0, vfunc +0x84)
- It uses the **force path**, not the player's mouse impulse. Per frame:
  `F = steer · T · f`, with
  - `T = PH_THRUST_NPC (3.6e6) · (0.8 + 0.125 · E)`; on task type 3: `T = 2 · PH_THRUST_NPC`.
  - **E = effective level** (vfunc +0xc8 = 0x432490): `E = clamp(0.7 · m_level, 1, 4) · clamp(2 · health/max_health,
    0.1, 1)`. Level 1 → 1, 2 → 1.4, 3 → 2.1, 4 → 2.8, "black" +2 levels → 4. **Below half health the machine gets
    weaker** (E falls with health, down to 10 %).
  - `f = 1 + clamp(heat/300, −0.3, 0) · clamp(1 − +0x644, 0, 1)`, **+1 while burning** (+0x65c > 0).
    INFERRED: cold slows it by up to 30 %, fire makes it race.
  - **Linear drag** `F = −v · (37800 + 4200 · E)` (task 3: −v · 42000). No quadratic drag, no speed clip found.
  - Terminal speed ≈ `3.6e6 · (0.8 + 0.125 E) · |steer| / (37800 + 4200 E)` ≈ **80–85 px/s per unit of steer**
    (E 1…4). Steering sums of 3–6 (2.3) give ≈ 250–500 px/s. A higher level gives more thrust and more drag:
    nearly the same top speed but a quicker response (time constant mass/k).
- Obstacle avoidance: 0x4332e0 writes a vector to +0x870/+0x874, added ×2 to the steering (not decoded; INFERRED:
  wall/edge avoidance). If |steer| > 1, the path is ray-tested (0x4b1cf0, length |steer|·T·3.3e-6 px) and bent
  around obstacles.
- Spin damping torque `−(2e6 + 1e6 · m_level) · ω` (Human update 0x44c947): high levels tumble less after hits.
- Entry: while +0x988 is set, it climbs (steer (0, −1.6)) or follows an entry path (0x44dbb0).

### 2.2 Low health, stun, knock-out (control 0x4ac8e0)
- **Bleeding out:** while health ≤ +0x4e0 (INFERRED `health_low`), stun grows by `500 · m_shock_value · dt`
  per frame (0.02 → +10/s) and 0x44cd20 runs (INFERRED: smoke/spasm). With the stun gate (1.2 step 3) the
  machine soon stops steering and is then knocked out.
- **Knock-out** (0x404700): `stun > (0.6 · inside_rect + 0.3) · CRITICAL_SHOCK` → **`m_ai` is cleared** (INFERRED:
  the brain stops for good; no code that sets it again for this machine was found).
- **Rage shakes off stun:** if the machine is stunned while enraged (2.5), the stun is reset to 0.2 each frame.

### 2.3 Attack (vfunc +0xf8 = 0x4ae940)
Gate: no target, or **hull spin |ω| > +0xa1c** (default **6 rad/s**; one MELKA-pit fighter gets 300 = never) →
steering 0 (it waits until it stops tumbling). On a new task: **20 %** chance of the `<voice>_engage_01` line
(0x437be0). Burning (+0x65c > 0, INFERRED: on fire): panic 0x4ae580 (as 3.4). Rage check (2.5).
`m_tactics` checks (5.3). Then the state machine in +0x860 (table 0x4aeef4), timer +0x868 (counts down by dt each
frame, and by a second dt while engage runs inside the far range, 0x4adb9b):

| state | name | behaviour |
|---|---|---|
| 0 | start | → 3 with timer **4–6 s**, sub-mode +0x864 = −1. |
| 3 | **engage** (0x4ada00) | Main logic, below. **When the 4–6 s timer runs out (2–3 s of real time while inside the far range), or engage fails → 1 with timer 2–3 s**, whether the attack worked or not. |
| 2 | **charge** | Steer straight at the target, gain **3 · rage**. Ends when the target is within 500 px or the timer ends → 3. |
| 4 | **whirl** (0x4adf20, gain 5) | Swing hard in place (no pull). May **throw** (2.7). Rage ≥ 1.5 or timer end → 3. Fails → 1. |
| 1 | **back off** (0x4ad780) | Keep distance, same 250 px ring logic as 3.2 state 1 (gain 5 when the target has class flags 0x7f, else 3; INFERRED: 0x7f = machine). Rage ≥ 1.5 → 3 at once. **Target stunned (stun +0x484 ≠ 0, 0x4ad7ca) → 3 at once with a new 4–6 s timer** (checked 2026-11-18). Timer end: weapon → 3, **no weapon → 7** (5 s). |
| 7 | **retreat** | Task-5 handler: go to the level object id 100. |
| 9 | **special** (0x4adf90) | Uses the item from the second list +0x8c0 (0x4ad700, 0x422aa0; INFERRED: bomb/gun) at ~1 % per frame within 200 px; cooldown **10 s** (+0xa28). |

Engage (0x4ada00), per frame:
1. **Threat check** 0x4ac210 (decoded 2026-11-18): `r = max(1, 0.35 · enemy weapon speed)`. (a) If the enemy's main
   weapon, predicted 3 frames ahead, is within **50 px** of the hull's edge (and +0x430 ≤ 1), it sets +0x428 and
   +0xa08 = 0.3 s and returns true (meaning of the two fields not decoded). (b) Else, if the weapon is within `r` px,
   it steers **away from the enemy weapon**: `steer = −(weapon − hull)/d · 3 · clamp(1 − d/r, 0, 1) · gain`, and sets
   +0x8a0. (Corrects the earlier "straight at the weapon": 0x55d738 is written at 0x4369ec as weapon − own hull, and
   0x4ac393 negates it.) When the threat has just passed, the next push is doubled (counter-lunge).
2. No weapon → state 1, return false.
3. Ranges from the gap `d = distance − target radius`: far = **500** / near = **100**; for weapons with the lock
   bits 0x20a00 (+0x6e8) or 0x2 (+0x6ec) (INFERRED: long weapons) far = **550** / near = **150**.
4. `m_tactics & 0x8000` (set on every NPC by the ctor): if 200 < d < 400, 10 s passed since the last special and an
   item is in +0x8c0 → state 9 for 4 s.
5. **d ≥ far:** if the threat just passed → swing 2·rage + pull 3·rage. Else one random pick that leaves state 3 at
   once: if the target is a machine that is not itself in "whirl", **10 % → whirl (state 4) for 1–2 s**; otherwise
   (90 %) **charge (state 2) for 2–3 s**.
6. **near ≤ d < far:** pick a sub-mode once per engagement (+0x864, random 0/1, each with an `_engage_01` line):
   - mode 0 "wind up and close": swing gain 2·rage, pull 4·rage².
   - mode 1 "all-in": swing gain 3·rage, pull 6·rage.
7. **d < near:** swing gain 4·rage; if the weapon is still slow it swings again (gain ×2 in total); when it is fast it
   also pushes in with 2·rage (INFERRED reading of the return value of 0x4ace70 as weapon speed).

### 2.4 Swing driver (0x4ace70; same logic as the autopilot's 0x4afd10)
- Main weapon = the **last** entry of the held list +0x8e0. `u` = unit vector hull → weapon. The current spin
  direction `s = sign(u × v_weapon)`.
- Weapon speed **≥ 200 px/s**: steer = `u` turned by `s · 90°`, × gain. It keeps pushing the weapon round the way it
  already goes.
- **< 200 px/s (wind-up):** a sweep value (+0xa00, ±1, changes by ±0.02 per frame and turns round at the ends)
  picks the push side. INFERRED: the preferred wind-up direction flips about every 2 s, so a stalled AI rocks the
  weapon back and forth until it gets going.
- Weapon speed **> 300 px/s** and weapon direction within **cos 0.9** (≈ 26°) of the target: event 0x483b40 type 0x6a
  (INFERRED: crowd/sound "big swing"); the NPC version also has a 1 s global cooldown effect (0x56144c).
- There is no prediction of where the head will be, no lead, no timing to the target's speed.

### 2.5 Rage (player taunt → enemy rage)
- The player's machine has a taunt meter +0x880 (0…2). With `GAME_JOKER=true`, shaking the mouse left-right fast
  (dx flips past ±10 between frames while |dy| < 200, 0x4b0a00…0x4b0a98) adds 0.4 to +0x884 (decays 1/s). When
  +0x884 passes 0.5 the machine laughs: `joke2` sprite, `haha_01` sound, +0x884 set back to 0.5, and the meter +0x880
  gets one frame of +10·dt = **+0.2 per laugh** (0x4b1b6a…). The meter is capped at 2 and decays 0.5/s, so about
  three quick laughs are needed to reach rage.
- An NPC that attacks this player reads it: `rage = 1 + clamp(taunt, 0, 0.6)` (0x4aea76, 0x4ac96e).
  - rage ≥ 1.5 → **enraged**: `thunder` sprite/sound, `Media/Particles/rage.psi`, `<voice>_ah_01` (0x437f40), flag
    +0x888. It stops backing off and whirling (states 1 and 4 go straight to 3), all charge/pull gains are ×rage
    (up to ×1.6, pull ×2.56 in mode 0), and stun is reset to 0.2 each frame.
  - rage < 1.5 → the effect ends (sprite restored).

### 2.6 Speech and taunts
- `<voice>_engage_01` (0x437be0): 20 % on a new attack task, and on each sub-mode pick. `<voice>_attack_01` (0x437d90,
  autopilot): 20 % on a new attack task. `<voice>_ah_01`: rage; `war_ah_01`: 5 %/frame while burning.
  Each has a 20 % chance of an extra speech bubble/line (0x425a80, 0x4371f0).
- Beaten (stunned and health ≤ +0x4e0): 0x4ad3a0 says a line chosen by `m_mantype` (+0xa10) with probability
  `1 − m_talkative` per frame (default 0.99 → **1 % per frame**); +0xa18 (default 2) INFERRED: lines left.

### 2.7 Weapon throw (0x4ad220, called from whirl)
In whirl, if the level is **not** `ENV_EXTERNAL` (0x56dd24; arenas, pits, halls — not the 28 outdoor story levels),
**(number of held items in +0x8e0) × (main weapon speed) > 500 px/s** (literal test; with one item: speed > 500), and
the weapon velocity points at the target within **cos 0.995** (≈ 5.7°):
the NPC **releases the weapon** (0x44ed20) and adds a push of 3e8 along its velocity. Then it has no weapon →
back off → seek a weapon / retreat.

## 3. Player-machine autopilot (class 0x548b70)

### 3.1 How it moves (control 0x4b03d0 → 0x4b03e0, AI branch at 0x4b053a)
- `F = steer · 1.61 · (0.25 · m_level + 0.75) · PH_THRUST_NPC`, ×1.5 on task type 3. No input cap (the player path
  caps |F|·dt ≤ 8e6). Created with m_level 4 → 1.75.
- Then the shared tail: quadratic drag `−PH_RESIST_PC (300) · |v|² · v̂`, and the speed clip `GAME_SPEEDCLIP_MOUSE`
  (350) if +0xa50 = 1 (mouse) else `GAME_SPEEDCLIP_PAD` (200), × clamp(1/TIMEWRAP, 1, 4).
- So per unit of steer: Δv ≈ 3 px/s per frame (hull 66 000), terminal ≈ 183 px/s; steer 3 → 316; 5 → 408 (then the
  clip).

### 3.2 Attack (0x4b0ee0)
Gate: no target or |ω| > 6 rad/s → steering 0. New task: 20 % `_attack_01`. Burning → panic (3.4).
States (+0x860, table 0x4b10ac), timer +0x868:
| state | behaviour |
|---|---|
| 0 | → 3 |
| 3 (0x4b0070) | Threat check 0x4af170 (enemy weapon within `speed · 0.2 s` → steer straight at that weapon, unit gain, flag +0x8a0; literal reading, intent INFERRED). No weapon → state 1 with 2 s. **Farther than 400 px + target radius**: one random pick that leaves state 3 at once: if the target is a machine not in state 4, **5 % → whirl (state 4) 1–3 s**, else (95 %) **charge (state 2) 1–3 s**. **Within that range**: below 50 px, 10 % → back off (state 1) 1–3 s; below 200 px swing gain 3 + pull 1.5; from 200 px out swing gain 0.5 + pull 1; +pull 2 right after a threat passes. |
| 2 | Charge: unit steer at the target; ends at < 200 px or timer → 3. |
| 4 (0x4b0320) | Whirl: swing gain 5; throw check (2.7); timer → 3. |
| 1 (0x4afa40) | No weapon: seek the **first visible loose weapon** (0x4af090, class 0x281f, no owner), steer ×2 at it. Else threat check, then hold a **250 px ring**: inside, back off along a spiral (away, turned 90°, gain up to 3·(250/d)); outside, approach with gain `clamp(d·0.004, 0, 1)`; all ×0.5. Timer end: weapon → 3; **no weapon → 7** (retreat). Own speed < 50 → 3. |
| 7 | Go to level object id 100. |

### 3.3 Fly-in to the start markers
The arena scripts call 0x4b9030(fighters, markers, 5.0, 2) every frame: fighter i gets marker i (round robin), and
0x4b8760 posts a task 3 (go to marker, weight 5, category 2) when farther than **80 px**. These are spawn
markers, not patrol way points (corrects RE_ARENAS §2 "INFERRED: AI way points").

### 3.4 Panic when burning (0x4b0d40; NPC 0x4ae580)
While +0x65c > 0 (INFERRED: burn timer; it sits in the heat block +0x648…+0x680): let go of grabbed items, steer
along its own velocity turned by ±1.3 rad, gain 4 (wild loops), `war_ah_01` at 5 %/frame. NPCs also get +1 thrust.

## 4. Target choice
- Perceive 0x436cf0 for each creature within 600 px: skip it if vfunc +0xb4 (0x404860) says it is not hostile
  (`relation < −50`), or if its **stun ≥ 50** (heavily stunned enemies are left alone; the player's stun is clamped
  to 1, so the player is always a target).
- Weight of the "attack X" candidate per frame:
  `0.3 · X.+0x44c · crowd(X) · clamp(1 − 0.5 · d/800, 0, 1)` (0.3 from the vote, 5.2).
  - +0x44c = how attractive X is (Creature default **30**; 50 for one spawn at 0x4476fb).
  - `crowd(X) = clamp((2 − attackers(X)) / 2, 0, 1)` (0x431c60 with 2.0). The count +0x2c0 includes the attacker
    itself (it is raised when the attack task starts, 0x43652f). So a free target scores 1, the own target with no
    other attacker scores 0.5, and a target with two attackers scores 0 for everybody. INFERRED effect: a third
    creature never chooses that target; a pair on one target only lives on its stored weight (≈ 7 s) and splits up
    when another hostile is in range.
  - So: the nearest, least crowded hostile wins; the accumulation and decay give hysteresis (no flicker).
- Coins: no coin-seeking task exists. AI machines collect coins only by touch, and only coins slower than 500 px/s
  (RE_ARENAS §3).
- Other items: only "seek a loose weapon" (autopilot state 1) and the NPC special item (state 9). No shield use found.

## 5. Per-fighter data ("personalities")

### 5.1 Character records (`Saves/default_profile.seria`, serializer 0x431100…0x4316b0)
Fields: `m_id`, `m_name`, `m_prefix` (title), `m_fuseliage` (hull sprite), `m_portray`, `m_belongs` (faction →
+0x324), `m_level` (→ +0x4d0), `m_weap1..3` (item ids), `m_plates` × `m_plates_type` (armour items), `m_flag1..3`
(item ids, INFERRED banners/decor), `m_relation`, `m_tembr` (voice pitch), `m_genre` (gender), `m_human` (pilot
sprite). Not present in the file but read: `m_mantype` (→ +0xa10, speech set), `m_talkative` (→ +0xa14),
`m_voice`, `m_color`, `m_scale_x/y`, `m_prop`, `m_type`.
The builder adds level-dependent decoration for `copter_scum` hulls (level clamped 1–4) and sets the bounty value
+0x328 = clamp(100 · level, 100, 300) (INFERRED: from the pre-set level).
Weapons go through the item factory 0x486ff0 (ids 99–245). **Ids 69, 70, 86 and plate types 54, 58, 62 are below
that range and give no item** (the factory returns null), INFERRED: those characters fight unarmed in this build or
get their weapon from a script.

Names are Russian in the file; transliterated here. Weapon names from RE_WEAPONS.

| id | name, title | hull | faction | level | weapon | plates × type | relation |
|---|---|---|---|---|---|---|---|
| 1 | Akil, chief | scum | 2 | 4 | 202 hammer_iron | 3 × 190 | 80 |
| 2 | Asim, hunter | scum | 2 | 3 | 201 hammer_kolotun | 1 × 184 | 80 |
| 3 | Khalim, youth | scum | 2 | 1 | 199 mace_stone | 0 | 90 |
| 4 | Navin, chief | scum | 2 | 3 | 69 (none) | 1 × 54 (none) | 90 |
| 5 | Vasanta, chief's daughter (female) | scum | 2 | 2 | 69 (none) | 1 × 54 | 90 |
| 6 | Melekh, teacher | scum | 2 | 4 | 69 (none) | 1 × 54 | 90 |
| 7 | Khasad, warrior | scum | 2 | 4 | 69 (none) | 1 × 54 | 90 |
| 8 | Khumid, master of the royal hunt | scum | 6 | 4 | 69 (none) | 1 × 54 | 50 |
| 9 | Amar, Gayadzhava Ganesh | knight | 3 | 4 | 202 hammer_iron | 6 × 190 | 20 |
| 10 | Melka, senehirim | silver | 3 | 2 | 70 (none) | 4 × 62 | 20 |
| 11 | Dinesh-Mel-Lakhim, decurion | scum | 2 | 3 | 220 axe_eclips | 6 × 190 | 80 |
| 12 | Kadish, senehirim | knight | 4 | 3 | 236 imperia_blade | 6 × 195 | 80 |
| 13 | Bharat-El-Maravi, senehirim | knight | 4 | 4 | 236 imperia_blade | 6 × 195 | 80 |
| 14 | Daud Dayarad, seneschal | knight | 4 | 4 | 235 liberia_blade | 6 × 195 | 80 |
| 15 | Asha-Mel-Khab, seneschal | knight | 3 | 3 | 223 axe_berdish | 6 × 190 | 80 |
| 16 | Guzar-Bedzhai, seneschal | knight | 3 | 3 | 220 axe_eclips | 6 × 190 | 80 |
| 17 | Mel-Shankara, jarkhana | knight | 3 | 3 | 230 saian_blade | 4 × 195 | 30 |
| 18 | Burzai Khatun, warrior | grunt | 3 | 3 | 221 axe_bagor | 6 × 190 | 30 |
| 19 | (no name), "leader 2" | grunt | 3 | 3 | 86 (none) | 3 × 58 | 30 |
| 20 | Ibrakhim-Mel-Shi | knight | 3 | 4 | 234 silver_blade | 6 × 195 | 30 |
| 21 | Dzharkhu-Mel-Kausalya, seneschal | knight | 3 | 4 | 236 imperia_blade | 6 × 195 | 30 |
| 22–25 | First … Fourth warrior | knight | 3 | 3 | 226 claw_blade | 4 × 190 | 30 |
| 26 | Dzhayant-Mel-Rakhim, chief | scum | 2 | 4 | 203 hammer_klevec | 4 × 190 | 80 |
| 27 | Makhmud | scum | 6 | 4 | 69 (none) | 1 × 54 | 50 |
| 28 | Fortress commander | scum | 6 | 4 | 69 (none) | 1 × 54 | 50 |
| 29 | Farukh, overseer | scum | 0 | 3 | 203 hammer_klevec | 0 | 50 |

`m_relation` (20–90): readers not traced (INFERRED: attitude to the hero for dialogue). `m_tembr` 1.1–1.3 on some.
Script tweaks seen: one MELKA-pit NPC gets spin tolerance 300 (0x4e9a1d); a "black" variant adds **+2 levels**
(0x4bb6c2).

### 5.2 Factions (`m_relations`, 8×8, row = self, column = other; hostile if < −50)
| self\other | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|---|---|
| 0 | 100 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| 1 | 0 | 100 | −100 | −100 | −100 | −100 | −100 | −100 |
| 2 | 0 | −100 | 100 | −100 | −100 | −100 | −100 | 100 |
| 3 | 0 | −100 | −100 | 0 | 100 | 100 | 100 | −10 |
| 4 | 0 | −100 | −100 | 100 | 0 | 100 | 100 | 0 |
| 5 | 0 | −100 | −100 | 100 | 100 | 0 | 100 | −30 |
| 6 | 0 | −100 | −100 | 100 | 100 | 100 | 100 | −30 |
| 7 | 0 | −100 | 100 | −10 | 0 | −30 | −30 | 0 |
Faction 1 is hostile to everyone (INFERRED: monsters, `belong324 = 1` in the monster factories). Column 0 = 0 gives
the attack vote its factor 0.3. **Faction 7 is the player side**: Create_player sets it (0x4be3bb), and so does the
builder at 0x4a1338. Note that 7 is hostile only to 1 (monsters): the factions 3–6 of the knights are not hostile
to the player by this table (−10, 0, −30), so story fights must change factions or post orders by script
(INFERRED; the script side was not traced). Players in a hot-seat duel are all faction 7 and never targets of each
other's autopilot.

### 5.3 `m_tactics` (Creature +0x6c0) bit field
- Machines: NPC ctor sets **0x8000** (special item use, 2.3 step 4). Bit **0x100** (NPC attack): ray test toward the
  target point (mask 0x400, 1500 px); if blocked, steering 0 (INFERRED: "hold position when there is no clear
  path"). Bit **0x80**: the same ray without the stop. Bit **0x40 / 0x4000**: glow colour 0xffb71600 / 0xff2e8d00
  (INFERRED: attack glow). Bits 0x1, 0x2, 0x4, 0x10, 0x20, 0x200, 0x400, 0x800, 0x1000, 0x2000: tested in the
  walking-creature behaviours 0x4327a0, 0x432a40, 0x432f9b…0x4331c7, 0x433cd0…0x4344ba; meaning **not decoded**.
- Monster factories (own classes, spawned by level scripts; AI handlers not decoded here; names INFERRED from the
  sprite strings in each factory):
  sophit 0x46e0c0: 0x58 / 0x5a / 0x5c; robot 0x46fc80: 0x11a; robot 0x470920: 0x111a; black robot 0x471220: 0x212c;
  krank 0x4728e0: 0x359; cart 0x473120: 0x1110 / 0x100; bee 0x473ca0, 0x474320: 0x20; 0x474a30: 0x120;
  worm 0x475160, armoured worm 0x4755f0: 0x20; saw copter 0x478300: 0x400; cannon 0x4bb060: 0x100;
  krank 0x4bb9b0: 0x11a; can cannon 0x4bbe80: 0x892; scripts 0x4ca53f, 0x4f2e7c: 0x4400; 0x4f8bdf: 0x100.

## 6. What makes it look fair or dramatic
- **Randomness**: one pick of charge vs whirl when far (95/5 autopilot, 90/10 NPC), a coin-flip sub-mode in mid
  range, 1–6 s random timers, a wind-up direction that flips about every 2 s. The AI commits to a plan for seconds,
  so it can be read and punished.
- **Attack rhythm (NPC)**: an attack window of 4–6 s (about 2–3 s once in range), then 2–3 s of backing off to a
  250 px ring, then again — unless it is enraged.
- **No prediction, no perfect aim**: it only spins and pushes; a whirl can miss.
- **Waits when tumbling** (|ω| > 6 rad/s) and freezes when stunned beyond `mass · 8e-5`.
- **Leaves stunned victims** (stun ≥ 50) and **no third attacker joins a target with two**.
- **Gives up a lost target after 7 s**, backs off to a 250 px ring after each attack window, retreats when unarmed.
- **Gets weaker when hurt**: below half health its effective level (thrust, responsiveness) falls with health.
- **Throws its weapon** in a lucky whirl — spectacular, and then it is unarmed (a window for the player).
- **Taunt → rage**: the player chooses to make it angrier (faster, no backing off) for more risk and spectacle.
- **Voice**: engage/attack shouts (20 %), pain/rage shouts, burning screams, last words when beaten.

## 7. Not found / open
- Handlers of task types 4, 10–14 and Creature bits listed in 5.3; avoidance 0x4332e0; entry path 0x44dbb0.
- The exact threat formula of 0x4ac210 (0.35 factor, 3-frame look-ahead, 50 px) is summarised, not fully traced.
- Readers of +0x770 (time outside the rectangle) and of `m_relation`.
- Which Character ids each level script spawns, and which level scripts call Create_player 0x4be320 (12+ call
  sites in the script function 0x4c0ec0) versus the Character builder. (0x4a9450 is a generic class-clone factory,
  not the Character spawn.)
- Whether the held list +0x8e0 also holds armour plates (it would change "main weapon = last entry" and the throw
  test).
- Monster AI classes (sophit, bee, worm, robot, krank, saw) — only their factory `m_tactics` values are listed.
- The speed clip / drag for the NPC class comes only from the control function above; a further clip elsewhere was
  not searched.

## 8. Ideas for our bots (`bots.ts`)

What was built from this (the attack rhythm, a thumb's tilt, before/after numbers): `BOT_AI.md`.

Our bots already give pad-like input through `seek()` → `arena.pushRaw` (≤ 100 units). Keep that limit (fair), and
change the decision layer:

1. **Utility target choice** (4): each 0.1 s score enemies by `attract · crowd · (1 − d/1600)`; `crowd` = 1 / 0.5 / 0
   for 0 / 1 / 2 bots already on that enemy; keep a decaying score per enemy (`w -= w·0.5·dt + 10·dt`) so targets do
   not flicker. Skip enemies that are heavily stunned. This replaces "nearest enemy" in `driveBot`.
2. **State machine per bot** (add `state`, `timer`, `subMode` to `Bot`): engage window 4–6 s → back-off ring
   2–3 s → engage …; inside engage: far → one pick charge (90 %, 2–3 s) or whirl (10 %, 1–2 s); mid range →
   coin-flip sub-mode; no weapon → seek weapon, then retreat.
3. **Swing driver** (2.4) instead of the fixed 90 px orbit: push at 90° to the hull→head line in the head's current
   spin direction; below 200 px/s rock with a 2 s sweep. Add a pull toward the target with the gains of 2.3
   (swing 2–4, pull 3–6). Convert the "steer" sum into a desired velocity for `seek()`.
4. **Ranges by weapon**: far/near 500/100, long weapons 550/150 (our px scale may need ×k).
5. **Threat reaction**: if the enemy head will reach us within 0.2 s, step toward the enemy pivot (inside the arc),
   then lunge ×2 when it has passed.
6. **Throw** (2.7) only in whirl, (held items × head speed) > 500 px/s and aimed within 6°; afterwards seek a loose
   weapon. Gate it by arena like `ENV_EXTERNAL`.
7. **Rage**: map a phone "taunt" button (or a wiggle gesture) to a laugh that adds 0.2 to the player's taunt meter
   (cap 2, −0.5/s); bots attacking that player scale gains by `1 + min(taunt, 0.6)`, skip back-off/whirl at ≥ 1.5,
   shake off stun, and show a rage effect.
8. **Personalities = level + loadout** (5.1):
   - From the original: effective level `E = clamp(0.7·L, 1, 4) · clamp(2·hp, 0.1, 1)` → thrust `0.8 + 0.125·E`,
     drag `37800 + 4200·E`; spin damping `2e6 + 1e6·L`; weapon and plates from the Character table (e.g. Khalim:
     level 1 mace; Akil: level 4 iron hammer with 3 plates; Kadish / Bharat / Dzharkhu: imperia blade with 6 heavy
     plates; the four warriors: claw blade); ranges by weapon class.
   - Our own additions (not in the original): reaction delay, swing-gain scale, whirl chance, back-off time, rage
     threshold, talkative.
9. **Fair limits**: wait while tumbling (|ω| > 6 rad/s), freeze while stunned, give up a target after 7 s out of
   sight, no third bot on a player, weaker below half health, and keep the pad-input cap so bots never exceed human
   speed.
10. **Barks**: engage/attack lines at 20 % on target change, rage shout, last words when knocked low.
