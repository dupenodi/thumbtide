# Guns in Hammerfight v1.004 and in Rotor Brawl

Source: `Hammerfight.exe` v1.004 (x86, base 0x400000), `Objects/Weapons/gun_blade.seria`, `tribun.seria`,
`Demo/pishal.seria` (PC + broad blade + mortar), the item factory 0x486ff0, and a full disassembly (session scratchpad).
All addresses are virtual addresses. "PROVEN" means read in the code; "INFERRED" means the code does not show it
directly; "OURS" marks a port value or rule that is not in the original. Spot-checked again for this doc (2026-11-17):
the bullet constructor 0x41a31a (7 × 7, density 200.0, +0x70 = 0.5, `m_explosive_type` = 0x6c at 0x41a38f), the
`m_collisions` count-down 0x415159–0x41517e, the kill call 0x41536a, the sharpness reset 0x4153c8, and the mortar's
`addForce` (vfunc +0x9c) at 0x419902.

Sections 1–7 are the original game. Section 8 is the earlier note on the mount and the aim (it was GUNS_RE.md).
Section 9 is what the port does and why. Section 10 lists the open points.

Field offsets: +0x320 `m_meta`, +0x36c `m_layer`, +0x378 `m_collisions`, +0x394 `m_sharpness`, +0x3b0
`m_explosive`, +0x3b4 `m_explosive_timer`, +0x3b8 **`m_explosive_type`** (the bullet writes 0x6c here; `m_arm`
is +0x458), +0x698 mass, +0x6a8 `m_fCoR`, +0x6b8 `m_type`.

`m_meta` bits (a survey of 93 .seria files; the material names are INFERRED from sprite names): 1 = stone (walls),
2 = wood (the PC hull has 0x42, so it counts as wood), 4 = metal (every weapon and gun), 0x800 = projectile.

Fire switch: table 0x41c0dc, index `m_arm` − 0x60: 0x6c bullet → 0x41a1f7, 0x6d mortar → 0x41941f, 0x64 heavy mortar
→ 0x41acf3, 0x65 launcher → 0x418627.

## 1. Summary

| Question | The original | The port (section 9) |
|---|---|---|
| Bullet on a machine hull | Generic damage, about **155** at 2000 px/s (2 bullets kill: health_low), a full stun; the bullet dies | 3 damage, push 40 px/s, spent (OURS sizes); at health_low it is lethal, as in the exe |
| Rocket on a held weapon | Takes no damage, so it bounces and flies on | Bounces and flies on |
| Tribune's back blade | A blade (sharpness 5) with a gun; no impaling; can't break | The same |
| Bullet on a weapon or gun | Ricochets at **half speed**, sharpness drops to 1; the gun has health 1e8 | Spent at once: push on the part, a spark |
| Bullet on a wall | Stone: ricochet at half speed (dies below 200 px/s); wood: dies | Bounces (CoR 0.3) up to 2 contacts |
| Mortar | 5 bullets with `m_collisions` 5, ±0.2 on each axis | 5 balls; spent on any machine |
| Recoil | Mortars only: the full shot momentum as one force on the **gun body**; arquebus none; launcher none | 0.5 × the shot's push, 70 % hull / 30 % gun; launcher none |
| Gun weight | Only physics (mass on its rod): mortar 5 500, heavy 7 700, launcher 14 300, arquebus 22 379 | Mortars and launcher made heavier (OURS) |
| Gun durability | None: health 1e8, mount life 1e6; a gun can only be disarmed like any weapon | Breaks off after about 4 hard blows (OURS) |
| Gun contact damage | Arquebus (sharpness 5, a bayonet edge): yes; mortars and launcher: **sharpness 0**, so no damage (they still stun and push) | None for every sidearm (OURS for the arquebus) |

## 2. A projectile on hit (generic onHit 0x414890, PROVEN unless marked)

### 2.1 The bullet (0x41a31a–0x41a38f)
- A plain Body (vtable 0x53e460, onHit 0x414890): 7 × 7, density 200, so mass **9 800**; sharpness 7, `m_collisions` 2,
  layer 3, meta 0x804, CoR 0.3 (default), +0x70 = 0.5 (not traced, see 10).
- Owner link +0x58 = the gun's owner, so a bullet is "owned" (no ×0.1 unowned cut). No `m_ttl`, no recoil, no spread.

### 2.2 What a contact does
- **Damage**: the generic damage function runs on every contact (0x415153 → vfunc +0xe4 = 0x410340): M = |P| · 1e-5,
  damage = 0.1 · sharpness · cut · M. No special shot formula; nothing scales M before the call.
- **`m_collisions`** (0x415159–0x41517e): each contact takes 1 off; at 0, `layer &= 8` (layer 3 → 0) and the shot
  collides with nothing more. Default −1 = no limit (ctor 0x413f4d). Bullets 2, mortar balls 5.
- **Projectile rule** (0x41525b–0x4153c8), when the other body has meta 0x800 and this one does not:
  - shot meta 4: sparks (particles 9 and 0x10) and sound 8;
  - victim `meta & 5 == 0` (wood: the hull, organic): the victim's `m_energy` += the shot's, and the shot is **killed**
    (SG::kill 0x509800, call at 0x41536a);
  - victim stone or metal: |v| ≤ 200 → killed; faster → it keeps its bounce and its speed is **halved**
    (prev += (pos − prev) · 0.5);
  - either way the shot's **sharpness becomes 1.0** (0x4153c8): only the first hit is sharp.
- Per target: (a) **hull**: damage, then the bullet dies; it never sticks (`m_spikeable` 0, impaling needs a weapon-class
  attacker, `m_stuck` never set). (b) **weapon or gun** (meta 4): ricochet at half speed with sharpness 1; a gun has
  health 1e8, so it takes nothing; a bullet can't disarm (5). (c) **wall**: stone → ricochet or death below 200 px/s;
  wood → death. At most one bounce: the 2nd contact sets its layer to 0.

### 2.3 Shot code in the damage function 0x410340
- 0x4104f1: victim meta has 0x200 (organic) and the attacker's `m_explosive_type` is 0x6c: × 3. Then 0x410517:
  victim meta has all of 0x1000200: × 0.25 (so × 0.75 net for those). **Only bullets** set 0x6c (not mortar balls).
- 0x41057d: a 0x800 attacker on a victim with meta 4 and 0x40: × the victim's `m_spasm_shock` (not hull meta 0x42).
- 0x410e5c: a 0x800 hit on a PC-owned target adds the damage to owner +0xa34 with a 0.5 s timer (INFERRED: a display
  counter).
- Stun is the generic rule (M > 30: stun += 0.02 · M · 0.5, clamped to 1 for the PC): a solid bullet hit is a **full
  stun**.

### 2.4 Expected bullet damage on a PC hull (formula value, contact path 0x405120–0x405143)
Reduced mass 9 800 · 66 000 / 75 800 = 8 533; P = 1.3 · v_n · 8 533. Head-on at 2000: P = 2.22e7, M = 222, **damage
int(0.1 · 7 · 222) = 155** (128–182 with the hull moving at its 350 clip). The hull gets about 2.22e7 / 66 000 ≈
**340 px/s**. Damage ≥ 12 whenever v_n ≥ about 155 px/s. Nothing scales this for the PC (setHealth 0x4af240 skips only
when the byte 0x55f6f4 is set, INFERRED god mode; base 0x406a70 skips when +0x4e4 is set). The health_low rule
(Body default 12; `pishal` hull 3.6) means **2 bullets kill a player**. The low-health "stun kill" (0x4107b3) needs a
weapon-class attacker, so a bullet can't use it. After a ricochet (sharpness 1, half speed) a bullet does about 0.1 · M.
The fast-body sweep path was not traced separately.

### 2.5 The rocket (launcher 0x418627)
- A plain Body 15 × 7, density 200 (mass 21 000), meta 0x2000000, layer 1, sharpness 1; health 5 (0x404690(5));
  `m_explosive` 1700, `m_explosive_timer` 30, `m_explosive_type` 4; `m_dump` = 5 · mass (drag −5 · m · v).
- It starts at rest. Forces 0x408123: thrust mass · 2000 along its heading with a small random drift; terminal speed
  about 400 px/s; gravity acts.
- Fuse: the base tick 0x409d92 counts the timer down; at 0, vfunc +0xbc (death 0x41e410) → explosion 0x416f60.
- It is not killed by the projectile rule. It explodes when the damage it takes reaches 5: on a hull (M ≈ 83 at
  400 px/s) and on a stone wall (M ≈ 109; below about 185 px/s it bounces). **It does not go off on a player-held
  weapon or gun** (0x410540–0x410575: a 0x2000000 victim takes 0 from a weapon-class body of a 0x1bf-class owner; a
  sharpness-0 body can't detonate it either).
- `m_explode_type` (+0x3bc) is never read (only serialized and copied).
- Explosion 0x416f60 (E = 1700), for each part of each machine and each damageable body, r = |d| + 1: health −=
  min(1/r², 1/2500) · factor · E · 30 (20.4 at r ≤ 50, 5.1 at 100, 1.3 at 200; skips explosive bodies); stun += 0.1 ×
  that; then the normal damage call with M = E / r; push F = d̂ · E · 2e6 / r for one frame (about 20 px/s on a hull at
  r = 50). No owner check (INFERRED: it can hurt the firer).

## 3. Mortar scatter (0x41941f)
- Balls = 5 · `m_arm_level` (0x4194f0); `pishal` has level 1: 5 balls.
- Each ball is a bullet (7 × 7, density 200, mass 9 800, sharpness 7, meta 0x804, layer 3) except **`m_collisions` 5**
  and **no `m_explosive_type`** (no ×3 on organics).
- Speed: dt · 2000 = 40 px a frame along dir + (rand ±0.2, rand ±0.2), not normalized: about 2000 ± 400 px/s, spread
  about ±11°. `m_extra_stvol` fans the barrels over 60° (0x419433). A (1 − [esp+0x60]) term is not decoded.
- After contacts, the bullet rules: dies on wood or a hull; on stone or metal bounces at half speed above 200 px/s,
  sharpness 1 after the first hit; layer 0 at the 5th contact. Ball against ball: both 0x800, so no kill, but the count
  goes down. Two solid balls kill a PC.
- **Heavy mortar** (0x41acf3): one "mortar_ball" of the **Item** class (vtable 0x53f5a8, onHit 0x420ca0, ctor 0x4236c0):
  13 × 13, density 200, mass 33 800, 1500 px/s, meta 4 only (never absorbed), sharpness 2, `m_collisions` 10, `m_ttl`
  30 s. Because its onHit is 0x420ca0, the clash event can fire from it (INFERRED: it can knock off plates or disarm).

## 4. Recoil (on the gun body PROVEN; the effect on the hull INFERRED)
- **Arquebus and tribune** (0x6c): no force call in 0x41a1f7–0x41a54e: **no recoil**.
- **Mortar**: `addForce` (vfunc +0x9c = 0x402d50) on the **gun only**: F = −dir · (speed · dt) · Σ m_balls / dt²
  (0x419898–0x419902), the full shot momentum 5 · 9 800 · 2000 = 9.8e7 in one frame. The gun alone (5 500) would get
  about 17 800 px/s; through the rod it is shared with the hull (INFERRED about 1 300 px/s), then the 350 speed clip
  cuts it.
- **Heavy mortar**: the same at 0x41b086: 33 800 · 1500 = 5.07e7.
- **Launcher**: none. The rocket starts at rest and pushes itself.

## 5. Gun weight (mass = density × mesh area, 0x402390(w, h, density))
mortar 22 × 10 × 25 = **5 500** (`pishal` file density 21.42); heavy mortar 22 × 14 × 25 = **7 700**; launcher
44 × 13 × 25 = **14 300**; gun_blade (arquebus) .seria 4-gon, area 548 × 40.8 = **22 379**; tribune 909 × 25 ≈
22 732. Nothing else is added: `m_winded` (0x350) is 0 for all guns; `m_dump` and `m_aero` are 0; `m_softup` is not
in the gun files; the PC control code never reads mass (RE_WEAPONS.md §2). Weight acts only through physics: the rod's
mass share, gravity on the gun and the swing load. The mount's `m_fake` is 0.9 (8, 1.2).

## 6. Durability and detach
- **Guns cannot be destroyed by damage.** The factory writes no health for guns, so the Body default 1e8 applies;
  gun_blade and tribun .seria have health 9.99999e7. The mount joint has life 1e6 and no break-by-force code;
  `m_strength` only scales the correction.
- Item/Weapon onHit **0x420ca0** does not disarm by itself (a correction to HAMMERFIGHT_PHYSICS.md): when both bodies are
  owned and (|v_self| + 1)/(|v_other| + 1) > 1.5 it raises event 0x65 (0x483b40), then calls the base onHit. The
  handler is **0x4843c9** (event tables 0x485f74/0x485f40); the victim part must be weapon-class (0x281f) with a
  machine owner (0x3f):
  - victim `m_type` 0x20 (a **plate**): T = `m_overkill` · 100; M > T kills the plate (vfunc +0xbc);
  - otherwise T comes from the owner (vfunc +0xc8 plus constants, not re-read), × 0.25 at health_low (0x432ec0), then
    the disarm path 0x48474e. Rate gate 0x468f20.
- So `m_overkill` is for plates only. A gun (`m_type` 0x40) is disarmed like any weapon, by a faster owned Item-class
  body. Bullets, mortar balls and rockets are plain Bodies and can't do it; the heavy mortar ball can (INFERRED).
- Other detach: machine death 0x44ee50 (RE_WEAPONS.md §6). Readers of `m_desowning_time` not traced.

## 7. Contact damage from the gun body
- Guns use the Weapon vtable 0x54b580: onHit 0x420ca0 → 0x414890 → damage 0x410340, side sharpness 0x512ff0 =
  `m_sharpness` × sharp_u/d (+0x750/+0x754).
- **gun_blade** (arquebus): sharpness 5; top side × 0.3 (1.5) with blade 0; bottom side × 1 (5) with bladeable 1, so
  the cut factor reaches 10 on cross hits: **it cuts like a sword**.
- **tribun**: the same, but `m_spikeable=0` in the file, so it does not impale (RE_WEAPONS.md said "tribun impales";
  corrected there). The factory also writes +0x134 = 2.0 (not traced). File values: class Weapon, `m_meta=4`,
  `m_type=64`, `m_arm=108`, `m_ammoclip_size=40`, `m_sharpness=5`, `m_sharpness_u=0.3`, `m_bladeable=1`,
  `m_bladeable_u=0`, `m_spikeable=0` (`_u`/`_d` 1), health 9.99999e7, health_low 12.

### 7.1 The health_low rule and shots (0x410705–0x410847)
- The rule runs only when the victim is player-class (`[+0x20] & 0xbf == 0xbf`, 0x41070b) **and the attacker's
  `m_jaws` (+0x3ac) is 0** (0x410721–0x41072e); a biter skips it (plain subtract, 0x4107fc). A bullet has `m_jaws` 0,
  so the rule holds for shots.
- new = health − dmg. new ≤ 0: health ≠ health_low → setHealth(health_low) (0x410768); = health_low → setHealth(new),
  death. new > 0: health > health_low → setHealth(new); else the stun-kill test 0x4107b3 (stun > 0.35 · CRITICAL_SHOCK,
  dmg > 2, attacker weapon-class 0x281f or `m_spasmtype` ≠ 0) → setHealth(0); otherwise nothing.
- The explosion 0x416f60 reads the health (+0x4d8) and calls setHealth (vfunc +0xe0) itself at 0x4171ed and 0x4173ad,
  so a blast is not stopped by the rule; then it calls the damage function (+0xe4) at 0x41722d / 0x4173f3.
- **mortar, heavy mortar, launcher: `m_sharpness` 0** (factory `[+0x394] = edi`, edi = 0 from 0x487014 to 0x48b86e;
  `pishal.seria` mortar `m_sharpness=0`). Their contact damage is always 0; they still stun (M > 30) and push. (The
  port's weapons.ts has sharpness 1 for them; with the port's rule below it doesn't matter.)

## 8. Mount and aim (was GUNS_RE.md; section numbers inside refer to 8.x)

Field names come from the serializer: +0x450 `m_spasmtype` (command mask), +0x3d0 `m_spasm_dump`,
+0x3d4 `m_spasm_firestab`, +0x3dc `m_spasm_moto`, +0x458 `m_arm`, +0x45c `m_arm_level`, +0x460 `m_arm_axis`,
+0x464 `m_extra_stvol` (extra barrels), +0x468 `m_recoil_time`, +0x470 `m_ammoclip_size`, +0x47c/+0x480
`m_stvolshift_x/y` (muzzle offset). Fields with no name: +0x46c = shot timer, +0x474 = rounds in the clip,
+0x478 = aim threshold (see 2.3).

### 8.0 Summary

- **The gun is a rod weapon.** It hangs on its own type 2 rod from the hull. The rod turns the gun so that its +x
  axis points straight away from the hull centre.
- **The shot goes along the gun's own +x axis.** The player has no cursor aim and no auto-aim.
  The player aims only by moving the machine, so that the gun swings to the correct side.
- **The demo machine holds the gun opposite the main weapon.** `pishal.seria` has a type 0 distance joint between
  the mortar and the blade. Its radius is 40 % longer than the two demo rods can reach (17 % longer than the factory
  rods), so the gun is always pushed to the
  far side of the blade. Our tie is exactly as long as the two rods, so near 180° it gives almost no restoring push.
  Chain weapons in our port have no tie at all. **Probable main cause of the "flailing" (not measured).**
  No code that builds this tie was found, so it may exist only in the demo data.
- **Auto-aim exists only for NPC turrets** (Body command 0x400). Shop guns have `m_spasmtype` 0, so this code is off
  for them. The same code is a good model for a phone aim mapping (section 6).

### 8.1 Mount and gun angle

#### 8.1.1 Factory values (item factory 0x486ff0)
| id | item | m_arm | clip | m_recoil_time | rod `m_jrad_x` | muzzle `m_stvolshift` | m_type (+0x6b8) |
|---|---|---|---|---|---|---|---|
| 240 | mortar | 0x6d (109), 0x48a2f2 | 3 | 5 | 18 (0x48a375) | (11, 0) (0x48a31e) | 0x40 (0x48a23f) |
| 244 | mortar_heavy | 0x64 (100), 0x48a4a2 | 1 | 5 | 19 | 0x48a4d9 | 0x40 |
| 243 | launcher | 0x65 (101), 0x48aabb | 3 | 5 | 17 (0x48ab3e) | 0x48aaf3 | 0x40 |
| 241 | gun_blade (our arquebus) | 0x6c (108), 0x48a6c4 | 20 | **5** (0x48a6d9; the .seria says 2) | 34 (0x48a751) | (10, 0) INFERRED (0x48a6e5) | 0x40 |
| 242 | tribun | 0x6c (0x48a8fd) | 40 | 5 (timer 0x48a90c) | 30 | not read | 0x40 |

- All guns: `m_jtype` 2, mount `m_necess` = `m_jitter` 5 (factory tail 0x48b6b5).
- Every gun starts with an **empty clip** and the timer at `m_recoil_time` (for example 0x48a301 timer = 5,
  0x48a30d rounds = 0). The first clip is ready after 5 s.
- `m_spasmtype` (+0x450), `m_spasm_dump`, `m_spasm_firestab`, `m_dump` and `m_aero` are not set by the factory for
  any gun. `pishal.seria` confirms 0 for all of them on the mortar.

#### 8.1.2 Attach (Human 0x44f210)
- The PC can hold **two** weapons: the PC Human constructor sets the held-list limit +0x90c = 2 (0x44eca9). The NPC
  constructor sets 1 (0x44e9ff). So a player can carry a melee weapon and a gun together.
- 0x44f210 makes one joint: hull → the weapon's first part (+0x790), type `m_jtype` (2), radius `m_jrad_x`,
  shiftB_y = `m_jrad_y`, necess = `m_jitter`, life 1e6 (0x44f35f–0x44f3a2). The joint strength starts at 0 and grows
  by 0.5·dt each frame to 1 (solver 0x4637e6–0x463844; necess is held at 1 while it grows): a new weapon "grows
  in" over about 2 s. The m_fake argument is 0.9 when the owner is a machine (0x44f346); INFERRED effect: the hull
  takes less of each correction. `pishal.seria` stores m_fake 0, so this is not proven.
- **No tie joint between two held weapons is made in 0x44f210, 0x44f450 or 0x44f670.** A scan of all joint
  constructor calls (0x4ac070) for type 0 found ties only in NPC part builders (0x46d17b…), spike impaling (0x4160f9)
  and scripted machines (0x49d25d…).

#### 8.1.3 The demo machine (`Demo/pishal.seria`: PC + broad_blade + mortar)
| joint | type | radius | necess |
|---|---|---|---|
| hull → mortar | 2 | 13 | 5 |
| hull → broad_blade | 2 | 43.1554 | 5 |
| mortar ↔ broad_blade | **0** | **78.6176** | **1** |

- The largest distance that the two rods allow is 13 + 43.16 = 56.16. The tie asks for 78.62 (×1.40). So the tie
  is never satisfied: in passes 0 and 1 of every frame it pushes the two bodies apart, and the rods pull them back in
  passes 2–5. The result is a stiff hold at exactly opposite sides, with a restoring push that grows linearly with the
  angle error.
- The rods (13, 43.16) are shorter than the factory rods (18, 49). INFERRED: the demo was set up by hand in an editor,
  and the tie also comes from that data (no code path builds it, 1.2). In a shop-built machine the gun probably swings
  free on its rod (INFERRED).

#### 8.1.4 What sets the gun angle
- The type 2 joint turns B so that its local (−radius, shiftB_y) points at A (physics doc). So the gun's +x axis
  points away from the hull centre. **The gun angle is the direction hull → gun.**
- No code turns a player gun toward the mouse, the movement direction or a target. The mouse only makes thrust
  (0x4b03d0). Readers of `m_arm` exist only in the fire function 0x417f00, in the NPC command 0x41ddb3/0x41df2c and
  in the factory.
- The player changes the gun direction only by moving the hull (the gun lags behind on its rod), by gravity on the
  gun (100 px/s²), and, with a tie, by the swing of the main weapon.

### 8.2 Where the shot goes

#### 8.2.1 Fire function 0x417f00(dir*, shift_x, shift_y)
- Gate: timer +0x46c must be 0 and rounds +0x474 > 0 (0x417f24–0x417f43). Then a switch on `m_arm − 0x60`
  (table 0x41c0dc).
- `dir` is a direction passed by the caller. Every player or item caller passes the **gun's own +x axis**: it rotates
  (1, 0) by the gun transform (0x516fb0):
  - 0x458aa9 (button press) and 0x458b84 (button held), with `m_stvolshift` as the muzzle offset;
  - 0x41d6c6 (sprite animation frame flag 0x8), with `m_stvolshift`;
  - 0x422b49 (item use).
- Only the creature paths use a target vector: 0x45cf89 (a creature that fires at +0x810) and the command 0x400
  (2.3).

#### 8.2.2 Shot data
- Muzzle point (arquebus, 0x41a1f7–0x41a291): gun centre + dir · mesh radius (+0x438 → +0x38) + rotated
  `m_stvolshift` + 2 · v_gun · dt.
- Bullet (m_arm 0x6c): Body 7 × 7, density 200, **sharpness 7**, m_collisions 2, layer 3, meta 0x804
  (0x41a31a–0x41a38f). Speed: 0.02 · 2000 px per frame along `dir` = **2000 px/s** (0x41a1f7). The previous position
  is set from `dir` only, so INFERRED: the bullet does **not** take the gun's own velocity. No random call was seen
  in the bullet branch, so INFERRED: no spread. No recoil call in this branch.
- Mortar (0x41941f…): balls = 5 · `m_arm_level` (0x4194f0); each ball direction = dir + random ±0.2 on each axis
  (0x41963e–0x41966f); speed 2000 px/s scale (0x419421); with `m_extra_stvol` barrels the direction fans over 60°
  (0x419433–0x419455). Ball sharpness 7, m_collisions 5. **Recoil**: a force −dir · (shot momentum) / dt² on the
  gun body only (vfunc +0x9c, 0x419898–0x419902). The hull feels it only through the rod.
- Gravity: shots are plain Bodies (0x413a20), so the common gravity 100 px/s² acts on them (INFERRED from 0x407ed0).

#### 8.2.3 Auto-aim: Body command 0x400 (vfunc +0xc4 = 0x41d800), NPC and turrets only
`command(bits, k, point*, fired*)` is sent to a machine and passed on to all its jointed parts (0x41e3ad–0x41e3db).
Each part masks `bits` with its own `m_spasmtype` (0x41d871). For a part with bit 0x400 and `m_arm` ≠ 0
(0x41dd86–0x41ddbb):
1. `d̂` = unit vector gun → point (0x41ddc1–0x41dde5).
2. **Aim force** at the gun centre: `F = d̂ · gun.mass · k` (0x41de14–0x41de4d). It acts when the timer is 0, or
   always when the owner is a creature.
3. If the timer ≤ 0.1: **damping** `F = −gun.mass · m_spasm_firestab · v_gun` (absolute velocity, 0x41de6a–0x41deb0).
4. `m_arm_axis` 0: fire **along the gun axis** only when `axis · d̂ > +0x478` (0x41df24–0x41dfb1). +0x478 is a new
   random value in 0.98…0.9999 after each shot (0x41dfbd–0x41dfcb), so the cone is 0.8°–11°. `m_arm` 0x6a and 0x62
   use 0.9 (26°). Muzzle offset (1.2 · mesh radius, 0).
   `m_arm_axis` 3: fire straight along `d̂` at once (0x41dec0–0x41def5).
5. A shot sets `*fired |= 1` (0x41dfd9).

Slot check: the NPC vtable 0x5489b0 (attack 0x4ae940 at +0xf8), the autopilot vtable 0x548b70 (0x4b0ee0 at +0xf8)
and the base vtable 0x53e460 all have +0xc4 = 0x41d800. So the senders below reach this command.
Senders: the NPC attack 0x4ae940 with `m_tactics` (+0x6c0) bit 0x80 → k = 0 (fire when aligned, no pull)
(0x4aeb59–0x4aeb7f) and bit 0x100 → k = **1500** (0x4aeb87–0x4aebac); when the shot goes, the NPC sets its steering
to 0 for that frame (0x4aebb4–0x4aebd3). Also creature behaviours 0x433195 / 0x4331bf (k 600). NPC gun builders set
`m_spasm_firestab` **30**, `m_spasm_dump` 3, clip 1, recoil 7, and `m_tactics |= 0x100` (0x4a46ec–0x4a4725).
**Correction for RE_AI.md §5.3:** bits 0x100/0x80 are this gun command (target point +0x810, k 1500 / 0), not a ray
test; "steering 0" happens after a shot.

### 8.3 Fire control
- Mouse buttons: the main loop calls the controller's "held" handler every frame (0x461365 → 0x4b2d90, button 1;
  0x4613c0, button 3). Press: 0x4b2e20 → 0x458a00. Both fire the active item (+0x6f8) along its own axis when its
  use type (+0x6d8) is 4 (0x458a4b, 0x458b36). The factory gives guns use type 3 (0x48a342, 0x48a4f1, 0x48a713).
  So the exact player trigger path for a shop gun is **not proven**: none of the callers below is shown to be
  reachable for a use-type-3 gun. The direction result does not depend on it: the fire function 0x417f00 has exactly
  seven direct callers (0x41d6c6, 0x41def5, 0x41dfb1, 0x422b49, 0x458aa9, 0x458b84, 0x45cf89) and no pointer to it
  exists in the image. With `m_arm_axis` 0 (all shop guns), every caller except the creature 0x45cf89 fires along
  the gun's own axis (0x41dfb1 too, after the alignment test).
- Hold to fire: the held handler runs each frame, and the fire function gates on the timer.
- Timer after a shot (0x41c082–0x41c0a5): rounds − 1; timer = **0.1 s** if rounds remain, else `m_recoil_time`.
- Reload (base tick 0x411d71–0x411dc3): the timer counts down; at 0 with an empty clip, the clip refills.
- Recoil: mortar only (2.2). The arquebus has none.

### 8.4 Damping of the gun swing
- Player guns: **none extra.** `m_dump` 0, `m_aero` 0, `m_spasm_dump` 0, `m_spasm_firestab` 0 (factory, `pishal`).
- The Weapon class force override (vfunc +0x84 = 0x5133c0, read to `ret` 0x513788) has crowd events, the cyclone spin
  and a glow value, then calls the base forces 0x407ed0 (gravity, spin damping −300000·ω). Nothing for guns.
- The mount runs 6 passes (`m_jitter` 5). The type 2 angle snap holds the gun radial; spin damping does not matter.
- The only "stiffness" is the over-long type 0 tie in `pishal` (1.3), and the turret damping (2.3, NPC only).

### 8.5 Our port compared (as of 2026-11-16; shots, recoil and weight: see section 9)

| # | Original | Port | Effect |
|---|---|---|---|
| 1 | Tie gun ↔ main weapon in `pishal` only (origin not found): type 0, radius 78.62 = 1.40 × the demo rods (13 + 43.16) = 1.17 × the factory rods (18 + 49), necess 1 | `armedSpec` (weapons.ts:343): radius = `first.radius + g.rod` (factory rods) | Ours is satisfied only at exactly 180°. Near 180° the error is second order, so the gun wobbles freely over a wide arc. **Probable flail cause, not measured.** |
| 2 | (no data for chain weapons) | Chain weapons get no tie (weapons.ts:342–343) | The gun swings free around the hull. OURS either way. |
| 3 | Shot along the gun +x axis | `shoot()` uses `b.a` (sim.ts:564) | Same. |
| 4 | Bullet speed 2000, no spread seen, no gun velocity added (INFERRED) | 2000, spread 0.01, adds `b.vx/b.vy` (sim.ts:573) | Small. Our shots curve with the swing. |
| 5 | Arquebus `m_recoil_time` 5 (factory) | `reload: 2` (file value) | Ours reloads 2.5× faster. |
| 6 | Clip starts empty, first clip after `m_recoil_time` | Starts full (sim.ts:1188) | OURS (better for short rounds; keep). |
| 7 | Mortar balls 5·level, ±0.2, 2000 px/s scale, recoil = shot momentum on the gun | 5 balls, ±0.2 angle, 1100 px/s, `recoil: 3` | Speed and 3× kick are OURS (already noted in weapons.ts). |
| 8 | Muzzle = mesh radius + `m_stvolshift` + 2·v·dt | `b.radius + shotR + 1` | Small. |
| 9 | No player auto-aim; NPC turret aim = command 0x400 (k 1500, firestab 30, fire when axis·d̂ > 0.98…0.9999) | Bots fire when the axis is within max(0.12 rad, 30/d) of the lead point (bots.ts:366–381); no force | Bots match the NPC "fire when aligned" (bit 0x80). They do not use the pull (bit 0x100). |
| 10 | Mount necess 5, type 2, factory rods 18/19/17/34 | Same (weapons.ts:341) | Same. |

### 8.6 Change spec (minimal)

#### 8.6.1 Fixes from original data
1. **Stiff tie (demo file only, origin not found)** — `weapons.ts` `armedSpec`, the type 0 joint:
   `radius: TIE * (first.radius + g.rod)` (was `first.radius + g.rod`). Keep type 0 and `necess: 1`.
   `TIE` = 1.40 if we copy the ratio to the demo rods (78.6176 / (13 + 43.1554)), or 1.17 if we copy the ratio to the
   factory rods that the port uses (78.6176 / (18 + 49)). Any value above 1 gives a restoring push that grows
   linearly with the angle error; 1.0 (ours now) gives almost none near 180°. Start with 1.17, then measure in the lab
   that the gun sits opposite the head and does not shake (the tie and the rods fight in passes 0–1 every frame, as
   in the demo).
2. **Arquebus reload** — `SIDEARMS.arquebus.part.gun.reload: 5` (factory 0x48a6d9). Optional: the file value 2 feels
   better in a party game; if we keep 2, mark it OURS in the comment.
3. **No gun velocity in shots** (INFERRED) — `shoot()` sim.ts:573: `shot.setVelocity(dx * gs.speed, dy * gs.speed, 0, dt)`.
   Optional; test first, because the evidence is a reading of the previous-position write only.

#### 8.6.2 Phone aim (OURS mapping, built from the original turret code 2.3)
The original player has a mouse but still no aim: the gun always points away from the hull, and the player swings
the machine to point it. A phone stick makes thrust like the mouse, so a player cannot also "aim" with it.
Use the original NPC turret mechanism (command 0x400, bit 0x100) with the stick as the target:

- **Input.** `stickPush` (arenas.ts:91) also stores the last stick vector on the machine: `m.stickX`, `m.stickY`.
  The controller already sends the stick with the trigger (controller.ts:83).
- **Aim point.** While `m.trigger` is held and |stick| > 0.3: `P = hull + unit(stick) · 400`.
  If the stick is in the dead zone: no aim force; the gun fires along its current axis (original player rule).
  Option (OURS, off by default): dead zone + trigger → `P` = the nearest enemy hull within 650 px.
- **Aim force** (in `sim.ts` `guns()`, before `world.step`, so it is integrated this frame):
  - on the gun: `F = unit(P − gun) · gun.mass · AIM`; original NPC value `AIM = 1500` px/s² (0x4aeba0);
  - on the hull: `−F` (OURS: the original adds no reaction, which would give free thrust);
  - damping on the gun: `−gun.mass · STAB · (v_gun − v_hull)`; original NPC value `STAB = 30` (0x4a46ec).
    OURS: relative velocity. The original damps absolute velocity, which would act as a large drag on a moving
    player machine.
  - **The original values are too slow for us** (calculation, not measured): with relative damping the gun's speed
    round the hull stops at AIM/STAB = 50 px/s, so a half turn takes about 1.1 s on rod 18 (mortar) and 2.1 s on
    rod 34 (arquebus). Use OURS values, for example `AIM = 4000`, `STAB = 8`: top speed 500 px/s, time constant
    0.125 s, half turn about 0.25 s (rod 18) and 0.35 s (rod 34) plus overshoot. Tune in the lab.
- **Thrust while aiming (required, OURS).** At full stick the port's hull accelerates at about
  420 · 504 000 · 0.6 / 66 000 ≈ 1 900 px/s² (`stickPush` cap 420, `tuning.thrust` 504 000, sim.ts:666). On the gun
  this acts as a pull of the same size away from the stick, larger than AIM 1500. With the original AIM the gun
  trails behind and points away from the stick while the hull speeds up. So while the trigger is held and the stick
  aims: thrust × 0.3 (or less), and AIM well above the remaining hull acceleration (AIM 4000 > 0.3 · 1 900).
- **Tie while aiming.** The tie (6.1 #1) is much stronger than the aim force (1500 px/s² is about 0.6 px per frame).
  Switch it off while aiming: set the tie joint's `necess` to −1 while `m.trigger && aiming`, and back to 1 after.
  This needs the tie joint kept on the `GunState` (OURS).
- **Fire gate while aiming.** Fire only when `cos(gun.a − angle(P − gun)) > 0.98` (original threshold, fixed instead
  of random 0.98…0.9999). Shots still go along the gun axis (original `m_arm_axis` 0). Without aim: fire at once.
- **Bots.** `bots.ts` `guns()`: set `m.stickX/Y` to the unit vector toward the lead point and call `arena.fire(m)`
  whenever the target is in range. The sim then pulls the gun round and fires when aligned. This is the original NPC
  rule (bit 0x100, k 1500, fire when aligned) instead of the current "wait until the swing points there".
What a phone player does: hold fire, push the stick toward the enemy. The machine slows to 0.3 thrust, the gun
swings round the hull to that side (about 0.25–0.35 s with the OURS values, not measured) and fires while it points
within about 11°. Release fire: full thrust again, and the gun goes back opposite the main weapon.

Not measured: swing time, overshoot, the shake of the stiff tie, and the effect of `−F` on the hull for the
arquebus (22 379 mass × 4000 ≈ 9e7). Measure them in the lab or with a headless script before the values are fixed.

### 8.7 Open points
- The exact player trigger path for use type 3 guns (3).
- Where the `pishal` tie comes from in normal play (1.2, 1.3).
- The meaning of `+0x484` (must be ≠ 0 for command 0x400) and the m_fake 0.9 on the mount (1.2).

## 9. The port (Rotor Brawl), 2026-11-17

The user's request: shotgun pellets "just bounce off and do not feel impactful"; guns should have recoil and weight,
deal no contact damage, and be very fragile. The original is far more lethal (2 bullets kill, every bullet stuns) and
its guns are indestructible, so most of this is OURS. Code: `sim.ts` (`shotHit`, `shoot`, `gunHurt`, `breakGun`),
`weapons.ts` (`GunSpec.hit`, densities).

| # | Rule | Original | Port | Why |
|---|---|---|---|---|
| 1 | Shot on a hull | Generic damage (about 155), full stun, the shot dies | `hit` per gun: damage, push (a speed on a 66 000 hull), stun, × 0.3–1.2 by the landing speed; the shot is spent | The exe's numbers end a round in 2 shots; the push gives the "impact" the light shot body can't (a 280-mass body moved a hull by 8 px/s) |
| 2 | Shot on a weapon, gun or plate | Ricochets at half speed, sharpness 1 | **Spent**: the push goes into that part (at most twice the hull speed and 600 px/s, so light worm parts aren't flung), a spark (`ping`); a sidearm wears down, a plate can come off (`m_overkill` · 100) | "Pellets must not just bounce off" |
| 3 | Shot on a wall or crate | Stone: ricochet at half speed; wood: dies | CoR 0.3 bounce, then gone after 2 (bullet) or 3 (ball; the exe 5) contacts | Fewer live bodies on the TV |
| 4 | Shot on a wreck, loose weapon, debris | Same as 2 | A plain bounce (counts a contact) | |
| 5 | Shot on a teammate (friendly fire off) | (no teams) | Flies through: the engine's bounce is taken back from both bodies, then the shot is not solid for 0.04 s | With collision on, team bodies still touch shots (a heavy ball moved an ally 118 px/s before the take-back) |
| 5b | Rocket | Goes off on a hull or a stone wall (damage ≥ 5), **not** on a held weapon or gun (it takes 0 from them, 0x410540–0x410575): it bounces and its own thrust (0x408123) drives it on; a 30 s fuse | Goes off on a hull, a wall, a crate, a wreck or a loose weapon; on a live enemy's weapon, gun or plate it bounces (a "ping"), then eases back to its speed in about 0.2 s (`ROCKET_THRUST`); it goes off at the end of its 1.5 s life (OURS: the TV's body budget) | The user: match the original (2026-11-17) |
| 5c | Shot at health_low | The health_low rule (0x410734–0x4107fa) holds for every attacker with `m_jaws` 0 (+0x3ac, tested at 0x410721), so for shots too; but a shot does about 155, so at health_low every landing shot is lethal | At health_low (12) a shot's damage is raised to the machine's health: it is the lethal hit, as in the exe. Monsters have no health_low rule | The user: match the original |
| 5d | Blast and health_low | The explosion sets the health itself (setHealth vfunc +0xe0 at 0x4171ed and 0x4173ad, after reading +0x4d8), so the health_low rule does not stop it; then the normal damage call (+0xe4, 0x41722d) | A blast's damage subtracts past health_low (`damage(…, direct)`) | Match the original |
| 5e | Tribune's back blade | `tribun.seria`: class Weapon, `m_type=64` (0x40, a gun), `m_arm=108` (bullets), clip 40, `m_sharpness=5`, `m_bladeable=1` (u 0), `m_spikeable=0` (side values 1/1, so the spike product is 0: **no impaling**), health 9.99999e7 (can't break) | A blade that shoots: it cuts (no `Tag.sidearm`), it can't break, its bullets are the sidearm bullets | Already as the original; no change |
| 6 | Values | Bullet 155 / stun 1 | Bullet 3 dmg, push 40; mortar ball 5, 60, stun 0.07 (5 balls: 25, 300, 0.35); heavy ball 20, 320, 0.6; rocket 0 (its blast does the harm) | Keeps the bot balance (below) |
| 7 | Recoil | Mortars: the full momentum on the gun body; arquebus and launcher none | 0.5 × pellets × `hit.push` on the bare hull speed: arquebus 20 px/s a shot, mortar 150, heavy 160, launcher 0; 70 % on the hull, 30 % on the gun | The request (arquebus too); the launcher stays recoilless as in the exe |
| 8 | Weight | Physics only | Physics only, with heavier mortars and launcher: density 68 / 72 / 32 (masses about 15 000 / 22 200 / 18 300; arquebus 22 379 as the exe) | Measured below |
| 9 | Gun contact damage | Arquebus cuts; mortars and launcher 0 | A sidearm's body never hurts (no damage, stun, plate knock-off or crate damage); it still collides. Replaces the old `Tag.aiming` rule (no damage only while aiming). The tribune's back blade is a blade first and still cuts | The request; the aim pull and the weight must not make a club of the gun |
| 10 | Durability | None | `GUN_HP` 200: enemy blows from impact 20 up, at most 60 a blow, one blow per 0.3 s; shots count × 0.5 (no minimum). At 0 the gun breaks off: joints gone, it falls as scorched debris, 2 splinters, `gunbreak` event ("GUN BROKEN"); the machine fights on lighter. The next round rebuilds it | The request; without the cap and the 0.3 s gap a grinding contact broke guns in a median 1.1 s, in the opening clash |

Weight measured (hammer, no input: terminal sink speed; full stick from rest: time to 300 px/s): none 91 px/s,
0.18 s; arquebus 123, 0.30 s; mortar 100 → **113**, 0.22 → **0.26** s; heavy mortar 103 → **123**, 0.22 → **0.28** s;
launcher 112 → **118**, 0.24 → **0.26** s (old → new density).

Balance (bots.bench.ts, ROUNDS=4, 1 248 duels; win rate before → after): lance (arquebus) 82 % → 71 %, flak
(launcher) 69 % → 66 %, jackal (mortar) 67 % → 66 %; the top melee profile krank 70 % → 74 %. Guns broken: 0.11 per
duel. modes.bench.ts (ROUNDS=32, 96 rounds a row; with guns / GUNS=0): 2 v 2 lance+jackal v thump+krank 54 % / 16 %;
flak+jackal v lance+razor(mortar) 60 % / 32 %; bulwark(heavy mortar)+thump v krank+dervish **72 % / 43 %** (the heavy
mortar may be too strong in teams); worms (3 bots v 3 worms) won by the bots in every round either way, 9.1 s / 12.4 s.

## 10. Open points
- The exact player trigger path for use-type-3 guns (8, 3).
- Where the `pishal` tie comes from in normal play (8, 1.2 and 1.3).
- +0x484 (must be ≠ 0 for command 0x400), the mount's `m_fake` 0.9, and +0x70 on shots (0.5 bullets, 0.3 heavy ball;
  used in the broadphase 0x402800–0x40284d next to an owner compare: maybe shots vs their own machine).
- What removes a layer-0 shot; the fast-body sweep path's M; the readers of `m_desowning_time`; the start test at
  0x410379 (INFERRED freeze or shatter, off by default).
- Meta bit material names are inferred from sprite names.
