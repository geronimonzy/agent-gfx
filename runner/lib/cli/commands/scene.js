// gfx new | list | dev | serve | export
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ENGINE, projectRoot, projectConfig, presetFile, urlToFile } from '../../paths.js';
import { lookPresetName } from '../../looks.js';
import { gfxEngineResolvePlugin } from '../../project-vite.js';
import { startVite } from '../capture.js';
import { die, loadMeta, num, outDir, readJson, sceneDir } from '../util.js';

export async function cmdNew(name, o) {
  if (!name) die('usage: gfx new <name> --kind <kind>');
  if (!/^[\w.-]+$/.test(name)) die('invalid scene name');
  const kind = o.kind;
  const tpl = path.join(ENGINE, 'templates', String(kind));
  if (!['three', 'canvas', 'svg', 'anime'].includes(kind) || !fs.existsSync(tpl)) die('--kind must be one of three|canvas|svg|anime');
  const dest = sceneDir(name);
  if (fs.existsSync(dest)) die(`scenes/${name} already exists`);
  fs.cpSync(tpl, dest, { recursive: true });
  const [w, h] = String(o.size || '1920x1080').split('x').map(Number);
  if (!w || !h) die('--size must look like 1920x1080');
  const base = readJson(path.join(tpl, 'scene.json'));
  const meta = {
    kind, width: w, height: h, fps: num(o.fps, 60), duration: num(o.dur, base.duration ?? 6),
    style: o.style || lookPresetName(projectRoot(), projectConfig()) || 'dark-grid', title: name, // the project look's preset first
  };
  fs.writeFileSync(path.join(dest, 'scene.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(`created scenes/${name} (${kind}, ${w}x${h}, ${meta.fps}fps, ${meta.duration}s)`);
  return [dest];
}

export async function cmdList() {
  const dir = path.join(projectRoot(), 'scenes');
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'scene.json'))) : [];
  if (!names.length) return console.log('(no scenes)');
  for (const n of names) {
    const m = readJson(path.join(dir, n, 'scene.json'));
    console.log(`${n.padEnd(24)} ${String(m.kind).padEnd(7)} ${m.width}x${m.height} @${m.fps}fps  ${m.duration}s`);
  }
}

export async function cmdDev(name, o) {
  loadMeta(name);
  const { server } = await startVite(num(o.port, 5173));
  const url = `http://127.0.0.1:${server.httpServer.address().port}/runner/player/index.html?scene=${name}`;
  console.log(`dev server: ${url}\nCtrl+C to stop`);
  await new Promise(() => {});
}

export async function cmdServe(_n, o) {
  const { server } = await startVite(num(o.port, 5199), { cacheDir: 'node_modules/.vite-gfx-serve' });
  console.log(`gfx serve: http://127.0.0.1:${server.httpServer.address().port}\nCtrl+C to stop`);
  await new Promise(() => {});
}

export async function cmdExport(name) {
  const meta = loadMeta(name);
  const build = path.join(outDir(name), '.build');
  const web = path.join(outDir(name), 'web');
  fs.rmSync(build, { recursive: true, force: true });
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(build, { recursive: true });
  const abs = (p) => JSON.stringify(p);
  const preset = presetFile(meta.style || 'dark-grid');
  const presetObj = (await import(pathToFileURL(preset).href)).default;
  // Font URLs are runtime strings Vite can't see; import each file with ?url so it is emitted as an asset.
  const fontFiles = presetObj.fontFiles || [];
  const fontPath = (u) => (u.startsWith('/') ? urlToFile(u) : path.resolve(path.dirname(preset), u));
  const fontImports = fontFiles.map((f, i) => `import font${i} from ${abs(fontPath(f.url) + '?url')};`).join('\n');
  fs.writeFileSync(path.join(build, 'entry.js'), `
${fontImports}
import { buildScene, mountPreview } from ${abs(path.join(ENGINE, 'runner/player/core.js'))};
import * as mod from ${abs(path.join(sceneDir(name), 'scene.js'))};
import meta from ${abs(path.join(sceneDir(name), 'scene.json'))};
import presetStyle from ${abs(preset)};
${fs.existsSync(path.join(sceneDir(name), 'tweaks.json')) ? `import tweaks from ${abs(path.join(sceneDir(name), 'tweaks.json'))};` : 'const tweaks = null;'}
const fontUrls = [${fontFiles.map((_, i) => `font${i}`).join(', ')}];
const style = { ...presetStyle, fontFiles: (presetStyle.fontFiles || []).map((f, i) => ({ ...f, url: fontUrls[i] })) };
const app = document.getElementById('app');
const built = await buildScene({ meta, style, mod, parent: app, tweaks });
mountPreview({ meta, style, built, container: app, controls: false });
`);
  fs.writeFileSync(path.join(build, 'index.html'), `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,">
<title>${String(meta.title || name).replace(/</g, '&lt;')}</title>
<style>html,body{margin:0;height:100%;background:${presetObj.colors?.bg || '#111111'};overflow:hidden}#app{position:fixed;inset:0;display:flex;flex-direction:column;cursor:pointer}</style>
</head><body><div id="app"></div><script type="module" src="./entry.js"></script></body></html>
`);
  const { build: viteBuild } = await import('vite');
  await viteBuild({
    root: build, configFile: false, base: './', logLevel: 'warn', clearScreen: false,
    plugins: [gfxEngineResolvePlugin(projectRoot())], // /runner/* -> engine, /style/* -> project then engine, deps -> engine
    server: { fs: { strict: false } },
    build: { outDir: web, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 4000 },
  });
  fs.rmSync(build, { recursive: true, force: true });
  const outputs = [path.join(web, 'index.html')];
  console.log(`${path.join(web, 'index.html')}\nembed (serve out/${name}/web statically):\n<iframe src="./web/index.html" width="${meta.width}" height="${meta.height}" style="border:0;max-width:100%;aspect-ratio:${meta.width}/${meta.height}" allowfullscreen></iframe>`);
  return outputs;
}

