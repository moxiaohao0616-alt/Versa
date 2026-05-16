import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../store'

type Choice = 'ours' | 'theirs' | 'both-ours-first' | 'both-theirs-first' | 'none' | null

interface WorkdirSegment {
  /** 'common' segment outside any conflict, or 'hunk' segment with ours/theirs alternatives */
  type: 'common' | 'hunk'
  /** lines for 'common' segments */
  lines?: string[]
  /** index of this hunk in the parallel ConflictContent.hunks array (only for 'hunk') */
  hunkIdx?: number
  /** ours-side lines inside this hunk (only for 'hunk') */
  ours?: string[]
  /** theirs-side lines (only for 'hunk') */
  theirs?: string[]
}

function parseWorkdir(workdir: string): WorkdirSegment[] {
  const segments: WorkdirSegment[] = []
  let commonBuf: string[] = []
  let oursBuf: string[] = []
  let theirsBuf: string[] = []
  let mode: 'common' | 'ours' | 'base' | 'theirs' = 'common'
  let hunkIdx = 0

  const flushCommon = () => {
    if (commonBuf.length > 0) {
      segments.push({ type: 'common', lines: commonBuf })
      commonBuf = []
    }
  }

  for (const line of workdir.split('\n')) {
    if (line.startsWith('<<<<<<<')) {
      flushCommon()
      oursBuf = []
      theirsBuf = []
      mode = 'ours'
    } else if (line.startsWith('|||||||')) {
      mode = 'base'
    } else if (line.startsWith('=======') && mode !== 'common') {
      mode = 'theirs'
    } else if (line.startsWith('>>>>>>>')) {
      segments.push({
        type: 'hunk',
        hunkIdx,
        ours: oursBuf,
        theirs: theirsBuf,
      })
      hunkIdx += 1
      mode = 'common'
    } else {
      if (mode === 'common') commonBuf.push(line)
      else if (mode === 'ours') oursBuf.push(line)
      else if (mode === 'theirs') theirsBuf.push(line)
      // base mode: skip (diff3 ancestor)
    }
  }
  flushCommon()
  return segments
}

function buildMerged(segments: WorkdirSegment[], choices: (Choice)[]): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.type === 'common') {
      out.push(...(seg.lines ?? []))
    } else {
      const choice = choices[seg.hunkIdx!]
      const ours = seg.ours ?? []
      const theirs = seg.theirs ?? []
      switch (choice) {
        case 'ours':              out.push(...ours); break
        case 'theirs':            out.push(...theirs); break
        case 'both-ours-first':   out.push(...ours, ...theirs); break
        case 'both-theirs-first': out.push(...theirs, ...ours); break
        case 'none':              /* drop entirely */ break
        default:
          // Undecided — keep conflict markers verbatim so the file is still
          // recognizably conflicted and we never let it slip through to commit.
          out.push('<<<<<<< HEAD')
          out.push(...ours)
          out.push('=======')
          out.push(...theirs)
          out.push('>>>>>>>')
      }
    }
  }
  return out.join('\n')
}

interface ColumnProps {
  side: 'ours' | 'base' | 'theirs'
  title: string
  text: string
  ranges: { start: number; end: number; hunkIdx: number }[]
  currentHunk: number
  onClickHunk: (hunkIdx: number) => void
}

function Column({ side, title, text, ranges, currentHunk, onClickHunk }: ColumnProps) {
  const lines = useMemo(() => text.split('\n'), [text])
  const containerRef = useRef<HTMLDivElement>(null)

  // Map line number → hunkIdx for quick lookup
  const lineToHunk = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of ranges) {
      for (let ln = r.start; ln < r.end; ln++) m.set(ln, r.hunkIdx)
    }
    return m
  }, [ranges])

  // Scroll current hunk into view
  useEffect(() => {
    if (currentHunk < 0) return
    const target = ranges.find(r => r.hunkIdx === currentHunk)
    if (!target || !containerRef.current) return
    const el = containerRef.current.querySelector<HTMLElement>(
      `[data-line="${target.start}"]`
    )
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentHunk, ranges])

  return (
    <div className={`conflict-column conflict-column-${side}`}>
      <div className="conflict-column-title">{title}</div>
      <div className="conflict-column-body" ref={containerRef}>
        {lines.map((line, i) => {
          const lineNo = i + 1
          const hunk = lineToHunk.get(lineNo)
          const isHunk = hunk !== undefined
          const isCurrent = hunk === currentHunk
          return (
            <div
              key={i}
              data-line={lineNo}
              className={
                'conflict-line' +
                (isHunk ? ` hunk-${side}` : '') +
                (isCurrent ? ' current' : '')
              }
              onClick={isHunk ? () => onClickHunk(hunk!) : undefined}
            >
              <span className="ln">{lineNo}</span>
              <span className="code">{line || ' '}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type ConflictMode = 'merging' | 'rebasing' | 'reverting' | 'cherry-picking'

interface ModeLabels {
  title: string
  abort: string
  continue: string
  banner: string
  abortDesc: string
  continueDesc: string
  /** Continue requires a commit message input (only true for merge). */
  needsMsg: boolean
}

const MODE_LABELS: Record<ConflictMode, ModeLabels> = {
  'merging': {
    title: '合并冲突',
    abort: '放弃合并',
    continue: '完成合并',
    banner: '所有冲突已解决，可以完成合并',
    abortDesc: '所有未解决的冲突和已采纳的选择都会被丢弃，工作区回到合并前的状态。',
    continueDesc: '给这次合并写一段说明：',
    needsMsg: true,
  },
  'rebasing': {
    title: 'Rebase 中有冲突',
    abort: '放弃 rebase',
    continue: '继续 rebase',
    banner: '所有冲突已解决，可以继续 rebase',
    abortDesc: '所有未解决的冲突和已应用的提交都会被回滚，分支回到 rebase 前的状态。',
    continueDesc: '应用这段已解决的冲突，然后继续后面的提交。如果接下来还有冲突，会再次停在这里。',
    needsMsg: false,
  },
  'reverting': {
    title: '撤销中有冲突',
    abort: '放弃撤销',
    continue: '继续撤销',
    banner: '所有冲突已解决，可以完成撤销',
    abortDesc: '撤销过程的所有改动会被丢弃，工作区回到撤销前的状态。',
    continueDesc: '应用这段已解决的冲突，完成这次撤销提交。',
    needsMsg: false,
  },
  'cherry-picking': {
    title: '拣选中有冲突',
    abort: '放弃拣选',
    continue: '继续拣选',
    banner: '所有冲突已解决，可以完成拣选',
    abortDesc: '拣选过程的所有改动会被丢弃，工作区回到拣选前的状态。',
    continueDesc: '应用这段已解决的冲突，完成这次拣选提交。',
    needsMsg: false,
  },
}

export function ConflictView() {
  const {
    repoStatus,
    conflicts,
    selectedConflictFile,
    conflictContent,
    loadConflicts,
    selectConflictFile,
    resolveConflict,
    abortMerge,    continueMerge,
    abortRebase,   continueRebase,
    abortRevert,   continueRevert,
    abortCherryPick, continueCherryPick,
    aiConflictSuggestion,
    aiConflictLoading,
    requestConflictSuggestion,
    clearConflictSuggestion,
  } = useStore()

  const mode = (repoStatus?.state as ConflictMode | undefined) ?? 'merging'
  const labels = MODE_LABELS[mode] ?? MODE_LABELS.merging

  const [abortModal, setAbortModal] = useState(false)
  const [continueModal, setContinueModal] = useState(false)
  const [commitMsg, setCommitMsg] = useState('')
  const [showPreview, setShowPreview] = useState(false)

  // Per-file UI state. Keyed by file path so switching back restores choices.
  const [choicesByFile, setChoicesByFile] = useState<Record<string, Choice[]>>({})
  const [hunkIdxByFile, setHunkIdxByFile] = useState<Record<string, number>>({})

  useEffect(() => {
    loadConflicts()
  }, [repoStatus?.path])

  // Clear any pending AI suggestion when the user moves to a different file
  useEffect(() => {
    clearConflictSuggestion()
  }, [selectedConflictFile])

  // Initialize choices for current file when its content arrives
  useEffect(() => {
    if (!selectedConflictFile || !conflictContent) return
    setChoicesByFile(prev => {
      if (prev[selectedConflictFile]) return prev
      return {
        ...prev,
        [selectedConflictFile]: new Array(conflictContent.hunks.length).fill(null),
      }
    })
    setHunkIdxByFile(prev =>
      prev[selectedConflictFile] !== undefined ? prev : { ...prev, [selectedConflictFile]: 0 }
    )
  }, [selectedConflictFile, conflictContent])

  if (!repoStatus) return null

  const pendingCount = conflicts.length
  const allFilesResolved = pendingCount === 0

  const choices: Choice[] = selectedConflictFile
    ? choicesByFile[selectedConflictFile] ?? []
    : []
  const currentHunk: number = selectedConflictFile
    ? hunkIdxByFile[selectedConflictFile] ?? 0
    : 0

  const setCurrentHunk = (idx: number) => {
    if (!selectedConflictFile) return
    setHunkIdxByFile(prev => ({ ...prev, [selectedConflictFile]: idx }))
  }

  const setChoice = (idx: number, choice: Choice) => {
    if (!selectedConflictFile || !conflictContent) return
    const next = [...choices]
    next[idx] = choice
    setChoicesByFile(prev => ({ ...prev, [selectedConflictFile]: next }))
    // Auto-advance to next undecided hunk
    const nextUndecided = next.findIndex((c, i) => i > idx && c === null)
    if (nextUndecided !== -1) setCurrentHunk(nextUndecided)
  }

  const segments = useMemo(
    () => (conflictContent ? parseWorkdir(conflictContent.workdir) : []),
    [conflictContent]
  )
  const mergedContent = useMemo(
    () => buildMerged(segments, choices),
    [segments, choices]
  )
  const allHunksDecided =
    !!conflictContent &&
    choices.length === conflictContent.hunks.length &&
    choices.every(c => c !== null)
  const mergedHasNoMarkers = !/^(?:<{7}|={7}|>{7})/m.test(mergedContent)
  const canSaveFile = allHunksDecided && mergedHasNoMarkers

  const handleAbort = async () => {
    setAbortModal(false)
    switch (mode) {
      case 'merging':        await abortMerge();      break
      case 'rebasing':       await abortRebase();     break
      case 'reverting':      await abortRevert();     break
      case 'cherry-picking': await abortCherryPick(); break
    }
  }

  const handleContinue = async () => {
    setContinueModal(false)
    switch (mode) {
      case 'merging': {
        const msg = commitMsg.trim() || `Merge into ${repoStatus.branch}`
        setCommitMsg('')
        await continueMerge(msg)
        break
      }
      case 'rebasing':       await continueRebase();     break
      case 'reverting':      await continueRevert();     break
      case 'cherry-picking': await continueCherryPick(); break
    }
  }

  const handleSaveFile = async () => {
    if (!selectedConflictFile || !canSaveFile) return
    await resolveConflict(selectedConflictFile, mergedContent)
    // Clear local state for this file once it's resolved
    setChoicesByFile(prev => {
      const next = { ...prev }
      delete next[selectedConflictFile]
      return next
    })
    setHunkIdxByFile(prev => {
      const next = { ...prev }
      delete next[selectedConflictFile]
      return next
    })
  }

  const goPrev = () => {
    if (!conflictContent || conflictContent.hunks.length === 0) return
    const n = conflictContent.hunks.length
    setCurrentHunk((currentHunk - 1 + n) % n)
  }
  const goNext = () => {
    if (!conflictContent || conflictContent.hunks.length === 0) return
    const n = conflictContent.hunks.length
    setCurrentHunk((currentHunk + 1) % n)
  }

  // Ranges for each column to highlight
  const oursRanges = (conflictContent?.hunks ?? []).map((h, i) => ({
    start: h.oursStart, end: h.oursEnd, hunkIdx: i,
  }))
  const theirsRanges = (conflictContent?.hunks ?? []).map((h, i) => ({
    start: h.theirsStart, end: h.theirsEnd, hunkIdx: i,
  }))
  const baseRanges: { start: number; end: number; hunkIdx: number }[] = [] // no line alignment yet

  const decidedCount = choices.filter(c => c !== null).length

  return (
    <div className="conflict-view">
      {/* Top warning banner */}
      <div className="conflict-banner">
        <div className="conflict-banner-left">
          <i className="ti ti-alert-triangle" />
          <div className="conflict-banner-text">
            <span className="conflict-banner-title">{labels.title}</span>
            <span className="conflict-banner-meta">
              {pendingCount > 0
                ? `还有 ${pendingCount} 个文件待解决`
                : labels.banner}
            </span>
          </div>
        </div>
        <div className="conflict-banner-actions">
          <button className="btn-secondary" onClick={() => setAbortModal(true)}>
            <i className="ti ti-x" />
            {labels.abort}
          </button>
          <button
            className="btn-primary"
            disabled={!allFilesResolved}
            onClick={() => setContinueModal(true)}
            title={allFilesResolved ? labels.continue : '还有冲突未解决'}
          >
            <i className="ti ti-check" />
            {labels.continue}
          </button>
        </div>
      </div>

      <div className="conflict-body">
        {/* Left: file rail */}
        <aside className="conflict-files">
          <div className="section-label">冲突文件</div>
          {conflicts.length === 0 ? (
            <div className="empty-state center" style={{ padding: 16 }}>
              <i className="ti ti-circle-check" style={{ fontSize: 28, opacity: 0.2 }} />
              <p style={{ fontSize: 13 }}>所有冲突已解决</p>
            </div>
          ) : (
            conflicts.map(c => (
              <button
                key={c.path}
                className={`conflict-file-item ${selectedConflictFile === c.path ? 'selected' : ''}`}
                onClick={() => selectConflictFile(c.path)}
                title={c.path}
              >
                <i className="ti ti-alert-circle conflict-file-pending" />
                <div className="conflict-file-info">
                  <span className="conflict-file-name">{c.path.split('/').pop()}</span>
                  <span className="conflict-file-path">{c.path.split('/').slice(0, -1).join('/')}</span>
                </div>
                {c.isBinary
                  ? <span className="conflict-file-binary">二进制</span>
                  : <span className="conflict-file-count">{c.hunkCount}</span>
                }
              </button>
            ))
          )}
        </aside>

        {/* Right: three-column area */}
        <main className="conflict-main">
          {!selectedConflictFile || !conflictContent ? (
            <div className="empty-state center">
              <i className="ti ti-git-merge" style={{ fontSize: 40, opacity: 0.2 }} />
              <p>选择左侧文件开始解决冲突</p>
            </div>
          ) : (
            <>
              <div className="conflict-toolbar">
                <div className="conflict-toolbar-left">
                  <button className="ct-btn" onClick={goPrev} title="上一处" disabled={conflictContent.hunks.length === 0}>
                    <i className="ti ti-chevron-up" />
                  </button>
                  <span className="conflict-toolbar-pos">
                    第 {conflictContent.hunks.length > 0 ? currentHunk + 1 : 0} / {conflictContent.hunks.length} 处
                    <span className="conflict-toolbar-decided"> · 已决定 {decidedCount}</span>
                  </span>
                  <button className="ct-btn" onClick={goNext} title="下一处" disabled={conflictContent.hunks.length === 0}>
                    <i className="ti ti-chevron-down" />
                  </button>
                </div>

                <div className="conflict-choices">
                  <button className="ct-choice ours"
                    onClick={() => setChoice(currentHunk, 'ours')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'ours'}>
                    用我的
                  </button>
                  <button className="ct-choice theirs"
                    onClick={() => setChoice(currentHunk, 'theirs')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'theirs'}>
                    用对方的
                  </button>
                  <button className="ct-choice"
                    onClick={() => setChoice(currentHunk, 'both-ours-first')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'both-ours-first'}
                    title="先我的，再对方的">
                    都要
                  </button>
                  <button className="ct-choice"
                    onClick={() => setChoice(currentHunk, 'none')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'none'}
                    title="两边都不要，整段删除">
                    都不要
                  </button>
                </div>

                <div className="conflict-toolbar-right">
                  <button
                    className="ct-btn ai"
                    onClick={() => requestConflictSuggestion(currentHunk)}
                    disabled={aiConflictLoading || conflictContent.hunks.length === 0}
                    title="让 AI 分析这段冲突并给建议"
                  >
                    <i className={`ti ${aiConflictLoading ? 'ti-loader-2' : 'ti-sparkles'}`} />
                    {aiConflictLoading ? '分析中…' : 'AI 建议'}
                  </button>
                  <button
                    className="ct-btn ghost"
                    onClick={() => setShowPreview(v => !v)}
                    title="切换合并结果预览"
                  >
                    <i className={`ti ${showPreview ? 'ti-eye-off' : 'ti-eye'}`} />
                    预览
                  </button>
                  <button className="btn-primary"
                    onClick={handleSaveFile}
                    disabled={!canSaveFile}
                    title={canSaveFile ? '保存为已解决' : '所有冲突段都要先决定'}>
                    <i className="ti ti-device-floppy" />
                    标记为已解决
                  </button>
                </div>
              </div>

              {aiConflictSuggestion && aiConflictSuggestion.hunkIdx === currentHunk && (
                <div className="ai-suggestion">
                  <div className="ai-suggestion-left">
                    <i className="ti ti-sparkles" />
                    <div>
                      <div className="ai-suggestion-title">
                        AI 推荐：{
                          aiConflictSuggestion.recommendation === 'ours' ? '用我的'
                          : aiConflictSuggestion.recommendation === 'theirs' ? '用对方的'
                          : '两边都要'
                        }
                      </div>
                      <div className="ai-suggestion-reason">{aiConflictSuggestion.reasoning}</div>
                    </div>
                  </div>
                  <div className="ai-suggestion-actions">
                    <button
                      className="ct-btn"
                      onClick={clearConflictSuggestion}
                      title="忽略"
                    >
                      <i className="ti ti-x" />
                      忽略
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => {
                        const rec = aiConflictSuggestion.recommendation
                        setChoice(
                          currentHunk,
                          rec === 'both' ? 'both-ours-first' : rec
                        )
                        clearConflictSuggestion()
                      }}
                    >
                      <i className="ti ti-check" />
                      采纳
                    </button>
                  </div>
                </div>
              )}

              <div className="conflict-columns">
                <Column
                  side="ours"
                  title="我的改动 (HEAD)"
                  text={conflictContent.ours}
                  ranges={oursRanges}
                  currentHunk={currentHunk}
                  onClickHunk={setCurrentHunk}
                />
                <Column
                  side="base"
                  title="原始版本 (共同祖先)"
                  text={conflictContent.base ?? '(没有共同祖先)'}
                  ranges={baseRanges}
                  currentHunk={-1}
                  onClickHunk={() => {}}
                />
                <Column
                  side="theirs"
                  title="对方改动 (MERGE_HEAD)"
                  text={conflictContent.theirs}
                  ranges={theirsRanges}
                  currentHunk={currentHunk}
                  onClickHunk={setCurrentHunk}
                />
              </div>

              {showPreview && (
                <div className="conflict-preview">
                  <div className="conflict-preview-title">
                    <i className="ti ti-file-check" /> 合并结果预览
                    {!allHunksDecided && (
                      <span className="conflict-preview-warn"> · 仍含未决定的冲突段</span>
                    )}
                  </div>
                  <pre className="conflict-preview-body">{mergedContent}</pre>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {/* Abort modal */}
      {abortModal && (
        <div className="modal-overlay" onClick={() => setAbortModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{labels.abort}？</div>
            <div className="modal-body">
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                {labels.abortDesc}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setAbortModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleAbort}>确认放弃</button>
            </div>
          </div>
        </div>
      )}

      {/* Continue modal — only merge needs a message input; others just confirm. */}
      {continueModal && (
        <div className="modal-overlay" onClick={() => setContinueModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{labels.continue}</div>
            <div className="modal-body">
              {labels.needsMsg ? (
                <>
                  <p style={{ marginBottom: 8 }}>{labels.continueDesc}</p>
                  <textarea
                    className="commit-input"
                    placeholder={`Merge into ${repoStatus.branch}`}
                    value={commitMsg}
                    onChange={e => setCommitMsg(e.target.value)}
                    rows={3}
                    autoFocus
                  />
                </>
              ) : (
                <p style={{ marginBottom: 8 }}>{labels.continueDesc}</p>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setContinueModal(false)}>取消</button>
              <button className="btn-primary" onClick={handleContinue}>
                <i className="ti ti-check" />
                {labels.needsMsg ? '提交合并' : '继续'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
