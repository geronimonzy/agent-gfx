// "Changed by Claude" (docs/CLAUDE-IN-APP.md §4): when the scene's files change while the user is idle (Claude working in the
// terminal or in T3), the scene picker pulses until the next interaction. Sources: the live bridge's `reloaded` message, and a
// light mtime poll of the scene files when Live is off.
import * as api from './api.js';
import { S, on } from './store.js';
import { liveOn } from './live.js';

import { $ } from './dom.js';
const IDLE_MS = 4000;
const FILES = ['scene.js', 'scene.json', 'tweaks.json', 'sound.json', 'STORYBOARD.md'];
let lastInput = performance.now(), sig = '', sigScene = null, polling = false;

export const userIdle = () => performance.now() - lastInput > IDLE_MS;

export function pulse(reason) {
  const sel = $('scene-menu-btn');
  if (!sel || !userIdle()) return;
  sel.classList.remove('claude-pulse'); void sel.offsetWidth; sel.classList.add('claude-pulse');
  sel.dataset.title ??= sel.title;
  sel.title = `Changed by Claude${reason ? ` (${reason})` : ''}`;
  const chip = $('claude-chip');
  if (chip) { chip.hidden = false; chip.title = sel.title; chip.querySelector('span').textContent = 'changed by Claude'; }
}
function clear() {
  const sel = $('scene-menu-btn');
  if (sel?.classList.contains('claude-pulse')) { sel.classList.remove('claude-pulse'); sel.title = sel.dataset.title || 'Scene'; }
  const chip = $('claude-chip');
  if (chip) chip.hidden = true;
}

async function poll() {
  if (polling || !S.name || liveOn()) { if (liveOn()) sigScene = null; return; }
  polling = true;
  try {
    const name = S.name;
    const st = await Promise.all(FILES.map((f) => api.stat(`scenes/${name}/${f}`).then((s) => s?.mtime || 0, () => 0)));
    const next = st.join(',');
    if (name === S.name) {
      if (sigScene === name && next !== sig) pulse(FILES.filter((_, i) => String(st[i]) !== sig.split(',')[i]).join(', '));
      sig = next; sigScene = name;
    }
  } finally { polling = false; }
}

export function initPulse() {
  const input = () => { lastInput = performance.now(); clear(); };
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, input, { capture: true, passive: true });
  on('live-reloaded', (m) => pulse(m?.reason));
  on('scene', () => { sigScene = null; clear(); });
  setInterval(poll, 2500);
}
