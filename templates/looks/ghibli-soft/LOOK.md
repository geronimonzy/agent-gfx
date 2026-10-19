---
name: Ghibli soft
description: Warm pastel sky and meadow, painterly gradients, things that drift and settle; slow, gentle, kind.
tags: [light, warm, pastel, painterly, calm, storybook]
---

# Ghibli soft

Prompt-only look (no references, nothing measured): every rule below is judgement from the brief "warm pastels,
painterly gradients, gentle easing, drifting elements, 2.5-3.5 s beats".

## Motion
- Easing family: sine and cubic only. Entrances `outCubic` 1100-1500 ms, moves and drifts `inOutSine` 1400-3000 ms;
  `outBack(1.15)` at most once per scene (a card or the wordmark settling), never on text.
- Beats 2.5-3.5 s, one idea each (from the brief). In short pieces (the 6 s sample) beats overlap: the next one rises
  while the last is still settling, so nothing ever cuts.
- Entrances rise softly: `translateY` 30-60 px (2.8-5.5 % of the height) + opacity + a blur from 10 px to 0. No slides
  from off-frame, no scale pops above 1.04.
- Stagger 150-350 ms between siblings (slower than usual: the eye should follow each one).
- Transitions: cross-dissolves with a drift (outgoing floats up 20-40 px and fades over 800-1000 ms); a cloud passing
  across the frame can carry a change. No hard cuts, wipes, whips or zooms.
- Always something drifting: clouds slide 30-80 px per 6 s, petals/leaves fall diagonally with a sine sway
  (period 2-4 s, seeded), hills parallax by 10-30 px. Held frames never go static; nothing moves fast.
- Settled elements keep a gentle bob (2-4 px, period ~3 s) instead of freezing.
- Camera: a slow upward tilt or push (≤ 3 % over a scene) at most.

## Typography
- Nunito only: 800 for headlines, 600 for labels and card titles, 400 for body. Sentence case, slightly open
  tracking (0 to 0.01 em; never tight negative tracking).
- 2 sizes per frame: headline ~9-11 % of the height, labels ~3.5-4.5 %.
- Text is warm brown `text`, never black or pure white; a soft shadow `0 0.4vh 1.5vh` of `shadow` at 15-20 % on text
  that sits on the sky.
- Wish: a hand-lettered or softer storybook serif for the wordmark; closest bundled: Nunito 800.

## Colour & style
- Light, warm, low contrast: cream `bg`, sky `skyTop` → `skyMid` → `skyLow` vertical gradient, `sun` glow, misty
  `hillFar` / `hillMid` / `hillNear` layers, `cloud` puffs.
- Painterly: layered radial gradients with soft edges (blur 20-60 px), slightly offset, never a flat fill over a big
  area; a faint paper grain over everything (feTurbulence, ≤ 6 % opacity, static).
- Shapes are round: radius 28 (cards), circles, blob clouds made of overlapping circles, hills as wide sine curves.
- `accent` (terracotta) is the one loud colour: the focal number or word only; `accentSoft` for its glow.
- Cards: `surface` cream paper, 1.5 px `border`, a long soft warm shadow (`shadow` at 12-18 %), no hard outlines.

## Sound
Airy and organic, never loud: soft breathy wind under drifts and transitions, light wooden taps for things that land,
soft glass / bell chimes for the result and the end card. No booms, punches, risers or digital beeps. Sparse: about
one cue per 1-1.5 s. Wind = the synth `wind` breeze bed, long (1.5-4 s) and quiet.

## Do / Don't
- Do: let things drift in and settle; leave sky; keep the horizon low (bottom third); keep one warm accent.
- Do: overlap beats so the piece breathes as one continuous move.
- Don't: hard cuts, flashes, shake, glitch, neon, saturated primaries, dark backgrounds, black text, sharp corners,
  fast moves (< 600 ms), elastic bounces.
- Don't copy any studio's characters or artwork: the feel is the light, palette and pace, not the IP.

## References
None (prompt-only look). Add images to `refs/` with a note here, then re-run `gfx look analyze`.
