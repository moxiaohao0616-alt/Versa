import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { useStore } from '../../store'

export function TabStrip() {
  const { t } = useTranslation()
  const { tabs, repoPath, switchTab, closeTab, openRepo, recentRepos } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  if (tabs.length === 0) return null

  const handleOpenNew = async () => {
    setMenuOpen(false)
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === 'string') await openRepo(selected)
  }

  const handlePickRecent = async (path: string) => {
    setMenuOpen(false)
    await openRepo(path)
  }

  const handleCloseTab = (e: React.MouseEvent, path: string) => {
    e.stopPropagation()
    closeTab(path)
  }

  // Recents not currently held by any open workspace (matches either by the
  // workspace root or by any of its sub-repos so reopens dedupe correctly).
  // `?.` guards against HMR-stale tabs that still hold the pre-workspace shape.
  const openSet = new Set<string>()
  for (const tab of tabs) {
    if (tab.root) openSet.add(tab.root)
    if (tab.repos) for (const r of tab.repos) openSet.add(r.path)
  }
  const recentNotOpen = recentRepos.filter(r => !openSet.has(r.path))

  return (
    <div className="tabstrip">
      <div className="tabstrip-tabs">
        {tabs.map(tab => {
          const repos = tab.repos ?? []
          const isActive = repos.some(r => r.path === repoPath)
          const multi = repos.length > 1
          return (
            <button
              key={tab.root}
              className={`tab ${isActive ? 'active' : ''}`}
              onClick={() => switchTab(tab.root)}
              title={multi ? `${tab.root} (${repos.length} repos)` : tab.root}
            >
              <i className={multi ? 'ti ti-folders' : 'ti ti-folder'} />
              <span className="tab-name">{tab.name}</span>
              {multi && <span className="tab-count">{repos.length}</span>}
              <span
                className="tab-close"
                role="button"
                aria-label={t('tabstrip.close_tab')}
                onClick={e => handleCloseTab(e, tab.root)}
              >
                <i className="ti ti-x" />
              </span>
            </button>
          )
        })}
      </div>

      <div className="tabstrip-add" ref={menuRef}>
        <button
          className="tab-add"
          onClick={() => setMenuOpen(v => !v)}
          title={t('tabstrip.add_tab')}
          aria-label={t('tabstrip.add_tab')}
        >
          <i className="ti ti-plus" />
        </button>
        {menuOpen && (
          <div className="tab-add-menu">
            <button className="tab-add-item primary" onClick={handleOpenNew}>
              <i className="ti ti-folder-open" />
              <span>{t('tabstrip.open_new')}</span>
            </button>
            {recentNotOpen.length > 0 && (
              <>
                <div className="tab-add-divider" />
                <div className="tab-add-section">{t('tabstrip.recent')}</div>
                {recentNotOpen.map(r => (
                  <button
                    key={r.path}
                    className="tab-add-item"
                    onClick={() => handlePickRecent(r.path)}
                    title={r.path}
                  >
                    <i className="ti ti-folder" />
                    <span className="tab-add-name">{r.name}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
