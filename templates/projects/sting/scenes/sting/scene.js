// Logo sting (1920x1080, svg). A ring draws on, bursts at the hit, the mark pops in with overshoot, then the
// lockup slides left and pulls the wordmark out letter by letter; the tagline settles and the end card holds.
// Named elements (data-gfx) are selectable in the studio; cues drive `gfx audio`.
// `@gfx <name>` … `@end` comments mark each named element's code (markup, per-frame code, cues): the studio's
// "Open code" shows exactly those blocks. Comments only, they never change the picture.
import { tween, progress, keyframes, clamp } from '/runner/lib/tween.js';
import { outExpo, outBack, outCubic, inOutCubic } from '/runner/lib/ease.js';
import { mulberry32 } from '/runner/lib/rng.js';
import { pentatonic } from '/runner/lib/sfx.js';
import { gridSvg } from '/runner/lib/style.js';

// ---- Copy ----
const BRAND = 'Lumen';
const TAGLINE = 'Ideas in motion';

// ---- Timing (seconds) ----
const T = {
  ring: 0.1, // ring starts drawing
  hit: 0.95, // ring closes: burst + mark + logo hit
  slide: 1.25, // lockup slides left (0.7 s)
  letters: 1.4, // first wordmark letter
  letterStep: 0.06, // stagger between letters
  tagline: 2.0, // tagline settles; end card holds from ~2.5 s
};
const SLIDE_DUR = 0.7;

// ---- Look ----
const R = 112; // ring radius
const ARC = 0.82; // drawn share of the ring (the gap is the logo's notch)
const WORD_SIZE = 168; // wordmark font size (px)
const GAP = 72; // ring edge → wordmark
const BURST_LINES = 32;
const BURST_DOTS = 14;
const SEED = 7;

const NS = 'http://www.w3.org/2000/svg';
const el = (parent, tag, attrs = {}) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
};
const circlePath = (r) => `M0 ${-r}A${r} ${r} 0 1 1 0 ${r}A${r} ${r} 0 1 1 0 ${-r}`; // clockwise from the top

let CX, CY, finalX, textX, baseline;
let glow, logo, ringG, ring, inner, head, mark, burst, rays, dots, shock, wordClip, letters, tagline;

export default {
  setup(ctx) {
    const { root, width: W, height: H, style } = ctx;
    const { text, muted, accent, accentSoft, accent2 } = style.colors;
    CX = W / 2;
    CY = H / 2;

    // @gfx background
    root.insertAdjacentHTML(
      'beforeend',
      `<svg xmlns="${NS}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="position:absolute;left:0;top:0">${gridSvg(style, W, H, { name: 'background' })}</svg>`,
    );
    // @end
    const svg = root.querySelector('svg');
    const defs = el(svg, 'defs');

    // ---- Measure the wordmark, then lay out the lockup (ring + gap + word), centred ----
    const probe = el(svg, 'text', { 'font-family': style.fonts.sans, 'font-weight': 700, 'font-size': WORD_SIZE, 'letter-spacing': -4 });
    probe.textContent = BRAND;
    const chars = Array.from(BRAND);
    const xs = chars.map((_, i) => probe.getStartPositionOfChar(i).x);
    const wordW = probe.getComputedTextLength();
    probe.remove();
    const lockW = 2 * R + GAP + wordW;
    finalX = CX - lockW / 2 + R;
    textX = finalX + R + GAP;
    const cap = WORD_SIZE * 0.727; // Inter cap height
    baseline = CY + cap / 2 - 18; // tagline sits below; lift the word a little so the pair is centred

    // @gfx glow
    const grad = el(defs, 'radialGradient', { id: 'sting-glow' });
    el(grad, 'stop', { offset: 0, 'stop-color': accent, 'stop-opacity': 0.22 });
    el(grad, 'stop', { offset: 1, 'stop-color': accent, 'stop-opacity': 0 });
    glow = el(svg, 'circle', { 'data-gfx': 'glow', r: 460, fill: 'url(#sting-glow)', opacity: 0 });
    // @end

    // @gfx burst
    burst = el(svg, 'g', { 'data-gfx': 'burst', transform: `translate(${CX} ${CY})` });
    shock = el(burst, 'circle', { fill: 'none', stroke: accentSoft, opacity: 0 });
    const rnd = mulberry32(SEED);
    rays = Array.from({ length: BURST_LINES }, (_, i) => {
      const a = (i / BURST_LINES) * Math.PI * 2 + (rnd() - 0.5) * 0.14;
      const pick = rnd();
      return {
        a,
        dist: 110 + rnd() * 230,
        delay: rnd() * 0.07,
        node: el(burst, 'line', {
          stroke: pick < 0.18 ? accent2 : pick < 0.6 ? accent : accentSoft,
          'stroke-width': 3 + Math.round(rnd() * 3),
          'stroke-linecap': 'round',
          opacity: 0,
        }),
      };
    });
    dots = Array.from({ length: BURST_DOTS }, () => ({
      a: rnd() * Math.PI * 2,
      dist: 200 + rnd() * 240,
      r: 3 + rnd() * 4,
      delay: 0.03 + rnd() * 0.08,
      node: el(burst, 'circle', { fill: rnd() < 0.3 ? accent2 : accentSoft, opacity: 0 }),
    }));
    // @end

    // Lockup: ring + mark move together (the `logo` group); the wordmark stays put and is revealed behind it.
    // @gfx logo
    logo = el(svg, 'g', { 'data-gfx': 'logo' });
    // @end

    // @gfx ring
    ringG = el(logo, 'g', { 'data-gfx': 'ring' });
    inner = el(ringG, 'path', { d: circlePath(R - 26), fill: 'none', stroke: muted, 'stroke-width': 3, 'stroke-linecap': 'round', pathLength: 1, opacity: 0 });
    ring = el(ringG, 'path', { d: circlePath(R), fill: 'none', stroke: accent, 'stroke-width': 8, 'stroke-linecap': 'round', pathLength: 1, opacity: 0 });
    head = el(ringG, 'circle', { r: 0, fill: accent2 });
    // @end

    // @gfx mark
    // two interlocking diamonds: a solid accent one and a text-coloured outline
    mark = el(logo, 'g', { 'data-gfx': 'mark' });
    const dia = (s) => `M0 ${-s}L${s} 0L0 ${s}L${-s} 0Z`;
    el(mark, 'path', { d: dia(46), fill: accent, transform: 'translate(-16 0)', 'stroke-linejoin': 'round', stroke: accent, 'stroke-width': 8 });
    el(mark, 'path', { d: dia(46), fill: 'none', stroke: text, 'stroke-width': 7, 'stroke-linejoin': 'round', transform: 'translate(18 0)' });
    // @end

    // @gfx wordmark
    // clip = everything right of the moving ring (the word is pulled out from behind it) and above the baseline
    const clip = el(defs, 'clipPath', { id: 'sting-word-clip' });
    wordClip = el(clip, 'rect', { y: baseline - WORD_SIZE * 1.2, height: WORD_SIZE * 1.2 + 6, width: W });
    const word = el(svg, 'g', { 'data-gfx': 'wordmark', 'clip-path': 'url(#sting-word-clip)' });
    letters = chars.map((c, i) => {
      const n = el(word, 'text', {
        x: textX + xs[i],
        y: baseline,
        fill: text,
        'font-family': style.fonts.sans,
        'font-weight': 700,
        'font-size': WORD_SIZE,
        opacity: 0,
      });
      n.textContent = c;
      return n;
    });
    // @end

    // @gfx tagline
    tagline = el(svg, 'text', {
      'data-gfx': 'tagline',
      x: textX + 6,
      y: baseline + 70,
      fill: muted,
      'font-family': style.fonts.mono,
      'font-weight': 500,
      'font-size': 30,
      'letter-spacing': 7,
      opacity: 0,
    });
    tagline.textContent = TAGLINE.toUpperCase();
    // @end

    // ---- Sound: cues sit on the frame things land (see the sound-design skill) ----
    // @gfx ring
    ctx.cue(T.hit, 'rise', { id: 'rise', dur: T.hit - T.ring, gain: -6 });
    // @end
    // @gfx mark
    ctx.cue(T.hit, 'logo', { id: 'logo-hit', intensity: 0.8 });
    // @end
    // @gfx logo
    ctx.cue(T.slide + SLIDE_DUR / 2, 'whoosh', { id: 'slide', dur: SLIDE_DUR, variant: 'air', gain: -8, x: (CX + finalX) / 2 });
    // @end
    // @gfx wordmark
    chars.forEach((_, i) =>
      ctx.cue(T.letters + i * T.letterStep + 0.1, 'pop', { id: `letter-${i + 1}`, pitch: pentatonic(i, 2), gain: -14, x: textX + xs[i] }),
    );
    // @end
    // @gfx tagline
    ctx.cue(T.tagline + 0.15, 'tick', { id: 'tagline', gain: -12, x: textX });
    // @end
  },

  render(t) {
    // Lockup position: centred until the slide, then left to its final spot (glow and word clip follow `lx`).
    // @gfx logo
    const lx = tween(t, T.slide, T.slide + SLIDE_DUR, CX, finalX, inOutCubic);
    const pulse = keyframes(t, [
      { t: T.hit, v: 1 },
      { t: T.hit + 0.07, v: 1.07, ease: outCubic },
      { t: T.hit + 0.45, v: 1, ease: outCubic },
    ]);
    logo.setAttribute('transform', `translate(${lx} ${CY}) scale(${pulse})`);
    // @end

    // @gfx glow
    const g = keyframes(t, [
      { t: T.ring, v: 0 },
      { t: T.hit, v: 0.7, ease: inOutCubic },
      { t: T.hit + 0.12, v: 1.25, ease: outCubic },
      { t: T.hit + 0.9, v: 1, ease: inOutCubic },
    ]);
    glow.setAttribute('opacity', Math.min(1, g));
    glow.setAttribute('transform', `translate(${lx} ${CY}) scale(${0.7 + 0.3 * g})`);
    // @end

    // @gfx ring
    const rot = -30 + 22 * t; // slow continuous turn keeps the end card alive
    ringG.setAttribute('transform', `rotate(${rot})`);
    const p = inOutCubic(progress(t, T.ring, T.hit));
    ring.setAttribute('stroke-dasharray', `${ARC * p} 2`);
    ring.setAttribute('opacity', p > 0 ? 1 : 0);
    const p2 = outCubic(progress(t, T.ring + 0.2, T.hit + 0.2));
    inner.setAttribute('stroke-dasharray', `${0.55 * p2} 2`);
    inner.setAttribute('transform', `rotate(${180 - 2.6 * rot})`);
    inner.setAttribute('opacity', p2 > 0 ? 0.55 : 0);
    const ha = (-90 + 360 * ARC * p) * (Math.PI / 180);
    head.setAttribute('cx', R * Math.cos(ha));
    head.setAttribute('cy', R * Math.sin(ha));
    head.setAttribute('r', 12 * Math.max(0, outBack(progress(t, T.ring, T.ring + 0.35))));
    // @end

    // @gfx mark
    const s = Math.max(0, outBack(progress(t, T.hit - 0.02, T.hit + 0.45)));
    const spin = tween(t, T.hit - 0.02, T.hit + 0.55, -90, 0, outExpo);
    mark.setAttribute('transform', `rotate(${spin}) scale(${s})`);
    mark.setAttribute('opacity', s > 0 ? 1 : 0);
    // @end

    // @gfx burst
    const sp = progress(t, T.hit, T.hit + 0.6);
    shock.setAttribute('r', R + 280 * outExpo(sp));
    shock.setAttribute('stroke-width', 10 * (1 - sp));
    shock.setAttribute('opacity', sp > 0 && sp < 1 ? 0.4 * (1 - sp) : 0);
    const r0 = R + 26;
    for (const ray of rays) {
      const q = progress(t, T.hit + ray.delay, T.hit + ray.delay + 0.75);
      const a = r0 + ray.dist * outExpo(q);
      const b = r0 + ray.dist * outCubic(q);
      const cx = Math.cos(ray.a);
      const sy = Math.sin(ray.a);
      ray.node.setAttribute('x1', b * cx);
      ray.node.setAttribute('y1', b * sy);
      ray.node.setAttribute('x2', a * cx);
      ray.node.setAttribute('y2', a * sy);
      ray.node.setAttribute('opacity', q > 0 && q < 1 ? 1 : 0);
    }
    for (const d of dots) {
      const q = progress(t, T.hit + d.delay, T.hit + d.delay + 0.75);
      const r = r0 + d.dist * outExpo(q);
      d.node.setAttribute('cx', r * Math.cos(d.a));
      d.node.setAttribute('cy', r * Math.sin(d.a));
      d.node.setAttribute('r', d.r * (1 - q));
      d.node.setAttribute('opacity', q > 0 && q < 1 ? 1 : 0);
    }
    // @end

    // @gfx wordmark
    wordClip.setAttribute('x', lx + R + 20);
    letters.forEach((n, i) => {
      const q = progress(t, T.letters + i * T.letterStep, T.letters + i * T.letterStep + 0.7);
      n.setAttribute('transform', `translate(0 ${WORD_SIZE * 0.9 * (1 - outExpo(q))})`);
      n.setAttribute('opacity', clamp(q * 4));
    });
    // @end

    // @gfx tagline
    const tq = outExpo(progress(t, T.tagline, T.tagline + 0.8));
    tagline.setAttribute('opacity', tq);
    tagline.setAttribute('transform', `translate(${-24 * (1 - tq)} 0)`);
    // @end
  },
};
