import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'

/** "Explain this commit" — AI-generated plain-language summary of whatever
 *  commit is currently selected in the graph view. Empty placeholder when
 *  nothing is selected so the icon-strip slot stays meaningful. */
export function ExplainSection() {
  const { t } = useTranslation()
  const selectedCommit = useStore(s => s.selectedCommit)
  const commitExplanation = useStore(s => s.commitExplanation)
  const loading = useStore(s => s.commitExplanationLoading)
  const explainSelectedCommit = useStore(s => s.explainSelectedCommit)

  if (!selectedCommit) {
    return (
      <div className="rp-section-body">
        <p className="rs-empty">{t('rightsidebar.explain_no_commit', 'Pick a commit in the history view to explain.')}</p>
      </div>
    )
  }

  const matches = commitExplanation && commitExplanation.sha === selectedCommit.id

  return (
    <div className="rp-section-body">
      <div className="rp-section-subtitle">{selectedCommit.shortId} · {selectedCommit.message}</div>
      {matches ? (
        <>
          {commitExplanation!.text ? (
            <p className="rs-explain-text">
              {commitExplanation!.text}
              {loading && <span className="ai-streaming-cursor">▌</span>}
            </p>
          ) : (
            <div className="rs-loading">
              <i className="ti ti-loader-2" />
              <span>{t('rightsidebar.explain_thinking')}</span>
            </div>
          )}
          {!loading && (
            <button className="rs-explain-redo" onClick={explainSelectedCommit}>
              <i className="ti ti-refresh" />
              {t('rightsidebar.explain_regenerate')}
            </button>
          )}
        </>
      ) : loading ? (
        <div className="rs-loading">
          <i className="ti ti-loader-2" />
          <span>{t('rightsidebar.explain_thinking')}</span>
        </div>
      ) : (
        <button className="rs-explain-cta" onClick={explainSelectedCommit}>
          <i className="ti ti-sparkles" />
          {t('rightsidebar.explain_cta')}
        </button>
      )}
    </div>
  )
}
