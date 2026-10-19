// Project versions on top of the system git (docs/CODE-VERSIONS.md §2). Every git call goes through run(); history is
// only ever appended to (no reset / amend / force / rebase). Errors are thrown as Error with `.code = 'GFX_VERSION'`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ENGINE, projectRoot, samePath, which } from './paths.js';

export const ACTORS = ['user', 'claude', 'auto'];
const TRAILER = /^Gfx-(Actor|Scene|T|Restored):[ \t]*(.*)$/gim;
const IGNORE = ['out/', '.gfx/', 'node_modules/'];
const MAX_TEXT = 1024 * 1024;
const fail = (msg) => Object.assign(new Error(msg), { code: 'GFX_VERSION' });

/** Path of the git executable: GFX_GIT, else PATH, else the usual Windows install; null when none. */
export function gitPath() {
  if (process.env.GFX_GIT) return process.env.GFX_GIT;
  const onPath = which('git');
  if (onPath) return onPath;
  if (process.platform === 'win32') {
    for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
      const f = base && path.join(base, 'Git', 'cmd', 'git.exe');
      if (f && fs.existsSync(f)) return f;
    }
  }
  return null;
}

/** The ONE place git is spawned. Returns { code, out (string | Buffer when opts.buffer), err }. */
export function run(args, { cwd = projectRoot(), input, buffer = false } = {}) {
  const exe = gitPath();
  if (!exe) throw fail('git was not found (install git, or set GFX_GIT to its path)');
  const env = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX']) delete env[k];
  const r = spawnSync(exe, ['-c', 'core.quotepath=off', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], {
    cwd, env, input: typeof input === 'string' ? Buffer.from(input, 'utf8') : input, maxBuffer: 512 * 1024 * 1024, encoding: buffer ? 'buffer' : 'utf8', windowsHide: true,
  });
  if (r.error) throw fail(`could not run git: ${r.error.message}`);
  return { code: r.status, out: r.stdout, err: String(r.stderr || '').trim() };
}
const must = (args, o) => {
  const r = run(args, o);
  if (r.code !== 0) throw fail(`git ${args[0]} failed: ${r.err || `exit ${r.code}`}`);
  return r.out;
};

export function gitInfo() {
  const exe = gitPath();
  if (!exe) return null;
  try {
    const r = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const v = r.status === 0 ? /git version (\S+)/.exec(r.stdout) : null;
    return v ? { path: exe, version: v[1] } : { path: exe, version: null };
  } catch { return { path: exe, version: null }; }
}

// ---------------------------------------------------------------- repo state
/** { repo: project has its own repo, engine: it is (inside) the engine repo }. */
export function repoState(root = projectRoot()) {
  const own = fs.existsSync(path.join(root, '.git'));
  let top = null;
  if (fs.existsSync(root)) {
    const r = run(['rev-parse', '--show-toplevel'], { cwd: root });
    if (r.code === 0 && r.out.trim()) top = r.out.trim();
  }
  const engine = samePath(root, ENGINE) || (top !== null && samePath(top, ENGINE));
  return { repo: own || (top !== null && samePath(top, root)), engine, top };
}
const needRepo = (root) => {
  const s = repoState(root);
  if (!s.repo) throw fail('this project has no version history yet (run `gfx version init`)');
  return s;
};
const refuseEngine = (s, allowEngine) => {
  if (s.engine && !allowEngine) throw fail('this is the engine repo: its history is read-only here (pass --allow-engine to override)');
};

function cleanPath(p) {
  const n = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
  if (!n || n.startsWith('/') || /^[A-Za-z]:/.test(n) || n.split('/').includes('..') || n.startsWith('-') || n.startsWith(':')) throw fail(`bad path "${p}" (must be project-relative)`);
  return n;
}
const rev = (r, root) => {
  const s = String(r);
  if (!s || s.startsWith('-')) throw fail(`bad revision "${r}"`);
  const x = run(['rev-parse', '--verify', '--quiet', `${s}^{commit}`], { cwd: root });
  if (x.code !== 0) throw fail(`unknown version "${r}"`);
  return x.out.trim();
};

function parseTrailers(text) {
  const out = {};
  for (const m of text.matchAll(TRAILER)) out[m[1].toLowerCase()] = m[2].trim();
  return out;
}
const stripTrailers = (text) => text.replace(/^Gfx-(Actor|Scene|T|Restored):.*$/gim, '').replace(/\s+$/, '');

// ---------------------------------------------------------------- status / init / save
function headOf(root) {
  const r = run(['log', '-1', '--format=%H%x1f%s%x1f%cI%x1f%T%x1f%B'], { cwd: root });
  if (r.code !== 0 || !r.out.trim()) return null;
  const [sha, msg, time, tree, body] = r.out.split('\x1f');
  return { sha, msg, time, tree, actor: parseTrailers(body).actor || null };
}
const branchOf = (root) => { const r = run(['symbolic-ref', '--short', '-q', 'HEAD'], { cwd: root }); return r.code === 0 ? r.out.trim() : null; };

export function status(root = projectRoot()) {
  const s = repoState(root);
  if (!s.repo) return { repo: false, engine: s.engine, branch: null, dirty: [], head: null };
  const out = must(['status', '--porcelain=v1', '-z', '-uall'], { cwd: root });
  const dirty = [];
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2), p = e.slice(3);
    if (xy[0] === 'R' || xy[0] === 'C') i++; // rename source follows
    const c = xy === '??' ? 'A' : xy.includes('D') ? 'D' : xy.includes('A') || xy[0] === 'R' || xy[0] === 'C' ? 'A' : 'M';
    dirty.push({ path: p, status: c });
  }
  return { repo: true, engine: s.engine, branch: branchOf(root), dirty, head: headOf(root) };
}

function ensureIgnore(root) {
  const f = path.join(root, '.gitignore');
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const have = new Set(cur.split(/\r?\n/).map((l) => l.trim()));
  const add = IGNORE.filter((l) => !have.has(l) && !have.has(l.replace(/\/$/, '')));
  if (!add.length) return false;
  fs.writeFileSync(f, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n');
  return true;
}
function identity(root) {
  const has = (k) => run(['config', '--get', k], { cwd: root }).out.trim();
  const a = [];
  if (!has('user.name')) a.push('-c', 'user.name=gfx');
  if (!has('user.email')) a.push('-c', 'user.email=gfx@localhost');
  return a;
}
function commit(root, message, trailers, paths = []) {
  const body = message.trim() + '\n\n' + Object.entries(trailers).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `Gfx-${k}: ${v}`).join('\n') + '\n';
  must([...identity(root), 'commit', '--no-verify', '--allow-empty-message', '-F', '-', ...(paths.length ? ['--only', '--', ...paths] : [])], { cwd: root, input: body });
  return headOf(root);
}
const view = (h) => ({ sha: h.sha, short: h.sha.slice(0, 7), msg: h.msg, actor: h.actor });
/** A restore's source version: the Gfx-Restored trailer, else an older entry's "Restored <short>" message. */
function restoredFrom(root, trailer, msg, cache) {
  const ref = trailer || /^Restored ([0-9a-f]{7,40})\b/.exec(msg || '')?.[1];
  if (!ref || !/^[0-9a-f]{7,40}$/.test(ref)) return null;
  if (!cache.has(ref)) {
    const r = run(['log', '-1', '--format=%H%x1f%cI%x1f%s', `${ref}^{commit}`, '--'], { cwd: root });
    const [sha, time, subject] = r.code === 0 ? r.out.trim().split('\x1f') : [];
    cache.set(ref, sha ? { sha, short: sha.slice(0, 7), msg: subject, time } : null);
  }
  return cache.get(ref);
}

/** gfx version init: repo + .gitignore + first commit. Idempotent. */
export function init(root = projectRoot(), { allowEngine = false } = {}) {
  const s = repoState(root);
  refuseEngine(s, allowEngine);
  let created = false;
  if (!s.repo) {
    created = true;
    const r = run(['init', '-b', 'main'], { cwd: root });
    if (r.code !== 0) must(['init'], { cwd: root }); // git < 2.28 has no -b
  }
  const ignored = ensureIgnore(root);
  let first = null;
  if (!headOf(root)) {
    must(['add', '-A'], { cwd: root });
    first = view(commit(root, 'Project created', { Actor: 'user' }));
  } else if (ignored) {
    must(['add', '--', '.gitignore'], { cwd: root });
    if (run(['diff', '--cached', '--quiet', '--', '.gitignore'], { cwd: root }).code !== 0) first = view(commit(root, 'Ignore generated folders', { Actor: 'auto' }, ['.gitignore']));
  }
  return { created, ...(first ? { commit: first } : {}), status: status(root) };
}

/** Stage everything (respecting .gitignore) and commit; `{ skipped: 'clean' }` when nothing changed. */
export function save(root = projectRoot(), { note, actor = 'user', scene, t, allowEngine = false } = {}) {
  const s = needRepo(root);
  refuseEngine(s, allowEngine);
  if (!ACTORS.includes(actor)) throw fail(`--actor must be one of ${ACTORS.join('|')}`);
  must(['add', '-A'], { cwd: root });
  if (run(['diff', '--cached', '--quiet'], { cwd: root }).code === 0) return { skipped: 'clean' };
  let message = note && String(note).trim();
  if (!message) {
    const files = must(['diff', '--cached', '--name-only'], { cwd: root }).split('\n').filter(Boolean);
    message = 'Saved ' + (files.length <= 3 ? files.join(', ') : `${files.slice(0, 3).join(', ')} and ${files.length - 3} more`);
  }
  const h = commit(root, message, { Actor: actor, Scene: scene, T: t });
  return view(h);
}

/** Auto-checkpoint helper for other commands: never throws, null when not applicable (no git / no repo / engine repo). */
export function autoSave(root, note, extra = {}) {
  try {
    if (!gitPath()) return null;
    const s = repoState(root);
    if (!s.repo || s.engine) return null;
    const r = save(root, { note, actor: 'auto', ...extra });
    return r.skipped ? null : r;
  } catch (e) { console.warn('gfx: auto-save failed: ' + e.message); return null; }
}

// ---------------------------------------------------------------- log
export function log(root = projectRoot(), { limit = 100, path: p } = {}) {
  const s = repoState(root);
  if (!s.repo) return [];
  if (!headOf(root)) return [];
  const n = Math.max(1, Math.min(10000, Math.floor(Number(limit)) || 100));
  const args = ['log', '-n', String(n), '--no-renames', '--raw', '--numstat', '--format=%x1e%H%x1f%cI%x1f%T%x1f%B%x1f'];
  if (p) args.push('--', cleanPath(p));
  const out = must(args, { cwd: root });
  const res = [], sources = new Map();
  for (const chunk of out.split('\x1e')) {
    if (!chunk.trim()) continue;
    const [sha, time, tree, body, rest = ''] = chunk.split('\x1f');
    const tr = parseTrailers(body);
    const note = stripTrailers(body);
    const status = new Map();
    const files = [];
    for (const l of rest.split('\n')) {
      let m = /^:\d+ \d+ [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*\t(.+)$/.exec(l);
      if (m) { status.set(m[2], m[1]); continue; }
      m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(l);
      if (m) files.push({ path: m[3], status: status.get(m[3]) || 'M', add: m[1] === '-' ? 0 : +m[1], del: m[2] === '-' ? 0 : +m[2], ...(m[1] === '-' ? { binary: true } : {}) });
    }
    const thumbRel = `.gfx/thumbs/${sha}.png`;
    res.push({
      sha, short: sha.slice(0, 7), msg: note.split('\n')[0], note, actor: tr.actor || null, scene: tr.scene || null, tree,
      restoredFrom: restoredFrom(root, tr.restored, note, sources),
      t: tr.t !== undefined && Number.isFinite(Number(tr.t)) ? Number(tr.t) : null, time, files,
      thumb: fs.existsSync(path.join(root, thumbRel)) ? thumbRel : null,
    });
  }
  return res;
}

// ---------------------------------------------------------------- diff
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
function blob(root, r, p) {
  const sz = run(['cat-file', '-s', `${r}:${p}`], { cwd: root });
  if (sz.code !== 0) return { missing: true };
  if (Number(sz.out) > MAX_TEXT) return { big: true };
  const buf = must(['show', `${r}:${p}`], { cwd: root, buffer: true });
  return isBinary(buf) ? { binary: true } : { text: buf.toString('utf8') };
}
function fromDisk(root, p) {
  const f = path.join(root, p);
  let st;
  try { st = fs.lstatSync(f); } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return { missing: true };
    throw e;
  }
  if (st.size > MAX_TEXT) return { big: true };
  const buf = st.isSymbolicLink() ? fs.readlinkSync(f, { encoding: 'buffer' }) : fs.readFileSync(f);
  return isBinary(buf) ? { binary: true } : { text: buf.toString('utf8') };
}

/** diff(a, b) between two versions; diff(a, { worktree: true }) against the working tree; diff(a) = a against its parent. */
export function diff(root = projectRoot(), { a, b, worktree = false, path: p } = {}) {
  needRepo(root);
  if (!a) throw fail('usage: gfx version diff <a> [<b> | --worktree] [--path p]');
  const A = rev(a, root);
  const spec = p ? ['--', cleanPath(p)] : [];
  let from = A, to = null, base;
  if (worktree) {
    base = [from];
  } else if (b) {
    to = rev(b, root);
    base = [from, to];
  } else {
    const parent = run(['rev-parse', '--verify', '--quiet', `${A}^`], { cwd: root });
    from = parent.code === 0 ? parent.out.trim() : must(['hash-object', '-t', 'tree', '--stdin'], { cwd: root, input: '' }).trim(); // root commit: empty tree
    to = A;
    base = [from, to];
  }
  const entries = new Map();
  for (const l of must(['diff', '--name-status', '--no-renames', '-z', ...base, ...spec], { cwd: root }).split('\0').reduce((acc, x, i, arr) => { if (i % 2 === 0 && x) acc.push([x, arr[i + 1]]); return acc; }, [])) {
    entries.set(l[1], l[0][0]);
  }
  if (worktree) {
    const un = must(['ls-files', '--others', '--exclude-standard', '-z', ...spec], { cwd: root }).split('\0').filter(Boolean);
    for (const f of un) if (!entries.has(f)) entries.set(f, 'A');
  }
  const files = [];
  for (const [fp, st] of [...entries].sort((x, y) => x[0].localeCompare(y[0]))) {
    const A_ = st === 'A' ? { missing: true } : blob(root, from, fp);
    const B_ = st === 'D' ? { missing: true } : worktree ? fromDisk(root, fp) : blob(root, to, fp);
    const e = { path: fp, status: st, a: A_.text ?? null, b: B_.text ?? null };
    if (A_.binary || B_.binary) e.binary = true;
    if (A_.big || B_.big) e.tooLarge = true;
    files.push(e);
  }
  return { files };
}

// ---------------------------------------------------------------- restore
export function restore(root = projectRoot(), { sha, paths = [], allowEngine = false } = {}) {
  const s = needRepo(root);
  refuseEngine(s, allowEngine);
  if (!sha) throw fail('usage: gfx version restore <sha> [--path p]...');
  const target = rev(sha, root);
  const short = target.slice(0, 7);
  // Resolve root aliases before checkpointing, and reject escapes before any mutation.
  const normalized = paths.map((p) => {
    const raw = String(p).replace(/\\/g, '/');
    const relative = path.relative(path.resolve(root), path.resolve(root, raw));
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw fail(`bad path "${p}" (must be inside project)`);
    return relative ? cleanPath(relative) : '';
  });
  const rel = normalized.includes('') ? [] : normalized;
  const saved = save(root, { note: `Before restore to ${short}`, actor: 'auto', allowEngine });
  const literal = (p) => `:(literal)${p}`;
  const keep = new Set(must(['ls-tree', '-r', '--name-only', '-z', target], { cwd: root }).split('\0').filter(Boolean));
  const scopes = rel.length ? rel : [''];
  for (const p of scopes) {
    const inside = (f) => !p || f === p || f.startsWith(p + '/');
    const spec = p ? ['--', literal(p)] : [];
    const tracked = must(['ls-files', '-z', ...spec], { cwd: root }).split('\0').filter(Boolean);
    const untracked = must(['ls-files', '--others', '--exclude-standard', '-z', ...spec], { cwd: root }).split('\0').filter(Boolean);
    const gone = tracked.filter((f) => !keep.has(f));
    for (let i = 0; i < gone.length; i += 200) must(['rm', '-q', '-f', '--', ...gone.slice(i, i + 200).map(literal)], { cwd: root });
    for (const f of untracked.filter((f) => !keep.has(f))) fs.rmSync(path.join(root, f), { force: true });
    if ([...keep].some(inside)) must(['checkout', target, '--', literal(p || '.')], { cwd: root });
  }
  must(['add', '-A'], { cwd: root });
  const msg = `Restored ${short}` + (rel.length ? ` (${rel.join(', ')})` : '');
  let restored = { skipped: 'clean' };
  if (run(['diff', '--cached', '--quiet'], { cwd: root }).code !== 0) restored = view(commit(root, msg, { Actor: 'user', Restored: target }));
  return { restored: target, saved: saved.skipped ? null : saved, commit: restored.skipped ? null : restored, ...(restored.skipped ? { skipped: 'clean' } : {}) };
}

export const thumbPath = (root, sha) => path.join(root, '.gfx', 'thumbs', `${sha}.png`);

// ---------------------------------------------------------------- export (docs/VISUAL-DIFF.md §2)
/** Version info for one revision: { sha, short, msg, time }. */
export function revInfo(root = projectRoot(), r) {
  needRepo(root);
  const sha = rev(r, root);
  const [, time, msg] = must(['log', '-1', '--format=%H%x1f%cI%x1f%s', sha, '--'], { cwd: root }).trim().split('\x1f');
  return { sha, short: sha.slice(0, 7), msg, time };
}
/** Which tracked paths an export writes: the engine repo only its scene material, other projects all but generated folders. */
const exportFilter = (engine) => (engine
  ? (p) => p === 'gfx.json' || p.startsWith('scenes/') || p.startsWith('style/')
  : (p) => !/^(out|node_modules|\.gfx|\.git)\//.test(p));
/** Destination of tree path `p` inside export root `out`, or null when unsafe on any OS: absolute, drive letters /
 *  NTFS streams (`:`), backslashes (separators on Windows), empty / `.` / `..` components, or a result outside `out`. */
export function exportDest(out, p) {
  const s = String(p);
  if (!s || s.startsWith('/') || /[\\:\0]/.test(s)) return null;
  const parts = s.split('/');
  if (parts.some((x) => x === '' || x === '.' || x === '..')) return null;
  const root = path.resolve(out), f = path.resolve(root, ...parts);
  const rel = path.relative(root, f);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? f : null;
}
/** Write the files of version <sha> into `dir` (new or empty) with read-only plumbing only (ls-tree + cat-file --batch):
 *  no worktree, index or ref changes, so it is safe on the engine repo. Symlinks and submodules are skipped. */
export function exportTree(root = projectRoot(), { sha, dir } = {}) {
  const s = needRepo(root);
  if (!sha || !dir) throw fail('usage: gfx version export <rev> --out <dir>');
  const target = rev(sha, root);
  const out = path.resolve(dir);
  if (fs.existsSync(out) && fs.readdirSync(out).length) throw fail(`--out ${out} is not empty`);
  const keep = exportFilter(s.engine);
  const items = [], skipped = [];
  for (const e of must(['ls-tree', '-r', '-z', '--full-tree', target], { cwd: root }).split('\0')) {
    const tab = e.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, obj] = e.slice(0, tab).split(' '), p = e.slice(tab + 1);
    if (type !== 'blob' || mode === '120000' || !keep(p)) continue;
    const f = exportDest(out, p); // never escape `dir` (unsafe names are skipped)
    if (f) items.push({ mode, obj, p, f }); else skipped.push(p);
  }
  fs.mkdirSync(out, { recursive: true });
  let bytes = 0;
  if (items.length) {
    const buf = must(['cat-file', '--batch'], { cwd: root, buffer: true, input: items.map((i) => i.obj).join('\n') + '\n' });
    let at = 0;
    for (const it of items) {
      const nl = buf.indexOf(10, at);
      const head = buf.subarray(at, nl).toString('latin1').split(' '); // "<sha> blob <size>"
      if (head[0] !== it.obj || head[1] !== 'blob') throw fail(`git cat-file: unexpected object for ${it.p}`);
      const size = Number(head[2]), start = nl + 1;
      const f = it.f;
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, buf.subarray(start, start + size));
      if (it.mode === '100755' && process.platform !== 'win32') fs.chmodSync(f, 0o755);
      bytes += size;
      at = start + size + 1; // content is followed by a newline
    }
  }
  return { sha: target, dir: out, files: items.length, bytes, ...(skipped.length ? { skipped } : {}) };
}
