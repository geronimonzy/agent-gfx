import { tok } from './theme.js';
// Terminal panel (docs/CLAUDE-IN-APP.md §3, docs/LAYOUT.md §2): a dock panel (tabbed with the timeline by default), each an xterm.js view of a PTY in the project folder
// (Rust portable-pty in the app, python pty in the dev shim). The Claude button runs the configured command in a "Claude" tab;
// Ask Claude pastes briefs into it (bracketed paste via term.paste()).
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import * as api from './api.js';
import { on, emit, esc } from './store.js';
import { getSettings } from './settings.js';
import { dispatchTerminal } from './keys.js';
import { activeEl } from './dom.js';
import { showPanel, isVisible, leavePanel } from './layout.js';

import { $ } from './dom.js';
export const INSTALL_URL = 'https://docs.claude.com/en/docs/claude-code/setup';
const terminalTheme = () => ({
  background: tok('--terminal-background'),
  foreground: tok('--terminal-foreground'),
  cursor: tok('--terminal-cursor'),
  cursorAccent: tok('--terminal-cursor-accent'),
  selectionBackground: tok('--terminal-selection-background'),
  black: tok('--terminal-black'),
  red: tok('--terminal-red'),
  green: tok('--terminal-green'),
  yellow: tok('--terminal-yellow'),
  blue: tok('--terminal-blue'),
  magenta: tok('--terminal-magenta'),
  cyan: tok('--terminal-cyan'),
  white: tok('--terminal-white'),
  brightBlack: tok('--terminal-bright-black'),
  brightRed: tok('--terminal-bright-red'),
  brightGreen: tok('--terminal-bright-green'),
  brightYellow: tok('--terminal-bright-yellow'),
  brightBlue: tok('--terminal-bright-blue'),
  brightMagenta: tok('--terminal-bright-magenta'),
  brightCyan: tok('--terminal-bright-cyan'),
  brightWhite: tok('--terminal-bright-white'),
});
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;

const T = { list: [], active: null, last: null, claudeId: null, seq: 0, n: 0 };
let tabsEl = null, host = null;
window.addEventListener('theme', () => { for (const t of T.list) t.term.options.theme = terminalTheme(); });
const byId = (id) => T.list.find((t) => t.id === id) || null;
export const terminals = () => T.list;

// ---------- terminals ----------
export async function newTerminal({ name, kind = 'shell' } = {}) {
  const id = `t${Date.now().toString(36)}${(T.seq++).toString(36)}`;
  const el = document.createElement('div');
  el.className = 'term-pane'; el.hidden = true; el.dataset.id = id;
  host.appendChild(el);
  const term = new Terminal({
    theme: terminalTheme(), fontFamily: tok('--font-mono'), fontSize: parseFloat(tok('--text-xs')), lineHeight: 1.15,
    cursorBlink: true, scrollback: 5000, allowProposedApi: true, macOptionIsMeta: true,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon((_e, uri) => openUri(uri)));
  const t = { id, name: name || `Terminal ${++T.n}`, kind, term, fit, el, alive: true, opened: false, plain: '', outCount: 0, lastOut: 0, wq: '', wbusy: false, info: null };
  T.list.push(t);
  term.open(el);
  registerOutLinks(t);
  term.attachCustomKeyEventHandler((e) => keyHandler(t, e));
  term.onData((d) => write(t, d));
  term.onResize(({ cols, rows }) => { if (t.alive && t.opened) api.ptyResize(id, cols, rows).catch(() => {}); });
  show(id);
  try { fit.fit(); } catch { /* hidden */ }
  try {
    t.info = await api.ptyOpen(id, term.cols, term.rows, {}, (ev) => onPty(t, ev));
    t.opened = true;
    if (!byId(id)) { api.ptyClose(id).catch(() => {}); t.info.dispose?.(); return t; } // closed while opening
    api.ptyResize(id, term.cols, term.rows).catch(() => {});
    if (t.wq && !t.wbusy) pump(t);
  } catch (e) {
    t.alive = false;
    term.write(`\x1b[31mCould not start a terminal: ${String(e.message || e)}\x1b[0m\r\n`);
  }
  renderTabs();
  return t;
}

function onPty(t, ev) {
  if (ev.data != null && ev.data !== '') {
    t.term.write(ev.data);
    const plain = ev.data.replace(ANSI, '');
    t.plain = (t.plain + plain).slice(-20000);
    if (t.watch != null) t.watch = (t.watch + plain).slice(-4000);
    if (t.claudeStarted) {
      t.claudeOutput = (t.claudeOutput + plain).slice(-4000);
      if (/command not found|is not recognized as|CommandNotFoundException|ObjectNotFound/i.test(t.claudeOutput)) {
        t.missing = true; t.claudeStarted = false;
      } else if (t.shellPrompt && t.claudeOutput.trimEnd().endsWith(t.shellPrompt)) {
        t.claudeStarted = false; // the command returned to the captured shell prompt
      }
    }
    t.outCount++; t.lastOut = performance.now();
  }
  if ('exit' in ev) {
    if (!t.alive) return;
    t.alive = false; t.claudeStarted = false;
    t.term.write(`\r\n\x1b[90m[process exited${ev.exit != null ? ` with code ${ev.exit}` : ''}]\x1b[0m\r\n`);
    if (T.claudeId === t.id) T.claudeId = null;
    renderTabs();
  }
}

/** Keystrokes in order: one pty_write in flight, the rest coalesced. Input before pty_open returns is queued: ConPTY asks
 *  for the cursor position (DSR) right at start and waits for xterm's answer. */
function write(t, d) {
  if (!t.alive) return;
  t.wq += d;
  if (t.opened && !t.wbusy) pump(t);
}
async function pump(t) {
  t.wbusy = true;
  while (t.wq && t.alive) {
    const d = t.wq; t.wq = '';
    try { await api.ptyWrite(t.id, d); } catch { break; }
  }
  t.wbusy = false;
}

export function closeTerminal(id) {
  const t = byId(id);
  if (!t) return;
  T.list = T.list.filter((x) => x !== t);
  if (t.opened) api.ptyClose(id).catch(() => {});
  setTimeout(() => t.info?.dispose?.(), 300);
  t.term.dispose(); t.el.remove();
  if (T.claudeId === id) T.claudeId = null;
  if (T.last === id) T.last = null;
  if (T.active === id) { T.active = null; if (T.list.length) show(T.list[T.list.length - 1].id, { focus: false }); else renderTabs(); }
  else renderTabs();
}
function closeAll() { for (const t of [...T.list]) closeTerminal(t.id); T.n = 0; }

// ---------- panel ----------
/** Show a terminal tab: opens / activates the Terminal panel and focuses the terminal. */
export function show(which, { focus = true } = {}) {
  const t = byId(which);
  if (!t) return;
  T.active = which; T.last = which;
  for (const x of T.list) x.el.hidden = x.id !== which;
  showPanel('terminal');
  requestAnimationFrame(() => { fitNow(t); if (focus) t.term.focus(); });
  renderTabs();
}
/** Ctrl+`: focus the terminal (opening the panel / a first terminal); from a focused terminal, go back. */
export async function toggleDock() {
  const a = activeEl();
  if (a?.closest?.('.xterm')) { a.blur(); leavePanel('terminal'); return; }
  const t = byId(T.active) || byId(T.last) || T.list[T.list.length - 1];
  if (t) show(t.id); else await newTerminal();
}
export const terminalVisible = () => isVisible('terminal');
function fitNow(t) {
  if (!t || t.el.hidden) return;
  try { t.fit.fit(); } catch { /* not laid out */ }
}
function renderTabs() {
  $('term-empty').hidden = T.list.length > 0;
  tabsEl.innerHTML = T.list.map((t) => `<span class="dk-term${T.active === t.id ? ' on' : ''}${t.alive ? '' : ' dead'}${t.kind === 'claude' ? ' claude' : ''}" data-id="${t.id}" title="${esc(t.info?.shell || '')}${t.info?.cwd ? `\n${esc(t.info.cwd)}` : ''}"><i class="dk-dot"></i>${esc(t.name)}<button class="dk-x" data-x="${t.id}" title="Close terminal">&times;</button></span>`).join('')
    + '<button class="dk-add" title="New terminal in the project folder">+</button><span class="spacer"></span><span class="dk-hint">Ctrl+` terminal · Ctrl+Shift+C / V copy / paste</span>';
}

// ---------- Claude ----------
/** Resolve once the terminal had output after `since` and then `quietMs` of silence (or after `maxMs`). */
function waitQuiet(t, { since = 0, quietMs = 350, maxMs = 6000 } = {}) {
  const t0 = performance.now();
  return new Promise((res) => {
    const iv = setInterval(() => {
      const now = performance.now();
      if (!t.alive || now - t0 > maxMs || (t.lastOut > since && now - t.lastOut >= quietMs)) { clearInterval(iv); res(); }
    }, 50);
  });
}
const claudeCmd = async () => ((await getSettings()).claudeCommand || '').trim() || 'claude';

/** Focus the Claude terminal, or open one and type the Claude command into it. */
export async function startClaude() {
  const cur = byId(T.claudeId);
  if (cur && cur.alive) { show(cur.id); return cur; }
  const cmd = await claudeCmd();
  const t = await newTerminal({ name: 'Claude', kind: 'claude' });
  T.claudeId = t.id;
  renderTabs();
  if (!t.alive) return t;
  await waitQuiet(t, { quietMs: 300, maxMs: 5000 }); // shell prompt
  if (!t.alive || !byId(t.id)) return t;
  t.shellPrompt = t.plain.split(/[\r\n]/).at(-1).trim();
  t.claudeOutput = ''; t.claudeStarted = true; t.claudeReady = false;
  t.cmdAt = performance.now();
  watchMissing(t, cmd);
  write(t, cmd + '\r');
  return t;
}
function watchMissing(t, cmd) {
  const t0 = performance.now();
  t.watch = '';
  const iv = setInterval(() => {
    if (/command not found|is not recognized as|CommandNotFoundException|ObjectNotFound/i.test(t.watch)) {
      clearInterval(iv); t.watch = null;
      t.missing = true; t.claudeStarted = false;
      t.term.write(`\r\n\x1b[33m${cmd.split(/\s+/)[0]} was not found. Install Claude Code: ${INSTALL_URL}\x1b[0m\r\n`);
      emit('toast', { m: 'Claude Code was not found in this terminal: see the install link there', ms: 6000 });
    } else if (!t.alive || performance.now() - t0 > 12000) { clearInterval(iv); t.watch = null; }
  }, 250);
}

/** Paste text into the Claude terminal (bracketed paste); `send` also presses Enter. Starts Claude when needed. */
function requireClaude(t) {
  if (t?.missing) throw new Error(`Claude Code was not found. Install it first: ${INSTALL_URL}`);
  if (!t?.alive || !t.opened || !byId(t.id) || !t.claudeStarted) {
    throw new Error('Claude is not running in this terminal. Close the tab and use the Claude button to start it first.');
  }
}
export async function sendToClaude(text, { send = false } = {}) {
  let t = byId(T.claudeId);
  if (!t || !t.alive) t = await startClaude();
  requireClaude(t);
  if (!t.claudeReady) {
    await waitQuiet(t, { since: t.cmdAt || 0, quietMs: 1500, maxMs: 25000 }); // let Claude Code boot
    requireClaude(t);
    t.claudeReady = true;
  }
  show(t.id);
  requireClaude(t); // every paste, including reuse of an existing terminal
  t.term.paste(text);
  if (send) setTimeout(() => {
    try { requireClaude(t); write(t, '\r'); }
    catch (e) { emit('toast', { m: e.message, ms: 6000 }); }
  }, 300);
  return t;
}

// ---------- keys / links ----------
function keyHandler(t, e) {
  if (e.type !== 'keydown') return true;
  return dispatchTerminal(e, t); // Ctrl+Shift+C / V live in keymap.js (context 'terminal')
}
/** Copy the terminal selection / paste the clipboard (bound to Ctrl+Shift+C / V in keymap.js). */
export function termCopy(t = activeTerm()) {
  const s = t?.term.getSelection();
  if (s) navigator.clipboard.writeText(s).catch(() => {});
}
export function termPaste(t = activeTerm()) {
  navigator.clipboard.readText().then((x) => { if (x && t) t.term.paste(x); }).catch(() => emit('toast', { m: 'Clipboard not available', ms: 2000 }));
}
const activeTerm = () => byId(T.active);
function openUri(uri) {
  if (window.__TAURI__) api.openLink(uri).catch((e) => emit('toast', { m: String(e.message || e), ms: 4000 }));
  else window.open(uri, '_blank', 'noopener');
}
const MEDIA = /\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|m4v)$/i;
/** `out/...` media path inside a terminal token (absolute or relative, either slash) -> project-relative path. */
export function outRel(tok) {
  const s = String(tok).replace(/\\/g, '/').replace(/[.,:;)\]]+$/, '');
  const m = /(?:^|\/)(out\/[^/].*)$/.exec(s);
  return m && MEDIA.test(m[1]) && !m[1].split('/').includes('..') ? m[1] : null;
}
function registerOutLinks(t) {
  t.term.registerLinkProvider({
    provideLinks(y, cb) {
      const line = t.term.buffer.active.getLine(y - 1);
      if (!line) return cb(undefined);
      const s = line.translateToString(true), links = [];
      for (const m of s.matchAll(/[^\s'"`<>(|]+/g)) {
        const rel = outRel(m[0]);
        if (rel) links.push({ range: { start: { x: m.index + 1, y }, end: { x: m.index + m[0].length, y } }, text: m[0], activate: () => openOut(rel) });
      }
      cb(links.length ? links : undefined);
    },
  });
}
let previewUrl = null;
async function openOut(rel) {
  try {
    if (/\.(png|jpe?g|webp|gif)$/i.test(rel)) {
      const bytes = await api.readBytes(rel);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(new Blob([bytes]));
      const pv = $('att-preview');
      pv.querySelector('img').src = previewUrl; pv.hidden = false;
    } else {
      const p = await api.revealPath(rel);
      if (!window.__TAURI__) emit('toast', { m: `File: ${p}`, ms: 4000 });
    }
  } catch (e) { emit('toast', { m: `${rel}: ${e.message || e}`, ms: 4000 }); }
}

// ---------- init ----------
export function initTerminal() {
  tabsEl = $('term-tabs'); host = $('term-host');
  $('term-empty').innerHTML = '<div>No terminal open.</div><div class="te-btns"><button type="button" class="tbtn" data-a="new">New terminal</button><button type="button" class="tbtn claude-btn" data-a="claude"><i class="cl-mark"></i>Claude</button></div><div class="dk-hint">Ctrl+` opens / focuses the terminal</div>';
  $('term-empty').addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'new') newTerminal();
    else if (a === 'claude') startClaude().catch((err) => emit('toast', { m: 'Claude: ' + (err.message || err), ms: 5000 }));
  });
  renderTabs();
  tabsEl.addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]');
    if (x) { e.stopPropagation(); closeTerminal(x.dataset.x); return; }
    if (e.target.closest('.dk-add')) { newTerminal(); return; }
    const tb = e.target.closest('[data-id]');
    if (tb) show(tb.dataset.id);
  });
  tabsEl.addEventListener('auxclick', (e) => { const tb = e.target.closest('.dk-term'); if (tb && e.button === 1) closeTerminal(tb.dataset.id); });
  let raf = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fitNow(byId(T.active))); }).observe(host);
  on('root', closeAll); // terminals belong to the project they were opened in (the backend closes them too)
  api.ptyClose('*').catch(() => {}); // a webview reload leaves the previous page's terminals behind
  window.addEventListener('beforeunload', () => { for (const t of T.list) if (t.opened) api.ptyClose(t.id).catch(() => {}); });
}
