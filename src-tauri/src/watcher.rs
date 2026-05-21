use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};

/// Tauri-managed state: one watcher per open repo path.
/// In practice we only watch the **active tab's** path to avoid hammering
/// inactive repos; inactive tabs get refreshed on switch via `open_repo`.
#[derive(Default)]
pub struct WatcherRegistry {
    watchers: Mutex<HashMap<String, RecommendedWatcher>>,
}

/// Start watching `path` recursively. Idempotent.
pub fn start(app: AppHandle, registry: &WatcherRegistry, path: String) -> Result<(), String> {
    let mut watchers = registry.watchers.lock().map_err(|e| e.to_string())?;
    if watchers.contains_key(&path) {
        return Ok(());
    }

    let emit_path = path.clone();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(
        move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };

            // Only care about content-affecting kinds. Skip Access/Other.
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_) => {}
                _ => return,
            }

            // If every path in the event is noise, drop it. Common case: a
            // `git commit` writes many objects under `.git/objects/` — we
            // don't want to refresh for each one.
            if event.paths.iter().all(|p| is_ignored_path(p.as_path())) {
                return;
            }

            let _ = app.emit("repo:changed", &emit_path);
        },
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    watchers.insert(path, watcher);
    Ok(())
}

/// Stop watching `path`. Dropping the watcher unsubscribes natively.
pub fn stop(registry: &WatcherRegistry, path: &str) -> Result<(), String> {
    let mut watchers = registry.watchers.lock().map_err(|e| e.to_string())?;
    watchers.remove(path);
    Ok(())
}

fn is_ignored_path(p: &Path) -> bool {
    let s = p.to_string_lossy();
    s.contains("/.git/objects/")
        || s.contains("/.git/logs/")
        || s.contains("/.git/info/")
        || s.contains("/.git/lfs/")
        // CRITICAL: every `git status` (and especially `git status` with
        // submodules) refreshes the index's stat cache and rewrites
        // `.git/index`. Without this filter, our own refresh writes the
        // index → watcher fires "repo:changed" → triggers another
        // refreshRepo → write index again → infinite loop. Same story
        // for `.git/index.lock` (briefly created during the write) and
        // FETCH_HEAD / packed-refs / ORIG_HEAD which git/libgit2 may
        // touch during read-only-looking operations.
        || s.contains("/.git/index")
        || s.contains("/.git/HEAD")
        || s.contains("/.git/FETCH_HEAD")
        || s.contains("/.git/ORIG_HEAD")
        || s.contains("/.git/packed-refs")
        || s.contains("/.git/modules/") // submodule git-dirs — same issue, nested
        || s.contains("/node_modules/")
        || s.contains("/target/")
        || s.contains("/.next/")
        || s.contains("/dist/")
        || s.contains("/build/")
        || s.contains("/.DS_Store")
        || s.ends_with(".swp")
        || s.ends_with("~")
}
