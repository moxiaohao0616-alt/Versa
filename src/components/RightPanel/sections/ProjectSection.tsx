import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'

/** Project-runner section: lists the package-manager scripts (npm /
 *  cargo / go) AND any plain shell scripts discovered in the repo
 *  root + `scripts/`. Rendered as two clearly-separated blocks so it's
 *  obvious which is which — running `bash ./deploy.sh` is a different
 *  kind of action from `npm run dev` and shouldn't share an undivided
 *  grid with it. */
export function ProjectSection() {
  const { t } = useTranslation()
  const projectInfo = useStore(s => s.projectInfo)
  const sendToTerminal = useStore(s => s.sendToTerminal)

  if (!projectInfo) {
    return (
      <div className="rp-section-body">
        <p className="rs-empty">{t('rightsidebar.project_empty')}</p>
      </div>
    )
  }
  const hasCommands = projectInfo.commands.length > 0
  const hasShells = (projectInfo.shellScripts ?? []).length > 0
  if (!hasCommands && !hasShells) {
    return (
      <div className="rp-section-body">
        <p className="rs-empty">{t('rightsidebar.project_empty')}</p>
      </div>
    )
  }

  return (
    <div className="rp-section-body">
      {hasCommands && (
        <>
          {/* The header is suppressed when there are NO shell scripts —
              the single block doesn't need labeling. Once both blocks
              exist, both get a label so the user can tell them apart. */}
          {hasShells && (
            <div className="rp-block-label">
              {projectInfo.display
                ? `${projectInfo.icon ? projectInfo.icon + ' ' : ''}${projectInfo.display}`
                : t('rightpanel.project_scripts', 'Scripts')}
            </div>
          )}
          <div className="rs-cmd-grid">
            {projectInfo.commands.map(c => (
              <button
                key={c.command}
                className="rs-cmd-btn"
                onClick={() => sendToTerminal(c.command)}
                title={c.command}
              >
                <i className="ti ti-player-play" />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {hasShells && (
        <>
          <div className="rp-block-label" style={{ marginTop: hasCommands ? 14 : 0 }}>
            🐚 {t('rightpanel.shell_scripts', 'Shell scripts')}
          </div>
          <div className="rs-cmd-grid">
            {projectInfo.shellScripts.map(c => (
              <button
                key={c.command}
                className="rs-cmd-btn rs-cmd-btn-shell"
                onClick={() => sendToTerminal(c.command)}
                title={c.command}
              >
                <i className="ti ti-terminal-2" />
                <span>{c.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
