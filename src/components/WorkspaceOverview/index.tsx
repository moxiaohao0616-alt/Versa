import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type RepoStatus, type ChangedFile } from '../../store'

/**
 * Dashboard view for a multi-repo workspace. Shows a card per sub-repo with
 * branch, dirty-file counts and a "tap to open" affordance. Clicking a card
 * is equivalent to clicking the corresponding pill in SubRepoStrip — it flips
 * the workspace view to 'repo' and focuses that sub-repo.
 */
export function WorkspaceOverview() {
  const { t } = useTranslation()
  const { tabs, repoPath, repoStatus, tabSnapshots, switchSubRepo, initWorkspaceRoot } = useStore()

  // Resolve the workspace the user is currently inside. `repoPath` is still
  // the workspace's `activeRepo` even in overview mode (we keep it pointed at
  // a real path so per-repo state like watcher/terminal continue working).
  const ws = tabs.find(w => w.repos?.some(r => r.path === repoPath))

  // Pull each sub-repo's status from the right place:
  // - For the activeRepo, prefer the live `repoStatus` (so we see fresh data
  //   after edits/refreshes without re-snapshotting).
  // - For the rest, read the eagerly-loaded snapshot.
  const cards = useMemo(() => {
    if (!ws) return []
    return ws.repos.map(repo => {
      const live = repo.path === repoPath ? repoStatus : null
      const snap = tabSnapshots[repo.path]?.repoStatus ?? null
      const status: RepoStatus | null = live ?? snap
      return { repo, status }
    })
  }, [ws, repoPath, repoStatus, tabSnapshots])

  if (!ws) return null

  const totalDirty = cards.reduce((n, c) => n + countDirty(c.status?.files), 0)
  const needsInit = !ws.rootIsRepo

  return (
    <div className="workspace-overview">
      <header className="ws-overview-header">
        <h1>{ws.name}</h1>
        <div className="ws-overview-meta">
          <span>{t('workspace_overview.repo_count', { count: ws.repos.length })}</span>
          {totalDirty > 0 && (
            <span className="ws-overview-dirty-total">
              {t('workspace_overview.dirty_total', { count: totalDirty })}
            </span>
          )}
          {needsInit && (
            <span className="ws-overview-needs-init">
              {t('workspace_overview.root_uninitialized')}
            </span>
          )}
        </div>
      </header>

      {needsInit && (
        <div className="ws-init-card">
          <div className="ws-init-card-body">
            <div className="ws-init-card-title">
              <i className="ti ti-git-pull-request-draft" />
              <span>{t('workspace_overview.init_card_title', { name: ws.name })}</span>
            </div>
            <div className="ws-init-card-desc">
              {t('workspace_overview.init_card_desc')}
            </div>
          </div>
          <button
            className="ws-init-card-btn"
            onClick={() => initWorkspaceRoot(ws.root)}
          >
            <i className="ti ti-folder-plus" />
            <span>{t('workspace_overview.init_card_button')}</span>
          </button>
        </div>
      )}

      <div className="ws-overview-grid">
        {cards.map(({ repo, status }) => {
          const dirty = countDirty(status?.files)
          const isClean = status !== null && dirty === 0
          return (
            <button
              key={repo.path}
              className="ws-card"
              onClick={() => switchSubRepo(repo.path)}
              title={repo.path}
            >
              <div className="ws-card-head">
                <i className="ti ti-folder" />
                <span className="ws-card-name">{repo.name}</span>
              </div>
              <div className="ws-card-meta">
                {status ? (
                  <span className="ws-card-branch">
                    <i className="ti ti-git-branch" />
                    {status.branch || t('workspace_overview.detached')}
                  </span>
                ) : (
                  <span className="ws-card-loading">{t('workspace_overview.loading')}</span>
                )}
                {status && (status.ahead > 0 || status.behind > 0) && (
                  <span className="ws-card-sync">
                    {status.ahead > 0 && <span>↑{status.ahead}</span>}
                    {status.behind > 0 && <span>↓{status.behind}</span>}
                  </span>
                )}
              </div>
              <div className="ws-card-status">
                {isClean && <span className="ws-card-clean">{t('workspace_overview.clean')}</span>}
                {dirty > 0 && (() => {
                  const fs = status?.files ?? []
                  const staged = fs.filter(f => f.stagedStatus).length
                  const unstaged = fs.filter(f => f.unstagedStatus).length
                  return (
                    <span className="ws-card-dirty">
                      {staged > 0 && (
                        <span className="ws-card-dirty-staged">
                          {t('workspace_overview.staged_n', { count: staged })}
                        </span>
                      )}
                      {unstaged > 0 && (
                        <span className="ws-card-dirty-unstaged">
                          {t('workspace_overview.unstaged_n', { count: unstaged })}
                        </span>
                      )}
                    </span>
                  )
                })()}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function countDirty(files?: ChangedFile[] | null): number {
  return files?.length ?? 0
}
