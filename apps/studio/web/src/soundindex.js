// The sound-library index in the studio (no DOM): sources (the engine's library/sources.json + the project's gfx.json
// library.sources[]), their on/off overrides and the decoded index entries, read through gfxlib://. Used by Replace…
// ("Similar in the library"), the Shape section / soundtweak, the inspector's sample info and Library → Sound sources.
import * as api from './api.js';
import { S, on, emit } from './store.js';
import { readJson, writeJson } from './local-json.js';
import { pref } from './prefs.js';
import { featureVector, b64ToEmb } from '@vox';

const LS = 'gfx-studio.vox'; // historical key (the removed Perform mode shared it): keeps the users' source on/off choices
const saved = readJson(LS, {});
export const V = {
  sources: [], sourcesRoot: null, enabled: saved.enabled || {}, index: new Map(), entries: new Map(), indexErr: {},
  error: null,
};
const persist = () => writeJson(LS, { enabled: V.enabled });
const changed = () => emit('soundindex');
export const sampleLoader = (src) => api.readLib(src);
let sourcesGeneration = 0;
let located = null; // the root whose sound library the backend was last asked for (api.libLocate)
export function invalidateSources() {
  sourcesGeneration++; located = null;
  V.sourcesRoot = null; V.sources = []; V.index.clear(); V.entries.clear(); V.indexErr = {};
}
/** Where an index lives for gfxlib://: the engine's library, or `<project>/.gfx/index` for a gfx.json source. */
const indexPath = (s) => (s?.project ? `.gfx/index/${s.id}.jsonl` : `library/index/${s?.id}.jsonl`);

/** Global sources (the engine's sound library: gfx lib list --json → library, read through gfxlib://) + the project's
 *  gfx.json `library.sources[]` (`project: true`; a global id wins, as in the engine's loadSources). */
export async function loadSources() {
  if (V.sourcesRoot !== S.root) invalidateSources();
  const root = S.root, generation = ++sourcesGeneration;
  const current = () => root === S.root && generation === sourcesGeneration;
  if (located !== root) { // the backend asks the engine where its sound library is (cached per project)
    await api.libLocate().catch(() => null);
    if (!current()) return;
    located = root;
  }
  let list = [];
  try {
    const txt = await api.readLibText('library/sources.json');
    if (!current()) return;
    list = JSON.parse(txt || '{}').sources || [];
  } catch (e) { if (!current()) return; V.error = `sources.json: ${e.message}`; }
  try {
    const own = JSON.parse((await api.readText('gfx.json').catch(() => null)) || '{}').library?.sources || [];
    if (!current()) return;
    for (const s of own) if (s?.id && !list.some((x) => x.id === s.id)) list.push({ kind: 'folder', enabled: true, license: 'unspecified', ...s, project: true });
  } catch { /* no or broken gfx.json: no project sources */ }
  V.sourcesRoot = root;
  if (!list.some((s) => s.id === 'synth')) list.unshift({ id: 'synth', kind: 'synth', license: 'own', enabled: true });
  V.sources = list.map((s) => ({ ...s, count: null }));
  await Promise.all(V.sources.map((s) => ensureIndex(s.id).catch(() => {})));
  if (!current()) return;
  changed();
}
export const isEnabled = (s) => (s.id in V.enabled ? V.enabled[s.id] : s.enabled !== false);
export const enabledSources = () => V.sources.filter((s) => isEnabled(s) && (V.index.get(s.id)?.length || 0) > 0);
export async function setEnabled(id, on_) {
  V.enabled[id] = !!on_; persist();
  if (on_) await ensureIndex(id).catch(() => {});
  changed();
}
/** Drop the persisted on/off override of a source (it was removed, or added again): sources.json decides again. */
export function forgetEnabled(id) {
  if (!(id in V.enabled)) return;
  delete V.enabled[id]; persist();
  changed();
}
export async function ensureIndex(id) {
  if (V.sourcesRoot !== S.root) { invalidateSources(); V.sourcesRoot = S.root; }
  const root = S.root, generation = sourcesGeneration;
  if (V.index.has(id)) return V.index.get(id);
  const txt = await api.readLibText(indexPath(V.sources.find((x) => x.id === id) || { id }));
  if (root !== S.root || generation !== sourcesGeneration) return [];
  const list = [];
  for (const line of (txt || '').split('\n')) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    e.sid = id; e.emb = b64ToEmb(e.emb); e.fv = featureVector(e.features);
    e.key = e.synth ? `synth/${e.synth.sound}/${e.synth.variant || ''}` : `${e.src}#${e.start || 0}`;
    list.push(e); V.entries.set(e.id, e);
  }
  V.index.set(id, list);
  const s = V.sources.find((x) => x.id === id);
  if (s) s.count = list.length;
  return list;
}
/** Human name + pack for a library entry (or an id whose index is not loaded). */
export function describe(entryOrId) {
  const e = typeof entryOrId === 'string' ? V.entries.get(entryOrId) : entryOrId;
  const id = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
  const [sid, rest = ''] = id.split(/:(.*)/s);
  const src = V.sources.find((s) => s.id === sid);
  const base = { source: sid, license: src?.license || '' };
  if (e?.synth || (!e && sid === 'synth')) {
    const sy = e?.synth || {};
    const bits = (rest || '').split('/');
    const sound = sy.sound || bits[0], variant = sy.variant ?? (bits[1] && !/^[id]\d/.test(bits[1]) ? bits[1] : '');
    return { ...base, name: variant ? `${sound} · ${variant}` : sound, detail: e ? `${sy.intensity != null ? 'i' + sy.intensity : ''}${sy.dur ? ' · ' + sy.dur + 's' : ''}`.replace(/^ · /, '') : '' };
  }
  const path = (e?.src || rest).replace(/\\/g, '/').split('#')[0];
  const parts = path.split('/'), file = parts.pop() || rest;
  return { ...base, name: file.replace(/\.[^.]+$/, ''), detail: parts.slice(-3).filter((p) => p !== 'Audio' && p !== 'kenney').join('/') + (e?.dur ? ` · ${e.dur.toFixed(2)}s` : '') };
}

on('root', () => { invalidateSources(); });
let lastEngineDir;
on('prefs', (e) => {
  if (!e?.keys?.includes('engineDir')) return;
  const dir = pref('engineDir'), previous = lastEngineDir;
  lastEngineDir = dir;
  // Boot broadcasts every key while a first load may already be running. Keep that load intact.
  if (previous === undefined || dir === previous) return;
  invalidateSources(); // another engine: maybe another sound library (the next user loads it again)
});
