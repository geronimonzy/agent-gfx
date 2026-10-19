// Machine-readable progress (docs/FOUNDATION.md §3). With `--progress json` stdout carries only JSON lines:
//   { type: 'progress', phase, done, total, eta? }   { type: 'log', level, msg }
//   { type: 'done', outputs: [paths], ms }            { type: 'error', msg }   (exit code != 0)
// Everything a command prints through console.* becomes a `log` line, so human output needs no special casing.
// Without the flag nothing changes: progress() is a no-op and console.* is untouched.
import { format } from 'node:util';

const write = process.stdout.write.bind(process.stdout);
let json = false;
let t0 = Date.now();
const phases = new Map(); // phase -> { start, last }

export const isJson = () => json;
export const emit = (obj) => { if (json) write(JSON.stringify(obj) + '\n'); };

export function initProgress(mode) {
  t0 = Date.now();
  if (mode === undefined) return;
  if (mode !== 'json') throw new Error('--progress must be "json"');
  json = true;
  const as = (level) => (...a) => emit({ type: 'log', level, msg: format(...a) });
  console.log = console.info = as('info');
  console.warn = as('warn');
  // stderr is also used for status lines (indexer progress, warnings): only real failures are level "error"
  console.error = (...a) => {
    const msg = format(...a);
    emit({ type: 'log', level: /\b(error|failed|fatal)\b/i.test(msg) ? 'error' : /warn|skip/i.test(msg) ? 'warn' : 'info', msg });
  };
  // stray direct writes (libraries) must not corrupt the JSON stream: wrap non-JSON stdout text as log lines
  process.stdout.write = (chunk, ...rest) => {
    const s = String(chunk);
    if (s.startsWith('{"type":')) return write(chunk, ...rest);
    for (const line of s.split('\n')) if (line.trim()) write(JSON.stringify({ type: 'log', level: 'info', msg: line }) + '\n');
    const cb = rest.find((x) => typeof x === 'function');
    if (cb) cb();
    return true;
  };
}

/** Report `done` of `total` for a phase (frames, encode, audio, download, extract, index, ...). Throttled to ~10/s. */
export function progress(phase, done, total, extra) {
  if (!json) return;
  const now = Date.now();
  let p = phases.get(phase);
  if (!p || done === 0) { p = { start: now, last: 0 }; phases.set(phase, p); }
  const final = total > 0 && done >= total;
  if (!final && done !== 0 && now - p.last < 100) return;
  p.last = now;
  const o = { type: 'progress', phase, done, total };
  const el = (now - p.start) / 1000;
  if (done > 0 && total > done && el > 0.2) o.eta = +((el / done) * (total - done)).toFixed(1);
  emit(extra ? { ...o, ...extra } : o);
}

export const doneEvent = (outputs = []) => emit({ type: 'done', outputs: outputs.filter(Boolean).map(String), ms: Date.now() - t0 });
export const errorEvent = (msg) => emit({ type: 'error', msg: String(msg) });
