// T3 helpers shared by the T3 panel (t3.js), the dev shim's backend twin (../t3-shim.js) and t3-core.test.js.
// Twins of the pure functions in src-tauri/src/t3.rs (docs/T3.md); keep them in step.

export const DEFAULT_SERVER = 'http://127.0.0.1:3773';
export const REDIRECT_PATH = '/gfx-studio/callback';
export const SCOPES = 'orchestration:read orchestration:operate';
export const READ_TOOLS = ['t3_environment_read', 't3_project_list', 't3_thread_list', 't3_thread_read', 't3_thread_wait'];
export const OPERATE_TOOLS = ['t3_thread_launch', 't3_thread_send', 't3_attachment_prepare_upload', 't3_thread_send_attachments'];
export const FULL_TOOLS = ['t3_project_create'];

/** "" | read-only | standard | full, from the granted scopes. */
export function levelOf(scope) {
  const has = (s) => String(scope || '').split(/\s+/).includes(s);
  if (!has('orchestration:read')) return '';
  if (has('settings:write')) return 'full';
  if (has('orchestration:operate')) return 'standard';
  return 'read-only';
}

/** Allowlist + level. Throws a readable error. */
export function checkTool(tool, level) {
  if (READ_TOOLS.includes(tool)) { if (!level) throw new Error('T3 is not connected'); return; }
  if (OPERATE_TOOLS.includes(tool)) { if (level !== 'standard' && level !== 'full') throw new Error(`access: ${tool} needs Standard or Full access`); return; }
  if (FULL_TOOLS.includes(tool)) { if (level !== 'full') throw new Error(`access: ${tool} needs Full access`); return; }
  throw new Error(`tool not allowed: ${tool}`);
}

/** What the frontend sees (no token, no client id). */
export function statusOf(cfg, now, connecting = false, error = '') {
  const origin = cfg.server || DEFAULT_SERVER;
  const live = !!cfg.token && cfg.expiresAt > now && !cfg.needsReconnect;
  const level = live ? levelOf(cfg.scope) : '';
  return {
    server: origin, connected: live && !!level, level, scopes: live ? String(cfg.scope || '').split(/\s+/).filter(Boolean) : [],
    expiresAt: live ? cfg.expiresAt : 0, reconnect: !live && (!!cfg.needsReconnect || (!!cfg.scope && cfg.expiresAt > 0)),
    autoCreate: level === 'full' && cfg.autoCreate !== false, environmentId: cfg.envServer === origin ? cfg.environmentId || '' : '', connecting, error,
  };
}

/** Project folder -> the WSL path T3 uses (twin of t3::wsl_path). */
export function wslPath(p) {
  let t = String(p || '').trim();
  const clean = (x) => '/' + x.split('/').filter((s) => s && s !== '.').join('/');
  if (/^\\\\\?\\[A-Za-z]:/.test(t)) t = t.slice(4);
  let m = t.replace(/\\/g, '/').match(/^\/\/(?:\?\/UNC\/)?(wsl\.localhost|wsl\$)\/([^/]+)(\/.*)?$/i);
  if (m) return clean(m[3] || '/');
  if (/^[\\/]{2}/.test(t)) throw new Error(`can't map to a WSL path: ${p}`);
  m = t.match(/^([A-Za-z]):([\\/].*)?$/);
  if (m) return clean(`/mnt/${m[1].toLowerCase()}/${(m[2] || '').replace(/\\/g, '/')}`);
  if (t.startsWith('/')) return clean(t);
  throw new Error(`can't map to a WSL path: ${p}`);
}
export const parentPosix = (p) => { const s = String(p).replace(/\/+$/, ''); const i = s.lastIndexOf('/'); return i <= 0 ? '/' : s.slice(0, i); };
export const inFolder = (root, folder) => String(root || '').startsWith(String(folder).replace(/\/+$/, '') + '/');
/** `parent` is `p` or one of its parent folders (twin of t3::is_parent_or_same; `/a/b` is not a parent of `/a/bc`). */
export function isParentOrSame(parent, p) {
  const a = String(parent || '').replace(/\/+$/, ''), b = String(p || '').replace(/\/+$/, '');
  return a === b || a === '' || b.startsWith(`${a}/`);
}
/**
 * The T3 project of a gfx project (twin of t3::match_project): workspaceRoot equal to the gfx path, else the longest
 * workspaceRoot that is a parent of it, else the same for the git main repo of a worktree. -> { project, exact } | null.
 */
export function matchProject(projects, path, gitMain) {
  const norm = (s) => String(s || '').replace(/\/+$/, '') || '/';
  const find = (target) => {
    const t = norm(target);
    const exact = projects.find((x) => norm(x.workspaceRoot) === t);
    if (exact) return { project: exact, exact: true };
    let best = null;
    for (const x of projects) {
      if (!String(x.workspaceRoot || '').trim() || !isParentOrSame(norm(x.workspaceRoot), t)) continue;
      if (!best || norm(x.workspaceRoot).length > norm(best.workspaceRoot).length) best = x;
    }
    return best ? { project: best, exact: false } : null;
  };
  const hit = find(path);
  if (hit || !gitMain) return hit;
  const g = find(gitMain);
  return g ? { project: g.project, exact: false } : null;
}
/** A worktree's `.git` file -> the main repo root as a WSL path, else null (twin of t3::git_main_from). */
export function gitMainFrom(gitfile, projectWsl) {
  const line = String(gitfile || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith('gitdir:'));
  const dir = line?.slice(7).trim();
  if (!dir) return null;
  let abs;
  if (dir.startsWith('/')) abs = '/' + dir.split('/').filter((s) => s && s !== '.').join('/');
  else if (dir[1] === ':') { try { abs = wslPath(dir); } catch { return null; } }
  else {
    const parts = String(projectWsl).split('/').filter(Boolean);
    for (const seg of dir.replace(/\\/g, '/').split('/')) { if (!seg || seg === '.') continue; if (seg === '..') parts.pop(); else parts.push(seg); }
    abs = '/' + parts.join('/');
  }
  const i = abs.lastIndexOf('/.git/worktrees/');
  return i < 0 ? null : abs.slice(0, i) || '/';
}

/** The redirect target (`/gfx-studio/callback?code=..&state=..&iss=..`) -> code (throws on a wrong state / issuer / error). */
export function checkCallback(target, state, issuer) {
  const [p, q = ''] = String(target).split('?');
  if (p !== REDIRECT_PATH) throw new Error('not the callback');
  const sp = new URLSearchParams(q);
  if (sp.get('state') !== state) throw new Error('T3 answered with a wrong state (stale or forged callback)');
  if (sp.has('iss') && sp.get('iss').replace(/\/$/, '') !== issuer.replace(/\/$/, '')) throw new Error(`T3 answered from an unexpected issuer: ${sp.get('iss')}`);
  if (sp.get('error')) throw new Error(sp.get('error') === 'access_denied' ? 'access denied in T3' : `T3: ${sp.get('error')} ${sp.get('error_description') || ''}`.trim());
  if (!sp.get('code')) throw new Error('T3 sent no authorization code');
  return sp.get('code');
}
/** The `redirectTo` of T3's /oauth/mcp/decision answer (our redirect URI + code, state, iss) -> code (twin of t3::check_redirect_to). */
export function checkRedirectTo(redirectTo, state, issuer) {
  const m = String(redirectTo || '').match(/^http:\/\/127\.0\.0\.1(?::\d+)?(\/.*)$/);
  if (!m) throw new Error('T3 answered with an unexpected redirect');
  return checkCallback(m[1], state, issuer);
}

/** T3's MCP access choices (AuthMcpClientAccess) offered by Connect: [value, gfx level name, what it allows]. */
export const CONNECT_ACCESS = [
  ['read-only', 'Read only', 'see threads and their status'],
  ['auto-accept-edits', 'Standard', 'also send to and start threads (they auto-accept edits, ask before commands)'],
  ['full-access', 'Full access', 'also add T3 projects for gfx projects; threads run without prompts'],
];
/** POST /oauth/mcp/decision body (AuthMcpApprovalDecisionRequest; twin of t3::decision_body). */
export const decisionBody = (authorization, access, code) => ({ authorization, decision: { _tag: 'pairing-code', access, code } });

/**
 * What the user pasted for a pairing: a T3 pairing link (token in the hash `#token=` or the query `?token=`, like T3's
 * getPairingTokenFromUrl) or a bare code. -> the token, or null. Only the token is used: gfx never opens the pasted link
 * (its host may differ from the configured server; the token always goes to the configured server).
 */
export function pairingToken(input) {
  const s = String(input || '').trim();
  const ok = (t) => (/^[A-Za-z0-9._~+/=-]{4,256}$/.test(t) ? t : null);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return ok(s);
  let u;
  try { u = new URL(s); } catch { return null; }
  return ok((new URLSearchParams(u.hash.replace(/^#/, '')).get('token') || '').trim() || (u.searchParams.get('token') || '').trim());
}

/** Authorization server metadata: issuer = our server, every endpoint on it. */
export function checkMeta(origin, m) {
  const issuer = String(m?.issuer || '').replace(/\/$/, '');
  if (issuer !== origin) throw new Error(`T3 metadata names another issuer (${issuer}); use exactly ${issuer} as the server address`);
  const ep = (k) => {
    const v = m[k];
    if (typeof v !== 'string') throw new Error(`T3 metadata has no ${k}`);
    const abs = v.startsWith('/') ? origin + v : v;
    if (!abs.startsWith(origin + '/')) throw new Error(`T3 ${k} is not on ${origin}: ${v}`);
    return abs;
  };
  if (Array.isArray(m.code_challenge_methods_supported) && !m.code_challenge_methods_supported.includes('S256')) throw new Error('T3 does not support PKCE S256');
  return { authorizationEndpoint: ep('authorization_endpoint'), tokenEndpoint: ep('token_endpoint'), registrationEndpoint: ep('registration_endpoint') };
}

/** SSE body -> [{ event, data }]. */
export function parseSse(body) {
  const out = [];
  let ev = '', data = [], any = false;
  const flush = () => { if (any) out.push({ event: ev || 'message', data: data.join('\n') }); ev = ''; data = []; any = false; };
  for (const line of String(body).replace(/\r\n/g, '\n').split('\n')) {
    if (!line) { flush(); continue; }
    if (line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const k = i < 0 ? line : line.slice(0, i);
    let v = i < 0 ? '' : line.slice(i + 1);
    if (v.startsWith(' ')) v = v.slice(1);
    if (k === 'event') { ev = v; any = true; } else if (k === 'data') { data.push(v); any = true; }
  }
  flush();
  return out;
}
export function sseResponse(body, id) {
  const evs = parseSse(body).filter((e) => e.event === 'message').reverse();
  for (const e of evs) {
    let v; try { v = JSON.parse(e.data); } catch { continue; }
    if ((v.result !== undefined || v.error !== undefined) && (v.id === undefined || v.id === null || v.id === id)) return v;
  }
  return null;
}
/**
 * T3's message in an error text (twin of t3::failure_text): a tool failure comes as JSON text
 * (`{"_tag":"OrchestratorMcpFailure","code":..,"message":..}`), an HTTP error body may be `{ message }` / `{ error }`.
 * -> { message, code }. Plain text stays as it is.
 */
export function failureText(text) {
  const str = (v) => (typeof v === 'string' && v.trim() ? v : undefined);
  let v;
  try { v = JSON.parse(String(text).trim()); } catch { /* plain text */ }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const e = v.error && typeof v.error === 'object' ? v.error : v;
    const message = str(e.message) || str(v.message) || str(v.error_description) || str(v.error);
    if (message) return { message, code: str(e.code) || str(v.code) };
  }
  return { message: String(text), code: undefined };
}
/** An Error with T3's failure code kept as `e.code` (what `t3_call` rejects with: { message, code? }). */
export const t3Error = (message, code) => Object.assign(new Error(message), code ? { code } : {});
export function toolResult(resp) {
  if (resp?.error) throw new Error(`T3: ${resp.error.message || 'error'}`);
  const r = resp?.result;
  if (!r) throw new Error('T3: empty answer');
  const text = (r.content || []).find((x) => typeof x.text === 'string')?.text || '';
  if (r.isError) {
    const sc = r.structuredContent, scCode = sc?.error?.code || sc?.code;
    const scMsg = sc?.error?.message || sc?.message;
    const f = scMsg ? { message: scMsg, code: scCode } : text ? failureText(text) : { message: 'tool failed', code: scCode };
    throw t3Error(`T3: ${String(f.message).slice(0, 500)}`, f.code || scCode);
  }
  if (r.structuredContent && typeof r.structuredContent === 'object') return r.structuredContent;
  try { return JSON.parse(text); } catch { return text; }
}

/** View navigation guard (twin of t3::view_nav_allowed): the T3 server only. */
export function viewNavAllowed(url, origin) {
  return url === 'about:blank' || url === origin || String(url).startsWith(origin + '/');
}

/** The client_name registered for an access level (twin of t3::client_name): labels the grant in T3 → Settings → Connections. */
export function clientName(access) {
  const n = { 'read-only': 'Read only', 'auto-accept-edits': 'Standard', 'full-access': 'Full', 'approval-required': 'Supervised', auto: 'Auto' }[access];
  return n ? `gfx studio · ${n}` : 'gfx studio';
}

// ---------- runtime modes (T3 refuses to drive a thread broader than the caller: resolveRuntimeMode) ----------
/** T3's runtimeModeRank (apps/server/src/mcp/OrchestratorMcpService.ts). */
export const RUNTIME_RANK = { 'approval-required': 0, 'auto-accept-edits': 1, auto: 2, 'full-access': 3 };
/** T3's labels (runtimeModeConfig.ts). */
export const RUNTIME_NAME = { 'approval-required': 'Supervised', 'auto-accept-edits': 'Auto-accept edits', auto: 'Auto', 'full-access': 'Full access' };
/** The runtime-mode ceiling of gfx's MCP grant per gfx level (docs/T3.md §2: Standard = auto-accept-edits). */
export const LEVEL_MODE = { standard: 'auto-accept-edits', full: 'full-access' };
export const LEVEL_LABEL = { 'read-only': 'Read-only', standard: 'Standard', full: 'Full access' };
export const ESCALATION = 'runtime_mode_escalation_denied';
/** A thread runs above what gfx's level may drive -> e.g. "Runs with Full access; gfx has Standard", else ''. */
export function aboveLevel(runtimeMode, level) {
  const cap = LEVEL_MODE[level];
  if (!cap || !(runtimeMode in RUNTIME_RANK) || RUNTIME_RANK[runtimeMode] <= RUNTIME_RANK[cap]) return '';
  return `Runs with ${RUNTIME_NAME[runtimeMode]}; gfx has ${LEVEL_LABEL[level]}`;
}
/** The user-facing text for T3's runtime_mode_escalation_denied (the thread's mode from the list, else from T3's message). */
export function escalationText(runtimeMode, level, t3message = '') {
  const mode = runtimeMode in RUNTIME_RANK ? runtimeMode : String(t3message).match(/runtime mode ([\w-]+) is broader/)?.[1];
  const runs = mode in RUNTIME_RANK ? `This thread runs with ${RUNTIME_NAME[mode]}` : 'This thread runs with more access than gfx';
  return `${runs}; gfx has ${LEVEL_LABEL[level] || 'less access'}. Change access… to send here, or pick another thread.`;
}

// ---------- new threads: a model when the T3 project has no default (stopgap until T3's /new?project= link) ----------
export const FALLBACK_MODEL = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
/** ModelSelection for t3_thread_launch: the model of the most recently updated thread of the first list that has one, else
 *  FALLBACK_MODEL. `lists` = thread-list items in order of preference (e.g. this worktree's threads, then the parent's). */
export function launchModel(...lists) {
  const at = (t) => Date.parse(t.updatedAt || t.createdAt || '') || 0;
  for (const ts of lists) {
    const best = (ts || []).filter((t) => t?.providerInstanceId && t?.model).reduce((a, t) => (!a || at(t) > at(a) ? t : a), null);
    if (best) return { instanceId: best.providerInstanceId, model: best.model };
  }
  return { ...FALLBACK_MODEL };
}

// ---------- thread status (panel) ----------
export const ACTIVE = ['preparing', 'queued', 'starting', 'running'];
export const FAILED = ['failed', 'interrupted', 'cancelled', 'rolled_back'];
/** running · waiting · done · failed · idle */
export function statusClass(s) {
  if (ACTIVE.includes(s)) return 'running';
  if (s === 'waiting') return 'waiting';
  if (s === 'completed') return 'done';
  if (FAILED.includes(s)) return 'failed';
  return 'idle';
}
