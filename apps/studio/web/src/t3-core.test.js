// Unit tests for the JS twins of the pure T3 helpers in src-tauri/src/t3.rs (same cases as the Rust tests).
// Run: node apps/studio/web/src/t3-core.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { levelOf, checkTool, statusOf, wslPath, parentPosix, inFolder, matchProject, gitMainFrom, isParentOrSame, checkCallback, checkRedirectTo, decisionBody, pairingToken, CONNECT_ACCESS, checkMeta, parseSse, sseResponse, toolResult, viewNavAllowed, statusClass, READ_TOOLS, OPERATE_TOOLS, failureText, clientName, aboveLevel, escalationText, launchModel, FALLBACK_MODEL } from './t3-core.js';

test('path mapping', () => {
  assert.equal(wslPath('C:\\Users\\alex\\dev\\gfx-projects\\foo'), '/mnt/c/Users/alex/dev/gfx-projects/foo');
  assert.equal(wslPath('D:\\'), '/mnt/d');
  assert.equal(wslPath('c:/a/b/'), '/mnt/c/a/b');
  assert.equal(wslPath('\\\\?\\C:\\a\\b'), '/mnt/c/a/b');
  assert.equal(wslPath('\\\\wsl.localhost\\Ubuntu\\home\\alex\\proj'), '/home/alex/proj');
  assert.equal(wslPath('\\\\wsl$\\Ubuntu-22.04\\home\\k\\p\\'), '/home/k/p');
  assert.equal(wslPath('/home/k//p/./q/'), '/home/k/p/q');
  for (const bad of ['\\\\server\\share\\x', 'relative\\path', '', '1:\\x']) assert.throws(() => wslPath(bad), /can't map/);
  assert.equal(parentPosix('/mnt/c/dev/gfx/foo'), '/mnt/c/dev/gfx');
  assert.equal(parentPosix('/x'), '/');
  assert.ok(inFolder('/mnt/c/dev/gfx/foo', '/mnt/c/dev/gfx'));
  assert.ok(!inFolder('/mnt/c/dev/gfx-other/foo', '/mnt/c/dev/gfx'));
  assert.ok(!inFolder('/mnt/c/dev/gfx', '/mnt/c/dev/gfx'));
});

test('callback checks', () => {
  const iss = 'http://127.0.0.1:3773';
  assert.equal(checkCallback('/gfx-studio/callback?code=abc%2Bd&state=S1&iss=http%3A%2F%2F127.0.0.1%3A3773', 'S1', iss), 'abc+d');
  assert.throws(() => checkCallback('/gfx-studio/callback?code=x&state=S2', 'S1', iss), /wrong state/);
  assert.throws(() => checkCallback('/gfx-studio/callback?code=x&state=S1&iss=http%3A%2F%2Fevil', 'S1', iss), /issuer/);
  assert.throws(() => checkCallback('/gfx-studio/callback?error=access_denied&state=S1', 'S1', iss), /access denied in T3/);
  assert.throws(() => checkCallback('/gfx-studio/callbackX?code=x&state=S1', 'S1', iss), /not the callback/);
  // the decision endpoint's redirectTo (the redirect URI registered without a port)
  assert.equal(checkRedirectTo('http://127.0.0.1/gfx-studio/callback?code=C1&state=S1&iss=http%3A%2F%2F127.0.0.1%3A3773', 'S1', iss), 'C1');
  assert.throws(() => checkRedirectTo('http://127.0.0.1/gfx-studio/callback?code=C1&state=S2', 'S1', iss), /wrong state/);
  assert.throws(() => checkRedirectTo('http://127.0.0.1/gfx-studio/callback?error=invalid_request&error_description=PKCE&state=S1', 'S1', iss), /T3: invalid_request PKCE/);
  assert.throws(() => checkRedirectTo('http://evil.example/gfx-studio/callback?code=C1&state=S1', 'S1', iss), /unexpected redirect/);
  assert.deepEqual(decisionBody({ state: 'S1' }, 'read-only', 'ABCD'), { authorization: { state: 'S1' }, decision: { _tag: 'pairing-code', access: 'read-only', code: 'ABCD' } });
  assert.deepEqual(CONNECT_ACCESS.map((a) => a[0]), ['read-only', 'auto-accept-edits', 'full-access']);
});

test('pairing link or code -> token', () => {
  assert.equal(pairingToken('http://127.0.0.1:3773/pair#token=ABCD2345EFGH'), 'ABCD2345EFGH', 'link with the token in the hash');
  assert.equal(pairingToken('https://t3.example.ts.net/pair?token=ABCD2345EFGH'), 'ABCD2345EFGH', 'link with the token in the query (any host: only the token is used)');
  assert.equal(pairingToken('http://127.0.0.1:3773/pair?token=QQQQ#token=HASHWINS'), 'HASHWINS', 'the hash wins, like T3');
  assert.equal(pairingToken('  ABCD2345EFGH \n'), 'ABCD2345EFGH', 'bare code with whitespace');
  assert.equal(pairingToken('PAIR-ONE'), 'PAIR-ONE');
  for (const bad of ['', '   ', 'two words', 'http://127.0.0.1:3773/pair', 'http://127.0.0.1:3773/pair#token=', 'http://[bad', '<script>', 'abc', 'x'.repeat(300), 'http://h/pair#token=a%20b%20c%20d']) {
    assert.equal(pairingToken(bad), null, JSON.stringify(bad));
  }
});

test('metadata checks', () => {
  const o = 'http://127.0.0.1:3773';
  const m = { issuer: o, authorization_endpoint: `${o}/oauth/mcp/authorize`, token_endpoint: '/oauth/mcp/token', registration_endpoint: `${o}/oauth/mcp/register`, code_challenge_methods_supported: ['S256'] };
  assert.equal(checkMeta(o, m).tokenEndpoint, `${o}/oauth/mcp/token`);
  assert.throws(() => checkMeta(o, { ...m, token_endpoint: 'http://evil.example/token' }));
  assert.throws(() => checkMeta(o, { ...m, issuer: 'http://localhost:3773' }));
  assert.throws(() => checkMeta(o, { ...m, authorization_endpoint: 'http://127.0.0.1:37730/x' }));
  assert.throws(() => checkMeta(o, { ...m, code_challenge_methods_supported: ['plain'] }));
});

test('SSE + tool results', () => {
  const body = ': keepalive\n\nevent: message\nid: 1\ndata: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,\r\ndata: "result":{"ok":1}}\r\n\r\nevent: ping\ndata: {}\n';
  const ev = parseSse(body);
  assert.equal(ev.length, 3);
  assert.equal(ev[1].data, '{"jsonrpc":"2.0","id":7,\n"result":{"ok":1}}');
  assert.equal(sseResponse(body, 7).result.ok, 1);
  assert.equal(sseResponse(body, 8), null);
  assert.deepEqual(toolResult({ result: { content: [{ type: 'text', text: '{"threads":[]}' }] } }), { threads: [] });
  assert.deepEqual(toolResult({ result: { content: [{ type: 'text', text: 'x' }], structuredContent: { a: 1 } } }), { a: 1 });
  assert.throws(() => toolResult({ result: { isError: true, content: [{ type: 'text', text: 'boom' }] } }), /T3: boom/);
  assert.throws(() => toolResult({ error: { code: -32601, message: 'no such tool' } }), /no such tool/);
});

test('allowlist, levels, status never carries secrets', () => {
  for (const t of READ_TOOLS) { assert.doesNotThrow(() => checkTool(t, 'read-only')); assert.throws(() => checkTool(t, '')); }
  for (const t of OPERATE_TOOLS) { assert.throws(() => checkTool(t, 'read-only')); assert.doesNotThrow(() => checkTool(t, 'standard')); }
  assert.throws(() => checkTool('t3_project_create', 'standard'), /Full access/);
  for (const t of ['t3_project_delete', 't3_thread_interrupt', 't3_attachment_discard', '']) assert.throws(() => checkTool(t, 'full'), /not allowed/);
  assert.equal(levelOf('orchestration:read'), 'read-only');
  assert.equal(levelOf('orchestration:read orchestration:operate'), 'standard');
  assert.equal(levelOf('orchestration:read orchestration:operate settings:write source-control:write'), 'full');
  const now = 1_000_000;
  const cfg = { token: 'TOKEN-SECRET', clientId: 'CLIENT-SECRET', expiresAt: now + 5000, scope: 'orchestration:read orchestration:operate settings:write', environmentId: 'e', envServer: 'http://127.0.0.1:3773' };
  const s = statusOf(cfg, now);
  assert.ok(s.connected && s.level === 'full' && s.autoCreate && s.environmentId === 'e');
  assert.ok(!/SECRET/.test(JSON.stringify(s)));
  const exp = statusOf(cfg, now + 6000);
  assert.ok(!exp.connected && exp.reconnect);
  assert.ok(!statusOf({ ...cfg, autoCreate: false }, now).autoCreate);
});

test('view navigation + status classes', () => {
  const o = 'http://127.0.0.1:3773';
  assert.ok(viewNavAllowed(`${o}/env/thread?embed=compact`, o));
  assert.ok(viewNavAllowed(`${o}/pair#token=X`, o));
  assert.ok(!viewNavAllowed('http://127.0.0.1:51234/gfx-studio/callback?code=x', o), 'no loopback callback any more');
  assert.ok(!viewNavAllowed('http://127.0.0.1:51234/other', o));
  assert.ok(!viewNavAllowed('http://127.0.0.1:3773.evil.com/', o));
  assert.deepEqual(['running', 'queued', 'waiting', 'completed', 'failed', 'interrupted', 'idle'].map(statusClass), ['running', 'running', 'waiting', 'done', 'failed', 'failed', 'idle']);
});

test('project matching (exact, longest parent, worktree main repo)', () => {
  const P = (id, workspaceRoot) => ({ id, workspaceRoot });
  const ps = [P('repo', '/home/k/repo'), P('wt', '/home/k/repo/.claude/worktrees/wt'), P('home', '/home/k'), P('ab', '/a/b')];
  const m = (p, g) => { const r = matchProject(ps, p, g); return r && [r.project.id, r.exact]; };
  assert.deepEqual(m('/home/k/repo/.claude/worktrees/wt'), ['wt', true], 'exact beats parent');
  assert.deepEqual(m('/home/k/repo/.claude/worktrees/other'), ['repo', false], 'longest parent wins');
  assert.deepEqual(m('/home/k/x'), ['home', false]);
  assert.equal(m('/a/bc'), null, '/a/b is not a parent of /a/bc');
  assert.deepEqual(m('/a/b/'), ['ab', true]);
  assert.deepEqual(m('/srv/wt', '/home/k/repo'), ['repo', false], 'worktree elsewhere -> its main repo');
  assert.equal(m('/srv/wt', '/srv/none'), null);
  assert.equal(matchProject([], '/x'), null);
  assert.ok(isParentOrSame('/a/b', '/a/b/c') && !isParentOrSame('/a/b', '/a/bc') && isParentOrSame('/', '/x'));
  assert.equal(gitMainFrom('gitdir: /home/k/repo/.git/worktrees/wt\n', '/home/k/repo/.claude/worktrees/wt'), '/home/k/repo');
  assert.equal(gitMainFrom('gitdir: ../../../.git/worktrees/wt', '/home/k/repo/.claude/worktrees/wt'), '/home/k/repo');
  assert.equal(gitMainFrom('gitdir: C:/dev/repo/.git/worktrees/x', '/mnt/c/dev/x'), '/mnt/c/dev/repo');
  assert.equal(gitMainFrom('gitdir: /home/k/sub/.git/modules/m', '/home/k/sub/m'), null, 'a submodule is not a worktree');
  assert.equal(gitMainFrom('nothing', '/x'), null);
});

test('tool failures: the message, never the raw JSON; the code kept (twin of t3::failure_text)', () => {
  const text = '{"_tag":"OrchestratorMcpFailure","code":"runtime_mode_escalation_denied","message":"Child runtime mode full-access is broader than parent mode auto-accept-edits."}';
  let e;
  try { toolResult({ result: { isError: true, content: [{ type: 'text', text }] } }); } catch (x) { e = x; }
  assert.equal(e.message, 'T3: Child runtime mode full-access is broader than parent mode auto-accept-edits.');
  assert.equal(e.code, 'runtime_mode_escalation_denied');
  assert.throws(() => toolResult({ result: { isError: true, structuredContent: { error: { code: 'invalid_request', message: 'bad' } }, content: [] } }), (x) => x.message === 'T3: bad' && x.code === 'invalid_request');
  assert.throws(() => toolResult({ result: { isError: true, content: [{ type: 'text', text: 'boom' }] } }), (x) => x.message === 'T3: boom' && !('code' in x));
  assert.deepEqual(failureText('{"error":"invalid_token"}'), { message: 'invalid_token', code: undefined });
  assert.equal(failureText('not json').message, 'not json');
  assert.equal(failureText('{"no":"message"}').message, '{"no":"message"}');
});

test('client names carry the level (twin of t3::client_name)', () => {
  assert.equal(clientName('full-access'), 'gfx studio · Full');
  assert.equal(clientName('auto-accept-edits'), 'gfx studio · Standard');
  assert.equal(clientName('read-only'), 'gfx studio · Read only');
  assert.equal(clientName('x'), 'gfx studio');
});

test('threads above gfx\'s level + escalation text', () => {
  assert.equal(aboveLevel('full-access', 'standard'), 'Runs with Full access; gfx has Standard');
  assert.equal(aboveLevel('auto', 'standard'), 'Runs with Auto; gfx has Standard');
  assert.equal(aboveLevel('auto-accept-edits', 'standard'), '');
  assert.equal(aboveLevel('approval-required', 'standard'), '');
  assert.equal(aboveLevel('full-access', 'full'), '');
  assert.equal(aboveLevel(undefined, 'standard'), '', 'unknown mode: not marked');
  assert.equal(aboveLevel('full-access', 'read-only'), '', 'read-only cannot send at all (separate gating)');
  assert.equal(escalationText('full-access', 'standard'), 'This thread runs with Full access; gfx has Standard. Change access… to send here, or pick another thread.');
  assert.match(escalationText(undefined, 'standard', 'T3: Child runtime mode auto is broader than parent mode auto-accept-edits.'), /^This thread runs with Auto; gfx has Standard\./);
  assert.match(escalationText(undefined, 'standard', 'other'), /^This thread runs with more access than gfx; gfx has Standard\./);
});

test('launch model: latest thread of the preferred list, else the fallback', () => {
  const t = (providerInstanceId, model, updatedAt) => ({ providerInstanceId, model, updatedAt });
  const mine = [t('claudeAgent', 'claude-sonnet-5', '2026-10-16T10:00:00Z'), t('codex', 'gpt-5', '2026-10-16T12:00:00Z')];
  const parent = [t('claudeAgent', 'claude-haiku-5', '2026-10-16T13:00:00Z')];
  assert.deepEqual(launchModel(mine, parent), { instanceId: 'codex', model: 'gpt-5' }, 'this worktree first, most recently updated');
  assert.deepEqual(launchModel([], parent), { instanceId: 'claudeAgent', model: 'claude-haiku-5' }, 'then the parent project');
  assert.deepEqual(launchModel([{ model: 'x' }], undefined), FALLBACK_MODEL, 'no usable thread -> fallback');
  assert.deepEqual(FALLBACK_MODEL, { instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
});
