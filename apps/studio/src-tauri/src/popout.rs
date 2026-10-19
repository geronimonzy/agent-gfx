// Pop-out windows for the dockable layout (docs/LAYOUT.md §5). Dockview opens `./popout.html` with window.open and moves
// panel elements into it (same JS realm). In WebView2 that only works when the main window is built here (tauri.conf.json
// has "create": false) with a new-window handler that returns a Tauri window (`NewWindowResponse::Create`); `Allow`
// (WebView2's own popup) hangs dockview. Only our own popout.html may open a window; everything else is refused.
// Tauri's OS drag-drop handler is off on every window ("dragDropEnabled": false for main): on Windows it swallows HTML5
// drag-and-drop, so dockview panel drags (and file drops on comments) showed the "not allowed" cursor.
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{webview::NewWindowResponse, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

static POPUPS: AtomicUsize = AtomicUsize::new(0);
const PREFIX: &str = "popout-";

/// The app's own origin (tauri://localhost, http(s)://tauri.localhost) and the path /popout.html (query / hash allowed).
pub fn is_popout_url(url: &str) -> bool {
    let Some((scheme, rest)) = url.split_once("://") else { return false };
    let (authority, path) = match rest.find('/') { Some(i) => (&rest[..i], &rest[i..]), None => (rest, "/") };
    let own = match scheme {
        "tauri" => authority == "localhost",
        "http" | "https" => authority == "tauri.localhost",
        _ => false,
    };
    let path = path.split(['?', '#']).next().unwrap_or("");
    own && path == "/popout.html"
}

/// Build the main window from tauri.conf.json (label "main", "create": false) with the pop-out handler. Called in setup()
/// (On start = Reopen last project) or on demand from the welcome window (welcome.rs); one main window at a time.
pub fn build_main<R: Runtime, M: Manager<R>>(app: &M) -> tauri::Result<()> {
    if let Some(w) = app.get_window("main") { let _ = w.set_focus(); return Ok(()); }
    let cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned().expect("tauri.conf.json: no main window");
    let h = app.app_handle().clone();
    WebviewWindowBuilder::from_config(app, &cfg)?
        .on_new_window(move |url, features| {
            if !is_popout_url(url.as_str()) {
                return NewWindowResponse::Deny;
            }
            let label = format!("{PREFIX}{}", POPUPS.fetch_add(1, Ordering::SeqCst));
            let b = WebviewWindowBuilder::new(&h, &label, WebviewUrl::External("about:blank".parse().unwrap()))
                .window_features(features)
                .title("gfx studio")
                .min_inner_size(240.0, 160.0)
                .disable_drag_drop_handler()
                .on_document_title_changed(|w, t| { let _ = w.set_title(&t); });
            match b.build() {
                Ok(window) => {
                    // native close (title bar ×) of a pop-out holding the T3 view: keep the view alive in the main window
                    let (h2, l2) = (h.clone(), label.clone());
                    window.on_window_event(move |e| { if let tauri::WindowEvent::CloseRequested { .. } = e { crate::t3::rescue_view(&h2, &l2); } });
                    NewWindowResponse::Create { window }
                }
                Err(e) => { eprintln!("popout window failed: {e}"); NewWindowResponse::Deny }
            }
        })
        .build()?;
    if let Some(w) = app.get_webview_window("main") { crate::welcome::hook_drop(&w); } // New scene: files dropped from Explorer
    Ok(())
}

pub fn is_popout_label(label: &str) -> bool {
    label.starts_with(PREFIX)
}

/// Close every pop-out window (called natively when the main window closes, so they never outlive it).
pub fn close_all<R: Runtime>(app: &AppHandle<R>) {
    // app.windows(), not webview_windows(): a pop-out holding the T3 view has two webviews and is no WebviewWindow
    for (label, w) in app.windows() {
        if is_popout_label(&label) {
            let _ = w.destroy();
        }
    }
}

/// Close a pop-out window by label. window.close() from the opener does not destroy a Tauri-created window.
#[tauri::command]
pub async fn close_popout<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    if !is_popout_label(&label) {
        return Err(format!("not a pop-out window: {label}"));
    }
    let Some(w) = app.get_window(&label) else { return Ok(()) }; // get_window: also a pop-out holding the T3 view
    crate::t3::rescue_view(&app, &label); // the T3 view goes back to the main window (hidden) instead of dying with this one
    w.close().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn popout_labels() {
        assert!(is_popout_label("popout-0"));
        assert!(is_popout_label("popout-12"));
        assert!(!is_popout_label("main"));
        assert!(!is_popout_label("my-popout-1"));
    }
    #[test]
    fn popout_urls() {
        assert!(is_popout_url("http://tauri.localhost/popout.html"));
        assert!(is_popout_url("https://tauri.localhost/popout.html?x=1"));
        assert!(is_popout_url("tauri://localhost/popout.html#a"));
        assert!(!is_popout_url("http://tauri.localhost/index.html"));
        assert!(!is_popout_url("http://tauri.localhost/popout.html.evil"));
        assert!(!is_popout_url("http://tauri.localhost.evil.com/popout.html"));
        assert!(!is_popout_url("http://127.0.0.1:5199/popout.html"));
        assert!(!is_popout_url("https://example.com/popout.html"));
        assert!(!is_popout_url("about:blank"));
        assert!(!is_popout_url("tauri://localhost"));
    }
}
