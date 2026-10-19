// Shared CLI helpers: errors, scene paths (in the current project), cleanup registry.
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot } from '../paths.js';
import { isJson } from './progress.js';

export const die = (msg) => {
  if (!isJson()) console.error('gfx: ' + msg);
  process.exitCode = process.exitCode || 1;
  throw Object.assign(new Error(msg), { handled: true });
};
export const sceneDir = (name) => path.join(projectRoot(), 'scenes', name);
export const outDir = (name) => path.join(projectRoot(), 'out', name);
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const num = (v, d) => (v === undefined ? d : Number(v));
export const fmtT = (t) => String(+t.toFixed(3));
export const listArg = (v) => (v || []).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean);

export function loadMeta(name) {
  if (!name) die('missing scene name');
  const p = path.join(sceneDir(name), 'scene.json');
  if (!fs.existsSync(p)) die(`scene "${name}" not found (${p})`);
  return readJson(p);
}

// ---------- cleanup registry (Vite servers, browsers, ffmpeg) ----------
export const cleanups = [];
let cleaning = false;
export async function runCleanups() {
  if (cleaning) return;
  cleaning = true;
  for (const fn of cleanups.splice(0).reverse()) { try { await fn(); } catch {} }
  cleaning = false;
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => { await runCleanups(); process.exit(130); });
}
