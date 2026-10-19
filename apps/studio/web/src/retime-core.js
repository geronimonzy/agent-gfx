// Retiming math for the studio (docs/RETIME.md), pure. The time map is the JS twin of runner/player/retime.js
// (retime-core.test.js checks they agree): local(t) = pivot + (t - pivot - shift) / stretch, affine { a, b } = a*t + b.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const STRETCH_MIN = 0.1, STRETCH_MAX = 10;
export const ID = Object.freeze({ a: 1, b: 0 });
export const hasTime = (tw) => !!tw && ((isNum(tw.shift) && tw.shift !== 0) || (isNum(tw.stretch) && tw.stretch > 0 && tw.stretch !== 1));
export function timeMap(tw) {
  if (!hasTime(tw)) return ID;
  const k = Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, isNum(tw.stretch) && tw.stretch > 0 ? tw.stretch : 1));
  const s = isNum(tw.shift) ? tw.shift : 0, p = isNum(tw.pivot) ? tw.pivot : 0;
  return { a: 1 / k, b: p - (p + s) / k };
}
/** inner(outer(t)) */
export const compose = (outer, inner) => ({ a: inner.a * outer.a, b: inner.a * outer.b + inner.b });
export const invert = (f) => ({ a: 1 / f.a, b: -f.b / f.a });
export const at = (f, t) => f.a * t + f.b;
const r4 = (v) => +v.toFixed(4);

/**
 * Map of the named ancestors only. `ancestors` = keys from the parent up to the root. Same fold as the player's mapOf
 * (runner/player/elements.js): the outermost ancestor's map applies first, local = parent(grandparent(t)).
 */
export function ancestorsMap(ancestors, tweakOf) {
  let f = ID;
  for (const k of ancestors) { const tw = tweakOf(k); if (hasTime(tw)) f = compose(timeMap(tw), f); }
  return f;
}
/** Display-time transforms: a move by delta, a stretch about `fixed` that takes `from` to `to`. */
export const moveBy = (delta) => ({ a: 1, b: delta });
export function stretchAbout(fixed, from, to) {
  const r = (to - fixed) / (from - fixed);
  return { a: r, b: fixed - fixed * r };
}
/**
 * New own time tweak so the element's content that showed at display time T now shows at A(T).
 * own = the element's own tweak, G = its ancestors' map, envStart = displayed start of its bar (sets a default pivot).
 * Returns { shift, stretch, pivot } with nulls for identity (removes the props), or null if the stretch would leave 0.1..10.
 */
export function retimeTweak(own, G, A, envStart = 0) {
  const f = timeMap(own);
  // f' = f ∘ G ∘ A⁻¹ ∘ G⁻¹ (all maps act on display / parent-local time, applied right to left)
  const fNew = compose(compose(compose(invert(G), invert(A)), G), f);
  const k = 1 / fNew.a;
  if (!(k >= STRETCH_MIN - 1e-9 && k <= STRETCH_MAX + 1e-9)) return null;
  const p = isNum(own?.pivot) ? own.pivot : r4(at(compose(G, f), envStart));
  const shift = (p - fNew.b) / fNew.a - p;
  const out = { shift: r4(shift), stretch: r4(k), pivot: p };
  if (Math.abs(out.stretch - 1) < 1e-4) out.stretch = null;
  if (Math.abs(out.shift) < 1e-4) out.shift = null;
  if (out.stretch === null) out.pivot = null; // with stretch 1 the shift does not depend on the pivot
  return out;
}

// ---------- sounds <-> elements (docs/RETIME.md §3) ----------
/** Element key a cue belongs to: explicit `el` ('' = unlinked), else by name (id === key or id starts with key + '-', longest wins). */
export function linkOf(cue, keys) {
  if (typeof cue.el === 'string') return cue.el || null;
  let best = null;
  for (const k of keys) if ((cue.id === k || cue.id.startsWith(k + '-')) && (!best || k.length > best.length)) best = k;
  return best;
}
export const linkKind = (cue) => (typeof cue.el === 'string' ? (cue.el ? 'explicit' : 'none') : 'name');
/** Cues linked to any key of `keySet` (the element and its named descendants). */
export const soundsOf = (cues, keySet, keys) => cues.filter((c) => { const k = linkOf(c, keys); return !!k && keySet.has(k); });
/** Cue times moved through the display transform A, clamped to 0..duration. */
export const mapCueTimes = (times, A, duration) => times.map(([id, t]) => [id, +Math.min(duration, Math.max(0, at(A, t))).toFixed(5)]);
/** Delta for a group move, limited so no cue leaves 0..duration. */
export function clampDelta(times, delta, duration) {
  let lo = -Infinity, hi = Infinity;
  for (const t of times) { lo = Math.max(lo, -t); hi = Math.min(hi, duration - t); }
  return Math.min(hi, Math.max(lo, delta));
}
/** Ids of cue hits inside a box (canvas px): hits = [{ id, x, lane: { top, h } }]. */
export function inBox(hits, x0, y0, x1, y1) {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0], [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  return [...new Set(hits.filter((h) => h.x >= l && h.x <= r && h.lane.top + h.lane.h > t && h.lane.top < b).map((h) => h.id))];
}
export function timingSummary(t) {
  const p = [];
  if (isNum(t.shift) && t.shift) p.push(`shift ${t.shift > 0 ? '+' : '−'}${Math.abs(t.shift).toFixed(2)} s`);
  if (isNum(t.stretch) && t.stretch !== 1) p.push(`stretch ${t.stretch.toFixed(2)}×`);
  return p.join(' · ');
}
