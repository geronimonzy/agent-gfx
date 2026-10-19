// Vite plugin: serves audio files to the headless/dev page for sample cues.
// GET /@gfx-audio?src=<library-relative, project-relative or absolute path>. Only audio files in the library or inside a folder
// registered in library/sources.json are served (realpath-checked, so symlinks/.. cannot escape).
import fs from 'node:fs';
import path from 'node:path';
import { resolveSrc, isAllowedAudioPath } from './config.js';

const MIME = { '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.aif': 'audio/aiff', '.aiff': 'audio/aiff', '.m4a': 'audio/mp4', '.opus': 'audio/ogg' };

export function gfxAudioPlugin() {
  return {
    name: 'gfx-audio',
    configureServer(server) {
      server.middlewares.use('/@gfx-audio', (req, res) => {
        const src = new URL(req.url, 'http://x').searchParams.get('src');
        const abs = src ? resolveSrc(src) : '';
        if (!src || !isAllowedAudioPath(abs)) { res.statusCode = src && fs.existsSync(abs) ? 403 : 404; return res.end('not served'); }
        res.setHeader('content-type', MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
        res.setHeader('cache-control', 'no-store');
        fs.createReadStream(abs).pipe(res);
      });
    },
  };
}
