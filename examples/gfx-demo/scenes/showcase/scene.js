// agent-gfx showcase (1920x1080, anime.js). A mocked gfx studio window shows the workflow in six chapters: prompt,
// objects & layers, review with Claude, sound, versions, render; bookended by an intro statement and an end card.
// Entrances / exits run on one anime.js timeline; the camera, cursor, typing, counters, panel switches, playhead and
// progress bars are derived from t in render() (pure functions of t). Copy and timing live in the constants below.
// `@gfx <name>` … `@end` comments mark each named element's code for the studio's "Open code".
import { createTimeline, stagger, svg } from 'animejs';
import { gridCss } from '/runner/lib/style.js';
import { clamp, lerp, progress, keyframes } from '/runner/lib/tween.js';
import { inOutCubic, outCubic, inOutSine } from '/runner/lib/ease.js';
import { hash } from '/runner/lib/rng.js';
import { pentatonic } from '/runner/lib/sfx.js';

// ---------- copy ----------
const STATEMENT = ['Motion graphics,', 'directed with your coding agent.'];
const STATEMENT_HL = 'coding agent';
const CAPTIONS = [
  // [number, index label, eyebrow, headline]
  ['01', 'Prompt', 'Prompt', 'Describe it. Claude writes the scene.'],
  ['02', 'Layers', 'Objects & layers', 'Every element is a layer you can grab.'],
  ['03', 'Review', 'Review together', 'Draw on the frame. Claude fixes it.'],
  ['04', 'Sound', 'Sound', 'Sound cues live next to the motion.'],
  ['05', 'Versions', 'Versions', 'Every change is a version.'],
  ['06', 'Render', 'Render', 'Same frames, every render.'],
];
const PROMPT = 'make a 12 s launch reel for Tally, a bill-splitting app. Dark, upbeat, one accent.';
const COMMENT = 'land the total on the ding, a touch bigger';
const NOTE = 'client review v2';
const TAGLINE = 'Motion graphics, directed with your coding agent.';
const FOOT = 'Open source · MIT · engine + gfx studio';
const MADE = 'This video was made in agent-gfx, too: scenes/showcase/scene.js';

// ---------- timing (s) ----------
const DUR = 38;
const CH = [3.0, 8.0, 14.0, 20.5, 26.0, 31.5]; // chapter starts
const OUTRO = 34.3; // screen + captions leave
const END = 34.8; // end card

// ---------- geometry ----------
const SCR = { x: 108, y: 181, w: 1600, h: 790 }; // the screen; the app inside uses the same 1600x790 coordinates
const ZOOM = 1.07; // the screen is drawn 7 % larger (1712x845 on the frame)
const TOP = 52; // top bar height
const DOCK = 560; // dock top
const LW = 320; // inspector width
const RX = 1220; // right panel left
const MINI = { x: 442, y: 118, w: 656, h: 369 }; // the Tally scene inside the viewer (app coords)
const TOTAL = { x: 947, y: 396, hw: 91, hh: 34 }; // centre + half size of the total's selection box
const ASK = { x: 779, y: 397 }; // the comment popover's Ask Claude button
const TRACK = 104; // inspector slider track width (x 120..224)
const TLX0 = 160;
const TLPX = 1430 / 12; // timeline: px per second of the 12 s Tally scene
const X = (s) => TLX0 + s * TLPX;
const LANE_Y = { hits: 670, motion: 700, ui: 730, accents: 760 }; // timeline lane tops (h 28)

// camera inside the screen: [t, scale, anchorX, anchorY] (anchor 0/1 = keep the left/top or right/bottom edge)
const CAM = [
  [0, 1, 1, 1],
  [13.85, 1, 1, 1],
  [14.55, 1.14, 1, 1],
  [20.25, 1.14, 1, 1],
  [21.0, 1.25, 0, 1],
  [25.85, 1.25, 0, 1],
  [26.6, 1.14, 1, 0],
  [31.3, 1.14, 1, 0],
  [32.0, 1, 1, 0],
];
// panels that stay bright per chapter (the rest dim)
const FOCUS = [
  ['top', 'insp', 'view', 'dock'],
  ['insp', 'view', 'rp'],
  ['view', 'rp', 'dock'],
  ['insp', 'view', 'dock'],
  ['top', 'view', 'rp'],
  ['top', 'rp'],
];

// the Tally scene's cues as shown on the timeline: [id, t, stem]
const TALLY_CUES = [
  ['title-hit', 0.6, 'hits'], ['split', 4.2, 'hits'], ['logo', 10.2, 'hits'],
  ['receipt-in', 1.4, 'motion'], ['total-in', 7.0, 'motion'], ['outro', 9.6, 'motion'],
  ['row-1', 2.0, 'ui'], ['row-2', 2.2, 'ui'], ['row-3', 2.4, 'ui'], ['row-4', 2.6, 'ui'], ['chip-1', 5.0, 'ui'], ['chip-2', 5.15, 'ui'], ['cta', 10.8, 'ui'],
  ['total-ding', 7.36, 'accents'], ['chime', 11.0, 'accents'],
];
const STEMS = ['hits', 'motion', 'ui', 'accents'];

// playhead (Tally seconds) over showcase time. The viewer plays at 1x whenever nobody is editing, and the Tally
// scene's own motion is a function of this value, so picture, timecode and timeline bar always agree.
// Plays from 0 once built, reaches the 07.36 ding as the comment tool opens and pauses there for the review,
// replays 5.8 -> 8.0 for the sound chapter, "Go to cue" jumps back to 7.36, then plays (looping) from 26 s.
const PH_PLAY = 26.0; // from here: 7.36 + (t - PH_PLAY), looping over the 12 s
const PH = [
  { t: 0, v: 0 }, { t: 7.1, v: 0 }, { t: 14.46, v: 7.36 }, { t: 20.75, v: 7.36 }, { t: 20.76, v: 5.8 },
  { t: 20.8, v: 5.8 }, { t: 23.0, v: 8.0 }, { t: 23.64, v: 8.0 }, { t: 23.65, v: 7.36 }, { t: PH_PLAY, v: 7.36 },
];
const phAt = (t) => (t <= PH_PLAY ? keyframes(t, PH) : (7.36 + (t - PH_PLAY)) % 12);
const PH_SWEEP = [20.8, 23.0, 5.8, 8.0];
const sweepAt = (s) => PH_SWEEP[0] + ((s - PH_SWEEP[2]) / (PH_SWEEP[3] - PH_SWEEP[2])) * (PH_SWEEP[1] - PH_SWEEP[0]);

// ---------- cursor ----------
const CUR0 = [720, 250];
const T_DRAG = [9.9, 10.9]; // drag the total's corner: scale 1 -> 1.22
const SCALE_TO = 1.22;
const T_DRAW = [15.2, 16.0]; // markup stroke
const T_REVERB = [24.6, 25.25];
const REVERB = [0.3, 0.62];
const WIPE = [
  { t: 0, v: 0.5 }, { t: 29.9, v: 0.5 }, { t: 30.45, v: 0.8, ease: inOutCubic }, { t: 31.1, v: 0.26, ease: inOutCubic },
];
const scaleAt = (t) => 1 + (SCALE_TO - 1) * inOutCubic(progress(t, ...T_DRAG));
const reverbAt = (t) => lerp(REVERB[0], REVERB[1], inOutCubic(progress(t, ...T_REVERB)));
const corner = (s) => [TOTAL.x + TOTAL.hw * s, TOTAL.y + TOTAL.hh * s];
let markPts = []; // markup stroke points + cumulative length (filled in setup)
let markLen = 0;
const markAt = (k) => {
  const d = k * markLen;
  let i = 1;
  while (i < markPts.length - 1 && markPts[i].d < d) i++;
  const a = markPts[i - 1];
  const b = markPts[i];
  const u = b.d === a.d ? 0 : clamp((d - a.d) / (b.d - a.d));
  return [lerp(a.x, b.x, u), lerp(a.y, b.y, u)];
};
// moves: { a, b, to } eased inOutCubic from the previous position, or { a, b, fn(k, t) } (follows a value)
const MOVES = [
  { a: 8.6, b: 9.0, to: [TOTAL.x, TOTAL.y] },
  { a: 9.4, b: 9.8, to: corner(1) },
  { a: T_DRAG[0], b: T_DRAG[1], fn: (k, t) => corner(scaleAt(t)) },
  { a: 11.3, b: 11.9, to: [160, 369] },
  { a: 12.3, b: 12.9, to: [610, 470] },
  { a: 14.2, b: 14.8, to: [1018, 352] },
  { a: T_DRAW[0], b: T_DRAW[1], fn: (k) => markAt(inOutSine(k)) },
  { a: 16.1, b: 16.5, to: [700, 520] },
  { a: 17.45, b: 17.85, to: [ASK.x, ASK.y] },
  { a: 18.2, b: 18.8, to: [1160, 440] },
  { a: 23.0, b: 23.5, to: [1052, 768] },
  { a: 23.9, b: 24.45, to: [120 + TRACK * REVERB[0], 476] },
  { a: T_REVERB[0], b: T_REVERB[1], fn: (k, t) => [120 + TRACK * reverbAt(t), 476] },
  { a: 25.35, b: 25.68, to: [113, 714] },
  { a: 26.05, b: 26.7, to: [1346, 153] },
  { a: 27.9, b: 28.25, to: [1524, 153] },
  { a: 28.9, b: 29.35, to: [1372, 519] },
  { a: 29.5, b: 29.85, to: [MINI.x + MINI.w * 0.5, 302] },
  { a: 29.9, b: 31.1, fn: (k, t) => [MINI.x + MINI.w * keyframes(t, WIPE), 302] },
  { a: 31.3, b: 32.0, to: [1408, 26] },
  { a: 32.3, b: 32.9, to: [1300, 330] },
];
const CLICKS = [
  [9.1, TOTAL.x, TOTAL.y, 'select'], [9.9, ...corner(1), 'drag'], [12.0, 160, 369, 'code'], [15.0, 1018, 352, 'pin'],
  [17.9, ASK.x, ASK.y, 'ask'], [23.6, 1052, 768, 'cue'], [24.55, 120 + TRACK * REVERB[0], 476, 'knob'], [25.75, 113, 714, 'mute'],
  [26.8, 1346, 153, 'note'], [28.3, 1524, 153, 'save'], [29.4, 1372, 519, 'compare'], [29.88, MINI.x + MINI.w * 0.5, 302, 'wipe'],
  [32.1, 1408, 26, 'render'],
];
const DRAGS = [T_DRAG, T_DRAW, T_REVERB, [29.88, 31.1]];
const CUR_VIS = [8.4, 34.0];

// ---------- small helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const typed = (t, a, b, s) => s.slice(0, Math.round(progress(t, a, b) * s.length));
const fade = (t, a, b, f = 0.2) => (a <= 0 ? 1 : outCubic(progress(t, a, a + f))) * (b >= DUR ? 1 : 1 - progress(t, b - f, b));
// view switches: [[t, view], ...] -> opacity of `view` at t (0.22 s crossfade)
function viewOp(t, sw, view) {
  let i = 0;
  while (i < sw.length - 1 && t >= sw[i + 1][0]) i++;
  const k = i === 0 ? 1 : outCubic(progress(t, sw[i][0], sw[i][0] + 0.22));
  return (sw[i][1] === view ? k : 0) + (i > 0 && sw[i - 1][1] === view ? 1 - k : 0);
}
// tab indicator: [[t, index], ...] -> [left, width]
function tabAt(t, sw, tabs) {
  let i = 0;
  while (i < sw.length - 1 && t >= sw[i + 1][0]) i++;
  const cur = tabs[sw[i][1]];
  if (i === 0) return cur;
  const prev = tabs[sw[i - 1][1]];
  const k = inOutCubic(progress(t, sw[i][0], sw[i][0] + 0.28));
  return [lerp(prev[0], cur[0], k), lerp(prev[1], cur[1], k)];
}
const chapterAt = (t) => CH.reduce((c, s, i) => (t >= s - 0.1 ? i : c), 0);

const ICON = {
  check: '<svg viewBox="0 0 16 16" class="ic"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eye: '<svg viewBox="0 0 20 20" class="ic"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="10" cy="10" r="2.4" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 16 16" class="ic"><path d="M5 3.2v9.6L13 8z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 16 16" class="ic"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"/></svg>',
  spark: '<svg viewBox="0 0 16 16" class="ic"><path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5 6.4 9.6 1.5 8l4.9-1.6z" fill="currentColor"/></svg>',
  chev: '<svg viewBox="0 0 12 12" class="ic chev"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  swap: '<svg viewBox="0 0 16 16" class="ic"><path d="M3 5.5h10l-3-3M13 10.5H3l3 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  clip: '<svg viewBox="0 0 16 16" class="ic"><path d="M10.5 4.5l-5 5a1.6 1.6 0 002.3 2.3l5.4-5.4a3 3 0 00-4.3-4.3L3.6 7.4a4.4 4.4 0 006.2 6.2l4-4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  tool: '<svg viewBox="0 0 16 16" class="ic"><path d="M10 2.5a3.5 3.5 0 00-3.3 4.6L2.5 11.3l2.2 2.2 4.2-4.2A3.5 3.5 0 0013.5 6l-2 .5-1-1 .5-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>',
};
const MARK = (cls) => `<svg viewBox="0 0 120 120" class="${cls}">
  <rect x="4" y="4" width="112" height="112" rx="30" fill="var(--gfx-accent)"/>
  <path class="mark-curve" d="M28 90 C 56 90, 58 32, 92 30" fill="none" stroke="var(--gfx-text)" stroke-width="7" stroke-linecap="round"/>
  <g transform="rotate(45 28 90)"><rect class="mark-key" x="20" y="82" width="16" height="16" rx="3" fill="var(--gfx-text)"/></g>
  <g transform="rotate(45 92 30)"><rect class="mark-key" x="84" y="22" width="16" height="16" rx="3" fill="var(--gfx-text)"/></g>
</svg>`;

// ---------- the little Tally scene shown in the viewer ----------
const SPLIT = [['A', 'tally-accent'], ['M', 'tally-amber'], ['J', 'ui']]; // the three people splitting the bill
const TALLY_ROWS = [['Oat milk', '2.40'], ['Coffee beans', '8.90'], ['Dish soap', '3.15'], ['Bananas', '1.60']];
const tallyHTML = (title) => `
  <div class="t-bg"></div><div class="t-glow-move"><div class="t-glow"></div></div>
  <div class="t-eyebrow">TALLY</div>
  <div class="t-title">${title.map((l) => `<span class="t-mask"><span class="t-ln">${esc(l)}</span></span>`).join('')}</div>
  <div class="t-sub">Bills, shared in seconds.</div>
  <div class="t-avs">${SPLIT.map(([n, c]) => `<div class="t-av"><div class="t-av-in"><i style="background:var(--gfx-${c})">${n}</i><span>$14.02</span></div></div>`).join('')}<div class="t-ring"></div></div>
  <div class="t-card"><div class="t-scan"></div><div class="t-head"><span>RECEIPT</span><span>GREENLEAF</span></div>
    ${TALLY_ROWS.map(([n, p]) => `<div class="t-row"><span>${n}</span><span>${p}</span></div>`).join('')}
    <div class="t-rule"></div><div class="t-tlabel">Total · split 3 ways</div></div>
  <div class="t-total-tweak"><div class="t-total-in"><div class="t-total-bounce">$42.05</div></div></div>`;

// waveform polygon for one cue (timeline lane, lane-local y with centre 14)
function wavePath(x, stem, seed, len) {
  const top = [];
  const n = Math.max(6, Math.round(len / 2));
  const pre = stem === 'motion' ? len * 0.65 : 0; // whooshes swell into the hit
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const px = x - pre + u * len;
    const rel = px - x;
    let env = rel < 0 ? Math.pow(1 + rel / pre, 2) : Math.exp((-rel / len) * (stem === 'accents' ? 2.2 : 4));
    if (stem === 'ui') env = rel < 0 ? 0 : Math.exp(-rel / 5);
    const amp = (stem === 'hits' ? 12 : stem === 'ui' ? 9 : 10) * env * (0.45 + 0.55 * hash(i, seed));
    top.push([px, 14 - amp]);
  }
  const bottom = top.map(([px, y]) => [px, 28 - y]).reverse();
  return 'M' + [...top, ...bottom].map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join(' L') + ' Z';
}

let tl;
const el = {}; // elements written in render

export default {
  setup(ctx) {
    const { root, style, width: W, height: H } = ctx;

    // markup stroke: a hand-drawn loop around the total (deterministic wobble)
    markPts = [];
    const N = 80;
    for (let i = 0; i <= N; i++) {
      const a = -2.55 + (i / N) * Math.PI * 2 * 1.1;
      const r = 1 + 0.035 * Math.sin(3 * a + 1.2) + 0.02 * (hash(i, 7) - 0.5);
      const ex = 128 * r * Math.cos(a);
      const ey = 54 * r * Math.sin(a);
      const rot = -0.07;
      markPts.push({ x: TOTAL.x + ex * Math.cos(rot) - ey * Math.sin(rot), y: TOTAL.y + ex * Math.sin(rot) + ey * Math.cos(rot), d: 0 });
    }
    markLen = 0;
    for (let i = 1; i < markPts.length; i++) {
      markLen += Math.hypot(markPts[i].x - markPts[i - 1].x, markPts[i].y - markPts[i - 1].y);
      markPts[i].d = markLen;
    }
    const markD = 'M' + markPts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' L');

    const tabsRP = [['Comments', '<span class="cnt rp-cnt">0</span>'], ['Layers', ''], ['Versions', ''], ['Renders', '']];
    const LAYERS = [
      ['total', 'div.total "$42.05"'], ['title', 'div.title "Split it fair."'], ['receipt', 'div.card'],
      ['rows (4)', ''], ['glow', 'div.glow'], ['background', 'div.layer'],
    ];
    const VERSIONS = [
      ['fix c1 · total lands on the ding', 'Claude', 'claude', '2 min ago · 1 file · a41f9c2'],
      ['Before Claude', 'Auto', 'auto', '3 min ago · 1 file · 9e02b1d'],
      ['first cut', 'You', 'you', '12 min ago · 14 files · 12c4acd'],
    ];

    root.insertAdjacentHTML(
      'beforeend',
      `<style>
        .sc{font-family:var(--gfx-font-sans);color:var(--gfx-text)}
        .sc *{box-sizing:border-box}
        .mark-key{transform-box:fill-box;transform-origin:center}
        .ic{width:1em;height:1em;display:inline-block;vertical-align:-0.14em;flex:none}
        .mono{font-family:var(--gfx-font-mono)}
        /* @gfx bg-glow */
        [data-gfx="bg-glow"]{position:absolute;width:1800px;height:1100px;left:60px;top:-520px;border-radius:50%;
          background:radial-gradient(closest-side,color-mix(in srgb,var(--gfx-accent) 16%,transparent),transparent)}
        /* @end */
        /* @gfx intro */
        [data-gfx="intro"]{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .intro-mark{width:112px;height:112px;margin-bottom:28px}
        .intro-name{font:500 26px var(--gfx-font-mono);color:var(--gfx-muted);letter-spacing:.06em;margin-bottom:34px}
        .intro-st{font-weight:700;font-size:92px;line-height:1.06;letter-spacing:-0.035em;text-align:center}
        .mask{display:block;overflow:hidden;padding-bottom:.12em;margin-bottom:-.12em}
        .ln{display:block;white-space:nowrap}
        .hl{color:var(--gfx-accent)}
        /* @end */
        /* @gfx captions */
        .cap{position:absolute;left:${SCR.x}px;top:52px;width:1200px}
        .cap-eyebrow{display:flex;align-items:center;gap:12px;font:500 19px var(--gfx-font-mono);letter-spacing:.08em;
          text-transform:uppercase;color:var(--gfx-muted)}
        .cap-eyebrow b{color:var(--gfx-accent);font-weight:500}
        .cap-eyebrow i{width:28px;height:2px;background:var(--gfx-border)}
        .cap-head{font-weight:700;font-size:54px;line-height:1.1;letter-spacing:-0.03em;margin-top:14px;white-space:nowrap}
        /* @end */
        /* @gfx chapters */
        [data-gfx="chapters"]{position:absolute;right:${W - SCR.x - SCR.w * ZOOM}px;top:56px;display:flex;gap:26px;
          font:500 16px var(--gfx-font-mono);color:var(--gfx-faint)}
        .chap{position:relative;padding-bottom:10px}
        .chap u{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--gfx-accent);text-decoration:none;
          transform-origin:left;transform:scaleX(0)}
        /* @end */
        /* @gfx screen */
        .screen-float{position:absolute;left:${SCR.x}px;top:${SCR.y}px;width:${SCR.w * ZOOM}px;height:${SCR.h * ZOOM}px}
        [data-gfx="screen"]{position:absolute;left:0;top:0;width:${SCR.w}px;height:${SCR.h}px;transform:scale(${ZOOM});transform-origin:0 0;border-radius:18px;overflow:hidden;background:var(--gfx-bg);
          border:1px solid var(--gfx-border);box-shadow:0 50px 140px rgb(0 0 0 / .65),0 0 0 1px rgb(255 255 255 / .02)}
        .app{position:absolute;left:0;top:0;width:${SCR.w}px;height:${SCR.h}px;transform-origin:0 0;font-size:16px}
        .panel{position:absolute;overflow:hidden}
        .dim{position:absolute;inset:0;background:var(--gfx-bg);opacity:0;z-index:30}
        .btn{position:absolute;height:32px;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 13px;
          border-radius:8px;border:1px solid var(--gfx-input);background:var(--gfx-surface);font-size:15px;font-weight:500;white-space:nowrap}
        .btn.primary{background:var(--gfx-accent);border-color:var(--gfx-accent);color:var(--gfx-text)}
        .btn.ghost{background:none;border-color:transparent;color:var(--gfx-muted)}
        .kbd{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 4px;border-radius:4px;
          border:1px solid var(--gfx-input);font:500 11px var(--gfx-font-mono);color:var(--gfx-muted)}
        .cnt{font:500 12px var(--gfx-font-mono);color:var(--gfx-muted);margin-left:6px}
        .badge{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font:500 12px var(--gfx-font-mono)}
        .chev{width:.8em;height:.8em;opacity:.7}
        .sec{font:500 13px var(--gfx-font-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--gfx-muted)}
        .field{position:absolute;left:16px;right:16px;height:34px;display:flex;align-items:center}
        .field > span:first-child{width:104px;flex:none;color:var(--gfx-muted);font-size:15px}
        .inp{flex:1;height:32px;border-radius:7px;border:1px solid var(--gfx-input);background:var(--gfx-surface);display:flex;
          align-items:center;justify-content:flex-end;padding:0 12px;font:400 15px var(--gfx-font-mono)}
        .tabs{position:absolute;left:0;right:0;top:0;height:44px;border-bottom:1px solid var(--gfx-border)}
        .tab{position:absolute;top:13px;font-size:15px;font-weight:500;color:var(--gfx-muted);white-space:nowrap}
        .tab-ind{position:absolute;bottom:-1px;height:2px;background:var(--gfx-accent)}
        .view{position:absolute;left:0;right:0;bottom:0}
        /* @end */
        /* @gfx topbar */
        [data-gfx="topbar"]{left:0;top:0;width:${SCR.w}px;height:${TOP}px;background:var(--gfx-chrome);border-bottom:1px solid var(--gfx-border)}
        [data-gfx="topbar"] .btn{top:10px}
        .tb-left{position:absolute;left:16px;top:0;height:${TOP}px;display:flex;align-items:center;gap:10px;font-size:15px;font-weight:500}
        .tb-logo{width:30px;height:22px;border-radius:6px;background:var(--gfx-accent);position:relative;margin-right:4px}
        .tb-logo i{position:absolute;left:7px;top:8px;width:16px;height:6px;border-radius:2px;background:var(--gfx-text);opacity:.9}
        .tb-sep{color:var(--gfx-faint)}
        .seg{position:absolute;top:10px;height:32px;display:flex;border:1px solid var(--gfx-input);border-radius:8px;overflow:hidden;font-size:15px;font-weight:500}
        .seg span{padding:0 14px;display:flex;align-items:center;color:var(--gfx-muted)}
        .seg span.on{background:var(--gfx-surface-raised);color:var(--gfx-text)}
        .tb-claude .ic{color:var(--gfx-warning)}
        .tb-badge{background:var(--gfx-warning);color:var(--gfx-bg);height:18px;padding:0 6px;font-weight:600;opacity:0}
        .tb-dot{width:7px;height:7px;border-radius:50%;background:var(--gfx-text);opacity:0}
        /* @end */
        /* @gfx inspector */
        [data-gfx="inspector"]{left:0;top:${TOP}px;width:${LW}px;height:${DOCK - TOP}px;border-right:1px solid var(--gfx-border);background:var(--gfx-bg)}
        .kv{position:absolute;left:20px;right:20px;display:flex;font-size:15px}
        .kv > span:first-child{width:110px;flex:none;color:var(--gfx-muted)}
        .kv > span:last-child{font-family:var(--gfx-font-mono)}
        .el-name{position:absolute;left:16px;top:18px;font:600 22px var(--gfx-font-mono);display:flex;align-items:center;gap:12px}
        .el-type{position:absolute;left:16px;top:56px;font:400 13px var(--gfx-font-mono);color:var(--gfx-muted)}
        .b-tweak{border:1px solid var(--gfx-accent);color:var(--gfx-accent-soft);opacity:0}
        .b-stem{background:color-mix(in srgb,var(--gfx-accents) 18%,transparent);color:var(--gfx-accents)}
        .b-edit{border:1px solid var(--gfx-accent);color:var(--gfx-accent-soft);opacity:0}
        .slider{position:absolute;left:16px;right:16px;height:30px;display:flex;align-items:center;font-size:15px}
        .slider > span:first-child{width:104px;flex:none;color:var(--gfx-muted)}
        .track{position:relative;flex:none;width:${TRACK}px;height:4px;border-radius:2px;background:var(--gfx-input);margin-right:12px}
        .track b{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--gfx-accent)}
        .knob{position:absolute;top:-6px;width:16px;height:16px;margin-left:-8px;border-radius:50%;background:var(--gfx-text);box-shadow:0 1px 4px rgb(0 0 0 / .5)}
        .slider .inp{flex:none;width:60px;height:28px;font-size:14px}
        .slider.hot > span:first-child{color:var(--gfx-accent-soft)}
        /* @end */
        /* @gfx viewer */
        [data-gfx="viewer"]{left:${LW}px;top:${TOP}px;width:${RX - LW}px;height:${DOCK - TOP}px;background:var(--gfx-bg)}
        .vt{position:absolute;top:8px;height:30px;font-size:14px}
        .vt.on{border-color:var(--gfx-accent);color:var(--gfx-accent-soft)}
        .stage{position:absolute;left:0;right:0;top:44px;bottom:56px;background:color-mix(in srgb,var(--gfx-bg) 70%,black)}
        .placeholder{position:absolute;left:${MINI.x - LW}px;top:${MINI.y - TOP - 44}px;width:${MINI.w}px;height:${MINI.h}px;
          border:1px dashed var(--gfx-input);border-radius:6px;display:flex;align-items:center;justify-content:center;
          font:400 15px var(--gfx-font-mono);color:var(--gfx-faint)}
        .transport{position:absolute;left:0;right:0;bottom:0;height:56px;border-top:1px solid var(--gfx-border);display:flex;align-items:center;padding:0 18px;gap:14px}
        .playbtn{width:36px;height:36px;border-radius:50%;background:var(--gfx-accent);display:flex;align-items:center;justify-content:center;font-size:15px}
        .tc{font:500 22px var(--gfx-font-mono)}
        .tc-of{font:400 14px var(--gfx-font-mono);color:var(--gfx-muted)}
        .transport .btn{position:static;height:30px;font-size:14px}
        .tr-right{margin-left:auto;display:flex;gap:8px}
        /* @end */
        /* @gfx tally tally-total */
        .tally{position:absolute;left:${MINI.x}px;top:${MINI.y}px;width:${MINI.w}px;height:${MINI.h}px;overflow:hidden;border-radius:4px;font-family:var(--gfx-font-sans)}
        .t-bg{position:absolute;inset:0;background:var(--gfx-tally-bg);
          background-image:linear-gradient(var(--gfx-tally-surface) 1px,transparent 1px),linear-gradient(90deg,var(--gfx-tally-surface) 1px,transparent 1px);
          background-size:32px 32px}
        .t-glow{position:absolute;left:250px;top:-120px;width:560px;height:560px;border-radius:50%;
          background:radial-gradient(closest-side,color-mix(in srgb,var(--gfx-tally-accent) 34%,transparent),transparent)}
        .t-eyebrow{position:absolute;left:40px;top:84px;font:500 12px var(--gfx-font-mono);letter-spacing:.18em;color:var(--gfx-tally-accent)}
        .t-title{position:absolute;left:38px;top:108px;font-weight:700;font-size:48px;line-height:1.04;letter-spacing:-0.035em}
        .t-mask{display:block;overflow:hidden;padding-bottom:.1em;margin-bottom:-.1em}
        .t-ln{display:block;white-space:nowrap}
        .t-sub{position:absolute;left:40px;top:230px;font-size:15px;color:var(--gfx-muted)}
        .t-glow-move{position:absolute;inset:0}
        .t-avs{position:absolute;left:40px;top:274px;display:flex;gap:14px}
        .t-av-in{display:flex;flex-direction:column;align-items:center;gap:6px}
        .t-av i{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:700 14px var(--gfx-font-sans);
          font-style:normal;color:var(--gfx-tally-bg);border:2px solid var(--gfx-tally-bg)}
        .t-av span{font:500 11px var(--gfx-font-mono);color:var(--gfx-muted)}
        .t-ring{position:absolute;left:-4px;top:-4px;width:44px;height:44px;border-radius:50%;border:2px solid var(--gfx-tally-accent)}
        .t-scan{position:absolute;left:10px;right:10px;height:28px;border-radius:6px;z-index:-1;
          background:color-mix(in srgb,var(--gfx-tally-accent) 16%,transparent)}
        .t-card{position:absolute;left:388px;top:40px;width:232px;height:294px;border-radius:14px;background:var(--gfx-tally-surface);
          border:1px solid var(--gfx-tally-border);box-shadow:0 18px 40px rgb(0 0 0 / .45)}
        .t-head{display:flex;justify-content:space-between;margin:16px 18px 12px;font:500 10px var(--gfx-font-mono);letter-spacing:.12em;color:var(--gfx-muted)}
        .t-row{display:flex;justify-content:space-between;margin:0 18px;height:30px;align-items:center;font-size:13px;
          border-top:1px solid color-mix(in srgb,var(--gfx-tally-border) 60%,transparent)}
        .t-row span:last-child{font-family:var(--gfx-font-mono);color:var(--gfx-muted)}
        .t-rule{margin:8px 18px 0;height:1px;background:var(--gfx-tally-border)}
        .t-tlabel{margin:10px 18px 0;font:500 10px var(--gfx-font-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--gfx-muted)}
        .t-total-tweak{position:absolute;left:420px;top:250px;width:170px;height:56px}
        .t-total-in,.t-total-bounce{position:absolute;inset:0}
        .t-total-bounce{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:44px;letter-spacing:-0.03em;color:var(--gfx-tally-amber)}
        .tally-badge{position:absolute;left:${MINI.x + MINI.w - 84}px;top:${MINI.y + 10}px;font:500 10px var(--gfx-font-mono);letter-spacing:.1em;
          padding:3px 7px;border-radius:4px;background:rgb(0 0 0 / .5);color:var(--gfx-muted)}
        /* @end */
        /* @gfx rpanel */
        [data-gfx="rpanel"]{left:${RX}px;top:${TOP}px;width:${SCR.w - RX}px;height:${DOCK - TOP}px;border-left:1px solid var(--gfx-border);background:var(--gfx-bg)}
        .lrow{position:absolute;left:0;right:0;height:38px;display:flex;align-items:center;padding:0 16px;gap:12px}
        .lrow .cb{width:14px;height:14px;border-radius:3px;border:1.5px solid var(--gfx-accent);flex:none}
        .lrow .nm{font:500 16px var(--gfx-font-mono)}
        .lrow .ds{font:400 13px var(--gfx-font-mono);color:var(--gfx-muted);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .lrow .ic{color:var(--gfx-muted);font-size:18px}
        .lrow.grp .nm{color:var(--gfx-warning)}
        .lsel{position:absolute;left:0;right:0;top:132px;height:38px;background:color-mix(in srgb,var(--gfx-accent) 18%,transparent);
          border-left:3px solid var(--gfx-accent);opacity:0}
        .crow{position:absolute;left:12px;right:12px;top:${152 - 96}px;border-radius:10px;padding:12px 14px;
          background:color-mix(in srgb,var(--gfx-accent) 10%,transparent);border-left:3px solid var(--gfx-accent)}
        .crow .meta{font:400 13px var(--gfx-font-mono);color:var(--gfx-muted);display:flex;gap:10px}
        .crow .txt{font-size:15px;line-height:1.35;margin-top:6px;padding-right:72px}
        .cdot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:8px;vertical-align:1px;background:var(--gfx-note)}
        .cdot.ok{position:absolute;left:14px;top:41px;background:var(--gfx-accent2);opacity:0}
        .cthumb{position:absolute;right:12px;top:12px;width:64px;height:40px;border-radius:5px;background:var(--gfx-tally-bg);overflow:hidden;border:1px solid var(--gfx-border)}
        .cthumb i{position:absolute;left:24px;top:14px;width:32px;height:14px;border:2px solid var(--gfx-markup);border-radius:50%}
        .creply{position:absolute;left:28px;right:12px;top:${252 - 96}px;border-radius:10px;padding:10px 14px;background:var(--gfx-surface-raised);
          border:1px solid var(--gfx-border);font-size:15px;line-height:1.35}
        .creply .who{font:500 13px var(--gfx-font-mono);color:var(--gfx-warning);display:flex;align-items:center;gap:6px;margin-bottom:4px}
        .resolved{font:500 12px var(--gfx-font-mono);color:var(--gfx-accent2);opacity:0}
        .vrow{position:absolute;left:0;right:0;height:62px;padding:10px 16px 0 72px}
        .vrow .th{position:absolute;left:16px;top:12px;width:44px;height:30px;border-radius:5px;background:var(--gfx-tally-bg);border:1px solid var(--gfx-border)}
        .vrow .th i{position:absolute;right:6px;bottom:6px;width:16px;height:7px;border-radius:2px;background:var(--gfx-tally-amber)}
        .vrow .tt{font-size:15px;font-weight:500;white-space:nowrap}
        .vrow .mt{font:400 12px var(--gfx-font-mono);color:var(--gfx-muted);margin-top:5px;display:flex;gap:8px;align-items:center}
        .who-claude{background:color-mix(in srgb,var(--gfx-warning) 18%,transparent);color:var(--gfx-warning);height:18px}
        .who-auto{background:var(--gfx-surface-raised);color:var(--gfx-muted);height:18px}
        .who-you{background:color-mix(in srgb,var(--gfx-accent) 22%,transparent);color:var(--gfx-accent-soft);height:18px}
        .vnew{background:color-mix(in srgb,var(--gfx-accent) 12%,transparent);border-left:3px solid var(--gfx-accent)}
        .vdet{position:absolute;left:0;right:0;top:${404 - 96}px;bottom:0;border-top:1px solid var(--gfx-border);padding:14px 16px}
        .vdet .f{font:400 13px var(--gfx-font-mono);margin-top:8px;display:flex;gap:8px}
        .vdet .f .m{color:var(--gfx-warning)} .vdet .f .p{color:var(--gfx-accent2)} .vdet .f .n{color:var(--gfx-markup)}
        .vdet .btn{top:auto;height:30px;font-size:14px}
        .rcard{position:absolute;left:12px;right:12px;height:100px;border-radius:10px;border:1px solid var(--gfx-border);background:var(--gfx-surface);padding:12px 14px}
        .rcard .tt{font-size:16px;font-weight:600;display:flex;justify-content:space-between}
        .rcard .mt{font:400 12px var(--gfx-font-mono);color:var(--gfx-muted);margin-top:5px}
        .rbar{margin-top:14px;height:6px;border-radius:3px;background:var(--gfx-input);overflow:hidden}
        .rbar b{display:block;height:100%;width:100%;background:var(--gfx-accent);transform-origin:left;transform:scaleX(0)}
        .rstat{font:400 12px var(--gfx-font-mono);color:var(--gfx-muted);margin-top:8px}
        .rdone{color:var(--gfx-accent2);opacity:0;font-size:15px}
        .fmts{position:absolute;left:12px;right:12px;top:${376 - TOP}px;display:flex;flex-wrap:wrap;gap:8px}
        .fmts span{font:500 13px var(--gfx-font-mono);padding:5px 10px;border-radius:6px;border:1px solid var(--gfx-input);color:var(--gfx-muted)}
        .fmts span.on{border-color:var(--gfx-accent);color:var(--gfx-accent-soft)}
        /* @end */
        /* @gfx dock */
        [data-gfx="dock"]{left:0;top:${DOCK}px;width:${SCR.w}px;height:${SCR.h - DOCK}px;border-top:1px solid var(--gfx-border);background:var(--gfx-bg)}
        [data-gfx="dock"] .tabs{height:34px}
        [data-gfx="dock"] .tab{top:8px;font-size:14px}
        .term{position:absolute;left:0;right:0;top:34px;bottom:0;padding:10px 18px;font:400 16px/25px var(--gfx-font-mono);white-space:pre}
        .term .mut{color:var(--gfx-muted)} .term .ok{color:var(--gfx-accent2)} .term .acc{color:var(--gfx-accent-soft)} .term .warn{color:var(--gfx-warning)}
        .term .bul{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--gfx-warning);margin:0 6px 1px 3px}
        .caret{display:inline-block;width:9px;height:18px;background:var(--gfx-text);vertical-align:-3px;margin-left:1px}
        .t3{position:absolute;left:330px;width:880px;top:34px;bottom:0}
        .t3 .hd{position:absolute;left:0;top:8px;font:400 12px var(--gfx-font-mono);color:var(--gfx-muted);display:flex;gap:10px;align-items:center}
        .t3 .hd b{color:var(--gfx-text);font-weight:500}
        .t3 .ub{position:absolute;right:0;top:30px;max-width:620px;padding:7px 14px;border-radius:12px;background:var(--gfx-surface-raised);
          border:1px solid var(--gfx-border);font-size:15px;display:flex;gap:10px;align-items:center}
        .t3 .ub .att{font:400 12px var(--gfx-font-mono);color:var(--gfx-muted);display:flex;gap:4px;align-items:center}
        .t3 .tr{position:absolute;left:0;font:400 14px var(--gfx-font-mono);color:var(--gfx-muted);display:flex;gap:10px;align-items:center;white-space:nowrap}
        .t3 .tr .ic{color:var(--gfx-faint)}
        .t3 .tr b{color:var(--gfx-text);font-weight:400}
        .t3 .am{position:absolute;left:0;font-size:15px;display:flex;gap:10px;align-items:center}
        .t3 .am .ic{color:var(--gfx-warning)}
        .tl{position:absolute;left:0;right:0;top:34px;bottom:0}
        .tl-lab{position:absolute;left:0;width:150px;font:500 12px var(--gfx-font-mono);letter-spacing:.06em;color:var(--gfx-muted);display:flex;align-items:center;gap:6px;padding-left:14px}
        .tl-lab .sw{width:9px;height:9px;border-radius:2px}
        .tl-lab .ms{margin-left:auto;margin-right:8px;display:flex;gap:4px}
        .tl-lab .ms span{width:20px;height:18px;border-radius:4px;border:1px solid var(--gfx-input);display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--gfx-text)}
        .tl-row{position:absolute;left:${TLX0 - 6}px;right:6px;border-top:1px solid var(--gfx-border)}
        .tl-tick{position:absolute;top:0;font:400 11px var(--gfx-font-mono);color:var(--gfx-muted);padding-left:4px;border-left:1px solid var(--gfx-input);height:12px;line-height:12px}
        .tl-frame{position:absolute;top:${618 - DOCK - 34}px;height:30px;border-radius:3px;background:var(--gfx-tally-bg);overflow:hidden}
        .tl-frame i{position:absolute;height:4px;border-radius:2px;background:var(--gfx-text);opacity:.7}
        .tl-frame b{position:absolute;width:26px;height:26px;border-radius:50%;background:color-mix(in srgb,var(--gfx-tally-accent) 45%,transparent);filter:blur(4px)}
        .tl-cdia{position:absolute;width:10px;height:10px;transform:rotate(45deg);background:var(--gfx-note)}
        .tl-cdia.ok{background:var(--gfx-accent2);opacity:0}
        .lane{position:absolute;left:0;width:${SCR.w}px;height:28px}
        .lane svg{position:absolute;left:0;top:0;overflow:visible}
        .cue-lab{position:absolute;font:400 11px var(--gfx-font-mono);line-height:12px;padding:0 4px;border-radius:3px;border:1px solid;white-space:nowrap;background:var(--gfx-bg)}
        .cue-sel{position:absolute;border:2px solid var(--gfx-text);border-radius:4px;opacity:0}
        .playhead{position:absolute;top:0;bottom:0;left:0;width:2px;margin-left:-1px;background:var(--gfx-text);z-index:5}
        .playhead i{position:absolute;left:-5px;top:0;width:12px;height:12px;border-radius:2px;background:var(--gfx-text)}
        /* @end */
        /* @gfx overlays */
        .ov{position:absolute;z-index:20}
        .sel{left:${TOTAL.x - TOTAL.hw}px;top:${TOTAL.y - TOTAL.hh}px;width:${TOTAL.hw * 2}px;height:${TOTAL.hh * 2}px;border:2px solid var(--gfx-accent);opacity:0}
        .sel i{position:absolute;width:10px;height:10px;background:var(--gfx-text);border:2px solid var(--gfx-accent);margin:-6px 0 0 -6px}
        .sel .lab{position:absolute;left:-2px;top:-30px;padding:3px 8px;border-radius:4px 4px 0 0;background:var(--gfx-accent);
          font:500 13px var(--gfx-font-mono);white-space:nowrap}
        .codecard{left:336px;top:262px;width:520px;border-radius:12px;background:var(--gfx-surface-raised);border:1px solid var(--gfx-input);
          box-shadow:0 24px 70px rgb(0 0 0 / .6);padding:14px 16px 16px;opacity:0}
        .codecard .hd{display:flex;gap:10px;align-items:center;font:500 13px var(--gfx-font-mono);color:var(--gfx-muted);margin-bottom:10px}
        .codecard .hd b{color:var(--gfx-text);font-weight:600;font-size:15px}
        .codecard .k{font:500 11px var(--gfx-font-mono);padding:2px 6px;border-radius:4px}
        .k-n{background:color-mix(in srgb,var(--gfx-accent) 25%,transparent);color:var(--gfx-accent-soft)}
        .k-a{background:color-mix(in srgb,var(--gfx-warning) 22%,transparent);color:var(--gfx-warning)}
        .k-s{background:color-mix(in srgb,var(--gfx-note) 25%,transparent);color:var(--gfx-note)}
        .code{font:400 14px/23px var(--gfx-font-mono);white-space:pre;background:var(--gfx-bg);border-radius:8px;padding:10px 12px;border:1px solid var(--gfx-border)}
        .code .c{color:var(--gfx-muted)} .code .s{color:var(--gfx-tally-accent)} .code .f{color:var(--gfx-ui)} .code .n{color:var(--gfx-accents)}
        .code .gut{color:var(--gfx-faint);display:inline-block;width:30px}
        .pop{left:470px;top:262px;width:380px;border-radius:12px;background:var(--gfx-surface-raised);border:1px solid var(--gfx-input);
          box-shadow:0 24px 70px rgb(0 0 0 / .6);padding:12px 14px;opacity:0}
        .pop .hd{display:flex;justify-content:space-between;font:400 13px var(--gfx-font-mono);color:var(--gfx-muted)}
        .pop .ta{margin-top:10px;height:66px;border-radius:8px;border:1px solid var(--gfx-accent);background:var(--gfx-surface);padding:8px 10px;font-size:15px;line-height:1.35}
        .pop .row{position:relative;height:34px;margin-top:10px}
        .pop .btn{top:0;height:32px;font-size:14px}
        .pop .att{margin-top:10px;display:flex;gap:8px;align-items:center;font:400 12px var(--gfx-font-mono);color:var(--gfx-muted)}
        .pop .att i{position:relative;width:60px;height:36px;border-radius:5px;background:var(--gfx-tally-bg);border:1px solid var(--gfx-border);overflow:hidden}
        .pop .att i::after{content:'';position:absolute;left:18px;top:11px;width:30px;height:12px;border:2px solid var(--gfx-markup);border-radius:50%}
        .pin{left:1005px;top:339px;width:26px;height:26px;border-radius:50%;background:var(--gfx-markup);border:2px solid var(--gfx-text);
          font:600 13px var(--gfx-font-sans);display:flex;align-items:center;justify-content:center;opacity:0}
        .pin.ok{background:var(--gfx-accent2)}
        .kchip{left:0;top:0;padding:4px 10px;border-radius:7px;background:var(--gfx-surface-raised);border:1px solid var(--gfx-input);
          font:500 14px var(--gfx-font-sans);display:flex;gap:8px;align-items:center;white-space:nowrap;opacity:0}
        .cmp-head{left:${LW + 8}px;top:${TOP + 6}px;width:${RX - LW - 20}px;height:36px;display:flex;align-items:center;gap:10px;padding:0 10px;
          border-radius:8px;background:var(--gfx-surface-raised);border:1px solid var(--gfx-input);font-size:14px;opacity:0}
        .cmp-head .ab{font:600 11px var(--gfx-font-mono);width:18px;height:18px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:var(--gfx-input)}
        .cmp-head .ab.b{background:var(--gfx-accent)}
        .cmp-head .seg{position:static;margin-left:auto;height:26px;font-size:13px}
        .cmp-a{left:${MINI.x}px;top:${MINI.y}px;width:${MINI.w}px;height:${MINI.h}px;overflow:hidden;opacity:0}
        .cmp-a .tally{left:0;top:0}
        .cmp-a .t-glow{opacity:0}
        .cmp-a .t-total-tweak{transform:scale(.86)}
        .cmp-line{top:${MINI.y}px;left:0;width:2px;margin-left:-1px;height:${MINI.h}px;background:var(--gfx-text);opacity:0}
        .cmp-line i{position:absolute;left:-12px;top:${302 - MINI.y - 12}px;width:24px;height:24px;border-radius:50%;background:var(--gfx-text);
          box-shadow:0 2px 8px rgb(0 0 0 / .5)}
        .cmp-tag{top:${MINI.y + 10}px;font:500 12px var(--gfx-font-mono);padding:4px 8px;border-radius:5px;background:rgb(0 0 0 / .6);opacity:0}
        .ripple{left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid var(--gfx-accent-soft);opacity:0}
        /* @end */
        /* @gfx cursor */
        [data-gfx="cursor"]{position:absolute;left:0;top:0;width:30px;height:30px;z-index:40;opacity:0;transform-origin:2px 2px}
        [data-gfx="cursor"] svg{width:100%;height:100%;overflow:visible;filter:drop-shadow(0 2px 4px rgb(0 0 0 / .6))}
        /* @end */
        /* @gfx end-card */
        [data-gfx="end-card"]{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .end-mark{width:140px;height:140px;margin-bottom:40px}
        .end-word{display:flex;overflow:hidden;padding-bottom:.08em;font-size:148px;font-weight:700;letter-spacing:-0.05em;line-height:1}
        .end-word span{display:inline-block}
        .end-tag{margin-top:26px;font-size:40px;color:var(--gfx-muted);letter-spacing:-0.01em}
        .end-foot{margin-top:44px;font:400 21px var(--gfx-font-mono);color:var(--gfx-faint);letter-spacing:.04em}
        .end-made{margin-top:30px;display:flex;align-items:center;gap:12px;padding:10px 18px 10px 12px;border-radius:999px;
          border:1px solid var(--gfx-border);background:var(--gfx-surface);font-size:22px;color:var(--gfx-muted)}
        .made-mark{width:30px;height:30px}
        /* @end */
      </style>
      <!-- @gfx background -->
      <div data-gfx="background" style="position:absolute;inset:0"></div>
      <!-- @end -->
      <!-- @gfx bg-glow -->
      <div data-gfx="bg-glow"></div>
      <!-- @end -->
      <div class="sc" style="position:absolute;inset:0">
        <!-- @gfx intro -->
        <div data-gfx="intro">
          ${MARK('intro-mark')}
          <div class="intro-name">agent-gfx</div>
          <div class="intro-st">${STATEMENT.map((l) => `<span class="mask"><span class="ln intro-ln">${esc(l).replace(STATEMENT_HL, `<span class="hl">${STATEMENT_HL}</span>`)}</span></span>`).join('')}</div>
        </div>
        <!-- @end -->
        <!-- @gfx captions -->
        <div data-gfx="captions">${CAPTIONS.map(
          ([num, , eyebrow, head], i) => `<div class="cap cap-${i}">
            <div class="cap-eyebrow"><b>${num}</b><i></i>${esc(eyebrow)}</div>
            <div class="mask"><div class="ln cap-head">${esc(head)}</div></div></div>`,
        ).join('')}</div>
        <!-- @end -->
        <!-- @gfx chapters -->
        <div data-gfx="chapters">${CAPTIONS.map(([num, label], i) => `<div class="chap chap-${i}">${num} ${esc(label)}<u></u></div>`).join('')}</div>
        <!-- @end -->
        <div class="screen-float">
        <!-- @gfx screen -->
        <div data-gfx="screen"><div class="app">
        <!-- @end -->
          <!-- @gfx topbar -->
          <div class="panel" data-gfx="topbar">
            <div class="tb-left"><span class="tb-logo"><i></i></span><span>gfx-demo</span><span class="tb-sep">/</span><span>tally</span>${ICON.chev}</div>
            <div class="seg" style="left:${700 - 75}px"><span class="on">Review</span><span>Code</span></div>
            <div class="btn tb-claude" style="left:930px">${ICON.spark} Claude <span class="badge tb-badge">1</span></div>
            <div class="btn ghost" style="left:1062px">Undo</div>
            <div class="btn ghost" style="left:1140px">Redo</div>
            <div class="btn tb-render" style="left:1356px;width:104px">Render ${ICON.chev}</div>
            <div class="btn primary" style="left:1468px;width:120px">Save draft <i class="tb-dot"></i></div>
            <div class="dim"></div>
          </div>
          <!-- @end -->
          <!-- @gfx inspector -->
          <div class="panel" data-gfx="inspector">
            <div class="view iv-scene" style="top:0">
              <div class="sec" style="position:absolute;left:20px;top:22px">Scene</div>
              ${[['name', 'tally'], ['size', '1920×1080'], ['fps', '60'], ['duration', '12.00 s · 720 f']].map(([k, v], i) => `<div class="kv iv-kv" style="top:${56 + i * 30}px"><span>${k}</span><span>${v}</span></div>`).join('')}
              <div class="kv iv-kv" style="top:176px"><span>cues</span><span class="iv-cues">0</span></div>
              <div class="sec" style="position:absolute;left:20px;top:232px">Stems</div>
              ${STEMS.map((s, i) => `<div class="kv iv-stem" style="top:${264 + i * 28}px"><span style="color:var(--gfx-${s})">${s}</span><span>${TALLY_CUES.filter((c) => c[2] === s).length} cues</span></div>`).join('')}
              <div class="sec" style="position:absolute;left:20px;top:396px">Shortcuts</div>
              <div class="kv" style="top:426px"><span><span class="kbd">C</span> comment</span><span></span></div>
              <div class="kv" style="top:454px"><span><span class="kbd">L</span> live view</span><span></span></div>
            </div>
            <div class="view iv-el" style="top:0;opacity:0">
              <div class="el-name">total <span class="badge b-tweak">tweaked</span></div>
              <div class="el-type">div.total "$42.05" · scene.js:58</div>
              ${[['X', '1412.0'], ['Y', '806.0'], ['Scale', '<span class="iv-scale">1.00</span>'], ['Rotate', '0'], ['Opacity', '1']].map(([k, v], i) => `<div class="field" style="top:${92 + i * 42}px"><span>${k}</span><div class="inp${k === 'Scale' ? ' iv-scale-box' : ''}">${v}</div></div>`).join('')}
              <div class="btn" style="left:16px;top:${350 - TOP}px;width:288px;justify-content:space-between">Open code <span class="mono" style="font-size:12px;color:var(--gfx-muted)">marked</span></div>
              <div class="btn" style="left:16px;top:${404 - TOP}px">Reset all</div>
              <div class="btn" style="left:190px;top:${404 - TOP}px;width:114px">${ICON.spark} Ask Claude</div>
            </div>
            <div class="view iv-cue" style="top:0;opacity:0">
              <div class="el-name" style="top:${172 - TOP}px">total-ding <span class="badge b-stem">accents</span><span class="badge b-edit">edited</span></div>
              <div class="field" style="top:${209 - TOP}px"><span>Sound</span><div class="inp" style="justify-content:space-between">ding ${ICON.chev}</div></div>
              <div class="field" style="top:${245 - TOP}px"><span>Time</span><div class="inp">7.36</div></div>
              <div class="slider" style="top:${283 - TOP}px"><span>Gain</span><div class="track"><b style="width:62%"></b><div class="knob" style="left:62%"></div></div><div class="inp">-4.0</div></div>
              <div class="sec" style="position:absolute;left:16px;top:${326 - TOP}px">Shape <span style="color:var(--gfx-faint);text-transform:none;letter-spacing:0">ding · accents</span></div>
              <div class="btn" style="left:16px;top:${348 - TOP}px;height:30px;font-size:14px">${ICON.play} Play</div>
              <div class="btn" style="left:92px;top:${348 - TOP}px;height:30px;font-size:14px">Mutate</div>
              <div class="btn" style="left:172px;top:${348 - TOP}px;height:30px;font-size:14px">Vary</div>
              <div class="btn" style="left:232px;top:${348 - TOP}px;height:30px;font-size:14px">Replace…</div>
              <div class="slider" style="top:${389 - TOP}px"><span>Length</span><div class="track"><b style="width:40%"></b><div class="knob" style="left:40%"></div></div><div class="inp">0.80</div></div>
              <div class="slider" style="top:${425 - TOP}px"><span>Brightness</span><div class="track"><b style="width:50%"></b><div class="knob" style="left:50%"></div></div><div class="inp">0.50</div></div>
              <div class="slider iv-rev" style="top:${461 - TOP}px"><span>Reverb</span><div class="track"><b class="iv-rev-fill"></b><div class="knob iv-rev-knob"></div></div><div class="inp iv-rev-val">0.30</div></div>
            </div>
            <div class="dim"></div>
          </div>
          <!-- @end -->
          <!-- @gfx viewer -->
          <div class="panel" data-gfx="viewer">
            <div class="btn vt vt-comment" style="left:12px">Comment <span class="kbd">C</span></div>
            <div class="btn vt" style="left:132px">Hide comments <span class="kbd">H</span></div>
            <div class="btn vt" style="left:290px">Live <span class="kbd">L</span></div>
            <div class="btn vt vt-select" style="left:368px">Select <span class="kbd">V</span></div>
            <div class="btn vt" style="left:466px">Path <span class="kbd">P</span></div>
            <div class="stage"><div class="placeholder">waiting for scenes/tally/scene.js …</div></div>
            <div class="transport">
              <div class="playbtn"><span class="pb-play">${ICON.play}</span><span class="pb-pause" style="display:none">${ICON.pause}</span></div>
              <span class="tc">00.00</span><span class="tc-of">/ 12.00 &nbsp; f <span class="tc-f">0</span> / 720</span>
              <div class="tr-right"><div class="btn">Loop</div><div class="seg" style="position:static;height:30px;font-size:14px"><span class="on">Original</span><span>Draft</span></div><div class="btn">Fit</div></div>
            </div>
            <div class="dim"></div>
          </div>
          <!-- @end -->
          <!-- @gfx tally tally-total -->
          <div class="tally mini-real" data-gfx="tally">${tallyHTML(['Split it', 'fair.'])}</div>
          <div class="tally-badge">RENDERED</div>
          <!-- @end -->
          <!-- @gfx rpanel -->
          <div class="panel" data-gfx="rpanel">
            <div class="tabs">${tabsRP.map(([n, c], i) => `<div class="tab" style="left:${[16, 136, 208, 294][i]}px">${n}${c}</div>`).join('')}<div class="tab-ind rp-ind"></div></div>
            <div class="view rv-comments" style="top:44px">
              <div class="btn" style="left:12px;right:12px;top:10px;font-size:14px;color:var(--gfx-muted)">Ask Claude about all open comments</div>
              <div class="rv-empty" style="position:absolute;left:16px;top:66px;font-size:15px;line-height:1.5;color:var(--gfx-muted)">No comments yet.<br>Press <span class="kbd">C</span> and click the picture to pin one.</div>
              <div class="crow"><div class="meta"><span>c1</span><span>07.36</span><span>@total</span><span class="resolved">resolved</span></div>
                <div class="txt"><span class="cdot"></span>${esc(COMMENT)}</div><span class="cdot ok"></span><div class="cthumb"><i></i></div></div>
              <div class="creply"><div class="who">${ICON.spark} Claude</div>Total now lands on the ding at 7.36 s, 8 % bigger, outBack.</div>
              <div class="btn" style="left:12px;bottom:12px;font-size:14px">+ Comment <span class="kbd">N</span></div>
            </div>
            <div class="view rv-layers" style="top:44px;opacity:0">
              <div class="sec" style="position:absolute;left:16px;top:14px">Front to back</div>
              <div class="lsel" style="top:${132 - 96}px"></div>
              ${LAYERS.map(([n, d], i) => `<div class="lrow${n.includes('(') ? ' grp' : ''}" style="top:${36 + i * 40}px"><span class="cb"></span><span class="nm">${esc(n)}</span><span class="ds">${esc(d)}</span>${ICON.eye}</div>`).join('')}
            </div>
            <div class="view rv-versions" style="top:44px;opacity:0">
              <div style="position:absolute;left:16px;top:12px;font-size:16px;font-weight:600">Versions <span class="mono" style="font-size:13px;color:var(--gfx-muted);font-weight:400;margin-left:6px">main</span></div>
              <div class="btn" style="left:16px;top:${136 - 96}px;width:220px;height:34px;justify-content:flex-start;font-weight:400;border-color:var(--gfx-accent)"><span class="vn-text"></span><span class="vn-ph" style="color:var(--gfx-faint)">Note (optional)</span><span class="caret vn-caret" style="height:16px;width:2px;opacity:0"></span></div>
              <div class="btn primary" style="left:244px;top:${136 - 96}px;width:122px;height:34px">Save version</div>
              <div style="position:absolute;left:16px;top:${184 - 96}px;font-size:14px;color:var(--gfx-muted);display:flex;gap:8px;align-items:center"><span style="width:14px;height:14px;border-radius:3px;background:var(--gfx-accent);display:inline-flex;align-items:center;justify-content:center;font-size:11px">${ICON.check}</span>Auto-checkpoints</div>
              <div class="vlist" style="position:absolute;left:0;right:0;top:${214 - 96}px;height:${404 - 214}px;overflow:hidden">
                <div class="vrow vnew"><div class="th"><i></i></div><div class="tt">${esc(NOTE)}</div><div class="mt"><span class="badge who-you">You</span><span class="badge who-auto">Last saved</span>just now · 2 files</div></div>
                <div class="vold">${VERSIONS.map(([n, w, c, m], i) => `<div class="vrow v-old" style="top:${i * 62}px"><div class="th"><i></i></div><div class="tt">${esc(n)}</div><div class="mt"><span class="badge who-${c}">${w}</span>${m}</div></div>`).join('')}</div>
              </div>
              <div class="vdet"><div class="vdet-in">
                <div style="font-size:15px;font-weight:600">${esc(NOTE)} <span class="mono" style="font-weight:400;font-size:12px;color:var(--gfx-muted)">7d3e5a0</span></div>
                <div class="f"><span class="m">M</span>scenes/tally/scene.js <span class="p">+12</span><span class="n">−3</span></div>
                <div class="f"><span class="m">M</span>scenes/tally/sound.json <span class="p">+6</span><span class="n">−1</span></div>
                <div class="btn" style="left:0;top:86px">Diff</div>
                <div class="btn" style="left:60px;top:86px;width:152px">Compare visually</div>
                <div class="btn" style="left:220px;top:86px">Restore</div>
              </div></div>
            </div>
            <div class="view rv-renders" style="top:44px;opacity:0">
              <div style="position:absolute;left:16px;top:12px;font-size:16px;font-weight:600">Render queue</div>
              <div class="rcard rc-0" style="top:${136 - 96}px"><div class="tt">tally.mp4 <span class="rdone rd-0">${ICON.check} done</span></div>
                <div class="mt">1920×1080 · 60 fps · H.264 · Exact</div><div class="rbar"><b class="rb-0"></b></div><div class="rstat rs-0">queued</div></div>
              <div class="rcard rc-1" style="top:${248 - 96}px"><div class="tt">tally.sound.mp4 <span class="rdone rd-1">${ICON.check} done</span></div>
                <div class="mt">mix · 4 stems · −14 LUFS</div><div class="rbar"><b class="rb-1"></b></div><div class="rstat rs-1">queued</div></div>
              <div class="fmts">${['MP4', 'WebM', 'GIF', 'PNG', 'ProRes', 'WebM alpha', 'MOV alpha', '4K', 'Reel 9:16'].map((f, i) => `<span${i === 0 ? ' class="on"' : ''}>${f}</span>`).join('')}</div>
            </div>
            <div class="dim"></div>
          </div>
          <!-- @end -->
          <!-- @gfx dock -->
          <div class="panel" data-gfx="dock">
            <div class="tabs">${['Timeline', 'Terminal', 'T3'].map((n, i) => `<div class="tab" style="left:${[16, 104, 194][i]}px">${n}</div>`).join('')}<div class="tab-ind dk-ind"></div></div>
            <div class="term dv-term"><div class="mut">claude  ·  ~/gfx-demo</div><div><span class="acc">›</span> <span class="prompt"></span><span class="caret pr-caret"></span></div><div class="tl1"><span class="bul"></span>Using <span class="acc">motion-graphics</span> · brief → storyboard → build → verify</div><div class="tl1"><span class="ok">${ICON.check}</span> STORYBOARD.md            <span class="mut">5 beats · 12.0 s</span></div><div class="tl1"><span class="ok">${ICON.check}</span> scenes/tally/scene.js    <span class="mut">anime · 9 named layers</span></div><div class="tl1"><span class="ok">${ICON.check}</span> ${TALLY_CUES.length} sound cues           <span class="mut">hits · motion · ui · accents</span></div><div class="tl1"><span class="ok">${ICON.check}</span> gfx sheet tally          <span class="mut">12 frames checked · open in gfx studio</span></div></div>
            <div class="t3 dv-t3" style="opacity:0">
              <div class="hd"><b>T3 Code</b><span>·</span><span>Tally · review c1</span><span>·</span><span>Claude</span></div>
              <div class="ub t3m">${esc(COMMENT)}<span class="att">${ICON.clip} c1-markup.png · 07.36 · @total</span></div>
              <div class="tr t3m" style="top:68px">${ICON.tool}<b>gfx context tally --comment c1</b>  moment 07.36 s · f 442 · element total</div>
              <div class="tr t3m" style="top:92px">${ICON.tool}<b>Edit scene.js</b>  total scale-in ends at 7.36 s, outBack  <span style="color:var(--gfx-accent2)">+3</span> <span style="color:var(--gfx-markup)">−2</span></div>
              <div class="tr t3m" style="top:116px">${ICON.tool}<b>gfx still tally --t 7.36</b>  checked</div>
              <div class="tr t3m" style="top:140px">${ICON.tool}<b>gfx review tally --resolve c1</b>  reply sent</div>
              <div class="am t3m" style="top:166px">${ICON.spark} Done: the total now lands on the ding at 7.36 s.</div>
            </div>
            <div class="tl dv-tl" style="opacity:0">
              ${Array.from({ length: 13 }, (_, s) => `<div class="tl-tick" style="left:${X(s)}px;top:4px">${s}s</div>`).join('')}
              <div class="tl-lab" style="top:${618 - DOCK - 34}px;height:30px">FRAMES</div>
              ${Array.from({ length: 12 }, (_, i) => `<div class="tl-frame" style="left:${X(i) + 1}px;width:${TLPX - 2}px"><b style="left:${20 + hash(i, 3) * 60}px;top:${-4 + hash(i, 4) * 10}px"></b><i style="left:8px;top:9px;width:${18 + hash(i, 5) * 30}px"></i><i style="left:8px;top:17px;width:${10 + hash(i, 6) * 18}px;opacity:.4"></i></div>`).join('')}
              <div class="tl-lab" style="top:${650 - DOCK - 34}px;height:18px">COMMENTS</div>
              <div class="tl-row" style="top:${649 - DOCK - 34}px"></div>
              <div class="tl-cdia" style="left:${X(7.36) - 5}px;top:${654 - DOCK - 34}px"></div><div class="tl-cdia ok" style="left:${X(7.36) - 5}px;top:${654 - DOCK - 34}px"></div>
              ${STEMS.map((s) => `<div class="tl-row" style="top:${LANE_Y[s] - 1 - DOCK - 34}px"></div>
                <div class="tl-lab lab-${s}" style="top:${LANE_Y[s] - DOCK - 34}px;height:28px"><span class="sw" style="background:var(--gfx-${s})"></span>${s.toUpperCase()}<span class="ms"><span class="m-${s}">M</span><span>S</span></span></div>
                <div class="lane lane-${s}" style="top:${LANE_Y[s] - DOCK - 34}px"><svg width="${SCR.w}" height="28">${TALLY_CUES.filter((c) => c[2] === s).map(([id, ct], i) => `<g class="cue cue-${id}"><path d="${wavePath(X(ct), s, i * 31 + s.length, id === 'total-ding' ? 44 : s === 'ui' ? 16 : 40)}" fill="var(--gfx-${s})"/></g>`).join('')}</svg>
                ${TALLY_CUES.filter((c) => c[2] === s).map(([id, ct], i) => `<span class="cue-lab cl-${id}" style="left:${X(ct) + 3}px;top:${i % 2 ? 15 : 1}px;color:var(--gfx-${s});border-color:color-mix(in srgb,var(--gfx-${s}) 55%,transparent)">${id}</span>`).join('')}</div>`).join('')}
              <div class="cue-sel" style="left:${X(7.36) - 4}px;top:${LANE_Y.accents - DOCK - 34 - 1}px;width:${44 + 12}px;height:30px"></div>
              <div class="playhead"><i></i></div>
            </div>
            <div class="dim"></div>
          </div>
          <!-- @end -->
          <!-- @gfx overlays -->
          <div class="ov sel"><span class="lab">div.total "$42.05"</span><i style="left:0;top:0"></i><i style="left:100%;top:0"></i><i style="left:0;top:100%"></i><i style="left:100%;top:100%"></i></div>
          <div class="ov codecard"><div class="hd"><b>total</b><span class="k k-n">NAMED</span><span class="k k-a">ANIMATED 7.00–7.36 s</span><span class="k k-s">SOUND</span></div>
            <div class="code"><span class="gut">58</span><span class="c">// @gfx total</span>
<span class="gut">59</span>&lt;div data-gfx=<span class="s">"total"</span>&gt;$42.05&lt;/div&gt;
<span class="gut">74</span>.<span class="f">add</span>(<span class="s">'[data-gfx="total"]'</span>, { scale: [<span class="n">0.6</span>, <span class="n">1</span>] }, <span class="n">7000</span>)
<span class="gut">91</span>ctx.<span class="f">cue</span>(<span class="n">7.36</span>, <span class="s">'ding'</span>, { id: <span class="s">'total-ding'</span> })
<span class="gut">92</span><span class="c">// @end</span></div></div>
          <div class="ov pop"><div class="hd"><span>c1 · 07.36 · f 442</span><span>open ${ICON.chev}</span></div>
            <div class="ta"><span class="pop-text"></span><span class="caret pop-caret" style="height:16px;width:2px"></span></div>
            <div class="row"><div class="btn" style="left:0">Draw <span class="kbd">D</span></div><div class="btn" style="left:94px">Attach</div><div class="btn primary" style="left:${778 - 470 - 14 - 58}px;width:116px">${ICON.spark} Ask Claude</div></div>
            <div class="att"><i></i>markup · Enter to save · Esc to close</div></div>
          <svg class="ov markup" width="${SCR.w}" height="${SCR.h}" style="left:0;top:0;overflow:visible"><path class="mk-path" d="${markD}" fill="none" stroke="var(--gfx-markup)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          <div class="ov pin pin-a">1</div><div class="ov pin ok pin-b">1</div>
          <div class="ov kchip"><span class="kbd" style="color:var(--gfx-text)">C</span>Comment tool</div>
          <div class="ov cmp-head"><b>Compare visually</b><span class="ab">A</span>12c4acd · first cut ${ICON.swap}<span class="ab b">B</span>current files<div class="seg"><span>Side by side</span><span class="on">Wipe</span><span>Difference</span></div></div>
          <div class="ov cmp-a"><div class="tally">${tallyHTML(['Split the', 'bill.'])}</div></div>
          <div class="ov cmp-line"><i></i></div>
          <div class="ov cmp-tag cmp-ta" style="left:${MINI.x + 10}px">A · first cut</div>
          <div class="ov cmp-tag cmp-tb" style="left:${MINI.x + MINI.w - 160}px">B · now</div>
          <div class="ov ripple"></div>
          <!-- @end -->
          <!-- @gfx cursor -->
          <div data-gfx="cursor"><svg viewBox="0 0 24 24"><path d="M3 2l15.5 9.2-6.6 1.4 3.9 7.3-3 1.6-3.9-7.4L3.8 19z" fill="var(--gfx-text)" stroke="var(--gfx-bg)" stroke-width="1.4" stroke-linejoin="round"/></svg></div>
          <!-- @end -->
        </div></div>
        </div>
        <!-- @gfx end-card -->
        <div data-gfx="end-card">
          ${MARK('end-mark')}
          <div class="end-word">${Array.from('agent-gfx').map((c, i) => `<span${i > 5 ? ' class="hl"' : ''}>${c}</span>`).join('')}</div>
          <div class="end-tag">${esc(TAGLINE)}</div>
          <div class="end-foot">${esc(FOOT)}</div>
          <div class="end-made">${MARK('made-mark')}${esc(MADE)}</div>
        </div>
        <!-- @end -->
      </div>`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style, { cell: 48 })); // first child = bottom layer
    // @end

    const q = (s) => root.querySelector(s);
    const qa = (s) => [...root.querySelectorAll(s)];
    Object.assign(el, {
      app: q('.app'),
      dims: { top: q('[data-gfx="topbar"] .dim'), insp: q('[data-gfx="inspector"] .dim'), view: q('[data-gfx="viewer"] .dim'), rp: q('[data-gfx="rpanel"] .dim'), dock: q('[data-gfx="dock"] .dim') },
      iv: { scene: q('.iv-scene'), el: q('.iv-el'), cue: q('.iv-cue') },
      rv: { comments: q('.rv-comments'), layers: q('.rv-layers'), versions: q('.rv-versions'), renders: q('.rv-renders') },
      dv: { term: q('.dv-term'), t3: q('.dv-t3'), tl: q('.dv-tl') },
      rpInd: q('.rp-ind'), dkInd: q('.dk-ind'), rpCnt: q('.rp-cnt'),
      cues: q('.iv-cues'), scale: q('.iv-scale'), tweak: q('.b-tweak'), edit: q('.b-edit'),
      revFill: q('.iv-rev-fill'), revKnob: q('.iv-rev-knob'), revVal: q('.iv-rev-val'),
      tbBadge: q('.tb-badge'), tbDot: q('.tb-dot'), vtComment: q('.vt-comment'), vtSelect: q('.vt-select'),
      prompt: q('.prompt'), prCaret: q('.pr-caret'), popText: q('.pop-text'), popCaret: q('.pop-caret'),
      vnText: q('.vn-text'), vnPh: q('.vn-ph'), vnCaret: q('.vn-caret'),
      tc: q('.tc'), tcF: q('.tc-f'), playhead: q('.playhead'),
      tweakEls: [q('.mini-real .t-total-tweak')], sel: q('.sel'), lsel: q('.lsel'),
      bounce: q('.mini-real .t-total-bounce'),
      cueGs: TALLY_CUES.map(([id, ct, stem]) => [ct, q(`.cue-${id}`), q(`.cl-${id}`), stem]),
      dingTail: q('.cue-total-ding path'), cueSel: q('.cue-sel'),
      laneMotion: q('.lane-motion'), mMotion: q('.m-motion'),
      mk: q('.mk-path'), cmpA: q('.cmp-a'), cmpLine: q('.cmp-line'),
      rb: [q('.rb-0'), q('.rb-1')], rs: [q('.rs-0'), q('.rs-1')], rd: [q('.rd-0'), q('.rd-1')],
      cursor: q('[data-gfx="cursor"]'), ripple: q('.ripple'), kchip: q('.kchip'),
      chaps: qa('.chap'), chapU: qa('.chap u'),
    });
    el.mk.style.strokeDasharray = `${markLen} ${markLen + 10}`;
    el.ckOk = q('.tl-cdia.ok');
    el.playIc = q('.pb-play');
    el.pauseIc = q('.pb-pause');
    el.tallies = qa('.tally').map((r) => ({
      bg: r.querySelector('.t-bg'), glow: r.querySelector('.t-glow-move'), scan: r.querySelector('.t-scan'),
      rowTops: [...r.querySelectorAll('.t-row')].map((e) => e.offsetTop + 1),
      avs: [...r.querySelectorAll('.t-av-in')], avX: [...r.querySelectorAll('.t-av')].map((e) => e.offsetLeft - 4), ring: r.querySelector('.t-ring'),
    }));

    // @gfx tally-total
    ctx.el('tally-total', q('.mini-real .t-total-tweak'));
    // @end

    const [introCurve] = svg.createDrawable(q('.intro-mark .mark-curve'));
    const [endCurve] = svg.createDrawable(q('.end-mark .mark-curve'));
    const ms = (s) => s * 1000;

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } })
      // @gfx bg-glow
      .add('[data-gfx="bg-glow"]', { opacity: [0, 1], duration: 1600, ease: 'outCubic' }, 0)
      .add('[data-gfx="bg-glow"]', { translateX: [-120, 120], translateY: [0, 50], duration: ms(DUR), ease: 'inOutSine' }, 0)
      // @end
      // @gfx intro
      .add('.intro-mark', { opacity: [0, 1], scale: [0.6, 1], rotate: [-20, 0], duration: 900, ease: 'outBack(1.4)' }, 150)
      .add(introCurve, { draw: ['0 0', '0 1'], duration: 800, ease: 'inOutCubic' }, 300)
      .add('.intro-mark .mark-key', { scale: [0, 1], duration: 450, ease: 'outBack(2)', delay: stagger(500) }, 300)
      .add('.intro-name', { opacity: [0, 1], translateY: [12, 0], duration: 700 }, 450)
      .add('.intro-ln', { translateY: ['110%', '0%'], duration: 1000, delay: stagger(130) }, 600)
      .add('[data-gfx="intro"]', { opacity: [1, 0], translateY: [0, -60], duration: 420, ease: 'inCubic' }, ms(2.55))
      // @end
      // @gfx screen
      .add('.screen-float', { opacity: [0, 1], translateY: [150, 0], scale: [0.95, 1], duration: 1200 }, ms(2.75))
      .add('.screen-float', { opacity: [1, 0], translateY: [0, 30], scale: [1, 0.92], duration: 520, ease: 'inCubic' }, ms(OUTRO))
      // @end
      // @gfx chapters
      .add('[data-gfx="chapters"]', { opacity: [0, 1], translateY: [-10, 0], duration: 800 }, ms(CH[0]))
      .add('[data-gfx="chapters"]', { opacity: [1, 0], duration: 400, ease: 'inCubic' }, ms(OUTRO))
      // @end
      // @gfx tally tally-total
      .add('.placeholder', { opacity: [1, 0], duration: 300, ease: 'outCubic' }, ms(5.9))
      .add('.mini-real .t-bg', { opacity: [0, 1], duration: 500, ease: 'outCubic' }, ms(5.95))
      .add('.mini-real .t-glow', { opacity: [0, 1], scale: [0.7, 1], duration: 1200, ease: 'outCubic' }, ms(6.05))
      .add('.mini-real .t-eyebrow', { opacity: [0, 1], translateY: [8, 0] }, ms(6.1))
      .add('.mini-real .t-ln', { translateY: ['110%', '0%'], duration: 800, delay: stagger(90) }, ms(6.15))
      .add('.mini-real .t-sub', { opacity: [0, 1], translateY: [8, 0] }, ms(6.35))
      .add('.mini-real .t-card', { opacity: [0, 1], translateY: [30, 0], duration: 800 }, ms(6.3))
      .add('.mini-real .t-row', { opacity: [0, 1], translateX: [14, 0], duration: 500, delay: stagger(70) }, ms(6.45))
      .add('.mini-real .t-av', { opacity: [0, 1], scale: [0.4, 1], duration: 550, ease: 'outBack(2)', delay: stagger(80) }, ms(6.5))
      .add('.mini-real .t-ring, .mini-real .t-scan', { opacity: [0, 1], duration: 500, ease: 'outCubic' }, ms(7.0))
      .add('.mini-real .t-total-in', { opacity: [0, 1], scale: [0.6, 1], duration: 650, ease: 'outBack(1.8)' }, ms(6.75))
      .add('.tally-badge', { opacity: [0, 1], duration: 400 }, ms(6.9))
      // @end
      // @gfx inspector
      .add('.iv-kv', { opacity: [0.25, 1], duration: 400, ease: 'outCubic', delay: stagger(60) }, ms(5.95))
      .add('.iv-stem', { opacity: [0, 1], translateX: [10, 0], duration: 500, delay: stagger(70) }, ms(6.5))
      // @end
      // @gfx dock
      .add('.dv-term .tl1', { opacity: [0, 1], translateX: [-12, 0], duration: 500, delay: (_, i) => [0, 350, 750, 1300, 1850][i] }, ms(5.2))
      .add('.t3m', { opacity: [0, 1], translateY: [8, 0], duration: 500, delay: (_, i) => [0, 350, 800, 1250, 1600, 1950][i] }, ms(18.0))
      // @end
      // @gfx rpanel
      .add('.lrow', { opacity: [0, 1], translateX: [16, 0], duration: 500, delay: stagger(60) }, ms(8.15))
      .add('.lsel', { opacity: [0, 1], duration: 250, ease: 'outCubic' }, ms(9.12))
      .add('.lsel', { opacity: [1, 0], duration: 250, ease: 'outCubic' }, ms(14.2))
      .add('.crow', { opacity: [0, 1], translateY: [-10, 0], duration: 600 }, ms(18.0))
      .add('.rv-empty', { opacity: [1, 0], duration: 200, ease: 'outCubic' }, ms(17.95))
      .add('.cdot.ok', { opacity: [0, 1], scale: [0.4, 1], duration: 450, ease: 'outBack(2)' }, ms(19.95))
      .add('.resolved', { opacity: [0, 1], duration: 400 }, ms(19.95))
      .add('.creply', { opacity: [0, 1], translateY: [14, 0], duration: 700 }, ms(20.05))
      .add('.v-old', { opacity: [0, 1], translateX: [16, 0], duration: 500, delay: stagger(70) }, ms(26.1))
      .add('.vold', { translateY: [0, 62], duration: 500, ease: 'inOutCubic' }, ms(28.35))
      .add('.vnew', { opacity: [0, 1], translateY: [-24, 0], duration: 600 }, ms(28.45))
      .add('.vdet-in', { opacity: [0, 1], translateY: [10, 0], duration: 600 }, ms(28.55))
      .add('.rcard', { opacity: [0, 1], translateY: [16, 0], duration: 600, delay: stagger(110) }, ms(32.15))
      .add('.fmts span', { opacity: [0, 1], scale: [0.85, 1], duration: 450, ease: 'outBack(1.6)', delay: stagger(40) }, ms(32.4))
      .add('.rd-0', { opacity: [0, 1], duration: 300 }, ms(33.55))
      .add('.rd-1', { opacity: [0, 1], duration: 300 }, ms(33.95))
      // @end
      // @gfx overlays
      .add('.sel', { opacity: [0, 1], duration: 200, ease: 'outCubic' }, ms(9.1))
      .add('.sel', { opacity: [1, 0], duration: 200, ease: 'outCubic' }, ms(14.35))
      .add('.codecard', { opacity: [0, 1], translateY: [24, 0], scale: [0.97, 1], duration: 600 }, ms(12.1))
      .add('.codecard', { opacity: [1, 0], translateY: [0, 10], duration: 250, ease: 'inCubic' }, ms(13.7))
      .add('.pin-a', { opacity: [0, 1], scale: [0.2, 1], duration: 500, ease: 'outBack(2.2)' }, ms(15.0))
      .add('.pin-b', { opacity: [0, 1], duration: 300, ease: 'outCubic' }, ms(19.95))
      .add('.pin-a, .pin-b', { scale: [1, 0], duration: 300, ease: 'inCubic' }, ms(26.0))
      .add('.markup', { opacity: [1, 0], duration: 400, ease: 'outCubic' }, ms(19.0))
      .add('.pop', { opacity: [0, 1], translateY: [12, 0], scale: [0.97, 1], duration: 500 }, ms(16.05))
      .add('.pop', { opacity: [1, 0], scale: [1, 0.97], duration: 200, ease: 'inCubic' }, ms(17.98))
      .add('.cmp-head, .cmp-tag', { opacity: [0, 1], translateY: [-8, 0], duration: 500 }, ms(29.45))
      .add('.cmp-a, .cmp-line', { opacity: [0, 1], duration: 300, ease: 'outCubic' }, ms(29.45))
      .add('.cmp-head, .cmp-tag, .cmp-a, .cmp-line', { opacity: [1, 0], duration: 300, ease: 'inCubic' }, ms(31.4))
      // @end
      // @gfx end-card
      .add('.end-mark', { opacity: [0, 1], scale: [0.5, 1], rotate: [-30, 0], duration: 900, ease: 'outBack(1.5)' }, ms(END))
      .add(endCurve, { draw: ['0 0', '0 1'], duration: 800, ease: 'inOutCubic' }, ms(END + 0.15))
      .add('.end-mark .mark-key', { scale: [0, 1], duration: 450, ease: 'outBack(2)', delay: stagger(500) }, ms(END + 0.15))
      .add('.end-word span', { translateY: ['105%', '0%'], duration: 900, delay: stagger(40) }, ms(END + 0.35))
      .add('.end-tag', { opacity: [0, 1], translateY: [20, 0], duration: 800 }, ms(END + 0.75))
      .add('.end-foot', { opacity: [0, 1], duration: 800 }, ms(END + 1.05))
      .add('.end-made', { opacity: [0, 1], translateY: [14, 0], duration: 800 }, ms(END + 1.35))
      .add('[data-gfx="end-card"]', { scale: [0.985, 1.02], duration: ms(DUR - END), ease: 'outSine' }, ms(END));
    // @end

    // captions: line rises in at each chapter start, the block fades before the next
    // @gfx captions
    CAPTIONS.forEach((_, i) => {
      const a = ms(CH[i]) + 60;
      const b = i < CH.length - 1 ? ms(CH[i + 1]) - 260 : ms(OUTRO);
      tl.add(`.cap-${i} .cap-eyebrow`, { opacity: [0, 1], translateY: [10, 0], duration: 600 }, a)
        .add(`.cap-${i} .cap-head`, { translateY: ['110%', '0%'], duration: 900 }, a + 80)
        .add(`.cap-${i}`, { opacity: [1, 0], translateY: [0, -14], duration: 240, ease: 'inCubic' }, b);
    });
    // @end

    // ---------- sound ----------
    const sx = (x) => SCR.x + x * ZOOM; // app x -> frame x (pan)
    // @gfx intro
    ctx.cue(0.35, 'whoosh', { id: 'intro-air', variant: 'air', dur: 0.7, gain: -10 });
    ctx.cue(0.75, 'swoosh', { id: 'intro-line', variant: 'silk', gain: -12 });
    // @end
    // @gfx screen
    ctx.cue(2.95, 'whoosh', { id: 'screen-in', variant: 'swipe', dur: 0.5, gain: -9 });
    ctx.cue(3.35, 'impact', { id: 'screen-land', variant: 'thud', intensity: 0.4 });
    // @end
    // @gfx dock
    for (let k = 0, t = 3.5; t < 5.0; t += 0.105, k++) ctx.cue(t, 'type', { id: `prompt-type-${k + 1}`, gain: -22, x: sx(260 + k * 40) });
    [5.2, 5.55, 5.95, 6.5, 7.05].forEach((t, i) => ctx.cue(t, 'tick', { id: `claude-step-${i + 1}`, pitch: pentatonic(i), gain: -14, x: sx(300) }));
    [18.0, 18.35, 18.8, 19.25, 19.6].forEach((t, i) => ctx.cue(t, 'tick', { id: `t3-step-${i + 1}`, pitch: pentatonic(i + 2), gain: -16, x: sx(700) }));
    // @end
    // @gfx tally
    ctx.cue(6.2, 'pop', { id: 'tally-build', pitch: pentatonic(3), gain: -14, x: sx(MINI.x + 200) });
    ctx.cue(6.85, 'pop', { id: 'tally-total-in', pitch: pentatonic(6), gain: -12, x: sx(TOTAL.x) });
    // @end
    // @gfx captions
    CH.slice(1).forEach((t, i) => ctx.cue(t + 0.05, 'whoosh', { id: `chapter-${i + 2}`, variant: 'air', dur: 0.45, gain: -15 }));
    // @end
    // @gfx cursor
    CLICKS.forEach(([t, x, , id]) => ctx.cue(t, 'click', { id: `click-${id}`, gain: -11, x: sx(x) }));
    for (let k = 0, t = 16.3; t < 17.35; t += 0.1, k++) ctx.cue(t, 'type', { id: `comment-type-${k + 1}`, gain: -22, x: sx(660) });
    for (let k = 0, t = 26.95; t < 27.7; t += 0.1, k++) ctx.cue(t, 'type', { id: `note-type-${k + 1}`, gain: -22, x: sx(1346) });
    // @end
    // @gfx overlays
    ctx.cue(15.05, 'pop', { id: 'pin', pitch: pentatonic(8), gain: -9, x: sx(1018) });
    ctx.cue(15.25, 'whoosh', { id: 'markup-draw', variant: 'air', dur: 0.7, gain: -20, x: sx(TOTAL.x) });
    ctx.cue(30.4, 'swoosh', { id: 'wipe-1', variant: 'silk', gain: -20, x: sx(MINI.x + 520) });
    ctx.cue(31.05, 'swoosh', { id: 'wipe-2', variant: 'silk', gain: -20, x: sx(MINI.x + 170) });
    // @end
    // @gfx tally-total
    ctx.cue(19.3, 'ding', { id: 'fix-ding', gain: -6, x: sx(TOTAL.x) });
    ctx.cue(14.46, 'ding', { id: 'play-ding-ch2', gain: -12, x: sx(TOTAL.x) }); // playback reaches the ding as the review starts
    ctx.cue(sweepAt(7.0), 'whoosh', { id: 'play-total-in', variant: 'zip', dur: 0.3, gain: -16, x: sx(TOTAL.x) });
    ctx.cue(sweepAt(7.36), 'ding', { id: 'play-total-ding', gain: -6, x: sx(TOTAL.x) });
    ctx.cue(T_REVERB[1] + 0.05, 'ding', { id: 'reverb-audition', gain: -8, reverb: REVERB[1], x: sx(TOTAL.x) });
    // @end
    // @gfx rpanel
    ctx.cue(19.95, 'chime', { id: 'resolved', gain: -10, x: sx(1400) });
    ctx.cue(28.45, 'pop', { id: 'version-saved', pitch: pentatonic(5), gain: -10, x: sx(1400) });
    ctx.cue(33.55, 'tick', { id: 'render-done', pitch: 7, gain: -12, x: sx(1400) });
    ctx.cue(33.95, 'chime', { id: 'mix-done', gain: -9, x: sx(1400) });
    // @end
    // @gfx end-card
    ctx.cue(OUTRO + 0.05, 'whoosh', { id: 'outro', variant: 'air', dur: 0.5, gain: -12 });
    ctx.cue(END + 0.25, 'rise', { id: 'end-rise', dur: 0.9, gain: -10 });
    ctx.cue(END + 0.25, 'logo', { id: 'end-logo', intensity: 0.8 });
    ctx.cue(END + 1.45, 'pop', { id: 'end-made', pitch: pentatonic(7), gain: -10 });
    // @end

    // Prime: unstarted tweens would not apply their `from` values (animejs skill, "Seek pitfalls")
    tl.seek(tl.duration);
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);

    // camera inside the screen
    const [s, ax, ay] = keyframes(t, CAM.map(([kt, ks, kx, ky], i) => ({ t: kt, v: [ks, kx, ky], ease: i ? inOutCubic : undefined })));
    el.app.style.transform = `translate(${(SCR.w * (1 - s) * ax).toFixed(2)}px,${(SCR.h * (1 - s) * ay).toFixed(2)}px) scale(${s.toFixed(4)})`;

    // focus: dim the panels a chapter is not about
    const c = chapterAt(t);
    const kf = outCubic(progress(t, CH[c] - 0.1, CH[c] + 0.4));
    for (const p of Object.keys(el.dims)) {
      const d = (i) => (FOCUS[i].includes(p) ? 0 : 1);
      el.dims[p].style.opacity = (0.62 * lerp(c > 0 ? d(c - 1) : d(0), d(c), kf)).toFixed(3);
    }

    // panel views + tab indicators
    const IV = [[0, 'scene'], [9.1, 'el'], [23.6, 'cue'], [26.3, 'scene']];
    const RV = [[0, 'comments'], [8.0, 'layers'], [14.0, 'comments'], [26.0, 'versions'], [32.15, 'renders']];
    const DV = [[0, 'term'], [8.0, 'tl'], [14.0, 't3'], [20.5, 'tl']];
    for (const k of Object.keys(el.iv)) el.iv[k].style.opacity = viewOp(t, IV, k).toFixed(3);
    for (const k of Object.keys(el.rv)) el.rv[k].style.opacity = viewOp(t, RV, k).toFixed(3);
    for (const k of Object.keys(el.dv)) el.dv[k].style.opacity = viewOp(t, DV, k).toFixed(3);
    const RP_TABS = [[16, 96], [136, 52], [208, 68], [294, 66]];
    const [rl, rw] = tabAt(t, RV.map(([a, v]) => [a, ['comments', 'layers', 'versions', 'renders'].indexOf(v)]), RP_TABS);
    Object.assign(el.rpInd.style, { left: `${rl}px`, width: `${rw}px` });
    const [dl, dw] = tabAt(t, DV.map(([a, v]) => [a, ['tl', 'term', 't3'].indexOf(v)]), [[16, 64], [104, 66], [194, 22]]);
    Object.assign(el.dkInd.style, { left: `${dl}px`, width: `${dw}px` });
    el.rpCnt.textContent = t >= 18.0 && t < 19.95 ? '1' : '0';

    // chapter index
    el.chaps.forEach((ch, i) => {
      const on = t >= CH[i] - 0.1 && (i === CH.length - 1 || t < CH[i + 1] - 0.1);
      ch.style.color = on ? 'var(--gfx-text)' : '';
      el.chapU[i].style.transform = `scaleX(${on ? outCubic(progress(t, CH[i] - 0.1, CH[i] + 0.5)).toFixed(3) : 0})`;
    });

    // the Tally scene's own idle motion (both the live copy and the compare copy): grid drift, glow orbit,
    // a highlight stepping through the receipt rows, the split avatars bobbing with a ring passing between them
    const SCAN = [0, 1, 2, 3, 2, 1];
    const ph = phAt(t);
    const playing = ph - phAt(t - 1 / 60) > 1e-4 && ph - phAt(t - 1 / 60) < 0.05;
    el.playIc.style.display = playing ? 'none' : '';
    el.pauseIc.style.display = playing ? '' : 'none';
    const su = ph / 0.65;
    const si = Math.floor(su);
    const sf = inOutCubic(clamp((su - si) / 0.45));
    const ru = ph / 1.2;
    const ri = Math.floor(ru);
    const rf = inOutCubic(clamp((ru - ri) / 0.35));
    for (const m of el.tallies) {
      const g = ((ph * 12) % 32).toFixed(2);
      m.bg.style.backgroundPosition = `${g}px ${g}px`;
      m.glow.style.transform = `translate(${(46 * Math.cos(ph * 0.8)).toFixed(2)}px,${(30 * Math.sin(ph * 0.65)).toFixed(2)}px) scale(${(1 + 0.08 * Math.sin(ph * 1.3)).toFixed(4)})`;
      m.scan.style.top = `${lerp(m.rowTops[SCAN[si % 6]], m.rowTops[SCAN[(si + 1) % 6]], sf).toFixed(2)}px`;
      m.avs.forEach((a, i) => (a.style.transform = `translateY(${(-3 * Math.sin(ph * 2.4 + i * 1.1)).toFixed(2)}px)`));
      m.ring.style.transform = `translate(${lerp(m.avX[ri % 3], m.avX[(ri + 1) % 3], rf).toFixed(2)}px,${(-3 * Math.sin(ph * 2.4 + lerp(ri % 3, (ri + 1) % 3, rf) * 1.1)).toFixed(2)}px)`;
    }

    // 01 prompt: typing + counters
    const blink = Math.floor(t * 2.6) % 2 === 0 ? 1 : 0;
    el.prompt.textContent = typed(t, 3.45, 5.0, PROMPT);
    el.prCaret.style.opacity = t < 5.15 ? blink : 0;
    el.cues.textContent = String(Math.round(TALLY_CUES.length * outCubic(progress(t, 6.5, 7.1))));

    // 02 layers: selection follows the drag; Scale field derived from the same value
    const sc = scaleAt(t);
    el.tweakEls.forEach((e) => (e.style.transform = `scale(${sc.toFixed(4)})`));
    el.sel.style.transform = `scale(${sc.toFixed(4)})`;
    el.scale.textContent = sc.toFixed(2);
    el.tweak.style.opacity = t >= T_DRAG[1] + 0.05 ? 1 : 0;
    el.tbDot.style.opacity = t >= T_DRAG[1] + 0.05 ? 1 : 0;
    el.vtSelect.classList.toggle('on', t >= 8.0 && t < 14.2);
    el.vtComment.classList.toggle('on', t >= 14.45 && t < 18.0);

    // 03 review: markup stroke, comment typing, Claude badge, the fix bounce
    const dk = inOutSine(progress(t, ...T_DRAW));
    el.mk.style.strokeDashoffset = (markLen * (1 - dk)).toFixed(2);
    el.mk.style.opacity = t >= T_DRAW[0] ? 1 : 0;
    el.popText.textContent = typed(t, 16.25, 17.35, COMMENT);
    el.popCaret.style.opacity = blink;
    el.tbBadge.style.opacity = t >= 18.0 && t < 19.95 ? 1 : 0;
    el.kchip.style.opacity = fade(t, 14.4, 15.1, 0.15).toFixed(3);
    el.ckOk.style.opacity = t >= 19.95 ? 1 : 0;
    let b = 1;
    for (const e of [14.46, 19.3, sweepAt(7.36)]) {
      const u = (t - e) / 0.55;
      if (u >= 0 && u < 1) b += 0.16 * Math.sin(u * Math.PI) * (1 - u);
    }
    el.bounce.style.transform = `scale(${b.toFixed(4)})`;

    // 04 sound: playhead, cues light up as it passes, reverb drag, mute
    el.playhead.style.transform = `translateX(${X(ph).toFixed(2)}px)`;
    el.tc.textContent = ph.toFixed(2).padStart(5, '0');
    el.tcF.textContent = String(Math.round(ph * 60));
    for (const [ct, g, lab, stem] of el.cueGs) {
      const hot = playing && ph - ct >= 0 && ph - ct < 0.35 ? 1 - (ph - ct) / 0.35 : 0;
      g.style.opacity = (0.7 + 0.3 * hot).toFixed(3);
      g.style.filter = hot > 0 ? `brightness(${(1 + 0.8 * hot).toFixed(2)})` : '';
      lab.style.background = hot > 0.05 ? `var(--gfx-${stem})` : '';
      lab.style.color = hot > 0.05 ? 'var(--gfx-bg)' : `var(--gfx-${stem})`;
    }
    const rv = reverbAt(t);
    el.revFill.style.width = `${(rv * 100).toFixed(1)}%`;
    el.revKnob.style.left = `${(rv * 100).toFixed(1)}%`;
    el.revVal.textContent = rv.toFixed(2);
    const x0 = X(7.36);
    const sxT = 1 + 1.4 * (rv - REVERB[0]) / (REVERB[1] - REVERB[0]);
    el.dingTail.setAttribute('transform', `translate(${x0} 0) scale(${sxT.toFixed(3)} 1) translate(${-x0} 0)`);
    el.cueSel.style.opacity = t >= 23.6 && t < 26.3 ? 1 : 0;
    el.edit.style.opacity = t >= T_REVERB[1] ? 1 : 0;
    const muted = t >= 25.75;
    el.laneMotion.style.opacity = muted ? 0.3 : 1;
    el.mMotion.style.background = muted ? 'var(--gfx-motion)' : '';
    el.mMotion.style.color = muted ? 'var(--gfx-bg)' : '';

    // 05 versions: note typing, wipe
    const note = typed(t, 26.9, 27.7, NOTE);
    el.vnText.textContent = t < 28.3 ? note : '';
    el.vnPh.style.display = note && t < 28.3 ? 'none' : '';
    el.vnCaret.style.opacity = t >= 26.8 && t < 28.3 ? blink : 0;
    const wp = keyframes(t, WIPE);
    el.cmpA.style.clipPath = `inset(0 ${((1 - wp) * 100).toFixed(2)}% 0 0)`;
    el.cmpLine.style.transform = `translateX(${(MINI.x + MINI.w * wp).toFixed(2)}px)`;

    // 06 render: progress bars and counters
    const p0 = inOutCubic(progress(t, 32.3, 33.5));
    const p1 = inOutCubic(progress(t, 33.0, 33.9));
    el.rb[0].style.transform = `scaleX(${p0.toFixed(4)})`;
    el.rb[1].style.transform = `scaleX(${p1.toFixed(4)})`;
    el.rs[0].textContent = p0 <= 0 ? 'queued' : p0 < 1 ? `capturing · f ${Math.round(p0 * 720)} / 720` : 'done · 720 frames · 6.2 s';
    el.rs[1].textContent = p1 <= 0 ? 'queued' : p1 < 1 ? `mixing 4 stems · ${Math.round(p1 * 100)} %` : 'done · −14.0 LUFS · 0 clips';

    // cursor (app coords; it zooms with the camera)
    let pos = CUR0;
    for (const m of MOVES) {
      if (t <= m.a) break;
      const k = progress(t, m.a, m.b);
      pos = m.fn ? m.fn(k, t) : [lerp(pos[0], m.to[0], inOutCubic(k)), lerp(pos[1], m.to[1], inOutCubic(k))];
    }
    const pressed = CLICKS.some(([ct]) => t >= ct - 0.04 && t < ct + 0.1) || DRAGS.some(([a, bb]) => t >= a && t <= bb);
    el.cursor.style.opacity = (outCubic(progress(t, CUR_VIS[0], CUR_VIS[0] + 0.2)) * (1 - progress(t, CUR_VIS[1] - 0.3, CUR_VIS[1]))).toFixed(3);
    el.cursor.style.transform = `translate(${(pos[0] - 2).toFixed(2)}px,${(pos[1] - 2).toFixed(2)}px) scale(${pressed ? 0.86 : 1})`;
    el.kchip.style.transform = `translate(${(pos[0] + 26).toFixed(1)}px,${(pos[1] + 22).toFixed(1)}px)`;
    const last = CLICKS.filter(([ct]) => t >= ct && t < ct + 0.45).pop();
    if (last) {
      const u = (t - last[0]) / 0.45;
      el.ripple.style.opacity = (0.8 * (1 - u)).toFixed(3);
      el.ripple.style.transform = `translate(${last[1]}px,${last[2]}px) scale(${(0.4 + 1.2 * outCubic(u)).toFixed(3)})`;
    } else el.ripple.style.opacity = 0;
  },
};
