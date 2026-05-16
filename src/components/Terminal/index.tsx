import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../../store'

function xtermTheme(): ITheme {
  const s = getComputedStyle(document.documentElement)
  const get = (v: string) => s.getPropertyValue(v).trim()
  const bg = get('--term-bg') || '#141412'
  const fg = get('--term-fg') || 'rgba(255,255,255,0.82)'
  const fg2 = get('--term-fg2') || 'rgba(255,255,255,0.3)'
  const green = get('--green') || '#639922'
  const isDark = bg.startsWith('#1') || bg.startsWith('#0') || bg === '#141412'
  return {
    background: bg,
    foreground: fg,
    cursor: green,
    cursorAccent: bg,
    selectionBackground: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)',
    black: isDark ? '#1a1a18' : '#1a1a18',
    brightBlack: fg2,
    white: isDark ? '#e8e8e4' : '#f5f5f3',
    brightWhite: fg,
    green,
    brightGreen: '#7db82a',
    red: '#e24b4a',
    brightRed: '#f09595',
    yellow: '#c8922a',
    brightYellow: '#d4aa50',
    blue: '#3a7fc1',
    brightBlue: '#5a9fd4',
    magenta: '#9a6ab0',
    brightMagenta: '#b088c4',
    cyan: '#2a9a8a',
    brightCyan: '#3ab8a8',
  }
}

export function Terminal() {
  const { repoPath, setTerminalOpen, theme } = useStore()
  const pendingCmd = useStore(s => s.pendingTerminalCommand)
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  /** Exposed so a separate effect can run commands queued via store. */
  const runCommandRef = useRef<((cmd: string) => Promise<void>) | null>(null)
  const sessionId = useRef(`s${Math.random().toString(36).slice(2)}`)
  const lineBuffer = useRef('')
  const cursorPos = useRef(0)   // logical position within lineBuffer
  const history = useRef<string[]>([])
  const historyIdx = useRef(-1)
  const savedLine = useRef('')
  const [panelHeight, setPanelHeight] = useState(220)
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
      const next = Math.max(80, Math.min(window.innerHeight * 0.7, dragState.current.startH + dy))
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

  // Sync xterm theme when app theme changes
  useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = xtermTheme()
  }, [theme])

  // Refit after height change (after DOM has updated)
  useEffect(() => {
    fitRef.current?.fit()
  }, [panelHeight])

  // Drain external commands queued via store.pendingTerminalCommand —
  // typically from Sidebar's project quick-run buttons.
  useEffect(() => {
    if (!pendingCmd) return
    const term = xtermRef.current
    const run = runCommandRef.current
    if (!term || !run) return
    // Echo the command at the prompt so the user sees what's running, then
    // execute via the same path keyboard input takes. The line buffer stays
    // empty — these don't interact with the user's typed input.
    term.write(pendingCmd)
    term.writeln('')
    run(pendingCmd)
    useStore.getState().consumeTerminalCommand()
  }, [pendingCmd])

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      theme: xtermTheme(),
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 12,
      lineHeight: 1.6,
      cursorBlink: true,
      scrollback: 2000,
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    xtermRef.current = term
    fitRef.current = fit
    requestAnimationFrame(() => fit.fit())

    prompt(term)

    const runCommand = async (cmd: string) => {
      if (cmd.trim() === 'clear') {
        term.write('\x1b[3J\x1b[2J\x1b[H')
        prompt(term)
        return
      }
      try {
        // Re-read repoPath at call time: Terminal is mounted once but the
        // active tab (and thus cwd) can change.
        const cwd = useStore.getState().repoPath ?? '/'
        const code = await invoke<number>('run_shell', {
          sessionId: sessionId.current,
          cmd,
          cwd,
        })
        if (code !== 0) term.writeln(`\x1b[33m[exit ${code}]\x1b[0m`)
      } catch (e) {
        term.writeln(`\x1b[31mError: ${e}\x1b[0m`)
      }
      prompt(term)
      if (cmd.trim().startsWith('git ')) useStore.getState().refreshRepo()
    }
    runCommandRef.current = runCommand

    term.onData((data) => {
      const buf = lineBuffer.current
      const pos = cursorPos.current
      const tail = buf.slice(pos)           // text after cursor
      const tailW = strWidth(tail)          // display columns of tail

      if (data === '\r') { // Enter
        const cmd = buf
        lineBuffer.current = ''
        cursorPos.current = 0
        term.writeln('')
        if (cmd.trim()) {
          history.current.unshift(cmd)
          historyIdx.current = -1
          savedLine.current = ''
          runCommand(cmd)
        } else {
          prompt(term)
        }

      } else if (data === '\x7f') { // Backspace — delete char before cursor
        if (pos > 0) {
          const ch = buf[pos - 1]
          const cw = charWidth(ch)
          const newBuf = buf.slice(0, pos - 1) + tail
          lineBuffer.current = newBuf
          cursorPos.current = pos - 1
          // move back cw cols, write tail, erase cw extra cols, reposition
          term.write(`\x1b[${cw}D` + tail + ' '.repeat(cw) + `\x1b[${tailW + cw}D`)
        }

      } else if (data === '\x1b[D' || data === '\x1b[1D') { // ← Left
        if (pos > 0) {
          const cw = charWidth(buf[pos - 1])
          cursorPos.current = pos - 1
          term.write(`\x1b[${cw}D`)
        }

      } else if (data === '\x1b[C' || data === '\x1b[1C') { // → Right
        if (pos < buf.length) {
          const cw = charWidth(buf[pos])
          cursorPos.current = pos + 1
          term.write(`\x1b[${cw}C`)
        }

      } else if (data === '\x1b[A') { // ↑ Up — history
        if (historyIdx.current === -1) savedLine.current = buf
        historyIdx.current = Math.min(historyIdx.current + 1, history.current.length - 1)
        const val = history.current[historyIdx.current] ?? ''
        overwriteLine(term, val)
        lineBuffer.current = val
        cursorPos.current = val.length

      } else if (data === '\x1b[B') { // ↓ Down — history
        historyIdx.current = Math.max(historyIdx.current - 1, -1)
        const val = historyIdx.current >= 0
          ? (history.current[historyIdx.current] ?? '')
          : savedLine.current
        overwriteLine(term, val)
        lineBuffer.current = val
        cursorPos.current = val.length

      } else if (data === '\x01') { // Ctrl+A — 行首
        if (pos > 0) {
          term.write(`\x1b[${strWidth(buf.slice(0, pos))}D`)
          cursorPos.current = 0
        }

      } else if (data === '\x05') { // Ctrl+E — 行尾
        if (pos < buf.length) {
          term.write(`\x1b[${tailW}C`)
          cursorPos.current = buf.length
        }

      } else if (data === '\x03') { // Ctrl+C — 取消
        term.writeln('^C')
        lineBuffer.current = ''
        cursorPos.current = 0
        historyIdx.current = -1
        prompt(term)

      } else if (data === '\x0c') { // Ctrl+L — 清屏
        term.write('\x1b[3J\x1b[2J\x1b[H')
        prompt(term)

      } else if (data.startsWith('\x1b')) {
        // 忽略其他 escape 序列（Home/End/PageUp/Delete 等）

      } else {
        // 可打印字符（ASCII、中文、emoji 等）：在光标处插入
        const newBuf = buf.slice(0, pos) + data + tail
        lineBuffer.current = newBuf
        cursorPos.current = pos + data.length
        if (tailW > 0) {
          // 写入字符 + 尾部，然后把光标退回到插入点之后
          term.write(data + tail + `\x1b[${tailW}D`)
        } else {
          term.write(data)
        }
      }
    })

    const sid = sessionId.current
    const unOut = listen<string>(`term:out:${sid}`, e => term.writeln(e.payload))
    const unErr = listen<string>(`term:err:${sid}`, e =>
      term.writeln(`\x1b[31m${e.payload}\x1b[0m`)
    )

    const ro = new ResizeObserver(() => fitRef.current?.fit())
    ro.observe(containerRef.current!)

    return () => {
      term.dispose()
      ro.disconnect()
      unOut.then(fn => fn())
      unErr.then(fn => fn())
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
        <span className="term-title">Terminal</span>
        <span className="term-path">{repoPath}</span>
        <div className="term-actions">
          <button className="term-btn" onClick={() => xtermRef.current?.clear()} title="清空">
            <i className="ti ti-eraser" />
          </button>
          <button className="term-btn" onClick={() => setTerminalOpen(false)} title="收起 (⌘`)">
            <i className="ti ti-chevron-down" />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="term-xterm" />
    </div>
  )
}

function prompt(term: XTerm) {
  term.write('\x1b[32m$\x1b[0m ')
}

function overwriteLine(term: XTerm, val: string) {
  term.write(`\r\x1b[2K\x1b[32m$\x1b[0m ${val}`)
}

// Returns the display width (terminal columns) of a single character
function charWidth(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0
  if (cp < 0x1100) return 1
  if (
    cp <= 0x115F ||                          // Hangul Jamo
    (cp >= 0x2E80 && cp <= 0x303E) ||        // CJK Radicals / Kangxi
    (cp >= 0x3040 && cp <= 0xA4CF) ||        // Hiragana / Katakana / CJK Unified
    (cp >= 0xA960 && cp <= 0xA97F) ||        // Hangul Extension-A
    (cp >= 0xAC00 && cp <= 0xD7FF) ||        // Hangul Syllables
    (cp >= 0xF900 && cp <= 0xFAFF) ||        // CJK Compatibility Ideographs
    (cp >= 0xFF01 && cp <= 0xFF60) ||        // Fullwidth ASCII & punctuation
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||        // Fullwidth signs
    (cp >= 0x1F300 && cp <= 0x1F9FF) ||      // Emoji / Misc Symbols
    (cp >= 0x20000 && cp <= 0x2FFFD) ||      // CJK Extension B-F
    (cp >= 0x30000 && cp <= 0x3FFFD)         // CJK Extension G+
  ) return 2
  return 1
}

// Total display width of a string
function strWidth(s: string): number {
  let w = 0
  for (const ch of s) w += charWidth(ch)
  return w
}
