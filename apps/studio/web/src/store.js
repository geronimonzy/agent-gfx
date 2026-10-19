import { tok } from './theme.js';
// App state, draft model with undo/redo, and the draft -> resolved cues pipeline (same semantics as `gfx audio`).
import { resolveCues, defaultStem, SOUND_NAMES } from '@sfx';

const handlers = new Map();
export const on = (ev, fn) => { (handlers.get(ev) || handlers.set(ev, new Set()).get(ev)).add(fn); return () => handlers.get(ev).delete(fn); };
export const emit = (ev, a) => { const h = handlers.get(ev); if (h) for (const fn of [...h]) fn(a); };

const STEM_TOKENS = { hits: '--stem-hits', motion: '--stem-motion', ui: '--stem-ui', accents: '--stem-accents', voice: '--stem-note' };
const EXTRA = ['--stem-extra-1', '--stem-extra-2', '--stem-extra-3', '--stem-extra-4'];
const stemToken = (n) => STEM_TOKENS[n] || EXTRA[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % EXTRA.length];
export const stemColor = (n) => tok(stemToken(n));
export const stemStyle = (n) => `var(${stemToken(n)})`;
export let NOTE_COLOR = tok('--stem-note');
window.addEventListener('theme', () => { NOTE_COLOR = tok('--stem-note'); });
export { SOUND_NAMES };
export const defaultSoundFor = (stem) => SOUND_NAMES.find((s) => defaultStem(s) === stem) || 'click';

export const emptyDraft = () => ({ stems: {}, cues: {}, add: [], tweaks: {} });

export const S = {
  root: '', scenes: [], name: null, meta: null,
  base: null, baseById: new Map(), baseRes: null, soundFix: null,
  fileTweaks: {}, draft: emptyDraft(), savedJson: '', res: null, stemOrder: [],
  sel: { cue: null, note: null }, lane: null, mode: 'original',
  view: { start: 0, pps: 60 }, loop: { on: false, a: 0, b: 0 }, rate: 1,
  mon: {}, // stem -> { vol(dB), mute, solo }  (monitoring only)
  synth: { busy: false, runs: 0, last: 0 },
  disk: { cues: 0, mp4: 0, changed: false },
  codeBand: null, // { t0, t1 } seconds: animated code ref hovered (Code workspace), drawn on the timeline
  loading: false,
};

export const fps = () => S.meta?.fps || 60;
export const duration = () => S.meta?.duration || 0;
export const snapT = (t, snap = true) => (snap ? Math.round(t * fps()) / fps() : t);
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const r3 = (x) => +(+x).toFixed(3);
export const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Per-scene view state (layers / paths / tracks) in localStorage; reads never throw.
/** Hydrate per-scene view state: apply(json) runs only for a saved object; malformed state is ignored (returns false). */
export function readView(key, apply) {
  try {
    const j = JSON.parse(localStorage.getItem(key) || 'null');
    if (!j || typeof j !== 'object') return false;
    apply(j);
    return true;
  } catch (e) { console.warn(`ignoring saved view state ${key}:`, e.message); return false; }
}
export function writeView(key, value) { if (S.name) localStorage.setItem(key, JSON.stringify(value)); }

// ---------- draft resolution ----------
function stemCfg(draftStems) {
  const stems = {};
  for (const k of new Set([...Object.keys(S.base.stems), ...Object.keys(draftStems)])) stems[k] = { gain: 0, mute: false, ...(S.base.stems[k] || {}), ...(draftStems[k] || {}) };
  return stems;
}
function resolveWith(draft) {
  // cues.json cues are already resolved; stemAuto is lost on write, so re-derive it: a stem equal to the sound's default is "auto".
  const cues = S.base.cues.map((c) => ({ ...c, stemAuto: c.stem === defaultStem(c.sound) }));
  const add = draft.add.filter((a) => Number.isFinite(a.t) && defaultStem(a.sound));
  try { return resolveCues(cues, { cues: draft.cues, add, stems: stemCfg(draft.stems) }); }
  catch (e) { console.warn('resolve failed', e); return S.res || resolveCues(cues, { stems: S.base.stems }); }
}
export function resolveDraft() {
  S.res = resolveWith(S.draft);
  const names = new Set([...Object.keys(S.base.stems), ...S.res.cues.map((c) => c.stem)]);
  const order = ['hits', 'motion', 'ui', 'accents'];
  S.stemOrder = [...order.filter((n) => names.has(n)), ...[...names].filter((n) => !order.includes(n) && n !== 'voice').sort(), ...(names.has('voice') ? ['voice'] : [])];
  for (const n of S.stemOrder) S.mon[n] ||= { vol: 0, mute: false, solo: false };
}
export function setBase(base) {
  S.base = base;
  S.baseById = new Map(base.cues.map((c) => [c.id, c]));
  S.baseRes = resolveWith(emptyDraft());
}

/** Per-stem signature: what determines the synthesized audio of the stem. */
export function stemSig(res, name) {
  const cfg = res.stems[name] || {};
  const cs = res.cues.filter((c) => c.stem === name).map((c) => [c.id, c.t, c.sound, c.gain, c.pan, c.pitch, c.dur ?? null, !!c.mute, c.src ?? null, c.start ?? null, c.rate ?? null, c.intensity ?? null, c.variant ?? null, c.env ?? null, c.attack ?? null, c.decay ?? null, c.bright ?? null, c.reverb ?? null, c.seed ?? null]);
  return JSON.stringify([cfg.gain || 0, !!cfg.mute, cs]);
}

const editCount = () => Object.keys(S.draft.cues).length + S.draft.add.length + Object.keys(S.draft.stems).length + Object.keys(S.draft.tweaks || {}).length;
export const hasEdits = () => editCount() > 0;
export const isAdded = (id) => S.draft.add.some((a) => a.id === id);
export const cueById = (id) => S.res?.cues.find((c) => c.id === id) || null;

// ---------- history ----------
const undoStack = [], redoStack = [];
let lastKey = null, lastTime = 0;
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
export function clearHistory() { undoStack.length = 0; redoStack.length = 0; lastKey = null; }

function afterChange() {
  resolveDraft();
  if (S.sel.cue && !cueById(S.sel.cue)) S.sel.cue = null;
  if (!hasEdits() && S.mode === 'draft') S.mode = 'original';
  emit('draft');
}
/**
 * Apply fn(draft) as one undoable step. opts.key coalesces consecutive commits with the same key
 * (opts.window ms; Infinity = until another key is used, for drags).
 */
export function commit(fn, { key = null, window: win = 700 } = {}) {
  const before = JSON.stringify(S.draft);
  const hadEdits = hasEdits();
  fn(S.draft);
  if (JSON.stringify(S.draft) === before) return false;
  const now = performance.now();
  if (!(key && key === lastKey && now - lastTime < win)) { undoStack.push(before); if (undoStack.length > 300) undoStack.shift(); }
  redoStack.length = 0;
  lastKey = key; lastTime = now;
  if (!hadEdits && hasEdits() && S.mode === 'original') { S.mode = 'draft'; emit('mode'); }
  afterChange();
  return true;
}
function restore(json) { S.draft = { ...emptyDraft(), ...JSON.parse(json) }; lastKey = null; afterChange(); }
export function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(S.draft)); restore(undoStack.pop()); }
export function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(S.draft)); restore(redoStack.pop()); }

// ---------- draft edits ----------
const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b);
/** Patch a cue: stored as a sparse override against cues.json (or edited in place for added cues). */
export function patchCue(id, patch, opts) {
  return commit((d) => {
    const add = d.add.find((a) => a.id === id);
    if (add) { Object.assign(add, patch); return; }
    const base = S.baseById.get(id);
    if (!base) return;
    const o = { ...(d.cues[id] || {}) };
    for (const [k, v] of Object.entries(patch)) {
      const bv = k === 'mute' ? !!base.mute : base[k];
      if (same(v, bv)) delete o[k]; else o[k] = v;
    }
    if (Object.keys(o).length) d.cues[id] = o; else delete d.cues[id];
  }, opts);
}
export function resetCue(id) {
  commit((d) => { delete d.cues[id]; });
}
export function removeCue(id) {
  if (isAdded(id)) { commit((d) => { d.add = d.add.filter((a) => a.id !== id); }); return; }
  const c = cueById(id);
  if (c) patchCue(id, { mute: !c.mute });
}
export function addCue(stem, t, sound = defaultSoundFor(stem)) {
  let n = 1;
  const ids = new Set([...S.baseById.keys(), ...S.draft.add.map((a) => a.id)]);
  while (ids.has(`new-${n}`)) n++;
  const id = `new-${n}`;
  const item = { id, t: +t.toFixed(4), sound, gain: 0 };
  if (defaultStem(sound) !== stem) item.stem = stem;
  commit((d) => { d.add.push(item); });
  return id;
}
export function setStemDraftGain(stem, gain) {
  commit((d) => {
    const base = S.base.stems[stem]?.gain || 0;
    if (same(gain, base)) { if (d.stems[stem]) { delete d.stems[stem].gain; if (!Object.keys(d.stems[stem]).length) delete d.stems[stem]; } }
    else d.stems[stem] = { ...(d.stems[stem] || {}), gain };
  });
}

// ---------- element tweaks (docs/REVIEW.md §3): key -> { x, y, scale, rotate, opacity, text, color, bg }, identity values retained when cancelling file tweaks ----------
export const TWEAK_ID = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
export const TIME_ID = { shift: 0, stretch: 1 }; // + pivot (s); docs/RETIME.md
function cleanTweak(o, file = {}) {
  const r = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v == null) continue;
    if (k in TWEAK_ID) { if (!Number.isFinite(v)) continue;
      if (same(v, TWEAK_ID[k]) && same(file[k] ?? TWEAK_ID[k], TWEAK_ID[k])) continue; }
    else if (k === 'text') { if (typeof v !== 'string') continue; }
    else if (k === 'color' || k === 'bg') { if (!v) continue; }
    else if (k === 'visible') { if (v !== false && file.visible !== false) continue; if (typeof v !== 'boolean') continue; }
    else if (k === 'z') { if (!Number.isFinite(v)) continue; }
    else if (k in TIME_ID) { if (!Number.isFinite(v)) continue; // time tweaks (docs/RETIME.md)
      if (same(v, TIME_ID[k]) && same(file[k] ?? TIME_ID[k], TIME_ID[k])) continue; }
    else if (k === 'pivot') { if (!Number.isFinite(v)) continue; }
    else continue;
    r[k] = v;
  }
  if ('pivot' in r && !('shift' in r) && !('stretch' in r) && file.pivot === undefined) delete r.pivot; // a lone pivot is identity
  return r;
}
/** Effective tweak: draft overrides file overrides identity defaults. */
export const tweakOf = (key) => ({ ...TWEAK_ID, visible: true, z: 0, ...(S.fileTweaks[key] || {}), ...(S.draft.tweaks?.[key] || {}) });
/** Merge `patch` into the key's tweak (null removes an override; identity cancels a non-identity file value; an empty tweak removes the key). */
export function patchTweak(key, patch, opts) {
  return commit((d) => {
    d.tweaks ||= {};
    const o = cleanTweak({ ...(d.tweaks[key] || {}), ...patch }, S.fileTweaks[key]);
    if (Object.keys(o).length) d.tweaks[key] = o; else delete d.tweaks[key];
  }, opts);
}
export const resetTweak = (key) => commit((d) => { if (d.tweaks) delete d.tweaks[key]; });
const sg = (v, n = 0) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(n).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
export function tweakSummary(t) {
  const p = [];
  if (t.x != null) p.push('x ' + sg(t.x, 1));
  if (t.y != null) p.push('y ' + sg(t.y, 1));
  if (t.scale != null) p.push('scale ' + t.scale.toFixed(2));
  if (t.rotate != null) p.push('rot ' + sg(t.rotate, 1) + '°');
  if (t.opacity != null) p.push('opacity ' + t.opacity.toFixed(2));
  if (t.text != null) p.push('text "' + (t.text.length > 20 ? t.text.slice(0, 19) + '…' : t.text) + '"');
  if (t.color) p.push('color ' + t.color);
  if (t.bg) p.push('bg ' + t.bg);
  if (t.visible === false) p.push('hidden in output');
  if (t.z != null) p.push('z ' + (t.z > 0 ? '+' : '') + t.z);
  if (t.shift != null && t.shift !== 0) p.push('shift ' + sg(t.shift, 2) + ' s');
  if (t.stretch != null && t.stretch !== 1) p.push('stretch ' + t.stretch.toFixed(2) + '×');
  return p.join(' · ');
}

// ---------- (de)serialization ----------
export function serializeDraft() {
  const d = S.draft;
  return { version: 1, scene: S.name, base: { cuesMtime: S.disk.cues }, stems: d.stems, cues: d.cues, add: d.add, tweaks: d.tweaks || {} };
}
const stableJson = () => { const s = serializeDraft(); return JSON.stringify({ ...s, base: null }); };
export const markSaved = () => { S.savedJson = stableJson(); emit('dirty'); };
// Only the open scene's lanes count (what Save draft folds): S.mon outlives scene switches, and a volume left on another scene's
// stem could never be saved here. No scene open = nothing to save (S.savedJson is '' until the first scene loads).
const monVol = () => S.stemOrder.filter((n) => S.mon[n]?.vol);
export const isDirty = () => !!S.name && (stableJson() !== S.savedJson || monVol().length > 0);
/** Human-readable list of what differs from the last load / Save draft (the "draft changed on disk" dialog). */
export function unsavedChanges() {
  let saved = {};
  try { saved = JSON.parse(S.savedJson || '{}') || {}; } catch { /* nothing saved */ }
  const d = S.draft, out = [], J = JSON.stringify;
  const keys = (a, b) => [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  for (const k of keys(saved.tweaks, d.tweaks)) if (J(saved.tweaks?.[k]) !== J(d.tweaks?.[k])) out.push(`${k}: ${d.tweaks?.[k] ? tweakSummary(d.tweaks[k]) : 'tweak removed'}`);
  for (const id of keys(saved.cues, d.cues)) if (J(saved.cues?.[id]) !== J(d.cues?.[id])) out.push(`cue ${id}: ${d.cues[id] ? 'edited' : 'edit removed'}`);
  const sAdd = new Map((saved.add || []).map((a) => [a.id, J(a)])), dAdd = new Map(d.add.map((a) => [a.id, J(a)]));
  for (const id of keys(Object.fromEntries(sAdd), Object.fromEntries(dAdd))) if (sAdd.get(id) !== dAdd.get(id)) out.push(`cue ${id}: ${!dAdd.has(id) ? 'removed' : sAdd.has(id) ? 'edited' : 'added'}`);
  for (const n of keys(saved.stems, d.stems)) if (J(saved.stems?.[n]) !== J(d.stems?.[n])) out.push(`stem ${n}: ${d.stems[n] ? Object.entries(d.stems[n]).map(([k, v]) => `${k} ${v}`).join(' · ') : 'edit removed'}`);
  for (const n of monVol()) out.push(`${n} lane volume ${S.mon[n].vol > 0 ? '+' : ''}${S.mon[n].vol} dB (not in the draft yet)`);
  return out;
}
export function loadDraft(text) {
  S.draft = emptyDraft();
  if (text) {
    try {
      const j = JSON.parse(text);
      S.draft = { stems: j.stems || {}, cues: j.cues || {}, add: j.add || [], tweaks: j.tweaks || {} }; // legacy `notes` are migrated to comments.json by comments.js
    } catch (e) { console.warn('bad draft.json', e); }
  }
  clearHistory();
}
