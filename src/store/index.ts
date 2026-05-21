import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import i18n from '../i18n'
import { getActivePathspec, filterToActiveByFileKey } from '../lib/changelists'

// Monotonic generation for diff-loading async actions. Each new selectFile /
// viewAllInCommit call increments this and captures the value; when the
// underlying invoke resolves, the action only commits its result if its
// captured value still equals the current one. Prevents the "rapid-click
// race" where a slower earlier request lands AFTER a faster later request
// and leaves `diff` state out of sync with `selectedFile`.
let diffLoadGen = 0

// Shorthand to call i18n outside React components (store actions etc.). Falls
// back to the key if translation is missing so we never show literal interp
// placeholders to users.
const tt = (k: string, opts?: Record<string, unknown>) => i18n.t(k, opts) as string

/** Subscribe to streaming AI deltas while the given command runs. Returns a
 *  cleanup that unlistens. Provider-agnostic.
 *
 *  `setStreamId` lets the caller publish the active stream id to the store so
 *  the UI can drive `cancelCurrentAI`. Cleared in `finally` regardless of how
 *  the call ended (success, error, cancellation). */
async function withAIStream(
  cmd: string,
  args: Record<string, unknown>,
  onDelta: (accumulated: string) => void,
  setStreamId?: (id: string | null) => void,
): Promise<string> {
  const streamId = crypto.randomUUID()
  let acc = ''
  const unlisten = await listen<{ delta?: string; done?: boolean; cancelled?: boolean }>(
    `ai:stream:${streamId}`,
    evt => {
      const p = evt.payload
      if (typeof p.delta === 'string') {
        acc += p.delta
        onDelta(acc)
      }
    }
  )
  setStreamId?.(streamId)
  try {
    const full = await invoke<string>(cmd, { ...args, streamId })
    // Backend's return value is the canonical full text; prefer it over our
    // accumulator in case any deltas were missed.
    return full
  } finally {
    unlisten()
    setStreamId?.(null)
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface RecentRepo {
  path: string
  name: string
  lastOpened: number
}

export interface CommitFileInfo {
  path: string
  status: 'M' | 'A' | 'D' | 'R'
}

export interface SelectedCommitInfo {
  id: string
  shortId: string
  message: string
}

export interface ChangedFile {
  path: string
  stagedStatus: 'M' | 'A' | 'D' | 'R' | null
  unstagedStatus: 'M' | 'A' | 'D' | 'R' | 'C' | '?' | null
  /** True if this entry is a git submodule rather than a regular file. */
  isSubmodule?: boolean
}

export type RepoState =
  | 'clean'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting'
  | 'applying'

export interface RepoStatus {
  path: string
  branch: string
  files: ChangedFile[]
  ahead: number
  behind: number
  state: RepoState
}

export interface WorkspaceSubRepo {
  path: string
  name: string
}

/** Output of the Rust `scan_workspace` command. */
export interface WorkspaceScan {
  /** 'single' = 1 repo total; 'multi' = 2+ repos (including root if it's
   *  one); 'empty' = neither root nor any child is a git repo. */
  kind: 'single' | 'multi' | 'empty'
  /** Resolved workspace root path (no trailing slash). */
  root: string
  /** Whether `root` itself is a git repo. False for an uninitialized
   *  project folder containing vendored sub-repos. */
  rootIsRepo: boolean
  /** All repos found. Root first (if rootIsRepo), then sub-repos by name. */
  repos: WorkspaceSubRepo[]
}

export interface ConflictFile {
  path: string
  isBinary: boolean
  hunkCount: number
}

export interface ConflictHunk {
  oursStart: number
  oursEnd: number
  theirsStart: number
  theirsEnd: number
}

export interface ConflictContent {
  ours: string
  theirs: string
  base: string | null
  hunks: ConflictHunk[]
  workdir: string
}

export interface ConflictSuggestion {
  recommendation: 'ours' | 'theirs' | 'both'
  reasoning: string
}

/** A single live PTY tab inside the terminal panel.
 *
 *  Two flavors:
 *  - **Shell tab**: only `id` + `title`, fields below are undefined. Spawned
 *    with `$SHELL -l`.
 *  - **Agent tab**: `agentId`, `agentCommand`, `agentArgs` populated at
 *    creation time. Spawned with the agent's binary instead of a shell. On
 *    process exit, `promoteAgentExitToChangelist` snapshot-diffs against
 *    `preUnstagedSnapshot` and writes back `changelistId` if any files were
 *    touched.
 */
export interface TermSession {
  /** Backend session id handed to Rust's pty_open/write/resize/close. */
  id: string
  /** User-visible label in the tab strip ("Terminal 1", "Claude", etc.). */
  title: string

  // ─── agent-tab fields (all undefined for shell tabs) ───
  agentId?: string
  agentCommand?: string
  agentArgs?: string[]
  /** Snapshot of unstaged file paths at the moment this tab was opened.
   *  Used by the exit handler to figure out which files the agent touched. */
  preUnstagedSnapshot?: string[]
  /** Flipped true after `pty:exit` for this session. Shows a ✓ on the tab. */
  exited?: boolean
  /** Id of the changelist auto-created after exit. */
  changelistId?: string
}

export interface StashEntry {
  index: number    // stash@{N}
  oid: string
  message: string
  time: number     // unix seconds
}

export interface ProjectCommand {
  label: string
  command: string
}

export interface ProjectInfo {
  kind: 'node' | 'rust' | 'go' | 'unknown'
  display: string
  icon: string
  packageManager: string
  commands: ProjectCommand[]
}

export interface BranchInfo {
  name: string
  isRemote: boolean
  isCurrent: boolean
  upstream: string | null
  ahead: number
  behind: number
  lastOid: string
  lastShort: string
  lastSubject: string
  lastTime: number
}

export interface BisectSuggestion {
  sha: string
  shortId: string
  subject: string
  reason: string
}

export interface BisectStatus {
  kind: 'inactive' | 'in-progress' | 'found'
  currentOid: string | null
  currentShort: string | null
  currentSubject: string | null
  stepsRemaining: number | null
  foundOid: string | null
  foundShort: string | null
  foundSubject: string | null
}

export interface MergeAnalysis {
  current: string
  target: string
  targetCommits: number
  incomingFiles: string[]
  sharedFiles: string[]
  canFastForward: boolean
  alreadyMerged: boolean
}

export type RiskLevel = 'high' | 'medium' | 'low'

export interface FileRisk {
  path: string
  risk: RiskLevel
  reason: string
}

export interface MergeRiskReport {
  overall: string
  files: FileRisk[]
}

export interface RemoteInfo {
  name: string
  url: string
  pushUrl: string | null
}

export interface TagInfo {
  name: string
  oid: string
  targetOid: string
  targetShort: string
  annotated: boolean
  message: string | null
  tagger: string | null
  time: number | null
}

export interface ReflogEntry {
  index: number
  oid: string
  short: string
  message: string
  action: string
  time: number
  committer: string
}

export interface BlameLine {
  lineNo: number
  oid: string
  short: string
  author: string
  email: string
  time: number
  summary: string
  content: string
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

export interface SubmoduleInfo {
  name: string
  path: string
  url: string
  headOid: string | null
  branch: string | null
  statusBits: number
  initialized: boolean
  inWorkdir: boolean
  workdirModified: boolean
  indexOutOfSync: boolean
  workdirOutOfSync: boolean
}

export interface LfsStatus {
  installed: boolean
  version: string | null
}

export interface LfsPattern {
  pattern: string
}

export interface LfsFile {
  path: string
  oid: string
  presence: string   // "*" = present locally, "-" = pointer only
}

export interface GitProgress {
  phase: 'push' | 'pull' | 'clone' | 'rebase' | 'fetch'
  /** Raw line as printed by git (kept as a hover tooltip / fallback) */
  line: string
  /** e.g. "Counting objects", "Writing objects", "Rebasing" */
  stage: string | null
  /** 0–100; synthesized from N/T for stages that print only the count */
  percent: number | null
  current: number | null
  total: number | null
  /** Transfer rate verbatim, e.g. "286.00 KiB/s" — only on Writing/Receiving */
  speed: string | null
}

export interface CommitInfo {
  id: string         // full 40-char SHA
  shortId: string    // first 7 chars
  message: string
  author: string
  time: number
}

export interface DiffLine {
  origin: '+' | '-' | ' '
  content: string
  old_lineno: number | null
  new_lineno: number | null
}

export interface DiffHunk {
  header: string
  lines: DiffLine[]
}

export interface DiffResult {
  file: string
  hunks: DiffHunk[]
}

/** Commit shape returned by `get_graph` — richer than CommitInfo (has parents/refs). */
export interface GraphCommit {
  id: string
  shortId: string
  message: string
  author: string
  time: number
  parents: string[]
  refs: string[]
}

export type AIProvider = 'anthropic' | 'openai' | 'deepseek' | 'kimi' | 'openai-compatible'

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  model: string       // empty string = use backend default
  baseUrl: string     // only meaningful for 'openai-compatible'
}

/** Hard cap on how many changed files AI commands will operate on. Past
 *  this, diff payloads either time out libgit2's enumeration, blow past
 *  the model's context window, or both — and burn tokens for a request
 *  that's guaranteed to fail. We refuse early and ask the user to narrow
 *  scope with a changelist. */
export const AI_MAX_FILES = 200

const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'anthropic',
  apiKey: '',
  model: '',
  baseUrl: '',
}

function loadAIConfig(): AIConfig {
  try {
    const raw = localStorage.getItem('versa:aiConfig')
    if (!raw) return DEFAULT_AI_CONFIG
    return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_AI_CONFIG
  }
}

/** One open "tab" in the UI. For 99% of users this is a single repo (N=1 in
 *  `repos`), in which case the workspace abstraction is invisible — tab name
 *  = repo name, no sub-repo strip, all current UX. For folders containing
 *  multiple repos (N>1), the workspace groups them; a sub-repo switcher
 *  appears below the TabStrip. */
export interface WorkspaceTab {
  root: string                  // path the user picked (parent for N>1, repo for N=1)
  name: string                  // tab display name
  repos: WorkspaceSubRepo[]     // 1+ sub-repos (length 1 = single-repo tab)
  activeRepo: string            // sub-repo currently focused within this tab
  /** Whether `root` itself is a git repo. When false on a multi-workspace,
   *  the dashboard surfaces an "Initialize git here" card so the user can
   *  adopt the root folder (e.g. a pnpm monorepo containing vendored repos)
   *  without dropping to a terminal. */
  rootIsRepo: boolean
  /** Which surface this workspace shows in the main area.
   *  - 'overview': workspace dashboard (cards of each sub-repo). Default for
   *    multi-repo workspaces — answers "what's in this workspace?".
   *  - 'repo': normal single-repo UI (Sidebar + Diff). Forced for N=1 since
   *    the dashboard would be a card to itself. Multi-repo workspaces flip
   *    here when the user clicks any sub-repo pill or card. */
  view: 'overview' | 'repo'
}

/** Per-repo state slices that should be preserved when switching tabs. */
interface RepoSnapshot {
  repoStatus: RepoStatus | null
  selectedFile: string | null
  selectedFileStaged: boolean
  selectedCommit: SelectedCommitInfo | null
  commitFiles: CommitFileInfo[]
  diff: DiffResult[]
  commits: CommitInfo[]
  commitMessage: string
  activeTab: 'changes' | 'history' | 'branches' | 'compare'
  conflicts: ConflictFile[]
  selectedConflictFile: string | null
  conflictContent: ConflictContent | null
  stashes: StashEntry[]
  projectInfo: ProjectInfo | null
  branches: BranchInfo[]
  graphCommits: GraphCommit[]
  graphLimit: number
  graphSelected: string | null
}

const blankSnapshot = (): RepoSnapshot => ({
  repoStatus: null,
  selectedFile: null,
  selectedFileStaged: false,
  selectedCommit: null,
  commitFiles: [],
  diff: [],
  commits: [],
  commitMessage: '',
  activeTab: 'changes',
  conflicts: [],
  selectedConflictFile: null,
  conflictContent: null,
  stashes: [],
  projectInfo: null,
  branches: [],
  graphCommits: [],
  graphLimit: 200,
  graphSelected: null,
})

/** Three-step repo load:
 *  1. Quick header (branch, ahead/behind) — typically <10ms.
 *  2. Regular files, submodules excluded — fast even on parents like loom
 *     with 8 submodules totalling 100k+ files. Submodule entries omitted.
 *  3. Dirty-submodule entries — each submodule runs its own status pass
 *     so this can take seconds on big submodules (midscene at 120k files).
 *     Streamed in async; merged on top of step 2's file list.
 *
 *  Calls `setRepoStatus` up to three times. The caller is responsible for
 *  ignoring the file-list sets if the user has navigated away. */
async function loadRepoStatusInTwoSteps(
  path: string,
  setRepoStatus: (status: RepoStatus) => void,
): Promise<RepoStatus> {
  const t0 = performance.now()
  const quick = await invoke<RepoStatus>('open_repo', { path, skipFiles: true })
  console.log(`[load] step1 quick header: ${(performance.now() - t0).toFixed(1)}ms — ${path}`)
  setRepoStatus(quick)
  // Mark step-2 as in flight so the Sidebar can show "loading files…"
  // while the empty snapshot is still showing. Done in a microtask
  // (before the async IIFE returns) so the flag is observable on the
  // same tick as the `setRepoStatus(quick)` above.
  useStore.setState(s => ({
    filesLoadPending: { ...s.filesLoadPending, [path]: true },
  }))
  // Regular files (no submodule recursion) — fast. Then dirty submodules
  // separately — slow, fires in parallel but doesn't block step 2.
  void (async () => {
    try {
      const t1 = performance.now()
      const files = await invoke<ChangedFile[]>('get_changed_files_only', {
        path,
        skipSubmoduleDirty: true,
      })
      console.log(`[load] step2 files (no submodules): ${(performance.now() - t1).toFixed(1)}ms — ${files.length} entries`)
      setRepoStatus({ ...quick, files })
      // Step 2 done — file list is now authoritative (except for
      // submodule dirty entries which arrive in step 3).
      useStore.setState(s => {
        const next = { ...s.filesLoadPending }
        delete next[path]
        return { filesLoadPending: next }
      })
      // Step 3: per-submodule dirty checks IN PARALLEL. Each one is a
      // separate Rust task → bounded by max(sub_time), not sum.
      try {
        const t2 = performance.now()
        const names = await invoke<string[]>('list_submodule_names', { path })
        if (names.length === 0) return
        // Mark "submodule check in progress" so Sidebar can render the
        // "checking submodules…" banner. Use functional setState so we
        // don't race with concurrent updates from other repos.
        useStore.setState(s => ({
          submoduleCheckPending: { ...s.submoduleCheckPending, [path]: true },
        }))
        try {
          const results = await Promise.all(
            names.map(name =>
              invoke<ChangedFile | null>('check_submodule_dirty', { path, name })
                .catch(() => null)
            ),
          )
          const subDirty = results.filter((f): f is ChangedFile => f !== null)
          console.log(`[load] step3 ${names.length} submodules in parallel: ${(performance.now() - t2).toFixed(1)}ms — ${subDirty.length} dirty`)
          if (subDirty.length > 0) {
            setRepoStatus({ ...quick, files: [...files, ...subDirty] })
          }
        } finally {
          useStore.setState(s => {
            const next = { ...s.submoduleCheckPending }
            delete next[path]
            return { submoduleCheckPending: next }
          })
        }
      } catch { /* non-fatal */ }
    } catch {
      // Step-2 failure leaves the user with just the quick header.
    } finally {
      // Clear the files-load flag even on failure so the banner doesn't
      // get stuck forever if step 2 throws.
      useStore.setState(s => {
        if (!s.filesLoadPending[path]) return s
        const next = { ...s.filesLoadPending }
        delete next[path]
        return { filesLoadPending: next }
      })
    }
  })()
  return quick
}

/** Find the workspace tab that contains `repoPath` as one of its sub-repos. */
function findWorkspaceFor(tabs: WorkspaceTab[], repoPath: string | null): WorkspaceTab | null {
  if (!repoPath) return null
  return tabs.find(t => t.repos.some(r => r.path === repoPath)) ?? null
}

/** Find the workspace tab by its root path (the path the user picked). */
function findWorkspaceByRoot(tabs: WorkspaceTab[], root: string): WorkspaceTab | null {
  return tabs.find(t => t.root === root) ?? null
}

/**
 * Make sure the backend is watching `newPath`. Old watchers are intentionally
 * left running: on macOS each `start_watching` call sets up a recursive
 * FSEvents subscription, which for a monorepo with node_modules can take a
 * noticeable chunk of the tab-switch cost. The JS event handler already
 * filters out events whose `eventPath !== current repoPath`, so leaking
 * watchers across switches is harmless and re-activating an already-watched
 * path is free (idempotent on the Rust side).
 *
 * Only stops the previous watcher when there's no new tab to switch to
 * (i.e. closing the last tab) — see `closeTab` for explicit cleanup.
 */
function swapWatcher(oldPath: string | null, newPath: string | null) {
  if (oldPath === newPath) return
  if (oldPath && !newPath) invoke('stop_watching', { path: oldPath }).catch(() => {})
  if (newPath) invoke('start_watching', { path: newPath }).catch(() => {})
}

/** Stop watchers for every sub-repo in a closed workspace. Called from
 *  closeTab so we don't leak unbounded FSEvents subscriptions across the
 *  lifetime of the app. */
function stopAllWatchers(repoPaths: string[]) {
  for (const p of repoPaths) {
    invoke('stop_watching', { path: p }).catch(() => {})
  }
}

const snapshotFrom = (s: VersaState): RepoSnapshot => ({
  repoStatus: s.repoStatus,
  selectedFile: s.selectedFile,
  selectedFileStaged: s.selectedFileStaged,
  selectedCommit: s.selectedCommit,
  commitFiles: s.commitFiles,
  diff: s.diff,
  commits: s.commits,
  commitMessage: s.commitMessage,
  activeTab: s.activeTab,
  conflicts: s.conflicts,
  selectedConflictFile: s.selectedConflictFile,
  conflictContent: s.conflictContent,
  stashes: s.stashes,
  projectInfo: s.projectInfo,
  branches: s.branches,
  graphCommits: s.graphCommits,
  graphLimit: s.graphLimit,
  graphSelected: s.graphSelected,
})

// ── Store ────────────────────────────────────────────────────────────────────

interface VersaState {
  // Multi-tab: ordered list of open workspaces. Each workspace contains 1+
  // sub-repos; the N=1 case behaves identically to the old "tab = repo" model.
  // Per-sub-repo state is stashed in `tabSnapshots` (keyed by sub-repo path),
  // so switching sub-repos within a workspace also preserves their state.
  tabs: WorkspaceTab[]
  tabSnapshots: Record<string, RepoSnapshot>

  // Repo (top-level reflects the *active* tab's state)
  repoPath: string | null
  repoStatus: RepoStatus | null
  selectedFile: string | null

  // Diff
  diff: DiffResult[]

  // History
  commits: CommitInfo[]

  // Recent repos
  recentRepos: RecentRepo[]

  // UI
  activeTab: 'changes' | 'history' | 'branches' | 'compare'
  terminalOpen: boolean
  // Per-repo terminal sessions. Each repo keeps its own list of PTY tabs
  // alive across repo switches; switching back restores whatever was
  // running. PTY id is a random string we hand to Rust's pty_open. Title
  // defaults to "Terminal N" but the user can rename later (v2).
  terminalsByRepo: Record<string, TermSession[]>
  activeTerminalByRepo: Record<string, string | null>
  commitMessage: string
  loading: boolean
  error: string | null

  // Settings
  theme: 'light' | 'dark' | 'system'
  aiConfig: AIConfig
  aiGenerating: boolean

  // Streaming progress for git push/pull/clone/rebase. Null when idle.
  gitProgress: GitProgress | null

  // Toast
  toast: { message: string; type: 'success' | 'error' } | null

  // Selected file
  selectedFileStaged: boolean

  // Commit inspection
  selectedCommit: SelectedCommitInfo | null
  commitFiles: CommitFileInfo[]

  // Conflict resolution (only meaningful when repoStatus.state === 'merging')
  conflicts: ConflictFile[]
  selectedConflictFile: string | null
  conflictContent: ConflictContent | null
  aiConflictSuggestion: (ConflictSuggestion & { hunkIdx: number }) | null
  aiConflictLoading: boolean
  /** AI explanation of the currently selected commit. Cleared when sha changes. */
  commitExplanation: { sha: string; text: string } | null
  commitExplanationLoading: boolean

  // Stash list — refreshed alongside refreshRepo so the badge stays accurate
  stashes: StashEntry[]

  // Detected project type (Node/Rust/Go/…) — populated per-tab
  projectInfo: ProjectInfo | null

  // Local + remote branches with metadata, for the Branches view.
  branches: BranchInfo[]

  // History / Graph view — lifted out of the component so tab-switch preserves position.
  graphCommits: GraphCommit[]
  graphLimit: number
  graphLoading: boolean
  graphSelected: string | null

  // Bisect state — refreshed when state machine reports 'bisecting'
  bisectStatus: BisectStatus | null

  // Active AI streaming call. Non-null while a streamed AI request is in
  // flight. The UI uses this to show a Cancel affordance and bind Esc.
  currentAiStreamId: string | null

  // App-level settings persisted to localStorage
  graphLoadStep: number    // how many commits "再加载" pulls each click
  rightSidebarOpen: boolean // right-side aux panel (project runner / AI explain / stash)
  gpgSign: boolean         // sign commits (-S); relies on user's git signing config
  diffIgnoreWhitespace: boolean   // pass `ignore_whitespace=true` to get_diff
  diffWordLevel: boolean   // show inline word-level highlight inside changed lines
  diffSideBySide: boolean  // render the diff as two columns instead of unified
  fileTreeView: boolean    // render staged/unstaged lists as a folder tree

  // Repos whose step-2 (regular file list) load is in flight. Sidebar
  // shows a "loading files…" banner so the empty interval before data
  // arrives doesn't look like an inert "clean working tree" state.
  filesLoadPending: Record<string, boolean>

  // Repos whose step-3 submodule dirty check is currently in flight.
  // Keyed by repo path. Sidebar reads this to render a "checking submodules…"
  // banner so the user knows why the file list is briefly incomplete.
  submoduleCheckPending: Record<string, boolean>

  // Command queued for the embedded Terminal to pick up and run. Cleared by
  // the Terminal once consumed.
  pendingTerminalCommand: string | null

  // Actions
  openRepo: (path: string) => Promise<void>
  /** Switch to a workspace tab by its root path. */
  switchTab: (root: string) => Promise<void>
  /** Close a workspace tab (and clean up snapshots for all its sub-repos). */
  closeTab: (root: string) => Promise<void>
  /** Within the workspace that contains it, switch the focused sub-repo.
   *  Also flips that workspace's `view` to 'repo'. */
  switchSubRepo: (repoPath: string) => Promise<void>
  /** Set the workspace view mode. Used to flip to the overview dashboard
   *  on multi-repo workspaces, or back to repo mode. */
  setWorkspaceView: (root: string, view: 'overview' | 'repo') => void
  /** `git init` the workspace root and add it as the first repo in the
   *  tab's repos[]. Used by the dashboard's "Initialize git here" card. */
  initWorkspaceRoot: (root: string) => Promise<void>
  selectFile: (path: string, staged?: boolean, commitId?: string) => Promise<void>
  selectCommit: (commit: SelectedCommitInfo | null) => Promise<void>
  viewAllInCommit: () => Promise<void>
  saveProgress: () => Promise<void>
  createBranch: (name: string) => Promise<void>
  switchBranch: (name: string) => Promise<void>
  stageFile: (file: string) => Promise<void>
  unstageFile: (file: string) => Promise<void>
  discardFile: (file: string) => Promise<void>
  pushBranch: () => Promise<void>
  pullBranch: () => Promise<void>
  fetchAll: (prune?: boolean) => Promise<void>
  resetToCommit: (sha: string, mode: ResetMode) => Promise<void>
  // Remotes
  listRemotes: () => Promise<RemoteInfo[]>
  addRemote: (name: string, url: string) => Promise<void>
  removeRemote: (name: string) => Promise<void>
  renameRemote: (oldName: string, newName: string) => Promise<void>
  setRemoteUrl: (name: string, url: string) => Promise<void>
  // Tags
  listTags: () => Promise<TagInfo[]>
  createTag: (name: string, target: string, message: string | null) => Promise<void>
  deleteLocalTag: (name: string) => Promise<void>
  pushTag: (remote: string, tag: string) => Promise<void>
  deleteRemoteTag: (remote: string, tag: string) => Promise<void>
  // Reflog 时光机
  listReflog: (limit?: number) => Promise<ReflogEntry[]>
  restoreToReflog: (sha: string) => Promise<void>
  // Hunk staging
  stageHunk: (file: string, hunkIndex: number) => Promise<void>
  unstageHunk: (file: string, hunkIndex: number) => Promise<void>
  // Blame
  blameFile: (file: string, commit?: string) => Promise<BlameLine[]>
  // Submodules
  listSubmodules: (opts?: { skipStatus?: boolean }) => Promise<SubmoduleInfo[]>
  addSubmodule: (url: string, subPath: string) => Promise<void>
  initSubmodule: (name: string) => Promise<void>
  updateSubmodule: (name: string) => Promise<void>
  syncSubmodule: (name: string) => Promise<void>
  deinitSubmodule: (name: string) => Promise<void>
  removeSubmodule: (name: string) => Promise<void>
  // Git LFS
  lfsCheck: () => Promise<LfsStatus>
  lfsListPatterns: () => Promise<LfsPattern[]>
  lfsTrack: (pattern: string) => Promise<void>
  lfsUntrack: (pattern: string) => Promise<void>
  lfsLsFiles: () => Promise<LfsFile[]>
  lfsPull: () => Promise<void>
  lfsFetch: () => Promise<void>
  cloneRepo: (url: string, dest: string) => Promise<string>
  checkoutCommit: (id: string, info?: SelectedCommitInfo) => Promise<void>
  loadHistory: () => Promise<void>
  loadConflicts: () => Promise<void>
  selectConflictFile: (file: string | null) => Promise<void>
  resolveConflict: (file: string, content: string) => Promise<void>
  abortMerge: () => Promise<void>
  continueMerge: (message: string) => Promise<void>
  abortRebase: () => Promise<void>
  continueRebase: () => Promise<void>
  revertCommit: (sha: string, message: string) => Promise<void>
  abortRevert: () => Promise<void>
  continueRevert: () => Promise<void>
  cherryPickCommit: (sha: string, message: string) => Promise<void>
  abortCherryPick: () => Promise<void>
  continueCherryPick: () => Promise<void>
  loadStashes: () => Promise<void>
  createStash: (message: string | null) => Promise<void>
  applyStash: (index: number) => Promise<void>
  popStash: (index: number) => Promise<void>
  dropStash: (index: number) => Promise<void>
  loadProject: () => Promise<void>
  sendToTerminal: (cmd: string) => void
  consumeTerminalCommand: () => void
  loadGraph: () => Promise<void>
  loadMoreGraph: () => Promise<void>
  loadAllGraph: () => Promise<void>
  setGraphSelected: (id: string | null) => void
  setGraphLoadStep: (n: number) => void
  toggleRightSidebar: () => void
  setGpgSign: (on: boolean) => void
  setDiffIgnoreWhitespace: (on: boolean) => void
  setDiffWordLevel: (on: boolean) => void
  setDiffSideBySide: (on: boolean) => void
  setFileTreeView: (on: boolean) => void
  /** Auto-expand graphLimit until `sha` is in the loaded window. Returns idx, or -1. */
  locateCommit: (sha: string) => Promise<number>
  loadBisectStatus: () => Promise<void>
  startBisect: (goodSha: string) => Promise<void>
  bisectMark: (kind: 'good' | 'bad' | 'skip') => Promise<void>
  bisectReset: () => Promise<void>
  aiSuggestBisectGood: () => Promise<BisectSuggestion>
  loadBranches: () => Promise<void>
  checkoutRemoteBranch: (fullName: string) => Promise<void>
  renameBranch: (oldName: string, newName: string) => Promise<void>
  deleteBranch: (name: string, force: boolean) => Promise<void>
  deleteRemoteBranch: (fullName: string) => Promise<void>
  analyzeMerge: (target: string) => Promise<MergeAnalysis>
  aiAnalyzeMergeRisk: (target: string) => Promise<MergeRiskReport>
  aiAnalyzeFileConflict: (target: string, file: string, onDelta?: (s: string) => void) => Promise<string>
  mergeBranch: (target: string) => Promise<void>
  requestConflictSuggestion: (hunkIdx: number) => Promise<void>
  clearConflictSuggestion: () => void
  explainSelectedCommit: () => Promise<void>
  /** Cancel the currently-streaming AI call, if any. No-op when idle. */
  cancelCurrentAI: () => void
  setTab: (tab: VersaState['activeTab']) => void
  setTerminalOpen: (open: boolean) => void
  /** Open a fresh terminal tab in the given repo. Returns the new session id. */
  openNewTerminal: (repoPath: string) => string
  /** Open a tab that runs an AI agent CLI (e.g. claude/codex) instead of
   *  the shell. Snapshots the unstaged file set so the exit handler can
   *  group new edits into a "Agent: ..." changelist. */
  openAgentTerminal: (
    repoPath: string,
    agent: { id: string; name: string; command: string; extraArgs: string },
  ) => string
  /** Mark an agent tab as exited (its process finished). Called from the
   *  TerminalPane pty:exit listener. */
  markAgentTerminalExited: (sessionId: string) => void
  /** Stamp the auto-created changelist id onto the corresponding session
   *  so the tab can show "→ <changelist>" later. */
  markAgentChangelist: (sessionId: string, changelistId: string) => void
  /** Close a terminal tab. If it was active and others remain, pick a sibling. */
  closeTerminal: (repoPath: string, sessionId: string) => void
  setActiveTerminal: (repoPath: string, sessionId: string) => void
  setCommitMessage: (msg: string) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  setAIConfig: (cfg: Partial<AIConfig>) => void
  generateCommitMessage: () => Promise<void>
  showToast: (message: string, type?: 'success' | 'error') => void
  refreshRepo: () => Promise<void>
}

export const useStore = create<VersaState>((set, get) => ({
  tabs: [],
  tabSnapshots: {},
  repoPath: null,
  repoStatus: null,
  selectedFile: null,
  selectedFileStaged: false,
  selectedCommit: null,
  commitFiles: [],
  conflicts: [],
  selectedConflictFile: null,
  conflictContent: null,
  aiConflictSuggestion: null,
  aiConflictLoading: false,
  commitExplanation: null,
  commitExplanationLoading: false,
  stashes: [],
  projectInfo: null,
  pendingTerminalCommand: null,
  branches: [],
  graphCommits: [],
  graphLimit: 200,
  graphLoading: false,
  graphSelected: null,
  graphLoadStep: Number(localStorage.getItem('versa:graphLoadStep') || 200),
  rightSidebarOpen: localStorage.getItem('versa:rightSidebarOpen') === '1',
  gpgSign: localStorage.getItem('versa:gpgSign') === '1',
  diffIgnoreWhitespace: localStorage.getItem('versa:diffIgnoreWhitespace') === '1',
  diffWordLevel: localStorage.getItem('versa:diffWordLevel') !== '0',  // default ON
  diffSideBySide: localStorage.getItem('versa:diffSideBySide') === '1',
  fileTreeView: localStorage.getItem('versa:fileTreeView') === '1',
  filesLoadPending: {},
  submoduleCheckPending: {},
  bisectStatus: null,
  currentAiStreamId: null,
  diff: [],
  commits: [],
  recentRepos: JSON.parse(localStorage.getItem('versa:recentRepos') || '[]'),
  activeTab: 'changes',
  terminalOpen: false,
  terminalsByRepo: {},
  activeTerminalByRepo: {},
  commitMessage: '',
  loading: false,
  error: null,
  theme: (localStorage.getItem('versa:theme') as 'light' | 'dark' | 'system') ?? 'system',
  aiConfig: loadAIConfig(),
  aiGenerating: false,
  gitProgress: null,
  toast: null,

  openRepo: async (path: string) => {
    const state = get()

    // Fast path 1: if the path is the sub-repo of an open workspace, activate
    // it within that workspace (no scan, no reopen).
    const wsHolding = findWorkspaceFor(state.tabs, path)
    if (wsHolding) {
      if (wsHolding.activeRepo !== state.repoPath || state.repoPath !== path) {
        await get().switchTab(wsHolding.root)
        if (wsHolding.activeRepo !== path) await get().switchSubRepo(path)
      }
      return
    }
    // Fast path 2: workspace root already open — just switch to it.
    const wsByRoot = findWorkspaceByRoot(state.tabs, path)
    if (wsByRoot) {
      await get().switchTab(wsByRoot.root)
      return
    }

    set({ loading: true, error: null })
    try {
      const scan = await invoke<WorkspaceScan>('scan_workspace', { path })

      if (scan.kind === 'empty') {
        throw new Error(`'${path}' isn't a git repository and contains no sub-repos.`)
      }

      // After scan, re-check dedup against the canonical path(s) — `discover`
      // may have walked up for the single case.
      if (scan.kind === 'single') {
        const resolved = scan.repos[0].path
        const existing = findWorkspaceFor(get().tabs, resolved)
        if (existing) {
          set({ loading: false })
          await get().switchTab(existing.root)
          if (existing.activeRepo !== resolved) await get().switchSubRepo(resolved)
          return
        }
      } else {
        const existing = findWorkspaceByRoot(get().tabs, scan.root)
        if (existing) {
          set({ loading: false })
          await get().switchTab(existing.root)
          return
        }
      }

      const wsName = scan.kind === 'single'
        ? scan.repos[0].name
        : (scan.root.split('/').filter(Boolean).pop() ?? scan.root)
      const activeRepo = scan.repos[0].path
      const isMulti = scan.kind === 'multi'
      const newWorkspace: WorkspaceTab = {
        root: scan.root,
        name: wsName,
        repos: scan.repos,
        activeRepo,
        rootIsRepo: scan.rootIsRepo,
        // Multi-repo workspaces open to the dashboard so the user lands on
        // a "what's in this workspace" view rather than being dropped into
        // an arbitrary sub-repo without context.
        view: isMulti ? 'overview' : 'repo',
      }

      // Stash current tab's per-sub-repo state before swapping
      const prevPath = state.repoPath
      const stashed = prevPath
        ? { ...state.tabSnapshots, [prevPath]: snapshotFrom(state) }
        : state.tabSnapshots

      // Recents: store the workspace root so reopening reconstructs the same
      // tab (single-repo case: root === repo path, behaves like before).
      const entry: RecentRepo = { path: scan.root, name: wsName, lastOpened: Date.now() }
      const prevRecents: RecentRepo[] = JSON.parse(localStorage.getItem('versa:recentRepos') || '[]')
      const updatedRecents = [entry, ...prevRecents.filter(r => r.path !== scan.root)].slice(0, 10)
      localStorage.setItem('versa:recentRepos', JSON.stringify(updatedRecents))

      // For SINGLE workspaces we still block on the QUICK open_repo so the
      // Sidebar header (branch, ahead/behind) renders immediately. The file
      // list streams in afterwards via get_changed_files_only — shaves the
      // big libgit2 status pass off the critical path.
      let initialStatus: RepoStatus | null = null
      if (!isMulti) {
        initialStatus = await invoke<RepoStatus>('open_repo', { path: activeRepo, skipFiles: true })
        // Background-fetch the file list (no submodule recursion) followed
        // by an async second pass for dirty submodules.
        void (async () => {
          try {
            const files = await invoke<ChangedFile[]>('get_changed_files_only', {
              path: activeRepo,
              skipSubmoduleDirty: true,
            })
            const s = get()
            if (s.repoPath === activeRepo && s.repoStatus) {
              set({ repoStatus: { ...s.repoStatus, files } })
            }
            const subDirty = await invoke<ChangedFile[]>('get_dirty_submodule_files', { path: activeRepo })
            if (subDirty.length > 0) {
              const s2 = get()
              if (s2.repoPath === activeRepo && s2.repoStatus) {
                set({ repoStatus: { ...s2.repoStatus, files: [...files, ...subDirty] } })
              }
            }
          } catch {}
        })()
      }

      set({
        tabs: [...state.tabs, newWorkspace],
        tabSnapshots: stashed,
        repoPath: activeRepo,
        ...blankSnapshot(),
        repoStatus: initialStatus,
        recentRepos: updatedRecents,
        loading: false,
      })
      swapWatcher(prevPath, activeRepo)
      get().loadProject()

      // For MULTI: lazily populate per-sub-repo status AFTER the first paint.
      // Two-step per repo: quick header (branch, ahead/behind) lands fast so
      // cards show real info within tens of ms; file list streams in later
      // so the dashboard isn't blocked behind a 100k-file libgit2 status pass.
      if (isMulti) {
        const applyStatus = (path: string, st: RepoStatus) => {
          set(s => {
            if (!s.tabs.some(t => t.root === scan.root)) return s
            const next: Record<string, RepoSnapshot> = {
              ...s.tabSnapshots,
              [path]: { ...(s.tabSnapshots[path] ?? blankSnapshot()), repoStatus: st },
            }
            if (s.repoPath === path) {
              return { tabSnapshots: next, repoStatus: st }
            }
            return { tabSnapshots: next }
          })
        }
        for (const r of scan.repos) {
          void (async () => {
            try {
              await loadRepoStatusInTwoSteps(r.path, (st) => applyStatus(r.path, st))
            } catch {
              // Per-repo failures stay silent — card just shows "couldn't load".
            }
          })()
        }
      }

      if (isMulti) {
        get().showToast(
          `Opened ${scan.repos.length} sub-repos from ${wsName}`,
          'success',
        )
      } else if (activeRepo !== path) {
        get().showToast(`Opened repo at ${activeRepo}`, 'success')
      }
    } catch (e) {
      const msg = String(e)
      set({ error: msg, loading: false })
      get().showToast(msg, 'error')
    }
  },

  switchTab: async (root: string) => {
    const state = get()
    const ws = findWorkspaceByRoot(state.tabs, root)
    if (!ws) return
    if (state.repoPath === ws.activeRepo) return

    const stashed = state.repoPath
      ? { ...state.tabSnapshots, [state.repoPath]: snapshotFrom(state) }
      : state.tabSnapshots
    const targetSnap = stashed[ws.activeRepo] ?? blankSnapshot()
    const prevPath = state.repoPath
    const hadSnapshot = !!targetSnap.repoStatus
    set({
      tabSnapshots: stashed,
      repoPath: ws.activeRepo,
      ...targetSnap,
      loading: !hadSnapshot,
    })
    swapWatcher(prevPath, ws.activeRepo)

    if (hadSnapshot) {
      get().loadProject()
      void loadRepoStatusInTwoSteps(ws.activeRepo, (status) => {
        if (get().repoPath === ws.activeRepo) set({ repoStatus: status })
      }).catch(() => {})
      return
    }

    try {
      await loadRepoStatusInTwoSteps(ws.activeRepo, (status) => {
        if (get().repoPath !== ws.activeRepo) return
        set({ repoStatus: status, loading: false })
      })
      get().loadProject()
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  switchSubRepo: async (repoPath: string) => {
    const t0 = performance.now()
    const state = get()
    const ws = findWorkspaceFor(state.tabs, repoPath)
    if (!ws) return

    // If we're already on this sub-repo but the workspace is in overview
    // mode, just flip the view (no snapshot work needed).
    if (state.repoPath === repoPath && ws.view === 'repo') return

    console.log(`[switchSubRepo] → ${repoPath}`)

    // Build the new state synchronously and apply it in one shot. The
    // snapshot-fast-path is genuinely instant (≈ 5ms total per profiling),
    // so the previous "show loading for at least 300ms" guarantee was the
    // dominant source of perceived lag — it forced every click to wait
    // 300ms even when there was nothing to wait for.
    const stashed = state.repoPath
      ? { ...state.tabSnapshots, [state.repoPath]: snapshotFrom(state) }
      : state.tabSnapshots
    const targetSnap = stashed[repoPath] ?? blankSnapshot()
    const tabs: WorkspaceTab[] = state.tabs.map(t =>
      t.root === ws.root ? { ...t, activeRepo: repoPath, view: 'repo' as const } : t,
    )
    const prevPath = state.repoPath
    const hadSnapshot = !!targetSnap.repoStatus
    set({
      tabs,
      tabSnapshots: stashed,
      repoPath,
      ...targetSnap,
      // Loading bar only lights up while we're really waiting on data —
      // the cold path. Fast-path snapshot hits clear it instantly.
      loading: !hadSnapshot,
    })
    swapWatcher(prevPath, repoPath)
    console.log(`[switchSubRepo] sync set + swapWatcher done: ${(performance.now() - t0).toFixed(1)}ms (hadSnapshot=${hadSnapshot}, snapshotFiles=${targetSnap.repoStatus?.files.length ?? 0})`)

    if (hadSnapshot) {
      // Fast path: snapshot already has data. Refresh in the background
      // via two-step load so files (esp. dirty submodules) repopulate.
      get().loadProject()
      void loadRepoStatusInTwoSteps(repoPath, (status) => {
        if (get().repoPath === repoPath) set({ repoStatus: status })
      }).catch(() => {})
      return
    }

    // Cold path: two-step load — quick header first, file list streams.
    try {
      await loadRepoStatusInTwoSteps(repoPath, (status) => {
        if (get().repoPath !== repoPath) return
        set({ repoStatus: status, loading: false })
      })
      get().loadProject()
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  setWorkspaceView: (root: string, view: 'overview' | 'repo') => {
    set(state => ({
      tabs: state.tabs.map(t => (t.root === root ? { ...t, view } : t)),
    }))
  },

  initWorkspaceRoot: async (root: string) => {
    const state = get()
    const ws = findWorkspaceByRoot(state.tabs, root)
    if (!ws || ws.rootIsRepo) return  // already a repo, nothing to do
    try {
      const status = await invoke<RepoStatus>('git_init_repo', { path: root })
      const rootName = root.split('/').filter(Boolean).pop() ?? root
      // Prepend root as the first repo; leave existing sub-repos in order.
      const updatedRepos: WorkspaceSubRepo[] = [
        { path: root, name: rootName },
        ...ws.repos,
      ]
      // Seed a snapshot for the freshly-initialised root so the dashboard
      // card shows live status without a separate fetch.
      const seededSnap: RepoSnapshot = { ...blankSnapshot(), repoStatus: status }
      set(s => ({
        tabs: s.tabs.map(t =>
          t.root === root
            ? { ...t, repos: updatedRepos, rootIsRepo: true }
            : t,
        ),
        tabSnapshots: { ...s.tabSnapshots, [root]: seededSnap },
      }))
      get().showToast(`Initialized empty git repo at ${rootName}`, 'success')
    } catch (e) {
      const msg = String(e)
      set({ error: msg })
      get().showToast(msg, 'error')
    }
  },

  closeTab: async (root: string) => {
    const state = get()
    const ws = findWorkspaceByRoot(state.tabs, root)
    if (!ws) return

    const idx = state.tabs.findIndex(t => t.root === root)
    const tabs = state.tabs.filter(t => t.root !== root)
    // Drop snapshots for every sub-repo in the closed workspace.
    const tabSnapshots = { ...state.tabSnapshots }
    for (const r of ws.repos) {
      delete tabSnapshots[r.path]
    }
    // Stop OS-level file watchers for every sub-repo in the closed workspace
    // (swapWatcher leaks watchers across tab switches for perf — closeTab is
    // the canonical cleanup point).
    stopAllWatchers(ws.repos.map(r => r.path))

    const closingActive = state.repoPath !== null && ws.repos.some(r => r.path === state.repoPath)

    // Closing an inactive workspace — leave current state alone
    if (!closingActive) {
      set({ tabs, tabSnapshots })
      return
    }

    // Closed the last tab — back to welcome
    if (tabs.length === 0) {
      set({ tabs: [], tabSnapshots: {}, repoPath: null, ...blankSnapshot() })
      return
    }

    // Closed the active tab — switch to neighbor (prefer the one to the right)
    const nextWs = tabs[Math.min(idx, tabs.length - 1)]
    const targetSnap = tabSnapshots[nextWs.activeRepo] ?? blankSnapshot()
    const prevPath = state.repoPath
    set({
      tabs,
      tabSnapshots,
      repoPath: nextWs.activeRepo,
      ...targetSnap,
    })
    swapWatcher(prevPath, nextWs.activeRepo)
    try {
      await loadRepoStatusInTwoSteps(nextWs.activeRepo, (status) => {
        if (get().repoPath !== nextWs.activeRepo) return
        set({ repoStatus: status })
      })
      get().loadProject()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  refreshRepo: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      // Use the same two-step pattern as switch — shell git for the file
      // list (no submodule recursion), then per-submodule dirty checks.
      // The previous full `open_repo` here re-introduced the slow libgit2
      // status pass AND silently dropped `isSubmodule` flags, which
      // overwrote correctly-flagged data set by `loadRepoStatusInTwoSteps`
      // moments earlier and broke auto-select.
      await loadRepoStatusInTwoSteps(repoPath, (status) => {
        if (get().repoPath !== repoPath) return
        set({ repoStatus: status })
      })
      // Stashes — cheap to enumerate, keep badge fresh on each refresh.
      try {
        const stashes = await invoke<StashEntry[]>('list_stashes', { path: repoPath })
        set({ stashes })
      } catch { /* non-fatal */ }
      // Project — cheap (a few stat()s + small JSON parse). Catches edits to
      // package.json scripts, switching from Node to Rust mid-session, etc.
      try {
        const projectInfo = await invoke<ProjectInfo>('detect_project', { path: repoPath })
        set({ projectInfo })
      } catch { /* non-fatal */ }
      try {
        const branches = await invoke<BranchInfo[]>('list_branches', { path: repoPath })
        set({ branches })
      } catch { /* non-fatal */ }
    } catch (e) {
      set({ error: String(e) })
    }
  },

  selectFile: async (path: string, staged = false, commitId?: string) => {
    const { repoPath, diffIgnoreWhitespace } = get()
    if (!repoPath) return
    const myGen = ++diffLoadGen
    const t0 = performance.now()
    console.log(`[selectFile] → ${path} (staged=${staged})`)
    set({ selectedFile: path, selectedFileStaged: staged, loading: true, activeTab: 'changes' })
    try {
      const diff = await invoke<DiffResult[]>('get_diff', {
        path: repoPath,
        file: path,
        staged: staged && !commitId,
        commitId: commitId ?? null,
        ignoreWhitespace: diffIgnoreWhitespace,
      })
      const tDiff = performance.now() - t0
      // Drop stale results: a newer selectFile / viewAllInCommit superseded us.
      if (myGen !== diffLoadGen) {
        console.log(`[selectFile] DROPPED stale result for ${path} after ${tDiff.toFixed(1)}ms`)
        return
      }
      const lineCount = diff.reduce((n, d) => n + d.hunks.reduce((m, h) => m + h.lines.length, 0), 0)
      console.log(`[selectFile] get_diff ${tDiff.toFixed(1)}ms — ${diff.length} files, ${lineCount} lines`)
      set({ diff, loading: false })
    } catch (e) {
      if (myGen !== diffLoadGen) return
      set({ error: String(e), loading: false })
    }
  },

  viewAllInCommit: async () => {
    const { repoPath, selectedCommit, diffIgnoreWhitespace } = get()
    if (!repoPath || !selectedCommit) return
    const myGen = ++diffLoadGen
    set({ selectedFile: null, loading: true })
    try {
      const diff = await invoke<DiffResult[]>('get_diff', {
        path: repoPath, file: null, staged: null, commitId: selectedCommit.id,
        ignoreWhitespace: diffIgnoreWhitespace,
      })
      if (myGen !== diffLoadGen) return
      set({ diff, loading: false })
    } catch (e) {
      if (myGen !== diffLoadGen) return
      set({ error: String(e), loading: false })
    }
  },

  selectCommit: async (commit) => {
    // Clear any stale AI explanation when moving to a different commit (or closing)
    const prev = get().commitExplanation
    if (prev && (!commit || prev.sha !== commit.id)) {
      set({ commitExplanation: null })
    }
    if (!commit) {
      set({ selectedCommit: null, commitFiles: [], diff: [], selectedFile: null })
      return
    }
    const { repoPath } = get()
    if (!repoPath) return
    try {
      // Fetch the files list and the full commit diff in parallel so the
      // DiffView can show all files immediately (and ⌘↓/⌘↑ has multiple file
      // headers to jump between). User clicking a specific file later narrows.
      const ignoreWs = get().diffIgnoreWhitespace
      const [files, diff] = await Promise.all([
        invoke<CommitFileInfo[]>('get_commit_files', { path: repoPath, id: commit.id }),
        invoke<DiffResult[]>('get_diff', {
          path: repoPath, file: null, staged: null, commitId: commit.id,
          ignoreWhitespace: ignoreWs,
        }),
      ])
      set({ selectedCommit: commit, commitFiles: files, diff, selectedFile: null })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  saveProgress: async () => {
    const { repoPath, repoStatus, commitMessage, gpgSign, showToast } = get()
    if (!repoPath || !commitMessage.trim()) return

    // Active-changelist filter: when the user has set up custom groups, the
    // commit is hard-scoped to files in the active group. Returns null when
    // no custom groups exist (legacy commit-everything path).
    const pathspec = repoStatus ? getActivePathspec(repoStatus.files) : null

    if (pathspec !== null && pathspec.length === 0) {
      showToast(tt('toast.active_group_empty'), 'error')
      return
    }

    set({ loading: true })
    try {
      let sha: string
      if (pathspec === null) {
        // Legacy path: no custom groups → commit everything (auto-stages all).
        // save_progress_signed forwards to save_progress when sign=false; only
        // the sign=true path shells out to `git commit -S`.
        sha = await invoke<string>('save_progress_signed', {
          path: repoPath,
          message: commitMessage,
          sign: gpgSign,
        })
      } else {
        // Active group path: commit only the listed files, regardless of what
        // else is staged. Files outside the active group stay where they are.
        sha = await invoke<string>('save_progress_pathspec', {
          path: repoPath,
          message: commitMessage,
          pathspec,
          sign: gpgSign,
        })
      }
      set({ commitMessage: '' })
      await get().refreshRepo()
      showToast(tt('toast.commit_ok', { short: sha.slice(0, 7) }), 'success')
    } catch (e) {
      // Surface as a toast — previously the error went to state.error which
      // nobody renders, so a failed commit looked like "nothing happened".
      showToast(String(e), 'error')
    } finally {
      set({ loading: false })
    }
  },

  createBranch: async (name: string) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('create_branch', { path: repoPath, name })
    await get().refreshRepo()
  },

  switchBranch: async (name: string) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('switch_branch', { path: repoPath, name })
    await get().refreshRepo()
  },

  stageFile: async (file: string) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('stage_file', { path: repoPath, file })
    await get().refreshRepo()
  },

  unstageFile: async (file: string) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('unstage_file', { path: repoPath, file })
    await get().refreshRepo()
  },

  discardFile: async (file: string) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('discard_file', { path: repoPath, file })
    await get().refreshRepo()
  },

  pushBranch: async () => {
    const { repoPath, repoStatus, commitMessage, gpgSign, showToast } = get()
    if (!repoPath || !repoStatus) return
    // Fail fast when the repo has no remotes — `git push origin` would otherwise
    // either error with an unfriendly fatal message after the spawn round-trip,
    // or worse, hang while git probes a misconfigured remote. Tell the user
    // exactly what to do instead.
    try {
      const remotes = await invoke<RemoteInfo[]>('list_remotes', { path: repoPath })
      if (remotes.length === 0) {
        showToast(tt('toast.no_remote_push'), 'error')
        return
      }
    } catch {
      // If list_remotes itself fails (e.g., index lock), fall through and let
      // the actual push surface that error.
    }
    try {
      if (repoStatus.files.length > 0) {
        const msg = commitMessage.trim() ||
          `${tt('toast.save_progress_default')} · ${new Date().toLocaleString(i18n.language.startsWith('en') ? 'en-US' : 'zh-CN', { hour12: false })}`
        // Same active-group filter as saveProgress so the implicit "push
        // commits your unstaged work" shortcut respects the user's grouping.
        const pathspec = getActivePathspec(repoStatus.files)
        if (pathspec === null) {
          await invoke('save_progress', { path: repoPath, message: msg })
        } else if (pathspec.length > 0) {
          await invoke('save_progress_pathspec', {
            path: repoPath,
            message: msg,
            pathspec,
            sign: gpgSign,
          })
        }
        // pathspec.length === 0: active group has nothing — skip the implicit
        // commit and just push whatever's already on the branch.
        if (commitMessage.trim()) set({ commitMessage: '' })
      }
      await invoke('git_push', { path: repoPath, branch: repoStatus.branch })
      await get().refreshRepo()
      showToast(tt('toast.push_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  pullBranch: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      const remotes = await invoke<RemoteInfo[]>('list_remotes', { path: repoPath })
      if (remotes.length === 0) {
        showToast(tt('toast.no_remote_pull'), 'error')
        return
      }
    } catch {}
    try {
      await invoke('git_pull', { path: repoPath })
      await get().refreshRepo()
      showToast(tt('toast.pull_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  fetchAll: async (prune = false) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      const remotes = await invoke<RemoteInfo[]>('list_remotes', { path: repoPath })
      if (remotes.length === 0) {
        showToast(tt('toast.no_remote_fetch'), 'error')
        return
      }
    } catch {}
    try {
      await invoke('git_fetch', { path: repoPath, remote: null, prune })
      await get().refreshRepo()
      showToast(tt('toast.fetch_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  resetToCommit: async (sha: string, mode: ResetMode) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('reset_to_commit', { path: repoPath, sha, mode })
    await get().refreshRepo()
    const label = mode === 'soft' ? tt('toast.reset_soft') : mode === 'mixed' ? tt('toast.reset_mixed') : tt('toast.reset_hard')
    showToast(tt('toast.reset_done', { mode: label, short: sha.slice(0, 7) }), 'success')
  },

  // ── Remotes ──────────────────────────────────────────────────────────
  listRemotes: async () => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<RemoteInfo[]>('list_remotes', { path: repoPath })
  },
  addRemote: async (name, url) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('add_remote', { path: repoPath, name, url })
  },
  removeRemote: async (name) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('remove_remote', { path: repoPath, name })
  },
  renameRemote: async (oldName, newName) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('rename_remote', { path: repoPath, oldName, newName })
  },
  setRemoteUrl: async (name, url) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('set_remote_url', { path: repoPath, name, url })
  },

  // ── Tags ─────────────────────────────────────────────────────────────
  listTags: async () => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<TagInfo[]>('list_tags', { path: repoPath })
  },
  createTag: async (name, target, message) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('create_tag', { path: repoPath, name, target, message })
    showToast(tt('toast.tag_created', { name }), 'success')
  },
  deleteLocalTag: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('delete_tag', { path: repoPath, name })
    showToast(tt('toast.tag_deleted', { name }), 'success')
  },
  pushTag: async (remote, tag) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('push_tag', { path: repoPath, remote, tag })
    showToast(tt('toast.tag_pushed', { tag, remote }), 'success')
  },
  deleteRemoteTag: async (remote, tag) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('delete_remote_tag', { path: repoPath, remote, tag })
    showToast(tt('toast.tag_remote_deleted', { remote, tag }), 'success')
  },

  // ── Reflog (时光机) ─────────────────────────────────────────────────
  listReflog: async (limit) => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<ReflogEntry[]>('list_reflog', { path: repoPath, refName: null, limit: limit ?? null })
  },
  restoreToReflog: async (sha) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('restore_to_reflog', { path: repoPath, sha })
    await get().refreshRepo()
    showToast(tt('toast.reflog_restored', { short: sha.slice(0, 7) }), 'success')
  },

  // ── Hunk staging ─────────────────────────────────────────────────────
  stageHunk: async (file, hunkIndex) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('stage_hunk', { path: repoPath, file, hunkIndex })
    await get().refreshRepo()
  },
  unstageHunk: async (file, hunkIndex) => {
    const { repoPath } = get()
    if (!repoPath) return
    await invoke('unstage_hunk', { path: repoPath, file, hunkIndex })
    await get().refreshRepo()
  },

  // ── Blame ────────────────────────────────────────────────────────────
  blameFile: async (file, commit) => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<BlameLine[]>('blame_file', { path: repoPath, file, commit: commit ?? null })
  },

  // ── Submodules ───────────────────────────────────────────────────────
  listSubmodules: async (opts?: { skipStatus?: boolean }) => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<SubmoduleInfo[]>('list_submodules', {
      path: repoPath,
      skipStatus: opts?.skipStatus ?? false,
    })
  },
  addSubmodule: async (url, subPath) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('add_submodule', { path: repoPath, url, subPath })
    showToast(tt('toast.submodule_added', { path: subPath }), 'success')
    await get().refreshRepo()
  },
  initSubmodule: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('init_submodule', { path: repoPath, name })
    showToast(tt('toast.submodule_initialized', { name }), 'success')
  },
  updateSubmodule: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('update_submodule', { path: repoPath, name })
    showToast(tt('toast.submodule_updated', { name }), 'success')
  },
  syncSubmodule: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('sync_submodule', { path: repoPath, name })
    showToast(tt('toast.submodule_synced', { name }), 'success')
  },
  deinitSubmodule: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('deinit_submodule', { path: repoPath, name })
    showToast(tt('toast.submodule_deinit_ok', { name }), 'success')
  },
  removeSubmodule: async (name) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('remove_submodule', { path: repoPath, name })
    showToast(tt('toast.submodule_removed', { name }), 'success')
    await get().refreshRepo()
  },

  // ── Git LFS ──────────────────────────────────────────────────────────
  lfsCheck: async () => {
    return await invoke<LfsStatus>('lfs_check', { path: get().repoPath })
  },
  lfsListPatterns: async () => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<LfsPattern[]>('lfs_list_patterns', { path: repoPath })
  },
  lfsTrack: async (pattern) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('lfs_track', { path: repoPath, pattern })
    showToast(tt('toast.lfs_track_ok', { pattern }), 'success')
  },
  lfsUntrack: async (pattern) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('lfs_untrack', { path: repoPath, pattern })
    showToast(tt('toast.lfs_untrack_ok', { pattern }), 'success')
  },
  lfsLsFiles: async () => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<LfsFile[]>('lfs_ls_files', { path: repoPath })
  },
  lfsPull: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('lfs_pull', { path: repoPath })
    showToast(tt('toast.lfs_pull_ok'), 'success')
  },
  lfsFetch: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    await invoke('lfs_fetch', { path: repoPath })
    showToast(tt('toast.lfs_fetch_ok'), 'success')
  },

  cloneRepo: async (url: string, dest: string) => {
    const result = await invoke<string>('git_clone', { url, dest })
    return result
  },

  checkoutCommit: async (id: string, info?: SelectedCommitInfo) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('checkout_commit', { path: repoPath, id })
      await get().refreshRepo()
      if (info) await get().selectCommit(info)
      showToast(tt('toast.checkout_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  showToast: (message, type = 'success') => {
    set({ toast: { message, type } })
    // Errors stay up longer — they're often actionable instructions the user
    // needs time to read, copy, or switch contexts to act on.
    setTimeout(() => set({ toast: null }), type === 'error' ? 8000 : 3500)
  },

  loadConflicts: async () => {
    const { repoPath, selectedConflictFile } = get()
    if (!repoPath) return
    try {
      const conflicts = await invoke<ConflictFile[]>('get_conflicts', { path: repoPath })
      set({ conflicts })
      // Auto-select first conflict if none selected, or if previously selected file is gone
      if (conflicts.length > 0 && !conflicts.some(c => c.path === selectedConflictFile)) {
        await get().selectConflictFile(conflicts[0].path)
      } else if (conflicts.length === 0) {
        set({ selectedConflictFile: null, conflictContent: null })
      }
    } catch (e) {
      set({ error: String(e) })
    }
  },

  selectConflictFile: async (file: string | null) => {
    const { repoPath } = get()
    if (!repoPath) {
      set({ selectedConflictFile: null, conflictContent: null })
      return
    }
    if (!file) {
      set({ selectedConflictFile: null, conflictContent: null })
      return
    }
    set({ selectedConflictFile: file })
    try {
      const content = await invoke<ConflictContent>('get_conflict_content', { path: repoPath, file })
      set({ conflictContent: content })
    } catch (e) {
      set({ error: String(e), conflictContent: null })
    }
  },

  resolveConflict: async (file: string, content: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('resolve_conflict', { path: repoPath, file, content })
      await get().refreshRepo()
      await get().loadConflicts()
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  abortMerge: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('abort_merge', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.merge_abort_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  continueMerge: async (message: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('continue_merge', { path: repoPath, message })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.merge_done'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  abortRebase: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('abort_rebase', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.rebase_abort_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  continueRebase: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('continue_rebase', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      // After continue, the rebase may have finished OR paused on the next conflict.
      // The state machine + watcher will surface whichever.
      const { repoStatus } = get()
      showToast(
        repoStatus?.state === 'rebasing' ? tt('toast.rebase_next_conflict') : tt('toast.rebase_done'),
        'success'
      )
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  revertCommit: async (sha: string, message: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('revert_commit', { path: repoPath, sha, message })
      await get().refreshRepo()
      showToast(tt('toast.revert_done'), 'success')
    } catch (e) {
      // Conflict will surface via state change → ConflictView; toast still informs.
      showToast(String(e), 'error')
      await get().refreshRepo()
    }
  },

  abortRevert: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('abort_revert', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.revert_abort_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  continueRevert: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('continue_revert', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.revert_continue_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  cherryPickCommit: async (sha: string, message: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('cherry_pick_commit', { path: repoPath, sha, message })
      await get().refreshRepo()
      showToast(tt('toast.cherry_done'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
      await get().refreshRepo()
    }
  },

  abortCherryPick: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('abort_cherry_pick', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.cherry_abort_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  continueCherryPick: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('continue_cherry_pick', { path: repoPath })
      set({ conflicts: [], selectedConflictFile: null, conflictContent: null })
      await get().refreshRepo()
      showToast(tt('toast.cherry_continue_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  loadStashes: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      const stashes = await invoke<StashEntry[]>('list_stashes', { path: repoPath })
      set({ stashes })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  createStash: async (message: string | null) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('create_stash', { path: repoPath, message })
      await get().refreshRepo()
      showToast(tt('toast.stash_created'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  applyStash: async (index: number) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('apply_stash', { path: repoPath, index })
      await get().refreshRepo()
      showToast(tt('toast.stash_applied'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
      // Stash list may have changed (or workdir may now have conflict markers)
      await get().refreshRepo()
    }
  },

  popStash: async (index: number) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('pop_stash', { path: repoPath, index })
      await get().refreshRepo()
      showToast(tt('toast.stash_popped'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
      // On conflict, git keeps the stash in the list — refresh to reflect that
      await get().refreshRepo()
    }
  },

  loadProject: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      const info = await invoke<ProjectInfo>('detect_project', { path: repoPath })
      set({ projectInfo: info })
    } catch { /* non-fatal */ }
  },

  sendToTerminal: (cmd: string) => {
    set({ pendingTerminalCommand: cmd, terminalOpen: true })
  },

  consumeTerminalCommand: () => set({ pendingTerminalCommand: null }),

  loadGraph: async () => {
    const { repoPath, graphLimit } = get()
    if (!repoPath) return
    set({ graphLoading: true })
    try {
      const data = await invoke<GraphCommit[]>('get_graph', { path: repoPath, limit: graphLimit })
      set({ graphCommits: data })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ graphLoading: false })
    }
  },

  loadMoreGraph: async () => {
    const { graphLimit, graphLoadStep, repoPath } = get()
    if (!repoPath) return
    const next = graphLimit + Math.max(1, graphLoadStep)
    set({ graphLimit: next, graphLoading: true })
    try {
      const data = await invoke<GraphCommit[]>('get_graph', { path: repoPath, limit: next })
      set({ graphCommits: data })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ graphLoading: false })
    }
  },

  loadAllGraph: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    set({ graphLoading: true })
    try {
      // Large limit — git2 revwalk stops naturally at the root.
      const HUGE = 1_000_000
      const data = await invoke<GraphCommit[]>('get_graph', { path: repoPath, limit: HUGE })
      set({ graphCommits: data, graphLimit: data.length })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ graphLoading: false })
    }
  },

  setGraphSelected: (id) => set({ graphSelected: id }),

  setGraphLoadStep: (n) => {
    const v = Math.max(50, Math.min(2000, Math.floor(n) || 200))
    localStorage.setItem('versa:graphLoadStep', String(v))
    set({ graphLoadStep: v })
  },

  toggleRightSidebar: () => {
    const next = !get().rightSidebarOpen
    localStorage.setItem('versa:rightSidebarOpen', next ? '1' : '0')
    set({ rightSidebarOpen: next })
  },

  setGpgSign: (on) => {
    localStorage.setItem('versa:gpgSign', on ? '1' : '0')
    set({ gpgSign: on })
  },

  setDiffIgnoreWhitespace: (on) => {
    localStorage.setItem('versa:diffIgnoreWhitespace', on ? '1' : '0')
    set({ diffIgnoreWhitespace: on })
    // Refresh whatever diff is currently shown so the toggle takes effect.
    get().refreshRepo()
  },
  setDiffWordLevel: (on) => {
    localStorage.setItem('versa:diffWordLevel', on ? '1' : '0')
    set({ diffWordLevel: on })
  },
  setDiffSideBySide: (on) => {
    localStorage.setItem('versa:diffSideBySide', on ? '1' : '0')
    set({ diffSideBySide: on })
  },

  setFileTreeView: (on) => {
    localStorage.setItem('versa:fileTreeView', on ? '1' : '0')
    set({ fileTreeView: on })
  },

  loadBisectStatus: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      const s = await invoke<BisectStatus>('bisect_status', { path: repoPath })
      set({ bisectStatus: s })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  startBisect: async (goodSha: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      const s = await invoke<BisectStatus>('bisect_start', {
        path: repoPath, goodSha, badSha: null,
      })
      set({ bisectStatus: s })
      await get().refreshRepo()
      showToast(tt('toast.bisect_started'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  bisectMark: async (kind) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      const s = await invoke<BisectStatus>('bisect_mark', { path: repoPath, kind })
      set({ bisectStatus: s })
      if (s.kind === 'found') {
        showToast(tt('toast.bisect_found'), 'success')
      }
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  bisectReset: async () => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('bisect_reset', { path: repoPath })
      set({ bisectStatus: null })
      await get().refreshRepo()
      showToast(tt('toast.bisect_stopped'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  aiSuggestBisectGood: async () => {
    const { repoPath, aiConfig } = get()
    if (!repoPath) throw new Error('no repo open')
    if (!aiConfig.apiKey.trim()) {
      throw new Error(tt('toast.ai_not_configured'))
    }
    return await invoke<BisectSuggestion>('ai_suggest_bisect_good', {
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model.trim() || null,
      baseUrl: aiConfig.baseUrl.trim() || null,
      path: repoPath,
    })
  },

  locateCommit: async (sha: string) => {
    const { repoPath } = get()
    if (!repoPath) return -1
    let idx = get().graphCommits.findIndex(c => c.id === sha)
    if (idx >= 0) return idx
    try {
      const depth = await invoke<number | null>('find_commit_depth', { path: repoPath, sha })
      if (depth === null) return -1
      const target = depth + 50
      if (target > get().graphLimit) {
        set({ graphLimit: target, graphLoading: true })
        try {
          const data = await invoke<GraphCommit[]>('get_graph', { path: repoPath, limit: target })
          set({ graphCommits: data })
        } finally {
          set({ graphLoading: false })
        }
      }
      return get().graphCommits.findIndex(c => c.id === sha)
    } catch {
      return -1
    }
  },

  loadBranches: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      const branches = await invoke<BranchInfo[]>('list_branches', { path: repoPath })
      set({ branches })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  checkoutRemoteBranch: async (fullName: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('checkout_remote_branch', { path: repoPath, fullName })
      await get().refreshRepo()
      showToast(tt('toast.checkout_ok'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  renameBranch: async (oldName: string, newName: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('rename_branch', { path: repoPath, oldName, newName })
      await get().refreshRepo()
      showToast(tt('toast.branch_renamed', { name: newName }), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  deleteBranch: async (name: string, force: boolean) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('delete_branch', { path: repoPath, name, force })
      await get().refreshRepo()
      showToast(tt('toast.branch_deleted', { name }), 'success')
    } catch (e) {
      // Re-throw so caller can react (e.g. show "force?" option on "not fully merged")
      showToast(String(e), 'error')
      throw e
    }
  },

  deleteRemoteBranch: async (fullName: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('delete_remote_branch', { path: repoPath, fullName })
      await get().refreshRepo()
      showToast(tt('toast.branch_deleted_remote', { name: fullName }), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  analyzeMerge: async (target: string) => {
    const { repoPath } = get()
    if (!repoPath) throw new Error('no repo open')
    return await invoke<MergeAnalysis>('analyze_merge', { path: repoPath, target })
  },

  aiAnalyzeMergeRisk: async (target: string) => {
    const { repoPath, aiConfig } = get()
    if (!repoPath) throw new Error('no repo open')
    if (!aiConfig.apiKey.trim()) {
      throw new Error(tt('toast.ai_not_configured'))
    }
    return await invoke<MergeRiskReport>('ai_analyze_merge_risk', {
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKey,
      model: aiConfig.model.trim() || null,
      baseUrl: aiConfig.baseUrl.trim() || null,
      path: repoPath,
      target,
    })
  },

  aiAnalyzeFileConflict: async (target: string, file: string, onDelta) => {
    const { repoPath, aiConfig } = get()
    if (!repoPath) throw new Error('no repo open')
    if (!aiConfig.apiKey.trim()) {
      throw new Error(tt('toast.ai_not_configured'))
    }
    return await withAIStream(
      'ai_analyze_file_conflict',
      {
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model.trim() || null,
        baseUrl: aiConfig.baseUrl.trim() || null,
        path: repoPath,
        target,
        file,
      },
      acc => onDelta?.(acc),
      id => set({ currentAiStreamId: id }),
    )
  },

  mergeBranch: async (target: string) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('merge_branch', { path: repoPath, target })
      await get().refreshRepo()
      // After merge: clean (commit landed) or 'merging' (conflicts — ConflictView takes over)
      const { repoStatus } = get()
      if (repoStatus?.state === 'merging') {
        showToast(tt('toast.merge_conflict_switch'), 'success')
      } else {
        showToast(tt('toast.merge_branch_ok', { branch: target }), 'success')
      }
    } catch (e) {
      showToast(String(e), 'error')
      // refresh so state machine + watcher can route to ConflictView on conflict
      await get().refreshRepo()
    }
  },

  dropStash: async (index: number) => {
    const { repoPath, showToast } = get()
    if (!repoPath) return
    try {
      await invoke('drop_stash', { path: repoPath, index })
      await get().refreshRepo()
      showToast(tt('toast.stash_dropped'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
    }
  },

  requestConflictSuggestion: async (hunkIdx: number) => {
    const { repoPath, aiConfig, selectedConflictFile, conflictContent, showToast } = get()
    if (!repoPath || !selectedConflictFile || !conflictContent) return
    if (!aiConfig.apiKey.trim()) {
      showToast(tt('toast.ai_not_configured'), 'error')
      return
    }
    const hunk = conflictContent.hunks[hunkIdx]
    if (!hunk) return

    // Send just the conflict region plus 3 lines of context on each side
    const oursText   = extractWithContext(conflictContent.ours,   hunk.oursStart,   hunk.oursEnd,   3)
    const theirsText = extractWithContext(conflictContent.theirs, hunk.theirsStart, hunk.theirsEnd, 3)

    set({ aiConflictLoading: true, aiConflictSuggestion: null })
    try {
      const s = await invoke<ConflictSuggestion>('ai_resolve_conflict', {
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model.trim() || null,
        baseUrl: aiConfig.baseUrl.trim() || null,
        file: selectedConflictFile,
        ours: oursText,
        theirs: theirsText,
        base: conflictContent.base,
      })
      set({ aiConflictSuggestion: { ...s, hunkIdx }, aiConflictLoading: false })
    } catch (e) {
      set({ aiConflictLoading: false })
      showToast(String(e), 'error')
    }
  },

  clearConflictSuggestion: () => set({ aiConflictSuggestion: null }),

  explainSelectedCommit: async () => {
    const { repoPath, selectedCommit, aiConfig, showToast } = get()
    if (!repoPath || !selectedCommit) return
    if (!aiConfig.apiKey.trim()) {
      showToast(tt('toast.ai_not_configured'), 'error')
      return
    }
    const sha = selectedCommit.id
    // Start with an empty bubble — deltas grow the text as they stream in.
    set({ commitExplanationLoading: true, commitExplanation: { sha, text: '' } })
    try {
      const diffs = await invoke<DiffResult[]>('get_diff', {
        path: repoPath,
        file: null,
        staged: null,
        commitId: sha,
      })
      const diffText = diffsToUnifiedText(diffs)
      if (!diffText.trim()) {
        showToast(tt('toast.commit_empty'), 'error')
        set({ commitExplanation: null })
        return
      }
      const text = await withAIStream(
        'ai_explain_commit',
        {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model.trim() || null,
          baseUrl: aiConfig.baseUrl.trim() || null,
          subject: selectedCommit.message,
          body: '',
          author: '',
          diff: diffText,
        },
        acc => {
          // Only update if still on the same commit (user may have moved on)
          if (get().selectedCommit?.id === sha) {
            set({ commitExplanation: { sha, text: acc } })
          }
        },
        id => set({ currentAiStreamId: id }),
      )
      if (get().selectedCommit?.id === sha) {
        set({ commitExplanation: { sha, text: text.trim() } })
      }
    } catch (e) {
      showToast(String(e), 'error')
      set({ commitExplanation: null })
    } finally {
      set({ commitExplanationLoading: false })
    }
  },

  loadHistory: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    const commits = await invoke<CommitInfo[]>('get_history', { path: repoPath, limit: 50 })
    set({ commits })
  },

  cancelCurrentAI: () => {
    const id = get().currentAiStreamId
    if (!id) return
    // Fire-and-forget. Backend flips the cancel flag; the active call_ai_stream
    // poll picks it up between chunks, breaks the loop, and returns whatever it
    // accumulated so far. The withAIStream wrapper clears currentAiStreamId in
    // its `finally` block, so we don't touch it here.
    invoke('cancel_ai_stream', { streamId: id }).catch(() => {})
  },
  setTab: (tab) => set({ activeTab: tab }),
  setTerminalOpen: (open) => set({ terminalOpen: open }),

  openNewTerminal: (repoPath) => {
    const id = `s${Math.random().toString(36).slice(2)}`
    const prev = get().terminalsByRepo[repoPath] ?? []
    const title = `Terminal ${prev.length + 1}`
    set({
      terminalsByRepo: { ...get().terminalsByRepo, [repoPath]: [...prev, { id, title }] },
      activeTerminalByRepo: { ...get().activeTerminalByRepo, [repoPath]: id },
    })
    return id
  },

  openAgentTerminal: (repoPath, agent) => {
    const id = `a${Math.random().toString(36).slice(2)}`
    const prev = get().terminalsByRepo[repoPath] ?? []
    // Resolve argv at open-time so later edits to the agent's config don't
    // affect this running tab (avoids "I edited args mid-run and now things
    // are weird"). Snapshot of unstaged paths is taken NOW so the exit
    // handler can diff against it and figure out what the agent touched.
    const args = agent.extraArgs.split(/\s+/).filter((s) => s.length > 0)
    const status = get().repoStatus
    const preUnstagedSnapshot = status
      ? status.files.filter((f) => f.unstagedStatus).map((f) => f.path)
      : []
    const session: TermSession = {
      id,
      title: agent.name,
      agentId: agent.id,
      agentCommand: agent.command,
      agentArgs: args,
      preUnstagedSnapshot,
    }
    set({
      terminalsByRepo: { ...get().terminalsByRepo, [repoPath]: [...prev, session] },
      activeTerminalByRepo: { ...get().activeTerminalByRepo, [repoPath]: id },
    })
    return id
  },

  markAgentTerminalExited: (sessionId) => {
    set((state) => {
      const next = { ...state.terminalsByRepo }
      for (const [repo, list] of Object.entries(state.terminalsByRepo)) {
        if (list.some((s) => s.id === sessionId)) {
          next[repo] = list.map((s) => (s.id === sessionId ? { ...s, exited: true } : s))
        }
      }
      return { terminalsByRepo: next }
    })
  },

  markAgentChangelist: (sessionId, changelistId) => {
    set((state) => {
      const next = { ...state.terminalsByRepo }
      for (const [repo, list] of Object.entries(state.terminalsByRepo)) {
        if (list.some((s) => s.id === sessionId)) {
          next[repo] = list.map((s) => (s.id === sessionId ? { ...s, changelistId } : s))
        }
      }
      return { terminalsByRepo: next }
    })
  },

  closeTerminal: (repoPath, sessionId) => {
    const list = get().terminalsByRepo[repoPath] ?? []
    const nextList = list.filter((s) => s.id !== sessionId)
    const active = get().activeTerminalByRepo[repoPath]
    let nextActive = active
    if (active === sessionId) {
      // Pick a neighbor — prefer the one after the closed tab so closing
      // walks rightward; fall back to the one before if we just closed the
      // last tab; null if no tabs remain.
      const idx = list.findIndex((s) => s.id === sessionId)
      const right = nextList[idx]
      const left = idx > 0 ? nextList[idx - 1] : undefined
      nextActive = (right ?? left ?? null)?.id ?? null
    }
    set({
      terminalsByRepo: { ...get().terminalsByRepo, [repoPath]: nextList },
      activeTerminalByRepo: { ...get().activeTerminalByRepo, [repoPath]: nextActive },
    })
    // Fire-and-forget the backend close — UI doesn't block on the IPC.
    invoke('pty_close', { sessionId }).catch(() => {})
  },

  setActiveTerminal: (repoPath, sessionId) => {
    set({
      activeTerminalByRepo: { ...get().activeTerminalByRepo, [repoPath]: sessionId },
    })
  },
  setCommitMessage: (msg) => set({ commitMessage: msg }),
  setTheme: (theme) => {
    localStorage.setItem('versa:theme', theme)
    if (theme === 'system') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }
    set({ theme })
  },

  setAIConfig: (patch) => {
    const next: AIConfig = { ...get().aiConfig, ...patch }
    localStorage.setItem('versa:aiConfig', JSON.stringify(next))
    set({ aiConfig: next })
  },

  generateCommitMessage: async () => {
    const { repoPath, repoStatus, aiConfig, showToast } = get()
    if (!repoPath) return
    if (!aiConfig.apiKey.trim()) {
      showToast(tt('toast.ai_not_configured'), 'error')
      return
    }
    if (!repoStatus || repoStatus.files.length === 0) {
      showToast(tt('toast.no_diff_to_explain'), 'error')
      return
    }

    // Scope the AI's view to the active changelist so the generated message
    // describes what's *actually* about to be committed (save_progress
    // already hard-scopes to the active group). When the user has no custom
    // groups, this filter is a no-op and the AI still sees everything.
    const activePathspec = getActivePathspec(repoStatus.files)
    if (activePathspec !== null && activePathspec.length === 0) {
      showToast(tt('toast.active_group_empty'), 'error')
      return
    }
    const activeFiles =
      activePathspec === null
        ? repoStatus.files
        : repoStatus.files.filter((f) => activePathspec.includes(f.path))

    // Hard cap on file count. The diff payload + AI context cost scale
    // linearly with file count; 44k-file requests will either time out
    // libgit2, blow past the model's context window, or both — and burn
    // tokens for a guaranteed failure on the way. Refuse early and tell
    // the user to narrow scope with a changelist (the AI honors active
    // changelist filtering already, so this is the right escape hatch).
    if (activeFiles.length > AI_MAX_FILES) {
      showToast(
        tt('toast.ai_too_many_files', { count: activeFiles.length, cap: AI_MAX_FILES }),
        'error',
      )
      return
    }

    // Prefer the staged diff; if nothing in the active group is staged, fall
    // back to the unstaged working-tree diff (this is what "保存进度" would
    // commit anyway, after auto-staging).
    const hasStaged = activeFiles.some((f) => f.stagedStatus)

    // Remember whatever the user typed before — restored on error so we don't
    // wipe their draft for a transient AI failure.
    const original = get().commitMessage
    set({ aiGenerating: true, commitMessage: '' })
    try {
      const allDiffs = await invoke<DiffResult[]>('get_diff', {
        path: repoPath,
        file: null,
        staged: hasStaged,
        commitId: null,
      })
      const diffs = filterToActiveByFileKey(allDiffs, (d) => d.file)
      const diffText = diffsToUnifiedText(diffs)
      if (!diffText.trim()) {
        showToast(tt('toast.no_diff'), 'error')
        set({ commitMessage: original })
        return
      }
      const message = await withAIStream(
        'ai_generate_commit_message',
        {
          provider: aiConfig.provider,
          apiKey: aiConfig.apiKey,
          model: aiConfig.model.trim() || null,
          baseUrl: aiConfig.baseUrl.trim() || null,
          diff: diffText,
        },
        acc => set({ commitMessage: acc }),
        id => set({ currentAiStreamId: id }),
      )
      const trimmed = message.trim()
      if (!trimmed) {
        // The provider returned a 200 OK but the stream produced no text —
        // common with wrong model name, missing api-key permissions, or a
        // content filter rejecting the prompt. Without this branch the UI
        // would silently re-enable with an empty textarea and look like
        // "nothing happened".
        // eslint-disable-next-line no-console
        console.warn('[ai_generate_commit_message] provider returned empty content', {
          provider: aiConfig.provider,
          model: aiConfig.model.trim() || '(default)',
          baseUrl: aiConfig.baseUrl.trim() || '(default)',
          diffChars: diffText.length,
        })
        showToast(tt('toast.ai_empty_response'), 'error')
        set({ commitMessage: original })
        return
      }
      set({ commitMessage: trimmed })
    } catch (e) {
      showToast(String(e), 'error')
      set({ commitMessage: original })
    } finally {
      set({ aiGenerating: false })
    }
  },
}))

function extractWithContext(blob: string, start: number, end: number, ctx: number): string {
  // start/end are 1-indexed; end is exclusive (matches ConflictHunk semantics)
  const lines = blob.split('\n')
  const s = Math.max(0, start - 1 - ctx)
  const e = Math.min(lines.length, end - 1 + ctx)
  return lines.slice(s, e).join('\n')
}

export function diffsToUnifiedText(diffs: DiffResult[]): string {
  const stripNL = (s: string) => s.endsWith('\n') ? s.slice(0, -1) : s
  return diffs.map(d => {
    const out: string[] = [`diff --git a/${d.file} b/${d.file}`]
    for (const h of d.hunks) {
      out.push(stripNL(h.header))
      for (const line of h.lines) {
        out.push(line.origin + stripNL(line.content))
      }
    }
    return out.join('\n')
  }).join('\n')
}
