// Min/max peak pyramid for AudioBuffers; queries are per-pixel-column and mono-combined across channels.
const BASE = 128, STEP = 4, LEVELS = 4;
const cache = new WeakMap();

export function peaksOf(buf) {
  if (!buf) return null;
  let p = cache.get(buf);
  if (p) return p;
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const n = L.length;
  const levels = [];
  const nb = Math.ceil(n / BASE);
  const mn = new Float32Array(nb), mx = new Float32Array(nb);
  let peak = 0;
  for (let b = 0; b < nb; b++) {
    let lo = 0, hi = 0;
    const e = Math.min(n, (b + 1) * BASE);
    for (let i = b * BASE; i < e; i++) {
      const a = L[i], c = R[i];
      if (a < lo) lo = a;
      if (a > hi) hi = a;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    mn[b] = lo; mx[b] = hi;
    if (-lo > peak) peak = -lo;
    if (hi > peak) peak = hi;
  }
  levels.push({ block: BASE, mn, mx });
  for (let l = 1; l < LEVELS; l++) {
    const pm = levels[l - 1], m = Math.ceil(pm.mn.length / STEP);
    const a = new Float32Array(m), b = new Float32Array(m);
    for (let i = 0; i < m; i++) {
      let lo = 0, hi = 0;
      for (let j = i * STEP; j < Math.min(pm.mn.length, (i + 1) * STEP); j++) {
        if (pm.mn[j] < lo) lo = pm.mn[j];
        if (pm.mx[j] > hi) hi = pm.mx[j];
      }
      a[i] = lo; b[i] = hi;
    }
    levels.push({ block: pm.block * STEP, mn: a, mx: b });
  }
  p = { sr: buf.sampleRate, n, L, R, levels, peak };
  cache.set(buf, p);
  return p;
}

/** Fill mn/mx[0..cols) for time window [t0, t1). Columns outside the buffer are 0/0. Returns samples per column. */
export function query(p, t0, t1, cols, mn, mx) {
  const spp = ((t1 - t0) * p.sr) / cols, s0 = t0 * p.sr;
  let lv = null;
  for (const l of p.levels) if (l.block * 2 <= spp) lv = l;
  for (let i = 0; i < cols; i++) {
    const a = Math.floor(s0 + i * spp), b = Math.max(a + 1, Math.floor(s0 + (i + 1) * spp));
    let lo = 0, hi = 0;
    if (b > 0 && a < p.n) {
      if (lv) {
        const ba = Math.max(0, Math.floor(a / lv.block)), bb = Math.min(lv.mn.length, Math.ceil(b / lv.block));
        for (let j = ba; j < bb; j++) {
          if (lv.mn[j] < lo) lo = lv.mn[j];
          if (lv.mx[j] > hi) hi = lv.mx[j];
        }
      } else {
        const e = Math.min(p.n, b);
        for (let j = Math.max(0, a); j < e; j++) {
          const x = p.L[j], y = p.R[j];
          if (x < lo) lo = x;
          if (x > hi) hi = x;
          if (y < lo) lo = y;
          if (y > hi) hi = y;
        }
      }
    }
    mn[i] = lo; mx[i] = hi;
  }
  return spp;
}
