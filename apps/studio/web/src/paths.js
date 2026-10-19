import { tok } from './theme.js';
// Motion paths, actual values and value-curve data (docs/REVIEW.md §7). Live mode only: samples come from the bridge
// (`path`, `values`). Overlay = canvas over the picture; the pinned list persists per scene in localStorage.
import { S, on, emit, fps, esc, readView, writeView } from './store.js';
import { request, getSel, liveOn } from './live.js';
import { transport, seek, pause } from './transport.js';
import { addTool, videoBox, wrapBox } from './viewer.js';
import { ensureVisible } from './timeline.js';
import { T } from './tracks.js';

import { $ } from './dom.js';
export const COLORS = Array.from({ length: 6 }, (_, i) => tok(`--path-${i + 1}`)); // Stored path colours remain content data.
export const P = { pinned: [], onion: false, N: 3, ver: 0 };
const data = new Map(); // key -> { samples, fps, step, stale, gen }
const inflight = new Map();
const onionData = new Map(); // key -> frame-resolution window at the current frame
let gen = 0, fetchTimer = 0;
const storeKey = () => `gfx-studio.paths.${S.name}`;

function load() {
  P.pinned = []; P.onion = false;
  if (!readView(storeKey(), (j) => { P.pinned = (j.pinned || []).filter((p) => p?.key).map((p, i) => ({ key: p.key, color: p.color || COLORS[i % COLORS.length] })); P.onion = !!j.onion; })) {
    P.pinned = []; P.onion = false;
  }
}
function save() { writeView(storeKey(), { pinned: P.pinned, onion: P.onion }); }
export const isPinned = (k) => P.pinned.some((p) => p.key === k);
const needed = () => [...new Set([...P.pinned.map((p) => p.key), ...[...T.curves]])];

// ---------- path data ----------
/** Cached path samples of a key (kicks a fetch if there is none yet). */
export function pathOf(key) {
  const d = data.get(key);
  if (!d && liveOn() && !inflight.has(key)) schedule(0);
  return d || null;
}
function schedule(ms) { clearTimeout(fetchTimer); fetchTimer = setTimeout(fetchAll, ms); }
function markStale() { gen++; onionData.clear(); for (const d of data.values()) d.stale = true; schedule(250); redraw(); }
function onionOf(key, t) {
  const fr = fps(), frame = Math.floor(t * fr + 1e-6), n = P.N;
  const cached = onionData.get(key);
  if (cached && cached.frame === frame && cached.n === n && cached.fr === fr) return cached.samples;
  const entry = { frame, n, fr, samples: [] };
  onionData.set(key, entry);
  request('path', { key, from: (frame - n) / fr, to: (frame + n) / fr, step: 1 }, 90000).then((res) => {
    if (onionData.get(key) !== entry || !liveOn()) return;
    entry.samples = res?.samples || [];
    redraw();
  }).catch((e) => { console.warn('onion path', key, e.message); });
  return entry.samples;
}
async function fetchAll() {
  if (!liveOn()) return;
  for (const key of needed()) {
    const d = data.get(key);
    if ((d && !d.stale) || inflight.has(key)) continue;
    const g = gen, scene = S.name;
    inflight.set(key, true);
    request('path', { key }, 90000).then((res) => {
      inflight.delete(key);
      if (!liveOn() || S.name !== scene) return;
      data.set(key, { samples: res?.samples || [], fps: res?.fps || fps(), step: res?.step || 1, stale: g !== gen });
      P.ver++; emit('paths-data'); redraw();
      if (g !== gen) schedule(100);
    }).catch((e) => {
      inflight.delete(key);
      console.warn('path', key, e.message);
      if (!data.has(key)) data.set(key, { samples: [], fps: fps(), step: 1, stale: false, err: e.message });
      P.ver++; emit('paths-data'); redraw();
    });
  }
}

// ---------- pinning ----------
export function togglePin(key) {
  if (!key) return;
  const i = P.pinned.findIndex((p) => p.key === key);
  if (i >= 0) { P.pinned.splice(i, 1); onionData.delete(key); }
  else {
    const used = new Set(P.pinned.map((p) => p.color));
    P.pinned.push({ key, color: COLORS.find((c) => !used.has(c)) || COLORS[P.pinned.length % COLORS.length] });
  }
  save(); syncUi(); redraw();
  if (i < 0) schedule(0);
}
export function pinSelected() {
  if (!liveOn()) { emit('toast', { m: 'Turn Live on (L) to show motion paths', ms: 2000 }); return; }
  const k = getSel()?.key;
  if (!k) { emit('toast', { m: 'Select an element first (V), then press P', ms: 2000 }); return; }
  togglePin(k);
}

// ---------- overlay ----------
let cv = null, c2 = null, bar = null, tip = null, btn = null, dirty = false, hitDots = [];
function redraw() { if (dirty) return; dirty = true; requestAnimationFrame(() => { dirty = false; draw(); }); }
const FILL = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0');

function nearestIdx(samples, t) {
  let lo = 0, hi = samples.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (samples[m].t < t) lo = m + 1; else hi = m; }
  if (lo > 0 && Math.abs(samples[lo - 1].t - t) <= Math.abs(samples[lo].t - t)) lo--;
  return lo;
}
function strokeQuad(c, quad, k) {
  c.beginPath();
  quad.forEach(([qx, qy], j) => (j ? c.lineTo(qx * k, qy * k) : c.moveTo(qx * k, qy * k)));
  c.closePath(); c.stroke();
}
function draw() {
  hitDots = [];
  if (!cv) return;
  const b = wrapBox(), dpr = window.devicePixelRatio || 1;
  if (!b || !S.meta) { cv.style.display = 'none'; return; }
  cv.style.display = '';
  const w = Math.round(b.w), h = Math.round(b.h);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  Object.assign(cv.style, { left: b.left + 'px', top: b.top + 'px', width: w + 'px', height: h + 'px' });
  const c = c2, k = b.k;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, w, h);
  if (!liveOn()) return;
  const now = transport.time();
  const fr = fps();
  for (const p of P.pinned) {
    const d = data.get(p.key), S_ = d?.samples;
    if (!S_?.length) continue;
    const col = p.color, X = (s) => s.cx * k, Y = (s) => s.cy * k;
    // polyline: visible runs only
    c.lineWidth = 1.5; c.strokeStyle = FILL(col, 0.85); c.lineJoin = 'round';
    c.beginPath();
    let pen = false;
    for (const s of S_) { if (!s.visible) { pen = false; continue; } if (pen) c.lineTo(X(s), Y(s)); else c.moveTo(X(s), Y(s)); pen = true; }
    c.stroke();
    // dots (bigger every 10 frames)
    for (const s of S_) {
      if (!s.visible) continue;
      const f = Math.round(s.t * fr), big = f % 10 === 0;
      c.fillStyle = big ? col : FILL(col, 0.7);
      c.beginPath(); c.arc(X(s), Y(s), big ? 3 : 1.6, 0, 6.3); c.fill();
      hitDots.push({ x: X(s), y: Y(s), s, f, col });
    }
    // rest points: speed < 0.5 px/frame after motion
    let moving = false;
    for (let i = 1; i < S_.length; i++) {
      const a = S_[i - 1], s = S_[i];
      if (!a.visible || !s.visible) { moving = false; continue; }
      const dist = Math.hypot(s.cx - a.cx, s.cy - a.cy) / Math.max(1, Math.round((s.t - a.t) * fr));
      if (dist >= 0.5) moving = true;
      else if (moving) {
        moving = false;
        const x = X(s), y = Y(s);
        c.fillStyle = tok('--background'); c.strokeStyle = col; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x, y - 6); c.lineTo(x + 6, y); c.lineTo(x, y + 6); c.lineTo(x - 6, y); c.closePath(); c.fill(); c.stroke();
      }
    }
    // start / end labels
    const vis = S_.filter((s) => s.visible);
    if (vis.length) {
      c.font = `600 ${tok('--text-3xs')} ${tok('--font-mono')}`; c.textBaseline = 'middle';
      for (const [s, tag] of [[vis[0], 'start'], [vis[vis.length - 1], 'end']]) {
        const txt = `${tag} ${s.t.toFixed(2)}s`, tw_ = c.measureText(txt).width + 8;
        const x = Math.min(Math.max(X(s) + 8, 2), w - tw_ - 2), y = Math.min(Math.max(Y(s) - 12, 8), h - 8);
        c.fillStyle = tok('--overlay-background'); c.fillRect(x, y - 7, tw_, 14);
        c.fillStyle = col; c.fillText(txt, x + 4, y + 0.5);
      }
    }
    // Onion skins use actual frame offsets, independently of path downsampling.
    const current = P.onion ? onionOf(p.key, now) : S_;
    const i = nearestIdx(current, now);
    if (i >= 0 && Math.abs(current[i].t - now) <= Math.max(2 / fr, (d.step || 1) / fr)) {
      if (P.onion) {
        for (let o = 1; o <= P.N; o++) for (const dir of [-1, 1]) {
          const s = current.find((s) => Math.round(s.t * fr) === Math.floor(now * fr + 1e-6) + dir * o);
          if (!s?.visible || !s.quad) continue;
          c.strokeStyle = FILL(col, 0.55 / o); c.lineWidth = 1.2; c.setLineDash(dir < 0 ? [] : [4, 3]);
          strokeQuad(c, s.quad, k);
        }
        c.setLineDash([]);
      }
      const s = current[i];
      if (s.visible) {
        c.strokeStyle = tok('--foreground'); c.lineWidth = 2; c.fillStyle = col;
        c.beginPath(); c.arc(X(s), Y(s), 6, 0, 6.3); c.fill(); c.stroke();
        if (P.onion && s.quad) {
          c.strokeStyle = FILL(col, 0.95); c.lineWidth = 1.4;
          strokeQuad(c, s.quad, k);
        }
      }
    }
  }
}

// hover tooltip + click-to-seek on dots (capture phase so it works under the Select tool too)
function dotAt(e) {
  const b = videoBox();
  if (!b || !hitDots.length) return null;
  const x = e.clientX - b.left, y = e.clientY - b.top;
  let best = null, bd = 49;
  for (const d of hitDots) { const dd = (d.x - x) ** 2 + (d.y - y) ** 2; if (dd < bd) { bd = dd; best = d; } }
  return best;
}
const toolOk = () => { const t = $('vo').dataset.tool; return t === 'view' || t === 'select'; };
function onHover(e) {
  if (!liveOn() || !toolOk() || !hitDots.length) { tip.hidden = true; return; }
  const d = dotAt(e);
  if (!d) { tip.hidden = true; $('video-wrap').classList.remove('on-dot'); return; }
  const wr = $('video-wrap').getBoundingClientRect();
  tip.hidden = false;
  tip.textContent = `${d.s.t.toFixed(3)} s · f${d.f}  (${Math.round(d.s.cx)}, ${Math.round(d.s.cy)})`;
  tip.style.borderColor = d.col;
  tip.style.left = Math.min(e.clientX - wr.left + 12, wr.width - 170) + 'px'; tip.style.top = (e.clientY - wr.top - 28) + 'px';
  $('video-wrap').classList.add('on-dot');
}
function onDown(e) {
  if (e.button !== 0 || !liveOn() || !toolOk()) return;
  const d = dotAt(e);
  if (!d) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (transport.playing) pause();
  ensureVisible(d.s.t); seek(d.s.t, { frame: true });
}

// ---------- pinned list / toolbar ----------
function syncUi() {
  const sel = getSel()?.key;
  btn?.classList.toggle('pinned', !!sel && isPinned(sel));
  const show = liveOn() && P.pinned.length > 0;
  bar.hidden = !show;
  if (show) {
    bar.innerHTML = '<span class="pb-t">⤳ Paths</span>'
      + P.pinned.map((p) => `<span class="pb-chip" style="--c:${p.color}" data-k="${esc(p.key)}" title="${esc(p.key)}"><i></i><b>${esc(p.key)}</b><button data-rm="${esc(p.key)}" tabindex="-1" title="Remove path">×</button></span>`).join('')
      + `<button class="pb-onion${P.onion ? ' on' : ''}" tabindex="-1" title="Onion skin: outlines at ±${P.N} frames">Onion</button>`;
    bar.onclick = (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { togglePin(rm.dataset.rm); return; }
      if (e.target.closest('.pb-onion')) { P.onion = !P.onion; save(); syncUi(); redraw(); }
    };
  }
  const ib = $('e-path');
  if (ib) ib.classList.toggle('on', !!sel && isPinned(sel));
}

// ---------- actual values (inspector column) ----------
export const A = { key: null, v: null };
let valBusy = false, valAgain = false, valLast = 0, valTimer = 0;
function wantValues() {
  clearTimeout(valTimer);
  const wait = Math.max(0, (transport.playing ? 100 : 0) - (performance.now() - valLast));
  valTimer = setTimeout(fetchValues, wait);
}
async function fetchValues() {
  const key = getSel()?.key;
  if (!key || !liveOn()) { A.key = null; A.v = null; return; }
  if (valBusy) { valAgain = true; return; }
  valBusy = true; valLast = performance.now();
  try {
    const r = await request('values', { keys: [key] }, 8000);
    if (getSel()?.key === key) { A.key = key; A.v = r?.[key] || null; applyActual(); }
  } catch { /* ignore */ }
  valBusy = false;
  if (valAgain) { valAgain = false; wantValues(); }
}
const ACT_FIELD = { x: 'cx', y: 'cy', scale: 'scaleX', rotate: 'rotate', opacity: 'opacity' };
/** Actual value of an inspector property for `key` at the playhead (centre x/y, accumulated scale/rotate, effective opacity), or null. */
export function actualOf(key, k) {
  const v = key && A.key === key ? A.v : null, n = v?.[ACT_FIELD[k]];
  return Number.isFinite(n) ? +n : null;
}
const fmtAct = (k, n) => (k === 'scale' || k === 'opacity' ? +(+n).toFixed(3) : +(+n).toFixed(2));
/**
 * Fill the element inspector's value fields (input[data-act]) with the actual values; the focused field is left alone.
 * Called after every inspector sync and when values arrive. Empty while the first values are on their way; when the
 * bridge answered without values, a field shows its tweak (data-tw).
 */
export function applyActual(root = $('inspector')) {
  if (!root) return;
  const key = getSel()?.key, v = key && A.key === key ? A.v : null;
  for (const inp of root.querySelectorAll('input[data-act]')) {
    const k = inp.dataset.act, a = actualOf(key, k), f = inp.closest('.field');
    f?.classList.toggle('off', !!v && !v.visible);
    f?.classList.toggle('no-act', a == null);
    inp.title = a == null ? 'tweak value (no live values)'
      : k === 'scale' && Math.abs(v.scaleX - v.scaleY) >= 0.005 ? `actual x ${(+v.scaleX).toFixed(3)} × y ${(+v.scaleY).toFixed(3)}` : '';
    if (inp.ownerDocument.activeElement === inp) continue;
    const tw = A.key === key && inp.dataset.tw ? +inp.dataset.tw : null;
    const val = a ?? tw;
    inp.value = val == null ? '' : fmtAct(k, val);
  }
}

export function initPaths() {
  window.addEventListener('theme', redraw);
  cv = document.createElement('canvas'); cv.id = 'paths-canvas';
  c2 = cv.getContext('2d');
  $('vo').insertBefore(cv, $('vo').firstChild);
  bar = document.createElement('div'); bar.id = 'paths-bar'; bar.hidden = true; $('video-wrap').appendChild(bar);
  tip = document.createElement('div'); tip.id = 'paths-tip'; tip.hidden = true; $('video-wrap').appendChild(tip);
  btn = addTool({ id: 'path', label: '⤳ Path', key: 'P', title: 'Motion path of the selected element (P): pin / unpin; Live only', onClick: pinSelected });
  const wrap = $('video-wrap');
  wrap.addEventListener('pointermove', onHover, true);
  wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
  wrap.addEventListener('pointerdown', onDown, true);
  on('layout', redraw);
  on('time', redraw);
  on('paths-data', syncUi);
  on('el-select', () => { syncUi(); A.key = null; A.v = null; applyActual(); wantValues(); });
  on('live-rendered', () => { wantValues(); });
  on('live-tweaks-applied', () => { markStale(); });
  on('live-ready', () => { data.clear(); inflight.clear(); onionData.clear(); gen++; schedule(0); syncUi(); wantValues(); redraw(); });
  on('live', () => { if (!liveOn()) { data.clear(); inflight.clear(); onionData.clear(); gen++; A.key = null; A.v = null; } syncUi(); redraw(); });
  on('tracks', () => schedule(0));
  on('scene', () => { data.clear(); inflight.clear(); onionData.clear(); gen++; load(); syncUi(); redraw(); });
  load(); syncUi();
}
