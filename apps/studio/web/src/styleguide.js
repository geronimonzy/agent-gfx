// Isolated specimens: load the real CSS, never main.js or the studio backend.
// Markup sources: index.html; menu.js; settings.js rowHtml; library.js cards;
// main.js draft dialog; notes.js popover; code.js/terminal.js tabs; tracks.js.
import { setTheme } from './theme.js';
import { initMeasurements } from './styleguide-measure.js';
import semanticSheet from './theme/dark.css?raw';
import studioHtml from '../index.html?raw';
import keymapSource from './keymap.js?raw';
import { appMenuItems, sceneMenuItems } from './toolbar-items.js';

const esc = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const icon = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const searchIcon = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
const specimen = (html) => `<span class="sg-sample">${html}</span>`;
const sizes = [['default', ''], ['sm', 'sm'], ['xs', 'xs']];
const states = [['Rest', ''], ['Hover', 'is-hover'], ['Active', 'is-active'], ['Focus-visible', 'is-focus'], ['Disabled', 'disabled'], ['Selected / on', 'on']];
const attrs = (state) => state === 'disabled' ? 'disabled' : `class="${state}"`;
const button = (classes, text = 'Agpy label', state = '', extra = '') => `<button type="button" class="${classes} ${state === 'disabled' ? '' : state}" ${state === 'disabled' ? 'disabled' : ''} ${extra}>${text}</button>`;
// Keep all states visible inside each density card, without a clipped/scrolling matrix.
const table = (headings, rows) => {
  const groups = [];
  for (let start = 1; start < headings.length; start += 3) {
    const end = Math.min(start + 3, headings.length);
    groups.push(`<div class="sg-table-wrap"><table class="sg-table"><thead><tr>${[headings[0], ...headings.slice(start, end)].map((h) => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(({ name, cells }) => `<tr><th scope="row">${name}</th>${cells.slice(start - 1, end - 1).map((c) => `<td>${specimen(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
  }
  return groups.join('');
};
const row = (name, cells) => ({ name, cells });
const compare = (render) => `<div class="sg-compare">${['comfortable', 'dense'].map((density) => `<div class="sg-density" data-density="${density}"><h3>${density === 'dense' ? 'Dense' : 'Comfortable'} · <span data-density-heights></span></h3>${render(density)}</div>`).join('')}</div>`;
const sections = [];
function section(id, title, description, html) {
  sections.push({ id, title });
  document.querySelector('#sg-content').insertAdjacentHTML('beforeend', `<section class="sg-section" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2><p>${description}</p>${html}</section>`);
}

// Derive the complete colour inventory from the semantic sheet: new tokens appear automatically.
const tokenNames = [...semanticSheet.matchAll(/\s(--[\w-]+):/g)].map((m) => m[1]);
const colourNames = tokenNames.filter((name) => CSS.supports('color', getComputedStyle(document.documentElement).getPropertyValue(name).trim()));
section('colours', 'Colours', 'Every semantic colour, including studio, terminal and persisted annotation palettes. Both themes remain visible when the page theme changes.',
  `<div class="sg-compare">${['dark', 'light'].map((theme) => `<div class="sg-theme" data-theme="${theme}"><h3>${theme}</h3><div class="sg-swatches">${colourNames.map((name) => `<figure class="sg-swatch"><i style="background:var(${name})"></i><figcaption>${name}<small data-colour-value></small></figcaption></figure>`).join('')}</div></div>`).join('')}</div>`);

section('typography', 'Typography', 'The same sans and mono stacks as the app. Every size includes ascenders, descenders and timecode.',
  ['3xs', '2xs', 'xs', 'sm', 'base', 'lg', 'xl', 'display', 'hero'].map((size) => `<div class="sg-token"><code>--text-${size}</code><span style="font-size:var(--text-${size})">Agpy Ågj · gfx studio</span><span style="font-size:var(--text-${size});font-family:var(--font-mono)">00:07.61</span></div>`).join('') +
  '<div class="sg-token"><span style="font-weight:400">400 · Body</span><span style="font-weight:500">500 · Controls</span><span style="font-weight:600">600 · Headings</span></div>');

section('geometry', 'Spacing / radius / shadow', 'Semantic geometry shared by the app; control heights change at density boundaries.',
  ['1', '2', '4', '6', '8', '10', '12', '16', '20', '24', '32'].map((step) => `<div class="sg-token"><code>--space-${step}</code><i class="sg-measure" style="width:var(--space-${step})"></i></div>`).join('') +
  `<div class="sg-flow">${['radius-none', 'radius-xs', 'radius-sm', 'radius-control', 'radius', 'radius-pill', 'radius-round'].map((name) => `<div class="sg-stack"><div class="sg-shape" style="border-radius:var(--${name})"></div><code>--${name}</code></div>`).join('')}<div class="sg-shadow"><code>--shadow-overlay</code></div></div>`);

const variants = [['Default', 'btn'], ['Primary', 'btn primary'], ['Ghost', 'btn ghost'], ['Outline', 'btn outline'], ['Destructive', 'btn destructive'], ['App .tbtn', 'tbtn'], ['App .primary', 'primary']];
section('buttons', 'Buttons', 'Variants × sizes × persistent states. The final columns check icons, keyboard hints, counts and long labels. Hover, active and focus use the same CSS rules as live interaction.',
  compare(() => table(['Variant / size', ...states.map(([label]) => label), 'With icon', 'Icon only', 'With kbd', 'With count', 'Long label'], variants.flatMap(([name, classes]) => sizes.map(([size, sizeClass]) => {
    const cls = `${classes} ${sizeClass}`;
    return row(`${name} / ${size}`, [...states.map(([, state]) => button(cls, 'Agpy', state)), button(cls, `${icon}Agpy`), button(`${cls} icon`, icon, '', 'aria-label="Add"'), button(cls, 'Save <kbd>Ctrl S</kbd>'), button(cls, 'Queue <b class="t3-badge">3</b>'), button(`${cls} sg-long`, '<span class="btn-label">A long label with descenders Agpy</span>', '', 'title="A long label with descenders Agpy"')]);
  })))) + compare(() => `<h3>App compositions</h3><div class="sg-flow">${specimen('<span class="split"><button type="button" class="tbtn">Render</button><button type="button" class="tbtn" aria-label="Quick render">▸</button></span>')}${specimen(button('tbtn claude-btn', '<i class="cl-mark"></i>Claude'))}${specimen(button('tbtn t3-btn', '<i class="t3-mark"></i>T3<b class="t3-badge">2</b>'))}${specimen(button('tbtn rq-chip', '<i class="spin"></i><span>Queue</span><b>3</b>'))}${specimen(button('proj-btn', 'gfx project'))}${specimen(button('icon', icon, '', 'aria-label="Add scene"'))}</div>`));

// Clone the production bar, including its real ids/classes and SVGs. Prefix specimen ids only after state setup.
const toolbarTemplate = new DOMParser().parseFromString(studioHtml, 'text/html').querySelector('#topbar');
const noop = () => {};
// The guide does not bootstrap the studio; read shortcut labels from the authoritative registry source.
const guideKeys = new Map([...keymapSource.matchAll(/id: '([^']+)', keys: \[([^\]]+)\]/g)].map((m) => [m[1], m[2].replaceAll("'", '')]));
const guideHint = (id) => guideKeys.get(id) || '';
const menuSpecimen = (items) => `<div class="gfx-menu" role="menu">${items.map((it) => it.sep ? '<div class="gfx-menu-sep" role="separator"></div>' : `<button type="button" class="gfx-menu-item" role="${it.checked == null ? 'menuitem' : 'menuitemcheckbox'}" ${it.checked == null ? '' : `aria-checked="${it.checked}"`} ${it.disabled ? 'disabled' : ''}><i class="gfx-check">${it.checked ? '✓' : ''}</i><span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('')}</div>`;
const guideScenes = [{ name: '_reel-test', hasVideo: true }, { name: '_review-test', hasVideo: true }];
const toolbarStates = ['No project', 'Normal', 'All three chips', 'Claude waiting', 'Queue present', 'App menu open', 'Scene menu open'];
function toolbarSpecimen(state, prefix) {
  const bar = toolbarTemplate.cloneNode(true), find = (id) => bar.querySelector(`#${id}`);
  const empty = state === 'No project';
  find('root-btn').querySelector('.btn-label').textContent = empty ? 'No project' : 'agent-gfx';
  find('scene-menu-btn').querySelector('.btn-label').textContent = empty ? 'Select scene…' : '_reel-test';
  find('save-btn').disabled = empty;
  find('render-split').hidden = empty;
  for (const id of ['undo-btn', 'redo-btn']) find(id).disabled = empty;
  if (state === 'All three chips') for (const id of ['disk-badge', 'claude-chip', 'synth-chip']) find(id).hidden = false;
  if (state === 'Claude waiting') { const badge = find('claude-btn').querySelector('.t3-badge'); badge.hidden = false; badge.textContent = '3'; }
  if (state === 'Queue present') { find('rq-btn').hidden = false; find('rq-btn').querySelector('b').textContent = '2'; }
  if (state.endsWith('menu open')) find(state === 'App menu open' ? 'app-menu-btn' : 'scene-menu-btn').setAttribute('aria-expanded', 'true');
  for (const el of [bar, ...bar.querySelectorAll('[id]')]) if (el.id) el.id = `${prefix}-${el.id}`;
  let menu = '';
  if (state === 'App menu open') menu = menuSpecimen(appMenuItems({ settings: noop, library: noop, panels: noop, help: noop, welcome: noop }, guideHint));
  if (state === 'Scene menu open') menu = menuSpecimen(sceneMenuItems({ scenes: guideScenes, current: '_reel-test', hasBrief: true, hasProject: true }, {}));
  return bar.outerHTML + (menu ? `<div class="sg-toolbar-menus">${menu}</div>` : '');
}
section('top-bar', 'Top bar', 'Production markup at 1280 and 1680 CSS pixels. The frame is scrollable on smaller displays; named container queries match the app. Menus are static specimens.',
  ['narrow', 'wide'].map((size) => `<div class="sg-toolbar-scroll"><div class="sg-toolbar-frame ${size}">${toolbarStates.map((state, i) => `<h3>${size === 'narrow' ? '1280' : '1680'} px · ${state}</h3>${toolbarSpecimen(state, `sg-${size}-${i}`)}`).join('')}</div></div>`).join(''));

section('inputs', 'Inputs', 'Native text, search, number, password, URL, select and textarea controls; checkbox, radio and the inspector switch. Single-line fields use symmetric padding and cap-centred line boxes; multiline editors retain their natural leading.',
  compare(() => table(['Field / size', 'Rest', 'Hover', 'Focus-visible', 'Disabled'], sizes.flatMap(([size, cls]) => ['text', 'search', 'number', 'password', 'url', 'select'].map((kind) => row(`${kind} / ${size}`, ['', 'is-hover', 'is-focus', 'disabled'].map((state) => {
    const dis = state === 'disabled' ? 'disabled' : '';
    const common = `class="${cls} ${dis ? '' : state}" ${dis} aria-label="${kind} ${size} ${state || 'rest'}"`;
    return kind === 'select' ? `<select ${common}><option>Agpy label</option><option>Another option</option></select>` : `<input type="${kind}" ${common} ${kind === 'number' ? 'value="7.61" step="0.01"' : 'placeholder="Agpy placeholder"'}>`;
  })))).concat(row('textarea', ['', 'is-hover', 'is-focus', 'disabled'].map((state) => `<textarea ${attrs(state)} rows="3" aria-label="Brief ${state || 'rest'}" placeholder="Agpy brief, wrapping across lines"></textarea>`))))) +
  compare((density) => `<div class="sg-flow">${['', 'checked', 'disabled', 'checked disabled'].map((state) => specimen(`<label class="chk"><input type="checkbox" ${state}>${state || 'Unchecked'}</label>`)).join('')}${specimen('<label class="chk"><input type="checkbox" class="is-focus">Focus</label>')}${['', 'checked', 'disabled'].map((state, i) => specimen(`<label class="chk"><input type="radio" name="sg-radio-${density}-${i}" ${state}>Radio ${state || 'off'}</label>`)).join('')}${specimen('<span class="toggle" tabindex="0"><i></i><span>off</span></span>')}${specimen('<span class="toggle on is-focus" tabindex="0"><i></i><span>on</span></span>')}</div><h3>Settings search composition</h3><div class="sp-search">${searchIcon}<input type="search" aria-label="Search settings specimen" placeholder="Search settings…"><kbd>Ctrl ,</kbd><button type="button" class="sp-q-clear" aria-label="Clear search specimen">×</button></div><h3>New scene · This take</h3><div class="ns-row"><div class="seg ns-seg" role="radiogroup" aria-label="This take specimen ${density}"><label><input type="radio" name="sg-take-${density}" checked><span>Quick</span></label><label><input type="radio" name="sg-take-${density}"><span>Balanced</span></label></div><label class="chk"><input type="checkbox" checked>Sound</label><label class="chk"><input type="checkbox">Render when done</label></div><h3>Render dialog</h3><div class="rd-row"><label class="chk"><input type="checkbox" checked>keep aspect</label><label class="chk"><input type="checkbox">Transparent background (alpha)</label><label class="chk"><input type="checkbox" checked>Audio</label></div>`));

section('segmented-tabs', 'Segmented & tabs', 'Real playback, sidebar, render, Library, terminal and Code tab classes. Outer segmented borders are included in the control height.',
  compare((density) => `<div class="sg-stack">${sizes.map(([size, cls]) => `<div class="sg-flow">${specimen(button(`tbtn ${cls}`, size))}${specimen(`<input type="text" class="${cls}" aria-label="${size} height comparison" value="Agpy">`)}${specimen(`<select class="${cls}" aria-label="${size} select height comparison"><option>Agpy</option></select>`)}${specimen(`<div class="seg ${cls}"><button type="button" class="on">Original</button><button type="button" class="is-hover">Draft</button></div>`)}</div>`).join('')}${specimen(`<div class="seg ns-seg" role="radiogroup" aria-label="Take specimen ${density}"><label><input type="radio" name="take-${density}" checked><span>Quick</span></label><label><input type="radio" name="take-${density}" class="is-focus"><span>Balanced</span></label><label><input type="radio" name="take-${density}" disabled><span>Custom</span></label></div>`)}${['tabs', 'lb-ftabs', 'rd-tabs', 'rd-seg'].map((cls) => specimen(`<div class="${cls}"><button type="button" class="on">${cls} <b>3</b></button><button type="button" class="is-hover">Hover</button><button type="button" class="is-focus">Focus</button><button type="button" disabled>Disabled</button></div>`)).join('')}<div class="sg-flow">${specimen('<button type="button" class="dk-term on">Terminal</button>')}${specimen('<button type="button" class="dk-term is-hover">Hover</button>')}${specimen('<div class="ct-tab on"><span>scene.js</span><b class="ct-dirty"></b><button type="button" class="ct-x" aria-label="Close code tab specimen">×</button></div>')}${specimen('<div class="ct-tab is-hover"><span>scene.json</span><button type="button" class="ct-x" aria-label="Close code tab specimen">×</button></div>')}</div></div>`));

section('chips', 'Chips / badges / kbd', 'Rendering and Claude status, disk-change action, flags, counts, path chip and keyboard hints.',
  compare(() => `<div class="sg-flow">${specimen('<span class="chip"><i class="spin"></i><span>rendering…</span></span>')}${specimen('<span class="chip claude-chip"><i></i><span>changed by Claude</span></span>')}${['', 'is-hover', 'is-focus', 'disabled'].map((state) => specimen(button('badge warn', state || 'changed on disk', state))).join('')}${specimen('<span class="pill">read-only</span>')}${specimen('<span class="pill flag">tweaked</span>')}${specimen('<span class="lb-badge">in this project</span>')}${specimen('<span class="pb-chip" style="--c:var(--path-1)"><i></i><b>headline Agpy</b><button type="button" aria-label="Unpin path specimen">×</button></span>')}${specimen('<kbd>Ctrl</kbd>')}${specimen('<kbd>Shift S</kbd>')}${specimen('<b class="t3-badge">12</b>')}</div>`));

section('menus', 'Menus & popovers', 'menu.js item/check/hint structure, scale chips, note tools and tooltip. Floating surfaces are placed in the page for inspection.',
  compare(() => `<div class="gfx-menu" aria-label="Menu specimen">${[['Layers', 'on', '✓'], ['Hover item', 'is-hover', ''], ['Focused item', 'is-focus', ''], ['Unavailable', 'disabled', '']].map(([label, state, check]) => button('gfx-menu-item', `<i class="gfx-check">${check}</i><span>${label}</span><kbd>Ctrl L</kbd>`, state)).join('')}<div class="gfx-menu-sep"></div><div class="gfx-menu-chips"><span>Panel scale</span><button type="button">90%</button><button type="button" class="on">100%</button><button type="button" class="is-focus">110%</button></div></div>`) +
  `<h3>Comment popover · notes.js / index.html</h3><div id="note-pop"><div class="np-head"><span>00:07.61 · headline</span><span class="spacer"></span><button type="button" class="icon" aria-label="Close note specimen">×</button></div><textarea rows="3" aria-label="Comment specimen">Agpy: hold this title a little longer.</textarea><div class="np-tools">${button('tbtn primary', 'Save')}${button('tbtn', 'Attach')}<span class="spacer"></span>${button('tbtn', 'Ask Claude')}</div><div class="np-foot">Enter to save · Esc to close · paste / drop images</div></div><h3>Tooltip</h3><span class="tooltip" role="tooltip">Fit timeline <kbd>F</kbd></span>`);

section('dialogs', 'Dialogs', 'The app’s draft-conflict modal and its header/body/footer structure, on a local blurred scrim. No app action is connected.',
  `<div class="modal-back"><div class="modal" data-density="comfortable" role="group" aria-label="Draft conflict dialog specimen"><div class="modal-head"><b>Claude updated this scene’s draft</b><span class="spacer"></span><button type="button" class="link" aria-label="Close dialog specimen">×</button></div><p class="dim">There are unsaved edits. Choose which draft to review.</p><label class="sg-stack" data-sg-multiline>Version name<input type="text" placeholder="Agpy title revision"></label><div class="modal-foot"><span class="spacer"></span>${button('tbtn', 'Keep mine')}${button('primary', 'Load Claude’s version', 'is-focus')}</div></div></div>`);

section('toasts', 'Toasts', 'The real #toast surface, with a long message to check wrapping. Status and errors elsewhere use their existing feature classes.',
  '<div id="toast" role="status">Draft saved → out/_reel-test/review/draft.json · Agpy descenders stay visible.</div>');

section('cards', 'Cards & settings rows', 'Library card, welcome action card and Settings row structure, including inheritance, reset, field pairs, checkbox and inline error.',
  `<div class="sg-compare"><article class="lb-card"><div class="lb-thumbs"><div class="lb-thumb-none"><i style="background:var(--primary)"></i><i style="background:var(--stem-ui)"></i><i style="background:var(--stem-hits)"></i></div></div><div class="lb-card-body"><h3>Nightfall <span class="lb-badge">in this project</span></h3><p class="lb-desc">A clean title treatment with soft motion and precise sound.</p><div class="lb-tags"><span>type</span><span>product</span></div><div class="lb-meta"><span class="lb-sw"><i style="background:var(--primary)"></i><i style="background:var(--stem-ui)"></i></span><span class="dim">8 sounds · 3 refs</span></div></div><div class="lb-card-foot">${button('tbtn', 'Edit')}${button('tbtn primary', 'Use again')}<span class="spacer"></span>${button('tbtn', 'Duplicate')}${button('tbtn lb-del', 'Delete')}</div></article><div class="sg-stack"><button type="button" class="wl-act primary" data-sg-multiline><b>New project</b><small>Pick a template, name it</small></button><div class="card sg-shadow">Shared .card surface</div><div class="panel sg-shadow">Shared .panel surface</div></div></div>` +
  compare(() => `<div class="sp-card">${[
    ['First take', 'Choose the detail Claude starts with.', '<select aria-label="First take specimen"><option>Balanced</option><option>Quick</option></select>'],
    ['Engine folder', 'Used for scene rendering and preview.', '<span class="sp-pair"><input type="text" class="mono" aria-label="Engine folder specimen" value="~/agent-gfx">'+button('tbtn', 'Browse…')+'</span>'],
    ['Auto-checkpoints', 'Save a version before Ask Claude sends.', '<label class="chk sp-chk"><input type="checkbox" checked aria-label="Auto-checkpoints specimen"></label>'],
  ].map(([title, desc, control], i) => `<div class="sp-row ${i === 0 ? 'is-focus' : ''}" tabindex="-1"><div class="sp-main-row"><div class="sp-text"><div class="sp-title"><h3>${title}</h3><button type="button" class="sp-inh project" aria-label="Inheritance specimen"></button><button type="button" class="sp-reset" aria-label="Reset specimen">↺</button></div><p class="sp-desc">${desc}</p>${i === 1 ? '<p class="sp-err">Example error: engine folder unavailable</p>' : ''}</div><div class="sp-ctl">${control}</div></div></div>`).join('')}</div>`));

section('field-labels', 'Field label alignment', 'Real Library rows, inspector modified fields and New scene labels alongside their actions.',
  compare(() => `<div class="sg-stack"><div class="sp-card lb-rows"><div class="lb-row"><b>Nightfall</b><span class="lb-sw"><i style="background:var(--primary)"></i></span><span class="spacer"></span>${button('tbtn', 'Edit')}${button('tbtn', 'Duplicate')}</div></div><div class="ei"><div class="field edited"><label>Scale</label><input type="number" value="1.2" aria-label="Scale specimen">${button('ef-rs', '↺', '', 'aria-label="Reset scale specimen"')}</div></div><label class="ns-f"><span class="ns-l">Name</span><input type="text" placeholder="Agpy scene name"></label></div>`));

section('timeline', 'Timeline-ish dense controls', 'Actual lane, inspector, layer and queue classes. Mute/solo, selected layer and disabled actions stay visible alongside normal controls.',
  compare(() => `<div class="sg-stack"><div class="tc"><b>00:07.61</b><span>/ 00:15.00</span></div><div class="sg-dense-row"><span class="swatch" style="--c:var(--stem-hits)"></span><span class="lh-name">Hits</span><span class="spacer"></span>${specimen(button('mini mute', 'M'))}${specimen(button('mini solo on', 'S'))}<span class="lh-db">−3.0</span></div><div class="sg-dense-row"><span class="lh-name">Accents</span><span class="spacer"></span>${specimen(button('mini mute on', 'M'))}${specimen(button('mini solo', 'S', 'disabled'))}<span class="lh-db">−35.0</span></div><div class="lrow sel"><button type="button" class="tw" aria-label="Expand layer specimen">▾</button><i class="ico gp"></i><span class="nm">headline <small>group</small></span><button type="button" class="ib" aria-label="Layer visibility specimen">${icon}</button><button type="button" class="ib lock on" aria-label="Layer lock specimen">${icon}</button></div><div class="field"><label>Gain</label><input type="range" aria-label="Gain slider specimen"><input type="number" aria-label="Gain value specimen" value="-3" step="0.5"></div><div class="sg-flow">${specimen(button('rec', '<i class="rd"></i>Record'))}${specimen(button('tbtn', 'Import WAV'))}${specimen(button('tbtn sm', 'Open code'))}${specimen(button('mini', '↺', '', 'aria-label="Reset value specimen"'))}</div><div class="rq-job running"><div class="rq-head"><i class="rq-dot"></i><b>_reel-test</b><span class="rq-label">MP4 · 1080 × 1920</span><span class="rq-stat">RENDERING</span></div><div class="rq-bar"><i></i></div><div class="rq-sub">Frame 225 / 450 · 50%</div><div class="rq-btns">${button('tbtn sm', 'Cancel')}${button('tbtn sm', 'Reveal', 'disabled')}</div></div></div>`));

document.querySelector('#sg-nav').innerHTML = sections.map(({ id, title }) => `<a href="#${id}">${esc(title)}</a>`).join('');
for (const el of document.querySelectorAll('[data-colour-value]')) el.textContent = getComputedStyle(el.closest('figure').querySelector('i')).backgroundColor;
document.querySelector('#sg-theme').addEventListener('click', (e) => {
  const choice = e.target.closest('[data-theme-choice]')?.dataset.themeChoice;
  if (!choice) return;
  setTheme(choice);
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.classList.toggle('on', b.dataset.themeChoice === choice);
    b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice));
  }
});
document.querySelector('#sg-density').addEventListener('change', (e) => { document.body.dataset.compare = e.target.value; });
initMeasurements();

function updateDensityLabels() {
  for (const el of document.querySelectorAll('[data-density-heights]')) {
    el.textContent = ['--control-h', '--control-h-sm', '--control-h-xs'].map((name) => {
      const probe = document.createElement('i'); probe.style.height = `var(${name})`; probe.style.display = 'block';
      el.append(probe); const height = getComputedStyle(probe).height; probe.remove(); return parseFloat(height);
    }).join(' / ');
  }
}
updateDensityLabels();
window.addEventListener('theme', updateDensityLabels);
