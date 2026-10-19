# reel — starter   1080x1920 @60   4.0s   style: dark-grid

**Goal:** (what should the viewer feel / learn / do? one sentence)
**Kind:** `anime` (DOM + anime.js timeline seeked by `render(t)`).
Safe zones for 9:16: keep text out of the top 12% (y < 230) and bottom 20% (y > 1536).

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.0–0.9 | headline words | pop up, 140 ms stagger, outExpo | `Make it move.` |
| 2 | 0.9–1.3 | accent rule | scaleX 0→1 from the left | — |
| 3 | 1.3–1.9 | card | scale 0.85→1, outBack | — |
| 4 | 1.9–4.0 | caption, hold | fade + rise | `your first gfx scene` |

## Sound
pop per word (rising pitch), whoosh on the rule, soft impact (thud) on the card, tick on the caption.
