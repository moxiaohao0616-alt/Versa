import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore, type DiffHunk, type DiffLine } from '../../store'
import { relTime } from '../../lib/relTime'

interface BlockHistoryEntry {
  id: string
  shortId: string
  author: string
  time: number
  message: string
  hunks: DiffHunk[]
}

/** "Block history" — `git log -L start,end:file`. Shows every commit that
 *  touched the selected line range, with the diff for each. The exact
 *  answer to "who changed this specific block of code?" */
export function BlockHistoryModal({
  file, start, end, onClose,
}: {
  file: string
  start: number
  end: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { repoPath, selectCommit, selectFile } = useStore()
  const [entries, setEntries] = useState<BlockHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    ;(async () => {
      setLoading(true); setError(null)
      try {
        const list = await invoke<BlockHistoryEntry[]>('get_block_history', {
          path: repoPath, file, start, end, limit: 200,
        })
        if (!cancelled) {
          setEntries(list)
          // Expand the most recent commit's diff by default so users
          // see something immediately.
          if (list.length > 0) setExpanded(new Set([list[0].id]))
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoPath, file, start, end])

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const openCommit = async (e: BlockHistoryEntry) => {
    onClose()
    await selectCommit({ id: e.id, shortId: e.shortId, message: e.message })
    await selectFile(file, false, e.id)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide block-history-modal" onClick={ev => ev.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-history" style={{ marginRight: 6 }} />
          {t('block_history.title')}
          <span className="block-history-range">
            {file}:L{start}–L{end}
          </span>
        </div>
        <div className="block-history-body">
          {loading ? (
            <div className="block-history-loading">
              <i className="ti ti-loader-2" /> {t('common.loading')}
            </div>
          ) : error ? (
            <div className="block-history-error">
              <i className="ti ti-alert-circle" /> {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="empty-state center" style={{ padding: 32 }}>
              <i className="ti ti-search-off" style={{ fontSize: 28, opacity: 0.3 }} />
              <p>{t('block_history.empty')}</p>
            </div>
          ) : entries.map(e => {
            const isOpen = expanded.has(e.id)
            return (
              <div key={e.id} className="block-history-card">
                <button className="block-history-head" onClick={() => toggle(e.id)}>
                  <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} />
                  <span className="block-history-sha">{e.shortId}</span>
                  <span className="block-history-msg" title={e.message}>{e.message || '(no message)'}</span>
                  <span className="block-history-author">{e.author}</span>
                  <span className="block-history-time">{relTime(e.time)}</span>
                  <button
                    className="block-history-open"
                    onClick={ev => { ev.stopPropagation(); openCommit(e) }}
                    title={t('block_history.open_commit')}
                  >
                    <i className="ti ti-arrow-up-right" />
                  </button>
                </button>
                {isOpen && (
                  <div className="block-history-hunks">
                    {e.hunks.map((h, hi) => (
                      <div key={hi} className="compare-hunk">
                        <div className="compare-hunk-head">{h.header}</div>
                        {h.lines.map((l: DiffLine, li) => (
                          <div key={li} className={`compare-line origin-${l.origin === ' ' ? 'ctx' : l.origin === '+' ? 'add' : 'del'}`}>
                            <span className="ln">{l.old_lineno ?? ''}</span>
                            <span className="ln">{l.new_lineno ?? ''}</span>
                            <span className="code">{l.content || ' '}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <div className="modal-footer">
          <span className="block-history-count">
            {!loading && entries.length > 0 && t('block_history.count', { n: entries.length })}
          </span>
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
