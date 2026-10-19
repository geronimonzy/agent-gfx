// ffmpeg discovery, the one spawn helper every ffmpeg call goes through, and `gfx setup ffmpeg`.
// Lookup: GFX_FFMPEG, else `ffmpeg` on PATH, else <library-parent>/bin/ffmpeg(.exe) (where `gfx setup ffmpeg` installs).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { binDir, which } from './paths.js';
import { downloadFile, extractZip } from './fetchfile.js';

const EXE = process.platform === 'win32' ? '.exe' : '';

function findTool(name, envVar) {
  if (process.env[envVar]) return process.env[envVar];
  if (name === 'ffprobe' && process.env.GFX_FFMPEG) {
    const sib = path.join(path.dirname(process.env.GFX_FFMPEG), 'ffprobe' + EXE);
    if (fs.existsSync(sib)) return sib;
  }
  const onPath = which(name);
  if (onPath) return onPath;
  const local = path.join(binDir(), name + EXE);
  return fs.existsSync(local) ? local : null;
}
export const ffmpegPath = () => findTool('ffmpeg', 'GFX_FFMPEG');
export const ffprobePath = () => findTool('ffprobe', 'GFX_FFPROBE');

export class FfmpegMissing extends Error {
  constructor() { super('ffmpeg not found (set GFX_FFMPEG, put ffmpeg on PATH, or run `gfx setup ffmpeg`)'); this.code = 'GFX_NO_FFMPEG'; }
}

/** Spawn ffmpeg directly (no shell). Same options as child_process.spawn. */
export function spawnFfmpeg(args, opts = {}) {
  const bin = ffmpegPath();
  if (!bin) throw new FfmpegMissing();
  return spawn(bin, args, { windowsHide: true, ...opts });
}

/** Run ffmpeg to completion; resolves with stderr text, rejects with the tail of stderr. */
export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    let ff;
    try { ff = spawnFfmpeg(['-hide_banner', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'] }); } catch (e) { return reject(e); }
    let err = '';
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-1500)}`))));
  });
}

/** First line of `ffmpeg -version`, or null. */
export function toolVersion(bin) {
  if (!bin) return null;
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (r.error || r.status !== 0) return null;
  return (r.stdout.split('\n')[0] || '').trim();
}

// Windows: a pinned BtbN release-branch build (static GPL, ffmpeg 9.0.2) from a month-end autobuild, which BtbN keeps
// long-term (dated daily builds are pruned); verified against the SHA-256 GitHub publishes for the asset. To move to a
// newer build, pick a month-end `autobuild-YYYY-MM-DD-*` tag and copy the asset name + digest from its release page.
// Linux (dev/WSL engine only) uses johnvansickle's current static release, unpinned.
export const FFMPEG_URLS = {
  win32: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-30-13-08/ffmpeg-n9.0.2-17-g2a571b6068-win64-gpl-9.0.zip',
  'linux-x64': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  'linux-arm64': 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz',
};
export const FFMPEG_SHA256 = {
  win32: 'a0e45723c72141975f51d8666302e614711745f3102b704ca3f82c897a58d278',
};

function sha256File(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(1 << 20);
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

/**
 * Download a static ffmpeg + ffprobe into binDir(). `progress(phase, done, total)`, `log(msg)`.
 * Returns the installed paths.
 */
export async function setupFfmpeg({ progress = () => {}, log = () => {}, url, dest = binDir(), platform = process.platform, arch = process.arch } = {}) {
  const key = platform === 'win32' ? 'win32' : platform === 'linux' ? `linux-${arch}` : null;
  const sha256 = url ? null : FFMPEG_SHA256[key]; // a custom --url is the caller's responsibility
  url = url || FFMPEG_URLS[key];
  if (!url) throw new Error(`no ffmpeg download for ${platform}/${arch}; install ffmpeg yourself and set GFX_FFMPEG`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-ffmpeg-'));
  try {
    const archive = path.join(tmp, path.basename(new URL(url).pathname));
    log(`downloading ${url}`);
    const t0 = Date.now();
    await downloadFile(url, archive, { onProgress: (d, t) => progress('download', d, t) });
    log(`downloaded ${(fs.statSync(archive).size / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (sha256) {
      const got = sha256File(archive);
      if (got !== sha256) throw new Error(`ffmpeg download checksum mismatch (expected ${sha256}, got ${got}); not installed`);
      log('checksum ok');
    }
    progress('extract', 0, 1);
    fs.mkdirSync(dest, { recursive: true });
    const want = ['ffmpeg', 'ffprobe'].map((n) => n + (archive.endsWith('.zip') ? '.exe' : ''));
    const out = [];
    if (archive.endsWith('.zip')) {
      out.push(...extractZip(archive, dest, { filter: (name) => { const b = name.split('/').pop(); return want.includes(b) && /\/bin\//.test('/' + name) ? b : false; } }));
    } else {
      // .tar.xz (Linux only): tar is always present there; spawned directly, no shell.
      const x = path.join(tmp, 'x');
      fs.mkdirSync(x);
      const r = spawnSync('tar', ['-xJf', archive, '-C', x], { encoding: 'utf8' });
      if (r.error || r.status !== 0) throw new Error(`could not extract ${archive}: ${r.error?.message || r.stderr}`);
      for (const d of fs.readdirSync(x)) for (const w of want) {
        const f = path.join(x, d, w);
        if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(dest, w)); fs.chmodSync(path.join(dest, w), 0o755); out.push(path.join(dest, w)); }
      }
    }
    progress('extract', 1, 1);
    for (const w of want) if (!out.some((p) => path.basename(p) === w)) throw new Error(`${w} not found in ${url}`);
    return out;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
