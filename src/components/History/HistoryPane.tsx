import { useRef, useState } from 'react'
import { useStore } from '../../store'
import { GraphView } from '../Graph'
import { CommitDetail } from '../CommitDetail'

/** 3-pane History layout: GraphView (commit list) + outer resize handle +
 *  CommitDetail (files + diff, which has its own inner resize handle).
 *
 *  Widths persist via store → localStorage. The handle is a thin invisible
 *  hit-target that lights up on hover/drag; cursor swaps to col-resize
 *  during a drag so the entire window participates. */
export function HistoryPane() {
  const graphWidth = useStore(s => s.historyGraphWidth)
  const setGraphWidth = useStore(s => s.setHistoryGraphWidth)
  const filesWidth = useStore(s => s.historyFilesWidth)
  const paneRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)

  // Outer handle — between GraphView and CommitDetail. The graph column
  // grows when the user drags right. The cap is half the pane's current
  // width so the graph can never crowd the file list + diff out of view.
  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = graphWidth
    const paneW = paneRef.current?.offsetWidth ?? window.innerWidth
    // Reserve at least 360px for CommitDetail (files list min + small diff).
    const maxW = Math.max(280, paneW - 360 - filesWidth)
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX
      const next = Math.max(280, Math.min(maxW, startW + dx))
      setGraphWidth(next)
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

  return (
    <div
      ref={paneRef}
      className="history-pane"
      style={{
        // Drive the two flex-basis values via CSS vars so we don't have
        // to thread inline style props through GraphView / CommitDetail.
        ['--history-graph-w' as any]: `${graphWidth}px`,
        ['--history-files-w' as any]: `${filesWidth}px`,
      }}
    >
      <GraphView />
      <div
        className={`history-resize${dragging ? ' is-dragging' : ''}`}
        onMouseDown={onMouseDown}
        title="Drag to resize"
      />
      <CommitDetail />
    </div>
  )
}
