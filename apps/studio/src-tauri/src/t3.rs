//! T3 Code integration (docs/T3.md): connect (MCP OAuth 2.1 + PKCE S256 + dynamic registration, approved with a pairing
//! code through T3's decision endpoint),
//! an MCP client (streamable HTTP, JSON or SSE answers) behind a tool allowlist, attachment upload, WSL path mapping, and
//! the T3 view: a native child webview (Tauri `unstable`) that the frontend keeps over the `t3` dock panel.
//!
//! Secrets: the access token and the client_id live only in `<app config dir>/t3.json`. No command returns them, nothing
//! logs them; the frontend gets `T3Status` (connected, level, expiry, ...).
use crate::claude::{check_link, check_post_url};
use crate::AppState;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    webview::{NewWindowResponse, WebviewBuilder},
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, Runtime, State, WebviewUrl,
};

pub const DEFAULT_SERVER: &str = "http://127.0.0.1:3773";
pub const REDIRECT_PATH: &str = "/gfx-studio/callback";
pub const SCOPES: &str = "orchestration:read orchestration:operate";
const VIEW: &str = "t3view";
const MAX_UPLOAD: u64 = 10 * 1024 * 1024;

/// Any access level may call these.
pub const READ_TOOLS: [&str; 5] = ["t3_environment_read", "t3_project_list", "t3_thread_list", "t3_thread_read", "t3_thread_wait"];
/// Above read-only (scope orchestration:operate).
pub const OPERATE_TOOLS: [&str; 4] = ["t3_thread_launch", "t3_thread_send", "t3_attachment_prepare_upload", "t3_thread_send_attachments"];
/// Full access only (scope settings:write).
pub const FULL_TOOLS: [&str; 1] = ["t3_project_create"];

// ---------- config (t3.json) ----------
#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct T3Config {
    /// Server origin; empty = DEFAULT_SERVER.
    pub server: String,
    /// Signed client_id from dynamic registration, and the server it belongs to.
    pub client_id: String,
    pub client_server: String,
    /// The client_name the client_id was registered with (one per access level, see `client_name`).
    pub client_name: String,
    pub token: String,
    /// ms since epoch
    pub expires_at: u64,
    pub scope: String,
    /// None = default (on when full access is granted).
    pub auto_create: Option<bool>,
    pub environment_id: String,
    pub env_server: String,
    /// Set on a 401 (token revoked) or expiry: the UI says "Reconnect T3".
    pub needs_reconnect: bool,
}

impl T3Config {
    pub fn origin(&self) -> String {
        if self.server.is_empty() { DEFAULT_SERVER.to_string() } else { self.server.clone() }
    }
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct T3Status {
    pub server: String,
    pub connected: bool,
    /// "" (not connected) | "read-only" | "standard" | "full"
    pub level: String,
    pub scopes: Vec<String>,
    pub expires_at: u64,
    pub reconnect: bool,
    pub auto_create: bool,
    pub environment_id: String,
    pub connecting: bool,
    pub error: String,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Access level from the granted scopes (docs/T3.md "Access level").
pub fn level_of(scope: &str) -> &'static str {
    let has = |s: &str| scope.split_whitespace().any(|x| x == s);
    if !has("orchestration:read") {
        ""
    } else if has("settings:write") {
        "full"
    } else if has("orchestration:operate") {
        "standard"
    } else {
        "read-only"
    }
}

/// What the frontend sees. Never carries the token or the client_id.
pub fn status_of(cfg: &T3Config, now: u64, connecting: bool, error: &str) -> T3Status {
    let live = !cfg.token.is_empty() && cfg.expires_at > now && !cfg.needs_reconnect;
    let level = if live { level_of(&cfg.scope) } else { "" };
    let origin = cfg.origin();
    T3Status {
        server: origin.clone(),
        connected: live && !level.is_empty(),
        level: level.to_string(),
        scopes: if live { cfg.scope.split_whitespace().map(String::from).collect() } else { vec![] },
        expires_at: if live { cfg.expires_at } else { 0 },
        reconnect: !live && (cfg.needs_reconnect || (!cfg.scope.is_empty() && cfg.expires_at > 0)),
        auto_create: level == "full" && cfg.auto_create.unwrap_or(true),
        environment_id: if cfg.env_server == origin { cfg.environment_id.clone() } else { String::new() },
        connecting,
        error: error.to_string(),
    }
}

/// Allowlist + access level (docs/T3.md §3). Delete / archive / settle / interrupt tools are never callable.
pub fn check_tool(tool: &str, level: &str) -> Result<(), String> {
    if READ_TOOLS.contains(&tool) {
        return if level.is_empty() { Err("T3 is not connected".into()) } else { Ok(()) };
    }
    if OPERATE_TOOLS.contains(&tool) {
        return if level == "standard" || level == "full" { Ok(()) } else { Err(format!("access: {tool} needs Standard or Full access")) };
    }
    if FULL_TOOLS.contains(&tool) {
        return if level == "full" { Ok(()) } else { Err(format!("access: {tool} needs Full access")) };
    }
    Err(format!("tool not allowed: {tool}"))
}

fn cfg_path(state: &AppState) -> PathBuf {
    state.config_file.with_file_name("t3.json")
}
pub fn load_cfg(path: &std::path::Path) -> T3Config {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
fn save_cfg(path: &std::path::Path, cfg: &T3Config) -> Result<(), String> {
    std::fs::write(path, serde_json::to_vec_pretty(cfg).unwrap()).map_err(|e| e.to_string())
}

// ---------- server address ----------
/// `scheme://authority` of a server setting: https anywhere or http on this machine (same guard as before), no path.
pub fn normalize_server(s: &str) -> Result<String, String> {
    let s = s.trim().trim_end_matches('/');
    if s.is_empty() {
        return Ok(String::new());
    }
    check_post_url(s).map_err(|_| format!("T3 server must be http://127.0.0.1:<port> (or https://…): {s}"))?;
    let (scheme, rest) = s.split_once("://").ok_or("bad server address")?;
    if rest.contains(['/', '?', '#']) {
        return Err(format!("T3 server address takes no path: {s}"));
    }
    Ok(format!("{}://{}", scheme.to_ascii_lowercase(), rest.to_ascii_lowercase()))
}

// ---------- path mapping (docs/T3.md §1) ----------
/// The WSL path T3 uses for a project folder: `C:\a\b` -> `/mnt/c/a/b`; `\\wsl.localhost\<distro>\x` and
/// `\\wsl$\<distro>\x` -> `/x`; Linux paths (dev shim) stay as they are.
pub fn wsl_path(p: &str) -> Result<String, String> {
    let t = p.trim();
    let bad = || format!("can't map to a WSL path: {p}");
    let t = t.strip_prefix(r"\\?\").filter(|r| r.as_bytes().get(1) == Some(&b':')).unwrap_or(t);
    if t.starts_with(r"\\") || t.starts_with("//") {
        return match crate::wsl_target(t, true) {
            Ok((Some(_), path)) => Ok(clean_posix(&path)),
            _ => Err(bad()),
        };
    }
    let b = t.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b.len() == 2 || b[2] == b'\\' || b[2] == b'/') {
        let rest = t[2..].replace('\\', "/");
        return Ok(clean_posix(&format!("/mnt/{}/{}", (b[0] as char).to_ascii_lowercase(), rest.trim_start_matches('/'))));
    }
    if t.starts_with('/') {
        return Ok(clean_posix(t));
    }
    Err(bad())
}
fn clean_posix(p: &str) -> String {
    let parts: Vec<&str> = p.split('/').filter(|x| !x.is_empty() && *x != ".").collect();
    format!("/{}", parts.join("/"))
}
/// The studio "folder" of a project = its parent directory.
pub fn parent_posix(p: &str) -> String {
    match p.trim_end_matches('/').rsplit_once('/') {
        Some(("", _)) | None => "/".into(),
        Some((a, _)) => a.into(),
    }
}
/// `workspaceRoot` inside the folder (prefix + '/').
pub fn in_folder(workspace_root: &str, folder: &str) -> bool {
    let f = folder.trim_end_matches('/');
    workspace_root.starts_with(&format!("{f}/"))
}

/// `parent` is `p` itself or one of its parent folders (path prefix + `/`; `/a/b` is not a parent of `/a/bc`).
pub fn is_parent_or_same(parent: &str, p: &str) -> bool {
    let a = parent.trim_end_matches('/');
    let b = p.trim_end_matches('/');
    a == b || a.is_empty() || b.starts_with(&format!("{a}/"))
}
/// The T3 project of a gfx project (docs/T3.md §1): the `workspaceRoot` equal to the gfx path; else the longest
/// `workspaceRoot` that is a parent of it; else (a git worktree whose main repo is elsewhere) the same two rules for the
/// main repo root. -> (index, exact). Twin of `matchProject` in t3-core.js.
pub fn match_project(roots: &[&str], path: &str, git_main: Option<&str>) -> Option<(usize, bool)> {
    let norm = |s: &str| { let t = s.trim_end_matches('/'); if t.is_empty() { "/".to_string() } else { t.to_string() } };
    let find = |target: &str| -> Option<(usize, bool)> {
        let t = norm(target);
        if let Some(i) = roots.iter().position(|r| norm(r) == t) { return Some((i, true)); }
        roots.iter().enumerate().filter(|(_, r)| !r.trim().is_empty() && is_parent_or_same(&norm(r), &t))
            .max_by_key(|(_, r)| norm(r).len()).map(|(i, _)| (i, false))
    };
    find(path).or_else(|| git_main.filter(|g| !g.is_empty()).and_then(|g| find(g).map(|(i, _)| (i, false))))
}
/// A git worktree's `.git` file (`gitdir: <main>/.git/worktrees/<name>`) -> the main repo root as a WSL path; `None`
/// for anything else. Relative gitdirs are resolved against the project's WSL path; Windows gitdirs are mapped.
pub fn git_main_from(gitfile: &str, project_wsl: &str) -> Option<String> {
    let dir = gitfile.lines().find_map(|l| l.trim().strip_prefix("gitdir:")).map(|s| s.trim())?;
    if dir.is_empty() { return None; }
    let abs = if dir.starts_with('/') { clean_posix(dir) }
        else if dir.as_bytes().get(1) == Some(&b':') { wsl_path(dir).ok()? }
        else {
            let rel = dir.replace('\\', "/");
            let mut parts: Vec<&str> = project_wsl.split('/').filter(|x| !x.is_empty()).collect();
            for seg in rel.split('/') {
                match seg { "" | "." => {}, ".." => { parts.pop(); }, s => parts.push(s) }
            }
            format!("/{}", parts.join("/"))
        };
    let i = abs.rfind("/.git/worktrees/")?;
    let main = &abs[..i];
    Some(if main.is_empty() { "/".into() } else { main.into() })
}

// ---------- PKCE / authorize URL / callback ----------
pub fn b64url(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}
pub fn pkce_challenge(verifier: &str) -> String {
    b64url(&Sha256::digest(verifier.as_bytes()))
}
fn random_token(n: usize) -> Result<String, String> {
    let mut b = vec![0u8; n];
    getrandom::getrandom(&mut b).map_err(|e| format!("random: {e}"))?;
    Ok(b64url(&b))
}
/// RFC 3986 percent-encoding of everything but the unreserved set.
pub fn pct(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for &c in s.as_bytes() {
        if c.is_ascii_alphanumeric() || b"-._~".contains(&c) { o.push(c as char) } else { o.push_str(&format!("%{c:02X}")) }
    }
    o
}
fn unpct(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'+' => { out.push(b' '); i += 1; }
            b'%' if i + 2 < b.len() => {
                match u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(v) => { out.push(v); i += 3; }
                    Err(_) => { out.push(b'%'); i += 1; }
                }
            }
            c => { out.push(c); i += 1; }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}
pub fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&').filter(|x| !x.is_empty()).map(|kv| { let (k, v) = kv.split_once('=').unwrap_or((kv, "")); (unpct(k), unpct(v)) }).collect()
}
/// The redirect URI gfx registers and presents. Nothing listens on it: gfx posts the approval itself and reads the code
/// from T3's `redirectTo` answer (docs/T3.md §2).
pub fn redirect_uri() -> String {
    format!("http://127.0.0.1{REDIRECT_PATH}")
}
/// T3's MCP access choices (`AuthMcpClientAccess` in packages/contracts/src/auth.ts).
pub const ACCESS: [&str; 5] = ["read-only", "approval-required", "auto-accept-edits", "auto", "full-access"];
/// The registered client name for an access level: T3 → Settings → Connections lists each grant by it, so the user can tell
/// the entries apart (gfx can't revoke an old grant itself; docs/T3.md §6 T3 fork finding 4).
pub fn client_name(access: &str) -> String {
    let level = match access {
        "read-only" => "Read only",
        "auto-accept-edits" => "Standard",
        "full-access" => "Full",
        "approval-required" => "Supervised",
        "auto" => "Auto",
        _ => return "gfx studio".into(),
    };
    format!("gfx studio · {level}")
}
/// The authorization request as T3's approval endpoints take it (`AuthMcpAuthorizationRequest`: the authorize URL's query
/// as an object).
pub fn authorization_request(client_id: &str, redirect: &str, challenge: &str, state: &str, resource: &str) -> Value {
    json!({ "response_type": "code", "client_id": client_id, "redirect_uri": redirect, "code_challenge": challenge,
            "code_challenge_method": "S256", "scope": SCOPES, "state": state, "resource": resource })
}
/// `POST /oauth/mcp/decision` body (`AuthMcpApprovalDecisionRequest`): approve with a pairing code at `access`.
pub fn decision_body(authorization: &Value, access: &str, code: &str) -> Value {
    json!({ "authorization": authorization, "decision": { "_tag": "pairing-code", "access": access, "code": code } })
}
/// A pairing code as the user pasted it (the frontend extracts it from a link): trimmed, printable, no spaces.
pub fn check_code(code: &str) -> Result<&str, String> {
    let c = code.trim();
    if c.len() < 4 || c.len() > 256 || !c.chars().all(|x| x.is_ascii_graphic()) {
        return Err("That is not a pairing code. Paste a pairing link or code from T3 → Settings → Connections.".into());
    }
    Ok(c)
}
/// The decision answer's `redirectTo` (our redirect URI + `code`, `state`, `iss`, or `error`) -> the code.
pub fn check_redirect_to(redirect_to: &str, state: &str, issuer: &str) -> Result<String, String> {
    let bad = || "T3 answered with an unexpected redirect".to_string();
    let rest = redirect_to.strip_prefix("http://127.0.0.1").ok_or_else(bad)?;
    let rest = match rest.strip_prefix(':') { Some(r) => r.trim_start_matches(|c: char| c.is_ascii_digit()), None => rest };
    if !rest.starts_with('/') { return Err(bad()); }
    check_callback(rest, state, issuer)
}
/// The redirect target (`/gfx-studio/callback?code=..&state=..&iss=..`) -> the code.
pub fn check_callback(target: &str, state: &str, issuer: &str) -> Result<String, String> {
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    if path != REDIRECT_PATH {
        return Err("not the callback".into());
    }
    let q = parse_query(query);
    if q.get("state").map(|s| s.as_str()) != Some(state) {
        return Err("T3 answered with a wrong state (stale or forged callback)".into());
    }
    if let Some(iss) = q.get("iss") {
        if iss.trim_end_matches('/') != issuer.trim_end_matches('/') {
            return Err(format!("T3 answered from an unexpected issuer: {iss}"));
        }
    }
    if let Some(e) = q.get("error") {
        return Err(if e == "access_denied" { "access denied in T3".into() } else { format!("T3: {e} {}", q.get("error_description").cloned().unwrap_or_default()).trim().to_string() });
    }
    match q.get("code") {
        Some(c) if !c.is_empty() => Ok(c.clone()),
        _ => Err("T3 sent no authorization code".into()),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct AuthMeta {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: String,
}
/// The authorization server metadata must name our server as issuer and keep every endpoint on it
/// (the code_verifier and the token never leave the configured server).
pub fn check_meta(origin: &str, m: &Value) -> Result<AuthMeta, String> {
    let issuer = m.get("issuer").and_then(|v| v.as_str()).unwrap_or("").trim_end_matches('/');
    if issuer != origin {
        return Err(format!("T3 metadata names another issuer ({issuer}); use exactly {issuer} as the server address"));
    }
    let ep = |k: &str| -> Result<String, String> {
        let v = m.get(k).and_then(|v| v.as_str()).ok_or(format!("T3 metadata has no {k}"))?;
        let abs = if v.starts_with('/') { format!("{origin}{v}") } else { v.to_string() };
        if !abs.starts_with(&format!("{origin}/")) {
            return Err(format!("T3 {k} is not on {origin}: {v}"));
        }
        Ok(abs)
    };
    let methods = m.get("code_challenge_methods_supported").and_then(|v| v.as_array());
    if let Some(ms) = methods {
        if !ms.iter().any(|x| x == "S256") {
            return Err("T3 does not support PKCE S256".into());
        }
    }
    Ok(AuthMeta { authorization_endpoint: ep("authorization_endpoint")?, token_endpoint: ep("token_endpoint")?, registration_endpoint: ep("registration_endpoint")? })
}

// ---------- MCP over streamable HTTP ----------
/// SSE events of a response body: (event, data) with multi-line data joined by '\n'.
pub fn parse_sse(body: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let (mut ev, mut data, mut any) = (String::new(), Vec::<String>::new(), false);
    for line in body.replace("\r\n", "\n").split('\n') {
        if line.is_empty() {
            if any { out.push((if ev.is_empty() { "message".into() } else { ev.clone() }, data.join("\n"))); }
            ev.clear(); data.clear(); any = false;
            continue;
        }
        if line.starts_with(':') { continue; }
        let (k, v) = line.split_once(':').unwrap_or((line, ""));
        let v = v.strip_prefix(' ').unwrap_or(v);
        match k {
            "event" => { ev = v.to_string(); any = true; }
            "data" => { data.push(v.to_string()); any = true; }
            _ => {}
        }
    }
    if any { out.push((if ev.is_empty() { "message".into() } else { ev }, data.join("\n"))); }
    out
}
/// The JSON-RPC answer in an SSE body: the last `message` event that is a response (to `id` when it has one).
pub fn sse_response(body: &str, id: u64) -> Option<Value> {
    parse_sse(body).into_iter().rev().filter(|(e, _)| e == "message").filter_map(|(_, d)| serde_json::from_str::<Value>(&d).ok())
        .find(|v| (v.get("result").is_some() || v.get("error").is_some()) && v.get("id").map(|x| x == &json!(id) || x.is_null()).unwrap_or(true))
}
/// An error of a T3 call as the frontend gets it (`t3_call` rejects with `{ message, code? }`): the readable message, never
/// T3's raw failure JSON, and T3's failure code (`OrchestratorMcpFailure.code`, e.g. `runtime_mode_escalation_denied`).
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct T3Error {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}
impl From<String> for T3Error {
    fn from(message: String) -> Self { T3Error { message, code: None } }
}
impl From<&str> for T3Error {
    fn from(message: &str) -> Self { T3Error { message: message.into(), code: None } }
}

/// T3's message in an error text: a tool failure is encoded as JSON text (`{"_tag":"OrchestratorMcpFailure","code":..,
/// "message":..}`, effect's McpServer with failureMode "return"); an HTTP error body may be `{ message }` / `{ error }`.
/// -> (message, code). Plain text stays as it is.
pub fn failure_text(text: &str) -> (String, Option<String>) {
    let s = |v: &Value, k: &str| v.get(k).and_then(|m| m.as_str()).filter(|m| !m.trim().is_empty()).map(String::from);
    if let Ok(v) = serde_json::from_str::<Value>(text.trim()) {
        if v.is_object() {
            let e = v.get("error").filter(|e| e.is_object()).unwrap_or(&v);
            if let Some(m) = s(e, "message").or_else(|| s(&v, "message")).or_else(|| s(&v, "error_description")).or_else(|| s(&v, "error")) {
                return (m, s(e, "code").or_else(|| s(&v, "code")));
            }
        }
    }
    (text.to_string(), None)
}

/// A tools/call JSON-RPC response -> the tool's result value (structuredContent, else the JSON text block).
pub fn tool_result(resp: &Value) -> Result<Value, T3Error> {
    if let Some(e) = resp.get("error") {
        return Err(format!("T3: {}", e.get("message").and_then(|m| m.as_str()).unwrap_or("error")).into());
    }
    let r = resp.get("result").ok_or("T3: empty answer")?;
    let text = r.get("content").and_then(|c| c.as_array()).and_then(|a| a.iter().find_map(|x| x.get("text").and_then(|t| t.as_str()))).unwrap_or("");
    if r.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) {
        let sc_code = r.pointer("/structuredContent/error/code").or_else(|| r.pointer("/structuredContent/code")).and_then(|c| c.as_str()).map(String::from);
        let (msg, code) = match r.pointer("/structuredContent/error/message").or_else(|| r.pointer("/structuredContent/message")).and_then(|m| m.as_str()) {
            Some(m) => (m.to_string(), sc_code),
            None if text.is_empty() => ("tool failed".to_string(), sc_code),
            None => { let (m, c) = failure_text(text); (m, c.or(sc_code)) }
        };
        return Err(T3Error { message: format!("T3: {}", msg.chars().take(500).collect::<String>()), code });
    }
    if let Some(s) = r.get("structuredContent").filter(|s| s.is_object()) {
        return Ok(s.clone());
    }
    Ok(serde_json::from_str::<Value>(text).unwrap_or_else(|_| Value::String(text.to_string())))
}

enum McpErr { Unauthorized, SessionGone, Other(String) }

fn agent(secs: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(secs)).redirects(0).build()
}

fn mcp_post(origin: &str, token: &str, session: Option<&str>, body: &Value, id: u64, secs: u64) -> Result<(Value, Option<String>), McpErr> {
    let mut req = agent(secs).post(&format!("{origin}/mcp"))
        .set("Authorization", &format!("Bearer {token}"))
        .set("Content-Type", "application/json")
        .set("Accept", "application/json, text/event-stream")
        .set("User-Agent", "gfx-studio");
    if let Some(s) = session { req = req.set("Mcp-Session-Id", s).set("MCP-Protocol-Version", "2025-06-18"); }
    match req.send_string(&body.to_string()) {
        Ok(r) => {
            let sid = r.header("mcp-session-id").map(String::from);
            let sse = r.header("content-type").unwrap_or("").contains("text/event-stream");
            let status = r.status();
            let text = r.into_string().map_err(|e| McpErr::Other(format!("T3 read: {e}")))?;
            if status == 202 || text.trim().is_empty() { return Ok((Value::Null, sid)); }
            let v = if sse { sse_response(&text, id).ok_or_else(|| McpErr::Other("T3: no answer in the event stream".into()))? }
                    else { serde_json::from_str(&text).map_err(|_| McpErr::Other("T3: answer is not JSON".into()))? };
            Ok((v, sid))
        }
        Err(ureq::Error::Status(401, _)) | Err(ureq::Error::Status(403, _)) => Err(McpErr::Unauthorized),
        Err(ureq::Error::Status(404, _)) if session.is_some() => Err(McpErr::SessionGone),
        Err(ureq::Error::Status(s, r)) => Err(McpErr::Other(format!("T3 HTTP {s}: {}", failure_text(&r.into_string().unwrap_or_default()).0.chars().take(200).collect::<String>()))),
        Err(e) => Err(McpErr::Other(format!("T3 is not reachable ({origin}): {e}"))),
    }
}

// ---------- state ----------
#[derive(Default)]
struct Connect { gen: u64, connecting: bool, error: String }
#[derive(Default)]
struct ViewState { origin: String, url: String, zoom: f64, visible: bool }
#[derive(Default)]
pub struct T3State {
    /// (origin, token fingerprint, Mcp-Session-Id)
    session: Mutex<Option<(String, String, Option<String>)>>,
    connect: Mutex<Connect>,
    view: Mutex<ViewState>,
    rpc: AtomicU64,
    cfg_lock: Mutex<()>,
}

// Hold both locks through the write so cancel / disconnect / server changes cannot race it.
fn save_connect_cfg(path: &PathBuf, t3: &T3State, gen: u64, origin: &str, update: impl FnOnce(&mut T3Config)) -> Result<(), String> {
    let _g = t3.cfg_lock.lock().unwrap();
    let k = t3.connect.lock().unwrap();
    let mut c = load_cfg(path);
    if k.gen != gen || c.origin() != origin { return Err("T3 connection cancelled or server changed".into()); }
    update(&mut c);
    save_cfg(path, &c)
}

fn fingerprint(token: &str) -> String {
    b64url(&Sha256::digest(token.as_bytes())[..8])
}

fn status_now(app_state: &AppState, t3: &T3State) -> T3Status {
    let cfg = load_cfg(&cfg_path(app_state));
    let c = t3.connect.lock().unwrap();
    status_of(&cfg, now_ms(), c.connecting, &c.error)
}

/// Call an allowlisted tool (blocking). Initializes the MCP session when needed; a 404 on a stale session re-initializes
/// once; a 401 marks the token for reconnect.
fn call_tool_blocking(app_state: &AppState, t3: &T3State, tool: &str, args: Value) -> Result<Value, T3Error> {
    let path = cfg_path(app_state);
    let cfg = load_cfg(&path);
    let st = status_of(&cfg, now_ms(), false, "");
    if !st.connected {
        return Err(if st.reconnect { "reconnect: the T3 connection expired, Reconnect T3".into() } else { "T3 is not connected".into() });
    }
    check_tool(tool, &st.level)?;
    let origin = cfg.origin();
    let fp = fingerprint(&cfg.token);
    for attempt in 0..2 {
        let session = {
            let s = t3.session.lock().unwrap();
            s.as_ref().filter(|(o, f, _)| *o == origin && *f == fp).map(|(_, _, sid)| sid.clone())
        };
        let sid = match session {
            Some(sid) => sid,
            None => {
                let id = t3.rpc.fetch_add(1, Ordering::SeqCst) + 1;
                let init = json!({ "jsonrpc": "2.0", "id": id, "method": "initialize", "params": {
                    "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "gfx-studio", "version": env!("CARGO_PKG_VERSION") } } });
                match mcp_post(&origin, &cfg.token, None, &init, id, 15) {
                    Ok((resp, sid)) => {
                        if let Some(e) = resp.get("error") { return Err(format!("T3 initialize: {}", e.get("message").and_then(|m| m.as_str()).unwrap_or("error")).into()); }
                        let _ = mcp_post(&origin, &cfg.token, sid.as_deref(), &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }), 0, 15);
                        *t3.session.lock().unwrap() = Some((origin.clone(), fp.clone(), sid.clone()));
                        sid
                    }
                    Err(McpErr::Unauthorized) => return Err(mark_reconnect(app_state, t3).into()),
                    Err(McpErr::SessionGone) => return Err("T3 initialize failed".into()),
                    Err(McpErr::Other(e)) => return Err(e.into()),
                }
            }
        };
        let id = t3.rpc.fetch_add(1, Ordering::SeqCst) + 1;
        let secs = if tool == "t3_thread_wait" { 60 } else { 30 };
        let body = json!({ "jsonrpc": "2.0", "id": id, "method": "tools/call", "params": { "name": tool, "arguments": args } });
        match mcp_post(&origin, &cfg.token, sid.as_deref(), &body, id, secs) {
            Ok((resp, _)) => {
                let out = tool_result(&resp)?;
                if tool == "t3_environment_read" {
                    if let Some(env) = out.get("environmentId").and_then(|v| v.as_str()) {
                        let _g = t3.cfg_lock.lock().unwrap();
                        let mut c = load_cfg(&path);
                        if c.environment_id != env || c.env_server != origin {
                            c.environment_id = env.into();
                            c.env_server = origin.clone();
                            let _ = save_cfg(&path, &c);
                        }
                    }
                }
                return Ok(out);
            }
            Err(McpErr::Unauthorized) => return Err(mark_reconnect(app_state, t3).into()),
            Err(McpErr::SessionGone) if attempt == 0 => { *t3.session.lock().unwrap() = None; continue; }
            Err(McpErr::SessionGone) => return Err("T3 MCP session lost".into()),
            Err(McpErr::Other(e)) => return Err(e.into()),
        }
    }
    Err("T3 call failed".into())
}

fn mark_reconnect(app_state: &AppState, t3: &T3State) -> String {
    let _g = t3.cfg_lock.lock().unwrap();
    let path = cfg_path(app_state);
    let mut c = load_cfg(&path);
    c.token.clear();
    c.needs_reconnect = true;
    let _ = save_cfg(&path, &c);
    *t3.session.lock().unwrap() = None;
    "reconnect: T3 refused the token (revoked or expired), Reconnect T3".into()
}

// ---------- commands: status / options / connect ----------
#[tauri::command]
pub fn t3_status(state: State<AppState>, t3: State<T3State>) -> T3Status {
    status_now(&state, &t3)
}

#[tauri::command]
pub fn t3_set_options(server: Option<String>, auto_create: Option<bool>, state: State<AppState>, t3: State<T3State>) -> Result<T3Status, String> {
    {
        let _g = t3.cfg_lock.lock().unwrap();
        let path = cfg_path(&state);
        let mut c = load_cfg(&path);
        if let Some(s) = server {
            let s = normalize_server(&s)?;
            let s = if s == DEFAULT_SERVER { String::new() } else { s };
            if s != c.server {
                let mut k = t3.connect.lock().unwrap();
                k.gen += 1; k.connecting = false; k.error.clear();
                // another server: the client registration, token and environment belong to the old one
                c = T3Config { server: s, auto_create: c.auto_create, ..Default::default() };
                *t3.session.lock().unwrap() = None;
            }
        }
        if let Some(a) = auto_create { c.auto_create = Some(a); }
        save_cfg(&path, &c)?;
    }
    Ok(status_now(&state, &t3))
}

#[tauri::command]
pub fn t3_disconnect(state: State<AppState>, t3: State<T3State>) -> Result<T3Status, String> {
    {
        let _g = t3.cfg_lock.lock().unwrap();
        let path = cfg_path(&state);
        let c = load_cfg(&path);
        save_cfg(&path, &T3Config { server: c.server, auto_create: c.auto_create, ..Default::default() })?;
        *t3.session.lock().unwrap() = None;
        let mut k = t3.connect.lock().unwrap();
        k.gen += 1; k.connecting = false; k.error.clear();
    }
    Ok(status_now(&state, &t3))
}

#[tauri::command]
pub fn t3_connect_cancel(state: State<AppState>, t3: State<T3State>) -> T3Status {
    { let mut k = t3.connect.lock().unwrap(); k.gen += 1; k.connecting = false; }
    status_now(&state, &t3)
}

/// Connect step 2 (docs/T3.md §2): approve gfx studio with a pairing code at `access` (a T3 `AuthMcpClientAccess`),
/// without T3's approval page: discover, register once, PKCE, `POST /oauth/mcp/decision` with the authorization request and
/// `{ _tag: "pairing-code", access, code }`, check the `redirectTo` (state, iss), exchange the code. Returns the status;
/// T3's `AuthMcpApprovalError` message (used-up code, code without the scopes for that access, ...) is the error. The code
/// and the client_id never go to a log or back to the frontend.
#[tauri::command]
pub async fn t3_connect_start<R: Runtime>(app: AppHandle<R>, access: String, code: String) -> Result<T3Status, String> {
    let app2 = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || approve_connect(&app2, &access, &code)).await.map_err(|e| e.to_string())?;
    let _ = app.emit("t3://status", json!({}));
    res?;
    Ok(status_now(&app.state::<AppState>(), &app.state::<T3State>()))
}

fn approve_connect<R: Runtime>(app: &AppHandle<R>, access: &str, code: &str) -> Result<(), String> {
    if !ACCESS.contains(&access) { return Err(format!("unknown access level: {access}")); }
    let code = check_code(code)?;
    let state = app.state::<AppState>();
    let t3 = app.state::<T3State>();
    let path = cfg_path(&state);
    let (cfg, gen) = {
        let _g = t3.cfg_lock.lock().unwrap();
        let mut k = t3.connect.lock().unwrap();
        k.gen += 1; k.connecting = true; k.error.clear();
        (load_cfg(&path), k.gen)
    };
    let res = approve_with(app, &path, &t3, gen, &cfg, access, code);
    let mut k = t3.connect.lock().unwrap();
    if k.gen == gen { k.connecting = false; }
    res
}

fn approve_with<R: Runtime>(app: &AppHandle<R>, path: &PathBuf, t3: &T3State, gen: u64, cfg: &T3Config, access: &str, code: &str) -> Result<(), String> {
    let origin = cfg.origin();
    let meta: Value = agent(10).get(&format!("{origin}/.well-known/oauth-authorization-server")).call()
        .map_err(|e| format!("T3 is not reachable at {origin} ({e}). Is T3 running?"))?
        .into_json().map_err(|e| format!("T3 metadata: {e}"))?;
    let meta = check_meta(&origin, &meta)?;
    // one registration per server and level: the name ("gfx studio · Full") labels the grant in T3 → Settings → Connections
    let name = client_name(access);
    let mut client_id = if cfg.client_server == origin && cfg.client_name == name { cfg.client_id.clone() } else { String::new() };
    if client_id.is_empty() {
        let reg = json!({ "client_name": name, "redirect_uris": [redirect_uri()],
            "grant_types": ["authorization_code"], "response_types": ["code"], "token_endpoint_auth_method": "none" });
        let r: Value = agent(10).post(&meta.registration_endpoint).send_json(reg)
            .map_err(|e| format!("T3 client registration failed: {e}"))?.into_json().map_err(|e| e.to_string())?;
        client_id = r.get("client_id").and_then(|v| v.as_str()).filter(|s| !s.is_empty()).ok_or("T3 registration returned no client_id")?.to_string();
        save_connect_cfg(&path, &t3, gen, &origin, |c| {
            c.client_id = client_id.clone();
            c.client_server = origin.clone();
            c.client_name = name.clone();
        })?;
    }
    let verifier = random_token(48)?;
    let st = random_token(24)?;
    let redirect = redirect_uri();
    let authorization = authorization_request(&client_id, &redirect, &pkce_challenge(&verifier), &st, &format!("{origin}/mcp"));
    if t3.connect.lock().unwrap().gen != gen { return Err("T3 connection cancelled or server changed".into()); }
    let r = agent(15).post(&format!("{origin}/oauth/mcp/decision")).set("User-Agent", "gfx-studio").send_json(decision_body(&authorization, access, code));
    let v: Value = match r {
        Ok(r) => r.into_json().map_err(|e| format!("T3 approval answer: {e}"))?,
        Err(ureq::Error::Status(s, r)) => {
            // AuthMcpApprovalError { message }: shown under step 2 as T3 words it (never contains the code)
            let j: Value = r.into_json().unwrap_or(Value::Null);
            let msg = j.get("message").and_then(|m| m.as_str()).filter(|m| !m.is_empty()).map(|m| m.chars().take(400).collect::<String>());
            return Err(msg.unwrap_or_else(|| format!("T3 refused the approval (HTTP {s})")));
        }
        Err(e) => return Err(format!("T3 is not reachable at {origin} ({e}). Is T3 running?")),
    };
    let redirect_to = v.get("redirectTo").and_then(|x| x.as_str()).ok_or("T3 sent no approval redirect")?;
    let auth_code = check_redirect_to(redirect_to, &st, &origin)?;
    exchange(app, &meta.token_endpoint, &auth_code, &redirect, &client_id, &verifier, &origin, gen)
}

fn exchange<R: Runtime>(app: &AppHandle<R>, token_ep: &str, code: &str, redirect: &str, client_id: &str, verifier: &str, origin: &str, gen: u64) -> Result<(), String> {
    let resource = format!("{origin}/mcp");
    let r = agent(15).post(token_ep).send_form(&[
        ("grant_type", "authorization_code"), ("code", code), ("redirect_uri", redirect), ("client_id", client_id),
        ("code_verifier", verifier), ("resource", resource.as_str()),
    ]);
    let v: Value = match r {
        Ok(r) => r.into_json().map_err(|e| format!("T3 token answer: {e}"))?,
        Err(ureq::Error::Status(s, r)) => {
            let j: Value = r.into_json().unwrap_or(Value::Null);
            return Err(format!("T3 token exchange failed (HTTP {s}): {}", j.get("error_description").or(j.get("error")).and_then(|x| x.as_str()).unwrap_or("")));
        }
        Err(e) => return Err(format!("T3 token exchange failed: {e}")),
    };
    let token = v.get("access_token").and_then(|x| x.as_str()).filter(|s| !s.is_empty()).ok_or("T3 sent no access token")?;
    let expires_in = v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(30 * 24 * 3600);
    let scope = v.get("scope").and_then(|x| x.as_str()).unwrap_or("orchestration:read").to_string();
    let state = app.state::<AppState>();
    let t3 = app.state::<T3State>();
    save_connect_cfg(&cfg_path(&state), &t3, gen, origin, |c| {
        c.client_id = client_id.into();
        c.client_server = origin.into();
        c.token = token.into();
        c.expires_at = now_ms() + expires_in * 1000;
        c.scope = scope;
        c.needs_reconnect = false;
    })?;
    *t3.session.lock().unwrap() = None;
    Ok(())
}

// ---------- commands: MCP calls, upload, paths ----------
#[tauri::command]
pub async fn t3_call<R: Runtime>(app: AppHandle<R>, tool: String, args: Option<Value>) -> Result<Value, T3Error> {
    let args = args.unwrap_or_else(|| json!({}));
    if !args.is_object() { return Err("args must be an object".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let t3 = app.state::<T3State>();
        call_tool_blocking(&state, &t3, &tool, args)
    }).await.map_err(|e| T3Error::from(e.to_string()))?
}

pub fn image_mime(rel: &str) -> Option<&'static str> {
    let l = rel.to_ascii_lowercase();
    if l.ends_with(".png") { Some("image/png") } else if l.ends_with(".jpg") || l.ends_with(".jpeg") { Some("image/jpeg") } else if l.ends_with(".webp") { Some("image/webp") } else { None }
}
/// The upload URL T3 hands out: a path on the server under /api/attachments/upload/.
pub fn check_upload_path(p: &str) -> Result<(), String> {
    let ok = p.starts_with("/api/attachments/upload/") && !p.contains("..") && !p.contains("//") && !p.contains('\\') && !p.contains('#')
        && p.chars().all(|c| c.is_ascii_graphic());
    if ok { Ok(()) } else { Err(format!("unexpected T3 upload URL: {}", p.chars().take(60).collect::<String>())) }
}

/// Upload a review image (frame still, comment markup) as a pending T3 attachment. Only images under
/// `out/<scene>/review/`. Returns the attachment descriptor for t3_thread_send_attachments / t3_thread_launch.
#[tauri::command]
pub async fn t3_upload<R: Runtime>(app: AppHandle<R>, rel: String) -> Result<Value, String> {
    crate::check_writable(&rel)?;
    let mime = image_mime(&rel).ok_or("only png / jpg / webp images can be sent to T3")?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let t3 = app.state::<T3State>();
        let root = state.root.lock().unwrap().clone();
        let p = crate::join_safe(&root, &rel)?;
        let bytes = std::fs::read(&p).map_err(|e| format!("{rel}: {e}"))?;
        if bytes.is_empty() || bytes.len() as u64 > MAX_UPLOAD { return Err(format!("{rel}: size must be 1 byte to 10 MB")); }
        let name = rel.rsplit('/').next().unwrap_or("image.png").to_string();
        let prep = call_tool_blocking(&state, &t3, "t3_attachment_prepare_upload",
            json!({ "upload": { "type": "image", "name": name, "mimeType": mime, "sizeBytes": bytes.len() } })).map_err(|e| e.message)?;
        let id = prep.get("attachmentId").and_then(|v| v.as_str()).ok_or("T3 gave no attachment id")?.to_string();
        let rel_url = prep.get("relativeUrl").and_then(|v| v.as_str()).ok_or("T3 gave no upload URL")?;
        check_upload_path(rel_url)?;
        let origin = load_cfg(&cfg_path(&state)).origin();
        match agent(60).post(&format!("{origin}{rel_url}")).set("Content-Type", mime).send_bytes(&bytes) {
            Ok(_) => {}
            Err(ureq::Error::Status(s, r)) => return Err(format!("T3 upload failed (HTTP {s}): {}", failure_text(&r.into_string().unwrap_or_default()).0.chars().take(200).collect::<String>())),
            Err(e) => return Err(format!("T3 upload failed: {e}")),
        }
        Ok(json!({ "type": "image", "id": id, "name": name, "mimeType": mime, "sizeBytes": bytes.len() }))
    }).await.map_err(|e| e.to_string())?
}

/// WSL paths of the current project and its folder (the "All in folder" prefix).
#[tauri::command]
pub fn t3_paths(state: State<AppState>) -> Result<Value, String> {
    let root = state.root.lock().unwrap().clone();
    let project = wsl_path(&root)?;
    // a git worktree: `.git` is a file pointing into the main repo (docs/T3.md §1 matching)
    let git = std::path::Path::new(&root).join(".git");
    let git_main = if git.is_file() { std::fs::read_to_string(&git).ok().and_then(|t| git_main_from(&t, &project)) } else { None };
    Ok(json!({ "project": project, "folder": parent_posix(&project), "gitMain": git_main }))
}

// ---------- the T3 view (native child webview) ----------
/// Where the T3 view may go: the T3 server, about:blank. Everything else opens outside.
pub fn view_nav_allowed(url: &str, origin: &str) -> bool {
    url == "about:blank" || url == origin || url.starts_with(&format!("{origin}/"))
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ViewOpts {
    pub url: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub visible: bool,
    pub window: Option<String>,
    pub zoom: Option<f64>,
    /// Create the view even when hidden, at about:blank (connect: `t3_view_session` reads its cookie store; nothing of T3
    /// loads until it is shown with a URL or `t3_view_pair` navigates it).
    pub create: Option<bool>,
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: PhysicalPosition::new(x.round() as i32, y.round() as i32).into(),
        size: PhysicalSize::new(w.max(1.0).round() as u32, h.max(1.0).round() as u32).into(),
    }
}

fn open_outside(url: &str) {
    if url.starts_with("http://") || url.starts_with("https://") {
        if check_link(url).is_ok() { let _ = crate::claude::open_link(url.to_string()); }
    }
}

fn view_info<R: Runtime>(app: &AppHandle<R>) -> Value {
    let Some(wv) = app.get_webview(VIEW) else { return json!({ "exists": false }) };
    let v = app.state::<T3State>();
    let v = v.view.lock().unwrap();
    let pos = wv.position().ok();
    let size = wv.size().ok();
    json!({ "exists": true, "parent": wv.window().label(), "x": pos.map(|p| p.x), "y": pos.map(|p| p.y), "w": size.map(|s| s.width), "h": size.map(|s| s.height),
            "visible": v.visible, "zoom": v.zoom })
}

/// Create / move / show / hide the T3 view. Bounds are physical pixels in the host window's client area (panel rect ×
/// devicePixelRatio). `window` = label of the window holding the panel (main or a dock pop-out: the view is reparented).
/// `url` must be on the T3 server; it navigates only when it differs from the last requested URL.
#[tauri::command]
pub async fn t3_view<R: Runtime>(app: AppHandle<R>, opts: ViewOpts) -> Result<Value, String> {
    let origin = load_cfg(&cfg_path(&app.state::<AppState>())).origin();
    if let Some(u) = &opts.url {
        if !(u == &origin || u.starts_with(&format!("{origin}/"))) || u.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err(format!("the T3 view only shows {origin}"));
        }
    }
    let label = opts.window.clone().unwrap_or_else(|| "main".into());
    if label != "main" && !crate::popout::is_popout_label(&label) { return Err(format!("not a studio window: {label}")); }
    let t3 = app.state::<T3State>();
    let mut wv = app.get_webview(VIEW);
    if wv.is_some() && t3.view.lock().unwrap().origin != origin {
        if let Some(w) = wv.take() { let _ = w.close(); } // server address changed
    }
    let win = app.get_window(&label).ok_or(format!("no window {label}"))?;
    let wv = match wv {
        Some(w) => w,
        None => {
            let hidden = !opts.visible;
            if hidden && opts.create != Some(true) { return Ok(view_info(&app)); }
            let url = if hidden { String::new() } else { opts.url.clone().ok_or("the T3 view needs a URL")? };
            let u: tauri::Url = if hidden { "about:blank".parse() } else { url.parse() }.map_err(|e| format!("{e}"))?;
            let (o1, o2) = (origin.clone(), origin.clone());
            let b = WebviewBuilder::new(VIEW, WebviewUrl::External(u))
                .disable_drag_drop_handler()
                .on_navigation(move |u| { let ok = view_nav_allowed(u.as_str(), &o1); if !ok { open_outside(u.as_str()); } ok })
                .on_new_window(move |u, _f| { if !view_nav_allowed(u.as_str(), &o2) || u.as_str().starts_with("http") { open_outside(u.as_str()); } NewWindowResponse::Deny });
            let w = win.add_child(b, PhysicalPosition::new(opts.x as i32, opts.y as i32), PhysicalSize::new(opts.w.max(1.0) as u32, opts.h.max(1.0) as u32))
                .map_err(|e| format!("T3 view: {e}"))?;
            let mut v = t3.view.lock().unwrap();
            *v = ViewState { origin: origin.clone(), url, zoom: 1.0, visible: true };
            w
        }
    };
    if wv.window().label() != label {
        wv.reparent(&win).map_err(|e| e.to_string())?;
    }
    if let Some(u) = &opts.url {
        let mut v = t3.view.lock().unwrap();
        if &v.url != u {
            wv.navigate(u.parse().map_err(|e| format!("{e}"))?).map_err(|e| e.to_string())?;
            v.url = u.clone();
        }
    }
    wv.set_bounds(rect(opts.x, opts.y, opts.w, opts.h)).map_err(|e| e.to_string())?;
    if opts.visible { wv.show() } else { wv.hide() }.map_err(|e| e.to_string())?;
    {
        let mut v = t3.view.lock().unwrap();
        v.visible = opts.visible;
        if let Some(z) = opts.zoom.filter(|z| z.is_finite() && *z >= 0.3 && *z <= 3.0) {
            if (z - v.zoom).abs() > 1e-3 {
                wv.set_zoom(z).map_err(|e| e.to_string())?;
                v.zoom = z;
            }
        }
    }
    Ok(view_info(&app))
}

/// Before a pop-out window closes: move the T3 view it holds back to the main window, hidden (the frontend re-places it).
pub fn rescue_view<R: Runtime>(app: &AppHandle<R>, window: &str) {
    let Some(wv) = app.get_webview(VIEW) else { return };
    if wv.window().label() != window { return; }
    if let Some(main) = app.get_window("main") {
        let _ = wv.hide();
        let _ = wv.reparent(&main);
        app.state::<T3State>().view.lock().unwrap().visible = false;
    }
}

#[tauri::command]
pub async fn t3_view_info<R: Runtime>(app: AppHandle<R>) -> Value {
    view_info(&app)
}

/// `Cookie:` header value from (name, value) pairs; pairs with characters that can't be in a cookie are skipped.
pub fn cookie_header(pairs: &[(String, String)]) -> String {
    let ok = |s: &str| !s.is_empty() && !s.chars().any(|c| c.is_control() || c == ';' || c == '\r' || c == '\n');
    pairs.iter().filter(|(n, v)| ok(n) && !n.contains('=') && (v.is_empty() || ok(v))).map(|(n, v)| format!("{n}={v}")).collect::<Vec<_>>().join("; ")
}
/// T3's `GET /api/auth/session` answer: signed in = `authenticated: true`.
pub fn session_signed_in(v: &Value) -> bool {
    v.get("authenticated").and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Is the T3 view signed in to T3 (docs/T3.md §2 step 1)? The session cookie is httpOnly, so the page can't tell: Rust
/// reads the view's cookies for the server and asks T3's `GET /api/auth/session` with them (read-only). Only
/// `{ view, signedIn }` goes back; the cookie never leaves Rust. No view → `{ view: false, signedIn: false }`.
#[tauri::command]
pub async fn t3_view_session<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    let origin = load_cfg(&cfg_path(&app.state::<AppState>())).origin();
    let Some(wv) = app.get_webview(VIEW) else { return Ok(json!({ "view": false, "signedIn": false })) };
    if app.state::<T3State>().view.lock().unwrap().origin != origin { return Ok(json!({ "view": false, "signedIn": false })); }
    let url: tauri::Url = format!("{origin}/").parse().map_err(|e| format!("{e}"))?;
    // WebView2 cookie reads must not run on the main thread (wry#583): a blocking worker
    let cookies = tauri::async_runtime::spawn_blocking(move || wv.cookies_for_url(url).map_err(|e| e.to_string()))
        .await.map_err(|e| e.to_string())??;
    let pairs: Vec<(String, String)> = cookies.iter().map(|c| (c.name().to_string(), c.value().to_string())).collect();
    let header = cookie_header(&pairs);
    if header.is_empty() { return Ok(json!({ "view": true, "signedIn": false })); }
    let signed = tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        match agent(8).get(&format!("{origin}/api/auth/session")).set("Cookie", &header).call() {
            Ok(r) => Ok(session_signed_in(&r.into_json::<Value>().unwrap_or(Value::Null))),
            Err(ureq::Error::Status(_, _)) => Ok(false),
            Err(e) => Err(format!("T3 is not reachable at {origin} ({e})")),
        }
    }).await.map_err(|e| e.to_string())??;
    Ok(json!({ "view": true, "signedIn": signed }))
}

/// `<server>/pair#token=<code>`: T3's pairing page, which signs the browser in with the token in its hash by itself
/// (PairingRouteSurface auto-submits it; an explicit pairing link also replaces a session the browser already has).
/// `attempt` goes in the query so every try is a new document load: after a rejected code T3 stays on `/pair` and
/// strips the fragment, and a fragment-only change would not remount the page that submits the token.
pub fn pair_url(origin: &str, code: &str, attempt: u64) -> String {
    format!("{origin}/pair?attempt={attempt}#token={}", pct(code))
}
static PAIR_ATTEMPT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Connect step 1 (docs/T3.md §2): sign the T3 view in with a pairing code by loading T3's `/pair#token=<code>` in it.
/// The URL is built here from the configured server (never from a pasted link) and is not kept or logged; the frontend
/// then waits for `t3_view_session` to report the view signed in. The view must exist (`t3_view` with `create`).
#[tauri::command]
pub async fn t3_view_pair<R: Runtime>(app: AppHandle<R>, code: String) -> Result<(), String> {
    let origin = load_cfg(&cfg_path(&app.state::<AppState>())).origin();
    let code = check_code(&code)?;
    let wv = app.get_webview(VIEW).ok_or("the T3 view is not open")?;
    let t3 = app.state::<T3State>();
    if t3.view.lock().unwrap().origin != origin { return Err("the T3 view belongs to another server; connect again".into()); }
    let n = PAIR_ATTEMPT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    wv.navigate(pair_url(&origin, code, n).parse().map_err(|_| "bad T3 server address".to_string())?).map_err(|e| e.to_string())?;
    t3.view.lock().unwrap().url.clear(); // the next requested URL navigates again
    Ok(())
}

#[tauri::command]
pub async fn t3_view_close<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    if let Some(w) = app.get_webview(VIEW) { w.close().map_err(|e| e.to_string())?; }
    *app.state::<T3State>().view.lock().unwrap() = ViewState::default();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_mapping() {
        assert_eq!(wsl_path(r"C:\Users\alex\dev\gfx-projects\foo").unwrap(), "/mnt/c/Users/alex/dev/gfx-projects/foo");
        assert_eq!(wsl_path(r"D:\").unwrap(), "/mnt/d");
        assert_eq!(wsl_path("c:/a/b/").unwrap(), "/mnt/c/a/b");
        assert_eq!(wsl_path(r"\\?\C:\a\b").unwrap(), "/mnt/c/a/b");
        assert_eq!(wsl_path(r"\\wsl.localhost\Ubuntu\home\alex\proj").unwrap(), "/home/alex/proj");
        assert_eq!(wsl_path(r"\\wsl$\Ubuntu-22.04\home\k\p\").unwrap(), "/home/k/p");
        assert_eq!(wsl_path(r"\\?\UNC\wsl.localhost\Ubuntu\x").unwrap(), "/x");
        assert_eq!(wsl_path("/home/alex/graphics/proj").unwrap(), "/home/alex/graphics/proj");
        assert_eq!(wsl_path("/home/k//p/./q/").unwrap(), "/home/k/p/q");
        for bad in [r"\\server\share\x", "relative\\path", "", "1:\\x"] { assert!(wsl_path(bad).is_err(), "{bad}"); }
        assert_eq!(parent_posix("/mnt/c/Users/alex/dev/gfx-projects/foo"), "/mnt/c/Users/alex/dev/gfx-projects");
        assert_eq!(parent_posix("/x"), "/");
        assert!(in_folder("/mnt/c/dev/gfx/foo", "/mnt/c/dev/gfx"));
        assert!(in_folder("/mnt/c/dev/gfx/foo/bar", "/mnt/c/dev/gfx/"));
        assert!(!in_folder("/mnt/c/dev/gfx-other/foo", "/mnt/c/dev/gfx"));
        assert!(!in_folder("/mnt/c/dev/gfx", "/mnt/c/dev/gfx"));
    }

    #[test]
    fn pkce_and_redirect_uri() {
        // RFC 7636 appendix B
        assert_eq!(pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let a = random_token(48).unwrap();
        let b = random_token(48).unwrap();
        assert!(a != b && a.len() == 64 && a.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
        assert_eq!(redirect_uri(), "http://127.0.0.1/gfx-studio/callback");
    }

    #[test]
    fn decision_request() {
        let a = authorization_request("cid.sig/+=", &redirect_uri(), "CH", "ST", "http://127.0.0.1:3773/mcp");
        let body = decision_body(&a, "auto-accept-edits", "ABCD2345EFGH");
        assert_eq!(body, json!({
            "authorization": { "response_type": "code", "client_id": "cid.sig/+=", "redirect_uri": "http://127.0.0.1/gfx-studio/callback",
                "code_challenge": "CH", "code_challenge_method": "S256", "scope": "orchestration:read orchestration:operate",
                "state": "ST", "resource": "http://127.0.0.1:3773/mcp" },
            "decision": { "_tag": "pairing-code", "access": "auto-accept-edits", "code": "ABCD2345EFGH" } }));
        for a in ["read-only", "auto-accept-edits", "full-access"] { assert!(ACCESS.contains(&a)); }
        assert!(!ACCESS.contains(&"standard"), "T3 has no 'standard' access literal");
        assert_eq!(check_code("  ABCD2345EFGH \n").unwrap(), "ABCD2345EFGH");
        for bad in ["", "abc", "two words", "x\u{7f}yz1", &"x".repeat(300)] { assert!(check_code(bad).is_err(), "{bad:?}"); }
        assert_eq!(pair_url("http://127.0.0.1:3773", "AB+C/D=E", 1), "http://127.0.0.1:3773/pair?attempt=1#token=AB%2BC%2FD%3DE");
        assert_ne!(pair_url("http://h", "x", 1).split('#').next(), pair_url("http://h", "x", 2).split('#').next()); // retries reload
    }

    #[test]
    fn decision_redirect() {
        let iss = "http://127.0.0.1:3773";
        let ok = "http://127.0.0.1/gfx-studio/callback?code=C%2B1&state=ST&iss=http%3A%2F%2F127.0.0.1%3A3773";
        assert_eq!(check_redirect_to(ok, "ST", iss).unwrap(), "C+1", "code + state match");
        assert_eq!(check_redirect_to("http://127.0.0.1:9/gfx-studio/callback?code=C&state=ST", "ST", iss).unwrap(), "C", "a port is ignored");
        assert!(check_redirect_to("http://127.0.0.1/gfx-studio/callback?code=C&state=OTHER", "ST", iss).unwrap_err().contains("wrong state"), "state mismatch");
        assert!(check_redirect_to("http://127.0.0.1/gfx-studio/callback?code=C&state=ST&iss=http%3A%2F%2Fevil", "ST", iss).unwrap_err().contains("issuer"));
        assert_eq!(check_redirect_to("http://127.0.0.1/gfx-studio/callback?error=access_denied&state=ST", "ST", iss).unwrap_err(), "access denied in T3");
        assert_eq!(check_redirect_to("http://127.0.0.1/gfx-studio/callback?error=invalid_request&error_description=PKCE+is+required&state=ST", "ST", iss).unwrap_err(),
            "T3: invalid_request PKCE is required", "error redirect");
        for bad in ["http://127.0.0.1.evil/gfx-studio/callback?code=C&state=ST", "https://127.0.0.1/gfx-studio/callback?code=C&state=ST", "http://evil/x", "", "http://127.0.0.1:x/gfx-studio/callback?code=C&state=ST"] {
            assert!(check_redirect_to(bad, "ST", iss).is_err(), "{bad}");
        }
        assert!(check_redirect_to("http://127.0.0.1/other?code=C&state=ST", "ST", iss).is_err());
    }

    #[test]
    fn callback_checks() {
        let iss = "http://127.0.0.1:3773";
        assert_eq!(check_callback("/gfx-studio/callback?code=abc%2Bd&state=S1&iss=http%3A%2F%2F127.0.0.1%3A3773", "S1", iss).unwrap(), "abc+d");
        assert_eq!(check_callback("/gfx-studio/callback?code=x&state=S1", "S1", iss).unwrap(), "x");
        assert!(check_callback("/gfx-studio/callback?code=x&state=S2", "S1", iss).unwrap_err().contains("wrong state"));
        assert!(check_callback("/gfx-studio/callback?code=x", "S1", iss).is_err());
        assert!(check_callback("/gfx-studio/callback?code=x&state=S1&iss=http%3A%2F%2Fevil", "S1", iss).unwrap_err().contains("issuer"));
        assert_eq!(check_callback("/gfx-studio/callback?error=access_denied&state=S1", "S1", iss).unwrap_err(), "access denied in T3");
        assert!(check_callback("/gfx-studio/callback?state=S1", "S1", iss).is_err());
        assert!(check_callback("/favicon.ico", "S1", iss).is_err());
        assert!(check_callback("/gfx-studio/callbackX?code=x&state=S1", "S1", iss).is_err());
    }

    #[test]
    fn metadata_checks() {
        let o = "http://127.0.0.1:3773";
        let m = json!({ "issuer": o, "authorization_endpoint": format!("{o}/oauth/mcp/authorize"), "token_endpoint": "/oauth/mcp/token",
            "registration_endpoint": format!("{o}/oauth/mcp/register"), "code_challenge_methods_supported": ["S256"] });
        let a = check_meta(o, &m).unwrap();
        assert_eq!(a.token_endpoint, format!("{o}/oauth/mcp/token"));
        let mut bad = m.clone(); bad["token_endpoint"] = json!("http://evil.example/token");
        assert!(check_meta(o, &bad).is_err());
        let mut bad = m.clone(); bad["issuer"] = json!("http://localhost:3773");
        assert!(check_meta(o, &bad).is_err());
        let mut bad = m.clone(); bad["authorization_endpoint"] = json!("http://127.0.0.1:37730/x");
        assert!(check_meta(o, &bad).is_err());
        let mut bad = m; bad["code_challenge_methods_supported"] = json!(["plain"]);
        assert!(check_meta(o, &bad).is_err());
    }

    #[test]
    fn sse_parsing() {
        let body = ": keepalive\n\nevent: message\nid: 1\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":7,\r\ndata: \"result\":{\"ok\":1}}\r\n\r\nevent: ping\ndata: {}\n";
        let ev = parse_sse(body);
        assert_eq!(ev.len(), 3);
        assert_eq!(ev[1].0, "message");
        assert_eq!(ev[1].1, "{\"jsonrpc\":\"2.0\",\"id\":7,\n\"result\":{\"ok\":1}}");
        assert_eq!(sse_response(body, 7).unwrap()["result"]["ok"], 1);
        assert!(sse_response(body, 8).is_none());
        let two = "data: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"n\":1}}\n\ndata: {\"jsonrpc\":\"2.0\",\"id\":3,\"result\":{\"n\":2}}\n\n";
        assert_eq!(sse_response(two, 3).unwrap()["result"]["n"], 2, "the last message event wins");
    }

    #[test]
    fn tool_results() {
        let ok = json!({ "jsonrpc": "2.0", "id": 1, "result": { "content": [{ "type": "text", "text": "{\"threads\":[]}" }] } });
        assert_eq!(tool_result(&ok).unwrap(), json!({ "threads": [] }));
        let sc = json!({ "result": { "content": [{ "type": "text", "text": "x" }], "structuredContent": { "a": 1 } } });
        assert_eq!(tool_result(&sc).unwrap(), json!({ "a": 1 }));
        let err = json!({ "result": { "isError": true, "content": [{ "type": "text", "text": "boom" }] } });
        assert_eq!(tool_result(&err).unwrap_err(), T3Error::from("T3: boom"));
        let rpc = json!({ "error": { "code": -32601, "message": "no such tool" } });
        assert_eq!(tool_result(&rpc).unwrap_err(), T3Error::from("T3: no such tool"));
    }

    #[test]
    fn tool_failures_show_the_message() {
        // a declared tool failure (effect McpServer, failureMode "return"): JSON text, no structuredContent
        let text = r#"{"_tag":"OrchestratorMcpFailure","code":"runtime_mode_escalation_denied","message":"Child runtime mode full-access is broader than parent mode auto-accept-edits."}"#;
        let e = tool_result(&json!({ "result": { "isError": true, "content": [{ "type": "text", "text": text }] } })).unwrap_err();
        assert_eq!(e.message, "T3: Child runtime mode full-access is broader than parent mode auto-accept-edits.");
        assert_eq!(e.code.as_deref(), Some("runtime_mode_escalation_denied"));
        let j = serde_json::to_value(&e).unwrap();
        assert_eq!(j, json!({ "message": e.message, "code": "runtime_mode_escalation_denied" }), "the frontend gets {{ message, code }}");
        assert!(!e.message.contains("_tag") && !e.message.contains('{'), "never the raw JSON");
        // structuredContent error (image tools) with a code
        let sc = json!({ "result": { "isError": true, "structuredContent": { "error": { "_tag": "X", "code": "invalid_request", "message": "bad" } }, "content": [{ "type": "text", "text": "bad" }] } });
        assert_eq!(tool_result(&sc).unwrap_err(), T3Error { message: "T3: bad".into(), code: Some("invalid_request".into()) });
        // plain errors: no code, serialized without it
        let plain = tool_result(&json!({ "result": { "isError": true, "content": [{ "type": "text", "text": "Pass modelSelection: x" }] } })).unwrap_err();
        assert_eq!(serde_json::to_value(&plain).unwrap(), json!({ "message": "T3: Pass modelSelection: x" }));
        assert_eq!(failure_text(r#"{"error":"invalid_token"}"#), ("invalid_token".to_string(), None));
        assert_eq!(failure_text(r#"{"_tag":"AuthMcpApprovalError","message":"used up"}"#).0, "used up");
        assert_eq!(failure_text("not json").0, "not json");
        assert_eq!(failure_text(r#"{"no":"message"}"#).0, r#"{"no":"message"}"#);
    }

    #[test]
    fn client_names_carry_the_level() {
        assert_eq!(client_name("full-access"), "gfx studio · Full");
        assert_eq!(client_name("auto-accept-edits"), "gfx studio · Standard");
        assert_eq!(client_name("read-only"), "gfx studio · Read only");
        for a in ACCESS { assert!(client_name(a).starts_with("gfx studio · "), "{a}"); }
        assert_eq!(client_name("nope"), "gfx studio");
    }

    #[test]
    fn project_matching() {
        let roots = ["/home/k/repo", "/home/k/repo/.claude/worktrees/wt", "/home/k", "/a/b"];
        assert_eq!(match_project(&roots, "/home/k/repo/.claude/worktrees/wt", None), Some((1, true)), "exact beats parent");
        assert_eq!(match_project(&roots, "/home/k/repo/.claude/worktrees/other", None), Some((0, false)), "longest parent wins");
        assert_eq!(match_project(&roots, "/home/k/x", None), Some((2, false)));
        assert_eq!(match_project(&roots, "/a/bc", None), None, "/a/b is not a parent of /a/bc");
        assert_eq!(match_project(&roots, "/a/b/", None), Some((3, true)));
        assert_eq!(match_project(&roots, "/srv/wt", Some("/home/k/repo")), Some((0, false)), "worktree elsewhere -> its main repo");
        assert_eq!(match_project(&roots, "/srv/wt", Some("/srv/none")), None);
        assert_eq!(match_project(&[], "/x", None), None);
        assert!(is_parent_or_same("/a/b", "/a/b/c") && !is_parent_or_same("/a/b", "/a/bc") && is_parent_or_same("/", "/x"));
        assert_eq!(git_main_from("gitdir: /home/k/repo/.git/worktrees/wt\n", "/home/k/repo/.claude/worktrees/wt").as_deref(), Some("/home/k/repo"));
        assert_eq!(git_main_from("gitdir: ../../../.git/worktrees/wt", "/home/k/repo/.claude/worktrees/wt").as_deref(), Some("/home/k/repo"));
        assert_eq!(git_main_from("gitdir: C:/dev/repo/.git/worktrees/x", "/mnt/c/dev/x").as_deref(), Some("/mnt/c/dev/repo"));
        assert_eq!(git_main_from("gitdir: /home/k/sub/.git/modules/m", "/home/k/sub/m"), None, "a submodule is not a worktree");
        assert_eq!(git_main_from("nothing", "/x"), None);
    }

    #[test]
    fn view_session_probe() {
        let p = |a: &[(&str, &str)]| a.iter().map(|(n, v)| (n.to_string(), v.to_string())).collect::<Vec<_>>();
        assert_eq!(cookie_header(&p(&[("t3_session_3773", "abc.def"), ("other", "1")])), "t3_session_3773=abc.def; other=1");
        assert_eq!(cookie_header(&p(&[("bad;name", "x"), ("a=b", "x"), ("ok", "v\r\nX-Evil: 1"), ("", "x"), ("e", "")])), "e=");
        assert_eq!(cookie_header(&[]), "");
        assert!(session_signed_in(&json!({ "authenticated": true, "auth": {} })));
        assert!(!session_signed_in(&json!({ "authenticated": false })));
        assert!(!session_signed_in(&json!({ "authenticated": "true" })));
        assert!(!session_signed_in(&Value::Null));
    }

    #[test]
    fn allowlist() {
        for t in READ_TOOLS { assert!(check_tool(t, "read-only").is_ok()); assert!(check_tool(t, "").is_err()); }
        for t in OPERATE_TOOLS { assert!(check_tool(t, "read-only").is_err()); assert!(check_tool(t, "standard").is_ok()); assert!(check_tool(t, "full").is_ok()); }
        assert!(check_tool("t3_project_create", "standard").is_err());
        assert!(check_tool("t3_project_create", "full").is_ok());
        for t in ["t3_project_delete", "t3_thread_interrupt", "t3_thread_update", "t3_queue_cancel", "t3_attachment_discard", "t3_thread_organize", "delete", "", "t3_thread_list "] {
            assert!(check_tool(t, "full").unwrap_err().starts_with("tool not allowed"), "{t}");
        }
    }

    #[test]
    fn levels_and_status_never_leak_secrets() {
        assert_eq!(level_of("orchestration:read"), "read-only");
        assert_eq!(level_of("orchestration:read orchestration:operate"), "standard");
        assert_eq!(level_of("orchestration:read orchestration:operate settings:write source-control:write"), "full");
        assert_eq!(level_of(""), "");
        let now = 1_000_000;
        let cfg = T3Config { client_id: "CLIENT-SECRET-ID".into(), client_server: DEFAULT_SERVER.into(), token: "TOKEN-SECRET-123".into(), expires_at: now + 5000,
            scope: "orchestration:read orchestration:operate settings:write".into(), environment_id: "env1".into(), env_server: DEFAULT_SERVER.into(), ..Default::default() };
        let s = status_of(&cfg, now, false, "");
        assert!(s.connected && s.level == "full" && s.auto_create && s.environment_id == "env1" && !s.reconnect);
        let j = serde_json::to_string(&s).unwrap();
        assert!(!j.contains("TOKEN-SECRET") && !j.contains("CLIENT-SECRET"), "{j}");
        let expired = status_of(&cfg, now + 6000, false, "");
        assert!(!expired.connected && expired.reconnect && expired.level.is_empty());
        let off = status_of(&T3Config { auto_create: Some(false), ..cfg.clone() }, now, false, "");
        assert!(!off.auto_create);
        let std_ = status_of(&T3Config { scope: "orchestration:read orchestration:operate".into(), ..cfg.clone() }, now, false, "");
        assert!(std_.level == "standard" && !std_.auto_create);
        let revoked = status_of(&T3Config { token: String::new(), needs_reconnect: true, ..cfg }, now, false, "");
        assert!(!revoked.connected && revoked.reconnect);
        assert!(!status_of(&T3Config::default(), now, false, "").reconnect);
    }

    #[test]
    fn server_and_view_guards() {
        assert_eq!(normalize_server("http://127.0.0.1:3773/").unwrap(), "http://127.0.0.1:3773");
        assert_eq!(normalize_server("").unwrap(), "");
        assert!(normalize_server("http://example.com:3773").is_err());
        assert!(normalize_server("http://127.0.0.1:3773/mcp").is_err());
        let o = "http://127.0.0.1:3773";
        assert!(view_nav_allowed("http://127.0.0.1:3773/env/thread?embed=compact", o));
        assert!(view_nav_allowed("http://127.0.0.1:3773", o));
        assert!(view_nav_allowed("http://127.0.0.1:3773/pair#token=X", o));
        assert!(!view_nav_allowed("http://127.0.0.1:51234/gfx-studio/callback?code=x&state=y", o), "no loopback callback any more");
        assert!(!view_nav_allowed("http://127.0.0.1:37731/", o));
        assert!(!view_nav_allowed("http://127.0.0.1:51234/other", o));
        assert!(!view_nav_allowed("https://github.com/x", o));
        assert!(!view_nav_allowed("http://127.0.0.1:3773.evil.com/", o));
        assert!(check_upload_path("/api/attachments/upload/eyJ.sig").is_ok());
        for bad in ["/api/other", "http://evil/api/attachments/upload/x", "/api/attachments/upload/../x", "/api/attachments/upload//x", "/api/attachments/upload/a b"] {
            assert!(check_upload_path(bad).is_err(), "{bad}");
        }
        assert_eq!(image_mime("out/a/review/shots/c1.PNG"), Some("image/png"));
        assert_eq!(image_mime("out/a/review/x.json"), None);
    }

    #[test]
    fn stale_connect_cannot_save_credentials() {
        let dir = std::env::temp_dir().join(format!("gfx-t3-stale-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("t3.json");
        let t3 = T3State::default();
        let cfg = T3Config::default();
        save_cfg(&path, &cfg).unwrap();
        let save = |gen, origin: &str| save_connect_cfg(&path, &t3, gen, origin, |c| {
            c.token = "token".into(); c.client_id = "client".into(); c.client_server = origin.into();
        });
        // Cancel, Disconnect and a newer flow invalidate the old generation on the same server.
        t3.connect.lock().unwrap().gen += 1;
        assert!(save(0, DEFAULT_SERVER).is_err());
        assert_eq!(load_cfg(&path), cfg);
        // Even a matching generation cannot store server A's credentials under server B.
        let other = T3Config { server: "http://127.0.0.1:3799".into(), ..Default::default() };
        save_cfg(&path, &other).unwrap();
        assert!(save(1, DEFAULT_SERVER).is_err());
        assert_eq!(load_cfg(&path), other);
        save(1, &other.origin()).unwrap();
        assert_eq!(load_cfg(&path).token, "token");
        assert_eq!(load_cfg(&path).client_server, other.origin());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn config_roundtrip() {
        let dir = std::env::temp_dir().join(format!("gfx-t3-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t3.json");
        let c = T3Config { server: "http://127.0.0.1:3799".into(), token: "t".into(), auto_create: Some(false), ..Default::default() };
        save_cfg(&p, &c).unwrap();
        assert_eq!(load_cfg(&p), c);
        std::fs::write(&p, "{\"server\":\"x\",\"unknown\":1}").unwrap();
        assert_eq!(load_cfg(&p).server, "x");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
