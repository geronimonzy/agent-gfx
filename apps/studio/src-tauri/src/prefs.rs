//! Settings (docs/HOME-SETTINGS.md §2): machine settings in `<app config dir>/settings.json` (the `Settings` struct in
//! claude.rs), per-project overrides in the project's `gfx.json` → `"settings"` (text edit: other keys and formatting are
//! kept), and the welcome window's `recent.json` (recent projects + folders). Pure helpers are unit-tested; the JS twin
//! is `web/src/settings-core.js` (same rules, same tests).
use crate::claude::Settings;
use crate::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};

pub const UI_ZOOMS: [f64; 9] = [0.7, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
pub const MAX_RECENT: usize = 12;

#[derive(Clone, Copy)]
enum Kind {
    Bool,
    Enum(&'static [&'static str]),
    Int(i64, i64),
    Zoom,
    Str(usize, bool), // max length, must be an absolute path when not empty
    Preset,
    OutDir,
    Workflow,
}

/// (key, kind, can be overridden per project)
const SCHEMA: &[(&str, Kind, bool)] = &[
    ("onStart", Kind::Enum(&["welcome", "last"]), false),
    ("projectsDir", Kind::Str(1000, true), false),
    ("editor", Kind::Enum(&["vscode", "system", "custom"]), false),
    ("editorCommand", Kind::Str(1000, false), false),
    ("uiZoom", Kind::Zoom, false),
    ("showHeaders", Kind::Bool, false),
    ("renderMode", Kind::Enum(&["fast", "exact"]), true),
    ("renderWorkers", Kind::Int(0, 16), true),
    ("renderPreset", Kind::Preset, true),
    ("renderQuality", Kind::Enum(&["draft", "normal", "high"]), true),
    ("renderFrameFormat", Kind::Enum(&["png", "jpeg"]), true),
    ("renderAudio", Kind::Bool, true),
    ("renderOutDir", Kind::OutDir, true),
    ("codeAutosave", Kind::Bool, true),
    ("versionsAuto", Kind::Bool, true),
    ("shell", Kind::Str(1000, false), false),
    ("claudeCommand", Kind::Str(1000, false), false),
    ("claudeTarget", Kind::Enum(&["terminal", "t3"]), false),
    ("askSend", Kind::Bool, false),
    ("engineDir", Kind::Str(1000, true), false),
    // docs/LOOKS.md §1: first-take workflow, "quick" | "full" | { verify, render, sound } (custom)
    ("workflow", Kind::Workflow, true),
    // docs/LOOKS.md §3: the machine Library folder ('' = <Documents>/gfx library, settings_meta)
    ("libraryDir", Kind::Str(1000, true), false),
];

/// Workflow profiles (twin of runner/lib/workflow.js PROFILES): (name, verify, render, sound).
pub const WORKFLOW_PROFILES: [(&str, &str, bool, &str); 2] = [("quick", "sheet", false, "asked"), ("full", "full", true, "always")];
const WORKFLOW_VERIFY: [&str; 3] = ["sheet", "stills", "full"];
const WORKFLOW_SOUND: [&str; 2] = ["asked", "always"];

/// The engine's `--workflow` argument for a valid workflow value: the profile name, or the custom object as JSON.
pub fn workflow_arg(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        o => format!(r#"{{"verify":{},"render":{},"sound":{}}}"#, o["verify"], o["render"], o["sound"]),
    }
}
/// The machine default workflow (settings.json, else quick).
pub fn machine_workflow(s: &Settings) -> Value {
    s.prefs.get("workflow").cloned().unwrap_or_else(|| Value::String("quick".into()))
}

fn kind_of(key: &str) -> Option<(Kind, bool)> {
    SCHEMA.iter().find(|(k, _, _)| *k == key).map(|(_, kind, p)| (*kind, *p))
}
pub fn is_project_key(key: &str) -> bool {
    kind_of(key).map(|(_, p)| p).unwrap_or(false)
}
pub fn is_abs(p: &str) -> bool {
    let b = p.as_bytes();
    p.starts_with('/') || p.starts_with("\\\\") || (b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/'))
}

/// Validate one value; returns the normalized value.
pub fn check_pref(key: &str, v: &Value) -> Result<Value, String> {
    let (kind, _) = kind_of(key).ok_or_else(|| format!("unknown setting: {key}"))?;
    let bad = |why: &str| format!("{key}: {why}");
    match kind {
        Kind::Bool => v.as_bool().map(Value::Bool).ok_or_else(|| bad("expected true or false")),
        Kind::Enum(vals) => match v.as_str() {
            Some(s) if vals.contains(&s) => Ok(Value::String(s.into())),
            _ => Err(bad(&format!("expected one of {}", vals.join(", ")))),
        },
        Kind::Int(lo, hi) => match v.as_i64() {
            Some(n) if v.is_i64() || v.is_u64() => {
                if n >= lo && n <= hi { Ok(Value::from(n)) } else { Err(bad(&format!("expected a whole number {lo}-{hi}"))) }
            }
            _ => Err(bad(&format!("expected a whole number {lo}-{hi}"))),
        },
        Kind::Zoom => {
            let f = v.as_f64().ok_or_else(|| bad("not a UI scale step"))?;
            UI_ZOOMS.iter().find(|z| (*z - f).abs() < 1e-3).map(|z| Value::from(*z)).ok_or_else(|| bad("not a UI scale step"))
        }
        Kind::Str(max, abs) => {
            let s = v.as_str().ok_or_else(|| bad("expected text"))?.trim();
            if s.contains(['\0', '\r', '\n']) || s.chars().count() > max {
                return Err(bad(&format!("invalid text (no line breaks, at most {max} characters)")));
            }
            if abs && !s.is_empty() && !is_abs(s) {
                return Err(bad("needs a full path (C:\\… or /…)"));
            }
            Ok(Value::String(s.into()))
        }
        Kind::Preset => match v.as_str() {
            Some("scene") => Ok(Value::String("scene".into())),
            Some(s) if !s.is_empty() && s.len() <= 40 && s.as_bytes()[0].is_ascii_alphanumeric()
                && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || c == b'-') => Ok(Value::String(s.into())),
            _ => Err(bad("not a size preset id")),
        },
        Kind::Workflow => match v {
            Value::String(s) if WORKFLOW_PROFILES.iter().any(|p| p.0 == s) => Ok(v.clone()),
            Value::Object(o) => {
                let (_, dv, dr, ds) = WORKFLOW_PROFILES[0];
                let verify = match o.get("verify") {
                    None | Some(Value::Null) => dv,
                    Some(Value::String(x)) if WORKFLOW_VERIFY.contains(&x.as_str()) => x.as_str(),
                    _ => return Err(bad("verify: expected one of sheet, stills, full")),
                };
                let render = match o.get("render") {
                    None | Some(Value::Null) => dr,
                    Some(Value::Bool(b)) => *b,
                    _ => return Err(bad("render: expected true or false")),
                };
                let sound = match o.get("sound") {
                    None | Some(Value::Null) => ds,
                    Some(Value::String(x)) if WORKFLOW_SOUND.contains(&x.as_str()) => x.as_str(),
                    _ => return Err(bad("sound: expected one of asked, always")),
                };
                Ok(serde_json::json!({ "verify": verify, "render": render, "sound": sound }))
            }
            _ => Err(bad("expected quick, full or a custom { verify, render, sound }")),
        },
        Kind::OutDir => {
            let s = v.as_str().ok_or_else(|| bad("expected a folder"))?.trim().replace('\\', "/");
            let s = s.trim_end_matches('/').to_string();
            let parts: Vec<&str> = s.split('/').collect();
            let ok = s.len() <= 200 && parts[0] == "out"
                && parts.iter().all(|p| !p.is_empty() && *p != "." && *p != ".." && !p.contains([':', '*', '?', '"', '<', '>', '|', '\0']));
            if ok { Ok(Value::String(s)) } else { Err(bad("must be out/ or a folder inside out/ (e.g. out/renders)")) }
        }
    }
}

// ---------- machine settings ----------
/// Keep valid known keys only (old / broken values are dropped, never fatal).
pub fn sanitize_machine(raw: &Map<String, Value>) -> Settings {
    let mut s = Settings::default();
    for (k, v) in raw {
        if let Ok(v) = check_pref(k, v) {
            set_field(&mut s, k, Some(v));
        }
    }
    s
}
fn set_field(s: &mut Settings, k: &str, v: Option<Value>) {
    match k {
        "shell" => s.shell = v.and_then(|x| x.as_str().map(String::from)).unwrap_or_default(),
        "claudeCommand" => s.claude_command = v.and_then(|x| x.as_str().map(String::from)).unwrap_or_default(),
        _ => match v {
            Some(v) => { s.prefs.insert(k.to_string(), v); }
            None => { s.prefs.remove(k); }
        },
    }
}
/// Apply `{ key: value | null }` (null = back to the default). `strict`: unknown keys are an error (else ignored).
pub fn patch_machine(cur: &Settings, patch: &Map<String, Value>, strict: bool) -> Result<Settings, String> {
    let mut s = cur.clone();
    for (k, v) in patch {
        if kind_of(k).is_none() {
            if strict { return Err(format!("unknown setting: {k}")); }
            continue;
        }
        if v.is_null() { set_field(&mut s, k, None); } else { set_field(&mut s, k, Some(check_pref(k, v)?)); }
    }
    Ok(s)
}

pub fn settings_path(state: &AppState) -> PathBuf {
    state.config_file.with_file_name("settings.json")
}
pub fn load_settings(path: &Path) -> Settings {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice::<Map<String, Value>>(&b).ok()).map(|m| sanitize_machine(&m)).unwrap_or_default()
}
static SETTINGS_LOCK: Mutex<()> = Mutex::new(());
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp-gfx");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| { let _ = std::fs::remove_file(&tmp); e.to_string() })
}
fn save_patch(state: &AppState, patch: &Map<String, Value>, strict: bool) -> Result<Settings, String> {
    let _g = SETTINGS_LOCK.lock().unwrap();
    let path = settings_path(state);
    // Engine folder: must be an engine (runner/cli.js), else a clear error and nothing is written
    if let Some(Value::String(d)) = patch.get("engineDir") {
        if !d.trim().is_empty() { crate::check_engine_folder(d)?; }
    }
    let next = patch_machine(&load_settings(&path), patch, strict)?;
    write_atomic(&path, &serde_json::to_vec_pretty(&next).unwrap())?;
    Ok(next)
}

/// Machine settings (only the keys that are set, plus shell / claudeCommand).
#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Settings {
    load_settings(&settings_path(&state))
}
/// Lenient merge (old callers): known keys are validated and merged, unknown keys (old webhook fields) ignored.
#[tauri::command]
pub fn set_settings(settings: Map<String, Value>, state: State<AppState>) -> Result<Settings, String> {
    save_patch(&state, &settings, false)
}
/// Strict patch: `{ key: value | null }`; unknown keys and invalid values are errors (nothing is written then).
#[tauri::command]
pub fn patch_settings(patch: Map<String, Value>, state: State<AppState>) -> Result<Settings, String> {
    save_patch(&state, &patch, true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsMeta {
    defaults: Map<String, Value>,
    config_dir: String,
    version: String,
    platform: &'static str,
}
pub fn default_projects_dir(docs: Option<PathBuf>, home: Option<PathBuf>) -> String {
    docs.or_else(|| home.map(|h| h.join("Documents"))).map(|d| d.join("gfx projects").to_string_lossy().into_owned()).unwrap_or_default()
}
/// docs/LOOKS.md §3: `<Documents>/gfx library`.
pub fn default_library_dir(docs: Option<PathBuf>, home: Option<PathBuf>) -> String {
    docs.or_else(|| home.map(|h| h.join("Documents"))).map(|d| d.join("gfx library").to_string_lossy().into_owned()).unwrap_or_default()
}
#[tauri::command]
pub fn settings_meta(app: tauri::AppHandle, state: State<AppState>) -> SettingsMeta {
    let mut defaults = Map::new();
    // a WSL-only install (the default engine is a WSL engine): new projects go to that distro's home
    let wsl_home = crate::locate_engine().ok().filter(|e| e.source == "installed").and_then(|e| e.wsl)
        .and_then(|w| crate::engines::engine_home(&w.path).map(|h| crate::wsl_unc(&w.distro, &format!("{h}/gfx-projects"))));
    let projects = wsl_home.map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|| default_projects_dir(app.path().document_dir().ok(), app.path().home_dir().ok()));
    defaults.insert("projectsDir".into(), Value::String(projects));
    defaults.insert("libraryDir".into(), Value::String(default_library_dir(app.path().document_dir().ok(), app.path().home_dir().ok())));
    SettingsMeta {
        defaults,
        config_dir: state.config_file.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        version: app.package_info().version.to_string(),
        platform: if cfg!(windows) { "windows" } else { "other" },
    }
}

// ---------- project overrides (gfx.json "settings") ----------
pub fn sanitize_project(raw: Option<&Value>) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(Value::Object(m)) = raw {
        for (k, v) in m {
            if is_project_key(k) {
                if let Ok(v) = check_pref(k, v) { out.insert(k.clone(), v); }
            }
        }
    }
    out
}
pub fn patch_project(cur: &Map<String, Value>, patch: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut next = cur.clone();
    for (k, v) in patch {
        if !is_project_key(k) {
            return Err(format!("{}: {k}", if kind_of(k).is_some() { "not a per-project setting" } else { "unknown setting" }));
        }
        if v.is_null() { next.remove(k); } else { next.insert(k.clone(), check_pref(k, v)?); }
    }
    Ok(next)
}

/// A top-level entry of a JSON object text (byte offsets).
#[derive(Debug)]
struct Entry { key: String, key_start: usize, value_start: usize, value_end: usize }

fn scan_object(t: &str) -> Result<(usize, usize, Vec<Entry>), String> {
    let b = t.as_bytes();
    let mut i = 0usize;
    let fail = |i: usize, why: &str| format!("gfx.json: {why} at {i}");
    let ws = |i: &mut usize| { while *i < b.len() && (b[*i] as char).is_ascii_whitespace() { *i += 1; } };
    let str_end = |i: &mut usize| -> Result<(), String> {
        *i += 1;
        while *i < b.len() {
            match b[*i] { b'\\' => *i += 2, b'"' => { *i += 1; return Ok(()); } _ => *i += 1 }
        }
        Err(fail(*i, "unterminated string"))
    };
    let value = |i: &mut usize| -> Result<(), String> {
        ws(i);
        match b.get(*i) {
            Some(b'"') => str_end(i),
            Some(b'{') | Some(b'[') => {
                let mut stack = vec![if b[*i] == b'{' { b'}' } else { b']' }];
                *i += 1;
                while *i < b.len() && !stack.is_empty() {
                    match b[*i] {
                        b'"' => { str_end(i)?; continue; }
                        b'{' => stack.push(b'}'),
                        b'[' => stack.push(b']'),
                        c @ (b'}' | b']') => { if stack.pop() != Some(c) { return Err(fail(*i, "mismatched bracket")); } }
                        _ => {}
                    }
                    *i += 1;
                }
                if stack.is_empty() { Ok(()) } else { Err(fail(*i, "unterminated value")) }
            }
            Some(_) => {
                let s = *i;
                while *i < b.len() && (b[*i].is_ascii_alphanumeric() || matches!(b[*i], b'-' | b'+' | b'.')) { *i += 1; }
                let lit = &t[s..*i];
                let ok = matches!(lit, "true" | "false" | "null") || (!lit.is_empty() && lit.parse::<f64>().is_ok());
                if ok { Ok(()) } else { Err(fail(s, "bad value")) }
            }
            None => Err(fail(*i, "missing value")),
        }
    };
    ws(&mut i);
    if b.get(i) != Some(&b'{') { return Err(fail(i, "not an object")); }
    let open = i;
    i += 1;
    let mut entries = Vec::new();
    ws(&mut i);
    if b.get(i) == Some(&b'}') { return Ok((open, i, entries)); }
    loop {
        ws(&mut i);
        if b.get(i) != Some(&b'"') { return Err(fail(i, "expected a key")); }
        let key_start = i;
        str_end(&mut i)?;
        let key: String = serde_json::from_str(&t[key_start..i]).map_err(|e| e.to_string())?;
        ws(&mut i);
        if b.get(i) != Some(&b':') { return Err(fail(i, "expected :")); }
        i += 1;
        ws(&mut i);
        let value_start = i;
        value(&mut i)?;
        entries.push(Entry { key, key_start, value_start, value_end: i });
        ws(&mut i);
        match b.get(i) {
            Some(b',') => { i += 1; }
            Some(b'}') => return Ok((open, i, entries)),
            _ => return Err(fail(i, "expected , or }")),
        }
    }
}

fn pretty_2(v: &Value) -> String {
    let mut buf = Vec::new();
    let fmt = serde_json::ser::PrettyFormatter::with_indent(b"  ");
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, fmt);
    v.serialize(&mut ser).unwrap();
    String::from_utf8(buf).unwrap()
}

/// Set (non-empty object) or remove (None / empty) the top-level `"settings"` key of a gfx.json text. Every other key
/// and its formatting stays as it is; refuses an edit that would change another key.
pub fn set_settings_text(text: &str, value: Option<&Map<String, Value>>) -> Result<String, String> {
    let (open, close, entries) = scan_object(text)?;
    let v = value.filter(|m| !m.is_empty());
    let indent = entries.first().map(|e| {
        let ls = text[..e.key_start].rfind('\n').map(|x| x + 1).unwrap_or(0);
        let pre = &text[ls..e.key_start];
        if pre.chars().all(|c| c == ' ' || c == '\t') { pre.to_string() } else { "  ".to_string() }
    }).unwrap_or_else(|| "  ".to_string());
    let ser = v.map(|m| pretty_2(&Value::Object(m.clone())).replace('\n', &format!("\n{indent}"))).unwrap_or_default();
    let at = entries.iter().position(|e| e.key == "settings");
    let out = match (at, v) {
        (Some(a), Some(_)) => format!("{}{}{}", &text[..entries[a].value_start], ser, &text[entries[a].value_end..]),
        (Some(a), None) => {
            let e = &entries[a];
            if a > 0 { format!("{}{}", &text[..entries[a - 1].value_end], &text[e.value_end..]) }
            else if entries.len() > 1 { format!("{}{}", &text[..e.key_start], &text[entries[1].key_start..]) }
            else { format!("{}{}", &text[..open + 1], &text[close..]) }
        }
        (None, None) => text.to_string(),
        (None, Some(_)) => match entries.last() {
            Some(last) => format!("{},\n{indent}\"settings\": {ser}{}", &text[..last.value_end], &text[last.value_end..]),
            None => format!("{}{{\n{indent}\"settings\": {ser}\n}}{}", &text[..open], &text[close + 1..]),
        },
    };
    let mut a: Value = serde_json::from_str(text).map_err(|e| format!("gfx.json: {e}"))?;
    let mut b: Value = serde_json::from_str(&out).map_err(|e| format!("gfx.json edit: {e}"))?;
    a.as_object_mut().map(|o| o.remove("settings"));
    let bs = b.as_object_mut().and_then(|o| o.remove("settings"));
    if a != b || bs.as_ref() != v.map(|m| Value::Object(m.clone())).as_ref() {
        return Err("gfx.json: refusing an edit that would change other keys".into());
    }
    Ok(out)
}

fn gfx_json(root: &str) -> PathBuf { Path::new(root).join("gfx.json") }

pub fn read_project_settings(root: &str) -> (bool, Map<String, Value>) {
    match std::fs::read_to_string(gfx_json(root)) {
        Ok(t) => {
            let v: Option<Value> = serde_json::from_str(&t).ok();
            (true, sanitize_project(v.as_ref().and_then(|v| v.get("settings"))))
        }
        Err(_) => (false, Map::new()),
    }
}
pub fn write_project_patch(root: &str, patch: &Map<String, Value>) -> Result<Map<String, Value>, String> {
    let p = gfx_json(root);
    let text = std::fs::read_to_string(&p).map_err(|_| "this project has no gfx.json; project settings are stored there (run `gfx init` for this folder)".to_string())?;
    let cur: Value = serde_json::from_str(&text).map_err(|e| format!("gfx.json is not valid JSON ({e}); fix it first"))?;
    let next = patch_project(&sanitize_project(cur.get("settings")), patch)?;
    let out = set_settings_text(&text, Some(&next))?;
    if out != text { write_atomic(&p, out.as_bytes())?; }
    Ok(next)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSettings { gfx_json: bool, settings: Map<String, Value> }

#[tauri::command]
pub fn get_project_settings(state: State<AppState>) -> ProjectSettings {
    let (gfx_json, settings) = read_project_settings(&state.root.lock().unwrap());
    ProjectSettings { gfx_json, settings }
}
#[tauri::command]
pub fn patch_project_settings(patch: Map<String, Value>, state: State<AppState>) -> Result<ProjectSettings, String> {
    let root = state.root.lock().unwrap().clone();
    let _g = SETTINGS_LOCK.lock().unwrap();
    Ok(ProjectSettings { gfx_json: true, settings: write_project_patch(&root, &patch)? })
}

// ---------- recent.json ----------
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RecentEntry {
    pub path: String,
    pub name: String,
    pub opened: u64,
    pub pinned: bool,
}
#[derive(Serialize, Deserialize, Default, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct RecentFile {
    pub recent: Vec<RecentEntry>,
    pub folders: Vec<String>,
}

/// Comparison key for paths: forward slashes, lower case, no trailing slash.
pub fn path_key(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_lowercase()
}
/// Pinned first, then newest first; at most MAX_RECENT (the oldest unpinned go first; `keep` is never dropped).
pub fn sort_cap(mut v: Vec<RecentEntry>, keep: Option<&str>) -> Vec<RecentEntry> {
    v.sort_by(|a, b| b.pinned.cmp(&a.pinned).then(b.opened.cmp(&a.opened)));
    let kk = keep.map(path_key);
    while v.len() > MAX_RECENT {
        let not_kept = |e: &RecentEntry| Some(path_key(&e.path)) != kk;
        let i = v.iter().rposition(|e| !e.pinned && not_kept(e)).or_else(|| v.iter().rposition(not_kept)).unwrap_or(v.len() - 1);
        v.remove(i);
    }
    v
}
pub fn sanitize_recent(mut r: RecentFile) -> RecentFile {
    let mut seen = std::collections::HashSet::new();
    r.recent.retain(|e| !e.path.is_empty() && seen.insert(path_key(&e.path)));
    let mut fs = std::collections::HashSet::new();
    r.folders.retain(|f| !f.is_empty() && fs.insert(path_key(f)));
    r.recent = sort_cap(r.recent, None);
    r
}
pub fn touch_recent(r: &mut RecentFile, path: &str, name: &str, now: u64) {
    let k = path_key(path);
    let old = r.recent.iter().find(|e| path_key(&e.path) == k).cloned();
    let mut v: Vec<RecentEntry> = r.recent.drain(..).filter(|e| path_key(&e.path) != k).collect();
    v.insert(0, RecentEntry {
        path: path.into(),
        name: if name.is_empty() { old.as_ref().map(|o| o.name.clone()).unwrap_or_default() } else { name.into() },
        opened: now,
        pinned: old.map(|o| o.pinned).unwrap_or(false),
    });
    r.recent = sort_cap(v, Some(path));
}
pub fn pin_recent(r: &mut RecentFile, path: &str, pinned: bool) {
    let k = path_key(path);
    for e in r.recent.iter_mut() { if path_key(&e.path) == k { e.pinned = pinned; } }
    r.recent = sort_cap(std::mem::take(&mut r.recent), None);
}
pub fn remove_recent(r: &mut RecentFile, path: &str) {
    let k = path_key(path);
    r.recent.retain(|e| path_key(&e.path) != k);
}
pub fn relocate_recent(r: &mut RecentFile, from: &str, to: &str, name: &str, now: u64) {
    let (k, kt) = (path_key(from), path_key(to));
    let old = r.recent.iter().find(|e| path_key(&e.path) == k).cloned();
    let mut v: Vec<RecentEntry> = r.recent.drain(..).filter(|e| path_key(&e.path) != k && path_key(&e.path) != kt).collect();
    v.insert(0, RecentEntry {
        path: to.into(),
        name: if name.is_empty() { old.as_ref().map(|o| o.name.clone()).unwrap_or_default() } else { name.into() },
        opened: now,
        pinned: old.map(|o| o.pinned).unwrap_or(false),
    });
    r.recent = sort_cap(v, Some(to));
}
pub fn add_folder(r: &mut RecentFile, path: &str) {
    if !r.folders.iter().any(|f| path_key(f) == path_key(path)) { r.folders.push(path.into()); }
}
pub fn remove_folder(r: &mut RecentFile, path: &str) {
    let k = path_key(path);
    r.folders.retain(|f| path_key(f) != k);
}
pub fn relocate_folder(r: &mut RecentFile, from: &str, to: &str) {
    let k = path_key(from);
    for f in r.folders.iter_mut() { if path_key(f) == k { *f = to.into(); } }
    let mut seen = std::collections::HashSet::new();
    r.folders.retain(|f| seen.insert(path_key(f)));
}

pub fn recent_path(state: &AppState) -> PathBuf { state.config_file.with_file_name("recent.json") }
static RECENT_LOCK: Mutex<()> = Mutex::new(());
pub fn load_recent(path: &Path) -> RecentFile {
    sanitize_recent(std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default())
}
/// Read-modify-write recent.json under a lock.
pub fn edit_recent<T>(state: &AppState, f: impl FnOnce(&mut RecentFile) -> T) -> Result<T, String> {
    let _g = RECENT_LOCK.lock().unwrap();
    let path = recent_path(state);
    let mut r = load_recent(&path);
    let out = f(&mut r);
    write_atomic(&path, &serde_json::to_vec_pretty(&r).unwrap())?;
    Ok(out)
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn obj(v: Value) -> Map<String, Value> { v.as_object().unwrap().clone() }

    #[test]
    fn validation() {
        assert_eq!(check_pref("renderMode", &json!("exact")).unwrap(), json!("exact"));
        assert!(check_pref("renderMode", &json!("slow")).is_err());
        assert_eq!(check_pref("renderWorkers", &json!(4)).unwrap(), json!(4));
        for bad in [json!(-1), json!(17), json!(2.5), json!("2")] { assert!(check_pref("renderWorkers", &bad).is_err(), "{bad}"); }
        assert_eq!(check_pref("uiZoom", &json!(1.2500001)).unwrap(), json!(1.25));
        assert!(check_pref("uiZoom", &json!(1.3)).is_err());
        assert_eq!(check_pref("renderOutDir", &json!("out\\renders\\")).unwrap(), json!("out/renders"));
        for bad in ["renders", "/out", "out/../x", "out//x", "C:/out", "out/a:b"] { assert!(check_pref("renderOutDir", &json!(bad)).is_err(), "{bad}"); }
        assert_eq!(check_pref("claudeCommand", &json!("  claude --continue ")).unwrap(), json!("claude --continue"));
        assert!(check_pref("claudeCommand", &json!("claude\nrm -rf /")).is_err());
        assert!(check_pref("projectsDir", &json!(r"C:\Users\k\gfx")).is_ok());
        assert!(check_pref("projectsDir", &json!("")).is_ok());
        assert!(check_pref("projectsDir", &json!("relative/dir")).is_err());
        assert!(check_pref("engineDir", &json!(r"\\wsl.localhost\Ubuntu\home\k\gfx")).is_ok());
        assert!(check_pref("engineDir", &json!(r"C:\gfx\engine")).is_ok());
        assert!(check_pref("engineDir", &json!("engine")).is_err());
        assert!(!is_project_key("engineDir"), "Engine folder is machine-only");
        assert!(check_pref("nope", &json!(1)).is_err());
        assert!(check_pref("renderPreset", &json!("1080p")).is_ok());
        assert!(check_pref("renderPreset", &json!("../x")).is_err());
    }

    #[test]
    fn claude_target_preference() {
        assert!(check_pref("claudeTarget", &json!("terminal")).is_ok());
        assert!(check_pref("claudeTarget", &json!("t3")).is_ok());
        assert!(check_pref("claudeTarget", &json!("other")).is_err());
        assert!(!is_project_key("claudeTarget"));
        let saved = patch_machine(&Settings::default(), &obj(json!({ "claudeTarget": "t3" })), true).unwrap();
        let roundtrip = sanitize_machine(&obj(serde_json::to_value(&saved).unwrap()));
        assert_eq!(roundtrip.prefs.get("claudeTarget"), Some(&json!("t3")));
    }

    #[test]
    fn machine_merge() {
        let s = sanitize_machine(&obj(json!({ "shell": "pwsh", "t3WebhookUrl": "https://old", "renderWorkers": "x", "askSend": true })));
        assert_eq!(serde_json::to_value(&s).unwrap(), json!({ "shell": "pwsh", "claudeCommand": "", "askSend": true }));
        let s = patch_machine(&s, &obj(json!({ "renderMode": "exact", "uiZoom": 1.5 })), true).unwrap();
        assert_eq!(s.prefs.get("renderMode"), Some(&json!("exact")));
        let s = patch_machine(&s, &obj(json!({ "renderMode": null, "shell": null })), true).unwrap();
        assert!(!s.prefs.contains_key("renderMode") && s.shell.is_empty());
        assert!(patch_machine(&s, &obj(json!({ "webhook": "x" })), true).is_err());
        assert!(patch_machine(&s, &obj(json!({ "webhook": "x" })), false).is_ok(), "lenient set_settings ignores unknown keys");
        assert!(patch_machine(&s, &obj(json!({ "renderWorkers": 99 })), false).is_err());
        // round trip through the file format
        let d = std::env::temp_dir().join(format!("gfx-set-{}.json", std::process::id()));
        std::fs::write(&d, serde_json::to_vec(&s).unwrap()).unwrap();
        assert_eq!(load_settings(&d), s);
        std::fs::write(&d, b"{not json").unwrap();
        assert_eq!(load_settings(&d), Settings::default());
        let _ = std::fs::remove_file(&d);
    }

    #[test]
    fn project_overrides() {
        let keys: Vec<&str> = SCHEMA.iter().filter(|x| x.2).map(|x| x.0).collect();
        assert_eq!(keys, ["renderMode", "renderWorkers", "renderPreset", "renderQuality", "renderFrameFormat", "renderAudio", "renderOutDir", "codeAutosave", "versionsAuto", "workflow"]);
        assert!(patch_project(&Map::new(), &obj(json!({ "shell": "x" }))).unwrap_err().contains("not a per-project"));
        let p = patch_project(&Map::new(), &obj(json!({ "renderMode": "exact", "codeAutosave": true }))).unwrap();
        let mut dirty = p.clone();
        dirty.insert("shell".into(), json!("bad"));
        dirty.insert("renderWorkers".into(), json!("nope"));
        assert_eq!(sanitize_project(Some(&Value::Object(dirty))), p);
        let p2 = patch_project(&p, &obj(json!({ "renderMode": null }))).unwrap();
        assert_eq!(Value::Object(p2), json!({ "codeAutosave": true }));
        // write into a real gfx.json, keeping the rest
        let d = std::env::temp_dir().join(format!("gfx-proj-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let root = d.to_string_lossy().into_owned();
        assert!(write_project_patch(&root, &obj(json!({ "renderMode": "exact" }))).unwrap_err().contains("no gfx.json"));
        let src = "{\n  \"version\": 1,\n  \"name\": \"P\"\n}\n";
        std::fs::write(d.join("gfx.json"), src).unwrap();
        write_project_patch(&root, &obj(json!({ "renderMode": "exact", "renderWorkers": 2 }))).unwrap();
        let (has, cur) = read_project_settings(&root);
        assert!(has && cur.get("renderWorkers") == Some(&json!(2)));
        assert!(write_project_patch(&root, &obj(json!({ "renderWorkers": 77 }))).is_err());
        write_project_patch(&root, &obj(json!({ "renderMode": null, "renderWorkers": null }))).unwrap();
        assert_eq!(std::fs::read_to_string(d.join("gfx.json")).unwrap(), src);
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn gfx_json_text_edit() {
        let src = "{\n    \"version\": 1,\n    \"name\": \"My \\\"proj\\\"\",\n    \"engine\": \">=0.2\",\n    \"library\": { \"sources\": [ { \"id\": \"x\", \"path\": \"a/b\" } ] }\n}\n";
        let a = set_settings_text(src, Some(&obj(json!({ "renderMode": "exact" })))).unwrap();
        assert_eq!(a, src.replace("] }\n}", "] },\n    \"settings\": {\n      \"renderMode\": \"exact\"\n    }\n}"));
        let b = set_settings_text(&a, Some(&obj(json!({ "renderMode": "fast", "renderWorkers": 2 })))).unwrap();
        assert!(b.starts_with("{\n    \"version\": 1,\n    \"name\": \"My \\\"proj\\\"\","));
        assert_eq!(set_settings_text(&b, None).unwrap(), src);
        assert_eq!(set_settings_text(r#"{"settings": {"renderMode": "exact"}, "name": "x"}"#, Some(&Map::new())).unwrap(), r#"{"name": "x"}"#);
        assert_eq!(set_settings_text(r#"{ "settings": {} }"#, None).unwrap(), "{}");
        assert_eq!(set_settings_text("{}", Some(&obj(json!({ "codeAutosave": true })))).unwrap(), "{\n  \"settings\": {\n    \"codeAutosave\": true\n  }\n}");
        assert!(set_settings_text("[1]", None).is_err());
        assert!(set_settings_text(r#"{"a": }"#, None).is_err());
        assert!(set_settings_text(r#"{"a": 1e5, "b": [true, null, -2.5, "x\"]"]}"#, Some(&obj(json!({ "x": 1 })))).is_ok());
    }

    fn e(p: &str) -> String { p.to_string() }

    #[test]
    fn recent_list() {
        let raw: RecentFile = serde_json::from_value(json!({ "recent": [{ "path": "C:\\a", "name": "A", "opened": 1 }, { "path": "c:/A/", "name": "dup", "opened": 9 }, { "nope": 1 }], "folders": ["D:\\p", "d:/p/"] })).unwrap();
        let mut r = sanitize_recent(raw);
        assert_eq!((r.recent.len(), r.folders.len()), (1, 1));
        for i in 0..14u64 { touch_recent(&mut r, &format!("C:\\p{i}"), &format!("P{i}"), 100 + i); }
        assert_eq!(r.recent.len(), MAX_RECENT);
        assert_eq!(r.recent[0].path, "C:\\p13");
        assert!(!r.recent.iter().any(|x| x.path == "C:\\a" || x.path == "C:\\p0"));
        pin_recent(&mut r, "C:\\p2", true);
        assert_eq!(r.recent[0].path, "C:\\p2");
        for i in 20..40u64 { touch_recent(&mut r, &format!("C:\\q{i}"), "", 200 + i); }
        assert_eq!(r.recent.len(), MAX_RECENT);
        assert_eq!(r.recent[0].path, "C:\\p2", "pinned entries survive the cap");
        assert_eq!(r.recent[1].path, "C:\\q39");
        touch_recent(&mut r, "c:/P2", "renamed", 999);
        assert!(r.recent[0].pinned && r.recent[0].name == "renamed" && r.recent.len() == MAX_RECENT);
        let mut full = RecentFile::default();
        for i in 0..12u64 { touch_recent(&mut full, &format!("/x{i}"), "", i); pin_recent(&mut full, &format!("/x{i}"), true); }
        touch_recent(&mut full, "/new", "", 50);
        assert!(full.recent.iter().any(|x| x.path == "/new") && !full.recent.iter().any(|x| x.path == "/x0") && full.recent.len() == 12);
        remove_recent(&mut r, "C:/p2");
        assert!(!r.recent.iter().any(|x| x.path == "C:\\p2"));
        relocate_recent(&mut r, "C:\\q39", "E:\\moved", "", 1000);
        assert!(r.recent[0].path == "E:\\moved" && !r.recent.iter().any(|x| x.path == "C:\\q39"));
        add_folder(&mut r, "/f");
        add_folder(&mut r, "/F/");
        assert_eq!(r.folders.iter().filter(|f| f.to_lowercase().starts_with("/f")).count(), 1);
        relocate_folder(&mut r, "/f", "/g");
        assert!(r.folders.contains(&e("/g")));
        remove_folder(&mut r, "/G");
        assert!(!r.folders.contains(&e("/g")));
        // file round trip + a missing / broken file is an empty list
        let p = std::env::temp_dir().join(format!("gfx-recent-{}.json", std::process::id()));
        std::fs::write(&p, serde_json::to_vec(&r).unwrap()).unwrap();
        assert_eq!(load_recent(&p), r);
        std::fs::write(&p, b"[").unwrap();
        assert_eq!(load_recent(&p), RecentFile::default());
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn workflow_and_library_dir() {
        assert_eq!(check_pref("workflow", &json!("quick")).unwrap(), json!("quick"));
        assert_eq!(check_pref("workflow", &json!("full")).unwrap(), json!("full"));
        for bad in [json!("custom"), json!("fast"), json!(3), json!(null), json!([]), json!({ "verify": "all" }), json!({ "render": "yes" }), json!({ "sound": "never" })] {
            assert!(check_pref("workflow", &bad).is_err(), "{bad}");
        }
        assert_eq!(check_pref("workflow", &json!({ "verify": "stills", "render": true, "sound": "always", "profile": "custom", "extra": 1 })).unwrap(),
            json!({ "verify": "stills", "render": true, "sound": "always" }));
        assert_eq!(check_pref("workflow", &json!({ "render": true })).unwrap(), json!({ "verify": "sheet", "render": true, "sound": "asked" }));
        assert!(is_project_key("workflow"));
        assert_eq!(workflow_arg(&json!("quick")), "quick");
        assert_eq!(workflow_arg(&json!({ "verify": "stills", "render": false, "sound": "asked" })), r#"{"verify":"stills","render":false,"sound":"asked"}"#);
        assert_eq!(machine_workflow(&Settings::default()), json!("quick"));
        assert_eq!(sanitize_project(Some(&json!({ "workflow": "nope", "renderMode": "exact" }))), obj(json!({ "renderMode": "exact" })));
        assert!(check_pref("libraryDir", &json!(r"\\wsl.localhost\Ubuntu\home\k\lib")).is_ok());
        assert!(check_pref("libraryDir", &json!(r"C:\Users\k\Documents\gfx library")).is_ok());
        assert!(check_pref("libraryDir", &json!("")).is_ok());
        assert!(check_pref("libraryDir", &json!("gfx library")).is_err());
        assert!(!is_project_key("libraryDir"));
        assert!(default_library_dir(Some(PathBuf::from("/d")), None).ends_with("gfx library"));
    }

    #[test]
    fn projects_dir_default() {
        assert!(default_projects_dir(Some(PathBuf::from("/d")), None).ends_with("gfx projects"));
        assert!(default_projects_dir(None, Some(PathBuf::from("/h"))).contains("Documents"));
        assert_eq!(default_projects_dir(None, None), "");
    }
}
