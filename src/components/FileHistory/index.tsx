import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'
import { relTime } from '../../lib/relTime'

interface FileHistoryEntry {
  id: string
  short_id: string
  message: string
  author: string
  time: number
}

/** Lists every commit that touched a single file. Click a row to jump into
 *  commit-view mode at that commit, with this file's diff pre-selected. */
export function FileHistoryModal({ file, onClose }: { file: string; onClose: () => void }) {
  const { t } = useTranslation()
  const { repoPath, selectCommit, selectFile, showToast } = useStore()
  const [entries, setEntries] = useState<FileHistoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await invoke<FileHistoryEntry[]>('get_file_history', {
          path: repoPath,
          file,
          limit: 500,
        })
        if (!cancelled) setEntries(list)
      } catch (e) {
        if (!cancelled) showToast(String(e), 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [repoPath, file])

  const openCommit = async (e: FileHistoryEntry) => {
    onClose()
    await selectCommit({ id: e.id, shortId: e.short_id, message: e.message })
    await selectFile(file, false, e.id)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={ev => ev.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-history" style={{ marginRight: 6 }} />
          {t('file_history.title')}
          <span className="file-history-path" title={file}>{file}</span>
        </div>
        <div className="file-history-list">
          {loading ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('common.loading')}</p>
          ) : entries.length === 0 ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('file_history.empty')}</p>
          ) : entries.map(e => (
            <button
              key={e.id}
              className="file-history-row"
              onClick={() => openCommit(e)}
              title={t('file_history.open_at_commit')}
            >
              <span className="file-history-sha">{e.short_id}</span>
              <span className="file-history-msg">{e.message || '(no message)'}</span>
              <span className="file-history-meta">
                <span className="branch-author">{e.author}</span>
                <span className="branch-time">{relTime(e.time)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <span className="file-history-count">
            {!loading && entries.length > 0 && t('file_history.count', { n: entries.length })}
          </span>
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  )
}
