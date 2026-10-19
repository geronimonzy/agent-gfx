// Clean dark: the look test card (templates/looks/_sample/BRIEF.md).
// Motion: outExpo entrances 600-700 ms with short slides (40-60 px), inOutCubic moves, cross-fades between beats,
// lines that draw on, a slowly drifting grid. One warm accent, only on the focal number.
import { createTimeline, stagger, svg } from 'animejs';
import { gridCss } from '/runner/lib/style.js';

const ITEMS = [
  { n: '01', name: 'Plan', note: 'one idea per beat' },
  { n: '02', name: 'Build', note: 'scenes as code' },
  { n: '03', name: 'Review', note: 'comments on frames' },
];
const W = 1920;
const H = 1080;
const R = 250; // ring radius (accent beat)
const C = { n: 0 }; // counter value
let tl;
let el = {};

export default {
  setup({ root, style }) {
    const rad = style.radius;
    const css = `
      .cd{position:absolute;font-family:var(--gfx-font-sans);color:var(--gfx-text)}
      .mono{font-family:var(--gfx-font-mono)}
      /* @gfx headline */
      .head{left:0;width:${W}px;top:400px;text-align:center;font:600 104px var(--gfx-font-sans);letter-spacing:-0.025em;line-height:1.1}
      .head .w{display:inline-block;margin:0 .14em}
      .head-line{position:absolute;left:${W / 2 - 240}px;top:560px;width:480px;height:2px;background:var(--gfx-border);transform-origin:center}
      /* @end */
      /* @gfx items */
      .card{position:absolute;top:600px;width:400px;height:200px;box-sizing:border-box;padding:36px 40px;
        background:var(--gfx-surface);border:1.5px solid var(--gfx-border);border-radius:${rad}px}
      .card .n{font:500 26px var(--gfx-font-mono);color:var(--gfx-muted)}
      .card .t{margin-top:24px;font:600 56px var(--gfx-font-sans);letter-spacing:-0.02em;line-height:1}
      .card .s{margin-top:14px;font:400 26px var(--gfx-font-sans);color:var(--gfx-muted)}
      /* @end */
      /* @gfx counter */
      .num{left:0;width:${W}px;top:${H / 2 - 110}px;text-align:center;font:500 200px var(--gfx-font-mono);color:var(--gfx-accent);line-height:1;letter-spacing:-0.03em}
      .numlbl{left:0;width:${W}px;top:${H / 2 + 104}px;text-align:center;font:400 34px var(--gfx-font-sans);color:var(--gfx-muted)}
      /* @end */
      /* @gfx endcard */
      .word{left:0;width:${W}px;top:380px;text-align:center;font:700 180px var(--gfx-font-sans);letter-spacing:-0.04em;line-height:1}
      .tag{left:0;width:${W}px;top:640px;text-align:center;font:400 36px var(--gfx-font-mono);color:var(--gfx-muted)}
      .end-line{position:absolute;left:${W / 2 - 160}px;top:610px;width:320px;height:2px;background:var(--gfx-border);transform-origin:center}
      /* @end */
    `;
    const cardX = (i) => W / 2 - 680 + i * 480;

    root.insertAdjacentHTML(
      'beforeend',
      `<style>${css}</style>
       <!-- @gfx background -->
       <div data-gfx="background" style="position:absolute;inset:0"></div>
       <!-- @end -->
       <!-- @gfx headline -->
       <div data-gfx="headline" style="position:absolute;inset:0">
         <div class="cd head">${'Make it move'.split(' ').map((w) => `<span class="w">${w}</span>`).join('')}</div>
         <div class="head-line"></div>
       </div>
       <!-- @end -->
       <!-- @gfx items -->
       <div data-gfx="items" style="position:absolute;inset:0">
         <svg style="position:absolute;inset:0;overflow:visible" width="${W}" height="${H}">
           <path class="link" d="M ${cardX(0) + 400} 700 H ${cardX(1)} M ${cardX(1) + 400} 700 H ${cardX(2)}" stroke="${style.colors.muted}" stroke-width="2" fill="none"/>
         </svg>
         ${ITEMS.map((it, i) => `<div class="cd card" style="left:${cardX(i)}px"><div class="n">${it.n}</div><div class="t">${it.name}</div><div class="s">${it.note}</div></div>`).join('')}
       </div>
       <!-- @end -->
       <!-- @gfx counter -->
       <div data-gfx="counter" style="position:absolute;inset:0;opacity:0">
         <svg style="position:absolute;inset:0;overflow:visible" width="${W}" height="${H}">
           <circle cx="${W / 2}" cy="${H / 2}" r="${R}" stroke="${style.colors.grid}" stroke-width="2" fill="none"/>
           <circle class="ring" cx="${W / 2}" cy="${H / 2}" r="${R}" stroke="${style.colors.accent}" stroke-width="3" fill="none" stroke-linecap="round" transform="rotate(-90 ${W / 2} ${H / 2})"/>
         </svg>
         <div class="cd num">0</div>
         <div class="cd numlbl">frames per idea</div>
       </div>
       <!-- @end -->
       <!-- @gfx endcard -->
       <div data-gfx="endcard" style="position:absolute;inset:0">
         <div class="cd word">gfx</div>
         <div class="end-line"></div>
         <div class="cd tag">motion, reviewed</div>
       </div>
       <!-- @end -->`,
    );

    const q = (s) => root.querySelector(s);
    // @gfx background
    el.bg = q('[data-gfx="background"]');
    Object.assign(el.bg.style, gridCss(style));
    el.bg.style.inset = '-160px'; // room for the drift
    // major lines (every 160 px) as 1 px borders: Chrome keeps a border at least one device pixel wide, so the grid still
    // reads in the 0.25-scale thumbnail (the gradient hairlines vanish there)
    const lines = [];
    for (let x = 0; x < W + 320; x += 160) lines.push(`<div style="position:absolute;top:0;bottom:0;left:${x}px;border-left:1px solid ${style.colors.gridStrong}"></div>`);
    for (let y = 0; y < H + 320; y += 160) lines.push(`<div style="position:absolute;left:0;right:0;top:${y}px;border-top:1px solid ${style.colors.gridStrong}"></div>`);
    el.bg.insertAdjacentHTML('afterbegin', lines.join(''));
    // @end
    el.num = q('.num');

    const [link] = svg.createDrawable('.link');
    const [ring] = svg.createDrawable('.ring');
    const { out, inOut } = style.ease;

    tl = createTimeline({ autoplay: false, defaults: { ease: out, duration: 700 } })
      // @gfx headline
      .add('.head .w', { opacity: [0, 1], translateY: [48, 0], delay: stagger(70) }, 150)
      .add('.head-line', { scaleX: [0, 1], duration: 800, ease: inOut }, 450)
      // beat 2: the headline moves up and settles smaller (one inOutCubic move)
      .add('[data-gfx="headline"]', { translateY: [0, -170], scale: [1, 0.8], duration: 700, ease: inOut }, 1300)
      .add('.head-line', { opacity: [1, 0], duration: 400, ease: inOut }, 1300)
      // @end
      // @gfx items
      .add('.card', { opacity: [0, 1], translateX: [60, 0], delay: stagger(70) }, 1550)
      .add(link, { draw: ['0 0', '0 1'], duration: 900, ease: inOut }, 1900)
      // beat 3: cross-fade out with a short slide left (one direction of travel)
      .add('[data-gfx="items"]', { opacity: [1, 0], translateX: [0, -40], duration: 400, ease: inOut }, 3150)
      // @end
      // @gfx headline
      .add('[data-gfx="headline"] .head', { opacity: [1, 0], translateX: [0, -40], duration: 400, ease: inOut }, 3150)
      // @end
      // @gfx counter
      .add('[data-gfx="counter"]', { opacity: [0, 1], duration: 500, ease: inOut }, 3300)
      .add(ring, { draw: ['0 0', '0 1'], duration: 1000 }, 3300)
      .add(C, { n: [0, 24], duration: 1000 }, 3300)
      .add('.num', { translateY: [40, 0], duration: 700 }, 3300)
      .add('[data-gfx="counter"]', { opacity: [1, 0], translateX: [0, -40], duration: 350, ease: inOut }, 4400)
      // @end
      // @gfx endcard
      .add('.word', { opacity: [0, 1], translateY: [48, 0] }, 4700)
      .add('.end-line', { scaleX: [0, 1], duration: 700, ease: inOut }, 4900)
      .add('.tag', { opacity: [0, 1], translateY: [24, 0] }, 5000);
      // @end
    tl.seek(tl.duration); // prime (animejs skill, "Seek pitfalls")
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);
    // @gfx background
    // slow drift (12 px/s down-right) so held frames never go fully static; pure function of t
    el.bg.style.transform = `translate(${(t * 12) % 160}px, ${(t * 12) % 160}px)`;
    // @end
    // @gfx counter
    el.num.textContent = String(Math.round(C.n));
    // @end
  },
};
