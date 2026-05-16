import { useState } from 'react'
import { useStore } from '../../store'

/** Right-side aux panel. Hosts "look at" cards: project runners, AI commit
 *  explanation, stash list. Each card collapses individually; the whole panel
 *  is toggled from the icon-bar. */
export function RightSidebar() {
  const {
    projectInfo, sendToTerminal,
    selectedCommit, commitExplanation, commitExplanationLoading, explainSelectedCommit,
    stashes, applyStash, popStash, dropStash,
    toggleRightSidebar,
  } = useStore()

  // Each card remembers its own expanded state. Reasonable defaults:
  //   project / explain — expanded so it's immediately useful
  //   stash             — collapsed unless there's at least one entry
  const [openProject, setOpenProject] = useState(true)
  const [openExplain, setOpenExplain] = useState(true)
  const [openStash, setOpenStash]     = useState(false)
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null)

  const projectAvailable = !!projectInfo && projectInfo.kind !== 'unknown'

  return (
    <aside className="right-sidebar">
      <div className="rs-header">
        <span className="rs-header-title">侧栏</span>
        <button
          className="rs-collapse-btn"
          onClick={toggleRightSidebar}
          title="收起侧栏"
          aria-label="收起侧栏"
        >
          <i className="ti ti-chevron-right" />
        </button>
      </div>

      <div className="rs-body">
        {/* ── Project runner ───────────────────────────────────────────── */}
        {projectAvailable && (
          <Card
            icon="ti-package"
            title={`${projectInfo!.display}${projectInfo!.packageManager ? ` · ${projectInfo!.packageManager}` : ''}`}
            open={openProject}
            onToggle={() => setOpenProject(v => !v)}
          >
            {projectInfo!.commands.length > 0 ? (
              <div className="rs-cmd-grid">
                {projectInfo!.commands.map(c => (
                  <button
                    key={c.command}
                    className="rs-cmd-btn"
                    onClick={() => sendToTerminal(c.command)}
                    title={c.command}
                  >
                    <i className="ti ti-player-play" />
                    <span>{c.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rs-empty">这个项目没探测到可运行的脚本</p>
            )}
          </Card>
        )}

        {/* ── AI commit explanation (only while a commit is selected) ──── */}
        {selectedCommit && (
          <Card
            icon="ti-sparkles"
            title={`AI 解释 · ${selectedCommit.shortId}`}
            open={openExplain}
            onToggle={() => setOpenExplain(v => !v)}
          >
            <ExplainBody
              key={selectedCommit.id}
              commitId={selectedCommit.id}
              explanation={commitExplanation}
              loading={commitExplanationLoading}
              onRun={() => explainSelectedCommit()}
            />
          </Card>
        )}

        {/* ── Stash list ───────────────────────────────────────────────── */}
        <Card
          icon="ti-archive"
          title={`暂存 · ${stashes.length}`}
          open={openStash}
          onToggle={() => setOpenStash(v => !v)}
        >
          {stashes.length === 0 ? (
            <p className="rs-empty">还没有搁置的进度</p>
          ) : (
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
                          title="确认删除（不可撤销）"
                          onClick={() => { setConfirmDrop(null); dropStash(s.index) }}
                        >
                          <i className="ti ti-check" />
                        </button>
                        <button title="取消" onClick={() => setConfirmDrop(null)}>
                          <i className="ti ti-x" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button title="恢复（保留搁置）" onClick={() => applyStash(s.index)}>
                          <i className="ti ti-arrow-back-up" />
                        </button>
                        <button title="恢复并从列表删除" onClick={() => popStash(s.index)}>
                          <i className="ti ti-arrow-back-up-double" />
                        </button>
                        <button title="只删除（不恢复）" onClick={() => setConfirmDrop(s.index)}>
                          <i className="ti ti-trash" />
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </aside>
  )
}

function Card({
  icon, title, open, onToggle, children,
}: {
  icon: string
  title: string
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <section className={`rs-card ${open ? 'open' : 'closed'}`}>
      <button className="rs-card-head" onClick={onToggle} type="button">
        <i className={`ti ${icon} rs-card-icon`} />
        <span className="rs-card-title">{title}</span>
        <i className={`ti ti-chevron-${open ? 'down' : 'right'} rs-card-chev`} />
      </button>
      {open && <div className="rs-card-body">{children}</div>}
    </section>
  )
}

function ExplainBody({
  commitId, explanation, loading, onRun,
}: {
  commitId: string
  explanation: { sha: string; text: string } | null
  loading: boolean
  onRun: () => void
}) {
  const matches = explanation && explanation.sha === commitId
  if (matches) {
    return (
      <>
        {explanation!.text ? (
          <p className="rs-explain-text">
            {explanation!.text}
            {loading && <span className="ai-streaming-cursor">▌</span>}
          </p>
        ) : (
          <div className="rs-loading">
            <i className="ti ti-loader-2" />
            <span>AI 正在分析这次改动…</span>
          </div>
        )}
        {!loading && (
          <button className="rs-explain-redo" onClick={onRun}>
            <i className="ti ti-refresh" />
            重新生成
          </button>
        )}
      </>
    )
  }
  if (loading) {
    return (
      <div className="rs-loading">
        <i className="ti ti-loader-2" />
        <span>AI 正在分析这次改动…</span>
      </div>
    )
  }
  return (
    <button className="rs-explain-cta" onClick={onRun}>
      <i className="ti ti-sparkles" />
      用 AI 解释这次改动
    </button>
  )
}

function relTime(t: number): string {
  const secs = Date.now() / 1000 - t
  if (secs < 60) return '刚刚'
  if (secs < 3600) return `${Math.floor(secs / 60)} 分钟前`
  if (secs < 86400) return `${Math.floor(secs / 3600)} 小时前`
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)} 天前`
  const d = new Date(t * 1000)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
}
