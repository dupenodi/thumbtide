# Hammerfight weapons, as read from the game's code

Companion to `HAMMERFIGHT_PHYSICS.md`. Source: DRM-free Hammerfight v1.004 (`Hammerfight.exe`, x86, image base 0x400000),
`Objects/Weapons/*.seria`, `Demo/*.seria`, `Data/Levels/*.seria`. Addresses are virtual addresses. This file describes
behaviour only. "INFERRED" marks a statement that is not read directly from code or data.

Units as in the physics doc: px, s, mass = polygon area × density, M = |P| · 1e-5 (P = collision impulse).

## 0. Where the weapons come from

- The game builds every weapon in code, in the **item factory 0x486ff0** (a switch on the item id, 99…245).
  Only 13 weapons also have a `.seria` file. The factory loads that file first (loader 0x486d50) and then **overwrites**
  some fields (sharpness, blade and spike values, rod). So the file values alone are not the game values.
- Body init `0x402390(x, y, w, h, density, density2, n)`: n = −1 → a w × h box; n ≥ 3 → an n-gon inscribed in a
  w × h ellipse (mesh helper 0x4a9e90). density2 is a "dormant" density (see 0.3).
- Weapon constructor 0x514580 (vtable 0x54b580) defaults: **m_sharpness 2**, m_layer 11, joint type 5, rod 10,
  m_jitter 999, sharp/blade/spike _u and _d = 1. Plain Body constructor 0x413a20 defaults: **m_sharpness 1**,
  m_bladeable 0, m_spikeable 0, m_extra_shock 1, m_jaws 0, m_layer 3, CoR 0.3, CoF 0.2, health 1e8, health_low 12.
- The factory sets `+0x6e8/+0x6ec` to one bit per item. These are the shop unlock bits (m_lockbit), not a tier.
- Calls `0x4786f0(weapon, 0x80000 | 0x100000 | 0x200000, x, y)` add upgrade **sockets** (Bonus objects `socket_s/m`,
  layer 0, density 0). They have no physics effect.

### 0.1 Joint constructor (0x4ac070 → 0x464c00)
Arguments: A, B, type, radius, m_fake, m_strength, shiftA_x, shiftA_y, shiftB_x, shiftB_y, m_angle, m_angle_constrain,
m_renderable, m_necess, insert flag, life, overlay, overlay sprite, flag. Field offsets (serializer 0x46475b…): +0x70 type,
+0x74 radius, +0x78 strength, +0x7c fake, +0x80…+0x8c shifts, +0x6c necess. `life` (+0x98) = 1e6 means permanent; a smaller
value counts down and removes the joint (0x462f8e). All factory weapon joints: strength 1, **necess 999** (all 30 passes),
life 1e6.

### 0.2 The mount joint
The Weapon object holds `m_jtype` / `m_jrad_x` / `m_jrad_y`. The machine joins to the **first entry of the weapon's part
list (+0x788)**. For a rigid weapon that entry is the weapon itself (0x48b6c0). For a chain weapon it is the first link
(mace_stone: hull → link0, type 3, r 10) or the hand. Demo files confirm it (`Demo/mace_stone.seria`, `mace_silver.seria`).

### 0.3 Dormant density
A body with m_fDensity = 0 is static. Function 0x4040d0 "wakes" it: density = m_fDensity2 (30 if that is also 0),
then m_fDensity2 = 0. The damage function wakes a static body when M > its m_irate (50) (0x4103a9, at most
[0x55b618] bodies per frame). `blade_saian.seria` has m_fDensity 0 and m_fDensity2 40, so it gets 40 (INFERRED: the loader
wakes it). Machine parts that have only density2 also wake when the machine dies (0x44f2d9).

## 1. Weapon table

Mass = area × density. Hull (PC, 25 × 33 box, density 80) = **66 000**. Sharpness is the final value after the factory.
`u/d` = the two sides (see 3.2). Rod = mount joint radius (`m_jrad_x`), `sy` = `m_jrad_y` (anchor offset).
All mount joints are type 2 (rigid rod that aims the weapon) unless noted. extra_shock = 1 unless noted.
**`m_jitter` is the mount joint's `m_necess`** (Demo files: hammer 5/5, katar 5/5, hisayan 3/3, maces 999/999). The factory
tail 0x48b6b5 sets 5 for rod weapons; hisaian 3; plate_iron 10; maces and the hand-mounted flails (stix, star, bich, claw)
keep the constructor value **999** (they skip the tail).

### Hammers (blunt: bladeable 0, spikeable 0)
| id | sprite | shape | dens | mass | sharp | rod | notes (address) |
|---|---|---|---|---|---|---|---|
| 200 | hammer_wood | box 22×28 | 35 | 21 560 | 2 | 56 | **m_extra_shock 4** (0x487134) |
| 201 | hammer_kolotun | box 17×35 | 35 | 20 825 | 2 | 60 | 0x487291 |
| 202 | hammer_iron | box 17×29 | 60 | 29 580 | 2 | 60 | 0x4873cb |
| 203 | hammer_klevec | box 16×32 | 60 | 30 720 | 3 | 60 | sharp +1 (0x48762f) |
| 204 | hammer_war | box 16×40 | 60 | 38 400 | 2 | 60 | 0x487890 |
| 205 | hammer_krank | box 17×34 | 64 | 36 992 | 3 | 60 | 0x487768 |
| 206 | hammer_gold | box 19×31 | 60 | 35 340 | 3 | 60 | 0x4874e3 |

### Axes (one sharp edge; spike values only matter for impaling wood, see 5.1)
| id | sprite | shape | dens | mass | sharp (u/d) | blade (u/d) | spike (u/d) | rod, sy |
|---|---|---|---|---|---|---|---|---|
| 221 | axe_bagor (file) | 6-gon, area 623 | 42 | 26 162 | 3 (1/1) | 1 (1/0) | 0 | 48, −1.5 (0x487e95) |
| 217 | axe_iron | box 18×23 | 65 | 26 910 | 3 (**0.5**/1) | 1 (0/1) | 0 | 55, −3 |
| 223 | axe_berdish (file) | 6-gon, area 450 | 60 | 27 006 | 3 (0.5/1) | 1 (0/1) | 0 | **60**, −5 (0x48808c) |
| 224 | axe_mamba | 6-gon 32×32 | 35 | 23 279 | 4 | 1 | 0 | 52 |
| 222 | axe_posolski | box 12×40 | 70 | 33 600 | 3.1 | 0.5 (1/0) | 1 (0.3/1) | 70 |
| 218 | axe_axis | 5-gon 27×27 | 50 | 21 666 | 3.5 (1/0.75) | 1 (0/1) | 0.3 (1/0) | 52 |
| 220 | axe_eclips | 8-gon 30×32 | 35 | 23 759 | 3.2 | 1 | 0 | 51 |
| 225 | axe_gold | box 19×35 | 55 | 36 575 | 3 | 1 (0/1) | 1 (1/0) | 58, −1 |
| 219 | axe_pike | box 9×45 | 70 | 28 350 | 3.5 | **0** | 1 (0.9/0.9) | 58 (0x48b61f) |

### Swords (blades)
| id | sprite | shape | dens | mass | sharp (u/d) | blade (u/d) | rod, sy |
|---|---|---|---|---|---|---|---|
| 227 | kathib_blade (file) | 5-gon, area 446 | 40 | 17 848 | 3.4 | 1 (0.6/1) | 47, 2 |
| 228 | katar_blade (file) | 5-gon, area 566 | 40 | 22 643 | **3.4** (set, 0x489633) | 1 (0.6/1) | 38, 1 |
| 232 | severn_blade (file) | 4-gon, area 597 | 30 | 17 922 | 3.5 (0.3/1) | 1 (0/1) | 42, 0 |
| 237 | innata_blade (file) | 5-gon, area 405 | 30 | 12 144 | 4.5 | 1 (0.7/1) | 46, 0 |
| 233 | palash_blade (file, mesh ×0.95) | 6-gon, area ≈ 713 | 45 | ≈ 32 080 | 3 (0.5/1) | 1 (0.5/1) | 40, 3 |
| 234 | silver_blade (file) | 6-gon, area 618 | 45 | 27 827 | 3.5 (0.5/1) | 1 (0.5/1) | 48, 3 |
| 231 | hisaian_blade (file) | 6-gon, area 517 | 45 | 23 254 | 3.2 (0.5/1) | 1 (0.5/1) | **69**, 4; m_jitter 3 |
| 226 | claw_blade (file) | 4-gon, area 226 | 35 | 7 902 | 6 | 1 (0.6/1) | 42, 3 |
| 230 | saian_blade (file) | 6-gon, area 456 | 40 (density2) | 18 240 | 5 (0.5/1) | 1 (0.5/1) | 43, 2 |
| 229 | broad_blade | box 44×17 | 42 | 31 416 | 2.7 | 1 | 49 |
| 235 | liberia_blade | box 51×15 | 30 | 22 950 | 3.5 | 1 | 43 |
| 236 | imperia_blade | box 57×10 | 35 | 19 950 | 4.2 (0.3/1) | 1 (0/1) | 47 |
| 238 | gold_blade | box 44×14 | 35 | 21 560 | 3.5 | 1 | 49 |
| 239 | sun_blade | box 48×20 | 30 | 28 800 | 3.5 | 1 | 51 |
| 245 | cyclon_blade + cyclon_arm | 10-gon 29×29 + box 50×10 | 20 / 20 | 12 358 + 10 000 | 3 / 1 | 0 | arm on rod 12; blade on type 5 r 5, shiftA_x 22, necess 30; m_effect_type 7 (spins) |

### Maces and flails
Chain links: `chain_small` box 10×6, density 20, mass 1 200, joints type 3 r 7. `chain_large`: first link box 12×6.6
(1 584), the rest 10×6, joints type 3 r 9 (krank: first link 14×8.4). Link m_meta = 4 for the first link and 0x80004 for
the others. **Links, hands and handles have m_layer 0** (0x48b9be, 0x48c0af, 0x48c1c5 …), see 3.3.
Mace heads: Weapon class, mount joint type 3 r 10, m_desowning_time 0.75 (0x48bf4d; star and bich: 1).

| id | head sprite | head shape | dens | head mass | sharp | links | other parts and joints |
|---|---|---|---|---|---|---|---|
| 199 | mace_stone | 8-gon 26×26 | 50 | 23 900 | 2 | 6 small | mace_orb_hand box 31×9 d30 (8 370): link5→hand type 5 r 2 shiftB_x −12; hand→head type 5 r 3 shiftA_x 8 |
| 207 | mace_orb | 8-gon 25×25 | 70 | 30 936 | 2 | 10 small | same hand as mace_stone (tail 0x48d056) |
| 214 | mace_silver | box 21×32 | 70 | 47 040 | 3 | 7 large | last link→head type 5 r 7 shiftB_y −17 |
| 210 | mace_blade | 6-gon 39×20 | 50 | 25 331 | 2; blade 1 (u 0 / d 0.9), sharp_u 1 | 8 large | last link→head type 5 r 7 shiftB_y −16 |
| 216 | mace_sharp | 8-gon 30×30 | 30 | 19 092 | 3.5, bladeable 1 | 4 large | + 3 segments `mace_sharp_chain_3/2/1` (15×20, 16×21, 17×22, d20, **sharp 3, bladeable 1**, default layer 3) on type 5 joints r 5/1/1; then mace_orb_hand |
| 208 | suriken_large | 8-gon 26×26 | 20 | 9 560 | 3.5, bladeable 0.65 | 6 large | then mace_orb_hand (0x48d067 → 0x48c141) |
| 215 | mace_krank | 8-gon 34×34 | 70 | **57 219** | 2 | 6 large (14×8.4) | mace_krank_hold box 38×10 d30 (11 400), type 5 r 2 shiftB_x −17 |
| 209 | mace_stix2 | box 35×9 | 70 | 22 050 | 3 | 5 small (first link **density 60**) | mace_hand box 30×8 d20 on rod 13 (mount type 2); hand→link0 type 5 r 5 + type 3 r 5, shiftA_x 12 |
| 212 | mace_star | 8-gon 25×25 | 70 | 30 936 | 3.9, spikeable 1 | 6 small | mace_hand (rod 13), m_layer 8 |
| 213 | mace_bich | 6-gon 22×26 | 80 | 29 722 | 3 | 4 small | mace_hand_silver box 22×9 d20 (rod 16); hand→link0 type 5 + type 3 r 5 shiftA_x 14; last link→head type 5 r 7 shiftB_y −15 |
| 211 | mace_claw_02 | box 20×30 | 60 | 36 000 | 1.5, spike 1 (0.6/0.6) | 3 small (first link d 57) | mace_claw_hand box 48×8 (rod 20); jaw `mace_claw_01` box 10×30 d57 (17 100), sharp 0.5, type 5 r 1 shiftB_x −20 + type 2 r 15 |

### Guns, plates, other
| id | sprite | shape | dens | mass | notes |
|---|---|---|---|---|---|
| 240 | mortar | box 22×10 | 25 | 5 500 | sharpness 0, m_arm 109, clip 3, recoil 5 s, rod 18 |
| 244 | mortar_heavy | box 22×14 | 25 | 7 700 | m_arm 100, clip 1, rod 19 |
| 243 | launcher | box 44×13 | 25 | 14 300 | m_arm 101, clip 3, rod 17 |
| 241 | gun_blade (file) | 4-gon, area 548 | 40.8 | 22 379 | sharp 5 (u 0.3), blade (u 0 / d 1), m_arm 108, clip 20, rod 34 |
| 242 | tribun (file) | 4-gon, area 909 | 25 | 22 732 | sharp 5 (u 0.3), blade (0/1), spike 1/1, m_arm 108, clip 40, rod 30 |
| 184–198 | plates | boxes | 15–40 | 5 040–21 120 | sharpness 0.5, m_overkill 0.3–0.8, m_shadensity 0.05 |
| 99 | bow1 | box 66×9 | 20 | 11 880 | sharpness 0 (story only) |
| 180 | basket_load_01 | box 27×51 | 20 | 27 540 | a cargo basket on a chain (not a weapon) |

No weapon sets m_jaws or m_stuck (all 0 / false). No weapon has a class or "type" field other than m_type
(64 melee, 128/256 in demos and guns) and the shop bits.

## 2. Weight and handling

- **No mass-dependent control code.** PC control 0x4b03d0–0x4b0c00 and Human update 0x44c930–0x44ce50 never read a mass
  field (+0x698 mass, +0x6a0 1/mass, +0x69c inertia). Thrust (`PH_THRUST_PC`), drag (`PH_RESIST_PC`) and the speed clip
  (`GAME_SPEEDCLIP_*`) are constants applied to the **hull only**. No "weight" or "handling" stat exists in the weapon
  objects. No per-weapon drag: m_dump (linear drag) and m_aero are 0 in all weapon files and in the factory.
- The weapon changes handling only through physics:
  1. **Joints share corrections by mass.** A rod (type 2) moves the hull by mW/(mH+mW) of each error. So a thrust impulse
     that gives the hull Δv alone gives the pair Δv·mH/(mH+mW) along the rod (INFERRED from the solver in the physics doc).
     Examples: wooden hammer 66 000/(66 000+21 560) = 0.75; hammer_iron 0.69; hammer_war 0.63; mace_krank set
     (head 57 219 + 6 links ≈ 7 600 + hold 11 400) ≈ 0.46.
  2. **Gravity on the weapon.** The live hull has no gravity, but every weapon part has gravity (100 px/s²). The hull must
     carry m_W · 100 through the joint. A chain weapon pulls down only while the chain is taut.
  3. **Swing load.** A swinging head pulls the hull with m_W·ω²·r through the rod (centripetal). Heavy heads on long rods
     drag the machine round.
  4. **Top speed does not change** with the weapon: the drag and the speed clip act on the hull alone. A heavy weapon
     only takes longer to reach the clip.
- Turning: the hull self-rights (5 % per frame) and is not coupled to the weapon angle (joint angles move only B).

## 3. Damage

### 3.1 The formula (Body damage 0x410340, called from onHit 0x414890 at 0x415153 on every contact)
```
C      = collision code 0x403c00, stored in the attacker's +0x398 (cut factor, see physics doc)
dmg    = int( 0.1 · M · S · C )             S = attacker side sharpness (vfunc +0xa4)
if attacker is unowned and its m_sharpness ≤ 1:  dmg = int(dmg · victim.m_collision_effect)   (PC: 0.1)
if attacker m_meta & 0x4000000:                    dmg += 7          (0x4104a7, INFERRED: burning/explosive bodies)
if victim's owner is a creature and 0x4326b0(attacker) says "ally":  dmg = 0      (0x4104d9, friendly fire off)
organic victim (meta 0x200) hit by a gun shot (m_arm 0x6c): ×3; meta 0x1000200: ×0.25
jaws: if the attacker's owner is a creature whose target (+0x828) is this body, it is not stunned and its state
      (+0x860) is 3 (bite): dmg += int(rand(0.3, 3) · m_jaws)       (0x4105bb)
```
`int()` truncates (0x51e004). **This truncation is the only small-hit filter:** a hit needs `0.1·S·C·M ≥ 1`, i.e.
M ≥ 10/(S·C) (blunt sharpness 2: M ≥ 5, |P| ≥ 5e5).

### 3.2 Two sides of a weapon (Weapon vfuncs 0x512ff0, 0x513090, 0x513130)
The contact point goes to the weapon's local frame (0x517030). If local y > 0 the code uses `m_sharpness_u`,
`m_bladeable_u`, `m_spikeable_u`; else the `_d` values. Each one multiplies the base value:
`S = m_sharpness · sharp_side`, `blade = m_bladeable · blade_side`, `spike = m_spikeable · spike_side`.
So the back of an axe (sharp_u 0.5, blade_u 0) does half damage and never cuts. A plain Body (links, handles) has no sides.
There is no other blunt/sharp distinction: blunt = bladeable 0 (C = 1).

### 3.3 What stops damage from resting contact
- **Collision layers (broadphase 0x402719): two bodies collide only if `layerA & layerB ≠ 0`.** This is the only layer
  test on the contact path (the other `m_layer` reads at 0x4077e8 / 0x407c4b are debug drawing; the `+0xec` calls next to
  them go to the renderer object [0x55f57c], not to onHit). Chain links, mace hands and handles get **m_layer 0** in the
  factory (0x48b9be, 0x48c0af, 0x48c1c5, 0x48d6af, 0x48df9b, 0x48e43e), so they **never collide with anything**.
  Exceptions: the `mace_star` hand is layer 8 (0x48db11) and collides with layer-8 bodies (11 has bit 8); the mace_sharp
  blade segments and the claw jaw keep the Body default 3.
  Machine layer: the Human constructor sets 11 (0x44e9b3, 0x44ec5d); the saved `Demo/*.seria` show the PC hull **and** the
  held head both at 4 (so they still collide with each other). In every case the links are 0.
  **A chain cannot touch, wrap or hurt an enemy in the original; only the head (and the listed exceptions) can.**
- No hit cooldown, no per-pair timer, no minimum relative speed and no impulse threshold were found in onHit 0x414890 or
  in the damage function. onHit runs on every resolved contact with the M of that contact (0x405120–0x405143).
- The impulse 0x403e20 is computed once per body pair and contact (not summed over contact points) from the relative
  velocity at the time of impact.
- Hits on a body of the **same machine**: excluded by ownership (INFERRED, not traced).

## 4. Stun (shock) and knockback

Code 0x410d78 (in the damage function), only when **M > 30**:
```
victim.stun += G · victim.m_shock_value · attacker.m_extra_shock · M · 0.5     (· m_collision_effect if unowned & sharpness ≤ 1)
G = [0x55b5b8] = 1.0 (set at level start, 0x49cb67)
if victim.m_spasm_shock ≠ 0 and victim is a part owned by a machine (owner item id ≠ 0x10):
    owner.stun += victim.m_spasm_shock · G · attacker.m_extra_shock · M · 0.02                  (0x410e02)
```
- PC: m_shock_value 0.02 → +0.01·M per hit; wooden hammer (extra_shock 4): +0.04·M.
  OPEN: the Demo PC has m_spasm_shock 0.5 and m_owner_id = its own id. If the hull counts as its own owner and its
  `+0x6bc` is not 0x10, the second line also fires on hull hits and the total is **0.02·M** per hit (not traced). The duration therefore depends on
  M and extra_shock only. Sharpness, blades and later wall hits do not add stun; a wall or wreck that hits a stunned
  machine stuns it again only with M > 30 (and ×0.1 for unowned blunt bodies).
- Human machines have m_spasm_shock 0.5 (0x44e9bd). Their parts that carry m_spasm_shock pass shock to the owner
  (INFERRED: plates and decorations of NPC machines).
- Health-low kill rule (0x4107b3): at or below health_low, a hit with dmg > 2 from a weapon-class body (or a body
  with m_spasmtype ≠ 0) kills when `stun > 0.35 · CRITICAL_SHOCK`; otherwise it does nothing. The PC stun is clamped
  to 1 in PC control (0x4b048e), so this matters only for NPCs (INFERRED).
- `CRITICAL_SHOCK` (level header: ARENA 80, ARIA_multy 150, HAMMERBALL_multy 150): 0x404700 tests
  `stun > (0.6·k + 0.3)·CRITICAL_SHOCK` (k from 0x469370) for AI and scripts. With the PC stun clamped to 1 it never
  applies to players (INFERRED).
- Knockback: no extra impulse is added. The only push is the collision impulse itself. While stunned the hull has
  gravity and no thrust/drag (physics doc), so a big hit makes it drop and tumble.
- M > 15: 0x483b40 records the hit (crowd/fame, INFERRED). M > 5 from a weapon: 0x421c20 (disarm and combo logic, see
  physics doc).

## 5. Spikes, jaws, stuck, chains, weapon code

### 5.1 Spikes impale wood (onHit 0x415cc0–0x416141)
Only when the attacker is weapon class (flags & 0x81f) and the other body has **m_meta & 2 (wood)** and **mass > 34 000**
(0x415ce2: `fcomp 34000; test ah,0x41; jne skip`, the same pattern as "M > 30"):
- the hit must be nearly head-on: `|v̂ × N| < 0.2` (the opposite of a blade cut, which needs > 0.7);
- `spike · (|v| + 1) > 300` (spike = side spike value, vfunc +0xac). Pike (0.9): |v| > 332; tribun (1): 299.
- Then the weapon's layer is saved and set to 0, and two joints tie the wood to the weapon (type 4 r 5, necess 3, and
  a type 0 distance joint), both with a finite life (they expire). The wood is carried on the spike.
- **Machines can be impaled**: the PC hull has m_meta 66 (0x42, wood bit set) and mass 66 000. Light plates (< 34 000)
  cannot. The second joint needs the target mesh half-size > 20 on both axes (0x41603b), which a 25 x 33 hull does not
  pass, so a hull gets only the first (type 4) joint (INFERRED).
- Spikes add **no** damage.

### 5.2 Jaws
Damage bonus for creatures only (3.1). All weapons have m_jaws 0.

### 5.3 m_stuck
A "nailed" flag, not a weapon behaviour: the joint solver gives a stuck body zero correction weight (0x463128,
0x463e27) and the integrator skips it (0x4163ba). All weapons: false.

### 5.4 Chains
Links, hands and handles do not collide (layer 0). All chain joints run all 30 passes (necess 999). The first
`chain_large` link is larger; the stix2 and claw first links are heavy (60, 57). Taut chains play chain_01/02.

### 5.5 Weapon-specific code
- Weapon vtable 0x54b580: own side accessors (+0xa4/+0xa8/+0xac), touch handler 0x512f70, die 0x513330, onHit 0x420ca0
  (disarm, physics doc). There is **no per-weapon onHit**; all differences are data.
- Special flags: m_effect_type 7 (cyclon, spinning blade), m_jitter 3 (hisaian), m_arm (guns).

## 6. Destruction

- Generic body death 0x41e410: health 0, particles (ids 39, 40, 20, 27, 61), explo_03, explosion if m_explosive,
  coin spill of m_scores (coins doc). Children are detached: static ones wake with their density2, and the detached
  parts get **m_layer 0** (0x41e8e7, 0x41e920) → harmless non-colliding debris. The body itself gets layer 0 and density 0.
  0x50a930 spawns visual fragments (counts 7–11).
- Machine death (PC 0x4b0c20 → Human 0x44ee50): sets health 0, then detaches parts: some get layer 0 (0x44f0da), static
  ones wake (0x4040d0(1)); the hull stays a physics body (now with gravity). The weapon falls off and is unowned after
  m_desowning_time (0.75 s; INFERRED from the field name and the factory value). Loose pieces hurt a player only through
  the unowned rule (×0.1 damage and stun for sharpness ≤ 1). Weapon heads keep sharpness ≥ 2, so a loose head is
  **not** reduced (INFERRED from 3.1).
- Lifetime: m_ttl 0 on all weapon parts → loose parts stay until the level ends. Count: all parts of the machine.
  The `0x50a930` arguments (7, 8, 11) may be effect ids, not counts (INFERRED).

## 7. Coins (details in the earlier coin notes, re-checked here)

- Spill on damage when dmg > 5: value dmg/2, max 30 coins per hit, up 200 px/s with ±36° spread. On death: m_scores.
- Pickup is **contact only** (no magnet). The coin's touch test 0x420d30 accepts any body owned by a player machine.
- Whether a held weapon collects coins is not proven: the coin touch handler 0x420d30 accepts a body whose owner is a
  player machine, so a weapon probably counts (INFERRED).
- **Weapon re-pickup** (Weapon touch handler 0x512f70, `this` = the loose weapon): when a body of class flags 0x2bf
  (INFERRED: a machine) touches it, the pickup is refused while the weapon moves faster than 200 (0x512fcc); otherwise the
  Bonus touch 0x420d30 runs and the machine takes the weapon. Contact only, no grip point.
- A stunned machine cannot collect. Coins ignore the hit player for 0.3 s after a spill. Coins never despawn (m_ttl 0).

## Gaps vs our port

| # | Original | Our port (`weapons.ts`, `sim.ts`, `collide.ts`) | Change |
|---|---|---|---|
| 1 | Chain links, hands and handles have layer 0: they collide with nothing (0x402719, factory) | All parts collide (`collide.ts` filters only by `group`) | Add a `solid` flag (or layer mask) to bodies. Set it false for every `link*`, `hand`, `handle` part of maces/flails, also when the weapon is loose. Keep the heads, `mace_sharp` segments, the claw jaw and the `mace_star` hand (layer 8) solid. **This removes the "wrapped chain hurts on every tiny contact" problem.** |
| 2 | One impulse per contact pair (0x403e20, no loop over points) | `resolve()` applies the two points one after the other and reports the sum of `|P|` | Report one impulse per pair (INFERRED: the larger point). The size of the change is not measured. |
| 3 | Damage needs `0.1·S·C·M ≥ 1` (int truncation) | Same (`Math.floor`) | None. Keep `tuning.damage` 0.1. |
| 4 | Thrust 300 000, speed clip 350 | 504 000, 550 | Faster machines give higher M everywhere (×1.57 speed → ×1.57 M, more stun). If hits feel too strong, lower damage factor or stun with it, not the formula. |
| 5 | Side test: local y > 0 uses `_u` values for sharpness, blade and spike | Matches (`ly > 0` → U) | None. |
| 6 | Stun only when M > 30: `+0.02·extra_shock·M·0.5`; `extra_shock` 4 only on hammer_wood | Matches the first line | OPEN (section 4): if the hull is its own owner, add the spasm line and use `0.02·M` per hit. Test in the original before you change it. |
| 7 | No mass in controls; weapons slow the machine only through joints, gravity and swing | Matches if `hover` = 0 | Keep `hover` 0 for the original feel. No handling stat to add. |
| 8 | Dropped weapon stays "owned" for m_desowning_time 0.75 s (1 s star/bich) (INFERRED from the field) | `owned()` uses `m.armed`, so a dropped weapon is unowned at once (`drop()`, sim.ts 864) | Keep a loose weapon owned for 0.75 s after it falls off. |
| 9 | Unowned ×0.1 rule only for sharpness ≤ 1 | Same | Loose heads (sharpness ≥ 2) hit at full damage. Our loose links will not matter after #1. |
| 10 | Spikes impale wood bodies **heavier than 34 000** (machine hulls) on a head-on hit with `spike·(|v|+1) > 300` | Not modelled | Optional: on such a hit by a spiked weapon (pike 0.9, posolski, axis, gold axe, tribun, star, claw), tie the victim hull to the spike with a timed type 4 joint and make the weapon non-solid while it holds. |
| 11 | Coins: contact pickup by bodies of a player machine (weapon INFERRED); machines take a loose weapon by contact when it moves < 200 | `coins.ts`: hull and held weapon collect (matches). Loose weapon: hull within 34 px of the grip, 1 s delay (OURS) | Coins: none. Weapon pickup: optional, accept contact with any solid part of the loose weapon when its speed < 200. |
| 12 | Death: detached decorations become layer 0 debris (no collisions); the hull stays solid with gravity | `wreck()`: hull gets gravity (matches); weapon dropped via `drop()`; plates knocked off and stay solid | Make knocked-off plates and links non-solid after a death (the head stays solid). |
| 13 | mace_sharp: 3 bladed segments (sharp 3, bladeable 1, solid) between the chain and the head | `spikedflail` has them with sharpness 4 | Sharpness 3 (see #17); keep them solid; links non-solid. |
| 14 | First link of stix2 density 60, of claw 57; hand-mounted flails keep mount necess 999 | `stixmace`, `clawmace` use `chain()` (all links 20); hull to hand necess 5 | First link density 60 (stix) / 57 (claw); mount joint necess 999 for stix, star, bich and claw. |
| 15 | Damage on both bodies of every contact; friendly-fire check 0x4326b0 | Same; team check in `hurt()` | None. |
| 16 | Factory rods and side values (section 1) | kathib rod 36 / sharp 3.1; claw rod 37; innata rod 44, no blade_u; saian rod 40 / sharp 4, no u values; silverblade rod 44, no u values; palash rod 35, full mesh; broadblade rod 43.2; berdish rod 70, no u values; severn no u values | Use: kathib rod 47 sy 2, sharp 3.4, blade_u 0.6; claw rod 42 sy 3; innata rod 46, blade_u 0.7; saian rod 43 sy 2, sharp 5, sharp_u 0.5, blade_u 0.5; silverblade rod 48 sy 3, sharp_u 0.5, blade_u 0.5; palash rod 40 sy 3, mesh ×0.95; broadblade rod 49; berdish rod 60 sy −5, sharp_u 0.5, blade_u 0; severn sharp_u 0.3, blade_u 0. The blade meshes in `weapons.ts` are the file meshes unchanged (checked: kathib, claw, severn, innata, saian, silver), so the exe `_u` maps to our `U` directly. Only bagor's mesh is y-mirrored (and its U is already swapped). |
| 17 | Body-class parts default to sharpness 1; bonus is added | spikedflail spikes 4; clawmace jaw 1.5; cyclone arm 2 | spikes 3 (1 + 2); claw jaw 0.5 (1 − 0.5); cyclone arm 1. |
