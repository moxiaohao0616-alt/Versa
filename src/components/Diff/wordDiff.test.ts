import { describe, it, expect } from 'vitest'
import { diffChars } from './wordDiff'

describe('diffChars', () => {
  it('returns all-equal for identical strings', () => {
    const { aSegs, bSegs } = diffChars('hello', 'hello')
    expect(aSegs).toEqual([{ type: 'eq', text: 'hello' }])
    expect(bSegs).toEqual([{ type: 'eq', text: 'hello' }])
  })

  it('marks distinct middle chars as del/add', () => {
    const { aSegs, bSegs } = diffChars('cat', 'car')
    // 'c','a' equal; 't' deleted on a side; 'r' added on b side
    expect(aSegs).toEqual([
      { type: 'eq', text: 'ca' },
      { type: 'del', text: 't' },
    ])
    expect(bSegs).toEqual([
      { type: 'eq', text: 'ca' },
      { type: 'add', text: 'r' },
    ])
  })

  it('handles insertion at the end', () => {
    const { aSegs, bSegs } = diffChars('foo', 'foobar')
    expect(aSegs).toEqual([{ type: 'eq', text: 'foo' }])
    expect(bSegs).toEqual([
      { type: 'eq', text: 'foo' },
      { type: 'add', text: 'bar' },
    ])
  })

  it('handles deletion at the start', () => {
    const { aSegs, bSegs } = diffChars('prefix-x', 'x')
    expect(aSegs).toEqual([
      { type: 'del', text: 'prefix-' },
      { type: 'eq', text: 'x' },
    ])
    expect(bSegs).toEqual([{ type: 'eq', text: 'x' }])
  })

  it('bails out to full-line diff on very long inputs', () => {
    const a = 'x'.repeat(600)
    const b = 'y'.repeat(600)
    const { aSegs, bSegs } = diffChars(a, b)
    expect(aSegs).toEqual([{ type: 'del', text: a }])
    expect(bSegs).toEqual([{ type: 'add', text: b }])
  })
})
