import { useEffect, useState } from 'react'
import { useStore } from '../../store'

export function BisectBanner() {
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
            <span className="bisect-banner-title">找到了！</span>
            <span className="bisect-banner-meta">
              第一个出问题的提交是
              {' '}<code className="bisect-sha">{bisectStatus.foundShort ?? '?'}</code>
              {bisectStatus.foundSubject ? ` · ${bisectStatus.foundSubject}` : ''}
            </span>
          </div>
        </div>
        <div className="bisect-banner-actions">
          <button className="btn-primary" onClick={onReset} disabled={busy !== null}>
            <i className={`ti ${busy === 'reset' ? 'ti-loader-2' : 'ti-check'}`} />
            完成 · 退出查找
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
          <span className="bisect-banner-title">正在查找出问题的提交</span>
          <span className="bisect-banner-meta">
            正在测试
            {' '}<code className="bisect-sha">{bisectStatus.currentShort ?? '?'}</code>
            {bisectStatus.currentSubject ? ` · ${bisectStatus.currentSubject}` : ''}
            {bisectStatus.stepsRemaining != null &&
              ` · 还需 ~${bisectStatus.stepsRemaining} 步`}
          </span>
        </div>
      </div>
      <div className="bisect-banner-actions">
        <button
          className="ct-btn"
          onClick={viewCurrent}
          disabled={busy !== null || !bisectStatus.currentOid}
          title="看看这版改了什么（跳到 commit-view 显示这次的 diff）"
        >
          <i className="ti ti-file-search" />
          看看这版改了什么
        </button>
        <button
          className="ct-btn good"
          onClick={() => onMark('good')}
          disabled={busy !== null}
          title="这一版能正常用"
        >
          <i className={`ti ${busy === 'good' ? 'ti-loader-2' : 'ti-thumb-up'}`} />
          这版好
        </button>
        <button
          className="ct-btn bad"
          onClick={() => onMark('bad')}
          disabled={busy !== null}
          title="这一版已经有问题了"
        >
          <i className={`ti ${busy === 'bad' ? 'ti-loader-2' : 'ti-thumb-down'}`} />
          这版坏
        </button>
        <button
          className="ct-btn"
          onClick={() => onMark('skip')}
          disabled={busy !== null}
          title="跳过这版（这次说不准，让 git 选别的）"
        >
          <i className={`ti ${busy === 'skip' ? 'ti-loader-2' : 'ti-player-skip-forward'}`} />
          跳过
        </button>
        <button
          className="btn-secondary"
          onClick={onReset}
          disabled={busy !== null}
          title="放弃这次查找，回到原来的分支"
        >
          <i className="ti ti-x" />
          停止查找
        </button>
      </div>
    </div>
  )
}
