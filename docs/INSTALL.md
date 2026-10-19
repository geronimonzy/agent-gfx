# Installing gfx studio: installers, engines, building from source

Decisions (user, 2026-10-17): Windows-first; **WSL is first-class** (many users keep their agent projects in WSL), so
engines and projects work in WSL paths as well as on Windows. NSIS per-user installers, unsigned for now. Sounds are
not bundled (downloaded on use). "Add gfx to PATH" is off by default and marked recommended. Git and the coding agent
(Claude Code, Codex, pi, …) are not bundled; the app says they are needed. Building from a git clone stays supported.

## 1. Two installers, one app

| Installer | Contains |
|---|---|
| `gfx-studio-<ver>-windows-setup.exe` | the app + the **Windows engine** (`<app>\engine\`: engine files, `node\node.exe`, Windows `node_modules`) |
| `gfx-studio-<ver>-wsl-setup.exe` | the app + the **WSL engine bundle** (`<app>\engine-wsl.tar.gz`: engine files, a Linux `node`, Linux `node_modules`), installed into a distro by the app (§3) |

- Both install the same app (same identifier and per-user folder, `%LOCALAPPDATA%\Programs\gfx studio`). Running the other
  installer later keeps the app and adds its engine; a newer installer also updates the app.
- **Versions match:** the app and its engines carry one version. An engine older than the app shows "update" in Settings →
  Engine & tools: the Windows engine by running the matching Windows installer, a WSL engine with **Update** (§3).
- Not bundled: ffmpeg (GPL; pinned + SHA-256-verified download, Settings → Engine & tools), the pinned render browser
  (optional), the CLAP model (downloaded on first sound index), the Kenney sounds (`gfx lib fetch kenney`, offered on use),
  git, the agent CLI.
- Installer pages: licence (MIT) → folder → "Add gfx to PATH (recommended)" (unchecked) → install. Windows: adds
  `<app>\engine\bin` to the user PATH. WSL: the app adds `~/.local/bin/gfx` during §3 when the box was ticked.
- WebView2: Microsoft's bootstrapper when missing. Unsigned: README explains SmartScreen's "More info → Run anyway".

## 2. Which engine runs a project

Each project uses the engine of its own environment, so files, file watching and git stay native.

- **Windows project** (`C:\…`): `GFX_ENGINE` → Settings "Engine folder" (developer override; a WSL folder is allowed and
  runs the project through `/mnt/c`, as today) → `<app>\engine\`.
- **WSL project in distro D** (`\\wsl.localhost\D\…`):
  1. the project itself when it is an engine checkout (this repo);
  2. `GFX_ENGINE` / "Engine folder" when it is a WSL folder in D (developer override, today's behaviour);
  3. **D's installed WSL engine** (`engines.json`, below);
  4. else an error: "No gfx engine in WSL D" with **Install WSL engine…** (§3).
  A Windows engine never serves a WSL project (its Vite cannot serve the UNC root).
- **`engines.json`** in the app folder (next to settings.json; machine state, written by §3, not a preference):
  `{ "version": 1, "wsl": { "<distro>": { "path": "/home/<user>/.local/share/gfx/engine", "version": "0.2.0", "installed": "<iso>" } } }`.
- **Settings → Engine & tools → Engine:** one row for the **Windows engine** and one per **WSL engine (D)** found in
  `engines.json` (plus the override when set): path, version (from the engine's `package.json`), status, source
  (installed / chosen folder / GFX_ENGINE / next to the app), and Update / Repair / Remove for WSL engines (§3).
  The Engine folder row stays as the developer override.
- The terminal, `.gfx/engine.json`, the live server and every `engine_run` use the same resolution (one function).

## 3. WSL engine setup (in the app)

The NSIS installer only copies files; the app does the WSL part with progress and readable errors, on first start after
a WSL install and from Settings (Install / Update / Repair / Remove):
1. pick a distro (`wsl.exe -l -q`; default = the default distro);
2. copy `engine-wsl.tar.gz` into the distro and unpack to `~/.local/share/gfx/engine-<ver>`, then switch the
   `~/.local/share/gfx/engine` symlink (atomic update, the old version is removed after the switch);
3. optional `~/.local/bin/gfx` → `engine/bin/gfx` (the PATH box);
4. check inside the distro, each with a fix hint: **Chrome** (system Google Chrome gives Fast mode the GPU; the pinned
   headless shell cannot reach it in WSL; hint: the apt commands to run in the terminal), **git**, an **agent CLI**
   (claude / codex / pi), **ffmpeg** (Download button: `gfx setup ffmpeg`);
5. write `engines.json`; run `gfx doctor` through the new engine.
Remove deletes the versioned folders and the symlink after confirmation. The uninstaller leaves WSL engines alone (an
NSIS hook can't tell a full uninstall from the old-version uninstall an upgrade runs); Settings → Remove does it.

### 3a. Detailed design (step 3)
- **Bundle location:** `<exe dir>\engine-wsl.tar.gz` (the WSL installer's resource); `GFX_WSL_BUNDLE` overrides it (dev:
  `out/installer/engine-wsl.tar.gz`). Its version = the app version (they ship together).
- **Distros** (Rust `wsl_distros`): `wsl.exe -l -v` with `WSL_UTF8=1` (older WSL prints UTF-16LE: decode both); rows
  `{ name, default, state, version }`; only WSL 2 distros are offered (WSL 1 has no `/dev/dxg` GPU path, still allowed
  with a note). Docker's `docker-desktop*` distros are hidden.
- **Install / Update / Repair** (one Rust job `wsl_engine_setup { distro, linkPath }`, progress events like `engine_run`,
  cancellable): stream the tarball through **stdin** into
  `wsl.exe -d D -- bash -lc 'set -e; b="$HOME/.local/share/gfx"; v=<ver>; t="$b/engine-$v.tmp"; rm -rf "$t"; mkdir -p "$t";
  tar -xz -C "$t"; rm -rf "$b/engine-$v"; mv "$t" "$b/engine-$v"; ln -sfn "engine-$v" "$b/engine"; for o in "$b"/engine-*;
  do [ "$o" = "$b/engine-$v" ] || rm -rf "$o"; done; echo "HOME=$HOME"'` (no dependency on `/mnt/c` automount; the old
  version keeps working until the symlink switch). `linkPath`: `mkdir -p ~/.local/bin && ln -sfn ../share/gfx/engine/bin/gfx
  ~/.local/bin/gfx` (and a note when `~/.local/bin` is not on the login PATH). Then `engines.json`
  `wsl[D] = { path: "<HOME>/.local/share/gfx/engine", version, installed }` and `doctor --json` through it.
- **Checks** (after install, and on Settings → Engine & tools): one `wsl.exe -d D -- bash -lc` running
  `command -v google-chrome google-chrome-stable chromium chromium-browser git claude codex pi; test -e /dev/dxg` plus the
  engine's doctor (ffmpeg). Shown as rows with a status and a fix: Chrome → the commands to copy
  (`wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install -y ./google-chrome-stable_current_amd64.deb`),
  "Open terminal" opens the studio terminal in that distro; git → `sudo apt install -y git`; agent CLI → links to Claude
  Code / Codex / pi install pages (any one is enough); ffmpeg → the existing Download button (`gfx setup ffmpeg`).
- **Remove:** confirm, then `rm -rf ~/.local/share/gfx/engine ~/.local/share/gfx/engine-*` and `~/.local/bin/gfx` only when it
  links into that engine; drop `wsl[D]` from `engines.json`. Never touches `~/.local/share/gfx/library` or `bin`.
- **Windows PATH** (`set_windows_path(add)`, the Windows engine only): HKCU\Environment `Path` (keeps its type, REG_SZ
  or REG_EXPAND_SZ; a new value is REG_EXPAND_SZ) gets or loses `<exe dir>\engine\bin`, exact-entry match
  (case-insensitive, trailing `\` ignored), other entries untouched, no length limit; then broadcast
  `WM_SETTINGCHANGE "Environment"`. Read back for the checkbox state. The choice is recorded as the marker file
  `windows-path` next to settings.json (`%APPDATA%\<identifier>\`).
  - **Install/uninstall (added 2026-10-18, found in the install test):** an upgrade runs the old uninstaller without any
    flag that tells it apart from a full uninstall, so `installer/hooks.nsh` calls the app: PREUNINSTALL
    `gfx-studio.exe --path-hook uninstall "$APPDATA\<identifier>"` always removes the entry; POSTINSTALL `--path-hook
    install …` adds it back when the marker exists and the Windows engine is there. Upgrade = entry kept; full uninstall =
    entry gone (and the marker with the app data when "Delete the application data" is ticked; otherwise a reinstall
    restores it). Opening the Engine page also restores a recorded entry that went missing (e.g. an uninstall cancelled
    after the hook ran).
  - **Windows engine reached from WSL:** WSL appends the Windows PATH, so `gfx` inside a distro can find
    `<app>\engine\bin\gfx` (a Windows build: vite fails with "Cannot find native binding"). `bin/gfx` detects
    `node/node.exe` under Linux and hands over to `~/.local/share/gfx/engine/bin/gfx`, or explains how to install the WSL
    engine. With the WSL PATH link, `~/.local/bin` comes first anyway.
- **UI:**
  - Settings → Engine & tools → Engines: per WSL row **Update** (version ≠ app), **Repair**, **Remove**; below the table
    **Install WSL engine…** (shown when the bundle exists); the Windows row gets the **Add gfx to PATH (recommended)**
    checkbox (unchecked by default; shown when `<exe dir>\engine\` exists).
  - The **WSL engine dialog** (modal, like the others; whole-pixel rules): distro select (default marked), the checkbox
    "Add gfx to PATH in WSL (recommended)" unchecked, Install; then a progress bar + the step lines; then the checks list
    with fixes; Close. Errors show the failing step and the command's last lines.
  - Welcome window: when the bundle exists and `engines.json` has no WSL engine, a card "Set up the WSL engine" (opens
    the dialog; "Not now" hides it for this app version).
- **New project into a WSL folder** uses that distro's engine for `gfx init` (`no_project` commands with a WSL target dir
  resolve the engine like a WSL project root), and the template list reads that engine when the chosen folder is in WSL.
- **Dev shim:** the same ops for browser tests on Linux: "distros" = one fake distro `Dev` whose home is a temp folder;
  install unpacks the tarball there (`tar`), so the dialog and table are testable without Windows.
- **Tests:** Rust unit tests for distro-list parsing (UTF-8 and UTF-16LE samples, default marker, docker hidden), the
  setup/remove command strings, PATH edit logic (pure function over the string), engines.json write/merge;
  an E2E check `out/studio-wslsetup-check.mjs` against the dev shim (dialog, install, table row, Update shown on version
  mismatch, Remove).

## 4. Building from source

- **Use a clone as the engine** (what the developer setup does): `git clone`, `npm install` (in WSL or on Windows), then
  either run the CLI (`bin/gfx`, README quick start) or point a released app at it (Settings → Engine folder).
- **Build the installers:** `npm run build:installer -- windows|wsl` (needs Rust + MSVC build tools on Windows, Node).
  It builds the web UI, assembles the engine bundle (`npm ci --omit=dev` for the target OS; drops other platforms'
  onnxruntime binaries and `sharp`), and runs the Tauri NSIS bundle with that resource set.
- `apps/studio/scripts/build-win.sh` stays as the developer's quick rebuild of the exe (no installer).
- No CI builds for now (user, 2026-10-17): installers are built locally with this script and attached to releases by hand.

## 5. Build order
1. §2 routing + the Engine rows in Settings (no installer yet; `engines.json` can be written by hand for testing).
2. §4 engine bundles + both NSIS installers.
3. §3 WSL setup in the app.
Then the agent-neutral round (AGENTS.md next to CLAUDE.md, "Agent" labels with Claude / Codex / pi presets).

## As built
- **Step 1 (2026-10-17): routing + Engines table.** `src-tauri/src/engines.rs` (parse `engines.json` tolerantly: only
  absolute Linux paths without `..`; distro names case-insensitive; `engine_version` from `package.json`).
  `lib.rs` `wsl_project_engine(…, installed)`: own checkout → override in the same distro → installed engine → error
  naming both fixes; `engines_info` command (`EngineRow`: kind default | wsl, distro, path, version, found, source, wsl,
  error), `wsl_unc`, `wsl_engine_rows`. Settings → Engine & tools: "Engines" table (shared `.sp-table` with About;
  "Windows projects" row, one row per WSL engine, or "no engine installed yet"); the old Engine status row is gone
  (the Engine folder row stays as the override). Dev shim twin reads `engines.json` next to its settings file.
  Tests: Rust +3 (71); `out/studio-settings-check.mjs` engine assertion moved to the table; `out/engines-shot.mjs`.
  Not yet: the app version and the engine version are numbered separately (0.1.0 / 0.2.0); unify them with the
  installer (§1 "versions match"). `gfx init` for a new project in a WSL folder and the template list still use the default
  engine (same templates; `.gfx/engine.json` is rewritten for the WSL engine on open): route them per distro in step 3.
- **Step 2 (2026-10-17): bundles + installers.** `apps/studio/scripts/build-engine.mjs windows|wsl` (engine files, pinned
  Node 24.22.0 with SHA-256 check, `npm ci --omit=dev --os --cpu --ignore-scripts`, pruned: other platforms' / CUDA /
  TensorRT onnxruntime binaries, onnxruntime-web, sharp replaced by a stub so LGPL libvips is not shipped). Sizes:
  Windows engine 275 MB, WSL engine 286 MB (86 MB packed). `apps/studio/scripts/build-installer.sh windows|wsl`
  (`npm run build:installer`; Tauri CLI `cargo install tauri-cli`; builds in `C:\Users\<you>\dev\gfx-installer-build`):
  windows installer 68 MB, wsl installer 96 MB; `GFX_INSTALLER_TEST=1` = a separate "gfx studio test" app.
  `installer/hooks.nsh` removes either engine on uninstall. WSL engine commands use `<engine>/node/node` when present.
  **Install test (user-approved, test identity):** silent Windows install (app + engine + Start menu) → engine doctor OK
  → the user checked the test app (welcome strip, Engines table "next to the app", About 0.2.0 / 0.2.0) → WSL installer
  over it (same version): Windows engine kept complete, engine-wsl.tar.gz added → silent uninstall removed everything
  incl. the other installer's engine. A silent uninstall keeps the app's data folders (Tauri: only on request).
  Smoke tests: `out/test-engine-wsl.sh`, `out/test-engine-windows.sh` (init, doctor, still, audio, CLAP search).
  Upgrade + GUI pages: tested 2026-10-18, see "Install test 2" at the end.
- **Step 3 (2026-10-17): WSL setup in the app.** `src-tauri/src/engines.rs` owns UTF-8/UTF-16LE distro parsing,
  the quoted §3a install/remove/check scripts, checks decoding, case-insensitive engines.json merges and exact-entry
  PATH edits. `lib.rs` adds `wsl_distros`, `wsl_bundle_info`, `wsl_engine_setup`, `wsl_engine_checks`,
  `wsl_engine_remove`, `windows_path_state`, `set_windows_path`; all seven are registered in build.rs, the invoke
  handler and both main/welcome capabilities. Setup streams the archive from a file into WSL stdin, reuses
  `engine://<jobId>` events and `engine_cancel`, and keeps one cancellation token across unpack/register/doctor.
  WSL mutations are serialized; corrupt engines.json is reported instead of discarding other distros. Writes use a
  temporary file and rename. Missing doctor prerequisites leave the engine installed and appear in the checks.
  Windows PATH uses direct Win32 registry calls (REG_EXPAND_SZ, no additional Rust crate), then broadcasts
  WM_SETTINGCHANGE / Environment; it never edits the process or system PATH.
  - **UI:** Settings → Engine & tools → Engines offers Update (either recorded or package version mismatches the
    app), Repair, Checks, confirmed Remove; Update/Repair are disabled without the bundle. Install is shown only
    when the bundle exists. The Windows row has the user-PATH checkbox when the bundled Windows engine exists.
    `web/src/wslsetup.js` / `.css`: distro (default marked; WSL 1 allowed with a GPU note), opt-in PATH link,
    progress and step lines, cancellation, last 12 output lines and the failing step, then Chrome/GPU/git/agent/
    ffmpeg/login-PATH checks with copy buttons and install links. ffmpeg Download runs `setup ffmpeg` on that
    distro's installed engine (`engine_run`'s optional no-project `distro`). Modal origin is rounded on opening;
    Esc is `dlg.wslsetup` before `dlg.settings`, with focus return and a Tab loop. Closing is disabled during jobs.
  - **Welcome:** the setup card appears with a bundle and no installed WSL engine. Not now is stored in localStorage
    as `gfx.wsl-setup.dismiss.<bundle app version>`; a new app version offers it again. `list_templates(folder?)`
    and no-project `init <target>` resolve the target distro with the same routing as WSL projects. The welcome
    form reloads templates for its chosen folder and validates the selection before init; when the default engine
    is missing it offers Choose project folder so a WSL-only install can reach its distro's templates.
  - **Dev twin:** `web/vite.config.js` wires every new op through `web/wsl-shim.js`. Dev (default, WSL 2) has a
    temporary home; setup streams the real tarball into tar, switches the symlink, writes engines.json next to the
    shim settings file, and runs doctor. A restarted shim recovers its owned home from that registration. Checks
    use local command lookup and doctor; remove preserves the library and unrelated CLI symlinks. Windows PATH
    is an in-memory string. The twin takes its app version from tauri.conf.json, independently of the pre-existing
    settings_meta dev version.
  - **Tests:** six new Rust tests cover distro encodings/default/docker filtering, scripts/quoting, PATH identity/
    order/long strings, merges, actual save/merge/corrupt-file preservation, and checks decoding. The existing engine
    row test also checks recorded-version Update. `out/studio-wslsetup-check.mjs` uses the 5177 server via the
    E2E wrapper: install/checks/table/version/Update/Repair/declined+accepted Remove, owned-link/library safeguards,
    and cleanup/restore. `web/wsl-shim.test.js` is a tiny local-archive integration test without sockets/downloads.
    Local gates: token check 0, token tests, all 11 studio unit groups, production Vite build and E2E syntax check.
    The extra shim integration could not spawn tar in the sandbox (EPERM); Rust, Chrome geometry/E2E, real WSL
    stdin/cancel/upgrade/remove, registry/broadcast and actual installer verification remain for the orchestrator.
  - **Clarifications/deviations:** no Open terminal button: today's terminal module only opens in the project,
    not an arbitrary distro, so the dialog displays copyable commands as allowed by §3a. Both WSL 2 and WSL 1
    remain selectable (the spec explicitly allows WSL 1 with a note). The required install script is copied as
    specified, including its same-version removal before replacement: Repair is therefore not atomic against a
    concurrently running engine of that same version. Cross-version updates keep the old target until the switch.
    The uninstaller and library are unchanged. No npm dependencies or registry crate were added.
- **Install test 2 (2026-10-18, with the user, test identity, GUI installers):** windows 0.1.9 (`GFX_VERSION=0.1.9`) →
  Settings PATH box → `where gfx` / `gfx doctor` in a new cmd OK (registry: exactly one entry appended) → upgrade to
  0.2.0 (Tauri's "Already installed: uninstall before installing" page; one uninstall entry, version 0.2.0, one Start
  menu shortcut, PATH entry kept) → wsl 0.2.0 over it (add component) → welcome card → WSL setup into Ubuntu with the
  PATH link (all checks found; `~/.local/bin/gfx` first) → a Windows and a WSL project side by side, `gfx doctor` in
  each terminal shows its own engine → WSL Remove (confirm waited; link removed, projects kept) → GUI uninstall.
  Findings, fixed: the uninstall left the PATH entry (now the path hooks, §3), the PATH value turned from REG_SZ into
  REG_EXPAND_SZ (type kept now), the Windows `gfx` broke inside WSL (hands over now), the setup dialog after success
  (progress block hidden, Close is the main button), the installer used NSIS's icon (`installerIcon`).
