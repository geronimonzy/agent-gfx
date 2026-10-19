# gfx studio — product readiness

Assessed on 2026-10-15, refreshed 2026-10-16 · Revision `1dc702c` · Assessed by: Claude (from the repo and the findings in
`docs/JOURNEYS.md`; the user's real-exe walkthrough of 2026-10-16 is cited where an item rests on it)

Format and rules come from a shared product-checklist template: tick `[x]`
only with evidence (file, commit or test); otherwise leave `[ ]` with a short note. `N/A` items have no box and are not
counted. Items that CLAUDE.md lists as "not exercised in the real Windows app" are never ticked as done for the real app;
they say "dev shim only". The click-through list for the real exe is in `docs/JOURNEYS.md`.

**Priority markers**

- 🔴 **Launch blocker** — needed before giving the app to people outside the dev team (data loss, legal, cannot start).
- 🟡 **Should have** — expected by users of a serious creative tool.
- ⚪ **Nice to have** — polish and differentiators.

## Summary

| Area | Done | Blockers open |
|---|---|---|
| 1. Core product | 13 / 16 | 2 |
| 2. Onboarding and help | 4 / 9 | 3 |
| 3. Platforms and distribution | 1 / 6 | 2 |
| 4. Updates | 0 / 3 | 1 |
| 5. Languages and regional settings | 0 / 2 | 0 |
| 6. Accounts and identity | N/A | 0 |
| 7. Data: storage, backup, portability | 6 / 9 | 1 |
| 8. Sharing and collaboration | 1 / 3 | 0 |
| 9. Privacy, legal and third-party credits | 1 / 6 | 3 |
| 10. Security | 4 / 7 | 1 |
| 11. Monetization | 0 / 1 | 0 |
| 12. Support and feedback | 0 / 4 | 1 |
| 13. Observability | 0 / 3 | 0 |
| 14. Accessibility and UX basics | 3 / 7 | 0 |
| 15. Performance | 4 / 5 | 0 |
| 16. Quality engineering and releases | 5 / 8 | 1 |
| 17. Claude integration | 6 / 8 | 0 |
| 18. Creative features still planned | 0 / 4 | 0 |
| **Total** | **48 / 101** | **15** |

## 1. Core product

- [ ] 🔴 A first-time user goes from install to a rendered video without help. Not shown: no installer (see 3), no
  guided first run, and the Windows flow is "not exercised in the real app" for Projects home, setup card, Live start.
  Unknown: nobody outside the dev has tried it.
- [x] 🔴 The render path works end to end and is deterministic. Evidence: `tests/render.test.mjs` (122 checks, includes
  "--workers 3 byte-identical to --workers 1" on fixtures); CLAUDE.md rule: `--mode exact` stays byte-identical with the
  same browser build. Note: Fast mode and `--workers` > 1 are ±1 LSB off by design.
- [x] 🔴 Review: video + stems + cues, draft edits, A/B. Evidence: `docs/STUDIO.md`, `tests/review.test.mjs` (242). Real app: used 2026-10-16.
- [x] 🟡 Live view with select / move / scale / rotate tweaks. Evidence: `docs/REVIEW.md` §5, commit `5a298c8`.
  Real Windows app: Live (server start, select/move/tweak) used by the user on 2026-10-16 (`docs/JOURNEYS.md`
  findings 4, 12-15, 19).
- [x] 🟡 Render dialog (presets, size, range, format, quality, alpha, crop). Evidence:
  `apps/studio/web/src/render.js`, commit `5b84880`, `docs/FOUNDATION.md` "As built (§6)". Real app: render from the app for a WSL project used 2026-10-16 (findings 17).
- [x] 🟡 Render queue with progress, cancel, retry, reveal. Evidence: same files, Start/Pause (commit `c0b5dd8`); history kept per project in
  localStorage, jobs open at close return as "interrupted". Known gap: a cancelled render leaves a partial file (no
  delete op). Queue used in the real app 2026-10-16; Reveal / open in Explorer: dev shim only.
- [x] 🟡 Undo / redo of draft edits. Evidence: `apps/studio/web/src/store.js` (`undoStack`, `canUndo`), Ctrl+Z / Ctrl+Y
  in `keymap.js`. Undo of Claude's change: Versions panel (`docs/CODE-VERSIONS.md` §4).
- [x] 🟡 Import: images as comment attachments, sound folders as library sources. Evidence: `docs/REVIEW.md`,
  `docs/SOUND-LIBRARY.md` (WAV takes went with Perform, removed 2026-10-19). Video or asset import for scenes: not found.
- [x] 🟡 Export formats: mp4 (h264/h265), webm, gif, png sequence, ProRes 4444, WebM alpha, MOV alpha. Evidence:
  `docs/CONTRACT.md` `gfx render` options, `tests/render.test.mjs`.
- [ ] 🔴 Errors in the main flow are explained with a next step. Partly: the welcome status strip / setup card shows
  missing ffmpeg/browser with a Download button, queue rows show the error + last log lines, Code mode shows inline
  scene errors, T3 errors show their message and an escalation hint (finding 5, `51dd4fa`), Versions shows the engine's
  error line (finding 9), Live shows an error panel with recovery (`e5ad618`). Not verified: failed render wording,
  missing `claude`.
- [x] 🔴 Failed Live start is explained (and fixable). Evidence: Live error panel with recovery when the scene is
  broken (finding 19, `e5ad618`); engine commands for a WSL project use the located engine (finding 4, `51dd4fa`),
  which was the cause of the failed start seen in the real exe on 2026-10-16.
- [ ] 🟡 Sample project that opens on first run. The repo has the `scenes/_reel-test` fixture and the `reel`
  template (`templates/projects/reel`), but no "open the sample" button was found in `projects.js`.
- [x] 🟡 Templates for new projects. Evidence: `templates/projects/{blank,reel}`, `projects.js` (New project: template ->
  folder -> `gfx init`), `tests/project.test.mjs` (100). A `promo` template is not done. Looks and scene templates: next item.
- [x] 🟡 Workflow profiles (Quick default), Looks from a machine Library, Library page, New scene window with
  BRIEF.md. Evidence: commits `d7db1ba`, `1dc702c`, spec `docs/LOOKS.md`. Real app: not yet clicked by the user.
- [x] 🟡 Welcome window with recent projects, New project, Open folder. Evidence: `welcome.rs`, `welcome.js`, commit
  `2b07630`, `docs/HOME-SETTINGS.md`. Real app: welcome, Recent, Engine folder and New project in WSL used on 2026-10-16
  (CLAUDE.md "Walkthrough 2026-10-16").
- [x] ⚪ Style presets and fonts. Evidence: `style/presets` (dark-grid, nightfall), `style/fonts`.

## 2. Onboarding and help

- [ ] 🔴 Home screen explains what the product does and for whom. `README.md` is a single line.
- [ ] 🔴 First-run guidance from the setup card to a first render. The welcome status strip checks Engine, ffmpeg,
  browser and T3 (`welcome.js`, `gfx doctor --json`) and the New scene window starts the first shot; no guided
  walkthrough found. The user created a first scene from the app on 2026-10-16 with help.
- [ ] 🔴 User docs for the main tasks. Only developer specs exist in `docs/`; `docs/JOURNEYS.md` is a test list.
- [x] 🟡 Shortcut help. Evidence: `apps/studio/web/src/keys-help.js` (`?` overlay generated from `keymap.js`),
  `docs/KEYS.md`, commit `bb358d7`. Real app: not run (journey 14).
- [x] 🟡 Full settings page (search, machine/project scope with gfx.json overrides, instant apply). Evidence:
  `apps/studio/web/src/settings.js`, `settings-core.test.js`, commit `2b07630`, `docs/HOME-SETTINGS.md`. Real app:
  Engine folder / First take only (journey 15).
- [x] 🟡 Terminal empty state explains the next step ("New terminal" / "Claude"). Evidence: `terminal.js` (`term-empty`).
- [ ] ⚪ Video tutorials.
- [x] ⚪ Agent-facing skills for making scenes. Evidence: `.claude/skills/` (motion-graphics, sound-design, animejs, svg,
  canvas2d, threejs).
- [ ] ⚪ Changelog / "what's new" visible to users.

## 3. Platforms and distribution

- [x] 🔴 Runs on the main audience's platform (Windows). Evidence: Tauri v2 build `apps/studio/scripts/build-win.sh`;
  CLAUDE.md "Windows-native engine (verified with real node.exe)". Packaging for others: next item.
- [ ] 🔴 Installer / packaged build with a bundled engine (no WSL, no Node setup).
  `apps/studio/src-tauri/tauri.conf.json` has `"bundle": { "active": false }`. CLAUDE.md "Next planned": packaging,
  bundle node + win32 deps, drop non-win32 onnxruntime (~400 MB), make CLAP an optional download.
- [ ] 🔴 Code signing for the installer / exe (SmartScreen). Not started.
- [ ] 🟡 Mac build. Engine has macOS flags (`docs/FOUNDATION.md`: `--use-angle=metal`, mac Chrome platforms) but there
  is no Mac studio build or test; CLAUDE.md says "Mac later".
- [ ] 🟡 Works on a clean Windows machine with no WSL. Engine verified with real node.exe in a test copy
  (`/mnt/c/Users/<you>/dev/gfx-engine-test`, `win-test` project); a clean machine and the GUI were not tried.
- [ ] ⚪ Linux build. Not planned in CLAUDE.md.
- N/A — PWA install, Android / iOS stores, custom domain: it is a desktop app.

## 4. Updates

- [ ] 🔴 Users get new versions without a manual copy. No updater in `tauri.conf.json` or `Cargo.toml` found.
- [ ] 🟡 App and engine versions checked for compatibility. Partial: `gfx.json` `engine: ">=0.2"`; no app-side check found.
- [ ] ⚪ Release notes shown after an update.

## 5. Languages and regional settings

- [ ] 🟡 UI language: English only. Strings are hard-coded in JS modules; no translation layer found.
- [ ] ⚪ Locale-aware numbers and dates. Not checked.
- N/A — Right-to-left layout: out of scope for an English-only UI for now.

## 6. Accounts and identity

- N/A — Sign-up, sign-in, account deletion, 2FA: the app is local and has no accounts. T3 uses its own OAuth (see 17).

## 7. Data: storage, backup, portability

- [x] 🔴 Comments survive a crash. Evidence: comments autosave 600 ms after a change, deletes are tombstones
  (`docs/REVIEW.md`), `tests/review.test.mjs`.
- [ ] 🔴 Audio and element drafts survive a crash. Drafts are written to `out/<scene>/review/draft.json` by Save /
  Ctrl+S only; unsaved edits get a "leave page?" prompt (`main.js` `beforeunload`) but a crash loses them. Needs a draft
  autosave or a recovery copy.
- [x] 🔴 Scene code edits are not silently overwritten. Evidence: conditional source writes (commit `6f5c4a3`), disk-sync
  banners in Code mode (`docs/CODE-VERSIONS.md`). Code auto-save is off by default.
- [x] 🟡 Versions: save, history, diff, restore, auto-checkpoints before asking Claude and after renders. Evidence:
  `runner/lib/version.js`, `apps/studio/web/src/versions.js`, `tests/version.test.mjs` (63), `docs/CODE-VERSIONS.md`.
  Real app: Versions and Undo Claude's change used 2026-10-16 (findings 9, 12).
- [x] 🟡 `gfx apply` saves a version first. Evidence: commit `ea196ec`, `tests/version.test.mjs`.
- [x] 🟡 Plain files on disk, no lock-in (project folder, `scenes/`, `out/`, git history). Evidence: `docs/CONTRACT.md`.
- [x] 🟡 Layout and UI state saved per mode. Evidence: `docs/LAYOUT.md` ("gfx.layout.v1.<mode>"), commit `92ef12a`;
  confirmed by the user in the real app on 2026-10-15.
- [ ] 🟡 Delete partial or old renders from the app. Known limit in CLAUDE.md: no delete op.
- [ ] 🟡 GitHub sync of versions. Planned (`docs/CODE-VERSIONS.md` phase 4).

## 8. Sharing and collaboration

- [x] 🟡 Hand work to Claude: comments with drawings and attachments, `gfx review` / `gfx apply`. Evidence: commit
  `1febb82`, `docs/REVIEW.md`.
- [ ] ⚪ Share a project with another person (zip, GitHub). Versions are git, but there is no share flow.
- [ ] ⚪ Multi-user editing. Not planned.

## 9. Privacy, legal and third-party credits

- [ ] 🔴 Licence for gfx studio itself. No `LICENSE` file in the worktree root.
- [ ] 🔴 Third-party notices file or About screen: Kenney (CC0), OFL fonts (Inter, IBM Plex Mono, Ubuntu in
  `style/fonts`), ffmpeg, chrome-headless-shell, CLAP model, anime.js, three.js, CodeMirror, xterm, dockview. Only
  per-source licence tags exist (`library/sources.json`). Nothing bundled or shown.
- [ ] 🔴 Redistribution rules checked for the ffmpeg build, chrome-headless-shell and CLAP weights. Unknown.
- [x] 🟡 Sound sources carry licence info and badges. Evidence: `library/sources.json`, Library → Sound sources
  licence column (`docs/SOUND-LIBRARY.md` §4).
- [ ] 🟡 Privacy statement: what leaves the machine (T3 connection, downloads of ffmpeg / browser / Kenney / Freesound).
  Not written.
- [ ] ⚪ Terms of use.

## 10. Security

- [x] 🔴 Secrets stay out of the page and logs. Evidence: `docs/T3.md` As built §7 ("no secrets in page / status / logs"),
  `out/studio-t3-check.mjs` (71 checks, local only); CLAUDE.md routes keys through `request_secret`.
- [x] 🔴 File writes are guarded (project root only, `..` rejected, allow-listed review paths and source files).
  Evidence: `docs/STUDIO.md` backend API, `source-guard.js` + test, Rust unit tests.
- [x] 🟡 Link opening is allow-listed. Evidence: `url-guard.js` + `url-guard.test.js`, `open_link` guard in
  `docs/CODE-VERSIONS.md`.
- [x] 🟡 Zip-slip protection for downloads. Evidence: `runner/lib/fetchfile.js` (`docs/FOUNDATION.md` As built §1-3).
- [ ] 🔴 Content security policy. `tauri.conf.json` has `"csp": null`. Needs a decision (xterm, iframe to the local
  server, `gfxlib://`).
- [ ] 🟡 Dependency vulnerability scanning (`npm audit`, `cargo audit`). Not found.
- [ ] ⚪ Security contact / disclosure policy.

## 11. Monetization

- [ ] ⚪ Decide a business model (free, one-time, subscription). Not decided in the repo.
- N/A — Payments, tax: nothing to charge yet.

## 12. Support and feedback

- [ ] 🔴 A way to contact the team from the app. None found.
- [ ] 🟡 "Report a problem" that attaches version, `gfx doctor` output and recent logs. `gfx doctor --json` exists; the
  attach flow does not.
- [ ] 🟡 Known-issues page. Known limits are in CLAUDE.md only.
- [ ] ⚪ Community space.

## 13. Observability

- [ ] 🟡 Crash and error reporting (opt-in only, since it is a local tool). None.
- [ ] 🟡 Local log file the user can send. Not found.
- [ ] ⚪ Product analytics (opt-in, privacy-friendly). Not decided.

## 14. Accessibility and UX basics

- [x] 🟡 Keyboard navigation through one shortcut registry with a conflict check. Evidence: `keys.js`, `keymap.js`,
  `docs/KEYS.md`.
- [x] 🟡 UI scale (whole UI and per panel). Evidence: `docs/LAYOUT.md` §4, `layout.js`; UI zoom confirmed by the user in
  the real app on 2026-10-15.
- [x] ⚪ Dark theme. Evidence: `docs/STUDIO.md` UI section. No light theme.
- [ ] 🟡 Screen-reader labels and automated accessibility checks. Not found.
- [ ] 🟡 Colour contrast check. Not found.
- [ ] 🟡 Visible focus on all controls. Not checked.
- [ ] ⚪ Reduced-motion setting for the app's own UI.
- N/A — Touch targets sized for phones: desktop app.

## 15. Performance

- [x] 🟡 Fast render mode (GPU raster) with a software-fallback warning. Evidence: commit `4545dc6`,
  `docs/FOUNDATION.md` §4b; Windows d3d11 0.235 vs swiftshader 0.649 s/frame at 4K (CLAUDE.md).
- [x] 🟡 Parallel capture (`--workers`). Evidence: commit `ac6a9b0`; only about 1.36x, default 1.
- [x] 🟡 Heavy work off the main thread: CLAP runs in the engine (`gfx lib index / search`), renders as engine jobs.
- [x] 🟡 Performance numbers are written down. Evidence: `docs/FOUNDATION.md` §4a/§4b, CLAUDE.md "Render speed".
- [ ] 🟡 Performance budgets enforced by tests (start time, scrub latency). Not found.

## 16. Quality engineering and releases

- [x] 🔴 Automated tests for the engine. Evidence: `tests/{review,reload,project,render,code,version}.test.mjs`
  (CLAUDE.md counts 242 / 33 / 100 / 127 / 75 / 63).
- [x] 🟡 Studio unit tests and Rust tests. Evidence: `apps/studio/web/src/{source-guard,code-versions,t3-core,url-guard}
  .test.js`; Rust `cargo test --lib` (63 per CLAUDE.md, via `out/build-spike.sh --test`).
- [x] 🟡 Browser E2E scripts for the studio (dev shim). Evidence: `out/studio-*-check.mjs` (gitignored, not in the
  repo); two known stale layers assertions.
- [x] 🟡 Every feature commit gets a Codex review. Evidence: CLAUDE.md workflow.
- [x] 🟡 Real-app drive scripts for layout and the T3 view. Evidence: `docs/LAYOUT.md` spike results, `docs/T3.md`
  (`out/win-t3-drive.sh`, mock T3).
- [ ] 🔴 Automated or manual click-through of the real Windows exe for the main journeys. See `docs/JOURNEYS.md`;
  layout (13) is fully verified; journeys 1-8, 11, 12, 15 are partly verified (2026-10-16 walkthrough); 9, 10, 14 not run.
- [ ] 🟡 Tests run on every push (CI). No `.github/` folder.
- [ ] 🟡 Documented release and rollback procedure. Not written.

## 17. Claude integration

- [x] 🟡 Embedded terminal (ConPTY / WSL) and a Claude button. Evidence: commit `b75fee5`, `terminal.js`,
  `docs/CLAUDE-IN-APP.md` §3. Real app: not exercised (dev shim only).
- [x] 🟡 Ask Claude composer with a `gfx context` brief. Evidence: `ask.js`, commit `e79e97f`; send all open comments (`e5ad618`). Real app: used 2026-10-16 (findings 6, 20).
- [x] 🟡 T3 Code: connect over MCP OAuth, threads panel, Send to T3 with frame + markup, waiting badge. Evidence: commit
  `b568bea`, `docs/T3.md`, `out/studio-t3-check.mjs` against a mock. Real T3 from the real exe on 2026-10-16: connected with Full
  access, threads panel, worktree mapping, + New thread, Send to T3 (findings 1, 5, 7). Two-step Connect after `ee10bc7`
  still to be re-tested from scratch.
- [x] 🟡 Claude's changes show up live (live reload, "changed by Claude" pulse, disk sync in Code mode). Evidence:
  `runner/lib/reload.js`, `tests/reload.test.mjs` (33), commit `8a9885e`.
- [x] 🟡 Undo Claude's change (restore the "Before asking Claude" checkpoint). Evidence: `docs/CODE-VERSIONS.md` §4.
- [x] 🟡 Element <-> code links. Evidence: `runner/player/code.js`, `tests/code.test.mjs` (30).
- [ ] 🟡 A missing `claude` command is explained. `docs/CLAUDE-IN-APP.md` §3 promises an install hint; not verified here.
- [ ] 🟡 Open T3 / pairing checked against the real T3 from the real exe. Partly: connected and used 2026-10-16; the
  two-step Connect from scratch (Disconnect, then Connect) and Open T3 link are still open; see journey 7.

## 18. Creative features still planned

- [ ] 🟡 Visual version diff (render two versions at the playhead; side by side, wipe, difference). Planned
  (`docs/CODE-VERSIONS.md` phase 3). The text diff exists.
- [ ] 🟡 Variations (branches). Planned, not built.
- [ ] 🟡 Music track (import, libraries, beat grid, ducking, synth beds). Planned. SFX synth and sample cues exist.
- [ ] ⚪ Params / marks (`ctx.param`, `ctx.mark`) editable in the inspector and timeline. Planned.

## Competitor comparison

Not filled in. Candidates to compare later (nothing was researched): a professional motion tool (After Effects), a
code-based video tool (Remotion), a consumer editor (CapCut). Add sources when this is done.
