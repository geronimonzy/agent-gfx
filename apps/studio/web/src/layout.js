// Dockable layout (docs/LAYOUT.md): dockview-core around the studio's panel elements. Each panel element is created once
// (index.html, #panel-holder) and moved, never recreated: the video, canvases, CodeMirror, xterm and listeners keep their
// state. Review / Code each keep a layout (localStorage gfx.layout.v1.<mode>). Compact headers (§3a), per-panel
// scale and whole-UI zoom (§4), pop-out windows (§5).
import { createDockview, themeDark } from 'dockview-core/dist/dockview-core.js';
import { $, registerRoot, registerDoc, unregisterDoc, allDocs } from './dom.js';
import { on, emit, esc } from './store.js';
import { installKeysOn } from './keys.js';
import { openMenu } from './menu.js';
import { pref, setPref } from './prefs.js';
import { transport } from './transport.js';

const SCHEMA = 1;
const keyOf = (mode) => `gfx.layout.v${SCHEMA}.${mode}`;
export const SCALES = [0.8, 0.9, 1, 1.15, 1.3, 1.5];
export const UI_ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/** Panel id -> element id in index.html. fixed = can't be closed; noScale = no per-panel scale (own fit/zoom). */
export const PANELS = {
  viewer: { title: 'Viewer', el: 'viewer', fixed: true, noScale: true, renderer: 'always' },
  timeline: { title: 'Timeline', el: 'timeline', fixed: true },
  inspector: { title: 'Inspector', el: 'inspector' },
  side: { title: 'Comments & Layers', el: 'side' },
  terminal: { title: 'Terminal', el: 'terminal' },
  render: { title: 'Render', el: 'render', transient: true },
  'code-files': { title: 'Files', el: 'code-left' },
  'code-editor': { title: 'Editor', el: 'code-main' },
  'code-refs': { title: 'Code links', el: 'code-refs' },
  t3: { title: 'T3', el: 't3' }, // threads + the native T3 view (docs/T3.md §4)
};
/** Panels offered in each mode (Panels menu); the rest stay in the holder. */
export const MODE_PANELS = {
  review: ['viewer', 'timeline', 'inspector', 'side', 'terminal', 't3'],
  code: ['code-files', 'code-editor', 'viewer', 'code-refs', 'timeline', 'inspector', 'side', 'terminal', 't3'],
};

let api = null, holder = null, host = null;
let mode = null, applying = 0, saveTimer = 0, showHeaders = false, uiZoom = 1;
const els = {};          // panel id -> its element (refs, never getElementById: popouts move them to another document)
const wrappers = new Map(); // panel id -> dock wrapper element (carries the per-panel CSS zoom)
window.addEventListener('theme', () => {
  for (const w of popWins.keys()) w.document.documentElement.dataset.theme = document.documentElement.dataset.theme;
});
const popWins = new Map();  // window -> { label }
let gseq = 0;

// ---------- panel content renderers ----------
function contentRenderer(id) {
  const wrap = document.createElement('div');
  wrap.className = 'gfx-panel';
  wrap.dataset.panel = id;
  return {
    element: wrap,
    init(p) {
      const el = els[id];
      if (el) { wrap.appendChild(el); el.classList.add('in-dock'); }
      wrappers.set(id, wrap);
      applyScale(id, p?.params?.scale);
    },
    // reuseExistingPanels: a restored layout calls update() (not init()) on the live renderer
    update(e) { applyScale(id, e?.params?.scale); },
    dispose() {
      const el = els[id];
      if (el && el.parentElement === wrap) holder.appendChild(el);
      if (wrappers.get(id) === wrap) wrappers.delete(id);
    },
  };
}

class Tab {
  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'gfx-tab';
    this.element.innerHTML = '<i class="gfx-grip" aria-hidden="true"></i><span class="gfx-tab-t"></span><button type="button" class="gfx-tab-x" title="Close panel">&times;</button>';
  }
  init(params) {
    this.api = params.api;
    const id = this.api.id;
    this.element.dataset.panel = id;
    this.element.querySelector('.gfx-tab-t').textContent = params.title || PANELS[id]?.title || id;
    const x = this.element.querySelector('.gfx-tab-x');
    if (PANELS[id]?.fixed) x.remove();
    else {
      x.addEventListener('pointerdown', (e) => e.stopPropagation());
      x.addEventListener('click', (e) => { e.stopPropagation(); hidePanel(id); });
    }
    this.element.addEventListener('auxclick', (e) => { if (e.button === 1 && !PANELS[id]?.fixed) { e.preventDefault(); hidePanel(id); } });
    this.element.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); openPanelMenu(id, e); });
    this.sub = this.api.onDidTitleChange?.((ev) => { this.element.querySelector('.gfx-tab-t').textContent = ev.title; });
  }
  dispose() { this.sub?.dispose?.(); }
}

class HeaderActions {
  constructor(group) {
    this.group = group;
    this.element = document.createElement('div');
    this.element.className = 'gfx-head-actions';
    this.element.innerHTML = '<button type="button" class="gfx-more" title="Panel menu: scale, pop out, close">&#8943;</button>';
    const b = this.element.firstChild;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); const p = this.group.activePanel; if (p) openPanelMenu(p.id, b); });
  }
  init() {}
  dispose() {}
}

// ---------- default layouts (serialized dockview JSON, so a reset reuses the live panels instead of re-creating them) ----------
const leaf = (views, size, active) => ({ type: 'leaf', data: { id: `g${Date.now().toString(36)}${gseq++}`, views, activeView: active || views[0] }, size: Math.round(size) });
const branch = (size, data) => ({ type: 'branch', data, size: Math.round(size) });
const panelState = (id) => ({ id, contentComponent: id, tabComponent: 'gfx', title: PANELS[id].title, params: {}, ...(PANELS[id].renderer ? { renderer: PANELS[id].renderer } : {}) });
export function defaultLayout(m) {
  const W = Math.max(900, api?.width || innerWidth), H = Math.max(500, api?.height || innerHeight - 40);
  const tlH = Math.max(150, Math.min(340, H - 260));
  const top = H - tlH;
  let row, ids;
  if (m === 'code') {
    const vw = Math.min(520, Math.max(300, W * 0.3)), fw = 280;
    row = [leaf(['code-files'], fw), leaf(['code-editor'], W - fw - vw), branch(vw, [leaf(['viewer'], top * 0.66), leaf(['code-refs'], top * 0.34)])];
    ids = ['code-files', 'code-editor', 'viewer', 'code-refs'];
  } else {
    const iw = 292, rw = 320;
    row = [leaf(['inspector'], iw), leaf(['viewer'], W - iw - rw), leaf(['side'], rw)];
    ids = ['inspector', 'viewer', 'side'];
  }
  ids.push('timeline', 'terminal', 't3');
  return {
    grid: { root: branch(W, [branch(top, row), leaf(['timeline', 'terminal', 't3'], tlH, 'timeline')]), width: W, height: H, orientation: 'VERTICAL' },
    panels: Object.fromEntries(ids.map((id) => [id, panelState(id)])),
  };
}

// ---------- load / save ----------
function stored(m) {
  try {
    const j = JSON.parse(localStorage.getItem(keyOf(m)) || 'null');
    return j && j.v === SCHEMA && j.dock?.grid ? j : null;
  } catch { return null; }
}
/** Pop-out windows are not re-opened on start / mode switch: their panels are saved back into the (hidden) grid group
 *  they came from, so they return to their docked spot. */
export function foldPopouts(dock) {
  const leaves = [];
  const walk = (n) => { if (!n) return; if (n.type === 'leaf') leaves.push(n); else for (const c of n.data || []) walk(c); };
  walk(dock.grid?.root);
  for (const pg of dock.popoutGroups || []) {
    const views = [], subs = [];
    if (pg.data) views.push(...(pg.data.views || []));
    if (pg.grid) { const w2 = (n) => { if (n.type === 'leaf') subs.push(n); else for (const c of n.data || []) w2(c); }; w2(pg.grid.root); for (const l of subs) views.push(...(l.data?.views || [])); }
    const ref = leaves.find((l) => l.data?.id === pg.gridReferenceGroup);
    if (ref) {
      ref.data.views = [...(ref.data.views || []), ...views.filter((v) => !(ref.data.views || []).includes(v))];
      ref.data.activeView = ref.data.activeView || pg.data?.activeView || views[0];
      delete ref.visible;
    } else for (const v of views) delete dock.panels?.[v]; // nowhere to go: the panel is simply not in the layout
  }
  delete dock.popoutGroups;
  return dock;
}
function serialize() {
  return { v: SCHEMA, dock: foldPopouts(api.toJSON()) };
}
function save() {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!mode || applying || !api) return;
  try { localStorage.setItem(keyOf(mode), JSON.stringify(serialize())); } catch { /* quota */ }
}
const saveSoon = () => { if (!applying) { clearTimeout(saveTimer); saveTimer = setTimeout(save, 250); } };

function load(json) {
  applying++;
  try { api.fromJSON(json, { reuseExistingPanels: true }); }
  finally { applying--; }
}
function apply(m) {
  const st = stored(m);
  showHeaders = !!pref('showHeaders'); // a machine setting (Settings → Appearance), no longer per layout
  let ok = false;
  if (st) { try { load(st.dock); ok = true; } catch (e) { console.warn('[layout] saved layout rejected, using the default', e); } }
  if (!ok) load(defaultLayout(m));
  ensureRequired();
  // stale ids (also panels that no longer exist, e.g. 'perform' in a layout saved before 2026-10-19: dropped here)
  for (const p of [...api.panels]) if (!MODE_PANELS[m].includes(p.id) && !(p.id === 'render' && !els.render.hidden)) p.api.close();
  if (api.getPanel('render') && els.render.hidden) api.getPanel('render').api.close(); // a closed Render dialog saved with the layout
  refreshGroups();
  emit('dock-moved');
}
/** Viewer and timeline always exist (they can't be closed; a dropped pop-out puts them back). */
function ensureRequired() {
  if (!api.getPanel('viewer')) addAt('viewer');
  if (!api.getPanel('timeline')) addAt('timeline');
}

export function setMode(m) {
  if (!api || !MODE_PANELS[m] || m === mode) return;
  if (mode) save();
  mode = m;
  apply(m);
  syncMenu();
}
export const currentMode = () => mode;
export function resetLayout() {
  if (!api) return;
  localStorage.removeItem(keyOf(mode));
  load(defaultLayout(mode));
  ensureRequired();
  if (!els.render.hidden) showPanel('render');
  refreshGroups();
  save();
  emit('dock-moved');
  window.dispatchEvent(new Event('resize'));
}

// ---------- show / hide panels ----------
const present = (id) => !!api?.getPanel(id);
/** Where a panel goes when it is (re)opened: next to a related panel, else an edge. */
function placement(id) {
  const has = (x) => present(x);
  const first = (...xs) => xs.find(has);
  const within = (ref) => ({ position: { referencePanel: ref, direction: 'within' } });
  const side = (ref, direction, size) => ({ position: { referencePanel: ref, direction }, ...size });
  switch (id) {
    case 'render': case 'side': {
      const r = first('render', 'side', 'code-refs');
      return r ? within(r) : side(first('viewer', 'code-editor'), 'right', { initialWidth: id === 'render' ? 372 : 320 });
    }
    case 'terminal': case 't3': return has('timeline') ? within('timeline') : { position: { direction: 'below' }, initialHeight: 300 };
    case 'timeline': return { position: { direction: 'below' }, initialHeight: 340 };
    case 'inspector': return side(first('code-files', 'viewer', 'code-editor'), first('code-files') ? 'below' : 'left', { initialWidth: 292 });
    case 'code-files': return side(first('code-editor', 'viewer'), 'left', { initialWidth: 280 });
    case 'code-editor': return has('code-files') ? side('code-files', 'right') : side('viewer', 'left', { initialWidth: 600 });
    case 'code-refs': return has('viewer') ? side('viewer', 'below', { initialHeight: 220 }) : { position: { direction: 'right' }, initialWidth: 360 };
    case 'viewer': return has('code-editor') ? side('code-editor', 'right', { initialWidth: 440 }) : has('inspector') ? side('inspector', 'right') : { position: { direction: 'above' } };
    default: return {};
  }
}
function addAt(id, { inactive = false } = {}) {
  const pl = placement(id);
  // the related panel may be missing from this layout: fall back to an edge of the dock
  if (pl.position && 'referencePanel' in pl.position && !pl.position.referencePanel) pl.position = { direction: 'right' };
  return api.addPanel({ id, component: id, tabComponent: 'gfx', title: PANELS[id].title, params: {}, renderer: PANELS[id].renderer, inactive, ...pl });
}
/** Show a panel in the current layout (adds it next to a related panel) and make it the active tab. */
export function showPanel(id, { focus = false } = {}) {
  if (!api || !PANELS[id]) return null;
  let p = api.getPanel(id);
  if (!p) p = addAt(id);
  else p.api.setActive();
  if (focus) els[id]?.focus?.();
  refreshGroups();
  return p;
}
export function hidePanel(id) {
  const p = api?.getPanel(id);
  if (!p || PANELS[id]?.fixed) return false;
  p.api.close();
  return true;
}
export const isShown = (id) => present(id);
/** In the layout and the active tab of its group (not behind another tab). */
export function isVisible(id) { const p = api?.getPanel(id); return !!p && p.api.isVisible; }
export function togglePanel(id) { if (present(id)) hidePanel(id); else showPanel(id); }
/** Ctrl+` from a focused terminal: bring back the tab that was in front before it (the timeline in the default layout). */
export function leavePanel(id) {
  const p = api?.getPanel(id);
  if (!p) return;
  const g = p.group, other = g.panels.find((x) => x.id !== id && x.id === 'timeline') || g.panels.find((x) => x.id !== id);
  if (other) other.api.setActive();
}
export const panelOf = (id) => api?.getPanel(id) || null;
export const panelDoc = (id) => (els[id]?.ownerDocument) || document;

// ---------- per-panel scale ----------
export const getScale = (id) => +(api?.getPanel(id)?.params?.scale) || 1;
function applyScale(id, s) {
  const w = wrappers.get(id);
  if (!w) return;
  s = +s || 1;
  w.style.zoom = s === 1 ? '' : String(s);
  w.dataset.scale = s;
}
export function setScale(id, s) {
  const p = api?.getPanel(id);
  if (!p || PANELS[id]?.noScale) return;
  s = SCALES.includes(+s) ? +s : 1;
  p.api.updateParameters({ ...(p.params || {}), scale: s });
  applyScale(id, s);
  emit('panel-scale', { id, scale: s });
  window.dispatchEvent(new Event('resize'));
  save();
}

// ---------- compact headers (§3a) ----------
function refreshGroups() {
  if (!api) return;
  for (const g of api.groups) {
    const el = g.element;
    const single = g.panels.length <= 1;
    el.classList.toggle('gfx-compact', !showHeaders && single);
    el.classList.toggle('gfx-tabs', showHeaders || !single);
    const ap = g.activePanel;
    if (ap) el.dataset.panel = ap.id;
  }
  host?.classList.toggle('gfx-all-headers', showHeaders);
}
export function setShowHeaders(v) { showHeaders = !!v; refreshGroups(); save(); syncMenu(); setPref('showHeaders', showHeaders, 'machine').catch((e) => emit('toast', { m: String(e.message || e), ms: 4000 })); }
export const headersShown = () => showHeaders;
// Dockview's pointer drag backend emits no dragend/drop for internal moves, so end the state on pointer completion / cancel.
// (Mouse uses native HTML5 DnD, which ends with dragend/drop and fires a pointercancel at its start that must be ignored;
// touch / pen use the pointer backend, which ends with pointerup / pointercancel.)
let dragEnders = [], nativeDrag = false;
const markNative = () => { nativeDrag = true; };
function endDrag() {
  nativeDrag = false;
  for (const [d, t, f] of dragEnders) { try { d.removeEventListener(t, f, true); } catch { /* doc gone */ } }
  dragEnders = [];
  onDragState(false);
}
export const setDragState = (on_) => (on_ ? onDragState(true) : endDrag()); // test hook
function onDragState(on_) {
  for (const d of allDocs()) d.body?.classList.toggle('gfx-dragging', on_);
  if (on_ && !dragEnders.length) {
    for (const d of allDocs()) {
      for (const t of ['pointerup', 'pointercancel', 'dragend', 'drop', 'keydown', 'blur']) {
        const native = t === 'dragend' || t === 'drop';
        const f = t === 'keydown' ? (e) => { if (e.key === 'Escape') setTimeout(endDrag, 0); }
          : () => setTimeout(() => { if (native || !nativeDrag) endDrag(); }, 0);
        const target = t === 'blur' ? d.defaultView : d;
        if (target) { target.addEventListener(t, f, true); dragEnders.push([target, t, f]); }
      }
    }
  }
}

// ---------- pop-out windows (§5) ----------
const tauri = () => window.__TAURI__;
function wireDoc(doc) {
  if (!doc || doc === document) return;
  doc.documentElement.dataset.theme = document.documentElement.dataset.theme || 'dark';
  doc.documentElement.dataset.density = 'dense';
  registerDoc(doc);
  installKeysOn(doc);
  const w = doc.defaultView;
  if (w && !w.__gfxWired) {
    w.__gfxWired = true;
    // the live bridge iframe posts to its parent (this popout): hand its messages to the main window's listeners
    w.addEventListener('message', (e) => { window.dispatchEvent(new MessageEvent('message', { data: e.data, origin: e.origin, source: e.source })); });
    for (const t of ['dragstart']) doc.addEventListener(t, () => { markNative(); onDragState(true); }, true);
    for (const t of ['dragend', 'drop']) doc.addEventListener(t, () => endDrag(), true);
    doc.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    if (!tauri() && uiZoom !== 1) doc.documentElement.style.zoom = String(uiZoom);
  }
}
export async function popout(id) {
  const p = api?.getPanel(id);
  if (!p) return false;
  if (p.api.location?.type === 'popout') return true;
  const r = els[id]?.getBoundingClientRect();
  const ok = await api.addPopoutGroup(p, {
    popoutUrl: './popout.html',
    position: r && r.width ? { left: window.screenX + r.left, top: window.screenY + r.top, width: Math.max(420, r.width), height: Math.max(260, r.height) } : undefined,
    onDidOpen: ({ window: w }) => { popWins.set(w, {}); wireDoc(w.document); },
    onWillClose: ({ window: w }) => {
      popWins.delete(w);
      unregisterDoc(w?.document);
      // window.close() from the opener does not destroy a Tauri-created window: close it natively by label
      const label = w?.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
      if (label && tauri()) setTimeout(() => tauri().core.invoke('close_popout', { label }).catch(() => {}), 50);
    },
  });
  if (ok) {
    const w = p.api.getWindow?.() || p.group.api.getWindow?.();
    if (w && w !== window) wireDoc(w.document);
    if (tauri() && w && w !== window) zoomPopouts();
  }
  refreshGroups();
  emit('dock-moved');
  return ok;
}
/** Put a popped-out panel back into the main window: close its window, dockview restores the group where it was. */
export function dockBack(id) {
  const p = api?.getPanel(id);
  if (!p || p.api.location?.type !== 'popout') return;
  const w = p.api.getWindow?.() || p.group.api.getWindow?.();
  if (!w || w === window) return;
  const label = w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  if (label && tauri()) tauri().core.invoke('close_popout', { label }).catch(() => w.close());
  else w.close();
}
export const popoutWindows = () => [...popWins.keys()];

// The <video> reloads when it is adopted into another document (pop out / dock back): put the time and play state back.
function watchVideo() {
  const v = els.viewer?.querySelector('video');
  if (!v) return;
  let src = '';
  v.addEventListener('loadeddata', () => {
    const same = src && v.currentSrc === src;
    src = v.currentSrc;
    if (!same || !v.__gfxMoved) return;
    v.__gfxMoved = false;
    v.currentTime = Math.min(v.duration || Infinity, transport.time() + (transport.playing ? 0.05 : 0));
    if (transport.playing) v.play().catch(() => {});
  });
  v.addEventListener('emptied', () => { if (src && v.currentSrc === src) v.__gfxMoved = true; });
}

// ---------- whole-UI zoom (§4) ----------
export const uiZoomLevel = () => uiZoom;
async function applyUiZoom() {
  const t = tauri();
  if (t?.webview?.getCurrentWebview) {
    try { await t.webview.getCurrentWebview().setZoom(uiZoom); } catch (e) { console.warn('setZoom', e); }
    zoomPopouts();
  } else {
    for (const d of allDocs()) d.documentElement.style.zoom = uiZoom === 1 ? '' : String(uiZoom);
  }
  emit('panel-scale', { id: '*', scale: uiZoom });
  window.dispatchEvent(new Event('resize'));
}
async function zoomPopouts() {
  const t = tauri();
  if (!t?.webview?.getAllWebviews) return;
  try { for (const wv of await t.webview.getAllWebviews()) if (wv.label !== 'main' && wv.label !== 't3view') await wv.setZoom(uiZoom); } catch { /* best effort */ }
}
export function zoomUi(dir) {
  const i = UI_ZOOMS.findIndex((z) => Math.abs(z - uiZoom) < 1e-3);
  const cur = i >= 0 ? i : UI_ZOOMS.indexOf(1);
  uiZoom = dir === 0 ? 1 : UI_ZOOMS[Math.max(0, Math.min(UI_ZOOMS.length - 1, cur + Math.sign(dir)))];
  setPref('uiZoom', uiZoom, 'machine').catch((e) => emit('toast', { m: String(e.message || e), ms: 4000 })); // Settings → Appearance
  applyUiZoom();
  emit('toast', { m: `UI scale ${Math.round(uiZoom * 100)} %`, ms: 1200 });
  syncMenu();
  return uiZoom;
}

// ---------- menus (menu.js) ----------
export { closeMenu, menuOpen } from './menu.js';
function panelMenuItems(id) {
  const p = api.getPanel(id);
  if (!p) return [];
  const items = [];
  if (!PANELS[id].noScale) {
    const cur = getScale(id);
    items.push({ label: 'Scale', chips: SCALES.map((s) => ({ label: `${Math.round(s * 100)}`, title: `${Math.round(s * 100)} %`, value: s, on: Math.abs(s - cur) < 1e-3, run: () => setScale(id, s) })) });
    items.push({ sep: true });
  }
  if (p.api.location?.type === 'popout') items.push({ id: 'dock-back', label: 'Back to the main window', run: () => dockBack(id) });
  else items.push({ id: 'popout', label: 'Pop out to a window', run: () => popout(id) });
  if (!PANELS[id].fixed) items.push({ id: 'close', label: `Close ${PANELS[id].title}`, run: () => hidePanel(id) });
  return items;
}
export function openPanelMenu(id, anchor) { if (api?.getPanel(id)) openMenu(anchor, panelMenuItems(id)); }

function focusedPanel() {
  const ap = api?.activePanel;
  return ap && MODE_PANELS[mode]?.includes(ap.id) ? ap.id : 'viewer';
}
export function openPanelsMenu(anchor = $('app-menu-btn')) {
  if (!api) return;
  const items = MODE_PANELS[mode].map((id) => ({
    id: `panel:${id}`, label: PANELS[id].title, checked: present(id), disabled: PANELS[id].fixed, run: () => togglePanel(id),
  }));
  const fp = focusedPanel();
  items.push({ sep: true });
  items.push({ id: 'popout', label: `Pop out: ${PANELS[fp].title}`, run: () => popout(fp) });
  items.push({ id: 'headers', label: 'Show all headers', checked: showHeaders, run: () => setShowHeaders(!showHeaders) });
  items.push({ id: 'reset', label: `Reset layout (${mode[0].toUpperCase() + mode.slice(1)})`, run: resetLayout });
  items.push({ sep: true });
  items.push({ label: 'UI scale', keep: true, chips: [
    { label: '−', title: 'Smaller (Ctrl+-)', value: 'out', run: () => zoomUi(-1) },
    { label: `${Math.round(uiZoom * 100)} %`, title: 'Reset (Ctrl+0)', value: 'reset', run: () => zoomUi(0) },
    { label: '+', title: 'Larger (Ctrl+=)', value: 'in', run: () => zoomUi(1) },
  ] });
  openMenu(anchor, items);
}
function syncMenu() {
  const b = $('app-menu-btn');
  if (b) b.title = `gfx studio menu · UI scale ${Math.round(uiZoom * 100)} %`;
}

// ---------- init ----------
export function initLayout() {
  host = $('stage'); holder = $('panel-holder');
  for (const [id, p] of Object.entries(PANELS)) { els[id] = $(p.el); if (els[id]) registerRoot(els[id]); }
  api = createDockview(host, {
    theme: { ...themeDark, name: 'gfx' },
    popoutUrl: './popout.html',
    defaultTabComponent: 'gfx',
    keyboardNavigation: false,
    createComponent: ({ id }) => contentRenderer(id),
    createTabComponent: ({ name }) => (name === 'gfx' ? new Tab() : undefined),
    createRightHeaderActionComponent: (group) => new HeaderActions(group),
  });
  host.classList.add('gfx-dock');
  api.onDidLayoutChange(() => { refreshGroups(); saveSoon(); });
  api.onDidAddPanel((p) => { refreshGroups(); if (!applying) emit('layout-panel', { id: p.id, shown: true }); });
  api.onDidRemovePanel((p) => { refreshGroups(); emit('layout-panel', { id: p.id, shown: false }); });
  api.onDidMovePanel?.(() => { refreshGroups(); emit('dock-moved'); });
  api.onDidActivePanelChange?.(() => refreshGroups());
  api.onWillDragPanel?.(() => onDragState(true));
  api.onWillDragGroup?.(() => onDragState(true));
  api.onDidDrop?.(() => endDrag());
  api.onDidRemovePopoutGroup?.(() => { refreshGroups(); emit('dock-moved'); setTimeout(() => window.dispatchEvent(new Event('resize')), 50); });
  document.addEventListener('dragstart', markNative, true);
  document.addEventListener('dragend', () => endDrag(), true);
  document.addEventListener('drop', () => endDrag(), true);
  watchVideo();
  uiZoom = +pref('uiZoom') || 1; // Settings → Appearance (settings.json)
  if (!UI_ZOOMS.some((z) => Math.abs(z - uiZoom) < 1e-3)) uiZoom = 1;
  if (uiZoom !== 1) applyUiZoom();
  // changed on the Settings page: apply here (the menu / keys write the setting themselves)
  on('prefs', ({ keys } = {}) => {
    if (keys?.includes('uiZoom') && Math.abs((+pref('uiZoom') || 1) - uiZoom) > 1e-3) { uiZoom = +pref('uiZoom') || 1; applyUiZoom(); syncMenu(); }
    if (keys?.includes('showHeaders') && !!pref('showHeaders') !== showHeaders) { showHeaders = !!pref('showHeaders'); refreshGroups(); save(); syncMenu(); }
  });
  try { localStorage.removeItem(keyOf('perform')); localStorage.removeItem('gfx-studio.perform'); } catch { /* removed mode (2026-10-19) */ }
  setMode('review');
  on('mode-ui', () => setMode(document.body.classList.contains('mode-code') ? 'code' : 'review'));
  window.addEventListener('beforeunload', save);
  syncMenu();
}

export const dock = () => api;
