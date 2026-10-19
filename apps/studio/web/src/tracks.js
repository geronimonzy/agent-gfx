// Timeline track groups (docs/REVIEW.md §7): collapsible VIDEO / AUDIO groups, per-row "shy" (hide from the timeline only),
// "show hidden (n)" reveal and the value-curve sub-rows of the LAYERS section. View state only, per scene in localStorage.
import { S, on, emit, readView, writeView } from './store.js';

export const T = { closed: new Set(), shy: new Set(), curves: new Set(), reveal: { video: false, audio: false } };
const key = () => `gfx-studio.tracks.${S.name}`;

function load() {
  T.closed.clear(); T.shy.clear(); T.curves.clear(); T.reveal.video = T.reveal.audio = false;
  if (!readView(key(), (j) => { j.closed?.forEach((x) => T.closed.add(x)); j.shy?.forEach((x) => T.shy.add(x)); j.curves?.forEach((x) => T.curves.add(x)); })) {
    T.closed.clear(); T.shy.clear(); T.curves.clear();
  }
}
function save() { writeView(key(), { closed: [...T.closed], shy: [...T.shy], curves: [...T.curves] }); }
const changed = () => { save(); emit('tracks'); };

export const groupOpen = (g) => !T.closed.has(g);
export function toggleGroup(g) { if (T.closed.has(g)) T.closed.delete(g); else T.closed.add(g); changed(); }
export function toggleShy(id) { if (T.shy.has(id)) T.shy.delete(id); else T.shy.add(id); changed(); }
export function toggleReveal(g) { T.reveal[g] = !T.reveal[g]; emit('tracks'); }
/** 'show' | 'dim' (shy but revealed) | 'hide' */
export const vis = (id, g) => (!T.shy.has(id) ? 'show' : T.reveal[g] ? 'dim' : 'hide');
export const hiddenCount = (ids) => ids.filter((id) => T.shy.has(id)).length;
export const curvesOpen = (k) => T.curves.has(k);
export function toggleCurves(k) { if (T.curves.has(k)) T.curves.delete(k); else T.curves.add(k); changed(); }
export const curvesSig = () => [...T.curves].sort().join(',');

export function initTracks() { on('scene', () => { load(); emit('tracks'); }); load(); }
