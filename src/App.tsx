import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { listen } from '@tauri-apps/api/event'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { DiffView } from './components/Diff'
import { Terminal } from './components/Terminal'
import { WelcomeScreen } from './components/WelcomeScreen'
import { Settings } from './components/Settings'
import { BranchesView } from './components/Branches'
import { UpdateBanner } from './components/UpdateBanner'
import { CompareView } from './components/Compare'
import { SearchPanel, SearchModal } from './components/Search'
import { HistoryPane } from './components/History/HistoryPane'
import { ConflictView } from './components/Conflict'
import { RepoListSidebar } from './components/RepoListSidebar'
import { RepoPalette } from './components/RepoPalette'
import { SubRepoStrip } from './components/SubRepoStrip'
import { WorkspaceOverview } from './components/WorkspaceOverview'
import { BisectBanner } from './components/Bisect'
import { RightPanel } from './components/RightPanel'
import { BranchSwitcher } from './components/BranchSwitcher'
import { CheatsheetModal } from './components/Cheatsheet'
import { AboutModal } from './components/About'
import { OnboardingModal, shouldShowOnboarding } from './components/Onboarding'
import { SyncStatus } from './cloud/SyncStatus'
import './styles/app.css'

export default function App() {
  const { t } = useTranslation()
  const { repoPath, repoStatus, terminalOpen, openRepo, theme, activeTab, rightSidebarOpen, toggleRightSidebar, tabs, setWorkspaceView } = useStore()
  // Subscribed so the grid template var below re-renders when the user
  // drags the right panel's resize handle.
  const rightPanelWidth = useStore(s => s.rightPanel.width)
  // The hairline progress bar lights up whenever anything async is in
  // flight for the current repo: a cold-path switch, the regular file
  // list load (step 2), or the per-submodule dirty scan (step 3).
  const busy = useStore(s => {
    if (s.loading) return true
    if (!s.repoPath) return false
    return !!s.filesLoadPending[s.repoPath] || !!s.submoduleCheckPending[s.repoPath]
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [onboardingOpen, setOnboardingOpen] = useState(() => shouldShowOnboarding())
  const [dragging, setDragging] = useState(false)

  // Apply persisted theme on first render
  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme
    } else {
      document.documentElement.dataset.theme = theme
    }
  }, [theme])

  const handleOpenRepo = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === 'string') {
      await openRepo(selected)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc — cancel the in-flight AI stream, if any. Bare key (no modifier);
      // we don't want to swallow Esc when no stream is running so it still
      // closes modals/menus normally.
      if (e.key === 'Escape') {
        const s = useStore.getState()
        if (s.currentAiStreamId) {
          e.preventDefault()
          s.cancelCurrentAI()
        }
        return
      }
      // `?` — open shortcut cheatsheet (when not typing in a text field).
      if (e.key === '?' && !isEditableTarget(e.target)) {
        e.preventDefault()
        setCheatsheetOpen(true)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const s = useStore.getState()

      // ⌘P — open repo quick-switcher palette
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }

      // ⌘` — toggle terminal
      if (e.key === '`') {
        s.setTerminalOpen(!s.terminalOpen)
        return
      }
      // ⌘W — close active tab
      if (e.key.toLowerCase() === 'w' && s.repoPath) {
        e.preventDefault()
        s.closeTab(s.repoPath)
        return
      }
      // ⌘F — open diff search bar (only when DiffView is the active main area).
      if (e.key.toLowerCase() === 'f' && !e.shiftKey && !e.altKey) {
        // Don't fight the browser's native find inside text fields.
        if (!isEditableTarget(e.target)) {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('versa:open-diff-search'))
          return
        }
      }
      // ⌘⇧F — global content search modal. Mirrors the icon-bar Search tab
      // (they share Zustand state, see [[feedback-shared-search-state]]).
      if (e.key.toLowerCase() === 'f' && e.shiftKey && !e.altKey) {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      // ⌘1 … ⌘9 — jump straight to the Nth open repo tab. Mirrors the
      // pattern of VS Code / Chrome / Slack, so muscle memory carries over.
      // No isEditableTarget guard: the modifier key being held makes this
      // an unambiguous global shortcut, just like ⌘W / ⌘P — and without
      // this xterm-hosted agent sessions would swallow it because xterm
      // backs input with a hidden textarea (target would look editable).
      // Skipped only when Shift is held — that combination is reserved
      // for future per-pane shortcuts.
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1
        if (n < s.tabs.length) {
          e.preventDefault()
          s.switchTab(s.tabs[n].root)
        }
        return
      }
      // ⌘⇧] / ⌘⇧[ — next / previous workspace tab
      if (e.shiftKey && (e.key === ']' || e.key === '[' || e.key === '}' || e.key === '{')) {
        if (s.tabs.length < 2 || !s.repoPath) return
        e.preventDefault()
        const idx = s.tabs.findIndex(t => t.repos?.some(r => r.path === s.repoPath))
        if (idx < 0) return
        const dir = (e.key === ']' || e.key === '}') ? 1 : -1
        const next = s.tabs[(idx + dir + s.tabs.length) % s.tabs.length]
        s.switchTab(next.root)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Native menu (macOS menu bar / Win-Linux menu) dispatches a single
  // `versa:menu` event per click; here we map the id back to an in-app
  // action. URL-opening items are handled in Rust, so they never land here.
  useEffect(() => {
    let unlisten: (() => void) | null = null
    listen<string>('versa:menu', evt => {
      const id = evt.payload
      const s = useStore.getState()
      switch (id) {
        case 'open_repo':
          handleOpenRepo()
          break
        case 'close_tab':
          if (s.repoPath) {
            const ws = s.tabs.find(t => t.repos?.some(r => r.path === s.repoPath))
            if (ws) s.closeTab(ws.root)
          }
          break
        case 'open_settings':
          setSettingsOpen(true)
          break
        case 'open_cheatsheet':
          setCheatsheetOpen(true)
          break
        case 'open_about':
          setAboutOpen(true)
          break
        case 'view_changes':
          s.setTab('changes')
          break
        case 'view_history':
          s.setTab('history')
          break
        case 'view_branches':
          s.setTab('branches')
          break
        case 'toggle_terminal':
          s.setTerminalOpen(!s.terminalOpen)
          break
        case 'toggle_right_sidebar':
          s.toggleRightSidebar()
          break
        case 'next_tab':
        case 'prev_tab': {
          if (s.tabs.length < 2 || !s.repoPath) return
          const idx = s.tabs.findIndex(tab => tab.repos?.some(r => r.path === s.repoPath))
          if (idx < 0) break
          const dir = id === 'next_tab' ? 1 : -1
          const next = s.tabs[(idx + dir + s.tabs.length) % s.tabs.length]
          s.switchTab(next.root)
          break
        }
        case 'check_updates':
          // Updater check is wired into the Settings page already; just
          // open Settings so the user can hit the button.
          setSettingsOpen(true)
          break
      }
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  // Deep link from the SyncStatus indicator: open Settings (re-dispatched
  // here for Settings/index.tsx to navigate to the Cloud sub-page).
  useEffect(() => {
    const onNav = () => setSettingsOpen(true)
    window.addEventListener('versa:nav-cloud-settings', onNav)
    window.addEventListener('versa:nav-agents-settings', onNav)
    return () => {
      window.removeEventListener('versa:nav-cloud-settings', onNav)
      window.removeEventListener('versa:nav-agents-settings', onNav)
    }
  }, [])

  // Streaming progress from git push/pull/clone (one frame per stderr line)
  useEffect(() => {
    let unlistenFn: (() => void) | null = null
    listen<{
      phase: 'push' | 'pull' | 'clone' | 'rebase' | 'fetch'
      line?: string
      done?: boolean
      stage?: string | null
      percent?: number | null
      current?: number | null
      total?: number | null
      speed?: string | null
    }>('git:progress', evt => {
      const p = evt.payload
      if (p.done) {
        useStore.setState({ gitProgress: null })
      } else if (p.line) {
        useStore.setState({
          gitProgress: {
            phase: p.phase,
            line: p.line,
            stage: p.stage ?? null,
            percent: p.percent ?? null,
            current: p.current ?? null,
            total: p.total ?? null,
            speed: p.speed ?? null,
          },
        })
      }
    }).then(fn => { unlistenFn = fn })
    return () => { unlistenFn?.() }
  }, [])

  // Auto-refresh on filesystem changes inside the active repo.
  // Backend watcher emits `repo:changed` with the affected repo path; we
  // coalesce bursts (e.g. a single git commit triggers many events) with a
  // 250 ms debounce, then refresh the active tab.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let unlistenFn: (() => void) | null = null

    listen<string>('repo:changed', evt => {
      const eventPath = evt.payload
      const currentPath = useStore.getState().repoPath
      if (eventPath !== currentPath) return  // event was for an inactive tab
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        timer = null
        await useStore.getState().refreshRepo()
        if (useStore.getState().repoStatus?.state === 'merging') {
          await useStore.getState().loadConflicts()
        }
      }, 250)
    }).then(fn => { unlistenFn = fn })

    return () => {
      if (timer) clearTimeout(timer)
      unlistenFn?.()
    }
  }, [])

  // OS-level drag-drop: dropping a folder onto the window opens it as a repo
  useEffect(() => {
    let unlisten: (() => void) | null = null
    getCurrentWebviewWindow().onDragDropEvent(evt => {
      const p = evt.payload
      if (p.type === 'enter' || p.type === 'over') setDragging(true)
      else if (p.type === 'leave') setDragging(false)
      else if (p.type === 'drop') {
        setDragging(false)
        const first = p.paths?.[0]
        if (first) useStore.getState().openRepo(first)
      }
    }).then(fn => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  const toast = useStore(s => s.toast)
  const aiStreaming = useStore(s => s.currentAiStreamId)
  const cancelCurrentAI = useStore(s => s.cancelCurrentAI)

  return (
    <div className={`app-layout ${dragging ? 'is-dragging' : ''}`}>
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <i className={`ti ${toast.type === 'success' ? 'ti-circle-check' : 'ti-alert-circle'}`} />
          <span>{toast.message}</span>
          {toast.type === 'error' && (
            <button
              type="button"
              className="toast-copy"
              title={t('err.toast_copy_diag')}
              onClick={async () => {
                try {
                  const d = await (await import('@tauri-apps/api/core')).invoke<{
                    appVersion: string; tauriVersion: string; libgit2Version: string;
                    gitVersion: string | null; gitLfsVersion: string | null;
                    os: string; arch: string; currentRepo: string | null;
                  }>('get_diagnostics', { repoPath: useStore.getState().repoPath })
                  const report = [
                    '## Versa 错误报告',
                    '',
                    `Error: ${toast.message}`,
                    '',
                    `Versa ${d.appVersion} · Tauri ${d.tauriVersion} · libgit2 ${d.libgit2Version}`,
                    `git: ${d.gitVersion ?? 'not found'} · git-lfs: ${d.gitLfsVersion ?? 'not installed'}`,
                    `OS: ${d.os} ${d.arch}`,
                    `repo: ${d.currentRepo ?? '(none)'}`,
                  ].join('\n')
                  await navigator.clipboard.writeText(report)
                  useStore.getState().showToast(t('about.diag_copied'), 'success')
                } catch (e) {
                  // Last-resort: just copy the raw message if diagnostics fail.
                  try { await navigator.clipboard.writeText(toast.message) } catch {}
                }
              }}
            >
              <i className="ti ti-copy" />
              {t('err.toast_copy_diag')}
            </button>
          )}
        </div>
      )}
      {aiStreaming && (
        <button
          type="button"
          className="ai-cancel-pill"
          onClick={() => cancelCurrentAI()}
          title="按 Esc 也可取消"
        >
          <i className="ti ti-x" />
          AI 生成中…取消 (Esc)
        </button>
      )}
      {/* Titlebar 始终渲染，保证交通灯和拖动区域始终存在.
       *
       * Use Tauri v2's `data-tauri-drag-region` attribute instead of a JS
       * `startDragging()` mousedown handler. The JS approach captures
       * macOS's drag tracking loop and prevents the subsequent dblclick
       * event from firing, so a manual `onDoubleClick` to maximize never
       * triggered. The attribute-based path gives us drag + native
       * double-click-to-maximize for free, and honors the OS's preference
       * (zoom vs minimize on macOS, max vs restore on Windows).
       *
       * Interactive children (the branch switcher, sync status, agent
       * button) opt out of drag by wrapping with `data-tauri-drag-region=
       * "false"` so their clicks still register. */}
      <div className="titlebar" data-tauri-drag-region>
        {/* Active repo title — workspace name and, for multi-repo
            workspaces, the currently-focused sub-repo. Sits in the
            centre of the titlebar so it's visible from a glance no
            matter how wide the window is. */}
        {repoPath && (() => {
          const activeWs = tabs.find(w =>
            w.root === repoPath || w.repos.some(r => r.path === repoPath),
          )
          if (!activeWs) return null
          const sub = activeWs.repos.find(r => r.path === repoPath)
          const showSub = (activeWs.repos.length > 1) && sub && sub.path !== activeWs.root
          return (
            <div className="titlebar-title">
              <i className={`ti ${activeWs.repos.length > 1 ? 'ti-folders' : 'ti-folder'}`} />
              <span className="titlebar-title-name">{activeWs.name}</span>
              {showSub && (
                <>
                  <span className="titlebar-title-sep">·</span>
                  <span className="titlebar-title-sub">{sub!.name}</span>
                </>
              )}
            </div>
          )
        })()}
        {/* Interactive widgets opt out of the drag region so their click
         *  handlers (and dropdown popups) keep working. Without the
         *  explicit "false", they'd inherit the parent titlebar's drag
         *  behavior and mousedown would be eaten by window dragging. */}
        {repoStatus && (
          <div data-tauri-drag-region="false">
            <BranchSwitcher variant="indicator" />
          </div>
        )}
        <div data-tauri-drag-region="false">
          <SyncStatus />
        </div>
      </div>

      <div className="app-stack">
      <UpdateBanner />

      <div className="app-main-row">
        <RepoListSidebar />
        <div className="app-content-col">
          {/* 1px hairline at the top of the content column. Lights up
              whenever a switch / load is in flight. Sits exactly where the
              repo content meets the chrome. */}
          <div className={`tab-switch-bar ${busy ? 'active' : ''}`} />
          <SubRepoStrip />

      {!repoPath ? (
        <WelcomeScreen onOpen={handleOpenRepo} />
      ) : (
        <>
          <div className="body-wrap">
          {repoStatus?.state === 'bisecting' && <BisectBanner />}
          {(() => {
            // Workspace overview mode — active when the current workspace tab
            // is in dashboard view. Takes over the entire body below icon-bar
            // (no Sidebar / Diff, no right panel).
            //
            // Matching: ws.repos for the normal case, ws.root for the empty
            // workspace case (no repos yet — repoPath == workspace root
            // placeholder). N=1 workspaces are forced to view='repo' on
            // creation so the dashboard never accidentally shows for a
            // single-repo tab.
            const activeWs = tabs.find(w =>
              w.root === repoPath || w.repos?.some(r => r.path === repoPath),
            )
            const inWorkspaceOverview = !!activeWs && activeWs.view === 'overview'
            // Icon-bar tabs target a focused sub-repo, so clicking any of them
            // while in overview implicitly flips the workspace back to 'repo'
            // view on its activeRepo.
            const leaveOverview = () => {
              if (inWorkspaceOverview && activeWs) {
                setWorkspaceView(activeWs.root, 'repo')
              }
            }

            const inNormalView = !settingsOpen
              && !inWorkspaceOverview
              && repoStatus?.state !== 'merging'
              && repoStatus?.state !== 'rebasing'
              && repoStatus?.state !== 'reverting'
              && repoStatus?.state !== 'cherry-picking'
              && activeTab !== 'branches'
              && activeTab !== 'history'
              && activeTab !== 'compare'
              && activeTab !== 'search'
            // RightPanel decides internally whether its content + icon-strip
            // should render (it shows the strip whenever ANY section is
            // docked right, content only when open). We just gate it to the
            // "normal" working views, and key the grid template to whether
            // the panel content is currently expanded.
            const rsVisible = inNormalView
            const rsExpanded = rsVisible && rightSidebarOpen
            return (
          <div
            className={`app-body${rsVisible ? ' has-right-strip' : ''}${rsExpanded ? ' has-right-open' : ''}`}
            style={rsExpanded ? ({ ['--right-panel-width' as any]: `${rightPanelWidth}px` }) : undefined}
          >
            <nav className="icon-bar">
              <IconBtn icon="ti-git-commit" tab="changes" label={t('tabs.changes')} onClick={() => { setSettingsOpen(false); leaveOverview() }} />
              <IconBtn icon="ti-history" tab="history" label={t('tabs.history')} onClick={() => { setSettingsOpen(false); leaveOverview() }} />
              <IconBtn icon="ti-git-branch" tab="branches" label={t('tabs.branches')} onClick={() => { setSettingsOpen(false); leaveOverview() }} />
              <IconBtn icon="ti-git-compare" tab="compare" label={t('tabs.compare')} onClick={() => { setSettingsOpen(false); leaveOverview() }} />
              <IconBtn icon="ti-search" tab="search" label={t('tabs.search', 'Search')} onClick={() => { setSettingsOpen(false); leaveOverview() }} />
              <div className="spacer" />
              {inNormalView && (
                <button
                  className={`icon-btn ${rightSidebarOpen ? 'active' : ''}`}
                  onClick={() => toggleRightSidebar()}
                  title="Right panel"
                  aria-label="Right panel"
                >
                  <i className="ti ti-layout-sidebar-right" />
                </button>
              )}
              <button
                className={`icon-btn ${terminalOpen ? 'active' : ''}`}
                onClick={() => {
                  // Close Settings if it's the current main area — consistent
                  // with the four tab icons above which also close it. Any
                  // left-bar interaction should bring the user back to the
                  // working view.
                  setSettingsOpen(false)
                  useStore.getState().setTerminalOpen(!terminalOpen)
                }}
                title="Terminal (⌘`)"
                aria-label={t('cheatsheet.toggle_terminal')}
              >
                <i className="ti ti-terminal-2" />
                {terminalOpen && <span className="status-dot" />}
              </button>
              <button
                className={`icon-btn ${settingsOpen ? 'active' : ''}`}
                title={t('common.settings')}
                aria-label={t('common.settings')}
                onClick={() => setSettingsOpen(v => !v)}
              >
                <i className="ti ti-settings" />
              </button>
            </nav>
            {settingsOpen ? (
              <main className="main-area settings-full">
                <Settings />
              </main>
            ) : inWorkspaceOverview ? (
              <main className="main-area settings-full">
                <WorkspaceOverview />
              </main>
            ) : (() => {
              // Conflict resolution takes over ONLY the 'changes' tab. The
              // user can still navigate to history / branches mid-merge to
              // peek at context without aborting — otherwise the icon-bar
              // buttons silently no-op, which is what we shipped before
              // and confused testers.
              const inConflict =
                repoStatus?.state === 'merging'
                || repoStatus?.state === 'rebasing'
                || repoStatus?.state === 'reverting'
                || repoStatus?.state === 'cherry-picking'
              if (activeTab === 'changes' && inConflict) {
                return <ConflictView />
              }
              return (
                <>
                  {activeTab === 'changes' && <Sidebar />}
                  <main className={`main-area${activeTab !== 'changes' ? ' settings-full' : ''}`}>
                    {activeTab === 'branches' ? <BranchesView />
                      : activeTab === 'history' ? <HistoryPane />
                      : activeTab === 'compare' ? <CompareView />
                      : activeTab === 'search' ? <SearchPanel />
                      : <DiffView />}
                  </main>
                  {rsVisible && <RightPanel />}
                </>
              )
            })()}
          </div>
            )
          })()}
          </div>
        </>
      )}
        </div>
      </div>
      {terminalOpen && <Terminal />}
      </div>
      {paletteOpen && <RepoPalette onClose={() => setPaletteOpen(false)} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      {cheatsheetOpen && <CheatsheetModal onClose={() => setCheatsheetOpen(false)} />}
      {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}
      {onboardingOpen && <OnboardingModal onClose={() => setOnboardingOpen(false)} />}
    </div>
  )
}

/** True for inputs/textareas/contenteditable — where bare keys like `?` are real typing. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return target.isContentEditable
}

function IconBtn({
  icon, tab, label, onClick
}: {
  icon: string
  tab?: 'changes' | 'history' | 'branches' | 'compare' | 'search'
  label: string
  onClick?: () => void
}) {
  const { activeTab, setTab } = useStore()
  const isActive = tab ? activeTab === tab : false

  return (
    <button
      className={`icon-btn ${isActive ? 'active' : ''}`}
      title={label}
      aria-label={label}
      onClick={() => {
        if (tab) setTab(tab)
        onClick?.()
      }}
    >
      <i className={`ti ${icon}`} />
    </button>
  )
}
