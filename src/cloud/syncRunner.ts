// Cloud Sync runner. Subscribes to the main Zustand store, debounces writes,
// and runs a periodic reconcile. Booted exactly once from main.tsx; all
// subsequent state changes flow through the same listener so we never
// double-schedule.
//
// MVP scope: syncs `theme` only. Adding more whitelisted fields is one line
// at the top — see SYNCED.

import { useStore } from '../store'
import { useCloudStore } from './store'
import { cloudClient } from './client'
import type { SyncNamespace } from './types'

/** Whitelisted store keys, per cloud namespace. Add new keys here only after
 *  confirming they (a) don't include secrets and (b) have a setter that the
 *  remote-apply step below can call. Namespaces not listed here are simply
 *  ignored — no need to declare empty entries. */
const SYNCED: Partial<Record<SyncNamespace, readonly string[]>> = {
  settings: ['theme'],
}

const PUSH_DEBOUNCE_MS = 5000
const PULL_INTERVAL_MS = 5 * 60 * 1000

/** Server version we last saw for each `ns:key`. CAS writes use this. */
const baseVersions = new Map<string, number>()
/** Keys waiting to be pushed at next flush. */
const dirty = new Set<string>()
/** Guard set while applying a pulled value so the subscribe handler doesn't
 *  immediately mark the same key dirty and bounce it back to the server. */
let applyingRemote = false

let pushTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setInterval> | null = null
let booted = false

function isProSignedIn(): boolean {
  const c = useCloudStore.getState()
  return c.signedIn && c.subscription?.plan === 'pro'
}

function fk(ns: SyncNamespace, key: string): string {
  return `${ns}:${key}`
}

function readValue(ns: SyncNamespace, key: string): unknown {
  const s = useStore.getState() as unknown as Record<string, unknown>
  if (ns === 'settings') return s[key]
  return null
}

function applyValue(ns: SyncNamespace, key: string, value: unknown): void {
  applyingRemote = true
  try {
    const s = useStore.getState() as unknown as Record<string, unknown> & {
      setTheme?: (t: 'light' | 'dark' | 'system') => void
    }
    if (ns === 'settings' && key === 'theme' && typeof value === 'string') {
      const t = value as 'light' | 'dark' | 'system'
      if (t === 'light' || t === 'dark' || t === 'system') {
        s.setTheme?.(t)
      }
    }
  } finally {
    // Release on the next microtask so the inline set()->subscribe path is
    // covered (Zustand notifies synchronously).
    queueMicrotask(() => {
      applyingRemote = false
    })
  }
}

async function pushDirty(): Promise<void> {
  if (!isProSignedIn()) return
  const keys = Array.from(dirty)
  dirty.clear()
  for (const fullKey of keys) {
    const [ns, key] = fullKey.split(':') as [SyncNamespace, string]
    const value = readValue(ns, key)
    const base = baseVersions.get(fullKey) ?? 0
    try {
      const r = await cloudClient.syncPush({
        namespace: ns,
        key,
        value,
        baseVersion: base,
      })
      baseVersions.set(fullKey, r.version)
    } catch (e) {
      const msg = String(e).toLowerCase()
      if (msg.includes('conflict') || msg.includes('409')) {
        // Pull will refresh baseVersion + apply remote; user's pending edit
        // re-enters via the store-subscribe handler on next change.
        await pullNamespace(ns)
      } else {
        // eslint-disable-next-line no-console
        console.warn('[versa-cloud] push failed', fullKey, e)
      }
    }
  }
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushDirty()
  }, PUSH_DEBOUNCE_MS)
}

async function pullNamespace(ns: SyncNamespace): Promise<void> {
  if (!isProSignedIn()) return
  try {
    const r = await cloudClient.syncPull(ns)
    const known = SYNCED[ns] ?? []
    for (const item of r.items) {
      const full = fk(ns, item.key)
      baseVersions.set(full, item.version)
      if (item.deleted) continue
      if (!known.includes(item.key)) continue
      applyValue(ns, item.key, item.value)
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[versa-cloud] pull failed', ns, e)
  }
}

/** Idempotent boot. Safe to call multiple times. */
export function bootSyncRunner(): void {
  if (booted) return
  booted = true

  useStore.subscribe((state, prev) => {
    if (applyingRemote) return
    if (!isProSignedIn()) return
    const s = state as unknown as Record<string, unknown>
    const p = prev as unknown as Record<string, unknown>
    let added = false
    for (const ns of Object.keys(SYNCED) as SyncNamespace[]) {
      for (const key of SYNCED[ns] ?? []) {
        if (s[key] !== p[key]) {
          dirty.add(fk(ns, key))
          added = true
        }
      }
    }
    if (added) schedulePush()
  })

  // On sign-in / sign-out transitions, hydrate from the server / reset state.
  useCloudStore.subscribe((state, prev) => {
    if (state.signedIn && !prev.signedIn) {
      void pullNamespace('settings')
    } else if (!state.signedIn && prev.signedIn) {
      baseVersions.clear()
      dirty.clear()
      if (pushTimer) {
        clearTimeout(pushTimer)
        pushTimer = null
      }
    }
  })

  pullTimer = setInterval(() => {
    if (isProSignedIn()) void pullNamespace('settings')
  }, PULL_INTERVAL_MS)
}

/** For tests / hot-reload. */
export function stopSyncRunner(): void {
  if (pullTimer) {
    clearInterval(pullTimer)
    pullTimer = null
  }
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
  booted = false
}
