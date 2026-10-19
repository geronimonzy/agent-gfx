// Project templates (docs/TEMPLATES.md): built-in list + metadata, init from every built-in, gfx template save / list /
// preview / remove with a temp user library (GFX_TEMPLATES), refs (id, user/<id>, folder), carried gfx.json keys.
// Run: node tests/templates.test.mjs   (the one save with a preview needs Chrome/Edge or GFX_CHROME + ffmpeg)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'runner', 'cli.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 600) : '')); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gfx-templates-test-'));
const LIB = path.join(tmp, 'library');
const cli = (args, { cwd = tmp, env = {} } = {}) => {
  const e = { ...process.env, GFX_TEMPLATES: LIB, ...env };
  delete e.GFX_PROJECT;
  if (env.GFX_PROJECT) e.GFX_PROJECT = env.GFX_PROJECT;
  if (e.GFX_TEMPLATES === '') delete e.GFX_TEMPLATES; // the default library resolution (with a temp HOME)
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const list = () => JSON.parse(cli(['template', 'list', '--json']).out.trim().split('\n').find((l) => l.startsWith('[')));
const BUILTIN = ['blank', 'promo', 'reel', 'square', 'explainer', 'sting'];

try {
  console.log('built-in templates');
  {
    const T = await import('../runner/lib/templates.js');
    const P = await import('../runner/lib/paths.js');
    const saved = process.env.GFX_TEMPLATES;
    delete process.env.GFX_TEMPLATES;
    ok(T.userTemplatesDir() === path.join(T.documentsDir(), 'gfx library', 'templates') && T.legacyTemplatesDir() === path.join(P.userDataDir(), 'templates'), 'user library defaults to <Documents>/gfx library/templates (beside looks/); the old <user data>/templates is the legacy folder');
    T.setTemplateLibrary(path.join(tmp, 'L'));
    ok(T.userTemplatesDir() === path.join(tmp, 'L', 'templates'), '--library <dir> -> <dir>/templates');
    T.setTemplateLibrary(null);
    process.env.GFX_TEMPLATES = LIB;
    ok(T.userTemplatesDir() === LIB, 'GFX_TEMPLATES sets the user library');
    if (saved === undefined) delete process.env.GFX_TEMPLATES; else process.env.GFX_TEMPLATES = saved;
    ok(T.slugId('  My Promo, v2! ') === 'my-promo-v2' && T.aspectOf(1080, 1920) === '9:16' && T.aspectOf(1080, 1080) === '1:1', 'slugId / aspectOf');
  }
  const all = list();
  ok(JSON.stringify(all.map((t) => t.ref)) === JSON.stringify(BUILTIN), 'list: the six built-ins in card order, no user templates yet', all.map((t) => t.ref));
  const by = Object.fromEntries(all.map((t) => [t.ref, t]));
  ok(by.promo.aspect === '16:9' && by.reel.aspect === '9:16' && by.square.aspect === '1:1' && by.sting.aspect === '16:9' && by.explainer.aspect === '16:9', 'aspects from the preview scene', all.map((t) => t.aspect));
  ok(BUILTIN.every((id) => by[id].source === 'builtin' && by[id].title && by[id].description), 'titles + descriptions');
  ok(BUILTIN.filter((id) => id !== 'blank').every((id) => /^data:image\/jpeg;base64,/.test(by[id].thumb) && by[id].preview === true), 'every non-blank built-in has a JPEG thumbnail and a clip');
  ok(by.blank.thumb === null && by.blank.preview === false && by.blank.width === null, 'blank: no preview');
  {
    const sizes = BUILTIN.filter((id) => id !== 'blank').map((id) => ['thumb.jpg', 'preview.mp4'].map((f) => fs.statSync(path.join(ROOT, 'templates', 'projects', id, f)).size));
    ok(sizes.every(([a, b]) => a < 64 * 1024 && b < 256 * 1024), 'previews stay small (thumb < 64 KB, clip < 256 KB)', sizes);
  }
  ok(all.every((t) => !('thumbFile' in t)), 'list JSON has no internal fields');
  {
    const r = cli(['template', 'preview', 'reel']);
    const j = JSON.parse(r.out.trim());
    const b = Buffer.from(j.data, 'base64');
    ok(r.code === 0 && j.mime === 'video/mp4' && b.subarray(4, 8).toString() === 'ftyp', 'template preview: base64 mp4');
  }

  console.log('init from every built-in');
  for (const id of BUILTIN) {
    const dest = path.join(tmp, `p-${id}`);
    const r = cli(['init', dest, '--template', id]);
    const gj = JSON.parse(fs.readFileSync(path.join(dest, 'gfx.json'), 'utf8'));
    const meta = ['template.json', 'thumb.jpg', 'preview.mp4'].filter((f) => fs.existsSync(path.join(dest, f)));
    ok(r.code === 0 && gj.name === `p-${id}` && !meta.length && fs.existsSync(path.join(dest, 'CLAUDE.md')), `${id}: project created, template meta files not copied`, { err: r.err, meta });
    if (id === 'blank') continue;
    const sc = path.join(dest, 'scenes', id);
    const sj = JSON.parse(fs.readFileSync(path.join(sc, 'scene.json'), 'utf8'));
    const js = fs.readFileSync(path.join(sc, 'scene.js'), 'utf8');
    const presetOk = ['dark-grid', 'nightfall'].includes(sj.style) || fs.existsSync(path.join(dest, 'style', 'presets', `${sj.style}.js`));
    ok(['anime', 'svg', 'canvas', 'three'].includes(sj.kind) && sj.width > 0 && sj.duration > 0 && presetOk && fs.existsSync(path.join(sc, 'STORYBOARD.md')), `${id}: scene.json valid, preset present, storyboard`, sj);
    ok(/background/.test(js) && /@gfx /.test(js) && /ctx\.cue\(|cue\(/.test(js) && !/Date\.now|performance\.now|Math\.random|requestAnimationFrame/.test(js), `${id}: named background, @gfx markers, cues, no clocks or unseeded random`);
  }

  console.log('save / list / init from user templates');
  const src = path.join(tmp, 'p-promo');
  const gj = JSON.parse(fs.readFileSync(path.join(src, 'gfx.json'), 'utf8'));
  fs.writeFileSync(path.join(src, 'gfx.json'), JSON.stringify({ ...gj, settings: { workflow: 'full' }, lookSource: { library: '/x', hash: 'y' } }, null, 2));
  fs.mkdirSync(path.join(src, 'out', 'promo'), { recursive: true });
  fs.writeFileSync(path.join(src, 'out', 'promo', 'big.bin'), 'x');
  fs.cpSync(path.join(src, 'scenes', 'promo'), path.join(src, 'scenes', 'second'), { recursive: true });
  let r = cli(['template', 'save', '--name', 'My Promo', '--description', 'Two scenes', '--no-preview', '--progress', 'json'], { env: { GFX_PROJECT: src } });
  const ev = r.out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  ok(r.code === 0 && ev.some((e) => e.type === 'progress' && e.phase === 'copy') && ev.at(-1).type === 'done' && ev.at(-1).outputs[0] === path.join(LIB, 'my-promo'), 'save (whole project): progress json, done -> library folder', r.err || ev.at(-1));
  const saved = path.join(LIB, 'my-promo');
  const tj = JSON.parse(fs.readFileSync(path.join(saved, 'template.json'), 'utf8'));
  ok(tj.title === 'My Promo' && tj.description === 'Two scenes' && tj.preview.scene === 'promo' && tj.gfx?.settings?.workflow === 'full' && !tj.gfx.lookSource && tj.from.project === 'p-promo' && tj.created, 'template.json: title, description, preview scene, carried settings (no lookSource), from', tj);
  ok(['scenes/promo/scene.js', 'scenes/second/scene.js', 'style/presets/ink.js'].every((f) => fs.existsSync(path.join(saved, f))) && !['out', 'CLAUDE.md', 'gfx.json', '.gfx', '.claude'].some((f) => fs.existsSync(path.join(saved, f))), 'saved: scenes + style; not out/, CLAUDE.md, gfx.json, .gfx, .claude');
  let u = list().find((t) => t.ref === 'user/my-promo');
  ok(u && u.source === 'user' && u.scenes.length === 2 && u.preview === false && u.thumb === null && u.aspect === '16:9', 'list: user/my-promo after the built-ins', u);
  r = cli(['template', 'save', '--name', 'My Promo', '--no-preview'], { env: { GFX_PROJECT: src } });
  ok(r.code !== 0 && /already exists/.test(r.err), 'save again: "already exists"', r.err);
  r = cli(['template', 'save', '--name', 'My Promo', '--scene', 'second', '--no-preview', '--force'], { env: { GFX_PROJECT: src } });
  u = list().find((t) => t.ref === 'user/my-promo');
  ok(r.code === 0 && u.scenes.join() === 'second' && !fs.readdirSync(LIB).some((n) => n.endsWith('.tmp')), '--force replaces (now one scene), no temp folders left', { err: r.err, u });
  r = cli(['template', 'save', '--name', 'Promo', '--no-preview'], { env: { GFX_PROJECT: src } });
  ok(r.code !== 0 && /built-in/.test(r.err), 'a built-in id is refused', r.err);
  r = cli(['template', 'save', '--id', 'Bad Id', '--no-preview'], { env: { GFX_PROJECT: src } });
  ok(r.code !== 0 && /not valid/.test(r.err), 'an invalid id is refused', r.err);
  r = cli(['template', 'save', '--scene', 'nope', '--no-preview'], { env: { GFX_PROJECT: src } });
  ok(r.code !== 0 && /not found/.test(r.err), 'an unknown scene is refused', r.err);
  r = cli(['template', 'save', '--no-preview'], { env: { GFX_PROJECT: path.join(tmp, 'p-blank') } });
  ok(r.code !== 0 && /no scenes/.test(r.err), 'a project without scenes is refused', r.err);

  const u1 = path.join(tmp, 'from-user');
  r = cli(['init', u1, '--template', 'user/my-promo']);
  const g1 = JSON.parse(fs.readFileSync(path.join(u1, 'gfx.json'), 'utf8'));
  ok(r.code === 0 && fs.existsSync(path.join(u1, 'scenes', 'second', 'scene.js')) && g1.settings?.workflow === 'full' && g1.name === 'from-user' && !fs.existsSync(path.join(u1, 'template.json')), 'init --template user/<id>: files + carried settings', { err: r.err, g1 });
  ok(/Workflow \(this project\): full/i.test(fs.readFileSync(path.join(u1, 'CLAUDE.md'), 'utf8')), 'carried settings reach the CLAUDE.md workflow line');
  r = cli(['init', path.join(tmp, 'from-bare'), '--template', 'my-promo']);
  ok(r.code === 0 && /template user\/my-promo/.test(r.out), 'a bare id finds the user template when no built-in has it', r.out);
  r = cli(['init', path.join(tmp, 'from-folder'), '--template', saved]);
  ok(r.code === 0 && fs.existsSync(path.join(tmp, 'from-folder', 'scenes', 'second')), 'init --template <folder> (a shared template folder)', r.err);
  r = cli(['init', path.join(tmp, 'x'), '--template', 'user/nope']);
  ok(r.code !== 0 && /unknown template/.test(r.err) && /user\/my-promo/.test(r.err), 'unknown ref lists the available refs', r.err);

  if (process.platform === 'linux') {
    console.log('default library in Documents, --library, legacy folder (temp HOME)');
    const H = path.join(tmp, 'home'), xdg = path.join(tmp, 'xdg'), cfg = path.join(tmp, 'cfg');
    fs.mkdirSync(path.join(H, 'Documents'), { recursive: true });
    const env = { HOME: H, XDG_DATA_HOME: xdg, XDG_CONFIG_HOME: cfg, GFX_TEMPLATES: '' };
    const where = (e = env, extra = []) => /user templates: (.*)/.exec(cli(['template', 'list', ...extra], { env: e }).out)?.[1];
    ok(where() === path.join(H, 'Documents', 'gfx library', 'templates'), 'default: <HOME>/Documents/gfx library/templates', where());
    fs.mkdirSync(cfg, { recursive: true });
    fs.writeFileSync(path.join(cfg, 'user-dirs.dirs'), 'XDG_DOCUMENTS_DIR="$HOME/Docs"\n');
    ok(where() === path.join(H, 'Docs', 'gfx library', 'templates'), 'XDG_DOCUMENTS_DIR from user-dirs.dirs', where());
    fs.rmSync(path.join(cfg, 'user-dirs.dirs'));
    ok(where(env, ['--library', path.join(tmp, 'L2')]) === path.join(tmp, 'L2', 'templates'), '--library <dir> -> <dir>/templates');
    r = cli(['template', 'save', '--name', 'In Library', '--no-preview', '--library', path.join(tmp, 'L2')], { env: { ...env, GFX_PROJECT: path.join(tmp, 'p-sting') } });
    ok(r.code === 0 && fs.existsSync(path.join(tmp, 'L2', 'templates', 'in-library', 'template.json')), 'save --library writes into <library>/templates', r.err);
    // the first build's folder (<user data>/templates): listed read-only, init works, remove refuses, nothing moved
    const old = path.join(xdg, 'gfx', 'templates', 'old-one');
    fs.cpSync(path.join(ROOT, 'templates', 'projects', 'reel'), old, { recursive: true });
    const L = JSON.parse(cli(['template', 'list', '--json'], { env }).out.trim());
    const o = L.find((t) => t.ref === 'user/old-one');
    ok(o?.legacy === true && o.source === 'user', 'legacy folder listed (user/old-one, legacy)', o);
    r = cli(['init', path.join(tmp, 'from-old'), '--template', 'user/old-one'], { env });
    ok(r.code === 0 && fs.existsSync(path.join(tmp, 'from-old', 'scenes', 'reel')), 'init from a legacy template', r.err);
    r = cli(['template', 'remove', 'user/old-one'], { env });
    ok(r.code !== 0 && /only reads/.test(r.err) && fs.existsSync(old), 'remove refuses legacy templates (folder kept)', r.err);
    // a Documents symlink loop (as on this machine) must not break saving: the home folder takes its place
    fs.rmSync(path.join(H, 'Documents'), { recursive: true });
    fs.symlinkSync(path.join(H, 'Documents'), path.join(H, 'Documents'));
    ok(where() === path.join(H, 'gfx library', 'templates'), 'Documents that is not a folder -> <HOME>/gfx library/templates', where());
  }

  console.log('preview + remove');
  r = cli(['template', 'preview', 'user/my-promo']);
  ok(r.code !== 0 && /no preview/.test(r.err), 'preview of a template without a clip: error');
  if (process.env.GFX_SKIP_CAPTURE !== '1') {
    r = cli(['template', 'save', '--name', 'Reel with preview', '--scene', 'reel', '--t', '1.5'], { env: { GFX_PROJECT: path.join(tmp, 'p-reel') } });
    const pd = path.join(LIB, 'reel-with-preview');
    const pj = JSON.parse(fs.readFileSync(path.join(pd, 'template.json'), 'utf8'));
    ok(r.code === 0 && fs.existsSync(path.join(pd, 'thumb.jpg')) && fs.existsSync(path.join(pd, 'preview.mp4')) && pj.preview.t === 1.5, 'save with preview: thumb.jpg + preview.mp4 made by the engine, t recorded', r.err);
    const t = list().find((x) => x.ref === 'user/reel-with-preview');
    ok(t?.preview && /^data:image\/jpeg/.test(t.thumb) && t.aspect === '9:16', 'listed with thumbnail + clip');
    const ls = fs.readdirSync(path.join(tmp, 'p-reel', 'out', 'reel')).filter((f) => !f.startsWith('.'));
    ok(!ls.some((f) => /\.mp4$|still/.test(f)), 'the source project keeps no preview renders in out/', ls);
  }
  r = cli(['template', 'remove', 'user/my-promo']);
  ok(r.code === 0 && !fs.existsSync(saved) && !list().some((t) => t.ref === 'user/my-promo'), 'remove user/<id>');
  r = cli(['template', 'remove', 'reel']);
  ok(r.code !== 0 && fs.existsSync(path.join(ROOT, 'templates', 'projects', 'reel')), 'built-ins cannot be removed', r.err);
  r = cli(['template', 'list', '--for', '/some/folder']);
  ok(r.code === 0 && /user templates:/.test(r.out), '--for is accepted (routing only)');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
