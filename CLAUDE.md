# Thumbtide

Party games on a TV, played with phones as controllers. See README.md for setup and commands,
docs/making-games.md for how games work, and docs/lg-tv.md and docs/android-tv.md for the TV apps.

- Performance on the LG webOS TV (60 fps target): use the `tv-perf` skill (`.claude/skills/tv-perf/SKILL.md`).
  The tools live in `tools/perf` and must never be imported by `web` or shipped in the TV app.
