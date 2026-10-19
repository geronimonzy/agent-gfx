// _reel-test (Tally, a fictional receipt app) — 15 s, 1080x1920@60. One anime.js timeline (seeked) + pure-function bits in render(t).
// Spec: ./STORYBOARD.md. Beats land on a 0.5 s grid.
import { createTimeline } from 'animejs';
import { gridCss } from '/runner/lib/style.js';
import { progress, tween, keyframes } from '/runner/lib/tween.js';
import { outExpo, inOutCubic, inOutSine } from '/runner/lib/ease.js';
import { hash } from '/runner/lib/rng.js';
import { pentatonic, countTicks } from '/runner/lib/sfx.js';
import { html, torn, PILE, CARD_ITEMS, MEMBERS, SPLIT_ROWS, PS, PHONE, toFrame } from './markup.js';

let tl;
const R = { drift: [], floods: [] };
const ms = (s) => Math.round(s * 1000);
const CX = 540;
const CY = 960;
const PUSH = { s: 1.3, ty: -90 };

// accent floods: circular clip-path wipes. in = expand start, out = shrink start (0.3 s each)
const FLOODS = [
  { in: 1.5, out: 2.0, c0: [CX, CY], c1: [CX, CY] },
  { in: 5.0, out: 5.5, c0: [1080, CY], c1: [0, 760] },
  { in: 9.5, out: 10.0, c0: [CX, CY], c1: [CX, CY] }, // c0 patched to the Share button in setup
];
const SLAMS = [1.6, 5.1, 9.6];
const SHAKES = [1.6, 5.1, 9.6, 0.62, 0.78, 0.92, 1.05, 1.18, 1.3];
const SHAKE_AMP = [9, 9, 9, 3, 3, 4, 4, 5, 5];
const FR = 2300;
const COUNT_SETTLE = 0.9; // outExpo: fraction of a count-up after which the last visible digit has stopped changing
const LOGO_T = 12.92;
const COLLAPSE_T = 12.5;

function floodCircle(t, lead = 0, lag = 0) {
  for (const f of FLOODS) {
    const a = f.in - lead;
    const b = f.out + lag;
    if (t < a || t > b + 0.3) continue;
    if (t < a + 0.3) return [FR * inOutCubic(progress(t, a, a + 0.3)), f.c0];
    if (t < b) return [FR, f.c0];
    return [FR * (1 - inOutCubic(progress(t, b, b + 0.3))), f.c1];
  }
  return [0, [CX, CY]];
}
const circ = ([r, c]) => `circle(${r.toFixed(1)}px at ${c[0]}px ${c[1]}px)`;

export default {
  async setup(ctx) {
    const { root, style } = ctx;
    const cue = (t, sound, o) => ctx.cue(t, sound, o);
    root.style.setProperty('--n', style.fonts.num);
    root.insertAdjacentHTML('beforeend', html(style));
    R.grid = root.querySelector('.grid');
    Object.assign(R.grid.style, gridCss(style, { cell: 54, majorEvery: 4 }));
    R.gridBase = getComputedStyle(R.grid).backgroundPosition;

    const q = (s, el = root) => el.querySelector(s);
    const qa = (s, el = root) => [...el.querySelectorAll(s)];
    const screen = q('.screen');
    const rootRect = root.getBoundingClientRect();
    const floats = q('.floats');
    const ph = q('.ph');

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 600 } });
    const A = (targets, params, t) => tl.add(targets, params, ms(t));
    const fade = (el, t, from, to, dur = 250, ease = 'outCubic') => A(el, { opacity: [from, to], duration: dur, ease }, t);

    /** centre of an element in screen-local coords (layout, transform independent) */
    const at = (el) => {
      let x = el.offsetWidth / 2;
      let y = el.offsetHeight / 2;
      for (let n = el; n && n !== screen; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
      return [x, y];
    };

    // floating layer helper: .fl (timeline) > .fd (render drift) > .fi (centring)
    const live = []; // everything that must collapse into the logo at 12.5
    let fid = 0;
    function mkFloat(inner, { fi = '', amp = 1, front = false } = {}) {
      (front ? q('.front') : floats).insertAdjacentHTML('beforeend', `<div class="fl"><div class="fd"><div class="fi" style="${fi}">${inner}</div></div></div>`);
      const el = (front ? q('.front') : floats).lastElementChild;
      R.drift.push({ fd: el.firstElementChild, k: fid++, amp });
      return el;
    }

    // ============================================================ BEAT 1 · HOOK 0.0–1.5
    function beatHook() {
      qa('.pile').forEach((el, i) => {
        const p = PILE[i];
        const dir = i % 2 ? 1 : -1;
        A(el, { translateX: [p.x, p.x], translateZ: [p.z, p.z], opacity: [1, 1], duration: 1 }, 0);
        A(el, { translateY: [p.y - 950 - i * 110, p.y], rotate: [p.r + dir * 34, p.r], duration: 820, ease: 'outBack(1.15)' }, i * 0.11);
        A(el, { opacity: [1, 0], duration: 1 }, 1.95);
        // paper landing = the pile's shake time (SHAKES[3..8]); low and soft, the last one a touch louder
        cue(SHAKES[3 + i], 'pop', { id: `pile-${i}`, el: `pile-${i}`, pitch: -12 + i * 1.4, gain: i === PILE.length - 1 ? -4 : -9, x: p.x });
      });
      cue(0.4 + 0.1, 'whoosh', { id: 'hook-text', el: 'hook', gain: -10, dur: 0.3, variant: 'air', intensity: 0.3 });
      // words pop, 80 ms stagger
      qa('.hook > span').forEach((w, i) => {
        A(w, { opacity: [0, 1], translateY: [60, 0], scale: [0.55, 1], duration: 420, ease: 'outBack(1.8)' }, 0.4 + i * 0.08);
      });
      A(q('.hook'), { opacity: [1, 0], duration: 1 }, 1.95);
      A(q('.hook'), { translateY: [0, 0], duration: 1 }, 0);
    }

    // ============================================================ FLOODS · verbs
    function beatVerbs() {
      qa('.verb').forEach((v, i) => {
        const t = SLAMS[i];
        A(v, { opacity: [0, 1], duration: 1 }, t);
        A(v, { scale: [1.5, 0.95], translateY: [40, 0], duration: 220, ease: 'outExpo' }, t);
        A(v, { scale: [0.95, 1], duration: 70, ease: 'outCubic' }, t + 0.22);
        A(v, { opacity: [1, 0], duration: 1 }, FLOODS[i].out + 0.45);
      });
    }

    // flood swooshes + slams (called after beatAnalytics has patched FLOODS[2].c0 to the Share button)
    function floodCues() {
      const names = ['snap', 'sort', 'split'];
      FLOODS.forEach((f, i) => {
        cue(f.in, 'swoosh', { id: `${names[i]}-flood`, gain: -4, x: f.c0[0], variant: 'silk', intensity: 0.45 });
        cue(SLAMS[i], 'impact', { id: `${names[i]}-slam`, gain: 0, variant: ['thud', 'punch', 'punch'][i], intensity: [0.5, 0.55, 0.72][i] });
      });
      cue(FLOODS[0].in, 'rise', { id: 'snap-rise', dur: 0.35, intensity: 0.4 });
    }

    // ============================================================ BEAT 3 · SCAN 2.0–5.0
    function beatScan() {
      fade(q('.s-cam'), 0, 0, 1, 1, 'linear');
      A(ph, { opacity: [0, 1], duration: 1 }, 1.95);
      A(ph, { rotateY: [-24, -6], translateX: [-420, 0], translateY: [160, 0], scale: [0.82, 1], duration: 750, ease: 'outExpo' }, 2.0);
      cue(2.0 + 0.05, 'whoosh', { id: 'phone-in', el: 'phone', x: 300, dur: 0.45, variant: 'air' });
      A(ph, { rotateY: [-6, 6], scale: [1, 1.1], duration: 2000, ease: 'inOutSine' }, 2.9);

      const paper = q('.paper');
      const pw = paper.offsetWidth;
      const ph_ = paper.offsetHeight;
      q('.pin', paper).style.clipPath = torn(pw, ph_, 9, 6);
      const cx = 190;
      const cy = 368;
      paper.style.left = cx - pw / 2 + 'px';
      paper.style.top = cy - ph_ / 2 + 'px';
      const off = { x: 16, y: 14, r: -8 };
      A(paper, { translateX: [off.x, off.x], translateY: [off.y, off.y], rotate: [off.r, off.r], scale: [1.08, 1.08], duration: 1 }, 0);
      A(paper, { translateX: [off.x, 0], translateY: [off.y, 0], rotate: [off.r, 0], scale: [1.08, 1], duration: 450, ease: 'inOutCubic' }, 3.3);

      const pad = 9;
      const corner = (i, dx, dy, deg) => {
        const sx = [-1, 1, 1, -1][i];
        const sy = [-1, -1, 1, 1][i];
        const a = (deg * Math.PI) / 180;
        const hx = sx * (pw / 2 + pad);
        const hy = sy * (ph_ / 2 + pad);
        return [cx + dx + hx * Math.cos(a) - hy * Math.sin(a), cy + dy + hx * Math.sin(a) + hy * Math.cos(a)];
      };
      const startPts = [[18, 52], [362, 52], [362, 690], [18, 690]];
      qa('.brk').forEach((b, i) => {
        const ox = i === 1 || i === 2 ? 30 : 0;
        const oy = i >= 2 ? 30 : 0;
        const [x0, y0] = startPts[i];
        const [x1, y1] = corner(i, off.x, off.y, off.r);
        const [x2, y2] = corner(i, 0, 0, 0);
        A(b, { opacity: [0, 1], translateX: [x0 - ox, x1 - ox], translateY: [y0 - oy, y1 - oy], rotate: [0, off.r], duration: 480, ease: 'outBack(1.4)' }, 2.4 + i * 0.04);
        // bracket reaches the paper ~0.12 s into its tween; four ticks rise as a tiny cascade
        cue(2.4 + i * 0.04 + 0.12, 'tick', { id: `bracket-${i}`, el: `bracket-${i}`, gain: -8, pitch: pentatonic(i + 2), pan: [-0.35, 0.35, 0.35, -0.35][i] });
        A(b, { translateX: [x1 - ox, x2 - ox], translateY: [y1 - oy, y2 - oy], rotate: [off.r, 0], duration: 450, ease: 'inOutCubic' }, 3.3);
        A(b, { opacity: [1, 0], scale: [1, 1.2], duration: 300, ease: 'inCubic' }, 4.7);
      });

      const beam = q('.beam');
      beam.style.width = pw + 40 + 'px';
      beam.style.left = cx - pw / 2 - 20 + 'px';
      const top = cy - ph_ / 2 - 6;
      A(beam, { opacity: [0, 1], duration: 100, ease: 'linear' }, 2.55);
      A(beam, { translateY: [top, top + ph_ + 24], duration: 700, ease: 'inOutSine' }, 2.6);
      cue(2.6 + 0.35, 'whoosh', { id: 'beam', el: 'scan-beam', gain: -8, dur: 0.7, x: 300, variant: 'air' }); // peak speed mid-sweep
      A(beam, { opacity: [1, 0], duration: 120, ease: 'linear' }, 3.28);

      const st = qa('.status > div');
      const times = [2.1, 3.3, 3.6, 3.9, 4.5];
      st.forEach((el, i) => {
        A(el, { opacity: [0, 1], translateY: [10, 0], duration: 180, ease: 'outCubic' }, times[i]);
        if (i < st.length - 1) A(el, { opacity: [1, 0], duration: 90, ease: 'linear' }, times[i + 1] - 0.09);
      });

      qa('.paper .bar').forEach((b, i) => A(b, { scaleX: [0, 1], duration: 260, ease: 'inOutCubic' }, 3.6 + i * 0.14));
      cue(3.6 + 0.1, 'swoosh', { id: 'redact', el: 'paper', gain: -10, x: 300, variant: 'silk', intensity: 0.4 });
      cue(times[4] + 0.05, 'chime', { id: 'read-done', el: 'scan-status', gain: -4, x: 300 }); // "8 lines · 4 categories" status fades in
      qa('.paper .hb').forEach((h, i) => {
        A(h, { opacity: [0, 1], duration: 90, ease: 'outCubic' }, 3.9 + i * 0.05);
        cue(3.9 + i * 0.05, 'tick', { id: `read-${i}`, el: 'paper', gain: -12, pitch: pentatonic(i, 5), x: 300 });
        A(h, { opacity: [1, 0], duration: 320, ease: 'inOutSine' }, 4.0 + i * 0.05);
      });
      A(paper, { scale: [1, 1.05, 1], duration: 400, ease: 'inOutSine' }, 4.55);
    }

    // ============================================================ BEAT 4 · whip → card, BEAT 5 items out
    function beatSort() {
      // whip-pan left with blur under the flood
      A(ph, { translateX: [0, -1300], filter: ['blur(0px)', 'blur(12px)'], duration: 250, ease: 'inCubic' }, 5.0);
      cue(5.0 + 0.2, 'whoosh', { id: 'sort-whip', pan: -0.5, dur: 0.3, variant: 'swipe', intensity: 0.5 }); // fastest just before it leaves the frame
      A(ph, { scale: [1.1, 1], rotateY: [6, 8], duration: 1 }, 5.3);
      fade(q('.s-cam'), 5.3, 1, 0, 1, 'linear');
      fade(q('.s-card'), 5.3, 0, 1, 1, 'linear');
      // return from the right, rotateY +8 → -3
      A(ph, { translateX: [1300, 0], filter: ['blur(12px)', 'blur(0px)'], duration: 560, ease: 'outExpo' }, 5.42);
      cue(5.42 + 0.05, 'whoosh', { id: 'sort-return', gain: -8, pan: 0.5, dur: 0.4, variant: 'air', intensity: 0.35 });
      A(ph, { rotateY: [8, -3], duration: 2000, ease: 'inOutSine' }, 5.9);

      // line items lift out
      const rows = qa('.s-card .item');
      const T0 = [
        { x: 310, y: 430, z: 140, s: 1, r: -6, blur: 0 },
        { x: 775, y: 650, z: 60, s: 1, r: 5, blur: 0 },
        { x: 290, y: 1030, z: -170, s: 0.95, r: -4, blur: 3 },
        { x: 790, y: 1215, z: 200, s: 1, r: 6, blur: 0 },
      ];
      const tags = [
        { txt: '#organic', row: 0, x: 170, y: 790, z: -260, s: 1, r: -9, blur: 4 },
        { txt: '#essential', row: 1, x: 860, y: 930, z: -190, s: 1, r: 6, blur: 3 },
      ];
      let liftN = 0;
      const lift = (el, row, tgt, t, dur = 650, key) => {
        cue(t, 'pop', { id: `lift-${liftN}`, el: key, pitch: pentatonic(liftN++, 0), gain: -3, x: tgt.x });
        const [lx, ly] = at(row);
        const [sx, sy] = toFrame(lx, ly);
        const dx = (tgt.x - CX) * 1.9;
        const dy = (tgt.y - CY) * 1.5;
        live.push({ el, x: tgt.x, y: tgt.y, z: tgt.z, s: tgt.s, r: tgt.r });
        A(el, { opacity: [0, 1], duration: 1 }, t);
        A(el, { translateX: [sx, tgt.x], translateY: [sy, tgt.y], translateZ: [0, tgt.z], scale: [0.7, tgt.s], rotate: [0, tgt.r], duration: dur, ease: 'outExpo' }, t);
        // leave at 8.0 (analytics push-in): fly outward + blur
        A(el, { translateX: [tgt.x, tgt.x + dx], translateY: [tgt.y, tgt.y + dy], translateZ: [tgt.z, tgt.z + 200], filter: ['blur(0px)', 'blur(10px)'], duration: 380, ease: 'inCubic' }, 8.0);
        A(el, { opacity: [1, 0], duration: 1 }, 8.38);
      };
      CARD_ITEMS.forEach((it, i) => {
        const tg = T0[i];
        const fi = tg.blur ? `filter:blur(${tg.blur}px)` : '';
        const el = mkFloat(`<div class="fc"><span>${it.short}</span><span class="ct">${it.cat}</span></div>`, { fi, amp: 1.2, front: true });
        ctx.el(`chip-${i}`, q('.fc', el));
        const t = 5.8 + i * 0.15;
        lift(el, rows[i], tg, t, 650, `chip-${i}`);
        A(rows[i], { opacity: [1, 0.22], duration: 300, ease: 'outCubic' }, t);
      });
      tags.forEach((tg, k) => {
        const fi = tg.blur ? `filter:blur(${tg.blur}px)` : '';
        const el = mkFloat(`<div class="fc tg">${tg.txt}</div>`, { fi, amp: 1.4, front: true });
        ctx.el(`tag-${k}`, q('.fc', el));
        lift(el, rows[tg.row], tg, 6.45 + k * 0.15, 700, `tag-${k}`);
      });
      live.length = 0; // item chips leave at 8.0, they are not part of the 12.5 collapse

      // giant total
      const tot = mkFloat('<div class="total">$0.00</div>', { amp: 0.4, front: true });
      R.totalEl = q('.total', tot);
      ctx.el('total', R.totalEl); // the visible text (its .fl wrapper has no size)
      A(tot, { translateX: [CX, CX], translateY: [1365, 1365], translateZ: [90, 90], duration: 1 }, 0);
      A(tot, { opacity: [0, 1], scale: [0.7, 1], duration: 450, ease: 'outBack' }, 6.8);
      // count-up 6.8 -> 7.7 (render(): tween outExpo); ticks follow the counter, ding when the last digit settles
      const dingT = 6.8 + 0.9 * COUNT_SETTLE;
      let prev = 0;
      countTicks(6.8, 7.7, 12, outExpo).forEach((tt, k) => {
        if (tt > dingT - 0.08 || tt - prev < 0.04) return;
        prev = tt;
        cue(tt, 'tick', { id: `total-tick-${k}`, el: 'total', gain: -10, pitch: k * 0.4, x: CX });
      });
      cue(dingT, 'ding', { id: 'total-ding', el: 'total', x: CX });
      A(tot, { scale: [1, 1.2], opacity: [1, 0], filter: ['blur(0px)', 'blur(14px)'], duration: 350, ease: 'inCubic' }, 8.0);
    }

    // ============================================================ BEAT 6 · ANALYTICS 8.0–9.5
    function beatAnalytics() {
      fade(q('.s-card'), 8.0, 1, 0, 200);
      fade(q('.s-ana'), 8.0, 0, 1, 200);
      A(ph, { scale: [1, PUSH.s], translateY: [0, PUSH.ty], rotateY: [-3, 4], duration: 500, ease: 'inOutCubic' }, 8.0);
      cue(8.0 + 0.25, 'whoosh', { id: 'push-in', gain: -6, dur: 0.5, variant: 'air' });
      A(q('.ring'), { strokeDashoffset: [100, 83], duration: 800, ease: 'outExpo' }, 8.25);
      qa('.dseg').forEach((s, i) => {
        A(s, { strokeDashoffset: [+s.dataset.len, 0], duration: 360, ease: 'inOutCubic' }, 8.6 + i * 0.09);
        cue(8.6 + i * 0.09 + 0.1, 'pop', { id: `donut-${i}`, el: 'donut-card', gain: -12, pitch: pentatonic(i, 7), x: 380 });
      });
      R.gVal = q('.g-val');
      R.gPct = q('.g-pct');

      const lbl = q('.lblwrap');
      A(lbl, { translateX: [CX, CX], translateY: [1440, 1440], duration: 1 }, 0);
      A(lbl, { opacity: [0, 1], scale: [0.6, 1], duration: 350, ease: 'outBack' }, 8.45);
      A(lbl, { opacity: [1, 0], duration: 120, ease: 'linear' }, 9.38);

      // tap Share, then flood
      const btn = q('.b-share');
      const [bx, by] = at(btn);
      const tp = q('.tap');
      tp.style.left = bx + 'px';
      tp.style.top = by + 'px';
      A(q('.dot', tp), { opacity: [0, 1], scale: [0.6, 1], duration: 120, ease: 'outCubic' }, 9.2);
      A(q('.dot', tp), { opacity: [1, 0], duration: 200, ease: 'inCubic' }, 9.4);
      A(q('.ring', tp), { opacity: [0, 0.9], duration: 1 }, 9.3);
      A(q('.ring', tp), { opacity: [0.9, 0], scale: [0.6, 2.2], duration: 300, ease: 'outCubic' }, 9.31);
      A(btn, { scale: [1, 0.94], duration: 80, ease: 'outCubic' }, 9.25);
      cue(9.25, 'click', { id: 'share-tap', el: 'share-button', x: toFrame(bx, by)[0] }); // real press is 9.25 (SOUND.md said 9.4)
      A(btn, { scale: [0.94, 1], duration: 200, ease: 'outBack' }, 9.34);
      // flood centre = Share button on screen after the push-in
      const [gx, gy] = toFrame(bx, by);
      FLOODS[2].c0 = [CX + PUSH.s * (gx - CX), CY + PUSH.s * (gy - CY) + PUSH.ty];
    }

    // ============================================================ BEAT 8 · SPLIT 10.0–12.5
    function beatSplit() {
      // under the flood: reset phone, swap screen
      A(ph, { scale: [PUSH.s, 1], translateY: [PUSH.ty, 0], rotateY: [4, -8], duration: 1 }, 9.7);
      fade(q('.s-ana'), 9.7, 1, 0, 1, 'linear');
      fade(q('.s-split'), 9.7, 0, 1, 1, 'linear');
      A(ph, { rotateY: [-8, 3], duration: 2300, ease: 'inOutSine' }, 10.1);

      const park = [
        { x: 150, y: 480, z: 220, from: [-260, 480], r: -5 }, // Max    ← left edge
        { x: 920, y: 650, z: -80, from: [920, -260], r: 4 }, // Tom    ← top
        { x: 150, y: 1030, z: 200, from: [150, 2200], r: 4 }, // Lea    ← bottom
        { x: 920, y: 1190, z: 160, from: [1340, 1190], r: -4 }, // You    ← right
      ];
      const av = park.map((p, i) => {
        const [name, ini] = MEMBERS[i];
        const me = name === 'You';
        const el = mkFloat(
          `<div class="circ ${me ? 'me' : ''}">${me ? 'Y' : ini}</div><div class="avn">${name}</div>
           <div class="dpill"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>DONE</div>`,
          { fi: 'transform:translate(-50%,-64px)', amp: 1.5, front: true },
        );
        live.push({ el, x: p.x, y: p.y, z: p.z, s: 1, r: p.r });
        ctx.el(`avatar-${i}`, q('.fi', el));
        const t = 10.05 + i * 0.1;
        cue(t + 0.05, 'whoosh', { id: `avatar-${i}`, el: `avatar-${i}`, gain: -10, x: p.x, dur: 0.25, variant: 'air', intensity: 0.28 });
        A(el, { opacity: [0, 1], duration: 1 }, t);
        A(el, { translateX: [p.from[0], p.x], translateY: [p.from[1], p.y], translateZ: [p.z, p.z], rotate: [p.r * 3, p.r], scale: [0.6, 1], duration: 750, ease: 'outBack(1.3)' }, t);
        return el;
      });

      // each avatar grabs an item: row chip flies on an arc
      const rows = qa('.s-split .srow');
      SPLIT_ROWS.forEach(([name, price, who], i) => {
        const p = park[who];
        const [lx, ly] = at(rows[i]);
        const [sx, sy] = toFrame(lx, ly);
        const side = p.x < CX ? 1 : -1;
        // chip flies on an arc into its claimer's avatar and is absorbed (avatar pulses)
        const tx = p.x;
        const ty = p.y - 64;
        const el = mkFloat(`<div class="fc" style="font-size:30px;padding:12px 22px"><span>${name}</span><span class="pr" style="font-size:30px">${price}</span></div>`, { amp: 0.8, front: true });
        ctx.el(`split-chip-${i}`, q('.fc', el));
        const t = 10.7 + i * 0.25;
        const mid = Math.min(sy, ty) - 170;
        A(el, { opacity: [0, 1], duration: 1 }, t);
        A(el, { translateX: [sx, tx], translateZ: [0, p.z], scale: [0.6, 0.9], rotate: [0, side * -3], duration: 450, ease: 'inOutCubic' }, t);
        A(el, { translateY: [sy, mid], duration: 200, ease: 'outCubic' }, t);
        A(el, { translateY: [mid, ty], duration: 250, ease: 'inQuad' }, t + 0.2);
        A(el, { scale: [0.9, 0.15], opacity: [1, 0], duration: 180, ease: 'inCubic' }, t + 0.42);
        const circ = q('.circ', av[who]);
        A(circ, { scale: [1, 1.22], duration: 120, ease: 'outCubic' }, t + 0.45);
        cue(t + 0.45, 'pop', { id: `grab-${i}`, el: `split-chip-${i}`, pitch: pentatonic(i, 2), gain: -4, x: p.x }); // absorb moment (avatar pulse)
        A(circ, { scale: [1.22, 1], duration: 380, ease: 'outBack(2)' }, t + 0.57);
        // claim pill in the phone row → initial
        const slot = q('.slot', rows[i]);
        A(q('.claim', slot), { opacity: [1, 0], scale: [1, 0.7], duration: 160, ease: 'inCubic' }, t);
        A(q('.av', slot), { opacity: [0, 1], scale: [0, 1], duration: 350, ease: 'outBack' }, t + 0.35);
        A(rows[i], { opacity: [1, 0.55], duration: 200 }, t + 0.35);
      });

      // DONE pills flip in 11.6–12.2
      av.forEach((el, i) => {
        const d = q('.dpill', el);
        A(d, { opacity: [0, 1], scaleY: [0, 1], duration: 380, ease: 'outBack(1.6)' }, 11.6 + i * 0.15);
        // one chime for the set (on the last pill), soft pops for the first three
        if (i === 0 || i === 2) cue(11.6 + i * 0.15 + 0.12, 'pop', { id: `done-${i}`, el: `avatar-${i}`, gain: -11, pitch: pentatonic(i, 9), x: park[i].x }); // pill 1 skipped: lands 30 ms from each-ding and a grab
        else if (i < av.length - 1) { /* no cue */ }
        else cue(11.6 + i * 0.15 + 0.12, 'chime', { id: 'done-chime', el: `avatar-${i}`, gain: -5, x: park[i].x });
      });

      // $10.53 each
      const each = mkFloat('<div class="each"><span class="e-v">$0.00</span><small>each</small></div>', { amp: 0.4, front: true });
      R.eachEl = q('.e-v', each);
      ctx.el('each', q('.each', each));
      ctx.el('each-value', R.eachEl);
      live.push({ el: each, x: CX, y: 1450, z: 0, s: 1, r: 0 });
      A(each, { translateX: [CX, CX], translateY: [1450, 1450], translateZ: [60, 60], rotate: [0, 0], duration: 1 }, 0);
      A(each, { opacity: [0, 1], scale: [0.7, 1], duration: 420, ease: 'outBack' }, 11.2);
      cue(11.2 + 0.8 * COUNT_SETTLE, 'ding', { id: 'each-ding', el: 'each-value', gain: -2, x: CX, pitch: 3 }); // count-up 11.2 -> 12.0
    }

    // ============================================================ BEAT 9–10 · COLLAPSE + END CARD
    function beatEnd() {
      const T = COLLAPSE_T;
      cue(T + 0.4, 'suck', { id: 'collapse', dur: 0.45, gain: -3, intensity: 0.55 }); // converges on the point at T + 0.4
      live.forEach((o) => {
        A(o.el, { translateX: [o.x, CX], translateY: [o.y, CY], translateZ: [o.z, 0], scale: [o.s, 0], rotate: [o.r, o.r + 150], duration: 400, ease: 'inCubic' }, T);
        A(o.el, { opacity: [1, 0], duration: 1 }, T + 0.4);
      });
      A(ph, { scale: [1, 0], rotate: [0, 120], duration: 400, ease: 'inCubic' }, T);
      A(ph, { opacity: [1, 0], duration: 1 }, T + 0.4);

      // logo pops out of the centre point, then glides into the lockup
      const logo = q('.endLogo');
      const word = q('.lockup .word');
      const lr = logo.getBoundingClientRect();
      const dx = CX - (lr.left - rootRect.left + lr.width / 2);
      const dy = CY - (lr.top - rootRect.top + lr.height / 2);
      A(logo, { opacity: [0, 1], duration: 1 }, LOGO_T);
      cue(LOGO_T, 'logo', { id: 'logo', el: 'logo', x: CX, variant: 'boom', intensity: 0.9 });
      A(logo, { scale: [0, 1], duration: 450, ease: 'outBack(1.8)' }, LOGO_T);
      A(logo, { translateX: [dx, dx], translateY: [dy, dy], duration: 1 }, 0);
      A(logo, { translateX: [dx, 0], translateY: [dy, 0], duration: 480, ease: 'inOutCubic' }, 13.15);
      A(word, { opacity: [0, 1], translateX: [-40, 0], duration: 500, ease: 'outExpo' }, 13.4);

      cue(13.3 + 0.1, 'pop', { id: 'tag', el: 'tagline', gain: -9, pitch: pentatonic(1), x: CX });
      cue(13.5 + 0.1, 'pop', { id: 'url', el: 'url', gain: -9, pitch: pentatonic(3), x: CX });
      cue(14.0 + 0.12, 'click', { id: 'cta', el: 'cta', gain: -4, x: CX });
      A(qa('.tag1 .w > span'), { translateY: ['115%', '0%'], duration: 700, ease: 'outExpo', delay: (_, k) => k * 90 }, 13.3);
      A(q('.url'), { opacity: [0, 1], translateY: [70, 0], scale: [0.85, 1], duration: 650, ease: 'outExpo' }, 13.5);
      A(q('.url .ul'), { scaleX: [0, 1], duration: 450, ease: 'inOutCubic' }, 13.8);
      A(q('.cta'), { opacity: [0, 1], scale: [0.55, 1], duration: 550, ease: 'outBack(1.8)' }, 14.0);
      A(q('.fine'), { opacity: [0, 1], duration: 400, ease: 'outCubic' }, 14.3);
    }

    beatHook();
    beatVerbs();
    beatScan();
    beatSort();
    beatAnalytics();
    beatSplit();
    beatEnd();
    floodCues();

    R.floodDeep = q('.flood.deep');
    R.floodMain = q('.flood.main');
    R.stage = q('.drift');
    R.shake = q('.shake');
    R.glow = q('.glow');
    R.glowI = q('.glow i');
    // names for the review/tweak tooling (attributes only; no effect on look or timing)
    ctx.el('grid', R.grid);
    ctx.el('glow', R.glow);
    ctx.el('phone', ph);
    ctx.el('phone-screen', screen);
    ctx.el('screen-camera', q('.s-cam'));
    ctx.el('screen-card', q('.s-card'));
    ctx.el('screen-analytics', q('.s-ana'));
    ctx.el('screen-split', q('.s-split'));
    qa('.pile').forEach((el, i) => ctx.el(`pile-${i}`, q('.fi', el)));
    ctx.el('hook', q('.hook'));
    qa('.hook > span').forEach((w, i) => ctx.el(`hook-word-${i}`, w));
    qa('.verb').forEach((v, i) => ctx.el(`verb-${['snap', 'sort', 'split'][i]}`, v));
    ctx.el('flood-main', R.floodMain);
    ctx.el('flood-deep', R.floodDeep);
    ctx.el('paper', q('.paper'));
    ctx.el('scan-beam', q('.beam'));
    ctx.el('scan-status', q('.status'));
    qa('.brk').forEach((b, i) => ctx.el(`bracket-${i}`, b));
    ctx.el('gauge', q('.gauge'));
    ctx.el('gauge-value', R.gVal);
    ctx.el('gauge-percent', R.gPct);
    ctx.el('donut-card', q('.s-ana .a2'));
    ctx.el('share-button', q('.b-share'));
    ctx.el('tap', q('.tap'));
    ctx.el('caption', q('.lblwrap .fi'));
    ctx.el('end', q('.end'));
    ctx.el('lockup', q('.lockup'));
    ctx.el('logo', q('.endLogo'));
    ctx.el('wordmark', q('.lockup .word'));
    ctx.el('tagline', q('.tag1'));
    qa('.tag1 .w > span').forEach((w, i) => ctx.el(`tagline-word-${i}`, w));
    ctx.el('url', q('.url'));
    ctx.el('cta', q('.cta'));
    ctx.el('fine-print', q('.fine'));
    tl.seek(tl.duration);
    tl.seek(0);
  },

  render(t) {
    tl.seek(0);
    tl.seek(t * 1000);

    // floods
    R.floodDeep.style.clipPath = circ(floodCircle(t, 0.07, 0.06));
    R.floodMain.style.clipPath = circ(floodCircle(t));

    // screen shake: decaying 3-oscillation, 180 ms
    let sx = 0;
    let sy = 0;
    SHAKES.forEach((s, i) => {
      const d = (t - s) / 0.18;
      if (d >= 0 && d < 1) {
        const a = SHAKE_AMP[i] * (1 - d);
        sx += a * Math.sin(d * 6 * Math.PI);
        sy += a * 0.7 * Math.cos(d * 6 * Math.PI + 0.8);
      }
    });
    R.shake.style.transform = `translate(${sx.toFixed(2)}px,${sy.toFixed(2)}px)`;

    // camera drift (always moving)
    const ry = 4.5 * Math.sin((t / 7) * Math.PI * 2);
    const rx = 2.5 * Math.sin((t / 9) * Math.PI * 2 + 1);
    R.stage.style.transform = `rotateY(${ry.toFixed(3)}deg) rotateX(${rx.toFixed(3)}deg)`;

    // floaters drift slowly at their own phase
    R.drift.forEach(({ fd, k, amp }) => {
      const ph = hash(k, 3) * 6.283;
      const x = 16 * amp * Math.sin(t * 0.9 + ph);
      const y = 20 * amp * Math.sin(t * 0.7 + ph * 1.7);
      fd.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
    });

    // background: grid drifts upward, glow follows the phone and breathes
    R.grid.style.backgroundPosition = `0px ${(-t * 36).toFixed(1)}px`;
    const gx = keyframes(t, [
      { t: 0, v: 0 }, { t: 5.0, v: 0 }, { t: 5.25, v: -380, ease: inOutCubic }, { t: 5.42, v: 380 }, { t: 6.1, v: 0, ease: outExpo }, { t: 15, v: 0 },
    ]);
    const gy = keyframes(t, [{ t: 0, v: 360 }, { t: 2.0, v: 0, ease: inOutCubic }, { t: 15, v: 0 }]);
    const b = 1 + 0.045 * Math.sin((t / 4) * Math.PI * 2);
    R.glow.style.transform = `translate(${gx.toFixed(1)}px,${gy.toFixed(1)}px)`;
    R.glowI.style.transform = `scale(${(b * (t > 13 ? 1.05 : 1)).toFixed(4)})`;

    // money as graphics
    const eur = (v) => '$' + v.toFixed(2);
    R.totalEl.textContent = eur(tween(t, 6.8, 7.7, 0, 42.13, outExpo));
    const k = outExpo(progress(t, 8.25, 9.05));
    R.gVal.textContent = '$' + (83.46 * k).toFixed(2);
    R.gPct.textContent = Math.round(17 * k) + '%';
    R.eachEl.textContent = eur(tween(t, 11.2, 12.0, 0, 10.53, outExpo));
  },
};
