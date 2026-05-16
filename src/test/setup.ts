// Vitest setup — runs before every test file.
import '@testing-library/jest-dom/vitest'

// Tauri APIs aren't available under jsdom. Tests that need them should mock
// the specific module; default to a permissive stub so importing a module
// that grabs `@tauri-apps/api/core` doesn't crash on import.
import { vi } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => {}),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => null),
  save: vi.fn(async () => null),
}))
