# agent-gfx showcase   1920x1080 @60   38.0s   style: studio

**Goal:** show what working in agent-gfx feels like: Claude builds a scene from a prompt, you grab its elements as
layers, review it together with drawings, shape its sound, and every step is a version you can compare and undo.
**Message:** "Motion graphics, directed with your coding agent."
**Kind:** `anime` (DOM mock of gfx studio + anime.js timeline; cursor, camera, typing, counters derived from t).
**Layout:** chapter caption band on top (eyebrow + headline, no subtitle; 108 px margins), chapter index top right; below it a
1600x790 "screen" drawn at 1.07 (1712x845 at 108,181; review tweak baked in) holding a mocked studio window (top bar, inspector, viewer with a little "Tally" scene, right panel
tabs, bottom dock with Timeline / Terminal). A camera inside the screen pushes into the panel each chapter is about;
panels that are not in focus dim.
Copy, chapter times and the camera/cursor keys live in constants at the top of `scene.js` (`CH`, `CAPTIONS`, `CAM`).

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.0-2.9 | mark draws on, statement in 2 lines | ease curve draws (inOutCubic), lines rise from masks, outExpo | `agent-gfx` / `Motion graphics,` / `directed with your coding agent.` |
| 2 | 2.6-3.5 | intro lifts away; studio screen rises in | inCubic out; screen 120 px up + scale .96→1, outExpo | - |
| 3 | 3.0-8.0 | **01 Prompt**: prompt typed in the Terminal dock, Claude's steps tick in; the Tally scene assembles in the viewer as scene.js is written; inspector counts 15 cues | typing derived from t; lines stagger 350-450 ms; scene parts fade/rise | `Describe it. Claude writes the scene.` |
| 4 | 8.0-14.0 | **02 Objects & layers**: Layers tab lists the scene's elements; cursor clicks the total → selection box + layer row + inspector; drags the corner, Scale 1.00→1.22, `tweaked`; Open code → the element's `@gfx total` block | cursor inOutCubic waypoints; drag inOutCubic; code card outExpo | `Every element is a layer you can grab.` |
| 5 | 14.0-20.5 | **03 Review together**: camera pushes to viewer + comments + terminal; `C`, click → pin 1, pink markup drawn around the total, comment typed, Ask Claude; terminal shows `gfx context` brief, the fix, `--resolve`; total re-lands; comment turns resolved with Claude's reply | camera 1.14 bottom-right; markup stroke draws with the cursor; reply slides in | `Draw on the frame. Claude fixes it.` |
| 6 | 20.5-26.0 | **04 Sound**: camera to inspector + timeline; playhead sweeps cues in 4 stems (they flash as it passes; the total bounces on the ding); click `total-ding` → cue inspector; Reverb dragged 0.30→0.62, tail grows; Motion stem muted | camera 1.25 bottom-left; playhead linear; slider drag inOutCubic | `Sound cues live next to the motion.` |
| 7 | 26.0-31.5 | **05 Versions**: Versions tab; note typed, Save version → new row on top + changed files; Compare visually → wipe between first cut and now | camera 1.14 top-right; rows push down; wipe inOutCubic | `Every change is a version.` |
| 8 | 31.5-34.6 | **06 Render**: camera back out; Render → queue: mp4 frames 0→2280, then the sound mix; done chime | progress bars inOutCubic, frame counter derived | `Same frames, every render.` |
| 9 | 34.3-35.0 | screen and captions leave | scale .92, fade, inCubic | - |
| 10 | 34.8-38.0 | end card: mark, wordmark, tagline, `Open source · MIT · engine + gfx studio`, pill `This video was made in agent-gfx, too`; hold ≥ 2.4 s with slow push-in | mark draws, letters rise, footnote + pill fade up | `agent-gfx` / `Motion graphics, directed with your coding agent.` |

The Tally scene inside the viewer idles on its own (grid drift, glow orbit, a highlight stepping through the receipt
rows, three split avatars bobbing with a ring passing between them), driven by the viewer's playhead, so picture,
timecode and timeline bar stay in sync: it plays 0 -> 7.36 from 7.1 s (reaching the ding as the comment tool opens),
pauses for the review, replays 5.8 -> 8.0 in the sound chapter, jumps to the cue, then plays (looping) from 26 s.
The transport shows pause while playing.

Thumbnail: t = 16.4 (markup + comment popover). Last frame = end card.

## Sound (cues in scene.js; mix with `gfx audio showcase` or render with audio from gfx studio)
logo hit + air whoosh on the intro; swipe whoosh when the screen lands; soft type ticks while the prompt is typed and a tick
per Claude step; a click per cursor click; pop for the comment pin; ding when the total lands (ch3) and when the playhead
crosses `total-ding` (ch4); chime on resolve and on render done; air whoosh at each chapter change; rise + logo hit into the
end card; pop for the made-in pill.
