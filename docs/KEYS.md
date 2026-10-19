# Keyboard shortcuts (gfx studio)

Single source of truth: `apps/studio/web/src/keymap.js` (the table), `keys.js` (registry, dispatcher, conflict check),
`keys-help.js` (the `?` overlay, generated from the table). Press `?` or app menu → Keyboard shortcuts for the live list;
this file records the rules and the audit that led to them. Windows first: the labels say `Ctrl` (Cmd is accepted as Ctrl).

## Rules (one key, one action per context)
- **Contexts, highest first:** `dialog` (Ask / Settings page / Help / image preview / diff) > `versions` (history row focused) > `draw` >
  `code` (Code mode) > `comment` (popover open or comment tool) > `live` (Live view ready) > `viewer` > `timeline` > `global`. The first matching
  entry whose `when()` holds runs and consumes the key. Same key in one context needs distinct `when()` guards.
- **Typing:** while an input / textarea / select / contenteditable has focus only entries marked `typing` run
  (Ctrl+S, Ctrl+R, Ctrl+`, the UI zoom keys, Esc, Enter in the comment box). **Terminals** (xterm) keep every key except
  Ctrl+`, the UI zoom keys and the terminal's own Ctrl+Shift+C / V. **Dialogs** swallow everything except their own keys,
  Ctrl+` and the UI zoom keys.
- **Pop-out windows** (docs/LAYOUT.md §5) get the same dispatcher (`installKeysOn(doc)` once the window is open), so
  Space, arrows, ... work while a popped-out panel has focus.
- **UI zoom keys match the physical key** (`e.code` Equal / Minus / Digit0 and the numpad +/-/0, with Ctrl), like browser
  zoom: `Ctrl+Shift+=` (`Ctrl++`) and non-US layouts work too.
- **Modifiers match exactly.** `Shift+L` is not `L`, `Shift+C` is not `C`, `Alt+L` does nothing. Shift is ignored only for
  symbol keys (`?`, `[`, `]`). `Ctrl` and `Cmd` are the same.
- **Startup check:** `installKeys()` runs `checkConflicts()`; any clash is a `console.warn('[keys] ...')` in dev and is
  left in `window.__keyConflicts`. Entries only count as non-conflicting when their `when()` guards are distinct or their
  contexts differ and the higher one is guarded.
- Widget-local keys that are not shortcuts stay in their widgets: Space / Enter on the inspector's switch (`inspector.js`;
  the dispatcher skips `[role=switch]`), ↑ / ↓ / Enter in the settings search box (`settings.js`). The welcome window
  (`welcome.js`, its own page without the dispatcher) has Enter on a project row and Esc = Back in its panes.
- **Settings page** (docs/HOME-SETTINGS.md §2) is a `dialog` for the dispatcher: workspace keys (Space, L, arrows, ...) do
  nothing while it is open; Ctrl+` closes it and toggles the terminal. Conflict check for the new keys: `Ctrl+,`,
  `Ctrl+Shift+O` and `/` were unused; `Ctrl+F` was only CodeMirror's own find (a `doc` entry, inside the editor), and the
  settings entry only runs while the page is open, where no editor has focus.

## Audit (before this change) and resolution

| # | Where (before) | Key | Context | Problem | Resolution |
|---|---|---|---|---|---|
| 1 | main.js, live.js | `L` Live vs `Shift+L` loop | global | Two handlers, case-based: with Caps Lock `Shift+L` produced `l` and loop died; `k === 'L'` also matched Caps+L | Exact modifier matching; `L` = Live (viewer), `Shift+L` = loop (global). Kept (both documented); Caps Lock safe. NLE's `L` = play fwd is not used by the studio |
| 2 | main.js | `n c d a m s f r p` + Shift | global | `k.toLowerCase()` ignored Shift/Alt: Shift+M mutes, Shift+S solos, Shift+A toggles A/B, ... | All bindings are exact; Shift+letter does nothing unless registered |
| 3 | main.js | `Esc` | several | Chain was split: live.js (capture) cleared the element selection *before* recording / drawing / popover handling; notes.js (capture) and the comment textarea handled their own Esc; home/dialogs separate | One ordered chain, top first: image preview > help > Ask > Settings > projects screen > recording (cancel) > drawing (stop) > comment popover (close) > Live element selection (deselect) > tool back to View > cue / comment selection (deselect) > leave text field. Esc in a text field: comment box closes the popover, any other field just blurs |
| 4 | main.js | `Ctrl+Z` / `Ctrl+Shift+Z` | draw | While drawing, `Ctrl+Shift+Z` also undid a stroke (Shift ignored) and `Ctrl+Y` redid the *draft* behind the drawing | In draw: `Ctrl+Z` undoes the last stroke, `Ctrl+Shift+Z`, `Ctrl+Y` and `C` are swallowed. Outside: undo / redo (+`Ctrl+Y`) of the draft |
| 5 | main.js | `Ctrl+R` | global vs terminal | Render dialog vs bash reverse-search; also the browser's reload | Render opens only outside terminals (xterm keeps its keys); it works from text fields. Never closes the panel (it only opens; the panel's own close button toggles) |
| 6 | main.js | `Ctrl+S` | global | Fired from text fields and (with Ctrl+R) ignored `S.meta`; swallowed by dialogs/terminals | Kept: saves from text fields, not inside dialogs / terminals (terminal `Ctrl+S` is XOFF, dialogs are modal) |
| 7 | main.js | `Delete` / `Backspace` | timeline | Cue first, then comment; STUDIO.md said "Delete = mute" but added cues are removed and originals muted | Kept both keys (AE: Delete and Backspace); documented: selected cue (original cues mute, added cues are removed), else selected comment. Live element selection has no Delete (Reset in the inspector) |
| 8 | main.js, live.js | `Arrow keys` | global vs live | Same key, overlapping context, different action: frame step vs nudge the selected element | Kept (REVIEW.md §5): nudge only while the Select tool has an element selected (`when`); otherwise frame step. New alias `Ctrl+Left/Right` (AE: frame step) always steps, also with a selection |
| 9 | live.js, main.js | `V`, `[`, `]` | live | `V` toggled select even with Shift; `[`/`]` ran without checking the Select tool | `V` and `[`/`]` are `live` context, exact modifiers |
| 10 | paths.js | `P` | global | Own capture listener, Shift+P also fired | In the table (`viewer`), exact; toasts when Live is off / nothing is selected (unchanged) |
| 11 | main.js | `C` while drawing | draw | Prevented but silently ignored | Explicit swallow entry in `draw` |
| 12 | terminal.js | `Ctrl+Shift+C` / `V` | xterm | Hard-coded in xterm's key handler | Registered as `terminal` context, run by `dispatchTerminal` |
| 13 | terminal.js | `Ctrl+`` | global | Own capture listener | In the table; works in text fields, dialogs and terminals |
| 14 | notes.js | `Enter` / `Esc` in the comment box | comment | Local keydown + `stopPropagation` | Table entries (`comment`, typing). `Shift+Enter` = new line |
| 15 | ask.js / settings.js | `Esc`, `Ctrl+Enter` | dialog | Local keydown with `stopPropagation` | Table entries (`dialog`) |
| 16 | notes.js | `Esc` on the image preview | dialog | Capture handler | Table entry (`dialog`), first in the chain |
| 17 | docs | `S`/`M` "on focused lane" | timeline | Binding is the *active lane* (`S.lane`, set by clicking a lane header) | Docs say "active lane" |
| 18 | docs | `Shift+L` was "Live" in older text | | STUDIO.md already says Shift+L = Loop | Consistent now |
| 19 | inspector.js | static SHORTCUTS block | | Out of date (missing F, D, P, Ctrl+R, Ctrl+`, Enter, Ctrl+Y) | Replaced by "Press ? for all shortcuts" + the 6 most used, from the registry |

**Documented but not implemented:** none left (STUDIO.md "M/S on focused lane" is the active lane; "Delete = mute" is the
original-cue case). **Implemented but undocumented (now listed in `?`):** `F`, `D`, `Enter` (finish drawing / save comment),
`P`, `[` `]`, `Ctrl+Y`, `Ctrl+R`, `Ctrl+`` , `Ctrl+Shift+C/V`, `Ctrl+Enter` (Ask), `Esc` chain (`R` = Perform record until Perform was removed on 2026-10-19).

## Table (generated view: press `?`)

| Group | Key | Context | Action |
|---|---|---|---|
| Playback | `Space` | global | Play / pause |
| | `←` `→` (also `Ctrl+←/→`) | global | Back / forward 1 frame |
| | `Shift+←/→` (also `Ctrl+Shift+←/→`) | global | 10 frames |
| | `Home` `End` | global | Start / end |
| | `Shift+L` | global | Loop (whole scene unless a region is set) |
| | `A` | global | Original / Draft |
| Timeline | `M` `S` | timeline | Mute / solo the active lane |
| | `F` | timeline | Fit |
| | `Del` / `Backspace` | timeline | Delete selected cue / comment |
| | `Esc` | timeline | Deselect |
| | Ctrl+Wheel, Wheel, Shift+drag ruler, double-click lane | | Zoom, scroll, loop region, add cue (mouse, listed in `?`) |
| Viewer tools | `L` | viewer | Live view |
| | `C` | viewer | Comment tool on / off (click the picture to pin) |
| | `H` | viewer | Show / hide comments on the picture (pins + drawings; the Comments tab stays). Was free (finding 26) |
| | `Esc` | viewer | Back to the default tool (Select in Live, else View) |
| Live / Select | `V` | live | Select tool on / off (Live opens with Select as the default tool) |
| | `[` `]` | live | Walk up / down the stack |
| | arrows, `Shift+arrows` | live (Select, element selected) | Nudge 1 / 10 px |
| | `Esc` | live | Deselect element |
| Comments & Draw | `N` | timeline | Timeline comment at the playhead / selected cue |
| | `D` | viewer | Draw tool: draw on the open comment, or on a new comment at the playhead (was: only on an open comment, `comment` context) |
| | `Enter`, `Esc` | comment (typing) | Save and close |
| | `Enter` / `Esc` | draw (curve being drawn) | Finish / cancel the curve (double-click also finishes) |
| | `Del` / `Backspace` | draw | Delete the selected drawing (Select sub-tool); with nothing selected the key is swallowed (it used to fall through to the timeline and delete the whole comment) |
| | `Esc` | draw (drawing selected) | Deselect the drawing |
| | `Enter` `D` `Esc` | draw | Finish drawing |
| | `Ctrl+Z` | draw | Undo the last drawing change of the session (stroke, move / scale / rotate, delete, clear), then older strokes |
| Layers & Paths | `P` | viewer | Pin / unpin the motion path |
| Render | `Ctrl+R` | global | Open Render (not in a terminal) |
| Terminal & Claude | `Ctrl+`` | global | Open / focus the Terminal panel (from a focused terminal: back to the timeline tab) |
| | `Ctrl+Shift+C` / `V` | terminal | Copy / paste |
| | `Ctrl+Enter` | dialog | Ask Claude: paste into the terminal |
| Code & Versions | `Ctrl+S` | code (typing) | Save the open file (Code mode; outside Code mode Ctrl+S saves the draft) |
| | `↑` / `↓`, `Enter`, `Space` | versions (history row focused) | Previous / next version, open its diff, select / deselect; takes priority over playback and Live nudging. Nested links and buttons keep their native keys |
| | `Ctrl+F`, `Ctrl+D`, `Alt+Click` | editor | Find / replace, next match, add a cursor (CodeMirror's own keys, listed in `?`) |
| | `Esc` | dialog | Close the diff |
| | `Esc`, `Space`, `←` / `→`, `1` / `2` / `3` | dialog | Compare visually: close, play / pause, previous / next frame, side by side / wipe / difference (docs/VISUAL-DIFF.md) |
| Layout | `Ctrl+=` / `Ctrl+-` | global (typing, terminal, dialog) | Whole-UI zoom in / out (70-200 %, saved in settings.json = Settings → Appearance → UI scale) |
| | `Ctrl+0` | global (typing, terminal, dialog) | UI zoom back to 100 % |
| | Right-click a tab, `⋯` | | Panel menu: scale the panel 80-150 %, pop out / back, close (listed in `?`) |
| | Drag a tab / the bar at a panel's top edge | | Move the panel (listed in `?`) |
| Settings | `Ctrl+,` | global (typing); dialog while the page is open | Open / close the Settings page (docs/HOME-SETTINGS.md §2) |
| | `Ctrl+Shift+O` | global (typing, dialog) | Open the welcome window (projects); same as the project breadcrumb or app menu → Switch project… |
| | `Ctrl+F`, `/` | dialog (Settings open) | Focus the settings search (`/` types normally in a text field) |
| | `↑` `↓`, `Enter` | settings search box | Move through the results, jump to the setting (it scrolls into view and pulses); widget-local keys, listed in `?` |
| | `Esc` | dialog (Settings open, typing) | Clear the search / leave the field being edited / else back to the workspace |
| Edit / File | `Ctrl+Z`, `Ctrl+Shift+Z` / `Ctrl+Y` | global | Undo / redo |
| | `Ctrl+S` | global | Save draft |
| | `?` | global | This help |
| | `Esc` | dialog | Close the open dialog |

## Code mode (CodeMirror)
The editor is a contenteditable, so the dispatcher treats it as a text field: only `typing` entries run there (Ctrl+S =
save file via `code.save`, Ctrl+R, Ctrl+`). Every other key (Ctrl+Z, Ctrl+F, Ctrl+D, Tab, Esc for the search panel,
arrows, Space) belongs to CodeMirror. The global "leave the text field" `Esc` skips `.cm-editor`.

## Adding a shortcut
Add one entry to `keymap.js` (`id`, `keys`, `context`, `group`, `label`, `when?`, `run`). It shows up in `?` and is
checked for conflicts. Do not add `keydown` listeners elsewhere (the dock's menus close on Esc with a window-level
capture listener while open; that is the one exception). Check: `node out/studio-keys-check.mjs` (starts its own dev
server on :5179, backs up and restores `out/_reel-test/review/*`); the zoom keys are asserted in
`out/studio-layout-check.mjs`.
