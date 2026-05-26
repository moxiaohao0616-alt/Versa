import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { DiffView } from '../Diff'

/** Right half of the History view: file list + diff for whichever commit
 *  is currently selected in the graph. Lives next to GraphView, NOT inside
 *  the Changes tab — the previous design routed historical commit viewing
 *  through Changes by relying on the same global `selectedCommit` flag,
 *  which made Changes mean "working tree" sometimes and "commit XYZ" other
 *  times depending on hidden state. Hosting the detail here keeps input
 *  (click commit row in graph) and output (its files + diff) on the same
 *  screen, and lets Changes go back to meaning only one thing. */
export function CommitDetail() {
  const { t } = useTranslation()
  const selectedCommit = useStore(s => s.selectedCommit)
  const commitFiles = useStore(s => s.commitFiles)
  const selectedFile = useStore(s => s.selectedFile)
  const selectedFileStaged = useStore(s => s.selectedFileStaged)
  const selectFile = useStore(s => s.selectFile)
  const viewAllInCommit = useStore(s => s.viewAllInCommit)
  const filesWidth = useStore(s => s.historyFilesWidth)
  const setFilesWidth = useStore(s => s.setHistoryFilesWidth)
  const [dragging, setDragging] = useState(false)

  // Inner handle — between the commit's file list and the diff. The file
  // column grows when the user drags right; cap at 40% of the window so
  // a runaway drag can't completely eat the diff column.
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = filesWidth
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const next = Math.max(180, Math.min(window.innerWidth * 0.4, startW + dx))
      setFilesWidth(next)
    }
    const onUp = () => {
      setDragging(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!selectedCommit) {
    return (
      <aside className="commit-detail commit-detail-empty">
        <div className="commit-detail-empty-state">
          <i className="ti ti-git-commit" />
          <p>{t('graph.detail_empty', 'Pick a commit on the left to see its files and diff.')}</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="commit-detail">
      <div className="commit-detail-files">
        <div className="section-label">
          {t('sidebar.commit_changes')} · {commitFiles.length} {t('common.files_word')}
        </div>
        <div className="file-list">
          <div
            className={`file-item file-item-all ${selectedFile === null ? 'selected' : ''}`}
            onClick={() => viewAllInCommit()}
            title={t('sidebar.view_all_changes')}
          >
            <span className="fbadge status-all"><i className="ti ti-files" /></span>
            <div className="file-info">
              <span className="file-name">{t('sidebar.view_all_changes')}</span>
              <span className="file-path">{commitFiles.length} {t('sidebar.files_summary')}</span>
            </div>
          </div>
          {commitFiles.map(f => (
            <div
              key={f.path}
              className={`file-item ${selectedFile === f.path && !selectedFileStaged ? 'selected' : ''}`}
              onClick={() => selectFile(f.path, false, selectedCommit.id)}
              title={f.path}
            >
              <span className={`fbadge status-${f.status}`}>{f.status}</span>
              <div className="file-info">
                <span className="file-name">{f.path.split('/').pop()}</span>
                <span className="file-path">{f.path}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div
        className={`history-resize${dragging ? ' is-dragging' : ''}`}
        onMouseDown={onResizeMouseDown}
        title="Drag to resize"
      />
      <div className="commit-detail-diff">
        <DiffView />
      </div>
    </aside>
  )
}
