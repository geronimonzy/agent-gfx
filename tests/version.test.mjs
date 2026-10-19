// `gfx version` test (docs/CODE-VERSIONS.md §2): runs in a temp project made by `gfx init`; nothing touches the engine repo.
// Run: node tests/version.test.mjs   (needs git; the thumb check also needs Chrome/Edge or GFX_CHROME)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as V from '../runner/lib/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-version-test-'));
const proj = path.join(tmp, 'proj');
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }; // no identity configured: gfx must cope
delete env.GFX_PROJECT;
const cli = (...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--project', proj], { cwd: tmp, env, encoding: 'utf8', timeout: 300000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const J = (...args) => { const r = cli(...args, '--json'); let j = null; try { j = JSON.parse(r.out); } catch {} return { ...r, j }; };
const write = (rel, text) => { const f = path.join(proj, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (rel) => fs.readFileSync(path.join(proj, rel), 'utf8');
const sceneJs = path.join('scenes', 'reel', 'scene.js').split(path.sep).join('/');

try {
  console.log('review regressions');
  const fixture = path.join(tmp, 'regressions');
  fs.mkdirSync(fixture);
  const git = (...args) => {
    const r = V.run(args, { cwd: fixture });
    if (r.code !== 0) throw new Error(r.err);
    return r.out.trim();
  };
  const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(fixture, p)), { recursive: true }); fs.writeFileSync(path.join(fixture, p), text); };
  put('dir/original.txt', 'original\n');
  put('outside.txt', 'original outside\n');
  const target = V.init(fixture).commit.sha;
  for (const alias of ['.', './', '', 'dir/..', path.join(fixture, 'dir', '..')]) {
    put('dir/original.txt', 'changed\n');
    put('later.txt', 'later\n');
    const r = V.restore(fixture, { sha: target, paths: [alias] });
    ok(r.saved && git('diff', '--name-only', target, 'HEAD') === '' && fs.existsSync(path.join(fixture, 'dir/original.txt')) && !fs.existsSync(path.join(fixture, 'later.txt')), `root restore alias ${JSON.stringify(alias)} restores the complete target tree`);
  }
  put('outside.txt', 'unsaved outside\n');
  const fixtureHeadBefore = git('rev-parse', 'HEAD');
  for (const escape of ['../escape', path.dirname(fixture)]) {
    let rejected = false;
    try { V.restore(fixture, { sha: target, paths: [escape] }); } catch (e) { rejected = e.code === 'GFX_VERSION'; }
    ok(rejected && git('rev-parse', 'HEAD') === fixtureHeadBefore && fs.readFileSync(path.join(fixture, 'outside.txt'), 'utf8') === 'unsaved outside\n', `outside path ${escape} rejected before saving`);
  }
  put('dir/later-tracked.txt', 'tracked later\n');
  V.save(fixture);
  put('dir/later-untracked.txt', 'untracked later\n');
  put('dir/original.txt', 'changed\n');
  put('dir/cache.keep', 'ignored\n');
  fs.appendFileSync(path.join(fixture, '.gitignore'), '*.keep\n');
  const directoryRestore = V.restore(fixture, { sha: target, paths: ['dir'] });
  ok(directoryRestore.saved && git('diff', '--name-only', target, 'HEAD', '--', 'dir') === '' && !fs.existsSync(path.join(fixture, 'dir/later-tracked.txt')) && !fs.existsSync(path.join(fixture, 'dir/later-untracked.txt')) && fs.readFileSync(path.join(fixture, 'dir/original.txt'), 'utf8') === 'original\n', 'directory restore removes later tracked and initially untracked files');
  ok(fs.readFileSync(path.join(fixture, 'outside.txt'), 'utf8') === 'unsaved outside\n' && fs.existsSync(path.join(fixture, 'dir/cache.keep')), 'directory restore preserves other paths and ignored files');

  // Existing repositories must keep unrelated staged and unstaged contents separate.
  put('.gitignore', '');
  V.save(fixture);
  put('outside.txt', 'staged contents\n');
  git('add', '--', 'outside.txt');
  put('outside.txt', 'unstaged contents\n');
  put('staged-new.txt', 'staged new\n');
  git('add', '--', 'staged-new.txt');
  const stagedBefore = git('diff', '--cached', '--binary');
  V.init(fixture);
  ok(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD') === '.gitignore' && git('diff', '--cached', '--binary') === stagedBefore && fs.readFileSync(path.join(fixture, 'outside.txt'), 'utf8') === 'unstaged contents\n', 'init commits only .gitignore and preserves unrelated staged and unstaged changes');
  V.save(fixture);
  fs.symlinkSync('outside.txt', path.join(fixture, 'file-link'));
  fs.symlinkSync('dir', path.join(fixture, 'dir-link'));
  fs.symlinkSync('missing-old', path.join(fixture, 'dangling-link'));
  const links = V.save(fixture).sha;
  for (const [name, destination] of [['file-link', 'dir/original.txt'], ['dir-link', '.'], ['dangling-link', 'missing-new']]) {
    fs.unlinkSync(path.join(fixture, name));
    fs.symlinkSync(destination, path.join(fixture, name));
  }
  const linkDiff = V.diff(fixture, { a: links, worktree: true }).files;
  ok([['file-link', 'outside.txt', 'dir/original.txt'], ['dir-link', 'dir', '.'], ['dangling-link', 'missing-old', 'missing-new']].every(([name, a, b]) => linkDiff.some((f) => f.path === name && f.a === a && f.b === b)), 'worktree diff reads file, directory and dangling symlink targets as git blobs', linkDiff);

  // Copy the module so ENGINE points at a disposable repo, never this checkout.
  const engineFixture = path.join(tmp, 'engine');
  fs.mkdirSync(path.join(engineFixture, 'runner/lib'), { recursive: true });
  for (const f of ['version.js', 'paths.js']) fs.copyFileSync(path.join(ROOT, 'runner/lib', f), path.join(engineFixture, 'runner/lib', f));
  fs.writeFileSync(path.join(engineFixture, 'package.json'), '{"type":"module"}');
  const engineV = await import(pathToFileURL(path.join(engineFixture, 'runner/lib/version.js')).href);
  const engineTarget = engineV.init(engineFixture, { allowEngine: true }).commit.sha;
  fs.writeFileSync(path.join(engineFixture, 'dirty.txt'), 'preserve in checkpoint\n');
  const engineRestore = engineV.restore(engineFixture, { sha: engineTarget, allowEngine: true });
  ok(engineV.repoState(engineFixture).engine && engineRestore.saved && engineRestore.commit && !fs.existsSync(path.join(engineFixture, 'dirty.txt')) && engineV.run(['show', `${engineRestore.saved.sha}:dirty.txt`], { cwd: engineFixture }).out === 'preserve in checkpoint\n', 'allowEngine reaches the pre-restore save and preserves dirty engine work');

  console.log('init');
  let r = spawnSync(process.execPath, [CLI, 'init', proj, '--template', 'reel'], { cwd: tmp, env, encoding: 'utf8' });
  ok(r.status === 0, 'gfx init makes a project', r.stderr);
  r = J('version', 'status');
  ok(r.j && r.j.repo === false && r.j.head === null && Array.isArray(r.j.dirty), 'status before init: repo false', r.j);
  r = J('version', 'save');
  ok(r.code !== 0 && /no version history/.test(r.err), 'save before init is refused');
  r = J('version', 'init');
  ok(r.code === 0 && r.j.created === true && r.j.commit && r.j.commit.msg === 'Project created', 'version init creates the repo + first commit', r.j || r.err);
  const ign = read('.gitignore').split(/\r?\n/);
  ok(['out/', '.gfx/', 'node_modules/'].every((l) => ign.includes(l)), '.gitignore has out/ .gfx/ node_modules/', ign);
  ok(fs.existsSync(path.join(proj, '.git')) && fs.readdirSync(path.join(proj, 'out')).length === 0, '.git present');
  const first = r.j.commit.sha;
  r = J('version', 'init');
  ok(r.code === 0 && r.j.created === false && !r.j.commit, 'init is idempotent');
  r = J('version', 'status');
  ok(r.j.repo && r.j.engine === false && r.j.branch && r.j.dirty.length === 0 && r.j.head.sha === first && r.j.head.actor === 'user' && r.j.head.msg === 'Project created', 'status clean after init', r.j);

  console.log('save');
  r = J('version', 'save');
  ok(r.code === 0 && r.j.skipped === 'clean', 'save is a no-op when clean (exit 0, skipped)', r.j || r.err);
  write(sceneJs, read(sceneJs) + '\n// edit one\n');
  write('scenes/reel/extra.json', '{"a":1}\n');
  r = J('version', 'status');
  ok(r.j.dirty.some((d) => d.path === sceneJs && d.status === 'M') && r.j.dirty.some((d) => d.path === 'scenes/reel/extra.json' && d.status === 'A'), 'status lists modified + new files', r.j.dirty);
  write('out/ignored.txt', 'x');
  fs.mkdirSync(path.join(proj, '.gfx'), { recursive: true });
  write('.gfx/cache.bin', 'x');
  r = J('version', 'save', '-m', 'first edit', '--actor', 'claude', '--thumb', 'reel@0.5');
  ok(r.code === 0 && r.j.msg === 'first edit' && r.j.actor === 'claude' && /^[0-9a-f]{40}$/.test(r.j.sha), 'save with note + actor', r.j || r.err);
  const second = r.j.sha;
  ok(!spawnSync('git', ['ls-files'], { cwd: proj, encoding: 'utf8' }).stdout.match(/^(out|\.gfx)\//m), 'out/ and .gfx/ are not committed');
  const hasChrome = fs.existsSync(process.env.GFX_CHROME || '/usr/bin/google-chrome');
  if (hasChrome) ok(r.j.thumb === `.gfx/thumbs/${second}.png` && fs.existsSync(path.join(proj, r.j.thumb)), '--thumb renders .gfx/thumbs/<sha>.png', r.j);
  const body = spawnSync('git', ['log', '-1', '--format=%B'], { cwd: proj, encoding: 'utf8' }).stdout;
  ok(/Gfx-Actor: claude/.test(body) && /Gfx-Scene: reel/.test(body) && /Gfx-T: 0\.5/.test(body), 'trailers Gfx-Actor / Gfx-Scene / Gfx-T in the commit', body);
  write(sceneJs, read(sceneJs) + '// edit two\n');
  r = J('version', 'save', '-m', 'second edit', '--actor', 'bogus');
  ok(r.code !== 0, 'bad --actor is rejected');
  r = J('version', 'save', '-m', 'second edit');
  const third = r.j.sha;
  ok(r.j.actor === 'user', 'default actor is user', r.j);

  console.log('log');
  r = J('version', 'log');
  ok(Array.isArray(r.j) && r.j.length === 3 && r.j[0].sha === third && r.j[2].sha === first, 'log lists newest first', r.j && r.j.map((e) => e.msg));
  const e = r.j[1];
  ok(e.sha === second && e.short === second.slice(0, 7) && e.msg === 'first edit' && e.note === 'first edit' && e.actor === 'claude' && e.scene === 'reel' && e.t === 0.5 && !Number.isNaN(Date.parse(e.time)), 'log entry fields (sha short msg note actor scene t time)', e);
  ok(e.files.length === 2 && e.files.every((f) => typeof f.add === 'number' && typeof f.del === 'number') && e.files.find((f) => f.path === sceneJs).status === 'M' && e.files.find((f) => f.path === 'scenes/reel/extra.json').status === 'A', 'log files { path status add del }', e.files);
  ok(e.thumb === (hasChrome ? `.gfx/thumbs/${second}.png` : null), 'log thumb field', e.thumb);
  ok(r.j[2].actor === 'user' && r.j[2].files.length > 3, 'first commit lists the project files');
  r = J('version', 'log', '--limit', '1');
  ok(r.j.length === 1, '--limit');
  r = J('version', 'log', '--path', 'scenes/reel/extra.json');
  ok(r.j.length === 1 && r.j[0].sha === second, '--path filters history', r.j && r.j.map((x) => x.msg));

  console.log('diff');
  r = J('version', 'diff', first, second);
  const dj = r.j.files.find((f) => f.path === sceneJs);
  ok(r.j.files.length === 2 && dj.status === 'M' && dj.b.includes('// edit one') && !dj.a.includes('// edit one'), 'diff a b: texts on both sides', r.j.files.map((f) => f.path));
  ok(r.j.files.find((f) => f.path === 'scenes/reel/extra.json').a === null, 'added file has a: null');
  r = J('version', 'diff', second, '--path', 'scenes/reel/extra.json');
  ok(r.j.files.length === 1 && r.j.files[0].path === 'scenes/reel/extra.json', 'diff <a> alone = a vs its parent; --path filters', r.j);
  r = J('version', 'diff', second);
  ok(r.j.files.length === 2, 'diff <a> alone = changes made by a');
  write(sceneJs, read(sceneJs) + '// uncommitted\n');
  write('scenes/reel/new.txt', 'brand new\n');
  fs.rmSync(path.join(proj, 'scenes/reel/extra.json'));
  r = J('version', 'diff', third, '--worktree');
  const byPath = Object.fromEntries(r.j.files.map((f) => [f.path, f]));
  ok(byPath[sceneJs].b.includes('// uncommitted') && !byPath[sceneJs].a.includes('// uncommitted') && byPath['scenes/reel/new.txt'].status === 'A' && byPath['scenes/reel/new.txt'].b === 'brand new\n' && byPath['scenes/reel/extra.json'].status === 'D' && byPath['scenes/reel/extra.json'].b === null, 'diff --worktree: modified, untracked, deleted', Object.keys(byPath));
  r = J('version', 'diff', 'nope-not-a-rev');
  ok(r.code !== 0, 'unknown revision is an error');
  r = J('version', 'diff', first, '--path', '../x');
  ok(r.code !== 0, '--path rejects ..');

  console.log('restore');
  const before = J('version', 'log').j.length;
  r = J('version', 'restore', first);
  ok(r.code === 0 && r.j.saved && r.j.commit && r.j.restored === first, 'restore whole: auto-saves, then commits', r.j || r.err);
  let log = J('version', 'log').j;
  ok(log.length === before + 2 && log[1].msg === `Before restore to ${first.slice(0, 7)}` && log[1].actor === 'auto' && log[0].msg === `Restored ${first.slice(0, 7)}` && log[0].actor === 'user', 'history only grew by the auto-save + the restore', log.slice(0, 2).map((x) => x.msg));
  ok(!read(sceneJs).includes('// edit one') && !fs.existsSync(path.join(proj, 'scenes/reel/extra.json')) && !fs.existsSync(path.join(proj, 'scenes/reel/new.txt')), 'working tree = first version (later files removed)');
  ok(log.some((x) => x.sha === third) && log.some((x) => x.sha === second), 'old versions still in the log');
  // where am I: the restore names its source, and the source has the same files (tree) as now
  ok(log[0].restoredFrom?.sha === first && log[0].restoredFrom.short === first.slice(0, 7) && typeof log[0].restoredFrom.msg === 'string' && log[0].restoredFrom.time, 'restore entry names its source (Gfx-Restored)', log[0].restoredFrom);
  ok(log[0].tree && log.find((x) => x.sha === first).tree === log[0].tree && log[1].tree !== log[0].tree, 'whole restore: same tree as the source version', log.slice(0, 2).map((x) => x.tree));
  ok(!/Gfx-Restored/.test(log[0].note) && log[1].restoredFrom === null, 'trailer stripped from the note; other entries have no source');
  ok(J('version', 'status').j.head.tree === log[0].tree, 'status.head.tree');
  // the uncommitted edit made before the restore was saved, so it can come back
  const savedSha = log[1].sha;
  ok(spawnSync('git', ['show', `${savedSha}:scenes/reel/new.txt`], { cwd: proj, encoding: 'utf8' }).stdout === 'brand new\n', 'uncommitted work survived in the auto-save');
  const n1 = log.length;
  r = J('version', 'restore', third, '--path', sceneJs);
  log = J('version', 'log').j;
  ok(r.code === 0 && r.j.saved === null && r.j.commit && log.length === n1 + 1 && log[0].msg.startsWith(`Restored ${third.slice(0, 7)}`), 'restore one path (clean tree: no auto-save needed)', r.j || r.err);
  ok(read(sceneJs).includes('// edit two') && !fs.existsSync(path.join(proj, 'scenes/reel/extra.json')), 'only that path came back');
  ok(log[0].restoredFrom?.sha === third, 'file restore names its source too');
  // an older restore entry (no trailer) is recognised by its message
  spawnSync('git', ['commit', '--allow-empty', '-q', '-m', `Restored ${second.slice(0, 7)}`, '-m', 'Gfx-Actor: user'], { cwd: proj });
  ok(J('version', 'log').j[0].restoredFrom?.sha === second, 'old-style "Restored <short>" message resolves its source');
  write('scenes/reel/scratch.txt', 's');
  r = J('version', 'restore', first, '--path', 'scenes/reel/extra.json');
  ok(r.code === 0 && r.j.saved && !fs.existsSync(path.join(proj, 'scenes/reel/extra.json')), 'restoring a path that does not exist in <sha> removes it; dirty tree auto-saved');
  r = J('version', 'restore', 'deadbeef');
  ok(r.code !== 0, 'restore of an unknown version fails');

  console.log('apply auto-save');
  fs.mkdirSync(path.join(proj, 'out/reel/review'), { recursive: true });
  write('out/reel/review/draft.json', JSON.stringify({ tweaks: { headline: { x: 12 } } }));
  write('scenes/reel/notes.md', 'unsaved note\n');
  const n2 = J('version', 'log').j.length;
  r = cli('apply', 'reel', '--tweaks');
  log = J('version', 'log').j;
  ok(r.code === 0 && log.length === n2 + 1 && log[0].msg === 'Before apply reel' && log[0].actor === 'auto' && log[0].scene === 'reel', 'apply saves the dirty tree first (actor auto, scene reel)', { code: r.code, err: r.err, log: log.slice(0, 2).map((x) => x.msg) });
  ok(JSON.parse(read('scenes/reel/tweaks.json')).headline.x === 12 && J('version', 'status').j.dirty.some((d) => d.path === 'scenes/reel/tweaks.json'), 'the apply itself stays uncommitted (dirty)');
  fs.mkdirSync(path.join(proj, 'out/reel/review'), { recursive: true });
  write('out/reel/review/draft.json', JSON.stringify({ tweaks: { headline: { x: 20 } } }));
  r = cli('apply', 'reel', '--tweaks');
  ok(r.code === 0 && J('version', 'log').j[0].msg === 'Before apply reel' && J('version', 'log').j.length === n2 + 2, 'second apply saves the first apply');

  console.log('doctor');
  r = J('doctor');
  ok(r.j && r.j.git && typeof r.j.git.path === 'string' && /^\d+\./.test(r.j.git.version), 'doctor --json reports git', r.j && r.j.git);
  r = spawnSync(process.execPath, [CLI, 'doctor', '--json', '--project', proj], { cwd: tmp, env: { ...env, GFX_GIT: path.join(tmp, 'no-such-git') }, encoding: 'utf8' });
  ok(JSON.parse(r.stdout).git.version === null, 'GFX_GIT is honoured (broken path -> version null)');

  console.log('engine repo');
  const eng = (...args) => { const x = spawnSync(process.execPath, [CLI, 'version', ...args, '--project', ROOT], { cwd: tmp, env, encoding: 'utf8' }); return { code: x.status, out: x.stdout, err: x.stderr }; };
  const headBefore = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  for (const args of [['init'], ['save', '-m', 'x'], ['restore', 'HEAD']]) {
    const x = eng(...args);
    ok(x.code !== 0 && /engine repo/.test(x.err), `engine repo: ${args[0]} refused`, x.err);
  }
  const st = JSON.parse(eng('status', '--json').out);
  ok(st.repo === true && st.engine === true, 'engine repo: status works read-only (engine: true)');
  ok(Array.isArray(JSON.parse(eng('log', '--json', '--limit', '3').out)), 'engine repo: log works');
  ok(spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout === headBefore, 'engine repo HEAD untouched');
  // a folder inside the engine repo is refused too
  const inside = path.join(ROOT, 'out', '_version-test-inside');
  fs.mkdirSync(inside, { recursive: true });
  const x = spawnSync(process.execPath, [CLI, 'version', 'init', '--project', inside], { cwd: tmp, env, encoding: 'utf8' });
  fs.rmSync(inside, { recursive: true, force: true });
  ok(x.status !== 0 && /engine repo/.test(x.stderr), 'a folder inside the engine repo is refused', x.stderr);
} catch (e) {
  fail++; console.log('  FAIL exception', e && e.stack || e);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
