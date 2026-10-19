// Settings, project overrides and the recent list (docs/HOME-SETTINGS.md): pure helpers shared by the page (prefs.js,
// settings.js, welcome.js) and the dev shim (vite.config.js). Twins of src-tauri/src/prefs.rs (same rules, same tests).

export const UI_ZOOMS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const MAX_RECENT = 12;
const str = (max = 1000) => ({ type: 'str', max });

/** key -> { def, type, p (can be overridden per project), ... }. Machine values live in settings.json, project overrides
 *  in the project's gfx.json "settings". Defaults are built in (projectsDir: '' = the platform default from settings_meta). */
export const SCHEMA = {
  onStart: { def: 'welcome', type: 'enum', values: ['welcome', 'last'] },
  projectsDir: { def: '', type: 'str', max: 1000, abs: true },
  editor: { def: 'vscode', type: 'enum', values: ['vscode', 'system', 'custom'] },
  editorCommand: str(),
  uiZoom: { def: 1, type: 'zoom' },
  showHeaders: { def: false, type: 'bool' },
  renderMode: { def: 'fast', type: 'enum', values: ['fast', 'exact'], p: true },
  renderWorkers: { def: 0, type: 'int', min: 0, max: 16, p: true },
  renderPreset: { def: 'scene', type: 'preset', p: true },
  renderQuality: { def: 'normal', type: 'enum', values: ['draft', 'normal', 'high'], p: true },
  renderFrameFormat: { def: 'png', type: 'enum', values: ['png', 'jpeg'], p: true },
  renderAudio: { def: true, type: 'bool', p: true },
  renderOutDir: { def: 'out', type: 'outdir', p: true },
  codeAutosave: { def: false, type: 'bool', p: true },
  versionsAuto: { def: true, type: 'bool', p: true },
  shell: str(),
  claudeCommand: str(),
  claudeTarget: { def: 'terminal', type: 'enum', values: ['terminal', 't3'] },
  askSend: { def: false, type: 'bool' },
  engineDir: { def: '', type: 'str', max: 1000, abs: true }, // '' = auto (GFX_ENGINE, else engine/ next to the exe)
  // docs/LOOKS.md §1: first-take workflow profile, "quick" | "full" | { verify, render, sound } (= custom)
  workflow: { def: 'quick', type: 'workflow', p: true },
  // docs/LOOKS.md §3: the machine Library folder ('' = <Documents>/gfx library from settings_meta)
  libraryDir: { def: '', type: 'str', max: 1000, abs: true },
};
/** Workflow profiles (twin of runner/lib/workflow.js PROFILES). */
export const WORKFLOW_PROFILES = { quick: { verify: 'sheet', render: false, sound: 'asked' }, full: { verify: 'full', render: true, sound: 'always' } };
export const WORKFLOW_VERIFY = ['sheet', 'stills', 'full'];
export const WORKFLOW_SOUND = ['asked', 'always'];
/** { profile: 'quick'|'full'|'custom', verify, render, sound } of a valid workflow value. */
export function workflowFields(v) {
  if (typeof v === 'string' && WORKFLOW_PROFILES[v]) return { profile: v, ...WORKFLOW_PROFILES[v] };
  if (v && typeof v === 'object') return { profile: 'custom', verify: v.verify, render: v.render, sound: v.sound };
  return { profile: 'quick', ...WORKFLOW_PROFILES.quick };
}
/** The `--workflow` argument of the engine for a valid value: the name, or the custom object as JSON. */
export const workflowArg = (v) => (typeof v === 'string' ? v : JSON.stringify({ verify: v.verify, render: v.render, sound: v.sound }));
for (const s of Object.values(SCHEMA)) if (s.type === 'str' && s.def === undefined) s.def = '';
export const PROJECT_KEYS = Object.keys(SCHEMA).filter((k) => SCHEMA[k].p);
export const isProjectKey = (k) => !!SCHEMA[k]?.p;

const isAbs = (p) => /^([A-Za-z]:[\\/]|\\\\|\/)/.test(p);

/** Validate one value; returns the normalized value or throws Error(message). */
export function checkPref(key, v) {
  const s = SCHEMA[key];
  if (!s) throw new Error(`unknown setting: ${key}`);
  const bad = (why) => new Error(`${key}: ${why}`);
  switch (s.type) {
    case 'bool': if (typeof v !== 'boolean') throw bad('expected true or false'); return v;
    case 'enum': if (!s.values.includes(v)) throw bad(`expected one of ${s.values.join(', ')}`); return v;
    case 'int': if (!Number.isInteger(v) || v < s.min || v > s.max) throw bad(`expected a whole number ${s.min}-${s.max}`); return v;
    case 'zoom': { const z = UI_ZOOMS.find((x) => typeof v === 'number' && Math.abs(x - v) < 1e-3); if (z === undefined) throw bad('not a UI scale step'); return z; }
    case 'str': {
      if (typeof v !== 'string') throw bad('expected text');
      const t = v.trim();
      if (/[\0\r\n]/.test(t) || t.length > s.max) throw bad('invalid text (no line breaks, at most ' + s.max + ' characters)');
      if (s.abs && t && !isAbs(t)) throw bad('needs a full path (C:\\… or /…)');
      return t;
    }
    case 'workflow': {
      if (typeof v === 'string') { if (WORKFLOW_PROFILES[v]) return v; throw bad('expected quick, full or a custom { verify, render, sound }'); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw bad('expected quick, full or a custom { verify, render, sound }');
      const d = WORKFLOW_PROFILES.quick, o = { verify: v.verify ?? d.verify, render: v.render ?? d.render, sound: v.sound ?? d.sound };
      if (!WORKFLOW_VERIFY.includes(o.verify)) throw bad(`verify: expected one of ${WORKFLOW_VERIFY.join(', ')}`);
      if (typeof o.render !== 'boolean') throw bad('render: expected true or false');
      if (!WORKFLOW_SOUND.includes(o.sound)) throw bad(`sound: expected one of ${WORKFLOW_SOUND.join(', ')}`);
      return o;
    }
    case 'preset': if (typeof v !== 'string' || !(v === 'scene' || /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(v))) throw bad('not a size preset id'); return v;
    case 'outdir': {
      if (typeof v !== 'string') throw bad('expected a folder');
      const t = v.trim().replace(/\\/g, '/').replace(/\/+$/, '');
      const parts = t.split('/');
      if (t.length > 200 || parts[0] !== 'out' || parts.some((x) => !x || x === '.' || x === '..' || /[:*?"<>|\0]/.test(x))) throw bad('must be out/ or a folder inside out/ (e.g. out/renders)');
      return t;
    }
    default: throw bad('unknown type');
  }
}

/** Machine settings: apply { key: value | null } (null = back to the default). Unknown keys throw (strict patch). */
export function patchMachine(cur, patch) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!SCHEMA[k]) throw new Error(`unknown setting: ${k}`);
    if (v === null) { if (k === 'shell' || k === 'claudeCommand') next[k] = ''; else delete next[k]; }
    else next[k] = checkPref(k, v);
  }
  return next;
}
/** settings.json as read from disk: keep valid known keys only (old / broken values are dropped, never fatal). */
export function sanitizeMachine(raw) {
  const out = { shell: '', claudeCommand: '' };
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) { if (SCHEMA[k]) { try { out[k] = checkPref(k, v); } catch { /* dropped */ } } }
  return out;
}
/** Project overrides: only project keys; null removes the override. */
export function patchProject(cur, patch) {
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!isProjectKey(k)) throw new Error(`${SCHEMA[k] ? 'not a per-project setting' : 'unknown setting'}: ${k}`);
    if (v === null) delete next[k]; else next[k] = checkPref(k, v);
  }
  return next;
}
export function sanitizeProject(raw) {
  const out = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw)) { if (isProjectKey(k)) { try { out[k] = checkPref(k, v); } catch { /* dropped */ } } }
  return out;
}

/** Effective value and where it comes from: project override, then this computer, then the built-in default. */
export function resolvePref(key, machine = {}, project = {}, defaults = {}) {
  const s = SCHEMA[key];
  if (s.p && project[key] !== undefined) return { value: project[key], source: 'project' };
  const m = machine[key];
  if (m !== undefined && !(s.type === 'str' && m === '')) return { value: m, source: 'machine' }; // '' text = not set
  return { value: defaults[key] !== undefined ? defaults[key] : s.def, source: 'default' };
}

// ---------- recent.json ----------
/** Comparison key for paths: forward slashes, lower case, no trailing slash. */
export const pathKey = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
export function emptyRecent() { return { recent: [], folders: [] }; }
export function sanitizeRecent(raw) {
  const r = emptyRecent();
  if (!raw || typeof raw !== 'object') return r;
  const seen = new Set();
  for (const e of Array.isArray(raw.recent) ? raw.recent : []) {
    if (!e || typeof e.path !== 'string' || !e.path || seen.has(pathKey(e.path))) continue;
    seen.add(pathKey(e.path));
    r.recent.push({ path: e.path, name: typeof e.name === 'string' ? e.name : '', opened: Number.isFinite(e.opened) ? e.opened : 0, pinned: !!e.pinned });
  }
  const fs = new Set();
  for (const f of Array.isArray(raw.folders) ? raw.folders : []) if (typeof f === 'string' && f && !fs.has(pathKey(f))) { fs.add(pathKey(f)); r.folders.push(f); }
  r.recent = sortCap(r.recent, null);
  return r;
}
/** Pinned first, then newest first; at most MAX_RECENT (the oldest unpinned go first; `keep` is never dropped). */
export function sortCap(list, keep) {
  const sorted = [...list].sort((a, b) => (b.pinned - a.pinned) || (b.opened - a.opened));
  while (sorted.length > MAX_RECENT) {
    const kk = keep ? pathKey(keep) : null;
    let i = -1;
    for (let j = sorted.length - 1; j >= 0; j--) if (!sorted[j].pinned && pathKey(sorted[j].path) !== kk) { i = j; break; }
    if (i < 0) for (let j = sorted.length - 1; j >= 0; j--) if (pathKey(sorted[j].path) !== kk) { i = j; break; }
    sorted.splice(i, 1);
  }
  return sorted;
}
export function touchRecent(r, path, name, now) {
  const k = pathKey(path), old = r.recent.find((e) => pathKey(e.path) === k);
  const rest = r.recent.filter((e) => pathKey(e.path) !== k);
  return { ...r, recent: sortCap([{ path, name: name || old?.name || '', opened: now, pinned: !!old?.pinned }, ...rest], path) };
}
export function pinRecent(r, path, pinned) {
  const k = pathKey(path);
  return { ...r, recent: sortCap(r.recent.map((e) => (pathKey(e.path) === k ? { ...e, pinned: !!pinned } : e)), null) };
}
export function removeRecent(r, path) { const k = pathKey(path); return { ...r, recent: r.recent.filter((e) => pathKey(e.path) !== k) }; }
/** Locate…: the project moved to `to` (keeps pin and name). */
export function relocateRecent(r, from, to, name, now) {
  const k = pathKey(from), old = r.recent.find((e) => pathKey(e.path) === k);
  const rest = r.recent.filter((e) => pathKey(e.path) !== k && pathKey(e.path) !== pathKey(to));
  return { ...r, recent: sortCap([{ path: to, name: name || old?.name || '', opened: now, pinned: !!old?.pinned }, ...rest], to) };
}
export function addFolder(r, path) { return r.folders.some((f) => pathKey(f) === pathKey(path)) ? r : { ...r, folders: [...r.folders, path] }; }
export function removeFolder(r, path) { const k = pathKey(path); return { ...r, folders: r.folders.filter((f) => pathKey(f) !== k) }; }
export function relocateFolder(r, from, to) {
  const k = pathKey(from);
  const folders = r.folders.map((f) => (pathKey(f) === k ? to : f));
  return { ...r, folders: folders.filter((f, i) => folders.findIndex((g) => pathKey(g) === pathKey(f)) === i) };
}

// ---------- gfx.json "settings" (text edit: other keys and their formatting stay as they are) ----------
/** Top-level entries of a JSON object text: [{ key, keyStart, valueStart, valueEnd }], plus the brace positions. */
export function scanObject(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const fail = (why) => { throw new Error(`gfx.json: ${why} at ${i}`); };
  const strEnd = () => { // text[i] === '"'
    i++;
    while (i < text.length) { if (text[i] === '\\') i += 2; else if (text[i] === '"') { i++; return; } else i++; }
    fail('unterminated string');
  };
  const value = () => {
    ws();
    const c = text[i];
    if (c === '"') return strEnd();
    if (c === '{' || c === '[') {
      const stack = [c === '{' ? '}' : ']']; i++;
      while (i < text.length && stack.length) {
        const d = text[i];
        if (d === '"') { strEnd(); continue; }
        if (d === '{') stack.push('}'); else if (d === '[') stack.push(']');
        else if (d === '}' || d === ']') { if (stack.pop() !== d) fail('mismatched bracket'); }
        i++;
      }
      if (stack.length) fail('unterminated value');
      return;
    }
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
    if (!m) fail('bad value');
    i += m[0].length;
  };
  ws();
  if (text[i] !== '{') fail('not an object');
  const open = i; i++;
  const entries = [];
  ws();
  if (text[i] === '}') return { open, close: i, entries };
  for (;;) {
    ws();
    if (text[i] !== '"') fail('expected a key');
    const keyStart = i; strEnd();
    const key = JSON.parse(text.slice(keyStart, i));
    ws();
    if (text[i] !== ':') fail('expected :');
    i++; ws();
    const valueStart = i; value();
    entries.push({ key, keyStart, valueStart, valueEnd: i });
    ws();
    if (text[i] === ',') { i++; continue; }
    if (text[i] === '}') return { open, close: i, entries };
    fail('expected , or }');
  }
}
/** Set (value object) or remove (null) the top-level "settings" key of a gfx.json text. Throws if the result would
 *  change any other key. An empty object removes the key. */
export function setSettingsText(text, value) {
  const { open, close, entries } = scanObject(text);
  const v = value && Object.keys(value).length ? value : null;
  const first = entries[0];
  const lineStart = first ? text.lastIndexOf('\n', first.keyStart) + 1 : -1;
  const indent = first && /^[ \t]*$/.test(text.slice(lineStart, first.keyStart)) ? text.slice(lineStart, first.keyStart) : '  ';
  const ser = v ? JSON.stringify(v, null, 2).replace(/\n/g, '\n' + indent) : '';
  const at = entries.findIndex((e) => e.key === 'settings');
  let out;
  if (at >= 0 && v) out = text.slice(0, entries[at].valueStart) + ser + text.slice(entries[at].valueEnd);
  else if (at >= 0) {
    const e = entries[at];
    if (at > 0) out = text.slice(0, entries[at - 1].valueEnd) + text.slice(e.valueEnd);
    else if (entries.length > 1) out = text.slice(0, e.keyStart) + text.slice(entries[1].keyStart);
    else out = text.slice(0, open + 1) + text.slice(close);
  } else if (!v) out = text;
  else if (entries.length) { const last = entries[entries.length - 1]; out = text.slice(0, last.valueEnd) + `,\n${indent}"settings": ${ser}` + text.slice(last.valueEnd); }
  else out = text.slice(0, open) + `{\n${indent}"settings": ${ser}\n}` + text.slice(close + 1);
  const a = JSON.parse(text), b = JSON.parse(out);
  delete a.settings; const bs = b.settings; delete b.settings;
  if (JSON.stringify(sortKeys(a)) !== JSON.stringify(sortKeys(b)) || JSON.stringify(bs ?? null) !== JSON.stringify(v)) throw new Error('gfx.json: refusing an edit that would change other keys');
  return out;
}
const sortKeys = (o) => (Array.isArray(o) ? o.map(sortKeys) : o && typeof o === 'object' ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o);

/** Move the legacy per-layout header preference once. Strip it only after settings persist successfully. */
export async function migratePanelHeaders(storage, machine, writeSettings) {
  const layouts = [];
  for (const mode of ['review', 'code']) {
    const key = `gfx.layout.v1.${mode}`;
    try {
      const layout = JSON.parse(storage.getItem(key) || 'null');
      if (layout && Object.hasOwn(layout, 'showHeaders')) layouts.push({ key, layout });
    } catch { /* ignore invalid layouts */ }
  }
  let next = machine;
  if (machine.showHeaders === undefined && layouts.some(({ layout }) => layout.showHeaders)) next = await writeSettings({ showHeaders: true });
  for (const { key, layout } of layouts) {
    delete layout.showHeaders;
    storage.setItem(key, JSON.stringify(layout));
  }
  return next;
}
