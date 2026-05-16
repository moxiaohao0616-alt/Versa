import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'
import { StashModal } from '../Stash'
import { ReflogModal } from '../Reflog'
import { GitProgressBar } from '../GitProgressBar'

export function Sidebar() {
  const {
    repoPath, repoStatus, selectedFile, selectedFileStaged,
    selectedCommit, commitFiles,
    commitMessage, selectFile, selectCommit,
    stageFile, unstageFile, discardFile,
    saveProgress, setCommitMessage, switchBranch, createBranch,
    pushBranch, pullBranch, fetchAll,
    generateCommitMessage, aiGenerating,
    gitProgress,
    stashes,
    viewAllInCommit,
  } = useStore()

  const [stashOpen, setStashOpen] = useState(false)
  const [reflogOpen, setReflogOpen] = useState(false)

  const [branchOpen, setBranchOpen] = useState(false)
  const [branches, setBranches] = useState<string[]>([])
  const [newBranchVisible, setNewBranchVisible] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const branchRef = useRef<HTMLDivElement>(null)
  const newBranchInputRef = useRef<HTMLInputElement>(null)

  const [pushing, setPushing] = useState(false)
  const [pulling, setPulling] = useState(false)
  const [fetching, setFetching] = useState(false)

  const [discardTarget, setDiscardTarget] = useState<string | null>(null)

  useEffect(() => {
    if (!branchOpen) return
    const handler = (e: MouseEvent) => {
      if (branchRef.current && !branchRef.current.contains(e.target as Node)) {
        setBranchOpen(false)
        setNewBranchVisible(false)
        setNewBranchName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [branchOpen])

  useEffect(() => {
    if (newBranchVisible) newBranchInputRef.current?.focus()
  }, [newBranchVisible])

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

  const { files, branch, ahead, behind } = repoStatus
  const stagedFiles = files.filter(f => f.stagedStatus)
  const unstagedFiles = files.filter(f => f.unstagedStatus)

  const handleBranchClick = async () => {
    if (!repoPath) return
    const list = await invoke<string[]>('get_branches', { path: repoPath })
    setBranches(list)
    setBranchOpen(v => !v)
    setNewBranchVisible(false)
    setNewBranchName('')
  }

  const handleSelectBranch = async (name: string) => {
    setBranchOpen(false)
    if (name !== branch) await switchBranch(name)
  }

  const handleCreateBranch = async () => {
    const name = newBranchName.trim()
    if (!name) return
    setBranchOpen(false)
    setNewBranchVisible(false)
    setNewBranchName('')
    await createBranch(name)
  }

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
      {/* 仓库头部 */}
      <div className="sidebar-header">
        <div className="repo-row">
          <span className="repo-dot" />
          <div className="repo-name-wrap">
            <span className="repo-name" title={repoStatus.path}>
              {repoStatus.path.split('/').pop()}
            </span>
          </div>
          <div className="branch-pill-wrap" ref={branchRef}>
            <button className="branch-pill" onClick={handleBranchClick}>
              {branch}
              <i className="ti ti-chevron-down" />
            </button>
            {branchOpen && (
              <div className="branch-dropdown">
                {branches.map(b => (
                  <button
                    key={b}
                    className={`branch-dropdown-item ${b === branch ? 'active' : ''}`}
                    onClick={() => handleSelectBranch(b)}
                  >
                    <i className="ti ti-git-branch" />
                    <span className="branch-dropdown-name">{b}</span>
                    {b === branch && <i className="ti ti-check" style={{ marginLeft: 'auto' }} />}
                  </button>
                ))}
                <div className="repo-dropdown-divider" />
                {newBranchVisible ? (
                  <div className="new-branch-row">
                    <i className="ti ti-git-branch" />
                    <input
                      ref={newBranchInputRef}
                      className="new-branch-input"
                      placeholder="分支名称"
                      value={newBranchName}
                      onChange={e => setNewBranchName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateBranch()
                        if (e.key === 'Escape') { setNewBranchVisible(false); setNewBranchName('') }
                      }}
                    />
                    <button className="new-branch-confirm" onClick={handleCreateBranch} disabled={!newBranchName.trim()}>
                      创建
                    </button>
                  </div>
                ) : (
                  <button className="branch-dropdown-item" onClick={() => setNewBranchVisible(true)}>
                    <i className="ti ti-plus" />
                    <span>新建分支</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="sync-row">
          <button className="btn-primary" onClick={handlePush} disabled={pushing}>
            <i className={`ti ${pushing ? 'ti-loader-2' : 'ti-cloud-upload'}`} />
            {pushing ? '推送中…' : '推送到云'}
            {ahead > 0 && <span className="badge">{ahead}</span>}
          </button>
          <button className="btn-icon" title="拉取并合并" onClick={handlePull} disabled={pulling}>
            <i className={`ti ${pulling ? 'ti-loader-2' : 'ti-download'}`} />
            {behind > 0 && <span className="badge warn">{behind}</span>}
          </button>
          <button
            className="btn-icon"
            title="只拉取远程引用（不合并）"
            onClick={async () => { setFetching(true); await fetchAll(false); setFetching(false) }}
            disabled={fetching}
          >
            <i className={`ti ${fetching ? 'ti-loader-2' : 'ti-refresh'}`} />
          </button>
          <button
            className="btn-icon"
            title="暂时搁置 / 已搁置列表"
            onClick={() => setStashOpen(true)}
          >
            <i className="ti ti-archive" />
            {stashes.length > 0 && <span className="badge">{stashes.length}</span>}
          </button>
          <button
            className="btn-icon"
            title="时光机 · 查看并回到任意一步"
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
            <button className="commit-context-clear" title="退出查看" onClick={() => selectCommit(null)}>
              <i className="ti ti-x" />
            </button>
          </div>

          {commitFiles.length > 0 && (
            <>
              <div className="section-label">提交变更 · {commitFiles.length} 个文件</div>
              <div className="file-list">
                <div
                  className={`file-item file-item-all ${selectedFile === null ? 'selected' : ''}`}
                  onClick={() => viewAllInCommit()}
                  title="把整个 commit 的所有文件改动汇总在右边看"
                >
                  <span className="fbadge status-all"><i className="ti ti-files" /></span>
                  <div className="file-info">
                    <span className="file-name">查看全部改动</span>
                    <span className="file-path">{commitFiles.length} 个文件汇总</span>
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
              <div className="section-label section-label-sep">工作区改动 · {files.length} 个文件</div>
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
                      <button className="file-action-btn" title="暂存"
                        onClick={e => { e.stopPropagation(); stageFile(f.path) }}>
                        <i className="ti ti-plus" />
                      </button>
                      {f.unstagedStatus !== '?' && (
                        <button className="file-action-btn danger" title="忽略更改"
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
              <p>工作区很干净</p>
              <span style={{ fontSize: 12 }}>没有未提交的改动</span>
            </div>
          ) : (
            <>
              {stagedFiles.length > 0 && (
                <>
                  <div className="section-label">已暂存 · {stagedFiles.length} 个文件</div>
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
                          <button className="file-action-btn" title="取消暂存"
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
                  <div className="section-label">未暂存 · {unstagedFiles.length} 个文件</div>
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
                          <button className="file-action-btn" title="暂存"
                            onClick={e => { e.stopPropagation(); stageFile(f.path) }}>
                            <i className="ti ti-plus" />
                          </button>
                          {f.unstagedStatus !== '?' && (
                            <button className="file-action-btn danger" title="忽略更改"
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
                  <span className="label">提交说明</span>
                  <button
                    className="ai-btn"
                    title="根据 staged diff 自动生成提交说明"
                    onClick={generateCommitMessage}
                    disabled={aiGenerating}
                  >
                    <i className={`ti ${aiGenerating ? 'ti-loader-2' : 'ti-sparkles'}`} />
                    {aiGenerating ? '生成中…' : 'AI 生成'}
                  </button>
                </div>
                <textarea
                  className="commit-input"
                  placeholder="描述这次改动了什么..."
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  rows={3}
                />
                <button
                  className="btn-primary full"
                  disabled={!commitMessage.trim() || stagedFiles.length === 0}
                  onClick={saveProgress}
                >
                  <i className="ti ti-device-floppy" />
                  {stagedFiles.length === 0 ? '请先暂存文件' : '保存进度'}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {discardTarget && (
        <div className="modal-overlay" onClick={() => setDiscardTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">放弃这个文件的改动？</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{discardTarget.split('/').pop()}</span>
                <span className="modal-commit-msg">{discardTarget}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                这会丢弃你对这个文件的所有未保存修改，此操作不可撤销。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDiscardTarget(null)}>取消</button>
              <button className="btn-primary" onClick={() => {
                const file = discardTarget
                setDiscardTarget(null)
                discardFile(file)
              }}>
                确认放弃
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
