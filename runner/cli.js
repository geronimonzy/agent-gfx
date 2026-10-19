#!/usr/bin/env node
// gfx CLI entry. Commands live in runner/lib/cli/commands/*; contract in docs/CONTRACT.md, project model and
// --progress json in docs/FOUNDATION.md §1-3.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { USAGE, OPTIONS } from './lib/cli/args.js';
import { initProgress, doneEvent, errorEvent, isJson } from './lib/cli/progress.js';
import { runCleanups } from './lib/cli/util.js';

// Commands are imported lazily so `gfx doctor` / `gfx init` work even when a heavy dependency (vite native
// binding, puppeteer) is broken on this machine.
const C = {
  scene: () => import('./lib/cli/commands/scene.js'),
  capture: () => import('./lib/cli/commands/capture.js'),
  audio: () => import('./lib/cli/commands/audio.js'),
  review: () => import('./lib/cli/commands/review.js'),
  lib: () => import('./lib/cli/commands/lib.js'),
  context: () => import('./lib/cli/commands/context.js'),
  project: () => import('./lib/cli/commands/project.js'),
  version: () => import('./lib/cli/commands/version.js'),
  look: () => import('./lib/cli/commands/look.js'),
  template: () => import('./lib/cli/commands/template.js'),
};
const COMMANDS = {
  init: ['project', 'cmdInit'], doctor: ['project', 'cmdDoctor'], setup: ['project', 'cmdSetup'],
  new: ['scene', 'cmdNew'], list: ['scene', 'cmdList'], dev: ['scene', 'cmdDev'], serve: ['scene', 'cmdServe'], export: ['scene', 'cmdExport'],
  still: ['capture', 'cmdStill'], sheet: ['capture', 'cmdSheet'], render: ['capture', 'cmdRender'],
  audio: ['audio', 'cmdAudio'], review: ['review', 'cmdReview'], apply: ['review', 'cmdApply'], lib: ['lib', 'cmdLib'], context: ['context', 'cmdContext'], version: ['version', 'cmdVersion'], look: ['look', 'cmdLook'],
  template: ['template', 'cmdTemplate'],
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help' || !COMMANDS[cmd]) {
    console.log(USAGE);
    process.exitCode = cmd && !['-h', '--help'].includes(cmd) ? 1 : 0;
    return;
  }
  let values, positionals;
  try {
    ({ values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: OPTIONS }));
    initProgress(values.progress);
  } catch (e) {
    console.error('gfx: ' + e.message);
    process.exit(1);
  }
  // --help: commands that know it (look, lib) print their own; the others print the usage instead of running
  if (values.help && !['look', 'lib'].includes(cmd)) { console.log(USAGE); return; }
  // --project wins over GFX_PROJECT; stored in the env so the Vite config (same process) sees the same project.
  if (values.project) {
    const p = path.resolve(values.project);
    if (!fs.existsSync(p)) { const m = `project folder not found: ${p}`; if (isJson()) errorEvent(m); else console.error('gfx: ' + m); process.exit(1); }
    process.env.GFX_PROJECT = p;
  }
  let failed = null;
  try {
    const [mod, fn] = COMMANDS[cmd];
    const outputs = await (await C[mod]())[fn](positionals[0], values, positionals);
    if (process.exitCode) failed = `gfx ${cmd} failed (exit ${process.exitCode})`;
    else doneEvent(Array.isArray(outputs) ? outputs : []);
  } catch (e) {
    failed = e.message || String(e);
    if (!e.handled && !isJson()) console.error(e.stack || e);
    process.exitCode = process.exitCode || 1;
  } finally {
    await runCleanups();
  }
  if (failed) errorEvent(failed);
  // a pipe (gfx studio, tests) is written asynchronously: exiting right away cuts long output (version log --json)
  const drain = (s) => new Promise((r) => (s.writableLength ? s.write('', r) : r()));
  await Promise.all([drain(process.stdout), drain(process.stderr)]);
  process.exit(process.exitCode || 0);
}
main();
