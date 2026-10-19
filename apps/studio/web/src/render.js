// Render dialog + queue (docs/FOUNDATION.md §4, §6). A dock panel (tabbed with the side panel by default): Setup (options, crop, output,
// scene presets), Queue (sequential `gfx render` jobs with progress / cancel / reveal / open), Renders (files in out/<scene>/).
// Options become CLI flags in buildArgs(); the CLI is the single source of truth for what a render does.
import * as api from './api.js';
import { S, on, emit, esc, fps, duration, clamp } from './store.js';
import { readJson, writeJson } from './local-json.js';
import { transport, seek } from './transport.js';
import { videoBox } from './viewer.js';

import { $ } from './dom.js';
import { showPanel, hidePanel } from './layout.js';
import { pref } from './prefs.js';
import { applyRenderDefaults, RENDER_PREF_FIELDS } from './render-prefs.js';
let host = { toast: () => {}, reloadScene: async () => {}, refreshScenes: async () => {} };

// ---------- static tables ----------
/** FOUNDATION §4 built-ins; used until / unless `gfx render --list-presets --json` answers. */
export const BUILTIN_PRESETS = [
  { id: '1080p', label: '1080p', width: 1920, height: 1080 }, { id: '4k', label: '4K', width: 3840, height: 2160 },
  { id: 'reel', label: 'Reel', width: 1080, height: 1920 }, { id: 'reel-4k', label: 'Reel 4K', width: 2160, height: 3840 },
  { id: 'square', label: 'Square', width: 1080, height: 1080 }, { id: 'portrait', label: 'Portrait', width: 1080, height: 1350 },
  { id: '720p', label: '720p', width: 1280, height: 720 },
];
export const FORMATS = {
  mp4: { label: 'MP4', ext: 'mp4', codec: true, quality: true, audio: true },
  webm: { label: 'WebM (VP9)', ext: 'webm', quality: true },
  gif: { label: 'GIF', ext: 'gif' },
  png: { label: 'PNG sequence', ext: '', dir: true, alpha: true },
  prores: { label: 'ProRes (.mov)', ext: 'mov', alpha: true, forceAlpha: true },
  'webm-alpha': { label: 'WebM with alpha', ext: 'webm', alpha: true, forceAlpha: true, quality: true },
  'mov-alpha': { label: 'MOV with alpha', ext: 'mov', alpha: true, forceAlpha: true },
};
const EASES = ['inOutCubic', 'linear', 'inOutQuad', 'outCubic', 'inCubic', 'inOutSine'];
const EASE_FN = {
  linear: (x) => x, inOutQuad: (x) => (x < .5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2), inOutCubic: (x) => (x < .5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2),
  outCubic: (x) => 1 - (1 - x) ** 3, inCubic: (x) => x ** 3, inOutSine: (x) => -(Math.cos(Math.PI * x) - 1) / 2,
};

// ---------- pure helpers (unit-tested in the E2E script through window.__studio.mods.render) ----------
export const parseSize = (s) => { const m = /^(\d+)\s*[x×]\s*(\d+)$/i.exec(String(s ?? '').trim()); return m ? { w: +m[1], h: +m[2] } : null; };
const r3 = (x) => Math.round(x * 1000) / 1000;
export const fmtT = (t) => String(+(+t).toFixed(2));
export const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
export function fmtDur(s) { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export function fmtSize(n) { return n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; }
function ago(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
}
/** Crop window at time t from keys [{t,x,y,w,h,ease}] (hold before the first / after the last, ease of the segment's first key). */
export function cropAt(keys, t) {
  if (!keys.length) return null;
  const ks = [...keys].sort((a, b) => a.t - b.t);
  if (t <= ks[0].t) return pick(ks[0]);
  if (t >= ks[ks.length - 1].t) return pick(ks[ks.length - 1]);
  let i = 0;
  while (ks[i + 1].t < t) i++;
  const a = ks[i], b = ks[i + 1], u = (EASE_FN[a.ease] || EASE_FN.inOutCubic)((t - a.t) / (b.t - a.t));
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, w: a.w + (b.w - a.w) * u, h: a.h + (b.h - a.h) * u };
}
const pick = (k) => ({ x: k.x, y: k.y, w: k.w, h: k.h });
/** Largest rect of aspect `a` (w/h) inside W x H, scaled by `f`, centred. */
export function fitRect(W, H, a, f = 1) {
  let w = Math.min(W, H * a) * f, h = w / a;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}
/** Same centre and width where possible, aspect forced to `a`, kept inside W x H. */
export function reaspect(r, W, H, a) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  let w = Math.min(r.w, W, H * a), h = w / a;
  return { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
}
const rectArg = (r) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v)).join(',');

// ---------- dialog state ----------
let D = null, presets = { list: BUILTIN_PRESETS, source: 'builtin', key: '' }, ui = { open: false, tab: 'setup' };
let els = {}, overlay = null, dragging = false;

const sceneSize = () => ({ w: S.meta?.width || 1080, h: S.meta?.height || 1920 });
const findPreset = (id) => presets.list.find((p) => p.id === id);
const presetSize = (p) => (p.width && p.height ? { w: p.width, h: p.height } : parseSize(p.size));

/** Rendering settings (Settings → Rendering, per project or this computer; docs/HOME-SETTINGS.md §2): the defaults of a
 *  scene without saved dialog options, plus workers / intermediate frames / output folder for every render. */
export function renderPrefs() {
  return { mode: pref('renderMode'), workers: pref('renderWorkers'), preset: pref('renderPreset'), quality: pref('renderQuality'), frameFormat: pref('renderFrameFormat'), audio: pref('renderAudio'), outDir: pref('renderOutDir') };
}
function freshState() {
  const m = S.meta || { fps: 60, duration: 6, width: 1080, height: 1920 }, rp = renderPrefs();
  return {
    preset: rp.preset === 'scene' ? 'scene' : 'p:' + rp.preset, w: m.width, h: m.height, lock: true, scale: 1, fps: m.fps, rangeMode: 'whole', from: 0, to: +m.duration || 0,
    format: 'mp4', mode: rp.mode, codec: 'h264', quality: rp.quality, alpha: false, audio: rp.audio, fit: '', pad: '#000000',
    _edited: {}, out: '', outEdited: false, presetName: '', workers: rp.workers, frameFormat: rp.frameFormat, outDir: rp.outDir,
    crop: { mode: 'none', rect: null, keys: [], ease: 'inOutCubic' },
  };
}
/** Refresh untouched defaults, including a dialog cached while closed. */
function applyRenderPrefs() {
  if (!D) return;
  applyRenderDefaults(D, renderPrefs());
  fixFormat();
}
const optsKey = () => `gfx-studio.render.opts.${S.root}.${S.name}`;
const SAVED = ['preset', 'w', 'h', 'lock', 'scale', 'fps', 'mode', 'format', 'codec', 'quality', 'alpha', 'audio', 'fit', 'pad'];
function loadOpts() {
  D = freshState();
  const v = readJson(optsKey(), null);
  if (v) for (const k of SAVED) if (k in v) { D[k] = v[k]; if (RENDER_PREF_FIELDS.includes(k)) D._edited[k] = true; }
  if (!FORMATS[D.format]) D.format = 'mp4';
  if (D.mode !== 'fast' && D.mode !== 'exact') D.mode = 'fast';
  if (D.preset.startsWith('p:') && !findPreset(D.preset.slice(2))) D.preset = 'scene';
  fixFormat();
}
function saveOpts() {
  if (!D || !S.name) return;
  writeJson(optsKey(), Object.fromEntries(SAVED.filter((k) => !RENDER_PREF_FIELDS.includes(k) || D._edited[k]).map((k) => [k, D[k]])));
}

/** Output size in pixels for the current size choice. */
export function outSize(d = D, scene = sceneSize()) {
  if (d.preset === 'custom') return { w: Math.max(2, Math.round(d.w)), h: Math.max(2, Math.round(d.h)) };
  if (d.preset === 'scale') return { w: Math.max(2, Math.round(scene.w * d.scale)), h: Math.max(2, Math.round(scene.h * d.scale)) };
  if (d.preset.startsWith('p:')) { const p = findPreset(d.preset.slice(2)); const s = p && presetSize(p); if (s) return s; }
  return scene;
}
function rangeOf(d = D) {
  const dur = duration();
  if (d.rangeMode === 'loop') return S.loop.b > S.loop.a ? { from: r3(S.loop.a), to: r3(S.loop.b) } : null;
  if (d.rangeMode === 'custom') return { from: r3(+d.from || 0), to: r3(+d.to || 0) };
  return { from: 0, to: dur };
}
const rangeIsWhole = (d = D) => d.rangeMode === 'whole';
const cropActive = (d = D) => d.crop.mode === 'static' ? !!d.crop.rect : d.crop.mode === 'anim' && d.crop.keys.length > 0;

/** Default output path (relative to the project). Anything that is not the plain scene render gets a suffix so the
 *  review video out/<scene>/<scene>.mp4 is only replaced by a plain mp4 render. */
export function defaultOut(d = D, scene = S.name, sc = sceneSize()) {
  const f = FORMATS[d.format], o = outSize(d, sc), parts = [];
  if (o.w !== sc.w || o.h !== sc.h) parts.push(`${o.w}x${o.h}`);
  if (cropActive(d)) parts.push('crop');
  if (f.quality && d.quality !== 'normal') parts.push(d.quality);
  if (f.codec && d.codec !== 'h264') parts.push(d.codec);
  const r = rangeOf(d);
  if (!rangeIsWhole(d) && r) parts.push(`${fmtT(r.from)}-${fmtT(r.to)}`);
  const dir = d.outDir || 'out';
  if (f.dir) return `${dir}/${scene}/frames${parts.length ? '-' + parts.join('-') : ''}`;
  const alphaTag = f.forceAlpha ? '' : d.alpha ? 'alpha' : '';
  if (alphaTag) parts.push(alphaTag);
  return `${dir}/${scene}/${scene}${parts.length ? '-' + parts.join('-') : ''}.${f.ext}`;
}
const validOut = (p) => /^out\/[^/\\:]+\/[^\\:]+$/.test(p) && !p.split('/').includes('..') && !p.split('/').includes('.');

/** Options -> { args, errors }. */
export function buildArgs(d, scene, sc, dur, cropFile) {
  const f = FORMATS[d.format], errors = [], a = ['render', scene];
  const o = outSize(d, sc);
  if (d.preset === 'custom' || (cropActive(d) && d.preset === 'scene')) a.push('--size', `${o.w}x${o.h}`);
  else if (d.preset === 'scale') {
    if (!(d.scale > 0)) errors.push('Scale must be above 0');
    else if (cropActive(d)) a.push('--size', `${o.w}x${o.h}`);
    else a.push('--scale', String(d.scale));
  }
  else if (d.preset.startsWith('p:')) a.push('--preset', d.preset.slice(2));
  if (!(o.w >= 2 && o.h >= 2) || o.w > 16384 || o.h > 16384) errors.push('Output size is out of range');
  if (d.preset === 'custom' && !Number.isFinite(+d.w * +d.h)) errors.push('Enter a width and height');
  if (!(d.fps >= 1 && d.fps <= 240)) errors.push('Frame rate must be 1-240');
  else if (+d.fps !== sc.fps) a.push('--fps', String(+d.fps));
  if (d.rangeMode !== 'whole') {
    const r = rangeOf(d);
    if (!r) errors.push('No loop region is set (shift-drag on the timeline ruler)');
    else if (!(r.to > r.from) || r.from < 0 || r.to > dur + 1e-6) errors.push(`Range must be inside 0-${r3(dur)} s with from < to`);
    else a.push('--from', String(r.from), '--to', String(r.to));
  }
  a.push('--format', d.format);
  a.push('--mode', d.mode === 'exact' ? 'exact' : 'fast');
  if (((d.mode !== 'exact' && f.quality && d.quality === 'draft') || d.frameFormat === 'jpeg') && ['mp4', 'webm', 'gif'].includes(d.format) && !(f.alpha && d.alpha)) a.push('--frame-format', 'jpeg');
  if (d.workers > 0) a.push('--workers', String(d.workers));
  if (f.codec && d.codec !== 'h264') a.push('--codec', d.codec);
  if (f.quality) a.push('--quality', d.quality);
  if (f.alpha && d.alpha) a.push('--alpha');
  if (f.audio && d.audio) a.push('--audio');
  if (d.crop.mode === 'static' && d.crop.rect) a.push('--crop', rectArg(d.crop.rect));
  else if (d.crop.mode === 'anim' && d.crop.keys.length === 1) a.push('--crop', rectArg(d.crop.keys[0]));
  else if (d.crop.mode === 'anim' && d.crop.keys.length > 1) a.push('--crop-track', cropFile);
  else if (d.crop.mode !== 'none') errors.push(d.crop.mode === 'anim' ? 'Add at least one crop key' : 'Draw a crop window first');
  if (d.fit && !cropActive(d)) { a.push('--fit', d.fit); if (d.fit === 'contain') a.push('--pad', d.pad); }
  const out = (d.out || '').trim();
  if (!validOut(out)) errors.push('Output must be a path under out/<scene>/');
  else a.push('--out', out);
  return { args: a, errors };
}

// ---------- presets from the CLI ----------
function parsePresetList(text) {
  let v;
  try { v = JSON.parse(text); } catch { return null; }
  // CLI shape: { builtin: [{id,label,width,height}], scene: [{id,label,options:{size,fps,format,...}}] }; a plain array / {presets} also works
  const arr = Array.isArray(v) ? v : Array.isArray(v?.presets) ? v.presets
    : v && typeof v === 'object' && (Array.isArray(v.builtin) || Array.isArray(v.scene)) ? [...(v.builtin || []), ...(v.scene || []).map((p) => ({ ...p, scene: true }))] : null;
  if (!arr) return null;
  const list = arr.filter((p) => p && typeof p.id === 'string').map((p) => ({ ...(p.options || {}), ...p, options: undefined, label: p.label || p.id, scene: !!p.scene || p.source === 'scene' }));
  return list.length ? list : null;
}
async function readSceneRenderJson(scene) {
  try { const t = await api.readText(`scenes/${scene}/render.json`); return t ? JSON.parse(t) : null; } catch { return undefined; } // undefined = unreadable
}
async function loadPresets(force = false) {
  if (!S.name) return;
  const key = `${S.root}|${S.name}`;
  if (!force && presets.key === key) return;
  presets = { list: BUILTIN_PRESETS, source: 'builtin', key };
  syncPresetSelect();
  let list = null, source = 'builtin';
  try {
    const res = await api.engineCapture(['render', '--list-presets', '--json', S.name]).done;
    if (res.code === 0) { list = parsePresetList(res.lines.join('\n')); if (list) source = 'cli'; }
  } catch { /* old CLI: fall back */ }
  if (!list) { // CLI without --list-presets: the §4 built-ins plus whatever the scene saved itself
    const rj = await readSceneRenderJson(S.name);
    const own = Array.isArray(rj?.presets) ? rj.presets.filter((p) => p && typeof p.id === 'string').map((p) => ({ ...p, label: p.label || p.id, scene: true })) : [];
    list = [...BUILTIN_PRESETS.filter((b) => !own.some((p) => p.id === b.id)), ...own];
  }
  if (presets.key !== key) return;
  presets = { list, source, key };
  if (D?.preset.startsWith('p:') && !findPreset(D.preset.slice(2))) D.preset = 'scene';
  syncPresetSelect();
  sync();
}

/** Expand a preset's options into the form (scene presets from render.json use the CLI option names). */
function applyPreset(p) {
  if (p.scene) D._edited.preset = true;
  for (const k of ['mode', 'quality', 'audio']) if (p[k] !== undefined) D._edited[k] = true;
  if (p.scene) { // size group -> the matching size mode; the select then shows that mode
    const sz = parseSize(p.size);
    if (sz) { D.preset = 'custom'; D.w = sz.w; D.h = sz.h; D.lock = false; }
    else if (Number(p.scale) > 0) { D.preset = 'scale'; D.scale = +p.scale; }
    else if (typeof p.preset === 'string' && findPreset(p.preset)) D.preset = 'p:' + p.preset;
    else D.preset = 'scene';
    if (p.fit === 'contain' || p.fit === 'cover') D.fit = p.fit === 'contain' ? 'contain' : '';
    if (typeof p.pad === 'string') D.pad = p.pad;
    if (p.from !== undefined || p.to !== undefined || p.dur !== undefined) {
      D.rangeMode = 'custom'; D.from = +p.from || 0;
      D.to = p.to !== undefined ? +p.to : p.dur !== undefined ? D.from + (+p.dur || 0) : duration();
    }
    if (Array.isArray(p.crop)) p = { ...p, crop: p.crop.join(',') };
    D.crop = { mode: 'none', rect: null, keys: [], ease: D.crop.ease };
    host.toast(`Applied scene preset "${p.label || p.id}"`, 2000);
  }
  if (p.fps) D.fps = +p.fps;
  if (typeof p.format === 'string' && FORMATS[p.format]) D.format = p.format;
  if (p.codec === 'h264' || p.codec === 'h265') D.codec = p.codec;
  if (p.mode === 'fast' || p.mode === 'exact') D.mode = p.mode;
  if (['draft', 'normal', 'high'].includes(p.quality)) D.quality = p.quality;
  if (typeof p.alpha === 'boolean') D.alpha = p.alpha;
  if (typeof p.audio === 'boolean') D.audio = p.audio;
  if (typeof p.crop === 'string' && p.crop.split(',').length === 4) {
    const [x, y, w, h] = p.crop.split(',').map(Number);
    if ([x, y, w, h].every(Number.isFinite)) { D.crop.mode = 'static'; D.crop.rect = { x, y, w, h }; }
  }
  D._alphaTouched = typeof p.alpha === 'boolean';
  fixFormat();
}
function fixFormat() {
  const f = FORMATS[D.format];
  if (!f.alpha) D.alpha = false; else if (f.forceAlpha && !D._alphaTouched) D.alpha = true;
}

// ---------- drawer ----------
const TPL = `
<div class="rd-tabs">
  <button data-t="setup">Setup</button><button data-t="queue">Queue <b id="rd-nq">0</b></button><button data-t="renders">Renders <b id="rd-nr">0</b></button>
  <button class="rd-x" id="rd-close" title="Close (Ctrl+R)">&times;</button>
</div>
<div class="rd-pane" data-p="setup">
  <form class="rd-form" id="rd-form" autocomplete="off" onsubmit="return false">
    <div class="rd-sec"><h4>Size</h4>
      <select data-k="preset" id="rd-preset"></select>
      <div class="rd-row" data-show="custom"><input type="number" data-k="w" min="2" max="16384"><span class="x">&times;</span><input type="number" data-k="h" min="2" max="16384">
        <label class="chk"><input type="checkbox" data-k="lock"> keep aspect</label></div>
      <div class="rd-row" data-show="scale"><input type="number" data-k="scale" min="0.05" max="8" step="0.05"><span class="dim">&times; scene size</span></div>
      <div class="rd-info" id="rd-sizeinfo"></div>
      <div class="rd-row" data-show="fit"><label>Aspect differs from scene</label><select data-k="fit"><option value="">cover (centre crop)</option><option value="contain">contain (pad)</option></select>
        <input type="color" data-k="pad" data-show="pad" title="Pad colour"></div>
    </div>
    <div class="rd-sec"><h4>Time</h4>
      <div class="rd-row"><label>Frame rate</label><input type="number" data-k="fps" min="1" max="240" step="1" style="width:var(--render-fps-w)"><span class="dim" id="rd-fpsinfo"></span></div>
      <div class="rd-row"><label>Range</label><select data-k="rangeMode"><option value="whole">Whole scene</option><option value="loop">Loop region</option><option value="custom">Custom</option></select></div>
      <div class="rd-row" data-show="range"><input type="number" data-k="from" min="0" step="0.01" style="width:var(--render-time-w)"><button type="button" class="tbtn sm" data-a="from-now" title="Set from to the playhead">[ playhead</button>
        <input type="number" data-k="to" min="0" step="0.01" style="width:var(--render-time-w)"><button type="button" class="tbtn sm" data-a="to-now" title="Set to to the playhead">playhead ]</button></div>
      <div class="rd-info" id="rd-rangeinfo"></div>
    </div>
    <div class="rd-sec"><h4>Speed</h4>
      <div class="rd-seg" id="rd-mode" role="group" aria-label="Render mode"><button type="button" data-a="mode" data-v="fast" title="GPU rendering: fastest, not bit-identical across machines">Fast</button><button type="button" data-a="mode" data-v="exact" title="Software rendering: bit-identical, slower">Exact</button></div>
      <div class="rd-info" id="rd-modeinfo"></div>
    </div>
    <div class="rd-sec"><h4>Format</h4>
      <div class="rd-row"><select data-k="format" id="rd-format"></select>
        <select data-k="codec" data-hide="codec" title="Codec"><option value="h264">H.264</option><option value="h265">H.265</option></select>
        <select data-k="quality" data-hide="quality" title="Quality (CRF 28 / 18 / 12)"><option value="draft">Draft</option><option value="normal">Normal</option><option value="high">High</option></select></div>
      <div class="rd-row"><label class="chk" id="rd-alpha-l"><input type="checkbox" data-k="alpha"> Transparent background (alpha)</label>
        <label class="chk" id="rd-audio-l"><input type="checkbox" data-k="audio"> Audio</label></div>
    </div>
    <div class="rd-sec"><h4>Crop</h4>
      <div class="rd-row"><select data-k="cropMode"><option value="none">None</option><option value="static">Static window</option><option value="anim">Animated (keys)</option></select>
        <button type="button" class="tbtn sm" data-a="crop-reset" data-show="crop">Reset window</button></div>
      <div class="rd-info" id="rd-cropinfo"></div>
      <div data-show="anim">
        <div class="rd-row"><button type="button" class="tbtn" data-a="key-add" title="Store the current window as a key at the playhead">Add key at playhead</button>
          <label>Ease</label><select data-k="ease"></select></div>
        <div class="rd-keys" id="rd-keys"></div>
      </div>
    </div>
    <div class="rd-sec"><h4>Output</h4>
      <input type="text" data-k="out" id="rd-out" spellcheck="false">
      <div class="rd-row"><input type="text" data-k="presetName" placeholder="Preset name" style="flex:1"><button type="button" class="tbtn sm" data-a="save-preset" title="Write these options to scenes/&lt;scene&gt;/render.json">Save as scene preset</button></div>
    </div>
    <div class="rd-err" id="rd-err" hidden></div>
  </form>
  <div class="rd-foot"><button type="button" class="tbtn" data-a="enqueue">Add to queue</button><button type="button" class="tbtn primary" data-a="now">Render now</button></div>
</div>
<div class="rd-pane" data-p="queue" hidden><div class="rq-list" id="rq-list"></div><div class="rd-foot"><button type="button" class="tbtn primary" id="rq-toggle" data-a="q-toggle" title="Start rendering the queued items in order">Start queue</button><button type="button" class="tbtn" data-a="clear">Clear finished</button></div></div>
<div class="rd-pane" data-p="renders" hidden><div class="rr-list" id="rr-list"></div></div>`;

export function initRender(h) {
  host = { ...host, ...h };
  const aside = $('render');
  aside.innerHTML = TPL;
  els = { aside, form: $('rd-form'), queue: $('rq-list'), renders: $('rr-list') };
  $('rd-format').innerHTML = Object.entries(FORMATS).map(([k, f]) => `<option value="${k}">${f.label}</option>`).join('');
  els.form.querySelector('[data-k=ease]').innerHTML = EASES.map((e) => `<option>${e}</option>`).join('');
  $('rd-close').onclick = () => closeRender();
  for (const b of aside.querySelectorAll('.rd-tabs [data-t]')) b.onclick = () => setTab(b.dataset.t);
  els.form.addEventListener('input', onField);
  els.form.addEventListener('change', onField);
  aside.addEventListener('click', onClick);
  $('rq-btn').onclick = () => openRender('queue');
  on('scene', onScene);
  on('layout', placeOverlay);
  on('layout-panel', ({ id, shown }) => { if (id === 'render' && !shown && ui.open) closeRender(); }); // closed from its tab / ⋯ menu
  on('dock-moved', placeOverlay);
  on('time', onTime);
  on('loop', () => ui.open && sync());
  on('prefs', ({ keys } = {}) => { if (keys?.some((k) => k.startsWith('render'))) { applyRenderPrefs(); if (ui.open) sync(); } });
  window.addEventListener('resize', placeOverlay);
  window.addEventListener('beforeunload', persistAll);
  Q.loaded.clear();
}

export function toggleRender(forceOpen) { if (ui.open && !forceOpen) closeRender(); else openRender('setup'); }
export function openRender(tab = 'setup') {
  if (!S.name) return;
  if (!ui.open) {
    ui.open = true;
    els.aside.hidden = false;
    if (!D || D._scene !== S.name || D._root !== S.root) startScene();
  }
  applyRenderPrefs();
  showPanel('render'); // a dock panel, tabbed with the side panel (layout.js)
  setTab(tab);
  loadPresets();
  syncPresetSelect();
  sync();
  renderQueue();
  window.dispatchEvent(new Event('resize'));
}
export function closeRender() {
  if (!ui.open) return;
  ui.open = false;
  els.aside.hidden = true;
  hidePanel('render');
  placeOverlay();
  window.dispatchEvent(new Event('resize'));
}
function startScene() {
  loadOpts();
  D._scene = S.name; D._root = S.root;
  if (S.meta) D.to = duration();
}
function onScene() {
  if (!S.name) { if (ui.open) closeRender(); D = null; return; }
  if (D && (D._scene !== S.name || D._root !== S.root)) { D = null; presets.key = ''; }
  if (ui.open) { if (!D) startScene(); loadPresets(); syncPresetSelect(); sync(); if (ui.tab === 'renders') refreshRenders(); }
}
function setTab(t) {
  ui.tab = t;
  for (const b of els.aside.querySelectorAll('.rd-tabs [data-t]')) b.classList.toggle('on', b.dataset.t === t);
  for (const p of els.aside.querySelectorAll('.rd-pane')) p.hidden = p.dataset.p !== t;
  if (t === 'renders') refreshRenders();
  if (t === 'queue') renderQueue();
  placeOverlay();
}

// ---------- form wiring ----------
function syncPresetSelect() {
  const sel = $('rd-preset');
  if (!sel || !D) return;
  const sc = sceneSize();
  const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
  sel.innerHTML = opt('scene', `Scene size (${sc.w}×${sc.h})`)
    + presets.list.filter((p) => !p.scene).map((p) => { const s = presetSize(p); return opt('p:' + p.id, `${p.label || p.id}${s ? ` ${s.w}×${s.h}` : ''}`); }).join('')
    + presets.list.filter((p) => p.scene).map((p) => opt('s:' + p.id, `Scene preset: ${p.label || p.id}`)).join('')
    + opt('custom', 'Custom size…') + opt('scale', 'Scale…');
  sel.value = D.preset;
}
function onField(e) {
  const el = e.target, k = el.dataset?.k;
  if (!k || !D) return;
  const num = () => (el.value === '' ? NaN : +el.value);
  const sc = sceneSize();
  if (RENDER_PREF_FIELDS.includes(k)) D._edited[k] = true;
  switch (k) {
    case 'preset': {
      if (el.value.startsWith('s:')) { const p = presets.list.find((p) => p.scene && p.id === el.value.slice(2)); if (p) applyPreset(p); syncPresetSelect(); break; }
      D.preset = el.value;
      if (D.preset === 'custom') { const o = outSize({ ...D, preset: 'scene' }, sc); if (!(D.w > 1)) { D.w = o.w; D.h = o.h; } }
      break;
    }
    case 'w': D.w = num(); if (D.lock && D.w > 0) D.h = Math.max(2, Math.round(D.w * sc.h / sc.w)); break;
    case 'h': D.h = num(); if (D.lock && D.h > 0) D.w = Math.max(2, Math.round(D.h * sc.w / sc.h)); break;
    case 'lock': D.lock = el.checked; break;
    case 'scale': D.scale = num(); break;
    case 'fps': D.fps = num(); break;
    case 'rangeMode': D.rangeMode = el.value; if (D.rangeMode === 'custom' && !(D.to > D.from)) { D.from = 0; D.to = r3(duration()); } break;
    case 'from': D.from = num(); break;
    case 'to': D.to = num(); break;
    case 'format': D.format = el.value; D._alphaTouched = false; fixFormat(); break;
    case 'codec': D.codec = el.value; break;
    case 'quality': D.quality = el.value; break;
    case 'alpha': D.alpha = el.checked; D._alphaTouched = true; break;
    case 'audio': D.audio = el.checked; break;
    case 'fit': D.fit = el.value; break;
    case 'pad': D.pad = el.value; break;
    case 'out': D.out = el.value; D.outEdited = el.value.trim() !== ''; break;
    case 'presetName': D.presetName = el.value; break;
    case 'cropMode': setCropMode(el.value); break;
    case 'ease': D.crop.ease = el.value; for (const key of D.crop.keys) key.ease = D.crop.ease; break;
    default: return;
  }
  saveOpts();
  sync();
}
function onClick(e) {
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const a = b.dataset.a;
  if (a === 'from-now') { D.from = r3(transport.time()); D.rangeMode = 'custom'; if (!(D.to > D.from)) D.to = r3(duration()); sync(); }
  else if (a === 'to-now') { D.to = r3(transport.time()); D.rangeMode = 'custom'; sync(); }
  else if (a === 'mode') { D._edited.mode = true; D.mode = b.dataset.v === 'exact' ? 'exact' : 'fast'; saveOpts(); sync(); }
  else if (a === 'crop-reset') { resetCrop(); sync(); }
  else if (a === 'key-add') addKey();
  else if (a === 'key-del') { D.crop.keys.splice(+b.dataset.i, 1); sync(); }
  else if (a === 'key-go') seek(D.crop.keys[+b.dataset.i].t, { frame: true });
  else if (a === 'save-preset') savePreset();
  else if (a === 'enqueue') submit(false);
  else if (a === 'now') submit(true);
  else if (a === 'q-toggle') { Q.running = !Q.running; renderQueue(); pump(); }
  else if (a === 'clear') clearFinished();
  else if (a === 'q-cancel') cancelJob(jobById(b.dataset.id));
  else if (a === 'q-retry') retryJob(jobById(b.dataset.id));
  else if (a === 'q-del') removeJob(jobById(b.dataset.id));
  else if (a === 'q-ask') askAboutJob(jobById(b.dataset.id));
  else if (a === 'reveal') reveal(b.dataset.rel);
  else if (a === 'open') openFile(b.dataset.rel);
  else if (a === 'q-show') { b.closest('.rq-job')?.classList.toggle('open'); }
}

/** Refresh every dependent bit of the form from D (never rewrites a field that has focus). */
function sync() {
  if (!D || !ui.open || !S.meta) return;
  const f = FORMATS[D.format], sc = { ...sceneSize(), fps: fps() }, o = outSize(D, sc), form = els.form;
  const setv = (k, v) => { const el = form.querySelector(`[data-k="${k}"]`); if (el && el.ownerDocument.activeElement !== el) { if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? ''; } };
  const show = (name, on_) => { for (const el of form.querySelectorAll(`[data-show="${name}"]`)) el.hidden = !on_; };
  if (D.fit && cropActive()) D.fit = '';
  const aspectDiffers = Math.abs(o.w / o.h - sc.w / sc.h) > 0.004;
  setv('preset', D.preset); setv('w', D.w); setv('h', D.h); setv('lock', D.lock); setv('scale', D.scale); setv('fps', D.fps);
  setv('rangeMode', D.rangeMode); setv('format', D.format); setv('codec', D.codec); setv('quality', D.quality); setv('alpha', D.alpha); setv('audio', D.audio);
  setv('fit', D.fit); setv('pad', D.pad); setv('cropMode', D.crop.mode); setv('ease', D.crop.ease); setv('presetName', D.presetName);
  const r = rangeOf();
  setv('from', D.rangeMode === 'custom' ? D.from : r?.from ?? 0); setv('to', D.rangeMode === 'custom' ? D.to : r?.to ?? 0);
  for (const k of ['from', 'to']) form.querySelector(`[data-k=${k}]`).disabled = D.rangeMode !== 'custom';
  show('custom', D.preset === 'custom'); show('scale', D.preset === 'scale'); show('range', D.rangeMode !== 'whole');
  show('fit', aspectDiffers && !cropActive() && D.crop.mode === 'none'); show('pad', D.fit === 'contain');
  show('crop', D.crop.mode !== 'none'); show('anim', D.crop.mode === 'anim');
  form.querySelector('[data-k=codec]').hidden = !f.codec; form.querySelector('[data-k=quality]').hidden = !f.quality;
  const alpha = form.querySelector('[data-k=alpha]'), audio = form.querySelector('[data-k=audio]');
  alpha.disabled = !f.alpha; audio.disabled = !f.audio;
  $('rd-alpha-l').classList.toggle('off', !f.alpha); $('rd-audio-l').classList.toggle('off', !f.audio);
  $('rd-alpha-l').title = f.alpha ? '' : 'Only PNG, ProRes and the alpha WebM / MOV formats keep transparency';
  $('rd-audio-l').title = f.audio ? '' : 'Audio is muxed into MP4 only';
  for (const b of $('rd-mode').querySelectorAll('button')) { const on = b.dataset.v === D.mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); }
  $('rd-modeinfo').textContent = D.mode === 'exact' ? 'Exact: software rendering, bit-identical. Use for finals.'
    : `Fast: GPU rendering. Use for previews and drafts.${f.quality && D.quality === 'draft' && ['mp4', 'webm', 'gif'].includes(D.format) ? ' Draft uses JPEG frames.' : ''}`;
  $('rd-sizeinfo').textContent = `Output ${o.w}×${o.h}${o.w !== sc.w ? ` · ${(o.w / sc.w).toFixed(2)}× scene` : ''}${aspectDiffers && D.crop.mode === 'none' ? ' · aspect differs from the scene' : ''}`;
  $('rd-fpsinfo').textContent = `scene ${sc.fps}`;
  const secs = r ? r.to - r.from : 0;
  $('rd-rangeinfo').textContent = r ? `${r3(secs)} s · ${Math.round(secs * (D.fps || sc.fps))} frames` : 'No loop region set (shift-drag on the ruler)';
  // crop
  const A = o.w / o.h;
  if (D.crop.mode !== 'none') {
    if (!D.crop.rect) D.crop.rect = fitRect(sc.w, sc.h, A, 0.8);
    else if (Math.abs(D.crop.rect.w / D.crop.rect.h - A) > 0.002) D.crop.rect = reaspect(D.crop.rect, sc.w, sc.h, A);
    for (const k of D.crop.keys) if (Math.abs(k.w / k.h - A) > 0.002) Object.assign(k, reaspect(k, sc.w, sc.h, A));
  }
  const cr = D.crop.rect;
  $('rd-cropinfo').textContent = D.crop.mode === 'none' ? '' : cr
    ? `Window ${Math.round(cr.w)}×${Math.round(cr.h)} at ${Math.round(cr.x)},${Math.round(cr.y)} (aspect locked to ${o.w}×${o.h}). ${D.crop.mode === 'anim' ? 'Drag the window, then add a key.' : 'Drag the window or its corners on the picture.'}` : '';
  $('rd-keys').innerHTML = D.crop.keys.length ? D.crop.keys.map((k, i) => `<div class="rd-key"><button type="button" class="link" data-a="key-go" data-i="${i}" title="Go to this key">${k.t.toFixed(2)} s</button><span class="dim">${Math.round(k.w)}×${Math.round(k.h)} @ ${Math.round(k.x)},${Math.round(k.y)}</span><button type="button" class="link" data-a="key-del" data-i="${i}" title="Delete key">&times;</button></div>`).join('')
    : '<div class="dim">No keys yet. Position the window, move the playhead, add keys. One key = a static crop.</div>';
  // output
  if (!D.outEdited) D.out = defaultOut(D, S.name, sc);
  setv('out', D.out);
  const { errors } = buildArgs(D, S.name, sc, duration(), 'x');
  const er = $('rd-err');
  er.hidden = !errors.length; er.innerHTML = errors.map(esc).join('<br>');
  for (const b of els.aside.querySelectorAll('[data-a=enqueue],[data-a=now]')) b.disabled = errors.length > 0;
  placeOverlay();
}

// ---------- crop ----------
function setCropMode(m) {
  D.crop.mode = m;
  if (m === 'none') return;
  const sc = sceneSize(), o = outSize(D, sc);
  if (!D.crop.rect) D.crop.rect = fitRect(sc.w, sc.h, o.w / o.h, 0.8);
  if (m === 'anim' && D.crop.keys.length) D.crop.rect = cropAt(D.crop.keys, transport.time());
}
function resetCrop() { const sc = sceneSize(), o = outSize(D, sc); D.crop.rect = fitRect(sc.w, sc.h, o.w / o.h, 0.8); }
function addKey() {
  if (!D.crop.rect) return;
  const t = Math.round(clamp(transport.time(), 0, duration()) * fps()) / fps();
  const key = { t: r3(t), ...D.crop.rect, ease: D.crop.ease };
  for (const k of ['x', 'y', 'w', 'h']) key[k] = Math.round(key[k] * 100) / 100;
  const i = D.crop.keys.findIndex((k) => Math.abs(k.t - key.t) < 0.5 / fps());
  if (i >= 0) D.crop.keys[i] = key; else D.crop.keys.push(key);
  D.crop.keys.sort((a, b) => a.t - b.t);
  sync();
}
function onTime() {
  if (!ui.open || !D || D.crop.mode !== 'anim' || dragging || !D.crop.keys.length) return;
  D.crop.rect = cropAt(D.crop.keys, transport.time());
  placeOverlay();
  const info = $('rd-cropinfo');
  if (info && D.crop.rect) info.textContent = `Window ${Math.round(D.crop.rect.w)}×${Math.round(D.crop.rect.h)} at ${Math.round(D.crop.rect.x)},${Math.round(D.crop.rect.y)} @ ${transport.time().toFixed(2)} s. Drag it, then add a key.`;
}
function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'crop-ov';
  overlay.innerHTML = '<div class="cr-rect"><i class="cr-h nw" data-h="nw"></i><i class="cr-h ne" data-h="ne"></i><i class="cr-h sw" data-h="sw"></i><i class="cr-h se" data-h="se"></i><span class="cr-lab"></span></div>';
  $('video-wrap').appendChild(overlay);
  const rect = overlay.firstElementChild;
  rect.addEventListener('pointerdown', onCropDown);
  return overlay;
}
function placeOverlay() {
  const want = ui.open && ui.tab === 'setup' && D && D.crop.mode !== 'none' && D.crop.rect && S.meta;
  if (!want) { if (overlay) overlay.hidden = true; return; }
  const b = videoBox();
  if (!b) { if (overlay) overlay.hidden = true; return; }
  ensureOverlay().hidden = false;
  const wr = $('video-wrap').getBoundingClientRect();
  Object.assign(overlay.style, { left: b.left - wr.left + 'px', top: b.top - wr.top + 'px', width: b.w + 'px', height: b.h + 'px' });
  const r = D.crop.rect, el = overlay.firstElementChild;
  Object.assign(el.style, { left: r.x * b.k + 'px', top: r.y * b.k + 'px', width: r.w * b.k + 'px', height: r.h * b.k + 'px' });
  el.querySelector('.cr-lab').textContent = `${Math.round(r.w)}×${Math.round(r.h)}`;
}
function onCropDown(e) {
  if (e.button !== 0 || !D?.crop.rect) return;
  e.preventDefault(); e.stopPropagation();
  const b = videoBox(), sc = sceneSize(), A = D.crop.rect.w / D.crop.rect.h;
  const handle = e.target.dataset?.h || null, r0 = { ...D.crop.rect };
  const start = { x: (e.clientX - b.left) / b.k, y: (e.clientY - b.top) / b.k };
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  dragging = true;
  const move = (ev) => {
    const p = { x: (ev.clientX - b.left) / b.k, y: (ev.clientY - b.top) / b.k };
    if (!handle) {
      D.crop.rect = { ...r0, x: clamp(r0.x + p.x - start.x, 0, sc.w - r0.w), y: clamp(r0.y + p.y - start.y, 0, sc.h - r0.h) };
    } else {
      const sx = handle.includes('e') ? 1 : -1, sy = handle.includes('s') ? 1 : -1;
      const ax = sx > 0 ? r0.x : r0.x + r0.w, ay = sy > 0 ? r0.y : r0.y + r0.h; // fixed (opposite) corner
      const maxW = Math.min(sx > 0 ? sc.w - ax : ax, (sy > 0 ? sc.h - ay : ay) * A);
      const w = clamp(Math.max((p.x - ax) * sx, (p.y - ay) * sy * A), Math.min(24, maxW), maxW), h = w / A;
      D.crop.rect = { x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h };
    }
    placeOverlay();
    $('rd-cropinfo').textContent = `Window ${Math.round(D.crop.rect.w)}×${Math.round(D.crop.rect.h)} at ${Math.round(D.crop.rect.x)},${Math.round(D.crop.rect.y)}`;
  };
  const up = () => {
    target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up);
    dragging = false; sync();
  };
  target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
}

// ---------- scene presets (scenes/<scene>/render.json) ----------
async function savePreset() {
  const name = (D.presetName || '').trim(), id = slug(name);
  if (!id) return host.toast('Give the preset a name first', 3000);
  const sc = { ...sceneSize(), fps: fps() }, o = outSize(D, sc), f = FORMATS[D.format];
  const p = { id, label: name, size: `${o.w}x${o.h}`, fps: +D.fps, format: D.format };
  p.mode = D.mode === 'exact' ? 'exact' : 'fast';
  if (f.codec) p.codec = D.codec;
  if (f.quality) p.quality = D.quality;
  if (f.alpha) p.alpha = !!D.alpha;
  if (f.audio) p.audio = !!D.audio;
  if (D.crop.mode === 'static' && D.crop.rect) p.crop = rectArg(D.crop.rect);
  try {
    const cur = await readSceneRenderJson(S.name);
    if (cur === undefined) return host.toast(`scenes/${S.name}/render.json is not valid JSON; fix it first`, 5000);
    const doc = Array.isArray(cur) ? { presets: cur } : cur && typeof cur === 'object' ? cur : {};
    const list = Array.isArray(doc.presets) ? doc.presets.filter((x) => x && x.id !== id) : [];
    doc.presets = [...list, p];
    await api.writeProjectText(`scenes/${S.name}/render.json`, JSON.stringify(doc, null, 2) + '\n');
    host.toast(`Saved preset "${name}" → scenes/${S.name}/render.json`, 3500);
    presets.key = '';
    await loadPresets(true);
    D.presetName = '';
    syncPresetSelect(); sync();
  } catch (e) { host.toast('Saving the preset failed: ' + (e.message || e), 5000); }
}

// ---------- queue ----------
// Q.running (session only): the queue starts queued items by itself. Off, a queued item waits for Start queue; items added with
// Render now / Retry / quick render carry j.now and start as soon as nothing else is rendering.
const Q = { jobs: [], loaded: new Set(), seq: 0, running: false };
const qKey = (root) => `gfx-studio.renderq.v1.${root}`;
const jobById = (id) => Q.jobs.find((j) => j.id === id);
const cardId = (j) => j.cardId || j.id;
const mine = () => {
  const cards = new Map();
  for (const j of Q.jobs) if (j.root === S.root) cards.set(cardId(j), j);
  return [...cards.values()];
};
const newId = () => `r${Date.now().toString(36)}${(Q.seq++).toString(36)}`;
const isActive = (j) => j.status === 'queued' || j.status === 'running' || j.status === 'canceling';

function persist(root) {
  const keep = Q.jobs.filter((j) => j.root === root).slice(-40).map((j) => ({ ...j, log: (j.log || []).slice(-12), handle: undefined }));
  writeJson(qKey(root), keep);
}
function persistAll() { for (const r of new Set(Q.jobs.map((j) => j.root))) persist(r); }
function loadQueue() {
  if (!S.root || Q.loaded.has(S.root)) return;
  Q.loaded.add(S.root);
  const saved = readJson(qKey(S.root), []);
  for (const j of Array.isArray(saved) ? saved : []) {
    if (!j || typeof j.id !== 'string' || Q.jobs.some((x) => x.id === j.id)) continue;
    if (isActive(j)) { j.status = 'error'; j.error = 'Interrupted: the studio was closed while this job was queued or running'; j.t1 = j.t1 || Date.now(); }
    Q.jobs.push(j);
  }
}
export function projectChanged() {
  loadQueue();
  D = null; presets.key = '';
  renderQueue(); updateChip(); pump();
}

function makeJob({ args, out, label, refresh, audio, scene = S.name }) {
  return { id: newId(), root: S.root, scene, label, args, out, refresh: !!refresh, audio: !!audio, format: args[args.indexOf('--format') + 1] || 'mp4', status: 'queued', t0: 0, t1: 0, created: Date.now(), phase: '', done: 0, total: 0, eta: null, log: [], outputs: [], error: null };
}
function addJob(job, first, now = first) {
  if (now) job.now = true;
  if (first) { const i = Q.jobs.findIndex((j) => j.status === 'queued' && j.root === job.root); Q.jobs.splice(i < 0 ? Q.jobs.length : i, 0, job); }
  else Q.jobs.push(job);
  persist(job.root); renderQueue(); updateChip(); pump();
}

async function submit(now) {
  if (!D || !S.name) return;
  const sc = { ...sceneSize(), fps: fps() };
  const id = newId().slice(1);
  const cropFile = `out/${S.name}/review/crop-${id}.json`;
  const { args, errors } = buildArgs(D, S.name, sc, duration(), cropFile);
  if (errors.length) return;
  if (args.includes('--crop-track')) {
    const keys = D.crop.keys.map((k) => ({ t: k.t, x: Math.round(k.x * 100) / 100, y: Math.round(k.y * 100) / 100, w: Math.round(k.w * 100) / 100, h: Math.round(k.h * 100) / 100, ease: k.ease || D.crop.ease }));
    try { await api.writeText(cropFile, JSON.stringify({ keys }, null, 2) + '\n'); } catch (e) { return host.toast('Could not write the crop track: ' + (e.message || e), 5000); }
  }
  const o = outSize(D, sc), f = FORMATS[D.format];
  const label = `${D.format}${f.codec && D.codec !== 'h264' ? ' ' + D.codec : ''} ${o.w}×${o.h}${rangeIsWhole() ? '' : ` ${fmtT(rangeOf().from)}-${fmtT(rangeOf().to)} s`}${cropActive() ? ' crop' : ''}`;
  const out = D.out.trim();
  addJob(makeJob({ args, out, label, audio: args.includes('--audio'), refresh: out === `out/${S.name}/${S.name}.mp4` }), now);
  saveOpts();
  setTab('queue');
  host.toast(now ? 'Rendering…' : Q.running ? 'Added to the queue' : 'Added to the queue · press Start queue', 2200);
}

/** Default render: mp4 + audio at scene size into the review video. */
export function quickRender() {
  if (!S.name) return;
  const rp = renderPrefs(), args = ['render', S.name, '--audio', '--mode', rp.mode];
  if (rp.workers > 0) args.push('--workers', String(rp.workers));
  if (rp.frameFormat === 'jpeg') args.push('--frame-format', 'jpeg');
  const j = makeJob({ args, out: `out/${S.name}/${S.name}.mp4`, label: `Quick render · mp4 + audio · ${rp.mode}`, refresh: true, audio: true });
  addJob(j, false, true);
  host.toast('Quick render started · progress in the Queue', 2500);
  if (ui.open) setTab('queue');
}

const PHASE_W = { frames: 0.85, encode: 0.05, audio: 0.10 };
const phaseOrder = (j) => [...(j.format === 'png' ? ['frames'] : ['frames', 'encode']), ...(j.audio ? ['audio'] : [])];
// Phases overlap (ffmpeg's encode counter streams in while frames are still being captured), so each phase keeps its
// own progress; the overall bar is the weighted sum, not "every phase before the latest event is complete".
function overall(j) {
  const order = phaseOrder(j), ph = j.phases || {};
  if (!order.some((p) => ph[p]?.total > 0)) return null;
  const sum = order.reduce((s, p) => s + (PHASE_W[p] || 0.1), 0);
  const got = order.reduce((s, p) => s + (PHASE_W[p] || 0.1) * (ph[p]?.total > 0 ? ph[p].done / ph[p].total : 0), 0);
  return clamp(got / sum, 0, 1);
}
function pump() {
  if (Q.jobs.some((j) => j.status === 'running' || j.status === 'canceling')) return;
  const j = Q.jobs.find((x) => x.status === 'queued' && x.root === S.root && (x.now || Q.running));
  if (j) run(j);
}
function run(j) {
  j.status = 'running'; j.t0 = Date.now(); j.phase = ''; j.phases = {}; j.done = j.total = 0;
  renderQueue(); updateChip();
  let h;
  try { h = api.engineRun(j.args, { jobId: j.id, onEvent: (ev) => onEvent(j, ev) }); } catch (e) { return finish(j, { code: -1, error: String(e.message || e), outputs: [] }); }
  j.handle = h;
  h.done.then((res) => finish(j, res), (e) => finish(j, { code: -1, error: String(e.message || e), outputs: [] }));
}
function onEvent(j, ev) {
  if (ev.type === 'progress') {
    const ph = (j.phases ||= {});
    const p = (ph[ev.phase] ||= { t0: Date.now() });
    p.done = ev.done; p.total = ev.total;
    p.eta = Number.isFinite(ev.eta) ? ev.eta : ev.done > 0 && ev.total > ev.done ? ((Date.now() - p.t0) / 1000) * (ev.total - ev.done) / ev.done : null;
    // Show the earliest unfinished phase (capture while it runs, not the encode counter that trails it).
    const order = phaseOrder(j);
    const cur = order.find((n) => ph[n] && !(ph[n].done >= ph[n].total)) || (order.includes(ev.phase) ? [...order].reverse().find((n) => ph[n]) : ev.phase);
    const c = ph[cur] || p;
    j.phase = cur; j.done = c.done; j.total = c.total; j.eta = c.eta;
  } else if (ev.type === 'log') {
    const m = /^renderer:\s*(.+)$/i.exec(String(ev.msg || ''));
    if (m) j.renderer = m[1].trim();
    if (ev.level === 'warn' || ev.level === 'warning' || /no GPU available/i.test(String(ev.msg || ''))) j.warn = String(ev.msg);
    (j.log ||= []).push(`${ev.level === 'error' ? '[error] ' : ev.level === 'warn' || ev.level === 'warning' ? '[warn] ' : ''}${ev.msg}`);
    if (j.log.length > 60) j.log.splice(0, j.log.length - 60);
  } else if (ev.type === 'error') {
    j.error = ev.msg;
    (j.log ||= []).push(`[error] ${ev.msg}`);
  }
  scheduleQueueRender();
}
export const toRel = (p) => { const s = String(p).replace(/\\/g, '/'), i = s.lastIndexOf('/out/'); return i >= 0 ? s.slice(i + 1) : s.startsWith('out/') ? s : null; };
function finish(j, res) {
  j.handle = null; j.t1 = Date.now();
  const canceled = j.status === 'canceling' || !!res.canceled;
  j.outputs = (res.outputs || []).map(toRel).filter(Boolean);
  if (canceled) { j.status = 'canceled'; j.partial = true; }
  else if (res.code === 0) { j.status = 'done'; j.done = j.total; if (!j.outputs.includes(j.out)) j.outputs.unshift(j.out); }
  else { j.status = 'error'; j.error = j.error || res.error || `The render exited with code ${res.code}`; j.partial = true; }
  persist(j.root); renderQueue(); updateChip();
  if (j.status === 'done') {
    host.toast(`Rendered ${j.out}`, 3500);
    emit('render-done', j); // versions.js: auto checkpoint "Rendered <scene> <preset>" with a thumb
    if (j.refresh && j.root === S.root && S.name === j.scene) host.reloadScene(j.scene).then(() => host.refreshScenes()).catch(() => {});
  } else if (j.status === 'error') host.toast(`Render failed: ${j.error}`, 6000);
  if (ui.open && ui.tab === 'renders') refreshRenders();
  else updateRendersCount();
  pump();
}
function cancelJob(j) {
  if (!j) return;
  if (j.status === 'queued') { j.status = 'canceled'; j.t1 = Date.now(); persist(j.root); renderQueue(); updateChip(); return; }
  if (j.status === 'running') { j.status = 'canceling'; renderQueue(); api.engineCancel(j.id).catch(() => {}); }
}
function retryJob(j) {
  if (!j || isActive(j)) return;
  const next = makeJob({ args: j.args, out: j.out, label: j.label, refresh: j.refresh, audio: j.audio, scene: j.scene });
  Object.assign(next, { cardId: cardId(j), attempt: (j.attempt || 1) + 1,
    attempts: [...(j.attempts || []), { status: j.status, error: j.error, warn: j.warn, renderer: j.renderer, log: j.log, outputs: j.outputs, t0: j.t0, t1: j.t1 }] });
  openLogs.delete(j.id);
  addJob(next, false, true);
}
function removeJob(j) { if (!j || isActive(j)) return; Q.jobs = Q.jobs.filter((x) => x.root !== j.root || cardId(x) !== cardId(j)); persist(j.root); renderQueue(); updateChip(); }
function clearFinished() { const root = S.root; Q.jobs = Q.jobs.filter((j) => j.root !== root || isActive(j)); persist(root); renderQueue(); updateChip(); }

let qRaf = 0;
function scheduleQueueRender() { if (!qRaf) qRaf = requestAnimationFrame(() => { qRaf = 0; renderQueue(); updateChip(); }); }
function updateChip() {
  const active = mine().filter(isActive), run_ = active.find((j) => j.status === 'running' || j.status === 'canceling');
  const chip = $('rq-btn');
  chip.hidden = false; chip.style.visibility = mine().length ? '' : 'hidden';
  emit('render-busy', !!run_);
  const p = run_ ? overall(run_) : null;
  chip.querySelector('span').textContent = 'Queue';
  chip.title = run_ ? `Render queue: rendering${p != null ? ' ' + Math.round(p * 100) + '%' : '…'}` : 'Render queue';
  chip.querySelector('b').textContent = String(mine().length);
  chip.querySelector('i').style.visibility = run_ ? '' : 'hidden';
  chip.querySelector('b').title = String(mine().length);
}
function renderQueue() {
  if (!els.queue) return;
  const js = mine().slice().reverse();
  $('rd-nq').textContent = String(js.filter(isActive).length);
  const tg = $('rq-toggle');
  if (tg) { tg.textContent = Q.running ? 'Pause queue' : 'Start queue'; tg.title = Q.running ? 'Finish the running item, then stop starting queued ones' : 'Start rendering the queued items in order'; tg.classList.toggle('primary', !Q.running); }
  if (!ui.open || ui.tab !== 'queue') return;
  const scroll = els.queue.scrollTop, side = new Map([...els.queue.querySelectorAll('.rq-job')].map((c) => [c.dataset.id, c.querySelector('.rq-btns')?.scrollLeft || 0]));
  els.queue.innerHTML = js.length ? js.map(jobHtml).join('') : '<div class="rd-empty">Nothing rendered from this project yet.<br>Use Render now / Add to queue, or the quick render button.</div>';
  els.queue.scrollTop = scroll;
  for (const c of els.queue.querySelectorAll('.rq-job')) { const b = c.querySelector('.rq-btns'), x = side.get(c.dataset.id); if (b && x) b.scrollLeft = x; } // a scrolled action row keeps Cancel in reach
  const open = els.queue.querySelectorAll('.rq-job');
  for (const el of open) if (openLogs.has(el.dataset.id)) el.classList.add('open');
}
const openLogs = new Set();
function jobOutput(j) {
  const outputs = j.outputs || [];
  if (j.audio && /\.mp4$/i.test(j.out)) {
    return outputs.find((p) => /\.sound\.mp4$/i.test(p))
      || outputs.find((p) => p !== j.out && /\.mp4$/i.test(p))
      || (outputs.length ? j.out : `out/${j.scene}/${j.scene}.sound.mp4`);
  }
  return outputs.find((p) => p === j.out) || outputs[0] || j.out;
}
/** "GPU · NVIDIA …" / "software" from the engine's `renderer: …` log line. */
export function rendererText(r) {
  if (!r) return '';
  return /swiftshader|llvmpipe|software|basic render|softpipe/i.test(r) ? (/^software$/i.test(r) ? 'software' : `software · ${r}`) : `GPU · ${r}`;
}
function rendererLine(j) { const text = rendererText(j.renderer); return `<div class="rq-note rq-renderer" title="${esc(text)}">${esc(text)}</div>`; }
function jobHtml(j) {
  const p = overall(j), live = j.status === 'running' || j.status === 'canceling';
  const progress = live ? `${j.status === 'canceling' ? 'Canceling…' : j.phase || 'starting'}${j.total ? ` ${j.done}/${j.total}` : ''}${p != null ? ` · ${Math.round(p * 100)}%` : ''}${j.eta > 0 && j.status === 'running' ? ` · ETA ${fmtDur(j.eta)}` : ''}${j.t0 ? ` · ${fmtDur((Date.now() - j.t0) / 1000)} elapsed` : ''}` : '';
  const tail = (j.log || []).slice(-6), failed = j.status === 'error';
  const stat = { queued: 'Queued', running: 'Rendering', canceling: 'Canceling', done: 'Done', error: 'Failed', canceled: 'Canceled' }[j.status];
  const note = j.status === 'done' ? `${fmtDur((j.t1 - j.t0) / 1000)} · ${ago(j.t1)}` : j.status === 'canceled' ? (j.t0 ? 'a partial file may remain in out/' : 'canceled before it started') : failed ? ago(j.t1) : '';
  const previous = j.attempts?.at(-1), statusName = (a) => ({ error: 'failed', done: 'done', canceled: 'canceled' }[a.status] || a.status);
  const attempt = previous ? `attempt ${j.attempt} · previous: ${statusName(previous)}${previous.error ? ` – ${previous.error}` : ''}` : '';
  const history = (j.attempts || []).map((a, i) => `Attempt ${i + 1}: ${statusName(a)}${a.error ? ` – ${a.error}` : ''}${a.warn ? `\n${a.warn}` : ''}${a.renderer ? `\n${rendererText(a.renderer)}` : ''}${a.log?.length ? `\n${a.log.join('\n')}` : ''}${a.outputs?.length ? `\n${a.outputs.join('\n')}` : ''}`).join('\n\n');
  const error = failed ? String(j.error || 'Failed') : '', out = jobOutput(j), id = j.id;
  const action = (a, label, visible, extra = '') => `<button type="button" class="tbtn sm${a === 'q-ask' ? ' rq-ask' : ''}" data-a="${a}" data-id="${id}"${visible ? '' : ' disabled style="visibility:hidden"'} ${extra}>${label}</button>`;
  return `<div data-density="dense" class="rq-job ${j.status}${openLogs.has(id) ? ' open' : ''}" data-id="${id}">
    <div class="rq-head"><span class="rq-dot"></span><b title="${esc(j.scene)}">${esc(j.scene)}</b><span class="rq-label" title="${esc(j.label)}">${esc(j.label)}</span><span class="rq-stat">${stat}</span></div>
    <div class="rq-out" title="${esc(j.out + '\n' + j.args.join(' '))}">${esc(j.out)}</div>
    <div class="rq-bar${live && p == null ? ' ind' : ''}"${live ? '' : ' style="visibility:hidden"'}><i style="width:${p == null ? 35 : Math.round(p * 100)}%"></i></div>
    <div class="rq-sub" title="${esc(progress)}">${esc(progress)}</div>
    ${rendererLine(j)}
    <div class="rq-warn" title="${esc(j.warn || '')}">${esc(j.warn || '')}</div>
    <div class="rq-note" title="${esc(note)}">${esc(note)}</div>
    <div class="rq-attempt rq-note" title="${esc(history)}">${esc(attempt)}</div>
    <div class="rq-error"${failed ? '' : ' style="visibility:hidden"'}><b title="${esc(error)}">${esc(error)}</b><pre title="${esc(tail.join('\n'))}">${failed ? esc(tail.join('\n')) : ''}</pre></div>
    <div class="rq-btns">
      ${action('q-ask', 'Ask Claude', failed, 'title="Ask Claude about this failure (brief + error log)"')}
      ${action('reveal', 'Reveal', j.status === 'done', `data-rel="${esc(out)}"`)}${action('open', 'Open', j.status === 'done', `data-rel="${esc(out)}"`)}
      <span class="rq-primary">${isActive(j) ? action('q-cancel', 'Cancel', true) : action('q-retry', j.status === 'done' ? 'Render again' : 'Retry', true)}</span>
      <button type="button" class="link" data-a="q-del" data-id="${id}" title="Remove from the list"${isActive(j) ? ' disabled style="visibility:hidden"' : ''}>&times;</button>
    </div></div>`;
}

/** Ask Claude about a failed render: the scene brief + the command and the end of its log. */
function askAboutJob(j) {
  if (!j) return;
  const log = (j.log || []).slice(-30).join('\n');
  emit('ask-claude', {
    source: 'render', scene: j.scene, t: 0, label: `Render error · ${j.scene}`,
    extra: `Render failed: ${j.error || 'error'}\nCommand: gfx ${j.args.join(' ')}\nLog (last lines):\n\`\`\`\n${log}\n\`\`\``,
    message: 'This render failed. Find the cause and fix it, then render again to verify.',
  });
}

// ---------- reveal / open ----------
async function reveal(rel) {
  try { const p = await api.revealPath(rel); if (!window.__TAURI__) host.toast(`In the browser there is no Explorer. File: ${p}`, 5000); }
  catch (e) { host.toast('Reveal failed: ' + (e.message || e), 5000); }
}
async function openFile(rel) {
  try { const p = await api.openPath(rel); if (!window.__TAURI__) host.toast(`In the browser there is no default app. File: ${p}`, 5000); }
  catch (e) { host.toast('Open failed: ' + (e.message || e), 5000); }
}

// ---------- renders list ----------
let rendersReq = 0;
async function refreshRenders() {
  if (!S.name || !els.renders) return;
  const my = ++rendersReq, scene = S.name;
  let files = [];
  try { files = await api.listRenders(scene); } catch (e) { els.renders.innerHTML = `<div class="rd-empty">${esc(e.message || e)}</div>`; return; }
  if (my !== rendersReq || scene !== S.name) return;
  $('rd-nr').textContent = String(files.length);
  const partial = new Set(mine().filter((j) => j.partial && j.status !== 'done').map((j) => j.out));
  els.renders.innerHTML = files.length ? files.map((f) => {
    const rel = `out/${scene}/${f.name}`;
    return `<div class="rr-row${partial.has(rel) ? ' partial' : ''}"><div class="rr-main"><b title="${esc(rel)}">${esc(f.name)}</b><small>${f.isDir ? 'frame folder' : fmtSize(f.size)} · ${ago(f.mtime)}${partial.has(rel) ? ' · partial (canceled / failed)' : ''}</small></div>
      <button type="button" class="tbtn sm" data-a="reveal" data-rel="${esc(rel)}">Reveal</button><button type="button" class="tbtn sm" data-a="open" data-rel="${esc(rel)}">Open</button></div>`;
  }).join('') : `<div class="rd-empty">No renders in out/${esc(scene)}/ yet.</div>`;
}
async function updateRendersCount() {
  if (!S.name || !els.renders) return;
  try { $('rd-nr').textContent = String((await api.listRenders(S.name)).length); } catch { /* n/a */ }
}
export const getJobs = () => Q.jobs;
export const getState = () => D;
