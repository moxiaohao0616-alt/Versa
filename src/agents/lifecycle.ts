// Glue between terminal-tab lifecycle and the changelist system.
//
// When an agent's child process exits (PTY closes), this module:
//   1. Refreshes the repo to catch any final file writes the watcher might
//      still have queued.
//   2. Diffs the current unstaged paths against the snapshot taken when the
//      tab was opened.
//   3. If anything new appeared, creates a "<agent name> @ HH:MM" changelist
//      and moves the new paths into it. The user can review + commit when
//      they're ready; the active commit target stays where it was, per the
//      "parking lot" semantics for changelists.

import { useStore, type TermSession } from '../store'
import { useChangelistStore } from '../lib/changelists'

export async function promoteAgentExitToChangelist(session: TermSession): Promise<void> {
  // Defensive: only run for agent tabs that captured a snapshot.
  if (!session.agentId || !session.preUnstagedSnapshot) return
  if (session.changelistId) return // already promoted (idempotent)

  // The notify watcher fires `repo:changed` for the agent's writes, but a
  // bulk write can race the debounce. Force a refresh so we see everything.
  try {
    await useStore.getState().refreshRepo()
  } catch {
    return
  }
  const status = useStore.getState().repoStatus
  if (!status) return

  const before = new Set(session.preUnstagedSnapshot)
  const newPaths = status.files
    .filter((f) => f.unstagedStatus && !before.has(f.path))
    .map((f) => f.path)
  if (newPaths.length === 0) return

  const stamp = new Date().toTimeString().slice(0, 5) // HH:MM
  const label = `${session.title} @ ${stamp}`
  const cls = useChangelistStore.getState()
  const groupId = cls.createGroup(label)
  cls.moveFiles(newPaths, groupId)

  useStore.getState().markAgentChangelist(session.id, groupId)
}
