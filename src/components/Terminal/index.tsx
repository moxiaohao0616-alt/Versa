import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal as XTerm, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import { useStore, defaultDockFor, type TermSession } from '../../store'
import { promoteAgentExitToChangelist } from '../../agents/lifecycle'

/** Sessions we've already opened during this app run. Used to tell apart
 *  the *first* mount (true cold-start — shell prints its own prompt) from
 *  a *re-mount* (user navigated away and back, PTY still alive — last frame
 *  is gone, we need to nudge with ctrl+L). Without this, every fresh
 *  terminal opens with a literal `^L` showing in the scrollback because
 *  zsh echoes the control char before its line editor is set up. */
const openedSessions = new Set<string>()

/** Pick the xterm palette based on the app theme.
 *  - Dark: Tokyo-Night-ish, plays well on near-black bg
 *  - Light: high-contrast solarized-ish, designed to read on cream bg
 *  Background / foreground come from the same CSS custom properties
 *  that drive the rest of the chrome, so themes stay in sync. */
function xtermTheme(): ITheme {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string, fallback: string) => css.getPropertyValue(n).trim() || fallback
  const bg = v('--term-bg', '#1a1b26')
  const fg = v('--term-fg', '#c0caf5')
  const isDark = /^#[0-2]/i.test(bg) || /^rgba?\(\s*[0-9]{1,2}\s*,/.test(bg)

  if (isDark) {
    return {
      background: bg,
      foreground: fg,
      cursor: '#7aa2f7',
      cursorAccent: bg,
      selectionBackground: '#33467c',
      black:         '#15161e',
      brightBlack:   '#414868',
      red:           '#f7768e',
      brightRed:     '#ff8b9e',
      green:         '#9ece6a',
      brightGreen:   '#b8e07e',
      yellow:        '#e0af68',
      brightYellow:  '#ffc586',
      blue:          '#7aa2f7',
      brightBlue:    '#9eb8ff',
      magenta:       '#bb9af7',
      brightMagenta: '#d2b4ff',
      cyan:          '#7dcfff',
      brightCyan:    '#a4d8ff',
      white:         '#a9b1d6',
      brightWhite:   '#c0caf5',
    }
  }
  return {
    background: bg,
    foreground: fg,
    cursor: '#0969da',
    cursorAccent: bg,
    selectionBackground: 'rgba(9, 105, 218, 0.18)',
    black:         '#24292f',
    brightBlack:   '#57606a',
    red:           '#cf222e',
    brightRed:     '#a40e26',
    green:         '#1a7f37',
    brightGreen:   '#116329',
    yellow:        '#9a6700',
    brightYellow:  '#7d4e00',
    blue:          '#0969da',
    brightBlue:    '#0550ae',
    magenta:       '#8250df',
    brightMagenta: '#6639ba',
    cyan:          '#1b7c83',
    brightCyan:    '#136061',
    white:         '#6e7781',
    brightWhite:   '#24292f',
  }
}

/** base64 → Uint8Array. Browser has atob for the decode; we wrap it. */
function decodeB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

// ============================================================================
// Terminal panel — shell + tab strip
// ============================================================================

/**
 * The toggleable bottom panel. Owns the resize handle, the panel header
 * (with the per-repo tab strip + new/close affordances), and stacks a
 * [`TerminalPane`] per live session. Inactive panes stay mounted with
 * `visibility: hidden` so their xterm dimensions remain valid — switching
 * tabs is free.
 *
 * Per-repo isolation: each repo path keeps its own session list via
 * `terminalsByRepo` in the store. Switching repos shows that repo's tabs;
 * the other repos' panes unmount cleanly via repoPath-dependent rendering.
 */
export function Terminal() {
  const { t } = useTranslation()
  const repoPath = useStore((s) => s.repoPath)
  const setTerminalOpen = useStore((s) => s.setTerminalOpen)
  // Show only the sessions docked to the bottom — agent tabs default to
  // the right panel now, and the user can move any session between sides
  // via the section header toggle. The store's per-repo "activeTerminal"
  // tracks the active *session*; we cap it to bottom-docked ones here.
  const allSessions = useStore((s) => (repoPath ? s.terminalsByRepo[repoPath] ?? [] : []))
  const sectionDock = useStore((s) => s.sectionDock)
  const terminalsByRepo = useStore((s) => s.terminalsByRepo)
  const sessions = allSessions.filter(s =>
    (sectionDock[`terminal:${s.id}`] ?? defaultDockFor(`terminal:${s.id}`, { terminalsByRepo })) === 'bottom'
  )
  const rawActiveId = useStore((s) => (repoPath ? s.activeTerminalByRepo[repoPath] ?? null : null))
  const activeId = sessions.some(s => s.id === rawActiveId) ? rawActiveId : (sessions[0]?.id ?? null)
  const openNewTerminal = useStore((s) => s.openNewTerminal)
  const closeTerminal = useStore((s) => s.closeTerminal)
  const setActiveTerminal = useStore((s) => s.setActiveTerminal)

  const [panelHeight, setPanelHeight] = useState(280)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef<{ startY: number; startH: number } | null>(null)

  // Auto-open the first tab when the panel comes up empty for this repo.
  // Without this, the panel renders a blank body with just "+" to click — a
  // small UX trap; the old single-terminal behavior was "open and ready".
  //
  // Reads via useStore.getState() instead of the destructured `sessions`
  // because React 18 StrictMode (dev only) invokes the effect body TWICE on
  // mount with NO re-render between the calls. The closure's `sessions`
  // would be [] in BOTH calls even after the first call's openNewTerminal
  // updated the store, so we'd accidentally spawn two tabs. getState reads
  // the live store and the second call short-circuits.
  useEffect(() => {
    if (!repoPath) return
    // Only spawn a shell if the BOTTOM panel itself is empty for this repo.
    // The previous check used the unfiltered session count, which broke
    // after the right-panel split: a single Claude session on the right
    // counted as "non-empty", so opening the bottom panel showed a blank
    // body until the user manually clicked +.
    const live = useStore.getState()
    const liveSessions = live.terminalsByRepo[repoPath] ?? []
    const hasBottomSession = liveSessions.some(s =>
      (live.sectionDock[`terminal:${s.id}`] ?? defaultDockFor(`terminal:${s.id}`, live)) === 'bottom'
    )
    if (!hasBottomSession) {
      openNewTerminal(repoPath)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, sessions.length])

  const onHandleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    dragState.current = { startY: e.clientY, startH: panelHeight }
    setDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const dy = dragState.current.startY - ev.clientY
      const next = Math.max(80, Math.min(window.innerHeight * 0.75, dragState.current.startH + dy))
      setPanelHeight(next)
    }
    const onUp = () => {
      dragState.current = null
      setDragging(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  if (!repoPath) return null

  return (
    <div className="terminal-panel" style={{ height: panelHeight }}>
      <div
        className={`term-resize-handle${dragging ? ' is-dragging' : ''}`}
        onMouseDown={onHandleMouseDown}
      />
      <div className="term-header">
        <span className="term-dot" />
        <div className="term-tabs">
          {sessions.map((s) => {
            const isAgent = !!s.agentId
            return (
              <button
                key={s.id}
                type="button"
                className={`term-tab${s.id === activeId ? ' active' : ''}${isAgent ? ' term-tab-agent' : ''}`}
                onClick={() => setActiveTerminal(repoPath, s.id)}
                title={s.title}
              >
                {isAgent && <i className="ti ti-robot" style={{ fontSize: 11, marginRight: 3 }} />}
                <span className="term-tab-label">{s.title}</span>
                {s.exited && (
                  <i
                    className="ti ti-check"
                    style={{ fontSize: 10, marginLeft: 2, opacity: 0.7 }}
                    title={t('terminal.agent_exited')}
                  />
                )}
                <span
                  role="button"
                  tabIndex={-1}
                  className="term-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    closeTerminal(repoPath, s.id)
                    // Match the exit-handler behavior: closing the last
                    // bottom tab via the × also collapses the panel.
                    const live = useStore.getState()
                    const remainingBottom = (live.terminalsByRepo[repoPath] ?? []).filter(x =>
                      x.id !== s.id &&
                      (live.sectionDock[`terminal:${x.id}`] ?? defaultDockFor(`terminal:${x.id}`, live)) === 'bottom'
                    )
                    if (remainingBottom.length === 0) live.setPanelOpen('bottom', false)
                  }}
                  title={t('common.close')}
                >
                  <i className="ti ti-x" />
                </span>
              </button>
            )
          })}
          <button
            type="button"
            className="term-tab term-tab-new"
            onClick={() => openNewTerminal(repoPath)}
            title={t('terminal.new_tab')}
          >
            <i className="ti ti-plus" />
          </button>
        </div>
        <span className="term-path">{repoPath}</span>
        <div className="term-actions">
          {/* No "dock to right" action: right panel owns tool sections +
              agent sessions; bottom panel owns shell terminals. The two
              don't swap. Use the right panel's agent launcher for AI
              workflows; use this panel for plain shells. */}
          <button
            className="term-btn"
            onClick={() => setTerminalOpen(false)}
            title={t('common.close')}
          >
            <i className="ti ti-chevron-down" />
          </button>
        </div>
      </div>
      <div className="term-bodies" style={{ position: 'relative', flex: 1 }}>
        {sessions.map((s) => (
          <div
            key={s.id}
            // visibility:hidden (not display:none) keeps the xterm container's
            // box at full size, so the FitAddon's measurements don't go to zero
            // when a tab isn't on top. Toggling back is a no-op refit.
            style={{
              position: 'absolute',
              inset: 0,
              visibility: s.id === activeId ? 'visible' : 'hidden',
              zIndex: s.id === activeId ? 1 : 0,
            }}
          >
            <TerminalPane session={s} isActive={s.id === activeId} repoPath={repoPath} panelHeight={panelHeight} />
          </div>
        ))}
        {sessions.length === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted, #888)',
              fontSize: 13,
            }}
          >
            {t('terminal.empty')}
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// TerminalPane — a single xterm bound to a PTY session
// ============================================================================

/**
 * One xterm instance + one PTY. Lives as long as its session is in the
 * store — closing the tab in the parent panel triggers `pty_close` AND
 * unmounts this component, which disposes the xterm and unsubscribes the
 * stream listeners. `isActive` controls whether pendingTerminalCommand
 * gets routed here.
 */
// Exported so the RightPanel host can render the exact same xterm + PTY
// wiring when a terminal session is docked to the right.
export function TerminalPane({
  session,
  isActive,
  repoPath,
  panelHeight,
}: {
  session: TermSession
  isActive: boolean
  repoPath: string
  /** Size hint that triggers a fit() re-run when changed. The actual fit
   *  comes from ResizeObserver, this is just a "panel resized, please
   *  re-fit now" pulse. Width or height — whichever the host changes. */
  panelHeight: number
}) {
  const theme = useStore((s) => s.theme)
  const pendingCmd = useStore((s) => s.pendingTerminalCommand)
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = xtermTheme()
  }, [theme])

  // Refit after panel height changes OR when this tab becomes the active one
  // (it may have been hidden while the panel was resized).
  useEffect(() => {
    fitRef.current?.fit()
    const term = xtermRef.current
    if (term) {
      invoke('pty_resize', {
        sessionId: session.id,
        rows: term.rows,
        cols: term.cols,
      }).catch(() => {})
    }
  }, [panelHeight, isActive, session.id])

  // Drain pendingTerminalCommand only on the active pane — typed-in commands
  // queued from the Sidebar's quick-run buttons should land in whatever
  // terminal the user is currently looking at, not all of them.
  useEffect(() => {
    if (!pendingCmd || !isActive) return
    invoke('pty_write', {
      sessionId: session.id,
      data: pendingCmd + '\n',
    }).catch(() => {})
    useStore.getState().consumeTerminalCommand()
  }, [pendingCmd, isActive, session.id])

  useEffect(() => {
    if (!containerRef.current) return

    // `alive` guards every step of the async chain below so React 18's
    // strict-mode double mount (dev only) can't end up with the disposed
    // mount-1 still attaching listeners or writing to a destroyed xterm.
    let alive = true

    const term = new XTerm({
      theme: xtermTheme(),
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "MesloLGS NF", "Fira Code", "Cascadia Code", "SF Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: false,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    xtermRef.current = term
    fitRef.current = fit

    let unOut: (() => void) | null = null
    let unExit: (() => void) | null = null
    let disposeOnData: { dispose: () => void } | null = null
    let disposeOnResize: { dispose: () => void } | null = null

    requestAnimationFrame(async () => {
      if (!alive) return
      fit.fit()

      // CRITICAL: subscribe to pty:out BEFORE opening the PTY. A shell prints
      // its prompt within milliseconds of spawn (zsh sources .zshrc, prints
      // PS1); if we listen second, that first frame of output gets emitted
      // into a world with no listeners and is dropped — xterm stays blank
      // until the user types and the shell speaks again. Symptom seen on
      // repo switches where a brand-new session never showed any prompt.
      const outFn = await listen<string>(`pty:out:${session.id}`, (evt) => {
        const bytes = decodeB64(evt.payload)
        term.write(bytes)
      })
      if (!alive) { outFn(); return }
      unOut = outFn

      // Agent tabs fire the auto-changelist promotion when their CLI exits,
      // then auto-close like shell tabs. Leaving the exited entry pinned in
      // the right strip used to confuse users — they'd ctrl+C an agent and
      // see a still-clickable button that opened an empty pane. The
      // changelist created during promotion preserves whatever file edits
      // the agent made, so closing the strip entry isn't lossy.
      //
      // Shell tabs already auto-close on exit (typing `exit` dismisses the
      // tab the same way a real terminal app would — leaving a dead
      // [process exited] tab is dead weight).
      const exitFn = await listen<void>(`pty:exit:${session.id}`, async () => {
        const store = useStore.getState()
        const repo = store.repoPath
        if (session.agentId) {
          store.markAgentTerminalExited(session.id)
          if (repo) {
            const updated = useStore
              .getState()
              .terminalsByRepo[repo]
              ?.find((s) => s.id === session.id)
            // Promote first (creates the "Claude @ 14:23" changelist),
            // THEN close — order matters because promoteAgentExitToChangelist
            // reads the session from the store, which closeTerminal would
            // have already deleted.
            if (updated) await promoteAgentExitToChangelist(updated)
            useStore.getState().closeTerminal(repo, session.id)
          }
        } else if (repo) {
          // Shell tab: close it. Forget the session so a future tab with
          // the same id (extremely unlikely but cheap) doesn't get a
          // stale ctrl+L nudge.
          openedSessions.delete(session.id)
          store.closeTerminal(repo, session.id)
          // Auto-collapse the bottom panel when its LAST shell exits. We
          // must filter by dock — an agent session on the right side
          // doesn't count toward "is there still something to show at
          // the bottom?"; before this filter, a Claude on the right kept
          // the empty bottom panel pinned open.
          const live = useStore.getState()
          const remainingBottom = (live.terminalsByRepo[repo] ?? []).filter(s =>
            (live.sectionDock[`terminal:${s.id}`] ?? defaultDockFor(`terminal:${s.id}`, live)) === 'bottom'
          )
          if (remainingBottom.length === 0) {
            live.setPanelOpen('bottom', false)
          }
        }
      })
      if (!alive) { exitFn(); return }
      unExit = exitFn

      try {
        // pty_open is idempotent on the Rust side: a second call with the
        // same session id is a no-op, so strict-mode double mount doesn't
        // spawn a duplicate shell.
        await invoke('pty_open', {
          sessionId: session.id,
          cwd: repoPath,
          rows: term.rows,
          cols: term.cols,
          // Agent tabs pass a custom command (the AI CLI) instead of $SHELL.
          // Plain shell tabs send null/null and Rust falls back to $SHELL -l.
          command: session.agentCommand ?? null,
          args: session.agentArgs ?? null,
        })
      } catch (e) {
        term.writeln(`\x1b[31mFailed to open PTY: ${e}\x1b[0m`)
        return
      }
      if (!alive) return

      // Only nudge with ctrl+L on RE-ATTACH (the user came back to a
      // still-alive PTY whose last frame our fresh xterm doesn't have).
      // For a brand-new session the shell prints its own prompt within
      // milliseconds, and sending ctrl+L too early made zsh echo a literal
      // `^L` into the first line of every new terminal.
      // [[feedback-terminal-no-ctrl-L-on-first-open]]
      if (!session.exited && openedSessions.has(session.id)) {
        invoke('pty_write', { sessionId: session.id, data: '\x0c' }).catch(() => {})
      }
      openedSessions.add(session.id)

      disposeOnData = term.onData((data) => {
        invoke('pty_write', { sessionId: session.id, data }).catch(() => {})
      })

      disposeOnResize = term.onResize(({ rows, cols }) => {
        invoke('pty_resize', { sessionId: session.id, rows, cols }).catch(() => {})
      })
    })

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(containerRef.current!)

    return () => {
      alive = false
      ro.disconnect()
      disposeOnData?.dispose()
      disposeOnResize?.dispose()
      unOut?.()
      unExit?.()
      // Intentionally do NOT call pty_close here. PTY lifecycle is owned by
      // the store's closeTerminal action so:
      //   - strict-mode double mount can re-attach to the existing PTY
      //   - toggling the panel off/on preserves sessions across visibility
      //   - tab close (the only "user wants this shell dead" path) fires
      //     pty_close explicitly via closeTerminal.
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id])

  return <div ref={containerRef} className="term-xterm" style={{ height: '100%' }} />
}
