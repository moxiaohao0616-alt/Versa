//! Native menu bar definition.
//!
//! Menu items that map to existing in-app actions emit a single
//! `versa:menu` event with the item id; the React app has one listener
//! that dispatches. URL-opening items (View on GitHub, Report Issue) are
//! handled directly in Rust via the shell plugin — no point round-tripping
//! through the webview just to call `Shell.open`.
//!
//! Accelerators are intentionally NOT set here: the JS keydown handler in
//! App.tsx already owns ⌘F / ⌘` / ⌘W etc., and adding native accelerators
//! would either double-fire or steal focus depending on platform. The
//! cheatsheet (`?`) is the canonical source of truth for keyboard hints.
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    // App menu — macOS shows this as the bold "Versa" entry. On
    // Windows/Linux it folds into the first submenu visually.
    let app_menu = SubmenuBuilder::new(app, "Versa")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Versa"),
            Some(AboutMetadata::default()),
        )?)
        .separator()
        .item(&MenuItem::with_id(app, "open_settings", "Settings…", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "check_updates", "Check for Updates", true, None::<&str>)?)
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&MenuItem::with_id(app, "open_repo", "Open Repository…", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "close_tab", "Close Tab", true, None::<&str>)?)
        .build()?;

    // Edit menu — system clipboard / undo / redo items so common text
    // shortcuts (⌘A / ⌘C / ⌘V) work as users expect inside <input> /
    // <textarea> / contenteditable regions.
    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItem::with_id(app, "view_changes", "Code Changes", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "view_history", "Commit History", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "view_branches", "Branch Manager", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "toggle_terminal", "Toggle Terminal", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "toggle_right_sidebar", "Toggle Right Sidebar", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "next_tab", "Next Tab", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "prev_tab", "Previous Tab", true, None::<&str>)?)
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(app, "open_cheatsheet", "Keyboard Shortcuts", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "open_about", "About Versa", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "open_github", "View Versa on GitHub", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "report_issue", "Report an Issue", true, None::<&str>)?)
        .build()?;

    let menu = Menu::with_items(
        app,
        &[&app_menu, &file_menu, &edit_menu, &view_menu, &window_menu, &help_menu],
    )?;

    Ok(menu)
}

/// Handle a click on a menu item. Items that need UI state changes are
/// forwarded to the React app as a `versa:menu` event; URL-opening items
/// are handled here so the frontend doesn't need to pull in the shell
/// plugin just for two static links.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "open_github" => {
            open_url(app, "https://github.com/moxiaohao0616-alt/Versa");
        }
        "report_issue" => {
            open_url(app, "https://github.com/moxiaohao0616-alt/Versa/issues/new");
        }
        other => {
            // Emit to every webview window explicitly. `app.emit` should
            // do the same but some Tauri 2 transports route through a
            // different channel that the JS `listen` doesn't pick up;
            // walking the windows is unambiguous.
            for (_label, win) in app.webview_windows() {
                let _ = win.emit("versa:menu", other.to_string());
            }
        }
    }
}

fn open_url<R: Runtime>(app: &AppHandle<R>, url: &str) {
    use tauri_plugin_shell::ShellExt;
    let _ = app.shell().open(url, None);
}
