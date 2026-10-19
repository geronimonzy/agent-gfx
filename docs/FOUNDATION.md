# Foundation: native engine, projects, live reload, render dialog — spec v1

Goal: gfx studio becomes the home for making motion graphics with Claude, shareable with other people on Windows
(Mac later). This step removes the WSL/Node-in-WSL requirement, separates **engine** from **project**, reloads the
live scene when code changes, and adds a render dialog + queue. (Next steps, not here: terminal + T3 integration,
params/marks, music, packaging/installer.)

## 1. Engine vs project
- **Engine** = everything that is the same for every user: `runner/`, built-in `style/` (presets + fonts),
  `templates/`, `.claude/skills/` (copied into projects), `package.json` + production `node_modules`, the base Vite
  config. In this repo the engine is the repo itself; in the app it is a resource folder next to the exe
  (`<app>/engine/`) with a bundled `node.exe` (`<app>/engine/node/node.exe`).
- **Project** = a user folder (git-friendly):
  ```
  my-project/
    gfx.json                 { "version": 1, "name": "My project", "engine": ">=0.2" }
    scenes/<name>/...        scene.json, scene.js, STORYBOARD.md, SOUND.md, sound.json, tweaks.json, assets
    style/presets/*.js       project presets (override / extend engine presets of the same name)
    style/fonts/...
    out/                     renders, audio, review/ (gitignored by the template .gitignore)
    .claude/skills/          managed copies of the engine's skills (init + `gfx init --refresh`; .gfx/skills.json)
    CLAUDE.md                short project guide pointing at the skills + `gfx` CLI
  ```
- The CLI takes the project from `--project <dir>` or `GFX_PROJECT`, else walks up from cwd to the nearest `gfx.json`,
  else (back-compat) the engine root itself (this repo keeps working unchanged: add a `gfx.json` at the repo root).
- **URL scheme stays the same for scenes**: the Vite server's root = project; `/runner/*` and engine `/style/*` are
  served from the engine (Vite plugin / alias), project `/style/presets/x.js` wins over the engine's; bare imports
  `three`, `animejs` (and anything else in engine deps) resolve from the engine's node_modules (`resolve.alias` /
  `dedupe` + `server.fs.allow` for the engine dir). Existing scenes keep working byte-identically.
- **Library** (sound): global per user — `GFX_LIBRARY` env, default `%APPDATA%/gfx/library` on Windows,
  `~/.local/share/gfx/library` on Linux, `<engine>/library` if it exists (back-compat for this repo). Same layout as
  now (`sources.json`, `index/`, `.models/`, packs). A project may add sources in `gfx.json` `library.sources[]`.
- `gfx init <dir> [--template reel|promo|blank] [--name ...]` creates a project (copies template project + skills,
  writes gfx.json, .gitignore, CLAUDE.md). Templates live in `engine/templates/projects/<id>/` (start with `blank`
  and `reel` = a 1080x1920 anime starter with a few named elements, cues and a STORYBOARD.md stub).
- `gfx doctor [--json]` prints engine/project paths, node version, browser path, ffmpeg path/version, library dir,
  CLAP model presence; exit 1 if something required is missing.

## 2. Windows-native engine
- No POSIX assumptions: `path` everywhere, no `unzip`/`bsdtar` (use a JS unzip, e.g. `fflate`), no `/usr/bin`,
  no shell spawns (spawn binaries directly), file URLs via `pathToFileURL`.
- **Browser**: `GFX_CHROME`, else first existing of Chrome (Program Files, Program Files (x86), LocalAppData),
  Edge (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, Program Files), Linux `/usr/bin/google-chrome`,
  `chromium`, mac Chrome. Same flags (swiftshader). Report in `gfx doctor`.
- **ffmpeg**: `GFX_FFMPEG`, else `ffmpeg` on PATH, else `<library-parent>/bin/ffmpeg(.exe)`; `gfx setup ffmpeg`
  downloads a static build (Windows: pinned BtbN ffmpeg 9.0.2 static GPL zip from a month-end autobuild, SHA-256 verified (`FFMPEG_URLS`/`FFMPEG_SHA256` in runner/lib/ffmpeg.js) → extract
  `ffmpeg.exe`, `ffprobe.exe`; Linux: johnvansickle static tar.xz) with progress (JSON lines with `--progress json`).
  All ffmpeg spawns go through one helper.
- Must be verified with a real Windows `node.exe` (download the official win-x64 zip into
  `/mnt/c/Users/<you>/dev/gfx-engine-test/node/` and run it from WSL via interop on a project folder under
  `/mnt/c/Users/<you>/dev/gfx-projects/`): `gfx doctor`, `gfx still`, `gfx render --dur 1`, `gfx audio`, `gfx serve`.
  Windows `node_modules` must contain win32 native bindings (Vite/rolldown, esbuild if used, onnxruntime-node):
  install with `npm ci --omit=dev --os=win32 --cpu=x64` into the engine copy (or run Windows npm).

## 3. Machine-readable progress
Every long command accepts `--progress json`: one JSON object per line on stdout,
`{ "type": "progress", "phase": "frames"|"encode"|"audio"|"download"|..., "done": n, "total": n, "eta": s? }`,
`{ "type": "log", "level": "info"|"warn"|"error", "msg": "..." }`, final `{ "type": "done", "outputs": [paths], "ms": n }`
or `{ "type": "error", "msg": "..." }` (exit code ≠ 0). Human output unchanged without the flag.

## 4. Render options (CLI)
`gfx render <scene> [options]` (existing flags keep working):
- `--size WxH` output size, or `--scale k` (default 1). Vector/DOM scenes are captured at `deviceScaleFactor`
  = output/scene ratio, so 4K from a 1080p scene is sharp (not upscaled). Non-uniform aspect → see crop/reframe.
- `--preset id` from built-ins: `1080p` 1920x1080, `4k` 3840x2160, `reel` 1080x1920, `reel-4k` 2160x3840,
  `square` 1080x1080, `portrait` 1080x1350, `720p`; presets fix output size only.
- `--crop x,y,w,h` (scene px) static crop window, or `--crop-track <file.json>` animated window
  (`{ "keys": [ { "t": 0, "x":..,"y":..,"w":..,"h":.., "ease": "inOutCubic" } ] }`, w/h aspect fixed = output aspect);
  `--fit contain|cover` + `--pad #hex` when the scene aspect ≠ output aspect without a crop (default cover = centre crop).
- `--reframe WxH`: re-layout, only for scenes with `"responsive": true` in scene.json — the scene is built at that
  size (ctx.width/height change). Otherwise error with a hint to use crop.
- `--fps N`, `--from s --to s` / `--dur s` (existing), `--format mp4|webm|gif|png|prores|webm-alpha|mov-alpha`,
  `--codec h264|h265` (mp4), `--crf N` / `--quality draft|normal|high` (crf 28/18/12), `--alpha` (transparent root and
  page background; formats prores 4444 / webm-alpha (vp9 yuva420p) / png keep alpha; error for mp4/gif),
  `--audio` (mux mix; exports become one file with sound, the review video keeps silent + `.sound.mp4`; `--keep-silent`), `--out path`.
- Render settings can be saved per scene: `scenes/<name>/render.json` `{ "presets": [ { "id", "label", ...options } ] }`.

### 4a. Parallel capture
Capture is the bottleneck (software raster + PNG per frame, one page, one core). `gfx render` captures with N workers:
- `--workers N|auto` (env `GFX_WORKERS`; default `1` = today's bit-exact code path). `auto` = max(1, min(4, floor(cpus / 2),
  floor(freeMem / 600 MB), ceil(frames / 8))) (cap 4 from the benchmark, see "As built (§4a)").
- Each worker is its **own headless browser** (one shared Vite server). Separate browsers, not tabs: tabs of one
  browser share one GPU/raster process, which is the bottleneck.
- Frames are handed out from a shared counter (next index), so each worker's t only moves forward. A reorder buffer
  writes frames to ffmpeg / the PNG folder strictly in index order; a worker waits when it gets more than a window
  (~2×N frames) ahead of the writer, so memory stays bounded at 4K.
- Intended: same output bytes as `--workers 1`. As built: true for the test fixtures, but Chrome's raster depends on
  seek history, so the reel fixture frames differ by ±1 LSB (see As built §4a); hence default 1. Crop-track, alpha, fit/pad, all formats
  and `--audio` work unchanged. `progress frames` counts written frames.
- Startup: workers launch in parallel; a failure in any worker (page error that kills capture, browser crash) aborts
  the render with that error and closes all browsers (existing cleanups).
- Studio: no UI yet; to be wired with a "Fast" render mode (GPU raster + workers). Human log line shows `… fps (N workers)`.

### 4b. Fast mode (GPU) and a pinned browser
Measured at true 4K on the reel fixture (ms/frame, seek + screenshot): software (swiftshader) ~650–770; GPU Windows d3d11
~235 (PNG) / ~134 (JPEG); GPU WSL via Mesa d3d12 ~307. Encoding (x264 medium, 62 ms at 4K) runs alongside capture and
is not the limit. chrome-headless-shell is no faster than Chrome, but it can be pinned.
- `gfx render --mode fast|exact` (also `still`, `sheet`; env `GFX_MODE`; render.json preset key `mode`). CLI default
  **exact** (today's flags; tests, `cmp` checks and Claude's verification stay bit-exact). Fast = GPU raster flags per
  platform: Windows `--use-angle=d3d11`; Linux/WSL `--use-angle=gl` with `GALLIUM_DRIVER=d3d12` in the browser's env
  when `/dev/dxg` exists (WSL), else plain GL/Vulkan; macOS `--use-angle=metal`; plus `--ignore-gpu-blocklist
  --enable-gpu-rasterization`. Flags live in `browser.js` (`chromeFlags(mode)`), no other code picks GPU flags.
- After the page loads in fast mode, read the WebGL unmasked renderer. If it is SwiftShader / llvmpipe / "Basic Render",
  log a warning (`fast mode: no GPU available (<renderer>), rendering in software`) and continue. Report the renderer
  in the human output and as a `{type:'log', level:'info', msg:'renderer: …'}` progress event.
- `--frame-format png|jpeg` (intermediate screenshots; default png; render.json key `frame-format`). jpeg = quality 92,
  only for mp4/webm/gif output (error for png/prores/alpha formats). Intended for drafts.
- `--workers auto` in fast mode: tune from a benchmark of GPU + 1/2/3/4 workers (Windows d3d11 and WSL); if workers
  don't help with the GPU, auto = 1 in fast mode. Default workers stays 1 when `--workers` isn't given in exact mode;
  in fast mode the default is `auto`.
- Pinned browser: `gfx setup chrome [--force]` downloads a pinned chrome-headless-shell (Chrome for Testing, version
  constant in `browser.js`, platform win64/linux64/mac-x64/mac-arm64) into `<library-parent>/browsers/` (same parent as
  `gfx setup ffmpeg`'s `bin/`), via `fetchfile.js` + fflate unzip, with a progress JSON phase `download`. Discovery
  order: `GFX_CHROME` → pinned headless shell (if installed) → system Chrome → Edge. `gfx doctor` shows which browser
  and version is used and whether it's the pinned one. If headless shell can't use the GPU on a platform (seen in WSL),
  fast mode there prefers system Chrome; document what was found.
- Studio render dialog: **Fast / Exact** segmented switch (default Fast; saved with the dialog state and in "Save as
  scene preset"); when Fast and quality = Draft → `--frame-format jpeg`. Quick render (▸) uses Fast. Job rows show the
  renderer line ("GPU: NVIDIA GeForce RTX 2070 SUPER" or "software"). Setup card / doctor: "Install pinned browser"
  button runs `gfx setup chrome` like the ffmpeg button.

## 5. Live code reload
`gfx serve` watches the project's `scenes/`, `style/` (and engine `runner/` in dev). On change of a scene's files
(scene.js, its imports, scene.json, tweaks.json, sound.json, assets) the bridge for that scene **rebuilds the scene in
place** (re-import with cache-busting, re-run setup, re-apply file + live tweaks + view, seek to the current t) and
posts `{ type: 'reloaded', reason, files }` (or `{ type: 'error', message, stack }` on a failing build — keep the old
scene displayed, show the error overlay text). No full page reload; keyboard focus and the studio state stay. Vite
HMR must not reload the bridge page on its own (handle `vite:beforeFullReload` / disable HMR for scene modules and use
our own message). The studio refreshes tree/spans/paths/values after `reloaded`, shows a toast "Scene reloaded
(scene.js)" and keeps selection when the key still exists.

## 6. Studio (app)
- **Projects home** (when no project is open or via the project menu): recent projects (name, path, scene count,
  last opened, thumbnail = first scene sheet/still if present), **New project** (template picker → folder picker →
  runs `gfx init`), **Open folder**, and a **Setup** card when `gfx doctor` reports missing pieces (download ffmpeg,
  pick a browser). The current "root" becomes "project"; WSL roots (\\wsl.localhost\...) keep working through
  `wsl.exe` (dev setup), native folders use the bundled engine.
- **Engine runner** (Rust): `engine_run(args, project)` spawns the engine CLI (native: `<engine>/node/node.exe
  <engine>/runner/cli.js ...` with `GFX_PROJECT`; WSL root: `wsl.exe -d <distro> --cd <linux path> -- bash -lc "node
  runner/cli.js ..."`), streams `--progress json` lines to the webview as Tauri events (`engine://<jobId>`), supports
  cancel (kill the process tree), returns exit code. `gfx serve` uses the same path (replaces the current
  start_server spawn). Dev shim: same API over the Vite middleware with child_process.
- **Scenes list** becomes all scenes of the project (from `scenes/*/scene.json`), not only those with renders; a scene
  without renders opens in Live mode directly (no video/stems yet) with a "Render" call to action.
- **Render dialog** (`Ctrl+R` / Render button): preset dropdown + custom size / scale, fps, range (whole / loop region
  / custom), format + quality, alpha, audio, crop (static crop drawn on the picture with handles; animated crop =
  keys added at the playhead), output path; Add to queue / Render now. **Queue panel**: jobs with progress bar,
  phase, ETA, cancel, reveal in Explorer, open; finished renders appear in the scene's "Renders" list (from `out/`).
  Default "Render" for a scene = video + audio (mp4 + `gfx audio`) so the review view updates.

## As built (§1-3)
- Code: `runner/lib/paths.js` (engine/project/library/bin resolution), `runner/lib/project-vite.js` (Vite plugin:
  `/runner/*` → engine, `/style/*` project-then-engine, bare imports → engine node_modules), `browser.js`, `ffmpeg.js`
  (discovery, single spawn helper, `setupFfmpeg`), `fetchfile.js` (streamed download + fflate unzip with zip-slip
  guard). The CLI is split into `runner/lib/cli/` (`args.js` option table — §4 options go there and into
  `commands/capture.js#cmdRender`; `progress.js`; `capture.js`; `commands/{scene,capture,audio,review,lib,project}.js`).
- Deviation: for projects outside the engine Vite's dep optimizer is **disabled** (`noDiscovery`, empty include):
  `optimizeDeps.include` resolves from the root (the project has no node_modules). three/animejs are served as plain
  ESM from `/@fs/<engine>/node_modules/...`; no late discovery can reload a page. Engine == project keeps the old
  optimizer config, so the repo's captures are byte-identical (verified with cmp on the reel fixture, the promo fixture, _review-test).
- Library order: `GFX_LIBRARY` > `<engine>/library` if it exists > platform default (the back-compat folder wins over
  the platform default so this repo keeps its library). Relative library paths are relative to the library's parent,
  so `library/kenney/...` is portable between this repo and `%APPDATA%\gfx\library`. `gfx lib fetch` registers the
  `kenney` / `freesound-cc0` source in a fresh library. Project sources (gfx.json) are listed, not editable via `lib enable`.
- `gfx init` writes the machine-local CLI command (`node "<engine>/runner/cli.js"`) into the project's CLAUDE.md;
  templates `blank` and `reel` (no `promo` yet). Engine version bumped to 0.2.0 (`gfx.json` `engine: ">=0.2"`).
- `--progress json`: accepted by every command (non-JSON console output becomes `log` lines; console.error lines are
  level `error` only when they look like failures). Render phases `frames` then `encode`; audio reports `audio` 0..4.
- Ping: `/__gfx/ping` returns `{ ok, root: <project, native path>, engine }`.
- Windows verification (WSL interop, real `node.exe` v24.22.0 win-x64, engine copy at
  `C:\Users\<you>\dev\gfx-engine-test` with `npm ci --omit=dev --os=win32 --cpu=x64` run from WSL; project
  `C:\Users\<you>\dev\gfx-projects\win-test` from `gfx init --template reel`): `doctor` (Chrome found; ffmpeg missing →
  exit 1), `still`, `setup ffmpeg --progress json` (BtbN zip, 200 MB, → `%APPDATA%\gfx\bin`), `render --dur 1`,
  `audio` (same LUFS as Linux, muxed), `serve` (ping, bridge.html, scene.js with `/@fs/C:/...` engine imports),
  `lib fetch kenney --packs impact` (fflate), `lib index kenney` (CLAP download + onnxruntime-node win32), `lib search`.
  win32 node_modules ≈ 817 MB, of which onnxruntime-node 548 MB (ships darwin/linux/win32 binaries) and
  onnxruntime-web 140 MB — prune non-win32 onnxruntime folders when packaging.

## As built (§4)
- Code: `runner/lib/render-plan.js` (pure: option parsing/validation, render.json presets, crop-track interpolation, ffmpeg
  filter/encode args; unit-tested without a browser), `commands/capture.js#cmdRender` (capture loop), `capture.js#openCapture/shotScaled`.
  Player: `?size=WxH` overrides scene.json width/height (reframe), `?alpha=1` makes root/body/html transparent (capture only).
- Size: `--size` / `--scale` / `--preset` are mutually exclusive; with none, output = source window x 1. Non-crop captures use
  `deviceScaleFactor = dest/source` plus a screenshot `clip`, so the browser rasterises at output resolution (thin lines stay sharp).
  Default `--fit cover` centre-crops a mismatching aspect (window shrunk to the output aspect); `contain` letterboxes in the ffmpeg
  filter chain (`pad`), default pad `#000000` (`transparent` with alpha).
- Crop method: static crop and cover = screenshot `clip` + DSF (no resampling, no extra pass). Animated `--crop-track` = per-frame
  `clip` with `scale` sent through CDP directly (puppeteer drops `clip.scale` when `captureBeyondViewport` is false), viewport DSF stays
  1 so nothing relayouts; Chrome rounds fractional windows to 1-2 px so the frames get a final bicubic `scale=W:H` in the same ffmpeg
  pass (negligible softening, constant output size). Chosen over a canvas/ffmpeg `crop` filter because zoomed windows stay vector-sharp and
  no full-size frame is encoded/decoded. Track: eased keys (`ease` on a key shapes the segment to the next; names from `runner/lib/ease.js`),
  times are scene seconds, before/after the first/last key it holds, h is derived from w and the output aspect (keys must match it within 2%),
  window is clamped into the scene. `--crop-track` may also be an inline object in render.json. Relative track paths resolve against the scene folder, then cwd.
- Formats: `prores` = ProRes 422 HQ (`prores_ks` profile 3, yuv422p10le, `.mov`); `mov-alpha` = ProRes 4444 (profile 4, yuva444p10le, `.mov`);
  `prores --alpha` is the same as `mov-alpha`; `webm-alpha` = VP9 yuva420p `-auto-alt-ref 0` (ffprobe shows yuv420p + `alpha_mode=1` tag
  with the native decoder). `*-alpha` formats imply `--alpha`; `--alpha` with mp4/webm/gif is an error; png needs `--alpha` to be transparent.
  Alpha = `omitBackground` screenshots + transparent root/body/html: anything the scene paints itself (full-frame backgrounds) stays opaque.
  `--crf`/`--quality` only for mp4/webm/webm-alpha (error otherwise); quality maps to crf 28/18/12 for every codec (vp9 default stays 30);
  `--crf` wins over `--quality`. `--codec h265` = libx265 `-tag:v hvc1`, mp4 only. `--audio` still needs mp4 (h264 or h265).
- `--reframe WxH`: error unless `"responsive": true`; combines with `--scale/--size/--crop`. Fixture: `scenes/_responsive-test`.
- Presets: built-ins `720p 1080p 4k reel reel-4k square portrait`. `scenes/<name>/render.json` `{ "presets": [ { "id", "label", ...flag names } ] }`
  (kebab or camelCase, e.g. `cropTrack`); `--render-preset id` applies it under the CLI flags (a CLI size flag replaces the preset's whole
  size group, a CLI crop flag its crop group). `gfx render --list-presets [<scene>] [--json]` -> `{ builtin, scene }` (scene entries carry the
  preset options under `options`, kebab-cased).
- Progress: `frames` (0..N), `encode` (ffmpeg's own `-progress` frame counter, so it trails `frames` and ends N/N; PNG sequences emit it too),
  `audio` 0..4 after `--audio`; eta on frames/encode. `done.outputs` = [video, (muxed video)]. The old test expectation of encode `1/1` was updated.
- Timing (the reel fixture, 1 s @60 fps = 60 frames, WSL swiftshader): 1080x1920 13.6 s; `--preset reel-4k` (2160x3840) 85.7 s. Capture-bound (Chrome
  raster + PNG encode ~1.4 s/frame at 4K); ffmpeg is not the limit (png-only 4K was as slow as mp4).
- Test fixtures: `scenes/_render-test` (+ render.json), `scenes/_responsive-test`; `node tests/render.test.mjs`.

## As built (§4a)
- Code: `commands/capture.js#resolveWorkers` + the capture loop in `cmdRender` (shared `next` counter, reorder `pending` map, `flush()` writes
  strictly in index order to ffmpeg stdin with drain handling, or to `frame-NNNNN.png`; a worker waits while `i - written >= max(2, 2N)`; first
  error sets `failure`, wakes everybody and is rethrown); `capture.js#openCapture` returns `openWorker()` (new headless browser + page, same
  viewport/DSF/alpha/query, same Vite server). `--workers` is also a render.json preset key; invalid values (0, -1, abc, 1.5) = render error;
  N is clamped to the frame count. Human line: `frame i/N  x fps (K workers)` (only when K > 1). `--workers 1` output is byte-identical to the
  pre-§4a code (framemd5 of the reel fixture 4-7 s: 0 of 180 frames differ).
- Benchmark (the reel fixture, `--from 4 --dur 3` = 180 frames, WSL, 10 threads, swiftshader, mp4; wall incl. ~5 s startup):

  | size | workers | wall s | s/frame | speedup |
  |---|---|---|---|---|
  | 2x (2160x3840) | 1 (old code) | 153.0 | 0.85 | 1.00 |
  | | 2 | 121.6 | 0.68 | 1.26 |
  | | 4 | 112.7 | 0.63 | 1.36 |
  | | 6 | 114.8 | 0.64 | 1.33 |
  | | 8 | 119.2 | 0.66 | 1.28 |
  | 1x (1080x1920) | 1 | 52.0 (old code 49.8) | 0.29 | 1.00 |
  | | 2 | 38.8 | 0.22 | 1.34 |
  | | 4 | 38.2 | 0.21 | 1.36 |
  | | 6 | 38.3 | 0.21 | 1.36 |
  | | 8 | 40.0 | 0.22 | 1.30 |
  | | auto (formula then: 5) | 37.4 | 0.21 | 1.39 |

  Scaling is far below N: four independent `gfx render` processes at once each ran 2.3x slower (29 s vs 12.7 s for 60 frames), i.e. this
  machine gives ~1.75x total throughput from parallel Chrome instances (SwiftShader already uses several threads per browser, WSL2/SMT cores).
  Hence the auto cap of 4 (no gain beyond 2-4, more RAM). The real speed-up has to come from GPU raster (plan item 2) / cheaper transfer.
- Determinism caveat: on the synthetic fixtures (`_render-test`, also crop-track) `--workers N` is byte-identical to `--workers 1`
  (tested, every PNG frame / framemd5). On the reel fixture it is **not** bit-exact: ~85-97 % of frames differ by +-1 LSB in a few thousand samples
  (PSNR vs serial 55 dB avg, min 48.6 dB; visually identical). Cause: Chrome's compositor/raster output depends on the page's earlier
  frames (layer/tile reuse, first-visit vs revisit raster of blur/3D-transform layers); the same page given the same seek sequence is
  reproducible, but a worker that jumps by N frames has a different history than a serial render. Not fixed by `--disable-partial-raster`,
  `--disable-gpu`, `--disable-gpu-rasterization`, `--disable-gpu-compositing`. Even serial renders very occasionally differ (seen once on a cold
  first run). Use `--workers 1` for bit-exact finals.

## As built (§6 render dialog + queue)
- Code: `apps/studio/web/src/render.js` (+ `render.css`). A drawer replaces the side panel (`#render`, tabs **Setup / Queue / Renders**) so the
  crop window can be drawn on the picture while the dialog is open. Topbar: `Render` (Ctrl+R toggles; Shift+click = quick render), `▸` = quick
  render (`render <scene> --audio` -> `out/<scene>/<scene>.mp4` + `.sound.mp4`, the review view reloads when it finishes), a `Rendering n%` chip.
- Options -> flags in `buildArgs()`: `--preset id | --size WxH | --scale k`, `--fps`, `--from/--to` (whole / loop region / custom), `--format`,
  `--codec` (mp4), `--quality` (mp4/webm), `--alpha` (png/prores/*-alpha only; forced on for the alpha formats), `--audio` (mp4 only),
  `--crop x,y,w,h` (static window, aspect locked to the output aspect, corner handles) or `--crop-track out/<scene>/review/crop-<id>.json`
  (animated: "Add key at playhead", the window follows the keys at the playhead; one key = static), `--fit contain --pad` when the aspect
  differs without a crop, `--out`. Default output `out/<scene>/<scene>[-WxH][-crop][-quality][-codec][-from-to].<ext>` (PNG: `frames[-...]`), so only a plain
  scene-size mp4 render replaces the review video.
- Presets: `gfx render --list-presets --json <scene>` (`{builtin, scene}`); fallback = the §4 built-ins + `scenes/<scene>/render.json`. "Save as scene
  preset" writes `{id,label,size,fps,format,codec,quality,alpha,audio,crop}` into `render.json` (Rust/shim `write_project_text`, only that path).
  Selecting a scene preset expands its options into the form.
- Queue (finding 17): **Add to queue only queues**; the Queue tab's **Start queue / Pause queue** switch (session-only) lets queued items run in turn (items added while running join the line). Pause lets the running item finish and starts no further queued one. Render now, quick render and Retry start at once (`j.now`), ahead of the waiting items. Jobs run one at a time (`engineRun`, `--progress json`: phase, done/total, ETA, overall bar frames .85 / encode .05 / audio .10), cancel
  (queued or running; a canceled running job is marked "partial file may remain": no delete op exists), retry, reveal / open (`reveal_path`,
  `open_path`), errors show the message + the last log lines. History per project in `localStorage` (`gfx-studio.renderq.v1.<root>`, 40 jobs,
  jobs that were queued/running when the studio closed come back as failed "interrupted"). Renders tab = `list_renders` (out/<scene>/ by mtime).
- Not done: `--reframe`, `--crf` (only the quality presets), loading a `crop-track` of a scene preset into the key editor.
- Fast / Exact (§4b, studio side): Setup tab "Speed" segmented switch (default Fast; persisted in the saved dialog state and as `mode` in
  "Save as scene preset", loaded back from scene presets). `buildArgs()` always passes `--mode fast|exact`; Fast + Draft on mp4/webm/gif adds
  `--frame-format jpeg`. Quick render (button / Shift+click) = `render <scene> --audio --mode fast`. Queue rows show the engine's
  `renderer: <name>` log line ("GPU · <name>" or "software · <name>") and any warn-level log (e.g. the no-GPU fallback) in amber.
  Setup card (Projects home): browser row gets an "Install pinned browser" button (`gfx setup chrome` via the same engineRun path as ffmpeg,
  with progress); doctor `browser.pinned` / `browser.version` are read defensively when present.

## As built (§4b)
- Code: `browser.js` (`resolveMode`, `chromeFlags(mode, platform)`, `browserEnv(mode)`, `pickBrowser` pure discovery, `findBrowser({mode})`, `pinnedPath`,
  `setupChrome`, `browserVersion`, `isSoftwareRenderer`), `cli/capture.js` (`launchBrowser({mode})`, `openCapture({mode})` reads the WebGL renderer in fast
  mode, `shot`/`shotScaled` jpeg), `render-plan.js` (`mode`, `frame-format` validation; `imageInputArgs` uses `-c:v mjpeg` for jpeg), `commands/capture.js`
  (`resolveWorkers(spec, total, mode)`), `commands/project.js` (`gfx setup chrome`, doctor). `launchBrowser()` without a mode (audio synth etc.) stays exact.
- Flags: exact = unchanged (`--use-angle=swiftshader`...). Fast = `--enable-unsafe-swiftshader` (kept as the software fallback so WebGL still works
  without a GPU) + `--hide-scrollbars --force-color-profile=srgb --no-sandbox --disable-dev-shm-usage --ignore-gpu-blocklist --enable-gpu-rasterization` +
  win32 `--use-angle=d3d11` / darwin `--use-angle=metal` / linux `--use-angle=gl`; on WSL (`/dev/dxg`) the browser env gets `GALLIUM_DRIVER=d3d12`
  (unless already set). Renderer line: `renderer: ANGLE (...)` (stdout / progress `log` info); software fallback adds
  `warn: fast mode: no GPU available (<renderer>), rendering in software`. Only fast mode reads the renderer (exact opens no extra canvas).
- Mode sources: `--mode`, render.json `mode`, env `GFX_MODE`, default exact. `--frame-format` / render.json `frame-format`; jpeg (quality 92) only for
  mp4/webm/gif, error for png/prores/mov-alpha/webm-alpha/`--alpha`. Works with `--crop-track` (CDP `format: jpeg`).
- Pinned browser: Chrome for Testing 155.0.8059.79 chrome-headless-shell (`CHROME_VERSION`), `gfx setup chrome [--force]` ->
  `<library-parent>/browsers/chrome-headless-shell/<plat>-<ver>/chrome-headless-shell-<plat>/...` (`GFX_CHROME_URL` overrides the URL, used by tests; the
  zip is unpacked whole, +x on unix). Discovery: `GFX_CHROME` -> pinned (installed) -> system Chrome -> Edge; fast on WSL: system Chrome/Edge first, shell
  last. Installing the shell therefore changes the default browser for exact mode too (different Chrome version than system Chrome -> pixels can differ
  from earlier renders; set `GFX_CHROME` to pin the old one). `gfx doctor`: `browser.{pinned,version}`, `pinnedBrowser.{path,version,installed,supported,fastPrefersSystem}`;
  the version is not queried on Windows (`chrome.exe --version` opens a window) -> null for system Chrome there.
- Headless shell in WSL: with `GALLIUM_DRIVER=d3d12` and `--use-angle=gl` (also `gl-egl`, `--use-gl=angle`, `--disable-gpu-sandbox`, `--use-gl=egl`) the shell
  gets **no WebGL context at all** (libEGL "failed to get driver name for fd -1": its bundled ANGLE/libEGL cannot use the system Mesa); with
  `--enable-unsafe-swiftshader` it falls back to SwiftShader, `--use-angle=vulkan` gives llvmpipe. System Chrome 146 with the same flags gets
  "D3D12 (NVIDIA GeForce RTX 2070 SUPER)". So fast mode on WSL uses system Chrome. On Windows the shell reaches d3d11 normally (verified after a real
  `gfx setup chrome` on win64, 125 MB in ~6 s).
- Benchmark: the reel fixture `--from 4 --dur 3 --scale 2` (180 frames, 2160x3840, mp4 x264 crf 18, wall incl. startup and encode, RTX 2070 SUPER, 10 threads).

  | platform / mode | frame format | workers | wall s | s/frame | speedup vs exact w1 |
  |---|---|---|---|---|---|
  | WSL exact | png | 1 | 165.3 | 0.92 | 1.0 |
  | WSL fast (Mesa d3d12) | png | 1 / 2 / 3 / 4 / 5 / 6 | 47.5 / 28.7 / 24.0 / 20.9 / 19.9 / 19.0 | 0.26 / 0.16 / 0.13 / 0.12 / 0.11 / 0.11 | 3.5 / 5.8 / 6.9 / 7.9 / 8.3 / 8.7 |
  | WSL fast | jpeg | 1 / 2 / 3 / 4 / 6 | 30.0 / 17.9 / 17.0 / 18.0 / 18.8 | 0.17 / 0.10 / 0.09 / 0.10 / 0.10 | 5.5 / 9.3 / 9.7 / 9.2 / 8.8 |
  | Windows exact | png | 1 | 137.9 | 0.77 | 1.0 |
  | Windows fast (d3d11) | png | 1 / 2 / 3 / 4 / 6 | 38.1 / 24.8 / 18.9 / 16.1 / 16.7 | 0.21 / 0.14 / 0.11 / 0.09 / 0.09 | 3.6 / 5.6 / 7.3 / 8.5 / 8.3 |
  | Windows fast | jpeg | 1 / 2 / 3 / 4 | 24.3 / 14.4 / 13.5 / 12.8 | 0.13 / 0.08 / 0.07 / 0.07 | 5.7 / 9.6 / 10.2 / 10.7 |

  With a GPU, workers still help up to 3-4 (GPU raster process is shared less than SwiftShader's CPU threads), then flatten (5-6 no gain; WSL jpeg is flat from 2).
  Fast `auto` therefore uses the same formula as exact (`max(1, min(4, floor(cpus/2), floor(freeMem/600 MB), ceil(frames/8)))`); only the default
  differs (fast: `auto`, exact: `1`; explicit `--workers` / `GFX_WORKERS` always win).
- Exact mode unchanged: `gfx still the reel fixture --t 7.61` decoded RGBA md5 identical before and after (`b7595b77...`), same system Chrome.
- Tests: `tests/render.test.mjs` "fast mode / frame format" (plan validation, flags per platform, discovery order with fake paths, jpeg mp4/gif/crop-track,
  fast render + renderer log event, render.json preset `fastdraft` with `mode`/`frame-format`), `tests/project.test.mjs` "setup chrome" (local HTTP server serving
  a fake zip via `GFX_CHROME_URL`, temp `GFX_LIBRARY`, doctor shows the pinned browser).

## Note (2026-10-16): Engine folder
The engine location is now `GFX_ENGINE` > the machine setting **Engine folder** (`engineDir`, Settings → Engine & tools,
or "Choose engine folder…" in the welcome window) > `engine/` next to the exe. The folder must contain `runner/cli.js`.
A WSL engine folder (`\\wsl.localhost\<distro>\…`) runs every engine command through `wsl.exe … bash -lc "node …"`
(no-project commands with cwd = the engine; native projects with cwd `/mnt/<drive>/…`), so a dev build can use the repo
in WSL as its engine. Details and limits: docs/HOME-SETTINGS.md "As built" → Engine folder; API.md → Engine runner.

## Note (2026-10-16): WSL projects outside the engine, `.gfx/engine.json`
- A WSL project (`\\wsl.localhost\<distro>\…`) used to run `node runner/cli.js` inside the project, i.e. it only worked
  when the project was itself the engine (docs/JOURNEYS.md finding 4). Now it runs the located engine (GFX_ENGINE >
  Engine folder > next to the exe) by its Linux path with cwd + `GFX_PROJECT` = the project's Linux path; a project that
  is an engine checkout (this repo) still runs its own `cli.js`. The engine must be a WSL engine in the same distro: a
  Windows engine can't serve a `\\wsl.localhost` project (tried: `node.exe` + `GFX_PROJECT=\\wsl.localhost\…` runs
  `gfx context`, but `gfx still` fails because Vite answers 404 for `scenes/<name>/scene.json` under the UNC root), and
  another distro can't see the project; both are refused with a message naming the fix. Live (`start_server`), every
  `engine_run` and the terminal (`<engine>/bin` on PATH, `GFX_ENGINE`) use the same engine. API.md → Engine runner.
- **`.gfx/engine.json`** (machine-local; `.gfx/` is gitignored): `{ engine, bin, node, wsl?, updated }` = the engine as the
  project's own shell sees it, so Claude in a shell without `gfx` on PATH (a T3 thread) runs the right engine instead of
  searching the disk (finding 2). Written by `gfx init` and `gfx init --refresh` (the engine's own path, `node` =
  `process.execPath`; `wsl` = `WSL_DISTRO_NAME` when the project is on a Windows drive) and by gfx studio when a project
  opens (Rust; kept when it already names the same engine). Both append `.gfx/` to `.gitignore` when no line covers it
  (nothing else is rewritten); `gfx init` now writes `.gfx/` instead of `.gfx/index/`. The managed CLAUDE.md block says:
  `gfx` if on PATH, else `.gfx/engine.json`'s `bin` or `"<node>" "<engine>/runner/cli.js"` (`wsl.exe -d <wsl> --` from a
  Windows shell), never search the disk. On open, the studio compares the project's block with the engine's template and,
  when it differs, runs `gfx init --refresh --no-skills` (new flag: block + engine.json only, project skills untouched).
  (Superseded for skills by "Managed skills" below.)
- `runner/cli.js` waits for stdout/stderr to drain before `process.exit`: piped output (the studio, tests) was cut at
  ~80 KB, which made `gfx version log --json` unparsable for this repo's history (Versions panel empty).
- Verified (2026-10-16): spike exe (Engine folder = the dev engine checkout in WSL) opened `\\wsl.localhost\Ubuntu\tmp\gfx-wsl-fixture`
  (`gfx init --template reel`, made "old": no engine.json, `.gitignore` without `.gfx/`, the old PATH claim in the block,
  a user note, a deleted skill): `engine_run` context / `version status --json` / `still reel --t 1` exit 0 (still-1.png
  written), Live answered with ping root `/tmp/gfx-wsl-fixture` and `scenes/reel/scene.json` 200; afterwards
  `.gfx/engine.json` named the the dev engine checkout engine, `.gitignore` had `.gfx/` appended after the user's lines, the block
  was refreshed, the user note and the missing skill were left as they were. The generated command line also ran
  `gfx context hello-gfx` for test-project-1 (read-only).

## As built (2026-10-16): managed skills, contract path (docs/JOURNEYS.md findings 21, 22)
- **Managed skill copies** (`runner/lib/skills.js`). `gfx init` copies the engine's `.claude/skills/` via the sync and
  writes `.gfx/skills.json` = `{ version: 1, engine: { version, commit }, engineHash, updated, files: { <rel>: { sha256,
  engine } }, last }` (`sha256` = the installed content, `engine` = `<version>+<commit>` of that install, `engineHash` =
  sha256 over `"<rel>\n<sha256>\n"` of every engine skill file in byte order, `last` = the last sync's report).
  `gfx init --refresh` syncs (`--no-skills` skips it; `--json` prints `{ project, claudeMd, engineJson, skills }`). Rules:
  project file = engine file → in sync; = recorded hash → untouched, replaced; missing → (re)added; recorded but edited →
  kept, engine version written to `.gfx/skills-new/<rel>` (cleared and rewritten on every sync; "kept your edits: …");
  recorded file the engine dropped → removed if untouched (empty folders too), else kept; files never recorded that the
  engine doesn't have = the user's own, never touched. `gfx init --existing`: skill files the folder already had are
  kept like edits.
- **Legacy projects** (no `skills.json`, made before this): a copy whose git blob id equals any version of that path in
  the engine's history (`git log --raw -- .claude/skills`, only when the engine is a git checkout) counts as untouched and
  is updated; any other content is copied to `.gfx/skills-backup/<UTC stamp>/<rel>` and then replaced (reported:
  "replaced (no install record, content unknown): …; previous copies in …"). Chosen over "keep unknown copies" because
  that would leave every pre-record project stale forever, and over asking because the studio sync runs unattended; the
  backup makes it non-destructive. An installed engine (no git) backs up every differing legacy copy.
- **Studio** (`project_opened`, background thread as before): `skills_outdated` (Rust, `skills_hash` = the same hash)
  compares the engine's skills with `engineHash`; a missing record counts as outdated. Skills outdated → `gfx init
  --refresh`; only the block outdated → `gfx init --refresh --no-skills`; neither → nothing (`refresh_args`).
- **Contract path**: skills and the managed CLAUDE.md block name `<engine>/docs/CONTRACT.md` with `<engine>` from
  `.gfx/engine.json` (no copy in projects; the packaged engine must include `docs/CONTRACT.md`).
- Verified: tests/project.test.mjs (init record, update/keep/add/remove, merge clears skills-new, --no-skills, legacy
  history match + backup, --existing), Rust `engine_records` (hash equals node's on a fixture, outdated/args), a /tmp copy
  of test-project-1 (6 differing SKILL.md, all equal to engine history blobs → updated, no backup). Not run in the real exe.

## Note (2026-10-16)
The Projects home and its Setup card are replaced by the welcome window (docs/HOME-SETTINGS.md §1); the doctor / setup
logic lives in `web/src/tools.js`.

## As built (2026-10-16): workflow line, looks in the managed block (docs/LOOKS.md)
- The managed CLAUDE.md block is now rendered (`claudeTemplate` / `writeManagedBlock` in
  `runner/lib/cli/commands/project.js`): `templates/projects/_shared/CLAUDE.md` has `{{workflow}}` and `{{look}}`
  placeholders next to the contract-path line. `gfx init`, `gfx init --refresh` and every `gfx look use|update` rewrite it.
- Workflow (`runner/lib/workflow.js`): project gfx.json `"settings".workflow` → else the machine default → else quick.
  The machine default comes from `--workflow quick|full|<json>` (init / `--refresh`; gfx studio passes its setting, e.g.
  `gfx init --refresh --no-skills --workflow quick` when the setting changes) and is remembered in `.gfx/workflow.json`
  `{ machine }` (machine-local, gitignored) so refreshes without the flag (studio on open, `gfx look use`) keep it. An
  invalid project value warns on stderr and falls back; an invalid `--workflow` fails before anything is written.
  `--refresh --json` also prints `workflow: { profile, verify, render, sound, source }`.
- Look line when gfx.json `look` is a valid slug with `looks/<id>/LOOK.md` present (name from its frontmatter, made
  single-line and marker-free). Engine-side looks: `runner/lib/looks.js` + `runner/lib/cli/commands/look.js`, CLI in
  CONTRACT.md "Engine and projects".
