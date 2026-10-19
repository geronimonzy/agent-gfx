// Dev-shim twin of src-tauri/src/t3.rs (docs/T3.md): the T3 commands for `npm run studio:dev` (Linux browser).
// Same rules as the Rust side: the token and the client_id stay in this process and its config file (never returned to
// the page, never logged); t3_call enforces the allowlist + access level. There is no native T3 view in a browser, so
// t3_view* report { exists: false, shim: true } and the panel shows an "Open in browser" link instead.
// Connecting (step 2, the approval with a pairing code through T3's /oauth/mcp/decision) works like the app. Without a view
// there is nothing to sign in for step 1 (`t3_view_session` -> { view: false }), except with GFX_T3_SHIM_APPROVE=1 (tests
// against out/t3-mock.mjs): then the shim stands in for the T3 view's cookie jar: `t3_view_session` asks the server's
// /api/auth/session with it, and `t3_view_pair { code }` signs it in the way T3's /pair#token= page does.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  DEFAULT_SERVER, REDIRECT_PATH, SCOPES, checkTool, statusOf, wslPath, parentPosix, gitMainFrom, checkRedirectTo, checkMeta, sseResponse, toolResult, decisionBody, failureText, clientName,
} from './src/t3-core.js';
import { checkPostUrl } from './src/url-guard.js';

const ACCESS = ['read-only', 'approval-required', 'auto-accept-edits', 'auto', 'full-access'];
const MAX_UPLOAD = 10 * 1024 * 1024;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const b64url = (b) => Buffer.from(b).toString('base64url');

/** `scheme://authority` of a server setting (twin of t3::normalize_server). */
export function normalizeServer(s) {
  s = String(s || '').trim().replace(/\/+$/, '');
  if (!s) return '';
  try { checkPostUrl(s); } catch { throw new Error(`T3 server must be http://127.0.0.1:<port> (or https://…): ${s}`); }
  const [scheme, rest] = s.split('://');
  if (/[/?#]/.test(rest)) throw new Error(`T3 server address takes no path: ${s}`);
  return `${scheme.toLowerCase()}://${rest.toLowerCase()}`;
}

export function t3Ops({ getRoot, file = process.env.GFX_STUDIO_T3 || path.join(os.tmpdir(), 'gfx-studio-dev-t3.json') } = {}) {
  const load = () => { try { return { server: '', clientId: '', clientServer: '', clientName: '', token: '', expiresAt: 0, scope: '', autoCreate: null, environmentId: '', envServer: '', needsReconnect: false, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { return { server: '', clientId: '', clientServer: '', token: '', expiresAt: 0, scope: '', autoCreate: null, environmentId: '', envServer: '', needsReconnect: false }; } };
  const save = (c) => fs.writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
  const originOf = (c) => c.server || DEFAULT_SERVER;
  const k = { gen: 0, connecting: false, error: '' };
  let session = null; // { origin, fp, sid }
  const EMULATE_VIEW = process.env.GFX_T3_SHIM_APPROVE === '1';
  let viewJar = new Map(); // the emulated T3 view's cookies (name -> value); test mode only
  const jarHeader = () => [...viewJar].map(([n, v]) => `${n}=${v}`).join('; ');
  const keepCookies = (r) => {
    for (const c of r.headers.getSetCookie?.() || []) {
      const [nv, ...attrs] = c.split(';');
      const i = nv.indexOf('=');
      if (i < 1) continue;
      const name = nv.slice(0, i).trim(), value = nv.slice(i + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) viewJar.delete(name); else viewJar.set(name, value);
    }
  };
  async function viewSession() {
    if (!EMULATE_VIEW) return { view: false, signedIn: false };
    const origin = originOf(load());
    if (!viewJar.size) return { view: true, signedIn: false };
    const r = await fetch(`${origin}/api/auth/session`, { headers: { cookie: jarHeader() }, redirect: 'manual', signal: AbortSignal.timeout(8000) })
      .catch((e) => { throw new Error(`T3 is not reachable at ${origin} (${e.cause?.message || e.message})`); });
    const j = r.ok ? await r.json().catch(() => ({})) : {};
    return { view: true, signedIn: j.authenticated === true };
  }
  // what T3's /pair#token=<code> page does in the view: exchange the token for the browser session cookie
  async function viewPair(code) {
    if (!EMULATE_VIEW) throw new Error('the T3 view is not open (the dev shim has none)');
    const origin = originOf(load());
    const r = await fetch(`${origin}/api/auth/browser-session`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: jarHeader() }, body: JSON.stringify({ credential: String(code || '').trim() }), redirect: 'manual' });
    keepCookies(r);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `pairing failed (HTTP ${r.status})`);
    return null;
  }
  let rpc = 0;
  const status = () => statusOf(load(), Date.now(), k.connecting, k.error);
  const fingerprint = (t) => crypto.createHash('sha256').update(t).digest('base64url').slice(0, 11);

  function markReconnect() {
    const c = load();
    c.token = ''; c.needsReconnect = true; save(c); session = null;
    return new Error('reconnect: T3 refused the token (revoked or expired), Reconnect T3');
  }
  async function mcpPost(origin, token, sid, body, id, ms) {
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'user-agent': 'gfx-studio' };
    if (sid) { headers['mcp-session-id'] = sid; headers['mcp-protocol-version'] = '2025-06-18'; }
    let r;
    try { r = await fetch(`${origin}/mcp`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(ms) }); }
    catch (e) { throw Object.assign(new Error(`T3 is not reachable (${origin}): ${e.cause?.message || e.message}`), { kind: 'other' }); }
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('unauthorized'), { kind: 'unauthorized' });
    if (r.status === 404 && sid) throw Object.assign(new Error('session gone'), { kind: 'session' });
    const text = await r.text();
    if (r.status < 200 || r.status >= 300) throw Object.assign(new Error(`T3 HTTP ${r.status}: ${failureText(text).message.slice(0, 200)}`), { kind: 'other' });
    const nsid = r.headers.get('mcp-session-id');
    if (r.status === 202 || !text.trim()) return { v: null, sid: nsid };
    if ((r.headers.get('content-type') || '').includes('text/event-stream')) {
      const v = sseResponse(text, id);
      if (!v) throw Object.assign(new Error('T3: no answer in the event stream'), { kind: 'other' });
      return { v, sid: nsid };
    }
    try { return { v: JSON.parse(text), sid: nsid }; } catch { throw Object.assign(new Error('T3: answer is not JSON'), { kind: 'other' }); }
  }
  async function callTool(tool, args) {
    const cfg = load();
    const st = statusOf(cfg, Date.now());
    if (!st.connected) throw new Error(st.reconnect ? 'reconnect: the T3 connection expired, Reconnect T3' : 'T3 is not connected');
    checkTool(tool, st.level);
    const origin = originOf(cfg), fp = fingerprint(cfg.token);
    for (let attempt = 0; attempt < 2; attempt++) {
      let sid;
      if (session && session.origin === origin && session.fp === fp) sid = session.sid;
      else {
        const id = ++rpc;
        try {
          const { v, sid: s } = await mcpPost(origin, cfg.token, null, { jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gfx-studio', version: 'dev' } } }, id, 15000);
          if (v?.error) throw new Error(`T3 initialize: ${v.error.message || 'error'}`);
          await mcpPost(origin, cfg.token, s, { jsonrpc: '2.0', method: 'notifications/initialized' }, 0, 15000).catch(() => {});
          session = { origin, fp, sid: s }; sid = s;
        } catch (e) {
          if (e.kind === 'unauthorized') throw markReconnect();
          if (e.kind === 'session') throw new Error('T3 initialize failed');
          throw e;
        }
      }
      const id = ++rpc;
      try {
        const { v } = await mcpPost(origin, cfg.token, sid, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } }, id, tool === 't3_thread_wait' ? 60000 : 30000);
        const out = toolResult(v);
        if (tool === 't3_environment_read' && out?.environmentId) {
          const c = load();
          if (c.environmentId !== out.environmentId || c.envServer !== origin) { c.environmentId = out.environmentId; c.envServer = origin; save(c); }
        }
        return out;
      } catch (e) {
        if (e.kind === 'unauthorized') throw markReconnect();
        if (e.kind === 'session' && attempt === 0) { session = null; continue; }
        if (e.kind === 'session') throw new Error('T3 MCP session lost');
        throw e;
      }
    }
    throw new Error('T3 call failed');
  }

  // ---------- connect step 2 (OAuth 2.1 + PKCE S256 + dynamic registration, approved through /oauth/mcp/decision) ----------
  async function connectStart({ access, code } = {}) {
    if (!ACCESS.includes(access)) throw new Error(`unknown access level: ${access}`);
    const c0 = String(code || '').trim();
    if (!/^[\x21-\x7e]{4,256}$/.test(c0)) throw new Error('That is not a pairing code. Paste a pairing link or code from T3 → Settings → Connections.');
    const cfg = load(), origin = originOf(cfg);
    const gen = ++k.gen;
    k.connecting = true; k.error = '';
    try { await approve(cfg, origin, gen, access, c0); } finally { if (k.gen === gen) k.connecting = false; }
    return status();
  }
  // a stale flow (Cancel, Disconnect, a newer Connect, another server) must not store anything
  const current = (gen, origin) => { if (k.gen !== gen || originOf(load()) !== origin) throw new Error('T3 connection cancelled or server changed'); };
  async function approve(cfg, origin, gen, access, code) {
    let meta;
    try { meta = await (await fetch(`${origin}/.well-known/oauth-authorization-server`, { redirect: 'manual', signal: AbortSignal.timeout(10000) })).json(); }
    catch (e) { throw new Error(`T3 is not reachable at ${origin} (${e.cause?.message || e.message}). Is T3 running?`); }
    const m = checkMeta(origin, meta);
    // one registration per server and level: the name ("gfx studio · Full") labels the grant in T3 → Settings → Connections
    const name = clientName(access);
    let clientId = cfg.clientServer === origin && cfg.clientName === name ? cfg.clientId : '';
    if (!clientId) {
      const r = await fetch(m.registrationEndpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ client_name: name, redirect_uris: [`http://127.0.0.1${REDIRECT_PATH}`], grant_types: ['authorization_code'], response_types: ['code'], token_endpoint_auth_method: 'none' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.client_id) throw new Error(`T3 client registration failed: HTTP ${r.status}`);
      clientId = j.client_id;
      current(gen, origin);
      const c = load(); c.clientId = clientId; c.clientServer = origin; c.clientName = name; save(c);
    }
    const verifier = b64url(crypto.randomBytes(48)), state = b64url(crypto.randomBytes(24));
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const redirect = `http://127.0.0.1${REDIRECT_PATH}`;
    const authorization = { response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', scope: SCOPES, state, resource: `${origin}/mcp` };
    current(gen, origin);
    let r;
    try {
      r = await fetch(`${origin}/oauth/mcp/decision`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'gfx-studio' }, redirect: 'manual', signal: AbortSignal.timeout(15000),
        body: JSON.stringify(decisionBody(authorization, access, code)) });
    } catch (e) { throw new Error(`T3 is not reachable at ${origin} (${e.cause?.message || e.message}). Is T3 running?`); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(typeof j.message === 'string' && j.message ? j.message.slice(0, 400) : `T3 refused the approval (HTTP ${r.status})`);
    if (typeof j.redirectTo !== 'string') throw new Error('T3 sent no approval redirect');
    await exchange(m.tokenEndpoint, checkRedirectTo(j.redirectTo, state, origin), redirect, clientId, verifier, origin, gen);
  }
  async function exchange(tokenEp, code, redirect, clientId, verifier, origin, gen) {
    const r = await fetch(tokenEp, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: clientId, code_verifier: verifier, resource: `${origin}/mcp` }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`T3 token exchange failed (HTTP ${r.status}): ${j.error_description || j.error || ''}`);
    if (!j.access_token) throw new Error('T3 sent no access token');
    current(gen, origin);
    const c = load();
    c.token = j.access_token; c.expiresAt = Date.now() + (Number(j.expires_in) || 30 * 86400) * 1000; c.scope = j.scope || 'orchestration:read'; c.needsReconnect = false;
    save(c); session = null;
  }

  // ---------- upload ----------
  async function upload(rel) {
    const r = String(rel || '');
    if (!/^out\/[^/\\]+\/review\/.+$/.test(r) || r.split(/[\\/]/).includes('..')) throw new Error(`write not allowed outside out/*/review/: ${rel}`);
    const mime = MIME[path.extname(r).toLowerCase()];
    if (!mime) throw new Error('only png / jpg / webp images can be sent to T3');
    const root = getRoot();
    const p = path.resolve(root, r);
    if (!p.startsWith(root + path.sep)) throw new Error(`path escapes root: ${rel}`);
    const bytes = fs.readFileSync(p);
    if (!bytes.length || bytes.length > MAX_UPLOAD) throw new Error(`${rel}: size must be 1 byte to 10 MB`);
    const name = path.basename(r);
    const prep = await callTool('t3_attachment_prepare_upload', { upload: { type: 'image', name, mimeType: mime, sizeBytes: bytes.length } });
    if (!prep?.attachmentId || !prep?.relativeUrl) throw new Error('T3 gave no upload URL');
    const u = String(prep.relativeUrl);
    if (!u.startsWith('/api/attachments/upload/') || /\.\.|\/\/|\\|#|[^\x21-\x7e]/.test(u)) throw new Error(`unexpected T3 upload URL: ${u.slice(0, 60)}`);
    const res = await fetch(`${originOf(load())}${u}`, { method: 'POST', headers: { 'content-type': mime }, body: bytes, redirect: 'manual', signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`T3 upload failed (HTTP ${res.status}): ${failureText(await res.text()).message.slice(0, 200)}`);
    return { type: 'image', id: prep.attachmentId, name, mimeType: mime, sizeBytes: bytes.length };
  }

  return {
    t3_status: () => status(),
    t3_set_options: ({ server, autoCreate } = {}) => {
      let c = load();
      if (server != null) {
        let s = normalizeServer(server);
        if (s === DEFAULT_SERVER) s = '';
        if (s !== c.server) { c = { ...c, server: s, clientId: '', clientServer: '', clientName: '', token: '', expiresAt: 0, scope: '', environmentId: '', envServer: '', needsReconnect: false }; session = null; k.gen++; k.connecting = false; k.error = ''; }
      }
      if (autoCreate != null) c.autoCreate = !!autoCreate;
      save(c);
      return status();
    },
    t3_disconnect: () => {
      const c = load();
      save({ server: c.server, autoCreate: c.autoCreate });
      session = null; k.gen++; k.connecting = false; k.error = '';
      return status();
    },
    t3_connect_cancel: () => { k.gen++; k.connecting = false; return status(); },
    t3_connect_start: connectStart,
    t3_call: ({ tool, args } = {}) => {
      const a = args ?? {};
      if (typeof a !== 'object' || Array.isArray(a)) throw new Error('args must be an object');
      return callTool(String(tool), a);
    },
    t3_upload: ({ rel } = {}) => upload(rel),
    t3_paths: () => {
      const root = getRoot(), project = wslPath(root);
      let gitMain = null;
      try { const g = path.join(root, '.git'); if (fs.statSync(g).isFile()) gitMain = gitMainFrom(fs.readFileSync(g, 'utf8'), project); } catch { /* no .git */ }
      return { project, folder: parentPosix(project), gitMain };
    },
    t3_view: () => ({ exists: false, shim: true }),
    t3_view_info: () => ({ exists: false, shim: true }),
    t3_view_close: () => null,
    t3_view_session: () => viewSession(),
    t3_view_pair: ({ code } = {}) => viewPair(code),
    t3_shim_forget_view: () => { viewJar = new Map(); return null; },
  };
}
