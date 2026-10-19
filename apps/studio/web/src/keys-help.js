import { roundSurfaceOrigin } from './surface-origin.js';
// Shortcut help overlay (? or the top bar button): generated from the key registry (keys.js), searchable, grouped by area,
// with the rows of the currently active contexts highlighted. Windows-first labels (Ctrl).
import { esc } from './store.js';
import { allEntries, GROUPS, CONTEXT_LABEL, activeContexts, prettyKey } from './keys.js';

import { $ } from './dom.js';
let dlg = null;

export const helpOpen = () => !!dlg && !dlg.hidden;
export function closeHelp() { if (dlg) dlg.hidden = true; document.activeElement?.blur?.(); }
export function toggleHelp() { if (helpOpen()) closeHelp(); else openHelp(); }

const tokens = (k) => k.split('+').length;
/** Primary key plus aliases while they fit the key column (<= 4 tokens in all). */
function rowKeys(e) {
  const shown = [];
  for (const k of e.keys) { if (shown.length && shown.reduce((n, x) => n + tokens(x), 0) + tokens(k) > 4) break; shown.push(k); }
  return shown.map((k) => (e.doc ? `<kbd class="wide">${esc(k)}</kbd>` : prettyKey(k).split('+').map((p) => `<kbd>${esc(p)}</kbd>`).join('<b>+</b>'))).join('<i>or</i>');
}

/** The shortcut list (the `?` sheet and Settings → Shortcuts): HTML of the groups matching `q`; `act` = contexts to mark. */
export function shortcutsHtml(q, act = new Set()) {
  q = String(q || '').trim().toLowerCase();
  const list = allEntries().filter((e) => !e.hidden);
  const hay = (e) => `${e.label} ${e.group} ${CONTEXT_LABEL[e.context]} ${e.keys.map((k) => (e.doc ? k : prettyKey(k))).join(' ')} ${e.keys.join(' ')}`.toLowerCase();
  const hits = q ? list.filter((e) => q.split(/\s+/).every((w) => hay(e).includes(w))) : list;
  const out = [];
  for (const g of GROUPS) {
    const rows = hits.filter((e) => e.group === g);
    if (!rows.length) continue;
    out.push(`<section class="kh-g"><h4>${esc(g)}</h4>${rows.map((e) => `<div class="kh-r${act.has(e.context) ? ' now' : ''}${e.doc ? ' doc' : ''}" data-id="${esc(e.id)}"><span class="kh-k">${rowKeys(e)}</span><span class="kh-l">${esc(e.label)}</span>${!['global', 'viewer', 'timeline'].includes(e.context) ? `<span class="kh-ctx${act.has(e.context) ? ' on' : ''}">${esc(CONTEXT_LABEL[e.context])}</span>` : ''}</div>`).join('')}</section>`);
  }
  return out.join('') || '<div class="kh-none">No shortcut matches.</div>';
}

function render() {
  const act = new Set(activeContexts().filter((c) => !['global', 'dialog', 'viewer', 'timeline'].includes(c)));
  dlg.querySelector('.kh-now').innerHTML = act.size
    ? `Now: ${[...act].map((c) => `<span class="kh-ctx on">${esc(CONTEXT_LABEL[c])}</span>`).join('')}`
    : 'Now: viewer + timeline (no tool mode active)';
  dlg.querySelector('.kh-body').innerHTML = shortcutsHtml(dlg.querySelector('.kh-q').value, act);
}

function build() {
  dlg = document.createElement('div');
  dlg.id = 'help-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal kh" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="kh-title">
    <div class="modal-head"><b id="kh-title">Keyboard shortcuts</b><span class="kh-now"></span><span class="spacer"></span><button type="button" class="link kh-x" title="Close (Esc)">&times;</button></div>
    <input class="kh-q" type="text" placeholder="Search: key, action, area (e.g. loop, ctrl, live)" spellcheck="false" autocomplete="off">
    <div class="kh-body"></div>
    <div class="kh-foot">Keys are ignored while typing in a field or a terminal. Esc closes. Full table and rules: docs/KEYS.md</div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.kh-x').onclick = closeHelp;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeHelp(); });
  dlg.querySelector('.kh-q').addEventListener('input', render);
}
function openHelp() {
  if (!dlg) build();
  dlg.querySelector('.kh-q').value = '';
  render();
  dlg.hidden = false;
  roundSurfaceOrigin(dlg);
  dlg.querySelector('.kh-q').focus();
}
export function initHelp() {
  const b = $('help-btn');
  if (b) b.onclick = (e) => { e.currentTarget.blur(); toggleHelp(); };
}
