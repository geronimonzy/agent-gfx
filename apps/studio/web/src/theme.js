// Resolve semantic CSS tokens for canvas and xterm. CSS consumers use var() directly.
const cache = new Map();
let context;
export function clearTokens() { cache.clear(); }
if (typeof window !== 'undefined') window.addEventListener('theme', clearTokens);

export function tok(name, scope = document.documentElement) {
  const key = name.startsWith('--') ? name : `--${name}`;
  const root = scope === document.documentElement;
  if (root && cache.has(key)) return cache.get(key);
  const value = getComputedStyle(scope).getPropertyValue(key).trim();
  if (!value) throw new Error(`Unknown theme token: ${key}`);
  let resolved = value;
  // xterm accepts hex/rgb, not oklch or color-mix. Resolve once through the browser's sRGB canvas.
  if (CSS.supports('color', value)) {
    context ||= document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const bytes = [...context.getImageData(0, 0, 1, 1).data];
    if (bytes[3] === 255) bytes.pop();
    resolved = '#' + bytes.map((n) => n.toString(16).padStart(2, '0')).join('');
  }
  if (root) cache.set(key, resolved);
  return resolved;
}

export function setTheme(theme) {
  if (theme !== 'dark' && theme !== 'light') throw new TypeError(`Unknown theme: ${theme}`);
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent('theme', { detail: { theme } }));
}
