// AI Agent configurations. Each entry describes how to invoke one CLI
// (Claude Code, Codex, custom) as the "shell" of a Versa terminal tab.
// Lives in localStorage, global to the user (not per-repo).
//
// Execution model: when the user clicks "+ <agent name>" on the terminal
// tab strip, Versa spawns a fresh PTY with `command` as the binary and
// `extraArgs` as additional argv entries. The agent's own REPL handles
// the prompt-driven UX — no shell wrapper, no quoting, no chat panel.

import { create } from 'zustand'

export interface AgentConfig {
  /** Stable id; referenced by tab metadata + auto-changelist linkage. */
  id: string
  /** Display label on the new-tab button + tab title. */
  name: string
  /** Binary in $PATH or absolute path (e.g. "claude", "codex", "/usr/local/bin/aider"). */
  command: string
  /** Whitespace-separated extra args passed verbatim to the binary on launch.
   *  Most users leave this empty — the bare binary launches into its
   *  interactive REPL/TUI. Example use: `--model haiku` or `--continue`. */
  extraArgs: string
  /** True for the seeded entries below. Built-ins can be edited (so users
   *  can tweak the command path or args) but not deleted — there's a
   *  Reset button instead. */
  builtin: boolean
}

const STORAGE_KEY = 'versa:agents'

/** Sentinel ids so we can find / reset specific built-ins later. */
const BUILTIN_CLAUDE = 'builtin:claude'
const BUILTIN_CODEX = 'builtin:codex'

const DEFAULTS: AgentConfig[] = [
  {
    id: BUILTIN_CLAUDE,
    name: 'Claude',
    command: 'claude',
    extraArgs: '',
    builtin: true,
  },
  {
    id: BUILTIN_CODEX,
    name: 'Codex',
    command: 'codex',
    extraArgs: '',
    builtin: true,
  },
]

interface AgentStore {
  agents: AgentConfig[]
  /** Load from localStorage; seed defaults on first launch. */
  load: () => void
  add: (cfg: Omit<AgentConfig, 'id' | 'builtin'>) => string
  update: (id: string, patch: Partial<AgentConfig>) => void
  remove: (id: string) => void
  /** Restore a built-in entry to its factory definition. No-op for custom ones. */
  resetBuiltin: (id: string) => void
}

function load(): AgentConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...DEFAULTS]
    const parsed = JSON.parse(raw) as AgentConfig[]
    // Make sure built-ins are present even if the user previously had a
    // pre-seeded version of the store missing one of them.
    const byId = new Map(parsed.map((a) => [a.id, a]))
    for (const def of DEFAULTS) {
      if (!byId.has(def.id)) parsed.push({ ...def })
    }
    return parsed
  } catch {
    return [...DEFAULTS]
  }
}

function save(agents: AgentConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agents))
  } catch {
    // Quota / private mode — silently swallow.
  }
}

function newId(): string {
  return `agent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: load(),

  load: () => set({ agents: load() }),

  add: (cfg) => {
    const id = newId()
    const next: AgentConfig = { id, builtin: false, ...cfg }
    const agents = [...get().agents, next]
    save(agents)
    set({ agents })
    return id
  },

  update: (id, patch) => {
    const agents = get().agents.map((a) => (a.id === id ? { ...a, ...patch, id, builtin: a.builtin } : a))
    save(agents)
    set({ agents })
  },

  remove: (id) => {
    const a = get().agents.find((x) => x.id === id)
    if (!a || a.builtin) return // built-ins are non-deletable; user can reset instead
    const agents = get().agents.filter((x) => x.id !== id)
    save(agents)
    set({ agents })
  },

  resetBuiltin: (id) => {
    const def = DEFAULTS.find((d) => d.id === id)
    if (!def) return
    const agents = get().agents.map((a) => (a.id === id ? { ...def } : a))
    save(agents)
    set({ agents })
  },
}))

/** Parse the user's `extraArgs` string into a Vec<String>-ready argv array.
 *  No shell quoting — whitespace separates tokens, that's it. */
export function parseAgentArgs(extraArgs: string): string[] {
  return extraArgs.split(/\s+/).filter((tok) => tok.length > 0)
}
