// Draft audition: re-synthesize only the stems whose cues/config differ from cues.json, using the harness synth.
import { renderStems } from '@sfx';
import { S, on, emit, stemSig, duration, hasEdits } from './store.js';
import { engine } from './audio.js';
import { readLib } from './api.js';

const cache = new Map(); // scene|stem|sig -> AudioBuffer
let timer = 0, running = false, again = false;

export function initSynth() {
  on('draft', () => schedule());
  on('scene', () => { cache.clear(); appliedKey = null; if (hasEdits()) schedule(); });
}
let appliedKey = null;
const keyOf = () => JSON.stringify([...new Set([...Object.keys(S.base.stems), ...S.res.cues.map((c) => c.stem)])].map((st) => stemSig(S.res, st)));
const baseKey = () => JSON.stringify([...new Set([...Object.keys(S.base.stems), ...S.baseRes.cues.map((c) => c.stem)])].map((st) => stemSig(S.baseRes, st)));
export function schedule(delay = 300) {
  // notes, element tweaks etc.: the audio signature is unchanged, nothing to render
  if (S.name && S.res && delay === 300 && !S.synth.busy && keyOf() === (appliedKey ?? baseKey())) return;
  clearTimeout(timer);
  timer = setTimeout(run, delay);
  if (!S.synth.busy && S.name) { S.synth.busy = true; emit('synth'); }
}

async function run() {
  if (!S.name || !S.res) { S.synth.busy = false; emit('synth'); return; }
  if (running) { again = true; return; }
  running = true;
  try {
    do {
      again = false;
      const res = S.res, name = S.name;
      const stems = new Set([...Object.keys(S.base.stems), ...res.cues.map((c) => c.stem)]);
      const out = new Map(), need = [];
      for (const st of stems) {
        const sig = stemSig(res, st);
        if (sig === stemSig(S.baseRes, st)) continue; // identical to the WAV -> keep original
        const key = `${name}|${st}|${sig}`;
        if (cache.has(key)) out.set(st, cache.get(key)); else need.push([st, key]);
      }
      if (need.length) {
        const t0 = performance.now();
        const names = new Set(need.map((n) => n[0]));
        const cues = res.cues.filter((c) => names.has(c.stem));
        const r = cues.length ? await renderStems(cues, { duration: duration(), stems: res.stems, loader: readLib }) : {};
        const N = Math.round(duration() * 48000);
        for (const [st, key] of need) {
          const ch = r[st];
          const buf = engine.makeBuffer(ch ? ch[0] : new Float32Array(N), ch ? ch[1] : new Float32Array(N));
          cache.set(key, buf); out.set(st, buf);
        }
        S.synth.last = Math.round(performance.now() - t0);
      }
      if (name === S.name) { appliedKey = keyOf(); engine.setDraft(out); S.synth.runs++; emit('draftbuffers'); }
    } while (again);
  } catch (e) { console.error('synth failed', e); }
  running = false;
  S.synth.busy = false;
  emit('synth');
}
