// Explainer with captions (1920x1080, anime.js). A title, three step cards joined by lines that draw on, a highlight
// that walks to the active step, check badges at the end, and a caption bar (subtitles) driven by CAPTIONS.
// Named elements (data-gfx) are selectable in the studio; cues drive `gfx audio`.
// `@gfx <name>` … `@end` comments mark each named element's code (markup, CSS, tweens, per-frame code, cues): the
// studio's "Open code" shows exactly those blocks. Comments only, they never change the picture.
import { createTimeline, svg } from 'animejs';
import { gridCss } from '/runner/lib/style.js';
import { pentatonic } from '/runner/lib/sfx.js';

// ---- Copy ----
const KICKER = 'How it works';
const TITLE = 'Three steps to a finished video';
const STEPS = [
  { label: 'Upload', text: 'Drop in your clips, slides or notes.', icon: 'upload' },
  { label: 'Shape', text: 'We sort, trim and polish it for you.', icon: 'spark' },
  { label: 'Share', text: 'Send it anywhere with one click.', icon: 'send' },
];
// Subtitles: one line per beat, seconds. Gaps show an empty bar; the last one holds to the end.
const CAPTIONS = [
  { from: 0.4, to: 1.7, text: 'Here’s how it works.' },
  { from: 1.7, to: 3.7, text: 'First, drop your files in.' },
  { from: 3.7, to: 5.7, text: 'We sort and polish everything for you.' },
  { from: 5.7, to: 7.4, text: 'Then share the result with one click.' },
  { from: 7.4, to: 10, text: 'Three steps. Ready in minutes.' },
];

// ---- Timing (seconds) ----
const T = {
  title: 0.2, // kicker + title
  steps: [1.4, 3.4, 5.4], // each card lands; the link before it draws in the LINK_LEAD before
  done: 7.4, // highlight lets go, check badges pop
};
const LINK_LEAD = 0.6;
const CAPTION_FADE = 0.18;

// ---- Layout (px) ----
const CARD_W = 380;
const CARD_H = 360;
const CARD_TOP = 380;
const CENTERS = [400, 960, 1520];
const MID_Y = CARD_TOP + CARD_H / 2;

const ICONS = {
  upload: '<path d="M12 15V4"/><path d="M7 9l5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  spark: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
  send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>',
};
const s = (sec) => sec * 1000; // anime.js time is ms

let tl, capBar, capText, duration;

export default {
  setup(ctx) {
    const { root, width: W, style } = ctx;
    duration = ctx.duration;

    const css = `
      .ex{position:absolute;font-family:var(--gfx-font-sans);color:var(--gfx-text)}
      /* @gfx title */
      .ex-head{left:0;right:0;top:140px;display:flex;flex-direction:column;align-items:center;gap:22px}
      .ex-kicker{font:500 26px var(--gfx-font-mono);letter-spacing:.22em;text-transform:uppercase;color:var(--gfx-accent)}
      .ex-title{font-size:72px;font-weight:700;letter-spacing:-.025em;line-height:1}
      /* @end */
      /* @gfx step-1 step-2 step-3 */
      .ex-card{top:${CARD_TOP}px;width:${CARD_W}px;height:${CARD_H}px;box-sizing:border-box;padding:40px;
        background:var(--gfx-surface);border:2px solid var(--gfx-border);border-radius:28px;
        box-shadow:0 24px 48px color-mix(in srgb, var(--gfx-text) 7%, transparent);display:flex;flex-direction:column}
      .ex-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:auto}
      .ex-icon{width:96px;height:96px;border-radius:24px;display:grid;place-items:center;
        background:color-mix(in srgb, var(--gfx-accent) 10%, var(--gfx-surface))}
      .ex-icon svg{width:52px;height:52px;fill:none;stroke:var(--gfx-accent);stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      .ex-num{font:500 26px var(--gfx-font-mono);color:var(--gfx-muted);letter-spacing:.06em}
      .ex-label{font-size:46px;font-weight:700;letter-spacing:-.02em;margin-bottom:14px}
      .ex-text{font-size:26px;line-height:1.4;color:var(--gfx-muted)}
      .ex-check{position:absolute;top:-22px;right:-22px;width:56px;height:56px;border-radius:50%;display:grid;place-items:center;
        background:var(--gfx-accent);box-shadow:0 0 0 6px var(--gfx-bg)}
      .ex-check svg{width:30px;height:30px;fill:none;stroke:var(--gfx-surface);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
      /* @end */
      /* @gfx highlight */
      .ex-hl{top:${CARD_TOP - 14}px;left:${CENTERS[0] - CARD_W / 2 - 14}px;width:${CARD_W + 28}px;height:${CARD_H + 28}px;
        box-sizing:border-box;border:3px solid var(--gfx-accent);border-radius:40px;
        background:color-mix(in srgb, var(--gfx-accent) 5%, transparent)}
      /* @end */
      /* @gfx link-1 link-2 */
      .ex-links{left:0;top:0;overflow:visible}
      .ex-links path{fill:none;stroke:var(--gfx-muted);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
      /* @end */
      /* @gfx captions */
      .ex-cap{left:${(W - 1240) / 2}px;top:880px;width:1240px;height:88px;border-radius:20px;display:grid;place-items:center;
        background:color-mix(in srgb, var(--gfx-text) 92%, transparent)}
      .ex-cap-text{font-size:36px;font-weight:500;letter-spacing:-.005em;color:var(--gfx-bg);white-space:nowrap}
      /* @end */`;

    const check = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
    const card = (st, i) => `
       <!-- @gfx step-${i + 1} -->
       <div data-gfx="step-${i + 1}" class="ex ex-card" style="left:${CENTERS[i] - CARD_W / 2}px">
         <div class="ex-top">
           <div class="ex-icon"><svg viewBox="0 0 24 24">${ICONS[st.icon]}</svg></div>
           <div class="ex-num">${String(i + 1).padStart(2, '0')}</div>
         </div>
         <div class="ex-label">${st.label}</div>
         <div class="ex-text">${st.text}</div>
         <div class="ex-check">${check}</div>
       </div>
       <!-- @end -->`;
    // A link: a line between two cards with an arrowhead, one path so the head draws on last.
    const x0 = (i) => CENTERS[i] + CARD_W / 2 + 22;
    const x1 = (i) => CENTERS[i + 1] - CARD_W / 2 - 22;
    const link = (i) => `
         <!-- @gfx link-${i + 1} -->
         <path data-gfx="link-${i + 1}" d="M${x0(i)} ${MID_Y}H${x1(i)}M${x1(i) - 13} ${MID_Y - 13}L${x1(i)} ${MID_Y}L${x1(i) - 13} ${MID_Y + 13}"/>
         <!-- @end -->`;

    root.insertAdjacentHTML(
      'beforeend',
      `<!-- @gfx background -->
       <div data-gfx="background" style="position:absolute;inset:0"></div>
       <!-- @end -->
       <style>${css}</style>
       <!-- @gfx title -->
       <div data-gfx="title" class="ex ex-head">
         <div class="ex-kicker">${KICKER}</div>
         <div class="ex-title">${TITLE}</div>
       </div>
       <!-- @end -->
       <!-- @gfx highlight -->
       <div data-gfx="highlight" class="ex ex-hl"></div>
       <!-- @end -->
       <svg class="ex ex-links" width="${W}" height="${ctx.height}" viewBox="0 0 ${W} ${ctx.height}">${link(0)}${link(1)}</svg>
       ${STEPS.map(card).join('')}
       <!-- @gfx captions -->
       <div data-gfx="captions" class="ex ex-cap"><div class="ex-cap-text"></div></div>
       <!-- @end -->`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style)); // first child = bottom layer
    // @end
    capBar = root.querySelector('[data-gfx="captions"]');
    capText = capBar.firstElementChild;
    const q = (sel) => root.querySelector(sel);

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 800 } });
    // @gfx title
    tl.add(q('.ex-kicker'), { opacity: [0, 1], translateY: [24, 0] }, s(T.title));
    tl.add(q('.ex-title'), { opacity: [0, 1], translateY: [40, 0], duration: 900 }, s(T.title + 0.1));
    // @end

    STEPS.forEach((_, i) => {
      const at = T.steps[i];
      if (i > 0) {
        // @gfx link-1 link-2
        const [line] = svg.createDrawable(q(`[data-gfx="link-${i}"]`));
        tl.add(line, { draw: ['0 0', '0 1'], duration: s(LINK_LEAD - 0.05), ease: 'inOutCubic' }, s(at - LINK_LEAD));
        // @end
      }
      // @gfx step-1 step-2 step-3
      const cardEl = q(`[data-gfx="step-${i + 1}"]`);
      tl.add(cardEl, { opacity: [0, 1], translateY: [56, 0], scale: [0.94, 1], duration: 900 }, s(at));
      tl.add(cardEl.querySelector('.ex-icon'), { scale: [0.6, 1], rotate: [-12, 0], ease: 'outBack(1.8)', duration: 700 }, s(at + 0.12));
      // @end
      // @gfx highlight
      const hl = q('[data-gfx="highlight"]');
      if (i === 0) tl.add(hl, { opacity: [0, 1], scale: [1.06, 1], duration: 700 }, s(at + 0.3));
      else tl.add(hl, { translateX: [CENTERS[i - 1] - CENTERS[0], CENTERS[i] - CENTERS[0]], ease: 'inOutCubic', duration: 650 }, s(at + 0.05));
      // @end
    });

    // @gfx highlight
    tl.add(q('[data-gfx="highlight"]'), { opacity: [1, 0], scale: [1, 1.04], duration: 500, ease: 'inOutCubic' }, s(T.done - 0.1));
    // @end
    // @gfx step-1 step-2 step-3
    root.querySelectorAll('.ex-check').forEach((c, i) =>
      tl.add(c, { opacity: [0, 1], scale: [0.2, 1], ease: 'outBack(2.2)', duration: 600 }, s(T.done + 0.1 + i * 0.12)),
    );
    // @end

    // ---- Sound: cues sit on the frame things land (see the sound-design skill) ----
    // @gfx title
    ctx.cue(T.title + 0.25, 'pop', { id: 'title', gain: -10, pitch: pentatonic(0) });
    // @end
    // @gfx link-1 link-2
    [1, 2].forEach((i) =>
      ctx.cue(T.steps[i] - LINK_LEAD / 2, 'whoosh', { id: `link-${i}`, dur: LINK_LEAD, variant: 'air', gain: -10, x: (CENTERS[i - 1] + CENTERS[i]) / 2 }),
    );
    // @end
    // @gfx step-1 step-2 step-3
    STEPS.forEach((_, i) => ctx.cue(T.steps[i] + 0.12, 'pop', { id: `step-${i + 1}`, gain: -6, pitch: pentatonic(i + 2), x: CENTERS[i] }));
    [0, 1].forEach((i) => ctx.cue(T.done + 0.1 + i * 0.12 + 0.12, 'pop', { id: `done-${i + 1}`, gain: -12, pitch: pentatonic(i + 5), x: CENTERS[i] }));
    ctx.cue(T.done + 0.1 + 2 * 0.12 + 0.12, 'chime', { id: 'done', gain: -4, x: CENTERS[2] });
    // @end
    // @gfx captions
    CAPTIONS.slice(1).forEach((c, i) => ctx.cue(c.from, 'tick', { id: `caption-${i + 2}`, gain: -14 }));
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

    // @gfx captions
    // the bar fades in just before the first line; each line fades in/out at its edges (the last one holds)
    const clamp01 = (x) => Math.min(1, Math.max(0, x));
    const first = CAPTIONS[0].from;
    const bar = clamp01((t - (first - 0.3)) / 0.3);
    capBar.style.opacity = bar;
    capBar.style.transform = `translateY(${(1 - bar) * 16}px)`;
    const c = CAPTIONS.find((k) => t >= k.from && (t < k.to || k.to >= duration));
    const a = c ? Math.min(clamp01((t - c.from) / CAPTION_FADE), c.to >= duration ? 1 : clamp01((c.to - t) / CAPTION_FADE)) : 0;
    capText.textContent = c ? c.text : '';
    capText.style.opacity = a;
    capText.style.transform = `translateY(${(1 - a) * 10}px)`;
    // @end
  },
};
