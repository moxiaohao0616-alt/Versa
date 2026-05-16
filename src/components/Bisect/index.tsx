import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'

export function BisectBanner() {
  const { t } = useTranslation()
  const {
    bisectStatus, loadBisectStatus, bisectMark, bisectReset, repoStatus,
    selectCommit, setTab,
  } = useStore()
  const [busy, setBusy] = useState<null | 'good' | 'bad' | 'skip' | 'reset'>(null)

  /** Jump into the current bisect-checked-out commit's diff (selects it in
   *  commit-view mode so Sidebar + DiffView show its contents). */
  const viewCurrent = () => {
    const oid = bisectStatus?.currentOid
    if (!oid) return
    setTab('changes')
    selectCommit({
      id: oid,
      shortId: bisectStatus.currentShort ?? oid.slice(0, 7),
      message: bisectStatus.currentSubject ?? '',
    })
  }

  useEffect(() => {
    loadBisectStatus()
  }, [repoStatus?.state])

  if (!bisectStatus || bisectStatus.kind === 'inactive') return null

  const onMark = async (k: 'good' | 'bad' | 'skip') => {
    setBusy(k)
    await bisectMark(k)
    setBusy(null)
  }
  const onReset = async () => {
    setBusy('reset')
    await bisectReset()
    setBusy(null)
  }

  if (bisectStatus.kind === 'found') {
    return (
      <div className="bisect-banner found">
        <div className="bisect-banner-left">
          <i className="ti ti-target" />
          <div className="bisect-banner-text">
            <span className="bisect-banner-title">{t('bisect.found_title')}</span>
            <span className="bisect-banner-meta">
              {t('bisect.found_meta')}
              {' '}<code className="bisect-sha">{bisectStatus.foundShort ?? '?'}</code>
              {bisectStatus.foundSubject ? ` · ${bisectStatus.foundSubject}` : ''}
            </span>
          </div>
        </div>
        <div className="bisect-banner-actions">
          <button className="btn-primary" onClick={onReset} disabled={busy !== null}>
            <i className={`ti ${busy === 'reset' ? 'ti-loader-2' : 'ti-check'}`} />
            {t('bisect.finish_exit')}
          </button>
        </div>
      </div>
    )
  }

  // in-progress
  return (
    <div className="bisect-banner">
      <div className="bisect-banner-left">
        <i className="ti ti-search" />
        <div className="bisect-banner-text">
          <span className="bisect-banner-title">{t('bisect.in_progress_title')}</span>
          <span className="bisect-banner-meta">
            {t('bisect.in_progress_meta')}
            {' '}<code className="bisect-sha">{bisectStatus.currentShort ?? '?'}</code>
            {bisectStatus.currentSubject ? ` · ${bisectStatus.currentSubject}` : ''}
            {bisectStatus.stepsRemaining != null &&
              ` · ${t('bisect.steps_remaining', { n: bisectStatus.stepsRemaining })}`}
          </span>
        </div>
      </div>
      <div className="bisect-banner-actions">
        <button
          className="ct-btn"
          onClick={viewCurrent}
          disabled={busy !== null || !bisectStatus.currentOid}
          title={t('bisect.view_current_tooltip')}
        >
          <i className="ti ti-file-search" />
          {t('bisect.view_current_diff')}
        </button>
        <button
          className="ct-btn good"
          onClick={() => onMark('good')}
          disabled={busy !== null}
          title={t('bisect.good_tooltip')}
        >
          <i className={`ti ${busy === 'good' ? 'ti-loader-2' : 'ti-thumb-up'}`} />
          {t('bisect.good')}
        </button>
        <button
          className="ct-btn bad"
          onClick={() => onMark('bad')}
          disabled={busy !== null}
          title={t('bisect.bad_tooltip')}
        >
          <i className={`ti ${busy === 'bad' ? 'ti-loader-2' : 'ti-thumb-down'}`} />
          {t('bisect.bad')}
        </button>
        <button
          className="ct-btn"
          onClick={() => onMark('skip')}
          disabled={busy !== null}
          title={t('bisect.skip_tooltip')}
        >
          <i className={`ti ${busy === 'skip' ? 'ti-loader-2' : 'ti-player-skip-forward'}`} />
          {t('bisect.skip')}
        </button>
        <button
          className="btn-secondary"
          onClick={onReset}
          disabled={busy !== null}
          title={t('bisect.stop_tooltip')}
        >
          <i className="ti ti-x" />
          {t('bisect.stop')}
        </button>
      </div>
    </div>
  )
}
