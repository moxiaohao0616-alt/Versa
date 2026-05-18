import { useMemo } from 'react'
import type { DiffLine, DiffResult } from '../../store'

/** Side-by-side diff renderer. Pairs consecutive '-' / '+' runs so a
 *  modified line lines up across the two columns; mismatched run lengths
 *  fall through to one-sided rows. Not virtualized — used for human-scale
 *  diffs (under a few thousand lines). For the giant-diff path, the
 *  unified virtualized view is still the recommendation. */

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

function Hunk({ hunk }: { hunk: { header: string; lines: DiffLine[] } }) {
  const rows = useMemo(() => buildRows(hunk.lines), [hunk.lines])
  return (
    <div className="sbs-hunk">
      <div className="sbs-hunk-head">{hunk.header}</div>
      <div className="sbs-rows">
        {rows.map((r, i) => <Row key={i} row={r} />)}
      </div>
    </div>
  )
}

function Row({ row }: { row: SbsRow }) {
  const leftCls = row.left
    ? row.left.origin === '-'
      ? 'sbs-cell del'
      : row.right && row.left !== row.right ? 'sbs-cell del' : 'sbs-cell ctx'
    : 'sbs-cell empty'
  const rightCls = row.right
    ? row.right.origin === '+'
      ? 'sbs-cell add'
      : row.left && row.left !== row.right ? 'sbs-cell add' : 'sbs-cell ctx'
    : 'sbs-cell empty'
  return (
    <div className="sbs-row">
      <div className={leftCls}>
        <span className="sbs-ln">{row.left?.old_lineno ?? ''}</span>
        <span className="sbs-code">{row.left?.content || ' '}</span>
      </div>
      <div className={rightCls}>
        <span className="sbs-ln">{row.right?.new_lineno ?? ''}</span>
        <span className="sbs-code">{row.right?.content || ' '}</span>
      </div>
    </div>
  )
}
