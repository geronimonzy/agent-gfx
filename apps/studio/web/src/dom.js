// Element lookup that survives the dockable layout (docs/LAYOUT.md §2, §5): panel elements are created once and moved
// between the dock, a hidden holder, inactive tabs (detached) and popout windows (another document). `$` finds them
// wherever they are; layout.js registers the panel roots and popout documents.
const roots = new Set(), docs = new Set();

/** getElementById that also looks inside detached panel roots and popout documents. */
export function $(id) {
  const el = document.getElementById(id);
  if (el) return el;
  for (const d of docs) { const e = d.getElementById?.(id); if (e) return e; }
  const sel = '#' + CSS.escape(id);
  for (const r of roots) { if (r.id === id) return r; const e = r.querySelector(sel); if (e) return e; }
  return null;
}
export const registerRoot = (el) => { roots.add(el); };
export const registerDoc = (doc) => { if (doc && doc !== document) docs.add(doc); };
export const unregisterDoc = (doc) => { docs.delete(doc); };
/** Documents with studio UI: the main one plus open popouts. */
export const allDocs = () => [document, ...docs];
/** The focused element, wherever it is (a popout window keeps its own activeElement). */
export function activeEl() {
  for (const d of [...docs].reverse()) if (d.hasFocus?.()) return d.activeElement;
  return document.activeElement;
}

/** Effective CSS zoom of an element (per-panel scale × dev-shim UI zoom). Pointer math: (clientX - rect.left) / zoom. */
export const zoomOf = (el) => (el && el.currentCSSZoom) || 1;
/** Device pixels per CSS pixel of an element's content: canvas backing stores use this. */
export const pixelRatioOf = (el) => ((el?.ownerDocument?.defaultView || window).devicePixelRatio || 1) * zoomOf(el);
