// Versions panel (docs/CODE-VERSIONS.md §4): project history through `gfx version … --json` (git underneath, engine-side).
// Current state + Save version, history (thumb, note, actor badge, time, files), details with per-file +/−, merge-view
// diff, restore version / file, "Turn on versions" card, auto-checkpoints (before Ask Claude, after renders) and
// "Undo Claude's change". The engine repo itself is shown read-only (no init / save / restore).
//
// Claude attribution heuristic (studio-side, documented in §4): before an auto checkpoint, if the last version is a
// "Before asking Claude" checkpoint and every changed file is under scenes/ or style/, those changes are first saved as
// their own version "Claude's changes" with actor `claude`.
import * as api from './api.js';
import { S, on, emit, esc } from './store.js';
import { transport } from './transport.js';
import { showDiff } from './diff.js';
import { openVisualDiff } from './vdiff.js';
import { noteExternal } from './code.js';
import { pref, setPref } from './prefs.js';

const BAC = /^Before asking Claude/;
export const V = {
  status: null, log: [], loaded: false, root: null, busy: '', err: '', errUpdate: false, engineRepo: false, sel: null, curOpen: false, at: 0,
  auto: true, // Settings → Code & versions (prefs.js), applied on 'prefs'
};
let el = null, refreshing = null, thumbs = new Map(), lastVisible = 0, projectGeneration = 0;
const projectContext = () => {
  const root = S.root, generation = projectGeneration;
  return { root, current: () => S.root === root && generation === projectGeneration };
};
const toast = (m, ms = 2500) => emit('toast', { m, ms });

// ---------- CLI ----------
/** `gfx version <args>` -> parsed JSON (whole stdout, or from the first line that starts a JSON value). */
export async function vcli(args) {
  const out = [], err = [];
  const { done } = api.engineRun(['version', ...args], {
    progress: false,
    onEvent: (ev) => {
      if (ev.type === 'log') (ev.stream === 'stderr' ? err : out).push(ev.msg);
      else if (ev.type === 'error') err.push(ev.msg);
    },
  });
  const res = await done;
  const txt = out.join('\n').trim();
  let j;
  try { j = JSON.parse(txt); } catch {
    const i = out.findIndex((l) => /^\s*[[{]/.test(l));
    if (i >= 0) { try { j = JSON.parse(out.slice(i).join('\n')); } catch { /* not JSON */ } }
  }
  if (res.code !== 0) {
    const f = failureMessage({ out, err, error: (j && (j.error || j.message)) || res.error, code: res.code, cmd: `version ${args[0] || ''}`.trim() });
    throw Object.assign(new Error(f.msg), { update: f.update });
  }
  return j ?? null;
}
// node's crash noise around the real error ("Cannot find module …"): stack frames, braces, carets, the version footer
const NOISE = /^(\s+at |\s*[{}]\s*$|\s*\^+\s*$|\s*throw \w+;?\s*$|node:internal\/|Node\.js v\d|\s*(code|requireStack|url): )/;
/** A failed engine run -> { msg, update }. `update` only when the engine ran but printed its usage (it has no such
 *  command); otherwise the message is the engine's own error, node's `Error: …` line, or the last meaningful lines. */
export function failureMessage({ out = [], err = [], error = '', code = 1, cmd = 'version' }) {
  if (out.some((l) => /^gfx <command>/.test(l))) return { msg: `This engine has no \`gfx ${cmd.split(' ')[0]}\` command.`, update: true };
  if (error) return { msg: String(error), update: false };
  const lines = err.filter((l) => l && l.trim() && !NOISE.test(l));
  const hit = lines.find((l) => /^\s*\w*Error\b/.test(l));
  const msg = (hit ? hit.trim() : lines.slice(-2).join(' ').trim()) || out.filter((l) => l && l.trim()).slice(-2).join(' ').trim();
  return { msg: msg || `gfx ${cmd} exited with ${code}`, update: false };
}
const shaArg = (s) => String(s || '').replace(/[^0-9a-fA-F]/g, '');

// ---------- state ----------
async function detectEngine() {
  const [a, b] = await Promise.all([api.stat('runner/cli.js').catch(() => null), api.stat('runner/player/bridge.js').catch(() => null)]);
  return !!(a && b);
}
const logList = (j) => (Array.isArray(j) ? j : Array.isArray(j?.entries) ? j.entries : Array.isArray(j?.log) ? j.log : []);
/** Reload status + history (one at a time; callers share the in-flight refresh). */
export function refresh() {
  if (refreshing) return refreshing;
  const context = projectContext(), root = context.root;
  V.busy = V.loaded && V.root === root ? '' : 'Loading…';
  render();
  refreshing = (async () => {
    try {
      const eng = await detectEngine();
      if (!context.current()) return;
      const st = await vcli(['status', '--json']);
      if (!context.current()) return;
      let log = [];
      if (st?.repo) log = logList(await vcli(['log', '--limit', '100', '--json']));
      if (!context.current()) return;
      Object.assign(V, { status: st, log, engineRepo: eng || !!st?.engine, err: '', loaded: true, root, at: Date.now() });
      if (V.sel && !log.some((e) => e.sha === V.sel)) V.sel = null;
    } catch (e) {
      if (!context.current()) return;
      Object.assign(V, { err: String(e.message || e), errUpdate: !!e.update, loaded: true, root, at: Date.now() });
    } finally { V.busy = ''; refreshing = null; render(); emit('versions'); }
  })();
  return refreshing;
}
const canWrite = () => !!V.status?.repo && !V.engineRepo;

// ---------- actions ----------
async function run(label, fn) {
  if (V.busy) return undefined;
  V.busy = label; render();
  try { return await fn(); }
  catch (e) { toast(`${label.replace(/…$/, '')} failed: ${e.message || e}`, 6000); return undefined; } // undefined = failed, null = ok without JSON
  finally { V.busy = ''; render(); }
}
const thumbArg = () => (S.name ? ['--thumb', `${S.name}@${(+transport.time() || 0).toFixed(2)}`] : []);
async function saveVersion() {
  if (!canWrite() || V.busy) return;
  const inp = el.querySelector('.vs-note'), note = inp?.value.trim() || '';
  const r = await run('Saving…', () => vcli(['save', ...(note ? ['-m', note] : []), '--actor', 'user', ...thumbArg(), '--json']));
  if (r === undefined) return refresh();
  if (r?.skipped) toast('Nothing changed since the last version');
  else { toast(`Saved version${note ? ` "${note}"` : ''}`); const cur = el.querySelector('.vs-note'); if (cur) cur.value = ''; } // the panel re-rendered: clear the live input
  await refresh();
}
async function initRepo() {
  if (V.engineRepo || V.busy) return;
  const r = await run('Turning on versions…', () => vcli(['init', '--json']));
  if (r !== undefined) toast('Versions are on for this project');
  await refresh();
}
export async function restoreVersion(sha, paths = []) {
  if (!canWrite() || V.busy) return false;
  const e = V.log.find((x) => x.sha === sha), what = paths.length ? paths.join(', ') : 'all project files';
  if (!(await api.ask(`Restore ${what} to "${e ? title(e) : sha.slice(0, 7)}"?\nThe current state is saved as a version first, nothing is lost.`))) return false;
  const r = await run('Restoring…', () => vcli(['restore', shaArg(sha), ...paths.flatMap((p) => ['--path', p]), '--json']));
  await refresh();
  if (r !== undefined) { noteExternal(`restored from version ${e?.short || sha.slice(0, 7)}`); toast(paths.length ? `Restored ${paths.join(', ')}` : `Restored version ${e?.short || sha.slice(0, 7)}`); emit('versions-restored', { sha, paths }); }
  return r !== undefined;
}
async function diffEntry(e, mode = 'version') {
  if (V.busy) return;
  const i = V.log.indexOf(e);
  // `diff <a>` alone = the changes made by <a> (against its parent / the empty tree)
  const args = mode === 'worktree' ? ['diff', shaArg(e.sha), '--worktree', '--json'] : ['diff', shaArg(e.sha), '--json'];
  const j = await run('Loading diff…', () => vcli(args));
  if (!j) return;
  const files = (j.files || []).map((f) => ({ ...f, binary: !!(f.binary || f.tooLarge) }));
  showDiff({
    title: mode === 'worktree' ? 'Compare with current files' : 'Changes in this version',
    sub: `${e.short || e.sha.slice(0, 7)} · ${title(e)}`,
    leftLabel: mode === 'worktree' ? `version ${e.short || e.sha.slice(0, 7)}` : (V.log[i + 1] ? `before (${V.log[i + 1].short || V.log[i + 1].sha.slice(0, 7)})` : 'before (empty)'),
    rightLabel: mode === 'worktree' ? 'current files' : `this version (${e.short || e.sha.slice(0, 7)})`,
    files, select: V.diffPath,
    actions: [
      { label: mode === 'worktree' ? 'Changes in this version' : 'Compare with current files', run: () => diffEntry(e, mode === 'worktree' ? 'version' : 'worktree') },
      ...(canWrite() ? [{ label: 'Restore this file', title: 'Restore the selected file to this version', run: (f) => f && restoreVersion(e.sha, [f.path]) }] : []),
    ],
  });
}

// ---------- auto checkpoints ----------
async function claudeAttribution(context) {
  const st = await vcli(['status', '--json']);
  if (!context.current()) return;
  const head = st?.head || {}, dirty = st?.dirty || [];
  if (dirty.length && BAC.test(head.msg || head.note || '') && dirty.every((d) => /^(scenes|style)\//.test(String(d.path || '').replace(/^"|"$/g, '')))) {
    await vcli(['save', '-m', "Claude's changes", '--actor', 'claude', '--json']);
    if (!context.current()) return;
  }
}
/** Auto checkpoint; every continuation belongs to the project that started it. */
export async function checkpoint(msg, { thumb, context = projectContext() } = {}) {
  if (!V.auto || !context.root || !context.current()) return null;
  try {
    if (!V.loaded || V.root !== context.root) await refresh();
    if (!context.current() || V.root !== context.root || !canWrite()) return null;
    await claudeAttribution(context);
    if (!context.current()) return null;
    const r = await vcli(['save', '-m', msg, '--actor', 'auto', ...(thumb ? ['--thumb', thumb] : []), '--json']);
    if (!context.current()) return null;
    // A clean save has no commit; HEAD is still the exact before-request target.
    const st = await vcli(['status', '--json']);
    if (!context.current()) return null;
    refresh();
    return { ...r, undoSha: r?.sha || st?.head?.sha };
  } catch (e) { if (context.current()) { console.warn('auto checkpoint:', e); toast(`Auto checkpoint failed: ${e.message || e}`, 4000); } return null; }
}
const undoKey = (root) => `gfx-studio.versions.requests:${root}`;
function requests(root) {
  try { return JSON.parse(localStorage.getItem(undoKey(root)) || '[]'); } catch { return []; }
}
/** Persist each request's undo target even when its before-ask save was clean. */
export function beforeAsk(message) {
  const context = projectContext(), id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const m = String(message || '').replace(/\s+/g, ' ').trim();
  const msg = `Before asking Claude: ${m.length > 60 ? m.slice(0, 59) + '…' : m || '(no message)'}`;
  const work = checkpoint(msg, { context }).then((r) => {
    if (!context.current() || !r?.undoSha) return null;
    localStorage.setItem(undoKey(context.root), JSON.stringify([...requests(context.root), { id, sha: r.undoSha, message: m, at: Date.now() }].slice(-100)));
    render();
    return r;
  });
  return Promise.race([work, new Promise((r) => setTimeout(() => r(null), 10000))]);
}

function onRenderDone(j) {
  if (!j || j.root !== S.root) return;
  const a = j.args || [], val = (f) => { const i = a.indexOf(f); return i >= 0 ? a[i + 1] : null; };
  const preset = val('--preset') || val('--size') || (val('--scale') ? `x${val('--scale')}` : '') || j.format || '';
  const t = j.scene === S.name ? (+transport.time() || 0) : 0;
  checkpoint(`Rendered ${j.scene}${preset ? ' ' + preset : ''}`, { thumb: `${j.scene}@${t.toFixed(2)}` });
}

// ---------- view ----------
const ACTOR = { user: 'You', claude: 'Claude', auto: 'Auto', git: 'git' };
const title = (e) => e.note || e.msg || '(no message)';
function when(e) {
  const t = typeof e.time === 'number' ? (e.time < 1e12 ? e.time * 1000 : e.time) : Date.parse(e.time);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : s < 86400 * 30 ? `${Math.round(s / 86400)} d ago` : new Date(t).toLocaleDateString();
}
const fileName = (p) => String(p).split('/').pop();
function thumbRel(p) {
  if (!p) return null;
  const s = String(p).replace(/\\/g, '/'), r = String(S.root).replace(/\\/g, '/').replace(/\/+$/, '');
  return s.startsWith(r + '/') ? s.slice(r.length + 1) : s.replace(/^\.\//, '');
}
async function thumbUrl(rel) {
  const k = `${S.root}|${rel}`;
  if (!thumbs.has(k)) thumbs.set(k, api.readBytes(rel).then((b) => URL.createObjectURL(new Blob([b], { type: 'image/png' })), () => null));
  return thumbs.get(k);
}
/** The latest Ask Claude request and its undo target: { entry, request } (request null for an old-style checkpoint found by message). */
const latestBac = () => {
  const request = requests(S.root).at(-1);
  const entry = request ? V.log.find((e) => e.sha === request.sha) : V.log.find((e) => BAC.test(e.msg || '') && (e.actor === 'auto' || !e.actor));
  return entry ? { entry, request: request || null } : null;
};
/** Finding 12: the undo target row says where Claude was asked; a clean project's target is an ordinary version (e.g. "Project created"). */
function askMarker(e, request) {
  const dedicated = BAC.test(e.msg || '');
  const at = request?.at ? when({ time: request.at }) : dedicated ? when(e) : '';
  const msg = request ? request.message : String(e.msg || '').replace(BAC, '').replace(/^:\s*/, '');
  const tip = msg ? `You asked: ${msg.length > 200 ? msg.slice(0, 199) + '…' : msg}` : 'You asked Claude here';
  return { html: `<div class="vs-ask" title="${esc(tip)}">You asked Claude here${at ? ` · ${esc(at)}` : ''}</div>`, dedicated };
}

function build() {
  el = document.createElement('div');
  el.className = 'vs';
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('change', (e) => { if (e.target.classList.contains('vs-auto')) { V.auto = e.target.checked; setPref('versionsAuto', V.auto).catch((err) => toast('Auto-checkpoints: ' + (err.message || err), 4000)); } });
}
function render() {
  if (!el) return;
  const listTop = el.querySelector('.vs-list')?.scrollTop || 0, detailTop = el.querySelector('.vs-det')?.scrollTop || 0;
  const active = el.ownerDocument.activeElement, focusedSha = active?.classList.contains('vs-row') ? active.dataset.sha : null;
  const note = el.querySelector('.vs-note'), keep = note ? { v: note.value, f: note.ownerDocument.activeElement === note } : null;
  const st = V.status, ro = V.engineRepo;
  let body = '';
  if (!V.loaded) body = `<div class="hint vs-pad">${esc(V.busy || 'Loading…')}</div>`;
  else if (V.err && !st) body = `<div class="vs-card"><b>Versions are not available</b><p>${esc(V.err)}</p>${V.errUpdate ? '<p class="dim">Needs <code>gfx version</code> (engine update).</p>' : ''}<button type="button" class="tbtn" data-a="refresh">Try again</button></div>`;
  else if (!st?.repo) body = ro ? '<div class="vs-card"><b>Engine repo</b><p>History of the engine repo is read-only here.</p></div>'
    : `<div class="vs-card"><b>Turn on versions for this project</b><p>Every save, Ask Claude and render gets a restorable checkpoint. Uses git in the project folder (out/ and caches are ignored).</p><button type="button" class="primary" data-a="init"${V.busy ? ' disabled' : ''}>Turn on versions</button></div>`;
  else {
    const dirty = st.dirty || [], lb = latestBac();
    // where am I: the head is Current when nothing changed since; older versions with the same files are "= now"
    const now = { head: st.head?.sha || null, tree: st.head?.tree || null, clean: !dirty.length };
    body = `<div class="vs-cur">
      ${ro ? '' : `<div class="vs-save"><input type="text" class="vs-note" placeholder="Note (optional)" maxlength="200" spellcheck="false"><button type="button" class="primary" data-a="save"${V.busy ? ' disabled' : ''} title="Save a version of all project files (Enter)">Save version</button></div>
      <label class="chk vs-autol" title="Checkpoint before Ask Claude sends and after renders"><input type="checkbox" class="vs-auto"${V.auto ? ' checked' : ''}> Auto-checkpoints</label>`}
      <button type="button" class="vs-curh" data-a="cur" title="${dirty.length ? `${dirty.length} changed file${dirty.length === 1 ? '' : 's'} since the last version` : 'No changes'}"><span>${dirty.length ? `<b>${dirty.length}</b> changed file${dirty.length === 1 ? '' : 's'} since the last version` : 'No changes'}</span>${dirty.length ? `<i class="ft-caret${V.curOpen ? ' open' : ''}"></i>` : ''}</button>
      ${V.curOpen ? `<div class="vs-dirty">${dirty.slice(0, 40).map((d) => `<div><i class="st st-${esc(String(d.status || 'M').trim()[0] || 'M')}">${esc(String(d.status || 'M').trim()[0] || 'M')}</i>${esc(d.path)}</div>`).join('')}${dirty.length > 40 ? `<div class="dim">+${dirty.length - 40} more</div>` : ''}</div>` : ''}
    </div>
    <div class="vs-list" role="list" aria-label="Version history">${V.log.length ? V.log.map((e) => rowHtml(e, lb, now)).join('') : '<div class="hint vs-pad">No versions yet.</div>'}</div>
    <section class="vs-det" aria-label="Version details">${detailsHtml(V.log.find((e) => e.sha === V.sel), now)}</section>`;
  }
  el.innerHTML = `<div class="vs-head"><b>Versions</b>${ro ? '<span class="pill vs-eng" title="This is the engine repository: history is read-only, no save / restore">engine repo</span>' : ''}${st?.branch ? `<span class="dim vs-br">${esc(st.branch)}</span>` : ''}<span class="spacer"></span>${V.busy ? `<span class="chip"><i class="spin"></i><span>${esc(V.busy)}</span></span>` : ''}<button type="button" class="icon vs-rf" data-a="refresh" title="Refresh">&#8635;</button></div><div class="vs-body">${body}</div>`;
  const list = el.querySelector('.vs-list');
  if (list) list.scrollTop = listTop;
  const det = el.querySelector('.vs-det');
  if (det) det.scrollTop = detailTop;
  if (focusedSha) el.querySelector(`.vs-row[data-sha="${CSS.escape(focusedSha)}"]`)?.focus({ preventScroll: true });
  const n2 = el.querySelector('.vs-note');
  if (n2 && keep) { n2.value = keep.v; if (keep.f) n2.focus(); }
  for (const im of el.querySelectorAll('img[data-th]')) thumbUrl(im.dataset.th).then((u) => { if (u && im.isConnected) { im.src = u; im.hidden = false; } });
}
const stamp = (time) => { const d = new Date(time); return Number.isFinite(+d) ? d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
/** Title of a restore entry: "Restored: ‹source title› (file) · ‹date›"; the source title links to its entry. */
function restoredHtml(e) {
  const f = e.restoredFrom, files = /^Restored [0-9a-f]{7,40} (\(.*\))$/.exec(e.msg || '')?.[1] || '';
  const name = esc(f.msg || f.short), listed = V.log.some((x) => x.sha === f.sha);
  return `Restored: ${listed ? `<button type="button" class="link vs-from" data-a="goto" data-sha="${esc(f.sha)}" title="Show this version">${name}</button>` : name}${files ? ` ${esc(files)}` : ''}${stamp(f.time) ? ` · ${esc(stamp(f.time))}` : ''}`;
}
function badge(e, now) {
  if (e.sha === now.head) return now.clean ? '<span class="pill vs-now" title="Your files are exactly this version">Current</span>' : '<span class="pill" title="The latest saved version; your files have unsaved changes on top">Last saved</span>';
  if (now.clean && now.tree && e.tree === now.tree) return '<span class="pill vs-same" title="Same files as now">= now</span>';
  return '';
}
function rowHtml(e, lb, now = {}) {
  const sel = V.sel === e.sha, files = e.files || [], bac = lb?.entry === e, th = thumbRel(e.thumb);
  const mark = bac ? askMarker(e, lb.request) : null;
  const actor = e.actor || 'git'; // no Gfx-Actor trailer: a commit made outside gfx
  return `<div class="vs-row${sel ? ' sel' : ''}" data-sha="${esc(e.sha)}" role="listitem" tabindex="${sel || (!V.sel && e === V.log[0]) ? 0 : -1}" aria-current="${sel}">
    <div class="vs-th">${th ? `<img data-th="${esc(th)}" alt="" hidden>` : ''}</div>
    <div class="vs-main"><div class="vs-msg" title="${esc(e.msg || '')}">${e.restoredFrom ? restoredHtml(e) : esc(title(e))}</div>
      <div class="vs-meta">${badge(e, now)}<span class="actor a-${esc(actor)}"${actor === 'git' ? ' title="Commit made outside gfx (no Gfx-Actor trailer)"' : ''}>${esc(ACTOR[actor] || actor)}</span><span>${esc(when(e))}</span><span>${files.length} file${files.length === 1 ? '' : 's'}</span>${e.short ? `<span class="mono dim">${esc(e.short)}</span>` : ''}</div>
      ${mark && canWrite() ? `${mark.html}<button type="button" class="tbtn sm vs-undo" data-a="undo" data-sha="${esc(e.sha)}" title="${mark.dedicated ? 'Restore the project to this checkpoint (taken right before asking Claude)' : 'Restore the project to this version: it was the current state when you asked Claude (nothing had changed since, so no extra checkpoint was saved)'}">${mark.dedicated ? "Undo Claude's change" : "Undo Claude's change (back to this)"}</button>` : ''}
    </div></div>`;
}
function detailsHtml(e, now = {}) {
  if (!e) return '<div class="dim">Select a version to see its files and actions.</div>';
  const files = e.files || [];
  return `<div class="vs-detail-title"><div class="vs-msg" title="${esc(title(e))}">${e.restoredFrom ? restoredHtml(e) : esc(title(e))}</div>
    <div class="vs-meta">${badge(e, now)}<span class="mono">${esc(e.short || e.sha.slice(0, 7))}</span><span>${esc(when(e))}</span></div></div>
    <div class="vs-acts"><button type="button" class="tbtn sm" data-a="diff">Diff</button><button type="button" class="tbtn sm" data-a="wdiff" title="Compare this version with the current files">Compare with now</button><button type="button" class="tbtn sm" data-a="vdiff" title="See this version and the current files rendered side by side, as a wipe or as a difference (docs/VISUAL-DIFF.md)">Compare visually</button><span class="spacer"></span>${canWrite() ? '<button type="button" class="tbtn sm" data-a="restore">Restore version</button>' : ''}</div>
    <div class="vs-files">${files.length ? files.map((f) => `<div class="vs-f" data-p="${esc(f.path)}"><i class="st st-${esc(String(f.status || 'M')[0].toUpperCase())}">${esc(String(f.status || 'M')[0].toUpperCase())}</i><span class="vs-fp" title="${esc(f.path)}">${esc(f.path)}</span><span class="vs-n"><b class="add">+${f.add ?? 0}</b><b class="del">−${f.del ?? 0}</b></span><button type="button" class="link" data-a="fdiff" title="Diff this file">diff</button>${canWrite() ? '<button type="button" class="link" data-a="frestore" title="Restore this file to this version">restore</button>' : ''}</div>`).join('') : '<div class="hint">No file changes.</div>'}</div>`;
}
/** Update only selection and details: history nodes, focus and scroll stay in place. */
function selectVersion(sha, { focus = false } = {}) {
  V.sel = sha;
  for (const row of el.querySelectorAll('.vs-row')) {
    const selected = row.dataset.sha === sha;
    row.classList.toggle('sel', selected);
    row.setAttribute('aria-current', String(selected));
    row.tabIndex = selected || (!sha && row.dataset.sha === V.log[0]?.sha) ? 0 : -1;
    if (selected && focus) { row.focus({ preventScroll: true }); row.scrollIntoView({ block: 'nearest' }); }
  }
  const st = V.status, det = el.querySelector('.vs-det');
  if (det) {
    det.innerHTML = detailsHtml(V.log.find((e) => e.sha === sha), { head: st?.head?.sha, tree: st?.head?.tree, clean: !st?.dirty?.length });
    det.scrollTop = 0;
  }
}
function onKeyDown(ev) {
  if (ev.key === 'Enter' && ev.target.classList.contains('vs-note')) { ev.preventDefault(); return saveVersion(); }
}
export function versionRowFocused(ev) {
  const target = ev ? ev.target : el?.ownerDocument.activeElement;
  return !!target?.classList?.contains('vs-row') && !!el?.contains(target);
}
export function versionRowKeyDown(ev) {
  // Leave nested links and Undo buttons to their native keyboard handling.
  if (!versionRowFocused(ev)) return false;
  const row = ev.target, i = V.log.findIndex((e) => e.sha === row.dataset.sha);
  if (i < 0) return false;
  if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
    ev.preventDefault(); ev.stopPropagation();
    selectVersion(V.log[Math.max(0, Math.min(V.log.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))].sha, { focus: true });
  } else if (ev.key === 'Enter') {
    ev.preventDefault(); ev.stopPropagation();
    selectVersion(row.dataset.sha); V.diffPath = null; diffEntry(V.log[i]);
  } else if (ev.key === ' ') {
    ev.preventDefault(); ev.stopPropagation();
    selectVersion(V.sel === row.dataset.sha ? null : row.dataset.sha);
  }
}

function onClick(ev) {
  const b = ev.target.closest('[data-a]'), row = ev.target.closest('.vs-row');
  const a = b?.dataset.a;
  if (V.busy && a) return;
  const entry = (sha) => V.log.find((x) => x.sha === sha);
  const det = ev.target.closest('.vs-det'), selE = V.sel && entry(V.sel);
  if (a === 'refresh') return refresh();
  if (a === 'init') return initRepo();
  if (a === 'save') return saveVersion();
  if (a === 'cur') { V.curOpen = !V.curOpen; return render(); }
  if (a === 'undo') { ev.stopPropagation(); return restoreVersion(b.dataset.sha); }
  if (a === 'goto') return selectVersion(b.dataset.sha, { focus: true });
  if (det && selE) {
    const p = ev.target.closest('.vs-f')?.dataset.p;
    if (a === 'diff') { V.diffPath = null; return diffEntry(selE); }
    if (a === 'wdiff') { V.diffPath = null; return diffEntry(selE, 'worktree'); }
    if (a === 'vdiff') return openVisualDiff({ a: selE.sha, b: 'now', entries: V.log });
    if (a === 'restore') return restoreVersion(selE.sha);
    if (a === 'fdiff' && p) { V.diffPath = p; return diffEntry(selE); }
    if (a === 'frestore' && p) return restoreVersion(selE.sha, [p]);
    return;
  }
  if (row) selectVersion(V.sel === row.dataset.sha ? null : row.dataset.sha);
}

/** Show the panel inside `host` (the side tab list or the Code mode left column). */
export function mountVersions(host) {
  if (!host) return;
  if (!el) build();
  lastVisible = Date.now();
  if (el.parentNode === host && V.loaded && V.root === S.root) return; // already shown (callers re-render often)
  if (el.parentNode !== host) host.replaceChildren(el);
  if (!V.loaded || V.root !== S.root) { V.loaded = false; render(); refresh(); }
  else { render(); if (Date.now() - V.at > 4000) refresh(); }
}
const visible = () => !!el?.isConnected && el.offsetParent !== null;

export function initVersions() {
  on('root', () => { projectGeneration++; Object.assign(V, { status: null, log: [], loaded: false, root: null, err: '', sel: null, engineRepo: false }); for (const u of thumbs.values()) u.then((x) => x && URL.revokeObjectURL(x)); thumbs = new Map(); render(); });
  on('render-done', onRenderDone);
  on('prefs', ({ keys } = {}) => { if (keys?.includes('versionsAuto')) { V.auto = !!pref('versionsAuto'); const cb = el?.querySelector('.vs-auto'); if (cb) cb.checked = V.auto; } });
  let t = 0;
  on('code-saved', () => { clearTimeout(t); t = setTimeout(() => { if (visible()) refresh(); }, 600); });
  setInterval(() => { if (visible() && !document.hidden && !V.busy && Date.now() - V.at > 10000) refresh(); }, 3000);
  window.__versions = { V, refresh, checkpoint, beforeAsk, vcli, lastVisible: () => lastVisible };
}
