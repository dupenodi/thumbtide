# Hammerfight physics, as read from the game's code

Reference for the `hammer` game. Read from a DRM-free dev copy of Hammerfight v1.004 (`Hammerfight.exe`,
SHA-256 `e72d38c1…ef86`, x86, image base 0x400000) with objdump; addresses are virtual addresses in that file.
Values come from `Config.ini` and the `.seria` object files. This file describes behaviour; it contains no game code.

Units: pixels, seconds, mass = polygon area (px²) × `m_fDensity`. Screen y points down.

## Frame and step (0x4b1e30)

- One physics step per rendered frame. `dt = CORE_TIMEWRAP × frameDelta`, capped at `1/GFX_FRAMERATE` = 1/50 s.
  In practice: **fixed 50 Hz, dt = 0.02**.
- Order: 1. common forces → 2. integrate → 3. joints (`PH_JOINT_ITTERATIONS` = 30 passes) → sweep test for fast
  bodies → 4. collisions (all pairs, broadphase then narrowphase) → 5. framing.

## Integration (0x416190) — time-corrected Verlet

```
x_new = x + (x − x_prev) · dt/dt_prev + (F/m) · dt²        x_prev = x
θ_new = θ + (θ − θ_prev) · dt/dt_prev + clamp(τ · I⁻¹, −10, 10) · dt²
v = (x − x_prev)/dt   ω = (θ − θ_prev)/dt                   (0x402b20, for drag and collisions)
```
No damping in the integrator. Forces and torque are cleared after each step.

Mass = ½ Σ|pᵢ × pᵢ₊₁| × density (0x5158d0). Inertia = m/6 · Σ|cᵢ|(pᵢ² + pᵢ·pᵢ₊₁ + pᵢ₊₁²) / Σ|cᵢ| about the body origin (0x515a70).

## Forces

**Every body (0x407ed0):**
- Gravity `(0, PH_G · m)`, `PH_G` = 100 → 100 px/s² down.
- Optional linear drag `−k·v` (k from the body; 0 in the weapon files).
- Spin damping torque `−(300000 + 10k) · ω`.

**Player machine (Human, 0x44c930 + PC control 0x4b03d0):**
- **No gravity while alive** (the base forces run only when dead or the engine is off).
- Spin damping torque `−(2e6 + 1e6·k) · ω`; self-righting: each frame the angle (and previous angle) moves 5 % toward upright.
- **Thrust is an impulse from input movement.** Per frame:
  `F = d · PH_THRUST_PC(300000) · 1.0 · 0.5 · 1.2 · clamp(1/TIMEWRAP, 1, 4)`, capped at `|F|·dt ≤ 8e6 · same clamp`.
  Applied at a point slightly above the centre (local (0, −0.2)), which tilts the hull.
  - Mouse: `d` = raw counts this frame × `CORE_MOUSE_OVERALL` × `CORE_MOUSE_SPEEDn` (calibrated, ≈ 2.1).
  - Gamepad: `d = GAME_SENSITY_PAD(100) · stick³` per frame (stick in −1…1).
  - Result: the speed change is proportional to the input movement (≈ 0.116 px/s per mouse count after calibration).
- **Quadratic drag** `F = −PH_RESIST_PC(300) · |v|² · v̂`.
- **Speed clip**: if `|v| > GAME_SPEEDCLIP_MOUSE` (350; pad 200) × clamp(1/TIMEWRAP,1,4), the previous position is set
  so that the speed is exactly the clip.
- Hull: PC mesh 25×33, density 80 → m ≈ 66 000.

## Joints (0x462f80), solved by position only

Each pass, for each joint with pass index ≤ `m_necess` (files: 5 → **6 passes**, not 30):
```
wA = mB/(mA+mB), wB = mA/(mA+mB)            (m_fake biases; static/frozen body takes nothing)
d = anchorB − anchorA, n = d/|d|
rope (type&1): skip if |d| ≤ radius (ramp f over the last 1 px)
e = d − n·radius;  A.pos += e·wA·strength·f;  B.pos −= e·wB·strength·f
```
- Only positions move; previous positions do not. **The Verlet step turns every correction into velocity** — this is
  the whip in the weapons.
- Angles: type 2 and 3 snap B so its local (−radius, shiftB_y) points at A (no mass weight). Type 4-bit (type 5) turns
  each side's anchor toward the other: gain 0.3 × mass share, clamped ±0.02 rad per pass. Angles from all joints on a
  body are averaged per pass. Positions are corrected at the centres only (no lever arm).
- No breaking by force. `m_strength` multiplies the correction.

| Joint type | Behaviour | Used by |
|---|---|---|
| 2 | Rigid rod (= radius), B points at A | hammer (60), sword (38) |
| 3 | Rope (≤ radius), B points at A | chain links (7), first link (10) |
| 5 | Short rope between offset anchors + soft turn | mace handle and ball (2–3) |

## Collisions (0x404f50)

- Swept SAT between convex polygons (up to 2 contact points, time of impact).
- If overlapping: push apart by half the gap, split by inverse mass, moving **both** pos and prev (no velocity change).
- Impulse at the time of impact: `P = −(1+e)·vn/K · N + μ·(vn/K)·tangent`, K = imA + imB + rotational terms,
  e = mean m_fCoR (0.3), μ = mean m_fCoF (0.2). Inside the friction cone, a second tangential pass with e = 0.4.
  The velocity change is written back into the previous position/angle.
- No hit cooldown.

## Damage

```
M = |P| · 1e-5                                    impact magnitude (P estimated with dt = 0.02)
C = 1, or for blades moving across the normal (|v̂ × N| > 0.7): clamp((|v|+1) · m_bladeable · 0.005, 1, 10)
dmg = int(0.1 · attacker.m_sharpness · C · M)     health 100
```
Example: hammer head (≈ 29 600) hits a hull (≈ 66 000) at 500 px/s → P ≈ 1.3e7 → M ≈ 133 → dmg ≈ 26.
The first lethal hit on a player-class body is clamped to `health_low` (12): one more hit is needed. Shock/stun
accumulates when M > 30.

## Weapon mechanics

PC values from the object files: `m_shock_value` 0.02, `m_level` 4, `m_collision_effect` 0.1, `m_extra_shock` 1,
`health_low` 12. Our 3 weapons do not use spikes, jaws or `m_stuck`.

- **Every collision hurts both sides** (onHit runs on both bodies).
- **Stun (shock, +0x484).** If M > 30: `stun += m_shock_value · attacker.m_extra_shock · M · 0.5` (≈ 0.01·M),
  clamped to 1. While stun > 0: no thrust, no quadratic drag, no self-righting, and gravity acts on the hull (it drops and
  tumbles); the speed clip still applies. Decay per frame: `stun −= (R + 1) · dt · 0.5` with
  `R = clamp(0.7·level, 1, 4) · clamp(2·health/100, 0.1, 1)`. A full stun lasts about 0.5 s at ≥ 50 health and about
  1.6 s near 0.
- **health_low rule** (players): above 12, damage subtracts. A lethal hit while health ≠ 12 sets health to 12. A lethal
  hit at exactly 12 kills. At or below 12, non-lethal hits do nothing.
- **Unowned bodies** (wrecks, loose parts, sharpness ≤ 1): damage and stun × 0.1 against a player.
- **Blades** (katar): the cut factor uses `m_bladeable_d` = 1 on one edge and `m_bladeable_u` = 0.6 on the other (the side
  is the sign of the contact point's local y). Blades never pass through bodies: a blade only gets more damage (C up to
  10), slow motion when C > 4, and its sound.
- **Disarm** (Weapon onHit 0x420ca0 raises event 0x65 through 0x483b40; the clash handler 0x4843c9 does the disarm, path 0x48474e, rate gate 0x468f20; for a plate victim it is the `m_overkill` knock-off instead; RE_GUNS.md §6): when two held weapons clash, if one moves more than 1.5× faster
  (`(|v|+1)/(|v_other|+1) > 1.5`) and `M > (25·R_other + 75)` (× 0.25 when the other is at ≤ 12 health), the slower
  weapon comes off its machine. At most once per second. At full health the threshold is 145, so disarms happen mostly to
  weak machines.
- Hammer and mace have no code of their own: they differ only in sharpness, mass and joints (rod vs chain).

Our additions (not read in the code): a disarmed machine can take a loose weapon by flying its hull within 34 px of the
weapon's grip, 1 s after losing its own. A dropped weapon keeps its inner joints (a chain stays a chain).

## Hit feel

- Slow motion (`GAME_SLOMO`): `v = 0.15·M·(40000/(victimMass+15001) + 0.25)`; if v > 27 (or a blade C > 4),
  TIMEWRAP = 0.3, then a linear return to 1.0 over about 1.3 s. Thrust and speed clip are scaled by
  clamp(1/TIMEWRAP, 1, 4) so the player keeps control in slow motion.
- Screen shake: k = clamp(M/(distance to camera + 1), 0, 1)²; if k > 0.2, shake += 40·k (offset clamped 0–3).
- Sparks scale with 2·C·M. No hit-stop.
