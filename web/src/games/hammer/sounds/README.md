# Rotor Brawl sounds

Hammerfight's own sounds, copied unchanged from the dev copy's `Media/Sounds` (licensing is handled by the project
owner). `audio.ts` plays them; any file that fails to load falls back to the WebAudio synth.

Which file plays for which event, from the exe (addresses in the dev copy v1.004):

| Event | File | Exe |
|---|---|---|
| Hit, by material (louder with impact, lower for heavy blows) | `metall_01..05`, `wood_01..03`, `stone_01..03` | 0x50eb50 |
| Blade cut | `bladaway_01..03` | 0x403c23 |
| Sparks (we use it for weapon clashes) | `spark_01/02` | 0x4062f0 |
| Chain pulled taut (we use it for a disarm) | `chain_01` | 0x463041 |
| Machine destroyed (K.O.) | `explo_03` | 0x41e410 |
| Explosive blast | `explo_02` | 0x416fd4 |
| Gunshot | `shoot_03` | 0x41a1f7 |
| Coin pickup and bounce | `gold_01/02` | 0x44f990, 0x50eb50 |
| Crowd beat (we use it on "fight") | `drum_01` | 0x4be240 |
| Arena event (we use it on "round") | `gong` | 0x4c0ec0 |
| Crowd cheer (we use it on a win) | `aplause_01` | 0x4538a0 |
| Arena music (ARENA, ARIA_multy, ARIA2_multy): our fight | `battle_mid_02` | ARENA.seria |
| ARIA3_multy music: our warm-up | `battle_small_01` | ARIA3_multy.seria |

Total about 2.2 MB. The effects (about 330 KB) are decoded one at a time after the game starts; the two music
tracks are streamed by one `<audio>` element and never decoded into memory, except on the TV: there the element cost
~3 fps in every fight, so it plays `battle_mid_02.mono.ogg` and `battle_small_01.mono.ogg` (mono copies, made with
`ffmpeg -i battle_mid_02.ogg -ac 1 -c:a libvorbis -q:a 4 battle_mid_02.mono.ogg`) decoded once and looped by WebAudio
(~6 MB each in memory).
