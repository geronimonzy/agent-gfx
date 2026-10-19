// Reel starter (1080x1920, anime.js). Named elements (data-gfx) are selectable in the studio; cues drive `gfx audio`.
// `@gfx <name>` … `@end` comments mark each named element's code (markup, tweens, cues): the studio's "Open code" shows
// exactly those blocks. Comments only, they never change the picture.
import { createTimeline, stagger } from 'animejs';
import { gridCss } from '/runner/lib/style.js';

const WORDS = ['Make', 'it', 'move.'];
let tl;

export default {
  setup(ctx) {
    const { root, style } = ctx;
    const { text, muted, accent, surface, border } = style.colors;

    root.insertAdjacentHTML(
      'beforeend',
      `<!-- @gfx background -->
       <div data-gfx="background" style="position:absolute;inset:0"></div>
       <!-- @end -->
       <div style="position:absolute;left:0;right:0;top:420px;display:flex;flex-direction:column;align-items:center;gap:56px">
         <!-- @gfx headline -->
         <div data-gfx="headline" style="display:flex;gap:24px;font:700 128px ${style.fonts.sans};color:${text};letter-spacing:-0.03em">
           ${WORDS.map((w) => `<span class="word" style="display:inline-block">${w}</span>`).join('')}
         </div>
         <!-- @end -->
         <!-- @gfx rule -->
         <div data-gfx="rule" style="width:360px;height:8px;background:${accent};border-radius:4px;transform-origin:left"></div>
         <!-- @end -->
         <!-- @gfx card -->
         <div data-gfx="card" style="width:760px;height:620px;background:${surface};border:3px solid ${border};border-radius:40px"></div>
         <!-- @end -->
         <!-- @gfx caption -->
         <div data-gfx="caption" style="font:500 44px ${style.fonts.mono};color:${muted}">your first gfx scene</div>
         <!-- @end -->
       </div>`,
    );

    // @gfx background
    Object.assign(root.querySelector('[data-gfx="background"]').style, gridCss(style)); // first child = bottom layer, full frame
    // @end

    tl = createTimeline({ autoplay: false, defaults: { ease: 'outExpo', duration: 700 } })
      // @gfx headline
      .add('.word', { opacity: [0, 1], translateY: [80, 0], delay: stagger(140) }, 200)
      // @end
      // @gfx rule
      .add('[data-gfx="rule"]', { scaleX: [0, 1], duration: 800 }, 900)
      // @end
      // @gfx card
      .add('[data-gfx="card"]', { opacity: [0, 1], scale: [0.85, 1], ease: 'outBack(1.4)' }, 1300)
      // @end
      // @gfx caption
      .add('[data-gfx="caption"]', { opacity: [0, 1], translateY: [24, 0] }, 1900);
      // @end

    // sound cues at the moments things land (see SOUND.md in the motion-graphics skill)
    // @gfx headline
    WORDS.forEach((_, i) => ctx.cue(0.2 + i * 0.14 + 0.12, 'pop', { id: `word-${i + 1}`, pitch: i * 2 }));
    // @end
    // @gfx rule
    ctx.cue(0.95, 'whoosh', { id: 'rule', dur: 0.5 });
    // @end
    // @gfx card
    ctx.cue(1.4, 'impact', { id: 'card', variant: 'thud' });
    // @end
    // @gfx caption
    ctx.cue(2.0, 'tick', { id: 'caption' });
    // @end

    // Prime: tweens that have not started never apply their `from` values, so jump to the end and back once
    // (otherwise the elements flash visible at t=0). See the animejs skill, "Seek pitfalls".
    tl.seek(tl.duration);
    tl.seek(0);
  },

  render(t) {
    // Reset, then seek: back-seeking across gaps between tweens of the same property is unreliable otherwise,
    // and every frame must be a pure function of t (scrubbing, parallel captures).
    tl.seek(0);
    tl.seek(t * 1000);
  },
};
