// Minimal WAV helpers: mono float32 encoder (take files). Decoding goes through decodeAudioData.
export function encodeWavF32(pcm, sr) {
  const n = pcm.length, buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 3, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 4, true);
  dv.setUint16(32, 4, true); dv.setUint16(34, 32, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
  new Float32Array(buf, 44, n).set(pcm);
  return new Uint8Array(buf);
}
/** AudioBuffer -> mono Float32Array (channel average). */
export function toMono(ab) {
  const n = ab.length, out = new Float32Array(n);
  for (let c = 0; c < ab.numberOfChannels; c++) {
    const d = ab.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ab.numberOfChannels;
  }
  return out;
}
