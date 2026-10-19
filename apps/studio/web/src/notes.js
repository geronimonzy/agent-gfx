import { roundSurfaceOrigin } from './surface-origin.js';
// Comment UI: popover (anchored to the pin on the picture, or the timeline pin), side panel (Comments / Changes tabs).
import { S, esc, on, emit, fps, duration, snapT, cueById, stemStyle as stemColor, isAdded, tweakSummary } from './store.js';
import { seek, transport, pause } from './transport.js';
import { ensureVisible, noteScreenPos } from './timeline.js';
import { liveComments, getComment, addComment, updateComment, deleteComment, commentNumber } from './comments.js';
import { sceneToClient, setOpenComment, getPicker, getTool, setTool } from './viewer.js';
import { startDraw, isDrawing, stopDraw } from './draw.js';
import { renderElementsTab } from './elements.js';
import { renderLayersTab } from './layers.js';
import { liveOn, selectKey } from './live.js';
import { grabFrame, addImage, removeAttachment, thumbUrl } from './shots.js';
import { t3SentAt, openCommentIds } from './ask.js';
import { mountVersions } from './versions.js';

let list, pop, txt, openId = null, tab = 'comments', resolvedOpen = false, attSig = '', shotsVer = 0;
import { $ } from './dom.js';
const tc = (t) => { const f = Math.floor(t * fps() + 1e-6); return String(Math.floor(f / fps())).padStart(2, '0') + '.' + String(f % fps()).padStart(2, '0'); };
export const STATUS_COLOR = { open: 'var(--stem-note)', resolved: 'var(--success-foreground)', wontfix: 'var(--muted-foreground)' };
const isImg = (f) => /^image\/(png|jpeg|webp)$/.test(f.type) || /\.(png|jpe?g|webp)$/i.test(f.name || '');

export function initNotes() {
  list = $('side-list'); pop = $('note-pop'); txt = $('np-text');
  for (const b of $('side').querySelectorAll('.tabs button')) b.onclick = () => { tab = b.dataset.tab; render(); };
  $('add-note').onclick = () => newNote();
  $('np-del').onclick = () => { const id = openId; closePop(false); if (id) deleteComment(id); };
  $('np-draw').onclick = () => { if (openId) startDraw(openId); };
  $('np-attach').onclick = () => $('np-file').click();
  $('np-file').onchange = async (e) => { const id = openId; for (const f of e.target.files) if (id) await addImage(id, f); e.target.value = ''; };
  $('np-status').onchange = (e) => { if (openId) updateComment(openId, { status: e.target.value }); e.target.blur(); };
  $('np-ask').onclick = () => { const c = openId && getComment(openId); if (!c) return; const id = c.id, t = c.t; closePop(); if (getComment(id)) emit('ask-claude', { source: 'comment', comment: id, t }); };
  on('t3-sent', () => { render(); syncPop(); });
  txt.addEventListener('input', () => { if (openId) updateComment(openId, { text: txt.value }); });
  document.addEventListener('pointerdown', (e) => {
    if (openId && !isDrawing() && !pop.contains(e.target) && e.target.id !== 'tl-canvas' && !e.target.closest('.pin, #att-preview, #vtools')) closePop();
  }, true);

  // attachments: paste, drop on popover or picture
  document.addEventListener('paste', (e) => {
    if (!openId) return;
    const fs = [...(e.clipboardData?.files || [])].filter(isImg);
    if (!fs.length) return;
    e.preventDefault(); const id = openId; fs.forEach((f) => addImage(id, f));
  });
  for (const el of [pop, $('video-wrap')]) {
    el.addEventListener('dragover', (e) => { if (openId && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); pop.classList.add('drop'); } });
    el.addEventListener('dragleave', () => pop.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      pop.classList.remove('drop');
      if (!openId) return;
      e.preventDefault(); const id = openId;
      [...e.dataTransfer.files].filter(isImg).forEach((f) => addImage(id, f));
    });
  }
  // large preview
  const pv = $('att-preview');
  pv.onclick = () => { pv.hidden = true; };

  on('draft', render);
  on('selection', render);
  for (const ev of ['live', 'elements', 'el-select', 'layers']) on(ev, render);
  on('scene', () => { closePop(false); render(); });
  on('layout', () => { if (openId && !pop.hidden) position(); });
  on('draw', (d) => { if (!openId) return; pop.hidden = d; if (!d) { syncPop(true); position(); } });
  on('shots', () => { shotsVer++; render(); syncPop(); });
  on('comments', () => {
    if (openId && !getComment(openId)) { closePop(false); }
    render(); syncPop();
  });
  on('note-open', (id) => {
    const c = getComment(id);
    if (!c) return;
    if (c.x != null && Math.abs(transport.time() - c.t) > 1 / fps() / 2) seek(c.t, { frame: true });
    openPop(id);
  });
  render();
}

/** N: timeline-only comment at the playhead (or on the selected cue). */
export function newNote() {
  const cue = S.sel.cue ? cueById(S.sel.cue) : null;
  return createComment({ cue: cue ? cue.id : null, t: cue ? cue.t : null });
}

/** Create a comment (pin if x,y given, in scene px) at the playhead / given t, open its popover, grab the frame. */
export async function createComment({ x = null, y = null, cue = null, t = null } = {}) {
  if (!S.meta) return null;
  if (transport.playing) pause();
  const frameT = (tt) => Math.floor(tt * fps() + 1e-6) / fps();
  const tt = t != null ? snapT(t) : frameT(transport.time());
  const id = addComment({ t: tt, x, y, cue });
  if (t == null && Math.abs(transport.time() - tt) > 1e-6) seek(tt, { frame: true });
  S.sel.note = id; S.sel.cue = cue;
  emit('selection');
  ensureVisible(tt);
  openPop(id, true);
  grabFrame(id);
  const pick = getPicker();
  if (x != null && pick) {
    try { const el = await pick(x, y, tt); if (el) updateComment(id, { el }); } catch (e) { console.warn('picker', e); }
  }
  return id;
}

function position() {
  const c = getComment(openId);
  if (!c) return;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const pin = c.x != null ? sceneToClient(c.x, c.y) : null;
  if (pin) {
    let left = pin.x + 22;
    if (left + w > innerWidth - 8) left = pin.x - 22 - w;
    pop.style.left = Math.max(8, left) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - h - 8, pin.y - 30)) + 'px';
  } else {
    const p = noteScreenPos(openId) || { x: 400, y: 400 };
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, p.x - 20)) + 'px';
    pop.style.top = Math.max(8, p.y - h - 10) + 'px';
  }
  roundSurfaceOrigin(pop);
}

export function openPop(id, fresh = false) {
  const c = getComment(id);
  if (!c) return;
  if (openId && openId !== id) closePop();
  openId = id; setOpenComment(id);
  S.sel.note = id; emit('selection');
  $('np-time').textContent = `c${commentNumber(id)} · ${tc(c.t)} · f${Math.floor(c.t * fps() + 1e-6)}`;
  txt.value = c.text || '';
  attSig = '';
  pop.hidden = false;
  syncPop(true);
  requestAnimationFrame(() => { position(); if (!isDrawing()) txt.focus(); });
}
export function closePop(keep = true) {
  if (!openId) { pop.hidden = true; return; }
  if (isDrawing()) stopDraw();
  const id = openId; openId = null; pop.hidden = true; setOpenComment(null);
  const c = getComment(id);
  if (keep && c && !c.text.trim() && !c.strokes.length && !c.attachments.some((a) => a.kind === 'image')) deleteComment(id); // empty comments are discarded
  document.activeElement?.blur?.();
}
export const popOpen = () => !!openId;
export const previewOpen = () => { const pv = document.getElementById('att-preview'); return !!pv && !pv.hidden; };
export const closePreview = () => { const pv = document.getElementById('att-preview'); if (pv) pv.hidden = true; };
export const openCommentId = () => openId;

/** Refresh the popover from the comment (status, reply, element chip, attachments); keeps a focused textarea untouched. */
function syncPop(force = false) {
  const c = openId && getComment(openId);
  if (!c) return;
  $('np-status').value = c.status;
  $('np-status').dataset.s = c.status;
  $('np-cue').textContent = [c.el ? '◎ ' + c.el : '', c.cue ? '↳ ' + c.cue : ''].filter(Boolean).join('  ');
  const rp = $('np-reply');
  rp.hidden = !c.reply; rp.innerHTML = c.reply ? `<b>Claude</b> ${esc(c.reply)}` : '';
  const sent = t3SentAt(c.id);
  $('np-sent').hidden = !sent; if (sent) $('np-sent').title = `Sent to T3 ${new Date(sent).toLocaleString()}`;
  if ((force || txt.ownerDocument.activeElement !== txt) && txt.value !== (c.text || '')) txt.value = c.text || '';
  const atts = c.attachments.filter((a) => a.kind !== 'frame' || !c.attachments.some((b) => b.kind === 'markup'));
  const sig = JSON.stringify(atts.map((a) => a.path)) + shotsVer;
  if (sig !== attSig) {
    attSig = sig;
    const box = $('np-atts');
    box.innerHTML = atts.map((a) => `<div class="att" data-p="${esc(a.path)}" title="${esc(a.name || a.kind)}"><img alt=""><span class="ak">${a.kind === 'image' ? '' : a.kind}</span>${a.kind === 'image' ? '<button class="ax" title="Remove attachment">×</button>' : ''}</div>`).join('');
    for (const el of box.querySelectorAll('.att')) {
      const p = el.dataset.p;
      thumbUrl(p).then((u) => { const im = el.querySelector('img'); if (im && u) im.src = u; });
      el.onclick = async (e) => {
        if (e.target.closest('.ax')) { removeAttachment(openId, p); return; }
        const u = await thumbUrl(p); if (u) { $('att-preview').querySelector('img').src = u; $('att-preview').hidden = false; }
      };
    }
  }
}

// ---------- side panel ----------
function row(c) {
  const th = c.attachments.find((a) => a.kind === 'markup') || c.attachments.find((a) => a.kind === 'frame');
  return `<div class="row crow${S.sel.note === c.id ? ' sel' : ''}${c.status !== 'open' ? ' done' : ''}" data-id="${c.id}">
    <span class="t">c${commentNumber(c.id)}${t3SentAt(c.id) ? ' <i class="t3-sent" title="Sent to T3">&#9992;</i>' : ''}<br>${tc(c.t)}</span>
    <span class="tx${c.text ? '' : ' empty'}"><i class="dotc" style="--c:${STATUS_COLOR[c.status] || STATUS_COLOR.open}" title="${c.status}"></i>${c.text ? esc(c.text) : '(empty)'}<small>${[c.x != null ? `@${c.x},${c.y}` : 'timeline', c.el ? '◎ ' + esc(c.el) : '', c.cue ? '↳ ' + esc(c.cue) : ''].filter(Boolean).join(' · ')}</small>${c.reply ? `<small class="rp">Claude: ${esc(c.reply)}</small>` : ''}</span>
    <span class="cth">${th ? `<img data-p="${esc(th.path)}" alt="">` : ''}<button class="x" title="Delete comment">✕</button></span></div>`;
}
/** Switch the side panel tab (comments / changes / layers / elements / versions). */
export function setSideTab(t) { tab = t; render(); }
export function render() {
  const all = liveComments();
  const open = all.filter((c) => c.status === 'open'), done = all.filter((c) => c.status !== 'open');
  $('n-notes').textContent = open.length;
  const ch = changes();
  $('n-changes').textContent = ch.length;
  if ((tab === 'elements' || tab === 'layers') && !liveOn()) tab = 'comments';
  $('tab-elements').hidden = !liveOn(); $('tab-layers').hidden = !liveOn();
  for (const b of $('side').querySelectorAll('.tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('add-note').closest('.side-foot').hidden = tab === 'versions';
  if (tab === 'versions') { if (!document.body.classList.contains('mode-code')) mountVersions(list); return; } // versions work without a scene; Code mode shows them in its left column
  if (!S.meta) { list.innerHTML = '<div class="empty-list">No scene loaded.</div>'; return; }
  if (tab === 'comments') {
    list.innerHTML = all.length
      ? (open.length ? `<div class="ask-row"><button class="tbtn" data-ask="all" title="One brief with every open comment (time, element, text, annotated image) for Claude: terminal or T3">Ask Claude about all <b>${open.length}</b> open comment${open.length === 1 ? '' : 's'}</button></div>` : '') + open.map(row).join('') + (done.length ? `<details class="resolved"${resolvedOpen ? ' open' : ''}><summary>Resolved / won't fix · ${done.length}</summary>${done.map(row).join('')}</details>` : '')
      : '<div class="empty-list">No comments yet.<br>Press <kbd>C</kbd> and click the picture to pin one, or <kbd>N</kbd> for a timeline comment at the playhead.</div>';
    for (const im of list.querySelectorAll('img[data-p]')) thumbUrl(im.dataset.p).then((u) => { if (u && im.isConnected) im.src = u; });
    const askAll = list.querySelector('[data-ask=all]');
    if (askAll) askAll.onclick = () => { if (openCommentIds().length) emit('ask-claude', { source: 'comments' }); };
    const det = list.querySelector('details.resolved');
    if (det) det.ontoggle = () => { resolvedOpen = det.open; };
    for (const r of list.querySelectorAll('.crow')) {
      const id = r.dataset.id;
      r.onclick = (e) => {
        if (e.target.closest('.x')) { deleteComment(id); return; }
        const c = getComment(id); if (!c) return;
        S.sel.note = id; S.sel.cue = null;
        if (transport.playing) pause();
        ensureVisible(c.t); seek(c.t, { frame: true }); openPop(id);
      };
    }
  } else if (tab === 'layers') {
    renderLayersTab(list);
  } else if (tab === 'elements') {
    renderElementsTab(list);
  } else {
    list.innerHTML = (ch.length ? '<div class="ask-row"><button class="tbtn" data-ask="changes" title="Brief with the pending draft changes for Claude (terminal or T3)">Ask Claude to apply these</button></div>' : '') + (ch.length ? ch.map((c) => `<div class="row${S.sel.cue === c.id ? ' sel' : ''}" data-id="${c.id}" data-t="${c.t}">
      <span class="t">${c.t === null ? '' : tc(c.t)}</span><span class="tx"><i class="dotc" style="--c:${c.col}"></i>${esc(c.title)}<small>${esc(c.detail)}</small></span><span></span></div>`).join('')
      : '<div class="empty-list">No draft edits yet.<br>Drag a cue marker, change its gain or sound, or double-click a lane to add one.</div>');
    for (const r of list.querySelectorAll('.row')) {
      r.onclick = () => {
        const t = r.dataset.t === 'null' ? null : +r.dataset.t;
        if (r.dataset.id.startsWith('tw:')) { selectKey(r.dataset.id.slice(3)); return; }
        if (cueById(r.dataset.id)) { S.sel.cue = r.dataset.id; S.sel.note = null; S.lane = cueById(r.dataset.id).stem; emit('selection'); }
        if (t !== null) { ensureVisible(t); seek(t, { frame: true }); }
      };
    }
    const ask = list.querySelector('[data-ask=changes]');
    if (ask) ask.onclick = () => emit('ask-claude', {
      source: 'changes',
      extra: `Draft changes in the studio (bake them into the scene: tweaks -> scene.js / tweaks.json, audio -> sound.json; a saved draft folds in with \`gfx apply ${S.name}\`):\n`
        + ch.map((c) => `- ${c.t === null ? '' : tc(c.t) + ' '}${c.title}: ${c.detail}`).join('\n'),
    });
  }
}

function changes() {
  const out = [];
  for (const [id, o] of Object.entries(S.draft.cues)) {
    const c = cueById(id), b = S.baseById.get(id);
    if (!c || !b) continue;
    const parts = [];
    if ('t' in o) parts.push(`t ${b.t.toFixed(3)} → ${o.t.toFixed(3)}`);
    if ('sound' in o) parts.push(`${b.sound} → ${o.sound}`);
    if ('gain' in o) parts.push(`gain ${b.gain} → ${o.gain} dB`);
    if ('pitch' in o) parts.push(`pitch ${b.pitch} → ${o.pitch}`);
    if ('pan' in o) parts.push(`pan ${(+b.pan).toFixed(2)} → ${(+o.pan).toFixed(2)}`);
    if ('mute' in o) parts.push(o.mute ? 'muted' : 'unmuted');
    if ('dur' in o) parts.push(`dur ${b.dur ?? '–'} → ${o.dur}`);
    out.push({ id, t: c.t, title: id, detail: parts.join(' · '), col: stemColor(c.stem) });
  }
  for (const a of S.draft.add) {
    const c = cueById(a.id);
    out.push({ id: a.id, t: a.t, title: `${a.id}  (added)`, detail: `${a.sound}${a.gain ? ` · gain ${a.gain} dB` : ''}`, col: stemColor(c?.stem || 'ui') });
  }
  for (const [k, o] of Object.entries(S.draft.tweaks || {})) out.push({ id: 'tw:' + k, t: null, title: k, detail: tweakSummary(o), col: 'var(--primary)' });
  for (const [s, o] of Object.entries(S.draft.stems)) out.push({ id: 'stem:' + s, t: null, title: `stem ${s}`, detail: Object.entries(o).map(([k, v]) => `${k} ${v}`).join(' · '), col: stemColor(s) });
  return out.sort((a, b) => (a.t ?? 1e9) - (b.t ?? 1e9));
}
export { duration, isAdded, getTool, setTool };
