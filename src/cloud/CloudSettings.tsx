import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCloudStore } from './store'
import { SignInModal } from './SignInModal'
import type { CloudDevice } from './types'

const DEFAULT_LOCAL_URL = 'http://localhost:8787'
const DEFAULT_PROD_URL = 'https://api.versago.app'

export function CloudSettings({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  const {
    initialized,
    signedIn,
    user,
    subscription,
    device,
    baseUrl,
    devices,
    devicesLoading,
    refreshStatus,
    loadDevices,
    revokeDevice,
    signOut,
    setBaseUrl,
  } = useCloudStore()
  const [signInOpen, setSignInOpen] = useState(false)
  const [baseUrlInput, setBaseUrlInput] = useState('')

  // Initial status fetch + devices when signed in.
  useEffect(() => {
    if (!initialized) {
      void refreshStatus()
    }
  }, [initialized, refreshStatus])

  useEffect(() => {
    if (signedIn) void loadDevices()
  }, [signedIn, loadDevices])

  useEffect(() => {
    if (baseUrl) setBaseUrlInput(baseUrl)
  }, [baseUrl])

  const plan = subscription?.plan ?? 'free'

  return (
    <div className="settings-view">
      <div className="settings-subpage-header">
        <button className="settings-back-btn" onClick={onBack} type="button" aria-label="Back">
          <i className="ti ti-chevron-left" />
          <span>Settings</span>
        </button>
        <h2 className="settings-page-title settings-subpage-title">{t('settings.cloud_title')}</h2>
      </div>

      <p className="settings-subpage-hint">{t('settings.cloud_hint')}</p>

      {/* ─── Account section ─────────────────────────────────────── */}
      <div className="settings-section">
        <p className="settings-section-title">{t('settings.cloud_account')}</p>

        {!signedIn ? (
          <div className="settings-row">
            <div>
              <p className="settings-row-label">{t('settings.cloud_signed_out')}</p>
              <p className="settings-row-desc">{t('settings.cloud_signed_out_desc')}</p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSignInOpen(true)}
            >
              <i className="ti ti-cloud-upload" style={{ marginRight: 4 }} />
              {t('settings.cloud_signin')}
            </button>
          </div>
        ) : (
          <>
            <div className="settings-row">
              <div>
                <p className="settings-row-label">{user?.email ?? '—'}</p>
                <p className="settings-row-desc">
                  {user?.displayName ?? t('settings.cloud_no_name')} · {planLabel(plan, t)}
                </p>
              </div>
              <button type="button" className="btn-secondary" onClick={() => void signOut()}>
                <i className="ti ti-logout" style={{ marginRight: 4 }} />
                {t('settings.cloud_signout')}
              </button>
            </div>

            {plan === 'free' && (
              <div className="settings-row">
                <div>
                  <p className="settings-row-label">{t('settings.cloud_paywall_title')}</p>
                  <p className="settings-row-desc">{t('settings.cloud_paywall_desc')}</p>
                </div>
                <button type="button" className="btn-primary" disabled title="Phase 3">
                  <i className="ti ti-sparkles" style={{ marginRight: 4 }} />
                  {t('settings.cloud_upgrade')}
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── Devices section (signed-in only) ────────────────────── */}
      {signedIn && (
        <div className="settings-section">
          <p className="settings-section-title">{t('settings.cloud_devices')}</p>
          {devicesLoading ? (
            <p className="rs-empty">{t('common.loading')}</p>
          ) : devices.length === 0 ? (
            <p className="rs-empty">{t('settings.cloud_no_devices')}</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {devices.map((d) => (
                <DeviceRow
                  key={d.id}
                  d={d}
                  isCurrent={d.id === device?.id || d.current}
                  onRevoke={() => void revokeDevice(d.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Dev section: server URL switcher ────────────────────── */}
      <div className="settings-section">
        <p className="settings-section-title">{t('settings.cloud_advanced')}</p>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">{t('settings.cloud_base_url')}</p>
            <p className="settings-row-desc">{t('settings.cloud_base_url_desc')}</p>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              className="settings-input"
              style={{ width: 240 }}
              value={baseUrlInput}
              onChange={(e) => setBaseUrlInput(e.target.value)}
              placeholder={DEFAULT_PROD_URL}
            />
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                const next = baseUrlInput.trim() || DEFAULT_PROD_URL
                await setBaseUrl(next)
                await refreshStatus()
              }}
            >
              {t('common.apply')}
            </button>
          </div>
        </div>
        <div className="settings-row">
          <div>
            <p className="settings-row-label">{t('settings.cloud_quick_switch')}</p>
            <p className="settings-row-desc">{t('settings.cloud_quick_switch_desc')}</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await setBaseUrl(DEFAULT_LOCAL_URL)
                setBaseUrlInput(DEFAULT_LOCAL_URL)
                await refreshStatus()
              }}
            >
              localhost
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={async () => {
                await setBaseUrl(DEFAULT_PROD_URL)
                setBaseUrlInput(DEFAULT_PROD_URL)
                await refreshStatus()
              }}
            >
              production
            </button>
          </div>
        </div>
      </div>

      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  )
}

function DeviceRow({
  d,
  isCurrent,
  onRevoke,
}: {
  d: CloudDevice
  isCurrent: boolean
  onRevoke: () => void
}) {
  const { t } = useTranslation()
  return (
    <li
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '1px solid var(--border, #eee)',
      }}
    >
      <div>
        <div style={{ fontWeight: 500 }}>
          {d.name} {isCurrent && <span className="settings-status-dot ok" style={{ marginLeft: 6 }} />}
          {isCurrent && <span style={{ marginLeft: 4, fontSize: 12, color: 'var(--text-muted, #888)' }}>{t('settings.cloud_this_device')}</span>}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted, #888)' }}>
          {d.platform}
          {d.versaVersion ? ` · v${d.versaVersion}` : ''}
          {' · '}
          {t('settings.cloud_last_seen', { rel: relTime(d.lastSeenAt) })}
        </div>
      </div>
      {!isCurrent && (
        <button type="button" className="btn-secondary" onClick={onRevoke}>
          {t('settings.cloud_revoke')}
        </button>
      )}
    </li>
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

function planLabel(plan: string, t: (k: string) => string): string {
  switch (plan) {
    case 'pro':
      return t('settings.cloud_plan_pro')
    case 'team':
      return t('settings.cloud_plan_team')
    default:
      return t('settings.cloud_plan_free')
  }
}
