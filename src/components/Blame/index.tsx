import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type BlameLine } from '../../store'
import { relTime } from '../../lib/relTime'
import { BlockHistoryModal } from '../BlockHistory'

/** 行级"追溯" (`git blame`) —— 每行显示最后一次动它的 commit。
 *  点一行可以打开 Block History，看这一行的完整修改史。 */
export function BlameModal({ file, commit, onClose }: {
  file: string
  commit?: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { blameFile, showToast } = useStore()
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)
  const [historyLine, setHistoryLine] = useState<number | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try { setLines(await blameFile(file, commit)) }
      catch (e) { showToast(String(e), 'error') }
      finally { setLoading(false) }
    })()
  }, [file, commit])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-history" style={{ marginRight: 6 }} />
          {t('blame.title', { file })}
        </div>
        <div className="blame-hint">
          <i className="ti ti-info-circle" />
          {t('blame.hint')}
        </div>
        <div className="blame-body">
          {loading ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('blame.loading')}</p>
          ) : lines.length === 0 ? (
            <p className="rs-empty" style={{ padding: 16 }}>{t('blame.empty')}</p>
          ) : (
            <div className="blame-grid">
              {lines.map(l => (
                <BlameRow
                  key={l.lineNo}
                  line={l}
                  onShowHistory={() => setHistoryLine(l.lineNo)}
                />
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>

      {historyLine !== null && (
        <BlockHistoryModal
          file={file}
          start={historyLine}
          end={historyLine}
          onClose={() => setHistoryLine(null)}
        />
      )}
    </div>
  )
}

function BlameRow({ line, onShowHistory }: {
  line: BlameLine
  onShowHistory: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="blame-row" onClick={onShowHistory} title={t('blame.row_tooltip')}>
      <span className="blame-sha" title={`${line.short} · ${line.author} · ${relTime(line.time)}\n${line.summary}`}>
        {line.short}
      </span>
      <span className="blame-author" title={`${line.author} <${line.email}>`}>{line.author}</span>
      <span className="blame-time">{relTime(line.time)}</span>
      <span className="blame-lineno">{line.lineNo}</span>
      <pre className="blame-content">{line.content || ' '}</pre>
      <i className="ti ti-history blame-history-icon" />
    </div>
  )
}
