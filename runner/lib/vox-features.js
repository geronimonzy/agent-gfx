// Shared by the library indexer (Node) and the studio Perform mode (WebView). Pure ESM: no Node-only APIs,
// no DOM. Everything operates on mono Float32Array PCM. `loadClap` imports @huggingface/transformers lazily.

export const CLAP_MODEL = 'Xenova/clap-htsat-unfused';
export const CLAP_SR = 48000;
export const CLAP_MAX_SEC = 10;

/** Fixed zero-shot label set (soft category prior). */
export const CLAP_LABELS = [
  'whoosh', 'swoosh', 'impact', 'thud', 'punch', 'click', 'tap', 'pop', 'tick', 'beep', 'ding', 'chime',
  'riser', 'sweep', 'swipe', 'zip', 'paper rustle', 'crumple', 'typing', 'glitch', 'laser', 'water drip',
  'footstep', 'door', 'cash register', 'notification',
];
/** Text prompt used for a label (CLAP likes a sentence-ish prompt). */
export const labelPrompt = (l) => `This is a sound of ${l}.`; // best of 4 templates on Kenney files (9/11 top-3)

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const toDb = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -180);

// ---------- FFT ----------
const fftCache = new Map();
function fftTables(n) {
  let t = fftCache.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  t = { cos, sin, rev, win };
  fftCache.set(n, t);
  return t;
}
/** In-place radix-2 FFT on (re, im). */
function fft(re, im) {
  const n = re.length, { cos, sin, rev } = fftTables(n);
  for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k], ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}

/** Short-time RMS envelope with a fixed hop (seconds). */
export function rmsEnvelope(x, sr, hop = 0.005, win = 0.01) {
  const H = Math.max(1, Math.round(hop * sr)), W = Math.max(H, Math.round(win * sr));
  const n = Math.max(1, Math.ceil(x.length / H));
  const out = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const a = f * H, b = Math.min(x.length, a + W);
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    out[f] = b > a ? Math.sqrt(s / (b - a)) : 0;
  }
  return { env: out, hop: H / sr };
}

/** Index range [a, b) of audible signal (relative threshold below the peak envelope), with a small margin. */
export function trimSilence(x, sr, relDb = -45, absDb = -70, margin = 0.005) {
  const { env, hop } = rmsEnvelope(x, sr, 0.005, 0.01);
  let pk = 0;
  for (const v of env) if (v > pk) pk = v;
  if (pk <= 0) return [0, 0];
  const thr = Math.max(pk * Math.pow(10, relDb / 20), Math.pow(10, absDb / 20));
  let a = 0, b = env.length - 1;
  while (a < env.length && env[a] < thr) a++;
  while (b > a && env[b] < thr) b--;
  const m = Math.round(margin * sr);
  return [clamp(Math.floor(a * hop * sr) - m, 0, x.length), clamp(Math.ceil((b + 1) * hop * sr) + m, 0, x.length)];
}

// ---------- pitch (YIN) ----------
function decimate(x, k) {
  // box-average lowpass + decimate by k
  const n = Math.floor(x.length / k), out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < k; j++) s += x[i * k + j]; out[i] = s / k; }
  return out;
}
/** YIN on one frame. Returns { f0, conf } (conf = 1 - d'(tau)), f0 = 0 when unvoiced. */
function yinFrame(x, off, W, tauMin, tauMax, sr, thr = 0.15) {
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) { const df = x[off + i] - x[off + i + tau]; s += df * df; }
    d[tau] = s;
  }
  let run = 0, best = -1, minV = 1e9, minT = tauMin;
  const cm = new Float32Array(tauMax + 1);
  cm[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
    if (tau >= tauMin && cm[tau] < minV) { minV = cm[tau]; minT = tau; }
  }
  for (let tau = tauMin; tau < tauMax; tau++) {
    if (cm[tau] < thr) { while (tau + 1 < tauMax && cm[tau + 1] < cm[tau]) tau++; best = tau; break; }
  }
  if (best < 0) return { f0: 0, conf: clamp(1 - minV, 0, 1), voiced: false };
  // parabolic interpolation
  let t = best;
  if (best > 1 && best < tauMax) {
    const a = cm[best - 1], b = cm[best], c = cm[best + 1], den = a - 2 * b + c;
    if (den !== 0) t = best + (a - c) / (2 * den);
  }
  return { f0: sr / t, conf: clamp(1 - cm[best], 0, 1), voiced: true };
}

function linreg(xs, ys, ws) {
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < xs.length; i++) { const w = ws ? ws[i] : 1; sw += w; sx += w * xs[i]; sy += w * ys[i]; }
  if (sw <= 0) return 0;
  const mx = sx / sw, my = sy / sw;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { const w = ws ? ws[i] : 1; num += w * (xs[i] - mx) * (ys[i] - my); den += w * (xs[i] - mx) ** 2; }
  return den > 1e-12 ? num / den : 0;
}

const ENV_N = 32;
/**
 * Acoustic features of a (trimmed) mono clip.
 * @returns {{dur:number, env:number[], peakDb:number, attack:number, decay:number, centroid:number, centroidSlope:number,
 *   flatness:number, pitch:{voiced:number, hz:number, conf:number, slope:number}, zcr:number, onsets:number}}
 */
export function analyze(x, sr = CLAP_SR) {
  const dur = x.length / sr;
  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  const f = { dur, env: new Array(ENV_N).fill(0), peakDb: toDb(peak), attack: 0, decay: 0, centroid: 0, centroidSlope: 0, flatness: 0, pitch: { voiced: 0, hz: 0, conf: 0, slope: 0 }, zcr: 0, onsets: 0 };
  if (x.length < 64 || peak <= 1e-6) return f;

  // 32-point RMS envelope normalized to its max
  let emax = 0;
  const env = new Float64Array(ENV_N);
  for (let k = 0; k < ENV_N; k++) {
    const a = Math.floor((k * x.length) / ENV_N), b = Math.max(a + 1, Math.floor(((k + 1) * x.length) / ENV_N));
    let s = 0;
    for (let i = a; i < b; i++) s += x[i] * x[i];
    env[k] = Math.sqrt(s / (b - a));
    if (env[k] > emax) emax = env[k];
  }
  f.env = Array.from(env, (v) => +(v / emax).toFixed(4));

  // attack (10 -> 90 % of the peak of a fine RMS envelope) and decay (peak -> -20 dB, else to the end)
  const { env: fine, hop } = rmsEnvelope(x, sr, 0.002, 0.004);
  let pi = 0;
  for (let i = 0; i < fine.length; i++) if (fine[i] > fine[pi]) pi = i;
  const pv = fine[pi];
  let i10 = 0;
  for (let i = pi; i >= 0; i--) if (fine[i] <= pv * 0.1) { i10 = i; break; }
  let i90 = pi;
  for (let i = i10; i <= pi; i++) if (fine[i] >= pv * 0.9) { i90 = i; break; }
  f.attack = Math.max(0, (i90 - i10) * hop);
  let iEnd = fine.length - 1;
  for (let i = pi; i < fine.length; i++) if (fine[i] <= pv * 0.1) { iEnd = i; break; }
  f.decay = Math.max(0, (iEnd - pi) * hop);

  // zero-crossing rate (per second)
  let zc = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++;
  f.zcr = zc / dur;

  // spectral: centroid + flatness per frame (1024 window, 10 ms hop), energy weighted
  const N = 1024, hopS = Math.round(0.01 * sr), tab = fftTables(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  const ts = [], cs = [], ws = [];
  let fSum = 0, wSum = 0, cSum = 0;
  const flux = [];
  let prevMag = null;
  for (let off = 0; off + N / 2 <= x.length; off += hopS) {
    let e = 0;
    for (let i = 0; i < N; i++) { const v = off + i < x.length ? x[off + i] : 0; re[i] = v * tab.win[i]; im[i] = 0; e += v * v; }
    if (e / N < (peak * 1e-3) ** 2) { flux.push(0); prevMag = null; continue; }
    fft(re, im);
    const bins = N / 2;
    const mag = new Float64Array(bins);
    let sm = 0, sf = 0, lg = 0, pw = 0;
    for (let k = 1; k < bins; k++) {
      const p = re[k] * re[k] + im[k] * im[k];
      mag[k] = Math.sqrt(p);
      pw += p; sm += mag[k]; sf += mag[k] * k * (sr / N);
      lg += Math.log(p + 1e-12);
    }
    if (pw <= 0 || sm <= 0) { flux.push(0); prevMag = mag; continue; }
    const cen = sf / sm, flat = Math.exp(lg / (bins - 1)) / (pw / (bins - 1));
    const w = Math.sqrt(pw);
    ts.push(off / sr); cs.push(cen); ws.push(w);
    fSum += w * clamp(flat, 0, 1); cSum += w * cen; wSum += w;
    let fl = 0;
    if (prevMag) for (let k = 1; k < bins; k++) { const dd = mag[k] - prevMag[k]; if (dd > 0) fl += dd; }
    flux.push(fl);
    prevMag = mag;
  }
  if (wSum > 0) {
    f.centroid = cSum / wSum;
    f.flatness = fSum / wSum;
    f.centroidSlope = ts.length > 2 ? linreg(ts, cs, ws) : 0;
  }

  // onset count from the fine RMS envelope: level doubles within 20 ms (and is above -35 dB of peak), 60 ms refractory
  {
    let cnt = 0, last = -1e9;
    const lag = Math.max(1, Math.round(0.02 / hop)), ref = Math.round(0.06 / hop);
    for (let i = 0; i < fine.length; i++) {
      if (fine[i] < pv * 0.0178) continue;
      if (fine[i] > Math.max(i >= lag ? fine[i - lag] : 0, pv * 0.002) * 2 && i - last > ref) { cnt++; last = i; }
    }
    f.onsets = Math.max(1, cnt);
  }

  // pitch: YIN at 16 kHz (decimated by 3 from 48 kHz; other rates decimate to ~16 kHz)
  {
    const k = Math.max(1, Math.round(sr / 16000)), sr2 = sr / k, y = k > 1 ? decimate(x, k) : x;
    const Wn = Math.round(0.032 * sr2), tauMin = Math.round(sr2 / 1000), tauMax = Math.round(sr2 / 60);
    const hp = Math.round(0.01 * sr2);
    const thr = peak * 0.02;
    const pt = [], ps = [], pw2 = [], confs = [];
    let frames = 0, voiced = 0;
    for (let off = 0; off + Wn + tauMax <= y.length; off += hp) {
      let e = 0;
      for (let i = 0; i < Wn; i++) e += y[off + i] * y[off + i];
      if (Math.sqrt(e / Wn) < thr) continue; // silence is not counted as unvoiced
      frames++;
      const r = yinFrame(y, off, Wn, tauMin, tauMax, sr2);
      confs.push(r.conf);
      if (r.voiced) { voiced++; pt.push((off + Wn / 2) / sr2); ps.push(12 * Math.log2(r.f0 / 440)); pw2.push(r.conf); }
    }
    if (frames) {
      f.pitch.voiced = voiced / frames;
      f.pitch.conf = confs.reduce((a, b) => a + b, 0) / confs.length;
      if (voiced) {
        const sorted = ps.slice().sort((a, b) => a - b);
        f.pitch.hz = 440 * Math.pow(2, sorted[Math.floor(sorted.length / 2)] / 12);
        f.pitch.slope = voiced > 2 ? linreg(pt, ps, pw2) : 0;
      }
    }
  }
  const r4 = (v) => +v.toFixed(4);
  f.dur = r4(f.dur); f.attack = r4(f.attack); f.decay = r4(f.decay); f.centroid = +f.centroid.toFixed(1);
  f.centroidSlope = +f.centroidSlope.toFixed(1); f.flatness = r4(f.flatness); f.peakDb = +f.peakDb.toFixed(2);
  f.pitch = { voiced: r4(f.pitch.voiced), hz: +f.pitch.hz.toFixed(2), conf: r4(f.pitch.conf), slope: +f.pitch.slope.toFixed(3) };
  f.zcr = +f.zcr.toFixed(1);
  return f;
}

/** Band energy shares of a (trimmed) mono clip: [low < 250 Hz, mid 250-4k, high > 4k], summing to 1 (3 decimals).
 * Power spectrum averaged over up to 64 Hann frames of 2048 (one FFT pass per frame). Silence -> [0, 0, 0]. */
export function bandEnergies(x, sr = CLAP_SR, edges = [250, 4000]) {
  const N = 2048, tab = fftTables(N), re = new Float64Array(N), im = new Float64Array(N), out = [0, 0, 0];
  const frames = Math.max(1, Math.ceil(x.length / (N / 2))), step = Math.max(1, Math.ceil(frames / 64));
  const k1 = Math.round((edges[0] * N) / sr), k2 = Math.round((edges[1] * N) / sr);
  for (let f = 0; f < frames; f += step) {
    const off = f * (N / 2);
    for (let i = 0; i < N; i++) { re[i] = (x[off + i] ?? 0) * tab.win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < N / 2; k++) out[k < k1 ? 0 : k < k2 ? 1 : 2] += re[k] * re[k] + im[k] * im[k];
  }
  const z = out[0] + out[1] + out[2];
  return z > 0 ? out.map((v) => +(v / z).toFixed(3)) : [0, 0, 0];
}

// ---------- vector + distance ----------
const FV_WEIGHTS = [1.2, 0.8, 1.2, 1, 1.5, 0.8, 1.2, 1, 0.8, 1, 0.8, 0.8, 1, 1, 1, 1, 1, 1, 1, 1];
/** Normalized numeric vector (each component roughly 0..1, or -1..1 for slopes). Length 20. */
export function featureVector(f) {
  const lg = (v, lo, hi) => clamp((Math.log(Math.max(v, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)), 0, 1);
  const env8 = [];
  for (let k = 0; k < 8; k++) { let s = 0; for (let j = 0; j < 4; j++) s += f.env[k * 4 + j] ?? 0; env8.push(s / 4); }
  const p = f.pitch || { voiced: 0, hz: 0, slope: 0 };
  return [
    lg(f.dur, 0.03, 8),
    clamp((f.peakDb + 60) / 60, 0, 1),
    lg(f.attack, 0.001, 0.5),
    lg(f.decay, 0.01, 4),
    lg(f.centroid, 100, 10000),
    clamp(f.centroidSlope / 8000, -1, 1),
    clamp(f.flatness * 4, 0, 1),
    p.voiced,
    p.voiced > 0.2 ? clamp((12 * Math.log2(p.hz / 55)) / 72, 0, 1) : 0,
    p.voiced > 0.2 ? clamp(p.slope / 24, -1, 1) : 0,
    clamp(f.zcr / 12000, 0, 1),
    clamp((f.onsets - 1) / 7, 0, 1),
    ...env8,
  ];
}
/** Weighted euclidean distance between two feature objects (or vectors), scaled to ~0..1. */
export function distance(a, b) {
  const va = Array.isArray(a) ? a : featureVector(a), vb = Array.isArray(b) ? b : featureVector(b);
  let s = 0, wsum = 0;
  for (let i = 0; i < va.length; i++) { const w = FV_WEIGHTS[i] ?? 1; s += w * (va[i] - vb[i]) ** 2; wsum += w; }
  return clamp(Math.sqrt(s / wsum) * 1.6, 0, 1);
}

// ---------- event segmentation (onset -> offset), shared by indexer (long files) and Perform ----------
/**
 * Split a clip into sound events. Returns [{ start, dur, strength }] in seconds, in time order.
 * An event starts when the (fast) RMS crosses `onDb` above the running noise floor / below-peak gate, and ends
 * when the RMS stays below `offDb` relative to the event peak for `hold` seconds (or a new onset >= 9 dB
 * above the decaying level begins, if `splitOnsets`).
 */
export function segmentEvents(x, sr, { gateDb = -40, offDb = -24, hold = 0.06, minDur = 0.03, maxDur = 8, splitOnsets = true, mergeGap = 0.04 } = {}) {
  const { env, hop } = rmsEnvelope(x, sr, 0.005, 0.01);
  let pk = 0;
  for (const v of env) if (v > pk) pk = v;
  if (pk <= 0) return [];
  const gate = pk * Math.pow(10, gateDb / 20);
  const holdN = Math.max(1, Math.round(hold / hop));
  const raw = [];
  let i = 0;
  while (i < env.length) {
    if (env[i] < gate) { i++; continue; }
    let s = i, evPk = env[i], below = 0, e = i;
    for (; i < env.length; i++) {
      const v = env[i];
      if (v > evPk) evPk = v;
      if (splitOnsets && evPk > gate * 4 && i > s + 2 && v > env[i - 1] * 2.8 && env[i - 1] < evPk * 0.35 && v > gate * 2) { if (i - s > 2) break; }
      if (v < Math.max(gate, evPk * Math.pow(10, offDb / 20))) { below++; if (below >= holdN) break; } else { below = 0; e = i; }
    }
    raw.push({ s, e: Math.max(e, s) + 1, pk: evPk });
    if (i === s) i++;
  }
  // merge events closer than mergeGap
  const mg = [];
  for (const r of raw) {
    const last = mg[mg.length - 1];
    if (last && (r.s - last.e) * hop < mergeGap) { last.e = r.e; last.pk = Math.max(last.pk, r.pk); } else mg.push({ ...r });
  }
  return mg
    .map((r) => ({ start: Math.max(0, r.s * hop - 0.005), dur: Math.min(maxDur, (r.e - r.s) * hop + 0.015), strength: toDb(r.pk) }))
    .filter((r) => r.dur >= minDur);
}

// ---------- embeddings: base64 f32 and cosine ----------
export function embToB64(emb) {
  const u8 = new Uint8Array(emb.buffer, emb.byteOffset, emb.byteLength);
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToEmb(b64) {
  const s = atob(b64), u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
/** Embeddings are stored L2-normalized, so cosine = dot. */
export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
function l2(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / s;
  return o;
}

/** Linear resample to 48 kHz (inputs from the indexer are already 48 kHz; the studio passes decodeAudioData output). */
export function resampleTo(x, from, to = CLAP_SR) {
  if (from === to) return x;
  const n = Math.floor((x.length * to) / from), out = new Float32Array(n), r = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * r, i0 = Math.floor(p), fr = p - i0;
    out[i] = x[i0] * (1 - fr) + (x[Math.min(i0 + 1, x.length - 1)] ?? 0) * fr;
  }
  return out;
}

/**
 * Load CLAP (ONNX via @huggingface/transformers). Same code path in Node and in a browser/WebView.
 *
 * Model files must exist under `<modelPath>/<model>/` (config.json, preprocessor_config.json, tokenizer files,
 * onnx/audio_model_quantized.onnx, onnx/text_model_quantized.onnx) - see library/.models. `local:true` forbids
 * network access (env.allowRemoteModels=false). In a browser, `modelPath` must be a URL prefix that serves those
 * files (e.g. a Tauri asset/custom protocol or a Vite route); with `local:false` the Hugging Face hub is used and
 * the files are cached by transformers.js.
 *
 * @param {{modelPath?:string, model?:string, local?:boolean, dtype?:string, threads?:number, progress?:Function}} o
 * @returns {Promise<{model:string, embedAudio:(pcm:Float32Array, sr?:number)=>Promise<Float32Array>,
 *   embedText:(text:string|string[])=>Promise<Float32Array[]>, zeroShot:(emb:Float32Array, labels?:string[], temp?:number)=>Promise<{label:string,score:number,sim:number}[]>}>}
 */
export async function loadClap({ modelPath, model = CLAP_MODEL, local = true, dtype = 'q8', threads, progress } = {}) {
  const T = await import('@huggingface/transformers');
  const { env } = T;
  if (modelPath) { env.localModelPath = modelPath; env.cacheDir = modelPath; }
  env.allowLocalModels = true;
  env.allowRemoteModels = !local;
  if (local) env.useBrowserCache = false;
  if (threads && env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = threads;
  const opts = { dtype, progress_callback: progress };
  const [tokenizer, processor, textModel, audioModel] = await Promise.all([
    T.AutoTokenizer.from_pretrained(model, { progress_callback: progress }),
    T.AutoProcessor.from_pretrained(model, { progress_callback: progress }),
    T.ClapTextModelWithProjection.from_pretrained(model, opts),
    T.ClapAudioModelWithProjection.from_pretrained(model, opts),
  ]);
  const unwrap = (o) => o.text_embeds ?? o.audio_embeds ?? o.last_hidden_state;
  async function embedText(text) {
    const arr = Array.isArray(text) ? text : [text];
    const out = [];
    // one at a time: avoids padding differences between batch compositions
    for (const t of arr) {
      const inp = tokenizer(t, { padding: true, truncation: true });
      const r = await textModel(inp);
      out.push(l2(Float32Array.from(unwrap(r).data)));
    }
    return out;
  }
  async function embedAudio(pcm, sr = CLAP_SR) {
    let x = sr === CLAP_SR ? pcm : resampleTo(pcm, sr, CLAP_SR);
    if (x.length > CLAP_MAX_SEC * CLAP_SR) x = x.subarray(0, CLAP_MAX_SEC * CLAP_SR);
    const inp = await processor(x);
    const r = await audioModel(inp);
    return l2(Float32Array.from(unwrap(r).data));
  }
  let labelCache = null;
  async function labelEmbs(labels) {
    const key = labels.join('|');
    if (labelCache?.key !== key) labelCache = { key, embs: await embedText(labels.map(labelPrompt)) };
    return labelCache.embs;
  }
  /** Softmax over cosine*temp (CLAP logit scale ~ 33 when exposed; 30 is close enough for a soft prior). */
  async function zeroShot(emb, labels = CLAP_LABELS, temp = 30) {
    const le = await labelEmbs(labels);
    const sims = le.map((e) => cosine(emb, e));
    const mx = Math.max(...sims);
    const ex = sims.map((s) => Math.exp((s - mx) * temp)), z = ex.reduce((a, b) => a + b, 0);
    return labels.map((label, i) => ({ label, score: ex[i] / z, sim: sims[i] })).sort((a, b) => b.score - a.score);
  }
  return { model, embedAudio, embedText, zeroShot };
}
