import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore, type SearchHit } from '../../store'

interface FilePreview {
  content: string
  truncated: boolean
  lineCount: number
  isBinary: boolean
}

/** Selected hit — the row the user clicked. Carries both the file (for the
 *  preview pane to load) and the line (for scroll-to + highlight). */
interface Selection {
  file: string
  line: number
}

/** Shared between the icon-bar Search tab and the ⌘⇧F modal — both render
 *  the same panel, but the modal stacks the preview underneath because
 *  side-by-side is too narrow in a 720px overlay. */
export function SearchPanel({ compact = false, onClose }: { compact?: boolean; onClose?: () => void }) {
  const { t } = useTranslation()
  const {
    searchQuery, searchOptions, searchResults, searchLoading, searchError,
    setSearchQuery, setSearchOptions, runSearch,
    tabs, repoPath,
  } = useStore()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState(searchQuery)
  useEffect(() => { setDraft(searchQuery) }, [searchQuery])
  useEffect(() => { inputRef.current?.focus() }, [])

  // Debounced query/options re-run.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (draft !== searchQuery) setSearchQuery(draft)
      runSearch()
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, searchOptions.regex, searchOptions.caseSensitive, searchOptions.pathspec])

  // Group results by file. Order is preserved from git grep's output.
  const grouped = useMemo(() => {
    const map = new Map<string, SearchHit[]>()
    for (const h of searchResults) {
      const list = map.get(h.file)
      if (list) list.push(h)
      else map.set(h.file, [h])
    }
    return Array.from(map.entries())
  }, [searchResults])

  const tab = tabs.find(t => t.repos.some(r => r.path === repoPath) || t.root === repoPath)
  const root = tab?.root || repoPath || ''

  // Auto-select the first hit when results change (so the user gets a
  // useful preview immediately without a second click).
  const [selected, setSelected] = useState<Selection | null>(null)
  useEffect(() => {
    if (searchResults.length === 0) { setSelected(null); return }
    const first = searchResults[0]
    setSelected({ file: first.file, line: first.line })
  }, [searchResults])

  const totalHits = searchResults.length
  const hitCapped = totalHits >= 1000

  return (
    <div className={`search-panel${compact ? ' compact' : ''}`}>
      <div className="search-header">
        <div className="search-input-row">
          <i className="ti ti-search search-input-icon" />
          <input
            ref={inputRef}
            className="search-input"
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={t('search.placeholder', 'Search in workspace…')}
            onKeyDown={e => {
              if (e.key === 'Escape' && onClose) { e.preventDefault(); onClose() }
              if (e.key === 'Enter') { e.preventDefault(); setSearchQuery(draft); runSearch() }
            }}
          />
          {searchLoading && <i className="ti ti-loader search-spinner" />}
        </div>
        <div className="search-options-row">
          <label className="search-opt" title={t('search.option_case', 'Match case')}>
            <input
              type="checkbox"
              checked={searchOptions.caseSensitive}
              onChange={e => setSearchOptions({ caseSensitive: e.target.checked })}
            />
            <span>Aa</span>
          </label>
          <label className="search-opt" title={t('search.option_regex', 'Regular expression')}>
            <input
              type="checkbox"
              checked={searchOptions.regex}
              onChange={e => setSearchOptions({ regex: e.target.checked })}
            />
            <span>.*</span>
          </label>
          <input
            className="search-pathspec"
            type="text"
            value={searchOptions.pathspec}
            onChange={e => setSearchOptions({ pathspec: e.target.value })}
            placeholder={t('search.pathspec_placeholder', 'Filter (e.g. *.ts)')}
            title={t('search.pathspec_tip', 'Pathspec — git pattern filter')}
          />
          {totalHits > 0 && (
            <span className="search-hit-summary">
              {t('search.hit_count', '{{n}} matches', { n: totalHits })}
              {hitCapped && '+'}
            </span>
          )}
        </div>
      </div>

      <div className={`search-body${compact ? ' search-body-stacked' : ''}`}>
        <div className="search-results">
          {searchError && (
            <div className="search-error">
              <i className="ti ti-alert-triangle" /> {searchError}
            </div>
          )}
          {!searchError && draft && !searchLoading && totalHits === 0 && (
            <div className="search-empty">{t('search.no_results', 'No results')}</div>
          )}
          {!searchError && !draft && (
            <div className="search-empty">{t('search.tip', 'Type to search across all tracked files.')}</div>
          )}
          {grouped.map(([file, hits]) => (
            <div key={file} className="search-file-group">
              <div
                className={`search-file-header${selected?.file === file ? ' active' : ''}`}
                onClick={() => setSelected({ file, line: hits[0].line })}
              >
                <i className="ti ti-file-text" />
                <span className="search-file-path">{file}</span>
                <span className="search-file-count">{hits.length}</span>
              </div>
              {hits.map((h, idx) => (
                <div
                  key={`${file}:${h.line}:${h.column}:${idx}`}
                  className={`search-hit-row${selected?.file === file && selected.line === h.line ? ' active' : ''}`}
                  onClick={() => setSelected({ file: h.file, line: h.line })}
                  title={`${file}:${h.line}:${h.column}`}
                >
                  <span className="search-hit-line">{h.line}</span>
                  <span className="search-hit-content">{h.content}</span>
                </div>
              ))}
            </div>
          ))}
          {hitCapped && (
            <div className="search-truncated">
              {t('search.truncated', 'Showing first 1,000 matches — narrow the query for more.')}
            </div>
          )}
        </div>

        <SearchPreview
          root={root}
          selection={selected}
          query={searchQuery}
          options={searchOptions}
        />
      </div>
    </div>
  )
}

/** Right-hand preview: full file content of `selection.file` with all
 *  matched lines highlighted and the active one auto-scrolled into view.
 *  Loads lazily — only refetches when the file path changes. */
function SearchPreview({
  root,
  selection,
  query,
  options,
}: {
  root: string
  selection: Selection | null
  query: string
  options: { regex: boolean; caseSensitive: boolean }
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<FilePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<Record<number, HTMLDivElement | null>>({})
  const currentFile = selection?.file ?? null

  useEffect(() => {
    if (!currentFile || !root) { setPreview(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    invoke<FilePreview>('read_file', { path: root, file: currentFile })
      .then(fp => { if (!cancelled) { setPreview(fp); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e?.message || e)); setLoading(false); setPreview(null) } })
    return () => { cancelled = true }
  }, [root, currentFile])

  // Scroll the selected line into view whenever the line changes (or after
  // load completes). The element may not exist yet on first paint, so we
  // do this in an effect after refs are attached.
  useEffect(() => {
    if (!selection) return
    const el = lineRefs.current[selection.line]
    if (el) el.scrollIntoView({ block: 'center' })
  }, [selection, preview])

  // Build a Set of matched line numbers for fast tinting in the preview.
  // The store's searchResults only knows hits for ALL files in the
  // workspace, so filter to the current file here.
  const { searchResults } = useStore()
  const matchedLines = useMemo(() => {
    if (!currentFile) return new Set<number>()
    const s = new Set<number>()
    for (const h of searchResults) if (h.file === currentFile) s.add(h.line)
    return s
  }, [searchResults, currentFile])

  if (!selection) {
    return (
      <div className="search-preview empty">
        <i className="ti ti-arrow-narrow-left" /> {t('search.pick_hit', 'Pick a result to preview the file.')}
      </div>
    )
  }
  if (loading) {
    return <div className="search-preview empty"><i className="ti ti-loader search-spinner" /></div>
  }
  if (error) {
    return <div className="search-preview empty"><i className="ti ti-alert-triangle" /> {error}</div>
  }
  if (!preview) return null
  if (preview.isBinary) {
    return <div className="search-preview empty">{t('search.binary_file', 'Binary file — preview not available.')}</div>
  }

  const lines = preview.content.split('\n')
  // Precompiled regex so highlightLine() doesn't recompile per row.
  let pattern: RegExp | null = null
  if (query.trim()) {
    try {
      const flags = options.caseSensitive ? 'g' : 'gi'
      const src = options.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pattern = new RegExp(src, flags)
    } catch { pattern = null }
  }

  return (
    <div className="search-preview" ref={scrollRef}>
      <div className="search-preview-title">
        <i className="ti ti-file-text" />
        <span>{selection.file}</span>
        {preview.truncated && (
          <span className="search-preview-truncated-tag">{t('search.preview_truncated', 'truncated')}</span>
        )}
      </div>
      <div className="search-preview-body">
        {lines.map((text, i) => {
          const lineNo = i + 1
          const isHit = matchedLines.has(lineNo)
          const isActive = selection.line === lineNo
          return (
            <div
              key={lineNo}
              ref={el => { lineRefs.current[lineNo] = el }}
              className={`search-preview-line${isHit ? ' is-hit' : ''}${isActive ? ' is-active' : ''}`}
            >
              <span className="ln">{lineNo}</span>
              <span className="code">{renderWithHighlight(text, pattern)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Inline-highlight occurrences of `pattern` inside one line of text.
 *  Returns either a plain string (no match / no pattern) or an array of
 *  React fragments — React renders both. Bounded to MAX_MATCHES per line
 *  so a pathological regex on a 10KB minified line can't lock up. */
function renderWithHighlight(text: string, pattern: RegExp | null): React.ReactNode {
  if (!pattern) return text
  const MAX_MATCHES = 200
  const out: React.ReactNode[] = []
  let last = 0
  let count = 0
  pattern.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text))) {
    if (count++ > MAX_MATCHES) break
    if (m.index > last) out.push(text.slice(last, m.index))
    out.push(<mark key={m.index} className="search-mark">{m[0]}</mark>)
    last = m.index + m[0].length
    // Guard against zero-length matches looping forever.
    if (m[0].length === 0) pattern.lastIndex++
  }
  if (last < text.length) out.push(text.slice(last))
  return out.length ? out : text
}

/** ⌘⇧F overlay — same panel in compact (stacked) layout. */
export function SearchModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="search-modal-backdrop" onClick={onClose}>
      <div className="search-modal" onClick={e => e.stopPropagation()}>
        <SearchPanel compact onClose={onClose} />
      </div>
    </div>
  )
}
