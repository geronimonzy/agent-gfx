# agent-gfx — guide for coding agents (Claude Code, Codex, pi, …)

This repo is the **engine** (deterministic scene runner + CLI + skills) and **gfx studio** (a Tauri v2 Windows app to
review, edit and render scenes with an agent). It is also a gfx project itself (`gfx.json` at the root), holding the
test fixtures in `scenes/`. Humans: see [CONTRIBUTING.md](CONTRIBUTING.md). Making scenes (not changing gfx): the
skills in `.claude/skills/` (entry: `motion-graphics`) are the instructions.

## Layout
```
runner/cli.js                 thin entry → runner/lib/cli/{args,capture,progress,util}.js + commands/*.js
runner/lib/                   sfx.js (Web Audio synth + sample cues), vox-features.js (CLAP/features), library/*,
                              paths.js (engine/project/library resolution), project-vite.js, reload.js (live reload),
                              ping.js, browser.js, ffmpeg.js, fetchfile.js, render-plan.js, review.js (comments/apply),
                              version.js (git), looks.js + look-analyze.js (looks)
runner/player/                core.js (buildScene, render chain), elements.js (registry, pick, tweaks, values, tree),
                              bridge.js/.html (studio ↔ scene postMessage), code.js (provenance), player.js, changes.js
bin/gfx, bin/gfx.cmd          launchers (bundled node if <engine>/node exists)
style/presets, style/fonts    built-in presets (dark-grid, nightfall) + OFL fonts
templates/<kind>              scene templates; templates/projects/* = `gfx init` templates; templates/looks/* = starter looks
.claude/skills/               motion-graphics (entry), sound-design, look-design, animejs, svg, canvas2d, threejs
scenes/                       test fixtures: _reel-test (main fixture, 9:16, 15 s, 72 cues, ~60 named elements),
                              _review-test / _render-test / _responsive-test / _retime-test
apps/studio/src-tauri/        Rust: lib.rs (fs ops + guards, gfxlib:// scheme, engine jobs, live server), claude.rs
                              (PTY, settings), t3.rs (T3 Code link), engines.rs, library.rs; API.md = op list
apps/studio/web/src/          plain JS modules (no framework): main, store, api, live, layers, timeline, inspector,
                              comments, render, welcome, terminal, settings, code, versions, library, soundindex, …
apps/studio/scripts/          build-win.sh (dev exe), build-installer.sh (installers)
library/                      sound library (gitignored except sources.json)
out/                          renders / review / test artifacts (gitignored)
```
Specs (authoritative, each has "As built" notes): `docs/CONTRACT.md` (scene contract + CLI), `docs/STUDIO.md`,
`docs/FOUNDATION.md`, `docs/REVIEW.md`, `docs/LOOKS.md`, `docs/LOOK-PIPELINE.md`, `docs/SOUND-LIBRARY.md`,
`docs/CODE-VERSIONS.md`, `docs/LAYOUT.md`, `docs/KEYS.md`, `docs/INSTALL.md`. A new feature starts as a spec doc.

## Commands
- `gfx <cmd>` (or `node runner/cli.js <cmd>`): new, dev, still, sheet, render, export, audio, lib, look, serve, review,
  apply, init, doctor, setup ffmpeg|chrome, context, version. `gfx <cmd> --help`; `--progress json` on long commands.
- Engine tests (each starts its own Vite / Chrome): `node tests/<name>.test.mjs` for review, reload, project, looks,
  render, code, version, retime, templates, vdiff, soundtweak, soundlib. Run the ones your change touches.
- Studio unit tests: `node apps/studio/web/src/<name>.test.js` (source-guard, check-tokens, library-core, …) and
  `node apps/studio/web/wsl-shim.test.js`.
- Studio in a browser: `npm run studio:dev` (dev shim on port 5177). Browser E2E checks live outside the repo for now.
- Rust tests: `cargo test --lib` in `apps/studio/src-tauri` (on Windows).

## Rules that bite
- Scenes: `render(t)` is a pure function of t (no Date / rAF / unseeded random / CSS transitions). anime.js: prime in
  setup (`tl.seek(tl.duration); tl.seek(0)`), reset-then-seek in render (`tl.seek(0); tl.seek(t*1000)`).
- Name important elements (`data-gfx` / `ctx.el`): the studio's select / layers / paths / code links depend on it.
- Renders must stay byte-identical across refactors: compare `gfx still _reel-test --t 7.61` before and after by
  decoded pixels (`ffmpeg -v error -i x.png -f rawvideo -pix_fmt rgba -f md5 -`), same browser build, `--mode exact`.
  `--mode fast` (GPU) and `--workers` > 1 are ±1 LSB off by design.
- Vite servers use separate dep caches (`.vite-gfx`, `.vite-gfx-serve`, `.vite-studio`); sharing one breaks Live.
- User tweaks are override layers, not code edits: `sound.json`, `tweaks.json`, `render.json`; drafts live in
  `out/<scene>/review/`. `gfx apply` folds drafts into scene files (saves a version first).
- Studio code: **never `confirm()`, use `await api.ask(...)`** (in the app Tauri's `confirm` is async and always
  truthy). Design tokens only in CSS (`check-tokens.test.js`). No layout shift after a click.
- The engine repo shows Versions read-only; `gfx version` refuses to commit here without `--allow-engine`.
- Windows can't follow WSL symlinks over `\\wsl.localhost`: anything the app reads from a distro uses real paths. WSL
  commands go through `wsl.exe --exec bash -lc`.
- The studio's content security policy is in `apps/studio/src-tauri/tauri.conf.json`: new origins or schemes need an
  entry there.
