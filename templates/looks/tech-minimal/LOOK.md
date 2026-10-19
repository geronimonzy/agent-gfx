---
name: Tech minimal
description: Instrument-panel precision on a cool measuring grid; mono type, linear moves, stepped counters, one electric-blue accent.
tags: [light, minimal, technical, data, mono, grid]
---

# Tech minimal

Prompt-only look (no references, nothing measured): every rule below is judgement from the brief "mono type, grids,
precise linear moves, data counters".

## Motion
- **Linear, not eased**: moves, wipes, rules and bar fills run at constant speed (`linear`), 200-400 ms; nothing eases
  in or out. Elements appear by a **one-frame snap** (`opacity [0, 1]`, `duration: 1`) or by being drawn / typed, never
  by fading.
- **Frame-locked rhythm**: every start time and stagger is a multiple of 100 ms (3 frames at 30 fps); stagger siblings
  300 ms (one per row, like a readout updating). Beats ~1-1.5 s, one idea each.
- **Counters** step in integers (`Math.floor`, zero-padded, tabular figures); text types on character by character
  (~55 ms per char) with a block caret that blinks at 2 Hz from `t`.
- **Transitions**: a vertical accent scan line crosses the frame left → right in 300 ms and cuts the old page behind it
  (clip-path wipe). No cross-fades, zooms, rotations, overshoot or springs (`ease.spring` in the preset is `steps(6)`
  on purpose).
- Camera: locked off. Moves are translations by whole grid cells (40 px; 160 px majors), direction up or left.
- Held frames stay alive with data, not drift: a running timecode, a progress hairline, a blinking caret.

## Typography
- IBM Plex Mono for headlines, numbers, labels and HUD text (600 for headlines and counters, 500 labels); Inter 400 /
  500 only for item names and short phrases.
- Labels: 22 px mono, uppercase, tracking +0.08em, `muted`; headlines tight (-0.03em). Numbers always tabular, padded
  (`03`, `024%`).
- Two text sizes per frame plus the HUD.

## Colour & style
- Light and cool: `bg` paper-white with a slate tint, a fine 40 px `grid` with 160 px `gridStrong` majors, near-black
  `text` / `stroke`, `muted` slate.
- One accent, electric blue `accent`, only on the data that matters (the counter, its ticks, the scan line, the end
  card's block cursor).
- Hairlines 1-2 px, square corners (`radius` 0), no shadows, gradients or glows. Registration crosses on the major grid
  intersections; content aligns to grid lines.

## Sound
Precise and dry: a tick per counter step or grid snap, short clicks when an item locks in, a high short beep for data
appearing, one confirmation tone when the number lands, a tight zip for the scan wipe. No booms, no reverb tails,
nothing soft.

## Do / Don't
- Do: snap to the grid; count, measure, label (index numbers, units, timecode); let one blue thing carry the frame.
- Don't: ease, bounce, blur, fade, round corners, use more than one accent, or decorate without data.

## References
None (prompt-only starter look). Add images to `refs/` with a note here.
