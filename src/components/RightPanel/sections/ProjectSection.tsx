import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from '../../../store'
import type { ProjectCommand } from '../../../store'

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
              <ShellScriptBtn key={c.command} script={c} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** A shell-script chip with an inline arg-picker. Click the body → run
 *  with the most recently used args (no args on first use). Click the
 *  caret → expand a small panel with a text input pre-filled with the
 *  last args plus chips for the 5 most recent values. Enter or [Run]
 *  records the new args and runs `bash ./x.sh <args>`. */
function ShellScriptBtn({ script }: { script: ProjectCommand }) {
  const { t } = useTranslation()
  const repoPath = useStore(s => s.repoPath)
  const entry = useStore(s =>
    repoPath ? s.shellScriptArgs[repoPath]?.[script.command] : undefined
  )
  const sendToTerminal = useStore(s => s.sendToTerminal)
  const setShellScriptArgs = useStore(s => s.setShellScriptArgs)

  const last = entry?.last ?? ''
  const history = entry?.history ?? []
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(last)

  const run = (args: string) => {
    const trimmed = args.trim()
    setShellScriptArgs(script.command, trimmed)
    sendToTerminal(trimmed ? `${script.command} ${trimmed}` : script.command)
    setOpen(false)
  }

  // Re-sync the input with the persisted "last" each time the panel
  // opens, so if another instance of the app (or another tab on the
  // same script) changed it, we don't show stale text. Without this,
  // the locally-held draft would survive close/reopen.
  const toggle = () => {
    if (!open) setDraft(last)
    setOpen(v => !v)
  }

  return (
    <div className={`rs-cmd-shell-wrap${open ? ' is-open' : ''}`}>
      <div className="rs-cmd-shell-row">
        <button
          className="rs-cmd-btn rs-cmd-btn-shell"
          onClick={() => run(last)}
          title={last ? `${script.command} ${last}` : script.command}
        >
          <i className="ti ti-terminal-2" />
          <span>{script.label}</span>
          {last && <span className="rs-cmd-shell-dot" aria-hidden="true" />}
        </button>
        <button
          className={`rs-cmd-shell-caret${open ? ' active' : ''}`}
          onClick={toggle}
          title={t('rightpanel.shell_args_edit', 'Edit args')}
          aria-label={t('rightpanel.shell_args_edit', 'Edit args')}
          aria-expanded={open}
        >
          <i className={`ti ${open ? 'ti-chevron-up' : 'ti-chevron-down'}`} />
        </button>
      </div>
      {open && (
        <div className="rs-cmd-shell-args">
          <div className="rs-cmd-shell-input-row">
            <input
              type="text"
              className="rs-cmd-shell-input"
              autoFocus
              value={draft}
              placeholder={t('rightpanel.shell_args_placeholder', 'args, e.g. --env=prod')}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); run(draft) }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
              spellCheck={false}
            />
            <button
              className="rs-cmd-shell-run"
              onClick={() => run(draft)}
              title={t('rightpanel.shell_args_run', 'Run')}
            >
              <i className="ti ti-player-play" />
            </button>
          </div>
          {history.length > 0 && (
            <div className="rs-cmd-shell-chips">
              {history.map(h => (
                <button
                  key={h}
                  className={`rs-cmd-shell-chip${h === draft ? ' active' : ''}`}
                  onClick={() => setDraft(h)}
                  title={h}
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
