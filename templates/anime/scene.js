import { createTimeline, stagger } from 'animejs';
import { gridCss } from '/runner/lib/style.js';

const CHIPS = ['anime.js', 'three.js', 'Canvas 2D', 'SVG'];
let tl;

export default {
  setup({ root, style }) {
    const { text, muted, surface, border, accent } = style.colors;

    root.insertAdjacentHTML(
      'beforeend',
      `<!-- @gfx background -->
       <div data-gfx="background" style="position:absolute;inset:0"></div>
       <!-- @end -->
       <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:48px">
         <div class="label" style="font:600 72px ${style.fonts.sans};color:${text};letter-spacing:-0.02em">Pick your tool</div>
         <div style="display:flex;gap:24px">
           ${CHIPS.map((c) => `<div class="chip" style="font:500 36px ${style.fonts.mono};color:${text};background:${surface};border:2px solid ${border};border-radius:999px;padding:18px 36px">${c}</div>`).join('')}
         </div>
         <div class="rule" style="width:240px;height:4px;background:${accent};border-radius:2px;transform-origin:left"></div>
         <div class="sub" style="font:400 28px ${style.fonts.mono};color:${muted}">seeked by render(t)</div>
       </div>`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style)); // first child = bottom layer, full frame
    // @end

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 900 } })
      .add('.label', { opacity: [0, 1], translateY: [24, 0] }, 200)
      .add('.chip', { opacity: [0, 1], translateY: [40, 0], scale: [0.9, 1], delay: stagger(120) }, 600)
      .add('.rule', { scaleX: [0, 1], duration: 1000 }, 1500)
      .add('.sub', { opacity: [0, 1] }, 1900);
    tl.seek(tl.duration); // prime: unstarted tweens would not apply their `from` values (animejs skill, "Seek pitfalls")
    tl.seek(0);
  },

  render(t) {
    tl.seek(0); // reset first: back-seeking across tween gaps is unreliable
    tl.seek(t * 1000);
  },
};
