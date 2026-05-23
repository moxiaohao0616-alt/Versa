import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { useStore } from '../store'
import { GitProgressBar } from './GitProgressBar'
import { Logo } from './Logo'

interface Props {
  onOpen: () => void
}

export function WelcomeScreen({ onOpen }: Props) {
  const { t } = useTranslation()
  const { openRepo, cloneRepo, showToast, gitProgress } = useStore()
  const [cloneOpen, setCloneOpen] = useState(false)
  const [cloneUrl, setCloneUrl] = useState('')
  const [cloneDest, setCloneDest] = useState('')
  const [cloning, setCloning] = useState(false)

  const handlePickDest = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (selected && typeof selected === 'string') setCloneDest(selected)
  }

  const handleClone = async () => {
    if (!cloneUrl.trim() || !cloneDest) return
    const repoName = cloneUrl.trim().split('/').pop()?.replace(/\.git$/, '') ?? 'repo'
    const dest = `${cloneDest}/${repoName}`
    setCloning(true)
    try {
      const cloned = await cloneRepo(cloneUrl.trim(), dest)
      await openRepo(cloned)
      setCloneOpen(false)
      setCloneUrl('')
      setCloneDest('')
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setCloning(false)
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-inner">
        <Logo size={88} className="welcome-logo" />
        <h1 className="welcome-title">Versa</h1>
        <p className="welcome-sub">{t('app.tagline')}</p>
        <div className="welcome-actions">
          <button className="btn-primary large" onClick={onOpen}>
            <i className="ti ti-folder-open" />
            {t('welcome.open_repo')}
          </button>
          <button className="btn-secondary large" onClick={() => setCloneOpen(v => !v)}>
            <i className="ti ti-git-merge" />
            {t('welcome.clone_repo')}
          </button>
        </div>

        {cloneOpen && (
          <div className="clone-form">
            <input
              className="clone-input"
              placeholder="仓库地址（URL）"
              value={cloneUrl}
              onChange={e => setCloneUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleClone()}
              autoFocus
            />
            <div className="clone-dest-row">
              <button className="btn-secondary" onClick={handlePickDest}>
                <i className="ti ti-folder" />
                选择目标文件夹
              </button>
              {cloneDest && <span className="clone-dest-path">{cloneDest}</span>}
            </div>
            <button
              className="btn-primary full"
              onClick={handleClone}
              disabled={!cloneUrl.trim() || !cloneDest || cloning}
            >
              <i className={`ti ${cloning ? 'ti-loader-2' : 'ti-download'}`} />
              {cloning ? '克隆中…' : '开始克隆'}
            </button>
            {cloning && gitProgress?.phase === 'clone' && (
              <GitProgressBar progress={gitProgress} />
            )}
          </div>
        )}

        <p className="welcome-hint">{t('welcome.drop_hint')}</p>

        {/* Discovery aids. Recent repos live in the left RepoListSidebar
            now; this is for keyboard shortcuts + feature pointers so the
            welcome screen still earns its space. */}
        <div className="welcome-info">
          <div className="welcome-info-section">
            <div className="welcome-info-title">{t('welcome.shortcuts_title')}</div>
            <div className="welcome-info-rows">
              <div className="welcome-info-row">
                <kbd>⌘P</kbd>
                <span>{t('welcome.shortcut_palette')}</span>
              </div>
              <div className="welcome-info-row">
                <kbd>⌘`</kbd>
                <span>{t('welcome.shortcut_terminal')}</span>
              </div>
              <div className="welcome-info-row">
                <kbd>⌘⇧]</kbd>
                <span>{t('welcome.shortcut_next_repo')}</span>
              </div>
              <div className="welcome-info-row">
                <kbd>?</kbd>
                <span>{t('welcome.shortcut_help')}</span>
              </div>
            </div>
          </div>

          <div className="welcome-info-section">
            <div className="welcome-info-title">{t('welcome.features_title')}</div>
            <div className="welcome-info-rows">
              <div className="welcome-info-row">
                <i className="ti ti-layout-dashboard" />
                <span>{t('welcome.feature_workspace')}</span>
              </div>
              <div className="welcome-info-row">
                <i className="ti ti-sparkles" />
                <span>{t('welcome.feature_ai')}</span>
              </div>
              <div className="welcome-info-row">
                <i className="ti ti-stack-2" />
                <span>{t('welcome.feature_changelist')}</span>
              </div>
              <div className="welcome-info-row">
                <i className="ti ti-terminal-2" />
                <span>{t('welcome.feature_terminal')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
