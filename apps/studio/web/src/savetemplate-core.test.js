// node apps/studio/web/src/savetemplate-core.test.js — Save as template helpers (docs/TEMPLATES.md §4) + its scene menu item.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { templateId, nameError, saveArgs, existsError, BUILTIN_IDS, libraryArgs } from './savetemplate-core.js';
import { sceneMenuItems } from './toolbar-items.js';

test('templateId twins the engine slug', () => {
  assert.equal(templateId('  My Promo, v2! '), 'my-promo-v2');
  assert.equal(templateId('Ünïcode only ✓'), 'n-code-only');
  assert.equal(templateId('x'.repeat(60)).length, 48);
});

test('nameError: empty, symbols only, built-in ids', () => {
  assert.match(nameError(''), /name/);
  assert.match(nameError('✓✓'), /letters or digits/);
  assert.match(nameError('Promo'), /built-in/);
  assert.equal(nameError('My promo'), '');
});

test('built-in ids match the engine folder', () => {
  const dirs = fs.readdirSync(new URL('../../../../templates/projects/', import.meta.url)).filter((n) => !n.startsWith('_')).sort();
  assert.deepEqual([...BUILTIN_IDS].sort(), dirs);
});

test('saveArgs: scope, description, preview, force', () => {
  assert.deepEqual(saveArgs({ scope: 'scene', scene: 'intro', name: ' My Intro ', description: '', preview: true }), ['template', 'save', '--name', 'My Intro', '--id', 'my-intro', '--scene', 'intro']);
  assert.deepEqual(saveArgs({ scope: 'project', scene: 'intro', name: 'P', description: ' d ', preview: false, force: true }), ['template', 'save', '--name', 'P', '--id', 'p', '--description', 'd', '--no-preview', '--force']);
  assert.ok(existsError('gfx: template "p" already exists in /x (use --force to replace it)'));
  assert.ok(!existsError('scene "x" not found'));
});

test('libraryArgs: the Library folder only within the same environment', () => {
  const win = 'C:\\Users\\k\\Documents\\gfx library', wsl = '\\\\wsl.localhost\\Ubuntu\\home\\k\\lib';
  assert.deepEqual(libraryArgs(win, 'C:\\Users\\k\\Documents\\gfx projects'), ['--library', win]);
  assert.deepEqual(libraryArgs(win, '\\\\wsl.localhost\\Ubuntu\\home\\k\\gfx-projects'), []);
  assert.deepEqual(libraryArgs(wsl, '\\\\wsl$\\ubuntu\\home\\k\\p'), ['--library', wsl]);
  assert.deepEqual(libraryArgs(wsl, '\\\\wsl.localhost\\Debian\\home\\k\\p'), []);
  assert.deepEqual(libraryArgs(wsl, 'D:\\p'), []);
  assert.deepEqual(libraryArgs('', 'C:\\p'), []);
  assert.deepEqual(libraryArgs('/home/k/lib', '/home/k/p'), ['--library', '/home/k/lib']);
  assert.deepEqual(saveArgs({ scope: 'project', name: 'P', library: ['--library', win] }), ['template', 'save', '--name', 'P', '--id', 'p', '--library', win]);
});

test('scene menu: Save as template… only with the action, disabled without scenes', () => {
  const state = { scenes: [{ name: 'one' }], current: 'one', hasBrief: false, hasProject: true, loading: false };
  const base = { select() {}, newScene() {}, brief() {}, reload() {} };
  assert.ok(!sceneMenuItems(state, base).some((i) => i.id === 'save-template'));
  let ran = 0;
  const items = sceneMenuItems(state, { ...base, saveTemplate: () => ran++ });
  const st = items.find((i) => i.id === 'save-template');
  assert.equal(st.label, 'Save as template…'); assert.equal(st.disabled, false);
  st.run(); assert.equal(ran, 1);
  assert.equal(sceneMenuItems({ ...state, scenes: [] }, { ...base, saveTemplate() {} }).find((i) => i.id === 'save-template').disabled, true);
});
