// §7 chrome entry points. Scene / render / terminal implementations remain with their existing owners.
import { $ } from './dom.js';
import { S, on } from './store.js';
import { keysOf } from './keys.js';
import { toggleHelp } from './keys-help.js';
import { openSettings } from './settings.js';
import { openWelcome } from './api.js';
import { pref, setPref } from './prefs.js';
import { openMenu, closeMenu } from './menu.js';
import { openPanelsMenu } from './layout.js';
import { appMenuItems, sceneMenuItems } from './toolbar-items.js';
import { openSaveTemplate } from './savetemplate.js';

const hint = (id) => keysOf(id).join(' / ');
const hasProject = () => !!S.projectName && S.projectName !== 'No project';
export function syncBreadcrumb() {
  const b = $('scene-menu-btn');
  b.querySelector('.btn-label').textContent = S.name || 'Select scene…';
  b.title = S.name || 'Scene';
  b.disabled = S.loading;
}
function menu(anchor, items) {
  if (anchor.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
  openMenu(anchor, items, { onClose: () => anchor.setAttribute('aria-expanded', 'false') });
  anchor.setAttribute('aria-expanded', 'true');
}
export function initToolbar({ select, newScene, brief, hasBrief, reload, library, startClaude, openT3, quickRender, openRender, toast }) {
  const safe = (label, fn) => () => Promise.resolve().then(fn).catch((e) => toast(`${label}: ${e.message || e}`, 5000));
  const welcome = safe('Switch project', openWelcome);
  $('root-btn').onclick = welcome;
  $('root-btn').title = `Switch project (${hint('welcome')})`;
  $('app-menu-btn').onclick = (e) => menu(e.currentTarget, appMenuItems({
    settings: openSettings, library: library(), panels: () => openPanelsMenu($('app-menu-btn')), help: toggleHelp, welcome,
  }, hint));
  $('scene-menu-btn').onclick = (e) => menu(e.currentTarget, sceneMenuItems({
    scenes: S.scenes, current: S.name, hasBrief: hasBrief(), hasProject: hasProject(), loading: S.loading,
  }, { select: safeSelect, newScene: safe('New scene', newScene), brief: safe('Brief', brief), reload: safe('Reload failed', reload), saveTemplate: safe('Save as template', openSaveTemplate) }));
  // Re-choosing the open scene is a no-op (like the old <select>): reloading would drop unsaved draft edits.
  const safeSelect = (name) => (name === S.name ? undefined : safe('Scene', () => select(name))());
  $('disk-badge').onclick = safe('Reload failed', reload);
  let lastTarget = pref('claudeTarget'), writes = Promise.resolve(), pending = 0;
  const target = () => lastTarget;
  const syncClaude = () => { $('claude-btn').title = target() === 't3' ? 'Claude: T3 panel' : 'Claude in terminal'; };
  const launch = (t) => safe('Claude', t === 't3' ? openT3 : startClaude)();
  const choose = (t) => {
    // Launch immediately; settings writes follow the same machine-pref path as UI zoom / panel headers.
    lastTarget = t; syncClaude(); pending++;
    writes = writes.then(() => setPref('claudeTarget', t, 'machine'))
      .catch((e) => toast('Claude target not saved: ' + (e.message || e), 5000))
      .finally(() => { pending--; });
    launch(t);
  };
  $('claude-btn').onclick = (e) => { e.currentTarget.blur(); launch(target()); };
  $('claude-menu-btn').onclick = (e) => menu(e.currentTarget, [
    { id: 'claude-terminal', label: 'Claude in terminal', checked: target() === 'terminal', run: () => choose('terminal') },
    { id: 't3', label: 'T3 panel', checked: target() === 't3', run: () => choose('t3') },
  ]);
  $('render-quick').onclick = (e) => menu(e.currentTarget, [
    { id: 'render', label: 'Render…', hint: hint('render'), run: openRender },
    { id: 'render-quick', label: 'Quick render', hint: hint('render.quick'), run: quickRender },
  ]);
  for (const [id, key, label] of [['undo-btn', 'undo', 'Undo'], ['redo-btn', 'redo', 'Redo'], ['save-btn', 'save', 'Save draft'], ['render-btn', 'render', 'Render dialog']]) {
    $(id).title = `${label} (${hint(key)})`;
  }
  on('prefs', ({ keys } = {}) => { if (!pending && keys?.includes('claudeTarget')) lastTarget = pref('claudeTarget'); syncClaude(); });
  syncClaude(); syncBreadcrumb();
}
