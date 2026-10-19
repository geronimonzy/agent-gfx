import { roundSurfaceOrigin } from './surface-origin.js';
// Settings → About (docs/HOME-SETTINGS.md): the licence of gfx itself, the third-party parts grouped by how they reach
// the user, and a viewer for the licence texts shipped in /licenses/ (public/licenses + the repo's LICENSE and
// THIRD_PARTY_NOTICES.md, added by vite.config.js). THIRD_PARTY_NOTICES.md stays the full, authoritative list.
import { esc, emit } from './store.js';
import * as api from './api.js';

/** file = a text under /licenses/ (opens in the viewer); url = the project's home page (opens in the browser). */
export const GFX_LICENCE = { name: 'gfx', licence: 'MIT', file: 'LICENSE-gfx.txt' };
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.md';
export const CREDITS = [
  { group: 'Part of the app', items: [
    { name: 'Tauri', use: 'Window and system access', licence: 'MIT / Apache-2.0', url: 'https://tauri.app' },
    { name: 'dockview', use: 'Dockable panels', licence: 'MIT', url: 'https://dockview.dev' },
    { name: 'CodeMirror', use: 'Code editor', licence: 'MIT', url: 'https://codemirror.net' },
    { name: 'xterm.js', use: 'Terminal', licence: 'MIT', url: 'https://xtermjs.org' },
    { name: 'anime.js', use: 'Scene animation', licence: 'MIT', url: 'https://animejs.com' },
    { name: 'three.js', use: '3D scenes', licence: 'MIT', url: 'https://threejs.org' },
    { name: 'Vite', use: 'Live preview server', licence: 'MIT', url: 'https://vite.dev' },
    { name: 'Puppeteer', use: 'Drives the render browser', licence: 'Apache-2.0', url: 'https://pptr.dev' },
    { name: 'transformers.js, ONNX Runtime', use: 'Sound search (CLAP)', licence: 'Apache-2.0 / MIT', url: 'https://github.com/huggingface/transformers.js' },
  ] },
  { group: 'Fonts', items: [
    { name: 'Inter', use: 'Interface text', licence: 'SIL OFL 1.1', url: 'https://rsms.me/inter', file: 'LICENSE-Inter.txt' },
    { name: 'IBM Plex Mono', use: 'Numbers and code', licence: 'SIL OFL 1.1', url: 'https://github.com/IBM/plex', file: 'LICENSE-IBM-Plex-Mono.txt' },
  ] },
  // the engine's style/fonts (scene presets and looks; Inter + IBM Plex Mono are bundled there too). Licence files are
  // served from style/fonts by vite.config.js (REPO_LICENCES).
  { group: 'Scene fonts', items: [
    { name: 'Fraunces', use: 'Serif headlines (editorial look)', licence: 'SIL OFL 1.1', url: 'https://github.com/undercasetype/Fraunces', file: 'LICENSE-Fraunces.txt' },
    { name: 'Nunito', use: 'Rounded text (soft looks)', licence: 'SIL OFL 1.1', url: 'https://github.com/googlefonts/nunito', file: 'LICENSE-Nunito.txt' },
    { name: 'Fredoka', use: 'Playful display', licence: 'SIL OFL 1.1', url: 'https://github.com/hafontia/Fredoka-One', file: 'LICENSE-Fredoka.txt' },
    { name: 'Space Grotesk', use: 'Display grotesk (fast-paced look)', licence: 'SIL OFL 1.1', url: 'https://github.com/floriankarsten/space-grotesk', file: 'LICENSE-Space-Grotesk.txt' },
    { name: 'Ubuntu', use: 'Scene text', licence: 'Ubuntu Font Licence 1.0', url: 'https://ubuntu.com/legal/font-licence', file: 'LICENSE-Ubuntu.txt' },
  ] },
  { group: 'Sounds', items: [
    { name: 'Kenney sound packs', use: 'Sound library', licence: 'CC0', url: 'https://kenney.nl' },
    { name: 'Freesound', use: 'CC0 sounds you fetch with your key', licence: 'CC0', url: 'https://freesound.org' },
  ] },
  { group: 'Downloaded when you ask', items: [
    { name: 'FFmpeg (BtbN build)', use: 'Video and audio encoding', licence: 'GPL', url: 'https://ffmpeg.org' },
    { name: 'chrome-headless-shell', use: 'Pinned render browser', licence: 'BSD-3-Clause + Chromium', url: 'https://developer.chrome.com/blog/chrome-headless-shell' },
    { name: 'LAION CLAP model', use: 'Sound search by description', licence: 'Apache-2.0', url: 'https://huggingface.co/laion/clap-htsat-unfused' },
  ] },
];

const linkBtn = (url, label) => `<button type="button" class="link" data-a="credit-link" data-url="${esc(url)}" title="${esc(url)}">${esc(label)}</button>`;
const viewBtn = (file, label = 'Licence') => `<button type="button" class="tbtn xs" data-a="licence" data-file="${esc(file)}">${esc(label)}</button>`;

/** The credits table (Settings → About → Licenses and credits). Buttons carry data-a="licence" for settings.js. */
export function creditsHtml() {
  return `<div class="ab-credits">${CREDITS.map((g) => `<section class="ab-group"><h4>${esc(g.group)}</h4>
    <table class="sp-table"><tbody>${g.items.map((c) => `<tr>
      <th scope="row">${linkBtn(c.url, c.name)}</th><td class="ab-use">${esc(c.use)}</td>
      <td class="ab-lic">${esc(c.licence)}</td><td class="ab-act">${c.file ? viewBtn(c.file) : ''}</td></tr>`).join('')}</tbody></table></section>`).join('')}
    <p class="ab-more">Versions, copyright lines and the remaining libraries: ${viewBtn(NOTICES_FILE, 'All notices')}</p></div>`;
}
export const gfxLicenceHtml = () => viewBtn(GFX_LICENCE.file, `${GFX_LICENCE.licence} licence`);

/** A credit's home page: the system browser in the app (only listed URLs), a new tab in the dev shim. */
export function openCreditLink(url) {
  if (!CREDITS.some((g) => g.items.some((c) => c.url === url))) return;
  if (api.isTauri) api.openLink(url).catch((e) => emit('toast', { m: String(e.message || e), ms: 4000 }));
  else window.open(url, '_blank', 'noopener');
}

// ---------- licence text viewer ----------
let dlg = null, back = null;
export const licenceOpen = () => !!dlg && !dlg.hidden;
export function closeLicence() {
  if (!licenceOpen()) return;
  dlg.hidden = true;
  back?.focus?.({ preventScroll: true }); back = null;
}
function build() {
  dlg = document.createElement('div');
  dlg.id = 'licence-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal lic" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="lic-title">
    <div class="modal-head"><b id="lic-title"></b><span class="spacer"></span><button type="button" class="link lic-x" title="Close (Esc)" aria-label="Close">&times;</button></div>
    <div class="lic-text" tabindex="0"></div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('.lic-x').onclick = closeLicence;
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeLicence(); });
}
/** Show /licenses/<file> (only names listed above: no path from elsewhere reaches fetch). */
export async function showLicence(file) {
  const known = [GFX_LICENCE.file, NOTICES_FILE, ...CREDITS.flatMap((g) => g.items.map((c) => c.file))].filter(Boolean);
  if (!known.includes(file)) return;
  if (!dlg) build();
  back = document.activeElement;
  const box = dlg.querySelector('.lic-text');
  dlg.querySelector('#lic-title').textContent = file;
  const md = file.endsWith('.md');
  box.classList.toggle('md', md);
  box.textContent = 'Loading…';
  dlg.hidden = false;
  roundSurfaceOrigin(dlg);
  box.focus({ preventScroll: true });
  try {
    const r = await fetch(`./licenses/${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    if (md) box.innerHTML = markdownLite(text); else box.textContent = text;
  } catch (e) { box.textContent = `Could not load ${file}: ${e.message || e}`; }
  box.scrollTop = 0;
  roundSurfaceOrigin(dlg);
}

/** Just enough markdown for THIRD_PARTY_NOTICES.md: headings, paragraphs (hard wraps joined), lists, tables,
 *  `code`, **bold**. Everything is escaped first; no links or raw HTML. */
export function markdownLite(src) {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const out = [], lines = src.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length;) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); i++; continue; }
    if (l.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const body = rows.filter((r, k) => !(k === 1 && /^[\s|:-]+$/.test(r)));
      out.push(`<table><thead><tr>${cells(body[0]).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.slice(1).map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*[-*]\s/.test(l)) {
      const items = [];
      while (i < lines.length && lines[i].trim()) {
        if (/^\s*[-*]\s/.test(lines[i])) items.push(lines[i].replace(/^\s*[-*]\s/, '')); else items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*[-*]\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('');
}
