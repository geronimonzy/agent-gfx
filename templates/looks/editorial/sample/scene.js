// Editorial: the look test card (templates/looks/_sample/BRIEF.md) as three magazine pages. Pure render(t): one
// paused timeline; page wipes, the leading rule and the folio are derived from timeline-driven objects in render.
import { createTimeline, stagger } from 'animejs';

const COLS = [
  { key: 'plan', n: '01', title: 'Plan', body: 'Sketch the beats first.' },
  { key: 'build', n: '02', title: 'Build', body: 'Set type, rules, timing.' },
  { key: 'review', n: '03', title: 'Review', body: 'Read every frame.' },
];

let tl;
const turn2 = { p: 0 };
const turn3 = { p: 0 };
let pages;
let edges;
let folioNo;

export default {
  setup(ctx) {
    const { root, width: W, height: H, style } = ctx;
    const u = H / 1080;
    const M = 96 * u; // margin
    const CW = W - 2 * M; // content width
    const serif = style.fonts.serif;
    // a line of type that reveals by sliding up out of its own mask
    const ln = (cls, txt) => `<span class="ln ${cls}"><span>${txt}</span></span>`;

    root.insertAdjacentHTML('beforeend', `
      <style>
        /* @gfx background */
        .bg{position:absolute;inset:0;background:var(--gfx-bg)}
        .guide{position:absolute;top:0;bottom:0;width:${u}px;background:var(--gfx-grid)}
        /* @end */
        .ln{display:block;overflow:hidden;padding-bottom:.08em}
        .fig .lbl .ln{padding-bottom:.18em;margin-bottom:-.1em}
        .ln>span{display:inline-block;transform:translateY(110%)}
        .rule{position:absolute;height:${1.5 * u}px;background:var(--gfx-stroke);transform-origin:left center;transform:scaleX(0)}
        .kick{font:600 ${21 * u}px var(--gfx-font-sans);letter-spacing:.16em;text-transform:uppercase;color:var(--gfx-muted)}
        .page{position:absolute;inset:0}
        /* @gfx masthead folio */
        .mast{position:absolute;left:${M}px;right:${M}px;top:${M - 20 * u}px;display:flex;justify-content:space-between}
        .folio{position:absolute;left:${M}px;right:${M}px;top:${H - M - 10 * u}px;display:flex;justify-content:space-between}
        .folio .kick{font-size:${19 * u}px}
        /* @end */
        /* @gfx headline */
        .headline{position:absolute;left:${M}px;top:${200 * u}px;font:600 ${168 * u}px/1.02 ${serif};letter-spacing:-.025em;color:var(--gfx-text);white-space:nowrap}
        .headline .ln{display:inline-block;margin-right:.22em}
        .dek{position:absolute;left:${M + CW * 0.62}px;top:${232 * u}px;width:${CW * 0.38}px;font:400 ${28 * u}px/1.45 var(--gfx-font-sans);color:var(--gfx-muted)}
        /* @end */
        /* @gfx columns */
        .col{position:absolute;top:${520 * u}px;width:${CW / 3 - 48 * u}px}
        .col .n{font:600 ${30 * u}px ${serif};color:var(--gfx-accent);letter-spacing:.02em}
        .col .t{margin-top:${10 * u}px;font:600 ${84 * u}px/1.05 ${serif};letter-spacing:-.02em;color:var(--gfx-text)}
        .col .b{margin-top:${18 * u}px;font:400 ${28 * u}px/1.4 var(--gfx-font-sans);color:var(--gfx-muted)}
        .vrule{position:absolute;top:${520 * u}px;width:${1.5 * u}px;height:${290 * u}px;background:var(--gfx-border);transform-origin:center top;transform:scaleY(0)}
        /* @end */
        /* @gfx page-2 numeral */
        .p2{background:var(--gfx-surface)}
        .numeral{position:absolute;left:${M - 14 * u}px;top:${150 * u}px;font:600 ${600 * u}px/1 ${serif};letter-spacing:-.04em;color:var(--gfx-accent);transform-origin:left bottom}
        .numeral .ln{padding-bottom:0}
        .fig{position:absolute;left:${M + CW * 0.56}px;top:${380 * u}px;width:${CW * 0.44}px}
        .fig .lbl{margin-top:${34 * u}px;font:600 ${104 * u}px/1.02 ${serif};letter-spacing:-.025em;color:var(--gfx-text)}
        /* @end */
        /* @gfx page-3 wordmark tagline */
        .p3{background:var(--gfx-bg)}
        .wm{position:absolute;left:0;right:0;top:${300 * u}px;text-align:center;font:700 ${300 * u}px/1 ${serif};letter-spacing:-.03em;color:var(--gfx-text)}
        .wm .ln{display:inline-block}
        .tag{position:absolute;left:0;right:0;top:${700 * u}px;text-align:center}
        .tag .kick{font-size:${30 * u}px;letter-spacing:.24em;color:var(--gfx-text)}
        /* @end */
        .edge{position:absolute;top:0;bottom:0;left:0;width:${1.5 * u}px;background:var(--gfx-stroke);opacity:0}
        .edge::after{content:'';position:absolute;top:0;bottom:0;right:${1.5 * u}px;width:${70 * u}px;
          background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--gfx-paper-shade) 85%,transparent))}
        /* @gfx grain */
        .grain{position:absolute;inset:0;width:${W}px;height:${H}px;opacity:.05;mix-blend-mode:multiply;pointer-events:none}
        /* @end */
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" class="bg">
        ${Array.from({ length: 13 }, (_, i) => `<div class="guide" style="left:${M + (CW * i) / 12}px"></div>`).join('')}
      </div>
      <!-- @end -->
      <div data-gfx="page-1" class="page">
        <!-- @gfx headline -->
        <div data-gfx="headline" class="headline">${'Make it move'.split(' ').map((w) => ln('w', w)).join('')}</div>
        <div class="rule r-head" style="left:${M}px;top:${420 * u}px;width:${CW}px"></div>
        <!-- @end -->
        <!-- @gfx columns -->
        ${COLS.map((c, i) => `
          <div data-gfx="col-${c.key}" class="col" style="left:${M + (CW * i) / 3 + (i ? 40 * u : 0)}px">
            ${ln('cl n', c.n)}${ln('cl t', c.title)}${ln('cl b', c.body)}
          </div>`).join('')}
        ${[1, 2].map((i) => `<div class="vrule" style="left:${M + (CW * i) / 3}px"></div>`).join('')}
        <!-- @end -->
      </div>
      <!-- @gfx page-2 numeral -->
      <div data-gfx="page-2" class="page p2">
        <div data-gfx="numeral" class="numeral">${ln('nm', '24')}</div>
        <div class="fig">
          ${ln('fg kick', 'Fig. 1 — Pace')}
          <div class="rule r-fig" style="position:relative;display:block;margin-top:${22 * u}px;width:100%;background:var(--gfx-accent)"></div>
          <div class="lbl">${ln('fg', 'frames')}${ln('fg', 'per idea')}</div>
        </div>
      </div>
      <!-- @end -->
      <!-- @gfx page-3 wordmark tagline -->
      <div data-gfx="page-3" class="page p3">
        <div data-gfx="wordmark" class="wm">${ln('wl', 'gfx')}</div>
        <div class="rule r-end" style="left:${W / 2 - 160 * u}px;top:${648 * u}px;width:${320 * u}px;transform-origin:center"></div>
        <div data-gfx="tagline" class="tag">${ln('tg kick', 'motion, reviewed')}</div>
      </div>
      <!-- @end -->
      <div class="edge e2"></div><div class="edge e3"></div>
      <!-- @gfx masthead -->
      <div data-gfx="masthead">
        <div class="mast">${ln('mk kick', 'The motion issue')}${ln('mk kick', 'No. 06')}</div>
        <div class="rule r-mast" style="left:${M}px;top:${M + 22 * u}px;width:${CW}px;height:${3 * u}px"></div>
        <div class="rule r-mast" style="left:${M}px;top:${M + 30 * u}px;width:${CW}px;height:${u}px"></div>
      </div>
      <!-- @end -->
      <!-- @gfx folio -->
      <div data-gfx="folio">
        <div class="rule r-folio" style="left:${M}px;top:${H - M - 24 * u}px;width:${CW}px;height:${u}px;background:var(--gfx-border)"></div>
        <div class="folio">${ln('fo kick', 'gfx — look sample')}${ln('fo kick', 'p. <b class="pg" style="font-weight:600">1</b>')}</div>
      </div>
      <!-- @end -->
      <!-- @gfx grain -->
      <svg data-gfx="grain" class="grain" viewBox="0 0 ${W} ${H}">
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="9"/><feColorMatrix type="saturate" values="0"/></filter>
        <rect width="100%" height="100%" filter="url(#grain)"/>
      </svg>
      <!-- @end -->`);

    const $ = (s) => root.querySelector(s);
    pages = [$('.p2'), $('.p3')];
    edges = [$('.e2'), $('.e3')];
    folioNo = $('.pg');

    const up = (sel, at, extra = {}) => tl.add(sel, { translateY: ['110%', '0%'], duration: 1100, ...extra }, at);
    tl = createTimeline({ autoplay: false, defaults: { ease: 'outQuart', duration: 1000 } });
    // @gfx masthead folio
    tl.add('.r-mast', { scaleX: [0, 1], ease: 'inOutQuart', duration: 900, delay: stagger(120) }, 0)
      .add('.r-folio', { scaleX: [0, 1], ease: 'inOutQuart', duration: 900 }, 150);
    up('.mk > span', 350, { duration: 900, delay: stagger(150) });
    up('.fo > span', 450, { duration: 900, delay: stagger(150) });
    // @end
    // @gfx headline
    up('.headline .w > span', 250, { delay: stagger(140) });
    tl.add('.r-head', { scaleX: [0, 1], ease: 'inOutQuart', duration: 900 }, 800);
    // @end
    // @gfx columns
    tl.add('.vrule', { scaleY: [0, 1], ease: 'inOutQuart', duration: 800, delay: stagger(200) }, 1250);
    up('.cl > span', 1350, { duration: 1000, delay: stagger(110) });
    // @end
    // @gfx page-2 numeral
    tl.add(turn2, { p: [0, 1], ease: 'inOutQuart', duration: 900 }, 3000);
    up('.nm > span', 3350, { duration: 1100 });
    tl.add('.numeral', { scale: [1, 1.02], ease: 'inOutSine', duration: 1500 }, 3350);
    up('.fg > span', 3500, { duration: 1000, delay: stagger(150) });
    tl.add('.r-fig', { scaleX: [0, 1], ease: 'inOutQuart', duration: 800 }, 3550);
    // @end
    // @gfx page-3 wordmark tagline
    tl.add(turn3, { p: [0, 1], ease: 'inOutQuart', duration: 750 }, 4250);
    up('.wl > span', 4600, { duration: 900 });
    tl.add('.r-end', { scaleX: [0, 1], ease: 'inOutQuart', duration: 800 }, 4750);
    up('.tg > span', 4850, { duration: 800 });
    // @end
    tl.seek(tl.duration); // prime (animejs skill, seek pitfalls)
    tl.seek(0);
  },

  render(t) {
    tl.seek(0);
    tl.seek(t * 1000);
    const W = pages[0].offsetWidth;
    // page turns: the new page wipes in right → left, a rule + soft shade on its leading edge
    [turn2, turn3].forEach((o, i) => {
      const x = (1 - o.p) * 100;
      pages[i].style.clipPath = `inset(0 0 0 ${x.toFixed(3)}%)`;
      edges[i].style.opacity = o.p > 0 && o.p < 1 ? '1' : '0';
      edges[i].style.transform = `translateX(${((1 - o.p) * W).toFixed(2)}px)`;
    });
    // @gfx folio
    folioNo.textContent = String(1 + (turn2.p >= 0.5 ? 1 : 0) + (turn3.p >= 0.5 ? 1 : 0));
    // @end
  },
};
