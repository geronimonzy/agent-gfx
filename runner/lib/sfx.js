// Synthesized, deterministic SFX. Pure helpers (pentatonic, countTicks, makeCue, resolveCues) work in
// Node and the browser; renderStems() needs OfflineAudioContext (browser page only).
// All randomness comes from mulberry32 seeded per cue, so renders are byte-identical run to run.
import * as EASE from './ease.js';
import { mulberry32 } from './rng.js';

export const SAMPLE_RATE = 48000;

// ---------- scene-facing helpers ----------
const PENTA = [0, 2, 4, 7, 9];
/** Semitone offset of the i-th note of a major pentatonic ladder (ascends past the octave). */
export const pentatonic = (i, base = 0) => base + 12 * Math.floor(i / 5) + PENTA[((i % 5) + 5) % 5];

/**
 * Tick times for a count-up. `ease` (function or name from ease.js, default linear) is the easing of the
 * visible counter; tick k lands where the counter crosses k/n, so a decelerating counter gets ticks that
 * are dense early and sparse late. Returns n times in (t0, t1], last tick at t1.
 */
export function countTicks(t0, t1, n, ease = 'linear') {
  const f = typeof ease === 'function' ? ease : EASE[ease] || EASE.linear;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const y = k / n;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (f(m) < y) lo = m; else hi = m; }
    out.push(t0 + (t1 - t0) * (k === n ? 1 : (lo + hi) / 2));
  }
  return out;
}

// ---------- cue model ----------
const DEFAULT_STEM = {
  impact: 'hits', swoosh: 'hits', suck: 'hits', logo: 'hits',
  whoosh: 'motion', rise: 'motion', wind: 'motion',
  click: 'ui', pop: 'ui', tick: 'ui', type: 'ui', beep: 'ui',
  ding: 'accents', chime: 'accents',
  sample: 'samples', // recorded file, see "sample cues" below
};
/** Synthesized sounds (what pickers should offer); `sample` is a valid cue sound but needs `src`. */
export const SOUND_NAMES = Object.keys(DEFAULT_STEM).filter((s) => s !== 'sample');
export const defaultStem = (sound) => DEFAULT_STEM[sound];

/** Default `intensity` (0..1) per sound; ui/accent sounds ignore it. */
export const DEFAULT_INTENSITY = { impact: 0.55, swoosh: 0.5, suck: 0.6, logo: 0.9, whoosh: 0.45, rise: 0.5, wind: 0.4 };
/** Valid `variant` names per sound, and the pool used when a cue has none (logo defaults to boom). */
export const VARIANTS = { impact: ['thud', 'punch', 'boom'], whoosh: ['air', 'swipe', 'zip'], swoosh: ['silk', 'wash'], logo: ['boom', 'punch', 'thud'], beep: ['soft', 'digital'], wind: ['breeze', 'gust'] };
const AUTO_VARIANTS = { impact: ['thud', 'punch'], whoosh: ['air', 'swipe', 'zip'], swoosh: ['silk', 'wash'] };
export const intensityOf = (cue) => (isNum(cue.intensity) ? cue.intensity : DEFAULT_INTENSITY[cue.sound] ?? 0.5);

const clampN = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Validate and normalize one cue. `n` = 1-based count of this sound so far (for default ids). */
export function makeCue(t, sound, opts = {}, { width = 0, n = 1 } = {}) {
  if (!isNum(t)) throw new Error(`cue: t must be a finite number of seconds (got ${t})`);
  if (!DEFAULT_STEM[sound]) throw new Error(`cue: unknown sound "${sound}" (one of ${SOUND_NAMES.join(', ')})`);
  const o = opts || {};
  let pan = isNum(o.pan) ? o.pan : 0;
  if (isNum(o.x) && width > 0) pan = (o.x / width * 2 - 1) * 0.6;
  const cue = {
    id: o.id ? String(o.id) : `${sound}-${n}`,
    t, sound,
    stem: o.stem ? String(o.stem) : DEFAULT_STEM[sound],
    gain: isNum(o.gain) ? o.gain : 0,
    pan: clampN(pan, -1, 1),
    pitch: isNum(o.pitch) ? o.pitch : 0,
  };
  if (isNum(o.dur)) cue.dur = o.dur;
  if (sound === 'sample') {
    if (typeof o.src !== 'string' || !o.src) throw new Error('cue: sample cues need src (path relative to the repo, or absolute)');
    cue.src = o.src;
    if (isNum(o.start) && o.start > 0) cue.start = o.start;
    if (isNum(o.rate) && o.rate > 0) cue.rate = clampN(o.rate, 0.25, 4);
    if (Array.isArray(o.env) && o.env.length >= 2 && o.env.every(isNum)) cue.env = o.env.map((v) => clampN(v, 0, 4));
  }
  if (isNum(o.intensity)) cue.intensity = clampN(o.intensity, 0, 1);
  // sound tweak parameters (docs/SOUND-TWEAK.md); absent = the sound as designed
  if (isNum(o.attack) && o.attack > 0) cue.attack = clampN(o.attack, 0, 2);
  if (isNum(o.decay) && o.decay > 0) cue.decay = clampN(o.decay, 0.02, 8);
  if (isNum(o.bright) && o.bright !== 0) cue.bright = clampN(o.bright, -1, 1);
  if (isNum(o.reverb) && o.reverb > 0) cue.reverb = clampN(o.reverb, 0, 1);
  if (isNum(o.seed) && o.seed >= 1) cue.seed = Math.round(o.seed);
  if (typeof o.variant === 'string' && o.variant) cue.variant = o.variant;
  if (typeof o.el === 'string') cue.el = o.el; // '' = explicitly unlinked (no link by name) // the element this sound belongs to (docs/RETIME.md §3); no effect on audio
  if (!o.stem) cue.stemAuto = true;
  return cue;
}

/** Per-cue sound tweak fields (docs/SOUND-TWEAK.md). */
export const TWEAK_KEYS = ['attack', 'decay', 'bright', 'reverb', 'seed'];
/** Apply the sound.json fix layer to scene cues. Returns { cues, stems, master, warnings }. */
export function resolveCues(sceneCues, fix = {}) {
  const warnings = [];
  const ov = fix.cues || {};
  const byId = new Map();
  const cues = sceneCues.map((c, i) => {
    const r = { ...c, order: i };
    byId.set(r.id, r);
    return r;
  });
  for (const [id, o] of Object.entries(ov)) {
    const c = byId.get(id);
    if (!c) { warnings.push(`sound.json: no cue with id "${id}"`); continue; }
    for (const k of ['t', 'gain', 'pan', 'pitch', 'dur', 'intensity', 'variant', 'src', 'start', 'rate', 'env', 'el', ...TWEAK_KEYS]) if (o[k] !== undefined) c[k] = o[k];
    if (o.sound !== undefined) {
      if (!DEFAULT_STEM[o.sound]) throw new Error(`sound.json: cue "${id}": unknown sound "${o.sound}"`);
      c.sound = o.sound;
      if (c.stemAuto && o.stem === undefined) c.stem = DEFAULT_STEM[o.sound];
    }
    if (o.stem !== undefined) { c.stem = o.stem; c.stemAuto = false; }
    if (o.mute !== undefined) c.mute = !!o.mute;
  }
  (fix.add || []).forEach((a, k) => {
    const c = makeCue(a.t, a.sound, a, { n: k + 1 });
    if (!a.id) c.id = `${a.sound}-add${k + 1}`;
    c.order = 1e6 + k;
    c.added = true;
    cues.push(c);
  });
  cues.sort((a, b) => a.t - b.t || a.order - b.order);
  // Variants: explicit ones are validated; missing ones are drawn from a per-cue seed in time order,
  // never repeating the previous cue of the same sound.
  const prev = {};
  for (const c of cues) {
    if (c.mute) continue;
    const valid = VARIANTS[c.sound];
    if (c.variant && (!valid || !valid.includes(c.variant))) {
      warnings.push(`cue "${c.id}": variant "${c.variant}" is not valid for ${c.sound}${valid ? ` (one of ${valid.join(', ')})` : ''}`);
      delete c.variant;
    }
    const pool = AUTO_VARIANTS[c.sound];
    if (!c.variant && pool) {
      const r = mulberry32((fnv(c.id) ^ Math.round(c.t * 1000) ^ 0x9e3779b9) >>> 0);
      const opts = pool.filter((v) => v !== prev[c.sound]);
      c.variant = opts[Math.floor(r() * opts.length)];
    }
    if (c.variant) prev[c.sound] = c.variant;
  }
  const stems = {};
  for (const c of cues) stems[c.stem] = stems[c.stem] || { gain: 0, mute: false };
  for (const [s, v] of Object.entries(fix.stems || {})) {
    if (!stems[s]) { warnings.push(`sound.json: stem "${s}" has no cues`); stems[s] = { gain: 0, mute: false }; }
    if (v.gain !== undefined) stems[s].gain = v.gain;
    if (v.mute !== undefined) stems[s].mute = !!v.mute;
  }
  const out = cues.map(({ order, stemAuto, ...c }) => c);
  return { cues: out, stems, master: { lufs: -14, ...(fix.master || {}) }, warnings };
}

// ---------- synthesis (browser) ----------
const db = (x) => Math.pow(10, x / 20);
const semi = (p) => Math.pow(2, p / 12);
const FLOOR = 1e-4;
const fnv = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const easeIn = (x, p = 2) => Math.pow(x, p);

const gain = (c, v = 1) => { const g = c.ac.createGain(); g.gain.value = v; return g; };
const biquad = (c, type, f, q = 0.707) => { const b = c.ac.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
/**
 * Order-stable summing bus. Chrome sums fan-in connections in pointer order, and float addition is not
 * associative, so any node with 3+ inputs renders non-reproducibly. A chain of 2-input gains is exact.
 */
function makeSum(c) {
  let tail = null;
  // Every summed signal is first forced to 2 channels in a single-input node: summing mono with stereo
  // in one fan-in is also not reproducible in Chrome.
  const stereo = (n) => {
    const g = gain(c, 1);
    g.channelCount = 2; g.channelCountMode = 'explicit'; g.channelInterpretation = 'speakers';
    n.connect(g);
    return g;
  };
  return {
    add(n) {
      const s = stereo(n);
      if (!tail) tail = s;
      else { const g = gain(c, 1); g.channelCount = 2; g.channelCountMode = 'explicit'; tail.connect(g); s.connect(g); tail = g; }
      return n;
    },
    get node() { return tail; },
  };
}
const panner = (c, p = 0) => { const n = c.ac.createStereoPanner(); n.pan.value = p; return n; };
function osc(c, type, freq, t0, t1) {
  const o = c.ac.createOscillator();
  o.type = type; o.frequency.value = freq; o.start(t0); o.stop(t1);
  return o;
}
function noiseBuf(c, rng, secs, pink = false) {
  const n = Math.max(2, Math.ceil(secs * c.ac.sampleRate));
  const buf = c.ac.createBuffer(2, n, c.ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = rng() * 2 - 1;
      if (pink) { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.3; }
      else d[i] = w;
    }
  }
  return buf;
}
function noise(c, rng, t0, secs, pink = false) {
  const s = c.ac.createBufferSource();
  // 50 ms slack past the nominal end so the source never ends on the same frame as another event
  s.buffer = noiseBuf(c, rng, secs + 0.05, pink);
  s.start(t0); s.stop(t0 + secs + 0.05);
  return s;
}
/** Percussive envelope: floor -> peak (linear attack) -> floor (exponential decay). */
function env(param, t0, peak, attack, decay) {
  param.setValueAtTime(FLOOR, t0);
  param.linearRampToValueAtTime(peak, t0 + attack);
  param.exponentialRampToValueAtTime(FLOOR, t0 + attack + decay);
}
/** Drive an AudioParam with fn(u) for u in 0..1 over [t0, t0+dur]. */
function curve(param, t0, dur, fn, n = 128) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = fn(i / (n - 1));
  param.setValueCurveAtTime(a, t0, dur);
}
const expSweep = (a, b, u) => a * Math.pow(b / a, u);
function softClip(c, drive = 2.2) {
  const ws = c.ac.createWaveShaper();
  const n = 2048, k = new Float32Array(n), norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) k[i] = Math.tanh(((i / (n - 1)) * 2 - 1) * drive) / norm;
  ws.curve = k; ws.oversample = '4x';
  return ws;
}
const path = (a, b, u) => (u < 0 ? a : u > 1 ? b : a + (b - a) * u);

/** Inharmonic bell: partials [ratio, gain, decayScale]. */
function bell(c, bus, T, freq, { peak = 0.3, decay = 0.8, send = 0.25, attack = 0.001, partials } = {}) {
  const P = partials || [[1, 1, 1], [2.76, 0.32, 0.45], [5.4, 0.08, 0.2]];
  const sum = makeSum(c);
  for (const [r, g, d] of P) {
    const dd = decay * d;
    const o = osc(c, 'sine', freq * r, T, T + attack + dd + 0.02);
    const e = gain(c, 0);
    env(e.gain, T, peak * g, attack, dd);
    o.connect(e); sum.add(e);
  }
  bus.out(sum.node, send);
}

// ---- hits / motion: intensity, variants and per-cue variance ----
const lerp = (a, b, u) => a + (b - a) * u;
const amp = (I) => 0.1 + 1.5 * Math.pow(I, 1.2); // overall layer scale from intensity
/** Per-cue variance, all drawn from the cue rng (fixed draw order => deterministic). */
function vary(rng) {
  const j = (k) => 1 + (rng() * 2 - 1) * k;
  // layer balance: +-2 dB per layer, mean removed so the overall level stays put
  const bd = [0, 0, 0].map(() => (rng() * 2 - 1) * 2), bm = (bd[0] + bd[1] + bd[2]) / 3;
  return {
    st: (rng() * 2 - 1) * 2,          // pitch, +-2 semitones
    fc: j(0.25), fs: j(0.25),         // filter centre / sweep range, +-25%
    dur: j(0.15),                     // duration, +-15%
    curv: rng() * 2 - 1,              // envelope curvature
    wid: 0.65 + rng() * 0.7,          // stereo width
    b1: db(bd[0] - bm), b2: db(bd[1] - bm), b3: db(bd[2] - bm),
  };
}
/** Cascaded lowpass pair: keeps noise layers from carrying >7 kHz energy. */
function cap(c, node, hz = 6000) {
  const a = biquad(c, 'lowpass', hz, 0.6), b = biquad(c, 'lowpass', hz * 1.15, 0.5);
  node.connect(a); a.connect(b);
  return b;
}
const swell = (u, pk, pa, pd) => (u < pk ? easeIn(u / pk, pa) : Math.pow(1 - (u - pk) / (1 - pk), pd));

const IMPACT = {
  thud:  { sub: [95, 48, 0.16], subLvl: 0.68, subAtk: 0.004, dec: [0.3, 0.6], body: 0, crack: 0, cLp: [1500, 260], cAtk: 0.005, cDec: 0.07, felt: 0.22, drive: 0, send: [0.04, 0.16], wide: 0 },
  punch: { sub: [118, 46, 0.10], subLvl: 0.9, subAtk: 0.003, dec: [0.14, 0.3], body: 0.26, crack: 0.3, cLp: [3600, 600], cAtk: 0.003, cDec: 0.06, felt: 0, drive: [0.8, 1.3], send: [0.06, 0.2], wide: 0 },
  boom:  { sub: [82, 32, 0.28], subLvl: 1.0, subAtk: 0.004, dec: [0.6, 1.5], body: 0.2, crack: 0.22, cLp: [2600, 380], cAtk: 0.004, cDec: 0.1, felt: 0, drive: [0.8, 1.5], send: [0.14, 0.5], wide: 1 },
};

function impactCore(c, bus, T, o, rng, V, I, variant) {
  const P = IMPACT[variant] || IMPACT.punch, A = amp(I), f = semi((o.pitch || 0) + V.st);
  const sum = makeSum(c);
  const dec = lerp(P.dec[0], P.dec[1], I) * V.dur;
  const s = osc(c, 'sine', P.sub[0] * f, T, T + dec + 0.1);
  s.frequency.setValueAtTime(P.sub[0] * f * lerp(0.9, 1, I), T);
  s.frequency.exponentialRampToValueAtTime(P.sub[1] * f * lerp(1.1, 1, I), T + P.sub[2] * V.dur);
  const sg = gain(c, 0); env(sg.gain, T, P.subLvl * A * V.b1, P.subAtk, dec);
  s.connect(sg); sum.add(sg);
  if (P.body) {
    const body = osc(c, 'triangle', 200 * f, T, T + 0.3);
    body.frequency.setValueAtTime(200 * f, T);
    body.frequency.exponentialRampToValueAtTime(70 * f, T + 0.07 * V.dur);
    const bl = biquad(c, 'lowpass', 900 * V.fc, 0.7), bg = gain(c, 0);
    env(bg.gain, T, P.body * A * V.b2 * lerp(0.6, 1, I), 0.003, 0.12 * V.dur);
    body.connect(bl); bl.connect(bg); sum.add(bg);
  }
  const lvl = P.crack ? P.crack * Math.pow(I, 1.3) * 1.6 * A : P.felt * A;
  if (lvl > 0) {
    const n = noise(c, rng, T, 0.3);
    const lp = biquad(c, 'lowpass', P.cLp[0] * V.fc, 0.6);
    lp.frequency.setValueAtTime(P.cLp[0] * V.fc, T);
    lp.frequency.exponentialRampToValueAtTime(P.cLp[1] * V.fc * V.fs, T + 0.12 * V.dur);
    const ng = gain(c, 0); env(ng.gain, T, lvl * V.b3, P.cAtk, P.cDec * V.dur * lerp(0.8, 1.3, I));
    n.connect(lp); const e = cap(c, lp, 4800); e.connect(ng); sum.add(ng);
  }
  let out = sum.node;
  if (P.drive) {
    const ws = softClip(c, lerp(P.drive[0], P.drive[1], I)), post = gain(c, 0.62);
    out.connect(ws); ws.connect(post); out = post;
  } else { const post = gain(c, 0.66); out.connect(post); out = post; }
  bus.out(out, lerp(P.send[0], P.send[1], I));
  if (P.wide) { // low rumble bed, panned wide, for the hero hit
    [-1, 1].forEach((d) => {
      const n = noise(c, rng, T, 1.6, true), lp = biquad(c, 'lowpass', 380 * V.fc, 0.7), g = gain(c, 0), pn = panner(c, d * 0.6 * V.wid);
      env(g.gain, T, 0.2 * A * (d < 0 ? V.b2 : V.b3), 0.012, lerp(0.5, 1.2, I) * V.dur);
      n.connect(lp); lp.connect(g); g.connect(pn); bus.out(pn, 0.2);
    });
  }
}

const RECIPES = {
  impact(c, bus, T, o, rng) {
    const V = vary(rng);
    impactCore(c, bus, T, o, rng, V, intensityOf(o), o.variant || 'punch');
  },

  logo(c, bus, T, o, rng) {
    const V = vary(rng), I = intensityOf(o), A = amp(I);
    impactCore(c, bus, T, o, rng, V, I, o.variant || 'boom');
    const f = 880 * semi((o.pitch || 0) + V.st);
    [1, 1.2599, 1.4983, 2].forEach((r, i) => {
      bell(c, bus, T + 0.02 + i * 0.035, f * r, { peak: 0.11 * A * (i % 2 ? V.b2 : V.b1), decay: lerp(1.0, 1.8, I) * V.dur, send: lerp(0.2, 0.5, I), attack: 0.005 });
    });
    // soft airy sparkle, band-limited well below 7 kHz
    const n = noise(c, rng, T, 0.5, true), bp = biquad(c, 'bandpass', 4200 * V.fc, 0.7), g = gain(c, 0);
    env(g.gain, T, 0.035 * I * V.b3, 0.02, 0.35 * V.dur);
    n.connect(bp); const e = cap(c, bp, 5500); e.connect(g); bus.out(g, 0.35);
  },

  swoosh(c, bus, T, o, rng) {
    const V = vary(rng), I = intensityOf(o), A = amp(I), v = o.variant || 'silk';
    const W = v === 'wash'
      ? { len: 1.05, f: [250, 1500, 2000], q: 0.45, hz: 3800, lvl: 0.5, pk: 0.55, pa: 1.5, pd: 1.4, wide: 1.25 }
      : { len: 0.8, f: [350, 2200, 2800], q: 0.7, hz: 4200, lvl: 0.55, pk: 0.62, pa: 2.0, pd: 1.7, wide: 1 };
    const len = (o.dur ?? W.len) * V.dur * lerp(0.8, 1.1, I), pre = len * W.pk, T0 = T - pre, pk = W.pk; bus.onset = T0;
    const cv = 1 + 0.3 * V.curv, pf = semi((o.pitch || 0) + V.st * 0.5);
    [[-0.6, 1, V.b1], [0.6, 1.12, V.b2]].forEach(([p, fm, b]) => {
      const n = noise(c, rng, T0, len, true);
      const bp = biquad(c, 'bandpass', 800, W.q), g = gain(c, 0), pn = panner(c, clampN(p * V.wid * W.wide, -1, 1));
      const a = W.f[0] * V.fc * pf * fm, m = W.f[1] * V.fc * V.fs * pf * fm, z = W.f[2] * V.fc * pf * fm;
      curve(bp.frequency, T0, len, (u) => (u < pk ? expSweep(a, m, easeIn(u / pk, 1.6)) : expSweep(m, z, (u - pk) / (1 - pk))));
      curve(g.gain, T0, len, (u) => W.lvl * A * b * swell(u, pk, W.pa * cv, W.pd * cv));
      n.connect(bp); const e = cap(c, bp, Math.min(7000, W.hz * V.fc)); e.connect(g); g.connect(pn); bus.out(pn, lerp(0.1, 0.3, I));
    });
  },

  whoosh(c, bus, T, o, rng) {
    const V = vary(rng), I = intensityOf(o), A = amp(I), v = o.variant || 'air';
    const W = {
      air:   { len: 0.4,  f: [420, 1700, 520],  q: [0.55, 0.9, 0.6],  hz: 4500, lvl: 0.7,  wide: 1.2 },
      swipe: { len: 0.35, f: [650, 2400, 800],  q: [1.4, 2.2, 1.5],   hz: 5200, lvl: 0.55, wide: 1 },
      zip:   { len: 0.26, f: [900, 3800, 1200], q: [1.6, 2.6, 1.8],   hz: 6500, lvl: 0.65, wide: 0.9 },
    }[v];
    if (!W) throw new Error(`whoosh: unknown variant "${v}"`);
    const len = (o.dur ?? W.len) * V.dur, pre = len * 0.55, T0 = T - pre, pk = pre / len; bus.onset = T0;
    const cv = 1 + 0.35 * V.curv, pf = semi((o.pitch || 0) + V.st), d = o.pan < 0 ? -1 : 1;
    const a = W.f[0] * V.fc * pf, m = W.f[1] * V.fc * V.fs * pf, z = W.f[2] * V.fc * pf;
    const gcurve = (u) => A * swell(u, pk, 2 * cv, 1.6 * cv);
    const n = noise(c, rng, T0, len, true);
    const bp = biquad(c, 'bandpass', 800, 1), g = gain(c, 0), pn = panner(c, 0);
    curve(bp.frequency, T0, len, (u) => (u < pk ? expSweep(a, m, easeIn(u / pk, 1.5)) : expSweep(m, z, 1 - Math.pow(1 - (u - pk) / (1 - pk), 2))));
    curve(bp.Q, T0, len, (u) => (u < pk ? path(W.q[0], W.q[1], u / pk) : path(W.q[1], W.q[2], (u - pk) / (1 - pk))));
    curve(g.gain, T0, len, (u) => W.lvl * V.b1 * gcurve(u));
    curve(pn.pan, T0, len, (u) => clampN((o.pan || 0) * 0.5 + d * (u * 2 - 1) * 0.6 * V.wid * W.wide, -1, 1));
    n.connect(bp); const e = cap(c, bp, Math.min(7000, W.hz * V.fc)); e.connect(g); g.connect(pn); bus.out(pn, lerp(0.06, 0.2, I));
    if (v === 'swipe') { // quiet pitched glide under the noise
      const t = osc(c, 'triangle', 300 * pf, T0, T0 + len + 0.02);
      const lo = 280 * pf * V.fc, hi = 640 * pf * V.fc * V.fs;
      curve(t.frequency, T0, len, (u) => (d > 0 ? expSweep(lo, hi, u) : expSweep(hi, lo, u)));
      const tl = biquad(c, 'lowpass', 1800, 0.7), tg = gain(c, 0), tp = panner(c, (o.pan || 0) * 0.5);
      curve(tg.gain, T0, len, (u) => 0.1 * V.b2 * gcurve(u));
      t.connect(tl); tl.connect(tg); tg.connect(tp); bus.out(tp, 0.1);
    }
  },

  suck(c, bus, T, o, rng) {
    const V = vary(rng), I = intensityOf(o), A = amp(I);
    const len = (o.dur ?? 0.55) * V.dur, T0 = T - len, pf = semi((o.pitch || 0) + V.st); bus.onset = T0;
    const n = noise(c, rng, T0, len, true);
    const bp = biquad(c, 'bandpass', 2400, 0.9), g = gain(c, 0);
    const fade = 0.012 / len; // short 12 ms release into the point, folded into the one gain curve
    const cv = 1 + 0.3 * V.curv, top = 2400 * V.fc * V.fs, bot = 420 * V.fc;
    curve(bp.frequency, T0, len, (u) => expSweep(top, bot, easeIn(u, 0.8)));
    curve(bp.Q, T0, len, (u) => path(0.8, 2.2, u));
    curve(g.gain, T0, len, (u) => 0.7 * A * V.b1 * (u < 1 - fade ? easeIn(u / (1 - fade), 2.2 * cv) : (1 - u) / fade), 256);
    n.connect(bp); const e = cap(c, bp, 4800); e.connect(g);
    const sn = panner(c, 0); g.connect(sn); bus.out(sn, lerp(0.04, 0.14, I));
    // low gulp that lands on the point
    const f = 170 * pf;
    const s = osc(c, 'sine', f, T, T + 0.25);
    s.frequency.setValueAtTime(f, T);
    s.frequency.exponentialRampToValueAtTime(52 * pf, T + 0.09);
    const sg = gain(c, 0); env(sg.gain, T, 0.32 * A * V.b2, 0.004, lerp(0.09, 0.16, I));
    s.connect(sg); bus.out(sg, 0.08);
  },

  rise(c, bus, T, o, rng) {
    const V = vary(rng), I = intensityOf(o), A = amp(I);
    const len = (o.dur ?? 1.5) * V.dur, T0 = T - len, f0 = 110 * semi((o.pitch || 0) + V.st); bus.onset = T0;
    const fade = 0.03 / len; // 30 ms release into the hit, folded into each gain curve
    const cv = 1 + 0.3 * V.curv;
    const rel = (u, peak, p) => (u < 1 - fade ? peak * easeIn(u / (1 - fade), p * cv) : (peak * (1 - u)) / fade);
    const n = noise(c, rng, T0, len, true);
    const lp = biquad(c, 'lowpass', 300, 1.0), ng = gain(c, 0);
    curve(lp.frequency, T0, len, (u) => expSweep(300 * V.fc, 6000 * V.fc * V.fs, easeIn(u, 1.4)));
    curve(ng.gain, T0, len, (u) => rel(u, 0.45 * A * V.b1, 2), 256);
    n.connect(lp); const e = cap(c, lp, 6000); e.connect(ng); bus.out(ng, lerp(0.08, 0.2, I));
    // detuned saw pad rising in pitch and cutoff
    const pad = gain(c, 0), pf = biquad(c, 'lowpass', 400, 1.5);
    curve(pf.frequency, T0, len, (u) => expSweep(400 * V.fc, 4800 * V.fc * V.fs, easeIn(u, 1.5)));
    curve(pad.gain, T0, len, (u) => rel(u, 0.13 * A * V.b2, 1.8), 256);
    pf.connect(pad);
    const saws = makeSum(c);
    [-1, 0, 1].forEach((k) => {
      const s = osc(c, 'sawtooth', f0, T0, T);
      s.detune.value = k * (7 + rng() * 5);
      curve(s.frequency, T0, len, (u) => f0 * Math.pow(2, easeIn(u, 1.6)));
      const pn = panner(c, k * 0.4 * V.wid);
      s.connect(pn); saws.add(pn);
    });
    saws.node.connect(pf);
    bus.out(pad, lerp(0.08, 0.2, I));
  },

  click(c, bus, T, o, rng) {
    const f = semi(o.pitch || 0);
    const n = noise(c, rng, T, 0.02);
    const hp = biquad(c, 'highpass', 1500), bp = biquad(c, 'bandpass', 3500 * f, 0.8), g = gain(c, 0);
    env(g.gain, T, 0.7, 0.0005, 0.011);
    n.connect(hp); hp.connect(bp); bp.connect(g); bus.out(g, 0.05);
    const s = osc(c, 'sine', 1800 * f, T, T + 0.05), sg = gain(c, 0);
    env(sg.gain, T, 0.22, 0.0007, 0.022);
    s.connect(sg); bus.out(sg, 0.06);
  },

  pop(c, bus, T, o, rng) {
    const f = semi(o.pitch || 0);
    const dur = 0.075;
    const sum = makeSum(c);
    const s = osc(c, 'sine', 900 * f, T, T + 0.15);
    s.frequency.setValueAtTime(900 * f, T);
    s.frequency.exponentialRampToValueAtTime(600 * f, T + dur);
    const sg = gain(c, 0); env(sg.gain, T, 0.55, 0.002, dur + 0.02);
    s.connect(sg); sum.add(sg);
    const t = osc(c, 'triangle', 900 * f, T, T + 0.15);
    t.frequency.setValueAtTime(900 * f, T);
    t.frequency.exponentialRampToValueAtTime(600 * f, T + dur);
    const tl = biquad(c, 'lowpass', 3200 * f, 0.7), tg = gain(c, 0);
    env(tg.gain, T, 0.22, 0.002, dur);
    t.connect(tl); tl.connect(tg); sum.add(tg);
    const n = noise(c, rng, T, 0.01), hp = biquad(c, 'highpass', 2500), ng = gain(c, 0);
    env(ng.gain, T, 0.16, 0.0005, 0.004);
    n.connect(hp); hp.connect(ng); sum.add(ng);
    bus.out(sum.node, 0.12);
  },

  tick(c, bus, T, o, rng) {
    const n = noise(c, rng, T, 0.015);
    const bp = biquad(c, 'bandpass', 5000 * semi(o.pitch || 0), 1), hp = biquad(c, 'highpass', 2500), g = gain(c, 0);
    env(g.gain, T, 0.3, 0.0004, 0.004);
    n.connect(hp); hp.connect(bp); bp.connect(g); bus.out(g, 0.03);
  },

  type(c, bus, T, o, rng) {
    const dur = o.dur ?? 1.0, count = Math.max(1, Math.round(dur * 11));
    const gaps = Array.from({ length: count }, () => 0.45 + rng() * 1.1);
    const total = gaps.reduce((a, b) => a + b, 0);
    let tt = 0;
    const f = semi(o.pitch || 0);
    for (let i = 0; i < count; i++) {
      const T1 = T + tt;
      tt += (gaps[i] / total) * dur;
      const amp = 0.6 + rng() * 0.4, fr = (2400 + rng() * 2400) * f;
      const n = noise(c, rng, T1, 0.02);
      const hp = biquad(c, 'highpass', 1800), bp = biquad(c, 'bandpass', fr, 1.1), g = gain(c, 0), pn = panner(c, (rng() - 0.5) * 0.3);
      env(g.gain, T1, 0.3 * amp, 0.0005, 0.006);
      n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(pn); bus.out(pn, 0.04);
      const s = osc(c, 'sine', (180 + rng() * 60) * f, T1, T1 + 0.03), sg = gain(c, 0);
      env(sg.gain, T1, 0.1 * amp, 0.0008, 0.014);
      s.connect(sg); bus.out(sg, 0.03);
    }
  },

  // short UI beep: `soft` = sine with a rounded 5 ms attack (~0.14 s), `digital` = band-limited square, flat hold (~0.09 s)
  beep(c, bus, T, o) {
    const dig = o.variant === 'digital', f = (dig ? 1568 : 1046.5) * semi(o.pitch || 0);
    const len = clampN(isNum(o.dur) ? o.dur : dig ? 0.09 : 0.14, 0.02, 2), atk = dig ? 0.002 : 0.005, rel = dig ? 0.012 : Math.min(0.08, len * 0.6);
    const hold = Math.max(atk, len - rel);
    const s = osc(c, dig ? 'square' : 'sine', f, T, T + len + 0.05), g = gain(c, 0), pk = dig ? 0.14 : 0.27;
    g.gain.setValueAtTime(FLOOR, T);
    g.gain.linearRampToValueAtTime(pk, T + atk);
    g.gain.setValueAtTime(pk, T + hold);
    g.gain.exponentialRampToValueAtTime(FLOOR, T + len);
    if (dig) { const lp = biquad(c, 'lowpass', 4200, 0.7); s.connect(lp); lp.connect(g); } else s.connect(g);
    bus.out(g, dig ? 0.04 : 0.08);
  },

  // filtered-noise breeze bed from `t` for `dur` (default breeze 2.5 s, gust 2 s): slow seeded drift of the band
  // centre and level; `gust` = brighter, one or two swells. intensity = level + brightness.
  wind(c, bus, T, o, rng) {
    const I = intensityOf(o), A = amp(I), gust = o.variant === 'gust';
    const len = clampN(isNum(o.dur) ? o.dur : gust ? 2 : 2.5, 0.3, 30), pf = semi(o.pitch || 0);
    const fade = Math.min(gust ? 0.35 : 0.8, len * 0.3), n = Math.max(64, Math.ceil(len * 40));
    const lfo = () => { const r = 0.08 + rng() * 0.25, ph = rng() * Math.PI * 2; return (u) => Math.sin(ph + u * len * r * Math.PI * 2); };
    const swells = gust ? Array.from({ length: 1 + (rng() < 0.5 ? 1 : 0) }, () => ({ at: 0.25 + rng() * 0.5, w: 0.12 + rng() * 0.12 })) : [];
    const shape = (u) => {
      const e = Math.min(1, u * len / fade, (1 - u) * len / fade);
      let s = gust ? 0.35 : 1;
      for (const w of swells) s += 0.9 * Math.exp(-Math.pow((u - w.at) / w.w, 2));
      return Math.max(0, e) * s;
    };
    [[-0.5, 1], [0.5, 1.18]].forEach(([p, fm]) => {
      const drift = lfo(), wob = lfo();
      const lo = (gust ? 500 : 320) * pf * fm * lerp(0.85, 1.2, I), hi = (gust ? 2600 : 1300) * pf * fm * lerp(0.8, 1.25, I);
      const src = noise(c, rng, T, len, true), bp = biquad(c, 'bandpass', lo, gust ? 0.9 : 0.6), g = gain(c, 0), pn = panner(c, p);
      curve(bp.frequency, T, len, (u) => expSweep(lo, hi, clampN(0.5 + 0.35 * drift(u) + (gust ? 0.4 * (shape(u) - 0.35) : 0), 0, 1)), n);
      curve(g.gain, T, len, (u) => 0.55 * A * shape(u) * (1 + 0.25 * wob(u)), n);
      src.connect(bp); const e = cap(c, bp, 4500); e.connect(g); g.connect(pn); bus.out(pn, lerp(0.05, 0.15, I));
    });
  },

  ding(c, bus, T, o) {
    bell(c, bus, T, 1318.5 * semi(o.pitch || 0), { peak: 0.38, decay: 0.8, send: 0.25, attack: 0.001 });
  },

  sample(c, bus, T, o) {
    const pcm = c.samples && c.samples.get(o.id);
    if (!pcm || !pcm[0].length) return;
    const buf = c.ac.createBuffer(2, pcm[0].length, SAMPLE_RATE);
    buf.copyToChannel(pcm[0], 0); buf.copyToChannel(pcm[1], 1);
    const s = c.ac.createBufferSource();
    s.buffer = buf; s.start(T);
    bus.out(s);
  },

  chime(c, bus, T, o) {
    const f = 1046.5 * semi(o.pitch || 0);
    const P = [[1, 1, 1], [2, 0.18, 0.5], [2.76, 0.16, 0.35]];
    bell(c, bus, T, f, { peak: 0.26, decay: 0.9, send: 0.35, attack: 0.004, partials: P });
    bell(c, bus, T + 0.14, f * semi(4), { peak: 0.3, decay: 1.2, send: 0.4, attack: 0.004, partials: P });
  },
};

// ---------- sample cues ----------
/** Default loader for pages served by the gfx Vite server (see runner/lib/library/serve.js). */
export const defaultSampleLoader = async (src) => {
  const r = await fetch('/@gfx-audio?src=' + encodeURIComponent(src));
  if (!r.ok) throw new Error(`sample "${src}": HTTP ${r.status}`);
  return r.arrayBuffer();
};
/** Cubic (Catmull-Rom) read at fractional position p; zero outside the buffer. */
function cubicAt(d, p) {
  const i = Math.floor(p), f = p - i, n = d.length;
  const g = (k) => (k >= 0 && k < n ? d[k] : 0);
  const a = g(i - 1), b = g(i), c = g(i + 1), e = g(i + 2);
  return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - e + f * (3 * (b - c) + e - a)));
}
/**
 * Pure DSP of one sample cue: decoded channels (at SAMPLE_RATE) -> the cue's rendered [L, R] Float32Arrays.
 * Plays `start..start+dur` at `rate` (resampled in JS, so identical in every browser), times the `env` gain
 * curve (linear interpolation over the played duration), 3 ms fade in / 20 ms fade out.
 */
export function shapeSample(chans, cue) {
  const sr = SAMPLE_RATE, total = chans[0].length;
  const rate = cue.rate > 0 ? cue.rate : 1;
  const start = Math.max(0, cue.start || 0) * sr;
  const avail = Math.max(0, total - start);
  const srcLen = Math.min(avail, isNum(cue.dur) ? Math.max(0, cue.dur) * sr : avail);
  const n = Math.max(0, Math.round(srcLen / rate));
  const out = [new Float32Array(n), new Float32Array(n)];
  const env = cue.env && cue.env.length >= 2 ? cue.env : null;
  const fin = Math.min(Math.round(0.003 * sr), n >> 2), fout = Math.min(Math.round(0.02 * sr), n >> 1);
  for (let ch = 0; ch < 2; ch++) {
    const d = chans[Math.min(ch, chans.length - 1)], o = out[ch];
    const exact = rate === 1 && Number.isInteger(start);
    for (let i = 0; i < n; i++) {
      let v = exact ? d[start + i] ?? 0 : cubicAt(d, start + i * rate);
      if (env) {
        const u = n > 1 ? (i / (n - 1)) * (env.length - 1) : 0, k = Math.min(env.length - 2, Math.floor(u));
        v *= env[k] + (env[k + 1] - env[k]) * (u - k);
      }
      if (i < fin) v *= i / fin;
      if (i >= n - fout) v *= (n - 1 - i) / fout;
      o[i] = v;
    }
  }
  return out;
}
async function loadSamples(cues, loader) {
  const dec = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const decoded = new Map(); // src -> Promise<Float32Array[]>
  const shaped = new Map(); // cue id -> [L, R]
  for (const cue of cues) {
    if (cue.sound !== 'sample' || cue.mute) continue;
    if (!loader) { console.warn(`sample cue "${cue.id}": no loader, skipped`); continue; }
    try {
      if (!decoded.has(cue.src)) {
        decoded.set(cue.src, (async () => {
          const ab = await dec.decodeAudioData((await loader(cue.src)).slice(0));
          return Array.from({ length: Math.min(2, ab.numberOfChannels) }, (_, c) => ab.getChannelData(c));
        })());
      }
      shaped.set(cue.id, shapeSample(await decoded.get(cue.src), cue));
    } catch (e) { console.warn(`sample cue "${cue.id}" (${cue.src}): ${e.message}`); }
  }
  return shaped;
}

function makeImpulse(ac, secs = 0.8, rt60 = 0.6) {
  const sr = ac.sampleRate, n = Math.floor(secs * sr), pre = Math.floor(0.012 * sr);
  const buf = ac.createBuffer(2, n, sr);
  const rng = mulberry32(0x5eed1234);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const k = 0.55 + 0.4 * Math.min(1, t / rt60); // dark from the start (~2-3 kHz), darker later
      lp += ((rng() * 2 - 1) - lp) * (1 - k);
      d[i] = lp * Math.exp((-6.9078 * t) / rt60) * Math.min(1, t / 0.004);
    }
  }
  return buf;
}

function makeCtx(duration, pad, samples) {
  const ac = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil((duration + pad) * SAMPLE_RATE), sampleRate: SAMPLE_RATE });
  const c = { ac, pad, buses: [], samples };
  c.master = makeSum(c);
  c.revSum = makeSum(c);
  // Wire everything up once all cues are scheduled (in cue order, so summation order is fixed).
  c.finish = () => {
    for (const bus of c.buses) bus.finish();
    if (c.revSum.node) {
      const conv = ac.createConvolver();
      conv.buffer = makeImpulse(ac);
      const ret = gain(c, 0.6);
      c.revSum.node.connect(conv); conv.connect(ret); c.master.add(ret);
    }
    if (c.master.node) {
      const hp = biquad(c, 'highpass', 20);
      c.master.node.connect(hp); hp.connect(ac.destination);
    }
  };
  return c;
}

// Per-sound trim so isolated cues peak around -5..-14 dBFS and stems keep headroom.
const LEVEL = { impact: 0.5, swoosh: 0.6, suck: 0.8, logo: 0.45, whoosh: 0.9, rise: 0.3, click: 0.9, pop: 0.5, tick: 1.5, type: 1.2, ding: 0.7, chime: 0.85, sample: 0.5, beep: 0.5, wind: 0.45 };

const pos = (v) => isNum(v) && v > 0;
/** Sound tweak shaping (attack / decay envelope + brightness shelf) after a cue's bus; null when the cue has none. */
function shaper(c, cue, T, onset) {
  const atk = pos(cue.attack) ? cue.attack : 0, dec = pos(cue.decay) ? cue.decay : 0;
  const br = isNum(cue.bright) && cue.bright !== 0 ? clampN(cue.bright, -1, 1) : 0;
  if (!atk && !dec && !br) return null;
  return (node) => {
    let out = node;
    if (atk || dec) {
      const g = gain(c, 1), p = g.gain;
      if (atk) { p.setValueAtTime(0, 0); p.setValueAtTime(0, onset); p.linearRampToValueAtTime(1, onset + atk); }
      if (dec) {
        const h = Math.max(T, onset + atk);
        p.setValueAtTime(1, h); p.exponentialRampToValueAtTime(FLOOR, h + dec); p.setValueAtTime(0, h + dec + 1 / SAMPLE_RATE);
      }
      out.connect(g); out = g;
    }
    if (br) { const sh = biquad(c, 'highshelf', 2500); sh.gain.value = br * 15; out.connect(sh); out = sh; }
    return out;
  };
}

function makeBus(c, cue) {
  const lin = db(cue.gain || 0) * (LEVEL[cue.sound] ?? 1);
  const acc = makeSum(c), racc = makeSum(c);
  const T = c.pad + cue.t;
  const bus = {
    onset: T, // recipes with a pre-roll (swoosh, whoosh, suck, rise) set their real start
    out(node, send = 0) {
      acc.add(node);
      if (send > 0) { const s = gain(c, send); node.connect(s); racc.add(s); }
    },
    finish() {
      const shape = shaper(c, cue, T, Math.min(T, bus.onset));
      const rev = pos(cue.reverb) ? clampN(cue.reverb, 0, 1) : 0;
      let dry = null;
      if (acc.node) {
        dry = shape ? shape(acc.node) : acc.node;
        const trim = gain(c, lin), pn = panner(c, cue.sound === 'whoosh' ? 0 : cue.pan || 0);
        dry.connect(trim); trim.connect(pn); c.master.add(pn);
      }
      if (racc.node) { const rt = gain(c, lin); (shape ? shape(racc.node) : racc.node).connect(rt); c.revSum.add(rt); }
      if (rev && dry) { const s = gain(c, rev * lin); dry.connect(s); c.revSum.add(s); }
    },
  };
  c.buses.push(bus);
  return bus;
}

/**
 * Render every stem. cues: resolved cues; opts: { duration, stems: {name:{gain,mute}}, loader }.
 * `loader(src) => Promise<ArrayBuffer>` fetches the encoded bytes of a sample cue's `src` (default: the gfx
 * Vite server route /@gfx-audio; the studio passes its read_bytes API). Without one, sample cues are skipped.
 * Returns { [stem]: [Float32Array L, Float32Array R] }, each exactly round(duration*48000) samples.
 */
export async function renderStems(cues, { duration, stems = {}, loader = typeof fetch === 'function' && typeof location !== 'undefined' ? defaultSampleLoader : null }) {
  const N = Math.round(duration * SAMPLE_RATE);
  let pad = 2;
  for (const c of cues) if (c.dur) pad = Math.max(pad, Math.ceil(c.dur * 1.6 + 0.5)); // variance + variants stretch dur
  const names = [...new Set(cues.map((c) => c.stem))];
  const samples = await loadSamples(cues.filter((c) => !stems[c.stem]?.mute), loader);
  const out = {};
  for (const name of names) {
    const cfg = stems[name] || {};
    const L = new Float32Array(N), R = new Float32Array(N);
    if (!cfg.mute) {
      const c = makeCtx(duration, pad, samples);
      for (const cue of cues) {
        if (cue.stem !== name || cue.mute) continue;
        const seed = (fnv(cue.id) ^ Math.round(cue.t * 1000)) >>> 0;
        const rng = mulberry32(isNum(cue.seed) && cue.seed >= 1 ? (seed ^ fnv('seed:' + Math.round(cue.seed))) >>> 0 : seed);
        const rec = RECIPES[cue.sound];
        rec(c, makeBus(c, cue), pad + cue.t, cue, rng);
      }
      c.finish();
      const buf = await c.ac.startRendering();
      const g = db(cfg.gain || 0), off = Math.round(pad * SAMPLE_RATE);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      const fade = Math.round(0.01 * SAMPLE_RATE);
      for (let i = 0; i < N; i++) {
        const f = i >= N - fade ? (N - 1 - i) / fade : 1;
        L[i] = l[off + i] * g * f;
        R[i] = r[off + i] * g * f;
      }
    }
    out[name] = [L, R];
  }
  return out;
}
