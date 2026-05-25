import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'
import { relTime } from '../../../lib/relTime'

/** Stash list — apply / pop / drop each entry. The drop button does a
 *  two-step confirm (click → ✓/✗) so a misclick can't lose the stash. */
export function StashSection() {
  const { t } = useTranslation()
  const stashes = useStore(s => s.stashes)
  const applyStash = useStore(s => s.applyStash)
  const popStash = useStore(s => s.popStash)
  const dropStash = useStore(s => s.dropStash)
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null)

  if (stashes.length === 0) {
    return (
      <div className="rp-section-body">
        <p className="rs-empty">{t('rightsidebar.stash_empty')}</p>
      </div>
    )
  }

  return (
    <div className="rp-section-body">
      <ul className="rs-stash-list">
        {stashes.map(s => (
          <li key={s.index} className="rs-stash-row">
            <div className="rs-stash-info">
              <span className="rs-stash-message" title={s.message}>{s.message}</span>
              <span className="rs-stash-meta">stash@{`{${s.index}}`} · {relTime(s.time)}</span>
            </div>
            <div className="rs-stash-actions">
              {confirmDrop === s.index ? (
                <>
                  <button
                    className="danger"
                    title={t('rightsidebar.drop_confirm')}
                    onClick={() => { setConfirmDrop(null); dropStash(s.index) }}
                  >
                    <i className="ti ti-check" />
                  </button>
                  <button title={t('common.cancel')} onClick={() => setConfirmDrop(null)}>
                    <i className="ti ti-x" />
                  </button>
                </>
              ) : (
                <>
                  <button title={t('rightsidebar.apply_keep')} onClick={() => applyStash(s.index)}>
                    <i className="ti ti-arrow-back-up" />
                  </button>
                  <button title={t('rightsidebar.apply_drop')} onClick={() => popStash(s.index)}>
                    <i className="ti ti-arrow-back-up-double" />
                  </button>
                  <button title={t('rightsidebar.drop_only')} onClick={() => setConfirmDrop(s.index)}>
                    <i className="ti ti-trash" />
                  </button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
