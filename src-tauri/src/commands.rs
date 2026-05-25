use std::cell::RefCell;
use git2::{Repository, StatusOptions};
use serde::{Deserialize, Serialize};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct RepoStatus {
    pub path: String,
    pub branch: String,
    pub files: Vec<ChangedFile>,
    pub ahead: usize,
    pub behind: usize,
    /// "clean" | "merging" | "rebasing" | "cherry-picking" | "reverting" | "bisecting" | "applying"
    pub state: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub staged_status: Option<String>,
    pub unstaged_status: Option<String>,
    /// True when this entry represents a git submodule rather than a
    /// plain file. Used by the frontend to skip submodule entries during
    /// auto-select (their diffs run a full status pass inside the
    /// submodule's working tree — hundreds of ms on a 100k-file repo).
    #[serde(default)]
    pub is_submodule: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub time: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiffResult {
    pub file: String,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiffHunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiffLine {
    pub origin: char,
    pub content: String,
    pub old_lineno: Option<u32>,
    pub new_lineno: Option<u32>,
}

#[tauri::command]
pub fn open_repo(path: String, skip_files: Option<bool>) -> Result<RepoStatus, String> {
    // Try `discover` first — walks UP from `path` looking for a .git/, so
    // a user who picked `myrepo/src/components` still lands on the repo
    // root. Falls back to a friendlier error than libgit2's raw NotFound
    // when even discover comes up empty.
    let repo = match Repository::discover(&path) {
        Ok(r) => r,
        Err(e) if e.code() == git2::ErrorCode::NotFound => {
            return Err(not_a_repo_message(&path, e))
        }
        Err(e) => return Err(fe(e)),
    };
    let resolved = repo
        .workdir()
        .map(|p| p.to_string_lossy().into_owned())
        // Bare repo (no working dir) — uncommon for a GUI but fall back to
        // the user's input rather than failing.
        .unwrap_or(path);
    // Normalize trailing slash so tab keys dedupe consistently.
    let resolved = resolved.trim_end_matches('/').to_string();

    let branch = get_current_branch(&repo);
    // `skip_files=true` is the fast path used when only branch/ahead/behind
    // metadata is needed up front (e.g. the moment a tab/sub-repo is opened).
    // On a monorepo with submodules and ~100k working-tree files, the status
    // enumeration alone can take hundreds of milliseconds; the file list is
    // then fetched separately via `get_changed_files` so the UI can paint
    // the header instantly and stream the list in.
    let files = if skip_files.unwrap_or(false) {
        Vec::new()
    } else {
        get_changed_files(&repo)?
    };
    let (ahead, behind) = get_ahead_behind(&repo).unwrap_or((0, 0));
    let state = repo_state_str(&repo);
    Ok(RepoStatus { path: resolved, branch, files, ahead, behind, state })
}

/// Just the changed-files list for an already-known repo path. Pairs with
/// `open_repo { skip_files: true }` to split the expensive status pass off
/// the critical path of opening a tab.
///
/// `skip_submodule_dirty=true` makes libgit2's status pass use
/// `SubmoduleIgnore::Dirty` — only HEAD-pointer comparison, no recursion
/// into each submodule's working tree. On loom-sized parent repos (8
/// submodules incl. midscene at 120k files) this is the difference
/// between ~200ms and ~20ms. The omitted "submodule WT dirty" entries
/// are reported separately via `get_dirty_submodule_files`.
#[tauri::command]
pub async fn get_changed_files_only(
    path: String,
    skip_submodule_dirty: Option<bool>,
) -> Result<Vec<ChangedFile>, String> {
    // Benchmark on loom (8 submodules, ~100k working-tree files):
    //   libgit2 `repo.statuses({exclude_submodules:true})`:  ~900ms
    //   shell  `git status --ignore-submodules=all`:         ~100ms
    // libgit2 still touches each submodule's working tree even with
    // EXCLUDE_SUBMODULES set — shell git's `--ignore-submodules=all`
    // skips that cleanly. The `--porcelain=v1 -z` output is trivial to
    // parse and avoids quoting headaches. Falls back to libgit2 if the
    // shell git invocation errors for any reason.
    if skip_submodule_dirty.unwrap_or(false) {
        if let Ok(files) = git_status_via_shell(&path).await {
            return Ok(files)
        }
    }
    // Fallback / non-skip path: full libgit2 pass.
    let repo = Repository::open(&path).map_err(fe)?;
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    // Mirror the shell-path's `--untracked-files=all` — list each file
    // inside an untracked directory rather than the directory itself.
    opts.recurse_untracked_dirs(true);
    if skip_submodule_dirty.unwrap_or(false) {
        opts.exclude_submodules(true);
    }
    let statuses = repo.statuses(Some(&mut opts)).map_err(fe)?;
    let files = statuses.iter().map(map_status_entry).collect();
    Ok(files)
}

/// Parse `git status --porcelain=v1 -z --ignore-submodules=all` into
/// our `ChangedFile` shape. `-z` uses NUL terminators so file names
/// with spaces / quotes / non-ASCII bytes pass through verbatim.
async fn git_status_via_shell(cwd: &str) -> Result<Vec<ChangedFile>, String> {
    let out = tokio::process::Command::new("git")
        // `--no-optional-locks` prevents git from refreshing the stat
        // cache (which rewrites `.git/index`) on a read-only-looking
        // status call. Without it, our own status call triggers the
        // watcher → triggers another status call → infinite loop on
        // any repo we're actively watching.
        .args([
            "--no-optional-locks",
            "status",
            "--porcelain=v1",
            "-z",
            "--ignore-submodules=all",
            // `=all` (vs the default `=normal`) reports each file inside an
            // untracked directory individually, instead of collapsing the
            // whole dir into a single `dirname/` entry. The collapsed form
            // confused the sidebar: a directory entry has no extension /
            // last-segment name (split('/').pop() = ''), so the row rendered
            // as an empty-named file. `=all` is also how most git GUIs
            // (VS Code, GitKraken, etc.) behave by default.
            "--untracked-files=all",
        ])
        .current_dir(cwd)
        .output()
        .await
        .map_err(fe)?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let mut files = Vec::new();
    // Porcelain v1 -z entries: XY<space>PATH\0 where XY is two status
    // characters (X=index, Y=worktree). Renames split into two NUL-
    // separated paths but our model only tracks the destination, so we
    // skip the source segment when X or Y == 'R'.
    let bytes = &out.stdout;
    let mut i = 0;
    while i < bytes.len() {
        if i + 3 > bytes.len() { break; }
        let x = bytes[i] as char;
        let y = bytes[i + 1] as char;
        // bytes[i + 2] is the separator space
        i += 3;
        let start = i;
        while i < bytes.len() && bytes[i] != 0 { i += 1; }
        let path_bytes = &bytes[start..i];
        i += 1; // skip NUL
        // Rename: consume the old-path segment too.
        if x == 'R' || y == 'R' {
            while i < bytes.len() && bytes[i] != 0 { i += 1; }
            i += 1;
        }
        let path_str = String::from_utf8_lossy(path_bytes).to_string();
        let staged_status = match x {
            'M' => Some("M".to_string()),
            'A' => Some("A".to_string()),
            'D' => Some("D".to_string()),
            'R' => Some("R".to_string()),
            _   => None,
        };
        let unstaged_status = match y {
            'M' => Some("M".to_string()),
            'D' => Some("D".to_string()),
            'R' => Some("R".to_string()),
            'U' => Some("C".to_string()),
            '?' => Some("?".to_string()),
            _   => None,
        };
        if staged_status.is_some() || unstaged_status.is_some() {
            files.push(ChangedFile {
                path: path_str,
                staged_status,
                unstaged_status,
                is_submodule: false,
            });
        }
    }
    Ok(files)
}

/// Per-submodule dirty-WT check. Returns ChangedFile entries for submodules
/// whose working tree has uncommitted changes. Run AFTER the fast
/// `get_changed_files_only` call so the parent repo's UI doesn't block on
/// these inherently expensive checks (each one runs a full `git status`
/// inside the submodule).
#[tauri::command]
pub fn get_dirty_submodule_files(path: String) -> Result<Vec<ChangedFile>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let subs = repo.submodules().map_err(fe)?;
    let mut out = Vec::new();
    for sub in subs.iter() {
        let Some(name) = sub.name() else { continue };
        let status = repo
            .submodule_status(name, git2::SubmoduleIgnore::None)
            .unwrap_or(git2::SubmoduleStatus::empty());
        let dirty = status.intersects(
            git2::SubmoduleStatus::WD_WD_MODIFIED
                | git2::SubmoduleStatus::WD_INDEX_MODIFIED
                | git2::SubmoduleStatus::WD_UNTRACKED
                | git2::SubmoduleStatus::WD_MODIFIED,
        );
        if dirty {
            out.push(ChangedFile {
                path: sub.path().to_string_lossy().into_owned(),
                staged_status: None,
                unstaged_status: Some("M".to_string()),
                is_submodule: true,
            });
        }
    }
    Ok(out)
}

/// List the submodule names in a repo. Used by the frontend to fan out
/// per-submodule dirty checks in parallel — each one runs as a separate
/// Tokio task so total time is bounded by the slowest single check
/// instead of the sum of all of them.
#[tauri::command]
pub fn list_submodule_names(path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let subs = repo.submodules().map_err(fe)?;
    let names = subs
        .iter()
        .filter_map(|s| s.name().map(|n| n.to_string()))
        .collect();
    Ok(names)
}

/// Check a single submodule's dirty status. Returns Some(ChangedFile) if
/// the submodule's working tree has uncommitted changes, None otherwise.
/// Designed to be invoked N times in parallel from JS to avoid the
/// sequential bottleneck in `get_dirty_submodule_files`.
#[tauri::command]
pub fn check_submodule_dirty(path: String, name: String) -> Result<Option<ChangedFile>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let status = repo
        .submodule_status(&name, git2::SubmoduleIgnore::None)
        .unwrap_or(git2::SubmoduleStatus::empty());
    let dirty = status.intersects(
        git2::SubmoduleStatus::WD_WD_MODIFIED
            | git2::SubmoduleStatus::WD_INDEX_MODIFIED
            | git2::SubmoduleStatus::WD_UNTRACKED
            | git2::SubmoduleStatus::WD_MODIFIED,
    );
    if !dirty {
        return Ok(None);
    }
    let sub = repo.find_submodule(&name).map_err(fe)?;
    Ok(Some(ChangedFile {
        path: sub.path().to_string_lossy().into_owned(),
        staged_status: None,
        unstaged_status: Some("M".to_string()),
        is_submodule: true,
    }))
}

/// Shared mapper used by status iterators.
fn map_status_entry(entry: git2::StatusEntry<'_>) -> ChangedFile {
    let s = entry.status();
    let staged_status = if s.is_index_new() { Some("A".to_string()) }
        else if s.is_index_modified() { Some("M".to_string()) }
        else if s.is_index_deleted() { Some("D".to_string()) }
        else if s.is_index_renamed() { Some("R".to_string()) }
        else { None };
    let unstaged_status = if s.is_wt_new() { Some("?".to_string()) }
        else if s.is_wt_modified() { Some("M".to_string()) }
        else if s.is_wt_deleted() { Some("D".to_string()) }
        else if s.is_wt_renamed() { Some("R".to_string()) }
        else if s.is_conflicted() { Some("C".to_string()) }
        else { None };
    ChangedFile {
        path: entry.path().unwrap_or("").to_string(),
        staged_status,
        unstaged_status,
        is_submodule: false,
    }
}

/// Build a human-friendly error for "not a git repo". If the picked folder
/// contains sub-folders that ARE repos, list them so the user can redirect
/// without guessing. This is the common "I picked the workspace parent
/// instead of an individual project" mistake.
fn not_a_repo_message(path: &str, original: git2::Error) -> String {
    let mut children: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for ent in entries.flatten() {
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            if ent.path().join(".git").exists() {
                if let Some(name) = ent.file_name().to_str() {
                    children.push(name.to_string());
                }
            }
        }
    }
    if children.is_empty() {
        return format!("{}", original);
    }
    children.sort();
    let total = children.len();
    let preview = children.iter().take(5).cloned().collect::<Vec<_>>().join(", ");
    let more = if total > 5 {
        format!(", +{} more", total - 5)
    } else {
        String::new()
    };
    format!(
        "'{}' isn't a git repository — but it contains {} sub-repo{}: {}{}. Pick one of those.",
        path,
        total,
        if total == 1 { "" } else { "s" },
        preview,
        more,
    )
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubRepoInfo {
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceScan {
    /// "single" — exactly one repo found.
    /// "multi" — 2+ repos found (root itself counted if it's a repo).
    /// "empty" — no repos anywhere (root not a repo, no child .git folders).
    pub kind: String,
    /// The folder the user picked (or, if `discover` walked up, the resolved
    /// repo root). Workspace tab keys on this.
    pub root: String,
    /// Whether `root` itself is a git repository. False for an uninitialized
    /// project folder containing vendored sub-repos (the dashboard surfaces
    /// a "Initialize git here" affordance in this case).
    pub root_is_repo: bool,
    /// All repos discovered. If `root_is_repo`, root is the first entry.
    /// Remaining entries are the immediate children of `root` whose paths
    /// contain a `.git` directory, sorted by name.
    pub repos: Vec<SubRepoInfo>,
}

/// Probe a user-picked path. Cheap — no full repo load, just enough to decide
/// what kind of workspace to construct. Handles three real-world shapes:
///   1. Plain repo: path has `.git`, no sub-repos → single
///   2. Monorepo with vendored sub-repos: path has `.git` AND children do → multi
///   3. Workspace parent: path is just a folder containing sub-repos → multi
///   4. Uninitialized project with sub-repos: path has no `.git` but contains
///      sub-repos AND project markers (package.json etc.) → multi, with
///      `root_is_repo=false` so the dashboard can offer git-init
#[tauri::command]
pub fn scan_workspace(path: String) -> Result<WorkspaceScan, String> {
    let (resolved_root, root_is_repo) = match Repository::discover(&path) {
        Ok(repo) => {
            let resolved = repo
                .workdir()
                .map(|p| p.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.clone());
            (resolved.trim_end_matches('/').to_string(), true)
        }
        Err(e) if e.code() == git2::ErrorCode::NotFound => {
            (path.trim_end_matches('/').to_string(), false)
        }
        Err(e) => return Err(fe(e)),
    };

    // Always scan children of the resolved root for nested `.git` directories.
    // This catches: vendored sub-repos in a monorepo, and a non-git project
    // folder that bundles git sub-projects.
    let mut subs: Vec<SubRepoInfo> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&resolved_root) {
        for ent in entries.flatten() {
            let is_dir = ent.file_type().map(|t| t.is_dir()).unwrap_or(false);
            if !is_dir {
                continue;
            }
            let child = ent.path();
            if child.join(".git").exists() {
                if let Some(name) = ent.file_name().to_str() {
                    let p = child
                        .to_string_lossy()
                        .trim_end_matches('/')
                        .to_string();
                    subs.push(SubRepoInfo { path: p, name: name.to_string() });
                }
            }
        }
    }
    subs.sort_by(|a, b| a.name.cmp(&b.name));

    let mut repos: Vec<SubRepoInfo> = Vec::new();
    if root_is_repo {
        let name = resolved_root
            .rsplit('/')
            .find(|s| !s.is_empty())
            .unwrap_or(&resolved_root)
            .to_string();
        repos.push(SubRepoInfo {
            path: resolved_root.clone(),
            name,
        });
    }
    repos.extend(subs);

    let kind = match repos.len() {
        0 => "empty",
        1 => "single",
        _ => "multi",
    };
    Ok(WorkspaceScan {
        kind: kind.into(),
        root: resolved_root,
        root_is_repo,
        repos,
    })
}

/// Embedded default .gitignore template — covers common build outputs and
/// dependency dirs across Node, Rust, Python, Java/Kotlin, Android, iOS,
/// Flutter, Go, C/C++, plus OS-level and editor junk. Without this a fresh
/// `git init` on a real project would otherwise stage `node_modules` /
/// `target` / `Pods` / etc. on the next "Save Progress", which is almost
/// always wrong.
const DEFAULT_GITIGNORE: &str = include_str!("../assets/default-gitignore.txt");

/// `git init` the given path and return its initial repo status. Used by the
/// workspace overview's "Initialize git here" card so the user can adopt an
/// uninitialized project folder without dropping to a terminal.
///
/// Side effect: writes a default `.gitignore` if the folder doesn't already
/// have one. This saves the user from immediately committing node_modules /
/// build outputs on their first save_progress.
#[tauri::command]
pub async fn git_init_repo(path: String) -> Result<RepoStatus, String> {
    // libgit2's init creates `.git/` with the standard layout. Default branch
    // follows the user's `init.defaultBranch` config (or `master`); we don't
    // hard-code one so behaviour matches what `git init` would do at the CLI.
    Repository::init(&path).map_err(fe)?;

    // Drop in a default .gitignore if missing. Don't overwrite the user's
    // existing file — they may have curated it already.
    let gitignore_path = std::path::Path::new(&path).join(".gitignore");
    if !gitignore_path.exists() {
        // Best-effort: failure here doesn't break the init (repo is still
        // usable without a .gitignore). User can re-run or write their own.
        let _ = std::fs::write(&gitignore_path, DEFAULT_GITIGNORE);
    }

    // Reuse open_repo for the status payload so the frontend gets the same
    // shape it sees everywhere else.
    open_repo(path, None)
}

#[tauri::command]
pub async fn save_progress(path: String, message: String) -> Result<String, String> {
    // Route through shell `git` instead of libgit2 because the latter
    // rejects index entries for nested git repos (e.g. an untracked
    // folder with its own .git inside emits paths like
    // 'verticals/verticals-dev-guid/' that libgit2 errors on with
    // "invalid path"). Shell git handles those cases gracefully —
    // treats them as submodules or skips them — which is what the user
    // expects from a "commit everything" button.
    run_git_simple(&["add", "-A"], &path).await?;
    run_git_simple(&["commit", "-m", &message], &path).await?;
    let repo = Repository::open(&path).map_err(fe)?;
    let head = repo.head().map_err(fe)?;
    let oid = head.target().ok_or_else(|| "HEAD has no target".to_string())?;
    Ok(oid.to_string())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileInfo {
    pub path: String,
    pub status: String,
}

#[tauri::command]
pub fn get_commit_files(path: String, id: String) -> Result<Vec<CommitFileInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&id).map_err(fe)?;
    let commit = repo.find_commit(oid).map_err(fe)?;
    let commit_tree = commit.tree().map_err(fe)?;
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), None)
        .map_err(fe)?;
    let results: std::cell::RefCell<Vec<CommitFileInfo>> = std::cell::RefCell::new(Vec::new());
    diff.foreach(
        &mut |delta, _| {
            let path = delta.new_file().path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let status = match delta.status() {
                git2::Delta::Added   => "A",
                git2::Delta::Deleted => "D",
                git2::Delta::Renamed => "R",
                _                    => "M",
            }.to_string();
            results.borrow_mut().push(CommitFileInfo { path, status });
            true
        },
        None, None, None,
    ).map_err(fe)?;
    Ok(results.into_inner())
}

#[tauri::command]
pub fn get_diff(
    path: String,
    file: Option<String>,
    staged: Option<bool>,
    commit_id: Option<String>,
    ignore_whitespace: Option<bool>,
) -> Result<Vec<DiffResult>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut opts = git2::DiffOptions::new();
    if let Some(ref f) = file {
        opts.pathspec(f);
    }
    if ignore_whitespace.unwrap_or(false) {
        // git2 ignores whitespace by setting the diff flag bits. We use the
        // "ignore all whitespace" mode which matches `git diff -w`.
        opts.ignore_whitespace(true);
    }
    let diff = if let Some(ref cid) = commit_id {
        let oid = git2::Oid::from_str(cid).map_err(fe)?;
        let commit = repo.find_commit(oid).map_err(fe)?;
        let commit_tree = commit.tree().map_err(fe)?;
        let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());
        repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&commit_tree), Some(&mut opts))
            .map_err(fe)?
    } else if staged.unwrap_or(false) {
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());
        repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut opts))
            .map_err(fe)?
    } else {
        // Working tree diff — include untracked files (and descend into
        // untracked directories) so brand-new files show up as added in
        // the diff view. Without these flags, libgit2 lists only files it
        // already knows about, so `?` files in the sidebar would open to
        // an empty diff.
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);
        opts.show_untracked_content(true);
        repo.diff_index_to_workdir(None, Some(&mut opts))
            .map_err(fe)?
    };

    let results: RefCell<Vec<DiffResult>> = RefCell::new(Vec::new());

    diff.foreach(
        &mut |delta, _| {
            let file_path = delta.new_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let mut r = results.borrow_mut();
            if r.iter().all(|x| x.file != file_path) {
                r.push(DiffResult { file: file_path, hunks: vec![] });
            }
            true
        },
        None,
        Some(&mut |delta, hunk| {
            let file_path = delta.new_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let header = String::from_utf8_lossy(hunk.header()).to_string();
            let mut r = results.borrow_mut();
            if let Some(result) = r.iter_mut().find(|x| x.file == file_path) {
                result.hunks.push(DiffHunk { header, lines: vec![] });
            }
            true
        }),
        Some(&mut |delta, _hunk, line| {
            let file_path = delta.new_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let content = String::from_utf8_lossy(line.content()).to_string();
            let mut r = results.borrow_mut();
            if let Some(result) = r.iter_mut().find(|x| x.file == file_path) {
                if let Some(hunk) = result.hunks.last_mut() {
                    hunk.lines.push(DiffLine {
                        origin: line.origin(),
                        content,
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
            }
            true
        }),
    ).map_err(fe)?;

    let mut out = results.into_inner();

    // Fallback for untracked directories: libgit2 sometimes reports them as a
    // single directory-shaped delta (path ending in `/`) with zero hunks, and
    // for nested git repos it never descends. When the caller asked about a
    // specific path that resolves to a directory in the workdir AND we have
    // no real content, walk it manually so the user actually sees something.
    let need_fallback = commit_id.is_none() && !staged.unwrap_or(false)
        && file.is_some()
        && out.iter().all(|r| r.hunks.is_empty());
    if need_fallback {
        if let Some(ref f) = file {
            let target = std::path::Path::new(&path).join(f);
            if target.is_dir() {
                out = synthesize_untracked_dir_diff(&path, f, &target)?;
            }
        }
    }

    Ok(out)
}

/// Walk an untracked working-tree directory and synthesize add-only
/// DiffResults for every file inside. Skips embedded git repos (folders
/// containing `.git/`) — they get a single explanatory marker instead.
fn synthesize_untracked_dir_diff(
    repo_root: &str,
    rel_dir: &str,
    abs_dir: &std::path::Path,
) -> Result<Vec<DiffResult>, String> {
    // Embedded git repo? Emit a single marker file with a human-readable note,
    // not a real diff — Versa won't try to commit other repos' contents.
    if abs_dir.join(".git").exists() {
        return Ok(vec![DiffResult {
            file: format!("{} (嵌套的 git 仓库)", rel_dir),
            hunks: vec![DiffHunk {
                header: "@@ embedded repo @@".to_string(),
                lines: vec![
                    DiffLine {
                        origin: '+',
                        content: format!("这是嵌套的 git 仓库（{}/.git 存在）。\n", rel_dir),
                        old_lineno: None,
                        new_lineno: Some(1),
                    },
                    DiffLine {
                        origin: '+',
                        content: "Versa 不会展开它的内容。要让它跟主仓库一起被追踪，把它加为 submodule；\n".to_string(),
                        old_lineno: None,
                        new_lineno: Some(2),
                    },
                    DiffLine {
                        origin: '+',
                        content: "要把它当普通文件夹用，删掉里面的 .git 目录即可。\n".to_string(),
                        old_lineno: None,
                        new_lineno: Some(3),
                    },
                ],
            }],
        }]);
    }

    let mut results: Vec<DiffResult> = Vec::new();
    let mut stack: Vec<std::path::PathBuf> = vec![abs_dir.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let p = entry.path();
            let Ok(meta) = entry.metadata() else { continue };
            // Skip symlinks (avoid loops) and hidden .git directories.
            if meta.file_type().is_symlink() { continue }
            if p.file_name().and_then(|n| n.to_str()) == Some(".git") { continue }
            if meta.is_dir() {
                stack.push(p);
                continue;
            }
            // Best-effort textual read; skip files larger than 1 MiB to keep
            // the UI snappy on dropped binary blobs.
            if meta.len() > 1_048_576 { continue }
            let content = match std::fs::read_to_string(&p) {
                Ok(s) => s,
                Err(_) => continue,   // not UTF-8 → treat as binary, skip
            };
            // Compute path relative to the repo root for display.
            let rel = p.strip_prefix(repo_root).unwrap_or(&p).to_string_lossy().to_string();
            let lines: Vec<DiffLine> = content
                .lines()
                .enumerate()
                .map(|(i, l)| DiffLine {
                    origin: '+',
                    content: format!("{}\n", l),
                    old_lineno: None,
                    new_lineno: Some((i + 1) as u32),
                })
                .collect();
            let header = format!("@@ -0,0 +1,{} @@", lines.len());
            results.push(DiffResult {
                file: rel,
                hunks: vec![DiffHunk { header, lines }],
            });
        }
    }
    // Sort for stable ordering across runs.
    results.sort_by(|a, b| a.file.cmp(&b.file));
    Ok(results)
}

#[tauri::command]
pub fn get_history(path: String, limit: usize) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut revwalk = repo.revwalk().map_err(fe)?;
    revwalk.push_head().map_err(fe)?;
    let commits = revwalk.take(limit)
        .filter_map(|id| id.ok())
        .filter_map(|id| repo.find_commit(id).ok())
        .map(|c| {
            let id = c.id().to_string();
            let short_id = id[..7].to_string();
            CommitInfo {
                id,
                short_id,
                message: c.summary().unwrap_or("").to_string(),
                author: c.author().name().unwrap_or("").to_string(),
                time: c.time().seconds(),
            }
        })
        .collect();
    Ok(commits)
}

/// `git log -- <file>` semantics: walk commits, keep the ones whose tree
/// differs from their parent at the requested pathspec. Most file histories
/// are short; we cap at `limit` to keep the call bounded for hot paths
/// (frequently-touched files in old repos).
#[tauri::command]
pub fn get_file_history(
    path: String,
    file: String,
    limit: usize,
) -> Result<Vec<CommitInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut revwalk = repo.revwalk().map_err(fe)?;
    revwalk.push_head().map_err(fe)?;

    let mut out = Vec::new();
    for id_res in revwalk {
        let id = match id_res {
            Ok(id) => id,
            Err(_) => continue,
        };
        let commit = match repo.find_commit(id) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let tree = match commit.tree() {
            Ok(t) => t,
            Err(_) => continue,
        };
        let parent_tree = if commit.parent_count() > 0 {
            commit.parent(0).ok().and_then(|p| p.tree().ok())
        } else {
            None
        };

        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.pathspec(&file);
        let diff = match repo.diff_tree_to_tree(
            parent_tree.as_ref(),
            Some(&tree),
            Some(&mut diff_opts),
        ) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if diff.deltas().count() > 0 {
            let id_str = commit.id().to_string();
            let short_id = id_str[..7].to_string();
            out.push(CommitInfo {
                id: id_str,
                short_id,
                message: commit.summary().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                time: commit.time().seconds(),
            });
            if out.len() >= limit {
                break;
            }
        }
    }
    Ok(out)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlockHistoryEntry {
    pub id: String,
    pub short_id: String,
    pub author: String,
    pub time: i64,
    pub message: String,
    /// One or more hunks describing how this line range looked at this commit.
    /// Reuses `DiffHunk` so the frontend can render with existing styles.
    pub hunks: Vec<DiffHunk>,
}

/// Line-range history — `git log -L<start>,<end>:<file>`. Tracks the same
/// region of a file backwards through renames and content moves. This is the
/// real answer to "who touched this specific block of code?" — Blame tells
/// you the LATEST author per line; -L tells you the WHOLE history of the
/// range, with the diff of each commit that touched it.
///
/// libgit2 doesn't expose -L, so we shell out to `git` and parse.
#[tauri::command]
pub async fn get_block_history(
    path: String,
    file: String,
    start: u32,
    end: u32,
    limit: usize,
) -> Result<Vec<BlockHistoryEntry>, String> {
    if start < 1 || end < start {
        return Err(format!("行号范围非法：{}-{}", start, end))
    }
    // Custom format: a sentinel line that can't appear in a diff or message,
    // followed by SHA / short / author / unix-time / subject (subject last so
    // it can safely contain pipes — we only split N-1 times).
    let pretty = "VERSA_COMMIT\x1f%H\x1f%h\x1f%an\x1f%at\x1f%s";
    let l_arg = format!("-L{},{}:{}", start, end, file);
    let n_arg = format!("-{}", limit.max(1));
    let raw = run_git_capture(
        &["log", "--no-color", "-n", n_arg.as_str().trim_start_matches('-'),
          l_arg.as_str(),
          &format!("--pretty=tformat:{}", pretty)],
        &path,
    ).await?;

    let mut out: Vec<BlockHistoryEntry> = Vec::new();
    let mut cur: Option<BlockHistoryEntry> = None;
    let mut cur_hunk: Option<DiffHunk> = None;
    // Track running line numbers for the current hunk (for left/right columns).
    let mut old_ln: u32 = 0;
    let mut new_ln: u32 = 0;

    for line in raw.split('\n') {
        if let Some(rest) = line.strip_prefix("VERSA_COMMIT\x1f") {
            // Flush whatever we were building.
            if let Some(mut e) = cur.take() {
                if let Some(h) = cur_hunk.take() { e.hunks.push(h); }
                out.push(e);
            }
            let parts: Vec<&str> = rest.splitn(5, '\x1f').collect();
            if parts.len() == 5 {
                let time = parts[3].parse::<i64>().unwrap_or(0);
                cur = Some(BlockHistoryEntry {
                    id: parts[0].to_string(),
                    short_id: parts[1].to_string(),
                    author: parts[2].to_string(),
                    time,
                    message: parts[4].to_string(),
                    hunks: vec![],
                });
            }
            continue
        }
        // git log -L emits these between commits / per-file; we don't render
        // them as part of a hunk.
        if line.starts_with("diff --git") || line.starts_with("--- ") || line.starts_with("+++ ") {
            if let (Some(e), Some(h)) = (cur.as_mut(), cur_hunk.take()) {
                e.hunks.push(h);
            }
            continue
        }
        if let Some(header) = line.strip_prefix("@@ ") {
            // Flush previous hunk to the current commit.
            if let (Some(e), Some(h)) = (cur.as_mut(), cur_hunk.take()) {
                e.hunks.push(h);
            }
            // Parse "@@ -A,B +C,D @@" (B and D default to 1 if omitted).
            if let Some((old, new)) = parse_hunk_header(header) {
                old_ln = old; new_ln = new;
            }
            cur_hunk = Some(DiffHunk {
                header: format!("@@ {}", header),
                lines: vec![],
            });
            continue
        }
        // Inside a hunk: + / - / ' ' prefix lines
        if cur_hunk.is_some() {
            let (origin, content) = if let Some(rest) = line.strip_prefix('+') {
                ('+', rest.to_string())
            } else if let Some(rest) = line.strip_prefix('-') {
                ('-', rest.to_string())
            } else if let Some(rest) = line.strip_prefix(' ') {
                (' ', rest.to_string())
            } else {
                // Skip unrecognized line (e.g. "\ No newline at end of file")
                continue
            };
            let (ol, nl) = match origin {
                '-' => { let v = old_ln; old_ln += 1; (Some(v), None) }
                '+' => { let v = new_ln; new_ln += 1; (None, Some(v)) }
                _   => {
                    let o = old_ln; let n = new_ln;
                    old_ln += 1; new_ln += 1;
                    (Some(o), Some(n))
                }
            };
            if let Some(h) = cur_hunk.as_mut() {
                h.lines.push(DiffLine {
                    origin,
                    content: format!("{}\n", content),
                    old_lineno: ol,
                    new_lineno: nl,
                });
            }
        }
    }
    if let Some(mut e) = cur.take() {
        if let Some(h) = cur_hunk.take() { e.hunks.push(h); }
        out.push(e);
    }
    Ok(out)
}

/// `@@ -A,B +C,D @@ optional context` → (A, C). B/D default to 1 when omitted.
fn parse_hunk_header(s: &str) -> Option<(u32, u32)> {
    // s starts after "@@ " — e.g. "-20,5 +20,15 @@ fn foo()"
    let s = s.trim_start_matches("@@ ").trim_start();
    let cut = s.find(" @@")?;
    let head = &s[..cut];
    let mut old_n: u32 = 0;
    let mut new_n: u32 = 0;
    for part in head.split_whitespace() {
        if let Some(rest) = part.strip_prefix('-') {
            old_n = rest.split(',').next()?.parse().ok()?;
        } else if let Some(rest) = part.strip_prefix('+') {
            new_n = rest.split(',').next()?.parse().ok()?;
        }
    }
    Some((old_n, new_n))
}

#[tauri::command]
pub fn create_branch(path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let head = repo.head().map_err(fe)?;
    let commit = head.peel_to_commit().map_err(fe)?;
    repo.branch(&name, &commit, false).map_err(fe)?;
    let refname = format!("refs/heads/{}", name);
    repo.set_head(&refname).map_err(fe)?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
        .map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn switch_branch(path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let refname = format!("refs/heads/{}", name);
    repo.set_head(&refname).map_err(fe)?;
    repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
        .map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn stage_file(path: String, file: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut index = repo.index().map_err(fe)?;
    index.add_path(std::path::Path::new(&file)).map_err(fe)?;
    index.write().map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn discard_file(path: String, file: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.path(&file).force();
    repo.checkout_head(Some(&mut checkout)).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub async fn run_shell(
    app: tauri::AppHandle,
    session_id: String,
    cmd: String,
    cwd: String,
) -> Result<i32, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    // Prefer the user's actual login shell so their aliases / PATH from
    // ~/.zshrc / ~/.bashrc are honored. `-i` makes the shell interactive
    // (sources rcfiles); `-c` runs the supplied command then exits.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let mut child = Command::new(&shell)
        .arg("-i")
        .arg("-c")
        .arg(&cmd)
        .current_dir(&cwd)
        // Color env: convince CLI tools (ls, grep, git, fd, eza, …) that
        // they're talking to a real TTY so they emit ANSI colors. xterm
        // renders the escape sequences fine, so this round-trip works
        // even without an actual PTY.
        .env("TERM", "xterm-256color")
        .env("COLORTERM", "truecolor")
        .env("CLICOLOR", "1")
        .env("CLICOLOR_FORCE", "1")
        .env("FORCE_COLOR", "1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(fe)?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app1 = app.clone();
    let sid1 = session_id.clone();
    let h1 = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            app1.emit(&format!("term:out:{}", sid1), line).ok();
        }
    });

    let app2 = app.clone();
    let sid2 = session_id.clone();
    let h2 = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            app2.emit(&format!("term:err:{}", sid2), line).ok();
        }
    });

    let status = child.wait().await.map_err(fe)?;
    let _ = tokio::join!(h1, h2);

    Ok(status.code().unwrap_or(-1))
}

#[tauri::command]
pub fn checkout_commit(path: String, id: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&id).map_err(fe)?;
    let commit = repo.find_commit(oid).map_err(fe)?;
    repo.checkout_tree(
        commit.as_object(),
        Some(git2::build::CheckoutBuilder::default().force()),
    ).map_err(fe)?;
    repo.set_head_detached(oid).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn unstage_file(path: String, file: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    match repo.head().ok().and_then(|h| h.peel_to_commit().ok()) {
        Some(commit) => {
            repo.reset_default(Some(commit.as_object()), [file.as_str()])
                .map_err(fe)?;
        }
        None => {
            let mut index = repo.index().map_err(fe)?;
            index.remove_path(std::path::Path::new(&file))
                .map_err(fe)?;
            index.write().map_err(fe)?;
        }
    }
    Ok(())
}

/// Parsed fields extracted from a single git progress line.
#[derive(Default, Debug, Clone)]
struct GitProgressFrame {
    /// Stage name, e.g. "Counting objects", "Writing objects", "Rebasing".
    stage: Option<String>,
    /// 0–100. Synthesized from N/T for stages that print only the count.
    percent: Option<u32>,
    current: Option<u64>,
    total: Option<u64>,
    /// Verbatim transfer-rate text like "286.00 KiB/s" (only on Writing/Receiving).
    speed: Option<String>,
}

/// Recognize the two shapes git uses for progress:
///   `<stage>: X% (Y/Z)[, N bytes | speed ...]`   ← standard transfer progress
///   `<stage> (Y/Z)`                              ← rebase / cherry-pick style
fn parse_progress(line: &str) -> GitProgressFrame {
    let s = line.strip_prefix("remote:").unwrap_or(line).trim();

    // Form 1: "<stage>: X% (Y/Z) ..."
    if let Some(colon) = s.find(':') {
        let stage = s[..colon].trim();
        let rest = s[colon + 1..].trim();
        if let Some(pct_end) = rest.find('%') {
            if let Ok(percent) = rest[..pct_end].trim().parse::<u32>() {
                let (current, total) = parse_x_over_y(rest);
                let speed = parse_speed(rest);
                return GitProgressFrame {
                    stage: Some(stage.to_string()),
                    percent: Some(percent),
                    current, total, speed,
                };
            }
        }
    }

    // Form 2: "<stage> (Y/Z)" — synthesize percent from the ratio
    if let Some(open) = s.find('(') {
        if let Some(close_rel) = s[open..].find(')') {
            let inside = &s[open + 1..open + close_rel];
            if let Some(slash) = inside.find('/') {
                if let (Ok(cur), Ok(tot)) = (
                    inside[..slash].trim().parse::<u64>(),
                    inside[slash + 1..].trim().parse::<u64>(),
                ) {
                    let stage = s[..open].trim();
                    let percent = (cur * 100).checked_div(tot).map(|v| v as u32);
                    return GitProgressFrame {
                        stage: Some(stage.to_string()),
                        percent,
                        current: Some(cur),
                        total: Some(tot),
                        speed: None,
                    };
                }
            }
        }
    }

    GitProgressFrame::default()
}

fn parse_x_over_y(rest: &str) -> (Option<u64>, Option<u64>) {
    let Some(open) = rest.find('(') else { return (None, None) };
    let Some(close_rel) = rest[open..].find(')') else { return (None, None) };
    let inside = &rest[open + 1..open + close_rel];
    let Some(slash) = inside.find('/') else { return (None, None) };
    let cur = inside[..slash].trim().parse::<u64>().ok();
    // Total may be followed by `, ` or whitespace — split on first non-digit
    let tot = inside[slash + 1..]
        .trim()
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|t| if t.is_empty() { None } else { t.parse::<u64>().ok() });
    (cur, tot)
}

fn parse_speed(rest: &str) -> Option<String> {
    rest.find('|').and_then(|pipe| {
        let after = rest[pipe + 1..].trim();
        let end = after.find(',').unwrap_or(after.len());
        let cleaned = after[..end].trim();
        if cleaned.is_empty() { None } else { Some(cleaned.to_string()) }
    })
}

/// Build the JSON payload for a single progress frame. Centralized so all three
/// pump sites (push/pull/clone via streaming_git, run_rebase, continue_rebase)
/// produce the same shape.
fn progress_payload(phase: &str, line: &str) -> serde_json::Value {
    let p = parse_progress(line);
    serde_json::json!({
        "phase": phase,
        "line": line,
        "stage": p.stage,
        "percent": p.percent,
        "current": p.current,
        "total": p.total,
        "speed": p.speed,
    })
}

/// Spawn `git` as a child, stream its stderr (where progress lives) to the
/// frontend via `git:progress` events, and return a friendly error on failure.
/// One `git:progress` payload per "frame" (split on `\r` or `\n`).
async fn streaming_git(
    phase: &'static str,
    args: &[&str],
    cwd: Option<&str>,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use std::sync::Arc;
    use tokio::io::AsyncReadExt;
    use tokio::sync::Mutex as AsyncMutex;

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args);
    if let Some(d) = cwd { cmd.current_dir(d); }
    cmd.stdout(std::process::Stdio::null())
       .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(fe)?;
    let mut stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    // Keep last 8 lines for the final error message
    let tail: Arc<AsyncMutex<VecDeque<String>>> = Arc::new(AsyncMutex::new(VecDeque::with_capacity(8)));
    let tail_t = tail.clone();
    let app_t = app.clone();

    let pump = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        let mut acc: Vec<u8> = Vec::new();
        loop {
            let n = match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            acc.extend_from_slice(&buf[..n]);
            // Git progress overwrites the same line with `\r`; split on either
            // `\r` or `\n` so every step emits its own event.
            while let Some(i) = acc.iter().position(|&b| b == b'\r' || b == b'\n') {
                let frame: Vec<u8> = acc.drain(..=i).collect();
                let body = &frame[..frame.len() - 1];
                let s = String::from_utf8_lossy(body).trim().to_string();
                if s.is_empty() { continue; }
                {
                    let mut q = tail_t.lock().await;
                    if q.len() == 8 { q.pop_front(); }
                    q.push_back(s.clone());
                }
                let _ = app_t.emit("git:progress", progress_payload(phase, &s));
            }
        }
    });

    let status = child.wait().await.map_err(fe)?;
    let _ = pump.await;

    let _ = app.emit("git:progress", serde_json::json!({
        "phase": phase, "done": true, "success": status.success(),
    }));

    if status.success() {
        Ok(())
    } else {
        let q = tail.lock().await;
        let err = q.iter().cloned().collect::<Vec<_>>().join("\n");
        Err(friendly_error(if err.is_empty() { "git 命令执行失败" } else { &err }))
    }
}

#[tauri::command]
pub async fn git_push(
    app: tauri::AppHandle,
    path: String,
    branch: String,
) -> Result<(), String> {
    streaming_git(
        "push",
        &["push", "--progress", "origin", &branch],
        Some(&path),
        &app,
    ).await
}

#[tauri::command]
pub async fn git_pull(app: tauri::AppHandle, path: String) -> Result<(), String> {
    streaming_git("pull", &["pull", "--progress"], Some(&path), &app).await
}

#[tauri::command]
pub async fn git_clone(
    app: tauri::AppHandle,
    url: String,
    dest: String,
) -> Result<String, String> {
    streaming_git("clone", &["clone", "--progress", &url, &dest], None, &app).await?;
    Ok(dest)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RebasePlanEntry {
    pub sha: String,
    /// "pick" | "fixup" | "drop"
    pub action: String,
    pub message: String,
}

/// Run an interactive rebase using a pre-baked todo file. The plan is applied
/// non-interactively by exporting `GIT_SEQUENCE_EDITOR=cp <our-todo>` so git's
/// editor step just copies our todo over the target. `GIT_EDITOR=true` skips
/// any commit-message editor prompts (safe because we only allow pick/fixup —
/// neither needs message editing).
#[tauri::command]
pub async fn run_rebase(
    app: tauri::AppHandle,
    path: String,
    base_sha: String,
    plan: Vec<RebasePlanEntry>,
    editor_messages: Vec<String>,
) -> Result<(), String> {
    use std::collections::VecDeque;
    use std::sync::Arc;
    use tokio::io::AsyncReadExt;
    use tokio::sync::Mutex as AsyncMutex;

    if plan.is_empty() {
        return Err("没有可执行的 rebase 计划".to_string());
    }

    // Build todo content. Validate as we go. `editor_count` tracks how many
    // editor invocations git will fire — one each for `squash` and `reword`
    // (in plan order). Our queue script feeds them from `editor_messages`.
    let mut todo = String::new();
    let mut first_kept_seen = false;
    let mut editor_count = 0usize;
    for entry in &plan {
        match entry.action.as_str() {
            "drop" => continue,
            "pick" => {
                first_kept_seen = true;
            }
            "reword" => {
                first_kept_seen = true;
                editor_count += 1;
            }
            "fixup" => {
                if !first_kept_seen {
                    return Err("第一行不能是\"合并到上方\"（前面没有可合并的提交）".to_string());
                }
            }
            "squash" => {
                if !first_kept_seen {
                    return Err("第一行不能是\"合并并改信息\"（前面没有可合并的提交）".to_string());
                }
                editor_count += 1;
            }
            other => return Err(format!("不支持的 rebase 动作：{}", other)),
        }
        let short = if entry.sha.len() >= 7 { &entry.sha[..7] } else { &entry.sha };
        todo.push_str(&entry.action);
        todo.push(' ');
        todo.push_str(short);
        todo.push(' ');
        todo.push_str(&entry.message);
        todo.push('\n');
    }
    if todo.trim().is_empty() {
        return Err("rebase 计划是空的（全部 drop 了）".to_string());
    }
    if editor_count != editor_messages.len() {
        return Err(format!(
            "需要 {} 段消息（reword + squash 共计），传了 {} 段",
            editor_count, editor_messages.len()
        ));
    }

    // Generate a nonce. Stage the todo and (if any) squash messages into a
    // dedicated /tmp dir keyed by it; remember the nonce in .git/ so the
    // queue survives across `continue_rebase`.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let msg_dir = format!("/tmp/versa-rebase-{}", nonce);
    std::fs::create_dir_all(&msg_dir).map_err(fe)?;

    let todo_path = format!("{}/todo", msg_dir);
    std::fs::write(&todo_path, &todo).map_err(fe)?;

    for (i, msg) in editor_messages.iter().enumerate() {
        let p = format!("{}/{}.txt", msg_dir, i);
        std::fs::write(&p, msg).map_err(fe)?;
    }

    let nonce_path = std::path::Path::new(&path).join(".git/versa-rebase-nonce");
    std::fs::write(&nonce_path, nonce.to_string()).map_err(fe)?;

    // Git invokes the sequence editor as `sh -c "$GIT_SEQUENCE_EDITOR <todo>"` —
    // so `cp <our-todo>` becomes `cp <our-todo> <git's-todo>`, which is what we want.
    let sequence_editor = format!("cp {}", todo_path);

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(["rebase", "-i", &base_sha])
        .env("GIT_SEQUENCE_EDITOR", sequence_editor)
        .env("VERSA_REBASE_MSG_DIR", &msg_dir)
        .env(
            "GIT_EDITOR",
            // No editor steps needed? Force-accept with `true`. Otherwise hand
            // off to the queue script that pops the next pre-baked message.
            if editor_count == 0 { "true".to_string() } else { QUEUE_EDITOR_SHELL.to_string() },
        )
        .current_dir(&path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(fe)?;
    let mut stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let tail: Arc<AsyncMutex<VecDeque<String>>> =
        Arc::new(AsyncMutex::new(VecDeque::with_capacity(8)));
    let tail_t = tail.clone();
    let app_t = app.clone();

    let pump = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        let mut acc: Vec<u8> = Vec::new();
        loop {
            let n = match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            acc.extend_from_slice(&buf[..n]);
            while let Some(i) = acc.iter().position(|&b| b == b'\r' || b == b'\n') {
                let frame: Vec<u8> = acc.drain(..=i).collect();
                let s = String::from_utf8_lossy(&frame[..frame.len() - 1]).trim().to_string();
                if s.is_empty() { continue; }
                {
                    let mut q = tail_t.lock().await;
                    if q.len() == 8 { q.pop_front(); }
                    q.push_back(s.clone());
                }
                let _ = app_t.emit("git:progress", progress_payload("rebase", &s));
            }
        }
    });

    let status = child.wait().await.map_err(fe)?;
    let _ = pump.await;

    let _ = app.emit("git:progress", serde_json::json!({
        "phase": "rebase", "done": true, "success": status.success(),
    }));

    // If the rebase fully finished, drop the queue. If it paused (conflict),
    // leave it so `continue_rebase` can replay the next squash messages.
    if status.success() && !rebase_in_progress(&path) {
        cleanup_rebase_state(&path);
    }

    if status.success() {
        Ok(())
    } else {
        let q = tail.lock().await;
        let err = q.iter().cloned().collect::<Vec<_>>().join("\n");
        Err(friendly_error(if err.is_empty() { "rebase 失败" } else { &err }))
    }
}

#[tauri::command]
pub async fn abort_rebase(path: String) -> Result<(), String> {
    let out = tokio::process::Command::new("git")
        .args(["rebase", "--abort"])
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;
    // Best-effort cleanup of any squash-message queue from a prior run.
    cleanup_rebase_state(&path);
    if out.status.success() {
        Ok(())
    } else {
        Err(friendly_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// Resume a paused rebase after conflicts were resolved. Re-supplies the
/// squash-message queue if `run_rebase` had stashed one in `.git/`.
#[tauri::command]
pub async fn continue_rebase(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use std::collections::VecDeque;
    use std::sync::Arc;
    use tokio::io::AsyncReadExt;
    use tokio::sync::Mutex as AsyncMutex;

    let mut cmd = tokio::process::Command::new("git");
    cmd.args(["rebase", "--continue"])
        .current_dir(&path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());

    // Re-apply the squash-msg editor if a queue exists from the initial run.
    if let Some(msg_dir) = read_rebase_msg_dir(&path) {
        cmd.env("VERSA_REBASE_MSG_DIR", &msg_dir)
            .env("GIT_EDITOR", QUEUE_EDITOR_SHELL);
    }

    let mut child = cmd.spawn().map_err(fe)?;
    let mut stderr = child.stderr.take().ok_or_else(|| "no stderr".to_string())?;

    let tail: Arc<AsyncMutex<VecDeque<String>>> =
        Arc::new(AsyncMutex::new(VecDeque::with_capacity(8)));
    let tail_t = tail.clone();
    let app_t = app.clone();

    let pump = tokio::spawn(async move {
        let mut buf = [0u8; 4096];
        let mut acc: Vec<u8> = Vec::new();
        loop {
            let n = match stderr.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };
            acc.extend_from_slice(&buf[..n]);
            while let Some(i) = acc.iter().position(|&b| b == b'\r' || b == b'\n') {
                let frame: Vec<u8> = acc.drain(..=i).collect();
                let s = String::from_utf8_lossy(&frame[..frame.len() - 1]).trim().to_string();
                if s.is_empty() { continue; }
                {
                    let mut q = tail_t.lock().await;
                    if q.len() == 8 { q.pop_front(); }
                    q.push_back(s.clone());
                }
                let _ = app_t.emit("git:progress", progress_payload("rebase", &s));
            }
        }
    });

    let status = child.wait().await.map_err(fe)?;
    let _ = pump.await;

    let _ = app.emit("git:progress", serde_json::json!({
        "phase": "rebase", "done": true, "success": status.success(),
    }));

    // If the rebase has fully finished, drop the queue. If it's paused again
    // on another conflict, leave the queue in place for the next continue.
    if status.success() && !rebase_in_progress(&path) {
        cleanup_rebase_state(&path);
    }

    if status.success() {
        Ok(())
    } else {
        let q = tail.lock().await;
        let err = q.iter().cloned().collect::<Vec<_>>().join("\n");
        Err(friendly_error(if err.is_empty() { "继续 rebase 失败" } else { &err }))
    }
}

// ── Revert & cherry-pick ───────────────────────────────────────────────────

/// Run a git subcommand that may pause on conflicts. On non-zero exit we
/// translate stderr; the resulting `RepositoryState` (Revert / CherryPick)
/// is what tells the UI to switch to ConflictView.
async fn run_git_simple(args: &[&str], cwd: &str) -> Result<(), String> {
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(fe)?;
    if out.status.success() {
        Ok(())
    } else {
        // Concat stderr+stdout — `git commit` writes "nothing to commit" to
        // stdout on the exit-code-1 path, so stderr alone would be empty and
        // collapse to "未知错误". Prefer stderr first since it's where git
        // normally surfaces failures.
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let combined = if stderr.is_empty() {
            stdout
        } else if stdout.is_empty() {
            stderr
        } else {
            format!("{stderr}\n{stdout}")
        };
        Err(friendly_error(&combined))
    }
}

/// Run a git subcommand that would normally pop a commit-message editor, but
/// inject a pre-baked message via `GIT_EDITOR=cp <tmp>` — same trick we use for
/// squash/reword in rebase. Conflicts still pause cleanly; on `--continue`, git
/// reuses whatever it stashed during the initial run (our custom message).
async fn run_with_message_editor(
    args: &[&str],
    cwd: &str,
    msg: &str,
) -> Result<(), String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp_path = format!("/tmp/versa-commit-msg-{}.txt", nonce);
    std::fs::write(&tmp_path, msg).map_err(fe)?;
    let editor = format!("cp {}", tmp_path);

    let out = tokio::process::Command::new("git")
        .args(args)
        .env("GIT_EDITOR", editor)
        .current_dir(cwd)
        .output()
        .await
        .map_err(fe)?;

    let _ = std::fs::remove_file(&tmp_path);

    if out.status.success() {
        Ok(())
    } else {
        Err(friendly_error(String::from_utf8_lossy(&out.stderr).trim()))
    }
}

#[tauri::command]
pub async fn revert_commit(
    path: String,
    sha: String,
    message: String,
) -> Result<(), String> {
    // Drop the implicit `--no-edit`: with our injected editor, the user's
    // custom message goes in. If a conflict pauses the revert, git records the
    // prepared message internally — `continue_revert` later commits with it.
    run_with_message_editor(&["revert", &sha], &path, &message).await
}

/// Return the message git would default to for a revert / cherry-pick of the
/// given commit. Frontend uses this to pre-fill the editor textarea.
#[tauri::command]
pub fn prepare_commit_message(
    path: String,
    sha: String,
    operation: String,
) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&sha).map_err(fe)?;
    let commit = repo.find_commit(oid).map_err(fe)?;
    match operation.as_str() {
        "revert" => {
            let subject = commit.summary().unwrap_or("");
            Ok(format!("Revert \"{}\"\n\nThis reverts commit {}.\n", subject, commit.id()))
        }
        "cherry-pick" => {
            // Use the full message; trim trailing newlines so the editor isn't
            // pre-loaded with awkward blank lines at the bottom.
            Ok(commit.message().unwrap_or("").trim_end().to_string())
        }
        other => Err(format!("未知的操作类型：{}", other)),
    }
}

#[tauri::command]
pub async fn continue_revert(path: String) -> Result<(), String> {
    run_git_simple(&["revert", "--continue"], &path).await
}

#[tauri::command]
pub async fn abort_revert(path: String) -> Result<(), String> {
    run_git_simple(&["revert", "--abort"], &path).await
}

#[tauri::command]
pub async fn cherry_pick_commit(
    path: String,
    sha: String,
    message: String,
) -> Result<(), String> {
    // --edit forces git to invoke the editor even though cherry-pick normally
    // preserves the original message; we then hijack the editor with our custom msg.
    run_with_message_editor(&["cherry-pick", "--edit", &sha], &path, &message).await
}

#[tauri::command]
pub async fn continue_cherry_pick(path: String) -> Result<(), String> {
    run_git_simple(&["cherry-pick", "--continue"], &path).await
}

#[tauri::command]
pub async fn abort_cherry_pick(path: String) -> Result<(), String> {
    run_git_simple(&["cherry-pick", "--abort"], &path).await
}

// ── Bisect ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BisectStatus {
    /// "inactive" | "in-progress" | "found"
    pub kind: String,
    /// Currently-checked-out commit during bisect ("in-progress" only).
    pub current_oid: Option<String>,
    pub current_short: Option<String>,
    pub current_subject: Option<String>,
    pub steps_remaining: Option<usize>,
    /// First-bad commit ("found" only).
    pub found_oid: Option<String>,
    pub found_short: Option<String>,
    pub found_subject: Option<String>,
}

/// Parse the stdout/stderr of a `git bisect` invocation into a status struct.
/// Two shapes we care about:
///   "Bisecting: N revisions left to test after this (roughly K steps)"
///   "[<oid>] <subject>"   ← currently-checked-out commit
///   "<oid> is the first bad commit"   ← we've narrowed it down
fn parse_bisect_output(path: &str, stdout: &str, stderr: &str) -> BisectStatus {
    let combined = format!("{}\n{}", stdout, stderr);

    if let Some(line) = combined.lines().find(|l| l.contains("is the first bad commit")) {
        let oid_str = line.split_whitespace().next().unwrap_or("").to_string();
        let short = if oid_str.len() >= 7 { oid_str[..7].to_string() } else { oid_str.clone() };
        let subject = Repository::open(path).ok()
            .and_then(|r| git2::Oid::from_str(&oid_str).ok().and_then(|o| r.find_commit(o).ok().map(|c| c.summary().unwrap_or("").to_string())))
            .filter(|s| !s.is_empty());
        return BisectStatus {
            kind: "found".to_string(),
            found_oid: Some(oid_str),
            found_short: Some(short),
            found_subject: subject,
            ..Default::default()
        };
    }

    let steps = combined.lines().find_map(|l| {
        let pos = l.find("(roughly ")?;
        l[pos + 9..].split_whitespace().next().and_then(|n| n.parse::<usize>().ok())
    });

    let (oid_str, subject) = combined.lines().find_map(|l| {
        let l = l.trim();
        if !l.starts_with('[') { return None }
        let end = l.find(']')?;
        Some((l[1..end].to_string(), l[end + 1..].trim().to_string()))
    }).unwrap_or_default();

    let short = if oid_str.len() >= 7 { Some(oid_str[..7].to_string()) } else { None };
    BisectStatus {
        kind: "in-progress".to_string(),
        current_oid: if oid_str.is_empty() { None } else { Some(oid_str) },
        current_short: short,
        current_subject: if subject.is_empty() { None } else { Some(subject) },
        steps_remaining: steps,
        ..Default::default()
    }
}

#[tauri::command]
pub fn bisect_status(path: String) -> Result<BisectStatus, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    if repo.state() != git2::RepositoryState::Bisect {
        return Ok(BisectStatus { kind: "inactive".to_string(), ..Default::default() });
    }
    // We're in bisect — HEAD is the currently-checked-out test commit.
    let mut out = BisectStatus { kind: "in-progress".to_string(), ..Default::default() };
    if let Ok(head) = repo.head() {
        if let Some(oid) = head.target() {
            let id = oid.to_string();
            out.current_oid = Some(id.clone());
            out.current_short = Some(if id.len() >= 7 { id[..7].to_string() } else { id.clone() });
            if let Ok(c) = repo.find_commit(oid) {
                let subj = c.summary().unwrap_or("").to_string();
                if !subj.is_empty() { out.current_subject = Some(subj); }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn bisect_start(
    path: String,
    good_sha: String,
    bad_sha: Option<String>,
) -> Result<BisectStatus, String> {
    let bad = bad_sha.unwrap_or_else(|| "HEAD".to_string());
    // `git bisect start <bad> <good>` — bad first, then good.
    let out = tokio::process::Command::new("git")
        .args(["bisect", "start", &bad, &good_sha])
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(friendly_error(stderr.trim()));
    }
    Ok(parse_bisect_output(&path, &stdout, &stderr))
}

#[tauri::command]
pub async fn bisect_mark(
    path: String,
    kind: String,
) -> Result<BisectStatus, String> {
    let action = match kind.as_str() {
        "good" => "good",
        "bad"  => "bad",
        "skip" => "skip",
        other  => return Err(format!("不支持的标记: {}", other)),
    };
    let out = tokio::process::Command::new("git")
        .args(["bisect", action])
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    if !out.status.success() {
        return Err(friendly_error(stderr.trim()));
    }
    Ok(parse_bisect_output(&path, &stdout, &stderr))
}

#[tauri::command]
pub async fn bisect_reset(path: String) -> Result<(), String> {
    run_git_simple(&["bisect", "reset"], &path).await
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BisectSuggestion {
    pub sha: String,
    pub short_id: String,
    pub subject: String,
    pub reason: String,
}

const AI_BISECT_SUGGEST_SYSTEM_PROMPT: &str = r#"你是资深工程师。用户最近发现 HEAD 上有个问题，要用 git bisect 二分查找。下面是最近 N 个 commit 列表。

挑一个**最可能仍然没问题**的 commit 作为 "good" 起点。判断准则：
- 距离 HEAD 不要太近（前 5 个内别选）
- 优先距离稍远但又不太远（10-30 个之间通常合适）
- 倾向 refactor / 格式化 / docs 类小改动前后的 commit，那时候逻辑大概率正常
- 避免选标题就显著看着是"重大功能" / "重构" 后的 commit（那 commit 本身可能就是引入者）

必须严格输出 JSON 对象，无任何其他文字或代码块：
{ "sha": "<short SHA from list>", "reason": "1-2 句中文说明为什么挑这个" }

sha 字段填列表里 7 字符 short SHA。"#;

#[tauri::command]
pub async fn ai_suggest_bisect_good(
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    path: String,
) -> Result<BisectSuggestion, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    // Walk the last 50 commits from HEAD.
    let commits: Vec<(String, String, String)> = {
        let repo = Repository::open(&path).map_err(fe)?;
        let mut revwalk = repo.revwalk().map_err(fe)?;
        revwalk.push_head().map_err(fe)?;
        let mut out = Vec::new();
        for (i, id_res) in revwalk.enumerate() {
            if i >= 50 { break }
            let Ok(oid) = id_res else { continue };
            let Ok(c) = repo.find_commit(oid) else { continue };
            let sha = oid.to_string();
            let short = if sha.len() >= 7 { sha[..7].to_string() } else { sha.clone() };
            let subj = c.summary().unwrap_or("").to_string();
            out.push((sha, short, subj));
        }
        out
    };

    if commits.len() < 5 {
        return Err("仓库历史太浅，没法二分查找".to_string());
    }

    let list_text = commits.iter()
        .map(|(_full, short, subj)| format!("{} {}", short, subj))
        .collect::<Vec<_>>()
        .join("\n");

    let user_prompt = format!(
        "最近 {} 个 commit（从新到旧，HEAD 在最上）：\n\n{}\n\n按规定输出 JSON。",
        commits.len(), list_text
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let raw = call_ai(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_BISECT_SUGGEST_SYSTEM_PROMPT, &user_prompt, 256,
    ).await?;

    let v = extract_json_object(&raw).ok_or_else(||
        format!("AI 返回的不是 JSON：{}", trunc(&raw, 200))
    )?;
    let sha_str = v["sha"].as_str().ok_or_else(|| "AI 返回缺少 sha 字段".to_string())?;
    let reason = v["reason"].as_str().unwrap_or("").to_string();

    // Match by prefix — AI might return full or short SHA.
    let needle = sha_str.trim();
    let matched = commits.iter().find(|(full, short, _)| {
        full == needle || short == needle || full.starts_with(needle) || needle.starts_with(short.as_str())
    });
    let Some((full_sha, short, subject)) = matched else {
        return Err(format!("AI 推荐的 SHA「{}」不在最近 50 条历史里", needle));
    };

    Ok(BisectSuggestion {
        sha: full_sha.clone(),
        short_id: short.clone(),
        subject: subject.clone(),
        reason,
    })
}

// ── Stash ──────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StashEntry {
    /// Stash index — `stash@{index}` in git terms. 0 = most recent.
    pub index: usize,
    pub oid: String,
    pub message: String,
    pub time: i64,
}

#[tauri::command]
pub async fn list_stashes(path: String) -> Result<Vec<StashEntry>, String> {
    // %x00 = NUL between fields on each entry line.
    //   %H  full hash       %gd  reflog selector (stash@{N})
    //   %s  subject         %ct  committer time (unix seconds)
    let out = tokio::process::Command::new("git")
        .args(["stash", "list", "--format=%H%x00%gd%x00%s%x00%ct"])
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;
    if !out.status.success() {
        return Err(friendly_error(&String::from_utf8_lossy(&out.stderr)));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<StashEntry> = Vec::new();
    for line in text.lines() {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.splitn(4, '\0').collect();
        if parts.len() != 4 { continue; }
        let oid = parts[0].to_string();
        let index = parts[1]
            .strip_prefix("stash@{")
            .and_then(|s| s.strip_suffix('}'))
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0);
        let message = parts[2].to_string();
        let time = parts[3].trim().parse::<i64>().unwrap_or(0);
        entries.push(StashEntry { index, oid, message, time });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn create_stash(path: String, message: Option<String>) -> Result<(), String> {
    // -u = include untracked files (but not .gitignored — safer for build dirs).
    let mut args: Vec<&str> = vec!["stash", "push", "-u"];
    if let Some(m) = message.as_deref() {
        if !m.trim().is_empty() {
            args.push("-m");
            args.push(m);
        }
    }
    let out = tokio::process::Command::new("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;
    if out.status.success() {
        // git prints "No local changes to save" with exit 0 — detect & surface.
        let stdout = String::from_utf8_lossy(&out.stdout);
        if stdout.contains("No local changes to save") {
            return Err("当前没有改动可以搁置".to_string());
        }
        Ok(())
    } else {
        Err(friendly_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

#[tauri::command]
pub async fn apply_stash(path: String, index: usize) -> Result<(), String> {
    let r = format!("stash@{{{}}}", index);
    run_git_simple(&["stash", "apply", &r], &path).await
}

#[tauri::command]
pub async fn pop_stash(path: String, index: usize) -> Result<(), String> {
    let r = format!("stash@{{{}}}", index);
    run_git_simple(&["stash", "pop", &r], &path).await
}

#[tauri::command]
pub async fn drop_stash(path: String, index: usize) -> Result<(), String> {
    let r = format!("stash@{{{}}}", index);
    run_git_simple(&["stash", "drop", &r], &path).await
}

// ── Project type detection ─────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCommand {
    pub label: String,
    pub command: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    /// "node" | "rust" | "go" | "unknown"
    pub kind: String,
    pub display: String,
    pub icon: String,
    /// "npm" | "yarn" | "pnpm" | "bun" | "cargo" | "go" | ""
    pub package_manager: String,
    pub commands: Vec<ProjectCommand>,
}

#[tauri::command]
pub fn detect_project(path: String) -> Result<ProjectInfo, String> {
    let p = std::path::Path::new(&path);

    // ── Node.js — prefer this for hybrid projects (e.g. Tauri = Cargo.toml + package.json
    //    where the *entry point* is `npm run tauri dev`).
    if p.join("package.json").exists() {
        let pm = if p.join("bun.lockb").exists() || p.join("bun.lock").exists() { "bun" }
            else if p.join("pnpm-lock.yaml").exists() { "pnpm" }
            else if p.join("yarn.lock").exists() { "yarn" }
            else { "npm" };
        let icon = if pm == "bun" { "🍞" }
            else if pm == "pnpm" { "📦" }
            else if pm == "yarn" { "🧶" }
            else { "📦" };

        let mut commands = Vec::new();
        if let Ok(text) = std::fs::read_to_string(p.join("package.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                if let Some(scripts) = v.get("scripts").and_then(|s| s.as_object()) {
                    // Reorder so the conventional names show first.
                    let prefer = ["dev", "start", "build", "test", "lint", "typecheck", "check", "format"];
                    let mut names: Vec<&String> = scripts.keys().collect();
                    names.sort_by_key(|n| {
                        prefer.iter().position(|p| p == &n.as_str()).unwrap_or(usize::MAX)
                    });
                    for name in names.into_iter().take(6) {
                        let cmd = match pm {
                            "yarn" => format!("yarn {}", name),
                            "bun"  => format!("bun run {}", name),
                            other  => format!("{} run {}", other, name),
                        };
                        commands.push(ProjectCommand {
                            label: name.clone(),
                            command: cmd,
                        });
                    }
                }
            }
        }

        return Ok(ProjectInfo {
            kind: "node".into(),
            display: "Node.js".into(),
            icon: icon.into(),
            package_manager: pm.into(),
            commands,
        });
    }

    // ── Rust
    if p.join("Cargo.toml").exists() {
        return Ok(ProjectInfo {
            kind: "rust".into(),
            display: "Rust".into(),
            icon: "🦀".into(),
            package_manager: "cargo".into(),
            commands: vec![
                ProjectCommand { label: "run".into(),   command: "cargo run".into() },
                ProjectCommand { label: "build".into(), command: "cargo build".into() },
                ProjectCommand { label: "test".into(),  command: "cargo test".into() },
                ProjectCommand { label: "check".into(), command: "cargo check".into() },
            ],
        });
    }

    // ── Go
    if p.join("go.mod").exists() {
        return Ok(ProjectInfo {
            kind: "go".into(),
            display: "Go".into(),
            icon: "🐹".into(),
            package_manager: "go".into(),
            commands: vec![
                ProjectCommand { label: "run".into(),   command: "go run .".into() },
                ProjectCommand { label: "build".into(), command: "go build ./...".into() },
                ProjectCommand { label: "test".into(),  command: "go test ./...".into() },
            ],
        });
    }

    Ok(ProjectInfo {
        kind: "unknown".into(),
        display: "".into(),
        icon: "".into(),
        package_manager: "".into(),
        commands: vec![],
    })
}

/// Inline `sh -c '...'` that pops the next squash message from the queue dir
/// and writes it into the editor's target file. Used as `GIT_EDITOR`.
///
/// Layout under `$VERSA_REBASE_MSG_DIR`:
///   counter   — text file holding the next index to consume (starts at 0)
///   0.txt, 1.txt, … — one file per squash entry, in plan order
const QUEUE_EDITOR_SHELL: &str = r#"sh -c 'DIR="$VERSA_REBASE_MSG_DIR"; C="$DIR/counter"; N=$(cat "$C" 2>/dev/null || echo 0); F="$DIR/${N}.txt"; [ -f "$F" ] && cat "$F" > "$1"; echo $((N + 1)) > "$C"' --"#;

fn read_rebase_msg_dir(repo_path: &str) -> Option<String> {
    let nonce_path = std::path::Path::new(repo_path).join(".git/versa-rebase-nonce");
    let nonce = std::fs::read_to_string(&nonce_path).ok()?;
    let nonce = nonce.trim();
    if nonce.is_empty() { return None; }
    let dir = format!("/tmp/versa-rebase-{}", nonce);
    if std::path::Path::new(&dir).is_dir() { Some(dir) } else { None }
}

fn rebase_in_progress(repo_path: &str) -> bool {
    let p = std::path::Path::new(repo_path);
    p.join(".git/rebase-merge").is_dir() || p.join(".git/rebase-apply").is_dir()
}

fn cleanup_rebase_state(repo_path: &str) {
    if let Some(dir) = read_rebase_msg_dir(repo_path) {
        let _ = std::fs::remove_dir_all(&dir);
    }
    let nonce_path = std::path::Path::new(repo_path).join(".git/versa-rebase-nonce");
    let _ = std::fs::remove_file(&nonce_path);
}

#[tauri::command]
pub fn get_branches(path: String) -> Result<Vec<String>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let branches = repo.branches(Some(git2::BranchType::Local))
        .map_err(fe)?;
    let names = branches
        .filter_map(|b| b.ok())
        .filter_map(|(b, _)| b.name().ok().flatten().map(|s| s.to_string()))
        .collect();
    Ok(names)
}

// ── Rich branch listing for BranchesView ───────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
    /// Upstream ref (e.g. "origin/main") if the local branch tracks one.
    pub upstream: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub last_oid: String,
    pub last_short: String,
    pub last_subject: String,
    pub last_time: i64,
}

fn tip_info(repo: &Repository, oid: Option<git2::Oid>) -> (String, String, String, i64) {
    let Some(oid) = oid else { return (String::new(), String::new(), String::new(), 0) };
    match repo.find_commit(oid) {
        Ok(c) => {
            let id = c.id().to_string();
            let short = id[..7.min(id.len())].to_string();
            (id, short, c.summary().unwrap_or("").to_string(), c.time().seconds())
        }
        Err(_) => (String::new(), String::new(), String::new(), 0),
    }
}

#[tauri::command]
pub fn list_branches(path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut out: Vec<BranchInfo> = Vec::new();

    // Local
    if let Ok(iter) = repo.branches(Some(git2::BranchType::Local)) {
        for entry in iter.flatten() {
            let (branch, _) = entry;
            let Some(name) = branch.name().ok().flatten().map(|s| s.to_string()) else { continue };
            let oid = branch.get().target();
            let (last_oid, last_short, last_subject, last_time) = tip_info(&repo, oid);

            let (upstream, ahead, behind) = match branch.upstream() {
                Ok(up) => {
                    let upname = up.name().ok().flatten().map(|s| s.to_string());
                    let counts = match (oid, up.get().target()) {
                        (Some(l), Some(r)) => repo.graph_ahead_behind(l, r).unwrap_or((0, 0)),
                        _ => (0, 0),
                    };
                    (upname, counts.0, counts.1)
                }
                Err(_) => (None, 0, 0),
            };

            out.push(BranchInfo {
                name,
                is_remote: false,
                is_current: branch.is_head(),
                upstream,
                ahead, behind,
                last_oid, last_short, last_subject, last_time,
            });
        }
    }

    // Remote (skip the "origin/HEAD" pseudo-ref)
    if let Ok(iter) = repo.branches(Some(git2::BranchType::Remote)) {
        for entry in iter.flatten() {
            let (branch, _) = entry;
            let Some(name) = branch.name().ok().flatten().map(|s| s.to_string()) else { continue };
            if name.ends_with("/HEAD") { continue; }
            let oid = branch.get().target();
            let (last_oid, last_short, last_subject, last_time) = tip_info(&repo, oid);
            out.push(BranchInfo {
                name,
                is_remote: true,
                is_current: false,
                upstream: None,
                ahead: 0, behind: 0,
                last_oid, last_short, last_subject, last_time,
            });
        }
    }

    // Sort: current first, then by last_time desc; remotes also by last_time desc.
    out.sort_by(|a, b| {
        // Group locals (false) before remotes (true)
        a.is_remote.cmp(&b.is_remote)
            // Current branch first within locals
            .then_with(|| b.is_current.cmp(&a.is_current))
            // Then by tip time, newest first
            .then_with(|| b.last_time.cmp(&a.last_time))
    });
    Ok(out)
}

/// Switch to a remote-tracking branch. If a local branch with the same short
/// name already exists, just switch to it (preserves any local divergence);
/// otherwise create + track in one shot.
#[tauri::command]
pub async fn checkout_remote_branch(path: String, full_name: String) -> Result<(), String> {
    // "origin/feat-x" → local "feat-x". Handles names like "origin/release/1.0".
    let local: String = full_name
        .split_once('/')
        .map(|x| x.1)
        .unwrap_or("")
        .to_string();
    if local.is_empty() {
        return Err("远程分支名格式异常".to_string());
    }
    let repo = Repository::open(&path).map_err(fe)?;
    let exists = repo.find_branch(&local, git2::BranchType::Local).is_ok();
    drop(repo);
    if exists {
        run_git_simple(&["switch", &local], &path).await
    } else {
        run_git_simple(&["switch", "-c", &local, "--track", &full_name], &path).await
    }
}

#[tauri::command]
pub fn rename_branch(
    path: String,
    old_name: String,
    new_name: String,
) -> Result<(), String> {
    if new_name.trim().is_empty() {
        return Err("分支名不能为空".to_string());
    }
    if old_name == new_name {
        return Err("新旧名字一样，不用改".to_string());
    }
    let repo = Repository::open(&path).map_err(fe)?;
    let mut branch = repo.find_branch(&old_name, git2::BranchType::Local).map_err(fe)?;
    // `force=false` — refuse if a branch with the new name already exists.
    branch.rename(&new_name, false).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub async fn delete_branch(
    path: String,
    name: String,
    force: bool,
) -> Result<(), String> {
    // Shell out so we get git's "not fully merged" safety check for `-d`.
    // libgit2's Branch::delete is unconditional (matches `-D`).
    let flag = if force { "-D" } else { "-d" };
    run_git_simple(&["branch", flag, &name], &path).await
}

/// Delete a branch on the remote via `git push <remote> --delete <branch>`.
/// `full_name` is the remote-style "origin/feat-x"; we split at the first slash.
#[tauri::command]
pub async fn delete_remote_branch(
    app: tauri::AppHandle,
    path: String,
    full_name: String,
) -> Result<(), String> {
    let (remote, branch) = match full_name.split_once('/') {
        Some(p) => p,
        None => return Err("远程分支名格式异常".to_string()),
    };
    if remote.is_empty() || branch.is_empty() {
        return Err("远程分支名格式异常".to_string());
    }
    // Reuse streaming_git for the progress strip during the push.
    streaming_git(
        "push",
        &["push", "--progress", remote, "--delete", branch],
        Some(&path),
        &app,
    ).await
}

// ── Merge analysis & execution ─────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeAnalysis {
    pub current: String,
    pub target: String,
    /// Commits target has that current doesn't (the "incoming" payload).
    pub target_commits: usize,
    /// Files that would be touched by the merge (changed on target since divergence).
    pub incoming_files: Vec<String>,
    /// Files BOTH sides modified since divergence — primary conflict candidates.
    pub shared_files: Vec<String>,
    /// True when current is a strict ancestor of target — merge is a no-op fast-forward.
    pub can_fast_forward: bool,
    /// True when target is already merged into current (current is descendant).
    pub already_merged: bool,
}

fn collect_paths(diff: &git2::Diff) -> std::collections::BTreeSet<String> {
    use std::cell::RefCell;
    let acc: RefCell<std::collections::BTreeSet<String>> =
        RefCell::new(std::collections::BTreeSet::new());
    let _ = diff.foreach(
        &mut |delta, _| {
            if let Some(p) = delta.new_file().path().or_else(|| delta.old_file().path()) {
                acc.borrow_mut().insert(p.to_string_lossy().to_string());
            }
            true
        },
        None, None, None,
    );
    acc.into_inner()
}

fn resolve_branch_oid(repo: &Repository, name: &str) -> Result<git2::Oid, String> {
    // Accept both local ("feat-x") and remote ("origin/feat-x") names.
    if let Ok(b) = repo.find_branch(name, git2::BranchType::Local) {
        if let Some(oid) = b.get().target() { return Ok(oid) }
    }
    if let Ok(b) = repo.find_branch(name, git2::BranchType::Remote) {
        if let Some(oid) = b.get().target() { return Ok(oid) }
    }
    Err(format!("找不到分支 {}", name))
}

#[tauri::command]
pub fn analyze_merge(path: String, target: String) -> Result<MergeAnalysis, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let head_ref = repo.head().map_err(fe)?;
    let current = head_ref.shorthand().unwrap_or("HEAD").to_string();
    let head_oid = head_ref.target().ok_or_else(|| "无法读取 HEAD".to_string())?;
    let target_oid = resolve_branch_oid(&repo, &target)?;

    if head_oid == target_oid {
        return Ok(MergeAnalysis {
            current, target,
            target_commits: 0,
            incoming_files: vec![],
            shared_files: vec![],
            can_fast_forward: false,
            already_merged: true,
        });
    }

    let base_oid = repo.merge_base(head_oid, target_oid).map_err(fe)?;

    let can_ff = base_oid == head_oid;
    let already_merged = base_oid == target_oid;

    // head_behind = how many commits target has that head doesn't = "incoming"
    let (_head_ahead, head_behind) =
        repo.graph_ahead_behind(head_oid, target_oid).unwrap_or((0, 0));

    if already_merged {
        return Ok(MergeAnalysis {
            current, target,
            target_commits: 0,
            incoming_files: vec![],
            shared_files: vec![],
            can_fast_forward: false,
            already_merged: true,
        });
    }

    let base_tree = repo.find_commit(base_oid).map_err(fe)?.tree().map_err(fe)?;
    let head_tree = repo.find_commit(head_oid).map_err(fe)?.tree().map_err(fe)?;
    let target_tree = repo.find_commit(target_oid).map_err(fe)?.tree().map_err(fe)?;

    let diff_target = repo.diff_tree_to_tree(Some(&base_tree), Some(&target_tree), None).map_err(fe)?;
    let target_files = collect_paths(&diff_target);

    // For fast-forward, no shared-file analysis needed: head == base, head_diff is empty.
    let shared_files: Vec<String> = if can_ff {
        vec![]
    } else {
        let diff_head = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None).map_err(fe)?;
        let head_files = collect_paths(&diff_head);
        target_files.intersection(&head_files).cloned().collect()
    };

    Ok(MergeAnalysis {
        current,
        target,
        target_commits: head_behind,
        incoming_files: target_files.into_iter().collect(),
        shared_files,
        can_fast_forward: can_ff,
        already_merged: false,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompareFile {
    /// New (head-side) path. For renames this is the destination.
    pub path: String,
    /// Old path for renames; None otherwise.
    pub old_path: Option<String>,
    /// "added" | "modified" | "deleted" | "renamed" | "copied" | "typechange"
    pub status: String,
    pub hunks: Vec<DiffHunk>,
    pub added: usize,
    pub removed: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompareResult {
    /// Commits in `head` that are not in `base` (excluding merge-base).
    pub commits: Vec<CommitInfo>,
    /// Combined diff of base..head, one entry per file.
    pub files: Vec<CompareFile>,
    /// Total lines added across all files.
    pub added: usize,
    /// Total lines removed across all files.
    pub removed: usize,
    /// The merge-base sha (or null if branches are unrelated).
    pub merge_base: Option<String>,
    /// Tip commit info for each branch, so the UI can show which side
    /// is more recent and surface the author/date.
    pub base_tip: Option<CommitInfo>,
    pub head_tip: Option<CommitInfo>,
}

/// `git log base..head` + `git diff base...head` rolled into a single call.
/// Both `base` and `head` accept anything `revparse_single` can resolve
/// — local branch name (`feature/x`), remote (`origin/main`), tag, or sha.
#[tauri::command]
pub fn compare_branches(
    path: String,
    base: String,
    head: String,
) -> Result<CompareResult, String> {
    let repo = Repository::open(&path).map_err(fe)?;

    let base_oid = repo.revparse_single(&base).map_err(fe)?.id();
    let head_oid = repo.revparse_single(&head).map_err(fe)?.id();

    // Three-dot diff convention: compare base's merge-base with head
    // against head's tree. This shows only what head added — the same
    // diff GitHub shows on a PR page.
    let mb = repo.merge_base(base_oid, head_oid).ok();
    let diff_from = mb.unwrap_or(base_oid);

    let from_tree = repo.find_commit(diff_from).map_err(fe)?.tree().map_err(fe)?;
    let head_tree = repo.find_commit(head_oid).map_err(fe)?.tree().map_err(fe)?;

    // ── Commit list: revwalk(head) excluding base
    let mut walk = repo.revwalk().map_err(fe)?;
    walk.push(head_oid).map_err(fe)?;
    walk.hide(base_oid).map_err(fe)?;
    let commits: Vec<CommitInfo> = walk
        .filter_map(|id| id.ok())
        .filter_map(|id| repo.find_commit(id).ok())
        .map(|c| {
            let id_str = c.id().to_string();
            let short_id = id_str[..7].to_string();
            CommitInfo {
                id: id_str,
                short_id,
                message: c.summary().unwrap_or("").to_string(),
                author: c.author().name().unwrap_or("").to_string(),
                time: c.time().seconds(),
            }
        })
        .collect();

    // ── Combined diff (with rename detection so renames don't show as
    //    delete+add)
    let mut diff = repo
        .diff_tree_to_tree(Some(&from_tree), Some(&head_tree), None)
        .map_err(fe)?;
    let mut find_opts = git2::DiffFindOptions::new();
    find_opts.renames(true).copies(true);
    let _ = diff.find_similar(Some(&mut find_opts));

    use std::cell::RefCell;
    let results: RefCell<Vec<CompareFile>> = RefCell::new(Vec::new());
    let stats = RefCell::new((0usize, 0usize)); // (added, removed)

    diff.foreach(
        &mut |delta, _| {
            let new_path = delta.new_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let old_path = delta.old_file().path()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let status = match delta.status() {
                git2::Delta::Added       => "added",
                git2::Delta::Deleted     => "deleted",
                git2::Delta::Modified    => "modified",
                git2::Delta::Renamed     => "renamed",
                git2::Delta::Copied      => "copied",
                git2::Delta::Typechange  => "typechange",
                git2::Delta::Unmodified  => "unmodified",
                _                        => "modified",
            }.to_string();
            // Use the path that exists on the head side; for deletions
            // that's the old path.
            let path = if delta.status() == git2::Delta::Deleted {
                old_path.clone()
            } else {
                new_path.clone()
            };
            let mut r = results.borrow_mut();
            if r.iter().all(|x| x.path != path) {
                let old_path_opt = if status == "renamed" || status == "copied" {
                    Some(old_path)
                } else {
                    None
                };
                r.push(CompareFile {
                    path,
                    old_path: old_path_opt,
                    status,
                    hunks: vec![],
                    added: 0,
                    removed: 0,
                });
            }
            true
        },
        None,
        Some(&mut |delta, hunk| {
            let path = path_for_delta(&delta);
            let header = String::from_utf8_lossy(hunk.header()).to_string();
            let mut r = results.borrow_mut();
            if let Some(file) = r.iter_mut().find(|x| x.path == path) {
                file.hunks.push(DiffHunk { header, lines: vec![] });
            }
            true
        }),
        Some(&mut |delta, _hunk, line| {
            let path = path_for_delta(&delta);
            let content = String::from_utf8_lossy(line.content()).to_string();
            match line.origin() {
                '+' => stats.borrow_mut().0 += 1,
                '-' => stats.borrow_mut().1 += 1,
                _ => {}
            }
            let mut r = results.borrow_mut();
            if let Some(file) = r.iter_mut().find(|x| x.path == path) {
                match line.origin() {
                    '+' => file.added += 1,
                    '-' => file.removed += 1,
                    _ => {}
                }
                if let Some(h) = file.hunks.last_mut() {
                    h.lines.push(DiffLine {
                        origin: line.origin(),
                        content,
                        old_lineno: line.old_lineno(),
                        new_lineno: line.new_lineno(),
                    });
                }
            }
            true
        }),
    ).map_err(fe)?;

    let (added, removed) = *stats.borrow();
    let tip = |oid: git2::Oid| -> Option<CommitInfo> {
        repo.find_commit(oid).ok().map(|c| {
            let id = c.id().to_string();
            let short_id = id[..7].to_string();
            CommitInfo {
                id,
                short_id,
                message: c.summary().unwrap_or("").to_string(),
                author: c.author().name().unwrap_or("").to_string(),
                time: c.time().seconds(),
            }
        })
    };
    Ok(CompareResult {
        commits,
        files: results.into_inner(),
        added,
        removed,
        merge_base: mb.map(|o| o.to_string()),
        base_tip: tip(base_oid),
        head_tip: tip(head_oid),
    })
}

/// Resolve a delta's "active" path — head-side path normally, old-side
/// for deletions. Keeps line/hunk attribution consistent during the
/// foreach walk.
fn path_for_delta(delta: &git2::DiffDelta) -> String {
    let new_path = delta.new_file().path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let old_path = delta.old_file().path()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    if delta.status() == git2::Delta::Deleted {
        old_path
    } else {
        new_path
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompareTreeEntry {
    /// Full path from repo root, e.g. "src/lib/foo.rs".
    pub path: String,
    /// True for directories, false for blobs.
    pub is_dir: bool,
    /// Exists in the `base` checkout?
    pub base_present: bool,
    /// Exists in the `head` checkout?
    pub head_present: bool,
    /// Only meaningful when BOTH sides are present and the entry is a file:
    /// "identical" if the blob OID matches, "modified" otherwise.
    pub diff_status: Option<String>,
}

/// Beyond-Compare-style: flatten BOTH branches' complete file trees and
/// for every path tell the frontend whether it exists on each side and
/// (for files present on both) whether the blob is identical or modified.
/// Empty repos or unrelated histories still work — the union of paths is
/// computed regardless of merge-base.
#[tauri::command]
pub fn compare_trees(
    path: String,
    base: String,
    head: String,
) -> Result<Vec<CompareTreeEntry>, String> {
    use std::collections::BTreeMap;
    let repo = Repository::open(&path).map_err(fe)?;
    let base_oid = repo.revparse_single(&base).map_err(fe)?.id();
    let head_oid = repo.revparse_single(&head).map_err(fe)?.id();
    let base_tree = repo.find_commit(base_oid).map_err(fe)?.tree().map_err(fe)?;
    let head_tree = repo.find_commit(head_oid).map_err(fe)?.tree().map_err(fe)?;

    type FlatMap = BTreeMap<String, (bool, git2::Oid)>;
    fn flatten(repo: &Repository, tree: &git2::Tree, prefix: &str, out: &mut FlatMap) {
        for entry in tree.iter() {
            let name = entry.name().unwrap_or("").to_string();
            if name.is_empty() { continue }
            let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            let oid = entry.id();
            match entry.kind() {
                Some(git2::ObjectType::Tree) => {
                    out.insert(path.clone(), (true, oid));
                    if let Ok(sub) = repo.find_tree(oid) {
                        flatten(repo, &sub, &path, out);
                    }
                }
                Some(git2::ObjectType::Blob) => {
                    out.insert(path, (false, oid));
                }
                _ => {}
            }
        }
    }

    let mut base_map: FlatMap = BTreeMap::new();
    let mut head_map: FlatMap = BTreeMap::new();
    flatten(&repo, &base_tree, "", &mut base_map);
    flatten(&repo, &head_tree, "", &mut head_map);

    // Union of paths
    let mut all_paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for k in base_map.keys() { all_paths.insert(k.clone()); }
    for k in head_map.keys() { all_paths.insert(k.clone()); }

    let mut out = Vec::with_capacity(all_paths.len());
    for path in all_paths {
        let b = base_map.get(&path);
        let h = head_map.get(&path);
        let is_dir = b.map(|x| x.0).or_else(|| h.map(|x| x.0)).unwrap_or(false);
        let diff_status: Option<String> = match (b, h) {
            (Some((false, bo)), Some((false, ho))) => {
                Some((if bo == ho { "identical" } else { "modified" }).to_string())
            }
            _ => None,
        };
        out.push(CompareTreeEntry {
            path,
            is_dir,
            base_present: b.is_some(),
            head_present: h.is_some(),
            diff_status,
        });
    }
    Ok(out)
}

const AI_MERGE_RISK_SYSTEM_PROMPT: &str = r#"你是资深工程师。用户即将把分支 target 合并到 current。下面是两边自共同祖先以来的改动。

必须严格输出 JSON 对象，无任何其他文字、无代码块包裹：
{
  "overall": "一两句话中文总结整体风险与建议",
  "files": [
    { "path": "...", "risk": "high|medium|low", "reason": "1 句话中文说明" }
  ]
}

风险等级：
- high   双方在同一段代码/同一函数内改动重叠，几乎肯定冲突
- medium 双方改动靠近或语义相关，git 能自动合并但建议人工审查
- low    双方改动在文件不同位置且无语义关联，应该可以自动合并

files 只列「双方都改了的文件」，不要列只有一方改的。共同改动为零时返回空数组。
不要复述 diff 内容；reason 简短直接。"#;

fn diff_to_text(diff: &git2::Diff, max_chars: usize) -> String {
    use std::cell::RefCell;
    let buf: RefCell<String> = RefCell::new(String::new());
    let stopped: RefCell<bool> = RefCell::new(false);

    let _ = diff.print(git2::DiffFormat::Patch, |_d, _h, line| {
        if *stopped.borrow() { return true }
        let mut b = buf.borrow_mut();
        if b.len() >= max_chars {
            b.push_str("\n... [diff 过长，已截断] ...\n");
            *stopped.borrow_mut() = true;
            return true;
        }
        let origin = line.origin();
        if origin == '+' || origin == '-' || origin == ' ' {
            b.push(origin);
        }
        b.push_str(&String::from_utf8_lossy(line.content()));
        true
    });

    buf.into_inner()
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileRisk {
    pub path: String,
    /// "high" | "medium" | "low"
    pub risk: String,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MergeRiskReport {
    pub overall: String,
    pub files: Vec<FileRisk>,
}

#[tauri::command]
pub async fn ai_analyze_merge_risk(
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    path: String,
    target: String,
) -> Result<MergeRiskReport, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    // Compute both sides' diffs and a list of shared files (most likely conflicts).
    let (current, head_diff, target_diff, shared_files) = {
        let repo = Repository::open(&path).map_err(fe)?;
        let head_ref = repo.head().map_err(fe)?;
        let current = head_ref.shorthand().unwrap_or("HEAD").to_string();
        let head_oid = head_ref.target().ok_or_else(|| "无法读取 HEAD".to_string())?;
        let target_oid = resolve_branch_oid(&repo, &target)?;
        let base_oid = repo.merge_base(head_oid, target_oid).map_err(fe)?;

        let base_tree = repo.find_commit(base_oid).map_err(fe)?.tree().map_err(fe)?;
        let head_tree = repo.find_commit(head_oid).map_err(fe)?.tree().map_err(fe)?;
        let target_tree = repo.find_commit(target_oid).map_err(fe)?.tree().map_err(fe)?;

        let dh = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None).map_err(fe)?;
        let dt = repo.diff_tree_to_tree(Some(&base_tree), Some(&target_tree), None).map_err(fe)?;

        let head_files = collect_paths(&dh);
        let target_files = collect_paths(&dt);
        let shared: Vec<String> = head_files.intersection(&target_files).cloned().collect();

        (current, diff_to_text(&dh, 20_000), diff_to_text(&dt, 20_000), shared)
    };

    let shared_list_text = if shared_files.is_empty() {
        "（双方没有共同修改的文件 — 结构上无冲突）".to_string()
    } else {
        shared_files.iter().map(|p| format!("- {}", p)).collect::<Vec<_>>().join("\n")
    };

    let user_prompt = format!(
        "current = {}\ntarget = {}\n\n双方都修改的文件:\n{}\n\n[{} 这一侧的改动]\n```diff\n{}\n```\n\n[{} 这一侧的改动]\n```diff\n{}\n```\n\n请按规定返回 JSON。",
        current, target, shared_list_text, current, head_diff, target, target_diff
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let raw = call_ai(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_MERGE_RISK_SYSTEM_PROMPT, &user_prompt, 1024,
    ).await?;

    // Strip ```json fences if the model wrapped its output despite the prompt
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    match serde_json::from_str::<MergeRiskReport>(cleaned) {
        Ok(mut r) => {
            // Normalize risk values to lowercase, drop unknown values.
            r.files.retain_mut(|f| {
                let normalized = f.risk.to_lowercase();
                if matches!(normalized.as_str(), "high" | "medium" | "low") {
                    f.risk = normalized;
                    true
                } else { false }
            });
            Ok(r)
        }
        Err(_) => {
            // Graceful fallback: surface the raw text as overall + empty files,
            // so the UI still shows something useful.
            Ok(MergeRiskReport {
                overall: format!("[AI 返回非 JSON，原文如下]\n{}", trunc(&raw, 600)),
                files: vec![],
            })
        }
    }
}

const AI_FILE_CONFLICT_SYSTEM_PROMPT: &str = r#"你是资深工程师。用户即将合并分支，下面是某个文件在双方分支上的具体改动。
请只针对这一个文件，找出具体冲突点。要求：

- 一段中文，约 100-200 字
- 指出哪几行/哪个函数双方都改了，为什么会冲突
- 如果其实不冲突（改动在不同位置），明确说"实际不冲突，git 应该能自动合并"
- 给出推荐的处理思路（用我的、用对方的、合并两边等）
- 不要复述 diff 全文"#;

#[tauri::command]
pub async fn ai_analyze_file_conflict(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    path: String,
    target: String,
    file: String,
    stream_id: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    let (current, head_diff, target_diff) = {
        let repo = Repository::open(&path).map_err(fe)?;
        let head_ref = repo.head().map_err(fe)?;
        let current = head_ref.shorthand().unwrap_or("HEAD").to_string();
        let head_oid = head_ref.target().ok_or_else(|| "无法读取 HEAD".to_string())?;
        let target_oid = resolve_branch_oid(&repo, &target)?;
        let base_oid = repo.merge_base(head_oid, target_oid).map_err(fe)?;

        let base_tree = repo.find_commit(base_oid).map_err(fe)?.tree().map_err(fe)?;
        let head_tree = repo.find_commit(head_oid).map_err(fe)?.tree().map_err(fe)?;
        let target_tree = repo.find_commit(target_oid).map_err(fe)?.tree().map_err(fe)?;

        // Filter both diffs to just this file.
        let mut opts_h = git2::DiffOptions::new();
        opts_h.pathspec(&file);
        let mut opts_t = git2::DiffOptions::new();
        opts_t.pathspec(&file);
        let dh = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts_h)).map_err(fe)?;
        let dt = repo.diff_tree_to_tree(Some(&base_tree), Some(&target_tree), Some(&mut opts_t)).map_err(fe)?;

        (current, diff_to_text(&dh, 30_000), diff_to_text(&dt, 30_000))
    };

    let user_prompt = format!(
        "文件: {}\ncurrent: {}\ntarget: {}\n\n[{} 这一侧对该文件的改动]\n```diff\n{}\n```\n\n[{} 这一侧对该文件的改动]\n```diff\n{}\n```\n\n请分析具体冲突。",
        file, current, target, current, head_diff, target, target_diff
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let event = format!("ai:stream:{}", stream_id);
    let cancel = register_ai_cancel(&stream_id);
    let result = call_ai_stream(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_FILE_CONFLICT_SYSTEM_PROMPT, &user_prompt, 768, &app, &event, cancel,
    ).await;
    unregister_ai_cancel(&stream_id);
    result
}

#[tauri::command]
pub async fn merge_branch(path: String, target: String) -> Result<(), String> {
    // Plain git merge — fast-forward when possible, real merge commit otherwise.
    // On conflict, git pauses and the repo state becomes Merge (RepositoryState),
    // which the UI's state machine routes to ConflictView automatically.
    run_git_simple(&["merge", "--no-edit", &target], &path).await
}

/// Walk HEAD's first-parent history and return the index (0-based) of the
/// commit matching `sha`. Used to figure out how deep the graph needs to be
/// loaded to surface a commit found by SHA search.
/// Returns None if not found within a 100k sanity cap or not a valid commit.
#[tauri::command]
pub fn find_commit_depth(path: String, sha: String) -> Result<Option<usize>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let target_oid = match repo.revparse_single(&sha) {
        Ok(o) => match o.peel_to_commit() {
            Ok(c) => c.id(),
            Err(_) => return Ok(None),
        },
        Err(_) => return Ok(None),
    };

    let mut revwalk = repo.revwalk().map_err(fe)?;
    revwalk.push_head().map_err(fe)?;
    let _ = revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME);

    const CAP: usize = 100_000;
    for (idx, id_result) in revwalk.enumerate() {
        if idx > CAP { break }
        if let Ok(oid) = id_result {
            if oid == target_oid {
                return Ok(Some(idx))
            }
        }
    }
    Ok(None)
}

/// Resolve a SHA-like prefix to a commit. Returns Ok(None) for:
///   - non-hex input,
///   - no match,
///   - ambiguous match (the user can keep typing).
/// We only accept 4+ hex chars to keep this from accidentally resolving branch
/// names or "HEAD" / "HEAD~3" which revparse_single would otherwise honor.
#[tauri::command]
pub fn find_commit_by_prefix(
    path: String,
    prefix: String,
) -> Result<Option<CommitInfo>, String> {
    let p = prefix.trim();
    if p.len() < 4 || p.len() > 40 || !p.chars().all(|c| c.is_ascii_hexdigit()) {
        return Ok(None);
    }
    let repo = Repository::open(&path).map_err(fe)?;
    let obj = match repo.revparse_single(p) {
        Ok(o) => o,
        Err(_) => return Ok(None),  // not found OR ambiguous — both ⇒ "no match yet"
    };
    let commit = match obj.peel_to_commit() {
        Ok(c) => c,
        Err(_) => return Ok(None),  // resolved to non-commit (tag pointing to tree, etc.)
    };
    let id = commit.id().to_string();
    let short_id = id[..7.min(id.len())].to_string();
    let message = commit.summary().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let time = commit.time().seconds();
    Ok(Some(CommitInfo { id, short_id, message, author, time }))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GraphCommit {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub time: i64,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
}

#[tauri::command]
pub fn get_graph(path: String, limit: usize) -> Result<Vec<GraphCommit>, String> {
    let repo = Repository::open(&path).map_err(fe)?;

    // Build id → ref names map
    let mut ref_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

    // HEAD (mark current branch)
    if let Ok(head) = repo.head() {
        if let Some(oid) = head.target() {
            let entry = ref_map.entry(oid.to_string()).or_default();
            entry.push("HEAD".to_string());
            if head.is_branch() {
                if let Some(name) = head.shorthand() {
                    entry.push(name.to_string());
                }
            }
        }
    }

    // Other local branches
    if let Ok(branches) = repo.branches(Some(git2::BranchType::Local)) {
        for branch in branches.flatten() {
            let (b, _) = branch;
            if b.is_head() { continue; }
            if let (Ok(Some(name)), Some(oid)) = (b.name(), b.get().target()) {
                ref_map.entry(oid.to_string()).or_default().push(name.to_string());
            }
        }
    }

    // Remote branches
    if let Ok(branches) = repo.branches(Some(git2::BranchType::Remote)) {
        for branch in branches.flatten() {
            let (b, _) = branch;
            if let (Ok(Some(name)), Some(oid)) = (b.name(), b.get().target()) {
                ref_map.entry(oid.to_string()).or_default().push(name.to_string());
            }
        }
    }

    let mut revwalk = repo.revwalk().map_err(fe)?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
        .map_err(fe)?;
    let _ = revwalk.push_glob("refs/heads/*");
    let _ = revwalk.push_head();

    let commits = revwalk
        .take(limit)
        .filter_map(|id| id.ok())
        .filter_map(|id| repo.find_commit(id).ok())
        .map(|c| {
            let id = c.id().to_string();
            let parents = (0..c.parent_count())
                .filter_map(|i| c.parent_id(i).ok())
                .map(|p| p.to_string())
                .collect();
            let refs = ref_map.get(&id).cloned().unwrap_or_default();
            GraphCommit {
                short_id: id[..7].to_string(),
                message: c.summary().unwrap_or("").to_string(),
                author: c.author().name().unwrap_or("").to_string(),
                time: c.time().seconds(),
                parents,
                refs,
                id,
            }
        })
        .collect();

    Ok(commits)
}

// ── Conflict resolution ─────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictFile {
    pub path: String,
    pub is_binary: bool,
    pub hunk_count: usize,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictHunk {
    /// 1-indexed inclusive start line in the "ours" blob
    pub ours_start: u32,
    /// 1-indexed exclusive end (empty range has start == end)
    pub ours_end: u32,
    pub theirs_start: u32,
    pub theirs_end: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictContent {
    pub ours: String,
    pub theirs: String,
    pub base: Option<String>,
    pub hunks: Vec<ConflictHunk>,
    /// Verbatim workdir file (with <<<<<< markers). Frontend uses this to
    /// build the merged result by applying user's per-hunk choices.
    pub workdir: String,
}

#[tauri::command]
pub fn get_conflicts(path: String) -> Result<Vec<ConflictFile>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let index = repo.index().map_err(fe)?;
    let mut out: Vec<ConflictFile> = Vec::new();

    let Ok(iter) = index.conflicts() else { return Ok(out) };
    for c in iter.flatten() {
        let entry = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
        let Some(entry) = entry else { continue };
        let file_path = String::from_utf8_lossy(&entry.path).to_string();

        let is_binary = repo.find_blob(entry.id).ok()
            .map(|b| is_binary_content(b.content()))
            .unwrap_or(false);

        let hunk_count = if is_binary {
            0
        } else {
            let abs = std::path::Path::new(&path).join(&file_path);
            std::fs::read_to_string(&abs)
                .map(|s| count_conflict_hunks(&s))
                .unwrap_or(0)
        };

        out.push(ConflictFile { path: file_path, is_binary, hunk_count });
    }
    Ok(out)
}

#[tauri::command]
pub fn get_conflict_content(path: String, file: String) -> Result<ConflictContent, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let index = repo.index().map_err(fe)?;
    let target = file.as_bytes();

    let conflict = index.conflicts()
        .map_err(fe)?
        .flatten()
        .find(|c| {
            let p = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref())
                .map(|e| e.path.as_slice());
            p == Some(target)
        })
        .ok_or_else(|| format!("文件 {} 不在冲突列表中", file))?;

    let read_blob = |entry: &Option<git2::IndexEntry>| -> Option<String> {
        entry.as_ref()
            .and_then(|e| repo.find_blob(e.id).ok())
            .map(|b| String::from_utf8_lossy(b.content()).to_string())
    };

    let ours = read_blob(&conflict.our).unwrap_or_default();
    let theirs = read_blob(&conflict.their).unwrap_or_default();
    let base = read_blob(&conflict.ancestor);

    let abs = std::path::Path::new(&path).join(&file);
    let workdir = std::fs::read_to_string(&abs).map_err(fe)?;
    let hunks = parse_conflict_hunks(&workdir);

    Ok(ConflictContent { ours, theirs, base, hunks, workdir })
}

#[tauri::command]
pub fn resolve_conflict(path: String, file: String, content: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let abs = std::path::Path::new(&path).join(&file);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(fe)?;
    }
    std::fs::write(&abs, &content).map_err(fe)?;

    let mut index = repo.index().map_err(fe)?;
    // add_path on a conflicted entry also clears its conflict stages.
    index.add_path(std::path::Path::new(&file)).map_err(fe)?;
    index.write().map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn abort_merge(path: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let head = repo.head().map_err(fe)?;
    let head_commit = head.peel_to_commit().map_err(fe)?;
    repo.reset(
        head_commit.as_object(),
        git2::ResetType::Hard,
        None,
    ).map_err(fe)?;
    repo.cleanup_state().map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn continue_merge(path: String, message: String) -> Result<String, String> {
    let repo = Repository::open(&path).map_err(fe)?;

    let mut index = repo.index().map_err(fe)?;
    if index.has_conflicts() {
        return Err("还有未解决的冲突".to_string());
    }

    let head_commit = repo.head().map_err(fe)?
        .peel_to_commit().map_err(fe)?;

    let merge_head_oid = repo.find_reference("MERGE_HEAD")
        .map_err(|_| "未处于合并状态".to_string())?
        .target()
        .ok_or_else(|| "无法读取 MERGE_HEAD".to_string())?;
    let merge_commit = repo.find_commit(merge_head_oid)
        .map_err(fe)?;

    let tree_oid = index.write_tree().map_err(fe)?;
    let tree = repo.find_tree(tree_oid).map_err(fe)?;

    let sig = repo.signature().map_err(fe)?;
    let commit_oid = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &[&head_commit, &merge_commit],
    ).map_err(fe)?;

    repo.cleanup_state().map_err(fe)?;
    Ok(commit_oid.to_string())
}

// ── AI commit message ──────────────────────────────────────────────────────

/// Truncate diff to a soft cap so we don't blow past provider context limits
/// or spend money on huge changes. ~60k chars ≈ 15k tokens which is plenty.
const AI_DIFF_CHAR_CAP: usize = 60_000;

const AI_SYSTEM_PROMPT: &str =
    "你是资深工程师，根据 git diff 写一句简洁的中文提交说明。要求：\n\
     - 一行主语，70 字符以内，动词开头（如 \"修复…\"、\"重构…\"、\"新增…\"）\n\
     - 如改动较多，可在空行后补 1-3 条短要点\n\
     - 直接给提交说明，不要前缀也不要代码块包裹\n\
     - 如果改动只是格式/typo，请如实说，不要夸大";

#[tauri::command]
pub async fn ai_generate_commit_message(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    diff: String,
    stream_id: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }
    if diff.trim().is_empty() {
        return Err("没有待提交的改动可供分析".to_string());
    }

    let truncated_diff = if diff.len() > AI_DIFF_CHAR_CAP {
        let mut s = diff[..AI_DIFF_CHAR_CAP].to_string();
        s.push_str("\n\n[diff 过长，已截断]");
        s
    } else {
        diff
    };

    let user_prompt = format!(
        "请根据下面的 git diff 写提交说明：\n\n```diff\n{}\n```",
        truncated_diff
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let event = format!("ai:stream:{}", stream_id);
    let cancel = register_ai_cancel(&stream_id);
    let result = call_ai_stream(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_SYSTEM_PROMPT, &user_prompt, 512, &app, &event, cancel,
    ).await;
    unregister_ai_cancel(&stream_id);
    result
}

/// Single entry point for hitting any configured provider with a system+user
/// prompt pair. Returns the raw text response.
async fn call_ai(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: Option<&str>,
    base_url: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    match provider {
        "anthropic" => call_anthropic(client, api_key, model, system_prompt, user_prompt, max_tokens).await,
        "openai" | "openai-compatible" | "deepseek" | "kimi" => {
            let (def_base, def_model) = openai_compatible_defaults(provider);
            let base = base_url.filter(|s| !s.trim().is_empty()).unwrap_or(def_base);
            if base.trim().is_empty() {
                return Err("OpenAI 兼容服务需要填写 Base URL".to_string());
            }
            let resolved_model = model
                .filter(|s| !s.trim().is_empty())
                .or(if def_model.is_empty() { None } else { Some(def_model) });
            call_openai_compatible(client, base, api_key, resolved_model, system_prompt, user_prompt, max_tokens).await
        }
        _ => Err(format!("未知的 AI provider：{}", provider)),
    }
}

/// Preset base URL + default model for OpenAI-compatible providers.
/// Returning empty strings means "no preset, user must supply".
fn openai_compatible_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "openai"   => ("https://api.openai.com/v1", "gpt-4o-mini"),
        "deepseek" => ("https://api.deepseek.com/v1", "deepseek-chat"),
        "kimi"     => ("https://api.moonshot.cn/v1", "moonshot-v1-32k"),
        _          => ("", ""),
    }
}

// ── AI stream cancellation registry ────────────────────────────────────────

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

/// Map: stream_id → cancellation flag. Set to `true` by `cancel_ai_stream`,
/// polled by `call_ai_stream` between chunks.
fn ai_cancel_flags() -> &'static std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<AtomicBool>>> {
    static M: OnceLock<std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<AtomicBool>>>> = OnceLock::new();
    M.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn register_ai_cancel(stream_id: &str) -> std::sync::Arc<AtomicBool> {
    let flag = std::sync::Arc::new(AtomicBool::new(false));
    if let Ok(mut m) = ai_cancel_flags().lock() {
        m.insert(stream_id.to_string(), flag.clone());
    }
    flag
}

fn unregister_ai_cancel(stream_id: &str) {
    if let Ok(mut m) = ai_cancel_flags().lock() {
        m.remove(stream_id);
    }
}

#[tauri::command]
pub fn cancel_ai_stream(stream_id: String) -> Result<(), String> {
    if let Ok(m) = ai_cancel_flags().lock() {
        if let Some(flag) = m.get(&stream_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

/// Streaming counterpart of `call_ai`. Each provider emits SSE deltas with
/// slightly different JSON shapes; we normalize both into incremental text
/// fragments, dispatch them via Tauri events as `{ delta }`, and accumulate
/// the full body to return on completion.
///
/// Events emitted on `event_name`:
///   { delta: "..." }            one per text chunk
///   { done: true }              after the stream closes cleanly
///   { done: true, cancelled }   if user cancelled mid-stream
async fn call_ai_stream(
    client: &reqwest::Client,
    provider: &str,
    api_key: &str,
    model: Option<&str>,
    base_url: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
    app: &tauri::AppHandle,
    event_name: &str,
    cancel: std::sync::Arc<AtomicBool>,
) -> Result<String, String> {
    use futures_util::StreamExt;

    // Build provider-specific URL / body / headers, all with stream=true.
    let (url, body, header_pairs): (String, serde_json::Value, Vec<(&'static str, String)>) =
        match provider {
            "anthropic" => {
                let model = model.unwrap_or("claude-sonnet-4-6");
                let body = serde_json::json!({
                    "model": model,
                    "max_tokens": max_tokens,
                    "system": system_prompt,
                    "messages": [{ "role": "user", "content": user_prompt }],
                    "stream": true,
                });
                (
                    "https://api.anthropic.com/v1/messages".to_string(),
                    body,
                    vec![
                        ("x-api-key", api_key.to_string()),
                        ("anthropic-version", "2023-06-01".to_string()),
                    ],
                )
            }
            "openai" | "openai-compatible" | "deepseek" | "kimi" => {
                let (def_base, def_model) = openai_compatible_defaults(provider);
                let base = base_url.filter(|s| !s.trim().is_empty()).unwrap_or(def_base);
                if base.trim().is_empty() {
                    return Err("OpenAI 兼容服务需要填写 Base URL".to_string());
                }
                let model = model
                    .filter(|s| !s.trim().is_empty())
                    .or(if def_model.is_empty() { None } else { Some(def_model) })
                    .ok_or_else(|| "请在设置里指定 model".to_string())?;
                let body = serde_json::json!({
                    "model": model,
                    "max_tokens": max_tokens,
                    "stream": true,
                    "messages": [
                        { "role": "system", "content": system_prompt },
                        { "role": "user",   "content": user_prompt   },
                    ],
                });
                (
                    format!("{}/chat/completions", base.trim_end_matches('/')),
                    body,
                    vec![("Authorization", format!("Bearer {}", api_key))],
                )
            }
            _ => return Err(format!("未知的 AI provider：{}", provider)),
        };

    let mut req = client.post(&url).header("content-type", "application/json").json(&body);
    for (k, v) in &header_pairs { req = req.header(*k, v); }

    // Diagnostic: emit a frontend-visible event at each network milestone
    // so we can tell exactly where the request hangs (before send, between
    // send and response headers, or during body streaming).
    let _ = app.emit(event_name, serde_json::json!({
        "stage": "sending", "url": &url, "provider": provider,
    }));
    let send_started = std::time::Instant::now();
    let resp = req.send().await.map_err(|e| {
        format!("send() failed after {}ms: {}", send_started.elapsed().as_millis(), e)
    })?;
    let _ = app.emit(event_name, serde_json::json!({
        "stage": "response_headers",
        "status": resp.status().as_u16(),
        "elapsedMs": send_started.elapsed().as_millis() as u64,
    }));
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.map_err(fe)?;
        let label = match provider {
            "anthropic" => "Anthropic",
            "deepseek"  => "DeepSeek",
            "kimi"      => "Kimi",
            _           => "OpenAI",
        };
        return Err(translate_provider_error(status.as_u16(), &text, label));
    }

    let mut stream = resp.bytes_stream();
    let mut accumulated = String::new();
    let mut buffer = String::new();

    // Normalize CRLF → LF before searching for the SSE event separator so
    // providers that emit \r\n\r\n (e.g. some OpenAI-compatible gateways)
    // still parse correctly.
    let normalize = |s: &str| s.replace("\r\n", "\n");

    let drain_event = |event_str: &str,
                       accumulated: &mut String,
                       app: &tauri::AppHandle,
                       event_name: &str| {
        for line in event_str.lines() {
            let line = line.trim();
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" { continue }
            let delta = match provider {
                "anthropic" => extract_anthropic_delta(data),
                _ => extract_openai_delta(data),
            };
            if let Some(text) = delta {
                accumulated.push_str(&text);
                let _ = app.emit(event_name, serde_json::json!({ "delta": text }));
            }
        }
    };

    let mut cancelled = false;
    'outer: while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) { cancelled = true; break }
        let chunk = chunk.map_err(fe)?;
        let text = normalize(std::str::from_utf8(&chunk).map_err(|e| e.to_string())?);
        buffer.push_str(&text);

        // Emit a heartbeat for every chunk we receive — even chunks that
        // produce no `delta` (e.g. Anthropic `ping` events every 15s, or
        // OpenAI `[DONE]` markers, or model "thinking" prefaces). Lets
        // the JS-side idle timeout know the connection is still alive
        // so it doesn't kill a slow-but-active stream after 60s of pings.
        let _ = app.emit(event_name, serde_json::json!({ "heartbeat": true }));

        while let Some(end) = buffer.find("\n\n") {
            if cancel.load(Ordering::Relaxed) { cancelled = true; break 'outer }
            let event_str = buffer[..end].to_string();
            buffer.drain(..end + 2);
            drain_event(&event_str, &mut accumulated, app, event_name);
        }
    }

    // Drain whatever's left in the buffer (some providers don't emit a
    // trailing blank line before EOF).
    if !buffer.trim().is_empty() {
        drain_event(&buffer, &mut accumulated, app, event_name);
        buffer.clear();
    }

    // Last-ditch fallback: if SSE parsing produced nothing, the provider
    // probably ignored `stream: true` and returned a plain chat-completions
    // body. Try to parse it as a single JSON response.
    if accumulated.is_empty() {
        // Get whatever bytes are still around (we already drained, but the
        // chunk loop may have appended new data to accumulated buffer).
        // For now we just look at what was in `buffer` and the original
        // body if buffer is empty. We don't have the original body anymore
        // (we consumed the stream), so this is a soft fallback only.
        let _ = app.emit(event_name, serde_json::json!({ "delta": "" }));
    }

    let _ = app.emit(
        event_name,
        serde_json::json!({ "done": true, "cancelled": cancelled }),
    );
    Ok(accumulated)
}

fn extract_anthropic_delta(data: &str) -> Option<String> {
    // Two relevant event shapes:
    //   {"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}
    //   ignore others (message_start, message_stop, ping)
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    if v["type"].as_str()? != "content_block_delta" { return None }
    v["delta"]["text"].as_str().map(|s| s.to_string())
}

fn extract_openai_delta(data: &str) -> Option<String> {
    // {"choices":[{"delta":{"content":"..."}, ...}], ...}
    let v: serde_json::Value = serde_json::from_str(data).ok()?;
    let s = v["choices"][0]["delta"]["content"].as_str()?;
    Some(s.to_string())
}

async fn call_anthropic(
    client: &reqwest::Client,
    api_key: &str,
    model: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let model = model.unwrap_or("claude-sonnet-4-6");
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{ "role": "user", "content": user_prompt }],
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(fe)?;

    let status = resp.status();
    let text = resp.text().await.map_err(fe)?;
    if !status.is_success() {
        return Err(translate_provider_error(status.as_u16(), &text, "Anthropic"));
    }

    let v: serde_json::Value = serde_json::from_str(&text).map_err(fe)?;
    let content = v["content"]
        .as_array()
        .and_then(|arr| arr.iter().find_map(|b| b["text"].as_str()))
        .ok_or_else(|| format!("Anthropic 返回结构异常：{}", trunc(&text, 300)))?;
    Ok(content.trim().to_string())
}

async fn call_openai_compatible(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: Option<&str>,
    system_prompt: &str,
    user_prompt: &str,
    max_tokens: u32,
) -> Result<String, String> {
    let model = model.ok_or_else(|| "请在设置里指定 model".to_string())?;
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "messages": [
            { "role": "system", "content": system_prompt },
            { "role": "user",   "content": user_prompt   },
        ],
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(fe)?;

    let status = resp.status();
    let text = resp.text().await.map_err(fe)?;
    if !status.is_success() {
        return Err(translate_provider_error(status.as_u16(), &text, "OpenAI"));
    }

    let v: serde_json::Value = serde_json::from_str(&text).map_err(fe)?;
    let content = v["choices"][0]["message"]["content"].as_str()
        .ok_or_else(|| format!("OpenAI 返回结构异常：{}", trunc(&text, 300)))?;
    Ok(content.trim().to_string())
}

const AI_EXPLAIN_SYSTEM_PROMPT: &str =
    "你是资深工程师，向不熟悉这个项目的同事用人话解释一次 git 提交真正干了什么。要求：\n\
     - 2-3 句中文。先说改了什么，可能的话再点一下为什么\n\
     - 不要复述 commit message 字面意思，要从 diff 看到「作者实际做的事」\n\
     - 如果是典型类别（bug 修复 / 重构 / 新功能 / 配置调整 / 依赖升级 / 测试 / 文档），先把类别标出来\n\
     - 改动跨多文件时归纳主线，不要逐文件列举\n\
     - 不要写「该提交」「本次提交」这样的废话，直接说事\n\
     - 不要用代码块包裹，不要用列表，纯一段文字";

#[tauri::command]
pub async fn ai_explain_commit(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    subject: String,
    body: String,
    author: String,
    diff: String,
    stream_id: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    // Diff dominates token usage; cap at 40k chars (~10k tokens).
    let diff_c = trunc(&diff, 40_000);
    let body_c = if body.trim().is_empty() { "（无）".to_string() } else { trunc(&body, 2_000) };

    let user_prompt = format!(
        "Subject: {}\nAuthor: {}\n\nBody:\n{}\n\nDiff:\n```diff\n{}\n```\n\n请用人话解释这次提交。",
        subject, author, body_c, diff_c
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let event = format!("ai:stream:{}", stream_id);
    let cancel = register_ai_cancel(&stream_id);
    let result = call_ai_stream(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_EXPLAIN_SYSTEM_PROMPT, &user_prompt, 512, &app, &event, cancel,
    ).await;
    unregister_ai_cancel(&stream_id);
    result
}

const AI_REVIEW_SYSTEM_PROMPT: &str =
    "你是资深工程师，对一位同事即将提交的改动做 code review。要求：\n\
     - 输出 markdown 段落，不要用代码块包裹整个回复\n\
     - 用三个二级标题分块：## 潜在问题 / ## 风格与可读性 / ## 测试建议\n\
     - 每块下用「- 」开头的项目符号，每条 1-2 句直击要害\n\
     - 没有发现的块写「- 无明显问题。」一句话即可，不要硬凑\n\
     - 引用文件名/函数名时用反引号包裹\n\
     - 不夸赞、不寒暄、不复述 diff，直接给反馈\n\
     - 中文输出";

#[tauri::command]
pub async fn ai_review_staged(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    diff: String,
    stream_id: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }
    if diff.trim().is_empty() {
        return Err("没有 staged 改动可供 review".to_string());
    }

    let truncated = if diff.len() > AI_DIFF_CHAR_CAP {
        let mut s = diff[..AI_DIFF_CHAR_CAP].to_string();
        s.push_str("\n\n[diff 过长，已截断]");
        s
    } else {
        diff
    };
    let user_prompt = format!(
        "请 review 下面的 staged diff：\n\n```diff\n{}\n```",
        truncated
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;
    let event = format!("ai:stream:{}", stream_id);
    let cancel = register_ai_cancel(&stream_id);
    let result = call_ai_stream(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_REVIEW_SYSTEM_PROMPT, &user_prompt, 1024, &app, &event, cancel,
    ).await;
    unregister_ai_cancel(&stream_id);
    result
}

const AI_PR_DESC_SYSTEM_PROMPT: &str =
    "你是资深工程师，需要把一组 commits + 合并 diff 写成一份合格的 GitHub PR 描述。\n\
     输出 **markdown**，结构严格遵守：\n\n\
     第一行是 PR 标题（不超过 70 字），不要带 markdown heading 符号\n\
     第二行空行\n\
     `## Summary`\n\
     - 3-5 个项目符号，描述这次合并做了什么、为什么\n\n\
     `## Test plan`\n\
     - markdown checkbox 列表（`- [ ] xxx`），列出需要人工验证的事项\n\n\
     约束：\n\
     - 标题用动词开头，写「做了什么」，不是「这次 PR 是关于什么的」\n\
     - 不要复述 commit 字面消息，要从 diff 看到「实际做的事」\n\
     - 文件/函数名用反引号包裹\n\
     - 不夹任何代码块、不要前言或后记、不要联想没发生的事\n\
     - 中文输出";

#[tauri::command]
pub async fn ai_pr_description(
    app: tauri::AppHandle,
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    base_branch: String,
    head_branch: String,
    commits: Vec<String>,
    diff: String,
    stream_id: String,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    let truncated_diff = if diff.len() > AI_DIFF_CHAR_CAP {
        let mut s = diff[..AI_DIFF_CHAR_CAP].to_string();
        s.push_str("\n\n[diff 过长，已截断]");
        s
    } else {
        diff
    };
    let commits_block = if commits.is_empty() {
        "(无 commit 列表)".to_string()
    } else {
        commits.iter().take(50).map(|c| format!("- {}", c)).collect::<Vec<_>>().join("\n")
    };

    let user_prompt = format!(
        "Base: {}\nHead: {}\n\nCommits ({} 个):\n{}\n\nDiff:\n```diff\n{}\n```\n\n请生成一份 PR 描述。",
        base_branch, head_branch, commits.len(), commits_block, truncated_diff
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;
    let event = format!("ai:stream:{}", stream_id);
    let cancel = register_ai_cancel(&stream_id);
    let result = call_ai_stream(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_PR_DESC_SYSTEM_PROMPT, &user_prompt, 1024, &app, &event, cancel,
    ).await;
    unregister_ai_cancel(&stream_id);
    result
}

const AI_CONFLICT_SYSTEM_PROMPT: &str =
    "你是资深工程师，帮用户解决 git merge 冲突。分析\"我的版本 (ours)\"和\"对方版本 (theirs)\"\
     （必要时参考\"共同祖先 (base)\"），推荐采纳哪一方。\n\n\
     必须输出严格的 JSON 对象，无其他文字、无代码块包裹：\n\
     {\"recommendation\": \"ours\"|\"theirs\"|\"both\", \"reasoning\": \"1-2 句中文说明\"}\n\n\
     判断准则：\n\
     - 一方明显只是表面修改（格式化、改注释、变量名），另一方是真实功能变更 → 倾向后者\n\
     - 两方修改互不冲突（改的是同段代码的不同方面）→ \"both\"（拼接采纳）\n\
     - 两方做同一件事的不同实现 → 选更安全/更清晰的那方，说明依据\n\
     - 不要建议用户自己看，给出最有可能正确的答案";

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConflictSuggestion {
    /// "ours" | "theirs" | "both"
    pub recommendation: String,
    pub reasoning: String,
}

#[tauri::command]
pub async fn ai_resolve_conflict(
    provider: String,
    api_key: String,
    model: Option<String>,
    base_url: Option<String>,
    file: String,
    ours: String,
    theirs: String,
    base: Option<String>,
) -> Result<ConflictSuggestion, String> {
    if api_key.trim().is_empty() {
        return Err("没有配置 API Key，请先到设置里填上".to_string());
    }

    // Cap each side to keep token usage reasonable
    let ours_c   = trunc(&ours, 4000);
    let theirs_c = trunc(&theirs, 4000);
    let base_c   = base.as_deref().map(|s| trunc(s, 4000)).unwrap_or_else(|| "（无共同祖先）".to_string());

    let user_prompt = format!(
        "文件：{}\n\n[ours - 我的版本]\n```\n{}\n```\n\n[theirs - 对方版本]\n```\n{}\n```\n\n[base - 共同祖先]\n```\n{}\n```\n\n请给出 JSON 建议。",
        file, ours_c, theirs_c, base_c
    );

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .read_timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(fe)?;

    let raw = call_ai(
        &client, &provider, &api_key, model.as_deref(), base_url.as_deref(),
        AI_CONFLICT_SYSTEM_PROMPT, &user_prompt, 1024,
    ).await?;

    let v = extract_json_object(&raw).ok_or_else(||
        format!("AI 返回的不是 JSON：{}", trunc(&raw, 200))
    )?;

    let rec = v["recommendation"].as_str()
        .ok_or_else(|| "AI 返回缺少 recommendation 字段".to_string())?;
    let rec_normalized = match rec {
        "ours" | "theirs" | "both" => rec.to_string(),
        _ => return Err(format!("AI 返回了无法识别的推荐：{}", rec)),
    };
    let reasoning = v["reasoning"].as_str().unwrap_or("（无说明）").to_string();

    Ok(ConflictSuggestion {
        recommendation: rec_normalized,
        reasoning,
    })
}

fn translate_provider_error(status: u16, body: &str, provider: &str) -> String {
    let body_l = body.to_ascii_lowercase();
    if status == 401 || body_l.contains("invalid api key") || body_l.contains("authentication") {
        return format!("{} 认证失败：API Key 不正确或已失效", provider);
    }
    if status == 429 || body_l.contains("rate") {
        return format!("{} 调用限频，请稍后再试", provider);
    }
    if status == 404 || body_l.contains("model_not_found") || body_l.contains("does not exist") {
        return format!("{} 报错：模型不存在或没有访问权限", provider);
    }
    if status >= 500 {
        return format!("{} 服务异常 ({})，请稍后再试", provider, status);
    }
    format!("{} 返回 {}：{}", provider, status, trunc(body, 300))
}

/// Pull the first balanced `{...}` JSON object out of arbitrary text.
/// Tolerates code-fence wrapping, prose before/after, and `{` characters
/// inside strings (single backslash escape only — good enough for the
/// AI-shaped JSON we deal with).
fn extract_json_object(raw: &str) -> Option<serde_json::Value> {
    let bytes = raw.as_bytes();
    let mut start: Option<usize> = None;
    let mut depth = 0_usize;
    let mut in_str = false;
    let mut escape = false;
    for (i, &b) in bytes.iter().enumerate() {
        if in_str {
            if escape { escape = false; continue }
            if b == b'\\' { escape = true; continue }
            if b == b'"' { in_str = false }
            continue
        }
        match b {
            b'"' => in_str = true,
            b'{' => {
                if start.is_none() { start = Some(i) }
                depth += 1
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    if let Some(s) = start {
                        let slice = &raw[s..=i];
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(slice) {
                            return Some(v)
                        }
                        // Reset and keep scanning in case the first `{` was junk.
                        start = None;
                    }
                }
            }
            _ => {}
        }
    }
    None
}

fn trunc(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let cut: String = s.chars().take(n).collect();
        format!("{}…", cut)
    }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/// Convert any displayable error into a user-friendly Chinese string. Falls
/// back to the original message if nothing matches.
pub(crate) fn fe<E: std::fmt::Display>(e: E) -> String {
    friendly_error(&e.to_string())
}

fn friendly_error(msg: &str) -> String {
    let lower = msg.to_ascii_lowercase();

    // Empty / blank — already-friendly fallback
    if msg.trim().is_empty() {
        return "未知错误".to_string();
    }

    // No git identity configured
    if lower.contains("config value 'user.name'")
        || lower.contains("config value 'user.email'")
        || (lower.contains("signature") && lower.contains("not found"))
    {
        return "请先告诉 Git 你是谁：\n  git config --global user.name \"你的名字\"\n  git config --global user.email \"你的邮箱\""
            .to_string();
    }

    // Merge / rebase situations
    if lower.contains("refusing to merge unrelated histories") {
        return "这两个仓库没有共同历史，无法直接合并。".to_string();
    }
    if lower.contains("you have unmerged files") || lower.contains("unresolved conflicts") {
        return "还有未解决的冲突，请先处理冲突再继续。".to_string();
    }
    if lower.contains("could not revert") || lower.contains("could not apply") {
        return "操作过程中出现冲突，请在冲突视图里处理。".to_string();
    }
    if lower.contains("not fully merged") {
        return "这个分支还有未合并到主线的提交。确认要丢弃就再勾选强制删除。".to_string();
    }
    if lower.contains("cannot delete branch") && lower.contains("checked out") {
        return "不能删除当前正在使用的分支。先切到别的分支再来。".to_string();
    }
    if lower.contains("nothing to commit") || lower.contains("no changes added to commit") {
        // Common cause when committing a folder that contains git submodules
        // whose working trees are dirty: the parent's submodule pointer didn't
        // change, so there's nothing for the outer commit to record. Surface
        // that hint along with the literal git message.
        if lower.contains("submodule") || lower.contains("subproject") || lower.contains("dirty") {
            return "没有可提交的改动 — 子模块工作树虽然脏了，但它们指向的 commit 没变，外层仓库不会记录这种状态。\n要把子模块改动也提交，请先进入对应的子模块目录提交。".to_string();
        }
        return "没有可提交的改动。看到的修改可能只在子模块内部，外层仓库的索引并没变。".to_string();
    }
    if lower.contains("merge_head") && lower.contains("not found") {
        return "当前不在合并过程中。".to_string();
    }
    if lower.contains("would be overwritten by") {
        return "本地有未保存的改动会被覆盖，请先保存进度或撤销改动。".to_string();
    }

    // Auth / network during push / pull / clone
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("permission denied (publickey)")
    {
        return "认证失败：检查你的 SSH key 或访问令牌是否配置正确。".to_string();
    }
    if lower.contains("could not resolve host") || lower.contains("name or service not known") {
        return "网络无法访问远程仓库，请检查网络连接或仓库地址。".to_string();
    }
    if lower.contains("repository not found") || lower.contains("not found") && lower.contains("repository") {
        return "找不到这个远程仓库，请确认 URL 或访问权限。".to_string();
    }
    if lower.contains("non-fast-forward") || lower.contains("updates were rejected") {
        return "远程分支有新的提交，请先同步后再推送。".to_string();
    }

    // Branch / refs
    if lower.contains("a branch named") && lower.contains("already exists") {
        return "已经有同名分支了，请换一个名字。".to_string();
    }
    if lower.contains("no upstream") {
        return "当前分支没有设置远程跟踪分支。".to_string();
    }

    // Detached HEAD warnings
    if lower.contains("detached head") {
        return "当前处于分离 HEAD 状态，新提交不会保存到任何分支。".to_string();
    }

    // Object / oid not found
    if lower.contains("does not exist") || (lower.contains("not found") && lower.contains("commit")) {
        return format!("找不到目标：{}", msg);
    }

    // Fallback — return the original, slightly tidied
    msg.trim().to_string()
}

fn get_current_branch(repo: &Repository) -> String {
    let Ok(head) = repo.head() else { return "HEAD".to_string() };
    if head.is_branch() {
        head.shorthand().unwrap_or("HEAD").to_string()
    } else {
        // detached HEAD — show short commit hash
        head.target()
            .map(|oid| oid.to_string()[..7].to_string())
            .unwrap_or_else(|| "HEAD".to_string())
    }
}

fn get_changed_files(repo: &Repository) -> Result<Vec<ChangedFile>, String> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut opts)).map_err(fe)?;
    let files = statuses.iter().map(|entry| {
        let s = entry.status();
        let staged_status = if s.is_index_new() { Some("A".to_string()) }
            else if s.is_index_modified() { Some("M".to_string()) }
            else if s.is_index_deleted() { Some("D".to_string()) }
            else if s.is_index_renamed() { Some("R".to_string()) }
            else { None };
        let unstaged_status = if s.is_wt_new() { Some("?".to_string()) }
            else if s.is_wt_modified() { Some("M".to_string()) }
            else if s.is_wt_deleted() { Some("D".to_string()) }
            else if s.is_wt_renamed() { Some("R".to_string()) }
            else if s.is_conflicted() { Some("C".to_string()) }
            else { None };
        ChangedFile {
            path: entry.path().unwrap_or("").to_string(),
            staged_status,
            unstaged_status,
            is_submodule: false,
        }
    }).collect();
    Ok(files)
}

fn get_ahead_behind(repo: &Repository) -> Result<(usize, usize), git2::Error> {
    let head = repo.head()?;
    let local = head.target().ok_or_else(|| git2::Error::from_str("no HEAD"))?;
    let branch_name = head.shorthand().ok_or_else(|| git2::Error::from_str("no branch"))?;
    // Use the configured upstream (branch.<name>.remote / merge) instead of
    // hardcoding refs/remotes/origin/<branch> — the remote may not be "origin"
    // and the local branch may track a different-named upstream.
    let local_branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
    let upstream_oid = local_branch.upstream()?.get().target()
        .ok_or_else(|| git2::Error::from_str("upstream has no target"))?;
    repo.graph_ahead_behind(local, upstream_oid)
}

fn repo_state_str(repo: &Repository) -> String {
    use git2::RepositoryState::*;
    match repo.state() {
        Clean => "clean",
        Merge => "merging",
        Revert | RevertSequence => "reverting",
        CherryPick | CherryPickSequence => "cherry-picking",
        Bisect => "bisecting",
        Rebase | RebaseInteractive | RebaseMerge => "rebasing",
        ApplyMailbox | ApplyMailboxOrRebase => "applying",
    }.to_string()
}

fn is_binary_content(data: &[u8]) -> bool {
    data.iter().take(8000).any(|&b| b == 0)
}

fn count_conflict_hunks(content: &str) -> usize {
    content.lines().filter(|l| l.starts_with("<<<<<<<")).count()
}

/// Walk through the workdir file (which has conflict markers) and emit hunk
/// descriptors anchored to line numbers in the corresponding ours/theirs blobs.
///
/// State while iterating lines:
///   Common         — line counts toward both ours and theirs
///   Ours    (after <<<<<<<)  — counts toward ours only
///   Base    (after |||||||)  — diff3 ancestor section; skip
///   Theirs  (after =======)  — counts toward theirs only
///   (>>>>>>>)                — close hunk, back to Common
fn parse_conflict_hunks(content: &str) -> Vec<ConflictHunk> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mode { Common, Ours, Base, Theirs }

    let mut hunks: Vec<ConflictHunk> = Vec::new();
    let mut mode = Mode::Common;
    let mut ours_line: u32 = 1;
    let mut theirs_line: u32 = 1;
    let mut current = ConflictHunk {
        ours_start: 0, ours_end: 0, theirs_start: 0, theirs_end: 0,
    };

    for line in content.split('\n') {
        if line.starts_with("<<<<<<<") {
            current = ConflictHunk {
                ours_start: ours_line,
                ours_end: ours_line,
                theirs_start: theirs_line,
                theirs_end: theirs_line,
            };
            mode = Mode::Ours;
        } else if line.starts_with("|||||||") {
            current.ours_end = ours_line;
            mode = Mode::Base;
        } else if line.starts_with("=======") && mode != Mode::Common {
            if mode == Mode::Ours {
                current.ours_end = ours_line;
            }
            current.theirs_start = theirs_line;
            current.theirs_end = theirs_line;
            mode = Mode::Theirs;
        } else if line.starts_with(">>>>>>>") {
            current.theirs_end = theirs_line;
            hunks.push(current.clone());
            mode = Mode::Common;
        } else {
            match mode {
                Mode::Common => { ours_line += 1; theirs_line += 1; }
                Mode::Ours   => { ours_line += 1; }
                Mode::Base   => { /* diff3 ancestor — skip */ }
                Mode::Theirs => { theirs_line += 1; }
            }
        }
    }

    hunks
}

// ═══════════════════════════════════════════════════════════════════════════
// Round 1: Reset · Fetch · Remotes · Tags
// ═══════════════════════════════════════════════════════════════════════════

// ── Reset ────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn reset_to_commit(path: String, sha: String, mode: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&sha).map_err(fe)?;
    let obj = repo.find_object(oid, None).map_err(fe)?;
    let reset_kind = match mode.as_str() {
        "soft"  => git2::ResetType::Soft,
        "hard"  => git2::ResetType::Hard,
        "mixed" => git2::ResetType::Mixed,
        other   => return Err(format!("unknown reset mode: {}", other)),
    };
    repo.reset(&obj, reset_kind, None).map_err(fe)?;
    Ok(())
}

// ── Fetch ────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn git_fetch(
    app: tauri::AppHandle,
    path: String,
    remote: Option<String>,
    prune: bool,
) -> Result<(), String> {
    let mut args: Vec<String> = vec!["fetch".into(), "--progress".into()];
    if prune { args.push("--prune".into()); }
    match remote.as_deref() {
        Some("__all__") | None => args.push("--all".into()),
        Some(r) => args.push(r.to_string()),
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    streaming_git("fetch", &arg_refs, Some(&path), &app).await
}

// ── Remotes ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
    pub push_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub file: String,
    pub line: u32,
    pub column: u32,
    pub content: String,
}

/// Cross-file content search via `git grep`. Reasons we shell out:
///   - Automatically respects `.gitignore` (no manually walking the tree)
///   - Comes with every git install (no new dep)
///   - Multithreaded by default; competitive with ripgrep for typical repos
///
/// Output is `--null` separated so paths with spaces / colons survive
/// parsing intact. Hits are capped at MAX_RESULTS to keep the UI snappy
/// for "open paren" -style queries that match everything.
#[tauri::command]
pub async fn grep_repo(
    path: String,
    query: String,
    regex: Option<bool>,
    case_sensitive: Option<bool>,
    pathspec: Option<String>,
) -> Result<Vec<SearchHit>, String> {
    const MAX_RESULTS: usize = 1000;
    if query.is_empty() {
        return Ok(Vec::new())
    }

    let mut args: Vec<String> = vec![
        // No-optional-locks so a read-only grep doesn't end up rewriting
        // the index stat cache and tripping the file watcher.
        "--no-optional-locks".into(),
        "grep".into(),
        // `-n` line numbers, `--column` column, `-I` skip binary files,
        // `--null` (-z) NUL-separate fields so paths with `:` survive.
        "-n".into(), "--column".into(), "-I".into(), "--null".into(),
        "--no-color".into(),
        // Cap matches per file so one huge file can't drown the others.
        "--max-count=50".into(),
    ];
    if !case_sensitive.unwrap_or(false) { args.push("-i".into()) }
    if regex.unwrap_or(false) {
        args.push("-E".into()) // extended regex
    } else {
        args.push("-F".into()) // fixed string
    }
    // Sentinel between options and the pattern so a query starting with `-`
    // (e.g. `--no-color`) isn't interpreted as a flag.
    args.push("-e".into());
    args.push(query.clone());
    if let Some(spec) = pathspec.as_ref().filter(|s| !s.trim().is_empty()) {
        args.push("--".into());
        args.push(spec.clone());
    }

    let out = tokio::process::Command::new("git")
        .args(&args)
        .current_dir(&path)
        .output()
        .await
        .map_err(fe)?;

    // Exit code 1 = no matches (not an error). Exit code 128 = real error.
    if !out.status.success() {
        let code = out.status.code().unwrap_or(0);
        if code == 1 {
            return Ok(Vec::new())
        }
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if stderr.is_empty() { format!("git grep failed (code {})", code) } else { stderr });
    }

    // Output format with --null: <path>\0<line>\0<col>\0<content>\n
    let mut hits: Vec<SearchHit> = Vec::new();
    for raw_line in out.stdout.split(|b| *b == b'\n') {
        if raw_line.is_empty() { continue }
        // Split on NUL (`\0`).
        let mut parts = raw_line.splitn(4, |b| *b == 0);
        let file = match parts.next() {
            Some(b) => String::from_utf8_lossy(b).into_owned(),
            None => continue,
        };
        let line_n: u32 = parts.next()
            .and_then(|b| std::str::from_utf8(b).ok())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let col_n: u32 = parts.next()
            .and_then(|b| std::str::from_utf8(b).ok())
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let content = parts.next()
            .map(|b| String::from_utf8_lossy(b).into_owned())
            .unwrap_or_default();
        if line_n == 0 { continue }
        hits.push(SearchHit {
            file,
            line: line_n,
            column: col_n,
            content,
        });
        if hits.len() >= MAX_RESULTS { break }
    }
    Ok(hits)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FilePreview {
    pub content: String,
    pub truncated: bool,
    pub line_count: u32,
    pub is_binary: bool,
}

/// Read the full text of a file under the workspace root for the search
/// preview pane. Caps at MAX_BYTES so opening a 200 MB JSON dump can't
/// lock up the UI — we slice at a UTF-8 char boundary and set `truncated`
/// so the frontend can show a banner. Returns `is_binary: true` (with
/// empty content) when we detect a NUL byte in the first sample so the UI
/// shows a "binary file" hint instead of rendering garbage.
#[tauri::command]
pub fn read_file(path: String, file: String) -> Result<FilePreview, String> {
    const MAX_BYTES: usize = 2 * 1024 * 1024;
    let abs = std::path::Path::new(&path).join(&file);
    let bytes = std::fs::read(&abs).map_err(fe)?;
    let truncated = bytes.len() > MAX_BYTES;
    let slice: &[u8] = if truncated { &bytes[..MAX_BYTES] } else { &bytes };
    let sniff_end = slice.len().min(8 * 1024);
    let is_binary = slice[..sniff_end].contains(&0u8);
    if is_binary {
        return Ok(FilePreview {
            content: String::new(),
            truncated,
            line_count: 0,
            is_binary: true,
        })
    }
    let mut content = String::from_utf8_lossy(slice).into_owned();
    while !content.is_empty() && !content.is_char_boundary(content.len()) {
        content.pop();
    }
    let line_count = content.lines().count() as u32;
    Ok(FilePreview { content, truncated, line_count, is_binary: false })
}

/// Read a small slice of a file around `line` for the search-result preview
/// — N lines above and below. Returns empty string for files we can't read
/// (binary, gone, permission denied) so the UI just shows the matched line.
#[tauri::command]
pub fn read_file_context(
    path: String,
    file: String,
    line: u32,
    context: Option<u32>,
) -> Result<Vec<String>, String> {
    let n = context.unwrap_or(5);
    let abs = std::path::Path::new(&path).join(&file);
    let text = match std::fs::read_to_string(&abs) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let lines: Vec<&str> = text.lines().collect();
    if (line as usize) == 0 || (line as usize) > lines.len() {
        return Ok(Vec::new())
    }
    let center = line as usize - 1;
    let start = center.saturating_sub(n as usize);
    let end = (center + n as usize + 1).min(lines.len());
    Ok(lines[start..end].iter().map(|s| s.to_string()).collect())
}

/// Drop a `.gitkeep` placeholder into `dir` (relative to `path`) so git
/// starts tracking the directory. The user's untracked-empty-folder
/// quick action wires to this — once `.gitkeep` exists, git sees the
/// directory naturally and our usual status pass picks it up.
/// Errors if `dir` escapes `path` (path traversal) or if the directory
/// doesn't exist on disk.
#[tauri::command]
pub fn add_gitkeep(path: String, dir: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&path);
    let target = root.join(&dir);
    let canon = target.canonicalize().map_err(fe)?;
    let root_canon = root.canonicalize().map_err(fe)?;
    if !canon.starts_with(&root_canon) {
        return Err("path traversal rejected".into())
    }
    if !canon.is_dir() {
        return Err(format!("not a directory: {}", dir))
    }
    let gk = canon.join(".gitkeep");
    if gk.exists() { return Ok(()) }
    std::fs::write(&gk, b"").map_err(fe)?;
    Ok(())
}

/// Remove an empty directory from the working tree. Safe because
/// `std::fs::remove_dir` refuses non-empty dirs — if the user managed
/// to drop a file in between the scan and this click, the OS will
/// error out rather than recursively nuke their work.
/// Same path-traversal guard as add_gitkeep.
#[tauri::command]
pub fn remove_empty_dir(path: String, dir: String) -> Result<(), String> {
    let root = std::path::PathBuf::from(&path);
    let target = root.join(&dir);
    let canon = target.canonicalize().map_err(fe)?;
    let root_canon = root.canonicalize().map_err(fe)?;
    if !canon.starts_with(&root_canon) {
        return Err("path traversal rejected".into())
    }
    if canon == root_canon {
        return Err("refusing to remove repo root".into())
    }
    std::fs::remove_dir(&canon).map_err(fe)?;
    Ok(())
}

/// Walk the working tree for empty directories git wouldn't surface via
/// `git status` (because git only tracks files — empty folders are invisible
/// to it). Returns paths relative to the repo root. Used by the sidebar to
/// render a "newly-created empty folder, won't get committed" hint with the
/// untracked-N badge.
///
/// Conditions for inclusion:
///   - directory contains zero entries (truly empty), OR every child is
///     itself an untracked empty dir / `.git` / git-ignored
///   - the directory itself is not git-ignored (.gitignore, .git/info/exclude)
///   - not `.git` and not inside `.git`
///
/// Depth-limited (12 levels) and entry-capped (5_000 nodes) so a
/// pathological tree can't lock us up. `.git`, `.DS_Store` and symlinks are
/// short-circuited early so we never enter them.
#[tauri::command]
pub fn list_untracked_empty_dirs(path: String) -> Result<Vec<String>, String> {
    const MAX_DEPTH: usize = 12;
    const MAX_VISITED: usize = 5_000;
    let repo = Repository::open(&path).map_err(fe)?;
    let root = std::path::PathBuf::from(&path);
    let mut out: Vec<String> = Vec::new();
    let mut visited: usize = 0;
    walk_for_empty_dirs(&root, &root, &repo, 0, MAX_DEPTH, &mut visited, MAX_VISITED, &mut out);
    out.sort();
    Ok(out)
}

/// Recursive helper. Returns `true` if `dir` is considered "empty for git"
/// (no real files inside at any depth), which lets parents fold their state
/// upward — a directory whose only child is an empty subdir is itself empty.
fn walk_for_empty_dirs(
    root: &std::path::Path,
    dir: &std::path::Path,
    repo: &Repository,
    depth: usize,
    max_depth: usize,
    visited: &mut usize,
    max_visited: usize,
    out: &mut Vec<String>,
) -> bool {
    if *visited >= max_visited { return false }
    if depth > max_depth { return false }
    let entries = match std::fs::read_dir(dir) {
        Ok(it) => it,
        Err(_) => return false,
    };
    let mut has_file = false;
    let mut empty_subdirs: Vec<std::path::PathBuf> = Vec::new();
    for entry in entries.flatten() {
        *visited += 1;
        if *visited >= max_visited { break }
        let name_os = entry.file_name();
        let name = name_os.to_string_lossy();
        if name == ".git" || name == ".DS_Store" { continue }
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_symlink() { continue }   // never follow symlinks
        let p = entry.path();
        let rel = p.strip_prefix(root).unwrap_or(&p);
        // Anything git is told to ignore counts as "not there" for this
        // walk — gives the user the same result as `git status -uall`.
        if repo.is_path_ignored(rel).unwrap_or(false) { continue }
        if file_type.is_dir() {
            let sub_empty = walk_for_empty_dirs(root, &p, repo, depth + 1, max_depth, visited, max_visited, out);
            if sub_empty {
                empty_subdirs.push(p);
            } else {
                // Subdir has real content — this dir is therefore not empty.
                has_file = true;
            }
        } else if file_type.is_file() {
            has_file = true;
        }
    }
    // If this dir has any real files, none of the bubbled-up "subdir is
    // empty" markers should be emitted — they're a side effect of an
    // otherwise non-empty parent, and the user will see them naturally
    // once they add a file. Emit them only when the parent itself is the
    // bare leaf.
    if !has_file {
        // The deepest empty leaves are what the UI wants. If we already
        // recorded a deeper empty path under one of these subdirs, leave
        // them — but ALSO mark this directory as the canonical empty
        // node if it has zero entries to begin with (root case).
        if empty_subdirs.is_empty() && dir != root {
            let rel = dir.strip_prefix(root).unwrap_or(dir).to_string_lossy().into_owned();
            // Repo root is never reported.
            if !rel.is_empty() && !repo.is_path_ignored(std::path::Path::new(&rel)).unwrap_or(false) {
                out.push(rel);
            }
        } else {
            // Bubble the empty subdir paths up so they appear in `out`.
            for p in &empty_subdirs {
                let rel = p.strip_prefix(root).unwrap_or(p).to_string_lossy().into_owned();
                out.push(rel);
            }
        }
        return true
    }
    false
}

#[tauri::command]
pub fn list_remotes(path: String) -> Result<Vec<RemoteInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let names = repo.remotes().map_err(fe)?;
    let mut out = Vec::new();
    for i in 0..names.len() {
        let Some(name) = names.get(i) else { continue };
        let remote = repo.find_remote(name).map_err(fe)?;
        let url = remote.url().unwrap_or("").to_string();
        let push_url = remote.pushurl().map(|s| s.to_string());
        out.push(RemoteInfo { name: name.to_string(), url, push_url });
    }
    Ok(out)
}

#[tauri::command]
pub fn add_remote(path: String, name: String, url: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    repo.remote(&name, &url).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn remove_remote(path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    repo.remote_delete(&name).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub fn rename_remote(path: String, old_name: String, new_name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    // remote_rename returns problems list (refspecs that couldn't be auto-fixed);
    // we forward them as a warning string when non-empty.
    let problems = repo.remote_rename(&old_name, &new_name).map_err(fe)?;
    if !problems.is_empty() {
        let msgs: Vec<String> = (0..problems.len())
            .filter_map(|i| problems.get(i).map(|s| s.to_string()))
            .collect();
        return Err(format!("rename 完成但有问题的 refspec：{}", msgs.join("; ")));
    }
    Ok(())
}

#[tauri::command]
pub fn set_remote_url(path: String, name: String, url: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    repo.remote_set_url(&name, &url).map_err(fe)?;
    Ok(())
}

// ── Tags ─────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TagInfo {
    pub name: String,
    /// OID of the tag *reference* (for annotated tags, this is the tag object;
    /// for lightweight tags, it's the same as `target_oid`).
    pub oid: String,
    /// OID of the commit the tag ultimately points to.
    pub target_oid: String,
    pub target_short: String,
    pub annotated: bool,
    pub message: Option<String>,
    pub tagger: Option<String>,
    pub time: Option<i64>,
}

#[tauri::command]
pub fn list_tags(path: String) -> Result<Vec<TagInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let names = repo.tag_names(None).map_err(fe)?;
    let mut out = Vec::new();
    for i in 0..names.len() {
        let Some(name) = names.get(i) else { continue };
        let ref_name = format!("refs/tags/{}", name);
        let Ok(reference) = repo.find_reference(&ref_name) else { continue };
        let Some(oid) = reference.target() else { continue };

        // Annotated tags resolve to a Tag object pointing at a commit;
        // lightweight tags resolve directly to a Commit.
        let (target_oid, annotated, message, tagger, time) = match repo.find_tag(oid) {
            Ok(tag) => {
                let target = tag.target_id();
                let msg = tag.message().map(|s| s.trim().to_string());
                let tg = tag.tagger().map(|s| format!("{} <{}>",
                    s.name().unwrap_or(""),
                    s.email().unwrap_or("")));
                let when = tag.tagger().map(|s| s.when().seconds());
                (target, true, msg, tg, when)
            }
            Err(_) => (oid, false, None, None, None),
        };

        out.push(TagInfo {
            name: name.to_string(),
            oid: oid.to_string(),
            target_oid: target_oid.to_string(),
            target_short: target_oid.to_string().chars().take(7).collect(),
            annotated,
            message,
            tagger,
            time,
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn create_tag(
    path: String,
    name: String,
    target: String,
    message: Option<String>,
) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&target).map_err(fe)?;
    let obj = repo.find_object(oid, None).map_err(fe)?;
    match message.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(msg) => {
            // Annotated tag — needs a signature.
            let sig = repo.signature().map_err(fe)?;
            repo.tag(&name, &obj, &sig, msg, false).map_err(fe)?;
        }
        None => {
            repo.tag_lightweight(&name, &obj, false).map_err(fe)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn delete_tag(path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    repo.tag_delete(&name).map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub async fn push_tag(
    app: tauri::AppHandle,
    path: String,
    remote: String,
    tag: String,
) -> Result<(), String> {
    let refspec = format!("refs/tags/{}", tag);
    streaming_git(
        "push",
        &["push", "--progress", &remote, &refspec],
        Some(&path),
        &app,
    ).await
}

#[tauri::command]
pub async fn delete_remote_tag(
    app: tauri::AppHandle,
    path: String,
    remote: String,
    tag: String,
) -> Result<(), String> {
    let refspec = format!(":refs/tags/{}", tag);
    streaming_git(
        "push",
        &["push", "--progress", &remote, &refspec],
        Some(&path),
        &app,
    ).await
}

// ═══════════════════════════════════════════════════════════════════════════
// Round 2: Reflog · GPG sign
// ═══════════════════════════════════════════════════════════════════════════

// ── Reflog (时光机) ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReflogEntry {
    /// HEAD@{N} index — 0 is the most recent move.
    pub index: usize,
    pub oid: String,
    pub short: String,
    pub message: String,
    pub action: String,        // first token of message: commit, checkout, reset, …
    pub time: i64,
    pub committer: String,
}

#[tauri::command]
pub fn list_reflog(
    path: String,
    ref_name: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ReflogEntry>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let r = ref_name.unwrap_or_else(|| "HEAD".to_string());
    let reflog = repo.reflog(&r).map_err(fe)?;
    let cap = limit.unwrap_or(200);
    let mut out = Vec::new();
    for (i, entry) in reflog.iter().enumerate() {
        if i >= cap { break }
        let oid = entry.id_new();
        let msg = entry.message().unwrap_or("").to_string();
        let action = msg.split(':').next().unwrap_or("").trim().to_string();
        let sig = entry.committer();
        let committer = format!("{} <{}>",
            sig.name().unwrap_or(""),
            sig.email().unwrap_or(""));
        let time = sig.when().seconds();
        out.push(ReflogEntry {
            index: i,
            oid: oid.to_string(),
            short: oid.to_string().chars().take(7).collect(),
            message: msg,
            action,
            time,
            committer,
        });
    }
    Ok(out)
}

/// Hard-reset HEAD to a specific reflog entry. Equivalent to
/// `git reset --hard HEAD@{N}` but resolved via the OID so it survives
/// further reflog activity.
#[tauri::command]
pub fn restore_to_reflog(path: String, sha: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let oid = git2::Oid::from_str(&sha).map_err(fe)?;
    let obj = repo.find_object(oid, None).map_err(fe)?;
    repo.reset(&obj, git2::ResetType::Hard, None).map_err(fe)?;
    Ok(())
}

// ── GPG sign-aware commit ────────────────────────────────────────────────

/// Replacement for `save_progress` that optionally produces a signed commit.
/// When `sign` is true we add `-S` so the user's existing gpg/ssh signing
/// config (`user.signingkey`, `gpg.format`, agent, etc.) just works.
#[tauri::command]
pub async fn save_progress_signed(
    path: String,
    message: String,
    sign: bool,
) -> Result<String, String> {
    if !sign {
        // Fast path — same as plain save_progress.
        return save_progress(path, message).await;
    }
    // Stage everything (matches save_progress semantics).
    run_git_simple(&["add", "-A"], &path).await?;
    // Commit with -S; rely on user's git config for signing key + agent.
    run_git_simple(&["commit", "-S", "-m", &message], &path).await?;
    // Return the resulting HEAD sha for parity with save_progress.
    let repo = Repository::open(&path).map_err(fe)?;
    let head = repo.head().map_err(fe)?;
    let oid = head.target().ok_or_else(|| "HEAD detached?".to_string())?;
    Ok(oid.to_string())
}

/// Commit only the listed pathspecs. Used by the Changelists feature so a
/// "save progress" while a custom changelist is active commits exclusively
/// the files in that changelist; files in other groups stay where they are
/// (staged or unstaged, untouched).
///
/// Mirrors `save_progress` semantics for the chosen paths: we `git add --
/// <paths>` first so callers don't have to manually stage every file (an
/// auto-stage matches the "click one button, save what's selected" UX). We
/// then `git commit -m … -- <paths>` so the resulting commit contains only
/// those paths even if other files happen to be staged.
#[tauri::command]
pub async fn save_progress_pathspec(
    path: String,
    message: String,
    pathspec: Vec<String>,
    sign: bool,
) -> Result<String, String> {
    if pathspec.is_empty() {
        return Err("save_progress_pathspec: pathspec must be non-empty".to_string());
    }

    // Stage the listed paths. Mirrors save_progress's `git add -A` but
    // scoped — equally handles untracked files (`git add` adds them) and
    // deletions (`git add <deleted>` records the removal).
    {
        let mut args: Vec<&str> = Vec::with_capacity(2 + pathspec.len());
        args.push("add");
        args.push("--");
        for p in &pathspec {
            args.push(p.as_str());
        }
        run_git_simple(&args, &path).await?;
    }

    // Commit only those paths. The `--` separator guards against any path
    // that happens to also be a valid ref name (rare but real).
    {
        let mut args: Vec<&str> = Vec::with_capacity(5 + pathspec.len());
        args.push("commit");
        args.push("-m");
        args.push(&message);
        if sign {
            args.push("-S");
        }
        args.push("--");
        for p in &pathspec {
            args.push(p.as_str());
        }
        run_git_simple(&args, &path).await?;
    }

    let repo = Repository::open(&path).map_err(fe)?;
    let head = repo.head().map_err(fe)?;
    let oid = head.target().ok_or_else(|| "HEAD has no target".to_string())?;
    Ok(oid.to_string())
}

// ═══════════════════════════════════════════════════════════════════════════
// Round 3: Hunk staging · Blame
// ═══════════════════════════════════════════════════════════════════════════

// ── Hunk-level staging ───────────────────────────────────────────────────
//
// Implementation strategy: build a minimal unified-diff patch for just the
// chosen hunk (with the right file header) and feed it to `git apply
// --cached` (or `--cached --reverse` for unstaging). This delegates the
// hard part (binary detection, rename handling, line numbering) to git
// itself instead of reimplementing it.

async fn run_git_with_stdin(args: &[&str], cwd: &str, stdin: &str) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let mut cmd = tokio::process::Command::new("git");
    cmd.args(args)
        .current_dir(cwd)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(fe)?;
    {
        let mut s = child.stdin.take().ok_or_else(|| "no stdin".to_string())?;
        s.write_all(stdin.as_bytes()).await.map_err(fe)?;
        // Drop closes the pipe → git sees EOF and starts processing.
    }
    let out = child.wait_with_output().await.map_err(fe)?;
    if out.status.success() { Ok(()) } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(friendly_error(if err.is_empty() { "git apply 失败" } else { &err }))
    }
}

/// Capture the file header (`diff --git ...`, `index ...`, `--- ...`, `+++ ...`)
/// and the body of each hunk for `file`. Used to build per-hunk patches.
fn extract_hunks_from_diff(diff_text: &str) -> Option<(Vec<String>, Vec<String>)> {
    // Returns (header_lines, hunk_bodies) where each hunk_body starts with
    // `@@ ... @@` and includes all its context/+/- lines until the next
    // `@@` (or EOF).
    let mut header: Vec<String> = Vec::new();
    let mut hunks: Vec<String> = Vec::new();
    let mut current: Option<String> = None;

    for line in diff_text.split_inclusive('\n') {
        if line.starts_with("@@") {
            if let Some(h) = current.take() { hunks.push(h); }
            current = Some(line.to_string());
        } else if current.is_some() {
            current.as_mut().unwrap().push_str(line);
        } else {
            header.push(line.to_string());
        }
    }
    if let Some(h) = current { hunks.push(h); }
    if header.is_empty() || hunks.is_empty() { return None; }
    Some((header, hunks))
}

async fn run_git_capture(args: &[&str], cwd: &str) -> Result<String, String> {
    let out = tokio::process::Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .await
        .map_err(fe)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(friendly_error(&err));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

async fn apply_hunk(
    path: &str,
    file: &str,
    hunk_index: usize,
    reverse: bool,   // true = unstage (apply --cached --reverse against staged diff)
) -> Result<(), String> {
    // Source diff: working-tree → index for stage, index → HEAD for unstage.
    let raw = if reverse {
        run_git_capture(&["diff", "--cached", "--", file], path).await?
    } else {
        run_git_capture(&["diff", "--", file], path).await?
    };
    if raw.trim().is_empty() {
        return Err("没有可应用的改动".to_string());
    }
    let (header, hunks) = extract_hunks_from_diff(&raw)
        .ok_or_else(|| "diff 解析失败".to_string())?;
    let hunk = hunks.get(hunk_index)
        .ok_or_else(|| format!("hunk #{} 不存在（共 {} 个）", hunk_index, hunks.len()))?;
    let patch = format!("{}{}", header.concat(), hunk);
    let mut args: Vec<&str> = vec!["apply", "--cached"];
    if reverse { args.push("--reverse"); }
    // `--unidiff-zero` would relax context matching but isn't needed here;
    // the diff we just generated has matching context.
    args.push("-");
    run_git_with_stdin(&args, path, &patch).await
}

#[tauri::command]
pub async fn stage_hunk(path: String, file: String, hunk_index: usize) -> Result<(), String> {
    apply_hunk(&path, &file, hunk_index, false).await
}

#[tauri::command]
pub async fn unstage_hunk(path: String, file: String, hunk_index: usize) -> Result<(), String> {
    apply_hunk(&path, &file, hunk_index, true).await
}

// ── Blame ────────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlameLine {
    pub line_no: usize,
    pub oid: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub time: i64,
    pub summary: String,
    pub content: String,
}

// ═══════════════════════════════════════════════════════════════════════════
// Diagnostics (for the About modal's "复制诊断信息" button)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub app_version: String,
    pub tauri_version: String,
    pub rustc_target: String,
    pub os: String,
    pub arch: String,
    pub git_version: Option<String>,
    pub git_lfs_version: Option<String>,
    pub libgit2_version: String,
    pub current_repo: Option<String>,
}

#[tauri::command]
pub async fn get_diagnostics(repo_path: Option<String>) -> Result<Diagnostics, String> {
    let git_version = tokio::process::Command::new("git").arg("--version").output().await.ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None });
    let git_lfs_version = tokio::process::Command::new("git").args(["lfs", "version"]).output().await.ok()
        .and_then(|o| if o.status.success() { Some(String::from_utf8_lossy(&o.stdout).trim().to_string()) } else { None });
    let lg2 = git2::Version::get();
    let (lmaj, lmin, lrev) = lg2.libgit2_version();
    Ok(Diagnostics {
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        tauri_version: tauri::VERSION.to_string(),
        rustc_target: std::env::consts::OS.to_string() + "-" + std::env::consts::ARCH,
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        git_version,
        git_lfs_version,
        libgit2_version: format!("{}.{}.{}", lmaj, lmin, lrev),
        current_repo: repo_path,
    })
}

// ═══════════════════════════════════════════════════════════════════════════
// Submodules
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmoduleInfo {
    pub name: String,
    pub path: String,
    pub url: String,
    /// libgit2's recorded HEAD OID (the sha pinned in the parent commit).
    /// None for submodules added but not yet committed.
    pub head_oid: Option<String>,
    pub branch: Option<String>,
    /// Flat status flags (see status_* booleans on this struct).
    pub status_bits: u32,
    pub initialized: bool,
    pub in_workdir: bool,
    pub workdir_modified: bool,
    /// `index_oid` differs from `head_oid` — parent repo's index has a new SHA
    /// for this submodule that hasn't been committed yet.
    pub index_out_of_sync: bool,
    pub workdir_out_of_sync: bool,
}

#[tauri::command]
pub fn list_submodules(path: String, skip_status: Option<bool>) -> Result<Vec<SubmoduleInfo>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let subs = repo.submodules().map_err(fe)?;
    let mut out = Vec::new();
    let skip = skip_status.unwrap_or(false);
    for sub in subs.iter() {
        let name = sub.name().unwrap_or("").to_string();
        let path_str = sub.path().to_string_lossy().to_string();
        let url = sub.url().unwrap_or("").to_string();
        let head_oid = sub.head_id().map(|o| o.to_string());
        let branch = sub.branch().map(|s| s.to_string());

        // `skip_status=true` is the fast path: just the registration info
        // (name, url, branch, head). Each per-submodule `submodule_status`
        // call walks the submodule's working tree to detect dirty state —
        // for loom that's 8 submodules × up to 120k files = >500ms. The
        // UI calls quick first, then refreshes with full status.
        let status = if skip {
            git2::SubmoduleStatus::empty()
        } else {
            repo.submodule_status(&name, git2::SubmoduleIgnore::None)
                .unwrap_or(git2::SubmoduleStatus::empty())
        };
        let bits = status.bits();
        let in_workdir = status.contains(git2::SubmoduleStatus::IN_WD);
        let initialized = status.contains(git2::SubmoduleStatus::IN_CONFIG)
            && in_workdir;
        let workdir_modified = status.intersects(
            git2::SubmoduleStatus::WD_MODIFIED
            | git2::SubmoduleStatus::WD_INDEX_MODIFIED
            | git2::SubmoduleStatus::WD_WD_MODIFIED
            | git2::SubmoduleStatus::WD_UNTRACKED,
        );
        let index_out_of_sync = status.intersects(
            git2::SubmoduleStatus::INDEX_ADDED
            | git2::SubmoduleStatus::INDEX_DELETED
            | git2::SubmoduleStatus::INDEX_MODIFIED,
        );
        let workdir_out_of_sync = status.contains(git2::SubmoduleStatus::WD_WD_MODIFIED);

        out.push(SubmoduleInfo {
            name,
            path: path_str,
            url,
            head_oid,
            branch,
            status_bits: bits,
            initialized,
            in_workdir,
            workdir_modified,
            index_out_of_sync,
            workdir_out_of_sync,
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn add_submodule(
    app: tauri::AppHandle,
    path: String,
    url: String,
    sub_path: String,
) -> Result<(), String> {
    // libgit2's submodule_add_setup / add_finalize is fiddly (needs a clone
    // step in the middle). Shell `git submodule add` does all of it cleanly
    // and with progress.
    streaming_git(
        "fetch",
        &["submodule", "add", "--progress", &url, &sub_path],
        Some(&path),
        &app,
    ).await
}

#[tauri::command]
pub async fn init_submodule(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<(), String> {
    // `--init --recursive` covers nested submodules too.
    streaming_git(
        "fetch",
        &["submodule", "update", "--init", "--recursive", "--progress", "--", &name],
        Some(&path),
        &app,
    ).await
}

#[tauri::command]
pub async fn update_submodule(
    app: tauri::AppHandle,
    path: String,
    name: String,
) -> Result<(), String> {
    streaming_git(
        "fetch",
        &["submodule", "update", "--progress", "--", &name],
        Some(&path),
        &app,
    ).await
}

#[tauri::command]
pub fn sync_submodule(path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut sub = repo.find_submodule(&name).map_err(fe)?;
    sub.sync().map_err(fe)?;
    Ok(())
}

#[tauri::command]
pub async fn deinit_submodule(path: String, name: String) -> Result<(), String> {
    run_git_simple(&["submodule", "deinit", "-f", "--", &name], &path).await
}

/// Fully remove a submodule: deinit, `git rm`, and wipe `.git/modules/<name>`
/// (which `git rm` leaves behind). Reversible only via git reflog/history.
#[tauri::command]
pub async fn remove_submodule(path: String, name: String) -> Result<(), String> {
    // Resolve the on-disk path before we deinit (which would clear it).
    let sub_path = {
        let repo = Repository::open(&path).map_err(fe)?;
        let sub = repo.find_submodule(&name).map_err(fe)?;
        sub.path().to_string_lossy().to_string()
    };
    run_git_simple(&["submodule", "deinit", "-f", "--", &sub_path], &path).await?;
    run_git_simple(&["rm", "-f", "--", &sub_path], &path).await?;
    // `.git/modules/<name>` is left behind — clean it up too.
    let modules_dir = std::path::Path::new(&path).join(".git/modules").join(&name);
    if modules_dir.exists() {
        let _ = std::fs::remove_dir_all(&modules_dir);
    }
    Ok(())
}

// ═══════════════════════════════════════════════════════════════════════════
// Git LFS (shells out to the user's `git-lfs` binary)
// ═══════════════════════════════════════════════════════════════════════════

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LfsStatus {
    pub installed: bool,
    pub version: Option<String>,
}

#[tauri::command]
pub async fn lfs_check(_path: Option<String>) -> Result<LfsStatus, String> {
    let out = tokio::process::Command::new("git")
        .args(["lfs", "version"])
        .output()
        .await;
    match out {
        Err(_) => Ok(LfsStatus { installed: false, version: None }),
        Ok(o) if !o.status.success() => Ok(LfsStatus { installed: false, version: None }),
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            Ok(LfsStatus { installed: true, version: Some(s) })
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LfsPattern {
    pub pattern: String,
}

#[tauri::command]
pub async fn lfs_list_patterns(path: String) -> Result<Vec<LfsPattern>, String> {
    let out = run_git_capture(&["lfs", "track"], &path).await?;
    // `git lfs track` output:
    //   Listing tracked patterns
    //       *.psd (.gitattributes)
    //       data/**/*.bin (.gitattributes)
    //   Listing excluded patterns
    let mut patterns = Vec::new();
    let mut in_tracked = false;
    for line in out.lines() {
        let l = line.trim_end();
        if l.starts_with("Listing tracked") { in_tracked = true; continue }
        if l.starts_with("Listing excluded") { in_tracked = false; continue }
        if !in_tracked { continue }
        let l = l.trim();
        if l.is_empty() { continue }
        // Strip trailing "(.gitattributes)" or "(.git/info/attributes)".
        let pattern = l.rsplit_once(" (").map(|(p, _)| p).unwrap_or(l);
        patterns.push(LfsPattern { pattern: pattern.to_string() });
    }
    Ok(patterns)
}

#[tauri::command]
pub async fn lfs_track(path: String, pattern: String) -> Result<(), String> {
    run_git_simple(&["lfs", "track", &pattern], &path).await
}

#[tauri::command]
pub async fn lfs_untrack(path: String, pattern: String) -> Result<(), String> {
    run_git_simple(&["lfs", "untrack", &pattern], &path).await
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LfsFile {
    pub path: String,
    pub oid: String,
    /// "*" = present locally, "-" = pointer only.
    pub presence: String,
}

#[tauri::command]
pub async fn lfs_ls_files(path: String) -> Result<Vec<LfsFile>, String> {
    // Format: "<oid> <*|-> <path>"
    //   e2a3...d * assets/hero.psd
    //   77f9...8 - data/blob.bin
    let out = run_git_capture(&["lfs", "ls-files", "--long"], &path).await?;
    let mut files = Vec::new();
    for line in out.lines() {
        let mut parts = line.splitn(3, ' ');
        let Some(oid) = parts.next() else { continue };
        let Some(presence) = parts.next() else { continue };
        let Some(path) = parts.next() else { continue };
        files.push(LfsFile {
            path: path.to_string(),
            oid: oid.to_string(),
            presence: presence.to_string(),
        });
    }
    Ok(files)
}

#[tauri::command]
pub async fn lfs_pull(app: tauri::AppHandle, path: String) -> Result<(), String> {
    streaming_git("pull", &["lfs", "pull"], Some(&path), &app).await
}

#[tauri::command]
pub async fn lfs_fetch(app: tauri::AppHandle, path: String) -> Result<(), String> {
    streaming_git("fetch", &["lfs", "fetch", "--all"], Some(&path), &app).await
}

#[tauri::command]
pub fn blame_file(
    path: String,
    file: String,
    commit: Option<String>,
) -> Result<Vec<BlameLine>, String> {
    let repo = Repository::open(&path).map_err(fe)?;
    let mut opts = git2::BlameOptions::new();
    if let Some(ref sha) = commit {
        let oid = git2::Oid::from_str(sha).map_err(fe)?;
        opts.newest_commit(oid);
    }
    let file_path = std::path::Path::new(&file);
    let blame = repo.blame_file(file_path, Some(&mut opts)).map_err(fe)?;

    // Resolve the file's content at the chosen commit (or HEAD/workdir) so we
    // can pair each line number with its text.
    let content: String = if let Some(ref sha) = commit {
        let oid = git2::Oid::from_str(sha).map_err(fe)?;
        let commit = repo.find_commit(oid).map_err(fe)?;
        let tree = commit.tree().map_err(fe)?;
        let entry = tree.get_path(file_path).map_err(fe)?;
        let obj = entry.to_object(&repo).map_err(fe)?;
        let blob = obj.as_blob().ok_or_else(|| "blame target is not a file".to_string())?;
        String::from_utf8_lossy(blob.content()).to_string()
    } else {
        // Workdir version — what's currently on disk.
        let abs = std::path::Path::new(&path).join(file_path);
        std::fs::read_to_string(&abs).map_err(fe)?
    };

    let mut summaries: std::collections::HashMap<git2::Oid, String> = std::collections::HashMap::new();
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        let line_no = i + 1;
        let Some(hunk) = blame.get_line(line_no) else {
            // Blame doesn't have this line (file truncated?) — still emit it.
            out.push(BlameLine {
                line_no,
                oid: String::new(),
                short: String::new(),
                author: String::new(),
                email: String::new(),
                time: 0,
                summary: String::new(),
                content: line.to_string(),
            });
            continue;
        };
        let oid = hunk.final_commit_id();
        let sig = hunk.final_signature();
        let summary = if let Some(s) = summaries.get(&oid) {
            s.clone()
        } else {
            let s = repo.find_commit(oid).ok()
                .and_then(|c| c.summary().map(|x| x.to_string()))
                .unwrap_or_default();
            summaries.insert(oid, s.clone());
            s
        };
        out.push(BlameLine {
            line_no,
            oid: oid.to_string(),
            short: oid.to_string().chars().take(7).collect(),
            author: sig.name().unwrap_or("").to_string(),
            email: sig.email().unwrap_or("").to_string(),
            time: sig.when().seconds(),
            summary,
            content: line.to_string(),
        });
    }
    Ok(out)
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn openai_compatible_defaults_for_known_providers() {
        assert_eq!(openai_compatible_defaults("openai"),   ("https://api.openai.com/v1",   "gpt-4o-mini"));
        assert_eq!(openai_compatible_defaults("deepseek"), ("https://api.deepseek.com/v1", "deepseek-chat"));
        assert_eq!(openai_compatible_defaults("kimi"),     ("https://api.moonshot.cn/v1",  "moonshot-v1-32k"));
    }

    #[test]
    fn openai_compatible_defaults_falls_back_to_empty() {
        assert_eq!(openai_compatible_defaults("openai-compatible"), ("", ""));
        assert_eq!(openai_compatible_defaults("unknown"), ("", ""));
    }

    #[test]
    fn extract_openai_delta_parses_chunk() {
        let data = r#"{"choices":[{"delta":{"content":"hello"}}]}"#;
        assert_eq!(extract_openai_delta(data).as_deref(), Some("hello"));
    }

    #[test]
    fn extract_openai_delta_ignores_unrelated_shapes() {
        assert!(extract_openai_delta("{}").is_none());
        assert!(extract_openai_delta(r#"{"choices":[]}"#).is_none());
    }

    #[test]
    fn extract_anthropic_delta_parses_text_event() {
        let data = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}"#;
        assert_eq!(extract_anthropic_delta(data).as_deref(), Some("hi"));
    }

    #[test]
    fn extract_anthropic_delta_ignores_other_events() {
        let data = r#"{"type":"message_start"}"#;
        assert!(extract_anthropic_delta(data).is_none());
    }

    #[test]
    fn count_conflict_hunks_simple_file() {
        let content = "before
<<<<<<< HEAD
ours
=======
theirs
>>>>>>> branch
after
";
        assert_eq!(count_conflict_hunks(content), 1);
    }

    #[test]
    fn count_conflict_hunks_multi() {
        let content = "<<<<<<<
a
=======
b
>>>>>>>

<<<<<<<
c
=======
d
>>>>>>>";
        assert_eq!(count_conflict_hunks(content), 2);
    }

    #[test]
    fn count_conflict_hunks_clean_file() {
        assert_eq!(count_conflict_hunks("nothing conflicting here
"), 0);
    }
}
