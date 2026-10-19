import path from 'node:path';
import { defineConfig } from 'vite';
import { gfxAudioPlugin } from './runner/lib/library/serve.js';
import { gfxPingPlugin } from './runner/lib/ping.js';
import { gfxProjectPlugin } from './runner/lib/project-vite.js';
import { ENGINE } from './runner/lib/paths.js';

// Dev-server config. root = the project (the CLI passes it; = this repo for the repo's own scenes). Engine files
// (runner/, style/ fallback, node_modules) are mapped in by gfxProjectPlugin. `gfx export` passes its own inline config.
export default defineConfig({
  // Pre-bundle up front so a late dependency discovery never reloads the page mid-capture.
  // (gfxProjectPlugin turns the optimizer off for projects outside the engine.)
  optimizeDeps: { include: ['three', 'animejs'], entries: ['runner/player/*.html'] }, // don't crawl apps/ for deps
  // out/ and library/ change constantly (renders, review files); never watch them.
  server: { fs: { strict: false }, watch: { ignored: ['**/out/**', '**/library/**'] } },
  plugins: [
    gfxProjectPlugin(), // engine vs project (docs/FOUNDATION.md §1); no-op when root == engine
    gfxAudioPlugin(), gfxPingPlugin(), // /@gfx-audio: sample cues; /__gfx/ping: liveness for the studio
    // live reload: the project's scenes/ + style/ (relative to the root) and the engine's style/ + runner/
    (await import('./runner/lib/reload.js')).gfxReloadPlugin({
      dirs: ['scenes', 'style', path.join(ENGINE, 'style'), path.join(ENGINE, 'runner', 'lib'), path.join(ENGINE, 'runner', 'player')],
    }),
  ],
  clearScreen: false,
});
