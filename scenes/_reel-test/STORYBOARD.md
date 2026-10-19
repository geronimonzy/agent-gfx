# _reel-test — vertical punchy cut   1080x1920 @60   15.0s   style: nightfall

**Goal:** the engine's main test fixture. A fictional receipt app "Tally" (scan → sort → analyze → split → go to
`tally.example`) for Reels/TikTok/Shorts: fast, bold, kinetic. Tests, review drafts, code links, retime and the render
byte-identity check depend on its element names, cues and timings: change content, not structure.
**Kind:** `anime` (DOM + CSS 3D transforms). Markup and CSS in `markup.js`, timeline in `scene.js`.

## Style
- Every cut / slam lands on a 0.5 s grid (120 BPM). Chapter verbs are huge (Inter 700, 300px) and slam with a short,
  deterministic screen shake. Transitions are circular `clip-path` floods in `accent`.
- The phone lives in CSS 3D and always drifts; UI elements leave the screen and float around it at different depths.
- Money figures become graphics (Ubuntu 500, counting up with outExpo).
- Background: `bg` with a faint grid drifting upward + a soft `glow` that follows the phone.
- Safe zones for 9:16: no text in the top 12% (y < 230) or bottom 20% (y > 1536).

## Beats
| # | time | on screen | text |
|---|------|-----------|------|
| 1 HOOK | 0.0–1.5 | 6 paper receipts tumble in and pile up | `Tired of` / `these?` |
| 2 SNAP | 1.5–2.0 | flood from centre | **SNAP.** at 1.6 |
| 3 SCAN | 2.0–5.0 | phone swings in, camera view of one receipt: brackets snap on, beam sweeps, receipt straightens, card numbers redacted, lines highlight | status ticks `finding…` … `8 lines · 4 categories` |
| 4 SORT | 5.0–5.5 | whip-pan left, flood from the right | **SORT.** at 5.1 |
| 5 ITEMS OUT | 5.5–8.0 | receipt card; items lift out as chips (`Oat milk · dairy-eggs`, `Coffee beans · pantry`, `Dish soap · household`, `Bananas · fruit`, `#organic`, `#essential`) | giant total `$42.13` counts up at 6.8 |
| 6 ANALYTICS | 8.0–9.5 | push-in on analytics: budget ring 17%, donut draws 5 segments; tap Share | `Know where it goes.` |
| 7 SPLIT | 9.5–10.0 | flood from the Share button | **SPLIT.** at 9.6 |
| 8 SPLIT | 10.0–12.5 | 4 avatars (M, T, L, You) fly in; each grabs an item chip from the phone; DONE pills flip in | `$10.53 each` |
| 9 COLLAPSE | 12.5–13.0 | everything collapses into the centre; the logo pops out | — |
| 10 END CARD | 13.0–15.0 | logo (tally marks) + `TALLY` wordmark; `Your receipts, TALLIED.`; `tally.example` with underline; `Get started →` | as listed |

## Acceptance
- `gfx sheet _reel-test --n 16 --cols 4` reads as the beats above; no empty frame, no overflowing text.
- Deterministic (same still twice = identical). Reference still: `gfx still _reel-test --t 7.61`.
