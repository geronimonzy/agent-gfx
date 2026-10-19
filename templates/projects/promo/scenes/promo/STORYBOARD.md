# promo — product promo   1920x1080 @60   8.0s   style: ink

**Goal:** (what should the viewer feel / learn / do? one sentence) — template copy: "Orbit puts your week in one place; start free."
**Kind:** `anime` (DOM + anime.js timeline seeked by `render(t)`).
Copy (texts, tasks, stat, CTA) and beat times live in constants at the top of `scene.js` (`PRODUCT`, `HEADLINE`, `TASKS`, `STAT`, `CTA`, `T`).
Margins: 128 px left/right (6.7%); the copy column sits left, the app window right.

## Beats
| # | time | on screen | motion | text |
|---|------|-----------|--------|------|
| 1 | 0.0–1.3 | eyebrow pill, headline (2 lines), glow | eyebrow fades up; lines rise out of a mask, 110 ms stagger, outExpo | `New · Orbit 2.0` / `Plan your week` / `in one place.` |
| 2 | 0.85–1.6 | subhead | fade + rise | `Tasks, calendar and notes, finally together.` |
| 3 | 1.0–2.1 | app window | rises 160 px, scale 0.94→1, then floats up slowly until the exit | `Orbit — Week 42`, `This week` |
| 4 | 1.5–2.4 | task rows, progress bar | rows slide in from the right, 70 ms stagger; bar fills to 12/18 | 5 tasks |
| 5 | 2.2–2.9 | feature chips | pop in, outBack, 90 ms stagger | `Smart scheduling` `Shared boards` `Focus mode` |
| 6 | 2.9 | row 2 checked off | teal check pops (outBack), title dims, bar + count go to 13/18 | `13 of 18 done` |
| 7 | 3.1–4.25 | stat card | rises over the window's corner; counter 0→38 (outCubic) | `+38%` `more tasks done every week` |
| 8 | 4.65–5.0 | shot 1 leaves | whole shot fades, scales to 0.96, lifts 40 px (inCubic) | — |
| 9 | 4.95–5.9 | logo, wordmark, tagline, CTA | logo scales in with its orbit ring drawing on; letters rise from a mask; tagline fades up; CTA pops | `Orbit` / `Your week, finally in one orbit.` / `Start free at orbit.app` |
| 10 | 5.9–8.0 | end card hold | slow push-in (0.985→1.02), satellite keeps drifting along the orbit | — |

Thumbnail: t = 4.4 s (the full product shot); end card from 6.0 s.

## Sound
tick on the eyebrow; air whoosh on the headline; swipe whoosh + soft thud as the window lands; quiet rising pops for the rows
(pentatonic) and brighter ones for the chips; a click on the check-off; zip whoosh for the stat card, count-up ticks and a
ding when 38% lands; a riser into the logo hit; one pop for the CTA. Ids: `eyebrow`, `headline`, `window-in`, `window`,
`row-1..5`, `check`, `chip-1..3`, `stat-in`, `stat-tick-1..8`, `stat-ding`, `rise`, `logo`, `cta`.
