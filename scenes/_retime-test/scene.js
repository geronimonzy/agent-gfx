// Fixture for tests/retime.test.mjs (docs/RETIME.md): an anime timeline on an unnamed wrapper, render-written text,
// nested named elements, a shared unnamed container, a canvas object drawn through ctx.clock(), and a static box.
import { createTimeline } from 'animejs';

let tl;
let cv, g, ball, counter;
const box = (attr, l, t, w, h, bg, extra = '') =>
  `<div ${attr} style="position:absolute;left:${l}px;top:${t}px;width:${w}px;height:${h}px;background:${bg};${extra}"></div>`;

export default {
  setup(ctx) {
    ctx.root.insertAdjacentHTML('beforeend', `
      <div class="wrap" style="position:absolute;left:0;top:0;opacity:0">${box('data-gfx="mover"', 20, 20, 60, 60, '#4dabff')}</div>
      ${box('data-gfx="still"', 700, 20, 60, 60, '#3ddc97')}
      <div data-gfx="parent" style="position:absolute;left:20px;top:120px;width:200px;height:80px;background:#223">
        ${box('data-gfx="child"', 10, 10, 60, 60, '#ffd23f')}
      </div>
      <div data-gfx="counter" style="position:absolute;left:300px;top:120px;width:200px;height:60px;color:#fff;font:40px sans-serif">0</div>
      <div class="pair" style="position:absolute;left:520px;top:120px;width:260px;height:80px">
        ${box('data-gfx="sib"', 0, 0, 60, 60, '#f472b6')}${box('data-gfx="other"', 100, 0, 60, 60, '#a78bfa')}
      </div>
      <canvas width="800" height="160" style="position:absolute;left:0;top:240px"></canvas>`);
    cv = ctx.root.querySelector('canvas');
    g = cv.getContext('2d');
    counter = ctx.root.querySelector('[data-gfx="counter"]');
    const q = (s) => ctx.root.querySelector(s);
    tl = createTimeline({ autoplay: false, defaults: { ease: 'linear' } });
    tl.add(q('.wrap'), { opacity: [0, 1], duration: 200 }, 500);
    tl.add(q('[data-gfx="mover"]'), { translateX: [0, 400], duration: 1000 }, 500);
    tl.add(q('[data-gfx="parent"]'), { translateY: [0, 20], duration: 1000 }, 500);
    tl.add(q('[data-gfx="child"]'), { rotate: [0, 90], duration: 1000 }, 500);
    tl.add(q('[data-gfx="sib"]'), { translateY: [0, 15], duration: 1000 }, 500);
    tl.add(q('.pair'), { translateX: [0, -40], duration: 1000 }, 500);
    const bx = (t) => 20 + 200 * Math.min(1, Math.max(0, t - 0.5));
    ball = { clock: ctx.clock('ball'), bx };
    ctx.el('ball', { bounds: (t) => ({ x: bx(t), y: 260, w: 40, h: 40 }) });
    ctx.cue(0.5, 'whoosh', { id: 'mover-in', el: 'mover' });
    ctx.cue(1.0, 'pop', { id: 'child-pop' });
    ctx.cue(2.0, 'click', { id: 'tick' });
    tl.seek(tl.duration);
    tl.seek(0);
  },
  render(t) {
    tl.seek(0);
    tl.seek(t * 1000);
    counter.textContent = String(Math.round(t * 10));
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#ff4d6d';
    g.fillRect(ball.bx(ball.clock(t)), 20, 40, 40);
  },
};
