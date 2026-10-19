# Visual diff between versions — spec v1

Phase 3 of docs/CODE-VERSIONS.md (user-approved 2026-10-18). Compare how a scene looks in two versions: side by side,
as a wipe, or as a difference view, with one scrub bar that moves both. Out of scope (later): variations/branches,
GitHub sync, pixel statistics, audio.

## 1. Decision: live preview servers, not stills
- Stills (`gfx still` per frame) cost a browser launch + Vite start per request (1–3 s): no responsive scrub.
- **Live**: one `gfx serve`-like Vite server per side, rooted at a read-only checkout of that version; the studio
  loads the normal live bridge (`/runner/player/bridge.html?scene=<name>`) in an iframe per side and sends `seek`
  to both. Seeks cost ~5–50 ms per frame (same as Live); no bridge change needed.
- Both sides run on the **current engine** (runner/, presets the version does not have): the diff shows changes in
  the project's files (scenes/, style/, gfx.json, assets), not engine changes. Documented in the dialog tooltip.

## 2. Engine — `gfx version preview` / `gfx version export`
- `gfx version export <rev> --out <dir> [--json]` — writes the version's files into an empty/new `<dir>` using only
  read-only git plumbing (`ls-tree -r -z` + `cat-file --batch`): no worktree, no index, no ref changes (safe for the
  engine repo). Normal project: every tracked file except `out/`, `node_modules/`, `.gfx/`. Engine repo: only
  `scenes/`, `style/`, `gfx.json`. Symlinks / submodules are skipped. `--json` → `{ sha, dir, files, bytes }`.
- `gfx version preview <rev|now> [--port p] [--idle s] [--json]` — long-running:
  1. Prunes stale checkouts in `<tmp>/gfx-vdiff/` (folders `<sha12>-<pid>` whose pid is gone).
  2. `rev` → export into `<tmp>/gfx-vdiff/<sha12>-<pid>/`; `now` → serves the project folder itself (no copy; the
     user's files as on disk, drafts not applied).
  3. Starts Vite (engine `vite.config.js`, root = that folder, own cache dir `vite-gfx-vdiff`, watcher off for a
     checkout) on the first free port in **5260–5299** (`--port` pins one). Never 5177–5199 (E2E + Live).
  4. Prints one JSON line `{ "type": "vdiff", rev, sha|null, short, msg, time, url, port, dir, scenes: [...] }`
     (scenes = folders with a scene.json in that version) and keeps running.
  5. Exits (and deletes its checkout) on SIGINT/SIGTERM/SIGHUP or after `--idle` seconds (default 45, 0 = never)
     without any HTTP request; the studio pings `/__gfx/ping` every 5 s while the dialog is open, so a crashed app or
     a WSL child that survives `engine_cancel` still goes away. A hard kill leaves the folder for step 1 to prune.
- Read-only for every repo: no writes inside the project (the `now` cache lives in `out/.cache/`, as for `gfx serve`).
  Windows and WSL projects go through the normal engine routing (`engine_run`; docs/INSTALL.md §2), like Live.

## 3. Studio — Compare visually (`web/src/vdiff.js`, `vdiff.css`)
- Versions details get **Compare visually** (this version vs current files). In the dialog, side A / side B are
  pickers (Current files + every listed version), so any two versions can be compared; swapping a side restarts only
  that side's preview job.
- Dialog `.modal.vdiff` (full-height like the diff dialog, whole-pixel origin): header (title, A picker, ⇄ swap,
  B picker, scene picker, mode seg **Side by side · Wipe · Difference**, close). Stage: side by side = two boxes,
  each scaled to fit; wipe = B over A clipped at a draggable divider (pointer + ←/→ when focused); difference = B over
  A with `mix-blend-mode: difference` (identical pixels → black). Labels per side (version title, short sha, time).
- Transport: play/pause, scrub bar (0 … longest duration), time readout; starts at the studio playhead. One shared t;
  each side is clamped to its own duration. Seeks are coalesced (latest t wins, one in flight per side).
- Missing scene in a version / load error / engine error → message in that side's box; the other side keeps working.
- Keys inside the dialog: Esc close, Space play/pause, ←/→ one frame, 1/2/3 modes. Closing cancels both jobs
  (`engineCancel`) and stops the heartbeat.
- Engine repo: works (read-only by construction). Not a repo: no button.

## 4. Perf targets
- Dialog open → both pictures: < 4 s for a small project (export < 0.5 s, Vite start ~1 s, scene boot).
- Scrub: both sides follow within one frame of the pointer on the reel fixture at 1080x1920 (bridge draw ≤ 50 ms).

## 5. Tests
- `tests/vdiff.test.mjs`: export (files, exclusions, engine-repo subset, engine HEAD/status untouched), preview
  (JSON line, port range, scenes list, `now`, bridge page served from the checkout, the version's scene.js content,
  idle exit + checkout removed, stale prune).
- E2E `out/studio-vdiff-check.mjs` (own dev server 5186, temp reel project with two versions): open dialog, both
  bridges ready, modes, scrub moves both, difference view changes, swap/side picker, close kills the jobs and frees the
  ports. Plus `code` check (Versions panel) unchanged.

---
## As built (2026-10-18)
- **Engine**: `runner/lib/version.js` `revInfo()` + `exportTree()` (ls-tree + one `cat-file --batch`; `run()` now passes
  string input as a Buffer so `buffer: true` calls can take stdin); `runner/lib/vdiff.js` (`startPreview`,
  `pruneStale`, `sceneNames`, `PORT_MIN/MAX`); CLI `export` / `preview` in `runner/lib/cli/commands/version.js`, option
  `--idle` in `args.js`. Checkouts: `<os tmp>/gfx-vdiff/<sha12>-<pid>/` (the `now` side serves the project itself; its
  Vite watcher stays on, so edits made while the dialog is open reload that side live). The port search probes
  5260–5299 and retries the next port when two previews race for one (`--port` pins one and fails "in use").
- **Graceful stop**: `POST /__gfx/vdiff-stop` (CORS `*`) ends the process normally, so it removes its checkout; the
  studio sends it on close and calls `engineCancel` 1.5 s later as the fallback. A hard kill (Windows
  `TerminateProcess`, the shim's SIGKILL) leaves the folder for the next preview's prune. Idle exit: `--idle` default 45 s,
  the dialog pings every 5 s.
- **Studio**: `web/src/vdiff.js` + `vdiff.css`; Versions details → **Compare visually** (A = that version, B = Current
  files); A / B / scene pickers, ⇄ swap (no restart: the iframes keep their place, classes swap), modes in a `.seg`,
  play / scrub / time, wipe divider (drag on the picture; ↑/↓ nudge when the picture has focus). Difference: B's box
  `mix-blend-mode: difference` inside an isolated layer on a black stage; labels hide (they would blend) and the bar shows
  "Black = same pixels" + **Boost** (default on: `filter: brightness(4)` on the blended layer, so dark-on-dark changes
  show). Keys registered in `keymap.js` (dialog context): Esc, Space, ←/→, 1/2/3 (docs/KEYS.md row).
- No bridge / player change, no Rust change (preview jobs are ordinary `engine_run` jobs; their JSON line arrives as an
  engine event of type `vdiff`).
- **Measured** (Linux Chrome, dev shim): dialog open → both pictures ready 0.7–1.0 s on the reel template; preview start
  (export + Vite) 0.26 s and bridge boot 0.4 s for the reel fixture; a coalesced seek of both sides 4 ms median (reel), the reel fixture
  bridge seek < 2 ms.
- **Tests**: `node tests/vdiff.test.mjs` ( export content / exclusions / non-empty refusal / unknown rev, engine repo
  export subset with status, HEAD and worktree list unchanged, preview info line + port range, stale prune, `now` side,
  each server serves its own scene.js, bridge page, ping root, busy pinned port, idle exit + checkout removed, SIGTERM,
  HTTP stop; + 3 for unsafe tree paths = 24). E2E `out/studio-vdiff-check.mjs` (32 checks, port 5186; gitignored like the other out/ checks; `VDIFF_HOST=localhost` makes the previews
  cross-site iframes like in the app, where WebView2 runs them out of process — blending still works there), run via
  `bash out/e2e-with-dev.sh vdiff`.
- **Not exercised yet**: the real Windows app (WebView2 + `engine_run` for Windows and WSL projects; WSL relies on the
  same localhost forwarding as Live on 5199).
- **Codex review of e047c64 (fixed):**
  - P1 export paths: `exportDest(out, p)` rejects absolute paths, `:` (drive letters / NTFS streams), backslashes (Windows
    separators: `scenes/demo/..\\..\\victim.txt` escaped the folder on Windows), empty / `.` / `..` parts, and checks
    the resolved file stays inside the export root; unsafe entries are skipped and listed as `skipped` in the result.
  - P2 scene choice: the requested scene stays selected even when the first side to report lacks it (that side shows
    "Scene … is not in this version"); only with no scene requested does the first report pick one.
  - P2 live rebuilds: the bridge's `reloaded` (with `meta` when it changed) makes the side ready again, clears its error
    and re-seeks to the shared t, so a fixed file recovers a failed rebuild.
  - P2 render errors: a seek the scene throws on shows "Scene error at <t> s: …" on that side (over a scrim, the picture
    is stale); requests dropped on purpose (close, side or scene switch) are marked `cancelled` and stay silent.
- **2026-10-18 fix (real app: sides stuck on "Loading the scene…")**: with a WSL engine the preview's port reaches
  Windows only ~0.5–1.5 s after Vite listens, and an iframe mounted before that shows WebView2's "can't reach this
  page" for good (Linux / Windows Chrome tests never hit it: they loaded later). Each side now polls
  `<url>/__gfx/ping` from the webview (150 ms steps, up to 20 s; else "does not answer") before mounting its iframe, and
  a bridge that has not said `ready` 20 s after mounting is reloaded once, then reported. Measured in the spike build
  (the reel fixture, engine repo): both sides ready in ~2 s (before: never).
