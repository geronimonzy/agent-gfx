// Unit tests for the sound tweak window logic (docs/SOUND-TWEAK.md). Run: node apps/studio/web/src/soundtweak-core.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import * as T from './soundtweak-core.js';

test('length maps to dur or decay', () => {
  assert.equal(T.lengthKey('whoosh'), 'dur');
  assert.equal(T.lengthKey('sample'), 'dur');
  assert.equal(T.lengthKey('pop'), 'decay');
  assert.equal(T.nominalDur({ sound: 'whoosh', variant: 'zip' }), 0.26);
  assert.equal(T.nominalDur({ sound: 'swoosh' }), 0.8);
  const rs = T.rows({ id: 'a', sound: 'impact', pitch: 0, gain: -3, pan: 0 });
  assert.deepEqual(rs.map((x) => x.k), ['pitch', 'decay', 'attack', 'bright', 'reverb', 'gain', 'pan', 'intensity']);
  assert.equal(rs.find((x) => x.k === 'decay').auto, true);
  assert.equal(T.fieldValue('reverb', 0), undefined);
  assert.equal(T.fieldValue('decay', 3), undefined);
  assert.equal(T.fieldValue('decay', 0.4), 0.4);
});

test('Mutate is repeatable, small and stored as parameters', () => {
  const cue = { id: 'pop-3', sound: 'pop', pitch: 2, gain: -6, pan: 0 };
  const a = T.mutate(cue), b = T.mutate({ ...cue });
  assert.deepEqual(a, b, 'same state -> same mutation');
  assert.ok(Math.abs(a.pitch - 2) <= 1.5 && Math.abs(a.gain + 6) <= 1.5);
  assert.ok(a.bright === undefined || Math.abs(a.bright) <= 0.2);
  assert.ok(!('seed' in a));
  const c = T.mutate({ ...cue, ...a });
  assert.notDeepEqual(c, a, 'a mutated state mutates further');
  const w = T.mutate({ id: 'w', sound: 'whoosh', variant: 'zip', gain: 0, pitch: 0, pan: 0 });
  assert.ok(w.dur >= 0.26 * 0.85 - 1e-9 && w.dur <= 0.26 * 1.15 + 1e-9 && !('pan' in w) && w.intensity >= 0.35);
  assert.deepEqual(T.vary({ seed: 2 }), { seed: 3 });
  assert.deepEqual(T.vary({}), { seed: 1 });
});

test('Replace ranking with taste', () => {
  assert.equal(T.soundKey({ sound: 'impact', variant: 'thud' }), 'synth:impact/thud');
  assert.equal(T.soundKey({ sound: 'sample', src: 'a/b.ogg', start: 0.5 }), 'sample:a/b.ogg#0.5');
  const hist = [{ from: 'synth:pop', to: 'synth:click', at: '1' }, { from: 'synth:pop', to: 'synth:click', at: '2' }, { from: 'synth:pop', to: 'synth:tick', at: '3' }];
  assert.deepEqual(T.taste(hist, 'synth:pop', 'synth:click'), { n: 2, boost: 0.4 });
  assert.deepEqual(T.pastChoices(hist, 'synth:pop').map((x) => [x.to, x.n]), [['synth:click', 2], ['synth:tick', 1]]);
  const ranked = T.rankWithTaste([{ key: 'synth:tick', score: 0.5 }, { key: 'synth:click', score: 0.35 }, { key: 'synth:tick', score: 0.1 }], hist, 'synth:pop');
  assert.deepEqual(ranked.map((x) => x.key), ['synth:click', 'synth:tick']);
  assert.deepEqual(T.patchOfKey('synth:impact/thud'), { sound: 'impact', variant: 'thud' });
  assert.deepEqual(T.patchOfKey('sample:x.ogg#1.5', 'ui'), { sound: 'sample', src: 'x.ogg', start: 1.5, stem: 'ui' });
});

test('review fixes: neutral clears a base value, one replacement transform, placement, Vary', () => {
  const base = { attack: 0.2, bright: 0.5, reverb: 0.3, decay: 0.4 };
  assert.deepEqual(T.clearFor(base, { attack: undefined, bright: 0, reverb: 0.1, decay: undefined, gain: -3 }), { attack: 0, bright: 0, reverb: 0.1, decay: 0, gain: -3 });
  assert.deepEqual(T.clearFor({}, { attack: undefined, bright: 0 }), { attack: undefined, bright: undefined }, 'no base value: drop the override');
  assert.deepEqual(T.clearFor(undefined, { pitch: 1 }), { pitch: 1 });
  const q = { id: 'a', sound: 'impact', variant: 'thud', intensity: 0.8, gain: -2, t: 1 };
  assert.deepEqual(T.replaced(q, { sound: 'pop' }), { id: 'a', sound: 'pop', gain: -2, t: 1 }, 'audition = what Use applies');
  assert.equal(T.replacementPatch(q, { sound: 'pop' }).variant, undefined);
  assert.equal(T.replaced({ sound: 'sample', src: 'x', dur: 0.3 }, { sound: 'click' }).dur, undefined);
  assert.ok(!T.canVary('ding') && !T.canVary('chime') && !T.canVary('sample') && T.canVary('impact') && T.canVary('pop'));
});
