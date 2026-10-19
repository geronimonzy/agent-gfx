// Product promo (1920x1080, anime.js). A fictional app, "Orbit": headline, app window with tasks, feature chips,
// a stat counter, then an end card with logo + CTA. Named elements (data-gfx) are selectable in the studio; cues
// drive `gfx audio`. `@gfx <name>` … `@end` comments mark each named element's code (markup, CSS, tweens, cues):
// the studio's "Open code" shows exactly those blocks. Comments only, they never change the picture.
import { createTimeline, stagger, svg } from 'animejs';
import { gridCss } from '/runner/lib/style.js';
import { pentatonic, countTicks } from '/runner/lib/sfx.js';

// ---------- copy: edit these ----------
const PRODUCT = 'Orbit';
const EYEBROW = 'New · Orbit 2.0';
const HEADLINE = ['Plan your week', 'in one place.'];
const HIGHLIGHT = 'one place.'; // part of the headline drawn in the accent colour ('' = none)
const SUBHEAD = 'Tasks, calendar and notes, finally together.';
const CHIPS = ['Smart scheduling', 'Shared boards', 'Focus mode'];
const WINDOW_TITLE = 'Orbit — Week 42';
const LIST_TITLE = 'This week';
const TASKS = [
  // [title, tag, when, done at start]
  ['Design review', 'Product', 'Mon 10:00', true],
  ['Ship onboarding v2', 'Eng', 'Tue 14:00', false], // gets checked off at CHECK_AT
  ['Team sync', 'Team', 'Wed 09:30', false],
  ['Write launch notes', 'Marketing', 'Thu 11:00', false],
  ['Plan Q4 roadmap', 'Product', 'Fri 16:00', false],
];
const DONE = 12; // "12 of 18 done" before the check, +1 after
const TOTAL = 18;
const STAT = { value: 38, prefix: '+', suffix: '%', label: ['more tasks done', 'every week'] };
const TAGLINE = 'Your week, finally in one orbit.';
const CTA = 'Start free at orbit.app';

// ---------- timing (ms): retime beats here; cues follow ----------
const T = {
  eyebrow: 150,
  headline: 300,
  subhead: 850,
  window: 1000,
  rows: 1500,
  chips: 2200,
  check: 2900,
  stat: 3100,
  count: 3250,
  countEnd: 4250,
  exit: 4650,
  logo: 4950,
  word: 5200,
  tagline: 5450,
  cta: 5650,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hl = (line) =>
  HIGHLIGHT && line.includes(HIGHLIGHT)
    ? esc(line).replace(esc(HIGHLIGHT), `<span class="hl-accent">${esc(HIGHLIGHT)}</span>`)
    : esc(line);

const ICONS = [
  // clock, boards, focus (24x24, stroke = currentColor)
  '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
];

let tl;
const counter = { v: 0 };
const check = { p: 0 };
let statEl, doneEl;

export default {
  setup(ctx) {
    const { root, style, width: W, height: H } = ctx;
    const M = Math.round(W * 0.0667); // 128 px side margin
    const WIN = { w: 800, h: 560, x: W - M - 800, y: (H - 560) / 2 };

    root.insertAdjacentHTML(
      'beforeend',
      `<style>
        .promo{font-family:var(--gfx-font-sans);color:var(--gfx-text)}
        .shot{position:absolute;inset:0}
        /* @gfx glow */
        [data-gfx="glow"]{position:absolute;width:1500px;height:1500px;left:${W - 1050}px;top:-560px;border-radius:50%;
          background:radial-gradient(circle,color-mix(in srgb,var(--gfx-accent) 14%,transparent) 0%,transparent 62%)}
        /* @end */
        .copy{position:absolute;left:${M}px;top:0;bottom:0;width:${WIN.x - M - 64}px;display:flex;flex-direction:column;
          justify-content:center;align-items:flex-start}
        /* @gfx eyebrow */
        [data-gfx="eyebrow"]{display:flex;align-items:center;gap:12px;padding:10px 20px 10px 16px;border-radius:999px;
          background:var(--gfx-surface);border:1px solid var(--gfx-border);font:500 20px var(--gfx-font-mono);
          letter-spacing:.08em;text-transform:uppercase;color:var(--gfx-muted);margin-bottom:36px}
        [data-gfx="eyebrow"] i{width:10px;height:10px;border-radius:50%;background:var(--gfx-accent)}
        /* @end */
        /* @gfx headline */
        [data-gfx="headline"]{font-weight:700;font-size:96px;line-height:1.04;letter-spacing:-0.035em}
        .hl-mask{display:block;overflow:hidden;padding-bottom:.12em;margin-bottom:-.12em}
        .hl-line{display:block;white-space:nowrap}
        .hl-accent{color:var(--gfx-accent)}
        /* @end */
        /* @gfx subhead */
        [data-gfx="subhead"]{margin-top:32px;font-size:34px;line-height:1.35;font-weight:400;color:var(--gfx-muted);
          max-width:780px;letter-spacing:-0.01em}
        /* @end */
        /* @gfx chips */
        [data-gfx="chips"]{display:flex;flex-wrap:wrap;gap:14px;margin-top:52px}
        .chip{display:flex;align-items:center;gap:12px;padding:14px 22px 14px 18px;border-radius:999px;
          background:var(--gfx-surface-raised);border:1px solid var(--gfx-border);font-size:24px;font-weight:500}
        .chip svg{width:26px;height:26px;fill:none;stroke:var(--gfx-accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
        /* @end */
        /* @gfx window */
        .win-float{position:absolute;left:${WIN.x}px;top:${WIN.y}px;width:${WIN.w}px;height:${WIN.h}px}
        [data-gfx="window"]{position:absolute;inset:0;border-radius:24px;background:var(--gfx-surface);
          border:1px solid var(--gfx-border);box-shadow:0 40px 120px rgb(0 0 0 / .5);overflow:hidden}
        .titlebar{height:56px;display:flex;align-items:center;padding:0 22px;gap:10px;border-bottom:1px solid var(--gfx-border);
          background:var(--gfx-surface-raised)}
        .titlebar i{width:14px;height:14px;border-radius:50%;background:var(--gfx-border)}
        .titlebar span{flex:1;text-align:center;margin-right:62px;font:500 18px var(--gfx-font-mono);color:var(--gfx-muted)}
        .list-head{display:flex;align-items:flex-end;justify-content:space-between;padding:30px 36px 22px}
        .list-head h3{margin:0;font-size:36px;font-weight:700;letter-spacing:-0.02em}
        .progress{display:flex;flex-direction:column;align-items:flex-end;gap:10px;font:500 18px var(--gfx-font-mono);color:var(--gfx-muted)}
        .bar{width:220px;height:8px;border-radius:4px;background:var(--gfx-border);overflow:hidden}
        .bar b{display:block;height:100%;width:100%;background:var(--gfx-accent2);transform-origin:left;transform:scaleX(0)}
        /* @end */
        /* @gfx rows */
        [data-gfx="rows"]{padding:0 20px}
        .row{display:flex;align-items:center;gap:20px;height:78px;padding:0 16px;border-top:1px solid var(--gfx-border)}
        .box{position:relative;width:28px;height:28px;border-radius:50%;border:2px solid var(--gfx-muted);flex:none}
        .box .fill{position:absolute;inset:-2px;border-radius:50%;background:var(--gfx-accent2);transform:scale(0)}
        .box.done .fill{transform:scale(1)}
        .box svg{position:absolute;inset:2px;fill:none;stroke:var(--gfx-bg);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
        .row .title{flex:1;font-size:26px;font-weight:500}
        .row.done .title{opacity:.45}
        .tag{font:500 16px var(--gfx-font-mono);letter-spacing:.04em;padding:6px 12px;border-radius:8px;
          color:var(--gfx-accent-soft);background:color-mix(in srgb,var(--gfx-accent) 14%,transparent)}
        .tag.t1{color:var(--gfx-accent2);background:color-mix(in srgb,var(--gfx-accent2) 14%,transparent)}
        .when{width:120px;text-align:right;font:400 18px var(--gfx-font-mono);color:var(--gfx-muted)}
        /* @end */
        /* @gfx stat */
        [data-gfx="stat"]{position:absolute;right:${M - 32}px;top:${WIN.y + WIN.h - 96}px;display:flex;align-items:center;
          gap:24px;padding:26px 34px;border-radius:22px;background:var(--gfx-surface-raised);border:1px solid var(--gfx-border);
          box-shadow:0 30px 80px rgb(0 0 0 / .55)}
        [data-gfx="stat"] .num{font-size:76px;font-weight:700;letter-spacing:-0.04em;color:var(--gfx-accent);
          font-variant-numeric:tabular-nums;min-width:190px}
        [data-gfx="stat"] .lbl{font-size:24px;line-height:1.3;color:var(--gfx-muted)}
        /* @end */
        .end{display:flex;flex-direction:column;align-items:center;justify-content:center}
        /* @gfx logo */
        [data-gfx="logo"]{width:176px;height:176px;margin-bottom:36px}
        [data-gfx="logo"] svg{width:100%;height:100%;overflow:visible}
        .sat{transform-origin:60px 60px}
        /* @end */
        /* @gfx wordmark */
        [data-gfx="wordmark"]{display:flex;overflow:hidden;padding-bottom:.08em;font-size:150px;font-weight:700;
          letter-spacing:-0.05em;line-height:1}
        [data-gfx="wordmark"] span{display:inline-block}
        /* @end */
        /* @gfx tagline */
        [data-gfx="tagline"]{margin-top:24px;font-size:40px;color:var(--gfx-muted);letter-spacing:-0.01em}
        /* @end */
        /* @gfx cta */
        [data-gfx="cta"]{margin-top:56px;display:flex;align-items:center;gap:16px;padding:22px 40px;border-radius:999px;
          background:var(--gfx-accent);color:var(--gfx-bg);font-size:32px;font-weight:600;letter-spacing:-0.01em}
        [data-gfx="cta"] svg{width:30px;height:30px;fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
        /* @end */
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" style="position:absolute;inset:0"></div>
      <!-- @end -->
      <!-- @gfx glow -->
      <div data-gfx="glow"></div>
      <!-- @end -->
      <div class="promo shot shot1">
        <div class="copy">
          <!-- @gfx eyebrow -->
          <div data-gfx="eyebrow"><i></i>${esc(EYEBROW)}</div>
          <!-- @end -->
          <!-- @gfx headline -->
          <div data-gfx="headline">${HEADLINE.map((l) => `<span class="hl-mask"><span class="hl-line">${hl(l)}</span></span>`).join('')}</div>
          <!-- @end -->
          <!-- @gfx subhead -->
          <div data-gfx="subhead">${esc(SUBHEAD)}</div>
          <!-- @end -->
          <!-- @gfx chips -->
          <div data-gfx="chips">${CHIPS.map((c, i) => `<div class="chip"><svg viewBox="0 0 24 24">${ICONS[i % ICONS.length]}</svg>${esc(c)}</div>`).join('')}</div>
          <!-- @end -->
        </div>
        <div class="win-float">
          <!-- @gfx window -->
          <div data-gfx="window">
            <div class="titlebar"><i></i><i></i><i></i><span>${esc(WINDOW_TITLE)}</span></div>
            <div class="list-head"><h3>${esc(LIST_TITLE)}</h3>
              <div class="progress"><span class="done-count">${DONE} of ${TOTAL} done</span><div class="bar"><b></b></div></div>
            </div>
            <!-- @end -->
            <!-- @gfx rows -->
            <div data-gfx="rows">${TASKS.map(
              ([title, tag, when, done], i) => `<div class="row${done ? ' done' : ''}" data-row="${i}">
                <div class="box${done ? ' done' : ''}"><div class="fill"><svg viewBox="0 0 20 20"><path d="M5 10.5l3.2 3.2L15 7"/></svg></div></div>
                <div class="title">${esc(title)}</div><div class="tag${i % 2 ? '' : ' t1'}">${esc(tag)}</div><div class="when">${esc(when)}</div>
              </div>`,
            ).join('')}</div>
            <!-- @end -->
          </div>
        </div>
        <!-- @gfx stat -->
        <div data-gfx="stat"><div class="num">${STAT.prefix}0${STAT.suffix}</div><div class="lbl">${STAT.label.map(esc).join('<br>')}</div></div>
        <!-- @end -->
      </div>
      <div class="promo shot shot2 end">
        <!-- @gfx logo -->
        <div data-gfx="logo"><svg viewBox="0 0 120 120">
          <circle class="planet" cx="60" cy="60" r="27" fill="var(--gfx-accent)"/>
          <path class="ring" d="M60 14 A46 46 0 1 1 59.99 14" fill="none" stroke="var(--gfx-text)" stroke-width="4.5" stroke-linecap="round"/>
          <g class="sat"><circle cx="92.5" cy="27.5" r="8.5" fill="var(--gfx-accent2)" stroke="var(--gfx-bg)" stroke-width="4"/></g>
        </svg></div>
        <!-- @end -->
        <!-- @gfx wordmark -->
        <div data-gfx="wordmark">${Array.from(PRODUCT).map((c) => `<span>${esc(c)}</span>`).join('')}</div>
        <!-- @end -->
        <!-- @gfx tagline -->
        <div data-gfx="tagline">${esc(TAGLINE)}</div>
        <!-- @end -->
        <!-- @gfx cta -->
        <div data-gfx="cta">${esc(CTA)}<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg></div>
        <!-- @end -->
      </div>`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style)); // first child = bottom layer
    // @end

    const q = (s) => root.querySelector(s);
    statEl = q('[data-gfx="stat"] .num');
    doneEl = q('.done-count');
    const [ring] = svg.createDrawable(q('[data-gfx="logo"] .ring'));
    const checkRow = q('.row[data-row="1"]');
    const rowX = WIN.x + WIN.w / 2; // pan position for the window's sounds

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } })
      // @gfx glow
      .add('[data-gfx="glow"]', { opacity: [0, 1], duration: 1400, ease: 'outCubic' }, 0)
      .add('[data-gfx="glow"]', { translateX: [-80, 80], translateY: [0, 40], duration: 8000, ease: 'linear' }, 0)
      // @end
      // @gfx eyebrow
      .add('[data-gfx="eyebrow"]', { opacity: [0, 1], translateY: [20, 0] }, T.eyebrow)
      // @end
      // @gfx headline
      .add('.hl-line', { translateY: ['110%', '0%'], duration: 1000, delay: stagger(110) }, T.headline)
      // @end
      // @gfx subhead
      .add('[data-gfx="subhead"]', { opacity: [0, 1], translateY: [24, 0], duration: 800 }, T.subhead)
      // @end
      // @gfx window
      .add('[data-gfx="window"]', { opacity: [0, 1], translateY: [160, 0], scale: [0.94, 1], duration: 1100 }, T.window)
      .add('.win-float', { translateY: [0, -14], duration: T.exit - T.window - 400, ease: 'inOutSine' }, T.window + 400)
      .add('.bar b', { scaleX: [0, DONE / TOTAL], duration: 900, ease: 'inOutCubic' }, T.rows + 200)
      .add('.bar b', { scaleX: [DONE / TOTAL, (DONE + 1) / TOTAL], duration: 500, ease: 'outCubic' }, T.check)
      // @end
      // @gfx rows
      .add('.row', { opacity: [0, 1], translateX: [48, 0], duration: 800, delay: stagger(70) }, T.rows)
      .add(checkRow.querySelector('.fill'), { scale: [0, 1], duration: 450, ease: 'outBack(2)' }, T.check)
      .add(checkRow.querySelector('.title'), { opacity: [1, 0.45], duration: 400, ease: 'outCubic' }, T.check)
      .add(check, { p: [0, 1], duration: 1, ease: 'linear' }, T.check)
      // @end
      // @gfx chips
      .add('.chip', { opacity: [0, 1], scale: [0.8, 1], translateY: [16, 0], duration: 650, ease: 'outBack(1.6)', delay: stagger(90) }, T.chips)
      // @end
      // @gfx stat
      .add('[data-gfx="stat"]', { opacity: [0, 1], translateY: [50, 0], scale: [0.9, 1], duration: 800, ease: 'outBack(1.3)' }, T.stat)
      .add(counter, { v: [0, STAT.value], duration: T.countEnd - T.count, ease: 'outCubic' }, T.count)
      // @end
      // shot 1 leaves together (one wrapper, so it never fights the entrances above)
      .add('.shot1', { opacity: [1, 0], scale: [1, 0.96], translateY: [0, -40], duration: 380, ease: 'inCubic' }, T.exit)
      .add('[data-gfx="glow"]', { scale: [1, 0.8], duration: 1400, ease: 'inOutCubic' }, T.exit)
      // end card: slow push-in through the hold
      .add('.shot2', { scale: [0.985, 1.02], duration: 8000 - T.logo, ease: 'outSine' }, T.logo)
      // @gfx logo
      .add('[data-gfx="logo"]', { opacity: [0, 1], scale: [0.5, 1], rotate: [-40, 0], duration: 900, ease: 'outBack(1.5)' }, T.logo)
      .add(ring, { draw: ['0 0', '0 1'], duration: 900, ease: 'inOutCubic' }, T.logo)
      .add('.sat', { rotate: [-200, 40], duration: 8000 - T.logo, ease: 'outCubic' }, T.logo)
      // @end
      // @gfx wordmark
      .add('[data-gfx="wordmark"] span', { translateY: ['105%', '0%'], duration: 900, delay: stagger(45) }, T.word)
      // @end
      // @gfx tagline
      .add('[data-gfx="tagline"]', { opacity: [0, 1], translateY: [20, 0], duration: 800 }, T.tagline)
      // @end
      // @gfx cta
      .add('[data-gfx="cta"]', { opacity: [0, 1], scale: [0.85, 1], duration: 700, ease: 'outBack(1.6)' }, T.cta);
      // @end

    // sound cues at the moments things land (t in seconds; computed from the same timings as the tweens)
    const s = (ms) => ms / 1000;
    // @gfx eyebrow
    ctx.cue(s(T.eyebrow + 120), 'tick', { id: 'eyebrow', gain: -10, x: M + 120 });
    // @end
    // @gfx headline
    ctx.cue(s(T.headline + 200), 'whoosh', { id: 'headline', variant: 'air', dur: 0.6, gain: -6, x: M + 400 });
    // @end
    // @gfx window
    ctx.cue(s(T.window + 120), 'whoosh', { id: 'window-in', variant: 'swipe', dur: 0.5, gain: -8, x: rowX });
    ctx.cue(s(T.window + 380), 'impact', { id: 'window', variant: 'thud', intensity: 0.5, x: rowX });
    // @end
    // @gfx rows
    TASKS.forEach((_, i) => ctx.cue(s(T.rows + i * 70 + 90), 'pop', { id: `row-${i + 1}`, pitch: pentatonic(i), gain: -14, x: rowX }));
    ctx.cue(s(T.check), 'click', { id: 'check', gain: -6, x: WIN.x + 70 });
    // @end
    // @gfx chips
    CHIPS.forEach((_, i) => ctx.cue(s(T.chips + i * 90 + 110), 'pop', { id: `chip-${i + 1}`, pitch: pentatonic(i + 5), gain: -10, x: M + 120 + i * 230 }));
    // @end
    // @gfx stat
    ctx.cue(s(T.stat + 100), 'whoosh', { id: 'stat-in', variant: 'zip', dur: 0.35, gain: -10, x: WIN.x + WIN.w - 200 });
    countTicks(s(T.count), s(T.countEnd), 9, 'outCubic')
      .slice(0, -1)
      .forEach((tt, i) => ctx.cue(tt, 'tick', { id: `stat-tick-${i + 1}`, gain: -15, pitch: i, x: WIN.x + WIN.w - 200 }));
    ctx.cue(s(T.countEnd), 'ding', { id: 'stat-ding', gain: -4, x: WIN.x + WIN.w - 200 });
    // @end
    // @gfx logo
    ctx.cue(s(T.logo + 300), 'rise', { id: 'rise', dur: 1.0, gain: -8 });
    ctx.cue(s(T.logo + 300), 'logo', { id: 'logo', intensity: 0.85 });
    // @end
    // @gfx cta
    ctx.cue(s(T.cta + 200), 'pop', { id: 'cta', pitch: pentatonic(7), gain: -8 });
    // @end

    // Prime: tweens that have not started never apply their `from` values, so jump to the end and back once
    // (otherwise the elements flash visible at t=0). See the animejs skill, "Seek pitfalls".
    tl.seek(tl.duration);
    tl.seek(0);
  },

  render(t) {
    // Reset, then seek: every frame is a pure function of t (scrubbing, parallel captures).
    tl.seek(0);
    tl.seek(t * 1000);
    // text derived from animated objects
    statEl.textContent = `${STAT.prefix}${Math.round(counter.v)}${STAT.suffix}`;
    doneEl.textContent = `${DONE + (check.p >= 1 ? 1 : 0)} of ${TOTAL} done`;
  },
};
