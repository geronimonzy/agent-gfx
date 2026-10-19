# Integer leading source audit (2026-10-17, round 2)

> 2026-10-19: Perform was removed; `perform.css` rows below are historical (`.chk` / `.chk small` moved to styles.css).

This is the source inventory for DESIGN.md §6. Browser measurements are pending.

`R(--token)` below means `round(nearest, calc(var(--token) * 1em), var(--leading-step))`, evaluated at the consumer font size.
The step defaults to 1px; selected centred text rows use 2px. Both round within ±1px of HEAD.
No larger line-box changes are intentional or accepted without a measured defect. Browser computed-style validation is pending.
`--leading` defaults to 1.35; tight/loose are 1.3/1.5. Purpose-specific ratios preserve the original values:
`--label-leading` 1.25, `--textarea-leading` 1.4, `--textarea-leading-prose` 1.45, `--empty-leading` 1.6, `--hint-leading` 1.7, `--code-leading` 1.55.

## Explicit leading replacements

| File | Selector | Old | New |
| --- | --- | --- | --- |
| `claude.css` | `.ask-brief` | `var(--text-2xs)/1.45 var(--font-mono)` | `var(--text-2xs)/R(--textarea-leading-prose) var(--font-mono)` |
| `claude.css` | `.ask-msg` | `var(--textarea-leading-prose)` | `R(--leading); --leading = --textarea-leading-prose` |
| `claude.css` | `.st-hint` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `code.css` | `.vs-card` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `comments.css` | `#np-reply` | `1.4` | `R(--leading); --leading = --textarea-leading` |
| `comments.css` | `.crow .t` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `layout.css` | `.gfx-tab` | `1` | `R(--control-leading)` |
| `layout.css` | `.gfx-tab-x` | `1` | `R(--control-leading)` |
| `layout.css` | `.gfx-more` | `500 var(--text-xs)/1 var(--font-sans)` | `500 var(--text-xs)/R(--control-leading) var(--font-sans)` |
| `layout.css` | `.gfx-panel > #code-refs:empty::before` | `1.6` | `R(--leading); --leading = --empty-leading` |
| `library.css` | `.lb-proj p` | `1.45` | `R(--leading); --leading = --textarea-leading-prose` |
| `library.css` | `.lb-empty p` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `library.css` | `.lb-card-body h3` | `var(--label-leading)` | `R(--leading); --leading = --label-leading` |
| `library.css` | `.lb-desc` | `1.45` | `R(--leading); --leading = --textarea-leading-prose` |
| `library.css` | `.lb-row b` | `var(--label-leading)` | `R(--leading); --leading = --label-leading` |
| `library.css` | `.lb-x` | `1` | `R(--control-leading)` |
| `newscene.css` | `.ns-l` | `var(--label-leading)` | `R(--leading); --leading = --label-leading` |
| `newscene.css` | `#ns-prompt` | `var(--textarea-leading-prose)` | `R(--leading); --leading = --textarea-leading-prose` |
| `newscene.css` | `.ns-chip small` | `1.3` | `R(--leading); --leading = --leading-tight` |
| `perform.css` | `.hint.small` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `perform.css` | `.pf-err` | `1.45` | `R(--leading); --leading = --textarea-leading-prose` |
| `perform.css` | `.vx-play` | `1` | `R(--control-leading)` |
| `render.css` | `.rq-error pre` | `var(--text-2xs)/1.35 var(--font-mono)` | `var(--text-2xs)/R(--leading) var(--font-mono)` |
| `settings.css` | `.sp-ctl input.mono` | `var(--control-leading)` (11px) | `R(--control-leading)` (12px, font +1px); native field geometry retained |
| `styleguide.css` | `.sg-swatch figcaption` | `var(--text-2xs)/1.4 var(--font-mono)` | `var(--text-2xs)/R(--textarea-leading) var(--font-mono)` |
| `styleguide.css` | `.sg-readout output, .sg-readout li` | `var(--text-xs)/1.5 var(--font-mono)` | `var(--text-xs)/R(--leading-loose) var(--font-mono)` |
| `styles.css` | `html, body` | `var(--region-text)/1.35 var(--font-sans)` | `var(--region-text)/R(--leading) var(--font-sans)` |
| `styles.css` | `.field label` | `var(--label-leading)` | `R(--leading); --leading = --label-leading` |
| `styles.css` | `.hint` | `1.7` | `R(--leading); --leading = --hint-leading` |
| `styles.css` | `.empty-list` | `1.6` | `R(--leading); --leading = --empty-leading` |
| `styles.css` | `#note-pop textarea` | `var(--textarea-leading)` | `R(--leading); --leading = --textarea-leading` |
| `t3.css` | `.t3-msg` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `t3.css` | `.ask-t3-err` | `1.45` | `R(--leading); --leading = --textarea-leading-prose` |
| `theme/components.css` | `:is(textarea, textarea.input)` | `var(--textarea-leading)` | `R(--textarea-leading)` |
| `welcome.css` | `.wl-act` | `1.35` | `R(--leading)` |
| `welcome.css` | `.wl-sub` | `1.5` | `R(--leading); --leading = --leading-loose` |
| `welcome.css` | `.wl-tglyph` | `1` | `R(--control-leading)` |
| `welcome.css` | `.wl-tpl small` | `1.4` | `R(--leading); --leading = --textarea-leading` |
| `cm.js` | `.cm-scroller` | `1.55` | `R(--code-leading)` |

No literal `line-height: 1` icon exceptions remain; the previous ones now use rounded `--control-leading`.
The removed guide-only last rule used `round(nearest, 1.35em, 1px)`; the shared low-specificity rule now covers it.

## Shorthands that previously reset leading to normal

Every row changes the omitted slash (implicit `normal`) to a font-specific ratio, preserving family, size and weight.
`--leading-normal` = 1.26 (Inter: 101% ascent + 25% descent); `--leading-normal-mono` = 1.30
(bundled Plex hhea: ascent 1025, descent 275, unitsPerEm 1000, zero line gap).
The shorthand's rule also sets inherited `--leading` to that ratio so descendants retain normal-like leading.
CodeMirror's inline theme uses `--leading-normal` directly. Shared calibrated control leading still wins on `kbd`;
Plex Label (107% + 30.1%) and Field (99.9% + 30.1%) retain their separate control metrics.

| File | Selector | Old font | New font |
| --- | --- | --- | --- |
| `claude.css` | `.ask-src` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `claude.css` | `.st-hint code` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.co-key` | `600 var(--text-xs) var(--font-mono)` | `600 var(--text-xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `#cs-path` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `#cs-pos` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.cr-key` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.cref code` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.cf` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.ctm` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.codebox span` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.vs-br` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.vs-dirty` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.vs-fp` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.vs-n b` | `500 var(--text-3xs) var(--font-mono)` | `500 var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.st` | `600 var(--text-3xs) var(--font-mono)` | `600 var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `code.css` | `.df-sub` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `comments.css` | `.db-smooth output` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `comments.css` | `.att .ak` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `comments.css` | `#live-err .le-loc` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `comments.css` | `#live-err .le-msg` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `comments.css` | `.selbox .sb-label` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `layers.css` | `.lrow .nm` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `layers.css` | `.layer-head` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `library.css` | `#library-page .lb-dir` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `newscene.css` | `.ns-sub` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `newscene.css` | `.ns-rname` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `newscene.css` | `.ns-foot code` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `paths.css` | `#paths-bar` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `paths.css` | `.ei-code .ei-n` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `paths.css` | `.group-head` | `600 var(--text-3xs) var(--font-sans)` | `600 var(--text-3xs)/R(--leading-normal) var(--font-sans)` |
| `paths.css` | `.curve-head` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-scroll .sec-h b` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.chk small, .lat small` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-src .cnt` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-take b` | `600 var(--text-2xs) var(--font-mono)` | `600 var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-take span` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-sl b` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-ev .i` | `600 var(--text-3xs) var(--font-mono)` | `600 var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-ev .l1 b` | `600 var(--text-2xs) var(--font-mono)` | `600 var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-ev small` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.dim.lt` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `#countin` | `700 var(--text-hero) var(--font-mono)` | `700 var(--text-hero)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.vx-main b` | `600 var(--text-sm) var(--font-mono)` | `600 var(--text-sm)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.vx-main small` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.vx-alt small` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.vx-alt .sc` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `perform.css` | `.pf-scroll .pf-fold b` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rd-info` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rd-key` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rq-stat` | `600 var(--text-3xs) var(--font-sans)` | `600 var(--text-3xs)/R(--leading-normal) var(--font-sans)` |
| `render.css` | `.rq-out` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rq-sub, .rq-note` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rr-main b` | `600 var(--text-xs) var(--font-mono)` | `600 var(--text-xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rr-main small` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.cr-lab` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `render.css` | `.rq-warn` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `settings.css` | `.sp-chain b` | `500 var(--text-2xs) var(--font-mono)` | `500 var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.insp-head .id` | `600 var(--text-sm) var(--font-mono)` | `600 var(--text-sm)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.field .was` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.field .sub` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.row .tx small` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.head-corner` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.head-label b` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.lh-row.sub` | `var(--text-3xs) var(--font-mono)` | `var(--text-3xs)/R(--leading-normal-mono) var(--font-mono)` |
| `styles.css` | `.setup-label` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `t3.css` | `.t3-path` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `t3.css` | `.t3-meta` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `welcome.css` | `.wl-brand small` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `welcome.css` | `.wl-sub code, .wl-final code` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `welcome.css` | `.wl-pmain small, .wl-pmeta small` | `var(--text-2xs) var(--font-mono)` | `var(--text-2xs)/R(--leading-normal-mono) var(--font-mono)` |
| `welcome.css` | `.wl-fname` | `var(--text-xs) var(--font-mono)` | `var(--text-xs)/R(--leading-normal-mono) var(--font-mono)` |
| `cm.js` | `.cm-objfold` | `var(--text-2xs) var(--font-sans)` | `var(--text-2xs)/R(--leading-normal) var(--font-sans)` |

## Settings audit

All ten `PAGES` and all `ROWS`/`controlHtml`/`customHtml` paths were inspected in settings.js. Geometry findings:

| Check | Result |
| --- | --- |
| General | Restored HEAD pair sizing: input is 240px, Browse is beside it, gap is 6px. Only unfocused ellipsis is added; direction and focus stay unchanged. Custom-editor select/text widths remain. |
| Appearance | Pair sizing is restored to HEAD. Existing UI-scale select and toggle dimensions remain. The narrow container alignment rule keeps its precedence fix. |
| Rendering | Common heading inset and text/select alignment; scope bar remains flex-centred (20px label, 32px select, even difference). Existing render field widths remain. |
| Audio | Existing microphone select uses the common width; no page-specific correction needed. (Page removed with Perform, 2026-10-19.) |
| Code & versions | Common heading inset; existing toggles/description centring and scope bar retained. |
| Claude & terminal | Common heading inset; First take/custom field widths retained. Mono fields keep their original leading ratio and +1px font step (11→12px). Scope bar retained. |
| T3 | Connection status and list share the stack width; outer stack/buttons use 8px gaps, access list 4px gaps with 24px single-line items. Connected/wrapped states still need browser measurement. |
| Engine & tools | Retained the prior definite 340px path cap. Stack gaps now 8px; status/path/button right alignment retained. Progress keeps its separate 220px role. |
| Shortcuts | Settings retains HEAD 20px help rows, 18px keycaps and 30px search leading. Standalone help restores 16px row leading (HEAD 16.2), inline key groups and auto separators; 18px keycaps have 16px inner leading. Ink/geometry pending. |
| About | Heading inset corrected. Existing 32px credit rows, 20px text leading and 24px action buttons have even parity; left unchanged. Licence viewer uses shared origin rounding. |
| Headings vs titles | Heading and scope inset = 16px padding + card hairline, correcting the source 1px mismatch. |
| Multi-line descriptions | Kept align-items:center: title 20px + gap 4px + n×16px is always even against 32px controls, including n=3–5. |
| New scene Look | Replaced percentage min() max-width with a definite token cap plus min-width:0. Other min(100%,…) uses are style-guide width/grid minimums in definite-width tracks, not auto-track max-width constraints; left unchanged. |

## Positioning and round-2 changes

`pixel-grid.js` and its imports in layout.js/theme.js are removed; those two files and ink-int.mjs are back to HEAD.
There is no descendant JS snapper, DOM/resize observer or capture scroll listener for alignment.
`surface-origin.js` exports one small function, `roundSurfaceOrigin(surface?)`, restricted to outer `.modal` boxes
inside `.modal-back`, `#note-pop`, `#toast` and `#live-err`. It clears its own translate, reads the outer box and applies
nearest-pixel x/y correction to that whole surface. Existing transforms stay intact. Call sites:

| File | Call site |
| --- | --- |
| keys-help.js | openHelp, after unhiding |
| ask.js | openAsk, after unhiding; refresh, after the asynchronous brief completes |
| diff.js | showDiff, after unhiding |
| about.js | showLicence, after unhiding and after loading licence text |
| newscene.js | openWindow, after appending the dialog |
| notes.js | position, after anchoring the comment popover (also used by its existing layout handler) |
| main.js | toast, after setting text and unhiding |
| live.js | renderError and layout, after opening/placing the Live error surface |
| surface-origin.js | window resize, visible outer surfaces only |

Menus still round x/y in menu.js. Scrolling reads no alignment geometry. CSS handles descendants:

- `--leading-step` defaults to 1px; selected centred rows use 2px (nearest even). The maximum difference from the
  original ratio is 1px, with no new font or height literals outside scale.css.
- Library editor viewport heights round to whole pixels; palette tables use separate borders with zero spacing,
  keeping the bottom hairline on each row instead of splitting it into half-pixel collapsed borders.
- Modal headers, welcome project text/folder/status rows, Library toolbar/list/reference/detail rows, Render
  rows/queue heads and New scene inline rows share even text/control parity.
- Small actions in mixed-height Library/Render rows have a 1px end margin, preserving the 27px border box.
- Welcome brand version uses a 6px inset instead of a fractional baseline origin; Ask brief header uses even
  text lines and a whole-pixel action margin box.
- Welcome status min-height includes its bottom-row top hairline (36→37px), leaving an even inner box.
- Timecode descendants explicitly retain the control ratio: main line 16px, secondary lines 12px, matching HEAD.
- Welcome action b/small recompute the prose ratio at their own sizes: 18.9→19px and 14.85→15px.
- Standalone help uses 16px row leading; its 18px inline keycaps align at the line top. Separators keep auto sizing.
  Settings keeps its existing 20px rows and 30px search-field leading.

## Greater-than-1px line-box exceptions

None intended. The round-1 help-row (16.2→20), welcome-caption (14.85→19), timecode (16→22 / 12→16),
Settings mono-input (11→30) and standalone-help search (12→30) expansions are removed. Original Settings help
20px rows and search leading 30px are preserved. The mono path font/leading step is exactly +1px (11→12).
All other ratios round within 0.5px (1px grid) or 1px (2px grid); implicit-normal ratios now follow the font metrics.
This is a source audit, not a claim of a completed Chrome computed-style diff.

## Measurement still required

Run the computed-style diff against HEAD first on standalone help (`.kh-r`, separators and keycaps), welcome action
captions and playback timecodes, then verify the 240px Settings path input with Browse visible (focused/unfocused,
LTR/RTL). Check centred Library/Render/welcome rows and odd-height dialogs at both 1000px and 999px viewport heights.
The extended check still reports floating-surface origins and all fractional descendant controls. It additionally
reports fractional block/flex/grid text tops, with no dialog exemption. Ink probes need no opt-out.

Remaining unverified candidates (no Chrome/socket execution in this sandbox): inline Ask source/select layout
(`.ask-source label` / `.ask-src-sel`), Library palette rows after changing to separate borders (`.lb-pal td`),
and auto-height dialogs after later content changes. Welcome brand inset and Ask brief-header centring also need
ink confirmation. These are not hidden or individually translated;
the orchestrator should keep any reported fractions as remaining CSS defects. Non-100% UI/panel scaling is outside
the diagnostic contract. No claim that every descendant passes is made without the browser run.

Required gates: token gate 0, token test, all 11 unit groups, Vite build and diagnostic syntax check pass.
