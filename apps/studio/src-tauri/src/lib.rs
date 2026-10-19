use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::collections::HashMap;
use std::io::BufRead;
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    http,
    ipc::{InvokeBody, Request as IpcRequest, Response},
    Emitter, Manager, State,
};
use tauri_plugin_dialog::DialogExt;

pub mod claude;
pub mod engines;
pub mod library;
mod popout;
pub mod prefs;
pub mod t3;
pub mod welcome;

/// Project root before any project was opened (no config.json yet): none, unless `GFX_STUDIO_ROOT` names one (dev / tests).
/// The welcome window is the first screen, so an empty root is never used for scene work.
fn default_root() -> String {
    std::env::var("GFX_STUDIO_ROOT").unwrap_or_default()
}

pub struct AppState {
    root: Mutex<String>,
    config_file: PathBuf,
    /// Running engine jobs by id (`serve` = the live scene server); killed on exit and, for `serve`, when the root changes.
    jobs: Mutex<HashMap<String, Arc<Job>>>,
    /// Open terminals (docs/CLAUDE-IN-APP.md §3); closed on project switch and exit.
    ptys: claude::PtyMap,
    /// Where gfxlib:// reads the sound library for the open project (`lib_scope`); None after a project switch.
    lib: Mutex<Option<LibScope>>,
    lib_locating: Mutex<()>,
}

pub const SERVER_PORT: u16 = 5199;

#[derive(Serialize, Deserialize)]
struct Config {
    root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    name: String,
    has_video: bool,
    mtime: u64,
}

#[derive(Serialize)]
pub struct Stat {
    mtime: u64,
}

/// Normalize a frontend-supplied relative path (forward slashes) into clean components.
/// Rejects absolute paths, drive prefixes, `..`, empty paths and NUL.
pub fn normalize_rel(rel: &str) -> Result<Vec<String>, String> {
    if rel.contains('\0') {
        return Err("invalid path".into());
    }
    let s = rel.replace('\\', "/");
    if s.starts_with('/') || s.contains(':') {
        return Err(format!("absolute path not allowed: {rel}"));
    }
    let mut parts = Vec::new();
    for c in Path::new(&s).components() {
        match c {
            Component::Normal(p) => parts.push(p.to_string_lossy().into_owned()),
            Component::CurDir => {}
            _ => return Err(format!("path escapes root: {rel}")),
        }
    }
    if parts.is_empty() {
        return Err("empty path".into());
    }
    Ok(parts)
}

pub fn join_safe(root: &str, rel: &str) -> Result<PathBuf, String> {
    let mut p = PathBuf::from(root);
    for part in normalize_rel(rel)? {
        p.push(part);
    }
    Ok(p)
}

/// Writes only allowed at out/<scene>/review/<file...>
pub fn check_writable(rel: &str) -> Result<(), String> {
    let parts = normalize_rel(rel)?;
    if parts.len() >= 4 && parts[0] == "out" && parts[2] == "review" {
        Ok(())
    } else {
        Err(format!("write not allowed outside out/*/review/: {rel}"))
    }
}

/// Project-text writes are allowed for exactly `scenes/<scene>/render.json` (saved render presets).
pub fn check_project_writable(rel: &str) -> Result<(), String> {
    let parts = normalize_rel(rel)?;
    if parts.len() == 3 && parts[0] == "scenes" && parts[2] == "render.json" {
        Ok(())
    } else {
        Err(format!("write not allowed (only scenes/<scene>/render.json): {rel}"))
    }
}

/// Reveal / open are allowed for files and folders under out/ only (render results), never outside the project.
pub fn check_openable(rel: &str) -> Result<(), String> {
    let parts = normalize_rel(rel)?;
    if parts.len() >= 2 && parts[0] == "out" {
        Ok(())
    } else {
        Err(format!("only paths under out/ can be revealed or opened: {rel}"))
    }
}

/// Native (Windows) spelling of a project path: backslashes. A WSL root is already `\\wsl.localhost\<distro>\...`,
/// so joining the relative path gives the path Explorer needs. Outside Windows the path is returned as it is.
pub fn native_path(root: &str, rel: &str) -> Result<String, String> {
    let p = join_safe(root, rel)?.to_string_lossy().into_owned();
    Ok(if cfg!(windows) { p.replace('/', "\\") } else { p })
}

/// Decode `%XX` escapes (UTF-8). Used for the `rel` header of `write_bytes` and for gfxlib:// paths.
pub fn percent_decode(s: &str) -> Result<String, String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            if i + 2 >= b.len() {
                return Err("bad percent escape".into());
            }
            let h = std::str::from_utf8(&b[i + 1..i + 3]).map_err(|_| "bad percent escape")?;
            out.push(u8::from_str_radix(h, 16).map_err(|_| "bad percent escape")?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| "invalid utf-8 in path".into())
}

// ---------- gfxlib:// (read-only library access) ----------
const AUDIO_EXT: &[&str] = &["wav", "ogg", "mp3", "flac", "aif", "aiff", "m4a", "opus"];
const LIB_EXT: &[&str] = &["onnx", "json", "jsonl", "txt"];

pub fn content_type(ext: &str) -> Option<&'static str> {
    Some(match ext.to_ascii_lowercase().as_str() {
        "onnx" => "application/octet-stream",
        "json" => "application/json",
        "jsonl" | "txt" => "text/plain; charset=utf-8",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "aif" | "aiff" => "audio/aiff",
        "m4a" => "audio/mp4",
        _ => return None,
    })
}

fn is_abs_path(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/') || (b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic())
}

/// Comparison key: forward slashes, lowercase, `/mnt/d/x` == `d:/x`, no trailing slash.
fn path_key(p: &str) -> String {
    let mut s = p.replace('\\', "/").to_ascii_lowercase();
    if let Some(r) = s.strip_prefix("/mnt/") {
        let b = r.as_bytes();
        if !b.is_empty() && b[0].is_ascii_alphabetic() && (b.len() == 1 || b[1] == b'/') {
            s = format!("{}:{}", &r[..1], &r[1..]);
        }
    }
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

fn under_key(path: &str, dir: &str) -> bool {
    path == dir || (path.starts_with(dir) && path.as_bytes().get(dir.len()) == Some(&b'/'))
}

/// Readable form of an absolute path as the engine spells it. On Windows: `/mnt/d/x` -> `D:/x`, another Linux path of a
/// WSL engine (`distro`) -> `\\wsl.localhost\<distro>\...`, `D:/x` as is. Elsewhere: `D:/x` -> `/mnt/d/x`.
pub fn readable_abs(p: &str, distro: Option<&str>, on_windows: bool) -> PathBuf {
    let s = p.replace('\\', "/");
    let b = s.as_bytes();
    if on_windows {
        if let Some(r) = s.strip_prefix("/mnt/") {
            let rb = r.as_bytes();
            if !rb.is_empty() && rb[0].is_ascii_alphabetic() && (rb.len() == 1 || rb[1] == b'/') {
                return PathBuf::from(format!("{}:{}", r[..1].to_ascii_uppercase(), if r.len() == 1 { "/" } else { &r[1..] }));
            }
        }
        if let (Some(d), true) = (distro, s.starts_with('/') && !s.starts_with("//")) {
            return wsl_unc(d, &s);
        }
        PathBuf::from(s)
    } else if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        PathBuf::from(format!("/mnt/{}{}", (b[0] as char).to_ascii_lowercase(), &s[2..]))
    } else {
        PathBuf::from(s)
    }
}

/// `(id, path)` of the folder sources in a sources.json / gfx.json `library` object (`{ sources: [...] }`).
fn source_list(v: Option<&serde_json::Value>) -> Vec<(String, String)> {
    v.and_then(|v| v["sources"].as_array())
        .map(|a| a.iter().filter_map(|s| s["path"].as_str().map(|p| (s["id"].as_str().unwrap_or("").to_string(), p.to_string()))).collect())
        .unwrap_or_default()
}

/// Where `gfxlib://` reads from (docs/SOUND-LIBRARY.md "As built: gfxlib resolution"). `root` = the open project;
/// `lib` = the engine's sound library as the app reads it (`gfx lib list --json` -> `library`, a WSL path as
/// `\\wsl.localhost\<distro>\...`), None = not known (no engine): `<root>/library` as before; `distro` = the WSL engine's
/// distro (its absolute Linux paths are read over `\\wsl.localhost`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct LibScope { pub root: String, pub lib: Option<PathBuf>, pub lib_engine: Option<String>, pub distro: Option<String> }
impl LibScope {
    pub fn fallback(root: &str) -> Self { LibScope { root: root.to_string(), ..Default::default() } }
    fn lib_dir(&self) -> PathBuf { self.lib.clone().unwrap_or_else(|| Path::new(&self.root).join("library")) }
    /// Relative library paths (`library/kenney/...`, sources.json `path`) are relative to the library's parent.
    fn base(&self) -> PathBuf { let l = self.lib_dir(); l.parent().map(Path::to_path_buf).unwrap_or(l) }
    /// The project root as the engine spells it (a WSL engine: the Linux path; `C:\x` stays, path_key maps /mnt/c).
    fn engine_root(&self) -> String {
        if self.distro.is_some() { t3::wsl_path(&self.root).unwrap_or_else(|_| self.root.clone()) } else { self.root.clone() }
    }
}

fn join_parts(base: &Path, parts: &[String]) -> PathBuf {
    let mut p = base.to_path_buf();
    for c in parts { p.push(c); }
    p
}

/// Map a gfxlib:// request path (already percent-decoded) to a readable file. Allowed:
/// - `library/<...>` (or `<library folder name>/<...>`): model / index / audio files in the engine's sound library;
/// - `.gfx/index/<id>.jsonl|.meta.json`: the index of a project source (gfx.json `library.sources[]`);
/// - audio inside a registered folder source: sources.json `path` (relative to the library's parent, or absolute) or
///   gfx.json `library.sources[].path` (relative to the project, or absolute); a relative request is tried under the
///   project first, then the library's parent, an absolute one in the engine's spelling.
/// Everything else (`..`, other roots, non-audio outside the library) is rejected.
pub fn resolve_lib_in(sc: &LibScope, sources_json: Option<&str>, project_json: Option<&str>, req: &str) -> Result<PathBuf, String> {
    let req = req.replace('\\', "/");
    if req.contains('\0') || req.split('/').any(|c| c == "..") {
        return Err("path escapes".into());
    }
    let ext = Path::new(&req).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let audio = AUDIO_EXT.contains(&ext.as_str());
    let sj = sources_json.and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok());
    let pj = project_json.and_then(|t| serde_json::from_str::<serde_json::Value>(t).ok());
    let srcs = source_list(sj.as_ref());
    let psrcs = source_list(pj.as_ref().map(|v| &v["library"]));
    let (lib, base, root) = (sc.lib_dir(), sc.base(), PathBuf::from(&sc.root));
    let lib_name = lib.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if !is_abs_path(&req) {
        let parts = normalize_rel(&req)?;
        let key = path_key(&parts.join("/"));
        let rel_under = |list: &[(String, String)]| list.iter().filter(|(_, p)| !is_abs_path(p)).any(|(_, sp)| {
            normalize_rel(sp).map(|s| under_key(&key, &path_key(&s.join("/")))).unwrap_or(false)
        });
        // Registered project audio wins even when its path begins with the global library alias.
        if audio && rel_under(&psrcs) { return Ok(join_parts(&root, &parts)); }
        let first = parts[0].to_ascii_lowercase();
        if first == "library" || first == lib_name {
            if parts.len() < 2 { return Err(format!("not a file: {req}")); }
            return if LIB_EXT.contains(&ext.as_str()) || audio { Ok(join_parts(&lib, &parts[1..])) } else { Err(format!("file type not served: {req}")) };
        }
        if parts.len() == 3 && parts[0] == ".gfx" && parts[1] == "index" {
            let f = &parts[2];
            let id = f.strip_suffix(".jsonl").or_else(|| f.strip_suffix(".meta.json"));
            if id.is_some_and(|id| !id.is_empty() && psrcs.iter().any(|(pid, _)| pid == id)) { return Ok(join_parts(&root, &parts)); }
            return Err(format!("not a project source index: {req}"));
        }
        if !audio { return Err(format!("not in library: {req}")); }
        if rel_under(&srcs) { return Ok(join_parts(&base, &parts)); }
        return Err(format!("not in library: {req}"));
    }
    if !audio { return Err(format!("not in a registered source: {req}")); }
    let key = path_key(&req);
    let eroot = sc.engine_root().replace('\\', "/");
    let dirs = srcs.iter().filter(|(_, p)| is_abs_path(p)).map(|(_, p)| p.clone())
        .chain(psrcs.iter().map(|(_, p)| if is_abs_path(p) { p.clone() } else { format!("{}/{}", eroot.trim_end_matches('/'), p) }));
    for d in dirs {
        if d.replace('\\', "/").split('/').any(|c| c == "..") { continue; }
        if under_key(&key, &path_key(&d)) {
            return Ok(readable_abs(&req, sc.distro.as_deref(), cfg!(windows)));
        }
    }
    Err(format!("not in a registered source: {req}"))
}

/// The old entry point (library = `<root>/library`, no project sources); kept for callers and tests.
pub fn resolve_lib(root: &str, sources_json: Option<&str>, req: &str) -> Result<PathBuf, String> {
    resolve_lib_in(&LibScope::fallback(root), sources_json, None, req)
}

fn lib_response(status: u16, ctype: &str, body: Vec<u8>) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("Content-Type", ctype)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Headers", "*")
        .header("Cache-Control", "no-cache")
        .body(body)
        .unwrap()
}

/// `gfxlib://localhost/f/<percent-encoded path>` (Windows: `http://gfxlib.localhost/f/...`).
pub fn serve_lib(sc: &LibScope, method: &str, uri_path: &str) -> http::Response<Vec<u8>> {
    if method == "OPTIONS" {
        return lib_response(204, "text/plain", vec![]);
    }
    let Some(enc) = uri_path.strip_prefix("/f/") else {
        return lib_response(404, "text/plain", b"not found".to_vec());
    };
    let resolved = percent_decode(enc).and_then(|dec| {
        let sources = std::fs::read_to_string(sc.lib_dir().join("sources.json")).ok();
        let project = std::fs::read_to_string(Path::new(&sc.root).join("gfx.json")).ok();
        resolve_lib_in(sc, sources.as_deref(), project.as_deref(), &dec)
    });
    match resolved {
        Err(e) => lib_response(403, "text/plain", e.into_bytes()),
        Ok(p) => {
            let ct = content_type(p.extension().and_then(|e| e.to_str()).unwrap_or("")).unwrap_or("application/octet-stream");
            match std::fs::read(&p) {
                Ok(b) => lib_response(200, ct, b),
                Err(e) => lib_response(404, "text/plain", e.to_string().into_bytes()),
            }
        }
    }
}

/// `{ "library": "<dir>" }` from `gfx lib list --json` stdout (the whole output, else the last JSON line).
pub fn library_from_list(stdout: &str) -> Option<String> {
    let pick = |v: serde_json::Value| v["library"].as_str().filter(|s| !s.is_empty()).map(String::from);
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(stdout.trim()) { return pick(v); }
    stdout.lines().rev().map(str::trim).filter(|l| l.starts_with('{')).find_map(|l| serde_json::from_str(l).ok().and_then(pick))
}

/// Ask the project's engine where its sound library is (`gfx lib list --json`) -> the scope gfxlib:// reads from.
pub(crate) fn locate_library(root: &str) -> Result<LibScope, String> {
    let distro = match wsl_root_engine(root) {
        Some(r) => Some(r?.distro),
        None => locate_engine()?.wsl.map(|w| w.distro),
    };
    let spec = spec_for(root, &["lib".into(), "list".into(), "--json".into()], &RunOpts::default())?;
    let out = run_stdout(&spec)?;
    let lib = library_from_list(&out).ok_or("gfx lib list --json did not name the library")?;
    let readable = readable_abs(&lib, distro.as_deref(), cfg!(windows));
    Ok(LibScope { root: root.to_string(), lib: Some(readable), lib_engine: Some(lib), distro })
}

/// The scope for gfxlib:// requests: cached per project (cleared on a project switch, refreshed by `lib_locate`);
/// the first request after a switch asks the engine (one at a time), a failure falls back to `<root>/library`.
fn lib_scope(st: &AppState) -> LibScope {
    let root = st.root.lock().unwrap().clone();
    if let Some(s) = st.lib.lock().unwrap().as_ref().filter(|s| s.root == root) { return s.clone(); }
    let _one = st.lib_locating.lock().unwrap();
    if let Some(s) = st.lib.lock().unwrap().as_ref().filter(|s| s.root == root) { return s.clone(); }
    let s = locate_library(&root).unwrap_or_else(|_| LibScope::fallback(&root));
    if *st.root.lock().unwrap() == root { *st.lib.lock().unwrap() = Some(s.clone()); }
    s
}

/// Re-ask the engine where the sound library is (after a project / engine change or a Sound sources edit).
/// -> `{ library: <engine path> | null, dir: <readable dir> | null, error? }`.
#[tauri::command]
async fn lib_locate(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let root = root_of(&state);
    let r = { let root = root.clone(); tauri::async_runtime::spawn_blocking(move || locate_library(&root)).await.map_err(|e| e.to_string())? };
    let scope = r.clone().unwrap_or_else(|_| LibScope::fallback(&root));
    if *state.root.lock().unwrap() == root { *state.lib.lock().unwrap() = Some(scope.clone()); }
    Ok(serde_json::json!({
        "library": scope.lib_engine,
        "dir": scope.lib.map(|p| p.to_string_lossy().into_owned()),
        "error": r.err(),
    }))
}

fn mtime_ms(p: &Path) -> Option<u64> {
    let m = std::fs::metadata(p).ok()?.modified().ok()?;
    Some(m.duration_since(std::time::UNIX_EPOCH).ok()?.as_millis() as u64)
}

pub fn scenes_in(root: &str) -> Vec<Scene> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(Path::new(root).join("out")) else {
        return v;
    };
    for e in rd.flatten() {
        let dir = e.path();
        let cues = dir.join("audio").join("cues.json");
        if !cues.is_file() {
            continue;
        }
        let name = e.file_name().to_string_lossy().into_owned();
        let has_video = dir.join(format!("{name}.mp4")).is_file();
        v.push(Scene { has_video, mtime: mtime_ms(&cues).unwrap_or(0), name });
    }
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

pub fn selftest() -> String {
    let root = default_root();
    let scenes = scenes_in(&root);
    serde_json::json!({ "root": root, "scenes": scenes }).to_string()
}

fn root_of(state: &State<AppState>) -> String {
    state.root.lock().unwrap().clone()
}

fn persist_root(state: &State<AppState>, path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    std::fs::write(
        &state.config_file,
        serde_json::to_vec_pretty(&Config { root: path.clone() }).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    *state.root.lock().unwrap() = path.clone();
    *state.lib.lock().unwrap() = None;
    kill_server(state.inner());
    claude::close_all(state.inner());
    project_opened(path);
    Ok(())
}

#[tauri::command]
fn get_root(state: State<AppState>) -> String {
    root_of(&state)
}

#[tauri::command]
fn set_root(path: String, state: State<AppState>) -> Result<(), String> {
    persist_root(&state, path)
}

#[tauri::command]
fn refresh_project_metadata(state: State<AppState>) {
    project_opened(root_of(&state));
}

#[tauri::command]
async fn pick_root(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    let start = root_of(&state);
    let mut b = app.dialog().file().set_title("Select gfx project root");
    if Path::new(&start).is_dir() {
        b = b.set_directory(&start);
    }
    let Some(fp) = b.blocking_pick_folder() else { return Ok(None) };
    let path = fp.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned();
    persist_root(&state, path.clone())?;
    Ok(Some(path))
}

/// Folder dialog that does not change the current project (New project target, etc.).
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle, title: Option<String>) -> Result<Option<String>, String> {
    let b = app.dialog().file().set_title(title.unwrap_or_else(|| "Select folder".into()));
    let Some(fp) = b.blocking_pick_folder() else { return Ok(None) };
    Ok(Some(fp.into_path().map_err(|e| e.to_string())?.to_string_lossy().into_owned()))
}

#[tauri::command]
fn list_scenes(state: State<AppState>) -> Vec<Scene> {
    scenes_in(&root_of(&state))
}

#[tauri::command]
fn read_bytes(rel: String, state: State<AppState>) -> Result<Response, String> {
    let p = join_safe(&root_of(&state), &rel)?;
    std::fs::read(&p).map(Response::new).map_err(|e| format!("{rel}: {e}"))
}

#[tauri::command]
fn read_text(rel: String, state: State<AppState>) -> Result<Option<String>, String> {
    let p = join_safe(&root_of(&state), &rel)?;
    match std::fs::read_to_string(&p) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{rel}: {e}")),
    }
}

/// Write under out/*/review/, creating the parent folders.
fn write_review_file(state: &State<AppState>, rel: &str, data: &[u8]) -> Result<(), String> {
    check_writable(rel)?;
    let p = join_safe(&root_of(state), rel)?;
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, data).map_err(|e| format!("{rel}: {e}"))
}

#[tauri::command]
fn write_text(rel: String, text: String, state: State<AppState>) -> Result<(), String> {
    write_review_file(&state, &rel, text.as_bytes())
}

/// Raw-body command: `invoke('write_bytes', bytes, { headers: { rel: encodeURIComponent(rel) } })`.
#[tauri::command]
fn write_bytes(request: IpcRequest<'_>, state: State<AppState>) -> Result<(), String> {
    let rel = request
        .headers()
        .get("rel")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing `rel` header")?;
    let rel = percent_decode(rel)?;
    check_writable(&rel)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("write_bytes expects a raw byte body".into());
    };
    write_review_file(&state, &rel, data)
}

/// Write a scene's saved render presets (`scenes/<scene>/render.json`); nothing else outside out/*/review/.
#[tauri::command]
fn write_project_text(rel: String, text: String, state: State<AppState>) -> Result<(), String> {
    check_project_writable(&rel)?;
    let p = join_safe(&root_of(&state), &rel)?;
    if !p.parent().map(|d| d.is_dir()).unwrap_or(false) {
        return Err(format!("no such scene: {rel}"));
    }
    std::fs::write(&p, text).map_err(|e| format!("{rel}: {e}"))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderFile {
    name: String,
    size: u64,
    mtime: u64,
    is_dir: bool,
}

const RENDER_EXTS: [&str; 8] = ["mp4", "webm", "gif", "mov", "png", "mkv", "m4v", "jpg"];

/// Files (and frame folders) directly inside out/<scene>/ that are renders, newest first.
pub fn renders_in(root: &str, scene: &str) -> Result<Vec<RenderFile>, String> {
    let parts = normalize_rel(&format!("out/{scene}"))?;
    if parts.len() != 2 {
        return Err(format!("bad scene name: {scene}"));
    }
    let dir = join_safe(root, &format!("out/{scene}"))?;
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(v) };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Ok(md) = e.metadata() else { continue };
        let ext = Path::new(&name).extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        let is_dir = md.is_dir();
        let frames = is_dir && name.starts_with("frames");
        if !(frames || (!is_dir && RENDER_EXTS.contains(&ext.as_str()))) {
            continue;
        }
        v.push(RenderFile { name, size: if is_dir { 0 } else { md.len() }, mtime: mtime_ms(&e.path()).unwrap_or(0), is_dir });
    }
    v.sort_by(|a, b| b.mtime.cmp(&a.mtime).then(a.name.cmp(&b.name)));
    Ok(v)
}

#[tauri::command]
fn list_renders(scene: String, state: State<AppState>) -> Result<Vec<RenderFile>, String> {
    renders_in(&root_of(&state), &scene)
}

#[cfg(windows)]
fn explorer(raw: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // explorer.exe exits 1 even when it worked, so only a failed spawn is an error
    std::process::Command::new("explorer.exe").raw_arg(raw).creation_flags(0x0800_0000).spawn().map(|_| ()).map_err(|e| e.to_string())
}
#[cfg(not(windows))]
fn explorer(_raw: &str) -> Result<(), String> {
    Ok(())
}

/// Show a result in Explorer (selected). Returns the native path (no-op outside Windows).
#[tauri::command]
fn reveal_path(rel: String, state: State<AppState>) -> Result<String, String> {
    check_openable(&rel)?;
    let p = native_path(&root_of(&state), &rel)?;
    explorer(&format!("/select,\"{p}\""))?;
    Ok(p)
}

/// Open a result with the default app (Explorer's shell open). Returns the native path.
#[tauri::command]
fn open_path(rel: String, state: State<AppState>) -> Result<String, String> {
    check_openable(&rel)?;
    let p = native_path(&root_of(&state), &rel)?;
    if cfg!(windows) && !Path::new(&p).exists() {
        return Err(format!("not found: {rel}"));
    }
    explorer(&format!("\"{p}\""))?;
    Ok(p)
}

#[tauri::command]
fn stat(rel: String, state: State<AppState>) -> Result<Option<Stat>, String> {
    let p = join_safe(&root_of(&state), &rel)?;
    Ok(mtime_ms(&p).map(|mtime| Stat { mtime }))
}

// ---------- code workspace (docs/CODE-VERSIONS.md §3) ----------
/// Folder names never listed / written: build output, caches, VCS internals.
const SKIP_DIRS: [&str; 4] = [".git", ".gfx", "node_modules", "out"];
const MAX_PROJECT_FILES: usize = 5000;

/// Source writes from the Code workspace: `scenes/**`, `style/**`, `*.md` at the project root and `gfx.json`.
/// Never `..` / absolute (normalize_rel), never inside .git/ .gfx/ node_modules/ or out/.
pub fn check_source_writable(rel: &str) -> Result<(), String> {
    let parts = normalize_rel(rel)?;
    let bad = || format!("write not allowed (only scenes/**, style/**, *.md at the root, gfx.json): {rel}");
    if parts.iter().any(|p| SKIP_DIRS.contains(&p.as_str())) {
        return Err(bad());
    }
    let ok = match parts.len() {
        1 => parts[0] == "gfx.json" || (parts[0].to_ascii_lowercase().ends_with(".md") && parts[0].len() > 3),
        _ => parts[0] == "scenes" || parts[0] == "style",
    };
    if ok { Ok(()) } else { Err(bad()) }
}

#[derive(Serialize, Debug)]
pub struct ProjectFile {
    path: String,
    size: u64,
    mtime: u64,
    writable: bool,
}

#[derive(Serialize, Debug)]
pub struct ProjectFiles {
    files: Vec<ProjectFile>,
    truncated: bool,
}

/// Every file under the project (forward-slash relative paths, sorted), skipping out/ .gfx/ node_modules/ .git/ and
/// symlinks; `writable` = `check_source_writable`. Capped at MAX_PROJECT_FILES entries.
pub fn project_files_in(root: &str) -> ProjectFiles {
    let mut files = Vec::new();
    let mut truncated = false;
    let mut stack = vec![(PathBuf::from(root), String::new(), 0usize)];
    while let Some((dir, prefix, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_symlink() {
                continue;
            }
            let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if ft.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) && depth < 16 {
                    stack.push((e.path(), rel, depth + 1));
                }
                continue;
            }
            if files.len() >= MAX_PROJECT_FILES {
                truncated = true;
                continue;
            }
            let md = e.metadata().ok();
            let mtime = md.as_ref().and_then(|m| m.modified().ok()).and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            files.push(ProjectFile { writable: check_source_writable(&rel).is_ok(), size: md.map(|m| m.len()).unwrap_or(0), mtime, path: rel });
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    ProjectFiles { files, truncated }
}

/// Typed failures survive Tauri IPC so the editor can offer conflict resolution.
#[derive(Serialize, Debug)]
pub struct SourceWriteError {
    code: &'static str,
    message: String,
    mtime: u64,
    text: Option<String>,
}
impl From<String> for SourceWriteError {
    fn from(message: String) -> Self { Self { code: "write_failed", message, mtime: 0, text: None } }
}

/// Compare the editor snapshot before writing; missing files have mtime 0.
pub fn write_source_file(root: &str, rel: &str, text: &str, expect_mtime: u64, expect_text: Option<&str>) -> Result<u64, SourceWriteError> {
    check_source_writable(rel)?;
    let p = join_safe(root, rel)?;
    let mtime = mtime_ms(&p).unwrap_or(0);
    let current = match std::fs::read_to_string(&p) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("{rel}: {e}").into()),
    };
    if mtime != expect_mtime || expect_text.is_some_and(|t| current.as_deref() != Some(t)) {
        return Err(SourceWriteError { code: "conflict", message: "Changed on disk".into(), mtime, text: current });
    }
    if let Some(d) = p.parent() {
        std::fs::create_dir_all(d).map_err(|e| e.to_string())?;
    }
    std::fs::write(&p, text).map_err(|e| format!("{rel}: {e}"))?;
    Ok(mtime_ms(&p).unwrap_or(0))
}

#[tauri::command]
fn list_project_files(state: State<AppState>) -> ProjectFiles {
    project_files_in(&root_of(&state))
}

#[tauri::command]
fn write_project_file(rel: String, text: String, expect_mtime: u64, expect_text: Option<String>, state: State<AppState>) -> Result<Stat, SourceWriteError> {
    write_source_file(&root_of(&state), &rel, &text, expect_mtime, expect_text.as_deref()).map(|mtime| Stat { mtime })
}

// ---------- engine runner (docs/FOUNDATION.md §6) ----------
/// Split a project root into (WSL distro, Linux path). Accepts `\\wsl.localhost\<distro>\...`, `\\wsl$\<distro>\...`
/// (and the `\\?\UNC\` long form, forward slashes too). A plain absolute Linux path (not on Windows) gives distro None.
pub fn wsl_target(root: &str, on_windows: bool) -> Result<(Option<String>, String), String> {
    let bad = || format!("not a WSL project root (\\\\wsl.localhost\\<distro>\\...): {root}");
    let s = root.trim().replace('\\', "/");
    let s = match s.strip_prefix("//?/UNC/") {
        Some(r) => format!("//{r}"),
        None => s,
    };
    if let Some(rest) = s.strip_prefix("//") {
        let mut it = rest.splitn(3, '/');
        let host = it.next().unwrap_or("").to_ascii_lowercase();
        let distro = it.next().unwrap_or("");
        if host != "wsl.localhost" && host != "wsl$" {
            return Err(bad());
        }
        if distro.is_empty() {
            return Err(format!("no WSL distro in root {root}"));
        }
        let path = format!("/{}", it.next().unwrap_or("").trim_matches('/'));
        return Ok((Some(distro.to_string()), path));
    }
    if !on_windows && s.starts_with('/') {
        return Ok((None, s));
    }
    Err(bad())
}

/// Single-quote for bash.
pub fn sh_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Canonical spelling for comparing a server's ping root with ours: WSL roots reduce to the Linux path (case
/// significant); native Windows paths are compared case-insensitively with forward slashes.
pub fn normalize_server_root(root: &str) -> Result<String, String> {
    if let Ok((_, path)) = wsl_target(root, false) {
        let path = path.trim_end_matches('/');
        // a Windows drive seen from WSL (a native project served by a WSL engine): compare as the Windows path
        let b = path.as_bytes();
        if b.len() >= 6 && path.starts_with("/mnt/") && b[5].is_ascii_alphabetic() && (b.len() == 6 || b[6] == b'/') {
            return Ok(format!("{}:/{}", (b[5] as char).to_ascii_lowercase(), path.get(7..).unwrap_or("")).to_ascii_lowercase().trim_end_matches('/').to_string());
        }
        return Ok(if path.is_empty() { "/".into() } else { path.into() });
    }
    let mut s = root.trim().replace('\\', "/");
    if let Some(r) = s.strip_prefix("//?/") { s = r.to_string(); }
    let b = s.as_bytes();
    if b.len() >= 2 && b[1] == b':' && b[0].is_ascii_alphabetic() {
        let s = s.to_ascii_lowercase();
        return Ok(s.trim_end_matches('/').to_string());
    }
    Err(format!("unsupported project root {root}"))
}

fn other_server_error(root: &str) -> String {
    format!("port 5199 serves {root}; stop it or select that project")
}

/// Root of a server answering with a successful gfx ping.
fn ping_server(timeout: Duration) -> Option<String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], SERVER_PORT));
    let mut s = TcpStream::connect_timeout(&addr, timeout).ok()?;
    let _ = s.set_read_timeout(Some(timeout));
    let _ = s.set_write_timeout(Some(timeout));
    s.write_all(b"GET /__gfx/ping HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").ok()?;
    let mut buf = Vec::new();
    s.read_to_end(&mut buf).ok()?;
    let response = String::from_utf8(buf).ok()?;
    let (headers, body) = response.split_once("\r\n\r\n")?;
    if headers.lines().next()?.split_whitespace().nth(1)? != "200" { return None; }
    let ping: serde_json::Value = serde_json::from_str(body).ok()?;
    if ping.get("ok")?.as_bool()? != true { return None; }
    Some(ping.get("root")?.as_str()?.to_string())
}

#[derive(Deserialize, Default, Debug, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct RunOpts {
    /// Explicit distro for no-project prerequisite downloads from the WSL setup dialog.
    pub distro: Option<String>,
    /// Append `--progress json` (machine-readable output).
    pub progress: bool,
    /// Run without a project (`init`, `doctor`, `setup`): no GFX_PROJECT, cwd = engine dir (native or WSL).
    pub no_project: bool,
    /// Extra environment (only `GFX_*` names are accepted).
    pub env: HashMap<String, String>,
}

/// A fully resolved process to start.
#[derive(Debug, PartialEq, Clone)]
pub struct CmdSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub cwd: Option<PathBuf>,
}

/// Where the engine lives (docs/HOME-SETTINGS.md "Engine folder"): `GFX_ENGINE`, else the machine setting `engineDir`,
/// else `engine/` next to the exe. -> (folder, source: "env" | "setting" | "app").
pub fn engine_dir(env_engine: Option<&str>, setting: Option<&str>, exe: Option<&Path>) -> Option<(PathBuf, &'static str)> {
    if let Some(e) = env_engine.map(str::trim).filter(|s| !s.is_empty()) { return Some((PathBuf::from(e), "env")); }
    if let Some(e) = setting.map(str::trim).filter(|s| !s.is_empty()) { return Some((PathBuf::from(e), "setting")); }
    exe.and_then(|e| e.parent()).map(|d| (d.join("engine"), "app"))
}

/// Node binary: `GFX_NODE`, else the bundled `<engine>/node/node.exe`, else `node` from PATH (dev engines).
pub fn node_program(engine: &Path, env_node: Option<&str>, bundled_exists: bool) -> String {
    if let Some(n) = env_node.filter(|s| !s.is_empty()) { return n.to_string(); }
    if bundled_exists { return engine.join("node").join("node.exe").to_string_lossy().into_owned(); }
    "node".to_string()
}

/// An engine in WSL (`\\wsl.localhost\<distro>\...`): commands run there with its Linux `node`.
#[derive(Debug, Clone, PartialEq)]
pub struct WslEngine { pub distro: String, pub path: String }
/// The WSL spelling of an engine folder, if it is one.
pub fn wsl_engine_of(dir: &str) -> Option<WslEngine> {
    match wsl_target(dir, true) {
        Ok((Some(distro), path)) => Some(WslEngine { distro, path: path.trim_end_matches('/').to_string() }).map(|mut e| { if e.path.is_empty() { e.path = "/".into(); } e }),
        _ => None,
    }
}
/// A Windows absolute path argument (`C:\x`, `\\wsl.localhost\<distro>\x`) -> the path the WSL engine sees.
fn wsl_arg(a: &str) -> String {
    let b = a.as_bytes();
    let win = (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')) || a.starts_with("\\\\");
    if win { t3::wsl_path(a).unwrap_or_else(|_| a.to_string()) } else { a.to_string() }
}
/// Commands of a WSL engine (docs/HOME-SETTINGS.md "Engine folder"): `wsl.exe -d <distro> --cd <cwd> --exec bash -lc
/// "N=<engine>/node/node (else node); [GFX_*=..] $N <cli.js> ..."` (`--exec`: no login shell in between, which would
/// expand the script's `$` variables before bash sees them). No project (`init`, `doctor`, `setup`): cwd = the engine, `$N runner/cli.js`. A
/// project (native `C:\...` -> `/mnt/<drive>/...`, or a WSL project in the engine's distro, see `wsl_project_engine`):
/// cwd = its Linux path, `GFX_PROJECT` set, the engine's cli.js by its Linux path. Windows path arguments
/// (`gfx init C:\...`) become `/mnt/c/...`.
pub fn build_wsl_engine_command(eng: &WslEngine, root: &str, args: &[String], opts: &RunOpts) -> Result<CmdSpec, String> {
    // Linux-side: the stable symlink of an installed engine (a running command survives an update)
    let epath = engines::linux_path(&eng.path);
    let mut a: Vec<String> = args.iter().map(|x| wsl_arg(x)).collect();
    if opts.progress { a.push("--progress".into()); a.push("json".into()); }
    let mut env: Vec<(String, String)> = Vec::new();
    let mut extra: Vec<_> = opts.env.iter().collect();
    extra.sort();
    for (k, v) in extra {
        if !k.starts_with("GFX_") || k == "GFX_PROJECT" || k.contains('=') || k.contains('\0') {
            return Err(format!("environment variable not allowed: {k}"));
        }
        env.push((k.clone(), v.clone()));
    }
    let (cwd, cli) = if opts.no_project {
        (epath.clone(), "runner/cli.js".to_string())
    } else {
        let p = t3::wsl_path(root)?;
        env.push(("GFX_PROJECT".into(), p.clone()));
        (p, sh_quote(&format!("{}/runner/cli.js", epath.trim_end_matches('/'))))
    };
    let exports: String = env.iter().map(|(k, v)| format!("{k}={} ", sh_quote(v))).collect();
    // the engine's own node (an installed bundle, docs/INSTALL.md §1), else `node` on the login PATH (a dev checkout)
    let node_sel = format!("N={}; [ -x \"$N\" ] || N=node; ", sh_quote(&format!("{}/node/node", epath.trim_end_matches('/'))));
    let cmdline = std::iter::once(format!("\"$N\" {cli}")).chain(a.iter().map(|x| sh_quote(x))).collect::<Vec<_>>().join(" ");
    let wa = vec!["-d".to_string(), eng.distro.clone(), "--cd".into(), cwd, "--exec".into(), "bash".into(), "-lc".into(), format!("{node_sel}{exports}{cmdline}")];
    Ok(CmdSpec { program: "wsl.exe".into(), args: wa, env: vec![], cwd: None })
}

/// Pure command construction for a native engine: the engine's node on `<engine>/runner/cli.js` with `GFX_PROJECT` +
/// cwd = project (WSL projects and WSL engines go through `build_wsl_engine_command`).
pub fn build_command(root: &str, args: &[String], opts: &RunOpts, engine: &Path, node: &str) -> Result<CmdSpec, String> {
    let mut a: Vec<String> = args.to_vec();
    if opts.progress { a.push("--progress".into()); a.push("json".into()); }
    let mut env: Vec<(String, String)> = Vec::new();
    let mut extra: Vec<_> = opts.env.iter().collect();
    extra.sort();
    for (k, v) in extra {
        if !k.starts_with("GFX_") || k == "GFX_PROJECT" || k.contains('=') || k.contains('\0') {
            return Err(format!("environment variable not allowed: {k}"));
        }
        env.push((k.clone(), v.clone()));
    }
    let mut full = vec![engine.join("runner").join("cli.js").to_string_lossy().into_owned()];
    full.extend(a);
    let cwd = if opts.no_project { engine.to_path_buf() } else { PathBuf::from(root) };
    if !opts.no_project { env.push(("GFX_PROJECT".into(), root.to_string())); }
    Ok(CmdSpec { program: node.to_string(), args: full, env, cwd: Some(cwd) })
}

pub struct Job {
    pid: AtomicU32,
    canceled: AtomicBool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub code: i32,
    pub outputs: Vec<String>,
    pub canceled: bool,
    /// Message of the last `{type:"error"}` line, if any.
    pub error: Option<String>,
}

/// Kill a process and all of its children.
pub fn kill_tree(pid: u32) {
    use std::process::{Command, Stdio};
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill.exe").args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).creation_flags(0x0800_0000).status();
    }
    #[cfg(not(windows))]
    {
        let g = format!("-{pid}");
        let ok = Command::new("kill").args(["-KILL", "--", &g]).stderr(Stdio::null()).status().map(|s| s.success()).unwrap_or(false);
        if !ok { let _ = Command::new("kill").args(["-KILL", &pid.to_string()]).stderr(Stdio::null()).status(); }
    }
}

/// Interpret one output line: JSON object lines with a string `type` pass through, anything else becomes a log event.
pub fn line_event(line: &str, stderr: bool) -> serde_json::Value {
    let t = line.trim();
    if !stderr && t.starts_with('{') {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(t) {
            if v.get("type").map(|x| x.is_string()).unwrap_or(false) { return v; }
        }
    }
    // leading spaces are kept (indented lines of `gfx context` briefs)
    serde_json::json!({ "type": "log", "level": if stderr { "warn" } else { "info" }, "msg": line.trim_end(), "stream": if stderr { "stderr" } else { "stdout" } })
}

/// The settings file the engine resolution reads (`engineDir`); set at start.
static SETTINGS_FILE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
/// `engines.json` (installed engines, docs/INSTALL.md §2) next to settings.json.
fn engines_file() -> Option<PathBuf> { SETTINGS_FILE.get().map(|p| p.with_file_name("engines.json")) }
fn engine_setting() -> Option<String> {
    SETTINGS_FILE.get().and_then(|p| prefs::load_settings(p).pref_str("engineDir").map(String::from))
}
/// A folder is an engine when it has `runner/cli.js`.
pub fn check_engine_folder(dir: &str) -> Result<(), String> {
    let d = dir.trim();
    if d.is_empty() { return Err("no engine folder given".into()); }
    if Path::new(d).join("runner").join("cli.js").is_file() { return Ok(()); }
    if !Path::new(d).is_dir() { return Err(format!("Engine folder not found: {d}")); }
    Err(format!("No gfx engine in {d}: runner\\cli.js is missing. Choose the folder that contains runner\\ (the gfx engine or repo)."))
}

/// A resolved engine: its folder (native or `\\wsl.localhost\...`), node (native engines), where it came from, and the
/// WSL spelling when it lives in WSL.
#[derive(Debug, Clone)]
pub struct EngineLoc { pub dir: PathBuf, pub node: String, pub source: &'static str, pub wsl: Option<WslEngine> }

pub(crate) fn locate_engine() -> Result<EngineLoc, String> {
    let exe = std::env::current_exe().ok();
    let (eng, source) = engine_dir(std::env::var("GFX_ENGINE").ok().as_deref(), engine_setting().as_deref(), exe.as_deref())
        .ok_or("cannot locate the engine folder")?;
    if !eng.join("runner").join("cli.js").is_file() {
        // a WSL-only install (docs/INSTALL.md §2): the installed WSL engine serves Windows projects too (through /mnt/c)
        if source == "app" && cfg!(windows) {
            let f = engines_file().map(|f| engines::load(&f)).unwrap_or_default();
            if let Some((distro, path)) = engines::fallback_wsl(&f, |d, p| wsl_unc(d, p).join("runner").join("cli.js").is_file()) {
                let dir = wsl_unc(&distro, &path);
                return Ok(EngineLoc { dir, node: "node".into(), source: "installed", wsl: Some(WslEngine { distro, path }) });
            }
        }
        return Err(match source {
            "env" => format!("engine not found at {} (GFX_ENGINE)", eng.display()),
            "setting" => format!("engine not found at {} (Settings → Engine & tools → Engine folder)", eng.display()),
            _ => format!("engine not found at {}: choose an engine folder (Settings → Engine & tools)", eng.display()),
        });
    }
    let wsl = if cfg!(windows) { wsl_engine_of(&eng.to_string_lossy()) } else { None };
    let node = node_program(&eng, std::env::var("GFX_NODE").ok().as_deref(), eng.join("node").join("node.exe").is_file());
    Ok(EngineLoc { dir: eng, node, source, wsl })
}
/// A native engine (folder + node) for callers that run it directly (terminal PATH); a WSL engine is an error here.
pub(crate) fn resolve_engine() -> Result<(PathBuf, String), String> {
    let e = locate_engine()?;
    if e.wsl.is_some() { return Err("the engine is in WSL".into()); }
    Ok((e.dir, e.node))
}

/// The engine that runs commands for a WSL project (`\\wsl.localhost\<distro>\...`, docs/INSTALL.md §2): the project
/// itself when it is an engine checkout (this repo); else the located engine (GFX_ENGINE / Engine folder) when it is a
/// WSL engine in the same distro (developer override); else the engine installed in that distro (`engines.json`). A
/// Windows engine can't serve a WSL project (its Vite answers 404 for the scene files under the UNC root).
pub fn wsl_project_engine(distro: &str, project: &str, project_is_engine: bool, located: Result<(PathBuf, Option<WslEngine>), String>, installed: Option<&str>) -> Result<WslEngine, String> {
    if project_is_engine { return Ok(WslEngine { distro: distro.to_string(), path: project.trim_end_matches('/').to_string() }); }
    if let Ok((_, Some(w))) = &located {
        if w.distro.eq_ignore_ascii_case(distro) { return Ok(WslEngine { distro: distro.to_string(), path: w.path.clone() }); }
    }
    if let Some(p) = installed { return Ok(WslEngine { distro: distro.to_string(), path: p.trim_end_matches('/').to_string() }); }
    let fix = format!("install the WSL engine in {distro}, or choose an engine folder inside WSL {distro} (Settings → Engine & tools → Engine folder, e.g. \\\\wsl.localhost\\{distro}\\home\\<you>\\gfx)");
    match located {
        Err(e) => Err(format!("{e}. This project is in WSL ({distro}): {fix}")),
        Ok((dir, None)) => Err(format!("The engine {} is a Windows folder, but this project is in WSL ({distro}); a Windows engine can't serve it. Either {fix}, or move the project to a Windows folder.", dir.display())),
        // the same distro returned above: another distro
        Ok((_, Some(w))) => Err(format!("The engine is in WSL {}, but this project is in WSL {distro}: {fix}.", w.distro)),
    }
}

/// The engine for a WSL project root (None: not a WSL root).
pub(crate) fn wsl_root_engine(root: &str) -> Option<Result<WslEngine, String>> {
    let Ok((Some(distro), path)) = wsl_target(root, false) else { return None };
    let own = Path::new(root).join("runner").join("cli.js").is_file();
    let located = if own { Err(String::new()) } else { locate_engine().map(|e| (e.dir, e.wsl)) };
    let installed = engines_file().map(|f| engines::load(&f)).unwrap_or_default();
    Some(wsl_project_engine(&distro, &path, own, located, engines::installed_wsl(&installed, &distro).map(|e| e.path.as_str())))
}

/// The folder a no-project command is about, which picks its engine like a project root (a WSL folder → that distro's
/// engine): `init <dir>`, and `template … --for <folder>` (docs/TEMPLATES.md §4: the template list / clip / remove
/// of the engine that will create the project).
pub fn no_project_target(args: &[String]) -> Option<&str> {
    match args.first().map(String::as_str) {
        Some("init") => args.get(1).filter(|p| !p.starts_with('-')).map(String::as_str),
        Some("template") => args.iter().position(|a| a == "--for").and_then(|i| args.get(i + 1)).filter(|p| !p.is_empty()).map(String::as_str),
        _ => None,
    }
}

fn spec_for(root: &str, args: &[String], opts: &RunOpts) -> Result<CmdSpec, String> {
    if let Some(distro) = &opts.distro {
        if !opts.no_project { return Err("distro is only supported for no-project commands".into()); }
        let installed = engines_file().map(|f| engines::load(&f)).unwrap_or_default();
        let eng = engines::installed_wsl(&installed, distro).ok_or("No installed engine in that distro")?;
        return build_wsl_engine_command(&WslEngine { distro: distro.clone(), path: eng.path.clone() }, "", args, opts);
    }
    let target = if opts.no_project { no_project_target(args) } else { Some(root) };
    if let Some(target) = target {
        if let Some(eng) = wsl_root_engine(target) {
            return build_wsl_engine_command(&eng?, root, args, opts);
        }
    }
    let e = locate_engine()?;
    if let Some(w) = &e.wsl { return build_wsl_engine_command(w, root, args, opts); }
    build_command(root, args, opts, &e.dir, &e.node)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo { path: String, source: String, found: bool, wsl: bool, error: Option<String>, setting: String, suggest: Option<String> }
/// The engine the app uses (Settings → Engine & tools, welcome status strip). `suggest`: a recent project folder that is
/// itself an engine (a dev checkout of the gfx repo), offered when no engine is found.
#[tauri::command]
fn engine_info(state: State<AppState>) -> EngineInfo {
    let setting = engine_setting().unwrap_or_default();
    let suggest = prefs::load_recent(&prefs::recent_path(&state)).recent.iter().map(|r| r.path.clone())
        .find(|p| Path::new(p).join("runner").join("cli.js").is_file());
    match locate_engine() {
        Ok(e) => EngineInfo { path: e.dir.to_string_lossy().into_owned(), source: e.source.into(), found: true, wsl: e.wsl.is_some(), error: None, setting, suggest: None },
        Err(err) => {
            let exe = std::env::current_exe().ok();
            let (dir, source) = engine_dir(std::env::var("GFX_ENGINE").ok().as_deref(), Some(setting.as_str()), exe.as_deref()).unwrap_or((PathBuf::new(), "app"));
            EngineInfo { path: dir.to_string_lossy().into_owned(), source: source.into(), found: false, wsl: false, error: Some(err), setting, suggest }
        }
    }
}

/// One engine for Settings → Engine & tools (docs/INSTALL.md §2): `kind` "default" = the engine of Windows projects
/// (GFX_ENGINE / Engine folder / next to the app), "wsl" = an installed WSL engine (one per distro, `engines.json`).
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineRow { update: bool, kind: String, distro: Option<String>, path: String, version: Option<String>, found: bool, source: String, wsl: bool, error: Option<String> }

/// `\\wsl.localhost\<distro>\<linux path>` (how Windows reads a WSL engine's files).
pub fn wsl_unc(distro: &str, linux_path: &str) -> PathBuf {
    PathBuf::from(format!(r"\\wsl.localhost\{distro}{}", linux_path.replace('/', "\\")))
}
/// Rows for the installed WSL engines; `dir_of` maps (distro, Linux path) to a readable folder.
pub fn wsl_engine_rows(f: &engines::EnginesFile, dir_of: impl Fn(&str, &str) -> PathBuf) -> Vec<EngineRow> {
    f.wsl.iter().map(|(distro, inst)| {
        let dir = dir_of(distro, &inst.path);
        let found = dir.join("runner").join("cli.js").is_file();
        let version = engines::engine_version(&dir).or_else(|| (!inst.version.is_empty()).then(|| inst.version.clone()));
        EngineRow {
            update: inst.version != env!("CARGO_PKG_VERSION"), kind: "wsl".into(), distro: Some(distro.clone()), path: inst.path.clone(), version, found, source: "installed".into(), wsl: true,
            error: (!found).then(|| format!("no engine at {} in WSL {distro} (reinstall it: Settings → Engine & tools)", inst.path)),
        }
    }).collect()
}
#[tauri::command]
fn engines_info() -> Vec<EngineRow> {
    let mut rows = vec![match locate_engine() {
        Ok(e) => EngineRow { update: false, kind: "default".into(), distro: e.wsl.as_ref().map(|w| w.distro.clone()), path: e.dir.to_string_lossy().into_owned(), version: engines::engine_version(&e.dir), found: true, source: e.source.into(), wsl: e.wsl.is_some(), error: None },
        Err(err) => {
            let exe = std::env::current_exe().ok();
            let (dir, source) = engine_dir(std::env::var("GFX_ENGINE").ok().as_deref(), engine_setting().as_deref(), exe.as_deref()).unwrap_or((PathBuf::new(), "app"));
            EngineRow { update: false, kind: "default".into(), distro: None, path: dir.to_string_lossy().into_owned(), version: None, found: false, source: source.into(), wsl: false, error: Some(err) }
        }
    }];
    let f = engines_file().map(|f| engines::load(&f)).unwrap_or_default();
    rows.extend(wsl_engine_rows(&f, |d, p| if cfg!(windows) { wsl_unc(d, p) } else { PathBuf::from(p) }));
    rows
}

// Serialize WSL mutation jobs to preserve engines.json across installs/removes.
static WSL_MUTATION: Mutex<()> = Mutex::new(());

#[derive(Serialize)]
struct WslBundleInfo { path: String, exists: bool, version: String }
#[tauri::command]
fn wsl_bundle_info() -> WslBundleInfo {
    let path = std::env::var_os("GFX_WSL_BUNDLE").map(PathBuf::from).unwrap_or_else(||
        std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("engine-wsl.tar.gz"))).unwrap_or_default());
    WslBundleInfo { exists: path.is_file(), path: path.to_string_lossy().into_owned(), version: env!("CARGO_PKG_VERSION").into() }
}

fn wsl_spec(distro: &str, script: &str) -> CmdSpec {
    CmdSpec { program: "wsl.exe".into(), args: engines::wsl_script_args(distro, script), env: vec![("WSL_UTF8".into(), "1".into())], cwd: None }
}
fn wsl_output(spec: &CmdSpec) -> Result<std::process::Output, String> {
    let mut cmd = std::process::Command::new(&spec.program);
    cmd.args(&spec.args).envs(spec.env.iter().cloned());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); }
    let out = cmd.output().map_err(|e| format!("WSL: {e}"))?;
    if !out.status.success() { return Err(format!("WSL: {}", engines::decode_wsl(&out.stderr))); }
    Ok(out)
}
fn require_distro(distro: &str) -> Result<(), String> {
    if distro.trim().is_empty() || distro.starts_with('-') || distro.contains(['\0', '\r', '\n']) || distro.to_ascii_lowercase().starts_with("docker-desktop") {
        return Err("Choose a WSL distro".into());
    }
    Ok(())
}
#[tauri::command]
async fn wsl_distros() -> Result<Vec<engines::Distro>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let spec = CmdSpec { program: "wsl.exe".into(), args: vec!["-l".into(), "-v".into()], env: vec![("WSL_UTF8".into(), "1".into())], cwd: None };
        Ok(engines::parse_distros(&wsl_output(&spec)?.stdout))
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn wsl_engine_checks(distro: String) -> Result<engines::Checks, String> {
    require_distro(&distro)?;
    tauri::async_runtime::spawn_blocking(move || {
        let out = wsl_output(&wsl_spec(&distro, engines::CHECKS_SCRIPT))?;
        Ok(engines::parse_checks(&engines::decode_wsl(&out.stdout)))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn wsl_engine_setup(app: tauri::AppHandle, distro: String, link_path: bool, job_id: String) -> Result<RunResult, String> {
    require_distro(&distro)?;
    if !valid_job_id(&job_id) || job_id == "serve" { return Err("invalid job id".into()); }
    let bundle = wsl_bundle_info();
    if !bundle.exists { return Err(format!("Bundle not found: {}", bundle.path)); }
    // Reserve before returning to the event loop, so immediate cancellation is remembered, including between stages.
    let job = Arc::new(Job { pid: AtomicU32::new(0), canceled: AtomicBool::new(false) });
    {
        let state = app.state::<AppState>();
        let mut jobs = state.jobs.lock().unwrap();
        if jobs.contains_key(&job_id) { return Err("job already running".into()); }
        jobs.insert(job_id.clone(), job.clone());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let event = format!("engine://{job_id}");
        let mut step = "Unpack bundle";
        let run = (|| -> Result<RunResult, String> {
            let _guard = WSL_MUTATION.try_lock().map_err(|_| "Another WSL engine operation is running")?;
            let progress = |label: &str, pct: u32| { let _ = app.emit(&event, serde_json::json!({"type":"progress", "label":label, "pct":pct})); };
            progress(step, 10);
            let file = std::fs::File::open(&bundle.path).map_err(|e| e.to_string())?;
            let spec = wsl_spec(&distro, &engines::setup_script(&bundle.version, link_path));
            let (result, lines) = launch_input(&app, &job_id, &spec, Some(file), Some(job.clone()))?.wait_lines();
            if result.canceled { return Ok(result); }
            if result.code != 0 || result.error.is_some() { return Err(format!("{}\n{}", result.error.unwrap_or_default(), lines.iter().rev().take(12).rev().cloned().collect::<Vec<_>>().join("\n"))); }
            let home = lines.iter().find_map(|l| l.strip_prefix("HOME=")).filter(|h| h.starts_with('/') && !h.split('/').any(|s| s == ".." )).ok_or("WSL did not report HOME")?;
            if job.canceled.load(Ordering::SeqCst) { return Err("Canceled".into()); }
            step = "Register engine";
            progress(step, 70);
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64;
            // the versioned folder, not the `engine` symlink: Windows can't follow WSL symlinks over \\wsl.localhost, so
            // presence checks, the version and the templates are read through the real folder (the symlink serves Linux)
            let path = engines::versioned_path(&home, &bundle.version);
            engines::save_entry(&engines_file().ok_or("settings path unavailable")?, &distro, Some(engines::WslInstalled {
                path: path.clone(), version: bundle.version.clone(), installed: iso_utc(now),
            }))?;
            step = "Run doctor";
            progress(step, 85);
            let eng = WslEngine { distro, path };
            let spec = build_wsl_engine_command(&eng, "", &["doctor".into(), "--json".into()], &RunOpts { no_project: true, ..Default::default() })?;
            let (result, lines) = launch_input(&app, &job_id, &spec, None, Some(job.clone()))?.wait_lines();
            // Doctor's non-zero status commonly means missing prerequisites; show those in the checks list.
            if !result.canceled && engines::parse_checks(&lines.join("\n")).doctor.is_none() {
                return Err(format!("Doctor did not produce a report: {}\n{}", result.error.unwrap_or_default(), lines.iter().rev().take(12).rev().cloned().collect::<Vec<_>>().join("\n")));
            }
            progress("Done", 100);
            Ok(RunResult { code: 0, error: None, ..result })
        })();
        app.state::<AppState>().jobs.lock().unwrap().remove(&job_id);
        let result = run.unwrap_or_else(|e| RunResult { code: -1, outputs: vec![], canceled: job.canceled.load(Ordering::SeqCst), error: Some(format!("{step}: {e}")) });
        let _ = app.emit(&event, serde_json::json!({"type":"exit", "code":result.code, "canceled":result.canceled, "error":result.error}));
        result
    }).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn wsl_engine_remove(distro: String) -> Result<(), String> {
    require_distro(&distro)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = WSL_MUTATION.try_lock().map_err(|_| "Another WSL engine operation is running")?;
        wsl_output(&wsl_spec(&distro, engines::remove_script()))?;
        engines::save_entry(&engines_file().ok_or("settings path unavailable")?, &distro, None)
    }).await.map_err(|e| e.to_string())?
}

#[derive(Serialize)]
struct WindowsPathState { exists: bool, added: bool, entry: String }
fn windows_engine_bin() -> PathBuf {
    std::env::current_exe().ok().and_then(|p| p.parent().map(|p| p.join("engine").join("bin"))).unwrap_or_default()
}
#[tauri::command]
fn windows_path_state() -> Result<WindowsPathState, String> {
    let bin = windows_engine_bin();
    let entry = bin.to_string_lossy().into_owned();
    let mut path = engines::user_path(None)?;
    let exists = cfg!(windows) && bin.parent().map(|p| p.is_dir()).unwrap_or(false);
    // the choice is recorded: put a lost entry back (an uninstall that was cancelled after the hook removed it)
    let marker = SETTINGS_FILE.get().map(|f| f.with_file_name(engines::PATH_MARKER));
    let wanted = marker.as_ref().map(|m| m.is_file()).unwrap_or(false);
    let present = engines::path_contains(&path, &entry);
    if engines::path_hook_plan("install", wanted, exists, present) == Some(true) {
        path = engines::user_path(Some((&entry, true)))?;
    } else if present && !wanted && exists {
        // an entry from before the marker existed: record it, so the next upgrade keeps it
        if let Some(m) = &marker { let _ = std::fs::write(m, b""); }
    }
    Ok(WindowsPathState { exists, added: engines::path_contains(&path, &entry), entry })
}
#[tauri::command]
fn set_windows_path(add: bool) -> Result<WindowsPathState, String> {
    let bin = windows_engine_bin();
    if !cfg!(windows) || !bin.parent().map(|p| p.is_dir()).unwrap_or(false) { return Err("Windows engine not installed".into()); }
    engines::user_path(Some((&bin.to_string_lossy(), add)))?;
    // the choice outlives an upgrade (the old uninstaller removes the entry, the new installer adds it back: path_hook)
    if let Some(marker) = SETTINGS_FILE.get().map(|f| f.with_file_name(engines::PATH_MARKER)) {
        let _ = if add { std::fs::write(&marker, b"") } else { std::fs::remove_file(&marker) };
    }
    windows_path_state()
}

/// `gfx-studio.exe --path-hook install|uninstall <app data dir>`, run by the NSIS hooks (installer/hooks.nsh). Uninstall
/// always removes the user PATH entry (an upgrade runs the old uninstaller too); install adds it back when the app data
/// folder still has the marker set_windows_path writes. Returns the process exit code.
pub fn path_hook(mode: &str, data_dir: &str) -> i32 {
    let bin = windows_engine_bin();
    let entry = bin.to_string_lossy().into_owned();
    let present = engines::user_path(None).map(|p| engines::path_contains(&p, &entry)).unwrap_or(false);
    let marker = Path::new(data_dir).join(engines::PATH_MARKER);
    // an entry from before the marker existed counts as the choice: record it before an uninstall removes the evidence
    if mode == "install" && present && !marker.is_file() { let _ = std::fs::create_dir_all(data_dir).and_then(|_| std::fs::write(&marker, b"")); }
    let wanted = marker.is_file();
    match engines::path_hook_plan(mode, wanted, bin.is_dir(), present) {
        Some(add) => if engines::user_path(Some((&entry, add))).is_ok() { 0 } else { 1 },
        None => 0,
    }
}

/// A started job: pipes are drained by `wait`, which blocks until the process ends.
pub struct Running {
    child: Child,
    job: Arc<Job>,
    id: String,
    app: tauri::AppHandle,
    persistent: bool,
    input: Option<std::thread::JoinHandle<Result<u64, std::io::Error>>>,
}

fn launch(app: &tauri::AppHandle, id: &str, spec: &CmdSpec) -> Result<Running, String> {
    launch_input(app, id, spec, None, None)
}

fn launch_input(app: &tauri::AppHandle, id: &str, spec: &CmdSpec, input: Option<std::fs::File>, shared: Option<Arc<Job>>) -> Result<Running, String> {
    use std::process::{Command, Stdio};
    let state = app.state::<AppState>();
    // Keep the reservation locked until it has a real pid, so cancel never sees pid 0.
    let mut jobs = state.jobs.lock().unwrap();
    let persistent = shared.is_some();
    if !persistent && jobs.contains_key(id) { return Err(format!("job {id} is already running")); }
    let job = shared.unwrap_or_else(|| Arc::new(Job { pid: AtomicU32::new(0), canceled: AtomicBool::new(false) }));
    if job.canceled.load(Ordering::SeqCst) { return Err("Canceled".into()); }
    jobs.insert(id.to_string(), job.clone());
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).envs(spec.env.iter().cloned()).stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(c) = &spec.cwd { cmd.current_dir(c); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            if !persistent { jobs.remove(id); }
            return Err(format!("could not start {}: {e}", spec.program));
        }
    };
    job.pid.store(child.id(), Ordering::SeqCst);
    let input = input.map(|mut file| {
        let mut stdin = child.stdin.take().expect("piped stdin");
        std::thread::spawn(move || std::io::copy(&mut file, &mut stdin))
    });
    Ok(Running { child, job, id: id.to_string(), app: app.clone(), persistent, input })
}

impl Running {
    fn wait(self) -> RunResult { self.wait_lines().0 }

    fn wait_lines(mut self) -> (RunResult, Vec<String>) {
        let event = format!("engine://{}", self.id);
        let outputs = Arc::new(Mutex::new(Vec::<String>::new()));
        let error = Arc::new(Mutex::new(None::<String>));
        let lines = Arc::new(Mutex::new(Vec::<String>::new()));
        let tail = Arc::new(Mutex::new(Vec::<String>::new()));
        let mut threads = Vec::new();
        let pipes: [(Option<Box<dyn Read + Send>>, bool); 2] = [
            (self.child.stdout.take().map(|p| Box::new(p) as Box<dyn Read + Send>), false),
            (self.child.stderr.take().map(|p| Box::new(p) as Box<dyn Read + Send>), true),
        ];
        for (pipe, is_err) in pipes {
            let Some(pipe) = pipe else { continue };
            let (app, ev, outputs, error) = (self.app.clone(), event.clone(), outputs.clone(), error.clone());
            let lines = lines.clone();
            let tail = tail.clone();
            let capture = self.persistent;
            threads.push(std::thread::spawn(move || {
                let mut rd = std::io::BufReader::new(pipe);
                let mut buf = Vec::new();
                loop {
                    buf.clear();
                    match rd.read_until(b'\n', &mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }
                    let line = String::from_utf8_lossy(&buf).trim_end_matches(['\r', '\n']).to_string();
                    if line.trim().is_empty() { continue; }
                    if capture {
                        // Keep stdout intact for HOME/doctor JSON; stderr can arrive between stdout lines.
                        if !is_err { lines.lock().unwrap().push(line.clone()); }
                        let mut last = tail.lock().unwrap();
                        last.push(line.clone());
                        if last.len() > 12 { last.remove(0); }
                    }
                    let v = line_event(&line, is_err);
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("done") => {
                            if let Some(a) = v.get("outputs").and_then(|o| o.as_array()) {
                                outputs.lock().unwrap().extend(a.iter().filter_map(|x| x.as_str().map(String::from)));
                            }
                        }
                        Some("error") => *error.lock().unwrap() = v.get("msg").and_then(|m| m.as_str()).map(String::from),
                        _ => {}
                    }
                    let _ = app.emit(&ev, v);
                }
            }));
        }
        let status = self.child.wait();
        if let Some(t) = self.input.take() {
            if !matches!(t.join(), Ok(Ok(_))) { *error.lock().unwrap() = Some("could not stream WSL bundle to stdin".into()); }
        }
        for t in threads { let _ = t.join(); }
        let state = self.app.state::<AppState>();
        {
            let mut jobs = state.jobs.lock().unwrap();
            if !self.persistent && jobs.get(&self.id).map(|job| Arc::ptr_eq(job, &self.job)).unwrap_or(false) {
                jobs.remove(&self.id);
            }
        }
        let canceled = self.job.canceled.load(Ordering::SeqCst);
        let code = status.ok().and_then(|s| s.code()).unwrap_or(-1);
        if !self.persistent { let _ = self.app.emit(&event, serde_json::json!({ "type": "exit", "code": code, "canceled": canceled })); }
        self.job.pid.store(0, Ordering::SeqCst);
        let outputs = outputs.lock().unwrap().clone();
        let mut error = error.lock().unwrap().clone();
        if self.persistent && code != 0 && error.is_none() {
            error = Some(tail.lock().unwrap().join("\n"));
        }
        let lines = lines.lock().unwrap().clone();
        (RunResult { code, outputs, canceled, error }, lines)
    }
}

fn cancel_job(state: &AppState, id: &str) -> bool {
    let job = state.jobs.lock().unwrap().get(id).cloned();
    match job {
        Some(j) => { j.canceled.store(true, Ordering::SeqCst); let pid = j.pid.load(Ordering::SeqCst); if pid != 0 { kill_tree(pid); } true }
        None => false,
    }
}

/// Cancel and wait (up to 4 s) until the job has left the table.
fn stop_job(state: &AppState, id: &str) {
    if !cancel_job(state, id) { return; }
    let t0 = Instant::now();
    while state.jobs.lock().unwrap().contains_key(id) && t0.elapsed() < Duration::from_secs(4) {
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn kill_server(state: &AppState) { stop_job(state, "serve"); }

pub fn valid_job_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Run an engine CLI command to completion. Output lines stream to the webview as `engine://<jobId>` events.
#[tauri::command]
async fn engine_run(app: tauri::AppHandle, job_id: String, args: Vec<String>, opts: Option<RunOpts>, state: State<'_, AppState>) -> Result<RunResult, String> {
    if !valid_job_id(&job_id) { return Err("invalid job id".into()); }
    if job_id == "serve" { return Err("reserved job id".into()); }
    let opts = opts.unwrap_or_default();
    let spec = spec_for(&root_of(&state), &args, &opts)?;
    let running = launch(&app, &job_id, &spec)?;
    tauri::async_runtime::spawn_blocking(move || running.wait()).await.map_err(|e| e.to_string())
}

/// Kill the job's process tree. Returns whether the job was running.
#[tauri::command]
fn engine_cancel(job_id: String, state: State<AppState>) -> bool {
    cancel_job(&state, &job_id)
}

#[derive(Serialize)]
pub struct ServerInfo {
    url: String,
}

/// Start `gfx serve` for the current project (or reuse one that already answers). Returns its URL.
#[tauri::command]
async fn start_server(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<ServerInfo, String> {
    let url = format!("http://127.0.0.1:{SERVER_PORT}");
    let root = root_of(&state);
    let expected = normalize_server_root(&root)?;
    if let Some(served) = ping_server(Duration::from_millis(600)) {
        if normalize_server_root(&served).ok().as_ref() == Some(&expected) {
            return Ok(ServerInfo { url });
        }
        if !state.jobs.lock().unwrap().contains_key("serve") { return Err(other_server_error(&served)); }
        kill_server(&state);
    }
    if !state.jobs.lock().unwrap().contains_key("serve") {
        let spec = spec_for(&root, &["serve".into(), "--port".into(), SERVER_PORT.to_string()], &RunOpts::default())?;
        let running = launch(&app, "serve", &spec)?;
        std::thread::spawn(move || { running.wait(); });
    }
    let t0 = Instant::now();
    while t0.elapsed() < Duration::from_secs(40) {
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(300))).await.ok();
        if let Some(served) = ping_server(Duration::from_millis(600)) {
            if normalize_server_root(&served).ok().as_ref() == Some(&expected) {
                return Ok(ServerInfo { url });
            }
            kill_server(&state);
            return Err(other_server_error(&served));
        }
        if !state.jobs.lock().unwrap().contains_key("serve") {
            return Err("the live server exited right after starting (is the engine installed? WSL roots need `node` on the login PATH)".into());
        }
    }
    kill_server(&state);
    Err("the live server did not answer within 40 s".into())
}

// ---------- project engine record (docs/FOUNDATION.md §1 ".gfx/engine.json") ----------
/// `.gfx/engine.json` content: the engine as the project's own shell sees it. A WSL engine gives Linux paths; `wsl` =
/// its distro when the project is on Windows (Windows shells run it as `wsl.exe -d <wsl> -- <bin>`).
pub fn engine_record(dir: &Path, node: &str, wsl: Option<&WslEngine>, wsl_root: bool, on_windows: bool) -> serde_json::Value {
    match wsl {
        Some(w) => {
            let mut v = serde_json::json!({ "engine": w.path, "bin": format!("{}/bin/gfx", w.path.trim_end_matches('/')), "node": "node" });
            if !wsl_root { v["wsl"] = w.distro.clone().into(); }
            v
        }
        None => {
            let bin = dir.join("bin").join(if on_windows { "gfx.cmd" } else { "gfx" });
            serde_json::json!({ "engine": dir.to_string_lossy(), "bin": bin.to_string_lossy(), "node": node })
        }
    }
}

/// UTC `YYYY-MM-DDTHH:MM:SS.mmmZ` from epoch ms (days -> civil date, H. Hinnant's algorithm).
pub fn iso_utc(ms: u64) -> String {
    let (days, rem) = ((ms / 86_400_000) as i64, ms % 86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, rem / 60_000 % 60, rem / 1000 % 60, rem % 1000)
}

/// Write `<root>/.gfx/engine.json` unless it already names the same engine (the engine's own `gfx init` writes the
/// absolute node path, which the studio doesn't know for a WSL engine), and make sure .gitignore ignores `.gfx/` (the
/// line is appended; nothing else is touched). -> whether the record was written.
pub fn write_engine_record(root: &str, mut rec: serde_json::Value, now_ms: u64) -> Result<bool, String> {
    let dir = Path::new(root).join(".gfx");
    let file = dir.join("engine.json");
    let cur: Option<serde_json::Value> = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str(&t).ok());
    let same = cur.as_ref().map(|c| c.get("engine") == rec.get("engine") && c.get("wsl") == rec.get("wsl")).unwrap_or(false);
    if !same {
        rec["updated"] = iso_utc(now_ms).into();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::write(&file, serde_json::to_string_pretty(&rec).unwrap() + "\n").map_err(|e| e.to_string())?;
    }
    let gi = Path::new(root).join(".gitignore");
    let text = std::fs::read_to_string(&gi).unwrap_or_default();
    if !text.lines().any(|l| matches!(l.trim(), ".gfx/" | ".gfx" | "/.gfx/" | "/.gfx")) {
        let sep = if text.is_empty() || text.ends_with('\n') { "" } else { "\n" };
        std::fs::write(&gi, format!("{text}{sep}.gfx/\n")).map_err(|e| e.to_string())?;
    }
    Ok(!same)
}

const GFX_BEGIN: &str = "<!-- gfx:begin -->";
const GFX_END: &str = "<!-- gfx:end -->";
fn managed_block(text: &str) -> Option<String> {
    let a = text.find(GFX_BEGIN)?;
    let b = text[a..].find(GFX_END)? + a + GFX_END.len();
    Some(text[a..b].replace("\r\n", "\n"))
}
/// The block without its project-specific lines (docs/LOOKS.md: the workflow line and the look line depend on gfx.json and
/// the machine setting, not on the template): template placeholders `- {{workflow}}` / `{{look}}` and the filled-in
/// `- Workflow (this project): …` / `- Look: …` lines are dropped before comparing.
fn block_shape(block: &str) -> String {
    block.replace("{{look}}", "").lines()
        .filter(|l| { let t = l.trim_start(); t != "- {{workflow}}" && !t.starts_with("- Workflow (this project):") && !t.starts_with("- Look: ") })
        .collect::<Vec<_>>().join("\n")
}
/// The project's CLAUDE.md managed block differs from the engine's template (`templates/projects/_shared/CLAUDE.md`,
/// `{{name}}` = gfx.json name or the folder name, as `gfx init --refresh` fills it). None: no block or no template
/// (nothing to compare; a file without the block is left to `gfx init --refresh`).
pub fn managed_block_outdated(root: &str, engine_dir: &Path) -> Option<bool> {
    let p = Path::new(root);
    let cur = managed_block(&std::fs::read_to_string(p.join("CLAUDE.md")).ok()?)?;
    let name = std::fs::read_to_string(p.join("gfx.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("name").and_then(|n| n.as_str()).map(String::from))
        .or_else(|| p.file_name().map(|n| n.to_string_lossy().into_owned()))?;
    let tpl = std::fs::read_to_string(engine_dir.join("templates").join("projects").join("_shared").join("CLAUDE.md")).ok()?;
    Some(block_shape(&managed_block(&tpl.replace("{{name}}", &name))?) != block_shape(&cur))
}
// Match runner/lib/workflow.js parsing (including trimmed profile / JSON strings and invalid project overrides).
fn parse_workflow(v: &serde_json::Value) -> Option<serde_json::Value> {
    if let Some(s) = v.as_str() {
        let s = s.trim();
        if s.starts_with('{') { return parse_workflow(&serde_json::from_str::<serde_json::Value>(s).ok()?); }
        return prefs::check_pref("workflow", &serde_json::json!(s)).ok();
    }
    let o = v.as_object()?;
    if ["verify", "render", "sound"].iter().any(|k| o.get(*k).map(|v| v.is_null()).unwrap_or(false)) { return None; }
    prefs::check_pref("workflow", v).ok()
}
fn workflow_line(v: &serde_json::Value) -> String {
    let (label, verify, render, sound) = if let Some(s) = v.as_str() {
        let (_, verify, render, sound) = prefs::WORKFLOW_PROFILES.iter().find(|p| p.0 == s).unwrap();
        (if s == "full" { "Full" } else { "Quick" }, *verify, *render, *sound)
    } else { ("Custom", v["verify"].as_str().unwrap(), v["render"].as_bool().unwrap(), v["sound"].as_str().unwrap()) };
    let verify = match verify { "full" => "contact sheet + stills at every beat (2 passes)", "stills" => "contact sheet + key stills", _ => "1 contact sheet" };
    format!("- Workflow (this project): {label} first take: {verify}, {}, {}.", if render { "render when done" } else { "no render" }, if sound == "always" { "sound always" } else { "sound only if asked" })
}
/// The machine workflow the project's block was last written with (`.gfx/workflow.json` `machine`, written by the engine's
/// `--workflow`) differs from this computer's setting, or the managed line differs from the effective project workflow.
pub fn workflow_outdated(root: &str, machine: &serde_json::Value) -> bool {
    let p = Path::new(root);
    let rec = std::fs::read_to_string(p.join(".gfx").join("workflow.json")).ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("machine").cloned())
        .and_then(|v| prefs::check_pref("workflow", &v).ok());
    if rec.as_ref() != Some(machine) { return true; }
    let project = std::fs::read_to_string(p.join("gfx.json")).ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("settings")?.get("workflow").and_then(parse_workflow));
    let effective = project.or_else(|| parse_workflow(machine)).unwrap_or_else(|| serde_json::json!("quick"));
    let expected = workflow_line(&effective);
    let block = std::fs::read_to_string(p.join("CLAUDE.md")).ok().and_then(|t| managed_block(&t));
    !block.map(|b| b.lines().any(|l| l.trim() == expected)).unwrap_or(false)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
/// Fingerprint of a skills dir, the same value as `skillsHash` in runner/lib/skills.js: sha256 over
/// "<rel>\n<sha256 hex>\n" per file, rel = '/'-separated path, files in byte order. None: unreadable / missing dir.
pub fn skills_hash(dir: &Path) -> Option<String> {
    use sha2::{Digest, Sha256};
    fn walk(d: &Path, rel: &str, out: &mut Vec<(String, std::path::PathBuf)>) -> std::io::Result<()> {
        for e in std::fs::read_dir(d)? {
            let e = e?;
            let name = e.file_name().to_string_lossy().into_owned();
            let r = if rel.is_empty() { name } else { format!("{rel}/{name}") };
            let ft = e.file_type()?;
            if ft.is_dir() { walk(&e.path(), &r, out)?; } else if ft.is_file() { out.push((r, e.path())); }
        }
        Ok(())
    }
    if !dir.is_dir() { return None; }
    let mut files = Vec::new();
    walk(dir, "", &mut files).ok()?;
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    let mut h = Sha256::new();
    for (rel, f) in files {
        let data = std::fs::read(&f).ok()?;
        h.update(format!("{rel}\n{}\n", hex(&Sha256::digest(&data))).as_bytes());
    }
    Some(hex(&h.finalize()))
}
/// The engine's skills changed since the project's last sync (`.gfx/skills.json` `engineHash`), or the project has no
/// record yet (made before managed skills). None: the engine has no skills dir (nothing to sync).
pub fn skills_outdated(root: &str, engine_dir: &Path) -> Option<bool> {
    let cur = skills_hash(&engine_dir.join(".claude").join("skills"))?;
    let rec = std::fs::read_to_string(Path::new(root).join(".gfx").join("skills.json")).ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|j| j.get("engineHash").and_then(|h| h.as_str()).map(String::from));
    Some(rec.as_deref() != Some(cur.as_str()))
}

/// `gfx init --refresh` arguments for project_opened: None when nothing is outdated. `workflow` = this computer's default
/// (`--workflow`, docs/LOOKS.md §1), always passed so the engine remembers it.
pub fn refresh_args(block_outdated: bool, skills_outdated: bool, workflow: &str) -> Option<Vec<String>> {
    let mut a: Vec<String> = if skills_outdated { vec!["init".into(), "--refresh".into()] }
        else if block_outdated { vec!["init".into(), "--refresh".into(), "--no-skills".into()] }
        else { return None };
    a.push("--workflow".into());
    a.push(workflow.into());
    Some(a)
}

/// Run a command to completion and return its stdout; Err = its last stderr line (or the exit code).
fn run_stdout(spec: &CmdSpec) -> Result<String, String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).envs(spec.env.iter().cloned()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(c) = &spec.cwd { cmd.current_dir(c); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("could not start {}: {e}", spec.program))?;
    if out.status.success() { return Ok(String::from_utf8_lossy(&out.stdout).into_owned()); }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(err.lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).unwrap_or_else(|| format!("exit code {:?}", out.status.code())))
}

/// Run a command to completion; Err = its last stderr line (or the exit code).
fn run_checked(spec: &CmdSpec) -> Result<(), String> {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).envs(spec.env.iter().cloned()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    if let Some(c) = &spec.cwd { cmd.current_dir(c); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let out = cmd.output().map_err(|e| format!("could not start {}: {e}", spec.program))?;
    if out.status.success() { return Ok(()); }
    let err = String::from_utf8_lossy(&out.stderr);
    Err(err.lines().rev().find(|l| !l.trim().is_empty()).map(|l| l.trim().to_string()).unwrap_or_else(|| format!("exit code {:?}", out.status.code())))
}

/// docs/LOOKS.md §1: the workflow setting changed: rewrite the open project's managed CLAUDE.md block now
/// (`gfx init --refresh --no-skills --workflow <this computer's default>`; the project's own value is read from gfx.json by
/// the engine). -> false when there is nothing to refresh (no gfx.json, or the root is an engine checkout).
#[tauri::command]
async fn refresh_workflow_block(state: State<'_, AppState>) -> Result<bool, String> {
    let root = root_of(&state);
    let p = Path::new(&root);
    if !p.join("gfx.json").is_file() || p.join("runner").join("cli.js").is_file() { return Ok(false); }
    let wf = prefs::workflow_arg(&prefs::machine_workflow(&prefs::load_settings(&prefs::settings_path(&state))));
    let args: Vec<String> = vec!["init".into(), "--refresh".into(), "--no-skills".into(), "--workflow".into(), wf];
    let spec = spec_for(&root, &args, &RunOpts::default())?;
    tauri::async_runtime::spawn_blocking(move || run_checked(&spec)).await.map_err(|e| e.to_string())??;
    Ok(true)
}

/// Run a command to completion without output (no console window).
fn run_quiet(spec: &CmdSpec) {
    use std::process::{Command, Stdio};
    let mut cmd = Command::new(&spec.program);
    cmd.args(&spec.args).envs(spec.env.iter().cloned()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    if let Some(c) = &spec.cwd { cmd.current_dir(c); }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    let _ = cmd.status();
}

/// A project was opened (findings 2 and 21, docs/JOURNEYS.md): record the engine in `.gfx/engine.json`; when the managed
/// CLAUDE.md block is outdated or the engine's skills changed since the last sync, run the engine's own
/// `gfx init --refresh` (`--no-skills` when only the block is outdated). The skill sync is non-destructive (user edits
/// kept, engine version beside them in `.gfx/skills-new/`; unknown legacy copies backed up), so it runs without asking.
/// Engine checkouts (this repo) and projects the engine can't serve are left alone. Runs off the UI thread.
pub(crate) fn project_opened(root: String) {
    std::thread::spawn(move || {
        let p = Path::new(&root);
        if !p.join("gfx.json").is_file() || p.join("runner").join("cli.js").is_file() { return; }
        // the engine this project runs on (docs/INSTALL.md §2): a WSL project's own resolution (override in its distro or
        // the distro's installed engine), else the located engine
        let (dir, rec) = match wsl_root_engine(&root) {
            Some(Ok(w)) => {
                // UNC reads need the versioned folder; the record is for the project's shells: the stable symlink
                let stable = WslEngine { distro: w.distro.clone(), path: engines::linux_path(&w.path) };
                (if cfg!(windows) { wsl_unc(&w.distro, &w.path) } else { PathBuf::from(&w.path) }, engine_record(Path::new(&stable.path), "node", Some(&stable), true, cfg!(windows)))
            }
            Some(Err(_)) => return,
            None => {
                let Ok(e) = locate_engine() else { return };
                let rec = engine_record(&e.dir, &e.node, e.wsl.as_ref(), false, cfg!(windows));
                (e.dir, rec)
            }
        };
        let _ = write_engine_record(&root, rec, prefs::now_ms());
        let machine = SETTINGS_FILE.get().map(|f| prefs::machine_workflow(&prefs::load_settings(f))).unwrap_or_else(|| serde_json::json!("quick"));
        let outdated = managed_block_outdated(&root, &dir);
        let block = outdated == Some(true) || (outdated.is_some() && workflow_outdated(&root, &machine));
        if let Some(args) = refresh_args(block, skills_outdated(&root, &dir) == Some(true), &prefs::workflow_arg(&machine)) {
            if let Ok(spec) = spec_for(&root, &args, &RunOpts::default()) { run_quiet(&spec); }
        }
    });
}

// ---------- project scenes ----------
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectScene {
    name: String,
    title: Option<String>,
    width: u64,
    height: u64,
    fps: f64,
    duration: f64,
    has_video: bool,
    has_cues: bool,
    mtime: u64,
}

pub fn project_scenes_in(root: &str) -> Vec<ProjectScene> {
    let mut v = Vec::new();
    let Ok(rd) = std::fs::read_dir(Path::new(root).join("scenes")) else { return v };
    for e in rd.flatten() {
        let dir = e.path();
        let sj = dir.join("scene.json");
        if !sj.is_file() { continue; }
        let name = e.file_name().to_string_lossy().into_owned();
        let j: serde_json::Value = std::fs::read_to_string(&sj).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::Value::Null);
        let out = Path::new(root).join("out").join(&name);
        v.push(ProjectScene {
            title: j.get("title").and_then(|x| x.as_str()).map(String::from),
            width: j.get("width").and_then(|x| x.as_u64()).unwrap_or(1080),
            height: j.get("height").and_then(|x| x.as_u64()).unwrap_or(1920),
            fps: j.get("fps").and_then(|x| x.as_f64()).unwrap_or(60.0),
            duration: j.get("duration").and_then(|x| x.as_f64()).unwrap_or(0.0),
            has_video: out.join(format!("{name}.mp4")).is_file(),
            has_cues: out.join("audio").join("cues.json").is_file(),
            mtime: mtime_ms(&sj).unwrap_or(0),
            name,
        });
    }
    v.sort_by(|a, b| a.name.cmp(&b.name));
    v
}

#[tauri::command]
fn list_project_scenes(state: State<AppState>) -> Vec<ProjectScene> {
    project_scenes_in(&root_of(&state))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    exists: bool,
    name: String,
    is_project: bool,
    scenes: usize,
}

/// Summary of a folder for the recent-projects list (name from gfx.json, number of scenes).
#[tauri::command]
fn project_info(path: String) -> ProjectInfo {
    let p = Path::new(&path);
    let folder = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    let gj = std::fs::read_to_string(p.join("gfx.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    ProjectInfo {
        exists: p.is_dir(),
        is_project: gj.is_some() || p.join("scenes").is_dir(),
        name: gj.as_ref().and_then(|j| j.get("name")).and_then(|n| n.as_str()).map(String::from).unwrap_or(folder),
        scenes: project_scenes_in(&path).len(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol("gfxlib", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let method = request.method().as_str().to_string();
            let path = request.uri().path().to_string();
            std::thread::spawn(move || {
                let scope = lib_scope(&app.state::<AppState>());
                responder.respond(serve_lib(&scope, &method, &path))
            });
        })
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            let _ = std::fs::create_dir_all(&dir);
            let config_file = dir.join("config.json");
            let root = std::fs::read(&config_file)
                .ok()
                .and_then(|b| serde_json::from_slice::<Config>(&b).ok())
                .map(|c| c.root)
                .unwrap_or_else(default_root);
            let _ = SETTINGS_FILE.set(config_file.with_file_name("settings.json"));
            app.manage(AppState { root: Mutex::new(root), config_file, jobs: Mutex::new(HashMap::new()), ptys: Mutex::new(HashMap::new()), lib: Mutex::new(None), lib_locating: Mutex::new(()) });
            app.manage(t3::T3State::default());
            // docs/HOME-SETTINGS.md §1: the welcome window is the only window at start, unless On start = Reopen last project
            // and that project still exists. The main window is built here or on demand (welcome_open) by popout::build_main:
            // dock pop-outs need its new-window handler (docs/LAYOUT.md §5).
            let st = app.state::<AppState>();
            let reopen = prefs::load_settings(&prefs::settings_path(&st)).pref_str("onStart") == Some("last") && welcome::info_of(&root_of(&st)).is_project;
            if reopen { popout::build_main(app)?; project_opened(root_of(&st)); } else { welcome::build_welcome(app)?; }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_root, set_root, refresh_project_metadata, pick_root, pick_folder, list_scenes, list_project_scenes, project_info, engine_run, engine_cancel, engine_info, engines_info, lib_locate, wsl_distros, wsl_bundle_info, wsl_engine_setup, wsl_engine_checks, wsl_engine_remove, windows_path_state, set_windows_path, read_bytes, read_text, write_text, write_bytes, write_project_text, list_renders, reveal_path, open_path, stat, start_server, list_project_files, write_project_file,
            claude::pty_open, claude::pty_write, claude::pty_resize, claude::pty_close, claude::open_link, claude::open_in_editor,
            refresh_workflow_block, library::library_files, library::library_read, library::library_read_bytes, library::library_write, library::library_delete,
            library::library_copy, library::library_import, library::import_ref, library::pick_refs,
            prefs::get_settings, prefs::set_settings, prefs::patch_settings, prefs::settings_meta, prefs::get_project_settings, prefs::patch_project_settings,
            welcome::recent_list, welcome::classify_folder, welcome::recent_touch, welcome::recent_remove, welcome::recent_pin, welcome::recent_relocate,
            welcome::folder_add, welcome::folder_remove, welcome::recent_import, welcome::list_templates, welcome::project_thumb, welcome::reveal_project,
            welcome::open_app_folder, welcome::main_open, welcome::open_welcome, welcome::close_welcome, welcome::welcome_open, welcome::welcome_settings,
            popout::close_popout,
            t3::t3_status, t3::t3_set_options, t3::t3_connect_start, t3::t3_connect_cancel, t3::t3_disconnect, t3::t3_call, t3::t3_upload, t3::t3_paths,
            t3::t3_view, t3::t3_view_info, t3::t3_view_close, t3::t3_view_session, t3::t3_view_pair
        ])
        .build(tauri::generate_context!())
        .expect("error while building gfx studio")
        .run(|app, ev| {
            if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed, .. } = &ev {
                if label == "main" { popout::close_all(app); }
            }
            // closing the welcome window while no main window is open quits the app
            if let tauri::RunEvent::WindowEvent { label, event: tauri::WindowEvent::Destroyed, .. } = &ev {
                if label == welcome::LABEL && app.get_window("main").is_none() { app.exit(0); }
            }
            if let tauri::RunEvent::Exit = ev {
                let st = app.state::<AppState>();
                let ids: Vec<String> = st.jobs.lock().unwrap().keys().cloned().collect();
                for id in ids { cancel_job(&st, &id); }
                claude::close_all(&st);
            }
        });
}

#[cfg(test)]
mod tests {
    /// The node selection every WSL engine command starts with (bundled node, else PATH).
    fn node_sel(engine: &str) -> String { format!("N='{engine}/node/node'; [ -x \"$N\" ] || N=node; ") }
    use super::*;

    #[test]
    fn rejects_parent_and_absolute() {
        assert!(normalize_rel("../x").is_err());
        assert!(normalize_rel("out/../../x").is_err());
        assert!(normalize_rel("out\\..\\x").is_err());
        assert!(normalize_rel("/etc/passwd").is_err());
        assert!(normalize_rel("C:/Windows/x").is_err());
        assert!(normalize_rel("C:\\x").is_err());
        assert!(normalize_rel("\\\\srv\\share\\x").is_err());
        assert!(normalize_rel("").is_err());
        assert!(join_safe("R", "../x").is_err());
    }

    #[test]
    fn write_scope() {
        assert!(check_writable("out/_reel-test/review/draft.json").is_ok());
        assert!(check_writable("./out/_reel-test/review/sub/a.json").is_ok());
        assert!(check_writable("out/_reel-test/audio/cues.json").is_err());
        assert!(check_writable("scenes/_reel-test/scene.json").is_err());
        assert!(check_writable("out/review/draft.json").is_err());
        assert!(check_writable("out/_reel-test/review").is_err());
        assert!(check_writable("out/_reel-test/review/../audio/cues.json").is_err());
        assert!(check_writable("../out/a/review/x.json").is_err());
    }

    #[test]
    fn project_write_scope() {
        assert!(check_project_writable("scenes/_reel-test/render.json").is_ok());
        assert!(check_project_writable("./scenes/a/render.json").is_ok());
        assert!(check_project_writable("scenes/a/scene.json").is_err());
        assert!(check_project_writable("scenes/a/scene.js").is_err());
        assert!(check_project_writable("scenes/render.json").is_err());
        assert!(check_project_writable("scenes/a/b/render.json").is_err());
        assert!(check_project_writable("scenes/../render.json").is_err());
        assert!(check_project_writable("scenes/a/../../gfx.json").is_err());
        assert!(check_project_writable("/scenes/a/render.json").is_err());
        assert!(check_project_writable("out/a/review/render.json").is_err());
        assert!(check_project_writable("gfx.json").is_err());
    }

    #[test]
    fn source_write_scope() {
        for ok in ["scenes/a/scene.js", "scenes/a/sub/x.css", "./scenes/a/scene.json", "style/presets/x.js", "README.md", "STORYBOARD.md", "gfx.json", "scenes/new.js"] {
            assert!(check_source_writable(ok).is_ok(), "{ok}");
        }
        for bad in ["../x.md", "/etc/x.md", "C:/x.md", "scenes/../gfx.json", "scenes/a/../../runner/cli.js", "out/a/review/draft.json", "out/x.md",
                    ".git/config", "scenes/a/.git/config", "scenes/node_modules/x.js", "scenes/a/out/x.js", "runner/cli.js", "docs/x.md", "package.json",
                    "scenes", "style", ".md", "x.mdx", "gfx.json/x", "\\\\srv\\x.md", "scenes\\..\\gfx.json"] {
            assert!(check_source_writable(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn project_files_listing_and_write() {
        let dir = std::env::temp_dir().join(format!("gfx-pf-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for f in ["scenes/a/scene.js", "out/a/a.mp4", ".git/HEAD", "node_modules/x/i.js", ".gfx/thumbs/x.png", "docs/n.md", "gfx.json", "README.md"] {
            let p = dir.join(f);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, "x").unwrap();
        }
        let root = dir.to_string_lossy().into_owned();
        let pf = project_files_in(&root);
        let paths: Vec<&str> = pf.files.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(paths, ["README.md", "docs/n.md", "gfx.json", "scenes/a/scene.js"]);
        assert!(!pf.truncated);
        let w: Vec<bool> = pf.files.iter().map(|f| f.writable).collect();
        assert_eq!(w, [true, false, true, true]);
        let source = dir.join("scenes/a/scene.js");
        let original_mtime = mtime_ms(&source).unwrap();
        std::fs::write(&source, "Claude's edit").unwrap();
        let conflict = write_source_file(&root, "scenes/a/scene.js", "mine", original_mtime, Some("x")).unwrap_err();
        assert_eq!(conflict.code, "conflict");
        assert_eq!(conflict.text.as_deref(), Some("Claude's edit"));
        assert_eq!(std::fs::read_to_string(&source).unwrap(), "Claude's edit");
        // Even with matching content, a stale timestamp must reject the write.
        let conflict = write_source_file(&root, "scenes/a/scene.js", "mine", 0, Some("Claude's edit")).unwrap_err();
        assert_eq!(conflict.code, "conflict");
        let fresh_mtime = mtime_ms(&source).unwrap();
        assert!(write_source_file(&root, "scenes/a/scene.js", "x", fresh_mtime, Some("Claude's edit")).is_ok());
        assert!(write_source_file(&root, "scenes/a/scene.js", "y", mtime_ms(&dir.join("scenes/a/scene.js")).unwrap(), Some("x")).unwrap() > 0);
        assert_eq!(std::fs::read_to_string(dir.join("scenes/a/scene.js")).unwrap(), "y");
        assert!(write_source_file(&root, "scenes/b/new.js", "z", 0, None).is_ok());
        assert!(write_source_file(&root, "docs/n.md", "z", 0, None).is_err());
        assert!(write_source_file(&root, "out/a/x.js", "z", 0, None).is_err());
        assert!(write_source_file(&root, "scenes/../docs/n.md", "z", 0, None).is_err());
        assert_eq!(std::fs::read_to_string(dir.join("docs/n.md")).unwrap(), "x");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn open_scope() {
        assert!(check_openable("out/_reel-test/x.mp4").is_ok());
        assert!(check_openable("out/_reel-test").is_ok());
        assert!(check_openable("out").is_err());
        assert!(check_openable("scenes/a/scene.js").is_err());
        assert!(check_openable("gfx.json").is_err());
        assert!(check_openable("out/../gfx.json").is_err());
        assert!(check_openable("C:/Windows/notepad.exe").is_err());
        assert!(check_openable("/etc/passwd").is_err());
        assert!(check_openable("out/a/../../x").is_err());
    }

    #[test]
    fn native_paths() {
        let p = native_path(r"\\wsl.localhost\Ubuntu\home\k\proj", "out/a/b.mp4").unwrap();
        if cfg!(windows) {
            assert_eq!(p, r"\\wsl.localhost\Ubuntu\home\k\proj\out\a\b.mp4");
        } else {
            assert!(p.ends_with("b.mp4"));
        }
        assert!(native_path("R", "../x").is_err());
    }

    #[test]
    fn render_listing() {
        let d = std::env::temp_dir().join(format!("gfxr{}", std::process::id()));
        let o = d.join("out").join("s");
        std::fs::create_dir_all(o.join("frames-1")).unwrap();
        std::fs::create_dir_all(o.join("audio")).unwrap();
        std::fs::write(o.join("s.mp4"), b"12345").unwrap();
        std::fs::write(o.join("notes.txt"), b"x").unwrap();
        std::fs::write(o.join("sheet.png"), b"1").unwrap();
        let v = renders_in(d.to_str().unwrap(), "s").unwrap();
        let names: Vec<_> = v.iter().map(|f| f.name.as_str()).collect();
        assert!(names.contains(&"s.mp4") && names.contains(&"frames-1") && names.contains(&"sheet.png"));
        assert!(!names.contains(&"notes.txt") && !names.contains(&"audio"));
        assert_eq!(v.iter().find(|f| f.name == "s.mp4").unwrap().size, 5);
        assert!(renders_in(d.to_str().unwrap(), "../x").is_err());
        assert!(renders_in(d.to_str().unwrap(), "a/b").is_err());
        assert!(renders_in(d.to_str().unwrap(), "missing").unwrap().is_empty());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn percent() {
        assert_eq!(percent_decode("a%20b%2Fc").unwrap(), "a b/c");
        assert_eq!(percent_decode("%C3%A9").unwrap(), "é");
        assert!(percent_decode("%2").is_err());
        assert!(percent_decode("%zz").is_err());
    }

    const SRC: &str = r#"{"sources":[{"id":"synth","kind":"synth"},{"id":"kenney","kind":"folder","path":"library/kenney"},
      {"id":"loc","kind":"folder","path":"assets/sfx"},{"id":"son","kind":"folder","path":"D:/sfx/Sonniss GDC 2024"}]}"#;

    #[test]
    fn gfxlib_guard() {
        let ok = |r: &str| resolve_lib("R", Some(SRC), r).is_ok();
        // library/ (models, index, kenney)
        assert!(ok("library/.models/Xenova/clap-htsat-unfused/onnx/audio_model_quantized.onnx"));
        assert!(ok("library/index/kenney.jsonl"));
        assert!(ok("library/sources.json"));
        assert!(ok("library/kenney/impact/Audio/a.ogg"));
        // repo-relative source outside library/: audio only
        assert!(ok("assets/sfx/a/b.wav"));
        assert!(!ok("assets/sfx/a/b.json"));
        assert!(!ok("assets/other/b.wav"));
        // absolute registered source (Windows and WSL spelling, case-insensitive)
        assert!(ok("D:/sfx/Sonniss GDC 2024/x/y.wav"));
        assert!(ok("d:\\sfx\\sonniss gdc 2024\\y.flac"));
        assert!(ok("/mnt/d/sfx/Sonniss GDC 2024/y.mp3"));
        assert!(!ok("D:/sfx/Sonniss GDC 2024/readme.txt"));
        assert!(!ok("D:/sfx/Sonniss GDC 2024evil/y.wav"));
        assert!(!ok("D:/secret/y.wav"));
        assert!(!ok("/etc/passwd"));
        assert!(!ok("C:/Windows/win.ini"));
        // escapes and other repo areas
        assert!(!ok("library/../scenes/_reel-test/scene.json"));
        assert!(!ok("library/kenney/../../x.wav"));
        assert!(!ok("D:/sfx/Sonniss GDC 2024/../x.wav"));
        assert!(!ok("scenes/_reel-test/scene.json"));
        assert!(!ok("out/_reel-test/_reel-test.mp4"));
        assert!(!ok("library/kenney/a.exe"));
        assert!(!ok("\\\\srv\\share\\a.wav"));
        assert!(resolve_lib("R", None, "assets/sfx/a.wav").is_err());
        assert!(resolve_lib("R", None, "library/index/x.jsonl").is_ok());
    }

    const PROJ: &str = r#"{"name":"p","library":{"sources":[{"id":"mine","path":"assets/sounds","license":"own"},
      {"id":"ext","path":"/srv/sfx"},{"id":"bad","path":"../up"}]}}"#;

    #[test]
    fn gfxlib_engine_library() {
        // the engine's sound library lives outside the project: library/... maps into it, relative sources are
        // relative to its parent, project sources (gfx.json) to the project
        let sc = LibScope { root: "/p/proj".into(), lib: Some(PathBuf::from("/home/u/.local/share/gfx/library")), lib_engine: None, distro: None };
        let src = r#"{"sources":[{"id":"kenney","path":"library/kenney"},{"id":"loc","path":"assets/sfx"},{"id":"abs","path":"/data/sfx"}]}"#;
        let r = |q: &str| resolve_lib_in(&sc, Some(src), Some(PROJ), q);
        let lib = Path::new("/home/u/.local/share/gfx/library");
        assert_eq!(r("library/index/kenney.jsonl").unwrap(), lib.join("index").join("kenney.jsonl"));
        assert_eq!(r("library/sources.json").unwrap(), lib.join("sources.json"));
        assert_eq!(r("library/kenney/impact/a.ogg").unwrap(), lib.join("kenney").join("impact").join("a.ogg"));
        assert_eq!(r("library/.models/x/onnx/m.onnx").unwrap(), lib.join(".models").join("x").join("onnx").join("m.onnx"));
        assert!(r("library").is_err());
        assert!(r("library/kenney/a.exe").is_err());
        // a sources.json relative source: under the library's parent, audio only
        assert_eq!(r("assets/sfx/b.wav").unwrap(), Path::new("/home/u/.local/share/gfx").join("assets").join("sfx").join("b.wav"));
        assert!(r("assets/sfx/b.json").is_err());
        // a project source: under the project; its index in <project>/.gfx/index
        assert_eq!(r("assets/sounds/c.wav").unwrap(), Path::new("/p/proj").join("assets").join("sounds").join("c.wav"));
        assert!(r("assets/sounds/c.txt").is_err());
        assert_eq!(r(".gfx/index/mine.jsonl").unwrap(), Path::new("/p/proj").join(".gfx").join("index").join("mine.jsonl"));
        assert!(r(".gfx/index/mine.meta.json").is_ok());
        assert!(r(".gfx/index/kenney.jsonl").is_err(), "only project sources' indexes");
        assert!(r(".gfx/index/sub/mine.jsonl").is_err());
        assert!(r(".gfx/engine.json").is_err());
        assert!(r(".gfx/index/.jsonl").is_err());
        // absolute: registered sources (sources.json abs, gfx.json abs, gfx.json relative in the engine's spelling)
        assert!(r("/data/sfx/x.wav").is_ok());
        assert!(r("/srv/sfx/y/z.flac").is_ok());
        assert!(r("/p/proj/assets/sounds/d.mp3").is_ok());
        assert!(r("/p/proj/assets/other/d.mp3").is_err());
        assert!(r("/p/up/x.wav").is_err(), "a ../ project source is never served");
        assert!(r("/srv/sfx/readme.txt").is_err());
        assert!(r("/home/u/.local/share/gfx/library/kenney/a.ogg").is_err(), "absolute library paths go through library/");
        // guards
        assert!(r("library/../x.wav").is_err());
        assert!(r("assets/sounds/../../etc/a.wav").is_err());
        assert!(r("/p/proj/assets/sounds/../../x.wav").is_err());
        assert!(r("scenes/a/scene.json").is_err());
        assert!(r("out/a/b.wav").is_err());
        // no sources.json / gfx.json: only library files
        assert!(resolve_lib_in(&sc, None, None, "library/index/x.jsonl").is_ok());
        assert!(resolve_lib_in(&sc, None, None, "assets/sounds/c.wav").is_err());
        assert!(resolve_lib_in(&sc, None, None, ".gfx/index/mine.jsonl").is_err());
        // fallback (engine unknown) = <project>/library as before; project sources are still served
        let fb = LibScope::fallback("/p/proj");
        assert_eq!(resolve_lib_in(&fb, None, None, "library/index/k.jsonl").unwrap(), Path::new("/p/proj").join("library").join("index").join("k.jsonl"));
        assert!(resolve_lib_in(&fb, None, Some(PROJ), "assets/sounds/c.wav").is_ok());
        // a library folder with another name: `library/` and its own name both map into it
        let other = LibScope { root: "/p/proj".into(), lib: Some(PathBuf::from("/x/sounds")), lib_engine: None, distro: None };
        assert_eq!(resolve_lib_in(&other, None, None, "sounds/index/a.jsonl").unwrap(), Path::new("/x/sounds").join("index").join("a.jsonl"));
        assert_eq!(resolve_lib_in(&other, None, None, "library/index/a.jsonl").unwrap(), Path::new("/x/sounds").join("index").join("a.jsonl"));
    }

    #[test]
    fn gfxlib_project_audio_before_library_alias() {
        let sc = LibScope { root: "/p/proj".into(), lib: Some(PathBuf::from("/engine/library")), lib_engine: None, distro: None };
        let project = r#"{"library":{"sources":[{"id":"own","path":"library/own"},{"id":"shared","path":"assets/sfx"},{"id":"bad","path":"library/../outside"}]}}"#;
        let global = r#"{"sources":[{"id":"own","path":"library/own"},{"id":"shared","path":"assets/sfx"}]}"#;
        let r = |q: &str| resolve_lib_in(&sc, Some(global), Some(project), q);
        assert_eq!(r("library/own/hit.wav").unwrap(), Path::new("/p/proj/library/own/hit.wav"));
        assert_eq!(r(r"library\own\hit.wav").unwrap(), Path::new("/p/proj/library/own/hit.wav"));
        assert_eq!(r("assets/sfx/hit.wav").unwrap(), Path::new("/p/proj/assets/sfx/hit.wav"));
        // No matching registered project source: retain the global alias (also for a prefix sibling).
        assert_eq!(resolve_lib_in(&sc, Some(global), None, "library/own/hit.wav").unwrap(), Path::new("/engine/library/own/hit.wav"));
        assert_eq!(r("library/owner/hit.wav").unwrap(), Path::new("/engine/library/owner/hit.wav"));
        // Project registration grants audio only; metadata and model aliases still belong to the library.
        assert_eq!(r("library/own/config.json").unwrap(), Path::new("/engine/library/own/config.json"));
        assert_eq!(r("library/own/model.onnx").unwrap(), Path::new("/engine/library/own/model.onnx"));
        assert_eq!(r("library/outside/hit.wav").unwrap(), Path::new("/engine/library/outside/hit.wav"));
        for q in ["library/own/../hit.wav", r"library\own\..\hit.wav", "library/own/hit.wav\0", "library/own/run.exe", "assets/sfx/config.json", "assets/sfx-other/hit.wav", "outside/hit.wav", "/p/proj/library/owner/hit.wav"] {
            assert!(r(q).is_err(), "must reject {q}");
        }
    }

    #[test]
    fn gfxlib_wsl_paths() {
        // what Windows reads for a WSL engine's paths
        assert_eq!(readable_abs("/home/u/.local/share/gfx/library", Some("Ubuntu"), true), PathBuf::from(r"\\wsl.localhost\Ubuntu\home\u\.local\share\gfx\library"));
        assert_eq!(readable_abs("/mnt/d/sfx/a.wav", Some("Ubuntu"), true), PathBuf::from("D:/sfx/a.wav"));
        assert_eq!(readable_abs("/mnt/c", Some("Ubuntu"), true), PathBuf::from("C:/"));
        assert_eq!(readable_abs("D:/sfx/a.wav", Some("Ubuntu"), true), PathBuf::from("D:/sfx/a.wav"));
        assert_eq!(readable_abs(r"C:\Users\k\AppData\Roaming\gfx\library", None, true), PathBuf::from("C:/Users/k/AppData/Roaming/gfx/library"));
        assert_eq!(readable_abs("/home/u/x.wav", None, true), PathBuf::from("/home/u/x.wav"));
        assert_eq!(readable_abs("D:/sfx/a.wav", None, false), PathBuf::from("/mnt/d/sfx/a.wav"));
        assert_eq!(readable_abs("/home/u/x.wav", Some("Ubuntu"), false), PathBuf::from("/home/u/x.wav"));
        // a WSL project + WSL engine: project sources by their Linux path
        let sc = LibScope {
            root: r"\\wsl.localhost\Ubuntu\home\u\proj".into(),
            lib: Some(PathBuf::from(r"\\wsl.localhost\Ubuntu\home\u\.local\share\gfx\library")),
            lib_engine: Some("/home/u/.local/share/gfx/library".into()),
            distro: Some("Ubuntu".into()),
        };
        assert_eq!(sc.engine_root(), "/home/u/proj");
        assert!(resolve_lib_in(&sc, None, Some(PROJ), "/home/u/proj/assets/sounds/a.wav").is_ok());
        assert!(resolve_lib_in(&sc, None, Some(PROJ), "/home/u/other/a.wav").is_err());
        assert!(resolve_lib_in(&sc, Some(r#"{"sources":[{"id":"w","path":"D:/sfx"}]}"#), None, "/mnt/d/sfx/a.wav").is_ok());
        // `gfx lib list --json` output
        assert_eq!(library_from_list("{\n  \"library\": \"/a/library\",\n  \"sources\": []\n}\n").as_deref(), Some("/a/library"));
        assert_eq!(library_from_list("gfx: warning\n{\"library\":\"C:\\\\x\\\\library\",\"sources\":[]}").as_deref(), Some(r"C:\x\library"));
        assert_eq!(library_from_list("nothing"), None);
        assert_eq!(library_from_list("{\"library\":\"\"}"), None);
    }

    #[test]
    fn gfxlib_serve_codes() {
        let r = LibScope::fallback("R");
        assert_eq!(serve_lib(&r, "GET", "/f/..%2Fetc%2Fpasswd").status(), 403);
        assert_eq!(serve_lib(&r, "GET", "/f/scenes%2Fa%2Fscene.json").status(), 403);
        assert_eq!(serve_lib(&r, "GET", "/other").status(), 404);
        assert_eq!(serve_lib(&r, "GET", "/f/library%2Fnope%2Fa.wav").status(), 404);
        assert_eq!(serve_lib(&r, "OPTIONS", "/f/x").status(), 204);
        // reads from the engine's library (a temp folder outside the "project")
        let t = std::env::temp_dir().join(format!("gfxlib-serve-{}", std::process::id()));
        let lib = t.join("store").join("library");
        std::fs::create_dir_all(lib.join("index")).unwrap();
        std::fs::create_dir_all(t.join("proj").join(".gfx").join("index")).unwrap();
        std::fs::write(lib.join("index").join("k.jsonl"), "{}\n").unwrap();
        std::fs::write(t.join("proj").join("gfx.json"), r#"{"library":{"sources":[{"id":"mine","path":"sfx"}]}}"#).unwrap();
        std::fs::write(t.join("proj").join(".gfx").join("index").join("mine.jsonl"), "{\"p\":1}\n").unwrap();
        let sc = LibScope { root: t.join("proj").to_string_lossy().into_owned(), lib: Some(lib.clone()), lib_engine: None, distro: None };
        let ok = serve_lib(&sc, "GET", "/f/library%2Findex%2Fk.jsonl");
        assert_eq!((ok.status().as_u16(), ok.body().as_slice()), (200, b"{}\n".as_slice()));
        assert_eq!(serve_lib(&LibScope::fallback(&sc.root), "GET", "/f/library%2Findex%2Fk.jsonl").status(), 404);
        let pi = serve_lib(&sc, "GET", "/f/.gfx%2Findex%2Fmine.jsonl");
        assert_eq!((pi.status().as_u16(), pi.body().as_slice()), (200, b"{\"p\":1}\n".as_slice()));
        assert_eq!(serve_lib(&sc, "GET", "/f/.gfx%2Findex%2Fother.jsonl").status(), 403);
        let _ = std::fs::remove_dir_all(&t);
    }

    #[test]
    fn mime() {
        assert_eq!(content_type("onnx"), Some("application/octet-stream"));
        assert_eq!(content_type("JSON"), Some("application/json"));
        assert_eq!(content_type("wav"), Some("audio/wav"));
        assert_eq!(content_type("ogg"), Some("audio/ogg"));
        assert_eq!(content_type("mp3"), Some("audio/mpeg"));
        assert_eq!(content_type("flac"), Some("audio/flac"));
        assert_eq!(content_type("exe"), None);
    }

    #[test]
    fn joins() {
        let p = join_safe("R", "out/a/b.json").unwrap();
        assert!(p.ends_with(Path::new("out").join("a").join("b.json")));
    }

    #[test]
    fn wsl_roots() {
        let d = |r: &str, w| wsl_target(r, w);
        assert_eq!(d(r"\\wsl.localhost\Ubuntu\home\alex\proj", true), Ok((Some("Ubuntu".into()), "/home/alex/proj".into())));
        assert_eq!(d(r"\\wsl$\Debian-12\home\a b\p", true), Ok((Some("Debian-12".into()), "/home/a b/p".into())));
        assert_eq!(d(r"\\WSL.LOCALHOST\Ubuntu\x\", true), Ok((Some("Ubuntu".into()), "/x".into())));
        assert_eq!(d(r"\\?\UNC\wsl.localhost\Ubuntu\home\k", true), Ok((Some("Ubuntu".into()), "/home/k".into())));
        assert_eq!(d("//wsl$/Ubuntu/home/k", true), Ok((Some("Ubuntu".into()), "/home/k".into())));
        assert_eq!(d(r"\\wsl.localhost\Ubuntu", true), Ok((Some("Ubuntu".into()), "/".into())));
        assert_eq!(d("/home/k/p", false), Ok((None, "/home/k/p".into())));
        assert!(d("/home/k/p", true).is_err());
        assert!(d(r"C:\Users\k\p", true).is_err());
        assert!(d(r"\\server\share\p", true).is_err());
        assert!(d(r"\\wsl.localhost", true).is_err());
    }

    #[test]
    fn server_root_normalization() {
        let linux = normalize_server_root("/home/Alex/proj/").unwrap();
        assert_eq!(normalize_server_root(r"\\wsl.localhost\Ubuntu\home\Alex\proj\").unwrap(), linux);
        assert_eq!(normalize_server_root(r"\\wsl$\Debian\home\Alex\proj").unwrap(), linux);
        assert_eq!(normalize_server_root(r"\\?\UNC\wsl.localhost\Ubuntu\home\Alex\proj").unwrap(), linux);
        assert_ne!(normalize_server_root("/home/alex/proj").unwrap(), linux);
        assert_ne!(normalize_server_root("/home/Alex/other").unwrap(), linux);
        assert_eq!(normalize_server_root("/").unwrap(), "/");
        assert_eq!(normalize_server_root(r"C:\Users\K\Proj\").unwrap(), "c:/users/k/proj");
        assert_eq!(normalize_server_root("c:/users/k/proj").unwrap(), "c:/users/k/proj");
        assert_eq!(normalize_server_root(r"\\?\C:\Proj").unwrap(), "c:/proj");
        assert_eq!(normalize_server_root("/mnt/c/Users/K/Proj/").unwrap(), normalize_server_root(r"C:\Users\K\Proj").unwrap(), "WSL engine serving a native project");
        assert_eq!(normalize_server_root("/mnt/data/x").unwrap(), "/mnt/data/x");
        assert!(normalize_server_root(r"\\server\share").is_err());
        assert!(normalize_server_root("relative/dir").is_err());
    }

    fn sv(a: &[&str]) -> Vec<String> { a.iter().map(|s| s.to_string()).collect() }

    #[test]
    fn native_command() {
        let eng = Path::new("E:/app/engine");
        let o = RunOpts { progress: true, ..Default::default() };
        let c = build_command(r"C:\proj", &sv(&["render", "intro", "--dur", "1"]), &o, eng, "E:/app/engine/node/node.exe").unwrap();
        assert_eq!(c.program, "E:/app/engine/node/node.exe");
        assert_eq!(c.args[1..], sv(&["render", "intro", "--dur", "1", "--progress", "json"])[..]);
        assert!(c.args[0].ends_with("cli.js") && c.args[0].contains("runner"));
        assert_eq!(c.env, vec![("GFX_PROJECT".to_string(), r"C:\proj".to_string())]);
        assert_eq!(c.cwd, Some(PathBuf::from(r"C:\proj")));
    }

    #[test]
    fn no_project_targets() {
        assert_eq!(no_project_target(&sv(&["init", r"\\wsl.localhost\Ubuntu\home\k\p", "--template", "promo"])), Some(r"\\wsl.localhost\Ubuntu\home\k\p"));
        assert_eq!(no_project_target(&sv(&["init", "--refresh"])), None);
        assert_eq!(no_project_target(&sv(&["template", "list", "--for", r"\\wsl.localhost\Ubuntu\home\k", "--json"])), Some(r"\\wsl.localhost\Ubuntu\home\k"));
        assert_eq!(no_project_target(&sv(&["template", "preview", "user/x", "--for", r"C:\p"])), Some(r"C:\p"));
        assert_eq!(no_project_target(&sv(&["template", "list", "--json"])), None);
        assert_eq!(no_project_target(&sv(&["template", "list", "--for"])), None);
        assert_eq!(no_project_target(&sv(&["doctor", "--for", "x"])), None);
    }

    #[test]
    fn no_project_command() {
        let eng = Path::new("/e");
        let o = RunOpts { no_project: true, ..Default::default() };
        let c = build_command(r"\\wsl.localhost\Ubuntu\home\k\p", &sv(&["doctor", "--json"]), &o, eng, "node").unwrap();
        assert_eq!(c.program, "node");
        assert!(c.env.is_empty());
        assert_eq!(c.cwd, Some(PathBuf::from("/e")));
    }

    #[test]
    fn wsl_command_quotes() {
        // a WSL project that is itself an engine checkout (this repo): its own cli.js, quoted args
        let o = RunOpts { progress: true, ..Default::default() };
        let e = wsl_project_engine("Ubuntu", "/home/k/my proj", true, Err(String::new()), None).unwrap();
        let c = build_wsl_engine_command(&e, r"\\wsl.localhost\Ubuntu\home\k\my proj", &sv(&["init", "/tmp/it's here", "--name", "A B"]), &o).unwrap();
        assert_eq!(c.program, "wsl.exe");
        assert_eq!(c.args[..7], sv(&["-d", "Ubuntu", "--cd", "/home/k/my proj", "--exec", "bash", "-lc"])[..]);
        assert_eq!(c.args[7], format!("{}GFX_PROJECT='/home/k/my proj' \"$N\" '/home/k/my proj/runner/cli.js' 'init' '/tmp/it'\\''s here' '--name' 'A B' '--progress' 'json'", node_sel("/home/k/my proj")));
        assert!(c.env.is_empty() && c.cwd.is_none());
    }

    #[test]
    fn wsl_project_commands() {
        let eng = PathBuf::from(r"\\wsl.localhost\Ubuntu\home\k\gfx");
        let wsl = |d: &str| Some(WslEngine { distro: d.into(), path: "/home/k/gfx".into() });
        // project outside the engine: the located engine's cli.js by its Linux path, cwd + GFX_PROJECT = the project
        let e = wsl_project_engine("Ubuntu", "/home/k/gfx-projects/p1", false, Ok((eng.clone(), wsl("ubuntu"))), Some("/home/k/.local/share/gfx/engine")).unwrap();
        assert_eq!(e, WslEngine { distro: "Ubuntu".into(), path: "/home/k/gfx".into() });
        let mut o = RunOpts::default();
        o.env.insert("GFX_MODE".into(), "fast".into());
        let c = build_wsl_engine_command(&e, r"\\wsl.localhost\Ubuntu\home\k\gfx-projects\p1", &sv(&["serve", "--port", "5199"]), &o).unwrap();
        assert_eq!(c.args[..7], sv(&["-d", "Ubuntu", "--cd", "/home/k/gfx-projects/p1", "--exec", "bash", "-lc"])[..]);
        assert_eq!(c.args[7], format!("{}GFX_MODE='fast' GFX_PROJECT='/home/k/gfx-projects/p1' \"$N\" '/home/k/gfx/runner/cli.js' 'serve' '--port' '5199'", node_sel("/home/k/gfx")));
        // project == engine (this repo): itself, even when another engine is configured
        let own = wsl_project_engine("Ubuntu", "/home/k/repo/", true, Ok((eng.clone(), wsl("Debian"))), None).unwrap();
        assert_eq!(own, WslEngine { distro: "Ubuntu".into(), path: "/home/k/repo".into() });
        // another distro, a Windows engine, no engine: readable errors that name the fix
        let err = wsl_project_engine("Ubuntu", "/p", false, Ok((eng.clone(), wsl("Debian"))), None).unwrap_err();
        assert!(err.contains("WSL Debian") && err.contains("WSL Ubuntu") && err.contains("Engine folder"), "{err}");
        let err = wsl_project_engine("Ubuntu", "/p", false, Ok((PathBuf::from(r"C:\gfx\engine"), None)), None).unwrap_err();
        assert!(err.contains("Windows folder") && err.contains(r"C:\gfx\engine"), "{err}");
        let err = wsl_project_engine("Ubuntu", "/p", false, Err("engine not found at X (GFX_ENGINE)".into()), None).unwrap_err();
        assert!(err.starts_with("engine not found at X") && err.contains("inside WSL Ubuntu") && err.contains("install the WSL engine"), "{err}");
        // docs/INSTALL.md §2: the distro's installed engine serves its projects when no override applies
        let inst = Some("/home/k/.local/share/gfx/engine/");
        let want = WslEngine { distro: "Ubuntu".into(), path: "/home/k/.local/share/gfx/engine".into() };
        assert_eq!(wsl_project_engine("Ubuntu", "/p", false, Ok((PathBuf::from(r"C:\gfx\engine"), None)), inst).unwrap(), want, "Windows engine located");
        assert_eq!(wsl_project_engine("Ubuntu", "/p", false, Err("engine not found".into()), inst).unwrap(), want, "no engine located");
        assert_eq!(wsl_project_engine("Ubuntu", "/p", false, Ok((eng.clone(), wsl("Debian"))), inst).unwrap(), want, "override in another distro");
    }

    #[test]
    fn installed_wsl_engine_rows() {
        let d = std::env::temp_dir().join(format!("gfx-wslrows-{}", std::process::id()));
        std::fs::create_dir_all(d.join("ok").join("runner")).unwrap();
        std::fs::write(d.join("ok").join("runner").join("cli.js"), "").unwrap();
        std::fs::write(d.join("ok").join("package.json"), r#"{"version":"0.2.0"}"#).unwrap();
        let f = engines::parse(r#"{"wsl":{"Ubuntu":{"path":"/ok","version":"0.1.9"},"Debian":{"path":"/gone","version":"0.2.0"}}}"#);
        let rows = wsl_engine_rows(&f, |_, p| d.join(p.trim_start_matches('/')));
        let deb = rows.iter().find(|r| r.distro.as_deref() == Some("Debian")).unwrap();
        assert!(!deb.found && deb.version.as_deref() == Some("0.2.0") && deb.error.as_deref().unwrap().contains("WSL Debian"));
        let ubu = rows.iter().find(|r| r.distro.as_deref() == Some("Ubuntu")).unwrap();
        assert!(ubu.update, "recorded version mismatch offers Update");
        assert!(!deb.update, "matching version hides Update");
        assert!(ubu.found && ubu.wsl && ubu.source == "installed" && ubu.error.is_none());
        assert_eq!(ubu.version.as_deref(), Some("0.2.0"), "package.json wins over the recorded version");
        std::fs::remove_dir_all(&d).unwrap();
        assert_eq!(wsl_unc("Ubuntu", "/home/k/.local/share/gfx/engine"), PathBuf::from(r"\\wsl.localhost\Ubuntu\home\k\.local\share\gfx\engine"));
    }

    #[test]
    fn installed_engine_commands_use_the_stable_path() {
        // engines.json records engine-<ver> (Windows reads); Linux-side commands use the `engine` symlink, which an
        // update keeps valid while it replaces the versioned folder
        let e = WslEngine { distro: "Ubuntu".into(), path: "/home/k/.local/share/gfx/engine-0.2.0".into() };
        let c = build_wsl_engine_command(&e, r"\\wsl.localhost\Ubuntu\home\k\p", &sv(&["list"]), &RunOpts::default()).unwrap();
        assert!(c.args[7].contains("'/home/k/.local/share/gfx/engine/runner/cli.js'") && c.args[7].starts_with(&node_sel("/home/k/.local/share/gfx/engine")), "{}", c.args[7]);
        assert!(!c.args[7].contains("engine-0.2.0"), "{}", c.args[7]);
    }

    #[test]
    fn env_whitelist() {
        let mut o = RunOpts::default();
        o.env.insert("PATH".into(), "x".into());
        assert!(build_command("/p", &[], &o, Path::new("/e"), "node").is_err());
        let mut o = RunOpts::default();
        o.env.insert("GFX_PROJECT".into(), "x".into());
        assert!(build_command("/p", &[], &o, Path::new("/e"), "node").is_err());
        let mut o = RunOpts::default();
        o.env.insert("GFX_FFMPEG".into(), "/x/ff".into());
        let c = build_command("/p", &sv(&["x"]), &o, Path::new("/e"), "node").unwrap();
        assert_eq!(c.env, vec![("GFX_FFMPEG".to_string(), "/x/ff".to_string()), ("GFX_PROJECT".to_string(), "/p".to_string())]);
        let w = WslEngine { distro: "U".into(), path: "/e".into() };
        let c = build_wsl_engine_command(&w, r"\\wsl$\U\p", &sv(&["x"]), &o).unwrap();
        assert_eq!(c.args[7], format!("{}GFX_FFMPEG='/x/ff' GFX_PROJECT='/p' \"$N\" '/e/runner/cli.js' 'x'", node_sel("/e")));
    }

    #[test]
    fn engine_location() {
        let exe = Some(Path::new("C:/app/gfx-studio.exe"));
        assert_eq!(engine_dir(Some("D:/dev/eng"), Some(r"E:\set"), exe), Some((PathBuf::from("D:/dev/eng"), "env")), "GFX_ENGINE wins");
        assert_eq!(engine_dir(None, Some(r"E:\set"), exe), Some((PathBuf::from(r"E:\set"), "setting")), "then the setting");
        assert_eq!(engine_dir(Some(" "), Some(""), exe), Some((PathBuf::from("C:/app/engine"), "app")), "then engine/ next to the exe");
        assert_eq!(engine_dir(Some(""), None, Some(Path::new("/app/gfx-studio.exe"))), Some((PathBuf::from("/app/engine"), "app")));
        assert_eq!(engine_dir(None, None, None), None);
        assert_eq!(engine_dir(None, Some("/x"), None), Some((PathBuf::from("/x"), "setting")));
        let e = Path::new("/app/engine");
        assert_eq!(node_program(e, None, false), "node");
        assert_eq!(node_program(e, Some("/x/node"), true), "/x/node");
        assert!(node_program(e, None, true).ends_with("node.exe"));
    }

    #[test]
    fn wsl_engine_commands() {
        let e = wsl_engine_of(r"\\wsl.localhost\Ubuntu\home\alex\gfx-engine").unwrap();
        assert_eq!(e, WslEngine { distro: "Ubuntu".into(), path: "/home/alex/gfx-engine".into() });
        assert_eq!(wsl_engine_of(r"\\wsl$\Debian\opt\gfx\").unwrap().path, "/opt/gfx");
        assert!(wsl_engine_of(r"C:\gfx\engine").is_none() && wsl_engine_of("/opt/gfx").is_none());
        // no project (doctor / init / setup): cwd = the engine, relative cli.js, a Windows target dir mapped to /mnt/c
        let o = RunOpts { no_project: true, progress: true, ..Default::default() };
        let c = build_wsl_engine_command(&e, "", &sv(&["init", r"C:\Users\k\gfx projects\My Reel", "--template", "reel", "--name", "My Reel"]), &o).unwrap();
        assert_eq!(c.program, "wsl.exe");
        assert_eq!(c.args[..7], sv(&["-d", "Ubuntu", "--cd", "/home/alex/gfx-engine", "--exec", "bash", "-lc"])[..]);
        assert_eq!(c.args[7], format!("{}\"$N\" runner/cli.js 'init' '/mnt/c/Users/k/gfx projects/My Reel' '--template' 'reel' '--name' 'My Reel' '--progress' 'json'", node_sel("/home/alex/gfx-engine")));
        assert!(c.env.is_empty() && c.cwd.is_none());
        let d = build_wsl_engine_command(&e, "", &sv(&["init", r"\\wsl.localhost\Ubuntu\home\k\p", "--existing"]), &RunOpts { no_project: true, ..Default::default() }).unwrap();
        assert_eq!(d.args[7], format!("{}\"$N\" runner/cli.js 'init' '/home/k/p' '--existing'", node_sel("/home/alex/gfx-engine")));
        // a native project with the WSL engine: cwd = /mnt/<drive>/..., GFX_PROJECT, the engine's cli.js by its Linux path
        let mut o = RunOpts::default();
        o.env.insert("GFX_MODE".into(), "fast".into());
        let r = build_wsl_engine_command(&e, r"C:\Users\k\gfx projects\reel", &sv(&["render", "intro"]), &o).unwrap();
        assert_eq!(r.args[3], "/mnt/c/Users/k/gfx projects/reel");
        assert_eq!(r.args[7], format!("{}GFX_MODE='fast' GFX_PROJECT='/mnt/c/Users/k/gfx projects/reel' \"$N\" '/home/alex/gfx-engine/runner/cli.js' 'render' 'intro'", node_sel("/home/alex/gfx-engine")));
        let mut bad = RunOpts::default();
        bad.env.insert("PATH".into(), "x".into());
        assert!(build_wsl_engine_command(&e, r"C:\p", &[], &bad).is_err());
        assert!(build_wsl_engine_command(&e, "relative", &[], &RunOpts::default()).is_err());
        // the folder check
        let tmp = std::env::temp_dir().join(format!("gfx-engine-check-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(tmp.join("runner")).unwrap();
        let t = tmp.to_string_lossy().into_owned();
        assert!(check_engine_folder(&t).unwrap_err().contains("runner"));
        std::fs::write(tmp.join("runner").join("cli.js"), "").unwrap();
        assert!(check_engine_folder(&t).is_ok());
        assert!(check_engine_folder(&format!("{t}-missing")).unwrap_err().starts_with("Engine folder not found"));
        assert!(check_engine_folder("  ").is_err());
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn event_lines() {
        let p = line_event(r#"{"type":"progress","phase":"frames","done":3,"total":9}"#, false);
        assert_eq!(p["done"], 3);
        assert_eq!(line_event("plain text", false)["type"], "log");
        assert_eq!(line_event("  markup: /p/c3.png  ", false)["msg"], "  markup: /p/c3.png");
        assert_eq!(line_event(r#"{"a":1}"#, false)["type"], "log");
        let e = line_event("boom", true);
        assert_eq!((e["level"].as_str(), e["stream"].as_str()), (Some("warn"), Some("stderr")));
        assert_eq!(line_event(r#"{"type":"done"}"#, true)["type"], "log");
        assert!(valid_job_id("job-1_a") && !valid_job_id("a/b") && !valid_job_id(""));
    }

    #[test]
    fn project_scene_listing() {
        let d = std::env::temp_dir().join(format!("gfx-ps-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("scenes/a")).unwrap();
        std::fs::create_dir_all(d.join("scenes/b")).unwrap();
        std::fs::create_dir_all(d.join("scenes/nojson")).unwrap();
        std::fs::write(d.join("scenes/a/scene.json"), r#"{"width":1920,"height":1080,"fps":30,"duration":4.5,"title":"A"}"#).unwrap();
        std::fs::write(d.join("scenes/b/scene.json"), "{}").unwrap();
        std::fs::create_dir_all(d.join("out/a/audio")).unwrap();
        std::fs::write(d.join("out/a/a.mp4"), "x").unwrap();
        std::fs::write(d.join("out/a/audio/cues.json"), "{}").unwrap();
        let v = project_scenes_in(d.to_str().unwrap());
        assert_eq!(v.len(), 2);
        assert_eq!((v[0].name.as_str(), v[0].width, v[0].fps, v[0].has_video, v[0].has_cues), ("a", 1920, 30.0, true, true));
        assert_eq!((v[1].name.as_str(), v[1].height, v[1].has_video, v[1].has_cues), ("b", 1920, false, false));
        let i = project_info(d.to_str().unwrap().into());
        assert!(i.exists && i.is_project && i.scenes == 2);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn engine_records() {
        let w = WslEngine { distro: "Ubuntu".into(), path: "/home/k/gfx".into() };
        let unc = Path::new(r"\\wsl.localhost\Ubuntu\home\k\gfx");
        // WSL project + WSL engine: Linux paths only
        let r = engine_record(unc, "node", Some(&w), true, true);
        assert_eq!(r, serde_json::json!({ "engine": "/home/k/gfx", "bin": "/home/k/gfx/bin/gfx", "node": "node" }));
        // Windows project + WSL engine: Linux paths + the distro for wsl.exe
        let r = engine_record(unc, "node", Some(&w), false, true);
        assert_eq!((r["bin"].as_str(), r["wsl"].as_str()), (Some("/home/k/gfx/bin/gfx"), Some("Ubuntu")));
        // native engine: its own paths, gfx.cmd on Windows, the node it runs
        let r = engine_record(Path::new("/opt/gfx"), "/opt/gfx/node/node", None, false, false);
        assert_eq!(r, serde_json::json!({ "engine": "/opt/gfx", "bin": Path::new("/opt/gfx").join("bin").join("gfx").to_string_lossy(), "node": "/opt/gfx/node/node" }));
        assert!(engine_record(Path::new("/e"), "node", None, false, true)["bin"].as_str().unwrap().ends_with("gfx.cmd"));
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_utc(1_791_200_000_123), "2026-10-05T11:33:20.123Z");
        assert_eq!(iso_utc(951_782_400_000), "2000-02-29T00:00:00.000Z");

        let d = std::env::temp_dir().join(format!("gfx-er-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let root = d.to_string_lossy().into_owned();
        std::fs::write(d.join(".gitignore"), "out/\nmine").unwrap();
        let rec = serde_json::json!({ "engine": "/home/k/gfx", "bin": "/home/k/gfx/bin/gfx", "node": "node" });
        assert!(write_engine_record(&root, rec.clone(), 0).unwrap());
        let j: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.join(".gfx/engine.json")).unwrap()).unwrap();
        assert_eq!((j["bin"].as_str(), j["updated"].as_str()), (Some("/home/k/gfx/bin/gfx"), Some("1970-01-01T00:00:00.000Z")));
        assert_eq!(std::fs::read_to_string(d.join(".gitignore")).unwrap(), "out/\nmine\n.gfx/\n", "the line is appended, user lines kept");
        // the same engine again (e.g. gfx init wrote the absolute node): kept; .gitignore not touched twice
        std::fs::write(d.join(".gfx/engine.json"), r#"{"engine":"/home/k/gfx","node":"/usr/bin/node"}"#).unwrap();
        assert!(!write_engine_record(&root, rec.clone(), 5).unwrap());
        assert!(std::fs::read_to_string(d.join(".gfx/engine.json")).unwrap().contains("/usr/bin/node"));
        assert_eq!(std::fs::read_to_string(d.join(".gitignore")).unwrap().matches(".gfx/").count(), 1);
        assert!(write_engine_record(&root, serde_json::json!({ "engine": "/other" }), 5).unwrap(), "another engine: rewritten");

        // managed block: same as the template = current; changed inside = outdated; no block = None
        let eng = d.join("eng");
        std::fs::create_dir_all(eng.join("templates/projects/_shared")).unwrap();
        std::fs::write(eng.join("templates/projects/_shared/CLAUDE.md"), "# {{name}}\n\n<!-- gfx:begin -->\nrun gfx ({{name}})\n<!-- gfx:end -->\n\n## notes\n").unwrap();
        std::fs::write(d.join("gfx.json"), r#"{"name":"My P"}"#).unwrap();
        std::fs::write(d.join("CLAUDE.md"), "# x\r\n<!-- gfx:begin -->\r\nrun gfx (My P)\r\n<!-- gfx:end -->\r\nmine\r\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), Some(false));
        std::fs::write(d.join("CLAUDE.md"), "<!-- gfx:begin -->\nold claim\n<!-- gfx:end -->\nmine\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), Some(true));
        std::fs::write(d.join("CLAUDE.md"), "hand-written\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), None);
        assert_eq!(managed_block_outdated(&root, &d.join("nope")), None);

        // skills: hash = runner/lib/skills.js skillsHash; no record / other hash = outdated; no engine skills = None
        assert_eq!(skills_outdated(&root, &eng), None);
        std::fs::create_dir_all(eng.join(".claude/skills/a/references")).unwrap();
        std::fs::write(eng.join(".claude/skills/a/SKILL.md"), "hi\n").unwrap();
        std::fs::write(eng.join(".claude/skills/a/references/x.md"), "").unwrap();
        let h = skills_hash(&eng.join(".claude/skills")).unwrap();
        // the same tree hashed by node (skillsHash) gives this value
        assert_eq!(h, "be166608cfaaa0a0d839581ac6b989e5b9e63dc45199fec0574c15afacdf39e0");
        assert_eq!(skills_outdated(&root, &eng), Some(true), "no skills.json yet (legacy project)");
        std::fs::write(d.join(".gfx/skills.json"), format!(r#"{{"engineHash":"{h}"}}"#)).unwrap();
        assert_eq!(skills_outdated(&root, &eng), Some(false));
        std::fs::write(eng.join(".claude/skills/a/SKILL.md"), "hi again\n").unwrap();
        assert_eq!(skills_outdated(&root, &eng), Some(true), "engine skill changed");
        assert_eq!(refresh_args(false, false, "quick"), None);
        assert_eq!(refresh_args(true, false, "quick").unwrap(), ["init", "--refresh", "--no-skills", "--workflow", "quick"]);
        assert_eq!(refresh_args(false, true, "full").unwrap(), ["init", "--refresh", "--workflow", "full"]);
        assert_eq!(refresh_args(true, true, "quick").unwrap(), ["init", "--refresh", "--workflow", "quick"]);

        // docs/LOOKS.md: the workflow / look lines of a block are project-specific, not a template change
        std::fs::write(eng.join("templates/projects/_shared/CLAUDE.md"), "<!-- gfx:begin -->\n- skills\n- {{workflow}}\n{{look}}- contract\n<!-- gfx:end -->\n").unwrap();
        std::fs::write(d.join("CLAUDE.md"), "<!-- gfx:begin -->\n- skills\n- Workflow (this project): Full first take: x.\n- Look: Clean dark (looks/clean-dark/LOOK.md): read it.\n- contract\n<!-- gfx:end -->\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), Some(false));
        std::fs::write(d.join("CLAUDE.md"), "<!-- gfx:begin -->\n- skills\n- contract\n<!-- gfx:end -->\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), Some(false), "no look, an old block without the workflow line: the record decides");
        std::fs::write(d.join("CLAUDE.md"), "<!-- gfx:begin -->\n- skills v1\n- contract\n<!-- gfx:end -->\n").unwrap();
        assert_eq!(managed_block_outdated(&root, &eng), Some(true));
        // .gfx/workflow.json (written by the engine's --workflow) against this computer's setting
        assert!(workflow_outdated(&root, &serde_json::json!("quick")), "no record yet");
        std::fs::write(d.join(".gfx/workflow.json"), r#"{ "machine": "quick" }"#).unwrap();
        std::fs::write(d.join("CLAUDE.md"), format!("<!-- gfx:begin -->\n{}\n<!-- gfx:end -->\n", workflow_line(&serde_json::json!("quick")))).unwrap();
        assert!(!workflow_outdated(&root, &serde_json::json!("quick")));
        assert!(workflow_outdated(&root, &serde_json::json!("full")));
        std::fs::write(d.join(".gfx/workflow.json"), r#"{ "machine": { "verify": "stills", "render": true, "sound": "asked" } }"#).unwrap();
        let custom = serde_json::json!({ "verify": "stills", "render": true, "sound": "asked" });
        std::fs::write(d.join("CLAUDE.md"), format!("<!-- gfx:begin -->\n{}\n<!-- gfx:end -->\n", workflow_line(&custom))).unwrap();
        assert!(!workflow_outdated(&root, &custom));
        std::fs::write(d.join("gfx.json"), r#"{"settings":{"workflow":"full"}}"#).unwrap();
        assert!(workflow_outdated(&root, &custom), "project override changed outside Settings");
        std::fs::write(d.join("CLAUDE.md"), format!("<!-- gfx:begin -->\n{}\n<!-- gfx:end -->\n", workflow_line(&serde_json::json!("full")))).unwrap();
        assert!(!workflow_outdated(&root, &custom));
        std::fs::write(d.join("gfx.json"), r#"{"settings":{"workflow":"invalid"}}"#).unwrap();
        assert!(workflow_outdated(&root, &custom), "invalid override falls back to machine");
        assert_eq!(parse_workflow(&serde_json::json!(" {\"render\":true} ")), Some(serde_json::json!({"verify":"sheet","render":true,"sound":"asked"})));
        assert_eq!(parse_workflow(&serde_json::json!({"render":null})), None);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn quoting() {
        assert_eq!(sh_quote("a'b"), "'a'\\''b'");
    }
}
