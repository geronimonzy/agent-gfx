// Visual diff engine side (docs/VISUAL-DIFF.md §2): `gfx version export` and `gfx version preview` on a temp reel
// project with two versions, plus a read-only export of the engine repo. Run: node tests/vdiff.test.mjs (needs git).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PORT_MIN, PORT_MAX, vdiffBase } from '../runner/lib/vdiff.js';
import * as V from '../runner/lib/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-vdiff-test-'));
const proj = path.join(tmp, 'proj');
const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(tmp, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' };
delete env.GFX_PROJECT;
const cli = (project, ...args) => { const r = spawnSync(process.execPath, [CLI, ...args, '--project', project], { cwd: tmp, env, encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: r.stdout, err: r.stderr }; };
const J = (project, ...args) => { const r = cli(project, ...args, '--json'); let j = null; try { j = JSON.parse(r.out); } catch {} return { ...r, j }; };
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout;
const sceneRel = 'scenes/reel/scene.js';
const children = [];

/** Start `gfx version preview` -> { child, info, lines, exited } (info = the first JSON line). */
async function preview(project, rev, ...extra) {
  const child = spawn(process.execPath, [CLI, 'version', 'preview', rev, '--json', '--project', project, ...extra], { cwd: tmp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let buf = '', err = '';
  const exited = new Promise((r) => child.on('close', (code) => r(code)));
  const info = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), 60000);
    child.stdout.on('data', (d) => { buf += d; const l = buf.split('\n').find((x) => x.startsWith('{')); if (l) { clearTimeout(t); try { resolve(JSON.parse(l)); } catch { resolve(null); } } });
    child.stderr.on('data', (d) => { err += d; });
    child.on('close', () => { clearTimeout(t); resolve(null); });
  });
  return { child, info, exited, err: () => err };
}

try {
  console.log('setup');
  spawnSync(process.execPath, [CLI, 'init', proj, '--template', 'reel'], { cwd: tmp, env, stdio: 'ignore' });
  ok(J(proj, 'version', 'init').code === 0, 'temp project with versions');
  const v1 = git(proj, 'rev-parse', 'HEAD').trim();
  const before = fs.readFileSync(path.join(proj, sceneRel), 'utf8');
  fs.writeFileSync(path.join(proj, sceneRel), before + '\n// vdiff-test change\n');
  fs.mkdirSync(path.join(proj, 'out', 'reel'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'out', 'reel', 'junk.txt'), 'x');
  const v2 = J(proj, 'version', 'save', '-m', 'second').j?.sha;
  ok(!!v2 && v2 !== v1, 'second version saved');

  console.log('export');
  const ex = path.join(tmp, 'ex1');
  let r = J(proj, 'version', 'export', v1, '--out', ex);
  ok(r.code === 0 && r.j?.sha === v1 && r.j.files > 3, 'export --json reports sha + files', r.j || r.err);
  ok(fs.readFileSync(path.join(ex, sceneRel), 'utf8') === before, 'exported scene.js = the version\'s content');
  ok(fs.existsSync(path.join(ex, 'gfx.json')) && !fs.existsSync(path.join(ex, 'out')) && !fs.existsSync(path.join(ex, '.git')), 'export has gfx.json, no out/ or .git');
  r = cli(proj, 'version', 'export', v2, '--out', ex);
  ok(r.code !== 0 && /not empty/.test(r.err), 'export into a non-empty folder is refused', r.err);
  r = cli(proj, 'version', 'export', 'nope123', '--out', path.join(tmp, 'ex2'));
  ok(r.code !== 0 && /unknown version/.test(r.err), 'unknown revision refused', r.err);

  console.log('unsafe tree paths (Codex P1: backslashes are separators on Windows)');
  const bad = ['scenes/demo/..\\..\\..\\victim.txt', 'C:/x.txt', 'a:b', '/etc/x', 'a/../b', 'a//b', './a', '..', 'x\\y'];
  ok(bad.every((p) => V.exportDest(path.join(tmp, 'o'), p) === null), 'exportDest rejects .., backslashes, drive letters, absolute, empty and dot parts');
  ok(V.exportDest(path.join(tmp, 'o'), 'scenes/a/b.js') === path.join(tmp, 'o', 'scenes', 'a', 'b.js'), 'exportDest keeps a normal path inside the root');
  if (process.platform !== 'win32') {
    const evil = path.join(tmp, 'evil');
    fs.mkdirSync(path.join(evil, 'scenes', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(evil, 'scenes', 'demo', 'ok.js'), 'ok\n');
    fs.writeFileSync(path.join(evil, 'scenes', 'demo', '..\\..\\..\\victim.txt'), 'pwned\n');
    V.init(evil);
    const exo = path.join(tmp, 'ex-evil');
    const er = V.exportTree(evil, { sha: 'HEAD', dir: exo });
    ok(er.skipped?.includes('scenes/demo/..\\..\\..\\victim.txt') && fs.readdirSync(path.join(exo, 'scenes', 'demo')).join() === 'ok.js', 'a tree entry with backslash parts is skipped, never written', er);
  }

  console.log('engine repo (read-only)');
  const stBefore = git(ROOT, 'status', '--porcelain'), headBefore = git(ROOT, 'rev-parse', 'HEAD'), wtBefore = git(ROOT, 'worktree', 'list');
  const exe = path.join(tmp, 'ex-engine');
  r = J(ROOT, 'version', 'export', 'HEAD', '--out', exe);
  const top = fs.existsSync(exe) ? fs.readdirSync(exe).sort() : [];
  ok(r.code === 0 && top.every((n) => ['gfx.json', 'scenes', 'style'].includes(n)) && top.includes('scenes'), 'engine export = scenes/ style/ gfx.json only', top);
  ok(git(ROOT, 'status', '--porcelain') === stBefore && git(ROOT, 'rev-parse', 'HEAD') === headBefore && git(ROOT, 'worktree', 'list') === wtBefore, 'engine repo status / HEAD / worktrees untouched');

  console.log('preview');
  const stale = path.join(vdiffBase(), `${'f'.repeat(12)}-4194303`);
  fs.mkdirSync(stale, { recursive: true });
  const a = await preview(proj, v1, '--idle', '4');
  ok(a.info?.type === 'vdiff' && a.info.sha === v1 && a.info.port >= PORT_MIN && a.info.port <= PORT_MAX, 'preview prints its info line with a port in 5260-5299', a.info || a.err());
  ok(a.info && a.info.scenes.includes('reel') && fs.existsSync(a.info.dir) && a.info.dir.startsWith(vdiffBase()), 'checkout in the temp folder lists the scene', a.info);
  ok(!fs.existsSync(stale), 'stale checkout of a dead process pruned');
  const b = await preview(proj, 'now', '--idle', '0');
  ok(b.info?.rev === 'now' && b.info.port !== a.info?.port && b.info.dir === proj, 'now: serves the project folder on another port', b.info || b.err());
  if (a.info && b.info) {
    const sa = await (await fetch(`${a.info.url}/${sceneRel}`)).text(), sb = await (await fetch(`${b.info.url}/${sceneRel}`)).text();
    ok(sa.length > 100 && !sa.includes('vdiff-test change') && sb.includes('vdiff-test change'), 'each server serves its own version of scene.js', [sa.slice(0, 80), sb.length]);
    const br = await fetch(`${a.info.url}/runner/player/bridge.html?scene=reel`);
    ok(br.ok && /bridge\.js/.test(await br.text()), 'bridge page served from the checkout (engine runner)');
    const ping = await (await fetch(`${a.info.url}/__gfx/ping`)).json();
    ok(ping.ok && path.resolve(ping.root) === path.resolve(a.info.dir), 'ping reports the checkout root');
    const r2 = await preview(proj, v2, '--port', String(b.info.port), '--idle', '2');
    ok(!r2.info && (await r2.exited) !== 0 && /in use/.test(r2.err()), 'a pinned busy port fails clearly', r2.err());
  }
  // idle exit: nobody asks for anything for 4 s -> exit 0 and the checkout is gone
  const t0 = Date.now();
  const code = await Promise.race([a.exited, sleep(15000).then(() => 'timeout')]);
  ok(code === 0 && Date.now() - t0 < 12000, 'idle preview exits on its own', code);
  ok(a.info && !fs.existsSync(a.info.dir), 'its checkout is removed');
  b.child.kill('SIGTERM');
  const bc = await Promise.race([b.exited, sleep(10000).then(() => 'timeout')]);
  ok(bc !== 'timeout' && fs.existsSync(path.join(proj, sceneRel)), 'now preview stops on SIGTERM and leaves the project alone', bc);
  // graceful stop over HTTP (the studio's close): exits 0 and removes its checkout
  const c = await preview(proj, v2, '--idle', '0');
  if (c.info) await fetch(`${c.info.url}/__gfx/vdiff-stop`, { method: 'POST' });
  const cc = await Promise.race([c.exited, sleep(10000).then(() => 'timeout')]);
  ok(cc === 0 && c.info && !fs.existsSync(c.info.dir), 'POST /__gfx/vdiff-stop: exit 0, checkout removed', cc);
} catch (e) {
  fail++; console.log('  FAIL exception', e && e.stack || e);
} finally {
  for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
