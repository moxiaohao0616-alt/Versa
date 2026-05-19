// Changelists — per-repo groups of unstaged files. Inspired by JetBrains.
//
// Semantics:
//   * A `default` list always exists and cannot be deleted. Every newly
//     observed unstaged file lives here — *no* auto-assign-to-active. The
//     default is the "next commit" inbox.
//   * Custom lists are parking lots: things the user has *explicitly* moved
//     out of the default, presumably because they don't want them in this
//     commit. Deleting a custom list returns its files to default.
//   * Exactly one list is "active" at a time. Active means "this is the
//     group that gets committed when you click Save Progress." It does NOT
//     mean "new changes flow here." Defaults to `default`.
//   * Pure visual grouping over the existing unstaged area. The git index
//     (staging) is unaware — staging/unstaging works as before.
//
// Storage: localStorage keyed per repo path. Not synced via Versa Cloud yet —
// that would also need stable file-path identity across machines, which is
// non-trivial (paths differ; sync would need content hashes).

import { create } from 'zustand'
import { useStore } from '../store'

export const DEFAULT_GROUP_ID = 'default'

export interface Changelist {
  id: string
  name: string
}

interface RepoChangelistData {
  /** User-created groups. `default` is implicit and not stored here. */
  groups: Changelist[]
  /** Map of file path → group id. Missing entry == DEFAULT_GROUP_ID. */
  assignments: Record<string, string>
  /** Which group is "active" for new-file auto-assign. */
  activeId: string
}

interface ChangelistState {
  /** Path of the repo whose data is currently loaded. */
  repoPath: string | null
  groups: Changelist[]
  assignments: Record<string, string>
  activeId: string

  loadFor: (repoPath: string) => void
  unload: () => void

  createGroup: (name: string) => string
  renameGroup: (id: string, name: string) => void
  deleteGroup: (id: string) => void
  setActive: (id: string) => void
  moveFiles: (paths: string[], targetId: string) => void
}

function storageKey(repoPath: string): string {
  return `versa:changelists:${repoPath}`
}

function load(repoPath: string): RepoChangelistData {
  try {
    const raw = localStorage.getItem(storageKey(repoPath))
    if (!raw) return { groups: [], assignments: {}, activeId: DEFAULT_GROUP_ID }
    const parsed = JSON.parse(raw) as Partial<RepoChangelistData>
    return {
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      assignments: typeof parsed.assignments === 'object' && parsed.assignments
        ? parsed.assignments as Record<string, string>
        : {},
      activeId: typeof parsed.activeId === 'string' ? parsed.activeId : DEFAULT_GROUP_ID,
    }
  } catch {
    return { groups: [], assignments: {}, activeId: DEFAULT_GROUP_ID }
  }
}

function save(repoPath: string, data: RepoChangelistData): void {
  try {
    localStorage.setItem(storageKey(repoPath), JSON.stringify(data))
  } catch {
    // Quota / private mode — silently swallow. Worst case is loss of grouping
    // across reloads, which is a minor degradation, not a data-loss bug.
  }
}

/** Stable-ish ID for new groups. ULID-ish without the lib. */
function newId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `cl_${ts}${rand}`
}

export const useChangelistStore = create<ChangelistState>((set, get) => ({
  repoPath: null,
  groups: [],
  assignments: {},
  activeId: DEFAULT_GROUP_ID,

  loadFor: (repoPath) => {
    if (get().repoPath === repoPath) return
    const data = load(repoPath)
    // Make sure activeId still references a real group.
    const validActive =
      data.activeId === DEFAULT_GROUP_ID || data.groups.some((g) => g.id === data.activeId)
        ? data.activeId
        : DEFAULT_GROUP_ID
    set({
      repoPath,
      groups: data.groups,
      assignments: data.assignments,
      activeId: validActive,
    })
  },

  unload: () => {
    set({
      repoPath: null,
      groups: [],
      assignments: {},
      activeId: DEFAULT_GROUP_ID,
    })
  },

  createGroup: (name) => {
    const id = newId()
    const groups = [...get().groups, { id, name }]
    persistAfter(set, get, { groups })
    return id
  },

  renameGroup: (id, name) => {
    if (id === DEFAULT_GROUP_ID) return
    const groups = get().groups.map((g) => (g.id === id ? { ...g, name } : g))
    persistAfter(set, get, { groups })
  },

  deleteGroup: (id) => {
    if (id === DEFAULT_GROUP_ID) return
    const { groups, assignments, activeId } = get()
    const newGroups = groups.filter((g) => g.id !== id)
    // Send the removed group's files back to default.
    const newAssignments: Record<string, string> = {}
    for (const [path, gid] of Object.entries(assignments)) {
      if (gid !== id) newAssignments[path] = gid
    }
    const newActive = activeId === id ? DEFAULT_GROUP_ID : activeId
    persistAfter(set, get, {
      groups: newGroups,
      assignments: newAssignments,
      activeId: newActive,
    })
  },

  setActive: (id) => {
    const { groups } = get()
    if (id !== DEFAULT_GROUP_ID && !groups.some((g) => g.id === id)) return
    persistAfter(set, get, { activeId: id })
  },

  moveFiles: (paths, targetId) => {
    const { groups, assignments } = get()
    if (targetId !== DEFAULT_GROUP_ID && !groups.some((g) => g.id === targetId)) return
    const next = { ...assignments }
    for (const p of paths) {
      if (targetId === DEFAULT_GROUP_ID) {
        delete next[p]
      } else {
        next[p] = targetId
      }
    }
    persistAfter(set, get, { assignments: next })
  },
}))

function persistAfter(
  set: (partial: Partial<ChangelistState>) => void,
  get: () => ChangelistState,
  patch: Partial<RepoChangelistData>,
): void {
  const prev = get()
  const next = {
    groups: patch.groups ?? prev.groups,
    assignments: patch.assignments ?? prev.assignments,
    activeId: patch.activeId ?? prev.activeId,
  }
  set(patch)
  const repoPath = prev.repoPath
  if (repoPath) save(repoPath, next)
}

/** Set up the auto-load hook. Called once at app start. */
export function bootChangelistRunner(): void {
  // Load whenever the active repo changes. No auto-assignment logic — new
  // files land in the default group by virtue of having no assignment entry.
  let lastRepoPath: string | null = null
  useStore.subscribe((state) => {
    const path = state.repoPath ?? null
    if (path === lastRepoPath) return
    lastRepoPath = path
    const cs = useChangelistStore.getState()
    if (path) cs.loadFor(path)
    else cs.unload()
  })

  // Also handle initial state (subscribe doesn't fire for current value).
  const init = useStore.getState()
  if (init.repoPath) {
    useChangelistStore.getState().loadFor(init.repoPath)
  }
}

/** Helper for components: group files by their assigned changelist id. */
export function groupFilesByChangelist<T extends { path: string }>(
  files: T[],
  assignments: Record<string, string>,
): Map<string, T[]> {
  const out = new Map<string, T[]>()
  out.set(DEFAULT_GROUP_ID, [])
  for (const f of files) {
    const gid = assignments[f.path] ?? DEFAULT_GROUP_ID
    const list = out.get(gid) ?? []
    list.push(f)
    out.set(gid, list)
  }
  return out
}

/**
 * Return the active-group pathspec for the current commit, or null if no
 * filtering should happen (i.e. the user hasn't created any custom groups —
 * fall back to legacy commit-everything behavior).
 *
 *   null  → callers should commit via the legacy `save_progress[_signed]`
 *   []    → active group has no files; callers should show an empty-state
 *           error instead of committing
 *   [...] → commit only these paths via `save_progress_pathspec`
 */
export function getActivePathspec<T extends { path: string }>(allFiles: T[]): string[] | null {
  const cls = useChangelistStore.getState()
  if (cls.groups.length === 0) return null
  return allFiles
    .filter((f) => (cls.assignments[f.path] ?? DEFAULT_GROUP_ID) === cls.activeId)
    .map((f) => f.path)
}

/** Return the human-readable name of the currently active changelist. */
export function getActiveGroupName(defaultLabel: string): string {
  const cls = useChangelistStore.getState()
  if (cls.activeId === DEFAULT_GROUP_ID) return defaultLabel
  return cls.groups.find((g) => g.id === cls.activeId)?.name ?? defaultLabel
}
