---
name: Fast paced
description: Kinetic, high-contrast black / white / acid yellow; hard cuts every 0.4-1 s, whip slides, huge uppercase Space Grotesk.
tags: [kinetic, bold, high-contrast, promo, social, hype]
---

# Fast paced

Made from a prompt only (no references, nothing measured): every rule below is judgement, tuned on the sample.

## Motion
- **Beats 0.6-1 s**, one word or one idea each (the sample: 0.4 s per word of the headline, 0.6 s per list item,
  1.2 s for the number, the end card holds 1.6 s). Never a beat over 1.2 s before the end card.
- **Hard cuts between beats**: the whole frame changes on one frame (no cross-fades, no dissolves). Alternate the
  frame fill (black / white / acid yellow) so every cut reads as a cut.
- **Entrances = whips**: `translateX` from 1.1 × frame width off one side to 0 with `skewX` -24° → 0, `outExpo`
  220-260 ms; the next beat whips from the opposite side. Speed streaks (3 thin bars) shoot across with the whip,
  260 ms, stagger 22 ms.
- **Slams** for lines and the wordmark: `scale` 1.35-1.9 → 1, `outExpo` 300 ms. Settle with a slow linear drift
  (2-3 % over the rest of the beat) so held frames are never dead.
- Secondary elements land 60-120 ms after the main word (labels, counters, the index strip); total spread ≤ 250 ms.
- Counters run fast (`outExpo` ~650 ms) and finish with a 1.12 → 1 punch.
- No exits: the cut is the exit. No camera moves, no springs except `outBack(1.6)` for a rare UI pop.

## Typography
- Space Grotesk 700, **uppercase**, tracking -0.05em, line-height 0.82, sized huge: a single word ~34 % of frame
  height, a full line ~20 %, a number up to ~78 %. Space Grotesk 500 for small text.
- IBM Plex Mono 500 uppercase, tracking +0.06em, for indexes (`01 / 03`), strips and taglines (~3-5 % of height).
- Two sizes per frame at most: the giant word and the small mono label. Left-aligned at the 6 % margin; the end card
  centres.

## Colour & style
- Three fills only: `bg` near-black, `surface` white (with `surfaceInk` text), `accent` acid yellow (with
  `accentInk` text). Text is always pure black or pure white: maximum contrast.
- Accent yellow is either a full frame (the loudest beat) or a hard bar / one highlighted word on black; never a
  tint, never a gradient.
- Flat, square: radius 0, no shadows, no glows, no grid. Graphic elements are hard bars and thin streaks.

## Sound
Punchy and tight, one hit per cut: a short punch on each hard cut, a tight zip whoosh peaking on each whip landing,
a riser ending on the loudest beat, clicks/ticks for counters, a punchy logo hit on the end card. Dense: about one cue
per beat (≈ 1.5-2.5 cues/s). Palette in `sounds.json` (Kenney samples with synth `alt` where the library has a fit).

## Do / Don't
- Do: cut on the beat; alternate fills; whip from alternating sides; keep words big and few.
- Do: let the one accent frame be the climax (the number, the payoff).
- Don't: cross-fade, ease in slowly, hold anything over 1.2 s before the end card, round corners, add gradients,
  shadows or a second accent colour, use sentence-case body text.

## References
None (prompt-only look).
