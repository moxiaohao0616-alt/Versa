import { describe, it, expect } from 'vitest'
import { detectLanguage } from './highlight'

describe('detectLanguage', () => {
  it('returns null for missing input', () => {
    expect(detectLanguage(null)).toBeNull()
    expect(detectLanguage(undefined)).toBeNull()
    expect(detectLanguage('')).toBeNull()
  })

  it('maps common extensions to hljs language IDs', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript')
    expect(detectLanguage('foo.tsx')).toBe('typescript')
    expect(detectLanguage('foo.js')).toBe('javascript')
    expect(detectLanguage('lib.rs')).toBe('rust')
    // hljs ships no dedicated TOML grammar — we alias toml → ini which renders fine.
    expect(detectLanguage('Cargo.toml')).toBe('ini')
    expect(detectLanguage('build.gradle')).toBeNull()  // not registered
  })

  it('handles paths with multiple dots', () => {
    expect(detectLanguage('foo.test.ts')).toBe('typescript')
    expect(detectLanguage('app.config.js')).toBe('javascript')
  })

  it('is case-insensitive for the extension', () => {
    expect(detectLanguage('FOO.TS')).toBe('typescript')
    expect(detectLanguage('Cargo.TOML')).toBe('ini')
  })
})
