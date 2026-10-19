---
name: canvas2d
description: Use when building a gfx scene of kind "canvas" - particles, generative or noise-driven visuals, many objects, glow and raster effects, trails, physics-like motion - with the 2D canvas API in the motion-graphics harness.
---

# Canvas 2D scenes (kind: canvas)

Contract: `<engine>/docs/CONTRACT.md` (`<engine>` from `.gfx/engine.json`, see `motion-graphics`). Workflow/verification: `motion-graphics` skill. Scaffold: `gfx new <name> --kind canvas`.

## Rules
- One `<canvas>` of exactly `ctx.width x ctx.height`, appended to `ctx.root`. Pixel ratio 1; the runner handles scaling. No HiDPI math.
- Background = its own canvas, named: first canvas in `ctx.root`, `position:absolute`, `data-gfx="background"`, `drawGrid(bg.getContext('2d'), style)` once in `setup` (redraw in `render` only if it moves). The content canvas above it is transparent and `clearRect`ed each frame (as in `templates/canvas`). Exception: content that blends with the grid (`lighter`, `multiply`) needs one canvas; then fill + grid in `render` as below and register the canvas `ctx.el('canvas', cv)` (no separate background layer).
- `render(t)` redraws EVERYTHING from scratch: `drawGrid(g, style, {cell = 40, majorEvery = 4})` from `/runner/lib/style.js` already FILLS the background (`colors.bg`) and strokes the grid (it resets the transform itself); without a grid, `fillRect` with `colors.bg` yourself. Then content. Reset `globalAlpha`, `globalCompositeOperation`, `shadowBlur`, `filter` at the end (or `g.save()/g.restore()` around each layer).
- Mark each named element's code (studio "Open code", motion-graphics step 9c): its `ctx.el` registration, setup and the drawing code in `render` in `// @gfx <name>` … `// @end` blocks (several blocks per name are fine; shared helpers stay outside):
  ```js
  // @gfx ball
  ctx.el('ball', { bounds: () => ({ x: bx - R, y: by - R, w: 2 * R, h: 2 * R }) });
  ballClock = ctx.clock('ball'); // studio can retime it (drag its layer bar)
  // @end
  // … in render(t):
  // @gfx ball
  const tb = ballClock(t); // the ball's own time: draw it from tb, not t
  bx = 200 + tb * 300; by = 540;
  g.beginPath(); g.arc(bx, by, R, 0, Math.PI * 2); g.fill();
  // @end
  ```
- Pure function of `t`. Banned: `Date.now`, `performance.now`, `Math.random()`, rAF, state mutated per call (frames can be seeked out of order).
- Colors from `ctx.style.colors`; alpha variants via `globalAlpha` or a helper `rgba(hex, a)`; do not invent hex.
- Fonts: `ctx.style.fonts.sans/mono`. The player awaits `document.fonts.ready` before setup, but if you load a font yourself, `await document.fonts.load('700 48px "Family"')` in setup. Use `measureText(str).width` for layout/centering and wrapping.

## Example (deterministic particle field with glow + trails)
```js
import { mulberry32, hash } from '/runner/lib/rng.js';
import { outCubic } from '/runner/lib/ease.js';
import { progress } from '/runner/lib/tween.js';
import { drawGrid } from '/runner/lib/style.js';

let g, P;
const N = 400, SEED = 7;
export default {
  async setup(ctx) {
    const c = document.createElement('canvas');
    c.width = ctx.width; c.height = ctx.height;
    ctx.root.appendChild(c);
    g = c.getContext('2d');
    const r = mulberry32(SEED);
    P = Array.from({ length: N }, () => ({           // per-particle constants, all seeded
      x: r() * ctx.width, y: r() * ctx.height,
      speed: 40 + r() * 120, phase: r(), size: 1 + r() * 2.5, hot: r() < 0.08,
    }));
  },
  render(t, ctx) {
    const { width: W, height: H, style: s, duration: D } = ctx;
    g.globalCompositeOperation = 'source-over';
    drawGrid(g, s, { cell: 60, majorEvery: 4 });   // fills bg + grid

    const intro = outCubic(progress(t, 0, 1));
    g.globalCompositeOperation = 'lighter';
    for (const p of P) {
      for (let k = 0; k < 6; k++) {                  // trail = k past samples, no state
        const tt = t - k * 0.03;
        const x = (p.x + Math.cos(p.phase * 6.283) * p.speed * tt + W * 4) % W;  // wrap
        const y = p.y + Math.sin(tt * 1.5 + p.phase * 6.283) * 40;
        g.globalAlpha = intro * (1 - k / 6) * (p.hot ? 0.9 : 0.35);
        g.fillStyle = p.hot ? s.colors.accent : s.colors.stroke;
        g.beginPath(); g.arc(x, y, p.size * (1 - k / 8), 0, 6.283); g.fill();
      }
    }
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  },
};
```
Loop tip: for a seamless loop make positions periodic in `t/D` (e.g. `x = (x0 + W * n * t / D) % W` with integer `n`, sin/cos of `2*PI*k*t/D` with integer k).

## Particles as pure functions
Position = `f(seed, i, t)`. Per-particle randoms from `hash(i, seed)` or a precomputed seeded array. Lifecycle: `age = ((t * rate) + i / N) % 1` gives a continuous respawn without state; birth position from `hash(Math.floor(t*rate + i/N) , i)` so each generation differs. Closed-form motion: `pos = p0 + v*age + 0.5*a*age^2`.

## Fixed-step simulation (when closed form is not possible: collisions, springs, flocking)
Run the sim from frame 0 with a fixed `dt = 1/fps`, cache states by frame index; to render `t`, compute `f = Math.round(t * fps)`, advance the sim up to `f` if needed, read cached state. If asked for an earlier frame, read the cache (store snapshots of positions as `Float32Array` per frame; for 60 fps x 10 s x 2000 particles that is ~9.6 MB, fine). Reset and re-run from 0 if the cache is missing. Seed everything. Cap particles ~2000 for sims.
```js
const cache = []; let sim;   // sim = {step(dt), snapshot()}
function stateAt(f, fps) {
  if (!sim) { sim = makeSim(); cache.length = 0; cache.push(sim.snapshot()); }
  while (cache.length <= f) { sim.step(1 / fps); cache.push(sim.snapshot()); }
  return cache[f];
}
```
Sub-frame interpolation: lerp between `cache[floor]` and `cache[ceil]` if `t*fps` is fractional.

## Glow
- Cheap: `g.shadowColor = s.colors.accent; g.shadowBlur = 24; g.stroke()` (set `shadowBlur = 0` after). Cost scales with shape count; do not use on thousands of dots.
- Layered strokes: draw the same path 3 times with widths 12/6/2 and alphas 0.08/0.2/1. Predictable and fast.
- Additive blend: `globalCompositeOperation = 'lighter'` for overlapping particles.
- Radial sprite: pre-render a soft radial-gradient dot to an offscreen canvas in `setup`; `drawImage` it scaled for each particle (fastest for thousands).
- `g.filter = 'blur(8px)'` works in Chrome but is slow; use on a few big layers only.

## Gradients, compositing, text
- `createLinearGradient/createRadialGradient` per frame is cheap; use `addColorStop` with style colors. Fade edges with a gradient overlay instead of per-object alpha.
- Compositing: `'lighter'` additive, `'screen'`/`'multiply'` blends, `'destination-out'` to erase (masked reveals), `'source-atop'` to tint only existing pixels. Use an offscreen canvas for masks: draw shape, set `'source-in'`, draw content.
- Text: `g.font = '700 ' + px + 'px ' + s.fonts.sans`, `textAlign/textBaseline`, `fillText`. Letter reveal: slice the string by `Math.floor(progress*len)`. Kerning/tracking: `g.letterSpacing = '2px'` (Chrome supported).

## Noise (no libs)
Value noise from seeded hash, deterministic and tiny:
```js
import { hash } from '/runner/lib/rng.js';
const sm = (x) => x * x * (3 - 2 * x);
export function noise2(x, y, seed = 1) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
  const h = (a, b) => hash(a * 73856093 ^ b * 19349663, seed);
  const top = h(xi, yi) * (1 - xf) + h(xi + 1, yi) * xf;
  const bot = h(xi, yi + 1) * (1 - xf) + h(xi + 1, yi + 1) * xf;
  return top * (1 - yf) + bot * yf;            // 0..1
}
```
`hash(i, seed = 0)` (rng.js) is stateless and returns a float in [0,1); args are coerced with `|0`, so negative/large ints are fine (fractions truncate). `mulberry32(seed)` returns a `() => [0,1)` generator.

Flow field: angle = `noise2(x*0.002, y*0.002 + t*0.1) * 6.283 * 2`; advance a particle by integrating (needs sim cache) or draw streamlines per frame by stepping each seed point 40 times (stateless, deterministic).

## Trails without state
Draw `k` past samples of the closed-form position at `t - j*dt` with fading alpha/width (as in the example). Do NOT rely on not-clearing the canvas for fade trails (breaks seeking).

## Performance
Batch by style: set `fillStyle` once, `beginPath()` once, many `rect/arc`, one `fill()`. Avoid `shadowBlur` in loops. Avoid `getImageData` per frame. Keep < ~20k draw calls per frame.

## Verify
Sheet to check motion continuity; still zoomed regions are not available, so check glow clipping by looking at whole-frame stills. Check frame 0 and last frame, and re-run the same `t` twice for identical output.
