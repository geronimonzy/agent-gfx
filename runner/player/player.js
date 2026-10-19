import { relevant } from './changes.js';
import { buildScene, exposeCapture, mountPreview } from './core.js';

const SOUND_FIXES = import.meta.glob('/scenes/*/sound.json', { import: 'default' });
const TWEAK_FILES = import.meta.glob('/scenes/*/tweaks.json', { import: 'default' });
const params = new URLSearchParams(location.search);
const name = params.get('scene');
const capture = params.get('capture') === '1';
const transparent = capture && params.get('alpha') === '1';
// `size=WxH` (render --reframe): build the scene at another size; the CLI only sends it for scenes with "responsive": true.
const sizeOverride = /^(\d+)x(\d+)$/.exec(params.get('size') || '');

async function boot() {
  const tweakLoader = TWEAK_FILES[`/scenes/${name}/tweaks.json`];
  const tweaks = tweakLoader ? await tweakLoader() : null;
  const meta = await (await fetch(`/scenes/${name}/scene.json`)).json();
  if (sizeOverride) Object.assign(meta, { width: +sizeOverride[1], height: +sizeOverride[2] });
  const style = (await import(/* @vite-ignore */ `/style/presets/${meta.style || 'dark-grid'}.js`)).default;
  const mod = await import(/* @vite-ignore */ `/scenes/${name}/scene.js`);
  const app = document.getElementById('app');

  if (capture) {
    const built = await buildScene({ meta, style, mod, parent: document.body, tweaks, transparent });
    app.remove();
    Object.assign(window.__gfx, exposeCapture({ meta, style, built, transparent }));
    return meta;
  }
  document.body.style.background = style.colors.bg;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:relative;flex:1;min-height:0;display:flex;flex-direction:column';
  app.appendChild(holder);
  const built = await buildScene({ meta, style, mod, parent: holder, tweaks });
  // import.meta.glob lists only sound.json files that exist, so a missing one never 404s in the console
  const fixLoader = SOUND_FIXES[`/scenes/${name}/sound.json`];
  const soundFix = built.cues.length && fixLoader ? await fixLoader() : null;
  mountPreview({ meta, style, built, container: holder, controls: true, soundFix });
  Object.assign(window.__gfx, { meta, cues: built.cues, ...built.api, seek: async (t) => { await built.render(t); } });
  return meta;
}

// Live code reload: the dev player just reloads (the bridge rebuilds in place); capture pages never reload.
if (!capture) import.meta.hot?.on('gfx:changed', (d) => { if (relevant(name, d.files).files.length) location.reload(); });

window.__gfx = {};
const ready = boot();
window.__gfx.ready = ready;
ready.catch((e) => { console.error(e); document.title = 'gfx error'; });
