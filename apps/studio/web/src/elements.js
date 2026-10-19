// Element UI for Live mode: the inspector for the selected element and the Elements side tab.
// Inspector (docs/INSPECTOR.md §2/§3): one column of fields showing the ACTUAL value at the playhead; typing sets the tweak
// so the actual becomes the typed value. Virtual elements (ctx.el bounds objects) only edit what the scene reads.
import { S, on, emit, TWEAK_ID, tweakOf, tweakSummary, resetTweak, clamp, esc, r3 } from './store.js';
import { applyActual, actualOf, isPinned, togglePin } from './paths.js';
import { L, getSel, selectIndex, selectKey, editTweak, liveOn, request, setEditGate } from './live.js';
import { LY } from './layers.js';
import * as codeMod from './code.js';
import { RT, whyNot, timingPatch, soundsOfKeys } from './retime.js';

const MORE_KEY = 'gfx-studio.inspector.more';
const RO_TIP = 'This object is drawn by code; ask Claude or edit its code';
const NUM = ['x', 'y', 'scale', 'rotate', 'opacity'];
const RATIO = new Set(['scale', 'opacity']); // typed / (actual / tweak); the others: typed - (actual - tweak)
const LIM = { x: [-1e5, 1e5], y: [-1e5, 1e5], scale: [0.05, 20], rotate: [-3600, 3600], opacity: [0, 1] };
const TIP = { x: 'centre x on screen (scene px)', y: 'centre y on screen (scene px)', scale: 'accumulated scale incl. ancestors', rotate: 'accumulated rotation incl. ancestors (°)', opacity: 'effective opacity incl. ancestors' };

// `code {key}` answers per key (tweakable / regions / marked); line numbers and reads change on reload
const codeInfo = new Map();
let codeRev = 0;
const clearCodeInfo = () => { codeInfo.clear(); codeRev++; };
on('live-ready', clearCodeInfo);
on('live-reloaded', clearCodeInfo);
on('scene', clearCodeInfo);
function codeOf(key, done) {
  const c = codeInfo.get(key);
  if (c) { if (c.r !== undefined) done(c.r); else c.wait.push(done); return; }
  const e = { r: undefined, wait: [done] };
  codeInfo.set(key, e);
  request('code', { key }, 5000).then((r) => r || null, () => null).then((r) => {
    if (codeInfo.get(key) !== e) return;
    e.r = r; for (const f of e.wait.splice(0)) f(r);
  });
}

/** Bounds objects (`ctx.el(key, { bounds })`, canvas/three) vs DOM: layers tree kind, else the pick entry's shape. */
function isVirtual(s) {
  const kind = LY.byKey.get(s.key)?.kind;
  if (kind) return kind === 'box';
  const e = s.entry;
  return e.label === e.key && e.rot === 0 && !e.text;
}
// the picture's Select handles follow the same rule as the fields (unknown yet = allowed only for DOM elements)
setEditGate((key, k) => {
  const s = getSel();
  if (!s || s.key !== key || !isVirtual(s)) return true;
  const c = codeInfo.get(key);
  return editableOf(true, c?.r)(k);
});
/** Editable properties: DOM = all; virtual = only what the scene reads (`tweakable` from `code {key}`; missing = none). */
function editableOf(virtual, info) {
  if (!virtual) return () => true;
  const tw = info?.tweakable;
  return (k) => !!(tw?.read && Array.isArray(tw.props) && tw.props.includes(k));
}

/** Render/sync the element inspector into `root`. Returns false if no element is selected. */
export function renderElementInspector(root) {
  const s = getSel();
  if (!s) return false;
  const q = (sel) => root.querySelector(sel);
  const sig = s.key + '|' + s.stack.map((e) => e.key).join('>') + '|' + s.idx + '|' + !!s.entry.text + '|' + codeRev;
  if (root.dataset.el !== sig) {
    root.dataset.el = sig;
    const key = s.key, virtual = isVirtual(s);
    const crumbs = s.stack.map((e, i) => ({ e, i })).reverse()
      .map(({ e, i }) => `<button class="crumb${i === s.idx ? ' on' : ''}" data-i="${i}" title="${esc(e.key)}">${esc(e.named ? e.key : e.label || e.key)}</button>`).join('<span class="sep">›</span>');
    const rs = (k, label) => `<button class="ef-rs" data-rs="${k}" tabindex="-1" title="Reset ${label} (drop this tweak)">↺</button>`;
    const num = (k, label, step) => `<div class="field" data-k="${k}"><label for="e-${k}" title="${TIP[k]}">${label}</label><input type="number" id="e-${k}" data-act="${k}" step="${step}">${rs(k, label)}</div>`;
    const more = localStorage.getItem(MORE_KEY) === '1';
    root.innerHTML = `<div class="ei${virtual ? ' virtual' : ''}">
      <div class="insp-head"><span class="id" title="${esc(key)}${s.entry.label && s.entry.label !== key ? ' · ' + esc(s.entry.label) : ''}">${esc(key)}</span><span class="pill flag" id="e-flag" hidden>tweaked</span><button class="tbtn mini spacer-l" id="e-path" title="Motion path (P)">⤳ Path</button></div>
      <div class="crumbs" title="[ / ] walk the stack">${crumbs}</div>
      ${num('x', 'X', 1)}${num('y', 'Y', 1)}${num('scale', 'Scale', 0.01)}${num('rotate', 'Rotate', 1)}${num('opacity', 'Opacity', 0.05)}
      <div class="field" data-k="shift"><label for="e-shift" title="Play this element's animation later (+) or earlier (−), in seconds. Or drag its layer bar">Shift</label><input type="number" id="e-shift" step="${(1 / (S.meta?.fps || 60)).toFixed(4)}">${rs('shift', 'Shift')}</div>
      <div class="field" data-k="stretch"><label for="e-stretch" title="Duration factor of its animation (2 = twice as long). Or drag an edge of its layer bar">Stretch</label><input type="number" id="e-stretch" step="0.05" min="0.1" max="10">${rs('stretch', 'Stretch')}</div>
      <div class="ei-sounds sub" id="e-sounds"></div>
      ${s.entry.text ? `<div class="field" data-k="text"><label for="e-text">Text</label><input type="text" id="e-text">${rs('text', 'Text')}</div>` : ''}
      <details class="ei-more" id="e-more"${more ? ' open' : ''}><summary>More</summary>
        <div class="field" data-k="color"><label for="e-color">Color</label><input type="color" id="e-color">${rs('color', 'Color')}</div>
        <div class="field" data-k="bg"><label for="e-bg">BG</label><input type="color" id="e-bg">${rs('bg', 'BG')}</div>
        <div class="field" data-k="visible"><label>Output</label><label class="chk"><input type="checkbox" id="e-visible"> Visible in output</label>${rs('visible', 'Visible in output')}</div>
        <div class="field" data-k="z"><label>Order</label><span class="zrow"><button class="tbtn" id="e-zup" title="z +1 (tweak z)">Bring forward</button><button class="tbtn" id="e-zdn" title="z -1 (tweak z)">Send backward</button></span>${rs('z', 'Order')}<span class="sub" id="e-zv"></span></div>
      </details>
      <div class="ei-code"><button class="tbtn" id="e-open-code" title="Open this object's code">Open code <span class="ei-n" id="e-code-n"></span></button></div>
      <div class="code-sec" id="e-code"></div>
      <div class="insp-actions"><button class="tbtn" id="e-reset" title="Drop all tweaks of this element">Reset all</button><span class="spacer"></span><button class="tbtn" id="e-ask" title="Ask Claude about this element: brief with its live values (terminal or T3)">Ask Claude</button></div>
    </div>`;
    for (const b of root.querySelectorAll('.crumb')) b.onclick = () => selectIndex(+b.dataset.i);
    // value fields: the typed actual -> tweak. The scene's own part (base) is taken once per focus, so keystrokes that
    // arrive before the live picture caught up with the previous one still land on the typed value.
    for (const k of NUM) {
      const inp = q('#e-' + k);
      inp.onfocus = inp.onblur = () => { inp._base = undefined; inp._warned = false; };
      inp.oninput = () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v) || inp.readOnly) return;
        // Match live.js's layer(): file tweaks are always applied, draft overrides only in Draft.
        const tw = S.mode === 'draft' ? tweakOf(key)[k] : (S.fileTweaks[key]?.[k] ?? TWEAK_ID[k]), act = actualOf(key, k);
        // no actual values, or an opacity tweak of 0 (the scene's part is unknown): the typed value is the tweak
        if (inp._base === undefined) inp._base = RATIO.has(k) ? (act == null || !tw ? 1 : act / tw) : act == null ? 0 : act - tw;
        const b = inp._base;
        if (!Number.isFinite(b) || (RATIO.has(k) && Math.abs(b) < 1e-6)) {
          if (!inp._warned) { inp._warned = true; emit('toast', { m: `Can't set ${k} here: the scene's own ${k} is 0 at this frame`, ms: 2600 }); }
          return;
        }
        const nt = RATIO.has(k) ? v / b : v - b;
        editTweak(key, { [k]: r3(clamp(nt, ...LIM[k])) }, { key: `tw:${key}:${k}`, window: 900 });
      };
    }
    for (const k of ['shift', 'stretch']) {
      const inp = q('#e-' + k);
      inp.oninput = () => {
        const v = parseFloat(inp.value);
        if (!Number.isFinite(v) || inp.readOnly || (k === 'stretch' && v <= 0)) return;
        editTweak(key, timingPatch(key, k, k === 'stretch' ? +clamp(v, 0.1, 10).toFixed(4) : +v.toFixed(4)), { key: `tw:${key}:${k}`, window: 900 });
      };
    }
    if (s.entry.text) q('#e-text').oninput = (e) => { if (!e.target.readOnly) editTweak(key, { text: e.target.value }, { key: `tw:${key}:text`, window: 900 }); };
    for (const k of ['color', 'bg']) q('#e-' + k).oninput = (e) => editTweak(key, { [k]: e.target.value }, { key: `tw:${key}:${k}`, window: 900 });
    for (const b of root.querySelectorAll('.ef-rs')) b.onclick = () => editTweak(key, { [b.dataset.rs]: null });
    q('#e-visible').onchange = (e) => editTweak(key, { visible: e.target.checked }, { key: `tw:${key}:visible` });
    q('#e-zup').onclick = () => editTweak(key, { z: (tweakOf(key).z || 0) + 1 }, { key: `tw:${key}:z`, window: 600 });
    q('#e-zdn').onclick = () => editTweak(key, { z: (tweakOf(key).z || 0) - 1 }, { key: `tw:${key}:z`, window: 600 });
    q('#e-more').ontoggle = (e) => localStorage.setItem(MORE_KEY, e.currentTarget.open ? '1' : '0');
    q('#e-reset').onclick = () => resetTweak(key);
    q('#e-ask').onclick = (e) => { e.currentTarget.blur(); emit('ask-claude', { source: 'element', el: key }); };
    q('#e-path').onclick = (e) => { e.currentTarget.blur(); togglePin(key); };
    q('#e-open-code').onclick = (e) => {
      e.currentTarget.blur();
      if (typeof codeMod.openObjectCode === 'function') { codeMod.openObjectCode(key); return; }
      // fallback until code.js has the object view: the refs list under the button (click a ref -> file at its line)
      const box = q('#e-code');
      if (box.dataset.key === key) { box.innerHTML = ''; box.dataset.key = ''; } else codeMod.renderRefs(box, key);
    };
    const timeWhy = whyNot([key]);
    const setEditable = (info) => {
      const can0 = editableOf(virtual, info), can = (k) => (k === 'shift' || k === 'stretch' ? !timeWhy : can0(k));
      for (const f of root.querySelectorAll('.field[data-k]')) {
        const ro = !can(f.dataset.k);
        f.classList.toggle('ro', ro);
        f.title = ro ? (f.dataset.k === 'shift' || f.dataset.k === 'stretch' ? timeWhy : RO_TIP) : '';
        for (const c of f.querySelectorAll('input, .zrow button')) { if (c.type === 'number' || c.type === 'text') c.readOnly = ro; else c.disabled = ro; }
      }
    };
    setEditable(null);
    codeOf(key, (info) => {
      if (root.dataset.el !== sig) return;
      setEditable(info);
      const n = q('#e-code-n'), regs = Array.isArray(info?.regions) ? info.regions : [];
      n.textContent = info?.marked ? `${regs.length} block${regs.length === 1 ? '' : 's'}` : regs.length ? 'traced' : '';
    });
  }
  q('#e-path').classList.toggle('on', isPinned(s.key));
  const t = tweakOf(s.key), has = S.draft.tweaks?.[s.key] || {};
  for (const k of NUM) q('#e-' + k).dataset.tw = r3(t[k]); // shown when the bridge has no actual values
  applyActual(root);
  q('#e-visible').checked = t.visible !== false;
  for (const k of ['shift', 'stretch']) { const i = q('#e-' + k); if (i.ownerDocument.activeElement !== i) i.value = r3(t[k] ?? (k === 'stretch' ? 1 : 0)); }
  const snd = soundsOfKeys([s.key]).length;
  q('#e-sounds').textContent = snd ? `${snd} linked sound${snd === 1 ? '' : 's'} · ${RT.linked ? 'follow the bar (Linked on)' : 'stay put (Linked off)'}` : '';
  q('#e-zv').textContent = t.z ? `z ${t.z > 0 ? '+' : ''}${t.z}` : 'z auto';
  const ti = q('#e-text');
  if (ti && ti.ownerDocument.activeElement !== ti) ti.value = t.text ?? '';
  for (const k of ['color', 'bg']) { const i = q('#e-' + k); if (i.ownerDocument.activeElement !== i) i.value = t[k] ?? '#000000'; i.style.opacity = t[k] ? 1 : 0.35; }
  for (const f of root.querySelectorAll('.field[data-k]')) f.classList.toggle('edited', f.dataset.k in has);
  q('#e-flag').hidden = !Object.keys(has).length;
  q('#e-reset').disabled = !Object.keys(has).length;
  return true;
}

/** Elements tab body. */
export function renderElementsTab(list) {
  if (!liveOn()) { list.innerHTML = '<div class="empty-list">Turn Live on (<kbd>L</kbd>) to list the scene\'s named elements.</div>'; return; }
  const els = L.elements, sel = getSel()?.key;
  list.innerHTML = els.length
    ? els.map((e) => `<div class="row elrow${sel === e.key ? ' sel' : ''}" data-k="${esc(e.key)}"><span class="t">${S.draft.tweaks?.[e.key] ? '<i class="dotc" style="--c:var(--primary)" title="tweaked"></i>' : ''}</span><span class="tx">${esc(e.key)}<small>${esc(e.label || '')}${S.draft.tweaks?.[e.key] ? ' · ' + esc(tweakSummary(S.draft.tweaks[e.key])) : ''}</small></span><span></span></div>`).join('')
    : '<div class="empty-list">No named elements in this scene.<br>Name them with <code>data-gfx</code> or <code>ctx.el()</code>; or click the picture with Select (<kbd>V</kbd>).</div>';
  for (const r of list.querySelectorAll('.elrow')) r.onclick = () => selectKey(r.dataset.k);
}
