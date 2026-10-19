# Review loop: comments, drawings, live scene, element tweaks — spec v1

Goal: in gfx studio the user can click anywhere on the picture to leave a comment (pinned to a spot, a moment and,
when known, a named element), draw on the frame, attach their own screenshots, and select / move / scale / rotate /
fade / retext elements of the live scene. Claude reads the comments with `gfx review`, fixes the scene, and marks
them resolved; the studio shows that live.

Two layers, same idea as audio (`sound.json`): **code stays code**, user edits are an **override layer** that renders
deterministically. Proposals live in the studio's review folder; Claude (or `gfx apply`) folds them into the scene.

| file | written by | content |
|---|---|---|
| `out/<scene>/review/draft.json` | studio | audio edits (stems/cues/add, unchanged) + **`tweaks`** (proposed element tweaks) |
| `out/<scene>/review/comments.json` | studio + `gfx review` | comments (replaces `draft.notes`) |
| `out/<scene>/review/shots/*.png|jpg` | studio | frame grabs, drawing composites, user screenshots |
| `scenes/<scene>/tweaks.json` | Claude / `gfx apply` | applied tweaks; every player/capture honours it |

## 1. Comments — `out/<scene>/review/comments.json`
```json
{ "version": 1, "scene": "_reel-test",
  "comments": [
    { "id": "c3", "t": 7.61, "frame": 456, "x": 540, "y": 1210, "el": "total", "cue": null,
      "text": "make the total bigger and land on the ding",
      "strokes": [ { "tool": "arrow", "color": "#ff4d6d", "width": 6, "pts": [[300,1400],[520,1230]] } ],
      "attachments": [ { "kind": "frame", "path": "shots/c3-frame.jpg" },
                       { "kind": "markup", "path": "shots/c3.png" },
                       { "kind": "image", "path": "shots/c3-img1.png", "name": "pasted.png" } ],
      "status": "open", "reply": null,
      "created": "2026-10-14T19:40:00Z", "updated": "2026-10-14T19:41:12Z" } ] }
```
- `t` seconds (frame-snapped), `frame` = round(t·fps). `x,y` = **scene pixels** (0..width, 0..height) or null for a
  timeline-only comment (made with `N` / on a cue like the old notes). `el` = element key from the live scene pick
  (§3) or null. `cue` = cue id when made on a selected cue.
- `strokes`: vector drawing in scene pixels. tools: `pen` (polyline), `arrow` (2 pts), `rect` (2 pts = corners),
  `ellipse` (2 pts = bbox corners). Colors: `#ff4d6d` (default), `#ffd23f`, `#3ddc97`, `#4dabff`, `#ffffff`.
  width in scene px (default 6 at 1080 wide; scale with scene width).
  Optional fields (finding 26; strokes without them render exactly as before): pen `smooth` (1-100: drawn with
  smoothing, rendered as quadratic curves through the midpoints of `pts`); `curve` = cubic Bézier, `pts` = anchors,
  `handles[i]` = `[[inX,inY],[outX,outY]]` absolute scene px (segment i = pts[i], handles[i][1], handles[i+1][0],
  pts[i+1]; a handle equal to its anchor = corner); rect / ellipse `rot` = radians about the box centre (other kinds
  bake rotation into their points). Example: `{ "tool": "curve", "color": "#3ddc97", "width": 6, "pts": [[162,1056],[432,960]],
  "handles": [[[162,1056],[162,1056]],[[181,1044],[683,876]]] }`.
- attachments: `frame` = the frame under the pin, grabbed from the rendered video at `t` (JPEG q0.9, scene size);
  `markup` = PNG composite: frame + strokes + pin marker (red ring at x,y) — **this is what Claude reads first**;
  only present when there are strokes or a pin. `image` = user screenshot (paste Ctrl+V, drag-drop or file
  pick; stored as-is, png/jpg/webp; ≤ 15 MB). All paths relative to `out/<scene>/review/`.
- `status`: `open` | `resolved` | `wontfix`. `reply`: Claude's one-line answer (what changed / why not).
- ids `c<n>`, never reused (max existing + 1). Timestamps ISO UTC; `updated` bumps on every change.
- **Merge-on-write** (both writers): read the file, merge by id taking the entry with the newer `updated`
  (a deleted comment is written as a tombstone `{ id, deleted: true, updated }`; readers hide tombstones), write back. Studio autosaves comments 600 ms after
  a change (no Save button needed for comments) and polls `stat(comments.json)` every 2 s; on external change it
  re-reads and merges (never losing a local unsaved edit).
- Migration: on load, if `draft.notes` has entries and comments.json does not exist, convert them
  (`{id:'c<n>', t, cue, text, x:null, y:null, status:'open'}`), write comments.json, drop `notes` from the draft.

## 2. `gfx review` (CLI, for Claude)
- `gfx review <scene>` — open comments sorted by t: `c3  07.61 f456  @(540,1210) el=total  "text"` + one indented
  line per attachment with its **absolute path** (markup first), then a summary of pending draft edits (audio
  changes count, tweaks per element with values) so Claude sees everything the user proposed.
  `--all` includes resolved/wontfix; `--json` prints the raw objects (with absolute attachment paths).
- `gfx review <scene> --resolve <id> [--reply "…"]` / `--wontfix <id> --reply "…"` / `--reopen <id>` — merge-on-write.
- `gfx review <scene> --stills` — for each open comment with x,y: render the exact frame (capture, with
  `scenes/<scene>/tweaks.json` + draft tweaks applied) to `review/shots/<id>-exact.png` and list it.
- `gfx apply <scene> [--tweaks] [--sound]` (default both): fold `draft.tweaks` into `scenes/<scene>/tweaks.json`
  (merge per element key; identity values drop the key) and draft audio edits into `scenes/<scene>/sound.json`
  (stems gain/mute merged, cues overrides merged, add[] appended by id); then remove the applied parts from the draft
  (comments untouched). Prints what changed. Re-run `gfx render/audio` afterwards (it says so).

## 3. Elements, picking and tweaks (runner, all scenes)
**Element keys.** Every DOM element inside `ctx.root` is selectable:
- named: `data-gfx="phone"` attribute, or `ctx.el('phone', node)` in setup (sets the attribute). Key = the name.
  Names are unique per scene (duplicate → warning, later one gets `name~2`).
- unnamed: key `@` + a stable structural path from root, e.g. `@0/2/1` (child indices of element children, through
  open structure only). Stable because setup is deterministic. Shown in the UI with a readable label
  (`div.fc "Milk 1,29 €"`, first 24 chars of text).
- non-DOM objects (canvas/three): `ctx.el('ball', { bounds: (t) => ({ x, y, w, h }) })` — pickable by box; the
  scene reads its tweak with `ctx.tweak('ball')` → `{ x, y, scale, rotate, opacity }` (identity defaults) and applies
  it while drawing.

**Tweak object** per key (all optional; identity omitted):
`{ "x": 0, "y": 0, "scale": 1, "rotate": 0, "opacity": 1, "text": "…", "color": "#hex", "bg": "#hex" }`
x,y = offset in **scene pixels as seen on screen**; rotate in degrees; opacity multiplies; `text` replaces the
element's text (only offered for elements whose content is a single text node); `color` / `bg` set CSS color /
background-color.

**Application** (runner/player/core.js), after every `render(t)`, idempotent and pure:
- DOM: use the CSS individual transform properties `translate`, `rotate`, `scale` (they compose with the `transform`
  property that anime.js / scenes write), so scene animation is untouched. Screen-space x,y → local translate:
  divide by the element's accumulated ancestor scale (measure once per element per frame via
  getBoundingClientRect vs offsetWidth, or the ancestor CSS matrices). opacity: multiply the opacity the scene just
  wrote — remember the value tweak wrote last frame per element (WeakMap) so a static element doesn't compound.
  text/color/bg: set after render, restore the original value when the tweak is removed.
- keys that don't resolve (scene changed) are reported once as warnings (`__gfx.warnings`), never throw.
- tweaks source: `scenes/<scene>/tweaks.json` (player + capture, so `gfx render/still/sheet/audio` honour it;
  `import.meta.glob` like sound.json) merged with **live tweaks** pushed over the bridge (§4) on top.

## 4. Live bridge (studio ↔ scene)
`gfx serve [--port 5199]` — Vite dev server (repo root) that stays up; prints `gfx serve: http://127.0.0.1:5199`.
`GET /__gfx/ping` → `{ ok: true, root }`. The studio loads
`/runner/player/bridge.html?scene=<name>` in an iframe (scene-size, CSS-scaled to the viewer, pointer-events none).
postMessage protocol (studio → bridge `{ id, type, ... }`, bridge → studio `{ id, type: 'reply', ok, result|error }`;
bridge also sends `{ type: 'ready', meta }` once and `{ type: 'error', message, stack }` on load failure, see §5 Live errors):
- `seek { t }` → renders t (coalesced: if busy, remember latest t; reply when the latest is drawn)
- `tweaks { tweaks }` → replace the live tweak layer (object of key → tweak) and re-render current t
- `pick { x, y }` (scene px) → `{ stack: [ { key, label, bounds:{x,y,w,h}, named, text:boolean, rot } ] }`
  topmost first: the hit element, then its ancestors that are keys (named first preference is up to the UI)
- `bounds { keys:[...] }` → `{ [key]: { x, y, w, h } }` (scene px, axis-aligned, current frame)
- `elements` → list of named keys `[ { key, label } ]` (named only; for the Elements list)
- `calib { key }` → `{ sx, sy }` local-translate→screen scale factors for drag mapping (if the runner doesn't
  already apply screen-space x,y itself — it does per §3, so this may return 1,1)

## 5. Studio
**Viewer modes.** `Rendered` (mp4 video, as now) and `Live` (bridge iframe). Live is available when the gfx server
answers ping; the studio offers **Start live server** (Tauri: spawn `wsl.exe -d <distro> --cd <linux root> -- bash
-lc "node runner/cli.js serve --port 5199"` with CREATE_NO_WINDOW, derived from a `\\wsl.localhost\<distro>\…` or
`\\wsl$\<distro>\…` root; kill it on exit; reuse an already-running server. Dev shim: spawn `node runner/cli.js
serve` locally). In Live mode the iframe follows the transport (seek each frame while playing, coalesced) and shows
draft tweaks; audio playback unchanged. Badge `LIVE` / `RENDERED` on the viewer; toggle with `L`.
**Live errors** (As built, JOURNEYS finding 19): a scene that throws never turns Live off. The bridge sends
`{ type: 'error', message, stack }` on load failure (and `…, reason, files` when a live reload fails); a SyntaxError
without stack frames gets its `file:line:col` from a `<script type=module>` probe of scene.js (window `error` event).
`live-error.js errorLocation` maps the stack to the first project file (live-server URL, `/@fs/` inside the project;
runner/node_modules frames skipped). `live.js` keeps `L.error = { message, path, line, col, phase }` and shows `#live-err`
(bottom of the picture, Code mode's error colours): "Scene error · path:line · message · **Open code**" + "Claude may
still be editing it". Badge `LIVE · ERROR` (`data-s=error`); a toast names file:line (once per distinct error).
`phase: 'load'` (never ran): the iframe stays mounted hidden, the rendered video shows dimmed, no load timeout; the bridge
page reloads itself on the next relevant file change, and its `ready` clears the error. `phase: 'reload'`: the last
working scene stays live underneath; the next `reloaded` clears it. Open code = `code.js openCodeAt(path, {line, col})`
(enters Code mode like the mode buttons; scene.js when the error names no file). Turning Live off clears the overlay;
Live stays off after the fix. Only a 25 s load timeout (server unreachable, no message) still falls back with
"Live view unavailable". E2E: out/studio-live-check.mjs (finding 19 section).

**Tools** (viewer toolbar, top-left of the picture): `Select (V)` (Live only), `Comment (C)`, `Draw (D)` (inside an
open comment). Esc returns to Select (or closes the popover).

**Comment tool.** Click on the picture → pauses, pin at (x,y,t) (frame-snapped), comment popover anchored to the pin:
text, element chip (`el`, auto from pick when Live), buttons **Draw**, **Attach** (file pick; Ctrl+V and drag-drop
also work while the popover is open), **Delete**, status (open/resolved/wontfix with Claude's reply shown read-only
above the text when present). On create: grab the frame (from the video element at t: seek, wait `seeked`, draw to
canvas at scene size → JPEG) → `shots/<id>-frame.jpg`. Saving with strokes or a pin writes the markup composite
`shots/<id>.png`. Pins render on the picture when the playhead is within ±0.5 s of t (full opacity on the exact frame,
fading out), numbered by order; strokes render only on the exact frame (±1 frame). Click a pin → open it.
`N` still makes a timeline-only comment at the playhead (or on the selected cue).

**Draw mode.** Over the picture: tools pen / arrow / rect / ellipse, 5 colors, width S/M/L, undo stroke, clear,
Done (Enter). Strokes in scene px. While drawing, playback is paused and the frame is held.
As built (finding 18): `D` is the draw tool (open comment, else a new comment at the playhead); `C` the comment tool; Live opens with Select as the default tool (`viewer.baseTool`, also where Done / placing a pin return to). Ask Claude / Send to T3: a comment with a `markup` attachment sends only that annotated frame (T3 text ends with a line saying so); without markup, the plain playhead frame.
As built (finding 20, send all comments): the Comments tab shows "Ask Claude about all N open comments" at the top when N >= 1 (open only; resolved / won't fix are excluded), and the Ask Claude composer has a "Brief about" choice (the source it was opened with / All N open comments; opened from the button it offers Scene instead). One brief: `gfx context <scene> --comment <id>` once per open comment, ids in time order (the CLI keeps the given order; no CLI change needed), so each comment lists time, element, text and its annotated frame (markup) or frame, plus a closing task line: fix each, verify, then `gfx review <scene> --resolve <id> --reply "..."` per comment. Terminal and T3 both work. T3: one image per comment (markup, else frame), at most 8 (T3's limit); beyond that the first 8 are attached and the rest are listed by path in the text (the text says "N of M"). All sent comments get the plane marker. Code: `ask.js` (`allCommentsCtx`, `openCommentIds`), `notes.js`; E2E in `out/studio-comments-check.mjs` and `out/studio-t3-check.mjs`. The composer is raised above dockview's sashes (z-index) since the extra row made it overlap one.
As built (finding 26): draw-bar tools Select / Pen / Curve / Arrow / Rect / Ellipse. **Pen smoothing**: presets Raw (0) /
Smooth (50, default) / Very smooth (85) + a 0-100 slider (Pen only); while drawing the point trails the pointer
(streamline, lag = amount·0.8), on release the stroke catches up with the pointer and is simplified with
Ramer-Douglas-Peucker (ε = amount/100 · 3 scene px at 1080 wide); Raw = the old polyline (a point every ≥ 3 px, no
`smooth` field). **Curve**: click adds an anchor, click-drag pulls symmetric handles, Enter or double-click finishes
(≥ 2 anchors), Esc cancels the curve (draw mode stays). **Select** (the open comment's drawings only): click a stroke
(topmost first) to select; drag inside its box to move; corner squares scale (the opposite corner stays); the round
knob above rotates; curves also show anchors (drag = move with its handles) and handles (drag = symmetric, Alt =
independent); Del / Backspace removes, Esc deselects. Ctrl+Z / Undo walks back every change of this draw session
(strokes, moves, scale, rotate, delete, clear), then removes older strokes one by one. **Show / hide comments**: `H` or
the `Hide comments` viewer button hides pins and drawings on the picture (the comment being drawn on stays visible;
the Comments tab is unaffected); remembered for the session (`sessionStorage gfx.commentsShown`). The markup PNG
(shots.js) uses `draw.js drawStrokes`, so curves / smoothing / rotation appear in it. **Vectors for Claude**:
`draw.js strokesToSvg(strokes, meta)` returns an SVG document in scene px (viewBox = scene size, one
`<path data-tool>` per stroke; curves as `C`, smoothed pens as `Q`); `strokePath(s)` gives one path's `d`. Not yet
wired into the brief / `gfx review` (ask.js, runner).

**Side panel.** Tabs: **Comments** (open first, then resolved collapsed; each row: number, time, thumb of markup or
frame, text, element, status dot; click → seek + open), **Changes** (existing + element tweaks), **Elements** (Live:
named elements; click → select; tweaked ones dotted). Comment pins also stay in the timeline notes lane.

**Select tool (Live).** Hover outlines the element under the cursor (pick, throttled); click selects the topmost
named element in the stack (Alt+click: the exact hit element; `[`/`]` walk up/down the stack; breadcrumb in the
inspector). Selection box with handles: drag inside = move (x,y), corner = scale (uniform), top knob = rotate
(Shift snaps 15°), arrow keys nudge 1 px (Shift 10; Ctrl+arrows always step frames). All shortcuts: docs/KEYS.md. Inspector for an element: key/label, x, y, scale, rotate,
opacity, text (if text), color, bg, **Reset**. All edits go to `S.draft.tweaks` through the existing history
(undo/redo, dirty, Save). A/B Original|Draft also switches the live tweak layer (Original = scene tweaks.json only).
As built (docs/INSPECTOR.md §2/§3, 2026-10-16): the inspector fields show the *actual* values and typing one sets the
tweak that reaches it; Color/BG/Visible/Order sit under a collapsed **More**; per-field ↺; virtual elements edit only
what the scene reads. Details in docs/INSPECTOR.md "As built".

## Verification
- Runner: a test scene (anime) with named + unnamed elements: pick returns the expected stacks; tweaks move/scale/
  rotate/fade elements that anime animates and static ones, idempotent across repeated seeks (pixel-identical stills
  at the same t after seeking elsewhere and back); tweaks.json honoured by `gfx still`; unresolved key → warning only.
- CLI: `gfx review` on a fixture comments.json; resolve/reopen round-trip with merge (concurrent edit preserved);
  `gfx apply` folds tweaks + sound and clears them from the draft.
- Studio (dev mode in Linux Chrome via puppeteer at 1600×1000, the reel fixture): comment pin + text + draw strokes +
  paste an image → comments.json + shots written, markup PNG looks right (Read it); external `--resolve` shows up
  within 3 s; Live mode: pick, drag-move an element, scale, Save → draft.tweaks; A/B toggles the tweak layer.

## Implementation notes (runner side, as built)
- `scenes/<scene>/tweaks.json` is a flat map `{ key: tweak }`. Live tweaks merge **per property** over it (`setTweaks({})` = scene file only); identity values in the live layer override file values, `gfx apply` then drops them.
- Bridge extras beyond §4: replies are `{ id, type:'reply', ok:true, result }` with `seek` -> `{ t }`, `tweaks` -> `{ warnings }`; `{ type:'hello' }` re-sends `ready`; `{ type:'fileTweaks' }` re-reads tweaks.json (after `gfx apply`) and redraws; unknown types reply `ok:false`. `pick` stack = bounds-registered objects containing the point, then the hit element (skipping opacity-0 / hidden) and every ancestor up to (excluding) the root; `bounds` omits keys that don't resolve. `calib` always returns `{ sx:1, sy:1 }` (x,y are already screen-space).
- Name the visible box, not a zero-size positioning wrapper; rotate/scale pivot on the element's own centre (counter-translated so anime-translated elements turn in place). Inline (`display:inline`) elements can't be transformed. Ancestor 3D (rotateY/perspective) is approximated by its 2D linear part.
- `gfx review --json` prints `{ scene, comments:[…abs attachment paths, exact?], draft:{ stems, cues, add, tweaks } | null }`.
- `gfx serve` also exposes `/__gfx/ping` for `gfx dev`; `out/` and `library/` are excluded from Vite's watcher and `apps/` from its dependency scan.

## 6. Layers (v1)
Adobe-style layer view: a **Layers** tab in the side panel (tree) + **layer bars** in the timeline, sharing selection
with the picture and the inspector.

**Runner / bridge additions**
- `tree` → `{ nodes: [ { key, label, named, parent, depth, kind: 'dom'|'box', group?: 'chip', count? } ], order }`.
  Nodes = named elements (data-gfx / ctx.el) + bounds-registered objects, nested by DOM ancestry between *named*
  elements (unnamed wrappers are skipped: a named element's parent is its nearest named ancestor, root = null).
  Order = paint order, front-most first (DOM order reversed among siblings, z-index respected within a stacking context
  where cheap; document order otherwise). Siblings whose names are `<base>-<n>` are reported with `group: '<base>'`
  (the UI collapses them into one row "chip (4)").
- `spans { step? }` → `{ fps, step, spans: { [key]: [[t0, t1], ...] } }`: sampled visibility per tree node (default
  step = 2 frames): visible = in the frame rect, area > 0, computed opacity product along ancestors > 0.01, not
  display:none / visibility:hidden, and no fully empty clip-path on the node or an ancestor (tiny circles, empty
  insets, collinear polygons). Unpainted containers with named descendants use the union of their named
  children’s visibility, computed bottom-up and intersected with their own visibility; unpainted leaves keep
  the box rule. Fully clipped overflow boxes are invisible. Pseudo-element paint is out of scope. Intervals merge gaps ≤ 1 step. Samples by seeking (restores the previous t after);
  cache by scene + live-tweak signature; reply includes `ms`. Must not change rendering determinism.
- Tweaks gain `visible: false` (element gets `visibility: hidden` after render; restored when removed) and `z`
  (integer: CSS `z-index` + `position: relative` if static, applied after render; restored when removed). Both honoured
  by player/capture/`gfx apply`/`gfx review` summaries like the other tweak props.
- View-only overrides (never saved, not tweaks): `view { hidden: [keys], solo: key|null }` → applied like
  `visible:false` (solo hides every top-level branch that does not contain `solo`, plus its siblings within the chain,
  so only the soloed element and its ancestors render). Cleared by `view {}`. Used for 👁 / solo in the studio.

**Studio**
- Layers tab (Live mode; shows "Turn on Live (L)" otherwise): tree with disclosure triangles, collapsed groups,
  indentation, label (key + short text), ● when tweaked, 👁 toggle (view-only hide), 🔒 toggle (lock: pick skips locked
  keys and their descendants — filter the pick stack client-side), Alt+click 👁 = solo. Hover row = outline in the
  picture; click row = select (same selection as the Select tool / inspector); selection in the picture highlights
  and scrolls to its row. Double-click row = jump to the first span start. Lock/hide/solo state is per scene in
  localStorage (view state, not draft). Scenes without saved state start with all nodes collapsed (depth-0 rows only).
- Inspector: adds **Visible in output** checkbox (tweak `visible`) and **Bring forward / Send backward** (tweak `z`,
  ±1 from effective). 
- Timeline: a **LAYERS** section between COMMENTS and the stem lanes, collapsible (header click), one 14 px row per
  visible tree row (follows the Layers tab expansion), bar per span in a neutral color (selected = accent, tweaked =
  dot at bar start), label at bar start; click bar = select + seek to span start; rows scroll with the lane area.
  Spans requested after the bridge is ready and after tweak changes (debounced 800 ms), with a small "mapping
  layers…" chip.

**Runner/bridge as built (§6)**
- `tree` -> `{ nodes, order }`: `nodes` is pre-order (parent, then its children front-most first); each node `{ key, label, named:true, parent, depth, kind:'dom'|'box', group?, count? }`. `group`/`count` (members of the group, >= 2) are set on every member of a `<base>-<n>` sibling set. `order` = all keys in global paint order, front-most first (children before their parent). Siblings sort by computed z-index (positioned elements only) then reverse DOM order; bounds-registered boxes are root-level and treated as front-most (like `pick`). `tree` reflects the current frame's `z` tweaks.
- `spans { step? }` -> `{ fps, step, spans:{ key:[[t0,t1],...] }, ms, cached? }`. `t0` = first visible sample, `t1` = last visible sample + one step (clamped to the duration); intervals merge when the gap is <= 1 step. The whole sampling pass runs as one serialised render job (no other seek interleaves), ignores `visible` tweaks and the view layer (bars show the scene's own timing; x/y/scale/opacity tweaks still count), then re-renders the previous t. Cache key = step + file/live tweak signature. the reel fixture 15 s @60, step 2 (450 frames): ~0.9 s. Visibility is read from computed styles + `getBoundingClientRect` (no screenshots); `logo` starts at 12.92 s (its real reveal, `LOGO_T`), not 12.5 (that is the collapse start).
- Tweaks `visible:false` -> inline `visibility:hidden`; `z` (integer, any value incl. 0 is active) -> inline `z-index` + `position:relative` when computed position is static. Both go through the same own/restore path as the other props. `gfx apply` drops `visible:true` (identity) but keeps `z`. `gfx review` prints `visible=false z=3`.
- `view { hidden?, solo? }` (bridge message; `window.__gfx.setView(v)` re-renders, `view {}` / no args clears): hidden keys get `visibility:hidden`; `solo` hides every sibling of each element on the chain solo -> root (unnamed ones too), so ancestors still paint their own box; a non-DOM (box) solo hides all DOM content. Unresolved keys warn once. Reply `{ warnings }`. Inherited `visibility:hidden` can be overridden by a descendant with an explicit `visibility:visible` (scene-written), same as CSS.
- `window.__gfx` also exposes `tree()`, `spans(opts)`, `setView(v)`.

## 7. Motion paths, actual values, track groups (v1)

**Runner / bridge**
- `values { keys, t? }` → `{ [key]: { cx, cy, x, y, w, h, scaleX, scaleY, rotate, opacity, visible } }` at the current
  (or given) t: cx/cy = centre of the element's border box in scene px (transform-aware: centre of the transformed
  box = quad centroid, not the AABB centre); scaleX/scaleY/rotate (deg) decomposed from the **accumulated** transform
  (element × ancestors up to root, incl. CSS individual props and tweaks; 3D ancestors projected to 2D); opacity =
  effective product along ancestors (0 if visibility hidden / display none). Bounds-registered objects: from bounds
  + ctx.tweak values. Must not alter rendering; cheap enough for ~30 calls/s on one key.
- `path { key, from?, to?, step? }` → `{ fps, step, samples: [ { t, cx, cy, scaleX, scaleY, rotate, opacity, visible,
  quad: [[x,y]×4] } ] , ms }`: default range = the key's visibility span(s) envelope (fallback whole scene), step =
  1 frame (cap 1200 samples; widen step if needed). Same serialization rules as `spans` (queued with tweak/view
  changes, restores displayed t, cached by key + range + step + tweak signature).
- Expose `__gfx.values()` / `__gfx.path()`.

**Runner/bridge as built (§7)**
- `values { keys, t? }` -> `{ [key]: { cx, cy, x, y, w, h, scaleX, scaleY, rotate, opacity, visible } }` (keys that do not resolve are omitted). `x,y,w,h` = axis-aligned box of the quad (same numbers as `bounds`, 2 decimals); `cx,cy` = quad centroid. With `t` the frame is rendered and the displayed t re-rendered after (inside the render chain). Typical call 0.3 ms.
- `path { key, from?, to?, step? }` (step in frames) -> `{ fps, step, samples:[{ t, cx, cy, scaleX, scaleY, rotate, opacity, visible, quad }], ms, cached? }`. Every frame in the range is a sample (also invisible ones, `visible:false`, so the UI breaks the line); default range = first span start .. last span end for the key (`spans` step 2, cached), whole scene if the key has no span. Like `spans`, the `visible` tweak and the view layer are ignored while sampling (x/y/scale/rotate/opacity tweaks count). Unknown key -> error reply. Cache key = key|range|step|tweak signature. the reel fixture `total` over its span (93 samples @60): ~80-100 ms; 61 samples of the fixture: ~6 ms.
- Method: no getBoxQuads. Accumulated 2x2 linear map = product, root excluded, of each element's `rotate`·`scale`·`transform` (computed styles; 3D ancestors contribute their projected m11/m12/m21/m22). Centre = centre of `getBoundingClientRect` (for an affine image of a box the AABB centre equals the quad centroid, so translations/origins/offsets never need modelling); quad = centre ± L·(±offsetWidth/2, ±offsetHeight/2). scaleX = |col 1|, scaleY = det/scaleX, rotate = atan2(b,a). Tests check the quad AABB against `getBoundingClientRect` for rotated and unrotated cases.
- Deviations: perspective (non-affine) ancestors make `cx,cy` the AABB centre (approximate) and quads use the linear part only; SVG elements and size-less wrappers use their AABB as the quad (no rotation info in the quad, scale/rotate still from the matrices). `opacity` multiplies computed opacity up to the root (0 for display:none / the element's own visibility:hidden); `visible` uses the same rule as `spans` (clip-paths, overflow clipping, unpainted containers). Bounds-registered objects: bounds + `ctx.tweak` scale/rotate/opacity. `values`/`path` are also exposed on the capture page.

**Studio**
- **Motion path** (`P` or ⤳ in the inspector) for the selected element; pinned paths list (each removable) persists
  per scene in localStorage. Overlay draws: polyline through centres (only visible samples; gaps break the line),
  a dot per sample (bigger every 10 frames), ◆ at rest points (speed < 0.5 px/frame after motion), current-frame
  marker, start/end labels with times. Hover a dot → tooltip t/frame; click → seek. Colour per pinned path. Onion
  skin toggle: outlines (quad) at ±1..±N frames (N = 3 default, faded). Paths refetch after tweak changes (debounced)
  and A/B switches.
- **Actual values**: inspector column "Actual" next to x/y/scale/rotate/opacity showing `values` for the selected
  element (cx, cy, scale (scaleX if uniform, else "sx × sy"), rotate°, opacity), updated on seek, while playing
  (throttled ~10/s) and after tweaks. As built later (docs/INSPECTOR.md §2): no separate column any more; the value
  fields themselves show these values (`paths.actualOf` / `applyActual`).
- **Value curves**: under the selected element's row in the timeline LAYERS section, an expandable sub-row
  (▸ on the layer row) with 5 mini curves (x, y, scale, rotate, opacity), each normalized to its own min..max with the
  range printed at the left, drawn from the `path` samples; hover shows value at t.
- **Track groups**: timeline sections become two collapsible groups: **VIDEO** (thumbnail strip, COMMENTS, LAYERS) and
  **AUDIO** (stem lanes + voice). Collapsed group = one summary row (video: thumbnails; audio: summed peaks of the
  visible stems). Each track row gets a **shy** toggle (hide the row from the timeline only); group header shows
  "show hidden (n)" to reveal shy rows temporarily (dimmed). 👁 (video layers) and M/S (audio, the 🔊) keep their
  meaning. View state per scene in localStorage; nothing goes into the draft.
