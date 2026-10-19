// Settings store of the main window (docs/HOME-SETTINGS.md §2): machine settings (app config dir settings.json) + the open
// project's overrides (gfx.json "settings"), resolved project > this computer > built-in default. Changes apply at once
// and emit 'prefs' ({ keys }). Rules and validation: settings-core.js (twin of prefs.rs).
import * as api from './api.js';
import { emit } from './store.js';
import { SCHEMA, isProjectKey, resolvePref, sanitizeMachine, sanitizeProject, checkPref, migratePanelHeaders } from './settings-core.js';

const P = { machine: sanitizeMachine({}), project: {}, gfxJson: false, meta: { defaults: {}, configDir: '', version: '', platform: 'other' }, ready: false };
export const prefsState = () => P;

/** Effective value. */
export const pref = (key) => resolvePref(key, P.machine, P.project, P.meta.defaults).value;
/** 'project' | 'machine' | 'default' */
export const prefSource = (key) => resolvePref(key, P.machine, P.project, P.meta.defaults).source;
export const defaultOf = (key) => (P.meta.defaults[key] !== undefined ? P.meta.defaults[key] : SCHEMA[key].def);
/** The resolution chain for the inheritance marker: [{ layer, label, set, value }], top first. */
export function prefChain(key) {
  const out = [];
  if (isProjectKey(key)) out.push({ layer: 'project', label: 'Project', set: P.project[key] !== undefined, value: P.project[key] });
  const m = P.machine[key];
  out.push({ layer: 'machine', label: 'This computer', set: m !== undefined && !(SCHEMA[key].type === 'str' && m === ''), value: m });
  out.push({ layer: 'default', label: 'Default', set: true, value: defaultOf(key) });
  return out;
}
export const hasOverride = (key) => P.project[key] !== undefined;
export const machineSet = (key) => prefChain(key).find((l) => l.layer === 'machine').set;

/** `edit`: a user change (setPref / resetPref), not a reload from disk. */
const changed = (keys, edit = false) => {
  emit('prefs', { keys });
  if (edit && keys.includes('workflow')) refreshWorkflow();
};
/** docs/LOOKS.md §1: the managed CLAUDE.md block shows the workflow, so it is rewritten when the setting changes (machine
 *  default or project override). Runs in the background; a failure is a toast (the setting itself is saved). */
let wfRun = null, wfAgain = false;
export function refreshWorkflow() {
  if (wfRun) { wfAgain = true; return wfRun; }
  wfRun = (async () => {
    do {
      wfAgain = false;
      try { const ran = await api.refreshWorkflowBlock(); emit('workflow-block', { ran }); }
      catch (e) { emit('toast', { m: `CLAUDE.md workflow line not updated: ${e.message || e}`, ms: 6000 }); }
    } while (wfAgain);
    wfRun = null;
  })();
  return wfRun;
}

/** Set a value. scope: 'machine' | 'project' | 'auto' (= where the value comes from now: the project override if there is
 *  one, else this computer). A machine value equal to the default is stored as "not set". Rejects with the error text. */
export async function setPref(key, value, scope = 'auto') {
  const v = checkPref(key, value);
  if (scope === 'auto') scope = isProjectKey(key) && hasOverride(key) ? 'project' : 'machine';
  if (scope === 'project') {
    if (!isProjectKey(key)) throw new Error('applies to this computer only');
    P.project = (await api.patchProjectSettings({ [key]: v })).settings;
  } else {
    const same = JSON.stringify(v) === JSON.stringify(defaultOf(key));
    P.machine = sanitizeMachine(await api.patchSettings({ [key]: same ? null : v }));
  }
  changed([key], true);
}
/** ↺: remove the project override (scope 'project') or the machine value (scope 'machine'). */
export async function resetPref(key, scope) {
  if (scope === 'project') P.project = (await api.patchProjectSettings({ [key]: null })).settings;
  else P.machine = sanitizeMachine(await api.patchSettings({ [key]: null }));
  changed([key], true);
}

/** Reload the project overrides (project switch, or gfx.json changed on disk). */
export async function reloadProject() {
  try { const r = await api.getProjectSettings(); P.project = sanitizeProject(r.settings); P.gfxJson = !!r.gfxJson; }
  catch { P.project = {}; P.gfxJson = false; }
  changed(Object.keys(SCHEMA).filter(isProjectKey));
}
export async function reloadMachine() {
  try { P.machine = sanitizeMachine(await api.getSettings()); } catch { /* keep */ }
  changed(Object.keys(SCHEMA));
}

// One-time move of the old browser-storage preferences into settings.json (the old keys are removed).
const MIGRATE = [
  ['gfx-studio.ask.send', 'askSend', (v) => v === '1'],
  ['gfx-studio.code.autosave', 'codeAutosave', (v) => v === '1'],
  ['gfx-studio.versions.auto', 'versionsAuto', (v) => v !== '0'],
  ['gfx.uiZoom', 'uiZoom', (v) => +v],
];
export async function migrateLocalStorage(storage = localStorage) {
  const patch = {};
  for (const [ls, key, conv] of MIGRATE) {
    const raw = storage.getItem(ls);
    if (raw === null) continue;
    try {
      const v = checkPref(key, conv(raw));
      if (P.machine[key] === undefined && JSON.stringify(v) !== JSON.stringify(SCHEMA[key].def)) patch[key] = v;
    } catch { /* an invalid old value is just dropped */ }
  }
  if (Object.keys(patch).length) P.machine = sanitizeMachine(await api.patchSettings(patch));
  P.machine = sanitizeMachine(await migratePanelHeaders(storage, P.machine, api.patchSettings));
  for (const [ls] of MIGRATE) storage.removeItem(ls);
  storage.removeItem('gfx-studio.mic'); // Perform's microphone choice (Perform removed 2026-10-19)
  // the old recent list (Projects home) -> recent.json
  const old = storage.getItem('gfx-studio.recent');
  if (old !== null) {
    try { const list = JSON.parse(old); if (Array.isArray(list)) await api.recentImport(list.filter((e) => e && typeof e.path === 'string').map((e) => ({ path: e.path, name: String(e.name || ''), opened: +e.opened || 0, pinned: false }))); } catch { /* dropped */ }
    storage.removeItem('gfx-studio.recent');
  }
}

export async function initPrefs() {
  const [m, meta] = await Promise.all([api.getSettings().catch(() => ({})), api.settingsMeta().catch(() => null)]);
  P.machine = sanitizeMachine(m);
  if (meta) P.meta = meta;
  try { await migrateLocalStorage(); } catch (e) { console.warn('[prefs] migration', e); }
  await reloadProject();
  P.ready = true;
}
