// Element <-> code links (docs/CODE-VERSIONS.md §1): bridge `code` / `codeAt` messages, reset on reload.
// Object code regions (docs/INSPECTOR.md §1): markers, ref expansion, traced fallback, `tweakable`.
// Run: node tests/code.test.mjs   (needs /usr/bin/google-chrome or GFX_CHROME)
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { codeRegions, markerBlocks } from '../runner/player/code.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = '_code-test';
const TMP_DIR = path.join(ROOT, 'scenes', TMP);
const CHROME = process.env.GFX_CHROME || '/usr/bin/google-chrome';
const FLAGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', '--force-color-profile=srgb', '--no-sandbox', '--disable-dev-shm-usage'];
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x) : '')); } };
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lines = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
const lineAt = (ref) => lines(ref.file)[ref.line - 1] || '';

const sceneJs = (extra = '') => `import { createTimeline } from 'animejs';
let tl;
export default {
  setup(ctx) {
    ctx.root.insertAdjacentHTML('beforeend', '<div class="box" style="position:absolute;width:50px;height:50px;background:red"></div>');
    const box = ctx.el('box', ctx.root.querySelector('.box'));
    tl = createTimeline({ autoplay: false });
${extra}    tl.add(box, { translateX: [0, 100], duration: 500 }, 250);
  },
  render(t) { tl.seek(0); tl.seek(t * 1000); },
};
`;

// ---------------------------------------------------------------- pure region tests (no browser)
const fmap = (o) => new Map(Object.entries(o).map(([k, v]) => [k, v.split('\n')]));
const has = (regions, file, from, to) => regions.some((r) => r.file === file && r.from === from && r.to === to);
const covers = (regions, file, line) => regions.some((r) => r.file === file && r.from <= line && line <= r.to);
function pureTests() {
  console.log('markers');
  const js = `import x from 'y';
let a;
export default {
  setup(ctx) {
    // @gfx moon
    a = ctx.root.appendChild(document.createElement('div'));
    ctx.el('moon', a);
    // @end
    const shared = 1;
    // @gfx moon earth
    a.style.left = '0px';
    // @end
  },
  render(t) {
    // @gfx moon
    a.style.opacity = t;
    // @end
    /* @gfx sun */ a.title = 'sun'; /* @end */
  },
};`;
  const css = '.x { color: red; }\n/* @gfx moon */\n.moon { left: 0; }\n/* @end */';
  const html = '<div>\n<!-- @gfx moon -->\n<div data-gfx="moon"></div>\n<!-- @end -->\n</div>';
  const files = fmap({ 'scenes/m/scene.js': js, 'scenes/m/style.css': css, 'scenes/m/part.html': html, 'scenes/m/scene.json': '{"// @gfx moon": 1}' });
  let r = codeRegions({ files, key: 'moon' });
  ok(r.marked === true && r.regions.every((g) => g.kind === 'marked'), 'marked key -> marked: true, kind marked', r);
  ok(has(r.regions, 'scenes/m/scene.js', 5, 8) && has(r.regions, 'scenes/m/scene.js', 10, 12) && has(r.regions, 'scenes/m/scene.js', 15, 17), 'three JS blocks (setup, multi-key, render), marker lines included', r.regions);
  ok(has(r.regions, 'scenes/m/style.css', 2, 4), 'CSS /* @gfx */ block', r.regions);
  ok(has(r.regions, 'scenes/m/part.html', 2, 4), 'HTML <!-- @gfx --> block', r.regions);
  ok(r.regions.length === 5 && !r.regions.some((g) => g.file.endsWith('.json')), 'exactly 5 regions for moon (.json not scanned)', r.regions);
  ok(r.regions.every((g) => typeof g.label === 'string' && g.from >= 1 && g.to >= g.from), 'regions carry { file, from, to, kind, label }', r.regions);
  r = codeRegions({ files, key: 'earth' });
  ok(r.marked && r.regions.length === 1 && has(r.regions, 'scenes/m/scene.js', 10, 12), '`// @gfx moon earth` assigns the block to both keys', r);
  r = codeRegions({ files, key: 'sun' });
  ok(r.marked && has(r.regions, 'scenes/m/scene.js', 18, 18), 'one-line /* @gfx sun */ … /* @end */ block', r.regions);
  const blocks = markerBlocks('a.js', ['x', '// @gfx a', 'y', '// @gfx b', 'z', '// @end', 'w', '// @gfx c', 'tail']);
  ok(blocks.length === 3 && blocks[0].from === 2 && blocks[0].to === 3 && blocks[0].unterminated, 'a new @gfx ends an open block (no nesting), flagged', blocks);
  ok(blocks[1].from === 4 && blocks[1].to === 6 && !blocks[1].unterminated, 'closed block', blocks[1]);
  ok(blocks[2].from === 8 && blocks[2].to === 9 && blocks[2].unterminated, 'unterminated block runs to the end of the file', blocks[2]);
  r = codeRegions({ files: fmap({ 's/a.js': 'x\n// @gfx c\ntail\nmore' }), key: 'c' });
  ok(r.regions.length === 1 && r.regions[0].to === 4 && /unterminated/.test(r.regions[0].label), 'unterminated block labelled', r.regions);
  r = codeRegions({ files, key: 'nobody' });
  ok(r.marked === false && Array.isArray(r.regions) && r.regions.length === 0, 'unknown key -> no regions, marked false', r);

  console.log('traced fallback (three, orbit fixture)');
  const F = 'scenes/orbit/scene.js';
  const ol = fs.readFileSync(path.join(ROOT, 'tests/fixtures/code-orbit/scene.js'), 'utf8').split('\n');
  const of = new Map([[F, ol]]);
  const find = (re) => ol.findIndex((l) => re.test(l)) + 1;
  const named = find(/ctx\.el\('moon'/);
  r = codeRegions({ files: of, key: 'moon', refs: [{ kind: 'named', file: F, line: named, col: 5, snippet: '' }], node: null });
  ok(r.marked === false && r.regions.length > 3 && r.regions.length <= 40 && r.regions.filter((g) => g.kind === 'traced').length > 3
    && r.regions.every((g) => g.kind === 'traced' || (g.kind === 'ref' && g.from <= named && named <= g.to)), 'moon: traced regions (+ the named ref line), unmarked, capped', r.regions);
  ok(covers(r.regions, F, named), 'covers the ctx.el(moon) line');
  ok(covers(r.regions, F, find(/MOON_R = 0\.17/)), 'covers the MOON_R declaration');
  const mStart = find(/^\s*moon = new THREE\.Mesh\(/);
  ok(r.regions.some((g) => g.from <= mStart && g.to >= mStart + 3), 'moon = new THREE.Mesh(…) expanded to its whole statement (4 lines)', r.regions);
  ok(covers(r.regions, F, find(/moon\.position\.set/)) && covers(r.regions, F, find(/moon\.rotation\.y = m/)), 'covers the render lines that move the moon');
  ok(covers(r.regions, F, find(/^function moonTexture/)), 'one level further: moonTexture() (named like the key) is included');
  ok(!covers(r.regions, F, find(/^function earthTexture/)) && !covers(r.regions, F, find(/sunMat = new THREE\.ShaderMaterial/)), 'earth texture / sun code not included');
  ok(!covers(r.regions, F, find(/uniform float uPhase/)), 'identifiers inside strings (GLSL) are not matched');
  ok(r.tweakable.read === false && r.tweakable.props.length === 0, 'moon tweak never read -> read false', r.tweakable);
  const e = codeRegions({ files: of, key: 'earth', refs: [], node: null });
  ok(e.tweakable.read === true && e.tweakable.props.join() === 'scale', "ctx.tweak('earth').scale -> props [scale]", e.tweakable);
  const bg = codeRegions({ files: of, key: 'background', refs: [{ kind: 'named', file: F, line: find(/ctx\.el\('background'/), col: 5, snippet: '' }], node: { getAttribute: () => null } });
  ok(covers(bg.regions, F, find(/const bg = document\.createElement/)) && covers(bg.regions, F, find(/root\.appendChild\(bg\)/)), 'DOM element with only a named ref: its ctx.el argument (bg) is traced too', bg.regions);

  console.log('ref expansion (anime: markup in template literals, chains)');
  const RF = 'scenes/reel/scene.js';
  const rl = fs.readFileSync(path.join(ROOT, 'templates/projects/reel/scenes/reel/scene.js'), 'utf8').split('\n');
  const at = (re) => rl.findIndex((l) => re.test(l)) + 1;
  const exp = (line) => codeRegions({ files: new Map([[RF, rl]]), key: 'zz', refs: [{ kind: 'ref', file: RF, line }], node: { getAttribute: () => null } }).regions;
  const hl = at(/<div data-gfx="headline"/);
  ok(JSON.stringify(exp(hl).map((g) => [g.from, g.to])) === JSON.stringify([[hl, hl + 2]]), 'markup line in a template literal -> the element through its closing tag', exp(hl));
  const cap = at(/<div data-gfx="caption"/), words = at(/\$\{WORDS\.map/);
  ok(exp(cap)[0].from === cap && exp(cap)[0].to === cap && exp(words)[0].to === words, 'one-line element / ${} line stay one line (not the whole insertAdjacentHTML call)', [exp(cap), exp(words)]);
  const add = at(/\.add\('\[data-gfx="card"\]'/), chain = at(/tl = createTimeline/);
  ok(exp(add)[0].from === chain && /;\s*$/.test(rl[exp(add)[0].to - 1]), 'a chained .add() line -> its whole statement (tl = createTimeline(…)…;)', exp(add));
  const cue = at(/ctx\.cue\(1\.4/);
  ok(exp(cue)[0].from === cue && exp(cue)[0].to === cue, 'a one-line statement stays one line', exp(cue));

  console.log('tweakable');
  const tw = (src) => codeRegions({ files: fmap({ 's/a.js': src }), key: 'ball' }).tweakable;
  let t = tw("const { x, y: ty, scale = 1 } = ctx.tweak('ball');");
  ok(t.read && t.props.join() === 'x,y,scale', 'destructuring -> x, y, scale', t);
  t = tw("const tw = ctx.tweak(\"ball\");\nb.x += tw.x;\nb.r *= tw['scale'];\nb.o = tw?.opacity;");
  ok(t.read && t.props.join() === 'x,scale,opacity', "variable property reads (.x, ['scale'], ?.opacity)", t);
  t = tw("place(b, ctx.tweak('ball'));");
  ok(t.read && t.props.join() === 'x,y,scale,rotate,opacity', 'passed on as a whole -> all five', t);
  t = tw("const tw = ctx.tweak('ball');\napply(tw);");
  ok(t.read && t.props.length === 5, 'variable passed on -> all five', t);
  t = tw("// ctx.tweak('ball').x\nconst s = \"ctx.tweak('ball')\";\nctx.tweak('balloon').x;");
  ok(!t.read && t.props.length === 0, 'commented out / in a string / other key -> read false', t);
  t = tw("const { tweak } = ctx;\nb.rot = tweak('ball').rotate + tweak('ball').color.length;");
  ok(t.read && t.props.join() === 'rotate,color', 'bare tweak(): rotate, extra props listed after the five', t);
}

let server, browser;
async function open(base, scene) {
  const host = await browser.newPage();
  await host.setContent('<body style="margin:0"><iframe id="f" width="1080" height="1920" style="border:0"></iframe></body>');
  await host.evaluate((src) => new Promise((res) => {
    window.__msgs = [];
    addEventListener('message', (e) => window.__msgs.push(e.data));
    const f = document.getElementById('f');
    f.onload = () => res();
    f.src = src;
  }), `${base}/runner/player/bridge.html?scene=${scene}`);
  await host.waitForFunction(() => window.__msgs.some((m) => m.type === 'ready'), { timeout: 30000 });
  const rpc = (msg) => host.evaluate((m) => new Promise((res) => {
    const id = 'r' + Math.random();
    const h = (e) => { if (e.data && e.data.id === id) { removeEventListener('message', h); res(e.data); } };
    addEventListener('message', h);
    document.getElementById('f').contentWindow.postMessage({ id, ...m }, '*');
  }), msg);
  return { host, rpc };
}

async function main() {
  pureTests();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(path.join(TMP_DIR, 'scene.json'), JSON.stringify({ kind: 'anime', width: 400, height: 300, fps: 30, duration: 2, style: 'dark-grid' }));
  fs.writeFileSync(path.join(TMP_DIR, 'scene.js'), sceneJs());

  const port = await freePort();
  server = spawn(process.execPath, [path.join(ROOT, 'runner/cli.js'), 'serve', '--port', String(port)], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    let buf = '';
    server.stdout.on('data', (d) => { buf += d; if (/gfx serve: http/.test(buf)) res(); });
    server.on('exit', () => rej(new Error('serve exited early')));
  });
  const base = `http://127.0.0.1:${port}`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: FLAGS, defaultViewport: null });

  console.log('_reel-test `total`');
  {
    const { rpc } = await open(base, '_reel-test');
    const r = await rpc({ type: 'code', key: 'total' });
    ok(r.ok && Array.isArray(r.result.refs), 'code replies { refs }', r);
    const refs = r.result.refs;
    const kinds = refs.map((x) => x.kind);
    const order = ['named', 'defined', 'styled', 'animated', 'sound', 'ref'];
    ok(kinds.every((k, i) => i === 0 || order.indexOf(kinds[i - 1]) <= order.indexOf(k)), 'sorted named, defined, styled, animated, sound, ref', kinds);
    for (const k of ['named', 'defined', 'styled', 'animated', 'sound']) ok(kinds.includes(k), `has a "${k}" ref`);
    ok(refs.every((x) => typeof x.file === 'string' && x.line >= 1 && x.col >= 1 && typeof x.snippet === 'string'), 'every ref has file/line/col/snippet');
    ok(refs.every((x) => lineAt(x).includes(x.snippet.replace(/\.\.\.$/, ''))), 'snippet is the text of that line');
    const named = refs.find((x) => x.kind === 'named' && x.file.endsWith('_reel-test/scene.js'));
    ok(named && /ctx\.el\('total'/.test(lineAt(named)), "named ref = the ctx.el('total', ...) line", named);
    const defined = refs.find((x) => x.kind === 'defined');
    ok(defined && /class="total"/.test(lineAt(defined)), 'defined ref = the class="total" markup line', defined);
    const styled = refs.find((x) => x.kind === 'styled');
    ok(styled && /\.total\{/.test(lineAt(styled)) && styled.file.endsWith('markup.js'), 'styled ref = the .total{ rule', styled);
    const anim = refs.filter((x) => x.kind === 'animated');
    const reveal = anim.find((x) => /opacity: \[0, 1\], scale: \[0\.7, 1\]/.test(lineAt(x)));
    ok(reveal && Math.abs(reveal.t0 - 6.8) < 0.01 && Math.abs(reveal.t1 - 7.25) < 0.01 && reveal.props.includes('opacity') && reveal.props.includes('scale'), 'animated reveal 6.8 .. 7.25 s on the A(tot, ...) line (helper frame skipped)', reveal);
    const leave = anim.find((x) => /filter: \['blur\(0px\)', 'blur\(14px\)'\]/.test(lineAt(x)));
    ok(leave && Math.abs(leave.t0 - 8.0) < 0.01 && Math.abs(leave.t1 - 8.35) < 0.01, 'animated leave 8.0 .. 8.35 s', leave);
    ok(anim.every((x) => !/=>\s*tl\.add/.test(lineAt(x))), 'no ref points inside the one-line A() helper');
    ok(anim.slice(1).every((x, i) => x.t0 >= anim[i].t0), 'animated sorted by t0');
    const sound = refs.filter((x) => x.kind === 'sound');
    ok(sound.some((x) => x.cue === 'total-ding' && /cue\(dingT, 'ding'/.test(lineAt(x)) && Math.abs(x.t0 - (6.8 + 0.9 * 0.5)) < 1), 'sound ref for total-ding on the cue(...) line (not the cue helper)', sound);
    ok(sound.some((x) => /total-tick/.test(x.cue) && x.cues && x.cues.length > 3), 'tick cues grouped by call site', sound);

    const lineIdx = lines('scenes/_reel-test/scene.js').findIndex((l) => /A\(tot, \{ opacity: \[0, 1\], scale: \[0\.7, 1\]/.test(l)) + 1;
    ok(lineIdx > 0, 'found the A(tot ...) line', lineIdx);
    let q = await rpc({ type: 'codeAt', file: 'scenes/_reel-test/scene.js', line: lineIdx });
    ok(q.ok && q.result.keys.includes('total'), 'codeAt on the animated line returns total', q);
    const namedLine = lines('scenes/_reel-test/scene.js').findIndex((l) => /ctx\.el\('total'/.test(l)) + 1;
    q = await rpc({ type: 'codeAt', file: 'scenes/_reel-test/scene.js', line: namedLine });
    ok(q.ok && q.result.keys.includes('total'), 'codeAt on the ctx.el line returns total', q);
    q = await rpc({ type: 'codeAt', file: 'scenes/_reel-test/scene.js', line: 1 });
    ok(q.ok && q.result.keys.length === 0, 'codeAt on a line with no elements returns []', q);
    q = await rpc({ type: 'code', key: 'no-such-key' });
    ok(q.ok && Array.isArray(q.result.refs), 'unknown key -> refs (no crash)', q);
    ok(q.ok && Array.isArray(q.result.regions) && q.result.marked === false && q.result.tweakable?.read === false, 'unknown key -> regions [], marked false, tweakable.read false', q.result);

    // anime fallback: every ref line expanded to its statement (_reel-test has no markers)
    const { regions, marked, tweakable } = r.result;
    ok(marked === false && Array.isArray(regions) && regions.length > 0, 'total: unmarked, has regions', r.result);
    ok(regions.every((g) => ['ref', 'traced'].includes(g.kind) && g.from >= 1 && g.to >= g.from && typeof g.label === 'string'), 'regions are { file, from, to, kind, label }', regions);
    ok(refs.filter((x) => /\.(m?js|css|html)$/.test(x.file)).every((x) => regions.some((g) => g.file === x.file && g.from <= x.line && x.line <= g.to)), 'every ref line lies inside a region');
    ok(regions.some((g) => g.to > g.from), 'some refs expand to multi-line statements', regions);
    ok(regions.every((g) => g.to - g.from < 30), 'no region is longer than 30 lines', regions.map((g) => g.to - g.from + 1));
    ok(tweakable && Array.isArray(tweakable.props) && typeof tweakable.read === 'boolean', 'tweakable { props, read }', tweakable);
  }

  console.log('reload resets');
  {
    const { host, rpc } = await open(base, TMP);
    let r = await rpc({ type: 'code', key: 'box' });
    const anim0 = r.result.refs.find((x) => x.kind === 'animated');
    ok(anim0 && anim0.file === `scenes/${TMP}/scene.js` && /translateX/.test(lineAt(anim0)) && anim0.t0 === 0.25 && anim0.t1 === 0.75 && anim0.line === 8, 'temp scene: animated 0.25 .. 0.75 at line 8', anim0);
    const n = await host.evaluate(() => window.__msgs.length);
    fs.writeFileSync(path.join(TMP_DIR, 'scene.js'), sceneJs('    // two added lines\n    // here\n'));
    for (let i = 0; i < 80; i++) {
      if (await host.evaluate((k) => window.__msgs.slice(k).some((m) => m.type === 'reloaded'), n)) break;
      await sleep(50);
    }
    r = await rpc({ type: 'code', key: 'box' });
    const anim1 = r.result.refs.find((x) => x.kind === 'animated');
    ok(anim1 && anim1.line === 10 && /translateX/.test(lineAt(anim1)), 'after reload the animated ref moved to line 10 (no stale records)', anim1);
    ok(r.result.refs.filter((x) => x.kind === 'animated').length === 1, 'exactly one animated ref after reload', r.result.refs);
    r = await rpc({ type: 'codeAt', file: `scenes/${TMP}/scene.js`, line: 10 });
    ok(r.ok && r.result.keys.join() === 'box', 'codeAt follows the reload', r);
    r = await rpc({ type: 'codeAt', file: `scenes/${TMP}/scene.js`, line: 8 });
    ok(r.ok && r.result.keys.length === 0, 'old line no longer maps to elements', r);
  }

  console.log('fallback pick provenance');
  {
    fs.writeFileSync(path.join(TMP_DIR, 'scene.js'), sceneJs().replace("ctx.el('box', ctx.root.querySelector('.box'))", "ctx.root.querySelector('.box')"));
    const { rpc } = await open(base, TMP);
    const picked = await rpc({ type: 'pick', x: 10, y: 10 });
    const key = picked.result.stack.find((e) => e.key.startsWith('@'))?.key;
    ok(picked.ok && key, 'unnamed element pick returns a fallback key', picked);
    const r = await rpc({ type: 'code', key });
    ok(r.ok && ['defined', 'animated'].every((kind) => r.result.refs.some((ref) => ref.kind === kind && ref.file === `scenes/${TMP}/scene.js`)), 'code resolves the picked fallback key to its definition and animation', r);
  }

  console.log('bridge: marked blocks + virtual element tweakable');
  {
    const marked = sceneJs().replace("    const box = ctx.el('box', ctx.root.querySelector('.box'));\n",
      "    // @gfx box\n    const box = ctx.el('box', ctx.root.querySelector('.box'));\n    // @end\n    ctx.el('dot', { bounds: () => ({ x: 0, y: 0, w: 4, h: 4 }) });\n")
      .replace('  render(t) {', "  render(t, ctx) { const { x, scale } = ctx.tweak('dot');");
    fs.writeFileSync(path.join(TMP_DIR, 'scene.js'), marked);
    const { rpc } = await open(base, TMP);
    let r = await rpc({ type: 'code', key: 'box' });
    ok(r.ok && r.result.marked === true && r.result.regions.length === 1 && r.result.regions[0].from === 6 && r.result.regions[0].to === 8 && r.result.regions[0].kind === 'marked', 'code {box} -> the marked block 6..8', r.result);
    ok(Array.isArray(r.result.refs) && r.result.refs.length > 0, 'refs still sent next to the regions');
    r = await rpc({ type: 'code', key: 'dot' });
    ok(r.ok && r.result.marked === false && r.result.tweakable.read === true && r.result.tweakable.props.join() === 'x,scale', "code {dot} -> tweakable { props: [x, scale], read: true }", r.result);
    ok(r.result.regions.some((g) => g.kind === 'traced' || g.kind === 'ref'), 'dot (virtual, unmarked) -> fallback regions', r.result.regions);
  }
}

try { await main(); }
catch (e) { fail++; console.log('  FAIL exception', e && e.stack || e); }
finally {
  try { await browser?.close(); } catch {}
  try { server?.kill(); } catch {}
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
