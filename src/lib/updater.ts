import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

/** Check the configured updater endpoint and return the update handle when one
 *  exists. Returns null when the app is up to date or the endpoint is
 *  unreachable. We swallow network errors here so a flaky CDN doesn't crash
 *  the boot path; the diagnostic info modal surfaces the underlying message
 *  if the user manually retries. */
export async function checkForUpdate(): Promise<Update | null> {
  try {
    const u = await check()
    return u ?? null
  } catch {
    return null
  }
}

/** Download + install an update, then restart the app. The user will lose
 *  whatever in-flight Versa state they have; caller should warn before. */
export async function applyUpdate(update: Update): Promise<void> {
  await update.downloadAndInstall()
  await relaunch()
}
