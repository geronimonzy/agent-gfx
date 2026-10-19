// Review-loop test: elements / pick / tweaks in the runner, `gfx serve`, `gfx review`, `gfx apply`.
// Run: node tests/review.test.mjs   (needs /usr/bin/google-chrome or GFX_CHROME)
import fs from 'node:fs';
import net from 'node:net';
import vm from 'node:vm';
import os from 'node:os';
import { createRegistry } from '../runner/player/elements.js';
import { resolveCues } from '../runner/lib/sfx.js';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import * as RV from '../runner/lib/review.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENE = '_review-test';
const CHROME = process.env.GFX_CHROME || '/usr/bin/google-chrome';
const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage'];
const OUT = path.join(ROOT, 'out', SCENE);
const REV = path.join(OUT, 'review');
const SC = path.join(ROOT, 'scenes', SCENE);
const outExisted = fs.existsSync(OUT);
const sceneFilesBefore = new Set(fs.readdirSync(SC));

let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const near = (a, b, eps = 0.06) => Math.abs(a - b) <= eps;
const cli = (...args) => execFileSync(process.execPath, [path.join(ROOT, 'runner/cli.js'), ...args], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const rd = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const wr = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };

function testApplyAddedCue() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-review-'));
  try {
    const sound = path.join(root, 'scenes', SCENE, 'sound.json');
    wr(sound, { add: [{ id: 'added', t: 1, sound: 'chime', gain: -4 }, { t: 0, sound: 'pop' }] });
    wr(RV.draftPath(SCENE, root), { cues: { added: { t: 1.5, gain: -12, mute: true }, 'pop-add2': { gain: -8 } } });
    RV.applySound(SCENE, root);
    const saved = rd(sound), resolved = resolveCues([], saved);
    const added = resolved.cues.find((c) => c.id === 'added');
    ok(added.t === 1.5 && added.gain === -12 && saved.add[0].mute && added.sound === 'chime' && !saved.cues, 'applied added cue keeps sound, resolves edited timing/gain, and stores mute');
    ok(resolved.cues.find((c) => c.id === 'pop-add2').gain === -8, 'apply recognizes generated ids for previously added cues');
    ok(Object.keys(rd(RV.draftPath(SCENE, root)).cues).length === 0, 'applied added-cue overrides are cleared from draft');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testApplyIdentityTweak() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-review-tweaks-'));
  try {
    const file = path.join(root, 'scenes', SCENE, 'tweaks.json');
    wr(file, { still: { x: 40, color: '#fff' } });
    wr(RV.draftPath(SCENE, root), { tweaks: { still: { x: 0 } } });
    RV.applyTweaks(SCENE, root);
    const saved = rd(file);
    ok(!('x' in saved.still) && saved.still.color === '#fff', 'draft x:0 deletes file x:40 while preserving other properties', saved);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testApplyVisibleZ() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-review-layers-'));
  try {
    const file = path.join(root, 'scenes', SCENE, 'tweaks.json');
    wr(file, { mover: { visible: false, z: 2 }, label: { visible: false } });
    wr(RV.draftPath(SCENE, root), { tweaks: { still: { visible: false, z: 3 }, mover: { visible: true }, label: { visible: true, z: 0 } } });
    RV.applyTweaks(SCENE, root);
    const saved = rd(file);
    ok(JSON.stringify(saved.still) === '{"visible":false,"z":3}' && JSON.stringify(saved.mover) === '{"z":2}' && JSON.stringify(saved.label) === '{"z":0}', 'apply folds visible/z (visible:true drops the key, z kept)', saved);
    ok(RV.fmtTweak({ visible: false, z: 3 }) === 'visible=false z=3', 'review summary formats visible/z', RV.fmtTweak({ visible: false, z: 3 }));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function testOpacityBase() {
  const node = { style: { opacity: '1' }, getAttribute: () => 'fader' };
  const root = { querySelectorAll: () => [node] };
  const reg = createRegistry({ root, meta: {} });
  reg.endSetup(); reg.setLive({ fader: { opacity: 0.5 } });
  const render = (t) => { reg.restore(); node.style.opacity = String(1 - t / 2); reg.apply(); return +node.style.opacity; };
  render(0); const direct = render(1);
  render(0); render(0.5); const via = render(1);
  ok(direct === 0.25 && via === direct, 'restoring owned properties makes equal scene/tweak values independent of seek history');
}

// Exercise the shots module with deferred I/O and explicit scene events.
async function testShots() {
  const handlers = new Map(), writes = [], pending = [], timers = new Map();
  let scene = 'a', comments, timerId = 0;
  const fresh = () => ({ id: 'c1', t: 0, x: null, y: null, strokes: [], attachments: [] });
  comments = [fresh()];
  const emit = (event, value) => handlers.get(event)?.(value);
  const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
  let holdWrites = false, bitmapWait = null;
  const context = {
    S: { meta: { width: 800, height: 600 } }, fps: () => 30,
    on: (event, fn) => handlers.set(event, fn), emit,
    commentScene: () => scene, liveComments: () => comments,
    getComment: (id) => comments.find((c) => c.id === id),
    updateComment: (id, fn) => {
      const c = comments.find((c) => c.id === id), before = JSON.stringify(c);
      fn(c);
      if (JSON.stringify(c) !== before) emit('comments', { id, local: true });
    },
    api: {
      readBytes: async () => new Uint8Array(),
      writeBytes: async (path, bytes) => {
        writes.push({ path, bytes: [...bytes] });
        if (holdWrites) { const d = deferred(); pending.push(d); await d.promise; }
      },
    },
    transport: { video: { src: 'video', videoWidth: 800, currentTime: 1 / 60, duration: 2, readyState: 4 }, playing: false },
    drawStrokes: () => {},
    document: { fonts: { load: async () => [] }, createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {} }), toBlob: (fn) => fn(new Blob(['png'])) }) },
    tok: (name) => name, // theme.js token reader (shots.js imports it)
    createImageBitmap: async () => { if (bitmapWait) await bitmapWait.promise; return { close() {} }; },
    setTimeout: (fn) => { timers.set(++timerId, fn); return timerId; }, clearTimeout: (id) => timers.delete(id),
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Blob, Uint8Array, structuredClone, console,
  };
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/shots.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  vm.runInNewContext(source + '\nthis.shots = { initShots, addImage, grabFrame, writeMarkup, origin };', context);
  const shots = context.shots;
  shots.initShots();
  const image = (value) => ({ type: 'image/png', size: 1, name: 'x.png', arrayBuffer: async () => new Uint8Array([value]).buffer });
  holdWrites = true;
  const a = shots.addImage('c1', image(1)), b = shots.addImage('c1', image(2));
  while (pending.length < 2) await new Promise(setImmediate);
  pending.splice(0).forEach((d) => d.resolve());
  await Promise.all([a, b]);
  ok(writes[0].path !== writes[1].path && comments[0].attachments.length === 2 && writes[0].bytes[0] !== writes[1].bytes[0], 'concurrent images reserve distinct paths and retain both attachments');

  const switchScene = (name) => { scene = name; comments = [fresh()]; emit('scene'); };
  const old = shots.addImage('c1', image(3));
  while (!pending.length) await new Promise(setImmediate);
  switchScene('b'); switchScene('a'); // returning to the same scene still invalidates old work
  pending.splice(0).forEach((d) => d.resolve());
  ok(await old === false && comments[0].attachments.length === 0 && writes.at(-1).path.startsWith('out/a/'), 'image completion after switching away and back cannot attach to the new comment');

  holdWrites = false;
  const count = writes.length, delayedBytes = deferred();
  const reading = shots.addImage('c1', { ...image(4), arrayBuffer: () => delayedBytes.promise });
  switchScene('b'); delayedBytes.resolve(new Uint8Array([4]).buffer);
  ok(await reading === false && writes.length === count, 'image byte conversion after scene switch is dropped before writing');

  bitmapWait = deferred();
  const grabbing = shots.grabFrame('c1');
  switchScene('c'); bitmapWait.resolve(); await grabbing; bitmapWait = null;
  ok(comments[0].attachments.length === 0 && writes.length === count, 'frame bitmap completion after scene switch is dropped');

  comments[0].x = 30; comments[0].y = 30;
  holdWrites = true;
  const markup = shots.writeMarkup('c1', shots.origin());
  while (!pending.length) await new Promise(setImmediate);
  switchScene('d'); pending.splice(0).forEach((d) => d.resolve()); await markup;
  ok(comments[0].attachments.length === 0 && writes.at(-1).path.startsWith('out/c/'), 'markup write completion cannot attach to another scene');

  holdWrites = false;
  comments[0].strokes = [{ pts: [[1, 1], [2, 2]] }];
  await shots.writeMarkup('c1', shots.origin());
  ok(comments[0].attachments.some((a) => a.kind === 'markup'), 'stroke markup creates an attachment');
  comments[0].strokes = []; emit('comments', { id: 'c1', local: true });
  ok(!comments[0].attachments.some((a) => a.kind === 'markup' || a.path === 'shots/c1.png'), 'clearing the last stroke removes the markup attachment and path');
}

function testVisibility() {
  const previousStyle = globalThis.getComputedStyle;
  const nodes = [];
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const root = { getBoundingClientRect: () => rect, querySelectorAll: () => nodes };
  const node = (key, parent = root, css = {}) => {
    const n = { parentElement: parent, localName: 'div', childNodes: [], offsetWidth: 100, offsetHeight: 100,
      getAttribute: () => key, getBoundingClientRect: () => rect,
      css: { opacity: '1', display: 'block', visibility: 'visible', clipPath: 'none', backgroundColor: 'rgba(0, 0, 0, 0)', ...css } };
    nodes.push(n);
    return n;
  };
  const outer = node('outer'), inner = node('inner', outer), child = node('child', inner, { backgroundColor: 'rgb(255, 255, 0)', opacity: '0' });
  node('leaf');
  const painted = node('painted', root, { backgroundColor: 'rgb(255, 255, 0)' });
  node('hidden-child', painted, { opacity: '0' });
  const clipped = node('clipped', root, { clipPath: 'circle(0px at 50% 50%)', backgroundColor: 'rgb(255, 0, 0)' });
  node('clipped-child', clipped, { backgroundColor: 'rgb(255, 0, 0)' });
  const list = nodes.map((n) => ({ key: n.getAttribute(), kind: 'dom', parent: n.parentElement === root ? null : n.parentElement.getAttribute() }));
  globalThis.getComputedStyle = (n) => n.css || { opacity: '1', display: 'block', clipPath: 'none' };
  try {
    const reg = createRegistry({ root, meta: { width: 100, height: 100 } });
    reg.endSetup();
    let v = reg.visibility(list);
    ok(!v.outer && !v.inner && v.leaf && v.painted && !v.clipped && !v['clipped-child'], 'visibility: empty wrappers follow hidden children; painted parents/leaves and clip ancestors handled');
    child.css.opacity = '1'; clipped.css.clipPath = 'circle(20px at 50% 50%)';
    v = reg.visibility(list);
    ok(v.outer && v.inner && v.child && v.clipped && v['clipped-child'], 'visibility: child reveal propagates bottom-up and opening clip reveals subtree');
    outer.css.opacity = '0';
    ok(!reg.visibility(list).outer && !reg.visibility(list).child, 'visibility: wrapper union intersects ancestor opacity');
    const cases = [
      ['circle(0.5px at 50% 50%)', false], ['circle(1px at 50% 50%)', true],
      ['inset(60% 0 40%)', false], ['inset(0 60% 0 40%)', false],
      ['inset(60px 0 40px)', false], ['inset(0 60px 0 40px)', false],
      ['inset(20px)', true], ['inset(10% 20% 30%)', true],
      ['polygon(0 0, 50% 50%, 100% 100%)', false],
      ['polygon(0 0, 100% 100%, 100% 0, 0 100%)', true],
    ];
    ok(cases.every(([clip, expected]) => { clipped.css.clipPath = clip; return reg.visibility(list).clipped === expected; }), 'visibility: circle threshold, inset shorthand/units, degenerate polygon and nonempty bowtie');
    const paintCases = [
      { backgroundColor: 'rgb(255, 255, 0)' }, { backgroundColor: 'rgb(0 0 0 / 50%)' },
      { backgroundImage: 'linear-gradient(red, blue)' }, { borderTopWidth: '1px', borderTopColor: 'rgb(255, 0, 0)' },
      { boxShadow: 'rgb(0, 0, 0) 0px 0px 1px' }, { outlineWidth: '1px', outlineStyle: 'solid', outlineColor: 'rgb(255, 0, 0)' },
    ];
    ok(paintCases.every((css) => { painted.css = { opacity: '1', visibility: 'visible', backgroundColor: 'rgba(0, 0, 0, 0)', ...css }; return reg.visibility(list).painted; }), 'visibility: background alpha/image, visible border, shadow and outline count as own paint');
    painted.css = { opacity: '1', visibility: 'visible', backgroundColor: 'rgb(0 0 0 / 0%)' };
    ok(!reg.visibility(list).painted, 'visibility: modern zero-alpha background does not paint');
    painted.childNodes = [{ nodeType: 3, textContent: 'Text' }];
    ok(reg.visibility(list).painted, 'visibility: direct text counts as own paint');
    inner.css.overflowY = 'hidden'; outer.css.opacity = '1';
    child.getBoundingClientRect = () => ({ ...rect, top: 120 });
    ok(!reg.visibility(list).inner && !reg.visibility(list).outer, 'visibility: named text outside an overflow clip cannot reveal its containers');
    child.getBoundingClientRect = () => ({ ...rect, top: 50 });
    ok(reg.visibility(list).outer, 'visibility: partially revealed overflow content reveals its containers');
  } finally { if (previousStyle === undefined) delete globalThis.getComputedStyle; else globalThis.getComputedStyle = previousStyle; }
}

function testProbeRegressions() {
  const saved = new Map(['getComputedStyle', 'DOMMatrix', 'SVGElement', 'Node'].map((key) => [key, globalThis[key]]));
  class Matrix {
    constructor() { this.a = this.d = 1; this.b = this.c = 0; }
    multiply() { return this; }
  }
  const rect = { left: 0, top: 0, width: 100, height: 100 };
  const nodes = [];
  const root = { children: [], css: { opacity: '1' }, getBoundingClientRect: () => rect,
    querySelectorAll: () => nodes.filter((n) => n.key), contains: (n) => nodes.includes(n) };
  const add = (key, css = {}, parent = root) => {
    const n = { key, tagName: 'DIV', localName: 'div', className: '', textContent: '', children: [], childNodes: [], parentElement: parent,
      offsetWidth: 20, offsetHeight: 11, rect: { ...rect, left: 5, top: 5, width: 20.25, height: 10.75 },
      css: { opacity: '1', display: 'block', visibility: 'visible', clipPath: 'none', width: '20.25px', height: '10.75px',
        boxSizing: 'border-box', backgroundColor: 'rgba(0, 0, 0, 0)', ...css },
      getAttribute: () => key, getBoundingClientRect() { return this.rect; },
      contains(other) { for (let c = other; c; c = c.parentElement) if (c === this) return true; return false; },
      compareDocumentPosition(other) { return nodes.indexOf(this) < nodes.indexOf(other) ? 4 : 2; } };
    nodes.push(n); parent.children.push(n); return n;
  };
  const clipped = add('probe-clip', { clipPath: 'inset(50%)', backgroundColor: 'red' });
  const overflow = add(null, { overflowX: 'hidden' });
  const outside = add('probe-outside', { backgroundColor: 'red' }, overflow);
  outside.rect.left = 30;
  const container = add('probe-container'); add('probe-hidden', { opacity: '0' }, container);
  const unnamed = add(null); add('probe-unnamed-hidden', { opacity: '0' }, unnamed);
  const fractional = add('probe-fraction', { backgroundColor: 'red' });
  const structural = (n) => { const parts = []; for (let c = n; c !== root; c = c.parentElement) parts.unshift(c.parentElement.children.indexOf(c)); return '@' + parts.join('/'); };
  Object.assign(globalThis, { getComputedStyle: (n) => n.css, DOMMatrix: Matrix, SVGElement: class {}, Node: { DOCUMENT_POSITION_FOLLOWING: 4 } });
  try {
    const reg = createRegistry({ root, meta: { width: 100, height: 100 } }); reg.endSetup();
    ok([clipped, outside, container, unnamed].every((n) => {
      const key = structural(n), value = reg.values([key])[key], sample = reg.probe(key)();
      return !value.visible && !sample.visible && (!n.key || !reg.values([n.key])[n.key].visible);
    }), 'probe: named/structural visibility shares clips, overflow and unpainted containers');
    clipped.css.clipPath = 'none'; outside.rect.left = 10;
    container.children[0].css.opacity = '1'; unnamed.children[0].css.opacity = '1';
    ok([clipped, outside, container, unnamed].every((n) => reg.probe(structural(n))().visible), 'probe: opening visibility constraints reveals structural targets');
    const v = reg.values([fractional.key])[fractional.key], p = reg.probe(fractional.key)();
    ok(v.x === 5 && v.y === 5 && v.w === 20.25 && v.h === 10.75 && p.quad[1][0] - p.quad[0][0] === 20.25,
      'probe: fractional border-box dimensions preserve values and quad edges');
    fractional.css.boxSizing = 'content-box'; fractional.css.paddingLeft = fractional.css.paddingRight = '3.5px';
    fractional.css.borderLeftWidth = fractional.css.borderRightWidth = '1px'; fractional.rect.width = 29.25;
    ok(reg.values([fractional.key])[fractional.key].w === 29.25, 'probe: fractional content-box dimensions include padding and borders');
    root.css.opacity = '0.5'; fractional.css.opacity = '0.5'; root.parentElement = { css: { opacity: '0' } };
    ok(reg.values([fractional.key])[fractional.key].opacity === 0.25 && reg.probe(fractional.key)().opacity === 0.25,
      'probe: effective opacity includes the root and stops there');
    root.css.opacity = '0';
    const zero = reg.probe(fractional.key)();
    ok(zero.opacity === 0 && !zero.visible, 'probe: transparent root reports zero opacity and invisible');
  } finally {
    for (const [key, value] of saved) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

async function testValuesPathRegressions(page) {
  const result = await page.evaluate(async () => {
    const root = document.getElementById('gfx-root');
    const fixture = document.createElement('div');
    fixture.style.cssText = 'position:absolute;left:20px;top:20px;width:300px;height:300px';
    root.appendChild(fixture);
    const opacity = root.style.opacity;
    const add = (name, css, parent = fixture) => {
      const n = document.createElement('div');
      if (name) n.dataset.gfx = name;
      n.style.cssText = 'position:absolute;width:40px;height:40px;' + css;
      parent.appendChild(n);
      return n;
    };
    const structural = (n) => {
      const indices = [];
      for (let c = n; c !== root; c = c.parentElement) indices.unshift([...c.parentElement.children].indexOf(c));
      return '@' + indices.join('/');
    };
    const sample = async (key, t = 0.5) => (await window.__gfx.path({ key, from: t, to: t })).samples[0];
    try {
      const clip = add('reg-clip', 'clip-path:inset(50%);background:red');
      const overflow = add(null, 'overflow:hidden');
      const outside = add('reg-outside', 'left:60px;background:red', overflow);
      const container = add('reg-container', '');
      add('reg-hidden', 'opacity:0;background:red', container);
      const unnamed = add(null, '');
      add('reg-unnamed-hidden', 'opacity:0;background:red', unnamed);
      const visibility = [];
      for (const n of [clip, outside, container, unnamed]) {
        const key = structural(n), name = n.dataset.gfx;
        const values = await window.__gfx.values(name ? [name, key] : [key], 0.5);
        visibility.push(values[key].visible === false && (await sample(key)).visible === false &&
          (!name || (values[name].visible === false && (await sample(name)).visible === false)));
      }
      // Opening each visibility constraint must also reveal the structural probe.
      clip.style.clipPath = 'none'; outside.style.left = '10px';
      container.firstElementChild.style.opacity = '1'; unnamed.firstElementChild.style.opacity = '1';
      const revealed = await window.__gfx.values([clip, outside, container, unnamed].map(structural), 0.5);
      const visibleAgain = Object.values(revealed).every((v) => v.visible);

      const fractional = [];
      const scaled = add(null, 'width:200px;height:200px;transform:scale(1.5);transform-origin:0 0');
      for (const [i, css] of [
        'box-sizing:border-box;width:20.25px;height:10.75px',
        'box-sizing:content-box;width:20.25px;height:10.75px;padding:2.25px 3.5px;border:1px solid red',
        'box-sizing:border-box;width:20.25px;height:10.75px;transform:rotate(30deg)',
      ].entries()) {
        const n = add('reg-fraction-' + i, css, scaled), key = n.dataset.gfx;
        const value = (await window.__gfx.values([key], 0.5))[key], p = await sample(key);
        const b = n.getBoundingClientRect(), r = root.getBoundingClientRect();
        const sx = r.width / 800, sy = r.height / 600;
        const matches = (m) => Math.abs(m.x - (b.left - r.left) / sx) < 0.02 &&
          Math.abs(m.y - (b.top - r.top) / sy) < 0.02 &&
          Math.abs(m.w - b.width / sx) < 0.02 && Math.abs(m.h - b.height / sy) < 0.02;
        const edge = Math.hypot(p.quad[1][0] - p.quad[0][0], p.quad[1][1] - p.quad[0][1]);
        const xs = p.quad.map(([x]) => x), ys = p.quad.map(([, y]) => y);
        const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        fractional.push(matches(value) && matches(box) && Math.abs(edge - (i === 1 ? 29.25 : 20.25) * 1.5) < 0.02);
      }
      const faded = add('reg-root-opacity', 'opacity:0.5;background:red');
      root.style.opacity = '0.5';
      const v = (await window.__gfx.values([faded.dataset.gfx], 0.5))[faded.dataset.gfx];
      const p = await sample(faded.dataset.gfx);
      root.style.opacity = '0';
      const zero = (await window.__gfx.values([faded.dataset.gfx], 0.5))[faded.dataset.gfx];
      const zeroPath = await sample(faded.dataset.gfx, 0.6);
      return { visibility, visibleAgain, fractional, rootOpacity: v.opacity === 0.25 && p.opacity === 0.25 &&
        v.visible && p.visible && zero.opacity === 0 && zeroPath.opacity === 0 && !zero.visible && !zeroPath.visible };
    } finally { root.style.opacity = opacity; fixture.remove(); }
  });
  ok(result.visibility.every(Boolean) && result.visibleAgain, 'values/path: structural and named keys share clip, overflow and unpainted-container visibility, including unnamed containers', result);
  ok(result.fractional.every(Boolean), 'values/path: fractional border/content boxes retain exact bounds and quad edges under parent scale and rotation', result.fractional);
  ok(result.rootOpacity, 'values/path: effective opacity includes root opacity, including zero', result.rootOpacity);
}

function testLayerDefaults() {
  const saved = new Map();
  let selected = null;
  const context = {
    S: { name: 'fresh' }, getSel: () => selected, queueMicrotask, emit() {},
    localStorage: { getItem: (k) => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) },
  };
  // store.js view-state helpers (imports are stripped below)
  context.readView = (k, apply) => { try { const j = JSON.parse(context.localStorage.getItem(k) || 'null'); if (!j || typeof j !== 'object') return false; apply(j); return true; } catch { return false; } };
  context.writeView = (k, v) => { if (context.S.name) context.localStorage.setItem(k, JSON.stringify(v)); };
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/layers.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  vm.runInNewContext(source + '\nthis.layers = { loadView, buildTree, rows, filterStack, V };', context);
  const { loadView, buildTree, rows } = context.layers;
  const tree = { nodes: [
    { key: 'parent', parent: null, depth: 0 },
    { key: 'child', parent: 'parent', depth: 1 },
    { key: 'grandchild', parent: 'child', depth: 2 },
  ] };
  loadView(); buildTree(tree);
  ok(rows().length === 1 && rows()[0].depth === 0 && !rows()[0].open, 'studio: fresh scene shows only collapsed depth-0 rows');
  buildTree(tree);
  ok(rows().length === 1, 'studio: refreshing the tree retains default collapsed state');
  saved.set('gfx-studio.layers.fresh', JSON.stringify({ closed: ['child'] }));
  loadView(); buildTree(tree);
  ok(rows().map((r) => r.key).join() === 'parent,child' && rows()[0].open && !rows()[1].open, 'studio: saved expansion state is preserved');
  saved.set('gfx-studio.layers.fresh', JSON.stringify({ closed: 'child', hidden: 3 }));
  let threw = false;
  try { loadView(); buildTree(tree); } catch { threw = true; }
  ok(!threw && rows().length === 1 && !rows()[0].open, 'studio: malformed saved layer view state is ignored (defaults, no throw)');
  saved.set('gfx-studio.layers.fresh', JSON.stringify({ closed: [] }));
  loadView(); buildTree(tree);
  ok(rows().length === 3, 'studio: saved fully expanded state is preserved');
  saved.delete('gfx-studio.layers.fresh');
  loadView();
  buildTree({ nodes: [
    { key: 'parent-0', group: 'parent', parent: null, kind: 'dom' },
    { key: 'parent-1', group: 'parent', parent: null, kind: 'dom' },
    { key: 'child-0', group: 'child', parent: 'parent-0', kind: 'dom' },
    { key: 'child-1', group: 'child', parent: 'parent-0', kind: 'dom' },
    { key: 'leaf', parent: 'child-0', kind: 'dom' },
    { key: 'ball', parent: null, kind: 'box' },
  ] });
  selected = { key: 'leaf' };
  const revealed = rows();
  ok(revealed.some((r) => r.key === 'leaf') && revealed.filter((r) => r.group).every((r) => r.open), 'studio: revealing a descendant opens sibling groups at every ancestor');
  const { V, filterStack } = context.layers;
  V.locked.add('child-0');
  const stack = ['ball', 'leaf', 'child-0', 'parent-0'].map((key) => ({ key }));
  ok(filterStack(stack).map((e) => e.key).join() === 'ball,parent-0', 'studio: locking DOM ancestry preserves unrelated bounds objects');
  V.locked.clear(); V.locked.add('ball');
  ok(filterStack(stack).map((e) => e.key).join() === 'leaf,child-0,parent-0', 'studio: locking a bounds object preserves DOM ancestry');

}

// Run the actual core scheduler with a deferred scene render, without browser/socket setup.
async function testSpanScheduling() {
  const source = fs.readFileSync(path.join(ROOT, 'runner/player/core.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const fixture = async (visible = () => true) => {
    let sampling = false, frame = 0, live = {}, file = {}, view = {}, displayed = 0, gate;
    const samples = [];
    const reg = {
      setFile: (o) => { file = o || {}; }, setLive: (o) => { live = o || {}; }, setView: (o) => { view = o || {}; },
      signature: () => JSON.stringify([file, live]), endSetup() {}, restore() {}, apply() {}, retimePlan: () => null,
      setTime: (t) => { frame = t; }, setSampling: (v) => { sampling = v; },
      tree: () => ({ nodes: [{ key: 'layer' }] }),
      visibility: () => ({ layer: visible(frame) && (live.layer?.opacity ?? file.layer?.opacity ?? 1) > 0 }),
      warnings: [],
    };
    const context = {
      createRegistry: () => reg, structuredClone, performance,
      document: { fonts: { ready: Promise.resolve() }, createElement: () => ({ style: { setProperty() {} } }) },
    };
    vm.runInNewContext(source + '\nthis.buildScene = buildScene;', context);
    const built = await context.buildScene({
      meta: { width: 100, height: 100, fps: 10, duration: 1 }, style: { colors: { bg: '#000' }, fonts: { sans: 'sans' } },
      parent: { appendChild() {} }, mod: { default: { setup() {}, async render(t) {
        displayed = t;
        if (sampling) samples.push(JSON.stringify([live, file, view]));
        if (sampling && t === 0.2 && gate) { const g = gate; gate = null; g.enter(); await g.wait; }
      } } },
    });
    return { built, samples, displayed: () => displayed, hold() {
      let enter, release;
      const entered = new Promise((r) => { enter = r; });
      const wait = new Promise((r) => { release = r; });
      gate = { enter, wait };
      return { entered, release };
    } };
  };
  for (const method of ['setTweaks', 'setFileTweaks', 'setLive', 'setFile', 'setView', 'setViewQuiet']) {
    const f = await fixture(), { built } = f;
    await built.render(0.8);
    const gate = f.hold(), mapping = built.api.spans({ step: 1 });
    await gate.entered;
    const isView = method.startsWith('setView');
    const mutation = built.api[method](isView ? { hidden: ['layer'] } : { layer: { opacity: 0 } });
    gate.release();
    const mapped = await mapping;
    await mutation;
    ok(new Set(f.samples).size === 1 && JSON.stringify(mapped.spans.layer) === '[[0,1]]', `spans: ${method} during an awaited render cannot mix registry states`, mapped.spans);
    ok(f.displayed() === 0.8, `spans: ${method} redraw preserves displayed time 0.8`, f.displayed());
    const changed = await built.api.spans({ step: 1 });
    ok(isView ? changed.cached === true : changed.cached !== true && changed.spans.layer.length === 0, `spans: ${method} uses the signature when its queued pass runs`);
    await built.api[method]({});
    const original = await built.api.spans({ step: 1 });
    ok(original.cached === true && JSON.stringify(original.spans.layer) === '[[0,1]]', `spans: ${method} leaves the original signature cache clean`);
  }
  const queued = await fixture();
  await queued.built.render(0.8);
  const gate = queued.hold(), mapping = queued.built.api.spans({ step: 1 });
  await gate.entered;
  const seek = queued.built.render(0.9), tweak = queued.built.api.setTweaks({ layer: { opacity: 0 } });
  // This pass is requested before the mutation runs; its cache lookup must wait for the mutation.
  const after = queued.built.api.spans({ step: 1 });
  gate.release();
  await Promise.all([mapping, seek, tweak]);
  const result = await after;
  ok(queued.displayed() === 0.9 && result.spans.layer.length === 0 && !result.cached, 'spans: queued seek sets redraw time and queued tweak precedes cache lookup');
  const gaps = await fixture((t) => [0, 2, 5].includes(Math.round(t * 10)));
  const intervals = (await gaps.built.api.spans({ step: 1 })).spans.layer;
  ok(JSON.stringify(intervals) === '[[0,0.3],[0.5,0.6]]', 'spans: merge a one-step gap, preserve a two-step gap', intervals);
}

async function testLayerTreeRefresh() {
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/layers.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const handlers = new Map();
  let applied = false, spanCalls = 0, treeCalls = 0, finishSpans;
  const firstSpans = new Promise((r) => { finishSpans = r; });
  const tree = () => ({ nodes: [
    { key: 'a', parent: null, kind: 'dom' }, { key: 'b', parent: null, kind: 'dom' },
  ], order: applied ? ['b', 'a'] : ['a', 'b'] });
  const context = {
    S: { name: 'refresh', mode: 'draft', draft: { tweaks: {} } }, L: { on: true, ready: true },
    getSel: () => null, liveOn: () => true, setPickFilter() {}, setExtHover() {}, emit() {},
    localStorage: { getItem: () => null }, transport: { playing: false },
    readView: () => null, writeView() {}, esc: (s) => String(s),
    setTimeout: () => 1, clearTimeout() {}, console,
    on: (event, fn) => handlers.set(event, fn),
    request: async (type) => {
      if (type === 'tree') { treeCalls++; return tree(); }
      if (type === 'spans') { spanCalls++; return spanCalls === 1 ? firstSpans : { spans: {} }; }
      return {};
    },
  };
  vm.runInNewContext(source + '\nthis.layers = { initLayers, buildTree, rows, runSpans, LY, V };', context);
  const { initLayers, buildTree, rows, runSpans, LY, V } = context.layers;
  initLayers(); buildTree(tree()); LY.ready = true; V.open.add('g:retained');
  const sampling = runSpans();
  handlers.get('draft')(); handlers.get('mode')();
  ok(treeCalls === 0 && rows()[0].key === 'a', 'studio: draft/mode changes wait for bridge tweak acknowledgement before refreshing tree');
  applied = true; handlers.get('live-tweaks-applied')();
  await new Promise(setImmediate);
  ok(treeCalls === 1 && rows()[0].key === 'b' && V.open.has('g:retained') && V.closed.has('a'), 'studio: applied tweaks refresh front-to-back order and retain expansion state');
  finishSpans({ spans: { a: [[0, 1]] } }); await sampling;
  await runSpans();
  ok(spanCalls === 2 && !LY.mapping, 'studio: tree refresh during sampling discards stale spans and releases the sampler for the new tree');
}

function testTimelineLayerRefresh() {
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/timeline.js'), 'utf8');
  const start = source.indexOf('const layerSig'), end = source.indexOf('// ---------- lane headers', start);
  let spans = [], layouts = 0, paints = 0;
  const context = {
    LY: { ready: true, tlOpen: true }, L: { layersH: 1 }, liveOn: () => true, curvesSig: () => '',
    buildLayerRows: () => [{ id: 'layer', spans }],
    layerRowsOf: () => [{ id: 'layer', spans }], relayout: () => { layouts++; },
    updateHeads() {}, invalidate: () => { paints++; },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.onLayers = onLayers;', context);
  context.onLayers();
  spans = [[0.1, 0.5]]; context.onLayers();
  ok(context.L.layerRows[0].spans === spans && layouts === 1 && paints === 1, 'studio: completed mapping replaces timeline row data without requiring relayout');
  spans = [[0.3, 0.8]]; context.onLayers();
  ok(context.L.layerRows[0].spans === spans, 'studio: later mapping replaces stale timeline bars');
}

async function testLayerDoubleClick(page) {
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/layers.js'), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/export /g, '');
  const result = await page.evaluate((source) => {
    let selected = null, layers, seeks = [];
    const list = document.createElement('div');
    document.body.appendChild(list);
    layers = new Function('S', 'getSel', 'liveOn', 'selectKey', 'ensureVisible', 'seek', 'transport', 'emit', 'localStorage', 'esc', 'readView', 'writeView', source +
      '\nreturn { buildTree, renderLayersTab, LY };')(
      { name: '_row-test', draft: { tweaks: {} }, fileTweaks: {} }, () => selected, () => true,
      (key) => { selected = { key }; layers.renderLayersTab(list); }, () => {}, (t) => seeks.push(t), { playing: false }, () => {}, { getItem: () => null, setItem() {} },
      (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`), () => null, () => {},
    );
    layers.buildTree({ nodes: [
      { key: 'chip-0', group: 'chip', parent: null, kind: 'dom' },
      { key: 'chip-1', group: 'chip', parent: null, kind: 'dom' },
    ] });
    layers.LY.ready = true; layers.LY.spans = { 'chip-0': [[0.4, 0.9]] };
    layers.renderLayersTab(list);
    const row = list.querySelector('.lrow'), target = row.querySelector('.nm');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const stable = list.querySelector('.lrow') === row && row.querySelector('.nm') === target;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const selectedStyle = [...list.querySelectorAll('.lrow.sel')].length > 0;
    list.remove();
    return { stable, selectedStyle, seeks };
  }, source);
  ok(result.stable && result.selectedStyle && result.seeks[0] === 0.4, 'studio: selecting and revealing a grouped row keeps its double-click target and seeks its first span', result);
}

function testStudioZeroZ() {
  const source = fs.readFileSync(path.join(ROOT, 'apps/studio/web/src/store.js'), 'utf8');
  const start = source.indexOf('export const TWEAK_ID'), end = source.indexOf('/** Effective tweak:', start);
  const context = { same: (a, b) => a === b };
  vm.runInNewContext(source.slice(start, end).replace(/export /g, '') + '\nthis.cleanTweak = cleanTweak;', context);
  ok(context.cleanTweak({ z: 0 }).z === 0 && context.cleanTweak({ z: 0 }, { z: 60 }).z === 0, 'studio: finite z:0 remains an override with or without file tweaks');
  ok(!('z' in context.cleanTweak({ z: null })) && !('z' in context.cleanTweak({ z: Infinity })), 'studio: null resets z and nonfinite z is discarded');
}

let server, browser;
async function main() {
  testProbeRegressions();
  testApplyAddedCue();
  testApplyIdentityTweak();
  testApplyVisibleZ();
  testOpacityBase();
  testLayerDefaults();
  testStudioZeroZ();
  testTimelineLayerRefresh();
  await testLayerTreeRefresh();
  await testSpanScheduling();
  testVisibility();
  await testShots();
  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'runner/cli.js'), 'serve', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', (d) => { buf += d; if (/gfx serve: http/.test(buf)) res(); });
    server.on('exit', () => rej(new Error('serve exited early')));
    setTimeout(() => rej(new Error('serve timeout')), 30000);
  });
  const base = `http://127.0.0.1:${port}`;

  console.log('gfx serve');
  const ping = await fetch(base + '/__gfx/ping');
  const pj = await ping.json();
  ok(pj.ok === true && pj.root === ROOT, 'ping -> { ok, root }', pj);
  ok(ping.headers.get('access-control-allow-origin') === '*', 'ping has CORS *');

  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: FLAGS, defaultViewport: null });
  const rowPage = await browser.newPage();
  await testLayerDoubleClick(rowPage);
  await rowPage.close();
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`${base}/runner/player/index.html?scene=${SCENE}&capture=1`);
  await page.evaluate(() => window.__gfx.ready);
  const seek = (t) => page.evaluate((x) => window.__gfx.seek(x), t);
  const setTw = (o) => page.evaluate((x) => window.__gfx.setTweaks(x), o);
  const bnd = (...k) => page.evaluate((x) => window.__gfx.bounds(x), k);
  const pick = (x, y) => page.evaluate((a, b) => window.__gfx.pick(a, b), x, y);
  const shot = () => page.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: 800, height: 600 } });
  const style = (sel, prop) => page.evaluate((s, p) => getComputedStyle(document.querySelector(s))[p], sel, prop);

  console.log('registry / pick');
  const els = await page.evaluate(() => window.__gfx.elements());
  const keys = els.map((e) => e.key);
  ok(['mover', 'fader', 'still', 'scaler', 'kid', 'label', 'dup', 'dup~2', 'plain-inner', 'ball'].every((k) => keys.includes(k)), 'elements() lists named DOM + bounds objects', keys);
  ok((await page.evaluate(() => window.__gfx.warnings)).some((w) => /duplicate element name "dup"/.test(w)), 'duplicate name warns and gets ~2');
  await seek(0.5);
  let st = (await pick(90, 380)).stack;
  ok(st.map((e) => e.key).join() === '@4/0/0,plain-inner,@4', 'pick stack: unnamed span, named parent, unnamed grandparent', st.map((e) => e.key));
  ok(st[0].text === true && st[0].named === false && st[1].named === true && /^span\.tx "Plain text"/.test(st[0].label), 'pick entry text/named/label', st[0]);
  st = (await pick(440, 340)).stack;
  ok(st.map((e) => e.key).join() === 'kid,scaler', 'pick inside nested scaled parent: kid then scaler', st.map((e) => e.key));
  ok(near(st[0].bounds.w, 80, 0.5), 'kid bounds reflect the 2x ancestor scale', st[0].bounds);
  st = (await pick(210, 100)).stack; // mover at t=.5 is at x=200..300
  ok(st[0]?.key === 'mover', 'pick follows the anime-animated element', st.map((e) => e.key));
  st = (await pick(630, 130)).stack; // ball bounds at t=.5: x=610..670
  ok(st[0]?.key === 'ball' && st[0].named, 'pick hits bounds-registered object first', st);
  ok((await pick(10, 590)).stack.length === 0, 'pick on empty area -> empty stack');

  console.log('tweaks');
  await seek(0.5);
  const b0 = await bnd('mover', 'still', 'kid', 'label');
  ok(near(b0.mover.x, 200) && near(b0.still.x, 300), 'baseline bounds', b0);
  await setTw({ still: { x: 30, y: -20 } });
  let b = await bnd('still');
  ok(near(b.still.x, 330) && near(b.still.y, 30) && near(b.still.w, 100), 'x/y moves a static element by screen px', b.still);
  await setTw({ mover: { x: 10, y: 5 } });
  b = await bnd('mover');
  ok(near(b.mover.x, b0.mover.x + 10) && near(b.mover.y, b0.mover.y + 5), 'x/y composes with the anime transform', b.mover);
  await seek(1);
  b = await bnd('mover');
  ok(near(b.mover.x, 350 + 10), 'animated element keeps animating under the tweak (t=1)', b.mover);
  await seek(0.5);
  const c0 = { x: b0.mover.x + 50, y: b0.mover.y + 50 };
  await setTw({ mover: { scale: 2 } });
  b = (await bnd('mover')).mover;
  ok(near(b.w, 200) && near(b.x + b.w / 2, c0.x) && near(b.y + b.h / 2, c0.y), 'scale 2 about the visual centre (anime-translated)', b);
  await setTw({ mover: { rotate: 45 } });
  b = (await bnd('mover')).mover;
  ok(near(b.w, 141.42, 0.2) && near(b.x + b.w / 2, c0.x) && near(b.y + b.h / 2, c0.y), 'rotate 45 turns in place (bbox 141, same centre)', b);
  ok(near((await pick(c0.x, c0.y)).stack[0].rot, 45, 0.5), 'pick reports rot', (await pick(c0.x, c0.y)).stack[0]);
  await setTw({});
  b = (await bnd('mover')).mover;
  ok(near(b.x, 200) && near(b.w, 100), 'removing the tweak restores geometry', b);
  ok((await style('[data-gfx="mover"]', 'translate')) === 'none' && (await style('[data-gfx="mover"]', 'rotate')) === 'none', 'individual props cleared');

  await seek(0.5);
  await setTw({ fader: { opacity: 0.5 } });
  const op = async () => +(await style('[data-gfx="fader"]', 'opacity'));
  ok(near(await op(), 0.375, 0.002), 'opacity multiplies the scene value (0.75*0.5)', await op());
  await seek(1);
  ok(near(await op(), 0.25, 0.002), 'opacity follows the animation (0.5*0.5)', await op());
  await seek(1); await seek(1); await setTw({ fader: { opacity: 0.5 } });
  ok(near(await op(), 0.25, 0.002), 'opacity does not compound across repeated frames/applies', await op());
  await seek(0.5);
  ok(near(await op(), 0.375, 0.002), 'opacity back at t=0.5', await op());
  await seek(0); await seek(1);
  const directOpacity = await op(), directShot = await shot();
  await seek(0); await seek(0.5); await seek(1);
  ok(near(directOpacity, 0.25, 0.002) && near(await op(), directOpacity, 0.002), 'equal scene/tweak values: direct t=1 and via t=0.5 give opacity 0.25', { directOpacity, via: await op() });
  ok(Buffer.compare(directShot, await shot()) === 0, 'equal scene/tweak values: direct and intermediate seeks give identical screenshots');
  await seek(0);
  await setTw({ still: { opacity: 0.5 } });
  await seek(0.1); await seek(0.2); await seek(0.3);
  ok(near(+(await style('[data-gfx="still"]', 'opacity')), 0.5, 0.001), 'static element opacity stays 0.5 over many renders (WeakMap base)', await style('[data-gfx="still"]', 'opacity'));
  await setTw({});
  ok(+(await style('[data-gfx="still"]', 'opacity')) === 1 && near(+(await style('[data-gfx="fader"]', 'opacity')), 0.85, 0.002), 'opacity restored when removed (static=1, animated=scene value)');

  await seek(0);
  const k0 = (await bnd('kid')).kid;
  await setTw({ kid: { x: 30, y: 10 } });
  b = (await bnd('kid')).kid;
  ok(near(b.x - k0.x, 30) && near(b.y - k0.y, 10), 'screen-space move inside a 2x-scaled parent = requested screen px', { dx: b.x - k0.x, dy: b.y - k0.y });
  await setTw({ kid: { rotate: 90, scale: 0.5 } });
  b = (await bnd('kid')).kid;
  ok(near(b.x + b.w / 2, k0.x + k0.w / 2) && near(b.w, 40, 0.2), 'rotate+scale inside a scaled parent keeps the centre', { b, k0 });
  await setTw({});

  const orig = await page.evaluate(() => { const e = document.querySelector('[data-gfx="label"]'); return [e.textContent, e.style.color, e.style.backgroundColor]; });
  await setTw({ label: { text: 'World', color: '#ff0000', bg: '#00ff00' } });
  const lab = () => page.evaluate(() => { const e = document.querySelector('[data-gfx="label"]'); return [e.textContent, e.style.color, e.style.backgroundColor]; });
  let l = await lab();
  ok(l[0] === 'World' && l[1] === 'rgb(255, 0, 0)' && l[2] === 'rgb(0, 255, 0)', 'text/color/bg set', l);
  await seek(1.2);
  ok((await lab())[0] === 'World', 'text tweak survives re-render');
  await setTw({});
  l = await lab();
  ok(JSON.stringify(l) === JSON.stringify(orig) && l[0] === 'Hello', 'text/color/bg restored when removed', l);

  console.log('idempotency');
  const all = { mover: { x: 12, y: -7, scale: 1.3, rotate: 20, opacity: 0.8 }, kid: { x: 5, rotate: 15 }, fader: { opacity: 0.6, scale: 0.8 }, label: { text: 'Hi', color: '#fa0' }, still: { rotate: -10, y: 8 } };
  await setTw(all);
  const results = [];
  for (const t of [0.5, 1.37, 0, 0.5, 1.99, 0.5]) { await seek(t); if (t === 0.5) results.push(await shot()); }
  ok(results.length === 3 && results.every((r) => Buffer.compare(r, results[0]) === 0), 'seek A -> B -> A: identical screenshots (3 visits)');
  await setTw({});
  await seek(0.5);
  const clean = await shot();
  ok(Buffer.compare(clean, results[0]) !== 0, 'tweaked frame differs from untweaked');
  await seek(1.37); await setTw(all); await seek(0.5);
  ok(Buffer.compare(await shot(), results[0]) === 0, 'tweaks applied from another time give the same frame');
  await setTw({});
  await seek(1.37); await seek(0.5);
  ok(Buffer.compare(await shot(), clean) === 0, 'after clearing tweaks the original frame is restored exactly');

  console.log('layers (tree / spans / visible / z / view)');
  const tree = () => page.evaluate(() => window.__gfx.tree());
  const spans = (o) => page.evaluate((x) => window.__gfx.spans(x), o);
  const setView = (v) => page.evaluate((x) => window.__gfx.setView(x), v);
  const vis = (key) => page.evaluate((k) => getComputedStyle(document.querySelector(`[data-gfx="${k}"]`)).visibility, key);
  await seek(0.5);
  let tr = await tree();
  const nd = Object.fromEntries(tr.nodes.map((n) => [n.key, n]));
  ok(nd.chips.parent === null && ['chip-0', 'chip-1', 'chip-2'].every((k) => nd[k].parent === 'chips' && nd[k].depth === 1 && nd[k].group === 'chip' && nd[k].count === 3 && nd[k].kind === 'dom'), 'tree: chips group nested under chips, grouped as chip (3)', tr.nodes.map((n) => n.key + '<' + n.parent));
  ok(nd.kid.parent === 'scaler' && nd['plain-inner'].parent === null && nd['plain-inner'].named === true && nd.ball.kind === 'box' && nd.ball.parent === null, 'tree: parent = nearest named ancestor (unnamed wrappers skipped), bounds objects are boxes');
  ok(!tr.nodes.some((n) => n.key[0] === '@') && !nd.mover.group && !nd.dup.group && nd.chips.group === undefined, 'tree: only named nodes, no group on singles');
  const ix = (k) => tr.nodes.findIndex((n) => n.key === k);
  ok(ix('chips') + 1 === ix('chip-2') && ix('chip-2') < ix('chip-1') && ix('chip-1') < ix('chip-0'), 'tree: pre-order, children front-most first (DOM order reversed)');
  ok(ix('zb') < ix('za') && tr.order.indexOf('zb') < tr.order.indexOf('za') && ix('late') < ix('label') && tr.order.length === tr.nodes.length && tr.order.indexOf('chip-2') < tr.order.indexOf('chips'), 'tree: later sibling is in front; order is front-first, children before parents', tr.order);
  ok(tr.nodes.every((n) => typeof n.label === 'string' && 'depth' in n), 'tree: label/depth on every node');

  // spans
  const sp = await spans({ step: 2 });
  const stepT = 2 / 30;
  const iv = sp.spans;
  ok(sp.fps === 30 && sp.step === 2 && typeof sp.ms === 'number' && Object.keys(iv).length === tr.nodes.length, 'spans: { fps, step, spans, ms } covering every tree node', { fps: sp.fps, ms: sp.ms });
  ok(iv.late.length === 1 && near(iv.late[0][0], 1, stepT) && near(iv.late[0][1], 2, stepT), 'spans: hidden-then-shown element starts at its reveal (1 s) and runs to the end', iv.late);
  ok(iv.mover.length === 1 && near(iv.mover[0][0], 0, stepT) && near(iv.mover[0][1], 2, stepT), 'spans: always visible element is one full interval', iv.mover);
  ok(iv.fader.length === 1 && iv.ball.length === 1, 'spans: opacity>0.01 and bounds objects counted');
  const covers = (key, t) => iv[key].some(([a, b]) => a <= t && t < b);
  ok(['clip-circle', 'clip-child'].every((k) => !covers(k, 0.5) && covers(k, 1.2) && near(iv[k][0][0], 1, stepT)), 'spans: circle(0) hides own paint and descendants until opening', { circle: iv['clip-circle'], child: iv['clip-child'] });
  ok(['clip-tiny', 'clip-inset-y', 'clip-inset-x', 'clip-polygon'].every((k) => iv[k].length === 0), 'spans: tiny circle, empty percent/px insets and collinear polygon hide all paint');
  ok(covers('clip-bowtie', 0.5), 'spans: self-intersecting polygon with cancelling signed area stays visible');
  ok(['empty-inner', 'empty-outer'].every((k) => !covers(k, 0.5) && covers(k, 1.2) && !covers(k, 1.8)) && near(iv['empty-outer'][0][0], 1, stepT), 'spans: unpainted nested containers union named children bottom-up and intersect own visibility', { outer: iv['empty-outer'], inner: iv['empty-inner'] });
  ok(covers('empty-leaf', 0.5) && covers('painted-parent', 0.5) && iv['painted-child'].length === 0, 'spans: unpainted leaves retain box rule; painted parents retain their own visibility');
  const cached = await spans({ step: 2 });
  ok(cached.cached === true && JSON.stringify(cached.spans) === JSON.stringify(iv), 'spans: cached by scene + tweak signature');
  await setTw({ late: { opacity: 0 } });
  const sp0 = await spans({ step: 2 });
  ok(sp0.cached !== true && sp0.spans.late.length === 0, 'spans: tweak change invalidates the cache (opacity 0 -> never visible)', sp0.spans.late);
  await setTw({ late: { visible: false } });
  ok((await spans({ step: 2 })).spans.late.length === 1, 'spans: ignore the visible tweak (show the scene timing)');
  await setTw({});

  // determinism: spans must not disturb the current frame
  await setTw({ mover: { x: 12, scale: 1.2 }, still: { visible: false } });
  await setView({ hidden: ['label'] });
  await seek(0.8);
  const beforeSp = await shot();
  await spans({ step: 3 });
  ok(Buffer.compare(beforeSp, await shot()) === 0, 'spans: frame, tweaks and view unchanged afterwards (same pixels, same t)');
  ok((await vis('still')) === 'hidden' && (await vis('label')) === 'hidden', 'spans: tweak/view state still applied afterwards');
  await setView({});
  await setTw({});

  // visible
  await seek(0.5);
  const clean2 = await shot();
  ok((await pick(350, 100)).stack[0]?.key === 'still', 'pick finds the element before hiding it');
  await setTw({ still: { visible: false } });
  ok((await vis('still')) === 'hidden' && !(await pick(350, 100)).stack.some((e) => e.key === 'still'), 'visible:false hides the element (not pickable either)');
  ok(Buffer.compare(clean2, await shot()) !== 0, 'visible:false changes the pixels');
  await seek(1.5); await seek(0.5);
  ok((await vis('still')) === 'hidden', 'visible:false survives re-render');
  await setTw({});
  ok((await vis('still')) === 'visible' && Buffer.compare(clean2, await shot()) === 0, 'removing visible:false restores visibility and the exact frame');

  // z
  const topAt = async () => (await pick(710, 460)).stack[0]?.key;
  ok((await topAt()) === 'zb', 'z overlap: later sibling is on top by default');
  await setTw({ za: { z: 5 } });
  ok((await topAt()) === 'za', 'z: 5 brings the earlier sibling to the front (pick returns it)');
  tr = await tree();
  ok(tr.nodes.findIndex((n) => n.key === 'za') < tr.nodes.findIndex((n) => n.key === 'zb') && tr.order.indexOf('za') < tr.order.indexOf('zb'), 'tree order reflects the z tweak');
  const zShot = await shot();
  await setTw({ zb: { z: 9 }, za: { z: 5 } });
  ok((await topAt()) === 'zb', 'z: higher z wins');
  await setTw({ za: { z: 5 } });
  await seek(1.3); await seek(0.5);
  ok(Buffer.compare(zShot, await shot()) === 0, 'z: A->B->A pixel-identical');
  await setTw({});
  ok((await topAt()) === 'zb' && (await style('[data-gfx="za"]', 'zIndex')) === 'auto' && (await style('[data-gfx="za"]', 'position')) === 'absolute', 'removing z restores z-index and position');
  ok(Buffer.compare(clean2, await shot()) === 0, 'frame identical to before the z tweak');

  // view
  await setView({ hidden: ['mover', 'chip-1'] });
  ok((await vis('mover')) === 'hidden' && (await vis('chip-1')) === 'hidden' && (await vis('chip-0')) === 'visible' && (await vis('still')) === 'visible', 'view.hidden hides exactly the listed keys');
  const viewShot = await shot();
  await seek(1.6); await seek(0.5);
  ok(Buffer.compare(viewShot, await shot()) === 0 && (await vis('mover')) === 'hidden', 'view: A->B->A pixel-identical');
  await setView({ solo: 'chip-1' });
  const allVis = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-gfx]')].map((e) => [e.dataset.gfx, getComputedStyle(e).visibility])));
  ok(allVis['chip-1'] === 'visible' && allVis.chips === 'visible' && allVis['chip-0'] === 'hidden' && allVis['chip-2'] === 'hidden' && allVis.mover === 'hidden' && allVis.kid === 'hidden' && allVis.label === 'hidden', 'view.solo renders only the element and its ancestors', allVis);
  await setView({ hidden: ['mover'], solo: 'mover' });
  ok((await vis('mover')) === 'hidden', 'explicitly hidden wins over solo');
  await setView({ solo: 'kid' });
  const kidVis = await page.evaluate(() => [document.querySelector('[data-gfx="scaler"]'), document.querySelector('[data-gfx="kid"]'), document.querySelector('[data-gfx="mover"]')].map((e) => getComputedStyle(e).visibility));
  ok(kidVis.join() === 'visible,visible,hidden', 'solo of a nested element keeps its ancestors', kidVis);
  await setView({});
  const afterView = await page.evaluate(() => [...document.querySelectorAll('*')].filter((e) => e.style.visibility).length);
  ok(afterView === 0 && Buffer.compare(clean2, await shot()) === 0, 'view {} clears every override (no inline visibility left, exact frame)');
  await setView({ hidden: ['gone-view'] });
  ok((await page.evaluate(() => window.__gfx.warnings)).some((w) => /view key "gone-view"/.test(w)), 'unresolved view key warns, never throws');
  await setView({ hidden: ['still'] }); await setTw({ still: { visible: false } }); await setView({});
  ok((await vis('still')) === 'hidden', 'view and visible tweak are independent layers');
  await setTw({});
  ok((await vis('still')) === 'visible', 'both removed -> visible');

  console.log('values / path (§7)');
  await testValuesPathRegressions(page);
  {
    const vals = (keys, t) => page.evaluate((k, x) => window.__gfx.values(k, x), keys, t);
    const path = (o) => page.evaluate((x) => window.__gfx.path(x), o);
    const dispT = () => page.evaluate(() => document.querySelector('[data-gfx="vx-move"]').getBoundingClientRect().left);
    await setTw({});
    await seek(0.9);
    const vs = await vals(['vx-move', 'vx-rot', 'vx-sc', 'vx-fade', 'vx-rk', 'vx-css', 'ball', 'nope'], 0.5);
    const p1 = (a, b, e = 1) => Math.abs(a - b) <= e;
    ok(!('nope' in vs) && vs['vx-move'].visible === true, 'values: unresolved keys omitted');
    ok(p1(vs['vx-move'].cx, 370) && p1(vs['vx-move'].cy, 560) && p1(vs['vx-move'].scaleX, 1, 0.01) && p1(vs['vx-move'].rotate, 0, 0.5), 'values: anime translateX 0->200 at t=0.5 gives cx 370', vs['vx-move']);
    ok(p1(vs['vx-rot'].rotate, 45, 0.5) && p1(vs['vx-rot'].cx, 510) && p1(vs['vx-rot'].cy, 560), 'values: anime rotate 0->90 at 0.5 gives 45 deg about the centre', vs['vx-rot']);
    ok(p1(vs['vx-sc'].scaleX, 3, 0.01) && p1(vs['vx-sc'].scaleY, 3, 0.01) && p1(vs['vx-sc'].cx, 600) && p1(vs['vx-sc'].cy, 520), 'values: scale 1.5 inside a 2x parent -> accumulated 3', vs['vx-sc']);
    ok(p1(vs['vx-fade'].opacity, 0.5, 0.01), 'values: opacity fade 1->0 at 0.5', vs['vx-fade']);
    ok(p1(vs['vx-rk'].rotate, 90, 0.5) && p1(vs['vx-rk'].cx, 325) && p1(vs['vx-rk'].cy, 440) && p1(vs['vx-rk'].opacity, 0.25, 0.01) && p1(vs['vx-rk'].w, 10) && p1(vs['vx-rk'].h, 20), 'values: child of a rotated (90) parent: centre, accumulated rotation, opacity product, AABB', vs['vx-rk']);
    ok(p1(vs['vx-css'].rotate, 30, 0.5) && p1(vs['vx-css'].scaleX, 1.5, 0.01) && p1(vs['vx-css'].cx, 430), 'values: CSS individual translate/rotate/scale props are included', vs['vx-css']);
    ok(vs.ball.cx === 600 + 0.5 * 20 + 30 && vs.ball.scaleX === 1 && vs.ball.visible, 'values: bounds-registered object (centre from bounds, scale/rotate from tweak)', vs.ball);
    ok(Math.abs((await dispT()) - 430) < 1, 'values(t): the displayed frame (0.9 s) is restored afterwards');
    // against getBoundingClientRect (bounds): rotated and unrotated alike (AABB of the quad)
    const bb = await bnd('vx-move', 'vx-rot', 'vx-sc', 'vx-rk', 'vx-css');
    const v09 = await vals(['vx-move', 'vx-rot', 'vx-sc', 'vx-rk', 'vx-css']);
    ok(Object.keys(bb).every((k) => p1(v09[k].x, bb[k].x, 0.6) && p1(v09[k].y, bb[k].y, 0.6) && p1(v09[k].w, bb[k].w, 0.6) && p1(v09[k].h, bb[k].h, 0.6)), 'values: AABB of the accumulated-matrix quad matches getBoundingClientRect (rotated and not)', { v: v09['vx-rot'], b: bb['vx-rot'] });
    const vt = await vals(['vx-fade'], 1.2);
    ok(vt['vx-fade'].opacity === 0 && vt['vx-fade'].visible === false, 'values: faded out -> opacity 0, visible false');
    // tweaks reflected
    await setTw({ 'vx-move': { x: 30, y: -10, rotate: 45, scale: 2 }, 'vx-sc': { x: 10 } });
    const vtw = await vals(['vx-move', 'vx-sc'], 0.5);
    ok(p1(vtw['vx-move'].cx, 400) && p1(vtw['vx-move'].cy, 550) && p1(vtw['vx-move'].rotate, 45, 0.5) && p1(vtw['vx-move'].scaleX, 2, 0.01), 'values: tweak x/y/rotate/scale reflected', vtw['vx-move']);
    ok(p1(vtw['vx-sc'].cx, 610) && p1(vtw['vx-sc'].scaleX, 3, 0.01), 'values: tweak x on a child of a 2x parent is screen px', vtw['vx-sc']);
    await setTw({});
    // perf: values call
    const vms = await page.evaluate(() => { const t = performance.now(); return window.__gfx.values(['vx-sc']).then(() => performance.now() - t); });
    ok(vms < 5, `values call < 5 ms (${vms.toFixed(1)} ms)`);

    // path
    await seek(0.8);
    const pa = await path({ key: 'vx-move', from: 0, to: 2 });
    ok(pa.fps === 30 && pa.step === 1 && pa.samples.length === 61 && typeof pa.ms === 'number' && pa.samples[0].quad.length === 4, 'path: { fps, step, samples (frame step), ms }', { n: pa.samples.length, ms: pa.ms });
    const at = (t) => pa.samples.find((x) => Math.abs(x.t - t) < 1e-6);
    ok(Object.entries({ 0.4: 0.4, 1: 1, 1.5: 1.5 }).every(([t]) => { const x = at(+t); return p1(x.cx, 270 + 200 * Math.min(+t, 1)) && p1(x.cy, 560); }), 'path: samples follow translate 0->200 then rest');
    const vAt = await vals(['vx-rot', 'vx-sc'], 0.4);
    const pr = await path({ key: 'vx-rot', from: 0.3, to: 0.5 });
    const pr4 = pr.samples.find((x) => Math.abs(x.t - 0.4) < 1e-6);
    ok(pr4.cx === vAt['vx-rot'].cx && pr4.rotate === vAt['vx-rot'].rotate && pr4.opacity === vAt['vx-rot'].opacity, 'path: samples match values at the same t', { pr4, v: vAt['vx-rot'] });
    const ps = await path({ key: 'vx-sc', from: 0.3, to: 0.5 });
    const ps4 = ps.samples.find((x) => Math.abs(x.t - 0.4) < 1e-6);
    ok(ps4.scaleX === vAt['vx-sc'].scaleX && ps4.cx === vAt['vx-sc'].cx && ps4.quad.length === 4, 'path: nested-scale samples match values');
    const pl = await path({ key: 'late', from: 0, to: 2 });
    ok(pl.samples.filter((x) => x.t < 0.95).every((x) => !x.visible) && pl.samples.filter((x) => x.t > 1.05).every((x) => x.visible) && pl.samples.length === 61, 'path: invisible stretch is flagged (gap), visible after reveal');
    const pd = await path({ key: 'late' });
    ok(near(pd.samples[0].t, 1, 0.1) && near(pd.samples.at(-1).t, 2, 0.1), 'path: default range = visibility span envelope', { a: pd.samples[0].t, b: pd.samples.at(-1).t });
    const pc = await path({ key: 'vx-move', from: 0, to: 2 });
    ok(pc.cached === true && pc.samples.length === 61, 'path: cached by key + range + step + tweak signature');
    await setTw({ 'vx-move': { x: 25 } });
    const pt = await path({ key: 'vx-move', from: 0, to: 2 });
    ok(pt.cached !== true && p1(pt.samples.find((x) => Math.abs(x.t - 1) < 1e-6).cx, 495), 'path: cache invalidated by a tweak change and reflects it', pt.samples[30]);
    await setTw({ 'vx-move': { visible: false } });
    ok((await path({ key: 'vx-move', from: 0.5, to: 0.6 })).samples.every((x) => x.visible), 'path: visible:false tweak ignored while sampling (like spans)');
    await setTw({});
    const pw = await path({ key: 'vx-move', from: 0, to: 2, step: 7 });
    ok(pw.step === 7 && pw.samples.length === 9, 'path: step is honoured (frames)', pw.samples.length);
    // displayed t / playhead unaffected
    await seek(0.8);
    const beforeP = await shot();
    await path({ key: 'vx-rot', from: 0, to: 2, step: 3 });
    ok(Buffer.compare(beforeP, await shot()) === 0, 'path: frame unchanged afterwards (displayed t restored)');
    const rejected = await page.evaluate(() => window.__gfx.path({ key: 'nope' }).then(() => false, () => true));
    ok(rejected, 'path: unknown key rejects');
    ok(pa.ms < 400, `path of one element, 2 s @30: ${pa.ms} ms`);
  }

  console.log('layers on _reel-test');
  const rp = await browser.newPage();
  await rp.setViewport({ width: 1080, height: 1920 });
  await rp.goto(`${base}/runner/player/index.html?scene=_reel-test&capture=1`);
  await rp.evaluate(() => window.__gfx.ready);
  const rt = await rp.evaluate(() => window.__gfx.tree());
  const rn = Object.fromEntries(rt.nodes.map((n) => [n.key, n]));
  ok(rn.phone && rn.total && rn.logo && rn.phone.parent === null && rn.total.parent === null && rn.logo.parent === 'lockup' && rn.lockup.parent === 'end' && rn['phone-screen'].parent === 'phone', '_reel-test tree: phone/total/logo with sensible parents', { phone: rn.phone?.parent, total: rn.total?.parent, logo: rn.logo?.parent });
  ok(rn['chip-0'].group === 'chip' && rn['chip-0'].count === 4, '_reel-test tree: chip-0..3 grouped');
  const rsp = await rp.evaluate(() => { const t = performance.now(); return window.__gfx.spans({ step: 2 }).then((r) => ({ ...r, wall: Math.round(performance.now() - t) })); });
  console.log(`  spans _reel-test 15 s @60 step 2: ${rsp.ms} ms (wall ${rsp.wall} ms)`);
  ok(rsp.spans.logo.length >= 1 && near(rsp.spans.logo[0][0], 12.92, 0.1) && near(rsp.spans.logo.at(-1)[1], 15, 0.1), '_reel-test spans: logo starts at its reveal (12.92 s) and runs to the end', rsp.spans.logo);
  ok(rsp.spans.total.length >= 1 && rsp.spans.total[0][0] > 5 && rsp.spans.total[0][0] < 8 && rsp.spans.phone[0][0] < 3, '_reel-test spans: phone early, total mid-reel', { total: rsp.spans.total, phone: rsp.spans.phone });
  const reelCovers = (key, t) => rsp.spans[key].some(([a, b]) => a <= t && t < b);
  ok(!reelCovers('flood-main', 0.5) && [1.5, 1.6, 1.7, 1.8].some((t) => reelCovers('flood-main', t)), '_reel-test spans: flood-main closed at 0.5 s, visible during first flood', rsp.spans['flood-main']);
  ok(!reelCovers('tagline', 2), '_reel-test spans: tagline follows its overflow-clipped named words', rsp.spans.tagline);
  ok(!reelCovers('end', 2), '_reel-test spans: end is invisible at 2 s', rsp.spans.end);
  ok(rsp.ms < 3000, '_reel-test spans under 3 s', rsp.ms);
  {
    const t0r = await rp.evaluate(() => window.__gfx.seek(4.2));
    const sp = rsp.spans.total[0];
    const pth = await rp.evaluate((a, b) => { const t = performance.now(); return window.__gfx.path({ key: 'total', from: a, to: b }).then((r) => ({ ...r, wall: Math.round(performance.now() - t) })); }, sp[0], sp[1]);
    const vis = pth.samples.filter((x) => x.visible);
    const span = (f) => Math.max(...vis.map(f)) - Math.min(...vis.map(f));
    console.log(`  path total over its span (${pth.samples.length} samples): ${pth.ms} ms (wall ${pth.wall} ms)`);
    ok(vis.length > 10 && (span((x) => x.cx) > 2 || span((x) => x.cy) > 2 || span((x) => x.scaleX) > 0.02 || span((x) => x.opacity) > 0.05) && vis.every((x) => Number.isFinite(x.cx) && x.cx > -2000 && x.cx < 3000), '_reel-test path: total returns plausible motion over its span', { n: vis.length });
    const dflt = await rp.evaluate(() => window.__gfx.path({ key: 'total' }));
    ok(dflt.samples.length > 10 && dflt.samples[0].t >= rsp.spans.total[0][0] - 0.1, '_reel-test path: default range from the span envelope');
    ok(pth.ms < 400 || pth.samples.length > 180, `_reel-test path under 400 ms (${pth.ms} ms for ${pth.samples.length} samples)`);
  }
  await rp.close();

  console.log('warnings');
  await setTw({ nope: { x: 5 }, '@9/9': { y: 1 } });
  await seek(0.2); await seek(0.3);
  const w1 = await page.evaluate(() => window.__gfx.warnings.slice());
  ok(w1.filter((w) => /"nope"/.test(w)).length === 1 && w1.filter((w) => /"@9\/9"/.test(w)).length === 1, 'unresolved keys warn once, never throw', w1);
  await setTw({ plain: { x: 1 } }); // no such name
  await setTw({});

  console.log('preview page (scaled root)');
  const pv = await browser.newPage();
  await pv.setViewport({ width: 500, height: 400 });
  await pv.goto(`${base}/runner/player/index.html?scene=${SCENE}`);
  await pv.evaluate(() => window.__gfx.ready);
  await pv.evaluate(() => window.__gfx.seek(0));
  const pst = await pv.evaluate(() => { const r = document.getElementById('gfx-root').getBoundingClientRect(); return { w: r.width, p: window.__gfx.pick(100, 100), bb: window.__gfx.bounds(['still']) }; });
  ok(pst.w < 790 && pst.p.stack[0]?.key === 'mover' && near(pst.bb.still.x, 300, 0.2) && near(pst.bb.still.w, 100, 0.2), 'pick/bounds are in scene px even when the preview root is CSS-scaled', pst);
  await pv.close();

  console.log('bridge');
  // talk to the bridge from a parent page via an iframe
  const host = await browser.newPage();
  await host.setContent('<body style="margin:0"><iframe id="f" width="800" height="600" style="border:0"></iframe></body>');
  await host.evaluate((src) => new Promise((res) => {
    window.__msgs = [];
    addEventListener('message', (e) => window.__msgs.push(e.data));
    const f = document.getElementById('f');
    f.onload = () => res();
    f.src = src;
  }), `${base}/runner/player/bridge.html?scene=${SCENE}`);
  await host.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), { timeout: 20000 });
  const rpc = (msg) => host.evaluate((m) => new Promise((res) => {
    const id = 'r' + Math.random();
    const h = (e) => { if (e.data && e.data.id === id) { removeEventListener('message', h); res(e.data); } };
    addEventListener('message', h);
    document.getElementById('f').contentWindow.postMessage({ id, ...m }, '*');
  }), msg);
  const ready = await host.evaluate(() => window.__msgs.find((m) => m.type === 'ready'));
  ok(ready.meta && ready.meta.width === 800, 'bridge sends ready { meta }');
  let r = await rpc({ type: 'seek', t: 0.5 });
  ok(r.type === 'reply' && r.ok, 'seek replies', r);
  r = await rpc({ type: 'tweaks', tweaks: { still: { x: 40 } } });
  r = await rpc({ type: 'bounds', keys: ['still', 'mover'] });
  ok(r.ok && near(r.result.still.x, 340) && near(r.result.mover.x, 200), 'bridge tweaks + bounds', r.result);
  r = await rpc({ type: 'pick', x: 90, y: 380 });
  ok(r.ok && r.result.stack[0].key === '@4/0/0', 'bridge pick', r.result);
  r = await rpc({ type: 'elements' });
  ok(r.ok && r.result.some((e) => e.key === 'mover'), 'bridge elements', r.result.length);
  r = await rpc({ type: 'calib', key: 'kid' });
  ok(r.ok && r.result.sx === 1 && r.result.sy === 1, 'bridge calib');
  const burst = await host.evaluate(() => new Promise((res) => {
    const f = document.getElementById('f').contentWindow, ids = [], out = {};
    const h = (e) => { if (e.data && ids.includes(e.data.id)) { out[e.data.id] = e.data; if (Object.keys(out).length === ids.length) { removeEventListener('message', h); res(out); } } };
    addEventListener('message', h);
    for (let i = 0; i < 20; i++) { const id = 'b' + i; ids.push(id); f.postMessage({ id, type: 'seek', t: i / 20 }, '*'); }
  }));
  ok(Object.values(burst).length === 20 && Object.values(burst).every((m) => m.ok), 'coalesced seek burst: all 20 replied');
  r = await rpc({ type: 'bounds', keys: ['mover'] });
  ok(near(r.result.mover.x, 50 + 300 * 0.95, 0.2), 'last seek of the burst is the drawn frame', r.result);
  r = await rpc({ type: 'tree' });
  ok(r.ok && r.result.nodes.some((n) => n.key === 'chip-1' && n.group === 'chip') && Array.isArray(r.result.order), 'bridge tree', r.result.nodes.length);
  r = await rpc({ type: 'spans', step: 2 });
  ok(r.ok && r.result.spans.late.length === 1 && near(r.result.spans.late[0][0], 1, 2 / 30) && typeof r.result.ms === 'number', 'bridge spans', r.result.spans && r.result.spans.late);
  r = await rpc({ type: 'values', keys: ['vx-move', 'late'], t: 0.5 });
  ok(r.ok && near(r.result['vx-move'].cx, 370, 1) && r.result.late.visible === false, 'bridge values', r.result);
  r = await rpc({ type: 'path', key: 'vx-move', from: 0, to: 1 });
  ok(r.ok && r.result.samples.length === 31 && near(r.result.samples[30].cx, 470, 1) && typeof r.result.ms === 'number', 'bridge path', r.result.samples && r.result.samples.length);
  const frameVis = async (k) => (await rpc({ type: 'pick', x: 350, y: 100 })).result.stack.some((e) => e.key === k);
  await rpc({ type: 'seek', t: 0.5 });
  r = await rpc({ type: 'view', hidden: ['still'], solo: null });
  ok(r.ok && !(await frameVis('still')), 'bridge view hides (pick skips it)');
  r = await rpc({ type: 'view' });
  ok(r.ok && (await frameVis('still')), 'bridge view {} clears');
  r = await rpc({ type: 'tweaks', tweaks: { still: { visible: false } } });
  ok(r.ok && !(await frameVis('still')), 'bridge tweaks accept visible:false');
  await rpc({ type: 'tweaks', tweaks: {} });
  r = await rpc({ type: 'nope' });
  ok(r.ok === false && /unknown/.test(r.error), 'unknown message type -> error reply');
  await host.close();

  console.log('tweaks.json (file layer)');
  const tpath = path.join(SC, 'tweaks.json');
  const baseline = path.join(REV, 'baseline.png');
  const withT = path.join(REV, 'with-tweaks.png');
  fs.mkdirSync(REV, { recursive: true });
  cli('still', SCENE, '--t', '0.5', '--out', baseline);
  wr(tpath, { still: { x: 100 } });
  cli('still', SCENE, '--t', '0.5', '--out', withT);
  ok(Buffer.compare(fs.readFileSync(baseline), fs.readFileSync(withT)) !== 0, 'gfx still honours scenes/<scene>/tweaks.json');
  const pg2 = await browser.newPage();
  await pg2.setViewport({ width: 800, height: 600 });
  await pg2.goto(`${base}/runner/player/index.html?scene=${SCENE}&capture=1`);
  await pg2.evaluate(() => window.__gfx.ready);
  const fb = await pg2.evaluate(async () => { await window.__gfx.seek(0.5); return window.__gfx.bounds(['still']); });
  ok(near(fb.still.x, 400), 'running gfx serve picks up a newly created tweaks.json (capture page)', fb);
  const viaFile = await pg2.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: 800, height: 600 } });
  ok(Buffer.compare(viaFile, fs.readFileSync(withT)) === 0, 'CLI still == page frame with the same file tweaks');
  await pg2.evaluate(async () => { await window.__gfx.setTweaks({ still: { x: -100 } }); });
  const live = await pg2.evaluate(() => window.__gfx.bounds(['still']));
  ok(near(live.still.x, 200), 'live layer merges on top of the file layer (per property)', live);
  await pg2.close();
  fs.rmSync(tpath);
  cli('still', SCENE, '--t', '0.5', '--out', withT);
  ok(Buffer.compare(fs.readFileSync(baseline), fs.readFileSync(withT)) === 0, 'removing tweaks.json restores the original still');

  console.log('gfx review');
  const iso = (m) => new Date(Math.floor((Date.now() - 86400000) / 60000) * 60000 + m * 60000).toISOString().replace(/\.\d+Z$/, 'Z'); // yesterday + m minutes
  const comments = {
    version: 1, scene: SCENE,
    comments: [
      { id: 'c1', t: 1.2, frame: 36, x: 540, y: 210, el: 'still', cue: null, text: 'make it bigger', strokes: [{ tool: 'arrow', color: '#ff4d6d', width: 6, pts: [[1, 1], [2, 2]] }],
        attachments: [{ kind: 'frame', path: 'shots/c1-frame.jpg' }, { kind: 'markup', path: 'shots/c1.png' }, { kind: 'image', path: 'shots/c1-img1.png', name: 'p.png' }],
        status: 'open', reply: null, created: iso(0), updated: iso(0) },
      { id: 'c2', t: 0.5, frame: 15, x: null, y: null, el: null, cue: 'pop-1', text: 'sound too loud', strokes: [], attachments: [], status: 'open', reply: null, created: iso(1), updated: iso(1) },
      { id: 'c3', t: 0.9, frame: 27, x: 10, y: 20, el: null, cue: null, text: 'old', strokes: [], attachments: [], status: 'resolved', reply: 'fixed', created: iso(2), updated: iso(2) },
    ],
  };
  wr(path.join(REV, 'comments.json'), comments);
  wr(path.join(REV, 'draft.json'), {
    version: 1, scene: SCENE, base: { cuesMtime: 1 },
    stems: { ui: { gain: -3 } }, cues: { 'pop-1': { gain: -6 } }, add: [{ id: 'add-1', t: 1, sound: 'chime', gain: -4 }], notes: [],
    tweaks: { still: { x: 50, scale: 1.5 }, label: { text: 'Draft' } },
  });
  let out = cli('review', SCENE);
  const lines = out.split('\n');
  ok(/^c2 +00\.50 f15 +@- cue=pop-1 +"sound too loud"/.test(lines[0]), 'review lists open comments sorted by t (timeline-only first)', lines[0]);
  ok(/^c1 +01\.20 f36 +@\(540,210\) el=still +"make it bigger"/.test(lines[1]), 'review line format', lines[1]);
  const att = lines.slice(2, 5).join('\n');
  ok(att.indexOf('markup: ' + path.join(REV, 'shots/c1.png')) >= 0 && att.indexOf('markup:') < att.indexOf('frame:'), 'attachments absolute, markup first', att);
  ok(!out.includes('c3 ') && /audio: 1 stem, 1 cue override, 1 added cue/.test(out) && /tweak still: x=50 scale=1.5/.test(out) && /tweak label: text="Draft"/.test(out), 'resolved hidden; pending draft summary', out);
  out = cli('review', SCENE, '--all');
  ok(/c3 .*\[resolved\]/.test(out) && /reply: fixed/.test(out), '--all includes resolved + reply');
  const js = JSON.parse(cli('review', SCENE, '--json'));
  ok(js.comments.length === 2 && path.isAbsolute(js.comments[1].attachments[0].path) && js.draft.tweaks.still.x === 50, '--json raw objects with absolute paths');

  cli('review', SCENE, '--resolve', 'c1', '--reply', 'made it 1.5x');
  let cj = rd(path.join(REV, 'comments.json'));
  const c1 = cj.comments.find((c) => c.id === 'c1');
  ok(c1.status === 'resolved' && c1.reply === 'made it 1.5x' && Date.parse(c1.updated) > Date.parse(iso(0)), '--resolve sets status/reply/updated');
  ok(!cli('review', SCENE).includes('c1 '), 'resolved comment leaves the default list');
  cli('review', SCENE, '--wontfix', 'c2', '--reply', 'not now');
  cj = rd(path.join(REV, 'comments.json'));
  ok(cj.comments.find((c) => c.id === 'c2').status === 'wontfix', '--wontfix');
  cli('review', SCENE, '--reopen', 'c1');
  cj = rd(path.join(REV, 'comments.json'));
  ok(cj.comments.find((c) => c.id === 'c1').status === 'open', '--reopen');
  let threw = false;
  try { cli('review', SCENE, '--resolve', 'c99'); } catch { threw = true; }
  ok(threw, 'unknown id fails');

  // merge-on-write: a newer external edit survives a stale write; a stale tombstone cannot resurrect; a newer tombstone hides
  const disk = rd(path.join(REV, 'comments.json'));
  const c2n = { ...disk.comments.find((c) => c.id === 'c2'), text: 'edited by studio', updated: new Date(Date.now() + 60000).toISOString() };
  wr(path.join(REV, 'comments.json'), { ...disk, comments: disk.comments.map((c) => (c.id === 'c2' ? c2n : c)) });
  const stale = { ...c2n, text: 'stale write', updated: iso(5) };
  RV.writeComments(SCENE, [stale, { id: 'c4', t: 1, text: 'new', status: 'open', updated: iso(7) }]);
  cj = rd(path.join(REV, 'comments.json'));
  ok(cj.comments.find((c) => c.id === 'c2').text === 'edited by studio' && cj.comments.some((c) => c.id === 'c4'), 'merge keeps the newer entry and adds new ids');
  cli('review', SCENE, '--resolve', 'c4');
  const mid = rd(path.join(REV, 'comments.json'));
  wr(path.join(REV, 'comments.json'), { ...mid, comments: mid.comments.map((c) => (c.id === 'c2' ? { ...c, text: 'concurrent edit', updated: new Date(Date.now() + 120000).toISOString() } : c)) });
  cli('review', SCENE, '--reopen', 'c4');
  cj = rd(path.join(REV, 'comments.json'));
  ok(cj.comments.find((c) => c.id === 'c2').text === 'concurrent edit' && cj.comments.find((c) => c.id === 'c4').status === 'open', 'CLI write preserves a concurrent edit to another comment');
  RV.writeComments(SCENE, [{ id: 'c3', deleted: true, updated: new Date(Date.now() + 1000).toISOString() }]);
  ok(!cli('review', SCENE, '--all').includes('c3 '), 'tombstone hides the comment');
  RV.writeComments(SCENE, [{ ...comments.comments[2], updated: iso(30) }]);
  ok(rd(path.join(REV, 'comments.json')).comments.find((c) => c.id === 'c3').deleted === true, 'older live copy cannot resurrect a tombstone');

  console.log('gfx review --stills');
  cli('review', SCENE, '--reopen', 'c1');
  out = cli('review', SCENE, '--stills');
  const exact = path.join(REV, 'shots', 'c1-exact.png');
  ok(fs.existsSync(exact) && out.includes('exact: ' + exact), '--stills renders and lists <id>-exact.png', out);
  ok(!fs.existsSync(path.join(REV, 'shots', 'c2-exact.png')), 'no still for timeline-only comments');
  const prev = rd(path.join(REV, 'draft.json'));
  const stillsRef = path.join(REV, 'ref.png');
  // reference: same frame with draft tweaks via the live page API
  const pg3 = await browser.newPage();
  await pg3.setViewport({ width: 800, height: 600 });
  await pg3.goto(`${base}/runner/player/index.html?scene=${SCENE}&capture=1`);
  await pg3.evaluate(() => window.__gfx.ready);
  await pg3.evaluate(async (tw) => { await window.__gfx.setTweaks(tw); await window.__gfx.seek(36 / 30); }, prev.tweaks);
  fs.writeFileSync(stillsRef, await pg3.screenshot({ type: 'png', optimizeForSpeed: true, captureBeyondViewport: false, clip: { x: 0, y: 0, width: 800, height: 600 } }));
  await pg3.close();
  ok(Buffer.compare(fs.readFileSync(exact), fs.readFileSync(stillsRef)) === 0, 'exact still == frame with draft tweaks applied');

  console.log('gfx apply');
  wr(tpath, { still: { x: 100, y: 5 }, mover: { scale: 2 }, label: { color: '#fff' } });
  wr(path.join(SC, 'sound.json'), { stems: { ui: { mute: true }, hits: { gain: -2 } }, cues: { 'pop-1': { pitch: 2 } }, add: [{ id: 'add-0', t: 0.1, sound: 'pop' }] });
  wr(path.join(REV, 'draft.json'), {
    version: 1, scene: SCENE, base: { cuesMtime: 1 },
    stems: { ui: { gain: -3 } }, cues: { 'pop-1': { gain: -6 } }, add: [{ id: 'add-1', t: 1, sound: 'chime', gain: -4 }], notes: [],
    tweaks: { still: { y: 0, scale: 2 }, mover: { scale: 1 }, label: { text: 'Draft' }, kid: { x: 4 } },
  });
  const cBefore = fs.readFileSync(path.join(REV, 'comments.json'), 'utf8');
  out = cli('apply', SCENE, '--tweaks');
  let tj = rd(tpath);
  ok(JSON.stringify(tj.still) === '{"x":100,"scale":2}' && !('mover' in tj) && tj.label.color === '#fff' && tj.label.text === 'Draft' && tj.kid.x === 4, 'apply --tweaks merges per key; identity values drop the key', tj);
  let dj = rd(path.join(REV, 'draft.json'));
  ok(!('tweaks' in dj) && dj.stems.ui.gain === -3 && dj.base.cuesMtime === 1, 'applied tweaks removed from draft, audio untouched (--tweaks only)', dj);
  ok(!fs.readFileSync(path.join(SC, 'sound.json'), 'utf8').includes('"gain": -3'), '--tweaks leaves sound.json alone');
  out = cli('apply', SCENE);
  let sj = rd(path.join(SC, 'sound.json'));
  ok(sj.stems.ui.mute === true && sj.stems.ui.gain === -3 && sj.stems.hits.gain === -2 && sj.cues['pop-1'].pitch === 2 && sj.cues['pop-1'].gain === -6 && sj.add.length === 2 && sj.add[1].id === 'add-1', 'apply folds stems/cues/add into sound.json (merged, appended by id)', sj);
  dj = rd(path.join(REV, 'draft.json'));
  ok(Object.keys(dj.stems).length === 0 && Object.keys(dj.cues).length === 0 && dj.add.length === 0 && dj.base.cuesMtime === 1, 'audio edits cleared from the draft');
  ok(/re-run/.test(out) || /nothing/.test(out), 'apply says what to re-run / nothing to do', out);
  ok(fs.readFileSync(path.join(REV, 'comments.json'), 'utf8') !== '' && rd(path.join(REV, 'comments.json')).comments.length === JSON.parse(cBefore).comments.length, 'comments untouched');
  out = cli('apply', SCENE);
  ok(/nothing in draft/.test(out), 'second apply is a no-op');
  const re = rd(path.join(REV, 'draft.json'));
  sj = rd(path.join(SC, 'sound.json'));
  ok(sj.add.length === 2, 'no duplicate add entries after re-apply');
  wr(path.join(REV, 'draft.json'), { cues: { 'add-1': { gain: -12, t: 1.5, mute: true } } });
  cli('apply', SCENE);
  sj = rd(path.join(SC, 'sound.json'));
  const added = resolveCues([], sj).cues.find((c) => c.id === 'add-1');
  ok(added.gain === -12 && added.t === 1.5 && sj.add.find((c) => c.id === 'add-1').mute && added.sound === 'chime' && !sj.cues['add-1'], 'apply merges overrides into an already applied added cue, preserving its sound');
  ok(Object.keys(rd(path.join(REV, 'draft.json')).cues).length === 0, 'added-cue overrides are cleared only after applying');
  void re;
}

try { await main(); }
catch (e) { fail++; console.log('FAIL (exception)', e && e.stack || e); }
finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (server) server.kill('SIGTERM'); } catch {}
  for (const f of fs.readdirSync(SC)) if (!sceneFilesBefore.has(f)) fs.rmSync(path.join(SC, f), { recursive: true, force: true });
  if (!outExisted) fs.rmSync(OUT, { recursive: true, force: true });
  else fs.rmSync(REV, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
