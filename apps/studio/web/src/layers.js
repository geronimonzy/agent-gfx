// Layers (docs/REVIEW.md §6): scene tree from the live bridge, view-only hide / solo / lock, sampled visibility spans for the timeline.
// The Layers side tab renders the tree; timeline.js draws the LAYERS section from rows() and shares the expansion state.
import { S, on, emit, esc, readView, writeView } from './store.js';
import { request, L, getSel, liveOn, selectKey, setPickFilter, setExtHover } from './live.js';
import { transport, seek, pause } from './transport.js';
import { ensureVisible } from './timeline.js';

export const LY = { nodes: [], byKey: new Map(), kids: new Map(), spans: {}, mapping: false, ready: false, tlOpen: localStorage.getItem('gfx-studio.layers.tl') !== '0' };
const V = { hidden: new Set(), locked: new Set(), solo: null, closed: new Set(), open: new Set() }; // open = groups the user expanded, closed = nodes the user collapsed
let gen = 0, spanTimer = 0, spanSig = null, spanBusy = false, viewSent = '', viewBusy = false, revealedFor = null, scrolledFor = null, hoverSeq = 0;
let defaultCollapsed = false;
const storeKey = () => `gfx-studio.layers.${S.name}`;

function loadView() {
  defaultCollapsed = true;
  const reset = () => { V.hidden.clear(); V.locked.clear(); V.closed.clear(); V.open.clear(); V.solo = null; };
  reset();
  const ok = readView(storeKey(), (j) => { j.hidden?.forEach((k) => V.hidden.add(k)); j.locked?.forEach((k) => V.locked.add(k)); j.closed?.forEach((k) => V.closed.add(k)); j.open?.forEach((k) => V.open.add(k)); V.solo = j.solo || null; });
  if (ok) defaultCollapsed = false; else reset();
}
function saveView() {
  writeView(storeKey(), { hidden: [...V.hidden], locked: [...V.locked], closed: [...V.closed], open: [...V.open], solo: V.solo });
}

// ---------- tree model ----------
function buildTree(res) {
  const nodes = (res?.nodes || []).filter((n) => n && n.key);
  const rank = new Map((res?.order || []).map((k, i) => [k, i]));
  LY.nodes = nodes; LY.byKey = new Map(nodes.map((n) => [n.key, n]));
  const kids = new Map();
  nodes.forEach((n, i) => {
    const p = n.parent && LY.byKey.has(n.parent) ? n.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push({ n, i });
  });
  for (const arr of kids.values()) arr.sort((a, b) => ((rank.get(a.n.key) ?? 1e9) - (rank.get(b.n.key) ?? 1e9)) || a.i - b.i);
  LY.kids = new Map([...kids].map(([k, arr]) => [k, arr.map((x) => x.n)]));
  if (defaultCollapsed) {
    for (const n of nodes) V.closed.add(n.key);
    defaultCollapsed = false;
  }
}
const parentOf = (k) => { const p = LY.byKey.get(k)?.parent; return p && LY.byKey.has(p) ? p : null; };
const ancestors = (k) => { const a = []; for (let p = parentOf(k); p; p = parentOf(p)) a.push(p); return a; };
const subtree = (k) => { const out = [k]; for (const c of LY.kids.get(k) || []) out.push(...subtree(c.key)); return out; };

/** Visible rows: nodes, with `<base>-<n>` sibling runs collapsed into one group row until expanded. */
export function rows() {
  revealSelected();
  const out = [];
  const walk = (parent, depth) => {
    const list = LY.kids.get(parent) || [], seen = new Set();
    for (const n of list) {
      if (n.group && list.filter((m) => m.group === n.group).length > 1) {
        if (seen.has(n.group)) continue;
        seen.add(n.group);
        const members = list.filter((m) => m.group === n.group), gid = `g:${parent || ''}:${n.group}`;
        const open = V.open.has(gid);
        out.push({ id: gid, group: true, key: members[0].key, keys: members.map((m) => m.key), label: n.group, text: `(${members.length})`, depth, open, hasKids: true });
        if (open) for (const m of members) rowFor(m, depth + 1);
        continue;
      }
      rowFor(n, depth);
    }
  };
  const rowFor = (n, depth) => {
    const has = (LY.kids.get(n.key) || []).length > 0, open = has && !V.closed.has(n.key);
    out.push({ id: n.key, group: false, key: n.key, keys: [n.key], label: n.key, text: n.label && n.label !== n.key ? n.label : '', depth, open, hasKids: has, box: n.kind === 'box' });
    if (open) walk(n.key, depth + 1);
  };
  walk(null, 0);
  for (const r of out) r.spans = unionSpans(r.keys);
  return out;
}
function unionSpans(keys) {
  const all = [];
  for (const k of keys) for (const s of LY.spans[k] || []) all.push(s);
  all.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of all) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], s[1]); else out.push([s[0], s[1]]); }
  return out;
}
function revealSelected() {
  const k = getSel()?.key;
  if (!k) { revealedFor = null; return; }
  if (!LY.byKey.has(k) || revealedFor === k) return;
  revealedFor = k;
  let changed = false;
  for (const a of ancestors(k)) if (V.closed.delete(a)) changed = true;
  for (const key of [k, ...ancestors(k)]) {
    const n = LY.byKey.get(key), parent = parentOf(key), gid = `g:${parent || ''}:${n.group}`;
    if (n.group && !V.open.has(gid) && (LY.kids.get(parent) || []).filter((m) => m.group === n.group).length > 1) { V.open.add(gid); changed = true; }
  }
  if (changed) { saveView(); queueMicrotask(() => emit('layers')); }
}
export const isTweaked = (keys) => keys.some((k) => S.draft.tweaks?.[k] || S.fileTweaks?.[k]);
export const rowSelected = (r) => { const k = getSel()?.key; return !!k && r.keys.includes(k); };
const hiddenDirect = (r) => r.keys.every((k) => V.hidden.has(k));
const hiddenInherited = (r) => !hiddenDirect(r) && r.keys.some((k) => ancestors(k).some((a) => V.hidden.has(a)));
const lockedDirect = (r) => r.keys.every((k) => V.locked.has(k));
const lockedInherited = (r) => !lockedDirect(r) && r.keys.some((k) => ancestors(k).some((a) => V.locked.has(a)));

// ---------- bridge ----------
async function loadTree() {
  const g = ++gen;
  clearTimeout(spanTimer);
  try {
    const res = await request('tree', {}, 15000);
    if (g !== gen || !liveOn()) return;
    buildTree(res); LY.ready = true; LY.spans = {}; spanSig = null;
    sendView(true);
    emit('layers');
    scheduleSpans(0);
  } catch (e) { if (g === gen) { console.warn('layers tree', e.message); LY.ready = false; emit('layers'); } }
}
function clearAll() {
  gen++; clearTimeout(spanTimer);
  LY.nodes = []; LY.byKey = new Map(); LY.kids = new Map(); LY.spans = {}; LY.ready = false; LY.mapping = false; spanSig = null; viewSent = '';
  setExtHover(null); revealedFor = scrolledFor = null;
  emit('layers');
}
const tweakSig = () => JSON.stringify(S.mode === 'draft' ? S.draft.tweaks || {} : {});
function scheduleSpans(ms = 800) {
  if (!liveOn() || !LY.ready) return;
  clearTimeout(spanTimer);
  spanTimer = setTimeout(runSpans, ms);
}
async function runSpans() {
  if (!liveOn() || !LY.ready) return;
  if (spanBusy || transport.playing) { spanTimer = setTimeout(runSpans, 600); return; }
  const sig = tweakSig(), g = gen;
  if (sig === spanSig) { emit('layer-spans', true); return; }
  spanBusy = true; LY.mapping = true; emit('layers');
  try {
    const res = await request('spans', {}, 120000);
    if (g === gen) { LY.spans = res?.spans || {}; spanSig = sig; }
  } catch (e) { console.warn('layers spans', e.message); if (g === gen) spanSig = sig; }
  spanBusy = false;
  if (g === gen) { LY.mapping = false; emit('layer-spans', tweakSig() === spanSig); emit('layers'); if (tweakSig() !== spanSig) scheduleSpans(); }
  else scheduleSpans(0);
}
const viewMsg = () => (V.hidden.size || V.solo ? { hidden: [...V.hidden], solo: V.solo } : {});
async function sendView(force = false) {
  if (!liveOn()) return;
  if (viewBusy) return;
  viewBusy = true;
  try {
    while (liveOn()) {
      const w = JSON.stringify(viewMsg());
      if (w === viewSent && !force) break;
      force = false; viewSent = w;
      await request('view', JSON.parse(w));
    }
  } catch (e) { console.warn('layers view', e.message); }
  viewBusy = false;
}

// ---------- lock filter for the picture ----------
function filterStack(stack) {
  if (!V.locked.size) return stack;
  const lockedKey = (k) => V.locked.has(k) || ancestors(k).some((a) => V.locked.has(a));
  const isBox = (e) => LY.byKey.get(e.key)?.kind === 'box';
  let cut = -1;
  stack.forEach((e, i) => { if (!isBox(e) && lockedKey(e.key)) cut = i; });
  return stack.filter((e, i) => isBox(e) ? !lockedKey(e.key) : i > cut);
}

// ---------- actions ----------
const changed = () => { saveView(); sendView(); emit('layers'); };
function toggleSet(set, keys, on_) { for (const k of keys) (on_ ? set.add(k) : set.delete(k)); }
function toggleHide(r, e) {
  if (e.altKey) { V.solo = V.solo === r.key ? null : r.key; return changed(); }
  toggleSet(V.hidden, r.keys, !hiddenDirect(r));
  changed();
}
function toggleLock(r) { toggleSet(V.locked, r.keys, !lockedDirect(r)); changed(); }
function toggleOpen(r) {
  if (r.group) { if (V.open.has(r.id)) V.open.delete(r.id); else V.open.add(r.id); } else if (V.closed.has(r.id)) V.closed.delete(r.id); else V.closed.add(r.id);
  saveView(); emit('layers');
}
export function toggleTimelineOpen() { LY.tlOpen = !LY.tlOpen; localStorage.setItem('gfx-studio.layers.tl', LY.tlOpen ? '1' : '0'); emit('layers'); }
/** Select a layer (from the tab or a timeline bar). */
export function selectLayer(key, t) {
  if (t != null) { if (transport.playing) pause(); ensureVisible(t); seek(t, { frame: true }); }
  return selectKey(key);
}
async function hoverRow(r, on_) {
  const my = ++hoverSeq;
  if (!on_ || !liveOn()) return setExtHover(null);
  try {
    const b = await request('bounds', { keys: r.keys });
    if (my !== hoverSeq) return;
    const bs = r.keys.map((k) => b?.[k]).filter(Boolean);
    if (!bs.length) return setExtHover(null);
    const x0 = Math.min(...bs.map((q) => q.x)), y0 = Math.min(...bs.map((q) => q.y));
    setExtHover({ x: x0, y: y0, w: Math.max(...bs.map((q) => q.x + q.w)) - x0, h: Math.max(...bs.map((q) => q.y + q.h)) - y0 });
  } catch { /* ignore */ }
}

// ---------- Layers tab ----------
const EYE = '<svg viewBox="0 0 16 16"><path d="M1.2 8S3.7 3.4 8 3.4 14.8 8 14.8 8 12.3 12.6 8 12.6 1.2 8 1.2 8z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="2.1"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16"><path d="M1.2 8S3.7 3.4 8 3.4 14.8 8 14.8 8 12.3 12.6 8 12.6 1.2 8 1.2 8z" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".35"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16"><rect x="3.6" y="7.2" width="8.8" height="6.2" rx="1.3"/><path d="M5.4 7.2V5.3a2.6 2.6 0 0 1 5.2 0v1.9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const UNLOCK = '<svg viewBox="0 0 16 16"><rect x="3.6" y="7.2" width="8.8" height="6.2" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".4"/><path d="M5.4 7.2V5.3a2.6 2.6 0 0 1 4.9-1.2" fill="none" stroke="currentColor" stroke-width="1.1" opacity=".4"/></svg>';

export function renderLayersTab(list) {
  if (!liveOn()) { list.innerHTML = '<div class="empty-list">Turn Live on (<kbd>L</kbd>) to see the scene\'s layers.</div>'; return; }
  if (!LY.ready) { list.innerHTML = '<div class="empty-list">Reading the scene tree…</div>'; return; }
  const rs = rows();
  if (!rs.length) { list.innerHTML = '<div class="empty-list">No named elements in this scene.<br>Name them with <code>data-gfx</code> or <code>ctx.el()</code>.</div>'; return; }
  const sel = getSel()?.key, scrollTop = list.scrollTop;
  const html = '<div class="ly-head"><span>Front to back</span>' + (LY.mapping ? '<span class="chip"><i class="spin"></i><span>mapping layers…</span></span>' : '') + `<span class="spacer"></span><span class="ly-hint">Alt+click eye: solo</span></div>`
    + rs.map((r) => {
      const hid = hiddenDirect(r), hidI = hiddenInherited(r), lk = lockedDirect(r), lkI = lockedInherited(r), solo = V.solo && r.keys.includes(V.solo);
      const tw = isTweaked(r.keys);
      return `<div class="lrow${hid || hidI ? ' off' : ''}${r.group ? ' grp' : ''}" data-id="${esc(r.id)}" title="${esc(r.group ? r.label + ' ' + r.text : r.key)}">
        <span class="ind" style="width:${r.depth * 14}px"></span>
        <button class="tw${r.hasKids ? '' : ' none'}" data-a="open" tabindex="-1">${r.hasKids ? (r.open ? '▾' : '▸') : ''}</button>
        <span class="ico ${r.box ? 'box' : r.group ? 'gp' : 'dom'}"></span>
        <span class="nm">${esc(r.label)}${r.text ? `<small>${esc(r.text)}</small>` : ''}</span>
        ${tw ? '<i class="dotc ly-dot" style="--c:var(--primary)" title="tweaked"></i>' : ''}
        <button class="ib eye${hid ? ' on' : ''}${hidI ? ' inh' : ''}${solo ? ' solo' : ''}" data-a="eye" tabindex="-1" title="${solo ? 'Soloed (Alt+click to clear)' : hid ? 'Show in the live view' : 'Hide in the live view (view only); Alt+click = solo'}">${hid || hidI ? EYE_OFF : EYE}</button>
        <button class="ib lock${lk ? ' on' : ''}${lkI ? ' inh' : ''}" data-a="lock" tabindex="-1" title="${lk ? 'Unlock (pick can select it)' : 'Lock (the picture can no longer pick it)'}">${lk || lkI ? LOCK : UNLOCK}</button>
      </div>`;
    }).join('');
  // Reconcile by row id so revealing groups on selection also preserves double-click targets.
  if (list._layersHTML !== html || !list.querySelector('.lrow')) {
    const fresh = document.createElement('div');
    fresh.innerHTML = html;
    const existing = new Map([...list.querySelectorAll('.lrow')].map((el) => [el.dataset.id, el]));
    const childKey = (el) => el.dataset.a || el.classList[0];
    const sync = (el, next) => {
      for (const a of [...el.attributes]) if (!next.hasAttribute(a.name)) el.removeAttribute(a.name);
      for (const a of next.attributes) el.setAttribute(a.name, a.value);
    };
    let cursor = list.firstElementChild;
    for (const next of [...fresh.children]) {
      const el = existing.get(next.dataset.id) || next;
      if (el !== next) {
        sync(el, next);
        const children = new Map([...el.children].map((c) => [childKey(c), c]));
        let childCursor = el.firstElementChild;
        for (const nc of [...next.children]) {
          const c = children.get(childKey(nc)) || nc;
          if (c !== nc) { sync(c, nc); if (c.innerHTML !== nc.innerHTML) c.innerHTML = nc.innerHTML; }
          if (c !== childCursor) el.insertBefore(c, childCursor);
          childCursor = c.nextElementSibling;
        }
        while (childCursor) { const c = childCursor; childCursor = c.nextElementSibling; c.remove(); }
      }
      if (el !== cursor) list.insertBefore(el, cursor);
      cursor = el.nextElementSibling;
    }
    while (cursor) { const el = cursor; cursor = el.nextElementSibling; el.remove(); }
    list._layersHTML = html;
  }
  list.scrollTop = scrollTop;
  const byId = new Map(rs.map((r) => [r.id, r]));
  for (const el of list.querySelectorAll('.lrow')) {
    const r = byId.get(el.dataset.id);
    el.classList.toggle('sel', rowSelected(r));
    el.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'open') return toggleOpen(r);
      if (a === 'eye') return toggleHide(r, e);
      if (a === 'lock') return toggleLock(r);
      selectLayer(r.key);
    };
    el.ondblclick = (e) => {
      if (e.target.closest('[data-a]')) return;
      const s = r.spans?.[0];
      if (s) { ensureVisible(s[0]); seek(s[0], { frame: true }); } else emit('toast', { m: 'No visible span mapped for this layer yet', ms: 1600 });
    };
    el.onmouseenter = () => hoverRow(r, true);
    el.onmouseleave = () => hoverRow(r, false);
  }
  if (sel && scrolledFor !== sel) {
    scrolledFor = sel;
    list.querySelector('.lrow.sel')?.scrollIntoView({ block: 'nearest' });
  } else if (!sel) scrolledFor = null;
}

export function initLayers() {
  setPickFilter(filterStack);
  on('scene', () => { loadView(); clearAll(); if (liveOn()) loadTree(); });
  on('live-ready', () => { loadView(); loadTree(); });
  on('live', () => { if (!L.on || !L.ready) { if (LY.ready || LY.nodes.length) clearAll(); } });
  on('draft', () => scheduleSpans());
  on('mode', () => scheduleSpans());
  on('live-tweaks-applied', () => { if (liveOn()) loadTree(); });
  on('el-select', () => emit('layers'));
  loadView();
}
