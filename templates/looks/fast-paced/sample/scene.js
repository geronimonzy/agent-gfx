// Fast paced sample: the look test card (templates/looks/_sample/BRIEF.md) cut as 8 hard-cut frames of 0.4-1.2 s.
// Frames are full-frame panels switched on/off in render(t) (a hard cut = no tween); inside each panel the type
// whips in (translateX + skewX, outExpo 240 ms) with speed streaks.
import { createTimeline } from 'animejs';

// Hard-cut frames: [name, from s, to s, fill]. fill = which colour pair the frame uses.
const FRAMES = [
  ['f-make', 0.0, 0.4, 'dark'],
  ['f-it', 0.4, 0.8, 'light'],
  ['f-line', 0.8, 1.4, 'dark'],
  ['f-plan', 1.4, 2.0, 'dark'],
  ['f-build', 2.0, 2.6, 'light'],
  ['f-review', 2.6, 3.2, 'dark'],
  ['f-count', 3.2, 4.4, 'accent'],
  ['f-end', 4.4, 6.01, 'dark'],
];
const ITEMS = ['Plan', 'Build', 'Review'];
let tl;
let frames = [];
let counter;
const count = { v: 0 };

export default {
  setup(ctx) {
    const { root, width: W, height: H, style } = ctx;
    const D = style.fonts.display;
    const M = style.fonts.mono;

    // the index strip at the bottom of the three item frames: 01 PLAN · 02 BUILD · 03 REVIEW, current one lit
    const strip = (cur) => `<div class="strip">${ITEMS.map((s, i) =>
      `<span class="${i === cur ? 'on' : i < cur ? 'done' : 'todo'}">0${i + 1} ${s.toUpperCase()}</span>`).join('')}</div>`;
    const streaks = (n) => `<div class="streaks">${Array.from({ length: n }, (_, i) => `<i class="s${i}"></i>`).join('')}</div>`;

    root.insertAdjacentHTML('beforeend', `
      <style>
        .frame{position:absolute;inset:0;overflow:hidden;visibility:hidden}
        .frame.dark{background:var(--gfx-bg);color:var(--gfx-text)}
        .frame.light{background:var(--gfx-surface);color:var(--gfx-surface-ink)}
        .frame.accent{background:var(--gfx-accent);color:var(--gfx-accent-ink)}
        .big{position:absolute;left:${W * 0.06}px;top:50%;font:700 ${H * 0.34}px/0.82 ${D};letter-spacing:-0.05em;
          text-transform:uppercase;white-space:nowrap;transform-origin:left center}
        .big .hl{color:var(--gfx-accent)}
        .line{font-size:${H * 0.2}px}
        .num{position:absolute;left:${W * 0.06}px;top:${H * 0.12}px;font:500 ${H * 0.045}px ${M};letter-spacing:0.04em}
        .dark .num{color:var(--gfx-accent)}
        .strip{position:absolute;left:${W * 0.06}px;right:${W * 0.06}px;bottom:${H * 0.09}px;display:flex;gap:${W * 0.04}px;
          font:500 ${H * 0.03}px ${M};letter-spacing:0.06em}
        .strip .todo{opacity:.28}.strip .done{opacity:.6}
        .strip .on{box-shadow:inset 0 -${H * 0.008}px 0 var(--gfx-accent)}
        .light .strip .on{box-shadow:inset 0 -${H * 0.008}px 0 var(--gfx-surface-ink)}
        .bar{position:absolute;left:${W * 0.06}px;top:${H * 0.66}px;width:${W * 0.62}px;height:${H * 0.035}px;
          background:var(--gfx-accent);transform-origin:left center}
        .streaks i{position:absolute;left:0;height:${H * 0.012}px;width:${W * 0.5}px;background:currentColor;opacity:.9}
        .streaks .s0{top:${H * 0.24}px}.streaks .s1{top:${H * 0.71}px;width:${W * 0.32}px}.streaks .s2{top:${H * 0.8}px;width:${W * 0.7}px}
        .count{position:absolute;left:${W * 0.05}px;top:50%;font:700 ${H * 0.78}px/0.8 ${D};letter-spacing:-0.06em;
          font-variant-numeric:tabular-nums;transform-origin:left center}
        .clabel{position:absolute;right:${W * 0.06}px;bottom:${H * 0.12}px;font:700 ${H * 0.085}px/0.95 ${D};
          text-transform:uppercase;letter-spacing:-0.02em;text-align:right}
        .mark{position:absolute;left:0;right:0;text-align:center;top:46%;font:700 ${H * 0.42}px/0.8 ${D};letter-spacing:-0.07em}
        .mark .dot{color:var(--gfx-accent)}
        .tag{position:absolute;left:0;right:0;text-align:center;top:70%;font:500 ${H * 0.05}px ${M};letter-spacing:0.08em;text-transform:uppercase;
          color:var(--gfx-muted);white-space:nowrap}
        .endbar{position:absolute;left:0;top:${H * 0.86}px;width:${W}px;height:${H * 0.02}px;background:var(--gfx-accent);
          transform-origin:left center}
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" style="position:absolute;inset:0;background:var(--gfx-bg)"></div>
      <!-- @end -->
      <!-- @gfx headline -->
      <div class="frame dark" data-gfx="f-make"><div class="big" id="w-make">Make</div>${streaks(3)}</div>
      <div class="frame light" data-gfx="f-it"><div class="big" id="w-it" style="left:auto;right:${W * 0.08}px;transform-origin:right center">It</div>${streaks(3)}</div>
      <div class="frame dark" data-gfx="f-line"><div class="big line" data-gfx="headline">Make it <span class="hl">move</span></div><div class="bar" data-gfx="headline-bar"></div></div>
      <!-- @end -->
      <!-- @gfx items item-plan item-build item-review -->
      ${ITEMS.map((s, i) => `<div class="frame ${i === 1 ? 'light' : 'dark'}" data-gfx="f-${s.toLowerCase()}">
        <div class="num">0${i + 1} / 03</div>
        <div class="big" data-gfx="item-${s.toLowerCase()}">${s}</div>${streaks(3)}${strip(i)}</div>`).join('')}
      <!-- @end -->
      <!-- @gfx counter counter-label -->
      <div class="frame accent" data-gfx="f-count">
        <div class="count" data-gfx="counter">00</div>
        <div class="clabel" data-gfx="counter-label">Frames<br>per idea</div>${streaks(3)}
      </div>
      <!-- @end -->
      <!-- @gfx wordmark tagline -->
      <div class="frame dark" data-gfx="f-end">
        <div class="mark" data-gfx="wordmark">gfx<span class="dot">.</span></div>
        <div class="tag" data-gfx="tagline">motion, reviewed</div>
        <div class="endbar" data-gfx="end-bar"></div>
      </div>
      <!-- @end -->`);

    frames = FRAMES.map(([key, a, b]) => ({ el: root.querySelector(`[data-gfx="${key}"]`), a, b }));
    counter = root.querySelector('[data-gfx="counter"]');
    const $ = (sel) => root.querySelector(sel);
    const streaksOf = (key) => root.querySelectorAll(`[data-gfx="${key}"] .streaks i`);

    // a whip: the block slides in from far off one side, skewed, and lands hard (outExpo); streaks shoot across
    const WHIP = 240;
    const whip = (target, at, dir = 1, extra = {}) => tl.add(target, {
      translateX: [dir * W * 1.1, 0], skewX: [dir * -24, 0], translateY: ['-50%', '-50%'],
      duration: WHIP, ease: 'outExpo', ...extra,
    }, at);
    const streak = (key, at, dir = 1) => tl.add(streaksOf(key), {
      translateX: dir > 0 ? [W * 1.05, -W * 0.8] : [-W * 0.8, W * 1.05], scaleX: [0.4, 1.4], opacity: [0.9, 0],
      duration: 260, ease: 'outQuad', delay: (_, i) => i * 22,
    }, at);

    tl = createTimeline({ autoplay: false, defaults: { ease: style.ease.out } });
    // @gfx headline
    whip('#w-make', 0, 1); streak('f-make', 0, 1);
    whip('#w-it', 400, -1); streak('f-it', 400, -1);
    tl.add('[data-gfx="headline"]', { scale: [1.35, 1], translateY: ['-50%', '-50%'], duration: 300, ease: 'outExpo' }, 800)
      .add('[data-gfx="headline-bar"]', { scaleX: [0, 1], duration: 260, ease: 'outExpo' }, 900)
      .add('[data-gfx="headline"]', { translateX: [0, -W * 0.02], duration: 500, ease: 'linear' }, 1000);
    // @end
    // @gfx items item-plan item-build item-review
    ITEMS.forEach((s, i) => {
      const at = 1400 + i * 600, dir = i % 2 ? -1 : 1, key = `f-${s.toLowerCase()}`;
      whip(`[data-gfx="item-${s.toLowerCase()}"]`, at, dir);
      streak(key, at, dir);
      tl.add(`[data-gfx="${key}"] .num`, { translateX: [dir * W * 0.3, 0], opacity: [0, 1], duration: 200 }, at + 60)
        .add(`[data-gfx="${key}"] .strip .on`, { translateY: [H * 0.05, 0], opacity: [0, 1], duration: 180 }, at + 120)
        .add(`[data-gfx="item-${s.toLowerCase()}"]`, { translateX: [0, -dir * W * 0.025], duration: 340, ease: 'linear' }, at + WHIP);
    });
    // @end
    // @gfx counter counter-label
    tl.add('[data-gfx="counter"]', { translateX: [W, 0], skewX: [-24, 0], translateY: ['-50%', '-50%'], duration: 220, ease: 'outExpo' }, 3200)
      .add(count, { v: [0, 24], duration: 650, ease: 'outExpo' }, 3240)
      .add('[data-gfx="counter"]', { scale: [1.12, 1], translateY: ['-50%', '-50%'], duration: 260, ease: 'outExpo' }, 3890)
      .add('[data-gfx="counter-label"]', { translateX: [W * 0.6, 0], skewX: [-20, 0], duration: 240, ease: 'outExpo' }, 3420);
    streak('f-count', 3200, 1);
    // @end
    // @gfx wordmark tagline
    tl.add('[data-gfx="wordmark"]', { scale: [1.9, 1], translateY: ['-50%', '-50%'], duration: 320, ease: 'outExpo' }, 4400)
      .add('[data-gfx="end-bar"]', { scaleX: [0, 1], duration: 300, ease: 'outExpo' }, 4480)
      .add('[data-gfx="tagline"]', { translateX: [W * 0.5, 0], skewX: [-20, 0], opacity: [0, 1], duration: 260, ease: 'outExpo' }, 4620)
      .add('[data-gfx="wordmark"]', { scale: [1, 1.03], translateY: ['-50%', '-50%'], duration: 1260, ease: 'linear' }, 4740);
    // @end
    tl.seek(tl.duration); // prime: unstarted tweens would not apply their from values
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);
    for (const f of frames) f.el.style.visibility = t >= f.a && t < f.b ? 'visible' : 'hidden'; // hard cuts
    counter.textContent = String(Math.round(count.v)).padStart(2, '0');
  },
};
