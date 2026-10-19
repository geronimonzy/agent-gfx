# Editorial sample  1920x1080 @30  6.0s  style: look-editorial
Test card (templates/looks/_sample/BRIEF.md) as three magazine pages: rules draw, then type masks in; pages turn with
a clip-path wipe led by a rule. Masthead and folio stay on top (running header); the folio counts the pages.

| beat | time    | on screen                                         | motion                                                   | text |
| 1    | 0.0-1.5 | masthead double rule + kicker, folio; serif headline, rule under it | rules scaleX inOutQuart 900; words slide up out of masks outQuart 1100, stagger 140 | "Make it move" |
| 2    | 1.3-3.1 | three columns with vertical rules: number, serif title, one line of body | column rules scaleY inOutQuart 800 stagger 200; lines mask up outQuart 1000 stagger 180 | "Plan" "Build" "Review" |
| 3    | 3.0-4.3 | page turn (wipe right→left, 900 ms); huge oxblood numeral + "frames per idea" | wipe inOutQuart; numeral masks up 1100; slow 2 % push | "24" "frames per idea" |
| 4    | 4.25-6.0 | page turn; centred wordmark, rule from the centre, tracked tagline; still hold | wipe inOutQuart 750; mask up outQuart 900; rule 800 | "gfx" "motion, reviewed" |
