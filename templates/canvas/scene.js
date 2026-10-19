import { tween } from '/runner/lib/tween.js';
import { outBack } from '/runner/lib/ease.js';
import { drawGrid } from '/runner/lib/style.js';

let c;

function starPath(ctx, cx, cy, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export default {
  setup({ root, width, height, style }) {
    // Background = its own canvas underneath, named so it is a layer in the studio (select / hide / tweak).
    // Drawn once (static); a moving background would be redrawn in render().
    // @gfx background
    const bg = document.createElement('canvas');
    bg.width = width;
    bg.height = height;
    bg.style.cssText = 'position:absolute;left:0;top:0';
    bg.setAttribute('data-gfx', 'background');
    root.appendChild(bg);
    drawGrid(bg.getContext('2d'), style);
    // @end

    const canvas = document.createElement('canvas'); // content: transparent, redrawn every frame
    canvas.width = width;
    canvas.height = height;
    canvas.style.cssText = 'position:absolute;left:0;top:0';
    root.appendChild(canvas);
    c = canvas.getContext('2d');
  },

  render(t, { width, height, style }) {
    c.clearRect(0, 0, width, height);

    // Scale in with a back-ease over the first 1.2s, then breathe.
    const intro = tween(t, 0.3, 1.5, 0, 1, outBack);
    const breathe = 1 + 0.04 * Math.sin(((t - 1.5) * 2 * Math.PI) / 3) * (t > 1.5 ? 1 : 0);
    const s = intro * breathe;
    const cx = width / 2;
    const cy = height / 2;

    c.save();
    c.translate(cx, cy);
    c.scale(s, s);
    c.translate(-cx, -cy);

    c.shadowColor = style.colors.accent;
    c.shadowBlur = 60;
    c.fillStyle = style.colors.accent;
    starPath(c, cx, cy, 240, 100);
    c.fill();
    c.shadowBlur = 0;

    c.lineJoin = 'round';
    c.lineWidth = 4;
    c.strokeStyle = style.colors.accentSoft;
    c.stroke();
    c.restore();
  },
};
