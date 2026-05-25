import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'

/** Project-runner section: lists the package.json scripts (or cargo
 *  targets, etc.) for the active repo, click → send to the bottom
 *  terminal. Extracted from the old RightSidebar card so it can be
 *  hosted on either side. */
export function ProjectSection() {
  const { t } = useTranslation()
  const projectInfo = useStore(s => s.projectInfo)
  const sendToTerminal = useStore(s => s.sendToTerminal)

  if (!projectInfo || projectInfo.kind === 'unknown') {
    return (
      <div className="rp-section-body">
        <p className="rs-empty">{t('rightsidebar.project_empty')}</p>
      </div>
    )
  }
  return (
    <div className="rp-section-body">
      {projectInfo.commands.length > 0 ? (
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
      ) : (
        <p className="rs-empty">{t('rightsidebar.project_empty')}</p>
      )}
    </div>
  )
}
