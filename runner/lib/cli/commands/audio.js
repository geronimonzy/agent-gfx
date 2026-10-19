// gfx audio — stems, mix, sync sheet, mux (docs/CONTRACT.md "Audio").
import fs from 'node:fs';
import path from 'node:path';
import { resolveCues, SAMPLE_RATE } from '../../sfx.js';
import { runFfmpeg } from '../../ffmpeg.js';
import { openCapture, shot, seek, pullStem } from '../capture.js';
import { loadMeta, outDir, readJson, sceneDir } from '../util.js';
import { progress } from '../progress.js';

function writeWav(file, chans, bits) {
  const n = chans[0].length, nch = chans.length, bps = bits / 8, float = bits === 32;
  const data = n * nch * bps;
  const buf = Buffer.alloc(44 + data);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + data, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(float ? 3 : 1, 20); buf.writeUInt16LE(nch, 22);
  buf.writeUInt32LE(SAMPLE_RATE, 24); buf.writeUInt32LE(SAMPLE_RATE * nch * bps, 28);
  buf.writeUInt16LE(nch * bps, 32); buf.writeUInt16LE(bits, 34); buf.write('data', 36); buf.writeUInt32LE(data, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < nch; c++) {
      const x = chans[c][i];
      if (float) { buf.writeFloatLE(x, o); o += 4; }
      else { buf.writeIntLE(Math.round(Math.max(-1, Math.min(1, x)) * 8388607), o, 3); o += 3; }
    }
  }
  fs.writeFileSync(file, buf);
}

const dbfs = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Two-pass loudnorm to the target LUFS and -1 dBTP; output 24-bit 48 kHz, exactly N samples. */
async function normalizeMix(rawWav, outWav, lufs, N) {
  const log = await runFfmpeg(['-i', rawWav, '-af', `loudnorm=I=${lufs}:TP=-1:LRA=11:print_format=json`, '-f', 'null', '-']);
  const m = JSON.parse(log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1));
  const af = `loudnorm=I=${lufs}:TP=-1:LRA=11:measured_I=${m.input_i}:measured_LRA=${m.input_lra}:measured_TP=${m.input_tp}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=${SAMPLE_RATE},apad=whole_len=${N},atrim=end_sample=${N}`;
  await runFfmpeg(['-y', '-i', rawWav, '-af', af, '-ar', String(SAMPLE_RATE), '-c:a', 'pcm_s24le', outWav]);
  return m;
}

export async function cmdAudio(name, o) {
  loadMeta(name);
  const dir = path.join(outDir(name), 'audio');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'stems'), { recursive: true });
  progress('audio', 0, 4);
  const { meta, page, browser } = await openCapture(name);
  const sceneCues = await page.evaluate(() => window.__gfx.cues);
  const fixPath = path.join(sceneDir(name), 'sound.json');
  const res = resolveCues(sceneCues, fs.existsSync(fixPath) ? readJson(fixPath) : {});
  for (const w of res.warnings) console.error('gfx: warning: ' + w);
  const duration = meta.duration;
  const N = Math.round(duration * SAMPLE_RATE);
  fs.writeFileSync(path.join(dir, 'cues.json'), JSON.stringify({ scene: name, duration, sampleRate: SAMPLE_RATE, master: res.master, stems: res.stems, cues: res.cues }, null, 2) + '\n');
  if (!res.cues.length) { console.log(`no cues in ${name}; wrote ${path.join(dir, 'cues.json')} only`); return [path.join(dir, 'cues.json')]; }

  // Synthesize every stem in the page (OfflineAudioContext), then pull PCM back as chunked base64 Float32.
  const names = await page.evaluate(async (cues, opts) => {
    const sfx = await import('/runner/lib/sfx.js');
    window.__stems = await sfx.renderStems(cues, opts);
    return Object.keys(window.__stems);
  }, res.cues, { duration, stems: res.stems });
  progress('audio', 1, 4);
  const stems = {};
  for (const s of names) stems[s] = [await pullStem(page, s, 0, N), await pullStem(page, s, 1, N)];

  const sum = [new Float32Array(N), new Float32Array(N)];
  const peaks = {};
  for (const s of names) {
    writeWav(path.join(dir, 'stems', `${s}.wav`), stems[s], 24);
    let pk = 0;
    for (let c = 0; c < 2; c++) for (let i = 0; i < N; i++) { const a = Math.abs(stems[s][c][i]); if (a > pk) pk = a; sum[c][i] += stems[s][c][i]; }
    peaks[s] = pk;
    console.log(`stem ${s.padEnd(8)} peak ${dbfs(pk).toFixed(1)} dBFS${res.stems[s].mute ? ' (muted)' : ''}`);
  }
  const raw = path.join(dir, '.mix-raw.wav');
  const mix = path.join(dir, 'mix.wav');
  if (Math.max(...Object.values(peaks)) > 0) {
    writeWav(raw, sum, 32);
    const m = await normalizeMix(raw, mix, res.master.lufs, N);
    fs.rmSync(raw, { force: true });
    console.log(`mix: ${mix} (${m.input_i} LUFS in -> ${res.master.lufs} LUFS target, -1 dBTP)`);
  } else {
    writeWav(mix, sum, 24);
    console.log(`mix: ${mix} (all stems silent)`);
  }

  progress('audio', 2, 4);
  // Sync sheet: thumbnail strip + waveform lane per stem + cue markers + ruler, drawn on a canvas.
  const W = 1920, LEFT = 130, plotW = W - LEFT - 30;
  const aspect = meta.width / meta.height;
  const nThumb = Math.max(4, Math.round(plotW / (150 * aspect)));
  const thumbs = [];
  for (let i = 0; i < nThumb; i++) {
    await seek(page, (duration * i) / nThumb);
    thumbs.push('data:image/png;base64,' + Buffer.from(await shot(page, meta)).toString('base64'));
  }
  const lanes = names.map((s) => {
    const min = new Array(plotW), max = new Array(plotW);
    for (let x = 0; x < plotW; x++) {
      const a = Math.floor((x * N) / plotW), b = Math.max(a + 1, Math.floor(((x + 1) * N) / plotW));
      let lo = 0, hi = 0;
      for (let i = a; i < b; i++) for (let c = 0; c < 2; c++) { const v = stems[s][c][i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      min[x] = lo; max[x] = hi;
    }
    return { name: s, peak: dbfs(peaks[s]), gain: res.stems[s].gain, mute: res.stems[s].mute, min, max, norm: peaks[s] || 1 };
  });
  const sheet = await browser.newPage();
  await sheet.setViewport({ width: W, height: 800 });
  await sheet.setContent('<body style="margin:0;background:#0d0d10"><canvas id="c"></canvas></body>');
  await sheet.evaluate(drawSync, { W, LEFT, plotW, aspect, thumbs, lanes, cues: res.cues, duration, title: `${name}   ${duration}s @${meta.fps}fps   ${res.cues.length} cues` });
  const syncPath = path.join(dir, 'sync.png');
  fs.writeFileSync(syncPath, await (await sheet.$('#c')).screenshot({ type: 'png' }));
  console.log(syncPath);
  progress('audio', 3, 4);
  const outputs = [mix, ...names.map((s) => path.join(dir, 'stems', `${s}.wav`)), path.join(dir, 'cues.json'), syncPath];

  const video = path.resolve(o.video || path.join(outDir(name), `${name}.mp4`));
  if (fs.existsSync(video)) {
    // next to the video it muxes: out/<name>/<name>.mp4 -> <name>.sound.mp4, a 4K render -> <its name>.sound.mp4
    // (`muxOut`: render --audio on an export writes the single final file there instead)
    const outv = o.muxOut ? path.resolve(o.muxOut) : video.replace(/(\.[^./\\]+)?$/, '.sound.mp4');
    await runFfmpeg(['-y', '-i', video, '-i', mix, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outv]);
    console.log(outv);
    outputs.push(outv);
  } else console.log(`(no video at ${video}; skipped mux)`);
  progress('audio', 4, 4);
  return outputs;
}

// Runs inside the browser page (serialized by puppeteer: must be self-contained).
async function drawSync({ W, LEFT, plotW, aspect, thumbs, lanes, cues, duration, title }) {
  const COLORS = ['#ff7a59', '#4cc9f0', '#b8f35a', '#f7c948', '#c792ea', '#5eead4'];
  const colOf = (s) => COLORS[lanes.findIndex((l) => l.name === s) % COLORS.length];
  const cell = plotW / thumbs.length, th = Math.round(cell / aspect);
  const TOP = 36, RULER = 34, GAP = 8, ROW = 15;
  const X = (t) => Math.round(LEFT + (t / duration) * plotW);
  // lay out cue labels per lane first (rows never overlap), so lane height can grow to fit
  const mg = document.createElement('canvas').getContext('2d');
  mg.font = '12px ui-monospace, monospace';
  const layouts = lanes.map((ln) => {
    const rowEnd = [], items = [];
    for (const c of cues.filter((q) => q.stem === ln.name)) {
      const x = X(c.t), text = `${c.id} ${c.t.toFixed(2)}${c.mute ? ' (muted)' : ''}`;
      const w = mg.measureText(text).width + 8, flip = x + 3 + w > W - 4, x0 = flip ? x - 3 - w : x + 3;
      let r = 0;
      while (rowEnd[r] !== undefined && rowEnd[r] > x0 - 2) r++;
      rowEnd[r] = x0 + w;
      items.push({ c, x, x0, w, text, r });
    }
    return { items, h: Math.max(130, 16 + rowEnd.length * ROW + 10) };
  });
  const laneY = [];
  let acc = TOP + th + RULER;
  layouts.forEach((l) => { laneY.push(acc); acc += l.h + GAP; });
  const H = acc + 4;
  const cv = document.getElementById('c');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#0d0d10'; g.fillRect(0, 0, W, H);
  g.font = '600 15px ui-monospace, monospace'; g.fillStyle = '#ededed';
  g.fillText(title, LEFT, 24);
  const imgs = thumbs.map((src) => { const im = new Image(); im.src = src; return im; });
  await Promise.all(imgs.map((im) => im.decode()));
  imgs.forEach((im, i) => {
    const x = X((duration * i) / thumbs.length);
    g.drawImage(im, x, TOP, Math.ceil(cell), th);
    g.strokeStyle = '#0d0d10'; g.lineWidth = 1; g.strokeRect(x + 0.5, TOP + 0.5, Math.ceil(cell) - 1, th - 1);
  });
  const ry = TOP + th;
  g.fillStyle = '#16161b'; g.fillRect(LEFT, ry, plotW, RULER);
  g.font = '12px ui-monospace, monospace';
  const step = duration <= 6 ? 0.25 : duration <= 20 ? 1 : 5;
  const lab = duration <= 6 ? 0.5 : duration <= 20 ? 1 : 5;
  for (let t = 0; t <= duration + 1e-9; t += step) {
    const x = X(t), major = Math.abs(t / lab - Math.round(t / lab)) < 1e-6;
    g.fillStyle = major ? '#9aa0a6' : '#555a60';
    g.fillRect(x, ry, 1, major ? 12 : 6);
    if (major) {
      g.fillStyle = '#d0d3d6';
      g.textAlign = x > W - 40 ? 'right' : x < LEFT + 12 ? 'left' : 'center';
      g.fillText(t.toFixed(t % 1 ? 1 : 0) + 's', x, ry + 28);
    }
  }
  g.textAlign = 'left';
  for (const c of cues) { g.fillStyle = colOf(c.stem) + (c.mute ? '44' : 'aa'); g.fillRect(X(c.t), TOP, 1, th + 14); }
  lanes.forEach((ln, i) => {
    const LANE = layouts[i].h, y0 = laneY[i], mid = y0 + LANE / 2, col = colOf(ln.name);
    g.fillStyle = '#14141a'; g.fillRect(LEFT, y0, plotW, LANE);
    g.fillStyle = col; g.font = '600 14px ui-monospace, monospace'; g.fillText(ln.name, 12, y0 + 22);
    g.font = '12px ui-monospace, monospace'; g.fillStyle = '#9aa0a6';
    g.fillText(ln.mute ? 'muted' : `pk ${ln.peak.toFixed(1)} dB`, 12, y0 + 40);
    if (ln.gain) g.fillText(`gain ${ln.gain > 0 ? '+' : ''}${ln.gain} dB`, 12, y0 + 56);
    g.fillStyle = ln.mute ? '#444' : col + 'cc';
    const amp = (LANE / 2 - 22) / ln.norm;
    for (let x = 0; x < plotW; x++) {
      const hi = Math.max(ln.max[x] * amp, 0.5), lo = Math.min(ln.min[x] * amp, -0.5);
      g.fillRect(LEFT + x, mid - hi, 1, hi - lo);
    }
    for (const { c, x, x0, w, text, r } of layouts[i].items) {
      const ly = y0 + 14 + r * ROW;
      g.fillStyle = c.mute ? '#6b6b73' : col;
      g.fillRect(x, y0, 2, LANE);
      g.fillStyle = 'rgba(13,13,16,0.85)'; g.fillRect(x0 - 1, ly - 11, w, 14);
      g.fillStyle = c.mute ? '#8a8a92' : '#f2f2f2';
      g.fillText(text, x0 + 2, ly);
    }
  });
}

