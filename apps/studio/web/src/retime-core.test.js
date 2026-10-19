// Unit tests for the studio retiming math (docs/RETIME.md). Run: node apps/studio/web/src/retime-core.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import * as R from './retime-core.js';
import * as E from '../../../../runner/player/retime.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);
const full = (own, G) => R.compose(G, R.timeMap(own));

test('time map matches the player', () => {
  for (const tw of [{}, { shift: 0.5 }, { stretch: 2, pivot: 1 }, { shift: -1, stretch: 0.25, pivot: 3 }, { stretch: 50 }, { pivot: 4 }]) {
    for (const t of [0, 0.7, 3.3]) near(R.at(R.timeMap(tw), t), E.at(E.timeMap(tw), t));
    assert.equal(R.hasTime(tw), E.hasTime(tw));
  }
});

test('move: the content shows delta later', () => {
  const tw = R.retimeTweak({}, R.ID, R.moveBy(0.5), 2);
  assert.deepEqual(tw, { shift: 0.5, stretch: null, pivot: null });
  near(R.at(R.timeMap(tw), 2.5), 2);
  const tw2 = R.retimeTweak({ shift: 0.5 }, R.ID, R.moveBy(-0.5), 2.5);
  assert.deepEqual(tw2, { shift: null, stretch: null, pivot: null }, 'moving back = identity');
});

test('stretch an edge keeps the other edge', () => {
  // bar shows 2..4; drag the end to 6 -> 2..6 (stretch 2), content at 2 stays at 2
  const A = R.stretchAbout(2, 4, 6);
  const tw = R.retimeTweak({}, R.ID, A, 2);
  near(tw.stretch, 2); assert.equal(tw.pivot, 2); assert.equal(tw.shift, null);
  const f = R.timeMap(tw);
  near(R.at(f, 2), 2); near(R.at(f, 6), 4);
  // then drag the start from 2 to 3 (end fixed at 6): content 2 -> 3, content 4 stays at 6
  const tw2 = R.retimeTweak(tw, R.ID, R.stretchAbout(6, 2, 3), 2);
  const f2 = R.timeMap(tw2);
  near(R.at(f2, 3), 2, 1e-3); near(R.at(f2, 6), 4, 1e-3);
  assert.equal(R.retimeTweak({}, R.ID, R.stretchAbout(0, 1, 20), 0), null, 'beyond 10x is refused');
});

test('composition with a retimed parent', () => {
  const G = R.timeMap({ shift: 1 }); // parent plays 1 s later
  const own = { stretch: 2, pivot: 0.5 };
  const before = full(own, G);
  const A = R.moveBy(0.25);
  const tw = R.retimeTweak(own, G, A, 1.5);
  const after = full(tw, G);
  for (const T of [1, 2, 3.7]) near(R.at(after, R.at(A, T)), R.at(before, T), 1e-3);
  near(R.at(R.ancestorsMap(['p', 'gp'], (k) => ({ p: { shift: 1 }, gp: { shift: 0.5 } })[k]), 3), 1.5);
  // order = the player's mapOf fold: the outermost ancestor first (grandparent stretch 2, parent shift 1: t=6 -> 3 -> 2)
  const tws = { p: { shift: 1 }, gp: { stretch: 2 } };
  near(R.at(R.ancestorsMap(['p', 'gp'], (k) => tws[k]), 6), 2);
  let f = E.IDENTITY;
  for (const k of ['p', 'gp']) f = E.compose(E.timeMap(tws[k]), f);
  near(R.at(R.ancestorsMap(['p', 'gp'], (k) => tws[k]), 4.2), E.at(f, 4.2));
});

test('sound links', () => {
  const keys = new Set(['total', 'phone', 'phone-screen', 'logo', 'tagline']);
  assert.equal(R.linkOf({ id: 'total-tick-3' }, keys), 'total');
  assert.equal(R.linkOf({ id: 'phone-in' }, keys), 'phone');
  assert.equal(R.linkOf({ id: 'phone-screen-x' }, keys), 'phone-screen', 'longest key wins');
  assert.equal(R.linkOf({ id: 'logo' }, keys), 'logo');
  assert.equal(R.linkOf({ id: 'tag' }, keys), null);
  assert.equal(R.linkOf({ id: 'logo', el: '' }, keys), null, 'explicit unlink');
  assert.equal(R.linkOf({ id: 'snap-flood', el: 'phone' }, keys), 'phone', 'explicit link');
  const cues = [{ id: 'phone-in', t: 1 }, { id: 'phone-screen-x', t: 2 }, { id: 'logo', t: 3 }];
  assert.deepEqual(R.soundsOf(cues, new Set(['phone', 'phone-screen']), keys).map((c) => c.id), ['phone-in', 'phone-screen-x']);
  assert.deepEqual(R.mapCueTimes([['a', 1], ['b', 14.9]], R.moveBy(0.5), 15), [['a', 1.5], ['b', 15]]);
  near(R.clampDelta([1, 14], 2, 15), 1); near(R.clampDelta([1, 14], -3, 15), -1);
  const hits = [{ id: 'a', x: 10, lane: { top: 0, h: 50 } }, { id: 'b', x: 100, lane: { top: 0, h: 50 } }, { id: 'c', x: 20, lane: { top: 60, h: 50 } }];
  assert.deepEqual(R.inBox(hits, 50, 10, 0, 70), ['a', 'c']);
  assert.equal(R.timingSummary({ shift: -0.5, stretch: 1.5 }), 'shift −0.50 s · stretch 1.50×');
});
