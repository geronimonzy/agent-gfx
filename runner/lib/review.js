// Review-loop file logic (docs/REVIEW.md §1-2): comments.json merge-on-write, draft.json, `gfx apply`.
// Node only. No CLI or browser dependencies, so tests and tools can import it.
import fs from 'node:fs';
import path from 'node:path';
import { projectRoot, readJson } from './paths.js';

// `root` defaults to the current project (docs/FOUNDATION.md §1; = the repo for its own scenes).
export const reviewDir = (scene, root = projectRoot()) => path.join(root, 'out', scene, 'review');
export const sceneDir = (scene, root = projectRoot()) => path.join(root, 'scenes', scene);

export function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, p);
}
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const ts = (s) => { const v = Date.parse(s); return Number.isFinite(v) ? v : 0; };

// ---------- comments ----------
export const commentsPath = (scene, root) => path.join(reviewDir(scene, root), 'comments.json');
export const draftPath = (scene, root) => path.join(reviewDir(scene, root), 'draft.json');

export function readComments(scene, root) {
  const j = readJson(commentsPath(scene, root), null);
  return j && Array.isArray(j.comments) ? j : { version: 1, scene, comments: [] };
}

/** Merge two comment lists by id, taking the entry with the newer `updated` (ties: `b`, the newer writer). */
export function mergeComments(a, b) {
  const byId = new Map();
  for (const c of a) byId.set(c.id, c);
  for (const c of b) {
    const old = byId.get(c.id);
    if (!old || ts(c.updated) >= ts(old.updated)) byId.set(c.id, c);
  }
  return [...byId.values()].sort((x, y) => (+String(x.id).slice(1) || 0) - (+String(y.id).slice(1) || 0));
}

/** Read the file fresh, merge `changed` entries in (newer `updated` wins), write back atomically. */
export function writeComments(scene, changed, root) {
  const cur = readComments(scene, root);
  cur.comments = mergeComments(cur.comments, changed);
  cur.version = 1; cur.scene = scene;
  writeJsonAtomic(commentsPath(scene, root), cur);
  return cur;
}

export const visibleComments = (j) => j.comments.filter((c) => !c.deleted);

/** Set status (+ optional reply) on comments; returns the updated entries. Throws on unknown id. */
export function setStatus(scene, ids, status, reply, root) {
  const cur = readComments(scene, root);
  const out = [];
  for (const id of ids) {
    const c = cur.comments.find((x) => x.id === id && !x.deleted);
    if (!c) throw new Error(`no comment "${id}" in ${scene}`);
    // `updated` must be strictly newer than what is on disk even within the same second
    const prev = ts(c.updated);
    let u = now();
    if (ts(u) <= prev) u = new Date(prev + 1000).toISOString().replace(/\.\d+Z$/, 'Z');
    out.push({ ...c, status, reply: reply !== undefined ? reply : c.reply ?? null, updated: u });
  }
  writeComments(scene, out, root);
  return out;
}

export const absAttachments = (c, scene, root) =>
  (c.attachments || []).map((a) => ({ ...a, path: path.isAbsolute(a.path) ? a.path : path.join(reviewDir(scene, root), a.path) }));

// ---------- draft ----------
export const readDraft = (scene, root) => readJson(draftPath(scene, root), null);

const IDENT = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1, shift: 0, stretch: 1 };
/** Drop identity / empty properties of a tweak; returns null if nothing is left. */
export function cleanTweak(tw) {
  const o = {};
  for (const [k, v] of Object.entries(tw || {})) {
    if (v === null || v === undefined || v === '') continue;
    if (k in IDENT && v === IDENT[k]) continue;
    if (k === 'visible' && v === true) continue; // identity; `z: 0` stays (explicit z-index)
    o[k] = v;
  }
  if ('pivot' in o && !('shift' in o) && !('stretch' in o)) delete o.pivot; // a pivot alone is identity (docs/RETIME.md)
  return Object.keys(o).length ? o : null;
}

export function summarizeDraft(d) {
  if (!d) return { audio: 0, stems: 0, cues: 0, add: 0, tweaks: {} };
  const stems = Object.keys(d.stems || {}).length, cues = Object.keys(d.cues || {}).length, add = (d.add || []).length;
  return { audio: stems + cues + add, stems, cues, add, tweaks: d.tweaks || {} };
}
export const fmtTweak = (tw) => Object.entries(tw).map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : typeof v === 'boolean' ? v : +Number(v).toFixed(3)}`).join(' ');

// ---------- apply ----------
/** Fold draft.tweaks into scenes/<scene>/tweaks.json (merge per key; identity values drop the key). */
export function applyTweaks(scene, root) {
  const d = readDraft(scene, root);
  const dt = d && d.tweaks && typeof d.tweaks === 'object' ? d.tweaks : {};
  const file = path.join(sceneDir(scene, root), 'tweaks.json');
  const cur = readJson(file, {});
  const changes = [];
  for (const [key, tw] of Object.entries(dt)) {
    // null/'' in the draft = "remove this property"; identity values drop too
    const merged = { ...(cur[key] || {}), ...tw };
    const clean = cleanTweak(merged);
    if (JSON.stringify(clean) === JSON.stringify(cur[key] || null)) continue;
    if (clean) cur[key] = clean; else delete cur[key];
    changes.push(clean ? `${key}: ${fmtTweak(clean)}` : `${key}: removed`);
  }
  if (Object.keys(dt).length) {
    if (Object.keys(cur).length || fs.existsSync(file)) writeJsonAtomic(file, cur);
    delete d.tweaks;
    writeJsonAtomic(draftPath(scene, root), d);
  }
  return { count: Object.keys(dt).length, changes, file };
}

/** Fold draft audio edits (stems/cues/add) into scenes/<scene>/sound.json. */
export function applySound(scene, root) {
  const d = readDraft(scene, root);
  const s = summarizeDraft(d);
  const file = path.join(sceneDir(scene, root), 'sound.json');
  if (!d || !s.audio) return { count: 0, changes: [], file };
  const cur = readJson(file, {});
  const changes = [];
  for (const [k, v] of Object.entries(d.stems || {})) {
    cur.stems = cur.stems || {};
    cur.stems[k] = { ...(cur.stems[k] || {}), ...v };
    changes.push(`stem ${k}: ${fmtTweak(v)}`);
  }
  for (const [k, v] of Object.entries(d.cues || {})) {
    const added = (cur.add || []).find((a, i) => (a.id || `${a.sound}-add${i + 1}`) === k);
    if (added) Object.assign(added, v);
    else {
      cur.cues = cur.cues || {};
      cur.cues[k] = { ...(cur.cues[k] || {}), ...v };
    }
    changes.push(`cue ${k}: ${fmtTweak(v)}`);
  }
  for (const a of d.add || []) {
    cur.add = cur.add || [];
    const i = a.id !== undefined ? cur.add.findIndex((x) => x.id === a.id) : -1;
    if (i >= 0) cur.add[i] = a; else cur.add.push(a);
    changes.push(`add ${a.id || a.sound} @${a.t}`);
  }
  writeJsonAtomic(file, cur);
  d.stems = {}; d.cues = {}; d.add = [];
  writeJsonAtomic(draftPath(scene, root), d);
  return { count: s.audio, changes, file };
}
