# Welcome window and Settings page (spec v1, draft for review)

These were the user's decisions on 2026-10-15:
- The welcome screen is a **separate window**.
- Settings is a **full page like T3's**.
- Settings scope works **like T3's**: machine settings plus per-project overrides.

This replaces the Projects home overlay (FOUNDATION.md §6) and the Settings dialog (`settings.js`). The T3 reference
is `~/claudeStuff/t3code/apps/web/src`: `routes/settings*.tsx`, `components/settings/*`, `settingsScope.ts`.

## 1. Welcome window

A small native window, label `welcome`, about 960×620 and resizable, with a minimum of 760×520. It is created with
`disable_drag_drop_handler()`, which a folder drop still needs (see below). It is the only window the app opens at
start, unless **On start** = "Reopen last project" and that project still exists.

**Layout:**
- **Left column:** the app name and version, plus three actions:
  - **New project**
  - **Open folder…**
  - **Add folder of projects…**
- Under the actions, two lists:
  - **Recent**: up to 12 projects. Each shows a thumbnail (the first scene's sheet or still, if present), name,
    path, scene count and when it was last opened. A pin keeps it at the top; the ⋯ menu has Reveal in Explorer and
    Remove from list.
  - **Folders**: folders you added. Each shows the gfx projects found directly inside it, scanned when the window
    opens. This is the "folder with projects inside" view that the T3 panel's "All in folder" also uses.
- **Bottom status strip:** Engine · ffmpeg · Browser · T3. Each part shows a dot plus a fix button where one applies:
  "Download ffmpeg", "Install pinned browser", "Connect T3" (which opens Settings → T3 in the main window). This
  replaces the setup card.
- **Missing project** (the folder was moved): the row is greyed out with "Folder not found". Its actions are Locate…
  and Remove.

**Flows (clicks):**
1. **Open a recent project:** 1 click on the row. The main window opens with that project (or switches to it if it's
   already open), and the welcome window closes.
2. **New project:**
   - New project, then pick a template card (Blank / Reel 9:16 today).
   - Then fill in the name and location. The location is pre-filled with **Default projects folder**, and the final
     path is shown live.
   - Then Create. This runs `gfx init` with progress in the same pane and opens the project. That's 3 clicks plus
     typing a name.
   - The pane slides in place inside the welcome window, with Back to return; there is no dialog on top.
3. **Open folder:** the system picker opens.
   - If the chosen folder is a gfx project, it opens.
   - If the folder contains projects, it is added under Folders.
   - Otherwise: "No gfx project here", with **Make it a project** (`gfx init` with the Blank template) and **Choose
     another**.
4. **Drop a folder** on the window: same as Open folder.

**From the main window:** the project menu has **Open welcome window** (shortcut `Ctrl+Shift+O`). Closing the welcome
window while no main window is open quits the app.

**One main window**: opening another project switches the main window. If the current project has unsaved code edits,
the existing confirm appears first. Several projects open in several windows is not in v1.

## 2. Settings page

A full page **inside the main window** that replaces the docked workspace. The dock layout is kept and restored when
the page closes.
- Open it with ⚙ in the top bar or `Ctrl+,`.
- **Esc** or **← Back** returns to the exact workspace you left: same mode, same panel. Esc is ignored while a field
  is being edited.
- Pop-out panels stay open.

**Layout (copied from T3):**
- **Header:** a breadcrumb "Settings / Rendering".
- **Left nav:**
  - a search box at the top: `Ctrl+F` or `/` focuses it, and arrow keys move through results;
  - picking a result scrolls to that setting and briefly highlights it;
  - the categories are listed under the search box.
- **Body, sections:** each section has a muted heading and a card of rows.
  - **Row:** the title and a one-line description on the left, the control on the right. The row stacks into one
    column when narrow.
  - **Reset:** a ↺ button appears next to the title when the value differs from its default or its inherited value.
- **Saving:** changes apply instantly. There is no Save button, and invalid input shows an inline error under the
  field.

**Scope (like T3):**
- **Scope sentence** at the top of scoped pages: "Applying to **[All projects ▾]**". The dropdown lists "All projects
  (this computer)" and the current project. The page defaults to the current project when one is open.
- **Resolution order:** project override (`gfx.json` → `"settings"`, so it travels with the project and git), then the
  machine value (app config dir `settings.json`), then the built-in default.
- **Inheritance marker:** each project-scoped row shows where its value comes from. Clicking the marker shows the
  chain (Project · This computer · Default) with the effective value ticked. ↺ removes the project override.
- **Machine-only rows:** these stay visible on a project scope, but read-only, with the note "Applies to this
  computer".
- **Machine-only pages:** pages with no project settings have no scope sentence: Appearance, T3, Engine & tools.
  (Claude & terminal was one until First take, a per-project row, arrived on 2026-10-16: it now has the scope sentence,
  and Shell / Claude command / Ask send are read-only at project scope.)

**Categories and rows** (P = can be overridden per project; everything else is machine-only). Only settings that
exist today or that the user asked for; no new features:

| Page | Rows |
|---|---|
| General | On start: Welcome window / Reopen last project · Default projects folder · **Library folder** (`libraryDir`, default `<Documents>/gfx library`, docs/LOOKS.md §3) · External code editor (VS Code / system default / custom command) |
| Appearance | UI scale (the current whole-UI zoom) · Show all panel headers · Reset panel layouts (per mode or all) |
| Rendering | Default mode Fast/Exact (P) · Workers (P) · Default size preset (P) · Quality (P) · Intermediate frames PNG/JPEG (P) · Include audio by default (P) · Output folder (P, default `out/`) |
| Code & versions | Code autosave (P) · Auto-checkpoints (P) |
| Claude & terminal | **First take** (P; `workflow` Quick / Full / Custom, docs/LOOKS.md §1) · Shell · Claude command · Ask Claude send mode (the current `ask.send`) |
| T3 | Everything from today's Integrations section: server, connection and access level, Change access…, Disconnect, Auto-create T3 projects |
| Engine & tools | Engine path and version · ffmpeg status, path and Download · Browser status and Install pinned browser · **Run doctor** with the report shown inline |
| Shortcuts | A read-only list (same content as the `?` sheet) with search |
| About | Version, licenses and third-party credits (sounds, fonts, ffmpeg, browser, CLAP model), open the logs folder |

**Storage changes:**
- These preferences move from browser storage into `settings.json`, migrated once on first start and the old keys
  removed: `ask.send`, `code.autosave`, `versions.auto`, `mic` (dropped with Perform on 2026-10-19), `uiZoom`.
- These stay in browser storage, because they are UI state, not settings: the layouts, `layers.tl` and the last
  scene (`guide` / `srcopen` went with Perform, 2026-10-19).
- The recent list and the folders move to the app config dir as `recent.json`, because the welcome window must read
  them before any webview has loaded.

## 3. Decisions (2026-10-15)
1. **First run:** when there are no recent projects and no folders, the right side of the welcome window shows the
   templates as big cards (like T3's "no projects" hero). Clicking a card starts New project at the name step.
2. **Templates stay Blank and Reel** in this build (superseded 2026-10-18 by docs/TEMPLATES.md: six built-ins with
   previews, Save as template, user templates). Templates are a separate big feature for later (new templates,
   a template library); this spec only shows whatever `templates/projects/` contains.
3. **Folders** lists only folders the user adds; opening a project never adds its parent folder.

## 4. Tests
- **Rust:** `settings.json` merge and validation, project override resolution, recent/folder list handling (pin,
  missing, cap).
- **Dev shim E2E** `out/studio-settings-check.mjs`:
  - search, then jump and highlight;
  - scope switch, override and ↺ reset;
  - instant apply;
  - Esc returns to the same mode.
- **E2E** `out/studio-welcome-check.mjs`: the welcome page rendered as a route in the shim.
- **Real app:** the journeys in `docs/JOURNEYS.md`: first launch, new project, open recent, settings round trip.

## As built (2026-10-16)
- **Code.** Rust: `src-tauri/src/prefs.rs` (settings schema + validation, strict / lenient merge, project overrides with a
  `gfx.json` text edit, `recent.json` list logic), `src/welcome.rs` (the window, `welcome_open` / `open_welcome` /
  `close_welcome` / `welcome_settings`, recent + folder ops, `classify_folder`, `list_templates`, thumbnails, Reveal, the
  WebView2 folder drop), `claude.rs` (`Settings` struct extended: `shell`, `claudeCommand` + a validated `prefs` map;
  `open_in_editor`), `popout.rs` (`build_main` generic, also on demand), `lib.rs` (start window, quit rule),
  `capabilities/welcome.json`. Web: `welcome.html` + `src/welcome.{js,css}`, `src/settings.{js,css}` (the page; the old
  dialog is gone), `src/prefs.js` (store + migration), `src/settings-core.js` (pure twin of prefs.rs) +
  `settings-core.test.js`, `src/tools.js` (doctor / setup, shared), `src/menu.{js,css}` (menus moved out of layout.js),
  `keys-help.js` (`shortcutsHtml`, shared). Removed: `projects.js`, `projects.css` (its button rules moved to
  `styles.css`), `#home`. Dev shim twins in `vite.config.js`; multi-page build (`index.html`, `welcome.html`).
- **§1 Welcome window** as specified: left = name + version + New project / Open folder… / Add folder of projects…;
  right = Recent + Folders, or the first-run hero; bottom = the status strip (Engine · ffmpeg · Browser · T3 with
  Download ffmpeg / Install pinned browser / Connect T3, inline progress, errors under it). New project = template card
  → name + location (pre-filled, final path live, Browse…) → Create (`gfx init`, progress in the pane) → opens; Back / Esc
  go one step back; the hero's cards start at the name step. Open folder / drop: project → opens; projects inside →
  added under Folders (toast); else "No gfx project here" → **Make it a project** (`gfx init <dir> --template blank
  --existing`, a new engine flag: allowed in a folder with files, nothing existing is overwritten, `.gitignore`
  appended) / **Choose another**. Recent rows: thumbnail (first scene with a sheet, else a still), name, path, scenes,
  "… ago", pin (hover), ⋯ Reveal / Remove; missing → "Folder not found" + Locate… / Remove. Opening a project in the
  open main window: `gfx://open-project` → the main window's unsaved-edit confirms → switch → `close_welcome` (cancel
  leaves the welcome window open). Connect T3 is disabled with a reason while no project window is open.
  **Folder drop works through HTML5**: `disable_drag_drop_handler()` stays on; the page posts the dropped `File`s with
  `chrome.webview.postMessageWithAdditionalObjects`, the host reads `ICoreWebView2File::Path` (`webview2-com`, same
  version wry uses) and sends `gfx://dropped` back. Verified with a real OS-level drag of a folder (CDP drag with a file
  path) in the exe.
- **§2 Settings page** as specified (T3's structure in the studio theme): breadcrumb, ← Back + Esc, left nav with search
  (Ctrl+F or `/`, ↑ ↓ Enter, results replace the categories, the jump scrolls the row to the centre, focuses it and
  pulses it twice), sections of row cards, ↺, inheritance marker (click: the chain inline under the row, not a popover),
  scope sentence on Rendering and Code & versions, instant apply (selects / checkboxes on change, text on Enter / blur),
  inline errors (nothing written). The workspace is only hidden (`visibility`), so it comes back exactly (mode, panels,
  sizes, active panel, pop-outs); pending "Reset panel layouts" of the current mode is applied when the page closes.
  Machine values equal to the default are stored as "not set". Values used elsewhere follow at once through a `prefs`
  event (UI scale → `setZoom`, headers, render defaults, code autosave, auto-checkpoints, editor button, Ask send).
- **Storage**: `settings.json` (validated in Rust on read and write), `gfx.json` `"settings"` (only the per-project keys;
  text edit, every other key and its formatting kept, atomic write, a byte-identical file after ↺), `recent.json` (12,
  pinned first, missing kept until removed). One-time migration of `ask.send`, `code.autosave`, `versions.auto`, `mic`,
  `uiZoom` and the old recent list (keys removed); verified in the exe (the old list of another worktree came across).
- **Deviations / choices.** The project button in the top bar opens the welcome window directly (one click; no
  one-item menu); the shortcut is `Ctrl+Shift+O`. Folders also have ⋯ Reveal / Remove (else a wrong folder could not be
  removed). "Show all panel headers" became a machine setting (was saved per mode in the layout; migrated as "on" if any
  mode had it). Workers: Auto / 1-8 (Auto = no flag, the engine's default). Intermediate frames PNG / JPEG: JPEG adds
  `--frame-format jpeg` for mp4 / webm / gif without alpha; Draft in Fast mode keeps using JPEG as before. Output folder:
  `out` or a folder inside it (the Rust open / reveal guards only allow `out/`); the Renders tab still lists
  `out/<scene>/` and the quick render keeps the review video in `out/<scene>/`. Default mode and workers also apply to
  the quick render. About → "App folder" opens the config folder (the app writes no log files yet). Machine-only rows on
  a scoped page are supported (read-only + "Applies to this computer") but no current page has one. The external
  editor's "system default" uses the file type's **edit** verb and refuses scripts without one (the Windows default
  for `.js` is Windows Script Host).
- **Tests.** Rust 54 (+ prefs: validation, machine merge, project overrides + gfx.json write, text edit, recent list
  pin / cap 12 / missing / relocate / folders, projects-dir default; welcome: folder scan, known-path guard,
  thumbnails; editor command). `settings-core.test.js` 5. `out/studio-settings-check.mjs` 68, `out/studio-welcome-check.mjs`
  42. Updated for the removed dialog / home: keys-check (Settings page keys), terminal-check, t3-check (Settings → T3,
  auto-create applies at once), layout-check (`home` id gone, UI zoom and headers in settings.json), project.test
  (+3 `init --existing`).
- **Windows exe (spike build).** Start = only the welcome window; drop of the repo folder → main window with the
  project, welcome closed; Settings: project override written to the repo's `gfx.json` and removed again (file
  byte-identical), machine value in `%APPDATA%\dev.gfx.studio.spike\settings.json`, UI scale 125 % = DPR 1.25;
  Ctrl+Shift+O reopens the welcome window, clicking the open project closes it; with a native engine (`GFX_ENGINE`):
  status strip green, New project (Reel) → `gfx init` → main window on the new project with its scene; thumbnails;
  On start = Reopen last project → only the main window; closing the welcome window (WM_CLOSE) with no main window quits.
- **Engine folder (2026-10-16, user-approved addition).** A dev build has no `engine/` next to the exe, so the strip said
  "Engine not found" with only "Check again". Now a machine setting **Engine folder** (`engineDir`, machine-only, in
  `settings.json`): Settings → Engine & tools → row "Engine folder" (current engine path + where it comes from: chosen
  folder / next to the app / GFX_ENGINE, WSL marker, **Choose…**, ↺ = auto, inline error); the welcome strip shows
  **Choose engine folder…** next to "not found" (plus **Use <name>** when a recent project folder is itself an engine,
  e.g. the gfx repo, and Check again). Resolution: `GFX_ENGINE` > setting > `engine/` next to the exe (`lib.rs`
  `engine_dir` / `locate_engine`, `engine_info`). Validation in Rust (`check_engine_folder` in `patch_settings`): the folder
  must contain `runner\cli.js` ("No gfx engine in …" / "Engine folder not found: …", nothing written). A Windows engine
  runs `<engine>\node\node.exe` if present, else `node`; a WSL engine (`\\wsl.localhost\<distro>\…` / `\\wsl$\…`) runs
  every command through `wsl.exe -d <distro> --cd … -- bash -lc "node …"` (see API.md, Engine runner): no-project
  commands with cwd = the engine, `gfx init C:\…` gets `/mnt/c/…`, and a native project later opened with that engine
  runs in WSL too (cwd `/mnt/c/…`, `GFX_PROJECT`), its live server's `/mnt/c/…` ping root matches the project. Templates
  are read through the `\\wsl.localhost` path. Verified in the spike exe (no engine next to it, no GFX_ENGINE): strip
  "Engine not found" + Choose engine folder… + Use the dev engine checkout; `C:\Windows` refused ("runner\cli.js is missing"),
  a missing folder refused; Use the dev engine checkout → strip "Engine v0.2.0 · ffmpeg found · Browser chrome"; templates blank,
  reel; New project (Reel) into `C:\…\wl-projects\…` → `gfx init` in WSL → the main window opened the native project;
  `gfx still reel --t 1` there via the WSL engine wrote `out/reel/still-1.png`. **Limits with a WSL engine + a native
  project:** the terminal gets no `gfx` on PATH (the engine is not native), file watching of `/mnt/c` from WSL may miss
  edits made by Windows programs (live reload), and it is slower than a native engine; the live server was not started
  in the exe test (port 5199 was held by an older node.exe of a previous session). Tests: Rust `engine_location` (order),
  `wsl_engine_commands` (command building, `/mnt/c` mapping, the folder check), prefs validation; `settings-core.test.js`;
  `out/studio-settings-check.mjs` +6 (Choose… with a wrong folder → inline error and nothing written, an engine saved,
  "chosen folder" + ↺, ↺ back to auto).
- **WSL projects outside the engine (2026-10-16, JOURNEYS findings 2/4/6/9).** A `\\wsl.localhost\<distro>\…` project
  now uses the Engine folder too (it used to assume the project was the engine): a WSL engine in the same distro runs
  `node '<engine>/runner/cli.js'` with cwd + `GFX_PROJECT` = the project; an engine checkout opened as a project still
  runs itself; a Windows engine or another distro is refused with a readable message (Settings → Engine & tools →
  Engine folder inside that distro). On open the studio writes `.gfx/engine.json` (where the engine is, for Claude in
  shells without `gfx` on PATH) and refreshes an outdated managed CLAUDE.md block (`gfx init --refresh --no-skills`;
  plain `gfx init --refresh` = also the skill sync when the engine's skills changed, FOUNDATION.md "Managed skills").
  The Versions panel shows the engine's real error (node's `Error: …` line, e.g. "Cannot find module …") and says
  "engine update" only when the engine answered with its usage (no `version` command). Details: FOUNDATION.md note
  "WSL projects outside the engine".
- **Not verified in the exe:** a drop from a real Explorer drag by hand (only the CDP-simulated OS drag), Reveal in
  Explorer, Locate…, the system-default / custom editor, Download ffmpeg / Install
  pinned browser from the strip.

## About page (2026-10-17)
- **Rows.** Version · **Licence** (gfx is MIT; "MIT licence" opens the text) · **Licenses and credits** · App folder.
- **Credits** are data in `apps/studio/web/src/about.js` (`CREDITS`: groups Part of the app / Fonts / Sounds /
  Downloaded when you ask; each part has a name, what it is used for, its licence, a home page and optionally a
  licence file). One 32px row per part (single line, ellipsis); a name opens its home page in the system browser
  (`open_link`; only URLs listed in `CREDITS`). "All notices" opens `THIRD_PARTY_NOTICES.md`, which stays the full list
  with versions and copyright lines: keep both in step when a dependency is added.
- **Licence viewer.** A modal over Settings that loads `./licenses/<file>` (only the listed names): `.txt` as
  monospace text, `.md` through a small escaped markdown renderer (headings, paragraphs, lists, tables, `code`,
  bold). Esc closes the viewer first (`dlg.licence`); a second Esc leaves Settings.
- **Files.** `public/licenses/` holds the font licences; the build adds the repo's `LICENSE` as `LICENSE-gfx.txt` and
  `THIRD_PARTY_NOTICES.md` (`licenceAssets` in vite.config.js; the dev server serves the same names).
- **Checks.** `out/about-check.mjs <dev-url>` (rows, every licence file loads, Esc order, link opener);
  `scripts/check-pixel-grid.mjs --settings` covers the page (row lines are inset shadows so the 24px buttons sit on
  whole pixels).
