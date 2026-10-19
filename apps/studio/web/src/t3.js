// T3 panel (docs/T3.md §4/§5): threads of this gfx project (or every project in its folder) from T3 over MCP, a native T3
// view (Tauri child webview kept over #t3-view; the dev shim shows an "Open in browser" link instead), the top-bar T3
// button + "waiting for you" badge, connect / reconnect, auto-create of the T3 project, and send (used by ask.js).
// One gfx project = one T3 project whose workspaceRoot is the project folder as a WSL path (t3_paths).
import * as api from './api.js';
import { S, on, emit, esc } from './store.js';
import { $, allDocs } from './dom.js';
import * as layout from './layout.js';
import { statusClass, inFolder, matchProject, pairingToken, CONNECT_ACCESS, aboveLevel, escalationText, launchModel, t3Error, ESCALATION, LEVEL_LABEL } from './t3-core.js';

const SCOPE_KEY = 'gfx-studio.t3.scope';
const STATUS_LABEL = { running: 'running', waiting: 'waiting for you', done: 'done', failed: 'failed', idle: 'idle' };
export const T = {
  status: null, paths: null, pathsRoot: null, projects: [], projectsAt: 0, project: null, folderProjects: [],
  threads: {}, env: '', match: null, scope: localStorage.getItem(SCOPE_KEY) === 'folder' ? 'folder' : 'project',
  open: null, // { threadId, projectId, title }
  err: '', loading: false, newOpen: false, waiting: 0, lastRefresh: 0,
  // Connect T3 in progress (docs/T3.md §2): { gen, step: 1|2, change, checking, noView, busy, pairAt, access, err1, err2, probeErr }
  conn: null,
};
const watch = new Map(); // threadId -> last status class, for threads the studio sent to (toast on done)
let pollTimer = 0, fastUntil = 0, refreshing = null, refreshQueued = false, projectsQueued = false, serverGen = 0, statusServer = '';

const connected = () => !!T.status?.connected;
export const level = () => (connected() ? T.status.level : '');
export const canOperate = () => level() === 'standard' || level() === 'full';
export const t3Status = () => T.status;
const server = () => T.status?.server || 'http://127.0.0.1:3773';
const normRoot = (p) => String(p || '').replace(/\/+$/, '');
// '' without the environment id: the view never shows T3's root (its index drops into a draft of another project)
export const threadUrl = (threadId) => (T.env && threadId ? `${server()}/${T.env}/${threadId}?embed=compact` : '');

// ---------- status ----------
export async function refreshStatus() {
  try {
    const status = await api.t3Status();
    if (statusServer && statusServer !== status?.server) {
      serverGen++;
      T.env = ''; T.projects = []; T.projectsAt = 0; T.project = null; T.match = null; T.folderProjects = [];
      T.threads = {}; T.open = null; T.waiting = 0; T.lastRefresh = 0; T.err = ''; T.newOpen = false;
      watch.clear(); fastUntil = 0; wantUrl = null; sentUrl = null; lastSent = '';
      if (T.conn) { connectGen++; T.conn = null; } // the backend dropped that flow too (t3_set_options)
    }
    statusServer = status?.server || statusServer;
    T.status = status;
  } catch (e) { T.status = null; T.err = String(e.message || e); }
  if (T.status?.environmentId) T.env = T.status.environmentId;
  syncButton(); render(); scheduleView(); emit('t3-status', T.status);
  return T.status;
}

// ---------- data ----------
async function listAll(tool, args, key) {
  const out = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const r = await api.t3Call(tool, { ...args, ...(cursor != null ? { cursor } : {}), limit: 100 });
    out.push(...(r?.[key] || []));
    if (r?.nextCursor == null) break;
    cursor = r.nextCursor;
  }
  return out;
}
async function loadPaths() {
  const root = S.root;
  if (T.pathsRoot !== root || !T.paths) {
    const paths = await api.t3Paths();
    if (S.root !== root) return null;
    T.paths = paths; T.pathsRoot = root;
  }
  return T.paths;
}
async function loadProjects(force) {
  if (!force && T.projects.length && Date.now() - T.projectsAt < 30000) return;
  const gen = serverGen;
  const projects = await listAll('t3_project_list', {}, 'projects');
  if (gen !== serverGen) return;
  T.projects = projects;
  T.projectsAt = Date.now();
}
// docs/T3.md §1: the T3 project with workspaceRoot = this folder ('exact'), else the longest parent project, e.g. the repo of
// a worktree ('parent': its threads are filtered to this worktree, new threads run in it, no project is created).
function matchProjects() {
  const p = T.paths;
  const m = p ? matchProject(T.projects, p.project, p.gitMain) : null;
  T.project = m?.project || null;
  T.match = m ? (m.exact ? 'exact' : 'parent') : null;
  T.folderProjects = p ? T.projects.filter((x) => inFolder(x.workspaceRoot, p.folder)) : [];
  if (T.match === 'parent' && !T.folderProjects.includes(T.project)) T.folderProjects.unshift(T.project);
}

// worktree of each thread of a parent project (t3_thread_list has none; t3_thread_read has worktreePath).
// Cache per server + thread + metadata revision (also across restarts); a workspace move updates updatedAt.
const WT_KEY = 'gfx-studio.t3.wt';
const wtCache = (() => { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(WT_KEY) || '{}')).slice(-5000)); } catch { return new Map(); } })();
const wtKey = (tid) => `${server()}|${tid}`;
function setWt(tid, updatedAt, worktreePath) {
  const k = wtKey(tid);
  wtCache.delete(k);
  wtCache.set(k, { updatedAt, worktreePath });
  while (wtCache.size > 5000) wtCache.delete(wtCache.keys().next().value);
}
function saveWt() {
  try { localStorage.setItem(WT_KEY, JSON.stringify(Object.fromEntries(wtCache))); } catch { /* full */ }
}
/** Where a thread runs: its worktree, else the project root. undefined = not known yet. */
export const threadCwd = (t, p) => { const c = wtCache.get(wtKey(t.threadId)); return t.updatedAt != null && c?.updatedAt === t.updatedAt ? normRoot(c.worktreePath || p.workspaceRoot) : undefined; };
export const wtReads = { n: 0 }; // t3_thread_read calls made for worktrees (E2E: the cache works)
async function loadWorktrees(p, threads, stale) {
  const todo = threads.filter((t) => threadCwd(t, p) === undefined);
  let changed = false;
  for (let i = 0; i < todo.length && !stale(); i += 6) {
    await Promise.all(todo.slice(i, i + 6).map(async (t) => {
      try {
        wtReads.n++;
        const r = await api.t3Call('t3_thread_read', { threadId: t.threadId, limit: 1, runLimit: 1, maxCharsPerItem: 1 });
        const th = r?.thread;
        if (!stale() && th && th.threadId === t.threadId) { setWt(t.threadId, t.updatedAt, th.worktreePath || ''); changed = true; }
      } catch { /* retried on the next refresh */ }
    }));
  }
  if (changed) saveWt();
}
/** The threads of "This project": all of an exact match; of a parent project only those running in this folder. */
export function mineThreads() {
  if (!T.project) return [];
  const ts = T.threads[T.project.id] || [];
  if (T.match !== 'parent') return ts;
  return ts.filter((t) => threadCwd(t, T.project) === T.paths.project);
}
/** t3_thread_launch args for this gfx project: in a parent project, the existing worktree (never a new one). */
function launchArgs(p) {
  if (T.match !== 'parent' || p.id !== T.project?.id) return {};
  return T.paths.gitMain ? { workspaceStrategy: { type: 'existing_worktree', worktreePath: T.paths.project } } : {};
}

/**
 * t3_thread_launch needs a model when the T3 project has no default (an MCP client has no caller thread to inherit one
 * from; T3's project handlers.ts). Stopgap until T3's `/new?project=` link (docs/T3.md §6, fork finding 3): the model of
 * the most recently updated thread here (in a parent project: this worktree's threads first, then the parent's), else
 * claudeAgent / claude-opus-5-5.
 */
async function modelArgs(p) {
  if (p.defaultModelSelection != null) return {};
  let all = T.threads[p.id];
  if (!all) { try { all = (await api.t3Call('t3_thread_list', { projectId: p.id, limit: 50 }))?.threads || []; } catch { all = []; } }
  const mine = T.match === 'parent' && p.id === T.project?.id ? mineThreads() : [];
  return { modelSelection: launchModel(mine, all) };
}

/** Why gfx can't send to this thread (T3 refuses a thread whose runtime mode is above gfx's level), else ''. */
export function sendBlocked(tid) {
  const t = tid && findThread(tid);
  const why = t && canOperate() ? aboveLevel(t.runtimeMode, level()) : '';
  return why ? `${why}. ⚙ → T3 → Change access… to send here` : '';
}
/** T3's runtime_mode_escalation_denied as the user should read it (keeps .code). */
const escalation = (tid, msg) => {
  const m = findThread(tid)?.runtimeMode; // the list may be stale: then the mode comes from T3's message
  return t3Error(escalationText(aboveLevel(m, level()) ? m : undefined, level(), msg), ESCALATION);
};

/** Re-read projects (every 30 s or forced) and the threads of every project in the folder. */
export function refresh({ projects = false } = {}) {
  if (refreshing) { refreshQueued = true; projectsQueued ||= projects; return refreshing; }
  refreshing = (async () => {
    if (!T.status) await refreshStatus();
    if (!connected() || !S.root) { T.threads = {}; T.waiting = 0; syncButton(); render(); return; }
    const root = S.root, gen = serverGen;
    const stale = () => root !== S.root || gen !== serverGen;
    T.loading = true; render();
    try {
      if (!await loadPaths() || stale()) return;
      await loadProjects(projects);
      if (stale()) return;
      matchProjects();
      if (!T.env) {
        try {
          const env = (await api.t3Call('t3_environment_read'))?.environmentId || '';
          if (stale()) return;
          T.env = env;
        } catch { /* retried on the next refresh; the view stays on its placeholder */ }
      }
      if (stale()) return;
      const lists = await Promise.all(T.folderProjects.map((p) => listAll('t3_thread_list', { projectId: p.id }, 'threads').then((threads) => [p.id, threads], () => [p.id, T.threads[p.id] || []])));
      if (stale()) return;
      T.threads = Object.fromEntries(lists);
      if (T.match === 'parent') await loadWorktrees(T.project, T.threads[T.project.id] || [], stale);
      if (stale()) return;
      noticeChanges();
      T.waiting = Object.values(T.threads).flat().filter((t) => statusClass(t.status) === 'waiting').length;
      T.err = '';
      if (T.open && !findThread(T.open.threadId) && !T.folderProjects.some((p) => p.id === T.open.projectId)) T.open = null;
    } catch (e) {
      if (stale()) return;
      T.err = String(e.message || e);
      if (/^reconnect/.test(T.err)) await refreshStatus();
    } finally {
      T.loading = false; T.lastRefresh = Date.now();
      syncButton(); render(); scheduleView();
    }
  })().finally(() => {
    refreshing = null;
    if (refreshQueued) {
      const projects = projectsQueued;
      refreshQueued = false; projectsQueued = false;
      return refresh({ projects });
    }
  });
  return refreshing;
}
export const findThread = (tid) => Object.values(T.threads).flat().find((t) => t.threadId === tid) || null;

function noticeChanges() {
  for (const [tid, before] of watch) {
    const t = findThread(tid);
    if (!t) continue;
    const now = statusClass(t.status);
    if (now === before) continue;
    watch.set(tid, now);
    if (now === 'done') { emit('toast', { m: `Claude finished: ${t.title}`, ms: 5000 }); watch.delete(tid); }
    else if (now === 'failed') { emit('toast', { m: `T3 thread ${t.status}: ${t.title}`, ms: 6000 }); watch.delete(tid); }
    else if (now === 'waiting') emit('toast', { m: `Claude is waiting for you: ${t.title}`, ms: 6000 });
  }
}

// ---------- polling: 5 s while the panel is visible, 30 s hidden (1.5 s for a minute after a send) ----------
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!connected()) return;
  const ms = Date.now() < fastUntil ? 1500 : layout.isVisible('t3') ? 5000 : 30000;
  pollTimer = setTimeout(async () => { await refresh().catch(() => {}); schedulePoll(); }, ms);
}

// ---------- project (auto-create) ----------
/** The T3 project of this gfx project; creates it with Full access + Auto-create, else throws with the WSL path. */
export async function ensureProject() {
  if (!await loadPaths()) throw new Error('The gfx project changed; try again');
  await loadProjects(false);
  matchProjects();
  if (T.project) return T.project;
  await loadProjects(true); matchProjects();
  if (T.project) return T.project;
  if (level() === 'full' && T.status.autoCreate) {
    const title = S.projectName || T.paths.project.split('/').pop();
    try { await api.t3Call('t3_project_create', { title, workspaceRoot: T.paths.project }); }
    catch (e) { if (!/already/i.test(e.message)) throw e; }
    await loadProjects(true); matchProjects();
    if (T.project) { emit('toast', { m: `Added this project to T3: ${title}`, ms: 3000 }); return T.project; }
  }
  throw Object.assign(new Error(`This project is not in T3 yet. Add this folder in T3: ${T.paths.project}`), { code: 'no-project' });
}

/** t3_thread_launch is not idempotent: after an error / lost answer, look for the thread (same title, just created) first. */
async function launch(args) {
  const t0 = Date.now();
  try { return await api.t3Call('t3_thread_launch', args); }
  catch (e) {
    if (/^(access|tool not allowed|reconnect|T3 is not connected)/.test(e.message)) throw e;
    try {
      const r = await api.t3Call('t3_thread_list', { projectId: args.projectId, titleContains: args.title.slice(0, 200), limit: 10 });
      const hit = (r?.threads || []).find((t) => t.title === args.title && Date.parse(t.createdAt) >= t0 - 120000);
      if (hit) return { threadId: hit.threadId, projectId: args.projectId, recovered: true };
    } catch { /* report the original error */ }
    throw e;
  }
}

/**
 * Send to T3 (docs/T3.md §5). target: 'new' | threadId. attachments: paths under out/<scene>/review/ (images).
 * Resolves { threadId, title, attached, skipped }.
 */
export async function send({ target, message, title, attachments = [] }) {
  if (!canOperate()) throw new Error('Sending needs Standard or Full access to T3 (⚙ → Integrations)');
  if (target !== 'new' && sendBlocked(target)) throw escalation(target); // T3 would refuse it (and the uploads would be wasted)
  const atts = [], skipped = [];
  for (const rel of attachments.slice(0, 8)) {
    try { atts.push(await api.t3Upload(rel)); } catch (e) { skipped.push(`${rel.split('/').pop()}: ${e.message || e}`); }
  }
  let threadId, ttl;
  if (target === 'new') {
    const p = await ensureProject();
    ttl = (title || 'gfx studio').slice(0, 120);
    const r = await launch({ projectId: p.id, title: ttl, ...launchArgs(p), ...await modelArgs(p), message, ...(atts.length ? { attachments: atts } : {}) });
    threadId = r.threadId;
    noteLaunched(p, threadId);
    T.open = { threadId, projectId: p.id, title: ttl };
  } else {
    threadId = target;
    const t = findThread(threadId);
    ttl = t?.title || T.open?.title || threadId;
    try {
      if (atts.length) await api.t3Call('t3_thread_send_attachments', { threadId, message, attachments: atts });
      else await api.t3Call('t3_thread_send', { threadId, message });
    } catch (e) { throw e.code === ESCALATION ? escalation(threadId, e.message) : e; }
    T.open = { threadId, projectId: t?.projectId || T.open?.projectId || T.project?.id, title: ttl };
  }
  watch.set(threadId, 'running');
  fastUntil = Date.now() + 60000;
  layout.showPanel('t3');
  T.projectsAt = 0;
  await refresh().catch(() => {});
  schedulePoll();
  return { threadId, title: ttl, attached: atts.length, skipped };
}

function noteLaunched(p, tid) {
  if (T.match === 'parent' && p.id === T.project?.id) { setWt(tid, null, launchArgs(p).workspaceStrategy ? T.paths.project : ''); saveWt(); }
}

/** For the Ask Claude composer: the thread open in the panel + the other threads of this project. */
export function choices() {
  const mine = mineThreads();
  return { open: T.open, threads: mine, project: T.project, connected: connected(), level: level() };
}

export async function openThread(threadId, projectId, title) {
  T.open = { threadId, projectId, title };
  render(); scheduleView();
}

async function newThread(title) {
  try {
    const p = await ensureProject();
    const ttl = title || `${S.name || S.projectName || 'gfx'} · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const r = await launch({ projectId: p.id, title: ttl, ...launchArgs(p), ...await modelArgs(p) });
    noteLaunched(p, r.threadId);
    T.open = { threadId: r.threadId, projectId: p.id, title: ttl };
    T.newOpen = false;
    await refresh();
  } catch (e) { T.err = String(e.message || e); render(); }
}

// ---------- connect ----------
// docs/T3.md §2, two steps in the panel. Step 1 signs the T3 view in: the pasted pairing link / code goes to T3's own
// `/pair#token=` page in the view (skipped when the view is signed in already). Step 2 approves gfx studio: the backend posts
// a SECOND pairing code + the access level to T3's /oauth/mcp/decision itself (a session made by a standard pairing code
// lacks access:write, so T3 would ask for a code on its approval page anyway). Change access… = step 2 only.
// Codes go from the input straight to the backend; they are never kept in state, logged, or put in a URL here.
const PAIR_POLL_MS = 1000, PAIR_TIMEOUT_MS = 10 * 60 * 1000, PAIR_SHOW_MS = 4000;
const ACCESS_OF = { 'read-only': 'read-only', standard: 'auto-accept-edits', full: 'full-access' };
let connectGen = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const live = (c) => T.conn === c && c.gen === connectGen;
const focusIn = (id) => requestAnimationFrame(() => $(id)?.focus());
/** Step 1: poll until the T3 view is signed in (or there is no view to sign in, e.g. the dev shim), then go to step 2. */
async function waitSignedIn(c) {
  const t0 = Date.now();
  for (;;) {
    let s;
    try { s = await api.t3ViewSession(); } catch (e) { s = { view: true, signedIn: false, err: String(e.message || e) }; }
    if (!live(c) || c.step !== 1) return;
    if (!s?.view || s.signedIn) {
      Object.assign(c, { step: 2, checking: false, noView: !s?.view, pairAt: 0, err1: '', probeErr: '' });
      render(); scheduleView(); focusIn('t3-c2');
      return;
    }
    if (c.checking || c.probeErr !== (s.err || '')) {
      if (c.checking) focusIn('t3-c1');
      c.checking = false; c.probeErr = s.err || ''; render();
    }
    if (Date.now() - t0 > PAIR_TIMEOUT_MS) throw new Error('Timed out waiting for the T3 view to sign in. Connect T3 again when you have a pairing link.');
    await sleep(c.pairAt ? 600 : PAIR_POLL_MS);
  }
}
/** Connect / Reconnect (both steps; step 1 is skipped when the view is signed in) and Change access… (`change`: step 2). */
export async function connect({ change = false } = {}) {
  layout.showPanel('t3');
  const c = T.conn = { gen: ++connectGen, step: change ? 2 : 1, change, checking: !change, noView: false, busy: false, pairAt: 0,
    access: ACCESS_OF[T.status?.level] || 'auto-accept-edits', err1: '', err2: '', probeErr: '' };
  T.err = '';
  render(); scheduleView();
  if (change) { focusIn('t3-c2'); return; }
  try {
    if (api.isTauri) await createViewHidden(); // t3_view_session reads the view's cookie store
    if (live(c)) await waitSignedIn(c);
  } catch (e) {
    if (!live(c)) return;
    T.conn = null; T.err = String(e.message || e);
    render(); scheduleView();
  }
}
/** Step 1: sign the T3 view in with the pasted pairing link or code. */
async function submitPair() {
  const c = T.conn, inp = $('t3-c1');
  if (!c || c.step !== 1 || c.busy || !inp) return;
  const tok = pairingToken(inp.value);
  if (!tok) { c.err1 = 'That is not a T3 pairing link or code.'; render(); return; }
  inp.value = '';
  Object.assign(c, { busy: true, err1: '' });
  render();
  try {
    await api.t3ViewPair(tok); // the shim pairs right away and throws T3's error; the app's view shows it after PAIR_SHOW_MS
    if (live(c)) { c.pairAt = Date.now(); sentUrl = '#pair'; lastSent = ''; }
  } catch (e) { if (live(c)) c.err1 = String(e.message || e); }
  if (live(c)) { c.busy = false; render(); scheduleView(); }
}
/** Step 2: approve gfx studio with a second pairing code at the chosen access level (the backend posts T3's decision). */
async function submitApprove() {
  const c = T.conn, inp = $('t3-c2');
  if (!c || c.step !== 2 || c.busy || !inp) return;
  c.access = $('t3')?.querySelector('input[name=t3-access]:checked')?.value || c.access;
  const tok = pairingToken(inp.value);
  if (!tok) { c.err2 = 'That is not a T3 pairing link or code.'; render(); return; }
  Object.assign(c, { busy: true, err2: '' });
  render();
  const was = connected() ? level() : ''; // Change access: the earlier grant stays in T3 (gfx can't revoke it)
  try { await api.t3ConnectStart({ access: c.access, code: tok }); }
  catch (e) {
    if (!live(c)) return;
    c.busy = false; c.err2 = String(e.message || e); // e.g. the code is used up: paste a new one into the same field
    render();
    const i = $('t3-c2'); i?.focus(); i?.select();
    return;
  }
  if (!live(c)) return;
  T.conn = null; T.projectsAt = 0;
  const st = await refreshStatus();
  if (st?.connected) {
    const m = `Connected to T3 · ${LEVEL_NAME[st.level] || st.level} access`;
    emit('toast', was && c.change ? { m: `${m}. ${oldGrantNote(was)}`, ms: 9000 } : { m, ms: 3000 });
    await refresh({ projects: true });
    schedulePoll();
  }
}
export async function cancelConnect() {
  connectGen++; T.conn = null;
  await api.t3ConnectCancel().catch(() => {}); await refreshStatus();
}
/** gfx can't revoke its earlier T3 grant (no MCP self-revocation; docs/T3.md §6 fork finding 4): tell the user where to. */
export const oldGrantNote = (lvl) => `Remove the old "gfx studio" entry${LEVEL_LABEL[lvl] ? ` (${LEVEL_LABEL[lvl]})` : ''} in T3 → Settings → Connections.`;
/** Forget the connection here. -> the note about the grant left in T3 ('' when there was none). */
export async function disconnect() {
  connectGen++; T.conn = null;
  const had = T.status?.connected || T.status?.reconnect ? oldGrantNote(level()) : '';
  await api.t3Disconnect();
  T.threads = {}; T.projects = []; T.project = null; T.match = null; T.folderProjects = []; T.open = null; T.waiting = 0; watch.clear();
  wantUrl = null;
  if (api.isTauri) { await api.t3ViewClose().catch(() => {}); viewOn = false; lastSent = ''; sentUrl = null; }
  await refreshStatus();
  return had;
}
export const LEVEL_NAME = { 'read-only': 'Read-only', standard: 'Standard', full: 'Full' };

export function openT3() { layout.showPanel('t3'); refresh(); schedulePoll(); }

// ---------- top-bar button ----------
function syncButton() {
  const b = $('claude-split');
  if (!b) return;
  const st = T.status;
  const badge = b.querySelector('.t3-badge');
  if (badge) { badge.hidden = !T.waiting; badge.textContent = String(T.waiting); }
  b.classList.toggle('t3-off', !st?.connected);
  const statusTitle = st?.connected ? `T3 · ${LEVEL_NAME[st.level] || st.level} access${T.waiting ? ` · ${T.waiting} thread${T.waiting > 1 ? 's' : ''} waiting for you` : ''}`
    : st?.reconnect ? 'T3: the connection expired, reconnect' : 'T3: not connected (open the panel to connect)';
  if (badge) { badge.title = statusTitle; badge.setAttribute('aria-label', statusTitle); }
}

// ---------- panel ----------
const rel = (iso) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
function row(t, pid) {
  const c = statusClass(t.status), on = T.open?.threadId === t.threadId, above = sendBlocked(t.threadId);
  // above gfx's level: still openable (the T3 view drives it), but Send to T3 can't reach it; the tooltip says why
  return `<button type="button" class="t3-row${on ? ' on' : ''}${above ? ' above' : ''}" data-tid="${esc(t.threadId)}" data-pid="${esc(pid)}" title="${esc(t.title)} · ${esc(STATUS_LABEL[c])}${t.status !== c ? ` (${esc(t.status)})` : ''}${above ? `&#10;${esc(above)}` : ''}">
    <i class="t3-dot ${c}" aria-label="${esc(STATUS_LABEL[c])}"></i><span class="t3-title">${esc(t.title || '(untitled)')}</span><span class="t3-meta">${esc(rel(t.updatedAt || t.createdAt))}${t.model ? ` · ${esc(t.model)}` : ''}</span></button>`;
}
const WHERE_CODES = 'T3 → <b>Settings → Connections</b> → create a pairing link (or code)';
/** The Connect T3 steps (docs/T3.md §2). Inputs are re-rendered only when this HTML changes (render keeps their values). */
function connectHtml(c) {
  const dis = c.busy ? ' disabled' : '';
  const s1 = c.change ? '' : c.step === 1
    ? `<div class="t3-step on" data-step="1"><div class="t3-step-h"><b>Step 1 of 2 · Sign in the T3 view</b></div>
        ${c.checking ? '<small>Checking whether the T3 view is signed in…</small>' : `
        <label class="t3-field">Paste the pairing link or code<input id="t3-c1" type="text" autocomplete="off" spellcheck="false" placeholder="http://127.0.0.1:3773/pair#token=… or the code"${dis}></label>
        <small>In ${WHERE_CODES}. The T3 view below shows your threads with this sign-in.</small>
        <div class="t3-btns"><button type="button" class="primary" data-a="pair"${dis}>Sign in</button></div>
        ${c.pairAt ? '<small>Signing the T3 view in… If T3 shows an error below, paste another link.</small>' : ''}`}
        ${c.err1 || c.probeErr ? `<div class="t3-err">${esc(c.err1 || c.probeErr)}</div>` : ''}</div>`
    : `<div class="t3-step done" data-step="1"><b>Step 1 of 2 · Sign in the T3 view</b> <span class="t3-ok">✓ ${c.noView ? 'not needed here (no T3 view)' : 'signed in'}</span></div>`;
  const s2 = c.step !== 2
    ? `<div class="t3-step" data-step="2"><b>Step 2 of 2 · Approve gfx studio</b></div>`
    : `<div class="t3-step on" data-step="2"><div class="t3-step-h"><b>${c.change ? 'Approve gfx studio at a new level' : 'Step 2 of 2 · Approve gfx studio'}</b></div>
        <div class="t3-access" role="radiogroup" aria-label="Access level">${CONNECT_ACCESS.map(([v, n, d]) => `<label><input type="radio" name="t3-access" value="${v}"${v === c.access ? ' checked' : ''}${dis}><span><b>${esc(n)}</b>: ${esc(d)}</span></label>`).join('')}</div>
        <label class="t3-field">Paste a ${c.change ? '' : 'second '}pairing link or code<input id="t3-c2" type="text" autocomplete="off" spellcheck="false"${dis}></label>
        <small>${c.change ? `Approving needs a pairing code (${WHERE_CODES}).` : `Each pairing code works once: the first signed in the T3 view, this one approves gfx studio (${WHERE_CODES} again).`}</small>
        ${c.err2 ? `<div class="t3-err">${esc(c.err2)}</div>` : ''}
        <div class="t3-btns"><button type="button" class="primary" data-a="approve"${dis}>${c.busy ? 'Approving…' : 'Approve'}</button></div></div>`;
  return `<div class="t3-msg t3-connect"><b>${c.change ? 'Change T3 access' : 'Connect T3'}</b>${s1}${s2}
    <div class="t3-btns"><button type="button" class="tbtn" data-a="cancel-connect">Cancel</button></div></div>`;
}
function noteHtml() {
  const st = T.status;
  if (!st) return `<div class="t3-msg bad">${esc(T.err || 'T3 backend not available')}</div>`;
  if (T.conn) return connectHtml(T.conn);
  if (!st.connected) {
    return `<div class="t3-msg">${st.reconnect ? '<b>The T3 connection expired.</b>' : '<b>T3 is not connected.</b>'} Threads, Send to T3 and the T3 view need a one-time connect to ${esc(st.server)}.
      <div class="t3-btns"><button type="button" class="primary" data-a="connect">${st.reconnect ? 'Reconnect T3' : 'Connect T3'}</button><button type="button" class="tbtn" data-a="settings">Settings…</button></div>
      ${T.err || st.error ? `<div class="t3-err">${esc(T.err || st.error)}</div>` : ''}</div>`;
  }
  let h = '';
  if (T.match === 'parent' && T.project) {
    h += `<div class="t3-in" title="${esc(T.project.workspaceRoot)}">In T3 project <b>${esc(T.project.title)}</b> · ${T.paths?.gitMain ? 'this worktree' : 'this folder'}</div>`;
  }
  if (T.paths && !T.project && !T.loading && T.lastRefresh) {
    h += level() === 'full' && st.autoCreate
      ? `<div class="t3-msg">This project is not in T3 yet. It is added when you start a thread (Auto-create is on).</div>`
      : `<div class="t3-msg"><b>Add this folder in T3</b> to see and start its threads:<code class="t3-path">${esc(T.paths.project)}</code>
         <div class="t3-btns"><button type="button" class="tbtn" data-a="copy-path">Copy path</button></div>
         <small>${level() === 'full' ? 'Auto-create is off (⚙ → Integrations).' : 'With Full access the studio can add it for you.'}</small></div>`;
  }
  if (T.err) h += `<div class="t3-err">${esc(T.err)}</div>`;
  return h;
}
function listHtml() {
  if (!connected()) return '';
  const groups = T.scope === 'folder' ? T.folderProjects : T.project ? [T.project] : [];
  if (!groups.length) return T.loading ? '<div class="t3-empty">Loading…</div>' : '';
  return groups.map((p) => {
    const ts = T.scope === 'folder' ? T.threads[p.id] || [] : mineThreads();
    const head = T.scope === 'folder' ? `<div class="t3-group${p.id === T.project?.id ? ' mine' : ''}" title="${esc(p.workspaceRoot)}">${esc(p.title)}<small>${esc(p.workspaceRoot.split('/').pop())}</small></div>` : '';
    return head + (ts.length ? ts.map((t) => row(t, p.id)).join('') : '<div class="t3-empty">No threads yet</div>');
  }).join('');
}
export function render() {
  const el = $('t3');
  if (!el) return;
  const op = canOperate();
  for (const b of el.querySelectorAll('#t3-scope button')) b.classList.toggle('on', b.dataset.scope === T.scope);
  const nb = $('t3-new');
  nb.disabled = !op; nb.title = !connected() ? 'Connect T3 first' : op ? 'New thread in this project' : 'Needs Standard or Full access (⚙ → Integrations → Change access…)';
  $('t3-refresh').disabled = !connected();
  $('t3-refresh').classList.toggle('busy', T.loading);
  $('t3-newrow').hidden = !T.newOpen || !op;
  setNote($('t3-note'), noteHtml());
  const list = $('t3-list');
  const scroll = list.scrollTop;
  list.innerHTML = listHtml();
  list.scrollTop = scroll;
  list.hidden = !connected();
  // the view: native in the app (only ever on a thread of this project, or on /pair during connect step 1); the dev shim
  // has none. Without an open thread the panel shows its own placeholder, never T3's root.
  const url = connected() && T.open ? threadUrl(T.open.threadId) : '';
  let ph;
  if (T.conn) ph = `<div>${T.conn.pairAt ? 'Signing the T3 view in…' : 'Connecting to T3: follow the steps above.'}</div>`;
  else if (!connected()) ph = '<div>Connect T3 to see threads here.</div>';
  else if (url) ph = api.isTauri ? '<div class="t3-ph-dim">T3 view</div>' : `<div>T3 view: the dev shim has no native webview.</div><a id="t3-open-browser" href="${esc(url)}" target="_blank" rel="noopener">Open in browser: ${esc(T.open.title || T.open.threadId)}</a>`;
  else if (T.open || T.loading || !T.lastRefresh) ph = '<div class="t3-ph-dim">Loading…</div>';
  else if (T.project) ph = `<div class="t3-ph-empty">${op ? 'Pick a thread or <b>+ New thread</b>' : 'Pick a thread'}</div>`;
  else ph = `<div class="t3-ph-empty">This project is not in T3 yet${level() === 'full' && T.status.autoCreate ? ': <b>+ New thread</b> adds it' : ': add this folder in T3 (see above)'}.</div>`;
  setNote($('t3-view-ph'), ph);
  if (api.isTauri && !T.conn) wantUrl = url || null;
}
/** innerHTML only when it changed, keeping what was typed into inputs with an id (the connect fields survive polling). */
function setNote(el, html) {
  if (el.__html === html) return;
  const typed = [...el.querySelectorAll('input[id]')].map((i) => [i.id, i.value, i === document.activeElement]);
  el.innerHTML = html; el.__html = html;
  for (const [id, v, f] of typed) { const i = el.querySelector(`#${id}`); if (i) { i.value = v; if (f) i.focus(); } }
}

// ---------- the native T3 view (Tauri child webview over #t3-view) ----------
let viewOn = false, wantUrl = null, lastSent = '', pending = false, viewWatch = 0, sentUrl = null;
/** Connect step 1 after "Sign in": the view (on T3's /pair) shows only if it is not signed in after PAIR_SHOW_MS, so a
 *  rejected link shows T3's error there, and a successful one never shows T3's root (where /pair goes next). */
const pairShown = () => !!T.conn && T.conn.step === 1 && !!T.conn.pairAt && Date.now() - T.conn.pairAt > PAIR_SHOW_MS;
const OVERLAYS = ['.modal-back:not([hidden])', '#settings-page:not([hidden])', '#library-page:not([hidden])', '#note-pop:not([hidden])', '#att-preview:not([hidden])', '.gfx-menu', '.t3-overlay'];
function overlapped(r, doc) {
  if (document.body.classList.contains('gfx-dragging')) return true; // dock drop targets must stay visible
  for (const d of allDocs()) {
    for (const el of d.querySelectorAll(OVERLAYS.join(','))) {
      if (el.closest('#t3')) continue;
      const o = el.getBoundingClientRect();
      if (!o.width || !o.height) continue;
      if (d !== doc) continue; // another window: does not cover this one
      if (o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top) return true;
    }
  }
  return false;
}
/** The part of `el` that is really visible: its rect clipped by every ancestor that clips (overflow ≠ visible) and by the
 *  window's viewport. A native view drawn outside it would cover other panels or reach past the window edge, where the
 *  page inside would believe it is taller than what shows (and could not scroll to its bottom). */
function visibleRect(el) {
  const w = el.ownerDocument.defaultView;
  const r = el.getBoundingClientRect();
  let l = Math.max(r.left, 0), t = Math.max(r.top, 0), rt = Math.min(r.right, w.innerWidth), b = Math.min(r.bottom, w.innerHeight);
  for (let a = el.parentElement; a && a !== el.ownerDocument.documentElement; a = a.parentElement) {
    const cs = w.getComputedStyle(a);
    if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
    const ar = a.getBoundingClientRect();
    l = Math.max(l, ar.left); t = Math.max(t, ar.top); rt = Math.min(rt, ar.right); b = Math.min(b, ar.bottom);
  }
  const width = Math.max(0, rt - l), height = Math.max(0, b - t);
  return { left: l, top: t, right: l + width, bottom: t + height, width, height };
}
function viewParams() {
  const el = $('t3-view');
  if (!el) return null;
  const doc = el.ownerDocument, w = doc.defaultView;
  const r = visibleRect(el), dpr = w.devicePixelRatio || 1;
  const label = w === window ? 'main' : w.__TAURI_INTERNALS__?.metadata?.currentWindow?.label || 'main';
  const visible = (!!wantUrl || pairShown()) && el.isConnected && layout.isVisible('t3') && r.width > 24 && r.height > 24 && !overlapped(r, doc) && !document.hidden;
  const zoom = +(layout.uiZoomLevel() * (layout.getScale('t3') || 1)).toFixed(3);
  // snap to whole device pixels inside the visible rect (rounding up could overshoot the panel by a pixel)
  const x0 = Math.ceil(r.left * dpr - 0.01), y0 = Math.ceil(r.top * dpr - 0.01), x1 = Math.floor(r.right * dpr + 0.01), y1 = Math.floor(r.bottom * dpr + 0.01);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), visible, window: label, zoom };
}
async function pushView() {
  pending = false;
  if (!api.isTauri) return;
  const p = viewParams();
  if (!p) return;
  if (!viewOn && !p.visible) return; // nothing to create yet
  const opts = { ...p };
  if (wantUrl && wantUrl !== sentUrl && !T.conn) opts.url = wantUrl; // never navigate away from /pair while connecting
  const sig = JSON.stringify(opts);
  if (sig === lastSent) return;
  lastSent = sig;
  try {
    const info = await api.t3View(opts);
    viewOn = !!info?.exists;
    if (opts.url && viewOn) sentUrl = opts.url;
  } catch (e) {
    // the window that held the view was closed (pop-out): recreate it in the panel's window
    lastSent = ''; sentUrl = null;
    if (viewOn) { viewOn = false; await api.t3ViewClose().catch(() => {}); scheduleView(); }
    else console.warn('[t3] view:', e.message || e);
  }
}
export function scheduleView() { if (api.isTauri && !pending) { pending = true; requestAnimationFrame(pushView); } }
/** Connect: create the view hidden (at about:blank) if it does not exist, so step 1 can check its sign-in. */
async function createViewHidden() {
  for (let i = 0; i < 4 && !viewOn; i++) {
    await sleep(i ? 150 : 50); // the panel was just shown / a dialog just closed: let it lay out
    const p = viewParams();
    if (!p) continue;
    try { viewOn = !!(await api.t3View({ ...p, visible: false, create: true }))?.exists; } catch (e) { console.warn('[t3] view:', e.message || e); }
    lastSent = ''; sentUrl = '#connect'; // the next wanted URL navigates
  }
}
export const viewState = () => ({ on: viewOn, wantUrl, sentUrl, params: viewParams() });

// ---------- init ----------
export function initT3() {
  const el = $('t3');
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('button, a');
    if (!b) return;
    const a = b.dataset.a;
    if (b.dataset.scope) { T.scope = b.dataset.scope; localStorage.setItem(SCOPE_KEY, T.scope); render(); return; }
    if (b.classList.contains('t3-row')) { openThread(b.dataset.tid, b.dataset.pid, findThread(b.dataset.tid)?.title); return; }
    if (a === 'connect') connect();
    else if (a === 'pair') submitPair();
    else if (a === 'approve') submitApprove();
    else if (a === 'cancel-connect') cancelConnect();
    else if (a === 'settings') emit('open-settings', 't3');
    else if (a === 'copy-path') { try { await navigator.clipboard.writeText(T.paths.project); emit('toast', { m: 'Path copied', ms: 1500 }); } catch { emit('toast', { m: T.paths.project, ms: 5000 }); } }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches?.('#t3-c1, #t3-c2')) return;
    e.preventDefault();
    if (e.target.id === 't3-c1') submitPair(); else submitApprove();
  });
  el.addEventListener('change', (e) => { if (e.target.name === 't3-access' && T.conn) T.conn.access = e.target.value; });
  $('t3-refresh').onclick = (e) => { e.currentTarget.blur(); refreshStatus().then(() => refresh({ projects: true })); };
  $('t3-new').onclick = (e) => { e.currentTarget.blur(); T.newOpen = !T.newOpen; render(); if (T.newOpen) $('t3-new-title').focus(); };
  const startNew = () => { const v = $('t3-new-title').value.trim(); $('t3-new-title').value = ''; newThread(v); };
  $('t3-new-go').onclick = startNew;
  $('t3-new-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); startNew(); } else if (e.key === 'Escape') { e.preventDefault(); T.newOpen = false; render(); } });

  on('open-t3', () => { layout.showPanel('t3'); refresh(); });
  on('root', () => { T.paths = null; T.project = null; T.match = null; T.folderProjects = []; T.threads = {}; T.open = null; T.lastRefresh = 0; render(); refresh({ projects: true }); });
  on('layout-panel', ({ id, shown }) => { if (id === 't3') { if (shown) refresh(); schedulePoll(); } scheduleView(); });
  for (const ev of ['dock-moved', 'panel-scale', 'mode-ui', 'scene']) on(ev, scheduleView);
  if (api.isTauri) {
    window.__TAURI__.event.listen('t3://status', () => refreshStatus());
    new ResizeObserver(scheduleView).observe($('t3-view'));
    window.addEventListener('resize', scheduleView);
    document.addEventListener('visibilitychange', scheduleView);
    new MutationObserver(scheduleView).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    layout.dock()?.onDidLayoutChange?.(scheduleView);
    // panel moves without a resize (a neighbour's sash, a tab switch elsewhere): a cheap rect check while the view is up
    clearInterval(viewWatch);
    viewWatch = setInterval(() => { if (viewOn || wantUrl) scheduleView(); }, 250);
  }
  refreshStatus().then(() => { if (connected()) { refresh({ projects: true }); schedulePoll(); } });
}
