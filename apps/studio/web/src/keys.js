// One keyboard registry + one dispatcher for the whole studio (docs/KEYS.md). The table itself is keymap.js.
//   register({ id, keys: ['Ctrl+Z'], context, label, group, when?, run, typing?, scene?, inDialog?, inTerminal?, hidden?, doc? })
// Contexts are tried in priority order (CONTEXTS): dialog, then tool contexts, then global. The first matching entry whose
// `when` holds runs and consumes the key (run() returning false = not handled, keep looking). Keys never fire while typing in
// an input / textarea / select / contenteditable, inside xterm, or behind an open dialog, unless the entry opts in
// (typing / inTerminal / inDialog). Modifiers match exactly (Shift+L is not L); Shift is ignored for symbol keys (?, [, `).
import { S } from './store.js';
import { activeEl } from './dom.js';

export const CONTEXTS = ['dialog', 'versions', 'draw', 'code', 'comment', 'live', 'viewer', 'timeline', 'terminal', 'global'];
export const CONTEXT_LABEL = {
  dialog: 'Dialog open', versions: 'Version row focused', draw: 'Drawing on a comment', code: 'Code mode', comment: 'Comment popover / tool', live: 'Live view on',
  timeline: 'Timeline / cues', viewer: 'Viewer', terminal: 'Terminal focused', global: 'Everywhere',
};
export const GROUPS = ['Playback', 'Timeline', 'Viewer tools', 'Live / Select', 'Comments & Draw', 'Layers & Paths', 'Render', 'Terminal & Claude', 'Code & Versions', 'Layout', 'Settings', 'Edit / File'];

const entries = [];
const dialogProbes = [];
const ctxActive = { dialog: () => dialogOpen(), timeline: () => !!S.meta, viewer: () => !!S.meta, terminal: () => !!activeEl()?.closest?.('.xterm'), global: () => true };
let seq = 0, installed = false;

/** A context's "is it active now" predicate (modules call this for the contexts they own: draw, comment, live, code). */
export const defineContext = (id, fn) => { ctxActive[id] = fn; };
/** Register extra "a dialog is open" probes (home screen, ...). `.modal-back` and #att-preview are always probed. */
export const addDialogProbe = (fn) => { dialogProbes.push(fn); };
export function dialogOpen() {
  return !!document.querySelector('.modal-back:not([hidden]), #att-preview:not([hidden])') || dialogProbes.some((f) => f());
}
export const isContextActive = (id) => { try { return !!ctxActive[id]?.(); } catch { return false; } };
export const activeContexts = () => CONTEXTS.filter(isContextActive);

export function isTyping(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return (tag === 'input' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)) || tag === 'textarea' || tag === 'select' || !!el.isContentEditable;
}

// ---------- key specs ----------
const ALIAS = { esc: 'escape', del: 'delete', left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', return: 'enter' };
export function parse(spec) {
  const parts = spec.split('+'), key = parts.pop();
  const m = { ctrl: false, alt: false, shift: false };
  for (const p of parts) { const l = p.toLowerCase(); if (l === 'ctrl' || l === 'cmd' || l === 'mod') m.ctrl = true; else if (l === 'alt') m.alt = true; else if (l === 'shift') m.shift = true; }
  return { ...m, key: ALIAS[key.toLowerCase()] || key.toLowerCase(), spec };
}
const isSymbol = (k) => k.length === 1 && !/[a-z]/.test(k);
// Ctrl + the =/-/0 keys by physical position (like browser zoom): Ctrl+Shift+= ('+'), the numpad and non-US layouts match too
const ZOOM_CODES = { Equal: '=', NumpadAdd: '=', Minus: '-', NumpadSubtract: '-', Digit0: '0', Numpad0: '0' };
const evKey = (e) => (e.code === 'Backquote' ? '`' : (e.ctrlKey || e.metaKey) && ZOOM_CODES[e.code] ? ZOOM_CODES[e.code] : e.key === ' ' ? 'space' : String(e.key).toLowerCase());
function match(p, e, k) {
  if (p.key !== k || p.ctrl !== (e.ctrlKey || e.metaKey) || p.alt !== e.altKey) return false;
  return isSymbol(k) || p.shift === e.shiftKey;
}
const combo = (p) => `${p.ctrl ? 'ctrl+' : ''}${p.alt ? 'alt+' : ''}${!isSymbol(p.key) && p.shift ? 'shift+' : ''}${p.key}`;

const PRETTY = { arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', escape: 'Esc', delete: 'Del', space: 'Space', enter: 'Enter', backspace: 'Backspace', pageup: 'PgUp', pagedown: 'PgDn' };
/** Display label for one key spec: Windows first, so Ctrl (never the Mac symbol). */
export function prettyKey(spec) {
  const p = parse(spec);
  const k = PRETTY[p.key] || (p.key.length === 1 ? p.key.toUpperCase() : p.key[0].toUpperCase() + p.key.slice(1));
  return [p.ctrl && 'Ctrl', p.alt && 'Alt', p.shift && 'Shift', k].filter(Boolean).join('+');
}

// ---------- registry ----------
export function register(list) {
  for (const d of Array.isArray(list) ? list : [list]) {
    if (!d.id || !d.label || !d.group) throw new Error(`key entry needs id, label, group: ${JSON.stringify(d.id)}`);
    if (!CONTEXTS.includes(d.context || 'global')) throw new Error(`key entry ${d.id}: unknown context ${d.context}`);
    if (entries.some((x) => x.id === d.id)) throw new Error(`duplicate key entry id: ${d.id}`);
    const e = { context: 'global', scene: true, ...d, keys: d.keys || [], seq: seq++ };
    e.parsed = e.doc ? [] : e.keys.map(parse);
    entries.push(e);
  }
  entries.sort((a, b) => CONTEXTS.indexOf(a.context) - CONTEXTS.indexOf(b.context) || a.seq - b.seq);
}
export const allEntries = () => entries.slice();
export const entryById = (id) => entries.find((e) => e.id === id) || null;
/** Display labels of an entry's keys ("Ctrl+Z", "Del"), for help and tooltips. */
export const keysOf = (id) => (entryById(id)?.keys || []).map(prettyKey);

/** Same key in the same context without distinct `when` guards, or a guard-less entry in a higher context hiding a lower one. */
export function checkConflicts() {
  const out = [], by = new Map();
  for (const e of entries) {
    if (e.doc) continue;
    for (const p of e.parsed) {
      const c = combo(p), prev = by.get(c) || [];
      for (const o of prev) {
        if (o === e) out.push({ key: c, ids: [e.id], why: 'key listed twice in one entry' });
        else if (o.context === e.context && !(o.when && e.when)) out.push({ key: c, ids: [o.id, e.id], why: `same context (${e.context}) without distinct when() guards` });
        else if (o.context !== e.context && !o.when && o.context !== 'dialog') out.push({ key: c, ids: [o.id, e.id], why: `${o.id} (${o.context}) has no when() and always shadows ${e.id} (${e.context})` });
      }
      prev.push(e); by.set(c, prev);
    }
  }
  return out;
}

// ---------- dispatch ----------
function candidates(e, k, mode, typing) {
  const act = activeContexts(), out = [];
  for (const d of entries) {
    if (d.doc || !d.run) continue;
    if (mode === 'terminal') { if (d.context !== 'terminal') continue; }
    else if (d.context === 'terminal') continue;
    else if (mode === 'xterm') { if (!d.inTerminal) continue; }
    else if (mode === 'dialog') { if (d.context !== 'dialog' && !d.inDialog) continue; }
    else if (!act.includes(d.context)) continue;
    if (typing && !d.typing) continue;
    if (d.scene && !S.meta) continue;
    if (!d.parsed.some((p) => match(p, e, k))) continue;
    out.push(d);
  }
  return out;
}
function runFirst(list, e, arg) {
  for (const d of list) {
    let ok = true;
    try { ok = !d.when || d.when(e, arg); } catch (err) { console.error('key when()', d.id, err); ok = false; }
    if (!ok) continue;
    let r;
    try { r = d.run(e, arg); } catch (err) { console.error('key run()', d.id, err); r = true; }
    if (r === false) continue;
    e.preventDefault(); e.stopImmediatePropagation();
    return d;
  }
  return null;
}

function onKeyDown(e) {
  if (e.isComposing || ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) return;
  const t = e.target, k = evKey(e);
  if ((k === 'space' || k === 'enter') && t.closest?.('[role=switch]')) return; // the switch's own onkeydown flips it
  const mode = t.closest?.('.xterm') ? 'xterm' : dialogOpen() ? 'dialog' : 'normal';
  runFirst(candidates(e, k, mode, isTyping(t)), e);
}
/** xterm's customKeyEventHandler: run 'terminal' context entries. Returns false when handled (xterm then ignores the key). */
export function dispatchTerminal(e, term) {
  return runFirst(candidates(e, evKey(e), 'terminal', false), e, term) ? false : true;
}

/** Also dispatch keys typed in another document (a popout window, docs/LAYOUT.md §5). */
export function installKeysOn(doc) {
  if (!doc || doc === document || doc.__gfxKeys) return;
  doc.__gfxKeys = true;
  doc.addEventListener('keydown', onKeyDown, true);
}

export function installKeys() {
  if (installed) return;
  installed = true;
  document.addEventListener('keydown', onKeyDown, true);
  const bad = checkConflicts();
  window.__keyConflicts = bad;
  if (bad.length && import.meta.env?.DEV) console.warn('[keys] conflicting shortcuts:', bad.map((b) => `${b.key}: ${b.ids.join(' vs ')} (${b.why})`));
}
