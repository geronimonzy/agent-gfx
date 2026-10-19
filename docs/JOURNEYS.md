# gfx studio — real-app journeys

How to use this: each journey is a click-by-click list for the Windows exe (`gfx-studio.exe`), using only what is
visible on screen. A journey is ticked (`Verified in real app: <date> by user`) only after a person has clicked it
through in the real exe, not in the dev shim or Linux Chrome. If a step fails or is unclear, write it down as an issue
with the journey number and step. Steps marked **[dev shim only]** have only been tested in the Linux Chrome dev shim
(`npm run studio:dev`) or with a mock, never in the real exe, according to CLAUDE.md. Button names are taken from the
source; if the label on screen differs, fix this file. Last updated 2026-10-15, revision `a35c50f`.

## 1. First launch and setup (ffmpeg, browser)

Status: Partly verified in the real app 2026-10-16 (welcome window, engine folder; see findings 1-4). Not run: ffmpeg/browser download buttons

1. Start `gfx-studio.exe`. Only the welcome window opens (about 960×620). With no recent projects and no folders, the
   right side shows the templates as big cards ("What will you make?"). [dev shim only: welcome.html]
2. Read the status strip at the bottom: **Engine** · **ffmpeg** · **Browser** · **T3**, each with a dot. While it
   checks, it says "checking…". [dev shim only]
3. If ffmpeg is missing, click **Download ffmpeg** in the strip. A small progress bar and label show the download.
   [dev shim only]
4. If the strip offers it, click **Install pinned browser** (a fixed Chrome build for reproducible renders).
   [dev shim only]
5. When the dots are green, continue with journey 2. If a download fails, check that the strip shows the error and a
   **Retry download** / **Retry install** button.
6. Close the welcome window with no project open: the app quits.

## 2. Create a project

Status: Partly verified in the real app 2026-10-16 (new project in \\wsl.localhost\Ubuntu\home\<you>\gfx-projects, first scene; findings 1-4)

1. In the welcome window click **New project** (or, on first run, a template card directly). [dev shim only]
2. Click a template card (Blank or Reel 9:16). The pane slides to the name step; the name field has the focus.
3. Type a name. Check the Location is the default projects folder (Settings → General) and the line under it shows
   the final folder ("Creates …\my-project"). **Browse…** picks another location.
4. Click **Create project** (or press `Enter`). The pane shows `gfx init` progress, then the main window opens with the
   project and the welcome window closes. **Back** (or `Esc`) goes one step back before you create.
5. Press `Ctrl+Shift+O` (or click the project button in the top bar). The welcome window lists the new project first
   under **Recent**.
6. Check the scene list: the Reel template has one scene you can open.

## 3. Open an existing project

Status: Partly verified in the real app 2026-10-16 (Recent list, open folder, worktree mapping to the parent T3 project, scene list refresh; findings 3-4)

1. In the welcome window click **Open folder…** and choose a folder that has `gfx.json` (for example a project made
   with **New project**). The main window opens with it. [dev shim only]
2. Check that the scene picker in the top bar lists the project's scenes. Pick a scene: the video loads and the
   timeline shows stems and cues.
3. Close the app and start it again. The project is in **Recent** (name, path, scene count, "… ago", thumbnail if the
   first scene has a sheet or still). Click the row once: the project opens.
4. Pin a project (pin icon on hover): it stays at the top. Use **⋯ → Reveal in Explorer** and **⋯ → Remove from list**.
5. Open folder… on a folder that contains projects: it is added under **Folders** with the projects inside it. Open
   folder… on an empty or unrelated folder: "No gfx project here" with **Make it a project** and **Choose another**.
6. Drag a folder from Explorer onto the welcome window: same as Open folder. (WebView2 hands the app the real path.)
7. Rename a recent project's folder in Explorer, then reopen the welcome window: the row is greyed with "Folder not
   found"; **Locate…** points it at the new folder, **Remove** drops it.
8. With a project open, use the welcome window to open another one: the main window switches (it asks first if there
   are unsaved edits) and the welcome window closes.

## 4. Live view and tweak an element

Status: Partly verified in the real app 2026-10-16 (Live server for a WSL project, select/move/tweak, Live error recovery; findings 4, 12-15, 19)

1. Open a scene and press `L` (or click the Live button). The badge on the picture changes from RENDERED to LIVE.
   The studio starts the live server if none runs. [dev shim only]
2. Press `V` for the Select tool. Hover the picture: named elements get an outline.
3. Click an element. The inspector shows x, y, scale, rotate, opacity.
4. Drag the element, drag a corner to scale, drag the top knob to rotate. Press `Ctrl+Z` once per drag to undo.
5. Open the **Changes** tab and check the tweak is listed. Press `Ctrl+S` to save the draft.
6. Press `Esc` to deselect, then `L` again to leave Live.

## 5. Review the video and leave comments with drawing

Status: Partly verified in the real app 2026-10-16 (comments with drawing; findings 18, 26)

1. Press `Space` to play. Check the picture and the sound move together; use `←` / `→` to step one frame.
2. Pause on a frame and use the comment tool to click a spot on the picture. A comment box opens.
3. Draw on the picture (arrow or freehand), then press `Enter` to finish the drawing.
4. Type the comment and press `Enter` to save it. A pin appears in the notes lane.
5. Attach an image by drag or paste into the comment (the Windows drag-drop handler is off for the panel layout fix;
   check this still works). [dev shim only]
6. Close and reopen the project. Check the comment is still there (comments autosave).

## 6. Ask Claude or Send to T3, Claude edits, live reload

Status: Partly verified in the real app 2026-10-16 (Ask Claude, Send to T3, live reload of Claude's change; findings 1, 5, 6, 8, 20)

1. Select an element or open a comment and click **Ask Claude** (or press `Ctrl+Enter` in the composer).
2. Read the brief in the composer. Type what you want, for example "make the total bigger".
3. Click **Terminal** to paste it into the Claude terminal, or **T3** to send it to a T3 thread (needs journey 7). Both
   are [dev shim only]. Check a "Before asking Claude" version appears in the Versions panel.
4. Wait for Claude to edit the scene. Check the picture reloads by itself and a "changed by Claude" pulse shows.
5. If you do not like it, open **Versions** and click **Undo Claude's change** on the newest "Before asking Claude" entry.

## 7. Connect T3

Status: Partly verified in the real app 2026-10-16 (connect with pairing code, Full access, threads panel, + New thread; findings 1, 5, 7)

1. Click the **T3** button in the top bar. The T3 panel opens with a Connect action. [dev shim only; real T3 only
   showed its pairing screen]
2. Read the access levels, pick one, and click **Connect**.
3. In the T3 view enter the pairing code if asked and approve.
4. Check the panel lists threads for this project (**This project**) and **All in folder**.
5. If the panel says "Add this folder in T3", add the shown WSL path in T3 (use **Copy**).
6. Click **New thread**, give it a title, and check it opens in the panel. Open **Settings → T3** (⚙ or `Ctrl+,`),
   click **Disconnect** and check no token is shown anywhere.

## 8. Render dialog, queue, open the file

Status: Partly verified in the real app 2026-10-16 (render from the app for the WSL project, queue; finding 17)

1. Press `Ctrl+R` or click **Render**. The Setup tab opens as a tab in the side group. [dev shim only]
2. Choose a preset (for example 1080p), the format (mp4), quality, and Speed (Fast or Exact). Tick audio for mp4.
3. Click the render button. The **Queue** tab shows progress, ETA, and the renderer line ("GPU · name" or "software").
4. Start a second render. Check it waits as "queued". Cancel it.
5. When the first finishes, click **Reveal** (shows in Explorer) and **Open** (plays in the default player).
   [dev shim only]
6. Open the **Renders** tab and check the file is listed.

## 9. Sound: stems and cues edits, then apply

Status: not run in the real app

1. In Review mode click a cue marker in a stem lane. The inspector shows sound, gain, pitch, mute.
2. Drag the marker to move it (hold `Alt` to skip frame snapping). Change gain with the slider.
3. Press `A` to toggle Original and Draft and listen to the difference.
4. Move a stem volume slider in a lane header, then press `Ctrl+S`. The lane volume is saved into the draft.
5. Close the studio. In the project terminal run `gfx apply <scene>` (a version is saved first), or ask Claude to.
6. Reopen the scene and check the cues changed in `sound.json`.

## 10. Perform take with the microphone (removed 2026-10-19)

Perform was removed from the studio before the open-source release; nothing to check.

## 11. Code mode: element and code

Status: Partly verified in the real app 2026-10-16 (Open code, simpler inspector, editable actual values; docs/INSPECTOR.md, findings 17-18)

1. Click **Code** in the mode switch. Live turns on and the file tree opens. [dev shim only]
2. Open `scenes/<name>/scene.js` from the **Project** tree.
3. Click an element in the picture. The refs panel lists where it is named and animated; click a ref to jump to the
   line.
4. Click a line in the editor. Dashed outlines show which elements that line animates.
5. Edit a value and press `Ctrl+S`. Check the picture reloads. Introduce a typo and check a red chip and the inline
   error line appear.
6. Click **VS Code** link on a ref and check it opens the file in VS Code (WSL paths included). [dev shim only]

## 12. Versions: save, diff, restore

Status: Partly verified in the real app 2026-10-16 (Versions, Undo Claude's change; findings 9, 12)

1. Open the **Versions** tab (or the history button in the top bar).
2. Type a note and press `Enter` in the save box. A new entry with a thumbnail appears.
3. Change something in the scene, then click the new entry's **Compare with now**.
4. Open an older entry. Click a file for its diff.
5. Click **Restore version**, confirm, and check the scene returns to that state. A new automatic entry is saved first.
6. In the engine repo itself, check the panel shows an "engine repo" badge and no Save or Restore buttons.

## 13. Layout: docking, pop-out, scale

Status: Verified in real app: 2026-10-15 by user (panel drag/dock, Panels menu, per-mode layouts, UI zoom, pop-out,
closing the main window closes pop-outs). Not yet verified: the T3 panel inside a pop-out, and Reset layout.

1. Drag a panel header onto another group to dock it; drag a tab out to a new place.
2. Click **Panels**. Tick and untick panels, and try **Show all headers**.
3. Switch Review and Code. Check each keeps its own layout, and restart the app to check they come back.
4. Click **Pop out** for the active panel. A new window opens; press `Space` there and check the transport reacts.
5. Use UI scale − / % / + in the Panels menu, and `Ctrl+=` / `Ctrl+-` / `Ctrl+0`; check Settings → Appearance → UI scale
   shows the same value. Set a single panel's scale from its menu.
6. Close the main window and check the pop-outs close with it.
7. Click **Reset layout** and check the current mode returns to its default.

## 14. Shortcuts help

Status: not run in the real app

1. Press `?` or click the `?` button in the top bar. The help overlay opens.
2. Type in its search box to filter by key or action.
3. Close it with `Esc`.
4. Click into a text field and press `?`. Check it types a question mark and does not open help.
5. Open the terminal with `` Ctrl+` `` and check normal typing keys go to the terminal, not to the studio.

## 15. Settings round trip

Status: Partly verified in the real app 2026-10-16 (Engine folder setting, First take; findings 2, 4)

1. In a project, switch to Code mode and arrange a panel. Click ⚙ (or press `Ctrl+,`). The Settings page replaces the
   workspace; the header says "Settings / General".
2. Press `/` (or `Ctrl+F`) and type "workers". Press `Enter`: the page jumps to Rendering → Workers, scrolls it into view
   and pulses it.
3. The scope sentence says "Applying to **<project>**". Set **Default mode** to Exact. Check the ↺ and the filled marker
   appear; click the marker: Project ✓ · This computer · Default. Open the project's `gfx.json`: it has
   `"settings": { "renderMode": "exact" }` and every other line is as before.
4. Switch the scope to "All projects (this computer)". The row shows this computer's value (Fast). Change Workers to
   4: `%APPDATA%\dev.gfx.studio\settings.json` gets `"renderWorkers": 4`.
5. Back on the project scope, click ↺ on Default mode: the override is gone from `gfx.json`.
6. Type `renders` into Output folder and press `Enter`: an inline error says it must be inside `out/`; nothing is saved.
7. Appearance → UI scale 125 %: the window scales at once. Set it back to 100 %.
8. Click into a text field and press `Esc`: only the field is left. Press `Esc` again (or **← Back**): you are back in
   Code mode with the same panels, sizes and pop-outs, without a flash of another screen.
9. Close and restart the app: the settings are kept.

## Walkthrough findings (gfx side)

Index: open = 24 (idea), plus 16 left as is; everything else is fixed or built (11 works as intended).

Found in the real exe (2026-10-16). T3 fork issues are listed separately in
docs/T3.md §6 "T3 fork findings".

1. **+ New thread fails when the T3 project has no default model** (2026-10-16, test-project-1). T3 answers
   `Pass modelSelection: the project has no default model`, because an MCP client has no caller thread to inherit a model
   from. The mock did not require a model. Plan: after the fork ships `/new?project=` (T3 finding 3), + New thread opens
   T3's own draft in the view. Until then, pass the model of the project's most recent thread, else
   `claudeAgent` / `claude-opus-5-5`.
   **Fixed in 51dd4fa + 7ae132b:** without a project default model gfx passes `modelSelection` from the latest thread (this worktree's first), else `claudeAgent` / `claude-opus-5-5`; the mock enforces T3's rule. The full fix (T3's own draft via `/new?project=`) waits for T3 fork finding 3.
2. **Claude in a T3 thread can't find the engine** (2026-10-16, test-project-1). `gfx` is not on PATH in a T3 thread (only
   terminals opened by gfx studio get it, and not even those with a WSL engine), and the project knows only
   `"engine": ">=0.2"`. Claude searched the disk, found two candidate engines (main checkout and the dev engine checkout), and
   picked one by date. The project CLAUDE.md template says "Terminals opened by gfx studio have `gfx` on PATH", which
   is not true for T3 threads. Needed: a machine-local record of the engine path that Claude can read (for example a
   gitignored `.gfx/engine` written by gfx init / the studio, mentioned in the managed CLAUDE.md block), or `gfx` on PATH
   for T3's shell.
   **Fixed in 51dd4fa + 7ae132b:** machine-local `.gfx/engine.json` (`engine`, `bin`, `node`, `wsl?`) written by `gfx init` /
   `--refresh` and by the studio on open (`.gfx/` gitignored); the managed block says to use it and never search the
   disk; the studio refreshes an outdated block on open (`gfx init --refresh --no-skills`); WSL terminals get the
   engine's `bin` on PATH (FOUNDATION.md note).
3. **Fixed in 51dd4fa + 7ae132b: ↻ and window focus refresh the scene list, reopening the open project from welcome refreshes it, a vanished open scene shows the empty state (out/studio-scenes-check.mjs). A scene made outside the app never shows up in the scene picker** (2026-10-16, test-project-1). Claude made
   `scenes/hello-gfx` from a T3 thread and rendered it; the picker kept saying "No scenes". `refreshScenes()`
   (`web/src/main.js:69`) runs only when a project opens, after a Versions restore, and after a render started from the
   app. The ↻ next to the project name is "Reload scene from disk" and does nothing while no scene is selected
   (`main.js:325`). Nothing watches `scenes/`. Reopening the same project from the welcome window is a no-op too
   (`openFromWelcome`, `main.js:205`: same root = accepted, nothing reloads). Workaround: open another project, then this one
   again (or restart the app). Needed: refresh the
   list on ↻ (and/or on window focus or a `scenes/` change), so a scene Claude adds appears without reopening.
4. **No engine command works for a WSL project that isn't the engine itself** (2026-10-16, test-project-1, launch blocker).
   Live failed with "the live server exited right after starting". For a WSL root, `spec_for` (`src-tauri/src/lib.rs:905-908`)
   skips `locate_engine()`, and `build_command` (`lib.rs:804-809`) runs `wsl.exe -d <distro> --cd <project> -- bash -lc
   "node runner/cli.js …"`, so the engine is looked up inside the project folder and the Engine folder setting is ignored.
   That only works when the project is itself an engine checkout (the dev engine checkout), which is why every earlier check passed.
   It affects Live, Render and every other `engine_run` with a project. A Windows-folder project with a WSL engine
   takes the other path (`build_wsl_engine_command`) and was verified in the spike. Needed: for a WSL project, run the
   located engine's `runner/cli.js` by its WSL path (the engine must be in the same distro; otherwise say so), with
   `GFX_PROJECT` set, and add a Rust test plus an E2E case with a project outside the engine. Confirmed: the same `serve`
   started by hand in WSL (`node <engine>/runner/cli.js serve --port 5199` in the project) works, and Live attached to it
   (the WSL root matching in `normalize_server_root` is fine).
   **Fixed in 51dd4fa + 7ae132b:** a WSL project runs the located engine (same distro) by its Linux path with cwd +
   `GFX_PROJECT` = the project (`wsl_project_engine` / `build_wsl_engine_command`); an engine checkout still runs itself;
   a Windows engine or another distro gets a readable error. Rust `wsl_project_commands`; verified in the spike exe with
   `/tmp/gfx-wsl-fixture` (context, version, still, Live).
5. **Send to T3 into a thread that runs above gfx's access fails with raw JSON** (2026-10-16, test-project-1). gfx was
   connected with Standard (MCP ceiling `auto-accept-edits`); the target thread "Casual greeting" was started in T3 with
   Full access. T3 refuses, by design, to let a caller drive a thread broader than its own mode
   (`resolveRuntimeMode`, `apps/server/src/mcp/OrchestratorMcpService.ts:546-559`), and the toast showed
   `{"_tag":"OrchestratorMcpFailure","code":"runtime_mode_escalation_denied",…}`. Since the user's T3 threads default to
   Full access, Standard can't send to any thread made in T3. Needed: (a) show T3 errors as their `message`, never the
   raw JSON (also seen in finding 1); (b) for `runtime_mode_escalation_denied`, say "This thread runs with Full access;
   gfx has Standard. Change access… or pick another thread", with a Change access… button; (c) if the thread list
   carries the run mode, mark such threads in the Ask Claude target list, with a tooltip that says why (user: the tooltip
   must explain it, e.g. "Runs with Full access; gfx has Standard. Change access… to send here").
   **Fixed in 51dd4fa + 7ae132b:** T3 errors show their message (`t3_call` rejects with `{ message, code }`, never the raw JSON); escalation reads "This thread runs with Full access; gfx has Standard. Change access… to send here, or pick another thread." with a Change access… button in Ask Claude; threads above gfx's level (list `runtimeMode`) are disabled targets / dimmed rows with that reason as tooltip (docs/T3.md As built).
6. **Ask Claude's brief says "gfx context unavailable"** for a WSL project outside the engine: `gfx context` is an engine
   command, so it fails for the same reason as finding 4, and the studio falls back to its own brief. Fixed by finding 4.
   **Fixed in 51dd4fa + 7ae132b:** by finding 4 (`gfx context` exit 0 through the spike exe for a WSL fixture outside the engine).
7. **Change access (and Disconnect) leave the old gfx client in T3** (2026-10-16). After Standard → Full, T3 → Settings →
   Connections listed two "gfx studio" bots (2 and 4 scopes) plus the view's `gfx-1` session. Every Connect / Change access
   / reconnect adds one more. gfx cannot clean up: T3's `/api/auth/clients/revoke` needs `access:write`, and MCP tokens
   have no self-revocation endpoint (T3 fork finding 4). Needed now: after Change access / Disconnect, tell the user to
   remove the old "gfx studio" entry in T3 → Settings → Connections. After the fork change: revoke the old token itself.
   Also label the client with its level (e.g. "gfx studio · Full") so the list is readable.
   **Fixed in 51dd4fa + 7ae132b:** the client registers as "gfx studio · Full" / "· Standard" / "· Read only"; after Change access… and Disconnect a toast says `Remove the old "gfx studio" entry (<level>) in T3 → Settings → Connections.` (revoking it ourselves waits for T3 fork finding 4).
8. **Fixed in 51dd4fa + 7ae132b: reload re-reads draft.json when it changed on disk since load/save: taken if no unsaved edits, confirm otherwise (studio-scenes-check). After Claude applies the draft, the Changes tab still lists it** (2026-10-16). Claude moved the `title` tweak from
   `out/hello-gfx/review/draft.json` into `scenes/hello-gfx/tweaks.json` and emptied the draft on disk. "changed on disk"
   / ↻ / a render reload call `loadScene(name, { keepDraft: true })` (`web/src/main.js:105`, `:325-328`), which keeps the
   in-memory draft, so Changes still shows "title x +73.5 …" and the next Save draft would write it back as pending
   (applied twice). Needed: on reload, re-read draft.json when it changed on disk and the in-memory draft has no unsaved
   edits (ask if it has).
9. **Versions says "not available … Needs gfx version (engine update)"** for a WSL project outside the engine, showing
   `} Node.js v24.22.0` (the tail of node's "Cannot find module" error). The cause is finding 4 (`gfx version` runs
   `node runner/cli.js` in the project). The message is also misleading: it blames the engine version. Needed: show
   the real error, and only say "engine update" when the engine answered without the command.
   **Fixed in 51dd4fa + 7ae132b:** `failureMessage` (versions.js) shows node's `Error: …` line / the engine's error / the last
   meaningful stderr lines; "engine update" only when the engine printed its usage. Also: `cli.js` now drains piped
   stdout before exiting (long `version log --json` output was cut at ~80 KB, leaving this repo's history empty).
10. **The background isn't a layer** (user question, 2026-10-16). Layers lists only named elements (`data-gfx` /
    `ctx.el`); hello-gfx's grid comes from the `dark-grid` style preset (stage CSS), not from a named element, so
    Layers shows only `title`. Open design question: show the preset background as a locked "background" row (select,
    hide, maybe tweak colour), or have the skills name a background element.
    **Fixed in 51dd4fa + 7ae132b:** skills + templates name a full-frame `background` element (`gridSvg` got a `name` option); see CONTRACT.md "Naming elements".
11. **Review video after Claude re-rendered: works as intended** (2026-10-16). Claude rendered at 14:05:57 (`hello-gfx.mp4`),
    after writing tweaks.json at 14:05:18. `loadScene` re-reads the mp4 bytes on every reload (`main.js:121`), and the
    "changed on disk" badge polls the mp4 mtime (`main.js:264`). Likely the reload happened before the render finished
    and the badge's second appearance was missed. Confirmed by the user: the old video until the reload, the new one
    after it. The "changed on disk" badge + ↻ is the intended way to load a new render.
12. **"Undo Claude's change" sits on a "You" version** (2026-10-16, test-project-1, UX). When the project was clean at
    Ask Claude, no "Before asking Claude" checkpoint is saved and the undo target is the current head
    (`beforeAsk`, `web/src/versions.js:184-195`; `latestBac` :225), here "Project created" (You). Correct behaviour,
    confusing look. Proposal: mark that row "You asked Claude here" (or show the undo at the top: "Undo Claude's last
    change → back to Project created, 10 min ago"), so the button isn't read as undoing the user's own version.
    **Fixed in 511f6ff + f6df72a:** the undo target row shows "You asked Claude here · <time>" (the request's message as tooltip; requests now store `at`); on an ordinary version the button reads "Undo Claude's change (back to this)", on a "Before asking Claude" checkpoint it keeps its label; restore unchanged (studio-code-check).
13. **Draft-changed-on-disk dialog is unclear** (2026-10-16). "The draft was changed on disk (Claude?). Load it and drop
    your unsaved draft edits?" with OK / Cancel; the user asked what is expected of them. It appears only when the window
    also has unsaved draft edits (`isDirty()`, `store.js:218`, which also counts stem monitor volume). Proposal: say what
    happened and what each choice does, e.g. "Claude updated this scene's draft (it applied your changes). Load Claude's
    version? Your edits since the last Save draft will be dropped." with Load Claude's version / Keep mine.
    **Bug:** the user changed nothing after Save draft, yet the dialog appeared, so `isDirty()` was true: the in-memory
    draft drifted from the saved one without user action. The dev-shim test of save → disk change → reload passes, so the
    trigger is in the real flow: Save draft (tweak with `z 0`) → Ask Claude → ✈ T3 (Live on) → Claude `gfx apply` writes
    tweaks.json, re-renders and empties draft.json → "changed on disk"/↻. Suspects: Live reload re-committing the tweak
    in a normalized form (e.g. the `z: 0` key dropped or added via `setTweak`, `store.js:186-191`), the Ask Claude path
    touching the draft, or `S.mon` monitor volume. Needed: reproduce in the dev shim with Live on and a tweak containing
    `z: 0`, log `stableJson()` vs `S.savedJson` at reload, fix the drift, add the case to studio-scenes-check.
    **Fixed in 511f6ff + f6df72a:** in-app dialog "Claude updated this scene's draft" listing the unsaved edits, with Load Claude's version / Keep mine (Esc). Root cause of the "bug": no drift; the window really had an unsaved Live move of `title` (x −290.2, y −196 vs saved x 73.5, y 113; one-decimal = a Select-tool drag) made after the last Save draft, proven by the Ask brief in the T3 thread ("Unsaved studio tweaks (not in draft.json yet): title { x −290.2 · y −196 … }", Claude flagged it too); the dev-shim replay (Live, z: 0 tweak, Save, real `gfx apply`, Live reload, ↻) stays clean. Also fixed: `isDirty()` was true with no scene open (`savedJson` '') and counted lane volumes of other scenes' stems that Save draft can't fold (studio-scenes-check).
14. **Rendered-view loop: frame rate drops after a loop or two, slowdown near the end** (2026-10-16, test-project-1
    `orbit`, 8 s at 30 fps). Not the scene: its motion is linear in `t / duration` (the earth is slowest on screen on the
    far side at ~4.6 s, fastest near the end). Cause in the player (`web/src/transport.js`): the muted video follows the
    audio clock with a small lead and rate nudges (`:28-34`). When the video reaches its last frame before the audio
    clock reaches `S.loop.b`, the browser ends and **pauses** the video. The loop wrap (`:26`) calls `seek()` (`:56`),
    which sets `video.currentTime` but never calls `video.play()` again. The drift check then sees the video > 0.2 s
    behind and hard-seeks it every 80 ms, so the picture only advances by seeks (~12 fps). Pause → Play calls
    `video.play()` and fixes it until the next end. Which side reaches the end first depends on drift, hence "after 2
    loops". The stall at the end is likely the same mechanism. Fix: when the engine is playing and the video is
    paused/ended (and t < end), call `video.play()` (in the loop wrap and in the drift check); also wrap the loop slightly
    before the video's end (e.g. at `b - 0.5/fps`) or on the video's `ended` event. Add an E2E case: loop playback for
    3+ cycles, check that `video.paused` is false and frames keep advancing.
    **Fixed in 511f6ff + f6df72a:** the tick restarts a paused (not ended) video while the engine plays (one `play()` at a time), and loops wrap seamlessly on the audio clock (`engine.loopAt` schedules the next pass at b; the video is re-seeked on the wrap); orbit loop 5-8 s: video 28-30 frames/s every cycle, before ~3 frames/s after the first wrap (out/studio-playback-check.mjs).
15. **Live loop: playback looks slower near the end** (2026-10-16, test-project-1 `orbit`, three.js, Live on). Live
    follows the audio clock and drops frames it can't render in time (`web/src/live.js:157-175`: latest `wantT` wins), so
    time can't run slow. The visible slowdown is fewer rendered frames. Likely cause (unverified): the hidden rendered
    video keeps being driven by the transport even in Live (`transport.js` tick has no Live check). Near the end it
    pauses itself (finding 14) and the drift check hard-seeks it every 80 ms, decoding 1080p frames that compete with
    the WebGL scene for GPU/CPU. Needed: measure `request('seek')` round-trip times near the end vs mid-clip, with and
    without the hidden video, to confirm. Fix candidates: pause/detach the video while Live is on (Live doesn't need it),
    plus the finding 14 fix; if seeks are slow by themselves, show the achieved Live fps.
    **Fixed in 511f6ff + f6df72a:** measured (dev shim, headless Chrome, orbit, loop on): Live 24.6 fps mid-clip vs 21.9 in the last second with the hidden video driven (hard-seeked ~3.5×/s after the first wrap), 27.2 / 27.4 without it; plus every wrap held the clock at a for ~330 ms (seek restart = 30 ms lead + output latency, 0.25 s here). Now Live pauses the hidden video (parked on the playhead only at rest, re-synced when Live turns off) and wraps are seamless: 26.8 / 26.4 fps, wrap hold ~45 ms (one frame). Seek round-trip itself is flat (~35-40 ms mid vs end).
16. **Small hiccup at the loop restart in the rendered view** (2026-10-16, after the finding 14 fix). The user: "a small
    hiccup at loop restart, other problems are gone, maybe not worth fixing further". Known minor: the muted video
    re-seeks to the loop start at the wrap (`transport.js`). Leave as is unless it bothers in real use.
17. **Render: "Add to queue" starts the queued render at once** (2026-10-16, user, journey 8). Rendering from the app
    works for the WSL project. Expected: Add to queue only queues; renders start when the user starts the queue (or
    via "Render now"). To decide: a Start queue / Pause queue control, and whether the first item should auto-start.
18. **Comments + drawing need a few tweaks** (2026-10-16, user, journey 5). It works. Wanted:
    - In Live, **Select** is the default tool; **C** adds a comment; **D** draws (today's tool defaults/keys differ:
      check keymap.js / notes.js / draw.js).
    - Don't send both the plain frame and the annotated frame to the model when the annotated one carries the same
      picture: send the annotated image only (saves tokens; see the context-usage note in CLAUDE.md).
    **Fixed in c0b5dd8 + e7bc2bf:** Live opens on Select (also the fallback after Comment/Draw); `C` comment tool, `D` draw tool (draws on the open comment or a new one at the playhead; `D` moved from the `comment` context to `viewer`, no other clash); Ask Claude / Send to T3 send only the annotated frame when a comment has markup (plain frame only without), the T3 text says which, the terminal brief drops the plain `frame:` line of comments with `markup:`.
19. **Live can't be re-entered while Claude has the scene in a broken state** (2026-10-16, test-project-1 `orbit`). The
    user drew a path comment; Claude (T3) started an asteroid-flyby rewrite and left placeholders in scene.js
    (`const GM_SUN = __GM__;`, `AST0 = { x: __X0__, … }`, to be filled by an offline fit). Every run of the scene throws,
    so Live shows the toast "Live view unavailable (__GM__ is not defined); showing the rendered video" and turns off;
    `gfx still` fails too. Not version control. Needed:
    1. The toast/notice names the file, line and error and says the scene has an error (Claude may still be editing),
       with Open code at that line.
    2. Live stays on with an error overlay (like Code mode's error chip/line) and recovers automatically on the next
       successful reload, instead of falling back and turning off.
       **Parts 1-2 fixed in e5ad618 + 87bd7a9:** a scene error no longer turns Live off. The bridge's load error now carries the
       stack (and for location-less SyntaxErrors the bridge finds file:line:col by loading the module as a
       `<script type=module>` probe); `live-error.js` maps it to the project file. Live shows a compact overlay at the
       bottom of the picture ("Scene error · scenes/orbit/scene.js:18 · __GM__ is not defined · **Open code**", "Claude
       may still be editing it"), badge `LIVE · ERROR`, toast with file:line; load errors dim the rendered video, reload
       errors keep the last working scene live underneath. Open code enters Code mode at that line (`code.js
       openCodeAt`; the Code mode error chip/lint line get the file too). The next good reload (the broken bridge page
       reloads itself on a file change) clears it without pressing L; turning Live off clears it and Live stays off.
       out/studio-live-check.mjs (load error, Open code, recover, reload error, syntax error, off stays off).
    3. Skills: never leave scene.js unrunnable between steps. Compute values in a scratch file/script, write scene.js
       only in a runnable state (each save should still `gfx still`).
       **Part 3 fixed in e5ad618 + 87bd7a9:** motion-graphics step 6 "Keep scene.js runnable at every save" (no placeholders or
       undefined names; fits/derived values in a scratch script under `out/<name>/scratch/`, then one runnable write;
       `gfx still <name> --t 0` must pass after each save) + a self-review checklist line. The kind skills defer to it.
20. **Idea: send all open comments to Claude at once** (2026-10-16, user). Today Ask Claude takes one comment or the
    draft changes; the user goes back and forth per comment. Wanted: a "Send all comments to Claude" button (Comments
    tab header; also in the Ask Claude source choices) → one brief with every open comment of the scene (time, element,
    text, annotated image each), sent to the terminal or a T3 thread; Claude resolves them with `gfx review --resolve`.
    **Built in e5ad618 + 87bd7a9:** Comments tab button "Ask Claude about all N open comments" + a "Brief about" choice in the composer;
    one `gfx context --comment <id>…` brief in time order (resolved excluded), terminal or T3 (one image per comment, max 8, rest
    listed by path). See docs/REVIEW.md "As built (finding 20)".
21. **Project skills are stale copies** (2026-10-16). `gfx init` copies the engine's skills into
    `<project>/.claude/skills/`; the studio's refresh runs `gfx init --refresh --no-skills`, so engine skill updates
    (the background layer and `@gfx` marker rules of today) never reach existing projects (test-project-1 differs in 5 of
    6 SKILL.md files). Needed: refresh skills when the engine's are newer (managed copies, user edits detected and kept
    or asked about), or load them from the engine instead of copying.
    **Fixed in e5ad618 + 87bd7a9:** managed copies (`runner/lib/skills.js`). `gfx init` records `.gfx/skills.json` (per file
    sha256 of the installed content + engine version/commit, `engineHash` of the engine's skills dir); `gfx init
    --refresh` (no new command) syncs: untouched files updated, edited ones kept with the engine version written to
    `.gfx/skills-new/<path>` ("kept your edits: …"), new files added, files the engine dropped removed only if untouched,
    the user's own skills never touched. Legacy projects (no skills.json): a copy equal to any version in the engine's
    git history counts as untouched and is updated; unknown content is backed up to `.gfx/skills-backup/<stamp>/` and
    replaced (reported). The studio's `project_opened` runs `gfx init --refresh` when the engine's skills hash differs
    from the record (`skills_outdated`, Rust) and `--refresh --no-skills` when only the block is outdated. Verified on a
    /tmp copy of test-project-1: all 6 SKILL.md matched engine history blobs (none user-edited) and were updated, no backup.
22. **Skills point to docs that projects don't have** (2026-10-16). motion-graphics says "Source of truth:
    `docs/CONTRACT.md`", but a project has no `docs/`; only the engine does. Claude in a project can read it only via
    `.gfx/engine.json` → `<engine>/docs/CONTRACT.md`, which the skill doesn't say. Needed: point to the engine path
    (or ship the scene contract as a skill reference file).
    **Fixed in e5ad618 + 87bd7a9:** the skills say `<engine>/docs/CONTRACT.md` with `<engine>` from `.gfx/engine.json`
    (motion-graphics explains it once, incl. `\\wsl.localhost\<wsl>` from a Windows shell; the kind skills and
    sound-design point back to it); the managed CLAUDE.md block names the path once. No reference copy: the contract is
    240 lines and changes with the engine, a second copy would drift (the installer must ship `docs/CONTRACT.md`).
23. **Idea: workflow profiles, Looks and a Library** (2026-10-16, user, design discussion). The user found the
    current workflow heavy (stills at every beat ×2 passes; Claude renders; sound on every first take). Proposed:
    (1) per-project workflow profile (Quick first take: 1 sheet, no render, sound only if asked / Full / Custom), written
    into the managed CLAUDE.md block; (2) reusable **Looks** (LOOK.md motion/typography rules + refs, preset.js, a sound
    palette), e.g. "fast-paced", "ghibli-soft", picked per project; (3) a machine **Library** (looks, presets, sound
    palettes with roles pointing into the sound library, later templates) so sounds aren't duplicated across projects.
    Open: library vs per-project copies, the default profile, the build order.
    **Built in d7db1ba + 1dc702c (spec docs/LOOKS.md):** workflow profiles (Quick default), Looks pinned from a machine Library, Library page.
24. **Idea: sounds as replaceable elements, a tweak window, and taste memory** (2026-10-16, user, design discussion, not
    decided). Today: synth cues (`runner/lib/sfx.js`, variants per sound, seeded variance), per-cue overrides in
    sound.json (t, gain, pan, pitch, dur, intensity, variant, src, rate, env), CLAP similarity alternatives for library
    samples (Perform). Proposed: (1) Sound inspector per cue: Open code (its ctx.cue in @gfx blocks), Replace… with
    suggestions (same-role variants, CLAP-similar library + synth sounds, past choices), audition, A/B; (2) tweak window:
    pitch, length, attack/decay, brightness (filter), reverb (deterministic generated impulse), gain, pan, **Mutate**
    (small random variation, repeatable) and Vary (another variant), saved to sound.json; (3) taste memory: log
    from → to + tags, rank suggestions by similarity + history, feeding the sound palettes of finding 23. References:
    jfxr (BSD-3, tweak UI + separable synth lib, github.com/ttencate/jfxr), jsfxr Mutate/Randomize UX
    (github.com/chr15m/jsfxr; npm package changed hands in 2022: take ideas, not the package), ZzFX (MIT, ~20-number
    sound recipe, npmjs.com/package/zzfx). Suggested order: tweak window + Mutate → Replace with suggestions → taste memory.
25. **Idea: a "New scene" window for the first shot** (2026-10-16, user, design discussion). Today there is
    no UI: the empty state says "Ask Claude to build one (or run `gfx new`)". Proposed: + next to the scene picker / the
    empty state opens a window with Prompt, References (drop images/videos/links with a note each; copied to
    `scenes/<name>/refs/`), Format (16:9 · 9:16 · 1:1 · 4:5 · custom, fps, duration), Style (preset, later a Look from
    23), Kind (Auto or a kind), This take (Quick/Full profile from 23, sound yes/no, render when done), Send to (terminal
    or a new T3 thread). Create runs `gfx new <name>` with those settings, writes `scenes/<name>/BRIEF.md` (prompt,
    settings, refs + notes) and sends Claude "Build scene <name> from its BRIEF.md"; the motion-graphics Brief step reads
    BRIEF.md and skips answered questions. Re-run = edit BRIEF.md and send again.
    **Built in d7db1ba + 1dc702c (spec docs/LOOKS.md):** New scene window with BRIEF.md.
26. **Idea: drawing tools and comment visibility** (2026-10-16, user, not decided). Today (`web/src/draw.js`): pen
    (raw polyline, a point every ≥3 px, no smoothing), arrow, rect, ellipse, a few colours, widths S/M/L; strokes are
    vectors in scene px; no editing after drawing; comment pins can't be hidden. Wanted:
    - a **Show/hide comments** toggle (pins + markup on the picture; key + button);
    - **pen smoothing** with an amount slider and presets (e.g. Raw / Smooth / Very smooth; streamline-style smoothing
      while drawing, then simplification);
    - a **curve (Bézier) tool**: click-drag to place anchors with handles, edit afterwards;
    - **select and transform drawn figures**: move, rotate, scale, delete; edit Bézier anchors/handles.
    Bonus: send strokes to Claude as vectors too (e.g. an SVG path in scene px in the brief / `gfx review`), not only as
    the markup image. A drawn motion path (orbit's asteroid, comment c5) becomes exact input and costs fewer tokens.
    **Built in e5ad618 + 87bd7a9:** `H` / `Hide comments` viewer button hides pins + drawings (session-remembered, Comments
    tab unaffected); Pen smoothing presets Raw / Smooth / Very smooth + 0-100 slider (streamline while drawing, RDP on
    release, `smooth` field, quadratic rendering); Curve tool (`tool: 'curve'`, anchors `pts` + `handles`); draw
    Select sub-tool (move / corner scale / rotate knob / Del, curve anchor + handle editing, session Ctrl+Z); rect /
    ellipse `rot`; markup PNG renders the new kinds (shared `drawStrokes`). Bonus: `draw.js strokesToSvg()` exists but is
    not yet in the Ask brief / `gfx review` (orchestrator to wire). Check: `out/studio-draw-check.mjs` (27). See
    docs/REVIEW.md "As built (finding 26)".
