// Live bridge (docs/REVIEW.md §4): the scene at native size at (0,0), no controls, driven over postMessage.
// studio -> bridge  { id, type, ... }      bridge -> studio  { id, type: 'reply', ok, result | error }
// bridge -> studio  { type: 'ready', meta } once (and again on { type: 'hello' }),  { type: 'error', message, stack }
// Live code reload (docs/FOUNDATION.md §5): on `gfx:changed` the scene is rebuilt in place, then
//   bridge -> studio  { type: 'reloaded', reason, files, meta? }   (meta only when it changed)
//   or { type: 'error', message, stack, reason, files }            (old scene stays displayed)
import { buildScene } from './core.js';
import { relevant } from './changes.js';
import { createTrace, setActiveTrace, installAnimeTrace, codeRefs, codeKeysAt, codeRegions } from './code.js';

// (no import.meta.glob for tweaks.json: adding/removing the file would make Vite full-reload this page)
const name = new URLSearchParams(location.search).get('scene');
const post = (target, msg) => { try { target.postMessage(msg, '*'); } catch (e) { console.error(e); } };

let built = null;
let meta = null;
let t = 0;
let ver = 0; // bumped by every seek/tweaks request
let drawnVer = -1;
let pump = null;
let waiters = [];
let want = 0;
let live = {};          // last live tweaks / view from the studio, re-applied after a rebuild
let viewState = {};
let trace = null;       // call-site provenance of the current build (code.js; bridge only)
let reloading = null;   // promise while a rebuild is in flight; incoming requests wait for it

/** Coalesced draw: if busy, remember the latest request; resolve everybody once the latest is drawn. */
function draw(nextT) {
  if (nextT !== undefined) want = nextT;
  ver++;
  return new Promise((res, rej) => {
    waiters.push({ res, rej });
    if (!pump) pump = run();
  });
}
async function run() {
  try {
    while (drawnVer !== ver) {
      const v = ver;
      t = want;
      await built.render(t);
      drawnVer = v;
    }
    const ws = waiters; waiters = [];
    ws.forEach((w) => w.res({ t }));
  } catch (e) {
    const ws = waiters; waiters = [];
    ws.forEach((w) => w.rej(e));
  } finally { pump = null; }
}

async function readFileTweaks() {
  try {
    const r = await fetch(`/scenes/${name}/tweaks.json`, { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Scene-folder sources for `code`: Map(project-relative path -> lines), read from the dev server on demand.
async function sceneFiles() {
  const r = await fetch(`/__gfx/scene-files?scene=${encodeURIComponent(name)}`, { cache: 'no-store' });
  const files = new Map();
  if (r.ok) for (const f of (await r.json()).files || []) files.set(f.path, f.text.split(/\r?\n/));
  return files;
}

const handlers = {
  async seek({ t: nt }) { await draw(Number(nt) || 0); return { t }; },
  async tweaks({ tweaks }) { live = tweaks || {}; await built.setLive(live); await draw(); return { warnings: built.api.warnings }; },
  // §6 layers: tree, spans (sampled visibility), view-only hide/solo overrides
  async tree() { return built.api.tree(); },
  async spans({ step }) { return built.api.spans({ step }); },
  // §7 actual values + motion path samples
  async values({ keys, t }) { return built.api.values(keys || [], t === undefined || t === null ? undefined : Number(t)); },
  async path({ key, from, to, step }) { return built.api.path({ key, from: from == null ? undefined : Number(from), to: to == null ? undefined : Number(to), step }); },
  async view({ hidden, solo }) { viewState = { hidden, solo }; await built.api.setViewQuiet(viewState); await draw(); return { warnings: built.api.warnings }; },
  // extension: re-read scenes/<name>/tweaks.json (after `gfx apply`) and redraw
  async fileTweaks() { await built.setFile(await readFileTweaks()); await draw(); return { warnings: built.api.warnings }; },
  async pick({ x, y }) { return built.api.pick(Number(x), Number(y)); },
  async bounds({ keys }) { return built.api.bounds(keys || []); },
  async elements() { return built.api.elements(); },
  async calib({ key }) { return built.api.calib(key); },
  // docs/CODE-VERSIONS.md §1: element <-> code links
  // + docs/INSPECTOR.md §1: the object's code regions (markers, else refs/identifiers expanded) and which tweak props the scene reads
  async code({ key }) {
    const files = await sceneFiles(), node = built.code.nodeOf(key), k = String(key);
    const refs = codeRefs({ trace, files, key: k, node });
    return { refs, ...codeRegions({ files, key: k, refs, node }) };
  },
  async codeAt({ file, line }) { return { keys: codeKeysAt({ trace, file: String(file).replace(/\\/g, '/'), line: Number(line), keysIn: built.code.keysIn }) }; },
};

async function boot() {
  meta = await (await fetch(`/scenes/${name}/scene.json`)).json();
  const style = (await import(/* @vite-ignore */ `/style/presets/${meta.style || 'dark-grid'}.js`)).default;
  const mod = await import(/* @vite-ignore */ `/scenes/${name}/scene.js`);
  document.body.style.cssText = 'margin:0;overflow:hidden;background:transparent';

  const tweaks = await readFileTweaks();
  installAnimeTrace();
  const tr = createTrace();
  setActiveTrace(tr);
  let b;
  try { b = await buildScene({ meta, style, mod, parent: document.body, tweaks, trace: tr }); } finally { setActiveTrace(null); }
  trace = tr;
  built = {
    ...b,
    setLive: (o) => b.api.setLive(o),
    setFile: (o) => b.api.setFile(o),
  };
  return meta;
}

// A SyntaxError from import() carries no file/line; the same module as a <script type=module> reports its parse error with
// filename/line/col as a window 'error' event (also for a helper module it imports). Only for location-less SyntaxErrors
// (parse / missing-export errors: the probed module graph never runs).
let probes = 0;
function syntaxWhere(e) {
  const stack = String((e && e.stack) || '');
  if (!(e instanceof SyntaxError) || /:\d+:\d+/.test(stack)) return Promise.resolve(stack);
  return new Promise((res) => {
    const el = document.createElement('script');
    let done = false;
    const finish = (at) => {
      if (done) return; done = true;
      removeEventListener('error', onErr, true); el.remove(); clearTimeout(timer);
      res(at ? `${stack}\n    at ${at}` : stack);
    };
    const onErr = (ev) => { if (ev.filename && /\/(scenes|style)\//.test(ev.filename)) { ev.preventDefault(); finish(`${ev.filename}:${ev.lineno}:${ev.colno}`); } };
    const timer = setTimeout(() => finish(''), 3000);
    addEventListener('error', onErr, true);
    el.type = 'module';
    el.src = `/scenes/${name}/scene.js?gfx-syntax=${++probes}`;
    el.onload = el.onerror = () => setTimeout(() => finish(''), 0);
    document.head.appendChild(el);
  });
}

const ready = boot();
window.__gfx = { ready, get meta() { return meta; } };
const sendReady = (target) => post(target, { type: 'ready', meta });

addEventListener('message', async (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object' || !ev.source) return;
  try { await ready; } catch { return; }
  while (reloading) await reloading;
  if (m.type === 'hello') return sendReady(ev.source);
  const h = handlers[m.type];
  if (!h) return post(ev.source, { id: m.id, type: 'reply', ok: false, error: `unknown message type "${m.type}"` });
  try { post(ev.source, { id: m.id, type: 'reply', ok: true, result: await h(m) }); }
  catch (e) { post(ev.source, { id: m.id, type: 'reply', ok: false, error: String((e && e.message) || e) }); }
});

ready.then(() => {
  Object.assign(window.__gfx, built.api, { seek: (x) => draw(x) });
  if (window.parent !== window) sendReady(window.parent);
}, async (e) => {
  console.error(e);
  // stack: the studio maps it to file:line for its error overlay / Code mode error line (docs/REVIEW.md §5 Live errors)
  if (window.parent !== window) post(window.parent, { type: 'error', message: String((e && e.message) || e), stack: await syntaxWhere(e) });
});

// ---- live code reload ----
const parts = async (v) => {
  const meta = await (await fetch(`/scenes/${name}/scene.json`, { cache: 'no-store' })).json();
  const q = v ? `?v=${v}` : '';
  const style = (await import(/* @vite-ignore */ `/style/presets/${meta.style || 'dark-grid'}.js${q}`)).default;
  const mod = await import(/* @vite-ignore */ `/scenes/${name}/scene.js${q}`);
  return { meta, style, mod, tweaks: await readFileTweaks() };
};

// Keep a static picture in a shadow tree so document-wide scene selectors cannot see it.
function snapshot(root) {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const copy = root.cloneNode(true);
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [copy, ...copy.querySelectorAll('*')];
  originals.forEach((el, i) => {
    const style = getComputedStyle(el);
    for (const key of style) copies[i].style.setProperty(key, style.getPropertyValue(key));
    if (el instanceof HTMLCanvasElement) copies[i].getContext('2d')?.drawImage(el, 0, 0);
  });
  shadow.appendChild(copy);
  return host;
}

async function rebuild(v) {
  const p = await parts(v);
  while (pump) await pump;
  const old = built;
  const picture = snapshot(old.root);
  old.root.replaceWith(picture);
  // The old scene and its snapshot are invisible to document selectors during setup/render.
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden';
  document.body.appendChild(holder);
  try {
    const tr = createTrace();
    setActiveTrace(tr);
    let b;
    try { b = await buildScene({ ...p, parent: holder, trace: tr }); } finally { setActiveTrace(null); }
    await b.api.setLive(live);
    await b.api.setViewQuiet(viewState);
    await b.render(t);
    const changedMeta = JSON.stringify(p.meta) !== JSON.stringify(meta);
    document.body.appendChild(b.root);
    built = { ...b, setLive: (o) => b.api.setLive(o), setFile: (o) => b.api.setFile(o) };
    trace = tr;
    meta = p.meta;
    Object.assign(window.__gfx, built.api, { seek: (x) => draw(x) });
    drawnVer = ver;
    picture.remove();
    return changedMeta;
  } catch (e) {
    picture.replaceWith(old.root);
    throw e;
  } finally { holder.remove(); }
}

let queued = null;
async function drain() {
  while (queued) {
    const q = queued; queued = null;
    const reason = [...new Set(q.files.map((f) => f.split('/').pop()))].join(', ');
    let done;
    reloading = new Promise((r) => { done = r; });
    try {
      const changedMeta = await rebuild(q.v);
      post(window.parent, { type: 'reloaded', reason, files: q.files, ...(changedMeta ? { meta } : {}) });
    } catch (e) {
      console.error(e);
      post(window.parent, { type: 'error', message: String((e && e.message) || e), stack: await syntaxWhere(e), reason, files: q.files });
    } finally { reloading = null; done(); }
  }
}
import.meta.hot?.on('gfx:changed', async (d) => {
  const r = relevant(name, d.files);
  if (!r.files.length) return;
  if (r.full) return location.reload();
  try { await ready; } catch { return location.reload(); } // never booted: a fresh page is the retry
  const files = queued ? [...new Set([...queued.files, ...r.files])] : r.files;
  const running = !!reloading;
  queued = { files, v: d.v };
  if (!running) drain();
});
