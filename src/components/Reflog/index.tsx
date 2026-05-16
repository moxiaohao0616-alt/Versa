import { useEffect, useState } from 'react'
import { useStore, type ReflogEntry } from '../../store'

/** "时光机": browse HEAD reflog and hard-reset back to any entry. Used to recover
 *  from accidental resets / rebases / branch deletions that left orphan commits. */
export function ReflogModal({ onClose }: { onClose: () => void }) {
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

  const actionLabel = (action: string) => {
    // Translate the most common reflog "action" tokens to friendlier Chinese.
    switch (action) {
      case 'commit': case 'commit (initial)': case 'commit (amend)': return '提交'
      case 'checkout': return '切换'
      case 'reset': return '回退'
      case 'merge': return '合并'
      case 'rebase': case 'rebase -i (finish)': case 'rebase (start)': return '变基'
      case 'pull': return '拉取'
      case 'clone': return '克隆'
      case 'revert': return '撤销'
      case 'cherry-pick': return '拣选'
      default: return action || '其他'
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <i className="ti ti-history" style={{ marginRight: 6 }} />
          时光机 · HEAD 操作历史
        </div>
        <p className="modal-warn" style={{ margin: '0 16px 0' }}>
          <i className="ti ti-info-circle" />
          选中一条 → "回到这步" 会 <code>git reset --hard</code> 到那时的 HEAD。<b>未提交的改动会丢</b>，回退本身也会记入 reflog，所以这一步还能再撤销。
        </p>
        <div className="reflog-list">
          {loading ? (
            <p className="rs-empty" style={{ padding: 16 }}>加载中…</p>
          ) : entries.length === 0 ? (
            <p className="rs-empty" style={{ padding: 16 }}>没有 reflog 记录</p>
          ) : entries.map(e => (
            <div key={e.index} className="reflog-row" onClick={() => setConfirmTarget(e)}>
              <span className="reflog-idx">HEAD@{`{${e.index}}`}</span>
              <span className="reflog-action">{actionLabel(e.action)}</span>
              <span className="reflog-msg" title={e.message}>{e.message}</span>
              <span className="reflog-meta">
                <span className="branch-sha">{e.short}</span>
                <span className="branch-time">{relTime(e.time)}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>

      {confirmTarget && (
        <div className="modal-overlay" onClick={() => setConfirmTarget(null)}>
          <div className="modal" onClick={ev => ev.stopPropagation()}>
            <div className="modal-title">回到这步？</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{confirmTarget.short}</span>
                <span className="modal-commit-msg">{confirmTarget.message}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                会执行 <code>git reset --hard {confirmTarget.short}</code>。
                未提交的改动会丢；但这次回退本身也会记到 reflog，可以再来一次时光机撤销。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmTarget(null)}>取消</button>
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
                回到这步
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function relTime(t: number): string {
  const s = Date.now() / 1000 - t
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`
  return new Date(t * 1000).toLocaleDateString('zh-CN')
}
