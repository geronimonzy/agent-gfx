---
name: Playful
description: Bright blue stage, candy-coloured chunky rounded shapes, Fredoka; everything bounces, squashes and stretches.
tags: [playful, bright, bouncy, kids, friendly, social, product]
---

# Playful

Made from a prompt only (no references, nothing measured): every rule below is judgement, tuned on the sample.

## Motion
- **Beats 1.2-1.8 s** with continuous motion between them (no hard cuts): one group leaves by shrinking while the next
  bounces in. Spread of a group's entrances ≤ 0.6 s.
- **Squash and stretch on every landing** (`transform-origin` at the bottom): falling objects stretch (`scaleY` 1.3 /
  `scaleX` 0.8), squash on contact for ~50 ms (`scaleY` 0.68 / `scaleX` 1.3), rebound once (`translateY` up ~12 % of
  the fall, 150 ms `outQuad` / 150 ms `inQuad`) and settle with `outElastic(1, .5)` ~360 ms. Letters drop one by one,
  stagger 55-70 ms.
- **Jelly pops** for cards, pills and labels: `scaleX` / `scaleY` keyframes in opposite phase (0 → 1.18 / 0.86 →
  0.9 / 1.14 → 1.04 / 0.97 → 1, ~760 ms) plus a rotate overshoot (`outElastic(1, .45)`) to a slight resting tilt
  (±2-4°). Stagger 270 ms between siblings.
- Moves: `outBack(1.7-1.8)` 500-700 ms (the preset `ease.out` is `outBack(1.8)`). Exits: `scale` → 0 with `inBack(2)`
  220-280 ms (a tiny anticipation grow before it pops away), last-in first-out.
- Reward moments get a wobble (`rotate` 0 → -6° → 0 with `outElastic(1, .4)`) or a confetti burst of 4-6 dots.
- Background shapes always bob (sine, 10-22 px, periods 2-3 s), so nothing is ever still. No linear moves, no
  hard cuts, no whips.

## Typography
- Fredoka only: 700 for headlines and the wordmark (~18-26 % of frame height), 600 for labels and taglines (6-7 %).
  Sentence case, normal tracking. IBM Plex Mono is in the preset only as the `mono` fallback; don't use it on screen.
- Type on the blue stage is white with a hard offset shadow (`0 1.2 % 0 shadow`); type on cards / pills is `ink`.
  One highlighted word in `sun` yellow per line at most.

## Colour & style
- `bg` bright blue; cards and pills `surface` white with a thick `border` ink outline (~0.7 % of height), radius
  ≥ 32 px (pills fully round) and a **hard offset shadow** in `shadow` (no blur).
- Candy set for shapes and icons: `sun`, `mint`, `tangerine`; `accent` bubblegum pink is the one loud colour (the
  number ball, the dot of the wordmark). This look deliberately uses several fills (a rule exception: playful needs a
  candy set), but only one is the accent.
- Shapes: circles, rounded squares, pills, rings. No sharp corners, no thin lines, no gradients, no blur shadows.
- Background: `bg` with large low-contrast rings / dots / pills in `gridStrong` that bob.

## Sound
Bubbly and light: a pop for everything that appears (cascading up in pitch on staggers), plucks for letters, a rising
boing-like jump on bounces, a soft round thud when a big shape lands, airy soft whooshes for groups leaving, a bright
ding on the payoff, a thud logo hit on the end card. Medium-dense: a cue per entrance (≈ 2-3 cues/s on staggers).
Palette in `sounds.json` (Kenney samples with synth `alt`). Wished for: a real spring "boing" sample (Kenney has none;
the palette uses a rising phase-jump, alt = a pitched zip whoosh).

## Do / Don't
- Do: let things fall, land, squash and settle; tilt resting cards a few degrees; reward the payoff with a wobble or
  confetti; keep the background bobbing.
- Don't: hard-cut, whip, move linearly, use thin strokes, sharp corners, blurred shadows, dark backgrounds or more than
  one loud accent.

## References
None (prompt-only look).
