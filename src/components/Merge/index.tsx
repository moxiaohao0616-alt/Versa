import { useEffect, useMemo, useState } from 'react'
import { useStore, type MergeAnalysis, type MergeRiskReport, type FileRisk } from '../../store'

interface Props {
  target: string
  onClose: () => void
}

export function MergeModal({ target, onClose }: Props) {
  const { repoStatus, analyzeMerge, aiAnalyzeMergeRisk, mergeBranch, showToast } = useStore()
  const [analysis, setAnalysis] = useState<MergeAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aiReport, setAiReport] = useState<MergeRiskReport | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [merging, setMerging] = useState(false)

  // Deep-dive AI analysis per file. Expand one at a time, cache results.
  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [fileAnalysis, setFileAnalysis] = useState<Record<string, string>>({})
  const [fileLoadingFor, setFileLoadingFor] = useState<string | null>(null)
  const { aiAnalyzeFileConflict } = useStore()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    analyzeMerge(target)
      .then(a => { if (!cancelled) setAnalysis(a) })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [target])

  const handleAskAI = async () => {
    setAiLoading(true)
    try {
      const r = await aiAnalyzeMergeRisk(target)
      setAiReport(r)
    } catch (e) {
      showToast(String(e), 'error')
    } finally {
      setAiLoading(false)
    }
  }

  const handleMerge = async () => {
    setMerging(true)
    await mergeBranch(target)
    setMerging(false)
    onClose()
  }

  const toggleFile = async (file: string) => {
    if (expandedFile === file) {
      setExpandedFile(null)
      return
    }
    setExpandedFile(file)
    if (fileAnalysis[file] !== undefined) return  // cached
    setFileLoadingFor(file)
    try {
      const text = await aiAnalyzeFileConflict(target, file, acc => {
        // Stream deltas into the same key; UI re-renders as text grows.
        setFileAnalysis(prev => ({ ...prev, [file]: acc }))
      })
      setFileAnalysis(prev => ({ ...prev, [file]: text.trim() }))
    } catch (e) {
      showToast(String(e), 'error')
      setExpandedFile(prev => prev === file ? null : prev)
    } finally {
      setFileLoadingFor(prev => prev === file ? null : prev)
    }
  }

  // Map AI's per-file risk back to the shared-files list for inline rendering
  const riskMap = useMemo(() => {
    const m = new Map<string, FileRisk>()
    if (aiReport) for (const f of aiReport.files) m.set(f.path, f)
    return m
  }, [aiReport])

  const current = analysis?.current || repoStatus?.branch || 'HEAD'

  return (
    <div className="modal-overlay" onClick={merging ? undefined : onClose}>
      <div className="modal merge-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          合并 <span className="merge-branch-pill">{target}</span>
          {' → '}
          <span className="merge-branch-pill current">{current}</span>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="empty-state center" style={{ padding: 20 }}>
              <i className="ti ti-loader-2" /> <span style={{ marginLeft: 6 }}>分析合并范围…</span>
            </div>
          ) : error ? (
            <p className="modal-warn">
              <i className="ti ti-alert-triangle" />
              {error}
            </p>
          ) : analysis ? (
            <AnalysisContent
              analysis={analysis}
              riskMap={riskMap}
              expandedFile={expandedFile}
              fileAnalysis={fileAnalysis}
              fileLoadingFor={fileLoadingFor}
              onToggleFile={toggleFile}
            />
          ) : null}

          {analysis && !analysis.alreadyMerged && analysis.targetCommits > 0 && (
            <div className="merge-ai-section">
              <div className="merge-ai-head">
                <i className="ti ti-sparkles" />
                <span>AI 风险分析</span>
                {aiReport && !aiLoading && (
                  <button
                    className="commit-explain-redo"
                    onClick={handleAskAI}
                    title="再问一次"
                  >
                    <i className="ti ti-refresh" />
                    重新分析
                  </button>
                )}
              </div>
              {aiLoading ? (
                <div className="merge-ai-loading">
                  <i className="ti ti-loader-2" />
                  <span>AI 正在分析两边的改动…</span>
                </div>
              ) : aiReport ? (
                <p className="merge-ai-text">{aiReport.overall}</p>
              ) : (
                <button
                  className="commit-explain-btn"
                  onClick={handleAskAI}
                  style={{ marginTop: 4 }}
                  title="发送两边的 diff 让 AI 找出冲突隐患"
                >
                  <i className="ti ti-sparkles" />
                  用 AI 分析合并风险
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={merging}>取消</button>
          <button
            className="btn-primary"
            disabled={
              merging || loading || !analysis ||
              analysis.alreadyMerged || analysis.targetCommits === 0
            }
            onClick={handleMerge}
            title={
              analysis?.alreadyMerged ? '已经合并过了，不用再合'
                : analysis && analysis.canFastForward ? '快进合并（无冲突）'
                : '执行合并'
            }
          >
            <i className={`ti ${merging ? 'ti-loader-2' : 'ti-git-merge'}`} />
            {merging ? '合并中…'
              : (analysis?.canFastForward ? '快进合并' : '确认合并')}
          </button>
        </div>
      </div>
    </div>
  )
}

const RISK_LABEL: Record<FileRisk['risk'], string> = {
  high:   '高风险',
  medium: '中等风险',
  low:    '低风险',
}

function AnalysisContent({
  analysis, riskMap,
  expandedFile, fileAnalysis, fileLoadingFor, onToggleFile,
}: {
  analysis: MergeAnalysis
  riskMap: Map<string, FileRisk>
  expandedFile: string | null
  fileAnalysis: Record<string, string>
  fileLoadingFor: string | null
  onToggleFile: (file: string) => void
}) {
  if (analysis.alreadyMerged) {
    return (
      <p style={{ fontSize: 13 }}>
        <i className="ti ti-circle-check" style={{ color: 'var(--green)' }} />
        {' '}
        <strong>{analysis.target}</strong> 已经合并到 <strong>{analysis.current}</strong>，不用再合一次。
      </p>
    )
  }
  if (analysis.targetCommits === 0) {
    return (
      <p style={{ fontSize: 13 }}>
        <strong>{analysis.target}</strong> 没有新的提交可合并进来。
      </p>
    )
  }
  return (
    <>
      <p className="merge-summary">
        {analysis.canFastForward ? (
          <>
            <i className="ti ti-arrow-right" style={{ color: 'var(--green)' }} />
            {' '}<strong>快进合并</strong>：
            把 <strong>{analysis.current}</strong> 直接前进到 <strong>{analysis.target}</strong>
            （{analysis.targetCommits} 个提交，没有任何冲突可能）。
          </>
        ) : (
          <>
            <strong>{analysis.target}</strong> 有 {analysis.targetCommits} 个新提交，
            会动到 {analysis.incomingFiles.length} 个文件。
          </>
        )}
      </p>

      {!analysis.canFastForward && analysis.sharedFiles.length > 0 && (
        <div className="merge-shared">
          <div className="merge-shared-head">
            <i className="ti ti-alert-triangle" />
            <span>{analysis.sharedFiles.length} 个文件双方都改了</span>
            {riskMap.size > 0 && (
              <span className="merge-shared-legend">
                AI 已染色
              </span>
            )}
          </div>
          <ul className="merge-shared-list">
            {analysis.sharedFiles.slice(0, 12).map(p => {
              const r = riskMap.get(p)
              const isExpanded = expandedFile === p
              const isLoading = fileLoadingFor === p
              const text = fileAnalysis[p]
              return (
                <li key={p}>
                  <div
                    className={`merge-shared-item clickable ${r ? `risk-${r.risk}` : 'risk-unknown'} ${isExpanded ? 'expanded' : ''}`}
                    onClick={() => onToggleFile(p)}
                    title="点击 — 让 AI 深入分析这个文件的冲突点"
                  >
                    <span className="risk-dot" aria-hidden />
                    <code className="merge-shared-path">{p}</code>
                    {r ? (
                      <>
                        <span className="risk-label">{RISK_LABEL[r.risk]}</span>
                        <span className="risk-reason" title={r.reason}>{r.reason}</span>
                      </>
                    ) : null}
                    <i className={`ti ${isExpanded ? 'ti-chevron-up' : 'ti-chevron-down'} merge-shared-toggle`} />
                  </div>
                  {isExpanded && (
                    <div className="merge-file-detail">
                      {text ? (
                        <p className="merge-file-detail-text">
                          {text}
                          {isLoading && <span className="ai-streaming-cursor">▌</span>}
                        </p>
                      ) : isLoading ? (
                        <div className="merge-ai-loading">
                          <i className="ti ti-loader-2" />
                          <span>AI 正在分析 {p} 的冲突…</span>
                        </div>
                      ) : null}
                    </div>
                  )}
                </li>
              )
            })}
            {analysis.sharedFiles.length > 12 && (
              <li className="merge-shared-item" style={{ opacity: 0.5 }}>
                <span className="risk-dot" />
                <code>… 还有 {analysis.sharedFiles.length - 12} 个</code>
              </li>
            )}
          </ul>
        </div>
      )}

      {!analysis.canFastForward && analysis.sharedFiles.length === 0 && (
        <p className="merge-summary" style={{ color: 'var(--green)' }}>
          <i className="ti ti-circle-check" />
          {' '}双方改动的文件不重叠，结构上应该可以自动合并。
        </p>
      )}
    </>
  )
}
