# gfx runner

Deterministic motion-graphics runner. Spec: `docs/CONTRACT.md` (scene contract, ctx, style presets, CLI).

```
npm install
npx gfx new <name> --kind three|canvas|svg|anime [--size 1920x1080] [--fps 60] [--dur 6] [--style dark-grid]
npx gfx dev <name> [--port 5173]          # live preview with scrubber (space, left/right)
npx gfx still <name> --t 3                # out/<name>/still-3.png
npx gfx sheet <name> [--n 12] [--cols 4]  # labeled contact sheet, out/<name>/sheet.png
npx gfx render <name> [--format mp4|webm|gif|png] [--fps N] [--from s] [--to s] [--dur s] [--scale 1]
npx gfx export <name>                     # out/<name>/web/ (static, relative paths, loops in realtime)
npx gfx list
npx gfx lib list|add|enable|disable|fetch|index|search   # sound library, see below
```

Notes
- Scenes live in `scenes/<name>/` (`scene.js` + `scene.json`); templates in `templates/<kind>/`.
- `render` captures frame by frame through headless Chrome (`/usr/bin/google-chrome`, override with `GFX_CHROME`) into ffmpeg. `--dur s` renders `s` seconds from `--from`.
- Helpers for scenes: `/runner/lib/{ease,tween,rng,style}.js` (`style.js`: `drawGrid`, `gridSvg`, `gridCss`).
- `render(t)` must be a pure function of `t`: no clocks, no unseeded random, no CSS animations.
- Chrome flags (in `runner/cli.js`): contract flags plus `--no-sandbox --disable-dev-shm-usage`.

## Audio (synthesized SFX, separate stems)
Scenes declare sound events in `setup` with `ctx.cue(t, sound, opts)` (`t` = the hit moment; sounds: impact swoosh suck logo whoosh rise click pop tick type ding chime; opts `id gain pan x pitch dur stem intensity variant`). Helpers `pentatonic(i, base)` and `countTicks(t0, t1, n, ease)` come from `/runner/lib/sfx.js`. Calling `ctx.cue` outside `setup` throws.
```
npx gfx audio <name> [--video path]   # out/<name>/audio/: cues.json, stems/<stem>.wav, mix.wav, sync.png; muxes out/<name>/<name>.sound.mp4
npx gfx render <name> --audio         # render mp4, then audio + mux (the silent mp4 is never overwritten)
```
- Synthesis runs in headless Chrome (OfflineAudioContext, 48 kHz stereo, seeded noise), so `gfx audio` output is byte-identical run to run. Stems are 24-bit, un-normalized; `mix.wav` is two-pass loudnorm to `master.lufs` (default -14) at -1 dBTP.
- Read `sync.png` (frames + per-stem waveforms + labeled cue markers + time ruler) to verify sync without listening; `cues.json` lists final ids for editing.
- Optional `scenes/<name>/sound.json` fix layer: `stems` (gain/mute), `cues` (per-id t/sound/gain/pan/pitch/dur/stem/mute), `add` (extra cues), `master.lufs`.
- Hits/motion sounds take `intensity` (0..1, softer and shorter when low) and `variant` (impact thud|punch|boom, whoosh air|swipe|zip, swoosh silk|wash; chosen from the cue seed when omitted, never repeating the previous cue of the same sound) and vary per cue (pitch, filters, length, envelope, width, balance). Noise is band-limited below ~7 kHz and the shared reverb is short and dark. All of this stays deterministic: any new fan-in must go through `makeSum` (2-input gain chains), never a bare multi-input connect. See docs/CONTRACT.md "Audio".
- `gfx dev` plays the mix in sync (rendered once in the page) with a `sound` mute button; browsers start audio only after the first click/keypress.
- Keep synth graphs order-stable: Chrome sums fan-in connections in pointer order and mixes mono+stereo non-reproducibly, so `sfx.js` sums through 2-input stereo `makeSum` chains. Preserve that when adding recipes.

## Sample cues and the sound library (`gfx lib`)
- `ctx.cue(t, 'sample', { src, start, dur, rate, env, gain, pan })` plays a recorded file (stem `samples`); rendered deterministically (browser decode, JS resample/envelope). `renderStems(cues, { duration, stems, loader })` takes `loader(src) => Promise<ArrayBuffer>`; `gfx audio`/`gfx dev` use the Vite route `/@gfx-audio?src=` which only serves audio under `library/` or inside folders registered in `library/sources.json`.
- `library/` is gitignored except `library/sources.json`. Typical start: `npx gfx lib fetch kenney && npx gfx lib index synth kenney && npx gfx lib search "button click"`. The first index downloads the CLAP model (~156 MB) into `library/.models`; later runs are offline. Indexing speed ~3.6 files/s on CPU (467 Kenney files in ~2 min); re-runs only touch new/changed files.
- Freesound: `export FREESOUND_API_KEY=...; npx gfx lib fetch freesound --query "whoosh" --n 50`.
- Features, CLAP helpers and the index format: `runner/lib/vox-features.js`, `docs/CONTRACT.md` "Sound library (`gfx lib`)", `docs/SOUND-LIBRARY.md`.
