# gfx contract (v1)

Single source of truth for the runner, templates, and skills. Change this file first, then the code.

## Repo layout

```
gfx.json                          marks the repo as a gfx project too (project == engine, back-compat)
.claude/skills/<skill>/SKILL.md   project-local skills (motion-graphics, threejs, canvas2d, svg, animejs, sound-design, look-design); copied into new projects
runner/                           the `gfx` CLI + player page + shared libs
  cli.js                          entry (`npm run gfx -- <cmd>`, `npx gfx <cmd>`, or the `bin/gfx` / `bin/gfx.cmd` launchers)
  player/                         index.html + player.js (loads a scene, exposes window.__gfx); bridge.html + bridge.js (live postMessage bridge); core.js, elements.js
  lib/                            importable helpers for scenes: ease.js, tween.js, rng.js, style.js
  lib/cli/                        CLI internals: args.js (option table, usage), progress.js (--progress json), util.js, capture.js (Vite + browser), commands/*.js
  lib/paths.js                    engine/project/library resolution; browser.js, ffmpeg.js, fetchfile.js (download + fflate unzip), project-vite.js
style/presets/<name>.js           built-in style presets (tokens); `dark-grid` is the first one
templates/<kind>/                 starter scene per kind: three | canvas | svg | anime
templates/projects/<id>/          project templates for `gfx init` (blank, reel) + _shared/ (CLAUDE.md, gitignore)
templates/looks/<id>/             starter looks for `gfx look seed` (clean-dark) + _new/ (`gfx look new` scaffold) + _sample/BRIEF.md (the test card every look's sample/ follows)
scenes/<name>/                    real work, one folder per piece
out/<name>/                       renders + web exports (gitignored)
```

## Engine and projects (spec: docs/FOUNDATION.md §1-3)
- **Engine** = runner/, built-in style/, templates/, .claude/skills, package.json + node_modules, vite.config.js
  (this repo; in the app `<app>/engine/` with `<app>/engine/node/node.exe`). Version = package.json `version`.
- **Project** = a folder with `gfx.json` `{ "version": 1, "name": "...", "engine": ">=0.2", "library"?: { "sources": [...] } }`,
  `scenes/`, `style/presets/` (+ fonts), `out/` (gitignored), `.claude/skills/` (copied at init), `CLAUDE.md`.
- Project resolution: `--project <dir>` > `GFX_PROJECT` > nearest `gfx.json` at or above cwd > the engine root.
  Every path below that says `scenes/`, `out/` or `style/presets/` is relative to the project.
- Vite root = project. `/runner/*` is served from the engine; `/style/*` from the project if the file exists there,
  else the engine (a project preset with a built-in's name overrides it); bare imports (`three`, `animejs`, ...)
  fall back to the engine's node_modules. For projects outside the engine the dep optimizer is off (deps are served
  as plain ESM); for the engine itself nothing changes (same optimizer config, byte-identical captures).
- **Library** (sound, per user): `GFX_LIBRARY` > `<engine>/library` if it exists (this repo) > `%APPDATA%\gfx\library`
  (Windows) / `~/Library/Application Support/gfx/library` (mac) / `$XDG_DATA_HOME|~/.local/share` `/gfx/library` (Linux).
  Relative library paths (sources.json `path`, index/cue `src` like `library/kenney/...`) are relative to the
  library's parent folder, so they mean the same in this repo and in a per-user library. Cue `src` may also be
  project-relative (checked first). gfx.json `library.sources[]` adds project sources (`path` relative to the project;
  listed by `gfx lib list`, edited in gfx.json only).
- Env vars: `GFX_PROJECT`, `GFX_LIBRARY`, `GFX_CHROME` (browser binary), `GFX_FFMPEG` / `GFX_FFPROBE`,
  `GFX_CLAP_MODEL`, `FREESOUND_API_KEY`.
- **Browser**: `GFX_CHROME`, else the first existing Chrome (Windows: Program Files, Program Files (x86), LocalAppData;
  Linux: /usr/bin/google-chrome, then google-chrome-stable/chromium/chromium-browser/microsoft-edge on PATH; mac: /Applications),
  then Edge. **ffmpeg**: `GFX_FFMPEG`, else `ffmpeg` on PATH, else `<library-parent>/bin/ffmpeg(.exe)`; all ffmpeg
  spawns go through `runner/lib/ffmpeg.js` (no shell).
- `gfx init <dir> [--template <id>|user/<id>|<folder>] [--name ...]` (templates: docs/TEMPLATES.md, `gfx template list|save|preview|remove`) — refuses a non-empty folder; copies `templates/projects/<id>` (or a user template; template.json / thumb / preview stay behind),
  the engine skills, writes gfx.json (`engine: ">=<major>.<minor>"`), `.gitignore` (out/), `CLAUDE.md` (with the
  machine-local CLI command), creates out/. Skills are managed copies recorded in `.gfx/skills.json`;
  `gfx init --refresh [<dir>] [--no-skills] [--json]` rewrites the CLAUDE.md managed block and `.gfx/engine.json` and
  syncs the skills (untouched files updated, edited ones kept with the engine version in `.gfx/skills-new/`, legacy
  unknown copies backed up to `.gfx/skills-backup/<stamp>/`; FOUNDATION.md "Managed skills").
  `--workflow quick|full|<json>` (init and `--refresh`): the machine default for the block's workflow line (gfx studio
  passes its setting; remembered in the machine-local `.gfx/workflow.json`); gfx.json `"settings".workflow` = `"quick"`
  | `"full"` | `{ verify: "sheet"|"stills"|"full", render: bool, sound: "asked"|"always" }` wins; default quick. The
  block also gets a `Look: …` line when gfx.json has `look` (docs/LOOKS.md §1-2).
- `gfx look …` (docs/LOOKS.md §2-3; a look = `looks/<id>/` with LOOK.md, preset.js?, sounds.json?, refs/; ids are slugs
  `[a-z0-9-]`; only regular files are copied/hashed; hash = sha256 over `"<rel>\n<sha256>\n"` per file, sorted).
  Library-side files (docs/LOOK-PIPELINE.md §2) `sample/**`, `thumb.jpg`, `thumb.png`, `preview.mp4`, `analysis.json`,
  `BRIEF.md` (top level of the look) are left out of the hash, never copied into a project by `use` / `update` (a project's own are
  kept), and `save` keeps the Library copy's (the project's only where the Library has none):
  - `look list [--library <dir>] [--json]` → `{ project, look: { id, hash, lookSource, library, libraryHash, edited,
    updateAvailable, conflict } | null, projectLooks: [info], library, looks: [info] }`, info = `{ id, name, description,
    tags, preset, sounds, refs, hash, path, thumb, preview, sample, analysis, brief, pending }` (`thumb` = `"thumb.jpg"` |
    `"thumb.png"` | null; `pending` = no regular LOOK.md yet (kept listed for brief cards); `preview` / `sample` (sample/scene.json) / `analysis` / `brief` (BRIEF.md) = booleans).
  - `look use <id> [--library <dir>] [--force] [--json]`: requires a regular LOOK.md; otherwise exit 2 with
    `{ look, status: "pending", pending: true, message }` in JSON mode, without changing the project. When ready, copy `<lib>/looks/<id>/` → `looks/<id>/` (refuses to replace an edited
    project copy without `--force`), gfx.json `look` + `lookSource { library, hash }`, `style/presets/look-<id>.js` from
    preset.js, managed block refreshed. Without `--library`: the project's own `looks/<id>/` (no lookSource).
  - `look update [--library <dir>] [--json]` (library defaults to `lookSource.library`): status `up-to-date` | `updated`
    (project copy unedited vs the pin) | `local-edits` (library unchanged) | `conflict` (both changed: reports both
    hashes, changes nothing, exit 2).
  - `look save [<id>] [--library <dir>] [--force] [--json]`: project look → library; a library copy that differs from the
    pinned hash is only overwritten with `--force` (`conflict`, exit 2). Saving the project's look re-pins it.
  - `look new <id> [--name ".."]`: scaffold `looks/<id>/` (LOOK.md, preset.js, sounds.json `[]`, refs/).
  - `look seed --library <dir>`: copy the engine's starters (`templates/looks/*`) into `<dir>/looks/` (existing looks are
    kept), create `presets/` and `palettes/`.
  - `look analyze [--refs <file>]... [<file>...] [--from-project] [--out <file>] [--json]` (no project needed unless
    `--from-project`): measures reference images (png/jpg/webp/bmp/tif, a still gif) and videos (mp4/mov/webm/mkv/m4v/
    avi, an animated gif) with ffmpeg/ffprobe only (`runner/lib/look-analyze.js`). Output (stdout, pretty JSON; `--json`
    = one line; `--out` writes the file and prints a short summary): `{ version: 1, created, refs: [ref], skipped:
    [{ file, reason }], project?, summary }`. ref: `{ file, name, type: "image"|"video"|"audio", palette: [{ hex, share }],
    light, contrast, inkContrast, saturation, warmth, temperature }` + for videos `{ duration, width, height, analyzedSeconds? (first
    300 s), cuts, cutTimes, cutsPerSec, shotLen: { median, p10, p90 }, motion, motionLabel: "calm"|"medium"|"kinetic",
    audio?: { duration, onsets, onsetsPerSec, bands: { low, mid, high }, lufs } }`. project (`--from-project`): `{ root,
    name, look, scenes: [{ name, kind, width, height, fps, duration, style, eases, tweens, sound }], presets: [{ name,
    file, colors, fonts, fontFamilies, radius, ease, scenes }], eases: { name: count }, durations: { n, median, p90,
    unit: "ms" }, sound: { cuesPerSec, sounds, variants, samples } }`. summary: `{ source: "refs"|"project"|"both",
    colourFrom: "refs"|"presets"|null, palette (≤ 8), light, contrast, inkContrast, saturation, warmth, temperature, pacing: { shotLen, cutsPerSec, motion, motionLabel } | null, sound: { onsetsPerSec,
    bands, lufs } | null, project?: { cuesPerSec, tweenMs } }`. With `--from-project` and no readable image/video, palette and tone come from the project's preset colours (each
    preset weighted by its scene count, its colours sharing that equally, bg / surface / text / accent first; `colourFrom:
    "presets"`). Unreadable files go to `skipped`; exit 1 only when nothing
    was readable. Progress phase `analyze` (`file` = the current name). `inkContrast` (0–1) = the L distance between the
    dominant palette colour and the farthest one with share ≥ 1 % (type on paper: low `contrast`, high `inkContrast`).
  - `look preview <id> [--library <dir>] [--t <sec>] [--still-only] [--json]` (no project needed; library default
    `<Documents>/gfx library`): renders `<lib>/looks/<id>/sample/` in a temp project (blank template + `look use`) with
    the template preview maker → `thumb.jpg` (long side 480, at `--t`, default 70 % of the duration) and, unless
    `--still-only`, `preview.mp4` (480 px, 24 fps, ≤ 6 s, H.264 CRF 30, silent) in the look folder. Progress phases
    `copy`, `thumbnail`, `preview`. `--json` → `{ look, library, t, thumb, preview, warnings }`. No `sample/scene.json`
    → exit 1 with a message saying so; a failed clip → exit 1 with the thumbnail kept. Thumb and clip are captured larger
    (thumb ≤ 4×, clip 2× the output scale, Fast mode, Exact retry) and downscaled with ffmpeg `flags=area`.
  - `look preview <id> --sheet [--n 12] [--cols 4] [--t a,b,...] [--out <png>] [--library <dir>] [--json]`: a contact sheet
    of the sample (default `out/look-sheets/<id>.png` in the current project, else a kept temp folder) + full-size stills
    `<sheet>-t<sec>.png` at the `--t` times; the look folder is not changed. `--json` → `{ look, library, sheet, stills, n }`.
  - `look check <id> [--library <dir>] [--json]` (default: the project's `looks/<id>/`, else the default Library):
    validates LOOK.md frontmatter (name, description, tags), preset `colors.bg|text|accent` + `fonts.sans|mono`, fonts
    only from bundled `style/fonts` files and loaded by `fontFiles`, synth sound names + variants, every sample entry's
    `src` (library-relative) + `alt`, `start` / `dur`, sample/scene.json + scene.js, folder ≤ 2 MB. Exit 1 on errors.
    `--json` → `{ look, path, where, ok, errors, warnings, bytes }`.
  - `look audition <id> [--library <dir>] [--out <wav>] [--json]`: every palette entry in a 1.4 s slot (the entry, then
    its `alt`; a src not installed here plays its `alt`) → `<id>.wav` + `<id>.sync.png` (default
    `out/look-audition/` in the current project, else a temp folder). Exit 1 if an entry can play nothing.
  - `look --help`, `look <cmd> --help`: usage per look command.
  - Palette entries (`sounds.json`): `{ role, sound, variant?, params?, tags?, note? }`; a sample entry is `{ sound:
    "sample", src: "library/<source>/<file>" (as gfx lib search --json reports it), start?, dur?, alt: { sound,
    variant?, params? } }` — `alt` is used when `src` doesn't resolve in the installed library.
  - `gfx new` without `--style` uses `look-<id>` when the project has a look preset.
- `gfx doctor [--json]` — engine (path, version), project (path, gfx.json, engine range ok), node, vite, browser,
  ffmpeg/ffprobe (path + version), library (path, sources, CLAP model). `--json` = one object with `missing[]`, `ok`.
  `browser` = `{ path, kind, source, exists, pinned, version }` (source `GFX_CHROME`|`pinned`|`auto`), plus `pinnedBrowser` `{ path, version, installed, supported, fastPrefersSystem }`.
  Exit 1 if browser, ffmpeg, vite or the engine version range is missing/unsatisfied. Also reports `git` (`{ path, version }` or null; `GFX_GIT` overrides PATH); git is optional (never in `missing[]`), it only enables `gfx version`.
- `gfx setup chrome [--force]` — downloads the pinned chrome-headless-shell (Chrome for Testing, version in `browser.js`; win64/linux64/mac-x64/mac-arm64) into `<library-parent>/browsers/chrome-headless-shell/<plat>-<version>/`. Discovery order: `GFX_CHROME` -> pinned shell (if installed) -> system Chrome -> Edge (fast mode on WSL: system Chrome first, the shell has no GPU there). `GFX_CHROME_URL` overrides the download URL. FOUNDATION.md §4b.
- `gfx setup ffmpeg [--force]` — downloads a static build into `<library-parent>/bin` (Windows: BtbN
  pinned ffmpeg 9.0.2 static GPL zip, SHA-256 verified, ffmpeg.exe + ffprobe.exe via fflate; Linux: johnvansickle tar.xz via `tar`).
  No-op when a working ffmpeg is already found (unless `--force`).

### `--progress json` (every command; meant for render/audio/still/sheet/setup/lib fetch/lib index)
stdout carries only JSON lines: `{ "type": "progress", "phase", "done", "total", "eta"? (s) , ...extra }`
(phases: `frames` + `encode` (render: both counted in frames, encode follows ffmpeg's own frame counter; still/sheet: frames), `audio` 0..4 (audio, also after `render --audio`), `download` (bytes) + `extract` (setup),
`packs` + `download` (lib fetch, `item` = pack), `index` (lib index, `source`)); every console line becomes
`{ "type": "log", "level": "info"|"warn"|"error", "msg" }`; last line `{ "type": "done", "outputs": [abs paths], "ms" }`
or `{ "type": "error", "msg" }` with exit code != 0. Without the flag the human output is unchanged.

## Scene folder

`scenes/<name>/scene.json`
```json
{ "kind": "three|canvas|svg|anime", "width": 1920, "height": 1080, "fps": 60,
  "duration": 6, "style": "dark-grid", "title": "Human title" }
```

`scenes/<name>/scene.js` — ESM, default export:
```js
export default {
  // called once; build DOM / canvas / three renderer / anime timeline inside ctx.root
  async setup(ctx) {},
  // MUST be a pure function of t (seconds, 0..duration). No Date.now, no performance.now,
  // no unseeded Math.random, no requestAnimationFrame, no CSS transitions/animations.
  // May be async (e.g. await a texture). Must leave the frame fully drawn when it resolves.
  render(t, ctx) {},
};
```

`ctx` = `{ root, width, height, fps, duration, style, meta }`
- `root`: an absolutely positioned `<div>` of exactly width×height px, `overflow:hidden`, background `style.bg`.
- `style`: the resolved preset object (see below). Its tokens are also set as CSS custom properties on `root` (`--gfx-bg`, `--gfx-accent`, … kebab-cased from the keys of `style.colors`, plus `--gfx-font-<kebab key>` for every `style.fonts` key: `--gfx-font-sans`, `--gfx-font-mono`, and extra keys such as
  `--gfx-font-serif` / `--gfx-font-display`).
- `meta`: the parsed scene.json.

Scenes may import bare packages (`three`, `animejs`) and runner libs via `/runner/lib/<file>.js`. Scene-local assets (images, svg, fonts) live in the scene folder and are imported relative to `scene.js` (e.g. `new URL('./logo.svg', import.meta.url)`).

### Kind conventions
- **three**: create `THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })`, `setPixelRatio(1)`, size width×height, append to root; `render(t)` sets all transforms from t then calls `renderer.render`. No `OrbitControls` in captured output, no clock.
- **canvas**: create one `<canvas>` width×height; `render(t)` clears and redraws everything each frame. Particles = deterministic function of (seed, index, t), or a fixed-step simulation re-run from 0 with caching by frame index.
- **svg**: inline `<svg viewBox="0 0 W H">`; `render(t)` sets attributes (stroke-dashoffset, transforms, d). Path length via `getTotalLength()` in setup.
- **anime**: build an anime.js v4 `createTimeline({ autoplay: false })` in setup over DOM/SVG in root; `render(t)` calls `tl.seek(t * 1000)`. Works for HTML/CSS UI mockups too.

## Style presets

`style/presets/<name>.js` default-exports:
```js
{
  name: 'dark-grid',
  colors: { bg, grid, gridStrong, stroke, text, muted, accent, accentSoft, surface, border },
  fonts: { sans, mono },          // CSS font-family strings
  fontFiles: [],                  // optional [{ family, url, weight }] loaded via FontFace before setup
                                  // bundled: url `/style/fonts/<family>-latin-<weight>-normal.woff2` for Inter, IBM Plex Mono,
                                  // Ubuntu, Fraunces, Nunito, Fredoka, Space Grotesk (see style/fonts)
  radius: 8,
  ease: { out: 'outExpo', inOut: 'inOutCubic', spring: 'outElastic(1, .6)' }, // anime.js-style names
}
```
`runner/lib/style.js` exports `drawGrid(ctx2d, style, { cell, majorEvery })` and `gridSvg(style, w, h, opts)` helpers so every kind can paint the preset's background grid.

## Runner libs (pure, no DOM unless noted)
- `ease.js`: named easing functions `(x:0..1)=>0..1` — linear, inOutCubic, outCubic, outExpo, inOutExpo, outBack, outElastic, inOutSine.
- `tween.js`: `clamp`, `lerp`, `progress(t, start, end)` → 0..1 clamped, `tween(t, start, end, from, to, ease)`, `keyframes(t, [{t, v, ease}])` (numbers or arrays of numbers), `stagger(i, each, start)`.
- `rng.js`: `mulberry32(seed)` → `() => [0,1)`; `hash(i, seed)`.

## Player (`runner/player/`)
URL: `/runner/player/index.html?scene=<name>[&capture=1]`
- Loads scene.json + preset (+ fontFiles via FontFace), awaits `document.fonts.ready`, builds `root`, awaits `setup`, renders t=0.
- Exposes `window.__gfx = { ready: Promise<meta>, seek(t): Promise<void>, meta }`. `seek` awaits `render(t)` then two rAFs.
- Without `capture=1`: realtime preview loop with a minimal control bar below the frame (play/pause, scrubber, time readout, loop toggle; space = play/pause, ←/→ = ±1 frame). Frame is scaled to fit the window (CSS transform), not re-rendered at a different size.
- With `capture=1`: no controls, no scaling, body margin 0, frame at (0,0), page background = style bg.

## CLI (`gfx`)
All commands take a scene name (folder under the project's `scenes/`). Dev server = Vite, root = project (= repo root for this repo). Global options: `--project <dir>`, `--progress json`. `init`, `doctor`, `setup` are described under "Engine and projects".
- `gfx new <name> --kind <kind> [--size 1920x1080] [--fps 60] [--dur 6] [--style dark-grid]` — copy `templates/<kind>` → `scenes/<name>`, write scene.json (style default: the project look's `look-<id>` preset, else dark-grid).
- `gfx dev <name> [--port 5173]` — start Vite, print the player URL.
- `gfx still <name> --t <sec> [--out out/<name>/still-<t>.png] [--scale k] [--mode fast|exact]` — headless capture of one frame.
- `gfx sheet <name> [--n 12] [--cols 4] [--out out/<name>/sheet.png] [--mode fast|exact]` — contact sheet of n evenly spaced frames with time labels (for reviewing motion without watching video).
- `gfx render <name> [options]` — deterministic frame-by-frame capture → ffmpeg (spec: FOUNDATION.md §4, "as built (§4)" there). Defaults unchanged: mp4 = libx264 yuv420p crf 18 +faststart; webm = libvpx-vp9 crf 30 b:v 0; gif = palettegen/paletteuse, fps capped at 30; png = numbered sequence dir (`frame-00000.png`). Options: `--format mp4|webm|gif|png|prores|webm-alpha|mov-alpha`, `--codec h264|h265` (mp4), `--crf N | --quality draft|normal|high` (crf 28/18/12), `--fps N`, `--from/--to/--dur`, size: one of `--size WxH | --scale k | --preset 720p|1080p|4k|reel|reel-4k|square|portrait`, `--crop x,y,w,h | --crop-track file.json`, `--fit contain|cover` + `--pad #hex|transparent`, `--reframe WxH` (scene.json `"responsive": true` only), `--alpha`, `--audio` (mp4 export with `--out` or a size/range suffix = ONE file with sound at that name; the review video `out/<name>/<name>.mp4` keeps the silent file + `<name>.sound.mp4`; `--keep-silent` keeps both for any render), `--out`, `--render-preset id` (from `scenes/<name>/render.json`), `--workers N|auto` (parallel capture: N headless browsers on one Vite server, frames written in order; env `GFX_WORKERS`, default `1` = bit-exact; N > 1 can differ by ±1 LSB, see FOUNDATION.md As built §4a; may also be set in a render.json preset; spec FOUNDATION.md §4a), `--mode fast|exact` (env `GFX_MODE`, render.json key `mode`; default exact = software raster, bit-exact; fast = GPU raster per platform, `--workers` defaults to `auto`, not bit-exact across drivers; logs `renderer: …` (progress `log` event) and warns when it falls back to software), `--frame-format png|jpeg` (intermediate screenshots, render.json key `frame-format`; jpeg = quality 92, only mp4/webm/gif, error with png/prores/alpha formats; spec FOUNDATION.md §4b). `gfx render --list-presets [<name>] [--json]` prints `{ builtin: [{id,label,width,height}], scene: [{id,label,options}] }`. Shows progress (`frames`, `encode`); prints output path, frame count, wall time.
- `gfx export <name>` — Vite build to `out/<name>/web/`: self-contained `index.html` that autoplays the scene looping in realtime (click = pause), scaled to fit its container; prints an `<iframe>` embed snippet.
- `gfx list` — scenes with kind/size/duration.

Capture details: `puppeteer-core` driving system Chrome or Edge (discovery above, override `GFX_CHROME`), headless, flags `--use-angle=swiftshader --enable-unsafe-swiftshader --hide-scrollbars --force-color-profile=srgb`, viewport = scene size × scale, `deviceScaleFactor = scale`. Frames are screenshots clipped to root, piped as PNG into ffmpeg `image2pipe`. Every command that starts Vite/Chrome must shut both down on exit and on error.

## Audio (v1: synthesized SFX, separate stems)

Sound is derived from scene events, never laid on blindly. Audio never requires re-capturing video frames.

### Cues (scene side)
- `ctx.cue(t, sound, opts?)` — callable in `setup` (and only there). `t` seconds = the moment the sound must *hit* (impact frame, not motion start).
  `opts = { id?, gain? (dB, default 0), pan? (-1..1), x? (frame px → pan computed as (x/width)*2-1, *0.6), pitch? (semitones), dur? (s, for whoosh/rise/type), stem?, intensity? (0..1), variant? (string) }`.
- Default `id` = `<sound>-<n>` where n counts that sound in call order (stable as long as call order is stable). Prefer explicit ids for important cues.
- Player exposes `window.__gfx.cues` (array, sorted by t).

### Sound library (`runner/lib/sfx.js`)
Deterministic Web Audio recipes rendered in an `OfflineAudioContext` (48 kHz stereo; noise from seeded `mulberry32`; shared short, dark algorithmic reverb ~0.8 s). Each recipe has a default stem:
| sound | stem | meaning |
|---|---|---|
| `impact` | hits | big landing / slam (sub thump + noise crack) |
| `swoosh` | hits | flood / wipe reveal |
| `suck` | hits | collapse / reverse swell into a point |
| `logo` | hits | brand hit on logo reveal (impact + bright bell tail) |
| `whoosh` | motion | fast move / whip-pan; peak at `t`, length `dur` |
| `rise` | motion | tension riser ending at `t` |
| `wind` | motion | filtered-noise breeze bed **starting** at `t`, length `dur` (default 2.5 s; `gust` 2 s); variants `breeze` (default) / `gust` |
| `click` | ui | tap on a button |
| `pop` | ui | element appears; `pitch` for staggers (use `pentatonic(i)` helper) |
| `tick` | ui | counter / small step |
| `type` | ui | typing burst of `dur` |
| `beep` | ui | short UI beep; variants `soft` (default, sine ~0.14 s) / `digital` (square, ~0.09 s); `dur`, `pitch` |
| `ding` | accents | result lands (count-up ends) |
| `chime` | accents | success / done |
Helpers exported for scenes: `pentatonic(i, base=0)` → semitone offset; `countTicks(t0, t1, n, ease)` → array of times (accelerating ticks for count-ups).

### Intensity, variants, variance (hits and motion sounds)
- `intensity` (0..1) scales layer levels, sub depth, crack amount, distortion drive, reverb send and tail length; low values are softer *and* shorter, not just quieter. Defaults: impact 0.55, swoosh 0.5, suck 0.6, logo 0.9, whoosh 0.45, rise 0.5, wind 0.4 (level + brightness of the bed). ui/accent sounds ignore it.
- `variant`: impact `thud` (soft sine sub drop + felt transient, no crack/distortion) | `punch` (tight sub, short dark crack, light drive) | `boom` (hero: deeper sub, wide rumble bed, longer tail); whoosh `air` (soft breathy, low Q, lowpassed ~4-5 kHz) | `swipe` (filtered noise + quiet pitched glide) | `zip` (short, brighter, capped ~7 kHz); swoosh `silk` (smooth, darker) | `wash` (broader, slower); logo `boom` (default) | `punch` | `thud` (body of the hit). suck and rise have no variants; beep `soft` | `digital` and wind `breeze` | `gust` are never auto-picked (soft / breeze when omitted). When omitted, impact (thud/punch), whoosh and swoosh pick one deterministically from the cue seed, never the same as the previous cue of that sound (resolved in time order; the choice is written to cues.json). `boom` is never auto-picked.
- Every hit/motion cue also varies from its own seed (id + t): pitch +-2 st, filter centre/sweep +-25%, duration +-15%, envelope curvature, stereo width, layer balance +-2 dB. Noise layers are lowpassed (little energy above ~7 kHz). Both opts can be overridden per cue in sound.json.

### `scenes/<name>/sound.json` (optional, hand-editable fix layer)
```json
{ "stems": { "ui": { "gain": -3 }, "hits": { "mute": false } },
  "cues": { "pop-3": { "t": 6.25, "gain": -6 }, "impact-2": { "sound": "logo" }, "tick-7": { "mute": true } },
  "add": [ { "t": 9.0, "sound": "chime", "gain": -4 } ],
  "master": { "lufs": -14 } }
```
Applied on top of scene cues: per-cue override (t/sound/gain/pan/pitch/dur/intensity/variant/src/start/rate/env/stem/mute), extra cues, per-stem gain/mute, loudness target.

### Sample cues (recorded files)
`ctx.cue(t, 'sample', { src, start?, dur?, rate?, env?, gain?, pan?, stem?, id? })` (also valid in `sound.json` `add[]`/overrides). Default stem `samples`. `sample` is not in `SOUND_NAMES` (that list is the synth sounds); it needs `src`.
- `src`: path relative to the library parent (= the repo root here; e.g. `library/kenney/impact/Audio/impactGlass_medium_000.ogg`), project-relative, or absolute. `t` = moment the played region starts (the hit is the file's first audible sample; use `start` to skip lead-in).
- Plays `start..start+dur` of the file (defaults: 0 .. end) at `rate` (1; 0.25..4, changes speed and pitch; the played length is `dur/rate`), multiplied by `env` (>= 2 numbers, typically 32 values 0..1, linearly interpolated over the played length), with 3 ms fade in / 20 ms fade out, then the usual `gain`/`pan` (stereo files keep their image; mono is centered; `pitch` is ignored).
- Determinism: the file is decoded by the browser, then trimmed/resampled/enveloped in plain JS (`shapeSample`, Catmull-Rom for rate != 1) and summed through the order-stable bus, so stems are byte-identical run to run (same Chrome build + same file bytes).
- Loading: `renderStems(cues, { duration, stems, loader })` where `loader(src) => Promise<ArrayBuffer>` returns the encoded file bytes. Default loader (`defaultSampleLoader`) fetches `/@gfx-audio?src=...` from the gfx Vite server (`gfx audio`, `gfx dev`); the route serves only audio files under `library/` or inside a folder registered in `library/sources.json` (realpath-checked). The studio passes its own loader (read_bytes). Without a loader, sample cues are skipped with a console warning. A missing/undecodable file warns and renders silence for that cue.
- Sample stems are un-normalized like all stems (per-cue trim 0.5 so hot library files leave headroom).

### Sound library (`gfx lib`, docs/SOUND-LIBRARY.md)
The library folder (see "Engine and projects"; in this repo the gitignored `library/`, only `library/sources.json` is tracked): `sources.json` lists `{ id, kind: synth|folder, path?, license, enabled }`; `path` may be repo-relative or absolute (Windows `D:/..` maps to `/mnt/d/..` in WSL).
- `gfx lib list [--json] | add <id> <path> [--license ..] [--json] | remove <id> [--json] | enable|disable <id>`. `list --json` → `{ library: <abs dir>, sources: [{ id, kind, path, dir, license, enabled, files, indexed, version, missing?, project? }] }`; `add --json` → the new source + `dir`, `exists`. `remove` drops a global source from sources.json and deletes its index files (audio files are never touched); it refuses `synth` and gfx.json (project) sources. sources.json is written atomically (temp file + rename).
- `gfx lib fetch kenney [--packs impact,interface,ui,digital,scifi,rpg]`: scrapes the pack page on kenney.nl for the zip, extracts to `<library>/kenney/<pack>/` with fflate (License.txt kept; no external unzip) and registers the `kenney` source if the library lacks it (same for `freesound-cc0`). `gfx lib fetch freesound --query "<q>" [--n 50] [--min-dur 0.05 --max-dur 6]`: API v2 search filtered `license:"Creative Commons 0"`, HQ previews into `library/freesound-cc0/` + `credits.json`; needs `FREESOUND_API_KEY` (prints how to get one and exits 2 otherwise).
- `gfx lib index [<id>...] [--force]`: incremental (path + mtime + size). Decodes with ffmpeg to 48 kHz mono, trims silence, computes features (`runner/lib/vox-features.js`) and a CLAP audio embedding (`Xenova/clap-htsat-unfused`, int8 ONNX via `@huggingface/transformers`, model cached in `library/.models`, ~156 MB; first run downloads, afterwards fully offline). Files > 8 s become up to 6 onset-segmented entries. `synth` is rendered with sfx.js (every recipe x variant x 3 intensities x 2 durations where `dur` applies) in headless Chrome.
- `gfx lib search "<text>" [--role r] [--max-dur s] [--source id]... [--n 10] [--json]`: hybrid ranking, score = CLAP text -> audio cosine + 0.3 × keyword score (file name / folder / label / role words). `--json` → `[{ id, source, src, start, dur, score, clap, kw, weak, role, labels, license, synth? }]`; `weak: true` = low CLAP score and no name match (nothing really fits; use the synth). docs/SOUND-LIBRARY.md "Look friction round".
- `gfx lib info <src | <source>/<file> | entry id | path> [--json]`: one file → `{ installed, src, path, source, license, start, dur, fileDur, indexed, entries[] }`; **exit 1** (`installed: false`) when it is not in the installed library (a look palette entry then plays its `alt`).
- `gfx lib files [--source id]... [--grep text] [--role r] [--json]`: browse the files of the enabled (or chosen) sources with their index tags. `gfx lib --help`: all subcommands.
- `gfx lib similar <ref> [--role r|any] [--max-dur s] [--min-dur s] [--source id]... [--n 8] [--json]`: ref = an index entry id, an audio file (decoded + embedded on the fly) or `<scene>:<cueId>` (the cue's own entry via `queryFromCue`; cues from a fresh `out/<scene>/audio/cues.json`, else the scene page; role = the cue's stem when it is hits/motion/ui/accents). Ranking = `similar()` in `runner/lib/sound-rank.js` (docs/SOUND-LIBRARY.md §2); output like search + `why`.
- Role filter (search and similar): entries of the same role stay, a confident other role (`roleScore` ≥ 0.4) is dropped, uncertain / untagged entries stay (similar ranks them lower).
- Index: `library/index/<id>.jsonl`, one JSON object per line + `<id>.meta.json` (`{ model, version: 2, rank, sfx?, entries }`; a model change or `--force` re-indexes everything; a version-1 index is upgraded by re-tagging: labels / role from the stored `emb`, bands from a decode of each entry's region, no CLAP audio pass; a `rank` (sound-rank `RANK_VERSION`) change re-tags from the stored emb + bands without a decode):
  `{ id, src, m, z, start, dur, features, emb }` for files (`id` = `<source>:<path within source>[#<start>]`, `src` repo-relative or absolute, `m`/`z` = mtime ms / size for incremental checks, `start`/`dur` = trimmed region in seconds, usable directly as a sample cue's `start`/`dur`), or `{ id, synth: { sound, variant?, intensity?, dur?, hit }, start: 0, dur, features, emb }` for synth entries (no `src`; `hit` = seconds from the entry start to the cue time `t`, since whoosh/rise/suck pre-roll).
  `emb` = base64 little-endian float32[512], L2-normalized (cosine = dot). v2 adds `tags: { labels: [[label, p]×3] (CLAP zero-shot over CLAP_LABELS, softmax temp 30), role: hits|motion|ui|accents|null, roleScore, bands: [low <250 Hz, mid 250–4k, high >4k] energy shares (sum 1) }`; synth entries: role = the sound's default stem, roleScore 1. Readers treat a missing `tags` as unknown. `features` = `{ dur, env[32], peakDb, attack, decay, centroid, centroidSlope, flatness, pitch: { voiced, hz, conf, slope }, zcr, onsets }`; `featureVector(f)` / `distance(a, b)` in `vox-features.js`.
- `runner/lib/vox-features.js` is pure ESM (no Node or DOM APIs; shared by the indexer and the studio): `analyze`, `featureVector`, `distance`, `segmentEvents`, `trimSilence`, `embToB64/b64ToEmb/cosine`, `bandEnergies(pcm, sr)`, `CLAP_LABELS` (the CLAP label set), `labelPrompt`, `loadClap({ modelPath, model?, local: true })` -> `{ embedAudio(pcm48k), embedText, zeroShot(emb, labels?) }`.

### CLI
- `gfx audio <name> [--video path]` → `out/<name>/audio/`:
  - `cues.json` (final resolved cue list incl. ids — the reference for editing sound.json)
  - `stems/<stem>.wav` for each stem (full scene length, start at 0, 48 kHz 24-bit stereo, un-normalized)
  - `mix.wav` (sum of stems, loudness-normalized to master.lufs with a true-peak limit of -1 dBTP)
  - `sync.png` — sync sheet: thumbnail strip of frames across the timeline, below it one waveform lane per stem with cue markers + labels (id) at exact times, time ruler. This is how Claude verifies sync (it cannot listen).
  - muxes `mix.wav` into the video if it exists (`out/<name>/<name>.mp4` or `--video`) → `<video>.sound.mp4` next to it, e.g. `out/<name>/<name>.sound.mp4`, `out/<name>/<name>-2160x3840.sound.mp4` (video stream copied, AAC 192k). Never overwrites the silent original.
- `gfx render <name> --audio` = render then `gfx audio`.
- `gfx dev`: if the scene has cues, the preview plays the mix in sync (play/pause/seek), with a mute toggle.

## Elements, tweaks and the review loop (spec: docs/REVIEW.md)

### Naming elements (`ctx.el`, `data-gfx`)
- Every DOM element in `ctx.root` is selectable. Named: `data-gfx="phone"` in markup, or `ctx.el('phone', node)` in `setup` (sets the attribute; setup-only like `ctx.cue`). Names are unique per scene (a duplicate warns and becomes `name~2`; names must not start with `@`).
- Background convention: every scene names a full-frame, bottom-of-stack element `background` (anime: `<div data-gfx="background" style="position:absolute;inset:0">` + `gridCss`; svg: `gridSvg(..., { name: 'background' })`; canvas/three: a separate bottom `<canvas data-gfx="background">` + `drawGrid`) so Layers can select/hide/tweak it. The preset only sets `colors.bg` on `#gfx-root` (always there, also when `background` is hidden). Templates follow it; the skills require it. Older scenes (e.g. _reel-test) paint the grid on the root and have no background layer (kept pixel-identical).
- Code markers (spec docs/INSPECTOR.md §1): each named element's code (creation, styling, per-frame code, sound cues) sits in `// @gfx <name> [name2…]` … `// @end` blocks; CSS `/* @gfx name */ … /* @end */`, HTML in a template literal `<!-- @gfx name --> … <!-- @end -->`. Several blocks per name; no nesting (a new `@gfx` ends the open block); a block without `@end` runs to the end of the file; only names on the `@gfx` line (no free text). Scanned in the scene folder's `.js/.css/.html`. The bridge `code { key }` answers `regions` from them (`marked: true`); without markers it falls back to refs expanded to statements and identifiers traced from the `ctx.el` call (`marked: false`, "traced (approximate)" in the studio), plus `tweakable: { props, read }` (which tweak properties the scene reads via `ctx.tweak('key')`). Markers are comments only, so renders stay byte-identical. Templates and skills use them; older scenes (e.g. _reel-test) have none.
- Unnamed elements get the stable structural key `@i/j/k` (child-element indices from `ctx.root`).
- Non-DOM objects (canvas/three): `ctx.el('ball', { bounds: (t) => ({ x, y, w, h }) })` (scene px). The scene reads its tweak itself.
- `ctx.tweak(name)` -> `{ x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, text?, color?, bg? }` (effective tweak, identity defaults); callable any time (usually in `render`).
- Name the visible box, not a zero-size positioning wrapper (bounds of a size-less wrapper fall back to the union of its descendants, but rotate/scale pivot on the element's own centre).

### `scenes/<name>/tweaks.json` (optional, flat map key -> tweak)
`{ "total": { "x": 0, "y": -40, "scale": 1.2, "rotate": 0, "opacity": 1, "text": "…", "color": "#fff", "bg": "#000" } }` — x,y in screen px (scene px as seen), rotate in degrees, opacity multiplies, all optional. Applied after every `render(t)` by the player and by capture (so `still/sheet/render/audio` honour it) via the CSS individual properties `translate`/`rotate`/`scale` (composed with the scene's own `transform`; rotate/scale pivot on the element's visual centre), `opacity` (multiplied, never compounding), `text` (single-text-node elements), `color`, `backgroundColor`. Removed tweaks restore the original values. Unresolved keys -> one warning in `__gfx.warnings`, never an error. Inline non-replaced elements (`display:inline`) cannot be transformed by CSS; 3D ancestors (`rotateY`, perspective) are mapped with their 2D linear part only. Live tweaks (bridge) merge per property over the file layer. `visible: false` (inline `visibility:hidden`, hidden in output too) and `z` (integer `z-index`, `position:relative` added when static) are also tweak properties. Layers: `window.__gfx.tree()` / `spans({ step })` / `setView({ hidden, solo })` and the bridge messages `tree`, `spans`, `view` (REVIEW.md §6) expose the named-element hierarchy, sampled visibility intervals and view-only hide/solo overrides. `values(keys, t?)` (actual centre/AABB/accumulated scale+rotation/opacity/visible per key, scene px) and `path({ key, from?, to?, step? })` (per-frame samples with centre, scale, rotation, opacity, visible and the 4-point quad; one serialised sampling job like `spans`, cached) plus bridge messages `values` and `path` are specified in REVIEW.md §7.

### `window.__gfx` additions (player, capture and bridge)
`setTweaks(obj)` (live layer, re-renders the current t), `setFileTweaks(obj)`, `pick(x, y)` (scene px) -> `{ stack: [{ key, label, bounds:{x,y,w,h}, named, text, rot }] }` topmost first (bounds-registered objects, then the hit element and its ancestors), `bounds(keys)` -> `{ key: {x,y,w,h} }`, `elements()` -> `[{ key, label }]` (named), `calib(key)` -> `{ sx: 1, sy: 1 }`, `warnings` (array). Coordinates are scene px even when the preview root is CSS-scaled.

### Live bridge (`gfx serve`)
`gfx serve [--port 5199]` keeps Vite (project root) running and prints `gfx serve: http://127.0.0.1:<port>`; `GET /__gfx/ping` -> `{ ok: true, root, engine }` (root = served project, native path; CORS `*`). `/runner/player/bridge.html?scene=<name>` renders the scene at native size at (0,0) with no controls and speaks postMessage (protocol in REVIEW.md §4: `seek`, `tweaks`, `pick`, `bounds`, `elements`, `calib`; replies go to `event.source` with targetOrigin `*`; plus `hello` -> `ready` again, `fileTweaks` re-reads tweaks.json, unknown types get `ok:false`). Code links (docs/CODE-VERSIONS.md §1): `code { key }` -> `{ refs: [{ kind: named|defined|styled|animated|sound|ref, file, line, col, snippet, t0?, t1?, props?, cue?, cues?, inherited?, count? }], regions: [{ file, from, to, kind: marked|traced|ref, label }], marked, tweakable: { props, read } }` (regions: docs/INSPECTOR.md §1) and `codeAt { file, line }` -> `{ keys }`; `GET /__gfx/scene-files?scene=<name>` -> `{ files: [{ path, text }] }` backs the static search. Bridge-only (capture/render never load `runner/player/code.js`).

### Review CLI
- `gfx review <scene> [--all] [--json] [--stills]` — open comments (`out/<scene>/review/comments.json`) sorted by t with absolute attachment paths (markup first) and a summary of the pending draft (audio edit counts, tweaks per element). `--stills` renders `shots/<id>-exact.png` for open comments with x,y (capture with tweaks.json + draft.tweaks).
- `gfx review <scene> --resolve <id> | --wontfix <id> | --reopen <id> [--reply "…"]` — merge-on-write by `updated` (tombstones `{ id, deleted: true, updated }` hide comments).
- `gfx apply <scene> [--tweaks] [--sound]` (default both) — folds `draft.tweaks` into `scenes/<scene>/tweaks.json` (merge per key, identity values drop) and draft stems/cues/add into `sound.json`, removes them from the draft, leaves comments alone. Re-run `gfx render/audio` afterwards. When the project has its own git history (and is not the engine repo) it first auto-saves a version (`gfx version save`, actor `auto`, "Before apply <scene>"); no history or no git = skipped silently.
- Verification: `node tests/review.test.mjs` (fixture scene `scenes/_review-test`); engine/project: `node tests/project.test.mjs`.

### Versions (`gfx version`, spec: docs/CODE-VERSIONS.md §2)
`gfx version init | status | save | log | diff | restore` over the system git (`runner/lib/version.js`, one spawn helper; `GFX_GIT` or PATH). `--json` on every subcommand; `--project`; `--allow-engine` overrides the engine-repo refusal (init/save/restore refuse there; status/log/diff stay available read-only). Trailers on commits: `Gfx-Actor: user|claude|auto`, `Gfx-Scene`, `Gfx-T`. `save` is a no-op (`{ "skipped": "clean" }`, exit 0) when nothing changed; `restore` auto-saves first, then adds a "Restored <short>" commit (history only grows). `.gitignore` gets `out/ .gfx/ node_modules/`. Verification: `node tests/version.test.mjs`, `node tests/code.test.mjs`.
Visual diff (docs/VISUAL-DIFF.md §2): `gfx version export <rev> --out <dir>` (read-only plumbing; engine repo: scenes/ style/ gfx.json only) and `gfx version preview <rev|now> [--port p] [--idle s] --json` (long-running Vite server on a temp checkout, ports 5260-5299, one `{ "type": "vdiff", url, scenes, … }` line; exits on a signal, `POST /__gfx/vdiff-stop` or after `--idle` s without requests, removing its checkout). Verification: `node tests/vdiff.test.mjs`.

### Launchers, project guide, `gfx context` (spec: docs/CLAUDE-IN-APP.md §1-2)
- `bin/gfx` (sh) and `bin/gfx.cmd` (Windows) run `<engine>/runner/cli.js` with the bundled node (`<engine>/node/node[.exe]`) if present, else `node` on PATH; any cwd, symlinks followed. Terminals opened by gfx studio put `<engine>/bin` on PATH and set `GFX_PROJECT`, `GFX_ENGINE`. Other shells (T3 threads) read the project's machine-local `.gfx/engine.json` (`{ engine, bin, node, wsl?, updated }`, written by `gfx init` / `gfx init --refresh` and by gfx studio on open; docs/FOUNDATION.md).
- Project `CLAUDE.md` uses `gfx <cmd>` only (no absolute paths) and keeps the managed text between `<!-- gfx:begin -->` and `<!-- gfx:end -->`. `gfx init --refresh [<dir>]` rewrites that block (appends it if missing; text outside is untouched) and re-copies `.claude/skills`; refuses when the project is the engine.
- `gfx context <scene> [--t s] [--el key]... [--comment id]... [--tweaks] [--values-json file] [--format md|json]` — brief: header (scene, time/frame, size, fps, project), `Selected:` per `--el` (and the `el` of each `--comment`), `Pending tweaks:` (draft, shown when present; `--tweaks` also prints `none`), `Pending audio edits:`, `Comments:` (the `--comment` ids in any status, else all open; absolute attachment paths, markup first), `Files:`. `--t` defaults to the values-json `t`, else the first `--comment`'s `t`, else 0. `--values-json` = live values from the app: `{ "t": 7.61, "elements": { "<key>": { "tag", "text", "cx", "cy", "scale", "rot", "opacity" } } }` (a bare key map also works); without it the actual-values part is omitted. `--format json` prints `{ scene, project, t, frame, frames, width, height, fps, selected, pendingTweaks, pendingAudio, comments, files }`.
