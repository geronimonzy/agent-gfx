import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPostUrl } from './url-guard.js';

test('webhook guard rejects ambiguous URLs before WHATWG normalization', () => {
  const exploit = String.raw`http://example.com\@localhost/hook`;
  assert.equal(new URL(exploit).hostname, 'example.com');
  for (const url of [
    exploit, 'http://user@localhost/hook', 'http://@localhost/hook',
    'https://user:pass@host.io/hook', String.raw`https://host.io/a\b`,
    'http:////user@localhost/hook', 'http://localhost:bad/hook',
    'http://localhost.evil.com/hook', 'http://example.com/hook',
  ]) assert.throws(() => checkPostUrl(url), undefined, url);
});

test('webhook guard accepts HTTPS and parsed loopback HTTP hosts', () => {
  for (const url of [
    'https://t3.example.com/hooks/abc?x=1', 'http://127.0.0.1:8787/hook',
    'http://localhost/x', 'HTTP://LOCALHOST:1/x', 'http://[::1]:9/x',
  ]) assert.doesNotThrow(() => checkPostUrl(url), url);
});

test('link guard: vscode file / WSL links only', async () => {
  const { checkLink } = await import('./url-guard.js');
  for (const url of ['vscode://file/C:/p/scenes/a/scene.js:12:3', 'vscode://vscode-remote/wsl+Ubuntu/home/k/p/scene.js:4', 'vscode://file//tmp/p/x.js:1:1'])
    assert.doesNotThrow(() => checkLink(url), url);
  for (const url of ['vscode://command/workbench.action.terminal.new', 'vscode:extension/x', 'vscode://file/C:/p/../x.js', 'vscode://vscode-remote/ssh-remote+h/x'])
    assert.throws(() => checkLink(url), undefined, url);
});
