# Look pipeline + starter looks (spec, 2026-10-18)

Builds on docs/LOOKS.md (Looks, Library page). The user (2026-10-18): "a pipeline to ask an LLM to create a look based
on references and prompt and an option to create a look from a project"; 6 starter looks; each look gets a sample
scene as its preview.

Principle: **the device measures, Claude interprets.** Claude can only guess pacing and colour from a few images;
`gfx look analyze` hands it numbers (palette, cut rate, motion energy, sound density), so the same references give a
consistent look. Every rule in LOOK.md that comes from a measurement says so ("beats ~1.2 s — refs: median shot 1.1 s").

## 1. `gfx look analyze` (engine, on-device, no Claude)
`gfx look analyze [--refs <file>…] [--from-project] [--out <file>] [--json]` → `analysis.json` (default: stdout).
Only ffmpeg/ffprobe + plain JS (no new dependencies); CLAP is not used here.
- **Images** (png, jpg, webp, gif first frame): scaled to 64×64 RGB → k-means (k = 6, Lab, seeded, merge ΔE < 8) →
  `palette: [{ hex, share }]` sorted by share; `light` (mean L, 0–1), `contrast` (L p90 − p10), `saturation` (mean
  chroma, 0–1), `temperature` (warm / neutral / cool from the a/b balance).
- **Videos** (mp4, mov, webm, gif): duration; cuts via ffmpeg scene detection (`select='gt(scene,0.3)'`) →
  `cuts`, `cutsPerSec`, `shotLen: { median, p10, p90 }`; `motion` = mean absolute frame difference on 64 px greyscale
  at 10 fps, 0–1, plus a label calm (< 0.03) / medium / kinetic (> 0.08); a palette over 8 frames as for images. With an
  audio track: `audio: { onsetsPerSec, bands: { low, mid, high }, lufs }` (onsets/bands via `vox-features.js`, loudness
  via ffmpeg ebur128).
- **`--from-project`** (the current project): presets its scenes use (colours, fonts, radius, ease tokens), easing
  names counted in scene code (`ease: '…'`, anime names, `cubic-bezier(…)`, spring/elastic), tween durations (median,
  p90 of `duration: <ms>` literals), scene formats (size, fps, duration), sound: cues per second and the sounds /
  variants / samples used with counts (from `out/<scene>/audio/cues.json` when present, else the scene's sound.json and
  cues), and the project look id if any.
- **Summary**: `summary: { palette (merged, ≤ 8), light, contrast, saturation, temperature, pacing: { shotLen,
  cutsPerSec, motion } | null, sound: { onsetsPerSec, bands } | null }`. Unreadable files are listed in `skipped` with a
  reason; never fatal unless nothing was readable.

## 2. Sample scene + preview
- Every look may have `sample/` (a scene folder: scene.json, scene.js, …), `thumb.jpg` and `preview.mp4` (same format
  as template previews: long side 480 px, 24 fps, ≤ 6 s, H.264, silent).
- **The test card**: all samples follow one brief, `templates/looks/_sample/BRIEF.md`, so looks are comparable: 16:9,
  6 s, 30 fps: a headline line, a 3-item list / card reveal, one number or accent moment, an end card with a wordmark.
  Each look executes it in its own motion style (pacing, easing, transitions) with its preset. No sound in the sample.
- `gfx look preview <id> [--library <dir>] [--t <sec>] [--still-only]`: makes a temp project (blank template), copies
  the look in (`look use`), copies `sample/` to `scenes/sample`, runs the template `makePreview` (thumb at `--t`,
  default 70 % of the duration; clip unless `--still-only`) and writes `thumb.jpg` / `preview.mp4` into the look folder.
  Progress phases `copy`, `thumbnail`, `preview`. Without `sample/` it's an error that says so.
- `sample/`, `thumb.jpg`, `preview.mp4` and `analysis.json` are **not** copied into a project by `look use` and are
  **excluded from the content hash** (they are Library-side; an updated preview must not offer "Update from library").
  `look save` keeps the Library copy's sample / thumb / preview / analysis.

## 3. Palette entries can use library samples
- A palette entry with `src` (a sound-library sample) may carry `alt: { sound, variant?, params? }`, a synth fallback.
  The sound-design skill uses `alt` when `src` isn't in `gfx lib list` (another machine, library not installed).
- The palette editor shows the fallback as a muted "↳ synth: <sound> <variant>" line under a sample row (read-only).
- Looks from the pipeline pick samples by role with `gfx lib search "<text>" --role <role> --json` / `gfx lib similar`
  and always add an `alt`.

## 4. Skill `look-design` (engine skill, copied into projects like the others)
The steps Claude follows for "make a look":
1. **Inputs**: the brief (name, prompt, notes), references (images / videos, each with a note), and/or "from this
   project".
2. **Measure**: `gfx look analyze --refs … [--from-project] --out <look>/analysis.json --json`; view the reference
   images themselves too (they carry what numbers can't: shapes, texture, type).
3. **Write** `LOOK.md` (the §2 sections of docs/LOOKS.md; measured rules cite the number), `preset.js` (colours from the
   measured palette, mapped to the token keys; fonts only from the bundled set in `style/fonts`, a wish for another font
   goes in LOOK.md Typography as a note), `sounds.json` (roles from LOOK.md Sound; synth entries, plus library samples
   with `alt` when a library is installed). Copy the references into `refs/` with their notes in LOOK.md References.
4. **Sample**: build `sample/` from `templates/looks/_sample/BRIEF.md` (kind anime unless the look calls for another),
   check with `gfx look preview <id> --still-only` and look at the thumb, fix, then `gfx look preview <id>`.
5. **Report**: what was measured, the main rules, which rules are guesses.
"From this project" = the same steps with `--from-project` and the project's scenes as the references (Claude reads the
scene code and a contact sheet per scene).

## 5. Studio
- **New look** (Library page → Looks) becomes one dialog with the New scene window's layout: Name, Prompt, References
  (+ a note each; `pick_refs`), **Start from**: Prompt only / References / This project / Both, **Sample scene** (on), Send to
  (terminal / a new T3 thread, as the New scene window does). Send = write `<Library>/looks/<id>/BRIEF.md` (prompt,
  notes, references, start-from) and send Claude "Make the look <id> from its BRIEF.md (look-design skill)". Kept as
  instant options in the same menu: **Blank** and **Copy this project's style** (today's "From this project's style",
  no Claude).
- **Cards**: `thumb.jpg` when present (else today's refs / swatches); on hover / focus `preview.mp4` plays muted in place
  (the welcome template cards' behaviour and caching). The look editor gets a **Preview** tab: the clip, "Re-render
  preview" (`gfx look preview <id>` with progress), "Rebuild sample with Claude…" (sends "Rebuild the sample scene of
  look <id>").
- The Library page refreshes a look's card when its folder changes (on page focus / return, as today).

## 6. Fonts
Add OFL fonts (latin subset woff2 from @fontsource, licence files in `style/fonts`, THIRD_PARTY_NOTICES, About page):
**Fraunces** (serif, 400/600/700), **Nunito** (rounded, 400/600/800), **Fredoka** (playful, 400/600/700),
**Space Grotesk** (display grotesk, 400/500/700). Bundled set = Inter, IBM Plex Mono, Ubuntu + these 4.
(clean-dark names JetBrains Mono, which isn't bundled: it switches to IBM Plex Mono.)

## 7. Starter looks (templates/looks/, seeded by `gfx look seed`)
Made with the pipeline itself (from a prompt, no references: no third-party images in the repo) — its first real test:
| id | feel | type | sound |
|---|---|---|---|
| fast-paced | kinetic, hard cuts, 0.6–1 s beats, whip slides, high contrast | Space Grotesk | punchy hits, risers, tight whooshes |
| ghibli-soft | warm pastels, painterly gradients, gentle easing, drifting elements, 2.5–3.5 s beats | Nunito | airy, wind, soft chimes, wood |
| clean-dark | (existing, reworked: palette entries with alt, sample, IBM Plex Mono) | Inter + Plex Mono | soft and sparse |
| editorial | paper tones, serif headlines, slow reveals and masks, rules and columns | Fraunces + Inter | paper, soft ticks, page turns |
| playful | bright, bouncy springs, squash and stretch, rounded shapes | Fredoka | pops, boings, bubbly ui |
| tech-minimal | mono type, grids, precise linear moves, data counters | IBM Plex Mono + Inter | precise clicks, beeps, ticks |
Each: LOOK.md, preset.js, sounds.json (synth + Kenney samples with `alt`), sample/, thumb.jpg, preview.mp4,
analysis.json (prompt-only looks have none). Size budget: ≤ 2 MB per look.

## 8. Tests
- `tests/looks.test.mjs` (new): analyze on generated media (ffmpeg lavfi: solid / two-colour images → palette shares,
  light/dark, temperature; a clip with N hard cuts → cuts = N ± 1, a static vs a moving clip → motion labels; a clip
  with clicks → onsetsPerSec > 0), `--from-project` on a temp project, unreadable file → skipped; `look preview` writes
  thumb + clip; hash ignores sample / thumb / preview / analysis; `look use` doesn't copy them; `look save` keeps them;
  palette `alt` survives use / save.
- `tests/project.test.mjs` looks section: seed gives 6 starters.
- E2E library check: New look dialog → BRIEF.md + the composer / T3 send (mock), Copy this project's style, cards with
  thumb + hover clip, Preview tab + Re-render (progress), sample row with alt line.

## 9. Lanes
A (engine: analyze, preview, hash / copy rules, alt, skill, fonts) and B (studio: dialog, cards, Preview tab, palette
alt line) in parallel with disjoint files; then C (starter looks with the finished pipeline, one Claude lane per 2–3
looks, reviewed by the orchestrator from the thumbs/sheets). Codex review per commit.

## As built (engine, lane A; 2026-10-18)
- **`gfx look analyze`** (`runner/lib/look-analyze.js`, CLI in `runner/lib/cli/commands/look.js`; output shape in
  CONTRACT.md "gfx look"). Refs = `--refs <file>` (repeatable) and/or extra positionals. Images (png/jpg/jpeg/webp/bmp/
  tif, a one-frame gif) → 64×64 area-scaled RGB; videos (anything ffprobe sees as a running video stream: mp4/mov/
  webm/mkv/m4v/avi, an animated gif) → 10 fps 64×64 frames (first 300 s), motion = mean |Δluma| (0–1), palette over 8
  evenly spaced frames. Classification uses single-frame metadata or an image codec in an image format; missing
  duration is unknown, and video duration / pacing then use decoded 10 fps frame count / 10 (up to 300 s). Cuts = ffmpeg `scale=160:-2,select='gt(scene,0.3)',showinfo` (times 0.05 s from either end
  dropped), `cutTimes` listed. Audio (first 180 s, 22.05 kHz mono): onsets = `segmentEvents` (vox-features, gate -35 dB,
  `minDur: 0`), `bandEnergies` (< 250 / 250–4k / > 4k Hz), LUFS from `ebur128`. Palette: k-means++ (k = 6, mulberry32
  seed 7, ≤ 24 iterations) in Lab, merge ΔE76 < 8. `saturation` = mean Lab chroma / 100 (clamped); `warmth` = mean
  chroma signed by hue (−20…100° warm, 140…310° cool) / 100; `temperature` warm > 0.03 > neutral > −0.03 > cool.
  Summary: each ref weighs the same; palette merged again (≤ 8); pacing pools the shots of all videos. `summary.source`
  = `refs` | `project` | `both`; `colourFrom` = `refs` | `presets` | null. With `--from-project` and no readable
  image/video, palette + light / contrast / saturation / warmth / temperature come from the presets the scenes use
  (`projectTone`: preset weight = its scene count / all, its colours share it equally, bg / surface / text / accent
  first, merged ΔE < 8, ≤ 8; tone from the colours as 1000 weighted pixels); with refs, colours are the refs'.
  `--from-project` needs a real project (cwd walk-up or `--project`; no engine fallback): presets (imported; engine
  presets are shown as `<engine>/style/presets/<n>.js`), easing counts (`ease:`/`easing:` strings, bare anime names,
  `cubic-bezier(…)`, `spring(`/`createSpring(` as `spring()`), tween durations (`duration: <n>` literals + CSS
  `transition/animation … <n>ms|s`), formats, sound from `out/<scene>/audio/cues.json` (muted cues left out) else
  `cue(t, 'sound', {…})` call sites + sound.json `add` (`from: "code"`, cuesPerSec null); project `cuesPerSec` only over
  scenes with rendered cues > 0. Progress phase `analyze` with `file`.
- **`gfx look preview <id>`**: temp dir in os.tmpdir() → `gfx init --template blank` → `gfx look use <id> --library` →
  `sample/**` copied to `scenes/sample` → `makePreview` (template.js) into a temp media folder → `thumb.jpg` (or
  `thumb.png` without ffmpeg; the other one is removed) and `preview.mp4` published via temporary files in the look
  folder + rename; symlinks and other non-regular destinations are refused with lstat before rendering and again
  before replacement; temp removed.
  `--library` defaults to `<Documents>/gfx library` (templates.js `defaultLibraryDir`). `--still-only` leaves an existing
  `preview.mp4` alone. A failed clip = exit 1 with the new thumbnail kept (`warnings`). ~10 s for a 1.5 s sample here.
- **Library-side files** (`looks.js` `LIBRARY_SIDE` / `isLibrarySide`): top-level `sample/**`, `thumb.jpg`,
  `thumb.png`, `preview.mp4`, `analysis.json`, `BRIEF.md` (coordinator decision, 2026-10-18); `refs/thumb.jpg` etc. are
  normal files. `lookHash` skips them (so hashes
  of existing looks without them are unchanged). `copyLook(src, dest, root, { side })`: `seed` = `'src'` (all),
  `use` / `update` = `'dest'` (never from the Library, the project's own kept), `save` = `'dest-or-src'` (per top-level
  entry: the Library's kept, the project's only where the Library has none).
- **Palette `alt`**: nothing in the engine reads or validates it; files are copied byte for byte, so it survives use /
  update / save (tested). The sound-design skill's "Look palette first" uses `alt` when `src` isn't in `gfx lib list`.
- **Fonts** (§6): `style/fonts/{fraunces-latin-400,600,700, nunito-latin-400,600,800, fredoka-latin-400,600,700,
  space-grotesk-latin-400,500,700}-normal.woff2` (@fontsource 5.3.0, `npm pack` into /tmp, unmodified) +
  `LICENSE-{Fraunces,Nunito,Fredoka,Space-Grotesk}.txt` (the packages' OFL files), 432 KB in all; THIRD_PARTY_NOTICES
  fonts table. clean-dark and the `_new` scaffold presets: `'Inter'` + `'IBM Plex Mono'` with `fontFiles` (Inter
  400–700, Plex Mono 400/500); clean-dark LOOK.md says IBM Plex Mono. `style/presets/dark-grid.js` still names
  JetBrains Mono (not touched: renders must stay byte-identical).
- **Skills**: new `.claude/skills/look-design/SKILL.md` (inputs → analyze → interpret table → write LOOK.md / preset /
  sounds with `alt` / refs → sample from `_sample/BRIEF.md` + `look preview --still-only` → report; "rebuild the sample"
  = step 5 only); motion-graphics: one line after "Project lines" → look-design; sound-design "Look palette first" knows
  `alt`. `templates/looks/_sample/BRIEF.md` = the test card (16:9, 1920×1080, 30 fps, 6 s, no sound; headline "Make it
  move", Plan · Build · Review, accent `24` "frames per idea", end card `gfx` / "motion, reviewed").
- **For the studio (lane B)**: `gfx look list --json` look infos now carry `thumb` (`"thumb.jpg"` | `"thumb.png"` |
  null), `preview` (bool, preview.mp4), `sample` (bool, sample/scene.json), `analysis` (bool), `brief` (bool, BRIEF.md), `pending` (bool, no regular LOOK.md). Pending folders stay
  listed; `look use` refuses them before copying/config changes (exit 2; JSON status `pending` + message).
  Read the files with `library_read_bytes` (`looks/<id>/thumb.jpg`, `looks/<id>/preview.mp4`). Re-render = `gfx look
  preview <id> --library <dir> --progress json [--json]` (phases `copy`, `thumbnail`, `preview`; `done.outputs` = the
  written files; error event on failure; with `--json` the last log line is `{ look, library, t, thumb, preview,
  warnings }`). It needs no project, so route it like `gfx template … --for` (no-project target) or run it in the open
  project (the project is ignored). The About page should list Fraunces, Nunito, Fredoka, Space Grotesk (OFL 1.1;
  licence files in `style/fonts/`).
- **Tests**: `tests/looks.test.mjs` 55 (summary source refs / project / both, BRIEF.md Library-side, colour maths, images incl. skipped reasons, videos: cuts / static / moving /
  clicks / gifs, `--from-project`, Library-side hash / use / save / update / seed, `alt` through use and save, preview
  phases + 480×270 24 fps + `--still-only` + errors); `tests/project.test.mjs` 152 (+4: starter presets name only bundled
  fonts, the four fonts + licences + notices, `_sample` not seeded, look-design skill / pointers / alt); templates 58,
  soundlib 75 unchanged. Byte identity `_reel-test --t 7.61` = 6d98719a277d52ada048977753e322f8.
- Sanity runs: `_reel-test.sound.mp4` → 0 cuts (a 15 s motion graphic with no hard cuts), motion 0.035 medium, cool
  slate palette with the teal accent, 2.2 onsets/s, bands 0.007 / 0.989 / 0.004 (cross-checked with ffmpeg band filters:
  low −41, mid −23, high −45 dB), −12 LUFS; template previews: calm, 0 cuts, dark neutral palettes; `--from-project` on
  the engine repo: 89 tween durations (median 300 ms, p90 820), 4.8 cues/s (_reel-test: 72 cues / 15 s), nightfall + dark-grid presets.

## As built (studio, lane B; 2026-10-18)
- **New look ▾** (Looks toolbar, one primary button → menu): **With Claude… (prompt, references, this project)**,
  **Blank**, **Copy this project's style** (the old "From this project's style": the inline name form, no Claude). With
  Claude and Copy need an open project (disabled with "open a project"). The empty Library offers Add starter looks /
  New look with Claude… / New blank look. The old "Ask Claude from references…" (Ask Claude composer) is gone.
- **New look dialog** (`library.js` `openLookDialog`; the New scene window's layout: `.modal.ns` + `ns-*` classes from
  `newscene.css`, imported by library.js; own ids `#nl-*` in library.css): Name (`looks/<id>/` under it, an existing id
  is an error), Prompt, Notes, References (Add files… = `pick_refs`, a link field; each with a note; no drop zone: the
  Library page has no WebView2 drop hook), Start from Prompt only (default without references; friction round) / References / This project / Both (+ a one-line explanation), Sample
  scene (on), Send to Terminal / New T3 thread (disabled unless T3 is connected at Standard / Full; the choice is
  remembered in `gfx-studio.newlook.to`). The footer shows the exact message. **Write brief & send**: `library_write
  looks/<id>/BRIEF.md` (creates the folder) → each file ref `library_import` into `looks/<id>/refs/` (name cleaned, never
  overwrites) → BRIEF.md rewritten with the names the copies got → Claude gets `Make the look <id> from its BRIEF.md
  (look-design skill). Library: <path>` (`sendToClaude(msg, { send: true })` or `t3.send({ target: 'new', title: 'Look:
  <name>' })`) → dialog and Library page close (the terminal / T3 panel shows). A failure after the brief is written keeps
  the dialog ("Send again", name locked; the id check lets that id through). The path is the Library folder as the
  project's Claude sees it (`wslProject` / `claudeLibPath`: a `\\wsl.localhost` project, or a Linux root with a Windows
  Library, gets `/mnt/c/…`). Esc / × / Cancel close it; Ctrl+Enter sends; Tab stays inside; the page behind is inert.
- **BRIEF.md format** (`lookBriefText` / `parseLookBrief` in library-core.js; the look-design skill reads it):
  ```
  ---
  name: Ghibli soft
  startFrom: prompt | references | project | both
  sample: yes | no
  project: /home/k/gfx-projects/promo      (only for startFrom project | both: the project root as Claude sees it)
  ---
  # Look brief: Ghibli soft
  <!-- Written by gfx studio (Library → New look → With Claude). … keep the frontmatter and the headings. -->

  ## Prompt
  <text, or (none)>

  ## Notes
  <text, or (none)>

  ## References
  - refs/board.png — what to take from it      (files: relative to the look folder)
  - https://example.com/x — note               (links: as typed)
  - none                                       (when there are none)

  ## Start from
  - both: the references and this project together (gfx look analyze --refs … --from-project)   (one line for the chosen value; prompt: the prompt only,
    no gfx look analyze, every rule is judgement)
  - Sample scene: yes (build sample/ from the test card, then gfx look preview) | no (skip sample/ and the preview)
  ```
  Notes on a reference are one line (whitespace collapsed). "This project" = the open project (the message goes to its
  terminal / T3 thread); `project:` names its root as that Claude sees it (`claudeLibPath(S.root, wslProject(…))`: a
  `\\wsl.localhost\<distro>\…` project → `/home/…`, like the Library path in the message).
- **Cards**: a 16:9 media box (height = 16:9 of the card width, snapped to whole pixels, min `--library-thumb-h`; all
  cards, so the grid stays even). `thumb.jpg` (else `thumb.png`) when present (object-fit cover), else up to 3 ref images, else swatches;
  with `preview.mp4` the clip plays muted in place on hover or when a control in the card has keyboard focus (not with
  reduced motion), hidden again on leave. Thumb and clip are fetched once per file version (`fileKey` = path|size|mtime
  from `library_files`) and kept as blob URLs while the page is open (a changed file replaces and revokes the old URL;
  closing the page revokes all). A folder with BRIEF.md and no LOOK.md shows a **brief sent** badge, "Waiting for
  Claude…", name from the brief, and Use in this project disabled.
- **Preview tab** (5th tab of the look editor): toolbar (`looks/<id>/preview.mp4`, from sample/ or "no sample/ yet",
  **Re-render preview** (disabled without `sample/`), **Rebuild sample with Claude…** → a menu: Send to Claude in the
  terminal / Send to a new T3 thread → `Rebuild the sample scene of look <id> (look-design skill). Library: <path>`, then
  the page closes), a reserved status line (progress bar + phase text + Cancel; hidden by visibility, so nothing moves
  when a render starts or ends), the stage (a reserved 16:9 box, `max-width: var(--library-preview-max-w)` = 640 px, the clip with controls, muted, loop, autoplay unless reduced motion,
  poster = thumb; else the thumb; else a hint). Re-render = `engineRun(['look', 'preview', id, '--library', dir],
  { progress: true })` (in the project, or `noProject` without one); phases copy / thumbnail / preview →
  `previewStatus` ("Rendering the thumbnail…", a % only when `done > 0`); Cancel = `engine_cancel` ("Cancelled: the
  previous thumb.jpg / preview.mp4 are kept"); errors show the last stderr line. The job survives tab switches (state per
  look id); when done the listing is reloaded and the tab (or the list) repaints with the new files.
- **Refresh on return**: window `focus` / `visibilitychange` re-read `library_files`; when the listing signature changed,
  the list repaints (no form, dialog or detail view open) or an open Preview tab remounts. Opening the page reloads
  everything as before.
- **Palette editor**: a sample row with `alt` shows a muted read-only `↳ synth: <sound> <variant>` line under the sample
  name (`altLine`); edits keep `alt` (paletteText keeps unknown fields).
- **Backend**: `library_read_bytes` now serves images **and mp4 / webm** inside a look (≤ 20 MB): Rust `check_lib_bytes`
  (+ `BYTES_VIDEO_EXT`) in library.rs with test asserts in `library_paths` / `library_ops`; the shim twin uses
  `checkLibBytes` from library-core.js; API.md updated. No new ops: the dialog uses `library_write` / `library_import` /
  `pick_refs`, Re-render uses `engine_run`.
- **About** (Settings → About → Licenses and credits): a **Scene fonts** group (Fraunces, Nunito, Fredoka, Space
  Grotesk, Ubuntu) with Licence buttons; vite.config.js `REPO_LICENCES` serves / bundles `style/fonts/LICENSE-*.txt`
  (a missing file is skipped, not a build error).
- **Tests**: `library-core.test.js` 8 (+ BRIEF.md round trip, `checkLibBytes`, `lookFiles`, `fileKey`, `altLine` + alt
  survives a palette save, `previewStatus`, `wslProject` / `claudeLibPath` / messages); token gate PASS (removed the
  unused `--library-reference-input-w` with the old inline refs form). E2E `out/studio-library-check.mjs` 161 checks
  (passes twice in a row; its `click` helper waits ≤ 5 s for the target, since card buttons appear only once the card has
  filled in): byte reads, card thumb + hover clip, alt line, Preview tab + Re-render (progress, done, no shift),
  Rebuild menu, Copy this project's style, New look dialog (validation, no shift on errors, ref + link, BRIEF.md, refs/,
  terminal message), brief-only card. Settings fixture gets `claudeCommand: 'echo CLAUDE-STARTED; cat'`.
- **Not done / untested**: T3 send from the dialog only checked as "disabled without T3" (the mock flow is in the
  newscene check); Rust tests not run by lane B; not exercised in the real Windows app (WebView2 video playback of blob
  mp4, `pick_refs`, a WSL Library path in the message).

## Review fixes (2026-10-18)
- New scene excludes pending Library looks from its selector; a missing project LOOK.md also removes its project
  option. Library brief cards retain their existing “brief sent” state and disabled Use button. Cards and the
  Preview tab share the thumb.jpg → thumb.png fallback and use the matching image MIME type.
- Regression cases added for symlinked preview/thumbnail destinations (outside file unchanged), non-regular
  destinations, pending list/use (Library + project), live WebM without duration metadata, picker filtering, and PNG
  fallback / JPG precedence. Validation and sandbox limits: `out/look-pipeline-fix-notes.md`.

## As built (friction round, engine lane; 2026-10-18)
After the six starter looks (friction reports `out/starter-looks-*-notes.md`).
- **Previews keep thin lines and are fast** (`makePreview` in `runner/lib/cli/commands/template.js`, shared with template
  previews): the thumb is captured at up to 4× the output scale (full size for 1080p), the clip at 2× (960×540 for
  1080p, CRF 12 intermediate), both downscaled by ffmpeg `scale=<w>:<h>:flags=area` (even sizes); output unchanged
  (long side 480, 24 fps, ≤ 6 s, H.264 CRF 30, yuv420p, faststart, silent). Both run in **Fast mode** (`--mode fast`;
  previews need no byte identity), retried once in Exact mode if that fails. Measured on ghibli-soft (blur-heavy):
  clip at 0.25 Exact 115 s, 0.25 Fast 7.5 s, 0.5 Fast 8.3 s, 1.0 Fast 12.5 s → 0.5 Fast; the whole `look preview`
  2 min 24 s → ~12 s (the six starters 9–12 s each). Without ffmpeg: thumb.png captured at the output size, no clip.
  Phase lines on stderr without `--progress json` (`gfx: preview: thumbnail at t=4.2s (1920x1080 -> 480x270)...`,
  `... done (2.5 s)`; `phaseLine` export).
- **`gfx look preview <id> --sheet [--n 12] [--cols 4] [--t a,b,...] [--out <png>]`**: the same temp project as the
  preview, `gfx sheet sample --mode fast` → `--out`, default `<project>/out/look-sheets/<id>.png` in the current project
  (cwd walk-up / `--project`), else a kept temp folder (`gfx-look-sheets-*`, path printed). `--t` = comma-separated
  times → full-size stills `<sheet>-t<sec>.png` next to it. The look folder is never touched. Progress phases
  `copy`, `sheet`. `--json` → `{ look, library, sheet, stills, n }`.
- **`gfx look check <id> [--library <dir>] [--json]`** (`checkLook` in look.js): without `--library` the project's
  `looks/<id>/` when it exists, else the default Library. Errors (exit 1): LOOK.md missing or frontmatter without
  name / description / tags; preset.js that doesn't import; `colors.bg|text|accent` missing; `fonts.sans|mono` missing;
  a `fontFiles` url that isn't `/style/fonts/<file>` or whose file isn't in the engine's `style/fonts`; a `fonts.<key>`
  whose first family is neither loaded by `fontFiles` nor a generic family; sounds.json not an array; an entry without
  role; an unknown synth sound or variant (`SOUND_NAMES` / `VARIANTS` from sfx.js, so beep / wind count); a sample
  entry without `src` or `alt`, an absolute / `..` src, `start` / `dur` not seconds ≥ 0; an invalid `alt`;
  sample/scene.json invalid (width / height / fps / duration > 0, kind) or sample/scene.js missing; folder > 2 MB (all
  files, Library-side included). Warnings: no preset / sounds / sample / thumb, src not `library/...`, src not installed
  here (`resolveSrc` from library/config.js → the alt plays), `params.start|dur` on a sample (use top-level), duplicate
  roles, `cue(` in the sample or sample/sound.json (the sample is silent), sample style ≠ `look-<id>`. JSON
  `{ look, path, where, ok, errors, warnings, bytes }`. All six starters: 0 errors, 0 warnings.
- **`gfx look audition <id> [--library <dir>] [--out <wav>] [--json]`** (`auditionPlan`): one 1.4 s slot per palette
  entry: the entry at +0.1 s (a sample whose src isn't installed plays its `alt` instead, labelled), its `alt` at
  +0.75 s. Samples resolve project-first with `resolveSrc` in the original project and are copied into a registered
  source in the temp project; copy failures are reported as not installed and play the alt. Installed sample rows
  include `source`, the original resolved file path, in the JSON report. Then
  a generated 1280×720 scene (rows with the role / sound, the active row highlighted) in a temp project →
  `gfx audio` → `mix.wav` + `sync.png` copied to `--out` (default `<project>/out/look-audition/<id>.wav` +
  `<id>.sync.png`, else a temp folder). Cue ids `<n>-<role>` / `<n>-<role>-alt` label the sync sheet. Exit 1 when an
  entry can play nothing (missing src, no alt). JSON `{ look, path, where, wav, sync, roles: [{ role, t0, main, alt,
  note }], warnings }`.
- **Help**: `gfx look --help` (all look commands), `gfx look <cmd> --help` / `-h` (that one; `LOOK_HELP`). `--help` /
  `-h` is a global boolean now; `look` and `lib` print their own help, every other command prints the usage instead
  of running (runner/cli.js).
- **Font CSS variables** (runner/player/core.js): every string `style.fonts.<key>` is set as `--gfx-font-<kebab key>`
  (`serif` → `--gfx-font-serif`, `headlineAlt` → `--gfx-font-headline-alt`); sans / mono as before.
  `gfx still _reel-test --t 7.61` stays 6d98719a277d52ada048977753e322f8.
- **`inkContrast`** (look-analyze.js): per ref, in the summary (mean over refs) and in `projectTone`: the L distance
  (0–1) between the palette's dominant colour and the farthest palette colour with share ≥ 1 %. `contrast` (L p90 −
  p10) reads type on paper as soft because the ink is < 10 % of the pixels; `inkContrast` sees it (a paper card with a
  4 % dark text block: contrast 0.0, inkContrast ≈ 0.8). Printed by `look analyze --out`.
- **Palette format** (shared decision): `src` = the library path `gfx lib search --json` reports (`library/<source>/
  <file>`), optional top-level `start` / `dur`, `alt` = synth fallback, used when `src` doesn't resolve here.
  editorial's `params.start` moved to top-level `start`; tech-minimal's beep alt = `beep digital`; ghibli-soft's wind
  = `wind breeze` (dur 2.5); LOOK.md text follows.
- **Starters**: BRIEF.md removed from the six (dev notes; `look seed` would have copied them); previews re-rendered
  with the new `makePreview` (clean-dark's grid and tech-minimal's hairlines show in the thumbs). `_sample/BRIEF.md`:
  the accent beat is settled at 4.2 s (the thumb) and the end-card transition starts ≥ 4.3 s; slow looks overlap
  beats; Check = `--sheet` + `--t`, then the preview, then `look check`.
- **Tests**: `tests/looks.test.mjs` 93 (+38: inkContrast unit + a paper image, help, check on the six starters + a broken
  look, `--sheet` with `--t` + the project default path, audition with an installed sample in a temp `GFX_LIBRARY`, a
  missing src and a synth entry, font CSS variables via a pixel colour); `tests/project.test.mjs`: seed expects the
  six starters without BRIEF.md, the starter-palette test accepts sample entries with a library src and a valid synth
  `alt`.
