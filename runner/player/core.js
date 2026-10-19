// Shared by the dev player and the exported page: build a scene, preview it.
import { makeCue, resolveCues, renderStems, SAMPLE_RATE } from '../lib/sfx.js';
import { createRegistry } from './elements.js';

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

async function loadFonts(style) {
  for (const f of style.fontFiles || []) {
    const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight || 400) });
    document.fonts.add(await face.load());
  }
  await document.fonts.ready;
}

/** Build the scene root inside `parent`; returns { root, ctx, render(t) }. */
export async function buildScene({ meta, style, mod, parent, tweaks, transparent = false, trace = null }) {
  await loadFonts(style);
  const root = document.createElement('div');
  root.id = 'gfx-root';
  Object.assign(root.style, {
    position: 'absolute', left: '0', top: '0', overflow: 'hidden',
    width: meta.width + 'px', height: meta.height + 'px', background: transparent ? 'transparent' : style.colors.bg,
    fontFamily: style.fonts.sans,
  });
  for (const [k, v] of Object.entries(style.colors)) root.style.setProperty('--gfx-' + kebab(k), v);
  // every style.fonts.<key> -> --gfx-font-<kebab key> (sans / mono first, as before)
  root.style.setProperty('--gfx-font-sans', style.fonts.sans);
  root.style.setProperty('--gfx-font-mono', style.fonts.mono);
  for (const [k, v] of Object.entries(style.fonts || {})) if (k !== 'sans' && k !== 'mono' && typeof v === 'string') root.style.setProperty('--gfx-font-' + kebab(k), v);
  parent.appendChild(root);

  const cues = [];
  const counts = {};
  const ids = new Set();
  let inSetup = true;
  const reg = createRegistry({ root, meta });
  reg.setFile(tweaks);
  const ctx = {
    root, width: meta.width, height: meta.height, fps: meta.fps, duration: meta.duration, style, meta,
    // Sound cue: only valid during setup(); t = the moment the sound must hit.
    cue(t, sound, opts) {
      if (!inSetup) throw new Error('ctx.cue() may only be called during setup(), not in render() or later');
      const n = (counts[sound] = (counts[sound] || 0) + 1);
      const cue = makeCue(t, sound, opts, { width: meta.width, n });
      if (ids.has(cue.id)) throw new Error(`ctx.cue(): duplicate cue id "${cue.id}"`);
      ids.add(cue.id);
      cues.push(cue);
      if (trace) trace.cue(cue.id, cue.t);
      return cue.id;
    },
    // Name an element (DOM node) or a non-DOM object ({ bounds: (t) => {x,y,w,h} }) for picking/tweaks; setup-only.
    el: (name, target) => {
      const r = reg.el(name, target);
      if (trace) trace.el(name, typeof Element !== 'undefined' && target instanceof Element ? reg.keyOf(target) : name);
      return r;
    },
    // Effective tweak for a key: { x, y, scale, rotate, opacity, ... } with identity defaults.
    tweak: (name) => reg.tweak(name),
    // Element clock (docs/RETIME.md): setup-only; returns (t) => the element's local time under its time tweaks.
    // For objects the scene draws itself (canvas / three / hand-computed DOM): draw them at clock(t) instead of t.
    clock: (name) => reg.clock(name),
  };
  const scene = mod.default;
  try { await scene.setup(ctx); } finally { inSetup = false; reg.endSetup(); }
  cues.forEach((c, i) => { c.i = i; });
  cues.sort((a, b) => a.t - b.t || a.i - b.i);
  cues.forEach((c) => { delete c.i; });
  // Every render is followed by the tweak layer; renders are serialised so apply() always follows its own render.
  let lastT = 0;
  let chain = Promise.resolve();
  const enqueue = (run) => {
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  };
  const drawFrame = async (t) => {
    reg.setTime(t); reg.restore();
    const plan = reg.retimePlan(t); // null without time tweaks: exactly the old path (byte-identical renders)
    if (plan) {
      const caps = [];
      for (const g of plan) {
        if (g.same) continue;
        await scene.render(g.t, ctx);
        caps.push(...reg.retimeCapture(g.scopes));
      }
      await scene.render(t, ctx);
      // scopes whose local time is t itself (e.g. a child cancelling its parent's shift): capture now, so they still
      // override a retimed ancestor's copy (retimeWrite writes shallow scopes first)
      for (const g of plan) if (g.same) caps.push(...reg.retimeCapture(g.scopes));
      reg.retimeWrite(caps);
    } else await scene.render(t, ctx);
    reg.apply();
  };
  const render = (t) => enqueue(async () => {
    lastT = t ?? lastT;
    await drawFrame(lastT);
  });
  const mutate = (setter, obj, redraw = false) => {
    const snapshot = structuredClone(obj);
    return enqueue(async () => {
      setter(snapshot);
      if (redraw) await drawFrame(lastT);
    });
  };
  await render(0);
  // Visibility spans per tree node (§6): sampled by seeking, all inside ONE serialised job so no other render can
  // interleave; `visible` tweaks and the view layer are ignored while sampling; the previous t is re-rendered after.
  const spanCache = new Map();
  const spans = async (opts = {}) => {
    const step = Math.max(1, Math.round(Number(opts.step) || 2));
    const t0 = performance.now();
    return enqueue(() => runSpans(step, t0));
  };
  const runSpans = async (step, t0) => {
    const fps = meta.fps;
    const sig = step + '|' + reg.signature();
    const hit = spanCache.get(sig);
    if (hit) return { ...hit, ms: 0, cached: true };
    const prev = lastT;
    const list = reg.tree().nodes;
    const N = Math.floor(meta.duration * fps + 1e-6);
    const vis = {}; // key -> sample indices (frame / step) where visible
    reg.setSampling(true);
    try {
      for (let f = 0; f <= N; f += step) {
        const t = f / fps;
        await drawFrame(t);
        const v = reg.visibility(list);
        for (const k in v) if (v[k]) (vis[k] || (vis[k] = [])).push(f);
      }
    } finally {
      reg.setSampling(false);
      await drawFrame(prev);
    }
    const out = {};
    for (const nd of list) {
      const fr = vis[nd.key] || [];
      const iv = [];
      for (const f of fr) {
        const last = iv[iv.length - 1];
        if (last && f - last[1] <= step) last[1] = f + step;
        else iv.push([f, f + step]);
      }
      out[nd.key] = iv.map(([a, b]) => [+(a / fps).toFixed(4), +(Math.min(b, N) / fps).toFixed(4)]);
    }
    const res = { fps, step, spans: out };
    if (sig === step + '|' + reg.signature()) spanCache.set(sig, res);
    return { ...res, ms: Math.round(performance.now() - t0) };
  };
  // §7 actual values at the displayed (or a given) t; a given t is rendered and the displayed frame redrawn after.
  const values = (keys, t) => enqueue(async () => {
    const prev = lastT;
    const moved = Number.isFinite(t) && t !== prev;
    if (moved) await drawFrame(t);
    try { return reg.values(Array.isArray(keys) ? keys : keys ? [keys] : []); }
    finally { if (moved) await drawFrame(prev); }
  });
  // §7 motion path: one serialised sampling job like spans (visible/view layers ignored), cached by key+range+step+signature.
  const pathCache = new Map();
  const path = (opts = {}) => {
    const t0 = performance.now();
    return enqueue(async () => {
      const key = opts.key;
      const fps = meta.fps;
      const N = Math.floor(meta.duration * fps + 1e-6);
      let f0 = 0, f1 = N;
      if (Number.isFinite(opts.from) || Number.isFinite(opts.to)) {
        if (Number.isFinite(opts.from)) f0 = Math.ceil(opts.from * fps - 1e-6);
        f1 = Number.isFinite(opts.to) ? Math.floor(opts.to * fps + 1e-6) : N;
      } else {
        const iv = (await runSpans(2, t0)).spans[key];
        if (iv && iv.length) { f0 = Math.floor(iv[0][0] * fps + 1e-6); f1 = Math.ceil(iv[iv.length - 1][1] * fps - 1e-6); }
      }
      f0 = Math.max(0, f0); f1 = Math.min(N, f1);
      if (f1 < f0) f1 = f0;
      const step = Math.max(1, Math.round(Number(opts.step) || 1), Math.ceil((f1 - f0 + 1) / 1200));
      const sig = `${key}|${f0}|${f1}|${step}|${reg.signature()}`;
      const hit = pathCache.get(sig);
      if (hit) return { ...hit, ms: 0, cached: true };
      const prev = lastT;
      const samples = [];
      reg.setSampling(true);
      try {
        await drawFrame(f0 / fps);
        const measure = reg.probe(key);
        if (!measure) throw new Error(`path: key "${key}" does not resolve to an element`);
        for (let f = f0; f <= f1; f += step) {
          if (f !== f0) await drawFrame(f / fps);
          const m = measure();
          samples.push({ t: +(f / fps).toFixed(4), cx: m.cx, cy: m.cy, scaleX: m.scaleX, scaleY: m.scaleY, rotate: m.rotate, opacity: m.opacity, visible: m.visible, quad: m.quad });
        }
      } finally {
        reg.setSampling(false);
        await drawFrame(prev);
      }
      const res = { fps, step, samples };
      if (sig === `${key}|${f0}|${f1}|${step}|${reg.signature()}`) { if (pathCache.size > 64) pathCache.clear(); pathCache.set(sig, res); }
      return { ...res, ms: Math.round(performance.now() - t0) };
    });
  };
  // window.__gfx additions: file tweaks come from the caller; live tweaks from the bridge/studio.
  const api = {
    setTweaks: (obj) => mutate(reg.setLive, obj, true),
    setFileTweaks: (obj) => mutate(reg.setFile, obj, true),
    setLive: (obj) => mutate(reg.setLive, obj), // non-rendering variants (the bridge coalesces its own draws)
    setFile: (obj) => mutate(reg.setFile, obj),
    pick: (x, y) => reg.pick(x, y),
    bounds: (keys) => reg.bounds(keys),
    elements: () => reg.elements(),
    calib: (key) => reg.calib(key),
    setView: (v) => mutate(reg.setView, v, true),
    setViewQuiet: (v) => mutate(reg.setView, v), // non-rendering variant (the bridge coalesces its own draws)
    tree: () => reg.tree(),
    spans,
    values,
    path,
    warnings: reg.warnings,
  };
  return { root, ctx, render, cues, api, code: { nodeOf: reg.nodeOf, keysIn: reg.keysIn } };
}

/** Capture-mode page: frame at (0,0), no chrome. Returns window.__gfx. */
export function exposeCapture({ meta, style, built, transparent = false }) {
  document.body.style.cssText = `margin:0;overflow:hidden;background:${transparent ? 'transparent' : style.colors.bg}`;
  if (transparent) document.documentElement.style.background = 'transparent';
  const gfx = {
    meta,
    cues: built.cues,
    ...built.api,
    seek: async (t) => { await built.render(t); await raf(); await raf(); },
  };
  return gfx;
}

/**
 * Dev-preview audio: render the whole mix once (same synth as `gfx audio`) into an AudioBuffer, then play it
 * with an AudioBufferSourceNode from the current t on play/seek. Browsers need a user gesture to start audio.
 */
function createPreviewAudio({ meta, cues, soundFix, onState }) {
  const res = resolveCues(cues, soundFix || {});
  const a = { ctx: null, buf: null, src: null, muted: false, ready: false, res };
  const stop = () => { if (a.src) { try { a.src.stop(); } catch {} a.src.disconnect(); a.src = null; } };
  a.stop = stop;
  a.start = (t) => {
    stop();
    if (!a.buf || a.muted || !a.ctx || a.ctx.state !== 'running' || t >= meta.duration) return;
    a.src = a.ctx.createBufferSource();
    a.src.buffer = a.buf;
    a.src.connect(a.ctx.destination);
    a.src.start(0, Math.max(0, t));
  };
  a.unlock = () => { if (a.ctx && a.ctx.state !== 'running') return a.ctx.resume().then(() => onState('unlocked')); };
  a.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  renderStems(res.cues, { duration: meta.duration, stems: res.stems }).then((stems) => {
    const N = Math.round(meta.duration * SAMPLE_RATE);
    const buf = a.ctx.createBuffer(2, N, SAMPLE_RATE);
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (const [l, r] of Object.values(stems)) for (let i = 0; i < N; i++) { L[i] += l[i]; R[i] += r[i]; }
    a.buf = buf; a.ready = true;
    onState('ready');
  }).catch((e) => { console.error('gfx audio render failed', e); onState('error'); });
  return a;
}

/**
 * Realtime preview: scaled-to-fit frame, looping. `controls` adds a control bar
 * (dev player); without it a click toggles pause (exported page).
 */
export function mountPreview({ meta, style, built, container, controls, soundFix }) {
  const { width: W, height: H, duration } = meta;
  const bg = style.colors.bg;
  const wrap = document.createElement('div');
  wrap.style.cssText = `position:relative;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden`;
  const stage = document.createElement('div');
  stage.style.cssText = 'position:relative;overflow:hidden';
  stage.appendChild(built.root);
  built.root.style.transformOrigin = '0 0';
  wrap.appendChild(stage);
  container.appendChild(wrap);

  const st = { t: 0, playing: true, loop: true, last: performance.now(), busy: false };
  let bar, play, scrub, readout, loopBox, muteBtn, aud = null;
  if (controls) {
    bar = document.createElement('div');
    bar.style.cssText = `display:flex;gap:12px;align-items:center;padding:10px 16px;background:${style.colors.surface};border-top:1px solid ${style.colors.border};color:${style.colors.text};font:13px ${style.fonts.mono}`;
    play = Object.assign(document.createElement('button'), { textContent: 'pause' });
    scrub = Object.assign(document.createElement('input'), { type: 'range', min: 0, max: 1000, value: 0 });
    scrub.style.flex = '1';
    readout = document.createElement('span');
    loopBox = Object.assign(document.createElement('input'), { type: 'checkbox', checked: true });
    const loopLabel = document.createElement('label');
    loopLabel.append(loopBox, ' loop');
    bar.append(play, scrub, readout, loopLabel);
    if (built.cues.length) {
      muteBtn = Object.assign(document.createElement('button'), { id: 'gfx-mute', textContent: 'sound: rendering...' });
      muteBtn.title = 'Toggle sound (click anywhere once to unlock audio)';
      bar.append(muteBtn);
      const label = () => {
        muteBtn.textContent = !aud.ready ? 'sound: rendering...' : aud.muted ? 'sound: muted' : aud.ctx.state === 'running' ? 'sound: on' : 'sound: click to enable';
      };
      aud = createPreviewAudio({
        meta, cues: built.cues, soundFix,
        onState: () => { label(); if (st.playing) aud.start(st.t); },
      });
      muteBtn.onclick = () => {
        aud.muted = !aud.muted;
        Promise.resolve(aud.unlock()).then(() => { label(); if (st.playing) aud.start(st.t); });
        if (aud.muted) aud.stop();
        label();
      };
      const unlock = () => { Promise.resolve(aud.unlock()).then(label); };
      addEventListener('pointerdown', unlock, { once: true });
      addEventListener('keydown', unlock, { once: true });
    }
    container.appendChild(bar);
  }

  const fit = () => {
    const r = wrap.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    stage.style.width = W * s + 'px';
    stage.style.height = H * s + 'px';
    built.root.style.transform = `scale(${s})`;
  };
  new ResizeObserver(fit).observe(wrap);
  fit();

  const draw = async () => {
    // Coalesce requests while an async render is in flight; always finish on the latest st.t.
    if (st.busy) { st.dirty = true; return; }
    st.busy = true;
    try {
      do { st.dirty = false; await built.render(st.t); } while (st.dirty);
    } finally { st.busy = false; }
    if (controls) {
      scrub.value = String((st.t / duration) * 1000);
      readout.textContent = `${st.t.toFixed(2)} / ${duration.toFixed(2)}s`;
    }
  };
  const setPlaying = (p) => {
    st.playing = p; st.last = performance.now(); if (play) play.textContent = p ? 'pause' : 'play';
    if (aud) { if (p) aud.start(st.t); else aud.stop(); }
  };
  const step = (dt) => { setPlaying(false); st.t = Math.min(duration, Math.max(0, st.t + dt)); draw(); };

  const tick = (now) => {
    if (st.playing) {
      st.t += (now - st.last) / 1000;
      if (st.t >= duration) {
        if (st.loop) { st.t %= duration; if (aud) aud.start(st.t); }
        else { st.t = duration; setPlaying(false); }
      }
      draw();
    }
    st.last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  if (controls) {
    play.onclick = () => setPlaying(!st.playing);
    loopBox.onchange = () => { st.loop = loopBox.checked; };
    scrub.oninput = () => { setPlaying(false); st.t = (scrub.value / 1000) * duration; draw(); };
    addEventListener('keydown', (e) => {
      if (e.code === 'Space') { e.preventDefault(); setPlaying(!st.playing); }
      else if (e.code === 'ArrowLeft') step(-1 / meta.fps);
      else if (e.code === 'ArrowRight') step(1 / meta.fps);
    });
  } else {
    container.addEventListener('click', () => setPlaying(!st.playing));
  }
  container.style.background = bg;
}
