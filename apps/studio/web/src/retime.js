// Retiming by dragging (docs/RETIME.md §4): layer bar move / stretch -> time tweaks, linked sounds, cue multi-select.
// timeline.js routes the pointer here; the math lives in retime-core.js.
import { S, on, emit, commit, duration, cueById, patchCue, tweakOf, TIME_ID } from './store.js';
import { editTweak } from './live.js';
import { LY } from './layers.js';
import * as R from './retime-core.js';

const LINK_KEY = 'gfx-studio.retime.linked';
export const RT = { cues: new Set(), linked: localStorage.getItem(LINK_KEY) !== '0', preview: null };
let seq = 0;

// ---------- linked toggle ----------
export function toggleLinked() {
  RT.linked = !RT.linked;
  localStorage.setItem(LINK_KEY, RT.linked ? '1' : '0');
  emit('retime-linked');
  emit('toast', { m: RT.linked ? 'Linked: sounds follow their layer when you drag it' : 'Unlinked: dragging a layer moves only the picture', ms: 1800 });
}

// ---------- cue multi-select ----------
export const isCueSelected = (id) => S.sel.cue === id || (!!S.sel.cue && RT.cues.has(S.sel.cue) && RT.cues.has(id));
export const selectedCues = () => (!S.sel.cue ? [] : RT.cues.has(S.sel.cue) ? [...RT.cues] : [S.sel.cue]).filter((id) => cueById(id));
/** Replace the cue selection (primary = the cue the inspector focuses). */
export function setCueSelection(ids, primary = ids[ids.length - 1] ?? null) {
  RT.cues = new Set(ids);
  S.sel.cue = primary; S.sel.note = null;
  if (primary) S.lane = cueById(primary)?.stem || S.lane;
  emit('selection');
}
export function toggleCue(id) {
  const ids = selectedCues();
  if (ids.includes(id)) { const rest = ids.filter((x) => x !== id); setCueSelection(rest, rest.includes(S.sel.cue) ? S.sel.cue : rest[rest.length - 1] ?? null); }
  else setCueSelection([...ids, id], id);
}
export function selectLane(stem) {
  const ids = S.res.cues.filter((c) => c.stem === stem).map((c) => c.id);
  if (!ids.length) return;
  setCueSelection(ids, ids[0]);
  emit('toast', { m: `${ids.length} cues on ${stem} selected: drag one to shift the lane`, ms: 1800 });
}
/** Move cues from their drag-start times by delta (clamped so none leaves the scene), one undo step per `ck`. */
export function moveCues(t0, delta, ck) {
  const d = R.clampDelta([...t0.values()], delta, duration());
  for (const [id, t] of t0) patchCue(id, { t: +(t + d).toFixed(5) }, { key: ck, window: Infinity });
  return d;
}
export function shiftSelected(delta) {
  const ids = selectedCues();
  if (!ids.length || !Number.isFinite(delta) || !delta) return;
  moveCues(new Map(ids.map((id) => [id, cueById(id).t])), delta, 'shift-sel' + ++seq);
}

// ---------- layer links + support ----------
const parentOf = (k) => { const p = LY.byKey.get(k)?.parent; return p && LY.byKey.has(p) ? p : null; };
export const ancestorsOf = (k) => { const a = []; for (let p = parentOf(k); p; p = parentOf(p)) a.push(p); return a; };
export function subtreeOf(keys) {
  const out = new Set();
  const add = (k) => { if (out.has(k)) return; out.add(k); for (const c of LY.kids.get(k) || []) add(c.key); };
  keys.forEach(add);
  return out;
}
const layerKeys = () => new Set(LY.nodes.map((n) => n.key));
export const linkOfCue = (q) => R.linkOf(q, layerKeys());
/** Linked sounds of the element(s) and their named descendants. */
export const soundsOfKeys = (keys) => R.soundsOf(S.res?.cues || [], subtreeOf(keys), layerKeys());
/** null = retimable; else why not. */
export function whyNot(keys) {
  for (const k of keys) if (LY.byKey.get(k)?.retime === 'none') return `"${k}" is drawn by code that does not read its time through ctx.clock("${k}"), so it can't be retimed by dragging`;
  return null;
}
/**
 * Set a cue's element link: key, '' (unlinked) or null (by name). A base cue with an explicit link from the scene /
 * sound.json gets an explicit `el: null` override (by name); otherwise null just drops the draft override.
 */
export function setCueLink(id, el) {
  commit((d) => {
    const add = d.add.find((a) => a.id === id);
    if (add) { if (el === null) delete add.el; else add.el = el; return; }
    const base = S.baseById.get(id);
    if (!base) return;
    const o = { ...(d.cues[id] || {}) };
    if (el === base.el || (el === null && typeof base.el !== 'string')) delete o.el; else o.el = el;
    if (Object.keys(o).length) d.cues[id] = o; else delete d.cues[id];
  });
}

// ---------- layer drag ----------
const timeOf = (tw) => ({ shift: tw?.shift, stretch: tw?.stretch, pivot: tw?.pivot });
/** The time tweak the Live picture shows for a key (file only in Original, file + draft in Draft). */
const shownTweak = (k) => (S.mode === 'draft' ? tweakOf(k) : { ...TIME_ID, ...(S.fileTweaks[k] || {}) });
const envOf = (spans) => (spans?.length ? [spans[0][0], spans[spans.length - 1][1]] : null);

/** Tweak patch for a typed Shift / Stretch (inspector): a new stretch keeps the content at the bar's start in place. */
export function timingPatch(key, prop, v) {
  if (prop === 'shift') return { shift: v };
  const tw = shownTweak(key);
  // an existing pivot (or a hand-written stretch without one) stays; else pivot = the content time at the bar's start,
  // which (stretch 1, shift s) shows at pivot + s and keeps showing there with any stretch
  if (Number.isFinite(tw.pivot) || (Number.isFinite(tw.stretch) && tw.stretch !== 1)) return { stretch: v };
  const F = R.compose(R.ancestorsMap(ancestorsOf(key), shownTweak), R.timeMap(tw));
  return { stretch: v, pivot: +R.at(F, envOf(LY.spans[key])?.[0] ?? 0).toFixed(4) };
}

export function beginLayerDrag(row) {
  const keys = row.keys;
  const sub = subtreeOf(keys);
  const spans0 = new Map([...sub].map((k) => [k, (LY.spans[k] || []).map((s) => s.slice())]));
  const st = { keys, ck: 'retime' + ++seq, tw0: new Map(), G: new Map(), env: new Map(), spans0, sub, cues0: [] };
  for (const k of keys) {
    st.tw0.set(k, timeOf(shownTweak(k)));
    st.G.set(k, R.ancestorsMap(ancestorsOf(k), shownTweak));
    st.env.set(k, envOf(LY.spans[k])?.[0] ?? 0);
  }
  if (RT.linked) st.cues0 = soundsOfKeys(keys).map((c) => [c.id, c.t]);
  return st;
}
/** Apply display transform A (old display time -> new) to the dragged layers (+ linked sounds). false = refused (stretch limits). */
export function updateLayerDrag(st, A) {
  const next = [];
  for (const k of st.keys) {
    const tw = R.retimeTweak(st.tw0.get(k), st.G.get(k), A, st.env.get(k));
    if (!tw) return false;
    // identity over a non-identity file value must be explicit (null would fall back to the file's)
    const file = S.fileTweaks[k] || {};
    for (const p of ['shift', 'stretch']) if (tw[p] === null && file[p] != null && file[p] !== TIME_ID[p]) tw[p] = TIME_ID[p];
    if (tw.pivot === null && file.pivot != null && (tw.shift != null || tw.stretch != null)) tw.pivot = file.pivot;
    next.push([k, tw]);
  }
  for (const [k, tw] of next) editTweak(k, tw, { key: st.ck, window: Infinity });
  for (const [id, t] of R.mapCueTimes(st.cues0, A, duration())) patchCue(id, { t }, { key: st.ck, window: Infinity });
  RT.preview = { keys: st.sub, A, spans0: st.spans0, done: false };
  return true;
}
export function endLayerDrag(st) {
  if (RT.preview) RT.preview.done = true;
  const n = st.cues0.length;
  if (n) emit('toast', { m: `${n} linked sound${n === 1 ? '' : 's'} moved with ${st.keys.length > 1 ? 'the group' : st.keys[0]}`, ms: 1600 });
}
/** Spans to draw for a row while its retime is being previewed (until the next fresh span mapping). */
export function previewSpans(row) {
  const p = RT.preview;
  if (!p || !row.keys.some((k) => p.keys.has(k))) return null;
  const d = duration(), all = [];
  for (const k of row.keys) for (const [a, b] of p.spans0.get(k) || []) all.push([Math.max(0, R.at(p.A, a)), Math.min(d, R.at(p.A, b))]);
  all.sort((x, y) => x[0] - y[0]);
  const out = [];
  for (const s of all) { const l = out[out.length - 1]; if (l && s[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], s[1]); else out.push(s); }
  return out;
}

export function initRetime() {
  on('selection', () => {
    if (!S.sel.cue) { RT.cues.clear(); return; }
    if (!RT.cues.has(S.sel.cue)) RT.cues = new Set([S.sel.cue]);
  });
  on('draft', () => { for (const id of [...RT.cues]) if (!cueById(id)) RT.cues.delete(id); });
  on('scene', () => { RT.cues.clear(); RT.preview = null; });
  on('layer-spans', (fresh) => { if (fresh && RT.preview?.done) { RT.preview = null; emit('layers'); } });
}
