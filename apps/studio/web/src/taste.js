// Sound taste memory (docs/SOUND-TWEAK.md §4): every Replace… pick, machine-wide, in the machine Library
// (`taste/sounds.json`, next to looks / presets / palettes). Read once per session, appended on each pick.
import * as api from './api.js';

export const TASTE_REL = 'taste/sounds.json';
const MAX = 2000;
let hist = null, loading = null, writing = Promise.resolve();

function parse(text) {
  try { const j = JSON.parse(text || '{}'); return Array.isArray(j.choices) ? j.choices.filter((c) => c && typeof c.from === 'string' && typeof c.to === 'string') : []; }
  catch { return []; }
}
/** One choice per line (diff-friendly, like the palettes). */
const serialize = (list) => `{ "version": 1, "choices": [\n${list.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n] }\n`;

export function loadTaste(force = false) {
  // resolves true when the file was read (a missing file reads as null = empty history), false on a read error
  if (!loading || force) loading = api.libraryRead(TASTE_REL).then((t) => { hist = parse(t); return true; }, () => { hist = []; return false; });
  return loading;
}
export const tasteHistory = () => hist || [];
/** Append { scene, cue, stem, from, to, via, tags } (+ at) and write the file; failures only warn. */
export function logChoice(entry) {
  writing = writing.then(async () => {
    // re-read right before writing: the Library folder may have changed since the cache was filled (never write an
    // old folder's history into a new one)
    if (!(await loadTaste(true))) { console.warn('taste memory not saved: the file could not be read'); return; } // never overwrite unread history
    hist.push({ at: new Date().toISOString(), ...entry });
    if (hist.length > MAX) hist = hist.slice(-MAX);
    try { await api.libraryWrite(TASTE_REL, serialize(hist)); } catch (e) { console.warn('taste memory not saved:', e.message || e); }
  });
  return writing;
}
