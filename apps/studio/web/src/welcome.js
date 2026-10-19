import { showWslSetup, wslSetupOpen, closeWslSetup } from './wslsetup.js';
import { register, installKeys } from './keys.js';
import './theme.js';
// Welcome window (docs/HOME-SETTINGS.md §1): New project / Open folder… / Add folder of projects…, the Recent list (pin,
// Reveal, Remove, missing → Locate…) and Folders (projects found directly inside), a first-run hero with the templates,
// a status strip (Engine · ffmpeg · Browser · T3) with the fixes, and a folder drop. Panes slide in place (no dialogs).
// Opening a project hands it to the one main window (welcome.rs welcome_open); the dev shim loads index.html instead.
import * as api from './api.js';
import { pathKey, resolvePref, sanitizeMachine } from './settings-core.js';
import { libraryArgs } from './savetemplate-core.js';
import { TS, onTools, doctorRows, runDoctor, runSetup, chooseEngine } from './tools.js';
import { openMenu, closeMenu, menuOpen } from './menu.js';

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (id) => document.getElementById(id);
// Templates (docs/TEMPLATES.md §4): `gfx template list --for <folder> --json` from the engine that creates the project
// -> [{ ref, id, source: builtin|user, title, description, aspect, duration, thumb (data URL), preview (bool) }].
const GLYPH = { '16:9': '▭', '9:16': '▯', '1:1': '▢', '4:5': '▯' };
const tplOf = (ref) => (W.templates || []).find((t) => t.ref === ref) || null;
const tplInfo = (ref) => { const t = tplOf(ref); return { title: t?.title || ref, desc: t?.description || '', glyph: GLYPH[t?.aspect] || '◇' }; };
const fmtDur = (d) => (d == null ? '' : `${Number.isInteger(+d) ? d : (+d).toFixed(1)} s`);
const clips = new Map(); // ref|folder -> blob url | null | Promise

const W = {
  list: null, listErr: null, loading: true,
  pane: 'home', // home | new | nogfx
  step: 'tpl', from: 'home', // new project: tpl | name; where Back goes from the template step
  templates: null, tplErr: null,
  create: null, // { tpl, name, dir, dirEdited, busy, status, error }
  nogfx: null, // { path, busy, error }
  machine: sanitizeMachine({}), meta: { defaults: {}, version: '' },
  t3: null, mainOpen: false, wslBundle: null, wslNeeded: false, tplFolder: null,
};
const thumbs = new Map(); // path -> blob url | null (none) | Promise

let toastTimer = 0;
function toast(m, ms = 2600) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms); }
const errText = (e) => String(e?.message || e);

function ago(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}
export const slug = (n) => n.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
const sepOf = (p) => (p.includes('\\') && !p.includes('/') ? '\\' : '/');
export const joinPath = (a, b) => a.replace(/[\\/]+$/, '') + sepOf(a) + b;
const projectsDir = () => resolvePref('projectsDir', W.machine, {}, W.meta.defaults).value || '';
const firstRun = () => !!W.list && !W.list.recent.length && !W.list.folders.length;

// ---------- data ----------
async function loadList() {
  for (;;) { // a Pin click during the read makes that answer stale: wait for the write, read again
    await pinWrite;
    const gen = pinGen;
    try { const list = await api.recentList(); if (gen !== pinGen) continue; W.list = list; pinState.clear(); W.listErr = null; } catch (e) { W.listErr = errText(e); W.list = W.list || { recent: [], folders: [] }; }
    break;
  }
  W.loading = false;
  if (W.pane === 'home') render();
}
function thumb(p) {
  if (thumbs.has(p)) return thumbs.get(p);
  const pr = api.projectThumb(p).then((b) => URL.createObjectURL(new Blob([b], { type: 'image/png' })), () => null).then((u) => {
    thumbs.set(p, u);
    for (const img of document.querySelectorAll(`img[data-thumb="${CSS.escape(p)}"]`)) { if (u) { img.src = u; img.hidden = false; img.previousElementSibling.hidden = true; } }
    return u;
  });
  thumbs.set(p, pr);
  return pr;
}
async function refreshT3() {
  try { W.t3 = await api.t3Status(); } catch { W.t3 = null; }
  try { W.mainOpen = await api.mainOpen(); } catch { W.mainOpen = false; }
  renderStatus();
}

// ---------- rendering ----------
function projRow(p, { recent = false } = {}) {
  const glyph = esc((p.name || '?').slice(0, 1).toUpperCase());
  const t = p.thumb ? thumbs.get(p.path) : null;
  const url = typeof t === 'string' ? t : null;
  if (p.thumb && !thumbs.has(p.path)) thumb(p.path);
  const meta = p.missing ? '<span class="wl-miss">Folder not found</span>' : `${p.scenes} scene${p.scenes === 1 ? '' : 's'}`;
  const actions = p.missing
    ? `<button type="button" class="tbtn" data-a="locate">Locate…</button><button type="button" class="tbtn" data-a="remove">Remove</button>`
    : `${recent ? `<button type="button" class="wl-icon wl-pin${p.pinned ? ' on' : ''}" data-a="pin" title="${p.pinned ? 'Unpin' : 'Pin to the top'}" aria-pressed="${!!p.pinned}"><svg viewBox="0 0 16 16"><path d="M9.8 1.8 14.2 6.2l-1.4.4-2.6 2.6.3 3.1-1.2 1.2-2.6-2.6L3 14.6l-.6-.6 3.7-3.7L3.5 7.7l1.2-1.2 3.1.3 2.6-2.6z" fill="${p.pinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg></button>` : ''}
       <button type="button" class="wl-icon" data-a="more" title="More: Reveal in Explorer${recent ? ', Remove from list' : ''}" aria-haspopup="menu">&#8943;</button>`;
  return `<div class="wl-proj${p.missing ? ' missing' : ''}" data-path="${esc(p.path)}" data-kind="${recent ? 'recent' : 'folder-project'}" tabindex="0" role="button" aria-label="${esc(p.missing ? `${p.name} (folder not found)` : `Open ${p.name}`)}">
    <span class="wl-thumb"><span class="wl-glyph">${glyph}</span><img alt="" data-thumb="${esc(p.path)}"${url ? ` src="${url}"` : ' hidden'}></span>
    <span class="wl-pmain"><b>${esc(p.name)}</b><small title="${esc(p.path)}">${esc(p.path)}</small></span>
    <span class="wl-pmeta">${meta}${recent && p.opened ? `<small>${esc(ago(p.opened))}</small>` : ''}</span>
    <span class="wl-pact">${actions}</span></div>`;
}
function homeHtml() {
  if (W.loading) return '<div class="wl-note"><i class="spin"></i> Loading your projects…</div>';
  if (firstRun()) return heroHtml();
  const L = W.list;
  const recent = L.recent.length ? L.recent.map((p) => projRow(p, { recent: true })).join('') : '<div class="wl-empty">No recent projects yet. Projects you open show up here.</div>';
  const folders = L.folders.map((f) => `<section class="wl-folder${f.missing ? ' missing' : ''}" data-folder="${esc(f.path)}">
      <header><span class="wl-fname" title="${esc(f.path)}">&lrm;${esc(f.path)}&lrm;</span>${f.missing ? '<span class="wl-miss">Folder not found</span><button type="button" class="tbtn" data-a="locate-folder">Locate…</button><button type="button" class="tbtn" data-a="remove-folder">Remove</button>' : `<small>${f.projects.length} project${f.projects.length === 1 ? '' : 's'}</small><button type="button" class="wl-icon" data-a="folder-more" title="More: Reveal in Explorer, Remove from list" aria-haspopup="menu">&#8943;</button>`}</header>
      ${f.missing ? '' : f.projects.length ? `<div class="wl-list">${f.projects.map((p) => projRow(p)).join('')}</div>` : '<div class="wl-empty sm">No gfx projects directly inside this folder.</div>'}</section>`).join('');
  return `${W.listErr ? `<div class="wl-note warn">${esc(W.listErr)}</div>` : ''}
    <section class="wl-sec"><h3>Recent</h3><div class="wl-list" id="wl-recent">${recent}</div></section>
    <section class="wl-sec"><h3>Folders</h3>${folders || '<div class="wl-empty">No folders yet. <b>Add folder of projects…</b> lists every project inside a folder.</div>'}</section>`;
}
function tplCards(big) {
  if (W.tplErr) return `<div class="wl-note warn">${esc(W.tplErr)}</div><p class="wl-sub">Choose a project folder in a distro with an installed engine, or select an Engine folder below.</p><button type="button" class="tbtn" data-a="wsl-template-folder">Choose project folder…</button>`;
  if (!W.templates) return '<div class="wl-note"><i class="spin"></i> Loading templates…</div>';
  const grid = (list) => `<div class="wl-tpls${big ? ' big' : ''}">${list.map(tplCard).join('')}</div>`;
  const own = W.templates.filter((t) => t.source === 'user'), built = W.templates.filter((t) => t.source !== 'user');
  if (!own.length) return grid(built);
  return `<h3 class="wl-tgroup">Built in</h3>${grid(built)}<h3 class="wl-tgroup">Your templates</h3>${grid(own)}`;
}
function tplCard(t) {
  const meta = [t.aspect, fmtDur(t.duration), t.scenes?.length > 1 ? `${t.scenes.length} scenes` : ''].filter(Boolean).join(' · ') || 'Empty project';
  const media = `<span class="wl-tmedia"><span class="wl-tglyph">${GLYPH[t.aspect] || '◇'}</span>${t.thumb ? `<img alt="" src="${esc(t.thumb)}">` : ''}${t.preview ? '<video muted loop playsinline preload="none" hidden></video>' : ''}</span>`;
  const more = t.source === 'user' && !t.legacy ? `<button type="button" class="wl-icon wl-tmore" data-a="tpl-more" data-ref="${esc(t.ref)}" title="More: Remove" aria-haspopup="menu">&#8943;</button>` : '';
  return `<div class="wl-tcard"><button type="button" class="wl-tpl" data-tpl="${esc(t.ref)}"${t.preview ? ' data-preview="1"' : ''} title="${esc(t.legacy ? `${t.title} (old template folder, read-only)` : t.source === 'user' ? `${t.title} (your template)` : t.title)}">${media}<span class="wl-ttext"><b>${esc(t.title)}</b><span class="wl-tmeta">${esc(meta)}</span><small>${esc(t.description || '')}</small></span></button>${more}</div>`;
}
/** Hover / focus on a card with a clip: fetch it once (`gfx template preview`), then play it muted in place. */
async function playClip(card) {
  const v = card.querySelector('video'), ref = card.dataset.tpl;
  if (!v || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const key = `${ref}|${W.tplFolder || ''}`;
  if (!clips.has(key)) {
    clips.set(key, (async () => {
      const r = await api.engineCapture(['template', 'preview', ref, ...forArgs(W.tplFolder), ...libArgs(W.tplFolder)], { noProject: true }).done;
      const line = r.code === 0 ? r.lines.find((l) => l.startsWith('{')) : null;
      if (!line) return null;
      const j = JSON.parse(line), bin = atob(j.data), b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([b], { type: j.mime || 'video/mp4' }));
    })().catch(() => null).then((u) => { clips.set(key, u); return u; }));
  }
  const url = await clips.get(key);
  if (!url || !card.isConnected || !card.matches(':hover, :focus-visible')) return;
  if (v.src !== url) v.src = url;
  v.hidden = false; v.currentTime = 0;
  v.play().catch(() => {});
}
function stopClip(card) { const v = card?.querySelector('video'); if (v && !v.hidden) { v.pause(); v.hidden = true; } }
const forArgs = (folder) => (folder ? ['--for', folder] : []);
// user templates live in <Library folder>/templates; passed only within the same environment (savetemplate-core.js)
const libArgs = (folder) => libraryArgs(resolvePref('libraryDir', W.machine, {}, W.meta.defaults).value, folder);
function heroHtml() {
  return `<div class="wl-hero"><h2>What will you make?</h2><p class="wl-sub">Start from a template, or open a folder you already have.</p>${tplCards(true)}</div>`;
}
function newHtml() {
  const back = '<button type="button" class="tbtn wl-back" data-a="back">&larr; Back</button>';
  if (W.step === 'tpl') return `<div class="wl-panehead">${back}<h2>New project</h2><span class="wl-stepn">1 / 2 · Template</span></div>${tplCards(false)}`;
  const c = W.create, final = c.dir.trim() && c.name.trim() ? joinPath(c.dir.trim(), slug(c.name) || 'project') : '';
  const i = tplInfo(c.tpl);
  if (c.createdPath) return createdHtml(c, back);
  return `<div class="wl-panehead">${back}<h2>New project</h2><span class="wl-stepn">2 / 2 · ${esc(i.title)}</span></div>
    <form class="wl-form" autocomplete="off">
      <label>Name<input id="nw-name" type="text" value="${esc(c.name)}" placeholder="My project" spellcheck="false"${c.busy ? ' disabled' : ''}></label>
      <label>Location<span class="wl-pair"><input id="nw-dir" type="text" value="${esc(c.dir)}" placeholder="${esc(projectsDir() || 'C:\\Users\\you\\Documents\\gfx projects')}" spellcheck="false"${c.busy ? ' disabled' : ''}><button type="button" class="tbtn" data-a="browse"${c.busy ? ' disabled' : ''}>Browse…</button></span></label>
      <p class="wl-final" id="nw-final">${final ? `Creates <code>${esc(final)}</code>` : 'Type a name to see the folder it creates.'}</p>
      ${c.busy ? `<div class="wl-note" id="nw-status"><i class="spin"></i> <span>${esc(c.status || 'Creating…')}</span></div>` : ''}
      ${c.error ? `<div class="wl-note warn">${esc(c.error)}</div>` : ''}
      <div class="wl-foot"><button type="submit" class="tbtn primary" id="nw-create"${c.busy || !final ? ' disabled' : ''}>Create project</button></div>
    </form>`;
}
function nogfxHtml() {
  const n = W.nogfx;
  if (n.createdPath) return createdHtml(n, '<button type="button" class="tbtn wl-back" data-a="back">&larr; Back</button>');
  return `<div class="wl-panehead"><button type="button" class="tbtn wl-back" data-a="back">&larr; Back</button><h2>No gfx project here</h2></div>
    <p class="wl-sub"><code>${esc(n.path)}</code> has no <code>gfx.json</code> or <code>scenes/</code> folder, and no projects directly inside it.</p>
    <p class="wl-sub">Make it a project adds the Blank template's files (gfx.json, scenes/, style/, CLAUDE.md); nothing that is already there is overwritten.</p>
    ${n.busy ? `<div class="wl-note"><i class="spin"></i> <span>${esc(n.status || 'Creating…')}</span></div>` : ''}
    ${n.error ? `<div class="wl-note warn">${esc(n.error)}</div>` : ''}
    <div class="wl-foot left"><button type="button" class="tbtn primary" data-a="make-project"${n.busy ? ' disabled' : ''}>Make it a project</button><button type="button" class="tbtn" data-a="choose-another"${n.busy ? ' disabled' : ''}>Choose another</button></div>`;
}
function createdHtml(c, back) {
  return `<div class="wl-panehead">${back}<h2>Project created</h2></div>
    <p class="wl-sub"><code>${esc(c.createdPath)}</code></p>
    ${c.busy ? '<div class="wl-note"><i class="spin"></i> Opening…</div>' : ''}
    ${c.error ? `<div class="wl-note warn">${esc(c.error)}</div>` : ''}
    <div class="wl-foot left"><button type="button" class="tbtn primary" data-a="open-created"${c.busy ? ' disabled' : ''}>Open it</button></div>`;
}
async function openCreated(c) {
  c.busy = true; c.error = null; render();
  try {
    if (await api.welcomeOpen(c.createdPath) === 'cancelled') c.error = 'Opening cancelled. Your project is ready to open.';
  } catch (e) { c.error = errText(e); }
  finally { c.busy = false; render(); }
}
let lastPane = '';
function render() {
  const el = $('wl-pane');
  const key = W.pane === 'new' ? `new:${W.step}` : W.pane;
  const card = W.wslNeeded && W.wslBundle?.exists && localStorage.getItem(`gfx.wsl-setup.dismiss.${W.wslBundle.version}`) !== '1'
    ? '<section class="ws-welcome"><p><b>Set up the WSL engine</b></p><p>Install the bundled engine in the distro where you keep your projects.</p><div class="eng-actions"><button type="button" class="tbtn primary" data-a="wsl-setup">Set up the WSL engine</button><button type="button" class="tbtn" data-a="wsl-not-now">Not now</button></div></section>' : '';
  el.innerHTML = W.pane === 'new' ? newHtml() : W.pane === 'nogfx' ? nogfxHtml() : card + homeHtml();
  el.dataset.pane = W.pane;
  if (key !== lastPane) { // slide in place
    el.classList.remove('wl-in'); void el.offsetWidth; el.classList.add('wl-in');
    lastPane = key;
    const f = el.querySelector('#nw-name') || (W.pane !== 'home' ? el.querySelector('.wl-tpl, [data-a=make-project]') : null);
    f?.focus({ preventScroll: true });
  }
}
function renderStatus() {
  const rows = doctorRows(TS.doctor), get = (id) => rows.find((r) => r.id === id);
  const part = (cls, label, detail, btn = '', title = '') => `<span class="wl-st ${cls}" title="${esc(title || detail)}"><i></i><b>${esc(label)}</b><small>${esc(detail)}</small>${btn}</span>`;
  const sep = '<span class="wl-dotsep">·</span>';
  const busy = TS.setup;
  const prog = (what) => (busy?.what === what ? `<span class="wl-prog"><span class="setup-bar"><i style="width:${busy.pct}%"></i></span><span class="setup-label">${esc(busy.label)}</span></span>` : '');
  let engine, ff, br;
  if (TS.running && !TS.doctor) { engine = part('busy', 'Engine', 'checking…'); ff = part('busy', 'ffmpeg', '…'); br = part('busy', 'Browser', '…'); }
  else if (!TS.doctor) {
    // no engine: pick its folder (machine setting "Engine folder"); a recent project that is an engine is offered directly
    const sg = TS.engine && !TS.engine.found ? TS.engine.suggest : null;
    const why = TS.engine?.error || TS.err || 'gfx doctor did not run';
    engine = part('bad', 'Engine', TS.engine?.found ? 'not working' : 'not found',
      `<button type="button" class="tbtn primary" data-a="choose-engine" title="The folder that contains runner\\cli.js: the app's engine folder, or a gfx repo (also in WSL: \\\\wsl.localhost\\&lt;distro&gt;\\…)">Choose engine folder…</button>`
      + (sg ? `<button type="button" class="tbtn" data-a="use-engine" data-path="${esc(sg)}" title="${esc(sg)}">Use ${esc(sg.split(/[\\/]/).filter(Boolean).pop())}</button>` : '')
      + `<button type="button" class="tbtn" data-a="recheck">Check again</button>`, why);
    ff = part('', 'ffmpeg', 'needs the engine'); br = part('', 'Browser', 'needs the engine');
  } else {
    const e = get('engine'), f = get('ffmpeg'), b = get('browser');
    const failed = (w) => (TS.setupError?.what === w ? ' title="' + esc(TS.setupError.msg) + '"' : '');
    engine = part('ok', 'Engine', TS.doctor.engine?.version ? `v${TS.doctor.engine.version}` : 'ready', '', e?.detail);
    ff = part(f.ok ? 'ok' : 'bad', 'ffmpeg', f.ok ? 'found' : 'missing', busy?.what === 'ffmpeg' ? prog('ffmpeg') : !f.ok ? `<button type="button" class="tbtn primary" data-a="setup" data-what="ffmpeg"${busy ? ' disabled' : ''}${failed('ffmpeg')}>${TS.setupError?.what === 'ffmpeg' ? 'Retry download' : 'Download ffmpeg'}</button>` : '', f.detail);
    br = part(b.ok ? 'ok' : 'bad', 'Browser', b.ok ? (TS.doctor.browser?.pinned ? 'pinned' : TS.doctor.browser?.kind || 'found') : 'missing', busy?.what === 'chrome' ? prog('chrome') : b.fixLabel ? `<button type="button" class="tbtn${b.ok ? '' : ' primary'}" data-a="setup" data-what="chrome"${busy ? ' disabled' : ''}${failed('chrome')} title="A fixed Chrome build, so renders do not depend on the installed browser">${TS.setupError?.what === 'chrome' ? 'Retry install' : esc(b.fixLabel)}</button>` : '', b.detail);
  }
  const st = W.t3;
  const t3 = st?.connected ? part('ok', 'T3', `${{ 'read-only': 'Read-only', standard: 'Standard', full: 'Full' }[st.level] || st.level} access`)
    : part(st?.reconnect ? 'warn' : '', 'T3', st?.reconnect ? 'reconnect' : 'not connected',
      `<button type="button" class="tbtn" data-a="connect-t3"${W.mainOpen ? '' : ' disabled title="Open a project first: Settings → T3 is in the project window"'}>Connect T3</button>`);
  const err = W.engineErr ? `<span class="wl-sterr" title="${esc(W.engineErr)}">Engine: ${esc(W.engineErr.slice(0, 160))}</span>`
    : TS.setupError ? `<span class="wl-sterr" title="${esc(TS.setupError.msg)}">${esc(TS.setupError.what === 'chrome' ? 'Browser' : 'ffmpeg')}: ${esc(TS.setupError.msg.slice(0, 90))}</span>` : '';
  $('wl-status').innerHTML = [engine, ff, br, t3].join(sep) + err;
}

// ---------- flows ----------
async function openPath(p) {
  try { await api.welcomeOpen(p); } catch (e) { toast(errText(e), 5000); loadList(); }
}
/** The templates of the engine that would create a project in `folder` (a WSL folder: that distro's engine). */
async function fetchTemplates(folder) {
  const r = await api.engineCapture(['template', 'list', '--json', ...forArgs(folder), ...libArgs(folder)], { noProject: true }).done;
  const line = r.lines.find((l) => l.startsWith('['));
  if (r.code === 0 && line) return JSON.parse(line).filter((t) => t && typeof t.ref === 'string');
  // an engine from before `gfx template` (e.g. an older WSL install): its folder names, without previews
  let ids;
  try { ids = await api.listTemplates(folder); } catch { throw new Error(r.error || r.lines.filter(Boolean).slice(-2).join(' ') || `gfx template list failed (code ${r.code})`); }
  return ids.map((id) => ({ ref: id, id, source: 'builtin', title: id === 'reel' ? 'Reel 9:16' : id[0].toUpperCase() + id.slice(1), description: '', thumb: null, preview: false }));
}
let templateRequest = 0;
/** `fresh`: list again even when cached for this folder (entering the template step, window focus: a template saved
 *  from the main window shows up); the cards re-render only when the list changed. */
async function loadTemplates(folder = W.create?.dir || projectsDir(), fresh = false) {
  if (W.templates && W.tplFolder === folder && !fresh) return;
  const request = ++templateRequest;
  try {
    const templates = await fetchTemplates(folder); if (request !== templateRequest) return;
    const sig = (l) => JSON.stringify((l || []).map((t) => [t.ref, t.title, t.description, t.created, t.preview, t.thumb?.length]));
    if (fresh && W.templates && W.tplFolder === folder && sig(templates) === sig(W.templates)) return;
    for (const k of [...clips.keys()]) if (k.startsWith('user/')) clips.delete(k); // a replaced template has a new clip
    W.templates = templates; W.tplFolder = folder; W.tplErr = W.templates.length ? null : 'The engine has no project templates.'; }
  catch (e) { if (request !== templateRequest || (fresh && W.templates)) return; W.tplErr = `The engine was not found: ${errText(e)}`; }
  if (request === templateRequest && !(W.pane === 'new' && W.step === 'name')) render();
}
async function removeTemplate(ref, title) {
  if (!(await api.ask(`Remove the template "${title}"? Its folder in your template library is deleted; projects made from it stay as they are.`))) return;
  const r = await api.engineCapture(['template', 'remove', ref, ...forArgs(W.tplFolder), ...libArgs(W.tplFolder)], { noProject: true }).done;
  if (r.code !== 0) { toast(r.error || r.lines.slice(-1)[0] || 'Could not remove the template', 5000); return; }
  toast(`Removed template ${title}`);
  W.templates = null; render(); await loadTemplates(W.tplFolder || undefined);
}
function startNew(from) { W.pane = 'new'; W.step = 'tpl'; W.from = from; W.create = null; render(); loadTemplates(undefined, true); }
function pickTemplate(tpl) {
  const fromHero = W.pane !== 'new'; // a card of the first-run hero: Back returns there
  W.pane = 'new'; W.step = 'name';
  W.create = { tpl, name: '', dir: W.tplFolder || projectsDir(), busy: false, status: '', error: null, heroStart: fromHero };
  render();
}
function back() {
  if (W.pane === 'new' && W.step === 'name' && !W.create?.busy) {
    if (W.create?.heroStart) { W.pane = 'home'; W.create = null; } else W.step = 'tpl';
    render(); return true;
  }
  if (W.pane === 'new' && W.create?.busy) return true;
  if (W.pane === 'nogfx' && W.nogfx?.busy) return true;
  if (W.pane !== 'home') { W.pane = 'home'; W.create = null; W.nogfx = null; render(); return true; }
  return false;
}
function syncFinal() {
  const c = W.create, final = c.dir.trim() && c.name.trim() ? joinPath(c.dir.trim(), slug(c.name) || 'project') : '';
  const f = $('nw-final');
  if (f) f.innerHTML = final ? `Creates <code>${esc(final)}</code>` : 'Type a name to see the folder it creates.';
  const b = $('nw-create');
  if (b) b.disabled = c.busy || !final;
}
async function runInit(args, onStatus) {
  let last = '';
  const res = await api.engineRun(['init', ...args], { noProject: true, onEvent: (ev) => { if (ev.type === 'log' && ev.msg) { last = ev.msg; onStatus(ev.msg.slice(0, 100)); } } }).done;
  if (res.code !== 0) throw new Error(res.error || last || `gfx init failed (code ${res.code})`);
}
async function createProject() {
  const c = W.create;
  if (c.busy) return;
  if (c.createdPath) return openCreated(c);
  const dir = joinPath(c.dir.trim(), slug(c.name) || 'project');
  c.busy = true; c.error = null; c.status = 'Creating the project…'; render();
  try {
    const templates = await fetchTemplates(c.dir);
    if (!templates.some((t) => t.ref === c.tpl)) throw new Error(`The engine for this folder has no "${tplInfo(c.tpl).title}" template. Go back and choose a template.`);
    await runInit([dir, '--template', c.tpl, '--name', c.name.trim(), ...libArgs(c.dir)], (m) => { c.status = m; const s = document.querySelector('#nw-status span'); if (s) s.textContent = m; });
    c.createdPath = dir;
    await openCreated(c);
  } catch (e) { c.busy = false; c.error = errText(e); render(); }
}
/** Open folder / drop: a project opens; a folder with projects is added under Folders; else "No gfx project here". */
async function handleFolder(p) {
  if (!p) return;
  let info;
  try { info = await api.classifyFolder(p); } catch (e) { toast(errText(e), 5000); return; }
  if (!info.exists) { toast(`Folder not found: ${p}`, 5000); return; }
  if (info.isProject) { await openPath(p); return; }
  if (info.projects > 0) {
    try { await api.folderAdd(p); } catch (e) { toast(errText(e), 5000); return; }
    toast(`Added under Folders: ${info.projects} project${info.projects === 1 ? '' : 's'}`);
    W.pane = 'home'; await loadList();
    document.querySelector(`[data-folder="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'nearest' });
    return;
  }
  W.nogfx = { path: p, busy: false, error: null }; W.pane = 'nogfx'; render();
}
async function pick(title) { try { return await api.pickFolder(title); } catch (e) { toast(errText(e), 4000); return null; } }
async function makeProject() {
  const n = W.nogfx;
  if (n.busy) return;
  if (n.createdPath) return openCreated(n);
  n.busy = true; n.error = null; n.status = 'Creating the project…'; render();
  try {
    await runInit([n.path, '--template', 'blank', '--existing'], (m) => { n.status = m; });
    n.createdPath = n.path;
    await openCreated(n);
  } catch (e) { n.busy = false; n.error = errText(e); render(); }
}
async function addFolder() {
  const p = await pick('Add a folder of gfx projects');
  if (!p) return;
  try { await api.folderAdd(p); } catch (e) { toast(errText(e), 5000); return; }
  W.pane = 'home'; await loadList();
  const f = W.list.folders.find((x) => pathKey(x.path) === pathKey(p));
  if (f && !f.projects.length) toast('Added. No gfx projects directly inside it yet.', 3500);
}
async function act(fn, ...a) { try { await fn(...a); } catch (e) { toast(errText(e), 5000); } await loadList(); }

let pinWrite = Promise.resolve(), pinGen = 0;
const pinState = new Map();
function pinProject(button, path) {
  const pinned = !button.classList.contains('on'), key = pathKey(path);
  const state = pinState.get(key) || { saved: !pinned, seq: 0 };
  const seq = ++state.seq; pinState.set(key, state); pinGen++;
  const paint = (value) => {
    for (const item of W.list?.recent || []) if (pathKey(item.path) === pathKey(path)) item.pinned = value;
    for (const row of document.querySelectorAll('.wl-proj')) if (pathKey(row.dataset.path) === pathKey(path)) {
      const b = row.querySelector('[data-a=pin]'); if (!b) continue;
      b.classList.toggle('on', value); b.setAttribute('aria-pressed', String(value)); b.title = value ? 'Unpin' : 'Pin to the top';
      b.querySelector('path').setAttribute('fill', value ? 'currentColor' : 'none');
    }
  };
  paint(pinned);
  pinWrite = pinWrite.then(() => api.recentPin(path, pinned)).then(() => { state.saved = pinned; }).catch((e) => { if (seq === state.seq) paint(state.saved); toast(errText(e), 5000); });
}

function rowMenu(anchor, p, recent) {
  const items = [{ id: 'reveal', label: 'Reveal in Explorer', run: () => api.revealProject(p).then(() => { if (!api.isTauri) toast(p, 3000); }).catch((e) => toast(errText(e), 4000)) }];
  if (recent) items.push({ id: 'remove', label: 'Remove from list', run: () => act(api.recentRemove, p) });
  openMenu(anchor, items);
}

// ---------- events ----------
async function onClick(e) {
  const b = e.target.closest('button');
  const rowEl = e.target.closest('.wl-proj'), folderEl = e.target.closest('[data-folder]');
  const p = rowEl?.dataset.path;
  if (b?.disabled) return;
  const a = b?.dataset.a;
  if (b?.dataset.tpl) { pickTemplate(b.dataset.tpl); return; }
  switch (a) {
    case 'wsl-setup': await showWslSetup({ onChange: refreshWslCard, onClose: refreshWslCard }); return;
    case 'wsl-not-now': localStorage.setItem(`gfx.wsl-setup.dismiss.${W.wslBundle.version}`, '1'); render(); return;
    case 'wsl-template-folder': { const d = await pick('Where should the project folder go?'); if (d) { W.templates = null; await loadTemplates(d); } return; }
    case 'tpl-more': {
      const ref = b.dataset.ref, t = tplOf(ref);
      openMenu(b, [{ id: 'remove', label: 'Remove template…', run: () => removeTemplate(ref, t?.title || ref) }]);
      return;
    }
    case 'new': startNew('home'); return;
    case 'open': handleFolder(await pick('Open a gfx project folder')); return;
    case 'add-folder': addFolder(); return;
    case 'back': back(); return;
    case 'browse': {
      const d = await pick('Where should the project folder go?');
      if (d) { W.create.dir = d; W.templates = null; await loadTemplates(d); render(); }
      return;
    }
    case 'open-created': { const c = W.pane === 'new' ? W.create : W.nogfx; if (c?.createdPath && !c.busy) openCreated(c); return; }
    case 'make-project': makeProject(); return;
    case 'choose-another': handleFolder(await pick('Open a gfx project folder')); return;
    case 'pin': e.stopPropagation(); pinProject(b, p); return;
    case 'more': e.stopPropagation(); if (menuOpen()) closeMenu(); else rowMenu(b, p, rowEl.dataset.kind === 'recent'); return;
    case 'remove': e.stopPropagation(); act(api.recentRemove, p); return;
    case 'locate': {
      e.stopPropagation();
      const to = await pick(`Where is "${rowEl.querySelector('b').textContent}" now?`);
      if (to) act(api.recentRelocate, p, to, false);
      return;
    }
    case 'folder-more': {
      const f = folderEl.dataset.folder;
      openMenu(b, [{ id: 'reveal', label: 'Reveal in Explorer', run: () => api.revealProject(f).catch((err) => toast(errText(err), 4000)) }, { id: 'remove', label: 'Remove from list', run: () => act(api.folderRemove, f) }]);
      return;
    }
    case 'locate-folder': { const to = await pick('Where is this folder now?'); if (to) act(api.recentRelocate, folderEl.dataset.folder, to, true); return; }
    case 'remove-folder': act(api.folderRemove, folderEl.dataset.folder); return;
    case 'setup': runSetup(b.dataset.what); return;
    case 'recheck': W.engineErr = null; runDoctor(); return;
    case 'choose-engine': case 'use-engine': {
      const save = (dir) => api.patchSettings({ engineDir: dir });
      W.engineErr = null;
      try {
        if (a === 'use-engine') { await save(b.dataset.path); runDoctor({ again: true }); } else if (!await chooseEngine(save)) return;
        W.templates = null; W.tplErr = null; // listed again from the new engine
        render();
        await loadTemplates();
      } catch (err) { W.engineErr = errText(err); }
      renderStatus();
      return;
    }
    case 'connect-t3': api.welcomeSettings('t3').catch((err) => toast(errText(err), 4000)); return;
    default: break;
  }
  if (rowEl && !b) {
    if (rowEl.classList.contains('missing')) { toast('This folder was moved or deleted: Locate… or Remove', 3000); return; }
    openPath(p);
  }
}
function onInput(e) {
  const c = W.create;
  if (!c) return;
  if (e.target.id === 'nw-name') c.name = e.target.value;
  else if (e.target.id === 'nw-dir') c.dir = e.target.value;
  else return;
  c.error = null;
  syncFinal();
}
function onKey(e) {
  if (wslSetupOpen()) return;
  if (e.key === 'Escape') { if (menuOpen()) return; if (!e.target.closest?.('input') || W.pane !== 'home') { if (back()) e.preventDefault(); } return; }
  if (e.key === 'Enter' && e.target.classList?.contains('wl-proj')) { e.preventDefault(); e.target.click(); }
}
function onSubmit(e) {
  e.preventDefault();
  if (!$('nw-create')?.disabled) createProject();
}

// ---------- drop a folder (HTML5 drop; the app gets the real path from WebView2, welcome.rs hook_drop) ----------
function initDrop() {
  const ov = $('wl-drop');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/plain');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; ov.hidden = false; });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) ov.hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault(); depth = 0; ov.hidden = true;
    const files = e.dataTransfer?.files;
    const wv = window.chrome?.webview;
    if (files?.length && wv?.postMessageWithAdditionalObjects) { wv.postMessageWithAdditionalObjects('gfx-drop', files); return; } // -> gfx://dropped
    const text = (e.dataTransfer?.getData('text/plain') || '').trim();
    if (/^([A-Za-z]:[\\/]|\\\\|\/)/.test(text)) { handleFolder(text); return; }
    toast('Drop a folder from Explorer (this window could not read its path)', 4000);
  });
  api.listen('gfx://dropped', (paths) => { if (Array.isArray(paths) && paths[0]) handleFolder(paths[0]); });
}

// ---------- init ----------
async function refreshWslCard() {
  try {
    const [bundle, engines] = await Promise.all([api.wslBundleInfo(), api.enginesInfo()]);
    W.wslBundle = bundle; W.wslNeeded = !engines.some((e) => e.kind === 'wsl');
    // after a setup (the engines changed, not the first call) the defaults can change (a WSL-only install suggests the
    // distro's ~/gfx-projects) and so can the templates: reload both
    const key = JSON.stringify(engines.map((e) => [e.kind, e.distro, e.path, e.found]));
    if (W.enginesKey != null && key !== W.enginesKey) {
      const meta = await api.settingsMeta().catch(() => null); if (meta) W.meta = meta;
      if (!(W.pane === 'new' && W.step === 'name')) { W.templates = null; W.tplFolder = null; if (W.pane === 'new' || firstRun()) loadTemplates(); }
    }
    W.enginesKey = key;
  } catch { W.wslNeeded = false; }
  if (W.pane === 'home') render();
}
async function init() {
  register([{ id: 'dlg.wslsetup', keys: ['Esc'], context: 'dialog', group: 'Settings', label: 'Close WSL engine setup', scene: false, typing: true, when: wslSetupOpen, run: closeWslSetup }]);
  installKeys();
  document.addEventListener('change', (e) => { if (e.target.id === 'nw-dir') { W.templates = null; loadTemplates(e.target.value); } });
  document.addEventListener('click', onClick);
  // template cards: the preview clip plays while hovered / focused
  const cardOf = (e) => e.target.closest?.('.wl-tpl[data-preview]');
  document.addEventListener('mouseover', (e) => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget)) playClip(c); });
  document.addEventListener('mouseout', (e) => { const c = cardOf(e); if (c && !c.contains(e.relatedTarget) && !c.matches(':focus-visible')) stopClip(c); });
  document.addEventListener('focusin', (e) => { const c = cardOf(e); if (c?.matches(':focus-visible')) playClip(c); });
  document.addEventListener('focusout', (e) => { const c = cardOf(e); if (c && !c.matches(':hover')) stopClip(c); });
  document.addEventListener('input', onInput);
  document.addEventListener('keydown', onKey);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  initDrop();
  render();
  onTools(renderStatus);
  renderStatus();
  // the old browser-storage recent list (Projects home) moves into recent.json once
  const old = localStorage.getItem('gfx-studio.recent');
  if (old !== null) {
    try { const list = JSON.parse(old); if (Array.isArray(list)) await api.recentImport(list.filter((x) => x && typeof x.path === 'string').map((x) => ({ path: x.path, name: String(x.name || ''), opened: +x.opened || 0, pinned: false }))); } catch { /* dropped */ }
    localStorage.removeItem('gfx-studio.recent');
  }
  const [m, meta] = await Promise.all([api.getSettings().catch(() => ({})), api.settingsMeta().catch(() => null)]);
  W.machine = sanitizeMachine(m);
  if (meta) W.meta = meta;
  $('wl-version').textContent = W.meta.version ? `v${W.meta.version}` : '';
  await loadList();
  refreshWslCard();
  if (firstRun()) loadTemplates();
  runDoctor();
  refreshT3();
  window.addEventListener('focus', () => { loadList(); refreshT3(); if (W.templates && (W.pane === 'new' && W.step === 'tpl' || W.pane === 'home' && firstRun())) loadTemplates(W.tplFolder || undefined, true); });
}
init();

window.__welcome = { W, TS, render, loadList, handleFolder, pickTemplate, back };
