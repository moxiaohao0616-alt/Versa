import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n from '../../i18n'
import { useStore } from '../../store'
import type { DiffLine, DiffResult } from '../../store'
import { buildHunkInlineDiffs, type CharSeg } from './wordDiff'
import { detectLanguage, highlightLine } from './highlight'
import { BlameModal } from '../Blame'
import { FileHistoryModal } from '../FileHistory'
import { BlockHistoryModal } from '../BlockHistory'
import { SideBySideDiff } from './SideBySide'

// Fixed row heights for the virtual list. Keep in sync with the CSS for each
// item's content height — see .diff-file-header, .hunk-header, .diff-line.
const ROW_H = { file: 30, hunk: 24, line: 20 } as const
const OVERSCAN_ROWS = 15

type VItem =
  | { kind: 'file';  file: string }
  | { kind: 'hunk';  header: string; file: string; hunkIndex: number; stageable: 'stage' | 'unstage' | null }
  | { kind: 'line';  line: DiffLine;  inline: CharSeg[] | undefined;  lang: string | null }

function rowH(item: VItem): number {
  return ROW_H[item.kind]
}

/**
 * Flatten the structured diff into one row stream the virtualizer can index.
 * Word-level inline diffs are precomputed per hunk here (cheap, O(lines/hunk))
 * so each visible line render is just a hash-map lookup + hljs highlight.
 */
function flatten(diff: DiffResult[], stageable: 'stage' | 'unstage' | null, wordLevel: boolean): VItem[] {
  const out: VItem[] = []
  // The header bar above already shows the filename. Only emit per-file
  // separators inside the list when there's more than one file (e.g. viewing
  // a whole commit's changes).
  const showFileHeaders = diff.length > 1
  for (const d of diff) {
    const lang = detectLanguage(d.file)
    if (showFileHeaders) out.push({ kind: 'file', file: d.file })
    for (let hi = 0; hi < d.hunks.length; hi++) {
      const hunk = d.hunks[hi]
      out.push({ kind: 'hunk', header: hunk.header, file: d.file, hunkIndex: hi, stageable })
      const inlineMap = wordLevel ? buildHunkInlineDiffs(hunk.lines) : null
      for (let li = 0; li < hunk.lines.length; li++) {
        out.push({
          kind: 'line',
          line: hunk.lines[li],
          inline: inlineMap?.get(li),
          lang,
        })
      }
    }
  }
  return out
}

function computeOffsets(items: VItem[]): { offsets: number[]; total: number } {
  const offsets = new Array<number>(items.length)
  let total = 0
  for (let i = 0; i < items.length; i++) {
    offsets[i] = total
    total += rowH(items[i])
  }
  return { offsets, total }
}

/** Binary search: first item index where item bottom > y. */
function firstAtOrBelow(offsets: number[], items: VItem[], y: number): number {
  let lo = 0
  let hi = offsets.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid] + rowH(items[mid]) <= y) lo = mid + 1
    else hi = mid
  }
  return Math.min(lo, items.length - 1)
}

/** Binary search: last item index where item top < y. */
function lastAtOrAbove(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid] >= y) hi = mid
    else lo = mid + 1
  }
  return Math.max(0, lo - 1)
}

export function DiffView() {
  const { t } = useTranslation()
  const {
    diff, selectedFile, repoStatus, selectedFileStaged, selectedCommit, repoPath,
    stageHunk, unstageHunk, discardHunk, showToast,
    diffWordLevel, diffIgnoreWhitespace, diffSideBySide,
    setDiffWordLevel, setDiffIgnoreWhitespace, setDiffSideBySide,
  } = useStore()
  const hasFiles = (repoStatus?.files.length ?? 0) > 0
  // Hunk stage/unstage only makes sense for working-tree diffs (not viewing a
  // historical commit). Direction depends on which side we're looking at.
  const stageable: 'stage' | 'unstage' | null = selectedCommit ? null : (selectedFileStaged ? 'unstage' : 'stage')
  const [blameOpen, setBlameOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [blockHistory, setBlockHistory] = useState<{ start: number; end: number } | null>(null)
  /** Pill that appears next to a text selection inside the diff. Reading
   *  the actual line numbers from data-line-no on the surrounding row. */
  const [selectionPill, setSelectionPill] = useState<
    { x: number; y: number; start: number; end: number } | null
  >(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchHit, setSearchHit] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Stats stay computed over the full list — cheap, just three array passes.
  const added   = useMemo(
    () => diff.flatMap(d => d.hunks).flatMap(h => h.lines).filter(l => l.origin === '+').length,
    [diff]
  )
  const removed = useMemo(
    () => diff.flatMap(d => d.hunks).flatMap(h => h.lines).filter(l => l.origin === '-').length,
    [diff]
  )

  const items = useMemo(() => flatten(diff, stageable, diffWordLevel), [diff, stageable, diffWordLevel])
  const { offsets, total } = useMemo(() => computeOffsets(items), [items])

  // Indices of all hunk-kind items, in order — for next/prev navigation.
  const hunkIndices = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < items.length; i++) if (items[i].kind === 'hunk') out.push(i)
    return out
  }, [items])

  // File-header indices — for cross-file navigation with ⌘↓/⌘↑.
  const fileIndices = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i < items.length; i++) if (items[i].kind === 'file') out.push(i)
    return out
  }, [items])

  // Indices of line items whose content contains the search query
  // (case-insensitive). Recomputed only when items or query change.
  const searchHits = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return [] as number[]
    const out: number[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.kind === 'line' && it.line.content.toLowerCase().includes(q)) out.push(i)
    }
    return out
  }, [items, searchQuery])
  // Keep searchHit within range when hits change.
  useEffect(() => {
    if (searchHits.length === 0) { setSearchHit(0); return }
    if (searchHit >= searchHits.length) setSearchHit(0)
  }, [searchHits])

  // App-level Cmd+F dispatches this custom event — DiffView opens the bar
  // and focuses the input. Decoupled so App.tsx doesn't poke DiffView state.
  useEffect(() => {
    const onOpen = () => {
      setSearchOpen(true)
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
    window.addEventListener('versa:open-diff-search', onOpen)
    return () => window.removeEventListener('versa:open-diff-search', onOpen)
  }, [])

  const scrollToHit = (hitIdx: number) => {
    if (searchHits.length === 0) return
    const i = ((hitIdx % searchHits.length) + searchHits.length) % searchHits.length
    const itemIdx = searchHits[i]
    const top = offsets[itemIdx]
    const el = containerRef.current
    if (!el) return
    // Centre the row in the viewport when possible.
    el.scrollTop = Math.max(0, top - viewportH / 2 + rowH(items[itemIdx]) / 2)
    setSearchHit(i)
  }

  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(600)

  // Track scroll position + viewport height of the .diff-content container.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    setViewportH(el.clientHeight)
    const ro = new ResizeObserver(() => setViewportH(el.clientHeight))
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  // Diff content changed (selectedFile or hunk reshuffle): reset to top.
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = 0
      setScrollTop(0)
    }
  }, [diff])

  let startIdx = 0
  let endIdx = -1
  if (items.length > 0) {
    startIdx = firstAtOrBelow(offsets, items, scrollTop)
    endIdx   = lastAtOrAbove(offsets, scrollTop + viewportH)
    startIdx = Math.max(0, startIdx - OVERSCAN_ROWS)
    endIdx   = Math.min(items.length - 1, endIdx + OVERSCAN_ROWS)
  }

  // Which hunk is the user "at"? Largest hunkIndex whose top is at-or-above
  // the current scrollTop. Used to label "N / M" and to anchor the prev jump.
  const currentHunkOrdinal = useMemo(() => {
    if (hunkIndices.length === 0) return -1
    // Binary search
    let lo = 0
    let hi = hunkIndices.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[hunkIndices[mid]] <= scrollTop + 4) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo - 1)
  }, [scrollTop, hunkIndices, offsets])

  const scrollToHunk = (hunkIdx: number) => {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: offsets[hunkIdx], behavior: 'smooth' })
  }

  const canPrev = hunkIndices.length > 0 && (
    currentHunkOrdinal > 0 ||
    // Or: we're past the current hunk's top — first prev snaps back to it.
    (currentHunkOrdinal >= 0 && scrollTop > offsets[hunkIndices[currentHunkOrdinal]] + 4)
  )
  const canNext = hunkIndices.length > 0 && currentHunkOrdinal + 1 < hunkIndices.length

  const goPrev = () => {
    if (currentHunkOrdinal < 0) return
    const currOff = offsets[hunkIndices[currentHunkOrdinal]]
    // If user has scrolled past the current hunk's start, snap back to it first.
    if (scrollTop > currOff + 4) {
      scrollToHunk(hunkIndices[currentHunkOrdinal])
    } else if (currentHunkOrdinal > 0) {
      scrollToHunk(hunkIndices[currentHunkOrdinal - 1])
    }
  }

  const goNext = () => {
    if (currentHunkOrdinal + 1 < hunkIndices.length) {
      scrollToHunk(hunkIndices[currentHunkOrdinal + 1])
    }
  }

  // File navigation analog — same snap-to-current behavior.
  const currentFileOrdinal = useMemo(() => {
    if (fileIndices.length === 0) return -1
    let lo = 0
    let hi = fileIndices.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (offsets[fileIndices[mid]] <= scrollTop + 4) lo = mid + 1
      else hi = mid
    }
    return Math.max(0, lo - 1)
  }, [scrollTop, fileIndices, offsets])

  const canPrevFile = fileIndices.length > 0 && (
    currentFileOrdinal > 0 ||
    (currentFileOrdinal >= 0 && scrollTop > offsets[fileIndices[currentFileOrdinal]] + 4)
  )
  const canNextFile = fileIndices.length > 1 && currentFileOrdinal + 1 < fileIndices.length

  const goPrevFile = () => {
    if (currentFileOrdinal < 0) return
    const currOff = offsets[fileIndices[currentFileOrdinal]]
    if (scrollTop > currOff + 4) scrollToHunk(fileIndices[currentFileOrdinal])
    else if (currentFileOrdinal > 0) scrollToHunk(fileIndices[currentFileOrdinal - 1])
  }
  const goNextFile = () => {
    if (currentFileOrdinal + 1 < fileIndices.length) {
      scrollToHunk(fileIndices[currentFileOrdinal + 1])
    }
  }

  // Keyboard:
  //   Alt + ↑ / ↓  — prev/next hunk
  //   ⌘   + ↑ / ↓  — prev/next file header (only if multi-file diff)
  useEffect(() => {
    if (items.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return

      // File-level nav: ⌘ / Ctrl + arrow (no Shift, no Alt)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (e.key === 'ArrowDown' && fileIndices.length > 1) { e.preventDefault(); goNextFile() }
        else if (e.key === 'ArrowUp' && fileIndices.length > 1) { e.preventDefault(); goPrevFile() }
        return
      }

      // Hunk-level nav: Alt + arrow
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        if (e.key === 'ArrowDown' && hunkIndices.length > 0) { e.preventDefault(); goNext() }
        else if (e.key === 'ArrowUp' && hunkIndices.length > 0) { e.preventDefault(); goPrev() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hunkIndices, fileIndices, currentHunkOrdinal, currentFileOrdinal, scrollTop, offsets])

  // Watch text selection inside the diff container. When the user drags
  // across one or more `.diff-line[data-line-no]` rows, pop a small pill
  // next to the cursor offering "Block history for these lines". The pill
  // uses the new-side line numbers so the lookup matches what the user
  // sees in the right-hand gutter.
  useEffect(() => {
    const onSelChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelectionPill(null)
        return
      }
      const range = sel.getRangeAt(0)
      const root = containerRef.current
      if (!root || !root.contains(range.commonAncestorContainer)) {
        setSelectionPill(null)
        return
      }
      const findLineRow = (node: Node | null): HTMLElement | null => {
        let n: Node | null = node
        while (n && n !== root) {
          if (n instanceof HTMLElement && n.classList.contains('diff-line')) return n
          n = n.parentNode
        }
        return null
      }
      const startRow = findLineRow(range.startContainer)
      const endRow = findLineRow(range.endContainer)
      const collect = (start: HTMLElement, end: HTMLElement): number[] => {
        const all = Array.from(root.querySelectorAll<HTMLElement>('.diff-line[data-line-no]'))
        const startIdx = all.indexOf(start)
        const endIdx = all.indexOf(end)
        if (startIdx < 0 || endIdx < 0) return []
        const [a, b] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const nums: number[] = []
        for (let i = a; i <= b; i++) {
          const n = Number(all[i].dataset.lineNo)
          if (Number.isFinite(n) && n > 0) nums.push(n)
        }
        return nums
      }
      if (!startRow || !endRow) { setSelectionPill(null); return }
      const nums = collect(startRow, endRow)
      if (nums.length === 0) { setSelectionPill(null); return }
      const lo = Math.min(...nums)
      const hi = Math.max(...nums)
      // Anchor pill to the end of the user's selection (mouse-up point).
      const rect = range.getBoundingClientRect()
      setSelectionPill({
        x: Math.min(rect.right + 8, window.innerWidth - 200),
        y: rect.bottom + 6,
        start: lo,
        end: hi,
      })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [])

  return (
    <div className="diff-view">
      {diff.length > 0 && (
        <div className="diff-header">
          <button
            type="button"
            className="diff-filename"
            title={selectedFile ? `${t('diff.copy_path_tooltip')}\n${repoPath ? `${repoPath}/${selectedFile}` : selectedFile}` : ''}
            onClick={async () => {
              if (!selectedFile) return
              const abs = repoPath ? `${repoPath}/${selectedFile}` : selectedFile
              try {
                await navigator.clipboard.writeText(abs)
                showToast(t('diff.path_copied'), 'success')
              } catch (e) {
                showToast(String(e), 'error')
              }
            }}
          >
            <i className="ti ti-file-code" />
            {/* Wrapper does the RTL truncation (ellipsis lands on the LEFT
                so the filename tail stays visible); the inner bdo forces
                LTR so each character keeps its real order. */}
            <span className="diff-filename-path">
              <bdo dir="ltr">{selectedFile}</bdo>
            </span>
            <i className="ti ti-copy diff-filename-copy" />
          </button>
          <div className="diff-header-right">
            <div className="diff-stats">
              <span className="added">+{added}</span>
              <span className="removed">-{removed}</span>
            </div>
            <button
              className={`ct-btn ghost ${diffSideBySide ? 'active' : ''}`}
              onClick={() => setDiffSideBySide(!diffSideBySide)}
              title={t('diff.side_by_side_tooltip')}
            >
              <i className="ti ti-columns" />
              <span>{t('diff.side_by_side')}</span>
            </button>
            <button
              className={`ct-btn ghost ${diffWordLevel ? 'active' : ''}`}
              onClick={() => setDiffWordLevel(!diffWordLevel)}
              title={t('diff.word_level_tooltip')}
            >
              <i className="ti ti-letter-w" />
              <span>{t('diff.word_level')}</span>
            </button>
            <button
              className={`ct-btn ghost ${diffIgnoreWhitespace ? 'active' : ''}`}
              onClick={() => setDiffIgnoreWhitespace(!diffIgnoreWhitespace)}
              title={t('diff.ignore_whitespace_tooltip')}
            >
              <i className="ti ti-space" />
              <span>{t('diff.ignore_whitespace')}</span>
            </button>
            {selectedFile && (
              <>
                <button
                  className="ct-btn ghost"
                  onClick={() => setHistoryOpen(true)}
                  title={t('diff.file_history_tooltip')}
                >
                  <i className="ti ti-history" />
                  <span>{t('diff.file_history')}</span>
                </button>
                <button
                  className="ct-btn ghost"
                  onClick={() => setBlameOpen(true)}
                  title={t('diff.blame_tooltip')}
                >
                  <i className="ti ti-user-search" />
                  <span>{t('diff.blame')}</span>
                </button>
              </>
            )}
            {fileIndices.length > 1 && (
              <div className="diff-hunk-nav" title="文件级跳转">
                <button
                  className="ct-btn ghost"
                  onClick={goPrevFile}
                  disabled={!canPrevFile}
                  title={t('diff.prev_file')}
                >
                  <i className="ti ti-chevrons-up" />
                </button>
                <span className="diff-hunk-pos">
                  📄 {currentFileOrdinal + 1} / {fileIndices.length}
                </span>
                <button
                  className="ct-btn ghost"
                  onClick={goNextFile}
                  disabled={!canNextFile}
                  title={t('diff.next_file')}
                >
                  <i className="ti ti-chevrons-down" />
                </button>
              </div>
            )}
            {/* Hide hunk nav when it'd be redundant with file nav — i.e. every
                file has exactly one hunk and the two controls would step in
                lockstep (matters most for synthesized untracked-dir diffs,
                where each file is rendered as a single big add-only hunk). */}
            {hunkIndices.length > 0 && hunkIndices.length > fileIndices.length && (
              <div className="diff-hunk-nav">
                <button
                  className="ct-btn ghost"
                  onClick={goPrev}
                  disabled={!canPrev}
                  title={t('diff.prev_hunk')}
                >
                  <i className="ti ti-chevron-up" />
                </button>
                <span className="diff-hunk-pos">
                  {currentHunkOrdinal + 1} / {hunkIndices.length}
                </span>
                <button
                  className="ct-btn ghost"
                  onClick={goNext}
                  disabled={!canNext}
                  title={t('diff.next_hunk')}
                >
                  <i className="ti ti-chevron-down" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {searchOpen && (
        <div className="diff-search-bar">
          <i className="ti ti-search" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder={t('diff.search_placeholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                scrollToHit(searchHit + (e.shiftKey ? -1 : 1))
              } else if (e.key === 'Escape') {
                setSearchOpen(false)
              }
            }}
          />
          <span className="diff-search-count">
            {searchHits.length === 0
              ? (searchQuery ? t('diff.search_count_none') : '')
              : `${searchHit + 1} / ${searchHits.length}`}
          </span>
          <button
            className="ct-btn ghost"
            disabled={searchHits.length === 0}
            onClick={() => scrollToHit(searchHit - 1)}
            title="上一个 (Shift+Enter)"
          >
            <i className="ti ti-chevron-up" />
          </button>
          <button
            className="ct-btn ghost"
            disabled={searchHits.length === 0}
            onClick={() => scrollToHit(searchHit + 1)}
            title="下一个 (Enter)"
          >
            <i className="ti ti-chevron-down" />
          </button>
          <button
            className="ct-btn ghost"
            onClick={() => setSearchOpen(false)}
            title="关闭 (Esc)"
          >
            <i className="ti ti-x" />
          </button>
        </div>
      )}

      <div className="diff-content" ref={containerRef}>
        {/* "Working tree is clean" message — only when we're actually
            looking at the working tree, not when reviewing a historical
            commit (where the working tree being clean is normal). */}
        {!hasFiles && !selectedCommit && (
          <div className="empty-state center">
            <i className="ti ti-circle-check" style={{ fontSize: 40, opacity: 0.15 }} />
            <p>{t('diff.no_changes')}</p>
          </div>
        )}
        {!selectedFile && items.length === 0 && (hasFiles || selectedCommit) && (
          <div className="empty-state center">
            <i className="ti ti-file-diff" style={{ fontSize: 40, opacity: 0.2 }} />
            <p>{t('diff.pick_file_hint')}</p>
          </div>
        )}
        {/* Side-by-side mode skips the virtualized unified list and renders
            its own two-column layout. Kept gated for diff.length > 0 so
            empty-state branches above still take precedence. */}
        {diffSideBySide && diff.length > 0 && (
          <SideBySideDiff diff={diff} showFileHeaders={diff.length > 1} />
        )}
        {!diffSideBySide && items.length > 0 && (
          <div style={{ height: total, position: 'relative' }}>
            {items.slice(startIdx, endIdx + 1).map((item, i) => {
              const idx = startIdx + i
              const isCurrentHit = searchHits.length > 0 && searchHits[searchHit] === idx
              const isHit = !isCurrentHit && searchQuery && item.kind === 'line'
                && (item.line.content.toLowerCase().includes(searchQuery.trim().toLowerCase()))
              return (
                <div
                  key={idx}
                  className={`diff-v-row${isCurrentHit ? ' is-search-hit current' : isHit ? ' is-search-hit' : ''}`}
                  style={{
                    position: 'absolute',
                    top: offsets[idx],
                    left: 0,
                    right: 0,
                    height: rowH(item),
                  }}
                >
                  {renderItem(item, {
                    onStageHunk: async (file, hunkIdx) => {
                      try { await stageHunk(file, hunkIdx) }
                      catch (e) { showToast(String(e), 'error') }
                    },
                    onUnstageHunk: async (file, hunkIdx) => {
                      try { await unstageHunk(file, hunkIdx) }
                      catch (e) { showToast(String(e), 'error') }
                    },
                    onDiscardHunk: (file, hunkIdx) => discardHunk(file, hunkIdx),
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {blameOpen && selectedFile && (
        <BlameModal
          file={selectedFile}
          commit={selectedCommit?.id}
          onClose={() => setBlameOpen(false)}
        />
      )}
      {historyOpen && selectedFile && (
        <FileHistoryModal
          file={selectedFile}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      {blockHistory && selectedFile && (
        <BlockHistoryModal
          file={selectedFile}
          start={blockHistory.start}
          end={blockHistory.end}
          onClose={() => setBlockHistory(null)}
        />
      )}
      {selectionPill && selectedFile && (
        <button
          className="block-history-pill"
          style={{ left: selectionPill.x, top: selectionPill.y }}
          onMouseDown={(e) => {
            // Use mouseDown not onClick — onClick fires after selectionchange
            // which clears the pill state if the click collapses the selection.
            e.preventDefault()
            setBlockHistory({ start: selectionPill.start, end: selectionPill.end })
            setSelectionPill(null)
            window.getSelection()?.removeAllRanges()
          }}
          title={t('block_history.pill_tooltip')}
        >
          <i className="ti ti-history" />
          {t('block_history.pill', {
            range: selectionPill.start === selectionPill.end
              ? `L${selectionPill.start}`
              : `L${selectionPill.start}–L${selectionPill.end}`,
          })}
        </button>
      )}
    </div>
  )
}

interface RenderActions {
  onStageHunk: (file: string, hunkIndex: number) => void | Promise<void>
  onUnstageHunk: (file: string, hunkIndex: number) => void | Promise<void>
  onDiscardHunk: (file: string, hunkIndex: number) => void | Promise<void>
}

function renderItem(item: VItem, actions: RenderActions) {
  if (item.kind === 'file') {
    return (
      <div className="diff-file-header">
        <i className="ti ti-file-code" />
        {item.file}
      </div>
    )
  }
  if (item.kind === 'hunk') {
    const op = item.stageable
    return (
      <div className="hunk-header">
        <span>{item.header}</span>
        {op && (
          <div className="hunk-actions">
            <button
              className="hunk-stage-btn"
              onClick={() => op === 'stage'
                ? actions.onStageHunk(item.file, item.hunkIndex)
                : actions.onUnstageHunk(item.file, item.hunkIndex)}
              title={op === 'stage' ? i18n.t('diff.stage_hunk_tooltip') : i18n.t('diff.unstage_hunk_tooltip')}
            >
              <i className={`ti ${op === 'stage' ? 'ti-plus' : 'ti-minus'}`} />
              {op === 'stage' ? i18n.t('diff.stage_hunk') : i18n.t('diff.unstage_hunk')}
            </button>
            {/* Discard only makes sense for an UNSTAGED hunk — for a staged
                one the user should unstage first. Destructive, so confirm. */}
            {op === 'stage' && (
              <button
                className="hunk-stage-btn hunk-discard-btn"
                onClick={() => {
                  if (!window.confirm(i18n.t('diff.discard_hunk_confirm'))) return
                  actions.onDiscardHunk(item.file, item.hunkIndex)
                }}
                title={i18n.t('diff.discard_hunk_tooltip')}
              >
                <i className="ti ti-arrow-back-up" />
                {i18n.t('diff.discard_hunk')}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  return <DiffLineRow line={item.line} inline={item.inline} lang={item.lang} />
}

function DiffLineRow({
  line, inline, lang,
}: {
  line: DiffLine
  inline: CharSeg[] | undefined
  lang: string | null
}) {
  const cls = line.origin === '+' ? 'add' : line.origin === '-' ? 'del' : ''
  // The "new side" line number is what's interesting for block-history
  // queries — it's the row this content has in HEAD. Deletion-only rows
  // fall back to their pre-image line. Attached as a data-attr so the
  // selection-watcher can read it without re-parsing the rendered text.
  const lineForHistory = line.new_lineno ?? line.old_lineno ?? null
  return (
    <div
      className={`diff-line ${cls}`}
      data-line-no={lineForHistory ?? undefined}
    >
      <span className="ln old">{line.old_lineno ?? ' '}</span>
      <span className="ln new">{line.new_lineno ?? ' '}</span>
      <span className="origin">{line.origin === ' ' ? '' : line.origin}</span>
      <span className="code hljs">{renderCode(line, inline, lang)}</span>
    </div>
  )
}

function stripNL(s: string): string {
  return s.endsWith('\n') ? s.slice(0, -1) : s
}

function renderCode(line: DiffLine, inline: CharSeg[] | undefined, lang: string | null) {
  const text = stripNL(line.content)

  if (!inline) {
    return <span dangerouslySetInnerHTML={{ __html: highlightLine(text, lang) }} />
  }

  // Highlight each segment individually so inline-add/del wrappers nest cleanly.
  // Cross-segment context (e.g., string starts in eq, ends in del) is sacrificed —
  // acceptable trade-off for legibility.
  const accentClass = line.origin === '+' ? 'inline-add' : line.origin === '-' ? 'inline-del' : ''
  return inline.map((s, i) => {
    const html = highlightLine(s.text, lang)
    if (s.type === 'eq') return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />
    return <span key={i} className={accentClass} dangerouslySetInnerHTML={{ __html: html }} />
  })
}
