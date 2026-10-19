# Workflow profiles, Looks, Library, New scene window (spec, 2026-10-16)

Walkthrough ideas 23 and 25 (docs/JOURNEYS.md). The user found the current workflow heavy: stills at every beat in
2 passes, Claude rendering, and sound on every first take. They want to reuse a design approach across projects
("fast-paced", "ghibli-soft"), keep one place for presets and sounds (not "30 of the same sounds in different places"),
and have an easy first shot.

Decisions (user, 2026-10-16):
- Looks, presets and sound palettes live in a **machine Library**. Picking a Look **copies it into the project**
  (pinned), so a shared project still works elsewhere. "Update from library" brings in later Library changes.
- The default for a new scene's first take is **Quick**.
- This round: workflow profiles, Looks with a Library page, and the New scene window. The sound inspector, tweak
  window and taste memory (idea 24) come in a later round.

## 1. Workflow profiles
- Settings → Claude & terminal → **First take**, with a machine default and a per-project override (like the render
  settings):
  - **Quick** (default): verify with 1 contact sheet; stills only where the sheet shows a problem. No render (the user
    renders from gfx). Sound only if the prompt asks for it.
  - **Full**: today's workflow: sheet plus stills at every beat in 2 passes, Claude renders, sound always.
  - **Custom**: verify = sheet / sheet + key stills / full (2 passes); Claude renders = on/off; sound = if asked /
    always.
- It applies to building a new scene and to large rewrites. Review fixes always verify with stills at the changed
  moments.
- Stored in gfx.json `"settings".workflow` (machine default in settings.json). The managed CLAUDE.md block shows it in
  one line, e.g. `Workflow (this project): Quick first take: 1 contact sheet, no render, sound only if asked.`
  The motion-graphics skill follows that line: steps 7–9 become conditional, and the request can override it ("render
  it too").
- The block is refreshed when the setting changes, through the existing managed-block refresh (`gfx init --refresh
  --no-skills`, run by the studio).

## 2. Looks
A Look is a folder `looks/<id>/`:
- `LOOK.md`: frontmatter `name`, `description`, `tags`, then sections **Motion** (easing, pacing, beat length,
  transitions, camera), **Typography**, **Colour & style**, **Sound**, **Do / Don't**, and **References** (with notes).
- `preset.js` (optional): a style preset (colours, fonts) in the same format as `style/presets/*.js`.
- `sounds.json` (optional): the **sound palette**,
  `[{ "role": "whoosh", "sound": "whoosh", "variant": "air", "params": { "pitch": -2 }, "tags": ["soft"], "note": "" }]`.
  An entry points to a synth sound, or to a library sample by `src` = the **library-relative path** `<source>/<file>`
  (as `gfx lib search --json` reports it), with optional top-level `start` / `dur` (seconds) for the slice and an
  `alt` (a synth sound entry, `{ sound, variant?, params? }`) used when `src` doesn't resolve to a file in the
  installed sound library (`gfx lib info <src> --json` exits 1). `params` are cue options. Files are never copied.
  Synth sounds include `beep` (`soft` / `digital`) and `wind` (`breeze` / `gust`, takes `dur`).
- `refs/`: reference images, plus short notes in LOOK.md.

### In a project (pinned copy)
- Use Look: the folder is copied to `<project>/looks/<id>/`; gfx.json gets `"look": "<id>"` and
  `"lookSource": { "library": "<library path>", "hash": "<content hash at copy>" }`.
- The look's `preset.js` becomes the project's default style preset `look-<id>`, i.e. `style/presets/look-<id>.js`
  written next to it. Scenes keep naming their style explicitly; new scenes default to it.
- The managed CLAUDE.md block says `Look: <name> (looks/<id>/LOOK.md): read it at the brief, style, build and sound
  steps; use its sound palette first.`
- Skills: motion-graphics reads LOOK.md at Brief / Style / Build. sound-design uses the palette sounds first and adds
  sounds outside it only when the palette has nothing for the role, saying so in the report.
- **Update from library** appears when the Library copy's hash differs from `lookSource.hash`. It is offered only when
  the project copy is unedited; otherwise show both and let the user pick (no silent overwrite).
- **Save to library** copies the project's look (new or edited) back to the Library.

### CLI (engine)
- `gfx look list [--library <dir>]`, `gfx look use <id> --library <dir>`, `gfx look update [--library <dir>]`,
  `gfx look save [--library <dir>]`, `gfx look new <id>` (scaffold in the project).
- The studio passes `--library` from its setting. Claude in a project only ever reads the project copy, so it never
  needs the Library path.

## 3. Library
- A folder: Settings → General → **Library folder** (default `<Documents>/gfx library`; a WSL path is allowed). Layout:
  `looks/<id>/`, `presets/<name>.js`, `palettes/<name>.json` (standalone sound palettes that looks can reference).
- **Library page** in the studio (a full page like Settings), with tabs **Looks · Presets · Sound palettes**:
  - **Looks:** cards (name, tags, colour swatches from preset.js, ref thumbnails), plus New look (blank / from this
    project's current style / ask Claude from references: opens the Ask Claude composer with a brief to write LOOK.md +
    preset + palette into the Library), edit (LOOK.md in CodeMirror, the palette editor below), Use in this project,
    Duplicate, Delete (with confirm).
  - **Presets:** list, edit (the JS file in CodeMirror), duplicate.
  - **Sound palettes:** rows `role · sound · ▶ audition · tags · note · ×`; Add from the sound library (search by
    name/tag, plus CLAP text search if the index exists, reusing the existing `gfx lib` search) or from a synth sound
    + variant.
- Starter content: looks generated from the built-in presets (`clean-dark` from dark-grid), with short LOOK.md files,
  so the page isn't empty.

## 4. New scene window (idea 25)
- Opens from **+** next to the scene picker and from the empty state ("Create your first scene").
- Fields:
  - **Name** (slug; validated, unique);
  - **Prompt** (large);
  - **References**: drop images/videos or paste links, each with an optional note; files are copied to
    `scenes/<name>/refs/`;
  - **Format**: 16:9 1080p · 9:16 reel · 1:1 · 4:5 · custom WxH, fps, duration;
  - **Look**: the project's look, another look from the Library (picking pins it, see §2), or a plain style preset;
  - **Kind**: Auto / anime / svg / canvas / three;
  - **This take**: Quick / Full / Custom (defaults from the profile), sound yes/no, render when done yes/no;
  - **Send to**: Terminal / new T3 thread (T3 rules as for Send to T3).
- Create:
  1. `gfx new <name> --kind <kind or anime as a placeholder for Auto> --size … --fps … --dur … --style …`. For Auto,
     the brief tells Claude it may change the kind, i.e. re-scaffold.
  2. Write `scenes/<name>/BRIEF.md` (prompt, settings, references with notes and paths, the take's profile).
  3. Send Claude: `Build scene <name> from scenes/<name>/BRIEF.md.`
  4. Select the new scene in the picker.
- The motion-graphics Brief step reads BRIEF.md when present and doesn't ask again what it answers.
- Re-run: the scene's ⋯ menu gets **Edit brief & send again**, which opens the window prefilled from BRIEF.md.

## 5. Tests
- Engine: `tests/project.test.mjs` (`gfx look` list/use/update/save/new, gfx.json fields, the managed block lines for
  the workflow profile and the look, preset copy).
- Studio unit tests: the settings schema for `workflow` and `libraryDir`.
- E2E:
  - library check (new): browse, create, edit, use in a project, update-from-library offer, palette add/audition/remove;
  - new-scene check (new): the window → scene created, BRIEF.md content, refs copied, message sent to the terminal and
    the T3 mock;
  - settings check: the First take row, project override.
- Skills: the managed-block lines and the skill wording, reviewed by reading.

## As built (engine, CLI, skills; 2026-10-16)
- **Workflow** (§1): `runner/lib/workflow.js`. Values: `"quick"`, `"full"`, or `{ verify: "sheet"|"stills"|"full",
  render: bool, sound: "asked"|"always" }` (missing fields from Quick). Precedence: gfx.json `"settings".workflow` →
  machine default → quick. The studio passes the machine default with `--workflow quick|full|<json>` on `gfx init` /
  `gfx init --refresh [--no-skills]`; the engine remembers it in `.gfx/workflow.json` so later refreshes without the flag
  keep it. Block lines: `Quick first take: 1 contact sheet, no render, sound only if asked.` · `Full first take: contact
  sheet + stills at every beat (2 passes), render when done, sound always.` · `Custom first take: <verify>, render when
  done|no render, sound always|sound only if asked.` (verify = `1 contact sheet` | `contact sheet + key stills` |
  `contact sheet + stills at every beat (2 passes)`), all prefixed `Workflow (this project): `.
- **Looks** (§2): `runner/lib/looks.js` (slug ids, `inside()` lexical + realpath containment, regular files only, staged
  copy then swap) and `gfx look list|use|update|save|new|seed` (`runner/lib/cli/commands/look.js`; usage in
  CONTRACT.md). Content hash = sha256 over `"<rel>\n<sha256(bytes)>\n"` per file in code-point order (same scheme as
  the skills hash, so Rust can reuse it); `.DS_Store`/`Thumbs.db`/`desktop.ini` and symlinks are ignored. `look list
  --json` gives the studio everything for "Update from library": `look.updateAvailable` (library ≠ pin, project copy
  unedited) and `look.conflict` (both changed → show both). `update`/`save` default the library to
  `lookSource.library`; refusals exit 2 with `--json` `{ status: "conflict", projectHash, libraryHash, recorded }`.
  `look-<id>.js` gets a one-line "generated" header. `gfx new` defaults `--style` to `look-<id>`.
- Additions beyond the spec: `gfx look use <id>` without `--library` uses a look that exists only in the project (e.g.
  after `gfx look new`), with no `lookSource`; `gfx look save <id>` saves any project look; `--force` on `use`/`save`;
  `gfx look seed --library <dir>` (starters from `templates/looks/`, since `library/` is gitignored).
- **Starters** (§3): `templates/looks/clean-dark/` (dark-grid preset, calm/technical, 7-entry palette; a second, personal brand
  starter was removed on 2026-10-18); `_new/` is the
  `look new` scaffold. Palettes use synth sounds/variants only.
- **Skills** (§2, §4): motion-graphics has a "Project lines" note (Quick/Full/Custom meaning for steps 7-9, request
  overrides, review fixes always get stills; the Look line → read LOOK.md at Brief/Style/Build) and reads
  `scenes/<name>/BRIEF.md` + `refs/` at the Brief step (`Kind: Auto` → choose, re-scaffold from
  `<engine>/templates/<kind>`). sound-design has "Look palette first" (read LOOK.md Sound + `sounds.json`; outside sounds
  only for roles without an entry, listed in the report).
- Tests: tests/project.test.mjs "workflow profiles" and "looks" sections.

## As built (studio: New scene window §4; 2026-10-16)
- `apps/studio/web/src/newscene.js` (window, create flow) + `newscene-core.js` (formats, kinds, take defaults, name check,
  BRIEF.md write/read; `newscene-core.test.js`) + `newscene.css`. Entry points in main.js / index.html: **+**
  (`#scene-new`) next to the picker, "Create your first scene" (`#empty-new`, only while the project has no scenes),
  **Brief** (`#brief-btn`, shown when the open scene has BRIEF.md; = the spec's "⋯ → Edit brief & send again", the
  studio has no scene ⋯ menu), **Library** (`#library-btn`, shown only if `library.js` exports `openLibrary`; loaded with
  `import.meta.glob`, so a missing module is not an error).
- Window: modal (`.modal-back`, everything behind is inert, Tab stays inside, Esc closes, Ctrl+Enter creates; a click
  on the backdrop does not close it, so a typed prompt is not lost). Name: `^[a-z0-9][a-z0-9._-]*$`, ≤ 64, unique
  against the scene list (case-insensitive); the error suggests a slug. Prompt required. Format chips 16:9 1920×1080 ·
  9:16 1080×1920 · 1:1 1080×1080 · 4:5 1080×1350 · Custom W×H (even, 16–7680), fps 30/60, duration 0.5–600 s.
  Look: the project look (gfx.json `look`, name from LOOK.md frontmatter), Library looks (`gfx look list --library
  <libraryDir> --json` → `looks`), or a style preset (the engine's dark-grid / nightfall + the project's
  `style/presets/*.js`; no backend op lists the engine's presets folder, so the built-in names are a constant). Kind chips
  Auto / anime / svg / canvas / three. This take: Quick / Full / Custom from the `workflow` setting (Custom shows Verify:
  sheet / sheet + key stills / full); Sound and Render when done checkboxes (picking a take resets them to its defaults).
  Send to: Terminal / New T3 thread (disabled unless T3 is connected at Standard or Full; the last choice is remembered).
- References: Add files… (`api.pickRefs()`), a drop of paths-as-text or links, or the app's WebView2 drop hook
  (`chrome.webview.postMessageWithAdditionalObjects('gfx-drop', files)` → `gfx://dropped` paths; the main window needs
  that hook, see below), pasted / typed links; each with a note. Without `api.importRef` the file buttons are disabled
  ("References need a newer app"); links still work. Files are copied on Create with `api.importRef(src,
  'scenes/<name>/refs/<file>')` (file name sanitised to `[\w.-]`; the backend may return another name, which is used).
- Create: Library look → `gfx look use <id> --library <dir>` first; style = `look-<id>` when
  `style/presets/look-<id>.js` exists, else dark-grid. `gfx new <name> --kind <kind | anime for Auto> --size WxH --fps N
  --dur S --style <style>` → refs → BRIEF.md (`writeProjectFile`, mtime-checked) → scene list refreshed, the scene
  selected (not when the open scene has unsaved draft / code edits: a toast says so) → auto checkpoint (`beforeAsk`) →
  terminal (`sendToClaude(msg, { send: true })`) or `t3.send({ target: 'new', message, title: <name> })`. A failure
  after `gfx new` keeps the window open in edit mode ("Save brief & send" retries without scaffolding again).
- Edit brief & send again: prefilled from BRIEF.md + scene.json (scene.json wins for size / fps / duration / style);
  the name is locked; changed size / fps / duration / style are written to scene.json (the kind stays the brief's: Claude
  switches it); existing refs stay listed (removing one only drops it from the brief, the file stays); message
  `Build scene <name> from scenes/<name>/BRIEF.md. The brief changed: the scene exists already, rework it to match.`
- BRIEF.md format (parsed back by `parseBrief`: Prompt = text between `## Prompt` and the last `## Settings`; Settings =
  the first word of each `- Key: value`; References = `- <path or link>[ — note]`):
  ```
  # Brief: <name>
  <!-- Written by gfx studio … keep the headings and the "- Key: value" lines. -->
  ## Prompt
  <the prompt>
  ## Settings
  - Format: 1080x1920, 30 fps, 4 s (9:16 reel)
  - Kind: svg | auto (scaffolded as anime as a placeholder: choose the kind …; re-scaffold …)
  - Style: look-clean-dark
  - Look: clean-dark (looks/clean-dark/LOOK.md: read it at the brief, style, build and sound steps; …) | none (style preset only)
  - Take: quick | full | custom (…)
  - Verify: sheet | stills | full (…)
  - Sound: yes (…) | no (skip sound unless the prompt asks for it)
  - Render when done: yes (…) | no (the user renders from gfx studio)
  ## References
  - scenes/<name>/refs/board.png — the colours
  - https://example.com/x — note
  - none            (when there are none)
  ```
- Tests: `newscene-core.test.js` (5); E2E `out/studio-newscene-check.mjs` (57 checks; own dev server on 5196 + the T3
  mock; fixture project `/tmp/gfx-newscene-proj` with a pinned look + Library `/tmp/gfx-newscene-lib`, removed after).
- Not verified in the real app: the native file picker, a drop from Explorer (the main window has no WebView2 drop hook
  yet: welcome.rs `hook_drop` only emits to the welcome window), Claude Code itself receiving the message.

## As built (studio: First take setting §1, Library folder + Library page §3, backend ops; 2026-10-16)
- **Settings** (`settings-core.js` + its Rust twin `prefs.rs`): `workflow` (per project; `"quick"` | `"full"` | `{ verify,
  render, sound }` = Custom, missing fields from Quick, unknown keys dropped; default quick; machine value equal to quick =
  "not set") and `libraryDir` (machine; absolute path, `\\wsl.localhost\…` allowed; `''` = `<Documents>/gfx library`, the
  default comes from `settings_meta`). Settings → Claude & terminal → **First take**: Quick / Full / Custom, Custom shows
  Verify (Contact sheet / Sheet + key stills / Full (2 passes)), Claude renders (On / Off), Sound (If asked / Always).
  Because the row is per project, the Claude & terminal page now has the scope sentence, and its machine-only rows (Shell,
  Claude command, Ask send) are read-only at project scope ("Applies to this computer"), as on every scoped page.
  Settings → General → **Library folder** (path + Browse…, ↺ = the default).
- **Managed block refresh** (§1): every `workflow` change (either scope, ↺ too) runs `refresh_workflow_block` = `gfx init
  --refresh --no-skills --workflow <this computer's default>` in the open project (skipped without gfx.json and for an
  engine checkout; an error is a toast, the setting stays saved). `--workflow` is `quick` / `full` / the custom object as
  JSON (`prefs::workflow_arg`, JS `workflowArg`). On project open (`project_opened`) the refresh also runs when the
  project's `.gfx/workflow.json` (written by the engine's `--workflow`) differs from this computer's default (another
  project changed it), and every refresh passes `--workflow`. The block comparison ignores the project-specific
  `- Workflow (this project): …` / `- Look: …` lines and the template's `{{workflow}}` / `{{look}}` placeholders
  (`lib.rs block_shape`, shim twin), so those lines alone never count as an outdated template.
- **Backend ops** (Rust `src-tauri/src/library.rs`, dev-shim twins in `vite.config.js`, guard twin `library-core.js`; API.md
  "Library"): `library_files`, `library_read` (text ≤ 1 MB, UTF-8), `library_read_bytes` (images inside a look ≤ 20 MB),
  `library_write` (`.md .js .json .txt` ≤ 1 MB, atomic, folders created), `library_delete`, `library_copy` (Duplicate: same
  kind, target must not exist), `library_import` (a picked file into `looks/<id>/refs/`), `import_ref` (a picked file into
  the project, only `scenes/<name>/refs/<image or video>`, ≤ 200 MB, the scene folder must exist, name cleaned, never
  overwrites: `x-2.png`), `pick_refs` (multi-select of images / videos), `refresh_workflow_block`. Paths are relative to the
  Library folder and limited to `looks/<id>[/…]` (slug ids, ≤ 4 levels, no dot names), `presets/<name>.js`,
  `palettes/<name>.json`; symlinks never lead out of the folder (canonical containment check; a symlinked look is
  deleted as a link). JS: `api.libraryFiles/Read/ReadBytes/Write/Delete/Copy/Import`, `api.importRef(src, rel)`,
  `api.pickRefs()`, `api.refreshWorkflowBlock()`. The dev shim's `pickRefs` is a prompt (paths separated by `|`).
- **Library page** (`library.js` + `library.css`; `openLibrary(tab?)` / `closeLibrary()` / `libraryOpen()`): a full page in
  the Settings frame (breadcrumb Library / tab / item, ← Back + Esc, the Library folder + Change folder… → Settings row),
  left column = tabs with counts + **This project** (its look; "Same as the Library" / "The Library has a newer version" →
  **Update from library** / "Edited here, and the Library copy changed too" → **Compare…** (LOOK.md side by side in a
  CodeMirror merge view, then **Keep this project's** = `gfx look save --force` or **Take the Library's** = `gfx look use
  --force`) / "Edited here" or not in the Library → **Save to library**). Everything comes from `gfx look list --library
  <dir> --json` (`look.updateAvailable` / `look.conflict`), so the hashes stay the engine's.
  - Looks: filter, cards (thumbnails of up to 3 ref images, else the preset colours; name, description, tags, swatches
    from preset.js `colors`, sound / ref counts, "in this project" badge), Edit, **Use in this project** (`gfx look use
    <id> --library <dir> --workflow <machine> --json`; when the project has a different own copy: confirm, then
    `--force`), Duplicate (prompt for the id; LOOK.md name gets "(copy)", preset.js renamed), Delete (confirm naming the
    folder). New look: **Blank** (LOOK.md with the §2 sections, the dark-grid preset renamed, `[]` palette), **From this
    project's style** (the project look's preset, else the open / first scene's `style` from `style/presets/`, else the
    built-in preset), **Ask Claude from references…** (name, notes, references via `pickRefs` with a note each → closes
    the page and opens the Ask Claude composer with a brief to write LOOK.md + preset.js + sounds.json + refs/ into
    `<Library>/looks/<id>/`; paths shown as WSL paths when the project is in WSL; needs an open scene, as the composer
    does). Look editor tabs: LOOK.md and preset.js in CodeMirror (Save / Revert / Ctrl+S, unsaved marker, confirm on
    leave), Sound palette, References (thumbnails, Add references… → `library_import`, × delete).
  - Presets: list with swatches, New preset (from a built-in), Edit (CodeMirror), Duplicate, Delete.
  - Sound palettes: list, New palette, Edit, Duplicate, Delete. **Palette editor** (looks' `sounds.json` and standalone
    palettes, saved as you edit, one entry per line): rows role · sound (synth: sound + variant selects, params shown;
    sample: name + pack) · ▶ · tags · note · ×; **+ Synth sound**; **+ From sound library…** = a filter by name / pack over
    the studio's sound-library index (`soundindex.js`, formerly Perform's `vox.js`; `<project>/library`), plus **Smart search** = `gfx lib search
    "<text>" --n 20` (CLAP; library hits are added by `src` = the library-relative path, with `start` / `dur`, synth hits as synth entries with
    variant + intensity / dur params). **Audition**: synth entries are rendered by the harness synth (`@sfx` `makeCue` +
    `renderStems`, as the draft audition does) and played once; samples are decoded from the library (`readLib`) and
    played from their index `start`.
  - An empty Library offers **Add starter looks** (`gfx look seed`) and New blank look. Status changes refresh only the
    left column while a form, editor or compare view is open (no re-render under the user).
  - Keys: Esc = leave a field → close the picker / form / item → back to the workspace (registered as `dlg.library` in
    the key registry, with a dialog probe so workspace shortcuts are off while the page is open). Opening Settings closes
    the Library page and vice versa.
- **Tests**: Rust +4 (`prefs::workflow_and_library_dir`, `library::{library_paths, library_ops, import_refs}`; plus
  `engine_records` covers `block_shape`, `workflow_outdated`, `refresh_args --workflow`), 67 in all. `library-core.test.js`
  (3), `settings-core.test.js` (+1, 10). E2E `out/studio-library-check.mjs` (92 checks; own dev server on 5197, fixture
  project `/tmp/gfxlib-work/proj` from `gfx init --template reel` with `library/` linked to the repo's sound library, Library
  `/tmp/gfxlib-work/library`, all removed after): shim guards + `import_ref`, empty state, seed, cards, filter, new look +
  CodeMirror + Ctrl+S, preset tab, palette edits / audition (synth + sample) / library add / Smart search / remove, refs
  add + delete, Use in this project (gfx.json, looks/, CLAUDE.md look line), update offer + update, conflict → Compare →
  take the Library's, Save to library, Duplicate, Delete (cancel + confirm), presets / palettes tabs, Esc, Ask Claude from
  references → composer, First take at project + machine scope → gfx.json / settings.json + the CLAUDE.md workflow line.
  `out/studio-settings-check.mjs` +17 (First take row, scope, read-only machine rows, override / Custom / chain / ↺,
  machine default; Library folder row, inline error, Browse…, ↺).
- **Deviations / limits**: the sound-library picker reads `<project>/library` (as Perform did, removed 2026-10-19), so a project without its own
  `library/` shows no samples (the engine repo has it); synth entries are offered from Smart search and + Synth sound.
  Presets have Delete too (not in the spec). Not verified in the real app: the native multi-file picker (`pick_refs`),
  WSL / UNC Library folders through `\\wsl.localhost` in the exe, `gfx look …` through a WSL engine with a Windows Library
  path (`wsl_arg` maps it to `/mnt/c/…`), audio audition in WebView2.

### As built: look friction round (lane 3)
- New look with Claude: **Start from** = Prompt only (default; switches to References when a reference is added) /
  References / This project / Both; BRIEF.md `startFrom: prompt` (no `project:` line); the prompt-only path skips
  `gfx look analyze` and marks every rule as judgement (look-design skill). Look cards and the preset list show up to 8
  swatches: bg, text, accent, surface, then the preset's own extra colour keys, then grid / muted / border; a hex
  already shown is skipped (`presetSwatches`).
- Skills: look-design (prompt-only, `--sheet` / `check` / `audition`, `lib files` / `lib info`, `weak` matches,
  palette format, `--gfx-font-<key>`, test-card timing, `inkContrast`), sound-design (palette format, `beep` / `wind`),
  animejs (hard cuts, keyframes, spring duration, blur overshoot).
