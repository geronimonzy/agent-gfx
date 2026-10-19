// gfx context <scene> ... : compact brief for Claude (docs/CLAUDE-IN-APP.md §2). Reuses the review.js loaders.
import fs from 'node:fs';
import path from 'node:path';
import * as RV from '../../review.js';
import { projectRoot } from '../../paths.js';
import { die, listArg, loadMeta, readJson } from '../util.js';

const r2 = (v) => +Number(v).toFixed(2);
const pad2 = (t) => (Math.round(t * 100) / 100).toFixed(2).padStart(5, '0');

/** values-json: `{ t?, elements: { key: { tag, text, cx, cy, scale, rot, opacity } } }` or the bare key map. */
function loadValues(file) {
  if (!file) return { t: undefined, els: {} };
  let j;
  try { j = readJson(path.resolve(file)); } catch (e) { die(`--values-json ${file}: ${e.message}`); }
  const els = j.elements || j.el || (j.t === undefined ? j : {});
  return { t: Number.isFinite(j.t) ? j.t : undefined, els: els && typeof els === 'object' ? els : {} };
}

/** Enabled sound sources with entry counts + licences (no index contents), or null without a readable library. */
async function soundLibrary() {
  try {
    const C = await import('../../library/config.js');
    return C.loadSources().sources.filter((s) => s.enabled).map((s) => ({ id: s.id, entries: C.indexCount(s), license: s.license || 'unspecified' }));
  } catch { return null; }
}
const FIND_SOUNDS = 'find sounds: gfx lib search "<text>" --json / gfx lib similar <scene>:<cue> --json';

function describeEl(key, v) {
  if (!v) return key;
  const what = [v.tag, v.text !== undefined && v.text !== null ? JSON.stringify(String(v.text).slice(0, 60)) : null].filter(Boolean).join(' ');
  const act = [
    v.cx !== undefined && v.cy !== undefined ? `actual cx ${r2(v.cx)} cy ${r2(v.cy)}` : null,
    v.scale !== undefined ? `scale ${r2(v.scale)}` : null,
    v.rot !== undefined ? `rot ${r2(v.rot)}°` : null,
    v.opacity !== undefined ? `opacity ${r2(v.opacity)}` : null,
  ].filter(Boolean).join(' · ');
  return `${key}${what ? ` — ${what}` : ''}${act ? `  (${act})` : ''}`;
}

export async function cmdContext(name, o) {
  const meta = loadMeta(name);
  const root = projectRoot();
  const fps = meta.fps || 60;
  if (o.format && !['md', 'json'].includes(o.format)) die('--format must be md or json');
  const vals = loadValues(o['values-json']);
  const els = listArg(o.el);
  const visible = RV.visibleComments(RV.readComments(name));
  const ids = listArg(o.comment);
  const comments = ids.length
    ? ids.map((id) => visible.find((c) => c.id === id) || die(`no comment "${id}" in ${name}`))
    : visible.filter((c) => c.status === 'open' || !c.status);
  // moment: --t, else the values-json time, else the first picked comment's, else 0
  let t = o.t !== undefined ? Number(o.t) : vals.t;
  if (t === undefined) t = ids.length && Number.isFinite(comments[0]?.t) ? comments[0].t : 0;
  if (!Number.isFinite(t)) die(`bad --t "${o.t}"`);
  const frame = Math.round(t * fps), total = Math.round((meta.duration || 0) * fps);
  if (ids.length) for (const c of comments) if (c.el && !els.includes(c.el)) els.push(c.el);

  const sum = RV.summarizeDraft(RV.readDraft(name));
  const tweaks = Object.entries(sum.tweaks);
  const comm = comments.map((c) => ({ ...c, attachments: RV.absAttachments(c, name) }));
  const files = [`scenes/${name}/scene.js`, `scenes/${name}/STORYBOARD.md`, `scenes/${name}/SOUND.md`, `scenes/${name}/sound.json`, `scenes/${name}/tweaks.json`, `out/${name}/review/draft.json`]
    .filter((f) => fs.existsSync(path.join(root, f)));

  const lib = await soundLibrary();
  if (o.format === 'json') {
    console.log(JSON.stringify({
      scene: name, project: root, t, frame, frames: total, width: meta.width, height: meta.height, fps,
      selected: els.map((k) => ({ key: k, ...(vals.els[k] || {}) })),
      pendingTweaks: sum.tweaks,
      pendingAudio: sum.audio ? { stems: sum.stems, cues: sum.cues, add: sum.add } : null,
      comments: comm, files, soundLibrary: lib,
    }, null, 2));
    return;
  }
  const out = [`## gfx context — ${name} @ ${pad2(t)} (f${frame} / ${total}), ${meta.width}x${meta.height} @${fps}, project ${root}`];
  for (const k of els) out.push(`Selected: ${describeEl(k, vals.els[k])}`);
  if (tweaks.length) out.push(`Pending tweaks: ${tweaks.map(([k, v]) => `${k} { ${RV.fmtTweak(v)} }`).join('; ')}   (draft, not applied)`);
  else if (o.tweaks) out.push('Pending tweaks: none');
  if (sum.audio) out.push(`Pending audio edits: ${sum.stems} stem, ${sum.cues} cue, ${sum.add} added   (draft, not applied)`);
  if (comm.length) {
    out.push('Comments:');
    for (const c of comm) {
      const where = Number.isFinite(c.x) && Number.isFinite(c.y) ? ` @(${Math.round(c.x)},${Math.round(c.y)})` : '';
      out.push(`- ${c.id} ${Number.isFinite(c.t) ? pad2(c.t) : '--'}${where}${c.el ? ` el=${c.el}` : ''}${c.cue ? ` cue=${c.cue}` : ''}: ${JSON.stringify(c.text || '')}  [${c.status || 'open'}]`);
      for (const a of [...c.attachments].sort((a, b) => (b.kind === 'markup') - (a.kind === 'markup'))) out.push(`  ${a.kind}: ${a.path}`);
      if (c.reply) out.push(`  reply: ${JSON.stringify(c.reply)}`);
    }
  } else out.push('Comments: none open');
  out.push(`Files: ${files.join(' · ')}`);
  if (lib) out.push(`Sound library: ${lib.length ? lib.map((s) => `${s.id} (${s.entries || 'not indexed'}, ${s.license})`).join(', ') : 'no enabled sources'} · ${FIND_SOUNDS}`);
  out.push(`Workflow: read the markup PNGs first; fix in code; gfx still/sheet to verify; gfx review ${name} --resolve <id> --reply "..."`);
  console.log(out.join('\n'));
}
