import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { invoke } from '@tauri-apps/api/core'
import { useStore, type ChangedFile } from '../../store'
import {
  DEFAULT_GROUP_ID,
  useChangelistStore,
  groupFilesByChangelist,
  type Changelist,
} from '../../lib/changelists'
import { FileTree } from './FileTree'

interface Props {
  unstagedFiles: ChangedFile[]
  selectedFile: string | null
  selectedFileStaged: boolean
  treeMode: boolean
  /** Forwarded to FileTree as its resetKey — see FileTree comment. */
  resetKey?: string
  onSelect: (path: string) => void
  onStage: (path: string) => void
  onDiscard: (path: string) => void
}

/**
 * Replaces the original flat "未暂存" section with a grouped view. Default
 * group always renders first; user-created groups follow with their own
 * header carrying activate / delete actions.
 *
 * Rendering rule: only show groups that are non-empty, *except* the default
 * group always shows when there's any unstaged file (so the user always sees
 * the familiar list even before they create custom groups).
 */
// MIME type our drag operations use. Unique so a file being dragged from the
// system file manager / browser doesn't accidentally trip our drop handlers.
const DRAG_MIME = 'application/x-versa-file-path'

/** Past this count the flat list collapses to a notice — Sidebar already
 *  auto-flips to tree mode above this same threshold, so this only kicks in
 *  if the user explicitly disabled tree view AND has tons of files. */
const FLAT_RENDER_LIMIT = 500

export function UnstagedGroups({
  unstagedFiles,
  selectedFile,
  selectedFileStaged,
  treeMode,
  resetKey,
  onSelect,
  onStage,
  onDiscard,
}: Props) {
  const { t } = useTranslation()
  const { groups, assignments, activeId, createGroup, deleteGroup, setActive, moveFiles } =
    useChangelistStore()
  // Untracked empty dirs for the current repo — surfaced in the tree as
  // folder leaves with the red N badge so newly-created empty folders
  // (invisible to `git status`) still show up.
  const repoPath = useStore(s => s.repoPath)
  const emptyDirs = useStore(s =>
    repoPath ? (s.untrackedEmptyDirsByRepo[repoPath] ?? []) : []
  )
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  /** Which group is currently the drag-hover target. null = nothing hovered. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  /** Paths of every file currently in flight. Single file drag → 1 entry;
   *  folder drag → every descendant file's path. Used both to gate drop
   *  targets and to fade the dragged element(s). */
  const [draggingPaths, setDraggingPaths] = useState<string[] | null>(null)
  /** Folder path being dragged — for visual fade of the folder row itself. */
  const [draggingFolder, setDraggingFolder] = useState<string | null>(null)

  // Hide the whole section only when there's truly nothing to show. With
  // custom groups around (even empty ones) we must stay rendered so users can
  // drag files in / delete the group.
  if (unstagedFiles.length === 0 && groups.length === 0) return null

  const grouped = groupFilesByChangelist(unstagedFiles, assignments)

  // Render order: default first (even if empty when there are user groups —
  // gives the user somewhere to drag things back to), then user groups.
  const renderOrder: Array<Changelist & { isDefault: boolean }> = [
    { id: DEFAULT_GROUP_ID, name: t('sidebar.changelist_default'), isDefault: true },
    ...groups.map((g) => ({ ...g, isDefault: false })),
  ]

  // Single scrollable container around all groups. The Sidebar is a flex
  // column and each file-list in the legacy layout was its own `flex:1`
  // scroll area; multiple file-lists inside a wrapper would each ask for
  // `flex:1` of the wrapper instead of the Sidebar, so the wrapper itself
  // takes the remaining height and scrolls. min-height:0 is required for the
  // flex child to honor overflow rather than expand to content height.
  return (
    <div
      className="unstaged-groups-scroll"
      style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}
    >
      {renderOrder.map((g) => {
        const files = grouped.get(g.id) ?? []
        // Custom groups stay rendered even when empty so they remain
        // discoverable + deletable, and so the user can drag a file in.
        const isActive = g.id === activeId

        const isDropTarget = dropTargetId === g.id
        // Compute whether ALL files in flight are already in this group — if
        // so, dropping here would be a no-op so we suppress the visual hint.
        // For a single-file drag this collapses to the simple "same group?"
        // check; for a folder drag we consider it "from here" only when the
        // whole subtree already lives here.
        const draggingFromHere =
          draggingPaths != null &&
          draggingPaths.length > 0 &&
          draggingPaths.every((p) => (assignments[p] ?? DEFAULT_GROUP_ID) === g.id)

        return (
          <div
            key={g.id}
            style={{
              marginTop: g.isDefault ? 0 : 6,
              // Group-wide drop affordance: subtle blue tint + dashed border
              // so the user can drop anywhere in the section, not just on
              // the header.
              outline:
                isDropTarget && !draggingFromHere
                  ? '2px dashed var(--accent, #4a90e2)'
                  : 'none',
              outlineOffset: -2,
              background:
                isDropTarget && !draggingFromHere
                  ? 'rgba(80, 160, 255, 0.06)'
                  : undefined,
              borderRadius: 6,
              transition: 'background 0.1s',
            }}
            onDragOver={(e) => {
              // preventDefault is REQUIRED on dragover to mark the element as
              // a valid drop target. Without it, onDrop never fires.
              //
              // We can't check `e.dataTransfer.types` to gate this — WebKit
              // (Tauri's WKWebView on macOS) hides custom MIME types during
              // dragover for security reasons, so our `DRAG_MIME` would not
              // appear in `types` until drop fires. Instead we use the React
              // state `draggingPaths` set in onDragStart as the in-app signal
              // that there's a live drag we should accept.
              if (draggingPaths == null) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              if (dropTargetId !== g.id) setDropTargetId(g.id)
            }}
            onDragLeave={(e) => {
              // dragleave fires on every child boundary crossing; only clear
              // when the cursor actually leaves the group's bounding box.
              const related = e.relatedTarget as Node | null
              if (!related || !e.currentTarget.contains(related)) {
                if (dropTargetId === g.id) setDropTargetId(null)
              }
            }}
            onDrop={(e) => {
              e.preventDefault()
              // Prefer the React state set at onDragStart — it's always
              // available, whereas dataTransfer.getData may return empty if
              // the drag source set a MIME we don't recognize.
              const paths = draggingPaths ?? (() => {
                const single = e.dataTransfer.getData(DRAG_MIME)
                return single ? [single] : []
              })()
              setDropTargetId(null)
              setDraggingPaths(null)
              setDraggingFolder(null)
              if (paths.length === 0) return
              // Filter out paths that are already in this group so folder
              // drags that *partially* span the target still move the rest.
              const toMove = paths.filter(
                (p) => (assignments[p] ?? DEFAULT_GROUP_ID) !== g.id,
              )
              if (toMove.length === 0) return
              moveFiles(toMove, g.id)
            }}
          >
            <div
              className="section-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: isActive && !g.isDefault ? 'rgba(80, 160, 255, 0.08)' : undefined,
                borderRadius: 4,
                padding: '2px 4px',
              }}
            >
              {isActive && (
                <i
                  className="ti ti-star-filled"
                  style={{ color: 'var(--accent, #4a90e2)', fontSize: 12 }}
                  title={t('sidebar.changelist_active_tip')}
                />
              )}
              <span style={{ flex: 1 }}>
                {g.isDefault ? t('sidebar.unstaged') : g.name}
                {' · '}
                {files.length} {t('common.files_word')}
              </span>
              {!isActive && (
                <button
                  type="button"
                  className="file-action-btn"
                  title={t('sidebar.changelist_set_active')}
                  onClick={() => setActive(g.id)}
                  style={{ padding: '0 4px' }}
                >
                  <i className="ti ti-star" />
                </button>
              )}
              {g.isDefault ? (
                <button
                  type="button"
                  className="file-action-btn"
                  title={t('sidebar.changelist_new')}
                  onClick={() => {
                    setCreating(true)
                    setNewName('')
                  }}
                  style={{ padding: '0 4px' }}
                >
                  <i className="ti ti-plus" />
                </button>
              ) : (
                // Trash icon — always visible (not muted to invisibility) but
                // not red either; the global `.file-action-btn.danger:hover`
                // rule supplies a red tint on hover so the affordance is
                // clear without being visually loud at rest.
                <button
                  type="button"
                  className="file-action-btn danger"
                  title={t('sidebar.changelist_delete')}
                  onClick={() => {
                    if (confirm(t('sidebar.changelist_delete_confirm', { name: g.name }))) {
                      deleteGroup(g.id)
                    }
                  }}
                  style={{ padding: '0 4px' }}
                >
                  <i className="ti ti-trash" />
                </button>
              )}
            </div>

            {/* flex:none overrides the global `.file-list { flex:1 }` so each
                group's list takes its natural height inside the parent scroll
                container instead of fighting it. */}
            <div className="file-list" style={{ flex: 'none', overflow: 'visible' }}>
              {(() => {
                const renderRow = (f: ChangedFile) => (
                  <FileRow
                    key={`unstaged-${f.path}`}
                    file={f}
                    selected={selectedFile === f.path && !selectedFileStaged}
                    isDragging={draggingPaths?.includes(f.path) ?? false}
                    hidePath={treeMode}
                    currentGroupId={g.id}
                    groups={groups}
                    onSelect={() => onSelect(f.path)}
                    onStage={() => onStage(f.path)}
                    onDiscard={() => onDiscard(f.path)}
                    onMove={(target) => moveFiles([f.path], target)}
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_MIME, f.path)
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingPaths([f.path])
                    }}
                    onDragEnd={() => {
                      setDraggingPaths(null)
                      setDropTargetId(null)
                    }}
                  />
                )
                return treeMode ? (
                  <FileTree
                    // Remount on repo switch — and on "size class" transitions
                    // within the same repo — so the auto-collapse state is
                    // computed from the new files on the FIRST render.
                    //
                    // Without the size class in the key, the snapshot-blank
                    // path (empty files → fresh open_repo brings in N-thousand)
                    // would keep the FileTree instance: its `closed` Set stays
                    // empty (set when files=[]) and the first render explodes
                    // into N-thousand expanded rows before useEffect catches
                    // up. The user sees that frozen frame as "卡".
                    key={`${resetKey ?? g.id}-${files.length > 500 ? 'large' : 'small'}`}
                    files={files}
                    renderFile={renderRow}
                    resetKey={resetKey}
                    // Empty untracked dirs only belong in the default group —
                    // they're not user-categorized work, just newly-created
                    // folders git can't see. Custom changelists are about
                    // *files the user moved into them*; an empty dir has
                    // nothing to move.
                    untrackedEmptyDirs={g.isDefault ? emptyDirs : undefined}
                    onAddGitkeep={async (dirPath) => {
                      if (!repoPath) return
                      try {
                        await invoke('add_gitkeep', { path: repoPath, dir: dirPath })
                        // Watcher will refire — but force a refresh now so
                        // the user sees the change immediately rather than
                        // waiting for FSEvents debounce.
                        useStore.getState().refreshRepo()
                      } catch (e) {
                        useStore.getState().showToast(String(e), 'error')
                      }
                    }}
                    onRemoveEmptyDir={async (dirPath) => {
                      if (!repoPath) return
                      try {
                        await invoke('remove_empty_dir', { path: repoPath, dir: dirPath })
                        useStore.getState().refreshRepo()
                      } catch (e) {
                        useStore.getState().showToast(String(e), 'error')
                      }
                    }}
                    onFolderStage={(paths) => {
                      // Stage every descendant file. We iterate one-by-one
                      // through the existing single-file stage action so
                      // the changelist / per-file flow stays unchanged;
                      // batching to a single `git add a b c …` call is a
                      // future optimization if this gets slow.
                      paths.forEach(onStage)
                    }}
                    onFolderDiscard={async (paths) => {
                      const n = paths.length
                      if (!confirm(t('sidebar.discard_folder_confirm', {
                        count: n,
                        defaultValue: 'Discard changes in {{count}} file(s)? This cannot be undone.',
                      }))) return
                      if (!repoPath) return
                      // Hit the Rust `discard_file` command directly for
                      // every path, skipping the per-file modal flow
                      // (which is single-target and would set/overwrite
                      // its state N times, ending up as a one-file
                      // prompt — that was the bug). Refresh once at the
                      // end instead of after every file.
                      try {
                        for (const p of paths) {
                          await invoke('discard_file', { path: repoPath, file: p })
                        }
                        await useStore.getState().refreshRepo()
                      } catch (e) {
                        useStore.getState().showToast(String(e), 'error')
                      }
                    }}
                    isFolderDraggingPath={draggingFolder}
                    onFolderDragStart={(paths, e) => {
                      // Folder drag = move every descendant file together.
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingPaths(paths)
                      // Use the folder path as the visual key for fading
                      // (the folder row reads this and dims itself).
                      const folderPath = paths[0].split('/').slice(0, -1).join('/')
                      setDraggingFolder(folderPath)
                    }}
                    onFolderDragEnd={() => {
                      setDraggingPaths(null)
                      setDraggingFolder(null)
                      setDropTargetId(null)
                    }}
                  />
                ) : files.length > FLAT_RENDER_LIMIT ? (
                  // Flat mode collapses to a notice when the list is huge —
                  // rendering N-thousand interactive rows freezes the
                  // sub-repo switch. The notice nudges the user toward tree
                  // view where folding keeps it fast.
                  <p
                    style={{
                      margin: '8px',
                      fontSize: 12,
                      color: 'var(--text-muted, #888)',
                      fontStyle: 'italic',
                    }}
                  >
                    {t('sidebar.flat_too_many', { count: files.length })}
                  </p>
                ) : (
                  files.map(renderRow)
                )
              })()}
              {files.length === 0 && !(g.isDefault && emptyDirs.length > 0) && (
                <p
                  style={{
                    margin: '4px 8px',
                    fontSize: 12,
                    color: 'var(--text-muted, #888)',
                    fontStyle: 'italic',
                  }}
                >
                  {g.isDefault
                    ? t('sidebar.changelist_default_empty')
                    : t('sidebar.changelist_custom_empty')}
                </p>
              )}
            </div>
          </div>
        )
      })}

      {creating && (
        <NewGroupInline
          value={newName}
          onChange={setNewName}
          onCommit={() => {
            const trimmed = newName.trim()
            if (trimmed) {
              // Intentionally NOT calling setActive — a freshly created group
              // is an empty parking lot, not the commit target. Auto-flipping
              // active here would imply "next Save Progress commits this new
              // empty group" which is the opposite of what the user wants.
              // They'll explicitly set active via the ☆ button when needed.
              createGroup(trimmed)
            }
            setCreating(false)
            setNewName('')
          }}
          onCancel={() => {
            setCreating(false)
            setNewName('')
          }}
        />
      )}
    </div>
  )
}

// ─── File row with a "move-to" menu ──────────────────────────────────────────

function FileRow({
  file,
  selected,
  isDragging,
  hidePath,
  currentGroupId,
  groups,
  onSelect,
  onStage,
  onDiscard,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  file: ChangedFile
  selected: boolean
  isDragging: boolean
  hidePath: boolean
  currentGroupId: string
  groups: Changelist[]
  onSelect: () => void
  onStage: () => void
  onDiscard: () => void
  onMove: (targetGroupId: string) => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Click-outside closes the popover.
  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  // Build the destination list: every group except the one this file is in.
  const destinations: Array<{ id: string; label: string }> = []
  if (currentGroupId !== DEFAULT_GROUP_ID) {
    destinations.push({ id: DEFAULT_GROUP_ID, label: t('sidebar.changelist_default') })
  }
  for (const g of groups) {
    if (g.id !== currentGroupId) destinations.push({ id: g.id, label: g.name })
  }

  return (
    <div
      className={`file-item ${selected ? 'selected' : ''}`}
      // WKWebView (Tauri on macOS) sometimes drops `click` events on a
      // draggable element when the trackpad registers any micro-movement
      // during the press — the browser preemptively starts a drag and the
      // resulting click never fires. mousedown fires regardless, so we
      // route file-selection through it instead. Action buttons stop
      // propagation themselves, but `e.target.closest('button')` is the
      // belt: a press that started inside an action button must not also
      // change the file selection.
      onMouseDown={(e) => {
        if (e.button !== 0) return
        if ((e.target as Element).closest('button')) return
        onSelect()
      }}
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      style={{
        position: 'relative',
        // Fade the row while it's being dragged so the user has clear feedback
        // about which file is in flight. The browser still renders the
        // dragging ghost separately.
        opacity: isDragging ? 0.4 : 1,
        cursor: 'grab',
        // Prevent the row's text from entering a "selection drag" mode
        // that conflicts with our HTML5 drag handling — same root cause as
        // the click-eating quirk above.
        userSelect: 'none',
      }}
    >
      {file.unstagedStatus === '?' ? (
        <span className="fbadge status-untracked" title={t('sidebar.untracked')}>N</span>
      ) : (
        <span className={`fbadge status-${file.unstagedStatus}`}>{file.unstagedStatus}</span>
      )}
      <div className="file-info">
        <span className="file-name">{file.path.split('/').pop()}</span>
        {!hidePath && (
          <span className="file-path">{file.path.split('/').slice(0, -1).join('/')}</span>
        )}
      </div>
      <div className="file-actions" ref={ref}>
        {destinations.length > 0 && (
          <button
            type="button"
            className="file-action-btn"
            title={t('sidebar.changelist_move')}
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen((v) => !v)
            }}
          >
            <i className="ti ti-arrows-shuffle" />
          </button>
        )}
        <button
          type="button"
          className="file-action-btn"
          title={t('sidebar.stage')}
          onClick={(e) => {
            e.stopPropagation()
            onStage()
          }}
        >
          <i className="ti ti-plus" />
        </button>
        {file.unstagedStatus !== '?' && (
          <button
            type="button"
            className="file-action-btn danger"
            title={t('sidebar.discard')}
            onClick={(e) => {
              e.stopPropagation()
              onDiscard()
            }}
          >
            <i className="ti ti-arrow-back-up" />
          </button>
        )}

        {menuOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: 'var(--surface, white)',
              border: '1px solid var(--border, #ddd)',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
              padding: 4,
              zIndex: 50,
              minWidth: 180,
            }}
          >
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted, #888)',
                padding: '4px 8px',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
              }}
            >
              {t('sidebar.changelist_move_to')}
            </div>
            {destinations.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  onMove(d.id)
                  setMenuOpen(false)
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '6px 8px',
                  background: 'transparent',
                  border: 0,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Inline "new group" input ────────────────────────────────────────────────

function NewGroupInline({
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const ref = useRef<HTMLInputElement>(null)
  // Track IME composition: a Chinese/Japanese/Korean user pressing Enter to
  // confirm pinyin/IME selection fires keydown(Enter) but ALSO ends with a
  // compositionend event. We don't want that first Enter to submit the form.
  const composingRef = useRef(false)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  return (
    // <form onSubmit> is the rock-solid way to handle Enter-to-submit on an
    // input. Browsers fire submit only after IME composition has ended, so
    // Chinese / Japanese users won't accidentally submit while still picking
    // a character. The Confirm button is `type="submit"` to keep the path
    // consistent (click and Enter both go through onSubmit).
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!composingRef.current) onCommit()
      }}
      style={{ padding: '6px 8px', display: 'flex', gap: 6 }}
    >
      <input
        ref={ref}
        type="text"
        placeholder={t('sidebar.changelist_name_placeholder')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={() => {
          composingRef.current = false
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          }
        }}
        style={{
          flex: 1,
          padding: '4px 8px',
          fontSize: 13,
          border: '1px solid var(--border, #ddd)',
          borderRadius: 4,
        }}
      />
      <button type="submit" className="file-action-btn" title={t('common.apply')}>
        <i className="ti ti-check" />
      </button>
      <button
        type="button"
        className="file-action-btn"
        onClick={onCancel}
        title={t('common.cancel')}
      >
        <i className="ti ti-x" />
      </button>
    </form>
  )
}
