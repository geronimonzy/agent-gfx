// Engine & tools status (welcome window status strip, Settings → Engine & tools): `gfx doctor --json`, `gfx doctor` (the
// report), `gfx setup ffmpeg|chrome` with progress. One shared state per window; listeners re-render on change.
import * as api from './api.js';

export const TS = { engine: null, doctor: null, err: null, running: false, setup: null, setupError: null, report: null, reportRunning: false };
const subs = new Set();
export const onTools = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const changed = (what) => { for (const f of subs) { try { f(what); } catch (e) { console.warn('tools listener', e); } } };

/** `gfx doctor --json` -> rows { id, label, ok, detail, required, fix?, fixLabel? } (engine, ffmpeg, browser; node / CLAP when known). */
export function doctorRows(d) {
  if (!d || typeof d !== 'object') return [];
  const val = (...keys) => { for (const k of keys) if (d[k] !== undefined) return d[k]; return undefined; };
  const short = (s) => String(s || '').split(' Copyright')[0];
  const text = (v) => (v && typeof v === 'object' ? [v.path || v.exe || v.dir, short(v.version)].filter(Boolean).join('  ·  ') : typeof v === 'string' ? v : '');
  const has = (v) => (v && typeof v === 'object' ? v.exists !== false && v.ok !== false && v.found !== false && !v.missing && (v.path || v.exe || v.version || v.ok === true || v.found === true) : !!v);
  const rows = [];
  if (d.engine) rows.push({ id: 'engine', label: 'Engine', ok: true, detail: [d.engine.path, d.engine.version && `v${d.engine.version}`].filter(Boolean).join('  ·  '), required: true });
  const node = val('node');
  if (node !== undefined) rows.push({ id: 'node', label: 'Node', ok: has(node), detail: text(node), required: true });
  const ff = val('ffmpeg');
  const ffReady = !!ff?.version && has(ff) && !d.missing?.includes('ffmpeg');
  rows.push({ id: 'ffmpeg', label: 'ffmpeg', ok: ffReady, detail: ffReady ? text(ff) : 'needed for video and audio export', required: true, fix: 'ffmpeg', fixLabel: 'Download ffmpeg' });
  const browser = val('browser', 'chrome');
  const bk = browser && typeof browser === 'object' ? [browser.kind, browser.pinned ? 'pinned' : '', browser.version].filter(Boolean).join(' ') : '';
  const bdetail = has(browser) ? [bk, text(browser)].filter(Boolean).join('  ·  ') : 'not found - install Chrome or Edge, or the pinned browser';
  rows.push({ id: 'browser', label: 'Browser', ok: has(browser), detail: bdetail, required: true, fix: 'chrome', fixLabel: browser?.pinned ? '' : 'Install pinned browser', fixOptional: has(browser) });
  const clap = val('clap', 'clapModel', 'model') ?? d.library?.clapModel;
  if (clap !== undefined) rows.push({ id: 'clap', label: 'Sound-search model (CLAP)', ok: has(clap), detail: has(clap) ? 'installed' : 'optional - needed for sound library search', required: false });
  return rows;
}
export const row = (id) => doctorRows(TS.doctor).find((r) => r.id === id) || null;

let doctorP = null, doctorAgain = false;
/** `again`: the engine changed: a run in flight is followed by a fresh one (its answer may be from the old engine). */
export function runDoctor({ again = false } = {}) {
  if (doctorP) { if (again) doctorAgain = true; return doctorP; }
  TS.running = true; TS.err = null; changed('doctor');
  doctorP = (async () => {
    try { TS.engine = await api.engineInfo(); } catch { TS.engine = null; }
    try { TS.engines = await api.enginesInfo(); } catch { TS.engines = null; }
    try {
      const res = await api.engineCapture(['doctor', '--json'], { noProject: true }).done;
      let parsed = null;
      try { parsed = JSON.parse(res.lines.join('\n')); } catch { /* not json */ }
      if (parsed) TS.doctor = parsed;
      else { TS.doctor = null; TS.err = res.error || (res.code === 0 ? 'unreadable doctor output' : `gfx doctor exited with code ${res.code}`); }
    } catch (e) { TS.doctor = null; TS.err = String(e.message || e); }
    TS.running = false; doctorP = null;
    changed('doctor');
    if (doctorAgain) { doctorAgain = false; runDoctor(); }
  })();
  return doctorP;
}

/** Where the engine came from, for labels. */
export const ENGINE_SOURCE = { env: 'GFX_ENGINE', setting: 'chosen folder', app: 'next to the app', installed: 'installed' };
/** Engine folder (machine setting "engineDir"): pick a folder; Rust checks it has runner/cli.js. null = cancelled. */
export async function chooseEngine(save) {
  const p = await api.pickFolder('Engine folder (contains runner\\cli.js)');
  if (!p) return null;
  await save(p); // throws a clear error when the folder is no engine
  runDoctor({ again: true });
  return p;
}

/** `gfx doctor` (human report) -> TS.report (lines). */
export async function runReport() {
  if (TS.reportRunning) return;
  TS.reportRunning = true; changed('report');
  try {
    const res = await api.engineCapture(['doctor'], { noProject: true }).done;
    TS.report = { lines: res.lines, code: res.code, error: res.error, at: Date.now() };
  } catch (e) { TS.report = { lines: [], code: -1, error: String(e.message || e), at: Date.now() }; }
  TS.reportRunning = false; changed('report');
  runDoctor();
}

/** `gfx setup ffmpeg|chrome` with progress in TS.setup ({ what, pct, label }); afterwards the doctor runs again. */
export async function runSetup(what) {
  if (TS.setup) return;
  TS.setupError = null;
  TS.setup = { what, pct: 0, label: 'Starting…' };
  changed('setup');
  let error = null;
  try {
    const job = api.engineRun(['setup', what], {
      noProject: true,
      onEvent: (ev) => {
        if (ev.type === 'progress') {
          TS.setup.pct = ev.total ? Math.min(100, Math.round((100 * ev.done) / ev.total)) : TS.setup.pct;
          TS.setup.label = `${ev.phase || 'working'}${ev.total ? ` ${TS.setup.pct}%` : ''}${ev.eta ? ` · ${Math.round(ev.eta)} s left` : ''}`;
        } else if (ev.type === 'log' && ev.msg) TS.setup.label = ev.msg.slice(0, 80);
        changed('progress');
      },
    });
    const res = await job.done;
    if (res.code !== 0 && !res.canceled) error = res.error || `setup exited with code ${res.code}`;
  } catch (e) { error = String(e.message || e); }
  TS.setupError = error ? { what, msg: error } : null;
  TS.setup = null;
  changed('setup');
  if (!error) runDoctor();
}
