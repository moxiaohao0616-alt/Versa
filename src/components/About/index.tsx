import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'
import { checkForUpdate, applyUpdate } from '../../lib/updater'
import type { Update } from '@tauri-apps/plugin-updater'

interface Diagnostics {
  appVersion: string
  tauriVersion: string
  rustcTarget: string
  os: string
  arch: string
  gitVersion: string | null
  gitLfsVersion: string | null
  libgit2Version: string
  currentRepo: string | null
}

export function AboutModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { repoPath, showToast } = useStore()
  const [info, setInfo] = useState<Diagnostics | null>(null)
  const [loading, setLoading] = useState(true)
  const [update, setUpdate] = useState<Update | null>(null)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'up-to-date' | 'installing'>('idle')

  useEffect(() => {
    (async () => {
      try { setInfo(await invoke<Diagnostics>('get_diagnostics', { repoPath })) }
      finally { setLoading(false) }
    })()
  }, [repoPath])

  const handleCheckUpdate = async () => {
    setUpdateState('checking')
    const u = await checkForUpdate()
    if (u) {
      setUpdate(u)
      setUpdateState('available')
    } else {
      setUpdateState('up-to-date')
    }
  }

  const handleInstallUpdate = async () => {
    if (!update) return
    setUpdateState('installing')
    try {
      await applyUpdate(update)
    } catch (e) {
      showToast(t('about.update_failed', { reason: String(e) }), 'error')
      setUpdateState('available')
    }
  }

  const text = info ? buildText(info) : ''

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal about-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-info-circle" style={{ marginRight: 6 }} />
          {t('about.title')}
        </div>
        <div className="about-body">
          <div className="about-hero">
            <div className="about-logo">V</div>
            <div>
              <div className="about-name">Versa</div>
              <div className="about-tagline">{t('app.tagline')}</div>
            </div>
          </div>
          {loading || !info ? (
            <p className="rs-empty">{t('about.diag_loading')}</p>
          ) : (
            <dl className="about-grid">
              <dt>{t('about.version')}</dt>     <dd>{info.appVersion}</dd>
              <dt>Tauri</dt>                    <dd>{info.tauriVersion}</dd>
              <dt>{t('about.libgit2')}</dt>     <dd>{info.libgit2Version}</dd>
              <dt>{t('about.git_cli')}</dt>     <dd>{info.gitVersion || <em>{t('about.not_detected')}</em>}</dd>
              <dt>{t('about.git_lfs')}</dt>     <dd>{info.gitLfsVersion || <em>{t('about.not_installed')}</em>}</dd>
              <dt>{t('about.system')}</dt>      <dd>{info.os} · {info.arch}</dd>
              <dt>{t('about.current_repo')}</dt><dd className="about-path">{info.currentRepo || <em>{t('about.no_repo')}</em>}</dd>
            </dl>
          )}

          <div className="about-update">
            {updateState === 'available' && update ? (
              <>
                <span><b>{t('about.update_available', { version: update.version })}</b>{update.date ? ` · ${update.date.split('T')[0]}` : ''}</span>
                <button className="btn-primary" onClick={handleInstallUpdate}>
                  <i className="ti ti-download" />
                  {t('about.update_install')}
                </button>
              </>
            ) : updateState === 'installing' ? (
              <span><i className="ti ti-loader-2" /> {t('about.update_installing')}</span>
            ) : (
              <>
                <span className="about-update-msg">
                  {updateState === 'checking'   ? t('about.update_check_loading') :
                   updateState === 'up-to-date' ? t('about.update_up_to_date') :
                   t('about.update_hint')}
                </span>
                <button
                  className="btn-secondary"
                  onClick={handleCheckUpdate}
                  disabled={updateState === 'checking'}
                >
                  <i className="ti ti-refresh" />
                  {t('about.check_update')}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
          <button
            className="btn-primary"
            disabled={!info}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                showToast(t('about.diag_copied'), 'success')
              } catch (e) {
                showToast(String(e), 'error')
              }
            }}
          >
            <i className="ti ti-copy" />
            {t('about.copy_diag')}
          </button>
        </div>
      </div>
    </div>
  )
}

function buildText(d: Diagnostics): string {
  return [
    `Versa ${d.appVersion}`,
    `Tauri ${d.tauriVersion} · libgit2 ${d.libgit2Version}`,
    `git: ${d.gitVersion ?? 'not found'}`,
    `git-lfs: ${d.gitLfsVersion ?? 'not installed'}`,
    `OS: ${d.os} ${d.arch}`,
    `repo: ${d.currentRepo ?? '(none)'}`,
  ].join('\n')
}
