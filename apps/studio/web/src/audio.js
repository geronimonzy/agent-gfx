// Web Audio playback engine. Clock = AudioContext time; stems -> per-stem GainNode -> master.
// Each stem has an "original" buffer (WAV) and optionally a "draft" buffer (re-synthesized).
import { SAMPLE_RATE } from '@sfx';

export const engine = {
  ctx: null, master: null, stems: new Map(), // name -> { orig, draft, node, src, vol, mute, solo }
  playing: false, startCtx: 0, startPos: 0, rate: 1, mode: 'original', duration: 0,
  wrap: null, wraps: 0, // scheduled seamless loop wrap { a, b, when } / count of wraps taken (transport re-syncs the video)

  ensure() {
    if (this.ctx) return this.ctx;
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  },
  async decode(bytes) { return this.ensure().decodeAudioData(bytes.slice(0)); },
  makeBuffer(L, R) {
    const b = this.ensure().createBuffer(2, L.length, SAMPLE_RATE);
    b.copyToChannel(L, 0); b.copyToChannel(R, 1);
    return b;
  },
  reset(duration) {
    this.pause();
    for (const s of this.stems.values()) s.node.disconnect();
    this.stems.clear(); this.duration = duration; this.startPos = 0;
  },
  setStem(name, orig) {
    this.ensure();
    let s = this.stems.get(name);
    if (!s) {
      const node = this.ctx.createGain(); node.connect(this.master);
      s = { orig: null, draft: null, node, src: null, vol: 0, mute: false, solo: false };
      this.stems.set(name, s);
    }
    s.orig = orig;
    this.applyGains();
  },
  /** map: name -> AudioBuffer (draft synth); stems absent from the map use their original. */
  setDraft(map) {
    for (const [n, s] of this.stems) s.draft = map.get(n) || null;
    for (const [n, b] of map) if (!this.stems.has(n)) this.setStem(n, null), this.stems.get(n).draft = b;
    if (this.mode === 'draft') this.restart();
  },
  setMonitor(name, m) {
    const s = this.stems.get(name);
    if (s) { s.vol = m.vol; s.mute = m.mute; s.solo = m.solo; }
    this.applyGains();
  },
  applyGains() {
    if (!this.ctx) return;
    const anySolo = [...this.stems.values()].some((s) => s.solo);
    for (const s of this.stems.values()) {
      const on = anySolo ? s.solo : !s.mute;
      s.node.gain.setTargetAtTime(on ? Math.pow(10, s.vol / 20) : 0, this.ctx.currentTime, 0.008);
    }
  },
  bufferFor(name, mode = this.mode) {
    const s = this.stems.get(name);
    if (!s) return null;
    return mode === 'draft' ? s.draft || s.orig : s.orig;
  },
  setMode(mode) { if (mode === this.mode) return; this.mode = mode; this.restart(); },
  setRate(r) { const t = this.time(); this.rate = r; if (this.playing) this._begin(t); },

  latency() { return this.ctx ? Math.min(0.25, this.ctx.outputLatency || 0) : 0; },
  time() {
    if (!this.playing) return this.startPos;
    const heard = this.ctx.currentTime - this.latency();
    if (this.wrap && heard >= this.wrap.when) this._takeWrap();
    const t = this.startPos + Math.max(0, heard - this.startCtx) * this.rate;
    return Math.min(t, this.duration);
  },
  /**
   * Loop a..b without a gap: once the source position is within ~0.25 s of b, the next pass is scheduled on the audio
   * clock (old sources stop and new ones start at the exact context time of b), and time() jumps from b to a when that
   * moment is heard. A restart via seek() would hold the clock at a for the start lead + output latency (~0.1-0.3 s).
   * a == null drops a scheduled wrap (loop switched off). Too close to b to schedule: nothing (the caller seeks).
   */
  loopAt(a, b) {
    if (!this.playing) return;
    if (this.wrap && (a == null || this.wrap.a !== a || this.wrap.b !== b)) { this._begin(this.time()); return; }
    if (a == null || this.wrap) return;
    const now = this.ctx.currentTime, when = this.startCtx + (b - this.startPos) / this.rate;
    if (b <= this.startPos || when - now > 0.25 || when < now + 0.01) return;
    for (const [name, s] of this.stems) {
      if (s.src) { s.src.stop(when); s.old = s.src; s.src = null; }
      this._startSource(name, s, when, a);
    }
    this.wrap = { a, b, when };
  },
  _takeWrap() {
    const w = this.wrap;
    this.wrap = null; this.startCtx = w.when; this.startPos = w.a; this.wraps++;
    for (const s of this.stems.values()) if (s.old) { s.old.disconnect(); s.old = null; }
  },
  _stopSources() {
    for (const s of this.stems.values()) this._stopSource(s);
  },
  _stopSource(s) {
    for (const k of ['src', 'old']) {
      if (!s[k]) continue;
      try { s[k].stop(); } catch { /* already stopped */ }
      s[k].disconnect(); s[k] = null;
    }
  },
  _startSource(name, s, when, offset) {
    const buf = this.bufferFor(name);
    if (!buf || offset >= buf.duration) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = this.rate;
    src.connect(s.node); src.start(when, offset);
    s.src = src;
  },
  _begin(offset) {
    this._stopSources();
    this.wrap = null;
    const when = this.ctx.currentTime + 0.03;
    for (const [name, s] of this.stems) {
      this._startSource(name, s, when, offset);
    }
    this.startCtx = when; this.startPos = offset; this.playing = true;
  },
  async play() {
    this.ensure();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    let t = this.startPos;
    if (t >= this.duration - 1e-3) t = 0;
    this._begin(t);
  },
  pause() {
    if (!this.ctx) return;
    if (this.playing) { this.startPos = this.time(); this.playing = false; }
    this.wrap = null;
    this._stopSources();
  },
  seek(t) {
    t = Math.max(0, Math.min(this.duration, t));
    if (this.playing) this._begin(t); else this.startPos = t;
  },
  restart(name) {
    if (!this.playing) return;
    if (name == null || this.wrap) { this._begin(this.time()); return; } // a scheduled wrap spans two sources per stem
    const s = this.stems.get(name);
    if (!s) return;
    this._stopSource(s);
    // Keep this stem on the existing audio clock, including scheduled start and playback rate.
    const when = Math.max(this.ctx.currentTime + 0.03, this.startCtx);
    const offset = this.startPos + (when - this.startCtx) * this.rate;
    this._startSource(name, s, when, offset);
  },
  /** Short audible blip while scrubbing a paused timeline. */
  blip(t) {
    if (this.playing || !this.ctx || this.ctx.state !== 'running') return;
    const when = this.ctx.currentTime;
    for (const [name, s] of this.stems) {
      const buf = this.bufferFor(name);
      if (!buf || t >= buf.duration) continue;
      const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
      src.buffer = buf; src.connect(g); g.connect(s.node);
      g.gain.setValueAtTime(1, when); g.gain.linearRampToValueAtTime(0, when + 0.06);
      src.start(when, t, 0.07);
    }
  },
};
