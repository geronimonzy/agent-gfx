// Compare roots: WSL UNC roots and Linux roots reduce to the Linux path (case significant); native Windows
// drive paths compare case-insensitively with forward slashes. Twin of normalize_server_root in lib.rs.
export function normalizeServerRoot(root) {
  const s = root.trim().replace(/\\/g, '/');
  const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const wsl = s.replace(/^\/\/\?\/UNC\//, '//');
  const unc = wsl.match(/^\/\/(?:wsl\.localhost|wsl\$)\/[^/]+(?:\/(.*))?$/i);
  if (unc || (wsl.startsWith('/') && !wsl.startsWith('//'))) {
    const path = (unc ? `/${(unc[1] || '').replace(/^\/+/, '')}` : wsl).replace(/\/+$/, '');
    const drive = path.match(/^\/mnt\/([a-z])(?:\/(.*))?$/i);
    // Rust's /mnt/ prefix is case significant; only the drive and Windows path are folded.
    if (path.startsWith('/mnt/') && drive) return lower(`${drive[1]}:/${drive[2] || ''}`).replace(/\/+$/, '');
    return path || '/';
  }
  const native = s.replace(/^\/\/\?\//, '');
  if (/^[a-z]:/i.test(native)) return lower(native).replace(/\/+$/, '');
  throw new Error(`unsupported project root ${root}`);
}
export const otherServerError = (root) => `port 5199 serves ${root}; stop it or select that project`;
