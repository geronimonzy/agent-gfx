// Library fetchers: Kenney CC0 audio packs, Freesound API v2 (CC0 previews).
import fs from 'node:fs';
import path from 'node:path';
import { LIB, walkAudio } from './config.js';
import { downloadFile, extractZip } from '../fetchfile.js';

const UA = 'Mozilla/5.0 (gfx-library-fetch)';

export const KENNEY_PACKS = {
  impact: 'impact-sounds', interface: 'interface-sounds', ui: 'ui-audio',
  digital: 'digital-audio', scifi: 'sci-fi-sounds', rpg: 'rpg-audio',
};

async function getBuf(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${url}`), { status: r.status });
  return Buffer.from(await r.arrayBuffer());
}

/** The pack page links the (hash-versioned) zip; scrape it so the URL never goes stale. */
export async function kenneyZipUrl(slug) {
  const page = `https://kenney.nl/assets/${slug}`;
  const r = await fetch(page, { headers: { 'user-agent': UA }, redirect: 'follow' });
  if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status} for ${page}`), { status: r.status });
  const html = await r.text();
  const m = html.match(/https:\/\/kenney\.nl\/media\/[^"'<>\s]*\.zip/);
  if (!m) throw new Error(`no zip link found on ${page}`);
  return m[0];
}

/** `progress(phase, done, total, extra)` is optional (CLI `--progress json`): download bytes per pack, then packs. */
export async function fetchKenney(packsArg, log = console.log, progress = () => {}) {
  const keys = packsArg ? String(packsArg).split(',').map((s) => s.trim()).filter(Boolean) : Object.keys(KENNEY_PACKS);
  const results = [];
  for (const [ki, k] of keys.entries()) {
    progress('packs', ki, keys.length, { item: k });
    const slug = KENNEY_PACKS[k] || k;
    const key = KENNEY_PACKS[k] ? k : Object.keys(KENNEY_PACKS).find((x) => KENNEY_PACKS[x] === k) || k;
    const dest = path.join(LIB, 'kenney', key);
    try {
      const url = await kenneyZipUrl(slug);
      log(`kenney ${key}: ${url}`);
      const zip = path.join(LIB, 'kenney', `.${key}.zip`);
      fs.mkdirSync(path.dirname(zip), { recursive: true });
      await downloadFile(url, zip, { onProgress: (d, t) => progress('download', d, t, { item: key }) });
      fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(dest, { recursive: true });
      extractZip(zip, dest);
      fs.rmSync(zip, { force: true });
      const files = walkAudio(dest).length;
      const lic = fs.readdirSync(dest, { recursive: true }).filter((f) => /licen[sc]e/i.test(path.basename(String(f))));
      if (!lic.length) fs.writeFileSync(path.join(dest, 'License.txt'), `Kenney ${slug} (${url})\nCreative Commons CC0 1.0 Universal - https://creativecommons.org/publicdomain/zero/1.0/\n`);
      results.push({ pack: key, slug, files, license: lic[0] ? String(lic[0]) : 'License.txt (written)' });
      log(`  -> ${files} audio files, license: ${results.at(-1).license}`);
    } catch (e) {
      results.push({ pack: key, slug, error: e.message, status: e.status });
      log(`  ! ${key}: ${e.message}${e.status === 404 ? ' (skipped)' : ''}`);
    }
  }
  progress('packs', keys.length, keys.length);
  return results;
}

// ---------- Freesound ----------
export const FREESOUND_HELP = `FREESOUND_API_KEY is not set.
  1. Create / log in to a Freesound account: https://freesound.org/
  2. Apply for an API key: https://freesound.org/apiv2/apply/  (a "Client secret/API key" is enough, no OAuth needed for previews)
  3. export FREESOUND_API_KEY=<your key>   and re-run  gfx lib fetch freesound --query "<q>"`;

/** Build the Freesound text-search URL (no network). */
export function freesoundSearchUrl({ query, n = 50, minDur = 0.05, maxDur = 6, page = 1, key = '' }) {
  const u = new URL('https://freesound.org/apiv2/search/text/');
  u.searchParams.set('query', query);
  u.searchParams.set('filter', `license:"Creative Commons 0" duration:[${minDur} TO ${maxDur}]`);
  u.searchParams.set('fields', 'id,name,username,url,license,duration,previews');
  u.searchParams.set('page_size', String(Math.min(150, Math.max(1, n))));
  u.searchParams.set('page', String(page));
  u.searchParams.set('sort', 'rating_desc');
  if (key) u.searchParams.set('token', key);
  return u.toString();
}

export async function fetchFreesound({ query, n = 50, minDur = 0.05, maxDur = 6, key = process.env.FREESOUND_API_KEY }, log = console.log, progress = () => {}) {
  if (!key) return { missingKey: true };
  const dest = path.join(LIB, 'freesound-cc0');
  fs.mkdirSync(dest, { recursive: true });
  const creditsFile = path.join(dest, 'credits.json');
  const credits = fs.existsSync(creditsFile) ? JSON.parse(fs.readFileSync(creditsFile, 'utf8')) : [];
  const have = new Set(credits.map((c) => c.id));
  const results = [];
  let url = freesoundSearchUrl({ query, n, minDur, maxDur, key });
  while (url && results.length < n) {
    const r = await fetch(url, { headers: { 'user-agent': UA } });
    if (!r.ok) throw new Error(`Freesound HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    results.push(...j.results);
    url = j.next ? j.next + (j.next.includes('token=') ? '' : `&token=${key}`) : null;
  }
  let got = 0;
  const todo = results.slice(0, n);
  for (const [i, s] of todo.entries()) {
    progress('download', i, todo.length);
    if (have.has(s.id)) continue;
    const pv = s.previews?.['preview-hq-ogg'] || s.previews?.['preview-hq-mp3'];
    if (!pv) continue;
    const ext = pv.endsWith('.mp3') ? 'mp3' : 'ogg';
    const safe = s.name.replace(/[^\w.-]+/g, '_').slice(0, 60);
    const file = `${s.id}-${safe}.${ext}`;
    fs.writeFileSync(path.join(dest, file), await getBuf(pv));
    credits.push({ id: s.id, file, name: s.name, user: s.username, url: s.url, license: s.license });
    got++;
    log(`  ${file}`);
  }
  progress('download', todo.length, todo.length);
  fs.writeFileSync(creditsFile, JSON.stringify(credits, null, 2) + '\n');
  return { got, total: credits.length, dir: dest };
}
