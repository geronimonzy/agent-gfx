import * as api from './api.js';
import { esc } from './store.js';
import { roundSurfaceOrigin } from './surface-origin.js';
import './wslsetup.css';

let dlg, back, current = null;
export const wslSetupOpen = () => !!dlg && !dlg.hidden;
export function closeWslSetup() {
  if (!wslSetupOpen() || current?.busy) return;
  dlg.hidden = true;
  current?.onClose?.();
  back?.focus?.({ preventScroll: true });
  current = null;
}
const command = (text) => `<span class="ws-command"><code tabindex="0">${esc(text)}</code><button type="button" class="tbtn sm" data-copy="${esc(text)}">Copy</button></span>`;
const links = [
  ['Claude Code', 'https://code.claude.com/docs/en/setup'],
  ['Codex', 'https://developers.openai.com/codex/cli/'],
  ['pi', 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent'],
];
export function checksHtml(c, { pathWanted = false } = {}) {
  if (!c) return '';
  const rows = [
    ['chrome', 'Chrome in WSL', c.chrome, command('wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && sudo apt install -y ./google-chrome-stable_current_amd64.deb')],
    ['dxg', 'GPU access (/dev/dxg)', c.dxg, command('wsl.exe --update') + '<p>Run in Windows, then restart WSL. GPU rendering needs WSL 2 and a current Windows GPU driver.</p>'],
    ['git', 'git', c.git, command('sudo apt install -y git')],
    ['agent', 'Agent CLI (any one)', c.agent, links.map(([label, url]) => `<button type="button" class="link" data-url="${url}">${label} install guide</button>`).join(' · ')],
    ['ffmpeg', 'ffmpeg', c.ffmpeg, '<button type="button" class="tbtn" data-ws="ffmpeg">Download ffmpeg</button>'],
    ...(pathWanted ? [['path', '~/.local/bin on login PATH', c.path, command('export PATH="$HOME/.local/bin:$PATH"') + '<p>Add this line to ~/.profile so the gfx command is found in new shells.</p>']] : []),
  ];
  const distroFix = rows.some(([id, , ok]) => !ok && !['dxg', 'agent', 'ffmpeg'].includes(id));
  return `<ul class="ws-checks">${rows.map(([id, label, ok, fix]) => `<li data-check="${id}"><div><b>${label}</b><span class="${ok ? 'ok' : 'bad'}">${ok ? 'Found' : 'Missing'}</span></div>${ok ? '' : `<div class="ws-fix">${fix}</div>`}</li>`).join('')}</ul>${distroFix ? '<p>Run the commands in a terminal of this distro.</p>' : ''}<button type="button" class="tbtn" data-ws="recheck">Check again</button>`;
}
function build() {
  dlg = document.createElement('div'); dlg.id = 'wslsetup-dlg'; dlg.className = 'modal-back'; dlg.hidden = true;
  dlg.innerHTML = `<div class="modal ws-modal" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="ws-title">
    <div class="modal-head"><b id="ws-title">Set up the WSL engine</b><span class="spacer"></span><button type="button" class="link" data-ws="close" aria-label="Close">&times;</button></div>
    <div class="ws-body">
      <label class="ws-field">Distro <select id="ws-distro" aria-describedby="ws-note"></select></label>
      <p id="ws-note"></p>
      <label class="ws-path"><input id="ws-path" type="checkbox"> Add gfx to PATH in WSL (recommended)</label>
      <div class="ws-progress" hidden><progress max="100" value="0" aria-label="Engine setup progress"></progress><ol class="ws-steps" aria-live="polite"></ol></div>
      <pre class="ws-error" role="alert" hidden></pre><pre class="ws-output" tabindex="0" aria-label="Last setup output" hidden></pre>
      <div class="ws-results" aria-live="polite"></div>
    </div>
    <div class="ws-footer"><span class="ws-status" role="status"></span><span class="spacer"></span><button type="button" class="tbtn" data-ws="cancel" hidden>Cancel</button><button type="button" class="tbtn primary" data-ws="install">Install</button><button type="button" class="tbtn" data-ws="close">Close</button></div>
  </div>`;
  document.body.append(dlg);
  dlg.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled || !current) return;
    try {
      if (b.dataset.copy) { await navigator.clipboard.writeText(b.dataset.copy); status('Copied'); }
      else if (b.dataset.url && links.some(([, url]) => url === b.dataset.url)) await api.openLink(b.dataset.url);
      else if (b.dataset.ws === 'close') closeWslSetup();
      else if (b.dataset.ws === 'install') await install();
      else if (b.dataset.ws === 'cancel') { b.disabled = true; current.cancelRequested = true; status('Canceling…'); await api.engineCancel(current.job.jobId); }
      else if (b.dataset.ws === 'recheck') { b.disabled = true; try { await loadChecks(); } finally { b.disabled = false; } }
      else if (b.dataset.ws === 'ffmpeg') await downloadFfmpeg();
    } catch (err) { showError(err); }
  });
  dlg.querySelector('#ws-distro').onchange = () => {
    current.distro = dlg.querySelector('#ws-distro').value;
    dlg.querySelector('.ws-results').innerHTML = '';
    note();
    if (current.installed.has(current.distro)) loadChecks().catch(showError);
  };
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg) closeWslSetup(); });
  // Tab stays in the modal; Esc is owned by the shared dlg.wslsetup keymap entry (also installed by welcome).
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...dlg.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter((n) => n.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  });
}
function status(text) { dlg.querySelector('.ws-status').textContent = text; }
function showError(err) {
  const box = dlg.querySelector('.ws-error'); box.hidden = false; box.textContent = String(err?.message || err);
  roundSurfaceOrigin(dlg);
}
function note() {
  const d = current.distros.find((d) => d.name === current.distro);
  dlg.querySelector('#ws-note').textContent = d?.version === 1 ? 'WSL 1 is allowed, but GPU rendering needs WSL 2. Choose a WSL 2 distro when possible.' : 'The bundled engine will be installed in your home folder in this distro.';
  const installed = current.installed.has(current.distro);
  dlg.querySelector('[data-ws=install]').textContent = installed ? current.action || 'Repair' : 'Install';
  // once the engine is there, Repair is a side action: Close is the main button
  dlg.querySelector('[data-ws=install]').classList.toggle('primary', !installed || !!current.action);
  dlg.querySelector('.ws-footer [data-ws=close]').classList.toggle('primary', installed && !current.action);
}
function busy(value) {
  current.busy = value;
  for (const el of dlg.querySelectorAll('#ws-distro, #ws-path, [data-ws=install], [data-ws=close], .ws-results button')) el.disabled = value;
  dlg.querySelector('[data-ws=cancel]').hidden = !value;
  dlg.querySelector('[data-ws=cancel]').disabled = false;
  dlg.querySelector('[data-ws=install]').disabled = value || !current.distro || !current.bundle?.exists;
}
async function loadChecks() {
  const state = current, distro = state.distro;
  const c = await api.wslEngineChecks(distro);
  if (current !== state || current.distro !== distro) return;
  dlg.querySelector('.ws-results').innerHTML = checksHtml(c, { pathWanted: !!state.linkPath });
  roundSurfaceOrigin(dlg);
}
function event(ev) {
  if (ev.type === 'progress' && ev.pct == null && ev.total) ev = { ...ev, pct: Math.min(100, Math.round((100 * ev.done) / ev.total)), label: ev.phase || ev.label };
  if (!current.cancelRequested) dlg.querySelector('[data-ws=cancel]').disabled = false;
  if (ev.type === 'progress') {
    dlg.querySelector('progress').value = Number(ev.pct) || 0;
    const lines = dlg.querySelector('.ws-steps');
    if (ev.label && lines.lastElementChild?.textContent !== ev.label) {
      lines.lastElementChild?.classList.add('done');
      const li = document.createElement('li'); li.textContent = ev.label; lines.append(li);
    }
    status(ev.label || 'Working…');
  } else if (ev.type === 'log') {
    current.lines.push(ev.msg); current.lines = current.lines.slice(-12); // shown only when the setup fails
  }
  roundSurfaceOrigin(dlg);
}
async function install() {
  const state = current;
  if (!state.distro) return;
  dlg.dataset.state = 'running'; state.lines = []; state.cancelRequested = false; state.linkPath = dlg.querySelector('#ws-path').checked;
  dlg.querySelector('.ws-output').hidden = true;
  dlg.querySelector('.ws-error').hidden = true;
  dlg.querySelector('.ws-results').innerHTML = '';
  dlg.querySelector('.ws-progress').hidden = false;
  dlg.querySelector('.ws-steps').innerHTML = '';
  busy(true); dlg.querySelector('[data-ws=cancel]').disabled = true; status('Starting…');
  try {
    state.job = api.wslEngineSetup(state.distro, dlg.querySelector('#ws-path').checked, { onEvent: event });
    const result = await state.job.done;
    if (result.canceled) { status('Canceled'); dlg.dataset.state = 'canceled'; return; }
    if (result.code) throw new Error(result.error || 'Setup failed');
    // done: the status line says so and the checks follow; the progress block only stays for a failure
    dlg.querySelector('.ws-progress').hidden = true;
    state.installed.add(state.distro); state.action = null; note();
    await loadChecks();
    status('Engine installed'); dlg.dataset.state = 'done';
  } catch (e) {
    dlg.querySelector('.ws-steps').lastElementChild?.classList.add('failed');
    if (state.lines.length) { const box = dlg.querySelector('.ws-output'); box.hidden = false; box.textContent = state.lines.join('\n'); }
    showError(e); status('Setup failed'); dlg.dataset.state = 'error';
  }
  finally { busy(false); state.job = null; state.onChange?.(); roundSurfaceOrigin(dlg); }
}
async function downloadFfmpeg() {
  current.cancelRequested = false; current.lines = [];
  dlg.querySelector('.ws-output').hidden = true;
  dlg.querySelector('.ws-progress').hidden = false;
  busy(true); dlg.querySelector('[data-ws=cancel]').disabled = true; status('Downloading ffmpeg…');
  try {
    current.job = api.engineRun(['setup', 'ffmpeg'], { noProject: true, distro: current.distro, onEvent: event });
    const result = await current.job.done;
    if (result.canceled) status('Canceled');
    else if (result.code) throw new Error(result.error || 'ffmpeg download failed; see output');
    else { dlg.querySelector('.ws-progress').hidden = true; await loadChecks(); status('ffmpeg installed'); }
  } finally { busy(false); current.job = null; }
}
export async function showWslSetup({ distro, action, onChange, onClose } = {}) {
  if (wslSetupOpen()) return;
  if (!dlg) build();
  back = document.activeElement;
  current = { busy: true, distro: '', distros: [], installed: new Set(), lines: [], onChange, onClose, action };
  const state = current;
  dlg.dataset.state = 'loading'; dlg.hidden = false;
  dlg.querySelector('#ws-distro').innerHTML = '';
  dlg.querySelector('#ws-path').checked = false;
  dlg.querySelector('#ws-note').textContent = '';
  dlg.querySelector('.ws-results').innerHTML = '';
  dlg.querySelector('.ws-error').hidden = true;
  dlg.querySelector('.ws-output').hidden = true;
  dlg.querySelector('.ws-progress').hidden = true;
  busy(true); dlg.querySelector('[data-ws=cancel]').hidden = true;
  status('Loading distros…'); roundSurfaceOrigin(dlg);
  try {
    const [distros, engines, bundle] = await Promise.all([api.wslDistros(), api.enginesInfo(), api.wslBundleInfo()]);
    state.bundle = bundle;
    state.distros = distros.filter((d) => d.version === 2 || d.version === 1);
    state.installed = new Set(engines.filter((e) => e.kind === 'wsl').map((e) => e.distro));
    state.distro = state.distros.find((d) => d.name === distro)?.name || state.distros.find((d) => d.default)?.name || state.distros[0]?.name || '';
    dlg.querySelector('#ws-distro').innerHTML = state.distros.map((d) => `<option value="${esc(d.name)}"${d.name === state.distro ? ' selected' : ''}>${esc(d.name)}${d.default ? ' (default)' : ''} · WSL ${d.version}</option>`).join('');
    note(); status(state.distro ? '' : 'No distros found. Install a WSL distro, then reopen this dialog.');
    if (state.installed.has(state.distro)) await loadChecks();
    dlg.dataset.state = 'ready';
  } catch (e) { showError(e); status('Could not load distros'); dlg.dataset.state = 'error'; }
  finally {
    busy(false); dlg.querySelector('[data-ws=install]').disabled = !state.distro || !state.bundle?.exists;
    roundSurfaceOrigin(dlg); dlg.querySelector(state.distro ? '#ws-distro' : '[data-ws=close]').focus();
  }
}
