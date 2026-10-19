import { tok } from './theme.js';
// Comment screenshots: frame grab from the <video>, markup composite PNG (frame + strokes + pin ring), user image attachments.
// Files live in out/<scene>/review/shots/ ; attachment paths in comments.json are relative to out/<scene>/review/.
import { S, on, emit, fps } from './store.js';
import * as api from './api.js';
import { transport } from './transport.js';
import { getComment, updateComment, commentScene, liveComments } from './comments.js';
import { drawStrokes } from './draw.js';

const abs = (p, scene = commentScene()) => `out/${scene}/review/${p}`;
let generation = 0;
const origin = () => ({ scene: commentScene(), generation });
const current = (o) => o.scene === commentScene() && o.generation === generation;
const imageNumbers = new Map(); // comment id -> next reserved image number
const frames = new Map();   // comment id -> ImageBitmap of the frame
const grabs = new Map();    // comment id -> in-flight grab promise
const sigs = new Map();     // comment id -> last markup signature
const timers = new Map();
const urls = new Map();     // path -> Promise<blob url>
const RANK = { frame: 0, markup: 1, image: 2 };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
export const MAX_IMG = 15 * 1024 * 1024;

const toBlob = (cv, type, q) => new Promise((r) => cv.toBlob(r, type, q));
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

function setAttachment(id, att) {
  updateComment(id, (c) => {
    if (c.attachments.some((a) => a.kind === att.kind && a.path === att.path)) return false;
    c.attachments = [...c.attachments.filter((a) => !(a.kind === att.kind && att.kind !== 'image')), att]
      .sort((a, b) => RANK[a.kind] - RANK[b.kind]);
  });
}

/** Cached blob URL for a review-relative path (e.g. shots/c3.png). */
export function thumbUrl(path) {
  if (!urls.has(path)) urls.set(path, api.readBytes(abs(path)).then((b) => URL.createObjectURL(new Blob([b]))).catch(() => { urls.delete(path); return ''; }));
  return urls.get(path);
}
const invalidate = (path) => { const p = urls.get(path); urls.delete(path); p?.then((u) => u && URL.revokeObjectURL(u)); };

async function frameBitmap(id, o) {
  if (!current(o)) return null;
  if (frames.has(id)) return frames.get(id);
  try {
    const b = await api.readBytes(abs(`shots/${id}-frame.jpg`, o.scene));
    const bmp = await createImageBitmap(new Blob([b]));
    if (!current(o)) { bmp.close(); return null; }
    frames.set(id, bmp); return bmp;
  } catch { return null; }
}

/** Grab the video frame at the comment's t (seek, await 'seeked', draw at scene size) -> shots/<id>-frame.jpg */
export function grabFrame(id) {
  const o = origin();
  const p = (async () => {
    const c = getComment(id), v = transport.video;
    if (!c || !v || !v.src || !v.videoWidth || !S.meta) return;
    const target = Math.min((Math.round(c.t * fps()) + 0.5) / fps(), Math.max(0, (v.duration || 1e9) - 0.001));
    const orig = v.currentTime;
    const need = Math.abs(v.currentTime - target) > 0.5 / fps() / 4 || v.seeking || v.readyState < 2;
    if (need) {
      await new Promise((res) => {
        const to = setTimeout(res, 2000);
        v.addEventListener('seeked', () => { clearTimeout(to); res(); }, { once: true });
        v.currentTime = target;
      });
    }
    if (!current(o)) return;
    const cv = document.createElement('canvas'); cv.width = S.meta.width; cv.height = S.meta.height;
    cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    if (need && !transport.playing) v.currentTime = orig;
    const bmp = await createImageBitmap(cv);
    if (!current(o)) { bmp.close(); return; }
    frames.set(id, bmp);
    const path = `shots/${id}-frame.jpg`;
    const bytes = await bytesOf(await toBlob(cv, 'image/jpeg', 0.9));
    if (!current(o)) return;
    await api.writeBytes(abs(path, o.scene), bytes);
    if (!current(o)) return;
    invalidate(path);
    setAttachment(id, { kind: 'frame', path });
    scheduleMarkup(id, 50);
    emit('shots', id);
  })().catch((e) => emit('toast', { m: 'Frame grab failed: ' + e.message, ms: 4000 })).finally(() => { if (grabs.get(id) === p) grabs.delete(id); });
  grabs.set(id, p);
  return p;
}

function needsMarkup(c) { return c.x != null || (c.strokes && c.strokes.length > 0); }
const sigOf = (c) => JSON.stringify([c.x, c.y, c.strokes]);

/** Rewrite shots/<id>.png = frame + strokes + pin ring (debounced). */
export function scheduleMarkup(id, ms = 800) {
  clearTimeout(timers.get(id));
  const o = origin();
  timers.set(id, setTimeout(() => writeMarkup(id, o).catch((e) => console.warn('markup', e)), ms));
}
async function writeMarkup(id, o) {
  await grabs.get(id);
  await document.fonts.load(`700 ${tok('--text-xs')} ${tok('--font-sans')}`);
  await document.fonts.ready;
  if (!current(o)) return;
  const c = structuredClone(getComment(id));
  if (!c || !needsMarkup(c) || !S.meta) return;
  const m = S.meta, cv = document.createElement('canvas'); cv.width = m.width; cv.height = m.height;
  const g = cv.getContext('2d'), bmp = await frameBitmap(id, o);
  if (!current(o) || sigOf(getComment(id) || {}) !== sigOf(c)) return;
  if (bmp) g.drawImage(bmp, 0, 0, m.width, m.height); else { g.fillStyle = tok('--media-background'); g.fillRect(0, 0, m.width, m.height); }
  drawStrokes(g, c.strokes, 1);
  if (c.x != null) {
    const k = m.width / 1080, r = 26 * k;
    g.lineCap = 'round';
    g.strokeStyle = tok('--annotation-shadow'); g.lineWidth = 9 * k; g.beginPath(); g.arc(c.x, c.y, r, 0, 7); g.stroke();
    g.strokeStyle = tok('--annotation-pin'); g.lineWidth = 5 * k; g.beginPath(); g.arc(c.x, c.y, r, 0, 7); g.stroke();
    g.fillStyle = tok('--annotation-pin'); g.beginPath(); g.arc(c.x, c.y, 4 * k, 0, 7); g.fill();
    g.font = `bold ${Math.round(parseFloat(tok('--annotation-label-size')) * k)}px ${tok('--font-sans')}`; g.textBaseline = 'middle';
    g.lineWidth = 5 * k; g.strokeStyle = tok('--annotation-text-shadow'); g.lineJoin = 'round';
    const lx = c.x + r + 8 * k > m.width - 80 * k ? c.x - r - 8 * k - 40 * k : c.x + r + 8 * k;
    g.strokeText(c.id, lx, c.y); g.fillStyle = tok('--annotation-foreground'); g.fillText(c.id, lx, c.y);
  }
  const path = `shots/${id}.png`;
  const signature = sigOf(c);
  const bytes = await bytesOf(await toBlob(cv, 'image/png'));
  if (!current(o) || sigOf(getComment(id) || {}) !== signature) return;
  await api.writeBytes(abs(path, o.scene), bytes);
  if (!current(o) || sigOf(getComment(id) || {}) !== signature) return;
  sigs.set(id, sigOf(c));
  invalidate(path);
  setAttachment(id, { kind: 'markup', path });
  emit('shots', id);
}

/** Attach a user image (File/Blob): paste, drop or file pick. Returns true on success. */
export async function addImage(id, file) {
  const o = origin();
  const c = getComment(id);
  if (!c) return false;
  const ext = EXT[file.type] || ({ png: 'png', jpg: 'jpg', jpeg: 'jpg', webp: 'webp' }[(file.name || '').split('.').pop().toLowerCase()]);
  if (!ext) { emit('toast', { m: 'Only png / jpg / webp images can be attached', ms: 3000 }); return false; }
  if (file.size > MAX_IMG) { emit('toast', { m: 'Image is larger than 15 MB', ms: 3000 }); return false; }
  let n = imageNumbers.get(id) || 1;
  for (const a of c.attachments) { const q = /-img(\d+)\./.exec(a.path || ''); if (q) n = Math.max(n, +q[1] + 1); }
  imageNumbers.set(id, n + 1);
  const path = `shots/${id}-img${n}.${ext}`;
  try {
    const bytes = await bytesOf(file);
    if (!current(o)) return false;
    await api.writeBytes(abs(path, o.scene), bytes);
  }
  catch (e) { emit('toast', { m: 'Attach failed: ' + e.message, ms: 4000 }); return false; }
  if (!current(o)) return false;
  invalidate(path);
  setAttachment(id, { kind: 'image', path, name: file.name || `pasted.${ext}` });
  emit('shots', id);
  return true;
}
export function removeAttachment(id, path) {
  updateComment(id, (c) => { c.attachments = c.attachments.filter((a) => a.path !== path); });
}

export function initShots() {
  // Rewrite the markup whenever pin/strokes change locally (also covers the first pin).
  on('comments', (ev) => {
    if (!ev?.local) return;
    for (const c of liveComments()) {
      if (ev.id && c.id !== ev.id) continue;
      if (!needsMarkup(c)) {
        clearTimeout(timers.get(c.id)); timers.delete(c.id); sigs.delete(c.id);
        for (const a of c.attachments.filter((a) => a.kind === 'markup')) invalidate(a.path);
        updateComment(c.id, (q) => { q.attachments = q.attachments.filter((a) => a.kind !== 'markup'); });
        continue;
      }
      if (needsMarkup(c) && sigs.get(c.id) !== sigOf(c) && !grabs.has(c.id)) { sigs.set(c.id, sigOf(c)); scheduleMarkup(c.id); }
    }
  });
  on('scene', () => { generation++; imageNumbers.clear(); grabs.clear(); for (const bmp of frames.values()) bmp.close(); frames.clear(); sigs.clear(); for (const t of timers.values()) clearTimeout(t); timers.clear(); for (const p of urls.values()) p.then((u) => u && URL.revokeObjectURL(u)); urls.clear(); });
}
