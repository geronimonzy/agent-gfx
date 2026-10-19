import { tok } from './theme.js';
// Draw mode + stroke layer. Strokes are vectors in scene pixels (docs/REVIEW.md §1):
//   pen      `pts` polyline; optional `smooth` (1-100) = drawn with smoothing, rendered as quadratic curves through midpoints
//   curve    cubic Bézier: `pts` = anchors, `handles[i]` = [[inX,inY],[outX,outY]] (absolute scene px)
//   arrow    2 pts; rect / ellipse 2 pts = corners, optional `rot` (radians about the box centre)
// Draw-mode sub-tools: Select (move / scale / rotate / delete; curve anchors + handles), Pen, Curve, Arrow, Rect, Ellipse.
import { S, on, emit, fps } from './store.js';
import { getComment, liveComments, updateComment } from './comments.js';
import { toScene, videoBox, getOpenComment, setTool, baseTool, commentsShown } from './viewer.js';
import { seek, transport, pause } from './transport.js';

import { $ } from './dom.js';
export const COLORS = Array.from({ length: 5 }, (_, i) => tok(`--markup-${i + 1}`)); // Stored strokes keep resolved hex values.
const WIDTHS = { S: 4, M: 6, L: 10 }; // scene px at 1080 wide; scaled by scene width
const TOOLS = [['select', 'Select'], ['pen', 'Pen'], ['curve', 'Curve'], ['arrow', 'Arrow'], ['rect', 'Rect'], ['ellipse', 'Ellipse']];
const SMOOTH = [['Raw', 0], ['Smooth', 50], ['Very smooth', 85]];
let drawing = null, tool = 'arrow', color = COLORS[0], wkey = 'M', smooth = 50, cv, g;
let cur = null, pen = null;   // stroke being drawn (pen / arrow / rect / ellipse); pen streamline state { s, last }
let bez = null;               // curve being built: { s, hover, dragIdx, t }
let sel = -1, drag = null;    // Select sub-tool: selected stroke index; drag { kind, i, s0, q0, f, cur }
let hist = [];                // draw-session undo: snapshots of the comment's strokes before each change

export const isDrawing = () => !!drawing;
export const curveActive = () => !!bez;
export const hasStrokeSel = () => !!drawing && sel >= 0;

// ---------- geometry ----------
const r1 = (v) => Math.round(v * 10) / 10;
const rp = (p) => [r1(p[0]), r1(p[1])];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const kScr = () => videoBox()?.k || 1; // screen px per scene px
const rotOf = (s) => ((s.tool === 'rect' || s.tool === 'ellipse') && s.rot ? s.rot : 0);
function rotAbout(p, c, a) {
  if (!a) return [p[0], p[1]];
  const co = Math.cos(a), si = Math.sin(a), dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * co - dy * si, c[1] + dx * si + dy * co];
}
function mapStroke(s, f) {
  const o = structuredClone(s);
  o.pts = o.pts.map(f);
  if (o.handles) o.handles = o.handles.map((h) => h.map(f));
  return o;
}
function bbox(s) {
  const all = [...(s.pts || []), ...(s.handles || []).flat()];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of all) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
function segDist(q, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
}
/** Ramer-Douglas-Peucker simplification (keeps the end points). */
function rdp(p, eps) {
  if (p.length < 3 || eps <= 0) return p;
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const stack = [[0, p.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let dm = 0, im = -1;
    for (let k = i + 1; k < j; k++) { const d = segDist(p[k], p[i], p[j]); if (d > dm) { dm = d; im = k; } }
    if (dm > eps) { keep[im] = 1; stack.push([i, im], [im, j]); }
  }
  return p.filter((_, i) => keep[i]);
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const quad = (a, c, b, t) => [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]];
const cubic = (a, c1, c2, b, t) => { const u = 1 - t; return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * c1[k] + 3 * u * t * t * c2[k] + t * t * t * b[k]); };
const hOut = (s, i) => s.handles?.[i]?.[1] || s.pts[i];
const hIn = (s, i) => s.handles?.[i]?.[0] || s.pts[i];

/** The stroke as a sampled polyline in scene px (hit-testing). */
function samples(s) {
  const p = s.pts || [];
  if (p.length < 2) return p;
  if (s.tool === 'pen') {
    if (!s.smooth || p.length < 3) return p;
    const out = [p[0]];
    let a = p[0];
    for (let i = 1; i < p.length - 1; i++) { const m = mid(p[i], p[i + 1]); for (let t = 0.25; t <= 1; t += 0.25) out.push(quad(a, p[i], m, t)); a = m; }
    out.push(p[p.length - 1]);
    return out;
  }
  if (s.tool === 'curve') {
    const out = [p[0]];
    for (let i = 1; i < p.length; i++) for (let t = 1 / 16; t <= 1.0001; t += 1 / 16) out.push(cubic(p[i - 1], hOut(s, i - 1), hIn(s, i), p[i], t));
    return out;
  }
  if (s.tool === 'arrow') return [p[0], p[p.length - 1]];
  const b = bbox(s), c = [b.cx, b.cy], a = rotOf(s);
  if (s.tool === 'rect') return [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1], [b.x0, b.y0]].map((q) => rotAbout(q, c, a));
  const rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2, out = [];
  for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; out.push(rotAbout([c[0] + rx * Math.cos(t), c[1] + ry * Math.sin(t)], c, a)); }
  return out;
}
function distTo(s, q) {
  const sm = samples(s);
  if (sm.length === 1) return dist(sm[0], q);
  let d = Infinity;
  for (let i = 0; i < sm.length - 1; i++) d = Math.min(d, segDist(q, sm[i], sm[i + 1]));
  return d;
}

// ---------- rendering ----------
function arrowHead(s, k) {
  const p = s.pts, a = p[0], b = p[p.length - 1];
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = ((s.width || 6) * 3 + 12) * k, tx = b[0] * k, ty = b[1] * k;
  return { ang, hl, tx, ty, l1: [tx - hl * Math.cos(ang - 0.45), ty - hl * Math.sin(ang - 0.45)], l2: [tx - hl * Math.cos(ang + 0.45), ty - hl * Math.sin(ang + 0.45)] };
}
function tracePath(ctx, s, k) {
  const p = s.pts;
  ctx.moveTo(p[0][0] * k, p[0][1] * k);
  if (s.tool === 'curve') {
    for (let i = 1; i < p.length; i++) { const o = hOut(s, i - 1), n = hIn(s, i); ctx.bezierCurveTo(o[0] * k, o[1] * k, n[0] * k, n[1] * k, p[i][0] * k, p[i][1] * k); }
  } else if (s.smooth && p.length > 2) {
    for (let i = 1; i < p.length - 1; i++) { const m = mid(p[i], p[i + 1]); ctx.quadraticCurveTo(p[i][0] * k, p[i][1] * k, m[0] * k, m[1] * k); }
    const l = p[p.length - 1]; ctx.lineTo(l[0] * k, l[1] * k);
  } else for (const q of p.slice(1)) ctx.lineTo(q[0] * k, q[1] * k);
}

/** Render strokes (scene px) onto ctx; k = ctx px per scene px. Shared with the markup composite (shots.js). */
export function drawStrokes(ctx, strokes, k = 1) {
  for (const s of strokes) {
    const p = s.pts || [];
    if (!p.length) continue;
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = s.color || COLORS[0];
    ctx.lineWidth = (s.width || 6) * k; ctx.lineCap = ctx.lineJoin = 'round';
    const a = p[0], b = p[p.length - 1];
    ctx.beginPath();
    if (s.tool === 'pen' || s.tool === 'curve') {
      if (p.length === 1) { ctx.arc(a[0] * k, a[1] * k, ctx.lineWidth / 2, 0, 7); ctx.fill(); }
      else { tracePath(ctx, s, k); ctx.stroke(); }
    } else if (s.tool === 'arrow') {
      const { ang, hl, tx, ty, l1, l2 } = arrowHead(s, k);
      ctx.moveTo(a[0] * k, a[1] * k); ctx.lineTo(tx - Math.cos(ang) * hl * 0.6, ty - Math.sin(ang) * hl * 0.6); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(...l1); ctx.lineTo(...l2);
      ctx.closePath(); ctx.fill();
    } else if (s.tool === 'rect') {
      const r = rotOf(s);
      if (r) {
        const w = Math.abs(b[0] - a[0]) * k, h = Math.abs(b[1] - a[1]) * k;
        ctx.translate((a[0] + b[0]) / 2 * k, (a[1] + b[1]) / 2 * k); ctx.rotate(r); ctx.rect(-w / 2, -h / 2, w, h);
      } else ctx.rect(Math.min(a[0], b[0]) * k, Math.min(a[1], b[1]) * k, Math.abs(b[0] - a[0]) * k, Math.abs(b[1] - a[1]) * k);
      ctx.stroke();
    } else if (s.tool === 'ellipse') {
      ctx.ellipse((a[0] + b[0]) / 2 * k, (a[1] + b[1]) / 2 * k, Math.abs(b[0] - a[0]) / 2 * k, Math.abs(b[1] - a[1]) / 2 * k, rotOf(s), 0, 7); ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------- SVG export (strokes to Claude as vectors) ----------
const n1 = (v) => String(r1(v));
const P = (q) => `${n1(q[0])} ${n1(q[1])}`;
/** SVG path data (scene px) of one stroke. */
export function strokePath(s) {
  const p = s.pts || [];
  if (!p.length) return '';
  const a = p[0], b = p[p.length - 1];
  if (s.tool === 'pen' || s.tool === 'curve') {
    if (p.length === 1) return `M${P(a)} l0.1 0`;
    if (s.tool === 'curve') return `M${P(a)}` + p.slice(1).map((q, i) => ` C${P(hOut(s, i))} ${P(hIn(s, i + 1))} ${P(q)}`).join('');
    if (s.smooth && p.length > 2) return `M${P(a)}` + p.slice(1, -1).map((q, i) => ` Q${P(q)} ${P(mid(q, p[i + 2]))}`).join('') + ` L${P(b)}`;
    return `M${P(a)}` + p.slice(1).map((q) => ` L${P(q)}`).join('');
  }
  if (s.tool === 'arrow') { const h = arrowHead(s, 1); return `M${P(a)} L${P(b)} M${P(h.l1)} L${P(b)} L${P(h.l2)}`; }
  if (s.tool === 'rect') { const c = samples(s); return `M${P(c[0])} L${P(c[1])} L${P(c[2])} L${P(c[3])} Z`; }
  if (s.tool === 'ellipse') {
    const bb = bbox(s), c = [bb.cx, bb.cy], r = rotOf(s), rx = (bb.x1 - bb.x0) / 2, ry = (bb.y1 - bb.y0) / 2, deg = n1(r * 180 / Math.PI);
    const s0 = rotAbout([c[0] + rx, c[1]], c, r), s1 = rotAbout([c[0] - rx, c[1]], c, r);
    return `M${P(s0)} A${n1(rx)} ${n1(ry)} ${deg} 0 1 ${P(s1)} A${n1(rx)} ${n1(ry)} ${deg} 0 1 ${P(s0)} Z`;
  }
  return '';
}
/** Strokes as an SVG document in scene px (viewBox = scene size), one <path data-tool> per stroke. */
export function strokesToSvg(strokes, meta = S.meta || {}) {
  const w = meta.width || 1920, h = meta.height || 1080, safe = (v) => String(v).replace(/[^#\w.]/g, '');
  const paths = (strokes || []).filter((s) => s.pts?.length).map((s) =>
    `  <path data-tool="${safe(s.tool)}" d="${strokePath(s)}" fill="none" stroke="${safe(s.color || COLORS[0])}" stroke-width="${+s.width || 6}" stroke-linecap="round" stroke-linejoin="round"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">\n${paths.join('\n')}\n</svg>`;
}

// ---------- selection frame ----------
/** Padded box of a stroke in its own frame (raw coords), its centre, angle, corners (scene px) and the rotate knob. */
function frameOf(s) {
  const b = bbox(s), pad = (s.width || 6) / 2 + 4 / kScr(), a = rotOf(s), c = [b.cx, b.cy];
  const local = [[b.x0 - pad, b.y0 - pad], [b.x1 + pad, b.y0 - pad], [b.x1 + pad, b.y1 + pad], [b.x0 - pad, b.y1 + pad]];
  const raw = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  return { c, a, pad, raw, local, corners: local.map((q) => rotAbout(q, c, a)), knob: rotAbout([b.cx, b.y0 - pad - 24 / kScr()], c, a) };
}
/** The selected drawing's handles in client px ({ i, corners[4], knob }) or null (E2E checks). */
export function selectionHandles() {
  const s = drawing && sel >= 0 ? getComment(drawing)?.strokes[sel] : null, b = videoBox();
  if (!s || !b) return null;
  const f = frameOf(s), cl = (p) => [b.left + p[0] * b.k, b.top + p[1] * b.k];
  return { i: sel, corners: f.corners.map(cl), knob: cl(f.knob) };
}
function hitHandle(s, q) {
  const tol = 7 / kScr(), near = (p) => dist(p, q) <= tol;
  if (s.tool === 'curve') {
    for (let i = 0; i < s.pts.length; i++) for (const j of [0, 1]) { const h = s.handles?.[i]?.[j]; if (h && dist(h, s.pts[i]) > 0.5 && near(h)) return { kind: 'handle', hi: i, hj: j }; }
    for (let i = 0; i < s.pts.length; i++) if (near(s.pts[i])) return { kind: 'anchor', hi: i };
  }
  const f = frameOf(s);
  if (near(f.knob)) return { kind: 'rotate' };
  for (let i = 0; i < 4; i++) if (near(f.corners[i])) return { kind: 'scale', corner: i };
  return null;
}
function insideFrame(s, q) {
  const f = frameOf(s), l = rotAbout(q, f.c, -f.a), [A, , C] = f.local;
  return l[0] >= A[0] && l[0] <= C[0] && l[1] >= A[1] && l[1] <= C[1];
}
function hitStroke(q) {
  const list = getComment(drawing)?.strokes || [], tol = 6 / kScr();
  for (let i = list.length - 1; i >= 0; i--) if (list[i].pts?.length && distTo(list[i], q) <= (list[i].width || 6) / 2 + tol) return i;
  return -1;
}
/** The dragged stroke for pointer q (scene px). */
function dragged(d, q, e) {
  const s0 = d.s0, dx = q[0] - d.q0[0], dy = q[1] - d.q0[1], f = d.f;
  if (d.kind === 'move') return mapStroke(s0, (p) => [p[0] + dx, p[1] + dy]);
  if (d.kind === 'anchor') {
    const o = structuredClone(s0), mv = (p) => [p[0] + dx, p[1] + dy];
    o.pts[d.hi] = mv(o.pts[d.hi]); if (o.handles?.[d.hi]) o.handles[d.hi] = o.handles[d.hi].map(mv);
    return o;
  }
  if (d.kind === 'handle') {
    const o = structuredClone(s0), p = o.pts[d.hi];
    o.handles[d.hi][d.hj] = [q[0], q[1]];
    if (!e.altKey) o.handles[d.hi][1 - d.hj] = [2 * p[0] - q[0], 2 * p[1] - q[1]]; // symmetric unless Alt
    return o;
  }
  if (d.kind === 'rotate') {
    const da = Math.atan2(q[1] - f.c[1], q[0] - f.c[0]) - Math.atan2(d.q0[1] - f.c[1], d.q0[0] - f.c[0]);
    if (s0.tool === 'rect' || s0.tool === 'ellipse') { const o = structuredClone(s0); o.rot = (s0.rot || 0) + da; return o; }
    return mapStroke(s0, (p) => rotAbout(p, f.c, da)); // other kinds: rotation baked into the points
  }
  // scale: drag a corner handle of the (possibly rotated) frame; the stroke's opposite corner stays put and the
  // handle (padded corner) follows the pointer
  const A = f.raw[(d.corner + 2) % 4], H = f.raw[d.corner], l = rotAbout(q, f.c, -f.a);
  const fac = (k) => { const w = H[k] - A[k]; return Math.abs(w) > 1e-6 ? (l[k] - f.pad * Math.sign(f.local[d.corner][k] - f.c[k]) - A[k]) / w : 1; };
  const sx = fac(0), sy = fac(1);
  let o = mapStroke(s0, (p) => [A[0] + (p[0] - A[0]) * sx, A[1] + (p[1] - A[1]) * sy]);
  if (f.a) { // rect / ellipse rotate about their own centre: shift so the fixed corner keeps its place on screen
    const b = bbox(o), c2 = [b.cx, b.cy], rc = rotAbout(c2, f.c, f.a);
    o = mapStroke(o, (p) => [p[0] + rc[0] - c2[0], p[1] + rc[1] - c2[1]]);
  }
  return o;
}
function roundStroke(s) {
  const o = mapStroke(s, rp);
  if (o.rot != null) { o.rot = Math.round(o.rot * 1e4) / 1e4; if (!o.rot) delete o.rot; }
  return o;
}

// ---------- overlay (selection, curve anchors) ----------
function marks(s, k, dpr) {
  g.lineWidth = 1 * dpr; g.strokeStyle = tok('--primary');
  for (let i = 0; i < s.pts.length; i++) {
    const p = s.pts[i];
    for (const h of s.handles?.[i] || []) {
      if (dist(h, p) <= 0.5) continue;
      g.beginPath(); g.moveTo(p[0] * k, p[1] * k); g.lineTo(h[0] * k, h[1] * k); g.stroke();
      g.beginPath(); g.arc(h[0] * k, h[1] * k, 3.5 * dpr, 0, 7); g.fillStyle = tok('--primary'); g.fill();
    }
    g.fillStyle = tok('--foreground'); g.fillRect(p[0] * k - 4 * dpr, p[1] * k - 4 * dpr, 8 * dpr, 8 * dpr); g.strokeRect(p[0] * k - 4 * dpr, p[1] * k - 4 * dpr, 8 * dpr, 8 * dpr);
  }
}
function selOverlay(s, k, dpr) {
  const f = frameOf(s), c = f.corners.map((p) => [p[0] * k, p[1] * k]), kn = [f.knob[0] * k, f.knob[1] * k], tm = mid(c[0], c[1]);
  g.save(); g.strokeStyle = tok('--primary'); g.lineWidth = 1.5 * dpr;
  g.beginPath(); c.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p))); g.closePath(); g.moveTo(...tm); g.lineTo(...kn); g.stroke();
  g.fillStyle = tok('--foreground');
  for (const p of c) { g.fillRect(p[0] - 4.5 * dpr, p[1] - 4.5 * dpr, 9 * dpr, 9 * dpr); g.strokeRect(p[0] - 4.5 * dpr, p[1] - 4.5 * dpr, 9 * dpr, 9 * dpr); }
  g.beginPath(); g.arc(...kn, 5.5 * dpr, 0, 7); g.fill(); g.stroke();
  if (s.tool === 'curve') marks(s, k, dpr);
  g.restore();
}

/** Repaint the stroke layer: strokes of comments on the exact frame (+-1 frame) and of the open / drawn comment. */
export function renderStrokes() {
  if (!cv || !S.meta) return;
  const b = videoBox();
  if (!b) return;
  const dpr = window.devicePixelRatio || 1, w = Math.round(b.w * dpr), h = Math.round(b.h * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
  const k = w / S.meta.width, fr = Math.floor(transport.time() * fps() + 1e-6), open = getOpenComment(), shown = commentsShown();
  for (const c of liveComments()) {
    if (!c.strokes?.length) continue;
    const mine = c.id === drawing;
    if (!mine && !shown) continue; // Show / hide comments (H): the comment being drawn on stays visible
    if (!mine && c.id !== open && Math.abs((c.frame ?? Math.round(c.t * fps())) - fr) > 1) continue;
    g.globalAlpha = c.status === 'open' || c.id === open || mine ? 1 : 0.5;
    drawStrokes(g, mine && drag?.cur ? c.strokes.map((s, i) => (i === drag.i ? drag.cur : s)) : c.strokes, k);
  }
  g.globalAlpha = 1;
  if (cur) drawStrokes(g, [cur], k);
  if (bez) {
    drawStrokes(g, [bez.s], k);
    const l = bez.s.pts[bez.s.pts.length - 1];
    if (bez.hover && bez.dragIdx == null && l) {
      g.save(); g.strokeStyle = bez.s.color; g.globalAlpha = 0.5; g.lineWidth = Math.max(1, bez.s.width * k / 2); g.setLineDash([6 * dpr, 6 * dpr]);
      const o = hOut(bez.s, bez.s.pts.length - 1);
      g.beginPath(); g.moveTo(l[0] * k, l[1] * k); g.bezierCurveTo(o[0] * k, o[1] * k, bez.hover[0] * k, bez.hover[1] * k, bez.hover[0] * k, bez.hover[1] * k); g.stroke(); g.restore();
    }
    g.save(); marks(bez.s, k, dpr); g.restore();
  }
  const s = drawing && tool === 'select' && sel >= 0 ? (drag?.cur || getComment(drawing)?.strokes[sel]) : null;
  if (s?.pts?.length) selOverlay(s, k, dpr);
}

// ---------- edits (draw-session undo) ----------
function edit(fn) {
  const c = getComment(drawing);
  if (!c) return false;
  const snap = structuredClone(c.strokes);
  if (!updateComment(drawing, fn)) return false;
  hist.push(snap); if (hist.length > 100) hist.shift();
  return true;
}
/** Ctrl+Z while drawing: undo the last change of this draw session (stroke, move, scale, rotate, delete, clear);
 *  with nothing left in the session, remove the last stroke (strokes drawn earlier). */
export function undoStroke() {
  if (!drawing) return;
  if (bez) { cancelCurve(); return; }
  sel = -1;
  if (hist.length) { const snap = hist.pop(); updateComment(drawing, (c) => { c.strokes = snap; }); }
  else updateComment(drawing, (c) => { if (!c.strokes.length) return false; c.strokes.pop(); });
  renderStrokes(); updateBar();
}
export function clearStrokes() { if (drawing) { sel = -1; edit((c) => { if (!c.strokes.length) return false; c.strokes = []; }); } }
export function deleteSelStroke() {
  if (!drawing || sel < 0) return;
  const i = sel; sel = -1;
  edit((c) => { if (!c.strokes[i]) return false; c.strokes.splice(i, 1); });
  renderStrokes(); updateBar();
}
export function deselectStroke() { sel = -1; renderStrokes(); updateBar(); }
/** Commit the curve being built (>= 2 anchors; a double-click's repeated anchor is dropped). */
export function finishCurve() {
  if (!bez) return;
  const s = bez.s; bez = null;
  while (s.pts.length > 1 && dist(s.pts[s.pts.length - 1], s.pts[s.pts.length - 2]) < 1) { s.pts.pop(); s.handles.pop(); }
  if (s.pts.length >= 2) edit((c) => { c.strokes.push(roundStroke(s)); });
  renderStrokes(); updateBar();
}
export function cancelCurve() { bez = null; renderStrokes(); updateBar(); }

// ---------- bar ----------
function updateBar() {
  const bar = $('draw-bar');
  bar.hidden = !drawing;
  for (const b of bar.querySelectorAll('[data-dt]')) b.classList.toggle('on', b.dataset.dt === tool);
  for (const b of bar.querySelectorAll('[data-dc]')) b.classList.toggle('on', b.dataset.dc === color);
  for (const b of bar.querySelectorAll('[data-dw]')) b.classList.toggle('on', b.dataset.dw === wkey);
  for (const b of bar.querySelectorAll('[data-ds]')) b.classList.toggle('on', +b.dataset.ds === smooth);
  const smoothing = bar.querySelector('.db-smooth');
  smoothing.style.visibility = tool === 'pen' ? '' : 'hidden';
  for (const el of smoothing.querySelectorAll('button, input')) el.disabled = tool !== 'pen';
  bar.querySelector('[data-act=smooth]').value = smooth;
  bar.querySelector('.db-smooth output').textContent = smooth;
  const c = getComment(drawing);
  bar.querySelector('[data-act=undo]').disabled = !c || (!c.strokes.length && !hist.length && !bez);
  bar.querySelector('[data-act=clear]').disabled = !c || !c.strokes.length;
  $('vo').classList.toggle('drawing', !!drawing);
  $('vo').dataset.drawTool = drawing ? tool : '';
  if (cv && tool !== 'select') cv.style.cursor = '';
}
function setDrawTool(t) {
  if (t === tool) return;
  if (bez) finishCurve();
  tool = t; sel = -1; drag = null;
  renderStrokes();
}

export function startDraw(id) {
  const c = getComment(id);
  if (!c || !S.meta) return;
  if (transport.playing) pause();
  if (Math.abs(transport.time() - c.t) > 0.5 / fps()) seek(c.t, { frame: true });
  drawing = id; S.sel.note = id; hist = []; sel = -1; drag = null; bez = null;
  setTool('draw'); updateBar(); renderStrokes(); emit('draw', true);
}
export function stopDraw() {
  if (!drawing) return;
  if (bez) finishCurve();
  drawing = null; cur = null; pen = null; sel = -1; drag = null; hist = [];
  setTool(baseTool()); updateBar(); renderStrokes(); emit('draw', false);
}

export function initDraw() {
  window.addEventListener('theme', renderStrokes);
  cv = $('draw-canvas'); g = cv.getContext('2d');
  const bar = $('draw-bar');
  bar.innerHTML = `<div class="db-tools"><span class="db-label">Draw</span>
    <span class="seg small">${TOOLS.map(([id, l]) => `<button data-dt="${id}"${id === 'select' ? ' title="Select a drawing: drag to move, corners scale, the round knob rotates, Del removes; curves: drag anchors / handles (Alt = break the handle)"' : id === 'curve' ? ' title="Curve: click to add points, drag to pull handles; Enter or double-click finishes, Esc cancels"' : ''}>${l}</button>`).join('')}</span>
    <span class="db-colors">${COLORS.map((c) => `<button data-dc="${c}" style="--c:${c}" title="${c}"></button>`).join('')}</span>
    <span class="seg small">${Object.keys(WIDTHS).map((w) => `<button data-dw="${w}" title="Stroke width ${w}">${w}</button>`).join('')}</span>
    <button class="tbtn" data-act="undo" title="Undo the last drawing change (Ctrl+Z)">Undo</button>
    <button class="tbtn" data-act="clear">Clear</button>
    <button class="tbtn primary" data-act="done" title="Done (Enter)">Done</button></div>
    <span class="db-smooth" title="Pen smoothing (0 = raw)"><span class="seg small">${SMOOTH.map(([l, v]) => `<button data-ds="${v}">${l}</button>`).join('')}</span><input type="range" min="0" max="100" step="1" data-act="smooth" aria-label="Pen smoothing amount"><output></output></span>`;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.dt) setDrawTool(b.dataset.dt);
    else if (b.dataset.dc) color = b.dataset.dc;
    else if (b.dataset.dw) wkey = b.dataset.dw;
    else if (b.dataset.ds) smooth = +b.dataset.ds;
    else if (b.dataset.act === 'undo') undoStroke();
    else if (b.dataset.act === 'clear') clearStrokes();
    else if (b.dataset.act === 'done') stopDraw();
    b.blur(); updateBar();
  });
  const range = bar.querySelector('[data-act=smooth]');
  range.addEventListener('input', () => { smooth = +range.value; updateBar(); });
  range.addEventListener('change', () => range.blur());

  const pt = (e) => {
    const p = toScene(e.clientX, e.clientY);
    return [Math.round(Math.min(S.meta.width, Math.max(0, p.x))), Math.round(Math.min(S.meta.height, Math.max(0, p.y)))];
  };
  const scenePt = (e) => { const p = toScene(e.clientX, e.clientY); return [p.x, p.y]; };
  const width = () => Math.round(WIDTHS[wkey] * S.meta.width / 1080);

  cv.addEventListener('pointerdown', (e) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault(); cv.setPointerCapture(e.pointerId);
    if (tool === 'select') {
      const q = scenePt(e), list = getComment(drawing)?.strokes || [];
      let h = list[sel] ? hitHandle(list[sel], q) : null;
      if (!h && list[sel] && insideFrame(list[sel], q)) h = { kind: 'move' };
      if (!h) { sel = hitStroke(q); if (sel >= 0) h = { kind: 'move' }; }
      drag = h ? { ...h, i: sel, s0: structuredClone(list[sel]), q0: q, f: frameOf(list[sel]), cur: null } : null;
      renderStrokes(); updateBar();
      return;
    }
    const p = pt(e);
    if (tool === 'curve') {
      const l = bez?.s.pts[bez.s.pts.length - 1];
      if (bez && e.timeStamp - bez.t < 400 && dist(l, p) < 8 / kScr()) { finishCurve(); return; } // double-click finishes
      if (!bez) bez = { s: { tool: 'curve', color, width: width(), pts: [], handles: [] }, hover: null, dragIdx: null, t: 0 };
      bez.s.pts.push(p); bez.s.handles.push([p.slice(), p.slice()]);
      bez.dragIdx = bez.s.pts.length - 1; bez.t = e.timeStamp;
      renderStrokes(); updateBar();
      return;
    }
    cur = { tool, color, width: width(), pts: tool === 'pen' ? [p] : [p, p] };
    pen = tool === 'pen' ? { s: p.slice(), last: p } : null;
    renderStrokes();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    if (drag) { drag.cur = dragged(drag, scenePt(e), e); renderStrokes(); return; }
    if (tool === 'select') {
      const q = scenePt(e), s = getComment(drawing)?.strokes[sel], h = s ? hitHandle(s, q) : null;
      cv.style.cursor = h ? (h.kind === 'scale' ? 'nwse-resize' : h.kind === 'rotate' ? 'grab' : 'pointer') : (s && insideFrame(s, q)) || hitStroke(q) >= 0 ? 'move' : 'default';
      return;
    }
    if (bez) {
      const q = pt(e), i = bez.dragIdx;
      if (i != null && (e.buttons & 1)) { const p = bez.s.pts[i]; bez.s.handles[i] = dist(q, p) >= 2 ? [[2 * p[0] - q[0], 2 * p[1] - q[1]], q] : [p.slice(), p.slice()]; }
      else bez.hover = q;
      renderStrokes();
      return;
    }
    if (!cur) return;
    const p = pt(e);
    if (cur.tool === 'pen') {
      let q = p;
      if (smooth) { // streamline: the drawn point trails the pointer (more smoothing = more lag)
        const f = smooth / 100 * 0.8;
        pen.s = [pen.s[0] + (p[0] - pen.s[0]) * (1 - f), pen.s[1] + (p[1] - pen.s[1]) * (1 - f)];
        q = [Math.round(pen.s[0]), Math.round(pen.s[1])];
      }
      pen.last = p;
      const l = cur.pts[cur.pts.length - 1];
      if (dist(q, l) >= 3) cur.pts.push(q);
      if (smooth) cur.smooth = smooth;
    } else cur.pts[1] = p;
    renderStrokes();
  });
  const end = () => {
    if (drag) {
      const d = drag; drag = null;
      if (d.cur) edit((c) => { if (!c.strokes[d.i]) return false; c.strokes[d.i] = roundStroke(d.cur); });
      renderStrokes(); updateBar();
      return;
    }
    if (bez) { bez.dragIdx = null; return; }
    if (!cur) return;
    const s = cur; cur = null;
    if (s.tool === 'pen' && smooth) { // catch up with the pointer, then simplify (Ramer-Douglas-Peucker)
      if (dist(s.pts[s.pts.length - 1], pen.last) >= 1) s.pts.push(pen.last);
      s.pts = rdp(s.pts, smooth / 100 * 3 * S.meta.width / 1080);
      s.smooth = smooth;
    }
    pen = null;
    const [a, b] = [s.pts[0], s.pts[s.pts.length - 1]];
    const tiny = s.tool !== 'pen' && dist(a, b) < 6;
    if (!tiny && drawing) edit((c) => { c.strokes.push(s); });
    renderStrokes(); updateBar();
  };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (bez && bez.hover) { bez.hover = null; renderStrokes(); } });

  for (const ev of ['time', 'comments', 'layout', 'open-comment', 'comments-vis']) on(ev, () => {
    if (drawing) {
      const c = getComment(drawing);
      if (!c) { stopDraw(); return; }
      if (sel >= c.strokes.length) sel = -1;
      updateBar();
    }
    renderStrokes();
  });
  on('scene', () => { bez = null; stopDraw(); });
  updateBar();
}
