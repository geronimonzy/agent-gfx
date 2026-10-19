// Read-only diagnostics for the isolated guide. App controls are never wrapped or moved.
const controls = [
  'button', 'input', 'select', 'textarea', 'th', 'kbd', 'label', 'a[href]', '[role=tab]', '[role=button]', '[role=menuitem]', '.toggle',
  '.tabs button', '.seg button', '.ct-tab', '.ns-seg label span',
  '.chip', '.badge', '.pill', '.pb-chip', '.lb-badge', '.t3-badge', '.tooltip',
  '.gfx-menu-item', '.gfx-menu-chips > span', '#toast', '.sp-title',
  '.lb-row > b', '.lb-card-body h3', '.lb-tags span', '.lb-edbar', '.ns-l',
  '.tc b', '.tc span', '.np-head > span', '.field label', '.lh-name', '.lh-db', '.rq-label', '.rq-stat', '.rq-sub',
].join(',');
const fontProperties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariationSettings', 'fontFeatureSettings', 'letterSpacing', 'textTransform'];
const fontKey = (s) => fontProperties.map((p) => s[p]).join('|');
const font = (s, size = s.fontSize) => `${s.fontStyle} ${s.fontWeight} ${size} ${s.fontFamily}`;
const number = (s, p) => parseFloat(s[p]) || 0;

// Stable, unique selectors that can be pasted into querySelector, including density/state.
function selector(el) {
  if (el.id) return `#${CSS.escape(el.id)}`;
  const parts = [];
  for (let node = el; node && node !== document.body; node = node.parentElement) {
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    let part = node.localName + [...node.classList].map((c) => `.${CSS.escape(c)}`).join('');
    if (node.dataset.density) part += `[data-density="${node.dataset.density}"]`;
    const siblings = [...node.parentElement.children].filter((s) => s.localName === node.localName);
    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    parts.unshift(part);
  }
  return parts.join(' > ');
}

export function initMeasurements() {
  const output = document.querySelector('#sg-max'), worst = document.querySelector('#sg-worst');
  const overlay = document.createElement('div');
  overlay.className = 'sg-overlay'; overlay.setAttribute('aria-hidden', 'true');
  const probe = document.createElement('span');
  probe.className = 'sg-probe'; probe.setAttribute('aria-hidden', 'true');
  const text = document.createTextNode('H'), marker = document.createElement('i');
  marker.className = 'sg-baseline'; probe.append(text, marker);
  document.body.append(overlay, probe);
  const canvas = document.createElement('canvas').getContext('2d');
  const faces = new Map(), baselines = new Map();
  let pending = false, ready = false;

  function metrics(style, label) {
    const key = fontKey(style);
    // Use the rendered size, including hinting, rather than a cap/x-height
    // average at 1000px. H supplies the cap top for labels with no ascender;
    // taller ascenders/accents in the actual label extend that top naturally.
    const faceKey = key + '|' + label;
    if (!faces.has(faceKey)) {
      canvas.font = font(style);
      canvas.letterSpacing = style.letterSpacing;
      const transformed = style.textTransform === 'uppercase' ? label.toUpperCase()
        : style.textTransform === 'lowercase' ? label.toLowerCase() : label;
      faces.set(faceKey, { cap: Math.max(canvas.measureText('H').actualBoundingBoxAscent,
        canvas.measureText(transformed).actualBoundingBoxAscent) });
    }
    const baselineKey = key + label;
    if (!baselines.has(baselineKey)) {
      for (const p of fontProperties) probe.style[p] = style[p];
      text.data = label;
      const range = document.createRange(); range.selectNodeContents(text);
      const r = range.getBoundingClientRect();
      // Zero-size inline-block's top is the alphabetic baseline. This calibrates the
      // Range's font box (which is not an ink box), including fallback symbol fonts.
      baselines.set(baselineKey, { baseline: marker.getBoundingClientRect().top - r.top, height: r.height });
    }
    const face = faces.get(faceKey);
    return { ...baselines.get(baselineKey), cap: face.cap };
  }

  function measure() {
    pending = false;
    if (!ready) return;
    const readings = [], lineBoxes = new Map(), multiline = new Set(), lines = document.createDocumentFragment();
    const add = (control, label, rects, style, estimated = false, origin = null) => {
      const box = control.getBoundingClientRect();
      const controlStyle = getComputedStyle(control);
      if (!box.width || !box.height || style.visibility === 'hidden') return;
      const id = selector(control);
      if (control.closest('[data-sg-multiline]') || control instanceof HTMLTextAreaElement) multiline.add(id);
      // Group overlapping font boxes, including labels split across nested text nodes.
      const boxes = lineBoxes.get(id) || [];
      for (const r of rects) {
        if (!r.width || !r.height) continue;
        const y = r.top + r.height / 2;
        if (!boxes.some((b) => Math.abs(b.y - y) < Math.min(b.height, r.height) / 2)) boxes.push({ y, height: r.height });
      }
      lineBoxes.set(id, boxes);
      const m = metrics(style, label);
      if (!m.height) return;
      for (const r of rects) {
        if (!r.width || !r.height) continue;
        const scale = r.height / m.height;
        const baseline = r.top + m.baseline * scale + (origin?.y || 0);
        const capTop = baseline - m.cap * scale;
        // Definition: |space above the cap/ascender top − space below baseline| / 2.
        // Borders are excluded, just as in the pixel audit. Descenders do not
        // contribute to the bottom edge of the block being centred.
        const innerTop = box.top + number(controlStyle, 'borderTopWidth');
        const innerBottom = box.bottom - number(controlStyle, 'borderBottomWidth');
        const spaceAbove = capTop - innerTop, spaceBelow = innerBottom - baseline;
        const centre = (innerTop + innerBottom) / 2;
        const capCentre = (capTop + baseline) / 2;
        const offset = (spaceBelow - spaceAbove) / 2; // positive = high, negative = low
        const deviation = Math.abs(spaceAbove - spaceBelow) / 2;
        readings.push({ selector: id, label: label.trim(), spaceAbove, spaceBelow,
          offset, capOffset: offset, deviation, estimated });
        // Retain the existing overlay classes; the solid line now marks cap centre.
        for (const [y, cls] of [[centre, 'box'], [capCentre, 'optical']]) {
          const line = document.createElement('i'); line.className = `sg-centre ${cls}`;
          // Geometry is measured data in viewport px, not UI style constants.
          line.style.left = `${box.left + window.scrollX}px`;
          line.style.top = `${y + window.scrollY}px`;
          line.style.width = `${box.width}px`;
          lines.append(line);
        }
      }
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode, parent = node.parentElement;
      if (!node.data.trim() || !parent || parent.closest('#sg-readout, .sg-probe, .sg-overlay, script, style, option, svg')) continue;
      const control = parent.closest(controls);
      if (!control || !parent.getClientRects().length) continue;
      const range = document.createRange();
      range.setStart(node, node.data.search(/\S/)); range.setEnd(node, node.data.trimEnd().length);
      add(control, range.toString(), [...range.getClientRects()], getComputedStyle(parent));
    }
    // Native widgets hide their text nodes. Mirror the content box and its line box,
    // then use an actual Range as above. UA-specific internal baselines remain estimates.
    for (const el of document.querySelectorAll('input:not([type=checkbox], [type=radio], [type=range], [type=color]), select, textarea')) {
      const box = el.getBoundingClientRect(), style = getComputedStyle(el);
      if (!box.width || !box.height) continue;
      let label = el instanceof HTMLSelectElement ? el.selectedOptions[0]?.textContent : el.value || el.placeholder;
      if (!label) continue;
      if (el.type === 'password' && el.value) label = '•'.repeat(el.value.length);
      const mirror = document.createElement('div'); mirror.className = 'sg-probe';
      for (const p of fontProperties) mirror.style[p] = style[p];
      if (!el.value && !(el instanceof HTMLSelectElement)) {
        const placeholder = getComputedStyle(el, '::placeholder');
        for (const p of fontProperties) if (placeholder[p]) mirror.style[p] = placeholder[p];
      }
      mirror.style.lineHeight = style.lineHeight;
      mirror.style.whiteSpace = el instanceof HTMLTextAreaElement ? 'pre-wrap' : 'pre';
      mirror.style.width = `${Math.max(0, el.clientWidth - number(style, 'paddingLeft') - number(style, 'paddingRight'))}px`;
      mirror.textContent = label; document.body.append(mirror);
      const range = document.createRange(); range.selectNodeContents(mirror);
      const mr = mirror.getBoundingClientRect();
      const top = number(style, 'borderTopWidth') + number(style, 'paddingTop');
      const bottom = number(style, 'borderBottomWidth') + number(style, 'paddingBottom');
      const y = box.top + top + (el instanceof HTMLTextAreaElement ? 0 : (box.height - top - bottom - mr.height) / 2);
      add(el, label, [...range.getClientRects()], getComputedStyle(mirror), true, { y: y - mr.top });
      mirror.remove();
    }
    readings.sort((a, b) => b.deviation - a.deviation);
    // Collapse wrapped lines / multiple text nodes to the worst reading for each control.
    const unique = [...new Map(readings.slice().reverse().map((r) => [r.selector, r])).values()].sort((a, b) => b.deviation - a.deviation);
    const isMultiline = (r) => multiline.has(r.selector) || lineBoxes.get(r.selector)?.length > 1;
    const singleLine = unique.filter((r) => !isMultiline(r));
    const multiLine = unique.filter(isMultiline);
    output.textContent = `Max cap-centre deviation: ${(singleLine[0]?.deviation || 0).toFixed(2)} px · ${singleLine.length} single-line labels · ${multiLine.length} multi-line (not centred by design)`;
    worst.replaceChildren(...singleLine.slice(0, 10).map((r) => {
      const li = document.createElement('li');
      li.textContent = `${r.deviation.toFixed(2)} px deviation · ${r.spaceAbove.toFixed(2)} / ${r.spaceBelow.toFixed(2)} px above / below${r.estimated ? ' (native estimate)' : ''} · ${r.selector} · “${r.label}”`;
      return li;
    }));
    document.querySelector('#sg-multiline').replaceChildren(...multiLine.map((r) => {
      const li = document.createElement('li');
      li.textContent = `multi-line (not centred by design) · ${r.selector} · “${r.label}”`;
      return li;
    }));
    overlay.replaceChildren(lines);
    // Full inventory for inspecting any component, even when it is outside the worst ten.
    window.sgMeasurements = { maxDeviation: singleLine[0]?.deviation || 0, controls: singleLine, multiLine, readings };
  }
  function schedule() { if (ready && !pending) { pending = true; requestAnimationFrame(measure); } }
  document.querySelector('#sg-centres').addEventListener('change', (e) => {
    document.body.classList.toggle('centres', e.target.checked); schedule();
  });
  window.addEventListener('resize', schedule);
  window.addEventListener('theme', schedule);
  document.addEventListener('input', schedule); document.addEventListener('change', schedule);
  document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
  for (const event of ['pointerdown', 'pointerup', 'pointerover', 'pointerout', 'transitionend']) document.addEventListener(event, schedule);
  document.fonts.ready.then(() => { ready = true; schedule(); });
  document.fonts.addEventListener('loadingdone', () => { faces.clear(); baselines.clear(); schedule(); });
  const observer = new ResizeObserver(schedule);
  observer.observe(document.querySelector('#sg-content'));
  observer.observe(document.querySelector('.sg-header')); // readout wrapping can move every specimen
}
