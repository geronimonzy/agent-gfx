# Retiming by dragging: layers and sounds (spec)

Approved by the user 2026-10-18. Sounds: move several cues at once, shift a whole lane, and let an element's sounds
follow its layer bar when **Linked** is on. Layers: drag a layer bar to shift that element's animation in time, drag an
edge to stretch / squeeze it. Retiming is an **override layer** (tweak), never a code edit.

## 1. Data: the time tweak
Three new tweak props, stored like every other tweak (`scenes/<scene>/tweaks.json`, draft `out/<scene>/review/draft.json`
`tweaks`, merged per property, live over file):

| prop | unit | identity | meaning |
|---|---|---|---|
| `shift` | s | 0 | the element's animation plays this much later (negative = earlier) |
| `stretch` | × | 1 | its duration factor (2 = twice as long / half speed); clamped 0.1..10 |
| `pivot` | s | – | the scene-time instant that `stretch` keeps fixed (before `shift`); only meaningful with `stretch` |

Local time of an element at scene time `t`:
`local(t) = pivot + (t − pivot − shift) / stretch`, composed with the time tweaks of its **named ancestors**
(outermost first: `local = f_el(f_parent(t))`), clamped to `[0, duration]`. Example:
`"logo": { "shift": -0.5 }` = the logo reveal comes 0.5 s earlier; `"total": { "stretch": 1.5, "pivot": 6.8 }` = the
count-up starting at 6.8 s takes 1.5× longer.

`gfx apply` folds them like other tweaks; `shift: 0`, `stretch: 1` are identity and drop; a lone `pivot` drops too.
`gfx review` / `gfx context` print them through the existing tweak formatter.

## 2. Player (runner/player)
A retime tweak is resolved in `drawFrame` (core.js), between the scene's render and the tweak layer:

1. No time tweaks in the effective layer → the frame is drawn exactly as before (same calls, same order): renders stay
   byte-identical.
2. Otherwise, for each retimed **DOM** element: its *scope* = the element plus the unnamed wrappers above it that hold no
   other named element (the reel fixture's chips are `.fl > .fd > .fi > .fc`: the timeline animates `.fl`, the name is on
   `.fc`; the scope climbs to `.fl`). The scene is rendered once per distinct local time, every scope's attributes
   (all attributes of every element in it, so `style`, SVG `d` / `stroke-dashoffset`, classes …) and direct text nodes
   are captured, then the scene is rendered at `t` and the captures are written back, shallow scopes first (a retimed
   child overrides its retimed parent's copy). Before the next frame the scene's own values at `t` are put back (same
   own/restore idea as the tweak layer), so nothing compounds and `render(t)` stays a pure function of `t` + tweaks.
3. Elements that read their time themselves — **`ctx.clock(name)`** (setup-only, returns `(t) => local t`): canvas and
   three.js objects (`ctx.el(name, { bounds })`), or a DOM element whose drawing the scene computes by hand. Their
   scope is not copied; `bounds(t)` of a clocked bounds object is called with its local time (pick, spans, values).

`tree` nodes gain `retime: 'auto' | 'clock' | 'none'` (DOM = auto, `ctx.clock` = clock, bounds object without a
clock = none). Spans, values and paths go through `drawFrame`, so the layer bars show the retimed timing.

**Support per kind**
- anime / svg / hand-written DOM: automatic (timeline tweens, render-written styles, text counters inside the scope).
- canvas / three: only objects whose drawing uses `ctx.clock(name)(t)`; others show `none` (bar not draggable).
- Partial: pixels of a `<canvas>` inside a DOM scope are not copied; effects outside the scope that the scene drives
  from global `t` (a flood clip-path on a shared container, screen shake, camera drift on an ancestor) keep scene time;
  a scope whose element count changes between the two renders is skipped (warning once); a clocked element inside a
  retimed auto scope gets its parent's copy. Cost: one extra scene render per distinct retimed local time per frame.

## 3. Sounds ↔ elements
A cue belongs to an element via `el`: `ctx.cue(t, sound, { el: 'logo' })` in the scene, or a cue override
`{ "el": "logo" }` in sound.json / the draft (`""` = explicitly unlinked). Without an explicit `el`, a cue is linked
**by name** when its id equals an element key or starts with `<key>-` (longest key wins: `total-tick-3` → `total`,
`phone-in` → `phone`). An element's sounds = cues linked to it or to its named descendants. `el` never changes audio.

## 4. Studio
- **Layer bars** (timeline LAYERS rows): drag the body = move (frame snap, Alt = free); drag within 5 px of the first
  span's start / the last span's end = stretch from the other edge. Click without moving = select + seek (as before).
  The bar previews the new timing while dragging and the Live picture updates (each move is a draft tweak edit
  coalesced into one undo step). Group rows (`chip (4)`) retime all members together. Rows with `retime: 'none'`
  are not draggable (tooltip says why). Drags switch A/B to Draft (like the Select tool).
- **Linked** toggle in the LAYERS header (chain icon, on/off, per studio in localStorage, default on): while on, a layer
  drag also moves (or stretches through the same time map) the element's sounds, same undo step. Off = picture only.
- **Cue multi-select**: Shift+click toggles a cue in the selection; Shift+drag on an empty lane area = box select (cues
  touched by the box, across lanes); double-click a lane's name = select all its cues (= shift a whole lane). Dragging
  any selected cue moves the whole selection by the same frame-snapped delta (clamped so none leaves 0..duration), one
  undo step. Esc / click on empty lane clears. The inspector shows "N cues selected" with **Shift by** (s), Select lane,
  Clear.
- **Element inspector**: a Timing row: Shift (s), Stretch (×), reset; linked sounds count.
- **Changes / summaries**: `shift +0.50 s · stretch 1.50×`.
- Undo / redo, Save draft, A/B: all through the existing draft commit; retime only shows in Live (like other tweaks);
  the rendered video shows it after `gfx apply` + render.

## 5. Tests
- `tests/retime.test.mjs`: the time map + composition (pure), `cleanTweak` identities, the cue `el` link through
  `resolveCues`, and in Chrome on a fixture scene `_retime-test` (anime timeline + render-written text + clocked
  bounds object): no tweak = identical pixels; shift / stretch / nested composition move the element's state
  in time and leave the rest untouched; removing the tweak restores identical pixels; random seek order = identical
  frames; spans follow the shift.
- Studio unit `retime-core.test.js` (math for drag → tweak, cue mapping, name links).
- E2E `out/studio-retime-check.mjs` (_reel-test, formerly the reel fixture, via `bash out/e2e-with-dev.sh retime`): drag a layer bar (Linked on:
  linked cues move, undo restores both), stretch an edge, Linked off, Shift-click + box select + group drag, lane
  select-all, screenshots.
- Byte identity: `gfx still the reel fixture --t 7.61` decoded md5 unchanged (now `_reel-test`, see CLAUDE.md).

## As built (2026-10-18)
- Engine: `runner/player/retime.js` (time map, composition, scope capture/write), `elements.js` (`clock`, `localTime`,
  `retimePlan` / `retimeCapture` / `retimeWrite`, scope = element + owning unnamed wrappers, cached; `tree` nodes carry
  `retime`; clocked bounds objects get their local time in pick / bounds / spans / values), `core.js` `drawFrame`
  (no time tweak → the old call sequence; else one extra render per distinct local time, a local time equal to `t`
  needs none), `ctx.clock(name)`. `sfx.js`: cue `el` (makeCue + sound.json override). `review.js`: `shift: 0`,
  `stretch: 1` and a lone `pivot` are identity for `gfx apply`.
- Byte identity: `gfx still the reel fixture --t 7.61` decoded md5 `19bfe0ea74bd9ae7e7c4dbff298ff466` before and after.
- Studio: `retime-core.js` (pure math, link-by-name, box hit test), `retime.js` (selection set, Linked toggle in
  localStorage `gfx-studio.retime.linked`, layer drag begin/update/end, preview spans until the next fresh span
  mapping, `setCueLink`, inspector `timingPatch`); `timeline.js` (bar move / edge stretch with frame snap, Alt = free,
  cursor grab / col-resize, Linked chain button in the LAYERS header, Shift+click / Shift+drag box (also when the drag
  starts on a cue) / double-click lane name, group drag, plain click inside a selection selects just that cue);
  `inspector.js` (multi panel "N cues selected" with Shift by / Select lane / Clear; Layer select per cue: By name /
  Not linked / a layer); `elements.js` (Shift / Stretch fields, linked sounds line; read-only with the reason for
  `retime: 'none'`); `store.js` (time props in the draft tweak cleaner + Changes summary); `layers.js` emits
  `layer-spans`.
- Typed Stretch without a pivot pins the pivot at the content time shown at the bar's start (the bar's start stays).
- Not done: keyboard shortcuts for the multi-selection (Delete / nudge act on the primary cue only); the rendered video
  (non-Live) shows retiming only after `gfx apply` + render, like other tweaks.
- Follow-up (2026-10-18): the reel fixture cues carry explicit `el` links (61 of 72; floods, slams, rise, whip/return,
  push-in and collapse stay unlinked); stems, mix and cues.json (minus `el`) and the 7.61 still are byte-identical.
  Skills: canvas2d / threejs draw named objects from `ctx.clock(name)(t)`; sound-design / motion-graphics mention cue `el`.
- Codex review fixes: a scope whose local time equals `t` (a child cancelling its parent's shift) is captured after
  the final render, so it still overrides a retimed ancestor's copy; the studio's ancestor map folds like the player
  (outermost first: `parent(grandparent(t))`); `el: ''` survives `makeCue` (explicit "not linked" for added cues);
  "By name" over a scene / sound.json link is an explicit draft override `el: null` (a `null` el = link by name).
- Tests: `tests/retime.test.mjs` (35), `apps/studio/web/src/retime-core.test.js` (5), `out/studio-retime-check.mjs`
  (E2E, the reel fixture, 33). `tests/review.test.mjs` stub registry gained `retimePlan`.
