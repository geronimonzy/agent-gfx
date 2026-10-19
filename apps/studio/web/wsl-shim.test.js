// Socket-free integration of the dev twin, using a tiny local engine archive and a doctor stub (no downloads).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { wslShim } from './wsl-shim.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
test('WSL twin streams install, repairs, preserves registrations and removes only owned files', async () => {
  const temp = fs.mkdtempSync(path.join(repo, 'out/wsl-shim-test-'));
  const prev = { TMPDIR: process.env.TMPDIR, GFX_WSL_BUNDLE: process.env.GFX_WSL_BUNDLE };
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'apps/studio/src-tauri/tauri.conf.json'))).version;
  try {
    process.env.TMPDIR = temp;
    const source = path.join(temp, 'source'); fs.mkdirSync(path.join(source, 'runner'), { recursive: true });
    fs.mkdirSync(path.join(source, 'bin'));
    fs.writeFileSync(path.join(source, 'bin/gfx'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(source, 'runner/cli.js'), 'console.log(JSON.stringify({engine:{version:"test"},ffmpeg:{exists:true,version:"7.0"}}));');
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ version }));
    const archive = path.join(temp, 'engine.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', source, '.']); process.env.GFX_WSL_BUNDLE = archive;
    const settingsFile = path.join(temp, 'settings.json'), enginesFile = path.join(temp, 'engines.json');
    const other = { path: '/keep', version: 'old', installed: 'then' };
    fs.writeFileSync(enginesFile, JSON.stringify({ version: 1, wsl: { Debian: other } }));
    const jobs = new Map();
    const options = { repo, settingsFile, jobs,
      readJsonFile: (file) => { try { return JSON.parse(fs.readFileSync(file)); } catch { return null; } },
      writeAtomic: (file, text) => { fs.writeFileSync(file + '.tmp', text); fs.renameSync(file + '.tmp', file); },
      pushEvent: (job, ev) => { job.events.push(ev); for (const fn of job.subs) fn(ev); },
    };
    let ops = wslShim(options);
    const setup = async (id, linkPath) => {
      ops.wsl_engine_setup({ distro: 'Dev', linkPath, jobId: id });
      const job = jobs.get(id);
      const result = await new Promise((resolve) => {
        const exit = job.events.find((e) => e.type === 'exit');
        if (exit) resolve(exit); else job.subs.add((e) => { if (e.type === 'exit') resolve(e); });
      });
      assert.equal(result.code, 0, result.error);
      assert.deepEqual(job.events.filter((e) => e.type === 'progress').map((e) => e.label), ['Unpack bundle', 'Register engine', 'Run doctor', 'Done']);
    };
    assert.deepEqual(ops.wsl_distros(), [{ name: 'Dev', default: true, state: 'Running', version: 2 }]);
    assert.equal(ops.wsl_bundle_info().version, version);
    assert.equal(ops.windows_path_state().added, false);
    assert.equal(ops.set_windows_path({ add: true }).added, true);
    assert.equal(ops.set_windows_path({ add: false }).added, false);
    assert.throws(() => ops.wsl_engine_setup({ distro: 'Other' }), /Unknown distro/);
    await setup('install', true);
    let state = JSON.parse(fs.readFileSync(enginesFile));
    assert.deepEqual(state.wsl.Debian, other);
    const engine = state.wsl.Dev.path, home = path.resolve(engine, '../../../..');
    assert.equal(state.wsl.Dev.version, version);
    assert.equal(fs.readlinkSync(engine), `engine-${version}`);
    assert.equal(fs.readlinkSync(path.join(home, '.local/bin/gfx')), '../share/gfx/engine/bin/gfx');
    // A restarted dev server recovers the installed fake home from engines.json.
    ops = wslShim(options);
    await setup('repair', false);
    state = JSON.parse(fs.readFileSync(enginesFile)); assert.equal(state.wsl.Dev.path, engine);
    const library = path.join(home, '.local/share/gfx/library'); fs.mkdirSync(library); fs.writeFileSync(path.join(library, 'keep'), 'mine');
    const cli = path.join(home, '.local/bin/gfx'); fs.unlinkSync(cli); fs.symlinkSync(path.join(temp, 'custom-cli'), cli);
    await ops.wsl_engine_remove({ distro: 'Dev' });
    assert.equal(fs.existsSync(engine), false);
    assert.equal(fs.readlinkSync(cli), path.join(temp, 'custom-cli'));
    assert.equal(fs.readFileSync(path.join(library, 'keep'), 'utf8'), 'mine');
    assert.deepEqual(JSON.parse(fs.readFileSync(enginesFile)), { version: 1, wsl: { Debian: other } });
    await setup('install-owned-link', true);
    fs.rmSync(path.join(home, '.local/share/gfx', `engine-${version}`), { recursive: true, force: true });
    await ops.wsl_engine_remove({ distro: 'Dev' });
    assert.throws(() => fs.lstatSync(cli), /ENOENT/);
  } finally {
    for (const [key, value] of Object.entries(prev)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
