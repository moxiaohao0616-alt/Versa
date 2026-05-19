import { useMemo, useState, type DragEvent, type ReactNode } from 'react'

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
export function buildFileTree<T extends { path: string }>(files: T[]): TreeNode<T>[] {
  // Intermediate representation using Map for O(1) child lookup while building.
  type Building<U> =
    | { kind: 'folder'; name: string; path: string; children: Map<string, Building<U>> }
    | { kind: 'file'; name: string; path: string; file: U }

  const root: Building<T> = {
    kind: 'folder',
    name: '',
    path: '',
    children: new Map(),
  }

  for (const f of files) {
    const parts = f.path.split('/').filter(Boolean)
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
    return { kind: 'folder', name: node.name, path: node.path, children }
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
}: {
  files: T[]
  renderFile: (file: T) => ReactNode
  onFolderDragStart?: (paths: string[], e: DragEvent<HTMLDivElement>) => void
  onFolderDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  /** Folder path currently being dragged — used to fade its row. */
  isFolderDraggingPath?: string | null
}) {
  const tree = useMemo(() => buildFileTree(files), [files])
  const [closed, setClosed] = useState<Set<string>>(() => new Set())

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
}: {
  node: TreeNode<T>
  depth: number
  closed: Set<string>
  onToggle: (path: string) => void
  renderFile: (file: T) => ReactNode
  onFolderDragStart?: (paths: string[], e: DragEvent<HTMLDivElement>) => void
  onFolderDragEnd?: (e: DragEvent<HTMLDivElement>) => void
  isFolderDraggingPath: string | null
}) {
  if (node.kind === 'file') {
    return (
      <div style={{ paddingLeft: depth * DEPTH_PX }}>{renderFile(node.file)}</div>
    )
  }
  const isClosed = closed.has(node.path)
  const fileCount = countFiles(node)
  const dragEnabled = !!onFolderDragStart
  const isBeingDragged = isFolderDraggingPath === node.path
  return (
    <>
      <div
        className="tree-folder"
        onClick={() => onToggle(node.path)}
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
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 6px',
          paddingLeft: depth * DEPTH_PX + 6,
          cursor: dragEnabled ? 'grab' : 'pointer',
          fontSize: 13,
          color: 'var(--text2, #666)',
          userSelect: 'none',
          opacity: isBeingDragged ? 0.4 : 1,
        }}
      >
        <i
          className={`ti ${isClosed ? 'ti-chevron-right' : 'ti-chevron-down'}`}
          style={{ fontSize: 12, width: 12 }}
        />
        <i
          className={`ti ${isClosed ? 'ti-folder' : 'ti-folder-open'}`}
          style={{ fontSize: 13, opacity: 0.75 }}
        />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {node.name}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text3, #999)' }}>{fileCount}</span>
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

function collectFilePaths<T extends { path: string }>(node: TreeNode<T>, out: string[]): void {
  if (node.kind === 'file') {
    out.push(node.path)
    return
  }
  for (const c of node.children) collectFilePaths(c, out)
}
