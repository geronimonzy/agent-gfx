// Code workspace (docs/CODE-VERSIONS.md §3): top-bar mode Code = file tree (left) · CodeMirror editor with tabs (centre) ·
// picture + transport (right, smaller) · timeline stays at the bottom. Saves go through write_project_file (scenes/**,
// style/**, *.md, gfx.json) and the live server reloads the scene. Open files are polled (1 s) for changes on disk.
// Element <-> code: refs from the bridge (`code {key}`), cursor line -> `codeAt` outlines, animated refs -> timeline band.
import * as api from './api.js';
import { S, on, emit, esc, duration } from './store.js';
import { L, liveOn, request, toggleLive, setCodeOutlines, selectKey } from './live.js';
import { seek } from './transport.js';
import { ensureVisible } from './timeline.js';
import { isSourceWritable } from './source-guard.js';
import { showDiff } from './diff.js';

import { $ } from './dom.js';
import { pref, setPref } from './prefs.js';
export const C = {
  on: false, files: [], truncated: false, engineRepo: false, tabs: [], active: null, view: null,
  open: new Set(), errors: new Map(), lastError: null, writing: new Set(), external: null,
  autoSave: false, leftTab: 'files', // autoSave: Settings → Code & versions (prefs.js), applied on 'prefs'
};
let cm = null, cmP = null, pollTimer = 0, polling = false, filesTimer = 0, autoTimer = 0, atTimer = 0, atSig = '';
const refsSeq = new WeakMap();
const loadCm = async () => (cm ||= await (cmP ||= import('./cm.js')));
const TEXT_EXT = /\.(js|mjs|cjs|jsx|ts|css|json|md|markdown|html|htm|svg|txt|glsl|frag|vert|yml|yaml|csv|toml)$/i;
const ENGINE_REF = ['runner/player/core.js', 'runner/lib/style.js', 'runner/lib/ease.js', 'runner/lib/tween.js', 'runner/lib/rng.js', 'runner/lib/sfx.js'];
const toast = (m, ms = 2200) => emit('toast', { m, ms });
export const codeOn = () => C.on;
export const codeDirty = () => C.tabs.some((t) => t.dirty);
const textOf = (tab) => (tab === C.active && C.view ? C.view.state : tab.state).doc.toString();

// ---------- mode ----------
export async function setCode(on_) {
  on_ = !!on_;
  if (on_ === C.on) return;
  C.on = on_;
  localStorage.setItem('gfx-studio.code', on_ ? '1' : '0');
  document.body.classList.toggle('mode-code', on_);
  emit('mode-ui');
  if (on_) {
    await ensureView();
    await refreshFiles({ force: true });
    if (!C.tabs.length && S.name) openDefault();
    if (S.name && !L.on) toggleLive(); // the picture is the live scene: element <-> code links need the bridge
    syncLeft();
    renderRefs($('code-refs'), L.sel?.key || null);
  } else { closeObjectCode(); setCodeOutlines([]); setBand(null); }
  window.dispatchEvent(new Event('resize'));
}
function openDefault() {
  const p = `scenes/${S.name}/scene.js`;
  if (C.files.some((f) => f.path === p)) openFile(p).catch((e) => toast('Open failed: ' + (e.message || e), 4000));
}

// ---------- files / tree ----------
export async function refreshFiles({ force = false } = {}) {
  let same = false;
  try {
    const r = await api.listProjectFiles();
    const files = r?.files || [], sig = files.map((f) => `${f.path}|${f.writable ? 1 : 0}`).join('\n');
    same = sig === C.filesSig && C.files.length > 0; // the 6 s refresh only re-renders the tree when the list changed
    C.filesSig = sig;
    C.files = files; C.truncated = !!r?.truncated;
    C.engineRepo = C.files.some((f) => f.path === 'runner/cli.js') && C.files.some((f) => f.path === 'runner/player/bridge.js');
  } catch (e) { console.warn('list_project_files', e); }
  if (S.name && !C.open.has('init:' + S.name)) { same = false; C.open.add('init:' + S.name); C.open.add('scenes'); C.open.add(`scenes/${S.name}`); C.open.add('style'); }
  if (!same || force) renderTree();
}
function tree(files) {
  const root = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts.slice(0, i + 1).join('/');
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { path: k, dirs: new Map(), files: [] });
      n = n.dirs.get(parts[i]);
    }
    n.files.push(f);
  }
  return root;
}
const ICON_C = { js: 'var(--warning-foreground)', mjs: 'var(--warning-foreground)', css: 'var(--info-foreground)', json: 'var(--stem-hits)', md: 'var(--primary-text)', html: 'var(--error-foreground)' };
function treeHtml(n, depth, prefix = '') {
  let h = '';
  for (const [name, d] of [...n.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
    const id = prefix + d.path, open = C.open.has(id);
    h += `<div class="ft-row ft-dir${open ? ' open' : ''}" data-dir="${esc(id)}" style="--d:${depth}"><i class="ft-caret"></i><span>${esc(name)}</span></div>`;
    if (open) h += treeHtml(d, depth + 1, prefix);
  }
  for (const f of n.files) {
    const p = prefix + f.path, name = f.path.split('/').pop(), ext = name.split('.').pop().toLowerCase();
    const tab = C.tabs.find((t) => t.path === p);
    h += `<div class="ft-row ft-file${C.active?.path === p ? ' on' : ''}${f.writable === false || prefix ? ' ro' : ''}" data-file="${esc(p)}" style="--d:${depth}" title="${esc(p)}${f.writable === false || prefix ? ' (read-only)' : ''}"><i class="ft-dot" style="--c:${ICON_C[ext] || 'var(--muted-foreground)'}"></i><span>${esc(name)}</span>${tab?.dirty ? '<b class="ft-dirty" title="unsaved"></b>' : ''}${errCount(p) ? '<b class="ft-err" title="error in the live scene"></b>' : ''}</div>`;
  }
  return h;
}
const errCount = (p) => (C.errors.get(p) || []).length;
function section(id, label, inner, defOpen) {
  const open = C.open.has(id) || (defOpen && !C.open.has('closed:' + id));
  return `<div class="ft-sec${open ? ' open' : ''}" data-sec="${esc(id)}" data-def="${defOpen ? 1 : 0}"><i class="ft-caret"></i>${label}</div>${open ? inner : ''}`;
}
export function renderTree() {
  const host = $('code-tree');
  if (!host) return;
  const mine = C.files.filter((f) => f.writable), other = C.files.filter((f) => !f.writable);
  const eng = C.engineRepo ? [] : ENGINE_REF.map((p) => ({ path: p, writable: false }));
  host.innerHTML = section('sec:project', `Project <small>${mine.length}</small>`, treeHtml(tree(mine), 1), true)
    + (other.length ? section('sec:other', `${C.engineRepo ? 'Engine &amp; other files' : 'Other files'} <small>read-only</small>`, treeHtml(tree(other), 1), false) : '')
    + (eng.length ? section('sec:engine', 'Engine <small>read-only, reference</small>', treeHtml(tree(eng), 1, 'engine:'), false) : '')
    + (C.truncated ? '<div class="ft-note">List truncated (5000 files)</div>' : '')
    + (C.files.length ? '' : '<div class="empty-list">No project files.</div>');
}
function onTreeClick(e) {
  const sec = e.target.closest('.ft-sec'), dir = e.target.closest('.ft-dir'), file = e.target.closest('.ft-file');
  if (sec) {
    const id = sec.dataset.sec, def = sec.dataset.def === '1', open = sec.classList.contains('open');
    if (def) { if (open) C.open.add('closed:' + id); else C.open.delete('closed:' + id); } else if (open) C.open.delete(id); else C.open.add(id);
    renderTree();
  } else if (dir) {
    const id = dir.dataset.dir;
    if (C.open.has(id)) C.open.delete(id); else C.open.add(id);
    renderTree();
  } else if (file) openFile(file.dataset.file).catch((err) => toast('Open failed: ' + (err.message || err), 4000));
}

// ---------- editor / tabs ----------
async function ensureView() {
  await loadCm();
  if (C.view) return;
  const host = $('code-editor');
  C.view = cm.createView(host, cm.makeState('empty.txt', '', { readOnly: true }));
  renderTabs(); renderStatus();
}
async function readEngine(p) {
  let url = L.url;
  if (!url) url = (await api.serverStatus()).url;
  if (!url) throw new Error('engine files are read through the live server: turn Live on (L) first');
  const r = await fetch(`${url}/${p}?raw`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${p}: ${r.status}`);
  const src = await r.text();
  const m = /^export default ("(?:[^"\\]|\\.)*")/s.exec(src);
  return m ? JSON.parse(m[1]) : src;
}
/** Open `path` (project-relative, or `engine:<path>`), optionally at { line, col, endLine }. */
export async function openFile(path, at = null) {
  if (!C.on) await setCode(true);
  await ensureView();
  let tab = C.tabs.find((t) => t.path === path);
  if (!tab) {
    const engine = path.startsWith('engine:');
    const f = C.files.find((x) => x.path === path);
    if (!engine && !TEXT_EXT.test(path)) throw new Error(`${path} is not a text file`);
    if (f && f.size > 2e6) throw new Error(`${path} is too large to edit (${(f.size / 1e6).toFixed(1)} MB)`);
    let text, mtime = 0;
    if (engine) text = await readEngine(path.slice(7));
    else {
      const [t, st] = await Promise.all([api.readText(path), api.stat(path)]);
      if (t === null) throw new Error(`${path} not found`);
      text = t; mtime = st?.mtime || 0;
    }
    const existing = C.tabs.find((t) => t.path === path); // opened concurrently
    if (existing) tab = existing;
    else {
      const readOnly = engine || !(f ? f.writable : isSourceWritable(path));
      tab = { path, engine, readOnly, saved: text, mtime, dirty: false, conflict: null, deleted: false, scroll: 0 };
      tab.state = cm.makeState(engine ? path.slice(7) : path, text, { readOnly, onUpdate: (u) => onUpdate(tab, u) });
      C.tabs.push(tab);
    }
  }
  activate(tab);
  if (at?.line) cm.gotoLine(C.view, at.line, at.col, at.endLine);
  return tab;
}
function activate(tab) {
  if (C.active && C.active !== tab && C.tabs.includes(C.active)) { C.active.state = C.view.state; C.active.scroll = C.view.scrollDOM.scrollTop; }
  else if (C.active === tab) { tab.state = C.view.state; tab.scroll = C.view.scrollDOM.scrollTop; } // re-activated by a concurrent open (Code mode's default scene.js): keep the cursor a line jump just set
  C.active = tab;
  C.view.setState(tab.state);
  requestAnimationFrame(() => { if (C.active === tab) C.view.scrollDOM.scrollTop = tab.scroll || 0; });
  applyErrors(tab);
  applyObj();
  atSig = ''; scheduleCodeAt();
  renderTabs(); renderStatus(); renderBanner(); renderTree(); renderObj();
}
export async function closeTab(tab, force = false) {
  if (!tab) return;
  if (tab.dirty && !force && !(await api.ask(`${tab.path} has unsaved changes. Close it anyway?`))) return;
  const i = C.tabs.indexOf(tab);
  C.tabs.splice(i, 1);
  if (C.active === tab) {
    C.active = null;
    const next = C.tabs[Math.min(i, C.tabs.length - 1)];
    if (next) activate(next);
    else { C.view.setState(cm.makeState('empty.txt', '', { readOnly: true })); renderTabs(); renderStatus(); renderBanner(); renderTree(); setCodeOutlines([]); }
  } else { renderTabs(); renderTree(); }
}
function onUpdate(tab, u) {
  if (tab !== C.active) return;
  tab.state = u.state;
  if (u.docChanged) {
    const d = !tab.readOnly && u.state.doc.toString() !== tab.saved;
    if (d !== tab.dirty) { tab.dirty = d; renderTabs(); renderTree(); emit('code-dirty'); }
    scheduleAutoSave();
  }
  if (u.docChanged || u.selectionSet) { renderPos(); scheduleCodeAt(); }
}
function scheduleAutoSave() {
  clearTimeout(autoTimer);
  if (!C.autoSave) return;
  autoTimer = setTimeout(() => { for (const t of C.tabs) if (t.dirty && !t.conflict && !t.deleted && !t.readOnly) save(t, { quiet: true }); }, 1500);
}
/** Write the tab to disk (Ctrl+S). The live server picks the change up and reloads the scene. */
export async function save(tab = C.active, { quiet = false } = {}) {
  if (!tab) return false;
  if (C.writing.has(tab.path)) return false;
  if (tab.readOnly) { if (!quiet) toast(`${tab.path} is read-only here`); return false; }
  const text = textOf(tab);
  C.writing.add(tab.path);
  try {
    const r = await api.writeProjectFile(tab.path, text, tab.mtime, tab.deleted ? null : tab.saved);
    tab.saved = text; tab.mtime = r?.mtime || (await api.stat(tab.path))?.mtime || 0;
    tab.dirty = textOf(tab) !== tab.saved; tab.conflict = null; tab.deleted = false;
    renderTabs(); renderTree(); renderBanner(); renderStatus(); emit('code-dirty'); emit('code-saved', tab.path);
    if (!quiet) toast(`Saved ${tab.path}`, 1500);
    if (!C.files.some((f) => f.path === tab.path)) refreshFiles();
    return true;
  } catch (e) {
    if (e?.code === 'conflict') {
      tab.deleted = e.text === null;
      tab.conflict = tab.deleted ? null : { text: e.text, mtime: e.mtime };
      renderBanner(); renderTabs();
    } else toast('Save failed: ' + (e.message || e), 5000);
    return false;
  }
  finally { C.writing.delete(tab.path); }
}
export const saveActive = () => save(C.active);

function renderTabs() {
  const host = $('code-tabs');
  if (!host) return;
  host.innerHTML = C.tabs.map((t, i) => {
    const name = t.path.replace(/^engine:/, '').split('/').pop();
    return `<div class="ct-tab${t === C.active ? ' on' : ''}${t.readOnly ? ' ro' : ''}${t.conflict || t.deleted ? ' warn' : ''}" data-i="${i}" title="${esc(t.path)}${t.readOnly ? ' (read-only)' : ''}"><span>${esc(name)}</span>${t.dirty ? '<b class="ct-dirty" title="unsaved"></b>' : ''}<button type="button" class="ct-x" title="Close">&times;</button></div>`;
  }).join('') || '<div class="ct-empty">Open a file from the tree</div>';
  for (const el of host.querySelectorAll('.ct-tab')) {
    const t = C.tabs[+el.dataset.i];
    el.onclick = (e) => { if (e.target.closest('.ct-x')) closeTab(t); else if (t !== C.active) activate(t); };
    el.onauxclick = (e) => { if (e.button === 1) closeTab(t); };
  }
}
function renderPos() {
  const el = $('cs-pos');
  if (!el || !C.view || !C.active) { if (el) el.textContent = ''; return; }
  const h = C.view.state.selection.main.head, l = C.view.state.doc.lineAt(h);
  el.textContent = `Ln ${l.number}, Col ${h - l.from + 1}`;
}
function renderStatus() {
  const t = C.active;
  $('cs-path').textContent = t ? t.path.replace(/^engine:/, 'engine: ') : '';
  $('cs-ro').hidden = !t?.readOnly;
  $('cs-save').disabled = !t || t.readOnly;
  $('cs-vscode').disabled = !t || t.engine;
  $('cs-ask').disabled = !t;
  $('cs-auto').checked = C.autoSave;
  renderPos(); renderErr();
}
function renderErr() {
  const el = $('cs-err'), e = C.lastError;
  el.hidden = !e;
  if (e) { el.textContent = `⚠ ${e.message}${e.path ? ` · ${e.path}:${e.line}` : ''}`; el.title = e.stack || e.message; }
}
function renderBanner() {
  const b = $('code-banner'), t = C.active;
  if (!t || (!t.conflict && !t.deleted)) { b.hidden = true; b.innerHTML = ''; return; }
  b.hidden = false;
  b.innerHTML = t.deleted
    ? '<span><b>Deleted on disk.</b> Saving recreates it.</span><span class="spacer"></span><button type="button" class="tbtn sm" data-a="close">Close tab</button><button type="button" class="tbtn sm" data-a="keep">Keep mine</button>'
    : '<span><b>Changed on disk</b> while you have unsaved edits.</span><span class="spacer"></span><button type="button" class="tbtn sm" data-a="reload">Reload</button><button type="button" class="tbtn sm" data-a="keep">Keep mine</button><button type="button" class="tbtn sm" data-a="compare">Compare</button>';
  b.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || C.active !== t) return;
    if (a === 'reload') { reloadTab(t, t.conflict.text, t.conflict.mtime); toast(`Reloaded ${t.path} from disk`); }
    else if (a === 'keep') { if (t.conflict) { t.saved = t.conflict.text; t.mtime = t.conflict.mtime; } else { t.saved = null; t.mtime = 0; } t.conflict = null; t.deleted = false; t.dirty = textOf(t) !== t.saved; renderBanner(); renderTabs(); save(t); }
    else if (a === 'close') closeTab(t, true);
    else if (a === 'compare') showDiff({ title: 'Compare', sub: t.path, leftLabel: 'on disk', rightLabel: 'yours (unsaved)', files: [{ path: t.path, status: 'M', a: t.conflict.text, b: textOf(t) }] });
  };
}
function reloadTab(tab, text, mtime) {
  tab.saved = text; tab.mtime = mtime; tab.conflict = null; tab.deleted = false; tab.dirty = false;
  if (tab === C.active) cm.replaceDoc(C.view, text);
  else tab.state = tab.state.update({ changes: { from: 0, to: tab.state.doc.length, insert: text } }).state;
  tab.dirty = false;
  renderTabs(); renderBanner(); renderTree();
  if (C.obj && objFiles().includes(tab.path)) {
    refsCache.delete(C.obj.key);
    refreshObj({ force: true }); // replacing the document maps old regions and drops folds
  }
}

// ---------- disk sync (poll 1 s for open files) ----------
/** Versions restore / other studio-made changes: the next silent reload says why instead of "Updated by Claude". */
export const noteExternal = (msg) => { C.external = { msg, until: Date.now() + 8000 }; };
async function poll() {
  if (polling || !C.tabs.length) return;
  polling = true;
  try {
    for (const tab of [...C.tabs]) {
      if (tab.engine || C.writing.has(tab.path) || !C.tabs.includes(tab)) continue;
      const st = await api.stat(tab.path).catch(() => undefined);
      if (st === undefined || C.writing.has(tab.path)) continue;
      if (!st) {
        if (!tab.deleted) { tab.deleted = true; tab.conflict = null; renderBanner(); renderTabs(); }
        continue;
      }
      if (st.mtime === tab.mtime || tab.conflict?.mtime === st.mtime) continue;
      const text = await api.readText(tab.path).catch(() => null);
      if (text === null || C.writing.has(tab.path)) continue;
      if (text === tab.saved) { tab.mtime = st.mtime; if (tab.deleted) { tab.deleted = false; renderBanner(); renderTabs(); } continue; }
      if (!tab.dirty) {
        reloadTab(tab, text, st.mtime);
        const ext = C.external && C.external.until > Date.now() ? C.external.msg : null;
        toast(ext ? `${tab.path}: ${ext}` : `Updated by Claude: ${tab.path}`, 2500);
      } else { tab.conflict = { text, mtime: st.mtime }; tab.deleted = false; renderBanner(); renderTabs(); }
    }
  } finally { polling = false; }
}

// ---------- errors from the live bridge ----------
/** Stack / message -> [{ path, line, col }] for files of this project (URLs of the live server, /@fs/ paths, plain paths). */
export function stackLocations(text, files = C.files) {
  const known = new Set(files.map((f) => f.path)), out = [];
  const re = /((?:https?:\/\/[^/\s)]+)?\/?[\w@~.+/-]*?\.(?:m?js|css|json|html))(?:\?[^\s:)]*)?:(\d+)(?::(\d+))?/g;
  for (const m of String(text || '').matchAll(re)) {
    let p = m[1].replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
    if (p.startsWith('@fs/')) { const root = String(S.root).replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''); p = p.slice(4); if (p.startsWith(root + '/')) p = p.slice(root.length + 1); }
    const hit = known.has(p) ? p : [...known].find((k) => p.endsWith('/' + k));
    if (hit) out.push({ path: hit, line: +m[2], col: +(m[3] || 1) });
  }
  return out;
}
function onLiveError(m) {
  const msg = String(m.message || 'scene error').split('\n')[0];
  const locs = stackLocations(`${m.message || ''}\n${m.stack || ''}`);
  if (!locs.length && m.path) locs.push({ path: m.path, line: m.line || 1, col: m.col || 1 }); // live.js mapped it (file list not loaded yet)
  C.errors.clear();
  if (locs.length) { const l = locs[0]; C.errors.set(l.path, [{ line: l.line, col: l.col, message: msg }]); }
  C.lastError = { message: msg, stack: m.stack || '', ...(locs[0] || {}) };
  for (const t of C.tabs) if (t === C.active) applyErrors(t);
  renderErr(); renderTree();
}
function clearErrors() {
  if (!C.lastError && !C.errors.size) return;
  C.errors.clear(); C.lastError = null;
  if (C.active) applyErrors(C.active);
  renderErr(); renderTree();
}
function applyErrors(tab) { if (cm && C.view && tab === C.active) cm.setErrors(C.view, tab.engine ? [] : C.errors.get(tab.path) || []); }

// ---------- element <-> code ----------
/** Bridge refs for an element key (falls back to a text search of the scene folder when the bridge has no `code`). */
const refsCache = new Map();
export async function refsFor(key) {
  if (refsCache.has(key)) return refsCache.get(key);
  let v;
  try {
    const r = await request('code', { key }, 5000);
    // regions / marked / tweakable: docs/INSPECTOR.md §1 (older engines send only refs)
    v = { refs: Array.isArray(r?.refs) ? r.refs : [], regions: Array.isArray(r?.regions) ? r.regions : null, marked: !!r?.marked,
      tweakable: r?.tweakable || null, src: 'bridge' };
  }
  catch (e) { v = { refs: await staticRefs(key), src: 'search', why: e.message }; }
  refsCache.set(key, v);
  return v;
}
async function staticRefs(key) {
  if (!S.name) return [];
  if (!C.files.length) await refreshFiles();
  const k = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [['named', new RegExp(`ctx\\.el\\(\\s*['"\`]${k}['"\`]`)], ['defined', new RegExp(`data-gfx=\\\\?["']${k}\\\\?["']`)], ['ref', new RegExp(`['"\`]${k}['"\`]|\\[data-gfx=\\\\?["']?${k}`)]];
  const out = [];
  for (const f of C.files.filter((x) => x.path.startsWith(`scenes/${S.name}/`) && /\.(m?js|css|html)$/.test(x.path))) {
    const text = await api.readText(f.path).catch(() => null);
    if (!text) continue;
    text.split('\n').forEach((line, i) => {
      for (const [kind, re] of pats) {
        const m = re.exec(line);
        if (m) { out.push({ kind, file: f.path, line: i + 1, col: m.index + 1, snippet: line.trim().slice(0, 160) }); break; }
      }
    });
  }
  const order = { named: 0, defined: 1, styled: 2, animated: 3, sound: 4, ref: 5 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.line - b.line);
}
/** Seconds for a ref's t0/t1 (the bridge may report ms). */
export function refTimes(r) {
  if (r.t0 == null && r.t1 == null) return null;
  let a = +(r.t0 ?? r.t1), b = +(r.t1 ?? r.t0);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (Math.max(a, b) > (duration() || 0) + 1 && Math.max(a, b) > 50) { a /= 1000; b /= 1000; }
  return { t0: Math.min(a, b), t1: Math.max(a, b) };
}
export function setBand(b) { S.codeBand = b; emit('code-band'); }
/** Render the refs list for `key` into `box` (inspector Code section / the Code mode refs panel). */
export function renderRefs(box, key) {
  if (!box) return;
  const my = (refsSeq.get(box) || 0) + 1;
  refsSeq.set(box, my);
  box.dataset.key = key || '';
  if (!key) { box.innerHTML = ''; return; }
  box.innerHTML = `<p class="sec-h">Code <span class="cr-key">${esc(key)}</span></p><div class="cr-list"><div class="hint">Finding code…</div></div>`;
  refsFor(key).then(({ refs, src }) => {
    if (my !== refsSeq.get(box) || box.dataset.key !== key) return;
    const list = box.querySelector('.cr-list');
    if (!refs.length) { list.innerHTML = '<div class="hint">No code references found.</div>'; return; }
    list.innerHTML = refs.map((r, i) => {
      const tt = refTimes(r);
      return `<div class="cref" data-i="${i}" title="${esc(r.file)}:${r.line}${r.props?.length ? ' · ' + esc(r.props.join(', ')) : ''}"><span class="ck ck-${esc(r.kind)}">${esc(r.kind)}</span><span class="cf">${esc(String(r.file).split('/').pop())}:${r.line}</span>${tt ? `<span class="ctm">${tt.t0.toFixed(2)}–${tt.t1.toFixed(2)}s</span>` : r.cue ? `<span class="ctm">${esc(r.cue)}</span>` : ''}<code>${esc(r.snippet || '')}</code></div>`;
    }).join('') + (src === 'search' ? '<div class="hint cr-src">text search (the live bridge has no code links)</div>' : '');
    for (const el of list.querySelectorAll('.cref')) {
      const r = refs[+el.dataset.i], tt = refTimes(r);
      el.onclick = () => openRef(r);
      if (tt) { el.onmouseenter = () => setBand(tt); el.onmouseleave = () => setBand(null); }
    }
  });
}
/** Line jump from outside Code mode (Live's scene error overlay): enter Code mode like the mode buttons, open `path` at `at`. */
export async function openCodeAt(path, at = null) {
  if (!C.on) await enterCode();
  return openFile(path, at);
}
export async function openRef(r) {
  try {
    await openFile(r.file, { line: r.line, col: r.col, endLine: r.endLine });
    const tt = refTimes(r);
    if (tt && r.kind === 'animated') { ensureVisible(tt.t0); seek(tt.t0, { frame: true }); }
  } catch (e) { toast('Open failed: ' + (e.message || e), 4000); }
}

// ---------- object view (docs/INSPECTOR.md §1c): one element's code regions, everything else folded ----------
// C.obj = { key, regions: [{ file, from, to, kind, label }], marked, refs, src, whole } while the view is open.
let objSeq = 0;
let enterCode = () => setCode(true);
/** main.js routes entering Code mode through its mode switch (syncs the mode buttons). */
export const setEnterCode = (fn) => { enterCode = fn; };
const objFiles = () => [...new Set((C.obj?.regions || []).map((r) => r.file))];
const objRegionsOf = (file) => (C.obj?.regions || []).filter((r) => r.file === file);
async function waitLive(ms) {
  const until = Date.now() + ms;
  while (L.on && !liveOn() && Date.now() < until) await new Promise((r) => setTimeout(r, 100));
}
/** Regions for `key` from the bridge; without them (no bridge / old engine) the named line, else the first ref line. */
function regionsFrom(info) {
  if (info.regions?.length) return info.regions;
  const r = info.refs.find((x) => x.kind === 'named') || info.refs[0];
  return r ? [{ file: r.file, from: r.line, to: r.line, kind: 'ref', label: r.kind }] : [];
}
/** Open the code of one named element: Code mode, its file(s) with only its regions unfolded (inspector "Open code"). */
export async function openObjectCode(key) {
  if (!key) return false;
  const seq = ++objSeq;
  if (!C.on) await enterCode();
  await ensureView();
  if (seq !== objSeq) return false;
  C.obj = { key, regions: [], marked: false, refs: [], src: '', whole: false, loading: true };
  renderObj();
  await waitLive(10000);
  const info = await refsFor(key);
  if (seq !== objSeq) return false;
  const regions = regionsFrom(info);
  if (!regions.length) { C.obj = null; renderObj(); toast(`No code found for ${key}`, 3000); return false; }
  C.obj = { key, regions, marked: !!info.marked, refs: info.refs, src: info.src, whole: false };
  try { await showObjFile(objFiles()[0]); } catch (e) { toast('Open failed: ' + (e.message || e), 4000); }
  return true;
}
/** Show `file` in the object view and put the cursor on its first region. */
async function showObjFile(file, { jump = true } = {}) {
  const tab = await openFile(file); // activate() -> applyObj
  if (jump && C.obj && C.active === tab) {
    const first = objRegionsOf(file)[0];
    if (first) cm.gotoLine(C.view, first.from, 1);
  }
}
/** Mark + fold the active tab for the open object (or clear it when the file has no regions / the view is closed). */
function applyObj({ force = false } = {}) {
  const tab = C.active;
  if (!tab || !C.view || !cm) return;
  const mine = C.obj && !C.obj.loading ? objRegionsOf(tab.path) : [];
  const sig = mine.length ? `${C.obj.key}|${JSON.stringify(mine)}|${C.obj.whole}` : '';
  if (sig === (tab.obj || '') && !force) return; // already applied (a tab switch keeps the folds the user opened)
  if (mine.length) cm.setObject(C.view, mine, { fold: !C.obj.whole });
  else { cm.setObject(C.view, null); cm.unfoldEverything(C.view); }
  tab.obj = sig || null;
}
export function closeObjectCode() {
  objSeq++;
  if (!C.obj) return;
  C.obj = null;
  for (const t of C.tabs) {
    if (!t.obj) continue;
    if (t === C.active) { cm.setObject(C.view, null); cm.unfoldEverything(C.view); }
    else t.state = cm.setObjectState(t.state, null, { fold: false });
    t.obj = null;
  }
  setBand(null);
  renderObj();
}
function toggleWhole() {
  if (!C.obj || !C.active) return;
  C.obj.whole = !C.obj.whole;
  if (C.obj.whole) cm.unfoldEverything(C.view);
  else cm.setObject(C.view, cm.objectLines(C.view.state), { fold: true }); // the edited (mapped) regions
  const mine = objRegionsOf(C.active.path);
  if (C.active.obj) C.active.obj = `${C.obj.key}|${JSON.stringify(mine)}|${C.obj.whole}`;
  renderObj();
}
/** After a reload: fetch the regions again and re-apply them when they changed (not while the object's files have unsaved edits). */
async function refreshObj({ force = false } = {}) {
  const o = C.obj;
  if (!o || o.loading || !C.on) return;
  if (C.tabs.some((t) => t.dirty && objFiles().includes(t.path))) return;
  const seq = objSeq, info = await refsFor(o.key);
  if (seq !== objSeq || C.obj !== o) return;
  const regions = regionsFrom(info);
  if (!regions.length) return;
  const same = JSON.stringify(regions) === JSON.stringify(o.regions);
  Object.assign(o, { regions, marked: !!info.marked, refs: info.refs, src: info.src });
  if (!same || force) for (const t of C.tabs) if (t.obj && t !== C.active) { t.state = cm.setObjectState(t.state, null, { fold: false }); t.obj = null; } // re-applied on activation
  // The active file: re-apply when marked lines differ, or restore regions and folds after replacing the document.
  const mine = C.active ? objRegionsOf(C.active.path).map(({ from, to }) => ({ from, to })) : [];
  if (C.active && (force || JSON.stringify(cm.objectLines(C.view.state)) !== JSON.stringify(mine))) applyObj({ force: true });
  renderObj();
}
/** The active editor's object regions (1-based lines) and number of folds (status / E2E). */
export const objectState = () => (cm && C.view ? { lines: cm.objectLines(C.view.state), folds: cm.foldCount(C.view.state) } : { lines: [], folds: 0 });
function renderObj() {
  const box = $('code-obj');
  if (!box) return;
  const o = C.obj;
  box.hidden = !o;
  if (!o) { box.innerHTML = ''; return; }
  if (o.loading) { box.innerHTML = `<div class="co-row"><span class="co-key">◎ ${esc(o.key)}</span><span class="co-what">finding its code…</span><span class="spacer"></span><button type="button" class="ct-x co-x" data-a="close" title="Close the object view">&times;</button></div>`; return; }
  const files = objFiles(), cur = C.active?.path, n = o.regions.length;
  const name = (p) => String(p).split('/').pop();
  const main = files.includes(cur) ? cur : files[0];
  const what = o.marked ? `${n} block${n === 1 ? '' : 's'}` : `<span class="co-traced" title="No // @gfx markers for this element: regions found from its code links and identifiers">traced (approximate)</span> · ${n} region${n === 1 ? '' : 's'}`;
  const others = files.length > 1 ? ` <span class="dim">+ ${files.length - 1} other file${files.length > 2 ? 's' : ''}</span>` : '';
  const refs = (o.refs || []).slice(0, 24);
  box.innerHTML = `<div class="co-row"><span class="co-key" title="Object view: only this element's code is unfolded">◎ ${esc(o.key)}</span>`
    + `<span class="co-what">· ${what} · ${esc(name(main))}${others}</span><span class="spacer"></span>`
    + `<button type="button" class="tbtn sm" data-a="prev" title="Previous block (Alt+↑)">↑</button><button type="button" class="tbtn sm" data-a="next" title="Next block (Alt+↓)">↓</button>`
    + `<button type="button" class="tbtn sm" data-a="whole">${o.whole ? 'Fold to object' : 'Show whole file'}</button>`
    + `<button type="button" class="ct-x co-x" data-a="close" title="Close the object view">&times;</button></div>`
    + (files.length > 1 ? `<div class="co-files">${files.map((f) => `<button type="button" class="co-file${f === cur ? ' on' : ''}" data-f="${esc(f)}" title="${esc(f)}">${esc(name(f))} <b>${objRegionsOf(f).length}</b></button>`).join('')}</div>` : '')
    + (refs.length ? `<div class="co-refs">${refs.map((r, i) => `<button type="button" class="co-ref" data-i="${i}" title="${esc(r.file)}:${r.line} · ${esc(r.snippet || '')}"><span class="ck ck-${esc(r.kind)}">${esc(r.kind)}</span>${r.file !== main ? esc(name(r.file)) + ':' : ''}${r.line}</button>`).join('')}</div>` : '');
  box.querySelectorAll('.co-ref').forEach((b) => { const r = refs[+b.dataset.i], tt = refTimes(r); if (tt) { b.onmouseenter = () => setBand(tt); b.onmouseleave = () => setBand(null); } });
}
function onObjClick(e) {
  const b = e.target.closest('button');
  if (!b || !C.obj) return;
  b.blur();
  const a = b.dataset.a;
  if (a === 'close') closeObjectCode();
  else if (a === 'whole') toggleWhole();
  else if (a === 'next' || a === 'prev') { if (C.view && !cm.jumpRegion(C.view, a === 'next' ? 1 : -1)) showObjFile(objFiles()[0]); }
  else if (b.dataset.f) showObjFile(b.dataset.f).catch((err) => toast('Open failed: ' + (err.message || err), 4000));
  else if (b.dataset.i != null) openRef(C.obj.refs[+b.dataset.i]);
}

function scheduleCodeAt() {
  clearTimeout(atTimer);
  atTimer = setTimeout(codeAt, 150);
}
async function codeAt() {
  const t = C.active;
  if (!C.on || !t || t.engine || !liveOn()) { atSig = ''; setCodeOutlines([]); renderAtKeys([]); return; }
  const line = C.view.state.doc.lineAt(C.view.state.selection.main.head).number, sig = `${t.path}:${line}`;
  if (sig === atSig) return;
  atSig = sig;
  let keys = [];
  try { keys = (await request('codeAt', { file: t.path, line }, 3000))?.keys || []; } catch { keys = []; }
  if (atSig !== sig) return;
  setCodeOutlines(keys); renderAtKeys(keys);
}
function renderAtKeys(keys) {
  const el = $('cs-keys');
  if (!el) return;
  el.innerHTML = keys.slice(0, 6).map((k) => `<button type="button" class="cs-key" data-k="${esc(k)}" title="Select ${esc(k)}">◎ ${esc(k)}</button>`).join('') + (keys.length > 6 ? `<span class="dim">+${keys.length - 6}</span>` : '');
  for (const b of el.querySelectorAll('.cs-key')) b.onclick = () => selectKey(b.dataset.k);
}

// ---------- VS Code / Ask Claude ----------
/** vscode:// link for a project file: WSL roots open through the WSL remote, others as a local file. */
export function vscodeUrl(root, rel, line = 1, col = 1) {
  const r = String(root).replace(/[\\/]+$/, '');
  const m = /^(?:\\\\\?\\UNC\\|\\\\|\/\/)(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(.*)$/i.exec(r);
  const enc = (p) => encodeURI(p).replace(/[?#]/g, encodeURIComponent);
  if (m) return `vscode://vscode-remote/wsl+${m[1]}${enc(m[2].replace(/\\/g, '/'))}/${enc(rel)}:${line}:${col}`;
  const p = r.replace(/\\/g, '/');
  return `vscode://file${p.startsWith('/') ? '' : '/'}${enc(p)}/${enc(rel)}:${line}:${col}`;
}
const EDITOR_NAME = { vscode: 'VS Code', system: 'Editor', custom: 'Editor' };
/** The external code editor from Settings → General: VS Code (vscode:// link), the system default or a custom command. */
function openVsCode() {
  const t = C.active;
  if (!t || t.engine) return;
  const h = C.view.state.selection.main.head, l = C.view.state.doc.lineAt(h), col = h - l.from + 1;
  const ed = pref('editor');
  if (ed !== 'vscode') { api.openInEditor(t.path, l.number, col).catch((e) => toast('Editor: ' + (e.message || e), 5000)); return; }
  const url = vscodeUrl(S.root, t.path, l.number, col);
  if (window.__TAURI__) api.openLink(url).catch((e) => toast('VS Code: ' + (e.message || e), 5000));
  else { window.open(url, '_blank', 'noopener'); toast(url, 4000); }
}
function syncEditorPrefs(keys) {
  if (keys.includes('codeAutosave')) { C.autoSave = !!pref('codeAutosave'); scheduleAutoSave(); const cb = $('cs-auto'); if (cb) cb.checked = C.autoSave; }
  if (keys.includes('editor')) {
    const b = $('cs-vscode'), ed = pref('editor');
    if (b) { b.textContent = EDITOR_NAME[ed] || 'VS Code'; b.title = ed === 'vscode' ? 'Open this file at the cursor in VS Code' : 'Open this file at the cursor in the external editor (Settings → General)'; }
  }
}
function askSelection() {
  const t = C.active;
  if (!t) return;
  const st = C.view.state, sel = st.selection.main;
  const l1 = st.doc.lineAt(sel.from).number, l2 = st.doc.lineAt(sel.to).number;
  const text = sel.empty ? st.doc.line(l1).text : st.sliceDoc(sel.from, sel.to);
  const where = `${t.path.replace(/^engine:/, '')}:${l1}${l2 > l1 ? '-' + l2 : ''}`;
  const lang = { js: 'js', mjs: 'js', css: 'css', json: 'json', md: 'md', html: 'html' }[t.path.split('.').pop()] || '';
  emit('ask-claude', {
    source: 'code', label: `Code · ${where}`,
    extra: `Code ${sel.empty ? 'at the cursor' : 'selection'} — ${where}${t.dirty ? ' (the studio has unsaved edits in this file)' : ''}:\n\`\`\`${lang}\n${text.slice(0, 6000)}\n\`\`\``,
  });
}

// ---------- left column (Files | Versions) ----------
export function showLeft(which) { C.leftTab = which; syncLeft(); }
function syncLeft() {
  for (const b of $('code-left').querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.ct === C.leftTab);
  $('code-tree').hidden = C.leftTab !== 'files';
  $('code-versions').hidden = C.leftTab !== 'versions';
  emit('versions-host');
}

export function initCode() {
  $('code-tree').addEventListener('click', onTreeClick);
  $('code-obj').addEventListener('click', onObjClick); // object view header (docs/INSPECTOR.md §1c)
  for (const b of $('code-left').querySelectorAll('.tabs button')) b.onclick = () => showLeft(b.dataset.ct);
  $('cs-save').onclick = (e) => { e.currentTarget.blur(); saveActive(); };
  $('cs-vscode').onclick = (e) => { e.currentTarget.blur(); openVsCode(); };
  $('cs-ask').onclick = (e) => { e.currentTarget.blur(); askSelection(); };
  $('cs-auto').onchange = (e) => { C.autoSave = e.target.checked; scheduleAutoSave(); setPref('codeAutosave', C.autoSave).catch((err) => toast('Auto-save: ' + (err.message || err), 4000)); };
  on('prefs', ({ keys } = {}) => syncEditorPrefs(keys || []));
  $('cs-err').onclick = () => { const e = C.lastError; if (e?.path) openFile(e.path, { line: e.line, col: e.col }).catch(() => {}); };
  on('live-error', onLiveError);
  on('live-ready', clearErrors); // a broken scene's bridge booted again (docs/REVIEW.md §5 "Live errors")
  on('live-reloaded', () => {
    clearErrors(); refsCache.clear(); atSig = '';
    for (const box of [$('code-refs'), $('e-code')]) if (box?.dataset.key && box.isConnected) renderRefs(box, box.dataset.key); // line numbers may have moved
    if (C.on) { scheduleCodeAt(); refreshObj(); }
  });
  on('scene', () => { refsCache.clear(); clearErrors(); closeObjectCode(); if (C.on) { if (S.name && !L.on) toggleLive(); refreshFiles().then(() => { if (!C.tabs.length && S.name) openDefault(); }); } });
  on('live', () => { refsCache.clear(); atSig = ''; if (C.on) scheduleCodeAt(); });
  on('el-select', (key) => {
    if (!C.on) return;
    renderRefs($('code-refs'), key);
    if (C.obj && key && key !== C.obj.key) openObjectCode(key); // the object view follows the picture selection
  });
  on('root', () => { closeObjectCode(); for (const t of [...C.tabs]) closeTab(t, true); C.files = []; C.open.clear(); refsCache.clear(); clearErrors(); if (C.on) refreshFiles(); });
  window.addEventListener('beforeunload', (e) => { if (codeDirty()) { e.preventDefault(); e.returnValue = ''; } });
  pollTimer = setInterval(poll, 1000);
  filesTimer = setInterval(() => { if (C.on && !document.hidden) refreshFiles(); }, 6000);
}
export const _timers = () => ({ pollTimer, filesTimer });
