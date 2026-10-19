import { tok, clearTokens } from './theme.js';
// Canvas timeline: ruler, thumbnail strip, notes lane, one waveform+cue lane per stem, playhead.
// Two layers: a cached "static" canvas (re-rendered on view/state change) and a cheap per-frame overlay (playhead etc.).
import { liveComments, getComment } from './comments.js';
import { S, on, emit, fps, duration, clamp, snapT, stemColor, NOTE_COLOR, patchCue, addCue, setStemDraftGain, cueById, isAdded } from './store.js';
import { engine } from './audio.js';
import { peaksOf, query } from './peaks.js';
import { thumbs } from './thumbs.js';
import { seek, beginScrub, endScrub, transport } from './transport.js';
import { LY, rows as layerRowsOf, rowSelected, isTweaked, toggleTimelineOpen, selectLayer } from './layers.js';
import { liveOn } from './live.js';
import { T, vis, groupOpen, toggleGroup, toggleShy, toggleReveal, hiddenCount, curvesOpen, toggleCurves, curvesSig } from './tracks.js';
import { pathOf, P } from './paths.js';
import { zoomOf, pixelRatioOf } from './dom.js';
import { RT, initRetime, toggleLinked, isCueSelected, selectedCues, setCueSelection, toggleCue, selectLane, moveCues, beginLayerDrag, updateLayerDrag, endLayerDrag, previewSpans, whyNot } from './retime.js';
import { moveBy, stretchAbout, inBox } from './retime-core.js';
import { openTweak } from './soundtweak.js';

const MAX_PPS = 30000;
let RULER, THUMB, NOTES, HEAD_W, PAD, MIN_LANE, LAYER_HEAD, LAYER_ROW, GH, SUM_V, SUM_A, CURVE_ROW;
function readMetrics() {
  clearTokens();
  // Custom-property calc() values need a used CSS length, rather than parseFloat('calc(...)').
  const probe = document.createElement('i');
  probe.style.cssText = 'position:absolute;display:block;visibility:hidden;pointer-events:none;width:0';
  // A detached panel (dockview moving it) or a pop-out whose styles are not in yet has no computed custom properties:
  // read from the main document then.
  const own = scroller.isConnected && getComputedStyle(scroller).getPropertyValue('--timeline-ruler-h');
  const scope = own ? scroller : document.body;
  scope.append(probe);
  const length = (name) => {
    probe.style.height = tok(name, scope);
    return parseFloat(getComputedStyle(probe).height);
  };
  [RULER, THUMB, NOTES, HEAD_W, PAD, MIN_LANE, LAYER_HEAD, LAYER_ROW, GH, SUM_V, SUM_A, CURVE_ROW] = [
    '--timeline-ruler-h', '--timeline-thumb-h', '--timeline-notes-h', '--timeline-head-w', '--timeline-pad',
    '--timeline-lane-min-h', '--timeline-layer-head-h', '--timeline-layer-row-h', '--timeline-group-h',
    '--timeline-video-summary-h', '--timeline-audio-summary-h', '--timeline-curve-row-h',
  ].map(length);
  probe.remove();
}
const CHANNELS = [['x', (s) => s.cx, 'x'], ['y', (s) => s.cy, 'y'], ['scale', (s) => s.scaleX, 'scale'], ['rotate', (s) => s.rotate, 'rot'], ['opacity', (s) => s.opacity, 'opac']];
const LINK = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M6.6 9.4l2.8-2.8M7.2 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M8.8 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const SHY = '<svg viewBox="0 0 16 16" width="12" height="12"><path d="M2 7.5c1.6 2.4 3.6 3.4 6 3.4s4.4-1 6-3.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M4 10l-1.4 2M8 11.2V13.4M12 10l1.4 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const C = {
  get bg() { return tok('--timeline-bg'); }, get panel() { return tok('--card'); },
  get border() { return tok('--timeline-grid'); }, get text() { return tok('--foreground'); },
  get muted() { return tok('--muted-foreground'); }, get accent() { return tok('--primary'); },
  get lane() { return [tok('--timeline-lane'), tok('--timeline-lane-alt')]; },
  get notes() { return tok('--timeline-notes'); }, get thumb() { return tok('--timeline-thumb'); },
};
const font = () => `${tok('--text-3xs')} ${tok('--font-sans')}`;
const mono = () => `${tok('--text-3xs')} ${tok('--font-mono')}`;

let scroller, inner, heads, wrap, cv, g, sc, sg; // sc/sg = static canvas + ctx
let W = 0, TOTAL = 0, dpr = 1;
let L = { lanes: [], allLanes: [], groups: [], thumb: null, notes: null, vsum: null, asum: null, layersTop: 0, layersH: 0, layerRows: [], layersDim: false, lanesTop: 0 };
let hits = { cues: [], notes: [], layers: [] };
let dirtyStatic = true, dirtyOverlay = true;
let hoverX = -1, hoverY = -1, drag = null, dragSeq = 0;
const textW = new Map();
const tw = (s, font) => { const k = font + s; let w = textW.get(k); if (w === undefined) { g.font = font; w = g.measureText(s).width; textW.set(k, w); } return w; };

export const X = (t) => (t - S.view.start) * S.view.pps;
const tOf = (x) => S.view.start + x / S.view.pps;
export const viewWidth = () => W;

export function invalidate(stat = true) { if (stat) dirtyStatic = true; dirtyOverlay = true; }

export function initTimeline(els) {
  const refreshMetrics = () => { readMetrics(); textW.clear(); relayout(); };
  window.addEventListener('theme', refreshMetrics);
  ({ scroller, inner, heads, wrap, canvas: cv } = els);
  initRetime();
  on('retime-linked', () => buildHeads());
  readMetrics();
  L.lanesTop = RULER;
  // Density and local/root scale can change without changing the panel's outer dimensions.
  const metricObserver = new MutationObserver(refreshMetrics);
  const watchMetrics = () => {
    metricObserver.disconnect();
    for (let el = scroller; el; el = el.parentElement) metricObserver.observe(el, { attributes: true, attributeFilter: ['data-density', 'style'] });
  };
  watchMetrics();
  g = cv.getContext('2d');
  sc = document.createElement('canvas'); sg = sc.getContext('2d');
  new ResizeObserver(() => relayout()).observe(scroller);
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('pointerleave', () => { hoverX = hoverY = -1; invalidate(false); });
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('wheel', onWheel, { passive: false });
  for (const ev of ['draft', 'mode', 'draftbuffers', 'thumbs', 'selection', 'view', 'scene', 'comments', 'el-select', 'paths-data']) on(ev, () => invalidate(true));
  on('tracks', () => { relayout(); }); on('paths-data', () => buildHeads());
  on('panel-scale', refreshMetrics); on('dock-moved', () => { watchMetrics(); refreshMetrics(); }); // per-panel / UI scale, moved to a popout (other DPR)
  on('layers', onLayers); on('live', onLayers);
  on('el-select', updateHeads);
  on('comments', updateHeads);
  on('time', () => invalidate(false)); on('code-band', () => invalidate(false));
  on('scene', () => { fitView(); buildHeads(); });
  on('draft', () => {
    if (S.stemOrder.join('|') !== L.allLanes.join('|')) relayout();
    updateHeads();
  });
  on('draftbuffers', updateHeads); on('mode', updateHeads); on('selection', updateHeads);
  const frame = () => {
    requestAnimationFrame(frame);
    if (dirtyStatic) { renderStatic(); dirtyStatic = false; dirtyOverlay = true; }
    if (dirtyOverlay) { paint(); dirtyOverlay = false; }
  };
  // Canvas ignores font-display. Explicitly request both faces, then wait for the
  // document font set before starting the first draw or caching any text widths.
  Promise.allSettled([document.fonts.load(font()), document.fonts.load(mono())])
    .then(() => document.fonts.ready)
    .then(() => { textW.clear(); invalidate(); frame(); });
}

// ---------- layout ----------
const LAYER_IDS = ['frames', 'comments', 'layers'];
/** Layer rows with their y offset inside the LAYERS section (value-curve sub-rows add height under a row). */
function buildLayerRows() {
  if (!liveOn() || !LY.ready) return [];
  const rows = layerRowsOf();
  let y = 0;
  for (const r of rows) {
    r.y = y; r.cv = !r.group && curvesOpen(r.key);
    y += LAYER_ROW + (r.cv ? CHANNELS.length * CURVE_ROW : 0);
  }
  rows.total = y;
  return rows;
}
function relayout() {
  if (!scroller) return;
  dpr = pixelRatioOf(cv); // device px per canvas px: DPR x the panel's CSS zoom (docs/LAYOUT.md §4)
  heads.style.width = HEAD_W + 'px';
  const avail = scroller.clientHeight;
  let y = RULER;
  const groups = [], R = { thumb: null, notes: null, vsum: null, asum: null, layersTop: 0, layersH: 0, layerRows: [], layersDim: false };
  const hasLayers = liveOn() && LY.ready;
  // VIDEO group
  const vOpen = groupOpen('video'), vHidden = hiddenCount(hasLayers ? LAYER_IDS : ['frames', 'comments']);
  groups.push({ id: 'video', top: y, h: GH, open: vOpen, hidden: vHidden, reveal: T.reveal.video }); y += GH;
  if (vOpen) {
    let v = vis('frames', 'video');
    if (v !== 'hide') { R.thumb = { top: y, h: THUMB, dim: v === 'dim' }; y += THUMB; }
    v = vis('comments', 'video');
    if (v !== 'hide') { R.notes = { top: y, h: NOTES, dim: v === 'dim' }; y += NOTES; }
    v = hasLayers ? vis('layers', 'video') : 'hide';
    if (v !== 'hide') {
      R.layerRows = buildLayerRows(); R.layersTop = y; R.layersDim = v === 'dim';
      R.layersH = LAYER_HEAD + (LY.tlOpen ? R.layerRows.total : 0); y += R.layersH;
    }
  } else { R.vsum = { top: y, h: SUM_V }; y += SUM_V; }
  // AUDIO group
  const aOpen = groupOpen('audio'), names = S.stemOrder;
  groups.push({ id: 'audio', top: y, h: GH, open: aOpen, hidden: hiddenCount(names.map((n) => 'lane:' + n)), reveal: T.reveal.audio }); y += GH;
  const lanes = [];
  const shown = names.map((name) => ({ name, v: vis('lane:' + name, 'audio') })).filter((x) => x.v !== 'hide');
  if (aOpen && shown.length) {
    const laneH = Math.max(MIN_LANE, Math.floor((avail - y) / shown.length));
    shown.forEach((x, i) => lanes.push({ name: x.name, top: y + i * laneH, h: laneH, dim: x.v === 'dim' }));
    y += laneH * shown.length;
  } else if (!aOpen) { R.asum = { top: y, h: SUM_A }; y += SUM_A; }
  TOTAL = Math.max(y, 40);
  inner.style.height = TOTAL + 'px';
  W = Math.max(50, wrap.clientWidth);
  for (const c of [cv, sc]) { c.width = Math.round(W * dpr); c.height = Math.round(TOTAL * dpr); }
  cv.style.width = W + 'px'; cv.style.height = TOTAL + 'px';
  L = { ...R, groups, lanes, allLanes: [...names], lanesTop: lanes[0]?.top ?? y };
  clampView();
  buildHeads();
  invalidate();
}
export function fitView() {
  relayout();
  const d = duration() || 1;
  S.view.pps = (W - PAD * 2) / d;
  S.view.start = -PAD / S.view.pps;
  clampView();
  emit('view');
}
function clampView() {
  const d = duration();
  S.view.pps = clamp(S.view.pps, Math.max(1, (W - PAD * 2) / Math.max(d, 0.1)), MAX_PPS);
  const lo = -PAD / S.view.pps, hi = d + PAD / S.view.pps - W / S.view.pps;
  S.view.start = hi < lo ? lo : clamp(S.view.start, lo, hi);
}
export function zoomAt(factor, x) {
  const t = tOf(x);
  S.view.pps *= factor;
  clampView();
  S.view.start = t - x / S.view.pps;
  clampView();
  emit('view');
}
function scrollBy(dx) { S.view.start += dx / S.view.pps; clampView(); emit('view'); }
export function ensureVisible(t, center = false) {
  const x = X(t);
  if (center || x < 24 || x > W - 24) { S.view.start = t - (W * 0.4) / S.view.pps; clampView(); emit('view'); }
}
export function noteScreenPos(id) {
  const n = getComment(id);
  if (!n) return null;
  const r = cv.getBoundingClientRect();
  const z = zoomOf(cv);
  return { x: r.left + clamp(X(n.t), 0, W) * z, y: r.top + (L.notes?.top ?? L.groups[0]?.top ?? RULER) * z };
}

// ---------- layers section (REVIEW.md §6) ----------
const layerSig = () => (liveOn() && LY.ready ? LY.tlOpen + '|' + curvesSig() + '|' + layerRowsOf().map((r) => r.id + (r.group ? 'g' : '')).join(',') : '');
let sigNow = '';
function onLayers() {
  const sig = layerSig();
  if (sig !== sigNow) { sigNow = sig; relayout(); } else { L.layerRows = L.layersH ? buildLayerRows() : []; updateHeads(); invalidate(); }
}
const layerY = (r) => L.layersTop + LAYER_HEAD + r.y;

// ---------- lane headers (DOM) ----------
let headsHTML = '';
const fmtR = (v) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
/** [min, max] of a channel over the visible samples; null when there are none. */
function sampleRange(d, fn) {
  let lo = Infinity, hi = -Infinity;
  for (const s of d.samples) if (s.visible) { const v = fn(s); if (v < lo) lo = v; if (v > hi) hi = v; }
  return hi >= lo ? [lo, hi] : null;
}
function chRange(key, fn) {
  const d = pathOf(key);
  return d ? sampleRange(d, fn) || [] : null;
}
function buildHeads() {
  const mk = (cls, top, h, html, extra = '') => `<div class="${cls}" style="top:${top}px;height:${h}px"${extra}>${html}</div>`;
  const shyBtn = (id, on_) => `<button class="shy-btn${on_ ? ' on' : ''}" data-shy="${id}" tabindex="-1" title="${on_ ? 'Shy: hidden from the timeline only. Click to show again' : 'Shy: hide this row from the timeline (nothing else changes)'}">${SHY}</button>`;
  let html = mk('head-corner', 0, RULER, `<span id="zoom-readout"></span>`);
  for (const g of L.groups) {
    html += mk('group-head' + (g.open ? '' : ' closed'), g.top, g.h,
      `<span class="chev">${g.open ? '▾' : '▸'}</span><span class="gn">${g.id.toUpperCase()}</span>${g.hidden ? `<button class="show-hidden${g.reveal ? ' on' : ''}" data-reveal="${g.id}" tabindex="-1" title="Reveal the rows hidden with the shy toggle (temporarily, dimmed)">show hidden (${g.hidden})</button>` : ''}`, ` data-g="${g.id}"`);
  }
  if (L.vsum) html += mk('head-label sum', L.vsum.top, L.vsum.h, '<span>frames</span>');
  if (L.thumb) html += mk('head-label' + (L.thumb.dim ? ' dim' : ''), L.thumb.top, L.thumb.h, `<span>FRAMES</span><span class="sp"></span>${shyBtn('frames', L.thumb.dim)}`);
  if (L.notes) html += mk('head-label' + (L.notes.dim ? ' dim' : ''), L.notes.top, L.notes.h, `<span>COMMENTS</span><b id="notes-count"></b><span class="sp"></span>${shyBtn('comments', L.notes.dim)}`);
  if (L.layersH) {
    html += mk('head-label layers-head' + (L.layersDim ? ' dim' : ''), L.layersTop, LAYER_HEAD, `<span class="chev">${LY.tlOpen ? '▾' : '▸'}</span><span>LAYERS</span><b>${L.layerRows.length}</b><span class="chip" id="layers-chip" hidden><i class="spin"></i><span>mapping layers…</span></span><span class="sp"></span><button class="link-btn${RT.linked ? ' on' : ''}" id="ly-linked" tabindex="-1" aria-pressed="${RT.linked}" title="${RT.linked ? 'Linked: dragging a layer bar also moves its sounds (click to unlink)' : 'Unlinked: dragging a layer bar moves only the picture (click to link its sounds)'}">${LINK}</button>${shyBtn('layers', L.layersDim)}`);
    if (LY.tlOpen) for (const r of L.layerRows) {
      const top = layerY(r);
      html += `<div class="layer-head${r.group ? ' grp' : ''}${L.layersDim ? ' dim' : ''}" data-lid="${r.id.replace(/"/g, '&quot;')}" style="top:${top}px;height:${LAYER_ROW}px;padding-left:${4 + r.depth * 10}px">${r.group ? '<span class="cvb none"></span>' : `<button class="cvb${r.cv ? ' on' : ''}" data-cv="${r.key.replace(/"/g, '&quot;')}" tabindex="-1" title="Value curves (x, y, scale, rotate, opacity)">${r.cv ? '▾' : '▸'}</button>`}<span class="nm">${r.label.replace(/[&<>]/g, '')}${r.group ? ' ' + r.text : ''}</span></div>`;
      if (r.cv) CHANNELS.forEach(([ch, fn, lab], i) => {
        const rg = chRange(r.key, fn);
        const txt = rg === null ? '…' : rg.length ? `${fmtR(rg[0])}…${fmtR(rg[1])}` : 'hidden';
        html += `<div class="curve-head${L.layersDim ? ' dim' : ''}" style="top:${top + LAYER_ROW + i * CURVE_ROW}px;height:${CURVE_ROW}px"><span class="cn">${lab}</span><span class="cr">${txt}</span></div>`;
      });
    }
  }
  for (const ln of L.lanes) {
    const col = stemColor(ln.name);
    html += `<div class="lane-head${ln.dim ? ' dim' : ''}" data-stem="${ln.name}" tabindex="-1" style="top:${ln.top}px;height:${ln.h}px;--c:${col}">
      <div class="lh-row"><i class="swatch"></i><span class="lh-name">${ln.name}</span><span class="lh-spacer"></span>
        <button class="mini mute" title="Mute (M)">M</button><button class="mini solo" title="Solo (S)">S</button>${shyBtn('lane:' + ln.name, ln.dim)}</div>
      <div class="lh-row"><input class="vol" type="range" min="-40" max="24" step="0.5" value="0" title="Lane volume (double-click: reset)"><span class="lh-db">0.0</span></div>
      <div class="lh-row sub"><span class="lh-peak"></span><button class="link save" title="Write this gain to the draft (stems.${ln.name}.gain)">save to draft</button></div></div>`;
  }
  if (L.asum) html += mk('head-label sum', L.asum.top, L.asum.h, '<span>mix (visible stems)</span>');
  if (html === headsHTML) { updateHeads(); return; }
  headsHTML = html;
  heads.innerHTML = html;
  for (const el of heads.querySelectorAll('.group-head')) el.onclick = (e) => { if (e.target.closest('[data-reveal]')) return toggleReveal(e.target.closest('[data-reveal]').dataset.reveal); toggleGroup(el.dataset.g); };
  for (const el of heads.querySelectorAll('[data-shy]')) el.onclick = (e) => { e.stopPropagation(); toggleShy(el.dataset.shy); };
  const lh = heads.querySelector('.layers-head');
  if (lh) lh.onclick = (e) => { if (e.target.closest('#ly-linked')) { e.stopPropagation(); toggleLinked(); return; } toggleTimelineOpen(); };
  for (const el of heads.querySelectorAll('.layer-head')) {
    el.onclick = (e) => {
      const cvb = e.target.closest('[data-cv]');
      if (cvb) { toggleCurves(cvb.dataset.cv); return; }
      const r = L.layerRows.find((x) => x.id === el.dataset.lid); if (r) selectLayer(r.key);
    };
  }
  for (const el of heads.querySelectorAll('.lane-head')) {
    const name = el.dataset.stem, m = () => S.mon[name];
    el.addEventListener('pointerdown', () => { S.lane = name; emit('selection'); });
    const nm = el.querySelector('.lh-name');
    nm.title = 'Double-click: select all cues of this lane (then drag one to shift the lane)';
    nm.ondblclick = () => selectLane(name);
    el.querySelector('.mute').onclick = (e) => { toggleMute(name); e.currentTarget.blur(); };
    el.querySelector('.solo').onclick = (e) => { toggleSolo(name); e.currentTarget.blur(); };
    const vol = el.querySelector('.vol');
    vol.oninput = () => { m().vol = +vol.value; engine.setMonitor(name, m()); updateHeads(); emit('dirty'); };
    vol.ondblclick = () => { vol.value = 0; vol.oninput(); };
    el.querySelector('.save').onclick = (e) => { foldMonitorGain(name); e.currentTarget.blur(); };
  }
  updateHeads();
}
// Move a lane's monitoring volume into the draft (stems.<name>.gain) and zero the monitor offset.
function foldMonitorGain(name) {
  const m = S.mon[name];
  if (!m || !m.vol) return;
  const gain = (S.res.stems[name]?.gain || 0) + m.vol;
  m.vol = 0; engine.setMonitor(name, m);
  setStemDraftGain(name, +gain.toFixed(2));
}
// Saving keeps what the user hears: every non-zero lane volume becomes a draft stem gain.
export function foldMonitorGains() { for (const name of S.stemOrder) foldMonitorGain(name); updateHeads(); }
export function toggleMute(name) { const m = S.mon[name]; if (m) { m.mute = !m.mute; engine.setMonitor(name, m); updateHeads(); } }
export function toggleSolo(name) { const m = S.mon[name]; if (m) { m.solo = !m.solo; for (const s of S.stemOrder) engine.setMonitor(s, S.mon[s]); updateHeads(); } }
function updateHeads() {
  if (!heads) return;
  for (const el of heads.querySelectorAll('.lane-head')) {
    const name = el.dataset.stem, m = S.mon[name];
    if (!m) continue;
    el.classList.toggle('active', S.lane === name);
    el.querySelector('.mute').classList.toggle('on', m.mute);
    el.querySelector('.solo').classList.toggle('on', m.solo);
    const vol = el.querySelector('.vol');
    if (+vol.value !== m.vol) vol.value = m.vol;
    el.querySelector('.lh-db').textContent = (m.vol > 0 ? '+' : '') + m.vol.toFixed(1);
    el.querySelector('.save').style.display = m.vol !== 0 ? '' : 'none';
    el.querySelector('.lh-peak').style.display = m.vol !== 0 ? 'none' : '';
    const pk = peaksOf(engine.bufferFor(name));
    el.querySelector('.lh-peak').textContent = pk && pk.peak > 0 ? `peak ${(20 * Math.log10(pk.peak)).toFixed(1)} dB` : 'silent';
    const eg = S.res?.stems[name]?.gain;
    el.classList.toggle('edited', !!S.draft.stems[name]);
    el.title = eg ? `stem gain ${eg > 0 ? '+' : ''}${eg} dB` : '';
  }
  for (const el of heads.querySelectorAll('.layer-head')) {
    const r = L.layerRows.find((x) => x.id === el.dataset.lid);
    el.classList.toggle('sel', !!r && rowSelected(r));
  }
  const chip = heads.querySelector('#layers-chip');
  if (chip) chip.hidden = !LY.mapping;
  const nc = heads.querySelector('#notes-count');
  if (nc) nc.textContent = liveComments().length || '';
  const zr = heads.querySelector('#zoom-readout');
  if (zr) zr.textContent = `${fps()} fps · ${Math.round(duration() * fps())} f`;
}

// ---------- rendering ----------
const px = (x) => Math.round(x * dpr) / dpr + 0.5 / dpr; // crisp 1px line centre
function hline(c, x0, x1, y, col) { c.fillStyle = col; c.fillRect(x0, Math.round(y * dpr) / dpr, x1 - x0, 1 / dpr); }
function vline(c, x, y0, y1, col, w = 1) { c.fillStyle = col; c.fillRect(Math.round(x * dpr) / dpr, y0, w / dpr, y1 - y0); }

function tickSteps() {
  const f = fps(), pps = S.view.pps;
  const frameMode = pps / f >= 5;
  const list = frameMode ? [1, 2, 5, 10, 15, 30, 60, 120, 300].map((n) => n / f) : [0.1, 0.2, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
  const major = list.find((s) => s * pps >= (frameMode ? 56 : 72)) || list[list.length - 1];
  return { frameMode, major };
}
function labelFor(t, step, frameMode) {
  if (frameMode) {
    const fr = Math.round(t * fps());
    return String(Math.floor(fr / fps())).padStart(2, '0') + '.' + String(fr % fps()).padStart(2, '0');
  }
  if (step >= 1) { const s = Math.round(t); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`; }
  return t.toFixed(step < 0.1 ? 2 : 1) + 's';
}

function renderStatic() {
  const c = sg;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = C.bg; c.fillRect(0, 0, W, TOTAL);
  if (!S.meta) return;
  const { start, pps } = S.view, d = duration(), f = fps();
  const t0 = start, t1 = start + W / pps;

  // backgrounds
  c.fillStyle = C.panel; c.fillRect(0, 0, W, RULER);
  for (const gr of L.groups) { c.fillStyle = tok('--background'); c.fillRect(0, gr.top, W, gr.h); hline(c, 0, W, gr.top + gr.h - 1, C.border); }
  if (L.thumb) { c.fillStyle = C.thumb; c.fillRect(0, L.thumb.top, W, L.thumb.h); }
  if (L.vsum) { c.fillStyle = C.thumb; c.fillRect(0, L.vsum.top, W, L.vsum.h); }
  if (L.notes) { c.fillStyle = C.notes; c.fillRect(0, L.notes.top, W, L.notes.h); }
  if (L.layersH) { c.fillStyle = tok('--card'); c.fillRect(0, L.layersTop, W, L.layersH); }
  if (L.asum) { c.fillStyle = C.lane[0]; c.fillRect(0, L.asum.top, W, L.asum.h); }
  L.lanes.forEach((ln, i) => { c.fillStyle = C.lane[i % 2]; c.fillRect(0, ln.top, W, ln.h); });
  // out-of-range shading
  c.fillStyle = tok('--scrim');
  if (X(0) > 0) c.fillRect(0, RULER, X(0), TOTAL - RULER);
  if (X(d) < W) c.fillRect(X(d), RULER, W - X(d), TOTAL - RULER);

  // thumbnails (frames row, or the collapsed VIDEO summary)
  if (thumbs.items.length) for (const row of [L.thumb, L.vsum]) {
    if (!row) continue;
    const th = row.h - 2, twd = Math.max(8, Math.round(th * (thumbs.w / thumbs.h)));
    const x0 = X(0), k0 = Math.max(0, Math.floor(-x0 / twd)), k1 = Math.ceil((Math.min(W, X(d)) - x0) / twd);
    c.save(); c.beginPath(); c.rect(Math.max(0, x0), row.top + 1, Math.min(W, X(d)) - Math.max(0, x0), th); c.clip();
    for (let k = k0; k <= k1; k++) {
      const x = x0 + k * twd, t = clamp(tOf(x + twd / 2), 0, d);
      const img = thumbs.items[Math.min(thumbs.items.length - 1, Math.floor(t / thumbs.step))];
      if (img) c.drawImage(img, x, row.top + 1, twd, th);
    }
    c.restore();
  }

  // ruler + grid
  const { frameMode, major } = tickSteps();
  c.font = mono(); c.textBaseline = 'alphabetic';
  if (frameMode) {
    const f0 = Math.max(0, Math.floor(t0 * f)), f1 = Math.min(Math.round(d * f), Math.ceil(t1 * f));
    for (let fr = f0; fr <= f1; fr++) vline(c, X(fr / f), RULER - (fr % f === 0 ? 8 : 4), RULER, fr % f === 0 ? tok('--timeline-tick') : tok('--timeline-tick-minor'));
  } else {
    const minor = major / (String(major)[0] === '2' ? 4 : String(major)[0] === '5' ? 5 : 5);
    if (minor * pps >= 6) for (let t = Math.ceil(t0 / minor) * minor; t <= t1; t += minor) if (t >= -1e-9 && t <= d + 1e-9) vline(c, X(t), RULER - 4, RULER, tok('--muted-foreground'));
  }
  const m0 = Math.ceil((t0 - 1e-9) / major);
  for (let k = m0; k * major <= t1 + major; k++) {
    const t = k * major;
    if (t < -1e-9 || t > d + 1e-9) continue;
    const x = X(t);
    vline(c, x, RULER - 11, RULER, tok('--muted-foreground'));
    vline(c, x, RULER, TOTAL, tok('--accent'));
    c.fillStyle = C.muted; c.fillText(labelFor(t, major, frameMode), Math.round(x) + 4, RULER - 12);
  }
  hline(c, 0, W, RULER - 1, C.border);
  for (const row of [L.thumb, L.vsum, L.notes, L.asum]) if (row) hline(c, 0, W, row.top + row.h - 1, C.border);

  // lanes
  hits = { cues: [], notes: [], layers: [] };
  drawLayers(c);
  for (const ln of L.lanes) drawLane(c, ln, t0, t1);
  if (L.asum) drawAudioSummary(c, L.asum, t0, t1);
  if (L.notes) drawNotes(c);
  for (const ln of L.lanes) hline(c, 0, W, ln.top + ln.h - 1, C.border);
  // rows revealed by "show hidden" (shy) are dimmed
  c.fillStyle = tok('--overlay-background');
  for (const row of [L.thumb, L.notes, L.layersDim && L.layersH ? { top: L.layersTop, h: L.layersH, dim: true } : null, ...L.lanes]) if (row?.dim) c.fillRect(0, row.top, W, row.h);
}

function drawLayers(c) {
  if (!L.layersH) return;
  hline(c, 0, W, L.layersTop + LAYER_HEAD - 1, C.border);
  hline(c, 0, W, L.layersTop + L.layersH - 1, C.border);
  if (!LY.tlOpen) return;
  c.font = mono(); c.textBaseline = 'middle';
  const d = duration();
  L.layerRows.forEach((r, i) => {
    const y = layerY(r), sel = rowSelected(r);
    if (i % 2) { c.fillStyle = tok('--accent'); c.fillRect(0, y, W, LAYER_ROW); }
    if (sel) { c.fillStyle = tok('--selection'); c.fillRect(0, y, W, LAYER_ROW + (r.cv ? CHANNELS.length * CURVE_ROW : 0)); }
    const spans = previewSpans(r) || r.spans || [];
    spans.forEach(([a, b], si) => {
      const x0 = X(Math.max(0, a)), x1 = Math.max(x0 + 2, X(Math.min(d, b)));
      if (x1 < -2 || x0 > W + 2) return;
      const cx0 = Math.max(-2, x0), cx1 = Math.min(W + 2, x1);
      c.fillStyle = sel ? tok('--primary') : r.group ? tok('--timeline-bar-group') : tok('--timeline-bar');
      rr(c, cx0, y + 2, cx1 - cx0, LAYER_ROW - 4, 2); c.fill();
      if (isTweaked(r.keys) && x0 >= -2) { c.fillStyle = tok('--success-foreground'); c.beginPath(); c.arc(x0 + 3, y + LAYER_ROW / 2, 1.8, 0, 6.3); c.fill(); }
      const tx = Math.max(x0, 0) + (isTweaked(r.keys) ? 8 : 4), room = cx1 - tx - 3;
      if (room > 18) {
        let txt = r.label;
        while (txt.length > 1 && tw(txt, mono()) > room) txt = txt.slice(0, -2) + '…';
        c.fillStyle = sel ? tok('--primary-foreground') : tok('--foreground'); c.fillText(txt, tx, y + LAYER_ROW / 2 + 0.5);
      }
      hits.layers.push({ r, x0: cx0, x1: cx1, y0: y + 1, y1: y + LAYER_ROW - 1, t0: a, first: si === 0, last: si === spans.length - 1, ex0: X(spans[0][0]), ex1: X(spans[spans.length - 1][1]), env: [spans[0][0], spans[spans.length - 1][1]] });
    });
    if (r.cv) drawCurves(c, r, y + LAYER_ROW);
  });
}

// Value curves under a layer row: x, y, scale, rotate, opacity from the `path` samples, each normalised to its own min..max.
function drawCurves(c, r, y0) {
  const d = pathOf(r.key), col = tok('--info-foreground');
  // Retain the samples bracketing the viewport, even if no sample is inside it.
  let first = 0, last = (d?.samples.length || 0) - 1;
  while (first < last && X(d.samples[first + 1].t) < 0) first++;
  while (last > first && X(d.samples[last - 1].t) > W) last--;
  CHANNELS.forEach(([, fn], i) => {
    const y = y0 + i * CURVE_ROW;
    c.fillStyle = i % 2 ? tok('--accent') : tok('--muted'); c.fillRect(0, y, W, CURVE_ROW);
    hline(c, 0, W, y + CURVE_ROW - 1, tok('--accent'));
    if (!d?.samples.length) return;
    const range = sampleRange(d, fn);
    if (!range) return;
    const [lo, hi] = range;
    const span = hi - lo, Y = (v) => (span < 1e-9 ? y + CURVE_ROW / 2 : y + 2 + (1 - (v - lo) / span) * (CURVE_ROW - 5));
    c.strokeStyle = col; c.lineWidth = 1.1; c.beginPath();
    let pen = false;
    for (let j = first; j <= last; j++) {
      const s_ = d.samples[j];
      if (!s_.visible) { pen = false; continue; }
      const x = X(s_.t);
      if (pen) c.lineTo(x, Y(fn(s_))); else c.moveTo(x, Y(fn(s_)));
      pen = true;
    }
    c.stroke();
  });
}

function drawAudioSummary(c, row, t0, t1) {
  const names = L.allLanes.filter((n) => vis('lane:' + n, 'audio') === 'show');
  const cols = Math.ceil(W * dpr), sMx = new Float32Array(cols), sMn = new Float32Array(cols), mn = new Float32Array(cols), mx = new Float32Array(cols);
  let any = false;
  for (const n of names) {
    const pk = peaksOf(engine.bufferFor(n));
    if (!pk || !(pk.peak > 0)) continue;
    any = true; mn.fill(0); mx.fill(0);
    query(pk, t0, t1, cols, mn, mx);
    for (let i = 0; i < cols; i++) { sMx[i] += mx[i]; sMn[i] += mn[i]; }
  }
  const cy = row.top + row.h / 2;
  hline(c, 0, W, cy, tok('--accent'));
  if (!any) return;
  let ref = 0.05;
  for (let i = 0; i < cols; i++) ref = Math.max(ref, sMx[i], -sMn[i]);
  const A = row.h * 0.46 / ref, w = 1 / dpr;
  c.fillStyle = tok('--info-foreground');
  for (let i = 0; i < cols; i++) {
    if (sMx[i] === 0 && sMn[i] === 0) continue;
    c.fillRect(i / dpr, cy - sMx[i] * A, w, Math.max(w, (sMx[i] - sMn[i]) * A));
  }
}

function drawLane(c, ln, t0, t1) {
  const { pps } = S.view, col = stemColor(ln.name), cy = ln.top + ln.h * 0.52;
  hline(c, 0, W, cy, tok('--accent'));
  // waveform
  const pk = peaksOf(engine.bufferFor(ln.name));
  if (pk && pk.peak > 0) {
    const ref = Math.max(0.05, peaksOf(engine.stems.get(ln.name)?.orig)?.peak || pk.peak);
    const A = ln.h * 0.44 / ref;
    const cols = Math.ceil(W * dpr);
    if (!renderStatic.mn || renderStatic.mn.length < cols) { renderStatic.mn = new Float32Array(cols); renderStatic.mx = new Float32Array(cols); }
    const { mn, mx } = renderStatic;
    query(pk, t0, t1, cols, mn, mx);
    c.fillStyle = col + 'cc';
    const lim = ln.h * 0.48, w = 1 / dpr;
    for (let i = 0; i < cols; i++) {
      if (mx[i] === 0 && mn[i] === 0) { if (i / dpr < X(0) || i / dpr > X(duration())) continue; }
      const y0 = cy - Math.min(lim, mx[i] * A), y1 = cy - Math.max(-lim, mn[i] * A);
      c.fillRect(i / dpr, y0, w, Math.max(w, y1 - y0));
    }
  }
  // cues
  const maxRows = clamp(Math.floor((ln.h - 22) / 16), 1, 3);
  const cues = S.res.cues.filter((q) => q.stem === ln.name);
  const rowEnd = new Array(maxRows).fill(-1e9);
  c.font = font(); c.textBaseline = 'middle';
  const items = [];
  for (const q of cues) {
    const x = X(q.t);
    const label = q.id, w = Math.ceil(tw(label, font())) + 12;
    if (x + w < -4 || x > W + 4) { continue; }
    let row = -1;
    for (let r = 0; r < maxRows; r++) if (rowEnd[r] + 3 <= x) { row = r; break; }
    if (row >= 0) rowEnd[row] = x + w;
    items.push({ q, x, w, row });
  }
  // ghosts (original position of moved cues)
  for (const { q, x, row } of items) {
    const o = S.baseById.get(q.id);
    if (!o || Math.abs(o.t - q.t) < 1e-6) continue;
    const gx = X(o.t);
    c.fillStyle = col + '66';
    for (let y = ln.top + 2; y < ln.top + ln.h - 2; y += 6) c.fillRect(Math.round(gx * dpr) / dpr, y, 1 / dpr, 3);
    c.fillStyle = col + '99'; c.fillRect(gx - 2, ln.top + 3, 5, 5);
    const yy = ln.top + 3 + Math.max(0, row) * 16 + 7;
    c.fillStyle = tok('--primary-border'); c.fillRect(Math.min(gx, x), Math.round(yy), Math.abs(x - gx), 1);
  }
  const selected = [];
  for (const it of items) {
    if (isCueSelected(it.q.id)) { selected.push(it); continue; }
    drawCue(c, ln, it, col, false);
  }
  for (const it of selected) drawCue(c, ln, it, col, true);
}

function drawCue(c, ln, { q, x, w, row }, col, sel) {
  const edited = !!S.draft.cues[q.id] || isAdded(q.id);
  const dim = q.mute;
  const lx = Math.round(x * dpr) / dpr;
  // line
  c.fillStyle = sel ? tok('--foreground') : col + (dim ? '55' : 'cc');
  if (dim) { for (let y = ln.top + 1; y < ln.top + ln.h - 1; y += 4) c.fillRect(lx, y, 1 / dpr, 2); }
  else c.fillRect(lx, ln.top, (sel ? 2 : 1) / dpr * (sel ? dpr : 1), ln.h - 1);
  let pill = null;
  if (row >= 0 || sel) {
    const r = row >= 0 ? row : 0, py = ln.top + 3 + r * 16, ph = 14;
    pill = { x: lx, y: py, w, h: ph };
    c.fillStyle = sel ? col : tok('--overlay-background');
    rr(c, lx, py, w, ph, 3); c.fill();
    c.strokeStyle = sel ? tok('--foreground') : col + (dim ? '66' : 'bb'); c.lineWidth = 1;
    rr(c, lx + 0.5, py + 0.5, w - 1, ph - 1, 3); c.stroke();
    c.fillStyle = sel ? tok('--primary-foreground') : (dim ? C.muted : C.text);
    c.font = font(); c.textBaseline = 'middle';
    c.fillText(q.id, lx + (edited ? 12 : 6), py + ph / 2 + 0.5);
    if (edited) { c.fillStyle = sel ? tok('--primary-foreground') : C.accent; c.beginPath(); c.arc(lx + 7, py + ph / 2, 2.2, 0, 6.3); c.fill(); }
    if (dim) { c.fillStyle = C.muted; c.fillRect(lx + 6, py + ph / 2, w - 12, 1); }
  } else {
    // no room for a label: small nub; label appears on hover/selection
    c.fillStyle = col; c.fillRect(lx - 1.5, ln.top + 2, 4, 4);
    pill = { x: lx - 3, y: ln.top + 2, w: 7, h: 8 };
  }
  hits.cues.push({ id: q.id, x: lx, lane: ln, pill });
}
function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

function drawNotes(c) {
  c.font = font(); c.textBaseline = 'middle';
  let end = -1e9;
  const mid = L.notes.top + NOTES / 2;
  for (const n of liveComments()) {
    const x = Math.round(X(n.t));
    if (x < -200 || x > W + 8) continue;
    const sel = S.sel.note === n.id;
    const col = n.status === 'resolved' ? tok('--success-foreground') : n.status === 'wontfix' ? tok('--muted-foreground') : NOTE_COLOR, dim = n.status === 'open' ? '' : '99';
    c.fillStyle = col + (sel ? 'ff' : dim || 'cc');
    c.beginPath(); c.moveTo(x, mid - 6); c.lineTo(x + 6, mid); c.lineTo(x, mid + 6); c.lineTo(x - 6, mid); c.closePath(); c.fill();
    if (sel) { c.strokeStyle = tok('--foreground'); c.lineWidth = 1; c.stroke(); }
    vline(c, x, L.notes.top + NOTES, TOTAL, col + '30');
    const txt = (n.text || 'comment').slice(0, 28);
    const w = tw(txt, font());
    if (x + 10 > end) { c.fillStyle = sel ? tok('--foreground') : C.muted; c.fillText(txt, x + 10, mid + 0.5); end = x + 10 + w + 8; }
    hits.notes.push({ id: n.id, x, y: mid });
  }
}

function paint() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(sc, 0, 0);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!S.meta) return;
  // loop region
  if (S.loop.b > S.loop.a) {
    const a = X(S.loop.a), b = X(S.loop.b);
    g.fillStyle = S.loop.on ? tok('--selection') : tok('--overlay-background');
    g.fillRect(a, RULER, b - a, TOTAL - RULER);
    g.fillStyle = S.loop.on ? tok('--primary-border') : tok('--overlay-background');
    g.fillRect(a, RULER - 5, b - a, 4);
  }
  // code band (docs/CODE-VERSIONS.md §3): t0-t1 of the animated code ref under the mouse
  if (S.codeBand && S.codeBand.t1 >= S.codeBand.t0) {
    const a = X(S.codeBand.t0), w = Math.max(2, X(S.codeBand.t1) - a);
    g.fillStyle = tok('--warning-surface'); g.fillRect(a, RULER, w, TOTAL - RULER);
    g.fillStyle = tok('--warning-foreground'); g.fillRect(a, RULER - 5, w, 4);
  }
  // hover guide
  if (hoverX >= 0 && !drag) {
    vline(g, hoverX, RULER, TOTAL, tok('--border'));
    const t = clamp(tOf(hoverX), 0, duration());
    const s = t.toFixed(3) + 's';
    g.font = mono(); const w = g.measureText(s).width + 10, x = clamp(hoverX - w / 2, 2, W - w - 2);
    g.fillStyle = tok('--overlay-background'); g.fillRect(x, 2, w, 14);
    g.fillStyle = C.text; g.textBaseline = 'middle'; g.fillText(s, x + 5, 9.5);
  }
  // value readout while hovering a value curve
  if (hoverX >= 0 && !drag && LY.tlOpen) for (const r of L.layerRows) if (r.cv) {
    const y0 = layerY(r) + LAYER_ROW, i = Math.floor((hoverY - y0) / CURVE_ROW);
    if (i < 0 || i >= CHANNELS.length) continue;
    const d = pathOf(r.key);
    if (!d?.samples.length) break;
    const tt = tOf(hoverX);
    let best = null;
    for (const s_ of d.samples) if (s_.visible && (!best || Math.abs(s_.t - tt) < Math.abs(best.t - tt))) best = s_;
    if (!best || Math.abs(best.t - tt) > 3 / fps() + (d.step || 1) / fps()) break;
    const v = CHANNELS[i][1](best), txt = `${CHANNELS[i][2]} ${fmtR(v)}  ·  ${best.t.toFixed(3)}s`;
    g.font = mono(); const w = g.measureText(txt).width + 10, x = clamp(hoverX + 10, 2, W - w - 2);
    g.fillStyle = tok('--overlay-background'); g.fillRect(x, y0 + i * CURVE_ROW + 1, w, CURVE_ROW - 2);
    g.fillStyle = tok('--info-foreground'); g.textBaseline = 'middle'; g.fillText(txt, x + 5, y0 + i * CURVE_ROW + CURVE_ROW / 2 + 0.5);
    break;
  }
  // box select (Shift+drag on a lane)
  if (drag?.kind === 'box' && (Math.abs(drag.x1 - drag.x0) >= 3 || Math.abs(drag.y1 - drag.y0) >= 3)) {
    const bx = Math.min(drag.x0, drag.x1), by = Math.min(drag.y0, drag.y1), bw = Math.abs(drag.x1 - drag.x0), bh = Math.abs(drag.y1 - drag.y0);
    g.fillStyle = tok('--selection'); g.fillRect(bx, by, bw, bh);
    g.strokeStyle = tok('--primary-border'); g.lineWidth = 1; g.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw), Math.round(bh));
  }
  // playhead
  const t = transport.time(), x = X(t);
  if (x >= -8 && x <= W + 8) {
    const lx = Math.round(x * dpr) / dpr;
    g.fillStyle = tok('--timeline-playhead'); g.fillRect(lx, 0, 1 / dpr, TOTAL);
    g.fillStyle = tok('--accent'); g.fillRect(lx - 1 / dpr, RULER, 3 / dpr, TOTAL - RULER);
    g.fillStyle = tok('--timeline-playhead');
    g.beginPath(); g.moveTo(lx - 6, 0); g.lineTo(lx + 6.5, 0); g.lineTo(lx + 6.5, 9); g.lineTo(lx + 0.5, 15); g.lineTo(lx - 6, 9); g.closePath(); g.fill();
  }
}

// ---------- interaction ----------
// clientX / the rect are in viewport px; canvas coordinates are the panel's own (zoomed) px: divide by the CSS zoom
const local = (e) => { const r = cv.getBoundingClientRect(), z = zoomOf(cv); return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z }; };
function laneAt(y) { return L.lanes.find((l) => y >= l.top && y < l.top + l.h) || null; }
function hitTest(x, y) {
  for (const b of hits.layers) if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { type: 'layer', bar: b };
  for (const n of hits.notes) if (Math.abs(n.x - x) <= 8 && Math.abs(n.y - y) <= 9) return { type: 'note', id: n.id };
  let best = null, bd = 1e9;
  for (const h of hits.cues) {
    const p = h.pill, inPill = x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    const onLine = Math.abs(x - h.x) <= 3 && y >= h.lane.top && y < h.lane.top + h.lane.h;
    if (!inPill && !onLine) continue;
    const dd = inPill ? 0 : Math.abs(x - h.x) + 1;
    if (dd < bd) { bd = dd; best = h; }
  }
  if (best) return { type: 'cue', id: best.id, x: best.x };
  if (y < RULER) return { type: 'ruler' };
  const lane = laneAt(y);
  if (lane) return { type: 'lane', lane };
  return { type: 'other' };
}

/** Which part of a layer bar is under x: the envelope's start / end edge (5 px) or the body. */
function edgeOf(b, x) {
  if (b.ex1 - b.ex0 < 16) return 'move';
  if (b.first && x - b.ex0 <= 5) return 'start';
  if (b.last && b.ex1 - x <= 5) return 'end';
  return 'move';
}
function scrubTo(x, e) {
  const t = clamp(tOf(x), 0, duration());
  seek(t, { frame: !e?.altKey, blip: true });
  emit('time', t);
}
function onDown(e) {
  if (!S.meta || e.button !== 0) return;
  cv.setPointerCapture(e.pointerId);
  const { x, y } = local(e);
  const h = hitTest(x, y);
  if (h.type === 'cue') {
    const q = cueById(h.id);
    // Shift: a click toggles the cue in the selection, a drag starts a box select
    if (e.shiftKey) { drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y, cue: h.id }; invalidate(); return; }
    const ids = selectedCues(), group = ids.length > 1 && ids.includes(h.id);
    setCueSelection(group ? ids : [h.id], h.id);
    const t0 = new Map((group ? ids : [h.id]).map((id) => [id, cueById(id).t]));
    drag = { kind: 'cue', id: h.id, t0, down: x, off: tOf(x) - q.t, moved: false, key: 'drag' + ++dragSeq };
  } else if (h.type === 'note') {
    S.sel.note = h.id; S.sel.cue = null; emit('selection');
    drag = { kind: 'note', id: h.id, down: x, moved: false };
  } else if (h.type === 'layer') {
    const b = h.bar;
    selectLayer(b.r.key, b.t0);
    drag = { kind: 'layer', r: b.r, mode: edgeOf(b, x), env: b.env, down: x, moved: false, st: null, key: 'layer' + ++dragSeq };
  } else if (h.type === 'lane' && e.shiftKey) {
    drag = { kind: 'box', x0: x, y0: y, x1: x, y1: y };
  } else if (h.type === 'ruler' && e.shiftKey) {
    const t = snapT(clamp(tOf(x), 0, duration()));
    drag = { kind: 'loop', a: t, moved: false };
    S.loop.a = t; S.loop.b = t;
  } else {
    if (h.type === 'lane') S.lane = h.lane.name;
    if (S.sel.cue || S.sel.note) { S.sel.cue = null; S.sel.note = null; }
    emit('selection');
    drag = { kind: 'scrub' };
    beginScrub(); scrubTo(x, e);
  }
  invalidate();
}
function onMove(e) {
  const { x, y } = local(e);
  hoverX = x; hoverY = y; invalidate(false);
  if (!drag) {
    const h = hitTest(x, y);
    const lc = h.type === 'layer' ? (whyNot(h.bar.r.keys) ? 'pointer' : edgeOf(h.bar, x) === 'move' ? 'grab' : 'col-resize') : null;
    cv.style.cursor = h.type === 'cue' ? 'ew-resize' : lc || (h.type === 'note' ? 'pointer' : 'default');
    return;
  }
  if (drag.kind === 'scrub') scrubTo(x, e);
  else if (drag.kind === 'cue') {
    if (!drag.moved && Math.abs(x - drag.down) < 3) return;
    drag.moved = true;
    const t = clamp(snapT(tOf(x) - drag.off, !e.altKey), 0, duration());
    if (drag.t0.size > 1) moveCues(drag.t0, t - drag.t0.get(drag.id), drag.key);
    else patchCue(drag.id, { t: +t.toFixed(5) }, { key: drag.key, window: Infinity });
  } else if (drag.kind === 'layer') {
    if (!drag.moved && Math.abs(x - drag.down) < 3) return;
    if (!drag.moved) {
      const why = whyNot(drag.r.keys);
      if (why) { emit('toast', { m: why, ms: 3200 }); drag = { kind: 'none' }; return; }
      drag.st = beginLayerDrag(drag.r);
      cv.style.cursor = drag.mode === 'move' ? 'grabbing' : 'col-resize';
    }
    drag.moved = true;
    const snap = !e.altKey, [a, b] = drag.env, min = 2 / fps();
    let A;
    if (drag.mode === 'move') A = moveBy(snapT(tOf(x) - tOf(drag.down), snap));
    else if (drag.mode === 'end') A = stretchAbout(a, b, Math.max(a + min, snapT(tOf(x), snap)));
    else A = stretchAbout(b, a, Math.min(b - min, snapT(tOf(x), snap)));
    if (updateLayerDrag(drag.st, A)) invalidate();
  } else if (drag.kind === 'box') {
    drag.x1 = x; drag.y1 = y;
  } else if (drag.kind === 'loop') {
    const t = snapT(clamp(tOf(x), 0, duration()));
    S.loop.a = Math.min(drag.a, t); S.loop.b = Math.max(drag.a, t); drag.moved = true;
    emit('loop');
  }
}
function onUp(e) {
  if (!drag) return;
  const d = drag; drag = null;
  if (d.kind === 'scrub') endScrub();
  if (d.kind === 'note' && !d.moved) emit('note-open', d.id);
  if (d.kind === 'layer' && d.moved && d.st) endLayerDrag(d.st);
  if (d.kind === 'cue' && !d.moved && d.t0.size > 1) setCueSelection([d.id], d.id); // a plain click inside a selection selects just that cue
  if (d.kind === 'box' && d.cue && Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3) toggleCue(d.cue);
  else if (d.kind === 'box') {
    const ids = inBox(hits.cues, d.x0, d.y0, d.x1, d.y1);
    const all = [...new Set([...selectedCues(), ...ids])];
    if (all.length) setCueSelection(all, ids[ids.length - 1] || S.sel.cue);
  }
  if (d.kind === 'loop') {
    if (S.loop.b - S.loop.a < 1 / fps()) { S.loop.a = S.loop.b = 0; S.loop.on = false; } else S.loop.on = true;
    emit('loop');
  }
  invalidate();
}
function onDbl(e) {
  const { x, y } = local(e);
  const h = hitTest(x, y);
  if (h.type === 'cue') { openTweak(h.id); return; }
  if (h.type !== 'lane') return;
  const t = clamp(snapT(tOf(x), !e.altKey), 0, duration());
  const id = addCue(h.lane.name, t);
  S.sel.cue = id; S.sel.note = null; S.lane = h.lane.name;
  emit('selection');
}
function onWheel(e) {
  e.preventDefault();
  const { x } = local(e);
  if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0022), x);
  else scrollBy(e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? (e.deltaX || e.deltaY) : e.deltaY);
}
