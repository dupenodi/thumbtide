# Rotor Brawl vs Hammerfight: design gaps (2026-11-16)

Sources: `RE_WEAPONS.md`, `RE_ARENAS.md` and `HAMMERFIGHT_PHYSICS.md` (read from the original's code and data),
the user's play test of 2026-11-16 (relay recording, 23 min, 49 rounds), the user's notes after it, and bot benches.
"Original" = what Hammerfight does. "Ours" = a rule that Hammerfight does not have.

## 1. The user's play-test notes

| # | Note | Original | Status |
|---|---|---|---|
| 1 | A wrapped mace chain damages on every contact; flails should hurt by inertia | Chain links, hands and handles collide with **nothing** (m_layer 0, broadphase 0x402719). Only the head hits. No other small-hit filter. | **Done (original):** links, hands, handles non-solid. Bot duels: spiked flail 289 → 128 damage per minute, morning star 376 → 188. **Done (ours):** a blunt hit needs 90 px/s closing speed, so a resting or pressed head does nothing. |
| 2 | All weapons handle alike; how did weight change handling? | **No handling stat.** Thrust, drag and speed clip act on the hull only. A weapon slows the machine only by physics: joint mass share, its gravity, the swing pull. Top speed does not change. | **Measured:** with the phone stick, 0 → 90 % of top speed takes 240 ms (claw) to 580 ms (krank mace), and the turn takes 320 to 660 ms. Same spread with the original thrust and clip. So the weight shows, and the "alike" feel comes from the hits (see 6). **Proposed (ours, not done):** a small top-speed cut for heavy weapons, if the user wants more difference. |
| 3a | Bigger arenas with destructible obstacles | The multiplayer arenas (ARIA, ARIA2, ARIA3) have **no** destructibles. The story ARENA has crates and cages (health 6–30). Camera: 800×600 view, no zoom, follows one machine (ARIA, ARIA2) or all (ARIA3). | **Done (ours):** setting "Arena": Classic, Crates, Big (1.5×), Huge (2×). The TV shows the whole arena (zoomed out). Static pillars; crates break after 30 damage into splinters and coins, take no damage in the warm-up, and come back each round. Details in section 3. |
| 3b | Machines leave the frame at the top and bottom | Hard position clamp at the arena rectangle + 100 px (0x469570), no spring. | **Done:** hard top and bottom walls inside the frame (bounce 0.3). The sides keep the soft limit. |
| 3c | Where is the recording? | – | `C:\Users\LENOVO\AppData\Local\thumbtide-logs\playtest-20261116-0247.jsonl` (room SRNJ). Report: `node tools/perf/playtest-report.mjs <file> SRNJ`. |
| 4, 9 | Coins collectible by the weapon | Coins go to the owner of any touching hull **or held weapon part** (0x420d30). | **Done (original).** |
| 5 | Shorter warm-up; per round or per match | Duel is one round; no warm-up. | **Done (ours):** pick 5 s (was 8), first 10 s (was 12); setting "Weapon pick: every round / each match only" (3-2-1 between rounds, loadout fixed). |
| 6 | Swords hit like maces; blade spine; slices vs rams | Two sides per weapon: the `_u` side multiplies sharpness and bladeable (an axe back: sharp 0.5, never cuts). The cut factor C (up to 10) needs the blade to move across the contact normal. Otherwise no blunt/sharp rule. | **Done (original):** side values from the factory for 9 weapons (kathib, saian, silverblade, severn, berdish …). **Done (ours):** a blade's edge that hits head-on does 0.8 of its sharpness; a cut needs 100 px/s relative speed (tuned with the soak below; 0.6 / 150 cut sword damage in half). |
| 7 | Stun too short; should depend on hit type, damage, and on hitting something after | Stun only when M > 30, +0.01·M, max 1 (≈ 0.5 s at full health). No type rule, no knockback beyond the impulse. | **Done (ours):** blunt × 1.6, cut × 0.35 of that, max 1.5; a **slam** (machine, debris, obstacle; floor or ceiling at 150 px/s or more) within 0.8 s adds stun once. |
| 8 | Giblets that hurt while they fly | Detached parts become harmless layer-0 debris. | **Done (ours):** 5 shards (3 on the TV), sharpness 3, hurt for 2.5 s, then pass through. A shard's hit counts for whoever wrecked the machine. |

Bot rounds after these changes: 2 machines 29 → 54 s, 4: 47 → 53 s, 8: 55 → 65 s (fewer grind hits, more misses).
The 2-machine round is now near the 60 s sudden death; check this in a play test.

Full soak (every melee weapon, 40 s against two bots), mean per class, before this work → now:

| Class | Damage dealt | Hits | Damage per hit | Time stunned | Biggest hit |
|---|---|---|---|---|---|
| Hammer (8) | 163 → 111 | 129 → 40 | 1.3 → 2.8 | 8 → 21 % | 26 → 23 |
| Axe (8) | 175 → 101 | 119 → 39 | 1.5 → 2.6 | 10 → 22 % | 30 → 20 |
| Mace (11) | 135 → 105 | 106 → 37 | 1.3 → 2.9 | 9 → 20 % | 20 → 46 |
| Sword (15) | 155 → 117 | 102 → 42 | 1.5 → 2.8 | 10 → 20 % | 28 → 46 |

Fewer, harder hits; longer stuns; swords and maces now have the biggest single hits (slices, heavy heads).

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

## 3. Arenas (done) and the TV

- The whole arena is on the TV: a bigger arena is a zoomed-out view (the scale changes once per arena, so the
  cached pictures stay valid). Classic and Crates are 960×540; Big 1440×810; Huge 1920×1080.
- Obstacles: 2–3 static pillars and 2–5 crates (health 30). A broken crate: 4 wooden splinters (they hurt the others
  for 2.5 s, not the breaker) and coins. The arena is rebuilt every round.
- Hard top and bottom walls at the arena edges; the sides keep the soft limit.
- Not done: a floor for wrecks and coins; hanging cages; obstacle-aware bots (they bump into pillars).
- In the Huge arena the machines and names are half size on the TV. Check that this is readable from the sofa.

TV (LG 43SQ700S, perf build, 8 machines, melee tour), the same night:

| Build | fps (mean of runs) |
|---|---|
| Start of the night | 36–40 |
| Weapon pictures, grouped sparks, cached numbers, HUD bars without transitions | 52–55 (55–57 without the HUD) |
| This branch, Classic arena | 54.0–56.1 |
| This branch, Huge arena | 55.1 |
| 3 K.O.s every 6 s | dips to 45–50 (35 at worst), the same with and without shards |

Worst set: 8 flails and maces at once, 51.9–55.1 fps, physics 1.3–1.7 ms, 9–16 frames over 25 ms in each 2 s.
60 fps with 8 machines is not reached yet. The TV's GPU thread is the limit (trace: ~15 ms of GPU tasks per frame
under tracing). Open: the TV merges the whole HUD into one full-screen layer, and that layer repainted in every
traced frame, while the page changes only ~0.2 times per frame; the cause is not found.

## 4. From the play test (data, not notes)

- Too easy: the user won 45 of 49 rounds against 1–2 CPUs. CPUs need levels (reaction delay, aim error, aggression).
- Full stick tilt 85–100 % of the time: the part-tilt range is unused; responsiveness is top speed and turn rate.
- Shield never used; guns fired 1–8 times per round. The shield needs a clearer use or a prompt.
- Half of the session was menus (now shorter, see item 5).
