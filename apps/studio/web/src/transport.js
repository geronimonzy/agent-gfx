// Transport: ties the audio clock to the (muted) video element and runs the per-frame tick.
import { S, emit, fps, duration, clamp } from './store.js';
import { engine } from './audio.js';

let video = null, raf = 0, lastT = -1, lastCheck = 0, scrubbing = false;
// driven = false while Live shows the scene: the hidden video is then paused and only parked on the playhead once it
// rests (for frame grabs), so its decoding doesn't compete with the live scene (JOURNEYS finding 15).
let driven = true, wraps = 0, kicking = false, parked = -1, movedAt = 0;
export const transport = {
  get video() { return video; },
  get playing() { return engine.playing; },
  time: () => engine.time(),
};

export function initTransport(el) {
  video = el;
  video.muted = true;
  const loop = () => { raf = requestAnimationFrame(loop); tick(); };
  loop();
}
export function setVideoSource(url) { video.src = url || ''; video.load(); }

const frameCentre = (t) => (Math.min(Math.floor(t * fps() + 1e-6), Math.max(0, Math.round(duration() * fps()) - 1)) + 0.5) / fps();

function tick() {
  const now = performance.now();
  let t = engine.time();
  if (engine.playing) {
    const loop = S.loop.on && S.loop.b > S.loop.a;
    // seamless loop: the engine schedules the wrap on the audio clock; a wrap it couldn't schedule (b moved behind
    // the playhead, or no frame came in time) falls back to a seek
    engine.loopAt(loop ? S.loop.a : null, S.loop.b);
    if (engine.wraps !== wraps) { wraps = engine.wraps; if (driven) chase(t); }
    else if (engine.wrap) { /* wrap due within ~0.25 s */ }
    else if (loop && t >= S.loop.b) { seek(S.loop.a); t = S.loop.a; }
    else if (t >= duration() - 1e-4) { pause(); t = duration(); }
    else if (driven && now - lastCheck > 80 && !video.seeking) {
      lastCheck = now;
      // Drift control: the audio clock is master. Small drift is trimmed by nudging the video rate (no stall);
      // anything beyond 0.2 s (or a stall) falls back to a hard seek with a lead for the seek latency.
      const d = video.currentTime - t;
      if (Math.abs(d) > 0.2) { video.currentTime = Math.min(duration(), t + 0.12); video.playbackRate = S.rate; }
      else if (Math.abs(d) > 0.25 / fps()) video.playbackRate = S.rate * (1 - clamp(d * 6, -0.4, 0.4));
      else if (video.playbackRate !== S.rate) video.playbackRate = S.rate;
    }
    // the browser pauses the video when it reaches its end before the audio clock does (lead, rate nudges); a loop
    // wrap or seek moves it back, and it must run again (JOURNEYS finding 14). One play() at a time.
    if (driven && engine.playing && video.paused && !video.ended && !kicking && video.readyState >= 1 && t < duration() - 1 / fps()) {
      kicking = true;
      video.play().catch(() => {}).finally(() => { kicking = false; });
    }
  } else if (!driven && t !== parked && now - movedAt > 150 && !video.seeking) { parked = t; video.currentTime = frameCentre(t); }
  if (t !== lastT) { lastT = t; movedAt = now; emit('time', t); }
}
/** Hard-seek the playing video to t plus a lead for the seek latency. */
function chase(t) {
  video.playbackRate = S.rate;
  video.currentTime = Math.min(duration(), t + 0.5 / fps());
  lastCheck = performance.now();
}
/** Live on (false) / off (true): stop or resume driving the hidden video; resuming puts it on the playhead. */
export function setVideoDriven(on) {
  if (driven === on || !video) { driven = on; return; }
  driven = on; parked = -1;
  if (!on) { video.pause(); return; }
  const t = engine.time();
  if (engine.playing) { video.playbackRate = S.rate; video.currentTime = Math.min(duration(), t + 0.03); lastCheck = performance.now(); video.play().catch(() => {}); }
  else video.currentTime = frameCentre(t);
}

export async function play() {
  if (!S.name) return;
  await engine.play();
  const t = engine.startPos;
  if (driven) {
    video.playbackRate = S.rate;
    video.currentTime = Math.min(duration(), t + 0.03); // lead covers the seek/start latency
    lastCheck = performance.now();
    video.play().catch(() => {});
  }
  emit('transport');
}
export function pause() {
  engine.pause();
  video.pause();
  if (driven) video.currentTime = frameCentre(engine.startPos);
  emit('transport');
}
export function toggle() { return engine.playing ? pause() : play(); }

/** Seek to time t (seconds). Snaps to frame boundaries when `frame` is true. */
export function seek(t, { frame = false, blip = false } = {}) {
  t = clamp(t, 0, duration());
  if (frame) t = Math.round(t * fps()) / fps();
  engine.seek(t);
  if (driven) video.currentTime = engine.playing ? Math.min(duration(), t + 0.5 / fps()) : frameCentre(t);
  if (blip) engine.blip(t);
  lastT = -1;
}
export function step(frames) {
  if (engine.playing) pause();
  const f = Math.floor(engine.time() * fps() + 1e-6) + frames;
  seek(f / fps(), { frame: true });
}
export function beginScrub() { scrubbing = engine.playing; if (scrubbing) { engine.pause(); video.pause(); } }
export function endScrub() { if (scrubbing) { scrubbing = false; play(); } }
export function setRate(r) {
  S.rate = r;
  engine.setRate(r);
  video.playbackRate = r;
  emit('transport');
}
