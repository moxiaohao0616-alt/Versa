import { useEffect, useMemo, useRef } from 'react'
import type { DiffLine, DiffResult } from '../../store'

/** Side-by-side diff renderer. Pairs consecutive '-' / '+' runs so a
 *  modified line lines up across the two columns; mismatched run lengths
 *  fall through to one-sided rows. Not virtualized — used for human-scale
 *  diffs (under a few thousand lines). For the giant-diff path, the
 *  unified virtualized view is still the recommendation.
 *
 *  Layout: each hunk renders two stacked vertical columns (left = base,
 *  right = head). Each column has its own horizontal scrollbar; the two
 *  scroll positions are kept in sync — scroll one, the other follows.
 *  Rows align across columns because every cell shares the same minimum
 *  height and the row counts match by construction. */

interface SbsRow {
  left: DiffLine | null
  right: DiffLine | null
}

function buildRows(lines: DiffLine[]): SbsRow[] {
  const rows: SbsRow[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []

  const flushPair = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) {
      rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    }
    dels = []
    adds = []
  }

  for (const line of lines) {
    if (line.origin === '-') {
      dels.push(line)
    } else if (line.origin === '+') {
      adds.push(line)
    } else {
      // context line — flush any pending +/- run, then mirror on both
      flushPair()
      rows.push({ left: line, right: line })
    }
  }
  flushPair()
  return rows
}

export function SideBySideDiff({
  diff,
  showFileHeaders,
}: {
  diff: DiffResult[]
  showFileHeaders: boolean
}) {
  return (
    <div className="sbs-diff">
      {diff.map(d => (
        <FileBlock key={d.file} file={d} showHeader={showFileHeaders} />
      ))}
    </div>
  )
}

function FileBlock({ file, showHeader }: { file: DiffResult; showHeader: boolean }) {
  return (
    <div className="sbs-file">
      {showHeader && (
        <div className="sbs-file-head">
          <i className="ti ti-file-code" />
          {file.file}
        </div>
      )}
      {file.hunks.map((h, hi) => (
        <Hunk key={hi} hunk={h} />
      ))}
    </div>
  )
}

function cellClass(line: DiffLine | null): string {
  if (!line) return 'sbs-cell empty'
  if (line.origin === '-') return 'sbs-cell del'
  if (line.origin === '+') return 'sbs-cell add'
  return 'sbs-cell ctx'
}

function Hunk({ hunk }: { hunk: { header: string; lines: DiffLine[] } }) {
  const rows = useMemo(() => buildRows(hunk.lines), [hunk.lines])
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)

  // Keep the two sides' horizontal scroll positions linked. The "ignore the
  // next echo from the other side" flag prevents the assignment-triggered
  // scroll event from ping-ponging back. This doesn't rely on scroll-event
  // timing (sync vs queued) — the next scroll on the destination side just
  // consumes its ignore flag and bails.
  useEffect(() => {
    const L = leftRef.current
    const R = rightRef.current
    if (!L || !R) return
    let ignoreL = false
    let ignoreR = false
    const onL = () => {
      if (ignoreL) { ignoreL = false; return }
      ignoreR = true
      R.scrollLeft = L.scrollLeft
    }
    const onR = () => {
      if (ignoreR) { ignoreR = false; return }
      ignoreL = true
      L.scrollLeft = R.scrollLeft
    }
    L.addEventListener('scroll', onL, { passive: true })
    R.addEventListener('scroll', onR, { passive: true })
    return () => {
      L.removeEventListener('scroll', onL)
      R.removeEventListener('scroll', onR)
    }
  }, [])

  return (
    <div className="sbs-hunk">
      <div className="sbs-hunk-head">{hunk.header}</div>
      <div className="sbs-sides">
        <div className="sbs-side sbs-side-left" ref={leftRef}>
          {rows.map((r, i) => (
            <div key={i} className={cellClass(r.left)}>
              <span className="sbs-ln">{r.left?.old_lineno ?? ''}</span>
              <span className="sbs-code">{r.left?.content || ' '}</span>
            </div>
          ))}
        </div>
        <div className="sbs-side sbs-side-right" ref={rightRef}>
          {rows.map((r, i) => (
            <div key={i} className={cellClass(r.right)}>
              <span className="sbs-ln">{r.right?.new_lineno ?? ''}</span>
              <span className="sbs-code">{r.right?.content || ' '}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
