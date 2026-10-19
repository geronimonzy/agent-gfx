# Project templates (spec, 2026-10-18)

Templates are their own feature: more built-in project templates, preview clips and thumbnails on the welcome cards,
and **Save as template** from any project or scene into a per-user template library that New project also lists.
Related: docs/HOME-SETTINGS.md §1 (welcome window, New project), docs/INSTALL.md §2 (WSL routing), docs/LOOKS.md
(Looks are a different thing: a style/motion guide, not starting files).

## 1. Template folder (one format for built-in, saved and later shared templates)
```
<id>/
  template.json        metadata (below); not copied into projects
  thumb.jpg            thumbnail, long side 480 px, JPEG (optional; not copied)
  preview.mp4          preview clip, long side 480 px, 24 fps, ≤ 6 s, H.264, silent (optional; not copied)
  scenes/<scene>/...   the starting scenes (scene.json, scene.js, STORYBOARD.md, sound.json, tweaks.json, assets…)
  style/...            project style presets (style/presets/*.js), copied as is
  looks/<id>/...       optional pinned look (docs/LOOKS.md §2)
```
`template.json`:
```json
{ "version": 1, "title": "Product promo", "description": "One line for the card.",
  "tags": ["16:9", "promo"], "preview": { "scene": "promo", "t": 6.4 },
  "gfx": { "look": "…", "settings": { … } }, "engine": ">=0.2",
  "created": "2026-10-18T…Z", "from": { "project": "My project", "scene": "promo" } }
```
All fields optional (a folder with only `scenes/` is a valid template; `blank` has no template.json). `gfx` = keys merged
into the new project's gfx.json (`look`, `settings`; never `name`/`engine`/`lookSource`). The card's aspect, size and
duration come from the preview scene's scene.json at list time (never stale). A template folder is self-contained
(no absolute paths), so it can be zipped and shared later; `gfx init --template <folder>` already accepts one.

Not copied into a project: `template.json`, `thumb.*`, `preview.*`, and anything init writes or owns (`gfx.json`,
`CLAUDE.md`, `AGENTS.md`, `.gfx/`, `.claude/`, `.git/`, `out/`, `node_modules/`).

## 2. Built-in vs user templates
- **Built-in:** `<engine>/templates/projects/<id>/` (shipped, read-only, `_shared` excluded): `blank`, `reel` (9:16),
  `promo` (product promo 16:9), `sting` (logo sting 16:9), `explainer` (16:9, step diagram + caption track), `square`
  (social 1:1). Each non-blank one has thumb.jpg + preview.mp4 made by the engine itself (`gfx template save`).
- **User library (user decision 2026-10-18: in Documents, beside the Looks):** `GFX_TEMPLATES`, else
  `<library>/templates/`, next to `looks/` in the Library folder (docs/LOOKS.md §3). `<library>` = `--library <dir>`
  (gfx studio passes its Library folder setting, default `<Documents>/gfx library`), else the engine's own default
  `<Documents>/gfx library` in its environment (Windows `%USERPROFILE%\Documents`; Linux/WSL `XDG_DOCUMENTS_DIR` from
  `user-dirs.dirs`, else `~/Documents`; when Documents exists but is not a folder, e.g. a symlink loop, the home folder).
  **Per environment** (user confirmed): the studio passes `--library` only when the Library folder and the target
  folder / project are in the same environment (both Windows, or the same WSL distro); a WSL project's engine otherwise
  uses `~/Documents/gfx library/templates` in its distro. So Windows and WSL templates stay separate.
- **Old folder:** the first build saved to `<user data>/templates` (`%APPDATA%\gfx\templates`,
  `~/.local/share/gfx/templates`). When it exists it is still listed and usable, read-only (`legacy: true`; remove
  refuses with the path); nothing is moved. Neither old folder existed on this machine at the change.
- **Refs:** built-in = `<id>`; user = `user/<id>`. `gfx init --template <id>` takes a built-in first, then a user
  template; `user/<id>` is explicit; a path (contains `/` or `\` and is a folder) is a template folder. Saving with a
  built-in id is refused (pick another name).

## 3. Engine commands (`runner/lib/cli/commands/template.js`, `runner/lib/templates.js`)
- `gfx template list [--for <folder>] [--json]`: built-in + user templates. JSON: `[{ ref, id, source: "builtin"|"user",
  title, description, tags, scenes, width, height, aspect, duration, kind, dir, thumb: "data:image/jpeg;base64,…"|null,
  preview: bool, created }]`. `--for` only routes the command to the engine of that folder (studio, WSL folders).
- `gfx template preview <ref> [--for <folder>]`: one JSON line `{ ref, mime: "video/mp4", data: <base64> }` (welcome
  hover clip; a separate call keeps the list small).
- `gfx template save [--scene <name>] [--name "Title"] [--id <id>] [--description ".."] [--t <sec>] [--no-preview]
  [--force] [--json]` (current project): whole project, or one scene (+ `style/` and the project's look). Copies into
  `<library>/<id>.tmp`, makes thumb + clip with `gfx still` / `gfx render` on the source project (failure = saved
  without a preview, with a warning), then swaps into `<library>/<id>` (`--force` replaces; otherwise an existing id is
  an error "already exists"). `id` defaults to the slug of the title. Progress phases `copy`, `thumbnail`, `preview`.
- `gfx template remove <ref>`: user templates only.
- `gfx init <dir> --template <ref>`: as today plus refs, user templates, folders, and `template.json` `gfx` keys.

## 4. Studio
- **Welcome / New project (welcome.js):** templates come from `gfx template list --for <chosen folder> --json`
  (engine_run, no project; `template` commands with `--for` route like `init <dir>`: a WSL folder → that distro's
  engine, lib.rs `spec_for` + the dev twin). Cards: thumbnail (16:9 box, image contained), on hover/focus the preview
  clip plays muted in place (fetched once per ref with `template preview`, cached as a blob URL; not with
  prefers-reduced-motion), title, `aspect · duration`, description. Two groups: **Built in** and **Your templates**
  (shown when there are any; ⋯ → Remove… with `await api.ask`). The first-run hero shows the same cards. Create
  validates the ref against a fresh list for the chosen folder (as today).
- **Save as template (main window, `savetemplate.js` + `.css`):** scene menu → **Save as template…** opens a dialog:
  What (This scene "<name>" / Whole project, N scenes), Name (default: scene title or project name), Description,
  Preview clip checkbox (on), Save. Runs `gfx template save` in the project with progress; an existing name shows
  "A template with this name exists" + **Replace**. Done → toast "Saved template ‹title›: shows in New project".
- The Rust `list_templates` op stays (string ids) for other callers; the welcome window no longer uses it.

## 5. Tests
- `tests/templates.test.mjs` (engine, GFX_TEMPLATES in a temp dir): list (built-ins with metadata, thumb data URL),
  init from each built-in (scene.json valid, meta files not copied), save project / scene (`--no-preview`), refs,
  collisions, `--force`, built-in id refused, remove, init from `user/<id>` and from a folder, gfx keys merged.
- Rust unit test: `template … --for \\wsl.localhost\…` routes to the WSL engine.
- E2E `out/studio-templates-check.mjs` (dev shim, GFX_TEMPLATES temp): welcome cards with thumbnails, hover clip,
  user group + Remove, New project from a template, Save as template dialog end to end.
- Each new template rendered once (`gfx still`, sheet) and looked at.

## As built (2026-10-18)
- **Engine:** `runner/lib/templates.js` (folder format, `userTemplatesDir()`, `listTemplates`, `resolveTemplate`,
  `copyTemplateFiles`, `describe`), `runner/lib/cli/commands/template.js` (`list` / `preview` / `save` / `remove`,
  `makePreview`: `gfx still --scale` → JPEG via ffmpeg (PNG kept if ffmpeg is missing) and `gfx render --scale --fps 24
  --dur ≤6 --crf 30`, both as child processes on the source project, so nothing is written to its out/ besides the
  usual Vite cache). Default thumbnail time: 80% of the duration. Options added to args.js: `--for --id --description
  --scene --no-preview`. `gfx init` resolves refs with `resolveTemplate`, merges template.json `gfx.look/settings` into
  gfx.json (so the CLAUDE.md workflow/look lines follow) and never copies meta or owned names.
- **Built-ins:** `promo` (anime, 8 s, 13 named elements, 26 cues), `square` (anime 1:1, 6 s, ring via
  `svg.createDrawable`, 19 cues), `sting` (svg kind, 4 s, seeded burst, 9 cues), `explainer` (anime, 10 s, paper
  preset, `CAPTIONS` array → caption bar, 14 cues); copy and timings are constants at the top of each scene.js. Presets
  `ink` (dark) and `paper` (light) ship inside the templates (Inter + IBM Plex Mono from /style/fonts). Previews were
  made with `out/tpl-work/make-previews.mjs <ids>` (init a temp project, `makePreview` into the template folder):
  ~9–51 KB clips, 9–28 KB thumbnails (≈220 KB for all five). Card order: blank, promo, reel, square, explainer, sting.
- **Studio:** welcome.js lists via `engineCapture(['template','list','--json','--for',folder], {noProject})`; an
  engine without `gfx template` (older install) falls back to the `list_templates` op (names only). Cards: 16:9 media
  box (`container-type: inline-size`, height = 16:9 of the card width rounded down to whole pixels, min
  `--welcome-template-media-h`), thumbnail `object-fit: contain`, clip on hover / keyboard focus-visible (not with
  reduced motion), ⋯ → Remove template… (`await api.ask`). Save as template: scene menu item (`save-template`, only
  when the action is wired), `savetemplate.js` / `.css` / `-core.js` (Esc = `dlg.savetemplate`, registered on first
  open; Tab loop; Cancel kills the job). Routing: lib.rs `no_project_target()` (init dir, `template … --for`) + the
  vite.config.js twin.
- **Tests:** `tests/templates.test.mjs` 49 · `savetemplate-core.test.js` 5 · Rust `no_project_targets` (81 total) ·
  `out/studio-templates-check.mjs` 22 (cards, thumbnails decode, hover clip 480×270 plays, New project from promo,
  Save dialog → engine thumbnail + clip, exists → Replace, Esc, Your templates + Remove) · welcome check updated
  (six cards; GFX_TEMPLATES temp) 42 · newscene 57 · project tests 148 · welcome pixel grid PASS.
- **Not done / limits:** user libraries are per engine host (Windows vs each WSL distro), no import/export UI (copy
  the folder; `gfx init --template <folder>` works); no edit of a saved template's title/description in the UI (edit
  template.json); a template saved from a project whose scenes use engine-only presets relies on the target engine
  having them; not exercised in the real Windows app yet.

## As built: library in Documents + review fixes (2026-10-18, after 27df175)
- `templates.js`: `documentsDir()`, `defaultLibraryDir()`, `setTemplateLibrary()` (`--library` on `template *` and
  `init`), `legacyTemplatesDir()` listed read-only (`legacy: true`, the new library wins on the same id). Studio:
  `libraryArgs(lib, target)` in savetemplate-core.js (same-environment rule) used by welcome.js (list, clip, remove,
  init) and the Save dialog (Library folder = `pref('libraryDir')` incl. its default). Folder name `templates/`
  (lowercase, like `looks/`, `presets/`, `palettes/`). Welcome cards of legacy templates have no ⋯ menu.
- WSL here: `~/Documents` is a symlink to itself, so the engine falls back to `~/gfx library/templates`.
- Codex P2s: the Save dialog ignores the completion and progress of a cancelled job (dialog + job identity; reopening
  cancels a running one); the welcome window lists templates again on focus and on entering New project (re-renders
  only when the list changed; user clips refetched).
- Tests: templates 58 (temp HOME: Documents default, XDG_DOCUMENTS_DIR, `--library`, legacy listed / init / remove
  refused, Documents loop), savetemplate-core 6, E2E templates 24 (+ welcome window refresh on focus, cancelled save vs
  reopened dialog), welcome 42, project 148.
