// Time tweaks (docs/RETIME.md): `shift` (s), `stretch` (x), `pivot` (s) per element, an override layer like the other tweaks.
// local(t) = pivot + (t - pivot - shift) / stretch, composed with the named ancestors' maps (outermost first).
// Maps are affine { a, b }: local = a * t + b. Pure helpers (also used by tests) + the DOM scope capture used by elements.js.

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const STRETCH_MIN = 0.1;
export const STRETCH_MAX = 10;
export const IDENTITY = Object.freeze({ a: 1, b: 0 });

/** True when the tweak moves the element in time (shift != 0 or stretch != 1). A lone pivot is identity. */
export const hasTime = (tw) => !!tw && typeof tw === 'object' &&
  ((isNum(tw.shift) && tw.shift !== 0) || (isNum(tw.stretch) && tw.stretch > 0 && tw.stretch !== 1));

export const clampStretch = (k) => Math.min(STRETCH_MAX, Math.max(STRETCH_MIN, isNum(k) && k > 0 ? k : 1));

/** Own map of one tweak: scene (or parent-local) time -> element-local time. */
export function timeMap(tw) {
  if (!hasTime(tw)) return IDENTITY;
  const k = clampStretch(tw.stretch), s = isNum(tw.shift) ? tw.shift : 0, p = isNum(tw.pivot) ? tw.pivot : 0;
  return { a: 1 / k, b: p - (p + s) / k };
}
/** inner(outer(t)) */
export const compose = (outer, inner) => ({ a: inner.a * outer.a, b: inner.a * outer.b + inner.b });
export const invert = (f) => ({ a: 1 / f.a, b: -f.b / f.a });
export const at = (f, t) => f.a * t + f.b;
/** Tweak props for map f, keeping pivot p: stretch = 1/a, shift so that local(t) = a t + b. */
export function fromMap(f, p = 0) {
  const k = 1 / f.a;
  return { shift: (p - f.b) / f.a - p, stretch: k, pivot: p };
}

// ---------- DOM scope capture (auto retime of DOM elements) ----------
const textsOf = (e) => { const out = []; for (const c of e.childNodes) if (c.nodeType === 3) out.push(c.nodeValue); return out; };
const listOf = (scope) => [scope, ...scope.querySelectorAll('*')];

/** Every attribute + direct text node of every element in the scope (document order). */
export function capture(scope) {
  return listOf(scope).map((e) => {
    const attrs = [];
    for (const a of e.attributes) attrs.push([a.name, a.value]);
    return { tag: e.tagName, attrs, texts: textsOf(e) };
  });
}
/** Write a capture back; returns false (and writes nothing) when the scope's structure differs from the capture. */
export function write(scope, snap) {
  const els = listOf(scope);
  if (els.length !== snap.length) return false;
  for (let i = 0; i < els.length; i++) {
    if (els[i].tagName !== snap[i].tag) return false;
    let n = 0;
    for (const c of els[i].childNodes) if (c.nodeType === 3) n++;
    if (n !== snap[i].texts.length) return false;
  }
  for (let i = 0; i < els.length; i++) {
    const e = els[i], s = snap[i];
    const want = new Set(s.attrs.map((a) => a[0]));
    for (const a of [...e.attributes]) if (!want.has(a.name)) e.removeAttribute(a.name);
    for (const [name, v] of s.attrs) if (e.getAttribute(name) !== v) e.setAttribute(name, v);
    let j = 0;
    for (const c of e.childNodes) if (c.nodeType === 3) { if (c.nodeValue !== s.texts[j]) c.nodeValue = s.texts[j]; j++; }
  }
  return true;
}
