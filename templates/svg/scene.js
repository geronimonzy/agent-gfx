import { tween, progress } from '/runner/lib/tween.js';
import { outCubic, outExpo, inOutCubic } from '/runner/lib/ease.js';
import { gridSvg } from '/runner/lib/style.js';

const NS = 'http://www.w3.org/2000/svg';
const el = (parent, tag, attrs) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
};

// Cubic Bezier: P0 -> C1, C2 -> P3. Handles start at the endpoints and ease out to C1/C2.
const P0 = [400, 700];
const P3 = [1520, 380];
const C1 = [700, 260];
const C2 = [1250, 860];

let curve, len, handles, lines, dots;

export default {
  setup({ root, width, height, style }) {
    const { stroke, accent, muted } = style.colors;
    // the svg and its grid group, named `background`
    // @gfx background
    root.insertAdjacentHTML(
      'beforeend',
      `<svg xmlns="${NS}" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="position:absolute;left:0;top:0">${gridSvg(style, width, height, { name: 'background' })}</svg>`,
    );
    // @end
    const svg = root.querySelector('svg');

    lines = [0, 1].map(() => el(svg, 'line', { stroke: muted, 'stroke-width': 2, 'stroke-dasharray': '8 8' }));
    curve = el(svg, 'path', { fill: 'none', stroke, 'stroke-width': 6, 'stroke-linecap': 'round' });
    len = 0;
    dots = [P0, P3].map(([x, y]) => el(svg, 'circle', { cx: x, cy: y, r: 11, fill: stroke }));
    handles = [0, 1].map(() => el(svg, 'rect', { width: 22, height: 22, fill: accent }));
    curve.setAttribute('d', `M${P0} C${C1} ${C2} ${P3}`);
    len = curve.getTotalLength();
    curve.setAttribute('stroke-dasharray', len);
  },

  render(t) {
    // 0.3s-2.3s: the curve draws on.
    curve.setAttribute('stroke-dashoffset', len * (1 - outCubic(progress(t, 0.3, 2.3))));

    // Endpoint dots pop in as the curve starts / finishes.
    const d0 = outExpo(progress(t, 0.2, 0.7));
    const d1 = outExpo(progress(t, 2.0, 2.5));
    dots[0].setAttribute('r', 11 * d0);
    dots[1].setAttribute('r', 11 * d1);

    // 2.2s-3.6s: handles ease out from their anchors into place.
    const ends = [P0, P3];
    const targets = [C1, C2];
    targets.forEach((C, i) => {
      const [x, y] = tween(t, 2.2 + i * 0.25, 3.6 + i * 0.25, ends[i], C, inOutCubic);
      const vis = progress(t, 2.2 + i * 0.25, 2.5 + i * 0.25);
      handles[i].setAttribute('x', x - 11);
      handles[i].setAttribute('y', y - 11);
      handles[i].setAttribute('opacity', vis);
      lines[i].setAttribute('x1', ends[i][0]);
      lines[i].setAttribute('y1', ends[i][1]);
      lines[i].setAttribute('x2', x);
      lines[i].setAttribute('y2', y);
      lines[i].setAttribute('opacity', vis);
    });
  },
};
