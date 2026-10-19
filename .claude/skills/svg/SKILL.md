---
name: svg
description: Use when building a gfx scene of kind "svg" - line art, diagrams, paths drawing on, crisp vector shapes, path morphs, masked reveals, Bezier anatomy explainers - with inline SVG in the motion-graphics harness.
---

# SVG scenes (kind: svg)

Contract: `<engine>/docs/CONTRACT.md` (`<engine>` from `.gfx/engine.json`, see `motion-graphics`). Workflow/verification: `motion-graphics` skill. Scaffold: `gfx new <name> --kind svg`.

## Rules
- Inline `<svg viewBox="0 0 W H" width=W height=H>` appended to `ctx.root`, built in `setup` with `document.createElementNS('http://www.w3.org/2000/svg', tag)`. Create all elements in setup; `render(t)` only sets attributes/styles (`stroke-dashoffset`, `transform`, `d`, `opacity`, `fill`).
- Pure function of t. No SMIL (`<animate>`), no CSS animations/transitions, no rAF, no `Math.random` (use `mulberry32`).
- Colors: `ctx.style.colors.*` or `var(--gfx-stroke)`, `var(--gfx-accent)` (works in SVG attributes via `style=`; as plain attributes use JS values from `ctx.style`).
- Measure geometry (`getTotalLength`, `getBBox`) in setup after the element is attached to the DOM; cache results.
- Background grid: `import { gridSvg } from '/runner/lib/style.js'`; `gridSvg(style, w, h, { cell = 40, majorEvery = 4 })` returns a MARKUP STRING (`<g class="gfx-grid">`: bg rect + 2 paths; it already paints the bg). Pass `{ name: 'background' }` so the group is a named layer in the studio (`data-gfx="background"`; always do this), and insert first so it sits behind: `svg.insertAdjacentHTML('afterbegin', gridSvg(s, W, H, { name: 'background' }))` (tested). For HTML scenes use `gridCss(style, opts)` (returns a style-props object).
- Mark each named element's code (studio "Open code", motion-graphics step 9c): its creation in `setup` and its attribute updates in `render` in `// @gfx <name>` … `// @end` blocks:
  ```js
  // @gfx curve
  curve = el(svg, 'path', { fill: 'none', stroke, 'stroke-width': 6, 'data-gfx': 'curve' });
  // @end
  // … in render(t):
  // @gfx curve
  curve.setAttribute('stroke-dashoffset', len * (1 - outCubic(progress(t, 0.3, 2.3))));
  // @end
  ```

## Example (path draws on, node pops, label fades)
```js
import { outExpo, outBack, inOutCubic } from '/runner/lib/ease.js';
import { progress } from '/runner/lib/tween.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e); return e;
};
let path, len, node, label;
export default {
  async setup(ctx) {
    const { width: W, height: H, style: s } = ctx;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H }, ctx.root);
    path = el('path', {
      d: `M ${W*0.15} ${H*0.7} C ${W*0.3} ${H*0.2}, ${W*0.6} ${H*1.0}, ${W*0.85} ${H*0.3}`,
      fill: 'none', stroke: s.colors.stroke, 'stroke-width': 6, 'stroke-linecap': 'round',
    }, svg);
    len = path.getTotalLength();
    path.style.strokeDasharray = len;
    node = el('circle', { r: 18, fill: s.colors.accent }, svg);
    label = el('text', { 'text-anchor': 'middle', fill: s.colors.text,
      'font-family': s.fonts.sans, 'font-size': H * 0.04 }, svg);
    label.textContent = 'Endpoint';
  },
  render(t, ctx) {
    const p = outExpo(progress(t, 0.4, 2.4));
    path.style.strokeDashoffset = len * (1 - p);
    const pt = path.getPointAtLength(len * p);
    node.setAttribute('cx', pt.x); node.setAttribute('cy', pt.y);
    node.setAttribute('r', 18 * outBack(progress(t, 0.4, 1.0)));
    label.setAttribute('x', pt.x); label.setAttribute('y', pt.y - 40);
    label.setAttribute('opacity', inOutCubic(progress(t, 2.2, 2.8)));
  },
};
```
Guard against `p = 0`: dashed path with `dashoffset = len` shows nothing, but round linecaps can leave a dot; set `opacity` 0 when `p === 0`. Without dasharray set, offset does nothing.

## Line drawing
`stroke-dasharray = len`, `stroke-dashoffset = len*(1-p)`. Reverse draw: offset from `-len` to 0 or negative. Draw a segment that travels (comet): `dasharray = "segLen len"`, `dashoffset = -p*len`. Many paths: stagger with `stagger(i, 0.06, start)` from `tween.js` and normalize lengths (use `pathLength="1"` attribute on each path, then dasharray `1` and offset `1-p`; simpler and consistent speed per path is NOT preserved, so use real lengths when speed must be equal).
Strokes only: set `fill="none"`; fade the fill in after the stroke finishes for a "draw then fill" look.

## Transforms
- Rotate/scale around an element's own center: `style.transformBox = 'fill-box'; style.transformOrigin = 'center'`, then `style.transform = 'translate(' + x + 'px, ' + y + 'px) rotate(' + a + 'deg) scale(' + k + ')'`. Units required in CSS (px, deg).
- Alternative without CSS: `setAttribute('transform', 'translate(' + x + ' ' + y + ') rotate(' + a + ') scale(' + k + ')')` with the element drawn around (0,0). Most predictable; prefer for groups you position yourself.
- Group things in `<g>` and animate the group.

## Morphing
Interpolate `d` strings: both paths must have the same command sequence and number of numbers. Parse once in setup (`d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi).map(Number)`), keep the command template, and in render lerp each number then rebuild. Ensure start/end point order matches (reverse one path, or rotate the start index, if the morph twists). For unequal shapes, build both from the same N cubic segments (e.g. circle -> blob: 4 cubic arcs each). Polygons: resample both to N points with `getPointAtLength` in setup and morph with `L` commands.

## Masks, clips, reveals
- Wipe reveal: `<clipPath><rect/></clipPath>` and animate the rect `width`; apply `clip-path="url(#id)"` on the target. Unique ids per scene.
- Soft reveal: `<mask>` with a `<linearGradient>` rect that translates across.
- Draw-on mask: put the thick stroked path in the mask (white, dash animated) to reveal an image/gradient shape beneath. Gives gradient-colored strokes.
- Text reveal: clipPath rect growing, or per-character `<tspan>` opacity.

## Text, markers, filters
- Text: `<text>` with `font-family=s.fonts.sans`, `text-anchor`, `dominant-baseline="middle"`. Measure with `getBBox()` or `getComputedTextLength()` in setup (fonts are loaded before setup). Text on path: `<text><textPath href="#pid" startOffset="...">…</textPath></text>`; animate `startOffset` (% or length).
- Markers/arrowheads: `<marker id markerWidth markerHeight refX refY orient="auto">` then `marker-end="url(#id)"`. Markers show immediately on draw-on paths; if that looks wrong, draw the arrowhead as a separate polygon placed at `getPointAtLength` with the tangent angle (`atan2` from two nearby points).
- Glow: `<filter id="glow"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` and `filter="url(#glow)"` on a group. Filters re-rasterize every frame: apply to few, small groups, not to the whole scene, and expect slower capture. Cheaper fake: duplicate path with wider, low-opacity stroke.
- Crisp strokes under scaling: `vector-effect="non-scaling-stroke"` (stroke width stays in screen px when the element/group scales).
- Pixel-crisp 1px lines: put them on `.5` coordinates.

## Bezier anatomy diagram recipe
Cubic `P0 C1 C2 P3`: draw the curve (accent), handle lines P0-C1 and P3-C2 (`muted`, dashed or thin), points as circles (P0,P3 solid; C1,C2 hollow), labels via text. Animate: draw handles in, then draw the curve, then move C1/C2 along a keyframed path and rebuild `d` each frame (`M x0 y0 C x1 y1, x2 y2, x3 y3`). De Casteljau: show `lerp` levels (`A=lerp(P0,C1,u)`, `B`, `C`, then `D`, `E`, final point) with lines between, `u = progress(t, a, b)`. Evaluate points with your own function (no DOM needed), not `getPointAtLength`.

## Verify
Check stills at beat midpoints for dash artifacts (dots at p=0), clipped strokes at the viewBox edge (stroke extends half its width), text overflow, filter clipping (`filter` region defaults to bbox + 10%; set `x/y/width/height="-50%/-50%/200%/200%"` on the filter if glow is cut).
