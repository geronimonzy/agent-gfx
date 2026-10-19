// gfx template list | preview | save | remove (docs/TEMPLATES.md §3). `--for <folder>` is only for the studio's routing
// (lib.rs spec_for: the engine of that folder runs the command); the engine ignores it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ENGINE, engineVersion, projectRoot, projectConfig, readJson } from '../../paths.js';
import { die } from '../util.js';
import { progress, isJson } from '../progress.js';
import { ffmpegPath, runFfmpeg } from '../../ffmpeg.js';
import {
  BUILTIN_DIR, ID_RE, describe, gfxKeys, listTemplates, resolveTemplate, scenesIn, slugId, thumbDataUrl, userTemplatesDir, setTemplateLibrary,
} from '../../templates.js';

const USAGE = 'usage: gfx template list [--json] | preview <ref> | save [--scene <name>] [--name "Title"] [--id <id>] [--description ".."] [--t <sec>] [--no-preview] [--force] | remove <ref>';
const PREVIEW_LONG_SIDE = 480, PREVIEW_MAX_S = 6, PREVIEW_FPS = 24;

export async function cmdTemplate(sub, o, pos = []) {
  setTemplateLibrary(o.library); // --library <Library folder>: user templates in <library>/templates
  if (sub === 'list') return list(o);
  if (sub === 'preview') return preview(pos[1], o);
  if (sub === 'save') return save(o);
  if (sub === 'remove') return remove(pos[1], o);
  die(USAGE);
}

const publicView = (t) => {
  const { thumbFile, gfx, ...rest } = t;
  return rest;
};

function list(o) {
  const all = listTemplates();
  if (o.json) { console.log(JSON.stringify(all.map((t) => ({ ...publicView(t), thumb: thumbDataUrl(t) })))); return []; }
  const w = Math.max(4, ...all.map((t) => t.ref.length));
  for (const t of all) {
    const size = t.width ? `${t.aspect} ${t.width}x${t.height}${t.duration != null ? ` ${t.duration}s` : ''}` : 'empty';
    console.log(`${t.ref.padEnd(w)}  ${t.title}  (${size})${t.preview ? '  [preview]' : ''}${t.legacy ? `  [old folder, read-only: ${path.dirname(t.dir)}]` : ''}`);
  }
  console.log(`user templates: ${userTemplatesDir()}`);
  return [];
}

function preview(ref, o) {
  if (!ref) die('usage: gfx template preview <ref>');
  const t = resolveTemplate(ref);
  if (!t) die(`unknown template "${ref}"`);
  const f = path.join(t.dir, 'preview.mp4');
  if (!fs.existsSync(f)) die(`template "${ref}" has no preview clip`);
  const b = fs.readFileSync(f);
  if (b.length > 8 * 1024 * 1024) die(`the preview clip of "${ref}" is too big (${(b.length / 1e6).toFixed(1)} MB)`);
  console.log(JSON.stringify({ ref: t.ref, mime: 'video/mp4', data: b.toString('base64') }));
  return [f];
}

function remove(ref, o) {
  if (!ref) die('usage: gfx template remove user/<id>');
  const t = resolveTemplate(ref.startsWith('user/') ? ref : `user/${ref}`);
  if (!t || t.source !== 'user') die(`no user template "${ref}" (built-in templates can't be removed)`);
  if (t.legacy) die(`"${t.ref}" is in the old template folder ${path.dirname(t.dir)}, which gfx only reads; delete it there, or move it into ${userTemplatesDir()}`);
  fs.rmSync(t.dir, { recursive: true, force: true });
  if (o.json) console.log(JSON.stringify({ removed: t.ref, dir: t.dir }));
  else console.log(`removed template ${t.ref} (${t.dir})`);
  return [];
}

/** Run this engine's CLI on `project` (thumbnail / clip); resolves with { code, err }. */
function gfxChild(args, project) {
  return new Promise((resolve) => {
    const env = { ...process.env, GFX_PROJECT: project };
    const ch = spawn(process.execPath, [path.join(ENGINE, 'runner', 'cli.js'), ...args], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    let err = '';
    ch.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    ch.on('error', (e) => resolve({ code: -1, err: e.message }));
    ch.on('close', (code) => resolve({ code, err }));
  });
}

/** A status line on stderr when no `--progress json` consumer is listening (long renders must not look hung). */
export const phaseLine = (msg) => { if (!isJson()) console.error(`gfx: ${msg}`); };
const secs = (t0) => `${((Date.now() - t0) / 1000).toFixed(1)} s`;
const even = (x) => Math.max(2, Math.round(x / 2) * 2);

/** `gfx still|render` for a preview: Fast mode (GPU raster; previews need no byte identity), Exact once more if it fails. */
async function previewChild(args, project) {
  const r = await gfxChild([...args, '--mode', 'fast'], project);
  return r.code === 0 ? r : gfxChild([...args, '--mode', 'exact'], project);
}

/**
 * thumb.jpg (else thumb.png) + preview.mp4 of `scene` into `dir`; warnings for what failed. Both are captured larger
 * than the output (thumb at up to 4x = full size for 1080p, clip at 2x) and downscaled with ffmpeg `flags=area`, so
 * hairlines and 1 px grids average into the small image instead of vanishing. Output: long side 480 px, clip 24 fps,
 * <= 6 s, H.264 CRF 30, silent. Without ffmpeg: a thumb.png captured at the output size, no clip.
 */
export async function makePreview(project, scene, dir, { t, clip = true } = {}) {
  const meta = readJson(path.join(project, 'scenes', scene, 'scene.json'), {});
  const W = meta.width || 1920, H = meta.height || 1080, dur = Number(meta.duration) || 4;
  const k = +(PREVIEW_LONG_SIDE / Math.max(W, H)).toFixed(4);
  const ow = even(W * k), oh = even(H * k);
  const at = t !== undefined ? Math.min(Math.max(0, Number(t)), dur) : +(dur * 0.8).toFixed(2);
  const ff = !!ffmpegPath();
  const warn = [];
  const last = (r) => r.err.trim().split('\n').pop() || `exit ${r.code}`;
  progress('thumbnail', 0, 1);
  let t0 = Date.now();
  const kt = ff ? Math.min(1, +(k * 4).toFixed(4)) : k;
  phaseLine(`preview: thumbnail at t=${at}s (${Math.round(W * kt)}x${Math.round(H * kt)} -> ${ow}x${oh})...`);
  const png = path.join(dir, ff ? '.thumb-full.png' : 'thumb.png');
  const s = await previewChild(['still', scene, '--t', String(at), '--scale', String(kt), '--out', png], project);
  if (s.code !== 0 || !fs.existsSync(png)) warn.push(`no thumbnail (gfx still failed: ${last(s)})`);
  else if (ff) {
    try { await runFfmpeg(['-y', '-i', png, '-vf', `scale=${ow}:${oh}:flags=area`, '-q:v', '4', path.join(dir, 'thumb.jpg')]); } catch (e) {
      // keep a png at the output size rather than nothing
      try { await runFfmpeg(['-y', '-i', png, '-vf', `scale=${ow}:${oh}:flags=area`, path.join(dir, 'thumb.png')]); } catch { warn.push(`no thumbnail (ffmpeg: ${String(e.message || e).split('\n').pop()})`); }
    }
    fs.rmSync(png, { force: true });
  }
  phaseLine(`preview: thumbnail done (${secs(t0)})`);
  progress('thumbnail', 1, 1);
  if (clip) {
    progress('preview', 0, 1);
    t0 = Date.now();
    const mp4 = path.join(dir, 'preview.mp4');
    const len = Math.min(dur, PREVIEW_MAX_S);
    if (!ff) warn.push('no preview clip (ffmpeg not found: gfx setup ffmpeg)');
    else {
      const kc = Math.min(1, +(k * 2).toFixed(4));
      const big = path.join(dir, '.preview-big.mp4');
      phaseLine(`preview: clip ${len}s @${PREVIEW_FPS}fps = ${Math.round(len * PREVIEW_FPS)} frames (${Math.round(W * kc)}x${Math.round(H * kc)} -> ${ow}x${oh})...`);
      const r = await previewChild(['render', scene, '--scale', String(kc), '--fps', String(PREVIEW_FPS), '--dur', String(len), '--crf', '12', '--out', big], project);
      if (r.code !== 0 || !fs.existsSync(big)) warn.push(`no preview clip (gfx render failed: ${last(r)})`);
      else {
        try {
          await runFfmpeg(['-y', '-i', big, '-an', '-vf', `scale=${ow}:${oh}:flags=area`, '-c:v', 'libx264', '-crf', '30', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', String(PREVIEW_FPS), '-movflags', '+faststart', mp4]);
        } catch (e) { warn.push(`no preview clip (ffmpeg downscale failed: ${String(e.message || e).split('\n').pop()})`); fs.rmSync(mp4, { force: true }); }
      }
      fs.rmSync(big, { force: true });
      phaseLine(`preview: clip ${fs.existsSync(mp4) ? 'done' : 'failed'} (${secs(t0)})`);
    }
    progress('preview', 1, 1);
  }
  return { t: at, warn };
}

async function save(o) {
  const root = projectRoot();
  const cfg = projectConfig(root);
  const scenes = scenesIn(root);
  const one = o.scene;
  if (one !== undefined && !scenes.includes(one)) die(`scene "${one}" not found in ${path.join(root, 'scenes')}`);
  if (!scenes.length) die(`no scenes to save in ${root} (a template needs at least one scene)`);
  const sj = one ? readJson(path.join(root, 'scenes', one, 'scene.json'), {}) : {};
  const title = String(o.name || (one ? sj.title || one : cfg.name || path.basename(root))).trim();
  const id = o.id || slugId(title);
  if (!ID_RE.test(id)) die(`template id "${id}" is not valid (lowercase letters, digits and -, up to 48; pass --id)`);
  if (fs.existsSync(path.join(BUILTIN_DIR, id))) die(`"${id}" is a built-in template name: choose another name (--name or --id)`);
  const lib = userTemplatesDir();
  const dest = path.join(lib, id);
  if (fs.existsSync(dest) && !o.force) die(`template "${id}" already exists in ${lib} (use --force to replace it)`);

  progress('copy', 0, 1);
  const tmp = path.join(lib, `${id}.tmp`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(path.join(tmp, 'scenes'), { recursive: true });
  for (const sc of one ? [one] : scenes) fs.cpSync(path.join(root, 'scenes', sc), path.join(tmp, 'scenes', sc), { recursive: true });
  if (fs.existsSync(path.join(root, 'style'))) fs.cpSync(path.join(root, 'style'), path.join(tmp, 'style'), { recursive: true });
  const gfx = gfxKeys(cfg);
  if (gfx?.look && fs.existsSync(path.join(root, 'looks', gfx.look))) fs.cpSync(path.join(root, 'looks', gfx.look), path.join(tmp, 'looks', gfx.look), { recursive: true });
  if (!one && fs.existsSync(path.join(root, 'looks'))) fs.cpSync(path.join(root, 'looks'), path.join(tmp, 'looks'), { recursive: true });
  progress('copy', 1, 1);

  const pv = one || scenes[0];
  let pt = o.t !== undefined ? Number(o.t) : undefined, warn = [];
  if (!o['no-preview']) ({ t: pt, warn } = await makePreview(root, pv, tmp, { t: pt }));
  const ver = engineVersion().split('.');
  const meta = {
    version: 1, title,
    ...(o.description ? { description: String(o.description) } : {}),
    preview: { scene: pv, ...(pt !== undefined && Number.isFinite(pt) ? { t: pt } : {}) },
    ...(gfx ? { gfx } : {}),
    engine: `>=${ver[0]}.${ver[1]}`, created: new Date().toISOString(),
    from: { project: cfg.name || path.basename(root), ...(one ? { scene: one } : {}) },
  };
  fs.writeFileSync(path.join(tmp, 'template.json'), JSON.stringify(meta, null, 2) + '\n');
  // swap in (an existing one only with --force, checked above)
  if (fs.existsSync(dest)) {
    const old = path.join(lib, `${id}.old.tmp`);
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(dest, old);
    fs.renameSync(tmp, dest);
    fs.rmSync(old, { recursive: true, force: true });
  } else fs.renameSync(tmp, dest);
  for (const w of warn) console.error(`gfx: warning: ${w}`);
  const t = describe(dest, 'user');
  if (o.json && !isJson()) console.log(JSON.stringify({ ...publicView(t), warnings: warn }));
  else if (!isJson()) console.log(`saved template ${t.ref} ("${title}", ${t.scenes.length} scene${t.scenes.length === 1 ? '' : 's'}${t.preview ? ', with preview' : ''}) in ${dest}\nnew project: gfx init <dir> --template ${t.ref}`);
  return [dest];
}
