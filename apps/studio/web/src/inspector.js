// Inspector: selected-cue editor (writes sparse overrides to the draft) or a scene summary when nothing is selected.
import { S, on, fps, duration, cueById, patchCue, resetCue, removeCue, isAdded, stemStyle as stemColor, SOUND_NAMES, clamp, esc, r3 } from './store.js';
import { seek } from './transport.js';
import { ensureVisible } from './timeline.js';
import { renderElementInspector } from './elements.js';
import { keysOf } from './keys.js';
import { selectedCues, setCueSelection, shiftSelected, selectLane, setCueLink, linkOfCue } from './retime.js';
import { LY } from './layers.js';
import { mountTweak } from './soundtweak.js';

let el, builtFor = null;
const KEY_HINT = { play: 'play / pause', 'frame.next': 'next frame (Shift = 10)', 'viewer.comment': 'comment tool', 'viewer.live': 'live view', save: 'save draft', undo: 'undo' };
const $ = (s) => el.querySelector(s);

export function initInspector(root) {
  el = root;
  on('selection', render); on('scene', render); on('el-select', render);
  on('live-ready', render); on('live-reloaded', render);
  on('layers', () => { if (S.sel.cue && builtFor === S.sel.cue) sync(); });
  on('draft', () => { if (S.sel.cue && builtFor === S.sel.cue) sync(); else render(); });
  render();
}

function render() {
  if (!S.meta) { builtFor = null; el.innerHTML = '<p class="sec-h">Inspector</p><div class="hint">Select a scene to start reviewing.</div>'; return; }
  if (!S.sel.cue && renderElementInspector(el)) { builtFor = null; return; }
  delete el.dataset.el;
  const multi = selectedCues();
  if (multi.length > 1) { builtFor = null; return multiPanel(multi); }
  const q = S.sel.cue && cueById(S.sel.cue);
  if (!q) { builtFor = null; return summary(); }
  if (builtFor === q.id) return sync();
  builtFor = q.id;
  const col = stemColor(q.stem);
  el.innerHTML = `
    <div class="insp-head"><span class="id" id="i-id"></span><span class="pill" id="i-stem" style="--c:${col}"></span><span class="pill flag" id="i-flag" hidden></span></div>
    <div class="field" data-k="sound"><label>Sound</label><select id="i-sound">${(q.sound === 'sample' ? ['sample', ...SOUND_NAMES] : SOUND_NAMES).map((s) => `<option>${s}</option>`).join('')}</select><span class="was"></span></div>
    <div class="field" data-k="t"><label>Time</label><input type="number" id="i-t" step="0.001"><span class="sub" id="i-tf"></span><span class="was"></span></div>
    <div class="field" data-k="gain"><label>Gain</label><input type="range" id="i-gain-r" min="-24" max="24" step="0.5"><input type="number" id="i-gain" step="0.5"><span class="was"></span></div>
    <div class="field" data-k="pitch"><label>Pitch</label><input type="range" id="i-pitch-r" min="-24" max="24" step="0.5"><input type="number" id="i-pitch" step="0.5"><span class="was"></span></div>
    <div class="field" data-k="pan"><label>Pan</label><input type="range" id="i-pan-r" min="-1" max="1" step="0.05"><input type="number" id="i-pan" step="0.05"><span class="was"></span></div>
    <div class="field" data-k="el"><label for="i-el" title="The layer this sound belongs to: it follows the layer when you drag its bar with Linked on (docs/RETIME.md)">Layer</label><select id="i-el"></select><span class="was"></span></div>
    <div class="field" data-k="mute"><label>Mute</label><span class="toggle" id="i-mute" tabindex="0"><i></i><span id="i-mute-l">on</span></span><span class="was"></span></div>
    <div class="insp-actions"><button class="tbtn" id="i-go">Go to cue</button><button class="tbtn" id="i-reset">Reset</button><span class="spacer"></span><button class="tbtn" id="i-del"></button></div>
    <div class="stw" id="i-stw"></div>`;
  const id = q.id, key = (k) => ({ key: `${k}:${id}`, window: 900 });
  $('#i-sound').onchange = (e) => patchCue(id, { sound: e.target.value });
  $('#i-el').onchange = (e) => { const v = e.target.value; setCueLink(id, v === '@auto' ? null : v); e.target.blur(); };
  const num = (k, inp, rng, lo, hi, round = (x) => x) => {
    const set = (v) => { if (Number.isFinite(v)) patchCue(id, { [k]: round(clamp(v, lo, hi)) }, key(k)); };
    inp.onchange = () => set(parseFloat(inp.value));
    if (rng) rng.oninput = () => set(parseFloat(rng.value));
  };
  num('gain', $('#i-gain'), $('#i-gain-r'), -60, 36, (x) => +x.toFixed(2));
  num('pitch', $('#i-pitch'), $('#i-pitch-r'), -48, 48, (x) => +x.toFixed(2));
  num('pan', $('#i-pan'), $('#i-pan-r'), -1, 1, (x) => +x.toFixed(3));
  $('#i-t').onchange = (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) patchCue(id, { t: r3(clamp(v, 0, duration())) }, key('t')); };
  const tg = $('#i-mute');
  const flip = () => patchCue(id, { mute: !cueById(id).mute });
  tg.onclick = flip; tg.onkeydown = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); flip(); } };
  $('#i-go').onclick = () => { const c = cueById(id); if (c) { ensureVisible(c.t); seek(c.t, { frame: true }); } };
  $('#i-reset').onclick = () => resetCue(id);
  mountTweak($('#i-stw'), id);
  $('#i-del').onclick = () => { removeCue(id); };
  sync();
}

function setIf(inp, v) { if (inp.ownerDocument.activeElement !== inp) inp.value = v; }
function sync() {
  const q = cueById(S.sel.cue);
  if (!q) return render();
  const base = S.baseById.get(q.id), added = isAdded(q.id), ov = S.draft.cues[q.id] || {};
  $('#i-id').textContent = q.id; $('#i-id').title = q.id; $('#i-stem').textContent = q.stem; $('#i-stem').style.setProperty('--c', stemColor(q.stem));
  const fl = $('#i-flag'); fl.hidden = !(added || Object.keys(ov).length); fl.textContent = added ? 'added' : 'edited';
  $('#i-sound').value = q.sound;
  setIf($('#i-t'), r3(q.t)); $('#i-tf').textContent = `frame ${Math.round(q.t * fps())}  ·  ${(Math.abs(q.t * fps() - Math.round(q.t * fps())) > 1e-3 ? 'between frames' : 'on frame')}`;
  setIf($('#i-gain'), q.gain); $('#i-gain-r').value = q.gain;
  setIf($('#i-pitch'), q.pitch); $('#i-pitch-r').value = q.pitch;
  setIf($('#i-pan'), +(+q.pan).toFixed(2)); $('#i-pan-r').value = q.pan;
  $('#i-mute').classList.toggle('on', !!q.mute); $('#i-mute-l').textContent = q.mute ? 'muted' : 'audible';
  for (const f of el.querySelectorAll(':scope > .field')) { // the Shape section marks its own rows
    const k = f.dataset.k, was = f.querySelector('.was');
    const changed = !added && k in ov;
    f.classList.toggle('edited', changed);
    if (was) was.textContent = changed && base ? `was ${k === 'mute' ? (base.mute ? 'muted' : 'on') : k === 'el' ? (base.el || 'by name') : typeof base[k] === 'number' ? r3(base[k]) : base[k]}` : '';
    if (was) was.hidden = !changed;
  }
  $('#i-reset').disabled = !(Object.keys(ov).length) || added;
  linkField(q);
  $('#i-del').textContent = added ? 'Remove cue' : q.mute ? 'Unmute' : 'Mute  (Del)';
}

// Layer link (docs/RETIME.md §3): explicit key, "not linked", or the default link by name.
function linkField(q) {
  const sel = $('#i-el'), keys = LY.nodes.map((n) => n.key), cur = linkOfCue(q);
  const byName = typeof q.el !== 'string';
  const auto = byName ? cur : linkOfCue({ id: q.id });
  const opts = [['@auto', `By name${auto ? ': ' + auto : ' (none)'}`], ['', 'Not linked'], ...[...new Set([...keys, ...(q.el ? [q.el] : [])])].map((k) => [k, k])];
  const sig = JSON.stringify(opts);
  if (sel.dataset.sig !== sig) { sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join(''); sel.dataset.sig = sig; }
  sel.value = byName ? '@auto' : q.el;
  sel.title = keys.length ? '' : 'Turn Live on (L) to list the layers';
}

// Several cues selected (docs/RETIME.md §4): shift them together, select the lane, clear.
function multiPanel(ids) {
  const cues = ids.map(cueById).filter(Boolean);
  const t0 = Math.min(...cues.map((c) => c.t)), t1 = Math.max(...cues.map((c) => c.t));
  const stems = [...new Set(cues.map((c) => c.stem))];
  el.innerHTML = `<div class="insp-head"><span class="id" id="i-multi">${cues.length} cues selected</span></div>
    <div class="kv"><span>from</span><span>${t0.toFixed(3)} s</span><span>to</span><span>${t1.toFixed(3)} s</span><span>lanes</span><span>${stems.map((n) => `<span style="color:${stemColor(n)}">${esc(n)}</span>`).join(', ')}</span></div>
    <div class="field" data-k="shift"><label for="i-shift" title="Seconds; negative = earlier">Shift by s</label><input type="number" id="i-shift" step="${(1 / fps()).toFixed(4)}" value="0"></div>
    <div class="hint">Drag any selected cue to move them all. Shift+click adds or removes a cue, Shift+drag on a lane selects with a box, double-click a lane name selects the whole lane.</div>
    <div class="insp-actions"><button class="tbtn" id="i-shift-go">Shift</button><button class="tbtn" id="i-lane" title="Select every cue on ${esc(cueById(S.sel.cue)?.stem || stems[0])}">Select lane</button><span class="spacer"></span><button class="tbtn" id="i-clear">Clear</button></div>`;
  const go = () => { const v = parseFloat($('#i-shift').value); if (Number.isFinite(v) && v) shiftSelected(v); };
  $('#i-shift').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  $('#i-shift-go').onclick = go;
  $('#i-lane').onclick = () => selectLane(cueById(S.sel.cue)?.stem || stems[0]);
  $('#i-clear').onclick = () => setCueSelection([], null);
}

function summary() {
  const cues = S.res.cues, m = S.meta;
  const stems = S.stemOrder.map((s) => `<span style="color:${stemColor(s)}">${s}</span><span>${cues.filter((c) => c.stem === s).length} cues</span>`).join('');
  el.innerHTML = `<p class="sec-h">Scene</p>
    <div class="kv"><span>name</span><span>${S.name}</span><span>size</span><span>${m.width}×${m.height}</span><span>fps</span><span>${m.fps}</span><span>duration</span><span>${m.duration.toFixed(2)} s · ${Math.round(m.duration * m.fps)} f</span><span>cues</span><span>${cues.length}</span></div>
    <p class="sec-h">Stems</p><div class="kv">${stems}</div>
    <p class="sec-h">Shortcuts</p>
    <div class="hint">Press <kbd>?</kbd> for all shortcuts<br>${['play', 'frame.next', 'viewer.comment', 'viewer.live', 'save', 'undo'].map((id) => `<span class="hk">${keysOf(id).slice(0, 1).map((k) => `<kbd>${k}</kbd>`).join('')} ${esc(KEY_HINT[id])}</span>`).join('')}</div>`;
}
