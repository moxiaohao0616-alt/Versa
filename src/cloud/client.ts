// Typed thin wrappers around `invoke('cloud_*')`. Components/hooks call
// these; they never call invoke directly. Keeps the bridge in one place so
// adding telemetry / error mapping / mock layers later is a single edit.

import { invoke } from '@tauri-apps/api/core'
import type {
  CloudStatus,
  CloudDevice,
  Platform,
  SigninStartResp,
  SigninPollResp,
  SyncNamespace,
  SyncPullResp,
  SyncPushArgs,
  SyncPushResp,
} from './types'

export const cloudClient = {
  status: () => invoke<CloudStatus>('cloud_status'),

  setBaseUrl: (url: string) => invoke<void>('cloud_set_base_url', { url }),

  signinStart: (args: {
    deviceName: string
    platform: Platform
    versaVersion?: string
  }) => invoke<SigninStartResp>('cloud_signin_start', { args }),

  signinPoll: () => invoke<SigninPollResp>('cloud_signin_poll'),

  signinCancel: () => invoke<void>('cloud_signin_cancel'),

  signout: () => invoke<void>('cloud_signout'),

  listDevices: () => invoke<CloudDevice[]>('cloud_list_devices'),

  revokeDevice: (deviceId: string) =>
    invoke<void>('cloud_revoke_device', { deviceId }),

  syncPull: (namespace: SyncNamespace) =>
    invoke<SyncPullResp>('cloud_sync_pull', { namespace }),

  syncPush: (args: SyncPushArgs) =>
    invoke<SyncPushResp>('cloud_sync_push', { args }),
}

/** Detect the current platform from navigator. Falls back to 'unknown'. */
export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('win')) return 'windows'
  if (ua.includes('linux')) return 'linux'
  return 'unknown'
}

/** Best-effort device name for first pairing. */
export function defaultDeviceName(): string {
  const p = detectPlatform()
  const label =
    p === 'macos' ? 'Mac' : p === 'windows' ? 'PC' : p === 'linux' ? 'Linux' : 'Device'
  return `My ${label}`
}
