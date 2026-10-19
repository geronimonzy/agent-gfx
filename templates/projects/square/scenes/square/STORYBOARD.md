# square — social square   1080x1080 @60   6.0s   style: ink

**Goal:** (what should the viewer feel / learn / do? one sentence) — template copy: "87% of teams ship faster with async reviews."
**Kind:** `anime` (DOM + inline SVG + anime.js timeline seeked by `render(t)`).
Copy (tag, value, delta, label, handle, source) and beat times live in constants at the top of `scene.js` (`TAG`, `VALUE`,
`DELTA`, `LABEL`, `HANDLE`, `SOURCE`, `T`). `VALUE` sets both the number and how far the ring fills.
Margins: 88 px (8%) on every side; the label is one line (keep it under ~40 characters at 44 px).

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.15–0.8 | tag pill | fades down into place | `Survey 2026` |
| 2 | 0.3–1.5 | dial ticks, ring track, glow | ticks fade in around the ring (6 ms stagger), ring scales 0.9→1, dial keeps a slow turn until the end | — |
| 3 | 0.5–2.25 | stat + progress ring | number fades/scales in; the arc draws 0→87% (svg.createDrawable, inOutCubic) while the counter counts up; the knob rides the arc's end | `87%` |
| 4 | 2.25–3.1 | ring ripple, stat bump | ripple ring expands and fades, number bumps 1→1.06→1 | — |
| 5 | 2.4–3.0 | delta pill | pops in under the number, outBack | `+12 pts vs 2025` |
| 6 | 2.6–3.5 | label | words rise in, 55 ms stagger | `of teams ship faster with async reviews` |
| 7 | 3.05–3.9 | footer rule, handle, source | rule draws left→right; handle slides in from the left, source from the right | `@orbit.app` · `Source: State of Work 2026` |
| 8 | 3.9–6.0 | hold | dial keeps drifting | — |

Thumbnail: t = 4.5 s (everything on screen).

## Sound
tick on the tag; air whoosh as the ring appears; count-up ticks while the ring fills (spaced by the counter's ease, slightly
rising), a ding with a soft thud under it when 87% lands; a pop on the delta pill; a quiet swipe whoosh on the label; one soft
pop on the handle. Ids: `tag`, `ring-in`, `count-1..12`, `stat-ding`, `stat-hit`, `delta`, `label`, `handle`.
