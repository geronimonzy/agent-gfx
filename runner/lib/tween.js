import { linear } from './ease.js';

export const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, k) => a + (b - a) * k;

/** 0..1 progress of t between start and end, clamped. */
export const progress = (t, start, end) =>
  end === start ? (t >= end ? 1 : 0) : clamp((t - start) / (end - start));

const mix = (a, b, k) => (Array.isArray(a) ? a.map((v, i) => lerp(v, b[i], k)) : lerp(a, b, k));

/** Value from `from` to `to` over [start, end] seconds, shaped by `ease`. */
export const tween = (t, start, end, from, to, ease = linear) =>
  mix(from, to, ease(progress(t, start, end)));

/** keyframes(t, [{t, v, ease}]): segment i uses keyframe i+1's ease (default linear). Holds ends. */
export function keyframes(t, frames) {
  if (t <= frames[0].t) return frames[0].v;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (t > frames[i + 1].t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  return tween(t, a.t, b.t, a.v, b.v, b.ease || linear);
}

/** Start time of item i in a staggered sequence. */
export const stagger = (i, each, start = 0) => start + i * each;
