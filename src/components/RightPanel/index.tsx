import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, defaultDockFor, type TermSession } from '../../store'
import { useAgentStore } from '../../lib/agents'
import { TerminalPane } from '../Terminal'
import { ProjectSection } from './sections/ProjectSection'

/** All possible right-panel sections — three fixed tool cards plus one
 *  per live terminal session. Sections are filtered by their dock target;
 *  this is the master list. */
interface SectionMeta {
  id: string
  icon: string
  label: string
  session?: TermSession   // present iff this is a `terminal:*` section
}

function useAllSections(): SectionMeta[] {
  const { t } = useTranslation()
  const repoPath = useStore(s => s.repoPath)
  const sessions = useStore(s => repoPath ? s.terminalsByRepo[repoPath] ?? [] : [])
  return useMemo(() => {
    const out: SectionMeta[] = [
      { id: 'project', icon: 'ti-package', label: t('rightpanel.project', 'Project') },
    ]
    for (const s of sessions) {
      out.push({
        id: `terminal:${s.id}`,
        icon: s.agentId ? 'ti-robot' : 'ti-terminal-2',
        label: s.title,
        session: s,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, t])
}

/** Resolve current dock for a section, falling back to the system default.
 *  Tool sections (project / explain / stash) are FORCED to 'right' even if
 *  the persisted map says 'bottom' — the bottom panel can't render them,
 *  so any stale 'bottom' entry (from a pre-fix build where the user clicked
 *  "dock to bottom" on a tool section) would otherwise hide the section
 *  forever. Only terminal-backed sections may live in the bottom dock. */
const TOOL_SECTION_IDS = new Set(['project'])
function useDockResolver() {
  const dockMap = useStore(s => s.sectionDock)
  const terminalsByRepo = useStore(s => s.terminalsByRepo)
  return (sectionId: string): 'right' | 'bottom' => {
    if (TOOL_SECTION_IDS.has(sectionId)) return 'right'
    return dockMap[sectionId] ?? defaultDockFor(sectionId, { terminalsByRepo })
  }
}

/** The new right-side dockable panel. Replaces RightSidebar — hosts the
 *  three tool cards AND any agent / shell sessions the user has docked
 *  to the right. Always renders the slim icon-strip at the very right
 *  edge if at least one section is docked right; the wider content area
 *  to its left appears when the panel is open. */
export function RightPanel() {
  const { t } = useTranslation()
  const sections = useAllSections()
  const resolveDock = useDockResolver()
  const rightPanel = useStore(s => s.rightPanel)
  const repoPath = useStore(s => s.repoPath)
  const setPanelOpen = useStore(s => s.setPanelOpen)
  const setPanelActiveSection = useStore(s => s.setPanelActiveSection)
  const setPanelSize = useStore(s => s.setPanelSize)
  const activateSection = useStore(s => s.activateSection)

  const rightSections = sections.filter(s => resolveDock(s.id) === 'right')

  // Active section is per-repo so that switching repos and back restores
  // whatever agent / section the user was looking at *for that repo*. A
  // tool section like "Project" would otherwise auto-fill the slot when
  // the user's agent session vanishes (different repo), and then stick
  // because Project is also valid in repo A.
  const repoKey = repoPath || '__none__'
  const activeSectionId = rightPanel.activeByRepo[repoKey] ?? null

  // If the persisted activeSection for the *current repo* is no longer in
  // the right dock (its terminal was closed, or it got docked to bottom),
  // decide a sensible follow-up:
  //   1. Another agent session running → switch to it (the user's attention
  //      was on AI output; show the next one).
  //   2. No agents left → close the entire panel. Don't auto-pop a tool
  //      card like Project — the user was watching their agent, not
  //      browsing tools, so opening Project after an exit feels like the
  //      app forced an unrelated panel on them.
  useEffect(() => {
    if (rightSections.length === 0) {
      if (rightPanel.open) setPanelOpen('right', false)
      return
    }
    const stillThere = rightSections.some(s => s.id === activeSectionId)
    if (!stillThere) {
      const firstAgent = rightSections.find(s => s.session?.agentId)
      if (firstAgent) {
        setPanelActiveSection('right', firstAgent.id)
      } else if (rightPanel.open) {
        // No agent to fall back on — close instead of auto-activating
        // the next tool section. Tool cards stay accessible via the
        // strip; the user can pick one when they want one.
        setPanelOpen('right', false)
      }
    }
  }, [rightSections.map(s => s.id).join(','), activeSectionId])

  // Width drag — left border of the panel. Inverted from the bottom
  // terminal's vertical resize: dragging left grows the panel.
  const dragRef = useRef<{ startX: number; startW: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const onResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragRef.current = { startX: e.clientX, startW: rightPanel.width }
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = dragRef.current.startX - ev.clientX
      const next = Math.max(260, Math.min(window.innerWidth * 0.6, dragRef.current.startW + dx))
      setPanelSize('right', next)
    }
    const onUp = () => {
      dragRef.current = null
      setDragging(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // The agent launcher is a permanent first-position button in the strip —
  // even when no agents are running it gives the user a single obvious
  // entry point: click → pick CLI → it opens here. We render the strip
  // unconditionally now (used to bail when rightSections was empty); the
  // launcher button alone is enough reason to keep the strip on screen.
  const agents = useAgentStore(s => s.agents)
  const launcherBtnRef = useRef<HTMLButtonElement>(null)
  const launcherMenuRef = useRef<HTMLDivElement>(null)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [launcherPos, setLauncherPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const openAgentTerminal = useStore(s => s.openAgentTerminal)
  useEffect(() => {
    if (!launcherOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (!launcherMenuRef.current?.contains(target) &&
          !launcherBtnRef.current?.contains(target)) {
        setLauncherOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [launcherOpen])
  const toggleLauncher = () => {
    if (!launcherOpen && launcherBtnRef.current) {
      const r = launcherBtnRef.current.getBoundingClientRect()
      // Position the menu so its right edge is 6px to the left of the
      // strip button (the strip lives on the right edge of the window).
      setLauncherPos({ top: r.top, left: r.left - 6 })
    }
    setLauncherOpen(v => !v)
  }

  const activeSection = rightSections.find(s => s.id === activeSectionId) ?? null

  return (
    <>
      {rightPanel.open && activeSection && (
        <aside
          className="right-panel-content"
          style={{ width: rightPanel.width }}
        >
          <div
            className={`right-panel-resize${dragging ? ' is-dragging' : ''}`}
            onMouseDown={onResizeMouseDown}
            title={t('rightpanel.resize', 'Drag to resize')}
          />
          <header className="right-panel-header">
            <i className={`ti ${activeSection.icon} right-panel-header-icon`} />
            <span className="right-panel-header-title">{activeSection.label}</span>
            <div className="right-panel-header-actions">
              {/* The two panels are no longer interchangeable: the right
               *  panel owns tool sections + agents, the bottom panel owns
               *  shell terminals. No dock-swap button on either side —
               *  the prior "dock to bottom" action would silently break
               *  tool sections (the bottom panel can't render them) and
               *  was confusing for terminals too. */}
              <button
                className="right-panel-header-btn"
                title={t('rightpanel.collapse', 'Collapse panel')}
                onClick={() => setPanelOpen('right', false)}
              >
                <i className="ti ti-chevron-right" />
              </button>
            </div>
          </header>
          <div className="right-panel-body">
            {activeSection.session && repoPath ? (
              <TerminalPane
                session={activeSection.session}
                isActive={true}
                repoPath={repoPath}
                panelHeight={rightPanel.width}
              />
            ) : activeSection.id === 'project' ? <ProjectSection />
            : null}
          </div>
        </aside>
      )}
      <nav className="right-panel-strip" aria-label="Right panel sections">
        {/* Permanent first-position agent launcher. Click → menu of every
            configured CLI agent. Picking one spawns a session and auto-
            activates it (see store's openAgentTerminal). */}
        <button
          ref={launcherBtnRef}
          className={`right-panel-strip-btn right-panel-strip-launcher${launcherOpen ? ' active' : ''}`}
          title={t('terminal.agent_launcher')}
          aria-label={t('terminal.agent_launcher')}
          aria-haspopup="menu"
          aria-expanded={launcherOpen}
          onClick={toggleLauncher}
        >
          <i className="ti ti-robot" />
          {/* Small "+" badge — distinguishes the launcher (action button
              that SPAWNS agents) from the per-session buttons below, which
              are also robot icons and were visually indistinguishable
              when an agent was active. */}
          <i className="ti ti-plus right-panel-strip-launcher-badge" aria-hidden="true" />
        </button>
        {launcherOpen && (
          <div
            ref={launcherMenuRef}
            className="term-agent-menu rp-launcher-menu"
            role="menu"
            style={{ top: launcherPos.top, left: launcherPos.left, right: 'auto', transform: 'translateX(-100%)' }}
          >
            {agents.length === 0 ? (
              <p className="term-agent-menu-empty">{t('terminal.agent_menu_empty')}</p>
            ) : (
              agents.map(a => (
                <button
                  key={a.id}
                  type="button"
                  className="term-agent-menu-item"
                  onClick={() => {
                    if (!repoPath) return
                    openAgentTerminal(repoPath, a)
                    setLauncherOpen(false)
                  }}
                  title={`${a.command} ${a.extraArgs}`.trim()}
                >
                  <i className="ti ti-robot" />
                  <span>{a.name}</span>
                </button>
              ))
            )}
            <div className="term-agent-menu-sep" />
            <button
              type="button"
              className="term-agent-menu-item term-agent-menu-config"
              onClick={() => {
                setLauncherOpen(false)
                window.dispatchEvent(new CustomEvent('versa:nav-agents-settings'))
              }}
            >
              <i className="ti ti-settings" />
              <span>{t('terminal.agent_menu_configure')}</span>
            </button>
          </div>
        )}
        {/* Top group — agent sessions live RIGHT after the launcher, since
            they're the "result" of that action. Shell sessions and tool
            cards belong below the separator. */}
        {rightSections
          .filter(s => s.session?.agentId)
          .map(s => {
            const isActive = rightPanel.open && s.id === activeSectionId
            return (
              <button
                key={s.id}
                className={`right-panel-strip-btn${isActive ? ' active' : ''}`}
                title={s.label}
                aria-label={s.label}
                onClick={() => activateSection(s.id)}
              >
                <i className={`ti ${s.icon}`} />
              </button>
            )
          })}
        {/* Separator between "agent stuff" (above) and "everything else"
            (below). Rendered conditionally so a panel with only one group
            doesn't pick up a dangling line. */}
        {(rightSections.some(s => !s.session?.agentId)) && (
          <div className="right-panel-strip-divider" aria-hidden="true" />
        )}
        {/* Bottom group — shell terminals (rare here; user explicitly
            docked them right) and the three tool sections. */}
        {rightSections
          .filter(s => !s.session?.agentId)
          .map(s => {
            const isActive = rightPanel.open && s.id === activeSectionId
            return (
              <button
                key={s.id}
                className={`right-panel-strip-btn${isActive ? ' active' : ''}`}
                title={s.label}
                aria-label={s.label}
                onClick={() => activateSection(s.id)}
              >
                <i className={`ti ${s.icon}`} />
              </button>
            )
          })}
      </nav>
    </>
  )
}
