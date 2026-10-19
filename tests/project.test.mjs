// Engine vs project test (docs/FOUNDATION.md §1-3): gfx init, project resolution, preset override, library paths,
// zip extraction, --progress json. Run: node tests/project.test.mjs   (capture parts need Chrome/Edge or GFX_CHROME)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-project-test-'));
const cli = (args, { cwd = tmp, env = {} } = {}) => {
  const e = { ...process.env, ...env };
  delete e.GFX_PROJECT;
  if (env.GFX_PROJECT) e.GFX_PROJECT = env.GFX_PROJECT;
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, encoding: 'utf8', timeout: 300000 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const jsonLines = (s) => s.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { bad: l }; } });

const P = await import('../runner/lib/paths.js');
const proj = path.join(tmp, 'proj');

try {
  console.log('paths');
  ok(P.samePath(P.ENGINE, ROOT), 'ENGINE is the repo root');
  ok(fs.existsSync(path.join(ROOT, 'gfx.json')) && P.samePath(P.findProject(path.join(ROOT, 'runner', 'lib')), ROOT), 'repo has gfx.json; walk-up from runner/lib finds the repo');
  {
    const saved = process.env.GFX_PROJECT;
    delete process.env.GFX_PROJECT;
    const cwd = process.cwd();
    process.chdir(os.tmpdir());
    const fallback = P.findProject() ? null : P.projectRoot();
    process.chdir(cwd);
    ok(fallback === null || P.samePath(fallback, P.ENGINE), 'no gfx.json above cwd -> engine root (back-compat)');
    process.env.GFX_PROJECT = tmp;
    ok(P.projectRoot() === path.resolve(tmp), 'GFX_PROJECT wins');
    if (saved === undefined) delete process.env.GFX_PROJECT; else process.env.GFX_PROJECT = saved;
  }
  {
    const saved = process.env.GFX_LIBRARY;
    process.env.GFX_LIBRARY = path.join(tmp, 'lib');
    ok(P.libraryDir() === path.join(tmp, 'lib') && P.binDir() === path.join(tmp, 'bin'), 'GFX_LIBRARY sets the library; bin/ is next to it');
    delete process.env.GFX_LIBRARY;
    const legacy = fs.existsSync(path.join(ROOT, 'library'));
    ok(legacy ? P.libraryDir() === path.join(ROOT, 'library') : P.libraryDir().endsWith(path.join('gfx', 'library')), 'default library: <engine>/library when present, else the per-user data dir');
    if (saved !== undefined) process.env.GFX_LIBRARY = saved;
  }

  console.log('gfx init');
  let r = cli(['init', proj, '--template', 'reel', '--name', 'Test Project']);
  ok(r.code === 0, 'init exits 0', r.err);
  const gj = JSON.parse(fs.readFileSync(path.join(proj, 'gfx.json'), 'utf8'));
  ok(gj.version === 1 && gj.name === 'Test Project' && /^>=\d+\.\d+$/.test(gj.engine), 'gfx.json written', gj);
  ok(['.gitignore', 'CLAUDE.md', 'scenes/reel/scene.json', 'scenes/reel/scene.js', 'scenes/reel/STORYBOARD.md', '.claude/skills/motion-graphics/SKILL.md', 'out'].every((f) => fs.existsSync(path.join(proj, f))), 'template, skills, CLAUDE.md, .gitignore, out/ present');
  ok(/out\//.test(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8')), '.gitignore ignores out/');
  ok(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8').split('\n').includes('.gfx/'), '.gitignore ignores .gfx/ (indexes, thumbs, engine.json)');
  {
    const er = JSON.parse(fs.readFileSync(path.join(proj, '.gfx', 'engine.json'), 'utf8'));
    ok(P.samePath(er.engine, ROOT) && P.samePath(er.bin, path.join(ROOT, 'bin', process.platform === 'win32' ? 'gfx.cmd' : 'gfx')) && er.node === process.execPath && !Number.isNaN(Date.parse(er.updated)), 'init writes .gfx/engine.json (this engine, its bin, node)', er);
    ok(!('wsl' in er), 'engine.json: no wsl key for a project on the engine\'s own filesystem', er);
  }
  ok(!/\{\{/.test(fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8')), 'CLAUDE.md placeholders filled');
  r = cli(['init', proj]);
  ok(r.code !== 0 && /already a gfx project/.test(r.err), 'init refuses an existing project');
  r = cli(['init', path.join(tmp, 'x'), '--template', 'nope']);
  ok(r.code !== 0 && /unknown template/.test(r.err), 'init rejects unknown templates');
  r = cli(['init', path.join(tmp, 'blank')]);
  ok(r.code === 0 && fs.existsSync(path.join(tmp, 'blank', 'gfx.json')), 'blank template');
  // "Make it a project" (welcome window): a folder with files only with --existing, nothing overwritten
  const ex = path.join(tmp, 'existing');
  fs.mkdirSync(ex); fs.writeFileSync(path.join(ex, 'CLAUDE.md'), 'MINE'); fs.writeFileSync(path.join(ex, '.gitignore'), 'node_modules/\n');
  r = cli(['init', ex, '--template', 'blank']);
  ok(r.code !== 0 && /not empty/.test(r.err) && !fs.existsSync(path.join(ex, 'gfx.json')), 'init refuses a folder with files');
  r = cli(['init', ex, '--template', 'blank', '--existing']);
  ok(r.code === 0 && fs.existsSync(path.join(ex, 'gfx.json')) && fs.readFileSync(path.join(ex, 'CLAUDE.md'), 'utf8') === 'MINE', 'init --existing adds the project, keeps CLAUDE.md', r.err);
  ok(fs.readFileSync(path.join(ex, '.gitignore'), 'utf8').startsWith('node_modules/\n') && fs.readFileSync(path.join(ex, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.gfx/').length === 1, 'init --existing appends to .gitignore (.gfx/ once)');

  console.log('project resolution');
  r = cli(['list'], { cwd: path.join(proj, 'scenes', 'reel') });
  ok(r.code === 0 && /^reel\s+anime\s+1080x1920/m.test(r.out) && !/_reel-test/.test(r.out), 'walk-up from a scene folder lists the project scenes', r.out);
  r = cli(['list', '--project', proj]);
  ok(r.code === 0 && /^reel\s/m.test(r.out), '--project from elsewhere');
  r = cli(['list'], { env: { GFX_PROJECT: proj } });
  ok(r.code === 0 && /^reel\s/m.test(r.out), 'GFX_PROJECT from elsewhere');
  r = cli(['doctor', '--json', '--project', proj]);
  const doc = JSON.parse(r.out);
  ok(P.samePath(doc.project.path, proj) && doc.project.gfxJson && !doc.project.engineIsProject && doc.project.engineOk, 'doctor --json reports the project', doc.project);
  ok(P.samePath(doc.engine.path, ROOT) && typeof doc.ok === 'boolean' && Array.isArray(doc.missing) && r.code === (doc.ok ? 0 : 1), 'doctor --json: engine, ok, missing, exit code');
  const { engineSatisfies } = await import('../runner/lib/cli/commands/project.js');
  ok(engineSatisfies('>=0.2', '0.2.0') && engineSatisfies('>=0.2', '1.0.0') && !engineSatisfies('>=0.3', '0.2.9') && engineSatisfies(undefined), 'engine range check');

  console.log('library sources from gfx.json');
  {
    fs.mkdirSync(path.join(proj, 'sfx'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'gfx.json'), JSON.stringify({ ...gj, library: { sources: [{ id: 'proj-sfx', path: 'sfx', license: 'own' }] } }));
    r = cli(['lib', 'list', '--project', proj], { env: { GFX_LIBRARY: path.join(tmp, 'lib') } });
    ok(r.code === 0 && /^proj-sfx\s+folder\s+enabled/m.test(r.out) && /^synth\s/m.test(r.out), 'project source listed next to the global ones', r.out);
    r = cli(['lib', 'disable', 'proj-sfx', '--project', proj], { env: { GFX_LIBRARY: path.join(tmp, 'lib') } });
    ok(r.code !== 0 && /gfx\.json/.test(r.err), 'project sources are edited in gfx.json, not via lib enable/disable');
    fs.writeFileSync(path.join(proj, 'gfx.json'), JSON.stringify(gj, null, 2) + '\n');
  }

  console.log('project index isolation');
  {
    const savedProject = process.env.GFX_PROJECT, savedLibrary = process.env.GFX_LIBRARY;
    process.env.GFX_LIBRARY = path.join(tmp, 'sounds');
    const C = await import('../runner/lib/library/config.js');
    const projects = [proj, path.join(tmp, 'blank')];
    const files = [];
    try {
      for (const [i, dir] of projects.entries()) {
        const config = JSON.parse(fs.readFileSync(path.join(dir, 'gfx.json'), 'utf8'));
        fs.writeFileSync(path.join(dir, 'gfx.json'), JSON.stringify({ ...config, library: { sources: [{ id: 'local', path: 'sfx' }] } }));
        process.env.GFX_PROJECT = dir;
        const file = C.indexFile('local');
        files.push(file);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({ id: `local:project-${i}`, src: path.join(dir, 'sfx', 'test.wav') }) + '\n');
      }
      ok(files.every((f, i) => f === path.join(projects[i], '.gfx', 'index', 'local.jsonl')), 'same-id project indexes have project-local storage', files);
      for (const [i, dir] of projects.entries()) {
        process.env.GFX_PROJECT = dir;
        ok(C.readIndex('local')[0]?.id === `local:project-${i}`, `project ${i} reads only its own local source index`);
        const listed = cli(['lib', 'list', '--project', dir], { env: { GFX_LIBRARY: C.LIB } });
        ok(listed.code === 0 && /^local\s+folder.*indexed\s+1/m.test(listed.out), `project ${i} lib list reads its own index`, listed);
      }
      ok(C.indexFile('synth') === path.join(C.LIB, 'index', 'synth.jsonl') && !fs.existsSync(path.join(C.LIB, 'index', 'local.jsonl')), 'global indexes stay shared; project indexes never write there');
    } finally {
      fs.writeFileSync(path.join(proj, 'gfx.json'), JSON.stringify(gj));
      if (savedProject === undefined) delete process.env.GFX_PROJECT; else process.env.GFX_PROJECT = savedProject;
      if (savedLibrary === undefined) delete process.env.GFX_LIBRARY; else process.env.GFX_LIBRARY = savedLibrary;
    }
  }

  console.log('fetch registration with a custom library directory');
  {
    // Exercise both real fetch paths with in-memory HTTP responses; no external downloads.
    const zip = Buffer.from(zipSync({ 'test.wav': strToU8('audio fixture') })).toString('base64');
    const script = `
      import { cmdLib } from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'runner/lib/cli/commands/lib.js')).href)};
      import * as C from ${JSON.stringify(pathToFileURL(path.join(ROOT, 'runner/lib/library/config.js')).href)};
      globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('kenney.nl/assets/')) return new Response('<a href="https://kenney.nl/media/test.zip">zip</a>');
        if (u === 'https://kenney.nl/media/test.zip') return new Response(Buffer.from(${JSON.stringify(zip)}, 'base64'));
        if (u.startsWith('https://freesound.org/apiv2/search/text/')) return Response.json({ results: [{ id: 1, name: 'test', previews: { 'preview-hq-ogg': 'https://fixture.test/test.ogg' } }], next: null });
        if (u === 'https://fixture.test/test.ogg') return new Response('audio fixture');
        throw new Error('unexpected fetch: ' + u);
      };
      await cmdLib('fetch', { packs: 'ui' }, ['fetch', 'kenney']);
      await cmdLib('fetch', { query: 'test', n: 1 }, ['fetch', 'freesound']);
      const sources = C.loadSources({ project: false }).sources.filter((s) => s.kind === 'folder');
      console.log(JSON.stringify(sources.map((s) => ({ id: s.id, dir: C.sourceDir(s), files: C.walkAudio(C.sourceDir(s)).length }))));
    `;
    const lib = path.join(tmp, 'custom', 'sounds');
    const fetched = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: tmp, env: { ...process.env, GFX_LIBRARY: lib, FREESOUND_API_KEY: 'fixture' }, encoding: 'utf8', timeout: 30000 });
    if (fetched.error) throw fetched.error;
    ok(fetched.status === 0, 'mocked Kenney and Freesound fetch commands succeed', fetched.stderr);
    const sources = fetched.status === 0 ? JSON.parse(fetched.stdout.trim().split('\n').at(-1)) : [];
    for (const id of ['kenney', 'freesound-cc0']) {
      const src = sources.find((s) => s.id === id);
      ok(src?.dir === path.join(lib, id) && src.files === 1, `${id} registration resolves to the actual custom library folder`, src);
    }
  }

  console.log('setup chrome (pinned headless shell, local fake zip)');
  {
    const B = await import('../runner/lib/browser.js');
    const plat = B.chromePlatform();
    if (!plat) ok(true, `setup chrome: no pinned build for ${process.platform}-${process.arch}, skipped`);
    else {
      const exeName = plat === 'win64' ? 'chrome-headless-shell.exe' : 'chrome-headless-shell';
      const zip = Buffer.from(zipSync({ [`chrome-headless-shell-${plat}/${exeName}`]: strToU8('#!/bin/sh\necho "Fake Chrome 1.0"\n'), [`chrome-headless-shell-${plat}/icudtl.dat`]: strToU8('x') }));
      let hits = 0;
      const bad = Buffer.from(zipSync({ 'something-else/readme.txt': strToU8('no shell here') }));
      const srv = http.createServer((q, res) => { hits++; const z = q.url.includes('bad') ? bad : zip; res.writeHead(200, { 'content-type': 'application/zip', 'content-length': z.length }); res.end(z); });
      await new Promise((r) => srv.listen(0, '127.0.0.1', r));
      const url = `http://127.0.0.1:${srv.address().port}/chrome-headless-shell.zip`;
      const lib = path.join(tmp, 'chromelib', 'library');
      // async spawn: the fake download server lives in this process, so spawnSync would deadlock it
      const acli = (args, extra = {}) => new Promise((resolve) => {
        const e = { ...process.env, GFX_LIBRARY: lib, GFX_CHROME_URL: url, ...extra };
        delete e.GFX_CHROME;
        delete e.GFX_PROJECT;
        const c = spawn(process.execPath, [CLI, ...args], { cwd: tmp, env: e });
        let out = '', err = '';
        c.stdout.on('data', (x) => { out += x; });
        c.stderr.on('data', (x) => { err += x; });
        c.on('close', (code) => resolve({ code, out, err }));
      });
      const exe = B.pinnedPath(path.join(tmp, 'chromelib', 'browsers'));
      let r2 = await acli(['setup', 'chrome', '--progress', 'json']);
      const L = jsonLines(r2.out);
      ok(r2.code === 0 && fs.existsSync(exe) && L.some((x) => x.type === 'progress' && x.phase === 'download') && L.at(-1).type === 'done' && L.at(-1).outputs[0] === exe, 'setup chrome installs into <library-parent>/browsers (+ download progress, done event)', r2.out + r2.err);
      ok(fs.existsSync(path.join(path.dirname(exe), 'icudtl.dat')), 'whole archive extracted next to the shell');
      if (process.platform !== 'win32') ok((fs.statSync(exe).mode & 0o111) !== 0, 'the shell is executable');
      const hits1 = hits;
      r2 = await acli(['setup', 'chrome']);
      ok(r2.code === 0 && hits === hits1 && /already installed/.test(r2.out), 'second run does not download', r2.out);
      r2 = await acli(['setup', 'chrome', '--force']);
      ok(r2.code === 0 && hits === hits1 + 1, '--force downloads again', r2.out);
      r2 = await acli(['doctor', '--json']);
      const dj = JSON.parse(r2.out);
      ok(dj.browser?.pinned === true && dj.browser.source === 'pinned' && P.samePath(dj.browser.path, exe) && dj.pinnedBrowser.installed === true, 'doctor: pinned shell is the discovered browser', dj.browser);
      r2 = await acli(['doctor']);
      ok(/\[pinned\]/.test(r2.out), 'doctor text names the pinned browser', r2.out.slice(0, 400));
      r2 = await acli(['setup', 'chrome', '--force'], { GFX_CHROME_URL: url.replace('chrome-headless-shell.zip', 'bad.zip') });
      ok(r2.code !== 0 && fs.existsSync(exe) && fs.existsSync(path.join(path.dirname(exe), 'icudtl.dat')) && !fs.readdirSync(path.join(tmp, 'chromelib', 'browsers', 'chrome-headless-shell')).some((n) => n.includes('.staging-')), 'archive without the shell -> error, existing install intact, no staging dir left', r2.err.slice(0, 200));
      srv.close();
      r2 = await acli(['setup', 'chrome', '--force'], { GFX_CHROME_URL: 'http://127.0.0.1:1/x.zip' });
      ok(r2.code !== 0 && fs.existsSync(exe), 'unreachable URL -> error exit, existing install kept', r2.err.slice(0, 200));
    }
  }

  console.log('zip');
  {
    const { extractZip } = await import('../runner/lib/fetchfile.js');
    const z = Buffer.from(zipSync({ 'pack/a.txt': strToU8('A'), 'pack/sub/b.wav': strToU8('B'), 'pack/bin/ffmpeg.exe': strToU8('X') }));
    const d = path.join(tmp, 'unz');
    const files = extractZip(z, d);
    ok(files.length === 3 && fs.readFileSync(path.join(d, 'pack', 'sub', 'b.wav'), 'utf8') === 'B', 'extractZip writes all entries');
    const only = extractZip(z, path.join(tmp, 'unz2'), { filter: (n) => (n.endsWith('/bin/ffmpeg.exe') ? 'ffmpeg.exe' : false) });
    ok(only.length === 1 && fs.existsSync(path.join(tmp, 'unz2', 'ffmpeg.exe')), 'filter + rename (as used by setup ffmpeg)');
    let threw = false;
    try { extractZip(Buffer.from(zipSync({ '../evil.txt': strToU8('x') })), path.join(tmp, 'unz3')); } catch { threw = true; }
    ok(threw && !fs.existsSync(path.join(tmp, 'evil.txt')), 'zip-slip entries are refused');
  }

  console.log('--progress json');
  r = cli(['list', '--progress', 'json', '--project', proj]);
  let ev = jsonLines(r.out);
  ok(r.code === 0 && ev.every((e) => !e.bad) && ev.some((e) => e.type === 'log' && /reel/.test(e.msg)) && ev.at(-1).type === 'done', 'list: logs + done, nothing else on stdout', ev);
  r = cli(['still', 'nosuch', '--t', '0', '--progress', 'json', '--project', proj]);
  ev = jsonLines(r.out);
  ok(r.code !== 0 && ev.at(-1).type === 'error' && /not found/.test(ev.at(-1).msg) && ev.every((e) => !e.bad), 'failure: final {type:error}, exit != 0', ev);
  r = cli(['still', 'reel', '--t', '0', '--progress', 'yaml', '--project', proj]);
  ok(r.code !== 0, '--progress only accepts json');


  console.log('launcher, CLAUDE.md, refresh, context');
  {
    const gfxBin = path.join(ROOT, 'bin', process.platform === 'win32' ? 'gfx.cmd' : 'gfx');
    const other = fs.mkdtempSync(path.join(tmp, 'other-'));
    const env = { ...process.env, GFX_PROJECT: proj };
    const rl = spawnSync(gfxBin, ['doctor', '--json'], { cwd: other, env, encoding: 'utf8', timeout: 120000, shell: process.platform === 'win32' });
    let dj = null; try { dj = JSON.parse(rl.stdout); } catch {}
    ok(dj && P.samePath(dj.engine.path, ROOT) && P.samePath(dj.project.path, proj), 'bin/gfx doctor --json from another cwd with GFX_PROJECT', (rl.stdout || '').slice(0, 200) + rl.stderr);
    const md = fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8');
    ok(md.includes('<!-- gfx:begin -->') && md.includes('<!-- gfx:end -->') && md.includes('gfx context'), 'init: CLAUDE.md has the managed block');
    ok(!md.includes(ROOT) && !/node "/.test(md) && !/[A-Za-z]:\\|\/home\//.test(md), 'init: CLAUDE.md has no absolute paths');
    fs.appendFileSync(path.join(proj, 'CLAUDE.md'), 'MY OWN NOTE\n');
    fs.writeFileSync(path.join(proj, 'CLAUDE.md'), fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8').replace('gfx project**', 'gfx project** INIT-OLD'));
    fs.rmSync(path.join(proj, '.claude', 'skills', 'svg'), { recursive: true, force: true });
    r = cli(['init', '--refresh'], { cwd: proj });
    const after = fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8');
    ok(r.code === 0 && after.includes('MY OWN NOTE') && !after.includes('INIT-OLD') && after.includes('<!-- gfx:end -->'), 'init --refresh rewrites the block, keeps user text', r.err);
    ok(fs.existsSync(path.join(proj, '.claude', 'skills', 'svg', 'SKILL.md')), 'init --refresh re-copies skills');
    ok(after.includes('.gfx/engine.json') && !after.includes('Terminals opened by gfx studio have'), 'managed block points to .gfx/engine.json, no PATH claim');
    // --no-skills (gfx studio on open): block + engine.json, skills untouched; .gitignore gets .gfx/ appended once
    fs.rmSync(path.join(proj, '.claude', 'skills', 'svg'), { recursive: true, force: true });
    fs.rmSync(path.join(proj, '.gfx', 'engine.json'));
    fs.writeFileSync(path.join(proj, '.gitignore'), 'out/\n# mine\nsecret.txt');
    fs.writeFileSync(path.join(proj, 'CLAUDE.md'), after.replace('gfx project**', 'gfx project** STALE'));
    r = cli(['init', '--refresh', '--no-skills'], { cwd: proj });
    const nb = fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8');
    ok(r.code === 0 && !nb.includes('STALE') && nb.includes('MY OWN NOTE'), 'init --refresh --no-skills rewrites the block', r.err);
    ok(!fs.existsSync(path.join(proj, '.claude', 'skills', 'svg')), 'init --refresh --no-skills leaves skills alone');
    ok(fs.existsSync(path.join(proj, '.gfx', 'engine.json')), 'init --refresh writes .gfx/engine.json');
    ok(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8') === 'out/\n# mine\nsecret.txt\n.gfx/\n', 'refresh appends .gfx/ to .gitignore, user lines kept');
    r = cli(['init', '--refresh', '--no-skills'], { cwd: proj });
    ok(fs.readFileSync(path.join(proj, '.gitignore'), 'utf8').split('\n').filter((l) => l === '.gfx/').length === 1, '.gfx/ is not added twice');
    fs.writeFileSync(path.join(proj, 'CLAUDE.md'), '# old hand-written\n');
    r = cli(['init', '--refresh'], { cwd: proj });
    const old = fs.readFileSync(path.join(proj, 'CLAUDE.md'), 'utf8');
    ok(r.code === 0 && old.startsWith('# old hand-written') && old.includes('<!-- gfx:begin -->'), 'init --refresh on a file without a block appends it');
    r = cli(['init', '--refresh'], { cwd: ROOT });
    ok(r.code !== 0 && /engine/.test(r.err), 'init --refresh refuses the engine project');
    ok(old.includes('<engine>/docs/CONTRACT.md') && old.includes('.gfx/skills-new/'), 'managed block names the contract path (<engine>/docs/CONTRACT.md) and skills-new');

    // managed skill copies (finding 21): .gfx/skills.json + sync rules (runner/lib/skills.js)
    const S = await import('../runner/lib/skills.js');
    const ESK = path.join(ROOT, '.claude', 'skills');
    const engineFiles = S.listFiles(ESK);
    const sk = path.join(tmp, 'skproj');
    r = cli(['init', sk, '--template', 'blank']);
    const PSK = path.join(sk, '.claude', 'skills');
    const recOf = () => JSON.parse(fs.readFileSync(path.join(sk, '.gfx', 'skills.json'), 'utf8'));
    const shaOf = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
    let rec = recOf();
    ok(r.code === 0 && rec.version === 1 && rec.engineHash === S.skillsHash(ESK) && Object.keys(rec.files).sort().join() === engineFiles.join() && engineFiles.every((f) => rec.files[f].sha256 === shaOf(fs.readFileSync(path.join(ESK, f)))) && rec.engine.version, 'init writes .gfx/skills.json (every engine skill file, sha256, engineHash, engine version)', r.err);
    ok(engineFiles.length > 6 && engineFiles.every((f) => fs.readFileSync(path.join(PSK, f)).equals(fs.readFileSync(path.join(ESK, f)))), 'init copies every engine skill file');
    // simulate an older engine install: untouched old copy (record = its hash), an edited one, a deleted one, a file the
    // engine dropped (untouched + edited), and the user's own skill
    const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(PSK, rel)), { recursive: true }); fs.writeFileSync(path.join(PSK, rel), text); };
    put('svg/SKILL.md', 'OLD ENGINE SVG\n'); rec.files['svg/SKILL.md'].sha256 = shaOf('OLD ENGINE SVG\n');
    rec.files['canvas2d/SKILL.md'].sha256 = shaOf('OLD ENGINE CANVAS\n'); put('canvas2d/SKILL.md', 'OLD ENGINE CANVAS\nMY EDIT\n');
    fs.rmSync(path.join(PSK, 'threejs', 'SKILL.md')); delete rec.files['threejs/SKILL.md'];
    put('gone/SKILL.md', 'GONE\n'); rec.files['gone/SKILL.md'] = { sha256: shaOf('GONE\n'), engine: '0.1.0' };
    put('gone2/SKILL.md', 'GONE2 EDITED\n'); rec.files['gone2/SKILL.md'] = { sha256: shaOf('GONE2\n'), engine: '0.1.0' };
    put('mine/SKILL.md', 'MY OWN SKILL\n');
    rec.engineHash = 'old';
    fs.writeFileSync(path.join(sk, '.gfx', 'skills.json'), JSON.stringify(rec));
    r = cli(['init', '--refresh', '--json'], { cwd: sk });
    let rep = null; try { rep = JSON.parse(r.out.trim().split('\n').at(-1)).skills; } catch {}
    const same = (rel) => fs.readFileSync(path.join(PSK, rel)).equals(fs.readFileSync(path.join(ESK, rel)));
    ok(r.code === 0 && rep && rep.updated.join() === 'svg/SKILL.md' && same('svg/SKILL.md'), 'refresh updates an untouched skill file to the engine version', rep || r.err);
    ok(rep && rep.kept.join() === 'canvas2d/SKILL.md' && fs.readFileSync(path.join(PSK, 'canvas2d', 'SKILL.md'), 'utf8').includes('MY EDIT') && fs.readFileSync(path.join(sk, '.gfx', 'skills-new', 'canvas2d', 'SKILL.md')).equals(fs.readFileSync(path.join(ESK, 'canvas2d', 'SKILL.md'))), 'refresh keeps an edited file, writes the engine version to .gfx/skills-new/', rep);
    ok(rep && rep.added.join() === 'threejs/SKILL.md' && same('threejs/SKILL.md'), 'refresh adds a missing / new engine file', rep);
    ok(rep && rep.removed.join() === 'gone/SKILL.md' && !fs.existsSync(path.join(PSK, 'gone')), 'refresh removes an untouched file the engine dropped (and its empty folder)', rep);
    ok(rep && rep.keptRemoved.join() === 'gone2/SKILL.md' && fs.existsSync(path.join(PSK, 'gone2', 'SKILL.md')), 'refresh keeps an edited file the engine dropped', rep);
    ok(fs.readFileSync(path.join(PSK, 'mine', 'SKILL.md'), 'utf8') === 'MY OWN SKILL\n' && !recOf().files['mine/SKILL.md'], "the user's own (unrecorded) skill is left alone");
    rec = recOf();
    ok(rec.engineHash === S.skillsHash(ESK) && rec.files['canvas2d/SKILL.md'].sha256 === shaOf('OLD ENGINE CANVAS\n') && rec.files['svg/SKILL.md'].sha256 === shaOf(fs.readFileSync(path.join(ESK, 'svg', 'SKILL.md'))) && rec.last.kept.join() === 'canvas2d/SKILL.md', 'skills.json: new engineHash, edited file keeps its install record, last report', rec.last);
    r = cli(['init', '--refresh'], { cwd: sk });
    ok(r.code === 0 && /kept your edits: canvas2d\/SKILL\.md; engine version at \.gfx\/skills-new\//.test(r.out) && fs.existsSync(path.join(sk, '.gfx', 'skills-new', 'canvas2d', 'SKILL.md')), 'a second refresh still reports the edit (human output)', r.out);
    fs.copyFileSync(path.join(ESK, 'canvas2d', 'SKILL.md'), path.join(PSK, 'canvas2d', 'SKILL.md')); // the user merged
    fs.rmSync(path.join(PSK, 'gone2'), { recursive: true }); // and deleted the dropped one
    r = cli(['init', '--refresh'], { cwd: sk });
    ok(r.code === 0 && /skills up to date/.test(r.out) && !fs.existsSync(path.join(sk, '.gfx', 'skills-new')) && recOf().files['canvas2d/SKILL.md'].sha256 === shaOf(fs.readFileSync(path.join(ESK, 'canvas2d', 'SKILL.md'))), 'after merging: up to date, skills-new cleared, record follows', r.out);
    // Untrusted install records must never read or remove paths outside the skills folder.
    const outside = path.join(tmp, 'outside.txt');
    fs.writeFileSync(outside, 'OUTSIDE\n');
    const invalid = ['../../../outside.txt', outside, 'C:/outside.txt', 'C:outside.txt', '..\\..\\..\\outside.txt', '../skills-other/outside.txt', 'svg/../outside.txt'];
    rec = recOf();
    for (const rel of invalid) rec.files[rel] = { sha256: shaOf('OUTSIDE\n'), engine: '0.1.0' };
    fs.writeFileSync(path.join(sk, '.gfx', 'skills.json'), JSON.stringify(rec));
    const rejected = await S.syncSkills(sk);
    ok(fs.readFileSync(outside, 'utf8') === 'OUTSIDE\n' && rejected.invalid.join() === invalid.join() && invalid.every((rel) => !Object.hasOwn(recOf().files, rel)), 'sync skips invalid recorded paths (including traversal with a matching hash), keeps the outside file, and drops invalid records', rejected);
    ok(S.syncReport(rejected, sk).some((line) => line.includes('skills skipped (invalid paths): ../../../outside.txt')) && recOf().last.invalid.join() === invalid.join(), 'invalid skill paths appear in the human and saved reports');
    const beforeNs = fs.readFileSync(path.join(sk, '.gfx', 'skills.json'), 'utf8');
    put('svg/SKILL.md', 'X\n');
    r = cli(['init', '--refresh', '--no-skills'], { cwd: sk });
    ok(r.code === 0 && fs.readFileSync(path.join(PSK, 'svg', 'SKILL.md'), 'utf8') === 'X\n' && fs.readFileSync(path.join(sk, '.gfx', 'skills.json'), 'utf8') === beforeNs, '--no-skills leaves skills and skills.json alone');

    // legacy project (no skills.json): a copy equal to an older engine version (git history) is updated silently; unknown
    // content is backed up to .gfx/skills-backup/<stamp>/ and replaced
    fs.rmSync(path.join(sk, '.gfx', 'skills.json'));
    const gl = spawnSync('git', ['log', '--format=%H', '--reverse', '--', '.claude/skills/motion-graphics/SKILL.md'], { cwd: ROOT, encoding: 'utf8' });
    const firstSha = gl.status === 0 ? gl.stdout.split('\n')[0] : '';
    const oldMg = firstSha ? spawnSync('git', ['show', `${firstSha}:.claude/skills/motion-graphics/SKILL.md`], { cwd: ROOT, encoding: 'buffer' }).stdout : null;
    if (oldMg && oldMg.length) put('motion-graphics/SKILL.md', oldMg);
    put('svg/SKILL.md', 'HAND EDITED BEFORE RECORDS\n');
    r = cli(['init', '--refresh', '--json'], { cwd: sk });
    rep = null; try { rep = JSON.parse(r.out.trim().split('\n').at(-1)).skills; } catch {}
    const bk = rep && rep.backup;
    ok(r.code === 0 && rep && rep.backedUp.join() === 'svg/SKILL.md' && bk && fs.readFileSync(path.join(bk, 'svg', 'SKILL.md'), 'utf8') === 'HAND EDITED BEFORE RECORDS\n' && same('svg/SKILL.md') && path.dirname(bk) === path.join(sk, '.gfx', 'skills-backup'), 'legacy: unknown content backed up to .gfx/skills-backup/<stamp>/ and replaced', rep || r.err);
    if (oldMg && oldMg.length) ok(rep && rep.updated.includes('motion-graphics/SKILL.md') && !rep.backedUp.includes('motion-graphics/SKILL.md') && same('motion-graphics/SKILL.md'), 'legacy: a copy equal to an older engine version (git history) is updated without a backup', rep);
    ok(fs.existsSync(path.join(sk, '.gfx', 'skills.json')) && recOf().engineHash === S.skillsHash(ESK) && fs.readFileSync(path.join(PSK, 'mine', 'SKILL.md'), 'utf8') === 'MY OWN SKILL\n', 'legacy: skills.json written; own skills untouched');

    // gfx init --existing: a skill file the folder already had is kept (engine version beside it)
    const exs = path.join(tmp, 'exskills');
    fs.mkdirSync(path.join(exs, '.claude', 'skills', 'svg'), { recursive: true });
    fs.writeFileSync(path.join(exs, '.claude', 'skills', 'svg', 'SKILL.md'), 'PRE-EXISTING\n');
    fs.mkdirSync(path.join(exs, '.claude', 'skills', 'motion-graphics'), { recursive: true });
    if (oldMg && oldMg.length) fs.writeFileSync(path.join(exs, '.claude', 'skills', 'motion-graphics', 'SKILL.md'), oldMg);
    r = cli(['init', exs, '--template', 'blank', '--existing']);
    ok(r.code === 0 && fs.readFileSync(path.join(exs, '.claude', 'skills', 'svg', 'SKILL.md'), 'utf8') === 'PRE-EXISTING\n' && fs.existsSync(path.join(exs, '.gfx', 'skills-new', 'svg', 'SKILL.md')) && /kept your edits: .*svg\/SKILL\.md/.test(r.out), 'init --existing keeps a pre-existing skill file, engine version in skills-new', r.out + r.err);
    ok(r.code === 0 && oldMg && oldMg.length && !oldMg.equals(fs.readFileSync(path.join(ESK, 'motion-graphics', 'SKILL.md'))) && fs.readFileSync(path.join(exs, '.claude', 'skills', 'motion-graphics', 'SKILL.md')).equals(oldMg) && fs.readFileSync(path.join(exs, '.gfx', 'skills-new', 'motion-graphics', 'SKILL.md')).equals(fs.readFileSync(path.join(ESK, 'motion-graphics', 'SKILL.md'))), 'init --existing keeps an older engine revision, puts the current engine copy in skills-new', r.out + r.err);

    // findings 22 + 19.3: skills point to the engine's contract and require a runnable scene.js
    const mg = fs.readFileSync(path.join(ESK, 'motion-graphics', 'SKILL.md'), 'utf8');
    ok(['canvas2d', 'animejs', 'svg', 'threejs', 'sound-design', 'motion-graphics'].every((k) => { const t = fs.readFileSync(path.join(ESK, k, 'SKILL.md'), 'utf8'); return t.includes('<engine>/docs/CONTRACT.md') && !/(^|[^>/])docs\/CONTRACT\.md/.test(t.replace('in the engine repo itself it is `docs/CONTRACT.md`', '')); }), 'skills reference <engine>/docs/CONTRACT.md, not a project docs/ path');
    ok(mg.includes('.gfx/engine.json') && /runnable/.test(mg) && mg.includes('out/<name>/scratch/') && mg.includes('gfx still <name> --t 0'), 'motion-graphics: scene.js stays runnable (scratch dir, still --t 0)');

    // skills: workflow line, look, BRIEF.md (docs/LOOKS.md §1-2, §4)
    const sd = fs.readFileSync(path.join(ESK, 'sound-design', 'SKILL.md'), 'utf8');
    ok(mg.includes('Workflow (this project)') && /\*\*Quick\*\*/.test(mg) && mg.includes('looks/<id>/LOOK.md') && mg.includes('scenes/<name>/BRIEF.md') && mg.includes('refs/') && mg.includes('Kind: Auto'), 'motion-graphics: follows the workflow line, reads LOOK.md and BRIEF.md (+ refs, Kind: Auto)');
    ok(sd.includes('looks/<id>/sounds.json') && /outside the palette/.test(sd), 'sound-design: look palette first, reports sounds outside it');
    {
      const ld = fs.readFileSync(path.join(ROOT, '.claude', 'skills', 'look-design', 'SKILL.md'), 'utf8');
      ok(/^---\nname: look-design\n/.test(ld) && ld.includes('gfx look analyze') && ld.includes('gfx look preview') && ld.includes('templates/looks/_sample/BRIEF.md') && ld.includes('"alt"') && mg.includes('look-design') && /\balt\b/.test(sd), 'look-design skill (analyze, preview, test card, alt); motion-graphics points to it; sound-design knows alt');
    }

    console.log('workflow profiles (managed block)');
    {
      const W = await import('../runner/lib/workflow.js');
      const wp = path.join(tmp, 'wfproj');
      r = cli(['init', wp, '--template', 'blank']);
      const mdOf = () => fs.readFileSync(path.join(wp, 'CLAUDE.md'), 'utf8');
      const block = () => { const m = mdOf(); return m.slice(m.indexOf('<!-- gfx:begin -->'), m.indexOf('<!-- gfx:end -->')); };
      const QUICK = 'Workflow (this project): Quick first take: 1 contact sheet, no render, sound only if asked.';
      ok(r.code === 0 && block().includes(`- ${QUICK}\n`) && !/\{\{/.test(mdOf()) && !block().includes('Look:'), 'init: default Quick line (spec wording), no look line', block());
      const setWf = (v) => { const c = JSON.parse(fs.readFileSync(path.join(wp, 'gfx.json'), 'utf8')); if (v === undefined) delete c.settings; else c.settings = { ...(c.settings || {}), workflow: v }; fs.writeFileSync(path.join(wp, 'gfx.json'), JSON.stringify(c, null, 2)); };
      setWf('full');
      r = cli(['init', '--refresh', '--no-skills'], { cwd: wp });
      ok(r.code === 0 && block().includes('Workflow (this project): Full first take: contact sheet + stills at every beat (2 passes), render when done, sound always.') && !block().includes('Quick first take'), 'gfx.json settings.workflow "full" -> Full line', block());
      setWf({ verify: 'stills', render: true });
      r = cli(['init', '--refresh', '--no-skills', '--json'], { cwd: wp });
      let wj = null; try { wj = JSON.parse(r.out.trim().split('\n').at(-1)).workflow; } catch {}
      ok(r.code === 0 && block().includes('Workflow (this project): Custom first take: contact sheet + key stills, render when done, sound only if asked.') && wj?.profile === 'custom' && wj.source === 'project', 'custom object -> Custom line (missing fields from Quick); --json reports the workflow', wj);
      setWf(undefined);
      r = cli(['init', '--refresh', '--no-skills', '--workflow', 'full'], { cwd: wp });
      ok(r.code === 0 && block().includes('Full first take') && JSON.parse(fs.readFileSync(path.join(wp, '.gfx', 'workflow.json'), 'utf8')).machine === 'full', '--workflow full (machine default) -> Full line, remembered in .gfx/workflow.json');
      r = cli(['init', '--refresh', '--no-skills'], { cwd: wp });
      ok(r.code === 0 && block().includes('Full first take'), 'a later refresh without --workflow keeps the remembered machine default');
      setWf('quick');
      r = cli(['init', '--refresh', '--no-skills', '--workflow', '{"verify":"full","render":false,"sound":"always"}'], { cwd: wp });
      ok(r.code === 0 && block().includes(QUICK) && JSON.parse(fs.readFileSync(path.join(wp, '.gfx', 'workflow.json'), 'utf8')).machine.verify === 'full', 'the project value wins over the machine default (json --workflow stored)');
      setWf('turbo');
      r = cli(['init', '--refresh', '--no-skills'], { cwd: wp });
      ok(r.code === 0 && /settings\.workflow "turbo" is not valid/.test(r.err) && block().includes('Custom first take: contact sheet + stills at every beat (2 passes), no render, sound always.'), 'invalid project value: warning, falls back to the machine default', r.err);
      r = cli(['init', '--refresh', '--no-skills', '--workflow', 'slow'], { cwd: wp });
      ok(r.code !== 0 && /invalid --workflow/.test(r.err), 'invalid --workflow is rejected');
      r = cli(['init', path.join(tmp, 'wfbad'), '--workflow', '{"verify":"all"}']);
      ok(r.code !== 0 && !fs.existsSync(path.join(tmp, 'wfbad')), 'init with an invalid --workflow fails before writing anything');
      r = cli(['init', path.join(tmp, 'wffull'), '--workflow', 'full']);
      ok(r.code === 0 && fs.readFileSync(path.join(tmp, 'wffull', 'CLAUDE.md'), 'utf8').includes('Full first take'), 'init --workflow full writes the Full line');
      ok(W.parseWorkflow('quick').verify === 'sheet' && W.parseWorkflow({ render: 'yes' }) === null && W.parseWorkflow([]) === null && W.parseWorkflow({}).profile === 'custom', 'parseWorkflow: profiles, type checks');
    }

    console.log('looks (gfx look)');
    {
      const LK = await import('../runner/lib/looks.js');
      const lib = path.join(tmp, 'looklib');
      const lp = path.join(tmp, 'lookproj');
      r = cli(['init', lp, '--template', 'blank']);
      const look = (args, o = {}) => cli(['look', ...args], { cwd: lp, ...o });
      const cfgOf = () => JSON.parse(fs.readFileSync(path.join(lp, 'gfx.json'), 'utf8'));
      const blockOf = () => { const m = fs.readFileSync(path.join(lp, 'CLAUDE.md'), 'utf8'); return m.slice(m.indexOf('<!-- gfx:begin -->'), m.indexOf('<!-- gfx:end -->')); };
      const lastJson = (s) => { try { return JSON.parse(s.trim().split('\n').at(-1)); } catch { return null; } };

      // hash: sha256 over "<rel>\n<sha256(bytes)>\n" in sorted order
      const hd = path.join(tmp, 'hashlook');
      fs.mkdirSync(path.join(hd, 'refs'), { recursive: true });
      fs.writeFileSync(path.join(hd, 'LOOK.md'), 'A'); fs.writeFileSync(path.join(hd, 'refs', 'b.txt'), 'B');
      const exp = crypto.createHash('sha256').update(`LOOK.md\n${shaOf('A')}\nrefs/b.txt\n${shaOf('B')}\n`).digest('hex');
      ok(LK.lookHash(hd) === exp && LK.lookHash(path.join(tmp, 'nope')) === null, 'lookHash = sha256 over sorted "<rel>\\n<sha256>\\n"; null when missing');
      ok(LK.validId('clean-dark') && !LK.validId('../x') && !LK.validId('A') && !LK.validId('a/b') && !LK.validId('-a') && !LK.validId(''), 'look ids are slugs');

      r = look(['seed', '--library', lib, '--json']);
      let j = lastJson(r.out);
      const STARTER_IDS = ['clean-dark', 'editorial', 'fast-paced', 'ghibli-soft', 'playful', 'tech-minimal'];
      ok(r.code === 0 && j?.seeded.join() === STARTER_IDS.join() && STARTER_IDS.every((id) => !fs.existsSync(path.join(lib, 'looks', id, 'BRIEF.md'))) && ['LOOK.md', 'preset.js', 'sounds.json'].every((f) => fs.existsSync(path.join(lib, 'looks', 'clean-dark', f))) && fs.existsSync(path.join(lib, 'presets')) && fs.existsSync(path.join(lib, 'palettes')) && !fs.existsSync(path.join(lib, 'looks', '_new')), 'look seed copies the six starters (not _new, no BRIEF.md) and creates presets/ + palettes/', r.out + r.err);
      {
        const SFX = await import('../runner/lib/sfx.js');
        const synthOk = (e) => e && SFX.SOUND_NAMES.includes(e.sound) && (e.variant === undefined || (SFX.VARIANTS[e.sound] || []).includes(e.variant));
        const bad = [];
        for (const id of STARTER_IDS) {
          const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'looks', id, 'sounds.json'), 'utf8'));
          if (!Array.isArray(p) || !p.length) { bad.push(`${id}: empty`); continue; }
          for (const e of p) {
            if (!e.role) bad.push(`${id}: entry without role`);
            else if (e.sound === 'sample' ? !(typeof e.src === 'string' && e.src.startsWith('library/') && synthOk(e.alt)) : !synthOk(e)) bad.push(`${id}: ${e.role}`);
          }
        }
        ok(!bad.length, 'starter palettes: synth entries use existing sounds + variants; sample entries have a library src and a valid synth alt', bad);
      }
      // starters use bundled fonts only (docs/LOOK-PIPELINE.md §6); _sample/ is the test-card brief, never seeded
      {
        const starters = fs.readdirSync(path.join(ROOT, 'templates', 'looks')).filter((n) => !n.startsWith('_'));
        const missing = [];
        for (const id of starters) {
          const src = fs.readFileSync(path.join(ROOT, 'templates', 'looks', id, 'preset.js'), 'utf8');
          for (const m of src.matchAll(/'([\w-]+\.woff2)'/g)) if (!fs.existsSync(path.join(ROOT, 'style', 'fonts', m[1]))) missing.push(`${id}: ${m[1]}`);
          if (/JetBrains/.test(src)) missing.push(`${id}: JetBrains Mono is not bundled`);
        }
        ok(starters.length >= 1 && !missing.length, 'starter presets name only bundled font files (style/fonts)', missing);
        ok(['fraunces-latin-400-normal.woff2', 'nunito-latin-800-normal.woff2', 'fredoka-latin-700-normal.woff2', 'space-grotesk-latin-500-normal.woff2', 'LICENSE-Fraunces.txt', 'LICENSE-Nunito.txt', 'LICENSE-Fredoka.txt', 'LICENSE-Space-Grotesk.txt'].every((f) => fs.existsSync(path.join(ROOT, 'style', 'fonts', f))) && fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8').includes('Space Grotesk'), 'bundled OFL fonts (Fraunces, Nunito, Fredoka, Space Grotesk) with licence files + notices');
        ok(fs.existsSync(path.join(ROOT, 'templates', 'looks', '_sample', 'BRIEF.md')) && !fs.existsSync(path.join(lib, 'looks', '_sample')), 'the sample brief exists and is not seeded as a look');
      }
      fs.appendFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), 'MINE\n');
      r = look(['seed', '--library', lib, '--json']);
      j = lastJson(r.out);
      ok(r.code === 0 && j?.seeded.length === 0 && j.skipped.join() === STARTER_IDS.join() && fs.readFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), 'utf8').endsWith('MINE\n'), 'seed again: existing looks kept as they are');

      r = look(['list', '--library', lib, '--json']);
      j = lastJson(r.out);
      ok(r.code === 0 && j?.looks.map((l) => l.id).join() === STARTER_IDS.join() && j.looks[0].name === 'Clean dark' && j.looks[0].tags.includes('minimal') && j.looks[0].preset && j.looks[0].hash === LK.lookHash(path.join(lib, 'looks', 'clean-dark')) && j.projectLooks.length === 0 && j.look === null, 'look list --json: library looks (name, tags, preset, hash), no project look yet', j);

      r = look(['use', 'clean-dark', '--library', lib]);
      let c = cfgOf();
      const libHash = LK.lookHash(path.join(lib, 'looks', 'clean-dark'));
      ok(r.code === 0 && c.look === 'clean-dark' && P.samePath(c.lookSource.library, lib) && c.lookSource.hash === libHash && LK.lookHash(path.join(lp, 'looks', 'clean-dark')) === libHash && c.name === 'lookproj', 'look use: copied to looks/<id>/, gfx.json look + lookSource { library, hash }, other keys kept', r.err);
      const presetOut = path.join(lp, 'style', 'presets', 'look-clean-dark.js');
      ok(fs.existsSync(presetOut) && fs.readFileSync(presetOut, 'utf8').endsWith(fs.readFileSync(path.join(lib, 'looks', 'clean-dark', 'preset.js'), 'utf8')), 'look use writes style/presets/look-<id>.js from preset.js');
      ok(blockOf().includes('- Look: Clean dark (looks/clean-dark/LOOK.md): read it at the brief, style, build and sound steps; use its sound palette first. Style preset: `look-clean-dark`.') && blockOf().includes('Quick first take') && blockOf().includes('<engine>/docs/CONTRACT.md'), 'managed block: look line (+ workflow and contract lines kept)', blockOf());
      r = cli(['new', 'shot', '--kind', 'anime'], { cwd: lp });
      ok(r.code === 0 && JSON.parse(fs.readFileSync(path.join(lp, 'scenes', 'shot', 'scene.json'), 'utf8')).style === 'look-clean-dark', 'gfx new defaults to the look preset');
      r = look(['list', '--json']);
      j = lastJson(r.out);
      ok(r.code === 0 && j?.look?.id === 'clean-dark' && !j.look.edited && !j.look.updateAvailable && j.look.libraryHash === libHash && j.projectLooks[0].id === 'clean-dark', 'look list --json: project look status (via lookSource.library)', j?.look);

      r = look(['update', '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'up-to-date', 'look update: up to date');
      // library changes, project copy untouched -> update applies
      fs.writeFileSync(path.join(lib, 'looks', 'clean-dark', 'preset.js'), fs.readFileSync(path.join(lib, 'looks', 'clean-dark', 'preset.js'), 'utf8').replace("radius: 8,", "radius: 20,"));
      fs.appendFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), '\nLIB V2\n');
      j = lastJson(look(['list', '--json', '--library', lib]).out);
      ok(j?.look?.updateAvailable === true && !j.look.conflict, 'list: updateAvailable when the library changed and the project copy is unedited', j?.look);
      r = look(['update', '--json']);
      const lib2 = LK.lookHash(path.join(lib, 'looks', 'clean-dark'));
      ok(r.code === 0 && lastJson(r.out)?.status === 'updated' && cfgOf().lookSource.hash === lib2 && LK.lookHash(path.join(lp, 'looks', 'clean-dark')) === lib2 && fs.readFileSync(presetOut, 'utf8').includes('radius: 20,'), 'look update: unedited copy replaced, hash recorded, preset rewritten', r.out + r.err);
      // both edited -> conflict, nothing changes
      fs.appendFileSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md'), '\nPROJECT EDIT\n');
      fs.appendFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), '\nLIB V3\n');
      const projBefore = LK.lookHash(path.join(lp, 'looks', 'clean-dark')), libBefore = LK.lookHash(path.join(lib, 'looks', 'clean-dark'));
      r = look(['update', '--json']);
      j = lastJson(r.out);
      ok(r.code === 2 && j?.status === 'conflict' && j.projectHash === projBefore && j.libraryHash === libBefore && j.recorded === lib2 && LK.lookHash(path.join(lp, 'looks', 'clean-dark')) === projBefore && cfgOf().lookSource.hash === lib2, 'look update refuses when the project copy was edited (reports both hashes, changes nothing)', j);
      r = look(['update']);
      ok(r.code === 2 && /project copy was edited/.test(r.out) && /gfx look save/.test(r.out), 'look update (human): explains both ways out', r.out);
      // save refuses to overwrite a different library version without --force
      r = look(['save', '--json']);
      ok(r.code === 2 && lastJson(r.out)?.status === 'conflict' && LK.lookHash(path.join(lib, 'looks', 'clean-dark')) === libBefore, 'look save refuses to overwrite a newer library version without --force');
      r = look(['save', '--force', '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'saved' && LK.lookHash(path.join(lib, 'looks', 'clean-dark')) === projBefore && cfgOf().lookSource.hash === projBefore, 'look save --force: library = project copy, pin follows');
      fs.appendFileSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md'), '\nEDIT 2\n');
      r = look(['update', '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'local-edits', 'look update: library unchanged + local edits -> nothing to update');
      r = look(['save', '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'saved' && LK.lookHash(path.join(lib, 'looks', 'clean-dark')) === LK.lookHash(path.join(lp, 'looks', 'clean-dark')), 'look save without --force when the library still has the pinned version');
      // use over an edited project copy needs --force
      fs.appendFileSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md'), '\nEDIT 3\n');
      r = look(['use', 'clean-dark', '--library', lib]);
      ok(r.code !== 0 && fs.readFileSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md'), 'utf8').includes('EDIT 3'), 'look use does not overwrite an edited project copy without --force');
      r = look(['use', 'clean-dark', '--library', lib, '--force']);
      ok(r.code === 0 && !fs.readFileSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md'), 'utf8').includes('EDIT 3'), 'look use --force takes the library copy');

      // Removed presets stay available to existing scenes but stop being the new-scene default.
      fs.unlinkSync(path.join(lib, 'looks', 'clean-dark', 'preset.js'));
      r = look(['update', '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'updated' && fs.existsSync(presetOut) && LK.lookPresetName(lp, cfgOf()) === null && !blockOf().includes('Style preset:'), 'look update without preset: generated file retained, default and brief cleared', r.out + r.err);
      r = look(['list', '--json']);
      ok(lastJson(r.out)?.projectLooks.find((l) => l.id === 'clean-dark')?.preset === false, 'look list exposes the pinned look without a preset');
      r = cli(['new', 'without-look-preset', '--kind', 'anime'], { cwd: lp });
      ok(r.code === 0 && JSON.parse(fs.readFileSync(path.join(lp, 'scenes', 'without-look-preset', 'scene.json'), 'utf8')).style === 'dark-grid', 'gfx new falls back after the look preset is removed', r.err);

      // new: scaffold in the project; use it without a library; save it to the library
      r = look(['new', 'soft-paper']);
      const nd = path.join(lp, 'looks', 'soft-paper');
      ok(r.code === 0 && ['LOOK.md', 'preset.js', 'sounds.json'].every((f) => fs.existsSync(path.join(nd, f))) && fs.existsSync(path.join(nd, 'refs')) && /name: Soft Paper/.test(fs.readFileSync(path.join(nd, 'LOOK.md'), 'utf8')) && /## Motion[\s\S]*## Typography[\s\S]*## Colour & style[\s\S]*## Sound[\s\S]*## Do \/ Don't[\s\S]*## References/.test(fs.readFileSync(path.join(nd, 'LOOK.md'), 'utf8')) && JSON.parse(fs.readFileSync(path.join(nd, 'sounds.json'), 'utf8')).length === 0 && cfgOf().look === 'clean-dark', 'look new scaffolds LOOK.md (spec sections) + preset.js + sounds.json + refs/, does not switch the look', r.err);
      ok(look(['new', 'soft-paper']).code !== 0, 'look new refuses an existing look');
      r = look(['use', 'soft-paper']);
      c = cfgOf();
      ok(r.code === 0 && c.look === 'soft-paper' && !('lookSource' in c) && fs.existsSync(path.join(lp, 'style', 'presets', 'look-soft-paper.js')) && blockOf().includes('Look: Soft Paper (looks/soft-paper/LOOK.md)'), 'look use <id> without --library: the project\'s own look (no lookSource)', c);
      r = look(['save', '--library', lib, '--json']);
      ok(r.code === 0 && lastJson(r.out)?.status === 'saved' && LK.lookHash(path.join(lib, 'looks', 'soft-paper')) === LK.lookHash(nd) && cfgOf().lookSource.hash === LK.lookHash(nd), 'look save --library: a new look goes to the library and gets pinned');
      fs.appendFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), 'LIB\n');
      fs.cpSync(path.join(ROOT, 'templates', 'looks', 'clean-dark'), path.join(lp, 'looks', 'clean-dark'), { recursive: true });
      r = look(['save', 'clean-dark', '--library', lib]);
      ok(r.code === 2 && fs.readFileSync(path.join(lib, 'looks', 'clean-dark', 'LOOK.md'), 'utf8').endsWith('LIB\n'), 'look save <id>: an unpinned look never overwrites a different library copy without --force');

      // path safety
      const outsideDir = path.join(tmp, 'outside-look');
      fs.mkdirSync(outsideDir, { recursive: true });
      fs.writeFileSync(path.join(outsideDir, 'LOOK.md'), 'OUT');
      const bad = ['../outside-look', '..', 'a/../b', 'A', '/etc', 'C:x', 'x\\..\\y'];
      ok(bad.every((id) => { const x = look(['use', id, '--library', lib]); return x.code !== 0 && /invalid look id/.test(x.err); }) && bad.every((id) => look(['new', id]).code !== 0) && look(['save', '../outside-look', '--library', lib]).code !== 0, 'use/new/save reject non-slug ids (traversal, absolute, drive, backslash)');
      c = cfgOf();
      fs.writeFileSync(path.join(lp, 'gfx.json'), JSON.stringify({ ...c, look: '../../outside-look' }, null, 2));
      r = cli(['init', '--refresh', '--no-skills'], { cwd: lp });
      ok(r.code === 0 && !blockOf().includes('Look:') && look(['update', '--library', lib]).code !== 0 && look(['save', '--library', lib]).code !== 0, 'a gfx.json look that is not a slug: no block line, update/save refuse');
      fs.writeFileSync(path.join(lp, 'gfx.json'), JSON.stringify(c, null, 2));
      if (process.platform !== 'win32') {
        // symlinks: never followed out of a look, and a project looks/ that points outside is refused
        const secret = path.join(tmp, 'secret.txt');
        fs.writeFileSync(secret, 'SECRET');
        fs.symlinkSync(secret, path.join(lib, 'looks', 'clean-dark', 'leak.txt'));
        fs.symlinkSync(tmp, path.join(lib, 'looks', 'clean-dark', 'up'));
        fs.rmSync(path.join(lp, 'looks', 'clean-dark'), { recursive: true });
        r = look(['use', 'clean-dark', '--library', lib]);
        ok(r.code === 0 && !fs.existsSync(path.join(lp, 'looks', 'clean-dark', 'leak.txt')) && !fs.existsSync(path.join(lp, 'looks', 'clean-dark', 'up')) && fs.existsSync(path.join(lp, 'looks', 'clean-dark', 'LOOK.md')), 'symlinks inside a library look are not copied', r.err);
        const lp2 = path.join(tmp, 'lookproj2');
        cli(['init', lp2, '--template', 'blank']);
        fs.symlinkSync(outsideDir, path.join(lp2, 'looks'));
        r = cli(['look', 'use', 'clean-dark', '--library', lib], { cwd: lp2 });
        ok(r.code !== 0 && /outside/.test(r.err) && !fs.existsSync(path.join(outsideDir, 'clean-dark')), 'a project looks/ symlinked outside the project is refused', r.err);
      }
      r = cli(['look', 'use', 'clean-dark', '--library', lib], { cwd: ROOT });
      ok(r.code !== 0 && /engine repo/.test(r.err), 'look use refuses the engine repo');
    }

    // context: a project with _reel-test's scene.json + fixture comments/draft
    const cp = path.join(tmp, 'ctxproj');
    r = cli(['init', cp, '--template', 'blank']);
    fs.mkdirSync(path.join(cp, 'scenes', '_reel-test'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scenes', '_reel-test', 'scene.json'), path.join(cp, 'scenes', '_reel-test', 'scene.json'));
    const rv = path.join(cp, 'out', '_reel-test', 'review');
    fs.mkdirSync(rv, { recursive: true });
    const cm = (id, t, el, status) => ({ id, t, frame: Math.round(t * 60), x: 540, y: 1210, el, text: `text ${id}`, attachments: [{ kind: 'frame', path: `shots/${id}-frame.jpg` }, { kind: 'markup', path: `shots/${id}.png` }], status, reply: null, created: '2026-10-14T19:40:00Z', updated: '2026-10-14T19:41:12Z' });
    fs.writeFileSync(path.join(rv, 'comments.json'), JSON.stringify({ version: 1, scene: '_reel-test', comments: [cm('c3', 7.61, 'total', 'open'), cm('c4', 2, null, 'open'), cm('c5', 3, 'logo', 'resolved')] }));
    fs.writeFileSync(path.join(rv, 'draft.json'), JSON.stringify({ tweaks: { total: { x: 40, scale: 1.2 } }, stems: { ui: { gain: -2 } }, cues: {}, add: [] }));
    const vj = path.join(tmp, 'values.json');
    fs.writeFileSync(vj, JSON.stringify({ t: 7.61, elements: { total: { tag: 'div.total', text: '$42.05', cx: 535.5, cy: 1357, scale: 1, rot: 0, opacity: 1 } } }));
    r = cli(['context', '_reel-test', '--el', 'total', '--values-json', vj], { cwd: cp });
    ok(r.code === 0 && /^## gfx context — _reel-test @ 07\.61 \(f457 \/ 900\), 1080x1920 @60, project /.test(r.out), 'context md header', r.out.slice(0, 200) + r.err);
    ok(r.out.includes('Selected: total — div.total "$42.05"  (actual cx 535.5 cy 1357 · scale 1 · rot 0° · opacity 1)'), 'context md: selected with live values', r.out);
    ok(r.out.includes('Pending tweaks: total { x=40 scale=1.2 }') && r.out.includes('Pending audio edits: 1 stem'), 'context md: pending tweaks + audio');
    ok(r.out.includes('- c3 07.61 @(540,1210) el=total: "text c3"  [open]') && r.out.includes('- c4 ') && !r.out.includes('c5'), 'context md: open comments only by default');
    ok(r.out.includes(`markup: ${path.join(rv, 'shots', 'c3.png')}`) && r.out.indexOf('markup:') < r.out.indexOf('frame:'), 'context md: absolute attachment paths, markup first');
    r = cli(['context', '_reel-test', '--comment', 'c5', '--comment', 'c4', '--format', 'json'], { cwd: cp });
    let cj = {}; try { cj = JSON.parse(r.out); } catch {}
    ok(cj.comments?.map((c) => c.id).join() === 'c5,c4' && path.isAbsolute(cj.comments[0].attachments[0].path) && cj.selected?.[0]?.key === 'logo' && cj.t === 3 && cj.pendingTweaks?.total, 'context json: --comment ids, derived el + t, abs paths', r.out.slice(0, 300));
    r = cli(['context', '_reel-test', '--comment', 'c9'], { cwd: cp });
    ok(r.code !== 0, 'context: unknown comment id fails');
    r = cli(['context', '_reel-test', '--t', '1.5', '--tweaks'], { cwd: cp });
    ok(r.code === 0 && r.out.includes('@ 01.50 (f90 '), 'context: --t');
  }
  const hasBrowser = (await import('../runner/lib/browser.js')).findBrowser()?.exists;
  if (!hasBrowser) console.log('  (skip capture checks: no browser)');
  else {
    console.log('capture in a project');
    const a = path.join(tmp, 'a.png'), b = path.join(tmp, 'b.png');
    r = cli(['still', 'reel', '--t', '2', '--out', a, '--progress', 'json'], { cwd: proj });
    ev = jsonLines(r.out);
    const done = ev.at(-1);
    ok(r.code === 0 && done.type === 'done' && done.outputs[0] === a && fs.existsSync(a), 'still --progress json -> done with the output path', ev);
    ok(ev.some((e) => e.type === 'progress' && e.phase === 'frames' && e.done === 1 && e.total === 1) && ev.every((e) => !e.bad && typeof e.type === 'string'), 'progress events are well-formed JSON lines');
    // project preset override: a project style/presets/dark-grid.js replaces the engine one
    const preset = fs.readFileSync(path.join(ROOT, 'style', 'presets', 'dark-grid.js'), 'utf8').replace(/bg: '#[0-9a-f]+'/i, "bg: '#2050a0'");
    fs.mkdirSync(path.join(proj, 'style', 'presets'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'style', 'presets', 'dark-grid.js'), preset);
    r = cli(['still', 'reel', '--t', '2', '--out', b], { cwd: proj });
    ok(r.code === 0 && fs.existsSync(b) && !fs.readFileSync(a).equals(fs.readFileSync(b)), 'project preset overrides the engine preset (different pixels)', r.err);
    fs.rmSync(path.join(proj, 'style', 'presets', 'dark-grid.js'));
    r = cli(['render', 'reel', '--dur', '0.25', '--progress', 'json'], { cwd: proj });
    ev = jsonLines(r.out);
    const frames = ev.filter((e) => e.type === 'progress' && e.phase === 'frames');
    ok(r.code === 0 && frames.at(-1)?.done === 15 && frames.at(-1)?.total === 15 && ev.some((e) => e.phase === 'encode' && e.done === 15 && e.total === 15), 'render: frames 15/15 + encode phase', frames.at(-1));
    ok(ev.at(-1).type === 'done' && fs.existsSync(ev.at(-1).outputs[0]) && ev.at(-1).outputs[0].endsWith('.mp4'), 'render done -> mp4 path');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
