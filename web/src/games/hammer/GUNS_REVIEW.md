# Guns review and sword faces (2026-11-18)

The user, after a TV test: "im happy with the chaingun, but every other gun feels off to me yet". The chaingun is the
bullet gun: `BULLET` in weapons.ts, shared by the **arquebus** sidearm and the **tribune**'s back blade. Nothing a
bullet uses was changed (BULLET, RECOIL_SHARE, SHOT_CONTACTS, the aim, the bot's 650 px gate, the bullet sound and
tracer). Proof: in the gun-only run (before the sword change) the arquebus and tribune rows are identical to the
rotor-feel rows, range and duels. Lance bullet damage stays 3.

Measured with `guns.bench.ts` (new): a range test (shooter and target hold their places, the shooter aims as a phone
does; 6 runs, 24 for the single-shot guns) and bot duels (the lance personality with each gun against thump, razor,
krank and dervish, 120 rounds a gun, classic arena). "Land" = the projectile hurt the target (a hull hit, or a blast
that reached it); "blocked" = stopped by its weapon or plate and never landed. The duel "after" numbers below are
the gun-only run; with the sword change too, the foe razor changes, so the rows move a little (arquebus 52 → 45 %).

## Inventory

Every gun: a shot is spent on a machine, its weapon, gun or plate (no bounce); it bounces off walls and crates (CoR
0.3) and goes after 2 contacts (bullets) or 3 (balls); it flies through allies; 1.5 s life; at most 24 shots in the
air. A sidearm's body does no contact damage and breaks at GUN_HP 200. At health_low a shot is lethal. Against worms
a bullet does × 3 (the exe's 0x6c), balls and rockets × 1.

| gun | carried by | clip / between shots / reload | projectile | hit (dmg, push px/s, stun s) | recoil (hull) | bot |
|---|---|---|---|---|---|---|
| arquebus | any non-dual weapon (sidearm) | 20 / 0.1 s / 5 s | bullet 2000 px/s, r 3.5, density 8 | 3, 40, 0 | 9 px/s a shot | lance; within 650 px |
| tribune back | the tribune (dual) | 40 / 0.1 s / 5 s | the same bullet; can't aim (fires along the blade) | 3, 40, 0 | 9 | when the blade points at the foe |
| mortar ("shotgun") | sidearm | 3 / 0.6 s / 5 s | 5 balls ± 0.2 rad, r 5, density 10, 1100 → **1600** px/s | 5, 60, 0.07 a ball | 110 a blast | jackal; within 280 px |
| heavy mortar ("cannon") | sidearm | 1 / – / 5 → **4** s | 1 ball, r 6.5, density 60, 1000 → **1500** px/s | 20 → **16**, 320, 0.6 | 108 | no roster personality (bulwark in modes.bench); within 650 px |
| launcher | sidearm | 3 / 0.5 s / 5 s | rocket 800 px/s, r 4, no gravity | blast r 80: 22, 450, 0.5 (linear fall-off); bounces off held weapons (as the exe) | 0 (as the exe) | flak; within 650 px |

## Per gun: before → after

| gun | what felt off (measured) | change | after (measured) |
|---|---|---|---|
| arquebus, tribune | – (the bar: a hit every 0.1 s, a number each, 85 % land in duels, 9 px/s kick a shot) | none | identical rows |
| mortar | Balls at 1100 px/s (the exe: 2000 ± 400): slow lobs, 48 % land in duels, 36 % duel wins. The 3–5 balls that land together were 3–5 hits: 3–5 small numbers ("5 5 4 5"), sounds and shakes for one blast. It fired with the rocket's explosion sound | balls **1600 px/s**; the balls of one blast that land in the same step are **one hit** (sim.ts `damage`: one number, one sound); a deep bang of its own; muzzle flash, shake 3. Spread kept at 0.2 (0.14 tested: 58 % duel wins, more than the arquebus) | land 58 % in duels; duel wins 36 → 48 % (arquebus 52 %); range 150/300/450 px land 61/37/24 % (a shotgun's fall-off) |
| heavy mortar | One ball every 5.1 s at 1000 px/s: at range it dropped into the target's hanging weapon (450 px: 42 % land, 31 % blocked); in duels 45 % land, 1.8 shots a round, 23 % wins. A miss meant 5 s of nothing. Same sound, shake and recoil as the mortar | **1500 px/s** (the exe's speed); reload **4 s**; damage **16** (so the teams row doesn't grow); a low boom of its own, shake 5 (mortar 3), a bigger flash | land 96/97/92 % at 150/300/450 px, 76 % in duels, 3.1 shots a round; duel wins 23 → 34 %; teams row (bulwark + thump) 88 → 88 % |
| launcher | The rocket sped up again along its **bounce**: a rocket blocked by the target's weapon flew off and went off somewhere else (duels: 37 % land, 19 % blocked, 44 % lost). It launched with the arquebus crack and no shake | thrust along the **launch heading** (the exe: thrust along the body's heading, 0x408123): after a bounce it comes back onto its line in about 0.2 s and flies in again; at most one clank (ping) per rocket per 0.3 s while its thrust presses it on a weapon; a launch sound (soft pop and rush), shake 1.5, flash. Still bounces off held weapons (the user: as the exe) | duels: land 48 %, wins 18 → 33 %; range 150 px land 74 → 73 %, 300 px 51 → 59 %. A blocked rocket now touches the weapon longer (contacts mean 3.5 → 8.2, max 25 → 45; the pings are limited) |

Recoil follows one law for every gun (0.5 × the shot's momentum, 70 % on the hull): arquebus 9 px/s a shot, mortar
110 a blast, heavy mortar 108, launcher 0. Not changed. The aim: the first shot after the gun swings round leaves
3–4° off for every gun (the 11° tolerance is not the problem). A tighter bot range gate for slow shots was tried and
dropped (fewer shots, less damage a round).

Modes (modes.bench, 24 rounds a row, before → after, with the sword change): guns v melee 54 → 58 %, flak + jackal v
lance + razor(mortar) 29 → 33 %, heavy mortar teams 88 → 88 %, worms: the bots win every round either way.

## Swords: stab, slice, spine

The user: "swords can stab or slice, slicing should work better from edged side and 'spine' does blunt damage
instead". `swordFaces` (weapons.ts) gives every sword three faces; the exe's side values stay on the parts.

| face | where | what it does |
|---|---|---|
| stab | the last 6 px of the point, contact normal within ~37° of the blade's axis (`Face.nx0` 0.8, new) | a spike with no hook: sharpness × `tuning.pierce` (1.5), no cut; at a glance it still cuts |
| edge | +y (where the sprites draw the edge, as before) | a slice: the cut grows with the slide (up to × 10) |
| back, one-edged | −y | **blunt spine**: knocks back, no cut; sharpness = the exe's back value (severn 1.05, imperia 1.26, palash 1.5, hisaian 1.6, silver 1.75, saian 2.5) or × 0.5 where the exe has none (kathib 1.7, claw 3, innata 2.25) |
| back, two-edged | −y | a second edge: katar (the exe's 0.6), broad blade, liberia, Arjuna, sun blade (1) |

Edged or not, from the sprites: one edge (plain edge below, back above or engraved): kathib, claw, severn, innata,
saian, silver blade, palash, hisaian, imperia, the twin set. Two edges (symmetric blade): broad blade, liberia,
Arjuna, sun blade, and the katar (a two-edged dagger; it keeps the exe's 0.6 back edge). A chop across the blade that
touches with the clipped point's corner is not a stab (the normal test).

Measured (sim.test.ts swordHit, a 670 px/s slide across a hull): severn edge 43 damage (cut 2.1), spine 5 with
knockback; stab = 0.1 × sharpness × 1.5 × impact. Balance (bots.bench, 8 personalities, 448 duels): razor (the sword
bot) 42 → 36 %, since its backs no longer cut; the rest within ± 5 %. The bots now wind a one-edged weapon up edge
first from rest (bots.ts `edgeSpin`; razor 35 % without it, 36 % with it: within noise; it also applies to the axes).

## For the user's eye on the TV

- The new shot sounds (mortar bang, cannon boom, rocket launch), shakes and muzzle flashes: not heard or seen on the
  TV yet.
- Is "chaingun" the arquebus or the tribune's back gun? Both use the same bullets and are unchanged.
- Which side cuts: the katar (taken as two-edged) and the claw (a hooked blade; taken as edged on its outer +y curve,
  like the other sabres) are the least clear sprites.
- Sword spines: razor got weaker; say if the edges should cut harder to make up for it.
