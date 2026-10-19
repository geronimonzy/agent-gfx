# Look sample: the test card

Every look's `sample/` scene follows this one brief, so looks can be compared side by side (docs/LOOK-PIPELINE.md §2).
The content is fixed; the **motion style is the look's**: pacing, easing, transitions, shapes, texture and type come
from its LOOK.md and preset. Build it like any scene (motion-graphics skill), in `<Library>/looks/<id>/sample/`.

## Format
- 16:9, 1920×1080, 30 fps, 6 s. `scene.json`: `"style": "look-<id>"`, `"title": "<Look name> sample"`.
- Kind `anime` unless the look calls for another (a canvas look for particles / grain, three for a 3D look).
- No sound: no `ctx.cue` calls and no `sound.json`. The preview is silent.
- Pure `render(t)` (no Date, rAF, unseeded random or CSS transitions); name the main elements with `data-gfx`.
- Only bundled fonts (`style/fonts`, via the preset's `fontFiles`); no images or files from outside `sample/`.

## Beats (times are a guide: follow the look's pacing)
1. **Headline** (0 – ~1.5 s): one line, `Make it move` (or the look's tone of it, ≤ 4 words), entering in the look's
   entrance style.
2. **Three items** (~1.3 – 3.2 s): a list or three cards, `Plan` · `Build` · `Review`, revealed one after another
   (the look's stagger and transition).
3. **Accent moment** (~3.2 – 4.4 s): one number or highlight in the accent colour, e.g. a counter to `24` with the
   label `frames per idea`, or a highlight sweeping one word. The one place the look gets loud (if it ever does).
   **It must be settled and fully visible at 4.2 s**: the thumbnail is taken at 70 % = 4.2 s, so the number has
   landed by ~4.0 s and the transition to the end card starts no earlier than ~4.3 s (a thumb caught mid-transition
   misrepresents the look on its Library card).
4. **End card** (~4.4 – 6 s): a wordmark `gfx` with a short tagline `motion, reviewed`, settled and readable from
   ~5.2 s (the clip loops: the last frame may hold).

**Slow looks** (beats of 2.5 s and more): 6 s can't hold four beats at that pace. Overlap the beats (the next one
starts while the last one is still settling) instead of rushing each one; the sample shows the style (easing, drift,
texture), not the beat length, and LOOK.md says what the real pacing is. Fast looks may cut more often than four
times, as long as the accent frame holds through 4.2 s.

## Check
- `gfx look preview <id> --sheet [--t 1.0,2.5,4.2]` → a contact sheet of the sample (+ full-size stills at those
  times) in `out/look-sheets/`: check every beat, overlaps, hairlines and type at full size; fix and repeat.
- `gfx look preview <id>` → `thumb.jpg` (at 4.2 s) + `preview.mp4`; look at the thumb (it is what the Library card
  shows). `gfx look check <id>` before you report.
- A still at each beat should read as this look and no other: if two looks' samples look alike, push the differences
  (pacing, easing, shapes, type), not the content.
