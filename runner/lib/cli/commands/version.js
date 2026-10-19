// gfx version init | status | save | log | diff | restore (docs/CODE-VERSIONS.md §2) | export | preview (docs/VISUAL-DIFF.md §2).
// Logic lives in lib/version.js and lib/vdiff.js.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as V from '../../version.js';
import { projectRoot } from '../../paths.js';
import { cleanups, die, num } from '../util.js';
import { isJson } from '../progress.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'cli.js');
const USAGE = 'usage: gfx version init | status | save [-m note] [--actor user|claude|auto] [--thumb scene@t] | log [--limit n] [--path p] | diff <a> [<b>|--worktree] [--path p] | restore <sha> [--path p]... | export <rev> --out <dir> | preview <rev|now> [--port p] [--idle s]  (add --json)';

/** `--thumb scene@t` -> { scene, t } (t in seconds). */
function parseThumb(s) {
  const m = /^([\w.-]+)@(\d+(?:\.\d+)?|\.\d+)$/.exec(String(s));
  if (!m) die('--thumb expects <scene>@<seconds>, e.g. reel@1.5');
  return { scene: m[1], t: Number(m[2]) };
}

/** Render a still into .gfx/thumbs/<sha>.png (gitignored cache). Failure only warns: the version is already saved. */
function makeThumb(root, sha, { scene, t }) {
  const out = V.thumbPath(root, sha);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(process.execPath, [CLI, 'still', scene, '--t', String(t), '--out', out, '--project', root], { encoding: 'utf8', timeout: 120000 });
  if (r.status === 0 && fs.existsSync(out)) return path.relative(root, out).split(path.sep).join('/');
  console.error(`gfx: thumbnail failed (${(r.stderr || r.stdout || '').trim().split('\n').pop() || `exit ${r.status}`})`);
  return null;
}

const wrap = (fn) => { try { return fn(); } catch (e) { if (e.code === 'GFX_VERSION') die(e.message); throw e; } };
const print = (o, json, human) => { if (json) console.log(JSON.stringify(o, null, 2)); else console.log(human); };

export async function cmdVersion(sub, o, positionals = []) {
  const root = projectRoot();
  const allowEngine = !!o['allow-engine'];
  const rest = positionals.slice(1);
  switch (sub) {
    case 'init': {
      const r = wrap(() => V.init(root, { allowEngine }));
      print(r, o.json, r.created ? `versions on for ${root}${r.commit ? ` (${r.commit.short} ${r.commit.msg})` : ''}` : 'already a repository' + (r.commit ? ` (${r.commit.short} ${r.commit.msg})` : ''));
      return [];
    }
    case 'status': {
      const s = wrap(() => V.status(root));
      const human = !s.repo ? 'no version history (run `gfx version init`)'
        : `${s.engine ? '[engine repo, read-only] ' : ''}${s.branch || '(detached)'}  ${s.head ? `${s.head.sha.slice(0, 7)} ${s.head.msg}` : '(no commits)'}\n` +
          (s.dirty.length ? s.dirty.map((d) => `  ${d.status} ${d.path}`).join('\n') : '  clean');
      print(s, o.json, human);
      return [];
    }
    case 'save': {
      const actor = o.actor || 'user';
      const th = o.thumb ? parseThumb(o.thumb) : null;
      const r = wrap(() => V.save(root, { note: o.message, actor, scene: th?.scene, t: th?.t, allowEngine }));
      if (!r.skipped && th) { const thumb = makeThumb(root, r.sha, th); if (thumb) r.thumb = thumb; }
      print(r, o.json, r.skipped ? 'nothing changed' : `saved ${r.short} ${r.msg}`);
      return [];
    }
    case 'log': {
      const entries = wrap(() => V.log(root, { limit: o.limit, path: o.path?.[0] }));
      print(entries, o.json, entries.map((e) => `${e.short}  ${e.time}  ${(e.actor || '-').padEnd(6)} ${e.msg}  (${e.files.length} files)`).join('\n') || '(no versions)');
      return [];
    }
    case 'diff': {
      if (!rest[0]) die(USAGE);
      const d = wrap(() => V.diff(root, { a: rest[0], b: rest[1], worktree: !!o.worktree, path: o.path?.[0] }));
      print(d, o.json, d.files.map((f) => `${f.status} ${f.path}${f.binary ? ' (binary)' : f.tooLarge ? ' (too large)' : ''}`).join('\n') || '(no differences)');
      return [];
    }
    case 'restore': {
      if (!rest[0]) die(USAGE);
      const r = wrap(() => V.restore(root, { sha: rest[0], paths: o.path || [], allowEngine }));
      print(r, o.json, (r.saved ? `saved current state as ${r.saved.short}\n` : '') + (r.commit ? `restored ${r.restored.slice(0, 7)} -> ${r.commit.short}` : 'already identical; nothing to restore'));
      return [];
    }
    case 'export': {
      if (!rest[0] || !o.out) die(USAGE);
      const r = wrap(() => V.exportTree(root, { sha: rest[0], dir: o.out }));
      print(r, o.json, `exported ${r.sha.slice(0, 7)}: ${r.files} files (${r.bytes} bytes) -> ${r.dir}`);
      return [];
    }
    case 'preview': {
      // long-running: one JSON line { type: 'vdiff', url, ... } (or a human line), then serve until a signal / idle
      const { startPreview } = await import('../../vdiff.js');
      const idle = o.idle === undefined ? 45 : num(o.idle, 45);
      let p;
      try { p = await startPreview(root, { rev: rest[0] || 'now', port: o.port ? num(o.port, 0) : null, idle, log: (m) => console.error('gfx: ' + m) }); }
      catch (e) { if (e.code === 'GFX_VERSION') die(e.message); throw e; }
      cleanups.push(p.close);
      if (o.json || isJson()) console.log(JSON.stringify(p.info));
      else console.log(`gfx version preview ${p.info.short} "${p.info.msg}": ${p.info.url}  (scenes: ${p.info.scenes.join(', ') || 'none'})\nCtrl+C to stop`);
      await p.idleDone;
      return [];
    }
    default:
      die(USAGE);
  }
}
