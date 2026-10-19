// Viewer overlay layer: scene<->screen mapping for the picture (letterboxed), tool state, picker hook, tool bar.
// Extension points for Live mode: setPicker(fn), addTool({...}), setTool(id), getTool(), the 'layout' event, #vo (overlay root).
import { S, on, emit } from './store.js';

import { $ } from './dom.js';
let tool = 'view', picker = null, openComment = null;

export const getTool = () => tool;
// The tool a finished action falls back to: 'view', or 'select' while Live is on (live.js sets the provider).
let baseFn = () => 'view';
export const setBaseTool = (fn) => { baseFn = fn; };
export const baseTool = () => baseFn();
export function setTool(t) { if (t === tool) return; tool = t; syncToolbar(); emit('tool', t); }
/** fn(x, y, t) -> element key | null | Promise of either. Called when a pin comment is created; result is stored as `el`. */
export const setPicker = (fn) => { picker = fn; };
export const getPicker = () => picker;
export const getOpenComment = () => openComment;
export function setOpenComment(id) { openComment = id; emit('open-comment', id); }

// Show / hide comments on the picture (pins + markup; the Comments tab is unaffected). Remembered for the session.
let shown = (() => { try { return sessionStorage.getItem('gfx.commentsShown') !== '0'; } catch { return true; } })();
export const commentsShown = () => shown;
export function setCommentsShown(v) {
  shown = !!v;
  try { sessionStorage.setItem('gfx.commentsShown', shown ? '1' : '0'); } catch { /* storage off */ }
  emit('comments-vis', shown);
}
export const toggleCommentsShown = () => setCommentsShown(!shown);

/** Displayed picture rect (client px) of the video element, accounting for object-fit: contain letterboxing. */
export function videoBox() {
  const v = $('video'), m = S.meta;
  if (!v || !m) return null;
  const r = v.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  const k = Math.min(r.width / m.width, r.height / m.height), w = m.width * k, h = m.height * k;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, w, h, k };
}
/** client px -> scene px (unclamped) */
export function toScene(cx, cy) {
  const b = videoBox();
  if (!b) return null;
  return { x: (cx - b.left) / b.k, y: (cy - b.top) / b.k };
}
/** scene px -> client px */
export function sceneToClient(x, y) {
  const b = videoBox();
  return b ? { x: b.left + x * b.k, y: b.top + y * b.k } : null;
}
/** videoBox() with left/top relative to #video-wrap (for absolutely positioned overlay children). */
export function wrapBox() {
  const b = videoBox();
  if (!b) return null;
  const w = $('video-wrap').getBoundingClientRect();
  return { ...b, left: b.left - w.left, top: b.top - w.top };
}
/** scene px -> px relative to #video-wrap (for absolutely positioned overlay children) */
export function sceneToWrap(x, y) {
  const c = sceneToClient(x, y);
  if (!c) return null;
  const w = $('video-wrap').getBoundingClientRect();
  return { x: c.x - w.left, y: c.y - w.top };
}
export const inScene = (p) => !!p && p.x >= 0 && p.y >= 0 && p.x <= S.meta.width && p.y <= S.meta.height;

/** Add a button to the viewer tool bar (e.g. Live's `Select (V)`). onClick defaults to toggling setTool(id). */
export function addTool({ id, label, key, title, onClick }) {
  const b = document.createElement('button');
  b.className = 'tbtn vtool'; b.dataset.tool = id; b.title = title || `${label}${key ? ` (${key})` : ''}`;
  b.innerHTML = `${label}${key ? `<kbd>${key}</kbd>` : ''}`;
  b.onclick = (e) => { e.currentTarget.blur(); (onClick || (() => setTool(tool === id ? 'view' : id)))(); };
  $('vtools').appendChild(b);
  syncToolbar();
  return b;
}
function syncToolbar() {
  for (const b of $('vtools').querySelectorAll('.vtool')) b.classList.toggle('on', b.dataset.tool === tool);
  $('vo').dataset.tool = tool;
}

function layout() {
  const b = wrapBox();
  for (const id of ['draw-canvas', 'tool-catcher']) {
    const el = $(id);
    if (!b) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = b.left + 'px'; el.style.top = b.top + 'px';
    el.style.width = b.w + 'px'; el.style.height = b.h + 'px';
  }
  emit('layout');
}

export function initViewer() {
  addTool({ id: 'comment', label: 'Comment', key: 'C', title: 'Comment tool: click the picture to pin a comment (C)' });
  const ro = new ResizeObserver(layout);
  ro.observe($('video-wrap')); ro.observe($('video'));
  on('scene', layout);
  $('video').addEventListener('loadedmetadata', layout);
  window.addEventListener('resize', layout);
  layout();
}
