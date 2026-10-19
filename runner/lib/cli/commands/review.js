// gfx review | apply (docs/REVIEW.md §2).
import fs from 'node:fs';
import path from 'node:path';
import * as RV from '../../review.js';
import { projectRoot } from '../../paths.js';
import { openCapture, shot, seek } from '../capture.js';
import { die, listArg, loadMeta } from '../util.js';
import { autoSave } from '../../version.js';

const pad = (n, w) => String(n).padStart(w, '0');

async function renderExactStills(name, comments, draftTweaks) {
  const { meta, page } = await openCapture(name);
  const dir = path.join(RV.reviewDir(name), 'shots');
  fs.mkdirSync(dir, { recursive: true });
  await page.evaluate((tw) => window.__gfx.setTweaks(tw), draftTweaks || {});
  const out = {};
  for (const c of comments) {
    const t = Number.isFinite(c.frame) ? c.frame / meta.fps : c.t;
    await seek(page, t);
    const file = path.join(dir, `${c.id}-exact.png`);
    fs.writeFileSync(file, await shot(page, meta));
    out[c.id] = file;
  }
  return out;
}

export async function cmdReview(name, o) {
  const meta = loadMeta(name);
  const ids = { resolved: listArg(o.resolve), wontfix: listArg(o.wontfix), open: listArg(o.reopen) };
  const todo = Object.entries(ids).filter(([, v]) => v.length);
  if (todo.length) {
    for (const [status, list] of todo) {
      let up;
      try { up = RV.setStatus(name, list, status, o.reply); } catch (e) { die(e.message); }
      for (const c of up) console.log(`${c.id}  -> ${status}${c.reply ? `  "${c.reply}"` : ''}`);
    }
    return;
  }
  const file = RV.readComments(name);
  const all = RV.visibleComments(file);
  const list = all.filter((c) => o.all || c.status === 'open' || !c.status)
    .sort((a, b) => (a.t ?? Infinity) - (b.t ?? Infinity) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const draft = RV.readDraft(name);
  let exact = {};
  if (o.stills) {
    const pins = list.filter((c) => (c.status === 'open' || !c.status) && Number.isFinite(c.x) && Number.isFinite(c.y));
    if (pins.length) exact = await renderExactStills(name, pins, draft && draft.tweaks);
  }
  const sum = RV.summarizeDraft(draft);
  if (o.json) {
    const comments = list.map((c) => ({ ...c, attachments: RV.absAttachments(c, name), ...(exact[c.id] ? { exact: exact[c.id] } : {}) }));
    console.log(JSON.stringify({ scene: name, comments, draft: draft ? { stems: draft.stems || {}, cues: draft.cues || {}, add: draft.add || [], tweaks: draft.tweaks || {} } : null }, null, 2));
    return;
  }
  if (!list.length) console.log(o.all ? '(no comments)' : '(no open comments)');
  for (const c of list) {
    const when = Number.isFinite(c.t) ? `${pad(c.t.toFixed(2), 5)} f${c.frame ?? Math.round(c.t * meta.fps)}` : '--';
    const where = Number.isFinite(c.x) && Number.isFinite(c.y) ? `@(${Math.round(c.x)},${Math.round(c.y)})` : '@-';
    const st = c.status && c.status !== 'open' ? `  [${c.status}]` : '';
    console.log(`${c.id.padEnd(4)} ${when}  ${where}${c.el ? ` el=${c.el}` : ''}${c.cue ? ` cue=${c.cue}` : ''}  ${JSON.stringify(c.text || '')}${st}`);
    if (c.reply) console.log(`     reply: ${c.reply}`);
    const atts = RV.absAttachments(c, name);
    atts.sort((a, b) => (a.kind === 'markup' ? -1 : 0) - (b.kind === 'markup' ? -1 : 0));
    for (const a of atts) console.log(`     ${a.kind}: ${a.path}`);
    if (c.strokes && c.strokes.length) console.log(`     strokes: ${c.strokes.map((s) => s.tool).join(', ')}`);
    if (exact[c.id]) console.log(`     exact: ${exact[c.id]}`);
  }
  if (sum.audio || Object.keys(sum.tweaks).length) {
    console.log('\npending draft (not yet applied; `gfx apply ' + name + '`):');
    if (sum.audio) console.log(`  audio: ${sum.stems} stem, ${sum.cues} cue override, ${sum.add} added cue`);
    for (const [k, tw] of Object.entries(sum.tweaks)) console.log(`  tweak ${k}: ${RV.fmtTweak(tw)}`);
  }
}

export async function cmdApply(name, o) {
  loadMeta(name);
  // checkpoint first so the apply can be undone from the Versions panel (only for projects that have a history)
  const saved = autoSave(projectRoot(), `Before apply ${name}`, { scene: name });
  if (saved) console.log(`saved version ${saved.short} before applying`);
  const both = !o.tweaks && !o.sound;
  const rel = (f) => path.relative(projectRoot(), f);
  let any = false;
  if (both || o.tweaks) {
    const r = RV.applyTweaks(name);
    any = any || r.count > 0;
    console.log(r.count ? `tweaks -> ${rel(r.file)} (${r.changes.length} changed)` : 'tweaks: nothing in draft');
    for (const c of r.changes) console.log('  ' + c);
  }
  if (both || o.sound) {
    const r = RV.applySound(name);
    any = any || r.count > 0;
    console.log(r.count ? `sound -> ${rel(r.file)} (${r.count} edits)` : 'sound: nothing in draft');
    for (const c of r.changes) console.log('  ' + c);
  }
  if (any) console.log(`applied; re-run \`gfx render ${name}\` / \`gfx audio ${name}\` to refresh the outputs (comments untouched)`);
}

