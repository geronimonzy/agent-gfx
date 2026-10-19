import { roundSurfaceOrigin } from './surface-origin.js';
// gfx studio bootstrap: scene loading, top bar, transport UI, keyboard, dock layout (layout.js), disk polling, save.
import * as api from './api.js';
import {
  S, on, emit, fps, duration, snapT, clamp, setBase, resolveDraft, loadDraft, markSaved, isDirty, hasEdits, serializeDraft,
  undo, redo, canUndo, canRedo, removeCue, patchCue,
} from './store.js';
import { engine } from './audio.js';
import { initTransport, setVideoSource, toggle, seek, step, setRate, transport } from './transport.js';
import { generateThumbs, cancelThumbs } from './thumbs.js';
import { initTimeline, fitView, invalidate, toggleMute, toggleSolo, ensureVisible, zoomAt, viewWidth, foldMonitorGains } from './timeline.js';
import { initInspector } from './inspector.js';
import { initNotes, newNote, closePop, popOpen } from './notes.js';
import { initViewer, getTool, setTool } from './viewer.js';
import { initPins } from './pins.js';
import { initDraw, isDrawing, stopDraw, startDraw, undoStroke } from './draw.js';
import { initShots } from './shots.js';
import { loadComments, flushNow, deleteComment, liveComments } from './comments.js';
import { openCommentId } from './notes.js';
import { initSynth, schedule } from './synth.js';
import { initLive, toggleLive, L as liveState } from './live.js';
import { initLayers } from './layers.js';
import { initKeymap } from './keymap.js';
import { installKeys } from './keys.js';
import * as keysMod from './keys.js';
import { initHelp } from './keys-help.js';
import { initTracks } from './tracks.js';
import { initPaths } from './paths.js';
import * as pathsMod from './paths.js';
import * as tracksMod from './tracks.js';
import * as liveMod from './live.js';
import * as viewerMod from './viewer.js';
import * as storeMod from './store.js';
import * as codeMod from './code.js';
import { initVersions, mountVersions } from './versions.js';
import { initVisualDiff } from './vdiff.js';
import * as versionsMod from './versions.js';
import * as notesMod from './notes.js';
import * as renderMod from './render.js';
import * as termMod from './terminal.js';
import { initSettings, openSettings, closeSettings, settingsOpen } from './settings.js';
import { initPrefs, reloadProject } from './prefs.js';
import { SCHEMA } from './settings-core.js';
import { initAsk } from './ask.js';
import * as t3Mod from './t3.js';
import { initPulse } from './pulse.js';
import * as layoutMod from './layout.js';
import * as nsMod from './newscene.js';

import { $ } from './dom.js';
import { initToolbar, syncBreadcrumb } from './toolbar.js';
const ICON = {
  play: '<svg viewBox="0 0 16 16"><path d="M4.5 2.8v10.4a.6.6 0 0 0 .92.5l8.2-5.2a.6.6 0 0 0 0-1L5.42 2.3a.6.6 0 0 0-.92.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3.2" height="11" rx=".8"/><rect x="9.3" y="2.5" width="3.2" height="11" rx=".8"/></svg>',
  start: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="1.8" height="10" rx=".6"/><path d="M13 3.3v9.4a.5.5 0 0 1-.8.4L6.4 8.4a.5.5 0 0 1 0-.8l5.8-4.7a.5.5 0 0 1 .8.4z"/></svg>',
  end: '<svg viewBox="0 0 16 16"><rect x="11.2" y="3" width="1.8" height="10" rx=".6"/><path d="M3 3.3v9.4a.5.5 0 0 0 .8.4l5.8-4.7a.5.5 0 0 0 0-.8L3.8 2.9a.5.5 0 0 0-.8.4z"/></svg>',
};
const pad2 = (n) => String(n).padStart(2, '0');
const tcOf = (t) => { const f = Math.floor(t * fps() + 1e-6); return pad2(Math.floor(f / fps())) + '.' + pad2(f % fps()); };
let blobUrl = null, toastTimer = 0;

function toast(msg, ms = 2200) {
  const el = $('toast'); el.textContent = msg; el.hidden = false;
  roundSurfaceOrigin(el);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- scene loading ----------
async function refreshScenes() {
  const root = S.root, list = await api.listProjectScenes();
  if (S.root !== root) return false; // a response from the previous project must not change this one
  const changed = JSON.stringify(list) !== JSON.stringify(S.scenes);
  S.scenes = list;
  if (changed) updateRenderBtn();
  syncBreadcrumb();
  if (!S.scenes.length && !S.name) $('empty-msg').textContent = 'No scenes in this project yet.';
  else if (S.scenes.length && !S.name) $('empty-msg').textContent = '';
  updateEmptyNew();
  return true;
}
/** Empty state: "Create your first scene" (New scene window) while the open project has no scenes. */
function updateEmptyNew() {
  $('empty-new').hidden = !(S.projectName && S.projectName !== 'No project' && !S.name && !S.scenes.length);
}
/** Scene-menu brief availability follows scenes/<name>/BRIEF.md. */
let briefSeq = 0, hasBrief = false;
async function syncBriefBtn() {
  const my = ++briefSeq, name = S.name;
  hasBrief = false;
  const st = name ? await api.stat(`scenes/${name}/BRIEF.md`).catch(() => null) : null;
  if (my === briefSeq) hasBrief = !!(name && st && S.name === name);
}
/** The New scene window selects the scene it made (unsaved edits of the open scene are never dropped for it). */
async function selectCreatedScene(name) {
  if (S.name === name) { await loadScene(name, { keepDraft: true }); return; }
  if (isDirty() || codeMod.codeDirty()) { toast(`Scene "${name}" created: save or discard your edits, then pick it in the scene list`, 6000); return; }
  await loadScene(name);
}
// Library stays lazy-loaded; the app menu reflects availability.
const libraryModule = import.meta.glob('./library.js')['./library.js'];
let openLibrary = null;
async function initLibraryBtn() {
  if (!libraryModule) return;
  try { const m = await libraryModule(); if (typeof m.openLibrary === 'function') openLibrary = () => m.openLibrary().catch((e) => toast('Library: ' + e.message, 5000)); }
  catch (e) { console.warn('[library]', e); }
}
/** Re-read the scene list (scenes made outside the app, e.g. by Claude in T3). reload: also reload the open scene.
 *  The open scene gone from disk -> keep unsaved edits, otherwise the empty state; empty to one scene -> open it. */
async function syncScenes({ reload = false } = {}) {
  if (S.loading || !S.projectName) return;
  const root = S.root, had = S.scenes.length;
  if (!await refreshScenes() || S.root !== root) return;
  if (S.name && !S.scenes.some((s) => s.name === S.name)) {
    const gone = S.name;
    if (isDirty() || codeMod.codeDirty()) {
      toast(`Scene "${gone}" is gone from disk; your unsaved draft is kept`, 6000);
      return;
    }
    if (liveState.on) toggleLive(); // disable synchronously before unload emits 'scene'
    unloadScene(); syncBreadcrumb();
    $('empty-msg').textContent = `Scene "${gone}" is gone from disk` + (S.scenes.length ? ': pick another scene.' : '.');
    updateEmptyNew();
  } else if (S.name && reload) await loadScene(S.name, { keepDraft: true });
  else if (!S.name && !had && S.scenes.length === 1) { await loadScene(S.scenes[0].name); }
}
let lastFocusSync = 0;
const sceneKey = () => `gfx-studio.scene.${S.root}`;
function setProjectLabel(name) {
  S.projectName = name;
  const b = $('root-btn');
  b.querySelector('.btn-label').textContent = name; b.title = `${S.root}\n(click to switch project)`;
}

/** The draft.json content that matters (what serializeDraft writes), to tell "changed on disk" from formatting. */
const draftKey = (txt) => {
  try { const j = txt ? JSON.parse(txt) : {}; return JSON.stringify([j.stems || {}, j.cues || {}, j.add || [], j.tweaks || {}]); } catch { return 'bad:' + txt; }
};
let draftDisk = { name: null, key: '' }; // draft.json as last loaded / saved by this window

/** draft.json changed on disk while this window has unsaved draft edits (journey finding 13): two-button in-app dialog that
 *  lists the unsaved edits. Resolves true = load the disk draft (drop them), false = keep this window's draft. */
function askDiskDraft(name) {
  const items = storeMod.unsavedChanges(), E = storeMod.esc;
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back'; back.id = 'disk-draft-dlg';
    back.innerHTML = `<div class="modal" data-density="comfortable" role="dialog" aria-modal="true" aria-labelledby="dd-title" style="width:min(var(--dialog-w-sm),calc(100vw - var(--dialog-viewport-gap)))">
      <div class="modal-head"><b id="dd-title">Claude updated this scene's draft</b></div>
      <div>out/${E(name)}/review/draft.json changed on disk (Claude probably applied your changes). This window also has draft edits that were not saved:</div>
      <ul class="dd-list" style="margin:0;padding-left:var(--space-18);font:var(--text-2xs) var(--font-mono)">${items.slice(0, 8).map((x) => `<li>${E(x)}</li>`).join('')}${items.length > 8 ? `<li>+${items.length - 8} more</li>` : ''}${items.length ? '' : '<li>(none found)</li>'}</ul>
      <div class="dim">Load Claude's version: these edits are dropped. Keep mine: the window keeps them (Save draft would replace Claude's version).</div>
      <div class="modal-foot"><span class="spacer"></span><button type="button" class="tbtn" data-a="keep">Keep mine</button><button type="button" class="primary" data-a="load">Load Claude's version</button></div></div>`;
    // modal for real: everything behind is inert (no Tab, clicks or shortcuts reach Save draft) until a choice is made
    const behind = [...document.body.children].filter((el) => !el.inert);
    const done = (load) => { for (const el of behind) el.inert = false; back.remove(); resolve(load); };
    back.addEventListener('click', (e) => { const a = e.target.closest('[data-a]')?.dataset.a; if (a) done(a === 'load'); });
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); return; }
      if (e.key === 'Tab') { // keep focus on the two buttons
        const b = [...back.querySelectorAll('button')], i = b.indexOf(document.activeElement);
        e.preventDefault(); b[(i + (e.shiftKey ? b.length - 1 : 1)) % b.length].focus();
      }
      e.stopPropagation();
    });
    for (const el of behind) el.inert = true;
    document.body.appendChild(back);
    back.querySelector('[data-a=load]').focus();
  });
}

async function loadScene(name, { keepDraft = false } = {}) {
  if (S.loading) return;
  const wasDirty = isDirty(), sameScene = S.name === name;
  S.loading = true; syncBreadcrumb();
  try {
    if (transport.playing) toggle();
    await flushNow().catch(() => {});
    const rd = (p) => api.readText(`${p}`);
    const [sceneTxt, cuesTxt, soundTxt, draftTxt, tweaksTxt, cStat, vStat] = await Promise.all([
      rd(`scenes/${name}/scene.json`), rd(`out/${name}/audio/cues.json`), rd(`scenes/${name}/sound.json`), rd(`out/${name}/review/draft.json`), rd(`scenes/${name}/tweaks.json`),
      api.stat(`out/${name}/audio/cues.json`), api.stat(`out/${name}/${name}.mp4`),
    ]);
    if (!cuesTxt && !sceneTxt) throw new Error(`scenes/${name}/scene.json not found`);
    const cj = cuesTxt ? JSON.parse(cuesTxt) : { cues: [], stems: {}, duration: 0 }, sj = sceneTxt ? JSON.parse(sceneTxt) : {};
    const neverRendered = !cuesTxt && !vStat;
    const meta = { fps: sj.fps || 60, width: sj.width || 1080, height: sj.height || 1920, duration: cj.duration || sj.duration || (neverRendered ? 6 : 0) };
    cancelThumbs();
    engine.reset(meta.duration);
    engine.mode = 'original';
    const prevDraft = S.draft;
    S.fileTweaks = tweaksTxt ? JSON.parse(tweaksTxt) : {};
    S.name = name; S.meta = meta; S.soundFix = soundTxt ? JSON.parse(soundTxt) : null;
    setBase({ cues: cj.cues, stems: cj.stems || {}, master: cj.master });
    // keepDraft (↻, "changed on disk", render reload): the in-memory draft stays unless draft.json changed on disk since this
    // window loaded / saved it (Claude folded it into tweaks.json); unsaved edits are only dropped after a confirm.
    let keep = keepDraft && sameScene;
    if (keep && draftKey(draftTxt) !== draftDisk.key) {
      keep = wasDirty && !(await askDiskDraft(name));
    }
    if (keep) S.draft = prevDraft; else loadDraft(draftTxt);
    if (!(keep && keepDraft)) draftDisk = { name, key: draftKey(draftTxt) }; // a kept-but-changed disk draft keeps asking
    S.disk = { cues: cStat?.mtime || 0, mp4: vStat?.mtime || 0, changed: false };
    S.sel = { cue: null, note: null }; S.mode = 'original'; S.loop = { on: false, a: 0, b: 0 };
    resolveDraft();

    // stems -> AudioBuffers (cues.json lists every stem; missing wavs just stay silent)
    await Promise.all(S.stemOrder.map(async (s) => {
      try { engine.setStem(s, await engine.decode(await api.readBytes(`out/${name}/audio/stems/${s}.wav`))); }
      catch (e) { console.warn(`stem ${s}: ${e.message}`); engine.setStem(s, null); }
      engine.setMonitor(s, S.mon[s]);
    }));
    // video
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    if (vStat) {
      const bytes = await api.readBytes(`out/${name}/${name}.mp4`);
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    }
    setVideoSource(blobUrl);
    $('video-wrap').classList.toggle('has-video', !!blobUrl);
    $('empty-msg').textContent = blobUrl ? '' : neverRendered ? 'Not rendered yet - live preview' : 'No video rendered for this scene';
    sizeVideo();
    localStorage.setItem(sceneKey(), name);
    if (!(keep && wasDirty)) markSaved(); // kept unsaved edits stay unsaved
    emit('scene');
    await loadComments(name, draftTxt);
    emit('mode'); emit('selection'); emit('dirty');
    seek(0);
    generateThumbs(name, blobUrl, meta.duration, meta.width / meta.height);
    if (hasEdits()) schedule(0);
    toast(neverRendered ? `${name}: not rendered yet, showing the live scene` : `${name}: ${S.res.cues.length} cues, ${S.stemOrder.length} stems${liveComments().length || hasEdits() ? ' · draft loaded' : ''}`);
    if (neverRendered && !liveState.on) toggleLive(); // no video/stems: the live scene is the only picture
  } catch (e) {
    console.error(e); toast('Load failed: ' + e.message, 5000);
  } finally {
    S.loading = false; syncBreadcrumb();
  }
}

function sizeVideo() {
  const v = $('video'), m = S.meta;
  if (!m) return;
  v.style.aspectRatio = `${m.width} / ${m.height}`;
  v.style.height = 'auto';
  const wrap = $('video-wrap'), maxW = wrap.clientWidth - 28, maxH = wrap.clientHeight - 28, a = m.width / m.height;
  const h = Math.min(maxH, maxW / a);
  v.style.height = Math.max(40, h) + 'px'; v.style.width = Math.max(40, h * a) + 'px';
}

// ---------- projects ----------
/** The backend root is already set: list the scenes and open the wanted / last / only scene. */
async function enterProject(name, wantScene) {
  setProjectLabel(name);
  api.recentTouch(S.root).catch(() => {}); // the welcome window's Recent list (recent.json)
  renderMod.projectChanged();
  await refreshScenes();
  const want = wantScene || localStorage.getItem(sceneKey()) || localStorage.getItem('gfx-studio.scene');
  const pick = S.scenes.find((s) => s.name === want) || (S.scenes.length === 1 ? S.scenes[0] : null);
  if (pick) await loadScene(pick.name);
  else syncBreadcrumb();
}

function unloadScene() {
  if (transport.playing) toggle();
  cancelThumbs();
  engine.reset(0);
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = null; setVideoSource(null);
  $('video-wrap').classList.remove('has-video');
  S.name = null; S.meta = null; S.res = null; S.base = null; S.baseRes = null; S.stemOrder = [];
  S.draft = storeMod.emptyDraft(); S.sel = { cue: null, note: null }; S.disk = { cues: 0, mp4: 0, changed: false };
  storeMod.clearHistory();
  markSaved();
  emit('scene'); emit('selection'); emit('dirty');
}

/** Switch the backend to another project folder (what set_root did) and open it. false = cancelled by the user. */
export async function openProject(path) {
  if (S.loading) return false;
  if (isDirty() && !(await api.ask('Discard the unsaved draft edits of the current scene?'))) return false;
  if (codeMod.codeDirty() && !(await api.ask('Discard the unsaved code edits (Code mode)?'))) return false;
  await flushNow().catch(() => {});
  if (liveState.on) await toggleLive(); // the live server belongs to the old project
  closeSettings();
  await api.setRoot(path);
  S.root = path;
  unloadScene();
  await reloadProject(); // the project's own settings (gfx.json "settings")
  emit('root');
  const info = await api.projectInfo(path);
  await enterProject(info.name, null);
  toast(`Opened ${info.name}`);
  return true;
}
const sameRoot = (a, b) => String(a).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() === String(b).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
/** The welcome window opened a project while this window is open: switch (unsaved-edit confirms first), then close it. */
async function openFromWelcome(request) {
  const { path, requestId } = typeof request === 'string' ? { path: request } : request;
  try {
    const same = S.projectName && sameRoot(path, S.root);
    if (same) {
      await api.refreshProjectMetadata();
      await syncScenes({ reload: true }); // reopening the open project = refresh it (scenes made outside the app)
    }
    const accepted = same || await openProject(path);
    await api.welcomeOpenResult(requestId, accepted ? 'accepted' : 'cancelled');
    if (accepted) await api.closeWelcome();
  } catch (e) {
    await api.welcomeOpenResult(requestId, 'error', String(e.message || e)).catch(() => {});
    toast(String(e.message || e), 5000);
  }
}

// ---------- chrome ----------
function updateRenderBtn() {
  $('render-split').hidden = !S.name;
}
let renderBusy = false;
function updateTopbar() {
  const edits = hasEdits();
  for (const b of $('ab').querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.mode === S.mode);
    if (b.dataset.mode === 'draft') b.disabled = !edits;
  }
  const dot = $('save-btn').querySelector('.dirty'); dot.hidden = false; dot.style.visibility = isDirty() ? '' : 'hidden';
  $('save-btn').disabled = !S.name;
  $('undo-btn').disabled = !canUndo(); $('redo-btn').disabled = !canRedo();
  $('synth-chip').hidden = !(S.synth.busy || renderBusy);
  $('disk-badge').hidden = !S.disk.changed;
  updateRenderBtn();
  document.title = (S.name ? `${S.name}${isDirty() ? ' •' : ''} — ` : '') + 'gfx studio';
}
function updateTransportUI() {
  const t = transport.time();
  $('tc-time').textContent = tcOf(t);
  $('tc-dur').textContent = '/ ' + (duration() ? tcOf(duration()).replace(/\.\d+$/, '.00') : '00.00');
  $('tc-frame').textContent = `f ${Math.floor(t * fps() + 1e-6)} / ${Math.round(duration() * fps())}`;
}
function updateTransportButtons() {
  $('play').innerHTML = transport.playing ? ICON.pause : ICON.play;
  $('loop-btn').classList.toggle('on', S.loop.on);
  for (const b of $('rate').querySelectorAll('button')) b.classList.toggle('on', +b.dataset.rate === S.rate);
}

async function setMode(mode) {
  if (mode === 'draft' && !hasEdits()) return;
  S.mode = mode; engine.setMode(mode); emit('mode');
}

async function saveDraft() {
  if (!S.name || S.loading) return; // not while a scene (re)load is deciding which draft wins
  foldMonitorGains();
  try {
    await api.writeText(`out/${S.name}/review/draft.json`, JSON.stringify(serializeDraft(), null, 2) + '\n');
    draftDisk = { name: S.name, key: draftKey(JSON.stringify(serializeDraft())) };
    markSaved(); toast('Draft saved → out/' + S.name + '/review/draft.json');
  } catch (e) { toast('Save failed: ' + e.message, 5000); }
}

async function pollDisk() {
  if (!S.name || S.loading) return;
  try {
    const [c, v] = await Promise.all([api.stat(`out/${S.name}/audio/cues.json`), api.stat(`out/${S.name}/${S.name}.mp4`)]);
    const changed = (c?.mtime || 0) !== S.disk.cues || (v?.mtime || 0) !== S.disk.mp4;
    if (changed !== S.disk.changed) { S.disk.changed = changed; updateTopbar(); }
  } catch { /* transient */ }
}

// ---------- modes: Review / Code (mode-seg) ----------
async function setAppMode(m) {
  await codeMod.setCode(m === 'code');
  syncModeSeg();
  notesMod.render();
}
function syncModeSeg() {
  const m = codeMod.codeOn() ? 'code' : 'review';
  for (const b of $('mode-seg').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === m);
}
// ---------- keyboard: the shortcut table is keymap.js, the dispatcher keys.js ----------
function toggleLoop() {
  if (S.loop.b <= S.loop.a) { S.loop.a = 0; S.loop.b = duration(); }
  S.loop.on = !S.loop.on; emit('loop');
}

// ---------- boot ----------
async function boot() {
  await initPrefs().catch((e) => console.warn('[prefs]', e)); // settings first: the layout reads the UI scale / headers
  layoutMod.initLayout(); // panels into the dock first: the modules below measure their elements
  $('play').innerHTML = ICON.play; $('to-start').innerHTML = ICON.start; $('to-end').innerHTML = ICON.end;
  initTransport($('video'));
  initTracks();
  initTimeline({ scroller: $('tl-scroll'), inner: $('tl-inner'), heads: $('tl-heads'), wrap: $('tl-canvas-wrap'), canvas: $('tl-canvas') });
  initInspector($('inspector'));
  initNotes();
  initViewer(); initShots(); initDraw(); initPins(); initLive(); initLayers(); initPaths();
  initSynth();
  on('toast', ({ m, ms }) => toast(m, ms));
  initVersions(); initVisualDiff(); codeMod.initCode(); codeMod.setEnterCode(() => setAppMode('code')); // openObjectCode enters Code mode like the mode buttons
  for (const b of $('mode-seg').querySelectorAll('button')) b.onclick = (e) => { e.currentTarget.blur(); setAppMode(b.dataset.m); };
  on('mode-ui', syncModeSeg);
  syncModeSeg();
  on('versions-host', () => { if (codeMod.codeOn() && codeMod.C.leftTab === 'versions') mountVersions($('code-versions')); else notesMod.render(); });
  on('versions-restored', () => { if (S.name) loadScene(S.name, { keepDraft: true }); refreshScenes().catch(() => {}); });

  on('render-busy', (busy) => { renderBusy = busy; updateTopbar(); });
  for (const ev of ['draft', 'mode', 'dirty', 'synth', 'scene']) on(ev, updateTopbar);
  for (const ev of ['time', 'scene']) on(ev, updateTransportUI);
  for (const ev of ['transport', 'loop', 'scene']) on(ev, updateTransportButtons);
  on('loop', () => invalidate(false));
  on('mode', () => { engine.setMode(S.mode); });

  nsMod.initNewScene({ refreshScenes, selectScene: selectCreatedScene });
  $('empty-new').onclick = () => nsMod.openNewScene().catch((err) => toast('New scene: ' + (err.message || err), 5000));
  on('scene', () => { updateEmptyNew(); syncBriefBtn(); });
  on('brief-changed', syncBriefBtn);
  on('root', updateEmptyNew);
  initLibraryBtn();
  window.addEventListener('focus', () => { // back from T3 / the terminal: pick up scenes that were added meanwhile
    if (Date.now() - lastFocusSync < 2000) return;
    lastFocusSync = Date.now(); syncScenes().catch(() => {});
  });
  renderMod.initRender({ toast, reloadScene: (name) => loadScene(name, { keepDraft: true }), refreshScenes });
  $('render-btn').onclick = (e) => { e.currentTarget.blur(); if (e.shiftKey) renderMod.quickRender(); else renderMod.toggleRender(); };
  initSettings(); termMod.initTerminal(); initAsk(); initPulse(); t3Mod.initT3();
  for (const b of $('ab').querySelectorAll('button')) b.onclick = () => setMode(b.dataset.mode);
  $('save-btn').onclick = saveDraft;
  $('undo-btn').onclick = undo; $('redo-btn').onclick = redo;
  $('play').onclick = () => toggle();
  $('to-start').onclick = () => { seek(0); ensureVisible(0); };
  $('to-end').onclick = () => { seek(duration()); ensureVisible(duration()); };
  $('loop-btn').onclick = toggleLoop;
  // master: monitoring only; 0 dB = the engine's default 0.9 headroom gain
  const mv = $('master-vol');
  mv.oninput = () => { const db = +mv.value; if (engine.master) engine.master.gain.value = 0.9 * 10 ** (db / 20); $('master-db').textContent = (db > 0 ? '+' : '') + db.toFixed(1); };
  mv.ondblclick = () => { mv.value = 0; mv.oninput(); };
  for (const b of $('rate').querySelectorAll('button')) b.onclick = () => setRate(+b.dataset.rate);
  $('fit-btn').onclick = fitView;
  for (const id of ['play', 'to-start', 'to-end', 'loop-btn', 'fit-btn', 'save-btn', 'undo-btn', 'redo-btn', 'add-note']) $(id).addEventListener('click', (e) => e.currentTarget.blur());
  initKeymap({ saveDraft, toggleLoop, setMode, saveCode: codeMod.saveActive, codeOn: codeMod.codeOn }); initHelp(); installKeys();
  initToolbar({
    select: loadScene, newScene: () => nsMod.openNewScene(),
    brief: () => S.name && nsMod.openNewScene({ edit: S.name }), hasBrief: () => hasBrief,
    reload: () => syncScenes({ reload: true }), library: () => openLibrary,
    startClaude: termMod.startClaude, openT3: t3Mod.openT3,
    quickRender: renderMod.quickRender, openRender: () => renderMod.toggleRender(true), toast,
  });
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false }); // no page zoom
  window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  new ResizeObserver(sizeVideo).observe($('video-wrap'));

  updateTopbar(); updateTransportButtons(); updateTransportUI();
  try {
    S.root = await api.getRoot();
    const info = await api.projectInfo(S.root);
    if (!info.exists || !info.isProject) { // only via a stale root: the welcome window picks a project
      setProjectLabel('No project');
      $('empty-msg').textContent = 'No project open: pick one in the welcome window (Ctrl+Shift+O).';
      api.openWelcome().catch(() => {});
    } else await enterProject(info.name, location.hash.match(/scene=([\w.-]+)/)?.[1]);
    if (localStorage.getItem('gfx-studio.code') === '1') await setAppMode('code');
  } catch (e) { console.error(e); toast('Backend error: ' + e.message, 6000); }
  setInterval(pollDisk, 2000);
  emit('prefs', { keys: Object.keys(SCHEMA) }); // every module applies the settings it uses
  api.listen('gfx://open-project', (path) => openFromWelcome(path));
  api.listen('gfx://open-settings', (page) => openSettings(page));
  const sp = location.hash.match(/settings=([\w-]+)/)?.[1]; // dev shim: the welcome page's "Connect T3"
  if (sp) openSettings(sp);
}
boot();

window.__studio = { setAppMode, openProject, openSettings, closeSettings, settingsOpen, layout: layoutMod, $, mods: { newscene: nsMod, code: codeMod, versions: versionsMod, notes: notesMod, keys: keysMod, render: renderMod, term: termMod, t3: t3Mod, paths: pathsMod, tracks: tracksMod, live: liveMod, viewer: viewerMod, store: storeMod }, S, engine, soundindex: () => import('./soundindex.js'), transport, api, seek, setMode, loadScene, saveDraft, zoomAt, viewWidth, patchCue, snapT };
