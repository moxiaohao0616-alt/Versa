import { useEffect, useState } from 'react'
import { useStore, type BlameLine } from '../../store'

/** Inspect "git blame" for a single file. Reuses the same backend command for
 *  both working-tree and historical versions. */
export function BlameModal({ file, commit, onClose }: {
  file: string
  commit?: string
  onClose: () => void
}) {
  const { blameFile, showToast } = useStore()
  const [lines, setLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)

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
          <i className="ti ti-user-search" style={{ marginRight: 6 }} />
          Blame · {file}
        </div>
        <div className="blame-body">
          {loading ? (
            <p className="rs-empty" style={{ padding: 16 }}>分析中…</p>
          ) : lines.length === 0 ? (
            <p className="rs-empty" style={{ padding: 16 }}>没有可分析的内容</p>
          ) : (
            <div className="blame-grid">
              {lines.map(l => (
                <BlameRow key={l.lineNo} line={l} />
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}

function BlameRow({ line }: { line: BlameLine }) {
  // Collapse the "blame meta" column to a single colored bar of the same color
  // for consecutive lines belonging to the same commit, à la GitHub blame.
  // Cheap version: show short sha + author for every line.
  return (
    <div className="blame-row">
      <span className="blame-sha" title={`${line.short} · ${line.author} · ${relTime(line.time)}\n${line.summary}`}>
        {line.short}
      </span>
      <span className="blame-author" title={`${line.author} <${line.email}>`}>{line.author}</span>
      <span className="blame-time">{relTime(line.time)}</span>
      <span className="blame-lineno">{line.lineNo}</span>
      <pre className="blame-content">{line.content || ' '}</pre>
    </div>
  )
}

function relTime(t: number): string {
  if (!t) return ''
  const s = Date.now() / 1000 - t
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分前`
  if (s < 86400) return `${Math.floor(s / 3600)} 时前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`
  return new Date(t * 1000).toLocaleDateString('zh-CN')
}
