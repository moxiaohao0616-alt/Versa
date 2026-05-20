import { useTranslation } from 'react-i18next'
import { useStore } from '../../store'

/**
 * Sub-repo switcher. Renders only when the active workspace tab contains
 * more than one sub-repo. Single-repo tabs (the 99% case) get no extra UI —
 * the workspace abstraction stays invisible.
 *
 * First pill is the workspace Overview (dashboard) entry; the rest are the
 * sub-repos. Active style follows the workspace's `view` field, not just
 * `repoPath`, so Overview can be the focus even though some sub-repo is
 * technically still the `activeRepo`.
 */
export function SubRepoStrip() {
  const { t } = useTranslation()
  const { tabs, repoPath, tabSnapshots, repoStatus, switchSubRepo, setWorkspaceView } = useStore()

  // Defensive `?.` — survives HMR sessions where some tabs in memory still
  // hold the pre-workspace shape (no `repos` field).
  const activeWs = tabs.find(ws => ws.repos?.some(r => r.path === repoPath))
  if (!activeWs || (activeWs.repos?.length ?? 0) < 2) return null

  const inOverview = activeWs.view === 'overview'

  return (
    <div className="subrepostrip" role="tablist" aria-label={t('subrepo_strip.aria_label')}>
      <button
        role="tab"
        aria-selected={inOverview}
        className={`subrepo-pill subrepo-pill-overview ${inOverview ? 'active' : ''}`}
        onClick={() => setWorkspaceView(activeWs.root, 'overview')}
        title={t('subrepo_strip.overview_tooltip')}
      >
        <i className="ti ti-layout-dashboard" />
        <span className="subrepo-name">{activeWs.name}</span>
        <span className="subrepo-branch">{t('subrepo_strip.overview_label')}</span>
      </button>
      {activeWs.repos.map(repo => {
        const isActive = !inOverview && repo.path === repoPath
        // Pull branch info from the active state for the focused sub-repo,
        // or from its stashed snapshot (populated eagerly for multi-repo
        // workspaces, or via prior visits).
        const branch = repo.path === repoPath
          ? repoStatus?.branch
          : tabSnapshots[repo.path]?.repoStatus?.branch
        return (
          <button
            key={repo.path}
            role="tab"
            aria-selected={isActive}
            className={`subrepo-pill ${isActive ? 'active' : ''}`}
            onClick={() => switchSubRepo(repo.path)}
            title={repo.path}
          >
            <i className="ti ti-folder" />
            <span className="subrepo-name">{repo.name}</span>
            {branch && <span className="subrepo-branch">{branch}</span>}
          </button>
        )
      })}
    </div>
  )
}
