// Sound tweak parameters (docs/SOUND-TWEAK.md): attack / decay / bright / reverb / seed in the synth.
// Run: node tests/soundtweak.test.mjs   (needs /usr/bin/google-chrome or GFX_CHROME)
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { makeCue, resolveCues, TWEAK_KEYS } from '../runner/lib/sfx.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.GFX_CHROME || '/usr/bin/google-chrome';
let pass = 0, fail = 0, server = null, browser = null;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function testPure() {
  console.log('cue model');
  const c = makeCue(1, 'pop', { attack: 5, decay: 0.001, bright: -3, reverb: 0.5, seed: 2.4 });
  ok(c.attack === 2 && c.decay === 0.02 && c.bright === -1 && c.reverb === 0.5 && c.seed === 2, 'makeCue clamps the tweak fields', c);
  const z = makeCue(1, 'pop', { attack: 0, decay: 0, bright: 0, reverb: 0, seed: 0 });
  ok(TWEAK_KEYS.every((k) => !(k in z)), 'identity values are not stored');
  const r = resolveCues([makeCue(1, 'pop', { id: 'a' })], { cues: { a: { bright: 0.5, seed: 3 } } });
  ok(r.cues[0].bright === 0.5 && r.cues[0].seed === 3, 'resolveCues applies tweak overrides');
}

async function main() {
  testPure();
  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'runner/cli.js'), 'serve', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', (d) => { buf += d; if (/gfx serve: http/.test(buf)) res(); });
    server.on('exit', () => rej(new Error('serve exited early')));
    setTimeout(() => rej(new Error('serve timeout')), 30000);
  });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/runner/lib/library/blank.html`).catch(() => page.goto(`http://127.0.0.1:${port}/`));
  // stats of one cue rendered alone: energy per window, high-frequency share, md5-like checksum
  const render = (cue) => page.evaluate(async (cue) => {
    const { resolveCues, renderStems } = await import('/runner/lib/sfx.js');
    const { cues } = resolveCues([], { add: [{ id: 'x', stem: 's', ...cue }] });
    const r = await renderStems(cues, { duration: 3, stems: {}, loader: null });
    const L = r.s[0], sr = 48000;
    const win = (a, b) => { let e = 0; for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) e += L[i] * L[i]; return e; };
    let hf = 0, all = 0;
    for (let i = 1; i < L.length; i++) { const d = L[i] - L[i - 1]; hf += d * d; all += L[i] * L[i]; }
    let h = 0; for (let i = 0; i < L.length; i += 7) h = (h * 31 + Math.round(L[i] * 1e7)) | 0;
    return { start: win(1.0, 1.006), pre: win(0.6, 1.0), early: win(1.0, 1.05), mid: win(1.0, 1.3), late: win(1.3, 2.9), all, hfShare: hf / (all || 1), h };
  }, cue);

  console.log('synth');
  const base = { t: 1, sound: 'pop', gain: 0 };
  const b0 = await render(base), b1 = await render(base);
  ok(b0.h === b1.h && b0.all > 0, 'deterministic: same cue, same samples');
  ok((await render({ ...base, attack: 0, bright: 0, reverb: 0 })).h === b0.h, 'identity values = the original sound');
  const at = await render({ ...base, attack: 0.2 });
  ok(at.early < b0.early * 0.2, 'attack 0.2 s softens the onset', [at.early, b0.early]);
  const ch = { t: 1, sound: 'chime', gain: 0 }, c0 = await render(ch);
  const dc = await render({ ...ch, decay: 0.08 });
  ok(dc.late < c0.late * 0.05 && dc.start > c0.start * 0.25, 'decay 0.08 s cuts the tail, keeps the start', [dc.late, c0.late, dc.start, c0.start]);
  const hi = await render({ ...base, bright: 1 }), lo = await render({ ...base, bright: -1 });
  ok(hi.hfShare > b0.hfShare * 1.2 && lo.hfShare < b0.hfShare * 0.8, 'brightness tilts the spectrum', [lo.hfShare, b0.hfShare, hi.hfShare]);
  const rv = await render({ ...base, reverb: 1 });
  ok(rv.late > b0.late * 2, 'reverb adds a tail', [rv.late, b0.late]);
  const im = { t: 1, sound: 'impact', gain: 0 };
  const i0 = await render(im), i1 = await render({ ...im, seed: 1 }), i1b = await render({ ...im, seed: 1 }), i2 = await render({ ...im, seed: 2 });
  ok(i0.h !== i1.h && i1.h !== i2.h && i1.h === i1b.h, 'seed: another repeatable take of the sound');
  // a draft / sound.json override of 0 clears a base (scene) value: resolveCues copies it, the synth reads 0 as off
  const cleared = await page.evaluate(async () => {
    const { makeCue, resolveCues, renderStems } = await import('/runner/lib/sfx.js');
    const scene = [makeCue(1, 'pop', { id: 'p', stem: 's', attack: 0.2, bright: 0.6, reverb: 0.5, decay: 0.1 })];
    const r = resolveCues(scene, { cues: { p: { attack: 0, bright: 0, reverb: 0, decay: 0 } } });
    const plain = resolveCues([makeCue(1, 'pop', { id: 'p', stem: 's' })], {});
    const sum = async (cues) => { const o = await renderStems(cues, { duration: 3, stems: {}, loader: null }); let h = 0; const L = o.s[0]; for (let i = 0; i < L.length; i += 7) h = (h * 31 + Math.round(L[i] * 1e7)) | 0; return h; };
    return { a: await sum(r.cues), b: await sum(plain.cues), c: await sum(scene) };
  });
  ok(cleared.a === cleared.b && cleared.a !== cleared.c, 'neutral overrides (0) clear base attack / bright / reverb / decay', cleared);
  const wh = { t: 1.5, sound: 'whoosh', gain: 0, dur: 1.4 };
  const w0 = await render(wh), wa = await render({ ...wh, attack: 0.3 });
  ok(w0.pre > 0 && wa.pre < w0.pre * 0.5, 'attack on a pre-roll sound starts at its real onset (before the cue time)', [wa.pre, w0.pre]);
}

main().catch((e) => { fail++; console.error(e); }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
