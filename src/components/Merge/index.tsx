import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type MergeAnalysis, type MergeRiskReport, type FileRisk } from '../../store'
import { renderLiteMarkdown } from '../../lib/lite-markdown'

interface Props {
  target: string
  onClose: () => void
}

export function MergeModal({ target, onClose }: Props) {
  const { t } = useTranslation()
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
          {t('merge.title_short')} <span className="merge-branch-pill">{target}</span>
          {' → '}
          <span className="merge-branch-pill current">{current}</span>
        </div>
        <div className="modal-body">
          {loading ? (
            <div className="empty-state center" style={{ padding: 20 }}>
              <i className="ti ti-loader-2" /> <span style={{ marginLeft: 6 }}>{t('merge.analyzing_range')}</span>
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
                <span>{t('merge.ai_risk_title')}</span>
                {aiReport && !aiLoading && (
                  <button
                    className="commit-explain-redo"
                    onClick={handleAskAI}
                    title={t('merge.ai_redo_tooltip')}
                  >
                    <i className="ti ti-refresh" />
                    {t('merge.ai_redo')}
                  </button>
                )}
              </div>
              {aiLoading ? (
                <div className="merge-ai-loading">
                  <i className="ti ti-loader-2" />
                  <span>{t('merge.ai_analyzing_both')}</span>
                </div>
              ) : aiReport ? (
                <div
                  className="merge-ai-text ai-markdown"
                  dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(aiReport.overall) }}
                />
              ) : (
                <button
                  className="commit-explain-btn"
                  onClick={handleAskAI}
                  style={{ marginTop: 4 }}
                  title={t('merge.ai_run_tooltip')}
                >
                  <i className="ti ti-sparkles" />
                  {t('merge.ai_run')}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={merging}>{t('common.cancel')}</button>
          <button
            className="btn-primary"
            disabled={
              merging || loading || !analysis ||
              analysis.alreadyMerged || analysis.targetCommits === 0
            }
            onClick={handleMerge}
            title={
              analysis?.alreadyMerged ? t('merge.already_merged')
                : analysis && analysis.canFastForward ? t('merge.ff_merge')
                : t('merge.do_merge')
            }
          >
            <i className={`ti ${merging ? 'ti-loader-2' : 'ti-git-merge'}`} />
            {merging ? t('merge.merging')
              : (analysis?.canFastForward ? t('merge.ff_merge_btn') : t('merge.confirm_merge'))}
          </button>
        </div>
      </div>
    </div>
  )
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
  const { t } = useTranslation()
  const riskLabel = (r: FileRisk['risk']) =>
    r === 'high' ? t('merge.high_risk') : r === 'medium' ? t('merge.medium_risk') : t('merge.low_risk')

  if (analysis.alreadyMerged) {
    return (
      <p style={{ fontSize: 13 }}>
        <i className="ti ti-circle-check" style={{ color: 'var(--green)' }} />
        {' '}
        {t('merge.already_merged_long', { target: analysis.target, current: analysis.current })}
      </p>
    )
  }
  if (analysis.targetCommits === 0) {
    return (
      <p style={{ fontSize: 13 }}>
        {t('merge.no_commits', { target: analysis.target })}
      </p>
    )
  }
  return (
    <>
      <p className="merge-summary">
        {analysis.canFastForward ? (
          <>
            <i className="ti ti-arrow-right" style={{ color: 'var(--green)' }} />
            {' '}{t('merge.ff_explain', {
              current: analysis.current,
              target: analysis.target,
              n: analysis.targetCommits,
            })}
          </>
        ) : (
          t('merge.will_merge', {
            target: analysis.target,
            n: analysis.targetCommits,
            f: analysis.incomingFiles.length,
          })
        )}
      </p>

      {!analysis.canFastForward && analysis.sharedFiles.length > 0 && (
        <div className="merge-shared">
          <div className="merge-shared-head">
            <i className="ti ti-alert-triangle" />
            <span>{t('merge.both_changed', { n: analysis.sharedFiles.length })}</span>
            {riskMap.size > 0 && (
              <span className="merge-shared-legend">
                {t('merge.ai_colored')}
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
                    title={t('merge.ai_file_deep')}
                  >
                    <span className="risk-dot" aria-hidden />
                    <code className="merge-shared-path">{p}</code>
                    {r ? (
                      <>
                        <span className="risk-label">{riskLabel(r.risk)}</span>
                        <span className="risk-reason" title={r.reason}>{r.reason}</span>
                      </>
                    ) : null}
                    <i className={`ti ${isExpanded ? 'ti-chevron-up' : 'ti-chevron-down'} merge-shared-toggle`} />
                  </div>
                  {isExpanded && (
                    <div className="merge-file-detail">
                      {text ? (
                        <div
                          className="merge-file-detail-text ai-markdown"
                          dangerouslySetInnerHTML={{ __html: renderLiteMarkdown(text + (isLoading ? ' ▌' : '')) }}
                        />
                      ) : isLoading ? (
                        <div className="merge-ai-loading">
                          <i className="ti ti-loader-2" />
                          <span>{t('merge.ai_file_analyzing', { file: p })}</span>
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
                <code>{t('merge.more_files', { n: analysis.sharedFiles.length - 12 })}</code>
              </li>
            )}
          </ul>
        </div>
      )}

      {!analysis.canFastForward && analysis.sharedFiles.length === 0 && (
        <p className="merge-summary" style={{ color: 'var(--green)' }}>
          <i className="ti ti-circle-check" />
          {' '}{t('merge.disjoint')}
        </p>
      )}
    </>
  )
}
