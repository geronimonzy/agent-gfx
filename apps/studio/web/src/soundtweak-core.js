// Sound tweak window logic, pure (docs/SOUND-TWEAK.md): rows, Mutate (seeded by the cue state), Replace ranking, taste.

export const DUR_SOUNDS = new Set(['whoosh', 'swoosh', 'suck', 'rise', 'type', 'sample', 'beep', 'wind']);
export const INT_SOUNDS = new Set(['impact', 'logo', 'whoosh', 'swoosh', 'suck', 'rise', 'wind']);
const NOMINAL = { swoosh: { silk: 0.8, wash: 1.05, '': 0.8 }, whoosh: { air: 0.4, swipe: 0.35, zip: 0.26, '': 0.4 }, suck: 0.55, rise: 1.5, type: 1.0, beep: { soft: 0.14, digital: 0.09, '': 0.14 }, wind: { breeze: 2.5, gust: 2, '': 2.5 } };
const DEF_INT = { impact: 0.55, swoosh: 0.5, suck: 0.6, logo: 0.9, whoosh: 0.45, rise: 0.5, wind: 0.4 };
const r = (v, n) => +(+v).toFixed(n);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The cue field "Length" edits: `dur` for sounds that have one, else the `decay` envelope. */
export const lengthKey = (sound) => (DUR_SOUNDS.has(sound) ? 'dur' : 'decay');
export function nominalDur(cue) {
  const n = NOMINAL[cue.sound];
  if (cue.sound === 'sample') return isNum(cue.dur) ? cue.dur : 1;
  return typeof n === 'object' ? n[cue.variant || ''] ?? n[''] : n ?? 1;
}
export const intensityOf = (cue) => (isNum(cue.intensity) ? cue.intensity : DEF_INT[cue.sound] ?? 0.5);

/** Rows of the tweak window for a resolved cue: { k, label, min, max, step, value, set (bool: overridden), unit }. */
export function rows(cue) {
  const lk = lengthKey(cue.sound);
  const out = [
    { k: 'pitch', label: 'Pitch', min: -24, max: 24, step: 0.1, unit: 'st', value: cue.pitch || 0 },
    { k: lk, label: 'Length', min: lk === 'dur' ? 0.05 : 0.02, max: lk === 'dur' ? 4 : 3, step: 0.01, unit: 's', value: lk === 'dur' ? (isNum(cue.dur) ? cue.dur : nominalDur(cue)) : (cue.decay ?? 3), auto: lk === 'dur' ? !isNum(cue.dur) : !isNum(cue.decay) },
    { k: 'attack', label: 'Attack', min: 0, max: 1, step: 0.01, unit: 's', value: cue.attack || 0 },
    { k: 'bright', label: 'Brightness', min: -1, max: 1, step: 0.01, unit: '', value: cue.bright || 0 },
    { k: 'reverb', label: 'Reverb', min: 0, max: 1, step: 0.01, unit: '', value: cue.reverb || 0 },
    { k: 'gain', label: 'Gain', min: -24, max: 12, step: 0.5, unit: 'dB', value: cue.gain || 0 },
    { k: 'pan', label: 'Pan', min: -1, max: 1, step: 0.05, unit: '', value: cue.pan || 0 },
  ];
  if (INT_SOUNDS.has(cue.sound)) out.push({ k: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, unit: '', value: intensityOf(cue) });
  return out;
}
/** Value -> the stored field value: identity of the new fields = undefined (drops the override). */
export function fieldValue(k, v) {
  if (k === 'attack' || k === 'reverb') return v > 0 ? v : undefined;
  if (k === 'bright') return v !== 0 ? v : undefined;
  if (k === 'decay') return v >= 3 ? undefined : v; // the slider's end = no decay envelope
  return v;
}

// ---------- Mutate ----------
export const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const STATE = ['sound', 'variant', 'pitch', 'gain', 'pan', 'dur', 'decay', 'attack', 'bright', 'reverb', 'intensity', 'seed'];
/** Seed of a mutation: the cue id + its current values, so the same state always mutates to the same result. */
export const mutateSeed = (cue) => fnv(cue.id + '|' + JSON.stringify(STATE.map((k) => cue[k] ?? null)));
/** A small random step from the cue's current values -> a patch of plain parameters. */
export function mutate(cue) {
  const rnd = mulberry32(mutateSeed(cue)), u = (a) => (rnd() * 2 - 1) * a;
  const p = {};
  p.pitch = r((cue.pitch || 0) + u(1.5), 2);
  p.gain = r(clamp((cue.gain || 0) + u(1.5), -60, 36), 2);
  p.bright = fieldValue('bright', r(clamp((cue.bright || 0) + u(0.2), -1, 1), 2));
  p.reverb = fieldValue('reverb', r(clamp((cue.reverb || 0) + u(0.08), 0, 1), 2));
  const lk = lengthKey(cue.sound), f = 1 + u(0.15);
  if (lk === 'dur') p.dur = r(clamp((isNum(cue.dur) ? cue.dur : nominalDur(cue)) * f, 0.05, 4), 3);
  else if (isNum(cue.decay)) p.decay = r(clamp(cue.decay * f, 0.02, 3), 3);
  if (INT_SOUNDS.has(cue.sound)) p.intensity = r(clamp(intensityOf(cue) + u(0.1), 0, 1), 2);
  if (cue.sound !== 'whoosh') p.pan = r(clamp((cue.pan || 0) + u(0.1), -1, 1), 2);
  return p;
}
/** Vary: the next take of the same sound. */
export const vary = (cue) => ({ seed: (isNum(cue.seed) ? cue.seed : 0) + 1 });
/** Fields "Reset sound" drops (time, mute, stem, links stay). */
export const SOUND_FIELDS = ['pitch', 'gain', 'pan', 'dur', 'decay', 'attack', 'bright', 'reverb', 'intensity', 'seed', 'variant'];

// ---------- Replace + taste ----------
/** What a cue sounds like, as a taste key: synth sound/variant or the sample file. */
export const soundKey = (c) => (c.sound === 'sample' ? `sample:${c.src}${c.start ? '#' + c.start : ''}` : `synth:${c.sound}${c.variant ? '/' + c.variant : ''}`);
/** Taste boost of target `to` for source `from`: 0.2 per earlier pick, capped at 0.6; counts too. */
export function taste(history, from, to) {
  const n = (history || []).filter((h) => h.from === from && h.to === to).length;
  return { n, boost: Math.min(0.6, 0.2 * n) };
}
/** Past choices for a source key, most frequent first: [{ to, n, last }]. */
export function pastChoices(history, from) {
  const m = new Map();
  for (const h of history || []) if (h.from === from && h.to !== from) { const e = m.get(h.to) || { to: h.to, n: 0, last: '' }; e.n++; if (h.at > e.last) e.last = h.at; e.last = e.last || h.at; m.set(h.to, e); }
  return [...m.values()].sort((a, b) => b.n - a.n || (a.last < b.last ? 1 : -1));
}
/** Sort candidates [{ key, score }] by score + taste boost; dedupe by key. */
export function rankWithTaste(cands, history, from) {
  const seen = new Set(), out = [];
  for (const c of cands.map((c) => ({ ...c, ...taste(history, from, c.key) })).sort((a, b) => (b.score + b.boost) - (a.score + a.boost))) {
    if (seen.has(c.key)) continue; seen.add(c.key); out.push(c);
  }
  return out;
}
/** Parse a synth / sample taste key back into a cue patch. */
export function patchOfKey(key, stem) {
  if (key.startsWith('synth:')) { const [sound, variant] = key.slice(6).split('/'); return { sound, variant: variant || undefined }; }
  if (key.startsWith('sample:')) { const [src, start] = key.slice(7).split('#'); return { sound: 'sample', src, start: start ? +start : undefined, stem }; }
  return null;
}

// ---------- review fixes (Codex, d19fcbb) ----------
/** Neutral value of each shaping field; the synth reads 0 as "off" and resolveCues copies it over a base value. */
export const NEUTRAL = { attack: 0, bright: 0, reverb: 0, decay: 0 };
/**
 * Make a patch able to clear a base value: a neutral / undefined shaping field becomes the explicit neutral value when the
 * base cue (scene / sound.json) has a non-neutral one, else undefined (drops the override, no draft clutter).
 */
export function clearFor(base, patch) {
  const out = { ...patch };
  for (const k of Object.keys(NEUTRAL)) {
    if (!(k in out) || (out[k] !== undefined && out[k] !== NEUTRAL[k])) continue;
    const b = base?.[k];
    out[k] = isNum(b) && b !== NEUTRAL[k] ? NEUTRAL[k] : undefined;
  }
  return out;
}
/** Sounds whose synth draws from the seeded rng: Vary / "take" suggestions only change something there. */
export const canVary = (sound) => !['ding', 'chime', 'beep', 'sample'].includes(sound);
/** The one replacement transform (Use and audition): a new sound drops the old one's variant / intensity / file fields. */
export function replacementPatch(cue, patch) {
  const full = { variant: undefined, intensity: undefined, src: undefined, start: undefined, ...patch };
  if (patch.sound !== 'sample' && cue.sound === 'sample') full.dur = undefined;
  return full;
}
/** The cue as it sounds after the replacement (undefined fields removed). */
export function replaced(cue, patch) {
  const out = { ...cue };
  for (const [k, v] of Object.entries(replacementPatch(cue, patch))) { if (v === undefined) delete out[k]; else out[k] = v; }
  return out;
}
