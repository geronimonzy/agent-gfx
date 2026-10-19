---
name: sound-design
description: Use when adding, fixing or rebalancing sound effects for a gfx scene - event-driven SFX cues, SOUND.md sound plan, stems, sound.json fixes, loudness, sync checks, applying levels from a gfx studio draft, or matching recorded/library samples - in the motion-graphics harness.
---

# Sound design (gfx harness)

Mechanics (cue API, the 14 synth sounds, incl. `beep` (`soft` / `digital` UI beeps) and `wind` (`breeze` / `gust` noise bed, takes `dur`), intensity/variants, sample cues, sound.json, `gfx audio`) live in the contract, `<engine>/docs/CONTRACT.md` "Audio" (`<engine>` from `.gfx/engine.json`, see `motion-graphics`). This skill is the *method*. You cannot hear: you design from the picture, verify timing on `sync.png`, levels with LUFS numbers, and the user judges the sound in gfx studio.

## Rules (what makes it feel designed, not random)
1. **Only what the eye follows makes a sound.** Background drift, decorative motion and things entering off-focus stay silent. When in doubt, leave it out: 60-80 cues for 15 s is already dense.
2. **Same action = same sound family.** Every receipt landing is a soft pop; every headline slam is an impact. Vary with `pitch`, `intensity`, `variant` and per-cue variance, never by switching to an unrelated sound.
3. **Staggers become rising cascades.** N siblings appearing → N pops/ticks with `pitch: pentatonic(i)`, quiet (-10..-14 dB), panned by `x`. Count-ups → `countTicks(t0, t1, n, ease)` ticks then a `ding` on the landing value.
4. **Hits land on the impact frame**, not where the motion starts (`t` = the frame the thing stops / flashes / shakes). Give the big hits a breath: nothing loud in the ~150 ms before them; a `rise` may end exactly at the hit.
5. **Movement sounds peak where the move is fastest** (`whoosh` peak at `t`, length `dur` ≈ the move). Pan by screen position (`x`).
6. **Three tiers of loudness, set by `intensity` first, `gain` second:** hero (slams, logo: impact punch/boom 0.6-0.9) · support (whooshes, swooshes 0.3-0.5, gain -6..-10) · detail (ui pops/ticks -10..-16). Only 2-3 hero hits per 15 s; reserve `boom` for the single biggest moment.
7. **Accents mark results**, once: `ding` when a value lands, `chime` for success/done. Never four chimes in a row — pops for the first ones, chime on the last.
8. **End card is calm:** a logo hit, then at most soft pops and one click.
9. Prefer fewer, better cues. Overlapping hits within 80 ms read as one mushy hit — drop or merge one.

## Look palette first
If the project's CLAUDE.md names a look, read the Sound section of `looks/<id>/LOOK.md`; `looks/<id>/sounds.json` is the palette: `[{ role, sound, variant?, params?, src?, tags, note }]` (`sound` = a synth sound, or `sample` with `src` = the sound-library **relative path** `<source>/<file>` as `gfx lib search --json` reports it, optional top-level `start` / `dur` seconds for the slice, and an `alt: { sound, variant?, params? }` synth fallback). A sample entry whose `src` doesn't resolve to a file in the installed library (`gfx lib info <src> --json` exits 1: library not installed on this machine, source disabled, file missing) uses its `alt` instead; with no `alt` either, the role counts as having no entry. `params` are cue options (`pitch`, `gain`, `intensity`, `dur`...). Map each event to a palette role and use that entry's sound/variant/params as the base (per-cue pitch/gain/intensity still vary). Use a sound outside the palette only when it has no entry for the role, and list those cues in the report ("outside the palette: …").

## Workflow
1. **SOUND.md before cues.** In `scenes/<name>/SOUND.md`: the rules line, then a table `| t (s) | id | sound | from what on screen | notes |`, one row per beat/event (from STORYBOARD.md + the real tween times in scene.js — read them, don't trust the storyboard). Stems line at the end.
2. **Cues in setup.** `ctx.cue(t, sound, { id, el, gain, pan|x, pitch, dur, intensity, variant })` next to the tween that causes the event, computing `t` from the same variables the tween uses (so retiming the visual moves the sound). Explicit ids for anything a human may want to fix (`snap-slam`, `total-ding`); generated ones for cascades (`lift-0..5`). `el: '<element name>'` links a cue that belongs to one element (it follows that layer when retimed in the studio); leave global hits/transitions unlinked.
3. **Render audio.** `gfx audio <name>` → stems, mix, `sync.png`, `<name>.sound.mp4`. **Read `sync.png`**: every marker sits under its visual event in the thumbnail strip, no lane is a wall of overlapping hits, hero hits stand out in the waveforms.
4. **Levels.** Measure per-stem loudness: `bash tools/lufs.sh out/<name>/audio/stems` (ffmpeg ebur128). Typical balance in the normalized mix: accents loudest, then hits, ui well below, motion lowest (≈ -20 / -45 / -45 / -57 LUFS raw for accents/hits/ui/motion in a balanced reel mix (cf. scenes/_reel-test/sound.json)). The mix is normalized to `master.lufs` (-14 default, -1 dBTP).
5. **Fixes go in `sound.json`**, not in scene code, when they are per-cue tweaks (t, gain, mute, sound swap, variant) or stem gains. Change scene code only for structural changes (new events, removed families).
6. **User review in gfx studio.** The user auditions and saves `out/<name>/review/draft.json` (stem gains, cue overrides, added cues, comments). `gfx context <name>` shows the pending audio edits and open comments in one brief. Apply it: `gfx apply <name> --sound` (or fold by hand), then `gfx audio <name>`. If the user rebalanced against an *older* sound set, carry the balance over by loudness, not by raw dB: target_stem_LUFS = old_stem_LUFS + their_offset; new gain = current gain + (target − measured new LUFS); verify with `lufs.sh`.
7. **Report:** cue count per stem, cues outside the look's palette, the hero moments, any cue you deliberately left silent, paths to `sync.png` and `<name>.sound.mp4`.

## Synth vs library
- Synth (`sfx.js`) is the default: deterministic, tunable per cue, consistent family sound.
- Library samples (`sound: 'sample'`) for things the synth can't do (paper, glass, cash register, real foley). Find them with JSON output (no need to read index files): `gfx lib search "<text>" --json [--role hits|motion|ui|accents] [--max-dur 0.4] [--n 10]`; "something like this cue": `gfx lib similar <scene>:<cueId> --json` (also an entry id or an audio file; `--role any` drops the role filter). Each hit has `src`, `start`, `dur` (use them as the cue's `src`/`start`/`dur`), `role`, `labels`, `why` and `license`. `gfx lib list --json` shows sources, entry counts and licences. The `gfx context` brief has a one-line summary.
- `lib search` is hybrid (CLAP + keywords over file names, packs, tags); a hit with `weak: true` = no good match, use a synth sound. Browse with `gfx lib files [--source <id>] [--grep <text>] [--role <r>] --json`; inspect one file with `gfx lib info <src> --json` (labels, role, bands, duration, licence, resolved path). Role filters can hide good files (page turns are `accents`).
- Check `license` per hit before using it: CC0 / own are free; Sonniss = royalty-free, analysis (indexing, embedding) is fine, but never upload it or feed it to model training.
