// Render option parsing + validation (docs/FOUNDATION.md §4). Pure: no browser, no ffmpeg, no I/O except reading the
// crop-track / render.json files. `planRender(opts, meta, { sceneDir })` returns everything cmdRender needs.
import fs from 'node:fs';
import path from 'node:path';
import * as EASE from './ease.js';
import { resolveMode } from './browser.js';

export const BUILTIN_PRESETS = [
  { id: '720p', label: '720p 16:9', width: 1280, height: 720 },
  { id: '1080p', label: '1080p 16:9', width: 1920, height: 1080 },
  { id: '4k', label: '4K 16:9', width: 3840, height: 2160 },
  { id: 'reel', label: 'Reel 9:16', width: 1080, height: 1920 },
  { id: 'reel-4k', label: 'Reel 9:16 4K', width: 2160, height: 3840 },
  { id: 'square', label: 'Square 1:1', width: 1080, height: 1080 },
  { id: 'portrait', label: 'Portrait 4:5', width: 1080, height: 1350 },
];

export const FORMATS = {
  mp4: { ext: 'mp4', alpha: false },
  webm: { ext: 'webm', alpha: false },
  gif: { ext: 'gif', alpha: false },
  png: { ext: null, alpha: 'optional' }, // numbered PNG sequence in a directory
  prores: { ext: 'mov', alpha: 'optional' }, // ProRes 422 HQ; with --alpha ProRes 4444 (same as mov-alpha)
  'webm-alpha': { ext: 'webm', alpha: true }, // VP9 yuva420p
  'mov-alpha': { ext: 'mov', alpha: true }, // ProRes 4444 yuva444p10le
};
export const QUALITY_CRF = { draft: 28, normal: 18, high: 12 };

// option names a render.json preset / the CLI share; presets may use camelCase
const PRESET_KEYS = ['size', 'scale', 'preset', 'crop', 'crop-track', 'fit', 'pad', 'reframe', 'fps', 'from', 'to', 'dur',
  'format', 'codec', 'crf', 'quality', 'alpha', 'audio', 'workers', 'mode', 'frame-format'];
const GROUPS = [['size', 'scale', 'preset'], ['crop', 'crop-track']];
const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const err = (m) => Object.assign(new Error(m), { render: true });

export function parseSize(v, flag = '--size') {
  const m = /^(\d+)x(\d+)$/i.exec(String(v).trim());
  if (!m || +m[1] < 2 || +m[2] < 2) throw err(`${flag} must be WxH (e.g. 1920x1080), got "${v}"`);
  return { w: +m[1], h: +m[2] };
}
function parseCrop(v) {
  const a = (Array.isArray(v) ? v : String(v).split(',')).map(Number);
  if (a.length !== 4 || a.some((n) => !Number.isFinite(n)) || a[2] <= 0 || a[3] <= 0 || a[0] < 0 || a[1] < 0) {
    throw err(`--crop must be x,y,w,h in scene px (w,h > 0), got "${v}"`);
  }
  return { x: a[0], y: a[1], w: a[2], h: a[3] };
}
const num = (v, flag) => { const n = Number(v); if (!Number.isFinite(n)) throw err(`${flag} must be a number, got "${v}"`); return n; };

export function readRenderFile(sceneDir) {
  const f = path.join(sceneDir, 'render.json');
  if (!fs.existsSync(f)) return [];
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw err(`${f}: ${e.message}`); }
  const list = Array.isArray(j) ? j : j.presets;
  if (!Array.isArray(list)) throw err(`${f}: expected { "presets": [ { "id", "label", ...options } ] }`);
  return list.filter((p) => p && typeof p.id === 'string');
}

/** Built-in + scene presets for `gfx render --list-presets --json` and the studio dialog. */
export function listPresets(sceneDir) {
  const scene = sceneDir ? readRenderFile(sceneDir).map((p) => {
    const { id, label, ...rest } = p;
    const options = {};
    for (const [k, v] of Object.entries(rest)) options[kebab(k)] = v;
    return { id, label: label || id, source: 'scene', options };
  }) : [];
  return { builtin: BUILTIN_PRESETS.map((p) => ({ ...p, source: 'builtin' })), scene };
}

/** Merge a render.json preset under the CLI options (CLI wins; a CLI size/crop option replaces the preset's whole group). */
export function applyRenderPreset(o, sceneDir) {
  if (!o['render-preset']) return o;
  const p = readRenderFile(sceneDir).find((x) => x.id === o['render-preset']);
  if (!p) throw err(`render preset "${o['render-preset']}" not found in ${path.join(sceneDir, 'render.json')}`);
  const base = {};
  for (const [k0, v] of Object.entries(p)) {
    const k = kebab(k0);
    if (!PRESET_KEYS.includes(k)) { if (!['id', 'label'].includes(k)) throw err(`render preset "${p.id}": unknown option "${k0}"`); continue; }
    base[k] = v;
  }
  for (const g of GROUPS) if (g.some((k) => o[k] !== undefined)) for (const k of g) delete base[k];
  const merged = { ...base };
  for (const [k, v] of Object.entries(o)) if (v !== undefined) merged[k] = v;
  return merged;
}

function readTrack(v, sceneDir) {
  let j = v;
  if (typeof v === 'string') {
    const f = path.resolve(sceneDir || '.', v);
    const f2 = fs.existsSync(f) ? f : path.resolve(v);
    if (!fs.existsSync(f2)) throw err(`--crop-track file not found: ${v}`);
    try { j = JSON.parse(fs.readFileSync(f2, 'utf8')); } catch (e) { throw err(`--crop-track ${v}: ${e.message}`); }
  }
  const keys = Array.isArray(j) ? j : j?.keys;
  if (!Array.isArray(keys) || !keys.length) throw err('--crop-track needs { "keys": [ { "t", "x", "y", "w", "h", "ease"? } ] }');
  return keys.map((k, i) => {
    for (const f of ['t', 'x', 'y', 'w', 'h']) if (!Number.isFinite(k?.[f])) throw err(`--crop-track key ${i}: "${f}" must be a number`);
    if (k.w <= 0 || k.h <= 0) throw err(`--crop-track key ${i}: w and h must be > 0`);
    if (k.ease && !EASE[k.ease]) throw err(`--crop-track key ${i}: unknown ease "${k.ease}" (${Object.keys(EASE).filter((e) => e !== 'default').join(', ')})`);
    return { t: k.t, x: k.x, y: k.y, w: k.w, h: k.h, ease: k.ease || 'linear' };
  }).sort((a, b) => a.t - b.t);
}

/** Window (scene px) at time t. Output height follows width so the aspect is exactly the output aspect. */
export function trackRect(keys, t, aspect, scene) {
  let a = keys[0], b = keys[0], u = 0;
  if (t >= keys[keys.length - 1].t) a = b = keys[keys.length - 1];
  else if (t > keys[0].t) {
    let i = 0;
    while (keys[i + 1].t <= t) i++;
    a = keys[i]; b = keys[i + 1];
    const raw = (t - a.t) / (b.t - a.t);
    u = (EASE[a.ease] || EASE.linear)(raw);
  }
  const L = (p, q) => p + (q - p) * u;
  let w = L(a.w, b.w);
  w = Math.min(Math.max(w, 1), scene.w, scene.h * aspect);
  const h = w / aspect;
  const x = Math.min(Math.max(L(a.x, b.x), 0), scene.w - w);
  const y = Math.min(Math.max(L(a.y, b.y), 0), scene.h - h);
  return { x, y, w, h };
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
function ffColor(pad) {
  if (pad === 'transparent') return 'black@0';
  const m = HEX.exec(pad);
  if (!m) throw err(`--pad must be a hex colour (#rgb, #rrggbb, #rrggbbaa) or "transparent", got "${pad}"`);
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return '0x' + h;
}

/**
 * Validate options and compute the render plan.
 * Returns { format, codec, crf, alpha, fps, from, to, total, scene:{w,h}, out:{w,h}, dest:{w,h}, source, rect, track,
 *           aspect, fit, pad, dsf, needsFilter, ext }
 * - scene: size the scene is built at (meta size, or --reframe).
 * - rect: static source window in scene px (full scene when no crop); track: sorted keys for an animated window.
 * - dest: size of the picture inside the output (== out except for --fit contain, which letterboxes).
 * - dsf: deviceScaleFactor for non-track renders (dest.w / rect.w); track renders use clip.scale per frame.
 */
export function planRender(o0, meta, { sceneDir } = {}) {
  const o = applyRenderPreset(o0, sceneDir);
  const format = o.format || 'mp4';
  if (!FORMATS[format]) throw err(`--format must be ${Object.keys(FORMATS).join('|')}, got "${format}"`);
  const F = FORMATS[format];

  // ----- alpha -----
  let alpha = !!o.alpha;
  if (F.alpha === true) alpha = true;
  if (alpha && F.alpha === false) throw err(`--alpha is not possible with --format ${format} (no alpha channel); use png, prores, mov-alpha or webm-alpha`);

  // ----- mode / frame format (FOUNDATION.md §4b) -----
  const mode = resolveMode(o.mode);
  const frameFormat = o['frame-format'] === undefined ? 'png' : String(o['frame-format']).toLowerCase();
  if (!['png', 'jpeg'].includes(frameFormat)) throw err(`--frame-format must be png|jpeg, got "${o['frame-format']}"`);
  if (frameFormat === 'jpeg') {
    if (!['mp4', 'webm', 'gif'].includes(format)) throw err(`--frame-format jpeg only works with --format mp4|webm|gif (got ${format}; intermediate JPEGs would lose quality or alpha)`);
    if (alpha) throw err('--frame-format jpeg has no alpha channel; drop --alpha');
  }

  // ----- codec / quality -----
  const codec = o.codec;
  if (codec !== undefined && !['h264', 'h265'].includes(codec)) throw err('--codec must be h264|h265');
  if (codec && format !== 'mp4') throw err(`--codec only applies to --format mp4 (got ${format})`);
  if (o.quality !== undefined && !QUALITY_CRF[o.quality]) throw err('--quality must be draft|normal|high');
  if (o.crf !== undefined) {
    const c = num(o.crf, '--crf');
    if (!Number.isInteger(c) || c < 0 || c > 63) throw err('--crf must be an integer 0-63');
  }
  const lossless = ['gif', 'png', 'prores', 'mov-alpha'].includes(format);
  if ((o.crf !== undefined || o.quality !== undefined) && lossless && !o['render-preset']) {
    throw err(`--crf/--quality do not apply to --format ${format}`);
  }
  let crf = null;
  if (!lossless) {
    const dflt = format === 'mp4' ? 18 : 30;
    crf = o.crf !== undefined ? Number(o.crf) : o.quality ? QUALITY_CRF[o.quality] : dflt;
    if (format === 'mp4' && crf > 51) throw err('--crf for mp4 must be 0-51');
  }
  const finalCodec = format === 'mp4' ? codec || 'h264' : null;
  if (o.audio && format !== 'mp4') throw err('--audio needs --format mp4');

  // ----- time -----
  let fps = o.fps !== undefined ? num(o.fps, '--fps') : meta.fps;
  if (!(fps > 0 && fps <= 240)) throw err('--fps must be between 0 and 240');
  if (format === 'gif') fps = Math.min(fps, 30);
  const from = o.from !== undefined ? num(o.from, '--from') : 0;
  const to = o.to !== undefined ? num(o.to, '--to') : o.dur !== undefined ? from + num(o.dur, '--dur') : meta.duration;
  const total = Math.round((to - from) * fps);
  if (!(total > 0)) throw err('empty time range');

  // ----- scene size / reframe -----
  let scene = { w: Math.round(meta.width), h: Math.round(meta.height) };
  if (o.reframe !== undefined) {
    if (meta.responsive !== true) throw err('--reframe needs a scene with "responsive": true in scene.json (the scene lays itself out from ctx.width/height); use --crop to cut a window out of a fixed-layout scene');
    scene = parseSize(o.reframe, '--reframe');
  }

  // ----- source window -----
  if (o.crop !== undefined && o['crop-track'] !== undefined) throw err('use either --crop or --crop-track, not both');
  const inside = (r, what) => {
    if (r.x + r.w > scene.w + 1e-6 || r.y + r.h > scene.h + 1e-6) throw err(`${what} (${r.x},${r.y} ${r.w}x${r.h}) leaves the ${scene.w}x${scene.h} scene`);
  };
  let rect = { x: 0, y: 0, w: scene.w, h: scene.h }, track = null;
  if (o.crop !== undefined) { rect = parseCrop(o.crop); inside(rect, '--crop'); }
  if (o['crop-track'] !== undefined) track = readTrack(o['crop-track'], sceneDir);
  const src0 = track ? track[0] : rect; // size reference for defaults

  // ----- output size -----
  const given = ['size', 'scale', 'preset'].filter((k) => o[k] !== undefined);
  if (given.length > 1) throw err(`use only one of --${given.join(' / --')}`);
  let out;
  if (o.size !== undefined) out = parseSize(o.size);
  else if (o.preset !== undefined) {
    const p = BUILTIN_PRESETS.find((x) => x.id === o.preset);
    if (!p) throw err(`unknown --preset "${o.preset}" (${BUILTIN_PRESETS.map((x) => x.id).join(', ')})`);
    out = { w: p.width, h: p.height };
  } else {
    const k = o.scale !== undefined ? num(o.scale, '--scale') : 1;
    if (!(k > 0 && k <= 16)) throw err('--scale must be > 0 (max 16)');
    out = { w: Math.round(src0.w * k), h: Math.round(src0.h * k) };
  }
  if (out.w > 16384 || out.h > 16384) throw err('output size too large (max 16384 per side)');
  const aspect = out.w / out.h;

  // ----- fit / pad -----
  const fit = o.fit || 'cover';
  if (!['contain', 'cover'].includes(fit)) throw err('--fit must be contain|cover');
  if (o.pad !== undefined && fit !== 'contain') throw err('--pad needs --fit contain');
  if (o.fit !== undefined && track) throw err('--fit does not apply with --crop-track (the window already has the output aspect)');
  let dest = { ...out }, padColor = null;
  if (track) {
    const bad = track.findIndex((k) => Math.abs(k.w / k.h / aspect - 1) > 0.02);
    if (bad >= 0) throw err(`--crop-track key ${bad}: w/h aspect ${(track[bad].w / track[bad].h).toFixed(3)} differs from the output aspect ${aspect.toFixed(3)}`);
    for (const [i, k] of track.entries()) if (k.w > scene.w + 1e-6 || k.h > scene.h + 1e-6) throw err(`--crop-track key ${i} is larger than the scene`);
  } else if (Math.abs(rect.w / rect.h / aspect - 1) > 0.002) {
    if (fit === 'cover') {
      // centre-crop the source window to the output aspect
      const w = Math.min(rect.w, rect.h * aspect), h = w / aspect;
      rect = { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
    } else {
      const k = Math.min(out.w / rect.w, out.h / rect.h);
      dest = { w: Math.max(2, Math.round(rect.w * k)), h: Math.max(2, Math.round(rect.h * k)) };
      padColor = ffColor(o.pad || (alpha ? 'transparent' : '#000000'));
    }
  }
  if (padColor === null && fit === 'contain') padColor = ffColor(o.pad || (alpha ? 'transparent' : '#000000'));
  const letterbox = dest.w !== out.w || dest.h !== out.h;
  const dsf = track ? 1 : dest.w / rect.w;
  // needsFilter: frames from the browser are not exactly the output yet (crop rounding, letterbox, odd sizes)
  // PNG sequences skip ffmpeg only when Chrome's clip lands on whole device pixels (otherwise it rounds outward by a px)
  const whole = (v) => Math.abs(v - Math.round(v)) < 1e-6;
  const pixelExact = !track && rect.w * dsf === dest.w && rect.h * dsf === dest.h &&
    [rect.x, rect.y, rect.w, rect.h].every((v) => whole(v) && whole(v * dsf));
  const evenFmt = ['mp4', 'webm', 'webm-alpha'].includes(format) || (format === 'prores' && !alpha);
  return {
    mode, frameFormat, format, ext: F.ext, codec: finalCodec, crf, alpha, fps, from, to, total, scene, out, dest, rect, track, aspect, fit, padColor, letterbox,
    dsf, evenFmt, pixelExact, exact: !track && !letterbox && Math.abs(dsf * rect.w - out.w) < 0.01 && Math.abs(dsf * rect.h - out.h) < 0.01 && rect.x === 0 && rect.y === 0 && rect.w === scene.w && rect.h === scene.h,
    renderPreset: o['render-preset'] || null,
    options: o,
  };
}

/** PNG pipe input; preserve buffered filter frames when animated clips change dimensions. */
export function imageInputArgs(plan) {
  return ['-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', plan.frameFormat === 'jpeg' ? 'mjpeg' : 'png', '-reinit_filter', '0', '-i', '-'];
}

/** ffmpeg input filter chain (array of filter strings) turning captured frames into exactly the output frames. */
export function videoFilters(plan) {
  const f = [];
  if (!plan.exact && !plan.pixelExact) f.push(`scale=${plan.dest.w}:${plan.dest.h}:flags=bicubic`);
  if (plan.letterbox) {
    if (plan.alpha) f.push('format=rgba');
    f.push(`pad=${plan.out.w}:${plan.out.h}:(ow-iw)/2:(oh-ih)/2:color=${plan.padColor}`);
  }
  if (plan.evenFmt) f.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  return f;
}

/** Full ffmpeg output arguments (everything after the image2pipe input) for a plan; `out` is the file. */
export function encodeArgs(plan, out) {
  const vf = videoFilters(plan);
  const a = [];
  const { format } = plan;
  if (format === 'gif') {
    a.push('-filter_complex', `[0:v]${vf.length ? vf.join(',') + ',' : ''}split[a][b];[a]palettegen[p];[b][p]paletteuse`, '-loop', '0');
  } else {
    if (vf.length) a.push('-vf', vf.join(','));
    if (format === 'mp4' && plan.codec === 'h264') a.push('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', String(plan.crf), '-movflags', '+faststart');
    else if (format === 'mp4') a.push('-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-crf', String(plan.crf), '-x265-params', 'log-level=error', '-movflags', '+faststart');
    else if (format === 'webm') a.push('-c:v', 'libvpx-vp9', '-crf', String(plan.crf), '-b:v', '0', '-pix_fmt', 'yuv420p');
    else if (format === 'webm-alpha') a.push('-c:v', 'libvpx-vp9', '-crf', String(plan.crf), '-b:v', '0', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0');
    else if (format === 'prores' && !plan.alpha) a.push('-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0');
    else if (format === 'prores' || format === 'mov-alpha') a.push('-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0');
    else if (format === 'png') a.push('-start_number', '0');
  }
  a.push(out);
  return a;
}
