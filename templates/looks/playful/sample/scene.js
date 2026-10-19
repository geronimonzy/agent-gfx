// Playful sample: the look test card (templates/looks/_sample/BRIEF.md) with bouncy springs and squash and stretch.
// Letters drop in and squash on landing, cards pop in like jelly, the number bounces in on a pink ball, everything
// leaves by shrinking (inBack, a small anticipation). Background shapes bob from t (pure).
import { createTimeline } from 'animejs';

const ITEMS = [
  { label: 'Plan', color: 'sun', shape: 'circle', rot: -4 },
  { label: 'Build', color: 'mint', shape: 'square', rot: 3 },
  { label: 'Review', color: 'tangerine', shape: 'pill', rot: -2 },
];
// background shapes: [x, y, size, kind, bob px, period s, phase]
const SHAPES = [
  [0.07, 0.18, 0.14, 'ring', 18, 3.0, 0.0], [0.9, 0.14, 0.09, 'dot', 14, 2.4, 1.3], [0.84, 0.8, 0.18, 'ring', 22, 3.0, 2.1],
  [0.13, 0.82, 0.08, 'capsule', 16, 2.0, 0.7], [0.5, 0.06, 0.05, 'dot', 10, 2.0, 2.6], [0.6, 0.93, 0.06, 'dot', 12, 3.0, 4.0],
  [0.31, 0.12, 0.04, 'dot', 10, 2.4, 3.3], [0.96, 0.48, 0.06, 'capsule', 14, 2.0, 5.1],
];
const CONFETTI = [[-0.32, -0.42, 'sun'], [0.34, -0.46, 'mint'], [0.4, 0.38, 'accent'], [-0.38, 0.4, 'tangerine'], [0.02, -0.62, 'accent'], [-0.05, 0.6, 'sun']];
let tl;
let shapes = [];
let counter;
const count = { v: 0 };

export default {
  setup(ctx) {
    const { root, width: W, height: H, style } = ctx;
    const F = style.fonts.display;
    const letters = (s, cls) => Array.from(s).map((c) => c === ' '
      ? `<span class="sp"> </span>` : `<span class="${cls}">${c}</span>`).join('');

    root.insertAdjacentHTML('beforeend', `
      <style>
        .stage{position:absolute;inset:0;font-family:${F}}
        .shape{position:absolute;background:var(--gfx-grid-strong)}
        .shape.ring{background:none;border:${H * 0.022}px solid var(--gfx-grid-strong);border-radius:50%}
        .shape.dot{border-radius:50%}.shape.capsule{border-radius:999px}
        .hwrap{position:absolute;left:0;right:0;top:${H * 0.41}px;text-align:center;transform-origin:center}
        .head{display:inline-block;font:700 ${H * 0.18}px/1 ${F};color:var(--gfx-text);
          white-space:pre;text-shadow:0 ${H * 0.012}px 0 var(--gfx-shadow)}
        .head .ch{display:inline-block;transform-origin:50% 100%}.head .hot{color:var(--gfx-sun)}
        .cards{position:absolute;left:0;right:0;top:${H * 0.37}px;display:flex;justify-content:center;gap:${W * 0.035}px}
        .card{width:${W * 0.2}px;height:${H * 0.42}px;background:var(--gfx-surface);border:${H * 0.007}px solid var(--gfx-border);
          border-radius:${H * 0.05}px;box-shadow:0 ${H * 0.018}px 0 var(--gfx-shadow);display:flex;flex-direction:column;
          align-items:center;justify-content:center;gap:${H * 0.035}px;transform-origin:50% 100%}
        .card .ic{width:${H * 0.13}px;height:${H * 0.13}px;border:${H * 0.006}px solid var(--gfx-border)}
        .ic.circle{border-radius:50%}.ic.square{border-radius:${H * 0.03}px;transform:rotate(12deg)}
        .ic.pill{width:${H * 0.2}px;height:${H * 0.1}px;border-radius:999px}
        .card .lb{font:600 ${H * 0.07}px/1 ${F};color:var(--gfx-ink)}
        .ball{position:absolute;left:${W / 2 - H * 0.3}px;top:${H * 0.12}px;width:${H * 0.6}px;height:${H * 0.6}px;border-radius:50%;
          background:var(--gfx-accent);border:${H * 0.008}px solid var(--gfx-border);box-shadow:0 ${H * 0.022}px 0 var(--gfx-shadow);
          display:flex;align-items:center;justify-content:center;transform-origin:50% 100%}
        .num{font:700 ${H * 0.32}px/1 ${F};color:var(--gfx-surface);text-shadow:0 ${H * 0.012}px 0 rgb(0 0 0 / .18)}
        .plabel{position:absolute;left:0;right:0;top:${H * 0.77}px;text-align:center}
        .pill{display:inline-block;padding:${H * 0.018}px ${H * 0.05}px;background:var(--gfx-sun);border:${H * 0.006}px solid var(--gfx-border);
          border-radius:999px;font:600 ${H * 0.06}px/1.1 ${F};color:var(--gfx-ink);box-shadow:0 ${H * 0.012}px 0 var(--gfx-shadow)}
        .endw{position:absolute;left:0;right:0;top:${H * 0.24}px;text-align:center}
        .mark{display:inline-flex;align-items:flex-end;justify-content:center;padding:${H * 0.03}px ${H * 0.09}px ${H * 0.05}px;background:var(--gfx-surface);
          border:${H * 0.008}px solid var(--gfx-border);border-radius:999px;box-shadow:0 ${H * 0.022}px 0 var(--gfx-shadow);
          font:700 ${H * 0.26}px/1 ${F};color:var(--gfx-ink);transform-origin:50% 100%}
        .mark .ch{display:inline-block;transform-origin:50% 100%}.mark .dot{color:var(--gfx-accent)}
        .tag{position:absolute;left:0;right:0;top:${H * 0.7}px;text-align:center;font:600 ${H * 0.065}px/1 ${F};color:var(--gfx-text);
          text-shadow:0 ${H * 0.008}px 0 var(--gfx-shadow)}
        .tag span{display:inline-block}
        .conf{position:absolute;left:${W / 2}px;top:${H * 0.42}px;width:${H * 0.05}px;height:${H * 0.05}px;margin:-${H * 0.025}px;
          border-radius:50%;border:${H * 0.005}px solid var(--gfx-border)}
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" style="position:absolute;inset:0;background:var(--gfx-bg);overflow:hidden">
        ${SHAPES.map(([x, y, s, k]) => `<div class="shape ${k}" style="left:${x * W - s * H / 2}px;top:${y * H - s * H / 2}px;width:${(k === 'capsule' ? 2 : 1) * s * H}px;height:${s * H}px"></div>`).join('')}
      </div>
      <!-- @end -->
      <div class="stage">
        <!-- @gfx headline -->
        <div class="hwrap" data-gfx="headline"><div class="head">${letters('Make it ', 'ch')}<span class="hot">${letters('move', 'ch')}</span></div></div>
        <!-- @end -->
        <!-- @gfx items item-plan item-build item-review -->
        <div class="cards" data-gfx="items">${ITEMS.map((it) => `
          <div class="card" data-gfx="item-${it.label.toLowerCase()}"><div class="ic ${it.shape}" style="background:var(--gfx-${it.color})"></div><div class="lb">${it.label}</div></div>`).join('')}
        </div>
        <!-- @end -->
        <!-- @gfx counter counter-label -->
        <div class="ball" data-gfx="counter"><div class="num">0</div></div>
        <div class="plabel"><span class="pill" data-gfx="counter-label">frames per idea</span></div>
        <!-- @end -->
        <!-- @gfx wordmark tagline -->
        ${CONFETTI.map(([, , c]) => `<div class="conf" style="background:var(--gfx-${c})"></div>`).join('')}
        <div class="endw"><div class="mark" data-gfx="wordmark">${letters('gfx', 'ch')}<span class="ch dot">.</span></div></div>
        <div class="tag" data-gfx="tagline">${'motion, reviewed'.split(' ').map((w) => `<span>${w}</span>`).join(' ')}</div>
        <!-- @end -->
      </div>`);

    shapes = [...root.querySelectorAll('.shape')].map((el, i) => ({ el, bob: SHAPES[i][4], per: SHAPES[i][5], ph: SHAPES[i][6] }));
    counter = root.querySelector('.num');
    const all = (sel) => [...root.querySelectorAll(sel)];

    tl = createTimeline({ autoplay: false, defaults: { ease: style.ease.out } });

    // drop: falls stretched, squashes on landing, one small bounce, settles (transform-origin at the bottom)
    const drop = (el, at, h) => tl.add(el, {
      translateY: [{ from: -h, to: 0, duration: 300, ease: 'inQuad' }, { to: -h * 0.12, duration: 150, ease: 'outQuad' },
        { to: 0, duration: 150, ease: 'inQuad' }],
      scaleY: [{ from: 1.3, to: 1.3, duration: 290 }, { to: 0.68, duration: 50, ease: 'outQuad' }, { to: 1.12, duration: 150, ease: 'outQuad' },
        { to: 1, duration: 360, ease: 'outElastic(1, .5)' }],
      scaleX: [{ from: 0.8, to: 0.8, duration: 290 }, { to: 1.3, duration: 50, ease: 'outQuad' }, { to: 0.92, duration: 150, ease: 'outQuad' },
        { to: 1, duration: 360, ease: 'outElastic(1, .5)' }],
    }, at);
    // jelly pop: grows from nothing with alternating squash and stretch
    const pop = (el, at, rot = 0) => tl.add(el, {
      scaleX: [{ from: 0, to: 1.18, duration: 220, ease: 'outQuad' }, { to: 0.9, duration: 140, ease: 'inOutQuad' },
        { to: 1.04, duration: 140, ease: 'inOutQuad' }, { to: 1, duration: 260, ease: 'outQuad' }],
      scaleY: [{ from: 0, to: 0.86, duration: 220, ease: 'outQuad' }, { to: 1.14, duration: 140, ease: 'inOutQuad' },
        { to: 0.97, duration: 140, ease: 'inOutQuad' }, { to: 1, duration: 260, ease: 'outQuad' }],
      rotate: { from: rot * -3, to: rot, duration: 900, ease: 'outElastic(1, .45)' },
    }, at);
    // shrink out with a little anticipation (inBack)
    const out = (el, at, dur = 260) => tl.add(el, { scale: [1, 0], duration: dur, ease: 'inBack(2)' }, at);

    // @gfx headline
    all('.head .ch').forEach((el, i) => drop(el, 80 + i * 55, H * 0.75));
    tl.add('[data-gfx="headline"]', { translateY: [0, -H * 0.33], scale: [1, 0.6], duration: 650, ease: 'outBack(1.7)' }, 1300);
    out('[data-gfx="headline"] .head', 3050, 280);
    // @end
    // @gfx items item-plan item-build item-review
    all('.card').forEach((el, i) => pop(el, 1450 + i * 270, ITEMS[i].rot));
    all('.card').forEach((el, i) => out(el, 2980 + (2 - i) * 60));
    // @end
    // @gfx counter counter-label
    drop('[data-gfx="counter"]', 3120, H * 1.1);
    tl.add(count, { v: [0, 24], duration: 650, ease: 'outCubic' }, 3420)
      .add('[data-gfx="counter"]', { rotate: [{ from: 0, to: -6, duration: 140, ease: 'outQuad' }, { to: 0, duration: 500, ease: 'outElastic(1, .4)' }] }, 4080);
    pop('[data-gfx="counter-label"]', 3600, 3);
    out('[data-gfx="counter"]', 4330, 240); out('[data-gfx="counter-label"]', 4300, 220);
    // @end
    // @gfx wordmark tagline
    pop('[data-gfx="wordmark"]', 4480, -2);
    all('.mark .ch').forEach((el, i) => drop(el, 4560 + i * 70, H * 0.3));
    all('.conf').forEach((el, i) => tl.add(el, {
      translateX: [0, CONFETTI[i][0] * W * 0.62], translateY: [0, CONFETTI[i][1] * H * 0.62],
      scale: [{ from: 0, to: 1.4, duration: 260, ease: 'outQuad' }, { to: 1, duration: 500, ease: 'outElastic(1, .5)' }],
      duration: 700, ease: 'outCubic',
    }, 4620 + i * 30));
    all('.tag span').forEach((el, i) => pop(el, 4950 + i * 120, i ? 2 : -2));
    // @end
    tl.seek(tl.duration); // prime: unstarted tweens would not apply their from values
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);
    counter.textContent = String(Math.round(count.v));
    // background shapes bob gently (pure function of t)
    for (const s of shapes) s.el.style.transform = `translateY(${(s.bob * Math.sin((2 * Math.PI * t) / s.per + s.ph)).toFixed(2)}px)`;
  },
};
