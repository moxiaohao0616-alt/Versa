mod commands;
mod watcher;

use commands::*;
use watcher::WatcherRegistry;

#[tauri::command]
fn start_watching(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatcherRegistry>,
    path: String,
) -> Result<(), String> {
    watcher::start(app, &state, path)
}

#[tauri::command]
fn stop_watching(
    state: tauri::State<'_, WatcherRegistry>,
    path: String,
) -> Result<(), String> {
    watcher::stop(&state, &path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(WatcherRegistry::default())
        .invoke_handler(tauri::generate_handler![
            open_repo, save_progress, get_diff, get_history,
            create_branch, switch_branch, stage_file, unstage_file, discard_file,
            get_branches, run_shell, git_push, git_pull, git_clone,
            get_graph, checkout_commit, get_commit_files,
            get_conflicts, get_conflict_content, resolve_conflict,
            abort_merge, continue_merge,
            ai_generate_commit_message, ai_resolve_conflict, ai_explain_commit,
            cancel_ai_stream,
            run_rebase, abort_rebase, continue_rebase,
            revert_commit, continue_revert, abort_revert,
            cherry_pick_commit, continue_cherry_pick, abort_cherry_pick,
            bisect_status, bisect_start, bisect_mark, bisect_reset,
            ai_suggest_bisect_good,
            prepare_commit_message,
            list_stashes, create_stash, apply_stash, pop_stash, drop_stash,
            detect_project,
            list_branches, checkout_remote_branch,
            rename_branch, delete_branch, delete_remote_branch,
            analyze_merge, ai_analyze_merge_risk, ai_analyze_file_conflict, merge_branch,
            find_commit_by_prefix, find_commit_depth,
            start_watching, stop_watching,
            // Round 1: refs + remotes
            reset_to_commit, git_fetch,
            list_remotes, add_remote, remove_remote, rename_remote, set_remote_url,
            list_tags, create_tag, delete_tag, push_tag, delete_remote_tag,
            // Round 2: reflog + GPG-aware commit
            list_reflog, restore_to_reflog, save_progress_signed,
            // Round 3: hunk staging + blame
            stage_hunk, unstage_hunk, blame_file,
            // Submodules
            list_submodules, add_submodule, init_submodule, update_submodule,
            sync_submodule, deinit_submodule, remove_submodule,
            // Git LFS
            lfs_check, lfs_list_patterns, lfs_track, lfs_untrack,
            lfs_ls_files, lfs_pull, lfs_fetch,
            // Diagnostics (About modal)
            get_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Versa");
}
