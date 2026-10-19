// Retime test (docs/RETIME.md): time tweaks shift/stretch/pivot in the player, ctx.clock, cue `el` links, apply identities.
// Run: node tests/retime.test.mjs   (needs /usr/bin/google-chrome or GFX_CHROME)
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { timeMap, compose, at, invert, fromMap, hasTime } from '../runner/player/retime.js';
import { resolveCues, makeCue } from '../runner/lib/sfx.js';
import * as RV from '../runner/lib/review.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENE = '_retime-test';
const CHROME = process.env.GFX_CHROME || '/usr/bin/google-chrome';
const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage'];
let pass = 0, fail = 0, server = null, browser = null;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg + (extra !== undefined ? '  ' + JSON.stringify(extra) : '')); } };
const near = (a, b, eps = 0.05) => Math.abs(a - b) <= eps;
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

function testPure() {
  console.log('time map (pure)');
  ok(!hasTime({}) && !hasTime({ pivot: 3 }) && !hasTime({ shift: 0, stretch: 1 }) && hasTime({ shift: 0.5 }) && hasTime({ stretch: 2 }), 'hasTime: identity vs active');
  const f = timeMap({ shift: 0.5 });
  ok(near(at(f, 1.5), 1.0, 1e-12), 'shift 0.5: local(1.5) = 1.0');
  const g = timeMap({ stretch: 2, pivot: 1 });
  ok(near(at(g, 1), 1, 1e-12) && near(at(g, 3), 2, 1e-12), 'stretch 2 about pivot 1: local(1)=1, local(3)=2');
  const h = timeMap({ shift: 1, stretch: 0.5, pivot: 2 });
  ok(near(at(h, 3), 2, 1e-12) && near(at(h, 3.5), 3, 1e-12), 'shift + squeeze: the pivot moves by shift');
  const c = compose(timeMap({ shift: 0.5 }), timeMap({ shift: 0.25 }));
  ok(near(at(c, 1.5), 0.75, 1e-12), 'composition: parent then child');
  ok(near(at(compose(h, invert(h)), 7.3), 7.3, 1e-12), 'invert');
  const back = fromMap(h, 2);
  ok(near(back.shift, 1, 1e-12) && near(back.stretch, 0.5, 1e-12) && back.pivot === 2, 'fromMap round trip', back);
  const k = fromMap(timeMap({ shift: 0.3, stretch: 1.5, pivot: 1 }), 4);
  ok(near(at(timeMap(k), 2.2), at(timeMap({ shift: 0.3, stretch: 1.5, pivot: 1 }), 2.2), 1e-12), 'fromMap with another pivot = same map');

  console.log('apply identities + cue links');
  ok(RV.cleanTweak({ shift: 0, stretch: 1, pivot: 2 }) === null, 'cleanTweak drops identity shift/stretch and a lone pivot');
  ok(JSON.stringify(RV.cleanTweak({ shift: 0.5, pivot: 2 })) === '{"shift":0.5,"pivot":2}', 'cleanTweak keeps an active time tweak');
  ok(RV.fmtTweak({ shift: 0.5, stretch: 1.25 }) === 'shift=0.5 stretch=1.25', 'fmtTweak prints time props');
  const cue = makeCue(1, 'pop', { el: 'logo' });
  ok(cue.el === 'logo' && makeCue(1, 'pop', {}).el === undefined, 'makeCue keeps el (only when given)');
  ok(makeCue(1, 'pop', { el: '' }).el === '' && resolveCues([], { add: [{ t: 1, sound: 'pop', id: 'logo-pop', el: '' }] }).cues[0].el === '', 'el: "" (explicitly unlinked) survives makeCue and added cues');
  const r = resolveCues([cue, makeCue(2, 'pop', { id: 'b' })], { cues: { 'pop-1': { el: '' }, b: { el: 'x' } }, add: [{ t: 3, sound: 'click', el: 'y' }] });
  const by = Object.fromEntries(r.cues.map((q) => [q.id, q]));
  ok(by['pop-1'].el === '' && by.b.el === 'x' && by['click-add1'].el === 'y', 'resolveCues: el override / unlink / added cue', r.cues.map((q) => [q.id, q.el]));
}

async function main() {
  testPure();
  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'runner/cli.js'), 'serve', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', (d) => { buf += d; if (/gfx serve: http/.test(buf)) res(); });
    server.on('exit', () => rej(new Error('serve exited early')));
    setTimeout(() => rej(new Error('serve timeout')), 30000);
  });
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: FLAGS, defaultViewport: null });
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 400 });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  await page.goto(`http://127.0.0.1:${port}/runner/player/index.html?scene=${SCENE}&capture=1`);
  await page.evaluate(() => window.__gfx.ready);
  const seek = (t) => page.evaluate((x) => window.__gfx.seek(x), t);
  const setTw = (o) => page.evaluate((x) => window.__gfx.setTweaks(x), o);
  const shot = async () => (await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 800, height: 400 } })).toString('base64');
  const state = () => page.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const cs = (s) => getComputedStyle(q(s));
    const b = window.__gfx.bounds(['mover', 'ball', 'still']);
    return {
      mover: b.mover.x, ball: b.ball.x, still: b.still.x, wrapOp: +cs('.wrap').opacity,
      parent: cs('[data-gfx="parent"]').transform, child: cs('[data-gfx="child"]').transform,
      sib: cs('[data-gfx="sib"]').transform, other: cs('[data-gfx="other"]').transform, pair: cs('.pair').transform,
      counter: q('[data-gfx="counter"]').textContent,
      px: (() => { const c = q('canvas').getContext('2d'); let x0 = -1; const d = c.getImageData(0, 30, 800, 1).data; for (let i = 0; i < 800; i++) if (d[i * 4] > 200 && d[i * 4 + 1] < 120) { x0 = i; break; } return x0; })(),
    };
  });
  const at_ = async (t) => { await seek(t); return state(); };

  console.log('baseline (no time tweaks)');
  const base = {};
  for (const t of [0.25, 0.5, 0.75, 1, 1.5, 2, 2.5]) base[t] = await at_(t);
  await seek(1); const shot0 = await shot();
  ok(near(base[1].mover, 220, 1) && near(base[0.5].mover, 20, 1), 'mover moves 20 -> 420 over 0.5..1.5', [base[0.5].mover, base[1].mover]);
  const tree = await page.evaluate(() => window.__gfx.tree().nodes.map((n) => [n.key, n.retime]));
  const tr = Object.fromEntries(tree);
  ok(tr.mover === 'auto' && tr.ball === 'clock' && tr.child === 'auto', 'tree: retime auto / clock', tree);

  console.log('shift');
  await setTw({ mover: { shift: 0.5 } });
  let s = await at_(1);
  ok(near(s.mover, base[0.5].mover, 0.5), 'mover at 1.0 = its baseline at 0.5', [s.mover, base[0.5].mover]);
  ok(near(s.wrapOp, base[0.5].wrapOp, 1e-3), 'the unnamed wrapper (scope) follows: opacity at 0.5', [s.wrapOp, base[0.5].wrapOp]);
  ok(s.still === base[1].still && s.parent === base[1].parent && s.counter === base[1].counter && s.px === base[1].px, 'everything else stays on scene time');
  s = await at_(2);
  ok(near(s.mover, base[1.5].mover, 0.5), 'mover at 2.0 = baseline at 1.5');
  await setTw({ mover: { shift: -0.5 } });
  s = await at_(0.5);
  ok(near(s.mover, base[1].mover, 0.5), 'negative shift: mover at 0.5 = baseline at 1.0');

  console.log('stretch');
  await setTw({ mover: { stretch: 2, pivot: 0.5 } });
  s = await at_(1.5);
  ok(near(s.mover, base[1].mover, 0.5), 'stretch 2 about 0.5: mover at 1.5 = baseline at 1.0', [s.mover, base[1].mover]);
  await setTw({ mover: { stretch: 0.5, pivot: 0.5, shift: 0.5 } });
  s = await at_(1.5);
  ok(near(s.mover, base[1.5].mover, 0.5), 'squeeze + shift: local(1.5) = 0.5 + (1.5 - 1.0) / 0.5 = 1.5', [s.mover, base[1.5].mover]);
  s = await at_(1.25);
  ok(near(s.mover, base[1].mover, 0.5), 'squeeze + shift: local(1.25) = 1.0', [s.mover, base[1].mover]);

  console.log('nested, text, scopes, clock');
  await setTw({ parent: { shift: 0.5 }, child: { shift: 0.25 } });
  s = await at_(1.5);
  ok(s.parent === base[1].parent, 'parent at 1.5 = baseline at 1.0', [s.parent, base[1].parent]);
  ok(s.child === base[0.75].child, 'child composes: 1.5 - 0.5 - 0.25 = 0.75', [s.child, base[0.75].child]);
  await setTw({ parent: { shift: 0.5 }, child: { shift: -0.5 } });
  s = await at_(1.5);
  ok(s.child === base[1.5].child && s.parent === base[1].parent, 'a child cancelling its parent\'s shift plays on scene time', [s.child, base[1.5].child]);
  await setTw({ parent: { shift: 0.5 } });
  s = await at_(1.5);
  ok(s.child === base[1].child, 'an un-tweaked child follows its retimed parent', [s.child, base[1].child]);
  await setTw({ counter: { shift: 1 } });
  s = await at_(2);
  ok(s.counter === base[1].counter, 'render-written text follows (counter at 2.0 = baseline 1.0)', [s.counter, base[1].counter]);
  await setTw({ sib: { shift: 0.5 } });
  s = await at_(1);
  ok(s.sib === base[0.5].sib && s.pair === base[1].pair && s.other === base[1].other, 'shared unnamed container stays on scene time; only sib moves', [s.sib, s.pair]);
  await setTw({ ball: { shift: 0.5 } });
  s = await at_(1);
  ok(near(s.ball, base[0.5].ball, 0.01) && s.px === base[0.5].px, 'ctx.clock: canvas drawing + bounds at local time', [s.ball, s.px, base[0.5].px]);

  console.log('determinism + identity');
  await setTw({ mover: { shift: 0.4 }, counter: { stretch: 1.5, pivot: 0.5 } });
  await seek(1); const a = await shot();
  await seek(2.5); await seek(0.2); await seek(1.7); await seek(1); const b = await shot();
  ok(a === b, 'retimed frame identical after a different seek history');
  await setTw({});
  await seek(1);
  ok(await shot() === shot0, 'removing the time tweaks restores identical pixels');
  await setTw({ mover: { shift: 0, stretch: 1, pivot: 2 } });
  await seek(1);
  ok(await shot() === shot0, 'identity time tweak = identical pixels');

  console.log('spans follow');
  await setTw({});
  const sp0 = (await page.evaluate(() => window.__gfx.spans({ step: 1 }))).spans.mover;
  await setTw({ mover: { shift: 0.5 } });
  const sp1 = (await page.evaluate(() => window.__gfx.spans({ step: 1 }))).spans.mover;
  ok(sp0?.length && sp1?.length && near(sp1[0][0] - sp0[0][0], 0.5, 0.07), 'mover span start moves by the shift', [sp0, sp1]);
  await setTw({});
}

main().catch((e) => { fail++; console.error(e); }).finally(async () => {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
