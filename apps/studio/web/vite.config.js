// gfx studio web build. `@sfx` is the harness synth (single source of truth); the dev shim middleware
// serves the same operations as the Tauri backend from the local filesystem (see src/api.js).
import { defineConfig } from 'vite';
import fs from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeServerRoot, otherServerError } from './src/server-root.js';
import { resolveLib, mimeOf } from './lib-guard.js';
import { checkLink } from './src/url-guard.js';
import { t3Ops } from './t3-shim.js';
import { wslShim } from './wsl-shim.js';
import { checkSourceWritable, checkSourceVersion, isSourceWritable, SKIP_DIRS } from './src/source-guard.js';
import os from 'node:os';
import {
  SCHEMA, sanitizeMachine, patchMachine, sanitizeProject, patchProject, setSettingsText, sanitizeRecent, touchRecent, pinRecent, removeRecent,
  relocateRecent, addFolder, removeFolder, relocateFolder, sortCap, pathKey,
  workflowArg,
} from './src/settings-core.js';
import { checkLibRel, checkLibWritable, checkLibRef, checkLibBytes, checkRefDest, cleanFileName, uniqueName, isMedia, MAX_TEXT, MAX_THUMB, MAX_REF } from './src/library-core.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');

// ---- terminals (dev twin of pty_open / pty_write / pty_resize / pty_close): python's pty module, resize over fd 3 ----
const PTY_PY = String.raw`
import os, pty, sys, select, struct, fcntl, termios, signal
cols, rows = int(sys.argv[1]), int(sys.argv[2])
pid, fd = pty.fork()
if pid == 0:
    os.execvp(sys.argv[3], sys.argv[3:])
def size(c, r): fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
size(cols, rows)
ins, ctl = [0, fd, 3], b''
while True:
    try: r, _, _ = select.select(ins, [], [], 1.0)
    except InterruptedError: continue
    if fd in r:
        try: d = os.read(fd, 65536)
        except OSError: d = b''
        if not d: break
        os.write(1, d)
    if 0 in r:
        d = os.read(0, 65536)
        if not d:
            os.kill(pid, signal.SIGHUP); break
        while d:
            n = os.write(fd, d); d = d[n:]
    if 3 in r:
        d = os.read(3, 4096)
        if not d: ins.remove(3)
        ctl += d
        while b'\n' in ctl:
            line, ctl = ctl.split(b'\n', 1)
            c, rr = line.split()
            size(int(c), int(rr)); os.kill(pid, signal.SIGWINCH)
try:
    _, st = os.waitpid(pid, 0); code = os.waitstatus_to_exitcode(st)
except Exception: code = 0
sys.exit(code if code >= 0 else 128 - code)
`;
const settingsFile = process.env.GFX_STUDIO_SETTINGS || path.join(os.tmpdir(), 'gfx-studio-dev-settings.json');
// recent.json next to the settings file (tests use their own settings file, so they get their own recent list)
const recentFile = process.env.GFX_STUDIO_RECENT || (/settings\.json$/.test(settingsFile) ? settingsFile.replace(/settings\.json$/, 'recent.json') : settingsFile + '.recent.json');
const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeAtomic = (f, text) => { fs.writeFileSync(f + '.tmp-gfx', text); fs.renameSync(f + '.tmp-gfx', f); };
// twins of prefs.rs: sanitize on read (old webhook keys / bad values dropped), strict or lenient patch on write
const readSettings = () => sanitizeMachine(readJsonFile(settingsFile));
function patchSettings(patch, strict) {
  const known = strict ? patch : Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in SCHEMA));
  const next = patchMachine(readSettings(), known);
  writeAtomic(settingsFile, JSON.stringify(next, null, 2));
  return next;
}
const readRecent = () => sanitizeRecent(readJsonFile(recentFile));
function editRecent(f) { const r = f(readRecent()); writeAtomic(recentFile, JSON.stringify(r, null, 2)); return null; }
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
function sceneNames(p) {
  try { return fs.readdirSync(path.join(p, 'scenes'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(p, 'scenes', d.name, 'scene.json'))).map((d) => d.name).sort(); } catch { return []; }
}
function infoOf(p) {
  const exists = isDir(p);
  const gj = readJsonFile(path.join(p, 'gfx.json'));
  return { exists, isProject: exists && (fs.existsSync(path.join(p, 'gfx.json')) || isDir(path.join(p, 'scenes'))), name: gj?.name || path.basename(p), scenes: exists ? sceneNames(p).length : 0 };
}
function thumbOf(p) {
  for (const sc of sceneNames(p)) {
    const d = path.join(p, 'out', sc);
    if (fs.existsSync(path.join(d, 'sheet.png'))) return path.join(d, 'sheet.png');
    let st = [];
    try { st = fs.readdirSync(d).filter((n) => n.startsWith('still-') && n.endsWith('.png')).sort(); } catch { /* none */ }
    if (st.length) return path.join(d, st[0]);
  }
  return null;
}
const projectsIn = (f) => {
  try {
    return fs.readdirSync(f, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(f, e.name))
      .filter((p) => fs.existsSync(path.join(p, 'gfx.json')) || isDir(path.join(p, 'scenes'))).sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).slice(0, 200);
  } catch { return []; }
};
const projItem = (p, e = {}) => { const i = infoOf(p); return { path: p, name: i.exists ? i.name : e.name || i.name, scenes: i.scenes, thumb: i.exists && !!thumbOf(p), missing: !i.exists, opened: e.opened || 0, pinned: !!e.pinned }; };
const isKnown = (r, p) => { const k = pathKey(p), parent = pathKey(path.dirname(p)); return r.recent.some((e) => pathKey(e.path) === k) || r.folders.some((f) => pathKey(f) === k || pathKey(f) === parent); };
const splitCmd = (s) => (String(s).match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"|"$/g, ''));

// ---- machine Library (twins of src-tauri/src/library.rs; guards in src/library-core.js) ----
const libraryDirOf = () => {
  const set = String(readSettings().libraryDir || '').trim();
  return set ? { dir: path.resolve(set), source: 'setting' } : { dir: path.join(os.homedir(), 'Documents', 'gfx library'), source: 'default' };
};
/** p stays inside root after resolving symlinks of the parts that exist (lexically for the rest). */
function insideReal(root, p) {
  let rr; try { rr = fs.realpathSync(root); } catch { return p === root || p.startsWith(root + path.sep); }
  let q = p; const rest = [];
  for (;;) { try { fs.lstatSync(q); break; } catch { rest.unshift(path.basename(q)); const up = path.dirname(q); if (up === q) return false; q = up; } }
  let rq; try { rq = fs.realpathSync(q); } catch { return false; }
  const full = path.join(rq, ...rest);
  return full === rr || full.startsWith(rr + path.sep);
}
const joinChecked = (root, parts) => { const p = path.join(root, ...parts); if (!insideReal(root, p)) throw new Error(`path leaves the folder: ${parts.join('/')}`); return p; };
function listLibrary(dir) {
  const files = []; let truncated = false;
  const walk = (d, rel, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) { if (depth < 6) walk(path.join(d, e.name), r, depth + 1); } else if (e.isFile()) {
        if (files.length >= 5000) { truncated = true; continue; }
        const st = fs.statSync(path.join(d, e.name));
        files.push({ path: r, size: st.size, mtime: Math.round(st.mtimeMs) });
      }
    }
  };
  for (const top of ['looks', 'presets', 'palettes']) { try { if (fs.lstatSync(path.join(dir, top)).isDirectory()) walk(path.join(dir, top), top, 1); } catch { /* none */ } }
  return { files, truncated };
}
function copyRef(src, destDir, name, root) {
  if (!path.isAbsolute(src)) throw new Error(`not an absolute path: ${src}`);
  let st; try { st = fs.statSync(src); } catch (e) { throw new Error(`${src}: ${e.message}`); }
  if (!st.isFile()) throw new Error(`not a file: ${src}`);
  if (st.size > MAX_REF) throw new Error(`${src}: larger than 200 MB`);
  if (!isMedia(src)) throw new Error(`${src}: not an image or video`);
  fs.mkdirSync(destDir, { recursive: true });
  if (!insideReal(root, destDir)) throw new Error('the refs folder leaves the project');
  const finalName = uniqueName(name, new Set(fs.readdirSync(destDir)));
  const tmp = path.join(destDir, `.${finalName}.tmp-gfx`);
  fs.copyFileSync(src, tmp); fs.renameSync(tmp, path.join(destDir, finalName));
  return finalName;
}

function devShim() {
  let root = repo;
  const safe = (rel) => {
    if (typeof rel !== 'string' || !rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`bad path: ${rel}`);
    const abs = path.resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error(`path escapes root: ${rel}`);
    return abs;
  };
  // out/<scene>/review/** only; twin of check_writable in lib.rs
  const writeReviewFile = (rel, data) => {
    if (!/^out\/[^/\\]+\/review\/.+$/.test(rel || '')) throw new Error(`write not allowed: ${rel}`);
    const p = safe(rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  };
  const body =(req) => new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { res(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
  // ---- engine jobs (dev twin of engine_run / engine_cancel): node <engine>/runner/cli.js, cwd = project ----
  // twin of lib.rs locate_engine: GFX_ENGINE > the "engineDir" setting > the repo (the app: engine/ next to the exe)
  const engineLoc = () => {
    const env = (process.env.GFX_ENGINE || '').trim(), set = String(readSettings().engineDir || '').trim();
    const [dir, source] = env ? [env, 'env'] : set ? [set, 'setting'] : [repo, 'app'];
    return { dir: path.resolve(dir), source, found: fs.existsSync(path.join(dir, 'runner', 'cli.js')) };
  };
  const targetEngine = (folder) => {
    const m = /^\\\\(?:wsl.localhost|wsl\$)\\([^\\]+)\\/i.exec(folder || '');
    if (!m) return null;
    const entries = readJsonFile(path.join(path.dirname(settingsFile), 'engines.json'))?.wsl || {};
    const entry = Object.entries(entries).find(([d]) => d.toLowerCase() === m[1].toLowerCase())?.[1];
    if (!entry) throw new Error(`No gfx engine in WSL ${m[1]}`);
    return entry.path;
  };
  const engineDir = () => { const e = engineLoc(); if (!e.found) throw new Error(`engine not found at ${e.dir}`); return e.dir; };
  // Twin of lib.rs locate_library / lib_scope: the engine's sound library for the open project (`gfx lib list --json`),
  // asked once per project (the first /__lib request or lib_locate), cleared on a project switch; no answer = <root>/library.
  let libScope = null; // { root, lib, error?, p: Promise }
  const locateLibrary = (force = false) => {
    if (!force && libScope?.root === root) return libScope.p;
    const forRoot = root;
    const p = new Promise((resolve) => {
      let eng; try { eng = engineDir(); } catch (e) { return resolve({ root: forRoot, lib: null, error: String(e.message || e) }); }
      execFile(process.execPath, [path.join(eng, 'runner', 'cli.js'), 'lib', 'list', '--json'], { cwd: forRoot, env: { ...process.env, GFX_PROJECT: forRoot }, maxBuffer: 16 << 20, timeout: 60000 }, (err, stdout, stderr) => {
        if (err) return resolve({ root: forRoot, lib: null, error: String(stderr || err.message).trim().split('\n').pop() });
        let lib = null;
        try { lib = JSON.parse(stdout).library || null; } catch { /* not JSON */ }
        resolve({ root: forRoot, lib: lib ? path.resolve(lib) : null, error: lib ? undefined : 'gfx lib list --json did not name the library' });
      });
    });
    const entry = { root: forRoot, p };
    libScope = entry;
    p.then((s) => { if (libScope === entry) Object.assign(entry, s); });
    return p;
  };
  // Twin of project_opened: keep the engine record and an existing managed block current, without copying skills.
  const refreshProjectMetadata = () => {
    try {
      const project = root, e = engineLoc(), config = readJsonFile(path.join(project, 'gfx.json'));
      if (!config || !e.found || fs.existsSync(path.join(project, 'runner', 'cli.js'))) return null;
      const dir = path.join(project, '.gfx'), file = path.join(dir, 'engine.json'), cur = readJsonFile(file);
      const wsl = process.env.WSL_DISTRO_NAME && /^\/mnt\/[a-z](\/|$)/i.test(project) ? process.env.WSL_DISTRO_NAME : undefined;
      if (cur?.engine !== e.dir || cur?.wsl !== wsl) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ engine: e.dir, bin: path.join(e.dir, 'bin', process.platform === 'win32' ? 'gfx.cmd' : 'gfx'), node: process.execPath, wsl, updated: new Date().toISOString() }, null, 2) + '\n');
      }
      const gi = path.join(project, '.gitignore'), text = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
      if (!text.split(/\r?\n/).some((l) => ['.gfx/', '.gfx', '/.gfx/', '/.gfx'].includes(l.trim()))) fs.writeFileSync(gi, text + (text && !text.endsWith('\n') ? '\n' : '') + '.gfx/\n');
      const block = (s) => s.match(/<!-- gfx:begin -->[\s\S]*?<!-- gfx:end -->/)?.[0].replace(/\r\n/g, '\n');
      // twin of lib.rs block_shape: the workflow / look lines are project-specific, not a template change
      const shape = (b) => b && b.replaceAll('{{look}}', '').split('\n').filter((l) => { const t = l.trimStart(); return t !== '- {{workflow}}' && !t.startsWith('- Workflow (this project):') && !t.startsWith('- Look: '); }).join('\n');
      const current = block(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'));
      const template = block(fs.readFileSync(path.join(e.dir, 'templates', 'projects', '_shared', 'CLAUDE.md'), 'utf8').replaceAll('{{name}}', config.name || path.basename(project)));
      const machine = readSettings().workflow ?? 'quick';
      let rec = null; try { rec = sanitizeMachine({ workflow: readJsonFile(path.join(project, '.gfx', 'workflow.json'))?.machine }).workflow ?? null; } catch { /* none */ }
      if (current && template && (shape(current) !== shape(template) || JSON.stringify(rec) !== JSON.stringify(machine))) {
        const child = spawn(process.execPath, [path.join(e.dir, 'runner', 'cli.js'), 'init', '--refresh', '--no-skills', '--workflow', workflowArg(machine)], { cwd: project, env: { ...process.env, GFX_PROJECT: project }, stdio: 'ignore' });
        child.on('error', () => {}); // metadata is best-effort, as in the app
      }
    } catch { /* a missing engine / managed block must not prevent opening the project */ }
    return null;
  };
  const jobs = new Map(); // id -> { child, events: [], subs: Set<fn>, done: bool, result, canceled }
  const pushEvent = (job, ev) => { job.events.push(ev); for (const f of job.subs) f(ev); };
  const startJob = (id, args, opts = {}) => {
    if (!/^[\w-]{1,64}$/.test(id)) throw new Error('invalid job id');
    if (jobs.has(id) && !jobs.get(id).done) throw new Error(`job ${id} is already running`);
    const explicit = opts.distro ? readJsonFile(path.join(path.dirname(settingsFile), 'engines.json'))?.wsl?.[opts.distro]?.path : null;
    if (opts.distro && (!opts.noProject || !explicit)) throw new Error('No installed engine in that distro');
    // twin of lib.rs no_project_target: `init <dir>` and `template … --for <folder>` pick the engine of that folder
    const ti = !opts.noProject ? -1 : args?.[0] === 'init' ? 1 : args?.[0] === 'template' ? (args.indexOf('--for') + 1 || -1) : -1;
    const eng = explicit || (ti > 0 ? targetEngine(args[ti]) : null) || engineDir();
    const mapped = (args || []).map(String);
    if (ti > 0 && targetEngine(mapped[ti])) mapped[ti] = '/' + mapped[ti].split('\\').slice(4).join('/');
    const a = [path.join(eng, 'runner', 'cli.js'), ...mapped];
    if (opts.progress) a.push('--progress', 'json');
    const env = { ...process.env };
    if (explicit) { const home = explicit.replace(/\/\.local\/share\/gfx\/engine\/?$/, ''); env.HOME = home; env.XDG_DATA_HOME = path.join(home, '.local', 'share'); }
    for (const [k, v] of Object.entries(opts.env || {})) { if (!k.startsWith('GFX_') || k === 'GFX_PROJECT') throw new Error(`environment variable not allowed: ${k}`); env[k] = String(v); }
    if (!opts.noProject) env.GFX_PROJECT = root; else delete env.GFX_PROJECT;
    const child = spawn(process.execPath, a, { cwd: opts.noProject ? eng : root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const job = { child, events: [], subs: new Set(), done: false, result: null, canceled: false, outputs: [], error: null };
    jobs.set(id, job);
    const lines = (stream, isErr) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i).replace(/\r$/, ''), isErr); buf = buf.slice(i + 1); }
      });
      stream.on('end', () => { if (buf.trim()) handle(buf, isErr); });
    };
    const handle = (line, isErr) => {
      if (!line.trim()) return;
      let ev = null;
      if (!isErr && line.trim().startsWith('{')) { try { const v = JSON.parse(line); if (typeof v?.type === 'string') ev = v; } catch { /* plain text */ } }
      if (!ev) ev = { type: 'log', level: isErr ? 'warn' : 'info', msg: line.trimEnd(), stream: isErr ? 'stderr' : 'stdout' };
      if (ev.type === 'done' && Array.isArray(ev.outputs)) job.outputs.push(...ev.outputs.filter((x) => typeof x === 'string'));
      if (ev.type === 'error') job.error = ev.msg ?? null;
      pushEvent(job, ev);
    };
    lines(child.stdout, false); lines(child.stderr, true);
    const finish = (code) => {
      if (job.done) return;
      job.done = true;
      job.result = { code: code ?? -1, outputs: job.outputs, canceled: job.canceled, error: job.error };
      pushEvent(job, { type: 'exit', ...job.result });
      setTimeout(() => { if (jobs.get(id) === job) jobs.delete(id); }, 60000);
    };
    child.on('error', (e) => { pushEvent(job, { type: 'error', msg: String(e.message || e) }); finish(-1); });
    child.on('close', (code) => finish(code));
    return job;
  };
  const killJob = (job) => { if (!job || job.done) return false; job.canceled = true; try { process.kill(-job.child.pid, 'SIGKILL'); } catch { try { job.child.kill('SIGKILL'); } catch { /* gone */ } } return true; };
  const killAllJobs = () => { for (const j of jobs.values()) killJob(j); };
  const ptys = new Map(); // id -> { child, ctl, subs: Set<fn>, backlog: [], pend: '', timer, exited }
  const ptyEmit = (p, ev) => { if (p.subs.size) for (const f of p.subs) f(ev); else p.backlog.push(ev); };
  const ptyFlush = (p) => { p.timer = 0; if (p.pend) { const data = p.pend; p.pend = ''; ptyEmit(p, { data }); } };
  const ptyOpen = ({ id, cols = 80, rows = 24, opts = {} }) => {
    if (!/^[\w-]{1,64}$/.test(id || '')) throw new Error('invalid terminal id');
    if (ptys.has(id)) throw new Error(`terminal ${id} is already open`);
    const shell = splitCmd(opts?.shell || readSettings().shell);
    const argv = shell.length ? shell : [process.env.SHELL || 'bash', '-l'];
    const eng = engineLoc().dir;
    const env = { ...process.env, PATH: `${path.join(eng, 'bin')}:${process.env.PATH || ''}`, GFX_PROJECT: root, GFX_ENGINE: eng, TERM: 'xterm-256color' };
    const child = spawn('python3', ['-c', PTY_PY, String(Math.max(10, cols | 0)), String(Math.max(2, rows | 0)), ...argv], { cwd: root, env, stdio: ['pipe', 'pipe', 'inherit', 'pipe'] });
    const p = { child, ctl: child.stdio[3], subs: new Set(), backlog: [], pend: '', timer: 0, exited: false };
    ptys.set(id, p);
    const dec = new TextDecoder();
    child.stdout.on('data', (d) => { p.pend += dec.decode(d, { stream: true }); if (!p.timer) p.timer = setTimeout(() => ptyFlush(p), 16); });
    child.on('close', (code) => { clearTimeout(p.timer); ptyFlush(p); p.exited = true; ptyEmit(p, { exit: code }); if (ptys.get(id) === p) ptys.delete(id); });
    child.on('error', (e) => { p.pend += `\r\n[${e.message}]\r\n`; });
    child.stdin.on('error', () => {}); p.ctl.on('error', () => {});
    return { shell: argv.join(' '), cwd: root };
  };
  const ptyCloseAll = () => { for (const [id, p] of ptys) { try { p.child.kill('SIGHUP'); } catch { /* gone */ } ptys.delete(id); } };
  const serveRunning = () => jobs.has('serve') && !jobs.get('serve').done;
  const PING = 'http://127.0.0.1:5199/__gfx/ping';
  const ping = async () => {
    try {
      const r = await fetch(PING, { signal: AbortSignal.timeout(600), cache: 'no-store' });
      const j = r.ok ? await r.json() : null;
      return j?.ok && typeof j.root === 'string' ? j.root : null;
    } catch { return null; }
  };
  const matches = (served) => normalizeServerRoot(served) === normalizeServerRoot(root);
  const ops = {
    start_server: async () => {
      const url = 'http://127.0.0.1:5199';
      const served = await ping();
      if (served !== null) {
        if (matches(served)) return { url };
        if (!serveRunning()) throw new Error(otherServerError(served));
        const j = jobs.get('serve');
        killJob(j);
        for (let i = 0; i < 80 && !j.done; i++) await new Promise((r) => setTimeout(r, 50));
      }
      if (!serveRunning()) startJob('serve', ['serve', '--port', '5199']);
      for (let i = 0; i < 100; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const served = await ping();
        if (served !== null) {
          if (matches(served)) return { url };
          throw new Error(otherServerError(served));
        }
        if (!serveRunning()) throw new Error('the live server exited right after starting');
      }
      throw new Error('the live server did not answer within 30 s');
    },
    ...wslShim({ repo, settingsFile, readJsonFile, writeAtomic, jobs, pushEvent }),
    engine_run: ({ jobId, args, opts }) => { startJob(jobId, args, opts || {}); return { started: true }; },
    engine_cancel: ({ jobId }) => killJob(jobs.get(jobId)),
    pty_open: ptyOpen,
    pty_write: ({ id, data }) => { const p = ptys.get(id); if (!p) throw new Error('terminal is closed'); p.child.stdin.write(String(data)); return null; },
    pty_resize: ({ id, cols, rows }) => { const p = ptys.get(id); if (!p) throw new Error('terminal is closed'); p.ctl.write(`${Math.max(10, cols | 0)} ${Math.max(2, rows | 0)}\n`); return null; },
    pty_close: ({ id }) => {
      if (id === '*') { ptyCloseAll(); return true; }
      const p = ptys.get(id);
      if (!p) return false;
      ptys.delete(id);
      try { p.child.kill('SIGHUP'); } catch { /* gone */ }
      return true;
    },
    get_settings: () => readSettings(),
    refresh_project_metadata: refreshProjectMetadata,
    // docs/LOOKS.md §1 (twin of refresh_workflow_block): rewrite the managed block now, with this computer's default
    refresh_workflow_block: () => new Promise((resolve, reject) => {
      const e = engineLoc();
      if (!fs.existsSync(path.join(root, 'gfx.json')) || fs.existsSync(path.join(root, 'runner', 'cli.js'))) return resolve(false);
      if (!e.found) return reject(new Error(`engine not found at ${e.dir}`));
      const wf = workflowArg(readSettings().workflow ?? 'quick');
      const child = spawn(process.execPath, [path.join(e.dir, 'runner', 'cli.js'), 'init', '--refresh', '--no-skills', '--workflow', wf], { cwd: root, env: { ...process.env, GFX_PROJECT: root }, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve(true) : reject(new Error(err.trim().split('\n').pop() || `exit code ${code}`))));
    }),
    // machine Library (twins of library.rs)
    library_files: () => {
      const { dir, source } = libraryDirOf();
      const exists = isDir(dir);
      return { dir, source, exists, ...(exists ? listLibrary(dir) : { files: [], truncated: false }) };
    },
    library_read: ({ rel }) => {
      const { parts, kind } = checkLibRel(rel);
      if (kind === 'lookDir') throw new Error(`not a file: ${rel}`);
      const { dir } = libraryDirOf(), p = joinChecked(dir, parts);
      let st; try { st = fs.statSync(p); } catch { return null; }
      if (!st.isFile()) throw new Error(`not a file: ${rel}`);
      if (st.size > MAX_TEXT) throw new Error(`${rel}: larger than 1 MB`);
      const b = fs.readFileSync(p);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { throw new Error(`${rel}: not a UTF-8 text file`); }
    },
    library_write: ({ rel, text }) => {
      const parts = checkLibWritable(rel);
      if (Buffer.byteLength(String(text ?? '')) > MAX_TEXT) throw new Error(`${rel}: larger than 1 MB`);
      const { dir } = libraryDirOf();
      fs.mkdirSync(dir, { recursive: true });
      const p = joinChecked(dir, parts);
      try { const l = fs.lstatSync(p); if (l.isSymbolicLink() || l.isDirectory()) throw new Error(`${rel}: not a regular file`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (!insideReal(dir, p)) throw new Error(`path leaves the folder: ${rel}`);
      writeAtomic(p, String(text ?? ''));
      return null;
    },
    library_delete: ({ rel }) => {
      const { parts, kind } = checkLibRel(rel);
      const { dir } = libraryDirOf(), p = joinChecked(dir, parts);
      let l; try { l = fs.lstatSync(p); } catch { throw new Error(`not found: ${rel}`); }
      if (l.isSymbolicLink() || l.isFile()) fs.unlinkSync(p);
      else if (kind === 'lookDir' || (kind === 'lookFile' && l.isDirectory())) fs.rmSync(p, { recursive: true, force: true });
      else throw new Error(`not a file: ${rel}`);
      return null;
    },
    library_copy: ({ from, to }) => {
      const f = checkLibRel(from), t = checkLibRel(to);
      if (f.kind !== t.kind || f.kind === 'lookFile') throw new Error(`can only duplicate a look, preset or palette into the same kind: ${from} -> ${to}`);
      const { dir } = libraryDirOf(), src = joinChecked(dir, f.parts), dst = joinChecked(dir, t.parts);
      if (fs.existsSync(dst)) throw new Error(`${to} already exists`);
      let l; try { l = fs.lstatSync(src); } catch { throw new Error(`not found: ${from}`); }
      if (f.kind !== 'lookDir') { if (!l.isFile()) throw new Error(`not a file: ${from}`); fs.copyFileSync(src, dst); return null; }
      if (!l.isDirectory()) throw new Error(`not a look folder: ${from}`);
      const cp = (s, d) => { fs.mkdirSync(d, { recursive: true }); for (const e of fs.readdirSync(s, { withFileTypes: true })) { if (e.isDirectory()) cp(path.join(s, e.name), path.join(d, e.name)); else if (e.isFile()) fs.copyFileSync(path.join(s, e.name), path.join(d, e.name)); } };
      try { cp(src, dst); } catch (e) { fs.rmSync(dst, { recursive: true, force: true }); throw e; }
      return null;
    },
    library_import: ({ src, rel }) => {
      const parts = checkLibRef(rel);
      const { dir } = libraryDirOf(), look = joinChecked(dir, parts.slice(0, 2));
      if (!isDir(look)) throw new Error(`no look ${parts[1]} in the Library`);
      return `looks/${parts[1]}/refs/${copyRef(src, path.join(look, 'refs'), cleanFileName(parts[3]), dir)}`;
    },
    import_ref: ({ src, dest }) => {
      const parts = checkRefDest(dest);
      const scene = joinChecked(root, parts.slice(0, 2));
      if (!isDir(scene)) throw new Error(`no scene folder scenes/${parts[1]} (create the scene first)`);
      return `scenes/${parts[1]}/refs/${copyRef(src, path.join(scene, 'refs'), cleanFileName(parts[3]), root)}`;
    },
    set_settings: ({ settings }) => patchSettings(settings, false),
    patch_settings: ({ patch }) => {
      const d = typeof patch?.engineDir === 'string' ? patch.engineDir.trim() : '';
      if (d && !fs.existsSync(path.join(d, 'runner', 'cli.js'))) {
        throw new Error(isDir(d) ? `No gfx engine in ${d}: runner/cli.js is missing. Choose the folder that contains runner/ (the gfx engine or repo).` : `Engine folder not found: ${d}`);
      }
      return patchSettings(patch, true);
    },
    engine_info: () => {
      const e = engineLoc();
      return { path: e.dir, source: e.source, found: e.found, wsl: false, error: e.found ? null : `engine not found at ${e.dir}`, setting: String(readSettings().engineDir || '') };
    },
    // twin of lib.rs engines_info: the default engine, then the WSL engines recorded in engines.json next to settings.json
    // (in the shim their Linux paths are read directly)
    engines_info: () => {
      const e = engineLoc(), ver = (d) => readJsonFile(path.join(d, 'package.json'))?.version || null;
      const rows = [{ kind: 'default', distro: null, path: e.dir, version: e.found ? ver(e.dir) : null, found: e.found, source: e.source, wsl: false, error: e.found ? null : `engine not found at ${e.dir}` }];
      const wsl = readJsonFile(path.join(path.dirname(settingsFile), 'engines.json'))?.wsl || {};
      for (const [distro, inst] of Object.entries(wsl)) {
        if (!String(inst?.path || '').startsWith('/')) continue;
        const found = fs.existsSync(path.join(inst.path, 'runner', 'cli.js'));
        rows.push({ update: inst.version !== readJsonFile(path.join(repo, 'apps/studio/src-tauri/tauri.conf.json')).version, kind: 'wsl', distro, path: inst.path, version: ver(inst.path) || inst.version || null, found, source: 'installed', wsl: true, error: found ? null : `no engine at ${inst.path} in WSL ${distro} (reinstall it: Settings → Engine & tools)` });
      }
      return rows;
    },
    settings_meta: () => ({ defaults: { projectsDir: path.join(os.homedir(), 'Documents', 'gfx projects'), libraryDir: path.join(os.homedir(), 'Documents', 'gfx library') }, configDir: path.dirname(settingsFile), version: '0.1.0', platform: 'other' }),
    get_project_settings: () => {
      const j = readJsonFile(path.join(root, 'gfx.json'));
      return { gfxJson: fs.existsSync(path.join(root, 'gfx.json')), settings: sanitizeProject(j?.settings) };
    },
    patch_project_settings: ({ patch }) => {
      const f = path.join(root, 'gfx.json');
      if (!fs.existsSync(f)) throw new Error('this project has no gfx.json; project settings are stored there (run `gfx init` for this folder)');
      const text = fs.readFileSync(f, 'utf8');
      let cur;
      try { cur = JSON.parse(text); } catch (e) { throw new Error(`gfx.json is not valid JSON (${e.message}); fix it first`); }
      const next = patchProject(sanitizeProject(cur.settings), patch);
      const out = setSettingsText(text, next);
      if (out !== text) writeAtomic(f, out);
      return { gfxJson: true, settings: next };
    },
    // welcome window twins (welcome.rs); the browser has no second window: the welcome window is the page welcome.html
    recent_list: () => {
      const r = readRecent();
      return { recent: r.recent.map((e) => projItem(e.path, e)), folders: r.folders.map((f) => ({ path: f, missing: !isDir(f), projects: projectsIn(f).map((p) => projItem(p)) })) };
    },
    classify_folder: ({ path: p }) => { const i = infoOf(p); return { exists: i.exists, isProject: i.isProject, name: i.name, projects: i.exists && !i.isProject ? projectsIn(p).length : 0 }; },
    recent_touch: ({ path: p }) => editRecent((r) => touchRecent(r, p, infoOf(p).name, Date.now())),
    recent_remove: ({ path: p }) => editRecent((r) => removeRecent(r, p)),
    recent_pin: ({ path: p, pinned }) => editRecent((r) => pinRecent(r, p, pinned)),
    recent_relocate: ({ from, to, folder }) => {
      const i = infoOf(to);
      if (!i.exists) throw new Error(`not a folder: ${to}`);
      if (folder) return editRecent((r) => relocateFolder(r, from, to));
      if (!i.isProject) throw new Error(`no gfx project in ${to} (it needs a gfx.json or a scenes folder)`);
      return editRecent((r) => relocateRecent(r, from, to, i.name, Date.now()));
    },
    folder_add: ({ path: p }) => { if (!isDir(p)) throw new Error(`not a folder: ${p}`); return editRecent((r) => addFolder(r, p)); },
    folder_remove: ({ path: p }) => editRecent((r) => removeFolder(r, p)),
    recent_import: ({ entries }) => editRecent((r) => {
      const list = [...r.recent];
      for (const e of entries || []) if (e?.path && !list.some((x) => pathKey(x.path) === pathKey(e.path))) list.push({ path: e.path, name: e.name || '', opened: +e.opened || 0, pinned: false });
      return { ...r, recent: sortCap(list, null) };
    }),
    list_templates: ({ folder } = {}) => {
      const d = path.join(targetEngine(folder) || engineDir(), 'templates', 'projects');
      return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('_')).map((e) => e.name).sort();
    },
    reveal_project: ({ path: p }) => { if (!isKnown(readRecent(), p)) throw new Error('not a listed project'); return null; },
    open_app_folder: () => path.dirname(settingsFile),
    open_in_editor: ({ rel }) => { const p = safe(rel); if (!fs.existsSync(p)) throw new Error(`not found: ${rel}`); return p; },
    main_open: () => true,
    open_welcome: () => null,
    close_welcome: () => null,
    welcome_open: ({ path: p }) => {
      const i = infoOf(p);
      if (!i.exists) throw new Error(`Folder not found: ${p}`);
      if (!i.isProject) throw new Error(`No gfx project here: ${p}`);
      root = path.resolve(p); libScope = null; ptyCloseAll();
      editRecent((r) => touchRecent(r, p, i.name, Date.now()));
      return 'opened';
    },
    welcome_settings: () => null,
    open_link: ({ url }) => { checkLink(url); return null; },
    ...t3Ops({ getRoot: () => root }), // docs/T3.md: twins of the t3_* commands in src-tauri/src/t3.rs
    pick_folder: () => null,
    pick_refs: () => [], // the page asks with a prompt instead (api.pickRefs)
    list_project_scenes: () => {
      const dir = path.join(root, 'scenes');
      if (!fs.existsSync(dir)) return [];
      const out = [];
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const sj = path.join(dir, d.name, 'scene.json');
        if (!d.isDirectory() || !fs.existsSync(sj)) continue;
        let j = {};
        try { j = JSON.parse(fs.readFileSync(sj, 'utf8')); } catch { /* unreadable scene.json: defaults */ }
        const o = path.join(root, 'out', d.name);
        out.push({
          name: d.name, title: typeof j.title === 'string' ? j.title : null, width: j.width || 1080, height: j.height || 1920, fps: j.fps || 60, duration: j.duration || 0,
          hasVideo: fs.existsSync(path.join(o, `${d.name}.mp4`)), hasCues: fs.existsSync(path.join(o, 'audio', 'cues.json')), mtime: Math.round(fs.statSync(sj).mtimeMs),
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    project_info: ({ path: p }) => {
      const exists = fs.existsSync(p) && fs.statSync(p).isDirectory();
      let gj = null;
      try { gj = JSON.parse(fs.readFileSync(path.join(p, 'gfx.json'), 'utf8')); } catch { /* none */ }
      let scenes = 0;
      try { scenes = fs.readdirSync(path.join(p, 'scenes'), { withFileTypes: true }).filter((d) => d.isDirectory() && fs.existsSync(path.join(p, 'scenes', d.name, 'scene.json'))).length; } catch { /* none */ }
      return { exists, name: gj?.name || path.basename(p), isProject: !!gj || exists && fs.existsSync(path.join(p, 'scenes')), scenes };
    },
    get_root: () => root,
    set_root: ({ path: p }) => { if (!fs.statSync(p).isDirectory()) throw new Error('not a directory'); root = path.resolve(p); libScope = null; ptyCloseAll(); return null; },
    lib_locate: async () => { const s = await locateLibrary(true); return { library: s.lib, dir: s.lib, error: s.error }; },
    pick_root: () => null,
    list_scenes: () => {
      const out = path.join(root, 'out');
      if (!fs.existsSync(out)) return [];
      return fs.readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory())
        .map((d) => ({ name: d.name, cues: path.join(out, d.name, 'audio', 'cues.json') }))
        .filter((d) => fs.existsSync(d.cues))
        .map((d) => ({ name: d.name, hasVideo: fs.existsSync(path.join(out, d.name, `${d.name}.mp4`)), mtime: Math.round(fs.statSync(d.cues).mtimeMs) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    read_text: ({ rel }) => { const p = safe(rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; },
    write_text: ({ rel, text }) => { writeReviewFile(rel, text); return null; },
    // scenes/<scene>/render.json only (saved render presets); twin of check_project_writable in lib.rs
    write_project_text: ({ rel, text }) => {
      const r = String(rel).replace(/^\.\//, '');
      if (!/^scenes\/[^/\\:]+\/render\.json$/.test(r) || r.split('/')[1] === '..') throw new Error(`write not allowed (only scenes/<scene>/render.json): ${rel}`);
      const p = safe(r);
      if (!fs.existsSync(path.dirname(p))) throw new Error(`no such scene: ${rel}`);
      fs.writeFileSync(p, text);
      return null;
    },
    list_renders: ({ scene }) => {
      if (typeof scene !== 'string' || !/^[^/\\:]+$/.test(scene) || scene === '..' || scene === '.') throw new Error(`bad scene name: ${scene}`);
      const dir = safe(`out/${scene}`);
      if (!fs.existsSync(dir)) return [];
      const EXT = ['.mp4', '.webm', '.gif', '.mov', '.png', '.mkv', '.m4v', '.jpg'];
      const v = [];
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const st = fs.statSync(path.join(dir, d.name));
        const isDir = d.isDirectory();
        if (!(isDir ? d.name.startsWith('frames') : EXT.includes(path.extname(d.name).toLowerCase()))) continue;
        v.push({ name: d.name, size: isDir ? 0 : st.size, mtime: Math.round(st.mtimeMs), isDir });
      }
      return v.sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
    },
    // out/ only; the browser has no Explorer, so reveal / open just return the path
    reveal_path: ({ rel }) => { if (!/^out\/[^/]/.test(String(rel).replace(/^\.\//, ''))) throw new Error(`only paths under out/ can be revealed or opened: ${rel}`); return safe(rel); },
    open_path: ({ rel }) => { if (!/^out\/[^/]/.test(String(rel).replace(/^\.\//, ''))) throw new Error(`only paths under out/ can be revealed or opened: ${rel}`); return safe(rel); },
    // Code workspace (docs/CODE-VERSIONS.md §3); twins of list_project_files / write_project_file in lib.rs
    list_project_files: () => {
      const files = [];
      let truncated = false;
      const walk = (dir, prefix, depth) => {
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (e.isSymbolicLink()) continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) { if (!SKIP_DIRS.includes(e.name) && depth < 16) walk(path.join(dir, e.name), rel, depth + 1); continue; }
          if (files.length >= 5000) { truncated = true; continue; }
          let st = null;
          try { st = fs.statSync(path.join(dir, e.name)); } catch { /* vanished */ }
          files.push({ path: rel, size: st?.size || 0, mtime: Math.round(st?.mtimeMs || 0), writable: isSourceWritable(rel) });
        }
      };
      walk(root, '', 0);
      files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return { files, truncated };
    },
    write_project_file: ({ rel, text, expectMtime, expectText }) => {
      const r = checkSourceWritable(rel);
      const p = safe(r);
      const mtime = fs.existsSync(p) ? Math.round(fs.statSync(p).mtimeMs) : 0;
      const current = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
      checkSourceVersion(mtime, current, expectMtime, expectText);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, String(text ?? ''));
      return { mtime: Math.round(fs.statSync(p).mtimeMs) };
    },
    stat: ({ rel }) => { const p = safe(rel); return fs.existsSync(p) ? { mtime: Math.round(fs.statSync(p).mtimeMs) } : null; },
  };
  return {
    name: 'gfx-studio-dev-shim',
    configureServer(server) {
      server.httpServer?.once('close', () => { killAllJobs(); ptyCloseAll(); });
      process.once('exit', () => { killAllJobs(); ptyCloseAll(); });
      // terminal output as Server-Sent Events: { data } batches (~16 ms), then { exit }
      server.middlewares.use('/__api/pty_events', (req, res) => {
        const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
        const p = ptys.get(id);
        if (!p) { res.statusCode = 404; return res.end('no such terminal'); }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const send = (ev) => { res.write(`data: ${JSON.stringify(ev)}\n\n`); if ('exit' in ev) res.end(); };
        for (const ev of p.backlog.splice(0)) send(ev);
        if (p.exited) return res.end();
        p.subs.add(send);
        req.on('close', () => p.subs.delete(send));
      });
      // job events as Server-Sent Events: replays everything so far, then streams; ends after the `exit` event
      server.middlewares.use('/__api/engine_events', (req, res) => {
        const id = new URL(req.url, 'http://x').searchParams.get('job') || '';
        const job = jobs.get(id);
        if (!job) { res.statusCode = 404; return res.end('no such job'); }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        const send = (ev) => { res.write(`data: ${JSON.stringify(ev)}\n\n`); if (ev.type === 'exit') res.end(); };
        for (const ev of job.events) send(ev);
        if (job.done) return;
        job.subs.add(send);
        req.on('close', () => job.subs.delete(send));
      });
      // dev twin of the gfxlib:// scheme: GET /__lib/f/<encoded path> (read-only; same guard as the Rust side)
      server.middlewares.use('/__lib/f', async (req, res) => {
        res.setHeader('access-control-allow-origin', '*');
        try {
          let sc = await locateLibrary();
          if (sc.root !== root) sc = await locateLibrary(); // the project changed meanwhile
          const p = resolveLib(root, decodeURIComponent(req.url.split('?')[0].replace(/^\//, '')), { lib: sc.root === root ? sc.lib : null });
          const type = mimeOf(p);
          if (!type) throw new Error('type not served');
          if (!fs.existsSync(p)) { res.statusCode = 404; return res.end('not found'); }
          res.setHeader('content-type', type); res.setHeader('cache-control', 'no-cache');
          fs.createReadStream(p).pipe(res);
        } catch (e) { res.statusCode = 403; res.end(String(e.message || e)); }
      });
      server.middlewares.use('/__api', async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const op = url.pathname.replace(/^\//, '');
        const send = (code, type, data) => { res.statusCode = code; res.setHeader('content-type', type); res.setHeader('cache-control', 'no-store'); res.end(data); };
        try {
          if (op === 'write_bytes') {
            const chunks = [];
            for await (const c of req) chunks.push(c);
            writeReviewFile(url.searchParams.get('rel'), Buffer.concat(chunks));
            return send(200, 'application/json', '{"result":null}');
          }
          if (op === 'project_thumb') {
            const p = url.searchParams.get('path') || '';
            if (!isKnown(readRecent(), p)) return send(400, 'application/json', JSON.stringify({ error: 'not a listed project' }));
            const t = thumbOf(p);
            if (!t) return send(404, 'application/json', JSON.stringify({ error: 'no thumbnail' }));
            return send(200, 'image/png', fs.readFileSync(t));
          }
          if (op === 'read_bytes') {
            const p = safe(url.searchParams.get('rel'));
            if (!fs.existsSync(p)) return send(404, 'application/json', JSON.stringify({ error: `not found: ${url.searchParams.get('rel')}` }));
            return send(200, 'application/octet-stream', fs.readFileSync(p));
          }
          if (op === 'library_read_bytes') { // twin of library.rs read_lib_bytes: images and mp4 / webm clips inside a look, ≤ 20 MB
            const rel = url.searchParams.get('rel') || '';
            const parts = checkLibBytes(rel);
            const p = joinChecked(libraryDirOf().dir, parts);
            let st; try { st = fs.statSync(p); } catch { return send(404, 'application/json', JSON.stringify({ error: `not found: ${rel}` })); }
            if (!st.isFile() || st.size > MAX_THUMB) throw new Error(`${rel}: not a file or larger than 20 MB`);
            return send(200, 'application/octet-stream', fs.readFileSync(p));
          }
          if (!ops[op]) return send(404, 'application/json', JSON.stringify({ error: `unknown op ${op}` }));
          const args = req.method === 'POST' ? await body(req) : {};
          send(200, 'application/json', JSON.stringify({ result: (await ops[op](args)) ?? null }));
        } catch (e) {
          send(400, 'application/json', JSON.stringify({ error: String(e.message || e), code: e.code, mtime: e.mtime, text: e.text }));
        }
      });
    },
  };
}

// runner/lib/vox-features.js (via @vox / @rank: feature vectors for the sound index) imports transformers.js lazily for CLAP,
// which the studio never calls; the onnxruntime wasm files the bundler emits for it are unreferenced: drop them (~27 MB).
function dropOrtWasm() {
  return {
    name: 'gfx-studio-drop-ort-wasm',
    generateBundle(_o, bundle) { for (const k of Object.keys(bundle)) if (/ort-wasm.*\.(wasm|mjs)$/.test(k)) delete bundle[k]; },
  };
}

// The repo's own licence texts, served next to public/licenses/ (Settings → About shows them; docs/HOME-SETTINGS.md).
const REPO_LICENCES = {
  'LICENSE-gfx.txt': 'LICENSE', 'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  // the engine's scene fonts (style/fonts; About → Scene fonts). A missing file is skipped (404 in dev, not bundled).
  ...Object.fromEntries(['Fraunces', 'Nunito', 'Fredoka', 'Space-Grotesk', 'Ubuntu'].map((f) => [`LICENSE-${f}.txt`, `style/fonts/LICENSE-${f}.txt`])),
};
function licenceAssets() {
  return {
    name: 'gfx-studio-licences',
    configureServer(server) {
      server.middlewares.use('/licenses', (req, res, next) => {
        const src = REPO_LICENCES[decodeURIComponent(req.url.split('?')[0].replace(/^\//, ''))];
        if (!src || !fs.existsSync(path.join(repo, src))) return next();
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        fs.createReadStream(path.join(repo, src)).pipe(res);
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(REPO_LICENCES)) if (fs.existsSync(path.join(repo, src))) this.emitFile({ type: 'asset', fileName: `licenses/${name}`, source: fs.readFileSync(path.join(repo, src)) });
    },
  };
}

export default defineConfig(({ command }) => ({
  root: here,
  cacheDir: path.join(repo, 'node_modules/.vite-studio'), // never share the gfx servers' dep cache
  base: './',
  plugins: [devShim(), dropOrtWasm(), licenceAssets()],
  resolve: { alias: { '@sfx': path.join(repo, 'runner/lib/sfx.js'), '@vox': path.join(repo, 'runner/lib/vox-features.js'), '@rank': path.join(repo, 'runner/lib/sound-rank.js') } },
  // transformers.js / onnxruntime: never run in the studio (see dropOrtWasm); keep the dev pre-bundler away from them
  optimizeDeps: { exclude: ['@huggingface/transformers', 'onnxruntime-web'] },
  server: { host: '127.0.0.1', port: 5177, fs: { allow: [repo] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1500, rollupOptions: { input: { main: path.join(here, 'index.html'), welcome: path.join(here, 'welcome.html'), ...(command === 'serve' || process.env.GFX_STYLEGUIDE === '1' ? { styleguide: path.join(here, 'styleguide.html') } : {}) } } },
}));
