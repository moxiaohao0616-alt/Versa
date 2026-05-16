import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

function buildModeLabels(t: (k: string) => string): Record<ConflictMode, ModeLabels> {
  return {
    'merging': {
      title: t('conflict.merge_title'),
      abort: t('conflict.merge_abort'),
      continue: t('conflict.merge_continue'),
      banner: t('conflict.merge_banner'),
      abortDesc: t('conflict.merge_abort_desc'),
      continueDesc: t('conflict.merge_continue_desc'),
      needsMsg: true,
    },
    'rebasing': {
      title: t('conflict.rebase_title'),
      abort: t('conflict.rebase_abort'),
      continue: t('conflict.rebase_continue'),
      banner: t('conflict.rebase_banner'),
      abortDesc: t('conflict.rebase_abort_desc'),
      continueDesc: t('conflict.rebase_continue_desc'),
      needsMsg: false,
    },
    'reverting': {
      title: t('conflict.revert_title'),
      abort: t('conflict.revert_abort'),
      continue: t('conflict.revert_continue'),
      banner: t('conflict.revert_banner'),
      abortDesc: t('conflict.revert_abort_desc'),
      continueDesc: t('conflict.revert_continue_desc'),
      needsMsg: false,
    },
    'cherry-picking': {
      title: t('conflict.cherrypick_title'),
      abort: t('conflict.cherrypick_abort'),
      continue: t('conflict.cherrypick_continue'),
      banner: t('conflict.cherrypick_banner'),
      abortDesc: t('conflict.cherrypick_abort_desc'),
      continueDesc: t('conflict.cherrypick_continue_desc'),
      needsMsg: false,
    },
  }
}

export function ConflictView() {
  const { t } = useTranslation()
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

  const modeLabels = useMemo(() => buildModeLabels(t), [t])
  const mode = (repoStatus?.state as ConflictMode | undefined) ?? 'merging'
  const labels = modeLabels[mode] ?? modeLabels.merging

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
                ? t('conflict.pending_count', { n: pendingCount })
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
            title={allFilesResolved ? labels.continue : t('conflict.pending_unresolved')}
          >
            <i className="ti ti-check" />
            {labels.continue}
          </button>
        </div>
      </div>

      <div className="conflict-body">
        {/* Left: file rail */}
        <aside className="conflict-files">
          <div className="section-label">{t('conflict.section_files')}</div>
          {conflicts.length === 0 ? (
            <div className="empty-state center" style={{ padding: 16 }}>
              <i className="ti ti-circle-check" style={{ fontSize: 28, opacity: 0.2 }} />
              <p style={{ fontSize: 13 }}>{t('conflict.all_resolved')}</p>
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
                  ? <span className="conflict-file-binary">{t('conflict.binary_short')}</span>
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
              <p>{t('conflict.pick_a_file')}</p>
            </div>
          ) : (
            <>
              <div className="conflict-toolbar">
                <div className="conflict-toolbar-left">
                  <button className="ct-btn" onClick={goPrev} title={t('conflict.prev')} disabled={conflictContent.hunks.length === 0}>
                    <i className="ti ti-chevron-up" />
                  </button>
                  <span className="conflict-toolbar-pos">
                    {t('conflict.nth_of_total', {
                      n: conflictContent.hunks.length > 0 ? currentHunk + 1 : 0,
                      total: conflictContent.hunks.length,
                    })}
                    <span className="conflict-toolbar-decided"> · {t('conflict.decided', { n: decidedCount })}</span>
                  </span>
                  <button className="ct-btn" onClick={goNext} title={t('conflict.next')} disabled={conflictContent.hunks.length === 0}>
                    <i className="ti ti-chevron-down" />
                  </button>
                </div>

                <div className="conflict-choices">
                  <button className="ct-choice ours"
                    onClick={() => setChoice(currentHunk, 'ours')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'ours'}>
                    {t('conflict.use_ours')}
                  </button>
                  <button className="ct-choice theirs"
                    onClick={() => setChoice(currentHunk, 'theirs')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'theirs'}>
                    {t('conflict.use_theirs')}
                  </button>
                  <button className="ct-choice"
                    onClick={() => setChoice(currentHunk, 'both-ours-first')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'both-ours-first'}
                    title={t('conflict.use_both_tooltip')}>
                    {t('conflict.use_both')}
                  </button>
                  <button className="ct-choice"
                    onClick={() => setChoice(currentHunk, 'none')}
                    disabled={conflictContent.hunks.length === 0}
                    data-picked={choices[currentHunk] === 'none'}
                    title={t('conflict.use_neither_tooltip')}>
                    {t('conflict.use_neither')}
                  </button>
                </div>

                <div className="conflict-toolbar-right">
                  <button
                    className="ct-btn ai"
                    onClick={() => requestConflictSuggestion(currentHunk)}
                    disabled={aiConflictLoading || conflictContent.hunks.length === 0}
                    title={t('conflict.ai_help_tooltip')}
                  >
                    <i className={`ti ${aiConflictLoading ? 'ti-loader-2' : 'ti-sparkles'}`} />
                    {aiConflictLoading ? t('conflict.ai_analyzing') : t('conflict.ai_btn')}
                  </button>
                  <button
                    className="ct-btn ghost"
                    onClick={() => setShowPreview(v => !v)}
                    title={t('conflict.preview_tooltip')}
                  >
                    <i className={`ti ${showPreview ? 'ti-eye-off' : 'ti-eye'}`} />
                    {t('conflict.preview')}
                  </button>
                  <button className="btn-primary"
                    onClick={handleSaveFile}
                    disabled={!canSaveFile}
                    title={canSaveFile ? t('conflict.mark_resolved_tooltip_ok') : t('conflict.mark_resolved_tooltip_pending')}>
                    <i className="ti ti-device-floppy" />
                    {t('conflict.mark_resolved')}
                  </button>
                </div>
              </div>

              {aiConflictSuggestion && aiConflictSuggestion.hunkIdx === currentHunk && (
                <div className="ai-suggestion">
                  <div className="ai-suggestion-left">
                    <i className="ti ti-sparkles" />
                    <div>
                      <div className="ai-suggestion-title">
                        {t('conflict.ai_recommends')}{
                          aiConflictSuggestion.recommendation === 'ours' ? t('conflict.use_ours')
                          : aiConflictSuggestion.recommendation === 'theirs' ? t('conflict.use_theirs')
                          : t('conflict.use_both')
                        }
                      </div>
                      <div className="ai-suggestion-reason">{aiConflictSuggestion.reasoning}</div>
                    </div>
                  </div>
                  <div className="ai-suggestion-actions">
                    <button
                      className="ct-btn"
                      onClick={clearConflictSuggestion}
                      title={t('conflict.dismiss')}
                    >
                      <i className="ti ti-x" />
                      {t('conflict.dismiss')}
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
                      {t('conflict.accept')}
                    </button>
                  </div>
                </div>
              )}

              <div className="conflict-columns">
                <Column
                  side="ours"
                  title={t('conflict.ours_label')}
                  text={conflictContent.ours}
                  ranges={oursRanges}
                  currentHunk={currentHunk}
                  onClickHunk={setCurrentHunk}
                />
                <Column
                  side="base"
                  title={t('conflict.base_label')}
                  text={conflictContent.base ?? t('common.none')}
                  ranges={baseRanges}
                  currentHunk={-1}
                  onClickHunk={() => {}}
                />
                <Column
                  side="theirs"
                  title={t('conflict.theirs_label')}
                  text={conflictContent.theirs}
                  ranges={theirsRanges}
                  currentHunk={currentHunk}
                  onClickHunk={setCurrentHunk}
                />
              </div>

              {showPreview && (
                <div className="conflict-preview">
                  <div className="conflict-preview-title">
                    <i className="ti ti-file-check" /> {t('conflict.preview')}
                    {!allHunksDecided && (
                      <span className="conflict-preview-warn"> · {t('conflict.pending_unresolved')}</span>
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
              <button className="btn-secondary" onClick={() => setAbortModal(false)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleAbort}>{labels.abort}</button>
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
              <button className="btn-secondary" onClick={() => setContinueModal(false)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleContinue}>
                <i className="ti ti-check" />
                {labels.continue}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
