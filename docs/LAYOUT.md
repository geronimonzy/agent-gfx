# gfx studio: dockable layout + UI scale (spec v1)

The goal is to move any panel, dock it to any edge or into a tab group, float it, pop it out to its own OS window
(second monitor), resize it, and scale the whole UI or a single panel. The fixed layout (inspector | viewer | side,
splitter, bottom dock tabs) goes away.

## 1. Library: Dockview (`dockview-core`)
- Plain JS with no dependencies. It fits the framework-free studio. It provides:
  - tab groups and splits on all four edges, with drag-and-drop;
  - floating groups inside the window;
  - popout groups (`window.open` to a same-origin window, sharing the same JS realm and store);
  - `toJSON` / `fromJSON` for layouts.
- Bundled through npm in `apps/studio/web` (no CDN), with the theme mapped to our CSS variables (dark, `--panel`,
  `--border`, `--accent`).

## 2. Panels
Each panel wraps an existing DOM region. The **element is created once and moved, never recreated**, so the video,
canvases, CodeMirror, xterm and listeners keep their state. Element ids stay the same (E2E checks rely on them).

| Panel id | Content (today) | Notes |
|---|---|---|
| `viewer` | `#viewer` (video, overlays, vtools, transport) | Not closable. Has its own fit/zoom, so it gets no per-panel scale (§4). |
| `timeline` | `#tl-scroll` (heads + canvas) | Not closable. |
| `inspector` | `#inspector` | |
| `side` | `#side` (Comments / Changes / Layers / Elements / Versions tabs) | Phase 2 splits these into separate panels. |
| `terminal` | `#term-host` + its tab strip | Replaces the bottom dock tab. Ctrl+` focuses it or opens it. |
| `render` | `#render` | |
| `code-files` | `#code-left` (tree + versions) | |
| `code-editor` | `#code-main` | |
| `code-refs` | `#code-refs` | |
| `t3` | T3 threads list + T3 view (see docs/T3.md) | |

The top bar stays fixed (not a panel). Popovers (note popover, attachment preview, toast, help, dialogs) stay
window-level overlays.

## 3. Layouts per mode
- Review and Code each keep their own layout (Perform, the third mode, was removed on 2026-10-19; a saved layout
  that still names its panel loads without it, and the old `gfx.layout.v1.perform` key is deleted on start). Switching mode saves the current mode's layout and loads the
  next. Panels not in a layout are detached and kept in a hidden holder, so their state is kept.
- Defaults reproduce today's arrangements:
  - Review: inspector left, viewer centre, side right, timeline bottom; terminal and T3 tabbed with the timeline.
  - Code: files left, editor centre, viewer and refs right, timeline bottom.
- Saved app-wide (not per project) in localStorage `gfx.layout.v1.<mode>`. A schema version bump discards old
  layouts.
- Top bar **Panels** menu:
  - a checkbox per panel (show/hide in the current mode);
  - "Reset layout" (current mode);
  - "Pop out" for the focused panel.

## 3a. Compact headers (user request: tab bars take too much space)
- **Groups with one panel have no tab bar.** A 4 px grip line sits at the top edge of the panel. On hover (after
  200 ms), or while a drag is in progress anywhere, it expands over the content into a slim 18 px overlay bar with the
  panel name, a drag handle and a ⋯ menu (scale, pop out, close). It doesn't take layout space.
- **Groups with 2+ panels show compact tabs:** 20 px high, 11 px text, close × only on hover or for the active tab.
- **Panels menu → "Show all headers":** turns full headers back on (for rearranging). Off by default; saved with
  the layout.
- Panels that already have their own header row (the side panel tabs, the code tabs, the terminal tabs) keep it.
  Their dock grip is the same overlay line.

## 4. Scale
- **Whole UI:** Ctrl+= / Ctrl+- / Ctrl+0, in steps of 70–200 %.
  - Tauri: `webview.set_zoom` (capability `core:webview:allow-set-webview-zoom`).
  - Dev shim: CSS `zoom` on `<html>`.
  - Persisted per machine.
  - Registered in the shortcut registry (docs/KEYS.md) and shown in `?` help.
- **Per panel:** the tab context menu offers Scale 80 / 90 / 100 / 115 / 130 / 150 %. It applies CSS `zoom` to the
  panel content and is saved in the layout JSON. Code that maps the pointer to content coordinates (timeline canvas,
  inspector drag fields) must stay correct under `zoom`. Verify it in the spike, and if it can't be fixed cheaply,
  exclude that panel. The viewer is excluded from per-panel scale.

## 5. Pop-out windows
- Dockview popout groups move panel elements into a second window. Things to handle:
  - the keyboard dispatcher listens on popout documents too;
  - `ResizeObserver`/DPR-based canvases re-measure on move;
  - the video keeps or restores `currentTime` and play state after a move;
  - xterm re-fits.
- On closing a popout, its panels return to their last docked position (Dockview default).
- Tauri must allow `window.open` for the same origin (new-window handler). **Spike first.** If pop-outs can't be made
  reliable in WebView2, ship floating groups and leave pop-outs for later.

## 6. Spike (before building)
Run a throwaway branch with dockview-core and the real studio. Check these in the **Windows exe**:
1. Popout of the timeline and the viewer, including playback sync and keys in the popout.
2. Per-panel `zoom` with timeline/inspector pointer math.
3. A Tauri child webview (T3, docs/T3.md §4) following a panel's rect.

## 7. Tests
- `out/studio-layout-check.mjs`:
  - default layouts per mode;
  - move a panel and reload, expecting the layout to persist;
  - reset;
  - hide/show from the Panels menu;
  - per-panel scale persisted;
  - all existing element ids still present.
- Existing E2E checks keep passing. Update their selectors only where the dock tab strip changed.

## As built (step 1: dock + compact headers + scale + pop-outs; 2026-10-15)
- **Code:** `web/src/layout.js` (dockview setup, panels, per-mode layouts, menus, scale, UI zoom, pop-outs),
  `web/src/layout.css` (theme on our variables, compact headers, menus), `web/src/dom.js` (shared `$`),
  `web/public/popout.html`, `src-tauri/src/popout.rs`. dockview-core 8.5.1 (devDependency, bundled).
- **Panels (§2):** as in the table (`t3` added with docs/T3.md: a third tab next to Timeline and Terminal). `index.html` keeps every panel element in a hidden
  `#panel-holder`; the dock (`#stage`) moves them in and out. `#splitter` and `#dock-tabs` are gone. The terminal is
  `#terminal` = `#term-tabs` (one tab per terminal, no Timeline tab) + `#term-host` (empty state: New terminal /
  Claude). `#code-refs` moved out of `#viewer` into its own panel. Only the viewer uses `renderer: 'always'` (the
  video and the Live iframe must not be re-parented when tabs switch or groups move); other panels are detached when
  they are a hidden tab. Every module's `$` is `dom.js`'s: it also finds elements in detached tabs, the holder and
  pop-out documents (`registerRoot` / `registerDoc`). `x.ownerDocument.activeElement` replaces `document.activeElement`
  where inputs are protected from re-render.
- **Per-mode layouts (§3):** defaults are serialized dockview JSON (`defaultLayout(mode)`) loaded with
  `fromJSON(..., { reuseExistingPanels: true })`, so switching mode / Reset keeps live panels where they are (no
  iframe reload). Review: inspector 292 | viewer | side 320, timeline 340 with Terminal tabbed behind it. Code: files 280 | editor | viewer over code links (66/34), timeline + terminal. Panels
  offered per mode (`MODE_PANELS`): Review = viewer, timeline, inspector, side, terminal; Code
  = code-files, code-editor, viewer, code-refs, timeline, inspector, side, terminal. `render` is transient: the Render
  button / Ctrl+R adds it as a tab in the side group (`#render[hidden]` still says open / closed), closing its
  tab closes the dialog, and it is dropped from a layout when restored closed. Viewer and timeline are not closable.
  Saved in `gfx.layout.v1.<mode>` as `{ v, showHeaders, dock }` (debounced on every layout change and on unload).
  Pop-out windows are not re-opened: on save, a popped-out panel is folded back into the hidden grid group it came from
  (`foldPopouts`), so it returns to its docked spot. **Panels** button (top bar): a checkbox per panel, Pop out (active
  panel), Show all headers, Reset layout (current mode), UI scale − / % / +.
- **Compact headers (§3a):** implemented by restyling dockview's own header (not `hideHeader`): in a single-panel group
  (`.gfx-compact`) the header is `position: absolute`, 4 px high, contents hidden; hover for 200 ms (or any dock drag,
  or its menu open) turns it into the 18 px overlay bar (grip, name, ⋯). The bar *is* dockview's tab, so dragging it is a
  real dockview drag (dockview 8 uses pointer-based DnD; verified by a mouse drag in the E2E). Groups with 2+ panels:
  20 px tabs, 11 px text, × on hover / active tab only (custom tab renderer `Tab`; viewer / timeline have no ×).
  Right-click a tab or ⋯ = panel menu (Scale chips, Pop out / Back to the main window, Close).
- **Scale (§4):** per panel = CSS `zoom` on the panel wrapper, saved in the panel's `params.scale` (layout JSON); viewer
  excluded. Pointer math: the timeline divides `clientX - rect.left` by `zoomOf(cv)` (`currentCSSZoom`) and sizes the
  canvas backing store with `pixelRatioOf(cv)` = DPR × zoom (`noteScreenPos` multiplies back); it re-lays out on
  `panel-scale` / `dock-moved`. The inspector has only native inputs (range / number), xterm's fit and CodeMirror's
  hit-testing were measured correct under 130 % without changes. Whole UI: Ctrl+= / Ctrl+- / Ctrl+0 (registry group
  "Layout"), steps 70/80/90/100/110/125/150/175/200 %, `localStorage gfx.uiZoom`; Tauri `getCurrentWebview().setZoom`
  (+ every open pop-out via `getAllWebviews`), dev shim CSS `zoom` on `<html>` of every document. A narrow viewer
  hides the transport's secondary controls (container queries).
- **Pop-outs (§5):** `popout(id)` = `addPopoutGroup(panel, { popoutUrl: './popout.html', position: the panel's screen
  rect })`; when it resolves the popout document gets the key dispatcher (`installKeysOn`), is registered for `$`, and
  forwards `message` events to the main window (the Live bridge iframe posts to its parent). `onWillClose` closes the
  Tauri window by label (`close_popout`). "Back to the main window" closes the window, so dockview restores the group
  where it was. The `<video>` reloads when adopted: on `emptied` with the same source it restores `currentTime` / play
  state on `loadeddata`. The Live iframe reloads when moved to another document: `live.js` re-syncs on its second
  `load`. Rust: `popout::build_main` builds the main window in `setup()` (`"create": false`) with `on_new_window` →
  `NewWindowResponse::Create` for our own `popout.html` only (`is_popout_url`, unit-tested), others denied;
  capabilities `allow-close-popout`, `core:webview:allow-set-webview-zoom`, `core:webview:allow-get-all-webviews`.
- **Tests:** `out/studio-layout-check.mjs` (52 checks: defaults per mode, compact header sizes + hover delay + overlay
  above the viewer, drag from the compact bar, move + reload persists, reset, hide / show from the Panels menu,
  per-panel scale persisted + timeline clicks at 130 % and under UI zoom, Show all headers persisted, zoom keys,
  Render panel, Ctrl+`, pop-out timeline with Space in the popout + close returns it, pop-out viewer + video restore +
  back to the original spot, all element ids). E2E selector updates: render-check (side is a hidden tab, not
  `[hidden]`), terminal-check (sash instead of `#splitter`, panel visibility instead of `#term-host[hidden]`),
  keys-check (terminal visibility). Windows exe (WebView2 155, `gfx-studio-spike` build): pop-out timeline (Space +
  ruler click in the popout, native close returns it), pop-out viewer (video at the playhead, Space plays, back to its
  spot), Ctrl+= ×2 → DPR 1.25 with correct timeline clicks, Ctrl+0, timeline at 130 % clicks exact.
- **Known limits:** popovers (comment popover, toast, help, dialogs) stay in the main window even when the panel that
  opened them is popped out. The old `gfx-studio.tlh` (splitter height) is ignored. A panel that is not offered in the
  current mode can't be added there (e.g. Code links in Review). In the dev shim the UI zoom is CSS zoom on `<html>`, so
  dockview's own sash / float drags are only approximate there (the app uses `setZoom`).

## Spike results (2026-10-15, Windows exe, Tauri 2.12.4, WebView2 155, dockview-core 8.5.1)
Throwaway code: worktree `agent-a90869834f0293fb5` (`spike-dock.js`, `spike.rs`, `public/popout.html`).
- **Popout works.**
  - The main window must be created in `setup()` (`"create": false`) with `WebviewWindowBuilder::on_new_window`
    returning `NewWindowResponse::Create`. `Allow` hangs dockview.
  - Import `dockview-core/dist/dockview-core.js` (it injects CSS); set `popoutUrl: './popout.html'`.
  - Install the key dispatcher on the popout document after `addPopoutGroup` resolves.
  - Keep element refs (no `getElementById` for moved panels).
  - In `onWillClose`, close the Tauri window by label.
  - Moving `<video>` between documents reloads it: restore `currentTime` and play state on `loadeddata`.
  - The timeline canvas, scrubbing and resize all work in a popout.
- **Per-panel zoom:** pointer math is off by ×zoom. Divide by `el.currentCSSZoom`, and size canvas backing stores
  with `dpr * currentCSSZoom`. This applies to every rect/clientX handler in zoomable panels.
- **Whole-UI zoom:** `getCurrentWebview().setZoom()` works with no code changes (DPR follows).
- **Child webview** (`unstable`, `Window::add_child`, `set_bounds` physical, `show`/`hide`, `reparent`):
  - bounds match the panel rect × DPR through resize, move, tab switch and window resize;
  - HTML overlays are covered (as expected);
  - `reparent` into a popout works;
  - it shares the app's WebView2 profile (cookie persists);
  - it doesn't inherit the main zoom.

## Note (2026-10-16, docs/HOME-SETTINGS.md)
The UI scale and "Show all headers" are machine settings now (`settings.json` `uiZoom`, `showHeaders`; Settings →
Appearance), no longer `localStorage gfx.uiZoom` / the per-mode layout JSON. Menus live in `web/src/menu.js` + `menu.css`.
