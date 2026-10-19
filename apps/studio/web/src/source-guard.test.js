import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSourceWritable, checkSourceVersion } from './source-guard.js';

test('code workspace write scope (twin of check_source_writable)', () => {
  for (const ok of ['scenes/a/scene.js', 'scenes/a/sub/x.css', './scenes/a/scene.json', 'style/presets/x.js', 'README.md', 'STORYBOARD.md', 'gfx.json', 'scenes/new.js'])
    assert.doesNotThrow(() => checkSourceWritable(ok), ok);
  for (const bad of ['../x.md', '/etc/x.md', 'C:/x.md', 'scenes/../gfx.json', 'scenes/a/../../runner/cli.js', 'out/a/review/draft.json', 'out/x.md',
    '.git/config', 'scenes/a/.git/config', 'scenes/node_modules/x.js', 'scenes/a/out/x.js', 'runner/cli.js', 'docs/x.md', 'package.json',
    'scenes', 'style', '.md', 'x.mdx', 'gfx.json/x', '\\\\srv\\x.md', 'scenes\\..\\gfx.json', ''])
    assert.throws(() => checkSourceWritable(bad), undefined, bad);
});

test('conditional writes reject stale snapshots, including same-mtime edits', () => {
  let disk = { text: 'Claude changed this', mtime: 20 };
  const write = (text, expectMtime, expectText) => {
    checkSourceVersion(disk.mtime, disk.text, expectMtime, expectText);
    disk = { text, mtime: 30 };
  };
  for (const [mtime, text] of [[10, 'old'], [20, 'old']]) {
    assert.throws(() => write('mine', mtime, text), (e) =>
      e.code === 'conflict' && e.mtime === 20 && e.text === 'Claude changed this');
    assert.equal(disk.text, 'Claude changed this');
  }
  write('mine', disk.mtime, disk.text); // Keep mine acknowledges the new snapshot
  assert.equal(disk.text, 'mine');
  assert.throws(() => checkSourceVersion(0, null, 30, 'mine'), { code: 'conflict' });
  assert.doesNotThrow(() => checkSourceVersion(0, null, 0, null));
  assert.throws(() => checkSourceVersion(20, 'disk', undefined), { code: 'conflict' });
});
