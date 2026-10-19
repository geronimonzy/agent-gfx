// Library indexer + CLAP text search (Node). Entry format: see docs/CONTRACT.md "Sound library".
import fs from 'node:fs';
import path from 'node:path';
import { spawnFfmpeg } from '../ffmpeg.js';
import { analyze, trimSilence, segmentEvents, loadClap, embToB64, b64ToEmb, cosine, bandEnergies, CLAP_MODEL, CLAP_SR, CLAP_MAX_SEC, CLAP_LABELS } from '../vox-features.js';
import { tagsOf, similar, queryFromCue, ROLES, RANK_VERSION, KW, queryTokens, keywordScore } from '../sound-rank.js';
import { VARIANTS, DEFAULT_INTENSITY, makeCue } from '../sfx.js';
import { MODELS_DIR, loadSources, sourceDir, walkAudio, relSrc, indexFile, readIndex, resolveSrc } from './config.js';

// v2 = v1 + `tags` (labels, role, bands); a v1 index is upgraded in place by re-tagging (no CLAP audio pass)
export const INDEX_VERSION = 2;
const MAX_SEG = 6, LONG_SEC = 8;

/** Decode any audio file with ffmpeg to mono f32 at 48 kHz. */
export function decodeFile(file, { start = 0, dur = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error'];
    if (start > 0) args.push('-ss', String(start));
    if (dur > 0) args.push('-t', String(dur));
    args.push('-i', file, '-vn', '-ac', '1', '-ar', String(CLAP_SR), '-f', 'f32le', '-');
    let ff;
    try { ff = spawnFfmpeg(args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return reject(e); }
    const chunks = [];
    let err = '';
    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { err += d; });
    ff.on('error', reject);
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed for ${file}: ${err.slice(-300)}`));
      const b = Buffer.concat(chunks);
      const out = new Float32Array(b.length >> 2);
      new Uint8Array(out.buffer).set(b.subarray(0, out.length * 4));
      resolve(out);
    });
  });
}

const modelDir = (model) => path.join(MODELS_DIR, ...model.split('/'));
export function modelsPresent(model = CLAP_MODEL) {
  const d = modelDir(model);
  return ['config.json', 'preprocessor_config.json', 'tokenizer.json', 'onnx/audio_model_quantized.onnx', 'onnx/text_model_quantized.onnx'].every((f) => fs.existsSync(path.join(d, f)));
}
let clapP = null;
/** Singleton CLAP. First use downloads the model into library/.models; afterwards runs fully offline. */
export function getClap(model = process.env.GFX_CLAP_MODEL || CLAP_MODEL, log = console.error) {
  if (!clapP) {
    const local = modelsPresent(model);
    if (!local) log(`gfx: downloading CLAP model ${model} into ${MODELS_DIR} (one time)`);
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    clapP = loadClap({ modelPath: MODELS_DIR, model, local }).then((c) => ({ ...c, model }));
  }
  return clapP;
}

const r1 = (n) => +n.toFixed(3);

/** `tags` from the stored embedding (zero-shot over CLAP_LABELS, softmax temp 30 as Perform) + the clip's bands. */
async function tagFor(clap, e, pcm, bands = null) {
  const probs = await clap.zeroShot(typeof e.emb === 'string' ? b64ToEmb(e.emb) : e.emb);
  return tagsOf({ probs, features: e.features, bands: pcm ? bandEnergies(pcm, CLAP_SR) : bands, sound: e.synth?.sound });
}
async function entryFor(clap, pcm, base, reuse) {
  const old = reuse?.get(base.id);
  if (old) return { ...old, ...base, features: old.features, emb: old.emb, tags: await tagFor(clap, old, pcm) }; // v1 -> v2: no audio embedding
  const f = analyze(pcm, CLAP_SR);
  const e = { ...base, features: f, emb: embToB64(await clap.embedAudio(pcm)) };
  e.tags = await tagFor(clap, e, pcm);
  return e;
}
/** Re-tag v1 entries of an unchanged file: decode each entry's region for the bands, labels / role from `emb`. */
async function retagFile(clap, abs, olds) {
  const out = [];
  for (const e of olds) {
    if (e.tags) { out.push(e); continue; }
    let pcm = null;
    try { pcm = await decodeFile(abs, { start: e.start || 0, dur: e.dur || 0 }); } catch { /* bands unknown */ }
    out.push({ ...e, tags: await tagFor(clap, e, pcm) });
  }
  return out;
}

/** Index a decoded file into 1..6 entries. */
async function indexPcm(clap, pcm, meta) {
  const out = [];
  const total = pcm.length / CLAP_SR;
  if (total > LONG_SEC) {
    const evs = segmentEvents(pcm, CLAP_SR, { maxDur: LONG_SEC })
      .sort((a, b) => b.strength - a.strength).slice(0, MAX_SEG).sort((a, b) => a.start - b.start);
    for (const e of evs) {
      const a = Math.floor(e.start * CLAP_SR), b = Math.min(pcm.length, a + Math.floor(e.dur * CLAP_SR));
      const seg = pcm.subarray(a, b);
      const [ta, tb] = trimSilence(seg, CLAP_SR);
      if (tb - ta < 0.02 * CLAP_SR) continue;
      const clip = seg.subarray(ta, Math.min(tb, ta + CLAP_MAX_SEC * CLAP_SR));
      const start = r1(e.start + ta / CLAP_SR);
      out.push(await entryFor(clap, clip, { ...meta, id: `${meta.id}#${start.toFixed(2)}`, start, dur: r1(clip.length / CLAP_SR) }));
    }
    if (out.length) return out;
  }
  const [ta, tb] = trimSilence(pcm, CLAP_SR);
  if (tb - ta < 0.02 * CLAP_SR) return [];
  const clip = pcm.subarray(ta, Math.min(tb, ta + CLAP_MAX_SEC * CLAP_SR));
  return [await entryFor(clap, clip, { ...meta, start: r1(ta / CLAP_SR), dur: r1(clip.length / CLAP_SR) })];
}

/** Recipes to render for the synth source: sound x variant x 3 intensities (x 2 durations for dur-based sounds). */
export function synthRecipes() {
  const INTENS = [0.25, 0.55, 0.9];
  const INT_SOUNDS = ['impact', 'logo', 'whoosh', 'swoosh', 'suck', 'rise', 'wind'];
  // wind is a bed from t: its longest recipe must end inside the 6 s slot (HIT 2.5 s)
  const DURS = { whoosh: [0.35, 0.9], swoosh: [0.35, 0.9], suck: [0.3, 0.8], rise: [0.8, 2.0], type: [0.5, 1.5], wind: [1.2, 3] };
  const SOUNDS = ['impact', 'logo', 'whoosh', 'swoosh', 'suck', 'rise', 'click', 'pop', 'tick', 'type', 'ding', 'chime', 'beep', 'wind'];
  const out = [];
  for (const sound of SOUNDS) {
    for (const variant of VARIANTS[sound] || [undefined]) {
      for (const intensity of INT_SOUNDS.includes(sound) ? INTENS : [undefined]) {
        for (const dur of DURS[sound] || [undefined]) {
          const o = { sound };
          if (variant) o.variant = variant;
          if (intensity !== undefined) o.intensity = intensity;
          if (dur !== undefined) o.dur = dur;
          out.push(o);
        }
      }
    }
  }
  return out;
}
export const synthEntryId = (o) => `synth:${o.sound}${o.variant ? '/' + o.variant : ''}${o.intensity !== undefined ? '/i' + o.intensity : ''}${o.dur !== undefined ? '/d' + o.dur : ''}`;

const SLOT = 6, HIT = 2.5;
async function indexSynth(clap, renderSynth, log, progress = () => {}, reuse = null) {
  const recipes = synthRecipes();
  const entries = [];
  for (let b = 0; b < recipes.length; b += 16) {
    const batch = recipes.slice(b, b + 16);
    const cues = batch.map((o, i) => makeCue(i * SLOT + HIT, o.sound, { id: `lib-${b + i}`, stem: 'lib', variant: o.variant, intensity: o.intensity, dur: o.dur }));
    const pcm = await renderSynth(cues, batch.length * SLOT); // mono f32 @48k
    for (let i = 0; i < batch.length; i++) {
      const o = batch[i];
      const slot = pcm.subarray(i * SLOT * CLAP_SR, (i + 1) * SLOT * CLAP_SR);
      const [ta, tb] = trimSilence(slot, CLAP_SR, -50);
      if (tb - ta < 0.02 * CLAP_SR) continue;
      const clip = slot.subarray(ta, tb);
      const e = await entryFor(clap, clip, {
        id: synthEntryId(o), synth: { sound: o.sound, variant: o.variant, intensity: o.intensity, dur: o.dur, hit: r1(HIT - ta / CLAP_SR) },
        start: 0, dur: r1(clip.length / CLAP_SR),
      }, reuse);
      for (const k of Object.keys(e.synth)) if (e.synth[k] === undefined) delete e.synth[k];
      entries.push(e);
    }
    log(`  synth ${Math.min(recipes.length, b + 16)}/${recipes.length}`);
    progress('index', Math.min(recipes.length, b + 16), recipes.length, { source: 'synth' });
  }
  return entries;
}

/**
 * Index sources. `renderSynth(cues, seconds) => Promise<Float32Array>` is supplied by the CLI (needs headless Chrome).
 * Returns per-source stats.
 */
export async function indexSources(ids, { force = false, renderSynth, log = (m) => console.error(m), progress = () => {} } = {}) {
  const cfg = loadSources();
  const wanted = ids.length ? ids.map((id) => cfg.sources.find((s) => s.id === id) || (() => { throw new Error(`unknown source "${id}"`); })()) : cfg.sources.filter((s) => s.enabled);
  const clap = await getClap();
  const stats = [];
  for (const src of wanted) {
    const t0 = Date.now();
    const file = indexFile(src);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const metaFile = file.replace(/\.jsonl$/, '.meta.json');
    const prevMeta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : null;
    const upgrade = !force && prevMeta?.model === clap.model && prevMeta.version === 1; // re-tag in place
    const stale = force || !prevMeta || prevMeta.model !== clap.model || (prevMeta.version !== INDEX_VERSION && !upgrade);
    const prev = stale ? [] : readIndex(src);
    let entries = [], files = 0, reused = 0, failed = 0, retagged = 0;
    // tagging rules changed (RANK_VERSION): labels / role again from the stored emb, stored bands kept (no decode)
    if (!stale && prevMeta.rank !== RANK_VERSION) {
      for (const e of prev) if (e.tags) { if (e.tags.bands) { e.tags = await tagFor(clap, e, null, e.tags.bands); retagged++; } else delete e.tags; }
    }
    if (src.kind === 'synth') {
      // synth recipes depend on sfx.js: re-render when forced, stale, or sfx.js changed
      const sfxM = fs.statSync(new URL('../sfx.js', import.meta.url)).mtimeMs | 0;
      const same = !stale && prev.length && prevMeta.sfx === sfxM;
      if (same && prev.every((e) => e.tags)) { entries = prev; reused = prev.length; }
      else {
        if (!renderSynth) throw new Error('synth indexing needs a renderer');
        // re-render for the bands; entries of the same recipe keep their embedding (same sfx.js)
        const reuse = same ? new Map(prev.map((e) => [e.id, e])) : null;
        entries = await indexSynth(clap, renderSynth, log, progress, reuse);
        if (reuse) { retagged = entries.filter((e) => reuse.has(e.id)).length; reused = retagged; }
        else retagged = 0;
      }
      files = synthRecipes().length;
      fs.writeFileSync(metaFile, JSON.stringify({ model: clap.model, version: INDEX_VERSION, rank: RANK_VERSION, sfx: sfxM, entries: entries.length }) + '\n');
    } else {
      const dir = sourceDir(src);
      if (!fs.existsSync(dir)) { log(`gfx: source ${src.id}: folder not found (${dir})`); stats.push({ id: src.id, files: 0, entries: 0, missing: true }); continue; }
      const list = walkAudio(dir);
      const byPath = new Map();
      for (const e of prev) { const k = e.src; if (!byPath.has(k)) byPath.set(k, []); byPath.get(k).push(e); }
      let n = 0;
      for (const f of list) {
        n++;
        const st = fs.statSync(f), rel = relSrc(f), m = Math.floor(st.mtimeMs);
        const old = byPath.get(rel);
        if (old && old[0].m === m && old[0].z === st.size) {
          const untagged = old.filter((e) => !e.tags).length;
          entries.push(...(untagged ? await retagFile(clap, f, old) : old)); reused += old.length; retagged += untagged; files++;
          if (untagged) progress('index', n, list.length, { source: src.id });
          continue;
        }
        try {
          const pcm = await decodeFile(f);
          const got = await indexPcm(clap, pcm, { id: `${src.id}:${path.relative(dir, f).split(path.sep).join('/')}`, src: rel, m, z: st.size });
          entries.push(...got);
          files++;
        } catch (e) { failed++; log(`gfx: skip ${rel}: ${e.message.split('\n')[0]}`); }
        progress('index', n, list.length, { source: src.id });
        if (n % 25 === 0) log(`  ${src.id} ${n}/${list.length} files, ${entries.length} entries, ${(n / ((Date.now() - t0) / 1000)).toFixed(1)} files/s`);
      }
      fs.writeFileSync(metaFile, JSON.stringify({ model: clap.model, version: INDEX_VERSION, rank: RANK_VERSION, entries: entries.length }) + '\n');
    }
    fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
    const secs = (Date.now() - t0) / 1000;
    stats.push({ id: src.id, files, entries: entries.length, reused, retagged, failed, secs: +secs.toFixed(1), filesPerSec: +(files / Math.max(secs, 1e-3)).toFixed(2) });
  }
  return stats;
}

// role filter shared by search / similar: unknown or uncertain roles stay (similar() ranks them lower)
const roleOk = (e, role) => !role || role === 'any' || !e.tags?.role || !(e.tags.roleScore >= 0.4) || e.tags.role === role;
const pickIds = (cfg, sources) => (sources.length ? sources : cfg.sources.filter((s) => s.enabled).map((s) => s.id));
const checkRole = (role) => { if (role && role !== 'any' && !ROLES.includes(role)) throw new Error(`unknown role "${role}" (one of ${ROLES.join(', ')}, any)`); };

/**
 * Hybrid search over the chosen (or all enabled) sources' indexes: CLAP text -> audio cosine (`clap`) plus a keyword
 * score over file name words, folder / pack, labels and role (`kw`, sound-rank keywordScore); score = clap + KW.weight
 * * kw. `weak`: clap < KW.weakClap and kw < KW.weakKw (no good sound match and no name match: nothing really fits). `role` / `maxDur` filter.
 */
export async function searchLibrary(text, { sources = [], n = 10, role, maxDur } = {}) {
  checkRole(role);
  const ids = pickIds(loadSources(), sources);
  const clap = await getClap();
  const [q] = await clap.embedText(text);
  const qt = queryTokens(text);
  const hits = [];
  for (const id of ids) {
    for (const e of readIndex(id)) {
      if (!roleOk(e, role) || (maxDur > 0 && e.dur > maxDur)) continue;
      const c = cosine(q, b64ToEmb(e.emb)), kw = keywordScore(qt, e);
      hits.push({ id: e.id, source: id, score: c + KW.weight * kw, clap: c, kw, weak: c < KW.weakClap && kw < KW.weakKw, dur: e.dur, entry: e });
    }
  }
  return hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1)).slice(0, n);
}

/** An index entry by id, looked up in its registered source (enabled or not). */
export function findEntry(id) {
  const sid = String(id).split(':')[0];
  const src = loadSources().sources.find((s) => s.id === sid);
  return src ? readIndex(src).find((e) => e.id === id) || null : null;
}
/** Every registered source's entries (a cue's own entry may live in a disabled source, e.g. synth). */
export const allEntries = () => loadSources().sources.flatMap((s) => readIndex(s));
/** A query entry for an audio file: decoded, trimmed (first 10 s), embedded + tagged on the fly (not stored). */
export async function entryForFile(file) {
  const pcm = await decodeFile(file);
  const [ta, tb] = trimSilence(pcm, CLAP_SR);
  if (tb - ta < 0.02 * CLAP_SR) throw new Error(`${file}: silent`);
  const clip = pcm.subarray(ta, Math.min(tb, ta + CLAP_MAX_SEC * CLAP_SR));
  return entryFor(await getClap(), clip, { id: 'file:' + path.resolve(file), src: relSrc(path.resolve(file)), start: r1(ta / CLAP_SR), dur: r1(clip.length / CLAP_SR) });
}
/** Library entries like `query` (an index entry) over the chosen (or all enabled) sources (sound-rank similar()). */
export function similarLibrary(query, { sources = [], role, n = 8, maxDur, minDur } = {}) {
  checkRole(role);
  const bySrc = new Map();
  const cands = pickIds(loadSources(), sources).flatMap((id) => readIndex(id).map((e) => (bySrc.set(e, id), e)));
  // a file query: never return that file's own entry (its index src may be relative or reached via a symlink)
  const real = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
  const own = query.id?.startsWith('file:') ? real(query.id.slice(5)) : null;
  const exclude = own ? (e) => !!e.src && Math.abs((e.start || 0) - (query.start || 0)) < 1e-3 && real(resolveSrc(e.src)) === own : undefined;
  return similar(query, cands, { role, n, exclude, maxDur: maxDur > 0 ? maxDur : undefined, minDur: minDur > 0 ? minDur : undefined })
    .map((h) => ({ id: h.entry.id, source: bySrc.get(h.entry), score: h.score, dur: h.entry.dur, why: h.why, entry: h.entry }));
}
export { queryFromCue };

export { CLAP_LABELS };
