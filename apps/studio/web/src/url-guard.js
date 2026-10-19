// URL guards for the T3 link (twin of check_post_url / check_link in src-tauri/src/claude.rs; used by the dev shim and the UI).

/** [scheme, host] using the same WHATWG URL parser as fetch; null if malformed or ambiguous. */
export function urlHost(url) {
  const s = String(url);
  // Reject separators and any authority userinfo before the parser can normalize them.
  // eslint-disable-next-line no-control-regex
  if (/[\s\\\x00-\x1f\x7f]/.test(s)) return null;
  const m = /^[^:/?#]+:\/\/([^/?#]*)/.exec(s);
  if (!m || !m[1] || m[1].includes('@')) return null;
  try {
    const u = new URL(s);
    if (!u.hostname) return null;
    return [u.protocol.slice(0, -1), u.hostname.replace(/^\[|\]$/g, '').toLowerCase()];
  } catch { return null; }
}

/** Webhook POST targets: any https:// URL, or http:// to this machine only. Throws with a readable message. */
export function checkPostUrl(url) {
  const bad = () => new Error(`only https:// URLs or http://127.0.0.1 / localhost are allowed: ${url}`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f]/.test(String(url))) throw bad();
  const h = urlHost(url);
  if (!h) throw bad();
  const [scheme, host] = h;
  if (scheme === 'https') return;
  if (scheme === 'http' && ['127.0.0.1', 'localhost', '::1'].includes(host)) return;
  throw bad();
}

/** Links the OS may open: http(s), T3 deep links (schemes starting with `t3`) and vscode://file/ | vscode://vscode-remote/wsl+ links. */
export function checkLink(url) {
  const s = String(url), bad = () => new Error(`not an http(s), t3 or vscode file link: ${url}`);
  // eslint-disable-next-line no-control-regex
  if (/[\s\x00-\x1f\x7f"]/.test(s)) throw bad();
  const i = s.indexOf(':');
  if (i <= 0 || i === s.length - 1) throw bad();
  const scheme = s.slice(0, i).toLowerCase();
  if (!/^[a-z0-9+.-]+$/.test(scheme)) throw bad();
  if (scheme === 'http' || scheme === 'https') { if (!urlHost(s)) throw bad(); return; }
  if (scheme.startsWith('t3')) return;
  // "Open in VS Code" (docs/CODE-VERSIONS.md §3): only the file / WSL-remote forms, never a command URI
  const rest = s.slice(i + 1);
  if (scheme === 'vscode' && (rest.startsWith('//file/') || rest.startsWith('//vscode-remote/wsl+')) && !rest.includes('..')) return;
  throw bad();
}
