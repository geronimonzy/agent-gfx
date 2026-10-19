---
name: look-design
description: Use when asked to make, rebuild or extend a gfx look - "make the look <id> from its BRIEF.md", a look from reference images/videos and a prompt, "a look from this project", "rebuild the sample scene of look <id>" - writing LOOK.md, preset.js, sounds.json, refs/ and the sample scene of a Library look in the motion-graphics harness.
---

# Look design (gfx harness)

A look is a folder `looks/<id>/`: `LOOK.md` (rules), `preset.js` (style tokens), `sounds.json` (sound palette), `refs/`
(references), plus Library-side files: `sample/` (the test-card scene), `thumb.jpg`, `preview.mp4`, `analysis.json`.
Format and CLI: `<engine>/docs/LOOKS.md` §2 and `<engine>/docs/LOOK-PIPELINE.md` (`<engine>` from `.gfx/engine.json`,
see `motion-graphics`). Principle: **the device measures, you interpret.** Every rule that comes from a measurement
cites it ("beats ~1.2 s, refs: median shot 1.1 s"); everything else is marked as your judgement.

## Where
- The look lives in the **Library**: `<Library>/looks/<id>/` (the path is in the request or in its `BRIEF.md`; the
  studio writes `BRIEF.md` there with name, prompt, notes, references and "Start from"). Write only inside that folder.
- `gfx look … --library <Library>` for every look command. Never touch other looks, and never a project's pinned copy
  (`<project>/looks/<id>/`) unless the user asks: projects take Library changes with "Update from library".

## Steps
1. **Inputs.** Read `BRIEF.md` if present (prompt, notes, references with a note each, `startFrom:` `prompt` /
   `references` / `project` / `both`, `sample:` `yes` / `no`). Otherwise ask for what's missing: name, a one-line feel,
   references. `gfx look --help` and `gfx look <cmd> --help` list every flag.
2. **Measure.** `startFrom: prompt` (no references, no project): **skip this step and step 3's numbers**; there is
   nothing to measure, so every rule in LOOK.md is your judgement, and its References section says "prompt-only,
   judgement" (don't invent numbers). Otherwise: `gfx look analyze --refs <file>... [--from-project] --out <look>/analysis.json` (no `--refs` with
   only "This project"). Read the summary it prints (`--json` for everything). Then **view the reference images
   yourself** (Read them; for videos, extract 3-4 frames with ffmpeg into a temp folder): shapes, texture, type,
   composition and mood are not in the numbers.
   "This project": `--from-project` gives presets, easing counts, tween durations, formats and the sound palette in
   use; also read each scene's code and make one contact sheet per scene (`gfx sheet <scene>`). The project is the
   brief's `project:` path (frontmatter) when present: pass `--project <path>` to analyze / sheet; otherwise the
   current project.
3. **Interpret** (the numbers → rules):
   - `summary.palette` (shares) → colour tokens: the largest dark/light share is `bg`, the best-contrast one `text`, a
     high-chroma colour with a small share is `accent` (one accent, unless the refs clearly use two). `light` < 0.35 =
     dark look, > 0.65 = light look. `contrast` < 0.25 = soft / low contrast; > 0.5 = punchy. `contrast` is p90 - p10 of lightness, so type on paper
     (small dark text on a 90 % light page) reads as "soft" there: also read `inkContrast` (the lightness distance
     between the dominant colour and the most distant colour with a share >= 1 %). Low `contrast` with a high
     `inkContrast` = a light page with strong ink (editorial, print), not a soft look. `saturation` < 0.15 =
     muted; > 0.4 = vivid. `temperature` decides the greys (warm → paper/cream greys, cool → slate/blue greys).
   - `pacing.shotLen.median` → beat length (one idea per beat); `cutsPerSec` > 0.5 → hard cuts between beats, ~0 →
     continuous motion with transitions; `motionLabel` calm / medium / kinetic → easing and move size (calm: long
     `inOutSine` / `outCubic` 700-1200 ms, small moves; kinetic: `outExpo` / `outBack` 200-450 ms, whips, big moves).
   - `sound.onsetsPerSec` → cue density (≈ cues per second of the scenes this look makes); `bands`: low-heavy → thuds,
     booms, impacts; high-heavy → ticks, clicks, airy whooshes; mid → pops, swooshes, chimes. `lufs` is the refs'
     loudness, not a target (the mix is normalised to -14).
   - Project numbers (`project.eases`, `durations.median` / `p90`, `sound.cuesPerSec`, `sound.sounds`) are the
     project's habits: keep the ones that define its feel, say which you dropped.
4. **Write the look.** LOOK.md first (nothing can use the look without it).
   - `LOOK.md`: frontmatter `name`, `description` (one line), `tags`, then the sections **Motion** (easing names,
     durations, beat length, stagger, transitions, camera), **Typography**, **Colour & style**, **Sound**, **Do /
     Don't**, **References** (one line per file in `refs/`: what to take from it). Rules are short and concrete
     ("entrances `outBack(1.4)` 350 ms, stagger 60 ms"), measured ones cite the number.
   - `preset.js` (format: `<engine>/docs/CONTRACT.md` "Style presets"): all of `bg grid gridStrong stroke text muted
     accent accentSoft surface border` (more keys are fine), `fonts` (`sans`, `mono`, and e.g. `display` / `serif`: every key `fonts.<key>` becomes the CSS variable
     `--gfx-font-<kebab-key>`, e.g. `--gfx-font-display`, and is also `ctx.style.fonts.<key>` in JS),
     `fontFiles` with the bundled files, `radius`, `ease { out, inOut, spring }` (anime.js names). **Fonts only from the
     bundled set** in `<engine>/style/fonts` (latin, woff2): Inter 400/500/600/700, IBM Plex Mono 400/500/600, Ubuntu
     300/500, Fraunces 400/600/700 (serif), Nunito 400/600/800 (rounded), Fredoka 400/600/700 (playful), Space Grotesk
     400/500/700 (display grotesk). A wish for another font goes into LOOK.md Typography as a note ("closest bundled:
     …"). Pattern:
     ```js
     const font = (family, file, weight) => ({ family, url: `/style/fonts/${file}`, weight: String(weight) });
     // fonts: { sans: "'Nunito', system-ui, sans-serif", mono: "'IBM Plex Mono', ui-monospace, monospace" }
     // fontFiles: [font('Nunito', 'nunito-latin-400-normal.woff2', 400), font('Nunito', 'nunito-latin-800-normal.woff2', 800)]
     ```
     File names: `<family-lowercase-dashed>-latin-<weight>-normal.woff2` (`ls <engine>/style/fonts`).
   - `sounds.json`: roles from LOOK.md Sound, one entry per role:
     `{ "role": "whoosh", "sound": "whoosh", "variant": "air", "params": { "intensity": 0.4 }, "tags": ["soft"], "note": "moves, gain -8" }`.
     Synth sounds include `beep` (variants `soft`, `digital`) and `wind` (`breeze`, `gust`; takes `dur`; a bed for calm looks).
     Synth sounds and variants: `<engine>/docs/CONTRACT.md` "Sound library" + "Intensity, variants". When a sound
     library is installed (`gfx lib list --json` has enabled, indexed sources), pick samples by role with
     `gfx lib search "<text>" --role hits|motion|ui|accents --json` or `gfx lib similar <entry> --json` (check
     `license`), and give **every** sample entry an `alt`, the synth fallback used where the library isn't installed.
     You cannot listen, so look before you choose: `gfx lib files [--source kenney] [--grep book] [--role ui] --json`
     browses files, `gfx lib info <src> --json` shows labels, role, bands, duration and licence of one. Search is
     hybrid (CLAP text + keywords over file names, packs and tags); a hit with `weak: true` means **no good match**:
     use a synth sound instead of that sample. Role filters hide some good files (page turns are tagged `accents`),
     so also try without `--role`, and `lib similar` from a first decent hit. Palette entry with a sample:
     `{ "role": "paper", "sound": "sample", "src": "kenney/rpg/bookFlip1.ogg", "start": 0.04, "dur": 0.5, "alt": { "sound": "swoosh", "variant": "silk", "params": { "intensity": 0.3 } }, "tags": [], "note": "page turns" }`.
     `src` is the **library-relative path** `<source>/<file>` exactly as `lib search --json` reports it (not a repo
     path, not an index id); `start` / `dur` (seconds, top level, optional) are the slice from the hit; `params` are
     cue options (`pitch`, `gain`, `intensity`). Where `src` doesn't resolve (`gfx lib info <src>` exits 1) the entry
     plays its `alt`.
     Typical roles: whoosh, transition, ui, tick, hit, result, logo (+ the look's own, e.g. paper, wind, boing).
   - `refs/`: copy the references in (keep the user's file names, cleaned to `[a-z0-9._-]`); downscale big images
     (`ffmpeg -i in -vf "scale='min(1600,iw)':-2" out.jpg`); from a long video keep a few stills or a short clip. Aim
     for ≤ 2 MB for the whole look.
5. **Sample** (unless the brief says no): build `<look>/sample/` from `<engine>/templates/looks/_sample/BRIEF.md` (the
   test card: same content for every look, the look's motion style) with the motion-graphics method and the kind skill
   (anime unless the look calls for another). `scene.json` `"style": "look-<id>"`. No sound. **Timing:** the card is 6 s
   with 4 beats and the thumb is taken at 70 % (4.2 s), so the accent beat must hold through 4.2 s. A slow look (beats
   of 2.5-3.5 s) overlaps the beats instead of rushing them; the preview shows the style, not the real beat length (say
   so in LOOK.md). Check, in this order:
   - `gfx look preview <id> --library <Library> --sheet` writes a full-size contact sheet of the sample (path printed;
     Read it): beats, overlaps, type, hairlines. It works straight from the Library folder, no temp project. Fix, repeat.
   - `gfx look preview <id> --library <Library> --still-only [--t <sec>]` for one thumb, then the full
     `gfx look preview <id> --library <Library>` (thumb + 6 s clip; the studio's cards use them; prints phase lines).
     Thumbs and clips are rendered large and downscaled, so 1-2 px grid lines survive.
   - `gfx look check <id> --library <Library>`: the validator (preset keys, bundled fonts, synth sound names, every `src`
     has an `alt`, sample valid, folder <= 2 MB, LOOK.md frontmatter). Fix everything it reports.
   - `gfx look audition <id> --library <Library>` renders one cue per palette role in sequence (wav + label image):
     proves every sample and `alt` plays; view the image.
   `gfx look use` needs LOOK.md to exist (a look with only BRIEF.md is "pending"): write LOOK.md and preset.js first.
6. **Report**: what was measured (the summary numbers you used), the main rules, which rules are guesses, fonts or
   sounds that were wished for but aren't available, and the paths written.

"Rebuild the sample scene of look <id>": only step 5 (read LOOK.md and preset.js first; keep everything else).

## Rules
- Measured beats guessed: when the refs say 0.8 s shots, don't write "2-3 s beats" because it feels nicer; if the
  prompt contradicts the refs, follow the prompt and say so in LOOK.md.
- One look = one consistent family: one or two type families, one accent, one easing family, one sound family per role.
- Never copy reference artwork, logos or characters into `sample/`; the sample uses the test-card text and the look's
  own shapes.
- Don't run `gfx look use` / `update` / `save` unless asked: making a look and pinning it into a project are separate.
