// Social square (1080x1080, anime.js). One big stat: a progress ring draws on while the number counts up, then a
// one-line label and a brand footer. Named elements (data-gfx) are selectable in the studio; cues drive `gfx audio`.
// `@gfx <name>` … `@end` comments mark each named element's code (markup, CSS, tweens, cues): the studio's
// "Open code" shows exactly those blocks. Comments only, they never change the picture.
import { createTimeline, stagger, svg } from 'animejs';
import { gridCss } from '/runner/lib/style.js';
import { countTicks } from '/runner/lib/sfx.js';

// ---------- copy: edit these ----------
const TAG = 'Survey 2026';
const VALUE = 87; // 0..100: the number and how far the ring fills
const SUFFIX = '%';
const DELTA = '+12 pts vs 2025';
const LABEL = 'of teams ship faster with async reviews';
const HANDLE = '@orbit.app';
const SOURCE = 'Source: State of Work 2026';

// ---------- timing (ms): retime beats here; cues follow ----------
const T = {
  tag: 150,
  ring: 300,
  fill: 650,
  fillEnd: 2250,
  delta: 2400,
  label: 2600,
  footer: 3050,
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

let tl;
const counter = { v: 0 };
let numEl, knobEl;
let CX, R;

export default {
  setup(ctx) {
    const { root, style, width: W, height: H } = ctx;
    const M = 88; // outer margin (8%)
    R = 236; // ring radius
    const STROKE = 26;
    const S = 2 * (R + 64); // ring svg box
    CX = S / 2;
    const ringTop = 168; // top of the ring box
    const cy = ringTop + S / 2; // ring centre in frame px
    const TICKS = 72;

    const ticks = Array.from({ length: TICKS }, (_, i) => {
      const a = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
      const major = i % 6 === 0;
      const r0 = R + 30, r1 = R + (major ? 50 : 40);
      const p = (r) => `${(CX + r * Math.cos(a)).toFixed(2)} ${(CX + r * Math.sin(a)).toFixed(2)}`;
      return `<path class="tk${major ? ' major' : ''}" d="M${p(r0)} L${p(r1)}"/>`;
    }).join('');
    const circle = `M${CX} ${CX - R} A${R} ${R} 0 1 1 ${CX} ${CX + R} A${R} ${R} 0 1 1 ${CX} ${CX - R}`;

    root.insertAdjacentHTML(
      'beforeend',
      `<style>
        .sq{font-family:var(--gfx-font-sans);color:var(--gfx-text)}
        /* @gfx glow */
        [data-gfx="glow"]{position:absolute;left:${W / 2 - 520}px;top:${cy - 520}px;width:1040px;height:1040px;border-radius:50%;
          background:radial-gradient(circle,color-mix(in srgb,var(--gfx-accent) 13%,transparent) 0%,transparent 60%)}
        /* @end */
        /* @gfx tag */
        [data-gfx="tag"]{position:absolute;left:${M}px;top:${M}px;display:flex;align-items:center;gap:12px;padding:12px 22px 12px 18px;
          border-radius:999px;background:var(--gfx-surface);border:1px solid var(--gfx-border);font:500 24px var(--gfx-font-mono);
          letter-spacing:.08em;text-transform:uppercase;color:var(--gfx-muted)}
        [data-gfx="tag"] i{width:12px;height:12px;border-radius:50%;background:var(--gfx-accent2)}
        /* @end */
        /* @gfx ring */
        [data-gfx="ring"]{position:absolute;left:${(W - S) / 2}px;top:${ringTop}px;width:${S}px;height:${S}px;overflow:visible}
        .track{fill:none;stroke:var(--gfx-surface-raised);stroke-width:${STROKE}}
        .arc{fill:none;stroke:var(--gfx-accent);stroke-width:${STROKE};stroke-linecap:round}
        .ripple{fill:none;stroke:var(--gfx-accent);stroke-width:4;transform-origin:${CX}px ${CX}px}
        .knob-halo{fill:var(--gfx-accent);opacity:.25}
        .knob-dot{fill:var(--gfx-text)}
        /* @end */
        /* @gfx dial */
        [data-gfx="dial"]{transform-origin:${CX}px ${CX}px}
        .tk{stroke:var(--gfx-border);stroke-width:3;stroke-linecap:round}
        .tk.major{stroke:var(--gfx-muted)}
        /* @end */
        .center{position:absolute;left:0;right:0;top:${cy}px;height:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        /* @gfx stat */
        [data-gfx="stat"]{display:flex;align-items:flex-start;font-weight:700;font-size:208px;line-height:1;letter-spacing:-0.055em;
          font-variant-numeric:tabular-nums;margin-top:-24px}
        [data-gfx="stat"] .suf{font-size:104px;margin-top:22px;margin-left:8px;letter-spacing:-0.02em;color:var(--gfx-accent)}
        /* @end */
        /* @gfx delta */
        [data-gfx="delta"]{margin-top:18px;padding:8px 18px;border-radius:999px;font:500 24px var(--gfx-font-mono);
          color:var(--gfx-accent2);background:color-mix(in srgb,var(--gfx-accent2) 14%,transparent)}
        /* @end */
        /* @gfx label */
        [data-gfx="label"]{position:absolute;left:${M}px;right:${M}px;top:${ringTop + S + 18}px;text-align:center;font-size:44px;
          font-weight:500;letter-spacing:-0.015em;line-height:1.2;white-space:nowrap}
        [data-gfx="label"] span{display:inline-block;white-space:pre}
        /* @end */
        .footer{position:absolute;left:${M}px;right:${M}px;bottom:${M - 20}px;display:flex;align-items:center;justify-content:space-between;
          padding-top:28px}
        .footer .rule{position:absolute;left:0;right:0;top:0;height:2px;background:var(--gfx-border);transform-origin:left}
        /* @gfx handle */
        [data-gfx="handle"]{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;letter-spacing:-0.01em}
        [data-gfx="handle"] svg{width:40px;height:40px}
        /* @end */
        /* @gfx source */
        [data-gfx="source"]{font:400 22px var(--gfx-font-mono);color:var(--gfx-muted)}
        /* @end */
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" style="position:absolute;inset:0"></div>
      <!-- @end -->
      <!-- @gfx glow -->
      <div data-gfx="glow"></div>
      <!-- @end -->
      <div class="sq">
        <!-- @gfx tag -->
        <div data-gfx="tag"><i></i>${esc(TAG)}</div>
        <!-- @end -->
        <!-- @gfx ring -->
        <svg data-gfx="ring" viewBox="0 0 ${S} ${S}">
          <!-- @end -->
          <!-- @gfx dial -->
          <g data-gfx="dial">${ticks}</g>
          <!-- @end -->
          <!-- @gfx ring -->
          <circle class="track" cx="${CX}" cy="${CX}" r="${R}"/>
          <circle class="ripple" cx="${CX}" cy="${CX}" r="${R}"/>
          <path class="arc" d="${circle}"/>
          <g class="knob"><circle class="knob-halo" r="30"/><circle class="knob-dot" r="7"/></g>
        </svg>
        <!-- @end -->
        <div class="center">
          <!-- @gfx stat -->
          <div data-gfx="stat"><span class="num">0</span><span class="suf">${esc(SUFFIX)}</span></div>
          <!-- @end -->
          <!-- @gfx delta -->
          <div data-gfx="delta">${esc(DELTA)}</div>
          <!-- @end -->
        </div>
        <!-- @gfx label -->
        <div data-gfx="label">${LABEL.split(' ').map((w) => `<span>${esc(w)} </span>`).join('')}</div>
        <!-- @end -->
        <div class="footer"><div class="rule"></div>
          <!-- @gfx handle -->
          <div data-gfx="handle"><svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="27" fill="var(--gfx-accent)"/>
            <circle cx="60" cy="60" r="46" fill="none" stroke="var(--gfx-text)" stroke-width="8"/>
            <circle cx="92.5" cy="27.5" r="11" fill="var(--gfx-accent2)" stroke="var(--gfx-bg)" stroke-width="6"/></svg>${esc(HANDLE)}</div>
          <!-- @end -->
          <!-- @gfx source -->
          <div data-gfx="source">${esc(SOURCE)}</div>
          <!-- @end -->
        </div>
      </div>`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style)); // first child = bottom layer
    // @end

    numEl = root.querySelector('[data-gfx="stat"] .num');
    knobEl = root.querySelector('.knob');
    const [arc] = svg.createDrawable(root.querySelector('.arc'));
    const p = VALUE / 100;
    const fillDur = T.fillEnd - T.fill;

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } })
      // @gfx glow
      .add('[data-gfx="glow"]', { opacity: [0, 1], scale: [0.7, 1], duration: 2400, ease: 'outCubic' }, T.ring)
      // @end
      // @gfx tag
      .add('[data-gfx="tag"]', { opacity: [0, 1], translateY: [-20, 0] }, T.tag)
      // @end
      // @gfx dial
      .add('.tk', { opacity: [0, 1], duration: 500, ease: 'outCubic', delay: stagger(6) }, T.ring)
      .add('[data-gfx="dial"]', { rotate: [-30, 8], duration: 6000 - T.ring, ease: 'outCubic' }, T.ring)
      // @end
      // @gfx ring
      .add('.track', { opacity: [0, 1], duration: 800, ease: 'outCubic' }, T.ring)
      .add('[data-gfx="ring"]', { scale: [0.9, 1], duration: 1200 }, T.ring)
      .add('.arc', { opacity: [0, 1], duration: 80, ease: 'linear' }, T.fill)
      .add('.knob', { opacity: [0, 1], duration: 200, ease: 'linear' }, T.fill)
      .add(arc, { draw: ['0 0', `0 ${p}`], duration: fillDur, ease: 'inOutCubic' }, T.fill)
      .add('.ripple', { opacity: [0, 0.7, 0], scale: [1, 1.22], duration: 900, ease: 'outCubic' }, T.fillEnd)
      // @end
      // @gfx stat
      .add('[data-gfx="stat"]', { opacity: [0, 1], scale: [0.85, 1], duration: 900 }, T.fill - 150)
      .add(counter, { v: [0, VALUE], duration: fillDur, ease: 'inOutCubic' }, T.fill)
      .add('[data-gfx="stat"]', { scale: [1, 1.06, 1], duration: 600, ease: 'outCubic' }, T.fillEnd)
      // @end
      // @gfx delta
      .add('[data-gfx="delta"]', { opacity: [0, 1], translateY: [16, 0], scale: [0.85, 1], duration: 650, ease: 'outBack(1.8)' }, T.delta)
      // @end
      // @gfx label
      .add('[data-gfx="label"] span', { opacity: [0, 1], translateY: [36, 0], duration: 800, delay: stagger(55) }, T.label)
      // @end
      .add('.footer .rule', { scaleX: [0, 1], duration: 900, ease: 'inOutCubic' }, T.footer)
      // @gfx handle
      .add('[data-gfx="handle"]', { opacity: [0, 1], translateX: [-24, 0], duration: 800 }, T.footer + 250)
      // @end
      // @gfx source
      .add('[data-gfx="source"]', { opacity: [0, 1], translateX: [24, 0], duration: 800 }, T.footer + 350);
      // @end

    // sound cues at the moments things land (t in seconds; computed from the same timings as the tweens)
    const s = (ms) => ms / 1000;
    // @gfx tag
    ctx.cue(s(T.tag + 120), 'tick', { id: 'tag', gain: -10, x: M + 100 });
    // @end
    // @gfx ring
    ctx.cue(s(T.ring + 150), 'whoosh', { id: 'ring-in', variant: 'air', dur: 0.6, gain: -8 });
    // @end
    // @gfx stat
    countTicks(s(T.fill), s(T.fillEnd), 13, 'inOutCubic')
      .slice(0, -1)
      .forEach((tt, i) => ctx.cue(tt, 'tick', { id: `count-${i + 1}`, gain: -15, pitch: Math.floor(i / 2) }));
    ctx.cue(s(T.fillEnd), 'ding', { id: 'stat-ding', gain: -3 });
    ctx.cue(s(T.fillEnd), 'impact', { id: 'stat-hit', variant: 'thud', intensity: 0.45, gain: -4 });
    // @end
    // @gfx delta
    ctx.cue(s(T.delta + 150), 'pop', { id: 'delta', pitch: 7, gain: -8 });
    // @end
    // @gfx label
    ctx.cue(s(T.label + 200), 'whoosh', { id: 'label', variant: 'swipe', dur: 0.45, gain: -12 });
    // @end
    // @gfx handle
    ctx.cue(s(T.footer + 350), 'pop', { id: 'handle', pitch: 4, gain: -12, x: M + 120 });
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
    // number and knob derived from the animated counter (same ease + timing as the arc)
    numEl.textContent = String(Math.round(counter.v));
    const a = (counter.v / 100) * Math.PI * 2 - Math.PI / 2;
    knobEl.setAttribute('transform', `translate(${(CX + R * Math.cos(a)).toFixed(2)} ${(CX + R * Math.sin(a)).toFixed(2)})`);
  },
};
