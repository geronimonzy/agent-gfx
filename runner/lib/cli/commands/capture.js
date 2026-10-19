// gfx still | sheet | render — headless frame capture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnFfmpeg } from '../../ffmpeg.js';
import { planRender, listPresets, trackRect, imageInputArgs, encodeArgs } from '../../render-plan.js';
import { openCapture, shot, shotScaled, seek, JPEG_QUALITY } from '../capture.js';
import { resolveMode } from '../../browser.js';
import { cleanups, die, fmtT, loadMeta, num, outDir, runCleanups, sceneDir } from '../util.js';
import { progress, isJson } from '../progress.js';
import { cmdAudio } from './audio.js';

function modeOrDie(o) { try { return resolveMode(o.mode); } catch (e) { if (e.render) die(e.message); throw e; } }

export async function cmdStill(name, o) {
  if (o.t === undefined) die('--t <sec> required');
  const t = Number(o.t);
  progress('frames', 0, 1);
  const { meta, page } = await openCapture(name, { scale: num(o.scale, 1), mode: modeOrDie(o) });
  await seek(page, t);
  const out = path.resolve(o.out || path.join(outDir(name), `still-${fmtT(t)}.png`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await shot(page, meta));
  progress('frames', 1, 1);
  console.log(out);
  return [out];
}

export async function cmdSheet(name, o) {
  const n = num(o.n, 12);
  const cols = Math.min(num(o.cols, 4), n);
  const { meta, page, browser } = await openCapture(name, { mode: modeOrDie(o) });
  const frames = [];
  progress('frames', 0, n);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (meta.duration * i) / (n - 1);
    await seek(page, t);
    frames.push({ t, b64: Buffer.from(await shot(page, meta)).toString('base64') });
    progress('frames', i + 1, n);
  }
  const tw = Math.min(480, Math.floor(1920 / cols));
  const th = Math.round((tw * meta.height) / meta.width);
  const gap = 12;
  const rows = Math.ceil(n / cols);
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: cols * tw + (cols + 1) * gap, height: rows * (th + 30) + (rows + 1) * gap });
  const html = `<body style="margin:0;background:#0b0b0b;color:#ededed;font:14px ui-monospace,monospace">
    <div style="display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:${gap}px;padding:${gap}px">
    ${frames.map((f) => `<figure style="margin:0"><img width="${tw}" height="${th}" style="display:block;border:1px solid #333" src="data:image/png;base64,${f.b64}"><figcaption style="padding-top:6px">t = ${f.t.toFixed(2)}s</figcaption></figure>`).join('')}
    </div></body>`;
  await sheet.setContent(html);
  await sheet.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
  const out = path.resolve(o.out || path.join(outDir(name), 'sheet.png'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, await sheet.screenshot({ type: 'png', fullPage: true }));
  console.log(out);
  return [out];
}

/** gfx render --list-presets [<scene>] [--json]: built-in size presets + scenes/<scene>/render.json presets. */
function listRenderPresets(name, o) {
  let res;
  try { res = listPresets(name ? sceneDir(name) : null); } catch (e) { die(e.message); }
  if (o.json) console.log(JSON.stringify(res, null, 2));
  else {
    for (const p of res.builtin) console.log(`${p.id.padEnd(10)} ${p.width}x${p.height}  ${p.label}`);
    for (const p of res.scene) console.log(`${p.id.padEnd(10)} (scene) ${p.label}  ${JSON.stringify(p.options)}`);
  }
  return [];
}

const pngSize = (b) => (b.length > 24 && b.readUInt32BE(12) === 0x49484452 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

// FOUNDATION.md §4. Capture strategy (fast path first):
//  - full scene / static crop / fit: ONE screenshot per frame with deviceScaleFactor = dest/source, clip = source window
//    -> Chrome rasterises the window at the output resolution (sharp vector/DOM text), no resampling.
//  - animated crop (--crop-track): per-frame clip with clip.scale (DSF stays 1, so no viewport change per frame).
//  - letterbox (--fit contain) / rounding fix-ups / pixel format / codec: a single ffmpeg filter chain in the same
//    encode pass; frames are never decoded and re-encoded twice. PNG sequences are written straight from the
//    screenshots unless a letterbox is needed.
/** --workers N|auto (env GFX_WORKERS, default 1 = bit-exact in exact mode, auto in fast mode; N > 1 can be ±1 LSB off, FOUNDATION.md §4a/§4b): auto = min(4, floor(cpus/2), free mem / 600 MB, ceil(frames/8)), >= 1 (benchmark: no gain past 2-4, FOUNDATION.md §4a). */
export function resolveWorkers(spec, total, mode = 'exact') {
  const s = String(spec ?? process.env.GFX_WORKERS ?? (mode === 'fast' ? 'auto' : '1')).trim();
  if (s !== 'auto') {
    if (!/^[0-9]+$/.test(s) || Number(s) < 1) throw Object.assign(new Error(`--workers: expected a positive integer or "auto", got "${s}"`), { render: true });
    return Math.min(Number(s), 64);
  }
  const byCpu = Math.floor(os.cpus().length / 2);
  const byMem = Math.floor(os.freemem() / (600 * 1024 * 1024));
  return Math.max(1, Math.min(4, byCpu, byMem, Math.ceil(total / 8)));
}

export async function cmdRender(name, o) {
  if (o['list-presets']) return listRenderPresets(name, o);
  const meta0 = loadMeta(name);
  let plan;
  try { plan = planRender(o, meta0, { sceneDir: sceneDir(name) }); } catch (e) { if (e.render) die(e.message); throw e; }
  o = plan.options;
  const { format, fps, from, to, total } = plan;
  let nWorkers;
  try { nWorkers = Math.min(resolveWorkers(o.workers, total, plan.mode), Math.max(1, total)); } catch (e) { if (e.render) die(e.message); throw e; }
  const { meta, page, openWorker } = await openCapture(name, { scale: plan.dsf, size: plan.scene.w !== meta0.width || plan.scene.h !== meta0.height ? plan.scene : null, alpha: plan.alpha, mode: plan.mode });
  const jpeg = plan.frameFormat === 'jpeg';
  const ow = plan.out.w, oh = plan.out.h;
  fs.mkdirSync(outDir(name), { recursive: true });
  const ranged = o.from !== undefined || o.to !== undefined || o.dur !== undefined;
  const suffix = ranged ? `-${fmtT(from)}-${fmtT(to)}` : '';
  const final = path.resolve(o.out || (format === 'png' ? path.join(outDir(name), 'frames' + suffix) : path.join(outDir(name), `${name}${suffix}.${plan.ext}`)));
  // --audio on an export = ONE file with sound at the requested name: capture into a hidden silent file, mux into the
  // final name, delete the silent one. The review video (out/<scene>/<scene>.mp4) keeps both: the studio's review
  // player plays it silent and mixes the stems live. --keep-silent keeps both for any render.
  const single = !!o.audio && format === 'mp4' && !o['keep-silent'] && final !== path.resolve(outDir(name), `${name}.mp4`);
  const out = single ? path.join(path.dirname(final), `.${path.basename(final, '.mp4')}.silent.mp4`) : final;
  let muxing = false; // the cleanups run (closing the browser) right before the mux, which still needs the silent file
  if (single) cleanups.push(() => { if (!muxing) fs.rmSync(out, { force: true }); });
  const t0 = Date.now();
  const useFf = format !== 'png' || plan.letterbox || !plan.pixelExact;
  let ff = null, ffDone = null, ffErr = '';
  if (format === 'png') {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
  } else fs.mkdirSync(path.dirname(out), { recursive: true });
  if (useFf) {
    const args = ['-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...imageInputArgs(plan),
      ...encodeArgs(plan, format === 'png' ? path.join(out, 'frame-%05d.png') : out)];
    try { ff = spawnFfmpeg(args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { die(e.message); }
    cleanups.push(() => { try { ff.kill('SIGKILL'); } catch {} });
    ff.stderr.on('data', (d) => { ffErr += d; });
    let buf = '';
    ff.stdout.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) { const m = /^frame=(\d+)/.exec(l); if (m) progress('encode', Math.min(+m[1], total), total); }
    });
    ffDone = new Promise((res) => { ff.on('close', res); ff.on('error', (e) => { ffErr += e.message; res(-1); }); });
    ff.stdin.on('error', () => {});
  }
  const human = !isJson();
  const staticClip = plan.exact ? undefined : { x: plan.rect.x, y: plan.rect.y, width: plan.rect.w, height: plan.rect.h };
  progress('frames', 0, total);
  if (useFf) progress('encode', 0, total);
  const grab = async (pg, i) => {
    const t = from + i / fps;
    await seek(pg, t);
    let clip = staticClip;
    if (plan.track) {
      const r = trackRect(plan.track, t, plan.aspect, plan.scene);
      clip = { x: r.x, y: r.y, width: r.w, height: r.h, scale: plan.dest.w / r.w };
    }
    return plan.track
      ? shotScaled(pg, clip, { alpha: plan.alpha, jpeg })
      : shot(pg, { width: plan.scene.w, height: plan.scene.h }, { ...(jpeg ? { type: 'jpeg', quality: JPEG_QUALITY } : {}), ...(clip ? { clip } : {}), ...(plan.alpha ? { omitBackground: true } : {}) });
  };
  // Frames come from a shared counter (each worker's t only moves forward); a reorder buffer writes strictly in
  // index order; a worker waits when it is >= window frames ahead of the writer. First error aborts everything.
  const pages = [page];
  if (nWorkers > 1) pages.push(...(await Promise.all(Array.from({ length: nWorkers - 1 }, () => openWorker()))).map((w) => w.page));
  const window = Math.max(2, nWorkers * 2);
  const pending = new Map();
  let next = 0, written = 0, failure = null, flushing = false, waiters = [];
  const wake = () => { const w = waiters; waiters = []; for (const f of w) f(); };
  // The first failure rejects `failed` at once, so a sibling stalled in seek/screenshot can't hold the error back;
  // the caller's cleanups then close every browser (interrupting it) and ffmpeg.
  let abort;
  const failed = new Promise((_, rej) => { abort = rej; });
  failed.catch(() => {});
  const fail = (e) => { if (!failure) { failure = e; abort(e); } wake(); };
  const writeOne = async (i, buf) => {
    if (i === 0) {
      const sz = pngSize(buf);
      if (sz && (sz.w !== plan.dest.w || sz.h !== plan.dest.h) && !useFf) console.warn(`warn: captured ${sz.w}x${sz.h}, expected ${plan.dest.w}x${plan.dest.h}`);
    }
    if (ff) { if (!ff.stdin.write(buf)) await Promise.race([new Promise((r) => ff.stdin.once('drain', r)), ffDone]); if (ff.exitCode !== null) throw new Error(`ffmpeg exited early (${ff.exitCode}):\n${ffErr.slice(-2000)}`); }
    else fs.writeFileSync(path.join(out, `frame-${String(i).padStart(5, '0')}.png`), buf);
    progress('frames', i + 1, total);
    const tty = process.stderr.isTTY;
    if (human && (tty ? i % 5 === 0 || i === total - 1 : (i + 1) % 60 === 0)) {
      const el = (Date.now() - t0) / 1000;
      process.stderr.write(`${tty ? '\r' : ''}frame ${i + 1}/${total}  ${((i + 1) / el).toFixed(1)} fps${nWorkers > 1 ? ` (${nWorkers} workers)` : ''}${tty ? '  ' : '\n'}`);
    }
  };
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    try {
      while (!failure && pending.has(written)) {
        const buf = pending.get(written);
        pending.delete(written);
        await writeOne(written, buf);
        written++;
        wake();
      }
    } catch (e) { fail(e); } finally { flushing = false; }
    if (!failure && pending.has(written)) return flush();
  };
  const runWorker = async (pg) => {
    try {
      while (!failure) {
        const i = next++;
        if (i >= total) return;
        while (!failure && i - written >= window) await new Promise((r) => waiters.push(r));
        if (failure) return;
        pending.set(i, await grab(pg, i));
        await flush();
      }
    } catch (e) { fail(e); }
  };
  await Promise.race([Promise.all(pages.map(runWorker)), failed]);
  if (failure) throw failure;
  if (human && process.stderr.isTTY) process.stderr.write('\n');
  if (ff) {
    ff.stdin.end();
    const code = await ffDone;
    if (code !== 0) die(`ffmpeg failed (${code}): ${ffErr}`);
  }
  progress('encode', total, total);
  console.log(`${single ? final : out}\n${total} frames @${fps}fps ${ow}x${oh}, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!o.audio) return [out];
  muxing = single;
  await runCleanups(); // close the capture browser/vite before the audio session starts its own
  if (!single) return [out, ...((await cmdAudio(name, { video: out })) || [])];
  const res = (await cmdAudio(name, { video: out, muxOut: final })) || [];
  const extra = res.filter((p) => p !== final);
  if (!res.includes(final)) fs.renameSync(out, final); // nothing muxed (scene without cues): the silent file is the result
  fs.rmSync(out, { force: true });
  return [final, ...extra];
}
