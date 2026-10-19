// Review comments: out/<scene>/review/comments.json (docs/REVIEW.md §1). Independent of the audio draft / its undo history.
// Merge-on-write by `updated` with tombstones; autosave 600 ms after a change; 2 s poll merges external edits.
import { emit, fps } from './store.js';
import * as api from './api.js';

let scene = null, list = [], mtime = 0, timer = 0, flushing = null, pollTimer = 0;
const dirty = new Set();   // ids with local edits not yet on disk
const onDisk = new Set();  // ids known to exist in the file (deleting these writes a tombstone)

const relOf = (sc = scene) => `out/${sc}/review/comments.json`;
const num = (id) => parseInt(String(id).replace(/\D/g, ''), 10) || 0;
const ts = (x) => Date.parse(x) || 0;
const stamp = (prev) => new Date(Math.max(Date.now(), ts(prev) + 1)).toISOString();

export const commentScene = () => scene;
export const liveComments = () => list.filter((c) => !c.deleted).sort((a, b) => a.t - b.t || num(a.id) - num(b.id));
export const getComment = (id) => { const c = list.find((q) => q.id === id); return c && !c.deleted ? c : null; };
export const commentNumber = (id) => num(id);
const touch = (id, local = true) => emit('comments', { id, local });

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => { flushNow().catch((e) => emit('toast', { m: 'Comments save failed: ' + e.message, ms: 5000 })); }, 600);
}

/** Merge a remote list into the local one; local unsaved edits are never lost. */
function mergeRemote(remote) {
  const by = new Map(list.map((c) => [c.id, c]));
  for (const r of remote) {
    onDisk.add(r.id);
    const l = by.get(r.id);
    if (!l) { by.set(r.id, r); continue; }
    if (ts(r.updated) <= ts(l.updated)) continue;
    if (dirty.has(r.id)) {
      if (l.deleted) by.set(r.id, { ...l, updated: stamp(r.updated) }); // my delete wins
      else if (r.deleted) { by.set(r.id, r); dirty.delete(r.id); }
      else by.set(r.id, { ...l, status: r.status, reply: r.reply, updated: stamp(r.updated) }); // keep my text/strokes, take Claude's status/reply
    } else by.set(r.id, r);
  }
  list = [...by.values()].sort((a, b) => num(a.id) - num(b.id));
}
async function readRemote(sc) {
  const txt = await api.readText(relOf(sc));
  if (txt == null) return null;
  const j = JSON.parse(txt); // throws on a corrupt file: we then refuse to overwrite it
  return Array.isArray(j.comments) ? j.comments : [];
}

export async function flushNow() {
  clearTimeout(timer); timer = 0;
  if (flushing) await flushing.catch(() => {});
  if (!scene || !dirty.size) return;
  flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}
async function doFlush() {
  const sc = scene;
  const remote = await readRemote(sc);
  if (remote) mergeRemote(remote);
  const snap = new Map([...dirty].map((id) => [id, list.find((c) => c.id === id)?.updated]));
  await api.writeText(relOf(sc), JSON.stringify({ version: 1, scene: sc, comments: list }, null, 2) + '\n');
  if (scene !== sc) return;
  mtime = (await api.stat(relOf(sc)))?.mtime || 0;
  for (const [id, u] of snap) {
    const cur = list.find((c) => c.id === id);
    if (!cur || cur.updated === u) { dirty.delete(id); onDisk.add(id); }
  }
  if (remote) touch(null, false);
  if (dirty.size) schedule();
}

async function poll() {
  if (!scene || flushing) return;
  try {
    const m = (await api.stat(relOf()))?.mtime || 0;
    if (m === mtime) return;
    mtime = m;
    const remote = m ? await readRemote(scene) : null;
    if (remote) { mergeRemote(remote); touch(null, false); if (dirty.size) schedule(); }
  } catch (e) { console.warn('comments poll', e.message); }
}

/** Load comments for a scene (flushes the previous scene first). draftTxt: raw draft.json for legacy `notes` migration. */
export async function loadComments(name, draftTxt) {
  if (scene && dirty.size) await flushNow().catch(() => {});
  scene = name; list = []; dirty.clear(); onDisk.clear(); mtime = 0;
  try {
    const remote = await readRemote(name);
    if (remote) { list = remote; for (const c of remote) onDisk.add(c.id); mtime = (await api.stat(relOf(name)))?.mtime || 0; }
    else await migrateNotes(name, draftTxt);
  } catch (e) { emit('toast', { m: 'comments.json unreadable: ' + e.message, ms: 6000 }); }
  touch(null, false);
  clearInterval(pollTimer); pollTimer = setInterval(poll, 2000);
}
async function migrateNotes(name, draftTxt) {
  let j; try { j = draftTxt ? JSON.parse(draftTxt) : null; } catch { j = null; }
  if (!j || !Array.isArray(j.notes) || !j.notes.length) return;
  const now = new Date().toISOString();
  list = j.notes.map((n, i) => ({
    id: 'c' + (i + 1), t: n.t, frame: Math.round(n.t * fps()), x: null, y: null, el: null, cue: n.cue || null, text: n.text || '',
    strokes: [], attachments: [], status: 'open', reply: null, created: now, updated: now,
  }));
  for (const c of list) dirty.add(c.id);
  await flushNow();
  delete j.notes;
  await api.writeText(`out/${name}/review/draft.json`, JSON.stringify(j, null, 2) + '\n');
  emit('toast', { m: `Migrated ${list.length} note(s) to comments.json`, ms: 3500 });
}

// ---------- edits ----------
export function addComment({ t, x = null, y = null, cue = null, el = null }) {
  const id = 'c' + (Math.max(0, ...list.map((c) => num(c.id))) + 1);
  const now = new Date().toISOString();
  list.push({
    id, t, frame: Math.round(t * fps()), x: x == null ? null : Math.round(x), y: y == null ? null : Math.round(y), el, cue, text: '',
    strokes: [], attachments: [], status: 'open', reply: null, created: now, updated: now,
  });
  dirty.add(id); schedule(); touch(id);
  return id;
}
/** fnOrPatch: object to Object.assign, or (comment) => void|false (false = no change). Returns true if changed. */
export function updateComment(id, fnOrPatch) {
  const c = getComment(id);
  if (!c) return false;
  const before = JSON.stringify(c);
  if (typeof fnOrPatch === 'function') { if (fnOrPatch(c) === false) return false; } else Object.assign(c, fnOrPatch);
  if (JSON.stringify(c) === before) return false;
  c.updated = stamp(c.updated); dirty.add(id); schedule(); touch(id);
  return true;
}
export function deleteComment(id) {
  const c = list.find((q) => q.id === id);
  if (!c || c.deleted) return;
  if (!onDisk.has(id) && !flushing) { list = list.filter((q) => q.id !== id); dirty.delete(id); }
  else { list[list.indexOf(c)] = { id, deleted: true, updated: stamp(c.updated) }; dirty.add(id); schedule(); }
  touch(id);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushNow().catch(() => {}); });
