//! Welcome window (docs/HOME-SETTINGS.md §1): the window itself (label `welcome`, `welcome.html`), opening a project in
//! the one main window (built on demand), the recent list / folders (`recent.json`, prefs.rs), folder classification,
//! templates, thumbnails, Reveal in Explorer, and the folder drop (WebView2 `postMessageWithAdditionalObjects`).
use crate::prefs::{self, path_key, RecentFile};
use crate::{popout, project_scenes_in, AppState};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{ipc::Response, AppHandle, Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "welcome";
const MAX_FOLDER_SCAN: usize = 200;

/// Show the welcome window (create it if needed) and focus it.
pub fn build_welcome<R: Runtime, M: Manager<R>>(app: &M) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("welcome.html".into()))
        .title("gfx studio")
        .inner_size(960.0, 620.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true)
        .center()
        .background_color(tauri::window::Color(0x14, 0x17, 0x1f, 0xff))
        // Tauri's OS drag-drop handler swallows HTML5 drag-and-drop on Windows (docs/LAYOUT.md); the folder drop is HTML5
        .disable_drag_drop_handler()
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()?;
    hook_drop(&w);
    Ok(())
}

/// Folder drop: the page posts the dropped `File` objects with `chrome.webview.postMessageWithAdditionalObjects`; WebView2
/// hands the host their real paths (`ICoreWebView2File::Path`), which go back to the page as `gfx://dropped`. Used by the
/// welcome window (folder drop) and the main window (New scene references); the event goes to the hooked window.
#[cfg(windows)]
pub(crate) fn hook_drop<R: Runtime>(w: &tauri::WebviewWindow<R>) {
    let app = w.app_handle().clone();
    let target = w.label().to_string();
    let _ = w.with_webview(move |pw| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
        use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
        use windows_core::{Interface, PWSTR};
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let Ok(a2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return Ok(()) };
            let Ok(objs) = a2.AdditionalObjects() else { return Ok(()) };
            let mut n = 0u32;
            objs.Count(&mut n)?;
            let mut paths = Vec::new();
            for i in 0..n {
                if let Ok(f) = objs.GetValueAtIndex(i).and_then(|o| o.cast::<ICoreWebView2File>()) {
                    let mut p = PWSTR::null();
                    if f.Path(&mut p).is_ok() { paths.push(take_pwstr(p)); }
                }
            }
            if !paths.is_empty() { let _ = app.emit_to(target.as_str(), "gfx://dropped", paths); }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}
#[cfg(not(windows))]
pub(crate) fn hook_drop<R: Runtime>(_w: &tauri::WebviewWindow<R>) {}

// ---------- projects ----------
pub struct Info { pub exists: bool, pub is_project: bool, pub name: String, pub scenes: usize }
pub fn info_of(path: &str) -> Info {
    let p = Path::new(path);
    let folder = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
    let gj = std::fs::read_to_string(p.join("gfx.json")).ok().and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok());
    let exists = p.is_dir();
    Info {
        exists,
        is_project: exists && (p.join("gfx.json").is_file() || p.join("scenes").is_dir()),
        name: gj.as_ref().and_then(|j| j.get("name")).and_then(|n| n.as_str()).map(String::from).unwrap_or(folder),
        scenes: if exists { project_scenes_in(path).len() } else { 0 },
    }
}
/// Thumbnail of a project: the sheet (else the first still) of the first scene that has one.
pub fn thumb_of(path: &str) -> Option<PathBuf> {
    for sc in project_scenes_in(path) {
        let d = Path::new(path).join("out").join(&sc.name);
        if d.join("sheet.png").is_file() { return Some(d.join("sheet.png")); }
        let Ok(rd) = std::fs::read_dir(&d) else { continue }; // a scene that was never rendered: try the next one
        let mut stills: Vec<PathBuf> = rd.flatten().map(|e| e.path())
            .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("still-") && n.ends_with(".png")).unwrap_or(false)).collect();
        stills.sort();
        if let Some(s) = stills.into_iter().next() { return Some(s); }
    }
    None
}
/// gfx projects directly inside a folder (sorted by folder name).
pub fn projects_in(folder: &str) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(folder) else { return vec![] };
    let mut v: Vec<String> = rd.flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.path()).filter(|p| p.join("gfx.json").is_file() || p.join("scenes").is_dir())
        .map(|p| p.to_string_lossy().into_owned()).collect();
    v.sort_by_key(|p| p.to_lowercase());
    v.truncate(MAX_FOLDER_SCAN);
    v
}
/// Reveal / thumbnails only for folders the user listed: a recent project, a listed folder or a project inside one.
pub fn is_known(r: &RecentFile, path: &str) -> bool {
    let k = path_key(path);
    let parent = Path::new(path).parent().map(|p| path_key(&p.to_string_lossy()));
    r.recent.iter().any(|e| path_key(&e.path) == k) || r.folders.iter().any(|f| path_key(f) == k || Some(path_key(f)) == parent)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectItem { path: String, name: String, scenes: usize, thumb: bool, missing: bool, opened: u64, pinned: bool }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderItem { path: String, missing: bool, projects: Vec<ProjectItem> }
#[derive(Serialize)]
pub struct RecentView { recent: Vec<ProjectItem>, folders: Vec<FolderItem> }

fn item(path: &str, opened: u64, pinned: bool, fallback_name: &str) -> ProjectItem {
    let i = info_of(path);
    ProjectItem {
        path: path.into(), name: if i.exists { i.name } else if fallback_name.is_empty() { i.name } else { fallback_name.into() },
        scenes: i.scenes, thumb: i.exists && thumb_of(path).is_some(), missing: !i.exists, opened, pinned,
    }
}
fn view(r: &RecentFile) -> RecentView {
    RecentView {
        recent: r.recent.iter().map(|e| item(&e.path, e.opened, e.pinned, &e.name)).collect(),
        folders: r.folders.iter().map(|f| FolderItem {
            path: f.clone(), missing: !Path::new(f).is_dir(), projects: projects_in(f).iter().map(|p| item(p, 0, false, "")).collect(),
        }).collect(),
    }
}

/// Recent projects and folders, with what is on disk now (missing, scene count, name, thumbnail).
#[tauri::command]
pub async fn recent_list(state: State<'_, AppState>) -> Result<RecentView, String> {
    let r = prefs::load_recent(&prefs::recent_path(&state));
    Ok(tauri::async_runtime::spawn_blocking(move || view(&r)).await.map_err(|e| e.to_string())?)
}
/// What a folder is: a project, a folder with projects inside, or neither (Open folder / drop).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderInfo { exists: bool, is_project: bool, name: String, projects: usize }
#[tauri::command]
pub async fn classify_folder(path: String) -> Result<FolderInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let i = info_of(&path);
        FolderInfo { exists: i.exists, is_project: i.is_project, name: i.name, projects: if i.exists && !i.is_project { projects_in(&path).len() } else { 0 } }
    }).await.map_err(|e| e.to_string())
}
/// Opened in the main window (also when the project was opened from the main window itself).
#[tauri::command]
pub fn recent_touch(path: String, state: State<AppState>) -> Result<(), String> {
    let name = info_of(&path).name;
    prefs::edit_recent(&state, |r| prefs::touch_recent(r, &path, &name, prefs::now_ms()))
}
#[tauri::command]
pub fn recent_remove(path: String, state: State<AppState>) -> Result<(), String> { prefs::edit_recent(&state, |r| prefs::remove_recent(r, &path)) }
#[tauri::command]
pub fn recent_pin(path: String, pinned: bool, state: State<AppState>) -> Result<(), String> { prefs::edit_recent(&state, |r| prefs::pin_recent(r, &path, pinned)) }
/// Locate…: a missing project or folder was moved to `to`.
#[tauri::command]
pub fn recent_relocate(from: String, to: String, folder: bool, state: State<AppState>) -> Result<(), String> {
    let i = info_of(&to);
    if !i.exists { return Err(format!("not a folder: {to}")); }
    if folder { return prefs::edit_recent(&state, |r| prefs::relocate_folder(r, &from, &to)); }
    if !i.is_project { return Err(format!("no gfx project in {to} (it needs a gfx.json or a scenes folder)")); }
    prefs::edit_recent(&state, |r| prefs::relocate_recent(r, &from, &to, &i.name, prefs::now_ms()))
}
#[tauri::command]
pub fn folder_add(path: String, state: State<AppState>) -> Result<(), String> {
    if !Path::new(&path).is_dir() { return Err(format!("not a folder: {path}")); }
    prefs::edit_recent(&state, |r| prefs::add_folder(r, &path))
}
#[tauri::command]
pub fn folder_remove(path: String, state: State<AppState>) -> Result<(), String> { prefs::edit_recent(&state, |r| prefs::remove_folder(r, &path)) }
/// One-time import of the old localStorage recent list (`gfx-studio.recent`).
#[tauri::command]
pub fn recent_import(entries: Vec<prefs::RecentEntry>, state: State<AppState>) -> Result<(), String> {
    prefs::edit_recent(&state, |r| {
        let mut list = r.recent.clone();
        for e in entries.into_iter().filter(|e| !e.path.is_empty()) {
            if !list.iter().any(|x| path_key(&x.path) == path_key(&e.path)) { list.push(prefs::RecentEntry { pinned: false, ..e }); }
        }
        r.recent = prefs::sort_cap(list, None);
    })
}

/// The project templates the engine ships (`<engine>/templates/projects/*`, `_shared` excluded).
#[tauri::command]
pub fn list_templates(folder: Option<String>) -> Result<Vec<String>, String> {
    let eng = if let Some(wsl) = folder.as_deref().and_then(crate::wsl_root_engine) {
        let wsl = wsl?;
        crate::wsl_unc(&wsl.distro, &wsl.path)
    } else { crate::locate_engine()?.dir }; // a WSL engine is read through \\wsl.localhost
    let mut v: Vec<String> = std::fs::read_dir(eng.join("templates").join("projects")).map_err(|e| format!("no templates in the engine: {e}"))?
        .flatten().filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('_')).collect();
    v.sort();
    Ok(v)
}

#[tauri::command]
pub async fn project_thumb(path: String, state: State<'_, AppState>) -> Result<Response, String> {
    let r = prefs::load_recent(&prefs::recent_path(&state));
    if !is_known(&r, &path) { return Err("not a listed project".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let t = thumb_of(&path).ok_or("no thumbnail")?;
        std::fs::read(&t).map(Response::new).map_err(|e| e.to_string())
    }).await.map_err(|e| e.to_string())?
}
/// Reveal a listed project / folder in Explorer.
#[tauri::command]
pub fn reveal_project(path: String, state: State<AppState>) -> Result<(), String> {
    let r = prefs::load_recent(&prefs::recent_path(&state));
    if !is_known(&r, &path) { return Err("not a listed project".into()); }
    if !Path::new(&path).exists() { return Err(format!("not found: {path}")); }
    crate::explorer(&format!("/select,\"{}\"", path.trim_end_matches(['\\', '/'])))
}
/// The app's own folder (settings.json, recent.json, t3.json) in Explorer.
#[tauri::command]
pub fn open_app_folder(state: State<AppState>) -> Result<String, String> {
    let d = state.config_file.parent().ok_or("no config folder")?.to_string_lossy().into_owned();
    crate::explorer(&format!("\"{d}\""))?;
    Ok(d)
}

// ---------- windows ----------
#[tauri::command]
pub fn main_open<R: Runtime>(app: AppHandle<R>) -> bool { app.get_window("main").is_some() }

/// Main window: Open welcome window (Ctrl+Shift+O, the project button).
#[tauri::command]
pub async fn open_welcome<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    build_welcome(&app).map_err(|e| e.to_string())
}
/// Main window: the project from the welcome window is open (or was already): close the welcome window.
#[tauri::command]
pub fn close_welcome<R: Runtime>(app: AppHandle<R>) {
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.close(); }
}
/// Welcome window: open a project. With the main window open it switches there (the main window asks about unsaved
/// edits first and closes the welcome window when done); otherwise the main window is built with that project.
#[tauri::command]
pub async fn welcome_open<R: Runtime>(app: AppHandle<R>, path: String, request_id: Option<String>, state: State<'_, AppState>) -> Result<&'static str, String> {
    let i = info_of(&path);
    if !i.exists { return Err(format!("Folder not found: {path}")); }
    if !i.is_project { return Err(format!("No gfx project here: {path}")); }
    if let Some(main) = app.get_window("main") {
        app.emit_to("main", "gfx://open-project", serde_json::json!({ "path": path, "requestId": request_id })).map_err(|e| e.to_string())?;
        let _ = main.unminimize();
        let _ = main.set_focus();
        return Ok("switched");
    }
    crate::persist_root(&state, path.clone())?;
    let _ = prefs::edit_recent(&state, |r| prefs::touch_recent(r, &path, &i.name, prefs::now_ms()));
    popout::build_main(&app).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(LABEL) { let _ = w.close(); }
    Ok("opened")
}
/// Welcome window: open Settings (a page) in the main window; needs a project open there.
#[tauri::command]
pub fn welcome_settings<R: Runtime>(app: AppHandle<R>, page: String) -> Result<(), String> {
    let main = app.get_window("main").ok_or("Open a project first: Settings live in the project window")?;
    app.emit_to("main", "gfx://open-settings", &page).map_err(|e| e.to_string())?;
    let _ = main.unminimize();
    let _ = main.set_focus();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folders_known_thumbs() {
        let d = std::env::temp_dir().join(format!("gfx-wl-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        for p in ["lib/a/scenes/s1", "lib/b", "lib/c/scenes", "lib/notes"] { std::fs::create_dir_all(d.join(p)).unwrap(); }
        std::fs::write(d.join("lib/b/gfx.json"), r#"{"name":"Bee"}"#).unwrap();
        std::fs::write(d.join("lib/a/scenes/s1/scene.json"), "{}").unwrap();
        std::fs::create_dir_all(d.join("lib/a/out/s1")).unwrap();
        let lib = d.join("lib").to_string_lossy().into_owned();
        let found: Vec<String> = projects_in(&lib).iter().map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned()).collect();
        assert_eq!(found, ["a", "b", "c"]);
        let a = d.join("lib/a").to_string_lossy().into_owned();
        assert!(thumb_of(&a).is_none());
        // a first scene without out/ does not hide a later scene's sheet
        std::fs::create_dir_all(d.join("lib/a/scenes/s0")).unwrap();
        std::fs::write(d.join("lib/a/scenes/s0/scene.json"), "{}").unwrap();
        std::fs::create_dir_all(d.join("lib/b/scenes/s0")).unwrap();
        std::fs::write(d.join("lib/b/scenes/s0/scene.json"), "{}").unwrap();
        std::fs::create_dir_all(d.join("lib/b/scenes/s1")).unwrap();
        std::fs::write(d.join("lib/b/scenes/s1/scene.json"), "{}").unwrap();
        std::fs::create_dir_all(d.join("lib/b/out/s1")).unwrap();
        std::fs::write(d.join("lib/b/out/s1/sheet.png"), "x").unwrap();
        assert!(thumb_of(&d.join("lib/b").to_string_lossy()).unwrap().ends_with("sheet.png"));
        std::fs::remove_dir_all(d.join("lib/b/scenes")).unwrap();
        std::fs::remove_dir_all(d.join("lib/b/out")).unwrap();
        std::fs::write(d.join("lib/a/out/s1/still-2.png"), "x").unwrap();
        std::fs::write(d.join("lib/a/out/s1/still-1.png"), "x").unwrap();
        assert!(thumb_of(&a).unwrap().ends_with("still-1.png"));
        std::fs::write(d.join("lib/a/out/s1/sheet.png"), "x").unwrap();
        assert!(thumb_of(&a).unwrap().ends_with("sheet.png"));
        let b = info_of(&d.join("lib/b").to_string_lossy());
        assert!(b.exists && b.is_project && b.name == "Bee" && b.scenes == 0);
        let n = info_of(&d.join("lib/notes").to_string_lossy());
        assert!(n.exists && !n.is_project);
        assert!(!info_of(&d.join("nope").to_string_lossy()).exists);
        let mut r = RecentFile::default();
        assert!(!is_known(&r, &a));
        prefs::add_folder(&mut r, &lib);
        assert!(is_known(&r, &a) && is_known(&r, &lib));
        assert!(!is_known(&r, &d.to_string_lossy()));
        assert!(!is_known(&r, &d.join("lib/a/out").to_string_lossy()));
        r.folders.clear();
        prefs::touch_recent(&mut r, &a, "A", 1);
        assert!(is_known(&r, &a) && !is_known(&r, &d.join("lib/b").to_string_lossy()));
        let _ = std::fs::remove_dir_all(&d);
    }
}
