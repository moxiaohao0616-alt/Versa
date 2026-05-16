import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import i18n from '../i18n'

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

export interface RepoTab {
  path: string
  name: string
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
  activeTab: 'changes' | 'history' | 'branches'
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

/**
 * Swap the backend file watcher to follow the active tab. Inactive tabs are
 * left unwatched — they get refreshed via `open_repo` on next switchTab.
 */
function swapWatcher(oldPath: string | null, newPath: string | null) {
  if (oldPath === newPath) return
  if (oldPath) invoke('stop_watching', { path: oldPath }).catch(() => {})
  if (newPath) invoke('start_watching', { path: newPath }).catch(() => {})
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
  // Multi-tab: ordered list of open repos. Each tab's per-repo state is
  // stashed in `tabSnapshots` when it's not the active one.
  tabs: RepoTab[]
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
  activeTab: 'changes' | 'history' | 'branches'
  terminalOpen: boolean
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

  // Command queued for the embedded Terminal to pick up and run. Cleared by
  // the Terminal once consumed.
  pendingTerminalCommand: string | null

  // Actions
  openRepo: (path: string) => Promise<void>
  switchTab: (path: string) => Promise<void>
  closeTab: (path: string) => Promise<void>
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
  listSubmodules: () => Promise<SubmoduleInfo[]>
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
  bisectStatus: null,
  currentAiStreamId: null,
  diff: [],
  commits: [],
  recentRepos: JSON.parse(localStorage.getItem('versa:recentRepos') || '[]'),
  activeTab: 'changes',
  terminalOpen: false,
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
    // Already open — just switch to it
    if (state.tabs.some(t => t.path === path)) {
      await get().switchTab(path)
      return
    }
    set({ loading: true, error: null })
    try {
      const status = await invoke<RepoStatus>('open_repo', { path })
      const name = path.split('/').filter(Boolean).pop() ?? path

      // Stash current tab's state before swapping in the new one
      const stashed = state.repoPath
        ? { ...state.tabSnapshots, [state.repoPath]: snapshotFrom(state) }
        : state.tabSnapshots

      const entry: RecentRepo = { path, name, lastOpened: Date.now() }
      const prev: RecentRepo[] = JSON.parse(localStorage.getItem('versa:recentRepos') || '[]')
      const updated = [entry, ...prev.filter(r => r.path !== path)].slice(0, 10)
      localStorage.setItem('versa:recentRepos', JSON.stringify(updated))

      const prevPath = state.repoPath
      set({
        tabs: [...state.tabs, { path, name }],
        tabSnapshots: stashed,
        repoPath: path,
        ...blankSnapshot(),
        repoStatus: status,
        recentRepos: updated,
        loading: false,
      })
      swapWatcher(prevPath, path)
      get().loadProject()
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  switchTab: async (path: string) => {
    const state = get()
    if (state.repoPath === path) return
    if (!state.tabs.some(t => t.path === path)) return

    // Stash the current tab's state, then restore the target tab's
    const stashed = state.repoPath
      ? { ...state.tabSnapshots, [state.repoPath]: snapshotFrom(state) }
      : state.tabSnapshots
    const targetSnap = stashed[path] ?? blankSnapshot()

    const prevPath = state.repoPath
    set({
      tabSnapshots: stashed,
      repoPath: path,
      ...targetSnap,
    })
    swapWatcher(prevPath, path)

    // Refresh in background — snapshot may be stale (e.g. file changed since)
    try {
      const status = await invoke<RepoStatus>('open_repo', { path })
      set({ repoStatus: status })
      get().loadProject()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  closeTab: async (path: string) => {
    const state = get()
    if (!state.tabs.some(t => t.path === path)) return

    const idx = state.tabs.findIndex(t => t.path === path)
    const tabs = state.tabs.filter(t => t.path !== path)
    const tabSnapshots = { ...state.tabSnapshots }
    delete tabSnapshots[path]

    // Closing an inactive tab — leave current state alone
    if (state.repoPath !== path) {
      set({ tabs, tabSnapshots })
      return
    }

    // Closed the last tab — back to welcome
    if (tabs.length === 0) {
      set({ tabs: [], tabSnapshots: {}, repoPath: null, ...blankSnapshot() })
      swapWatcher(path, null)
      return
    }

    // Closed the active tab — switch to neighbor (prefer the one to the right)
    const nextTab = tabs[Math.min(idx, tabs.length - 1)]
    const targetSnap = tabSnapshots[nextTab.path] ?? blankSnapshot()
    set({
      tabs,
      tabSnapshots,
      repoPath: nextTab.path,
      ...targetSnap,
    })
    swapWatcher(path, nextTab.path)
    try {
      const status = await invoke<RepoStatus>('open_repo', { path: nextTab.path })
      set({ repoStatus: status })
      get().loadProject()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  refreshRepo: async () => {
    const { repoPath } = get()
    if (!repoPath) return
    try {
      const status = await invoke<RepoStatus>('open_repo', { path: repoPath })
      set({ repoStatus: status })
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
    set({ selectedFile: path, selectedFileStaged: staged, loading: true, activeTab: 'changes' })
    try {
      const diff = await invoke<DiffResult[]>('get_diff', {
        path: repoPath,
        file: path,
        staged: staged && !commitId,
        commitId: commitId ?? null,
        ignoreWhitespace: diffIgnoreWhitespace,
      })
      set({ diff, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  viewAllInCommit: async () => {
    const { repoPath, selectedCommit, diffIgnoreWhitespace } = get()
    if (!repoPath || !selectedCommit) return
    set({ selectedFile: null, loading: true })
    try {
      const diff = await invoke<DiffResult[]>('get_diff', {
        path: repoPath, file: null, staged: null, commitId: selectedCommit.id,
        ignoreWhitespace: diffIgnoreWhitespace,
      })
      set({ diff, loading: false })
    } catch (e) {
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
    const { repoPath, commitMessage, gpgSign } = get()
    if (!repoPath || !commitMessage.trim()) return
    set({ loading: true })
    try {
      // save_progress_signed forwards to save_progress when sign=false; only
      // the sign=true path shells out to `git commit -S` and respects the
      // user's gpg/ssh signing config.
      await invoke('save_progress_signed', { path: repoPath, message: commitMessage, sign: gpgSign })
      set({ commitMessage: '' })
      await get().refreshRepo()
    } catch (e) {
      set({ error: String(e) })
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
    const { repoPath, repoStatus, commitMessage, showToast } = get()
    if (!repoPath || !repoStatus) return
    try {
      if (repoStatus.files.length > 0) {
        const msg = commitMessage.trim() ||
          `${tt('toast.save_progress_default')} · ${new Date().toLocaleString(i18n.language.startsWith('en') ? 'en-US' : 'zh-CN', { hour12: false })}`
        await invoke('save_progress', { path: repoPath, message: msg })
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
  listSubmodules: async () => {
    const { repoPath } = get()
    if (!repoPath) return []
    return await invoke<SubmoduleInfo[]>('list_submodules', { path: repoPath })
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
    setTimeout(() => set({ toast: null }), 3500)
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

    // Prefer the staged diff; if nothing staged, fall back to the unstaged
    // working-tree diff (this is what "保存进度" would commit anyway).
    const hasStaged = repoStatus.files.some(f => f.stagedStatus)

    // Remember whatever the user typed before — restored on error so we don't
    // wipe their draft for a transient AI failure.
    const original = get().commitMessage
    set({ aiGenerating: true, commitMessage: '' })
    try {
      const diffs = await invoke<DiffResult[]>('get_diff', {
        path: repoPath,
        file: null,
        staged: hasStaged,
        commitId: null,
      })
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
      set({ commitMessage: message.trim() })
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

function diffsToUnifiedText(diffs: DiffResult[]): string {
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
