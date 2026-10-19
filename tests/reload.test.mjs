// Live code reload test (docs/FOUNDATION.md §5): bridge rebuilds in place when scene files change under `gfx serve`.
// Run: node tests/reload.test.mjs   (needs /usr/bin/google-chrome or GFX_CHROME)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENE = '_reload-test';
const SC = path.join(ROOT, 'scenes', SCENE);
const CHROME = process.env.GFX_CHROME || '/usr/bin/google-chrome';
const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage'];
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const markup = (color) => `export const COLOR = '${color}';\n`;
const sceneJs = (extra = '') => `import { COLOR } from './markup.js';
let el;
export default {
  setup(ctx) {
    ctx.root.insertAdjacentHTML('beforeend', '<div data-gfx="box" style="position:absolute;left:50px;top:50px;width:100px;height:100px;background:' + COLOR + '"></div>${extra}');
    el = ctx.root.querySelector('[data-gfx="box"]');
  },
  render(t) { el.style.transform = 'translateX(' + (t * 100) + 'px)'; },
};
`;
const write = (f, s) => fs.writeFileSync(path.join(SC, f), s);

let server, browser;
async function main() {
  fs.rmSync(SC, { recursive: true, force: true });
  fs.mkdirSync(SC, { recursive: true });
  write('scene.json', JSON.stringify({ kind: 'anime', width: 800, height: 600, fps: 30, duration: 2, style: 'dark-grid' }));
  write('markup.js', markup('#ff0000'));
  write('scene.js', sceneJs());

  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'runner/cli.js'), 'serve', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', (d) => { buf += d; if (/gfx serve: http/.test(buf)) res(); });
    server.on('exit', () => rej(new Error('serve exited early')));
  });
  const base = `http://127.0.0.1:${port}`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: FLAGS, defaultViewport: null });

  const host = await browser.newPage();
  await host.setContent('<body style="margin:0"><iframe id="f" width="800" height="600" style="border:0"></iframe></body>');
  let navs = 0;
  host.on('framenavigated', (f) => { if (f !== host.mainFrame()) navs++; });
  await host.evaluate((src) => new Promise((res) => {
    window.__msgs = [];
    addEventListener('message', (e) => window.__msgs.push(e.data));
    const f = document.getElementById('f');
    f.onload = () => res();
    f.src = src;
  }), `${base}/runner/player/bridge.html?scene=${SCENE}`);
  await host.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), { timeout: 20000 });
  const rpc = (msg) => host.evaluate((m) => new Promise((res) => {
    const id = 'r' + Math.random();
    const h = (e) => { if (e.data && e.data.id === id) { removeEventListener('message', h); res(e.data); } };
    addEventListener('message', h);
    document.getElementById('f').contentWindow.postMessage({ id, ...m }, '*');
  }), msg);
  const frame = () => host.frames().find((f) => f !== host.mainFrame());
  const color = () => frame().evaluate(() => getComputedStyle(document.querySelector('[data-gfx="box"]')).backgroundColor);
  const nMsgs = () => host.evaluate(() => window.__msgs.length);
  const waitMsg = async (type, from, ms = 2000) => {
    const t0 = Date.now();
    for (;;) {
      const m = await host.evaluate((i, ty) => window.__msgs.slice(i).find((x) => x.type === ty) || null, from, type);
      if (m) return { m, ms: Date.now() - t0 };
      if (Date.now() - t0 > ms) return null;
      await sleep(25);
    }
  };

  console.log('reload');
  await frame().evaluate(() => { window.__nomarker = 1; });
  await rpc({ type: 'seek', t: 0.5 });
  await rpc({ type: 'tweaks', tweaks: { box: { x: 40 } } });
  let r = await rpc({ type: 'bounds', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.x - 140) < 0.5, 'baseline: box at 50 + 50 (t) + 40 (live tweak)', r.result);
  ok((await color()) === 'rgb(255, 0, 0)', 'baseline color red');

  // 1. edit an imported helper (cache-busting of local imports)
  let n = await nMsgs();
  write('markup.js', markup('#00ff00'));
  let got = await waitMsg('reloaded', n);
  ok(!!got, 'markup.js edit -> reloaded within 2 s', got && got.ms);
  ok(got && got.m.reason === 'markup.js' && got.m.files.some((f) => f.endsWith('markup.js')) && !got.m.meta, 'reloaded { reason, files } shape', got && got.m);
  ok((await color()) === 'rgb(0, 255, 0)', 'imported helper change visible');
  r = await rpc({ type: 'bounds', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.x - 140) < 0.5, 'same t and live tweaks re-applied', r.result);
  ok((await frame().evaluate(() => document.querySelectorAll('#gfx-root').length)) === 1, 'old root removed');

  // 2. edit scene.js: add a named element
  n = await nMsgs();
  write('scene.js', sceneJs('<div data-gfx="extra" style="position:absolute;left:300px;top:300px;width:50px;height:50px;background:#fff"></div>'));
  got = await waitMsg('reloaded', n);
  ok(!!got, 'scene.js edit -> reloaded within 2 s', got && got.ms);
  r = await rpc({ type: 'elements' });
  ok(r.ok && r.result.some((e) => e.key === 'extra') && r.result.some((e) => e.key === 'box'), 'new named element present', r.ok && r.result.map((e) => e.key));
  r = await rpc({ type: 'pick', x: 320, y: 320 });
  ok(r.ok && r.result.stack[0].key === 'extra', 'pick hits the new element');
  r = await rpc({ type: 'values', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.cx - (50 + 50 + 40 + 50)) < 1, 'values at preserved t with live tweak', r.result);

  // 3. syntax error: error posted, old frame kept
  n = await nMsgs();
  write('scene.js', sceneJs() + '\nexport const = ;\n');
  got = await waitMsg('error', n);
  ok(!!got && typeof got.m.message === 'string' && got.m.message.length > 0 && 'stack' in got.m, 'syntax error -> error { message, stack }', got && got.m);
  r = await rpc({ type: 'elements' });
  ok(r.ok && r.result.some((e) => e.key === 'extra'), 'previous scene still displayed after error');
  ok((await frame().evaluate(() => !document.querySelector('vite-error-overlay'))), 'no Vite error overlay');
  r = await rpc({ type: 'seek', t: 1 });
  ok(r.ok, 'bridge still responsive after error');

  // 4. fix -> reloaded
  n = await nMsgs();
  write('scene.js', sceneJs());
  got = await waitMsg('reloaded', n);
  ok(!!got, 'fix -> reloaded', got && got.ms);
  r = await rpc({ type: 'bounds', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.x - (50 + 100 + 40)) < 0.5, 't=1 preserved after fix', r.result);

  // A replacement can build at zero but fail at the preserved playhead.
  await rpc({ type: 'seek', t: 1.5 });
  await rpc({ type: 'view', hidden: ['box'], solo: [] });
  await frame().evaluate(() => { window.__oldRoot = document.getElementById('gfx-root'); });
  n = await nMsgs();
  write('scene.js', sceneJs().replace("render(t) {", "render(t) { if (t > 1) throw new Error('playhead failure');"));
  got = await waitMsg('error', n);
  ok(got?.m.message === 'playhead failure', 'render failure at preserved t posts error', got?.m);
  ok(await frame().evaluate(() => document.getElementById('gfx-root') === window.__oldRoot), 'render failure restores the original root');
  r = await rpc({ type: 'bounds', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.x - 240) < 0.5, 'old scene keeps playhead and live tweak after render failure', r.result);
  ok(await frame().evaluate(() => getComputedStyle(document.querySelector('[data-gfx="box"]')).visibility === 'hidden'), 'old view remains applied after render failure');
  r = await rpc({ type: 'seek', t: 1 });
  ok(r.ok, 'original scene still renders after replacement failure');
  await rpc({ type: 'view', hidden: [], solo: [] });
  n = await nMsgs();
  write('scene.js', sceneJs());
  got = await waitMsg('reloaded', n);
  ok(!!got, 'reload recovers after playhead render failure');

  // 5. tweaks.json + scene.json size change + burst debounce
  n = await nMsgs();
  write('tweaks.json', JSON.stringify({ box: { y: 30 } }));
  got = await waitMsg('reloaded', n);
  ok(!!got && got.m.reason === 'tweaks.json', 'tweaks.json created -> reloaded', got && got.m);
  r = await rpc({ type: 'bounds', keys: ['box'] });
  ok(r.ok && Math.abs(r.result.box.y - 80) < 0.5, 'file tweaks re-read', r.result);
  n = await nMsgs();
  write('scene.json', JSON.stringify({ kind: 'anime', width: 640, height: 360, fps: 30, duration: 2, style: 'dark-grid' }));
  got = await waitMsg('reloaded', n);
  ok(!!got && got.m.meta && got.m.meta.width === 640, 'scene.json size change -> reloaded { meta }', got && got.m);
  ok((await frame().evaluate(() => document.getElementById('gfx-root').style.width)) === '640px', 'root resized');
  n = await nMsgs();
  write('markup.js', markup('#0000ff')); write('markup.js', markup('#0000fe')); write('markup.js', markup('#0000fd'));
  await sleep(700);
  const cnt = await host.evaluate((i) => window.__msgs.slice(i).filter((x) => x.type === 'reloaded').length, n);
  ok(cnt === 1, 'burst of writes debounced into one reload', cnt);
  ok(await frame().evaluate(() => window.__nomarker === 1), 'bridge page never reloaded (marker survives)');
  // Document-wide anime.js selectors must see only the replacement's three words.
  const wordsScene = `import { createTimeline, stagger } from 'animejs';
import { COLOR } from './markup.js';
let tl;
export default {
  setup(ctx) {
    ctx.root.innerHTML = '<div class="word">one</div><div class="word">two</div><div class="word">three</div>';
    ctx.root.style.color = COLOR;
    tl = createTimeline({ autoplay: false }).add('.word', { opacity: [0, 1], duration: 200, ease: 'linear', delay: stagger(140) }, 200);
  },
  render(t) { tl.seek(t * 1000); }
};
`;
  n = await nMsgs();
  write('scene.js', wordsScene);
  got = await waitMsg('reloaded', n);
  ok(!!got, 'selector scene builds');
  await rpc({ type: 'seek', t: 0.4 });
  const wordOpacities = () => frame().evaluate(() => [...document.querySelectorAll('.word')].map((el) => Number(getComputedStyle(el).opacity)));
  const before = await wordOpacities();
  ok(before.length === 3 && before[0] > 0.99 && before[1] > 0.2 && before[1] < 0.4 && before[2] === 0, 'baseline stagger has distinct word timings', before);
  n = await nMsgs();
  write('markup.js', markup('#abcdef'));
  got = await waitMsg('reloaded', n);
  ok(!!got, 'selector scene reloads');
  const after = await wordOpacities();
  ok(after.length === 3 && after.every((x, i) => Math.abs(x - before[i]) < 0.001), 'document-wide selector and stagger keep timing after reload', { before, after });
  await host.close();
}

try { await main(); }
catch (e) { fail++; console.log('FAIL (exception)', e && e.stack || e); }
finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (server) server.kill('SIGTERM'); } catch {}
  fs.rmSync(SC, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
