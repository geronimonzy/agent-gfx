# Element inspector and object code (spec, 2026-10-16)

User feedback from the real-app walkthrough (test-project-1, `orbit` moon selected):
1. a simpler look;
2. see the actual values and change them directly;
3. "Code" opens the code for this object, not the whole scene. The user called this the most important, because
   everything starts from the code.

Decisions (user, 2026-10-16):
- Object code = **B + A fallback**: scene code marks each named object's blocks (convention in the skills), and gfx shows
  exactly those blocks. Scenes without markers get a traced or heuristic view.
- Value edits go to the **tweak layer** as today (draft → tweaks.json, folded into code by Claude or `gfx apply`).
- Build #1–#3 together with walkthrough findings 17 and 18 (docs/JOURNEYS.md).

## 1. Object code (#3)

### 1a. Marker convention (B)
Scene code wraps each named object's code in line comments. Every kind uses the same form:
```js
// @gfx moon
moon = new THREE.Mesh(new THREE.SphereGeometry(MOON_R, 32, 24), mat);
moonPivot.add(moonRing, moon);
// @end
```
- A key may have several blocks: setup, render, CSS in a template string, sound cues. Blocks don't nest. A block belongs
  to the key named on its `// @gfx` line; `// @gfx moon earth` assigns one block to several keys.
- CSS: `/* @gfx title */ … /* @end */` inside a CSS template literal or a `.css` file. HTML in a template literal can
  use `<!-- @gfx title --> … <!-- @end -->`.
- Markers are comments only. They never change what renders, so renders stay byte-identical.
- Skills (motion-graphics + each kind skill) tell Claude to write these blocks for every named element: creation,
  styling, per-frame code and its sound cues. Keep each block tight, and put shared helpers outside blocks. Templates
  under `templates/` show the convention. Older scenes without markers (e.g. `scenes/_reel-test`) are not rewritten.

### 1b. Fallback (A) when a key has no markers
- **anime/DOM:** the refs gfx already has (`code {key}`: named, defined, styled, animated, sound; docs/CODE-VERSIONS.md
  "Element ↔ code") give the lines. Each ref line expands to its enclosing statement (balanced brackets, up to ~30 lines).
- **three/canvas (virtual elements):** start at the `ctx.el('key', …)` call. Collect the identifiers it references
  (e.g. `moon`, `MOON_R`), then the lines that declare, assign or use them in the scene's files (word-boundary match,
  skipping strings and comments), each expanded to its statement. Cap at ~40 regions. Label the view
  "traced (approximate)".
- Nothing found: show the file with the `ctx.el` / `data-gfx` line highlighted.

### 1c. Object view in the editor
- The inspector's **Open code** button, and Code mode with an element selected, open the scene file(s) in an
  **object view**: CodeMirror folds everything outside the object's regions, the regions stay editable, and a header
  shows `moon · 3 blocks · scene.js` (+ other files), with **Show whole file** to unfold.
- Editing and saving works as in Code mode today (source guard, live reload, auto-checkpoint rules).
- With several files, a small file list shows the files with regions; with several regions, Alt+↓/↑ jumps between them.
- Region discovery runs in the engine-side code module (`runner/player/code.js`, bridge `code {key}`), so the bridge
  and the CLI share it. It returns `{ regions: [{ file, from, to, kind: 'marked'|'traced'|'ref', label }], marked: bool }`
  next to `refs`.

As built (§1, 2026-10-16; `runner/player/code.js` `codeRegions`, bridge `code`, studio `code.js` / `cm.js`):
- Bridge `code { key }` -> `{ refs, regions: [{ file, from, to, kind, label }], marked, tweakable: { props, read } }`
  (lines 1-based inclusive; `codeRegions({ files, key, refs, node })` is a pure function of the scene files, tested in
  node). Files: the `.js/.css/.html` of `/__gfx/scene-files` (`.json` is skipped).
- **Markers:** `@gfx` opens a block (`//`, `/* */` or `<!-- -->`; the keys are the words after `@gfx`, so no free text on
  that line), `@end` closes it; the marker lines are part of the region. Open + close on one line = a one-line block.
  A new `@gfx` while a block is open ends the open one on the line before (no nesting); a block without `@end` runs to
  the end of the file; both are labelled `(unterminated: no @end)`. Any marker for the key -> `marked: true` and only
  the marked blocks (no fallback). Label `@gfx <keys>`.
- **Fallback, refs** (kind `ref`, label = ref kind + t0–t1 / cue): every ref line expands to its statement. JS is
  masked first (comments, strings and template-literal text blanked; `${}` code kept; regex literals), then: innermost
  enclosing block `{` (after `)`, `=>`, `;`, `{`, `}`, `else/try/finally/do`; other `{` = object literal), back to the
  previous `;` or block `}` at that level, forward to the next `;` / closing block `}` (not before `else/catch/finally`,
  `.`, `,`, `)`). Statements over 30 lines -> the line alone. Lines inside a template literal or a `.css` file -> the CSS
  rule around them (raw braces, ≤ 10 lines up / 30 down), else the line. `.html` -> the line.
- **Fallback, traced** (kind `traced`): identifiers inside the `ctx.el('key', …)` call (property names, object keys,
  keywords, `ctx`/globals dropped), resolved in that file (imported names: in the scene file that declares them).
  Identifiers named like the key (normalised: `moon`, `MOON_R`, `moonTexture` for `moon`) are traced fully (declaration,
  assignment and use lines; uses skipped when an identifier has more than 15), plus one more level: identifiers named
  like the key inside the statements found. With no such identifier, the call's other non-function identifiers are
  traced (e.g. `bg` for `ctx.el('background', bg)`). Used for virtual elements, and for DOM elements whose refs have no
  `defined`/`styled`/`animated` entry. Regions of both kinds are merged when they overlap or touch (`ref` wins), labels
  joined; capped at 40. No refs and no identifiers -> `regions: []` (the studio then opens the named/first ref line).
- **tweakable:** `ctx.tweak('key')` / `tweak("key")` outside comments/strings. Props: `.x` / `?.x` / `['x']` right
  after the call, destructuring (`const { x, y: ty, scale = 1 } = …`, `...rest` = all), a `const tw = …` variable's
  property reads (any other use of the variable = all); the call passed on as a whole = all of x, y, scale, rotate,
  opacity. Order: those five first, then other props (e.g. `color`). Never read -> `{ props: [], read: false }`.
- **Object view** (`code.js` `openObjectCode(key)`, exported for the inspector; `closeObjectCode()`, `objectState()`):
  enters Code mode through main.js's mode switch (`setEnterCode`), waits up to 10 s for Live, asks `refsFor(key)` (now
  also `regions`, `marked`, `tweakable`), opens the first region's file with the cursor on the first block. `cm.js`:
  a state field holds the regions (mapped through edits) and draws a left amber edge on their lines; everything outside
  them is folded with `foldEffect` (placeholder `⋯ N lines`, click unfolds that gap; moving the cursor into a fold
  opens it). Header `#code-obj` (between banner and editor): `◎ key · N blocks · file` (+ "other files"), or
  `traced (approximate) · N regions`, ↑/↓ (= Alt+↑/↓ in the editor, wraps; without regions Alt+↑/↓ stays move-line),
  **Show whole file** / **Fold to object**, ×; a file list when the regions span files; the refs as compact chips (click
  -> `openRef`, animated chips set the timeline band on hover). Other tabs: regions apply when the tab is activated; a
  tab switch keeps folds the user opened. In Code mode, selecting another element in the picture re-opens the view for
  it. After a live reload the regions are re-fetched and re-applied only when the active file's marked lines differ
  (e.g. Claude rewrote the file) and no file of the object is dirty. Leaving Code mode, switching scene/project closes
  it. Save, source guard, disk sync and checkpoints are unchanged. `renderRefs` and the Code links panel still work.
- Not done: a CLI entry for regions; `?` help entry for Alt+↑/↓ (keymap.js belongs to another builder this round).

## 2. Inspector values (#2)
- One value per property. **x / y / scale / rotate / opacity** show the actual value at the playhead (today's ACTUAL:
  centre x/y on screen, accumulated scale/rotation, effective opacity) in an editable field.
- Typing a value sets the tweak so that the actual becomes the typed value: delta = typed − (actual − current tweak),
  for scale and opacity as a ratio. Rounded like today (r3). Undo and the 900 ms coalescing window work as today.
- While playing, fields update with the playhead (except the focused one). A field the tweak changed shows a small dot
  and a per-field ↺ (reset that property).
- **Virtual elements** (`ctx.el(key, { bounds })`, canvas/three) can't be moved by the studio unless the scene reads the
  tweak. Static check: `ctx.tweak('key')` in the scene files, plus the properties used (`.scale`, `.x`, …). Only those
  fields are editable; the rest are read-only with the tooltip "This object is drawn by code; ask Claude or edit its
  code". Same rule for colour/bg.

As built (§2, 2026-10-16; `apps/studio/web/src/elements.js`, `paths.js`):
- The five number fields carry `data-act`; `paths.applyActual` fills them from the bridge `values` (cx, cy, scaleX,
  rotate, opacity; `paths.actualOf(key, prop)`), skipping the focused field. Non-uniform scale: the field shows scaleX,
  its tooltip both. The field is dimmed when the element is not visible at the playhead. Empty until the first values
  arrive; if the bridge answers without values, the field shows the tweak (old behaviour) and typing sets it directly.
- Typing: x/y/rotate tweak = typed − (actual − tweak); scale/opacity tweak = typed / (actual / tweak). The scene's own
  part (actual − tweak, actual / tweak) is taken once per focus, so keystrokes that land before the live picture caught
  up still compute from the right base. An opacity tweak of 0 (the scene's part is unknown) sets the typed value
  directly; a scene part of 0 (e.g. the scene's own opacity is 0 here) can't be reached by a ratio: toast, no edit.
  Clamped as before (scale 0.05–20, opacity 0–1), rounded r3, undo key `tw:<key>:<prop>` with the 900 ms window.
- Per-field ↺ = `editTweak(key, { prop: null })` (store `patchTweak` drops a null override, so a file tweak shows
  again, same as Reset all); it replaces the old × of Color/BG. Shown only on edited (draft) fields; the label gets a dot.
- Virtual vs DOM: the layers tree `kind: 'box'`, else the pick entry shape (bounds objects have `label === key`,
  `rot: 0`, no text). Editability comes from the bridge `code {key}` answer `tweakable: { props, read }` (a field is
  editable when `read` and its property is in `props`); missing `tweakable` = all read-only for virtual elements. DOM
  elements: all editable. Read-only fields: `readOnly` number/text inputs, disabled colour/checkbox/Order buttons, the
  tooltip on the row. The answer is cached per key until the next `live-ready` / scene switch.
- Not covered: the Select tool's drag handles in the picture still move virtual elements (live.js, unchanged); the
  tweak then has no effect unless the scene reads it.

## 3. Simpler look (#1)
- Header: key, breadcrumb (stack), "tweaked" pill, ⤳ Path.
- One column, label → field: X, Y, Scale, Rotate, Opacity (+ Text when the element has text).
- **More** (collapsed, remembered): Color, BG, Visible in output, Order (Bring forward / Send backward, z).
- Code: one **Open code** button (with "3 blocks" or "traced"). The refs list moves into the object view header as a
  compact list (click → jump).
- Footer: Reset all · Ask Claude. Drop the "Esc deselect" hint line (the shortcut help covers it).
- Spacing and typography follow Settings (`SettingsRow` style); no new colours.

As built (§3, 2026-10-16): header = key (label in its tooltip), "tweaked" pill, ⤳ Path; breadcrumbs below; the
label hint line, the tweak/actual column header and the "Esc deselect" line are gone. Fields are a 3-column grid
(label · value · ↺). **More** is a `<details>` remembered in `localStorage['gfx-studio.inspector.more']` ('1' open)
for all elements. **Open code** calls `code.js` `openObjectCode(key)` when it is exported; otherwise it toggles the
old refs list (`renderRefs`) in `#e-code` under the button. The button shows "N blocks" when the `code {key}` answer
has `marked: true` (N = regions), "traced" when it has regions without markers, nothing otherwise. Footer: Reset all ·
Ask Claude. CSS: marked "Element inspector" section in `paths.css` (replaces the Actual column rules); existing
colours only.

## 4. Findings 17–18 (same round)
- **17, render queue:** "Add to queue" only queues. The queue panel gets **Start queue** / **Pause queue**. **Render
  now** still renders immediately. A queue that was running keeps going when items are added.
- **18, comments and drawing:** in Live the default tool is **Select**; **C** = comment tool, **D** = draw (update the
  keymap and `?` help; resolve clashes and list them). Ask Claude / Send to T3 send only the annotated frame when the
  comment has markup (the plain frame only when there is no markup), and the brief says so.

## 5. Tests
- `tests/code.test.mjs`: marker parsing (multi-block, multi-key, CSS/HTML forms, unterminated block), the traced
  fallback on a three-style fixture (orbit-like), the anime ref expansion.
- E2E: the code check (object view folds to the regions, Show whole file, edit and save in the object view);
  inspector (typing an actual value → the tweak delta; virtual element fields read-only except tweak-read ones; More
  collapsed); render (Add to queue doesn't start; Start/Pause queue); tools (Live default Select, C/D keys); Ask
  Claude with markup sends one image.
- Renders byte-identical (`still the reel fixture --t 7.61` md5).
