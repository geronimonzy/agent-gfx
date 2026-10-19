// Dialog fields follow Settings until the user explicitly edits them.
export const RENDER_PREF_FIELDS = ['mode', 'quality', 'preset', 'audio', 'workers', 'frameFormat', 'outDir'];
export function applyRenderDefaults(d, prefs) {
  for (const key of RENDER_PREF_FIELDS) {
    if (d._edited?.[key]) continue;
    d[key] = key === 'preset' && prefs[key] !== 'scene' ? 'p:' + prefs[key] : prefs[key];
  }
}
