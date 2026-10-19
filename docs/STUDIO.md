# gfx studio — spec (v1)

Native Windows app to **review a rendered scene: video + all audio stems + cues**, audition **draft edits** live, and leave timestamped notes. v1 never modifies scene sources; it writes a draft file. (v2, not now: send the draft to T3 Code.)

## Stack & layout
- **Tauri v2** (Rust shell, WebView2) — `apps/studio/src-tauri/`. Frontend: plain JS (ES modules) + Vite — `apps/studio/web/`. No React. Styling: hand-written CSS.
- The frontend imports the synth from the harness: `import { renderStems, ... } from '@sfx'` where Vite alias `@sfx` → `runner/lib/sfx.js` (single source of truth; read its exports to see the real API — `resolveCues`, `renderStems`, etc.).
- Windows toolchain (already installed): `C:\Users\<you>\.cargo\bin\cargo.exe` (rust 1.99 msvc), VS 2022, WebView2. Callable from WSL as `/mnt/c/Users/<you>/.cargo/bin/cargo.exe`. Node exists only in WSL.
- Build: `apps/studio/scripts/build-win.sh` → (1) `vite build` in WSL → `apps/studio/web/dist`; (2) rsync `apps/studio/` (excluding node_modules, target) to `/mnt/c/Users/<you>/dev/gfx-studio/`; (3) run Windows `cargo.exe build --release` there (cwd on /mnt/c so it's a real Windows path, not \\wsl$). Output: `C:\Users\<you>\dev\gfx-studio\src-tauri\target\release\gfx-studio.exe`. tauri.conf.json: `frontendDist: "../web/dist"`, no devUrl requirement for release, identifier `money.rema.gfxstudio` → use `dev.gfx.studio`. Build with plain `cargo build --release` (custom-protocol feature on), no tauri-cli needed.

## Data (read from the harness repo)
- **Project root** = the open project (none until one is opened; `GFX_STUDIO_ROOT` sets a start root for dev / tests), changeable via folder picker; persisted in app config dir.
- **Scenes** = subfolders `out/<name>/` that contain `audio/cues.json`.
- Per scene load: `out/<name>/<name>.mp4` (silent video), `out/<name>/audio/stems/*.wav`, `out/<name>/audio/cues.json` (format: see runner/cli.js output — `{scene,duration,sampleRate,master,stems,cues[]}`), `scenes/<name>/sound.json` (may be absent), `scenes/<name>/scene.json` (fps, size), and the draft `out/<name>/review/draft.json` (may be absent).

## Backend API (both implementations must match exactly)
Frontend talks only through `web/src/api.js`, which picks **Tauri** (`window.__TAURI__` / `@tauri-apps/api` invoke) or a **dev shim** (HTTP to a Vite dev-server middleware serving the same operations from the WSL filesystem — used for testing in Linux Chrome).
| op | args | returns |
|---|---|---|
| `get_root()` | — | string path |
| `set_root(path)` | path | ok |
| `pick_root()` | — | path or null (native folder dialog; shim returns null) |
| `list_scenes()` | — | `[{ name, hasVideo, mtime }]` |
| `read_bytes(rel)` | path relative to root | `ArrayBuffer` |
| `read_text(rel)` | rel | string or null if missing |
| `write_text(rel, text)` | rel, text | ok — **only allowed under `out/*/review/`** (reject others) |
| `stat(rel)` | rel | `{ mtime }` or null |
| `start_server()` | — | `{ url }` — starts / reuses `gfx serve` on :5199 (Live mode); `server_status` is a webview ping (`api.serverStatus()`) |
Rust: path joining with root, reject `..` escapes. Large files (video, wav) via `read_bytes` returning raw bytes (tauri::ipc::Response) — fine for ≤ 50 MB.

## UI
Dark, calm, pro-tool look (think DAW / NLE, not a website). Colors: bg `#14171f`, panels `#1b1f2a`, borders `#2a3040`, text `#e6e8ef`, muted `#8b93a7`, accent `#7c86f0`; stem colors: hits `#a3d65c`, motion `#f07a5a`, ui `#5ab8f0`, accents `#e0b04a`, notes `#d0619b`. Inter / JetBrains Mono fallbacks (system fonts OK).
- **Top bar:** scene picker (dropdown), root path (click → pick), reload button (refreshes the scene list too, picks up scenes made outside the app; the list also refreshes on window focus, max every 2 s; an open scene deleted on disk shows the empty state; reloading re-reads draft.json when it changed on disk: taken silently if the draft has no unsaved edits, otherwise an in-app dialog "Claude updated this scene's draft" lists the unsaved edits (`unsavedChanges()`, store.js) with **Load Claude's version** / **Keep mine** (Esc; asks again on the next reload); `isDirty()` is false with no scene open and counts only the open scene's lane volumes) + "changed on disk" badge (poll `stat` of cues.json + mp4 every 2 s), A/B toggle **Original | Draft** (draft only enabled when edits exist), Save draft button (dirty dot).
- **New scene** (docs/LOOKS.md §4, newscene.js): **+** next to the scene picker and "Create your first scene" in an
  empty project open the New scene window (name, prompt, references, format, look, kind, this take, send to). Create runs
  `gfx new`, copies references to `scenes/<name>/refs/`, writes `scenes/<name>/BRIEF.md`, selects the scene and sends
  Claude `Build scene <name> from scenes/<name>/BRIEF.md.` (Claude terminal or a new T3 thread). **Brief** (next to the
  picker, when the open scene has BRIEF.md) = Edit brief & send again. **Library** (top bar, right) opens the Library
  page when library.js provides `openLibrary`.
- **Viewer:** video (muted element) fitted, preserving aspect (vertical reels too). Under it a transport: play/pause, time `ss.ff / dur` and frame number, loop toggle (loop region = drag on ruler with shift), playback rate 0.5/1.
- **Timeline** (bottom, full width, canvas-rendered, resizable height): time ruler (seconds + frame ticks when zoomed), **thumbnail strip** (generate ~1 thumb per 0.5 s by seeking a hidden video; cache), **notes lane**, then one **lane per stem**: header (name, color, M / S buttons, volume slider, peak dB) + waveform (min/max peaks per pixel, recomputed on zoom) + **cue markers** (vertical line + pill label with cue id; selected = highlighted). Playhead line across everything. Ctrl+wheel = zoom around cursor, wheel = scroll, click empty = seek, drag playhead = scrub (video seeks + short audio scrub blip optional).
- **Cue editing (draft):** click a marker → select (inspector shows id, sound, stem, t, gain, pitch, pan, mute). Drag a marker horizontally → moves `t` (snaps to frames; Alt = no snap). Inspector edits: sound (dropdown of all 12 sounds), gain dB slider (-24..+6), pitch (semitones), mute toggle, **reset**. Edited cues show a dot; moved cues show a ghost at the original time. Delete key = mute (original cues) or remove (added cues); see docs/KEYS.md. Double-click empty lane area = add cue of that stem's default sound (choose sound in inspector). Undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- **Audition:** when the draft has edits, re-synthesize the affected stems in the webview with `renderStems` from `@sfx` using cues.json + draft overrides (same resolution logic as `gfx audio`: check `resolveCues` in sfx.js) — debounce 300 ms, show a small "rendering…" chip. Original stems = the WAV files; Draft stems = re-synth. A/B switches instantly at the same playhead.
- **Notes:** `N` adds a note at the playhead (or attached to the selected cue); a small popover to type text; notes render as pins in the notes lane; click → edit/delete. A side panel lists notes + edited cues ("Changes") with click-to-jump.
- **Playback engine:** Web Audio. Stems decoded to AudioBuffers; each stem → GainNode (volume × mute/solo) → master. Clock = AudioContext time; video element follows (set currentTime on play/seek; correct drift > 1 frame every 250 ms). Frame-accurate seek when paused.
  As built (transport.js/audio.js): drift is checked every 80 ms (rate nudge, hard seek beyond 0.2 s); a video the browser paused at its end is restarted once the wrap/seek moves it back. Loops wrap seamlessly: ~0.25 s before b the engine schedules the next pass on the audio clock (`engine.loopAt`) and `time()` jumps b → a when it is heard; a wrap it can't schedule falls back to a seek. While Live shows the scene the hidden video is not driven (paused; parked on the playhead only once it rests, for frame grabs) and is re-synced when Live turns off (`setVideoDriven`).
- Keys: Space play/pause, ←/→ 1 frame, Shift+←/→ 10 frames, Home/End, `M`/`S` mute/solo the active lane, `N` note, Ctrl+S save draft, `A` toggle A/B. Press `?` for the full list; rules, audit and the table are in docs/KEYS.md (one registry, `keymap.js`).

## Draft file `out/<name>/review/draft.json`
A superset of sound.json so v2 can send/apply it as-is:
```json
{ "version": 1, "scene": "_reel-test", "base": { "cuesMtime": 0 },
  "stems": { "ui": { "gain": -4, "mute": false } },
  "cues": { "pop-3": { "t": 6.25, "gain": -6 }, "tick-7": { "mute": true } },
  "add": [ { "id": "new-1", "t": 9.0, "sound": "chime", "gain": -4 } ],
  "notes": [ { "id": "n1", "t": 7.61, "cue": "total-ding", "text": "ding too harsh?" } ] }
```
Stem volume sliders in the lane header are draft edits: moving one marks the draft dirty, and Save (Ctrl+S) folds every non-zero lane volume into `stems.<stem>.gain` (the per-lane "save to draft" link does the same for one lane).

## Verification (builder must run)
- Dev mode in WSL: `npm run studio:dev` (Vite + shim) → puppeteer-core with /usr/bin/google-chrome at 1600×1000: load `_reel-test`, screenshot; play 2 s and confirm the video time advances with the audio clock; select a cue, drag it, change gain → draft re-synth runs, A/B toggles, save writes `out/the reel fixture/review/draft.json`; add a note. Screenshots read and judged.
- Windows: `apps/studio/scripts/build-win.sh` completes; exe exists; launching it from WSL (`/mnt/c/.../gfx-studio.exe &`) starts a process (check with `tasklist.exe | grep gfx-studio`), then kill it (`taskkill.exe /IM gfx-studio.exe /F`).

## Perform (voice -> SFX): removed 2026-10-19
The Perform mode (record a voice take, CLAP-match its events to library sounds) was removed from the studio before the
open-source release. Cues it added to a draft (`add[]` items with a `vox` field, stem `voice`) still load, play and edit
as ordinary sound cues; the `vox` field is ignored. The sound-library index it used lives on in
`apps/studio/web/src/soundindex.js` (Replace…, the Shape section, Library → Sound sources).

## Live mode and element tweaks (docs/REVIEW.md §5)
- **Live** (`L`, toolbar button; badge `LIVE` / `RENDERED` on the picture): the scene runs in a bridge iframe (`<server>/runner/player/bridge.html?scene=`) laid exactly over the video box. It follows the transport (a seek per frame while playing, coalesced) and shows the tweak layer: Draft = `S.draft.tweaks`, Original = none. If no server answers, the studio starts one (Tauri: `wsl.exe ... gfx serve`; dev: local node). If the bridge fails or times out (25 s) it falls back to the video. `Shift+L` is now Loop.
- **Select** (`V`, Live only): hover outline; click = topmost named element (Alt = exact hit; `[` / `]` walk up / down the stack, breadcrumb in the inspector); drag inside = move, corner = uniform scale, top knob = rotate (Shift = 15 deg), arrows nudge 1 px (Shift 10). One drag = one undo step. Esc deselects. Comments made in Live mode get `el` from the bridge pick.
- **Inspector** for the selection: x, y, scale, rotate, opacity, text (only when the element is a single text node), color, bg, Reset. **Elements** tab (Live): named elements, tweaked ones dotted. **Changes** lists tweaks (`total  x +40 · y -60 · scale 1.20`); Save writes `tweaks` to `draft.json`.
- Tweak-only edits never re-synthesize audio (the synth is gated on the per-stem audio signature). Draft tweaks are absolute over `scenes/<scene>/tweaks.json`: an applied file tweak is not used as the starting value of a drag.
- Keys are ignored while typing in an input (docs/KEYS.md). Dev check: `node out/studio-live-check.mjs` (studio dev on :5177).
