//! Claude in the app (docs/CLAUDE-IN-APP.md §3): terminals (PTY), terminal settings, link opener, URL guards (T3: t3.rs).
use crate::{kill_tree, resolve_engine, sh_quote, valid_job_id, wsl_root_engine, wsl_target, AppState, CmdSpec};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, State};

// ---------- settings ----------
/// Machine settings (`<app config dir>/settings.json`, docs/HOME-SETTINGS.md §2). `shell` / `claudeCommand` are always
/// present ('' = default); every other setting is in `prefs` only when it was set (validated by `prefs::check_pref`).
/// Reading goes through `prefs::sanitize_machine`: unknown keys (the old T3 webhook fields) and invalid values are dropped.
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(from = "serde_json::Map<String, serde_json::Value>", into = "serde_json::Map<String, serde_json::Value>")]
pub struct Settings {
    /// Native projects only: shell command line (empty = pwsh.exe if on PATH, else powershell.exe).
    pub shell: String,
    /// Typed into the terminal by the Claude button (empty = `claude`).
    pub claude_command: String,
    /// The other settings (onStart, projectsDir, editor, render*, uiZoom, ...), see prefs.rs SCHEMA.
    pub prefs: std::collections::BTreeMap<String, serde_json::Value>,
}
impl From<serde_json::Map<String, serde_json::Value>> for Settings {
    fn from(m: serde_json::Map<String, serde_json::Value>) -> Self { crate::prefs::sanitize_machine(&m) }
}
impl From<Settings> for serde_json::Map<String, serde_json::Value> {
    fn from(s: Settings) -> Self {
        let mut m = serde_json::Map::new();
        m.insert("shell".into(), s.shell.into());
        m.insert("claudeCommand".into(), s.claude_command.into());
        for (k, v) in s.prefs { m.insert(k, v); }
        m
    }
}
impl Settings {
    pub fn pref_str(&self, key: &str) -> Option<&str> { self.prefs.get(key).and_then(|v| v.as_str()) }
}

pub use crate::prefs::{load_settings, settings_path};

// ---------- URL guards ----------
/// Host parsed by ureq's own URL parser; reject ambiguous separators and credentials first.
pub fn url_host(url: &str) -> Option<(String, String)> {
    if url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return None;
    }
    let (_, rest) = url.split_once("://")?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let parsed = ureq::post(url).request_url().ok()?;
    let parsed = parsed.as_url();
    let host = parsed.host_str()?.trim_start_matches('[').trim_end_matches(']');
    Some((parsed.scheme().to_string(), host.to_ascii_lowercase()))
}

/// Server URLs we talk to (the T3 server address): any `https://` URL, or `http://` to this machine only (127.0.0.1 / localhost / ::1).
pub fn check_post_url(url: &str) -> Result<(), String> {
    let bad = || format!("only https:// URLs or http://127.0.0.1 / localhost are allowed: {url}");
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(bad());
    }
    let (scheme, host) = url_host(url).ok_or_else(bad)?;
    match scheme.as_str() {
        "https" => Ok(()),
        "http" if host == "127.0.0.1" || host == "localhost" || host == "::1" => Ok(()),
        _ => Err(bad()),
    }
}

/// Links the OS may open: http(s) and T3 deep links (schemes starting with `t3`).
pub fn check_link(url: &str) -> Result<(), String> {
    let bad = || format!("not an http(s), t3 or vscode file link: {url}");
    if url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"') {
        return Err(bad());
    }
    let (scheme, rest) = url.split_once(':').ok_or_else(bad)?;
    let scheme = scheme.to_ascii_lowercase();
    let scheme_ok = !scheme.is_empty() && scheme.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '+' || c == '.');
    if !scheme_ok || rest.is_empty() {
        return Err(bad());
    }
    if scheme == "http" || scheme == "https" {
        return url_host(url).map(|_| ()).ok_or_else(bad);
    }
    if scheme.starts_with("t3") {
        return Ok(());
    }
    // "Open in VS Code" (docs/CODE-VERSIONS.md §3): only the file / WSL-remote forms, never a command URI.
    if scheme == "vscode" && (rest.starts_with("//file/") || rest.starts_with("//vscode-remote/wsl+")) && !rest.contains("..") {
        return Ok(());
    }
    Err(bad())
}

/// Open a link with the OS handler (http(s), t3*, VS Code file links).
#[tauri::command]
pub fn open_link(url: String) -> Result<(), String> {
    check_link(&url)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe").raw_arg(format!("\"{url}\"")).creation_flags(0x0800_0000).spawn().map(|_| ()).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
        Ok(())
    }
}

// ---------- external code editor (Settings → General) ----------
/// A custom editor command line with `{file}` `{line}` `{col}` filled in; without `{file}` the path is appended.
pub fn editor_spec(cmd: &str, file: &str, line: u32, col: u32) -> Result<(String, Vec<String>), String> {
    let parts = split_cmdline(cmd);
    if parts.is_empty() { return Err("no custom editor command is set (Settings → General → External code editor)".into()); }
    let has_file = parts.iter().any(|p| p.contains("{file}"));
    let mut parts: Vec<String> = parts.into_iter().map(|p| p.replace("{file}", file).replace("{line}", &line.to_string()).replace("{col}", &col.to_string())).collect();
    if !has_file { parts.push(file.to_string()); }
    let program = parts.remove(0);
    Ok((program, parts))
}
/// Extensions the shell's "open" verb may get when there is no "edit" verb (never scripts: .js opens Windows Script Host).
const OPEN_OK: [&str; 10] = ["json", "md", "txt", "css", "html", "svg", "csv", "glsl", "frag", "vert"];

#[cfg(windows)]
fn shell_execute(verb: &str, file: &str) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(hwnd: isize, op: *const u16, file: *const u16, params: *const u16, dir: *const u16, show: i32) -> isize;
    }
    let w = |s: &str| std::ffi::OsStr::new(s).encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (v, f) = (w(verb), w(file));
    unsafe { ShellExecuteW(0, v.as_ptr(), f.as_ptr(), std::ptr::null(), std::ptr::null(), 1) > 32 }
}

/// Open a project file in the external editor from the settings (`system` = the "edit" verb of the file type; `custom` =
/// the command line). VS Code goes through `open_link` (vscode:// links). Returns the native path.
#[tauri::command]
pub fn open_in_editor(rel: String, line: Option<u32>, col: Option<u32>, state: State<AppState>) -> Result<String, String> {
    let root = state.root.lock().unwrap().clone();
    let parts = crate::normalize_rel(&rel)?;
    if parts.iter().any(|p| p == ".git") { return Err(format!("not a source file: {rel}")); }
    let path = crate::native_path(&root, &rel)?;
    if !Path::new(&path).is_file() { return Err(format!("not found: {rel}")); }
    let s = load_settings(&settings_path(&state));
    match s.pref_str("editor").unwrap_or("vscode") {
        "custom" => {
            let (program, args) = editor_spec(s.pref_str("editorCommand").unwrap_or(""), &path, line.unwrap_or(1), col.unwrap_or(1))?;
            let mut cmd = std::process::Command::new(&program);
            cmd.args(&args).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000);
            }
            cmd.spawn().map(|_| path.clone()).map_err(|e| format!("could not start {program}: {e}"))
        }
        "system" => {
            let ext = Path::new(&path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            #[cfg(windows)]
            {
                if shell_execute("edit", &path) || (OPEN_OK.contains(&ext.as_str()) && shell_execute("open", &path)) { return Ok(path); }
                Err(format!("Windows has no editor registered for .{ext} files: choose VS Code or a custom command in Settings → General"))
            }
            #[cfg(not(windows))]
            {
                let _ = OPEN_OK.contains(&ext.as_str());
                let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
                Ok(path)
            }
        }
        _ => Err("VS Code opens through a vscode:// link".into()),
    }
}

// ---------- shell selection ----------
/// Split a command line on whitespace, honouring double quotes (`"C:\Program Files\x.exe" -NoLogo`).
pub fn split_cmdline(s: &str) -> Vec<String> {
    let (mut out, mut cur, mut q, mut any) = (Vec::new(), String::new(), false, false);
    for c in s.chars() {
        match c {
            '"' => { q = !q; any = true; }
            c if c.is_whitespace() && !q => { if any { out.push(std::mem::take(&mut cur)); any = false; } }
            c => { cur.push(c); any = true; }
        }
    }
    if any { out.push(cur); }
    out
}

/// The terminal's process. WSL roots: `wsl.exe -d <distro> --cd <path> -- bash -lc 'export PATH=<engine>/bin:"$PATH" GFX_PROJECT=.. GFX_ENGINE=..; exec bash -l'`
/// with `engine` = the engine's Linux path (`wsl_root_engine`, as in `engine_run`), else the project itself. Native roots: the `shell` setting, else pwsh.exe when on PATH,
/// else powershell.exe (non-Windows: bash -l), cwd = project, PATH prepended with `<engine>/bin`, GFX_PROJECT / GFX_ENGINE.
pub fn shell_spec(root: &str, shell: &str, engine: Option<&Path>, cur_path: &str, pwsh_found: bool, on_windows: bool) -> Result<CmdSpec, String> {
    if let Ok((Some(distro), path)) = wsl_target(root, false) {
        let eng = engine.map(|e| e.to_string_lossy().trim_end_matches('/').to_string()).unwrap_or_else(|| path.trim_end_matches('/').to_string());
        let bin = format!("{eng}/bin");
        let script = format!(
            "export PATH={}:\"$PATH\" GFX_PROJECT={} GFX_ENGINE={}; exec bash -l",
            sh_quote(&bin), sh_quote(&path), sh_quote(&eng)
        );
        let args = vec!["-d".into(), distro, "--cd".into(), path, "--".into(), "bash".into(), "-lc".into(), script];
        return Ok(CmdSpec { program: "wsl.exe".into(), args, env: vec![], cwd: None });
    }
    let mut parts = split_cmdline(shell);
    if parts.is_empty() {
        parts = if !on_windows {
            vec!["bash".into(), "-l".into()]
        } else if pwsh_found {
            vec!["pwsh.exe".into(), "-NoLogo".into()]
        } else {
            vec!["powershell.exe".into(), "-NoLogo".into()]
        };
    }
    let program = parts.remove(0);
    let sep = if on_windows { ';' } else { ':' };
    let mut env = Vec::new();
    if let Some(e) = engine {
        let bin = e.join("bin").to_string_lossy().into_owned();
        env.push(("PATH".to_string(), if cur_path.is_empty() { bin } else { format!("{bin}{sep}{cur_path}") }));
        env.push(("GFX_ENGINE".to_string(), e.to_string_lossy().into_owned()));
    }
    env.push(("GFX_PROJECT".to_string(), root.to_string()));
    if !on_windows {
        env.push(("TERM".to_string(), "xterm-256color".to_string()));
    }
    Ok(CmdSpec { program, args: parts, env, cwd: Some(PathBuf::from(root)) })
}

fn on_path(exe: &str) -> bool {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).any(|d| d.join(exe).is_file())).unwrap_or(false)
}

// ---------- PTY ----------
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    pid: Option<u32>,
    gen: u64,
}

static PTY_GEN: AtomicU64 = AtomicU64::new(1);

/// Split off a trailing incomplete UTF-8 sequence so multi-byte characters are never cut between two events.
pub fn split_utf8(buf: &[u8]) -> (String, Vec<u8>) {
    match std::str::from_utf8(buf) {
        Ok(s) => (s.to_string(), vec![]),
        Err(e) if e.error_len().is_none() => {
            let n = e.valid_up_to();
            (String::from_utf8_lossy(&buf[..n]).into_owned(), buf[n..].to_vec())
        }
        Err(_) => {
            // invalid bytes in the middle: lossy, but still keep an incomplete tail
            let tail = (1..=3.min(buf.len())).find(|&k| {
                let t = &buf[buf.len() - k..];
                t[0] >= 0xC0 && std::str::from_utf8(t).is_err() && std::str::from_utf8(t).unwrap_err().error_len().is_none()
            });
            let n = buf.len() - tail.unwrap_or(0);
            (String::from_utf8_lossy(&buf[..n]).into_owned(), buf[n..].to_vec())
        }
    }
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct PtyOpts {
    /// Overrides the `shell` setting for this terminal.
    pub shell: Option<String>,
}

#[derive(Serialize)]
pub struct PtyInfo {
    shell: String,
    cwd: String,
}

fn close_session(mut s: PtySession) {
    if let Some(pid) = s.pid {
        if cfg!(windows) { kill_tree(pid); }
    }
    let _ = s.killer.kill();
    drop(s.writer);
    drop(s.master);
}

/// Close every terminal (project switch / exit).
pub fn close_all(state: &AppState) {
    let all: Vec<PtySession> = state.ptys.lock().unwrap().drain().map(|(_, s)| s).collect();
    for s in all { close_session(s); }
}

#[tauri::command]
pub fn pty_open(app: tauri::AppHandle, id: String, cols: u16, rows: u16, opts: Option<PtyOpts>, state: State<AppState>) -> Result<PtyInfo, String> {
    if !valid_job_id(&id) { return Err("invalid terminal id".into()); }
    if state.ptys.lock().unwrap().contains_key(&id) { return Err(format!("terminal {id} is already open")); }
    let root = state.root.lock().unwrap().clone();
    let settings = load_settings(&settings_path(&state));
    let shell = opts.and_then(|o| o.shell).unwrap_or(settings.shell);
    let wsl = matches!(wsl_target(&root, false), Ok((Some(_), _)));
    if !wsl && !Path::new(&root).is_dir() { return Err(format!("project folder not found: {root}")); }
    let engine = if wsl { wsl_root_engine(&root).and_then(|e| e.ok()).map(|e| PathBuf::from(crate::engines::linux_path(&e.path))) } else { resolve_engine().ok().map(|(e, _)| e) };
    let spec = shell_spec(&root, &shell, engine.as_deref(), &std::env::var("PATH").unwrap_or_default(), cfg!(windows) && on_path("pwsh.exe"), cfg!(windows))?;

    let pair = native_pty_system()
        .openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("could not open a terminal: {e}"))?;
    let mut cmd = CommandBuilder::new(&spec.program);
    cmd.args(&spec.args);
    for (k, v) in &spec.env { cmd.env(k, v); }
    if let Some(c) = &spec.cwd { cmd.cwd(c); }
    let mut child = pair.slave.spawn_command(cmd).map_err(|e| format!("could not start {}: {e}", spec.program))?;
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let gen = PTY_GEN.fetch_add(1, Ordering::SeqCst);
    state.ptys.lock().unwrap().insert(id.clone(), PtySession { master: pair.master, writer, killer: child.clone_killer(), pid: child.process_id(), gen });

    let event = format!("pty://{id}");
    let exit_code = Arc::new(Mutex::new(None::<u32>));
    // waiter: the child's exit closes the session (on Windows that ends the reader too)
    {
        let (app, id, exit_code) = (app.clone(), id.clone(), exit_code.clone());
        std::thread::spawn(move || {
            let code = child.wait().map(|s| s.exit_code()).unwrap_or(1);
            *exit_code.lock().unwrap() = Some(code);
            let st = app.state::<AppState>();
            let mine = { let mut m = st.ptys.lock().unwrap(); if m.get(&id).map(|s| s.gen == gen).unwrap_or(false) { m.remove(&id) } else { None } };
            if let Some(s) = mine { drop(s.writer); drop(s.master); }
        });
    }
    // reader -> channel -> flusher (batches output into ~16 ms events)
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = vec![0u8; 16384];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => { if tx.send(buf[..n].to_vec()).is_err() { break; } }
            }
        }
    });
    std::thread::spawn(move || {
        let mut pending: Vec<u8> = Vec::new();
        let mut open = true;
        while open {
            match rx.recv() { Ok(c) => pending.extend(c), Err(_) => break }
            let deadline = Instant::now() + Duration::from_millis(16);
            loop {
                let now = Instant::now();
                if now >= deadline { break; }
                match rx.recv_timeout(deadline - now) {
                    Ok(c) => pending.extend(c),
                    Err(mpsc::RecvTimeoutError::Timeout) => break,
                    Err(mpsc::RecvTimeoutError::Disconnected) => { open = false; break; }
                }
            }
            let (s, rest) = split_utf8(&pending);
            pending = rest;
            if !s.is_empty() { let _ = app.emit(&event, serde_json::json!({ "data": s })); }
        }
        if !pending.is_empty() { let _ = app.emit(&event, serde_json::json!({ "data": String::from_utf8_lossy(&pending) })); }
        let t0 = Instant::now();
        while exit_code.lock().unwrap().is_none() && t0.elapsed() < Duration::from_millis(1500) { std::thread::sleep(Duration::from_millis(20)); }
        let code = *exit_code.lock().unwrap();
        let _ = app.emit(&event, serde_json::json!({ "exit": code }));
    });
    let label = std::iter::once(spec.program.clone()).chain(spec.args.iter().take(if wsl { 2 } else { 4 }).cloned()).collect::<Vec<_>>().join(" ");
    Ok(PtyInfo { shell: label, cwd: root })
}

#[tauri::command]
pub fn pty_write(id: String, data: String, state: State<AppState>) -> Result<(), String> {
    let mut m = state.ptys.lock().unwrap();
    let s = m.get_mut(&id).ok_or("terminal is closed")?;
    s.writer.write_all(data.as_bytes()).and_then(|_| s.writer.flush()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(id: String, cols: u16, rows: u16, state: State<AppState>) -> Result<(), String> {
    let m = state.ptys.lock().unwrap();
    let s = m.get(&id).ok_or("terminal is closed")?;
    s.master.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_close(id: String, state: State<AppState>) -> bool {
    if id == "*" { close_all(&state); return true; } // webview reload: drop the terminals of the previous page
    let s = state.ptys.lock().unwrap().remove(&id);
    match s { Some(s) => { close_session(s); true } None => false }
}

pub type PtyMap = Mutex<HashMap<String, PtySession>>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_url_guard() {
        for ok in ["https://t3.example.com/hooks/abc?x=1", "http://127.0.0.1:8787/hook", "http://localhost/x", "HTTP://LOCALHOST:1/x", "http://[::1]:9/x"] {
            assert!(check_post_url(ok).is_ok(), "{ok}");
        }
        for bad in ["http://example.com/x", "http://127.0.0.1.evil.com/x", "http://localhost@evil.com/x", "http://localhost.evil.com/", "ftp://localhost/x",
                    "file:///etc/passwd", "javascript:alert(1)", "https://", "http://10.0.0.1/x", "http://0.0.0.0/x", "https://a b.com/", "localhost:80/x", "", "http://[::2]/x", r"http://example.com\@localhost/hook", "http://user@localhost/hook",
                    "https://user@host.io/x", "http://@localhost/hook", "http:////user@localhost/hook", "http://localhost:bad/hook", r"https://host.io/a\b"] {
            assert!(check_post_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn post_url_backslash_userinfo_bypass() {
        let url = r"http://example.com\@localhost/hook";
        // This is the destination the HTTP client would actually use.
        let parsed = ureq::post(url).request_url().unwrap();
        assert_eq!(parsed.as_url().host_str(), Some("example.com"));
        assert!(check_post_url(url).is_err());
    }

    #[test]
    fn link_guard() {
        assert!(check_link("t3-thread://thread/abc").is_ok());
        assert!(check_link("https://app.t3.chat/x").is_ok());
        assert!(check_link("t3code://open?thread=1").is_ok());
        assert!(check_link("vscode://file/C:/p/scenes/a/scene.js:12:3").is_ok());
        assert!(check_link("vscode://vscode-remote/wsl+Ubuntu/home/k/p/scenes/a/scene.js:12").is_ok());
        for bad in ["vscode://command/workbench.action.terminal.new", "vscode:extension/x", "vscode://file/C:/p/../x.js", "vscode://vscode-remote/ssh-remote+h/x",
                    "file:///C:/Windows/notepad.exe", "javascript:alert(1)", "ms-settings:", "C:\\x.exe", "https://a\"b", "t3-thread:", "cmd:/c calc", "http://"] {
            assert!(check_link(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn settings_serde() {
        // old webhook fields are ignored, invalid values dropped (never fatal)
        let j: Settings = serde_json::from_str(r#"{"t3WebhookUrl":"https://a/b","t3ThreadLink":"t3-thread://x","claudeCommand":"claude --continue","renderWorkers":"x"}"#).unwrap();
        assert_eq!((j.claude_command.as_str(), j.shell.as_str()), ("claude --continue", ""));
        assert!(j.prefs.is_empty());
        let out = serde_json::to_string(&j).unwrap();
        assert!(!out.contains("t3Webhook") && out.contains("\"shell\":\"\""));
        let j: Settings = serde_json::from_str(r#"{"claudeCommand":"claude\nrm -rf /"}"#).unwrap();
        assert_eq!(j.claude_command, "");
    }

    #[test]
    fn editor_command() {
        let (p, a) = editor_spec(r#""C:\Program Files\Ed\ed.exe" -n{line} "{file}""#, r"C:\p\scene.js", 12, 3).unwrap();
        assert_eq!((p.as_str(), a), (r"C:\Program Files\Ed\ed.exe", vec!["-n12".to_string(), r"C:\p\scene.js".to_string()]));
        let (p, a) = editor_spec("subl", "/p/x.js", 1, 1).unwrap();
        assert_eq!((p.as_str(), a), ("subl", vec!["/p/x.js".to_string()]));
        let (_, a) = editor_spec("code -g {file}:{line}:{col}", "/p/a b.js", 4, 2).unwrap();
        assert_eq!(a, vec!["-g".to_string(), "/p/a b.js:4:2".to_string()]);
        assert!(editor_spec("   ", "/p/x.js", 1, 1).is_err());
    }

    #[test]
    fn cmdline_split() {
        assert_eq!(split_cmdline(r#""C:\Program Files\PowerShell\7\pwsh.exe" -NoLogo"#), vec![r"C:\Program Files\PowerShell\7\pwsh.exe", "-NoLogo"]);
        assert_eq!(split_cmdline("  cmd.exe   /k  "), vec!["cmd.exe", "/k"]);
        assert!(split_cmdline("   ").is_empty());
    }

    #[test]
    fn wsl_shell() {
        let c = shell_spec(r"\\wsl.localhost\Ubuntu\home\k\it's proj", "pwsh.exe", None, "C:\\Windows", true, true).unwrap();
        assert_eq!(c.program, "wsl.exe");
        assert_eq!(c.args[..7], ["-d", "Ubuntu", "--cd", "/home/k/it's proj", "--", "bash", "-lc"].map(String::from)[..]);
        assert_eq!(c.args[7], r#"export PATH='/home/k/it'\''s proj/bin':"$PATH" GFX_PROJECT='/home/k/it'\''s proj' GFX_ENGINE='/home/k/it'\''s proj'; exec bash -l"#);
        assert!(c.env.is_empty() && c.cwd.is_none());
        // a project outside the engine: the engine's bin on PATH
        let c = shell_spec(r"\\wsl.localhost\Ubuntu\home\k\p", "", Some(Path::new("/home/k/gfx")), "", true, true).unwrap();
        assert_eq!(c.args[7], "export PATH='/home/k/gfx/bin':\"$PATH\" GFX_PROJECT='/home/k/p' GFX_ENGINE='/home/k/gfx'; exec bash -l");
    }

    #[test]
    fn native_shell() {
        let eng = Path::new(r"C:\app\engine");
        let c = shell_spec(r"C:\proj", "", Some(eng), r"C:\Windows", true, true).unwrap();
        assert_eq!((c.program.as_str(), c.args.clone()), ("pwsh.exe", vec!["-NoLogo".to_string()]));
        let env: HashMap<_, _> = c.env.iter().cloned().collect();
        assert_eq!(env["PATH"], format!("{};C:\\Windows", eng.join("bin").to_string_lossy()));
        assert_eq!(env["GFX_PROJECT"], r"C:\proj");
        assert_eq!(env["GFX_ENGINE"], r"C:\app\engine");
        assert_eq!(c.cwd, Some(PathBuf::from(r"C:\proj")));
        let c = shell_spec(r"C:\proj", "", Some(eng), "", false, true).unwrap();
        assert_eq!(c.program, "powershell.exe");
        let c = shell_spec(r"C:\proj", r#""C:\x y\cmd.exe" /k"#, None, "P", true, true).unwrap();
        assert_eq!((c.program.as_str(), c.args.clone()), (r"C:\x y\cmd.exe", vec!["/k".to_string()]));
        assert!(!c.env.iter().any(|(k, _)| k == "PATH" || k == "GFX_ENGINE"));
        let c = shell_spec("/home/k/p", "", Some(Path::new("/e")), "/usr/bin", false, false).unwrap();
        assert_eq!((c.program.as_str(), c.args.clone()), ("bash", vec!["-l".to_string()]));
        assert!(c.env.contains(&("PATH".into(), format!("{}:/usr/bin", Path::new("/e").join("bin").to_string_lossy()))));
    }

    /// Real PTY (ConPTY on Windows): spawn, write input, read output, resize, kill.
    #[test]
    fn pty_roundtrip() {
        let pair = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = if cfg!(windows) { CommandBuilder::new("cmd.exe") } else { CommandBuilder::new("sh") };
        cmd.env("GFX_PTY_TEST", "env-ok");
        let child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let mut writer = pair.master.take_writer().unwrap();
        let (tx, rx) = mpsc::channel::<Vec<u8>>();
        std::thread::spawn(move || { let mut b = [0u8; 4096]; while let Ok(n) = reader.read(&mut b) { if n == 0 || tx.send(b[..n].to_vec()).is_err() { break; } } });
        let line = if cfg!(windows) { "echo PTY-%GFX_PTY_TEST%-OK\r\n" } else { "echo PTY-$GFX_PTY_TEST-OK\n" };
        pair.master.resize(PtySize { rows: 30, cols: 100, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut out = Vec::new();
        let t0 = Instant::now();
        let (mut answered, mut typed) = (false, false);
        while t0.elapsed() < Duration::from_secs(10) {
            if let Ok(c) = rx.recv_timeout(Duration::from_millis(100)) { out.extend(c); }
            // ConPTY asks for the cursor position (DSR) and waits for the answer; xterm.js answers it in the app
            if !answered && String::from_utf8_lossy(&out).contains("\x1b[6n") {
                writer.write_all(b"\x1b[1;1R").unwrap();
                writer.flush().unwrap();
                answered = true;
            }
            if !typed && (answered || t0.elapsed() > Duration::from_millis(800)) {
                std::thread::sleep(Duration::from_millis(300));
                writer.write_all(line.as_bytes()).unwrap();
                writer.flush().unwrap();
                typed = true;
            }
            if String::from_utf8_lossy(&out).contains("PTY-env-ok-OK") { break; }
        }
        let _ = child.clone_killer().kill();
        assert!(String::from_utf8_lossy(&out).contains("PTY-env-ok-OK"), "pty output: {}", String::from_utf8_lossy(&out));
    }

    #[test]
    fn utf8_split() {
        let s = "a€b".as_bytes();
        assert_eq!(split_utf8(s), ("a€b".to_string(), vec![]));
        assert_eq!(split_utf8(&s[..2]), ("a".to_string(), vec![0xE2]));
        assert_eq!(split_utf8(&s[..3]), ("a".to_string(), vec![0xE2, 0x82]));
        let (t, rest) = split_utf8(&[b'x', 0xFF, b'y', 0xE2, 0x82]);
        assert_eq!((t.as_str(), rest), ("x\u{FFFD}y", vec![0xE2, 0x82]));
    }
}
