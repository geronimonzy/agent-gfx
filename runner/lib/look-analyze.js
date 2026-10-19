// gfx look analyze (docs/LOOK-PIPELINE.md §1): measurements of reference images / videos and of a project's scenes, so
// Claude writes a look from numbers (palette, light, pacing, motion, sound density) instead of guesses. Only ffmpeg /
// ffprobe + plain JS; onsets and bands come from vox-features.js. Everything is deterministic (seeded k-means).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ffmpegPath, ffprobePath, FfmpegMissing } from './ffmpeg.js';
import { segmentEvents, bandEnergies } from './vox-features.js';
import { mulberry32 } from './rng.js';
import { ENGINE, readJson, presetFile } from './paths.js';

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff']);
export const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi', '.gif']);
const PX = 64; // analysis size (64 x 64)
const MOTION_FPS = 10, PALETTE_FRAMES = 8, MAX_VIDEO_S = 300, MAX_AUDIO_S = 180, AUDIO_SR = 22050;
const K = 6, MERGE_DE = 8;
export const MOTION_CALM = 0.03, MOTION_KINETIC = 0.08;

const r3 = (v) => +(+v).toFixed(3);
const r2 = (v) => +(+v).toFixed(2);

// ---------- ffmpeg plumbing ----------
function run(bin, args, { maxBytes = 256 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let p;
    try { p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch (e) { return reject(e); }
    const out = []; let n = 0, err = '';
    p.stdout.on('data', (d) => { n += d.length; if (n <= maxBytes) out.push(d); });
    p.stderr.on('data', (d) => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, out: Buffer.concat(out), err }));
  });
}
const ffmpeg = (args) => { const b = ffmpegPath(); if (!b) throw new FfmpegMissing(); return run(b, ['-hide_banner', '-nostdin', ...args]); };

async function probe(file) {
  const b = ffprobePath();
  if (!b) throw new Error('ffprobe not found (comes with ffmpeg: set GFX_FFPROBE or run `gfx setup ffmpeg`)');
  const r = await run(b, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error((r.err.trim().split('\n').pop() || 'ffprobe failed').slice(0, 200));
  return JSON.parse(r.out.toString('utf8') || '{}');
}

// ---------- colour ----------
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const LIN = Float64Array.from({ length: 256 }, (_, i) => lin(i));
const fLab = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
/** sRGB 0-255 -> CIE Lab (D65). */
export function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883;
  const fx = fLab(x), fy = fLab(y), fz = fLab(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const fInv = (t) => (t * t * t > 216 / 24389 ? t * t * t : (116 * t - 16) / (24389 / 27));
const gam = (c) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, v)) * 255); };
export function labToHex([L, a, b]) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const x = fInv(fx) * 0.95047, y = fInv(fy), z = fInv(fz) * 1.08883;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z, G = -0.969266 * x + 1.8760108 * y + 0.041556 * z, B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return '#' + [R, G, B].map((c) => gam(c).toString(16).padStart(2, '0')).join('');
}
export function hexToLab(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}
const dE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** Merge weighted Lab colours closer than `de` (largest first absorbs), sorted by weight. -> [{ lab, w }] */
function mergeColours(items, de = MERGE_DE) {
  const list = items.filter((c) => c.w > 0).map((c) => ({ lab: c.lab.slice(), w: c.w })).sort((a, b) => b.w - a.w);
  const out = [];
  for (const c of list) {
    const hit = out.find((o) => dE(o.lab, c.lab) < de);
    if (hit) { const W = hit.w + c.w; hit.lab = hit.lab.map((v, i) => (v * hit.w + c.lab[i] * c.w) / W); hit.w = W; } else out.push(c);
  }
  return out.sort((a, b) => b.w - a.w);
}

/** k-means in Lab (k-means++ seeding with a fixed seed), then clusters within ΔE < 8 merged. -> [{ hex, share }] */
export function kmeansPalette(labs, { k = K, seed = 7, iters = 24 } = {}) {
  const n = labs.length / 3;
  if (!n) return [];
  const rnd = mulberry32(seed);
  const pt = (i) => [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]];
  const cents = [pt(Math.floor(rnd() * n))];
  const d2 = new Float64Array(n).fill(Infinity);
  while (cents.length < k) {
    const c = cents[cents.length - 1];
    let sum = 0;
    for (let i = 0; i < n; i++) { const d = (labs[i * 3] - c[0]) ** 2 + (labs[i * 3 + 1] - c[1]) ** 2 + (labs[i * 3 + 2] - c[2]) ** 2; if (d < d2[i]) d2[i] = d; sum += d2[i]; }
    if (sum <= 1e-9) break; // fewer distinct colours than k
    let t = rnd() * sum, j = 0;
    for (; j < n - 1; j++) { t -= d2[j]; if (t <= 0) break; }
    cents.push(pt(j));
  }
  const asg = new Int32Array(n);
  for (let it = 0; it < iters; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < cents.length; c++) { const q = cents[c]; const d = (labs[i * 3] - q[0]) ** 2 + (labs[i * 3 + 1] - q[1]) ** 2 + (labs[i * 3 + 2] - q[2]) ** 2; if (d < bd) { bd = d; best = c; } }
      if (asg[i] !== best || it === 0) { moved++; asg[i] = best; }
    }
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { const s = sum[asg[i]]; s[0] += labs[i * 3]; s[1] += labs[i * 3 + 1]; s[2] += labs[i * 3 + 2]; s[3]++; }
    sum.forEach((s, c) => { if (s[3]) cents[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
    if (!moved) break;
  }
  const count = new Float64Array(cents.length);
  for (let i = 0; i < n; i++) count[asg[i]]++;
  return mergeColours(cents.map((lab, c) => ({ lab, w: count[c] / n }))).map((c) => ({ hex: labToHex(c.lab), share: r3(c.w) }));
}

/** Tone numbers of Lab pixels: light (mean L), contrast (L p90 - p10), saturation (mean chroma / 100), warmth. */
export function toneStats(labs) {
  const n = labs.length / 3;
  if (!n) return { light: 0, contrast: 0, saturation: 0, warmth: 0, temperature: 'neutral' };
  const Ls = new Float64Array(n);
  let sL = 0, sC = 0, warm = 0;
  for (let i = 0; i < n; i++) {
    const L = labs[i * 3], a = labs[i * 3 + 1], b = labs[i * 3 + 2];
    Ls[i] = L; sL += L;
    const C = Math.hypot(a, b); sC += C;
    // hue angle: reds .. yellows (-20..100 deg) count warm, greens-cyans-blues (140..310) count cool
    let h = Math.atan2(b, a) * 180 / Math.PI; if (h < -20) h += 360;
    if (h <= 100) warm += C; else if (h >= 140 && h <= 310) warm -= C;
  }
  Ls.sort();
  const q = (p) => Ls[Math.min(n - 1, Math.floor(p * (n - 1)))];
  const warmth = warm / n / 100;
  return {
    light: r3(sL / n / 100), contrast: r3((q(0.9) - q(0.1)) / 100), saturation: r3(Math.min(1, sC / n / 100)),
    warmth: r3(warmth), temperature: warmth > 0.03 ? 'warm' : warmth < -0.03 ? 'cool' : 'neutral',
  };
}

function labsOf(rgb) {
  const n = Math.floor(rgb.length / 3), out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) { const l = rgbToLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]); out[i * 3] = l[0]; out[i * 3 + 1] = l[1]; out[i * 3 + 2] = l[2]; }
  return out;
}
/** Ink contrast of a palette ([{ hex, share }], largest share first): the L distance (0-1) between the dominant colour
 * and the most distant colour with a share >= 1 %. Sees type / rules on paper that `contrast` (L p90 - p10) misses when
 * the ink covers < 10 % of the frame. */
export function inkContrast(palette, minShare = 0.01) {
  if (!palette || !palette.length) return 0;
  const labs = palette.map((c) => ({ L: (hexToLab(c.hex) || [0])[0], share: c.share }));
  const top = labs.reduce((a, b) => (b.share > a.share ? b : a));
  let d = 0;
  for (const c of labs) if (c.share >= minShare) d = Math.max(d, Math.abs(c.L - top.L));
  return r3(d / 100);
}
const colourOf = (labs) => { const palette = kmeansPalette(labs); return { palette, ...toneStats(labs), inkContrast: inkContrast(palette) }; };

// ---------- media ----------
const SCALE = `scale=${PX}:${PX}:flags=area`;

async function analyzeImage(file) {
  const r = await ffmpeg(['-i', file, '-frames:v', '1', '-vf', SCALE, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  if (r.code !== 0 || r.out.length < PX * PX * 3) throw new Error(errLine(r.err) || 'not an image ffmpeg can read');
  return { type: 'image', ...colourOf(labsOf(r.out.subarray(0, PX * PX * 3))) };
}

const errLine = (s) => {
  const lines = (s || '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const hit = lines.find((l) => /invalid data|could not|unsupported|no such file|not supported|failed to|error while/i.test(l));
  return (hit || lines.pop() || '').replace(/^\[[^\]]*\]\s*/, '').slice(0, 200);
};
const quant = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.max(0, Math.round(p * (arr.length - 1))))] : null);
/** median / p10 / p90 (rounded to 2 decimals) of numbers. */
export const spread = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? { median: r2(quant(s, 0.5)), p10: r2(quant(s, 0.1)), p90: r2(quant(s, 0.9)) } : null; };
export const motionLabel = (m) => (m < MOTION_CALM ? 'calm' : m > MOTION_KINETIC ? 'kinetic' : 'medium');

async function analyzeVideo(file, info) {
  const fmtDur = Number(info.format?.duration);
  const vs = info.streams.find((s) => s.codec_type === 'video');
  let duration = Number.isFinite(fmtDur) && fmtDur > 0 ? fmtDur : Number(vs?.duration) || null;
  let span = Math.min(duration || MAX_VIDEO_S, MAX_VIDEO_S);
  const lim = ['-t', String(span)];
  // frames at 10 fps, 64 x 64 RGB: motion (luma differences) + a palette over 8 evenly spaced frames
  const fr = await ffmpeg(['-i', file, ...lim, '-an', '-vf', `fps=${MOTION_FPS},${SCALE}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const FS = PX * PX * 3, nf = Math.floor(fr.out.length / FS);
  if (fr.code !== 0 && !nf) throw new Error(errLine(fr.err) || 'no video frames');
  if (!nf) throw new Error('no video frames');
  if (duration === null) { duration = nf / MOTION_FPS; span = duration; }
  let diff = 0, prev = null;
  const luma = new Float32Array(PX * PX);
  for (let f = 0; f < nf; f++) {
    const fb = fr.out.subarray(f * FS, (f + 1) * FS);
    let s = 0;
    for (let i = 0; i < PX * PX; i++) {
      const y = (0.2126 * fb[i * 3] + 0.7152 * fb[i * 3 + 1] + 0.0722 * fb[i * 3 + 2]) / 255;
      if (prev) s += Math.abs(y - prev[i]);
      luma[i] = y;
    }
    if (prev) diff += s / (PX * PX);
    prev = prev || new Float32Array(PX * PX);
    prev.set(luma);
  }
  const motion = nf > 1 ? diff / (nf - 1) : 0;
  const pick = [];
  for (let i = 0; i < Math.min(PALETTE_FRAMES, nf); i++) pick.push(Math.floor(((i + 0.5) * nf) / Math.min(PALETTE_FRAMES, nf)));
  const rgb = Buffer.concat(pick.map((f) => fr.out.subarray(f * FS, (f + 1) * FS)));
  // hard cuts: ffmpeg scene score (on a small copy: much faster, same cuts)
  const sc = await ffmpeg(['-i', file, ...lim, '-an', '-vf', "scale=160:-2,select='gt(scene,0.3)',showinfo", '-f', 'null', '-']);
  const cutTimes = [...sc.err.matchAll(/pts_time:\s*([0-9.]+)/g)].map((m) => +m[1]).filter((t) => t > 0.05 && t < span - 0.05);
  const bounds = [0, ...cutTimes, span];
  const shots = [];
  for (let i = 1; i < bounds.length; i++) if (bounds[i] - bounds[i - 1] > 0.001) shots.push(bounds[i] - bounds[i - 1]);
  const out = {
    type: 'video', duration: r2(duration), width: vs?.width || null, height: vs?.height || null,
    ...(span < duration ? { analyzedSeconds: span } : {}),
    cuts: cutTimes.length, cutTimes: cutTimes.map(r2), cutsPerSec: r3(span ? cutTimes.length / span : 0), shotLen: spread(shots),
    motion: r3(motion), motionLabel: motionLabel(motion), ...colourOf(labsOf(rgb)),
  };
  if (info.streams.some((s) => s.codec_type === 'audio')) {
    try { out.audio = await analyzeAudio(file, span); } catch (e) { out.audioSkipped = e.message; }
  }
  return out;
}

/** Sound density of a file's audio: onsets per second (vox-features segmentEvents), band shares, integrated LUFS. */
async function analyzeAudio(file, span = MAX_AUDIO_S) {
  const t = String(Math.min(span, MAX_AUDIO_S));
  const r = await ffmpeg(['-i', file, '-t', t, '-vn', '-ac', '1', '-ar', String(AUDIO_SR), '-f', 'f32le', '-']);
  if (r.code !== 0 && !r.out.length) throw new Error(errLine(r.err) || 'no audio');
  const x = new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + (r.out.length & ~3)));
  const dur = x.length / AUDIO_SR;
  const ev = dur > 0 ? segmentEvents(x, AUDIO_SR, { gateDb: -35, minDur: 0 }) : [];
  const [low, mid, high] = bandEnergies(x, AUDIO_SR);
  let lufs = null;
  const lr = await ffmpeg(['-i', file, '-t', t, '-vn', '-af', 'ebur128', '-f', 'null', '-']);
  const m = /Integrated loudness:\s*I:\s*(-?[0-9.]+|-inf)\s*LUFS/.exec(lr.err);
  if (m && m[1] !== '-inf') lufs = +(+m[1]).toFixed(1);
  return { duration: r2(dur), onsets: ev.length, onsetsPerSec: r3(dur ? ev.length / dur : 0), bands: { low, mid, high }, lufs };
}

/** One reference file -> its measurements (throws with a short reason when unreadable). */
export async function analyzeFile(file) {
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('not a file');
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXT.has(ext)) return analyzeImage(file);
  const info = await probe(file);
  const streams = info.streams || [];
  const vs = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  if (vs) {
    // a single frame (still gif, an image with an unknown extension) is an image; anything that runs is a video
    const imageCodec = /^(png|mjpeg|jpeg2000|webp|bmp|tiff|ppm|pgm|pbm|pam|svg)$/.test(vs.codec_name || '');
    const imageFormat = /(?:^|,)(?:image2|image2pipe|.*_pipe)(?:,|$)/.test(info.format?.format_name || '');
    const still = Number(vs.nb_frames) === 1 || (imageCodec && imageFormat);
    return still ? analyzeImage(file) : analyzeVideo(file, { ...info, streams });
  }
  if (streams.some((s) => s.codec_type === 'audio')) { const a = await analyzeAudio(file); return { type: 'audio', duration: a.duration, audio: a }; }
  throw new Error('no image, video or audio stream');
}

// ---------- project ----------
const listDir = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
function codeFiles(dir) {
  const out = [];
  for (const e of listDir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && !['refs', 'node_modules', 'out'].includes(e.name) && !e.name.startsWith('.')) out.push(...codeFiles(p));
    else if (e.isFile() && /\.(m?js|ts|css|html|svg)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const bump = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };
const sortCounts = (m) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)));
const ANIME_EASE = /^(linear|steps\(|cubicBezier|irregular|(in|out|inOut|outIn)(Quad|Cubic|Quart|Quint|Sine|Expo|Circ|Back|Elastic|Bounce)?\b)/;

/** Easing names and tween durations written in scene code. */
export function scanCode(text) {
  const eases = {}, durations = [];
  for (const m of text.matchAll(/\b(?:ease|easing)\s*:\s*(['"`])([^'"`\n]{1,60})\1/g)) bump(eases, m[2].trim());
  for (const m of text.matchAll(/\bcubic-bezier\(\s*([-0-9.,\s]+)\)/g)) bump(eases, `cubic-bezier(${m[1].replace(/\s+/g, '')})`);
  for (const m of text.matchAll(/\b(?:createSpring|spring)\s*\(/g)) bump(eases, 'spring()');
  for (const m of text.matchAll(/\b(?:ease|easing)\s*:\s*(?:eases\.|E\.)?([a-zA-Z]+)\b(?!\s*:)/g)) if (ANIME_EASE.test(m[1]) && !/^(true|false|null)$/.test(m[1])) bump(eases, m[1]);
  for (const m of text.matchAll(/\bduration\s*:\s*(\d+(?:\.\d+)?)\b/g)) durations.push(+m[1]);
  // css transitions / animations ("600ms", "0.6s" right after a duration keyword)
  for (const m of text.matchAll(/(?:transition|animation)(?:-duration)?\s*:[^;'"`]*?(\d+(?:\.\d+)?)(ms|s)\b/g)) durations.push(m[2] === 's' ? +m[1] * 1000 : +m[1]);
  return { eases, durations };
}

/** Sounds of a scene: out/<scene>/audio/cues.json when present, else the ctx.cue calls in the code. */
function sceneSound(root, name, code, duration) {
  const cj = readJson(path.join(root, 'out', name, 'audio', 'cues.json'), null);
  const sounds = {}, variants = {}, samples = {};
  if (cj && Array.isArray(cj.cues)) {
    for (const c of cj.cues) {
      if (c.mute) continue;
      bump(sounds, c.sound);
      if (c.variant) bump(variants, `${c.sound}:${c.variant}`);
      if (c.src) bump(samples, c.src);
    }
    const d = Number(cj.duration) || duration || 0;
    const n = Object.values(sounds).reduce((a, b) => a + b, 0);
    return { from: 'cues.json', cues: n, cuesPerSec: d ? r3(n / d) : null, sounds, variants, samples };
  }
  let n = 0;
  for (const m of code.matchAll(/\bcue\(\s*[^,()]+(?:\([^()]*\))?[^,()]*,\s*(['"`])([\w-]+)\1\s*(?:,\s*\{([^}]*)\})?/g)) {
    n++;
    bump(sounds, m[2]);
    const v = /variant\s*:\s*(['"`])([\w-]+)\1/.exec(m[3] || '');
    if (v) bump(variants, `${m[2]}:${v[2]}`);
    const s = /src\s*:\s*(['"`])([^'"`]+)\1/.exec(m[3] || '');
    if (s) bump(samples, s[2]);
  }
  const sj = readJson(path.join(root, 'scenes', name, 'sound.json'), null);
  if (sj && Array.isArray(sj.add)) for (const c of sj.add) { n++; bump(sounds, c.sound); if (c.src) bump(samples, c.src); }
  if (!n) return null;
  return { from: 'code', note: 'cue() call sites in the code (a loop counts once); run gfx audio for real counts', cues: n, cuesPerSec: null, sounds, variants, samples };
}

async function loadPreset(name, root) {
  if (!/^[\w.-]+$/.test(String(name || ''))) return null;
  const f = presetFile(name, root);
  if (!fs.existsSync(f)) return null;
  try {
    const m = await import(pathToFileURL(f).href + `?t=${fs.statSync(f).mtimeMs}`);
    const p = m.default || {};
    return {
      name, file: path.relative(root, f).startsWith('..') ? `<engine>/${path.relative(ENGINE, f).split(path.sep).join('/')}` : path.relative(root, f).split(path.sep).join('/'),
      colors: p.colors || {}, fonts: p.fonts || {}, fontFamilies: [...new Set((p.fontFiles || []).map((x) => x.family))],
      radius: p.radius ?? null, ...(p.radii ? { radii: p.radii } : {}), ease: p.ease || {},
    };
  } catch (e) { return { name, error: e.message.split('\n')[0] }; }
}

/** `--from-project`: presets, easing, tween durations, formats and sound of the project's scenes. */
export async function analyzeProject(root) {
  const cfg = readJson(path.join(root, 'gfx.json'), {});
  const scenes = [], eases = {}, durations = [], styles = {}, sounds = {}, variants = {}, samples = {};
  let cueTotal = 0, cueDur = 0;
  for (const e of listDir(path.join(root, 'scenes')).filter((x) => x.isDirectory()).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const dir = path.join(root, 'scenes', e.name);
    const sj = readJson(path.join(dir, 'scene.json'), null);
    if (!sj) continue;
    let code = '';
    for (const f of codeFiles(dir)) { try { code += fs.readFileSync(f, 'utf8') + '\n'; } catch {} }
    const sc = scanCode(code);
    for (const [k, v] of Object.entries(sc.eases)) bump(eases, k, v);
    durations.push(...sc.durations);
    if (sj.style) bump(styles, sj.style);
    const snd = sceneSound(root, e.name, code, Number(sj.duration));
    if (snd) {
      for (const [k, v] of Object.entries(snd.sounds)) bump(sounds, k, v);
      for (const [k, v] of Object.entries(snd.variants)) bump(variants, k, v);
      for (const [k, v] of Object.entries(snd.samples)) bump(samples, k, v);
      if (snd.cuesPerSec !== null && snd.cues > 0) { cueTotal += snd.cues; cueDur += Number(sj.duration) || 0; }
    }
    scenes.push({
      name: e.name, kind: sj.kind || null, width: sj.width || null, height: sj.height || null, fps: sj.fps || null,
      duration: sj.duration ?? null, style: sj.style || null, eases: sortCounts(sc.eases), tweens: sc.durations.length,
      sound: snd ? { from: snd.from, cues: snd.cues, cuesPerSec: snd.cuesPerSec } : null,
    });
  }
  const presets = [];
  for (const name of Object.keys(sortCounts(styles))) { const p = await loadPreset(name, root); if (p) presets.push({ ...p, scenes: styles[name] }); }
  const ds = durations.filter((d) => d > 0).sort((a, b) => a - b);
  return {
    root, name: cfg.name || path.basename(root), look: typeof cfg.look === 'string' ? cfg.look : null,
    scenes, presets, eases: sortCounts(eases),
    durations: ds.length ? { n: ds.length, median: Math.round(quant(ds, 0.5)), p90: Math.round(quant(ds, 0.9)), unit: 'ms' } : null,
    sound: Object.keys(sounds).length ? {
      cuesPerSec: cueDur ? r3(cueTotal / cueDur) : null, sounds: sortCounts(sounds), variants: sortCounts(variants), samples: sortCounts(samples),
    } : null,
  };
}

// ---------- summary ----------
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

const COLOUR_ORDER = ['bg', 'surface', 'text', 'accent'];
/** Colour tone of a project from its presets: each preset weighs by the scenes using it, its colours share that weight
 * equally (bg, surface, text, accent first). -> { palette (≤ 8), light, contrast, inkContrast, saturation, warmth, temperature } | null */
export function projectTone(project) {
  const presets = (project?.presets || []).filter((p) => p.colors && p.scenes > 0);
  const total = presets.reduce((a, p) => a + p.scenes, 0);
  const items = [];
  for (const p of presets) {
    const keys = [...COLOUR_ORDER.filter((k) => k in p.colors), ...Object.keys(p.colors).filter((k) => !COLOUR_ORDER.includes(k))];
    const labs = keys.map((k) => hexToLab(p.colors[k])).filter(Boolean);
    for (const lab of labs) items.push({ lab, w: p.scenes / total / labs.length });
  }
  if (!items.length) return null;
  const merged = mergeColours(items);
  // tone numbers from the colours as weighted "pixels" (1000 in all)
  const px = [];
  for (const c of merged) for (let i = 0, n = Math.max(1, Math.round(c.w * 1000)); i < n; i++) px.push(...c.lab);
  const palette = merged.slice(0, 8).map((c) => ({ hex: labToHex(c.lab), share: r3(c.w) }));
  return { palette, ...toneStats(Float64Array.from(px)), inkContrast: inkContrast(palette) };
}

/** Summary over the readable references (each reference weighs the same); with only a project, its preset colours. */
export function summarize(refs, project) {
  const vis = refs.filter((r) => r.palette);
  const pal = mergeColours(vis.flatMap((r) => r.palette.map((c) => ({ lab: hexToLab(c.hex), w: c.share / vis.length }))))
    .slice(0, 8).map((c) => ({ hex: labToHex(c.lab), share: r3(c.w) }));
  const avg = (k) => { const m = mean(vis.map((r) => r[k])); return m === null ? null : r3(m); };
  const warmth = avg('warmth');
  const vids = refs.filter((r) => r.type === 'video');
  let pacing = null;
  if (vids.length) {
    const shots = [];
    for (const v of vids) {
      const span = v.analyzedSeconds || v.duration, b = [0, ...v.cutTimes, span];
      for (let i = 1; i < b.length; i++) if (b[i] - b[i - 1] > 0.001) shots.push(b[i] - b[i - 1]);
    }
    const secs = vids.reduce((a, v) => a + (v.analyzedSeconds || v.duration), 0);
    const motion = mean(vids.map((v) => v.motion));
    pacing = { shotLen: spread(shots), cutsPerSec: r3(secs ? vids.reduce((a, v) => a + v.cuts, 0) / secs : 0), motion: r3(motion), motionLabel: motionLabel(motion) };
  }
  const auds = refs.map((r) => r.audio).filter(Boolean);
  const sound = auds.length ? {
    onsetsPerSec: r3(mean(auds.map((a) => a.onsetsPerSec))),
    bands: { low: r3(mean(auds.map((a) => a.bands.low))), mid: r3(mean(auds.map((a) => a.bands.mid))), high: r3(mean(auds.map((a) => a.bands.high))) },
    lufs: auds.some((a) => a.lufs !== null) ? +mean(auds.filter((a) => a.lufs !== null).map((a) => a.lufs)).toFixed(1) : null,
  } : null;
  const source = refs.length && project ? 'both' : refs.length ? 'refs' : 'project';
  const tone = !vis.length && project ? projectTone(project) : null;
  if (tone) return { source, palette: tone.palette, light: tone.light, contrast: tone.contrast, inkContrast: tone.inkContrast, saturation: tone.saturation, warmth: tone.warmth, temperature: tone.temperature, colourFrom: 'presets', pacing, sound, project: { cuesPerSec: project.sound?.cuesPerSec ?? null, tweenMs: project.durations } };
  return {
    source, palette: pal, light: avg('light'), contrast: avg('contrast'), inkContrast: avg('inkContrast'), saturation: avg('saturation'), warmth,
    temperature: warmth === null ? null : warmth > 0.03 ? 'warm' : warmth < -0.03 ? 'cool' : 'neutral',
    colourFrom: vis.length ? 'refs' : null, pacing, sound, ...(project ? { project: { cuesPerSec: project.sound?.cuesPerSec ?? null, tweenMs: project.durations } } : {}),
  };
}

/**
 * Analyze reference files and/or a project. -> { version, created?, refs: [...], skipped: [...], project?, summary }.
 * Throws when nothing was readable.
 */
export async function analyzeLook({ refs = [], project = null, onProgress = () => {} } = {}) {
  const done = [], skipped = [];
  for (let i = 0; i < refs.length; i++) {
    const file = path.resolve(refs[i]);
    onProgress('analyze', i, refs.length, path.basename(file));
    try { done.push({ file: refs[i], name: path.basename(file), ...(await analyzeFile(file)) }); } catch (e) {
      if (e instanceof FfmpegMissing) throw e;
      skipped.push({ file: refs[i], reason: e.code === 'ENOENT' ? 'file not found' : e.message });
    }
  }
  onProgress('analyze', refs.length, refs.length);
  const proj = project ? await analyzeProject(project) : null;
  if (!done.length && !(proj && proj.scenes.length)) {
    const why = skipped.map((s) => `${s.file}: ${s.reason}`).join('; ');
    throw new Error(`nothing readable to analyze${why ? ` (${why})` : proj ? ' (the project has no scenes)' : ''}`);
  }
  return { version: 1, refs: done, skipped, ...(proj ? { project: proj } : {}), summary: summarize(done, proj) };
}
