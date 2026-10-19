// Vite dev server + headless browser plumbing shared by still/sheet/render/audio/review/lib.
import path from 'node:path';
import net from 'node:net';
import { ENGINE, projectRoot, isEngineProject } from '../paths.js';
import { findBrowser, chromeFlags, browserEnv, isSoftwareRenderer, browserVersion } from '../browser.js';
import { emit, isJson } from './progress.js';
import { SAMPLE_RATE } from '../sfx.js';
import { cleanups, die, loadMeta } from './util.js';

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

// Each kind of gfx server gets its own dep-optimizer cache: Vite servers sharing one cache dir invalidate each
// other's optimized deps (504 "Outdated Optimize Dep" for the long-running `gfx serve` while a capture runs).
// Root = the project; the engine config maps runner/, style/ and deps in (runner/lib/project-vite.js).
export async function startVite(port, { cacheDir = 'node_modules/.vite-gfx' } = {}) {
  const { createServer } = await import('vite');
  const root = projectRoot();
  const cache = isEngineProject(root) ? path.join(ENGINE, cacheDir) : path.join(root, 'out', '.cache', path.basename(cacheDir).replace(/^\./, ''));
  const server = await createServer({
    root, configFile: path.join(ENGINE, 'vite.config.js'), logLevel: 'warn', cacheDir: cache,
    server: { port, strictPort: !!port, host: '127.0.0.1' },
  });
  cleanups.push(() => server.close());
  await server.listen();
  const addr = server.httpServer.address();
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

export async function launchBrowser({ mode = 'exact' } = {}) {
  const b = findBrowser({ mode });
  if (!b || !b.exists) die(`no Chrome/Edge found${b ? ` at ${b.path}` : ''} (install Chrome or Edge, or set GFX_CHROME)`);
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: b.path, headless: true, args: chromeFlags(mode), env: browserEnv(mode), defaultViewport: null });
  cleanups.push(() => browser.close());
  return browser;
}

export async function openCapture(name, { scale = 1, size = null, alpha = false, mode = 'exact' } = {}) {
  const meta = loadMeta(name);
  if (size) { meta.width = size.w; meta.height = size.h; }
  const { url } = await startVite(await freePort());
  const open = async () => {
    const browser = await launchBrowser({ mode });
    const page = await browser.newPage();
    await page.setViewport({ width: Math.round(meta.width), height: Math.round(meta.height), deviceScaleFactor: scale });
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('[page console]', m.text()); });
    await page.goto(`${url}/runner/player/index.html?scene=${encodeURIComponent(name)}&capture=1${size ? `&size=${size.w}x${size.h}` : ''}${alpha ? '&alpha=1' : ''}`);
    await page.evaluate(() => window.__gfx.ready);
    return { page, browser };
  };
  const first = await open();
  let renderer = null;
  if (mode === 'fast') {
    renderer = await webglRenderer(first.page);
    const msg = `renderer: ${renderer || 'unknown'}`;
    if (isJson()) emit({ type: 'log', level: 'info', msg }); else console.log(msg);
    if (isSoftwareRenderer(renderer)) console.warn(`warn: fast mode: no GPU available (${renderer || 'unknown'}), rendering in software`);
  }
  // openWorker(): another headless browser (own process) on the same Vite server, same viewport/DSF/alpha/query.
  return { meta, page: first.page, url, browser: first.browser, openWorker: open, renderer };
}

/** The WebGL unmasked renderer of the page's GPU process ("ANGLE (NVIDIA, ... D3D11)", "SwiftShader ..."), or null. */
export async function webglRenderer(page) {
  try {
    return await page.evaluate(() => {
      const c = document.createElement('canvas').getContext('webgl');
      if (!c) return null;
      const d = c.getExtension('WEBGL_debug_renderer_info');
      return String(d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
    });
  } catch { return null; }
}

export const JPEG_QUALITY = 92;
export const shot = (page, meta, extra = {}) =>
  page.screenshot({
    type: 'png', optimizeForSpeed: true, captureBeyondViewport: false,
    clip: { x: 0, y: 0, width: meta.width, height: meta.height }, ...extra,
  });
// Puppeteer drops clip.scale when captureBeyondViewport is off, so animated crops (per-frame scale) talk CDP directly.
const sessions = new WeakMap();
export async function shotScaled(page, clip, { alpha = false, jpeg = false } = {}) {
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.createCDPSession();
    if (alpha) await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    sessions.set(page, cdp);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: jpeg ? 'jpeg' : 'png', ...(jpeg ? { quality: JPEG_QUALITY } : {}), optimizeForSpeed: true, captureBeyondViewport: false, clip });
  return Buffer.from(data, 'base64');
}
export const seek = (page, t) => page.evaluate((x) => window.__gfx.seek(x), t);

/** Pull one channel of window.__stems[stem] out of the page as Float32Array (chunked base64). */
export async function pullStem(page, stem, ch, N) {
  const CH = 1 << 20;
  const arr = new Float32Array(N);
  for (let off = 0; off < N; off += CH) {
    const b64 = await page.evaluate((s, c, a, b) => {
      const u8 = new Uint8Array(window.__stems[s][c].buffer, a * 4, (b - a) * 4);
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(bin);
    }, stem, ch, off, Math.min(N, off + CH));
    const bytes = Buffer.from(b64, 'base64');
    arr.set(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), off);
  }
  return arr;
}

/** Headless page on the gfx Vite server that renders sfx.js cues; returns mono f32 PCM (L+R)/2 at 48 kHz. */
export async function openSynthRenderer() {
  const { url } = await startVite(await freePort());
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page error]', e.message));
  await page.goto(`${url}/runner/lib/library/blank.html`);
  return async (cues, seconds) => {
    await page.evaluate(async (cs, opts) => {
      const sfx = await import('/runner/lib/sfx.js');
      window.__stems = await sfx.renderStems(cs, opts);
    }, cues, { duration: seconds, stems: {} });
    const N = Math.round(seconds * SAMPLE_RATE);
    const [l, r] = [await pullStem(page, 'lib', 0, N), await pullStem(page, 'lib', 1, N)];
    for (let i = 0; i < N; i++) l[i] = (l[i] + r[i]) * 0.5;
    return l;
  };
}

