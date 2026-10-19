import { roundSurfaceOrigin } from './surface-origin.js';
// Ask Claude composer (docs/CLAUDE-IN-APP.md §3, docs/T3.md §5): a `gfx context` brief of what the user is looking at (selected
// element with live values, comment, draft changes, a failed render) + a message, sent to the Claude terminal (bracketed paste)
// or to a T3 thread over MCP (the thread open in the T3 panel, another thread of this project, or a new one; with the frame at
// the playhead and the markup PNGs of the included comments as attachments), or copied. Opened with emit('ask-claude', { source, scene?, el?, comment?, t?, extra?, label? }).
import * as api from './api.js';
import { pref, setPref } from './prefs.js';
import { S, on, emit, esc, tweakSummary } from './store.js';
import { readJson, writeJson } from './local-json.js';
import { transport } from './transport.js';
import { liveOn, request, L } from './live.js';
import { flushNow, getComment, liveComments, commentNumber } from './comments.js';
import { sendToClaude } from './terminal.js';
import * as t3 from './t3.js';
import { ESCALATION } from './t3-core.js';
import { beforeAsk } from './versions.js';
import { strokePath } from './draw.js';

import { $ } from './dom.js';
const r2 = (v) => +Number(v).toFixed(2);
const pad2 = (t) => (Math.round(t * 100) / 100).toFixed(2).padStart(5, '0');
const SOURCE = { element: 'Selected element', comment: 'Comment', comments: 'All open comments', changes: 'Draft changes', render: 'Render error', scene: 'Scene', code: 'Code' };
let dlg = null, ctx = null, ctx0 = null, brief = '', briefFrom = '', seq = 0, busy = false;

// ---------- sent-to-T3 markers (✈ on comments), per project + scene ----------
const SENT_KEY = 'gfx-studio.t3sent.v1';
const sentAll = () => readJson(SENT_KEY, {});
const sentKey = (id) => `${S.root}|${S.name}|${id}`;
export const t3SentAt = (id) => sentAll()[sentKey(id)] || 0;
function markSent(ids) {
  const all = sentAll(), now = Date.now();
  for (const id of ids) all[sentKey(id)] = now;
  const keys = Object.keys(all);
  if (keys.length > 500) for (const k of keys.sort((a, b) => all[a] - all[b]).slice(0, keys.length - 500)) delete all[k];
  writeJson(SENT_KEY, all);
  emit('t3-sent', ids);
}

// ---------- brief ----------
const labelOf = (key) => (L.sel?.key === key ? L.sel.entry?.label : null) || L.elements.find((e) => e.key === key)?.label || null;
const keysOf = (c) => [...new Set([c.el, c.comment && getComment(c.comment)?.el, ...(c.comments || []).map((id) => getComment(id)?.el)].filter(Boolean))];
const T3_MAX = 8; // attachments per T3 send (t3.send also caps at this)

/** Open comments of the current scene in time order (stable for equal t): the ids of the "all comments" brief. */
export const openCommentIds = () => liveComments().map((x, i) => [x, i]).filter(([x]) => (x.status || 'open') === 'open')
  .sort((a, b) => (a[0].t - b[0].t) || (a[1] - b[1])).map(([x]) => x.id);
/** Ask context for every open comment of the scene: one brief, `gfx context --comment <id>` per comment, in time order. */
export function allCommentsCtx(base = {}) {
  const ids = openCommentIds(), scene = S.name;
  return { ...base, source: 'comments', scene, comments: ids, comment: undefined, el: undefined, t: getComment(ids[0])?.t, label: `All ${ids.length} open comment${ids.length === 1 ? '' : 's'}`,
    extra: `Task: the ${ids.length} open comment${ids.length === 1 ? '' : 's'} above (${ids.map((id) => `c${commentNumber(id)}`).join(', ')}, in time order). Fix each in code, verify with gfx still/sheet, then resolve each one: gfx review ${scene} --resolve <id> --reply "…" (one call per comment, with a short reply saying what changed).` };
}

/** Live values for the values-json file: { key: { tag, cx, cy, scale, rot, opacity } } (shape of `gfx context --values-json`). */
async function liveValues(keys) {
  const out = {};
  let vals = {};
  if (keys.length && liveOn()) { try { vals = (await request('values', { keys }, 4000)) || {}; } catch { /* no values */ } }
  for (const k of keys) {
    const v = vals[k], tag = labelOf(k);
    out[k] = { ...(tag ? { tag } : {}), ...(v ? { cx: v.cx, cy: v.cy, scale: Math.abs(v.scaleX - v.scaleY) < 0.005 ? v.scaleX : (v.scaleX + v.scaleY) / 2, rot: v.rotate, opacity: v.opacity } : {}) };
  }
  return out;
}

function describeEl(key, v) {
  if (!v) return key;
  const act = [v.cx !== undefined ? `actual cx ${r2(v.cx)} cy ${r2(v.cy)}` : null, v.scale !== undefined ? `scale ${r2(v.scale)}` : null,
    v.rot !== undefined ? `rot ${r2(v.rot)}°` : null, v.opacity !== undefined ? `opacity ${r2(v.opacity)}` : null].filter(Boolean).join(' · ');
  return `${key}${v.tag ? ` — ${v.tag}` : ''}${act ? `  (${act})` : ''}`;
}

/** Same layout as `gfx context --format md`, built from studio state (used when the CLI is not available). */
async function clientBrief(c, t, els, tweaksOnDisk) {
  const scene = c.scene, current = scene === S.name, root = String(S.root).replace(/[\\/]+$/, '');
  let m = current ? S.meta : {};
  if (!current) { try { m = JSON.parse(await api.readText(`scenes/${scene}/scene.json`)) || {}; } catch { /* metadata unavailable */ } }
  const f = m.fps || 60;
  const out = [`## gfx context — ${scene} @ ${pad2(t)} (f${Math.round(t * f)} / ${Math.round((m.duration || 0) * f)}), ${m.width || "?"}x${m.height || "?"} @${f}, project ${root}`];
  for (const [k, v] of Object.entries(els)) out.push(`Selected: ${describeEl(k, v)}`);
  const tw = Object.entries(tweaksOnDisk || {});
  out.push(tw.length ? `Pending tweaks: ${tw.map(([k, v]) => `${k} { ${tweakSummary(v)} }`).join('; ')}   (draft, not applied)` : 'Pending tweaks: none');
  const comments = current ? (c.comment ? [getComment(c.comment)].filter(Boolean) : c.comments ? c.comments.map(getComment).filter(Boolean) : liveComments().filter((x) => x.status === 'open')) : [];
  if (comments.length) {
    out.push('Comments:');
    for (const x of comments) {
      out.push(`- c${commentNumber(x.id)} ${pad2(x.t)}${x.x != null ? ` @(${Math.round(x.x)},${Math.round(x.y)})` : ''}${x.el ? ` el=${x.el}` : ''}${x.cue ? ` cue=${x.cue}` : ''}: ${JSON.stringify(x.text || '')}  [${x.status || 'open'}]`);
      for (const a of [...(x.attachments || [])].sort((a, b) => (b.kind === 'markup') - (a.kind === 'markup'))) out.push(`  ${a.kind}: ${root}/${a.path}`);
      if (x.reply) out.push(`  reply: ${JSON.stringify(x.reply)}`);
    }
  } else out.push('Comments: none open');
  const files = [`scenes/${scene}/scene.js`, `scenes/${scene}/STORYBOARD.md`, `scenes/${scene}/SOUND.md`, `scenes/${scene}/sound.json`, `scenes/${scene}/tweaks.json`, `out/${scene}/review/draft.json`];
  const have = await Promise.all(files.map((p) => api.stat(p).then((s) => !!s, () => false)));
  out.push(`Files: ${files.filter((_, i) => have[i]).join(' · ')}`);
  out.push(`Workflow: read the markup PNGs first; fix in code; gfx still/sheet to verify; gfx review ${scene} --resolve <id> --reply "..."`);
  return out.join('\n');
}

async function buildBrief(c) {
  const scene = c.scene || S.name, current = scene === S.name;
  await flushNow().catch(() => {}); // the CLI reads comments.json
  const t = Number.isFinite(c.t) ? c.t : (current ? transport.time() : 0);
  const keys = current ? keysOf(c) : [], els = current ? await liveValues(keys) : {};
  const valuesRel = `out/${scene}/review/ctx-values.json`;
  let draftTweaks = {};
  try { draftTweaks = JSON.parse((await api.readText(`out/${scene}/review/draft.json`)) || '{}').tweaks || {}; } catch { /* none */ }
  let text = null;
  try {
    await api.writeText(valuesRel, JSON.stringify({ t, elements: els }, null, 2) + '\n');
    const args = ['context', scene, '--t', String(+t.toFixed(3)), ...keys.flatMap((k) => ['--el', k]), ...(c.comment ? ['--comment', c.comment] : []), ...(c.comments || []).flatMap((id) => ['--comment', id]), '--tweaks', '--values-json', valuesRel, '--format', 'md'];
    const { code, lines } = await api.engineCapture(args).done;
    const i = lines.findIndex((l) => l.startsWith('## gfx context'));
    if (code === 0 && i >= 0) { text = lines.slice(i).join('\n'); briefFrom = 'gfx context'; }
  } catch (e) { console.warn('gfx context:', e); }
  if (!text) { text = await clientBrief(c, t, els, draftTweaks); briefFrom = 'studio (gfx context unavailable)'; }
  const mem = current ? (S.draft?.tweaks || {}) : {};
  if (JSON.stringify(mem) !== JSON.stringify(draftTweaks) && Object.keys(mem).length) {
    text += `\nUnsaved studio tweaks (not in draft.json yet): ${Object.entries(mem).map(([k, v]) => `${k} { ${tweakSummary(v)} }`).join('; ')}`;
  }
  if (c.extra) text += '\n' + c.extra;
  return dropPlainFrames(text) + drawnPaths([c.comment, ...(c.comments || [])].filter(Boolean));
}

/** The comments' drawings as SVG path data in scene px (finding 26): exact input for paths the user drew, next to the image. */
function drawnPaths(ids) {
  const rows = [];
  for (const id of ids) {
    for (const st of getComment(id)?.strokes || []) {
      const d = strokePath(st);
      if (d) rows.push(`- path of ${id} (${st.tool}): ${d.length > 1500 ? d.slice(0, 1500) + ' …(cut)' : d}`);
    }
  }
  return rows.length ? `\n\nDrawn paths (scene px, SVG path data; the markup image shows the same drawing):\n${rows.slice(0, 40).join('\n')}` : '';
}

/** A comment with markup lists only its annotated frame (markup:), not also the plain frame: the markup PNG is that frame
 *  plus the drawing. Works on the brief text of `gfx context` and of clientBrief alike. */
function dropPlainFrames(text) {
  const lines = text.split('\n'), drop = new Set();
  let block = [], hasMarkup = false;
  const flush = () => { if (hasMarkup) for (const i of block) drop.add(i); block = []; hasMarkup = false; };
  lines.forEach((l, i) => {
    if (/^- c\d+ /.test(l) || !/^ {2}/.test(l)) flush();
    if (/^ {2}frame: /.test(l)) block.push(i);
    else if (/^ {2}markup: /.test(l)) hasMarkup = true;
  });
  flush();
  return lines.filter((_, i) => !drop.has(i)).join('\n');
}

// ---------- dialog ----------
function build() {
  dlg = document.createElement('div');
  dlg.id = 'ask-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal ask" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="ask-title">
    <div class="modal-head"><b id="ask-title">Ask Claude</b><span class="ask-src"></span><span class="spacer"></span><button type="button" class="link ask-x" title="Close (Esc)">&times;</button></div>
    <div class="ask-source" hidden><label>Brief about <select class="ask-src-sel" title="What the brief covers"></select></label></div>
    <div class="ask-brief-h"><span>Brief</span><small class="ask-from"></small><span class="spacer"></span><button type="button" class="link" data-a="rebuild" title="Build the brief again (current frame and values)">Refresh</button></div>
    <pre class="ask-brief" tabindex="0">Building brief…</pre>
    <textarea class="ask-msg" rows="4" placeholder="What should Claude do? (appended after the brief)"></textarea>
    <div class="ask-t3-err" role="alert" style="visibility:hidden"><span></span><button type="button" class="tbtn" data-a="t3-access" hidden title="Approve gfx studio at another access level (⚙ → T3)">Change access…</button></div>
    <div class="modal-foot">
      <label class="chk" title="Press Enter after pasting into the terminal"><input type="checkbox" class="ask-send"> Send immediately</label>
      <span class="spacer"></span>
      <button type="button" class="tbtn" data-a="copy" title="Copy brief + message">Copy</button>
      <span class="ask-t3"><select class="ask-t3-target" title="T3 thread to send to"></select>
        <label class="chk" title="Attach the annotated frame of each included comment that has markup; the plain frame at the playhead only when none has"><input type="checkbox" class="ask-att"> Frame + markup</label>
        <button type="button" class="tbtn" data-a="t3" title="Send to T3">&#9992; T3</button></span>
      <button type="button" class="primary" data-a="term" title="Paste into the Claude terminal (Ctrl+Enter)">Terminal</button>
    </div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.ask-x').onclick = close;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) close(); });
  dlg.querySelector('.ask-src-sel').onchange = (e) => { ctx = e.target.value === 'all' ? allCommentsCtx({ message: dlg.querySelector('.ask-msg').value }) : ctx0.source === 'comments' ? { source: 'scene', scene: ctx0.scene } : { ...ctx0 }; setSrcLabel(); refresh(); };
  dlg.querySelector('[data-a=rebuild]').onclick = () => refresh();
  dlg.querySelector('[data-a=copy]').onclick = copy;
  dlg.querySelector('[data-a=t3]').onclick = toT3;
  dlg.querySelector('[data-a=term]').onclick = toTerminal;
  dlg.querySelector('[data-a=t3-access]').onclick = () => { close(); t3.connect({ change: true }); };
  dlg.querySelector('.ask-t3-target').addEventListener('change', () => showT3Err(''));
  const send = dlg.querySelector('.ask-send');
  send.checked = !!pref('askSend'); // Settings → Claude & terminal
  send.onchange = () => setPref('askSend', send.checked, 'machine').catch((e) => emit('toast', { m: String(e.message || e), ms: 4000 }));
  const att = dlg.querySelector('.ask-att');
  att.checked = localStorage.getItem('gfx-studio.ask.t3att') !== '0';
  att.onchange = () => localStorage.setItem('gfx-studio.ask.t3att', att.checked ? '1' : '0');
}
function setSrcLabel() {
  const what = ctx.label || [SOURCE[ctx.source] || ctx.source, ctx.el ? `◎ ${ctx.el}` : '', ctx.comment ? `c${commentNumber(ctx.comment)}` : ''].filter(Boolean).join(' · ');
  dlg.querySelector('.ask-src').textContent = what;
}
/** Source choice: what the dialog was opened with, or every open comment of the scene (only with ≥1 open comment). */
function fillSources() {
  const n = openCommentIds().length, sel = dlg.querySelector('.ask-src-sel');
  const first = ctx0.source === 'comments' ? ['all', `All ${n} open comment${n === 1 ? '' : 's'}`] : ['self', ctx0.label || SOURCE[ctx0.source] || ctx0.source];
  const opts = [first];
  if (ctx0.source === 'comments') opts.push(['self', 'Scene (no comment focus)']);
  else if (n && ctx0.scene === S.name) opts.push(['all', `All ${n} open comment${n === 1 ? '' : 's'}`]);
  sel.innerHTML = opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('');
  sel.value = first[0];
  dlg.querySelector('.ask-source').hidden = opts.length < 2;
}
function close() { if (dlg) dlg.hidden = true; ctx = null; }
export const askOpen = () => !!dlg && !dlg.hidden;
export const closeAsk = close;
export const askToTerminal = () => toTerminal();
const fullText = () => { const msg = dlg.querySelector('.ask-msg').value.trim(); return msg ? `${brief}\n\n${msg}` : brief; };

async function refresh() {
  const my = ++seq, pre = dlg.querySelector('.ask-brief');
  brief = ''; pre.textContent = 'Building brief…'; pre.classList.add('busy');
  dlg.querySelector('.ask-from').textContent = '';
  setButtons();
  try {
    const b = await buildBrief(ctx);
    if (my !== seq || !ctx) return;
    brief = b; pre.textContent = b;
    dlg.querySelector('.ask-from').textContent = `from ${briefFrom}`; dlg.querySelector('.ask-from').title = `from ${briefFrom}`;
  } catch (e) { if (my === seq) pre.textContent = 'Could not build the brief: ' + (e.message || e); }
  if (my === seq) { pre.classList.remove('busy'); setButtons(); roundSurfaceOrigin(dlg); }
}
function setButtons() {
  const ready = !!brief && !busy;
  dlg.querySelector('[data-a=copy]').disabled = !ready;
  dlg.querySelector('[data-a=term]').disabled = !ready;
  const b = dlg.querySelector('[data-a=t3]'), st = t3.t3Status(), op = t3.canOperate();
  b.disabled = !ready || (!!st?.connected && !op);
  b.classList.toggle('unset', !st?.connected);
  b.title = !st?.connected ? 'Connect T3 first (opens the T3 panel)' : op ? 'Send to the chosen T3 thread' : 'Sending needs Standard or Full access (⚙ → Integrations → Change access…)';
  dlg.querySelector('.ask-t3-target').disabled = !st?.connected || !op || busy;
}
/** Target choices: the thread open in the T3 panel (default), other threads of this project, New thread. Threads that run
 *  above gfx's access are listed disabled, with a tooltip that says why (T3 would refuse the send). */
function fillTargets() {
  const sel = dlg.querySelector('.ask-t3-target'), c = t3.choices();
  const cut = (x) => (x.length > 38 ? x.slice(0, 37) + '…' : x);
  const opts = [];
  const add = (tid, label) => { const why = t3.sendBlocked(tid); opts.push([tid, why ? `${label} (above gfx's access)` : label, why]); };
  if (c.open) add(c.open.threadId, `Open thread: ${cut(c.open.title || c.open.threadId)}`);
  for (const t of c.threads) if (t.threadId !== c.open?.threadId) add(t.threadId, cut(t.title || t.threadId));
  opts.push(['new', 'New thread', '']);
  const prev = sel.value;
  sel.innerHTML = opts.map(([v, l, why]) => `<option value="${esc(v)}"${why ? ` disabled title="${esc(why)}"` : ''}>${esc(l)}</option>`).join('');
  const usable = opts.filter(([, , why]) => !why);
  sel.value = usable.some(([v]) => v === prev) && prev !== 'new' ? prev : usable[0][0];
}
/** A T3 send error under the message (T3's message, never raw JSON); Change access… when the thread is above gfx's level. */
function showT3Err(msg, code) {
  const box = dlg.querySelector('.ask-t3-err');
  box.hidden = false; box.style.visibility = msg ? '' : 'hidden';
  box.querySelector('span').textContent = msg || '';
  box.querySelector('[data-a=t3-access]').hidden = code !== ESCALATION;
}

export async function openAsk(c = {}) {
  if (!S.name || !S.meta) { emit('toast', { m: 'Open a scene first', ms: 2000 }); return; }
  if (!dlg) build();
  dlg.querySelector('.ask-send').checked = !!pref('askSend'); // Settings → Claude & terminal may have changed it
  ctx = { source: 'scene', ...c, scene: c.scene || S.name };
  if (ctx.source === 'comments' && !ctx.comments) ctx = allCommentsCtx(ctx);
  ctx0 = { ...ctx };
  setSrcLabel();
  fillSources();
  const msg = dlg.querySelector('.ask-msg');
  msg.value = ctx.message || '';
  dlg.hidden = false;
  roundSurfaceOrigin(dlg);
  msg.focus();
  showT3Err('');
  fillTargets();
  if (t3.t3Status()?.connected) t3.refresh().then(() => { if (askOpen()) { fillTargets(); setButtons(); } }).catch(() => {});
  refresh();
}

async function toTerminal() {
  if (!brief || busy) return;
  const text = fullText(), send = dlg.querySelector('.ask-send').checked;
  busy = true; setButtons();
  try {
    const msg = dlg.querySelector('.ask-msg').value.trim() || ctx?.label || '';
    close();
    await beforeAsk(msg); // auto checkpoint (docs/CODE-VERSIONS.md §4)
    await sendToClaude(text, { send });
    emit('toast', { m: send ? 'Sent to Claude in the terminal' : 'Pasted into the Claude terminal: review it and press Enter', ms: 3000 });
  } catch (e) { emit('toast', { m: 'Terminal: ' + (e.message || e), ms: 5000 }); }
  busy = false;
}

/** The frame at the playhead as a PNG under out/<scene>/review/t3/ (JPEG if the PNG would be too big for T3). */
async function grabPlayhead(scene) {
  const v = transport.video;
  if (scene !== S.name || !v || !v.src || !v.videoWidth || v.readyState < 2 || !S.meta) return null;
  const cv = document.createElement('canvas');
  cv.width = S.meta.width; cv.height = S.meta.height;
  cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
  const f = Math.round(transport.time() * (S.meta.fps || 60));
  let blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  let ext = 'png';
  if (!blob || blob.size > 9.5 * 1024 * 1024) { blob = await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.92)); ext = 'jpg'; }
  if (!blob) return null;
  const rel = `out/${scene}/review/t3/frame-f${f}.${ext}`;
  await api.writeBytes(rel, new Uint8Array(await blob.arrayBuffer()));
  return rel;
}
/** Comments in the brief: the one asked about, else every open comment of the scene. */
const includedComments = (c) => (c.scene !== S.name ? [] : c.comments ? c.comments.map(getComment).filter(Boolean) : c.comment ? [getComment(c.comment)].filter(Boolean) : liveComments().filter((x) => (x.status || 'open') === 'open'));

async function toT3() {
  if (!brief || busy) return;
  if (!t3.t3Status()?.connected) { close(); emit('open-t3'); t3.connect(); return; }
  const message = dlg.querySelector('.ask-msg').value.trim();
  const target = dlg.querySelector('.ask-t3-target').value || 'new';
  const withAtt = dlg.querySelector('.ask-att').checked;
  const comments = ctx.comments ? includedComments(ctx).map((x) => x.id) : ctx.comment ? [ctx.comment] : [];
  const text = fullText(), scene = ctx.scene;
  const title = (message.split('\n')[0] || ctx.label || `${scene} @ ${pad2(Number.isFinite(ctx.t) ? ctx.t : transport.time())}`).slice(0, 80);
  busy = true; setButtons(); showT3Err('');
  const b = dlg.querySelector('[data-a=t3]'), label = b.innerHTML;
  b.innerHTML = '<i class="spin" aria-hidden="true"></i> T3'; b.title = 'Sending…'; // same width: the footer keeps its place
  try {
    await beforeAsk(message || ctx.label || '');
    const atts = [];
    let note = '';
    if (withAtt && ctx.comments) {
      // All-comments brief: one image per comment, in time order — the annotated frame when it has markup, else its frame.
      const per = includedComments(ctx).map((x) => { const a = x.attachments.find((q) => q.kind === 'markup') || x.attachments.find((q) => q.kind === 'frame'); return a ? `out/${scene}/review/${a.path}` : null; }).filter(Boolean);
      atts.push(...per.slice(0, T3_MAX));
      const rest = per.slice(T3_MAX);
      note = `Attached: one image per comment (${atts.length} of ${comments.length}; the annotated frame when the comment has markup, else its frame), in time order.`
        + (rest.length ? `\nNot attached (T3 takes at most ${T3_MAX} images), open these files:\n${rest.map((p) => `- ${String(S.root).replace(/[\\/]+$/, '')}/${p}`).join('\n')}` : '');
    } else if (withAtt) {
      // One image per comment with markup: the annotated frame (frame + drawing). The plain playhead frame only when no comment has markup.
      for (const c of includedComments(ctx)) for (const a of c.attachments || []) if (a.kind === 'markup') atts.push(`out/${scene}/review/${a.path}`);
      if (atts.length) note = `Attached image${atts.length > 1 ? 's' : ''}: the annotated frame${atts.length > 1 ? 's' : ''} (frame with the markup drawn on it), not the plain frame.`;
      else {
        try { const f = await grabPlayhead(scene); if (f) { atts.push(f); note = 'Attached image: the plain frame at the playhead (no markup).'; } } catch (e) { console.warn('frame for T3:', e); }
      }
    }
    const r = await t3.send({ target, message: note ? `${text}\n\n${note}` : text, title, attachments: atts.slice(0, 8) });
    if (comments.length) markSent(comments);
    const extra = r.attached ? ` · ${r.attached} image${r.attached > 1 ? 's' : ''}` : '';
    emit('toast', { m: `Sent to T3: ${r.title}${extra}${r.skipped.length ? ` (skipped ${r.skipped.join('; ')})` : ''}`, ms: r.skipped.length ? 6000 : 3000 });
    close();
  } catch (e) {
    const m = String(e.message || e);
    if (dlg && !dlg.hidden) showT3Err(m, e.code); // the dialog stays open: Change access… or pick another target
    emit('toast', { m: 'Send to T3 failed: ' + m, ms: 7000 });
  }
  b.innerHTML = label; busy = false; // setButtons restores the title
  if (dlg && !dlg.hidden) setButtons();
}

async function copy() {
  const text = fullText(), msg = dlg.querySelector('.ask-msg').value.trim() || ctx?.label || '';
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  emit('toast', { m: ok ? 'Brief copied' : 'Clipboard not available', ms: ok ? 1500 : 2500 });
  beforeAsk(msg); // the user is about to hand it to Claude somewhere: checkpoint first
}

export function initAsk() {
  on('ask-claude', (c) => openAsk(c));
  on('scene', close);
}
export { esc };
