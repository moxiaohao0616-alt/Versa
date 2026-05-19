// Types mirror the camelCase wire format emitted by src-tauri/src/cloud/commands.rs.
// Keep these in sync — if you rename a field on one side, rename it on the other.

export type Plan = 'free' | 'pro' | 'team'
export type Platform = 'macos' | 'linux' | 'windows' | 'unknown'
export type SyncNamespace = 'settings' | 'prompts' | 'keymap'

export interface CloudUser {
  id: string
  email: string
  displayName: string | null
  githubId: number | null
  createdAt: number
}

export interface CloudSubscription {
  plan: Plan
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' | 'paused'
  currentPeriodEnd: number | null
  cancelAtPeriodEnd: boolean
}

export interface CloudDevice {
  id: string
  name: string
  platform: Platform
  versaVersion: string | null
  lastSeenAt: number
  createdAt: number
  current: boolean
}

export interface CloudSyncState {
  inFlight: boolean
  lastSyncedAtMs: number | null
  lastError: string | null
}

export interface CloudStatus {
  signedIn: boolean
  user: CloudUser | null
  subscription: CloudSubscription | null
  device: { id: string } | null
  sync: CloudSyncState
  baseUrl: string
}

export interface SigninStartResp {
  pairCode: string
  verificationUrl: string
  expiresInSeconds: number
  pollIntervalSeconds: number
}

export type SigninPollResp =
  | { status: 'pending' }
  | { status: 'ok'; deviceId: string; expiresAt: number | null }
  | { status: 'expired' }
  | { status: 'consumed' }

export interface SyncItem {
  key: string
  value: unknown
  version: number
  updatedAt: number
  updatedBy: string | null
  deleted: boolean
}

export interface SyncPullResp {
  namespace: SyncNamespace
  items: SyncItem[]
}

export interface SyncPushArgs {
  namespace: SyncNamespace
  key: string
  value: unknown
  baseVersion: number
}

export interface SyncPushResp {
  version: number
}
