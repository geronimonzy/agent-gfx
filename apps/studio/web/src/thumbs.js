// Thumbnail strip: ~1 frame per 0.5 s, generated progressively by seeking a hidden video. Cached per scene.
import { emit } from './store.js';

export const thumbs = { items: [], h: 0, w: 0, step: 0.5, key: null };
let token = 0;

export async function generateThumbs(key, url, duration, aspect, step = 0.5, h = 88) {
  const my = ++token;
  thumbs.items = []; thumbs.key = key; thumbs.step = step; thumbs.h = h; thumbs.w = Math.round(h * aspect);
  if (!url) return;
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; }).catch(() => {});
  if (my !== token || !v.videoWidth) return;
  const n = Math.max(1, Math.ceil(duration / step));
  for (let i = 0; i < n; i++) {
    if (my !== token) return;
    const t = Math.min(duration - 0.01, i * step + step / 2);
    await new Promise((res) => { v.onseeked = res; v.currentTime = t; });
    const c = document.createElement('canvas');
    c.width = thumbs.w; c.height = thumbs.h;
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    thumbs.items[i] = c;
    if (i % 3 === 2 || i === n - 1) emit('thumbs');
  }
  v.removeAttribute('src'); v.load();
}
export const cancelThumbs = () => { token++; thumbs.items = []; };
