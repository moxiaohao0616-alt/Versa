import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type CommitInfo, type GraphCommit } from '../../store'
import { RebaseModal } from '../Rebase'
import { relTime } from '../../lib/relTime'

const ROW_H = 36
const LANE_W = 22
const NODE_R = 5

const LANE_COLORS = [
  '#639922', '#2563eb', '#d97706', '#7c3aed',
  '#dc2626', '#0891b2', '#c026d3', '#059669',
  '#ea580c', '#0284c7',
]

// Now defined in store; alias kept for local readability.
type RawCommit = GraphCommit

interface PlacedCommit extends RawCommit {
  x: number
  color: string
}

interface GraphEdge {
  x1: number; row1: number
  x2: number; row2: number
  color: string
}

function computeGraph(commits: RawCommit[]) {
  const lanes: (string | null)[] = []
  const laneColors: string[] = []
  const commitColor: Record<string, string> = {}
  const placed: PlacedCommit[] = []

  for (let row = 0; row < commits.length; row++) {
    const c = commits[row]

    let lane = lanes.indexOf(c.id)
    if (lane === -1) {
      lane = lanes.findIndex(l => l === null)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(null)
        laneColors.push(LANE_COLORS[lane % LANE_COLORS.length])
      }
    }

    const color = commitColor[c.id] ?? laneColors[lane] ?? LANE_COLORS[lane % LANE_COLORS.length]
    commitColor[c.id] = color
    placed.push({ ...c, x: lane, color })

    // This lane now tracks first parent
    if (c.parents.length > 0) {
      lanes[lane] = c.parents[0]
      if (!commitColor[c.parents[0]]) commitColor[c.parents[0]] = color
    } else {
      lanes[lane] = null
    }

    // Open new lanes for merge parents (2nd+)
    for (let pi = 1; pi < c.parents.length; pi++) {
      const pid = c.parents[pi]
      if (!lanes.includes(pid)) {
        let fl = lanes.findIndex(l => l === null)
        if (fl === -1) {
          fl = lanes.length
          lanes.push(null)
          laneColors.push(LANE_COLORS[fl % LANE_COLORS.length])
        }
        lanes[fl] = pid
        if (!commitColor[pid]) commitColor[pid] = LANE_COLORS[fl % LANE_COLORS.length]
      }
    }
  }

  const rowByID: Record<string, number> = {}
  placed.forEach((p, i) => { rowByID[p.id] = i })

  const edges: GraphEdge[] = []
  for (let row = 0; row < placed.length; row++) {
    const p = placed[row]
    for (const pid of p.parents) {
      const targetRow = rowByID[pid]
      if (targetRow !== undefined) {
        edges.push({ x1: p.x, row1: row, x2: placed[targetRow].x, row2: targetRow, color: p.color })
      }
    }
  }

  const maxX = placed.length ? Math.max(...placed.map(p => p.x)) : 0
  return { placed, edges, maxX }
}

function makePath(e: GraphEdge): string {
  const x1 = e.x1 * LANE_W + LANE_W / 2
  const y1 = e.row1 * ROW_H + ROW_H / 2
  const x2 = e.x2 * LANE_W + LANE_W / 2
  const y2 = e.row2 * ROW_H + ROW_H / 2
  const sy = y1 + NODE_R
  const ey = y2 - NODE_R

  if (x1 === x2) {
    return `M ${x1} ${sy} L ${x2} ${ey}`
  }
  // Curve: go straight down most of the way, then curve across in the last row
  const inflect = y2 - ROW_H * 0.55
  return `M ${x1} ${sy} L ${x1} ${inflect} C ${x1} ${y2} ${x2} ${y2 - ROW_H * 0.4} ${x2} ${ey}`
}

function refClass(ref: string): string {
  if (ref === 'HEAD') return 'graph-ref-head'
  if (ref.includes('/')) return 'graph-ref-remote'
  return 'graph-ref-local'
}

type TimeFilter = 'all' | '7d' | '30d' | '6m' | '1y'

const TIME_FILTER_SECONDS: Record<TimeFilter, number | null> = {
  'all': null,
  '7d':  7 * 86400,
  '30d': 30 * 86400,
  '6m':  180 * 86400,
  '1y':  365 * 86400,
}

export function GraphView() {
  const { t } = useTranslation()
  const {
    repoPath, activeTab, checkoutCommit, selectCommit, repoStatus,
    revertCommit, cherryPickCommit, resetToCommit, createTag,
    graphCommits, graphLimit, graphLoading, graphSelected,
    loadGraph, loadMoreGraph, loadAllGraph, setGraphSelected, locateCommit,
    startBisect, aiSuggestBisectGood, showToast,
  } = useStore()
  const [bisectAiLoading, setBisectAiLoading] = useState(false)
  const [bisectAiReason, setBisectAiReason] = useState<string | null>(null)
  // Aliases to keep the existing JSX readable.
  const commits = graphCommits
  const selected = graphSelected
  const loadingMore = graphLoading
  const limit = graphLimit
  const setSelected = setGraphSelected
  // Action targets just need RawCommit fields (id/shortId/message); the
  // lane-allocator's x/color are irrelevant for checkout/revert/cherry-pick.
  const [checkoutTarget, setCheckoutTarget] = useState<RawCommit | null>(null)
  const [revertTarget, setRevertTarget] = useState<RawCommit | null>(null)
  const [revertMsg, setRevertMsg] = useState('')
  const [cherryTarget, setCherryTarget] = useState<RawCommit | null>(null)
  const [cherryMsg, setCherryMsg] = useState('')
  const [bisectStartTarget, setBisectStartTarget] = useState<RawCommit | null>(null)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [resetTarget, setResetTarget] = useState<GraphCommit | null>(null)
  const [resetMode, setResetMode] = useState<'soft' | 'mixed' | 'hard'>('mixed')
  const [tagTarget, setTagTarget] = useState<GraphCommit | null>(null)
  const [tagName, setTagName] = useState('')
  const [tagMessage, setTagMessage] = useState('')
  const [rebaseOpen, setRebaseOpen] = useState(false)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Filter state — client-side over the loaded window.
  const [filterMsg, setFilterMsg] = useState('')
  const [filterAuthor, setFilterAuthor] = useState<string>('')  // '' = all
  const [filterTime, setFilterTime] = useState<TimeFilter>('all')

  // SHA-prefix jump: when filterMsg looks like hex, query the backend and
  // offer a "jump to that commit" banner above the list.
  const [prefixMatch, setPrefixMatch] = useState<CommitInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!repoPath) { setPrefixMatch(null); return }
    const p = filterMsg.trim().toLowerCase()
    if (!/^[0-9a-f]{4,40}$/.test(p)) {
      setPrefixMatch(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      invoke<CommitInfo | null>('find_commit_by_prefix', { path: repoPath, prefix: p })
        .then(r => { if (!cancelled) setPrefixMatch(r ?? null) })
        .catch(() => { if (!cancelled) setPrefixMatch(null) })
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [filterMsg, repoPath])

  const jumpToCommit = async (c: CommitInfo) => {
    setFilterMsg('')
    setFilterAuthor('')
    setFilterTime('all')
    setSelected(c.id)
    selectCommit({ id: c.id, shortId: c.shortId, message: c.message })
    // Auto-expand the loaded window until this commit is in it, then scroll.
    const idx = await locateCommit(c.id)
    if (idx >= 0 && scrollRef.current) {
      scrollRef.current.scrollTo({ top: idx * ROW_H - 60, behavior: 'smooth' })
    }
  }

  const hasFilter =
    filterMsg.trim() !== '' || filterAuthor !== '' || filterTime !== 'all'

  const authors = useMemo(() => {
    const set = new Set<string>()
    for (const c of commits) if (c.author) set.add(c.author)
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [commits])

  const filteredCommits = useMemo(() => {
    if (!hasFilter) return commits
    const msgQ = filterMsg.trim().toLowerCase()
    const cutoff = (() => {
      const fSeconds = TIME_FILTER_SECONDS[filterTime]
      if (!fSeconds) return 0
      return Math.floor(Date.now() / 1000) - fSeconds
    })()
    return commits.filter(c => {
      if (msgQ && !c.message.toLowerCase().includes(msgQ)) return false
      if (filterAuthor && c.author !== filterAuthor) return false
      if (cutoff && c.time < cutoff) return false
      return true
    })
  }, [commits, hasFilter, filterMsg, filterAuthor, filterTime])

  const clearFilter = () => {
    setFilterMsg('')
    setFilterAuthor('')
    setFilterTime('all')
  }

  // Close kebab menu on outside click
  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Element
      if (!tgt.closest('.commit-actions')) setMenuFor(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuFor])

  // When a revert/cherry-pick modal opens, fetch the default commit message
  // git would naturally use so the textarea isn't empty.
  useEffect(() => {
    if (!revertTarget || !repoPath) { setRevertMsg(''); return }
    setRevertMsg('')  // clear stale value while loading
    invoke<string>('prepare_commit_message', {
      path: repoPath, sha: revertTarget.id, operation: 'revert',
    })
      .then(setRevertMsg)
      .catch(() => setRevertMsg(`Revert "${revertTarget.message}"`))
  }, [revertTarget?.id, repoPath])

  useEffect(() => {
    if (!cherryTarget || !repoPath) { setCherryMsg(''); return }
    setCherryMsg('')
    invoke<string>('prepare_commit_message', {
      path: repoPath, sha: cherryTarget.id, operation: 'cherry-pick',
    })
      .then(setCherryMsg)
      .catch(() => setCherryMsg(cherryTarget.message))
  }, [cherryTarget?.id, repoPath])

  // Re-fetch via store action when this view becomes visible OR the active
  // repo / its state changes. Store-side limit survives tab switches.
  useEffect(() => {
    if (!repoPath || activeTab !== 'history') return
    loadGraph()
  }, [repoPath, activeTab, repoStatus])

  // hasMore = backend filled the requested window exactly → may be more.
  const hasMore = commits.length === limit
  const [showLoadAllConfirm, setShowLoadAllConfirm] = useState(false)

  const handleRowClick = (p: RawCommit) => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current)
      clickTimer.current = null
      setCheckoutTarget(p)
    } else {
      clickTimer.current = setTimeout(() => {
        clickTimer.current = null
        setSelected(p.id)
        selectCommit({ id: p.id, shortId: p.shortId, message: p.message })
      }, 250)
    }
  }

  const handleConfirmCheckout = async () => {
    if (!checkoutTarget) return
    const info = { id: checkoutTarget.id, shortId: checkoutTarget.shortId, message: checkoutTarget.message }
    await checkoutCommit(checkoutTarget.id, info)
    setCheckoutTarget(null)
    loadGraph()
  }

  const { placed, edges, maxX } = useMemo(() => computeGraph(commits), [commits])

  const svgW = (maxX + 1) * LANE_W + 12
  const totalH = placed.length * ROW_H

  // Rendered list: filter results override the placed graph view.
  const rowsToRender: RawCommit[] = hasFilter ? filteredCommits : placed

  const renderRow = (p: RawCommit) => (
    <div
      key={p.id}
      className={`graph-row ${selected === p.id ? 'selected' : ''}`}
      onClick={() => handleRowClick(p)}
    >
      <div className="graph-row-main">
        {p.refs.map(ref => (
          <span key={ref} className={`graph-ref ${refClass(ref)}`}>{ref}</span>
        ))}
        <span className="graph-msg">{p.message}</span>
      </div>
      <div className="graph-row-meta">
        <span className="graph-author">{p.author}</span>
        <span className="graph-time">{relTime(p.time)}</span>
        <span className="graph-sha">{p.shortId}</span>
        <div className="commit-actions" onClick={e => e.stopPropagation()}>
          <button
            className="commit-actions-btn"
            onClick={() => setMenuFor(menuFor === p.id ? null : p.id)}
            title={t('cheatsheet.kebab_desc')}
            aria-label={t('cheatsheet.kebab_desc')}
          >
            <i className="ti ti-dots-vertical" />
          </button>
          {menuFor === p.id && (
            <div className="commit-actions-menu">
              <button onClick={() => { setMenuFor(null); setCheckoutTarget(p) }}>
                <i className="ti ti-git-branch" />
                <span>{t('graph.menu_checkout')}</span>
              </button>
              <button onClick={() => { setMenuFor(null); setRevertTarget(p) }}>
                <i className="ti ti-arrow-back-up" />
                <span>{t('graph.menu_revert')}</span>
              </button>
              <button onClick={() => { setMenuFor(null); setCherryTarget(p) }}>
                <i className="ti ti-cherry" />
                <span>{t('graph.menu_cherrypick')}</span>
              </button>
              <button
                onClick={() => { setMenuFor(null); setBisectStartTarget(p) }}
                title={t('graph.menu_bisect_hint')}
              >
                <i className="ti ti-search" />
                <span>{t('graph.menu_bisect_start')}</span>
              </button>
              <button onClick={() => { setMenuFor(null); setResetTarget(p) }} title={t('graph.menu_reset_hint')}>
                <i className="ti ti-rewind-backward-10" />
                <span>{t('graph.menu_reset')}</span>
              </button>
              <button onClick={() => { setMenuFor(null); setTagTarget(p); setTagName(''); setTagMessage('') }}>
                <i className="ti ti-tag" />
                <span>{t('graph.menu_tag')}</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <button
          className="ct-btn"
          onClick={() => setRebaseOpen(true)}
          title={t('graph.arrange_tooltip')}
        >
          <i className="ti ti-stack-2" />
          {t('graph.arrange_btn')}
        </button>
        <button
          className="ct-btn"
          onClick={async () => {
            setBisectAiLoading(true)
            try {
              const s = await aiSuggestBisectGood()
              setBisectAiReason(s.reason || '')
              setBisectStartTarget({
                id: s.sha, shortId: s.shortId, message: s.subject,
                author: '', time: 0, parents: [], refs: [],
              })
            } catch (e) {
              showToast(String(e), 'error')
            } finally {
              setBisectAiLoading(false)
            }
          }}
          disabled={bisectAiLoading}
          title={t('graph.ai_bisect_tooltip')}
        >
          <i className={`ti ${bisectAiLoading ? 'ti-loader-2' : 'ti-sparkles'}`} />
          {bisectAiLoading ? t('graph.ai_bisect_loading') : t('graph.ai_bisect_btn')}
        </button>
        <div className="graph-toolbar-spacer" />
        <div className="graph-search">
          <i className="ti ti-search" />
          <input
            type="text"
            value={filterMsg}
            placeholder={t('graph.search_placeholder')}
            onChange={e => setFilterMsg(e.target.value)}
          />
          {filterMsg && (
            <button
              className="graph-search-clear"
              onClick={() => setFilterMsg('')}
              title={t('common.close')}
              aria-label={t('graph.search_clear_aria')}
            >
              <i className="ti ti-x" />
            </button>
          )}
        </div>
        <select
          className="graph-filter-select"
          value={filterAuthor}
          onChange={e => setFilterAuthor(e.target.value)}
          title={t('graph.author_filter_tooltip')}
        >
          <option value="">{t('graph.author_all_label')}</option>
          {authors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          className="graph-filter-select"
          value={filterTime}
          onChange={e => setFilterTime(e.target.value as TimeFilter)}
          title={t('graph.time_filter_tooltip')}
        >
          <option value="all">{t('graph.time_all')}</option>
          <option value="7d">{t('graph.time_7d')}</option>
          <option value="30d">{t('graph.time_30d')}</option>
          <option value="6m">{t('graph.time_6m')}</option>
          <option value="1y">{t('graph.time_1y')}</option>
        </select>
        {hasFilter && (
          <button className="ct-btn ghost" onClick={clearFilter} title={t('graph.clear_filters_tooltip')}>
            <i className="ti ti-x" />
            {t('graph.clear_filters')}
          </button>
        )}
      </div>

      {prefixMatch && (
        <div className="graph-jump-banner">
          <i className="ti ti-target" />
          <span className="graph-jump-sha">{prefixMatch.shortId}</span>
          <span className="graph-jump-msg" title={prefixMatch.message}>{prefixMatch.message}</span>
          <span className="graph-jump-author">{prefixMatch.author}</span>
          <button
            className="btn-primary graph-jump-btn"
            onClick={() => jumpToCommit(prefixMatch)}
          >
            <i className="ti ti-arrow-right" />
            {commits.some(c => c.id === prefixMatch.id) ? t('graph.jump_to') : t('graph.jump_locate')}
          </button>
        </div>
      )}

      {commits.length === 0 ? (
        <div className="empty-state center">
          <i className="ti ti-git-commit" style={{ fontSize: 36, opacity: 0.15 }} />
          <p>{t('graph.empty')}</p>
        </div>
      ) : hasFilter && filteredCommits.length === 0 ? (
        <div className="empty-state center">
          <i className="ti ti-search-off" style={{ fontSize: 36, opacity: 0.15 }} />
          <p>{t('graph.empty_no_match')}</p>
          <button className="ct-btn ghost" onClick={clearFilter} style={{ marginTop: 8 }}>
            {t('graph.clear_filters')}
          </button>
        </div>
      ) : (
        <div className="graph-scroll" ref={scrollRef}>
          <div className="graph-inner">
            {/* Lane SVG only makes sense in unfiltered view (parents may be missing in filtered) */}
            {!hasFilter && (
              <svg className="graph-svg" width={svgW} height={totalH} style={{ flexShrink: 0 }}>
                {edges.map((e, i) => (
                  <path
                    key={i}
                    d={makePath(e)}
                    stroke={e.color}
                    strokeWidth={1.5}
                    fill="none"
                    opacity={0.85}
                  />
                ))}
                {placed.map((p, i) => (
                  <circle
                    key={p.id}
                    cx={p.x * LANE_W + LANE_W / 2}
                    cy={i * ROW_H + ROW_H / 2}
                    r={NODE_R}
                    fill={p.color}
                    stroke="var(--bg)"
                    strokeWidth={2}
                  />
                ))}
              </svg>
            )}

            <div className={`graph-rows ${hasFilter ? 'flat' : ''}`}>
              {rowsToRender.map(renderRow)}
            </div>
          </div>
          <div className="graph-load-more">
            {hasMore ? (
              <>
                <button
                  className="ct-btn"
                  onClick={loadMoreGraph}
                  disabled={loadingMore}
                  title={t('graph.load_more_tooltip', { n: useStore.getState().graphLoadStep })}
                >
                  <i className={`ti ${loadingMore ? 'ti-loader-2' : 'ti-arrow-down'}`} />
                  {loadingMore ? t('graph.loading') : t('graph.load_more_msg', { n: useStore.getState().graphLoadStep, total: commits.length })}
                </button>
                <button
                  className="ct-btn ghost"
                  onClick={() => {
                    if (commits.length >= 2000) setShowLoadAllConfirm(true)
                    else loadAllGraph()
                  }}
                  disabled={loadingMore}
                  title={t('graph.load_all_tooltip')}
                >
                  <i className="ti ti-stack" />
                  {t('graph.load_all_btn')}
                </button>
              </>
            ) : (
              <span className="graph-load-more-done">
                {loadingMore
                  ? t('graph.loading')
                  : `${commits.length} commits`}
              </span>
            )}
          </div>
        </div>
      )}

      {checkoutTarget && (
        <div className="modal-overlay" onClick={() => setCheckoutTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('graph.checkout_title')}</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{checkoutTarget.shortId}</span>
                <span className="modal-commit-msg">{checkoutTarget.message}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                {t('graph.checkout_warn')}
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setCheckoutTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleConfirmCheckout}>{t('common.confirm')}</button>
            </div>
          </div>
        </div>
      )}

      {revertTarget && (
        <div className="modal-overlay" onClick={() => setRevertTarget(null)}>
          <div className="modal commit-msg-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('graph.revert_title')}</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{revertTarget.shortId}</span>
                <span className="modal-commit-msg">{revertTarget.message}</span>
              </div>
              <label className="commit-msg-label">撤销提交的说明（可改）</label>
              <textarea
                className="commit-input commit-msg-input"
                value={revertMsg}
                onChange={e => setRevertMsg(e.target.value)}
                rows={5}
                placeholder="正在加载默认说明…"
              />
              <p className="modal-warn">
                <i className="ti ti-info-circle" />
                会在当前分支上新建一个提交，反转这条提交的所有改动。原提交保留在历史里，不会被删除。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setRevertTarget(null)}>取消</button>
              <button
                className="btn-primary"
                disabled={!revertMsg.trim()}
                onClick={async () => {
                  const sha = revertTarget.id
                  const msg = revertMsg
                  setRevertTarget(null)
                  await revertCommit(sha, msg)
                }}
              >
                <i className="ti ti-arrow-back-up" />
                {t('graph.revert_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {cherryTarget && (
        <div className="modal-overlay" onClick={() => setCherryTarget(null)}>
          <div className="modal commit-msg-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">拣选到当前分支？</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{cherryTarget.shortId}</span>
                <span className="modal-commit-msg">{cherryTarget.message}</span>
              </div>
              <label className="commit-msg-label">提交说明（可改）</label>
              <textarea
                className="commit-input commit-msg-input"
                value={cherryMsg}
                onChange={e => setCherryMsg(e.target.value)}
                rows={5}
                placeholder="正在加载默认说明…"
              />
              <p className="modal-warn">
                <i className="ti ti-info-circle" />
                会把这条提交的改动复制成当前分支上的一个新提交，原 commit 不动。如果有冲突会停下来让你处理。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setCherryTarget(null)}>取消</button>
              <button
                className="btn-primary"
                disabled={!cherryMsg.trim()}
                onClick={async () => {
                  const sha = cherryTarget.id
                  const msg = cherryMsg
                  setCherryTarget(null)
                  await cherryPickCommit(sha, msg)
                }}
              >
                <i className="ti ti-cherry" />
                确认拣选
              </button>
            </div>
          </div>
        </div>
      )}

      {rebaseOpen && <RebaseModal onClose={() => setRebaseOpen(false)} />}

      {bisectStartTarget && (
        <div className="modal-overlay" onClick={() => { setBisectStartTarget(null); setBisectAiReason(null) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">从这里开始查找问题？</div>
            <div className="modal-body">
              {bisectAiReason && (
                <div className="bisect-ai-reason">
                  <i className="ti ti-sparkles" />
                  <span><strong>AI 推荐：</strong>{bisectAiReason}</span>
                </div>
              )}
              <div className="modal-commit-preview">
                <span className="graph-sha">{bisectStartTarget.shortId}</span>
                <span className="modal-commit-msg">{bisectStartTarget.message}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-info-circle" />
                把当前分支头标为「这版已经坏了」，把所选 commit 标为「那时候还能用」。git 会在两者之间二分检出中间版本让你测试。每次你回答「好」或「坏」，搜索范围减半，直到找到第一个出问题的提交。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => { setBisectStartTarget(null); setBisectAiReason(null) }}>取消</button>
              <button
                className="btn-primary"
                onClick={async () => {
                  const sha = bisectStartTarget.id
                  setBisectStartTarget(null)
                  setBisectAiReason(null)
                  await startBisect(sha)
                }}
              >
                <i className="ti ti-search" />
                开始查找
              </button>
            </div>
          </div>
        </div>
      )}

      {resetTarget && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">回退到这版？</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{resetTarget.shortId}</span>
                <span className="modal-commit-msg">{resetTarget.message}</span>
              </div>
              <div className="reset-modes">
                <label className={`reset-mode ${resetMode === 'soft' ? 'active' : ''}`}>
                  <input type="radio" checked={resetMode === 'soft'} onChange={() => setResetMode('soft')} />
                  <div>
                    <div className="reset-mode-name">软回退（--soft）</div>
                    <div className="reset-mode-desc">分支指针移动，已暂存和工作区保留。最安全。</div>
                  </div>
                </label>
                <label className={`reset-mode ${resetMode === 'mixed' ? 'active' : ''}`}>
                  <input type="radio" checked={resetMode === 'mixed'} onChange={() => setResetMode('mixed')} />
                  <div>
                    <div className="reset-mode-name">混合回退（--mixed，默认）</div>
                    <div className="reset-mode-desc">分支指针移动，暂存区清空，工作区保留。</div>
                  </div>
                </label>
                <label className={`reset-mode danger ${resetMode === 'hard' ? 'active' : ''}`}>
                  <input type="radio" checked={resetMode === 'hard'} onChange={() => setResetMode('hard')} />
                  <div>
                    <div className="reset-mode-name">硬回退（--hard）</div>
                    <div className="reset-mode-desc">所有未提交的改动都会丢。不可撤销！</div>
                  </div>
                </label>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setResetTarget(null)}>取消</button>
              <button
                className={resetMode === 'hard' ? 'btn-danger' : 'btn-primary'}
                onClick={async () => {
                  const t = resetTarget
                  const m = resetMode
                  setResetTarget(null)
                  await resetToCommit(t.id, m)
                }}
              >
                <i className="ti ti-rewind-backward-10" />
                确认回退
              </button>
            </div>
          </div>
        </div>
      )}

      {tagTarget && (
        <div className="modal-overlay" onClick={() => setTagTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">打标签</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <span className="graph-sha">{tagTarget.shortId}</span>
                <span className="modal-commit-msg">{tagTarget.message}</span>
              </div>
              <input
                className="settings-input"
                placeholder="标签名称（如 v1.0.0）"
                value={tagName}
                onChange={e => setTagName(e.target.value)}
                autoFocus
              />
              <textarea
                className="commit-input"
                placeholder="可选：标签说明（填了就是 annotated tag）"
                rows={3}
                value={tagMessage}
                onChange={e => setTagMessage(e.target.value)}
                style={{ marginTop: 8 }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setTagTarget(null)}>取消</button>
              <button
                className="btn-primary"
                disabled={!tagName.trim()}
                onClick={async () => {
                  const t = tagTarget
                  const n = tagName.trim()
                  const m = tagMessage.trim() || null
                  setTagTarget(null)
                  try { await createTag(n, t.id, m) }
                  catch (e) { useStore.getState().showToast(String(e), 'error') }
                }}
              >
                <i className="ti ti-tag" />
                创建标签
              </button>
            </div>
          </div>
        </div>
      )}

      {showLoadAllConfirm && (
        <div className="modal-overlay" onClick={() => setShowLoadAllConfirm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">加载全部历史？</div>
            <div className="modal-body">
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                目前已加载 {commits.length} 条。仓库可能很深；一次性拉全部历史在大仓库上可能要等几秒到几十秒，期间界面会卡。继续？
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowLoadAllConfirm(false)}>取消</button>
              <button
                className="btn-primary"
                onClick={() => {
                  setShowLoadAllConfirm(false)
                  loadAllGraph()
                }}
              >
                <i className="ti ti-stack" />
                确认加载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
