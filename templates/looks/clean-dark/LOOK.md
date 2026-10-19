---
name: Clean dark
description: Calm, technical dark look on a faint grid; one warm accent; precise, unhurried motion.
tags: [dark, minimal, technical, explainer]
---

# Clean dark

## Motion
- Entrances `outExpo` 500-700 ms, moves `inOutCubic`; springs only for one hero element.
- Beats 2-3 s, one idea each (the 6 s test card in `sample/` compresses them to ~1.5 s); stagger siblings 50-70 ms;
  overlap the next beat before the last settles, but let outgoing text clear before new text arrives (no two
  headlines on screen at once).
- Transitions: cross-fades (350-400 ms `inOutCubic`) and short slides (40-80 px) in one direction of travel (enter
  from below / right, leave left); no zooms or whip-pans.
- Background grid drifts slowly (~12 px/s diagonal); held frames never go fully static.
- Composition: centred, generous space; one group of content per frame.

## Typography
- Inter for text, IBM Plex Mono for numbers, code and labels.
- 2 sizes per frame (headline + body), sentence case, normal tracking.

## Colour & style
- `bg` near-black with `grid` lines; text `text`/`muted`; `accent` (warm orange) only on the focal item.
- Thin strokes (1.5-2 px), radius 8, flat surfaces (`surface` + `border`), no gradients or glows.

## Sound
Soft and sparse: airy whooshes for moves, quiet pops/ticks for UI, one chime on the result. No booms. About one cue
per second at most; leave beats without sound. The palette uses Kenney samples for ui / tick / result (each with a
synth `alt`), synth for the moves (the Kenney packs have no soft airy whoosh).

## Do / Don't
- Do: let lines draw on; align to the grid; leave space.
- Don't: shake, flash, neon glow, more than one accent colour.

## References
None (prompt-only starter look, judgement throughout; nothing measured). Add images to `refs/` with a note here.
