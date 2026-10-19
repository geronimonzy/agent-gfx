# {{name}} — gfx motion-graphics project

<!-- gfx:begin -->
<!-- Managed by gfx (`gfx init --refresh` rewrites everything between the gfx:begin / gfx:end markers). Put your own notes outside this block. -->
This folder is a **gfx project**: deterministic motion graphics (anime.js, three.js, Canvas 2D, SVG) rendered to video
by the gfx engine. The engine (runner, player, built-in style presets, node_modules) is NOT in this folder.

- Workflow: start with the `motion-graphics` skill (`.claude/skills/`); it routes to `animejs`, `threejs`,
  `canvas2d`, `svg` and `sound-design`. The skills are managed copies of the engine's: `gfx init --refresh` (gfx
  studio runs it on open) updates the files you haven't edited; edited files are kept and the engine's newer version is
  written to `.gfx/skills-new/<path>` for you to merge (record: `.gfx/skills.json`).
- {{workflow}}
{{look}}- Scene contract (ctx API, CLI flags, presets, audio): `<engine>/docs/CONTRACT.md`, with `<engine>` from
  `.gfx/engine.json` (if it has `wsl` and your shell is on Windows: `\\wsl.localhost\<wsl><engine>`). The skills call
  it "the contract"; this project has no `docs/` of its own.
- CLI: run `gfx <command>` from this folder or any subfolder (it finds the nearest `gfx.json`; `--project <dir>` /
  `GFX_PROJECT` override it). If `gfx` is not on PATH (e.g. a T3 thread), read `.gfx/engine.json` (this machine's
  engine, written by `gfx init` and gfx studio) and run its `bin`, or `"<node>" "<engine>/runner/cli.js" <command>`.
  If it has `wsl` and your shell is on Windows, prefix `wsl.exe -d <wsl> --`. Never search the disk for an engine: if
  `.gfx/engine.json` is missing, open the project once in gfx studio or ask the user for the engine folder.
- Brief for a request from gfx studio: `gfx context <scene> [--t s] [--el key] [--comment id] [--tweaks]` prints the
  moment, selected elements, pending tweaks and comments (with markup image paths). Read the markup PNGs first.
- Review loop: `gfx review <scene>` lists open comments; fix in code, verify with `gfx still` / `gfx sheet`, then
  `gfx review <scene> --resolve <id> --reply "what changed"`.
- Layout: `scenes/<name>/` (scene.json, scene.js, BRIEF.md + refs/ from gfx studio, STORYBOARD.md, SOUND.md,
  sound.json, tweaks.json, assets), `looks/<id>/` (pinned looks: LOOK.md, preset.js, sounds.json, refs/),
  `style/presets/*.js` (project presets; same name as a built-in preset = override), `out/` (renders, gitignored).
- Scenes import `three` / `animejs` as bare imports and helpers from `/runner/lib/<file>.js`; both come from the engine.
- Check the setup with `gfx doctor` (browser, ffmpeg, sound library). Missing ffmpeg: `gfx setup ffmpeg`.
<!-- gfx:end -->

## Project notes
