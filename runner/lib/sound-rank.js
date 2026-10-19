// Sound library ranking (docs/SOUND-LIBRARY.md §1-2). Pure ESM: no Node or DOM APIs; used by the CLI (gfx lib
// search/similar, the indexer's tags) and by the studio (vite alias `@rank`; Replace… "Similar in the library").
//
// API
//   ROLES                                   ['hits', 'motion', 'ui', 'accents'] (= the synth stems)
//   ROLE_GROUPS                             { role: [CLAP_LABELS…] } label groups per role
//   RANK_VERSION                            bump when roleOf / groups change: gfx lib index re-tags (meta `rank`)
//   W                                       { emb, feat, bands, role } score weights of similar()
//   roleOf(labels, features?)               -> { role: string|null, roleScore: 0..1 }
//       labels: [[label, p]…] | [{ label, score }…] | { label: p } (full softmax or the stored top 3)
//   tagsOf({ probs, features, bands, sound? }) -> { labels: [[l, p]×3], role, roleScore, bands }  (an index entry's `tags`;
//       `sound` = a synth recipe: role = defaultStem(sound), roleScore 1)
//   similar(query, entries, { role?, maxDur?, minDur?, n = 8, exclude? }) -> [{ entry, score, why }]
//       query / entries: index entries (raw: `emb` base64 + `features`, or decoded: `emb` Float32Array + `fv`);
//       `tags` optional (missing = unknown, neutral). `role` (one of ROLES) wins over query.tags.role; 'any' = no role
//       filter; anything else (e.g. the `samples` stem) falls back to the query's role. Role filter: same role kept,
//       other confident role dropped, roleScore < 0.4 kept but ranked lower. Duration window [0.4x, 2.5x] the query's
//       dur unless minDur / maxDur. `exclude`: ids (array/Set) or a predicate(entry). The query itself (same object,
//       id, or src + start) is always dropped. Order: score, then id. `why`: "same role · sounds alike · brighter".
//       Stored entries are decoded once (WeakMap cache per entry object).
//   queryFromCue(cue, index, normalizeSrc?) -> entry | null  the cue's own entry: a sample's file entry (src + start), or
//       the synth recipe nearest in intensity / length. index: entries array, Map(id -> entry), Map(source -> entries[])
//       or { source: entries[] }. Optional normalizeSrc maps both sample paths to a common key (identity by default).
//   entriesOf(index)                        -> entries[] (the same flattening)
//   queryTokens(text)                       -> lower-case query words (stopwords dropped) for keywordScore
//   entryTokens(entry)                      -> Map(stem -> weight): file name words 1, synth sound / variant 1, folder /
//       pack / source 0.5, CLAP label words 0.5, synth description words 0.6, role 0.3 (camelCase, _ and digits split; Audio / extensions dropped)
//   keywordScore(qTokens, entry)            -> 0..1: per query word the best matching entry weight (adjacent query words
//       also match a joined file word: "mouse release" -> mouserelease), averaged over the query words
//   KW = { weight, weakClap, weakKw }       search score = clap + weight * kw; a hit is weak when kw < weakKw and its CLAP
//       score is under weakClap (tuned on the friction queries in tests/soundlib-eval.mjs)
import { cosine, distance, featureVector, b64ToEmb } from './vox-features.js';
import { defaultStem, DEFAULT_INTENSITY } from './sfx.js';

export const ROLES = ['hits', 'motion', 'ui', 'accents'];
/** Bump when ROLE_GROUPS / PRIOR / roleOf change: `gfx lib index` then re-tags stored entries (no decode, no CLAP audio). */
export const RANK_VERSION = 1;
export const ROLE_GROUPS = {
  ui: ['click', 'tap', 'tick', 'beep', 'typing', 'notification', 'laser'],
  hits: ['impact', 'thud', 'punch', 'pop', 'door', 'footstep', 'crumple'],
  motion: ['whoosh', 'swoosh', 'riser', 'sweep', 'swipe', 'zip', 'glitch'],
  accents: ['ding', 'chime', 'cash register', 'water drip', 'paper rustle'],
};
const GROUP_OF = new Map(Object.entries(ROLE_GROUPS).flatMap(([r, ls]) => ls.map((l) => [l, r])));
// duration / envelope priors (multipliers on the summed label mass), tuned with tests/soundlib-eval.mjs
const PRIOR = { uiShort: 1.6, long: 0.6, rise: 1.8 };
/** Score weights of similar(): CLAP cosine, feature closeness, band closeness, role match. */
export const W = { emb: 1.4, feat: 0.3, bands: 0.2, role: 0.5 };
const UNCERTAIN = 0.4; // roleScore below this = the role is a guess

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const labelList = (labels) => {
  if (!labels) return [];
  if (!Array.isArray(labels)) return Object.entries(labels);
  return labels.map((x) => (Array.isArray(x) ? x : [x.label, x.score]));
};
const rising = (env) => {
  if (!Array.isArray(env) || env.length < 8) return false;
  let pi = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[pi]) pi = i;
  return pi >= env.length * 0.4;
};

/** Role from CLAP label probabilities (summed per ROLE_GROUPS) and duration / envelope priors. */
export function roleOf(labels, features) {
  const m = { hits: 0, motion: 0, ui: 0, accents: 0 };
  for (const [l, p] of labelList(labels)) { const r = GROUP_OF.get(l); if (r && isNum(p)) m[r] += p; }
  const f = features || {};
  if (isNum(f.dur)) {
    if (f.dur <= 0.35 && isNum(f.attack) && f.attack <= 0.02) m.ui *= PRIOR.uiShort;
    if (f.dur >= 0.6) { m.ui *= PRIOR.long; m.hits *= PRIOR.long; }
    if (f.dur >= 0.3 && rising(f.env)) m.motion *= PRIOR.rise;
  }
  const z = m.hits + m.motion + m.ui + m.accents;
  if (!(z > 0)) return { role: null, roleScore: 0 };
  let role = ROLES[0];
  for (const r of ROLES) if (m[r] > m[role]) role = r;
  return { role, roleScore: +(m[role] / z).toFixed(3) };
}

/** An index entry's `tags` (INDEX_VERSION 2). `probs`: the full zero-shot output ({ label, score }[] or pairs). */
export function tagsOf({ probs, features, bands, sound }) {
  const list = labelList(probs).filter(([, p]) => isNum(p)).sort((a, b) => b[1] - a[1]);
  const st = sound ? defaultStem(sound) : null;
  const r = st && ROLES.includes(st) ? { role: st, roleScore: 1 } : roleOf(list, features);
  return { labels: list.slice(0, 3).map(([l, p]) => [l, +p.toFixed(3)]), role: r.role, roleScore: r.roleScore, bands: bands || null };
}

// decoded views of entries (raw index lines carry base64 emb + features; the studio's are decoded already)
const cache = new WeakMap();
function view(e) {
  let v = cache.get(e);
  if (v) return v;
  const emb = typeof e.emb === 'string' ? b64ToEmb(e.emb) : e.emb || null;
  const fv = e.fv || (e.features ? featureVector(e.features) : null);
  const t = e.tags || null;
  v = { emb, fv, bands: Array.isArray(t?.bands) && t.bands.length === 3 ? t.bands : null, role: t?.role || null, rs: isNum(t?.roleScore) ? t.roleScore : 0, dur: isNum(e.dur) ? e.dur : e.features?.dur };
  cache.set(e, v);
  return v;
}
const centre = (b) => b[1] * 0.5 + b[2]; // 0 dark .. 1 bright

/** Library entries like `query`, filtered by role and duration, best first. */
export function similar(query, entries, { role, maxDur, minDur, n = 8, exclude } = {}) {
  const q = view(query);
  role = role === 'any' ? null : ROLES.includes(role) ? role : ROLES.includes(q.role) ? q.role : null; // 'samples' stem etc.: the query's own role
  const lo = isNum(minDur) ? minDur : isNum(q.dur) ? q.dur * 0.4 : 0;
  const hi = isNum(maxDur) ? maxDur : isNum(q.dur) ? q.dur * 2.5 : Infinity;
  const ex = typeof exclude === 'function' ? exclude : exclude ? ((s) => (e) => s.has(e.id))(new Set(exclude)) : () => false;
  const out = [];
  for (const e of entries) {
    if (e === query || (query.id && e.id === query.id) || (query.src && e.src === query.src && Math.abs((e.start || 0) - (query.start || 0)) < 1e-3) || ex(e)) continue;
    const v = view(e);
    if (isNum(v.dur) && (v.dur < lo || v.dur > hi)) continue;
    let rm = 0.5; // unknown role: neutral
    if (role && v.role) {
      if (v.rs < UNCERTAIN) rm = 0.2;
      else if (v.role === role) rm = 1;
      else continue;
    }
    const ce = q.emb && v.emb ? cosine(q.emb, v.emb) : 0;
    const df = q.fv && v.fv ? distance(q.fv, v.fv) : 1;
    const db = q.bands && v.bands ? (Math.abs(q.bands[0] - v.bands[0]) + Math.abs(q.bands[1] - v.bands[1]) + Math.abs(q.bands[2] - v.bands[2])) / 2 : 0.5;
    const score = W.emb * ce + W.feat * (1 - df) + W.bands * (1 - db) + (role ? W.role * rm : 0);
    const why = [];
    if (role && rm === 1) why.push('same role');
    else if (role && rm < 0.5) why.push('role uncertain');
    if (ce >= 0.75) why.push('sounds alike');
    if (df <= 0.2) why.push('close envelope');
    if (q.bands && v.bands) { const d = centre(v.bands) - centre(q.bands); if (d > 0.12) why.push('brighter'); else if (d < -0.12) why.push('darker'); }
    out.push({ entry: e, score: +score.toFixed(4), why: why.join(' · ') });
  }
  out.sort((a, b) => b.score - a.score || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
  return out.slice(0, n);
}

/** Flatten an index (array, Map of entries or of entry lists, or { source: entries[] }). */
export function entriesOf(index) {
  if (!index) return [];
  if (Array.isArray(index)) return index;
  const vals = index instanceof Map ? [...index.values()] : Object.values(index);
  return vals.flatMap((v) => (Array.isArray(v) ? v : [v]));
}

// nominal length of dur-based synth sounds (mirrors the studio's soundtweak-core nominalDur)
const NOMINAL = { swoosh: { silk: 0.8, wash: 1.05, '': 0.8 }, whoosh: { air: 0.4, swipe: 0.35, zip: 0.26, '': 0.4 }, suck: 0.55, rise: 1.5, type: 1.0, beep: { soft: 0.14, digital: 0.09, '': 0.14 }, wind: { breeze: 2.5, gust: 2, '': 2.5 } };
const nominalDur = (c) => { const v = NOMINAL[c.sound]; return typeof v === 'object' ? v[c.variant || ''] ?? v[''] : v ?? 1; };

/** The cue's own library entry: a sample's file entry, or the synth recipe nearest in intensity / length. */
export function queryFromCue(cue, index, normalizeSrc = (src) => src) {
  if (!cue) return null;
  const all = entriesOf(index);
  if (cue.sound === 'sample') {
    if (!cue.src) return null;
    const src = normalizeSrc(cue.src);
    for (const e of all) if (e.src && normalizeSrc(e.src) === src && Math.abs((e.start || 0) - (cue.start || 0)) < 1e-3) return e;
    return null;
  }
  const I = isNum(cue.intensity) ? cue.intensity : DEFAULT_INTENSITY[cue.sound] ?? 0.5, D = isNum(cue.dur) ? cue.dur : nominalDur(cue);
  let best = null, bd = Infinity;
  for (const e of all) {
    const s = e.synth;
    if (!s || s.sound !== cue.sound || (cue.variant && s.variant && s.variant !== cue.variant)) continue;
    const d = Math.abs((s.intensity ?? I) - I) + Math.abs((s.dur ?? D) - D);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ---------- keyword score for gfx lib search (hybrid with CLAP text; docs/SOUND-LIBRARY.md §3) ----------
/** Search weights: score = clap + weight * kw; weak = clap < weakClap and kw < weakKw (no word match covering half the query). */
export const KW = { weight: 0.3, weakClap: 0.4, weakKw: 0.5 };
const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'in', 'to', 'with', 'and', 'or', 'for', 'at', 'by', 'sound', 'sounds', 'sfx', 'effect', 'effects', 'like', 'some']);
const DROP = new Set(['audio', 'ogg', 'wav', 'mp3', 'flac', 'aif', 'aiff', 'm4a', 'opus', 'sfx', 'sounds']);
/** Light stemmer: clicks / clicked / clicking -> click, placed / place -> plac, wooden -> wood, punchy -> punch. */
export function stem(w) {
  w = String(w).toLowerCase();
  for (const suf of ['ing', 'ed', 'es', 'en', 'er', 'y', 's', 'e']) if (w.length - suf.length >= 3 && w.endsWith(suf)) return w.slice(0, -suf.length);
  return w;
}
const words = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Za-z])(\d)/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2 && !DROP.has(w));
/** Lower-case query words, stopwords and bare numbers dropped (keywordScore stems them). */
export function queryTokens(text) {
  return String(text).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
}
// descriptive words for the built-in synth recipes (weight 0.6: below a name match), per sound and per variant
const SYNTH_WORDS = {
  impact: 'hit slam land', logo: 'brand sting end', whoosh: 'swish pass move', swoosh: 'wipe sweep reveal', suck: 'reverse implode',
  rise: 'riser build tension', click: 'tap button', pop: 'bubble appear', tick: 'counter step', type: 'typing keyboard keys',
  ding: 'bell result', chime: 'bell success', beep: 'tone', wind: 'air bed ambience',
  thud: 'soft dull', punch: 'punchy tight', boom: 'big heavy', air: 'soft airy', swipe: 'sharp', zip: 'fast quick',
  silk: 'smooth', wash: 'broad', soft: 'gentle', digital: 'electronic', breeze: 'soft calm gentle', gust: 'strong',
};
const tokCache = new WeakMap();
/** Map(stem -> weight) of an index entry's names, folder, source, labels and role. */
export function entryTokens(e) {
  let m = tokCache.get(e);
  if (m) return m;
  m = new Map();
  const put = (w, wt) => { const s = stem(w); if ((m.get(s) || 0) < wt) m.set(s, wt); };
  const id = String(e.id || '');
  const ci = id.indexOf(':'), source = ci > 0 ? id.slice(0, ci) : '', rest = (ci > 0 ? id.slice(ci + 1) : id).replace(/#[\d.]+$/, '');
  if (e.synth) {
    put('synth', 0.5);
    for (const k of [e.synth.sound, e.synth.variant]) {
      if (!k) continue;
      put(k, 1);
      for (const w of (SYNTH_WORDS[k] || '').split(' ')) if (w) put(w, 0.6);
    }
  } else {
    const parts = rest.split('/');
    const file = parts.pop().replace(/\.[a-z0-9]+$/i, '');
    for (const p of parts) for (const w of words(p)) put(w, 0.5);
    if (source) for (const w of words(source)) put(w, 0.5);
    for (const w of words(file)) put(w, 1);
    const joined = file.replace(/[\d_\-\s]+/g, '').toLowerCase(); // "mouserelease1" / "bookPlace1" -> joined words
    if (joined.length >= 3) put(joined, 1);
  }
  for (const l of e.tags?.labels || []) for (const w of words(Array.isArray(l) ? l[0] : l?.label || '')) put(w, 0.5);
  const role = e.tags?.role;
  if (role) { put(role, 0.3); if (role === 'hits') put('hit', 0.3); if (role === 'accents') put('accent', 0.3); }
  tokCache.set(e, m);
  return m;
}
/** 0..1: how much of the query the entry's names / folder / labels / role cover (best weight per query word). */
export function keywordScore(q, e) {
  if (!q.length) return 0;
  const m = entryTokens(e);
  let s = 0;
  for (let i = 0; i < q.length; i++) {
    let best = m.get(stem(q[i])) || 0;
    if (i + 1 < q.length) best = Math.max(best, m.get(stem(q[i] + q[i + 1])) || 0); // "mouse release" -> mouserelease
    if (i > 0) best = Math.max(best, m.get(stem(q[i - 1] + q[i])) || 0);
    s += best;
  }
  return s / q.length;
}
