// Cloud state lives in its own Zustand store rather than inside the main
// `src/store/index.ts` for two reasons:
//   1. The main store is already 25 KB+; growth pressure is real.
//   2. Cloud is opt-in. Putting it in a separate store means a user who never
//      touches Cloud never imports any of this code path.
//
// `useCloudStore` mirrors backend `CloudStatus` plus an ephemeral pairing-flow
// substate (pair code + the polling timer handle).

import { create } from 'zustand'
import { cloudClient, defaultDeviceName, detectPlatform } from './client'
import type { CloudDevice, CloudStatus, Plan } from './types'

type SigninPhase = 'idle' | 'starting' | 'pending' | 'success' | 'expired' | 'error'

interface CloudStore {
  // ─── status (mirror of backend) ──────────────────────────────────────────
  initialized: boolean
  signedIn: boolean
  user: CloudStatus['user']
  subscription: CloudStatus['subscription']
  device: CloudStatus['device']
  sync: CloudStatus['sync']
  baseUrl: string

  // ─── devices list (lazy-loaded) ──────────────────────────────────────────
  devices: CloudDevice[]
  devicesLoading: boolean

  // ─── pairing flow ─────────────────────────────────────────────────────────
  signinPhase: SigninPhase
  pairCode: string | null
  verificationUrl: string | null
  pairExpiresAt: number | null
  signinError: string | null

  // ─── actions ──────────────────────────────────────────────────────────────
  refreshStatus: () => Promise<void>
  setBaseUrl: (url: string) => Promise<void>
  startSignin: () => Promise<void>
  cancelSignin: () => Promise<void>
  pollSignin: () => Promise<'pending' | 'success' | 'expired' | 'error'>
  signOut: () => Promise<void>
  loadDevices: () => Promise<void>
  revokeDevice: (id: string) => Promise<void>
}

function planOrFree(s: CloudStatus['subscription']): Plan {
  return s?.plan ?? 'free'
}

export const useCloudStore = create<CloudStore>((set, get) => ({
  initialized: false,
  signedIn: false,
  user: null,
  subscription: null,
  device: null,
  sync: { inFlight: false, lastSyncedAtMs: null, lastError: null },
  baseUrl: '',

  devices: [],
  devicesLoading: false,

  signinPhase: 'idle',
  pairCode: null,
  verificationUrl: null,
  pairExpiresAt: null,
  signinError: null,

  refreshStatus: async () => {
    try {
      const s = await cloudClient.status()
      set({
        initialized: true,
        signedIn: s.signedIn,
        user: s.user,
        subscription: s.subscription,
        device: s.device,
        sync: s.sync,
        baseUrl: s.baseUrl,
      })
    } catch (e) {
      set({ initialized: true, signinError: String(e) })
    }
  },

  setBaseUrl: async (url) => {
    await cloudClient.setBaseUrl(url)
    set({ baseUrl: url })
  },

  startSignin: async () => {
    set({
      signinPhase: 'starting',
      signinError: null,
      pairCode: null,
      verificationUrl: null,
      pairExpiresAt: null,
    })
    try {
      const r = await cloudClient.signinStart({
        deviceName: defaultDeviceName(),
        platform: detectPlatform(),
        versaVersion: undefined,
      })
      set({
        signinPhase: 'pending',
        pairCode: r.pairCode,
        verificationUrl: r.verificationUrl,
        pairExpiresAt: Date.now() + r.expiresInSeconds * 1000,
      })
    } catch (e) {
      set({ signinPhase: 'error', signinError: String(e) })
    }
  },

  cancelSignin: async () => {
    try {
      await cloudClient.signinCancel()
    } catch {
      // ignore — server side is fine if there's no pending pair.
    }
    set({
      signinPhase: 'idle',
      pairCode: null,
      verificationUrl: null,
      pairExpiresAt: null,
      signinError: null,
    })
  },

  pollSignin: async () => {
    try {
      const r = await cloudClient.signinPoll()
      if (r.status === 'pending') return 'pending'
      if (r.status === 'expired') {
        set({
          signinPhase: 'expired',
          pairCode: null,
          verificationUrl: null,
          pairExpiresAt: null,
        })
        return 'expired'
      }
      if (r.status === 'consumed') {
        set({
          signinPhase: 'expired',
          signinError: 'This pair code has already been used.',
          pairCode: null,
        })
        return 'expired'
      }
      // status === 'ok'
      set({
        signinPhase: 'success',
        pairCode: null,
        verificationUrl: null,
        pairExpiresAt: null,
      })
      // Refresh full status so we have user + subscription populated.
      await get().refreshStatus()
      return 'success'
    } catch (e) {
      set({ signinPhase: 'error', signinError: String(e) })
      return 'error'
    }
  },

  signOut: async () => {
    try {
      await cloudClient.signout()
    } finally {
      set({
        signedIn: false,
        user: null,
        subscription: null,
        device: null,
        devices: [],
        sync: { inFlight: false, lastSyncedAtMs: null, lastError: null },
      })
    }
  },

  loadDevices: async () => {
    set({ devicesLoading: true })
    try {
      const d = await cloudClient.listDevices()
      set({ devices: d })
    } finally {
      set({ devicesLoading: false })
    }
  },

  revokeDevice: async (id) => {
    await cloudClient.revokeDevice(id)
    set((s) => ({ devices: s.devices.filter((d) => d.id !== id) }))
  },
}))

/** Convenience selector: current plan, defaulting to 'free' when unsigned-in. */
export function useCloudPlan(): Plan {
  return useCloudStore((s) => planOrFree(s.subscription))
}
