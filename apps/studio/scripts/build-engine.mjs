#!/usr/bin/env node
// Assemble an engine bundle for an installer (docs/INSTALL.md §1, §4): the engine files, a pinned Node and production
// node_modules for one target, pruned to that platform.
//   node apps/studio/scripts/build-engine.mjs windows   -> out/installer/engine-windows/        (Tauri resource "engine/")
//   node apps/studio/scripts/build-engine.mjs wsl       -> out/installer/engine-wsl.tar.gz      (unpacked into a distro by the app)
// Runs on Linux / WSL (npm installs the target's optional binaries with --os/--cpu; Node archives are SHA-256 checked).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TARGETS = {
  windows: { os: 'win32', node: 'node-v24.22.0-win-x64.zip', sha256: 'f9683a19877e12a9b167305c8db71040d812876359de21f0d2e97c3f321f80c3' },
  wsl: { os: 'linux', node: 'node-v24.22.0-linux-x64.tar.xz', sha256: 'cc2f601cee82d9a5a233302fe307abc600727035fd7d2c3a3571755989e95008' },
};
const NODE_URL = (file) => `https://nodejs.org/dist/v24.22.0/${file}`;
/** What the engine needs at run time (runner/lib/paths.js ENGINE): no tests, no studio sources, no repo project files. */
const ENGINE_FILES = ['runner', 'bin', 'style', 'templates', '.claude/skills', 'docs/CONTRACT.md', 'vite.config.js', 'package.json', 'package-lock.json', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];

const target = process.argv[2];
const T = TARGETS[target];
if (!T) { console.error('usage: build-engine.mjs windows|wsl'); process.exit(2); }
const OUT = path.join(REPO, 'out', 'installer');
const DIR = path.join(OUT, `engine-${target}`);
const CACHE = path.join(OUT, 'cache');
const log = (m) => console.log(`[engine ${target}] ${m}`);
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
fs.mkdirSync(CACHE, { recursive: true });

log('copy engine files');
for (const rel of ENGINE_FILES) fs.cpSync(path.join(REPO, rel), path.join(DIR, rel), { recursive: true });

log(`npm ci --omit=dev --os=${T.os} --cpu=x64 (install scripts off: the packages ship prebuilt binaries)`);
run('npm', ['ci', '--omit=dev', `--os=${T.os}`, '--cpu=x64', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: DIR });

log('prune');
const nm = (...p) => path.join(DIR, 'node_modules', ...p);
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
// onnxruntime-node: only this platform's x64 binaries, CPU only (CLAP runs on the CPU; the CUDA / TensorRT providers are 270 MB)
const ortBin = nm('onnxruntime-node', 'bin', 'napi-v6');
for (const os of fs.readdirSync(ortBin)) {
  if (os !== T.os) { rm(path.join(ortBin, os)); continue; }
  for (const arch of fs.readdirSync(path.join(ortBin, os))) if (arch !== 'x64') rm(path.join(ortBin, os, arch));
}
for (const f of ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_tensorrt.so']) rm(path.join(ortBin, T.os, 'x64', f));
// transformers.js's node build bundles its own onnxruntime-web; the package itself is never loaded by the engine
rm(nm('onnxruntime-web'));
// sharp (+ the LGPL libvips in @img): imported by transformers.js at load, used only for images, which gfx never sends.
// A stub keeps the import working and keeps libvips out of the installer (THIRD_PARTY_NOTICES.md).
rm(nm('sharp')); rm(nm('@img'));
fs.mkdirSync(nm('sharp'), { recursive: true });
fs.writeFileSync(nm('sharp', 'package.json'), JSON.stringify({ name: 'sharp', version: '0.0.0-gfx-stub', main: 'index.js', type: 'commonjs' }, null, 2));
fs.writeFileSync(nm('sharp', 'index.js'), "// gfx engine bundle: image processing is not shipped (docs/INSTALL.md §4).\nmodule.exports = function sharp() { throw new Error('sharp is not included in the gfx engine bundle'); };\nmodule.exports.default = module.exports;\n");

log(`node ${T.node}`);
const archive = path.join(CACHE, T.node);
if (!fs.existsSync(archive)) {
  const res = await fetch(NODE_URL(T.node));
  if (!res.ok) throw new Error(`download ${T.node}: HTTP ${res.status}`);
  fs.writeFileSync(archive + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(archive + '.part', archive);
}
const sum = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
if (sum !== T.sha256) { rm(archive); throw new Error(`${T.node}: SHA-256 ${sum} does not match the pinned ${T.sha256}`); }
const tmp = fs.mkdtempSync(path.join(CACHE, 'x-'));
const base = T.node.replace(/\.(zip|tar\.xz)$/, '');
fs.mkdirSync(path.join(DIR, 'node'), { recursive: true });
if (target === 'windows') {
  run('unzip', ['-q', archive, `${base}/node.exe`, `${base}/LICENSE`, '-d', tmp]);
  fs.copyFileSync(path.join(tmp, base, 'node.exe'), path.join(DIR, 'node', 'node.exe'));
} else {
  run('tar', ['-xJf', archive, '-C', tmp, `${base}/bin/node`, `${base}/LICENSE`]);
  fs.copyFileSync(path.join(tmp, base, 'bin', 'node'), path.join(DIR, 'node', 'node'));
  fs.chmodSync(path.join(DIR, 'node', 'node'), 0o755);
}
fs.copyFileSync(path.join(tmp, base, 'LICENSE'), path.join(DIR, 'node', 'LICENSE'));
rm(tmp);

const du = (p) => Number(execFileSync('du', ['-sm', p]).toString().split('\t')[0]);
const files = Number(execFileSync('sh', ['-c', `find "${DIR}" -type f | wc -l`]).toString().trim());
log(`ready: ${DIR} (${du(DIR)} MB, ${files} files)`);
if (target === 'wsl') {
  const tgz = path.join(OUT, 'engine-wsl.tar.gz');
  run('tar', ['-czf', tgz, '-C', DIR, '.']);
  log(`packed: ${tgz} (${du(tgz)} MB)`);
}
