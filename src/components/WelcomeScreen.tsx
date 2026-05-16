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
  const { recentRepos, openRepo, cloneRepo, showToast, gitProgress } = useStore()
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
        <p className="welcome-sub">Git for Everyone</p>
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

        {recentRepos.length > 0 && (
          <div className="recent-repos">
            <p className="recent-label">{t('welcome.recent')}</p>
            {recentRepos.map(repo => (
              <button
                key={repo.path}
                className="recent-item"
                onClick={() => openRepo(repo.path)}
                title={repo.path}
              >
                <i className="ti ti-folder" />
                <span className="recent-info">
                  <span className="recent-name">{repo.name}</span>
                  <span className="recent-path">{repo.path}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
