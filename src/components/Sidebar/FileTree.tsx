import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'

/** When the file list crosses this size, default every folder to collapsed.
 *  Otherwise an N-thousand file fresh-`git init` like loom would render every
 *  row on first paint and freeze the sub-repo switch. */
const AUTO_COLLAPSE_THRESHOLD = 500

// Indent applied per nesting depth. Keep small — sidebar is narrow and we
// have file action buttons on the right that need room.
const DEPTH_PX = 12

type FolderNode<T> = {
  kind: 'folder'
  name: string
  /** Full path from repo root, slash-joined. Used as a stable React key + as
   *  the closed-set identifier. */
  path: string
  children: TreeNode<T>[]
  /** True iff this folder was reported as an *untracked empty directory*
   *  (no files anywhere inside, not in .gitignore). Rendered with the red
   *  N badge + a hint that git won't include it until something lands. */
  untrackedEmpty?: boolean
}

type FileNode<T> = {
  kind: 'file'
  name: string
  path: string
  file: T
}

type TreeNode<T> = FolderNode<T> | FileNode<T>

/**
 * Build a folder tree from a flat list of files. Algorithm: walk each path's
 * segments, creating folder nodes on demand, and place the file at the leaf.
 * Sorted output: folders before files at each level, alphabetical within.
 */
export function buildFileTree<T extends { path: string }>(
  files: T[],
  /** Additional folder paths to surface as untracked-empty folder leaves
   *  in the tree. Each entry should be a path relative to the repo root.
   *  Any ancestor folders are auto-created. If a path already exists as
   *  a regular folder (because it actually contains files), the flag is
   *  NOT applied — that folder isn't really empty. */
  untrackedEmptyDirs: string[] = [],
): TreeNode<T>[] {
  // Intermediate representation using Map for O(1) child lookup while building.
  type Building<U> =
    | { kind: 'folder'; name: string; path: string; children: Map<string, Building<U>>; untrackedEmpty?: boolean }
    | { kind: 'file'; name: string; path: string; file: U }

  const root: Building<T> = {
    kind: 'folder',
    name: '',
    path: '',
    children: new Map(),
  }

  for (const f of files) {
    // filter(s => s.trim().length > 0) catches BOTH empty strings (from
    // double slashes `//`, leading `/`, trailing `/`) AND whitespace-only
    // segments (a tab/space-named folder, which would otherwise render as
    // a row that visually has no label). The file's full path on the leaf
    // is preserved, so stage / discard / diff still hit the right path.
    const parts = f.path.split('/').filter((s) => s.trim().length > 0)
    if (parts.length === 0) continue
    let cursor: Building<T> = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (cursor.kind !== 'folder') break // shouldn't happen — implies path collision
      const segment = parts[i]
      const existing = cursor.children.get(segment)
      if (!existing || existing.kind !== 'folder') {
        const node: Building<T> = {
          kind: 'folder',
          name: segment,
          path: parts.slice(0, i + 1).join('/'),
          children: new Map(),
        }
        cursor.children.set(segment, node)
        cursor = node
      } else {
        cursor = existing
      }
    }
    const leafName = parts[parts.length - 1]
    if (cursor.kind === 'folder') {
      cursor.children.set(leafName, {
        kind: 'file',
        name: leafName,
        path: f.path,
        file: f,
      })
    }
  }

  // After all files are placed, splice in the empty untracked dirs. We
  // walk each segment the same way as the file pass, creating folder
  // nodes if missing, and mark the LEAF folder with untrackedEmpty=true.
  // Note we only set the flag when the folder has no children: a dir
  // that already has real files inside isn't actually empty (this can
  // happen if the user races a `mkdir foo && touch foo/x` between the
  // file scan and the empty-dir scan).
  for (const raw of untrackedEmptyDirs) {
    const parts = raw.split('/').filter((s) => s.trim().length > 0)
    if (parts.length === 0) continue
    let cursor: Building<T> = root
    for (let i = 0; i < parts.length; i++) {
      if (cursor.kind !== 'folder') break
      const segment = parts[i]
      const existing = cursor.children.get(segment)
      if (existing && existing.kind === 'folder') {
        cursor = existing
        continue
      }
      const node: Building<T> = {
        kind: 'folder',
        name: segment,
        path: parts.slice(0, i + 1).join('/'),
        children: new Map(),
      }
      cursor.children.set(segment, node)
      cursor = node
    }
    if (cursor.kind === 'folder' && cursor.children.size === 0) {
      cursor.untrackedEmpty = true
    }
  }

  // Convert the Map-based tree into arrays, sorted folders-first / alpha.
  const finalize = (node: Building<T>): TreeNode<T> => {
    if (node.kind === 'file') {
      return { kind: 'file', name: node.name, path: node.path, file: node.file }
    }
    const children = Array.from(node.children.values()).map(finalize)
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return { kind: 'folder', name: node.name, path: node.path, children, untrackedEmpty: node.untrackedEmpty }
  }

  const finalized = finalize(root)
  return finalized.kind === 'folder' ? finalized.children : []
}

/**
 * Tree renderer. Caller supplies how to render a file leaf — that way the
 * same component renders staged rows (badge + unstage button) and unstaged
 * rows (badge + stage / discard / move / drag handle).
 *
 * Closed-folder state is hoisted to FileTree so a working-tree refresh
 * (which rebuilds the input `files` array) doesn't lose the user's
 * collapse choices. We track CLOSED rather than OPEN so brand-new folders
 * default to expanded — matching the flat-list "everything visible" feel.
 *
 * Optional folder drag: when `onFolderDragStart` is supplied, folder rows
 * become `draggable={true}` and call back with every descendant file's
 * path. Caller (UnstagedGroups) uses that list to move the whole subtree
 * into the drop-target group. Pass `undefined` to disable (e.g. for the
 * staged section, which has no group-move semantics).
 */
export function FileTree<T extends { path: string }>({
  files,
  renderFile,
  onFolderDragStart,
  onFolderDragEnd,
  isFolderDraggingPath,
  resetKey,
  untrackedEmptyDirs,
  onAddGitkeep,
  onRemoveEmptyDir,
  onFolderStage,
  onFolderDiscard,
}: {
  files: T[]
  renderFile: (file: T) => ReactNode
  onFolderDragStart?: (paths: string[], e: DragEvent<HTMLDivElement>) => void
  onFolderDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  /** Folder path currently being dragged — used to fade its row. */
  isFolderDraggingPath?: string | null
  /** Identity for the "set of files we're viewing" — typically the repo path.
   *  When it changes we recompute the initial collapse state, so switching
   *  from a small repo to a huge one auto-collapses (and vice versa). Without
   *  this, the `closed` Set carried over from the previous repo would either
   *  hide everything in the new repo or leave a 10k-file tree fully expanded. */
  resetKey?: string
  /** Optional: paths of untracked empty directories that should be
   *  surfaced as folder leaves with the red N badge. */
  untrackedEmptyDirs?: string[]
  /** Click handler for the "+" action on an empty-untracked folder
   *  row. Wired by UnstagedGroups to drop a .gitkeep into `dirPath`
   *  so git starts tracking the folder. */
  onAddGitkeep?: (dirPath: string) => void
  /** Click handler for the trash action — removes the empty folder
   *  from disk via Rust. */
  onRemoveEmptyDir?: (dirPath: string) => void
  /** Stage every descendant file under a regular (non-empty) folder.
   *  Receives the bag of all file paths inside that folder so the
   *  caller can batch / iterate as it sees fit. */
  onFolderStage?: (paths: string[]) => void
  /** Discard every change under a regular folder. Caller is expected
   *  to confirm before applying — it's destructive. */
  onFolderDiscard?: (paths: string[]) => void
}) {
  const tree = useMemo(
    () => buildFileTree(files, untrackedEmptyDirs ?? []),
    // The array reference matters but the contents drive the build; join
    // to a stable string so a same-content remount doesn't rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [files, (untrackedEmptyDirs ?? []).join('|')],
  )
  const [closed, setClosed] = useState<Set<string>>(() =>
    files.length > AUTO_COLLAPSE_THRESHOLD ? collectFolderPaths(tree) : new Set(),
  )
  // Reset collapse state when the underlying repo changes (sub-repo switch,
  // workspace tab switch). File-watcher refreshes don't change `resetKey`, so
  // a user's expansion choices survive saves and pulls.
  const prevResetKey = useRef(resetKey)
  useEffect(() => {
    if (prevResetKey.current === resetKey) return
    prevResetKey.current = resetKey
    setClosed(files.length > AUTO_COLLAPSE_THRESHOLD ? collectFolderPaths(tree) : new Set())
  }, [resetKey, files, tree])

  const toggle = (path: string) => {
    setClosed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <>
      {tree.map((node) => (
        <TreeRow
          key={node.path}
          node={node}
          depth={0}
          closed={closed}
          onToggle={toggle}
          renderFile={renderFile}
          onFolderDragStart={onFolderDragStart}
          onFolderDragEnd={onFolderDragEnd}
          isFolderDraggingPath={isFolderDraggingPath ?? null}
          onAddGitkeep={onAddGitkeep}
          onRemoveEmptyDir={onRemoveEmptyDir}
          onFolderStage={onFolderStage}
          onFolderDiscard={onFolderDiscard}
        />
      ))}
    </>
  )
}

function TreeRow<T extends { path: string }>({
  node,
  depth,
  closed,
  onToggle,
  renderFile,
  onFolderDragStart,
  onFolderDragEnd,
  isFolderDraggingPath,
  onAddGitkeep,
  onRemoveEmptyDir,
  onFolderStage,
  onFolderDiscard,
}: {
  node: TreeNode<T>
  depth: number
  closed: Set<string>
  onToggle: (path: string) => void
  renderFile: (file: T) => ReactNode
  onFolderDragStart?: (paths: string[], e: DragEvent<HTMLDivElement>) => void
  onFolderDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  onAddGitkeep?: (dirPath: string) => void
  onRemoveEmptyDir?: (dirPath: string) => void
  onFolderStage?: (paths: string[]) => void
  onFolderDiscard?: (paths: string[]) => void
  isFolderDraggingPath: string | null
}) {
  if (node.kind === 'file') {
    return (
      <div style={{ paddingLeft: depth * DEPTH_PX }}>{renderFile(node.file)}</div>
    )
  }
  const isClosed = closed.has(node.path)
  const fileCount = countFiles(node)
  const dragEnabled = !!onFolderDragStart && !node.untrackedEmpty
  const isBeingDragged = isFolderDraggingPath === node.path
  return (
    <>
      <div
        className={`tree-folder${node.untrackedEmpty ? ' tree-folder-empty-untracked' : ''}`}
        // Empty untracked folders don't expand (no children) and don't
        // accept drag-to-move (nothing to move). Click is a no-op so we
        // can wire a future "+ .gitkeep" affordance later.
        onClick={() => { if (!node.untrackedEmpty) onToggle(node.path) }}
        draggable={dragEnabled}
        onDragStart={(e) => {
          if (!onFolderDragStart) return
          // Collect every descendant file path. Folder = bag-of-files.
          const paths: string[] = []
          collectFilePaths(node, paths)
          if (paths.length === 0) return
          // Necessary for some browsers (WebKit) to actually start a drag.
          e.dataTransfer.setData('text/plain', node.path)
          e.dataTransfer.effectAllowed = 'move'
          onFolderDragStart(paths, e)
        }}
        onDragEnd={(e) => {
          onFolderDragEnd?.(e)
        }}
        title={node.untrackedEmpty
          ? 'Untracked empty folder — git won\'t commit it until something is inside.'
          : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          // Anchor for the absolutely-positioned `.file-actions` group
          // (buttons float over the row's right edge so they don't pad
          // the row tall when invisible).
          position: 'relative',
          gap: 8,
          // Vertical rhythm: 4px (was 5 → 2 → 4). 5 felt card-like in
          // long lists, 2 was too crammed; 4 gives a clear gap between
          // rows while keeping density close to VS Code's file tree.
          padding: '4px 6px',
          paddingLeft: depth * DEPTH_PX + 6,
          // Hold the row to a single text-line height so the chevron /
          // folder glyph's intrinsic line-height (~1.2) can't push the
          // row taller than the actual content needs.
          lineHeight: 1.4,
          cursor: node.untrackedEmpty ? 'default' : (dragEnabled ? 'grab' : 'pointer'),
          fontSize: 13,
          color: 'var(--text2, #666)',
          userSelect: 'none',
          opacity: isBeingDragged ? 0.4 : 1,
        }}
      >
        {/* Slot 1 — fixed 16px width matches the file row's status-badge
             slot, so badges and chevrons sit in the same x-column across
             both folders and files. */}
        <span style={{ width: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {node.untrackedEmpty ? (
            <span className="fbadge status-untracked" title="Untracked">N</span>
          ) : (
            <i
              className={`ti ${isClosed ? 'ti-chevron-right' : 'ti-chevron-down'}`}
              style={{ fontSize: 12 }}
            />
          )}
        </span>
        {/* Slot 2 — folder icon. Tabler doesn't ship a `ti-folder-dashed`,
             so for the untracked-empty case we inline a small SVG with
             a dashed stroke to convey "tentative / not committed yet"
             without clashing with the regular folder glyph used for
             everything else. */}
        {node.untrackedEmpty ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2"
               strokeLinecap="round" strokeLinejoin="round"
               strokeDasharray="3 2"
               style={{ opacity: 0.55, flexShrink: 0 }}
               aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2 -2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2H5a2 2 0 0 1 -2 -2V7z" />
          </svg>
        ) : (
          <i
            className={`ti ${isClosed ? 'ti-folder' : 'ti-folder-open'}`}
            style={{ fontSize: 13, opacity: 0.75 }}
          />
        )}
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {/* Belt-and-braces: if a name still sneaks through as empty or
              whitespace-only, fall back to the path's last segment so the
              row never renders truly blank. */}
          {node.name.trim() || node.path.split('/').filter(Boolean).pop() || '(unnamed)'}
        </span>
        {node.untrackedEmpty ? (
          // Hover actions mirror the file row: + (start tracking via
          // .gitkeep) and trash (delete the empty folder). Stop the
          // click bubbling so it doesn't toggle the folder (it doesn't
          // toggle anyway, but a precaution for future changes).
          <div className="file-actions">
            <button
              type="button"
              className="file-action-btn"
              title="Track this folder (adds a .gitkeep)"
              onClick={(e) => { e.stopPropagation(); onAddGitkeep?.(node.path) }}
            >
              <i className="ti ti-plus" />
            </button>
            <button
              type="button"
              className="file-action-btn danger"
              title="Delete this empty folder"
              onClick={(e) => { e.stopPropagation(); onRemoveEmptyDir?.(node.path) }}
            >
              <i className="ti ti-trash" />
            </button>
          </div>
        ) : (onFolderStage || onFolderDiscard) ? (
          // Regular folder (has children). Hover shows the same +/↺
          // actions as a file row, but here they apply to every
          // descendant in one shot — "stage all in this folder",
          // "discard all changes in this folder". File count moves to
          // a small chip OUTSIDE the action group so the count is still
          // visible at rest and only the buttons fade in on hover.
          <>
            <span className="tree-folder-count">{fileCount}</span>
            <div className="file-actions">
              {onFolderStage && (
                <button
                  type="button"
                  className="file-action-btn"
                  title="Stage all files in this folder"
                  onClick={(e) => {
                    e.stopPropagation()
                    const paths: string[] = []
                    collectFilePaths(node, paths)
                    if (paths.length) onFolderStage(paths)
                  }}
                >
                  <i className="ti ti-plus" />
                </button>
              )}
              {onFolderDiscard && (
                <button
                  type="button"
                  className="file-action-btn danger"
                  title="Discard all changes in this folder"
                  onClick={(e) => {
                    e.stopPropagation()
                    const paths: string[] = []
                    collectFilePaths(node, paths)
                    if (paths.length) onFolderDiscard(paths)
                  }}
                >
                  <i className="ti ti-arrow-back-up" />
                </button>
              )}
            </div>
          </>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--text3, #999)' }}>{fileCount}</span>
        )}
      </div>
      {!isClosed &&
        node.children.map((c) => (
          <TreeRow
            key={c.path}
            node={c}
            depth={depth + 1}
            closed={closed}
            onToggle={onToggle}
            renderFile={renderFile}
            onFolderDragStart={onFolderDragStart}
            onFolderDragEnd={onFolderDragEnd}
            isFolderDraggingPath={isFolderDraggingPath}
            onAddGitkeep={onAddGitkeep}
            onRemoveEmptyDir={onRemoveEmptyDir}
            onFolderStage={onFolderStage}
            onFolderDiscard={onFolderDiscard}
          />
        ))}
    </>
  )
}

function countFiles<T>(node: TreeNode<T>): number {
  if (node.kind === 'file') return 1
  let n = 0
  for (const c of node.children) n += countFiles(c)
  return n
}

/** Flatten every folder path in the tree. Used to seed the "everything
 *  collapsed" state for huge file lists. */
function collectFolderPaths<T>(nodes: TreeNode<T>[]): Set<string> {
  const out = new Set<string>()
  const walk = (n: TreeNode<T>) => {
    if (n.kind === 'folder') {
      out.add(n.path)
      for (const c of n.children) walk(c)
    }
  }
  for (const n of nodes) walk(n)
  return out
}

function collectFilePaths<T extends { path: string }>(node: TreeNode<T>, out: string[]): void {
  if (node.kind === 'file') {
    out.push(node.path)
    return
  }
  for (const c of node.children) collectFilePaths(c, out)
}
