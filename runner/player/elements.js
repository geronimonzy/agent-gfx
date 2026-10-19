// Element registry, picking and tweak application (docs/REVIEW.md §3). Used by core.js for every scene.
// Tweaks are an override layer applied after every render(t): pure function of (what the scene just drew, tweaks).
// Time tweaks (shift/stretch/pivot, docs/RETIME.md) are resolved by core.js's drawFrame through retimePlan/retimeWrite.
import { hasTime, timeMap, compose, at, capture, write } from './retime.js';

const IDENT = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isIdentity = (tw) =>
  !tw || (!(isNum(tw.x) && tw.x !== 0) && !(isNum(tw.y) && tw.y !== 0) && !(isNum(tw.scale) && tw.scale !== 1) &&
    !(isNum(tw.rotate) && tw.rotate !== 0) && !(isNum(tw.opacity) && tw.opacity !== 1) &&
    typeof tw.text !== 'string' && !tw.color && !tw.bg && tw.visible !== false && !isNum(tw.z));

export function createRegistry({ root, meta }) {
  const keyNode = new Map(); // named key -> element
  const nodeKey = new WeakMap(); // element -> named key
  const boundsObjs = new Map(); // key -> { bounds(t) }
  const used = new Set();
  const warnings = [];
  const warned = new Set();
  let setupOpen = true;
  let curT = 0;
  let fileTweaks = {};
  let liveTweaks = {};
  let effective = {};
  let view = { hidden: [], solo: null }; // view-only overrides (docs/REVIEW.md §6), never saved
  let sampling = false; // spans sampling: ignore `visible` tweaks and the view layer
  const touched = new Map(); // element -> Map(prop -> { base, wrote, baseNum? })
  const clocked = new Set(); // keys whose scene code reads its own time through ctx.clock(name)
  let retimed = []; // [scope, scene's own capture at t] written over by the retime layer this frame
  let anyTime = false; // effective layer has a time tweak

  const warn = (msg) => { if (warned.has(msg)) return; warned.add(msg); warnings.push(msg); console.warn('[gfx] ' + msg); };

  function uniqueName(name) {
    let k = String(name);
    if (!used.has(k)) return k;
    let i = 2;
    while (used.has(`${name}~${i}`)) i++;
    k = `${name}~${i}`;
    warn(`duplicate element name "${name}" -> "${k}"`);
    return k;
  }
  function claim(node, name) {
    if (nodeKey.has(node)) return nodeKey.get(node);
    const k = uniqueName(name);
    used.add(k); keyNode.set(k, node); nodeKey.set(node, k);
    if (node.getAttribute('data-gfx') !== k) node.setAttribute('data-gfx', k);
    return k;
  }
  /** Register every `[data-gfx]` element not seen yet (document order). */
  function scan() {
    for (const n of root.querySelectorAll('[data-gfx]')) {
      if (nodeKey.has(n)) continue;
      const name = n.getAttribute('data-gfx');
      if (!name || name.startsWith('@')) { warn(`invalid data-gfx name "${name}" (empty or starting with @)`); continue; }
      claim(n, name);
    }
  }

  /** ctx.el(name, nodeOrBoundsObj): setup-only. */
  function el(name, target) {
    if (!setupOpen) throw new Error('ctx.el() may only be called during setup()');
    if (!name || String(name).startsWith('@')) throw new Error(`ctx.el(): invalid name "${name}"`);
    if (typeof Element !== 'undefined' && target instanceof Element) { claim(target, name); return target; }
    if (target && typeof target.bounds === 'function') {
      const k = uniqueName(name);
      used.add(k); boundsObjs.set(k, target);
      return target;
    }
    throw new Error('ctx.el(): target must be a DOM element or { bounds(t) => { x, y, w, h } }');
  }
  const endSetup = () => { setupOpen = false; scan(); };
  /** ctx.clock(name): setup-only; returns (t) => the element's local time (its time tweaks, composed with its named ancestors'). */
  function clock(name) {
    if (!setupOpen) throw new Error('ctx.clock() may only be called during setup()');
    if (!name || String(name).startsWith('@')) throw new Error(`ctx.clock(): invalid name "${name}"`);
    const k = String(name);
    clocked.add(k);
    return (t) => localTime(k, t);
  }
  /** Provenance helpers (bridge `code` / `codeAt` only): the element for a named or fallback key, and the topmost named elements in/at `el`. */
  const nodeOf = (key) => resolve(key);
  function keysIn(n) {
    scan();
    const k = nodeKey.get(n);
    if (k) return [k];
    return [...n.children].flatMap(keysIn);
  }

  // ---------- keys / labels ----------
  function pathKey(n) {
    const idx = [];
    for (let c = n; c && c !== root; c = c.parentElement) {
      if (!c.parentElement) return null;
      idx.push(Array.prototype.indexOf.call(c.parentElement.children, c));
    }
    return '@' + idx.reverse().join('/');
  }
  const keyOf = (n) => nodeKey.get(n) || pathKey(n);
  function resolve(key) {
    if (typeof key !== 'string') return null;
    if (key[0] === '@') {
      let n = root;
      for (const s of key.slice(1).split('/')) {
        n = n.children[+s];
        if (!n) return null;
      }
      return n === root ? null : n;
    }
    return keyNode.get(key) || null;
  }
  function labelOf(n) {
    const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/)[0] : (n.getAttribute && n.getAttribute('class') || '').trim().split(/\s+/)[0];
    const tag = n.tagName.toLowerCase();
    const txt = (n.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    return tag + (cls ? '.' + cls : '') + (txt ? ` "${txt}"` : '');
  }
  const canText = (n) => n.childNodes.length === 1 && n.firstChild.nodeType === 3;

  // ---------- geometry (scene px) ----------
  const rootScale = () => {
    const r = root.getBoundingClientRect();
    return { r, sx: r.width / meta.width || 1, sy: r.height / meta.height || 1 };
  };
  /** Own box, or for size-less wrappers (abspos children only) the union of the descendants' boxes. */
  function clientRect(n) {
    const b = n.getBoundingClientRect();
    if (b.width || b.height || !n.firstElementChild) return b;
    let l = Infinity, t = Infinity, r = -Infinity, bt = -Infinity;
    for (const c of n.querySelectorAll('*')) {
      const q = c.getBoundingClientRect();
      if (!q.width && !q.height) continue;
      l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); bt = Math.max(bt, q.bottom);
    }
    return l === Infinity ? b : { left: l, top: t, width: r - l, height: bt - t };
  }
  function rectScene(n, rs = rootScale()) {
    const b = clientRect(n);
    return { x: (b.left - rs.r.left) / rs.sx, y: (b.top - rs.r.top) / rs.sy, w: b.width / rs.sx, h: b.height / rs.sy };
  }
  const round2 = (b) => ({ x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.w.toFixed(2), h: +b.h.toFixed(2) });
  function boundsOf(key) {
    const bo = boundsObjs.get(key);
    if (bo) { const b = bo.bounds(boxT(key)); return b ? round2(b) : null; }
    const n = resolve(key);
    return n ? round2(rectScene(n)) : null;
  }
  function rotOf(n) {
    let deg = 0;
    for (let c = n; c && c !== root; c = c.parentElement) {
      const cs = getComputedStyle(c);
      if (cs.transform && cs.transform !== 'none') { const m = new DOMMatrix(cs.transform); deg += Math.atan2(m.b, m.a) * 180 / Math.PI; }
      const r = parseFloat(cs.rotate);
      if (cs.rotate && cs.rotate !== 'none' && Number.isFinite(r)) deg += r;
    }
    return +deg.toFixed(2);
  }
  function entry(key, n) {
    return { key, label: labelOf(n), bounds: round2(rectScene(n)), named: key[0] !== '@', text: canText(n), rot: rotOf(n) };
  }

  function hidden(n, memo) {
    if (memo.has(n)) return memo.get(n);
    let h = false;
    if (n !== root) {
      const cs = getComputedStyle(n);
      h = cs.opacity === '0' || cs.visibility === 'hidden' || (n.parentElement && hidden(n.parentElement, memo));
    }
    memo.set(n, h);
    return h;
  }
  function pick(x, y) {
    scan();
    const rs = rootScale();
    const cx = rs.r.left + x * rs.sx;
    const cy = rs.r.top + y * rs.sy;
    const stack = [];
    const seen = new Set();
    const boxes = [...boundsObjs.entries()].reverse();
    for (const [key, bo] of boxes) {
      const b = bo.bounds(boxT(key));
      if (b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        stack.push({ key, label: key, bounds: round2(b), named: true, text: false, rot: 0 });
        seen.add(key);
      }
    }
    const memo = new Map();
    const hit = document.elementsFromPoint(cx, cy).find((e) => e !== root && root.contains(e) && !hidden(e, memo));
    for (let n = hit; n && n !== root; n = n.parentElement) {
      const key = keyOf(n);
      if (key && !seen.has(key)) { seen.add(key); stack.push(entry(key, n)); }
    }
    return { stack };
  }
  function bounds(keys) {
    scan();
    const out = {};
    for (const k of keys || []) { const b = boundsOf(k); if (b) out[k] = b; }
    return out;
  }
  /** [key, element] of named DOM elements still in the scene, document order. */
  const domEntries = () => [...keyNode.entries()].filter(([, n]) => root.contains(n))
    .sort((a, b) => (a[1].compareDocumentPosition(b[1]) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  function elements() {
    scan();
    return [
      ...domEntries().map(([key, n]) => ({ key, label: labelOf(n) })),
      ...[...boundsObjs.keys()].map((key) => ({ key, label: key })),
    ];
  }

  // ---------- tweaks ----------
  function recompute() {
    effective = {};
    for (const layer of [fileTweaks, liveTweaks]) {
      for (const [k, tw] of Object.entries(layer || {})) {
        if (!tw || typeof tw !== 'object') continue;
        effective[k] = { ...(effective[k] || {}), ...tw };
      }
    }
    anyTime = Object.values(effective).some(hasTime);
  }
  const asObject = (obj) => (obj && typeof obj === 'object' ? obj : {});
  function setFile(obj) { fileTweaks = asObject(obj); recompute(); }
  function setLive(obj) { liveTweaks = asObject(obj); recompute(); }
  const tweak = (name) => ({ ...IDENT, ...(effective[name] || {}) });
  const signature = () => JSON.stringify([fileTweaks, liveTweaks]);
  function setView(v) {
    const o = asObject(v);
    view = { hidden: Array.isArray(o.hidden) ? o.hidden.filter((k) => typeof k === 'string') : [], solo: typeof o.solo === 'string' && o.solo ? o.solo : null };
  }

  const depth = (n) => { let d = 0; for (let c = n; c; c = c.parentElement) d++; return d; };

  /** Own an inline style prop: remember what the scene wrote (base) vs. what we wrote, so nothing compounds. */
  function own(rec, n, prop, value, baseFn) {
    const st = n.style;
    const cur = st[prop];
    let o = rec.get(prop);
    if (!o) { o = { base: cur, wrote: null }; rec.set(prop, o); if (baseFn) o.baseNum = baseFn(n, cur); }
    else if (o.wrote === null || cur !== o.wrote) { o.base = cur; if (baseFn) o.baseNum = baseFn(n, cur); }
    st[prop] = typeof value === 'function' ? value(o) : value;
    o.wrote = st[prop];
  }
  function ownText(rec, n, value) {
    const cur = n.textContent;
    let o = rec.get('text');
    if (!o) { o = { base: cur, wrote: null }; rec.set('text', o); }
    else if (o.wrote === null || cur !== o.wrote) o.base = cur;
    if (n.textContent !== value) n.textContent = value;
    o.wrote = n.textContent;
  }
  function release(rec, n, prop) {
    const o = rec.get(prop);
    if (!o) return;
    if (prop === 'text') { if (n.textContent === o.wrote) n.textContent = o.base; }
    else if (n.style[prop] === o.wrote) n.style[prop] = o.base;
    rec.delete(prop);
  }
  const opacityBase = (n, cur) => parseFloat(cur !== '' ? cur : getComputedStyle(n).opacity);

  /** Linear part of translate*rotate*scale*transform for an element (parent-local -> its parent's space). */
  function linear(n) {
    const cs = getComputedStyle(n);
    let m = new DOMMatrix();
    if (cs.rotate && cs.rotate !== 'none') { const a = parseFloat(cs.rotate.split(' ').pop()); if (Number.isFinite(a)) m = m.rotate(a); }
    if (cs.scale && cs.scale !== 'none') { const s = cs.scale.split(' ').map(parseFloat); m = m.scale(s[0], s.length > 1 ? s[1] : s[0]); }
    if (cs.transform && cs.transform !== 'none') m = m.multiply(new DOMMatrix(cs.transform));
    return m;
  }
  /** Accumulated linear map from the element's parent space to scene px (root excluded). */
  function ancestorLinear(n) {
    const chain = [];
    for (let c = n.parentElement; c && c !== root; c = c.parentElement) chain.push(c);
    let acc = new DOMMatrix();
    for (let i = chain.length - 1; i >= 0; i--) acc = acc.multiply(linear(chain[i]));
    return acc;
  }
  /** Visual centre of n in its own parent space, relative to its transform-origin, after its own `transform`. */
  function centreOffset(n) {
    const cs = getComputedStyle(n);
    const [ox, oy] = cs.transformOrigin.split(' ').map(parseFloat);
    let cx, cy;
    if (n.offsetWidth !== undefined && n.offsetParent !== undefined && !(n instanceof SVGElement)) { cx = n.offsetWidth / 2; cy = n.offsetHeight / 2; }
    else if (n.getBBox) { try { const b = n.getBBox(); cx = b.x + b.width / 2; cy = b.y + b.height / 2; } catch { cx = ox; cy = oy; } }
    else { cx = ox; cy = oy; }
    const M = cs.transform && cs.transform !== 'none' ? new DOMMatrix(cs.transform) : new DOMMatrix();
    const dx = cx - (ox || 0), dy = cy - (oy || 0);
    // v = M(d): where the centre sits relative to the origin after the element's own transform
    return { vx: M.a * dx + M.c * dy + M.e, vy: M.b * dx + M.d * dy + M.f };
  }

  function applyOne(n, tw, rec, hide) {
    const want = new Set();
    const x = isNum(tw.x) ? tw.x : 0, y = isNum(tw.y) ? tw.y : 0;
    const sc = isNum(tw.scale) ? tw.scale : 1, rot = isNum(tw.rotate) ? tw.rotate : 0;
    if (x || y || sc !== 1 || rot) {
      let tx = 0, ty = 0;
      if (x || y) {
        const L = ancestorLinear(n);
        const det = L.a * L.d - L.b * L.c;
        if (Math.abs(det) > 1e-9) { tx = (L.d * x - L.c * y) / det; ty = (-L.b * x + L.a * y) / det; }
      }
      if (sc !== 1 || rot) {
        // rotate/scale about the element's visual centre: counter the orbit around the transform-origin
        const { vx, vy } = centreOffset(n);
        const r = (rot * Math.PI) / 180, c = Math.cos(r) * sc, s = Math.sin(r) * sc;
        tx += vx - (c * vx - s * vy);
        ty += vy - (s * vx + c * vy);
      }
      own(rec, n, 'translate', `${tx}px ${ty}px`); want.add('translate');
      if (rot) { own(rec, n, 'rotate', `${rot}deg`); want.add('rotate'); }
      if (sc !== 1) { own(rec, n, 'scale', String(sc)); want.add('scale'); }
    }
    if (hide) { own(rec, n, 'visibility', 'hidden'); want.add('visibility'); }
    if (isNum(tw.z)) {
      if (rec.has('position') || getComputedStyle(n).position === 'static') { own(rec, n, 'position', 'relative'); want.add('position'); }
      own(rec, n, 'zIndex', String(Math.round(tw.z))); want.add('zIndex');
    }
    if (isNum(tw.opacity) && tw.opacity !== 1) {
      own(rec, n, 'opacity', (o) => String(o.baseNum * tw.opacity), opacityBase); want.add('opacity');
    }
    if (typeof tw.color === 'string' && tw.color) { own(rec, n, 'color', tw.color); want.add('color'); }
    if (typeof tw.bg === 'string' && tw.bg) { own(rec, n, 'backgroundColor', tw.bg); want.add('backgroundColor'); }
    if (typeof tw.text === 'string') {
      if (canText(n) || rec.has('text')) { ownText(rec, n, tw.text); want.add('text'); }
      else warn(`text tweak ignored for "${keyOf(n)}": element content is not a single text node`);
    }
    for (const p of [...rec.keys()]) if (!want.has(p)) release(rec, n, p);
  }

  /** Remove the previous frame's override layer before the scene writes its next base. */
  function restore() {
    for (const [n, rec] of touched) for (const p of [...rec.keys()]) release(rec, n, p);
    touched.clear();
    retimeRestore();
  }

  // ---------- time tweaks (docs/RETIME.md §2) ----------
  /** Composite time map of a key: its named DOM ancestors' maps (outermost first), then its own. */
  function mapOf(key) {
    let f = timeMap(effective[key]);
    if (boundsObjs.has(key)) return f;
    const n = resolve(key);
    if (!n) return f;
    for (let c = n.parentElement; c && c !== root; c = c.parentElement) {
      const k = nodeKey.get(c);
      if (k && hasTime(effective[k])) f = compose(timeMap(effective[k]), f);
    }
    return f;
  }
  function localTime(key, t) {
    if (!anyTime) return t;
    const v = at(mapOf(key), t);
    return Math.min(meta.duration, Math.max(0, v));
  }
  const boxT = (key) => (clocked.has(key) ? localTime(key, curT) : curT);
  const scopes = new Map(); // element -> scope root (cached while the scope stays in the scene)
  /** The element + the unnamed wrappers above it that hold no other named element. */
  function scopeOf(n) {
    const hit = scopes.get(n);
    if (hit && root.contains(hit)) return hit;
    let s = n;
    for (let p = s.parentElement; p && p !== root && !nodeKey.has(p); p = s.parentElement) {
      let other = false;
      for (const x of p.querySelectorAll('[data-gfx]')) if (!n.contains(x)) { other = true; break; }
      if (other) break;
      s = p;
    }
    scopes.set(n, s);
    return s;
  }
  /**
   * Renders needed for frame t: null when no time tweak is active (the frame is drawn exactly as without this feature),
   * else [{ t: local, scopes: [{ key, scope, depth }] }] sorted by local time; local === t needs no extra render.
   */
  function retimePlan(t) {
    if (!anyTime) return null;
    const groups = new Map();
    for (const [key, tw] of Object.entries(effective)) {
      if (!hasTime(tw) || boundsObjs.has(key) || clocked.has(key)) continue;
      let n = resolve(key);
      if (!n && key[0] !== '@') { scan(); n = resolve(key); }
      if (!n) { warn(`time tweak key "${key}" does not resolve to an element`); continue; }
      const lt = localTime(key, t);
      const scope = scopeOf(n);
      if (!groups.has(lt)) groups.set(lt, []);
      groups.get(lt).push({ key, scope, depth: depth(scope) });
    }
    if (!groups.size) return null;
    return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([lt, list]) => ({ t: lt, scopes: list, same: lt === t }));
  }
  const retimeCapture = (list) => list.map((s) => ({ ...s, snap: capture(s.scope) }));
  /** After the scene drew frame t: remember its own values per scope, then write the retimed captures (shallow first). */
  function retimeWrite(caps) {
    retimed = [];
    for (const c of [...caps].sort((a, b) => a.depth - b.depth)) {
      if (!c.snap) continue;
      const base = capture(c.scope);
      if (write(c.scope, c.snap)) retimed.push([c.scope, base]);
      else warn(`time tweak for "${c.key}" skipped: its elements changed between renders`);
    }
  }
  function retimeRestore() {
    for (let i = retimed.length - 1; i >= 0; i--) write(retimed[i][0], retimed[i][1]);
    retimed = [];
  }

  /** Elements hidden by the view layer: explicit `hidden` keys + everything outside the `solo` chain. */
  function viewHidden() {
    const out = new Set();
    for (const k of view.hidden) {
      if (boundsObjs.has(k)) continue;
      const n = resolve(k);
      if (n) out.add(n); else warn(`view key "${k}" does not resolve to an element`);
    }
    if (view.solo) {
      const sn = boundsObjs.has(view.solo) ? null : resolve(view.solo);
      if (!sn && !boundsObjs.has(view.solo)) warn(`view solo key "${view.solo}" does not resolve to an element`);
      else if (!sn) { for (const c of root.children) out.add(c); }
      else for (let c = sn; c && c !== root; c = c.parentElement) {
        const par = c.parentElement;
        if (par) for (const sib of par.children) if (sib !== c) out.add(sib);
      }
    }
    return out;
  }

  /** Called after every scene.render(t). */
  function apply() {
    const items = new Map(); // element -> { tw, hide }
    for (const [key, tw0] of Object.entries(effective)) {
      if (boundsObjs.has(key) || isIdentity(tw0)) continue;
      let n = resolve(key);
      if (!n && key[0] !== '@') { scan(); n = resolve(key); }
      if (!n) { warn(`tweak key "${key}" does not resolve to an element`); continue; }
      items.set(n, { tw: tw0, hide: tw0.visible === false && !sampling });
    }
    if (!sampling && (view.hidden.length || view.solo)) {
      for (const n of viewHidden()) {
        const it = items.get(n);
        if (it) it.hide = true; else items.set(n, { tw: {}, hide: true });
      }
    }
    for (const [n, rec] of touched) {
      if (!items.has(n)) { for (const p of [...rec.keys()]) release(rec, n, p); touched.delete(n); }
    }
    const want = [...items.entries()].sort((a, b) => depth(a[0]) - depth(b[0]));
    for (const [n, it] of want) {
      let rec = touched.get(n);
      if (!rec) { rec = new Map(); touched.set(n, rec); }
      applyOne(n, it.tw, rec, it.hide);
    }
  }

  // ---------- layers: tree + visibility (docs/REVIEW.md §6) ----------
  const zOf = (n) => {
    const cs = getComputedStyle(n);
    const z = parseInt(cs.zIndex, 10);
    return Number.isFinite(z) && cs.position !== 'static' ? z : 0;
  };
  /** Named DOM elements + bounds objects, nested by named ancestry, paint order front-most first within siblings. */
  function tree() {
    scan();
    const dom = domEntries();
    const nodes = new Map();
    const kids = new Map(); // parent key|null -> [node]
    const add = (nd) => { nodes.set(nd.key, nd); if (!kids.has(nd.parent)) kids.set(nd.parent, []); kids.get(nd.parent).push(nd); };
    dom.forEach(([key, n], i) => {
      let p = n.parentElement;
      while (p && p !== root && !nodeKey.has(p)) p = p.parentElement;
      const parent = p && p !== root ? nodeKey.get(p) : null;
      add({ key, label: labelOf(n), named: true, parent, depth: parent ? nodes.get(parent).depth + 1 : 0, kind: 'dom', retime: clocked.has(key) ? 'clock' : 'auto', _z: zOf(n), _i: i });
    });
    [...boundsObjs.keys()].forEach((key, i) => add({ key, label: key, named: true, parent: null, depth: 0, kind: 'box', retime: clocked.has(key) ? 'clock' : 'none', _z: 1e9, _i: 1e9 + i }));
    const nodeList = []; // pre-order, siblings front-first
    const walk = (parent) => {
      const list = (kids.get(parent) || []).sort((a, b) => b._z - a._z || b._i - a._i);
      const buckets = new Map();
      for (const nd of list) { const m = /^(.*[^-])-(\d+)$/.exec(nd.key); if (m) buckets.set(m[1], (buckets.get(m[1]) || []).concat(nd)); }
      for (const [base, arr] of buckets) if (arr.length >= 2) for (const nd of arr) { nd.group = base; nd.count = arr.length; }
      for (const nd of list) { nodeList.push(nd); walk(nd.key); }
    };
    walk(null);
    // global back-to-front paint order: parent, then its children back to front
    const back = [];
    const emit = (parent) => { for (const nd of [...(kids.get(parent) || [])].reverse()) { back.push(nd.key); emit(nd.key); } };
    emit(null);
    const clean = nodeList.map(({ _z, _i, ...r }) => r);
    return { nodes: clean, order: back.reverse() };
  }

  const frameHits = (b, W, H) => b && b.w > 0 && b.h > 0 && b.x < W && b.y < H && b.x + b.w > 0 && b.y + b.h > 0;
  // Resolve simple clip lengths against the untransformed border box.
  function emptyClip(n, cs) {
    const clip = cs.clipPath || 'none';
    if (clip === 'none') return false;
    const length = (s, size) => {
      const m = /^(-?[\d.]+)(px|%)?$/.exec(s);
      return m ? +m[1] * (m[2] === '%' ? size / 100 : 1) : NaN;
    };
    const w = n.offsetWidth ?? n.getBoundingClientRect().width;
    const h = n.offsetHeight ?? n.getBoundingClientRect().height;
    const circle = /^circle\(\s*([^\s)]+)/.exec(clip);
    if (circle) return length(circle[1], Math.hypot(w, h) / Math.SQRT2) <= 0.5;
    const inset = /^inset\(([^)]*)\)/.exec(clip);
    if (inset) {
      const sides = inset[1].split(/\s+round\b/)[0].trim().split(/\s+/);
      const [t, r = t, b = t, l = r] = sides;
      return length(t, h) + length(b, h) >= h || length(l, w) + length(r, w) >= w;
    }
    const polygon = /^polygon\((.*)\)/.exec(clip);
    if (polygon) {
      const points = polygon[1].replace(/^(?:nonzero|evenodd),\s*/, '').split(',').map((s) => {
        const [x, y] = s.trim().split(/\s+/);
        return [length(x, w), length(y, h)];
      });
      if (points.length < 3 || points.some((p) => p.some((v) => !Number.isFinite(v)))) return false;
      // Collinear points have no area. Signed area alone would misclassify
      // self-intersecting polygons whose lobes cancel.
      const a = points[0], b = points.find((p) => p[0] !== a[0] || p[1] !== a[1]) || a;
      return points.every((p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-8);
    }
    return false;
  }
  function visibleColor(color) {
    if (!color || color === 'transparent') return false;
    const alpha = /\/\s*([\d.]+%?)\s*\)$/.exec(color) || /^rgba\([^)]*,\s*([\d.]+)\s*\)$/.exec(color);
    return !alpha || parseFloat(alpha[1]) > 0;
  }
  function paints(n, cs) {
    return /^(img|svg|canvas|video|iframe)$/i.test(n.localName) ||
      visibleColor(cs.backgroundColor) || (cs.backgroundImage && cs.backgroundImage !== 'none') ||
      ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(cs[`border${side}Width`]) > 0 && visibleColor(cs[`border${side}Color`])) ||
      (cs.boxShadow && cs.boxShadow !== 'none') ||
      (parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none' && visibleColor(cs.outlineColor)) ||
      [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
  }
  /** Visibility of each tree node in the current frame (no screenshots). `list` = tree().nodes. */
  function visibility(list) {
    const rs = rootScale();
    const opm = new Map();
    const styles = new Map();
    const style = (n) => { if (!styles.has(n)) styles.set(n, getComputedStyle(n)); return styles.get(n); };
    const opAcc = (n) => {
      if (opm.has(n)) return opm.get(n);
      const cs = style(n);
      let v = cs.display === 'none' || emptyClip(n, cs) ? 0 : parseFloat(cs.opacity);
      if (!Number.isFinite(v)) v = 1;
      if (v > 0.01 && n !== root && n.parentElement) v *= opAcc(n.parentElement);
      opm.set(n, v);
      return v;
    };
    const rects = new Map();
    const rect = (n) => { if (!rects.has(n)) rects.set(n, n.getBoundingClientRect()); return rects.get(n); };
    const overflowVisible = (n) => {
      const b = clientRect(n);
      let left = b.left, top = b.top, right = b.left + b.width, bottom = b.top + b.height;
      for (let p = n.parentElement; p && p !== root; p = p.parentElement) {
        const cs = style(p);
        const clipsX = /^(hidden|clip|scroll|auto)$/.test(cs.overflowX);
        const clipsY = /^(hidden|clip|scroll|auto)$/.test(cs.overflowY);
        if (!clipsX && !clipsY) continue;
        const r = rect(p);
        if (clipsX) { left = Math.max(left, r.left); right = Math.min(right, r.left + r.width); }
        if (clipsY) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.top + r.height); }
        if (right <= left || bottom <= top) return false;
      }
      return true;
    };
    const out = {};
    for (const nd of list) {
      if (nd.kind === 'box') {
        let b = null;
        try { b = boundsObjs.get(nd.key).bounds(boxT(nd.key)); } catch {}
        out[nd.key] = !!frameHits(b, meta.width, meta.height);
        continue;
      }
      const n = resolve(nd.key);
      let v = false;
      if (n && opAcc(n) > 0.01) {
        const vis = style(n).visibility;
        if (vis !== 'hidden' && vis !== 'collapse') v = !!frameHits(rectScene(n, rs), meta.width, meta.height) && overflowVisible(n);
      }
      out[nd.key] = v;
    }
    const childVisible = new Map();
    // Pre-order tree reversed: resolve child unions before their parents.
    for (const nd of [...list].reverse()) {
      const n = resolve(nd.key);
      if (nd.kind === 'dom' && n && childVisible.has(nd.key) && !paints(n, style(n))) {
        out[nd.key] = out[nd.key] && childVisible.get(nd.key);
      }
      if (nd.parent) childVisible.set(nd.parent, (childVisible.get(nd.parent) || false) || out[nd.key]);
    }
    return out;
  }

  // ---------- actual values + motion path samples (docs/REVIEW.md §7) ----------
  /** Accumulated linear (2x2 part) map of n and its ancestors up to (excluding) root: n-local -> scene px. */
  function accumulatedLinear(n) {
    let acc = new DOMMatrix();
    for (let c = n; c && c !== root; c = c.parentElement) acc = linear(c).multiply(acc);
    return acc;
  }
  function effectiveOpacity(n) {
    let v = 1;
    for (let c = n; c; c = c.parentElement) {
      const cs = getComputedStyle(c);
      if (cs.display === 'none') return 0;
      if (c === n && (cs.visibility === 'hidden' || cs.visibility === 'collapse')) return 0;
      const o = parseFloat(cs.opacity);
      if (Number.isFinite(o)) v *= o;
      if (c === root) break;
    }
    return v;
  }
  const r2 = (v) => +v.toFixed(2);
  const r4 = (v) => +v.toFixed(4);
  /** Centre / quad / accumulated scale+rotation / opacity of one element in the current frame (scene px). */
  function measure(n, rs) {
    const b = clientRect(n);
    const x0 = (b.left - rs.r.left) / rs.sx, y0 = (b.top - rs.r.top) / rs.sy, bw = b.width / rs.sx, bh = b.height / rs.sy;
    const cx = x0 + bw / 2, cy = y0 + bh / 2; // affine image of a box: AABB centre == quad centroid
    const L = accumulatedLinear(n);
    const scaleX = Math.hypot(L.a, L.b);
    const scaleY = scaleX > 1e-12 ? (L.a * L.d - L.b * L.c) / scaleX : 0;
    const rotate = Math.atan2(L.b, L.a) * 180 / Math.PI;
    let quad;
    const html = !(n instanceof SVGElement) && n.offsetWidth !== undefined && n.getBoundingClientRect().width === b.width;
    const cs = html ? getComputedStyle(n) : null;
    const dimension = (axis, sides) => {
      const size = parseFloat(cs[axis]);
      return cs.boxSizing === 'border-box' ? size : size + sides.reduce((sum, side) =>
        sum + (parseFloat(cs[`padding${side}`]) || 0) + (parseFloat(cs[`border${side}Width`]) || 0), 0);
    };
    let w = html ? dimension('width', ['Left', 'Right']) : NaN;
    let h = html ? dimension('height', ['Top', 'Bottom']) : NaN;
    // Inline boxes can have computed width/height:auto. Recover their local size
    // from the transformed AABB when its two equations are independent.
    const det = Math.abs(L.a * L.d) - Math.abs(L.b * L.c);
    if (html && (!Number.isFinite(w) || !Number.isFinite(h)) && Math.abs(det) > 1e-12) {
      w = (bw * Math.abs(L.d) - bh * Math.abs(L.c)) / det;
      h = (bh * Math.abs(L.a) - bw * Math.abs(L.b)) / det;
    }
    if (html && w > 0 && h > 0 && n.getBoundingClientRect().width > 0) {
      const hw = w / 2, hh = h / 2;
      quad = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([px, py]) => [r2(cx + L.a * px + L.c * py), r2(cy + L.b * px + L.d * py)]);
    } else quad = [[x0, y0], [x0 + bw, y0], [x0 + bw, y0 + bh], [x0, y0 + bh]].map(([a, c]) => [r2(a), r2(c)]);
    const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {
      cx: r2(cx), cy: r2(cy), x: r2(x), y: r2(y), w: r2(Math.max(...xs) - x), h: r2(Math.max(...ys) - y),
      scaleX: r4(scaleX), scaleY: r4(scaleY), rotate: r2(rotate), opacity: r4(effectiveOpacity(n)), quad,
    };
  }
  function measureBox(key) {
    const bo = boundsObjs.get(key);
    let b = null;
    try { b = bo.bounds(boxT(key)); } catch {}
    const tw = tweak(key);
    if (!b) return { cx: 0, cy: 0, x: 0, y: 0, w: 0, h: 0, scaleX: tw.scale, scaleY: tw.scale, rotate: tw.rotate, opacity: tw.opacity, quad: [[0, 0], [0, 0], [0, 0], [0, 0]], visible: false };
    return {
      cx: r2(b.x + b.w / 2), cy: r2(b.y + b.h / 2), x: r2(b.x), y: r2(b.y), w: r2(b.w), h: r2(b.h),
      scaleX: tw.scale, scaleY: tw.scale, rotate: tw.rotate, opacity: tw.opacity,
      quad: [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([a, c]) => [r2(a), r2(c)]),
      visible: !!frameHits(b, meta.width, meta.height) && tw.opacity > 0.01,
    };
  }
  /**
   * Returns a function measuring `key` in the current frame ({cx,cy,x,y,w,h,scaleX,scaleY,rotate,opacity,visible,quad}),
   * or null if the key does not resolve. The visibility subtree (node + named descendants, for the unpainted-container
   * rule) is resolved once per probe.
   */
  function probe(key) {
    scan();
    if (boundsObjs.has(key)) return () => measureBox(key);
    const n = resolve(key);
    if (!n) return null;
    const visibilityKey = nodeKey.get(n) || key;
    const nodes = tree().nodes;
    let sub = [{ key: visibilityKey, kind: 'dom', parent: null }];
    if (nodeKey.has(n)) {
      const i = nodes.findIndex((nd) => nd.key === visibilityKey);
      if (i >= 0) { let j = i + 1; while (j < nodes.length && nodes[j].depth > nodes[i].depth) j++; sub = nodes.slice(i, j); }
    } else {
      sub = [{ key, kind: 'dom', parent: null }, ...nodes.filter((nd) => nd.kind === 'dom' && n.contains(resolve(nd.key)))
        .map((nd) => ({ ...nd, parent: nd.parent && n.contains(resolve(nd.parent)) ? nd.parent : key }))];
    }
    return () => {
      const m = measure(n, rootScale());
      m.visible = !!visibility(sub)[visibilityKey];
      return m;
    };
  }
  function values(keys) {
    const out = {};
    for (const k of keys || []) {
      const f = probe(k);
      if (!f) continue;
      const { quad, ...m } = f();
      out[k] = m;
    }
    return out;
  }
  const setSampling = (on) => { sampling = !!on; };

  return {
    el, clock, localTime, retimePlan, retimeCapture, retimeWrite, endSetup, nodeOf, keysIn, keyOf, tweak, restore, apply, pick, bounds, elements, warnings, setFile, setLive, setView, signature, tree, visibility, setSampling, values, probe,
    setTime: (t) => { curT = t; },
    calib: () => ({ sx: 1, sy: 1 }),
  };
}
