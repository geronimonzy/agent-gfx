// Library page (docs/LOOKS.md §3): a full page like Settings (settings.js) over the hidden workspace. Tabs Looks · Presets ·
// Sound palettes over the machine Library folder (setting libraryDir; ops in api.js -> src-tauri/src/library.rs, guards in
// library-core.js). Looks: cards (thumb.jpg + preview.mp4 on hover, else ref thumbnails / swatches; name, tags), New look ▾
// (With Claude… = a dialog that writes looks/<id>/BRIEF.md + refs/ and sends Claude "Make the look <id> …" to the terminal or a
// new T3 thread, docs/LOOK-PIPELINE.md §5; Blank; Copy this project's style), edit (LOOK.md + preset.js in CodeMirror, the
// palette editor, refs, Preview: the clip, Re-render preview = `gfx look preview`, Rebuild sample with Claude…),
// Use in this project / Update from library / Save to library (`gfx look use|update|save --library <dir>`), Duplicate,
// Delete. Presets: list, edit, duplicate, delete. Sound palettes: rows role · sound · ▶ · tags · note · ×, add a synth sound or
// a sound-library sample (name / path filter of the library index, plus CLAP text search with `gfx lib search`).
// Sound sources (docs/SOUND-LIBRARY.md §4): the engine's sound library (`gfx lib list|add|enable|disable|index|remove`), add a
// folder (id, licence) + index with progress, enable / disable, re-index, remove; Replace… / the Shape section reload their index after.
// An empty Library offers "Add starter looks" (`gfx look seed`). Esc / ← Back return to the workspace exactly as it was.
import './library.css';
import * as api from './api.js';
import { S, on, emit, esc } from './store.js';
import { pref, reloadProject } from './prefs.js';
import { workflowArg } from './settings-core.js';
import { register, addDialogProbe } from './keys.js';
import * as soundIndex from './soundindex.js'; // the studio's sound-library index (sources, entries, describe)
import { settingsOpen, closeSettings } from './settings.js'; // (settings.js imports this module too; both only call at runtime)
import { SOUND_NAMES, VARIANTS, makeCue, renderStems, SAMPLE_RATE } from '@sfx';
import { openMenu } from './menu.js';
import { sendToClaude } from './terminal.js';
import * as t3 from './t3.js';
import './newscene.css'; // the New look dialog uses the New scene window's layout (ns-* classes)
import {
  paletteSaver, validId, lookMeta, presetSwatches, renamePreset, parsePalette, blankLook, isImage, isMedia, uniqueName, cleanFileName,
  lookBriefText, wslProject, claudeLibPath, makeLookMessage, rebuildSampleMessage, lookFiles, fileKey, altLine, previewStatus,
  SOUND_LICENSES, soundSourceId, validSourceId, wslEngine, engineFolder, parseJsonOut, soundList, soundRowState, filesPerSec,
} from './library-core.js';

// built-in style presets of the engine (the "from this project's style" fallback and New preset templates)
const BUILTIN = Object.fromEntries(Object.entries(import.meta.glob('../../../../style/presets/*.js', { query: '?raw', import: 'default', eager: true }))
  .map(([p, text]) => [p.split('/').pop().replace(/\.js$/, ''), text]));

const TABS = [['looks', 'Looks'], ['presets', 'Presets'], ['palettes', 'Sound palettes'], ['sounds', 'Sound sources']];
const LB = {
  open: false, tab: 'looks', dir: '', source: '', exists: false, files: [], loading: false, err: '',
  view: null, // null (the tab's list) | { kind: 'look', id, file: 'LOOK.md'|'preset.js'|'sounds'|'refs' } | { kind: 'preset', name } | { kind: 'palette', name }
  status: null, statusErr: '', busy: '', q: '', form: null, returnFocus: null,
};
let el = null, unsubs = [], editor = null, edPath = '', edSaved = '', thumbUrls = [], keysOn = false;
export const libraryOpen = () => LB.open;
export const libraryState = () => LB; // tests

// ---------- data ----------
const filesUnder = (prefix) => LB.files.filter((f) => f.path.startsWith(prefix));
const lookIds = () => [...new Set(LB.files.filter((f) => f.path.startsWith('looks/')).map((f) => f.path.split('/')[1]).filter(validId))].sort();
const presetNames = () => LB.files.filter((f) => /^presets\/[^/]+\.js$/.test(f.path)).map((f) => f.path.slice(8, -3)).filter(validId).sort();
const paletteNames = () => LB.files.filter((f) => /^palettes\/[^/]+\.json$/.test(f.path)).map((f) => f.path.slice(9, -5)).filter(validId).sort();
const has = (rel) => LB.files.some((f) => f.path === rel);
const texts = new Map(); // rel -> text (cache for cards)
async function text(rel, fresh = false) {
  if (!fresh && texts.has(rel)) return texts.get(rel);
  const t = await api.libraryRead(rel).catch(() => null);
  texts.set(rel, t);
  return t;
}
async function loadFiles() {
  LB.loading = true;
  try { const r = await api.libraryFiles(); Object.assign(LB, { dir: r.dir, source: r.source, exists: r.exists, files: r.files, err: '' }); }
  catch (e) { LB.err = String(e.message || e); LB.files = []; }
  LB.loading = false;
  texts.clear();
}
const projectOpen = () => !!S.root && !!S.projectName;

/** `gfx <args>` -> { code, out: [lines], err: [lines], json }; the last stdout line that is a JSON object is `json`. */
async function gfx(args) {
  const out = [], err = [];
  const r = await api.engineRun(args, { progress: false, onEvent: (ev) => { if (ev.type === 'log') (ev.stream === 'stderr' ? err : out).push(ev.msg); } }).done;
  let json = null;
  for (const l of [...out].reverse()) { if (l.trim().startsWith('{')) { try { json = JSON.parse(l); break; } catch { /* not JSON */ } } }
  const msg = (err.find((l) => l.startsWith('gfx: ')) || err[err.length - 1] || r.error || (r.code ? `exit code ${r.code}` : '')).replace(/^gfx: /, '');
  return { ...r, out, err, json, msg };
}
const libArgs = () => ['--library', LB.dir];
async function loadStatus() {
  LB.statusErr = '';
  if (!projectOpen()) { LB.status = null; return; }
  try {
    const r = await gfx(['look', 'list', ...libArgs(), '--json']);
    if (r.code || !r.json) throw new Error(r.msg || 'gfx look list failed');
    LB.status = r.json;
  } catch (e) { LB.status = null; LB.statusErr = String(e.message || e); }
}

// ---------- page ----------
function build() {
  el = document.createElement('div');
  el.id = 'library-page'; el.dataset.density = 'comfortable';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Library');
  el.innerHTML = `<header class="sp-head"><button type="button" class="tbtn sp-back" data-a="back" title="Back to the workspace (Esc)">&larr; Back</button>
      <nav class="sp-crumb" aria-label="Breadcrumb"><span>Library</span><i>/</i><b class="lb-crumb-tab"></b><i class="lb-crumb-sep" hidden>/</i><b class="lb-crumb-item"></b></nav><span class="spacer"></span>
      <span class="lb-dir mono" title=""></span><button type="button" class="tbtn" data-a="folder" title="Settings → General → Library folder">Change folder…</button><kbd>Esc</kbd></header>
    <div class="sp-body">
      <aside class="sp-nav lb-nav"><div class="sp-cats" role="tablist" aria-label="Library">${TABS.map(([id, l]) => `<button type="button" role="tab" data-tab="${id}"><span>${l}</span><small class="lb-count" data-count="${id}"></small></button>`).join('')}</div>
        <div class="lb-proj"></div></aside>
      <main class="sp-main lb-main"><div class="lb-page"></div></main>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKeyDown);
  // look cards with preview.mp4: the clip plays while the card is hovered or a control in it has keyboard focus
  const cardOf = (e) => e.target.closest?.('.lb-card[data-clip]');
  el.addEventListener('mouseover', (e) => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) playCardClip(c); });
  el.addEventListener('mouseout', (e) => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget) && !c.querySelector(':focus-visible')) stopCardClip(c); });
  el.addEventListener('focusin', (e) => { const c = cardOf(e); if (c?.querySelector(':focus-visible')) playCardClip(c); });
  el.addEventListener('focusout', (e) => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget) && !c.matches(':hover')) stopCardClip(c); });
  // back from the terminal / T3 / Explorer: a look Claude (or a render) changed shows without reopening the page
  window.addEventListener('focus', () => refreshFiles());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshFiles(); });
}
/** Re-read the Library listing; repaint only what is safe: the list (no form / dialog open) or the open Preview tab. */
let refreshing = false;
async function refreshFiles() {
  if (!LB.open || refreshing || LB.loading) return;
  refreshing = true;
  try {
    const sig = (fs) => fs.map(fileKey).join('\n');
    const before = sig(LB.files);
    const r = await api.libraryFiles().catch(() => null);
    if (!r || !LB.open || sig(r.files) === before) return;
    Object.assign(LB, { dir: r.dir, source: r.source, exists: r.exists, files: r.files, err: '' });
    texts.clear();
    const listShown = () => LB.open && !LB.view && !LB.form && !NL.dlg && !LB.busy && LB.tab !== 'sounds';
    if (listShown()) { for (const id of lookIds()) await text(`looks/${id}/LOOK.md`); if (listShown()) render(); } // re-checked: a click may have opened a view meanwhile
    else if (LB.view?.kind === 'look' && LB.view.file === 'preview' && !NL.dlg) { const box = el.querySelector('.lb-file'); if (box) mountPreview(box, LB.view.id); }
  } finally { refreshing = false; }
}

function render() {
  if (!el) return;
  for (const b of el.querySelectorAll('[data-tab]')) { const on_ = b.dataset.tab === LB.tab; b.classList.toggle('on', on_); b.setAttribute('aria-selected', String(on_)); }
  const n = { looks: lookIds().length, presets: presetNames().length, palettes: paletteNames().length };
  for (const c of el.querySelectorAll('[data-count]')) c.textContent = c.dataset.count === 'sounds' ? (SND.list ? String(SND.list.length) : '') : LB.exists ? String(n[c.dataset.count]) : '';
  el.querySelector('.lb-crumb-tab').textContent = TABS.find(([id]) => id === LB.tab)[1];
  const item = LB.view ? (LB.view.kind === 'look' ? lookName(LB.view.id) : LB.view.name) : '';
  el.querySelector('.lb-crumb-sep').hidden = !item;
  el.querySelector('.lb-crumb-item').textContent = item;
  const d = el.querySelector('.lb-dir');
  d.textContent = LB.dir ? `‎${LB.dir}‎` : '';
  d.title = `${LB.dir}${LB.source === 'default' ? ' (the default; change it in Settings → General)' : ''}`;
  el.querySelector('.lb-proj').innerHTML = projectHtml();
  destroyEditor();
  const page = el.querySelector('.lb-page');
  page.innerHTML = LB.err ? `<p class="lb-err">${esc(LB.err)}</p>` : LB.view ? viewHtml() : listHtml();
  if (LB.view) mountView();
  else if (LB.tab === 'sounds') { if (!SND.list && !SND.loading && !SND.err) loadSounds(); }
  else fillCards();
}
const lookName = (id) => lookMeta(texts.get(`looks/${id}/LOOK.md`) || '').name || id;

// ---------- project look status (left column) ----------
function projectHtml() {
  if (!projectOpen()) return '<h3>This project</h3><p class="dim">Open a project to use a look in it.</p>';
  const st = LB.status?.look, busy = LB.busy;
  if (LB.statusErr) return `<h3>This project</h3><p class="lb-err">${esc(LB.statusErr)}</p>`;
  if (!LB.status) return '<h3>This project</h3><p class="dim"><i class="spin"></i> Checking…</p>';
  if (!st) return `<h3>This project</h3><p class="dim">No look yet. Pick one: <b>Use in this project</b> on a look.</p>`;
  const name = LB.status.projectLooks?.find((l) => l.id === st.id)?.name || st.id;
  const pinned = st.lookSource ? (st.updateAvailable ? 'The Library has a newer version.' : st.conflict ? 'Edited here, and the Library copy changed too.' : st.edited ? 'Edited here (not in the Library yet).' : st.libraryHash ? 'Same as the Library.' : 'Not in this Library.') : 'Made in this project (not in the Library).';
  const btns = [];
  if (st.updateAvailable) btns.push(`<button type="button" class="tbtn primary" data-a="update"${busy ? ' disabled' : ''}>Update from library</button>`);
  if (st.conflict) btns.push(`<button type="button" class="tbtn primary" data-a="compare"${busy ? ' disabled' : ''}>Compare…</button>`);
  if (st.edited || !st.lookSource || !st.libraryHash) btns.push(`<button type="button" class="tbtn" data-a="save-to-lib"${busy ? ' disabled' : ''}>Save to library</button>`);
  return `<h3>This project</h3><div class="lb-pl" data-look="${esc(st.id)}"><b>${esc(name)}</b><span class="mono dim">looks/${esc(st.id)}/</span><p class="lb-pl-st${st.updateAvailable || st.conflict ? ' warn' : ''}">${esc(pinned)}</p>
    <span class="sp-btns">${btns.join('')}</span>${busy ? `<p class="dim"><i class="spin"></i> ${esc(busy)}</p>` : ''}</div>`;
}

// ---------- lists ----------
function listHtml() {
  if (LB.tab === 'sounds') return soundsHtml(); // the engine's sound library, not the Library folder
  if (LB.loading && !LB.files.length) return '<p class="dim"><i class="spin"></i> Reading the Library…</p>';
  if (!LB.exists || (!lookIds().length && !presetNames().length && !paletteNames().length)) {
    return `<div class="lb-empty"><h2>Your Library is empty</h2><p>A look is a reusable design approach: motion, typography, colours, sound palette and references. Pick one in a project and it is copied there.</p>
      <p class="mono dim">${esc(LB.dir)}</p>
      <span class="sp-btns"><button type="button" class="tbtn primary" data-a="seed"${LB.busy ? ' disabled' : ''}>Add starter looks</button><button type="button" class="tbtn" data-a="new-look" data-how="claude"${projectOpen() ? '' : ' disabled title="Open a project first: Claude works in a project"'}>New look with Claude…</button><button type="button" class="tbtn" data-a="new-look" data-how="blank">New blank look</button></span>
      ${formHtml()}</div>`;
  }
  const q = LB.q.trim().toLowerCase();
  if (LB.tab === 'looks') {
    const ids = lookIds();
    return `<div class="lb-bar"><input type="search" class="lb-q" placeholder="Filter looks (name, tag)" value="${esc(LB.q)}" spellcheck="false" autocomplete="off" aria-label="Filter looks">
        <span class="spacer"></span>
        <button type="button" class="tbtn primary" data-a="new-look-menu" aria-haspopup="menu" title="With Claude (prompt, references, this project), blank, or a copy of this project's style">New look &#9662;</button></div>
      ${formHtml()}
      <div class="lb-cards">${ids.map((id) => `<article class="lb-card" data-look="${esc(id)}" data-q="${esc(id)}"><div class="lb-card-body"><h3>${esc(id)}</h3></div></article>`).join('') || '<p class="dim">No looks yet.</p>'}</div>`;
  }
  if (LB.tab === 'presets') {
    const names = presetNames().filter((n) => !q || n.includes(q));
    return `<div class="lb-bar"><input type="search" class="lb-q" placeholder="Filter presets" value="${esc(LB.q)}" spellcheck="false" autocomplete="off" aria-label="Filter presets"><span class="spacer"></span>
        <button type="button" class="tbtn" data-a="new-preset">New preset</button></div>${formHtml()}
      <div class="sp-card lb-rows">${names.map((n) => `<div class="lb-row" data-preset="${esc(n)}"><b>${esc(n)}</b><span class="lb-sw" data-sw="presets/${esc(n)}.js"></span><span class="spacer"></span>
        <button type="button" class="tbtn" data-a="edit-preset">Edit</button><button type="button" class="tbtn" data-a="dup-preset">Duplicate</button><button type="button" class="tbtn lb-del" data-a="del-preset" title="Delete">Delete</button></div>`).join('') || '<p class="dim lb-none">No presets yet. Looks keep their own preset.js; standalone presets live here.</p>'}</div>`;
  }
  const names = paletteNames().filter((n) => !q || n.includes(q));
  return `<div class="lb-bar"><input type="search" class="lb-q" placeholder="Filter palettes" value="${esc(LB.q)}" spellcheck="false" autocomplete="off" aria-label="Filter palettes"><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="new-palette">New palette</button></div>${formHtml()}
    <div class="sp-card lb-rows">${names.map((n) => `<div class="lb-row" data-palette="${esc(n)}"><b>${esc(n)}</b><span class="dim lb-pcount" data-pc="palettes/${esc(n)}.json"></span><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="edit-palette">Edit</button><button type="button" class="tbtn" data-a="dup-palette">Duplicate</button><button type="button" class="tbtn lb-del" data-a="del-palette">Delete</button></div>`).join('') || '<p class="dim lb-none">No standalone palettes yet. Looks keep their own sounds.json.</p>'}</div>`;
}

/** Cards and rows fill in asynchronously (LOOK.md meta, swatches, ref thumbnails). */
async function fillCards() {
  revokeThumbs();
  const page = el.querySelector('.lb-page');
  for (const card of page.querySelectorAll('.lb-card')) {
    const id = card.dataset.look;
    const lf = lookFiles(LB.files, id);
    const [md, preset, sounds, brief] = await Promise.all([text(`looks/${id}/LOOK.md`), text(`looks/${id}/preset.js`), text(`looks/${id}/sounds.json`), !lf.look && lf.brief ? text(`looks/${id}/BRIEF.md`) : null]);
    if (!card.isConnected) return;
    const meta = lookMeta(md || brief || ''), sw = presetSwatches(preset || '');
    let count = 0; try { count = parsePalette(sounds || '[]').length; } catch { /* broken palette */ }
    const refs = filesUnder(`looks/${id}/refs/`).map((f) => f.path).filter(isMedia);
    const inProject = LB.status?.look?.id === id, making = !lf.look && lf.brief;
    card.dataset.q = `${id} ${meta.name || ''} ${meta.tags.join(' ')} ${meta.description || ''}`.toLowerCase();
    // thumb.jpg (+ preview.mp4 on hover / keyboard focus) when the look has them, else up to 3 ref images, else the swatches
    const media = lf.thumb ? `<img alt="" class="lb-thumb-main" data-media="${esc(lf.thumb.path)}">${lf.preview ? `<video muted loop playsinline preload="none" hidden data-clip="${esc(lf.preview.path)}"></video>` : ''}`
      : refs.filter(isImage).slice(0, 3).map((r) => `<img alt="" data-ref="${esc(r)}">`).join('') || `<div class="lb-thumb-none">${sw.length ? sw.slice(0, 5).map((s) => `<i style="background:${esc(s.hex)}"></i>`).join('') : 'no references'}</div>`;
    if (lf.preview) card.dataset.clip = '1'; else delete card.dataset.clip;
    card.innerHTML = `<div class="lb-thumbs">${media}</div>
      <div class="lb-card-body"><h3>${esc(meta.name || id)}${inProject ? ' <span class="lb-badge">in this project</span>' : ''}${making ? ' <span class="lb-badge lb-making" title="BRIEF.md is written; Claude writes LOOK.md, preset.js, sounds.json (and the sample) into this folder">brief sent</span>' : ''}</h3>
        ${meta.description ? `<p class="lb-desc">${esc(meta.description)}</p>` : making ? '<p class="lb-desc">Waiting for Claude: the card fills in when LOOK.md is written.</p>' : ''}
        <div class="lb-tags">${meta.tags.map((t) => `<span>${esc(t)}</span>`).join('')}</div>
        <div class="lb-meta"><span class="lb-sw">${sw.map((s) => `<i title="${esc(s.key)} ${esc(s.hex)}" style="background:${esc(s.hex)}"></i>`).join('')}</span><span class="dim">${count} sound${count === 1 ? '' : 's'} · ${refs.length} ref${refs.length === 1 ? '' : 's'}</span></div></div>
      <div class="lb-card-foot"><button type="button" class="tbtn" data-a="edit-look">Edit</button>
        <button type="button" class="tbtn${inProject ? '' : ' primary'}" data-a="use-look"${projectOpen() && !LB.busy && !making ? '' : ' disabled'}${!projectOpen() ? ' title="Open a project first"' : making ? ' title="Not ready: Claude has not written LOOK.md yet"' : ''}>${inProject ? 'Use again' : 'Use in this project'}</button>
        <span class="spacer"></span><button type="button" class="tbtn" data-a="dup-look">Duplicate</button><button type="button" class="tbtn lb-del" data-a="del-look">Delete</button></div>`;
    applyFilter();
    for (const img of card.querySelectorAll('img[data-ref]')) loadThumb(img, img.dataset.ref);
    const main = card.querySelector('img[data-media]');
    if (main) mediaUrl(lf.thumb, lf.thumb?.path.endsWith('.png') ? 'image/png' : 'image/jpeg').then((u) => { if (!u) main.remove(); else if (main.isConnected) main.src = u; });
    if (lf.preview && card.matches(':hover')) playCardClip(card); // re-rendered under the pointer (a status refresh)
  }
  for (const s of page.querySelectorAll('[data-sw]')) { const t = await text(s.dataset.sw); if (s.isConnected) s.innerHTML = presetSwatches(t || '').map((x) => `<i title="${esc(x.key)} ${esc(x.hex)}" style="background:${esc(x.hex)}"></i>`).join(''); }
  for (const s of page.querySelectorAll('[data-pc]')) { const t = await text(s.dataset.pc); let n = 0; try { n = parsePalette(t || '[]').length; } catch { /* broken */ } if (s.isConnected) s.textContent = `${n} sound${n === 1 ? '' : 's'}`; }
}
function applyFilter() {
  const q = LB.q.trim().toLowerCase();
  for (const c of el.querySelectorAll('.lb-card')) c.hidden = !!q && !q.split(/\s+/).every((w) => c.dataset.q.includes(w));
}
async function loadThumb(img, rel) {
  try {
    const b = await api.libraryReadBytes(rel);
    const u = URL.createObjectURL(new Blob([b], { type: rel.endsWith('.svg') ? 'image/svg+xml' : '' }));
    thumbUrls.push(u);
    if (img.isConnected) img.src = u;
  } catch { img.remove(); }
}
function revokeThumbs() { for (const u of thumbUrls) URL.revokeObjectURL(u); thumbUrls = []; }

// thumb.jpg / preview.mp4 of looks: fetched once per file version (fileKey = path|size|mtime), kept as blob URLs while the
// page is open (as the welcome template cards cache their clips); a changed file replaces (and revokes) the old URL
const media = new Map(); // path -> { key, url: Promise<string|null> }
function mediaUrl(f, type) {
  if (!f) return Promise.resolve(null);
  const k = fileKey(f), had = media.get(f.path);
  if (had?.key === k) return had.url;
  if (had) had.url.then((u) => u && URL.revokeObjectURL(u));
  const url = api.libraryReadBytes(f.path).then((b) => URL.createObjectURL(new Blob([b], { type })), () => null);
  media.set(f.path, { key: k, url });
  return url;
}
function revokeMedia() { for (const m of media.values()) m.url.then((u) => u && URL.revokeObjectURL(u)); media.clear(); }
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Hover / keyboard focus on a card with preview.mp4: play it muted in place of the thumbnail. */
async function playCardClip(card) {
  const v = card.querySelector('video[data-clip]');
  if (!v || reducedMotion()) return;
  const f = LB.files.find((x) => x.path === v.dataset.clip);
  const url = await mediaUrl(f, 'video/mp4');
  if (!url || !v.isConnected || !(card.matches(':hover') || card.querySelector(':focus-visible'))) return;
  if (v.src !== url) v.src = url;
  v.hidden = false; v.currentTime = 0;
  v.play().catch(() => {});
}
function stopCardClip(card) { const v = card?.querySelector('video[data-clip]'); if (v && !v.hidden) { v.pause(); v.hidden = true; } }

// ---------- inline forms (new look / preset / palette, ask Claude) ----------
function formHtml() {
  const f = LB.form;
  if (!f) return '';
  const err = f.err ? `<p class="sp-err">${esc(f.err)}</p>` : '';
  if (f.kind === 'look') {
    const title = { blank: 'New blank look', style: 'New look: copy this project\'s style' }[f.how];
    return `<form class="lb-form" data-form="look"><h3>${esc(title)}</h3>
      <label>Name <input type="text" name="name" value="${esc(f.name || '')}" placeholder="e.g. Ghibli soft" spellcheck="false" autocomplete="off" required></label>
      <p class="dim mono lb-id">looks/${esc(slug(f.name || '') || '…')}/</p>
      ${f.how === 'style' ? `<p class="dim">Style: <b>${esc(f.styleName || '…')}</b> (${esc(f.styleFrom || 'looking…')})</p>` : ''}
      ${err}<span class="sp-btns"><button type="button" class="tbtn" data-a="form-cancel">Cancel</button><button type="submit" class="tbtn primary">Create</button></span></form>`;
  }
  const what = f.kind === 'preset' ? 'preset' : 'palette';
  return `<form class="lb-form" data-form="${f.kind}"><h3>New ${what}</h3>
    <label>Name <input type="text" name="name" value="${esc(f.name || '')}" placeholder="lowercase-with-dashes" spellcheck="false" autocomplete="off" required></label>
    ${f.kind === 'preset' ? `<label>Start from <select name="from">${Object.keys(BUILTIN).map((b) => `<option value="${esc(b)}">${esc(b)} (built-in)</option>`).join('')}</select></label>` : ''}
    ${err}<span class="sp-btns"><button type="button" class="tbtn" data-a="form-cancel">Cancel</button><button type="submit" class="tbtn primary">Create</button></span></form>`;
}
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64).replace(/-+$/, '');
function setForm(f) {
  LB.form = f;
  const old = el.querySelector('.lb-form');
  const html = formHtml();
  if (old) { if (html) old.outerHTML = html; else old.remove(); } else render();
  el.querySelector('.lb-form input[name=name]')?.focus();
}

/** New look: 'claude' = the dialog; 'blank' / 'style' = the instant inline form (a name, then Create). */
function newLook(how) {
  if (how === 'claude') return openLookDialog();
  LB.tab = 'looks';
  const f = { kind: 'look', how, name: '' };
  if (how === 'style') projectStyle().then((st) => { if (LB.form === f) { f.styleName = st.name; f.styleFrom = st.from; setForm(f); } }).catch(() => {});
  return setForm(f);
}

/** "From this project's style": the project's look preset, else the first scene's style (project preset, else built-in). */
async function projectStyle() {
  const st = LB.status?.look;
  if (st?.id) { const t = await api.readText(`looks/${st.id}/preset.js`).catch(() => null); if (t) return { name: st.id, from: `looks/${st.id}/preset.js`, text: t }; }
  const scenes = await api.listProjectScenes().catch(() => []);
  const first = scenes.find((s) => s.name === S.name) || scenes[0];
  let style = null;
  if (first) { try { style = JSON.parse(await api.readText(`scenes/${first.name}/scene.json`) || '{}').style || null; } catch { /* none */ } }
  style = style || 'dark-grid';
  const own = await api.readText(`style/presets/${style}.js`).catch(() => null);
  if (own) return { name: style, from: `style/presets/${style}.js`, text: own };
  if (BUILTIN[style]) return { name: style, from: 'built-in preset', text: BUILTIN[style] };
  return { name: 'dark-grid', from: 'built-in preset (default)', text: BUILTIN['dark-grid'] || '' };
}

async function submitForm(form) {
  const f = LB.form, name = form.querySelector('[name=name]').value.trim();
  f.name = name;
  try {
    if (f.kind === 'look') {
      const id = slug(name);
      if (!validId(id)) throw new Error('Give the look a name (letters or digits).');
      if (lookIds().includes(id)) throw new Error(`looks/${id} already exists in the Library.`);
      const st = f.how === 'style' ? await projectStyle() : null;
      await api.libraryWrite(`looks/${id}/LOOK.md`, blankLook(name, { description: st ? `Based on the ${st.name} style.` : '' }));
      await api.libraryWrite(`looks/${id}/preset.js`, renamePreset(st?.text || BUILTIN['dark-grid'] || 'export default {\n  name: \'\',\n  colors: {},\n};\n', id));
      await api.libraryWrite(`looks/${id}/sounds.json`, '[]\n');
      LB.form = null;
      await loadFiles();
      LB.tab = 'looks'; LB.view = { kind: 'look', id, file: 'LOOK.md' };
      await text(`looks/${id}/LOOK.md`);
      render();
      emit('toast', { m: `Look "${name}" created in the Library`, ms: 2500 });
      return;
    }
    const n = slug(name);
    if (!validId(n)) throw new Error('Use lowercase letters, digits and dashes.');
    if (f.kind === 'preset') {
      if (presetNames().includes(n)) throw new Error(`presets/${n}.js already exists.`);
      const from = form.querySelector('[name=from]').value;
      await api.libraryWrite(`presets/${n}.js`, renamePreset(BUILTIN[from] || 'export default {\n  name: \'\',\n  colors: {},\n};\n', n));
      LB.form = null; await loadFiles(); LB.view = { kind: 'preset', name: n }; render();
    } else {
      if (paletteNames().includes(n)) throw new Error(`palettes/${n}.json already exists.`);
      await api.libraryWrite(`palettes/${n}.json`, '[]\n');
      LB.form = null; await loadFiles(); LB.view = { kind: 'palette', name: n }; render();
    }
  } catch (e) { f.err = String(e.message || e); setForm(f); }
}

// ---------- Claude: New look dialog, Rebuild sample (docs/LOOK-PIPELINE.md §5) ----------
const TO_KEY = 'gfx-studio.newlook.to';
const t3Why = () => { const st = t3.t3Status(); return !st?.connected ? 'Connect T3 first (T3 button in the top bar)' : !t3.canOperate() ? 'Sending needs Standard or Full access (⚙ → Integrations → Change access…)' : ''; };
/** The Library folder as the project's Claude sees it (WSL paths for a WSL project). */
const claudeLib = () => claudeLibPath(LB.dir, wslProject(S.root, LB.dir));
/** Send to Claude in the terminal or a new T3 thread; the Library page closes so the terminal / T3 panel shows. */
async function sendClaude(message, to, title) {
  if (to === 't3') { const r = await t3.send({ target: 'new', message, title }); emit('toast', { m: `Sent to T3: ${r?.title || title}. The Library shows the look when you come back.`, ms: 4000 }); }
  else { await sendToClaude(message, { send: true }); emit('toast', { m: 'Sent to Claude in the terminal. The Library shows the look when you come back.', ms: 4000 }); }
  await closeLibrary();
}
function rebuildSampleMenu(b, id) {
  const why = t3Why(), noProj = projectOpen() ? '' : 'open a project';
  const go = (to) => sendClaude(rebuildSampleMessage(id, claudeLib()), to, `Look ${id}: sample`).catch((e) => emit('toast', { m: `Rebuild sample: ${e.message || e}`, ms: 6000 }));
  openMenu(b, [
    { id: 'term', label: 'Send to Claude in the terminal', disabled: !!noProj, hint: noProj, run: () => go('term') },
    { id: 't3', label: 'Send to a new T3 thread', disabled: !!noProj || !!why, hint: noProj || (why ? 'T3 not ready' : ''), run: () => go('t3') },
  ]);
}

const NL = { dlg: null, refs: [], busy: false, createdId: '', behind: null, prev: null };
const nq = (s) => NL.dlg?.querySelector(s);
function openLookDialog() {
  if (NL.dlg) { nq('#nl-name')?.focus(); return; }
  if (!projectOpen()) { emit('toast', { m: 'Open a project first: Claude makes the look from a project', ms: 3000 }); return; }
  NL.refs = []; NL.busy = false; NL.createdId = ''; NL.prev = document.activeElement;
  const why = t3Why(), to = !why && localStorage.getItem(TO_KEY) === 't3' ? 't3' : 'term';
  const d = document.createElement('div');
  d.className = 'modal-back'; d.id = 'nl-dlg';
  d.innerHTML = `<div class="modal ns nl" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="nl-title">
    <div class="modal-head"><b id="nl-title">New look with Claude</b><span class="ns-sub dim">into the Library: looks/&lt;id&gt;/</span><span class="spacer"></span><button type="button" class="link ns-x" data-a="nl-cancel" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <form class="ns-form" autocomplete="off" novalidate>
      <div class="ns-body">
        <label class="ns-f"><span class="ns-l">Name</span>
          <input id="nl-name" type="text" placeholder="e.g. Ghibli soft" spellcheck="false" maxlength="64" aria-describedby="nl-name-msg">
          <small id="nl-name-msg" class="ns-msg mono" aria-live="polite">looks/…/</small></label>
        <label class="ns-f"><span class="ns-l">Prompt</span>
          <textarea id="nl-prompt" rows="6" placeholder="What should the look feel like? Mood, pacing, colour, type, sound…" aria-describedby="nl-prompt-msg"></textarea>
          <small id="nl-prompt-msg" class="ns-msg" aria-live="polite"></small></label>
        <label class="ns-f"><span class="ns-l">Notes</span>
          <textarea id="nl-notes" rows="2" placeholder="Optional: must-haves, things to avoid, where it will be used"></textarea></label>
        <div class="ns-f"><span class="ns-l">References</span>
          <div class="ns-pair"><button type="button" class="tbtn" data-a="nl-files">Add files…</button><input id="nl-link" type="text" placeholder="or paste a link (https://…) and press Enter" spellcheck="false"><button type="button" class="tbtn" data-a="nl-link">Add link</button></div>
          <small id="nl-ref-msg" class="ns-msg" aria-live="polite">Images or videos, each with a note: what to take from it. Files are copied into the look's refs/.</small>
          <ul id="nl-refs" class="ns-refs"></ul></div>
        <div class="ns-f"><span class="ns-l">Start from</span>
          <div class="ns-row"><div class="seg ns-seg" role="radiogroup" aria-label="Start from">${[['prompt', 'Prompt only'], ['references', 'References'], ['project', 'This project'], ['both', 'Both']].map(([v, l]) => `<label><input type="radio" name="nl-from" value="${v}"${v === 'prompt' ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
            <label class="chk" title="A 6 s test card in the look's style + its thumbnail and preview clip"><input type="checkbox" id="nl-sample" checked> Sample scene</label></div>
          <small class="ns-msg dim" id="nl-from-msg"></small></div>
        <div class="ns-f"><span class="ns-l">Send to</span>
          <div class="ns-row"><div class="seg ns-seg" role="radiogroup" aria-label="Send to">
            <label><input type="radio" name="nl-to" value="term"${to === 'term' ? ' checked' : ''}><span>Terminal</span></label>
            <label title="${esc(why || 'Start a new T3 thread in this project')}"><input type="radio" name="nl-to" value="t3"${to === 't3' ? ' checked' : ''}${why ? ' disabled' : ''}><span>New T3 thread</span></label></div>
            <small class="dim">${esc(why)}</small></div></div>
      </div>
      <div class="ns-messages"><div class="ns-status" role="status" aria-live="polite" hidden></div></div>
      <div class="modal-foot"><small class="dim ns-foot">Claude gets: <code></code></small><span class="spacer"></span>
        <button type="button" class="tbtn" data-a="nl-cancel">Cancel</button>
        <button type="submit" class="tbtn primary" id="nl-send">Write brief &amp; send</button></div>
    </form></div>`;
  NL.dlg = d;
  wireLookDialog();
  NL.behind = [...document.body.children].filter((x) => !x.inert);
  for (const x of NL.behind) x.inert = true;
  document.body.appendChild(d);
  nlUpdate();
  nq('#nl-name').focus();
}
function closeLookDialog() {
  if (!NL.dlg) return;
  for (const x of NL.behind || []) x.inert = false;
  NL.behind = null;
  NL.dlg.remove(); NL.dlg = null; NL.busy = false;
  try { if (NL.prev?.isConnected) NL.prev.focus({ preventScroll: true }); } catch { /* gone */ }
}
export const lookDialogOpen = () => !!NL.dlg;
const nlId = () => slug(nq('#nl-name')?.value || '');
function nlNameError() {
  const v = nq('#nl-name').value.trim(), id = nlId();
  if (!v) return 'Give the look a name.';
  if (!validId(id)) return 'Use letters or digits in the name.';
  if (lookIds().includes(id) && id !== NL.createdId) return `looks/${id} already exists in the Library.`;
  return '';
}
function nlUpdate({ showErr = false } = {}) {
  const id = nlId(), err = nlNameError(), m = nq('#nl-name-msg');
  m.textContent = showErr && err ? err : `looks/${id || '…'}/${!showErr && err && nq('#nl-name').value.trim() ? ` · ${err}` : ''}`;
  m.classList.toggle('err', !!(err && (showErr || nq('#nl-name').value.trim())));
  nq('#nl-name').setAttribute('aria-invalid', err && (showErr || nq('#nl-name').value.trim()) ? 'true' : 'false');
  const from = nq('input[name=nl-from]:checked')?.value || 'prompt';
  nq('#nl-from-msg').textContent = { prompt: 'Claude designs from the prompt alone: nothing is measured, every rule is a judgement call.', references: 'Claude measures the references (gfx look analyze) and reads the prompt.', project: `Claude measures this project (${S.projectName}): presets, scene code, timings, sounds.`, both: 'Claude measures the references and this project together.' }[from];
  nq('.ns-foot code').textContent = nq('.ns-foot').title = makeLookMessage(id || '<id>', claudeLib());
}
function nlRefMsg(m, err = false) { const x = nq('#nl-ref-msg'); x.textContent = m; x.classList.toggle('err', err); }
function nlRenderRefs() {
  if (NL.refs.length) { const r = nq('input[name=nl-from][value=references]'); if (nq('input[name=nl-from]:checked')?.value === 'prompt' && r) { r.checked = true; nlUpdate(); } } // references added: measure them
  nq('#nl-refs').innerHTML = NL.refs.map((r, i) => {
    const what = r.url || r.src.split(/[\\/]/).pop();
    return `<li data-i="${i}"><span class="ns-rtag ${r.url ? 'link' : 'file'}">${r.url ? 'link' : 'file'}</span><span class="ns-rname" title="${esc(r.url || r.src)}">${esc(what)}</span>
      <input type="text" class="ns-rnote" data-i="${i}" value="${esc(r.note)}" placeholder="Note (optional): what to take from it" aria-label="Note for ${esc(what)}">
      <button type="button" class="link ns-rdel" data-a="nl-del-ref" data-i="${i}" aria-label="Remove ${esc(what)}" title="Remove">&times;</button></li>`;
  }).join('');
}
function nlAddLink() {
  const inp = nq('#nl-link'), u = inp.value.trim();
  if (!u) return;
  if (!/^https?:\/\/\S+$/i.test(u)) { nlRefMsg('Links start with http:// or https://', true); return; }
  if (!NL.refs.some((r) => r.url === u)) NL.refs.push({ url: u, note: '' });
  inp.value = ''; nlRefMsg('Images or videos, each with a note: what to take from it. Files are copied into the look\'s refs/.'); nlRenderRefs();
}
async function nlAddFiles() {
  let picked = [];
  try { picked = await api.pickRefs(); } catch (e) { nlRefMsg(`Add files: ${e.message || e}`, true); return; }
  if (!NL.dlg) return;
  for (const p of Array.isArray(picked) ? picked : []) if (typeof p === 'string' && p && isMedia(p) && !NL.refs.some((r) => r.src === p)) NL.refs.push({ src: p, note: '' });
  nlRenderRefs();
}
function nlStatus(msg, kind = '') {
  const x = nq('.ns-status');
  x.hidden = !msg; x.className = `ns-status ${kind}`;
  x.innerHTML = msg ? `${kind === 'busy' ? '<i class="spin"></i> ' : ''}<span></span>` : '';
  if (msg) x.querySelector('span').textContent = msg;
}
function nlBusy(b) {
  NL.busy = b;
  for (const x of NL.dlg.querySelectorAll('button, input, select, textarea')) {
    if (b) { x.dataset.wasDisabled = x.disabled ? '1' : ''; x.disabled = true; }
    else { x.disabled = x.dataset.wasDisabled === '1'; delete x.dataset.wasDisabled; }
  }
}
function wireLookDialog() {
  const d = NL.dlg;
  d.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a || NL.busy) return;
    if (a === 'nl-cancel') closeLookDialog();
    else if (a === 'nl-files') nlAddFiles();
    else if (a === 'nl-link') nlAddLink();
    else if (a === 'nl-del-ref') { NL.refs.splice(+e.target.closest('[data-i]').dataset.i, 1); nlRenderRefs(); }
  });
  d.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'nl-name') nlUpdate();
    else if (t.id === 'nl-prompt') { nq('#nl-prompt-msg').textContent = ''; nq('#nl-prompt-msg').classList.remove('err'); }
    else if (t.classList.contains('ns-rnote')) NL.refs[+t.dataset.i].note = t.value;
  });
  d.addEventListener('change', (e) => { if (e.target.name === 'nl-from') nlUpdate(); });
  nq('#nl-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nlAddLink(); } });
  nq('form').addEventListener('submit', (e) => { e.preventDefault(); submitLookDialog(); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!NL.busy) closeLookDialog(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); submitLookDialog(); return; }
    if (e.key === 'Tab') { // focus stays in the dialog
      const f = [...d.querySelectorAll('button, input, select, textarea')].filter((x) => !x.disabled && x.offsetParent !== null && x.tabIndex >= 0 && !(x.type === 'radio' && !x.checked));
      const i = f.indexOf(document.activeElement);
      if (f.length && e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
      else if (f.length && !e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();
  });
}
/** Write looks/<id>/BRIEF.md (+ copy the reference files into refs/), then send Claude "Make the look <id> …". */
async function submitLookDialog() {
  if (NL.busy || !NL.dlg) return;
  const name = nq('#nl-name').value.trim(), id = nlId(), prompt = nq('#nl-prompt').value, notes = nq('#nl-notes').value;
  const startFrom = nq('input[name=nl-from]:checked')?.value || 'prompt', sample = nq('#nl-sample').checked, to = nq('input[name=nl-to]:checked')?.value || 'term';
  if (nlNameError()) { nlUpdate({ showErr: true }); nq('#nl-name').focus(); return; }
  if (!prompt.trim() && !NL.refs.length && (startFrom === 'references' || startFrom === 'prompt')) {
    const m = nq('#nl-prompt-msg'); m.textContent = 'Write a prompt, add references, or start from this project.'; m.classList.add('err'); nq('#nl-prompt').focus(); return;
  }
  nlBusy(true); nlStatus('');
  const dlg = NL.dlg;
  try {
    const project = claudeLibPath(S.root || '', wslProject(S.root, LB.dir)); // the project as its Claude sees it (WSL path for WSL projects)
    const brief = () => lookBriefText({ name, prompt, notes, startFrom, sample, project, refs: NL.refs.map((r) => ({ url: r.url, rel: r.rel || (r.src ? `refs/${cleanFileName(r.src.split(/[\\/]/).pop())}` : ''), note: r.note })) });
    nlStatus(`Writing looks/${id}/BRIEF.md…`, 'busy');
    await api.libraryWrite(`looks/${id}/BRIEF.md`, brief()); // creates the look folder (library_import needs it)
    NL.createdId = id;
    const taken = new Set(filesUnder(`looks/${id}/refs/`).map((f) => f.path.split('/').pop()));
    for (const r of NL.refs) {
      if (!r.src || r.rel) continue;
      nlStatus(`Copying ${r.src.split(/[\\/]/).pop()}…`, 'busy');
      const want = uniqueName(cleanFileName(r.src.split(/[\\/]/).pop()), taken);
      const rel = await api.libraryImport(r.src, `looks/${id}/refs/${want}`); // never overwrites: it may pick "<name>-2.<ext>"
      r.rel = `refs/${String(rel).split('/').pop()}`; taken.add(r.rel.slice(5));
    }
    if (NL.refs.some((r) => r.src)) await api.libraryWrite(`looks/${id}/BRIEF.md`, brief()); // the names the copies got
    await loadFiles();
    nlStatus(to === 't3' ? 'Starting a T3 thread…' : 'Sending to Claude in the terminal…', 'busy');
    localStorage.setItem(TO_KEY, to);
    const message = makeLookMessage(id, claudeLib());
    if (to === 't3') await t3.send({ target: 'new', message, title: `Look: ${name}` });
    else await sendToClaude(message, { send: true });
    if (NL.dlg !== dlg) return;
    nlBusy(false);
    closeLookDialog();
    emit('toast', { m: `Brief written (looks/${id}/BRIEF.md) and sent to ${to === 't3' ? 'a new T3 thread' : 'Claude in the terminal'}. The Library shows the look when you come back.`, ms: 5000 });
    await closeLibrary();
  } catch (e) {
    if (NL.dlg !== dlg) return;
    nlBusy(false);
    nlStatus(`${String(e.message || e)}${NL.createdId ? ` (looks/${NL.createdId}/BRIEF.md is written: fix the problem, then send again)` : ''}`, 'err');
    if (NL.createdId) { nq('#nl-name').readOnly = true; nq('#nl-send').textContent = 'Send again'; }
  }
}

// ---------- detail views ----------
function viewHtml() {
  const v = LB.view;
  if (v.kind === 'compare') return compareHtml(v.id);
  if (v.kind === 'look') {
    const inProject = LB.status?.look?.id === v.id;
    const tabs = [['LOOK.md', 'LOOK.md'], ['preset.js', 'preset.js'], ['sounds', 'Sound palette'], ['refs', 'References'], ['preview', 'Preview']];
    return `<div class="lb-vhead"><button type="button" class="tbtn" data-a="list">&larr; Looks</button><h2>${esc(lookName(v.id))}</h2><span class="mono dim">looks/${esc(v.id)}/</span><span class="spacer"></span>
        <button type="button" class="tbtn primary" data-a="use-look"${projectOpen() && !LB.busy ? '' : ' disabled'}>${inProject ? 'Use again' : 'Use in this project'}</button>
        <button type="button" class="tbtn" data-a="dup-look">Duplicate</button><button type="button" class="tbtn lb-del" data-a="del-look">Delete</button></div>
      <div class="lb-ftabs" role="tablist">${tabs.map(([id, l]) => `<button type="button" role="tab" data-file="${id}" class="${v.file === id ? 'on' : ''}" aria-selected="${v.file === id}">${l}</button>`).join('')}</div>
      <div class="lb-file" data-look="${esc(v.id)}"></div>`;
  }
  if (v.kind === 'preset') return `<div class="lb-vhead"><button type="button" class="tbtn" data-a="list">&larr; Presets</button><h2>${esc(v.name)}</h2><span class="mono dim">presets/${esc(v.name)}.js</span></div><div class="lb-file"></div>`;
  return `<div class="lb-vhead"><button type="button" class="tbtn" data-a="list">&larr; Sound palettes</button><h2>${esc(v.name)}</h2><span class="mono dim">palettes/${esc(v.name)}.json</span></div><div class="lb-file"></div>`;
}
function mountView() {
  const v = LB.view, box = el.querySelector('.lb-file');
  if (v.kind === 'compare') return mountCompare(v.id);
  if (v.kind === 'preset') return mountEditor(box, `presets/${v.name}.js`);
  if (v.kind === 'palette') return mountPalette(box, `palettes/${v.name}.json`);
  if (v.file === 'LOOK.md' || v.file === 'preset.js') return mountEditor(box, `looks/${v.id}/${v.file}`);
  if (v.file === 'sounds') return mountPalette(box, `looks/${v.id}/sounds.json`);
  if (v.file === 'preview') return mountPreview(box, v.id);
  return mountRefs(box, v.id);
}

// ---------- Preview tab: the sample's clip, Re-render preview (`gfx look preview`), Rebuild sample with Claude… ----------
const PV = { jobs: new Map() }; // look id -> { jobId, text, pct, finished, err }
/** The reserved status line: a progress bar + text + Cancel while `gfx look preview` runs, else the last result. The line
 *  and its Cancel button are always there (hidden by visibility), so nothing moves when a render starts or ends. */
function pvStatusHtml(id) {
  const j = PV.jobs.get(id), run = !!j && !j.finished;
  const kind = run ? 'progress' : j?.err ? 'error' : j?.finished ? 'ok' : 'none';
  const text = run ? j.text || 'Starting gfx look preview…' : j?.err || (j?.finished ? j.text : '');
  return `<div class="lb-pv-st" data-st="${kind}"><span class="lb-snd-prog${run && j.pct == null ? ' ind' : ''}" role="progressbar" aria-label="Preview render"${run ? '' : ' hidden'}><i style="width:${run ? j.pct ?? 35 : 0}%"></i></span>
    <span class="lb-snd-msg" title="${esc(text)}">${esc(text)}</span><button type="button" class="tbtn sm" data-a="pv-cancel"${run ? '' : ' hidden'}>Cancel</button></div>`;
}
function paintPvStatus(id) {
  const box = el?.querySelector(`.lb-pv[data-look="${CSS.escape(id)}"]`);
  if (!box) return;
  const j = PV.jobs.get(id), st = box.querySelector('.lb-pv-st'), run = !!j && !j.finished;
  if (run && st?.dataset.st === 'progress') { // in place: Cancel stays the same node under the pointer
    const bar = st.querySelector('.lb-snd-prog');
    bar.classList.toggle('ind', j.pct == null); bar.querySelector('i').style.width = `${j.pct ?? 35}%`;
    st.querySelector('.lb-snd-msg').textContent = j.text || 'Starting gfx look preview…';
  } else st.outerHTML = pvStatusHtml(id);
  const r = box.querySelector('[data-a=pv-render]'); if (r) r.disabled = run || !lookFiles(LB.files, id).sample;
}
async function mountPreview(box, id) {
  const lf = lookFiles(LB.files, id), run = PV.jobs.get(id)?.finished === false;
  const noSample = 'This look has no sample/ yet: "Rebuild sample with Claude…" makes one.';
  box.innerHTML = `<div class="lb-pv" data-look="${esc(id)}"><div class="lb-edbar"><span class="mono dim">looks/${esc(id)}/preview.mp4</span><span class="dim">${lf.sample ? 'from sample/ (the test card in this look)' : 'no sample/ yet'}</span><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="pv-render"${!lf.sample || run ? ' disabled' : ''} title="${esc(lf.sample ? 'gfx look preview: renders sample/ into thumb.jpg + preview.mp4' : noSample)}">Re-render preview</button>
      <button type="button" class="tbtn" data-a="pv-claude" aria-haspopup="menu" title="Claude rebuilds sample/ from the test card brief, then renders the preview">Rebuild sample with Claude…</button></div>
    ${pvStatusHtml(id)}
    <div class="lb-pv-stage">${lf.preview ? `<video controls muted loop playsinline${reducedMotion() ? '' : ' autoplay'} aria-label="Preview of ${esc(id)}"></video>` : lf.thumb ? '<img alt="">' : `<p class="dim">${esc(lf.sample ? 'No preview yet: Re-render preview makes thumb.jpg and preview.mp4.' : noSample)}</p>`}</div></div>`;
  const [thumb, clip] = await Promise.all([mediaUrl(lf.thumb, lf.thumb?.path.endsWith('.png') ? 'image/png' : 'image/jpeg'), mediaUrl(lf.preview, 'video/mp4')]);
  const stage = box.querySelector('.lb-pv-stage');
  if (!stage?.isConnected) return;
  const v = stage.querySelector('video'), img = stage.querySelector('img');
  if (v) { if (thumb) v.poster = thumb; if (clip) v.src = clip; else v.replaceWith(Object.assign(document.createElement('p'), { className: 'lb-err', textContent: 'preview.mp4 could not be read.' })); }
  if (img) { if (thumb) img.src = thumb; else img.remove(); }
}
function renderPreview(id) {
  if (!id || PV.jobs.get(id)?.finished === false) return;
  const job = { jobId: '', text: '', pct: null, finished: false, err: '' };
  PV.jobs.set(id, job);
  paintPvStatus(id);
  const run = api.engineRun(['look', 'preview', id, ...libArgs()], {
    progress: true, noProject: !projectOpen(),
    onEvent: (ev) => {
      if (ev.type === 'progress') { const t = previewStatus(ev); if (t) { job.text = t; job.pct = ev.total > 0 && ev.done > 0 ? Math.round(((ev.done || 0) / ev.total) * 100) : null; paintPvStatus(id); } }
      else if ((ev.type === 'error' || (ev.type === 'log' && (ev.level === 'error' || ev.stream === 'stderr'))) && ev.msg) job.lastErr = String(ev.msg).replace(/^gfx: /, '');
    },
  });
  job.jobId = run.jobId;
  run.done.then((res) => {
    job.finished = true;
    if (res.canceled) job.err = 'Cancelled: the previous thumb.jpg / preview.mp4 are kept.';
    else if (res.code || res.error) job.err = `gfx look preview failed: ${job.lastErr || res.error || `exit code ${res.code}`}`;
    else job.text = 'Preview rendered.';
  }, (e) => { job.finished = true; job.err = `gfx look preview failed: ${e.message || e}`; })
    .then(async () => {
      if (!LB.open) return;
      await loadFiles();
      if (LB.view?.kind === 'look' && LB.view.id === id && LB.view.file === 'preview') { const box = el.querySelector('.lb-file'); if (box) mountPreview(box, id); }
      else if (!LB.view && !LB.form) render();
    });
}

// CodeMirror for LOOK.md / preset.js (cm.js, loaded lazily); Save + Ctrl+S, unsaved marker
async function mountEditor(box, rel) {
  box.innerHTML = `<div class="lb-edbar"><span class="mono dim">${esc(rel)}</span><span class="lb-dirty" hidden>unsaved</span><span class="spacer"></span><span class="sp-err lb-ederr" hidden></span>
    <button type="button" class="tbtn" data-a="revert" disabled>Revert</button><button type="button" class="tbtn primary" data-a="save" disabled title="Save (Ctrl+S)">Save</button></div><div class="lb-cm"><p class="dim"><i class="spin"></i> Loading…</p></div>`;
  const [cm, t] = await Promise.all([import('./cm.js'), api.libraryRead(rel).catch((e) => { box.querySelector('.lb-ederr').hidden = false; box.querySelector('.lb-ederr').textContent = String(e.message || e); return null; })]);
  if (!box.isConnected) return;
  const host = box.querySelector('.lb-cm');
  host.innerHTML = '';
  edPath = rel; edSaved = t ?? '';
  editor = cm.createView(host, cm.makeState(rel, edSaved, { onUpdate: () => syncDirty() }));
  editor.__lbRel = rel;
}
const edDirty = () => !!editor && editor.state.doc.toString() !== edSaved;
function syncDirty() {
  const d = edDirty();
  el.querySelector('.lb-dirty')?.toggleAttribute('hidden', !d);
  for (const a of ['save', 'revert']) { const b = el.querySelector(`.lb-edbar [data-a=${a}]`); if (b) b.disabled = !d; }
}
async function saveEditor() {
  if (!editor || !edDirty()) return;
  const t = editor.state.doc.toString(), err = el.querySelector('.lb-ederr');
  try {
    await api.libraryWrite(edPath, t);
    edSaved = t; texts.set(edPath, t); err.hidden = true;
    syncDirty();
    if (edPath.endsWith('/LOOK.md')) { el.querySelector('.lb-vhead h2').textContent = lookName(LB.view.id); el.querySelector('.lb-crumb-item').textContent = lookName(LB.view.id); }
    emit('toast', { m: `Saved ${edPath}`, ms: 1500 });
    refreshStatusSoon();
  } catch (e) { err.hidden = false; err.textContent = String(e.message || e); }
}
function destroyEditor() {
  if (editor) { editor.destroy(); editor = null; }
  if (merge) { merge.destroy?.(); merge = null; }
  stopAudition();
}
/** Leaving an edited file: ask first. */
const leaveOk = async () => !edDirty() || api.ask(`${edPath} has unsaved changes. Discard them?`);

// ---------- sound palette editor ----------
let pal = null; // { rel, entries, err }
async function mountPalette(box, rel) {
  await palSaves.flush();
  let entries = [], err = '';
  try { entries = parsePalette(await api.libraryRead(rel) ?? '[]'); } catch (e) { err = String(e.message || e); }
  if (!LB.open || !box.isConnected) return;
  pal = { rel, entries, err, pick: null };
  renderPalette(box);
}
function soundCell(e, i) {
  if (e.src) {
    const [sid, rest = ''] = String(e.src).split(/:(.*)/s);
    const alt = altLine(e); // the synth fallback when the sample is not in the sound library (docs/LOOK-PIPELINE.md §3), read-only
    return `<span class="lb-sample" title="${esc(e.src)}"><b>${esc(rest.split('/').pop().replace(/\.[^.]+$/, '') || e.src)}</b><small>${esc(sid)} sample</small>${alt ? `<small class="lb-alt" title="Used instead when this sample is not in the sound library (another machine, library not installed)">${esc(alt)}</small>` : ''}</span>`;
  }
  const vars = VARIANTS[e.sound] || [];
  const params = e.params && Object.keys(e.params).length ? `<small class="mono" title="params">${esc(Object.entries(e.params).map(([k, v]) => `${k} ${v}`).join(' · '))}</small>` : '';
  return `<span class="lb-synth"><select data-pf="sound" data-i="${i}" aria-label="Synth sound">${[...new Set([...SOUND_NAMES, e.sound].filter(Boolean))].map((s) => `<option${s === e.sound ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>
    ${vars.length ? `<select data-pf="variant" data-i="${i}" aria-label="Variant"><option value="">auto</option>${vars.map((x) => `<option${x === e.variant ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select>` : ''}${params}</span>`;
}
function renderPalette(box = el.querySelector('.lb-file')) {
  if (!box || !pal) return;
  const rows = pal.entries.map((e, i) => `<tr data-i="${i}"><td><input type="text" data-pf="role" data-i="${i}" value="${esc(e.role)}" placeholder="role" aria-label="Role" spellcheck="false"></td>
      <td>${soundCell(e, i)}</td>
      <td><button type="button" class="tbtn lb-play" data-a="play" data-i="${i}" title="Audition" aria-label="Audition">&#9654;</button></td>
      <td><input type="text" data-pf="tags" data-i="${i}" value="${esc((e.tags || []).join(', '))}" placeholder="tags" aria-label="Tags" spellcheck="false"></td>
      <td><input type="text" data-pf="note" data-i="${i}" value="${esc(e.note || '')}" placeholder="note" aria-label="Note"></td>
      <td><button type="button" class="tbtn lb-x" data-a="pal-del" data-i="${i}" title="Remove" aria-label="Remove">&times;</button></td></tr>`).join('');
  box.innerHTML = `<div class="lb-edbar"><span class="mono dim">${esc(pal.rel)}</span><span class="dim">saved as you edit</span><span class="spacer"></span><span class="sp-err lb-palerr"${pal.err ? '' : ' hidden'}>${esc(pal.err)}</span></div>
    <table class="lb-pal"><thead><tr><th>Role</th><th>Sound</th><th></th><th>Tags</th><th>Note</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="dim lb-none">No sounds yet.</td></tr>'}</tbody></table>
    <span class="sp-btns lb-paladd"><button type="button" class="tbtn" data-a="pal-add-synth">+ Synth sound</button><button type="button" class="tbtn" data-a="pal-add-lib">+ From sound library…</button></span>
    ${pal.pick ? pickerHtml() : ''}`;
  if (pal.pick) { const q = box.querySelector('.lb-pick-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
}
const palSaves = paletteSaver(async (target, rel, text) => {
  try { await api.libraryWrite(rel, text); texts.set(rel, text); target.err = ''; refreshStatusSoon(); }
  catch (e) { target.err = String(e.message || e); }
  const er = target === pal && el?.querySelector('.lb-palerr');
  if (er) { er.hidden = !target.err; er.textContent = target.err; }
});
function savePalette() { return palSaves.save(pal); }

// sound-library picker: name / path filter over the loaded index (soundindex.js), plus CLAP text search (gfx lib search)
function pickerHtml() {
  const p = pal.pick;
  const res = p.results.slice(0, 60).map((h, i) => `<li><button type="button" class="tbtn lb-play" data-a="pick-play" data-pi="${i}" aria-label="Audition">&#9654;</button><span class="lb-pick-name" title="${esc(h.id)}"><b>${esc(h.name)}</b><small>${esc(h.detail)}</small></span>${h.score != null ? `<small class="mono dim">${h.score.toFixed(3)}</small>` : ''}<button type="button" class="tbtn" data-a="pick-add" data-pi="${i}">Add</button></li>`).join('');
  return `<div class="lb-pick" role="dialog" aria-label="Add from the sound library"><div class="lb-bar"><input type="search" class="lb-pick-q" placeholder="Search the sound library by name or pack (e.g. whoosh, click, digital)" value="${esc(p.q)}" spellcheck="false" autocomplete="off">
      <button type="button" class="tbtn" data-a="pick-clap" title="Describe the sound in words; uses the CLAP index (gfx lib search)"${p.busy ? ' disabled' : ''}>Smart search</button><button type="button" class="tbtn" data-a="pick-close">Close</button></div>
    <p class="dim lb-pick-st">${esc(p.status)}</p><ul class="lb-pick-res">${res}</ul></div>`;
}
let idx = null;
async function indexMod() { idx = idx || soundIndex; return idx; }
async function openPicker() {
  pal.pick = { q: '', results: [], status: 'Loading the sound library index…', busy: false };
  renderPalette();
  try {
    const v = await indexMod();
    await v.loadSources();
    const n = v.V.sources.filter((s) => s.id !== 'synth').reduce((a, s) => a + (v.V.index.get(s.id)?.length || 0), 0);
    if (pal?.pick) { pal.pick.status = n ? `${n} sounds indexed. Type to filter by name or pack; Smart search describes the sound in words.` : 'No indexed library sounds (gfx lib index). Smart search needs the index too.'; filterPicker(); }
  } catch (e) { if (pal?.pick) { pal.pick.status = `Sound library: ${e.message || e}`; renderPalette(); } }
}
function filterPicker() {
  const p = pal?.pick;
  if (!p || !idx) return;
  const words = p.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const s of idx.V.sources) {
    if (s.id === 'synth') continue;
    for (const e of idx.V.index.get(s.id) || []) {
      const hay = `${e.id} ${e.src || ''}`.toLowerCase();
      if (words.length && !words.every((w) => hay.includes(w))) continue;
      const d = idx.describe(e);
      out.push({ id: e.id, name: d.name, detail: `${d.detail}${d.license ? ` · ${d.license}` : ''}` });
      if (out.length >= 60) break;
    }
    if (out.length >= 60) break;
  }
  p.results = out;
  const st = el.querySelector('.lb-pick-st');
  if (st) st.textContent = p.status;
  const ul = el.querySelector('.lb-pick-res');
  if (ul) { const html = pickerHtml(); const tmp = document.createElement('div'); tmp.innerHTML = html; ul.replaceWith(tmp.querySelector('.lb-pick-res')); }
  else renderPalette();
}
/** A synth entry of the sound-library index (`synth:<sound>/<variant>/i<intensity>/d<dur>`) -> { sound, variant, params }. */
function synthOfId(id) {
  const m = /^synth:([a-z]+)(?:\/(.*))?$/.exec(id);
  if (!m || !SOUND_NAMES.includes(m[1])) return null;
  const out = { sound: m[1], variant: '', params: {} };
  for (const bit of (m[2] || '').split('/').filter(Boolean)) {
    const n = /^([id])(-?[\d.]+)$/.exec(bit);
    if (n) out.params[n[1] === 'i' ? 'intensity' : 'dur'] = +n[2];
    else if ((VARIANTS[m[1]] || []).includes(bit)) out.variant = bit;
  }
  return out;
}
async function clapSearch() {
  const p = pal.pick;
  if (!p.q.trim()) { p.status = 'Type what the sound is like first (e.g. "soft airy whoosh").'; renderPalette(); return; }
  p.busy = true; p.status = 'Smart search (CLAP)…'; renderPalette();
  try {
    const r = await gfx(['lib', 'search', p.q.trim(), '--n', '20']);
    if (r.code) throw new Error(r.msg || 'gfx lib search failed');
    const v = await indexMod();
    const hits = [];
    for (const l of r.out) {
      const m = /^\s*(-?[\d.]+)\s+(\S+)\s+([\d.]+)s/.exec(l);
      if (!m) continue;
      const syn = synthOfId(m[2]);
      if (syn) { hits.push({ id: m[2], synth: syn, name: syn.variant ? `${syn.sound} · ${syn.variant}` : syn.sound, detail: `synth${Object.keys(syn.params).length ? ` · ${Object.entries(syn.params).map(([k, x]) => `${k} ${x}`).join(' · ')}` : ''}`, score: +m[1] }); continue; }
      const d = v.describe(m[2]);
      hits.push({ id: m[2], name: d.name, detail: `${d.detail || m[2]}`, score: +m[1] });
    }
    p.results = hits;
    p.status = hits.length ? `Smart search: ${hits.length} matches for "${p.q.trim()}" (best first).` : (r.out.join(' ') || 'No matches.');
  } catch (e) { p.status = `Smart search: ${e.message || e}`; }
  p.busy = false;
  renderPalette();
}

// audition: synth entries through the harness synth (renderStems, as the draft audition does), samples from the library
let actx = null, playing = null;
function stopAudition() { try { playing?.stop(); } catch { /* ended */ } playing = null; }
async function audition(entry) {
  stopAudition();
  actx = actx || new AudioContext({ sampleRate: SAMPLE_RATE });
  if (actx.state === 'suspended') await actx.resume().catch(() => {});
  let buf, offset = 0, dur;
  if (entry.src) {
    const v = await indexMod();
    const sid = String(entry.src).split(':')[0];
    await v.loadSources().catch(() => {});
    await v.ensureIndex(sid).catch(() => {});
    const e = v.V.entries.get(entry.src);
    if (!e?.src) throw new Error(`${entry.src} is not in the sound library index`);
    buf = await actx.decodeAudioData((await api.readLib(e.src)).slice(0));
    offset = e.start || 0; dur = e.dur ? e.dur + 0.15 : undefined;
  } else {
    const params = entry.params && typeof entry.params === 'object' ? entry.params : {};
    const cue = makeCue(0.05, entry.sound, { ...params, id: 'audition', variant: entry.variant || undefined, stem: 'audition' });
    const len = Math.max(1.2, (Number(params.dur) || 0) * 1.6 + 0.8);
    const st = await renderStems([cue], { duration: len, loader: (src) => api.readLib(src) });
    const [L, R] = st.audition;
    buf = actx.createBuffer(2, L.length, SAMPLE_RATE);
    buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
  }
  const s = actx.createBufferSource();
  s.buffer = buf; s.connect(actx.destination);
  s.start(0, offset, dur);
  playing = s;
  window.__gfxLibraryAudition = { sound: entry.src || entry.sound, at: Date.now(), seconds: buf.duration }; // E2E probe
}
const playSafe = (entry) => audition(entry).catch((e) => emit('toast', { m: `Audition: ${e.message || e}`, ms: 4000 }));

// ---------- references (looks/<id>/refs/) ----------
function mountRefs(box, id) {
  revokeThumbs();
  const refs = filesUnder(`looks/${id}/refs/`).map((f) => f.path).filter((p) => p.split('/').length === 4);
  box.innerHTML = `<div class="lb-edbar"><span class="mono dim">looks/${esc(id)}/refs/</span><span class="dim">Notes about each reference go into LOOK.md → References.</span><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="refs-add">Add references…</button></div>
    <div class="lb-refgrid">${refs.map((r) => `<figure data-ref="${esc(r)}">${isImage(r) ? `<img alt="">` : '<div class="lb-vid">video</div>'}<figcaption><span title="${esc(r)}">${esc(r.split('/').pop())}</span><button type="button" class="tbtn lb-x" data-a="ref-del" title="Delete" aria-label="Delete ${esc(r.split('/').pop())}">&times;</button></figcaption></figure>`).join('') || '<p class="dim lb-none">No references yet.</p>'}</div>`;
  for (const f of box.querySelectorAll('figure')) { const img = f.querySelector('img'); if (img) loadThumb(img, f.dataset.ref); }
}

// ---------- engine actions: use / update / save / seed ----------
let statusTimer = 0;
function refreshStatusSoon() { clearTimeout(statusTimer); statusTimer = setTimeout(async () => { await loadStatus(); afterStatus(); }, 300); }
/** The status changed: the project column always; the page only when it is the plain list (an open form, editor or
 *  compare view is never re-rendered under the user). */
function afterStatus() {
  if (!LB.open) return;
  el.querySelector('.lb-proj').innerHTML = projectHtml();
  if (!LB.view && !LB.form) render();
}
async function busy(label, fn) {
  if (LB.busy) return;
  LB.busy = label; el.querySelector('.lb-proj').innerHTML = projectHtml();
  try { await fn(); } catch (e) { emit('toast', { m: String(e.message || e), ms: 7000 }); }
  LB.busy = '';
  await loadStatus();
  afterStatus();
}
const wf = () => ['--workflow', workflowArg(pref('workflow'))];
async function useLook(id) {
  if (edDirty() && !(await api.ask(`${edPath} has unsaved changes that would not be in the project's copy. Use the look anyway?`))) return;
  await busy(`Using ${id}…`, async () => {
    let r = await gfx(['look', 'use', id, ...libArgs(), ...wf(), '--json']);
    if (r.code && /--force/.test(r.msg)) {
      if (!(await api.ask(`This project already has its own looks/${id}/, different from the Library's.\n\nReplace it with the Library copy? (Cancel keeps it; "Save to library" can keep yours.)`))) return;
      r = await gfx(['look', 'use', id, ...libArgs(), ...wf(), '--force', '--json']);
    }
    if (r.code) throw new Error(`Use look: ${r.msg}`);
    await reloadProject().catch(() => {});
    emit('look-changed', { id });
    emit('toast', { m: `Look "${lookName(id)}" is now this project's look (looks/${id}/, CLAUDE.md updated)`, ms: 3500 });
  });
}
async function updateLook() {
  await busy('Updating from the Library…', async () => {
    const r = await gfx(['look', 'update', ...libArgs(), ...wf(), '--json']);
    const st = r.json?.status;
    if (st === 'conflict') { await loadStatus(); return openCompare(); }
    if (r.code && !st) throw new Error(`Update: ${r.msg}`);
    emit('look-changed', { id: r.json?.look });
    emit('toast', { m: st === 'updated' ? 'Look updated from the Library' : st === 'local-edits' ? 'The Library has no newer version; your edits are kept' : 'The look is up to date', ms: 3000 });
  });
}
async function saveToLibrary(force = false) {
  await busy('Saving to the Library…', async () => {
    let r = await gfx(['look', 'save', ...libArgs(), ...(force ? ['--force'] : []), '--json']);
    if (r.json?.status === 'conflict') {
      if (force || !(await api.ask('The Library has a different version of this look than the one this project pinned.\n\nOverwrite the Library copy with this project\'s?'))) return;
      r = await gfx(['look', 'save', ...libArgs(), '--force', '--json']);
    }
    if (r.code) throw new Error(`Save to library: ${r.msg}`);
    await loadFiles();
    emit('toast', { m: r.json?.status === 'unchanged' ? 'The Library already has this version' : `Saved to the Library (${r.json?.path || LB.dir})`, ms: 3000 });
  });
}
/** Edited here and changed in the Library: show both LOOK.md files side by side, the user picks (a view: nothing
 *  re-renders over it). */
async function openCompare() {
  const id = LB.status?.look?.id;
  if (!id || !(await leaveOk())) return;
  LB.tab = 'looks'; LB.form = null; LB.view = { kind: 'compare', id, name: `Compare ${id}` };
  render();
}
function compareHtml(id) {
  return `<div class="lb-vhead"><button type="button" class="tbtn" data-a="list">&larr; Looks</button><h2>Compare: ${esc(id)}</h2><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="keep-mine" title="gfx look save --force: the Library gets this project's copy">Keep this project's (save to Library)</button>
      <button type="button" class="tbtn primary" data-a="take-lib" title="gfx look use --force: the project gets the Library's copy">Take the Library's</button></div>
    <p class="dim">LOOK.md: left = this project (looks/${esc(id)}/), right = the Library. Other files (preset.js, sounds.json, refs) may differ too; the choice takes or keeps the whole look.</p><div class="lb-merge"></div>`;
}
let merge = null;
async function mountCompare(id) {
  const [mine, theirs, cm] = await Promise.all([api.readText(`looks/${id}/LOOK.md`).catch(() => ''), api.libraryRead(`looks/${id}/LOOK.md`).catch(() => ''), import('./cm.js')]);
  const box = el.querySelector('.lb-merge');
  if (!box || LB.view?.kind !== 'compare') return;
  merge = cm.mergeView(box, mine || '', theirs || '', 'LOOK.md');
}

async function seed() {
  await busy('Adding the starter looks…', async () => {
    const r = await gfx(['look', 'seed', ...libArgs(), '--json']);
    if (r.code) throw new Error(`Starter looks: ${r.msg}`);
    await loadFiles();
    emit('toast', { m: r.json?.seeded?.length ? `Added ${r.json.seeded.join(', ')}` : 'The starter looks are already there', ms: 3000 });
  });
}

// ---------- Sound sources (docs/SOUND-LIBRARY.md §4): the engine's sound library through `gfx lib … --json` ----------
const SND = {
  list: null, dir: '', err: '', loading: false, wsl: false,
  form: null, // { folder, id, license, err, busy }
  jobs: new Map(), // source id -> { jobId, done, total, t0, rate, finished, canceled, err }
  errs: {}, // source id -> the row's last error (shown in its reserved status line)
  // the context the list, jobs and errors belong to: the project root and the sound library (`library` of the list). A
  // switch drops them (a job of the old context keeps running in its library but never paints into the new rows).
  ctx: null, lib: null,
};
/** Forget the list / jobs / errors of another project or sound library. */
function resetSounds(ctx = S.root) {
  SND.ctx = ctx; SND.lib = null; SND.list = null; SND.dir = ''; SND.err = ''; SND.form = null;
  SND.jobs = new Map(); SND.errs = {};
}
// another engine (Settings → Engine folder) may mean another sound library: start over (Settings and Library are never open together)
on('prefs', (e) => { if (e?.keys?.includes('engineDir')) { resetSounds(); if (LB.open && LB.tab === 'sounds') loadSounds(); } });
export const soundState = () => SND; // tests
const sndIds = () => (SND.list || []).map((s) => s.id);
// one sound-library operation at a time: `gfx lib list` (and soundindex.js's fetch of sources.json) must not read sources.json while
// `gfx lib add|enable|disable|remove` rewrites it (a half-written file reads as broken JSON)
let sndChain = Promise.resolve();
const sndOp = (fn) => { const p = sndChain.then(fn, fn); sndChain = p.catch(() => {}); return p; };
const loadSounds = () => { SND.loading = true; return sndOp(loadSoundsNow); };
async function loadSoundsNow() {
  if (SND.ctx !== S.root) resetSounds();
  const ctx = SND.ctx;
  SND.loading = true; SND.err = '';
  renderSounds();
  try {
    const [r, info] = await Promise.all([gfx(['lib', 'list', '--json']), api.engineInfo().catch(() => null)]);
    if (SND.ctx !== ctx || S.root !== ctx) { SND.loading = false; return; } // another project meanwhile: its own load paints
    SND.wsl = wslEngine(S.root, info);
    const l = soundList(parseJsonOut(r.out));
    if (r.code || !l) throw new Error(r.msg || 'gfx lib list --json gave no list');
    const lib = l.dir || null;
    if (SND.lib && lib && lib !== SND.lib) { SND.jobs = new Map(); SND.errs = {}; } // another sound library (engine change)
    SND.lib = lib;
    SND.list = l.sources;
    if (l.dir) SND.dir = l.dir;
    else if (!SND.dir) whereIsSoundLibrary();
  } catch (e) { SND.err = String(e.message || e); SND.list = null; }
  SND.loading = false;
  renderSounds();
}
/** The sound library's folder when the list does not say it: `gfx doctor --json` (library.path). */
async function whereIsSoundLibrary() {
  try { const r = await gfx(['doctor', '--json']); const d = parseJsonOut(r.out)?.library?.path; if (d) { SND.dir = d; const w = el?.querySelector('.lb-snd-dir'); if (w) { w.textContent = d; w.title = d; } } } catch { /* stays "…" */ }
}
/** Replace… and the Shape section read the index through soundindex.js: reload it so adds / toggles / removes count without a restart. */
const reloadIndex = () => sndOp(reloadIndexNow);
async function reloadIndexNow() {
  try { soundIndex.invalidateSources(); await soundIndex.loadSources(); } catch { /* the next reader shows its own error */ }
}
function soundsHtml() {
  const head = `<div class="lb-bar lb-snd-bar"><span class="lb-snd-where">Sound library <span class="mono lb-snd-dir" title="${esc(SND.dir)}">${esc(SND.dir || '…')}</span></span><span class="spacer"></span>
      <button type="button" class="tbtn" data-a="snd-refresh"${SND.loading ? ' disabled' : ''}>Refresh</button><button type="button" class="tbtn primary" data-a="snd-add">Add sound folder…</button></div>
    <p class="dim lb-snd-intro">The engine's sounds: Replace… and Claude (<span class="mono">gfx lib search / similar</span>) use the enabled sources. This is not the Library folder of looks and palettes.</p>`;
  return `${head}${sndFormHtml()}<div class="sp-card lb-snd" role="table" aria-label="Sound sources">${sndRowsHtml()}</div>`;
}
function sndRowsHtml() {
  const hdr = '<div class="lb-snd-row lb-snd-hd" role="row"><span role="columnheader">Source</span><span role="columnheader">Path</span><span role="columnheader">Licence</span><span role="columnheader" title="indexed entries / audio files">Entries</span><span role="columnheader">On</span><span></span></div>';
  if (SND.err) return `${hdr}<p class="lb-err lb-none">${esc(SND.err)}</p>`;
  if (!SND.list) return `${hdr}<p class="dim lb-none"><i class="spin"></i> Reading the sound library…</p>`;
  return hdr + (SND.list.map(sndRowHtml).join('') || '<p class="dim lb-none">No sources.</p>');
}
function sndRowHtml(s) {
  const job = SND.jobs.get(s.id), st = soundRowState(s, job, SND.errs[s.id]), running = !!job && !job.finished;
  const path = s.kind === 'synth' ? '(built-in synth recipes)' : s.path;
  let line = '';
  if (st.status.kind === 'progress') line = `<span class="lb-snd-prog${st.status.pct == null ? ' ind' : ''}" role="progressbar" aria-label="Indexing ${esc(s.id)}"${st.status.pct == null ? '' : ` aria-valuenow="${st.status.pct}" aria-valuemin="0" aria-valuemax="100"`}><i style="width:${st.status.pct ?? 35}%"></i></span><span class="lb-snd-msg">${esc(st.status.text)}</span><button type="button" class="tbtn sm" data-a="snd-cancel">Cancel</button>`;
  else if (st.status.kind !== 'none') line = `<span class="lb-snd-msg" title="${esc(st.status.text)}">${esc(st.status.text)}</span>`;
  return `<div class="lb-snd-row" role="row" data-snd="${esc(s.id)}">
      <span class="lb-snd-id" role="cell"><b title="${esc(s.id)}">${esc(s.id)}</b><small>${esc(s.project ? 'project' : s.kind)}</small></span>
      <span class="mono lb-snd-path" role="cell" title="${esc(s.dir && s.dir !== s.path ? `${path}\n${s.dir}` : path)}">${esc(path)}</span>
      <span class="lb-snd-lic" role="cell" title="${esc(s.license)}">${esc(s.license || '—')}</span>
      <span class="mono lb-snd-n" role="cell">${esc(st.entries)}</span>
      <span role="cell"><input type="checkbox" class="lb-snd-on" aria-label="Enable ${esc(s.id)}"${s.enabled ? ' checked' : ''}${st.canToggle && !running ? '' : ' disabled'}${st.readOnly ? ' title="from gfx.json"' : ''}></span>
      <span role="cell"><button type="button" class="tbtn lb-x" data-a="snd-menu" aria-haspopup="menu" aria-label="More for ${esc(s.id)}" title="Re-index, remove">&#8943;</button></span>
      <div class="lb-snd-st" data-st="${st.status.kind}">${line}</div></div>`;
}
/** Repaint the tab's content in place (no-op when the tab is not showing). */
function renderSounds() {
  if (!LB.open || LB.tab !== 'sounds' || LB.view || !el) return;
  const card = el.querySelector('.lb-snd');
  if (!card) return render();
  card.innerHTML = sndRowsHtml();
  const w = el.querySelector('.lb-snd-dir'); if (w && SND.dir) { w.textContent = SND.dir; w.title = SND.dir; } // the header is built once; the folder can arrive later
  const r = el.querySelector('[data-a=snd-refresh]'); if (r) r.disabled = SND.loading;
  const c = el.querySelector('[data-count=sounds]'); if (c) c.textContent = SND.list ? String(SND.list.length) : '';
}
function paintSoundRow(id) {
  const row = el?.querySelector(`.lb-snd-row[data-snd="${CSS.escape(id)}"]`), s = SND.list?.find((x) => x.id === id);
  if (!row || !s) return;
  const st = soundRowState(s, SND.jobs.get(id), SND.errs[id]), line = row.querySelector('.lb-snd-st');
  if (st.status.kind === 'progress' && line?.dataset.st === 'progress') { // in place: Cancel stays the same node under the pointer
    const bar = line.querySelector('.lb-snd-prog');
    bar.classList.toggle('ind', st.status.pct == null);
    bar.querySelector('i').style.width = `${st.status.pct ?? 35}%`;
    if (st.status.pct != null) { bar.setAttribute('aria-valuenow', String(st.status.pct)); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100'); }
    line.querySelector('.lb-snd-msg').textContent = st.status.text;
    return;
  }
  const focus = row.contains(document.activeElement) ? document.activeElement.dataset.a || (document.activeElement.classList.contains('lb-snd-on') ? 'on' : '') : '';
  row.outerHTML = sndRowHtml(s);
  if (focus) el.querySelector(`.lb-snd-row[data-snd="${CSS.escape(id)}"] ${focus === 'on' ? '.lb-snd-on' : `[data-a=${focus}]`}`)?.focus({ preventScroll: true });
}
function sndFormHtml() {
  const f = SND.form;
  if (!f) return '';
  return `<form class="lb-form lb-snd-form" data-form="sound"><h3>Add sound folder</h3>
      <p class="mono dim lb-snd-folder" title="${esc(f.folder)}">${esc(f.folder)}</p>
      <label>Source id <input type="text" name="sid" value="${esc(f.id)}" spellcheck="false" autocomplete="off" required aria-describedby="lb-snd-ferr"></label>
      <label>Licence <input type="text" name="lic" value="${esc(f.license)}" list="lb-snd-lics" placeholder="e.g. CC0, CC-BY 4.0, own, royalty-free" spellcheck="false" autocomplete="off"></label>
      <datalist id="lb-snd-lics">${SOUND_LICENSES.map((l) => `<option value="${esc(l)}"></option>`).join('')}</datalist>
      <p class="dim">gfx only reads these files: it indexes them (sound features + CLAP) into the sound library's index. Nothing is copied, moved or uploaded.</p>
      <p class="sp-err lb-snd-ferr" id="lb-snd-ferr" role="alert">${esc(f.err || '')}</p>
      <span class="sp-btns"><button type="button" class="tbtn" data-a="snd-form-cancel">Cancel</button><button type="submit" class="tbtn primary"${f.busy ? ' disabled' : ''}>Add and index</button></span></form>`;
}
function setSndForm(f) {
  SND.form = f;
  const old = el.querySelector('.lb-snd-form'), html = sndFormHtml();
  if (old) { if (html) old.outerHTML = html; else old.remove(); }
  else if (html) el.querySelector('.lb-snd-intro')?.insertAdjacentHTML('afterend', html);
  if (f && !f.busy) el.querySelector('.lb-snd-form input[name=sid]')?.focus();
}
async function addSoundFolder() {
  const folder = await api.pickFolder('Add a sound folder (gfx reads the audio files; nothing is copied)');
  if (!folder || !LB.open) return;
  if (!SND.list && !SND.loading) await loadSounds();
  setSndForm({ folder, id: soundSourceId(folder, sndIds()), license: '', err: '', busy: false });
}
async function submitSoundForm(form) {
  const f = SND.form;
  if (!f || f.busy) return;
  f.id = form.querySelector('[name=sid]').value.trim(); f.license = form.querySelector('[name=lic]').value.trim();
  const fail = (m) => { f.err = m; f.busy = false; setSndForm(f); };
  if (!validSourceId(f.id)) return fail('Use letters, digits, dots, dashes or underscores for the id.');
  if (sndIds().includes(f.id)) return fail(`A source "${f.id}" already exists.`);
  f.busy = true; f.err = ''; setSndForm(f);
  const r = await sndOp(() => gfx(['lib', 'add', f.id, engineFolder(f.folder, { wsl: SND.wsl }), '--license', f.license || 'unspecified', '--json'])).catch((e) => ({ code: 1, msg: String(e.message || e) }));
  if (r.code) return fail(`gfx lib add: ${r.msg}`);
  const id = f.id;
  soundIndex.forgetEnabled(id); // the new source is enabled: no on/off override left from an earlier source with this id
  SND.form = null;
  await loadSounds();
  setSndForm(null);
  emit('toast', { m: `Added ${id}; indexing…`, ms: 2000 });
  indexSource(id);
  reloadIndex();
}
let paintT = 0;
function indexSource(id) {
  if (SND.jobs.get(id)?.finished === false) return;
  delete SND.errs[id];
  const job = { jobId: '', done: 0, total: 0, t0: Date.now(), rate: null, finished: false, canceled: false, err: '' };
  const jobs = SND.jobs, errs = SND.errs; // this context's maps: a project / library switch replaces them
  jobs.set(id, job);
  paintSoundRow(id);
  const paint = () => { if (!paintT) paintT = setTimeout(() => { paintT = 0; for (const [k, j] of SND.jobs) if (!j.finished) paintSoundRow(k); }, 120); };
  const run = api.engineRun(['lib', 'index', id], {
    progress: true,
    onEvent: (ev) => {
      if (ev.type === 'progress' && ev.phase === 'index') { job.done = ev.done || 0; job.total = ev.total || 0; job.rate = filesPerSec(job.done, job.t0, Date.now()); paint(); }
      else if (ev.type === 'error' && ev.msg) job.err = String(ev.msg).replace(/^gfx: /, '');
      else if (ev.type === 'log' && ev.level === 'error' && ev.msg) job.err = String(ev.msg).replace(/^gfx: /, '');
    },
  });
  job.jobId = run.jobId;
  run.done.then((res) => {
    job.finished = true; job.canceled = !!res.canceled;
    if (res.canceled) errs[id] = 'Indexing cancelled. ⋯ → Re-index continues (finished files are kept).';
    else if (res.code) errs[id] = `Indexing failed: ${job.err || res.error || `exit code ${res.code}`}`;
  }, (e) => { job.finished = true; errs[id] = `Indexing failed: ${e.message || e}`; })
    .then(async () => { if (SND.jobs !== jobs) return; await loadSounds(); await reloadIndex(); }); // an old context's job: nothing to repaint
}
async function toggleSource(id, on_, box) {
  const s = SND.list?.find((x) => x.id === id);
  if (!s) return;
  box.disabled = true;
  const ctx = SND.ctx;
  const r = await sndOp(() => gfx(['lib', on_ ? 'enable' : 'disable', id])).catch((e) => ({ code: 1, msg: String(e.message || e) }));
  if (SND.ctx !== ctx) return;
  if (r.code) { SND.errs[id] = r.msg; box.checked = !on_; }
  else { s.enabled = on_; delete SND.errs[id]; await soundIndex.setEnabled(id, on_).catch(() => {}); reloadIndex(); }
  paintSoundRow(id);
}
async function removeSource(id) {
  const s = SND.list?.find((x) => x.id === id);
  if (!s) return;
  if (!(await api.ask(`Remove "${id}" from the sound library?\n\nThe audio files stay where they are${s.path ? ` (${s.path})` : ''}; only its entry in sources.json and its index are deleted.`))) return;
  const ctx = SND.ctx;
  const r = await sndOp(() => gfx(['lib', 'remove', id])).catch((e) => ({ code: 1, msg: String(e.message || e) }));
  if (!r.code) soundIndex.forgetEnabled(id); // a source added again later under this id starts from its sources.json state
  if (SND.ctx !== ctx) return;
  if (r.code) { SND.errs[id] = `Remove: ${r.msg}`; paintSoundRow(id); return; }
  delete SND.errs[id]; SND.jobs.delete(id);
  await loadSounds();
  reloadIndex();
  emit('toast', { m: `Removed ${id} from the sound library (its audio files are kept)`, ms: 2500 });
}
function soundMenu(b) {
  const id = b.closest('[data-snd]')?.dataset.snd, s = SND.list?.find((x) => x.id === id);
  if (!s) return;
  const st = soundRowState(s, SND.jobs.get(id)), running = SND.jobs.get(id)?.finished === false;
  openMenu(b, [
    { id: 'reindex', label: 'Re-index', disabled: running, run: () => indexSource(id) },
    { id: 'remove', label: 'Remove from library…', disabled: !st.canRemove || running, hint: st.readOnly ? 'gfx.json' : s.kind === 'synth' ? 'built-in' : '', run: () => removeSource(id) },
  ]);
}

// ---------- events ----------
async function onClick(e) {
  await palSaves.flush();
  const tab = e.target.closest('[data-tab]');
  if (tab) { if (!(await leaveOk())) return; LB.tab = tab.dataset.tab; LB.view = null; LB.form = null; LB.q = ''; render(); return; }
  const ft = e.target.closest('[data-file]');
  if (ft && LB.view?.kind === 'look') { if (ft.dataset.file === LB.view.file || !(await leaveOk())) return; LB.view.file = ft.dataset.file; render(); return; }
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  const a = b.dataset.a, card = b.closest('[data-look]'), lookId = LB.view?.kind === 'look' ? LB.view.id : card?.dataset.look;
  const i = +b.dataset.i;
  switch (a) {
    case 'back': return closeLibrary();
    case 'folder': if (await leaveOk()) { await closeLibrary(); emit('open-settings', 'libraryDir'); } return;
    case 'list': if (await leaveOk()) { LB.view = null; render(); } return;
    case 'seed': return seed();
    case 'new-look': return newLook(b.dataset.how);
    case 'new-look-menu': {
      const noProj = projectOpen() ? '' : 'open a project';
      return openMenu(b, [
        { id: 'claude', label: 'With Claude… (prompt, references, this project)', disabled: !!noProj, hint: noProj, run: () => newLook('claude') },
        { sep: true },
        { id: 'blank', label: 'Blank', run: () => newLook('blank') },
        { id: 'style', label: 'Copy this project\'s style', disabled: !!noProj, hint: noProj, run: () => newLook('style') },
      ]);
    }
    case 'pv-render': return renderPreview(lookId);
    case 'pv-cancel': { const j = PV.jobs.get(lookId); if (j?.jobId && !j.finished) { b.disabled = true; api.engineCancel(j.jobId).catch(() => {}); } return; }
    case 'pv-claude': return rebuildSampleMenu(b, lookId);
    case 'new-preset': return setForm({ kind: 'preset', name: '' });
    case 'new-palette': return setForm({ kind: 'palette', name: '' });
    case 'form-cancel': return setForm(null);
    case 'edit-look': await text(`looks/${lookId}/LOOK.md`); LB.view = { kind: 'look', id: lookId, file: 'LOOK.md' }; return render();
    case 'use-look': return useLook(lookId);
    case 'dup-look': case 'dup-preset': case 'dup-palette': return duplicate(a, b, lookId);
    case 'del-look': case 'del-preset': case 'del-palette': return remove(a, b, lookId);
    case 'edit-preset': LB.view = { kind: 'preset', name: b.closest('[data-preset]').dataset.preset }; return render();
    case 'edit-palette': LB.view = { kind: 'palette', name: b.closest('[data-palette]').dataset.palette }; return render();
    case 'save': return saveEditor();
    case 'revert': if (editor) { const cm = await import('./cm.js'); cm.replaceDoc(editor, edSaved); syncDirty(); } return;
    case 'update': return updateLook();
    case 'compare': return openCompare();
    case 'save-to-lib': return saveToLibrary();
    case 'keep-mine': LB.view = null; return saveToLibrary(true);
    case 'take-lib': return busy('Taking the Library\'s copy…', async () => {
      const id = LB.status?.look?.id;
      const r = await gfx(['look', 'use', id, ...libArgs(), ...wf(), '--force', '--json']);
      if (r.code) throw new Error(`Use look: ${r.msg}`);
      LB.view = null;
      emit('look-changed', { id });
      emit('toast', { m: 'The project now has the Library\'s copy', ms: 3000 });
    });
    // palette
    case 'play': return playSafe(pal.entries[i]);
    case 'pal-del': pal.entries.splice(i, 1); renderPalette(); return savePalette();
    case 'pal-add-synth': pal.entries.push({ role: '', sound: 'whoosh', tags: [], note: '' }); renderPalette(); el.querySelector(`[data-pf=role][data-i="${pal.entries.length - 1}"]`)?.focus(); return savePalette();
    case 'pal-add-lib': return openPicker();
    case 'pick-close': pal.pick = null; return renderPalette();
    case 'pick-clap': return clapSearch();
    case 'pick-play': { const h = pal.pick.results[+b.dataset.pi]; return playSafe(h.synth || { src: h.id }); }
    case 'pick-add': {
      const h = pal.pick.results[+b.dataset.pi];
      const role = (h.synth?.sound || h.name).replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 24);
      const entry = h.synth ? { role, sound: h.synth.sound, ...(h.synth.variant ? { variant: h.synth.variant } : {}), ...(Object.keys(h.synth.params).length ? { params: h.synth.params } : {}) } : { role, src: h.id };
      pal.entries.push({ ...entry, tags: [], note: '' });
      pal.pick = null; renderPalette(); await savePalette();
      return emit('toast', { m: `Added ${h.name}`, ms: 1500 });
    }
    // refs of a look
    case 'refs-add': {
      const picked = await api.pickRefs();
      const taken = new Set(filesUnder(`looks/${lookId}/refs/`).map((f) => f.path.split('/').pop()));
      let n = 0;
      for (const p of picked) {
        try { const name = uniqueName(cleanFileName(p.split(/[\\/]/).pop()), taken); const rel = await api.libraryImport(p, `looks/${lookId}/refs/${name}`); taken.add(rel.split('/').pop()); n++; }
        catch (err) { emit('toast', { m: String(err.message || err), ms: 5000 }); }
      }
      if (n) { await loadFiles(); render(); emit('toast', { m: `Added ${n} reference${n > 1 ? 's' : ''}`, ms: 2000 }); }
      return;
    }
    // sound sources
    case 'snd-refresh': return loadSounds();
    case 'snd-add': return addSoundFolder();
    case 'snd-form-cancel': return setSndForm(null);
    case 'snd-menu': return soundMenu(b);
    case 'snd-cancel': { const j = SND.jobs.get(b.closest('[data-snd]')?.dataset.snd); if (j?.jobId && !j.finished) { b.disabled = true; api.engineCancel(j.jobId).catch(() => {}); } return; }
    case 'ref-del': {
      const rel = b.closest('[data-ref]').dataset.ref;
      if (!(await api.ask(`Delete ${rel.split('/').pop()} from the Library look?`))) return;
      try { await api.libraryDelete(rel); await loadFiles(); render(); } catch (err) { emit('toast', { m: String(err.message || err), ms: 5000 }); }
      return;
    }
    default:
  }
}
async function duplicate(a, b, lookId) {
  const kind = a.slice(4), src = kind === 'look' ? lookId : b.closest(`[data-${kind}]`)?.dataset[kind] || LB.view?.name;
  const taken = new Set(kind === 'look' ? lookIds() : kind === 'preset' ? presetNames() : paletteNames());
  let to = `${src}-copy`; for (let n = 2; taken.has(to); n++) to = `${src}-copy-${n}`;
  const name = await prompt(`Duplicate "${src}" as (lowercase letters, digits, dashes):`, to); // await: Tauri's dialog plugin may make it async
  if (typeof name !== 'string' || !name.trim()) return;
  const id = slug(name);
  const rel = (x) => (kind === 'look' ? `looks/${x}` : kind === 'preset' ? `presets/${x}.js` : `palettes/${x}.json`);
  try {
    if (!validId(id)) throw new Error('Use lowercase letters, digits and dashes.');
    await api.libraryCopy(rel(src), rel(id));
    if (kind === 'look') { // the copy gets its own name in LOOK.md and preset.js
      const md = await api.libraryRead(`looks/${id}/LOOK.md`).catch(() => null);
      if (md) await api.libraryWrite(`looks/${id}/LOOK.md`, md.replace(/^(---\r?\n[\s\S]*?^name:\s*)(.*)$/m, (_, p1, n) => `${p1}${n.trim()} (copy)`));
      const pj = await api.libraryRead(`looks/${id}/preset.js`).catch(() => null);
      if (pj) await api.libraryWrite(`looks/${id}/preset.js`, renamePreset(pj, id));
    } else if (kind === 'preset') {
      const pj = await api.libraryRead(rel(id)).catch(() => null);
      if (pj) await api.libraryWrite(rel(id), renamePreset(pj, id));
    }
    await loadFiles();
    if (kind === 'look') await text(`looks/${id}/LOOK.md`);
    LB.view = kind === 'look' ? { kind: 'look', id, file: 'LOOK.md' } : { kind, name: id };
    render();
    emit('toast', { m: `Duplicated as ${id}`, ms: 2000 });
  } catch (err) { emit('toast', { m: String(err.message || err), ms: 5000 }); }
}
async function remove(a, b, lookId) {
  const kind = a.slice(4), name = kind === 'look' ? lookId : b.closest(`[data-${kind}]`)?.dataset[kind] || LB.view?.name;
  const rel = kind === 'look' ? `looks/${name}` : kind === 'preset' ? `presets/${name}.js` : `palettes/${name}.json`;
  const inUse = kind === 'look' && LB.status?.look?.id === name ? '\n\nThis project keeps its own copy (looks/' + name + '/).' : '';
  if (!(await api.ask(`Delete ${kind} "${name}" from the Library?\n${LB.dir}/${rel}${kind === 'look' ? ' (the whole folder, with its references)' : ''}${inUse}`))) return;
  try {
    await api.libraryDelete(rel);
    if (editor && edPath.startsWith(rel)) { edSaved = editor.state.doc.toString(); }
    LB.view = null;
    await loadFiles();
    render();
    refreshStatusSoon();
    emit('toast', { m: `Deleted ${name}`, ms: 2000 });
  } catch (err) { emit('toast', { m: String(err.message || err), ms: 5000 }); }
}

function onInput(e) {
  const t = e.target;
  if (t.classList.contains('lb-q')) { LB.q = t.value; if (LB.tab === 'looks') applyFilter(); else { const pos = t.selectionStart; render(); const q = el.querySelector('.lb-q'); q.focus(); q.setSelectionRange(pos, pos); } return; }
  if (t.classList.contains('lb-pick-q')) { pal.pick.q = t.value; filterPicker(); return; }
  if (t.name === 'name' && t.closest('.lb-form')) { const id = el.querySelector('.lb-form .lb-id'); if (id) id.textContent = `looks/${slug(t.value) || '…'}/`; LB.form.name = t.value; return; }
  const pf = t.dataset.pf;
  if (pf && ['role', 'tags', 'note'].includes(pf)) {
    const en = pal.entries[+t.dataset.i];
    if (pf === 'tags') en.tags = t.value.split(',').map((x) => x.trim()).filter(Boolean); else en[pf] = t.value;
    palSaves.schedule(pal);
  }
}
function onChange(e) {
  const t = e.target, pf = t.dataset.pf;
  if (t.classList.contains('lb-snd-on')) { const id = t.closest('[data-snd]')?.dataset.snd; if (id) toggleSource(id, t.checked, t); return; }
  if (pf === 'sound' || pf === 'variant') {
    const en = pal.entries[+t.dataset.i];
    if (pf === 'sound') { en.sound = t.value; if (!(VARIANTS[en.sound] || []).includes(en.variant)) delete en.variant; renderPalette(); }
    else if (t.value) en.variant = t.value; else delete en.variant;
    savePalette();
  }
}
function onKeyDown(e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && editor) { e.preventDefault(); e.stopPropagation(); saveEditor(); }
}
/** Esc: leaves a field, else closes the form / the picker / the detail view, else returns to the workspace. */
export async function libraryEscape(e) {
  await palSaves.flush();
  if (NL.dlg) { if (!NL.busy) closeLookDialog(); return; }
  const t = e?.target;
  if (t && el?.contains(t) && (t.matches?.('input, select, textarea') || t.closest?.('.cm-editor'))) { t.blur?.(); if (t.closest?.('.cm-editor')) el.querySelector('.lb-edbar [data-a=save]')?.focus(); return; }
  if (pal?.pick) { pal.pick = null; renderPalette(); return; }
  if (LB.form) { setForm(null); return; }
  if (SND.form && LB.tab === 'sounds') { setSndForm(null); return; }
  if (LB.view) { if (await leaveOk()) { LB.view = null; render(); } return; }
  closeLibrary();
}
function onSubmit(e) { e.preventDefault(); const form = e.target.closest('.lb-form'); if (form?.dataset.form === 'sound') submitSoundForm(form); else if (form) submitForm(form); }

// ---------- open / close ----------
function installKeys() {
  if (keysOn) return;
  keysOn = true;
  addDialogProbe(() => LB.open);
  register([{ id: 'dlg.library', keys: ['Esc'], context: 'dialog', group: 'Settings', label: 'Library: back (in a field: leave it; a form, picker or look: close it; else back to the workspace)', scene: false, typing: true, when: () => LB.open, run: (e) => libraryEscape(e) }]);
}

/** Open the Library page (optionally a tab: 'looks' | 'presets' | 'palettes' | 'sounds'). */
export async function openLibrary(tab) {
  if (!el) { build(); el.addEventListener('submit', onSubmit); }
  installKeys();
  await palSaves.flush();
  if (!LB.open) {
    LB.returnFocus = document.activeElement;
    if (settingsOpen()) closeSettings(); // one full page at a time
  }
  if (TABS.some(([id]) => id === tab)) { LB.tab = tab; LB.view = null; }
  LB.open = true;
  el.hidden = false;
  document.body.classList.add('library-on');
  unsubs.forEach((u) => u()); unsubs = [];
  unsubs.push(on('root', async () => { resetSounds(); if (LB.open && (await leaveOk())) { await palSaves.flush(); LB.view = null; LB.form = null; loadStatus().then(render); } }));
  LB.status = null; LB.loading = true;
  if (SND.ctx !== S.root) resetSounds(); // another project (and maybe another engine / sound library) since the last open
  else if (![...SND.jobs.values()].some((j) => !j.finished)) { SND.list = null; SND.err = ''; } // fresh on every open (sources may change from a terminal)
  render();
  await loadFiles();
  for (const id of lookIds()) await text(`looks/${id}/LOOK.md`);
  render();
  await loadStatus();
  afterStatus();
  if (!el.contains(document.activeElement)) el.querySelector('.sp-cats button.on')?.focus({ preventScroll: true });
}
export async function closeLibrary() {
  if (!LB.open) return;
  // ask only when there is something to lose: an await here even when clean would close the page a tick later,
  // after a caller's openLibrary() (close + reopen without waiting) — the page would end up closed
  if (edDirty() && !(await leaveOk())) return;
  await palSaves.flush();
  LB.open = false;
  el.hidden = true;
  document.body.classList.remove('library-on');
  destroyEditor(); revokeThumbs(); revokeMedia();
  closeLookDialog();
  pal = null; LB.form = null; SND.form = null;
  unsubs.forEach((u) => u()); unsubs = [];
  const f = LB.returnFocus;
  LB.returnFocus = null;
  if (f && f.isConnected && f !== document.body) f.focus?.({ preventScroll: true });
}
export const toggleLibrary = () => (LB.open ? closeLibrary() : openLibrary());
