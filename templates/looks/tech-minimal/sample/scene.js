// Tech minimal: the look test card (templates/looks/_sample/BRIEF.md).
// Motion: linear moves and wipes, stepped (frame-snapped) reveals, integer counters; every interval is a multiple of
// 100 ms (3 frames at 30 fps). Layout snaps to the 40 px grid (160 px major lines).
import { createTimeline } from 'animejs';
import { gridCss } from '/runner/lib/style.js';

const ITEMS = [
  { n: '01', name: 'Plan', v: 100 },
  { n: '02', name: 'Build', v: 100 },
  { n: '03', name: 'Review', v: 100 },
];
const HEAD = 'Make it move';
const TAG = 'motion, reviewed';
const FPS = 30;
const X0 = 160; // left margin (major grid line)
const X1 = 1760; // right margin
const S = { type: 0, tag: 0, wipe1: 0, wipe2: 0, count: 0 };
const B = { b0: 0, b1: 0, b2: 0 }; // bar readouts (%)
let tl;
let el = {};

const pad = (n, w = 2) => String(n).padStart(w, '0');

export default {
  setup({ root, style }) {
    const css = `
      .tm{position:absolute;font-family:var(--gfx-font-mono);color:var(--gfx-text)}
      .lbl{font:500 22px var(--gfx-font-mono);color:var(--gfx-muted);letter-spacing:.08em;text-transform:uppercase}
      .rule{position:absolute;height:2px;background:var(--gfx-stroke);transform-origin:left center}
      .hair{position:absolute;height:1px;background:var(--gfx-border);transform-origin:left center}
      .mark{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px}
      .mark::before,.mark::after{content:'';position:absolute;background:var(--gfx-muted)}
      .mark::before{left:11px;top:0;width:2px;height:24px}.mark::after{top:11px;left:0;height:2px;width:24px}
      /* @gfx headline */
      .head{left:${X0}px;top:400px;font:600 120px var(--gfx-font-mono);letter-spacing:-0.03em;white-space:pre;line-height:1}
      .caret{display:inline-block;width:.6em;height:.9em;background:var(--gfx-text);vertical-align:-0.08em;margin-left:4px}
      /* @end */
      /* @gfx items */
      .row{position:absolute;left:${X0}px;width:${X1 - X0}px;height:120px}
      .row .idx{position:absolute;left:0;top:40px;font:500 28px var(--gfx-font-mono);color:var(--gfx-muted)}
      .row .nm{position:absolute;left:160px;top:24px;font:500 64px var(--gfx-font-sans);letter-spacing:-0.02em;line-height:1}
      .row .track{position:absolute;left:800px;top:48px;width:640px;height:16px;border:1px solid var(--gfx-border);box-sizing:border-box}
      .row .fill{position:absolute;inset:3px;background:var(--gfx-stroke);transform-origin:left center}
      .row .val{position:absolute;right:0;top:40px;font:500 28px var(--gfx-font-mono);font-variant-numeric:tabular-nums}
      /* @end */
      /* @gfx counter */
      .num{left:${X0 - 12}px;top:240px;font:600 400px var(--gfx-font-mono);color:var(--gfx-accent);line-height:1;letter-spacing:-0.04em;font-variant-numeric:tabular-nums}
      .numlbl{left:${X0}px;top:680px;font:400 44px var(--gfx-font-sans);color:var(--gfx-text)}
      .tick{position:absolute;top:800px;width:2px;height:40px;background:var(--gfx-gridStrong)}
      .kv{left:1280px;top:320px;font:400 28px var(--gfx-font-mono);color:var(--gfx-muted);line-height:80px;white-space:pre}
      .kv b{font-weight:500;color:var(--gfx-text)}
      /* @end */
      /* @gfx endcard */
      .word{left:0;width:1920px;top:380px;text-align:center;box-sizing:border-box;padding-left:calc(.55em + 16px);font:600 240px var(--gfx-font-mono);letter-spacing:-0.04em;line-height:1}
      .word .blk{display:inline-block;width:.55em;height:.78em;background:var(--gfx-accent);vertical-align:-0.06em;margin-left:16px}
      .tag{left:0;width:1920px;top:680px;text-align:center;font:400 44px var(--gfx-font-sans);color:var(--gfx-muted);white-space:pre}
      .corner{position:absolute;width:48px;height:48px;border-color:var(--gfx-stroke);border-style:solid;border-width:0}
      /* @end */
      .scan{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;background:var(--gfx-accent)}
    `.replace(/--gfx-gridStrong/g, '--gfx-grid-strong');

    root.insertAdjacentHTML(
      'beforeend',
      `<style>${css}</style>
       <!-- @gfx background -->
       <div data-gfx="background" style="position:absolute;inset:0">
         ${[[X0, 160], [X1, 160], [X0, 960], [X1, 960]].map(([x, y]) => `<div class="mark" style="left:${x}px;top:${y}px"></div>`).join('')}
       </div>
       <!-- @end -->
       <!-- @gfx hud -->
       <div data-gfx="hud" style="position:absolute;inset:0">
         <div class="tm lbl" style="left:${X0}px;top:72px">gfx / test card</div>
         <div class="tm lbl hud-tc" style="right:${1920 - X1}px;top:72px;color:var(--gfx-text)">00:00:00:00</div>
         <div class="tm lbl" style="left:${X0}px;top:990px">1920×1080 · ${FPS} fps</div>
         <div class="tm lbl hud-beat" style="right:${1920 - X1}px;top:990px">beat 1/4</div>
         <div class="hair" style="left:${X0}px;top:1040px;width:${X1 - X0}px"></div>
         <div class="rule hud-prog" style="left:${X0}px;top:1039px;width:${X1 - X0}px;height:3px"></div>
       </div>
       <!-- @end -->
       <div class="pageA" style="position:absolute;inset:0">
         <!-- @gfx headline -->
         <div data-gfx="headline" style="position:absolute;inset:0">
           <div class="tm lbl head-lbl" style="left:${X0}px;top:340px">01 headline</div>
           <div class="tm head"><span class="head-txt"></span><span class="caret"></span></div>
           <div class="rule head-rule" style="left:${X0}px;top:560px;width:${X1 - X0}px"></div>
         </div>
         <!-- @end -->
         <!-- @gfx items -->
         <div data-gfx="items" style="position:absolute;inset:0">
           ${ITEMS.map((it, i) => `
           <div class="row row-${i}" style="top:${440 + i * 160}px">
             <div class="hair row-line" style="left:0;top:0;width:100%"></div>
             <div class="idx">${it.n}</div><div class="nm">${it.name}</div>
             <div class="track"><div class="fill"></div></div><div class="val">000%</div>
           </div>`).join('')}
         </div>
         <!-- @end -->
       </div>
       <div class="pageB" style="position:absolute;inset:0">
         <!-- @gfx counter -->
         <div data-gfx="counter" style="position:absolute;inset:0">
           <div class="tm lbl" style="left:${X0}px;top:200px">02 accent</div>
           <div class="tm num">00</div>
           <div class="tm numlbl">frames per idea</div>
           ${Array.from({ length: 24 }, (_, i) => `<div class="tick" style="left:${X0 + i * 40}px"></div>`).join('')}
           <div class="tm kv"><b>fps</b>     30\n<b>beat</b>    0.8 s\n<b>frames</b>  <span class="kv-n">00</span></div>
         </div>
         <!-- @end -->
       </div>
       <div class="pageC" style="position:absolute;inset:0">
         <!-- @gfx endcard -->
         <div data-gfx="endcard" style="position:absolute;inset:0">
           <div class="corner" style="left:560px;top:320px;border-left-width:2px;border-top-width:2px"></div>
           <div class="corner" style="left:${1360 - 48}px;top:320px;border-right-width:2px;border-top-width:2px"></div>
           <div class="corner" style="left:560px;top:${800 - 48}px;border-left-width:2px;border-bottom-width:2px"></div>
           <div class="corner" style="left:${1360 - 48}px;top:${800 - 48}px;border-right-width:2px;border-bottom-width:2px"></div>
           <div class="tm word">gfx<span class="blk"></span></div>
           <div class="tm tag"></div>
         </div>
         <!-- @end -->
       </div>
       <div class="scan"></div>`,
    );

    // @gfx background
    const bgEl = root.querySelector('[data-gfx="background"]');
    Object.assign(bgEl.style, gridCss(style));
    // 2 px major lines every 160 px on top of the 1 px grid, as borders: Chrome keeps a border at least one device pixel
    // wide, so the grid still reads in the 0.25-scale thumbnail (gradient hairlines vanish there)
    const lines = [];
    for (let x = 160; x < 1920; x += 160) lines.push(`<div style="position:absolute;top:0;bottom:0;left:${x}px;border-left:2px solid ${style.colors.gridStrong}"></div>`);
    for (let y = 160; y < 1080; y += 160) lines.push(`<div style="position:absolute;left:0;right:0;top:${y}px;border-top:2px solid ${style.colors.gridStrong}"></div>`);
    bgEl.insertAdjacentHTML('afterbegin', lines.join(''));
    // @end

    const q = (s) => root.querySelector(s);
    el = {
      root,
      tc: q('.hud-tc'), beat: q('.hud-beat'), prog: q('.hud-prog'),
      head: q('.head-txt'), caret: q('.caret'),
      vals: [...root.querySelectorAll('.row .val')],
      num: q('.num'), kvn: q('.kv-n'), ticks: [...root.querySelectorAll('.tick')],
      tag: q('.tag'), blk: q('.blk'),
      pageA: q('.pageA'), pageB: q('.pageB'), pageC: q('.pageC'), scan: q('.scan'),
    };

    // Every move is linear (constant speed) or a one-frame snap; nothing eases in or out.
    tl = createTimeline({ autoplay: false, defaults: { ease: 'linear', duration: 300 } })
      // @gfx headline
      .add(S, { type: [0, 1], duration: 700 }, 150)
      .add('.head-lbl', { opacity: [0, 1], duration: 1 }, 100)
      .add('.head-rule', { scaleX: [0, 1], duration: 400 }, 800)
      // beat 2: the headline block moves up one major cell, constant speed
      .add('[data-gfx="headline"]', { translateY: [0, -200], duration: 300 }, 1300)
      .add('.caret', { opacity: [1, 0], duration: 1 }, 1300)
      // @end
      // @gfx items
      .add('.row-line', { scaleX: [0, 1], duration: 300, delay: (_, i) => i * 300 }, 1500)
      .add('.row .idx, .row .nm', { opacity: [0, 1], duration: 1, delay: (_, i) => Math.floor(i / 2) * 300 }, 1700)
      .add('.row .track', { opacity: [0, 1], duration: 1, delay: (_, i) => i * 300 }, 1700)
      .add('.row .val', { opacity: [0, 1], duration: 1, delay: (_, i) => i * 300 }, 1800)
      .add('.row .fill', { scaleX: [0, 1], duration: 500, delay: (_, i) => i * 300 }, 1800)
      .add(B, { b0: [0, 100], duration: 500 }, 1800)
      .add(B, { b1: [0, 100], duration: 500 }, 2100)
      .add(B, { b2: [0, 100], duration: 500 }, 2400)
      // @end
      // beat 3: scan-line wipe A -> B, then the counter steps 00 -> 24
      .add(S, { wipe1: [0, 1], duration: 300 }, 3200)
      // @gfx counter
      .add(S, { count: [0, 24], duration: 720 }, 3400)
      // @end
      // beat 4: scan-line wipe B -> end card
      .add(S, { wipe2: [0, 1], duration: 300 }, 4400)
      // @gfx endcard
      .add('.corner', { opacity: [0, 1], scale: [1.5, 1], duration: 200, delay: (_, i) => i * 100 }, 4700)
      .add(S, { tag: [0, 1], duration: 500 }, 4800)
      // @end
      ;
    tl.seek(tl.duration); // prime (animejs skill, "Seek pitfalls")
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);
    const f = Math.floor(t * FPS + 1e-6);

    // @gfx hud
    el.tc.textContent = `00:00:${pad(Math.floor(f / FPS))}:${pad(f % FPS)}`;
    el.beat.textContent = `beat ${t < 1.3 ? 1 : t < 3.2 ? 2 : t < 4.4 ? 3 : 4}/4`;
    el.prog.style.transform = `scaleX(${Math.min(1, t / 6)})`;
    // @end

    // @gfx headline
    el.head.textContent = HEAD.slice(0, Math.floor(S.type * HEAD.length + 1e-6));
    if (S.type < 1) el.caret.style.visibility = 'visible';
    else el.caret.style.visibility = Math.floor(t * 4) % 2 ? 'hidden' : 'visible';
    // @end

    // @gfx items
    el.vals.forEach((v, i) => { v.textContent = `${pad(Math.round(B['b' + i]), 3)}%`; });
    // @end

    // @gfx counter
    const n = Math.floor(S.count + 1e-6);
    el.num.textContent = pad(n);
    el.kvn.textContent = pad(n);
    el.ticks.forEach((k, i) => { k.style.background = i < n ? 'var(--gfx-accent)' : 'var(--gfx-grid-strong)'; });
    // @end

    // @gfx endcard
    el.tag.textContent = TAG.slice(0, Math.floor(S.tag * TAG.length + 1e-6));
    el.blk.style.visibility = t >= 5.2 || Math.floor(t * 4) % 2 ? 'visible' : 'hidden';
    // @end

    // Wipes: a vertical accent scan line crosses the frame at constant speed; the old page is cut behind it.
    const w = S.wipe2 > 0 ? S.wipe2 : S.wipe1;
    const x = w * 1920;
    el.scan.style.left = `${x}px`;
    el.scan.style.opacity = w > 0 && w < 1 ? 1 : 0;
    const clip = (show, side) => (show === 'all' ? 'none' : show === 'none' ? 'inset(0 0 0 100%)' : side === 'right' ? `inset(0 0 0 ${x}px)` : `inset(0 ${1920 - x}px 0 0)`);
    const set = (page, c) => { page.style.clipPath = c; page.style.visibility = c === 'inset(0 0 0 100%)' ? 'hidden' : 'visible'; };
    if (S.wipe1 <= 0) { set(el.pageA, clip('all')); set(el.pageB, clip('none')); set(el.pageC, clip('none')); }
    else if (S.wipe1 < 1) { set(el.pageA, clip(0, 'right')); set(el.pageB, clip(0, 'left')); set(el.pageC, clip('none')); }
    else if (S.wipe2 <= 0) { set(el.pageA, clip('none')); set(el.pageB, clip('all')); set(el.pageC, clip('none')); }
    else if (S.wipe2 < 1) { set(el.pageA, clip('none')); set(el.pageB, clip(0, 'right')); set(el.pageC, clip(0, 'left')); }
    else { set(el.pageA, clip('none')); set(el.pageB, clip('none')); set(el.pageC, clip('all')); }
  },
};
