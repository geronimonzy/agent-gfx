---
name: motion-graphics
description: Use when asked to make an animation, motion graphic, promo video, explainer, animated logo or diagram, product showcase, or any "make a graphic/animation/video". Entry skill for the gfx harness - runs the storyboard, build, verify and render workflow and routes to the threejs, canvas2d, svg and animejs skills.
---

# Motion graphics workflow (gfx harness)

Source of truth: the contract, `<engine>/docs/CONTRACT.md`. `<engine>` is the `engine` field of the project's `.gfx/engine.json` (with `wsl` and a Windows shell: `\\wsl.localhost\<wsl><engine>`); a project has no `docs/` of its own (in the engine repo itself it is `docs/CONTRACT.md`). Read it if unsure about ctx, CLI flags, or presets. Scenes live in `scenes/<name>/`, output in `out/<name>/`. CLI: `gfx <cmd>` (the engine's `bin/gfx` launcher). If `gfx` is not on PATH (e.g. a T3 thread), read the project's `.gfx/engine.json` and run its `bin` (or `node <engine>/runner/cli.js`); never search the disk for an engine.

**Project lines** (the managed block of the project's CLAUDE.md):
- `Workflow (this project): …` sets how much of steps 7-9 a new scene or a large rewrite gets. **Quick** (the default when there is no line): one contact sheet; stills only at moments where the sheet shows a problem; no render (the user renders from gfx studio); sound only if asked. **Full**: steps 7-9 as written. **Custom**: the line spells out verify (1 contact sheet / contact sheet + key stills (t=0, the hero beat, the last frame) / full 2 passes), render or not, sound always or only if asked. The request overrides it ("render it too", "add sound"). Review fixes always verify with stills at the changed moments.
- `Look: <name> (looks/<id>/LOOK.md)`: read that LOOK.md at Brief, Style and Build and follow its Motion / Typography / Colour / Do-Don't sections; its preset is `look-<id>` (`gfx new` defaults to it); references are in `looks/<id>/refs/`.

Asked to make or rebuild a **look** (LOOK.md + preset + sound palette + sample scene, from references, a prompt or this project)? Use the `look-design` skill.

## Workflow (do in order, do not skip)

1. **Brief.** If `scenes/<name>/BRIEF.md` exists (written by gfx studio's New scene window), it is the brief: read it, Read the files under `scenes/<name>/refs/` with their notes, and don't ask again what it answers (format, look, kind, this take's profile, sound, render). `Kind: Auto` means you choose the kind; if it differs from the scaffolded one, re-scaffold: copy `<engine>/templates/<kind>/` over the folder (keep BRIEF.md, refs/ and scene.json's size/fps/duration/style; set its `kind`). Otherwise pin down: purpose, audience, message (one sentence), duration, target size/platform, style preset, brand colors/assets, text copy. Ask only what is missing; propose defaults for the rest.
2. **Style.** With a look, use its preset (`look-<id>`) and LOOK.md. Otherwise ask which preset in `style/presets/` (`ls style/presets`). If the user has brand colors, create `style/presets/<brand>.js` by copying `dark-grid.js` and swapping `colors`/`fonts`. Never hardcode colors in scenes: use `ctx.style.colors.*` or CSS vars like `var(--gfx-accent)`.
3. **Storyboard.** Write `scenes/<name>/STORYBOARD.md` BEFORE any scene code. Format:
   ```
   # <title>  1920x1080 @60  8.0s  style: dark-grid
   | beat | time    | on screen          | motion                | text    |
   | 1    | 0.0-1.2 | grid fades in      | outCubic fade         | -       |
   | 2    | 1.2-3.5 | logo path draws on | dashoffset, outExpo   | "Acme"  |
   ```
   One idea per beat, each with start-end times. Last beat = end-card hold >= 2s.
4. **Pick kind** (table below). One scene = one kind.
5. **Scaffold.** `gfx new <name> --kind <kind> --size 1920x1080 --fps 60 --dur 8 [--style <preset>]` (default: the look's preset, else dark-grid)
6. **Build.** Read the kind's skill first (`threejs`, `canvas2d`, `svg`, `animejs`). Start from the template, implement beats in storyboard order. `gfx dev <name>` is for human realtime preview; you verify with stills.
   - **Keep scene.js runnable at every save.** The studio's Live view and `gfx still` run the file as soon as it changes, so never leave placeholders (`__X0__`), half-written functions or undefined names in it between steps. Compute fitted or derived values (orbits, path fits, layout math) first in a scratch script or file under `out/<name>/scratch/` (`node out/<name>/scratch/fit.mjs`), then write scene.js in one runnable step. After each save, `gfx still <name> --t 0` must still succeed.
7. **Verify loop** (per the workflow line; Full = below, at least 2 passes):
   - `gfx sheet <name> --n 12 --cols 4`, then **Read the PNG** (`out/<name>/sheet.png`). Judge pacing, overlaps, empty stretches, clipping.
   - `gfx still <name> --t <sec>` at each beat's key moment (mid-beat and the hold); **Read** each PNG. Check legibility, margins, alignment, colors.
   - Also still at `t=0` and the last frame (`--t <duration minus 1/fps>`): the last frame must be the intended end card.
   - Critique against STORYBOARD.md and the checklist below. Fix, re-run.
8. **Render** (Full, a Custom line with render, or when asked; Quick: skip and say the user can render from gfx studio).
   - Video: `gfx render <name> --format mp4`
   - Social/chat: `--format gif` (fps capped 30; add `--scale 0.5` to shrink) or `--format webm`
   - Web embed: `gfx export <name>` (prints an iframe snippet)
   - Frames: `--format png`
   - Try a short `--from 0 --to 1` (or `--dur 1`, i.e. `to = from + dur`) render first for heavy scenes to estimate wall time.
   - `render` flags: `--format mp4|webm|gif|png --fps N --from s --to s --dur s --scale k --out path`; default out `out/<name>/<name>.<fmt>` (png: `out/<name>/frames/`). `still` also takes `--scale` and `--out`. Needs `ffmpeg` on PATH for video/gif; Chrome is `/usr/bin/google-chrome` (override `GFX_CHROME`), WebGL runs on swiftshader (CPU).
9. **Sound** (Full / "sound always", or when asked; Quick: skip): follow the `sound-design` skill — SOUND.md plan, `ctx.cue` in setup next to the tweens (with `el: '<name>'` when the sound belongs to one element), `gfx audio <name>`, Read `sync.png`, check levels. Output `out/<name>/<name>.sound.mp4`.
9b. **Background = a layer.** Always give the background its own full-frame element named `background` (first child of `ctx.root`, bottom of the stack; grid and fill live inside it), so the studio's Layers tab can select, hide and tweak it. Never paint it on `ctx.root` itself. Per kind: anime = `<div data-gfx="background" style="position:absolute;inset:0">` + `gridCss`; svg = `gridSvg(s, W, H, { name: 'background' })`; canvas / three = a separate bottom `<canvas data-gfx="background">` with `drawGrid`. Sub-layers (e.g. `bg-glow`) are named children or siblings above it.
9c. **Mark each named element's code.** Wrap every block that belongs to a named element (creation, styling, per-frame code, its sound cues) in `// @gfx <name>` … `// @end` comments; the studio's "Open code" shows exactly those blocks (folding the rest), so the user can start from the object's code. A key may have several blocks; blocks don't nest; `// @gfx a b` gives one block to two keys. CSS: `/* @gfx title */ … /* @end */`; HTML inside a template literal: `<!-- @gfx title --> … <!-- @end -->`. Keep blocks tight and shared helpers outside them. Comments only: renders stay byte-identical. The kind skills and `templates/` show the form for each kind (including `background`).
10. **Report** absolute output paths, duration, size, fps, and notable caveats. Name the important elements (`data-gfx="phone"` or `ctx.el`) while building so the user can select and comment on them in gfx studio.

## Review loop (after the user looks at it in gfx studio)
- When the user asks from gfx studio, the message starts with a `gfx context` brief (moment, selected elements, pending tweaks, comments). Re-print it any time: `gfx context <name> [--t s] [--el key] [--comment id] [--tweaks]`.
- `gfx review <name>` lists open comments: time/frame, spot, element, text and absolute paths of the attachments. **Read the markup PNG** (frame + the user's drawing + pin) and any screenshot before changing anything.
- Pending proposals in the draft: element tweaks (move/scale/rotate/opacity/text/color) and audio edits. Fold them with `gfx apply <name>` (writes `scenes/<name>/tweaks.json` / `sound.json`), or bake tweaks into scene code when they are part of a bigger change, then remove them from tweaks.json.
- Fix, re-verify with stills (`gfx review <name> --stills` renders the exact commented frames), re-render, then `gfx review <name> --resolve <id> --reply "what changed"` (or `--wontfix <id> --reply "why"`). The studio shows the replies live.

## Medium selection

| Need | Kind |
|---|---|
| 3D objects, depth, camera moves, product in space, lighting | `three` |
| Particles, generative/noise fields, many objects, glow, raster effects | `canvas` |
| Line art, diagrams, paths drawing on, crisp vector, morphs, Bezier/geometry explainers | `svg` |
| Choreographing many DOM/SVG elements, UI mockups, typography, sequencing; usually best for product/app showcases | `anime` |

Unsure between svg and anime: pure drawing/diagram -> svg; UI, text, cards, many staggered elements -> anime (it can host inline SVG too).

### Mixing media
One scene = one kind. For multi-medium pieces:
- **Nest:** an `anime` scene may put a `<canvas>` inside `ctx.root` and draw it in `render(t)` from the same `t` (keep it a pure function of t). Use for one small embedded effect.
- **Concat:** render separate scenes at the SAME size, fps, codec, then:
  ```
  printf "file 'a.mp4'\nfile 'b.mp4'\n" > out/list.txt   # paths relative to list.txt
  ffmpeg -f concat -safe 0 -i out/list.txt -c copy out/final.mp4
  ```
  `-c copy` requires identical codec/size/fps/pix_fmt (gfx mp4 renders satisfy this). For a crossfade, re-encode:
  `ffmpeg -i a.mp4 -i b.mp4 -filter_complex "xfade=transition=fade:duration=0.5:offset=<a_dur-0.5>" -c:v libx264 -crf 18 -pix_fmt yuv420p out.mp4`

## Sizes and fps
- 1920x1080 YouTube/web; 1080x1920 Reels/TikTok/Shorts; 1080x1080 or 1080x1350 feed.
- 30 fps: default for heavy three/canvas scenes (half the render time) and most explainers. 60 fps: UI motion, fast type, line draws, web export. GIF caps at 30.

## Motion-design principles
- One idea per beat. Cut anything that does not serve the message.
- Reading time: >= 1.5s per short line; budget ~3 words/second. Hold the final text.
- Ease everything. Entrances `outExpo`/`outCubic`; moves `inOutCubic`; exits short. Springs (`outBack`, `outElastic`) sparingly. Linear only for continuous rotation/scroll/loops.
- Stagger 40-80 ms between siblings; keep total spread under ~0.6s.
- Overlap: start the next animation before the previous settles. Nothing sits idle then pops.
- Anticipation and settle: small counter-move before big moves; slight overshoot, then rest.
- Consistent direction of travel (e.g. enter from bottom/right, leave up/left).
- Restrained palette: neutrals plus one accent, used sparingly on the focal item.
- Safe margins >= 5% of frame on every side (96px at 1920 wide). For 9:16 keep key content out of the top ~12% and bottom ~20%.
- Typographic hierarchy: 2-3 sizes max (headline ~6-8% of frame height, body ~3-4%, caption >= 2.5%).
- Keep subtle background motion (grid drift, slow rotation) so held frames are not dead; low contrast.
- Loops: make `render(t)` periodic (integer cycles over `duration`) so frame at `duration` equals frame at 0. Verify with stills at 0 and duration minus one frame.
- Motion blur is not needed; keep fast moves short (< 300 ms).
- End card: hold >= 2s, static or very slow drift.

## Determinism (contract)
`render(t)` is a pure function of t. Forbidden: `Date.now`, `performance.now`, unseeded `Math.random` (use `mulberry32` from `/runner/lib/rng.js`), `requestAnimationFrame`, CSS transitions/animations, state that depends on call order (frames are captured by seeking, possibly out of order). Await assets in `setup`/`render`.

Libs (JS functions, not strings): `/runner/lib/ease.js` (`linear, inOutCubic, outCubic, outExpo, inOutExpo, outBack, outElastic, inOutSine`; each `x(0..1) => y`, no params), `tween.js` (`clamp`, `lerp`, `progress`, `tween`, `keyframes`, `stagger(i, each, start)`), `rng.js` (`mulberry32(seed)`, `hash(i, seed)` in [0,1)), `style.js` (`drawGrid` canvas, fills bg; `gridSvg` returns markup string, option `name` sets `data-gfx`; `gridCss` returns style props).

## Self-review checklist (before declaring done)
- [ ] STORYBOARD.md exists and matches what is on screen.
- [ ] Viewed the sheet and the stills the workflow line asks for via Read (not assumed).
- [ ] No hardcoded hex colors; all from `ctx.style`/CSS vars.
- [ ] Text inside safe margins, not clipped, readable contrast, held long enough.
- [ ] No linear easing except continuous motion; no dead stretch > 1s.
- [ ] Same `t` twice gives identical stills (no hidden state).
- [ ] scene.js was runnable after every save (`gfx still <name> --t 0` passes; no placeholders left).
- [ ] End card holds >= 2s; loop seam clean if looping.
- [ ] Rendered in the right format if the workflow/request asks for it; absolute paths reported.

Minimal scene and storyboard template: `references/example-scene.md`.
