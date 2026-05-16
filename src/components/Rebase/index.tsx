import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../../store'
import { GitProgressBar } from '../GitProgressBar'

interface RawCommit {
  id: string
  shortId: string
  message: string
  parents: string[]
}

type Action = 'pick' | 'fixup' | 'squash' | 'reword' | 'drop'

interface Row {
  sha: string
  shortId: string
  message: string
  action: Action
}

/** One entry per editor invocation that git will fire during rebase. */
interface EditorStep {
  /** Index of the row in `rows` whose action triggered this editor. */
  rowIdx: number
  kind: 'reword' | 'squash'
  /** Short SHAs of every commit whose message contributes (display only). */
  shortIds: string[]
}

const DEPTH_OPTIONS = [5, 10, 20, 30]

/** Walk the plan and emit one step per `reword` or `squash` in plan order —
 *  matches exactly how git fires GIT_EDITOR during interactive rebase. */
function editorStepsFor(rows: Row[]): EditorStep[] {
  const steps: EditorStep[] = []
  let groupShorts: string[] = []
  rows.forEach((r, i) => {
    if (r.action === 'drop') return
    if (r.action === 'pick') {
      groupShorts = [r.shortId]
    } else if (r.action === 'fixup') {
      groupShorts.push(r.shortId)
    } else if (r.action === 'reword') {
      // Standalone: one editor invocation for this commit alone. Also resets
      // the group — any fixup/squash that follows builds on the reworded msg.
      groupShorts = [r.shortId]
      steps.push({ rowIdx: i, kind: 'reword', shortIds: [r.shortId] })
    } else if (r.action === 'squash') {
      groupShorts.push(r.shortId)
      steps.push({ rowIdx: i, kind: 'squash', shortIds: [...groupShorts] })
    }
  })
  return steps
}

/**
 * Compute the default message that should appear in the editor for the row at
 * `rowIdx`. For squash, this incorporates any user-edited reword messages
 * earlier in the same group so the displayed default stays accurate.
 */
function defaultMsgFor(
  rowIdx: number,
  rows: Row[],
  edits: Record<number, string>,
): string {
  const r = rows[rowIdx]
  if (r.action === 'reword') {
    return r.message
  }
  if (r.action !== 'squash') return ''
  // Walk back to the most recent pick or reword (start of this squash group)
  let start = rowIdx
  while (start > 0 && rows[start].action !== 'pick' && rows[start].action !== 'reword') {
    start--
  }
  const msgs: string[] = []
  for (let i = start; i <= rowIdx; i++) {
    const ri = rows[i]
    if (ri.action === 'drop') continue
    if (ri.action === 'reword' && i !== rowIdx) {
      msgs.push(edits[i] ?? ri.message)
    } else {
      msgs.push(ri.message)
    }
  }
  return msgs.join('\n\n')
}

export function RebaseModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const { repoPath, showToast, gitProgress, refreshRepo } = useStore()
  const [depth, setDepth] = useState(10)
  const [rows, setRows] = useState<Row[]>([])
  const [baseSha, setBaseSha] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)

  /** 1 = plan editor, 2 = message editor for reword/squash entries */
  const [step, setStep] = useState<1 | 2>(1)
  /** User edits to messages, keyed by row index (for both reword and squash). */
  const [editorMsgs, setEditorMsgs] = useState<Record<number, string>>({})

  useEffect(() => {
    if (!repoPath) return
    let cancelled = false
    setLoading(true)
    invoke<RawCommit[]>('get_graph', { path: repoPath, limit: depth + 1 })
      .then(commits => {
        if (cancelled) return
        const scope = commits.slice(0, Math.min(depth, commits.length))
        const oldestFirst = scope.slice().reverse()
        setRows(oldestFirst.map(c => ({
          sha: c.id,
          shortId: c.shortId,
          message: c.message,
          action: 'pick' as Action,
        })))
        setBaseSha(commits.length > depth ? commits[depth].id : null)
        setLoading(false)
      })
      .catch(e => {
        if (cancelled) return
        setLoading(false)
        showToast(String(e), 'error')
      })
    return () => { cancelled = true }
  }, [repoPath, depth])

  const steps = useMemo(() => editorStepsFor(rows), [rows])

  // Drag-and-drop reorder state. Source is the row being dragged; over tracks
  // the current insertion target (which row, above-or-below).
  const [dragSource, setDragSource] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<{ idx: number; before: boolean } | null>(null)

  const moveRow = (from: number, to: number) => {
    if (from === to || from === to - 1) return  // no-op
    setRows(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      // Splice already removed `from`; adjust `to` if it was past it
      const adjusted = to > from ? to - 1 : to
      next.splice(adjusted, 0, item)
      return next
    })
  }

  const setAction = (idx: number, a: Action) => {
    if (running) return
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, action: a } : r))
  }

  const goToStep2 = () => {
    // Prune edits for rows that no longer need an editor; keep the rest as-is
    // so users don't lose work when bouncing between steps.
    setEditorMsgs(prev => {
      const next: Record<number, string> = {}
      const keepRows = new Set(steps.map(s => s.rowIdx))
      for (const k of Object.keys(prev)) {
        const ki = Number(k)
        if (keepRows.has(ki)) next[ki] = prev[ki]
      }
      return next
    })
    setStep(2)
  }

  const executePlan = async () => {
    if (!repoPath) return
    if (!baseSha) {
      showToast(t('rebase.err_no_start'), 'error')
      return
    }
    if (rows.length === 0) return

    const firstKeep = rows.find(r => r.action !== 'drop')
    if (firstKeep && firstKeep.action !== 'pick' && firstKeep.action !== 'reword') {
      showToast(t('rebase.err_first_must_pick'), 'error')
      return
    }

    // One message per editor step (reword + squash, in plan order)
    const messages = steps.map(s =>
      editorMsgs[s.rowIdx] ?? defaultMsgFor(s.rowIdx, rows, editorMsgs)
    )

    setRunning(true)
    try {
      await invoke('run_rebase', {
        path: repoPath,
        baseSha,
        plan: rows.map(r => ({ sha: r.sha, action: r.action, message: r.message })),
        editorMessages: messages,
      })
      showToast(t('rebase.success'), 'success')
      await refreshRepo()
      onClose()
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setRunning(false)
    }
  }

  const onClickExecute = () => {
    if (steps.length === 0) {
      executePlan()
    } else {
      goToStep2()
    }
  }

  const planSummary = (() => {
    const kept   = rows.filter(r => r.action === 'pick').length
    const reword = rows.filter(r => r.action === 'reword').length
    const fixed  = rows.filter(r => r.action === 'fixup').length
    const sq     = rows.filter(r => r.action === 'squash').length
    const droppd = rows.filter(r => r.action === 'drop').length
    const parts: string[] = []
    if (kept)   parts.push(t('rebase.summary_kept',    { n: kept }))
    if (reword) parts.push(t('rebase.summary_reword',  { n: reword }))
    if (fixed)  parts.push(t('rebase.summary_fixup',   { n: fixed }))
    if (sq)     parts.push(t('rebase.summary_squash',  { n: sq }))
    if (droppd) parts.push(t('rebase.summary_dropped', { n: droppd }))
    return parts.join(' · ') || t('rebase.summary_none')
  })()

  return (
    <div className="modal-overlay" onClick={running ? undefined : onClose}>
      <div className="modal rebase-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          {step === 1 ? t('rebase.title_arrange') : t('rebase.title_edit_msgs', { n: steps.length })}
        </div>
        <div className="modal-body">
          {step === 1 ? (
            <>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                {t('rebase.warn')}
              </p>

              <div className="rebase-controls">
                <label className="rebase-depth">
                  <span>{t('rebase.range_label')}</span>
                  <select
                    value={depth}
                    onChange={e => setDepth(Number(e.target.value))}
                    disabled={running}
                  >
                    {DEPTH_OPTIONS.map(n => <option key={n} value={n}>{t('rebase.range_option', { n })}</option>)}
                  </select>
                </label>
                <span className="rebase-summary">{planSummary}</span>
              </div>

              {loading ? (
                <div className="empty-state center" style={{ padding: 24 }}>
                  <i className="ti ti-loader-2" /> <span style={{ marginLeft: 6 }}>{t('rebase.loading_commits')}</span>
                </div>
              ) : rows.length === 0 ? (
                <div className="empty-state center" style={{ padding: 24 }}>
                  {t('rebase.no_commits_to_arrange')}
                </div>
              ) : (
                <div
                  className="rebase-list"
                  onDragLeave={e => {
                    // Clear the indicator only if the pointer truly left the list,
                    // not when crossing into a child row.
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                      setDragOver(null)
                    }
                  }}
                >
                  {rows.map((r, idx) => {
                    const isSource = dragSource === idx
                    const isOver   = dragOver?.idx === idx
                    const cls = [
                      'rebase-row',
                      `action-${r.action}`,
                      isSource && 'dragging',
                      isOver && (dragOver!.before ? 'drag-before' : 'drag-after'),
                    ].filter(Boolean).join(' ')
                    return (
                      <div
                        key={r.sha}
                        className={cls}
                        onDragOver={e => {
                          if (dragSource === null || running) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          const rect = e.currentTarget.getBoundingClientRect()
                          const before = e.clientY < rect.top + rect.height / 2
                          if (!isOver || dragOver!.before !== before) {
                            setDragOver({ idx, before })
                          }
                        }}
                        onDrop={e => {
                          if (dragSource === null) return
                          e.preventDefault()
                          const target = dragOver
                            ? (dragOver.before ? dragOver.idx : dragOver.idx + 1)
                            : idx + 1
                          moveRow(dragSource, target)
                          setDragSource(null)
                          setDragOver(null)
                        }}
                      >
                        <span
                          className="rebase-drag-handle"
                          title={t('rebase.drag_to_reorder')}
                          draggable={!running}
                          onDragStart={e => {
                            e.dataTransfer.effectAllowed = 'move'
                            // Drag the whole row visually, not just the handle
                            const row = (e.currentTarget as HTMLElement).closest('.rebase-row')
                            if (row) e.dataTransfer.setDragImage(row as Element, 12, 12)
                            setDragSource(idx)
                          }}
                          onDragEnd={() => {
                            setDragSource(null)
                            setDragOver(null)
                          }}
                        >
                          <i className="ti ti-grip-vertical" />
                        </span>
                        <select
                          className="rebase-action"
                          value={r.action}
                          onChange={e => setAction(idx, e.target.value as Action)}
                          disabled={running}
                        >
                          <option value="pick">{t('rebase.action_pick')}</option>
                          <option value="reword">{t('rebase.action_reword')}</option>
                          <option value="fixup" disabled={idx === 0}>{t('rebase.action_fixup')}</option>
                          <option value="squash" disabled={idx === 0}>{t('rebase.action_squash')}</option>
                          <option value="drop">{t('rebase.action_drop')}</option>
                        </select>
                        <span className="rebase-sha">{r.shortId}</span>
                        <span className="rebase-msg" title={r.message}>{r.message}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 12 }}>
                {t('rebase.edit_step_intro', { n: steps.length })}
              </p>
              <div className="squash-msg-list">
                {steps.map((s, i) => {
                  const label  = s.kind === 'reword' ? t('rebase.step_reword') : t('rebase.step_squash')
                  const cls    = s.kind === 'reword' ? 'reword' : 'squash'
                  const current = editorMsgs[s.rowIdx] ?? defaultMsgFor(s.rowIdx, rows, editorMsgs)
                  return (
                    <div key={s.rowIdx} className="squash-msg-block">
                      <div className="squash-msg-head">
                        <span className={`squash-msg-num kind-${cls}`}>
                          {label} #{i + 1}
                        </span>
                        <span className="squash-msg-shorts">
                          {s.shortIds.join(' + ')}
                        </span>
                      </div>
                      <textarea
                        className="commit-input squash-msg-input"
                        rows={s.kind === 'reword' ? 3 : 5}
                        value={current}
                        onChange={e => setEditorMsgs(prev => ({
                          ...prev,
                          [s.rowIdx]: e.target.value,
                        }))}
                        disabled={running}
                      />
                    </div>
                  )
                })}
              </div>
            </>
          )}

          {running && gitProgress?.phase === 'rebase' && (
            <div style={{ marginTop: 12 }}>
              <GitProgressBar progress={gitProgress} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          {step === 2 && (
            <button
              className="btn-secondary"
              onClick={() => setStep(1)}
              disabled={running}
              style={{ marginRight: 'auto' }}
            >
              <i className="ti ti-chevron-left" />
              {t('rebase.btn_back')}
            </button>
          )}
          <button className="btn-secondary" onClick={onClose} disabled={running}>{t('common.cancel')}</button>
          <button
            className="btn-primary"
            onClick={step === 1 ? onClickExecute : executePlan}
            disabled={running || rows.length === 0 || !baseSha}
          >
            <i className={`ti ${running ? 'ti-loader-2' : 'ti-stack-2'}`} />
            {running
              ? t('rebase.btn_running')
              : step === 1
                ? (steps.length > 0 ? t('rebase.btn_next_edit') : t('rebase.btn_run'))
                : t('rebase.btn_run')}
          </button>
        </div>
      </div>
    </div>
  )
}
