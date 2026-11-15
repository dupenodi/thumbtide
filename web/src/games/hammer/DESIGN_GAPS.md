# Rotor Brawl vs Hammerfight: design gaps (2026-11-16)

Sources: `RE_WEAPONS.md`, `RE_ARENAS.md` and `HAMMERFIGHT_PHYSICS.md` (read from the original's code and data),
the user's play test of 2026-11-16 (relay recording, 23 min, 49 rounds), the user's notes after it, and bot benches.
"Original" = what Hammerfight does. "Ours" = a rule that Hammerfight does not have.

## 1. The user's play-test notes

| # | Note | Original | Status |
|---|---|---|---|
| 1 | A wrapped mace chain damages on every contact; flails should hurt by inertia | Chain links, hands and handles collide with **nothing** (m_layer 0, broadphase 0x402719). Only the head hits. No other small-hit filter. | **Done (original):** links, hands, handles non-solid. Bot duels: spiked flail 289 → 128 damage per minute, morning star 376 → 188. **Done (ours):** a blunt hit needs 90 px/s closing speed, so a resting or pressed head does nothing. |
| 2 | All weapons handle alike; how did weight change handling? | **No handling stat.** Thrust, drag and speed clip act on the hull only. A weapon slows the machine only by physics: joint mass share, its gravity, the swing pull. Top speed does not change. | **Measured:** with the phone stick, 0 → 90 % of top speed takes 240 ms (claw) to 580 ms (krank mace), and the turn takes 320 to 660 ms. Same spread with the original thrust and clip. So the weight shows, and the "alike" feel comes from the hits (see 6). **Proposed (ours, not done):** a small top-speed cut for heavy weapons, if the user wants more difference. |
| 3a | Bigger arenas with destructible obstacles | The multiplayer arenas (ARIA, ARIA2, ARIA3) have **no** destructibles. The story ARENA has crates and cages (health 6–30). Camera: 800×600 view, no zoom, follows one machine (ARIA, ARIA2) or all (ARIA3). | **Not done yet (ours).** Plan in section 3. |
| 3b | Machines leave the frame at the top and bottom | Hard position clamp at the arena rectangle + 100 px (0x469570), no spring. | **Done:** hard top and bottom walls inside the frame (bounce 0.3). The sides keep the soft limit. |
| 3c | Where is the recording? | – | `C:\Users\LENOVO\AppData\Local\thumbtide-logs\playtest-20261116-0247.jsonl` (room SRNJ). Report script: `node playtest.mjs <file> SRNJ` (scratchpad; it can move into tools/). |
| 4, 9 | Coins collectible by the weapon | Coins go to the owner of any touching hull **or held weapon part** (0x420d30). | **Done (original).** |
| 5 | Shorter warm-up; per round or per match | Duel is one round; no warm-up. | **Done (ours):** pick 5 s (was 8), first 10 s (was 12); setting "Weapon pick: every round / each match only" (3-2-1 between rounds, loadout fixed). |
| 6 | Swords hit like maces; blade spine; slices vs rams | Two sides per weapon: the `_u` side multiplies sharpness and bladeable (an axe back: sharp 0.5, never cuts). The cut factor C (up to 10) needs the blade to move across the contact normal. Otherwise no blunt/sharp rule. | **Done (original):** side values from the factory for 9 weapons (kathib, saian, silverblade, severn, berdish …). **Done (ours):** a blade's edge that hits head-on does 0.6 of its sharpness; a cut needs 150 px/s relative speed. |
| 7 | Stun too short; should depend on hit type, damage, and on hitting something after | Stun only when M > 30, +0.01·M, max 1 (≈ 0.5 s at full health). No type rule, no knockback beyond the impulse. | **Done (ours):** blunt × 1.6, cut × 0.35 of that, max 1.5; a **slam** (machine, debris, floor, ceiling) within 0.8 s adds stun once. |
| 8 | Giblets that hurt while they fly | Detached parts become harmless layer-0 debris. | **Done (ours):** 5 shards, sharpness 3, hurt for 2.5 s, then pass through. |

Bot rounds after these changes: 2 machines 29 → 54 s, 4: 47 → 53 s, 8: 55 → 65 s (fewer grind hits, more misses).

## 2. Other gaps found in the original

| Area | Original | Ours | Recommendation |
|---|---|---|---|
| Duel health | 200 (INFERRED from the duel script) | 100 | Keep 100 now that grind damage is gone; check the round length in the next play test. |
| Rounds | One round, result 4.5 s, then the menu | First to N rounds | Keep ours (party game). |
| Floor | Story arenas have floors; wrecks, weapons and coins land | Open bottom: they fall out | Add a floor with the arena work (section 3), so coins and wrecks stay in play. |
| Spawns | P1 and P2 start low and 167 px apart | Far apart at mid height | Try closer starts: faster first contact (play test: first fights 3–9 s already). |
| Spikes | Spiked weapons can **impale** a hull (head-on, spike·(v+1) > 300) and carry it for a short time | Not modelled | Good identity for pike, posolski, axis, gold axe, morning star, claw. Worth a prototype. |
| Dropped weapon | Stays owned for 0.75 s after it falls off | Unowned at once | Small change; do it. |
| One impulse per contact pair | Yes (INFERRED) | Sum over 2 points | Not changed (not proved). |
| Slow motion | Limit 27: almost never shows | Limit 10, 2 s at 0.3 | Probably part of the "slow-mo" feel. Proposed: hit-stop 40–100 ms on big hits, slow motion only on the last K.O. |
| Weapon pick-up | Contact with a slow (< 200 px/s) loose weapon | Hull within 34 px of the grip | Optional: use contact. |

## 3. Bigger arenas: plan (not done)

- A fixed TV view that zooms out to fit everyone works better than a following camera with 8 players on one screen.
  The zoom must be a canvas transform: the part, rotor and text pictures are cached per pixel scale.
- Arena sizes: S = today's frame; M = 1.5× (zoom 0.67); L = 2× (zoom 0.5). Setting "Arena size", default S.
- Floor and walls: a hard clamp at the arena edges (original rule), and a floor at the bottom, so wrecks and coins
  land.
- Destructible obstacles (ours, after the story ARENA's crates and cages): static boxes and hanging cages with
  health 10–30. A broken obstacle drops 3–5 pieces as giblets and some coins. 2–4 per arena, inside the TV body
  budget (48 bodies for the TV).
- TV risk: a larger view means smaller sprites, but the same draw count; 8 machines now run at 52–55 fps.

## 4. From the play test (data, not notes)

- Too easy: the user won 45 of 49 rounds against 1–2 CPUs. CPUs need levels (reaction delay, aim error, aggression).
- Full stick tilt 85–100 % of the time: the part-tilt range is unused; responsiveness is top speed and turn rate.
- Shield never used; guns fired 1–8 times per round. The shield needs a clearer use or a prompt.
- Half of the session was menus (now shorter, see item 5).
