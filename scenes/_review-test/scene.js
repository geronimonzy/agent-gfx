// Fixture for tests/review.test.mjs: named + unnamed + nested-scaled elements, anime-animated and static.
import { createTimeline } from 'animejs';

let tl;
const box = (id, l, t, w, h, bg, extra = '') =>
  `<div ${id} style="position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:${bg};${extra}"></div>`;

export default {
  setup(ctx) {
    ctx.root.insertAdjacentHTML('beforeend', `
      ${box('data-gfx="mover"', 50, 50, 100, 100, '#4dabff')}
      ${box('data-gfx="fader"', 50, 200, 100, 100, '#ff4d6d')}
      ${box('data-gfx="still"', 300, 50, 100, 100, '#3ddc97')}
      <div data-gfx="scaler" style="position:absolute;left:400px;top:300px;width:200px;height:200px;transform:scale(2);transform-origin:0 0;background:#223">
        ${box('data-gfx="kid"', 10, 10, 40, 40, '#ffd23f')}
      </div>
      <div class="plain" style="position:absolute;left:50px;top:350px;width:250px;height:150px;background:#334">
        <div class="inner" style="position:absolute;left:10px;top:10px;width:200px;height:60px;background:#556">
          <span class="tx" style="position:absolute;left:8px;top:8px;color:#fff;font:24px sans-serif">Plain text</span>
        </div>
      </div>
      <div data-gfx="label" style="position:absolute;left:300px;top:200px;width:200px;height:50px;color:#fff;font:32px sans-serif">Hello</div>
      <div data-gfx="dup" style="position:absolute;left:600px;top:20px;width:20px;height:20px;background:#fff"></div>
      <div data-gfx="dup" style="position:absolute;left:640px;top:20px;width:20px;height:20px;background:#fff"></div>
      <div data-gfx="chips" style="position:absolute;left:20px;top:530px;width:200px;height:50px">
        <div class="row" style="position:absolute;left:0;top:0">
          ${[0, 1, 2].map((i) => box(`data-gfx="chip-${i}"`, i * 60, 0, 50, 50, '#a78bfa')).join('')}
        </div>
      </div>
      ${box('data-gfx="late"', 700, 300, 60, 60, '#f97316', 'opacity:0')}
      ${box('data-gfx="za"', 650, 420, 80, 80, '#06b6d4')}
      ${box('data-gfx="zb"', 690, 440, 80, 80, '#e11d48')}
      <div data-gfx="empty-outer" style="position:absolute;left:760px;top:520px;width:20px;height:20px">
        <div data-gfx="empty-inner" style="width:20px;height:20px">
          ${box('data-gfx="container-child"', 0, 0, 20, 20, '#fff', 'opacity:0')}
        </div>
      </div>
      ${box('data-gfx="empty-leaf"', 760, 550, 20, 20, 'transparent')}
      <div data-gfx="painted-parent" style="position:absolute;left:760px;top:580px;width:20px;height:20px;background:#fff">
        ${box('data-gfx="painted-child"', 0, 0, 20, 20, '#fff', 'opacity:0')}
      </div>
      <div class="clip-ancestor" style="position:absolute;left:760px;top:20px;width:20px;height:20px;clip-path:circle(0px at 50% 50%)">
        ${box('data-gfx="clip-child"', 0, 0, 20, 20, '#fff')}
      </div>
      ${[
        ['clip-circle', 'circle(0px at 50% 50%)'],
        ['clip-tiny', 'circle(0.5px at 50% 50%)'],
        ['clip-inset-y', 'inset(60% 0 40%)'],
        ['clip-inset-x', 'inset(0 12px 0 8px)'],
        ['clip-polygon', 'polygon(0 0, 50% 50%, 100% 100%)'],
        ['clip-bowtie', 'polygon(0 0, 100% 100%, 100% 0, 0 100%)'],
      ].map(([key, clip], i) => box(`data-gfx="${key}"`, 760, 60 + i * 30, 20, 20, '#fff', `clip-path:${clip}`)).join('')}
      <!-- §7 motion fixtures: known motion for values/path tests -->
      ${box('data-gfx="vx-move"', 250, 540, 40, 40, '#22d3ee')}
      ${box('data-gfx="vx-rot"', 480, 540, 60, 40, '#a3e635')}
      <div data-gfx="vx-sp" style="position:absolute;left:560px;top:480px;width:100px;height:60px;transform:scale(2);transform-origin:0 0">
        ${box('data-gfx="vx-sc"', 10, 10, 20, 20, '#f472b6')}
      </div>
      ${box('data-gfx="vx-fade"', 700, 545, 30, 30, '#fde047')}
      <div data-gfx="vx-rp" style="position:absolute;left:260px;top:480px;width:120px;height:20px;transform:rotate(90deg);opacity:0.5">
        ${box('data-gfx="vx-rk"', 0, 0, 20, 10, '#fb923c', 'opacity:0.5')}
      </div>
      ${box('data-gfx="vx-css"', 400, 540, 40, 40, '#c084fc', 'translate:10px 0;rotate:30deg;scale:1.5')}
    `);
    const q = (s) => ctx.root.querySelector(s);
    // ctx.el on a node that has no data-gfx yet, and a bounds-registered non-DOM object
    ctx.el('plain-inner', q('.inner'));
    ctx.el('ball', { bounds: (t) => ({ x: 600 + t * 20, y: 100, w: 60, h: 60 }) });
    tl = createTimeline({ autoplay: false, defaults: { ease: 'linear', duration: 1000 } })
      .add(q('[data-gfx="mover"]'), { translateX: [0, 300] }, 0)
      .add(q('[data-gfx="fader"]'), { opacity: [1, 0.5] }, 0)
      .add(q('[data-gfx="kid"]'), { translateX: [0, 20] }, 0)
      .add(q('[data-gfx="vx-move"]'), { translateX: [0, 200] }, 0)
      .add(q('[data-gfx="vx-rot"]'), { rotate: [0, 90] }, 0)
      .add(q('[data-gfx="vx-sc"]'), { scale: [1, 2] }, 0)
      .add(q('[data-gfx="vx-fade"]'), { opacity: [1, 0] }, 0);
  },
  render(t, ctx) {
    tl.seek(t * 1000);
    ctx.root.querySelector('[data-gfx="late"]').style.opacity = t >= 1 ? '1' : '0'; // hidden until t=1, then shown
    ctx.root.querySelector('[data-gfx="container-child"]').style.opacity = t >= 1 ? '1' : '0';
    ctx.root.querySelector('[data-gfx="empty-outer"]').style.opacity = t < 1.6 ? '1' : '0';
    ctx.root.querySelector('.clip-ancestor').style.clipPath = `circle(${t >= 1 ? 20 : 0}px at 50% 50%)`;
    ctx.root.querySelector('[data-gfx="clip-circle"]').style.clipPath = `circle(${t >= 1 ? 20 : 0}px at 50% 50%)`;
    ctx.tweak('ball'); // scenes read their own tweak for non-DOM objects
  },
};
