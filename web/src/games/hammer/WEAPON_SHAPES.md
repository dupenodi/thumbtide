# Weapon shapes: what each part looks like, what it does

Every weapon part now behaves like its drawing: spikes pierce and can hook in, blades cut when they slide, blunt
heads knock back, the saw grinds, and shafts, grips and chain rings only push. The collision meshes follow the drawn
heads, spikes and blades. Data: `weapons.ts` (`PartSpec.faces`, `facesOf`); logic: `sim.ts` (`faceAt`, `hurt`,
`hook`, `holdHooks`, `grind`); numbers: `tuning.ts` (the "weapon faces" block). Original data: RE_WEAPONS.md §1, §3.2,
§5.1.

## 1. The model

**The frame.** Part-local px, origin = the sprite's hotspot, +x away from the machine (the rod end is at −x), +y = the
`_d` face (the full edge of a one-sided weapon, as the sprites draw it), −y = the `_u` face. One sprite px = 1 px.

**Which face touched.** `faceAt` takes the contact normal (from the weapon toward the other body) in the part's frame
and finds the part's feature that sticks out furthest that way: a mesh vertex (a spike's point, a blade's tip), or the
middle of a mesh edge that faces that way (a hammer's face). The first face in `faces` whose box (`x0 x1 y0 y1`,
open where left out) holds that feature wins. The contact point is not used: on a flat contact it is only one corner
of the overlap. A face can also ask for a `side`: the sign of the normal's local y. A part with no `faces` gets two
faces from its side values by that sign: normal toward +y → `sharpness` / `bladeable`, toward −y → `sharpnessU` /
`bladeableU`. This is the exe's own side test (0x512ff0 reads the contact normal, RE_WEAPONS.md §3.2) with the sign
the art shows. Before, the side came from the contact point's local y (`edgeAt`, still exported): on a curved sabre
the outer part of the edge (near the tip, where the edge bends past y = 0) counted as the back; now the whole
convex edge is the edge.

**What each kind does** (in `hurt`, after the old gates: damage on, not a teammate, not a sidearm):

| kind | does | numbers |
|---|---|---|
| spike | **point-first** (approach ≥ `bluntMinV` and approach / relative speed ≥ `pointOn` 0.8; the exe's head-on test is `|v̂ × N| < 0.2`, i.e. 0.98): damage × `pierce` (1.5), blunt stun, no cut. Then, if `hook` and `spike · (rel + 1) > 300` and the victim body weighs over 34 000, it **hooks in** (§2). Side-on: a blunt knock (with knockback), or a cut if the face has `blade`. | `spike` = m_spikeable × side |
| blade | the old cut: C = clamp((v + 1) · blade · 0.005, 1, 10) when the edge moves across the normal (`|v̂ × N| > 0.7`) at `cutMinV` or more; head-on it is a ram at `bladeRam` × sharpness | `blade` = m_bladeable × side |
| blunt | the old blow (needs `bluntMinV`), full stun; and a **knockback**: a blow with impact > 30 adds min(`kickMax` 100, `kick` 0.8 × impact) px/s to the victim, away from the weapon | `sharp` |
| saw | **grinds**: every 0.1 s while it slides along a machine at `sawMinV` (40 px/s) or more, `sawDmg` (2) damage, with no speed or impulse floor; a hard blow with it is also a blunt hit | `sharp` |
| shaft | **only pushes**: no damage, no stun, no knockback | — |

Rods are not bodies (the drawn shaft has no collider, as in the exe), and chain links, mace hands and handles do not
collide at all (m_layer 0, `solidPart`). So "shaft" faces exist only where a collider holds a shaft, a grip or a ring:
the berdish's top edge, the morning star's hand (layer 8 in the exe), the spiked flail's chain rings, the claw mace's
hinges.

## 2. Hooks (the exe's impale, RE_WEAPONS.md §5.1)

What the exe does (onHit 0x415cc0–0x416141): a weapon-class body that hits a wood body (machine hulls have the wood
bit) heavier than 34 000 head-on (`|v̂ × N| < 0.2`) with `spike · (|v| + 1) > 300` sets its own layer to 0 (it
collides with nothing), and ties itself to the victim with two joints: type 4, radius 5, necess 3, between the contact
point pulled 10 px into each body; and type 0 between the centres, radius = their distance + 5, necess 1. Both live
`0.005 · spike · (|v| + 1)` s (at least 1.5 s; constant 0x53e270). When the life runs out the joint puts the weapon's
layer back (0x463021). The exe adds no damage.

Ours (`sim.ts`): the same test (with `pointOn` for the head-on part), the same two joints and anchors, the spike
non-solid while it holds; the two bodies are pulled together at once by mass share, moving the previous positions too
(no jolt). OURS:
- the hold is `hold` (0.4) × the exe's life, 0.25–1.5 s: a klevec at 600 px/s holds about 1.2 s;
- a **hard pull tears it out early**: before each step (forces applied) the anchors' predicted gap is measured; more
  than `tearPull` (4 px) past the radius (about 200–300 px/s apart, a hard blow or a strong swing) tears it out;
- **tearing out does damage**: `tear` (1.5) × spike × sharpness (klevec 5, pike 5, morning star 6), a `hit` and a
  `tear` event (`pulled` true when a pull did it); a hook that ends because its weapon or victim went does none;
- after it lets go the spike stays non-solid for 0.15 s (it is still inside the hull) and can't hook again for 0.6 s;
- at most 2 hooks at once (`MAX_HOOKS`: 4 extra joints, no extra bodies, no allocation per step), one per victim
  and one per spike. Events: `hook`, `tear` (the host plays a clank and sparks);
- machines only: worms are never hooked (their bodies are light anyway); a hook lets go without damage when its
  weapon is dropped or changes hands, or when either machine is wrecked, parked or respawned.

## 3. Audit

Sides: +y = `_d`, −y = `_u`; +x = the outer end. "Art out" = opaque sprite px outside the mesh by more than 1.5 px
(drawn rods, rings and guards left out), before → after, from `cover.py` over `weapons-atlas.png`. Original = the
exe's final values (sharp / blade / spike, `u/d` where the sides differ). **Bold** = a mismatch that was fixed.

### Hammers

| weapon | sprite | collider | original | before | now |
|---|---|---|---|---|---|
| mallet | wooden barrel, two flat faces | box 22 × 28; art out 0 | 2 / 0 / 0, extra_shock 4 | blunt | blunt + knockback |
| kolotun | two lobes with small rounded nubs (±19.5) | box 17 × 35; art out 1 px | 2 / 0 / 0 | blunt | blunt + knockback (nubs too short to dig in) |
| hammer | plain iron block | box 17 × 29; 0 | 2 / 0 / 0 | blunt | blunt + knockback |
| klevec | block with a **long spike on each striking face** (to ±20.5), knob at +x | **box 16 × 32, spikes 4.5 px out → KLEVEC hexagon, 0** | 3 / 0 / 0 | **blunt everywhere (sharp 3), spikes not in the mesh** | **±y points: spike 1, hook (OURS); block: blunt sharp 2** |
| warhammer | tall flanged head | box 16 × 40; 0 | 2 / 0 / 0 | blunt | blunt + knockback |
| maul (OURS) | hammer_iron × 1.25 | box; 0 | — | blunt | blunt + knockback |
| krankhammer | barrel with short conical caps (±20.5), knob at +x | **box 17 × 34, caps 3.5 px out → KRANK, 0** | 3 / 0 / 0 | blunt | blunt + knockback (cones too short to dig in) |
| goldhammer | flat gold block | box 19 × 31; 2 px (the shaft knob) | 3 / 0 / 0 | blunt | blunt + knockback |

### Axes

| weapon | sprite | collider | original | before | now |
|---|---|---|---|---|---|
| bagor | flat flare on top (−y), a **hook** sweeping down to a point at (−13.5, 22.5) | **file hull, the hook 9 px out → BAGOR, 0** (the hook's hollow is filled: convex) | 3 / blade 1/0 (u/d on the file mesh = our −y/+y) / 0 | +y cuts, −y blunt; hook point not in the mesh | **hook point (x ≤ −6, y ≥ 14): spike 0.6, hook (OURS; a boat hook)**, cuts side-on; +y curve: blade 1; top: blunt 3 |
| axis | crescent round +x/+y, short spike on top (−y) | **5-gon, crescent 4.6 px out → AXIS, 0** | 3.5 (u 1 / d 0.75) / blade u 0 d 1 / **spike 0.3 u only** | +y cuts (2.625), −y blunt 3.5, no spike | **top spike: spike 0.3, hook**; +y and the +x end (x ≥ 12): blade 1; rest: blunt 3.5 |
| mamba | C-shaped blade (horns at −x) | **6-gon, art 5.6 px out → MAMBA, 0** (hollow filled) | 4 / 1 / 0 | cuts all round | cuts all round |
| eclipse | ring blade | **8-gon, art 4 px out → ECLIPSE, 0** | 3.2 / 1 / 0 | cuts all round | cuts all round |
| axe | narrow neck on top, flared blade below (+y) | box 18 × 23; 0 | 3 (u 0.5) / blade u 0 d 1 / 0 | +y cuts, back blunt 1.5 | same |
| pike | a **pick**: two points curving back (±22.5), knob at +x | **box 9 × 45, 4 px out → PIKE, 0** | 3.5 / 0 / **spike 0.9 both sides** | **blunt everywhere** | **±y points: spike 0.9, hook; socket: blunt 2.5** |
| berdish | blade below (+y); **the shaft runs along its top** (y −12…−8) and past it | file hull; the drawn shaft is out (no collider, as all rods) | 3 (u 0.5) / blade u 0 d 1 / 0 | +y cuts, top blunt 1.5 | **top edge (y ≤ −7): shaft, no damage**; +y blade; rest blunt 1.5 |
| goldaxe | **horn spike on top (−y)**, broad crescent below | **box 19 × 35 → GOLDAXE, 0** | 3 / blade u 0 d 1 / **spike u 1 d 0** | +y cuts, top blunt, no spike | **horn (y ≤ −9): spike 1, hook**; crescent (y ≥ 6): blade 1; rest blunt 3 |

### Maces and flails (links, hands and handles never collide)

| weapon | sprite | collider | original | before | now |
|---|---|---|---|---|---|
| flail (OURS) | stone ball (no wooden art) | octagon; 0 | — | blunt | blunt + knockback |
| chainball | stone ball | octagon; 0 | 2 / 0 / 0 | blunt | blunt + knockback |
| orbmace | small dense ball | 8-gon; 0 | 2 / 0 / 0 | blunt | blunt + knockback |
| starmace | **ball with 8 long spikes** (to r 17); hand on a rod | **8-gon 25 × 25, spikes 7.5 px out → STAR (the hull of the points), 0** | 3.9 / 0 / **spike 1**; hand layer 8 | blunt (3.9), hand blunt 1 | **all round: spike 1, hook**; **hand: shaft** |
| stixmace | bar with **three spiked rings** (points ±9.5), ring at −x | **box 35 × 9, points 5 px out → STIX, 0** (ring left out) | 3 / 0 / 0 | blunt 3 | **±y points: spike 0.5, no hook (OURS)**; ends blunt 2 |
| shuriken | 8-point bladed star | 8-gon; 0 | 3.5 / 0.65 / 0 | cuts all round | same |
| silvermace | ribbed egg, ring on top | hexagon; the ring is out (left out) | 3 / 0 / 0 | blunt | blunt + knockback |
| bladeflail | crescent blade (+y), flat top under the chain ring | **6-gon 39 × 20, crescent 4 px out → BLADE_HEAD, 0** (ring left out) | 2 / blade u 0 d 0.9 / 0 | +y cuts | curve (y ≥ −2) and horns (|x| ≥ 15): blade 0.9; flat top: blunt |
| spikedflail segments | chain ring (−x) + crescent blade (+x) | boxes; **spike1's points 4.5 px out → SHARP_SEG1, 0** | 3 / 1 / 0 (all round) | cut all round | **ring half (x ≤ −1): shaft; blade half: blade 1** |
| spikedflail ball | disc ringed with short spikes | **8-gon, 2.6 px out → SHARP_BALL, 0** | 3.5 / 1 / 0 | cuts all round | **spike 0.5, hook (OURS)**; side-on it still cuts (blade 1) |
| clawmace jaw | one curved claw (points ±17), ring at −x | **box 10 × 30 → CLAW_JAW** (ring left out) | 0.5 / 0 / 0 | blunt 0.5 | **claw points (|y| ≥ 11): spike 0.6, hook (OURS), sharp 1.5; hinge (x ≤ −6): shaft**; rest blunt 0.5 |
| clawmace head | body with two curved claws (points −21.5, +19.5) | **box 20 × 30, claws 10 px out → CLAW_HEAD** (ring left out) | 1.5 / 0 / **spike 0.6 both** | blunt 1.5 | **claw points (|y| ≥ 12): spike 0.6, hook; hinge (x ≤ −10): shaft**; rest blunt |
| krankmace | huge studded stone ball | 8-gon; 2 px | 2 / 0 / 0 | blunt | blunt + knockback |

### Swords and the cyclone

| weapon | sprite | collider | original | before | now |
|---|---|---|---|---|---|
| kathib, claw, severn, innata, saian, silverblade, palash, hisaian, imperia | one-edged blades, edge on +y (the engraved or plain back on −y); the guards are outside the blade meshes | file meshes; art out ≤ 7 px, all at the guards (no collider, they never hurt) | blade d 1, u 0–0.7 | +y cuts, −y as the side values | **2026-11-18: point stabs, +y edge cuts, −y spine blunt** (`swordFaces`) |
| sword (katar) | two-edged dagger blade | file mesh | blade d 1, u 0.6 | as the side values | **point stabs, both edges cut (back at 0.6)** |
| liberia | straight double-edged, **pointed tip** to x 30.5 | **box 51 × 15, the tip 5 px out → LIBERIA, 0** (guard left out) | 3.5 / 1 / 0 | cuts both edges | the tip in the mesh; **point stabs, both edges cut** |
| broadblade, goldblade, sunblade | straight double-edged, rounded or short tips | boxes; ≤ 2.5 px | 1 both | cut both edges | **point stabs, both edges cut** |
| cyclone disc | **toothed saw** | 10-gon; 0 | 3 / 0 (Body default) / 0, m_effect_type 7 | cut (bladeable 1) | **saw: grinds** |
| cyclone arm | **wide braced frame** (±11.5), point at +x | **box 50 × 10, 6.5 px out → CYCLONE_ARM, 0** | 1 / 0 / 0 | blunt 1 | blunt 1 + knockback |

### Dual sets

| weapon | part | sprite | collider | original | before | now |
|---|---|---|---|---|---|---|
| twin | head (palash), back (claw) | one-sided blades | file meshes | as palash, claw | +y cuts | as palash, claw (the same face lists) |
| tribune | head (axe_posolski, flipped) | **long spike on top (−y)**, fan blade below | **box 12 × 40 → POSOLSKI, 0** | 3.1 / blade 0.5 (u 0) / **spike u 1 d 0.3** (Demo) | +y cuts 0.5, no spike | **spike (y ≤ −8): spike 1, hook**; fan (y ≥ 4): blade 0.5; rest blunt 3.1 |
| tribune | back (tribun gun) | barrel, **blade hanging under the muzzle** (to y 22) | **file quad sat 6 px above the barrel, blade 11.8 px out → TRIBUN, 0** (the exe has the same gap) | 5 (u 0.3) / blade u 0 d 1 / 0 | whole +y side cut | **only the blade (x ≥ 11, y ≥ 0) cuts; the barrel is blunt 1.5** |

Sidearms (the guns) are unchanged: their bodies never hurt (OURS, RE_GUNS.md). Plates are unchanged.

Every redrawn mesh keeps its part's mass (`sameMass`: the density scales by old area / new area), so handling and
swing weight are the same as before; only the outline and what each face does changed. Every mesh is convex, holds
its origin and has at most 10 vertices (the collision buffers take 16); `sim.test.ts` checks the first two.

## 4. Weapons that changed

- **klevec**: mesh with both spikes; the spikes pierce (× 1.5) and hook in; the block hits at sharpness 2 (was 3 all
  over). Blurb "Spikes on both faces. They dig in."
- **pike**: pick-shaped mesh; both points pierce and hook (exe spike 0.9); the socket is blunt 2.5 (was 3.5).
  Blurb "A heavy pick. Its points hook in."
- **goldaxe**, **tribune head**: horn / top spike pierces and hooks (exe spike 1); meshes follow the art.
- **axis**: top spike pierces and hooks (exe spike 0.3: only above ~1000 px/s); the crescent also cuts at the +x end.
- **starmace**: spiky mesh; the whole ball pierces and hooks (exe spike 1); the hand only pushes.
- **clawmace**: claw points pierce and hook (head: exe 0.6; jaw: OURS 0.6, sharp 1.5); hinges only push.
- **bagor**: mesh with the hook; the hook's point pierces and hooks (OURS 0.6).
- **spikedflail**: segment rings only push, blades cut; the ball's spikes pierce and hook (OURS 0.5), and still cut
  side-on; spike1 and ball meshes follow the art.
- **stixmace**: spiked rings in the mesh; the points pierce (OURS 0.5, no hook); the bar's ends are blunt 2 (was 3).
- **berdish**: the shaft along its top only pushes (was blunt 1.5).
- **cyclone**: the disc grinds (was a cut); the arm's mesh is the wide frame.
- **tribune back**: mesh on the drawn barrel and blade; only the blade cuts (the whole +y side did).
- **bladeflail**: crescent mesh; the horns cut too; the flat top is blunt.
- **krankhammer**, **eclipse**, **mamba**, **liberia**: meshes follow the art (same behaviour).
- **every blunt face** (all hammers, balls, flails' heads, the blunt parts above): knockback on a blow over 30.
- **every one-sided blade** (the sabres, the axes' edges, the twin set): the side is now read from the contact
  normal, so the whole drawn edge cuts, up to the tip.
- **every sword** (2026-11-18, the user: "swords can stab or slice, slicing should work better from edged side and
  'spine' does blunt damage instead"; `swordFaces` in weapons.ts, GUNS_REVIEW.md): the point (the last 6 px) met
  along the blade (contact normal within about 37° of the blade's axis, `Face.nx0` 0.8) stabs: a spike with no
  hook, sharpness × `tuning.pierce`, no cut; met at a glance it still cuts. The +y edge slices (the cut grows with
  the slide). A one-edged blade's back is a blunt spine (it knocks back, no cut; sharpness: the exe's back value,
  or × 0.5 where the exe has none: kathib 1.7, claw 3, innata 2.25); a two-edged blade (katar, broadblade, liberia,
  goldblade, sunblade) cuts with both edges. A chop across the blade that touches with the point's corner first is
  not a stab (the normal test). The bots wind a one-edged weapon up edge first from rest (bots.ts `edgeSpin`).

## 5. Open questions

- Sword points: done (2026-11-18, section 4, "every sword"). The exe has no m_spikeable on any sword; the stab is
  OURS, at the user's request. It moved the sword bot (razor) from 42 % to 36 % in bots.bench (the backs no longer
  cut).
- Rods have no collider (as in the exe): the drawn shaft of a hammer or axe can pass through a machine. Making rods
  solid "shaft" bodies would cost a body per weapon on the TV.
- The cyclone's disc sits on a 12 px rod, half inside the hull (WEAPON_PROFILES 4.3: the exe mounts the arm, not the
  disc). Its saw rarely touches anyone until that mount is fixed.
- Kolotun and krankhammer have small conical nubs; they are treated as blunt. Say if they should dig in too.
- The exe's pair-up call 0x463890 (the snap after making the hook joints) was not traced; ours moves the previous
  positions too, so the snap adds no speed.
- `tearPull` 4 px was set from probes (a 400 px/s knock gives about 5.7 px); check it in a real game.
