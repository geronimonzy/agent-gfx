// Which `gfx:changed` files matter to a page showing scene `name` (see runner/lib/reload.js).
// -> { files: relevant paths, full: true when the player code itself changed (page must reload) }
export function relevant(name, files) {
  const out = [];
  let full = false;
  for (const f of files || []) {
    const p = '/' + String(f).replace(/\\/g, '/');
    if (/\.md$/i.test(p) || /\/(out|library)\//.test(p)) continue;
    if (p.includes('/runner/player/')) { full = true; out.push(f); }
    else if (p.includes(`/scenes/${name}/`) || p.includes('/style/') || p.includes('/runner/lib/')) out.push(f);
  }
  return { files: out, full };
}
