import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'
import { StashModal } from '../Stash'
import { ReflogModal } from '../Reflog'
import { GitProgressBar } from '../GitProgressBar'

export function Sidebar() {
  const { t } = useTranslation()
  const {
    repoPath, repoStatus, selectedFile, selectedFileStaged,
    selectedCommit, commitFiles,
    commitMessage, selectFile, selectCommit,
    stageFile, unstageFile, discardFile,
    saveProgress, setCommitMessage,
    pushBranch, pullBranch, fetchAll,
    generateCommitMessage, aiGenerating,
    gitProgress,
    stashes,
    viewAllInCommit,
  } = useStore()

  const [stashOpen, setStashOpen] = useState(false)
  const [reflogOpen, setReflogOpen] = useState(false)

  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [fetching, setFetching] = useState(false)

  const [discardTarget, setDiscardTarget] = useState<string | null>(null)

  // Auto-pick a file to show as soon as the repo (or tab) loads so the right
  // pane isn't blank on first arrival. Prefer the first unstaged file (the
  // common "still being worked on" case); fall back to staged. Skip when:
  //   - the user is viewing a historical commit (selectedCommit set),
  //   - or they already have something selected.
  useEffect(() => {
    if (!repoStatus) return
    if (selectedFile || selectedCommit) return
    const firstUnstaged = repoStatus.files.find(f => f.unstagedStatus)
    if (firstUnstaged) {
      selectFile(firstUnstaged.path, false)
      return
    }
    const firstStaged = repoStatus.files.find(f => f.stagedStatus)
    if (firstStaged) selectFile(firstStaged.path, true)
    // Re-run only on actual repo / file-set change. Including selectedFile in
    // deps would cause an immediate re-fire after we set it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, repoStatus?.files.length])

  if (!repoStatus) return null

  const { files, ahead, behind } = repoStatus
  const stagedFiles = files.filter(f => f.stagedStatus)
  const unstagedFiles = files.filter(f => f.unstagedStatus)

  const handlePush = async () => {
    setPushing(true)
    await pushBranch()
    setPushing(false)
  }

  const handlePull = async () => {
    setPulling(true)
    await pullBranch()
    setPulling(false)
  }

  return (
    <aside className="sidebar">
      {/* Sidebar header is now just the action row. Branch switcher lives
          in the window titlebar (single-source-of-truth for current branch).
          Repo name + path live in the TabStrip up top. */}
      <div className="sidebar-header">
        <div className="sync-row">
          <button className="btn-primary" onClick={handlePush} disabled={pushing}>
            <i className={`ti ${pushing ? 'ti-loader-2' : 'ti-cloud-upload'}`} />
            {pushing ? t('sidebar.pushing') : t('sidebar.push')}
            {ahead > 0 && <span className="badge">{ahead}</span>}
          </button>
          <button className="btn-icon" title={t('sidebar.pull_tooltip')} onClick={handlePull} disabled={pulling}>
            <i className={`ti ${pulling ? 'ti-loader-2' : 'ti-download'}`} />
            {behind > 0 && <span className="badge warn">{behind}</span>}
          </button>
          <button
            className="btn-icon"
            title={t('sidebar.fetch_tooltip')}
            onClick={async () => { setFetching(true); await fetchAll(false); setFetching(false) }}
            disabled={fetching}
          >
            <i className={`ti ${fetching ? 'ti-loader-2' : 'ti-refresh'}`} />
          </button>
          <button
            className="btn-icon"
            title={t('sidebar.stash_tooltip')}
            onClick={() => setStashOpen(true)}
          >
            <i className="ti ti-archive" />
            {stashes.length > 0 && <span className="badge">{stashes.length}</span>}
          </button>
          <button
            className="btn-icon"
            title={t('sidebar.reflog_tooltip')}
            onClick={() => setReflogOpen(true)}
          >
            <i className="ti ti-history" />
          </button>
        </div>
        {gitProgress && (gitProgress.phase === 'push' || gitProgress.phase === 'pull' || gitProgress.phase === 'fetch') && (
          <GitProgressBar progress={gitProgress} />
        )}
      </div>

      {/* ── 提交查看模式 ── */}
      {selectedCommit ? (
        <>
          <div className="commit-context-banner">
            <div className="commit-context-left">
              <i className="ti ti-git-commit" />
              <span className="commit-context-sha">{selectedCommit.shortId}</span>
              <span className="commit-context-msg">{selectedCommit.message}</span>
            </div>
            <button className="commit-context-clear" title={t('sidebar.exit_view')} onClick={() => selectCommit(null)}>
              <i className="ti ti-x" />
            </button>
          </div>

          {commitFiles.length > 0 && (
            <>
              <div className="section-label">{t('sidebar.commit_changes')} · {commitFiles.length} {t('common.files_word')}</div>
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
                  >
                    <span className={`fbadge status-${f.status}`}>{f.status}</span>
                    <div className="file-info">
                      <span className="file-name">{f.path.split('/').pop()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {files.length > 0 && (
            <>
              <div className="section-label section-label-sep">{t('sidebar.workspace_changes')} · {files.length} {t('common.files_word')}</div>
              <div className="file-list">
                {unstagedFiles.map(f => (
                  <div
                    key={f.path}
                    className={`file-item ${selectedFile === f.path && !selectedFileStaged ? 'selected' : ''}`}
                    onClick={() => selectFile(f.path, false)}
                  >
                    <span className={`fbadge status-${f.unstagedStatus}`}>{f.unstagedStatus}</span>
                    <div className="file-info">
                      <span className="file-name">{f.path.split('/').pop()}</span>
                    </div>
                    <div className="file-actions">
                      <button className="file-action-btn" title={t('sidebar.stage')}
                        onClick={e => { e.stopPropagation(); stageFile(f.path) }}>
                        <i className="ti ti-plus" />
                      </button>
                      {f.unstagedStatus !== '?' && (
                        <button className="file-action-btn danger" title={t('sidebar.discard')}
                          onClick={e => { e.stopPropagation(); setDiscardTarget(f.path) }}>
                          <i className="ti ti-rotate" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* ── 正常工作区模式 ── */
        <>
          {files.length === 0 ? (
            <div className="empty-state center">
              <i className="ti ti-circle-check" style={{ fontSize: 36, opacity: 0.15 }} />
              <p>{t('sidebar.workspace_clean')}</p>
              <span style={{ fontSize: 12 }}>{t('sidebar.workspace_clean_sub')}</span>
            </div>
          ) : (
            <>
              {stagedFiles.length > 0 && (
                <>
                  <div className="section-label">{t('sidebar.staged')} · {stagedFiles.length} {t('common.files_word')}</div>
                  <div className="file-list">
                    {stagedFiles.map(f => (
                      <div
                        key={`staged-${f.path}`}
                        className={`file-item ${selectedFile === f.path && selectedFileStaged ? 'selected' : ''}`}
                        onClick={() => selectFile(f.path, true)}
                      >
                        <span className={`fbadge status-${f.stagedStatus}`}>{f.stagedStatus}</span>
                        <div className="file-info">
                          <span className="file-name">{f.path.split('/').pop()}</span>
                          <span className="file-path">{f.path.split('/').slice(0, -1).join('/')}</span>
                        </div>
                        <div className="file-actions">
                          <button className="file-action-btn" title={t('sidebar.unstage')}
                            onClick={e => { e.stopPropagation(); unstageFile(f.path) }}>
                            <i className="ti ti-minus" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {unstagedFiles.length > 0 && (
                <>
                  <div className="section-label">{t('sidebar.unstaged')} · {unstagedFiles.length} {t('common.files_word')}</div>
                  <div className="file-list">
                    {unstagedFiles.map(f => (
                      <div
                        key={`unstaged-${f.path}`}
                        className={`file-item ${selectedFile === f.path && !selectedFileStaged ? 'selected' : ''}`}
                        onClick={() => selectFile(f.path, false)}
                      >
                        <span className={`fbadge status-${f.unstagedStatus}`}>{f.unstagedStatus}</span>
                        <div className="file-info">
                          <span className="file-name">{f.path.split('/').pop()}</span>
                          <span className="file-path">{f.path.split('/').slice(0, -1).join('/')}</span>
                        </div>
                        <div className="file-actions">
                          <button className="file-action-btn" title={t('sidebar.stage')}
                            onClick={e => { e.stopPropagation(); stageFile(f.path) }}>
                            <i className="ti ti-plus" />
                          </button>
                          {f.unstagedStatus !== '?' && (
                            <button className="file-action-btn danger" title={t('sidebar.discard')}
                              onClick={e => { e.stopPropagation(); setDiscardTarget(f.path) }}>
                              <i className="ti ti-rotate" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="commit-area">
                <div className="commit-label-row">
                  <span className="label">{t('sidebar.commit_label')}</span>
                  <button
                    className="ai-btn"
                    title={t('sidebar.ai_generate')}
                    onClick={generateCommitMessage}
                    disabled={aiGenerating}
                  >
                    <i className={`ti ${aiGenerating ? 'ti-loader-2' : 'ti-sparkles'}`} />
                    {aiGenerating ? t('sidebar.ai_generating') : t('sidebar.ai_generate')}
                  </button>
                </div>
                <textarea
                  className="commit-input"
                  placeholder={t('sidebar.commit_placeholder')}
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  rows={3}
                />
                <button
                  className="btn-primary full"
                  // Enabled as long as there's a message AND any change in the
                  // tree (staged or unstaged). When nothing's staged we still
                  // commit — save_progress on the backend stages everything
                  // first. This avoids the "I typed a message, why is it
                  // stuck" trap when users skip the explicit stage step.
                  disabled={!commitMessage.trim() || files.length === 0}
                  onClick={saveProgress}
                  title={stagedFiles.length === 0 ? t('sidebar.stage_all_hint') : undefined}
                >
                  <i className="ti ti-device-floppy" />
                  {t('sidebar.save_progress')}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {discardTarget && (
        <div className="modal-overlay" onClick={() => setDiscardTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('sidebar.discard_title')}</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{discardTarget.split('/').pop()}</span>
                <span className="modal-commit-msg">{discardTarget}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                {t('sidebar.discard_warn')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDiscardTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={() => {
                const file = discardTarget
                setDiscardTarget(null)
                discardFile(file)
              }}>
                {t('sidebar.discard_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {stashOpen && <StashModal onClose={() => setStashOpen(false)} />}
      {reflogOpen && <ReflogModal onClose={() => setReflogOpen(false)} />}
    </aside>
  )
}
