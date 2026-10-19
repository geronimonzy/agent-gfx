import { roundSurfaceOrigin } from './surface-origin.js';
// Live mode (docs/REVIEW.md §4/§5): the scene runs in a bridge iframe laid exactly over the video box, follows the transport,
// shows the draft tweak layer, and the Select tool picks / moves / scales / rotates its elements.
import { S, on, emit, fps, clamp, patchTweak, tweakOf } from './store.js';
import * as api from './api.js';
import { transport, setVideoDriven } from './transport.js';
import { addTool, setTool, getTool, setBaseTool, setPicker, videoBox, wrapBox, toScene, sceneToWrap } from './viewer.js';

import { $ } from './dom.js';
import { errorLocation, errorText, errorWhere } from './live-error.js';
// error: the scene threw (docs/REVIEW.md §5 "Live errors") = { message, path?, line?, col?, phase: 'load' | 'reload' }
export const L = { on: false, ready: false, url: null, busy: false, elements: [], sel: null, hover: null, error: null };
/** Tweak edit that makes the viewer show the draft layer (A/B = Draft), otherwise the edit would be invisible. */
export function editTweak(key, patch, opts) {
  const ok = patchTweak(key, patch, opts);
  if (ok && S.mode !== 'draft') { S.mode = 'draft'; emit('mode'); }
  return ok;
}
export const liveOn = () => L.on && L.ready;
export const getSel = () => L.sel;

let bridgeGeneration = 0;
let ifr = null, pending = new Map(), nextId = 1, helloTimer = 0, failTimer = 0;
let wantT = null, sentT = null, seeking = false, lastFrame = -1;
let tweaksSent = null, tweaksWant = null, tweaksBusy = false;
let btn = null, selBtn = null, dragSeq = 0;

// ---------- bridge client ----------
function post(msg) { try { ifr?.contentWindow?.postMessage(msg, '*'); } catch { /* gone */ } }
export function request(type, payload = {}, timeout = 8000) {
  return new Promise((res, rej) => {
    if (!ifr) return rej(new Error('no bridge'));
    const id = nextId++;
    const to = setTimeout(() => { pending.delete(id); rej(new Error(`bridge ${type} timed out`)); }, timeout);
    pending.set(id, { res, rej, to });
    post({ id, type, ...payload });
  });
}
function onMessage(ev) {
  if (!ifr || ev.source !== ifr.contentWindow) return;
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'ready') return becameReady();
  // live code reload (FOUNDATION §5): the bridge rebuilt the scene in place; a failed rebuild keeps the old scene
  if (m.type === 'reloaded') {
    clearError(true);
    emit('live-reloaded', m);
    emit('toast', { m: `Scene reloaded (${m.reason || 'files changed'})`, ms: 1800 });
    loadElements();
    afterRender();
    return;
  }
  // a scene error never turns Live off: the overlay names file:line and the next good reload clears it
  if (m.type === 'error') return sceneError(m, m.files && L.ready ? 'reload' : 'load');
  if (m.type === 'reply') {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id); clearTimeout(p.to);
    if (m.ok) p.res(m.result); else p.rej(new Error(m.error || 'bridge error'));
  }
}
function dropPending(why) { for (const [, p] of pending) { clearTimeout(p.to); p.rej(new Error(why)); } pending.clear(); }

// ---------- lifecycle ----------
function mount() {
  unmount();
  ifr = document.createElement('iframe');
  ifr.id = 'live-frame';
  ifr.setAttribute('tabindex', '-1');
  ifr.style.visibility = 'hidden';
  $('video-wrap').insertBefore(ifr, $('vo'));
  ifr.src = `${L.url}/runner/player/bridge.html?scene=${encodeURIComponent(S.name)}`;
  const hello = () => post({ type: 'hello' });
  let loads = 0;
  ifr.onload = () => {
    // a second load = the iframe was moved to another place in the dock / a popout window and reloaded: re-sync it
    if (loads++ && L.ready) { L.ready = false; dropPending('bridge reloaded'); wantT = sentT = null; seeking = false; lastFrame = -1; tweaksSent = null; tweaksBusy = false; }
    else if (loads > 1 && !L.ready) armFail(); // a broken scene's page reloads itself after a file change: wait for it again
    hello(); clearInterval(helloTimer); helloTimer = setInterval(hello, 500);
  };
  armFail();
  layout();
}
function armFail() {
  clearTimeout(failTimer);
  failTimer = setTimeout(() => { if (!L.ready) fail('timed out loading the scene in the live server'); }, 25000);
}
function unmount() {
  bridgeGeneration++;
  clearInterval(helloTimer); clearTimeout(failTimer);
  dropPending('bridge closed');
  if (ifr) { ifr.remove(); ifr = null; }
  clearError(false);
  setVideoDriven(true); // the rendered video is the picture again: put it back on the playhead
  L.ready = false; wantT = sentT = null; seeking = false; lastFrame = -1; tweaksSent = tweaksWant = null; tweaksBusy = false;
}
function becameReady() {
  if (L.ready) return;
  L.ready = true;
  clearInterval(helloTimer); clearTimeout(failTimer);
  clearError(true);
  ifr.style.visibility = 'visible';
  setVideoDriven(false); // the hidden rendered video would only compete with the scene for decode/GPU time
  syncChrome();
  if (getTool() === 'view') setTool('select'); // Live opens with the Select tool (C = comment, D = draw)
  pushTweaks(true);
  follow(transport.time(), true);
  emit('live-ready');
  loadElements();
  emit('live');
}
function loadElements() {
  request('elements').then((e) => { L.elements = e || []; emit('elements'); }).catch(() => {});
}
function fail(msg) {
  console.warn('live bridge:', msg);
  disable();
  emit('toast', { m: `Live view unavailable (${msg}); showing the rendered video`, ms: 5000 });
}
function disable() {
  L.on = false; clearSel(); L.hover = null;
  unmount();
  setPicker(null);
  if (getTool() === 'select') setTool('view');
  syncChrome(); drawOverlay();
  emit('live');
}
async function enable() {
  if (!S.name) return;
  let st = await api.serverStatus();
  if (!st.url) {
    emit('toast', { m: 'Starting the live server…', ms: 40000 });
    try { st = await api.startServer(); } catch (e) { emit('toast', { m: String(e.message || e), ms: 7000 }); return; }
    emit('toast', { m: 'Live server running', ms: 1500 });
  }
  L.url = st.url; L.on = true;
  setPicker(pickForComment);
  mount(); syncChrome();
  emit('live');
}
export const toggleLive = () => (L.on ? disable() : enable());

function syncChrome() {
  const live = liveOn(), err = L.on && L.error;
  $('video-wrap').classList.toggle('live-on', live);
  $('video-wrap').classList.toggle('live-broken', !!err && !live); // no live picture yet: the rendered video, dimmed
  const b = $('live-badge');
  b.hidden = !S.meta;
  b.textContent = err ? 'LIVE · ERROR' : live ? 'LIVE' : L.on ? 'LIVE…' : 'RENDERED';
  b.dataset.s = err ? 'error' : live ? 'live' : L.on ? 'wait' : 'rendered';
  btn?.classList.toggle('on', L.on);
  if (selBtn) selBtn.disabled = !live;
}

// ---------- layout / transport / tweaks ----------
function layout() {
  const b = wrapBox();
  if (ifr && b && S.meta) {
    Object.assign(ifr.style, {
      width: S.meta.width + 'px', height: S.meta.height + 'px', left: b.left + 'px', top: b.top + 'px',
      transform: `scale(${b.k})`,
    });
  }
  const bd = $('live-badge');
  if (b) { bd.style.left = (b.left + b.w - 8) + 'px'; bd.style.top = (b.top + 8) + 'px'; }
  if (b && errEl) Object.assign(errEl.style, { left: (b.left + b.w / 2) + 'px', top: (b.top + b.h - 10) + 'px', maxWidth: Math.max(240, b.w - 24) + 'px' });
  if (errEl) roundSurfaceOrigin(errEl);
  drawOverlay();
}

// ---------- scene errors (docs/REVIEW.md §5 "Live errors") ----------
// load: the scene never ran (the bridge page reloads itself on the next file change, then sends ready or error again);
// reload: a rebuild failed and the bridge keeps the last good scene running. Either way Live stays on.
let errEl = null;
function sceneError(m, phase) {
  if (!L.on) return;
  const loc = errorLocation(`${m.message || ''}\n${m.stack || ''}`, S.root);
  const e = { message: errorText(m.message), phase, ...(loc || {}) };
  const same = L.error && L.error.message === e.message && errorWhere(L.error) === errorWhere(e) && L.error.phase === phase;
  L.error = e;
  if (phase === 'load') { clearTimeout(failTimer); clearInterval(helloTimer); }
  console.warn('live scene error:', m.message, m.stack || '');
  emit('live-error', { ...m, ...(loc || {}) });
  renderError(); syncChrome(); layout();
  if (!same) {
    const where = errorWhere(e);
    emit('toast', { m: `Scene error${where ? ` in ${where}` : ''}: ${e.message}. ${phase === 'load' ? 'Live reloads by itself once the scene runs again.' : 'Live keeps the last working version until then.'}`, ms: 6000 });
  }
  emit('live');
}
function clearError(recovered) {
  if (!L.error) return;
  L.error = null;
  renderError(); syncChrome();
  if (recovered) emit('toast', { m: 'Scene runs again: Live is back', ms: 2200 });
}
function renderError() {
  if (!errEl) return;
  const e = L.on ? L.error : null;
  errEl.hidden = !e;
  if (!e) return;
  errEl.dataset.phase = e.phase;
  errEl.querySelector('.le-loc').textContent = errorWhere(e) || `scenes/${S.name}`;
  errEl.querySelector('.le-msg').textContent = e.message;
  errEl.querySelector('.le-msg').title = e.message;
  errEl.querySelector('.le-sub').textContent = e.phase === 'load'
    ? 'The scene can\'t run (Claude may still be editing it). Live comes back by itself when it runs again.'
    : 'The last edit broke the scene (Claude may still be editing it). Showing the last working version until it runs again.';
  roundSurfaceOrigin(errEl);
}
/** Open code: the error's file at its line (Code mode), else the scene's scene.js. */
async function openErrorCode() {
  const e = L.error, path = e?.path || (S.name ? `scenes/${S.name}/scene.js` : null);
  if (!path) return;
  try { const code = await import('./code.js'); await code.openCodeAt(path, e?.line ? { line: e.line, col: e.col } : null); }
  catch (err) { emit('toast', { m: 'Open failed: ' + (err.message || err), ms: 4000 }); }
}
const frameT = (t) => Math.floor(t * fps() + 1e-6) / fps();

/** Coalesced seeks: at most one in flight; the latest wanted time wins. */
function follow(t, force = false) {
  if (!liveOn()) return;
  const f = Math.floor(t * fps() + 1e-6);
  if (f === lastFrame && !force) return;
  lastFrame = f; wantT = frameT(t);
  pump();
}
async function pump() {
  if (seeking) return;
  seeking = true;
  try {
    while (liveOn() && wantT !== sentT) {
      const t = wantT; sentT = t;
      await request('seek', { t });
      if (liveOn()) afterRender();
    }
  } catch (e) { console.warn('live seek', e.message); }
  seeking = false;
}
const layer = () => (S.mode === 'draft' ? S.draft.tweaks || {} : {});
async function pushTweaks(force = false) {
  if (!liveOn()) return;
  tweaksWant = JSON.stringify(layer());
  if (tweaksBusy || (!force && tweaksWant === tweaksSent)) return;
  tweaksBusy = true;
  try {
    while (liveOn() && tweaksWant !== tweaksSent) {
      const w = tweaksWant; tweaksSent = w;
      await request('tweaks', { tweaks: JSON.parse(w) });
      emit('live-tweaks-applied');
    }
  } catch (e) { console.warn('live tweaks', e.message); }
  tweaksBusy = false;
  if (liveOn()) afterRender();
}
let bTimer = 0, bLast = 0;
function afterRender() {
  emit('live-rendered');
  if (codeKeys.length) { clearTimeout(cTimer); cTimer = setTimeout(refreshCodeBounds, Math.max(0, (transport.playing ? 120 : 0) - (performance.now() - cLast))); }
  if (!L.sel) return;
  const wait = transport.playing ? 100 : 0, now = performance.now();
  clearTimeout(bTimer);
  bTimer = setTimeout(refreshBounds, Math.max(0, wait - (now - bLast)));
}
async function refreshBounds() {
  const s = L.sel;
  if (!s || !liveOn()) return;
  bLast = performance.now();
  try {
    const r = await request('bounds', { keys: [s.key] });
    if (L.sel === s) { s.bounds = r?.[s.key] || null; drawOverlay(); }
  } catch { /* ignore */ }
}

// ---------- code outlines (Code mode: elements touched by the editor's cursor line, docs/CODE-VERSIONS.md §3) ----------
let codeKeys = [], codeBounds = {}, cTimer = 0, cLast = 0, codeSeq = 0;
/** Outline these element keys in the picture (dashed); [] clears. Bounds follow the playhead. */
export function setCodeOutlines(keys) {
  const next = [...new Set((keys || []).filter((k) => typeof k === 'string'))];
  if (next.join('\n') === codeKeys.join('\n')) return;
  codeKeys = next;
  if (!codeKeys.length) { codeBounds = {}; drawOverlay(); return; }
  refreshCodeBounds();
}
export const codeOutlineKeys = () => codeKeys.slice();
async function refreshCodeBounds() {
  cLast = performance.now();
  const my = ++codeSeq, keys = codeKeys;
  if (!keys.length || !liveOn()) { codeBounds = {}; drawOverlay(); return; }
  try { const b = await request('bounds', { keys }); if (my === codeSeq) codeBounds = b || {}; } catch { if (my === codeSeq) codeBounds = {}; }
  if (my === codeSeq) drawOverlay();
}

// ---------- picking ----------
let pickFilter = null;
/** Layers (REVIEW.md §6): fn(stack) -> stack without locked elements; applied to every pick. */
export const setPickFilter = (fn) => { pickFilter = fn; };
const pickAt = async (x, y) => { const st = (await request('pick', { x, y }))?.stack || []; return pickFilter ? pickFilter(st) : st; };
/** Outline an element in the picture from outside the Select tool (Layers row hover); null clears. */
export function setExtHover(bounds) { ext = bounds || null; drawOverlay(); }
let ext = null;
const topNamed = (stack) => stack.find((e) => e.named) || stack[0] || null;
/** Settle the iframe at the current frame before a pick (comments are made on a paused frame). */
async function settle() {
  for (let i = 0; i < 60 && (seeking || wantT !== sentT); i++) await new Promise((r) => setTimeout(r, 25));
}
async function pickForComment(x, y) {
  if (!liveOn()) return null;
  await settle();
  const e = topNamed(await pickAt(x, y));
  return e ? e.key : null;
}

// ---------- selection ----------
export function clearSel() { if (!L.sel) return; L.sel = null; emit('el-select', null); drawOverlay(); }
function setSel(stack, idx) {
  const e = stack[idx];
  if (!e) return clearSel();
  L.sel = { key: e.key, stack, idx, entry: e, bounds: e.bounds || null };
  S.sel.cue = null; S.sel.note = null; emit('selection');
  emit('el-select', e.key);
  drawOverlay(); refreshBounds();
}
/** Select by key (Elements tab / Changes tab). */
export async function selectKey(key) {
  if (!liveOn()) { emit('toast', { m: 'Turn Live on (L) to select elements', ms: 2000 }); return; }
  const generation = bridgeGeneration, scene = S.name;
  const current = () => liveOn() && !S.loading && bridgeGeneration === generation && S.name === scene;
  setTool('select');
  let entry = { key, label: key, named: !key.startsWith('@'), text: false, bounds: null };
  try {
    const b = (await request('bounds', { keys: [key] }))?.[key];
    if (!current()) return;
    if (b) {
      entry.bounds = b;
      const hit = (await pickAt(b.x + b.w / 2, b.y + b.h / 2)).find((e) => e.key === key);
      if (!current()) return;
      if (hit) entry = hit;
    }
  } catch { if (!current()) return; /* keep fallback for bridge errors */ }
  if (!current()) return;
  setSel([entry], 0);
}
export function walk(d) {
  const s = L.sel;
  if (!s) return;
  const i = clamp(s.idx + d, 0, s.stack.length - 1);
  if (i !== s.idx) setSel(s.stack, i);
}
export const selectIndex = (i) => { if (L.sel) setSel(L.sel.stack, i); };

// ---------- overlay: hover outline, selection box, handles ----------
let layerEl = null;
function boxEl(cls) { const d = document.createElement('div'); d.className = cls; return d; }
function placeBox(el, b) {
  const p = sceneToWrap(b.x, b.y), k = videoBox()?.k;
  if (!p || !k) { el.hidden = true; return null; }
  el.hidden = false;
  Object.assign(el.style, { left: p.x + 'px', top: p.y + 'px', width: b.w * k + 'px', height: b.h * k + 'px' });
  return p;
}
function drawOverlay() {
  if (!layerEl) return;
  const hv = layerEl.querySelector('.hovbox'), sb = layerEl.querySelector('.selbox');
  const showHover = liveOn() && getTool() === 'select' && L.hover && !drag;
  const hb = ext && liveOn() ? ext : showHover ? L.hover.bounds : null;
  hv.hidden = !hb;
  if (hb) placeBox(hv, hb);
  const b = liveOn() && L.sel?.bounds;
  sb.hidden = !b;
  if (b) {
    placeBox(sb, b);
    const tw = S.draft.tweaks?.[L.sel.key];
    sb.dataset.tweaked = tw ? '1' : '';
    sb.querySelector('.sb-label').textContent = L.sel.entry.label || L.sel.key;
  }
  layerEl.dataset.sel = b ? '1' : '';
  // code outlines
  const host = layerEl.querySelector('.codeboxes');
  const want = liveOn() ? codeKeys.filter((k) => codeBounds[k]) : [];
  while (host.children.length > want.length) host.lastChild.remove();
  while (host.children.length < want.length) { const d = boxEl('codebox'); d.innerHTML = '<span></span>'; host.appendChild(d); }
  want.forEach((k, i) => { const el = host.children[i]; placeBox(el, codeBounds[k]); el.firstChild.textContent = k; });
}

// client-space geometry of the selection box
function selGeom() {
  const b = L.sel?.bounds, vb = videoBox();
  if (!b || !vb) return null;
  const x0 = vb.left + b.x * vb.k, y0 = vb.top + b.y * vb.k, w = b.w * vb.k, h = b.h * vb.k;
  return { x0, y0, x1: x0 + w, y1: y0 + h, cx: x0 + w / 2, cy: y0 + h / 2, knob: { x: x0 + w / 2, y: y0 - 26 }, k: vb.k };
}
const HS = 8;
function hitHandle(g, cx, cy) {
  const near = (px, py, r = HS + 3) => Math.abs(cx - px) <= r && Math.abs(cy - py) <= r;
  if (near(g.knob.x, g.knob.y, 10)) return 'rotate';
  for (const [px, py] of [[g.x0, g.y0], [g.x1, g.y0], [g.x0, g.y1], [g.x1, g.y1]]) if (near(px, py)) return 'scale';
  return null;
}
const inside = (g, cx, cy) => cx >= g.x0 && cx <= g.x1 && cy >= g.y0 && cy <= g.y1;

// ---------- Select tool: pointer ----------
let drag = null, hovBusy = false, hovAt = 0;

async function onDown(e) {
  if (getTool() !== 'select' || e.button !== 0 || !liveOn()) return;
  e.preventDefault();
  const cat = e.currentTarget;
  try { cat.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const g = selGeom();
  const alt = e.altKey, start = { x: e.clientX, y: e.clientY };
  let mode = null, fresh = false;
  if (g) { mode = hitHandle(g, e.clientX, e.clientY) || (inside(g, e.clientX, e.clientY) ? 'move' : null); }
  const d = (drag = { mode, start, active: false, key: null, seq: ++dragSeq, shift: e.shiftKey, alt, fresh });
  if (!mode) {
    // click outside: pick now, then allow dragging the new element immediately
    const p = toScene(e.clientX, e.clientY);
    try {
      await settle();
      const stack = await pickAt(p.x, p.y);
      const i = alt ? 0 : Math.max(0, stack.indexOf(topNamed(stack)));
      if (stack.length) setSel(stack, i); else clearSel();
      if (drag !== d) return; // released before the pick came back: the click is complete
      d.fresh = true;
      if (stack.length) d.mode = 'move';
    } catch (err) { console.warn('pick', err.message); if (drag === d) drag = null; return; }
  }
  if (drag === d && d.mode) beginDragState();
}
// which tweak props a drag may change (the inspector sets it: objects drawn by code only take what the scene reads)
let canEdit = () => true;
export const setEditGate = (f) => { canEdit = f; };
function beginDragState() {
  const s = L.sel, g = selGeom();
  if (!s || !g) { return; }
  const props = drag.mode === 'move' ? ['x', 'y'] : [drag.mode];
  drag.blocked = !props.every((k) => canEdit(s.key, k)); // a click still selects; only an actual drag is refused
  const t0 = tweakOf(s.key);
  Object.assign(drag, { key: s.key, t0, g, a0: Math.atan2(drag.start.y - g.cy, drag.start.x - g.cx), r0: Math.hypot(drag.start.x - g.cx, drag.start.y - g.cy) || 1 });
}
function onMove(e) {
  if (getTool() !== 'select' || !liveOn()) return;
  // a lost pointerup (focus moved to another webview/window mid-drag) must not keep dragging on hover
  if (drag && e.buttons === 0) { onUp(e); return; }
  if (drag && drag.key) {
    const dx = e.clientX - drag.start.x, dy = e.clientY - drag.start.y;
    if (!drag.active && Math.hypot(dx, dy) < 3) return;
    if (drag.blocked) {
      emit('toast', { m: `${drag.key} is drawn by code; it can't be ${drag.mode === 'move' ? 'moved' : drag.mode + 'd'} here. Ask Claude or edit its code.`, ms: 3500 });
      drag.key = null; return;
    }
    drag.active = true;
    const opts = { key: `drag:${drag.seq}`, window: Infinity }, { t0, g } = drag;
    const r1 = (v) => Math.round(v * 10) / 10;
    if (drag.mode === 'move') editTweak(drag.key, { x: r1(t0.x + dx / g.k), y: r1(t0.y + dy / g.k) }, opts);
    else if (drag.mode === 'scale') {
      const r = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
      editTweak(drag.key, { scale: Math.round(clamp(t0.scale * r / drag.r0, 0.05, 20) * 1000) / 1000 }, opts);
    } else if (drag.mode === 'rotate') {
      let a = t0.rotate + (Math.atan2(e.clientY - g.cy, e.clientX - g.cx) - drag.a0) * 180 / Math.PI;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      editTweak(drag.key, { rotate: Math.round(a * 10) / 10 }, opts);
    }
    return;
  }
  if (drag) return;
  // hover cursor + throttled pick
  const g = selGeom();
  const cat = e.currentTarget, h = g && hitHandle(g, e.clientX, e.clientY);
  cat.style.cursor = h === 'rotate' ? 'grab' : h === 'scale' ? 'nwse-resize' : g && inside(g, e.clientX, e.clientY) ? 'move' : 'default';
  const now = performance.now();
  if (hovBusy || now - hovAt < 33) return;
  hovAt = now; hovBusy = true;
  const p = toScene(e.clientX, e.clientY), alt = e.altKey;
  pickAt(p.x, p.y).then((stack) => {
    const en = alt ? stack[0] : topNamed(stack);
    L.hover = en || null; drawOverlay();
  }).catch(() => {}).finally(() => { hovBusy = false; });
}
async function onUp(e) {
  const d = drag; drag = null;
  if (!d) return;
  if (d.active) { drawOverlay(); refreshBounds(); return; }
  // plain click on the selection box (not a fresh pick): re-pick so a click selects whatever is under the cursor
  if (d.mode === 'move' && !d.fresh) {
    const p = toScene(e.clientX, e.clientY);
    try {
      await settle();
      const stack = await pickAt(p.x, p.y);
      if (!stack.length) return clearSel();
      setSel(stack, d.alt ? 0 : Math.max(0, stack.indexOf(topNamed(stack))));
    } catch { /* ignore */ }
  }
}

// ---------- keys (bound in keymap.js) ----------
/** Nudge the selected element by (dx, dy) px; one undo step per burst. */
export function nudgeSel(dx, dy) {
  if (!L.sel) return;
  const t = tweakOf(L.sel.key);
  editTweak(L.sel.key, { x: +(t.x + dx).toFixed(2), y: +(t.y + dy).toFixed(2) }, { key: `nudge:${L.sel.key}`, window: 600 });
}

// ---------- init ----------
export function initLive() {
  btn = addTool({ id: 'live', label: 'Live', key: 'L', title: 'Live scene view (L): run the scene in the browser to pick and tweak its elements', onClick: toggleLive });
  selBtn = addTool({ id: 'select', label: 'Select', key: 'V', title: 'Select / move / scale / rotate elements (V, Live only)' });
  selBtn.disabled = true;
  setBaseTool(() => (liveOn() ? 'select' : 'view'));
  layerEl = boxEl('sel-layer');
  layerEl.innerHTML = '<div class="codeboxes"></div><div class="hovbox" hidden></div><div class="selbox" hidden><span class="sb-label"></span><i class="h tl"></i><i class="h tr"></i><i class="h bl"></i><i class="h br"></i><i class="knob"></i></div>';
  $('vo').appendChild(layerEl);
  errEl = document.createElement('div');
  errEl.id = 'live-err'; errEl.hidden = true; errEl.setAttribute('role', 'alert');
  errEl.innerHTML = '<div class="le-row"><b>Scene error</b><span class="le-loc"></span><span class="le-msg"></span><button type="button" class="tbtn sm" data-a="code">Open code</button></div><div class="le-sub"></div>';
  errEl.querySelector('[data-a=code]').onclick = (ev) => { ev.currentTarget.blur(); openErrorCode(); };
  $('video-wrap').appendChild(errEl);
  const catcher = $('tool-catcher');
  catcher.addEventListener('pointerdown', onDown);
  catcher.addEventListener('pointermove', onMove);
  catcher.addEventListener('pointerup', onUp);
  catcher.addEventListener('pointercancel', () => { drag = null; });
  catcher.addEventListener('lostpointercapture', (e) => { if (drag) onUp(e); });
  catcher.addEventListener('pointerleave', () => { if (L.hover) { L.hover = null; drawOverlay(); } });
  window.addEventListener('message', onMessage);
  on('layout', layout);
  on('time', (t) => follow(t));
  on('draft', () => { pushTweaks(); drawOverlay(); });
  on('mode', () => pushTweaks());
  on('tool', () => { L.hover = null; drawOverlay(); });
  on('selection', () => { if (S.sel.cue || S.sel.note) clearSel(); });
  on('scene', () => { clearSel(); L.elements = []; codeKeys = []; codeBounds = {}; if (L.on) mount(); syncChrome(); });
  syncChrome();
}
