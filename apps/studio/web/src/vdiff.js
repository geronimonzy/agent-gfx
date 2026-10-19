// Compare visually (docs/VISUAL-DIFF.md §3): two versions of a scene rendered live at the same t, side by side, as a
// wipe, or as a difference view. Each side = one `gfx version preview <rev|now> --json` engine job (a Vite server on a
// read-only checkout, ports 5260-5299) + the live bridge in an iframe; one shared t, seeks coalesced per side.
// The iframes stay in one stage element for the dialog's lifetime (moving an iframe reloads it): modes only change
// their boxes, clip and blend.
import * as api from './api.js';
import { S, esc, on } from './store.js';
import { transport } from './transport.js';
import { roundSurfaceOrigin } from './surface-origin.js';
import './vdiff.css';

const MODES = [['side', 'Side by side'], ['wipe', 'Wipe'], ['diff', 'Difference']];
const HEARTBEAT_MS = 5000; // the preview exits after 45 s without requests (docs/VISUAL-DIFF.md §2)
export const VD = { open: false, mode: 'side', boost: true, t: 0, playing: false, scene: null, wipe: 0.5, entries: [], sides: { a: null, b: null } };
let dlg = null, stage = null, layer = null, beat = 0, raf = 0, gen = 0, ro = null;

const shaArg = (s) => String(s || '').replace(/[^0-9a-fA-F]/g, '');
const title = (e) => e?.note?.split('\n')[0] || e?.msg || '(no message)';
const short = (rev) => (rev === 'now' ? 'now' : String(rev).slice(0, 7));
const entryOf = (rev) => VD.entries.find((e) => e.sha === rev) || null;
function stamp(time) { const d = new Date(time); return Number.isFinite(+d) ? d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; }
const label = (rev) => (rev === 'now' ? 'Current files' : `${short(rev)} · ${title(entryOf(rev))}`);
const fps = () => VD.sides.a?.meta?.fps || VD.sides.b?.meta?.fps || S.meta?.fps || 60;
const duration = () => Math.max(0, ...['a', 'b'].map((k) => Number(VD.sides[k]?.meta?.duration) || 0)) || Number(S.meta?.duration) || 0;

// ---------- dialog ----------
function build() {
  dlg = document.createElement('div');
  dlg.id = 'vdiff-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal vdiff" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="vd-title">
    <div class="modal-head vd-head"><b id="vd-title">Compare visually</b>
      <label class="vd-pick"><span class="vd-tag">A</span><select class="vd-a" aria-label="Version A"></select></label>
      <button type="button" class="icon vd-swap" title="Swap A and B" aria-label="Swap A and B">&#8644;</button>
      <label class="vd-pick"><span class="vd-tag">B</span><select class="vd-b" aria-label="Version B"></select></label>
      <label class="vd-pick"><span class="dim">Scene</span><select class="vd-scene" aria-label="Scene"></select></label>
      <span class="spacer"></span>
      <span class="seg vd-modes" role="group" aria-label="View">${MODES.map(([m, l], i) => `<button type="button" data-m="${m}" title="${l} (${i + 1})">${l}</button>`).join('')}</span>
      <button type="button" class="link vd-x" title="Close (Esc)" aria-label="Close">&times;</button></div>
    <div class="vd-stage" tabindex="0"><div class="vd-layer"></div><div class="vd-wipe" hidden><i></i></div></div>
    <div class="vd-bar"><button type="button" class="icon vd-play" title="Play / pause (Space)" aria-label="Play">&#9654;</button>
      <input type="range" class="vd-scrub" min="0" max="1" step="0.001" value="0" aria-label="Time">
      <span class="vd-time mono">0.00 s</span><span class="vd-legend" hidden>Black = same pixels</span><label class="chk vd-boost" hidden title="Brighten the difference ×4 so small changes show"><input type="checkbox" checked> Boost</label><span class="dim vd-note" title="Both sides run on the current engine: the diff shows changes in the project's files">Current engine · files of each version</span></div>
  </div>`;
  document.body.appendChild(dlg);
  stage = dlg.querySelector('.vd-stage');
  layer = stage.querySelector('.vd-layer');
  dlg.querySelector('.vd-x').onclick = closeVisualDiff;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeVisualDiff(); });
  dlg.querySelector('.vd-modes').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); };
  dlg.querySelector('.vd-swap').onclick = swap;
  dlg.querySelector('.vd-a').onchange = (e) => setSide('a', e.target.value);
  dlg.querySelector('.vd-b').onchange = (e) => setSide('b', e.target.value);
  dlg.querySelector('.vd-scene').onchange = (e) => setScene(e.target.value);
  dlg.querySelector('.vd-play').onclick = togglePlay;
  dlg.querySelector('.vd-boost input').onchange = (e) => { VD.boost = e.target.checked; render(); };
  const scrub = dlg.querySelector('.vd-scrub');
  scrub.oninput = () => { stopPlay(); seekAll(+scrub.value); };
  stage.addEventListener('pointerdown', wipeDrag);
  stage.addEventListener('keydown', (e) => {
    if (VD.mode !== 'wipe' || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); VD.wipe = Math.min(1, Math.max(0, VD.wipe + (e.key === 'ArrowUp' ? 0.05 : -0.05))); layout();
  });
  window.addEventListener('message', onMessage);
  ro = new ResizeObserver(() => layout());
  ro.observe(stage);
}
export const visualDiffOpen = () => !!dlg && !dlg.hidden;

/** Open the dialog: a / b = sha or 'now'; entries = the Versions log (labels + pickers). */
export function openVisualDiff({ a, b = 'now', entries = [], scene = S.name, t = +transport.time() || 0 } = {}) {
  if (!dlg) build();
  Object.assign(VD, { open: true, entries, scene: scene || null, t, playing: false });
  dlg.hidden = false;
  fillPickers(a, b);
  setSide('a', a); setSide('b', b);
  render();
  roundSurfaceOrigin(dlg);
  stage.focus();
  clearInterval(beat);
  beat = setInterval(heartbeat, HEARTBEAT_MS);
}
export function closeVisualDiff() {
  if (!dlg || dlg.hidden) return;
  stopPlay();
  clearInterval(beat); beat = 0;
  for (const k of ['a', 'b']) stopSide(k);
  VD.open = false;
  dlg.hidden = true;
}

function fillPickers(a, b) {
  const opts = (sel) => [`<option value="now"${sel === 'now' ? ' selected' : ''}>Current files</option>`,
    ...VD.entries.map((e) => `<option value="${esc(e.sha)}"${e.sha === sel ? ' selected' : ''}>${esc(`${e.short || short(e.sha)} · ${title(e).slice(0, 60)}`)}</option>`)].join('');
  dlg.querySelector('.vd-a').innerHTML = opts(a);
  dlg.querySelector('.vd-b').innerHTML = opts(b);
}

// ---------- sides (one engine job + iframe each) ----------
function stopSide(k) {
  const s = VD.sides[k];
  if (!s) return;
  s.closed = true;
  clearTimeout(s.readyTimer);
  for (const w of s.waits.values()) w.reject(cancelled('closed'));
  s.waits.clear();
  s.box.remove();
  // graceful stop first (the process removes its checkout), then kill the job if it is still there
  const kill = () => { if (s.jobId) api.engineCancel(s.jobId).catch(() => {}); };
  if (s.info?.url) fetch(`${s.info.url}/__gfx/vdiff-stop`, { method: 'POST', mode: 'no-cors', signal: AbortSignal.timeout(1500) }).catch(() => {}).finally(() => setTimeout(kill, 1500));
  else kill();
  VD.sides[k] = null;
}
function setSide(k, rev) {
  if (VD.sides[k]?.rev === rev && !VD.sides[k].err) return;
  stopSide(k);
  const box = document.createElement('div');
  box.className = `vd-box vd-${k}`;
  box.innerHTML = '<div class="vd-msg">Starting preview…</div><div class="vd-lbl"></div>';
  layer.appendChild(box);
  const s = { k, rev, gen: ++gen, box, frame: null, info: null, meta: null, ready: false, err: '', waits: new Map(), seq: 0, want: null, drawn: null, busy: false, closed: false, errs: [] };
  VD.sides[k] = s;
  const job = api.engineRun(['version', 'preview', rev === 'now' ? 'now' : shaArg(rev), '--json'], {
    progress: false,
    onEvent: (ev) => {
      if (s.closed) return;
      if (ev.type === 'vdiff') onInfo(s, ev);
      else if (ev.type === 'log' && ev.stream === 'stderr' && ev.msg.trim()) s.errs.push(ev.msg);
      else if (ev.type === 'error' && ev.msg) s.errs.push(String(ev.msg));
    },
  });
  s.jobId = job.jobId;
  job.done.then((res) => {
    if (s.closed) return;
    const why = s.errs.filter((l) => !/^\s+at |^\s*$|^Node\.js v/.test(l)).map((l) => l.trim().replace(/^gfx: /, '')).pop();
    fail(s, s.info ? 'The preview server stopped.' : why || res.error || `The preview could not start (exit ${res.code}).`);
  }, (e) => { if (!s.closed) fail(s, String(e.message || e)); });
  render();
}
/** A request dropped on purpose (dialog closed, side or scene switched): not a scene failure. */
const cancelled = (why) => Object.assign(new Error(why), { cancelled: true });
function fail(s, msg) { s.err = msg; s.ready = false; render(); }
function swap() {
  const a = VD.sides.a, b = VD.sides.b;
  if (!a || !b) return;
  VD.sides.a = b; VD.sides.b = a;
  a.k = 'b'; b.k = 'a';
  a.box.className = 'vd-box vd-b'; b.box.className = 'vd-box vd-a';
  fillPickers(b.rev, a.rev);
  render();
}
/** Wait until the webview itself reaches the server: a WSL engine's new port is forwarded to Windows only after a
 *  moment, and an iframe loaded before that shows the browser's "can't reach this page" and never recovers. */
async function reachable(url, isGone, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !isGone()) {
    try { if ((await fetch(`${url}/__gfx/ping`, { cache: 'no-store', signal: AbortSignal.timeout(1000) })).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
async function onInfo(s, info) {
  if (!(await reachable(info.url, () => s.closed))) { if (!s.closed) fail(s, `The preview server at ${info.url} does not answer.`); return; }
  if (s.closed) return;
  s.info = info;
  // the requested scene stays (a side without it says so); only with none requested does the first report choose
  if (!VD.scene) { const scenes = sceneList(); VD.scene = S.name && scenes.includes(S.name) ? S.name : scenes[0] || null; if (VD.scene) for (const k of ['a', 'b']) if (VD.sides[k] && VD.sides[k] !== s && VD.sides[k].info) mountFrame(VD.sides[k]); }
  mountFrame(s);
  render();
}
const READY_MS = 20000; // a bridge that has not said ready by then: reload once, then report it
function mountFrame(s, retry = false) {
  s.frame?.remove(); s.frame = null; s.ready = false; s.meta = null; s.drawn = null; s.err = '';
  clearTimeout(s.readyTimer);
  for (const w of s.waits.values()) w.reject(cancelled('reloaded'));
  s.waits.clear();
  if (!s.info || !VD.scene || !s.info.scenes.includes(VD.scene)) return;
  const f = document.createElement('iframe');
  s.readyTimer = setTimeout(() => {
    if (s.closed || s.ready || s.frame !== f) return;
    if (!retry) mountFrame(s, true); else fail(s, 'The scene did not load (no answer from the preview page).');
  }, READY_MS);
  f.className = 'vd-frame';
  f.setAttribute('aria-label', `${s.k.toUpperCase()}: ${label(s.rev)}`);
  f.src = `${s.info.url}/runner/player/bridge.html?scene=${encodeURIComponent(VD.scene)}`;
  s.box.insertBefore(f, s.box.firstChild);
  s.frame = f;
}
function sceneList() {
  const all = new Set();
  for (const k of ['a', 'b']) for (const n of VD.sides[k]?.info?.scenes || []) all.add(n);
  if (VD.scene) all.add(VD.scene);
  return [...all];
}
function setScene(name) {
  VD.scene = name;
  for (const k of ['a', 'b']) if (VD.sides[k]) mountFrame(VD.sides[k]);
  render();
}

// ---------- bridge messaging ----------
function sideOf(win) { for (const k of ['a', 'b']) { const s = VD.sides[k]; if (s?.frame && s.frame.contentWindow === win) return s; } return null; }
function onMessage(ev) {
  const s = sideOf(ev.source), m = ev.data;
  if (!s || !m || typeof m !== 'object') return;
  clearTimeout(s.readyTimer); // the page answers (ready, error, reply): a scene error is not a connection timeout
  if (m.type === 'ready') { s.meta = m.meta; s.ready = true; s.err = ''; s.drawn = null; render(); want(s, VD.t); return; }
  // a live rebuild (the `now` side, or a failed one fixed): new meta if it changed, ready again, back at the shared t
  if (m.type === 'reloaded') { if (m.meta) s.meta = m.meta; s.ready = true; s.err = ''; s.drawn = null; render(); want(s, VD.t); return; }
  if (m.type === 'error') { fail(s, `Scene error: ${m.message}`); return; }
  if (m.type === 'reply') { const w = s.waits.get(m.id); if (w) { s.waits.delete(m.id); m.ok ? w.resolve(m.result) : w.reject(new Error(m.error)); } }
}
function call(s, type, args = {}) {
  return new Promise((resolve, reject) => {
    const id = `vd${s.gen}-${++s.seq}`;
    s.waits.set(id, { resolve, reject });
    try { s.frame.contentWindow.postMessage({ id, type, ...args }, '*'); } catch (e) { s.waits.delete(id); reject(e); }
  });
}
/** Coalesced seek: the latest wanted t wins, one request in flight per side. */
async function want(s, t) {
  s.want = t;
  if (s.busy || !s.ready) return;
  s.busy = true;
  try {
    while (s.ready && !s.closed && s.drawn !== s.want) {
      const x = s.want, dur = Number(s.meta?.duration) || x;
      await call(s, 'seek', { t: Math.min(x, Math.max(0, dur - 1 / (s.meta?.fps || 60))) });
      s.drawn = x;
    }
  } catch (e) {
    // a scene that throws while drawing: show it on this side (the picture would be stale); a fix reloads it ('reloaded')
    if (!e?.cancelled && !s.closed) fail(s, `Scene error at ${(+s.want || 0).toFixed(2)} s: ${e?.message || e}`);
  } finally {
    s.busy = false;
    if (s.ready && !s.closed && s.drawn !== s.want) want(s, s.want); // a request that arrived while one failed / finished
  }
}
function seekAll(t) {
  VD.t = Math.max(0, Math.min(t, duration() || t));
  for (const k of ['a', 'b']) if (VD.sides[k]) want(VD.sides[k], VD.t);
  renderTime();
}
async function heartbeat() {
  for (const k of ['a', 'b']) {
    const u = VD.sides[k]?.info?.url;
    if (u) fetch(`${u}/__gfx/ping`, { cache: 'no-store', signal: AbortSignal.timeout(2000) }).catch(() => {});
  }
}

// ---------- transport ----------
function togglePlay() { if (VD.playing) stopPlay(); else startPlay(); }
function startPlay() {
  if (!duration()) return;
  VD.playing = true;
  let last = performance.now();
  if (VD.t >= duration() - 1 / fps()) VD.t = 0;
  const tick = (now) => {
    if (!VD.playing) return;
    let t = VD.t + (now - last) / 1000;
    last = now;
    if (t >= duration()) t = 0;
    seekAll(t);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  renderTime();
}
function stopPlay() { VD.playing = false; cancelAnimationFrame(raf); renderTime(); }
function step(n) { stopPlay(); seekAll(Math.round(VD.t * fps() + n) / fps()); }
function setMode(m) { if (MODES.some(([x]) => x === m)) { VD.mode = m; render(); } }

function wipeDrag(e) {
  if (VD.mode !== 'wipe' || e.button !== 0) return;
  const r = stage.getBoundingClientRect();
  const move = (ev) => { VD.wipe = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)); layout(); };
  move(e);
  stage.setPointerCapture(e.pointerId);
  stage.onpointermove = move;
  stage.onpointerup = stage.onpointercancel = () => { stage.onpointermove = null; stage.onpointerup = stage.onpointercancel = null; };
}

// ---------- view ----------
function render() {
  if (!dlg || dlg.hidden) return;
  for (const b of dlg.querySelectorAll('.vd-modes [data-m]')) b.classList.toggle('on', b.dataset.m === VD.mode);
  const scenes = sceneList(), sel = dlg.querySelector('.vd-scene');
  sel.innerHTML = (scenes.length ? scenes : [VD.scene || '']).map((n) => `<option value="${esc(n)}"${n === VD.scene ? ' selected' : ''}>${esc(n || '…')}</option>`).join('');
  sel.disabled = scenes.length < 2;
  for (const k of ['a', 'b']) {
    const s = VD.sides[k];
    if (!s) continue;
    const e = entryOf(s.rev), msg = s.box.querySelector('.vd-msg'), lbl = s.box.querySelector('.vd-lbl');
    lbl.innerHTML = `<span class="vd-tag">${k.toUpperCase()}</span><span class="vd-lt">${esc(s.rev === 'now' ? 'Current files' : title(e) || short(s.rev))}</span>${s.rev !== 'now' ? `<span class="mono dim">${esc(short(s.rev))}${e?.time ? ` · ${esc(stamp(e.time))}` : ''}</span>` : ''}`;
    lbl.title = label(s.rev);
    const missing = s.info && VD.scene && !s.info.scenes.includes(VD.scene);
    const text = s.err || (missing ? `Scene “${VD.scene}” is not in this version.` : !s.info ? 'Starting preview…' : !s.ready ? 'Loading the scene…' : '');
    msg.textContent = text;
    msg.hidden = !text;
    msg.classList.toggle('err', !!s.err);
    s.box.classList.toggle('ready', s.ready);
  }
  dlg.querySelector('.vd-legend').hidden = dlg.querySelector('.vd-boost').hidden = VD.mode !== 'diff';
  stage.classList.toggle('boost', VD.boost);
  const scrub = dlg.querySelector('.vd-scrub'), d = duration();
  scrub.max = String(d || 1); scrub.step = String(1 / fps());
  layout();
  renderTime();
}
function renderTime() {
  if (!dlg) return;
  const scrub = dlg.querySelector('.vd-scrub');
  if (document.activeElement !== scrub || VD.playing) scrub.value = String(VD.t);
  dlg.querySelector('.vd-time').textContent = `${VD.t.toFixed(2)} / ${duration().toFixed(2)} s`;
  const p = dlg.querySelector('.vd-play');
  p.innerHTML = VD.playing ? '&#10073;&#10073;' : '&#9654;';
  p.setAttribute('aria-label', VD.playing ? 'Pause' : 'Play');
}
/** Place both boxes: two halves (side) or both over the whole stage (wipe / difference); each picture is contained in its box. */
function layout() {
  if (!stage || dlg.hidden) return;
  const W = stage.clientWidth, H = stage.clientHeight, gap = 8, overlay = VD.mode !== 'side';
  stage.classList.toggle('overlay', overlay);
  stage.dataset.mode = VD.mode;
  const rects = overlay ? { a: [0, 0, W, H], b: [0, 0, W, H] } : { a: [0, 0, Math.floor((W - gap) / 2), H], b: [Math.ceil((W + gap) / 2), 0, W - Math.ceil((W + gap) / 2), H] };
  for (const k of ['a', 'b']) {
    const s = VD.sides[k];
    if (!s) continue;
    const [x, y, w, h] = rects[k];
    Object.assign(s.box.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    const f = s.frame, m = s.meta;
    s.box.style.clipPath = VD.mode === 'wipe' && k === 'b' ? `inset(0 0 0 ${Math.round(VD.wipe * W)}px)` : '';
    if (!f || !m) { if (f) f.style.visibility = 'hidden'; continue; }
    const kk = Math.min(w / m.width, h / m.height), pw = m.width * kk, ph = m.height * kk;
    Object.assign(f.style, { visibility: '', width: `${m.width}px`, height: `${m.height}px`, transform: `translate(${Math.round((w - pw) / 2)}px, ${Math.round((h - ph) / 2)}px) scale(${kk})` });
  }
  const wl = dlg.querySelector('.vd-wipe');
  wl.hidden = VD.mode !== 'wipe';
  wl.style.left = `${Math.round(VD.wipe * W)}px`;
}

/** Keymap hooks (dialog context): Space, ←/→, 1/2/3. */
export const vdiffKeys = { togglePlay, step, setMode };

export function initVisualDiff() {
  on('root', () => closeVisualDiff());
  window.__vdiff = { VD, openVisualDiff, closeVisualDiff, seekAll, setMode, setSide, setScene, swap };
}
