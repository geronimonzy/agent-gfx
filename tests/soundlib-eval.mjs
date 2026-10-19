// Sound library ranking eval (docs/SOUND-LIBRARY.md §5). Kenney folder names are the ground truth: ui, interface -> ui;
// impact -> hits; digital / scifi / rpg are mixed (distractors, never a match). Every synth entry with role ui / hits
// queries the Kenney entries: precision@5 = share of the top 5 whose folder label matches the query's role
// ("lenient" leaves the mixed folders out of the denominator). Also the accuracy of roleOf on ui/interface/impact files.
// Text search: the look-friction queries, CLAP-only vs hybrid (CLAP + keyword) ranking, and the weak flag.
// Roles / labels are recomputed live from the stored embeddings with the current sound-rank.js (bands come from the
// stored v2 tags), so the script measures the code, not the index. Skips without library/index/kenney.jsonl.
// Usage: node tests/soundlib-eval.mjs [--json] [--legacy] [--show] [--grid]
import fs from 'node:fs';
import path from 'node:path';
import { libraryDir } from '../runner/lib/paths.js';
import { cosine, distance, featureVector, b64ToEmb } from '../runner/lib/vox-features.js';
import { similar, roleOf, tagsOf } from '../runner/lib/sound-rank.js';

const LIB = libraryDir();
const read = (id) => { const f = path.join(LIB, 'index', id + '.jsonl'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : null; };
const kenney = read('kenney'), synth = read('synth');
if (!kenney || !synth) { console.log(`skip: no ${path.join(LIB, 'index', 'kenney.jsonl')} / synth.jsonl`); process.exit(0); }

const { getClap } = await import('../runner/lib/library/indexer.js');
const clap = await getClap();
const truth = (e) => { const p = e.id.split(':')[1].split('/')[0]; return p === 'ui' || p === 'interface' ? 'ui' : p === 'impact' ? 'hits' : null; };
for (const e of [...kenney, ...synth]) {
  e._emb = b64ToEmb(e.emb); e._fv = featureVector(e.features);
  e.probs = await clap.zeroShot(e._emb);
  e.tags = tagsOf({ probs: e.probs, features: e.features, bands: e.tags?.bands || null, sound: e.synth?.sound });
}
// --legacy: only the synth sounds that existed before beep / wind (2026-10-18), to compare with older runs
const NEW_SOUNDS = new Set(['beep', 'wind']);
const queries = synth.filter((e) => (e.tags.role === 'ui' || e.tags.role === 'hits') && !(process.argv.includes('--legacy') && NEW_SOUNDS.has(e.synth?.sound)));

function prec(top, role) {
  const lab = top.map(truth);
  return { strict: lab.filter((l) => l === role).length / 5, lenient: lab.filter(Boolean).length ? lab.filter((l) => l === role).length / lab.filter(Boolean).length : 0 };
}
const baseline = (q) => kenney.map((e) => ({ e, s: 1.4 * cosine(q._emb, e._emb) + 0.6 * (1 - distance(q._fv, e._fv)) })).sort((a, b) => b.s - a.s).slice(0, 5).map((x) => x.e);
const after = (q) => similar(q, kenney, { role: q.tags.role, n: 5 }).map((h) => h.entry);
if (process.argv.includes('--grid')) { // weight search: strict P@5 (ui, hits) per weight set, best 15
  const { W } = await import('../runner/lib/sound-rank.js');
  const run = () => Object.fromEntries(['ui', 'hits'].map((role) => { const qs = queries.filter((q) => q.tags.role === role); let s = 0; for (const q of qs) s += similar(q, kenney, { role, n: 5 }).filter((h) => truth(h.entry) === role).length / 5; return [role, +(s / qs.length).toFixed(3)]; }));
  const rows = [];
  for (const emb of [0.8, 1.4, 2]) for (const feat of [0, 0.3, 0.6, 1]) for (const bands of [0, 0.4, 0.8, 1.2]) { Object.assign(W, { emb, feat, bands }); rows.push({ emb, feat, bands, ...run() }); }
  rows.sort((a, b) => b.ui + b.hits - a.ui - a.hits);
  for (const r of rows.slice(0, 15)) console.log(JSON.stringify(r));
  process.exit(0);
}
const res = {};
for (const [name, fn] of [['before', baseline], ['after', after]]) {
  for (const role of ['ui', 'hits']) {
    const qs = queries.filter((q) => q.tags.role === role);
    let s = 0, l = 0, short = 0;
    for (const q of qs) { const top = fn(q); if (top.length < 5) short++; const p = prec(top, role); s += p.strict; l += p.lenient; }
    res[`${name}.${role}`] = { queries: qs.length, p5: +(s / qs.length).toFixed(3), lenient: +(l / qs.length).toFixed(3), short };
  }
}
// roleOf accuracy on the labelled folders
const conf = {};
let right = 0, total = 0;
for (const e of kenney) {
  const t = truth(e);
  if (!t) continue;
  const r = roleOf(e.probs.map((p) => [p.label, p.score]), e.features).role;
  total++; if (r === t) right++;
  const k = `${t}->${r}`; conf[k] = (conf[k] || 0) + 1;
}
res.roleAccuracy = { files: total, acc: +(right / total).toFixed(3), confusion: conf };

// text search (gfx lib search): the look-friction queries (out/starter-looks-*-notes.md) with the files a sound designer
// picked. clap = CLAP text cosine only (the old ranking), hybrid = clap + KW.weight * keyword score (sound-rank.js).
// hit@1 / hit@5 / MRR over the first expected id; weak = the top hit's weak flag must match (null = not checked).
const { KW, queryTokens, keywordScore } = await import('../runner/lib/sound-rank.js');
const TEXT = [
  ['impact punch', /impactPunch/], ['punchy impact hit', /impactPunch/], ['book place', /bookPlace/],
  ['book placed on table', /bookPlace/], ['click', /[/:]click|mouseclick/], ['page turn', /bookFlip/],
  ['light wooden tap', /impactWood_light/], ['glass ding', /glass/i], ['soft airy whoosh', /whoosh\/air/],
  ['toggle', /toggle_/], ['knife swipe', /[kK]nife/], ['riser build up tension', /synth:rise/], ['bubble pop', /drop_|synth:pop/],
  ['beep', /beep/], ['digital beep', /beep\/digital/], ['wind', /synth:wind/], ['soft breeze', /wind\/breeze/], ['gust of wind', /wind\/gust/],
  ['dog bark', null, true], ['helicopter rotor', null, null], ['glass ding', null, false], ['impact punch', null, false],
];
const pool = [...kenney, ...synth];
const tsum = { clap: { h1: 0, h5: 0, mrr: 0 }, hybrid: { h1: 0, h5: 0, mrr: 0 } };
let ranked = 0, weakOk = 0, weakN = 0;
const misses = [];
for (const [text, want, weak] of TEXT) {
  const [qe] = await clap.embedText(text);
  const qt = queryTokens(text);
  const rows = pool.map((e) => { const c = cosine(qe, e._emb), kw = keywordScore(qt, e); return { id: e.id, clap: c, kw, hy: c + KW.weight * kw, weak: c < KW.weakClap && kw < KW.weakKw }; });
  if (want) {
    ranked++;
    for (const k of ['clap', 'hybrid']) {
      const key = k === 'clap' ? 'clap' : 'hy';
      const order = [...rows].sort((a, b) => b[key] - a[key] || (a.id < b.id ? -1 : 1));
      const r = order.findIndex((x) => want.test(x.id)) + 1;
      if (r === 1) tsum[k].h1++;
      if (r && r <= 5) tsum[k].h5++;
      tsum[k].mrr += r ? 1 / r : 0;
      if (k === 'hybrid' && (!r || r > 5)) misses.push(`${text} (rank ${r || '-'})`);
    }
  }
  if (weak !== undefined && weak !== null) {
    weakN++;
    const top = [...rows].sort((a, b) => b.hy - a.hy)[0];
    if (top.weak === weak) weakOk++; else misses.push(`${text}: top weak ${top.weak}, expected ${weak}`);
  }
}
for (const k of ['clap', 'hybrid']) res[`text.${k}`] = { queries: ranked, hit1: +(tsum[k].h1 / ranked).toFixed(3), hit5: +(tsum[k].h5 / ranked).toFixed(3), mrr: +(tsum[k].mrr / ranked).toFixed(3) };
res.textWeak = { checked: weakN, right: weakOk };
res.textMisses = misses;
if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 2));
else {
  for (const [k, v] of Object.entries(res)) if (!k.startsWith('text') && k !== 'roleAccuracy') console.log(`${k.padEnd(12)} P@5 ${v.p5.toFixed(3)}  lenient ${v.lenient.toFixed(3)}  (${v.queries} queries${v.short ? `, ${v.short} with < 5 hits` : ''})`);
  console.log(`roleOf accuracy ${res.roleAccuracy.acc} on ${total} ui/interface/impact files  ${JSON.stringify(conf)}`);
  for (const k of ['text.clap', 'text.hybrid']) { const v = res[k]; console.log(`${k.padEnd(12)} hit@1 ${v.hit1.toFixed(3)}  hit@5 ${v.hit5.toFixed(3)}  MRR ${v.mrr.toFixed(3)}  (${v.queries} friction queries)`); }
  console.log(`text weak flag ${res.textWeak.right}/${res.textWeak.checked} right${res.textMisses.length ? '; misses: ' + res.textMisses.join(' | ') : ''}`);
  if (process.argv.includes('--show')) for (const q of queries) console.log(q.id, '->', after(q).map((e) => e.id.split(':')[1].replace('/Audio', '')).join(', '));
}
process.exit(0);
