//! The machine Library (docs/LOOKS.md §3): `looks/<id>/`, `presets/<name>.js`, `palettes/<name>.json` under the folder of
//! the `libraryDir` setting (default `<Documents>/gfx library`, a `\\wsl.localhost\...` path is allowed). Every op is rooted
//! at that folder: relative paths only, no `..`, fixed layout, symlinks never followed out of it. Plus `import_ref`, which
//! copies a user-picked reference file into the project under `scenes/<name>/refs/` only, and the `pick_refs` dialog.
//! The JS twin of the guards is `web/src/library-core.js` (same rules, same tests).
use crate::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{ipc::Response, Manager, State};
use tauri_plugin_dialog::DialogExt;

pub const MAX_TEXT: u64 = 1024 * 1024;
pub const MAX_THUMB: u64 = 20 * 1024 * 1024;
pub const MAX_REF: u64 = 200 * 1024 * 1024;
const MAX_FILES: usize = 5000;
pub const IMAGE_EXT: &[&str] = &["png", "jpg", "jpeg", "webp", "gif", "avif", "bmp", "svg"];
pub const VIDEO_EXT: &[&str] = &["mp4", "webm", "mov", "m4v", "mkv", "avi"];
const TEXT_EXT: &[&str] = &["md", "js", "json", "txt"];
/// Videos `library_read_bytes` serves from a look (its `preview.mp4`, video refs), besides images; ≤ MAX_THUMB as well.
pub const BYTES_VIDEO_EXT: &[&str] = &["mp4", "webm"];

/// A look id / preset / palette name: lowercase slug (twin of runner/lib/looks.js SLUG).
pub fn valid_id(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty() && b.len() <= 64
        && b.iter().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
        && b[0] != b'-' && b[b.len() - 1] != b'-'
}
/// A file or folder name inside a look: no separators, reserved characters, control characters or leading dot.
pub fn valid_segment(s: &str) -> bool {
    !s.is_empty() && s.chars().count() <= 128 && !s.starts_with('.') && !s.ends_with(' ') && !s.ends_with('.')
        && !s.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
}
fn ext_of(name: &str) -> String {
    Path::new(name).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}
pub fn is_media(name: &str) -> bool {
    let e = ext_of(name);
    IMAGE_EXT.contains(&e.as_str()) || VIDEO_EXT.contains(&e.as_str())
}

/// What a Library path names.
#[derive(Debug, PartialEq, Clone, Copy)]
pub enum LibPath { LookDir, LookFile, Preset, Palette, Taste }

/// Validate a Library-relative path -> its parts and kind. Allowed: `looks/<id>`, `looks/<id>/<seg>/...` (depth ≤ 4 under the
/// look), `presets/<name>.js`, `palettes/<name>.json`.
pub fn check_lib_rel(rel: &str) -> Result<(Vec<String>, LibPath), String> {
    let parts = crate::normalize_rel(rel)?;
    let bad = || format!("not a Library path (looks/<id>/…, presets/<name>.js, palettes/<name>.json): {rel}");
    match parts[0].as_str() {
        "looks" if parts.len() >= 2 && valid_id(&parts[1]) => {
            if parts.len() == 2 { return Ok((parts, LibPath::LookDir)); }
            if parts.len() > 6 || !parts[2..].iter().all(|s| valid_segment(s)) { return Err(bad()); }
            Ok((parts, LibPath::LookFile))
        }
        "presets" if parts.len() == 2 && parts[1].strip_suffix(".js").map(valid_id).unwrap_or(false) => Ok((parts, LibPath::Preset)),
        "palettes" if parts.len() == 2 && parts[1].strip_suffix(".json").map(valid_id).unwrap_or(false) => Ok((parts, LibPath::Palette)),
        // sound taste memory (docs/SOUND-TWEAK.md §4): one machine-level file
        "taste" if parts.len() == 2 && parts[1] == "sounds.json" => Ok((parts, LibPath::Taste)),
        _ => Err(bad()),
    }
}
/// Text files that may be written: LOOK.md / preset.js / sounds.json / notes inside a look, presets, palettes.
pub fn check_lib_writable(rel: &str) -> Result<Vec<String>, String> {
    let (parts, kind) = check_lib_rel(rel)?;
    match kind {
        LibPath::LookDir => Err(format!("not a file: {rel}")),
        LibPath::LookFile if !TEXT_EXT.contains(&ext_of(parts.last().unwrap()).as_str()) => Err(format!("only text files (.md .js .json .txt) can be written: {rel}")),
        _ => Ok(parts),
    }
}
/// `looks/<id>/refs/<file>` with an image / video extension (library_import).
pub fn check_lib_ref(rel: &str) -> Result<Vec<String>, String> {
    let (parts, kind) = check_lib_rel(rel)?;
    if kind != LibPath::LookFile || parts.len() != 4 || parts[2] != "refs" || !is_media(&parts[3]) {
        return Err(format!("references go to looks/<id>/refs/<image or video>: {rel}"));
    }
    Ok(parts)
}
/// Project refs: exactly `scenes/<name>/refs/<file>` with an image / video extension.
pub fn check_ref_dest(rel: &str) -> Result<Vec<String>, String> {
    let parts = crate::normalize_rel(rel)?;
    let ok = parts.len() == 4 && parts[0] == "scenes" && valid_segment(&parts[1]) && parts[2] == "refs" && valid_segment(&parts[3]) && is_media(&parts[3]);
    if ok { Ok(parts) } else { Err(format!("references go to scenes/<name>/refs/<image or video>: {rel}")) }
}
/// Replace characters a file name can't have (and a leading dot) so a picked file keeps a readable name.
pub fn clean_file_name(name: &str) -> String {
    let mut s: String = name.chars().map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '-' } else { c }).collect();
    s = s.trim().trim_start_matches('.').trim_end_matches(['.', ' ']).to_string();
    if s.chars().count() > 120 {
        let ext = ext_of(&s);
        let stem: String = s.chars().take(110).collect();
        s = if ext.is_empty() { stem } else { format!("{stem}.{ext}") };
    }
    if s.is_empty() { "ref".into() } else { s }
}
/// `dir/name`, or `name-2.ext`, `name-3.ext`, … when it exists.
pub fn unique_in(dir: &Path, name: &str) -> String {
    if std::fs::symlink_metadata(dir.join(name)).is_err() { return name.to_string(); }
    let p = Path::new(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name);
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
    (2..10_000).map(|i| format!("{stem}-{i}{ext}")).find(|n| std::fs::symlink_metadata(dir.join(n)).is_err()).unwrap_or_else(|| format!("{stem}-{}{ext}", crate::prefs::now_ms()))
}

/// `p` stays inside `root` after resolving symlinks of the parts that exist (lexically for the rest).
pub fn inside(root: &Path, p: &Path) -> bool {
    let Ok(rr) = std::fs::canonicalize(root) else { return p.starts_with(root) };
    let mut q = p.to_path_buf();
    let mut rest: Vec<std::ffi::OsString> = Vec::new();
    while std::fs::symlink_metadata(&q).is_err() {
        match (q.file_name().map(|n| n.to_os_string()), q.parent()) {
            (Some(n), Some(up)) => { rest.push(n); q = up.to_path_buf(); }
            _ => return false,
        }
    }
    let Ok(mut rq) = std::fs::canonicalize(&q) else { return false };
    for n in rest.into_iter().rev() { rq.push(n); }
    rq.starts_with(&rr)
}
fn join_checked(root: &Path, parts: &[String]) -> Result<PathBuf, String> {
    let mut p = root.to_path_buf();
    for s in parts { p.push(s); }
    if !inside(root, &p) { return Err(format!("path leaves the folder: {}", parts.join("/"))); }
    Ok(p)
}

// ---------- the Library folder ----------
/// The Library folder: the `libraryDir` setting, else `<Documents>/gfx library`.
pub fn library_dir(app: &tauri::AppHandle, state: &AppState) -> Result<(PathBuf, &'static str), String> {
    let s = crate::prefs::load_settings(&crate::prefs::settings_path(state));
    if let Some(d) = s.pref_str("libraryDir").map(str::trim).filter(|d| !d.is_empty()) { return Ok((PathBuf::from(d), "setting")); }
    let d = crate::prefs::default_library_dir(app.path().document_dir().ok(), app.path().home_dir().ok());
    if d.is_empty() { return Err("no Library folder: choose one in Settings → General → Library folder".into()); }
    Ok((PathBuf::from(d), "default"))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibFile { pub path: String, pub size: u64, pub mtime: u64 }
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LibListing { pub dir: String, pub source: String, pub exists: bool, pub files: Vec<LibFile>, pub truncated: bool }

/// Files under looks/, presets/, palettes/ (regular files only, no symlinks, no dot entries; at most 5000).
pub fn list_library(dir: &Path) -> (Vec<LibFile>, bool) {
    fn walk(d: &Path, rel: &str, depth: usize, out: &mut Vec<LibFile>, trunc: &mut bool) {
        let Ok(rd) = std::fs::read_dir(d) else { return };
        let mut ents: Vec<_> = rd.flatten().collect();
        ents.sort_by_key(|e| e.file_name());
        for e in ents {
            let name = e.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') { continue; }
            let Ok(ft) = e.file_type() else { continue };
            let r = format!("{rel}/{name}");
            if ft.is_dir() { if depth < 6 { walk(&e.path(), &r, depth + 1, out, trunc); } }
            else if ft.is_file() {
                if out.len() >= MAX_FILES { *trunc = true; continue; }
                let md = e.metadata().ok();
                let mtime = md.as_ref().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                out.push(LibFile { path: r, size: md.map(|m| m.len()).unwrap_or(0), mtime });
            }
        }
    }
    let (mut out, mut trunc) = (Vec::new(), false);
    for top in ["looks", "presets", "palettes"] {
        let d = dir.join(top);
        if std::fs::symlink_metadata(&d).map(|m| m.is_dir()).unwrap_or(false) { walk(&d, top, 1, &mut out, &mut trunc); }
    }
    (out, trunc)
}

pub fn read_lib_text(dir: &Path, rel: &str) -> Result<Option<String>, String> {
    let (parts, kind) = check_lib_rel(rel)?;
    if kind == LibPath::LookDir { return Err(format!("not a file: {rel}")); }
    let p = join_checked(dir, &parts)?;
    let md = match std::fs::metadata(&p) { Ok(m) => m, Err(_) => return Ok(None) };
    if !md.is_file() { return Err(format!("not a file: {rel}")); }
    if md.len() > MAX_TEXT { return Err(format!("{rel}: larger than 1 MB")); }
    let b = std::fs::read(&p).map_err(|e| format!("{rel}: {e}"))?;
    String::from_utf8(b).map(Some).map_err(|_| format!("{rel}: not a UTF-8 text file"))
}
/// A file `library_read_bytes` may serve: an image or an mp4 / webm clip inside a look (thumb.jpg, preview.mp4, refs).
pub fn check_lib_bytes(rel: &str) -> Result<Vec<String>, String> {
    let (parts, kind) = check_lib_rel(rel)?;
    let e = ext_of(parts.last().unwrap());
    if kind != LibPath::LookFile || !(IMAGE_EXT.contains(&e.as_str()) || BYTES_VIDEO_EXT.contains(&e.as_str())) {
        return Err(format!("only images and mp4 / webm clips inside a look can be read as bytes: {rel}"));
    }
    Ok(parts)
}
pub fn read_lib_bytes(dir: &Path, rel: &str) -> Result<Vec<u8>, String> {
    let parts = check_lib_bytes(rel)?;
    let p = join_checked(dir, &parts)?;
    let md = std::fs::metadata(&p).map_err(|e| format!("{rel}: {e}"))?;
    if !md.is_file() || md.len() > MAX_THUMB { return Err(format!("{rel}: not a file or larger than 20 MB")); }
    std::fs::read(&p).map_err(|e| format!("{rel}: {e}"))
}
// Exclusive creation refuses existing files (including symlinks); random names avoid stale temp collisions.
fn temp_file(p: &Path) -> Result<(PathBuf, std::fs::File), String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|e| e.to_string())?;
    let suffix: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    let tmp = p.with_file_name(format!(".{}.tmp-gfx-{suffix}", p.file_name().unwrap().to_string_lossy()));
    let f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|e| e.to_string())?;
    Ok((tmp, f))
}
pub fn write_lib_text(dir: &Path, rel: &str, text: &str) -> Result<(), String> {
    let parts = check_lib_writable(rel)?;
    if text.len() as u64 > MAX_TEXT { return Err(format!("{rel}: larger than 1 MB")); }
    std::fs::create_dir_all(dir).map_err(|e| format!("Library folder {}: {e}", dir.display()))?;
    let p = join_checked(dir, &parts)?;
    if std::fs::symlink_metadata(&p).map(|m| m.file_type().is_symlink() || m.is_dir()).unwrap_or(false) { return Err(format!("{rel}: not a regular file")); }
    if let Some(d) = p.parent() { std::fs::create_dir_all(d).map_err(|e| format!("{rel}: {e}"))?; }
    if !inside(dir, &p) { return Err(format!("path leaves the folder: {rel}")); }
    let (tmp, mut f) = temp_file(&p)?;
    use std::io::Write;
    let result = f.write_all(text.as_bytes());
    drop(f);
    result.map_err(|e| { let _ = std::fs::remove_file(&tmp); format!("{rel}: {e}") })?;
    std::fs::rename(&tmp, &p).map_err(|e| { let _ = std::fs::remove_file(&tmp); format!("{rel}: {e}") })
}
pub fn delete_lib(dir: &Path, rel: &str) -> Result<(), String> {
    let (parts, kind) = check_lib_rel(rel)?;
    let parent = join_checked(dir, &parts[..parts.len() - 1])?;
    let p = parent.join(parts.last().unwrap());
    let md = std::fs::symlink_metadata(&p).map_err(|_| format!("not found: {rel}"))?;
    if !md.file_type().is_symlink() && !inside(dir, &p) { return Err(format!("path leaves the folder: {rel}")); }
    if md.file_type().is_symlink() || md.is_file() { return std::fs::remove_file(&p).map_err(|e| format!("{rel}: {e}")); }
    if kind == LibPath::LookDir || (kind == LibPath::LookFile && md.is_dir()) { return std::fs::remove_dir_all(&p).map_err(|e| format!("{rel}: {e}")); }
    Err(format!("not a file: {rel}"))
}
/// Duplicate: a look folder into a new look id, or a preset / palette file into a new name (same kind; `to` must not exist).
pub fn copy_lib(dir: &Path, from: &str, to: &str) -> Result<(), String> {
    let (fp, fk) = check_lib_rel(from)?;
    let (tp, tk) = check_lib_rel(to)?;
    if fk != tk || fk == LibPath::LookFile { return Err(format!("can only duplicate a look, preset or palette into the same kind: {from} -> {to}")); }
    let (src, dst) = (join_checked(dir, &fp)?, join_checked(dir, &tp)?);
    if std::fs::symlink_metadata(&dst).is_ok() { return Err(format!("{to} already exists")); }
    let md = std::fs::symlink_metadata(&src).map_err(|_| format!("not found: {from}"))?;
    if fk != LibPath::LookDir {
        if !md.is_file() { return Err(format!("not a file: {from}")); }
        return std::fs::copy(&src, &dst).map(|_| ()).map_err(|e| format!("{to}: {e}"));
    }
    if !md.is_dir() { return Err(format!("not a look folder: {from}")); }
    fn cp(s: &Path, d: &Path) -> std::io::Result<()> {
        std::fs::create_dir_all(d)?;
        for e in std::fs::read_dir(s)?.flatten() {
            let ft = e.file_type()?;
            if ft.is_dir() { cp(&e.path(), &d.join(e.file_name()))?; } else if ft.is_file() { std::fs::copy(e.path(), d.join(e.file_name()))?; }
        }
        Ok(())
    }
    cp(&src, &dst).map_err(|e| { let _ = std::fs::remove_dir_all(&dst); format!("{to}: {e}") })
}

/// Copy a user-picked file (absolute path) into `dest_dir` as `name` (deduplicated). -> the final file name.
pub fn copy_ref(src: &str, dest_dir: &Path, name: &str, root: &Path) -> Result<String, String> {
    let sp = Path::new(src);
    if !crate::prefs::is_abs(src) { return Err(format!("not an absolute path: {src}")); }
    let md = std::fs::metadata(sp).map_err(|e| format!("{src}: {e}"))?;
    if !md.is_file() { return Err(format!("not a file: {src}")); }
    if md.len() > MAX_REF { return Err(format!("{src}: larger than 200 MB")); }
    if !is_media(src) { return Err(format!("{src}: not an image or video")); }
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    if !inside(root, dest_dir) { return Err("the refs folder leaves the project".into()); }
    let final_name = unique_in(dest_dir, name);
    let (tmp, mut f) = temp_file(&dest_dir.join(&final_name))?;
    let result = std::fs::File::open(sp).and_then(|mut input| std::io::copy(&mut input, &mut f));
    drop(f);
    result.map_err(|e| { let _ = std::fs::remove_file(&tmp); format!("{src}: {e}") })?;
    std::fs::rename(&tmp, dest_dir.join(&final_name)).map_err(|e| { let _ = std::fs::remove_file(&tmp); e.to_string() })?;
    Ok(final_name)
}
/// import_ref: `dest` = `scenes/<name>/refs/<file>`; the scene folder must exist. -> the project-relative path written.
pub fn import_ref_into(root: &str, src: &str, dest: &str) -> Result<String, String> {
    let parts = check_ref_dest(dest)?;
    let rootp = Path::new(root);
    let scene = join_checked(rootp, &parts[..2])?;
    if !scene.is_dir() { return Err(format!("no scene folder scenes/{} (create the scene first)", parts[1])); }
    let name = copy_ref(src, &scene.join("refs"), &clean_file_name(&parts[3]), rootp)?;
    Ok(format!("scenes/{}/refs/{name}", parts[1]))
}

// ---------- commands ----------
fn lib_of(app: &tauri::AppHandle, state: &State<AppState>) -> Result<PathBuf, String> { library_dir(app, state.inner()).map(|x| x.0) }

#[tauri::command]
pub fn library_files(app: tauri::AppHandle, state: State<AppState>) -> Result<LibListing, String> {
    let (dir, source) = library_dir(&app, state.inner())?;
    let exists = dir.is_dir();
    let (files, truncated) = if exists { list_library(&dir) } else { (vec![], false) };
    Ok(LibListing { dir: dir.to_string_lossy().into_owned(), source: source.into(), exists, files, truncated })
}
#[tauri::command]
pub fn library_read(rel: String, app: tauri::AppHandle, state: State<AppState>) -> Result<Option<String>, String> {
    read_lib_text(&lib_of(&app, &state)?, &rel)
}
#[tauri::command]
pub fn library_read_bytes(rel: String, app: tauri::AppHandle, state: State<AppState>) -> Result<Response, String> {
    read_lib_bytes(&lib_of(&app, &state)?, &rel).map(Response::new)
}
#[tauri::command]
pub fn library_write(rel: String, text: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    write_lib_text(&lib_of(&app, &state)?, &rel, &text)
}
#[tauri::command]
pub fn library_delete(rel: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    delete_lib(&lib_of(&app, &state)?, &rel)
}
#[tauri::command]
pub fn library_copy(from: String, to: String, app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    copy_lib(&lib_of(&app, &state)?, &from, &to)
}
/// A picked file into a Library look's refs/ (`rel` = `looks/<id>/refs/<file>`; the look must exist). -> the rel written.
#[tauri::command]
pub fn library_import(src: String, rel: String, app: tauri::AppHandle, state: State<AppState>) -> Result<String, String> {
    let dir = lib_of(&app, &state)?;
    let parts = check_lib_ref(&rel)?;
    let look = join_checked(&dir, &parts[..2])?;
    if !look.is_dir() { return Err(format!("no look {} in the Library", parts[1])); }
    let name = copy_ref(&src, &look.join("refs"), &clean_file_name(&parts[3]), &dir)?;
    Ok(format!("looks/{}/refs/{name}", parts[1]))
}
#[tauri::command]
pub fn import_ref(src: String, dest: String, state: State<AppState>) -> Result<String, String> {
    import_ref_into(&state.root.lock().unwrap().clone(), &src, &dest)
}
/// Multi-select of reference images / videos; [] when cancelled.
#[tauri::command]
pub async fn pick_refs(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let exts: Vec<&str> = IMAGE_EXT.iter().chain(VIDEO_EXT.iter()).copied().collect();
    let picked = app.dialog().file().set_title("Add references").add_filter("Images and videos", &exts).blocking_pick_files();
    Ok(picked.unwrap_or_default().into_iter().filter_map(|f| f.into_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gfx-lib-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn library_paths() {
        assert_eq!(check_lib_rel("looks/clean-dark").unwrap().1, LibPath::LookDir);
        assert_eq!(check_lib_rel("looks/clean-dark/LOOK.md").unwrap().1, LibPath::LookFile);
        assert_eq!(check_lib_rel("looks/a/refs/shot 1.png").unwrap().1, LibPath::LookFile);
        assert_eq!(check_lib_rel("presets/brand.js").unwrap().1, LibPath::Preset);
        assert_eq!(check_lib_rel("palettes/soft.json").unwrap().1, LibPath::Palette);
        assert_eq!(check_lib_rel("taste/sounds.json").unwrap().1, LibPath::Taste);
        assert!(check_lib_writable("taste/sounds.json").is_ok());
        for bad in ["taste", "taste/x.json", "taste/sounds.json/x", "taste/../sounds.json"] { assert!(check_lib_rel(bad).is_err(), "{bad}"); }
        for bad in ["looks", "looks/Bad", "looks/-a", "looks/a/../b", "../x", "/abs", "C:/x", "presets/a.json", "presets/x/y.js", "palettes/a.js",
            "other/x", "looks/a/.hidden", "looks/a/b:c", "looks/a/1/2/3/4/5", "presets/A.js"] {
            assert!(check_lib_rel(bad).is_err(), "{bad}");
        }
        assert!(check_lib_writable("looks/a/LOOK.md").is_ok());
        assert!(check_lib_writable("looks/a/refs/notes.txt").is_ok());
        assert!(check_lib_writable("looks/a").is_err());
        assert!(check_lib_writable("looks/a/refs/x.png").is_err(), "binary files are not written as text");
        assert!(check_lib_bytes("looks/a/thumb.jpg").is_ok());
        assert!(check_lib_bytes("looks/a/preview.mp4").is_ok());
        assert!(check_lib_bytes("looks/a/refs/clip.WEBM").is_ok());
        for bad in ["looks/a/LOOK.md", "looks/a/x.mov", "looks/a", "presets/a.js", "looks/a/sample/scene.js"] { assert!(check_lib_bytes(bad).is_err(), "{bad}"); }
        assert!(check_lib_ref("looks/a/refs/x.png").is_ok());
        assert!(check_lib_ref("looks/a/x.png").is_err());
        assert!(check_lib_ref("looks/a/refs/x.exe").is_err());
        assert!(check_ref_dest("scenes/intro/refs/mood.jpg").is_ok());
        assert!(check_ref_dest("scenes/intro/refs/clip.MP4").is_ok());
        for bad in ["scenes/intro/mood.jpg", "scenes/intro/refs/a/b.jpg", "scenes/../refs/x.png", "out/x/refs/a.png", "scenes/intro/refs/run.exe", "scenes/intro/refs/.x.png"] {
            assert!(check_ref_dest(bad).is_err(), "{bad}");
        }
        assert_eq!(clean_file_name("a:b?.png"), "a-b-.png");
        assert_eq!(clean_file_name("..hidden.jpg"), "hidden.jpg");
        assert_eq!(clean_file_name(""), "ref");
        assert!(valid_id("clean-dark") && !valid_id("Clean") && !valid_id("a-") && !valid_id(""));
    }

    #[test]
    fn library_ops() {
        let d = tmp("ops");
        let lib = d.join("lib");
        assert_eq!(list_library(&lib).0.len(), 0);
        write_lib_text(&lib, "looks/a/LOOK.md", "---\nname: A\n---\n").unwrap();
        write_lib_text(&lib, "palettes/soft.json", "[]").unwrap();
        write_lib_text(&lib, "presets/p.js", "export default {}").unwrap();
        assert!(write_lib_text(&lib, "looks/a/LOOK.md", &"x".repeat(MAX_TEXT as usize + 1)).is_err());
        assert!(write_lib_text(&lib, "../escape.md", "x").is_err());
        std::fs::create_dir_all(lib.join("looks/a/refs")).unwrap();
        std::fs::write(lib.join("looks/a/refs/r.png"), [137u8, 80, 78, 71]).unwrap();
        std::fs::create_dir_all(lib.join(".trash")).unwrap();
        let files: Vec<String> = list_library(&lib).0.into_iter().map(|f| f.path).collect();
        assert_eq!(files, ["looks/a/LOOK.md", "looks/a/refs/r.png", "presets/p.js", "palettes/soft.json"]);
        assert_eq!(read_lib_text(&lib, "looks/a/LOOK.md").unwrap().unwrap(), "---\nname: A\n---\n");
        assert_eq!(read_lib_text(&lib, "looks/a/nope.md").unwrap(), None);
        assert!(read_lib_text(&lib, "looks/a/refs/r.png").is_err(), "not UTF-8");
        assert_eq!(read_lib_bytes(&lib, "looks/a/refs/r.png").unwrap().len(), 4);
        assert!(read_lib_bytes(&lib, "looks/a/LOOK.md").is_err());
        std::fs::write(lib.join("looks/a/preview.mp4"), [0u8, 0, 0, 24]).unwrap();
        assert_eq!(read_lib_bytes(&lib, "looks/a/preview.mp4").unwrap().len(), 4);
        copy_lib(&lib, "looks/a", "looks/b").unwrap();
        assert!(lib.join("looks/b/refs/r.png").is_file());
        assert!(copy_lib(&lib, "looks/a", "looks/b").is_err(), "target exists");
        assert!(copy_lib(&lib, "looks/a", "presets/x.js").is_err(), "different kinds");
        copy_lib(&lib, "palettes/soft.json", "palettes/soft-2.json").unwrap();
        delete_lib(&lib, "looks/b").unwrap();
        assert!(!lib.join("looks/b").exists());
        delete_lib(&lib, "palettes/soft-2.json").unwrap();
        assert!(delete_lib(&lib, "looks/zzz").is_err());
        // a symlink out of the library is never followed
        #[cfg(unix)]
        {
            let outside = d.join("outside");
            std::fs::create_dir_all(&outside).unwrap();
            std::os::unix::fs::symlink(&outside, lib.join("looks/evil")).unwrap();
            assert!(write_lib_text(&lib, "looks/evil/LOOK.md", "x").is_err());
            assert!(!outside.join("LOOK.md").exists());
            std::fs::write(outside.join("keep.md"), "KEEP").unwrap();
            assert!(delete_lib(&lib, "looks/evil/keep.md").is_err(), "a symlink parent cannot escape");
            assert_eq!(std::fs::read_to_string(outside.join("keep.md")).unwrap(), "KEEP");
            let secret = outside.join("secret");
            std::fs::write(&secret, "SECRET").unwrap();
            std::os::unix::fs::symlink(&secret, lib.join("looks/a/.LOOK.md.tmp-gfx")).unwrap();
            write_lib_text(&lib, "looks/a/LOOK.md", "safe").unwrap();
            std::os::unix::fs::symlink(&secret, lib.join("looks/a/refs/.copy.png.tmp-gfx")).unwrap();
            let src = outside.join("src.png");
            std::fs::write(&src, "PNG").unwrap();
            copy_ref(&src.to_string_lossy(), &lib.join("looks/a/refs"), "copy.png", &lib).unwrap();
            assert_eq!(std::fs::read_to_string(&secret).unwrap(), "SECRET", "temp symlinks are never followed");
            delete_lib(&lib, "looks/evil").unwrap();
            assert!(outside.is_dir(), "only the link is removed");
        }
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn import_refs() {
        let d = tmp("ref");
        let root = d.join("proj");
        std::fs::create_dir_all(root.join("scenes/intro")).unwrap();
        let src = d.join("mood board.PNG");
        std::fs::write(&src, b"png").unwrap();
        let s = src.to_string_lossy().into_owned();
        let r = root.to_string_lossy().into_owned();
        assert_eq!(import_ref_into(&r, &s, "scenes/intro/refs/mood board.PNG").unwrap(), "scenes/intro/refs/mood board.PNG");
        assert_eq!(import_ref_into(&r, &s, "scenes/intro/refs/mood board.PNG").unwrap(), "scenes/intro/refs/mood board-2.PNG", "never overwrites");
        assert!(import_ref_into(&r, &s, "scenes/nope/refs/x.png").unwrap_err().contains("no scene folder"));
        assert!(import_ref_into(&r, &s, "scenes/intro/x.png").is_err());
        assert!(import_ref_into(&r, "relative.png", "scenes/intro/refs/x.png").is_err());
        assert!(import_ref_into(&r, &d.to_string_lossy(), "scenes/intro/refs/x.png").is_err(), "a folder is not a file");
        let txt = d.join("notes.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert!(import_ref_into(&r, &txt.to_string_lossy(), "scenes/intro/refs/notes.png").is_err(), "the source must be an image / video");
        let _ = std::fs::remove_dir_all(&d);
    }
}
