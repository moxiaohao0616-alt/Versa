import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type ReflogEntry } from '../../store'
import { relTime } from '../../lib/relTime'

/** "时光机 / Time Machine": browse HEAD reflog and hard-reset back to any
 *  entry. Used to recover from accidental resets / rebases / branch deletions
 *  that left orphan commits. */
export function ReflogModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { listReflog, restoreToReflog, showToast } = useStore()
  const [entries, setEntries] = useState<ReflogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmTarget, setConfirmTarget] = useState<ReflogEntry | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try { setEntries(await listReflog(500)) }
      catch (e) { showToast(String(e), 'error') }
      finally { setLoading(false) }
    })()
  }, [])

  // Reduce git's verbose reflog tokens to a single short label for the chip.
  // The original token still travels as `title` on the chip so users can hover
  // to see things like "rebase (abort)" or "pull --rebase (start)".
  const actionLabel = (action: string) => {
    // Split on space, paren, or dash to grab the leading verb. `cherry-pick`
    // becomes `cherry`; `pull --rebase` becomes `pull`; `rebase (abort)` → `rebase`.
    const head = action.split(/[\s(-]/, 1)[0]
    switch (head) {
      case 'commit':     return t('reflog.action_commit')
      case 'checkout':   return t('reflog.action_checkout')
      case 'reset':      return t('reflog.action_reset')
      case 'merge':      return t('reflog.action_merge')
      case 'rebase':     return t('reflog.action_rebase')
      case 'pull':       return t('reflog.action_pull')
      case 'clone':      return t('reflog.action_clone')
      case 'revert':     return t('reflog.action_revert')
      case 'cherry':     return t('reflog.action_cherry_pick')
      case 'branch':     return t('reflog.action_branch')
      default:           return head || t('reflog.action_other')
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-history" style={{ marginRight: 6 }} />
          {t('reflog.title')}
        </div>
        <p className="modal-warn" style={{ margin: '12px 16px 0' }}>
          <i className="ti ti-info-circle" />
          {t('reflog.hint')}
        </p>
        <div className="reflog-list">
          {loading ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('reflog.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('reflog.empty')}</p>
          ) : entries.map(e => (
            <div key={e.index} className="reflog-row" onClick={() => setConfirmTarget(e)}>
              <span className="reflog-idx">HEAD@{`{${e.index}}`}</span>
              <span className="reflog-action" title={e.action}>{actionLabel(e.action)}</span>
              <span className="reflog-msg" title={e.message}>{e.message}</span>
              <span className="reflog-meta">
                <span className="branch-sha">{e.short}</span>
                <span className="branch-time">{relTime(e.time)}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>

      {confirmTarget && (
        <div className="modal-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-title">{t('reflog.restore_title')}</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{confirmTarget.short}</span>
                <span className="modal-commit-msg">{confirmTarget.message}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                {t('reflog.restore_warn', { short: confirmTarget.short })}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmTarget(null)}>{t('common.cancel')}</button>
              <button
                className="btn-danger"
                onClick={async () => {
                  const sha = confirmTarget.oid
                  setConfirmTarget(null)
                  try { await restoreToReflog(sha); onClose() }
                  catch (err) { showToast(String(err), 'error') }
                }}
              >
                <i className="ti ti-rewind-backward-10" />
                {t('reflog.restore_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
