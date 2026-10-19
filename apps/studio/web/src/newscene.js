import { roundSurfaceOrigin } from './surface-origin.js';
// New scene window (docs/LOOKS.md §4): + next to the scene picker, "Create your first scene" in the empty state, and
// "Edit brief & send again" (the Brief button next to the picker, shown when the open scene has scenes/<name>/BRIEF.md).
// Create = `gfx look use` (a Library look) -> `gfx new` -> references copied to scenes/<name>/refs/ -> scenes/<name>/BRIEF.md
// -> the scene is selected -> Claude gets `Build scene <name> from scenes/<name>/BRIEF.md.` in the Claude terminal or a new T3
// thread. BRIEF.md format: briefText() / parseBrief() in newscene-core.js (docs/LOOKS.md §4 "As built").
import * as api from './api.js';
import { pref } from './prefs.js';
import { SCHEMA } from './settings-core.js';
import {
  FORMATS, KINDS, BUILTIN_PRESETS, TAKES, VERIFY, baseName, refFileName, isUrl, isAbsPath, profileDefaults as profileOf, takeDefaults as takeOf,
  nameError as nameErrorIn, briefText, parseBrief, usableLooks,
} from './newscene-core.js';
import { S, emit, esc } from './store.js';
import { sendToClaude } from './terminal.js';
import * as t3 from './t3.js';
import { beforeAsk } from './versions.js';

const TO_KEY = 'gfx-studio.newscene.to';
let hooks = { refreshScenes: async () => {}, selectScene: async () => {} };
const toast = (m, ms = 3000) => emit('toast', { m, ms });
let dlg = null, behind = [], dropTimer = 0;
const N = { mode: 'new', name: '', busy: false, refs: [], looks: { project: null, library: [], libNote: '' }, presets: [], prevFocus: null };

// ---------- helpers ----------
const has = (fn) => typeof api[fn] === 'function';
const safePref = (key) => { try { return SCHEMA[key] ? pref(key) : undefined; } catch { return undefined; } };
const profileDefaults = (w = safePref('workflow')) => profileOf(w);
const takeDefaults = (take) => takeOf(take, safePref('workflow'));
const nameError = (name) => nameErrorIn(name, S.scenes);
export { briefText, parseBrief };
/** Run `gfx <args>`; rejects with the command's own error lines. */
async function gfx(args) {
  const out = [];
  const { done } = api.engineRun(args, { progress: false, onEvent: (ev) => { if ((ev.type === 'log' || ev.type === 'error') && ev.msg) out.push(String(ev.msg).trim()); } });
  const r = await done;
  if (r.code !== 0 || r.error) {
    const why = String(r.error || out.filter(Boolean).slice(-3).join(' · ') || `exit ${r.code}`).replace(/^error:\s*/i, '');
    throw new Error(`gfx ${args.slice(0, args[0] === 'look' ? 2 : 1).join(' ')}: ${why}`);
  }
  return out;
}
const libDir = () => String(safePref('libraryDir') || '').trim();

async function loadLooks() {
  const L = { project: null, library: [], libNote: '' };
  try {
    const gj = JSON.parse((await api.readText('gfx.json')) || '{}');
    if (typeof gj.look === 'string' && /^[\w.-]+$/.test(gj.look)) {
      const md = await api.readText(`looks/${gj.look}/LOOK.md`);
      if (md !== null && md !== undefined) L.project = { id: gj.look, name: md.match(/^name:\s*["']?(.+?)["']?\s*$/m)?.[1] || gj.look };
    }
  } catch { /* no gfx.json */ }
  try {
    const dir = libDir();
    const r = await api.engineCapture(['look', 'list', ...(dir ? ['--library', dir] : []), '--json']).done;
    if (r.code !== 0) throw new Error('gfx look list failed');
    const i = r.lines.findIndex((l) => /^\s*[[{]/.test(l));
    const j = i >= 0 ? JSON.parse(r.lines.slice(i).join('\n')) : [];
    const arr = Array.isArray(j) ? j : Array.isArray(j.library) ? j.library : Array.isArray(j.looks) ? j.looks : [];
    L.library = usableLooks(arr);
    if (!L.library.length) L.libNote = 'No looks in the Library yet.';
  } catch (e) { console.warn('[newscene] library looks:', e); L.libNote = 'Library looks need a newer engine (gfx look list).'; }
  return L;
}
async function loadPresets() {
  const set = new Set(BUILTIN_PRESETS);
  try {
    const { files } = await api.listProjectFiles();
    for (const f of files || []) { const m = f.path.match(/^style\/presets\/([\w.-]+)\.js$/); if (m) set.add(m[1]); }
  } catch { /* built-ins only */ }
  return [...set].sort();
}

// ---------- window ----------
function chip(name, value, label, sub, checked) {
  return `<label class="ns-chip"><input type="radio" name="${name}" value="${esc(value)}"${checked ? ' checked' : ''}><span><b>${esc(label)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span></label>`;
}
function lookOptions(sel) {
  const L = N.looks, o = [];
  if (L.project) o.push(`<optgroup label="This project"><option value="project:${esc(L.project.id)}">${esc(L.project.name)} (project look)</option></optgroup>`);
  const lib = L.library.filter((x) => x.id !== L.project?.id);
  if (lib.length) o.push(`<optgroup label="Library (picking one pins it to the project)">${lib.map((x) => `<option value="lib:${esc(x.id)}" title="${esc(x.description || '')}">${esc(x.name)}</option>`).join('')}</optgroup>`);
  const pre = N.presets.filter((p) => !(L.project && p === `look-${L.project.id}`));
  o.push(`<optgroup label="Style preset (no look)">${pre.map((p) => `<option value="preset:${esc(p)}">${esc(p)}</option>`).join('')}</optgroup>`);
  return o.join('').replace(`value="${esc(sel)}"`, `value="${esc(sel)}" selected`);
}

function build(v) {
  const edit = N.mode === 'edit';
  dlg = document.createElement('div');
  dlg.className = 'modal-back'; dlg.id = 'ns-dlg';
  const t3st = t3.t3Status(), t3ok = !!t3st?.connected && t3.canOperate();
  const t3why = !t3st?.connected ? 'Connect T3 first (T3 button in the top bar)' : !t3.canOperate() ? 'Sending needs Standard or Full access (⚙ → Integrations → Change access…)' : 'Start a new T3 thread in this project, titled with the scene name';
  const to = t3ok && v.to === 't3' ? 't3' : 'term';
  const canFiles = has('importRef') && has('pickRefs');
  dlg.innerHTML = `<div class="modal ns" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="ns-title">
    <div class="modal-head"><b id="ns-title">${edit ? 'Edit brief &amp; send again' : 'New scene'}</b><span class="ns-sub dim">${edit ? `scenes/${esc(v.name)}/BRIEF.md` : 'Claude builds it from your brief'}</span><span class="spacer"></span><button type="button" class="link ns-x" data-a="cancel" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <form class="ns-form" autocomplete="off" novalidate>
      <div class="ns-body">
        <label class="ns-f"><span class="ns-l">Name</span>
          <input id="ns-name" type="text" value="${esc(v.name)}" placeholder="my-scene" spellcheck="false" maxlength="64"${edit ? ' readonly' : ''} aria-describedby="ns-name-msg">
          <small id="ns-name-msg" class="ns-msg" aria-live="polite">${edit ? 'The scene exists; its name stays.' : 'Folder name under scenes/: lower-case letters, digits, - . _'}</small></label>
        <label class="ns-f"><span class="ns-l">Prompt</span>
          <textarea id="ns-prompt" rows="7" placeholder="What should the scene show? Story and beats, text on screen, mood, pacing…" aria-describedby="ns-prompt-msg">${esc(v.prompt)}</textarea>
          <small id="ns-prompt-msg" class="ns-msg" aria-live="polite"></small></label>
        <div class="ns-f"><span class="ns-l">References</span>
          <div class="ns-drop" id="ns-drop" tabindex="-1">
            <span>Drop images or videos here</span>
            <button type="button" class="tbtn" data-a="add-files"${canFiles ? '' : ' disabled title="References need a newer app"'}>Add files…</button>
            ${canFiles ? '' : '<small class="ns-warn">References need a newer app (files); links work.</small>'}
          </div>
          <div class="ns-pair"><input id="ns-link" type="text" placeholder="Paste a link (https://…) and press Enter" spellcheck="false"><button type="button" class="tbtn" data-a="add-link">Add link</button></div>
          <small id="ns-ref-msg" class="ns-msg" aria-live="polite"></small>
          <ul id="ns-refs" class="ns-refs"></ul></div>
        <div class="ns-f"><span class="ns-l">Format</span>
          <div class="ns-chips" role="radiogroup" aria-label="Format">${FORMATS.map((f) => chip('ns-fmt', f.id, f.label, f.sub, f.id === v.format)).join('')}</div>
          <div class="ns-custom-row"><span class="ns-custom"${v.format === 'custom' ? '' : ' hidden'}><input id="ns-w" type="number" min="16" max="7680" step="2" value="${v.w}" aria-label="Width"> × <input id="ns-h" type="number" min="16" max="7680" step="2" value="${v.h}" aria-label="Height"> px</span></div>
          <div class="ns-row">
            <label class="ns-inl">fps <select id="ns-fps">${[30, 60].map((n) => `<option value="${n}"${n === v.fps ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
            <label class="ns-inl">Duration <input id="ns-dur" type="number" min="0.5" max="600" step="0.5" value="${v.dur}"> s</label>
            <small id="ns-fmt-msg" class="ns-msg" aria-live="polite"></small></div></div>
        <div class="ns-f"><span class="ns-l">Look</span>
          <select id="ns-look">${lookOptions(v.look)}</select>
          <small class="ns-msg dim" id="ns-look-msg">${esc(N.looks.libNote)}</small></div>
        <div class="ns-f"><span class="ns-l">Kind</span>
          <div class="ns-chips" role="radiogroup" aria-label="Kind">${KINDS.map(([id, l, sub]) => chip('ns-kind', id, l, sub, id === v.kind)).join('')}</div></div>
        <div class="ns-f"><span class="ns-l">This take</span>
          <div class="ns-row"><div class="seg ns-seg" role="radiogroup" aria-label="Take">${Object.entries(TAKES).map(([id, l]) => `<label><input type="radio" name="ns-take" value="${id}"${id === v.take ? ' checked' : ''}><span>${l}</span></label>`).join('')}</div>
            <label class="chk"><input type="checkbox" id="ns-sound"${v.sound ? ' checked' : ''}> Sound</label>
            <label class="chk"><input type="checkbox" id="ns-render"${v.render ? ' checked' : ''}> Render when done</label></div>
          <div class="ns-custom-row"><label class="ns-inl ns-verify"${v.take === 'custom' ? '' : ' hidden'}>Verify <select id="ns-verify">${Object.entries(VERIFY).map(([id, l]) => `<option value="${id}"${id === v.verify ? ' selected' : ''}>${id === 'sheet' ? 'Contact sheet' : id === 'stills' ? 'Sheet + key stills' : 'Full (2 passes)'}</option>`).join('')}</select></label></div>
          <small class="ns-msg dim" id="ns-take-msg"></small></div>
        <div class="ns-f"><span class="ns-l">Send to</span>
          <div class="ns-row"><div class="seg ns-seg" role="radiogroup" aria-label="Send to">
            <label><input type="radio" name="ns-to" value="term"${to === 'term' ? ' checked' : ''}><span>Terminal</span></label>
            <label title="${esc(t3why)}"><input type="radio" name="ns-to" value="t3"${to === 't3' ? ' checked' : ''}${t3ok ? '' : ' disabled'}><span>New T3 thread</span></label></div>
            <small class="dim">${t3ok ? '' : esc(t3why)}</small></div></div>
      </div>
      <div class="ns-messages"><div class="ns-status" role="status" aria-live="polite" hidden></div></div>
      <div class="modal-foot"><small class="dim ns-foot">Claude gets: <code>Build scene ${esc(v.name || '<name>')} from scenes/${esc(v.name || '<name>')}/BRIEF.md.</code></small><span class="spacer"></span>
        <button type="button" class="tbtn" data-a="cancel">Cancel</button>
        <button type="submit" class="tbtn primary" id="ns-create">${edit ? 'Save brief &amp; send' : 'Create scene'}</button></div>
    </form></div>`;
  wire();
}

const q = (s) => dlg.querySelector(s);
const val = (name) => dlg.querySelector(`input[name="${name}"]:checked`)?.value;

function renderRefs() {
  const ul = q('#ns-refs');
  ul.innerHTML = N.refs.map((r, i) => {
    const what = r.kind === 'link' ? r.url : r.kind === 'file' ? baseName(r.src) : r.rel.split('/').pop();
    const tag = r.kind === 'link' ? 'link' : r.kind === 'file' ? 'new file' : 'in refs/';
    return `<li data-i="${i}"><span class="ns-rtag ${r.kind}">${tag}</span><span class="ns-rname" title="${esc(r.kind === 'link' ? r.url : r.kind === 'file' ? r.src : r.rel)}">${esc(what)}</span>
      <input type="text" class="ns-rnote" data-i="${i}" value="${esc(r.note)}" placeholder="Note (optional): what to take from it" aria-label="Note for ${esc(what)}">
      <button type="button" class="link ns-rdel" data-a="del-ref" data-i="${i}" aria-label="Remove ${esc(what)}" title="Remove">&times;</button></li>`;
  }).join('');
}
function refMsg(m) { const el = q('#ns-ref-msg'); el.textContent = m || ''; el.classList.toggle('err', !!m); }
function addLink(raw) {
  const u = String(raw || '').trim();
  if (!u) return false;
  if (!isUrl(u)) { refMsg('Links start with http:// or https://'); return false; }
  if (!N.refs.some((r) => r.kind === 'link' && r.url === u)) N.refs.push({ kind: 'link', url: u, note: '' });
  refMsg(''); renderRefs(); return true;
}
export function addFiles(paths) {
  if (!dlg) return;
  if (!has('importRef')) { refMsg('References need a newer app'); return; }
  let n = 0;
  for (const p of paths || []) {
    if (typeof p !== 'string' || !isAbsPath(p)) continue;
    if (N.refs.some((r) => r.kind === 'file' && r.src === p)) continue;
    N.refs.push({ kind: 'file', src: p, note: '' }); n++;
  }
  refMsg(n ? '' : 'No files added'); renderRefs();
}
async function pickFiles() {
  if (!has('pickRefs')) return;
  try {
    const r = await api.pickRefs();
    const list = Array.isArray(r) ? r : Array.isArray(r?.paths) ? r.paths : [];
    if (list.length) addFiles(list);
  } catch (e) { refMsg('Add files: ' + (e.message || e)); }
}
function onDrop(e) {
  e.preventDefault(); q('#ns-drop').classList.remove('over');
  const dt = e.dataTransfer;
  const uris = (dt.getData('text/uri-list') || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  const text = (dt.getData('text/plain') || '').trim();
  const links = [...uris, ...text.split(/\s+/)].filter(isUrl);
  if (links.length) { for (const l of new Set(links)) addLink(l); return; }
  const paths = text.split(/\r?\n/).map((s) => s.trim()).filter(isAbsPath);
  if (paths.length) { addFiles(paths); return; }
  const wv = window.chrome?.webview;
  if (dt.files?.length && wv?.postMessageWithAdditionalObjects && has('importRef')) { // the app reads the real paths (WebView2) -> gfx://dropped
    wv.postMessageWithAdditionalObjects('gfx-drop', dt.files);
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => { dropTimer = 0; refMsg('Could not read the dropped files\' paths: use Add files…'); }, 2500);
    return;
  }
  refMsg(dt.files?.length ? 'This window cannot read dropped files\' paths: use Add files…' : 'Nothing to add: drop files or links');
}

function updateTakeMsg() {
  const take = val('ns-take'), verify = take === 'custom' ? q('#ns-verify').value : profileDefaults(take).verify;
  q('.ns-verify').hidden = take !== 'custom';
  q('#ns-take-msg').textContent = `Verify: ${VERIFY[verify]}. Sound: ${q('#ns-sound').checked ? 'yes' : 'only if the prompt asks'}. Render: ${q('#ns-render').checked ? 'Claude renders when done' : 'you render from gfx'}.`;
}
function updateFoot() {
  const n = q('#ns-name').value.trim() || '<name>';
  q('.ns-foot code').textContent = `Build scene ${n} from scenes/${n}/BRIEF.md.`;
}
function checkName({ quietEmpty = false } = {}) {
  const v = q('#ns-name').value.trim();
  const err = N.mode === 'edit' || (quietEmpty && !v) ? '' : nameError(v);
  const m = q('#ns-name-msg');
  if (err) { m.textContent = err; m.classList.add('err'); }
  else if (N.mode !== 'edit') { m.textContent = 'Folder name under scenes/: lower-case letters, digits, - . _'; m.classList.remove('err'); }
  q('#ns-name').setAttribute('aria-invalid', err ? 'true' : 'false');
  return err;
}

function wire() {
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'cancel') close();
    else if (a === 'add-files') pickFiles();
    else if (a === 'add-link') { if (addLink(q('#ns-link').value)) q('#ns-link').value = ''; }
    else if (a === 'del-ref') { N.refs.splice(+e.target.closest('[data-i]').dataset.i, 1); renderRefs(); }
  });
  dlg.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'ns-name') { checkName(); updateFoot(); }
    else if (t.classList.contains('ns-rnote')) N.refs[+t.dataset.i].note = t.value;
    else if (t.id === 'ns-prompt') { q('#ns-prompt-msg').textContent = ''; }
  });
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'ns-fmt') q('.ns-custom').hidden = t.value !== 'custom';
    else if (t.name === 'ns-take') { const d = takeDefaults(t.value); q('#ns-sound').checked = d.sound; q('#ns-render').checked = d.render; q('#ns-verify').value = d.verify; }
    if (['ns-take', 'ns-verify', 'ns-sound', 'ns-render'].includes(t.name || t.id)) updateTakeMsg();
  });
  q('#ns-link').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (addLink(e.target.value)) e.target.value = ''; } });
  q('#ns-link').addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain') || '';
    const links = text.split(/\s+/).filter(isUrl);
    if (links.length > 1) { e.preventDefault(); for (const l of links) addLink(l); }
  });
  const drop = q('#ns-drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', onDrop);
  dlg.addEventListener('dragover', (e) => e.preventDefault()); // a drop next to the zone does not navigate the page
  dlg.addEventListener('drop', (e) => { if (!e.target.closest('#ns-drop')) e.preventDefault(); });
  q('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!N.busy) close(); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); submit(); return; }
    if (e.key === 'Tab') { // focus stays in the window
      const f = [...dlg.querySelectorAll('button, input, select, textarea, [tabindex="0"]')].filter((x) => !x.disabled && !x.closest('[hidden]') && x.offsetParent !== null && x.tabIndex >= 0 && !(x.type === 'radio' && !x.checked));
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();
  });
  renderRefs(); updateTakeMsg(); checkName({ quietEmpty: true }); updateFoot();
}

function status(msg, kind = '') {
  const el = q('.ns-status');
  el.hidden = !msg; el.className = `ns-status ${kind}`;
  el.innerHTML = msg ? `${kind === 'busy' ? '<i class="spin"></i> ' : ''}<span></span>` : '';
  if (msg) el.querySelector('span').textContent = msg;
}
function setBusy(b) {
  N.busy = b;
  for (const el of dlg.querySelectorAll('button, input, select, textarea')) {
    if (b) { el.dataset.wasDisabled = el.disabled ? '1' : ''; el.disabled = true; }
    else { el.disabled = el.dataset.wasDisabled === '1'; delete el.dataset.wasDisabled; }
  }
}

function readForm() {
  const fmt = val('ns-fmt') || '16:9', f = FORMATS.find((x) => x.id === fmt);
  const w = fmt === 'custom' ? Math.round(+q('#ns-w').value) : f.w, h = fmt === 'custom' ? Math.round(+q('#ns-h').value) : f.h;
  const look = q('#ns-look').value || 'preset:dark-grid', [lk, lid] = [look.slice(0, look.indexOf(':')), look.slice(look.indexOf(':') + 1)];
  const take = val('ns-take') || 'quick';
  return {
    name: q('#ns-name').value.trim(), prompt: q('#ns-prompt').value, format: fmt, w, h, fps: +q('#ns-fps').value, dur: +(+q('#ns-dur').value).toFixed(2),
    lookKind: lk, lookId: lk === 'preset' ? '' : lid, style: lk === 'preset' ? lid : `look-${lid}`, kind: val('ns-kind') || 'auto',
    take, verify: take === 'custom' ? q('#ns-verify').value : profileDefaults(take).verify, sound: q('#ns-sound').checked, render: q('#ns-render').checked,
    to: val('ns-to') || 'term', refs: N.refs,
  };
}
function validate(v) {
  const errs = [];
  const ne = N.mode === 'edit' ? '' : nameError(v.name);
  if (ne) { checkName(); errs.push('#ns-name'); }
  if (!v.prompt.trim()) { q('#ns-prompt-msg').textContent = 'Write what the scene should show.'; q('#ns-prompt-msg').classList.add('err'); errs.push('#ns-prompt'); }
  const fm = q('#ns-fmt-msg'); fm.textContent = ''; fm.classList.remove('err');
  if (!(v.w >= 16 && v.w <= 7680 && v.h >= 16 && v.h <= 7680) || v.w % 2 || v.h % 2) { fm.textContent = 'Width and height: even numbers, 16–7680.'; fm.classList.add('err'); errs.push(v.format === 'custom' ? '#ns-w' : '#ns-dur'); }
  else if (!(v.dur >= 0.5 && v.dur <= 600)) { fm.textContent = 'Duration: 0.5–600 s.'; fm.classList.add('err'); errs.push('#ns-dur'); }
  if (errs.length) q(errs[0]).focus();
  return !errs.length;
}

/** Unique file name under refs/ (existing refs and the ones queued in this window). */
function refTarget(name, src) {
  const taken = new Set(N.refs.filter((r) => r.kind === 'existing').map((r) => r.rel.split('/').pop().toLowerCase()));
  let f = refFileName(src), i = 2;
  const dot = f.lastIndexOf('.'), stem = dot > 0 ? f.slice(0, dot) : f, ext = dot > 0 ? f.slice(dot) : '';
  while (taken.has(f.toLowerCase())) f = `${stem}-${i++}${ext}`;
  return `scenes/${name}/refs/${f}`;
}

async function submit() {
  if (N.busy || !dlg) return;
  const v = readForm();
  if (!validate(v)) return;
  const edit = N.mode === 'edit', name = v.name;
  setBusy(true); status('');
  let created = false;
  try {
    if (v.lookKind === 'lib') {
      status(`Pinning the look "${v.lookId}" to this project…`, 'busy');
      const dir = libDir();
      await gfx(['look', 'use', v.lookId, ...(dir ? ['--library', dir] : [])]);
    }
    if (v.lookKind !== 'preset' && (!(await api.stat(`looks/${v.lookId}/preset.js`).catch(() => null)) || !(await api.stat(`style/presets/${v.style}.js`).catch(() => null)))) v.style = 'dark-grid'; // a look without preset.js
    const scaffold = v.kind === 'auto' ? 'anime' : v.kind;
    if (!edit) {
      status(`Creating scenes/${name}…`, 'busy');
      await gfx(['new', name, '--kind', scaffold, '--size', `${v.w}x${v.h}`, '--fps', String(v.fps), '--dur', String(v.dur), '--style', v.style]);
      created = true;
      N.mode = 'edit'; N.name = name; // from here on a retry must not run gfx new again
      q('#ns-name').readOnly = true; q('#ns-name').dataset.wasDisabled = '1';
    } else await patchSceneJson(name, v);
    // references: copy the new files into scenes/<name>/refs/
    for (const r of N.refs) {
      if (r.kind !== 'file') continue;
      const rel = refTarget(name, r.src);
      status(`Copying ${baseName(r.src)}…`, 'busy');
      const written = await api.importRef(r.src, rel); // the backend never overwrites: it may pick "<name>-2.<ext>"
      Object.assign(r, { kind: 'existing', rel: typeof written === 'string' && written ? written.replace(/\\/g, '/') : rel }); delete r.src;
    }
    status('Writing BRIEF.md…', 'busy');
    const rel = `scenes/${name}/BRIEF.md`, st = await api.stat(rel).catch(() => null);
    await api.writeProjectFile(rel, briefText({ ...v, refs: N.refs }), st?.mtime || 0);
    await hooks.refreshScenes();
    await hooks.selectScene(name);
    emit('brief-changed', name);
    status(v.to === 't3' ? 'Starting a T3 thread…' : 'Sending to Claude in the terminal…', 'busy');
    const message = `Build scene ${name} from scenes/${name}/BRIEF.md.` + (edit ? ' The brief changed: the scene exists already, rework it to match.' : '');
    try { await beforeAsk(message); } catch { /* checkpoint is best effort */ }
    localStorage.setItem(TO_KEY, v.to);
    if (v.to === 't3') {
      const r = await t3.send({ target: 'new', message, title: name });
      toast(`Sent to T3: ${r.title}`, 3000);
    } else {
      await sendToClaude(message, { send: true });
      toast('Sent to Claude in the terminal', 3000);
    }
    setBusy(false);
    close();
  } catch (e) {
    setBusy(false);
    const m = String(e.message || e);
    status(created ? `${m} (scenes/${name} was created: fix the problem, then Save brief & send)` : m, 'err');
    if (created) { q('#ns-create').textContent = 'Save brief & send'; q('#ns-title').textContent = 'Edit brief & send again'; hooks.refreshScenes().catch(() => {}); }
    console.warn('[newscene]', e);
  }
}
/** Edit mode: the format / style fields change scene.json (the kind is the brief's business: Claude switches it). */
async function patchSceneJson(name, v) {
  const rel = `scenes/${name}/scene.json`;
  const [txt, st] = await Promise.all([api.readText(rel), api.stat(rel)]);
  if (!txt) return;
  const j = JSON.parse(txt);
  const next = { ...j, width: v.w, height: v.h, fps: v.fps, duration: v.dur, style: v.style };
  if (['width', 'height', 'fps', 'duration', 'style'].every((k) => j[k] === next[k])) return;
  status('Updating scene.json…', 'busy');
  await api.writeProjectFile(rel, JSON.stringify(next, null, 2) + '\n', st?.mtime || 0, txt);
}

function close() {
  if (!dlg) return;
  clearTimeout(dropTimer); dropTimer = 0;
  for (const el of behind) el.inert = false;
  behind = [];
  dlg.remove(); dlg = null; N.busy = false;
  try { N.prevFocus?.focus?.(); } catch { /* gone */ }
}
export const newSceneOpen = () => !!dlg;
export const closeNewScene = close;

/** Open the window. `edit`: a scene name -> prefilled from its BRIEF.md + scene.json. */
let opening = false;
export async function openNewScene({ edit = null } = {}) {
  if (dlg) { q('#ns-name')?.focus(); return; }
  if (opening) return;
  if (!S.projectName || !S.root) { toast('Open a project first', 2500); return; }
  opening = true;
  try { await openWindow(edit); } finally { opening = false; }
}
async function openWindow(edit) {
  N.prevFocus = document.activeElement;
  N.mode = edit ? 'edit' : 'new'; N.name = edit || ''; N.refs = []; N.busy = false;
  const [looks, presets] = await Promise.all([loadLooks(), loadPresets()]);
  N.looks = looks; N.presets = presets;
  const prof = profileDefaults();
  const v = { name: '', prompt: '', format: '16:9', w: 1920, h: 1080, fps: 60, dur: 6, look: looks.project ? `project:${looks.project.id}` : 'preset:dark-grid', kind: 'auto', ...prof, to: localStorage.getItem(TO_KEY) || 'term' };
  if (edit) {
    const [bt, sj] = await Promise.all([api.readText(`scenes/${edit}/BRIEF.md`).catch(() => null), api.readText(`scenes/${edit}/scene.json`).catch(() => null)]);
    const b = parseBrief(bt || ''), j = (() => { try { return JSON.parse(sj || '{}'); } catch { return {}; } })();
    v.name = edit; v.prompt = b.prompt || '';
    v.w = j.width || b.w || v.w; v.h = j.height || b.h || v.h; v.fps = [30, 60].includes(j.fps || b.fps) ? (j.fps || b.fps) : 60; v.dur = j.duration || b.dur || v.dur;
    v.format = FORMATS.find((f) => f.w === v.w && f.h === v.h)?.id || 'custom';
    v.kind = KINDS.some(([k]) => k === b.kind) ? b.kind : KINDS.some(([k]) => k === j.kind) ? j.kind : 'auto';
    const style = j.style || b.style || 'dark-grid';
    if (looks.project && style === `look-${looks.project.id}`) v.look = `project:${looks.project.id}`;
    else { if (!N.presets.includes(style)) N.presets = [...N.presets, style].sort(); v.look = `preset:${style}`; }
    if (TAKES[b.take]) { v.take = b.take; v.verify = VERIFY[b.verify] ? b.verify : profileDefaults(b.take).verify; }
    if (typeof b.sound === 'boolean') v.sound = b.sound;
    if (typeof b.render === 'boolean') v.render = b.render;
    N.refs = (b.refs || []).map((r) => ({ ...r }));
  }
  build(v);
  behind = [...document.body.children].filter((el) => !el.inert);
  for (const el of behind) el.inert = true;
  document.body.appendChild(dlg);
  roundSurfaceOrigin(dlg);
  if (edit) { const p = q('#ns-prompt'); p.focus(); p.setSelectionRange(p.value.length, p.value.length); } else q('#ns-name').focus();
}

export function initNewScene(h) {
  hooks = { ...hooks, ...h };
  api.listen('gfx://dropped', (paths) => { // the app's drop hook (WebView2 file paths), when this window asked for them
    if (!dlg || !dropTimer || !Array.isArray(paths)) return;
    clearTimeout(dropTimer); dropTimer = 0;
    addFiles(paths);
  }).catch(() => {});
}
