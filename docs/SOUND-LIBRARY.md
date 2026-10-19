# Sound library: tags, better "Similar", user folders, Claude access — spec v1

User-approved 2026-10-18 (sound follow-up 4). Builds on the existing library (docs/CONTRACT.md "Sound
library", `runner/lib/library/*`, `runner/lib/vox-features.js`). Out of scope (later): swapping the CLAP model (item 4
of the proposal), Looks palette feed from taste, multi-cue Mutate.

**2026-10-19: Perform removed.** The studio's index state moved from `vox.js` to `apps/studio/web/src/soundindex.js`
(same API: `loadSources`, `invalidateSources`, `ensureIndex`, `describe`, `isEnabled`, `enabledSources`, `setEnabled`,
`forgetEnabled`, `sampleLoader`, `V.sources / V.index / V.entries / V.enabled`; it emits `soundindex`). "Perform" and
"vox.js" in the notes below are historical: read them as soundindex.js. An Engine folder change now only invalidates
the index; the next reader (Replace…, Library) loads it again.

## 0. Today (baseline)
- Sources in `<library>/sources.json` (+ project `gfx.json library.sources[]`): `synth` (rendered recipes), `kenney`
  (461 entries), optional folders. `gfx lib add|enable|disable|fetch|index|search|list`; CLI only, text output.
- Index entry (`<library>/index/<id>.jsonl`, INDEX_VERSION 1): `id, src, m, z, start, dur, features{dur, env[32],
  peakDb, attack, decay, centroid, centroidSlope, flatness, pitch{voiced,hz,conf,slope}, zcr, onsets}, emb` (CLAP
  512-d, base64), synth entries also `synth{sound,variant,intensity,dur,hit}`.
- "Similar in the library" (studio `soundtweak.js suggestions()`): `1.4·cosine(emb) + 0.6·(1 − distance(fv))` over
  every enabled entry. Weak for ui sounds: top hits are Kenney impacts (short punchy envelopes look alike; no role).

## 1. Index tags (engine)
INDEX_VERSION 2 adds `tags` to every entry (synth and folder):
```
"tags": { "labels": [["click",0.31],["tap",0.22],["pop",0.12]],   // top 3 CLAP zero-shot over CLAP_LABELS (softmax)
          "role": "ui", "roleScore": 0.71,                          // hits | motion | ui | accents (see below)
          "bands": [0.42, 0.38, 0.20] }                             // low <250 Hz / mid 250–4k / high >4k energy share
```
- Labels: cosine(entry emb, text emb of `labelPrompt(label)`), softmax over CLAP_LABELS (temperature as Perform uses, or
  a fixed one documented in code), top 3. Text embeddings computed once per run.
- Role: a pure function `roleOf(labels, features)` in the shared rank module (§2): label groups —
  ui = click, tap, pop, tick, beep, typing, notification; hits = impact, thud, punch, door, footstep, crumple;
  motion = whoosh, swoosh, riser, sweep, swipe, zip, laser, glitch; accents = ding, chime, cash register, water drip,
  paper rustle (tune the grouping with the eval in §5) — summed label mass per group, then duration/envelope priors
  (ui: dur ≤ 0.35 s and attack ≤ 0.02 s raise ui; dur ≥ 0.6 s lowers ui/hits; rising env + dur ≥ 0.3 raises motion).
  Synth entries: role = `defaultStem(sound)` (exact, not guessed); roleScore 1.
- Bands: from the trimmed clip's spectrum (one FFT pass, reuse vox-features FFT helpers), normalised to sum 1.
- Upgrade path: `gfx lib index` on a v1 index re-tags without re-running CLAP audio (labels/role come from the stored
  emb; bands need a decode, no CLAP). `--force` re-indexes fully as today. Mixed v1/v2 files: readers treat a missing
  `tags` as unknown (no crash, neutral in ranking). Meta file records `version: 2`.

## 2. Ranking (shared pure module)
New pure ESM module `runner/lib/sound-rank.js` (no Node/DOM APIs; imported by the CLI and by the studio through a new
vite alias `@rank`, like `@vox`). Exports:
- `ROLE_GROUPS`, `roleOf(labels, features)`.
- `similar(query, entries, { role, maxDur, minDur, n = 8, exclude })` → `[{ entry, score, why }]`:
  1. **Filter**: if a role is known (query's tags.role, or the cue's stem/role passed in), keep entries with that role
     (or roleScore < 0.4 = uncertain, ranked lower); drop entries whose dur is outside [0.4×, 2.5×] the query's dur
     (`minDur`/`maxDur` override); always drop the query itself.
  2. **Score**: `wE·cosine(emb) + wF·(1 − distance(fv)) + wB·(1 − L1(bands)/2) + wR·roleMatch` with weights chosen by
     the eval (§5), stored as named constants. `why` = short text ("same role · close envelope · brighter").
  3. Return top n (stable order: score, then id).
- `queryFromCue(cue, index)` helper: the cue's own entry (synth recipe nearest in intensity/length, or the sample's
  file entry) — the logic now in `soundtweak.js ownEntry()` moves here.
- The studio's Replace… "Similar in the library" group uses `similar()` with the cue's stem as role; taste boost
  (`rankWithTaste`) applies after, as today. Perform matching is unchanged in this round.

## 3. CLI for Claude (engine)
- `gfx lib list --json` → `[{ id, kind, path, license, enabled, files, indexed, version, project? }]`.
- `gfx lib search "<text>" [--role r] [--max-dur s] [--source id]… [--n 10] [--json]` → hits with
  `{ id, source, src, start, dur, score, role, labels, license }`.
- `gfx lib similar <ref> [--role r] [--n 8] [--json]` where ref = an index entry id (`kenney:ui/click1.ogg`), an audio
  file path (decoded + embedded on the fly), or `<scene>:<cueId>` (the cue's own entry via `queryFromCue`). Output like
  search + `why`.
- `gfx lib remove <id>` → removes a global source from sources.json and deletes its index files; never deletes audio;
  refuses `synth` and project sources (edit gfx.json).
- `gfx lib add` gains `--json`; `index` keeps `--progress json`.
- `gfx context` brief: one "Sound library" line — enabled sources with entry counts and licences (e.g.
  `synth (67, own), kenney (461, CC0)`), and "find sounds: gfx lib search "<text>" --json / gfx lib similar
  <scene>:<cue> --json". No index contents in the brief.
- Skill `.claude/skills/sound-design/SKILL.md`: use `--json`, `similar` for "something like this cue", `--role`; check
  `license` per hit (Sonniss: royalty-free, never for AI training — indexing/embedding is analysis, fine; never upload
  or feed it to training).

## 4. Studio: Sound sources (Library page)
- Library page (library.js) gets a 4th tab **Sound sources** (the engine's sound library, i.e. `gfx lib list --json`,
  not the Looks Library folder; the tab says where the sound library is).
- Table: name · path · licence · entries (indexed / files) · enabled toggle · ⋯ (Re-index, Remove from library…).
  Remove asks with `api.ask` ("The audio files stay where they are").
- **Add sound folder…**: folder picker → small form (id = slug of the folder name, editable; licence free text with
  suggestions CC0 / CC-BY 4.0 / own / royalty-free; a note that the files are only read) → `gfx lib add` then
  `gfx lib index <id> --progress json` with a progress bar in the row (files/s, cancel). Paths: Windows paths go to a
  Windows engine as is; for a WSL engine convert `C:\x` → `C:/x` (the engine maps `/mnt/c`) and
  `\\wsl.localhost\<distro>\…` → the Linux path (reuse `library-core.js wslPath`). Errors in the row (no layout shift:
  reserved slots, docs/… layout-shift rules from 2026-10-18).
- Enabled/disabled and adds update Replace… / the Shape section without a restart (reload soundindex.js).
- Engine repo / project sources (gfx.json): shown read-only with "from gfx.json".

## 5. Evaluation (decides the weights and role groups)
- Script `tests/soundlib-eval.mjs` (skips when `library/index/kenney.jsonl` is missing): Kenney folder names are labels
  — `ui`, `interface` → ui; `impact` → hits; `digital`/`scifi`/`rpg` mixed (excluded from precision, kept as
  distractors). For every synth entry with role ui / hits: top-5 `similar()` over Kenney; precision@5 = share of hits
  whose folder label matches. Also role accuracy of `roleOf` on ui/interface/impact files.
- Report before (today's formula) vs after; target ui P@5 ≥ 0.6 and better than baseline for hits. Record numbers in
  this doc's As built.

## 6. Tests
- `tests/soundlib.test.mjs`: roleOf / similar (pure, fixtures), v1→v2 re-tag without audio CLAP (stub clap or the local
  model), list/search/similar `--json` shapes, remove (index deleted, audio kept, refuses synth/project), context line.
- Unit for the studio path conversion if new helpers are added (library-core tests).
- E2E: extend `out/studio-library-check.mjs` (its temp fixture) with the Sound sources tab: list, add a temp folder
  with 3 small wavs (generate with ffmpeg in /tmp), index progress → entries shown, disable/enable, remove; and
  `out/studio-soundtweak-check.mjs`: Similar for a ui cue now lists ui/interface files first. Never touch the real
  library's sources.json in tests (temp GFX_LIBRARY or the fixture's library copy — not a symlink to the repo's
  library for write tests).
- Renders unchanged (no sfx change): the reel fixture still md5 at 7.61 s.

---
## As built
Engine lane (2026-10-18):
- **Index v2** (`runner/lib/library/indexer.js`): `tags` as specified; labels = `clap.zeroShot(emb)` (softmax temp 30,
  as Perform), role via `tagsOf()` / `roleOf()`, bands via the new additive `bandEnergies(pcm, sr)` in vox-features.js
  (Hann 2048, up to 64 frames; other exports unchanged). Meta = `{ model, version: 2, rank, sfx?, entries }`.
  Upgrade: a v1 index (same model) is re-tagged in place — unchanged files decode each entry's region for the bands,
  labels / role from the stored `emb` (no CLAP audio pass; test swaps two stored embeddings and checks they survive);
  synth re-renders (Chrome) only for the bands when sfx.js is unchanged, keeping its embeddings. Extra: `RANK_VERSION`
  in sound-rank.js, recorded as meta `rank`; when it changes, `gfx lib index` re-tags from the stored emb + bands
  without any decode (0.4 s for Kenney). `--force` = full re-index as before.
- **`runner/lib/sound-rank.js`** (pure; API documented at the top): `ROLES`, `ROLE_GROUPS`, `RANK_VERSION`, `W`,
  `roleOf(labels, features)`, `tagsOf({ probs, features, bands, sound })`,
  `similar(query, entries, { role, maxDur, minDur, n = 8, exclude })`, `queryFromCue(cue, index)`, `entriesOf(index)`.
  `similar` accepts raw index lines (base64 emb + features) or the studio's decoded entries (Float32Array emb + `fv`);
  `role: 'any'` = no role filter; a non-role stem (`samples`) falls back to the query's role; the query is dropped by
  object, id, or same src + start. Role match term: same role 1, unknown 0.5, uncertain (roleScore < 0.4) 0.2.
  queryFromCue = ownEntry() logic (nominal lengths / default intensities mirrored from soundtweak-core / sfx.js).
- **Tuned by the eval:** groups changed from the proposal — `pop` moved ui → hits (Kenney impacts are mostly labelled
  "pop": impact folder pop mass 20.9 vs ui 2.9), `laser` moved motion → ui (Kenney interface bleeps, maximize/minimize/
  close, are "laser"). Priors: ui ×1.6 when dur ≤ 0.35 s and attack ≤ 0.02 s, ui/hits ×0.6 when dur ≥ 0.6 s, motion
  ×1.8 when dur ≥ 0.3 s and the envelope peaks after 40 %. Weights `W = { emb: 1.4, feat: 0.3, bands: 0.2, role: 0.5 }`
  (grid `node tests/soundlib-eval.mjs --grid`; bands help hits a little, hurt ui a little, so kept small).
- **Eval** (`tests/soundlib-eval.mjs`, real library after the upgrade; 5 ui and 36 hits synth queries over 461 Kenney
  entries; strict P@5 counts digital/scifi/rpg hits as misses, lenient leaves them out):
  | | ui P@5 | ui lenient | hits P@5 | hits lenient |
  |---|---|---|---|---|
  | before (1.4·cos + 0.6·(1−dist), no filter) | 0.80 | 0.80 | 0.48 | 0.78 |
  | after (`similar()`) | **0.88** | 0.92 | **0.73** | 0.96 |
  roleOf accuracy on the 275 ui/interface/impact files: 0.887 (with the proposal's groups: 0.695). Honest notes: only 5
  ui queries (click, pop, tick, type ×2), so ui numbers move 0.04 per hit; synth:pop still finds impactMetal/glass
  "pops" (now tagged ui because their dur/attack are ui-like); the hits misses are swoosh/suck queries (role hits by
  stem) landing on rpg cloth / scifi — sounds that are hits-like but not in Kenney's impact folder. The baseline was
  already fine for ui on these synth queries; the "Kenney impacts first" problem the studio showed came from the
  missing role filter, which `similar()` now applies.
- **CLI**: `lib list --json` → `{ library, sources: [{ id, kind, path, dir, license, enabled, files, indexed, version,
  missing?, project? }] }` (synth `files` = recipe count); text list flags a v1 index. `lib add --json` → source +
  `dir`, `exists` (warns when the folder is missing). `lib remove <id> [--json]` → `{ removed, deleted: [index files] }`.
  `lib search … --json` / `lib similar … --json` → `[{ id, source, src, start, dur, score, role, labels, license,
  synth?, why? }]`; `--role hits|motion|ui|accents|any`, `--max-dur`, `--min-dur` (similar), `--source`, `--n`.
  `similar <scene>:<cue>` reads `out/<scene>/audio/cues.json` when it is newer than every scene file, else opens the
  scene page (Chrome) for the cues + sound.json. `saveSources` is atomic (temp file + rename).
- **Context**: md line `Sound library: synth (67, own), kenney (461, CC0) · find sounds: gfx lib search "<text>" --json
  / gfx lib similar <scene>:<cue> --json` (enabled sources; counts from the index line count); JSON `soundLibrary:
  [{ id, entries, license }]`.
- Skill sound-design: `--json`, `similar`, `--role`, per-hit `license` (Sonniss rule). CONTRACT "Sound library" updated.
- Real library upgraded to v2 on 2026-10-18 (`gfx lib index kenney synth`; Kenney 461 re-tagged in 33 s; synth was
  re-rendered fully because sfx.js changed since its v1 index). v1 backup: `/tmp/gfx-soundlib-index-backup-v1/`.
- Tests: `node tests/soundlib.test.mjs` (62; CLAP parts skip without library/.models).

As built: gfxlib resolution (2026-10-18, after Codex's review of cfe608f):
- **Problem**: Perform / Replace… read the sound library through `gfxlib://`, which resolved `library/...` against the
  open project and read `<project>/library/sources.json`. The engine keeps the library elsewhere (`libraryDir()`:
  GFX_LIBRARY, else `<engine>/library`, else `%APPDATA%\gfx\library` / `~/.local/share/gfx/library`), so outside the
  engine repo the Sound sources tab added folders Perform never saw.
- **The app asks the engine**: `gfx lib list --json` → `library`, run through the project's engine (`spec_for`: a WSL
  project's engine, else the located engine), as `lib.rs locate_library`. The path is made readable for the app
  (`readable_abs`): a WSL engine's `/home/…` → `\\wsl.localhost\<distro>\home\…`, `/mnt/d/…` → `D:/…`; a Windows
  engine's `%APPDATA%\gfx\library` as is. Cached per project root in `AppState.lib` (`LibScope`): the first gfxlib
  request after a project switch asks (one at a time), `set_root` clears it, no engine = fallback `<project>/library`
  (the old behaviour). `invoke('lib_locate')` / `api.libLocate()` asks again; vox.js calls it before it reads
  sources.json after a project switch, an Engine folder change (`prefs` event) or a Sound sources add / toggle / remove.
- **Resolution** (`resolve_lib_in`, twin `web/lib-guard.js`): registered project audio is checked first (including
  `library/own/…`), before global folder sources or aliases, matching the project-first cue contract. `library/<…>` (or `<library folder name>/<…>`) = model /
  index / audio files in that library; `.gfx/index/<id>.jsonl|.meta.json` = the index of a gfx.json project source
  (only ids listed in `library.sources[]`); audio inside registered folders: sources.json `path` relative to the
  library's parent or absolute, gfx.json `library.sources[].path` relative to the project or absolute (absolute index
  `src` compared in the engine's spelling, the project as the engine sees it). Guards kept: no `..` (also in source
  paths), allowed extensions, audio only inside registered folders, model/index files only in the library.
- **Perform's sources**: vox.js now also lists the project's gfx.json sources (`project: true`, a global id wins as in
  the engine) and reads their index from `.gfx/index/<id>.jsonl`.
- **Dev shim**: the `lib_locate` op and `/__lib/f` run `node <engine>/runner/cli.js lib list --json` in the project
  (cached per root, reset on `set_root` / welcome open).
- **Codex P2s on the tab (library.js)**: the list, jobs and row errors belong to a context (project root + the list's
  `library`); another project (or another sound library) drops them even while an older index job runs — that job keeps
  running in its library but never paints into the new rows or reloads them. Removing a source (and adding one) drops
  Perform's persisted on/off override for that id (`vox.forgetEnabled`), so a re-added source is enabled in Perform too.
- **Limits**: a library folder not named `library` (custom GFX_LIBRARY) also answers to `library/…`, but a sources.json
  path `library/x` then means `<parent>/library/x` to the engine and `<library>/x` to gfxlib (all default locations are
  named `library`). Project sources with `..` in their path are not served. A library path that is a symlink inside
  WSL is read via `\\wsl.localhost` as the engine prints it (not resolved) — Windows can't follow WSL symlinks.
- Tests: Rust `gfxlib_engine_library`, `gfxlib_wsl_paths`, `gfxlib_serve_codes` (temp library outside the project);
  E2E library check: the temp sound library now lives outside the project (`/tmp/gfxlib-work/soundlib/library`), the
  project has no `library/`; added folder's index + audio, Kenney index, a gfx.json project source (index in
  `.gfx/index`, audio in the project), 403s, override cleared on remove, project switch with a running job.

- **gfxlib fix lane (review of 7eff163)**: Perform ignores the first Engine folder prefs broadcast and unchanged
  values; a later engine change invalidates sources/indexes and reloads them immediately while Perform is active.
  Rust guard regressions cover project `library/own` precedence, global fallback and traversal/type/prefix guards.

## Look friction round (2026-10-18, sound lane; out/look-friction-packet.md lane 2)
Found while building the six starter looks (out/starter-looks-*-notes.md): CLAP text search missed obvious files
("impact punch" → footsteps, "book place" → toggles), gave no "nothing fits" signal, there was no way to inspect or
browse files, and the synth had no beep or wind.
- **Hybrid search** (`searchLibrary` in indexer.js; keyword part pure in sound-rank.js: `queryTokens`, `entryTokens`,
  `keywordScore`, `stem`, `KW`). `score = clap + KW.weight (0.3) * kw`. `kw` (0..1) = per query word the best weight
  of a matching entry word, averaged over the query words: file name words 1 (camelCase / `_` / digits split, plus the
  joined name, so "mouse release" finds `mouserelease1`), synth sound / variant 1, synth description words 0.6 (a small
  fixed table: wind → air bed ambience, breeze → soft calm gentle, …), folder / pack / source words 0.5, CLAP label
  words 0.5, role 0.3 (`hits` also answers "hit"). Light stemmer (clicks / clicked → click, placed / place, wooden →
  wood, punchy → punch); stopwords (a, the, on, sound, sfx, …) and bare numbers dropped; `Audio` and extensions are
  not words. **`weak: true`** when `clap < KW.weakClap (0.4)` and `kw < KW.weakKw (0.5)`: no good sound match and no
  name match covering half the query. Text output marks `(weak)` per hit and prints a "weak match" line when the top
  hit is weak (the studio's Smart search parser ignores it). JSON hits gain `clap`, `kw`, `weak` (same array shape).
  Note: `score` is now the hybrid score (CLAP cosines are query-dependent, ~0.1–0.65; compare within one query only).
- **Eval** (`tests/soundlib-eval.mjs`): new text section, 18 friction queries with the file a designer picked plus 3
  weak-flag checks. CLAP only: hit@1 0.389, hit@5 0.500, MRR 0.467 → hybrid: hit@1 **0.944**, hit@5 **1.000**, MRR
  **0.963**; weak flag 3/3 ("dog bark" weak; "glass ding", "impact punch" not). The similar() / roleOf numbers are
  unchanged (`--legacy`: ui 0.88 / 0.92, hits 0.733 / 0.963, roleOf 0.887); without `--legacy` the ui set has 7
  queries (the 2 new beep recipes are ui queries: 0.829 / 0.943). The one hybrid hit@1 miss: "light wooden tap" ranks
  `synth:click` (tap) first, impactWood_light 2nd–3rd.
- **`gfx lib info <ref> [--json]`**: ref = a cue src as search reports it (`library/kenney/rpg/Audio/bookPlace1.ogg`,
  relative to the library's parent), `<source>/<file>` (`kenney/rpg/Audio/x.ogg`), an entry id (`kenney:rpg/Audio/x.ogg`,
  `synth:beep/soft`), a project-relative or absolute path. → `{ installed: true, src, path, source, sourcePath, license,
  start, dur, fileDur, indexed, entries: [{ id, start, dur, role, roleScore, labels, bands }] }` (`start` / `dur` = the
  indexed, silence-trimmed region when the file has one entry: use them as the cue's / palette entry's start / dur;
  `fileDur` decoded with ffmpeg). Synth entries: `{ installed, id, synth, dur, entries }`. Not installed (no such file /
  synth entry, or not audio) → `{ installed: false, ref }`, **exit 1** — the look palette fallback rule (use `alt`).
- **`gfx lib files [--source id]… [--grep text] [--role r] [--json]`**: every audio file of the chosen (default: enabled)
  folder sources (walkAudio, so un-indexed files show too) with the first entry's tags, `segments` (long files) and
  `indexed`; synth = its index entries. `--grep` = all words, case-insensitive, over the id + labels. JSON rows
  `{ id, source, src, start, dur, role, labels, segments, indexed, license, synth? }`.
- **`gfx lib --help`** (also `gfx lib` alone / `gfx lib help`): the subcommands with one line each. `--grep` / `--help`
  added to args.js.
- **Synth `beep` / `wind`** (sfx.js; CONTRACT "Sound library"): beep (ui) `soft` = 1046.5 Hz sine, 5 ms attack, ~0.14 s
  / `digital` = 1568 Hz band-limited square, flat hold, ~0.09 s, `dur` and `pitch` work; wind (motion) = a pink-noise
  bed from `t` for `dur` (default breeze 2.5 s, gust 2 s; 0.3–30 s): two panned band-passed layers with seeded slow drift
  of centre and level, fades in / out, `gust` brighter with one or two swells, `intensity` = level + brightness (default
  0.4). No auto variant (soft / breeze when omitted). Levels: beep soft −17 dBFS peak, digital −21; wind breeze 0.4
  −15 peak / −29 RMS. Existing sounds unchanged: `gfx audio _reel-test` stems + mix md5 identical before / after,
  `gfx still _reel-test --t 7.61` = 6d98719a277d52ada048977753e322f8.
- **Synth index**: recipes + beep ×2 + wind 2 variants × 3 intensities × (1.2, 3 s) = 81 (was 67); re-indexed on
  2026-10-18. 64 of the 67 old entries are byte-identical; type/d1.5, ding and chime shifted by float noise (cosine
  0.9996) because the last render batch now holds more cues (shared convolver), not because the sounds changed.
- Tests: `node tests/soundlib.test.mjs` (104): keyword score, beep / wind cue model + recipes, lib info / files / --help
  (no CLAP), hybrid search fields + info after indexing (CLAP parts).
