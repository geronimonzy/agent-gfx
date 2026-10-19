# Code workspace + versions — spec v1

Phase 1 (code workspace) and phase 2 (versions). Variations and GitHub sync come later.
**Phase 3, visual diff between versions (Compare visually): see docs/VISUAL-DIFF.md** (spec + As built).

## 1. Element ↔ code links (runner)
- **Provenance at runtime** (live bridge + player, never in capture output): wrap the scene's anime.js entry points
  (`createTimeline().add/set/call`, `animate`, `utils.set`) via a Vite-served shim or by patching the module namespace
  the scene imports, record per call: call-site (file URL → project-relative path, line, column from `new Error().stack`;
  scenes are served untranspiled so lines are exact), resolved target elements, time range (ms offset + duration from
  the params / timeline position), animated property names. Also record call sites of `ctx.el(name, …)` and
  `ctx.cue(…)` (id, t). Overhead only in the bridge (flag); capture/render untouched and byte-identical.
- **Static refs**: for a key's element: class names, id, `data-gfx` value → search the scene folder's files
  (`.js`, `.css`, `.html`, `.json`) for `class="…x…"`, `.x{`/`.x `, `'.x'` selectors, `data-gfx="name"`,
  `ctx.el('name'`; dedupe with runtime refs.
- Bridge messages: `code { key }` → `{ refs: [ { kind: 'defined'|'styled'|'named'|'animated'|'sound'|'ref', file,
  line, col, snippet, t0?, t1?, props?, cue? } ] }` (sorted: named, defined, styled, animated by t0, sound, ref);
  `codeAt { file, line }` → `{ keys: [...] }` (elements created/animated/named by that line; for animated lines the
  targets). Reset on reload.
- Template fix: `templates/projects/*/scenes/*/scene.js` render uses the reset-then-seek pattern + prime in setup
  (see animejs skill "Seek pitfalls").

## 2. Versions (engine) — `gfx version`
Git underneath (system git: `GFX_GIT` or `git` on PATH; `gfx doctor` reports it). All subcommands take the project.
- `gfx version init` — `git init` if needed, write/merge `.gitignore` (out/, .gfx/, node_modules/), first commit
  "Project created". Refuses inside the engine repo unless `--allow-engine` (studio shows engine history read-only).
- `gfx version status --json` → `{ repo: bool, branch, dirty: [ {path, status} ], head: {sha, msg, time, actor} }`.
- `gfx version save [-m "note"] [--actor user|claude|auto] [--thumb scene@t] [--json]` — stage all project files
  (respecting .gitignore), commit with message + trailers `Gfx-Actor: <actor>`, `Gfx-Scene: <name>`, `Gfx-T: <t>`;
  no-op (exit 0, `{ "skipped": "clean" }`) when nothing changed. `--thumb` renders `gfx still` at that t into
  `.gfx/thumbs/<sha>.png` (gitignored cache) after committing.
- `gfx version log [--limit 100] [--path p] --json` → `[ { sha, short, msg, note, actor, scene, t, time, files: [ {path,
  status, add, del} ], thumb } ]`.
- `gfx version diff <a> [<b>|--worktree] [--path p] --json` → `{ files: [ { path, status, a: text|null, b: text|null } ] }`
  (text files ≤ 1 MB; binary flagged).
- `gfx version restore <sha> [--path p]... [--json]` — first auto-saves the current state (`actor auto`, "Before
  restore to <short>"), then checks out the paths (or the whole tree) from <sha> into the working tree and commits
  "Restored <short>" (`actor user`). Never rewrites history (no reset/force).
- Checkpoint hooks (engine-side so the CLI and studio share them): `gfx apply` auto-saves before applying; render
  completion is saved by the studio (below).

## 3. Code workspace (studio)
- Top-bar mode **Code** (next to Review; Perform was removed 2026-10-19). Layout: file tree (left, project files: scenes/**, style/**, *.md,
  gfx.json; out/ hidden; engine files shown read-only under "Engine" only for reference) · editor with tabs (centre) ·
  picture + transport (right, smaller) · timeline stays at the bottom.
- Editor: CodeMirror 6 (bundled): JS/CSS/JSON/Markdown/HTML modes, dark theme matching the app, search/replace,
  multi-cursor, folding, bracket matching, lint gutter for errors from the bridge (`type:'error'` with stack → line),
  minimal completions (`ctx.` members, preset color names, anime.js common params). Ctrl+S save; auto-save after
  1.5 s idle (setting). Dirty dots on tabs. On save → the file is written → live reload.
- Disk sync: watch mtimes (poll 1 s for open files); if changed on disk and the tab is clean → reload silently with a
  toast "Updated by Claude"; if dirty → banner "Changed on disk: Reload · Keep mine · Compare".
- Backend: `list_project_files()` (tree, ignoring out/ .gfx/ node_modules/ .git/) and
  `write_project_file(rel, text)` allowed only for `scenes/**`, `style/**`, `*.md` at the project root, `gfx.json`
  (reject `..`, absolute, out/, .git/). Same guards in Rust and the dev shim.
- **Element ↔ code**: inspector "Code" section (refs list from `code {key}`; click → open file at line, highlighted
  range); editor cursor line → `codeAt` → outline those elements in the picture (debounced 150 ms); animated refs show
  their t0–t1 band on the timeline while hovered. "Open in VS Code" (`vscode://file/<abs>:<line>:<col>`; WSL roots use
  `vscode://vscode-remote/wsl+<distro>/<path>:<line>`). "Ask Claude" with the selection.

## 4. Versions panel (studio)
- Side tab **Versions** (available in all modes): current state (dirty files count) + **Save version** (note field);
  history list (thumb, note/message, actor badge You/Claude/Auto, relative time, changed files); click → details:
  files with +/− counts, **Diff** (CodeMirror merge view, side-by-side, per file), **Restore version**, **Restore this
  file**. Engine repo projects: history read-only, no save/restore (badge "engine repo").
- Not a repo → card "Turn on versions for this project" → `gfx version init`.
- Auto-checkpoints (setting, default on): before Ask Claude → Terminal/T3 send (`actor auto`, "Before asking Claude:
  <first 60 chars>"); after a render job completes ("Rendered <scene> <preset>", `--thumb scene@playhead`); before a
  version restore (engine does it). Claude's own edits are captured by the next checkpoint and attributed `claude` when
  the previous checkpoint was a "Before asking Claude" one and only scene/style files changed (heuristic, documented).
- Undo Claude's last change: one button on the latest "Before asking Claude" entry → restore it.
- **Where am I (added 2026-10-18, user request after a restore went unnoticed):**
  - **Current** badge on the latest version when nothing changed since; with unsaved changes it reads **Last saved**.
  - Restore entries name their source: "Restored: ‹title of that version› · ‹date›" (+ "(scene.js)" for a file
    restore); the name is a link that selects and scrolls to the source entry. The engine records the source as the
    `Gfx-Restored: <sha>` trailer; older entries are recognised by their "Restored <short>" message.
  - **= now** tag on older versions whose files are identical to the current state (same git tree as HEAD, clean
    working tree): after a restore the source version carries it.
  - Engine: `gfx version log --json` entries gain `tree` and `restoredFrom: { sha, short, msg, time } | null`
    (resolved even when the source is outside the listed range); `status.head.tree`.

---
## As built (runner/engine side)

**§1 Element <-> code (bridge only)**
- `runner/player/code.js` (imported by `bridge.js` only; capture/render pages never load it, `buildScene` gets `trace = null` there; the reel fixture stills at 0.5 / 7.2 / 12.9 s are `cmp`-identical before/after). Instrumentation = a patch of the anime.js **Timeline prototype** (`add`, `set`; `call` has no targets), found via `Object.getPrototypeOf(createTimeline())`, active only while a build runs (boot and each rebuild get a fresh trace; the old trace stays if a rebuild fails; nothing to reset otherwise). Recorded per call: scene-file stack frames (`scenes/**`, `style/**`, up to 8, lines exact), the real child targets/offsets/durations from the timeline (exact t0/t1 incl. labels, relative positions and stagger), animated property names (control keys like duration/ease/on* dropped). `ctx.el` and `ctx.cue` record their call sites through `buildScene({ trace })`.
- **Not traced**: `animate()` and `utils.set()` outside a timeline (module functions cannot be patched without rewriting the scene's imports); elements created by `insertAdjacentHTML` (found via the static class/data-gfx search instead).
- Call-site choice: frames that sit on a one-line arrow helper (`const A = (t, p, ms) => tl.add(t, p, ms(ms))`, detected from the source line) are skipped, so a ref points at the `A(tot, {...}, 6.8)` call, not into the helper. `codeAt` matches any recorded frame (the helper line therefore maps to every element it animates).
- `code { key }` -> `{ refs }` sorted named, defined, styled, animated (by t0), sound, ref. Runtime: `named` (ctx.el call), `animated` (targets that are the element or an ancestor; ancestors carry `inherited: true`; calls from one line merge: min t0 / max t1 / union props / `count`), `sound` (ctx.cue ids equal to `key` or starting `key-`, grouped per call site: `cue` first id, `cues` all ids, `t0` earliest). Static (files from `GET /__gfx/scene-files`, .js/.css/.html/.json under `scenes/<name>/`, <= 1 MB each): `named` = `data-gfx="key"` / `el('key'`, `defined` = `class="..cls.."` / `classList.add('cls')` / `id=`, `styled` = `.cls` in a CSS rule (any match in .css files; in JS only when the line reads like a selector followed by `{` or a trailing comma), `ref` = any other quoted key / `.cls` / `[data-gfx="key"]` mention on a line with no other ref. Classes that appear on more than 12 lines are ignored as too generic. Dedupe by kind+file+line; ref fields `file` (project-relative posix), `line`, `col` (1-based), `snippet` (trimmed line, <= 160 chars).
- Object regions (docs/INSPECTOR.md §1, As built there): the same `code { key }` reply also carries `regions: [{ file, from, to, kind: 'marked'|'traced'|'ref', label }]`, `marked` and `tweakable: { props, read }` from `codeRegions()` in `runner/player/code.js` (pure, no DOM): `// @gfx key` … `// @end` marker blocks when the key has any, else the refs expanded to their statements plus identifiers traced from the `ctx.el` call. Tests: `tests/code.test.mjs` (markers, orbit fixture `tests/fixtures/code-orbit/scene.js`, ref expansion on the reel fixture, tweakable).
- `codeAt { file, line }` -> `{ keys }`: topmost named elements in/at the targets of every call recorded at that line, plus the key of a `ctx.el` line. Unknown lines -> `[]`.
- Templates: `templates/projects/reel/scenes/reel/scene.js` and `templates/anime/scene.js` now prime (`tl.seek(tl.duration); tl.seek(0)`) in `setup` and reset-then-seek in `render`.

**§2 Versions**
- `runner/lib/version.js` (all git through `run()`, args array, no shell, `LC_ALL=C`, `GIT_DIR`-style env stripped, `-c commit.gpgsign=false`; identity falls back to `gfx <gfx@localhost>` only when git has none). CLI in `runner/lib/cli/commands/version.js`; options `-m/--message`, `--actor`, `--thumb scene@t`, `--limit`, `--path` (repeatable), `--worktree`, `--allow-engine`.
- Engine repo = the project is (or lies inside) the repo whose top level is the engine folder. `init`/`save`/`restore` refuse there; `status` returns `engine: true`; `log`/`diff` work. A project nested in some other repo gets its own repo on `init`.
- `status --json` -> `{ repo, engine, branch, dirty: [{ path, status: A|M|D }], head: { sha, msg, time, actor } | null }` (untracked = A). `save --json` -> `{ sha, short, msg, actor, thumb? }` or `{ skipped: 'clean' }`; default message "Saved <files>". `--thumb` runs `gfx still` as a child process after the commit; a failed thumbnail only warns. `log --json` entries as specified, plus `files[].binary` for binary files, `note` = message without trailers, `thumb` = `.gfx/thumbs/<sha>.png` when it exists. `diff <a>` alone = changes made by `<a>` (against its parent / the empty tree); `--worktree` includes untracked files; entries `{ path, status, a, b }` with `binary: true` or `tooLarge: true` (> 1 MB) instead of text. `restore --json` -> `{ restored, saved: <auto-save>|null, commit: <restore commit>|null }`; whole-tree restore also deletes tracked files that `<sha>` does not have; `--path` for a path absent in `<sha>` removes it. Paths must be project-relative (no `..`, absolute, leading `-`/`:`); revisions are verified with `rev-parse` first.
- `gfx apply` -> `autoSave(root, "Before apply <scene>", { scene })` (actor `auto`); the apply itself stays uncommitted until the next save. `gfx doctor` prints/returns `git: { path, version }`.

## As built (studio side)

**§3 Code workspace** (`web/src/code.js`, `cm.js`, `diff.js`, `code.css`, `source-guard.js`)
- Mode seg **Review · Code** (Perform removed 2026-10-19; `main.js setAppMode`; `localStorage gfx-studio.code` restores it). Code mode = `body.mode-code`:
  left column Files | Versions, centre tabs + CodeMirror 6 + status bar, right the picture + transport + a refs panel for the
  selected element; inspector / side panel hidden. Entering Code mode turns Live on (refs, outlines and error lines need the bridge).
- CodeMirror (devDependencies, bundled; lazy chunk `cm-*.js`): JS/CSS/JSON/Markdown/HTML, app-coloured dark theme, search/replace
  (Ctrl+F), multi-cursor, folding, bracket matching, lint gutter, completions (`ctx.` members, `style.colors.` names, common anime.js
  params). One `EditorView`, one `EditorState` per tab (own undo history). Ctrl+S (`code.save`, context `code`) saves the active
  file; **Auto-save** (status-bar checkbox, `gfx-studio.code.autosave`, default off) saves 1.5 s after the last edit.
- Tree from `list_project_files`: **Project** (writable: scenes/**, style/**, root *.md, gfx.json), **Other files** (read-only; the
  engine repo's runner/ etc. land here), **Engine** (read-only reference: core.js, style.js, ease/tween/rng/sfx, read through the
  live server as `?raw`). Re-listed every 6 s while Code mode is on.
- Disk sync: open tabs are `stat`-polled every 1 s. Changed + tab clean -> silent reload, toast "Updated by Claude: <path>" (or
  "restored from version …" right after a Versions restore). Changed + tab dirty -> banner "Changed on disk: Reload · Keep mine ·
  Compare" (Compare = merge view disk vs yours). Deleted -> banner "Deleted on disk" (Close tab · Keep mine).
- Errors: bridge `{ type: 'error', message, stack }` (load and reload) -> `stackLocations()` maps live-server URLs / `/@fs/`
  paths to project files -> lint diagnostic on that line + a red status-bar chip (click = go to line) + a dot in the tree;
  cleared by the next successful `reloaded`.
- Element <-> code: the inspector **Code** section and the Code-mode refs panel render `code {key}` (fallback when the bridge has
  no `code`: a text search of the scene folder, marked "text search"); click opens the file at the line (flash highlight;
  animated refs also seek to t0); hovering an animated ref sets `S.codeBand` -> amber t0–t1 band on the timeline. Cursor line ->
  `codeAt` (150 ms debounce) -> dashed amber outlines in the picture (`live.setCodeOutlines`, bounds follow the playhead) + key
  chips in the status bar (click selects the element).
- **Object view** (docs/INSPECTOR.md §1c, As built there): `openObjectCode(key)` (the inspector's **Open code**; in Code mode
  a picture selection re-targets an open view) opens the element's file with everything outside its regions folded
  (`cm.js` region field + `foldEffect`), header `#code-obj` with `key · N blocks · file` or "traced (approximate)", ↑/↓ and
  Alt+↑/↓ between regions, Show whole file, a file list and the refs as chips. Editing/saving unchanged.
- **VS Code**: `vscode://file/<abs>:<line>:<col>`; WSL roots (`\\wsl.localhost\<distro>\…`, `\\wsl$\…`) ->
  `vscode://vscode-remote/wsl+<distro>/<path>:<line>:<col>`; opened with `open_link` (its guard allows only these two forms).
- **Ask Claude** (status bar): brief + "Code selection — <file>:<l1>-<l2>" fenced block (the cursor line when nothing is selected).
- Backend: `list_project_files`, `write_project_file` (`check_source_writable` in lib.rs, unit-tested; twin `source-guard.js`
  in the dev shim, `node --test`).

**§4 Versions** (`web/src/versions.js`, `diff.js`)
- One panel element, mounted in the side tab **Versions** (Review), in the Code-mode left column, or via the top-bar history
  button. All git work is `engineRun(['version', …, '--json'])`.
- Engine repo (status `engine: true`, or runner/cli.js + runner/player/bridge.js in the root): badge "engine repo", no save /
  restore / undo / init; history, details and diffs work. Commits without a `Gfx-Actor` trailer show a neutral "git" badge.
- Details: files with status and +/−, per-file diff / restore, **Diff** (`version diff <sha>`, the changes made by it), **Compare
  with now** (`diff <sha> --worktree`), **Restore version** (confirm; the engine auto-saves first). Thumbs `.gfx/thumbs/<sha>.png`.
- Save version: note field (Enter) + `--actor user --thumb <scene>@<playhead>`; `{ skipped: 'clean' }` -> "Nothing changed".
- Auto-checkpoints (`gfx-studio.versions.auto`, default on), all `--actor auto`, skipped when not a repo / engine repo: before Ask
  Claude **Terminal**, **T3** and **Copy** ("Before asking Claude: <first 60 chars of the message>", waited for at most 10 s so a
  slow git never blocks the send); after a render job completes ("Rendered <scene> <preset|size|format>", `--thumb
  <scene>@<playhead>`).
- Claude attribution heuristic: before each auto checkpoint, if HEAD is a "Before asking Claude" checkpoint and every changed
  file is under `scenes/` or `style/`, those changes are first committed as "Claude's changes" with actor `claude`. It cannot
  tell Claude's edits from the user's own edits made in that window; a user "Save version" is always `user`.
- **Undo Claude's change**: a button on the newest "Before asking Claude" entry -> restore that sha. Each Ask stores its undo
  target per project in localStorage (`gfx-studio.versions.requests:<root>`: `{ id, sha, message, at }`); with a clean project
  no checkpoint commit is made and the target is the current head. The target row shows a marker "You asked Claude here ·
  <time>" (the request's message as tooltip; older records without `at` show no time). On a dedicated "Before asking Claude"
  checkpoint the button stays "Undo Claude's change"; on an ordinary version (e.g. "Project created" by You) it reads "Undo
  Claude's change (back to this)" (journey finding 12). Restore behaviour is unchanged.
- E2E: `out/studio-code-check.mjs` (temp reel project + the engine repo read-only; port 5188; `mkdir /tmp/gfx-e2e.lock`).


### As built — fixed Versions details pane (2026-10-18)

- Both hosts (side tab and Code left column) use a bounded panel: unchanged header and Save / changed-files area,
  independently scrolling history, and a constant-height bottom details pane with a top border and its own scroll.
  The pane uses a local token (`--versions-details-h`): 40% of the remaining body height, bounded by four to ten
  `--space-32` units. Its height stays the same when empty, selected, or deselected.
- History rows never expand. Clicking selects / deselects without rebuilding the list or compensating its scroll.
  The empty pane reads “Select a version to see its files and actions.” Selected details show title / restored-source
  link, short SHA, relative time, existing Current / Last saved / = now badges, actions, then per-file changes.
- Focusable history rows use `aria-current` and a visible focus ring; ↑/↓ selects and focuses adjacent rows,
  Enter opens the existing Diff action, and Space toggles selection. Nested links and Undo buttons retain native keys.
  Refresh preserves history scroll, details scroll, and focused history row.
- Diff / Compare with now / Compare visually / Restore and per-file actions keep their selectors and behavior,
  including `api.ask` restore approval, engine read-only protection, auto-checkpoints and thumbnails.
- Validation: token gate, `code-versions.test.js` (8 tests), and JS syntax check pass. No E2E or server run in this lane;
  existing `out/studio-code-check.mjs` assertions require no changes. Browser layout and keyboard checks remain to run
  in both hosts, including selecting rows at scrollTop 0 and toggling empty / populated details without row movement.
