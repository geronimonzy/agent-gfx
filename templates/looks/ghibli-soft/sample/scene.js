// Ghibli soft: the look test card (templates/looks/_sample/BRIEF.md). Pure render(t): one paused timeline for the
// beats, plus drift (clouds, hills, petals, card bob) computed from t.
import { createTimeline, stagger } from 'animejs';
import { mulberry32 } from '/runner/lib/rng.js';

const ITEMS = [
  { key: 'plan', label: 'Plan', orb: 'var(--gfx-sky-top)' },
  { key: 'build', label: 'Build', orb: 'var(--gfx-leaf)' },
  { key: 'review', label: 'Review', orb: 'var(--gfx-petal)' },
];
const mix = (v, pct) => `color-mix(in srgb, var(--gfx-${v}) ${pct}%, transparent)`;

let tl;
let counterEl;
const counter = { v: 0 };
const drift = { clouds: [], hills: [], petals: [], bobs: [] };

// hill path: a wide soft sine ridge, filled to the bottom
function hillPath(W, H, base, amp, freq, phase) {
  let d = `M -200 ${H} L -200 ${base}`;
  for (let x = -200; x <= W + 200; x += 40) {
    const y = base + amp * Math.sin(x * freq + phase) + amp * 0.35 * Math.sin(x * freq * 2.3 + phase * 1.7);
    d += ` L ${x} ${y.toFixed(1)}`;
  }
  return d + ` L ${W + 200} ${H} Z`;
}

export default {
  setup(ctx) {
    const { root, width: W, height: H } = ctx;
    const u = H / 1080; // layout unit (1 at 1080p)
    const rnd = mulberry32(11);

    // clouds: blobs of overlapping circles
    const cloud = (i, x, y, s) => {
      const puffs = [[0, 0, 1], [0.55, -0.25, 0.8], [1.05, 0.05, 0.9], [-0.5, 0.12, 0.7], [0.45, 0.22, 0.85]];
      return `<div class="cloud" data-i="${i}" style="left:${x}px;top:${y}px">${puffs
        .map(([dx, dy, r]) => `<i style="left:${dx * 160 * s * u}px;top:${dy * 160 * s * u}px;width:${r * 200 * s * u}px;height:${r * 200 * s * u}px"></i>`)
        .join('')}</div>`;
    };
    const petals = Array.from({ length: 18 }, (_, i) => {
      const leaf = rnd() < 0.35;
      return {
        x0: rnd() * W * 1.1 - W * 0.05, y0: rnd() * H * 1.1 - H * 0.35,
        vx: (18 + rnd() * 30) * u, vy: (35 + rnd() * 40) * u,
        amp: (14 + rnd() * 26) * u, period: 2 + rnd() * 2, phase: rnd() * Math.PI * 2,
        rot0: rnd() * 360, spin: 20 + rnd() * 50, s: 0.6 + rnd() * 0.7, leaf,
      };
    });

    root.insertAdjacentHTML('beforeend', `
      <style>
        /* @gfx background sky sun-glow clouds hills petals */
        .bgl{position:absolute;inset:0;overflow:hidden}
        .sky{position:absolute;inset:-4% 0 0 0;background:linear-gradient(180deg,var(--gfx-sky-top) 0%,var(--gfx-sky-mid) 42%,var(--gfx-sky-low) 72%,var(--gfx-bg) 100%)}
        .wash{position:absolute;border-radius:50%;filter:blur(${50 * u}px)}
        .cloud{position:absolute;filter:blur(${5 * u}px);opacity:.92}
        .cloud i{position:absolute;border-radius:50%;background:radial-gradient(circle at 50% 30%,var(--gfx-cloud) 55%,color-mix(in srgb,var(--gfx-cloud) 70%,var(--gfx-sky-top)) 100%)}
        .hills{position:absolute;left:0;top:0;width:${W}px;height:${H}px;overflow:visible}
        .petal{position:absolute;left:0;top:0;width:${24 * u}px;height:${15 * u}px;border-radius:60% 40% 60% 40%;opacity:.85}
        /* @end */
        /* @gfx headline */
        .headline{position:absolute;left:0;right:0;top:${H * 0.2}px;text-align:center;font:800 ${116 * u}px var(--gfx-font-sans);
          color:var(--gfx-text);letter-spacing:.005em;text-shadow:0 ${4 * u}px ${18 * u}px ${mix('shadow', 18)}}
        .headline .w{display:inline-block;margin:0 ${14 * u}px;opacity:0}
        /* @end */
        /* @gfx cards */
        .cards{position:absolute;left:0;right:0;top:${H * 0.47}px;display:flex;justify-content:center;gap:${64 * u}px}
        .card{width:${360 * u}px;opacity:0}
        .card .in{height:${210 * u}px;border-radius:${28 * u}px;background:var(--gfx-surface);border:${1.5 * u}px solid var(--gfx-border);
          box-shadow:0 ${24 * u}px ${60 * u}px ${mix('shadow', 16)};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${18 * u}px}
        .orb{width:${78 * u}px;height:${78 * u}px;border-radius:50%;box-shadow:inset ${-8 * u}px ${-10 * u}px ${18 * u}px ${mix('shadow', 14)}}
        .card .t{font:600 ${44 * u}px var(--gfx-font-sans);color:var(--gfx-text)}
        /* @end */
        /* @gfx accent counter */
        .accent{position:absolute;left:0;right:0;top:0;height:${H}px;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .sun{position:absolute;left:${W / 2 - 330 * u}px;top:${H * 0.46 - 330 * u}px;width:${660 * u}px;height:${660 * u}px;border-radius:50%;opacity:0;
          background:radial-gradient(circle,var(--gfx-sun) 0%,color-mix(in srgb,var(--gfx-accent-soft) 70%,var(--gfx-sun)) 38%,${mix('accent-soft', 0)} 70%);filter:blur(${8 * u}px)}
        .num{position:relative;font:800 ${250 * u}px/1 var(--gfx-font-sans);color:var(--gfx-accent);text-shadow:0 ${6 * u}px ${24 * u}px ${mix('shadow', 15)};opacity:0}
        .lbl{position:relative;margin-top:${14 * u}px;font:600 ${46 * u}px var(--gfx-font-sans);color:var(--gfx-text);opacity:0}
        /* @end */
        /* @gfx wordmark tagline */
        .end{position:absolute;left:0;right:0;top:${H * 0.3}px;display:flex;flex-direction:column;align-items:center}
        .wm{font:800 ${230 * u}px/1 var(--gfx-font-sans);color:var(--gfx-text);letter-spacing:.01em;text-shadow:0 ${6 * u}px ${26 * u}px ${mix('shadow', 18)};opacity:0}
        .tag{margin-top:${22 * u}px;font:600 ${50 * u}px var(--gfx-font-sans);color:var(--gfx-muted);opacity:0}
        /* @end */
        /* @gfx grain */
        .grain{position:absolute;inset:0;width:${W}px;height:${H}px;opacity:.07;mix-blend-mode:multiply;pointer-events:none}
        /* @end */
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" class="bgl">
        <!-- @gfx sky --><div data-gfx="sky" class="sky"></div><!-- @end -->
        <!-- @gfx sun-glow -->
        <div data-gfx="sun-glow" class="bgl">
          <div class="wash" style="left:${W * 0.58}px;top:${H * 0.05}px;width:${W * 0.5}px;height:${H * 0.55}px;background:${mix('sun', 75)}"></div>
          <div class="wash" style="left:${-W * 0.12}px;top:${H * 0.32}px;width:${W * 0.45}px;height:${H * 0.4}px;background:${mix('sky-low', 80)}"></div>
          <div class="wash" style="left:${W * 0.3}px;top:${-H * 0.2}px;width:${W * 0.4}px;height:${H * 0.35}px;background:${mix('sky-top', 60)}"></div>
        </div>
        <!-- @end -->
        <!-- @gfx clouds -->
        <div data-gfx="clouds" class="bgl">
          ${cloud(0, W * 0.06, H * 0.08, 0.9)}${cloud(1, W * 0.66, H * 0.14, 0.7)}${cloud(2, W * 0.38, H * 0.02, 0.45)}
        </div>
        <!-- @end -->
        <!-- @gfx hills -->
        <svg data-gfx="hills" class="hills" viewBox="0 0 ${W} ${H}">
          <defs>
            <linearGradient id="hf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gfx-hill-far)"/><stop offset="1" style="stop-color:var(--gfx-sky-low)"/></linearGradient>
            <linearGradient id="hm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gfx-hill-mid)"/><stop offset="1" style="stop-color:var(--gfx-hill-far)"/></linearGradient>
            <linearGradient id="hn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--gfx-hill-near)"/><stop offset="1" style="stop-color:var(--gfx-hill-mid)"/></linearGradient>
            <filter id="soft"><feGaussianBlur stdDeviation="${2.5 * u}"/></filter>
          </defs>
          <path class="hill" data-k="0.25" fill="url(#hf)" filter="url(#soft)" d="${hillPath(W, H, H * 0.72, 22 * u, 0.0042, 0.4)}"/>
          <path class="hill" data-k="0.55" fill="url(#hm)" d="${hillPath(W, H, H * 0.8, 26 * u, 0.0031, 2.1)}"/>
          <path class="hill" data-k="1" fill="url(#hn)" d="${hillPath(W, H, H * 0.89, 20 * u, 0.0024, 4.0)}"/>
        </svg>
        <!-- @end -->
        <!-- @gfx petals -->
        <div data-gfx="petals" class="bgl">
          ${petals.map((p) => `<div class="petal" style="background:var(--gfx-${p.leaf ? 'leaf' : 'petal'})"></div>`).join('')}
        </div>
        <!-- @end -->
      </div>
      <!-- @end -->
      <!-- @gfx headline -->
      <div data-gfx="headline" class="headline">${'Make it move'.split(' ').map((w) => `<span class="w">${w}</span>`).join('')}</div>
      <!-- @end -->
      <!-- @gfx cards -->
      <div data-gfx="cards" class="cards">
        ${ITEMS.map((it) => `<div data-gfx="card-${it.key}" class="card"><div class="in"><div class="orb" style="background:radial-gradient(circle at 35% 30%,var(--gfx-cloud) 0%,${it.orb} 55%)"></div><div class="t">${it.label}</div></div></div>`).join('')}
      </div>
      <!-- @end -->
      <!-- @gfx accent -->
      <div data-gfx="accent" class="accent">
        <div class="sun"></div>
        <div class="num"><span data-gfx="counter">0</span></div>
        <div class="lbl">frames per idea</div>
      </div>
      <!-- @end -->
      <!-- @gfx wordmark tagline -->
      <div class="end">
        <div data-gfx="wordmark" class="wm">gfx</div>
        <div data-gfx="tagline" class="tag">motion, reviewed</div>
      </div>
      <!-- @end -->
      <!-- @gfx grain -->
      <svg data-gfx="grain" class="grain" viewBox="0 0 ${W} ${H}">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4"/><feColorMatrix type="saturate" values="0"/></filter>
        <rect width="100%" height="100%" filter="url(#grain)"/>
      </svg>
      <!-- @end -->`);

    const $ = (s) => root.querySelector(s);
    const $$ = (s) => [...root.querySelectorAll(s)];
    counterEl = $('[data-gfx="counter"]');
    // @gfx clouds hills petals cards
    drift.clouds = $$('.cloud').map((el, i) => ({ el, v: [14, -9, 6][i] * u }));
    drift.hills = $$('.hill').map((el) => ({ el, k: Number(el.dataset.k) }));
    drift.petals = $$('.petal').map((el, i) => ({ el, ...petals[i] }));
    drift.bobs = $$('.card .in');
    // @end

    const rise = (y) => ({ opacity: [0, 1], translateY: [y * u, 0], filter: ['blur(10px)', 'blur(0px)'] });
    tl = createTimeline({ autoplay: false, defaults: { ease: 'outCubic', duration: 1300 } })
      // @gfx headline
      .add('.headline .w', { ...rise(50), duration: 1400, delay: stagger(220) }, 200)
      .add('.headline', { opacity: [1, 0], translateY: [0, -40 * u], ease: 'inOutSine', duration: 1000 }, 2850)
      // @end
      // @gfx cards
      .add('.card', { ...rise(60), delay: stagger(300) }, 1300)
      .add('.cards', { opacity: [1, 0], translateY: [0, -36 * u], ease: 'inOutSine', duration: 1000 }, 2900)
      // @end
      // @gfx accent counter
      .add('.sun', { opacity: [0, 1], scale: [0.6, 1], duration: 1400 }, 3000)
      .add(counter, { v: [0, 24], duration: 1000 }, 3350)
      .add('.num', { opacity: [0, 1], translateY: [40 * u, 0], filter: ['blur(8px)', 'blur(0px)'], duration: 1000 }, 3350)
      .add('.lbl', { opacity: [0, 1], translateY: [24 * u, 0], duration: 900 }, 3600)
      .add(['.num', '.lbl'], { opacity: [1, 0], translateY: [0, -50 * u], filter: ['blur(0px)', 'blur(8px)'], ease: 'inOutSine', duration: 700 }, 4300)
      .add('.sun', { translateY: [0, -40 * u], scale: [1, 0.9], ease: 'inOutSine', duration: 1500 }, 4400)
      // @end
      // @gfx wordmark tagline
      .add('.wm', { opacity: [0, 1], filter: ['blur(10px)', 'blur(0px)'], duration: 900 }, 4600) // no outBack on blur: the overshoot gives an invalid negative blur
      .add('.wm', { translateY: [50 * u, 0], ease: 'outBack(1.15)', duration: 1100 }, 4600)
      .add('.tag', { opacity: [0, 1], translateY: [24 * u, 0], duration: 900 }, 4800);
      // @end
    tl.seek(tl.duration); // prime (animejs skill, seek pitfalls)
    tl.seek(0);
  },

  render(t) {
    tl.seek(0);
    tl.seek(t * 1000);
    counterEl.textContent = String(Math.round(counter.v));
    // @gfx clouds
    for (const c of drift.clouds) c.el.style.transform = `translateX(${(c.v * t).toFixed(2)}px)`;
    // @end
    // @gfx hills
    for (const h of drift.hills) h.el.setAttribute('transform', `translate(${(-h.k * 5 * t).toFixed(2)} 0)`);
    // @end
    // @gfx petals
    for (const p of drift.petals) {
      const x = p.x0 + p.vx * t + p.amp * Math.sin((2 * Math.PI * t) / p.period + p.phase);
      const y = p.y0 + p.vy * t;
      const r = p.rot0 + p.spin * t + 25 * Math.sin((2 * Math.PI * t) / p.period + p.phase);
      p.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${r.toFixed(1)}deg) scale(${p.s.toFixed(3)})`;
    }
    // @end
    // @gfx cards
    drift.bobs.forEach((el, i) => {
      el.style.transform = `translateY(${(3 * Math.sin((2 * Math.PI * t) / 3 + i * 1.3)).toFixed(2)}px)`;
    });
    // @end
  },
};
