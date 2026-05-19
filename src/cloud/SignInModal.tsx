import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open as openInBrowser } from '@tauri-apps/plugin-shell'
import { useCloudStore } from './store'

const POLL_INTERVAL_MS = 3000

/**
 * Versa Cloud sign-in modal. Flow:
 *   1. Call `cloud_signin_start` → server returns an 8-char pair code +
 *      a verification URL.
 *   2. Show the code; offer to open the URL in the user's default browser.
 *   3. Poll `cloud_signin_poll` every 3 s until the server returns
 *      `ok` / `expired` / `consumed`.
 *   4. On `ok`: refresh status (now signed in) and close.
 *
 * The user can cancel at any time — that POSTs cancel server-side and
 * resets local state.
 */
export function SignInModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const {
    signinPhase,
    pairCode,
    verificationUrl,
    pairExpiresAt,
    signinError,
    startSignin,
    pollSignin,
    cancelSignin,
  } = useCloudStore()
  const [now, setNow] = useState(() => Date.now())
  const startedRef = useRef(false)

  // Kick off the start request once when the modal first mounts.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void startSignin()
  }, [startSignin])

  // Tick `now` every second so the countdown stays fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Poll while pending.
  useEffect(() => {
    if (signinPhase !== 'pending') return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const tick = async () => {
      const result = await pollSignin()
      if (cancelled) return
      if (result === 'success') {
        // Refresh complete; close modal.
        onClose()
        return
      }
      if (result === 'expired' || result === 'error') return
      timer = setTimeout(tick, POLL_INTERVAL_MS)
    }
    timer = setTimeout(tick, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [signinPhase, pollSignin, onClose])

  // Cancel server-side state when the modal unmounts mid-flight.
  useEffect(() => {
    return () => {
      void cancelSignin()
    }
  }, [cancelSignin])

  const secondsLeft = pairExpiresAt ? Math.max(0, Math.round((pairExpiresAt - now) / 1000)) : 0

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-cloud" style={{ marginRight: 6 }} />
          {t('cloud.signin_title')}
        </div>

        <div style={{ padding: '12px 18px 18px' }}>
          {signinPhase === 'idle' || signinPhase === 'starting' ? (
            <p>{t('cloud.signin_starting')}</p>
          ) : signinPhase === 'pending' && pairCode && verificationUrl ? (
            <>
              <p style={{ marginTop: 0 }}>{t('cloud.signin_step1')}</p>
              <div
                style={{
                  textAlign: 'center',
                  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                  fontSize: 28,
                  letterSpacing: 6,
                  padding: '14px 0',
                  margin: '10px 0',
                  background: 'var(--surface-2, #f1f1f1)',
                  borderRadius: 10,
                  fontWeight: 600,
                }}
              >
                {pairCode}
              </div>
              <p style={{ marginTop: 4 }}>{t('cloud.signin_step2')}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openInBrowser(verificationUrl)}
                >
                  <i className="ti ti-external-link" style={{ marginRight: 4 }} />
                  {t('cloud.open_browser')}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(verificationUrl)
                    } catch {
                      /* clipboard denied — degrade silently */
                    }
                  }}
                >
                  <i className="ti ti-copy" style={{ marginRight: 4 }} />
                  {t('cloud.copy_url')}
                </button>
              </div>
              <p
                style={{
                  marginTop: 14,
                  color: 'var(--text-muted, #888)',
                  fontSize: 13,
                }}
              >
                <i className="ti ti-clock" style={{ marginRight: 4 }} />
                {t('cloud.expires_in', { seconds: secondsLeft })}
              </p>
            </>
          ) : signinPhase === 'expired' ? (
            <>
              <p>{t('cloud.signin_expired')}</p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" onClick={() => startSignin()}>
                  {t('cloud.try_again')}
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : signinPhase === 'error' ? (
            <>
              <p style={{ color: 'var(--error, #c33)' }}>
                {t('cloud.signin_error', { reason: signinError ?? 'unknown' })}
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button type="button" className="btn btn-primary" onClick={() => startSignin()}>
                  {t('cloud.try_again')}
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  {t('common.cancel')}
                </button>
              </div>
            </>
          ) : (
            <p>{t('cloud.signin_success')}</p>
          )}

          {signinPhase === 'pending' && (
            <div
              style={{
                borderTop: '1px solid var(--border, #eee)',
                marginTop: 16,
                paddingTop: 12,
                textAlign: 'right',
              }}
            >
              <button type="button" className="btn" onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
