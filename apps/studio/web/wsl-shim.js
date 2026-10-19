// Browser twin of lib.rs WSL setup commands. Only Dev is accepted; all owned files live under a temporary home.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const q = (s) => `'${String(s).replaceAll("'", "'\"'\"'")}'`;
export function wslShim({ repo, settingsFile, readJsonFile, writeAtomic, jobs, pushEvent }) {
  const version = readJsonFile(path.join(repo, 'apps/studio/src-tauri/tauri.conf.json')).version;
  const enginesFile = path.join(path.dirname(settingsFile), 'engines.json');
  let home, busy = false, windowsPath = '';
  const getHome = () => {
    if (home) return home;
    const saved = readJsonFile(enginesFile)?.wsl?.Dev?.path;
    if (saved) {
      const candidate = path.resolve(saved, '../../../..');
      if (path.dirname(candidate) === os.tmpdir() && path.basename(candidate).startsWith('gfx-wsl-dev-') && saved === path.join(candidate, '.local/share/gfx/engine') && fs.existsSync(candidate)) home = candidate;
    }
    return home ||= fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-wsl-dev-'));
  };
  const requireDev = (d) => { if (d !== 'Dev') throw new Error('Unknown distro (the dev shim offers Dev)'); };
  const bundle = () => {
    const p = process.env.GFX_WSL_BUNDLE || path.join(repo, 'out/installer/engine-wsl.tar.gz');
    return { path: p, exists: fs.existsSync(p), version };
  };
  const edit = (entry) => {
    const parsed = readJsonFile(enginesFile);
    if (fs.existsSync(enginesFile) && (!parsed || typeof parsed.wsl !== 'object' || Array.isArray(parsed.wsl))) throw new Error('engines.json is invalid');
    const f = parsed || { version: 1, wsl: {} };
    f.wsl ||= {};
    delete f.wsl.Dev;
    if (entry) f.wsl.Dev = entry;
    writeAtomic(enginesFile, JSON.stringify(f, null, 2) + '\n');
  };
  const engine = () => readJsonFile(enginesFile)?.wsl?.Dev?.path;
  const run = (script, job, input) => new Promise((resolve, reject) => {
    if (job?.canceled) { reject(new Error('Canceled')); return; }
    const child = spawn('bash', ['-lc', script], { detached: true, stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    if (job) job.child = child;
    let text = '', stderr = '';
    for (const [stream, err] of [[child.stdout, false], [child.stderr, true]]) {
      let pending = '';
      stream.on('data', (d) => {
        const s = d.toString(); if (err) stderr += s; else text += s;
        pending += s;
        const lines = pending.split('\n'); pending = lines.pop();
        for (const msg of lines) if (job && msg) pushEvent(job, { type: 'log', stream: err ? 'stderr' : 'stdout', msg });
      });
      stream.on('end', () => { if (job && pending) pushEvent(job, { type: 'log', stream: err ? 'stderr' : 'stdout', msg: pending }); });
    }
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, text, stderr }));
    if (input) {
      const source = fs.createReadStream(input);
      source.on('error', (e) => { child.kill(); reject(e); });
      child.stdin.on('error', (e) => { source.destroy(); if (e.code !== 'EPIPE') reject(e); });
      child.on('close', () => source.destroy());
      source.pipe(child.stdin);
    }
  });
  const doctor = (eng) => {
    const node = fs.existsSync(path.join(eng, 'node/node')) ? path.join(eng, 'node/node') : process.execPath;
    // the fake distro's own data dirs (never the real ~/.local/share/gfx)
    const h = getHome();
    return `HOME=${q(h)} XDG_DATA_HOME=${q(path.join(h, '.local/share'))} ${q(node)} ${q(path.join(eng, 'runner/cli.js'))} doctor --json`;
  };
  const parseChecks = (text) => {
    const fields = Object.fromEntries(text.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    let report = null; try { report = JSON.parse(text.slice(text.indexOf('{'))); } catch { /* missing doctor */ }
    return { chrome: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].some((k) => !!fields[k]), git: !!fields.git,
      agent: ['claude', 'codex', 'pi'].some((k) => !!fields[k]), dxg: fields.dxg === '1', path: fields.path === '1',
      ffmpeg: !!report?.ffmpeg?.version && report.ffmpeg.exists !== false, doctor: report };
  };
  return {
    wsl_distros: () => [{ name: 'Dev', default: true, state: 'Running', version: 2 }],
    wsl_bundle_info: bundle,
    wsl_engine_setup: ({ distro, linkPath, jobId }) => {
      requireDev(distro);
      if (!/^[\w-]{1,64}$/.test(jobId || '') || jobId === 'serve') throw new Error('invalid job id');
      if (busy || (jobs.has(jobId) && !jobs.get(jobId).done)) throw new Error('Another WSL engine operation is running');
      const b = bundle(); if (!b.exists) throw new Error(`Bundle not found: ${b.path}`);
      const h = getHome(), eng = path.join(h, '.local/share/gfx/engine');
      const job = { child: null, events: [], subs: new Set(), done: false, canceled: false };
      jobs.set(jobId, job); busy = true;
      (async () => {
        let step = 'Unpack bundle';
        try {
          pushEvent(job, { type: 'progress', label: step, pct: 10 });
          const script = `HOME=${q(h)}; set -e; b="$HOME/.local/share/gfx"; v=${q(version)}; t="$b/engine-$v.tmp"; rm -rf "$t"; mkdir -p "$t";
            tar -xz -C "$t"; rm -rf "$b/engine-$v"; mv "$t" "$b/engine-$v"; ln -sfn "engine-$v" "$b/engine"; for o in "$b"/engine-*;
            do [ "$o" = "$b/engine-$v" ] || rm -rf "$o"; done; echo "HOME=$HOME";
            ${linkPath ? 'mkdir -p ~/.local/bin && ln -sfn ../share/gfx/engine/bin/gfx ~/.local/bin/gfx' : ':'}`;
          const out = await run(script, job, b.path);
          if (job.canceled) throw new Error('Canceled');
          if (out.code) throw new Error((out.text + out.stderr).split('\n').slice(-12).join('\n'));
          step = 'Register engine'; pushEvent(job, { type: 'progress', label: step, pct: 70 });
          edit({ path: eng, version, installed: new Date().toISOString() });
          step = 'Run doctor'; pushEvent(job, { type: 'progress', label: step, pct: 85 });
          const result = await run(doctor(eng), job);
          if (!job.canceled && !parseChecks(result.text).doctor) throw new Error(`Doctor did not produce a report\n${(result.text + result.stderr).split('\n').slice(-12).join('\n')}`);
          job.result = { code: job.canceled ? -1 : 0, canceled: job.canceled };
          pushEvent(job, { type: 'progress', label: 'Done', pct: 100 });
        } catch (e) { job.result = { code: -1, canceled: job.canceled, error: `${step}: ${e.message}` }; }
        finally {
          job.done = true; busy = false;
          pushEvent(job, { type: 'exit', ...job.result });
          setTimeout(() => { if (jobs.get(jobId) === job) jobs.delete(jobId); }, 60000).unref();
        }
      })();
      return { started: true };
    },
    wsl_engine_checks: async ({ distro }) => {
      requireDev(distro);
      const eng = engine();
      const out = await run(`for c in google-chrome google-chrome-stable chromium chromium-browser git claude codex pi; do p=$(command -v "$c" || true); printf '%s=%s\\n' "$c" "$p"; done;
        if test -e /dev/dxg; then echo dxg=1; else echo dxg=0; fi;
        case ":$PATH:" in *":${getHome()}/.local/bin:"*) echo path=1 ;; *) echo path=0 ;; esac; ${eng ? doctor(eng) : ':'}`);
      return parseChecks(out.text);
    },
    wsl_engine_remove: async ({ distro }) => {
      requireDev(distro); if (busy) throw new Error('Another WSL engine operation is running');
      const eng = engine();
      if (eng) getHome();
      // The twin only deletes paths it owns, even if a test has edited engines.json.
      if (eng && (!home || eng !== path.join(home, '.local/share/gfx/engine'))) throw new Error('Dev engine belongs to another shim session');
      busy = true;
      try {
        if (eng) {
          const out = await run(`HOME=${q(home)}; set -e; b="$HOME/.local/share/gfx"; p="$HOME/.local/bin/gfx";
            if [ -L "$p" ]; then t=$(readlink -m -- "$p" || true); case "$t" in "$b"/engine/*|"$b"/engine-*/*) rm -f "$p" ;; esac; fi;
            rm -rf ~/.local/share/gfx/engine ~/.local/share/gfx/engine-*`);
          if (out.code) throw new Error(out.stderr);
        }
        edit(null);
      } finally { busy = false; }
      return null;
    },
    windows_path_state: () => ({ exists: true, entry: 'C:\\gfx studio\\engine\\bin', added: windowsPath.split(';').includes('C:\\gfx studio\\engine\\bin') }),
    set_windows_path: ({ add }) => { windowsPath = add ? 'C:\\gfx studio\\engine\\bin' : ''; return { exists: true, entry: 'C:\\gfx studio\\engine\\bin', added: !!windowsPath }; },
  };
}
