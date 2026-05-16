import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore, type BranchInfo, type TagInfo, type SubmoduleInfo } from '../../store'
import { MergeModal } from '../Merge'
import { relTime } from '../../lib/relTime'

export function BranchesView() {
  const { t } = useTranslation()
  const {
    branches, loadBranches,
    switchBranch, checkoutRemoteBranch,
    renameBranch, deleteBranch, deleteRemoteBranch,
    repoPath,
  } = useStore()
  const [filter, setFilter] = useState('')
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<BranchInfo | null>(null)
  const [newName, setNewName] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<BranchInfo | null>(null)
  const [deleteForce, setDeleteForce] = useState(false)
  const [deleteRemoteTarget, setDeleteRemoteTarget] = useState<BranchInfo | null>(null)
  const [deleteRemoteConfirm, setDeleteRemoteConfirm] = useState('')
  const [mergeTarget, setMergeTarget] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadBranches()
  }, [repoPath])

  // Close kebab on outside click
  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element
      if (!t.closest('.commit-actions')) setMenuFor(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuFor])

  // Pre-fill + focus on rename modal open
  useEffect(() => {
    if (!renameTarget) return
    setNewName(renameTarget.name)
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }, [renameTarget?.name])

  // Reset force checkbox each time delete modal opens
  useEffect(() => {
    if (deleteTarget) setDeleteForce(false)
  }, [deleteTarget?.name])

  // Reset type-to-confirm input each time remote-delete modal opens
  useEffect(() => {
    if (deleteRemoteTarget) setDeleteRemoteConfirm('')
  }, [deleteRemoteTarget?.name])

  const local = useMemo(
    () => branches.filter(b => !b.isRemote && match(b.name, filter)),
    [branches, filter]
  )
  const remote = useMemo(
    () => branches.filter(b => b.isRemote && match(b.name, filter)),
    [branches, filter]
  )

  const onDoubleClickLocal = async (name: string, isCurrent: boolean) => {
    if (isCurrent) return
    await switchBranch(name)
  }

  const handleRename = async () => {
    if (!renameTarget) return
    const n = newName.trim()
    if (!n || n === renameTarget.name) {
      setRenameTarget(null)
      return
    }
    const old = renameTarget.name
    setRenameTarget(null)
    await renameBranch(old, n)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    const name = deleteTarget.name
    const force = deleteForce
    setDeleteTarget(null)
    try {
      await deleteBranch(name, force)
    } catch {
      // store already toasted; keep modal closed
    }
  }

  return (
    <div className="branches-view">
      <div className="branches-toolbar">
        <div className="branches-filter">
          <i className="ti ti-search" />
          <input
            type="text"
            value={filter}
            placeholder={t('sidebar.branch_search')}
            onChange={e => setFilter(e.target.value)}
          />
          {filter && (
            <button
              className="branches-filter-clear"
              onClick={() => setFilter('')}
              title={t('common.close')}
            >
              <i className="ti ti-x" />
            </button>
          )}
        </div>
        <span className="branches-hint">{t('branches.hint')}</span>
      </div>

      <div className="branches-scroll">
        <BranchList
          title={`${t('branches.title_local')} · ${local.length}`}
          items={local}
          emptyText={t('branches.empty_local')}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          onDoubleClick={(b) => onDoubleClickLocal(b.name, b.isCurrent)}
          onRename={(b) => setRenameTarget(b)}
          onDelete={(b) => setDeleteTarget(b)}
          onMerge={(b) => setMergeTarget(b.name)}
        />
        <BranchList
          title={`${t('branches.title_remote')} · ${remote.length}`}
          items={remote}
          emptyText={t('branches.empty_remote')}
          menuFor={menuFor}
          setMenuFor={setMenuFor}
          onDoubleClick={(b) => checkoutRemoteBranch(b.name)}
          onRename={null}
          onDelete={(b) => setDeleteRemoteTarget(b)}
          onMerge={(b) => setMergeTarget(b.name)}
          deleteLabel={t('branches.delete_remote')}
        />
        <TagsSection filter={filter} />
        <SubmodulesSection filter={filter} />
      </div>

      {mergeTarget && (
        <MergeModal target={mergeTarget} onClose={() => setMergeTarget(null)} />
      )}

      {deleteRemoteTarget && (() => {
        const expected = deleteRemoteTarget.name.split('/').slice(1).join('/')
        const match = deleteRemoteConfirm.trim() === expected
        return (
          <div className="modal-overlay" onClick={() => setDeleteRemoteTarget(null)}>
            <div className="modal" onClick={e => e.stopPropagation()}>
              <div className="modal-title">{t('branches.delete_remote_title')}</div>
              <div className="modal-body">
                <div className="modal-commit-preview">
                  <i className="ti ti-cloud" />
                  <span className="modal-commit-msg">{deleteRemoteTarget.name}</span>
                </div>
                <p className="modal-warn">
                  <i className="ti ti-alert-triangle" />
                  <strong>这会推送到远程服务器，永久删除该分支</strong>。其他协作者下次拉取就会看到分支消失。本地的同名分支（如果存在）不会被动到。
                </p>
                <p style={{ fontSize: 12, marginTop: 12, marginBottom: 6, opacity: 0.7 }}>
                  为防止误操作，请输入分支名 <code className="graph-sha">{expected}</code> 确认：
                </p>
                <input
                  className="settings-input"
                  value={deleteRemoteConfirm}
                  onChange={e => setDeleteRemoteConfirm(e.target.value)}
                  placeholder={expected}
                  spellCheck={false}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => setDeleteRemoteTarget(null)}>{t('common.cancel')}</button>
                <button
                  className="btn-primary"
                  disabled={!match}
                  onClick={async () => {
                    const fullName = deleteRemoteTarget.name
                    setDeleteRemoteTarget(null)
                    await deleteRemoteBranch(fullName)
                  }}
                >
                  <i className="ti ti-trash" />
                  {t('branches.delete_remote')}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {renameTarget && (
        <div className="modal-overlay" onClick={() => setRenameTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('branches.rename_title')}</div>
            <div className="modal-body">
              <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
                当前名字：<span className="graph-sha">{renameTarget.name}</span>
              </p>
              <input
                ref={renameInputRef}
                className="settings-input"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') setRenameTarget(null)
                }}
                placeholder={t('common.rename')}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setRenameTarget(null)}>{t('common.cancel')}</button>
              <button
                className="btn-primary"
                disabled={!newName.trim() || newName.trim() === renameTarget.name}
                onClick={handleRename}
              >
                <i className="ti ti-pencil" />
                {t('branches.rename')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">{t('branches.delete_title')}</div>
            <div className="modal-body">
              <div className="modal-commit-preview">
                <i className="ti ti-git-branch" />
                <span className="modal-commit-msg">{deleteTarget.name}</span>
              </div>
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                只从本地仓库删除该分支。如果它有未合并到主线的提交，git 会拒绝；勾选下方强制删除可以跳过这个检查。
              </p>
              <label className="delete-force-label">
                <input
                  type="checkbox"
                  checked={deleteForce}
                  onChange={e => setDeleteForce(e.target.checked)}
                />
                <span>{t('branches.force_delete')}</span>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-primary" onClick={handleDelete}>
                <i className="ti ti-trash" />
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function match(name: string, filter: string): boolean {
  if (!filter.trim()) return true
  return name.toLowerCase().includes(filter.trim().toLowerCase())
}

interface BranchListProps {
  title: string
  items: BranchInfo[]
  emptyText: string
  menuFor: string | null
  setMenuFor: (id: string | null) => void
  onDoubleClick: (b: BranchInfo) => void
  /** Provided callbacks render as menu items; null = hide that item. */
  onRename: ((b: BranchInfo) => void) | null
  onDelete: ((b: BranchInfo) => void) | null
  onMerge: ((b: BranchInfo) => void) | null
  /** Override delete-button label (e.g. "删除远程" for remote branches). */
  deleteLabel?: string
}

function BranchList({
  title, items, emptyText,
  menuFor, setMenuFor,
  onDoubleClick, onRename, onDelete, onMerge,
  deleteLabel,
}: BranchListProps) {
  const { t } = useTranslation()
  const finalDeleteLabel = deleteLabel ?? t('branches.delete_local')
  const hasAnyAction = !!(onRename || onDelete || onMerge)
  return (
    <section className="branches-section">
      <h3 className="branches-section-title">{title}</h3>
      {items.length === 0 ? (
        <div className="branches-empty">{emptyText}</div>
      ) : (
        <div className="branches-list">
          {items.map(b => {
            const rowKey = `${b.isRemote ? 'r' : 'l'}:${b.name}`
            return (
              <div
                key={rowKey}
                className={`branch-row ${b.isCurrent ? 'is-current' : ''} ${b.isRemote ? 'is-remote' : ''}`}
                onDoubleClick={() => onDoubleClick(b)}
                // Suppress the row-level tooltip while its action menu is open,
                // otherwise the OS-native title bubble paints on top of the
                // dropdown and makes it look translucent.
                title={
                  menuFor === rowKey
                    ? undefined
                    : (b.isCurrent ? t('branches.tooltip_current') : (b.isRemote ? t('branches.tooltip_remote') : t('branches.tooltip_local')))
                }
              >
                <i className={`ti ${b.isCurrent ? 'ti-check' : (b.isRemote ? 'ti-cloud' : 'ti-git-branch')} branch-icon`} />
                <span className="branch-name">{b.name}</span>
                {/* Always render upstream + counts cells (empty when missing)
                    so grid columns line up across all rows. */}
                <span className="branch-upstream" title={b.upstream ? b.upstream : undefined}>
                  {b.upstream && !b.isRemote ? `→ ${b.upstream}` : ''}
                </span>
                <span className="branch-counts">
                  {b.ahead > 0 && <span className="ahead">↑{b.ahead}</span>}
                  {b.behind > 0 && <span className="behind">↓{b.behind}</span>}
                </span>
                <span className="branch-last" title={b.lastSubject}>{b.lastSubject}</span>
                <span className="branch-meta">
                  <span className="branch-sha">{b.lastShort}</span>
                  <span className="branch-time">{relTime(b.lastTime)}</span>
                  {hasAnyAction && !b.isCurrent && (
                    <div className="commit-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className="commit-actions-btn"
                        onClick={() => setMenuFor(menuFor === rowKey ? null : rowKey)}
                        title={t('cheatsheet.kebab_desc')}
                        aria-label={t('cheatsheet.kebab_desc')}
                      >
                        <i className="ti ti-dots-vertical" />
                      </button>
                      {menuFor === rowKey && (
                        <div className="commit-actions-menu">
                          {onMerge && (
                            <button onClick={() => { setMenuFor(null); onMerge(b) }}>
                              <i className="ti ti-git-merge" />
                              <span>{t('branches.merge_into_current')}</span>
                            </button>
                          )}
                          {onRename && (
                            <button onClick={() => { setMenuFor(null); onRename(b) }}>
                              <i className="ti ti-pencil" />
                              <span>{t('branches.rename')}</span>
                            </button>
                          )}
                          {onDelete && (
                            <button
                              onClick={() => { setMenuFor(null); onDelete(b) }}
                              title={finalDeleteLabel === t('branches.delete_remote') ? t('branches.delete_remote_help') : t('branches.delete_local_help')}
                            >
                              <i className="ti ti-trash" />
                              <span>{finalDeleteLabel}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// ── Tags section ───────────────────────────────────────────────────────

function TagsSection({ filter }: { filter: string }) {
  const { t } = useTranslation()
  const { listTags, deleteLocalTag, pushTag, deleteRemoteTag, repoPath, showToast } = useStore()
  const [tags, setTags] = useState<TagInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<TagInfo | null>(null)

  const refresh = async () => {
    setLoading(true)
    try { setTags(await listTags()) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [repoPath])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return tags
    return tags.filter(t => t.name.toLowerCase().includes(q))
  }, [tags, filter])

  if (loading) return null
  if (tags.length === 0) return null

  return (
    <section className="branches-section">
      <h3 className="branches-section-title">{t('branches.title_tags')} · {filtered.length}</h3>
      {filtered.length === 0 ? (
        <div className="branches-empty">{t('branches.empty_tags')}</div>
      ) : (
        <div className="branches-list">
          {filtered.map(tag => (
            <div key={tag.name} className="branch-row" title={tag.annotated ? (tag.message || '') : ''}>
              <i className={`ti ${tag.annotated ? 'ti-tag-filled' : 'ti-tag'} branch-icon`} />
              <span className="branch-name">{tag.name}</span>
              <span className="branch-upstream">{tag.annotated && tag.tagger ? tag.tagger : ''}</span>
              <span className="branch-counts" />
              <span className="branch-last" title={tag.message || ''}>{tag.message || ''}</span>
              <span className="branch-meta">
                <span className="branch-sha">{tag.targetShort}</span>
                <span className="branch-time">{tag.time ? relTime(tag.time) : ''}</span>
                <div className="commit-actions" onClick={e => e.stopPropagation()}>
                  <button
                    className="commit-actions-btn"
                    onClick={() => setMenuFor(menuFor === tag.name ? null : tag.name)}
                    title={t('cheatsheet.kebab_desc')}
                  >
                    <i className="ti ti-dots-vertical" />
                  </button>
                  {menuFor === tag.name && (
                    <div className="commit-actions-menu">
                      <button
                        onClick={async () => {
                          setMenuFor(null)
                          try { await pushTag('origin', tag.name) }
                          catch (e) { showToast(String(e), 'error') }
                        }}
                      >
                        <i className="ti ti-cloud-upload" />
                        <span>{t('branches.push_to_remote')}</span>
                      </button>
                      <button
                        onClick={async () => {
                          setMenuFor(null)
                          try {
                            await deleteRemoteTag('origin', tag.name)
                          } catch (e) { showToast(String(e), 'error') }
                        }}
                      >
                        <i className="ti ti-cloud-off" />
                        <span>{t('branches.delete_from_remote')}</span>
                      </button>
                      <button onClick={() => { setMenuFor(null); setConfirmDelete(tag) }}>
                        <i className="ti ti-trash" />
                        <span>{t('branches.delete_local_tag')}</span>
                      </button>
                    </div>
                  )}
                </div>
              </span>
            </div>
          ))}
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">删除标签 {confirmDelete.name}？</div>
            <div className="modal-body">
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                只删除本地标签。远程上的同名标签不会受影响（用"从 origin 删除"才会）。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>取消</button>
              <button
                className="btn-danger"
                onClick={async () => {
                  const name = confirmDelete.name
                  setConfirmDelete(null)
                  try { await deleteLocalTag(name); await refresh() }
                  catch (e) { showToast(String(e), 'error') }
                }}
              >
                <i className="ti ti-trash" />
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Submodules section ─────────────────────────────────────────────────

function submoduleStatusBadge(s: SubmoduleInfo): { label: string; tone: 'ok' | 'warn' | 'info' | 'off' } {
  if (!s.inWorkdir) return { label: '未初始化', tone: 'off' }
  if (s.workdirModified) return { label: '有未提交改动', tone: 'warn' }
  if (s.indexOutOfSync || s.workdirOutOfSync) return { label: '与父记录不一致', tone: 'info' }
  return { label: '已更新', tone: 'ok' }
}

function SubmodulesSection({ filter }: { filter: string }) {
  const {
    listSubmodules, addSubmodule, initSubmodule, updateSubmodule,
    syncSubmodule, deinitSubmodule, removeSubmodule, repoPath, showToast,
  } = useStore()

  const [subs, setSubs] = useState<SubmoduleInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newPath, setNewPath] = useState('')
  const [removeTarget, setRemoveTarget] = useState<SubmoduleInfo | null>(null)

  const refresh = async () => {
    setLoading(true)
    try { setSubs(await listSubmodules()) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh() }, [repoPath])

  useEffect(() => {
    if (!menuFor) return
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Element
      if (!tgt.closest('.commit-actions')) setMenuFor(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuFor])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return subs
    return subs.filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.path.toLowerCase().includes(q) ||
      s.url.toLowerCase().includes(q),
    )
  }, [subs, filter])

  if (loading) return null

  const handleAdd = async () => {
    const url = newUrl.trim()
    const sp = newPath.trim()
    if (!url || !sp) return
    setAddOpen(false)
    try {
      await addSubmodule(url, sp)
      setNewUrl(''); setNewPath('')
      await refresh()
    } catch (e) { showToast(String(e), 'error') }
  }

  return (
    <section className="branches-section">
      <h3 className="branches-section-title">
        子模块 · {filtered.length}
        <button className="branches-add-btn" onClick={() => setAddOpen(true)} title="添加子模块">
          <i className="ti ti-plus" />
        </button>
      </h3>

      {filtered.length === 0 ? (
        <div className="branches-empty">{subs.length === 0 ? '这个仓库没有子模块' : '没有匹配的子模块'}</div>
      ) : (
        <div className="branches-list">
          {filtered.map(s => {
            const badge = submoduleStatusBadge(s)
            return (
              <div key={s.name} className="branch-row" title={s.url}>
                <i className="ti ti-package branch-icon" />
                <span className="branch-name">{s.path}</span>
                <span className="branch-upstream">{s.url}</span>
                <span className="branch-counts">
                  <span className={`submodule-badge tone-${badge.tone}`}>{badge.label}</span>
                </span>
                <span className="branch-last">{s.branch || ''}</span>
                <span className="branch-meta">
                  <span className="branch-sha">{s.headOid ? s.headOid.slice(0, 7) : ''}</span>
                  <span className="branch-time" />
                  <div className="commit-actions" onClick={e => e.stopPropagation()}>
                    <button
                      className="commit-actions-btn"
                      onClick={() => setMenuFor(menuFor === s.name ? null : s.name)}
                      title="子模块操作"
                    >
                      <i className="ti ti-dots-vertical" />
                    </button>
                    {menuFor === s.name && (
                      <div className="commit-actions-menu">
                        {!s.inWorkdir ? (
                          <button
                            onClick={async () => {
                              setMenuFor(null)
                              try { await initSubmodule(s.name); await refresh() }
                              catch (e) { showToast(String(e), 'error') }
                            }}
                          >
                            <i className="ti ti-download" />
                            <span>初始化并拉取</span>
                          </button>
                        ) : (
                          <button
                            onClick={async () => {
                              setMenuFor(null)
                              try { await updateSubmodule(s.name); await refresh() }
                              catch (e) { showToast(String(e), 'error') }
                            }}
                          >
                            <i className="ti ti-refresh" />
                            <span>对齐到父记录</span>
                          </button>
                        )}
                        <button
                          onClick={async () => {
                            setMenuFor(null)
                            try { await syncSubmodule(s.name); await refresh() }
                            catch (e) { showToast(String(e), 'error') }
                          }}
                        >
                          <i className="ti ti-link" />
                          <span>同步 URL</span>
                        </button>
                        {s.inWorkdir && (
                          <button
                            onClick={async () => {
                              setMenuFor(null)
                              try { await deinitSubmodule(s.name); await refresh() }
                              catch (e) { showToast(String(e), 'error') }
                            }}
                          >
                            <i className="ti ti-eraser" />
                            <span>清空工作区（deinit）</span>
                          </button>
                        )}
                        <button onClick={() => { setMenuFor(null); setRemoveTarget(s) }}>
                          <i className="ti ti-trash" />
                          <span>彻底移除</span>
                        </button>
                      </div>
                    )}
                  </div>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {addOpen && (
        <div className="modal-overlay" onClick={() => setAddOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">添加子模块</div>
            <div className="modal-body">
              <p className="settings-row-desc" style={{ marginBottom: 8 }}>
                等同 <code>git submodule add &lt;url&gt; &lt;path&gt;</code>。
              </p>
              <input
                className="settings-input"
                placeholder="子模块仓库 URL"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
                autoFocus
              />
              <input
                className="settings-input"
                placeholder="检出到的相对路径（如 vendor/foo）"
                value={newPath}
                onChange={e => setNewPath(e.target.value)}
                style={{ marginTop: 8 }}
              />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setAddOpen(false)}>取消</button>
              <button
                className="btn-primary"
                disabled={!newUrl.trim() || !newPath.trim()}
                onClick={handleAdd}
              >
                <i className="ti ti-plus" />
                添加
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="modal-overlay" onClick={() => setRemoveTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title">彻底移除子模块 {removeTarget.path}？</div>
            <div className="modal-body">
              <p className="modal-warn">
                <i className="ti ti-alert-triangle" />
                会执行 deinit → <code>git rm</code> → 清理 <code>.git/modules/{removeTarget.name}</code>，
                子模块工作区下的所有内容都会丢。需要 commit 后才会真正生效。
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setRemoveTarget(null)}>取消</button>
              <button
                className="btn-danger"
                onClick={async () => {
                  const name = removeTarget.name
                  setRemoveTarget(null)
                  try { await removeSubmodule(name); await refresh() }
                  catch (e) { showToast(String(e), 'error') }
                }}
              >
                <i className="ti ti-trash" />
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
