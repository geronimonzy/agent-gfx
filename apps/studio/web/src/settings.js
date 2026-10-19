import { showWslSetup } from './wslsetup.js';
import { openMenu, closeMenu } from './menu.js';
// Settings page (docs/HOME-SETTINGS.md §2): a full page inside the main window, structured like T3's settings: breadcrumb
// header, left nav with search (Ctrl+F or /, arrow keys, jump + pulse), sections as cards of rows (title + description left,
// control right), ↺ reset, scope sentence ("Applying to [All projects / <project>]"), inheritance marker, instant apply.
// Esc / ← Back returns to the workspace exactly as it was (the dock is only hidden, never re-laid out).
// Values: prefs.js (machine settings.json + the project's gfx.json "settings"); the T3 token / client id never reach this page.
import * as api from './api.js';
import { on, emit, esc, S } from './store.js';
import { $ } from './dom.js';
import * as t3 from './t3.js';
import { pref, prefsState, prefChain, hasOverride, machineSet, setPref, resetPref, defaultOf, prefSource, reloadProject } from './prefs.js';
import { SCHEMA, isProjectKey, UI_ZOOMS, workflowFields } from './settings-core.js';
import { TS, onTools, doctorRows, runDoctor, runReport, runSetup, chooseEngine, ENGINE_SOURCE } from './tools.js';
import { shortcutsHtml } from './keys-help.js';
import { creditsHtml, gfxLicenceHtml, showLicence, openCreditLink } from './about.js';
import { BUILTIN_PRESETS } from './render.js';
import * as layout from './layout.js';
import { libraryOpen, closeLibrary } from './library.js';

// ---------- compat for terminal.js and others ----------
/** { shell, claudeCommand } (machine values). */
export const getSettings = async () => ({ shell: pref('shell'), claudeCommand: pref('claudeCommand') });
export const settingsNow = () => ({ shell: pref('shell'), claudeCommand: pref('claudeCommand') });

// ---------- pages, sections, rows ----------
export const PAGES = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'rendering', label: 'Rendering' },
  { id: 'code', label: 'Code & versions' },
  { id: 'claude', label: 'Claude & terminal' },
  { id: 't3', label: 'T3' },
  { id: 'engine', label: 'Engine & tools' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'about', label: 'About' },
];
const pageLabel = (id) => PAGES.find((p) => p.id === id)?.label || id;

const sel = (options) => ({ type: 'select', options });
const PRESET_OPTIONS = () => [['scene', 'Scene size'], ...BUILTIN_PRESETS.map((p) => [p.id, `${p.label} · ${p.width}×${p.height}`])];
const LEVELS = [
  ['read-only', 'Read-only', 'see threads and their status'],
  ['standard', 'Standard', 'also send to and start threads'],
  ['full', 'Full access', 'also add T3 projects for gfx projects automatically'],
];
const DEFAULT_SERVER = 'http://127.0.0.1:3773';
// First take (docs/LOOKS.md §1)
const WF_PROFILES = [['quick', 'Quick'], ['full', 'Full'], ['custom', 'Custom']];
const WF_VERIFY = [['sheet', 'Contact sheet'], ['stills', 'Sheet + key stills'], ['full', 'Full (2 passes)']];
const WF_SOUND = [['asked', 'If asked'], ['always', 'Always']];
export function workflowLabel(v) {
  const f = workflowFields(v);
  if (f.profile !== 'custom') return f.profile === 'full' ? 'Full' : 'Quick';
  return `Custom: ${WF_VERIFY.find(([x]) => x === f.verify)?.[1].toLowerCase()}, ${f.render ? 'render' : 'no render'}, sound ${f.sound === 'always' ? 'always' : 'if asked'}`;
}
const day = (ms) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

/** Rows: key rows (a setting) and custom rows (render / bind). `kw` = extra search words. */
export const ROWS = [
  // General
  { id: 'onStart', page: 'general', section: 'Start', title: 'On start', desc: 'What the app opens first.', key: 'onStart', control: sel([['welcome', 'Welcome window'], ['last', 'Reopen last project']]), kw: 'startup launch open' },
  { id: 'projectsDir', page: 'general', section: 'Projects', title: 'Default projects folder', desc: 'Where New project suggests putting the project folder (you can still pick another one there).', key: 'projectsDir', control: { type: 'path' }, kw: 'location new project folder' },
  { id: 'libraryDir', page: 'general', section: 'Library', title: 'Library folder', desc: 'Your looks, style presets and sound palettes (the Library page). Picking a look copies it into the project. A WSL folder (\\\\wsl.localhost\\…) works too.', key: 'libraryDir', control: { type: 'path' }, kw: 'looks presets palettes sounds library folder path' },
  { id: 'editor', page: 'general', section: 'Code editor', title: 'External code editor', desc: 'Opens scene files from Code mode. Custom command: {file} {line} {col} are filled in (else the path is added at the end).', key: 'editor', control: { type: 'editor' }, kw: 'vs code vscode open file custom command' },
  // Appearance
  { id: 'uiZoom', page: 'appearance', section: 'Window', title: 'UI scale', desc: 'The whole window (also Ctrl+= / Ctrl+- / Ctrl+0).', key: 'uiZoom', control: sel(UI_ZOOMS.map((z) => [z, `${Math.round(z * 100)} %`])), kw: 'zoom size bigger smaller' },
  { id: 'showHeaders', page: 'appearance', section: 'Panels', title: 'Show all panel headers', desc: 'Full tab bars on every panel (for rearranging); off = compact grips.', key: 'showHeaders', control: { type: 'toggle' }, kw: 'tabs dock layout' },
  { id: 'resetLayouts', page: 'appearance', section: 'Panels', title: 'Reset panel layouts', desc: 'Back to the default arrangement of one mode, or of both.', custom: 'resetLayouts', kw: 'dock default review code' },
  // Rendering (per project)
  { id: 'renderMode', page: 'rendering', section: 'Defaults', title: 'Default mode', desc: 'Fast uses the GPU; Exact gives identical pixels on every run.', key: 'renderMode', control: sel([['fast', 'Fast (GPU)'], ['exact', 'Exact']]), kw: 'speed gpu software' },
  { id: 'renderWorkers', page: 'rendering', section: 'Defaults', title: 'Workers', desc: 'Browsers capturing frames in parallel. Auto: 1 in Exact mode, a few in Fast mode.', key: 'renderWorkers', control: sel([[0, 'Auto'], ...[1, 2, 3, 4, 6, 8].map((n) => [n, String(n)])]), kw: 'parallel threads cpu' },
  { id: 'renderPreset', page: 'rendering', section: 'Defaults', title: 'Default size preset', desc: 'Output size for a scene you have not rendered from the Render panel yet.', key: 'renderPreset', control: { type: 'select', options: PRESET_OPTIONS }, kw: 'resolution 1080p 4k reel' },
  { id: 'renderQuality', page: 'rendering', section: 'Defaults', title: 'Quality', desc: 'Video quality for MP4 / WebM (CRF 28 / 18 / 12).', key: 'renderQuality', control: sel([['draft', 'Draft'], ['normal', 'Normal'], ['high', 'High']]), kw: 'crf bitrate' },
  { id: 'renderFrameFormat', page: 'rendering', section: 'Defaults', title: 'Intermediate frames', desc: 'JPEG frames are faster in Fast mode (MP4 / WebM / GIF without alpha). Draft quality uses JPEG anyway.', key: 'renderFrameFormat', control: sel([['png', 'PNG'], ['jpeg', 'JPEG']]), kw: 'frame format jpg png' },
  { id: 'renderAudio', page: 'rendering', section: 'Defaults', title: 'Include audio by default', desc: 'MP4 renders get the scene\'s sound mix.', key: 'renderAudio', control: { type: 'toggle' }, kw: 'sound mux' },
  { id: 'renderOutDir', page: 'rendering', section: 'Output', title: 'Output folder', desc: 'Inside the project: out/ or a folder in it. Renders go to <folder>/<scene>/. The review video stays in out/<scene>/.', key: 'renderOutDir', control: { type: 'text', placeholder: 'out' }, kw: 'path directory' },
  // Code & versions (per project)
  { id: 'codeAutosave', page: 'code', section: 'Code mode', title: 'Code autosave', desc: 'Save a file 1.5 s after you stop typing.', key: 'codeAutosave', control: { type: 'toggle' }, kw: 'save editor' },
  { id: 'versionsAuto', page: 'code', section: 'Versions', title: 'Auto-checkpoints', desc: 'Save a version before Ask Claude sends and after renders.', key: 'versionsAuto', control: { type: 'toggle' }, kw: 'git history checkpoint' },
  // Claude & terminal
  { id: 'workflow', page: 'claude', section: 'First take', title: 'First take', desc: 'How much Claude checks, renders and sounds when it builds a new scene or rewrites one. Quick: 1 contact sheet, stills only where it shows a problem, no render, sound only if you ask. Full: stills at every beat in 2 passes, Claude renders, sound always. Review fixes always check the changed moments. Shown to Claude in the project\'s CLAUDE.md.', key: 'workflow', control: { type: 'workflow' }, kw: 'workflow profile quick full custom verify stills sheet render sound claude.md' },
  { id: 'shell', page: 'claude', section: 'Terminal', title: 'Shell', desc: 'New terminals in native (non-WSL) projects. Empty: pwsh.exe, else powershell.exe; WSL projects: bash.', key: 'shell', control: { type: 'text', placeholder: 'auto', mono: true }, kw: 'powershell pwsh bash cmd' },
  { id: 'claudeCommand', page: 'claude', section: 'Claude', title: 'Claude command', desc: 'What the Claude button types into the terminal.', key: 'claudeCommand', control: { type: 'text', placeholder: 'claude', mono: true }, kw: 'cli' },
  { id: 'askSend', page: 'claude', section: 'Claude', title: 'Ask Claude: send immediately', desc: 'Press Enter after pasting the brief into the terminal.', key: 'askSend', control: { type: 'toggle' }, kw: 'enter paste brief composer' },
  // T3
  { id: 't3Server', page: 't3', section: 'Connection', title: 'T3 server', desc: 'Address of the T3 server (127.0.0.1, not localhost). Another server forgets the current connection.', custom: 't3Server', kw: 'url address port' },
  { id: 't3Connection', page: 't3', section: 'Connection', title: 'Connection', desc: 'Connect runs two steps in the T3 panel, each with its own pairing link or code (T3 → Settings → Connections; each works once): 1. sign in the T3 view (skipped when it is signed in already), 2. approve gfx studio at the access level you pick. Change access… is step 2 only.', custom: 't3Connection', kw: 'connect disconnect access level change pairing oauth' },
  { id: 't3AutoCreate', page: 't3', section: 'Projects', title: 'Auto-create T3 projects', desc: 'Create the T3 project of a gfx project the first time you start a thread there (needs Full access).', custom: 't3AutoCreate', kw: 'create project automatic' },
  // Engine & tools
  { id: 'engineDir', page: 'engine', section: 'Engine', title: 'Engine folder', desc: 'The gfx engine the app runs: the folder with runner\\cli.js (the app\'s engine folder, or a gfx repo, also in WSL: \\\\wsl.localhost\\<distro>\\…). Auto = GFX_ENGINE, else the engine next to the app.', key: 'engineDir', control: { type: 'engine' }, kw: 'engine path folder wsl repo dev gfx_engine choose' },
  { id: 'engines', page: 'engine', section: 'Engine', title: 'Engines', desc: 'Each project runs on the engine of its own environment: Windows projects on the first one, WSL projects on the engine installed in their distro (or the Engine folder when it is in that distro).', custom: 'engines', kw: 'path version node' },
  { id: 'ffmpeg', page: 'engine', section: 'Tools', title: 'ffmpeg', desc: 'Encodes video and audio.', custom: 'tool:ffmpeg', kw: 'download encode video' },
  { id: 'browser', page: 'engine', section: 'Tools', title: 'Browser', desc: 'Renders the scenes. The pinned browser makes Exact renders reproducible on any machine.', custom: 'tool:browser', kw: 'chrome edge headless pinned install' },
  { id: 'doctor', page: 'engine', section: 'Check', title: 'Run doctor', desc: 'Checks the engine, node, browser, ffmpeg, git and the sound library.', custom: 'doctor', kw: 'diagnose check report' },
  // Shortcuts
  { id: 'shortcutsList', page: 'shortcuts', section: 'Keyboard shortcuts', title: 'Keyboard shortcuts', desc: 'The same list as the ? sheet.', custom: 'shortcuts', kw: 'keys keyboard hotkeys' },
  // About
  { id: 'version', page: 'about', section: 'gfx studio', title: 'Version', desc: 'The app and the engine it runs.', custom: 'version', kw: 'about' },
  { id: 'gfxLicence', page: 'about', section: 'gfx studio', title: 'Licence', desc: 'gfx is open source: use, change and share it under the MIT licence.', custom: 'gfxLicence', kw: 'license mit open source copyright' },
  { id: 'credits', page: 'about', section: 'gfx studio', title: 'Licenses and credits', desc: 'Third-party parts the studio uses or downloads, each under its own licence.', custom: 'credits', kw: 'license licence third party open source notices fonts sounds ffmpeg chrome clap model' },
  { id: 'appFolder', page: 'about', section: 'gfx studio', title: 'App folder', desc: 'settings.json, recent.json and the T3 connection (t3.json) of this computer. The app writes no log files yet.', custom: 'appFolder', kw: 'logs config data' },
];
const rowById = (id) => ROWS.find((r) => r.id === id);
/** Pages with a project setting get the scope sentence (Rendering, Code & versions). */
const scopedPage = (page) => ROWS.some((r) => r.page === page && r.key && isProjectKey(r.key));

// ---------- state ----------
const UI = { open: false, page: 'general', scope: 'project', q: '', hit: 0, chain: null, errors: {}, returnFocus: null, layoutsReset: new Set() };
let el = null, unsubs = [];
export const settingsOpen = () => UI.open;
const projectOpen = () => !!S.root && !!S.projectName;
const scope = () => (UI.scope === 'project' && projectOpen() && prefsState().gfxJson ? 'project' : 'machine');

/** Value shown at the current scope: project scope = the effective value; machine scope = this computer's value (or default). */
function shownValue(key) {
  if (scope() === 'project' || !isProjectKey(key)) return pref(key);
  const m = prefChain(key).find((l) => l.layer === 'machine');
  return m.set ? m.value : defaultOf(key);
}
function fmt(row, v) {
  if (v === undefined) return 'not set';
  const c = row.control;
  if (c?.type === 'toggle') return v ? 'On' : 'Off';
  const opts = typeof c?.options === 'function' ? c.options() : c?.options;
  if (opts) { const o = opts.find(([x]) => String(x) === String(v)); if (o) return o[1]; }
  if (c?.type === 'editor') return { vscode: 'VS Code', system: 'System default', custom: 'Custom command' }[v] || v;
  if (c?.type === 'workflow') return workflowLabel(v);
  return v === '' ? '(empty)' : String(v);
}

// ---------- controls ----------
function controlHtml(row) {
  const c = row.control, k = row.key, v = shownValue(k), dis = disabledFor(row) ? ' disabled' : '';
  switch (c.type) {
    case 'select': {
      const opts = typeof c.options === 'function' ? c.options() : c.options;
      return `<select data-k="${k}"${dis}>${opts.map(([x, l]) => `<option value="${esc(x)}"${String(x) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    }
    case 'toggle': return `<label class="chk sp-chk"><input type="checkbox" data-k="${k}"${v ? ' checked' : ''}${dis}></label>`;
    case 'text': return `<input type="text" data-k="${k}" value="${esc(v)}" placeholder="${esc(c.placeholder || '')}" spellcheck="false" autocomplete="off" class="${c.mono ? 'mono' : ''}"${dis}>`;
    case 'engine': {
      const e = TS.engine;
      const where = e ? (e.found ? `${e.wsl ? 'WSL · ' : ''}${ENGINE_SOURCE[e.source] || e.source}` : 'not found') : '';
      return `<span class="sp-stack"><span class="sp-path mono" title="${esc(e?.path || '')}">&lrm;${esc(v || (e?.source === 'setting' ? '' : e?.path) || 'Auto')}&lrm;</span>
        ${where ? `<span class="sp-val ${e.found ? 'ok' : 'bad'}"><i class="dot"></i>${esc(where)}</span>` : ''}
        <span class="sp-btns"><button type="button" class="tbtn" data-a="engine-choose"${dis}>Choose…</button>${!e?.found && e?.suggest ? `<button type="button" class="tbtn" data-a="engine-use" data-path="${esc(e.suggest)}" title="${esc(e.suggest)}">Use ${esc(e.suggest.split(/[\\/]/).filter(Boolean).pop())}</button>` : ''}</span></span>`;
    }
    case 'path': return `<span class="sp-pair"><input type="text" data-k="${k}" value="${esc(v)}" placeholder="${esc(defaultOf(k))}" spellcheck="false" autocomplete="off" class="mono"${dis}><button type="button" class="tbtn" data-a="browse" data-k="${k}"${dis}>Browse…</button></span>`;
    case 'editor': {
      const cmd = pref('editorCommand');
      return `<span class="sp-stack"><select data-k="editor"${dis}>${[['vscode', 'VS Code'], ['system', 'System default'], ['custom', 'Custom command']].map(([x, l]) => `<option value="${x}"${x === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
        ${v === 'custom' ? `<input type="text" data-k="editorCommand" value="${esc(cmd)}" placeholder='"C:\\…\\editor.exe" -g {file}:{line}' spellcheck="false" autocomplete="off" class="mono">` : ''}</span>`;
    }
    case 'workflow': {
      const f = workflowFields(v), o = (vals, cur) => vals.map(([x, l]) => `<option value="${x}"${String(x) === String(cur) ? ' selected' : ''}>${l}</option>`).join('');
      return `<span class="sp-stack sp-wf"><select data-k="workflow" aria-label="First take profile"${dis}>${o(WF_PROFILES, f.profile)}</select>
        ${f.profile === 'custom' ? `<span class="sp-wf-fields">
          <label>Verify <select data-wf="verify"${dis}>${o(WF_VERIFY, f.verify)}</select></label>
          <label>Claude renders <select data-wf="render"${dis}>${o([[true, 'On'], [false, 'Off']], f.render)}</select></label>
          <label>Sound <select data-wf="sound"${dis}>${o(WF_SOUND, f.sound)}</select></label></span>` : ''}</span>`;
    }
    default: return '';
  }
}
/** Machine-only rows on a project scope are read-only ("Applies to this computer"). */
const disabledFor = (row) => !!row.key && scope() === 'project' && scopedPage(row.page) && !isProjectKey(row.key);

function customHtml(row) {
  const st = t3.t3Status() || {};
  switch (row.custom) {
    case 'resetLayouts': return `<span class="sp-pair"><select data-a="layout-mode"><option value="review">Review</option><option value="code">Code</option><option value="all">All modes</option></select><button type="button" class="tbtn" data-a="reset-layout">Reset</button></span>`;
    case 't3Server': return `<input type="text" data-a="t3-server" value="${esc(st.server && st.server !== DEFAULT_SERVER ? st.server : '')}" placeholder="${DEFAULT_SERVER}" spellcheck="false" autocomplete="off" class="mono">`;
    case 't3Connection': return `<span class="sp-stack sp-t3">
        <span class="t3-st"><i></i><span>Not connected</span></span>
        <ul class="t3-levels">${LEVELS.map(([l, n, d]) => `<li data-l="${l}"><b>${esc(n)}</b>: ${esc(d)}</li>`).join('')}</ul>
        <span class="sp-btns"><button type="button" class="tbtn primary" data-a="connect">Connect T3</button>
        <button type="button" class="tbtn" data-a="change" hidden title="Approve gfx studio again at another access level, with a new pairing code (the new token replaces the old one)">Change access…</button>
        <button type="button" class="tbtn" data-a="disconnect" hidden title="Forget the token and the client registration on this computer (T3 keeps its gfx studio entry: remove it in T3 → Settings → Connections)">Disconnect</button>
        <button type="button" class="tbtn" data-a="cancel-connect" hidden>Cancel connecting</button></span></span>`;
    case 't3AutoCreate': return `<label class="chk sp-chk"><input type="checkbox" data-a="t3-autocreate"></label>`;
    case 'tool:ffmpeg': case 'tool:browser': return toolHtml(row.custom.slice(5));
    case 'doctor': return `<button type="button" class="tbtn" data-a="doctor"${TS.reportRunning ? ' disabled' : ''}>${TS.reportRunning ? '<i class="spin"></i> Running…' : 'Run doctor'}</button>`;
    case 'shortcuts': return '';
    case 'version': return `<span class="sp-val mono">gfx studio ${esc(prefsState().meta.version || '?')}${TS.doctor?.engine?.version ? ` · engine ${esc(TS.doctor.engine.version)}` : ''}</span>`;
    case 'gfxLicence': return gfxLicenceHtml();
    case 'credits': return '';
    case 'appFolder': return `<button type="button" class="tbtn" data-a="app-folder">Open app folder</button>`;
    default: return '';
  }
}
function toolHtml(id) {
  if (TS.running && !TS.doctor) return '<span class="sp-val"><i class="spin"></i> Checking…</span>';
  if (!TS.doctor) return `<span class="sp-stack"><span class="sp-val bad">${esc(TS.err || 'not checked')}</span><button type="button" class="tbtn" data-a="recheck">Check again</button></span>`;
  const r = doctorRows(TS.doctor).find((x) => x.id === id);
  if (!r) return '';
  const busy = TS.setup?.what === (id === 'ffmpeg' ? 'ffmpeg' : 'chrome');
  const failed = TS.setupError && TS.setupError.what === (id === 'ffmpeg' ? 'ffmpeg' : 'chrome');
  let btn = '';
  if (busy) btn = `<span class="sp-prog"><span class="setup-bar"><i style="width:${TS.setup.pct}%"></i></span><span class="setup-label">${esc(TS.setup.label)}</span></span>`;
  else if (id === 'ffmpeg' && !r.ok) btn = `<button type="button" class="tbtn primary" data-a="setup" data-what="ffmpeg"${TS.setup ? ' disabled title="Another download is running"' : ''}>${failed ? 'Retry' : 'Download'}</button>`;
  else if (id === 'browser' && r.fixLabel) btn = `<button type="button" class="tbtn${r.ok ? '' : ' primary'}" data-a="setup" data-what="chrome"${TS.setup ? ' disabled title="Another download is running"' : ''}>${failed ? 'Retry' : esc(r.fixLabel)}</button>`;
  return `<span class="sp-stack sp-tool"><span class="sp-val ${r.ok ? 'ok' : 'bad'}"><i class="dot"></i>${r.ok ? (id === 'engine' ? 'ready' : 'found') : 'missing'}</span><span class="sp-path mono" title="${esc(r.detail)}">&lrm;${esc(r.detail)}&lrm;</span>${failed ? `<span class="sp-err">${esc(TS.setupError.msg)}</span>` : ''}${btn}</span>`;
}
/** Settings → Engine & tools → Engines (docs/INSTALL.md §2): the Windows-projects engine, then one row per installed WSL engine. */
let wslBundle = null, windowsPath = null, wslError = '';
async function refreshWslEngines() {
  try {
    const [bundle, pathState, engines] = await Promise.all([api.wslBundleInfo(), api.windowsPathState().catch((e) => { wslError = String(e.message || e); return null; }), api.enginesInfo()]);
    wslBundle = bundle; windowsPath = pathState; TS.engines = engines;
  } catch (e) { wslError = String(e.message || e); }
  if (UI.open && UI.page === 'engine') {
    const extra = el.querySelector('[data-row=engines] .sp-extra');
    if (extra) extra.innerHTML = enginesHtml();
  }
}
function enginesHtml() {
  const list = TS.engines;
  if (!list) return `<p class="eng-none">${TS.running ? 'Checking…' : 'Not checked yet.'}</p>`;
  const label = (e) => (e.kind === 'wsl' ? `WSL projects · ${e.distro}` : e.wsl ? `Windows projects (WSL ${e.distro})` : 'Windows projects');
  const rows = list.map((e) => `<tr data-distro="${esc(e.distro || '')}" title="${esc(e.error || '')}"><th scope="row">${esc(label(e))}</th>
    <td class="eng-path" title="${esc(e.path)}">&lrm;${esc(e.path)}&lrm;</td><td class="eng-ver">${e.version ? `v${esc(e.version)}` : ''}</td>
    <td class="eng-st"><span class="sp-val ${e.found ? 'ok' : 'bad'}"><i class="dot"></i>${e.found ? esc(ENGINE_SOURCE[e.source] || e.source) : 'missing'}</span></td>
    <td class="eng-actions-cell">${e.kind === 'wsl' ? `<span class="eng-actions">${e.update || (wslBundle && e.version !== wslBundle.version) ? `<button type="button" class="tbtn xs" data-a="wsl-update" data-distro="${esc(e.distro)}"${wslBundle?.exists ? '' : ' disabled title="Install the matching WSL installer to update this engine"'}>Update</button>` : ''}<button type="button" class="tbtn xs icon" data-a="wsl-more" data-distro="${esc(e.distro)}" title="More: repair, checks, remove" aria-label="More actions for WSL ${esc(e.distro)}">&#8943;</button></span>` : ''}</td></tr>`);
  if (!list.some((e) => e.kind === 'wsl')) rows.push('<tr><th scope="row">WSL projects</th><td class="eng-none" colspan="4">no engine installed yet: the WSL installer adds one (or choose an Engine folder in WSL)</td></tr>');
  return `<table class="sp-table eng-table"><tbody>${rows.join('')}</tbody></table>
    ${wslBundle?.exists || windowsPath?.exists ? `<div class="eng-below">${wslBundle?.exists ? '<button type="button" class="tbtn" data-a="wsl-install">Install WSL engine…</button>' : ''}${windowsPath?.exists ? `<label class="eng-path-option chk"><input type="checkbox" data-a="windows-path"${windowsPath.added ? ' checked' : ''}>Add gfx to the Windows PATH (recommended)</label>` : ''}</div>` : ''}
    ${wslError ? `<p class="sp-err">${esc(wslError)}</p>` : ''}`;
}
function extraHtml(row) {
  if (row.custom === 'shortcuts') return `<div class="sp-extra kh"><input type="text" class="sp-kq kh-q" placeholder="Filter: key, action, area (e.g. loop, ctrl, live)" spellcheck="false" autocomplete="off"><div class="sp-keys kh-body">${shortcutsHtml('')}</div></div>`;
  if (row.custom === 'engines') return `<div class="sp-extra">${enginesHtml()}</div>`;
  if (row.custom === 'doctor' && TS.report) return `<pre class="sp-report${TS.report.code ? ' bad' : ''}">${esc([...TS.report.lines, TS.report.error ? `error: ${TS.report.error}` : ''].filter(Boolean).join('\n') || '(no output)')}</pre>`;
  if (row.custom === 'credits') return `<div class="sp-extra">${creditsHtml()}</div>`;
  return '';
}

function rowHtml(row) {
  const ctl = row.key ? controlHtml(row) : customHtml(row);
  const scoped = row.key && isProjectKey(row.key);
  return `<div class="sp-row" id="set-${row.id}" data-row="${row.id}" tabindex="-1">
    <div class="sp-main-row">
      <div class="sp-text">
        <div class="sp-title"><h3>${esc(row.title)}</h3>${scoped ? `<button type="button" class="sp-inh" data-a="chain" aria-label="Value inheritance" aria-haspopup="dialog" aria-controls="sp-chain-${row.id}"></button>` : ''}<button type="button" class="sp-reset" data-a="reset" style="visibility:hidden" disabled title="Reset">&#8634;</button></div>
        ${row.desc ? `<p class="sp-desc">${esc(row.desc)}</p>` : ''}
        <p class="sp-note" hidden>Applies to this computer</p>
        <p class="sp-err" role="status"></p>
      </div>
      ${ctl ? `<div class="sp-ctl">${ctl}</div>` : ''}
    </div>${extraHtml(row)}</div>`;
}

/** Reset button, inheritance marker, machine-only note, inline error of one row (no re-render: focus stays). */
function syncRow(id) {
  const row = rowById(id), r = el?.querySelector(`[data-row="${id}"]`);
  if (!row || !r) return;
  const err = r.querySelector('.sp-err');
  err.textContent = UI.errors[id] || ''; err.title = err.textContent;
  if (!row.key) return;
  const k = row.key, sc = scope(), p = isProjectKey(k);
  const reset = r.querySelector('.sp-reset');
  const canReset = sc === 'project' && p ? hasOverride(k) : machineSet(k) && !disabledFor(row);
  reset.style.visibility = canReset ? '' : 'hidden'; reset.disabled = !canReset;
  reset.title = sc === 'project' && p ? 'Remove the project override (use the inherited value)' : 'Reset to default';
  r.querySelector('.sp-note').hidden = !disabledFor(row);
  r.classList.toggle('ro', disabledFor(row));
  const inh = r.querySelector('.sp-inh');
  if (inh) {
    const src = sc === 'project' ? prefSource(k) : machineSet(k) ? 'machine' : 'default';
    inh.className = `sp-inh ${src}`;
    inh.title = { project: 'Overridden for this project', machine: sc === 'project' ? 'Inherited from this computer' : 'Set on this computer', default: 'Built-in default' }[src] + ' · click: where the value comes from';
    inh.setAttribute('aria-expanded', String(UI.chain === id));
    const ch = r.ownerDocument.querySelector(`.gfx-menu [data-chain="${id}"]`);
    if (ch) ch.innerHTML = chainHtml(row);
  }
}
function chainHtml(row) {
  const layers = prefChain(row.key).filter((l) => scope() === 'project' || l.layer !== 'project'), eff = layers.find((l) => l.set);
  return layers.map((l) => `<span class="${l === eff ? 'eff' : ''}${l.set ? '' : ' unset'}"><i>${l === eff ? '&#10003;' : ''}</i>${esc(l.label)}<b>${esc(l.set ? fmt(row, l.value) : 'not set')}</b></span>`).join('');
}
function showChain(anchor, row) {
  if (UI.chain === row.id) { closeMenu(); return; }
  const content = anchor.ownerDocument.createElement('div');
  content.className = 'sp-chain'; content.id = `sp-chain-${row.id}`; content.dataset.chain = row.id; content.innerHTML = chainHtml(row);
  openMenu(anchor, [], { content, onClose: () => { UI.chain = null; anchor.setAttribute('aria-expanded', 'false'); } });
  UI.chain = row.id; anchor.setAttribute('aria-expanded', 'true');
}
/** A value changed elsewhere (or the scope): refresh the control's value without rebuilding focused fields. */
function syncControl(id) {
  const row = rowById(id), r = el?.querySelector(`[data-row="${id}"]`);
  if (!row?.key || !r) return;
  const focused = r.contains(document.activeElement) && document.activeElement.matches('input[type=text]');
  if (!focused) r.querySelector('.sp-ctl').innerHTML = controlHtml(row);
  syncRow(id);
}

function syncT3() {
  if (!el || UI.page !== 't3') return;
  const st = t3.t3Status() || {};
  const box = el.querySelector('.sp-t3 .t3-st');
  if (!box) return;
  box.className = 't3-st' + (st.connected ? ' on' : st.reconnect ? ' warn' : '');
  box.querySelector('span').textContent = st.connecting ? 'Connecting… finish the steps in the T3 panel'
    : st.connected ? `Connected · ${t3.LEVEL_NAME[st.level] || st.level} access · until ${day(st.expiresAt)}`
      : st.reconnect ? 'The connection expired or was revoked: reconnect' : 'Not connected';
  for (const li of el.querySelectorAll('.sp-t3 .t3-levels li')) li.classList.toggle('on', li.dataset.l === st.level);
  const b = (a) => el.querySelector(`[data-a=${a}]`);
  b('connect').hidden = !!st.connected || !!st.connecting;
  b('connect').textContent = st.reconnect ? 'Reconnect T3' : 'Connect T3';
  b('change').hidden = !st.connected;
  b('disconnect').hidden = !st.connected && !st.reconnect;
  b('cancel-connect').hidden = !st.connecting;
  const ac = el.querySelector('[data-a=t3-autocreate]');
  if (ac) {
    ac.disabled = st.level !== 'full';
    ac.checked = !!st.autoCreate;
    const row = ac.closest('.sp-row');
    row.querySelector('.sp-note').hidden = !ac.disabled;
    row.querySelector('.sp-note').textContent = 'Needs Full access (Connection → Change access…)';
  }
  const srv = el.querySelector('[data-a=t3-server]');
  if (srv && document.activeElement !== srv) srv.value = st.server && st.server !== DEFAULT_SERVER ? st.server : '';
  if (st.error) { UI.errors.t3Connection = st.error; syncRow('t3Connection'); }
}

// ---------- page ----------
function scopeHtml() {
  if (!scopedPage(UI.page)) return '';
  const ps = prefsState();
  const proj = projectOpen() ? `<option value="project"${scope() === 'project' ? ' selected' : ''}${ps.gfxJson ? '' : ' disabled'}>${esc(S.projectName)}${ps.gfxJson ? '' : ' (no gfx.json)'}</option>` : '';
  return `<p class="sp-scope">Applying to <select class="sp-scope-sel" aria-label="Settings scope"><option value="machine"${scope() === 'machine' ? ' selected' : ''}>All projects (this computer)</option>${proj}</select>
    <span class="sp-scope-hint">${scope() === 'project' ? 'Saved in this project\'s gfx.json, so it travels with the project.' : projectOpen() && !ps.gfxJson ? 'This project has no gfx.json, so it can\'t have its own settings.' : 'Saved on this computer; projects can override it.'}</span></p>`;
}
function renderPage() {
  if (UI.chain) closeMenu();
  const main = el.querySelector('.sp-page');
  const rows = ROWS.filter((r) => r.page === UI.page);
  const sections = [...new Set(rows.map((r) => r.section))];
  main.innerHTML = scopeHtml() + sections.map((s) => `<section class="sp-sec"><h2>${esc(s)}</h2><div class="sp-card">${rows.filter((r) => r.section === s).map(rowHtml).join('')}</div></section>`).join('');
  el.querySelector('.sp-crumb b').textContent = pageLabel(UI.page);
  for (const b of el.querySelectorAll('.sp-cats button')) { b.classList.toggle('on', b.dataset.page === UI.page); b.setAttribute('aria-current', b.dataset.page === UI.page ? 'page' : 'false'); }
  for (const r of rows) syncRow(r.id);
  if (UI.page === 't3') syncT3();
}
function showPage(id) {
  if (!PAGES.some((p) => p.id === id)) id = 'general';
  if (UI.chain) closeMenu();
  UI.page = id; UI.chain = null;
  if (id === 'engine') refreshWslEngines();
  renderPage();
  // once per visit, not per render: a failing doctor re-renders the page, and running it from renderPage looped
  // (with no working engine the Engine page re-rendered nonstop and its buttons could not be clicked)
  if ((id === 'engine' || id === 'about') && !TS.doctor && !TS.running) runDoctor();
  el.querySelector('.sp-main').scrollTop = 0;
}

// ---------- search (T3: Ctrl+F or /, arrow keys, Enter jumps and pulses the row) ----------
const hay = (r) => `${r.title} ${r.desc || ''} ${r.kw || ''} ${pageLabel(r.page)} ${r.section}`.toLowerCase();
export function searchRows(q) {
  const words = String(q).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const hits = ROWS.filter((r) => words.every((w) => hay(r).includes(w)));
  const score = (r) => (r.title.toLowerCase().startsWith(words[0]) ? 0 : r.title.toLowerCase().includes(words[0]) ? 1 : 2);
  return hits.sort((a, b) => score(a) - score(b));
}
function renderSearch() {
  const hits = searchRows(UI.q), searching = !!UI.q.trim();
  el.querySelector('.sp-cats').hidden = searching;
  const res = el.querySelector('.sp-results');
  res.hidden = !searching;
  el.querySelector('.sp-q-clear').hidden = !searching;
  el.querySelector('.sp-q-kbd').hidden = searching;
  UI.hit = Math.min(UI.hit, Math.max(0, hits.length - 1));
  res.innerHTML = searching ? (hits.length ? hits.map((r, i) => `<button type="button" role="option" id="sp-hit-${r.id}" data-hit="${r.id}" aria-selected="${i === UI.hit}" class="${i === UI.hit ? 'on' : ''}"><b>${esc(r.title)}</b><small>${esc(pageLabel(r.page))} · ${esc(r.section)}</small></button>`).join('') : '<p class="sp-none" role="status">No settings found</p>') : '';
  el.querySelector('.sp-q').setAttribute('aria-activedescendant', hits[UI.hit] ? `sp-hit-${hits[UI.hit].id}` : '');
  res.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
/** Show a row: switch to its page, scroll it to the middle, focus it and pulse it. */
export function jumpTo(id, { pulse = true } = {}) {
  const row = rowById(id);
  if (!row) return false;
  if (UI.page !== row.page) showPage(row.page);
  const r = el.querySelector(`[data-row="${id}"]`);
  if (!r) return false;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  r.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  r.focus({ preventScroll: true });
  r.classList.remove('sp-pulse');
  if (pulse && !reduce) { void r.offsetWidth; r.classList.add('sp-pulse'); r.addEventListener('blur', () => r.classList.remove('sp-pulse'), { once: true }); }
  return true;
}
function pickHit(id) { UI.q = ''; el.querySelector('.sp-q').value = ''; UI.hit = 0; renderSearch(); jumpTo(id); }
export function focusSearch() { const q = el?.querySelector('.sp-q'); if (q) { q.focus(); q.select(); } }

// ---------- writes (instant apply, inline errors) ----------
async function apply(id, key, value) {
  try {
    const sc = isProjectKey(key) && scope() === 'project' ? 'project' : 'machine';
    await setPref(key, value, sc);
    delete UI.errors[id];
  } catch (e) { UI.errors[id] = String(e.message || e).replace(/^\w+: /, ''); }
  syncRow(id);
}
const parseVal = (key, raw) => {
  const t = SCHEMA[key].type;
  if (t === 'int' || t === 'zoom') return Number(raw);
  return raw;
};

async function onChange(e) {
  const t = e.target;
  if (t.dataset.a === 'windows-path') {
    t.disabled = true;
    try { windowsPath = await api.setWindowsPath(t.checked); wslError = ''; } catch (err) { wslError = String(err.message || err); }
    await refreshWslEngines(); return;
  }
  if (t.classList.contains('sp-scope-sel')) { if (UI.chain) closeMenu(); UI.scope = t.value; UI.chain = null; renderPage(); return; }
  const k = t.dataset.k, rowEl = t.closest('[data-row]');
  if ((k === 'workflow' || t.dataset.wf) && rowEl) { // First take: a profile, or one field of Custom
    const cur = workflowFields(shownValue('workflow'));
    const { profile: _p, ...fields } = cur;
    let v;
    if (t.dataset.wf) v = { ...fields, [t.dataset.wf]: t.dataset.wf === 'render' ? t.value === 'true' : t.value };
    else v = t.value === 'custom' ? fields : t.value;
    await apply('workflow', 'workflow', v);
    syncControl('workflow');
    return;
  }
  if (k && rowEl) {
    const id = rowEl.dataset.row;
    const v = t.type === 'checkbox' ? t.checked : parseVal(k, t.value);
    await apply(id, k, v);
    if (k === 'editor') { rowEl.querySelector('.sp-ctl').innerHTML = controlHtml(rowById('editor')); syncRow('editor'); }
    return;
  }
  if (t.dataset.a === 't3-autocreate') {
    try { await api.t3SetOptions({ autoCreate: t.checked }); await t3.refreshStatus(); delete UI.errors.t3AutoCreate; } catch (err) { UI.errors.t3AutoCreate = String(err.message || err); }
    syncRow('t3AutoCreate'); syncT3();
  } else if (t.dataset.a === 't3-server') saveServer(t);
}
async function saveServer(input) {
  const want = input.value.trim(), st = t3.t3Status();
  if ((want || DEFAULT_SERVER) === (st?.server || DEFAULT_SERVER)) { delete UI.errors.t3Server; syncRow('t3Server'); return true; }
  try { await api.t3SetOptions({ server: want }); await t3.refreshStatus(); delete UI.errors.t3Server; syncRow('t3Server'); syncT3(); return true; }
  catch (e) { UI.errors.t3Server = String(e.message || e); syncRow('t3Server'); return false; }
}

/** WSL engine actions (Settings → Engine & tools → Engines; docs/INSTALL.md §3a). */
async function wslAction(a, distro) {
  if (a === 'wsl-remove') {
    if (!(await api.ask(`Remove the gfx engine from WSL ${distro}? Your projects and sound library will be kept.`))) return;
    try { await api.wslEngineRemove(distro); wslError = ''; } catch (err) { wslError = String(err.message || err); }
    await refreshWslEngines();
  } else await showWslSetup({ distro: a === 'wsl-install' ? undefined : distro, action: a === 'wsl-update' ? 'Update' : 'Repair', onChange: refreshWslEngines, onClose: refreshWslEngines });
}
async function onClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (b.dataset.page) { UI.q = ''; el.querySelector('.sp-q').value = ''; renderSearch(); showPage(b.dataset.page); return; }
  if (b.dataset.hit) { pickHit(b.dataset.hit); return; }
  const a = b.dataset.a, rowEl = b.closest('[data-row]'), id = rowEl?.dataset.row, row = rowById(id);
  if (a === 'wsl-more') { // the row's ⋯: the less frequent engine actions
    const d = b.dataset.distro, run = (act) => () => wslAction(act, d);
    openMenu(b, [
      { id: 'wsl-repair', label: 'Repair', disabled: !wslBundle?.exists, run: run('wsl-repair') },
      { id: 'wsl-checks', label: 'Checks', run: run('wsl-checks') },
      { sep: true },
      { id: 'wsl-remove', label: 'Remove…', run: run('wsl-remove') },
    ]);
    return;
  }
  if (a?.startsWith('wsl-')) { await wslAction(a, b.dataset.distro); return; }
  if (a === 'back') closeSettings();
  else if (a === 'clear-q') { UI.q = ''; el.querySelector('.sp-q').value = ''; renderSearch(); el.querySelector('.sp-q').focus(); }
  else if (a === 'chain') showChain(b, row);
  else if (a === 'reset') {
    try { await resetPref(row.key, isProjectKey(row.key) && scope() === 'project' ? 'project' : 'machine'); delete UI.errors[id]; } catch (err) { UI.errors[id] = String(err.message || err); }
    syncControl(id);
    if (row.key === 'engineDir') runDoctor({ again: true }); // back to auto: check the engine that is used now
  } else if (a === 'browse') {
    const p = await api.pickFolder(row?.title || 'Select folder').catch(() => null);
    if (p) { await apply(id, b.dataset.k, p); syncControl(id); }
  } else if (a === 'reset-layout') resetLayouts(el.querySelector('[data-a=layout-mode]').value);
  else if (a === 'connect' || a === 'change') {
    const srv = el.querySelector('[data-a=t3-server]');
    if (srv && !(await saveServer(srv))) return;
    closeSettings(); // the connect steps (and the native T3 view) live in the T3 panel
    t3.connect({ change: a === 'change' });
  } else if (a === 'disconnect') {
    try {
      const left = await t3.disconnect(); // gfx can't revoke its grant in T3: say where to remove it
      delete UI.errors.t3Connection;
      emit('toast', left ? { m: `Disconnected from T3. ${left}`, ms: 9000 } : { m: 'Disconnected from T3', ms: 2000 });
    } catch (err) { UI.errors.t3Connection = String(err.message || err); }
    syncRow('t3Connection'); syncT3();
  } else if (a === 'cancel-connect') { await t3.cancelConnect(); syncT3(); }
  else if (a === 'setup') runSetup(b.dataset.what);
  else if (a === 'recheck') runDoctor();
  else if (a === 'engine-choose' || a === 'engine-use') {
    const save = async (p) => { await setPref('engineDir', p, 'machine'); };
    try {
      if (a === 'engine-use') { await save(b.dataset.path); runDoctor({ again: true }); } else await chooseEngine(save);
      delete UI.errors.engineDir;
    } catch (err) { UI.errors.engineDir = String(err.message || err).replace(/^\w+: /, ''); }
    syncControl('engineDir');
  }
  else if (a === 'doctor') runReport();
  else if (a === 'licence') showLicence(b.dataset.file);
  else if (a === 'credit-link') openCreditLink(b.dataset.url);
  else if (a === 'app-folder') {
    try { const d = await api.openAppFolder(); if (!api.isTauri) emit('toast', { m: d, ms: 4000 }); } catch (err) { UI.errors.appFolder = String(err.message || err); syncRow('appFolder'); }
  }
}
function resetLayouts(which) {
  const modes = which === 'all' ? ['review', 'code'] : [which];
  for (const m of modes) {
    if (m === layout.currentMode()) UI.layoutsReset.add(m); // applied when the page closes (the dock is hidden now)
    else localStorage.removeItem(`gfx.layout.v1.${m}`);
  }
  emit('toast', { m: which === 'all' ? 'All panel layouts reset' : `${which[0].toUpperCase() + which.slice(1)} layout reset`, ms: 1800 });
}

function onKeyDown(e) {
  const t = e.target;
  if (t.classList?.contains('sp-q')) {
    const hits = searchRows(UI.q);
    if (e.key === 'ArrowDown' && hits.length) { e.preventDefault(); UI.hit = (UI.hit + 1) % hits.length; renderSearch(); }
    else if (e.key === 'ArrowUp' && hits.length) { e.preventDefault(); UI.hit = (UI.hit - 1 + hits.length) % hits.length; renderSearch(); }
    else if (e.key === 'Enter' && hits[UI.hit]) { e.preventDefault(); pickHit(hits[UI.hit].id); }
    return;
  }
  if (e.key === 'Enter' && t.matches?.('input[type=text][data-k], input[data-a=t3-server]')) { e.preventDefault(); t.blur(); }
}
function onInput(e) {
  const t = e.target;
  if (t.classList.contains('sp-q')) { UI.q = t.value; UI.hit = 0; renderSearch(); }
  else if (t.classList.contains('sp-kq')) el.querySelector('.sp-keys').innerHTML = shortcutsHtml(t.value);
}

/** Esc in the page: clears the search, else leaves a field, else returns to the workspace. */
export function settingsEscape(e) {
  const t = e?.target;
  if (t?.classList?.contains('sp-q') && UI.q) { UI.q = ''; t.value = ''; UI.hit = 0; renderSearch(); return; }
  if (t && el?.contains(t) && t.matches?.('input[type=text], input[type=search], select, textarea')) { t.blur(); return; } // a field being edited: Esc only leaves it
  closeSettings();
}

// ---------- open / close ----------
function build() {
  el = document.createElement('div');
  el.id = 'settings-page'; el.dataset.density = 'comfortable';
  el.hidden = true;
  el.setAttribute('role', 'region');
  el.setAttribute('aria-label', 'Settings');
  el.innerHTML = `<header class="sp-head"><button type="button" class="tbtn sp-back" data-a="back" title="Back to the workspace (Esc)">&larr; Back</button>
      <nav class="sp-crumb" aria-label="Breadcrumb"><span>Settings</span><i>/</i><b></b></nav><span class="spacer"></span><kbd>Esc</kbd></header>
    <div class="sp-body">
      <aside class="sp-nav">
        <div class="sp-search"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input type="search" class="sp-q" placeholder="Search" aria-label="Search settings" role="combobox" aria-autocomplete="list" aria-controls="sp-results" spellcheck="false" autocomplete="off">
          <kbd class="sp-q-kbd">/</kbd><button type="button" class="sp-q-clear" data-a="clear-q" hidden title="Clear the search" aria-label="Clear settings search">&times;</button></div>
        <div class="sp-cats" role="navigation">${PAGES.map((p) => `<button type="button" data-page="${p.id}">${esc(p.label)}</button>`).join('')}</div>
        <div class="sp-results" id="sp-results" role="listbox" aria-label="Settings search results" hidden></div>
      </aside>
      <main class="sp-main" data-settings-page-scroll><div class="sp-page"></div></main>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKeyDown);
  el.addEventListener('focusout', (e) => { if (e.target.dataset?.a === 't3-server' && UI.open) saveServer(e.target); });
}

/** Open the page (optionally a page id or a row id), remembering what had focus. */
export async function openSettings(target) {
  if (!el) build();
  const wasOpen = UI.open;
  if (libraryOpen()) { await closeLibrary(); if (libraryOpen()) return; } // flush Library edits before replacing the page
  if (!wasOpen) {
    UI.returnFocus = document.activeElement;
    UI.scope = projectOpen() && prefsState().gfxJson ? 'project' : 'machine'; // defaults to the current project
    UI.errors = {}; UI.chain = null; UI.q = '';
    el.querySelector('.sp-q').value = '';
  }
  UI.open = true;
  el.hidden = false;
  document.body.classList.add('settings-on');
  unsubs.forEach((u) => u()); unsubs = [];
  unsubs.push(on('t3-status', syncT3), on('prefs', ({ keys } = {}) => { for (const k of keys || []) { const r = ROWS.find((x) => x.key === k || (k === 'editorCommand' && x.id === 'editor')); if (r) syncControl(r.id); } }),
    onTools((what) => { if (!UI.open) return; if (['engine', 'about'].includes(UI.page)) { if (what === 'progress') refreshTools(); else renderPage(); } }), on('root', () => { if (UI.open) renderPage(); }));
  t3.refreshStatus().then(syncT3).catch(() => {});
  if (!wasOpen) reloadProject().catch(() => {}); // gfx.json may have changed (Code mode, git, Claude): the rows follow via 'prefs'
  const row = rowById(target);
  if (row) { showPage(row.page); requestAnimationFrame(() => jumpTo(row.id, { pulse: true })); }
  else showPage(PAGES.some((p) => p.id === target) ? target : wasOpen ? UI.page : UI.page || 'general');
  renderSearch();
  if (!row) el.querySelector('.sp-cats button.on')?.focus({ preventScroll: true });
}
function refreshTools() {
  for (const id of ['ffmpeg', 'browser']) { const r = el.querySelector(`[data-row=${id}] .sp-ctl`); if (r) r.innerHTML = customHtml(rowById(id)); }
}
export function closeSettings() {
  if (!UI.open) return;
  if (UI.chain) closeMenu();
  UI.open = false;
  el.hidden = true;
  document.body.classList.remove('settings-on');
  unsubs.forEach((u) => u()); unsubs = [];
  if (UI.layoutsReset.size) { UI.layoutsReset.clear(); layout.resetLayout(); }
  const f = UI.returnFocus;
  UI.returnFocus = null;
  if (f && f.isConnected && f !== document.body && !f.closest?.('#topbar')) f.focus?.({ preventScroll: true });
}
export const toggleSettings = () => (UI.open ? closeSettings() : openSettings());

export function initSettings() {
  on('open-settings', (target) => openSettings(target));
}
export { esc };
