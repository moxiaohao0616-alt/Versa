import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { useStore, type WorkspaceTab, type RecentRepo } from '../../store'

/**
 * Left-edge repo manager. Vertical list of open workspaces, with a search
 * filter, starred sort, recents fall-through, and a collapse-to-icons
 * mode. Replaces the old horizontal TabStrip — better fits "each tab is
 * an entire repository" semantics where a flat tab strip cramped the
 * names and offered no metadata.
 *
 * Selection: clicking a row calls switchTab (or openRepo for recents
 * not currently open). Right-click pops a context menu with star /
 * close / reveal actions.
 */
export function RepoListSidebar() {
  const { t } = useTranslation()
  const {
    tabs, repoPath, recentRepos, starredRepos, repoListCollapsed,
    switchTab, closeTab, openRepo, toggleStarredRepo, setRepoListCollapsed,
  } = useStore()

  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<{ root: string; x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // The currently-active workspace = the tab containing repoPath, OR the
  // tab whose root matches repoPath (empty-workspace case).
  const activeRoot = useMemo(() => {
    if (!repoPath) return null
    const t = tabs.find(t =>
      t.root === repoPath || t.repos.some(r => r.path === repoPath),
    )
    return t?.root ?? null
  }, [tabs, repoPath])

  // Starred-first sort within open tabs.
  const sortedTabs = useMemo(() => {
    const starSet = new Set(starredRepos)
    return [...tabs].sort((a, b) => {
      const sa = starSet.has(a.root) ? 0 : 1
      const sb = starSet.has(b.root) ? 0 : 1
      if (sa !== sb) return sa - sb
      return 0  // keep open-order for ties
    })
  }, [tabs, starredRepos])

  // Filter both lists by query.
  const q = query.trim().toLowerCase()
  const matches = (s: string) => !q || s.toLowerCase().includes(q)
  const visibleTabs = sortedTabs.filter(t => matches(t.name) || matches(t.root))
  const openRoots = new Set(tabs.map(t => t.root))
  const visibleRecents = recentRepos
    .filter(r => !openRoots.has(r.path))
    .filter(r => matches(r.name) || matches(r.path))

  // Close context menu on outside click.
  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])

  const handleOpenNew = async () => {
    const picked = await open({ directory: true, multiple: false })
    if (picked && typeof picked === 'string') await openRepo(picked)
  }

  const handleSwitch = (root: string) => {
    if (root === activeRoot) return
    switchTab(root)
  }

  const handleRecentOpen = async (r: RecentRepo) => {
    await openRepo(r.path)
  }

  const isStarred = (root: string) => starredRepos.includes(root)

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <aside
      className={`repo-list-sidebar ${repoListCollapsed ? 'collapsed' : ''}`}
      aria-label={t('repo_list.aria_label')}
    >
      <div className="repo-list-header">
        {!repoListCollapsed && (
          <input
            type="text"
            className="repo-list-search"
            placeholder={t('repo_list.search_placeholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        )}
        <button
          className="repo-list-collapse-btn"
          title={repoListCollapsed ? t('repo_list.expand') : t('repo_list.collapse')}
          onClick={() => setRepoListCollapsed(!repoListCollapsed)}
        >
          <i className={`ti ${repoListCollapsed ? 'ti-chevrons-right' : 'ti-chevrons-left'}`} />
        </button>
      </div>

      <div className="repo-list-body">
        {visibleTabs.length > 0 && (
          <>
            {!repoListCollapsed && (
              <div className="repo-list-section">{t('repo_list.open')} · {visibleTabs.length}</div>
            )}
            {visibleTabs.map(tab => (
              <RepoRow
                key={tab.root}
                tab={tab}
                active={tab.root === activeRoot}
                starred={isStarred(tab.root)}
                collapsed={repoListCollapsed}
                onSelect={() => handleSwitch(tab.root)}
                onContext={(x, y) => setMenu({ root: tab.root, x, y })}
              />
            ))}
          </>
        )}

        {visibleRecents.length > 0 && !repoListCollapsed && (
          <>
            <div className="repo-list-section">{t('repo_list.recent')} · {visibleRecents.length}</div>
            {visibleRecents.map(r => (
              <button
                key={r.path}
                className="repo-row recent-row"
                onClick={() => handleRecentOpen(r)}
                title={r.path}
              >
                <i className="ti ti-folder" />
                <span className="repo-row-name">{r.name}</span>
              </button>
            ))}
          </>
        )}

        {visibleTabs.length === 0 && visibleRecents.length === 0 && !repoListCollapsed && (
          <div className="repo-list-empty">
            {q ? t('repo_list.empty_search') : t('repo_list.empty_no_repos')}
          </div>
        )}
      </div>

      {/* Footer "+ Open repo" button — hidden when there are zero open
          tabs because the WelcomeScreen's central CTA covers that case
          (would be a duplicate "打开仓库" button otherwise). Reappears
          as soon as the user has at least one repo open. */}
      {tabs.length > 0 && (
        <div className="repo-list-footer">
          <button
            className="repo-list-open-btn"
            onClick={handleOpenNew}
            title={t('repo_list.open_tooltip')}
          >
            <i className="ti ti-folder-plus" />
            {!repoListCollapsed && <span>{t('repo_list.open_button')}</span>}
          </button>
        </div>
      )}

      {menu && (
        <div
          ref={menuRef}
          className="repo-list-menu"
          style={{ top: menu.y, left: menu.x }}
          onClick={() => setMenu(null)}
        >
          <button onClick={() => toggleStarredRepo(menu.root)}>
            <i className={`ti ${isStarred(menu.root) ? 'ti-star-filled' : 'ti-star'}`} />
            <span>{isStarred(menu.root) ? t('repo_list.unstar') : t('repo_list.star')}</span>
          </button>
          <button onClick={() => closeTab(menu.root)}>
            <i className="ti ti-x" />
            <span>{t('repo_list.close')}</span>
          </button>
        </div>
      )}
    </aside>
  )
}

interface RepoRowProps {
  tab: WorkspaceTab
  active: boolean
  starred: boolean
  collapsed: boolean
  onSelect: () => void
  onContext: (x: number, y: number) => void
}

function RepoRow({ tab, active, starred, collapsed, onSelect, onContext }: RepoRowProps) {
  // Branch label: from the active sub-repo's live snapshot, else just
  // the workspace name. Snapshots aren't subscribed-to here (would
  // re-render this row on every other repo's update), so we read
  // statically — close enough for a sidebar label, full data lives in
  // the repo view itself.
  const subSnap = useStore(s => s.tabSnapshots[tab.activeRepo]?.repoStatus)
  const branch = subSnap?.branch
  const dirtyCount = subSnap?.files.length ?? 0

  const onCtxMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    onContext(e.clientX, e.clientY)
  }

  // Multi-repo tab gets the "folders" icon as a visual cue.
  const isMulti = (tab.repos?.length ?? 0) > 1
  const icon = isMulti ? 'ti-folders' : 'ti-folder'

  if (collapsed) {
    return (
      <button
        className={`repo-row collapsed ${active ? 'active' : ''}`}
        onClick={onSelect}
        onContextMenu={onCtxMenu}
        title={`${tab.name}${branch ? ` · ${branch}` : ''}`}
      >
        <i className={`ti ${icon}`} />
        {dirtyCount > 0 && <span className="repo-row-dot" />}
      </button>
    )
  }

  return (
    <button
      className={`repo-row ${active ? 'active' : ''}`}
      onClick={onSelect}
      onContextMenu={onCtxMenu}
      title={tab.root}
    >
      <i className={`ti ${icon}`} />
      <div className="repo-row-text">
        <span className="repo-row-name">{tab.name}</span>
        {branch && <span className="repo-row-meta">{branch}</span>}
      </div>
      {dirtyCount > 0 && <span className="repo-row-count">{dirtyCount}</span>}
      {starred && <i className="ti ti-star-filled repo-row-star" />}
    </button>
  )
}
