import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Update } from '@tauri-apps/plugin-updater'
import { checkForUpdate, applyUpdate } from '../../lib/updater'
import { useStore } from '../../store'

const DISMISS_KEY = 'versa.updater.dismissedVersion'

/** Pill above the TabStrip that surfaces an available update without
 *  interrupting the user. Auto-checks on mount; if a release newer than
 *  what we run is available AND the user hasn't already dismissed THIS
 *  version, it shows. Install kicks off downloadAndInstall + relaunch. */
export function UpdateBanner() {
  const { t } = useTranslation()
  const { showToast } = useStore()
  const [update, setUpdate] = useState<Update | null>(null)
  const [installing, setInstalling] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const u = await checkForUpdate()
      if (cancelled || !u) return
      if (localStorage.getItem(DISMISS_KEY) === u.version) return
      setUpdate(u)
    })()
    return () => { cancelled = true }
  }, [])

  if (!update || hidden) return null

  const install = async () => {
    setInstalling(true)
    try {
      await applyUpdate(update)
      // Process relaunches; if we ever return here something went wrong.
      showToast(t('updater.install_done'), 'success')
    } catch (e) {
      showToast(String(e), 'error')
      setInstalling(false)
    }
  }
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, update.version)
    setHidden(true)
  }

  return (
    <div className="update-banner">
      <i className="ti ti-rocket update-banner-icon" />
      <span className="update-banner-text">
        {t('updater.available', { version: update.version })}
      </span>
      <button
        className="update-banner-install"
        onClick={install}
        disabled={installing}
      >
        <i className={`ti ${installing ? 'ti-loader-2' : 'ti-download'}`} />
        {installing ? t('updater.installing') : t('updater.install_now')}
      </button>
      <button className="update-banner-dismiss" onClick={dismiss} title={t('updater.dismiss')}>
        <i className="ti ti-x" />
      </button>
    </div>
  )
}
