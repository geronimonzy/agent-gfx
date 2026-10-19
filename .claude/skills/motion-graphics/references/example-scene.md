# Minimal contract scene (canvas kind)

`scenes/hello/scene.json`
```json
{ "kind": "canvas", "width": 1920, "height": 1080, "fps": 60, "duration": 5, "style": "dark-grid", "title": "Hello" }
```

`scenes/hello/scene.js`
```js
import { outExpo, inOutCubic } from '/runner/lib/ease.js';
import { progress, tween } from '/runner/lib/tween.js';
import { drawGrid } from '/runner/lib/style.js';

let g;
export default {
  async setup(ctx) {
    const c = document.createElement('canvas');
    c.width = ctx.width; c.height = ctx.height;
    ctx.root.appendChild(c);
    g = c.getContext('2d');
  },
  render(t, ctx) {
    const { width: W, height: H, style: s } = ctx;
    g.clearRect(0, 0, W, H);
    g.fillStyle = s.colors.bg; g.fillRect(0, 0, W, H);
    drawGrid(g, s, { cell: 60, majorEvery: 4 });

    const exit = inOutCubic(progress(t, 4.0, 4.6));
    g.globalAlpha = outExpo(progress(t, 0.3, 1.3)) * (1 - exit);
    g.fillStyle = s.colors.text;
    g.font = `700 ${Math.round(H * 0.08)}px ${s.fonts.sans}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('Hello', W / 2, H / 2 + tween(t, 0.3, 1.3, 40, 0, outExpo));
    g.globalAlpha = 1;
  },
};
```

# STORYBOARD.md template
```
# <title>  <W>x<H> @<fps>  <dur>s  style: <preset>
Message: <one sentence>
| beat | time | on screen | motion / easing | text |
```
Per beat ask: the one idea; read time; what moves where; what overlaps the next beat.
