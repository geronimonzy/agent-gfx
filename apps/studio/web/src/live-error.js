// Scene errors in Live (docs/REVIEW.md §5 "Live errors"): where a bridge error points to, as text for the overlay.
// Pure (no DOM): live.js renders it, live-error.test.js covers it.

const FRAME = /((?:https?:\/\/[^/\s)]+)?\/?[\w@~.+/-]*?\.(?:m?js|css|json|html))(?:\?[^\s:)]*)?:(\d+)(?::(\d+))?/g;
const ENGINE = /^(runner|node_modules|@vite|@id|@fs)\//;

/** Stack / message -> { path, line, col } of the first frame in a project file (live-server URL, /@fs/ path or a plain
 *  project path); engine / Vite / node_modules frames are skipped. null when the error names no project file. */
export function errorLocation(text, root = '') {
  const r = String(root || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  for (const m of String(text || '').matchAll(FRAME)) {
    let p = m[1].replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '');
    if (p.startsWith('@fs/')) {
      p = p.slice(4).replace(/^\/+/, '');
      if (!r || !p.startsWith(r + '/')) continue; // a file outside the project (engine, deps)
      p = p.slice(r.length + 1);
    }
    if (!p || ENGINE.test(p) || p.startsWith('@')) continue;
    return { path: p, line: +m[2], col: +(m[3] || 1) };
  }
  return null;
}

/** First line of the error message, without the "Uncaught" / error-class noise kept by some browsers. */
export const errorText = (message) => String(message || 'scene error').split('\n')[0].replace(/^Uncaught\s+/, '').trim() || 'scene error';

/** { message, path?, line? } -> "scenes/orbit/scene.js:18" (or '' when unknown). */
export const errorWhere = (e) => (e?.path ? `${e.path}${e.line ? `:${e.line}` : ''}` : '');
