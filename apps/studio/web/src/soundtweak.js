// Sound tweak section of the cue inspector (docs/SOUND-TWEAK.md): per-cue shaping sliders, Mutate / Vary / Reset, Replace… with suggestions
// (variants, same role, CLAP-similar library entries, past choices) and taste memory. Edits are draft cue overrides.
import { S, on, emit, commit, cueById, patchCue, duration, esc, SOUND_NAMES } from './store.js';
import { resolveCues, renderStems, defaultStem, VARIANTS } from '@sfx';
import { similar, queryFromCue } from '@rank';
import { engine } from './audio.js';
import * as api from './api.js';
import { V, loadSources, ensureIndex, enabledSources, describe } from './soundindex.js';
import * as T from './soundtweak-core.js';
import { loadTaste, logChoice, tasteHistory } from './taste.js';
import { showPanel } from './layout.js';

let win = null, cueId = null, builtSig = '', repOpen = false, repSeq = 0, audSrc = null, audGen = 0, repGroups = null, repPending = false;
const $ = (s) => win.querySelector(s);
// gain / pitch / pan are cue fields of the inspector itself; the section adds the shaping ones
const INSPECTOR_FIELDS = new Set(['gain', 'pitch', 'pan']);
const forceDraft = () => { if (S.mode !== 'draft') { S.mode = 'draft'; engine.setMode('draft'); emit('mode'); } };
export const tweakOpen = () => !!win; // the host may be detached (Inspector behind another dock tab): still kept current

/** Set / drop cue fields as one draft step (undefined drops the override; base values drop too). */
function setFields(id, patch, opts) {
  const ok = patchCue(id, T.clearFor(S.baseById.get(id), patch), opts); // neutral clears a base (scene / sound.json) value

  if (ok) forceDraft();
  return ok;
}
/** Replace the sound (keeps the lane: the stem is stored explicitly). */
function replaceSound(id, patch) {
  const q = cueById(id);
  if (!q) return false;
  const full = T.replacementPatch(q, patch); // the same transform the audition uses
  const ok = commit((d) => {
    const add = d.add.find((a) => a.id === id);
    if (add) { for (const [k, v] of Object.entries(full)) { if (v === undefined) delete add[k]; else add[k] = v; } if (defaultStem(add.sound) !== q.stem) add.stem = q.stem; else delete add.stem; return; }
    const base = S.baseById.get(id);
    if (!base) return;
    const o = { ...(d.cues[id] || {}) };
    for (const [k, v] of Object.entries(full)) { if (v === undefined ? base[k] === undefined : v === base[k]) delete o[k]; else o[k] = v === undefined ? null : v; }
    if (q.stem !== base.stem || (o.sound && o.sound !== base.sound)) o.stem = q.stem;
    if (o.stem === base.stem && !o.sound) delete o.stem;
    if (Object.keys(o).length) d.cues[id] = o; else delete d.cues[id];
  });
  if (ok) forceDraft();
  return ok;
}

// ---------- inline section (the cue inspector mounts it under the cue fields) ----------
/** Build the section into `host` for cue `id` (the inspector calls this once per cue it builds). */
export function mountTweak(host, id) {
  if (win !== host || cueId !== id) { repOpen = false; repGroups = null; repPending = false; repSeq++; audGen++; stopAudition(); }
  win = host; cueId = id; builtSig = '';
  win.innerHTML = `<p class="sec-h stw-h">Shape <span class="stw-sub" id="stw-sub"></span></p>
    <div class="stw-actions"><button class="tbtn" id="stw-play" title="Play this cue alone">▶ Play</button><button class="tbtn" id="stw-mutate" title="A small random step of these values (repeatable: the same state gives the same step)">Mutate</button><button class="tbtn" id="stw-vary" title="Another take of the same sound (seed + 1)">Vary</button><button class="tbtn" id="stw-reset" title="Drop the shape and sound changes of this cue (time and mute stay)">Reset shape</button><span class="spacer"></span><button class="tbtn" id="stw-replace" aria-expanded="false" title="Other sounds for this cue: variants, same role, similar in the library, past choices">Replace…</button></div>
    <div class="stw-rep" id="stw-rep" hidden></div>
    <div class="stw-rows" id="stw-rows"></div>`; // actions + list first: the rows below vary with the sound, nothing clickable moves
  $('#stw-play').onclick = () => { const q = cueById(cueId); if (q) audition(q); };
  $('#stw-mutate').onclick = () => { const q = cueById(cueId); if (q) setFields(q.id, T.mutate(q), { key: 'stw-mut:' + q.id, window: 0 }); };
  $('#stw-vary').onclick = () => { const q = cueById(cueId); if (q && T.canVary(q.sound)) { setFields(q.id, T.vary(q), { key: 'stw-vary:' + q.id, window: 0 }); audition({ ...q, ...T.vary(q) }); } };
  $('#stw-reset').onclick = () => { const q = cueById(cueId); if (q) setFields(q.id, Object.fromEntries(T.SOUND_FIELDS.map((k) => [k, S.baseById.get(q.id)?.[k] ?? (k === 'gain' || k === 'pitch' || k === 'pan' ? 0 : undefined)]))); };
  $('#stw-replace').onclick = (e) => { e.currentTarget.blur(); repOpen = !repOpen; repGroups = null; repPending = false; repSeq++; $('#stw-replace').setAttribute('aria-expanded', String(repOpen)); renderReplace(); };
  render();
  loadTaste(true); // fresh per cue: the Library folder may have changed
}
/** Double-click on a cue: show its section (the inspector builds it on selection) and focus the first slider. */
export function openTweak(id = S.sel.cue) {
  if (!id || !cueById(id)) return;
  if (S.sel.cue !== id) { S.sel.cue = id; S.sel.note = null; emit('selection'); }
  showPanel('inspector'); // closed, behind another tab, or not in this mode's layout
  requestAnimationFrame(() => {
    if (!tweakOpen() || cueId !== id) return;
    win.scrollIntoView({ block: 'nearest' });
    win.querySelector('input[type="range"]')?.focus({ preventScroll: true });
  });
}

const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : (+v).toFixed(step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3));
function render() {
  if (!tweakOpen()) return;
  const q = cueById(cueId);
  if (!q) return;
  const rs = T.rows(q).filter((r) => !INSPECTOR_FIELDS.has(r.k)), vars = VARIANTS[q.sound] || null;
  const sig = q.id + '|' + q.sound + '|' + rs.map((r) => r.k).join(',') + '|' + (vars ? vars.join(',') : '');
  $('#stw-vary').style.visibility = T.canVary(q.sound) ? '' : 'hidden'; // ding / chime / samples don't use the seeded variance
  $('#stw-sub').textContent = `${q.sound === 'sample' ? describe('x:' + q.src).name : q.sound}${q.variant ? ' · ' + q.variant : ''}${q.seed ? ' · take ' + (q.seed + 1) : ''} · ${q.stem}`;
  if (sig !== builtSig) {
    builtSig = sig;
    $('#stw-rows').innerHTML = rs.map((r) => `<div class="field stw-row" data-k="${r.k}"><label for="stw-n-${r.k}" title="${r.label}${r.unit ? ' (' + r.unit + ')' : ''} · double-click the slider: reset">${r.label}</label><input type="range" id="stw-r-${r.k}" min="${r.min}" max="${r.max}" step="${r.step}" aria-label="${r.label}"><input type="number" id="stw-n-${r.k}" min="${r.min}" max="${r.max}" step="${r.step}"></div>`).join('')
      + (vars ? `<div class="field stw-row" data-k="variant"><label for="stw-variant">Variant</label><select id="stw-variant"><option value="">auto</option>${vars.map((v) => `<option>${v}</option>`).join('')}</select></div>` : '');
    for (const r of rs) {
      const rng = $('#stw-r-' + r.k), num = $('#stw-n-' + r.k);
      const set = (v) => { if (!Number.isFinite(v)) return; v = Math.min(r.max, Math.max(r.min, v)); setFields(cueId, { [r.k]: T.fieldValue(r.k, +v.toFixed(4)) }, { key: `stw:${cueId}:${r.k}`, window: 900 }); };
      rng.oninput = () => set(parseFloat(rng.value));
      num.onchange = () => set(parseFloat(num.value));
      rng.ondblclick = () => setFields(cueId, { [r.k]: S.baseById.get(cueId)?.[r.k] ?? (r.k === 'gain' || r.k === 'pitch' || r.k === 'pan' ? 0 : undefined) });
    }
    if (vars) $('#stw-variant').onchange = (e) => { setFields(cueId, { variant: e.target.value || undefined }); };
  }
  const ov = S.draft.cues[q.id] || S.draft.add.find((a) => a.id === q.id) || {};
  for (const r of rs) {
    const rng = $('#stw-r-' + r.k), num = $('#stw-n-' + r.k), row = rng.closest('.stw-row');
    if (document.activeElement !== rng) rng.value = r.value;
    if (document.activeElement !== num) num.value = r.auto ? '' : fmt(r.value, r.step);
    num.placeholder = r.auto ? (r.k === 'decay' ? 'off' : 'auto ' + fmt(r.value, r.step)) : '';
    row.classList.toggle('edited', r.k in ov && !S.draft.add.some((a) => a.id === q.id));
  }
  if (vars) $('#stw-variant').value = q.variant || '';
  if (repOpen) renderReplace();
}

// ---------- audition (the cue alone, same synth, same t so the seeded variance matches) ----------
function stopAudition() { if (audSrc) { try { audSrc.stop(); } catch { /* ended */ } audSrc = null; } }
async function audition(cue) {
  const my = ++audGen; // a newer audition, a close or a scene change wins over this one
  const lead = T.DUR_SOUNDS.has(cue.sound) && cue.sound !== 'sample' ? Math.min(cue.t, (cue.dur ?? T.nominalDur(cue)) * 0.8 + 0.05) : Math.min(cue.t, 0.05);
  const { cues } = resolveCues([], { add: [{ ...cue, id: cue.id, mute: false, stem: 'a' }] });
  const end = Math.min(duration() + 2, cue.t + (cue.dur ?? 1) + 2);
  const r = await renderStems(cues, { duration: end, stems: {}, loader: api.readLib });
  const ch = r.a;
  if (!ch || my !== audGen) return;
  const a = Math.max(0, Math.round((cue.t - lead) * 48000));
  const c = engine.ensure();
  if (c.state !== 'running') await c.resume();
  if (my !== audGen) return;
  stopAudition();
  const src = c.createBufferSource();
  src.buffer = engine.makeBuffer(ch[0].slice(a), ch[1].slice(a)); src.connect(engine.master); src.start();
  audSrc = src;
  emit('stw-audition', cue.id);
}

// ---------- Replace… ----------
const entryKey = (e) => (e.synth ? T.soundKey({ sound: e.synth.sound, variant: e.synth.variant }) : T.soundKey({ sound: 'sample', src: e.src, start: e.start }));
function entryPatch(e, q) {
  if (e.synth) { const p = { sound: e.synth.sound, variant: e.synth.variant || undefined }; if (T.DUR_SOUNDS.has(e.synth.sound) && e.synth.dur) p.dur = q.dur ?? e.synth.dur; return p; }
  return { sound: 'sample', src: e.src, start: e.start > 0 ? e.start : undefined, dur: e.dur ? +e.dur.toFixed(4) : undefined };
}
async function suggestions(q) {
  const from = T.soundKey(q), hist = tasteHistory();
  const groups = [];
  const vars = (VARIANTS[q.sound] || []).filter((v) => v !== q.variant).map((v) => ({ key: T.soundKey({ sound: q.sound, variant: v }), label: `${q.sound} · ${v}`, patch: { variant: v }, score: 0.5 }));
  const takes = !T.canVary(q.sound) ? [] : [1, 2].map((k) => ({ key: `take:${(q.seed || 0) + k}`, label: `${q.sound} · take ${(q.seed || 0) + k + 1}`, patch: { seed: (q.seed || 0) + k }, score: 0.4, keep: true }));
  groups.push(['Variants', [...T.rankWithTaste(vars, hist, from), ...takes]]);
  const role = q.sound === 'sample' ? q.stem : defaultStem(q.sound);
  const same = SOUND_NAMES.filter((s) => s !== q.sound && defaultStem(s) === role).map((s) => ({ key: T.soundKey({ sound: s }), label: s, patch: { sound: s }, score: 0.3 }));
  if (same.length) groups.push(['Same role', T.rankWithTaste(same, hist, from)]);
  try {
    if (!V.sources.length) await loadSources();
    await Promise.all(V.sources.filter((s) => enabledSources().includes(s) || s.id === 'synth').map((s) => ensureIndex(s.id).catch(() => {})));
    const own = queryFromCue(q, V.entries); // the cue's own entry (runner/lib/sound-rank.js, shared with `gfx lib similar`)
    if (own) {
      // role = the cue's lane (docs/SOUND-LIBRARY.md §2); other takes / intensities of the same recipe are not "similar"
      const pool = enabledSources().flatMap((s) => V.index.get(s.id) || []);
      const hits = similar(own, pool, { role: q.stem, n: 40, exclude: (e) => e.key === own.key });
      const cands = hits.map(({ entry: e, score, why }) => { const d = describe(e); return { key: entryKey(e), label: d.name, sub: why ? `${d.source} · ${why}` : d.source, patch: entryPatch(e, q), score }; });
      groups.push(['Similar in the library', T.rankWithTaste(cands, hist, from).filter((c) => c.key !== from).slice(0, 8)]);
    } else groups.push(['Similar in the library', [], q.sound === 'sample' ? 'This file is not in an indexed source.' : 'Index the synth source first: gfx lib index synth']);
  } catch (e) { groups.push(['Similar in the library', [], e.message]); }
  const past = T.pastChoices(hist, from).slice(0, 5).map((p) => ({ key: p.to, label: labelOfKey(p.to), patch: T.patchOfKey(p.to, q.stem), n: p.n, score: 0 })).filter((p) => p.patch);
  groups.push(['Past choices', past, 'Nothing picked for this sound yet.']);
  return groups;
}
function labelOfKey(k) {
  const p = T.patchOfKey(k);
  if (!p) return k;
  return p.sound === 'sample' ? describe('x:' + p.src).name : p.sound + (p.variant ? ' · ' + p.variant : '');
}
async function renderReplace() {
  const box = $('#stw-rep');
  box.hidden = !repOpen;
  if (!repOpen) return;
  const q = cueById(cueId);
  if (!q) return;
  if (repGroups) { markReplace(q); return; }
  if (repPending) return;
  repPending = true;
  const my = ++repSeq;
  box.innerHTML = '<div class="stw-note">Finding suggestions…</div>';
  const groups = await suggestions(q);
  if (my !== repSeq || !tweakOpen() || !repOpen) return;
  repPending = false; repGroups = groups;
  for (const [, list] of groups) for (const c of list) {
    c.origin = T.soundKey(q);
    if (!c.patch.sound) c.patch = { sound: q.sound, variant: q.variant, ...c.patch };
  }
  box.innerHTML = groups.map(([title, list, empty]) => `<div class="stw-gh">${esc(title)}</div>` + (list.length ? list.map((c, i) => `<div class="stw-cand" data-g="${esc(title)}" data-i="${i}" data-key="${esc(c.key)}"><button class="ib stw-aud" title="Audition" aria-label="Audition ${esc(c.label)}">▶</button><span class="nm" title="${esc(c.label + (c.sub ? ' · ' + c.sub : ''))}">${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ''}</span>${c.n ? `<span class="stw-n" title="picked ${c.n}× before for this sound">${c.n}×</span>` : ''}<button class="tbtn mini stw-use">Use</button></div>`).join('') : `<div class="stw-note">${esc(empty || 'None')}</div>`)).join('');
  const byG = new Map(groups.map(([t, l]) => [t, l]));
  for (const row of box.querySelectorAll('.stw-cand')) {
    const c = byG.get(row.dataset.g)[+row.dataset.i];
    row.querySelector('.stw-aud').onclick = () => { const cur = cueById(cueId); if (cur) audition(c.keep && T.soundKey(cur) === c.origin ? { ...cur, ...withoutUndef(c.patch) } : T.replaced(cur, c.patch)); };
    row.querySelector('.stw-use').onclick = () => { const cur = cueById(cueId); if (cur) pick(cur, c, row.dataset.g); };
  }
  markReplace(cueById(cueId));
}
function markReplace(q) {
  if (!q || !repGroups) return;
  const byG = new Map(repGroups.map(([t, l]) => [t, l]));
  for (const row of $('#stw-rep').querySelectorAll('.stw-cand')) {
    const c = byG.get(row.dataset.g)[+row.dataset.i], cur = c.keep ? T.soundKey(q) === c.origin && q.seed === c.patch.seed : T.soundKey(q) === c.key;
    row.classList.toggle('cur', cur); row.querySelector('.stw-use').title = cur ? 'In use' : 'Use this sound';
  }
}
const withoutUndef = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined));
function pick(q, c, via) {
  const from = T.soundKey(q);
  const keep = c.keep && T.soundKey(q) === c.origin;
  const ok = keep ? setFields(q.id, { seed: c.patch.seed }, { key: 'stw-pick:' + q.id, window: 0 }) : replaceSound(q.id, c.patch);
  if (ok) {
    if (!c.keep) logChoice({ scene: S.name, cue: q.id, stem: q.stem, from, to: c.key, via, tags: [q.stem, q.sound] });
    emit('toast', { m: `${q.id}: ${c.label}`, ms: 1400 });
  }
}

on('draft', () => { if (tweakOpen()) render(); });
on('scene', () => { repOpen = false; repGroups = null; repPending = false; repSeq++; audGen++; stopAudition(); });
