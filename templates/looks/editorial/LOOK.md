---
name: Editorial
description: A printed magazine page in motion: warm paper, serif headlines, thin rules and columns, slow masked reveals.
tags: [light, paper, serif, print, magazine, calm]
---

# Editorial

Prompt-only look (no references, nothing measured): every rule below is judgement from the brief "paper tones, serif
headlines, slow reveals and masks, rules and columns".

## Motion
- Easing family: quart. Reveals `outQuart` 900-1200 ms, moves and wipes `inOutQuart` 800-1100 ms. No springs, no
  overshoot, no bounce (the preset's `spring` is `outQuart` on purpose).
- Reveals are masks, not fades: a line of type slides up 100 % of its height out of an `overflow:hidden` line box;
  blocks open with a `clip-path: inset()` wipe led by a rule. Opacity alone only for small captions.
- Rules draw first, type follows: a hairline draws on (`scaleX` 0 → 1, `inOutQuart` 900 ms, from the left or from the
  centre), then the type it frames reveals 150-250 ms later.
- Stagger 120-200 ms per line or column, left to right, top to bottom (reading order).
- Beats ~1.5-2.5 s, one idea each (the 6 s sample compresses this to ~1.4 s). Transitions are page turns: the new
  page (`surface`) wipes across with `clip-path`, a 1.5 px rule on its leading edge and a soft `paperShade` band
  behind it, `inOutQuart` 900-1000 ms. No cross-dissolves of whole frames, no zooms, no whips, no 3D curl.
- Held frames: nothing drifts except at most a slow 1-2 % push on a hero numeral; stillness is part of the look.

## Typography
- Headlines and numerals: Fraunces 600 (700 for the wordmark), tight tracking (-0.02 em), sentence case, optical
  size large (≥ 9 % of the height for a headline, a hero numeral 30-45 %).
- Text, labels and folios: Inter. Labels and kickers: Inter 600, uppercase, tracked +0.16 em, 1.8-2.2 % of the height,
  `muted` or `accent`. Body: Inter 400, ~2.6-3 %.
- Hierarchy: kicker (small caps) → serif headline → body; at most 3 sizes per frame.
- Mono (IBM Plex Mono) only for folios / issue numbers if needed.
- Wish: Fraunces italic (and a soft-optical "wonk" axis) for pull quotes; not bundled, so no italics.

## Colour & style
- Light, warm, high but not harsh contrast: `bg` paper, `text` ink, `muted` for captions, `border` for secondary
  rules, `grid` for column guides (hairlines, barely visible).
- One accent, oxblood `accent`: a kicker, one numeral, one rule; never a fill behind text.
- Layout is a page: a 12-column grid with 96 px margins, a masthead rule (double: 3 px + 1 px) at the top, a folio
  line at the bottom, vertical column rules between items. Everything aligns to the columns.
- Square corners (radius 0), no shadows on type, no gradients except the soft page-turn shade; a faint paper grain
  (feTurbulence, ≤ 5 % opacity, static) over the frame.

## Sound
Paper and print, close-miked and quiet: page turns for transitions, soft paper slides for wipes, small dry ticks for
rules drawing and counters, a book set down for the one landing moment. No synth whooshes over 0.5 s, no booms, no
chimes except a single soft ding on the result. About one cue per beat plus ticks.

## Do / Don't
- Do: draw a rule, then reveal; align everything to the columns; leave generous margins; let a hero numeral be huge.
- Don't: drop shadows, rounded cards, gradients, glows, bouncy or elastic eases, more than one accent, centred body
  text (headlines may centre on an end card), italics faked with skew.

## References
None (prompt-only look). Add images to `refs/` with a note here, then re-run `gfx look analyze`.
