import { normalizeServerRoot } from './server-root.js';
// Backend facade. Tauri (window.__TAURI__ invoke) in the app, HTTP dev shim (vite middleware) in a browser.
// Contract: docs/STUDIO.md "Backend API"; call shapes: apps/studio/src-tauri/API.md.
const tauri = typeof window !== 'undefined' && window.__TAURI__ && window.__TAURI__.core;
export const isTauri = !!tauri;
/** A yes/no question that really waits for the answer. In the app Tauri's dialog plugin replaces window.confirm with an
 *  async version (a Promise, always truthy), so `if (!confirm(...))` never stopped anything there; await covers both. */
export const ask = async (message) => (await window.confirm(message)) === true;

async function shim(op, args = {}) {
  const r = await fetch(`./__api/${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error || `${op} failed`), { code: j.code, mtime: j.mtime, text: j.text });
  return j.result;
}
const call = (op, args) => (tauri ? tauri.invoke(op, args) : shim(op, args));

export const getRoot = () => call('get_root');
export const setRoot = (path) => call('set_root', { path });
export const refreshProjectMetadata = () => call('refresh_project_metadata');
export const pickRoot = () => call('pick_root');
export const listScenes = () => call('list_scenes');
export const listProjectScenes = () => call('list_project_scenes');
export const projectInfo = (path) => call('project_info', { path });
/** Folder dialog that does not change the project. null when cancelled. The dev shim has no native dialog: it asks
 *  for the path with a prompt (E2E checks answer it). */
export const pickFolder = (title) => (tauri ? call('pick_folder', { title }) : Promise.resolve(window.prompt(`${title}\n(dev shim: type a folder path)`) || null));

// ---------- settings (docs/HOME-SETTINGS.md §2; Rust prefs.rs, JS twin settings-core.js) ----------
/** Machine settings: { shell, claudeCommand, ...only the keys that are set }. */
export const getSettings = () => call('get_settings');
/** Lenient merge (known keys only), kept for old callers. */
export const setSettings = (settings) => saveSettings('set_settings', { settings }, settings);
/** Strict patch { key: value | null } (null = back to the default) -> the new machine settings. */
export const patchSettings = (patch) => saveSettings('patch_settings', { patch }, patch);
async function saveSettings(op, args, patch) {
  const settings = await call(op, args);
  if (Object.hasOwn(patch, 'engineDir')) await refreshProjectMetadata();
  return settings;
}
/** { defaults: { projectsDir }, configDir, version, platform } */
export const settingsMeta = () => call('settings_meta');
/** The open project's overrides (gfx.json "settings"): { gfxJson, settings }. */
export const getProjectSettings = () => call('get_project_settings');
export const patchProjectSettings = (patch) => call('patch_project_settings', { patch });
/** Open a project file in the external editor from the settings (system default / custom command). */
export const openInEditor = (rel, line, col) => call('open_in_editor', { rel, line, col });
/** docs/LOOKS.md §1: rewrite the open project's managed CLAUDE.md block after a workflow change (`gfx init --refresh
 *  --no-skills --workflow <this computer's default>`). -> false when there is nothing to refresh (no gfx.json / engine repo). */
export const refreshWorkflowBlock = () => call('refresh_workflow_block');

// ---------- machine Library (docs/LOOKS.md §3; Rust library.rs, JS twin of the guards library-core.js) ----------
// Paths are relative to the Library folder (setting libraryDir, default <Documents>/gfx library): looks/<id>/…,
// presets/<name>.js, palettes/<name>.json only.
/** { dir, source: 'setting' | 'default', exists, files: [{ path, size, mtime }], truncated } */
export const libraryFiles = () => call('library_files');
/** Text (≤ 1 MB, UTF-8) or null when missing. */
export const libraryRead = (rel) => call('library_read', { rel });
/** An image inside a look (ref thumbnails), ≤ 20 MB -> ArrayBuffer. */
export async function libraryReadBytes(rel) {
  if (tauri) { const b = await tauri.invoke('library_read_bytes', { rel }); return b instanceof ArrayBuffer ? b : new Uint8Array(b).buffer; }
  const r = await fetch(`./__api/library_read_bytes?rel=${encodeURIComponent(rel)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `library ${rel}: ${r.status}`);
  return r.arrayBuffer();
}
/** Write a text file (.md .js .json .txt, ≤ 1 MB; parent folders and the Library folder are created). */
export const libraryWrite = (rel, text) => call('library_write', { rel, text });
/** Delete a look folder (looks/<id>), a file in a look, a preset or a palette. */
export const libraryDelete = (rel) => call('library_delete', { rel });
/** Duplicate a look / preset / palette into a new id of the same kind (`to` must not exist). */
export const libraryCopy = (from, to) => call('library_copy', { from, to });
/** Copy a picked file (absolute path) into a Library look: rel = looks/<id>/refs/<file> -> the rel written (deduplicated). */
export const libraryImport = (src, rel) => call('library_import', { src, rel });
/** Copy a picked reference file (absolute path) into the project. `rel` must be `scenes/<name>/refs/<file>` (an image or
 *  video, ≤ 200 MB; the scene folder must exist; the name is cleaned and never overwrites: `x-2.png`…) -> the rel written. */
export const importRef = (src, rel) => call('import_ref', { src, dest: rel });
/** Multi-select dialog for reference images / videos -> absolute paths ([] when cancelled). The dev shim has no native
 *  dialog: it asks with a prompt (paths separated by `|`). */
export const pickRefs = () => (tauri ? call('pick_refs')
  : Promise.resolve(String(window.prompt('Add references\n(dev shim: absolute file paths, separated by |)') || '').split('|').map((s) => s.trim()).filter(Boolean)));

// ---------- welcome window (docs/HOME-SETTINGS.md §1; Rust welcome.rs) ----------
/** { recent: [{ path, name, scenes, thumb, missing, opened, pinned }], folders: [{ path, missing, projects: [...] }] } */
export const recentList = () => call('recent_list');
export const classifyFolder = (path) => call('classify_folder', { path });
export const recentTouch = (path) => call('recent_touch', { path });
export const recentRemove = (path) => call('recent_remove', { path });
export const recentPin = (path, pinned) => call('recent_pin', { path, pinned });
export const recentRelocate = (from, to, folder = false) => call('recent_relocate', { from, to, folder });
export const recentImport = (entries) => call('recent_import', { entries });
export const folderAdd = (path) => call('folder_add', { path });
export const folderRemove = (path) => call('folder_remove', { path });
export const listTemplates = (folder) => call('list_templates', { folder: folder || null });
export const revealProject = (path) => call('reveal_project', { path });
export const openAppFolder = () => call('open_app_folder');
/** Thumbnail bytes (ArrayBuffer) of a listed project. */
export async function projectThumb(path) {
  if (tauri) { const b = await tauri.invoke('project_thumb', { path }); return b instanceof ArrayBuffer ? b : new Uint8Array(b).buffer; }
  const r = await fetch(`./__api/project_thumb?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`thumbnail: ${r.status}`);
  return r.arrayBuffer();
}
export const mainOpen = () => call('main_open');
/** Main window: show the welcome window (dev shim: the welcome page). */
export const openWelcome = () => (tauri ? call('open_welcome') : (location.href = './welcome.html', Promise.resolve(null)));
export const closeWelcome = () => call('close_welcome');
/** Wait for the main window's unsaved-edit decision. Subscribe before requesting the switch. */
let welcomeSeq = 0;
export async function welcomeOpen(path, timeoutMs = 60000) {
  if (!tauri) {
    const r = await call('welcome_open', { path });
    location.href = './index.html';
    return r;
  }
  const requestId = `${Date.now().toString(36)}-${++welcomeSeq}`;
  let finish, timer, un;
  const outcome = new Promise((resolve) => { finish = resolve; });
  try {
    un = await listen('gfx://open-project-result', (r) => { if (r.requestId === requestId) finish(r); });
    timer = setTimeout(() => finish({ status: 'error', error: 'Opening timed out. Check the project window, then try Open it again.' }), timeoutMs);
    const requested = call('welcome_open', { path, requestId }).then((r) => r === 'switched' ? outcome : { status: r });
    const r = await Promise.race([requested, outcome]);
    if (r.status === 'error') throw new Error(r.error || 'Could not open the project');
    return r.status;
  } finally { clearTimeout(timer); un?.(); }
}
/** Main window: acknowledge accepted / cancelled / failed project switches to the welcome webview. */
export const welcomeOpenResult = (requestId, status, error) => tauri
  ? window.__TAURI__.event.emitTo({ kind: 'Webview', label: 'welcome' }, 'gfx://open-project-result', { requestId, status, error })
  : Promise.resolve();
/** Welcome window: Settings (a page) in the main window. */
export const welcomeSettings = (page) => (tauri ? call('welcome_settings', { page }) : (location.href = `./index.html#settings=${encodeURIComponent(page)}`, Promise.resolve(null)));
/** Listen to a backend event (`gfx://...`); returns an unlisten function (no-op in the dev shim). */
export async function listen(event, fn) {
  if (!tauri) return () => {};
  return window.__TAURI__.event.listen(event, (e) => fn(e.payload));
}

let jobSeq = 0;
/**
 * Run an engine CLI command (`gfx <args>`) in the current project. `onEvent` gets the `--progress json` lines
 * ({type:'progress'|'log'|'done'|'error'|'exit', ...}); `done` resolves with { code, outputs, canceled, error }.
 * opts: { progress = true (append `--progress json`), noProject (init/doctor/setup), env: {GFX_*}, jobId }.
 */
export function engineRun(args, { onEvent, progress = true, noProject = false, env, distro, jobId } = {}) {
  jobId = jobId || `j${Date.now().toString(36)}${(jobSeq++).toString(36)}`;
  const opts = { progress, noProject, env: env || {}, distro };
  return backendJob('engine_run', { args, opts }, { onEvent, jobId });
}
function backendJob(op, args, { onEvent, jobId }) {
  const emit = (ev) => { try { onEvent?.(ev); } catch (e) { console.warn('engine event handler:', e); } };
  const done = (async () => {
    if (tauri) {
      const un = await window.__TAURI__.event.listen(`engine://${jobId}`, (e) => emit(e.payload));
      try { return await tauri.invoke(op, { jobId, ...args }); }
      finally { setTimeout(un, 100); }
    }
    await shim(op, { jobId, ...args });
    return new Promise((resolve, reject) => {
      const es = new EventSource(`./__api/engine_events?job=${encodeURIComponent(jobId)}`);
      let finished = false;
      es.onmessage = (m) => {
        const ev = JSON.parse(m.data);
        emit(ev);
        if (ev.type === 'exit') { finished = true; es.close(); resolve({ code: ev.code, outputs: ev.outputs || [], canceled: !!ev.canceled, error: ev.error ?? null }); }
      };
      es.onerror = () => { if (!finished) { es.close(); reject(new Error('lost the engine event stream')); } };
    });
  })();
  return { jobId, done };
}
/** The engine the app runs: { path, source: 'env' | 'setting' | 'app', found, wsl, error, setting } (GFX_ENGINE > the
 * "Engine folder" setting > engine/ next to the exe). */
export const engineInfo = () => call('engine_info');
/** Re-ask the engine where its sound library is (gfxlib:// reads from there) -> { library, dir, error? }. API.md. */
export const libLocate = () => call('lib_locate');
/** Every engine (docs/INSTALL.md §2): [{ kind: 'default' | 'wsl', distro, path, version, found, source, wsl, error }]. */
export const enginesInfo = () => call('engines_info');
/** engineRun without progress events; `done` resolves with the result plus the process's stdout `lines`. */
export function engineCapture(args, opts) {
  const lines = [];
  const job = engineRun(args, { ...opts, progress: false, onEvent: (ev) => { if (ev.type === 'log' && ev.stream === 'stdout') lines.push(ev.msg); } });
  return { jobId: job.jobId, done: job.done.then((res) => ({ ...res, lines })) };
}
/** Kill the job's process tree. */
export const engineCancel = (jobId) => call('engine_cancel', { jobId });

// ---------- Claude in the app (docs/CLAUDE-IN-APP.md §3) ----------
/** Open an http(s) / t3 link with the OS handler (no-op in the dev shim). */
export const openLink = (url) => call('open_link', { url });
/**
 * Open a terminal in the project folder. `onEvent` gets { data } output batches and finally { exit }.
 * Returns { shell, cwd, dispose } (dispose stops listening; ptyClose kills the process).
 */
export async function ptyOpen(id, cols, rows, opts, onEvent) {
  if (tauri) {
    const un = await window.__TAURI__.event.listen(`pty://${id}`, (e) => onEvent(e.payload));
    try { const info = await tauri.invoke('pty_open', { id, cols, rows, opts }); return { ...info, dispose: un }; }
    catch (e) { un(); throw e instanceof Error ? e : new Error(String(e)); }
  }
  const info = await shim('pty_open', { id, cols, rows, opts });
  const es = new EventSource(`./__api/pty_events?id=${encodeURIComponent(id)}`);
  let ended = false;
  es.onmessage = (m) => { const ev = JSON.parse(m.data); if ('exit' in ev) { ended = true; es.close(); } onEvent(ev); };
  es.onerror = () => { if (!ended) { es.close(); ended = true; onEvent({ exit: null }); } };
  return { ...info, dispose: () => { ended = true; es.close(); } };
}
export const ptyWrite = (id, data) => call('pty_write', { id, data });
export const ptyResize = (id, cols, rows) => call('pty_resize', { id, cols, rows });
/** Kill the terminal's process; `'*'` closes every terminal (after a webview reload). */
export const ptyClose = (id) => call('pty_close', { id });

// ---------- T3 Code (docs/T3.md; Rust t3.rs, dev shim t3-shim.js) ----------
// The access token and client_id never reach the page: status = { server, connected, level, scopes, expiresAt, reconnect,
// autoCreate, environmentId, connecting, error }.
// Errors: the app's t3_call rejects with { message, code? } (code = T3's failure code, e.g. runtime_mode_escalation_denied);
// the shim already throws an Error with .code. Either way: an Error whose message is readable and .code is kept.
const t3c = (op, args) => call(op, args).catch((e) => {
  if (e instanceof Error) throw e;
  if (e && typeof e === 'object' && typeof e.message === 'string') throw Object.assign(new Error(e.message), e.code ? { code: e.code } : {});
  throw new Error(String(e));
});
export const t3Status = () => t3c('t3_status');
/** { server?, autoCreate? } (server '' = http://127.0.0.1:3773; another server forgets the connection). */
export const t3SetOptions = (o) => t3c('t3_set_options', { server: o.server ?? null, autoCreate: o.autoCreate ?? null });
/** Connect step 2: approve gfx studio with a pairing code at `access` (T3's AuthMcpClientAccess) through T3's decision
 * endpoint -> status; rejects with T3's message (used-up code, ...). The code goes to the backend only, never to a log. */
export const t3ConnectStart = ({ access, code }) => t3c('t3_connect_start', { access, code });
export const t3ConnectCancel = () => t3c('t3_connect_cancel');
export const t3Disconnect = () => t3c('t3_disconnect');
/** An allowlisted MCP tool: t3_environment_read, t3_project_list/create, t3_thread_list/read/wait/launch/send, attachments. */
export const t3Call = (tool, args = {}) => t3c('t3_call', { tool, args });
/** Upload an image under out/<scene>/review/ as a pending T3 attachment -> { type, id, name, mimeType, sizeBytes }. */
export const t3Upload = (rel) => t3c('t3_upload', { rel });
/** WSL paths: { project, folder }. */
export const t3Paths = () => t3c('t3_paths');
/** The native T3 view: { url?, x, y, w, h (physical px), visible, window (label), zoom, create? } -> info ({ exists:false, shim:true } in the dev shim). */
export const t3View = (opts) => t3c('t3_view', { opts });
export const t3ViewInfo = () => t3c('t3_view_info');
export const t3ViewClose = () => t3c('t3_view_close');
/** Is the T3 view signed in to T3? -> { view, signedIn } (Rust asks T3's /api/auth/session with the view's cookie; the
 * cookie never reaches the page). Dev shim: { view: false } unless it emulates a view for tests. */
export const t3ViewSession = () => t3c('t3_view_session');
/** Connect step 1: load T3's `<server>/pair#token=<code>` in the T3 view (it signs itself in); then poll t3ViewSession. */
export const t3ViewPair = (code) => t3c('t3_view_pair', { code });

export const readText = (rel) => call('read_text', { rel });
export const writeText = (rel, text) => call('write_text', { rel, text });
/** Only `scenes/<scene>/render.json` (saved render presets). */
export const writeProjectText = (rel, text) => call('write_project_text', { rel, text });
/** Render files directly in out/<scene>/: [{ name, size, mtime, isDir }], newest first. */
export const listRenders = (scene) => call('list_renders', { scene });
/** Explorer /select on a result under out/ (app); the dev shim only returns the path. */
export const revealPath = (rel) => call('reveal_path', { rel });
export const openPath = (rel) => call('open_path', { rel });
export const stat =(rel) => call('stat', { rel });
/** Code workspace: { files: [{ path, size, mtime, writable }], truncated } (skips out/ .gfx/ node_modules/ .git/). */
export const listProjectFiles = () => call('list_project_files');
/** Write a source file: only scenes/**, style/**, *.md at the root, gfx.json. Resolves { mtime }. */
export const writeProjectFile = (rel, text, expectMtime, expectText) => call('write_project_file', { rel, text, expectMtime, expectText });
/** Live scene server (`gfx serve`, docs/REVIEW.md §4): { url } if it answers /__gfx/ping, else { url: null }. Pinged from the webview (CORS *). */
export async function serverStatus() {
  const url = 'http://127.0.0.1:5199';
  try {
    const r = await fetch(url + '/__gfx/ping', { signal: AbortSignal.timeout(600), cache: 'no-store' });
    if (!r.ok) return { url: null };
    const ping = await r.json();
    if (!ping.ok || typeof ping.root !== 'string') return { url: null };
    const root = await getRoot();
    return normalizeServerRoot(ping.root) === normalizeServerRoot(root)
      ? { url } : { url: null, other: ping.root };
  } catch { return { url: null }; }
}
/** Start (or reuse) the live server for the current root. Rejects with a readable message. */
export const startServer = () => call('start_server');

export async function readBytes(rel) {
  if (tauri) {
    const b = await tauri.invoke('read_bytes', { rel });
    return b instanceof ArrayBuffer ? b : new Uint8Array(b).buffer;
  }
  const r = await fetch(`./__api/read_bytes?rel=${encodeURIComponent(rel)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`read_bytes ${rel}: ${r.status}`);
  return r.arrayBuffer();
}

/** Raw bytes (Uint8Array) -> file under out/<scene>/review/. */
export async function writeBytes(rel, bytes) {
  if (tauri) return tauri.invoke('write_bytes', bytes, { headers: { rel: encodeURIComponent(rel) } });
  const r = await fetch(`./__api/write_bytes?rel=${encodeURIComponent(rel)}`, { method: 'POST', body: bytes });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `write_bytes ${rel} failed`);
  return null;
}

// Read-only library access: `gfxlib://` custom scheme in the app (Windows/Android webviews serve it at
// http://gfxlib.localhost), a dev-server route in the browser. See API.md.
const libBase = tauri
  ? (/Windows|Android/.test(navigator.userAgent) ? 'http://gfxlib.localhost/f/' : 'gfxlib://localhost/f/')
  : new URL('./__lib/f/', document.baseURI).href;
/** `p`: path under library/, or a source file (repo-relative or absolute) as listed in the library index. */
export const libUrl = (p) => libBase + encodeURI(p.replace(/\\/g, '/')).replace(/[?#]/g, (c) => encodeURIComponent(c));
export async function readLib(p) {
  const r = await fetch(libUrl(p));
  if (!r.ok) throw new Error(`library ${p}: ${r.status}`);
  return r.arrayBuffer();
}
export async function readLibText(p) {
  const r = await fetch(libUrl(p));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`library ${p}: ${r.status}`);
  return r.text();
}

// Installed WSL engines (docs/INSTALL.md §3a); setup uses the same cancellable event stream as engineRun.
export const wslDistros = () => call('wsl_distros');
export const wslBundleInfo = () => call('wsl_bundle_info');
export const wslEngineChecks = (distro) => call('wsl_engine_checks', { distro });
export const wslEngineRemove = (distro) => call('wsl_engine_remove', { distro });
export const windowsPathState = () => call('windows_path_state');
export const setWindowsPath = (add) => call('set_windows_path', { add });
export function wslEngineSetup(distro, linkPath, { onEvent } = {}) {
  const jobId = `wsl${Date.now().toString(36)}${(jobSeq++).toString(36)}`;
  return backendJob('wsl_engine_setup', { distro, linkPath }, { onEvent, jobId });
}
