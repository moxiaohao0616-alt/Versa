import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal as XTerm, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../../store'

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
  // Heuristic: a hex starting with 0/1/2 (or rgba with dark first channel)
  // means dark theme. Cheap and good enough.
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
  // Light palette — darker, more saturated ANSI shades so they're readable
  // on a cream / white background. Inspired by GitHub Light + Solarized.
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

export function Terminal() {
  const { t } = useTranslation()
  const { repoPath, setTerminalOpen, theme } = useStore()
  const pendingCmd = useStore(s => s.pendingTerminalCommand)
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  // Active session id. We re-generate it on each mount-effect run (rather
  // than pinning to a useRef initial value) so React 18 strict-mode's
  // double-mount in dev doesn't have mount #2 inherit mount #1's exit
  // event — the previous session's [shell exited] used to land in the
  // fresh listener and print spuriously above the live prompt.
  const sessionId = useRef<string>('')
  const [panelHeight, setPanelHeight] = useState(280)
  const [dragging, setDragging] = useState(false)
  const dragState = useRef<{ startY: number; startH: number } | null>(null)

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

  useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = xtermTheme()
  }, [theme])

  // Refit after height change (after DOM has updated)
  useEffect(() => {
    fitRef.current?.fit()
    const term = xtermRef.current
    if (term) {
      invoke('pty_resize', {
        sessionId: sessionId.current,
        rows: term.rows,
        cols: term.cols,
      }).catch(() => {})
    }
  }, [panelHeight])

  // Drain external commands queued via store.pendingTerminalCommand —
  // typically from Sidebar's project quick-run buttons. With a real PTY,
  // we just type them in (followed by newline) — the shell handles
  // execution and we'll see the output naturally.
  useEffect(() => {
    if (!pendingCmd) return
    invoke('pty_write', {
      sessionId: sessionId.current,
      data: pendingCmd + '\n',
    }).catch(() => {})
    useStore.getState().consumeTerminalCommand()
  }, [pendingCmd])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      theme: xtermTheme(),
      fontFamily: '"JetBrainsMono Nerd Font", "JetBrains Mono", "MesloLGS NF", "Fira Code", "Cascadia Code", "SF Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
      convertEol: false, // PTY emits raw bytes; let \r\n through verbatim
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    xtermRef.current = term
    fitRef.current = fit

    // Fresh session id per effect run — see ref declaration for why.
    const sid = `s${Math.random().toString(36).slice(2)}`
    sessionId.current = sid
    let unOut: (() => void) | null = null
    let unExit: (() => void) | null = null
    let disposeOnData: { dispose: () => void } | null = null
    let disposeOnResize: { dispose: () => void } | null = null

    requestAnimationFrame(async () => {
      fit.fit()
      // Falls back to the user's home dir via the shell's own `cd` on
      // startup (login shells `cd $HOME` by default) when no repo is open.
      const cwd = useStore.getState().repoPath ?? ''

      try {
        await invoke('pty_open', {
          sessionId: sid,
          cwd,
          rows: term.rows,
          cols: term.cols,
        })
      } catch (e) {
        term.writeln(`\x1b[31mFailed to open PTY: ${e}\x1b[0m`)
        return
      }

      // PTY → xterm
      const outFn = await listen<string>(`pty:out:${sid}`, evt => {
        const bytes = decodeB64(evt.payload)
        // xterm.write accepts Uint8Array for raw bytes.
        term.write(bytes)
      })
      unOut = outFn

      // Keep an exit listener so we can extend behavior later (auto-reopen
      // banner, restore button etc.), but stay silent for now — the prompt
      // is gone, the user can see that. Spurious lines during dev
      // strict-mode double mounts were the original reason this fires.
      const exitFn = await listen<void>(`pty:exit:${sid}`, () => {})
      unExit = exitFn

      // xterm input → PTY
      disposeOnData = term.onData(data => {
        invoke('pty_write', { sessionId: sid, data }).catch(() => {})
      })

      // xterm resize → PTY resize
      disposeOnResize = term.onResize(({ rows, cols }) => {
        invoke('pty_resize', { sessionId: sid, rows, cols }).catch(() => {})
      })
    })

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(containerRef.current!)

    return () => {
      ro.disconnect()
      disposeOnData?.dispose()
      disposeOnResize?.dispose()
      unOut?.()
      unExit?.()
      invoke('pty_close', { sessionId: sid }).catch(() => {})
      term.dispose()
    }
  }, [])

  return (
    <div className="terminal-panel" style={{ height: panelHeight }}>
      <div
        className={`term-resize-handle${dragging ? ' is-dragging' : ''}`}
        onMouseDown={onHandleMouseDown}
      />
      <div className="term-header">
        <span className="term-dot" />
        <span className="term-title">{t('terminal.header')}</span>
        <span className="term-path">{repoPath}</span>
        <div className="term-actions">
          <button className="term-btn" onClick={() => xtermRef.current?.clear()} title={t('common.refresh')}>
            <i className="ti ti-eraser" />
          </button>
          <button className="term-btn" onClick={() => setTerminalOpen(false)} title={t('common.close')}>
            <i className="ti ti-chevron-down" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="term-xterm" />
    </div>
  )
}
