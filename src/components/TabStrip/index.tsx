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

  // Recent repos not currently in any open tab
  const openSet = new Set(tabs.map(t => t.path))
  const recentNotOpen = recentRepos.filter(r => !openSet.has(r.path))

  return (
    <div className="tabstrip">
      <div className="tabstrip-tabs">
        {tabs.map(tab => (
          <button
            key={tab.path}
            className={`tab ${repoPath === tab.path ? 'active' : ''}`}
            onClick={() => switchTab(tab.path)}
            title={tab.path}
          >
            <i className="ti ti-folder" />
            <span className="tab-name">{tab.name}</span>
            <span
              className="tab-close"
              role="button"
              aria-label={t('tabstrip.close_tab')}
              onClick={e => handleCloseTab(e, tab.path)}
            >
              <i className="ti ti-x" />
            </span>
          </button>
        ))}
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
