import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore, diffsToUnifiedText, type DiffHunk, type DiffLine, type CommitInfo, type BranchInfo } from '../../store'
import { relTime } from '../../lib/relTime'
import { AIPrDescriptionModal } from '../AIPrDescription'
import { SideBySideDiff } from '../Diff/SideBySide'

type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'

interface CompareFile {
  path: string
  oldPath: string | null
  status: FileStatus
  hunks: DiffHunk[]
  added: number
  removed: number
}

interface CompareResult {
  commits: CommitInfo[]
  files: CompareFile[]
  added: number
  removed: number
  mergeBase: string | null
  baseTip: CommitInfo | null
  headTip: CommitInfo | null
}

interface CompareTreeEntry {
  path: string
  isDir: boolean
  basePresent: boolean
  headPresent: boolean
  diffStatus: 'identical' | 'modified' | null
}

function guessBase(branches: BranchInfo[], current: string | undefined): string {
  if (!branches.length) return ''
  for (const candidate of ['main', 'master', 'develop', 'origin/main', 'origin/master']) {
    if (branches.some(b => b.name === candidate)) return candidate
  }
  const other = branches.find(b => b.name !== current)
  return other?.name ?? ''
}

// ── Dual tree model ────────────────────────────────────────────────────
type DualNode = {
  name: string
  path: string
  /** Pre-lowercased name and path — populated once at tree build time.
   *  Saves a toLowerCase() per node per keystroke when filtering. */
  nameLower: string
  pathLower: string
  isDir: boolean
  basePresent: boolean
  headPresent: boolean
  /** Roll-up for the subtree: how many leaves differ. 0 = identical. */
  diffCount: number
  /** Per-side state used to color the row. Folders aggregate from children. */
  state: 'identical' | 'modified' | 'base-only' | 'head-only' | 'mixed'
  children: DualNode[]
}

function buildDualTree(entries: CompareTreeEntry[]): DualNode {
  const root: DualNode = {
    name: '', path: '', nameLower: '', pathLower: '', isDir: true,
    basePresent: true, headPresent: true,
    diffCount: 0, state: 'identical', children: [],
  }

  // Sort entries to ensure stable parent-before-child insertion order.
  // BTreeSet on the backend already gives us lexicographic order, but
  // re-sort defensively so the path "a/b" arrives after "a".
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path))

  for (const e of sorted) {
    const segs = e.path.split('/').filter(Boolean)
    let cur = root
    for (let i = 0; i < segs.length; i++) {
      const isLast = i === segs.length - 1
      const childPath = segs.slice(0, i + 1).join('/')
      let next = cur.children.find(c => c.name === segs[i])
      if (!next) {
        next = {
          name: segs[i],
          path: childPath,
          nameLower: segs[i].toLowerCase(),
          pathLower: childPath.toLowerCase(),
          isDir: isLast ? e.isDir : true,
          basePresent: isLast ? e.basePresent : false,
          headPresent: isLast ? e.headPresent : false,
          diffCount: 0,
          state: 'identical',
          children: [],
        }
        cur.children.push(next)
      } else if (isLast) {
        // Backend may have emitted both an intermediate dir entry and a
        // shadowed leaf with the same path — last write wins on facts.
        next.isDir = e.isDir
        next.basePresent = e.basePresent
        next.headPresent = e.headPresent
      }
      cur = next
    }
  }

  // Decorate leaves with state, then bubble up.
  function decorate(n: DualNode, leaf?: CompareTreeEntry): 'identical' | 'modified' | 'base-only' | 'head-only' | 'mixed' {
    if (!n.isDir) {
      const e = leaf
      if (!e) return 'identical'
      n.state =
        !e.basePresent ? 'head-only'
        : !e.headPresent ? 'base-only'
        : e.diffStatus === 'modified' ? 'modified'
        : 'identical'
      n.diffCount = n.state === 'identical' ? 0 : 1
      return n.state
    }
    let hasBase = false, hasHead = false, anyDiff = false, anyIdent = false
    let childDiff = 0
    for (const c of n.children) {
      const e = sorted.find(s => s.path === c.path)
      decorate(c, e)
      if (c.basePresent || c.state === 'base-only' || c.state === 'modified' || c.state === 'identical' || c.state === 'mixed') hasBase = hasBase || basePresentRec(c)
      if (c.headPresent || c.state === 'head-only' || c.state === 'modified' || c.state === 'identical' || c.state === 'mixed') hasHead = hasHead || headPresentRec(c)
      if (c.state === 'modified' || c.state === 'mixed') anyDiff = true
      if (c.state === 'base-only' || c.state === 'head-only') anyDiff = true
      if (c.state === 'identical') anyIdent = true
      childDiff += c.diffCount
    }
    // For directories we recompute basePresent / headPresent from descendants
    n.basePresent = hasBase
    n.headPresent = hasHead
    n.diffCount = childDiff
    n.state =
      !hasBase ? 'head-only'
      : !hasHead ? 'base-only'
      : anyDiff && anyIdent ? 'mixed'
      : anyDiff ? 'modified'
      : 'identical'
    return n.state
  }
  function basePresentRec(n: DualNode): boolean {
    if (!n.isDir) return n.basePresent
    return n.children.some(basePresentRec)
  }
  function headPresentRec(n: DualNode): boolean {
    if (!n.isDir) return n.headPresent
    return n.children.some(headPresentRec)
  }

  decorate(root)

  // Sort each level: folders first, then alphabetical.
  function sortLevels(n: DualNode) {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    n.children.forEach(sortLevels)
  }
  sortLevels(root)

  return root
}

// ── Top-level component ────────────────────────────────────────────────
export function CompareView() {
  const { t } = useTranslation()
  const { repoPath, branches, loadBranches, repoStatus, showToast } = useStore()
  // Reuse the global side-by-side preference so the toggle is consistent
  // with the Changes diff view (one setting, applies everywhere).
  const diffSideBySide = useStore(s => s.diffSideBySide)
  const setDiffSideBySide = useStore(s => s.setDiffSideBySide)

  const [base, setBase] = useState('')
  const [head, setHead] = useState('')
  const [tree, setTree] = useState<DualNode | null>(null)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [commitsOpen, setCommitsOpen] = useState(true)
  const [onlyChanges, setOnlyChanges] = useState(false)
  const [search, setSearch] = useState('')
  const [prModalOpen, setPrModalOpen] = useState(false)
  // Deferred so the input stays responsive while we recompute the (potentially
  // expensive) tree filter. React paints the input update immediately and
  // schedules the heavier work on a lower-priority pass.
  const deferredSearch = useDeferredValue(search)

  useEffect(() => { loadBranches() }, [repoPath])

  useEffect(() => {
    if (!repoStatus?.branch || base || head) return
    setHead(repoStatus.branch)
    setBase(guessBase(branches, repoStatus.branch))
  }, [repoStatus?.branch, branches.length])

  const allRefs = useMemo(() => {
    const local = branches.filter(b => !b.isRemote).map(b => b.name)
    const remote = branches.filter(b => b.isRemote).map(b => b.name)
    return { local, remote }
  }, [branches])

  const run = async () => {
    if (!repoPath || !base || !head || base === head) return
    setLoading(true); setSelected(null); setTree(null); setResult(null)
    try {
      const [entries, diffResult] = await Promise.all([
        invoke<CompareTreeEntry[]>('compare_trees', { path: repoPath, base, head }),
        invoke<CompareResult>('compare_branches', { path: repoPath, base, head }),
      ])
      const built = buildDualTree(entries)
      setTree(built)
      setResult(diffResult)
      // Expand all folders that contain at least one change so users see
      // diffs at a glance, but collapse identical-only subtrees.
      const exp = new Set<string>()
      function walk(n: DualNode) {
        if (n.isDir && n.diffCount > 0 && n.path) exp.add(n.path)
        n.children.forEach(walk)
      }
      walk(built)
      setExpanded(exp)
      // Pre-select the first differing file
      const firstDiff = entries.find(e =>
        !e.isDir && (!e.basePresent || !e.headPresent || e.diffStatus === 'modified')
      )
      if (firstDiff) setSelected(firstDiff.path)
    } catch (e) {
      showToast(String(e), 'error')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    if (base && head && base !== head) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, head])

  // Stable callback refs so DualTreeRow's React.memo can short-circuit
  // re-renders when only unrelated state changes.
  const toggleFolder = useCallback((path: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(path)) next.delete(path); else next.add(path)
    return next
  }), [])
  const handleSelect = useCallback((path: string) => setSelected(path), [])
  const swap = () => { const a = base, b = head; setBase(b); setHead(a) }

  const selectedFile = useMemo(
    () => result?.files.find(f => f.path === selected) ?? null,
    [result, selected],
  )

  /** Find a node in the dual tree by full path. Used so the panel can
   *  tell us state for files NOT in result.files (identical / removed). */
  const selectedNode = useMemo(() => {
    if (!selected || !tree) return null
    function find(n: DualNode): DualNode | null {
      if (n.path === selected) return n
      for (const c of n.children) {
        const r = find(c)
        if (r) return r
      }
      return null
    }
    return find(tree)
  }, [selected, tree])

  /** Does this node (or any descendant) match the search query? Pre-fills
   *  the cache for EVERY node so the renderer can rely on `get(path)`
   *  returning a concrete boolean (no short-circuit on the recursion).
   *  Uses pre-lowercased fields on each node — no toLowerCase per keystroke. */
  const matchesSearch = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase()
    if (!q) return null
    const cache = new Map<string, boolean>()
    function check(n: DualNode): boolean {
      const self = n.pathLower.includes(q) || n.nameLower.includes(q)
      let sub = false
      if (n.isDir) {
        for (const c of n.children) {
          // Walk every child unconditionally so each gets cached.
          if (check(c)) sub = true
        }
      }
      const hit = self || sub
      cache.set(n.path, hit)
      return hit
    }
    if (tree) tree.children.forEach(check)
    return cache
  }, [deferredSearch, tree])

  /** Auto-expand folders that match search results so hits aren't hidden. */
  useEffect(() => {
    if (!matchesSearch || !tree) return
    const ms = matchesSearch
    setExpanded(prev => {
      const next = new Set(prev)
      function walk(n: DualNode) {
        if (n.isDir && ms.get(n.path)) next.add(n.path)
        n.children.forEach(walk)
      }
      walk(tree)
      return next
    })
  }, [matchesSearch, tree])

  return (
    <div className="compare-view">
      <div className="compare-toolbar">
        <BranchPicker label={t('compare.base')} value={base} onChange={setBase}
          local={allRefs.local} remote={allRefs.remote} />
        <button className="compare-swap" onClick={swap} title={t('compare.swap')}>
          <i className="ti ti-arrows-exchange" />
        </button>
        <BranchPicker label={t('compare.head')} value={head} onChange={setHead}
          local={allRefs.local} remote={allRefs.remote} />
        <div className="compare-search">
          <i className="ti ti-search" />
          <input
            type="text"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('compare.search_placeholder')}
          />
          {search && (
            <button className="compare-search-clear" onClick={() => setSearch('')}>
              <i className="ti ti-x" />
            </button>
          )}
        </div>
        <label className="compare-filter">
          <input type="checkbox" checked={onlyChanges} onChange={e => setOnlyChanges(e.target.checked)} />
          <span>{t('compare.only_changes')}</span>
        </label>
        {result && result.commits.length > 0 && (
          <button
            className="compare-ai-pr"
            onClick={() => setPrModalOpen(true)}
            title={t('compare.ai_pr_tooltip')}
          >
            <i className="ti ti-sparkles" /> {t('compare.ai_pr')}
          </button>
        )}
        <div className="compare-stats">
          {loading ? (
            <span className="compare-loading"><i className="ti ti-loader-2" /> {t('common.loading')}</span>
          ) : result ? (
            <>
              <span className="compare-count">{t('compare.n_commits', { n: result.commits.length })}</span>
              <span className="compare-count">{t('compare.n_files', { n: result.files.length })}</span>
              <span className="compare-added">+{result.added}</span>
              <span className="compare-removed">−{result.removed}</span>
            </>
          ) : null}
        </div>
      </div>

      {!base || !head ? (
        <div className="empty-state center" style={{ padding: 32 }}>
          <i className="ti ti-git-compare" style={{ fontSize: 36, opacity: 0.2 }} />
          <p>{t('compare.pick_two')}</p>
        </div>
      ) : base === head ? (
        <div className="empty-state center" style={{ padding: 32 }}>
          <i className="ti ti-equal" style={{ fontSize: 36, opacity: 0.2 }} />
          <p>{t('compare.same_branch')}</p>
        </div>
      ) : !tree ? null : tree.diffCount === 0 ? (
        <div className="empty-state center" style={{ padding: 32 }}>
          <i className="ti ti-circle-check" style={{ fontSize: 36, opacity: 0.2 }} />
          <p>{t('compare.no_difference')}</p>
        </div>
      ) : (
        <div className="compare-body">
          {/* Optional commits card on top */}
          {result && result.commits.length > 0 && (
            <div className="compare-commits-card">
              <button
                className={`compare-commits-toggle${commitsOpen ? ' is-open' : ''}`}
                onClick={() => setCommitsOpen(v => !v)}
              >
                <i className={`ti ${commitsOpen ? 'ti-chevron-down' : 'ti-chevron-right'}`} />
                {t('compare.commits_in_head', { head })} · {result.commits.length}
              </button>
              {commitsOpen && (
                <div className="compare-commits-list">
                  {result.commits.map(c => (
                    <div key={c.id} className="compare-commit-mini" title={c.message}>
                      <span className="compare-commit-mini-sha">{c.shortId}</span>
                      <span className="compare-commit-mini-msg">{c.message || '(no message)'}</span>
                      <span className="compare-commit-mini-time">{relTime(c.time)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* The dual tree: two side-by-side columns, one row per path */}
          <div className="compare-dual">
            <div className="compare-dual-head">
              <BranchHeadCell
                side="base"
                branch={base}
                tip={result?.baseTip ?? null}
                isNewer={isBaseNewer(result?.baseTip, result?.headTip)}
              />
              <BranchHeadCell
                side="head"
                branch={head}
                tip={result?.headTip ?? null}
                isNewer={isHeadNewer(result?.baseTip, result?.headTip)}
              />
            </div>
            <div className="compare-dual-scroll">
              <DualTreeBranch
                nodes={tree.children}
                depth={0}
                onlyChanges={onlyChanges}
                matchesSearch={matchesSearch}
                expanded={expanded}
                onToggle={toggleFolder}
                selected={selected}
                onSelect={handleSelect}
              />
            </div>
          </div>

          {/* File diff / status panel */}
          {selected && selectedNode && !selectedNode.isDir && (
            <div className="compare-diff-panel">
              <div className="compare-diff-head">
                {selectedFile ? (
                  <span className={`compare-tree-badge badge-${selectedFile.status}`}>
                    {selectedFile.status[0].toUpperCase()}
                  </span>
                ) : (
                  <span className="compare-tree-badge badge-identical">=</span>
                )}
                <span className="compare-diff-path">
                  {selectedFile?.oldPath && selectedFile.oldPath !== selectedFile.path ? (
                    <>
                      <span className="compare-diff-oldpath">{selectedFile.oldPath}</span>
                      <i className="ti ti-arrow-narrow-right" />
                      {selectedFile.path}
                    </>
                  ) : selected}
                </span>
                {selectedFile && (
                  <span className="compare-diff-stats">
                    <span className="added">+{selectedFile.added}</span>
                    <span className="removed">−{selectedFile.removed}</span>
                  </span>
                )}
                {selectedFile && selectedFile.hunks.length > 0 && (
                  <button
                    className={`compare-diff-sbs${diffSideBySide ? ' active' : ''}`}
                    onClick={() => setDiffSideBySide(!diffSideBySide)}
                    title={t('diff.side_by_side_tooltip')}
                  >
                    <i className="ti ti-columns" />
                    <span>{t('diff.side_by_side')}</span>
                  </button>
                )}
                <button
                  className="compare-diff-close"
                  onClick={() => setSelected(null)}
                  title={t('common.close')}
                >
                  <i className="ti ti-x" />
                </button>
              </div>
              <div className="compare-diff-body">
                {selectedFile ? (
                  selectedFile.hunks.length === 0 ? (
                    <div className="empty-state center" style={{ padding: 24 }}>
                      <p style={{ fontSize: 12 }}>(no hunks — binary or empty change)</p>
                    </div>
                  ) : diffSideBySide ? (
                    // Reuse the Changes view's side-by-side renderer; wrap the
                    // CompareFile into the DiffResult shape it expects.
                    <SideBySideDiff
                      diff={[{ file: selectedFile.path, hunks: selectedFile.hunks }]}
                      showFileHeaders={false}
                    />
                  ) : selectedFile.hunks.map((h, hi) => (
                    <div key={hi} className="compare-hunk">
                      <div className="compare-hunk-head">{h.header}</div>
                      {h.lines.map((l: DiffLine, li) => (
                        <div key={li} className={`compare-line origin-${l.origin === ' ' ? 'ctx' : l.origin === '+' ? 'add' : 'del'}`}>
                          <span className="ln">{l.old_lineno ?? ''}</span>
                          <span className="ln">{l.new_lineno ?? ''}</span>
                          <span className="code">{l.content || ' '}</span>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  // Not in result.files → either identical or only on one side.
                  <div className="empty-state center" style={{ padding: 32 }}>
                    {selectedNode.state === 'identical' ? (
                      <>
                        <i className="ti ti-equal" style={{ fontSize: 28, opacity: 0.3 }} />
                        <p>{t('compare.file_identical')}</p>
                      </>
                    ) : selectedNode.state === 'base-only' ? (
                      <>
                        <i className="ti ti-minus" style={{ fontSize: 28, opacity: 0.3, color: 'var(--red-text)' }} />
                        <p>{t('compare.file_base_only')}</p>
                      </>
                    ) : selectedNode.state === 'head-only' ? (
                      <>
                        <i className="ti ti-plus" style={{ fontSize: 28, opacity: 0.3, color: 'var(--green-text)' }} />
                        <p>{t('compare.file_head_only')}</p>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {prModalOpen && result && (
        <AIPrDescriptionModal
          base={base}
          head={head}
          commits={result.commits}
          diff={diffsToUnifiedText(
            result.files.map(f => ({ file: f.path, hunks: f.hunks }))
          )}
          onClose={() => setPrModalOpen(false)}
        />
      )}
    </div>
  )
}

// ── Branch head cell (shows the tip commit + a "newer" badge) ──────────
function isBaseNewer(base: CommitInfo | null | undefined, head: CommitInfo | null | undefined): boolean {
  if (!base || !head) return false
  return base.time > head.time
}
function isHeadNewer(base: CommitInfo | null | undefined, head: CommitInfo | null | undefined): boolean {
  if (!base || !head) return false
  return head.time > base.time
}

function BranchHeadCell({
  side, branch, tip, isNewer,
}: {
  side: 'base' | 'head'
  branch: string
  tip: CommitInfo | null
  isNewer: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className={`compare-dual-side ${side}${isNewer ? ' is-newer' : ''}`}>
      <div className="compare-dual-side-row">
        <i className="ti ti-git-branch" />
        <span className="compare-dual-side-name">{branch}</span>
        {isNewer && (
          <span className="compare-dual-newer" title={t('compare.newer_tooltip')}>
            <i className="ti ti-arrow-up" />
            {t('compare.newer')}
          </span>
        )}
      </div>
      {tip && (
        <div className="compare-dual-side-tip">
          <span className="compare-dual-tip-sha">{tip.shortId}</span>
          <span className="compare-dual-tip-time">{relTime(tip.time)}</span>
          <span className="compare-dual-tip-author">{tip.author}</span>
        </div>
      )}
    </div>
  )
}

// ── Dual-row tree rendering ───────────────────────────────────────────
interface DualBranchProps {
  nodes: DualNode[]
  depth: number
  onlyChanges: boolean
  matchesSearch: Map<string, boolean> | null
  expanded: Set<string>
  onToggle: (path: string) => void
  selected: string | null
  onSelect: (path: string) => void
}

function DualTreeBranch(props: DualBranchProps) {
  return (
    <>
      {props.nodes.map(n => (
        <DualTreeRow key={n.path} node={n} {...props} />
      ))}
    </>
  )
}

interface DualRowProps extends DualBranchProps {
  node: DualNode
}

const DualTreeRow = memo(function DualTreeRow({ node, depth, onlyChanges, matchesSearch, expanded, onToggle, selected, onSelect }: DualRowProps) {
  // When the "only changes" filter is on, hide identical-only subtrees.
  if (onlyChanges && node.state === 'identical') return null
  // Search filter: hide rows whose path & no descendant match.
  if (matchesSearch && matchesSearch.get(node.path) === false) return null

  const isOpen = expanded.has(node.path)
  const isSelected = !node.isDir && selected === node.path
  const pad = 8 + depth * 14

  const cell = (side: 'base' | 'head') => {
    const present = side === 'base' ? node.basePresent : node.headPresent
    if (!present) return <div className={`compare-dual-cell empty side-${side}`} />
    return (
      <div className={`compare-dual-cell side-${side} state-${node.state}${isSelected ? ' selected' : ''}`}
           style={{ paddingLeft: pad }}>
        {node.isDir ? (
          <button
            className="compare-dual-rowbtn folder"
            onClick={() => onToggle(node.path)}
          >
            <i className={`ti ${isOpen ? 'ti-chevron-down' : 'ti-chevron-right'} compare-dual-chev`} />
            <i className={`ti ${isOpen ? 'ti-folder-open' : 'ti-folder'} compare-dual-folder`} />
            <span className="compare-dual-name">{node.name}</span>
            {node.diffCount > 0 && (
              <span className="compare-dual-diffcount">{node.diffCount}</span>
            )}
          </button>
        ) : (
          <button
            className="compare-dual-rowbtn file"
            onClick={() => onSelect(node.path)}
          >
            <i className="ti ti-file compare-dual-file" />
            <span className="compare-dual-name">{node.name}</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="compare-dual-row">
        {cell('base')}
        {cell('head')}
      </div>
      {node.isDir && isOpen && (
        <DualTreeBranch
          nodes={node.children}
          depth={depth + 1}
          onlyChanges={onlyChanges}
          matchesSearch={matchesSearch}
          expanded={expanded}
          onToggle={onToggle}
          selected={selected}
          onSelect={onSelect}
        />
      )}
    </>
  )
})

// ── Branch picker ──────────────────────────────────────────────────────
interface BranchPickerProps {
  label: string
  value: string
  onChange: (v: string) => void
  local: string[]
  remote: string[]
}

function BranchPicker({ label, value, onChange, local, remote }: BranchPickerProps) {
  return (
    <label className="compare-picker">
      <span className="compare-picker-label">{label}</span>
      <select
        className="compare-picker-select"
        value={value}
        onChange={e => onChange(e.target.value)}
      >
        <option value="">—</option>
        {local.length > 0 && (
          <optgroup label="local">
            {local.map(n => <option key={`l-${n}`} value={n}>{n}</option>)}
          </optgroup>
        )}
        {remote.length > 0 && (
          <optgroup label="remote">
            {remote.map(n => <option key={`r-${n}`} value={n}>{n}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  )
}
