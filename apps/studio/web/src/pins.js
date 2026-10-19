// Pins on the picture + the Comment tool (click the picture to create a pin comment).
import { S, on, emit, fps } from './store.js';
import { liveComments, commentNumber } from './comments.js';
import { transport, seek, pause } from './transport.js';
import { getOpenComment, getTool, setTool, baseTool, toScene, inScene, sceneToWrap, addTool, commentsShown, toggleCommentsShown } from './viewer.js';
import { createComment, openPop } from './notes.js';
import { ensureVisible } from './timeline.js';

import { $ } from './dom.js';
const els = new Map();
const FADE = 0.5; // seconds either side of t
let visBtn = null;

function syncVisBtn() {
  if (!visBtn) return;
  const on = commentsShown();
  visBtn.classList.toggle('hid', !on);
  visBtn.setAttribute('aria-pressed', String(!on));
  visBtn.firstChild.textContent = on ? 'Hide comments' : 'Show comments';
  visBtn.title = on ? 'Hide comment pins and drawings on the picture (H); the Comments tab stays' : 'Comments are hidden on the picture: show pins and drawings again (H)';
}

function renderPins() {
  const layer = $('pin-layer');
  if (!S.meta) { layer.textContent = ''; els.clear(); return; }
  layer.hidden = !commentsShown();
  const t = transport.time(), open = getOpenComment(), seen = new Set();
  for (const c of liveComments()) {
    if (c.x == null) continue;
    const dt = Math.abs(t - c.t), exact = dt < 0.75 / fps();
    let op = c.id === open || S.sel.note === c.id ? 1 : exact ? 1 : Math.max(0, 1 - (dt - 0.75 / fps()) / FADE);
    if (op < 0.04) continue;
    const p = sceneToWrap(c.x, c.y);
    if (!p) continue;
    let el = els.get(c.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'pin';
      el.onpointerdown = (e) => e.stopPropagation();
      el.onclick = (e) => {
        e.stopPropagation();
        if (transport.playing) pause();
        S.sel.note = c.id; S.sel.cue = null;
        ensureVisible(c.t); seek(c.t, { frame: true }); openPop(c.id);
      };
      $('pin-layer').appendChild(el); els.set(c.id, el);
    }
    el.textContent = commentNumber(c.id);
    el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
    el.style.opacity = op * (c.status === 'open' ? 1 : 0.6);
    el.dataset.status = c.status;
    el.classList.toggle('sel', S.sel.note === c.id || open === c.id);
    el.title = (c.text || '(no text)') + (c.reply ? `\nClaude: ${c.reply}` : '');
    seen.add(c.id);
  }
  for (const [id, el] of els) if (!seen.has(id)) { el.remove(); els.delete(id); }
}

export function initPins() {
  for (const ev of ['time', 'comments', 'selection', 'layout', 'open-comment', 'scene', 'comments-vis']) on(ev, renderPins);
  visBtn = addTool({ id: 'comments-vis', label: 'Hide comments', key: 'H', onClick: toggleCommentsShown });
  on('comments-vis', syncVisBtn); syncVisBtn();
  const catcher = $('tool-catcher');
  catcher.addEventListener('pointerdown', (e) => {
    if (getTool() !== 'comment' || e.button !== 0) return;
    e.preventDefault();
    const p = toScene(e.clientX, e.clientY);
    if (!inScene(p)) return;
    setTool(baseTool());
    createComment({ x: p.x, y: p.y });
  });
}
