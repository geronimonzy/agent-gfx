---
name: animejs
description: Use when building a gfx scene of kind "anime" - anime.js v4 timelines choreographing many DOM or SVG elements, HTML/CSS UI mockups (phone frames, cards, buttons, cursors), animated typography, staggered sequences, product or app showcases - in the motion-graphics harness.
---

# anime.js v4 scenes (kind: anime)

Contract: `<engine>/docs/CONTRACT.md` (`<engine>` from `.gfx/engine.json`, see `motion-graphics`). Workflow/verification: `motion-graphics` skill. Scaffold: `gfx new <name> --kind anime`. anime.js v4 (installed 4.5) differs from v3 (no default `anime()` export, `ease` not `easing`, `createTimeline`). Types: `node_modules/animejs/dist/modules/**/*.d.ts`. All APIs below were checked empirically.

## Rules
- `import { createTimeline, animate, stagger, utils, svg } from 'animejs'`.
- Build ONE paused timeline in `setup`; `render(t)` calls `tl.seek(t * 1000)` (anime.js time is milliseconds). Nothing else animates.
- `createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 600 } })`.
- Every element's start state must be correct at t=0 and every end state at t=duration. Seeking backwards must work: use `tl.add` with explicit from/to arrays (`opacity: [0, 1]`) so state is derived from the timeline, not from current DOM values.
- Banned: `autoplay: true`, `onUpdate`-driven side effects with state, CSS transitions, `Date.now`, `Math.random` (use `mulberry32`; `utils.random` is unseeded, avoid; `utils.createSeededRandom(seed)` exists).
- Grid background, as a NAMED layer (shows in the studio Layers tab): first child of root `<div data-gfx="background" style="position:absolute;inset:0"></div>`, then `import { gridCss } from '/runner/lib/style.js'; Object.assign(bgEl.style, gridCss(style))` (as in `templates/anime/scene.js`). Not on `root.style`: root is not selectable. Content goes after it in the DOM.
- Mark each named element's code (studio "Open code", motion-graphics step 9c): its markup, CSS rule, tweens and cues each in a `@gfx <name>` … `@end` block. Comments between chained `.add()` calls are fine (as in `templates/projects/reel`):
  ```js
  root.insertAdjacentHTML('beforeend', `
    <!-- @gfx card -->
    <div data-gfx="card" class="card"></div>
    <!-- @end -->`);
  const css = `/* @gfx card */ .card{width:400px;background:var(--gfx-surface)} /* @end */`;
  tl = createTimeline({ autoplay: false })
    // @gfx card
    .add('[data-gfx="card"]', { opacity: [0, 1], scale: [0.85, 1] }, 1300)
    // @end
    ;
  // @gfx card
  ctx.cue(1.4, 'impact', { id: 'card' });
  // @end
  ```
- Animate `transform` (`translateX/Y`, `scale`, `rotate`) and `opacity` for UI; avoid animating layout props (width/height/top) unless needed.
- Colors/fonts: build CSS with `var(--gfx-accent)`, `var(--gfx-surface)`, `var(--gfx-text)`, `var(--gfx-font-sans)` etc. (kebab-cased keys of `style.colors`). No literal hex.
- Timeline length must cover `ctx.duration`; if the last animation ends earlier, seeking past the end is fine. Confirmed (animejs 4.5): `seek(ms)` is synchronous, clamps above the total duration (end state) and below 0 (start state), and works backwards/out of order. `render` can return immediately.

## Example (title + staggered cards + underline draw)
```js
import { createTimeline, stagger, svg } from 'animejs';

let tl;
export default {
  async setup(ctx) {
    const { root, width: W, height: H } = ctx;
    root.insertAdjacentHTML('beforeend', `
      <style>
        .stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;
          justify-content:center;gap:${H*0.04}px;font-family:var(--gfx-font-sans);color:var(--gfx-text)}
        .title{font-size:${H*0.08}px;font-weight:700;opacity:0}
        .row{display:flex;gap:${W*0.02}px}
        .card{width:${W*0.18}px;height:${H*0.25}px;background:var(--gfx-surface);
          border:1px solid var(--gfx-border);border-radius:${ctx.style.radius*2}px;opacity:0}
        .card.hot{border-color:var(--gfx-accent)}
        svg.ul{width:${W*0.3}px;height:12px;overflow:visible}
      </style>
      <div class="stage">
        <div class="title">Ship faster</div>
        <svg class="ul" viewBox="0 0 300 12"><path d="M0 6 H300" stroke="var(--gfx-accent)" stroke-width="4" fill="none"/></svg>
        <div class="row"><div class="card"></div><div class="card hot"></div><div class="card"></div></div>
      </div>`);

    const [drawable] = svg.createDrawable('.ul path');
    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } });
    tl.add('.title', { opacity: [0, 1], translateY: [40, 0] }, 200)
      .add(drawable, { draw: ['0 0', '0 1'], duration: 600, ease: 'inOutCubic' }, '<<+=300')
      .add('.card', { opacity: [0, 1], translateY: [60, 0], scale: [0.92, 1], delay: stagger(80) }, '-=300');
  },
  render(t) { tl.seek(t * 1000); },
};
```
Stagger goes in a param (`delay`), never in the position argument. (Example rendered and checked: `createDrawable(selector)` returns an array of proxies; animate `draw: ['0 0', '0 1']` = start/end fractions of the stroke.)

## Timeline API cheat-sheet
- `tl.add(targets, params, position)`; targets = CSS selector, element, NodeList, array, or JS object. Params: any CSS/transform prop, `[from, to]` arrays, `duration`, `delay`, `ease`, `loop`, `alternate`.
- Position (3rd arg), verified with a previous anim at 500..1500: number = absolute ms; `'+=200'` -> 1700, `'-=300'` -> 1200 (relative to the timeline's current end); `'<'` -> 1500 (END of previous); `'<<'` -> 500 (START of previous); combos `'<<+=100'` -> 600, `'<-=300'` -> 1200. Labels: `tl.label(name: string, position?)` returns tl; later use `'name'` or `'name+=100'` as position.
- `tl.call(fn, position)` for callbacks: do not use for stateful side effects (seeking breaks them).
- `tl.set(targets, props, position)` sets instantly at a time (exists; seeking back before it restores the earlier value). `utils.set(targets, props)` sets immediately outside timelines.
- `stagger(80)` as `delay` or as a value; options: `{ from: 'first'|'last'|'center'|index, reversed: true, start: ms, grid: [cols, rows], axis: 'x'|'y', ease }` (accepted in 4.5; `from:'last'` tested). Value-staggering: `translateX: stagger([-10, 10])` spreads across targets (tested).
- Eases (strings): `linear`, `inQuad/outQuad/inOutQuad`, `inCubic/outCubic/inOutCubic`, `inExpo/outExpo/inOutExpo`, `outBack` / `outBack(1.7)` (overshoot param), `outElastic(1, .6)`, `inOutSine`: string names with params work. NOT as strings: `cubicBezier` and `spring` must be imported and passed as functions: `import { cubicBezier, spring } from 'animejs'`, `ease: cubicBezier(.4, 0, .2, 1)`, `ease: spring({ bounce: .4 })` (the string form throws / is ignored). Preset `style.ease.out/inOut/spring` are string names (`'outExpo'`, `'inOutCubic'`, `'outElastic(1, .6)'`): use `ctx.style.ease.out` as `defaults.ease`.
- Timeline total: `tl.duration` (ms); compare with `ctx.duration*1000`.

## SVG
- Line drawing: `const [d] = svg.createDrawable(selector); tl.add(d, { draw: ['0 0', '0 1'] })`. Stagger over several paths: `svg.createDrawable('path')` returns all, `delay: stagger(100)`.
- Morph: `tl.add(pathA, { d: svg.morphTo(pathB) })` (`morphTo(path2, precision?)`; compatible point counts; tested mid-morph).
- Motion along path: `const { translateX, translateY, rotate } = svg.createMotionPath('path')` (`createMotionPath(path, offset?)`); `tl.add(el, { translateX, translateY, rotate })`; the element should sit at the SVG origin (translate = absolute path coords). Tested.
- `svg` exports exactly `createDrawable`, `createMotionPath`, `morphTo`. `utils` includes `set`, `random`, `lerp`, `clamp`, `snap`, `wrap`, `createSeededRandom`.

## Building UI mockups (plain HTML/CSS in ctx.root)
Scale from frame size (`H*0.x`), never fixed px, so any resolution works. Parts:
- **Phone frame:** `div` aspect ~ 9:19.5, `border-radius: 11% / 5%`, 10-14px border in `var(--gfx-border)`, notch pill, inner screen `overflow:hidden` background `var(--gfx-surface)`. Animate the whole frame with `translateY/rotate/scale`; animate screen content inside.
- **Cards/lists:** rounded rect, 1px border, subtle shadow (`box-shadow: 0 20px 60px rgb(0 0 0 / .35)`), staggered entrance.
- **Buttons:** pill with accent bg; "press" = `scale: [1, .94, 1]` over 200ms, plus ripple ring (circle `scale 0->2, opacity .5->0`).
- **Cursor / tap indicator:** absolutely positioned SVG arrow (cursor) moved with `translateX/Y` along a few waypoints (`inOutCubic`, 500-800ms each, small arc via mid waypoint); tap = translucent circle 36px that scales/fades at the click time. Keep the cursor on top (z-index).
- **Typing text:** NOT a timeline of per-char tweens. Animate a number and set text in `render`:
  ```js
  const typing = { p: 0 };             // in setup:  tl.add(typing, { p: [0, 1], ease: 'linear', duration: 1400 }, 1200);
  const full = 'hello@acme.com';       // in render(t) after seek:
  input.textContent = full.slice(0, Math.floor(typing.p * full.length));
  ```
  Caret: `caret.style.opacity = Math.floor(t * 2) % 2` (blink derived from t) or hide while moving.
  This works because `seek` sets `typing.p` deterministically; `render` then derives DOM from it.
- **Counters:** same pattern: animate `{ v: 0 -> 1280 }` and write `Math.round(obj.v).toLocaleString('en-US')` in render.
- **Scroll:** animate `translateY` of an inner column inside an `overflow:hidden` viewport.
- Camera feel: wrap everything in a `.world` div and animate its `scale`/`translate` for push-ins; add `perspective` + `rotateX/rotateY` for tilt.

## Seek pitfalls (anime.js 4.5, found building the promo scenes)
- **Back-seeking across a gap between two tweens of the same property is unreliable** (e.g. opacity 0→1 at 2s, 1→0 at 9s; seeking 12s → 5s can return the wrong value). Make `render` reset first: `render(t) { tl.seek(0); tl.seek(t * 1000); }`. Cheap, and keeps every frame a pure function of t in preview scrubbing and parallel captures.
- **Tweens that haven't started don't apply their `from` value**, so elements meant to be hidden flash visible at t=0. Prime at the end of `setup`: `tl.seek(tl.duration); tl.seek(0);`.
- Long scenes: one helper function per beat that adds its tweens at absolute times (`tl.add(el, params, 11000)`) makes retiming easy; see `scenes/_reel-test/scene.js`.

## Hard cuts, keyframes, springs, blur (found building the starter looks)
- **Hard cuts** (fast-paced looks): do not animate visibility with tweens. Derive the frame from `t` in `render`, like the counter pattern: `const f = frames.findLastIndex((s) => t >= s); frameEls.forEach((el, i) => { el.style.display = i === f ? '' : 'none'; })` (or toggle `opacity`/`visibility`). Frame starts are numbers you compute once in setup (and feed to `ctx.cue`), so a cut and its sound stay in sync; tweens inside a frame are still on the one timeline.
- **Per-property keyframes** (squash and stretch, rebounds): an array of segments per property, each with its own `to`, `duration` and `ease`: `tl.add(el, { scaleY: [{ from: 1.35, to: 0.7, duration: 90, ease: 'inQuad' }, { to: 1, duration: 260, ease: 'outElastic(1, .5)' }], scaleX: [{ from: 0.8, to: 1.25, duration: 90 }, { to: 1, duration: 260 }] }, 400)`. Give opposite phases to scaleX and scaleY for squash and stretch. Works with `seek` in 4.5 (the segments run in sequence per property).
- **`spring()` in a timeline ignores its `duration`**: `spring({ bounce: .4, duration: 600 })` still runs for `spring.settlingDuration` (about 1.4-1.5 s at bounce .4, measured). Either pass the tween `duration: sp.settlingDuration` where `const sp = spring({ bounce: .4 })` and plan the next beat after it, or skip springs for a fixed-length overshoot (`outBack(1.4)`, `outElastic(1, .6)` with an explicit `duration`).
- **Never use an overshooting ease (`outBack`, `outElastic`, spring) on `filter: blur()`**: the value goes negative, `blur(-2px)` is invalid CSS, the browser keeps the previous value, and after the reset-then-seek the element stays blurred. Tween blur with a non-overshooting ease (`outCubic`) in its own `.add`, and the transform with the overshoot in another; or clamp: derive blur from a tween value in `render` with `Math.max(0, v)`.

## Typography
Split text into per-char/word `<span style="display:inline-block">` in setup (use `Array.from(str)` and `white-space:pre` for spaces) then stagger `translateY`/`opacity` with `delay: stagger(30)`. Mask line reveals: wrapper `overflow:hidden`, inner line `translateY: ['100%', 0]`. Keep letter-spacing tight on large headlines (`-0.02em`).

## Verify
Sheet to check the sequence; stills at: first frame (all hidden states correct, nothing flashing in), each hold, last frame. Common faults: elements visible at t=0 because the from-state was not set (use `[from, to]`), transforms fighting CSS transforms on the same element (animate one wrapper per transform owner), text clipped by `overflow:hidden`, timeline shorter than `duration` leaving a dead tail.
