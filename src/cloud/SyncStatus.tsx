import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloudStore } from './store'

const TICK_MS = 30_000

/**
 * Tiny pill in the titlebar that surfaces cloud sync state. Visible only
 * when the user has signed in (no signal === no clutter for users who
 * never opted into Cloud).
 *
 * Click → dispatches `versa:nav-cloud-settings`, picked up by App (opens
 * Settings) and Settings (jumps to the Cloud sub-page).
 */
export function SyncStatus() {
  const { t } = useTranslation()
  const { signedIn, sync, initialized, refreshStatus } = useCloudStore()
  const [, forceTick] = useState(0)

  // Refresh status once on mount so the indicator wakes up after a fresh launch.
  useEffect(() => {
    if (!initialized) void refreshStatus()
  }, [initialized, refreshStatus])

  // Re-render every 30 s so "synced 5m ago" stays current without a global timer.
  useEffect(() => {
    const id = setInterval(() => forceTick((x) => x + 1), TICK_MS)
    return () => clearInterval(id)
  }, [])

  if (!signedIn) return null

  let icon = 'ti-cloud-check'
  let cls = 'sync-status-ok'
  let tip = sync.lastSyncedAtMs
    ? t('cloud.synced_rel', { rel: relTime(sync.lastSyncedAtMs) })
    : t('cloud.idle')

  if (sync.inFlight) {
    icon = 'ti-cloud-upload'
    cls = 'sync-status-syncing'
    tip = t('cloud.syncing')
  } else if (sync.lastError) {
    icon = 'ti-cloud-x'
    cls = 'sync-status-error'
    tip = t('cloud.sync_error', { reason: sync.lastError })
  }

  return (
    <button
      type="button"
      className={`sync-status ${cls}`}
      title={tip}
      aria-label={tip}
      onClick={() => {
        window.dispatchEvent(new CustomEvent('versa:nav-cloud-settings'))
      }}
      style={{
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        padding: '0 6px',
        opacity: 0.7,
        fontSize: 14,
      }}
    >
      <i className={`ti ${icon}`} />
    </button>
  )
}

function relTime(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}
