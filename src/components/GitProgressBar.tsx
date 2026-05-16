import type { GitProgress } from '../store'

/**
 * Compact progress strip for git push/pull/clone/rebase.
 *
 * Renders a percent bar + label when the backend has parsed structured fields
 * out of git's stderr; falls back to the raw line + spinner when it couldn't
 * (e.g. transitional lines like "Writing objects: ... done.").
 */
export function GitProgressBar({ progress }: { progress: GitProgress }) {
  if (progress.percent !== null) {
    const parts: string[] = []
    if (progress.stage) parts.push(progress.stage)
    parts.push(`${progress.percent}%`)
    if (progress.current !== null && progress.total !== null) {
      parts.push(`${progress.current} / ${progress.total}`)
    }
    if (progress.speed) parts.push(progress.speed)
    return (
      <div className="git-progress" title={progress.line}>
        <div className="git-progress-bar">
          <div
            className="git-progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }}
          />
        </div>
        <span className="git-progress-meta">{parts.join(' · ')}</span>
      </div>
    )
  }
  return (
    <div className="git-progress" title={progress.line}>
      <i className="ti ti-loader-2" />
      <span className="git-progress-line">{progress.line}</span>
    </div>
  )
}
