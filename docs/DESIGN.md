# gfx studio design system (spec, 2026-10-16)

The user likes T3 Code's look and wants gfx studio to feel like it. Requirement: **modular, no hard-coded values**, so
the design can be changed later in one place. Source of the look: T3's tokens in
`~/claudeStuff/t3code/apps/web/src/index.css` (`:root` and `@variant dark`, ~lines 1108–1225) and its
shadcn-style components (`apps/web/src/components/ui/*`). We copy **values and shapes**, not code: the studio is plain
JS + CSS, with no Tailwind, React or new dependencies.

## 1. Architecture (three layers)
```
apps/studio/web/src/theme/
  primitives.css   raw colour palette and theme-specific select indicator assets; imports local font faces
  scale.css        one :root contract for fonts, type, spacing, roles, geometry, motion and z order
  dark.css         colour-only semantic tokens for [data-theme="dark"] (default) — values from T3's @variant dark
  light.css        colour-only semantic tokens for [data-theme="light"] — values from T3's :root (light)
  components.css   shared primitives built only from semantic tokens: buttons (variants × sizes), inputs, selects,
                   textareas, checkboxes/switches, tabs/segmented, cards/panels, menus/popovers, dialogs/modals,
                   toasts, badges/pills, kbd, tooltips, scrollbars, focus ring
  density.css      [data-density="dense"|"comfortable"] remaps size tokens (control heights, text sizes, gaps)
```
- Feature CSS files (`styles.css`, `layout.css`, `settings.css`, `library.css`, …) use **semantic tokens only**
  (`var(--card)`, `var(--text-sm)`, `var(--radius-control)` …), never primitives and never literals.
- `html[data-theme]` selects the theme (default `dark`). `data-density` goes on regions: `comfortable` for chrome
  (top bar, dialogs, Settings, Library, welcome, New scene), `dense` for work areas (timeline, tracks, inspector,
  layers, code panel, render queue rows).
- JS that needs colours (canvas timeline/waveforms, paths overlay, xterm, CodeMirror) reads them through one helper
  `src/theme.js`: `tok('--timeline-grid')` (cached `getComputedStyle` on `<html>`, cleared on a `theme` event).
  CodeMirror themes use `var(--…)` strings directly. xterm gets concrete values from `tok()` and is re-themed on
  change.

## 2. Semantic tokens (names; values per theme from T3)
- Surfaces: `--background` (dark: neutral-950), `--card` (mix(background 97%, white)), `--popover`, `--muted`
  (white/3%), `--accent` (hover; white/4%), `--surface-raised`, `--app-chrome-background`.
- Text: `--foreground` (neutral-100), `--muted-foreground` (mix(neutral-500 90%, white)), `--card-foreground`,
  `--popover-foreground`, `--accent-foreground`, `--placeholder`.
- Lines: `--border` (white/6%), `--input` (white/8%), `--ring` (= primary).
- Brand/state: `--primary` (oklch(0.571 0.21 264)), `--primary-foreground`, `--error`, `--error-foreground`,
  `--error-surface`, `--warning`(+fg, surface), `--success`(+fg), `--info`(+fg).
- Studio-specific (new, documented): stem colours `--stem-hits`, `--stem-motion`, `--stem-ui`, `--stem-accents`,
  `--stem-note` (keep today's hues, tuned for the new background), `--timeline-bg`, `--timeline-grid`,
  `--timeline-playhead`, `--selection`, `--live-error-*`, `--code-background`, `--terminal-background`,
  `--terminal-foreground`, `--terminal-cursor`, `--terminal-selection-background`, markup palette `--markup-1…6`
  (today's draw COLORS; a comment stores the resolved hex, so existing comments are unchanged).
- Shape/size: `--radius` (0.625rem), `--radius-control` (0.5rem), `--radius-sm`, `--pill-radius`; text
  `--text-3xs` 10px, `--text-2xs` 11px, `--text-xs` 12px, `--text-sm` 13–14px, `--text-base`; control heights
  `--control-h` / `--control-h-sm` / `--control-h-xs` (comfortable 32/27/24 px; dense
  23/21/20); `--gap-1…4`; `--font-sans` (local Inter with system fallbacks),
  `--font-field` (Inter Field), `--font-mono` (local IBM Plex Mono with system fallbacks); z-index scale `--z-*`; `--glass-blur` / `--glass-opacity`
  for overlays (T3: 12–16px, 80%).

## 3. Component shapes (T3 reference)
- Buttons: `.btn` + variant (`default` = subtle bordered on card, `primary`, `ghost`, `outline`, `destructive`) +
  size (`xs`/`sm`/`default`/`icon`); radius `--radius-control`; 1px `--border`; hover `--accent`; active scale 0.97;
  focus ring 2px `--ring` inset; disabled opacity 0.64. Existing class names (`tbtn`, `primary`, `mini`, `sm` …)
  either become aliases in components.css or are migrated; keep every id/class the E2E checks select.
- Inputs/selects: height `--control-h`, `--input` border, `--card` fill, placeholder `--placeholder`.
- Panels/cards: `--card` on `--background`, 1px `--border`, `--radius`; no milky grey fills (T3 comment: "borders and
  hover states provide separation").
- Menus/popovers/dialogs: `--popover`, `--border`, `--radius`, glass blur, soft shadow token `--shadow-overlay`.
- Tabs/segmented: muted track, active = card + border.
- Typography: base `--text-sm` in comfortable regions, `--text-xs` in dense; headings by weight, not size jumps.

## 4. Rules (enforced)
- No colour literals (`#…`, `rgb(…)`, `hsl(…)`, `oklch(…)`, named colours except `transparent`/`currentColor`/
  `inherit`) outside `src/theme/*.css`. The same goes for font sizes in px/rem, radii and z-index numbers outside the
  theme layer (use tokens). Inline styles in JS templates follow the same rules.
- Allowed exceptions are listed in `src/theme/allowlist.json` with a reason each: scene/content colours that are
  data, e.g. `style.colors` of a scene preset shown as swatches, a colour picker's value, stored markup stroke colours.
- Gate: `node apps/studio/web/scripts/check-tokens.mjs` scans `src/**/*.css`, `src/**/*.js`, `src/**/*.html` and root HTML entrypoints (inline `style=`,
  `.style.` assignments, canvas fonts and colours, and undefined custom properties) and exits non-zero listing file:line for every
  violation. Its unit test `src/check-tokens.test.js` joins the studio unit-test list in CLAUDE.md.

## 5. Scope
- In: all studio windows: main, welcome, pop-outs, Settings, Library, New scene, dialogs, toasts; dockview theme
  (layout.css variables); CodeMirror theme (cm.js); xterm theme (terminal.js); canvas colours (timeline, tracks,
  waveforms, paths, draw overlay); dark + light themes (`data-theme`), defaulting to dark.
- Out: layout and structure changes, behaviour, renamed ids/classes used by tests, new dependencies, scene rendering.
  The Settings row to pick the theme (System/Dark/Light) is a separate small task (settings schema + prefs.rs).
- Screens to compare before/after: main window (Review, with timeline), Live + inspector, Code mode, Settings,
  Library, New scene, welcome window.

## As built (§5)

All windows import `primitives.css`, `scale.css`, `dark.css`, `light.css`, `components.css`, then `density.css`,
followed by feature sheets. Pop-outs copy these styles through dockview; their shell uses semantic surfaces.
`scale.css` is the single non-colour token owner. Dark/light sheets contain only colours and colour assets;
`density.css` alone owns control heights. A nested `data-theme` therefore cannot reset density.

The spacing scale is the 1 px hairline and even 2–32 px steps. Odd spacing composes an even step plus the hairline.
Lengths with a purpose use roles: `--dialog-w-sm/md/lg`, `--popover-w`, `--pill-radius`,
`--stroke-emphasis`, and feature geometry grouped by owner in `scale.css`. Equal values in unrelated roles stay
independent; related consumers (thumbnail sizes, viewport gaps, field widths) share tokens. Motion uses
`--motion-fast/base/slow` and named animation roles (spinner, recording pulse, Claude pulse, etc.). Values are
preserved from the approved dark theme. Query breakpoints remain literals because CSS variables cannot set them.

Z order is one role scale, relative to dockview's sashes at 99 and overlays at 999–1001:

| Role | z-index | Scope |
| --- | --- | --- |
| base | 0 | Local style-guide specimens |
| content / annotation | 1 / 2 | Panel content and markup |
| panel-controls / panel-overlay / panel-feedback / panel-crop / panel-header | 3 / 4 / 5 / 6 / 20 | Local panel ordering |
| page | 1100 | Settings and Library |
| modal-backdrop / modal | 1200 / 1201 | All dialogs and attachment preview |
| popover / menu | 1300 / 1400 | Note popover and action menus |
| lightbox | 1450 | Full-screen previews opened from a popover or menu (`#att-preview` above `#note-pop`) |
| toast / tooltip | 1500 / 1600 | Global feedback |
| drag | 1700 | Reserved contract for drag ghosts; intentionally unused by current app CSS |

Action aliases use `:where()` so unrelated tag/class specificity cannot suppress feature overrides. Stale
pre-theme button declarations were removed; native field predicates, field size rules and status geometry keep
their precedence to preserve the approved metrics. Shared fields, keyboard keys, focus ring, dialog base and
standard scrollbar properties each have one owner in `components.css`. Feature fields never use font shorthand;
multiline editors retain textarea leading (`--textarea-leading` 1.4 or `--textarea-leading-prose` 1.45).

`theme.js` exports `tok(name, scope?)`, `clearTokens()` and `setTheme()`. Root reads are cached; scoped reads use
the supplied element. Colours resolve to sRGB for canvas/xterm. Theme events clear cached values before repaint.
Canvas timeline geometry uses `--timeline-*` tokens proportional to `--text-3xs`, resolved as used CSS lengths at
initialization and on theme, ancestor density/style, panel scale and dock changes. Row hit tests and DOM headers
share these dimensions. Defaults remain ruler 28, thumbnails 44, notes 24, layers header/row 20/14, group 18,
video/audio summaries 26/34 and curve row 15 px.

The token gate rejects undefined `var(--name)` references across CSS, HTML and JS strings unless they carry a
fallback or appear in its reasoned runtime allowlist (`--c`, assigned per stem/element by JS). `--unused` reports
defined tokens without references, including JS `tok()` reads and dynamic palette prefixes. Dockview's `--dv-*`
properties are separately counted as an external consumer contract. Literal exceptions stay in
`theme/allowlist.json` with exact matches and reasons. Tests cover missing references, nested fallbacks, runtime
allowlist reasons, unused tokens, HTML styles, canvas font interpolation and JS inline width/height lengths.

Production Vite inputs are main and welcome, matching the input graph before 7539119. The default build emits
`tools.css` before `main.css`; theme/base styles precede feature styles and xterm CSS follows the feature sheets.
The guide input is opt-in for builds (`GFX_STYLEGUIDE=1 npx vite build --configLoader runner`) and always available
in dev/serve. It is excluded from the default exe assets.

Font licence texts are copied from the bundled font directory through Vite's default `public/` directory to:
`/licenses/LICENSE-Inter.txt` and `/licenses/LICENSE-IBM-Plex-Mono.txt`. The build adds the repo's `LICENSE` (as
`LICENSE-gfx.txt`) and `THIRD_PARTY_NOTICES.md` there too (`licenceAssets` in vite.config.js; they are not copied into
the repo); Settings → About shows all four (docs/HOME-SETTINGS.md, About page). `THIRD_PARTY_NOTICES.md` lists both
scene and studio font locations.

## 6. Living style guide (2026-10-16, user decision: style guide first)
- `apps/studio/web/styleguide.html` + `src/styleguide.js`, served by the dev shim (`/styleguide.html`). Production includes it only with `GFX_STYLEGUIDE=1`. It renders every shared component with the real CSS (theme + components + feature classes the app
  uses, e.g. `.tbtn`, `.seg`, `.chip`, `.badge`, `.icon`, `.primary`, `.split`, `kbd`, menus, `.modal`, toasts, cards,
  settings rows, inputs/selects/textareas/checkboxes/switches, tabs, tooltips).
- Matrix per component: variant × size (xs/sm/default/icon) × state (rest, hover, active, focus-visible, disabled,
  selected/on, with icon, icon-only, with kbd hint, with badge/count, long label/ellipsis). Typography scale, colour
  tokens (swatches with names), spacing/radius/shadow tokens, density (dense vs comfortable side by side).
- Toggles: theme dark/light, density, a "baseline grid" overlay (centre lines) to check vertical centring.
- Polish rules it must make visible and pass: labels truly centred (inline-flex, align-items/justify-content center,
  line-height 1, no baseline-dependent padding); equal heights for buttons, inputs, selects and segmented controls of
  the same size; consistent icon sizes and gaps; font-weight 500 for controls; one focus ring style; disabled = 0.64
  opacity; no clipped descenders.
- **Centring = equal space above the caps/ascenders and below the baseline** (the user's eye; not x-height or
  optical shifts). Chromium snaps the baseline to whole CSS px, so: (height − 2·border − rendered cap) must be even.
  Inter caps render 8/9/10 px at 11/12/14 px, hence odd heights (21/23/27) for 12 px controls. Font metric
  overrides in `theme/fonts.css` ("Inter" for flex controls, "Inter Field" for text fields with line-height = inner
  height, "IBM Plex Mono Label"/"Field") place the caps; no half-pixel nudges (they snap away).
- **Measuring at whole-pixel positions.** A control's top y fraction moves its snapped baseline by up to 1 px, so
  centring is calibrated with controls on whole pixels (the app keeps bars/Settings on the pixel grid, see
  `scripts/check-pixel-grid.mjs`). `scripts/ink-int.mjs` clones a control into a fixed container at an integer y
  (optional fraction argument) for calibration; in-place measurements must check the element's y first.
- **Measuring** (real elements only; cloned specimens render differently):
  `node apps/studio/web/scripts/ink-real.mjs http://127.0.0.1:5177/styleguide.html '[["btn","button.btn.sm"]]'`
  then `python3 apps/studio/web/scripts/ink-glyph.py` → per element "above caps / below baseline → HIGH|LOW by x px".
  Target ≤0.12 px (previously measured at ≤0.12 px; leftovers: dense Settings path field 0.38 px, keys-help kbd ~0.5 px).
- **Pixel-grid check** (real app, 100% UI and panel scale):
  `node apps/studio/web/scripts/check-pixel-grid.mjs http://127.0.0.1:5177/#scene=_reel-test --settings`
  audits 1280 and 1680 px by default (`--width=1600` selects one width). It lists selector paths, top and height for
  fractional `button`, `input`, `select`, `.chip`, `kbd` and `[role=tab]` boxes in the top bar, playback bar and Settings,
  and exits non-zero on failures. `--settings` opens Settings with Ctrl+, and visits every category. Without the flag
  it audits the workspace only. `GFX_CHROME` can select the local Chrome executable. No screenshots or settings writes.
  Container parity accompanies cap parity: toolbar 40 px minus its 1 px border = 39 px inner; 23 px controls leave
  16 px. Transport 43 − 1 = 42 px inner; 32 px actions leave 10 px and the 16 px range leaves 26 px. Settings header
  41 − 1 = 40 px inner; 32 px actions leave 8 px. Settings text rows use integer 20/16 px leading; search 34 − 2 =
  32 px inner. Change these role tokens together; every centred difference must remain even.
- **All number inputs show their value in mono** (user decision 2026-10-17): `input[type=number]` swaps
  `--font-field` to `--font-mono-field` and renders one `--mono-field-step` (1 px) larger. Plex Mono digits are
  ~4% smaller than Inter caps, and at the same size they broke the parity rule (0.38 px low). At +1 px they
  measure ≤0.12 px (comfortable default 0.25 px).

### As built (§6)

Comfortable controls are **32/27/24 px**, dense controls **23/21/20 px**. Density owns those heights;
`--kbd-h` is **17 px**, with a 15 px inner line box and no block padding. Status boxes stay 18 px outside the top bar (its status chips follow the 23 px toolbar contract in §7).
The former ≤1600 px top-bar 11 px / 21 px exception is replaced by §7’s container-query collapse steps.

Local Inter 400/500/600/700 and IBM Plex Mono 400/500/600 ship as WOFF2. Flex labels use Inter (ascent 101%,
descent 25%; recalibrated 2026-10-17 at whole-pixel positions: 98–104% centre every 11/12/14 px control, 106% was
calibrated on the guide's accidental fractional positions and left 11/12 px labels 1 px low on the pixel grid); native text fields use Inter Field (ascent 96.1%, native descent). Plex labels use IBM Plex Mono Label
(ascent 107%, descent 30.1%); mono fields use IBM Plex Mono Field (ascent 99.9%, descent 30.1%). Editors keep the
original Plex face. Font files, metric overrides, control font sizes and density heights are unchanged by hardening.
The parity rule and real-element measurement procedure above remain the authority; the guide reads height labels
from the actual density tokens instead of duplicating their numbers.

Hardening review points for the orchestrator's Chrome re-measurement:
- New scene text fields (including mono `#ns-name`) and welcome `.wl-form input[type=text]` now keep the field face
  and full inner-height leading rather than resetting them with shorthand; they also retain the shared field weight
  (500). New scene textarea keeps token leading and shared weight (500).
- Library textarea now keeps the shared 1.4 textarea leading instead of inheriting body leading.
- Buttons (`.btn`, `.tbtn`, `.mini`, `.proj-btn`, primary/icon variants), nested kbd hints and welcome action cards
  should retain their previous computed family, size, leading, height and padding after the specificity cleanup.
  Recheck default/sm/xs, hover/on states and both densities; the font metrics were preserved in the source.
- Nested dark/light guide panels no longer reset control heights; light-theme status/kbd/control padding now uses
  the same shared dark-approved contract. Modal/popover/menu/preview/toast z order changes deliberately.
  Production restores xterm CSS after feature CSS; check terminal controls and its hidden helper textarea as well.
- Timeline default geometry and annotation label size stay identical; changing the text token now resizes rows.

Validation is source/build based here; the sandbox cannot run Chrome. The existing ≤0.12 px centring result has
not been re-measured in this round. Run the ink tools on real app controls before accepting visual parity.


### As built (2026-10-17 leading round)

`scale.css` owns inherited `--leading` (1.35), `--leading-tight` (1.3) and `--leading-loose` (1.5).
Existing textarea (1.4/1.45), label (1.25), hint (1.7), empty-state (1.6) and code (1.55) ratios retain their roles.
Consumers resolve `round(nearest, calc(var(--leading) * 1em), var(--leading-step))` at their own font size.
**Gotcha:** `:where(*)` (theme/components.css) recomputes every element's line-height from `--leading`, so a px
line-height set on a container no longer reaches its children. To give a block a fixed px leading, set it on the
children too (e.g. `.sp-crumb, .sp-crumb > *`), or change `--leading` instead. Inside `#settings-page`, controls and
editors, line-height is inherited as before (the `inherit` list in components.css).
`--leading-step` defaults to 1px; selected centred text stacks in dialogs, Library, Render and welcome use 2px
so their line boxes share the even controls' parity. Both steps keep each line within **±1px of HEAD**.
Any larger change needs a measured defect, with selector, old/new values and reason recorded in the audit.
There are no intentional >1px exceptions in this revision; computed-style confirmation remains pending.

Shorthands that previously reset leading to `normal` use font-specific tokens: `--leading-normal` = 1.26
(Inter's 101% ascent + 25% descent), `--leading-normal-mono` = 1.30 (bundled Plex's 1025/275/1000 metrics).
Controls retain their calibrated line boxes; Settings retains its existing 20/16px stacks; editors retain inheritance.
Timecodes keep 16px/12px geometry. Standalone help rows use 16px leading (formerly 16.2px), inline key groups keep
separator auto sizing, and Settings' pre-existing 20px help rows stay unchanged. Welcome action captions use 15px
(formerly 14.85px). The guide uses the shared leading rules; the full inventory is in [LEADING-AUDIT.md](LEADING-AUDIT.md).

**Floating-surface rule:** CSS owns descendant heights, padding, gaps and leading. There is no JS descendant snapper,
MutationObserver, ResizeObserver or scroll listener for pixel alignment. `surface-origin.js` exports only
`roundSurfaceOrigin(surface?)`: it resets and rounds the outer `.modal-back > .modal`, `#note-pop`, `#toast` or
`#live-err` with an independent `translate`, preserving the existing transform and moving borders/background/content
together. Dialog opening code (help, Ask, diff, licence, New scene), note positioning, toast display and Live error
placement call it; the module also calls it on window resize for visible surfaces. Licence and Ask brief loading re-run placement
when their opening requests finish. Menus round x/y in `menu.js`. Nothing reads descendant geometry while scrolling.
`ink-int.mjs` is back to HEAD; no observer opt-out is needed. The diagnostic contract remains 100% UI/panel scale.

Settings headings/scope padding includes the card hairline, aligning headings with row titles. The path input stays
`--settings-field-w` (240px) with Browse beside it and the original 6px gap; only unfocused ellipsis is added, keeping
path direction and focus rules. Engine/tool stacks and buttons use 8px gaps, T3 list gaps use 4px. The mono field
keeps its former leading ratio, with one 1px font step for the measured dense path-field cap defect; ink needs a recheck.
New scene Look keeps the definite token max-width plus `min-width: 0` from round 1. Narrow Settings alignment keeps
its precedence fix. CSS nearest-even text leading, small-button margin parity and the welcome status hairline parity
replace descendant translations. No copy, actions, or scene-rendering code changes.

The pixel-grid diagnostic retains its workspace/`--settings` modes and now checks computed text line-height,
including `normal`, for labels, paragraphs, list/table/heading/small/hint text and direct text nodes. It also checks
block/flex/grid text origins in every region, including dialog descendants; inline glyph bounds are font metrics.
Reports retain selector paths and top/height, add surface left coordinates and line-height, and exit non-zero on any violation.
`--dialogs` opens keys help via `?`, Settings → About → MIT licence, Ask Claude (when a scene is open), New scene
and Render (when a project is open), plus the production diff with an in-memory read-only sample. No Create,
Send, save or render action is invoked. `--library` visits all three list tabs; `--welcome` visits welcome home,
template selection and the name form without creating a project. `--welcome-only` skips the workspace entirely.
`--open-dialogs` / `--overlays` inspect any already-visible dialogs / floating UI at page startup; absence is allowed.
Use an existing scene URL for Ask Claude and project-dependent UI. Example:

```sh
node apps/studio/web/scripts/check-pixel-grid.mjs http://127.0.0.1:5177/#scene=_reel-test --settings --dialogs --library --welcome
# Odd viewport height exercises the half-pixel centring case:
node apps/studio/web/scripts/check-pixel-grid.mjs http://127.0.0.1:5177/#scene=_reel-test --dialogs --width=1500 --height=999
node apps/studio/web/scripts/check-pixel-grid.mjs http://127.0.0.1:5177/ --welcome-only
```

Source token gate (0), token tests, all 11 studio unit groups, production Vite build and diagnostic syntax check pass.
Browser geometry, ink, screenshots and E2E remain for the orchestrator; this round claims no measured visual parity.

## 7. Top bar (user decision 2026-10-16: consolidate as proposed)
```
[▣ ▾]  project / scene ▾  [status chips]  ···   Review | Code   ···   [Claude ▾ ●n]  ↶ ↷  [Queue n]  [Render ▾]  [Save draft]
```
- ▣ app menu (logo): Settings (Ctrl+,), Library, Panels, Keyboard shortcuts (?), Switch project… (Ctrl+Shift+O).
- Breadcrumb `project / scene ▾`: project name opens the welcome window (switch project); the scene menu lists scenes
  and has New scene…, Edit brief… (when BRIEF.md exists) and Reload from disk. Replaces the scene `<select>`, `+`,
  Brief, ↻ and the project button.
- Status chips only when needed: "changed on disk" (click = reload; replaces ↻), "changed by Claude", "rendering…".
- Modes centred: Review | Code (Perform removed 2026-10-19).
- Claude ▾: one button; click = the last used target; menu = Claude in terminal / T3 panel (+ the T3 waiting badge).
- Original/Draft (audition A/B) moves to the playback bar (next to Loop / speed). Versions: side-panel tab + shortcut
  only. Undo/redo, Queue (when jobs exist), Render ▾ and Save draft (the single primary button) stay on the right.
- Every removed control keeps its keyboard shortcut and stays reachable (menus). E2E checks that click removed
  buttons must be updated to the new path, not deleted.

### As built (§7)

The production DOM stays in `apps/studio/web/index.html`. `toolbar.css` owns the chrome layout, `toolbar.js` owns
entry points, and `toolbar-items.js` shares menu descriptions with the guide. Scene loading / refresh / draft conflict
handling stay in `main.js`; `newscene.js`, `settings.js`, `library.js`, `layout.js`, `render.js`, `terminal.js` and `t3.js`
keep their original actions. No shortcut bindings or shortcut labels in `keymap.js` changed.

| Area | DOM and entry points |
| --- | --- |
| App | `#app-menu-btn` (logo + caret): Settings (`settings`), Library (`library`), Panels (`panels`), Keyboard shortcuts (`help`), separator, Switch project… (`welcome`). Panels opens the existing layout menu anchored to the logo. |
| Breadcrumb | `#root-btn` survives as the project link to the welcome window. `#scene-menu-btn` replaces `#scene-select`. Menu items: `scene:<name>` (current checked, existing render-state suffixes retained), separator, `scene-new` = New scene…, `brief` = Edit brief… only with BRIEF.md, `reload` = Reload from disk. `scene-new` and `reload` disable with no project. |
| Status | `#disk-badge` survives, now with icon + label: `S.disk.changed`, click calls the same scene-list refresh and reload path as the menu. `#claude-chip` survives and keeps `pulse.js` idle / file-change / Live reload state (the pulse moves to the breadcrumb). `#synth-chip` survives: synth busy OR an active render/canceling job (`render-busy` event from `render.js`). |
| Modes | Existing `#mode-seg`: Review / Code, in the centre column of `minmax(0, 1fr) auto minmax(0, 1fr)`. Both side columns can shrink independently; mode centre stays at bar centre. |
| Claude | `#claude-split`, surviving `#claude-btn` primary segment, `#claude-menu-btn` caret. Menu items `claude-terminal` = Claude in terminal and `t3` = T3 panel; current target checked. Selection opens that target and writes machine `settings.json` → `claudeTarget` (`terminal` default or `t3`). `settings-core.js` and Rust `prefs.rs` validate it; project overrides are refused. Main segment opens the stored target. The T3 waiting badge is now `#claude-btn .t3-badge` (●n); connected/off state lives on `#claude-split`, connection detail on the badge title/accessible label. |
| Playback | Existing `#ab` moves immediately after `#loop-btn`, before `#rate`; Original / Draft actions and `A` binding stay intact. |
| Versions | Top-bar `#versions-btn` removed. Existing `#tab-versions` in the side panel and Code’s `data-ct=versions` tab remain. |
| Right actions | Existing `#undo-btn`, `#redo-btn` now have icons + collapsible labels. `#rq-btn` shows Queue n while the current project has jobs (including finished jobs, so results remain reachable), with progress in its title. Existing `#render-btn` retains click / Shift+click behavior; `#render-quick` becomes the Render caret menu (Render… and Quick render). `#save-btn` is the only primary button in the bar, including for unrendered scenes. |

All menus use `openMenu()` / `.gfx-menu`; menu ids above are `data-id` selectors. Hints come from `keysOf()` after
`initKeymap()`: Settings Ctrl+,, Keyboard shortcuts ?, Switch project Ctrl+Shift+O, Render Ctrl+R, and the existing
Shift+Click Render hint for Quick render. Arrow keys / Home / End navigate enabled menu items; Esc returns focus to
the trigger, outside click and blur close the menu. Expanded state stays on each trigger. Long scene labels truncate
inside the shared menu; scrolling keeps the scene list within the viewport.

Removed controls and their paths: `#settings-btn` → app / Settings (Ctrl+,); `#library-btn` → app / Library;
`#panels-btn` → app / Panels; `#help-btn` → app / Keyboard shortcuts (?); old standalone project button presentation
→ `#root-btn` breadcrumb or app / Switch project… (Ctrl+Shift+O); `#scene-select` → scene menu;
`#scene-new` → scene / New scene…; `#brief-btn` → scene / Edit brief…; `#reload-btn` → scene / Reload from disk or
the disk chip; standalone `#t3-btn` → Claude / T3 panel; separate Claude action → Claude / Claude in terminal;
`#versions-btn` → side-panel or Code Versions tab. Quick render moved from the secondary segment to Render / Quick
render (Shift+click Render preserved). The supplied registry has no dedicated bindings for Library, Panels, scene
selection/new/brief/reload, Claude start, T3 or Versions; none were invented. Ctrl+` still opens/focuses Terminal.

Responsive changes use the named `studio-chrome` inline-size container on `#app` and the guide frames:

| Width | Collapse |
| --- | --- |
| >1600 px | Full chip labels and history labels; project/scene max-width `--toolbar-project-max-w` = 160 px each. |
| ≤1600 px | Chips icon-only (retained title and accessible label), still 23 px high with 12 px labels elsewhere. |
| any width | Project and scene names shrink by flex (ellipsis) only when the left track runs out of room; cap `--toolbar-project-max-w`. |
| ≤1360 px | Undo/redo labels hidden, icons and accessible titles retained. |

No toolbar element wraps. Playback’s viewer-container rules hide Master at ≤1000 px, speed at ≤720 px and reduce
transport gap/padding there to accommodate A/B; existing ≤520 px loop/frame hiding stays. Keyboard access remains.

Pixel-grid roles are in `theme/scale.css`; density owns the 23 px top-bar / 32 px transport control heights. See §6’s
40/43/41 px container parity table. Toolbar chips use 23 px (12 px label); toolbar count boxes use
`--toolbar-count-h` = 17 px, matching the 21 px inner button. Settings uses `--settings-leading` = 20 px,
`--settings-detail-leading` = 16 px, `--settings-search-h` = 34 px and `--settings-search-key-h` = 18 px (11 px mono
hint). Text stacks have even heights; search controls and header controls share even inner containers. Timeline label
shy buttons use 17 px against their bordered odd-height row; normal dock-header ⋯ uses 17 px in a 19 px inner
header, compact headers use 16 px in 18 px. The grid diagnostic checks the requested topbar/transport/Settings scope;
inspect shy/⋯ in Chrome alongside it.

The guide’s Top bar section clones the production header and prefixes specimen ids (no duplicate production ids).
Seven states at both 1280 and 1680 px: no project, normal, all three chips, Claude waiting badge, Queue, app menu
open and scene menu open. Menus share their item descriptions with production; hints are read from the registry
source without bootstrapping the app. The fixed-width frames scroll on smaller guide windows and use the same
container queries as the app.

Validation for this round is source/unit/build only. Chrome E2E, integer-box checks and real-element ink
re-measurement are pending orchestrator execution; no centring measurements are claimed by this implementation.
