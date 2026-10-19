// node apps/studio/web/src/newscene-core.test.js — New scene window: name check, take profiles, BRIEF.md write + read back.
import assert from 'node:assert/strict';
import test from 'node:test';
import { nameError, slugify, profileDefaults, takeDefaults, briefText, parseBrief, refFileName, isUrl, isAbsPath, usableLooks } from './newscene-core.js';

test('name check', () => {
  const scenes = [{ name: 'intro' }, { name: 'Logo-Sting' }];
  assert.equal(nameError('my-scene_2.v1', scenes), '');
  assert.match(nameError('', scenes), /name/);
  assert.match(nameError('My Scene', scenes), /my-scene/);
  assert.match(nameError('-x', scenes), /lower-case/);
  assert.match(nameError('a/b', scenes), /lower-case/);
  assert.match(nameError('intro', scenes), /exists/);
  assert.match(nameError('logo-sting', scenes), /exists/, 'case-insensitive (Windows folders)');
  assert.equal(nameError('intro', scenes, true), '', 'edit mode: the scene itself');
  assert.match(nameError('x'.repeat(65), scenes), /64/);
  assert.equal(slugify('  Hello World!! '), 'hello-world');
});

test('take profiles from the workflow setting', () => {
  assert.deepEqual(profileDefaults('quick'), { take: 'quick', verify: 'sheet', render: false, sound: false });
  assert.deepEqual(profileDefaults('full'), { take: 'full', verify: 'full', render: true, sound: true });
  assert.deepEqual(profileDefaults({ verify: 'stills', render: true, sound: 'asked' }), { take: 'custom', verify: 'stills', render: true, sound: false });
  assert.deepEqual(profileDefaults(undefined), { take: 'quick', verify: 'sheet', render: false, sound: false });
  assert.deepEqual(takeDefaults('custom', 'full'), { take: 'custom', verify: 'sheet', render: false, sound: false });
  assert.deepEqual(takeDefaults('custom', { verify: 'full', render: false, sound: 'always' }), { take: 'custom', verify: 'full', render: false, sound: true });
  assert.deepEqual(takeDefaults('full', { verify: 'sheet' }), profileDefaults('full'));
});

const base = {
  name: 'promo', prompt: 'A logo sting.\n\n## Not a heading of ours\nSecond paragraph — with a dash.', format: '9:16', w: 1080, h: 1920, fps: 30, dur: 7.5,
  kind: 'auto', style: 'look-soft', lookId: 'soft', take: 'custom', verify: 'stills', sound: true, render: false,
  refs: [{ kind: 'existing', rel: 'scenes/promo/refs/board.png', note: 'colours — and type' }, { kind: 'link', url: 'https://example.com/a?b=1', note: '' }],
};

test('BRIEF.md: written sections', () => {
  const t = briefText(base);
  assert.match(t, /^# Brief: promo\n/);
  assert.match(t, /\n## Prompt\n\nA logo sting\.\n/);
  assert.match(t, /\n- Format: 1080x1920, 30 fps, 7\.5 s \(9:16 reel\)\n/);
  assert.match(t, /\n- Kind: auto \(scaffolded as anime/);
  assert.match(t, /\n- Style: look-soft\n/);
  assert.match(t, /\n- Look: soft \(looks\/soft\/LOOK\.md/);
  assert.match(t, /\n- Take: custom /);
  assert.match(t, /\n- Verify: stills /);
  assert.match(t, /\n- Sound: yes /);
  assert.match(t, /\n- Render when done: no /);
  assert.match(t, /\n## References\n\n- scenes\/promo\/refs\/board\.png — colours — and type\n- https:\/\/example\.com\/a\?b=1\n$/);
  const plain = briefText({ ...base, refs: [], lookId: '', style: 'dark-grid', kind: 'svg', format: 'custom', w: 800, h: 600 });
  assert.match(plain, /\n- Format: 800x600, 30 fps, 7\.5 s \(custom\)\n- Kind: svg\n- Style: dark-grid\n- Look: none /);
  assert.match(plain, /\n## References\n\n- none\n$/);
});

test('BRIEF.md: read back', () => {
  const b = parseBrief(briefText(base));
  assert.equal(b.prompt, base.prompt.trim());
  assert.deepEqual([b.w, b.h, b.fps, b.dur, b.kind, b.style, b.look, b.take, b.verify, b.sound, b.render], [1080, 1920, 30, 7.5, 'auto', 'look-soft', 'soft', 'custom', 'stills', true, false]);
  assert.deepEqual(b.refs, [{ kind: 'existing', rel: 'scenes/promo/refs/board.png', note: 'colours — and type' }, { kind: 'link', url: 'https://example.com/a?b=1', note: '' }]);
  const c = parseBrief(briefText({ ...base, refs: [], lookId: '', kind: 'three', take: 'quick', verify: 'sheet', sound: false }).replace(/\n/g, '\r\n'));
  assert.deepEqual([c.look, c.kind, c.take, c.sound, c.refs.length], ['', 'three', 'quick', false, 0], 'CRLF (edited on Windows), no refs');
  const d = parseBrief('## Prompt\n\nJust a prompt, hand-written.\n');
  assert.equal(d.prompt, 'Just a prompt, hand-written.');
  assert.equal(d.w, undefined);
  assert.deepEqual(parseBrief('').refs, []);
});

test('ref helpers', () => {
  assert.equal(refFileName('C:\\Users\\k\\My Board (1).png'), 'My-Board-1-.png');
  assert.equal(refFileName('/home/k/..'), 'ref');
  assert.ok(isUrl('https://x.y/z') && !isUrl('ftp://x') && !isUrl('https://a b'));
  assert.ok(isAbsPath('C:\\x') && isAbsPath('/x') && isAbsPath('\\\\wsl.localhost\\U\\x') && !isAbsPath('x/y'));
});

test('look picker skips pending briefs, keeps complete and older engine entries', () => {
  assert.deepEqual(usableLooks([{ id: 'pending', pending: true }, { id: 'ready', name: 'Ready', pending: false }, 'old', { id: 'legacy' }, { id: '../bad' }]).map((x) => x.id), ['ready', 'old', 'legacy']);
});
