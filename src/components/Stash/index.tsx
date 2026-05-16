import { useEffect, useState } from 'react'
import { useStore } from '../../store'

function relTime(ts: number): string {
  const s = Math.floor(Date.now() / 1000 - ts)
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`
  return new Date(ts * 1000).toLocaleDateString('zh-CN')
}

export function StashModal({ onClose }: { onClose: () => void }) {
  const {
    stashes,
    loadStashes, createStash, applyStash, popStash, dropStash,
  } = useStore()

  const [msg, setMsg] = useState('')
  const [busyCreate, setBusyCreate] = useState(false)
  /** Inline confirmation: while set to an index, that row's actions become a
   *  "确认删除 / 取消" pair. Prevents accidental loss without an extra modal. */
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
        <div className="modal-title">暂时搁置</div>
        <div className="modal-body">
          <div className="stash-create">
            <input
              className="settings-input"
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder="给这次搁置写一句备注（可选）"
              disabled={busyCreate}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
            <button
              className="btn-primary"
              onClick={handleCreate}
              disabled={busyCreate}
              title="把当前所有改动（含未跟踪文件）暂存起来，工作区恢复干净"
            >
              <i className={`ti ${busyCreate ? 'ti-loader-2' : 'ti-archive'}`} />
              {busyCreate ? '搁置中…' : '搁置当前改动'}
            </button>
          </div>

          {stashes.length === 0 ? (
            <div className="empty-state center" style={{ padding: 28 }}>
              <i className="ti ti-archive-off" style={{ fontSize: 32, opacity: 0.2 }} />
              <p style={{ fontSize: 13, marginTop: 6 }}>目前没有搁置的工作</p>
            </div>
          ) : (
            <>
              <div className="section-label" style={{ marginTop: 16 }}>
                已搁置 · {stashes.length} 处
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
                            确认删除
                          </button>
                          <button className="ct-btn" onClick={() => setConfirmDrop(null)}>
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            className="ct-btn"
                            onClick={() => applyStash(s.index)}
                            title="把这份搁置应用到工作区，但保留在列表中"
                          >
                            应用
                          </button>
                          <button
                            className="ct-btn"
                            onClick={() => popStash(s.index)}
                            title="应用并从列表删除"
                          >
                            应用并删除
                          </button>
                          <button
                            className="ct-btn danger"
                            onClick={() => setConfirmDrop(s.index)}
                            title="只从列表删除，不应用（不可撤销）"
                            aria-label="删除"
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
          <button className="btn-secondary" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  )
}
