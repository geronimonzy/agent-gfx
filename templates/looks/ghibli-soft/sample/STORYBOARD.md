# Ghibli soft sample  1920x1080 @30  6.0s  style: look-ghibli-soft
Test card (templates/looks/_sample/BRIEF.md) in the look's pace: beats overlap, nothing cuts; sky, clouds, hills and
petals drift the whole time.

| beat | time    | on screen                                   | motion                                              | text |
| 1    | 0.0-1.8 | painted sky, low hills, petals; headline     | words rise 50 px + blur 10→0, outCubic 1400, stagger 220 | "Make it move" |
| 2    | 1.3-3.3 | three cream paper cards under the headline   | rise 60 px + blur, outCubic 1300, stagger 300; then bob 3 px | "Plan" "Build" "Review" |
| 3    | 3.0-4.6 | headline + cards float up and dissolve; a warm sun glow blooms; counter 0→24 in terracotta | inOutSine 1000 out; sun scale .6→1 outCubic 1400; count outCubic 1200 | "24" "frames per idea" |
| 4    | 4.4-6.0 | number floats away; wordmark settles in the sun glow, tagline under it; hold with drift | wordmark rise + outBack(1.15) 1100; tagline outCubic 1000 | "gfx" "motion, reviewed" |
