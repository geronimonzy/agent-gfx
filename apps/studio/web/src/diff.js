import { roundSurfaceOrigin } from './surface-origin.js';
// Diff dialog (docs/CODE-VERSIONS.md §3 "Compare", §4 "Diff"): file list on the left, a side-by-side CodeMirror merge view of the
// chosen file on the right. showDiff({ title, sub?, leftLabel, rightLabel, files: [{ path, status?, a, b, binary? }], actions? }).
import { esc } from './store.js';

import { $ } from './dom.js';
let dlg = null, mv = null, cur = null;

function build() {
  dlg = document.createElement('div');
  dlg.id = 'diff-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal diff" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="df-title">
    <div class="modal-head"><b id="df-title">Diff</b><span class="df-sub"></span><span class="spacer"></span><span class="df-acts"></span><button type="button" class="link df-x" title="Close (Esc)">&times;</button></div>
    <div class="df-body"><div class="df-files"></div><div class="df-main"><div class="df-labels"><span class="df-l"></span><span class="df-r"></span></div><div class="df-view"></div></div></div>
  </div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.df-x').onclick = closeDiff;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeDiff(); });
}
export const diffOpen = () => !!dlg && !dlg.hidden;
export function closeDiff() { if (!dlg) return; dlg.hidden = true; mv?.destroy(); mv = null; cur = null; }

const ST = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', A: 'A', M: 'M', D: 'D', R: 'R', '??': 'A' };
export async function showDiff(o) {
  if (!dlg) build();
  cur = o;
  dlg.querySelector('#df-title').textContent = o.title || 'Diff';
  dlg.querySelector('.df-sub').textContent = o.sub || '';
  dlg.querySelector('.df-l').textContent = o.leftLabel || 'before';
  dlg.querySelector('.df-r').textContent = o.rightLabel || 'after';
  const acts = dlg.querySelector('.df-acts');
  acts.innerHTML = (o.actions || []).map((a, i) => `<button type="button" class="tbtn sm" data-i="${i}" title="${esc(a.title || '')}">${esc(a.label)}</button>`).join('');
  for (const b of acts.querySelectorAll('button')) b.onclick = () => o.actions[+b.dataset.i].run(cur?.sel);
  const list = dlg.querySelector('.df-files');
  list.innerHTML = o.files.length
    ? o.files.map((f, i) => `<button type="button" class="df-file" data-i="${i}" title="${esc(f.path)}"><i class="st st-${esc(ST[f.status] || 'M')}">${esc(ST[f.status] || 'M')}</i><span>${esc(f.path)}</span></button>`).join('')
    : '<div class="empty-list">No differences.</div>';
  for (const b of list.querySelectorAll('.df-file')) b.onclick = () => pick(+b.dataset.i);
  dlg.hidden = false;
  roundSurfaceOrigin(dlg);
  if (o.files.length) await pick(Math.max(0, o.files.findIndex((f) => f.path === o.select)));
  else { mv?.destroy(); mv = null; dlg.querySelector('.df-view').innerHTML = ''; }
}

async function pick(i) {
  const f = cur?.files[i];
  if (!f) return;
  cur.sel = f;
  for (const b of dlg.querySelectorAll('.df-file')) b.classList.toggle('on', +b.dataset.i === i);
  const host = dlg.querySelector('.df-view');
  mv?.destroy(); mv = null; host.innerHTML = '';
  if (f.binary) { host.innerHTML = `<div class="empty-list">${f.tooLarge ? 'File larger than 1 MB' : 'Binary file'}: no text diff.</div>`; return; }
  const cm = await import('./cm.js');
  if (cur?.sel !== f) return;
  mv = cm.mergeView(host, f.a ?? '', f.b ?? '', f.path);
}
