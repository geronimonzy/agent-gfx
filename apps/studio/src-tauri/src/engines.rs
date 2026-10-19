// Installed engines (docs/INSTALL.md §2): `engines.json` next to settings.json records the WSL engines the app installed,
// one per distro. Machine state written by the WSL setup (§3), not a preference. Pure parsing here; lib.rs resolves.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(default)]
pub struct WslInstalled {
    /// Linux path of the engine folder inside the distro (has runner/cli.js).
    pub path: String,
    pub version: String,
    pub installed: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct EnginesFile {
    pub version: u32,
    /// distro name -> its installed engine
    pub wsl: BTreeMap<String, WslInstalled>,
}
impl Default for EnginesFile {
    fn default() -> Self { EnginesFile { version: 1, wsl: BTreeMap::new() } }
}

/// Tolerant read: a missing or broken file means "no installed engines" (the setup rewrites it).
pub fn parse(text: &str) -> EnginesFile {
    let mut f: EnginesFile = serde_json::from_str(text).unwrap_or_default();
    // only absolute Linux paths without parent steps count
    f.wsl.retain(|d, e| !d.trim().is_empty() && e.path.starts_with('/') && !e.path.split('/').any(|c| c == ".."));
    f
}
pub fn load(file: &Path) -> EnginesFile {
    std::fs::read_to_string(file).map(|t| parse(&t)).unwrap_or_default()
}

/// The installed engine of `distro` (WSL distro names are case-insensitive).
pub fn installed_wsl<'a>(f: &'a EnginesFile, distro: &str) -> Option<&'a WslInstalled> {
    f.wsl.iter().find(|(d, _)| d.eq_ignore_ascii_case(distro)).map(|(_, e)| e)
}

/// `version` from an engine folder's package.json (any folder spelling: native or `\\wsl.localhost\...`).
pub fn engine_version(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    v.get("version")?.as_str().map(String::from)
}

/// A WSL-only install has no Windows engine next to the app: the first installed WSL engine that is present (distro
/// order) becomes the default engine. `present(distro, linux_path)` checks its runner/cli.js.
pub fn fallback_wsl(f: &EnginesFile, present: impl Fn(&str, &str) -> bool) -> Option<(String, String)> {
    f.wsl.iter().find(|(d, e)| present(d, &e.path)).map(|(d, e)| (d.clone(), e.path.trim_end_matches('/').to_string()))
}
/// Where the setup unpacks version `v` (§3a); engines.json records this path rather than the `engine` symlink.
pub fn versioned_path(home: &str, version: &str) -> String {
    format!("{}/.local/share/gfx/engine-{version}", home.trim_end_matches('/'))
}
/// The path Linux-side consumers use (commands, terminals, .gfx/engine.json): an installed `.../gfx/engine-<ver>` becomes
/// the stable `.../gfx/engine` symlink, which survives updates (the versioned folder is replaced). Windows reads over
/// \\wsl.localhost keep the versioned path: Windows can't follow WSL symlinks.
pub fn linux_path(path: &str) -> String {
    let p = path.trim_end_matches('/');
    match p.rsplit_once('/') {
        Some((dir, last)) if dir.ends_with("/.local/share/gfx") && last.starts_with("engine-") => format!("{dir}/engine"),
        _ => p.to_string(),
    }
}
/// The Linux home of an installed engine (`<home>/.local/share/gfx/engine` or `.../engine-<version>`), for the default
/// projects folder.
pub fn engine_home(path: &str) -> Option<&str> {
    let p = path.trim_end_matches('/');
    let (dir, last) = p.rsplit_once('/')?;
    if last != "engine" && !last.starts_with("engine-") { return None; }
    dir.strip_suffix("/.local/share/gfx").filter(|h| h.starts_with('/') && h.len() > 1)
}

// WSL setup's protocol and scripts are pure so Windows command execution is a thin adapter.
#[derive(Serialize, Debug, PartialEq)]
pub struct Distro {
    pub name: String,
    pub default: bool,
    pub state: String,
    pub version: u32,
}

pub fn decode_wsl(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.iter().take(80).any(|b| *b == 0) {
        let bytes = bytes.strip_prefix(&[0xff, 0xfe]).unwrap_or(bytes);
        String::from_utf16_lossy(&bytes.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect::<Vec<_>>())
    } else { String::from_utf8_lossy(bytes).trim_start_matches('\u{feff}').to_string() }
}

pub fn parse_distros(bytes: &[u8]) -> Vec<Distro> {
    decode_wsl(bytes).lines().filter_map(|line| {
        let line = line.trim();
        let default = line.starts_with('*');
        let mut fields: Vec<&str> = line.trim_start_matches('*').split_whitespace().collect();
        let version = fields.pop()?.parse::<u32>().ok()?;
        let state = fields.pop()?.to_string();
        let mut name = fields.join(" ");
        let mut state = state;
        // WSL aligns columns with repeated spaces; keep names and localized multi-word states intact.
        let columns: Vec<&str> = line.trim_start_matches('*').trim().split("  ").map(str::trim).filter(|s| !s.is_empty()).collect();
        if columns.len() == 3 { name = columns[0].into(); state = columns[1].into(); }
        if name.is_empty() || name.to_ascii_lowercase().starts_with("docker-desktop") { return None; }
        Some(Distro { name, default, state, version })
    }).collect()
}

pub fn setup_script(version: &str, link_path: bool) -> String {
    let script = format!(r#"set -e; b="$HOME/.local/share/gfx"; v={}; t="$b/engine-$v.tmp"; rm -rf "$t"; mkdir -p "$t";
tar -xz -C "$t"; rm -rf "$b/engine-$v"; mv "$t" "$b/engine-$v"; ln -sfn "engine-$v" "$b/engine"; for o in "$b"/engine-*;
do [ "$o" = "$b/engine-$v" ] || rm -rf "$o"; done; echo "HOME=$HOME""#, crate::sh_quote(version));
    if link_path { format!(r#"{script}; mkdir -p ~/.local/bin && ln -sfn ../share/gfx/engine/bin/gfx ~/.local/bin/gfx;
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) echo 'NOTE=Add ~/.local/bin to your login PATH' ;; esac"#) } else { script }
}

pub fn remove_script() -> &'static str {
    r#"set -e; b="$HOME/.local/share/gfx"; p="$HOME/.local/bin/gfx";
if [ -L "$p" ]; then t=$(readlink -m -- "$p" || true); case "$t" in "$b"/engine/*|"$b"/engine-*/*) rm -f "$p" ;; esac; fi;
rm -rf ~/.local/share/gfx/engine ~/.local/share/gfx/engine-*"#
}

pub const CHECKS_SCRIPT: &str = r#"for c in google-chrome google-chrome-stable chromium chromium-browser git claude codex pi; do p=$(command -v "$c" || true); printf '%s=%s\n' "$c" "$p"; done;
if test -e /dev/dxg; then echo dxg=1; else echo dxg=0; fi;
case ":$PATH:" in *":$HOME/.local/bin:"*) echo path=1 ;; *) echo path=0 ;; esac;
e="$HOME/.local/share/gfx/engine"; if [ -f "$e/runner/cli.js" ]; then n="$e/node/node"; [ -x "$n" ] || n=node; "$n" "$e/runner/cli.js" doctor --json || true; fi"#;

#[derive(Serialize, Debug, Default)]
pub struct Checks {
    pub chrome: bool,
    pub git: bool,
    pub agent: bool,
    pub dxg: bool,
    pub path: bool,
    pub ffmpeg: bool,
    pub doctor: Option<serde_json::Value>,
}

pub fn parse_checks(text: &str) -> Checks {
    let values: BTreeMap<&str, &str> = text.lines().filter_map(|l| l.split_once('=')).collect();
    let has = |k: &str| values.get(k).map(|v| !v.is_empty()).unwrap_or(false);
    let doctor = text.find('{').and_then(|i| serde_json::from_str::<serde_json::Value>(&text[i..]).ok());
    let ffmpeg = doctor.as_ref().and_then(|d| d.get("ffmpeg")).map(|f|
        f.get("version").and_then(|v| v.as_str()).map(|v| !v.is_empty()).unwrap_or(false)
        && f.get("exists").and_then(|v| v.as_bool()) != Some(false)
    ).unwrap_or(false);
    Checks { chrome: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].iter().any(|k| has(k)),
        git: has("git"), agent: ["claude", "codex", "pi"].iter().any(|k| has(k)), dxg: values.get("dxg") == Some(&"1"), path: values.get("path") == Some(&"1"), ffmpeg, doctor }
}

pub fn wsl_script_args(distro: &str, script: &str) -> Vec<String> {
    ["-d", distro, "--exec", "bash", "-lc", script].iter().map(|s| s.to_string()).collect()
}

pub fn path_contains(path: &str, entry: &str) -> bool {
    let key = entry.trim_end_matches('\\').to_lowercase();
    path.split(';').any(|p| p.trim_end_matches('\\').to_lowercase() == key)
}

/// File next to settings.json: present = the user ticked "Add gfx to the Windows PATH".
pub const PATH_MARKER: &str = "windows-path";
/// What `--path-hook` does to the user PATH: Some(add) or None (nothing to do).
pub fn path_hook_plan(mode: &str, wanted: bool, engine_exists: bool, present: bool) -> Option<bool> {
    match mode {
        "uninstall" if present => Some(false),
        "install" if wanted && engine_exists && !present => Some(true),
        _ => None,
    }
}

pub fn edit_path(path: &str, entry: &str, add: bool) -> String {
    if add {
        if path_contains(path, entry) { path.to_string() }
        else if path.is_empty() { entry.to_string() }
        else { format!("{path};{entry}") }
    } else { path.split(';').filter(|p| !path_contains(p, entry)).collect::<Vec<_>>().join(";") }
}

pub fn merge(mut file: EnginesFile, distro: &str, engine: Option<WslInstalled>) -> EnginesFile {
    file.wsl.retain(|d, _| !d.eq_ignore_ascii_case(distro));
    if let Some(engine) = engine { file.wsl.insert(distro.to_string(), engine); }
    file
}

/// Refuse to overwrite corrupt machine state; a setup must preserve other distros.
pub fn save_entry(file: &Path, distro: &str, engine: Option<WslInstalled>) -> Result<(), String> {
    let current = match std::fs::read_to_string(file) {
        Ok(text) => serde_json::from_str::<EnginesFile>(&text).map_err(|e| format!("engines.json: {e}"))?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => EnginesFile::default(),
        Err(e) => return Err(e.to_string()),
    };
    let next = merge(current, distro, engine);
    let text = serde_json::to_string_pretty(&next).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("json.tmp-gfx");
    std::fs::write(&tmp, format!("{text}\n")).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, file).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tolerantly() {
        let f = parse(r#"{"version":1,"wsl":{"Ubuntu":{"path":"/home/k/.local/share/gfx/engine","version":"0.2.0","installed":"2026-10-17T12:00:00.000Z"},
            "Bad":{"path":"relative/engine"},"Up":{"path":"/home/k/../etc"},"":{"path":"/x"}}}"#);
        assert_eq!(f.wsl.len(), 1);
        assert_eq!(installed_wsl(&f, "ubuntu").unwrap().path, "/home/k/.local/share/gfx/engine");
        assert!(installed_wsl(&f, "Debian").is_none());
        assert_eq!(parse("not json"), EnginesFile::default());
        assert_eq!(parse("{}").version, 1);
    }

    #[test]
    fn reads_engine_version() {
        let d = std::env::temp_dir().join(format!("gfx-engver-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("package.json"), r#"{"name":"x","version":"0.3.1"}"#).unwrap();
        assert_eq!(engine_version(&d).as_deref(), Some("0.3.1"));
        std::fs::remove_dir_all(&d).unwrap();
        assert_eq!(engine_version(Path::new("/nonexistent-gfx")), None);
    }
    #[test]
    fn wsl_only_fallback() {
        let f = parse(r#"{"wsl":{"Debian":{"path":"/home/d/.local/share/gfx/engine"},"Ubuntu":{"path":"/home/k/.local/share/gfx/engine/"}}}"#);
        assert_eq!(fallback_wsl(&f, |d, _| d == "Ubuntu"), Some(("Ubuntu".into(), "/home/k/.local/share/gfx/engine".into())));
        assert_eq!(fallback_wsl(&f, |_, _| true).unwrap().0, "Debian", "distro order");
        assert_eq!(fallback_wsl(&f, |_, _| false), None);
        assert_eq!(engine_home("/home/k/.local/share/gfx/engine"), Some("/home/k"));
        assert_eq!(engine_home("/opt/gfx/engine"), None);
        assert_eq!(engine_home("/.local/share/gfx/engine"), None);
        assert_eq!(engine_home("/home/k/.local/share/gfx/engine-0.2.0"), Some("/home/k"));
        assert_eq!(engine_home("/home/k/.local/share/gfx/library"), None);
        assert_eq!(versioned_path("/home/k/", "0.2.0"), "/home/k/.local/share/gfx/engine-0.2.0");
        assert_eq!(linux_path("/home/k/.local/share/gfx/engine-0.2.0"), "/home/k/.local/share/gfx/engine");
        assert_eq!(linux_path("/home/k/gfx/"), "/home/k/gfx", "a dev checkout stays as is");
        assert_eq!(linux_path("/opt/engine-1"), "/opt/engine-1");
    }

    #[test]
    fn distro_encodings() {
        let t = "  NAME STATE VERSION\r\n* Ubuntu Running 2\r\n Debian Stopped 1\n docker-desktop Stopped 2\n docker-desktop-data Stopped 2\n";
        let utf8 = parse_distros(t.as_bytes());
        assert_eq!(utf8.len(), 2);
        assert_eq!(utf8[0], Distro { name: "Ubuntu".into(), default: true, state: "Running".into(), version: 2 });
        assert_eq!(utf8[1].version, 1);
        let localized = parse_distros("* My Distro  Wird ausgeführt  2".as_bytes());
        assert_eq!((&localized[0].name, &localized[0].state), (&"My Distro".to_string(), &"Wird ausgeführt".to_string()));
        let bytes: Vec<u8> = [0xfeffu16].into_iter().chain(t.encode_utf16()).flat_map(u16::to_le_bytes).collect();
        assert_eq!(parse_distros(&bytes), utf8);
        assert_eq!(parse_distros(&bytes[2..]), utf8);
    }
    #[test]
    fn scripts_and_args() {
        let s = setup_script("0.2.0", false);
        assert!(s.contains("v='0.2.0'"));
        assert!(s.find("tar -xz").unwrap() < s.find("ln -sfn").unwrap());
        assert!(!s.contains("/mnt/c"));
        assert!(!s.contains("~/.local/bin"));
        assert!(setup_script("a'b", true).contains(&format!("v={}", crate::sh_quote("a'b"))));
        assert!(setup_script("0.2.0", true).contains("ln -sfn ../share/gfx/engine/bin/gfx"));
        assert!(remove_script().contains("if [ -L"));
        assert!(!remove_script().contains("library"));
        assert_eq!(wsl_script_args("A B", "echo hi")[1], "A B");
    }
    #[test]
    fn user_path_edits() {
        let p = r"C:\Other;%USERPROFILE%\bin;c:\GFX\engine\bin\;C:\gfx\engine\bin-more;;Z:\last";
        let e = r"C:\gfx\engine\bin";
        assert!(path_contains(p, e));
        assert_eq!(edit_path(p, e, true), p);
        assert_eq!(edit_path(p, e, false), r"C:\Other;%USERPROFILE%\bin;C:\gfx\engine\bin-more;;Z:\last");
        assert_eq!(edit_path("", e, true), e);
        assert_eq!(edit_path("A;;B", e, true), format!("A;;B;{e}"));
        assert_eq!(edit_path("A;;B", e, false), "A;;B");
        assert!(path_contains(r"C:\ПОЛЬЗОВАТЕЛЬ\gfx\", r"c:\пользователь\gfx"));
        let long = "x".repeat(40000);
        assert!(edit_path(&long, e, true).starts_with(&long));
    }
    #[test]
    fn path_hook_keeps_the_choice_across_upgrades() {
        // (mode, wanted, engine exists, present) -> edit
        assert_eq!(path_hook_plan("uninstall", true, true, true), Some(false), "uninstall (also an upgrade's) removes it");
        assert_eq!(path_hook_plan("uninstall", false, true, false), None);
        assert_eq!(path_hook_plan("install", true, true, false), Some(true), "the new version adds it back");
        assert_eq!(path_hook_plan("install", false, true, false), None, "never ticked: left alone");
        assert_eq!(path_hook_plan("install", true, false, false), None, "no Windows engine (WSL installer)");
        assert_eq!(path_hook_plan("install", true, true, true), None);
        assert_eq!(path_hook_plan("other", true, true, true), None);
    }
    #[test]
    fn merge_keeps_other_distros() {
        let one = WslInstalled { path: "/one".into(), version: "1".into(), installed: "now".into() };
        let f = merge(merge(EnginesFile::default(), "Ubuntu", Some(one.clone())), "Debian", Some(one.clone()));
        let f = merge(f, "ubuntu", Some(WslInstalled { version: "2".into(), ..one }));
        assert_eq!(f.wsl.len(), 2);
        assert_eq!(f.wsl["Debian"].version, "1");
        assert_eq!(merge(f, "UBUNTU", None).wsl.len(), 1);
    }
    #[test]
    fn writes_merge_without_losing_other_distros() {
        let dir = std::env::temp_dir().join(format!("gfx-engmerge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("engines.json");
        let engine = WslInstalled { path: "/home/a/.local/share/gfx/engine".into(), version: "0.2.0".into(), installed: "now".into() };
        save_entry(&file, "Ubuntu", Some(engine.clone())).unwrap();
        save_entry(&file, "Debian", Some(engine.clone())).unwrap();
        save_entry(&file, "ubuntu", Some(engine)).unwrap();
        assert_eq!(load(&file).wsl.len(), 2);
        save_entry(&file, "UBUNTU", None).unwrap();
        assert_eq!(load(&file).wsl.keys().cloned().collect::<Vec<_>>(), vec!["Debian"]);
        std::fs::write(&file, "broken").unwrap();
        assert!(save_entry(&file, "Ubuntu", None).is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "broken");
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn checks_protocol() {
        let c = parse_checks("google-chrome=/usr/bin/google-chrome\ngit=/bin/git\ncodex=/bin/codex\ndxg=1\npath=0\n{\"ffmpeg\":{\"version\":\"7.0\",\"exists\":true}}");
        assert!(c.chrome && c.git && c.agent && c.dxg && c.ffmpeg);
        assert!(!c.path);
        assert!(!parse_checks("").agent);
    }
}
// Direct Win32 calls avoid adding a registry crate. Strings remain UTF-16 and are never expanded by this editor.
#[cfg(windows)]
pub fn user_path(edit: Option<(&str, bool)>) -> Result<String, String> {
    use std::ffi::c_void;
    type Hkey = *mut c_void;
    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(key: Hkey, sub: *const u16, options: u32, access: u32, result: *mut Hkey) -> i32;
        fn RegCreateKeyExW(key: Hkey, sub: *const u16, reserved: u32, class: *mut u16, options: u32, access: u32, security: *const c_void, result: *mut Hkey, disposition: *mut u32) -> i32;
        fn RegQueryValueExW(key: Hkey, name: *const u16, reserved: *mut u32, kind: *mut u32, data: *mut u8, size: *mut u32) -> i32;
        fn RegSetValueExW(key: Hkey, name: *const u16, reserved: u32, kind: u32, data: *const u8, size: u32) -> i32;
        fn RegCloseKey(key: Hkey) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SendMessageTimeoutW(window: *mut c_void, msg: u32, wparam: usize, lparam: isize, flags: u32, timeout: u32, result: *mut usize) -> isize;
    }
    fn wide(s: &str) -> Vec<u16> { s.encode_utf16().chain(Some(0)).collect() }
    struct Key(Hkey);
    impl Drop for Key { fn drop(&mut self) { unsafe { RegCloseKey(self.0); } } }
    unsafe {
        let mut key = std::ptr::null_mut();
        let access = if edit.is_some() { 0x0001 | 0x0002 } else { 0x0001 };
        let hkcu = 0x80000001u32 as i32 as isize as Hkey;
        let environment_key = wide("Environment");
        let rc = if edit.is_some() {
            RegCreateKeyExW(hkcu, environment_key.as_ptr(), 0, std::ptr::null_mut(), 0, access, std::ptr::null(), &mut key, std::ptr::null_mut())
        } else { RegOpenKeyExW(hkcu, environment_key.as_ptr(), 0, access, &mut key) };
        if rc == 2 && edit.is_none() { return Ok(String::new()); }
        if rc != 0 { return Err(format!("HKCU Environment: Windows error {rc}")); }
        let key = Key(key);
        let name = wide("Path");
        let mut size = 0u32;
        let mut kind = 0u32;
        let rc = RegQueryValueExW(key.0, name.as_ptr(), std::ptr::null_mut(), &mut kind, std::ptr::null_mut(), &mut size);
        let mut value = String::new();
        if rc != 2 {
            if rc != 0 || (kind != 1 && kind != 2) { return Err(format!("Read user PATH: Windows error {rc}, type {kind}")); }
            let mut data = vec![0u16; (size as usize + 1) / 2 + 1];
            let rc = RegQueryValueExW(key.0, name.as_ptr(), std::ptr::null_mut(), &mut kind, data.as_mut_ptr() as *mut u8, &mut size);
            if rc != 0 { return Err(format!("Read user PATH: Windows error {rc}")); }
            data.truncate(size as usize / 2);
            while data.last() == Some(&0) { data.pop(); }
            value = String::from_utf16(&data).map_err(|e| e.to_string())?;
        }
        if let Some((entry, add)) = edit {
            let next = edit_path(&value, entry, add);
            let data = wide(&next);
            // keep the value's type (REG_SZ 1 / REG_EXPAND_SZ 2); a new value is REG_EXPAND_SZ like Windows' own
            let write_kind = if kind == 1 || kind == 2 { kind } else { 2 };
            let rc = RegSetValueExW(key.0, name.as_ptr(), 0, write_kind, data.as_ptr() as *const u8, (data.len() * 2) as u32);
            if rc != 0 { return Err(format!("Write user PATH: Windows error {rc}")); }
            let environment = wide("Environment");
            SendMessageTimeoutW(0xffffusize as *mut c_void, 0x001a, 0, environment.as_ptr() as isize, 0x0002, 2000, std::ptr::null_mut());
            value = next;
        }
        Ok(value)
    }
}
#[cfg(not(windows))]
pub fn user_path(_edit: Option<(&str, bool)>) -> Result<String, String> { Ok(String::new()) }
