import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { relTime } from '../../lib/relTime'

/** Right-side aux panel. Hosts "look at" cards: project runners, AI commit
 *  explanation, stash list. Each card collapses individually; the whole panel
 *  is toggled from the icon-bar. */
export function RightSidebar() {
  const { t } = useTranslation()
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
        <span className="rs-header-title">{t('rightsidebar.title')}</span>
        <button
          className="rs-collapse-btn"
          onClick={toggleRightSidebar}
          title={t('rightsidebar.collapse')}
          aria-label={t('rightsidebar.collapse')}
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
              <p className="rs-empty">{t('rightsidebar.project_empty')}</p>
            )}
          </Card>
        )}

        {/* ── AI commit explanation (only while a commit is selected) ──── */}
        {selectedCommit && (
          <Card
            icon="ti-sparkles"
            title={`${t('rightsidebar.explain_title')} · ${selectedCommit.shortId}`}
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
          title={`${t('stash.title')} · ${stashes.length}`}
          open={openStash}
          onToggle={() => setOpenStash(v => !v)}
        >
          {stashes.length === 0 ? (
            <p className="rs-empty">{t('rightsidebar.stash_empty')}</p>
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
                          title={t('rightsidebar.drop_confirm')}
                          onClick={() => { setConfirmDrop(null); dropStash(s.index) }}
                        >
                          <i className="ti ti-check" />
                        </button>
                        <button title={t('common.cancel')} onClick={() => setConfirmDrop(null)}>
                          <i className="ti ti-x" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button title={t('rightsidebar.apply_keep')} onClick={() => applyStash(s.index)}>
                          <i className="ti ti-arrow-back-up" />
                        </button>
                        <button title={t('rightsidebar.apply_drop')} onClick={() => popStash(s.index)}>
                          <i className="ti ti-arrow-back-up-double" />
                        </button>
                        <button title={t('rightsidebar.drop_only')} onClick={() => setConfirmDrop(s.index)}>
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
  const { t } = useTranslation()
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
            <span>{t('rightsidebar.explain_thinking')}</span>
          </div>
        )}
        {!loading && (
          <button className="rs-explain-redo" onClick={onRun}>
            <i className="ti ti-refresh" />
            {t('rightsidebar.explain_regenerate')}
          </button>
        )}
      </>
    )
  }
  if (loading) {
    return (
      <div className="rs-loading">
        <i className="ti ti-loader-2" />
        <span>{t('rightsidebar.explain_thinking')}</span>
      </div>
    )
  }
  return (
    <button className="rs-explain-cta" onClick={onRun}>
      <i className="ti ti-sparkles" />
      {t('rightsidebar.explain_cta')}
    </button>
  )
}
