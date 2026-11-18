# Rotor Brawl bots: the fight rhythm (2026-11-18)

The play test said: "the bot AI is too monotonous, they keep chasing while swinging; implement the AI behaviour of the
original game; they look too fast, check their speed". This file records the original's model, what `bots.ts` copies
from it, what is different and why, and the numbers before and after. The RE detail is in `RE_AI.md`.

## 1. The original's model (story NPC machine, RE_AI.md 2)

- **One task: attack the chosen target.** The target comes from a utility vote (nearest, least crowded; a third
  attacker never joins a target with two). A target that is heavily stunned is left alone.
- **A state machine with timers** (0x4ae940, checked again in the exe for this work):
  - **engage** (4–6 s; the timer runs twice as fast inside the far range, so about 2–3 s once close) →
  - **back off** (2–3 s): hold a 250 px ring round the target at half gains, spiral out when inside it. A stunned
    target ends the back-off at once with a new 4–6 s engage (0x4ad7ca: target stun ≠ 0 → state 3).
  - From far away (≥ 500 px from the target's edge) engage picks once: **charge** 2–3 s (90 %, straight at the target)
    or **whirl** 1–2 s (10 %, swing hard in place).
  - Inside engage, a coin flip per window: **"wind up and close"** (swing 2, pull 4) or **"all in"** (swing 3, pull 6);
    close in (< 100 px): swing 4.
- **Threat reaction** (0x4ac210, decoded for this work): within `max(1, 0.35 × enemy weapon speed)` px of the enemy's
  main weapon, steer **away** from it with gain `3 · (1 − d/r)`. (RE_AI.md said "at the weapon"; the vector 0x55d738 is
  weapon − own hull and the code negates it.) A second branch, the head predicted 3 frames ahead within 50 px of the
  hull, sets two fields (+0x428, +0xa08 = 0.3 s) that were not decoded.
- **Speed:** no stick. Thrust = steer sum × `PH_THRUST_NPC` with linear drag: about 80–85 px/s per unit of steer, so
  250–500 px/s while engaging and about half that while backing off. The player's own machine is clipped at 350 px/s
  (mouse).
- **Personality = data:** level (thrust, drag, stun recovery), weapon, armour. No aggression or courage numbers. The
  drama comes from the random picks and timers, rage, the weapon throw and the voice lines.

## 2. Why our bots read as "chase while swinging" (before this change)

1. **No phases.** `driveBot` computed a strike spot beside the target every frame and pumped the weapon there. The only
   "back off" was +45 px for 0.45 s after a hit.
2. **The bots never saw an event.** The host and the benches clear `arena.events` right after each step, and
   `driveBot` read it before the next step: it was always empty. So the engagement clock (`quiet`) never reset: from
   5 s into each round the gap that holds a bot outside until its swing is in phase was 0 for good, Flak and Jackal
   dropped their stand-off range, grudges and the post-hit stand-off never fired.
3. **Full stick all the time.** `thrustStick` always solved for full tilt, so the force was at the 420-unit cap in
   78–92 % of the frames, and the stick held the 550 px/s top speed in every direction it pointed.
4. **The approach was the swing.** From any distance the bot flew to the strike spot while pumping, so it closed in
   with the head circling: the play test's picture.

## 3. What `bots.ts` does now

- **Phases** (`Rhythm` per profile, `nextPhase`): engage window → back-off → engage; charge or whirl from far away;
  re-engage on a stunned target (after 0.6 s for the hit-and-run styles, at once for Thump); a nearly beaten target,
  sudden death and worms keep the bot engaged (worm waves are cleared as before).
- **Back-off:** a ring of 2.6–3.6 weapon reaches (at least 250 px) round the target, on the side away from other
  attackers (the flank rule), circling with random turns (a feint), winding the weapon up, at the back-off tilt.
- **Engage:** the old skill core (pump, lunge in phase, edge-first spin, dodge, combo, killing blow), with the
  original's coin flip per window: all in (no gap) or wind up and close (30 % of the profile's gap).
- **Ours, not in the original:**
  - **Hit and run:** after a landed hit, a chance to break off at once (Razor 0.55, Jackal 0.5, Lance 0.4, Thump 0).
  - **Standoff:** when the bot I fight backs off from me, a chance that I fall back too, so the two circle before the
    next pass (Bulwark 0.55, Thump 0.2, others 0.35).
  - **Counter from the ring:** a bot that has backed off for 0.5 s with its weapon wound up meets an enemy that comes
    inside half the ring. Without it, a back-off from a chasing enemy bot cost 5–7 s per round.
  - **A charge needs a clear line** (`clearPath`, obstacle boxes; the original's bit 0x100 ray test does the same).
  - **The detour** (held off the spot for 1.2 s → go round toward the middle) now works in every phase.
- **The stick has a tilt:** `thrustStick(…, tilt)` finds the stick of that tilt whose thrust points the wanted way.
  The force stays full from half tilt (stickPush), but the stick holds only 550 × tilt px/s. Engage 0.75–0.95, a
  strike or a finish 1, back-off 0.4–0.6, charge 1. A phone player has the same model.
- **Events:** `Arena.lastEvents` (sim.ts) keeps the last step's events; the bots read that.
- **The away-player autopilot** (`pilot`) follows the original's player autopilot, which rarely backs off: back-off
  0.5–1 s, no standoff, almost no hit and run.
- Kept: crowd rule (no third attacker), spacing and flanks, team modes, co-op vs CPU and vs worms, gun aiming,
  edge-first spin, the away-player autopilot. driveBot allocates nothing new per step (scratch vectors; the stick and
  flank helpers write into them; grudges fade every 5th step).
- **Different from the original, and why:** the engage windows are 1.5× the original's (6–9 s nominal, 3–4.5 s close
  in) and the back-offs shorter (0.8–2.4 s, the original 2–3 s): with the original's split, rounds got 30–50 % longer.
  The ring is in weapon reaches (2.6–3.6, at least 250 px), not a fixed 250 px.
- **Not copied:** rage (no taunt on the phone), the weapon throw, the tumble gate (|ω| > 6 rad/s), weaker below half
  health, voice lines, the 7 s lost-target timeout (all targets are in view).

## 4. Numbers (benches in `web`, seeded)

Speed and stick (`speed.bench.ts`, `ROUNDS=16`: classic, crates, big, eye × ffa, mix, teams, pve, pvm; frames alive
and not stunned; "fast" = over 440 px/s; "at cap" = force at the 420-unit cap). `chaser` and `spinner` are the
synthetic human-like pilots (full stick at the nearest enemy; whirl and drift), not recorded players.

| | mean px/s | p90 | fast | at cap |
|---|---|---|---|---|
| bots before (8 personalities) | 282–323 | 463–538 | 13–23 % | 78–92 % |
| bots after | 260–310 | 413–488 | 5–18 % | 63–80 % |
| autopilot before → after | 334 → 312 | 538 → 463 | 26 → 10 % | 83 → 69 % |
| chaser / spinner (reference) | 311 / 317 | 488 / 513 | 18 / 21 % | 98 / 92 % |
| the original NPC (RE) | 250–500 engaged, about half backing off (its px; our clip is 550 vs its 350) | | | |

Bots no longer out-fly the human-like pilots on these. One number is still higher: the turn rate of the stick
(Razor 13.2 rad/s, Thump 11.1, the others 6–10; chaser and spinner about 9): the pump turns the stick with the head.

Rhythm (after): share of armed time in back-off: Lance 35 %, Jackal 27 %, Krank 25 %, Razor 23 %, Flak 23 %,
Dervish 17 %, Bulwark 12 %, Thump 11 %, autopilot 7 %; mean distance to the target 190–250 px backing off, 150–215 px
engaged. Time within 150 px of the nearest enemy: before 59–71 % (Lance 45 %), after 39–65 %.

Rounds (`playtest.bench.ts`, `ROUNDS=6`: 10 arenas, 60 rounds per mode, 4 machines):

| mode | round s before → after | hits/min | pile | stuck | notes |
|---|---|---|---|---|---|
| ffa | 23.7 → 29.1 | 182 → 147 | 8 → 6 % | 0 | |
| teams | 18.6 → 24.7 | 195 → 140 | 12 → 7 % | 0 | |
| pve | 16.3 → 21.5 | 187 → 149 | 12 → 6 % | 0 | |
| pvm | 9.6 → 9.7 | 716 → 660 | 2 → 2 % | 0 | worms killed 3.0/3.0, lost 0 % |

Rounds are 20–33 % longer, more than "not much longer": the back-off time is the price (each of the event fix, the
tilt, the wind-up gap and the charge costs about 1–2 s more). Time up stays at 0 %. 8-machine free-for-all
(`bots.bench.ts`): 30.3 → 33.9 s.

Balance:
- Duels (`bots.bench.ts`, 4 arenas, both sides), win share before → after: Dervish 50 → 51 %, Thump 51 → 65, Razor
  48 → 52, Krank 72 → 63, Lance 78 → 80, Bulwark 68 → 66, Flak 65 → 58, Jackal 73 → 77, autopilot 44 → 46. Chaser
  and spinner win 35 and 34 of 216 duels against the bots (before 32 and 39).
- 4-machine rounds (`speed.bench.ts`, ffa, mix, teams, pve; 112 rounds each), wins before → after: Jackal 50 → 64,
  Lance 51 → 58, Thump 37 → 43, Bulwark 39 → 40, Flak 36 → 39, Krank 47 → 38, Razor 49 → 36, Dervish 34 → 23. The
  spread grew (1.5× → 2.8×). A sweep of Dervish's and Razor's rhythm (no hit and run, less standoff and whirl) did not
  move their wins; open.
- `modes.bench.ts` (24 rounds each), the first side's wins before → after: lance+jackal v thump+krank 58 → 88 %,
  flak+jackal v lance+razor 33 → 33 %, bulwark+thump v krank+dervish 71 → 75 %, CPU (lance, jackal) v two chasers
  58 → 79 % (CPU side), worms 100 → 100 % cleared.

Performance: bench wall time per simulated second (physics and bots, this PC) 6.2 → 5.2 ms. Not measured on the TV.

## 5. To check on the TV

- Does the back-off read as "hang back and wind up", and the standoffs as circling, not as fleeing?
- Speed: if bots still look fast, lower `tilt` / `backTilt` in `PROFILES` (`rhythm`); the force is unchanged.
- Rounds are longer by about 5 s; if that drags, shorten `back` or lower `mirror` in `RHYTHM`.
- Co-op vs CPU: the CPU beats the synthetic chasers more often (79 %, before 58 %); check it against real players.
