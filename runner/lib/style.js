// Background-grid helpers shared by all scene kinds.

/** Fill the canvas with style bg and draw the grid. Call at the start of each frame. */
export function drawGrid(c, style, { cell = 40, majorEvery = 4 } = {}) {
  const { width: w, height: h } = c.canvas;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = style.colors.bg;
  c.fillRect(0, 0, w, h);
  c.lineWidth = 1;
  for (const strong of [false, true]) {
    c.strokeStyle = strong ? style.colors.gridStrong : style.colors.grid;
    c.beginPath();
    for (let i = 0, x = 0; x <= w; i++, x += cell) {
      if ((i % majorEvery === 0) === strong) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); }
    }
    for (let i = 0, y = 0; y <= h; i++, y += cell) {
      if ((i % majorEvery === 0) === strong) { c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); }
    }
    c.stroke();
  }
  c.restore();
}

/** SVG markup string (bg rect + two grid paths); put it at the start of an <svg>. `name` (e.g. 'background') adds data-gfx so the group is a studio layer. */
export function gridSvg(style, w, h, { cell = 40, majorEvery = 4, name } = {}) {
  const d = { minor: '', major: '' };
  for (let i = 0, x = 0; x <= w; i++, x += cell) d[i % majorEvery ? 'minor' : 'major'] += `M${x + 0.5} 0V${h}`;
  for (let i = 0, y = 0; y <= h; i++, y += cell) d[i % majorEvery ? 'minor' : 'major'] += `M0 ${y + 0.5}H${w}`;
  const { bg, grid, gridStrong } = style.colors;
  return (
    `<g class="gfx-grid"${name ? ` data-gfx="${name}"` : ''}><rect width="${w}" height="${h}" fill="${bg}"/>` +
    `<path d="${d.minor}" stroke="${grid}" stroke-width="1" fill="none"/>` +
    `<path d="${d.major}" stroke="${gridStrong}" stroke-width="1" fill="none"/></g>`
  );
}

/** Grid as CSS style props (for HTML/anime scenes): Object.assign(el.style, gridCss(style)). */
export function gridCss(style, { cell = 40, majorEvery = 4 } = {}) {
  const { grid, gridStrong, bg } = style.colors;
  const big = cell * majorEvery;
  const h = (c) => `linear-gradient(${c} 1px, transparent 1px)`;
  const v = (c) => `linear-gradient(90deg, ${c} 1px, transparent 1px)`;
  return {
    backgroundColor: bg,
    backgroundImage: [h(gridStrong), v(gridStrong), h(grid), v(grid)].join(','),
    backgroundSize: `${big}px ${big}px,${big}px ${big}px,${cell}px ${cell}px,${cell}px ${cell}px`,
  };
}
