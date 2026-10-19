#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
fn attach_console() {
    extern "system" {
        fn AttachConsole(pid: u32) -> i32;
    }
    unsafe {
        AttachConsole(0xFFFF_FFFF);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // `--path-hook install|uninstall <app data dir>`: the installer's PATH step (installer/hooks.nsh), no window
    if let (Some("--path-hook"), Some(mode), Some(dir)) = (args.get(1).map(String::as_str), args.get(2), args.get(3)) {
        std::process::exit(gfx_studio_lib::path_hook(mode, dir));
    }
    if let Some(i) = args.iter().position(|a| a == "--selftest") {
        #[cfg(windows)]
        attach_console();
        let out = gfx_studio_lib::selftest();
        println!("{}", out);
        // optional: `--selftest <file>` also writes the JSON there
        if let Some(p) = args.get(i + 1) {
            let _ = std::fs::write(p, &out);
        }
        return;
    }
    gfx_studio_lib::run()
}
