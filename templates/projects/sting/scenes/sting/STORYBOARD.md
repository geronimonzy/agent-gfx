# sting — logo sting   1920x1080 @60   4.0s   style: ink

**Goal:** (the brand in one confident beat: a ring closes, the mark lands, the name and tagline settle)
**Kind:** `svg` (inline SVG; `render(t)` sets attributes from `t` with `/runner/lib/tween.js` + `ease.js`).
Copy and timings are constants at the top of scene.js (`BRAND`, `TAGLINE`, `T`). The burst is seeded (`SEED`).

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.10–0.95 | ring (+ thin inner arc), glow | ring draws on with a teal head dot, inOutCubic; glow swells | — |
| 2 | 0.95 | hit: burst, mark | rays + particles radiate (outExpo), shock ring, logo pulse 1→1.07→1; mark scales in with overshoot (outBack) and unspins | — |
| 3 | 1.25–1.95 | logo slides left, wordmark | lockup slides (inOutCubic); letters rise from the baseline, 60 ms stagger, revealed from behind the ring | `Lumen` |
| 4 | 2.00–2.50 | tagline | fade + slide from the left, outExpo | `IDEAS IN MOTION` |
| 5 | 2.50–4.00 | end card, hold | ring keeps turning slowly | — |

## Sound
rise ending at the hit (`rise`), logo hit on the ring closing (`logo-hit`), soft air whoosh peaking mid-slide (`slide`),
quiet pentatonic pops per letter (`letter-1` … `letter-5`), a tick when the tagline lands (`tagline`).
