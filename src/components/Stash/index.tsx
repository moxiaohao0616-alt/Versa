import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { relTime } from '../../lib/relTime'

export function StashModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const {
    stashes,
    loadStashes, createStash, applyStash, popStash, dropStash,
  } = useStore()

  const [msg, setMsg] = useState('')
  const [busyCreate, setBusyCreate] = useState(false)
  /** Inline confirmation: while set to an index, that row's actions become a
   *  confirm/cancel pair. Prevents accidental loss without an extra modal. */
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null)

  useEffect(() => {
    loadStashes()
  }, [])

  const handleCreate = async () => {
    setBusyCreate(true)
    await createStash(msg.trim() || null)
    setMsg('')
    setBusyCreate(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal stash-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{t('stash.title')}</div>
        <div className="modal-body">
          <div className="stash-create">
            <input
              className="settings-input"
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder={t('stash.message_placeholder')}
              disabled={busyCreate}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={busyCreate}
              title={t('stash.create_title')}
            >
              <i className={`ti ${busyCreate ? 'ti-loader-2' : 'ti-archive'}`} />
              {busyCreate ? t('common.loading') : t('stash.create_button')}
            </button>
          </div>

          {stashes.length === 0 ? (
            <div className="empty-state center" style={{ padding: 28 }}>
              <i className="ti ti-archive-off" style={{ fontSize: 32, opacity: 0.2 }} />
              <p style={{ fontSize: 13, marginTop: 6 }}>{t('stash.empty')}</p>
            </div>
          ) : (
            <>
              <div className="section-label" style={{ marginTop: 16 }}>
                {t('stash.title')} · {stashes.length}
              </div>
              <div className="stash-list">
                {stashes.map(s => (
                  <div key={s.index} className="stash-item">
                    <div className="stash-item-main">
                      <div className="stash-item-msg" title={s.message}>{s.message}</div>
                      <div className="stash-item-meta">
                        <span className="stash-item-ref">stash@{`{${s.index}}`}</span>
                        <span className="stash-item-time">{relTime(s.time)}</span>
                      </div>
                    </div>
                    <div className="stash-item-actions">
                      {confirmDrop === s.index ? (
                        <>
                          <button
                            className="ct-btn danger"
                            onClick={() => {
                              setConfirmDrop(null)
                              dropStash(s.index)
                            }}
                          >
                            <i className="ti ti-trash" />
                            {t('stash.drop_confirm')}
                          </button>
                          <button className="ct-btn" onClick={() => setConfirmDrop(null)}>
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="ct-btn"
                            onClick={() => applyStash(s.index)}
                            title={t('stash.apply_tooltip')}
                          >
                            {t('stash.apply')}
                          </button>
                          <button
                            className="ct-btn"
                            onClick={() => popStash(s.index)}
                            title={t('stash.pop_tooltip')}
                          >
                            {t('stash.pop')}
                          </button>
                          <button
                            className="ct-btn danger"
                            onClick={() => setConfirmDrop(s.index)}
                            title={t('stash.drop_tooltip')}
                            aria-label={t('stash.drop')}
                          >
                            <i className="ti ti-trash" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
