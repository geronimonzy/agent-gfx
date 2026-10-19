# explainer — explainer with captions   1920x1080 @60   10.0s   style: paper

**Goal:** (what should the viewer understand after 10 seconds? one sentence)
**Kind:** `anime` (DOM + anime.js timeline seeked by `render(t)`; captions are derived from `t` in `render`).
Copy and timings are constants at the top of scene.js: `KICKER`, `TITLE`, `STEPS` (label, text, icon), `CAPTIONS`
(`{ from, to, text }`, seconds), `T` (title, step landings, done).

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.2–1.2 | kicker + title, caption bar | rise + fade, outExpo; bar fades up | `How it works` / `Three steps to a finished video` |
| 2 | 1.4–3.4 | step 1 card, highlight | card rises (scale .94→1), icon pops (outBack); highlight frame settles around it | `Upload` |
| 3 | 2.8–5.4 | link 1 draws, step 2 card | line + arrowhead draw on (inOutCubic), card lands at 3.4, highlight slides over | `Shape` |
| 4 | 4.8–7.4 | link 2 draws, step 3 card | same as beat 3, card lands at 5.4 | `Share` |
| 5 | 7.3–8.0 | done | highlight lets go (fade + grow), check badges pop on the three cards, 120 ms stagger | — |
| 6 | 8.0–10.0 | end card, hold | — | last caption |

Captions (bottom bar, one line each, fade 0.18 s at the edges): `Here’s how it works.` (0.4) · `First, drop your
files in.` (1.7) · `We sort and polish everything for you.` (3.7) · `Then share the result with one click.` (5.7) ·
`Three steps. Ready in minutes.` (7.4, holds).

## Sound
pop on the title, pentatonic pops as each step card lands (`step-1` … `step-3`), soft air whoosh per link
(`link-1`, `link-2`), a quiet tick per caption change (`caption-2` … `caption-5`), pops on the first two check badges
(`done-1`, `done-2`) and a chime on the last (`done`).
