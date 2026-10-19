// Save as template (docs/TEMPLATES.md §4): scene menu → "Save as template…". This scene or the whole project goes into
// the user template library with `gfx template save` (thumbnail + preview clip made by the engine); New project in the
// welcome window lists it under "Your templates".
import * as api from './api.js';
import { S, emit, esc } from './store.js';
import { register } from './keys.js';
import { roundSurfaceOrigin } from './surface-origin.js';
import { nameError, saveArgs, existsError, PHASES, templateId, libraryArgs } from './savetemplate-core.js';
import { pref } from './prefs.js';
import './savetemplate.css';

let dlg = null, busy = false, job = null, prevFocus = null, registered = false;
const toast = (m, ms = 3000) => emit('toast', { m, ms });
const q = (s) => dlg?.querySelector(s);
export const saveTemplateOpen = () => !!dlg && !dlg.hidden;
const projectScenes = () => (S.scenes || []).map((s) => s.name).filter((n) => n && !n.startsWith('_'));

export async function openSaveTemplate() {
  if (!S.root) { toast('Open a project first', 2500); return; }
  if (!projectScenes().length) { toast('This project has no scenes to save yet', 3000); return; }
  if (!registered) {
    registered = true;
    register([{ id: 'dlg.savetemplate', keys: ['Esc'], context: 'dialog', group: 'Edit / File', label: 'Close Save as template', scene: false, typing: true, when: saveTemplateOpen, run: close }]);
  }
  const scene = S.name && projectScenes().includes(S.name) ? S.name : null;
  let title = '';
  if (scene) { try { title = JSON.parse((await api.readText(`scenes/${scene}/scene.json`)) || '{}').title || ''; } catch { /* no title */ } }
  build({ scene, sceneTitle: title || scene || '', projectName: S.projectName || '' });
}

function build({ scene, sceneTitle, projectName }) {
  if (dlg) close();
  prevFocus = document.activeElement;
  dlg = document.createElement('div');
  dlg.className = 'modal-back'; dlg.id = 'st-dlg';
  const n = projectScenes().length, scope = scene ? 'scene' : 'project';
  dlg.innerHTML = `<div class="modal savetpl" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="st-title">
    <div class="modal-head"><b id="st-title">Save as template</b><span class="st-sub dim">New project lists it under Your templates</span><span class="spacer"></span><button type="button" class="link st-x" data-a="cancel" aria-label="Close" title="Close (Esc)">&times;</button></div>
    <form class="st-form" autocomplete="off">
      <fieldset class="st-scope"><legend>What</legend>
        <label class="chk"><input type="radio" name="st-scope" value="scene"${scope === 'scene' ? ' checked' : ''}${scene ? '' : ' disabled'}> This scene${scene ? ` <code>${esc(scene)}</code>` : ''}</label>
        <label class="chk"><input type="radio" name="st-scope" value="project"${scope === 'project' ? ' checked' : ''}> Whole project (${n} scene${n === 1 ? '' : 's'})</label>
      </fieldset>
      <label class="st-field">Name<input id="st-name" type="text" spellcheck="false" value="${esc(scope === 'scene' ? sceneTitle : projectName)}" data-scene-title="${esc(sceneTitle)}" data-project-name="${esc(projectName)}"></label>
      <label class="st-field">Description<input id="st-desc" type="text" spellcheck="false" placeholder="One line for the template card (optional)"></label>
      <label class="chk" title="A thumbnail and a short muted clip for the template card (rendered by the engine; takes a few seconds)"><input type="checkbox" id="st-preview" checked> Thumbnail and preview clip</label>
      <p class="st-note dim">Saved: the scene folder${scope === 'scene' ? '' : 's'}, <code>style/</code> and the project's look. Not saved: renders (<code>out/</code>), versions, CLAUDE.md.</p>
      <div class="st-messages"><div class="st-status" role="status" hidden><i class="spin"></i> <span></span></div>
      <div class="st-err" role="alert" hidden><span></span><button type="button" class="tbtn" data-a="replace" hidden>Replace it</button></div></div>
      <div class="modal-foot"><span class="spacer"></span><button type="button" class="tbtn" data-a="cancel">Cancel</button><button type="submit" class="primary" id="st-save">Save template</button></div>
    </form></div>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('pointerdown', (e) => { if (e.target === dlg && !busy) close(); });
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'cancel') close();
    else if (a === 'replace') save(true);
  });
  dlg.addEventListener('change', (e) => {
    if (e.target.name !== 'st-scope') return;
    const nm = q('#st-name'), was = [nm.dataset.sceneTitle, nm.dataset.projectName];
    if (!nm.value.trim() || was.includes(nm.value)) nm.value = e.target.value === 'scene' ? nm.dataset.sceneTitle : nm.dataset.projectName;
    q('.st-note').innerHTML = `Saved: the scene folder${e.target.value === 'scene' ? '' : 's'}, <code>style/</code> and the project's look. Not saved: renders (<code>out/</code>), versions, CLAUDE.md.`;
    sync();
  });
  dlg.addEventListener('input', sync);
  dlg.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  dlg.addEventListener('keydown', trapTab);
  sync();
  roundSurfaceOrigin(dlg);
  const nm = q('#st-name'); nm.focus(); nm.select();
}

function trapTab(e) {
  if (e.key !== 'Tab') return;
  const f = [...dlg.querySelectorAll('button, input, select, textarea')].filter((x) => !x.disabled && !x.closest('[hidden]'));
  if (!f.length) return;
  const i = f.indexOf(document.activeElement);
  if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
}

function sync() {
  if (!dlg) return;
  const err = nameError(q('#st-name').value);
  q('#st-save').disabled = busy || !!err;
  q('#st-save').title = err || `Saves as ${templateId(q('#st-name').value)}`;
  for (const el of dlg.querySelectorAll('input')) el.disabled = busy || (el.name === 'st-scope' && el.value === 'scene' && !S.name);
  if (!busy) showErr('');
}
function showErr(m, replace = false) {
  const box = q('.st-err');
  box.hidden = !m; box.querySelector('span').textContent = m;
  box.querySelector('[data-a=replace]').hidden = !replace;
}
function status(m) { const s = q('.st-status'); s.hidden = !m; s.querySelector('span').textContent = m || ''; }

async function save(force) {
  if (busy || !dlg) return;
  const scope = q('input[name=st-scope]:checked')?.value || 'project';
  const name = q('#st-name').value.trim();
  if (nameError(name)) return;
  let lib = '';
  try { lib = String(pref('libraryDir') || ''); } catch { /* no setting: the engine's default */ }
  const args = saveArgs({ scope, scene: S.name, name, description: q('#st-desc').value, preview: q('#st-preview').checked, force, library: libraryArgs(lib, S.root) });
  busy = true; sync(); showErr(''); status(PHASES.copy);
  const warn = [];
  // this dialog + this job: a cancelled save that finishes after the dialog was reopened must not touch the new one
  const mine = dlg;
  const myJob = api.engineRun(args, {
    onEvent: (ev) => {
      if (dlg !== mine) return;
      if (ev.type === 'progress' && PHASES[ev.phase]) status(PHASES[ev.phase]);
      if (ev.type === 'log' && /warning:/.test(ev.msg || '')) warn.push(String(ev.msg).replace(/^gfx:\s*warning:\s*/, ''));
    },
  });
  job = myJob;
  let r;
  try { r = await myJob.done; } catch (e) { r = { code: 1, error: String(e.message || e) }; }
  if (job !== myJob || dlg !== mine) return; // stale: cancelled (close() already reset the state)
  job = null; busy = false;
  status('');
  if (r.code !== 0 || r.error) {
    const m = String(r.error || `gfx template save failed (code ${r.code})`);
    sync();
    if (existsError(m)) showErr('A template with this name exists in your template library.', true);
    else showErr(m);
    return;
  }
  close();
  toast(`Saved template "${name}": New project lists it under Your templates${warn.length ? ` (${warn.join('; ')})` : ''}`, warn.length ? 7000 : 4000);
}

function close() {
  if (busy) { if (job) api.engineCancel(job.jobId).catch(() => {}); }
  busy = false; job = null;
  dlg?.remove(); dlg = null;
  if (prevFocus?.isConnected) prevFocus.focus?.();
}
