import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServerRoot } from './server-root.js';

test('native Windows roots match the same project served by a WSL engine', () => {
  for (const root of [
    'C:\\Users\\Alex\\Project\\', 'c:/users/alex/project/',
    '/mnt/c/Users/Alex/Project/', '/mnt/C/users/alex/project',
    '\\\\?\\C:\\Users\\Alex\\Project',
    '\\\\wsl.localhost\\Ubuntu\\mnt\\c\\Users\\Alex\\Project\\',
    '\\\\?\\UNC\\wsl$\\Ubuntu\\mnt\\C\\Users\\Alex\\Project',
    '  C:\\Users\\Alex\\Project\\  ',
  ]) assert.equal(normalizeServerRoot(root), 'c:/users/alex/project', root);
  for (const root of ['D:\\', 'd:', '/mnt/d', '/mnt/D/']) assert.equal(normalizeServerRoot(root), 'd:', root);
});

test('Linux roots remain case significant and only single-letter /mnt drives are mapped', () => {
  assert.equal(normalizeServerRoot('\\\\wsl.localhost\\Ubuntu\\home\\Alex\\Project\\'), '/home/Alex/Project');
  assert.equal(normalizeServerRoot('\\\\?\\UNC\\wsl$\\Ubuntu\\home\\Alex\\Project'), '/home/Alex/Project');
  assert.equal(normalizeServerRoot('/home/Alex/Project/'), '/home/Alex/Project');
  for (const root of ['/mnt/case/Project', '/mnt/1/Project', '/MNT/c/Project', '/mnt/caseSensitive'])
    assert.equal(normalizeServerRoot(root), root);
  for (const root of ['/', '\\\\wsl$\\Ubuntu\\']) assert.equal(normalizeServerRoot(root), '/');
  for (const root of ['relative/path', '\\\\server\\share\\project']) assert.throws(() => normalizeServerRoot(root), /unsupported project root/);
});
