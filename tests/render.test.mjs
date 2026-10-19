// Render options test (docs/FOUNDATION.md §4): size/scale/preset, crop, crop-track, fit, reframe, alpha, formats, codecs,
// render.json presets, progress JSON. Fixture scenes: scenes/_render-test, scenes/_responsive-test.
// Run: node tests/render.test.mjs   (needs Chrome/Edge or GFX_CHROME, and ffmpeg)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { planRender, trackRect, listPresets, imageInputArgs, encodeArgs, videoFilters } from '../runner/lib/render-plan.js';
import { ffmpegPath, ffprobePath } from '../runner/lib/ffmpeg.js';
import { chromeFlags, pickBrowser, resolveMode, isSoftwareRenderer, CHROME_FLAGS } from '../runner/lib/browser.js';
import { resolveWorkers as resolveWorkers2 } from '../runner/lib/cli/commands/capture.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 500) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-render-test-'));
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 300000 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const R = (scene, ...args) => cli('render', scene, ...args);

// ---- minimal PNG reader (8-bit RGB/RGBA, non-interlaced) ----
function readPng(file) {
  const b = fs.readFileSync(file);
  let p = 8, w, h, ct;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8);
    if (type === 'IHDR') { w = b.readUInt32BE(p + 8); h = b.readUInt32BE(p + 12); ct = b[p + 17]; }
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(w * h * bpp);
  const stride = w * bpp;
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const up = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      let r;
      if (f === 0) r = v; else if (f === 1) r = v + a; else if (f === 2) r = v + up; else if (f === 3) r = v + ((a + up) >> 1);
      else { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); r = v + (pa <= pb && pa <= pc ? a : pb <= pc ? up : c); }
      px[y * stride + x] = r & 255;
    }
  }
  return { w, h, alpha: bpp === 4, at: (x, y) => { const o = (y * w + x) * bpp; return [px[o], px[o + 1], px[o + 2], bpp === 4 ? px[o + 3] : 255]; } };
}
const close = (c, rgb, tol = 24) => rgb.every((v, i) => Math.abs(c[i] - v) <= tol);
const RED = [255, 0, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255], GREEN = [0, 255, 0], MAGENTA = [255, 0, 255];
const probe = (file) => {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,width,height,nb_read_frames:stream_tags=alpha_mode', '-of', 'json', file], { encoding: 'utf8', timeout: 30000 });
  if (r.error) throw r.error;
  const s = JSON.parse(r.stdout).streams[0];
  return { ...s, alpha_mode: s.tags?.alpha_mode };
};
const frame = (dir, n = 0) => readPng(path.join(dir, `frame-${String(n).padStart(5, '0')}.png`));
const d = (n) => path.join(tmp, n);

try {
  const meta = { width: 200, height: 100, fps: 10, duration: 1 };
  const plan = (o, m = meta) => planRender(o, m, { sceneDir: path.join(ROOT, 'scenes', '_render-test') });
  const throws = (o, re, m) => { try { plan(o, m); return false; } catch (e) { return re.test(e.message) && e.render === true; } };

  console.log('plan / validation');
  ok(plan({}).out.w === 200 && plan({ scale: '2' }).out.h === 200 && plan({ scale: '2' }).dsf === 2, 'scale -> output size and deviceScaleFactor');
  ok(plan({ preset: '4k' }).out.w === 3840 && plan({ preset: 'reel' }).out.h === 1920, 'built-in presets fix the output size');
  ok(plan({ crop: '100,0,100,50' }).out.w === 100 && plan({ crop: '100,0,100,50', scale: '2' }).dsf === 2, 'static crop: output defaults to the crop size, dsf = dest/crop');
  const p169 = plan({ preset: '720p' });
  ok(Math.abs(p169.rect.w / p169.rect.h - 16 / 9) < 0.01 && p169.rect.x > 0, 'cover (default) centre-crops a mismatching aspect');
  ok(plan({ size: '100x100', fit: 'contain' }).letterbox && plan({ size: '100x100', fit: 'contain' }).dest.h === 50, 'contain letterboxes');
  {
    const p = plan({ size: '1920x1082', format: 'png' }, { ...meta, width: 1920, height: 1080 });
    ok(!p.pixelExact && !p.exact && videoFilters(p).includes('scale=1920:1082:flags=bicubic'), 'near-matching aspect still normalizes to both requested dimensions');
  }
  ok(plan({ format: 'webm-alpha' }).alpha && plan({ format: 'png', alpha: true }).alpha && !plan({ format: 'png' }).alpha, 'alpha implied by *-alpha formats, opt-in for png');
  ok(plan({ quality: 'high' }).crf === 12 && plan({ quality: 'draft' }).crf === 28 && plan({ quality: 'normal' }).crf === 18 && plan({}).crf === 18 && plan({ crf: '22', quality: 'high' }).crf === 22, 'quality -> crf (28/18/12); --crf wins');
  ok(plan({ format: 'webm' }).crf === 30 && plan({ format: 'gif', fps: '60' }).fps === 30, 'webm default crf 30; gif capped at 30 fps');
  ok(throws({ size: '10x10', scale: '2' }, /only one of/), 'error: --size with --scale');
  ok(throws({ preset: 'nope' }, /unknown --preset/), 'error: unknown preset');
  ok(throws({ size: '10' }, /WxH/), 'error: bad size');
  ok(throws({ alpha: true }, /--alpha is not possible with --format mp4/) && throws({ format: 'gif', alpha: true }, /--alpha/), 'error: --alpha for mp4/gif');
  ok(throws({ format: 'webm', codec: 'h265' }, /--codec only applies to --format mp4/) && throws({ codec: 'vp9' }, /h264\|h265/), 'error: bad codec combos');
  ok(throws({ reframe: '100x100' }, /responsive/), 'error: --reframe on a non-responsive scene');
  ok(plan({ reframe: '100x400' }, { ...meta, responsive: true }).scene.h === 400, '--reframe on a responsive scene sets the scene size');
  ok(throws({ crop: '0,0,10,10', 'crop-track': 'x.json' }, /not both/) && throws({ crop: '150,0,100,50' }, /leaves the/), 'error: crop + crop-track, crop outside scene');
  ok(throws({ crop: '1,2,3' }, /--crop must be/), 'error: malformed --crop');
  ok(throws({ pad: '#fff' }, /--pad needs --fit contain/) && throws({ fit: 'contain', pad: 'red' }, /hex colour/), 'error: --pad rules');
  ok(throws({ format: 'png', crf: '10' }, /do not apply/) && throws({ quality: 'ultra' }, /draft\|normal\|high/) && throws({ crf: '99' }, /0-63/), 'error: crf/quality rules');
  ok(throws({ audio: true, format: 'webm' }, /--audio needs --format mp4/) && throws({ format: 'avi' }, /--format must be/), 'error: audio/format');
  ok(throws({ 'render-preset': 'nope' }, /not found/), 'error: unknown render preset');
  ok(throws({ 'crop-track': { keys: [{ t: 0, x: 0, y: 0, w: 100, h: 100 }] }, size: '100x50' }, /aspect/), 'error: crop-track aspect != output aspect');
  ok(throws({ 'crop-track': { keys: [{ t: 0, x: 0, y: 0, w: 100, h: 50, ease: 'wobble' }] } }, /unknown ease/), 'error: unknown ease');
  ok(throws({ 'crop-track': { keys: [{ t: 0, x: 0, y: 0, w: 100, h: 50 }] }, fit: 'contain' }, /does not apply with --crop-track/), 'error: --fit with crop-track');
  {
    const keys = plan({ 'crop-track': { keys: [{ t: 0, x: 0, y: 0, w: 100, h: 50 }, { t: 1, x: 100, y: 0, w: 50, h: 25, ease: 'linear' }] } }).track;
    const a = trackRect(keys, 0.5, 2, { w: 200, h: 100 });
    ok(a.x === 50 && a.w === 75 && a.h === 37.5, 'trackRect interpolates and keeps the output aspect', a);
    const e = trackRect(keys, 5, 2, { w: 200, h: 100 });
    ok(e.x === 100 && e.w === 50, 'trackRect holds the last key');
  }
  {
    const l = listPresets(path.join(ROOT, 'scenes', '_render-test'));
    ok(l.builtin.some((p) => p.id === '4k' && p.width === 3840) && l.scene.some((p) => p.id === 'half' && p.options.crop), 'listPresets has built-in and scene presets');
  }

  console.log('size / scale');
  let r = R('_render-test', '--scale', '2', '--format', 'png', '--dur', '0.1', '--out', d('s2'));
  ok(r.code === 0, 'scale 2 renders', r.err);
  {
    const f = frame(d('s2'));
    ok(f.w === 400 && f.h === 200, 'scale 2 -> 400x200', [f.w, f.h]);
    // 1px white line at css x=50 -> exactly device px 100-101, neighbours stay red (a 1x capture upscaled would blur)
    ok(close(f.at(98, 20), RED, 4) && close(f.at(99, 20), RED, 4) && close(f.at(100, 20), WHITE, 4) && close(f.at(101, 20), WHITE, 4) && close(f.at(102, 20), RED, 4), 'line is 2px wide and sharp at scale 2', [99, 100, 101, 102].map((x) => f.at(x, 20)));
  }
  r = R('_render-test', '--size', '400x200', '--format', 'png', '--dur', '0.1', '--out', d('size'));
  ok(r.code === 0 && close(frame(d('size')).at(100, 20), WHITE, 4) && close(frame(d('size')).at(99, 20), RED, 4), '--size 400x200 is the same sharp 2x capture');
  r = R('_render-test', '--preset', '720p', '--format', 'png', '--dur', '0.1', '--out', d('p720'));
  ok(r.code === 0 && frame(d('p720')).w === 1280 && frame(d('p720')).h === 720, '--preset 720p -> 1280x720', r.err);
  {
    const project = d('project');
    const scene = path.join(project, 'scenes', 'large');
    fs.mkdirSync(scene, { recursive: true });
    fs.writeFileSync(path.join(project, 'gfx.json'), '{"version":1}');
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ ...meta, kind: 'canvas', width: 1920, height: 1080, style: 'dark-grid' }));
    fs.writeFileSync(path.join(scene, 'scene.js'), 'export default { setup() {}, render() {} };');
    for (const format of ['png', 'mp4']) {
      const out = d(`near-aspect${format === 'mp4' ? '.mp4' : ''}`);
      r = R('large', '--project', project, '--size', '1920x1082', '--format', format, '--dur', '0.1', '--out', out);
      const size = r.code === 0 && (format === 'png' ? frame(out) : probe(out));
      ok(size && (size.w ?? size.width) === 1920 && (size.h ?? size.height) === 1082, `${format}: 1920x1080 scene -> exactly 1920x1082`, size || r.err);
    }
  }

  console.log('crop / fit');
  r = R('_render-test', '--crop', '100,0,100,50', '--format', 'png', '--dur', '0.1', '--out', d('crop'));
  {
    const f = frame(d('crop'));
    ok(r.code === 0 && f.w === 100 && f.h === 50 && close(f.at(2, 2), BLUE, 4) && close(f.at(97, 47), BLUE, 4) && close(f.at(50, 25), BLUE, 4), 'static crop = the right-top quadrant (all blue), 100x50', [f.w, f.h]);
  }
  r = R('_render-test', '--crop', '25,0,50,25', '--size', '200x100', '--format', 'png', '--dur', '0.1', '--out', d('crop2'));
  {
    const f = frame(d('crop2'));
    // window x 25..75, 4x zoom: line (css x=50) at device 100..103 and sharp
    ok(r.code === 0 && f.w === 200 && close(f.at(99, 40), RED, 4) && close(f.at(100, 40), WHITE, 4) && close(f.at(103, 40), WHITE, 4) && close(f.at(104, 40), RED, 4), 'static crop zoom is re-rasterised (4px sharp line)', [98, 99, 100, 103, 104].map((x) => f.at(x, 40)));
  }
  r = R('_render-test', '--size', '100x100', '--format', 'png', '--dur', '0.1', '--out', d('cover'));
  {
    const f = frame(d('cover'));
    ok(r.code === 0 && f.w === 100 && f.h === 100 && close(f.at(10, 10), RED, 4) && close(f.at(80, 10), BLUE, 4), 'default cover centre-crops (scene x 50..150)');
  }
  r = R('_render-test', '--size', '100x100', '--fit', 'contain', '--pad', '#ff00ff', '--format', 'png', '--dur', '0.1', '--out', d('contain'));
  {
    const f = frame(d('contain'));
    ok(r.code === 0 && f.w === 100 && f.h === 100 && close(f.at(50, 5), MAGENTA, 4) && close(f.at(50, 95), MAGENTA, 4) && close(f.at(20, 50), RED, 4) && close(f.at(80, 30), BLUE, 4), 'fit contain pads top/bottom with --pad colour', r.err);
  }
  r = R('_render-test', '--size', '100x100', '--fit', 'contain', '--format', 'mp4', '--dur', '0.2', '--out', d('contain.mp4'));
  ok(r.code === 0 && probe(d('contain.mp4')).width === 100 && probe(d('contain.mp4')).height === 100, 'contain works through ffmpeg (mp4 100x100)', r.err);

  console.log('crop-track');
  const track = { keys: [{ t: 0, x: 0, y: 0, w: 100, h: 50 }, { t: 0.9, x: 100, y: 0, w: 100, h: 50, ease: 'linear' }] };
  fs.writeFileSync(d('track.json'), JSON.stringify(track));
  r = R('_render-test', '--crop-track', d('track.json'), '--format', 'png', '--out', d('track'));
  {
    const a = frame(d('track'), 0), z = frame(d('track'), 9), m = frame(d('track'), 4);
    ok(r.code === 0 && a.w === 100 && a.h === 50 && close(a.at(10, 10), RED, 4) && close(z.at(10, 10), BLUE, 4), 'crop-track pans: first frame red, last frame blue', r.err);
    ok(close(m.at(10, 10), RED, 4) && close(m.at(90, 10), BLUE, 4), 'mid frame shows both halves (window at x=44)');
    ok(fs.readdirSync(d('track')).length === 10, 'one frame per step');
  }
  fs.writeFileSync(d('zoom.json'), JSON.stringify({ keys: [{ t: 0, x: 25, y: 0, w: 50, h: 25 }, { t: 1, x: 25, y: 0, w: 50, h: 25 }] }));
  r = R('_render-test', '--crop-track', d('zoom.json'), '--size', '100x50', '--format', 'png', '--dur', '0.1', '--out', d('zoom'));
  {
    const f = frame(d('zoom'));
    ok(r.code === 0 && f.w === 100 && f.h === 50 && close(f.at(49, 20), RED, 4) && close(f.at(50, 20), WHITE, 4) && close(f.at(51, 20), WHITE, 4) && close(f.at(52, 20), RED, 4), 'animated crop uses clip.scale: zoomed line stays sharp', [48, 49, 50, 51, 52].map((x) => f.at(x, 20)));
  }

  fs.writeFileSync(d('push.json'), JSON.stringify({ keys: [{ t: 0, x: 0, y: 0, w: 200, h: 100 }, { t: 0.9, x: 33.3, y: 7.7, w: 61.7, h: 30.85, ease: 'inOutCubic' }] }));
  r = R('_render-test', '--crop-track', d('push.json'), '--size', '160x80', '--format', 'png', '--out', d('push'));
  {
    const sizes = new Set(fs.readdirSync(d('push')).map((n) => { const f = readPng(path.join(d('push'), n)); return f.w + 'x' + f.h; }));
    ok(r.code === 0 && sizes.size === 1 && sizes.has('160x80') && !/warn/.test(r.out + r.err), 'animated zoom (fractional windows) gives constant exact frame size', [...sizes]);
  }
  {
    // Different dimensions AND pictures: GIF must retain every alternating frame, not coalesce identical frames.
    const images = ['crop', 'crop2'].map((dir) => fs.readFileSync(path.join(d(dir), 'frame-00000.png')));
    const input = Buffer.concat(Array.from({ length: 10 }, (_, i) => images[i % 2]));
    for (const format of ['gif', 'mp4', 'webm', 'png', 'prores', 'webm-alpha', 'mov-alpha']) {
      const p = plan({ format, size: '160x80', 'crop-track': track });
      const dir = d(`alternating-${format}`);
      if (format === 'png') fs.mkdirSync(dir);
      const out = format === 'png' ? path.join(dir, 'frame-%05d.png') : `${dir}.${p.ext}`;
      const encoded = spawnSync(ffmpegPath(), ['-y', '-v', 'error', ...imageInputArgs(p), ...encodeArgs(p, out)], { input, encoding: 'utf8', timeout: 30000 });
      if (encoded.error) throw encoded.error;
      let count = 0, exactSize = false;
      if (encoded.status === 0) {
        if (format === 'png') {
          const frames = fs.readdirSync(dir).map((file) => readPng(path.join(dir, file)));
          count = frames.length;
          exactSize = frames.every((f) => f.w === 160 && f.h === 80);
        } else {
          const s = probe(out);
          count = Number(s.nb_read_frames);
          exactSize = s.width === 160 && s.height === 80;
        }
      }
      ok(encoded.status === 0 && count === 10 && exactSize, `${format}: alternating-size input keeps all 10 frames at 160x80`, { count, err: encoded.stderr });
    }
    r = R('_render-test', '--crop-track', d('push.json'), '--size', '160x80', '--format', 'gif', '--out', d('push.gif'));
    ok(r.code === 0 && Number(probe(d('push.gif')).nb_read_frames) === 10, 'GIF fractional zoom capture keeps all 10 frames', r.err);
  }

  console.log('reframe');
  r = R('_responsive-test', '--format', 'png', '--dur', '0.1', '--out', d('rf0'));
  const base = frame(d('rf0'));
  r = R('_responsive-test', '--reframe', '200x400', '--format', 'png', '--dur', '0.1', '--out', d('rf1'));
  {
    const f = frame(d('rf1'));
    ok(r.code === 0 && base.w === 400 && f.w === 200 && f.h === 400, 'reframe output is the reframed size', [f.w, f.h]);
    ok(close(base.at(150, 10), GREEN, 4) && !close(f.at(150, 10), GREEN, 40) && close(f.at(50, 10), GREEN, 4) && close(f.at(10, 390), BLUE, 4) && close(f.at(190, 390), BLUE, 4), 'layout changes (green half = 100px wide, blue strip at the new bottom)');
  }
  r = R('_responsive-test', '--reframe', '200x400', '--scale', '2', '--format', 'png', '--dur', '0.1', '--out', d('rf2'));
  ok(r.code === 0 && frame(d('rf2')).w === 400 && frame(d('rf2')).h === 800, 'reframe + scale');
  r = R('_render-test', '--reframe', '100x100', '--format', 'png', '--dur', '0.1', '--out', d('rf3'));
  ok(r.code !== 0 && /responsive/.test(r.err), 'reframe on a fixed scene fails with a hint', r.err);

  console.log('alpha');
  r = R('_render-test', '--alpha', '--format', 'png', '--dur', '0.1', '--out', d('alpha'));
  {
    const f = frame(d('alpha'));
    ok(r.code === 0 && f.alpha && f.at(150, 75)[3] === 0 && f.at(10, 20)[3] === 255 && f.at(150, 20)[3] === 255 && close(f.at(10, 20), RED, 4), 'png --alpha: transparent where nothing is drawn, opaque elsewhere', f.alpha && f.at(150, 75));
  }
  r = R('_render-test', '--format', 'png', '--dur', '0.1', '--out', d('opaque'));
  ok(frame(d('opaque')).at(150, 75)[3] === 255, 'png without --alpha is opaque');
  r = R('_render-test', '--alpha', '--size', '100x100', '--fit', 'contain', '--format', 'png', '--dur', '0.1', '--out', d('alpha-pad'));
  ok(r.code === 0 && frame(d('alpha-pad')).at(50, 5)[3] === 0, 'alpha + contain pads transparent by default', r.err);
  r = R('_render-test', '--format', 'webm-alpha', '--dur', '0.2', '--out', d('a.webm'));
  {
    const pr = r.code === 0 && probe(d('a.webm'));
    ok(pr && (/a/.test(pr.pix_fmt.replace('yuv', '')) || pr.alpha_mode === '1') && pr.codec_name === 'vp9', 'webm-alpha: vp9 with alpha (pix_fmt/alpha_mode)', pr || r.err);
  }
  r = R('_render-test', '--format', 'mov-alpha', '--dur', '0.2', '--out', d('a.mov'));
  {
    const pr = r.code === 0 && probe(d('a.mov'));
    ok(pr && pr.codec_name === 'prores' && /^yuva444p1[02]le$/.test(pr.pix_fmt), 'mov-alpha: ProRes 4444 yuva444p10le', pr || r.err);
  }
  r = R('_render-test', '--format', 'prores', '--alpha', '--dur', '0.2', '--out', d('b.mov'));
  ok(r.code === 0 && /^yuva444p1[02]le$/.test(probe(d('b.mov')).pix_fmt), 'prores --alpha = 4444 with alpha');
  r = R('_render-test', '--format', 'prores', '--dur', '0.2', '--out', d('c.mov'));
  ok(r.code === 0 && probe(d('c.mov')).pix_fmt === 'yuv422p10le', 'prores (no alpha) = 422 HQ');
  r = R('_render-test', '--alpha', '--dur', '0.2', '--out', d('x.mp4'));
  ok(r.code !== 0 && /--alpha is not possible/.test(r.err), 'CLI: --alpha with mp4 is an error', r.err);

  console.log('codec / quality');
  r = R('_render-test', '--codec', 'h265', '--dur', '0.2', '--out', d('h265.mp4'));
  ok(r.code === 0 && probe(d('h265.mp4')).codec_name === 'hevc', 'h265 -> hevc stream', r.err);
  r = R('_render-test', '--quality', 'high', '--dur', '0.2', '--out', d('q.mp4'));
  ok(r.code === 0 && fs.readFileSync(d('q.mp4')).includes('crf=12.0'), '--quality high -> x264 crf=12', r.err);
  r = R('_render-test', '--crf', '23', '--dur', '0.2', '--out', d('q2.mp4'));
  ok(r.code === 0 && fs.readFileSync(d('q2.mp4')).includes('crf=23.0'), '--crf 23 -> x264 crf=23');
  r = R('_render-test', '--dur', '0.2', '--fps', '20', '--out', d('def.mp4'));
  ok(r.code === 0 && fs.readFileSync(d('def.mp4')).includes('crf=18.0') && probe(d('def.mp4')).codec_name === 'h264', 'default: h264 crf 18, --fps 20 accepted');
  {
    const sceneSound = path.join(ROOT, 'out', '_reel-test', '_reel-test.sound.mp4');
    const before = fs.existsSync(sceneSound) ? fs.statSync(sceneSound).mtimeMs : null;
    const hasAudio = (f) => spawnSync(ffprobePath(), ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', f], { encoding: 'utf8' }).stdout.trim() === 'aac';
    r = R('_reel-test', '--dur', '0.1', '--size', '270x480', '--audio', '--out', d('exp/named.mp4'), '--progress', 'json');
    const after = fs.existsSync(sceneSound) ? fs.statSync(sceneSound).mtimeMs : null;
    const done = r.out.trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return {}; } }).find((e) => e.type === 'done');
    ok(r.code === 0 && hasAudio(d('exp/named.mp4')) && fs.readdirSync(d('exp')).join() === 'named.mp4' && before === after,
      'export + --audio = one file with sound at --out (no .sound.mp4, no silent leftover), scene .sound.mp4 untouched', fs.existsSync(d('exp')) ? fs.readdirSync(d('exp')) : r.err);
    ok(done?.outputs?.[0] === d('exp/named.mp4') && !done.outputs.some((p) => /silent|\.sound\.mp4$/.test(p)), 'done.outputs starts with the single file', done?.outputs);
    r = R('_reel-test', '--dur', '0.1', '--size', '270x480', '--audio', '--keep-silent', '--out', d('keep/named.mp4'));
    ok(r.code === 0 && !hasAudio(d('keep/named.mp4')) && hasAudio(d('keep/named.sound.mp4')), '--keep-silent keeps the silent video + <name>.sound.mp4 next to it', r.err);
    r = R('_render-test', '--dur', '0.2', '--audio', '--out', d('nocues/x.mp4'));
    ok(r.code === 0 && fs.readdirSync(d('nocues')).join() === 'x.mp4', 'export + --audio on a scene without cues: the (silent) video is still written at --out', r.err);
    fs.writeFileSync(d('nocues/x.mp4'), 'stale');
    r = R('_render-test', '--dur', '0.2', '--audio', '--out', d('nocues/x.mp4'));
    ok(r.code === 0 && fs.statSync(d('nocues/x.mp4')).size > 100 && fs.readdirSync(d('nocues')).join() === 'x.mp4', 're-export without cues replaces an existing file at --out', r.err);
  }
  r = R('_render-test', '--format', 'gif', '--dur', '0.2', '--out', d('g.gif'));
  ok(r.code === 0 && probe(d('g.gif')).codec_name === 'gif', 'gif still works');
  r = R('_render-test', '--format', 'webm', '--dur', '0.2', '--out', d('w.webm'));
  ok(r.code === 0 && probe(d('w.webm')).codec_name === 'vp9', 'webm still works');

  console.log('render.json presets');
  r = cli('render', '--list-presets', '--json', '_render-test');
  {
    let j = null;
    try { j = JSON.parse(r.out); } catch {}
    ok(j && j.builtin.length >= 7 && j.scene.map((p) => p.id).join() === 'half,square-pad,fastdraft' && j.scene[0].label === 'Right half, 2x', 'render --list-presets --json _render-test', r.out.slice(0, 200));
  }
  r = cli('render', '--list-presets', '--json');
  ok(r.code === 0 && JSON.parse(r.out).scene.length === 0, '--list-presets without a scene lists built-ins only');
  r = R('_render-test', '--render-preset', 'half', '--dur', '0.1', '--out', d('rp'));
  {
    const f = frame(d('rp'));
    ok(r.code === 0 && f.w === 200 && f.h === 100 && close(f.at(100, 50), BLUE, 4), '--render-preset half (crop + scale 2 + png from render.json)', r.err);
  }
  r = R('_render-test', '--render-preset', 'half', '--size', '300x150', '--dur', '0.1', '--out', d('rp2'));
  ok(r.code === 0 && frame(d('rp2')).w === 300, 'CLI --size overrides the preset size group');
  r = R('_render-test', '--render-preset', 'square-pad', '--dur', '0.1', '--out', d('rp3'));
  ok(r.code === 0 && close(frame(d('rp3')).at(50, 5), MAGENTA, 4), '--render-preset with fit/pad');
  {
    const project = d('project');
    const scene = path.join(project, 'scenes', 'preset-range');
    fs.mkdirSync(scene, { recursive: true });
    fs.writeFileSync(path.join(scene, 'scene.json'), JSON.stringify({ ...meta, kind: 'canvas', style: 'dark-grid' }));
    fs.writeFileSync(path.join(scene, 'scene.js'), 'export default { setup() {}, render() {} };');
    fs.writeFileSync(path.join(scene, 'render.json'), JSON.stringify({ presets: [
      { id: 'audio-range', audio: true, from: 0.1, to: 0.3 },
      { id: 'duration', dur: 0.2 },
      { id: 'end', to: 0.2 },
    ] }));
    const full = path.join(project, 'out', 'preset-range', 'preset-range.mp4');
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'full render sentinel');
    for (const [id, suffix] of [['audio-range', '0.1-0.3'], ['duration', '0-0.2'], ['end', '0-0.2']]) {
      r = R('preset-range', '--project', project, '--render-preset', id, '--progress', 'json');
      const expected = path.join(path.dirname(full), `preset-range-${suffix}.mp4`);
      const done = r.code === 0 && JSON.parse(r.out.trim().split('\n').at(-1));
      ok(done && done.outputs.includes(expected) && fs.existsSync(expected) && fs.readFileSync(full, 'utf8') === 'full render sentinel', `preset ${id}: ranged filename preserves the full render`, r.err);
      if (id === 'audio-range') {
        const cues = path.join(path.dirname(full), 'audio', 'cues.json');
        ok(done && done.outputs.includes(cues) && fs.existsSync(cues), 'preset audio:true runs audio and reports its output', r.err);
      }
    }
  }

  console.log('parallel capture (--workers)');
  {
    const sameDir = (a, b) => {
      const fa = fs.readdirSync(a).sort(), fb = fs.readdirSync(b).sort();
      return fa.length === fb.length && fa.every((f, i) => f === fb[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
    };
    const fmd5 = (file) => {
      const x = spawnSync(ffmpegPath(), ['-v', 'error', '-i', file, '-f', 'framemd5', '-'], { encoding: 'utf8', timeout: 60000 });
      return x.stdout.split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(',').pop().trim()).join(',');
    };
    r = R('_render-test', '--format', 'png', '--workers', '1', '--out', d('w1'));
    const r3 = R('_render-test', '--format', 'png', '--workers', '3', '--out', d('w3'));
    ok(r.code === 0 && r3.code === 0 && fs.readdirSync(d('w3')).length === 10 && sameDir(d('w1'), d('w3')), 'png sequence: --workers 3 byte-identical to --workers 1 (every frame)', r3.err);
    const m1 = R('_render-test', '--workers', '1', '--out', d('wm1.mp4'));
    const m3 = R('_render-test', '--workers', '3', '--out', d('wm3.mp4'));
    ok(m1.code === 0 && m3.code === 0 && fmd5(d('wm1.mp4')).length > 0 && fmd5(d('wm1.mp4')) === fmd5(d('wm3.mp4')), 'mp4: --workers 3 frame hashes identical to --workers 1', m3.err);
    r = R('_render-test', '--crop-track', d('track.json'), '--format', 'png', '--workers', '3', '--out', d('track3'));
    ok(r.code === 0 && sameDir(d('track'), d('track3')), 'crop-track: --workers 3 identical to the serial render', r.err);
    for (const bad of ['0', '-1', 'abc', '1.5']) {
      r = R('_render-test', '--workers', bad, '--dur', '0.1', '--out', d('badw.mp4'));
      ok(r.code !== 0 && /--workers/.test(r.err + r.out), `--workers ${bad} -> error`, r.err);
    }
    const { resolveWorkers } = await import('../runner/lib/cli/commands/capture.js');
    ok(resolveWorkers('auto', 1) === 1 && resolveWorkers('auto', 8) === 1 && resolveWorkers('auto', 9) <= 2, 'auto: short ranges use fewer workers (ceil(frames/8))');
    ok(resolveWorkers('auto', 100000) >= 1 && resolveWorkers('auto', 100000) <= 8 && resolveWorkers('5', 3) === 5 && (process.env.GFX_WORKERS || resolveWorkers(undefined, 100000) === 1), 'auto is within 1..8; explicit N is honoured; default = 1 (bit-exact)');
    r = R('_render-test', '--workers', '16', '--format', 'png', '--dur', '0.3', '--out', d('w16'));
    ok(r.code === 0 && fs.readdirSync(d('w16')).length === 3, 'more workers than frames is clamped', r.err);
  }

  console.log('fast mode / frame format (FOUNDATION.md §4b)');
  {
    ok(plan({}).mode === 'exact' && plan({ mode: 'fast' }).mode === 'fast' && plan({}).frameFormat === 'png' && plan({ 'frame-format': 'jpeg' }).frameFormat === 'jpeg', 'plan: mode defaults to exact, frame-format to png');
    ok(throws({ mode: 'turbo' }, /--mode must be fast\|exact/), '--mode validation');
    ok(throws({ 'frame-format': 'bmp' }, /--frame-format must be png\|jpeg/), '--frame-format validation');
    ok(throws({ 'frame-format': 'jpeg', format: 'png' }, /jpeg only works/) && throws({ 'frame-format': 'jpeg', format: 'prores' }, /jpeg only works/) && throws({ 'frame-format': 'jpeg', format: 'webm-alpha' }, /jpeg only works/) && throws({ 'frame-format': 'jpeg', alpha: true }, /alpha/), 'jpeg with png/prores/alpha formats -> error');
    ok(!throws({ 'frame-format': 'jpeg', format: 'gif' }, /./) && !throws({ 'frame-format': 'jpeg', format: 'webm' }, /./), 'jpeg is fine for mp4/webm/gif');
    ok(imageInputArgs(plan({ 'frame-format': 'jpeg' })).includes('mjpeg') && imageInputArgs(plan({})).includes('png'), 'ffmpeg input decoder follows the frame format');
    ok(resolveMode('FAST') === 'fast' && (() => { try { resolveMode('x'); return false; } catch (e) { return e.render === true; } })(), 'resolveMode');
    ok(chromeFlags('exact') === CHROME_FLAGS && chromeFlags('exact').includes('--use-angle=swiftshader'), 'exact flags unchanged (software)');
    const fw = chromeFlags('fast', 'win32'), fl = chromeFlags('fast', 'linux'), fm = chromeFlags('fast', 'darwin');
    ok(fw.includes('--use-angle=d3d11') && fl.includes('--use-angle=gl') && fm.includes('--use-angle=metal') && fw.includes('--enable-gpu-rasterization') && fw.includes('--ignore-gpu-blocklist') && !fw.includes('--use-angle=swiftshader'), 'fast flags per platform');
    ok(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device), SwiftShader driver)') && isSoftwareRenderer('llvmpipe') && isSoftwareRenderer(null) && !isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 2070 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)'), 'software renderer detection');
    // discovery order with fake paths
    const have = new Set(['/p/shell', '/s/chrome', '/s/edge', '/e/custom']);
    const exists = (x) => have.has(x);
    const cands = [{ kind: 'chrome', path: '/s/chrome' }, { kind: 'edge', path: '/s/edge' }];
    const pick = (o) => pickBrowser({ env: {}, pinned: '/p/shell', candidates: cands, exists, ...o });
    ok(pickBrowser({ env: { GFX_CHROME: '/e/custom' }, pinned: '/p/shell', candidates: cands, exists }).path === '/e/custom', 'discovery: GFX_CHROME first');
    ok(pick({}).path === '/p/shell' && pick({}).source === 'pinned' && pick({ mode: 'fast' }).path === '/p/shell', 'discovery: pinned shell before system Chrome');
    ok(pick({ pinned: '/p/missing' }).path === '/s/chrome' && pick({ pinned: null }).path === '/s/chrome', 'discovery: system Chrome when the shell is not installed');
    ok(pickBrowser({ env: {}, pinned: '/p/missing', candidates: [{ kind: 'chrome', path: '/x/none' }, cands[1]], exists }).kind === 'edge' && pickBrowser({ env: {}, candidates: [], exists }) === null, 'discovery: Edge, then nothing');
    ok(pick({ mode: 'fast', wsl: true }).path === '/s/chrome' && pick({ mode: 'exact', wsl: true }).path === '/p/shell' && pickBrowser({ env: {}, pinned: '/p/shell', candidates: [], mode: 'fast', wsl: true, exists }).path === '/p/shell', 'discovery: fast mode on WSL prefers system Chrome (shell last resort)');
    ok(resolveWorkers2(undefined, 1000, 'fast') >= 1 && resolveWorkers2(undefined, 1000, 'fast') <= 4 && resolveWorkers2('2', 1000, 'fast') === 2 && (process.env.GFX_WORKERS || resolveWorkers2(undefined, 1000, 'exact') === 1), 'workers default: auto in fast mode, 1 in exact');

    r = R('_render-test', '--mode', 'turbo', '--out', d('badmode.mp4'));
    ok(r.code !== 0 && /--mode/.test(r.err + r.out), 'CLI: bad --mode -> error', r.err);
    r = R('_render-test', '--frame-format', 'jpeg', '--format', 'prores', '--out', d('badjpg.mov'));
    ok(r.code !== 0 && /jpeg/.test(r.err + r.out), 'CLI: jpeg + prores -> error', r.err);
    r = R('_render-test', '--mode', 'fast', '--progress', 'json', '--out', d('fast.mp4'));
    {
      const L = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: l }; } });
      const rl = L.find((x) => x.type === 'log' && /^renderer: /.test(x.msg));
      ok(r.code === 0 && fs.existsSync(d('fast.mp4')) && !L.some((x) => x.bad), 'fast mode render succeeds', r.err);
      ok(rl && rl.level === 'info', 'fast mode emits a renderer log event (GPU or software fallback)', rl);
      if (rl && isSoftwareRenderer(rl.msg.slice(10))) ok(L.some((x) => x.level === 'warn' && /fast mode: no GPU available/.test(x.msg)), 'software fallback logs a warning');
      const pf = r.code === 0 ? probe(d('fast.mp4')) : {};
      ok(pf.width === 200 && pf.height === 100 && +pf.nb_read_frames === 10, 'fast render: size and frame count', pf);
    }
    r = R('_render-test', '--frame-format', 'jpeg', '--out', d('jpg.mp4'));
    {
      const pj = r.code === 0 ? probe(d('jpg.mp4')) : {};
      ok(r.code === 0 && pj.codec_name === 'h264' && pj.pix_fmt === 'yuv420p' && pj.width === 200 && +pj.nb_read_frames === 10, 'jpeg intermediates -> mp4 (h264 yuv420p, 10 frames)', r.err);
    }
    r = R('_render-test', '--frame-format', 'jpeg', '--crop-track', d('track.json'), '--out', d('jpgtrack.mp4'));
    ok(r.code === 0 && +probe(d('jpgtrack.mp4')).nb_read_frames === 10, 'jpeg + animated crop-track', r.err);
    r = R('_render-test', '--frame-format', 'jpeg', '--format', 'gif', '--out', d('jpg.gif'));
    ok(r.code === 0 && probe(d('jpg.gif')).codec_name === 'gif', 'jpeg intermediates -> gif', r.err);
    r = R('_render-test', '--render-preset', 'fastdraft', '--progress', 'json', '--out', d('rjfast.mp4'));
    {
      const L = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: l }; } });
      ok(r.code === 0 && L.some((x) => x.type === 'log' && /^renderer: /.test(x.msg)), 'render.json preset key mode:fast + frame-format applies', r.err);
    }
    r = R('_render-test', '--render-preset', 'fastdraft', '--mode', 'exact', '--progress', 'json', '--out', d('rjex.mp4'));
    ok(r.code === 0 && !r.out.includes('renderer: '), 'CLI --mode exact overrides the preset mode', r.err);
  }

  console.log('progress json');
  r = R('_render-test', '--progress', 'json', '--out', d('pj.mp4'));
  {
    const L = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: l }; } });
    const pr = L.filter((x) => x.type === 'progress');
    ok(r.code === 0 && !L.some((x) => x.bad), 'stdout is only JSON lines', L.find((x) => x.bad));
    for (const ph of ['frames', 'encode']) {
      const a = pr.filter((x) => x.phase === ph);
      ok(a.length >= 2 && a[0].done === 0 && a.at(-1).done === a.at(-1).total && a.at(-1).total === 10 && a.every((x, i) => i === 0 || x.done >= a[i - 1].done) && a.every((x) => x.eta === undefined || typeof x.eta === 'number'), `phase ${ph}: done/total monotonic, ends at 10/10`, a.slice(-2));
    }
    ok(pr.some((x) => x.phase === 'frames' && typeof x.eta === 'number'), 'frames progress has an eta');
    const done = L.at(-1);
    ok(done.type === 'done' && done.outputs.length === 1 && done.outputs[0] === d('pj.mp4') && typeof done.ms === 'number', 'final done event with outputs', done);
  }
  r = R('_render-test', '--progress', 'json', '--alpha', '--out', d('bad.mp4'));
  {
    const last = r.out.trim().split('\n').pop();
    ok(r.code !== 0 && JSON.parse(last).type === 'error' && /--alpha/.test(JSON.parse(last).msg), 'invalid combo -> error event + non-zero exit', last);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
