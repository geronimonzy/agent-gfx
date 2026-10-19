// Headless browser discovery (docs/FOUNDATION.md §2): GFX_CHROME, else the first existing Chrome, then Edge.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { which, libraryBase } from './paths.js';
import { downloadFile, extractZip } from './fetchfile.js';

/** Pinned chrome-headless-shell (Chrome for Testing), FOUNDATION.md §4b. */
export const CHROME_VERSION = '155.0.8059.79';
export const CHROME_URL_BASE = 'https://storage.googleapis.com/chrome-for-testing-public';

export const CHROME_FLAGS = [
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars',
  '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage',
];

export const MODES = ['exact', 'fast'];
/** Validate a --mode value (undefined -> env GFX_MODE -> exact). Throws a render error. */
export function resolveMode(v) {
  const m = String(v ?? process.env.GFX_MODE ?? 'exact').trim().toLowerCase();
  if (!MODES.includes(m)) throw Object.assign(new Error(`--mode must be fast|exact, got "${m}"`), { render: true });
  return m;
}

/** WSL: Linux with the GPU paravirtualisation device (Mesa d3d12 can reach the Windows GPU). */
export const isWsl = () => process.platform === 'linux' && fs.existsSync('/dev/dxg');

/**
 * Chrome flags per mode. exact = software raster (today's flags, bit-exact). fast = GPU raster per platform; SwiftShader
 * stays enabled as a fallback so WebGL still works when there is no GPU (the renderer check then warns).
 */
export function chromeFlags(mode = 'exact', platform = process.platform) {
  if (mode !== 'fast') return CHROME_FLAGS;
  const gpu = platform === 'win32' ? '--use-angle=d3d11' : platform === 'darwin' ? '--use-angle=metal' : '--use-angle=gl';
  return ['--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage',
    gpu, '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
}

/** Environment for the browser process: fast mode on WSL needs Mesa's d3d12 driver (else GL silently uses llvmpipe). */
export function browserEnv(mode = 'exact') {
  if (mode === 'fast' && isWsl() && !process.env.GALLIUM_DRIVER) return { ...process.env, GALLIUM_DRIVER: 'd3d12' };
  return process.env;
}

/** Is `s` a WebGL renderer string for software rendering? */
export const isSoftwareRenderer = (s) => !s || /swiftshader|llvmpipe|softpipe|basic render|software/i.test(s);

const PLATFORMS = { 'win32-x64': 'win64', 'linux-x64': 'linux64', 'darwin-x64': 'mac-x64', 'darwin-arm64': 'mac-arm64' };
export const chromePlatform = (platform = process.platform, arch = process.arch) => PLATFORMS[`${platform}-${arch}`] || null;
export const pinnedRoot = () => path.join(libraryBase(), 'browsers');
const shellName = (plat) => `chrome-headless-shell${plat === 'win64' ? '.exe' : ''}`;
/** Where the pinned headless shell lives (executable path) for this platform, whether installed or not. */
export function pinnedPath(root = pinnedRoot(), platform = process.platform, arch = process.arch) {
  const plat = chromePlatform(platform, arch);
  if (!plat) return null;
  return path.join(root, 'chrome-headless-shell', `${plat}-${CHROME_VERSION}`, `chrome-headless-shell-${plat}`, shellName(plat));
}

/** `--version` output of a browser binary ("Google Chrome 146.0.7680.164"), or null (never run on Windows: chrome.exe would open a window). */
export function browserVersion(exe) {
  if (process.platform === 'win32') return null; // chrome.exe --version opens a window instead of printing
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return (r.stdout || '').trim().split('\n')[0] || null;
  } catch { return null; }
}

/**
 * Download + unpack the pinned headless shell into `<root>/chrome-headless-shell/<plat>-<version>/`.
 * `url` defaults to GFX_CHROME_URL or the Chrome-for-Testing zip. Returns the executable path.
 */
export async function setupChrome({ progress = () => {}, log = () => {}, url, root = pinnedRoot(), platform = process.platform, arch = process.arch, force = false } = {}) {
  const plat = chromePlatform(platform, arch);
  if (!plat) throw new Error(`no chrome-headless-shell download for ${platform}/${arch}; install Chrome and/or set GFX_CHROME`);
  const exe = pinnedPath(root, platform, arch);
  if (fs.existsSync(exe) && !force) { log(`chrome-headless-shell ${CHROME_VERSION} already installed: ${exe}`); return exe; }
  url = url || process.env.GFX_CHROME_URL || `${CHROME_URL_BASE}/${CHROME_VERSION}/${plat}/chrome-headless-shell-${plat}.zip`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-chrome-'));
  try {
    const archive = path.join(tmp, 'chrome-headless-shell.zip');
    log(`downloading ${url}`);
    const t0 = Date.now();
    await downloadFile(url, archive, { onProgress: (d, t) => progress('download', d, t) });
    log(`downloaded ${(fs.statSync(archive).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    progress('extract', 0, 1);
    // Extract + validate next to the install first, so a corrupt archive or a full disk keeps the working browser.
    const dest = path.dirname(path.dirname(exe));
    const staging = `${dest}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
      extractZip(archive, staging);
      const staged = path.join(staging, path.relative(dest, exe));
      if (!fs.existsSync(staged)) throw new Error(`${path.basename(exe)} not found in ${url}`);
      if (process.platform !== 'win32') fs.chmodSync(staged, 0o755);
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(staging, dest);
    } finally { fs.rmSync(staging, { recursive: true, force: true }); }
    progress('extract', 1, 1);
    return exe;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

export function browserCandidates() {
  const env = process.env;
  if (process.platform === 'win32') {
    const pf = env.ProgramFiles || 'C:\\Program Files', pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', local = env.LOCALAPPDATA;
    return [
      ...[pf, pf86, local].filter(Boolean).map((d) => ({ kind: 'chrome', path: path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe') })),
      ...[pf86, pf].map((d) => ({ kind: 'edge', path: path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe') })),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      { kind: 'chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
      { kind: 'edge', path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge' },
      { kind: 'chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
    ];
  }
  const onPath = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']
    .map((n) => ({ kind: n.startsWith('microsoft') ? 'edge' : n.startsWith('chromium') ? 'chromium' : 'chrome', path: which(n) }))
    .filter((c) => c.path);
  return [{ kind: 'chrome', path: '/usr/bin/google-chrome' }, ...onPath];
}

/**
 * Pure discovery order (FOUNDATION.md §4b): GFX_CHROME -> pinned headless shell (if installed) -> system Chrome -> Edge.
 * In fast mode on WSL the headless shell cannot reach the GPU (falls back to SwiftShader), so system browsers go first
 * and the shell is only the last resort. `exists(path)` is injectable for tests.
 */
export function pickBrowser({ env = process.env, pinned = null, candidates = [], mode = 'exact', wsl = false, exists = fs.existsSync } = {}) {
  if (env.GFX_CHROME) return { path: env.GFX_CHROME, kind: 'env', source: 'GFX_CHROME', exists: exists(env.GFX_CHROME) };
  const shell = pinned && exists(pinned) ? { path: pinned, kind: 'headless-shell', source: 'pinned', exists: true } : null;
  const system = candidates.filter((c) => exists(c.path)).map((c) => ({ ...c, source: 'auto', exists: true }));
  const list = mode === 'fast' && wsl ? [...system, ...(shell ? [shell] : [])] : [...(shell ? [shell] : []), ...system];
  return list[0] || null;
}

/** `{ path, kind, source, exists }` of the browser to drive, or null when nothing is installed. */
export function findBrowser({ mode = 'exact' } = {}) {
  return pickBrowser({ pinned: pinnedPath(), candidates: browserCandidates(), mode, wsl: isWsl() });
}
